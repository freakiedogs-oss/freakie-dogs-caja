-- Funciones de la estación de preparación (ver 20261003_prep_lotes_tablas.sql).
-- Nota: las funciones no llevan DELETE/DROP/pg_sleep a propósito.

-- ── Identificar por PIN ───────────────────────────────────────────────────
-- Mismo freno de intentos que erp_login (cuenta fallos en login_intentos). Sin
-- pausas ni limpieza aquí: erp_login ya limpia la tabla, y evitamos sentencias
-- destructivas dentro de las funciones.
create or replace function public.fn_prep_actor(p_pin text, p_solo_encargado boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v record;
  v_ok boolean;
begin
  if p_pin is null or length(btrim(p_pin)) < 3 then return null; end if;
  if (select count(*) from public.login_intentos where not exito and momento > now() - interval '10 minutes') >= 25 then
    raise exception 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';
  end if;
  select u.id, u.nombre, u.apellido, u.rol, u.store_code into v
  from public.usuarios_erp u
  where u.pin = btrim(p_pin) and u.activo
    and ((p_solo_encargado and u.rol in ('jefe_casa_matriz','admin','superadmin','ejecutivo'))
      or (not p_solo_encargado and u.rol in ('produccion','despachador','jefe_casa_matriz','admin','superadmin','ejecutivo')))
  limit 1;
  v_ok := found;
  insert into public.login_intentos(exito) values (v_ok);
  if not v_ok then return null; end if;
  return jsonb_build_object('id', v.id, 'nombre', trim(concat_ws(' ', v.nombre, v.apellido)), 'rol', v.rol, 'store_code', v.store_code);
end $function$;

-- Verifica que un id de usuario exista y esté activo (para las funciones que
-- reciben el id que fn_prep_actor ya entregó).
create or replace function public._prep_nombre(p_usuario uuid)
returns text language sql stable security definer set search_path to 'public'
as $function$ select trim(concat_ws(' ', nombre, apellido)) from public.usuarios_erp where id = p_usuario and activo $function$;

-- ── Catálogo ───────────────────────────────────────────────────────────────
create or replace function public.fn_prep_catalogo()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'catalogo', (select valor from public.prep_config where clave = 'catalogo'),
    'alias',    coalesce((select jsonb_object_agg(codigo, insumo_codigo) from public.prep_alias), '{}'::jsonb),
    'nuevos',   coalesce((select jsonb_agg(jsonb_build_object('code', codigo, 'nombre', nombre, 'cat', coalesce(categoria,'Otro'),
                  'pieza', coalesce(unidad,'unidad'), 'discreto', discreto, 'nuevo', true, 'unit', unidad))
                  from public.prep_insumos_nuevos where estado <> 'descartado'), '[]'::jsonb)
  )
$function$;

create or replace function public.fn_prep_alias_guardar(p_usuario uuid, p_codigo text, p_insumo_codigo text)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare n text := public._prep_nombre(p_usuario);
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  insert into public.prep_alias(codigo, insumo_codigo, usuario_nombre) values (upper(btrim(p_codigo)), p_insumo_codigo, n)
  on conflict (codigo) do update set insumo_codigo = excluded.insumo_codigo, usuario_nombre = excluded.usuario_nombre;
  insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('alias', p_usuario, n, jsonb_build_object('codigo', p_codigo, 'insumo', p_insumo_codigo));
  return true;
end $function$;

create or replace function public.fn_prep_insumo_nuevo(p_usuario uuid, p_codigo text, p_nombre text, p_categoria text, p_unidad text, p_discreto boolean)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare n text := public._prep_nombre(p_usuario);
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  insert into public.prep_insumos_nuevos(codigo, nombre, categoria, unidad, discreto, usuario_id, usuario_nombre)
  values (upper(btrim(p_codigo)), btrim(p_nombre), p_categoria, p_unidad, coalesce(p_discreto,false), p_usuario, n)
  on conflict (codigo) do nothing;
  insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('insumo_nuevo', p_usuario, n, jsonb_build_object('codigo', p_codigo, 'nombre', p_nombre));
  return true;
end $function$;

-- ── Lotes ──────────────────────────────────────────────────────────────────
create or replace function public.fn_prep_lote_abrir(p_usuario uuid, p_recetas jsonb default '[]'::jsonb, p_sin_preparacion boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_fecha date := (now() at time zone 'America/El_Salvador')::date;
  v_n int; v_lote text; v_id uuid;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  perform pg_advisory_xact_lock(hashtext('prep_lote_' || v_fecha::text));
  select coalesce(max(substring(lote from 3)::int), 0) + 1 into v_n from public.prep_lotes where fecha = v_fecha and lote ~ '^L-[0-9]+$';
  v_lote := 'L-' || lpad(v_n::text, 4, '0');
  insert into public.prep_lotes(lote, fecha, recetas, creado_por, creado_nombre, sin_preparacion)
  values (v_lote, v_fecha, coalesce(p_recetas,'[]'::jsonb), p_usuario, n, p_sin_preparacion)
  returning id into v_id;
  insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('lote_abierto', p_usuario, n, jsonb_build_object('lote', v_lote, 'sin_preparacion', p_sin_preparacion));
  return jsonb_build_object('id', v_id, 'lote', v_lote, 'fecha', v_fecha);
end $function$;

-- Guarda los insumos de un lote. p_cerrar = true lo cierra y salda las deudas
-- abiertas de ese lote. Corregir = guardar de nuevo: la versión anterior queda
-- con vigente=false (historial), no se borra.
create or replace function public.fn_prep_lote_guardar(p_usuario uuid, p_lote_id uuid, p_recetas jsonb, p_insumos jsonb, p_cerrar boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_lote record; v_saldadas int := 0;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  select * into v_lote from public.prep_lotes where id = p_lote_id;
  if not found then raise exception 'Ese lote no existe.'; end if;

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
    update public.prep_deudas set estado = 'cerrada', cerrada_at = now()
     where lote_id = p_lote_id and estado = 'abierta';
    get diagnostics v_saldadas = row_count;
  end if;

  insert into public.prep_bitacora(accion, actor_id, actor, detalle)
  values (case when p_cerrar then 'lote_cerrado' else 'lote_guardado' end, p_usuario, n,
          jsonb_build_object('lote', v_lote.lote, 'insumos', jsonb_array_length(coalesce(p_insumos,'[]'::jsonb)), 'deudas_saldadas', v_saldadas));
  return jsonb_build_object('ok', true, 'lote', v_lote.lote, 'deudas_saldadas', v_saldadas);
end $function$;

create or replace function public.fn_prep_lote_get(p_lote_id uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'lote', to_jsonb(l),
    'insumos', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.prep_lote_insumos i where i.lote_id = l.id and i.vigente), '[]'::jsonb))
  from public.prep_lotes l where l.id = p_lote_id
$function$;

create or replace function public.fn_prep_lotes_hoy()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'lote', l.lote, 'estado', l.estado, 'recetas', l.recetas, 'sin_preparacion', l.sin_preparacion,
    'creado_nombre', l.creado_nombre,
    'insumos', (select count(*) from public.prep_lote_insumos i where i.lote_id = l.id and i.vigente and not i.falto)
  ) order by l.lote desc), '[]'::jsonb)
  from public.prep_lotes l
  where l.fecha >= ((now() at time zone 'America/El_Salvador')::date - 1)
$function$;

-- ── Impresión de etiquetas ─────────────────────────────────────────────────
-- Siempre registra. Si el lote no está cerrado (sin insumos registrados),
-- abre una deuda a nombre de quien imprimió. Nunca rechaza la impresión.
create or replace function public.fn_etiqueta_registrar(p_usuario uuid, p_lote_id uuid, p_producto_id text, p_producto text, p_unidades int default 1)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_lote record; v_con boolean; v_deuda boolean := false;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  select * into v_lote from public.prep_lotes where id = p_lote_id;
  if not found then raise exception 'Ese lote no existe.'; end if;
  v_con := (v_lote.estado = 'cerrado');

  insert into public.etiqueta_impresiones(lote_id, lote, fecha, producto_id, producto, unidades, usuario_id, usuario_nombre, con_insumos)
  values (v_lote.id, v_lote.lote, v_lote.fecha, p_producto_id, p_producto, greatest(coalesce(p_unidades,1),1), p_usuario, n, v_con);

  if not v_con and not exists (select 1 from public.prep_deudas where lote_id = v_lote.id and usuario_id = p_usuario and estado = 'abierta') then
    insert into public.prep_deudas(lote_id, lote, fecha, usuario_id, usuario_nombre) values (v_lote.id, v_lote.lote, v_lote.fecha, p_usuario, n);
    v_deuda := true;
    insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('deuda_abierta', p_usuario, n, jsonb_build_object('lote', v_lote.lote, 'producto', p_producto));
  end if;
  return jsonb_build_object('con_insumos', v_con, 'deuda_nueva', v_deuda);
end $function$;

-- ── Salida (Mi Asistencia) ─────────────────────────────────────────────────
create or replace function public.fn_salida_pendientes(p_usuario uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'lote_id', d.lote_id, 'lote', d.lote, 'fecha', d.fecha,
    'productos', coalesce((select jsonb_agg(distinct e.producto) from public.etiqueta_impresiones e where e.lote_id = d.lote_id and e.usuario_id = d.usuario_id), '[]'::jsonb)
  ) order by d.created_at), '[]'::jsonb)
  from public.prep_deudas d where d.usuario_id = p_usuario and d.estado = 'abierta'
$function$;

create or replace function public.fn_salida_traspasar(p_deuda uuid, p_pin_receptor text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb; d record;
begin
  a := public.fn_prep_actor(p_pin_receptor, false);
  if a is null then raise exception 'Ese PIN no es válido.'; end if;
  select * into d from public.prep_deudas where id = p_deuda and estado = 'abierta';
  if not found then raise exception 'Esa tanda ya no está pendiente.'; end if;
  if (a->>'id')::uuid = d.usuario_id then raise exception 'Tiene que ser otra persona.'; end if;
  update public.prep_deudas set usuario_id = (a->>'id')::uuid, usuario_nombre = a->>'nombre', traspasada_de = d.usuario_nombre where id = p_deuda;
  insert into public.prep_bitacora(accion, actor_id, actor, detalle)
  values ('deuda_traspasada', d.usuario_id, d.usuario_nombre, jsonb_build_object('lote', d.lote, 'a', a->>'nombre'));
  return jsonb_build_object('ok', true, 'nombre', a->>'nombre');
end $function$;

create or replace function public.fn_salida_autorizar(p_usuario uuid, p_pin_encargado text, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb; n text := public._prep_nombre(p_usuario); k int;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  if coalesce(btrim(p_motivo),'') = '' then raise exception 'Falta el motivo.'; end if;
  a := public.fn_prep_actor(p_pin_encargado, true);
  if a is null then raise exception 'Ese PIN no puede autorizar salidas.'; end if;
  update public.prep_deudas set estado = 'autorizada', autorizada_por = a->>'nombre', motivo = btrim(p_motivo), cerrada_at = now()
   where usuario_id = p_usuario and estado = 'abierta';
  get diagnostics k = row_count;
  insert into public.prep_bitacora(accion, actor_id, actor, detalle)
  values ('salida_autorizada', p_usuario, n, jsonb_build_object('por', a->>'nombre', 'motivo', p_motivo, 'tandas', k));
  return jsonb_build_object('ok', true, 'por', a->>'nombre', 'tandas', k);
end $function$;

grant execute on function public.fn_prep_actor(text, boolean) to anon, authenticated;
grant execute on function public.fn_prep_catalogo() to anon, authenticated;
grant execute on function public.fn_prep_alias_guardar(uuid, text, text) to anon, authenticated;
grant execute on function public.fn_prep_insumo_nuevo(uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.fn_prep_lote_abrir(uuid, jsonb, boolean) to anon, authenticated;
grant execute on function public.fn_prep_lote_guardar(uuid, uuid, jsonb, jsonb, boolean) to anon, authenticated;
grant execute on function public.fn_prep_lote_get(uuid) to anon, authenticated;
grant execute on function public.fn_prep_lotes_hoy() to anon, authenticated;
grant execute on function public.fn_etiqueta_registrar(uuid, uuid, text, text, int) to anon, authenticated;
grant execute on function public.fn_salida_pendientes(uuid) to anon, authenticated;
grant execute on function public.fn_salida_traspasar(uuid, text) to anon, authenticated;
grant execute on function public.fn_salida_autorizar(uuid, text, text) to anon, authenticated;
