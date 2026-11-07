-- KPIs de Venta · ritmo del día
-- Para cada sucursal (y la cadena, store_code = 'TOTAL'), qué porcentaje de la
-- venta de un día se hace normalmente antes de la hora actual. Sale de las
-- cuentas cobradas en el POS de los últimos 8 días de la misma semana (mismo
-- día de la semana que hoy), sin contar hoy.
-- El dashboard multiplica ese % por la meta del día para decir cuánto debería
-- llevar vendido el gerente a esta hora.

create or replace function public.obtener_curva_venta_dia(p_usuario_id uuid)
returns table(
  store_code text,
  pct_esperado numeric,   -- 0..1: parte de la venta del día que se hace antes de ahora
  hora_fin text,          -- hora típica de la última venta (HH:MI, hora local)
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
begin
  perform public._rol_usuario(p_usuario_id, 'los KPIs de venta');
  return query
  with c as (
    select pc.store_code as sc,
           (pc.cobrada_at at time zone 'America/El_Salvador') as t,
           pc.total
    from pos_cuentas pc
    where pc.estado = 'cobrada'
      and pc.store_code <> 'EVT01'
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

grant execute on function public.obtener_curva_venta_dia(uuid) to anon, authenticated;
