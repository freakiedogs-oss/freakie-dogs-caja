-- ============================================================
-- MIGRATION: KPI Despacho — Hotfix QA (Bugs 2, 4, 6, 7, 8)
-- Fecha:    21-May-2026
-- Autor:    Cesar
-- Branch:   cesar/kpi-despacho-hotfix-qa
-- ============================================================
-- Bugs corregidos:
--   #2 numero_ciclo excluye anulados (no se "queman" números)
--   #4 fn_justificar_retraso_despacho re-valida estado
--   #6 fn_kpi_despacho_dashboard retorna JSON válido si periodo vacío
--   #7 fn_anular_marcaje_despacho borra justificación huérfana
--   #8 nueva RPC fn_editar_sucursales_despacho (edición sin anular)
-- ============================================================


-- ============================================================
-- BUG 2 fix: numero_ciclo excluye anulados
-- ============================================================
CREATE OR REPLACE FUNCTION fn_marcar_llegada_despacho(
  p_motorista_id UUID,
  p_lat          DOUBLE PRECISION,
  p_lng          DOUBLE PRECISION
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_motorista    usuarios_erp%ROWTYPE;
  v_matriz       sucursales%ROWTYPE;
  v_config       configuracion_despacho_kpi%ROWTYPE;
  v_distancia    DOUBLE PRECISION;
  v_now          TIMESTAMPTZ := NOW();
  v_hora_local   TIME := (v_now AT TIME ZONE 'America/El_Salvador')::TIME;
  v_llego_tarde  BOOLEAN;
  v_existe       UUID;
  v_ciclo        INTEGER;
  v_id           UUID;
BEGIN
  SELECT * INTO v_motorista FROM usuarios_erp
   WHERE id = p_motorista_id AND activo = TRUE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Motorista no encontrado o inactivo');
  END IF;
  IF v_motorista.rol NOT IN ('despachador','motorista') THEN
    RETURN json_build_object('ok', false, 'error', 'El usuario no tiene rol de motorista');
  END IF;

  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;
  SELECT * INTO v_matriz FROM sucursales WHERE store_code = v_config.matriz_store_code;
  IF v_matriz.lat IS NULL OR v_matriz.lng IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Casa matriz sin coordenadas GPS configuradas');
  END IF;

  IF v_hora_local < v_config.horario_marcaje_inicio OR v_hora_local > v_config.horario_marcaje_fin THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Fuera del horario de marcaje (' || v_config.horario_marcaje_inicio || ' a ' || v_config.horario_marcaje_fin || ')'
    );
  END IF;

  v_distancia := fn_haversine_metros(p_lat, p_lng, v_matriz.lat, v_matriz.lng);
  IF v_distancia > COALESCE(v_matriz.radio_metros, 300) THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Debes estar en casa matriz para marcar (estás a ' || round(v_distancia)::TEXT || 'm).'
    );
  END IF;

  SELECT id INTO v_existe FROM despacho_motoristas
   WHERE motorista_id = p_motorista_id AND fecha = CURRENT_DATE AND estado = 'en_espera'
   LIMIT 1;
  IF v_existe IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ya tienes un despacho en espera abierto. Espera la salida o anúlalo.');
  END IF;

  -- 🔧 BUG 2 FIX: contar solo ciclos NO anulados al calcular el siguiente número
  SELECT COALESCE(MAX(numero_ciclo), 0) + 1 INTO v_ciclo
    FROM despacho_motoristas
   WHERE motorista_id = p_motorista_id
     AND fecha = CURRENT_DATE
     AND estado <> 'anulado';  -- ← FIX: solo contar válidos

  v_llego_tarde := v_hora_local > v_config.horario_llegada_objetivo;

  INSERT INTO despacho_motoristas (
    motorista_id, motorista_nombre, fecha, numero_ciclo,
    hora_llegada, lat_llegada, lng_llegada,
    llego_tarde, estado
  ) VALUES (
    p_motorista_id,
    trim(v_motorista.nombre || ' ' || v_motorista.apellido),
    CURRENT_DATE, v_ciclo,
    v_now, p_lat, p_lng,
    v_llego_tarde, 'en_espera'
  ) RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok', true,
    'despacho_id', v_id,
    'numero_ciclo', v_ciclo,
    'llego_tarde', v_llego_tarde,
    'pide_motivo_tardanza', v_llego_tarde,
    'distancia_matriz_m', round(v_distancia)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_marcar_llegada_despacho TO authenticated, anon;


-- ============================================================
-- BUG 4 fix: justificar re-valida estado (rechaza si anulado)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_justificar_retraso_despacho(
  p_despacho_id  UUID,
  p_encargado_id UUID,
  p_categoria    TEXT,
  p_detalle      TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_encargado   usuarios_erp%ROWTYPE;
  v_despacho    despacho_motoristas%ROWTYPE;
  v_config      configuracion_despacho_kpi%ROWTYPE;
  v_obligatoria BOOLEAN;
BEGIN
  SELECT * INTO v_encargado FROM usuarios_erp
   WHERE id = p_encargado_id AND activo = TRUE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Encargado no encontrado');
  END IF;
  IF v_encargado.rol NOT IN ('jefe_casa_matriz','produccion','superadmin') THEN
    RETURN json_build_object('ok', false, 'error', 'No tienes permisos para justificar');
  END IF;

  SELECT * INTO v_despacho FROM despacho_motoristas WHERE id = p_despacho_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Despacho no encontrado');
  END IF;

  -- 🔧 BUG 4 FIX: rechazar justificación de despachos anulados
  IF v_despacho.estado = 'anulado' THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Este despacho fue anulado. Refrescá la pantalla.',
      'fue_anulado', true
    );
  END IF;

  -- También: solo aceptar justificación sobre despachos ya despachados
  IF v_despacho.estado <> 'despachado' THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Solo se pueden justificar despachos completados. Estado actual: ' || v_despacho.estado
    );
  END IF;

  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;
  v_obligatoria := COALESCE(v_despacho.tiempo_despacho_minutos, 0) > v_config.tiempo_max_amarillo_min;

  INSERT INTO justificacion_retrasos_despacho (
    despacho_id, encargado_id, encargado_nombre, motivo_categoria, motivo_detalle, obligatoria
  ) VALUES (
    p_despacho_id, p_encargado_id,
    trim(v_encargado.nombre || ' ' || v_encargado.apellido),
    p_categoria, NULLIF(trim(p_detalle), ''), v_obligatoria
  )
  ON CONFLICT (despacho_id) DO UPDATE
    SET motivo_categoria = EXCLUDED.motivo_categoria,
        motivo_detalle   = EXCLUDED.motivo_detalle,
        encargado_id     = EXCLUDED.encargado_id,
        encargado_nombre = EXCLUDED.encargado_nombre,
        obligatoria      = EXCLUDED.obligatoria;

  RETURN json_build_object('ok', true, 'obligatoria', v_obligatoria);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_justificar_retraso_despacho TO authenticated, anon;


-- ============================================================
-- BUG 6 fix: dashboard retorna JSON válido si periodo vacío
-- ============================================================
CREATE OR REPLACE FUNCTION fn_kpi_despacho_dashboard(
  p_fecha_inicio DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
  p_fecha_fin    DATE DEFAULT CURRENT_DATE
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_config configuracion_despacho_kpi%ROWTYPE;
  v_total_despachos INTEGER;
  v_result JSON;
BEGIN
  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;

  -- 🔧 BUG 6 FIX: chequear primero si hay datos en el rango
  SELECT COUNT(*) INTO v_total_despachos
    FROM despacho_motoristas
   WHERE fecha BETWEEN p_fecha_inicio AND p_fecha_fin
     AND estado = 'despachado';

  IF v_total_despachos = 0 THEN
    -- Retornar JSON válido vacío
    RETURN json_build_object(
      'periodo', json_build_object('inicio', p_fecha_inicio, 'fin', p_fecha_fin),
      'totales', json_build_object(
        'despachos', 0,
        'tiempo_promedio_min', 0,
        'verde', 0, 'amarillo', 0, 'rojo', 0,
        'llegadas_tarde', 0
      ),
      'por_motorista', '[]'::json,
      'por_sucursal',  '[]'::json,
      'serie_diaria',  '[]'::json,
      'sin_datos',     true
    );
  END IF;

  -- Caso normal: hay datos
  WITH base AS (
    SELECT
      d.*,
      CASE
        WHEN d.tiempo_despacho_minutos IS NULL                                 THEN 'pendiente'
        WHEN d.tiempo_despacho_minutos < v_config.tiempo_max_verde_min          THEN 'verde'
        WHEN d.tiempo_despacho_minutos < v_config.tiempo_max_amarillo_min       THEN 'amarillo'
        ELSE 'rojo'
      END AS color
    FROM despacho_motoristas d
    WHERE d.fecha BETWEEN p_fecha_inicio AND p_fecha_fin
      AND d.estado = 'despachado'
  )
  SELECT json_build_object(
    'periodo', json_build_object('inicio', p_fecha_inicio, 'fin', p_fecha_fin),
    'totales', json_build_object(
      'despachos',          COUNT(*),
      'tiempo_promedio_min', COALESCE(round(AVG(tiempo_despacho_minutos)::numeric, 2), 0),
      'verde',              COUNT(*) FILTER (WHERE color = 'verde'),
      'amarillo',           COUNT(*) FILTER (WHERE color = 'amarillo'),
      'rojo',               COUNT(*) FILTER (WHERE color = 'rojo'),
      'llegadas_tarde',     COUNT(*) FILTER (WHERE llego_tarde)
    ),
    'por_motorista', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.motorista_nombre), '[]'::json)
      FROM (
        SELECT
          motorista_nombre,
          COUNT(*) AS despachos,
          round(AVG(tiempo_despacho_minutos)::numeric, 2) AS tiempo_promedio_min,
          COUNT(*) FILTER (WHERE color = 'verde')    AS verde,
          COUNT(*) FILTER (WHERE color = 'amarillo') AS amarillo,
          COUNT(*) FILTER (WHERE color = 'rojo')     AS rojo
        FROM base GROUP BY motorista_nombre
      ) t
    ),
    'por_sucursal', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.sucursal_nombre), '[]'::json)
      FROM (
        SELECT
          s.nombre AS sucursal_nombre,
          s.store_code,
          COUNT(*) AS despachos,
          round(AVG(b.tiempo_despacho_minutos)::numeric, 2) AS tiempo_promedio_min,
          COUNT(*) FILTER (WHERE b.color = 'rojo') AS rojos
        FROM base b
        JOIN despacho_kpi_sucursales dks ON dks.despacho_id = b.id
        JOIN sucursales s ON s.id = dks.sucursal_id
        GROUP BY s.nombre, s.store_code
      ) t
    ),
    'serie_diaria', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.fecha), '[]'::json)
      FROM (
        SELECT
          fecha,
          COUNT(*) AS despachos,
          round(AVG(tiempo_despacho_minutos)::numeric, 2) AS tiempo_promedio_min
        FROM base GROUP BY fecha
      ) t
    ),
    'sin_datos', false
  ) INTO v_result FROM base;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_kpi_despacho_dashboard TO authenticated, anon;


-- ============================================================
-- BUG 7 fix: anular elimina justificación huérfana
-- ============================================================
CREATE OR REPLACE FUNCTION fn_anular_marcaje_despacho(
  p_despacho_id UUID,
  p_motorista_id UUID
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_despacho      despacho_motoristas%ROWTYPE;
  v_config        configuracion_despacho_kpi%ROWTYPE;
  v_ref_time      TIMESTAMPTZ;
  v_segundos      NUMERIC;
  v_justif_borrada INTEGER := 0;
BEGIN
  SELECT * INTO v_despacho FROM despacho_motoristas WHERE id = p_despacho_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Despacho no encontrado');
  END IF;
  IF v_despacho.motorista_id <> p_motorista_id THEN
    RETURN json_build_object('ok', false, 'error', 'Solo el motorista puede anular su propio marcaje');
  END IF;
  IF v_despacho.estado = 'anulado' THEN
    RETURN json_build_object('ok', false, 'error', 'Ya estaba anulado');
  END IF;

  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;
  v_ref_time := COALESCE(v_despacho.hora_salida, v_despacho.hora_llegada);
  v_segundos := EXTRACT(EPOCH FROM (NOW() - v_ref_time));

  IF v_segundos > (v_config.minutos_anulacion * 60) THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Pasaron más de ' || v_config.minutos_anulacion || ' min. Ya no se puede anular.'
    );
  END IF;

  -- 🔧 BUG 7 FIX: borrar justificación si existía (queda huérfana si no)
  DELETE FROM justificacion_retrasos_despacho
   WHERE despacho_id = p_despacho_id;
  GET DIAGNOSTICS v_justif_borrada = ROW_COUNT;

  UPDATE despacho_motoristas
     SET estado = 'anulado',
         anulado_en = NOW(),
         anulado_por = p_motorista_id
   WHERE id = p_despacho_id;

  RETURN json_build_object(
    'ok', true,
    'justificacion_borrada', v_justif_borrada > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_anular_marcaje_despacho TO authenticated, anon;


-- ============================================================
-- BUG 8 (opción B): nueva RPC editar sucursales sin anular
-- ============================================================
CREATE OR REPLACE FUNCTION fn_editar_sucursales_despacho(
  p_despacho_id  UUID,
  p_motorista_id UUID,
  p_sucursales   JSONB  -- [{sucursal_id, producto_faltante}]
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_despacho      despacho_motoristas%ROWTYPE;
  v_config        configuracion_despacho_kpi%ROWTYPE;
  v_segundos      NUMERIC;
  v_item          JSONB;
BEGIN
  -- Validar sucursales mínimas
  IF p_sucursales IS NULL OR jsonb_array_length(p_sucursales) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Debes seleccionar al menos una sucursal');
  END IF;

  -- Cargar despacho
  SELECT * INTO v_despacho FROM despacho_motoristas WHERE id = p_despacho_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Despacho no encontrado');
  END IF;

  -- Validar dueño
  IF v_despacho.motorista_id <> p_motorista_id THEN
    RETURN json_build_object('ok', false, 'error', 'Solo el motorista puede editar su propio despacho');
  END IF;

  -- Solo despachos ya despachados pueden editar (no en_espera ni anulados)
  IF v_despacho.estado <> 'despachado' THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Solo se pueden editar despachos ya completados. Estado: ' || v_despacho.estado
    );
  END IF;

  -- Validar ventana de edición (misma que anulación: 5 min desde salida)
  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;
  v_segundos := EXTRACT(EPOCH FROM (NOW() - v_despacho.hora_salida));
  IF v_segundos > (v_config.minutos_anulacion * 60) THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Pasaron más de ' || v_config.minutos_anulacion || ' min desde la salida. Ya no se puede editar.'
    );
  END IF;

  -- Reemplazar sucursales: borrar las viejas + insertar las nuevas
  DELETE FROM despacho_kpi_sucursales WHERE despacho_id = p_despacho_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_sucursales) LOOP
    INSERT INTO despacho_kpi_sucursales (despacho_id, sucursal_id, producto_faltante)
    VALUES (
      p_despacho_id,
      (v_item->>'sucursal_id')::UUID,
      NULLIF(trim(v_item->>'producto_faltante'), '')
    )
    ON CONFLICT (despacho_id, sucursal_id) DO NOTHING;
  END LOOP;

  RETURN json_build_object(
    'ok', true,
    'sucursales_actualizadas', jsonb_array_length(p_sucursales)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_editar_sucursales_despacho TO authenticated, anon;


-- ============================================================
-- COMENTARIOS
-- ============================================================
COMMENT ON FUNCTION fn_marcar_llegada_despacho IS 'Marca llegada del motorista en CM001. numero_ciclo excluye anulados (fix Bug 2).';
COMMENT ON FUNCTION fn_justificar_retraso_despacho IS 'Justifica retraso. Rechaza si despacho anulado o no despachado (fix Bug 4).';
COMMENT ON FUNCTION fn_kpi_despacho_dashboard IS 'Dashboard KPI. Retorna JSON válido con ceros si periodo vacío (fix Bug 6).';
COMMENT ON FUNCTION fn_anular_marcaje_despacho IS 'Anula marcaje. Borra justificación huérfana asociada (fix Bug 7).';
COMMENT ON FUNCTION fn_editar_sucursales_despacho IS 'Edita sucursales de un despacho ya despachado, dentro de la ventana de anulación. Reemplaza la lista entera (fix Bug 8 opción B).';
