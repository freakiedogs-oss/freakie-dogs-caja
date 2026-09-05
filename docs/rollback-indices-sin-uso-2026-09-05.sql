-- ROLLBACK — recrea los 12 índices sin uso eliminados el 05-sep-2026.
-- Criterio de borrado: idx_scan = 0 desde marzo-2026, NO respaldan FK, NO son
-- de DTE, y viven en tablas con >5,000 escrituras (ahí es donde un índice
-- muerto cuesta: cada INSERT/UPDATE lo mantiene).
-- Si algo se puso lento tras el borrado, corré esto y avisá cuál era.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notif_dirigido_email ON kaeru.notificaciones USING btree (dirigido_a_email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notif_dirigido_rol ON kaeru.notificaciones USING btree (dirigido_a_rol);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notif_severidad ON kaeru.notificaciones USING btree (severidad);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_venta_detalles_creado_en ON kaeru.venta_detalles USING btree (creado_en);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_tx_estado_fecha ON public.bank_transacciones USING btree (estado, fecha DESC) WHERE (estado = ANY (ARRAY['pendiente'::text, 'sin_match'::text]));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_egresos_cierre_excluir_pl ON public.egresos_cierre USING btree (excluir_pl) WHERE (excluir_pl = true);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventario_alerta ON public.inventario USING btree (alerta_activa) WHERE (alerta_activa = true);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_peya_local_id ON public.pedidos_peya USING btree (local_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_cuenta_items_cocina ON public.pos_cuenta_items USING btree (estado_cocina) WHERE (estado_cocina <> ALL (ARRAY['entregado'::text, 'cancelado'::text]));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_impresion_log_huerfana ON public.pos_impresion_log USING btree (created_at DESC) WHERE ((cuenta_id IS NULL) AND (tipo = 'comanda'::text));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qoi_es_propina ON public.quanto_orden_items USING btree (es_propina) WHERE (es_propina = true);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_juego_scores_orden ON public.juego_scores USING btree (numero_orden);
