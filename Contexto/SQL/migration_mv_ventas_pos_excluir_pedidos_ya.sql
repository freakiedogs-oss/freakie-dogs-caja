-- migration_mv_ventas_pos_excluir_pedidos_ya.sql
-- Fecha: 2026-07-27
-- Aplicada a Supabase (btboxlwfqcbrdfrlnwln, schema public).
--
-- PROBLEMA (doble conteo de PeYa en el P&L):
--   El POS interno registra las ordenes de PedidosYa como pos_cuentas.tipo='pedidos_ya'.
--   Esas ventas entraban en la fuente 'pos' del P&L Y ADEMAS en la fuente 'peya'
--   (archivo pedidos_peya, que es el fidedigno: trae el precio real que paga el cliente
--   aunque PeYa nos liquide menos). => PeYa contada dos veces (~$2,522 c/IVA en julio).
--
-- FIX:
--   Se crea una vista aislada v_pos_ventas_diario_sin_peya (= v_pos_ventas_diario pero
--   excluyendo tipo='pedidos_ya') y la matview del P&L usa esa vista en su rama 'pos'.
--   El archivo PeYa queda como UNICA fuente de la venta PeYa.
--   Se aisla en vista nueva para NO afectar v_ventas_sucursal_diario, que usa
--   v_pos_ventas_diario con su propia logica (cortes por fecha de migracion) y sin
--   archivo PeYa; alli el 'pedidos_ya' del POS es su unica PeYa y NO debe removerse.
--
-- NOTA: DROP MATERIALIZED VIEW borra los GRANT -> re-GRANT anon/authenticated al final.

CREATE OR REPLACE VIEW public.v_pos_ventas_diario_sin_peya AS
 SELECT c.fecha, c.store_code, c.total_ventas,
    round(c.total_ventas / 1.13, 2) AS total_sin_iva,
    round((c.total_ventas - c.propina_cobrada) / 1.13, 2) AS venta_neta,
    c.propina_cobrada,
    round(c.total_ventas - c.total_ventas / 1.13, 2) AS iva_recaudado,
    COALESCE(p.efectivo, 0::numeric) AS efectivo,
    COALESCE(p.tarjeta, 0::numeric) AS tarjeta,
    COALESCE(p.otros, 0::numeric) AS otros,
    c.num_ordenes
   FROM ( SELECT (pos_cuentas.cobrada_at AT TIME ZONE 'America/El_Salvador'::text)::date AS fecha,
            pos_cuentas.store_code,
            round(sum(pos_cuentas.total), 2) AS total_ventas,
            round(sum(COALESCE(pos_cuentas.propina, 0::numeric)), 2) AS propina_cobrada,
            count(*) AS num_ordenes
           FROM pos_cuentas
          WHERE pos_cuentas.estado = 'cobrada'::text
            AND pos_cuentas.tipo IS DISTINCT FROM 'pedidos_ya'::text
          GROUP BY ((pos_cuentas.cobrada_at AT TIME ZONE 'America/El_Salvador'::text)::date), pos_cuentas.store_code) c
     LEFT JOIN ( SELECT (c2.cobrada_at AT TIME ZONE 'America/El_Salvador'::text)::date AS fecha,
            c2.store_code,
            round(sum(pg.monto) FILTER (WHERE lower(pg.metodo) = 'efectivo'::text), 2) AS efectivo,
            round(sum(pg.monto) FILTER (WHERE lower(pg.metodo) = 'tarjeta'::text), 2) AS tarjeta,
            round(sum(pg.monto) FILTER (WHERE lower(pg.metodo) <> ALL (ARRAY['efectivo'::text, 'tarjeta'::text])), 2) AS otros
           FROM pos_cuentas c2
             JOIN pos_cuenta_pagos pg ON pg.cuenta_id = c2.id
          WHERE c2.estado = 'cobrada'::text
            AND c2.tipo IS DISTINCT FROM 'pedidos_ya'::text
          GROUP BY ((c2.cobrada_at AT TIME ZONE 'America/El_Salvador'::text)::date), c2.store_code) p
     ON p.fecha = c.fecha AND p.store_code = c.store_code;

GRANT SELECT ON public.v_pos_ventas_diario_sin_peya TO anon, authenticated;

-- Recrear la matview del P&L: la rama 'pos' ahora lee v_pos_ventas_diario_sin_peya.
-- (Cuerpo identico a migration_mv_ventas_pos_sin_lista_negra.sql salvo el FROM de 'pos'.)
DROP MATERIALIZED VIEW IF EXISTS public.mv_finanzas_ventas_mensual;
CREATE MATERIALIZED VIEW public.mv_finanzas_ventas_mensual AS
 SELECT date_trunc('month'::text, q.fecha::timestamp with time zone)::date AS mes,
    COALESCE(q.store_code, '_TODAS'::text) AS store_code, 'quanto'::text AS fuente,
    sum(q.total_ventas) AS total_ventas, sum(q.total_sin_iva) AS total_sin_iva,
    sum(q.venta_neta) AS venta_neta, sum(q.propina_cobrada) AS propina_cobrada,
    sum(q.iva_recaudado) AS iva_recaudado, sum(q.efectivo) AS efectivo,
    sum(q.tarjeta) AS tarjeta, sum(q.otros) AS otros, count(*) AS num_dias, 0::numeric AS num_pedidos
   FROM v_quanto_ordenes_diario q
  WHERE q.fecha >= '2026-01-01'::date AND q.store_code <> 'EVT01'::text
  GROUP BY 1, 2
UNION ALL
 SELECT date_trunc('month'::text, pp.fecha_pedido::date::timestamp with time zone)::date AS mes,
    COALESCE(pp.store_code, '_TODAS'::text) AS store_code, 'peya'::text AS fuente,
    sum(pp.total_pedido) AS total_ventas, sum(pp.total_pedido / 1.13) AS total_sin_iva,
    sum(pp.total_pedido / 1.13) AS venta_neta, 0::numeric AS propina_cobrada,
    sum(pp.total_pedido - pp.total_pedido / 1.13) AS iva_recaudado, 0::numeric AS efectivo,
    0::numeric AS tarjeta, 0::numeric AS otros, 0::bigint AS num_dias, count(*) AS num_pedidos
   FROM pedidos_peya pp
  WHERE pp.estado = 'Entregado'::text AND pp.fecha_pedido >= '2026-01-01 00:00:00+00'::timestamp with time zone
  GROUP BY 1, 2
UNION ALL
 SELECT date_trunc('month'::text, pos.fecha::timestamp with time zone)::date AS mes,
    COALESCE(pos.store_code, '_TODAS'::text) AS store_code, 'pos'::text AS fuente,
    sum(pos.total_ventas) AS total_ventas, sum(pos.total_sin_iva) AS total_sin_iva,
    sum(pos.venta_neta) AS venta_neta, sum(pos.propina_cobrada) AS propina_cobrada,
    sum(pos.iva_recaudado) AS iva_recaudado, sum(pos.efectivo) AS efectivo,
    sum(pos.tarjeta) AS tarjeta, sum(pos.otros) AS otros, count(*) AS num_dias,
    sum(pos.num_ordenes) AS num_pedidos
   FROM v_pos_ventas_diario_sin_peya pos
  WHERE pos.fecha >= '2026-01-01'::date AND pos.store_code <> 'EVT01'::text
  GROUP BY 1, 2
  ORDER BY 1, 2, 3
WITH DATA;
CREATE UNIQUE INDEX uq_mv_finanzas_ventas_mensual
  ON public.mv_finanzas_ventas_mensual USING btree (mes, store_code, fuente);
GRANT SELECT ON public.mv_finanzas_ventas_mensual TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL: el reporte PeYa dejo de traer "ID del local" desde jun-2026, dejando
-- store_code NULL (se agrupaban como "Otro" en el P&L). "Nombre del local" sigue
-- presente, asi que se deriva store_code desde ahi. El importador (QuantoUploadView.jsx)
-- tambien quedo con fallback por nombre_local para no repetirlo.
UPDATE public.pedidos_peya
SET store_code = CASE nombre_local
    WHEN 'Freakie Dogs' THEN 'M001'
    WHEN 'Freakie Dogs Plaza Mundo Soyapango' THEN 'S001'
    WHEN 'Freakie Dogs Plaza Mundo Usulutan' THEN 'S002'
    WHEN 'Freakie Dogs Lourdes' THEN 'S003'
    WHEN 'Freakie Dogs - Paseo Venecia' THEN 'S004'
  END
WHERE store_code IS NULL
  AND nombre_local IN ('Freakie Dogs','Freakie Dogs Plaza Mundo Soyapango',
                       'Freakie Dogs Plaza Mundo Usulutan','Freakie Dogs Lourdes',
                       'Freakie Dogs - Paseo Venecia');

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_finanzas_ventas_mensual;
