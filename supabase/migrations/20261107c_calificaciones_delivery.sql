-- ════════════════════════════════════════════════════════════════════
-- Calificación de 1 toque + «Resultados delivery» (7-nov-2026, pedido de Cesar)
--
-- El cliente califica desde su link de seguimiento cuando el pedido ya fue
-- entregado: 😀 (3) / 😐 (2) / 😞 (1), motivos en chips, comentario y si
-- quiere que lo contacten. Cada encargado ve en el ERP («Resultados
-- delivery») día por día: nota, pedido, motivo, quién lo llevó y cuánto se
-- tardó en cada etapa (confirmación, cocina, esperando motorista, ruta).
-- 😞 o «quiero que me contacten» → aviso por Telegram al grupo de alertas
-- (bot_config.telegram_grupo_alertas; si no está configurado no se envía).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.delivery_calificaciones (
  id              bigserial primary key,
  delivery_id     uuid not null unique references public.delivery_clientes(id) on delete cascade,
  nota            smallint not null check (nota between 1 and 3),
  motivos         text[] not null default '{}',
  comentario      text,
  quiere_contacto boolean not null default false,
  contactado_at   timestamptz,
  contactado_por  uuid,
  contactado_nombre text,
  nota_contacto   text,
  alertado_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.delivery_calificaciones enable row level security;  -- solo vía funciones

-- ── El cliente califica (link de seguimiento) ────────────────────────
create or replace function public.tracking_calificar(p_token uuid, p_nota int, p_motivos text[] default '{}',
                                                     p_comentario text default null, p_contacto boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare d delivery_clientes%rowtype; v_prev delivery_calificaciones%rowtype;
begin
  select * into d from delivery_clientes where tracking_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrado'); end if;
  if d.estado <> 'entregada' then return jsonb_build_object('ok', false, 'error', 'no_entregado'); end if;
  if d.entregado_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'error', 'vencido'); end if;
  if p_nota not between 1 and 3 then return jsonb_build_object('ok', false, 'error', 'nota'); end if;

  select * into v_prev from delivery_calificaciones where delivery_id = d.id;
  -- Se puede corregir durante 1 hora (tocó la carita equivocada, agrega el motivo)
  if found and v_prev.created_at < now() - interval '1 hour' then
    return jsonb_build_object('ok', false, 'error', 'ya_calificado');
  end if;

  insert into delivery_calificaciones (delivery_id, nota, motivos, comentario, quiere_contacto)
  values (d.id, p_nota,
          coalesce((select array_agg(left(m, 40)) from unnest(p_motivos) m where btrim(m) <> ''), '{}'),
          nullif(left(btrim(coalesce(p_comentario, '')), 600), ''), coalesce(p_contacto, false))
  on conflict (delivery_id) do update
     set nota = excluded.nota, motivos = excluded.motivos, comentario = excluded.comentario,
         quiere_contacto = excluded.quiere_contacto, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$function$;
grant execute on function public.tracking_calificar(uuid, int, text[], text, boolean) to anon, authenticated;

-- ── Aviso por Telegram (😞 o pidió contacto) ─────────────────────────
create or replace function public.trg_calificacion_alerta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_token text; v_chat text; d record; v_txt text;
begin
  if new.alertado_at is not null then return null; end if;
  if not (new.nota = 1 or new.quiere_contacto) then return null; end if;
  begin
    select valor into v_token from bot_config where clave = 'telegram_bot_token';
    select valor into v_chat  from bot_config where clave = 'telegram_grupo_alertas';
    if v_token is null or v_chat is null then return null; end if;

    select dc.numero_orden, s.nombre suc, split_part(btrim(e.nombre_completo), ' ', 1) mot,
           to_char(dc.created_at - interval '6 hours', 'HH24:MI') pidio,
           to_char(dc.entregado_at - interval '6 hours', 'HH24:MI') entrego,
           round(extract(epoch from dc.entregado_at - dc.created_at)/60) minutos,
           split_part(btrim(coalesce(dc.cliente_nombre, '')), ' ', 1) cli, dc.cliente_telefono tel
      into d
      from delivery_clientes dc
      left join sucursales s on s.id = dc.sucursal_id
      left join empleados e on e.id = dc.motorista_id
     where dc.id = new.delivery_id;

    v_txt := case new.nota when 1 then '😞 Calificación MALA' when 2 then '😐 Calificación regular' else '😀 Calificación buena' end
          || ' · ' || coalesce(d.suc, '?')
          || E'\n' || d.numero_orden || ' · motorista ' || coalesce(d.mot, '—')
          || E'\nPidió ' || d.pidio || ' · entregado ' || d.entrego || ' (' || d.minutos || ' min)'
          || case when cardinality(new.motivos) > 0 then E'\nMotivo: ' || array_to_string(new.motivos, ', ') else '' end
          || case when new.comentario is not null then E'\n«' || new.comentario || '»' else '' end
          || case when new.quiere_contacto then E'\n✅ Quiere que lo contacten: ' || coalesce(d.cli, '') || ' ' || coalesce(d.tel, '') else '' end
          || E'\nVer en ERP → Resultados delivery';

    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('chat_id', v_chat, 'text', v_txt));
    update delivery_calificaciones set alertado_at = now() where id = new.id;
  exception when others then
    raise warning 'trg_calificacion_alerta: %', sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_calificacion_alerta on public.delivery_calificaciones;
create trigger trg_calificacion_alerta
  after insert or update of nota, quiere_contacto on public.delivery_calificaciones
  for each row execute function public.trg_calificacion_alerta();

-- ── Resultados delivery (encargados) ─────────────────────────────────
-- p_store null = todas (ejecutivo / admin). El ERP le pasa al encargado su store_code.
create or replace function public.fn_resultados_delivery(p_store text, p_desde date, p_hasta date)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select d.id, d.numero_orden, s.store_code, s.nombre sucursal,
           (d.created_at - interval '6 hours') pidio_local,
           ((d.created_at - interval '6 hours'))::date dia,
           d.total, d.metodo_pago,
           split_part(btrim(coalesce(d.cliente_nombre, '')), ' ', 1) cliente, d.cliente_telefono,
           split_part(btrim(coalesce(e.nombre_completo, d.repartidor_nombre, '')), ' ', 1)
             || coalesce(' ' || nullif(split_part(btrim(coalesce(e.nombre_completo, '')), ' ', 2), ''), '') motorista,
           d.created_at, d.entregado_at, d.orden_entrega,
           (select count(*) from delivery_clientes x where x.ruta_id = d.ruta_id and d.ruta_id is not null) pedidos_en_viaje,
           l.prep_at, l.lista_at, l.camino_at, a.asign_at,
           c.id cal_id, c.nota, c.motivos, c.comentario, c.quiere_contacto, c.contactado_at, c.contactado_nombre, c.nota_contacto,
           c.created_at calificado_at
      from delivery_clientes d
      join sucursales s on s.id = d.sucursal_id
      left join empleados e on e.id = d.motorista_id
      left join lateral (
        select min(cambiado_at) filter (where estado_nuevo = 'preparando') prep_at,
               max(cambiado_at) filter (where estado_nuevo = 'lista') lista_at,
               min(cambiado_at) filter (where estado_nuevo = 'en_camino') camino_at
          from delivery_estado_log where delivery_id = d.id) l on true
      left join lateral (select max(momento) asign_at from delivery_asignaciones_log where delivery_id = d.id) a on true
      left join delivery_calificaciones c on c.delivery_id = d.id
     where d.tipo = 'delivery' and d.estado = 'entregada'
       and ((d.created_at - interval '6 hours'))::date between p_desde and p_hasta
       and (p_store is null or s.store_code = p_store)),
  m as (
    select b.*,
      round(extract(epoch from b.prep_at - b.created_at)/60)                               min_confirmar,
      round(extract(epoch from b.lista_at - b.prep_at)/60)                                 min_cocina,
      round(extract(epoch from greatest(b.asign_at, b.lista_at) - b.lista_at)/60)          min_asignar,
      round(extract(epoch from b.camino_at - greatest(coalesce(b.asign_at, b.lista_at), b.lista_at))/60) min_retirar,
      round(extract(epoch from b.entregado_at - b.camino_at)/60)                           min_ruta,
      round(extract(epoch from b.entregado_at - b.created_at)/60)                          min_total
    from base b)
  select jsonb_build_object(
    'resumen', (select jsonb_build_object(
        'entregados', count(*), 'calificados', count(nota),
        'buenas', count(*) filter (where nota = 3), 'regulares', count(*) filter (where nota = 2),
        'malas', count(*) filter (where nota = 1),
        'pendientes_contacto', count(*) filter (where (nota = 1 or quiere_contacto) and contactado_at is null),
        'min_total_mediana', percentile_cont(.5) within group (order by min_total::float8),
        'pct_mas_60', round(100.0 * avg((min_total > 60)::int)::numeric, 0)) from m),
    'motivos', (select coalesce(jsonb_agg(jsonb_build_object('motivo', mo, 'n', n) order by n desc), '[]'::jsonb)
                  from (select unnest(motivos) mo, count(*) n from m where nota is not null group by 1) z),
    'dias', (select coalesce(jsonb_agg(jsonb_build_object(
                'dia', dia, 'entregados', ent, 'calificados', cal, 'buenas', bue, 'regulares', reg, 'malas', mal,
                'min_total_mediana', med) order by dia desc), '[]'::jsonb)
               from (select dia, count(*) ent, count(nota) cal, count(*) filter (where nota = 3) bue,
                            count(*) filter (where nota = 2) reg, count(*) filter (where nota = 1) mal,
                            percentile_cont(.5) within group (order by min_total::float8) med
                       from m group by dia) z),
    'calificaciones', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', cal_id, 'dia', dia, 'hora', to_char(pidio_local, 'HH24:MI'), 'numero_orden', numero_orden,
                'sucursal', sucursal, 'store_code', store_code, 'nota', nota, 'motivos', motivos, 'comentario', comentario,
                'quiere_contacto', quiere_contacto, 'contactado_at', contactado_at, 'contactado_nombre', contactado_nombre,
                'nota_contacto', nota_contacto, 'cliente', cliente, 'telefono', cliente_telefono,
                'motorista', nullif(btrim(motorista), ''), 'total', total, 'metodo_pago', metodo_pago,
                'orden_entrega', orden_entrega, 'pedidos_en_viaje', pedidos_en_viaje,
                'min_confirmar', min_confirmar, 'min_cocina', min_cocina, 'min_asignar', min_asignar,
                'min_retirar', min_retirar, 'min_ruta', min_ruta, 'min_total', min_total)
              order by pidio_local desc), '[]'::jsonb)
             from m where nota is not null)
  );
$function$;
grant execute on function public.fn_resultados_delivery(text, date, date) to anon, authenticated;

-- ── El encargado marca que ya contactó al cliente ────────────────────
create or replace function public.fn_resultados_delivery_contactado(p_id bigint, p_usuario_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_nombre text;
begin
  select nombre || ' ' || apellido into v_nombre from usuarios_erp where id = p_usuario_id and activo;
  if v_nombre is null then raise exception 'Usuario no válido'; end if;
  update delivery_calificaciones
     set contactado_at = now(), contactado_por = p_usuario_id, contactado_nombre = v_nombre,
         nota_contacto = nullif(left(btrim(coalesce(p_nota, '')), 500), ''), updated_at = now()
   where id = p_id;
  if not found then raise exception 'Calificación no encontrada'; end if;
  return jsonb_build_object('ok', true);
end;
$function$;
grant execute on function public.fn_resultados_delivery_contactado(bigint, uuid, text) to anon, authenticated;

-- ── tracking_pedido: devuelve si ya calificó (aplicada como tracking_pedido_con_calificacion) ──
-- Misma función que en 20261107_orden_entrega_automatico.sql, con un campo más en el return:
--   'calificacion', (select jsonb_build_object('nota', c.nota, 'editable', c.created_at > now() - interval '1 hour')
--                      from public.delivery_calificaciones c where c.delivery_id = d.id),
