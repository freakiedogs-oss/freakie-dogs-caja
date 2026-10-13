-- Endurecimiento de la estación de preparación (resultado de 128 simulaciones, 3-Oct-2026).
-- 1) Una impresión que llega a un lote ya cerrado se mueve al lote abierto de hoy y abre deuda.
-- 2) El servidor valida el cierre del lote: de quien lo imprimió (o traspaso / encargado), con insumos y
--    con cada producto impreso cubierto.
-- 3) Un encargado no puede autorizarse su propia salida.
-- 4) Los PIN fallidos de la estación se cuentan aparte: ya no bloquean el login de la caja (erp_login).
-- 5) Las impresiones llevan una clave única (idempotencia): un reintento no duplica.
-- 6) Una sola deuda abierta por lote y persona (carreras entre dos impresiones).
-- 7) Panel del encargado: deudas abiertas de más de un día.
-- Nota: el archivo evita sentencias destructivas a propósito.

-- ── tablas e índices ───────────────────────────────────────────────────────
create table if not exists public.prep_intentos (
  id bigserial primary key,
  momento timestamptz not null default now(),
  exito boolean not null default false
);
create index if not exists prep_intentos_momento_idx on public.prep_intentos (momento);
alter table public.prep_intentos enable row level security;

alter table public.etiqueta_impresiones add column if not exists clave_idem text;
create unique index if not exists etiqueta_impresiones_clave_idem_uq on public.etiqueta_impresiones (clave_idem) where clave_idem is not null;
create unique index if not exists prep_deudas_una_abierta_uq on public.prep_deudas (lote_id, usuario_id) where estado = 'abierta';

-- ── PIN: contador propio, sin tocar login_intentos ─────────────────────────
create or replace function public.fn_prep_actor(p_pin text, p_solo_encargado boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v record;
begin
  if p_pin is null or length(btrim(p_pin)) < 3 then return null; end if;
  if (select count(*) from public.prep_intentos where not exito and momento > now() - interval '10 minutes') >= 25 then
    raise exception 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';
  end if;
  select u.id, u.nombre, u.apellido, u.rol, u.store_code into v
  from public.usuarios_erp u
  where u.pin = btrim(p_pin) and u.activo
  limit 1;
  if not found then
    insert into public.prep_intentos(exito) values (false);
    return null;
  end if;
  -- PIN real pero sin permiso para esto (p. ej. una cocinera donde se pide encargado): no cuenta como intento fallido.
  if p_solo_encargado then
    if v.rol not in ('jefe_casa_matriz','admin','superadmin','ejecutivo') then return null; end if;
  else
    if v.rol not in ('produccion','despachador','jefe_casa_matriz','admin','superadmin','ejecutivo') then return null; end if;
  end if;
  return jsonb_build_object('id', v.id, 'nombre', trim(concat_ws(' ', v.nombre, v.apellido)), 'rol', v.rol, 'store_code', v.store_code);
end $function$;

-- ── Impresiones: idempotentes y nunca a un lote cerrado ────────────────────
create or replace function public.fn_etiqueta_registrar_v3(p_usuario uuid, p_lote_id uuid, p_producto_id text, p_producto text,
                                                           p_unidades int default 1, p_gramos numeric default null, p_clave text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_lote record; v_prev record; v_nuevo jsonb;
  v_redir boolean := false; v_filas int := 0;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  perform pg_advisory_xact_lock(hashtext('prep_imp_' || p_usuario::text));
  if p_clave is not null then
    select e.lote_id, e.lote into v_prev from public.etiqueta_impresiones e where e.clave_idem = p_clave limit 1;
    if found then
      return jsonb_build_object('duplicada', true, 'con_insumos', false, 'deuda_nueva', false, 'lote_id', v_prev.lote_id, 'lote', v_prev.lote);
    end if;
  end if;
  select * into v_lote from public.prep_lotes where id = p_lote_id;
  if not found or v_lote.estado = 'cerrado' then
    -- Llegó tarde (buzón sin red, otra tablet): no se pierde ni queda "con insumos": va al lote abierto de hoy.
    v_nuevo := public.fn_prep_lote_del_dia(p_usuario);
    select * into v_lote from public.prep_lotes where id = (v_nuevo->>'id')::uuid;
    v_redir := true;
  end if;
  insert into public.etiqueta_impresiones(lote_id, lote, fecha, producto_id, producto, unidades, usuario_id, usuario_nombre, con_insumos, gramos, clave_idem)
  values (v_lote.id, v_lote.lote, v_lote.fecha, p_producto_id, p_producto, greatest(coalesce(p_unidades,1),1), p_usuario, n, false, p_gramos, p_clave);
  insert into public.prep_deudas(lote_id, lote, fecha, usuario_id, usuario_nombre) values (v_lote.id, v_lote.lote, v_lote.fecha, p_usuario, n)
  on conflict (lote_id, usuario_id) where estado = 'abierta' do nothing;
  get diagnostics v_filas = row_count;
  if v_filas > 0 then
    insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('deuda_abierta', p_usuario, n, jsonb_build_object('lote', v_lote.lote, 'producto', p_producto, 'redirigida', v_redir));
  end if;
  return jsonb_build_object('con_insumos', false, 'deuda_nueva', v_filas > 0, 'redirigida', v_redir, 'lote_id', v_lote.id, 'lote', v_lote.lote);
end $function$;

-- Las versiones anteriores quedan como atajos a la nueva (nadie puede saltarse las reglas).
create or replace function public.fn_etiqueta_registrar_v2(p_usuario uuid, p_lote_id uuid, p_producto_id text, p_producto text, p_unidades int default 1, p_gramos numeric default null)
returns jsonb language sql security definer set search_path to 'public'
as $function$ select public.fn_etiqueta_registrar_v3(p_usuario, p_lote_id, p_producto_id, p_producto, p_unidades, p_gramos, null) $function$;
create or replace function public.fn_etiqueta_registrar(p_usuario uuid, p_lote_id uuid, p_producto_id text, p_producto text, p_unidades int default 1)
returns jsonb language sql security definer set search_path to 'public'
as $function$ select public.fn_etiqueta_registrar_v3(p_usuario, p_lote_id, p_producto_id, p_producto, p_unidades, null, null) $function$;
grant execute on function public.fn_etiqueta_registrar_v3(uuid, uuid, text, text, int, numeric, text) to anon, authenticated;

-- ── Cierre del lote: validado en el servidor ───────────────────────────────
create or replace function public.fn_prep_lote_guardar(p_usuario uuid, p_lote_id uuid, p_recetas jsonb, p_insumos jsonb, p_cerrar boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_lote record; v_saldadas int := 0; v_rol text; v_enc boolean; v_dueno boolean; v_falta text;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  select * into v_lote from public.prep_lotes where id = p_lote_id;
  if not found then raise exception 'Ese lote no existe.'; end if;
  select u.rol into v_rol from public.usuarios_erp u where u.id = p_usuario;
  v_enc := v_rol in ('jefe_casa_matriz','admin','superadmin','ejecutivo');
  v_dueno := v_lote.creado_por = p_usuario or exists (select 1 from public.prep_deudas d where d.lote_id = p_lote_id and d.usuario_id = p_usuario);
  if not v_dueno and not v_enc then
    raise exception 'Ese lote no es tuyo: solo lo registra quien lo imprimió, a quien se lo pasaron o un encargado.';
  end if;
  if p_cerrar then
    if not exists (select 1 from jsonb_to_recordset(coalesce(p_insumos,'[]'::jsonb)) as x(cantidad numeric, falto boolean)
                    where coalesce(x.falto,false) = false and x.cantidad is not null) then
      raise exception 'No se registró ningún insumo: no se puede cerrar el lote vacío.';
    end if;
    select string_agg(distinct coalesce(p.nombre, e.producto), ', ') into v_falta
      from public.etiqueta_impresiones e
      left join public.etiquetado_productos p on p.id::text = e.producto_id
     where e.lote_id = p_lote_id
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(p_insumos,'[]'::jsonb)) as x(receta_id text, cantidad numeric, falto boolean)
          where coalesce(x.falto,false) = false and x.cantidad is not null
            and x.receta_id in (coalesce(p.clave,'-'), case when p.clave = 'pepinillotritura' then 'pepinillo' else '-' end, 'prod-' || coalesce(e.producto_id,'-')));
    if v_falta is not null then
      raise exception 'Faltan los insumos de lo que imprimiste: %. Registralos antes de cerrar.', v_falta;
    end if;
  end if;

  update public.prep_lote_insumos set vigente = false, reemplazado_at = now() where lote_id = p_lote_id and vigente;
  insert into public.prep_lote_insumos(lote_id, receta_id, codigo, insumo, cantidad, unidad, cantidad_receta, unidad_receta, ratio, fuera_receta, falto, nuevo, nota, pistoleos, usuario_id, usuario_nombre)
  select p_lote_id, x.receta_id, x.codigo, x.insumo, x.cantidad, x.unidad, x.cantidad_receta, x.unidad_receta, x.ratio,
         coalesce(x.fuera_receta,false), coalesce(x.falto,false), coalesce(x.nuevo,false), x.nota, x.pistoleos, p_usuario, n
  from jsonb_to_recordset(coalesce(p_insumos,'[]'::jsonb)) as x(receta_id text, codigo text, insumo text, cantidad numeric, unidad text,
       cantidad_receta numeric, unidad_receta text, ratio numeric, fuera_receta boolean, falto boolean, nuevo boolean, nota text, pistoleos int);

  update public.prep_lotes set
    recetas = coalesce(p_recetas, recetas),
    estado = case when p_cerrar then 'cerrado' else estado end,
    cerrado_por = case when p_cerrar then p_usuario else cerrado_por end,
    cerrado_nombre = case when p_cerrar then n else cerrado_nombre end,
    cerrado_at = case when p_cerrar then now() else cerrado_at end
  where id = p_lote_id;

  if p_cerrar then
    update public.prep_deudas set estado = 'cerrada', cerrada_at = now() where lote_id = p_lote_id and estado = 'abierta';
    get diagnostics v_saldadas = row_count;
  end if;

  insert into public.prep_bitacora(accion, actor_id, actor, detalle)
  values (case when p_cerrar then 'lote_cerrado' else 'lote_guardado' end, p_usuario, n,
          jsonb_build_object('lote', v_lote.lote, 'insumos', jsonb_array_length(coalesce(p_insumos,'[]'::jsonb)), 'deudas_saldadas', v_saldadas));
  return jsonb_build_object('ok', true, 'lote', v_lote.lote, 'deudas_saldadas', v_saldadas);
end $function$;

-- ── Autorizar salida: no a uno mismo ───────────────────────────────────────
create or replace function public.fn_salida_autorizar(p_usuario uuid, p_pin_encargado text, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb; n text := public._prep_nombre(p_usuario); k int;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  if coalesce(btrim(p_motivo),'') = '' then raise exception 'Falta el motivo.'; end if;
  a := public.fn_prep_actor(p_pin_encargado, true);
  if a is null then raise exception 'Ese PIN no puede autorizar salidas.'; end if;
  if (a->>'id')::uuid = p_usuario then raise exception 'No podés autorizar tu propia salida: pedile a otro encargado.'; end if;
  update public.prep_deudas set estado = 'autorizada', autorizada_por = a->>'nombre', motivo = btrim(p_motivo), cerrada_at = now()
   where usuario_id = p_usuario and estado = 'abierta';
  get diagnostics k = row_count;
  insert into public.prep_bitacora(accion, actor_id, actor, detalle)
  values ('salida_autorizada', p_usuario, n, jsonb_build_object('por', a->>'nombre', 'motivo', p_motivo, 'tandas', k));
  return jsonb_build_object('ok', true, 'por', a->>'nombre', 'tandas', k);
end $function$;

-- ── Panel del encargado: deudas viejas ─────────────────────────────────────
create or replace function public.fn_prep_datos(p_pin_encargado text, p_dias int default 30)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb; v_hoy date := (now() at time zone 'America/El_Salvador')::date; v_desde date := ((now() at time zone 'America/El_Salvador')::date - greatest(coalesce(p_dias,30),1));
begin
  a := public.fn_prep_actor(p_pin_encargado, true);
  if a is null then raise exception 'Ese PIN no puede ver los datos.'; end if;
  return jsonb_build_object(
    'lotes', (select count(*) from public.prep_lotes where estado = 'cerrado' and fecha >= v_desde),
    'deudas_abiertas', (select count(*) from public.prep_deudas where estado = 'abierta'),
    'deudas_viejas', coalesce((select jsonb_agg(jsonb_build_object('nombre', d.usuario_nombre, 'lote', d.lote, 'fecha', d.fecha, 'dias', v_hoy - d.fecha,
         'productos', coalesce((select jsonb_agg(distinct e.producto) from public.etiqueta_impresiones e where e.lote_id = d.lote_id), '[]'::jsonb)) order by d.fecha)
         from public.prep_deudas d where d.estado = 'abierta' and d.fecha < v_hoy), '[]'::jsonb),
    'insumos', coalesce((select jsonb_agg(x order by abs(coalesce(x.prom,1) - 1) desc) from (
        select i.receta_id, i.codigo, max(i.insumo) as insumo,
               count(*) filter (where i.ratio is not null) as n,
               round(avg(i.ratio)::numeric, 3) as prom, min(i.ratio) as minimo, max(i.ratio) as maximo,
               count(*) filter (where i.falto) as faltas, count(*) filter (where i.fuera_receta) as fuera
          from public.prep_lote_insumos i join public.prep_lotes l on l.id = i.lote_id
         where i.vigente and l.estado = 'cerrado' and l.fecha >= v_desde
         group by i.receta_id, i.codigo) x), '[]'::jsonb),
    'personas', coalesce((select jsonb_agg(p) from (
        select i.usuario_nombre as nombre, count(distinct i.lote_id) as lotes,
               count(*) filter (where i.ratio is not null) as registros,
               count(*) filter (where i.ratio is not null and abs(i.ratio - 1) <= 0.02) as exactos
          from public.prep_lote_insumos i join public.prep_lotes l on l.id = i.lote_id
         where i.vigente and l.estado = 'cerrado' and l.fecha >= v_desde
         group by i.usuario_nombre) p), '[]'::jsonb),
    'bitacora', coalesce((select jsonb_agg(b) from (
        select to_char(momento at time zone 'America/El_Salvador', 'DD-Mon HH24:MI') as hora, accion, actor, detalle
          from public.prep_bitacora order by momento desc limit 30) b), '[]'::jsonb)
  );
end $function$;
