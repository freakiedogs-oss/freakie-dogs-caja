-- Ajustes del encargado, datos para el panel y salida con el flag de bloqueo.
-- (fn_salida_pendientes se redefine: ahora devuelve {bloquear, pendientes}.)

create or replace function public.fn_prep_ajustes()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select valor from public.prep_config where clave = 'ajustes'), '{}'::jsonb)
$function$;

create or replace function public.fn_prep_ajustes_guardar(p_pin_encargado text, p_valor jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb;
begin
  a := public.fn_prep_actor(p_pin_encargado, true);
  if a is null then raise exception 'Ese PIN no puede cambiar los ajustes.'; end if;
  insert into public.prep_config(clave, valor, updated_by) values ('ajustes', coalesce(p_valor, '{}'::jsonb), a->>'nombre')
  on conflict (clave) do update set valor = excluded.valor, updated_by = excluded.updated_by, updated_at = now();
  insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('ajustes', (a->>'id')::uuid, a->>'nombre', p_valor);
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.fn_prep_datos(p_pin_encargado text, p_dias int default 30)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb; v_desde date := ((now() at time zone 'America/El_Salvador')::date - greatest(coalesce(p_dias,30),1));
begin
  a := public.fn_prep_actor(p_pin_encargado, true);
  if a is null then raise exception 'Ese PIN no puede ver los datos.'; end if;
  return jsonb_build_object(
    'lotes', (select count(*) from public.prep_lotes where estado = 'cerrado' and fecha >= v_desde),
    'deudas_abiertas', (select count(*) from public.prep_deudas where estado = 'abierta'),
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

create or replace function public.fn_salida_pendientes(p_usuario uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'bloquear', coalesce((select (valor->>'bloquearSalida')::boolean from public.prep_config where clave = 'ajustes'), true),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'lote_id', d.lote_id, 'lote', d.lote, 'fecha', d.fecha,
      'productos', coalesce((select jsonb_agg(distinct e.producto) from public.etiqueta_impresiones e where e.lote_id = d.lote_id and e.usuario_id = d.usuario_id), '[]'::jsonb)
    ) order by d.created_at) from public.prep_deudas d where d.usuario_id = p_usuario and d.estado = 'abierta'), '[]'::jsonb)
  )
$function$;

grant execute on function public.fn_prep_ajustes() to anon, authenticated;
grant execute on function public.fn_prep_ajustes_guardar(text, jsonb) to anon, authenticated;
grant execute on function public.fn_prep_datos(text, int) to anon, authenticated;
