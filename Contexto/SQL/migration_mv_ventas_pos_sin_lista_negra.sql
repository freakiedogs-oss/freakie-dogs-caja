-- migration_mv_ventas_pos_sin_lista_negra.sql
-- Fecha: 2026-07-27
-- Aplicada a Supabase (btboxlwfqcbrdfrlnwln, schema public) via apply_migration.
--
-- PROBLEMA:
--   La matview mv_finanzas_ventas_mensual (fuente del P&L en FinanzasDashboard.jsx)
--   tenia una LISTA NEGRA hardcodeada en la rama 'pos':
--       WHERE pos.store_code <> ALL (ARRAY['M001','S001','S002','S003','S004','EVT01'])
--   Eso asumia que esas 5 sucursales SIEMPRE venden por Quanto y solo el resto (S006)
--   por POS interno. Pero durante Julio-2026 M001, S001, S002 y S004 migraron del
--   POS Quanto al POS interno; Quanto deja de capturar el dia de la migracion y el
--   POS interno arranca al siguiente => esas ventas post-migracion caian en la lista
--   negra y se PERDIAN del P&L (~$22,982 c/IVA solo en Julio, creciendo cada dia).
--
-- FIX:
--   Se quita la lista de sucursales; se mantiene solo la exclusion de EVT01 (eventos,
--   que se suman aparte desde la tabla `eventos` y si doblarian). Quanto y POS interno
--   registran ventas DISJUNTAS (no la misma venta), por lo que sumarlas via UNION es
--   correcto y no genera doble conteo. Asi, cualquier sucursal que migre al POS interno
--   entra automaticamente sin volver a editar la matview.
--
-- Se preserva el UNIQUE INDEX (mes, store_code, fuente) que habilita el
-- REFRESH MATERIALIZED VIEW CONCURRENTLY usado por fn_refresh_pl / boton "Refrescar P&L".

DROP MATERIALIZED VIEW IF EXISTS public.mv_finanzas_ventas_mensual;

CREATE MATERIALIZED VIEW public.mv_finanzas_ventas_mensual AS
 SELECT date_trunc('month'::text, q.fecha::timestamp with time zone)::date AS mes,
    COALESCE(q.store_code, '_TODAS'::text) AS store_code,
    'quanto'::text AS fuente,
    sum(q.total_ventas) AS total_ventas,
    sum(q.total_sin_iva) AS total_sin_iva,
    sum(q.venta_neta) AS venta_neta,
    sum(q.propina_cobrada) AS propina_cobrada,
    sum(q.iva_recaudado) AS iva_recaudado,
    sum(q.efectivo) AS efectivo,
    sum(q.tarjeta) AS tarjeta,
    sum(q.otros) AS otros,
    count(*) AS num_dias,
    0::numeric AS num_pedidos
   FROM v_quanto_ordenes_diario q
  WHERE q.fecha >= '2026-01-01'::date AND q.store_code <> 'EVT01'::text
  GROUP BY (date_trunc('month'::text, q.fecha::timestamp with time zone)::date), (COALESCE(q.store_code, '_TODAS'::text))
UNION ALL
 SELECT date_trunc('month'::text, pp.fecha_pedido::date::timestamp with time zone)::date AS mes,
    COALESCE(pp.store_code, '_TODAS'::text) AS store_code,
    'peya'::text AS fuente,
    sum(pp.total_pedido) AS total_ventas,
    sum(pp.total_pedido / 1.13) AS total_sin_iva,
    sum(pp.total_pedido / 1.13) AS venta_neta,
    0::numeric AS propina_cobrada,
    sum(pp.total_pedido - pp.total_pedido / 1.13) AS iva_recaudado,
    0::numeric AS efectivo,
    0::numeric AS tarjeta,
    0::numeric AS otros,
    0::bigint AS num_dias,
    count(*) AS num_pedidos
   FROM pedidos_peya pp
  WHERE pp.estado = 'Entregado'::text AND pp.fecha_pedido >= '2026-01-01 00:00:00+00'::timestamp with time zone
  GROUP BY (date_trunc('month'::text, pp.fecha_pedido::date::timestamp with time zone)::date), (COALESCE(pp.store_code, '_TODAS'::text))
UNION ALL
 SELECT date_trunc('month'::text, pos.fecha::timestamp with time zone)::date AS mes,
    COALESCE(pos.store_code, '_TODAS'::text) AS store_code,
    'pos'::text AS fuente,
    sum(pos.total_ventas) AS total_ventas,
    sum(pos.total_sin_iva) AS total_sin_iva,
    sum(pos.venta_neta) AS venta_neta,
    sum(pos.propina_cobrada) AS propina_cobrada,
    sum(pos.iva_recaudado) AS iva_recaudado,
    sum(pos.efectivo) AS efectivo,
    sum(pos.tarjeta) AS tarjeta,
    sum(pos.otros) AS otros,
    count(*) AS num_dias,
    sum(pos.num_ordenes) AS num_pedidos
   FROM v_pos_ventas_diario pos
  WHERE pos.fecha >= '2026-01-01'::date AND pos.store_code <> 'EVT01'::text
  GROUP BY (date_trunc('month'::text, pos.fecha::timestamp with time zone)::date), (COALESCE(pos.store_code, '_TODAS'::text))
  ORDER BY 1, 2, 3
WITH DATA;

CREATE UNIQUE INDEX uq_mv_finanzas_ventas_mensual
  ON public.mv_finanzas_ventas_mensual USING btree (mes, store_code, fuente);

-- IMPORTANTE: DROP MATERIALIZED VIEW borra los GRANT. La app lee via rol anon
-- (proxy /sb); sin este SELECT el dashboard recibe 0 filas y muestra ventas en $0.
GRANT SELECT ON public.mv_finanzas_ventas_mensual TO anon, authenticated;
