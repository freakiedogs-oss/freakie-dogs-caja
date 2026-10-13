-- Aplicada vía MCP el 4-oct-2026. Ver memoria.md («Turno de Casa Matriz» para Kevin).
-- Panel de solo lectura: entrada/salida, lo impreso por persona y si cada producto ya tiene insumos.
create or replace function public.fn_prep_turno(p_actor uuid, p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rol text; v_store text;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/El_Salvador')::date);
  v_res jsonb;
begin
  select u.rol, u.store_code into v_rol, v_store from usuarios_erp u where u.id = p_actor and u.activo;
  if v_rol is null or v_rol not in ('jefe_casa_matriz','admin','superadmin','ejecutivo') then
    raise exception 'Este panel es para encargados de Casa Matriz.';
  end if;
  -- Gerencia no está asignada a Casa Matriz, pero lo que mira es Casa Matriz.
  if coalesce(v_store,'') not like 'CM%' then v_store := 'CM001'; end if;

  with
  gente as (
    select u.id from usuarios_erp u
     where u.activo and u.store_code = v_store and u.rol in ('produccion','despachador')
    union
    select a.usuario_id from asistencia a where a.fecha = v_fecha and a.sucursal = v_store
    union
    select e.usuario_id from etiqueta_impresiones e where e.fecha = v_fecha
    union
    select d.usuario_id from prep_deudas d
      join prep_lotes l on l.id = d.lote_id
     where l.fecha = v_fecha
  ),
  impreso as (
    select e.usuario_id, e.lote_id, e.producto_id,
           max(coalesce(p.clave, e.producto_id)) clave,
           coalesce(max(p.nombre), max(e.producto)) nombre,
           sum(e.unidades) unidades, round(sum(coalesce(e.gramos,0))) gramos,
           min(e.impreso_at) primera, max(e.impreso_at) ultima
      from etiqueta_impresiones e
      left join etiquetado_productos p on (p.id::text = e.producto_id or p.clave = e.producto_id)
     where e.fecha = v_fecha
     group by e.usuario_id, e.lote_id, e.producto_id
  ),
  -- Quién registró los insumos de cada producto impreso, con la misma regla
  -- de receta que exige el cierre del lote.
  registro as (
    select i.usuario_id, i.lote_id, i.producto_id,
           (select string_agg(distinct li.usuario_nombre, ', ')
              from prep_lote_insumos li
             where li.lote_id = i.lote_id and li.vigente and not li.falto and li.cantidad is not null
               and li.receta_id in (i.clave, case when i.clave = 'pepinillotritura' then 'pepinillo' else '-' end,
                                    'prod-' || i.producto_id)) por,
           (select min(li.created_at)
              from prep_lote_insumos li
             where li.lote_id = i.lote_id and li.vigente and not li.falto and li.cantidad is not null
               and li.receta_id in (i.clave, case when i.clave = 'pepinillotritura' then 'pepinillo' else '-' end,
                                    'prod-' || i.producto_id)) cuando
      from impreso i
  ),
  prod_persona as (
    select i.usuario_id,
           jsonb_agg(jsonb_build_object(
             'clave', i.clave, 'nombre', i.nombre, 'unidades', i.unidades, 'gramos', i.gramos,
             'primera', i.primera, 'ultima', i.ultima,
             'lote', l.lote, 'lote_estado', l.estado,
             'registrado', r.por is not null,
             'registrado_por', r.por, 'registrado_at', r.cuando,
             -- Si el lote lo debe otra persona (traspaso), quién.
             'debe', (select d.usuario_nombre from prep_deudas d
                       where d.lote_id = i.lote_id and d.estado = 'abierta' limit 1),
             'autorizado', (select jsonb_build_object('por', d.autorizada_por, 'motivo', d.motivo)
                              from prep_deudas d
                             where d.lote_id = i.lote_id and d.estado = 'autorizada' limit 1)
           ) order by (r.por is not null), i.nombre) productos,
           count(*) filter (where r.por is null) pendientes,
           count(*) filter (where r.por is not null) registrados
      from impreso i
      join registro r on r.usuario_id = i.usuario_id and r.lote_id is not distinct from i.lote_id
                     and r.producto_id = i.producto_id
      left join prep_lotes l on l.id = i.lote_id
     group by i.usuario_id
  ),
  -- Lotes que esta persona recibió de un compañero y todavía debe.
  recibidos as (
    select d.usuario_id, jsonb_agg(jsonb_build_object('lote', d.lote, 'de', d.traspasada_de)) lista
      from prep_deudas d
     where d.estado = 'abierta' and d.traspasada_de is not null
     group by d.usuario_id
  ),
  viejas as (
    select d.usuario_id, count(*) n
      from prep_deudas d
     where d.estado = 'abierta' and d.fecha < v_fecha
     group by d.usuario_id
  ),
  fila as (
    select u.id, trim(concat_ws(' ', u.nombre, u.apellido)) nombre, u.rol,
           a.hora_entrada entrada, a.hora_salida salida, a.minutos_tarde,
           coalesce(pp.productos, '[]'::jsonb) productos,
           coalesce(pp.pendientes, 0) pendientes, coalesce(pp.registrados, 0) registrados,
           coalesce(rc.lista, '[]'::jsonb) recibidos,
           coalesce(v.n, 0) deudas_viejas
      from gente g
      join usuarios_erp u on u.id = g.id
      left join lateral (select * from asistencia a where a.usuario_id = u.id and a.fecha = v_fecha
                          order by a.hora_entrada desc nulls last limit 1) a on true
      left join prod_persona pp on pp.usuario_id = u.id
      left join recibidos rc on rc.usuario_id = u.id
      left join viejas v on v.usuario_id = u.id
  )
  select jsonb_build_object(
    'fecha', v_fecha, 'store', v_store, 'generado', now(),
    'resumen', jsonb_build_object(
      'presentes',  (select count(*) from fila where entrada is not null and salida is null),
      'salieron',   (select count(*) from fila where salida is not null),
      'imprimieron',(select count(*) from fila where jsonb_array_length(productos) > 0),
      'productos_pendientes', (select coalesce(sum(pendientes),0) from fila),
      'productos_registrados',(select coalesce(sum(registrados),0) from fila),
      'personas_con_pendientes', (select count(*) from fila where pendientes > 0)),
    'personas', coalesce((select jsonb_agg(to_jsonb(f) order by
        (f.pendientes > 0) desc,
        (f.salida is not null and f.pendientes > 0) desc,
        (f.entrada is not null and f.salida is null) desc,
        f.nombre) from fila f), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $$;

grant execute on function public.fn_prep_turno(uuid, date) to anon, authenticated;

-- El Sidebar ignora config.js cuando permisos_rol tiene filas.
insert into permisos_rol (rol, nav_key)
values ('jefe_casa_matriz','turno-cm'), ('admin','turno-cm'), ('ejecutivo','turno-cm'), ('superadmin','turno-cm')
on conflict (rol, nav_key) do nothing;
