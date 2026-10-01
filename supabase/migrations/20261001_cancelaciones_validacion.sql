-- ═══════════════════════════════════════════════════════════════════════════
-- Cancelaciones con validación del encargado (1-oct-2026, Frank)
--
-- Toda cancelación de algo que ya entró a cocina (caja, web/delivery,
-- PedidosYa o registrada a mano) cae en una bandeja. El gerente de la sucursal
-- recibe una notificación del ERP y decide qué pasó con el producto; si en
-- 15 minutos nadie decide, avisa también al grupo (Frank, César, José).
-- El conteo nocturno no se guarda con cancelaciones sin resolver.
--
-- Modo por sucursal (cancelacion_config.modo):
--   off    → no se crea nada.
--   sombra → se crea la cancelación, se avisa y se decide, pero el inventario
--            sigue moviéndose como antes (caja/cocina). Sirve para comparar.
--   activo → (etapa 2) la decisión del encargado mueve el inventario.
--            Todavía no implementado: la RPC de resolver solo registra.
--
-- Las notificaciones son Web Push: tabla push_suscripciones + función
-- cancelaciones-push. Las claves VAPID y el secreto interno viven en
-- app_secretos (las genera la propia función; nunca pasan por el navegador).
-- Los triggers sobre tablas del POS van envueltos en exception: si algo de
-- esto falla, la anulación en caja sigue funcionando igual.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Configuración ──────────────────────────────────────────────────────────
create table if not exists public.cancelacion_config (
  store_code      text primary key,
  modo            text not null default 'off' check (modo in ('off','sombra','activo')),
  escalar_min     int  not null default 15 check (escalar_min between 1 and 240),
  bloquear_conteo boolean not null default true,
  updated_at      timestamptz not null default now()
);
alter table public.cancelacion_config enable row level security;

-- Quién recibe el aviso. nivel 'primero' (por sucursal, además de los gerentes
-- activos de esa sucursal) o 'grupo' (store_code null: todas las sucursales).
create table if not exists public.cancelacion_avisos (
  id          bigint generated always as identity primary key,
  store_code  text,
  usuario_id  uuid not null references public.usuarios_erp(id) on delete cascade,
  nivel       text not null check (nivel in ('primero','grupo')),
  created_at  timestamptz not null default now(),
  unique nulls not distinct (store_code, usuario_id, nivel)
);
alter table public.cancelacion_avisos enable row level security;

-- ── Suscripciones push (un registro por dispositivo) ─────────────────────────
create table if not exists public.push_suscripciones (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.usuarios_erp(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  ultimo_ok   timestamptz,
  fallos      int not null default 0
);
create index if not exists push_suscripciones_usuario_idx on public.push_suscripciones(usuario_id);
alter table public.push_suscripciones enable row level security;

-- ── La bandeja ───────────────────────────────────────────────────────────────
create table if not exists public.cancelaciones_validacion (
  id                     bigint generated always as identity primary key,
  sucursal_id            uuid references public.sucursales(id),
  store_code             text not null,
  origen                 text not null check (origen in ('caja','web_delivery','pedidosya','manual')),
  merma_id               uuid unique references public.pos_mermas_producto(id) on delete cascade,
  delivery_cancelacion_id bigint unique,
  peya_orden_id          bigint unique,
  cuenta_id              uuid,
  cuenta_item_id         uuid,
  titulo                 text not null,
  referencia             text,
  valor                  numeric,
  componentes            jsonb not null default '[]'::jsonb,   -- [{nombre, cantidad}]
  cancelado_por          uuid,
  cancelado_por_nombre   text,
  motivo                 text,
  opinion_caja           text,     -- preparado | no_preparado | reutilizado
  opinion_cocina         text,
  cocina_por_nombre      text,
  estado                 text not null default 'pendiente' check (estado in ('pendiente','resuelto')),
  decision               text check (decision in ('no_preparado','botado','reutilizado','consumo_interno','parcial')),
  detalle                jsonb,    -- por componente: [{nombre, cantidad, decision, destino_ref, consumo_nombre}]
  destino_ref            text,
  consumo_nombre         text,
  nota                   text,
  decidido_por           uuid,
  decidido_por_nombre    text,
  decidido_at            timestamptz,
  modo                   text not null,
  avisado_at             timestamptz,
  escalado_at            timestamptz,
  created_at             timestamptz not null default now()
);
create index if not exists cancelaciones_validacion_pend_idx
  on public.cancelaciones_validacion(store_code, created_at) where estado = 'pendiente';
alter table public.cancelaciones_validacion enable row level security;

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function public._cancel_modo(p_store text)
returns text language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce((select modo from public.cancelacion_config where store_code = p_store), 'off')
$$;

-- Componentes de una línea: las filas de cocina de ese ítem (un combo trae una
-- por componente). Si ya no hay filas en cocina, el ítem mismo.
create or replace function public._cancel_componentes_item(p_item uuid)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object('nombre', q.nombre_item, 'cantidad', coalesce(q.cantidad,1)) order by q.recibido_at)
       from public.pos_cocina_queue q where q.cuenta_item_id = p_item),
    (select jsonb_build_array(jsonb_build_object('nombre', i.nombre, 'cantidad', coalesce(i.cantidad,1)))
       from public.pos_cuenta_items i where i.id = p_item),
    '[]'::jsonb)
$$;

create or replace function public._cancel_componentes_cuenta(p_cuenta uuid)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', coalesce(i.cantidad,1)) order by i.created_at), '[]'::jsonb)
    from public.pos_cuenta_items i where i.cuenta_id = p_cuenta
$$;

-- Aviso: le pide a la función cancelaciones-push que mande la notificación.
-- Nunca falla hacia afuera (lo llama un trigger del POS).
create or replace function public._cancel_avisar(p_id bigint, p_nivel text)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_secret text;
begin
  select valor into v_secret from public.app_secretos where clave = 'cancel_push_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url     := 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/cancelaciones-push',
    headers := jsonb_build_object('Content-Type','application/json','x-cancel-secret', v_secret),
    body    := jsonb_build_object('id', p_id, 'nivel', p_nivel),
    timeout_milliseconds := 8000);
exception when others then
  raise warning 'cancelaciones: no se pudo pedir el aviso (%): %', p_id, sqlerrm;
end $$;

-- ── Triggers de entrada ──────────────────────────────────────────────────────
-- 1) Caja: cada fila nueva de pos_mermas_producto (anulación de algo que ya
--    estaba en cocina, desde POSMain u Órdenes).
create or replace function public._cancel_desde_merma()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_modo text; v_ref text;
begin
  begin
    if tg_op = 'INSERT' then
      v_modo := public._cancel_modo(new.store_code);
      if v_modo = 'off' then return new; end if;
      v_ref := coalesce(nullif(new.mesa_ref,''),
                 (select case c.tipo when 'pedidos_ya' then 'PeYa #'||coalesce(c.delivery_referencia,'?')
                                      when 'delivery_app' then 'Hifumi '||coalesce(right(c.delivery_referencia,4),'')
                                      when 'para_llevar' then 'Para llevar'
                                      else initcap(replace(coalesce(c.tipo,''),'_',' ')) end
                    from public.pos_cuentas c where c.id = new.cuenta_id));
      insert into public.cancelaciones_validacion (
        sucursal_id, store_code, origen, merma_id, cuenta_id, cuenta_item_id,
        titulo, referencia, valor, componentes, cancelado_por, cancelado_por_nombre,
        motivo, opinion_caja, opinion_cocina, cocina_por_nombre, modo)
      values (new.sucursal_id, new.store_code, 'caja', new.id, new.cuenta_id, new.cuenta_item_id,
        trim(to_char(new.cantidad,'FM999990.##'))||'× '||new.producto_nombre, v_ref, new.valor_venta,
        public._cancel_componentes_item(new.cuenta_item_id), new.anulado_por, new.anulado_por_nombre,
        new.motivo, new.respuesta_caja, new.respuesta_cocina, new.confirmado_por_nombre, v_modo)
      on conflict (merma_id) do nothing;
    else
      update public.cancelaciones_validacion
         set opinion_caja = new.respuesta_caja,
             opinion_cocina = new.respuesta_cocina,
             cocina_por_nombre = new.confirmado_por_nombre,
             motivo = coalesce(motivo, new.motivo)
       where merma_id = new.id;
    end if;
  exception when others then
    raise warning 'cancelaciones (merma %): %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_cancel_desde_merma on public.pos_mermas_producto;
create trigger trg_cancel_desde_merma
  after insert or update of respuesta_caja, respuesta_cocina, motivo on public.pos_mermas_producto
  for each row execute function public._cancel_desde_merma();

-- 2) Web / delivery propio cancelado desde la torre, si ya había entrado a cocina.
create or replace function public._cancel_desde_delivery()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_store text; v_modo text; v_cuenta uuid;
begin
  begin
    select store_code into v_store from public.sucursales where id = new.sucursal_id;
    if tg_op = 'INSERT' then
      if not coalesce(new.habia_entrado_a_cocina, false) then return new; end if;
      v_modo := public._cancel_modo(v_store);
      if v_modo = 'off' then return new; end if;
      select pos_cuenta_id into v_cuenta from public.delivery_clientes where id = new.delivery_id;
      insert into public.cancelaciones_validacion (
        sucursal_id, store_code, origen, delivery_cancelacion_id, cuenta_id,
        titulo, referencia, valor, componentes, cancelado_por_nombre, motivo,
        opinion_caja, modo)
      values (new.sucursal_id, v_store, 'web_delivery', new.id, v_cuenta,
        'Pedido '||coalesce(new.numero_orden,''), coalesce(new.numero_orden,'Delivery')||coalesce(' · '||new.cliente,''),
        new.total, public._cancel_componentes_cuenta(v_cuenta), new.cancelado_por,
        concat_ws(' · ', new.motivo, new.detalle),
        case when new.ya_preparado is null then null when new.ya_preparado then 'preparado' else 'no_preparado' end,
        v_modo)
      on conflict (delivery_cancelacion_id) do nothing;
    elsif new.ya_preparado is distinct from old.ya_preparado then
      update public.cancelaciones_validacion
         set opinion_cocina = case when new.ya_preparado then 'preparado' else 'no_preparado' end
       where delivery_cancelacion_id = new.id;
    end if;
  exception when others then
    raise warning 'cancelaciones (delivery %): %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_cancel_desde_delivery on public.delivery_cancelaciones;
create trigger trg_cancel_desde_delivery
  after insert or update of ya_preparado on public.delivery_cancelaciones
  for each row execute function public._cancel_desde_delivery();

-- 3) PedidosYa automático: el pedido pasa a 'cancelado' con cuenta en el POS.
create or replace function public._cancel_desde_peya()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_store text; v_modo text; v_c record; v_listas int;
begin
  begin
    if new.estado = 'cancelado' and old.estado is distinct from 'cancelado' and new.pos_cuenta_id is not null then
      select store_code into v_store from public.sucursales where id = new.sucursal_id;
      v_modo := public._cancel_modo(v_store);
      if v_modo = 'off' then return new; end if;
      select * into v_c from public.pos_cuentas where id = new.pos_cuenta_id;
      select count(*) filter (where estado = 'completado') into v_listas
        from public.pos_cocina_queue where cuenta_id = new.pos_cuenta_id;
      insert into public.cancelaciones_validacion (
        sucursal_id, store_code, origen, peya_orden_id, cuenta_id, titulo, referencia,
        valor, componentes, cancelado_por_nombre, motivo, opinion_cocina, modo)
      values (new.sucursal_id, v_store, 'pedidosya', new.id, new.pos_cuenta_id,
        'Pedido PedidosYa', 'PeYa #'||coalesce(v_c.delivery_referencia, new.short_code, new.code, new.id::text),
        v_c.total, public._cancel_componentes_cuenta(new.pos_cuenta_id), 'PedidosYa',
        coalesce(new.motivo_rechazo, new.notas),
        case when v_listas > 0 then 'preparado' end, v_modo)
      on conflict (peya_orden_id) do nothing;
    end if;
  exception when others then
    raise warning 'cancelaciones (peya %): %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_cancel_desde_peya on public.peya_ordenes;
create trigger trg_cancel_desde_peya
  after update of estado on public.peya_ordenes
  for each row execute function public._cancel_desde_peya();

-- 4) Aviso inmediato al crear la cancelación.
create or replace function public._cancel_al_crear()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  perform public._cancel_avisar(new.id, 'nueva');
  return new;
end $$;

drop trigger if exists trg_cancel_al_crear on public.cancelaciones_validacion;
create trigger trg_cancel_al_crear
  after insert on public.cancelaciones_validacion
  for each row execute function public._cancel_al_crear();

-- ── Permisos: quién decide ───────────────────────────────────────────────────
create or replace function public._cancel_es_grupo(p_usuario uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
  select exists (select 1 from public.cancelacion_avisos where usuario_id = p_usuario and nivel = 'grupo' and store_code is null)
$$;

create or replace function public._cancel_puede(p_usuario uuid, p_store text)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
  select public._cancel_es_grupo(p_usuario)
      or exists (select 1 from public.usuarios_erp u where u.id = p_usuario and u.activo
                   and u.rol = 'gerente' and u.store_code = p_store)
      or exists (select 1 from public.cancelacion_avisos a where a.usuario_id = p_usuario
                   and a.nivel = 'primero' and a.store_code = p_store)
$$;

-- Destinatarios y texto del aviso. La usa la función de push (service role).
-- Marca avisado_at / escalado_at para no repetir. Agrupa las cancelaciones
-- pendientes de la misma cuenta (anular una orden entera = un solo aviso).
create or replace function public.cancelaciones_push_preparar(p_id bigint, p_nivel text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_c public.cancelaciones_validacion%rowtype;
  v_ids bigint[]; v_titulos text; v_n int; v_primero uuid[]; v_grupo uuid[]; v_dest uuid[];
  v_subs jsonb; v_nivel text := p_nivel; v_desac text;
begin
  select * into v_c from public.cancelaciones_validacion where id = p_id for update;
  if not found or v_c.estado <> 'pendiente' then return jsonb_build_object('enviar', false, 'razon', 'no pendiente'); end if;

  if v_nivel = 'nueva' and v_c.avisado_at is not null then
    return jsonb_build_object('enviar', false, 'razon', 'ya avisado');
  end if;
  if v_nivel = 'grupo' and v_c.escalado_at is not null and v_c.escalado_at < now() - interval '30 seconds' then
    return jsonb_build_object('enviar', false, 'razon', 'ya escalado');
  end if;

  -- Hermanas: misma cuenta, pendientes, creadas en el mismo minuto.
  select array_agg(id order by id), string_agg(titulo, ' · ' order by id), count(*)
    into v_ids, v_titulos, v_n
    from public.cancelaciones_validacion
   where estado = 'pendiente'
     and (id = p_id or (v_c.cuenta_id is not null and cuenta_id = v_c.cuenta_id
                        and abs(extract(epoch from created_at - v_c.created_at)) < 120));

  select coalesce(array_agg(distinct u.id), '{}') into v_primero
    from public.usuarios_erp u
   where u.activo and ((u.rol = 'gerente' and u.store_code = v_c.store_code)
      or u.id in (select usuario_id from public.cancelacion_avisos where nivel = 'primero' and store_code = v_c.store_code));
  select coalesce(array_agg(distinct usuario_id), '{}') into v_grupo
    from public.cancelacion_avisos where nivel = 'grupo' and store_code is null;

  -- Si nadie del primer nivel tiene el aviso activado en un dispositivo, se
  -- avisa al grupo de una vez: no tiene sentido esperar 15 minutos a nadie.
  if v_nivel = 'nueva' and not exists (select 1 from public.push_suscripciones where usuario_id = any(v_primero)) then
    v_nivel := 'grupo';
  end if;

  v_dest := case when v_nivel = 'grupo' then v_primero || v_grupo else v_primero end;

  if v_nivel = 'nueva' then
    update public.cancelaciones_validacion set avisado_at = now() where id = any(v_ids) and avisado_at is null;
  else
    update public.cancelaciones_validacion set avisado_at = coalesce(avisado_at, now()), escalado_at = now()
     where id = any(v_ids) and escalado_at is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into v_subs from public.push_suscripciones s where s.usuario_id = any(v_dest);

  v_desac := case
    when v_c.opinion_caja is not null and v_c.opinion_cocina is not null and v_c.opinion_caja <> v_c.opinion_cocina
      then ' · Caja y cocina no coinciden' else '' end;

  return jsonb_build_object(
    'enviar', jsonb_array_length(v_subs) > 0,
    'nivel', v_nivel,
    'subs', v_subs,
    'titulo', case when v_nivel = 'grupo' and p_nivel = 'grupo' then '⏰ Sin decidir · ' else '↩️ ' end
              || v_c.store_code || ' · ' || coalesce(v_c.referencia, 'Cancelación'),
    'cuerpo', left(v_titulos, 140) || coalesce(' · anuló ' || v_c.cancelado_por_nombre, '') || v_desac
              || '. Tocá para decidir qué pasó con el producto.',
    'tag', 'cancel-' || coalesce(v_c.cuenta_id::text, v_c.id::text),
    'url', '/?ir=cancelaciones');
end $$;
revoke all on function public.cancelaciones_push_preparar(bigint, text) from public, anon, authenticated;
grant execute on function public.cancelaciones_push_preparar(bigint, text) to service_role;

create or replace function public.push_marcar_resultado(p_sub_id bigint, p_ok boolean, p_borrar boolean)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if p_borrar then delete from public.push_suscripciones where id = p_sub_id; return; end if;
  update public.push_suscripciones
     set ultimo_ok = case when p_ok then now() else ultimo_ok end,
         fallos    = case when p_ok then 0 else fallos + 1 end
   where id = p_sub_id;
end $$;
revoke all on function public.push_marcar_resultado(bigint, boolean, boolean) from public, anon, authenticated;
grant execute on function public.push_marcar_resultado(bigint, boolean, boolean) to service_role;

-- Escalamiento: cada minuto, las pendientes que pasaron su tiempo sin decidir.
create or replace function public.cancelaciones_escalar()
returns int language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare r record; v_n int := 0;
begin
  for r in
    select distinct on (coalesce(c.cuenta_id::text, c.id::text)) c.id
      from public.cancelaciones_validacion c
      join public.cancelacion_config cf on cf.store_code = c.store_code
     where c.estado = 'pendiente' and c.escalado_at is null
       and c.created_at < now() - make_interval(mins => cf.escalar_min)
     order by coalesce(c.cuenta_id::text, c.id::text), c.id
  loop
    perform public._cancel_avisar(r.id, 'grupo');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── RPCs para el ERP ─────────────────────────────────────────────────────────
create or replace function public.push_vapid_publica()
returns text language sql stable security definer set search_path to 'public','pg_temp' as $$
  select valor from public.app_secretos where clave = 'vapid_public'
$$;

create or replace function public.push_suscribir(p_usuario_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if not exists (select 1 from public.usuarios_erp where id = p_usuario_id and activo) then
    raise exception 'Usuario no válido';
  end if;
  if coalesce(p_endpoint,'') !~ '^https://' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'Suscripción incompleta';
  end if;
  insert into public.push_suscripciones (usuario_id, endpoint, p256dh, auth, user_agent)
  values (p_usuario_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, fallos = 0;
  return jsonb_build_object('ok', true,
    'dispositivos', (select count(*) from public.push_suscripciones where usuario_id = p_usuario_id));
end $$;

create or replace function public.push_desuscribir(p_endpoint text)
returns void language sql security definer set search_path to 'public','pg_temp' as $$
  delete from public.push_suscripciones where endpoint = p_endpoint
$$;

-- Qué puede ver este usuario: sucursales en las que decide.
create or replace function public.cancelaciones_mis_sucursales(p_usuario_id uuid)
returns text[] language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(cf.store_code order by cf.store_code), '{}')
    from public.cancelacion_config cf
   where cf.modo <> 'off' and public._cancel_puede(p_usuario_id, cf.store_code)
$$;

create or replace function public.cancelaciones_bandeja(p_usuario_id uuid, p_dias int default 2)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select jsonb_build_object(
    'sucursales', public.cancelaciones_mis_sucursales(p_usuario_id),
    'es_grupo', public._cancel_es_grupo(p_usuario_id),
    'items', coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object(
               'es_mia', c.cancelado_por = p_usuario_id,
               'minutos', floor(extract(epoch from now() - c.created_at) / 60))
             order by (c.estado = 'pendiente') desc, c.created_at desc)
        from public.cancelaciones_validacion c
       where c.store_code = any(public.cancelaciones_mis_sucursales(p_usuario_id))
         and (c.estado = 'pendiente' or c.created_at > now() - make_interval(days => greatest(p_dias,1)))
    ), '[]'::jsonb))
$$;

-- Pendientes de una sucursal (lo usa el conteo nocturno, cualquier rol).
create or replace function public.cancelaciones_pendientes_sucursal(p_store_code text)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select jsonb_build_object(
    'bloquear', coalesce((select bloquear_conteo and modo <> 'off' from public.cancelacion_config where store_code = p_store_code), false),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'titulo', c.titulo, 'referencia', c.referencia,
                 'cancelado_por_nombre', c.cancelado_por_nombre, 'created_at', c.created_at,
                 'escalado', c.escalado_at is not null) order by c.created_at)
               from public.cancelaciones_validacion c
              where c.store_code = p_store_code and c.estado = 'pendiente'), '[]'::jsonb))
$$;

create or replace function public.cancelacion_resolver(
  p_usuario_id uuid, p_id bigint, p_decision text,
  p_detalle jsonb default null, p_destino_ref text default null,
  p_consumo_nombre text default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_c public.cancelaciones_validacion%rowtype; v_u record;
begin
  if p_decision not in ('no_preparado','botado','reutilizado','consumo_interno','parcial') then
    raise exception 'Decisión no válida';
  end if;
  select id, btrim(coalesce(nombre,'')||' '||coalesce(apellido,'')) nombre into v_u
    from public.usuarios_erp where id = p_usuario_id and activo;
  if not found then raise exception 'Usuario no válido'; end if;

  select * into v_c from public.cancelaciones_validacion where id = p_id for update;
  if not found then raise exception 'Esa cancelación no existe'; end if;
  if v_c.estado <> 'pendiente' then
    raise exception 'Ya la resolvió % (%)', coalesce(v_c.decidido_por_nombre,'otra persona'),
      to_char(v_c.decidido_at at time zone 'America/El_Salvador','HH24:MI');
  end if;
  if not public._cancel_puede(p_usuario_id, v_c.store_code) then
    raise exception 'No tenés permiso para decidir cancelaciones de %', v_c.store_code;
  end if;
  if v_c.cancelado_por is not null and v_c.cancelado_por = p_usuario_id then
    raise exception 'No podés decidir una cancelación que hiciste vos: la decide otra persona';
  end if;
  if p_decision = 'reutilizado' and nullif(btrim(coalesce(p_destino_ref,'')),'') is null then
    raise exception 'Decí en qué orden se usó';
  end if;
  if p_decision = 'consumo_interno' and nullif(btrim(coalesce(p_consumo_nombre,'')),'') is null then
    raise exception 'Decí a quién se le dio';
  end if;
  if p_decision = 'parcial' and (p_detalle is null or jsonb_typeof(p_detalle) <> 'array' or jsonb_array_length(p_detalle) = 0) then
    raise exception 'Falta la decisión de cada componente';
  end if;

  update public.cancelaciones_validacion
     set estado = 'resuelto', decision = p_decision, detalle = p_detalle,
         destino_ref = nullif(btrim(coalesce(p_destino_ref,'')),''),
         consumo_nombre = nullif(btrim(coalesce(p_consumo_nombre,'')),''),
         nota = nullif(btrim(coalesce(p_nota,'')),''),
         decidido_por = p_usuario_id, decidido_por_nombre = v_u.nombre, decidido_at = now()
   where id = p_id;

  -- Etapa 2 (modo 'activo'): acá se moverá el inventario según la decisión.
  return jsonb_build_object('ok', true, 'modo', v_c.modo,
    'inventario', case when v_c.modo = 'activo'
                       then 'pendiente de etapa 2: el inventario sigue como lo dejaron caja y cocina'
                       else 'modo sombra: se guardó la decisión; el inventario sigue como lo dejaron caja y cocina' end);
end $$;

-- Registrar a mano una cancelación que no pasó por caja (p. ej. un pedido de
-- PedidosYa rechazado después de ingresarlo y cobrarlo).
create or replace function public.cancelacion_registrar_manual(p_usuario_id uuid, p_cuenta_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_c record; v_u record; v_modo text; v_id bigint;
begin
  select id, btrim(coalesce(nombre,'')||' '||coalesce(apellido,'')) nombre into v_u
    from public.usuarios_erp where id = p_usuario_id and activo;
  if not found then raise exception 'Usuario no válido'; end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then raise exception 'Decí por qué se canceló'; end if;
  select c.*, s.id as suc_id into v_c from public.pos_cuentas c join public.sucursales s on s.store_code = c.store_code
   where c.id = p_cuenta_id;
  if not found then raise exception 'Esa cuenta no existe'; end if;
  if not public._cancel_puede(p_usuario_id, v_c.store_code) then
    raise exception 'No tenés permiso para registrar cancelaciones de %', v_c.store_code;
  end if;
  if exists (select 1 from public.cancelaciones_validacion where cuenta_id = p_cuenta_id and origen = 'manual') then
    raise exception 'Esa cuenta ya tiene una cancelación registrada a mano';
  end if;
  v_modo := public._cancel_modo(v_c.store_code);
  if v_modo = 'off' then raise exception 'Las cancelaciones con validación no están activas en %', v_c.store_code; end if;
  insert into public.cancelaciones_validacion (
    sucursal_id, store_code, origen, cuenta_id, titulo, referencia, valor, componentes,
    cancelado_por, cancelado_por_nombre, motivo, modo)
  values (v_c.suc_id, v_c.store_code, 'manual', p_cuenta_id, 'Cuenta completa',
    case v_c.tipo when 'pedidos_ya' then 'PeYa #'||coalesce(v_c.delivery_referencia,'?')
                  when 'delivery_app' then 'Hifumi '||coalesce(right(v_c.delivery_referencia,4),'')
                  else coalesce(nullif(v_c.mesa_ref,''), initcap(replace(coalesce(v_c.tipo,''),'_',' '))) end,
    v_c.total, public._cancel_componentes_cuenta(p_cuenta_id), p_usuario_id, v_u.nombre, btrim(p_motivo), v_modo)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public._cancel_avisar(bigint, text) from public, anon, authenticated;
revoke all on function public.cancelaciones_escalar() from public, anon, authenticated;
grant execute on function public.push_vapid_publica() to anon, authenticated;
grant execute on function public.push_suscribir(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.push_desuscribir(text) to anon, authenticated;
grant execute on function public.cancelaciones_mis_sucursales(uuid) to anon, authenticated;
grant execute on function public.cancelaciones_bandeja(uuid, int) to anon, authenticated;
grant execute on function public.cancelaciones_pendientes_sucursal(text) to anon, authenticated;
grant execute on function public.cancelacion_resolver(uuid, bigint, text, jsonb, text, text, text) to anon, authenticated;
grant execute on function public.cancelacion_registrar_manual(uuid, uuid, text) to anon, authenticated;

-- ── Datos iniciales ──────────────────────────────────────────────────────────
-- Secreto interno entre la base y la función de push (no sale de la base).
insert into public.app_secretos (clave, valor, updated_at)
values ('cancel_push_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now())
on conflict (clave) do nothing;

-- Se crea apagada; se pasa a 'sombra' cuando la app con la bandeja ya está publicada.
insert into public.cancelacion_config (store_code, modo, escalar_min, bloquear_conteo)
values ('M001', 'off', 15, true)
on conflict (store_code) do nothing;

-- Grupo: Frank (Francisco Siguenza), César Rodríguez y José Isart.
insert into public.cancelacion_avisos (store_code, usuario_id, nivel)
select null, id, 'grupo' from public.usuarios_erp
 where id in ('5831606e-ac5d-4904-86b4-9fc017494855','0a0ad760-38af-43a3-abc0-add9b4c53258','c67b81a8-d9d3-4be7-9e7b-daf7114f4331')
on conflict do nothing;

-- Escalamiento cada minuto.
select cron.unschedule('cancelaciones-escalar') where exists (select 1 from cron.job where jobname = 'cancelaciones-escalar');
select cron.schedule('cancelaciones-escalar', '* * * * *', $$select public.cancelaciones_escalar()$$);

-- La función de push guarda las claves VAPID por acá (service_role no escribe app_secretos).
create or replace function public.push_guardar_vapid(p_publica text, p_privada text)
returns text language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  insert into public.app_secretos (clave, valor, updated_at) values ('vapid_public', p_publica, now()) on conflict (clave) do nothing;
  insert into public.app_secretos (clave, valor, updated_at) values ('vapid_private', p_privada, now()) on conflict (clave) do nothing;
  return (select valor from public.app_secretos where clave = 'vapid_public');
end $$;
revoke all on function public.push_guardar_vapid(text, text) from public, anon, authenticated;
grant execute on function public.push_guardar_vapid(text, text) to service_role;

-- La función de push lee los dispositivos con service_role.
grant select on public.push_suscripciones to service_role;

-- Notificación de prueba a los dispositivos del propio usuario (botón "Probar" del ERP).
create or replace function public.push_probar(p_usuario_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_secret text; v_n int;
begin
  select count(*) into v_n from public.push_suscripciones where usuario_id = p_usuario_id;
  if v_n = 0 then raise exception 'Este usuario no tiene avisos activados en ningún dispositivo'; end if;
  select valor into v_secret from public.app_secretos where clave = 'cancel_push_secret';
  perform net.http_post(
    url     := 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/cancelaciones-push',
    headers := jsonb_build_object('Content-Type','application/json','x-cancel-secret', v_secret),
    body    := jsonb_build_object('accion','probar','usuario_id', p_usuario_id),
    timeout_milliseconds := 8000);
  return jsonb_build_object('ok', true, 'dispositivos', v_n);
end $$;
revoke all on function public.push_probar(uuid) from public;
grant execute on function public.push_probar(uuid) to anon, authenticated;

-- ── Al desplegar el frontend (se corre aparte, con OK de Frank) ──
-- Menú: la pantalla «Cancelaciones» para gerente, ejecutivo y admin (el
-- Sidebar lee permisos_rol; superadmin ve todo).
-- insert into public.permisos_rol (rol, nav_key)
--   select r, 'cancelaciones' from unnest(array['gerente','ejecutivo','admin']) r
--   where not exists (select 1 from public.permisos_rol p where p.rol = r and p.nav_key = 'cancelaciones');
-- Etapa 1 en Cafetalón: decisiones se guardan, inventario no cambia.
-- update public.cancelacion_config set modo = 'sombra' where store_code = 'M001';
