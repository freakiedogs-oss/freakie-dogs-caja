-- ============================================================
-- MIGRATION: KPI Delivery Propio — Dashboard ejecutivo (solo superadmin)
-- Fecha:    20-May-2026
-- Autor:    Cesar
-- Branch:   cesar/kpi-delivery-propio
-- ============================================================
-- Objetivo
--   Dashboard de delivery propio con proyección mensual ponderada
--   (L-V vs S-D) leyendo de quanto_ordenes con canal_venta='delivery_propio'.
--   Solo superadmin (Cesar) ve este módulo.
--
-- Alcance
--   - 1 tabla nueva: metas_delivery (por año/mes, override manual)
--   - 1 columna nueva: sucursales.tiene_delivery (BOOLEAN)
--   - 1 view: v_delivery_dia (agregación diaria por sucursal)
--   - 3 RPCs: fn_delivery_dashboard, fn_delivery_productos_top, fn_delivery_set_meta
--   - RLS patrón ERP (SELECT abierto, escritura via RPC)
--
-- Sucursales con delivery activo (5):
--   M001 Plaza Cafetalón (Tecla)
--   S001 Plaza Mundo Soyapango
--   S002 Plaza Mundo Usulután (bajo volumen pero activo)
--   S003 Grand Plaza Lourdes (Lourdes)
--   S004 Paseo Venecia (esporádico, deliveries de emergencia)
-- CM001 Casa Matriz NO tiene delivery (es bodega/producción).
-- ============================================================


-- ============================================================
-- 1. Tabla metas_delivery (overrides manuales por mes)
-- ============================================================
CREATE TABLE IF NOT EXISTS metas_delivery (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio                     INTEGER NOT NULL,
  mes                      INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  meta_monto               NUMERIC(12,2) NOT NULL,
  meta_auto                BOOLEAN NOT NULL DEFAULT TRUE,
  meta_base_mes_anterior   NUMERIC(12,2),
  porcentaje_crecimiento   NUMERIC(5,2) DEFAULT 5.00,
  ajustada_manualmente     BOOLEAN NOT NULL DEFAULT FALSE,
  ajustada_por             UUID REFERENCES usuarios_erp(id),
  ajustada_en              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_metas_delivery_anio_mes ON metas_delivery(anio, mes);


-- ============================================================
-- 2. Columna sucursales.tiene_delivery
-- ============================================================
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS tiene_delivery BOOLEAN NOT NULL DEFAULT FALSE;

-- Marcar las 5 sucursales con delivery activo
UPDATE sucursales SET tiene_delivery = TRUE
 WHERE store_code IN ('M001','S001','S002','S003','S004');


-- ============================================================
-- 3. View v_delivery_dia (agregación diaria)
-- ============================================================
CREATE OR REPLACE VIEW v_delivery_dia AS
SELECT
  qo.fecha,
  qo.store_code,
  s.nombre AS sucursal_nombre,
  EXTRACT(DOW FROM qo.fecha)::INTEGER AS dow,     -- 0=dom, 6=sáb
  CASE
    WHEN EXTRACT(DOW FROM qo.fecha) IN (0, 6) THEN 'finde'
    ELSE 'semana'
  END AS tipo_dia,
  COUNT(*)                                 AS pedidos,
  SUM(qo.total_pagar)::numeric(12,2)       AS monto,
  AVG(qo.total_pagar)::numeric(10,2)       AS ticket_promedio
FROM quanto_ordenes qo
JOIN sucursales s ON s.store_code = qo.store_code
WHERE qo.canal_venta = 'delivery_propio'
  AND s.tiene_delivery = TRUE
GROUP BY qo.fecha, qo.store_code, s.nombre;

GRANT SELECT ON v_delivery_dia TO anon, authenticated;


-- ============================================================
-- 4. RPC: fn_delivery_dashboard
-- Retorna JSON con totales, proyección ponderada, semáforo,
-- por sucursal con sparkline, mejor/peor día, días sin datos, etc.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_delivery_dashboard(
  p_anio INTEGER,
  p_mes  INTEGER
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hoy           DATE := (NOW() AT TIME ZONE 'America/El_Salvador')::DATE;
  v_inicio_mes    DATE;
  v_fin_mes       DATE;
  v_dias_mes      INTEGER;
  v_dias_finde_mes INTEGER;
  v_dias_semana_mes INTEGER;
  v_corte         DATE;   -- hasta cuándo hay datos reales (min(hoy, fin_mes))
  v_acumulado     NUMERIC(12,2);
  v_pedidos_total INTEGER;
  v_prom_lv       NUMERIC(12,2);
  v_prom_sd       NUMERIC(12,2);
  v_prom_sd_fallback NUMERIC(12,2);
  v_dias_lv_restantes INTEGER;
  v_dias_sd_restantes INTEGER;
  v_dias_lv_sin_datos INTEGER;
  v_dias_sd_sin_datos INTEGER;
  v_proyeccion    NUMERIC(12,2);
  v_meta          NUMERIC(12,2);
  v_meta_auto     BOOLEAN;
  v_meta_ajustada BOOLEAN;
  v_venta_mes_anterior NUMERIC(12,2);
  v_porc          NUMERIC(8,2);
  v_semaforo      TEXT;
  v_result        JSON;
BEGIN
  -- Calcular rango de fechas del mes
  v_inicio_mes := make_date(p_anio, p_mes, 1);
  v_fin_mes := (v_inicio_mes + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  v_dias_mes := EXTRACT(DAY FROM v_fin_mes)::INTEGER;
  v_corte := LEAST(v_hoy, v_fin_mes);

  -- Contar días L-V y S-D del mes completo
  SELECT
    COUNT(*) FILTER (WHERE EXTRACT(DOW FROM d) NOT IN (0,6)),
    COUNT(*) FILTER (WHERE EXTRACT(DOW FROM d) IN (0,6))
  INTO v_dias_semana_mes, v_dias_finde_mes
  FROM generate_series(v_inicio_mes, v_fin_mes, '1 day'::interval) d;

  -- Acumulado y pedidos del mes hasta hoy (días con datos)
  SELECT
    COALESCE(SUM(monto), 0)::numeric(12,2),
    COALESCE(SUM(pedidos), 0)
  INTO v_acumulado, v_pedidos_total
  FROM v_delivery_dia
  WHERE fecha BETWEEN v_inicio_mes AND v_corte;

  -- Promedio diario L-V con datos reales del mes
  SELECT AVG(monto_dia)::numeric(12,2) INTO v_prom_lv
  FROM (
    SELECT fecha, SUM(monto) AS monto_dia
    FROM v_delivery_dia
    WHERE fecha BETWEEN v_inicio_mes AND v_corte
      AND tipo_dia = 'semana'
    GROUP BY fecha
  ) t;

  -- Promedio diario S-D con datos reales del mes
  SELECT AVG(monto_dia)::numeric(12,2) INTO v_prom_sd
  FROM (
    SELECT fecha, SUM(monto) AS monto_dia
    FROM v_delivery_dia
    WHERE fecha BETWEEN v_inicio_mes AND v_corte
      AND tipo_dia = 'finde'
    GROUP BY fecha
  ) t;

  -- Si aún no hay datos S-D este mes, usar promedio S-D del mes anterior
  IF v_prom_sd IS NULL THEN
    SELECT AVG(monto_dia)::numeric(12,2) INTO v_prom_sd_fallback
    FROM (
      SELECT fecha, SUM(monto) AS monto_dia
      FROM v_delivery_dia
      WHERE fecha BETWEEN
              (v_inicio_mes - INTERVAL '1 month')::DATE AND
              (v_inicio_mes - INTERVAL '1 day')::DATE
        AND tipo_dia = 'finde'
      GROUP BY fecha
    ) t;
    v_prom_sd := COALESCE(v_prom_sd_fallback, v_prom_lv, 0);
  END IF;

  -- Asegurar que v_prom_lv no sea NULL (mes recién comenzado)
  v_prom_lv := COALESCE(v_prom_lv, v_prom_sd, 0);

  -- Días restantes (mañana hasta fin de mes, solo si el mes aún no terminó)
  IF v_hoy < v_fin_mes THEN
    SELECT
      COUNT(*) FILTER (WHERE EXTRACT(DOW FROM d) NOT IN (0,6)),
      COUNT(*) FILTER (WHERE EXTRACT(DOW FROM d) IN (0,6))
    INTO v_dias_lv_restantes, v_dias_sd_restantes
    FROM generate_series(v_hoy + 1, v_fin_mes, '1 day'::interval) d;
  ELSE
    v_dias_lv_restantes := 0;
    v_dias_sd_restantes := 0;
  END IF;

  -- Días del mes (hasta hoy) SIN datos — para sumar al proyectado
  WITH dias_mes AS (
    SELECT d::DATE AS fecha
    FROM generate_series(v_inicio_mes, v_corte, '1 day'::interval) d
  ),
  dias_con_datos AS (
    SELECT DISTINCT fecha FROM v_delivery_dia
    WHERE fecha BETWEEN v_inicio_mes AND v_corte
  )
  SELECT
    COUNT(*) FILTER (WHERE EXTRACT(DOW FROM dm.fecha) NOT IN (0,6)),
    COUNT(*) FILTER (WHERE EXTRACT(DOW FROM dm.fecha) IN (0,6))
  INTO v_dias_lv_sin_datos, v_dias_sd_sin_datos
  FROM dias_mes dm
  LEFT JOIN dias_con_datos dcd ON dcd.fecha = dm.fecha
  WHERE dcd.fecha IS NULL;

  -- Proyección ponderada
  v_proyeccion := v_acumulado
    + (v_dias_lv_restantes * v_prom_lv)
    + (v_dias_sd_restantes * v_prom_sd)
    + (v_dias_lv_sin_datos * v_prom_lv)
    + (v_dias_sd_sin_datos * v_prom_sd);

  -- Meta del mes
  SELECT meta_monto, meta_auto, ajustada_manualmente
  INTO v_meta, v_meta_auto, v_meta_ajustada
  FROM metas_delivery
  WHERE anio = p_anio AND mes = p_mes;

  IF v_meta IS NULL THEN
    -- Calcular meta automática: mes anterior * 1.05
    SELECT COALESCE(SUM(monto), 0)::numeric(12,2) INTO v_venta_mes_anterior
    FROM v_delivery_dia
    WHERE fecha BETWEEN
            (v_inicio_mes - INTERVAL '1 month')::DATE AND
            (v_inicio_mes - INTERVAL '1 day')::DATE;
    v_meta := v_venta_mes_anterior * 1.05;
    v_meta_auto := TRUE;
    v_meta_ajustada := FALSE;
  END IF;

  -- Semáforo
  v_porc := CASE WHEN v_meta > 0 THEN (v_proyeccion / v_meta * 100) ELSE 0 END;
  v_semaforo := CASE
    WHEN v_porc >= 100 THEN 'verde'
    WHEN v_porc >= 90  THEN 'amarillo'
    ELSE 'rojo'
  END;

  -- Armar JSON final
  SELECT json_build_object(
    'periodo', json_build_object(
      'anio', p_anio, 'mes', p_mes,
      'inicio', v_inicio_mes, 'fin', v_fin_mes,
      'dias_mes', v_dias_mes,
      'dias_semana_mes', v_dias_semana_mes,
      'dias_finde_mes', v_dias_finde_mes,
      'hoy', v_hoy
    ),
    'totales', json_build_object(
      'acumulado', v_acumulado,
      'pedidos', v_pedidos_total,
      'ticket_promedio', CASE WHEN v_pedidos_total > 0
                              THEN (v_acumulado / v_pedidos_total)::numeric(10,2)
                              ELSE 0 END,
      'proyeccion', v_proyeccion::numeric(12,2),
      'meta', v_meta,
      'meta_auto', v_meta_auto,
      'meta_ajustada', COALESCE(v_meta_ajustada, FALSE),
      'venta_mes_anterior', v_venta_mes_anterior,
      'porcentaje_avance', CASE WHEN v_meta > 0
                                THEN ((v_acumulado / v_meta) * 100)::numeric(6,2)
                                ELSE 0 END,
      'porcentaje_proyectado', v_porc::numeric(6,2),
      'semaforo', v_semaforo,
      'dias_restantes', v_dias_lv_restantes + v_dias_sd_restantes
    ),
    'promedios', json_build_object(
      'lunes_a_viernes', v_prom_lv,
      'finde_semana', v_prom_sd,
      'diferencia_pct', CASE WHEN v_prom_lv > 0
                             THEN ((v_prom_sd - v_prom_lv) / v_prom_lv * 100)::numeric(6,2)
                             ELSE 0 END
    ),
    'serie_diaria', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.fecha), '[]'::json)
      FROM (
        SELECT
          fecha,
          SUM(monto)::numeric(12,2)  AS monto,
          SUM(pedidos)               AS pedidos,
          CASE WHEN EXTRACT(DOW FROM fecha) IN (0,6) THEN 'finde' ELSE 'semana' END AS tipo_dia,
          to_char(fecha, 'Dy')       AS dia_nombre
        FROM v_delivery_dia
        WHERE fecha BETWEEN v_inicio_mes AND v_corte
        GROUP BY fecha
      ) t
    ),
    'por_sucursal', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.monto DESC), '[]'::json)
      FROM (
        SELECT
          v.store_code,
          v.sucursal_nombre,
          SUM(v.monto)::numeric(12,2)  AS monto,
          SUM(v.pedidos)               AS pedidos,
          AVG(v.ticket_promedio)::numeric(10,2) AS ticket_promedio,
          (SELECT json_agg(json_build_object('fecha', s.fecha, 'monto', s.monto) ORDER BY s.fecha)
             FROM (SELECT fecha, SUM(monto)::numeric(12,2) AS monto
                     FROM v_delivery_dia
                    WHERE store_code = v.store_code
                      AND fecha BETWEEN v_inicio_mes AND v_corte
                    GROUP BY fecha) s) AS sparkline,
          -- Crecimiento vs mes anterior (primeros N días donde N = días corridos del mes actual)
          (SELECT COALESCE(SUM(monto), 0)::numeric(12,2)
             FROM v_delivery_dia
            WHERE store_code = v.store_code
              AND fecha BETWEEN (v_inicio_mes - INTERVAL '1 month')::DATE
                            AND (v_inicio_mes - INTERVAL '1 month' + (v_corte - v_inicio_mes))::DATE
          ) AS monto_periodo_mes_anterior
        FROM v_delivery_dia v
        WHERE v.fecha BETWEEN v_inicio_mes AND v_corte
        GROUP BY v.store_code, v.sucursal_nombre
      ) t
    ),
    'dias_sin_datos', (
      WITH dias_mes AS (
        SELECT d::DATE AS fecha
        FROM generate_series(v_inicio_mes, v_corte, '1 day'::interval) d
      ),
      dias_con_datos AS (
        SELECT DISTINCT fecha FROM v_delivery_dia
        WHERE fecha BETWEEN v_inicio_mes AND v_corte
      )
      SELECT COALESCE(json_agg(dm.fecha ORDER BY dm.fecha), '[]'::json)
      FROM dias_mes dm
      LEFT JOIN dias_con_datos dcd ON dcd.fecha = dm.fecha
      WHERE dcd.fecha IS NULL
    ),
    'mejor_dia', (
      SELECT row_to_json(t) FROM (
        SELECT fecha, SUM(monto)::numeric(12,2) AS monto, SUM(pedidos) AS pedidos
          FROM v_delivery_dia
         WHERE fecha BETWEEN v_inicio_mes AND v_corte
         GROUP BY fecha
         ORDER BY SUM(monto) DESC
         LIMIT 1
      ) t
    ),
    'peor_dia', (
      SELECT row_to_json(t) FROM (
        SELECT fecha, SUM(monto)::numeric(12,2) AS monto, SUM(pedidos) AS pedidos
          FROM v_delivery_dia
         WHERE fecha BETWEEN v_inicio_mes AND v_corte
         GROUP BY fecha
         ORDER BY SUM(monto) ASC
         LIMIT 1
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_delivery_dashboard TO authenticated, anon;


-- ============================================================
-- 5. RPC: fn_delivery_productos_top
-- Extrae items del json_raw (DTE cuerpoDocumento) y rankea
-- ============================================================
CREATE OR REPLACE FUNCTION fn_delivery_productos_top(
  p_anio  INTEGER,
  p_mes   INTEGER,
  p_limit INTEGER DEFAULT 20
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inicio_mes DATE;
  v_fin_mes    DATE;
  v_result     JSON;
BEGIN
  v_inicio_mes := make_date(p_anio, p_mes, 1);
  v_fin_mes := (v_inicio_mes + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.monto_total DESC), '[]'::json)
    INTO v_result
  FROM (
    SELECT
      trim(LOWER(item->>'descripcion'))           AS producto_norm,
      MAX(item->>'descripcion')                   AS producto_nombre,
      SUM((item->>'cantidad')::numeric)::integer  AS cantidad,
      SUM((item->>'ventaGravada')::numeric + COALESCE((item->>'ventaNoSuj')::numeric,0) + COALESCE((item->>'ventaExenta')::numeric,0))::numeric(12,2)
                                                  AS monto_total,
      COUNT(DISTINCT qo.id)                       AS ordenes
    FROM quanto_ordenes qo
    CROSS JOIN LATERAL jsonb_array_elements(qo.json_raw->'cuerpoDocumento') item
    WHERE qo.canal_venta = 'delivery_propio'
      AND qo.fecha BETWEEN v_inicio_mes AND v_fin_mes
      AND item->>'descripcion' IS NOT NULL
    GROUP BY trim(LOWER(item->>'descripcion'))
    ORDER BY SUM((item->>'ventaGravada')::numeric + COALESCE((item->>'ventaNoSuj')::numeric,0) + COALESCE((item->>'ventaExenta')::numeric,0)) DESC
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_delivery_productos_top TO authenticated, anon;


-- ============================================================
-- 6. RPC: fn_delivery_set_meta (override manual)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_delivery_set_meta(
  p_anio        INTEGER,
  p_mes         INTEGER,
  p_meta_monto  NUMERIC,
  p_usuario_id  UUID
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_usuario usuarios_erp%ROWTYPE;
BEGIN
  -- Validar rol
  SELECT * INTO v_usuario FROM usuarios_erp
   WHERE id = p_usuario_id AND activo = TRUE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Usuario no encontrado');
  END IF;
  IF v_usuario.rol <> 'superadmin' THEN
    RETURN json_build_object('ok', false, 'error', 'Solo superadmin puede ajustar meta');
  END IF;

  IF p_meta_monto IS NULL OR p_meta_monto <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Monto inválido');
  END IF;

  INSERT INTO metas_delivery (
    anio, mes, meta_monto, meta_auto,
    ajustada_manualmente, ajustada_por, ajustada_en, updated_at
  ) VALUES (
    p_anio, p_mes, p_meta_monto, FALSE,
    TRUE, p_usuario_id, NOW(), NOW()
  )
  ON CONFLICT (anio, mes) DO UPDATE
    SET meta_monto = EXCLUDED.meta_monto,
        meta_auto = FALSE,
        ajustada_manualmente = TRUE,
        ajustada_por = p_usuario_id,
        ajustada_en = NOW(),
        updated_at = NOW();

  RETURN json_build_object('ok', true, 'meta', p_meta_monto);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_delivery_set_meta TO authenticated, anon;


-- ============================================================
-- 7. RLS
-- ============================================================
ALTER TABLE metas_delivery ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_md_select ON metas_delivery FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON metas_delivery TO anon, authenticated;


-- ============================================================
-- 8. Comentarios
-- ============================================================
COMMENT ON TABLE metas_delivery IS 'Metas mensuales de venta delivery propio. Singleton por (anio, mes). meta_auto=TRUE si calculada como mes_anterior*1.05; FALSE si override manual del superadmin.';
COMMENT ON COLUMN sucursales.tiene_delivery IS 'TRUE si la sucursal acepta delivery propio (S001/S002/S003/S004/M001). FALSE para CM001 y futuras no-delivery.';
COMMENT ON VIEW v_delivery_dia IS 'Agregación diaria por sucursal de quanto_ordenes con canal_venta=delivery_propio y sucursales.tiene_delivery=TRUE.';
