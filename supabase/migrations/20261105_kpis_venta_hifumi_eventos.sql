-- KPIs de Venta: Hifumi (delivery_app) y Eventos (tipo evento) entran como canales propios.
-- Eventos: desde junio el módulo aparte de eventos no registra ventas; las de eventos
-- se cobran en el POS con tipo = 'evento' en la sucursal real. La sucursal EVT01 sigue
-- fuera (no tiene ninguna cuenta cobrada).
-- La curva del día cuenta Hifumi pero no eventos (son ventas sueltas que deformarían
-- el ritmo de un día normal).

create or replace view public.v_kpis_venta_canal as
 SELECT qo.fecha,
    qo.store_code,
    s.nombre AS sucursal_nombre,
    s.tipo AS sucursal_tipo,
    qo.canal_venta,
    count(*) AS ordenes,
    (sum(qo.total_pagar))::numeric(12,2) AS monto,
    round(avg(qo.total_pagar), 2) AS ticket_prom,
    (sum(qo.propina))::numeric(12,2) AS propina,
    (sum(qo.total_iva))::numeric(12,2) AS iva
   FROM (quanto_ordenes qo
     LEFT JOIN sucursales s ON ((s.store_code = qo.store_code)))
  WHERE ((qo.store_code = ANY (ARRAY['M001'::text, 'S001'::text, 'S002'::text, 'S003'::text, 'S004'::text])) AND (qo.canal_venta IS NOT NULL) AND (qo.fecha < '2026-08-01'::date) AND (NOT ((qo.store_code = 'M001'::text) AND (qo.fecha >= '2026-07-22'::date))) AND (NOT ((qo.store_code = 'S002'::text) AND (qo.fecha >= '2026-07-24'::date))) AND (NOT ((qo.store_code = 'S004'::text) AND (qo.fecha >= '2026-07-26'::date))))
  GROUP BY qo.fecha, qo.store_code, s.nombre, s.tipo, qo.canal_venta
UNION ALL
 SELECT ((c.cobrada_at AT TIME ZONE 'America/El_Salvador'::text))::date AS fecha,
    c.store_code,
    s.nombre AS sucursal_nombre,
    s.tipo AS sucursal_tipo,
        CASE c.tipo
            WHEN 'mesa'::text THEN 'mesa'::text
            WHEN 'para_llevar'::text THEN 'para_llevar'::text
            WHEN 'llevar'::text THEN 'para_llevar'::text
            WHEN 'delivery'::text THEN 'delivery_propio'::text
            WHEN 'delivery_propio'::text THEN 'delivery_propio'::text
            WHEN 'drivethrough'::text THEN 'drivethrough'::text
            WHEN 'drive_through'::text THEN 'drivethrough'::text
            WHEN 'pedidos_ya'::text THEN 'pedidos_ya'::text
            WHEN 'delivery_app'::text THEN 'delivery_app'::text
            WHEN 'evento'::text THEN 'evento'::text
            ELSE NULL::text
        END AS canal_venta,
    count(*) AS ordenes,
    (sum(c.total))::numeric(12,2) AS monto,
    round(avg(c.total), 2) AS ticket_prom,
    (sum(COALESCE(c.propina, (0)::numeric)))::numeric(12,2) AS propina,
    (0)::numeric(12,2) AS iva
   FROM (pos_cuentas c
     LEFT JOIN sucursales s ON ((s.store_code = c.store_code)))
  WHERE ((c.estado = 'cobrada'::text) AND (c.tipo = ANY (ARRAY['mesa'::text, 'para_llevar'::text, 'llevar'::text, 'delivery'::text, 'delivery_propio'::text, 'drivethrough'::text, 'drive_through'::text, 'pedidos_ya'::text, 'delivery_app'::text, 'evento'::text])) AND (c.store_code <> 'EVT01'::text) AND ((((c.cobrada_at AT TIME ZONE 'America/El_Salvador'::text))::date >= '2026-08-01'::date) OR ((c.store_code <> ALL (ARRAY['S001'::text, 'S003'::text])) AND (NOT ((c.store_code = 'S004'::text) AND (((c.cobrada_at AT TIME ZONE 'America/El_Salvador'::text))::date < '2026-07-26'::date))))))
  GROUP BY (((c.cobrada_at AT TIME ZONE 'America/El_Salvador'::text))::date), c.store_code, s.nombre, s.tipo,
        CASE c.tipo
            WHEN 'mesa'::text THEN 'mesa'::text
            WHEN 'para_llevar'::text THEN 'para_llevar'::text
            WHEN 'llevar'::text THEN 'para_llevar'::text
            WHEN 'delivery'::text THEN 'delivery_propio'::text
            WHEN 'delivery_propio'::text THEN 'delivery_propio'::text
            WHEN 'drivethrough'::text THEN 'drivethrough'::text
            WHEN 'drive_through'::text THEN 'drivethrough'::text
            WHEN 'pedidos_ya'::text THEN 'pedidos_ya'::text
            WHEN 'delivery_app'::text THEN 'delivery_app'::text
            WHEN 'evento'::text THEN 'evento'::text
            ELSE NULL::text
        END;


-- Top Items también cuenta Hifumi y eventos.
CREATE OR REPLACE FUNCTION public.obtener_top_items_venta(p_usuario_id uuid, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date)
 RETURNS TABLE(store_code text, nombre text, cantidad bigint, monto numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public._rol_usuario(p_usuario_id, 'los top items de venta');
  return query
  with cta as (
    select c.id, c.store_code, (c.cobrada_at at time zone 'America/El_Salvador')::date as d
    from public.pos_cuentas c
    where c.estado = 'cobrada'
      and c.tipo in ('mesa','para_llevar','llevar','delivery','delivery_propio','drivethrough','drive_through','pedidos_ya','delivery_app','evento')
      and c.store_code <> 'EVT01'
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

-- Curva del día: + Hifumi.
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
