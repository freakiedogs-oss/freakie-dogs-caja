-- KPI Ventas Totales: la proyección solo usa días CERRADOS (hasta ayer).
-- Antes el corte venía de v_data_disponible_resumen (= último día con alguna venta), y como el POS
-- entra en vivo, el día en curso contaba como día completo desde la primera venta de la mañana:
-- el promedio diario se dividía entre un día de más y la proyección/utilidad salían bajas.
-- Se parchea solo la línea del corte para no reescribir la función entera.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ventas_totales_dashboard(integer,integer)'::regprocedure);
  v_old text := 'v_corte := LEAST(COALESCE(v_data_completa, v_hoy - INTERVAL ''1 day''::interval)::date, v_fin_mes);';
  v_new text := 'v_corte := LEAST(COALESCE(v_data_completa, v_hoy - 1), v_hoy - 1, v_fin_mes);';
BEGIN
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'fn_ventas_totales_dashboard: no se encontró la línea del corte (¿ya parcheada?)';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
