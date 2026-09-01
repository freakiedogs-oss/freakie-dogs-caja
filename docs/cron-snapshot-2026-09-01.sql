-- Snapshot cron.job ANTES del escalonamiento — freakie-dogs-erp (btboxlwfqcbrdfrlnwln)
-- Fecha: 2026-09-01. Motivo: 14-15 jobs disparando en :00 y :30 => estampida cada 30 min.
-- REVERTIR: ejecutar este bloque.
SELECT cron.alter_job(24, schedule => '*/30 * * * *'); -- kako-dte-sweep (NO SE TOCÓ)
SELECT cron.alter_job(58, schedule => '*/30 * * * *'); -- limpiar-cola-cocina-colgada
SELECT cron.alter_job(61, schedule => '*/30 * * * *'); -- pos-reconciliar-cierres-z
SELECT cron.alter_job(57, schedule => '*/30 * * * *'); -- reconciliar-delivery-colgados
SELECT cron.alter_job(20, schedule => '*/30 * * * *'); -- refresh_mv_finanzas_banco_mensual
SELECT cron.alter_job(18, schedule => '*/30 * * * *'); -- refresh_mv_finanzas_gastos_mensual
SELECT cron.alter_job(19, schedule => '*/30 * * * *'); -- refresh_mv_finanzas_ventas_mensual
SELECT cron.alter_job(14, schedule => '*/30 * * * *'); -- refresh_mv_v_quanto_ordenes_diario
SELECT cron.alter_job(17, schedule => '*/30 * * * *'); -- refresh_mv_vista_labor_cost_ratio
SELECT cron.alter_job(13, schedule => '*/30 * * * *'); -- refresh_mv_vista_ventas_diarias
SELECT cron.alter_job(15, schedule => '5,35 * * * *'); -- refresh_mv_vista_patron_semanal
SELECT cron.alter_job(16, schedule => '5,35 * * * *'); -- refresh_mv_vista_performance_vs_meta
