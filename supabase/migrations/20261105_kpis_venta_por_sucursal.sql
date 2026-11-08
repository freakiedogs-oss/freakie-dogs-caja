-- KPIs de Venta: cada gerente ve solo su sucursal.
-- admin, superadmin y ejecutivo ven todas (decisión de Jose, 5-nov: los ejecutivos
-- no tienen sucursal asignada). El filtro va en la base, no solo en la pantalla.

-- null = puede ver todas; si no, el store_code que puede ver.
-- Un gerente sin sucursal asignada recibe '—' y no ve nada.
create or replace function public._kpis_sucursal_permitida(p_usuario_id uuid)
returns text
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rol text; v_sc text;
begin
  v_rol := public._rol_usuario(p_usuario_id, 'los KPIs de venta');
  if v_rol in ('admin', 'superadmin', 'ejecutivo') then
    return null;
  end if;
  select store_code into v_sc from public.usuarios_erp where id = p_usuario_id;
  return coalesce(v_sc, '—');
end;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_kpis_venta_canal(p_usuario_id uuid, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date)
 RETURNS TABLE(fecha date, store_code text, sucursal_nombre text, sucursal_tipo text, canal_venta text, ordenes bigint, monto numeric, ticket_prom numeric, propina numeric, iva numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_sc text := public._kpis_sucursal_permitida(p_usuario_id);
begin
  return query
  select v.fecha, v.store_code, v.sucursal_nombre, v.sucursal_tipo, v.canal_venta,
         v.ordenes, v.monto, v.ticket_prom, v.propina, v.iva
  from v_kpis_venta_canal v
  where (p_fecha_desde is null or v.fecha >= p_fecha_desde)
    and (p_fecha_hasta is null or v.fecha <= p_fecha_hasta)
    and (v_sc is null or v.store_code = v_sc);
end;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_top_items_venta(p_usuario_id uuid, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date)
 RETURNS TABLE(store_code text, nombre text, cantidad bigint, monto numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_sc text;
begin
  perform public._rol_usuario(p_usuario_id, 'los top items de venta');
  v_sc := public._kpis_sucursal_permitida(p_usuario_id);
  return query
  with cta as (
    select c.id, c.store_code, (c.cobrada_at at time zone 'America/El_Salvador')::date as d
    from public.pos_cuentas c
    where c.estado = 'cobrada'
      and c.tipo in ('mesa','para_llevar','llevar','delivery','delivery_propio','drivethrough','drive_through','pedidos_ya','delivery_app','evento')
      and c.store_code <> 'EVT01'
      and (v_sc is null or c.store_code = v_sc)
      and (
        (c.cobrada_at at time zone 'America/El_Salvador')::date >= '2026-08-01'::date
        or ( c.store_code not in ('S001','S003')
             and not (c.store_code='S004' and (c.cobrada_at at time zone 'America/El_Salvador')::date < '2026-07-26'::date) )
      )
  )
  select cta.store_code,
         i.nombre,
         sum(i.cantidad)::bigint          as cantidad,
         sum(i.subtotal)::numeric(12,2)   as monto
  from cta
  join public.pos_cuenta_items i on i.cuenta_id = cta.id
  where (p_fecha_desde is null or cta.d >= p_fecha_desde)
    and (p_fecha_hasta is null or cta.d <= p_fecha_hasta)
    and i.cancelado_por is null
  group by cta.store_code, i.nombre
  order by monto desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_ventas_empleado(p_usuario_id uuid, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date)
 RETURNS TABLE(store_code text, empleado_id uuid, empleado_nombre text, ordenes bigint, monto numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_sc text;
begin
  perform public._rol_usuario(p_usuario_id, 'las ventas por empleado');
  v_sc := public._kpis_sucursal_permitida(p_usuario_id);
  return query
  with base as (
    select c.store_code,
           coalesce(c.mesero_id, c.cajero_id) as emp_id,
           c.total,
           (c.cobrada_at at time zone 'America/El_Salvador')::date as d
    from public.pos_cuentas c
    where c.estado = 'cobrada'
      and c.tipo in ('mesa','para_llevar','llevar','delivery','delivery_propio','drivethrough','drive_through')
      and c.store_code <> 'EVT01'
      and (v_sc is null or c.store_code = v_sc)
  )
  select b.store_code,
         b.emp_id as empleado_id,
         nullif(trim(coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'')), '') as empleado_nombre,
         count(*)::bigint as ordenes,
         sum(b.total)::numeric(12,2) as monto
  from base b
  left join public.usuarios_erp u on u.id = b.emp_id
  where (p_fecha_desde is null or b.d >= p_fecha_desde)
    and (p_fecha_hasta is null or b.d <= p_fecha_hasta)
    and (
      b.d >= '2026-08-01'::date
      or ( b.store_code not in ('S001','S003') and not (b.store_code='S004' and b.d < '2026-07-26'::date) )
    )
  group by b.store_code, b.emp_id, u.nombre, u.apellido
  order by monto desc;
end;
$function$;

-- Los insights de IA hablan de toda la cadena: solo para quien ve todas.
CREATE OR REPLACE FUNCTION public.obtener_insights_kpis(p_usuario_id uuid, p_mes date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, fecha_dia date, mes_analizado date, insights jsonb, modelo text, fecha_generacion timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public._kpis_sucursal_permitida(p_usuario_id) is not null then
    return;
  end if;
  return query
  select i.id, i.fecha_dia, i.mes_analizado, i.insights, i.modelo, i.created_at
  from public.insights_kpis_diarios i
  where (p_mes is null or i.mes_analizado = p_mes)
  order by i.created_at desc;
end;
$function$;

create or replace function public.obtener_curva_venta_dia(p_usuario_id uuid)
returns table(
  store_code text,
  pct_esperado numeric,
  hora_fin text,
  dias_muestra int
)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ahora timestamp := now() at time zone 'America/El_Salvador';
  v_hoy date := v_ahora::date;
  v_hora time := v_ahora::time;
  v_sc text := public._kpis_sucursal_permitida(p_usuario_id);
begin
  return query
  with c as (
    select pc.store_code as sc,
           (pc.cobrada_at at time zone 'America/El_Salvador') as t,
           pc.total
    from pos_cuentas pc
    where pc.estado = 'cobrada'
      and pc.store_code <> 'EVT01'
      and (v_sc is null or pc.store_code = v_sc)
      and pc.tipo in ('mesa','para_llevar','llevar','delivery','delivery_propio','drivethrough','drive_through','pedidos_ya','delivery_app')
      and pc.cobrada_at >= (v_hoy - 56)::timestamp at time zone 'America/El_Salvador'
      and pc.cobrada_at <  v_hoy::timestamp at time zone 'America/El_Salvador'
      and extract(dow from (pc.cobrada_at at time zone 'America/El_Salvador')) = extract(dow from v_hoy)
  ),
  base as (
    select sc, t, total from c
    union all
    select 'TOTAL', t, total from c
  ),
  fin as (
    select b.sc, b.t::date as dia, max(b.t::time) as ultima
    from base b group by 1, 2
  )
  select b.sc,
         round(coalesce(sum(b.total) filter (where b.t::time <= v_hora), 0) / nullif(sum(b.total), 0), 4),
         (select to_char(avg(f.ultima), 'HH24:MI') from fin f where f.sc = b.sc),
         count(distinct b.t::date)::int
  from base b
  group by b.sc;
end;
$function$;

-- Solo se usa desde las funciones de arriba.
revoke execute on function public._kpis_sucursal_permitida(uuid) from public, anon, authenticated;
