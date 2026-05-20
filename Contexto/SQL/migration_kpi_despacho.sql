-- ============================================================
-- MIGRATION: KPI Despacho a Motoristas — Fase 1
-- Fecha:    18-May-2026
-- Autor:    Cesar
-- Branch:   cesar/kpi-despacho-motoristas
-- ============================================================
-- Objetivo
--   Medir tiempo entre llegada del motorista a CM001 y salida
--   con producto despachado. KPI del equipo de bodega
--   (Marcos, Denny, Jessica) — no del motorista.
--
-- Alcance
--   - 4 tablas nuevas, prefijo "despacho_*" (no choca con
--     `despachos_sucursal` existente, que mide ciclo del pedido).
--   - Función Haversine + 5 RPCs (SECURITY DEFINER) + 1 view.
--   - RLS patrón ERP: SELECT abierto a anon/authenticated,
--     escritura solo via RPCs.
--
-- Roles aceptados
--   - Motorista: 'despachador' (Israel) | 'motorista' (Ángel)
--   - Encargado: 'jefe_casa_matriz' (Marcos, Denny) |
--                'produccion' (Jessica) | 'superadmin' (Cesar)
--
-- GPS matriz (CM001)
--   Se lee de tabla `sucursales`. No se duplica aquí.
--   Actual: lat=13.678009, lng=-89.265556, radio=300m.
-- ============================================================


-- ============================================================
-- 1. TABLAS
-- ============================================================

CREATE TABLE despacho_motoristas (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id             UUID NOT NULL REFERENCES usuarios_erp(id),
  motorista_nombre         TEXT NOT NULL,                -- snapshot p/ auditoría
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  numero_ciclo             INTEGER NOT NULL DEFAULT 1,   -- 1, 2, 3... múltiples viajes
  hora_llegada             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat_llegada              DOUBLE PRECISION,
  lng_llegada              DOUBLE PRECISION,
  llego_tarde              BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_tardanza          TEXT,                          -- obligatorio si llego_tarde
  hora_salida              TIMESTAMPTZ,
  lat_salida               DOUBLE PRECISION,
  lng_salida               DOUBLE PRECISION,
  tiempo_despacho_minutos  NUMERIC(10,2),                 -- calculado al marcar salida
  notas_generales          TEXT,
  estado                   TEXT NOT NULL DEFAULT 'en_espera'
                             CHECK (estado IN ('en_espera','despachado','anulado')),
  anulado_en               TIMESTAMPTZ,
  anulado_por              UUID REFERENCES usuarios_erp(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_despacho_motoristas_fecha       ON despacho_motoristas(fecha);
CREATE INDEX idx_despacho_motoristas_motorista   ON despacho_motoristas(motorista_id);
CREATE INDEX idx_despacho_motoristas_estado      ON despacho_motoristas(estado);
CREATE INDEX idx_despacho_motoristas_mot_fec_est ON despacho_motoristas(motorista_id, fecha, estado);

-- Sucursales destino (1 ciclo → N sucursales)
CREATE TABLE despacho_kpi_sucursales (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id        UUID NOT NULL REFERENCES despacho_motoristas(id) ON DELETE CASCADE,
  sucursal_id        UUID NOT NULL REFERENCES sucursales(id),
  producto_faltante  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (despacho_id, sucursal_id)
);

CREATE INDEX idx_despacho_kpi_suc_despacho ON despacho_kpi_sucursales(despacho_id);
CREATE INDEX idx_despacho_kpi_suc_sucursal ON despacho_kpi_sucursales(sucursal_id);

-- Justificaciones del encargado
CREATE TABLE justificacion_retrasos_despacho (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id       UUID NOT NULL UNIQUE REFERENCES despacho_motoristas(id) ON DELETE CASCADE,
  encargado_id      UUID NOT NULL REFERENCES usuarios_erp(id),
  encargado_nombre  TEXT NOT NULL,                       -- snapshot
  motivo_categoria  TEXT NOT NULL CHECK (motivo_categoria IN (
                      'falta_producto',
                      'error_pedido',
                      'motorista_tarde',
                      'problema_sistema',
                      'mucho_volumen',
                      'otro'
                    )),
  motivo_detalle    TEXT,
  obligatoria       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_justif_retrasos_categoria ON justificacion_retrasos_despacho(motivo_categoria);

-- Configuración singleton
CREATE TABLE configuracion_despacho_kpi (
  id                          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  matriz_store_code           TEXT NOT NULL DEFAULT 'CM001',
  tiempo_max_verde_min        INTEGER NOT NULL DEFAULT 30,
  tiempo_max_amarillo_min     INTEGER NOT NULL DEFAULT 45,
  horario_llegada_objetivo    TIME NOT NULL DEFAULT '08:00:00',
  horario_marcaje_inicio      TIME NOT NULL DEFAULT '06:00:00',
  horario_marcaje_fin         TIME NOT NULL DEFAULT '12:00:00',
  minutos_anulacion           INTEGER NOT NULL DEFAULT 5,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion_despacho_kpi (id) VALUES (1);


-- ============================================================
-- 2. Trigger updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION fn_trg_despacho_motoristas_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_despacho_motoristas_updated_at
BEFORE UPDATE ON despacho_motoristas
FOR EACH ROW EXECUTE FUNCTION fn_trg_despacho_motoristas_updated_at();


-- ============================================================
-- 3. Función Haversine (metros)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_haversine_metros(
  lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  r    CONSTANT DOUBLE PRECISION := 6371000;  -- radio tierra (m)
  dlat DOUBLE PRECISION;
  dlng DOUBLE PRECISION;
  a    DOUBLE PRECISION;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  dlat := radians(lat2 - lat1);
  dlng := radians(lng2 - lng1);
  a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)^2;
  RETURN r * 2 * asin(sqrt(a));
END;
$$;


-- ============================================================
-- 4. RPCs
-- ============================================================

-- 4.1 Marcar llegada
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
  -- 1. Motorista válido
  SELECT * INTO v_motorista FROM usuarios_erp
   WHERE id = p_motorista_id AND activo = TRUE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Motorista no encontrado o inactivo');
  END IF;
  IF v_motorista.rol NOT IN ('despachador','motorista') THEN
    RETURN json_build_object('ok', false, 'error', 'El usuario no tiene rol de motorista');
  END IF;

  -- 2. Configuración + GPS matriz
  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;
  SELECT * INTO v_matriz FROM sucursales WHERE store_code = v_config.matriz_store_code;
  IF v_matriz.lat IS NULL OR v_matriz.lng IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Casa matriz sin coordenadas GPS configuradas');
  END IF;

  -- 3. Horario
  IF v_hora_local < v_config.horario_marcaje_inicio OR v_hora_local > v_config.horario_marcaje_fin THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Fuera del horario de marcaje (' || v_config.horario_marcaje_inicio || ' a ' || v_config.horario_marcaje_fin || ')'
    );
  END IF;

  -- 4. GPS
  v_distancia := fn_haversine_metros(p_lat, p_lng, v_matriz.lat, v_matriz.lng);
  IF v_distancia > COALESCE(v_matriz.radio_metros, 300) THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'Debes estar en casa matriz para marcar (estás a ' || round(v_distancia)::TEXT || 'm).'
    );
  END IF;

  -- 5. No haya en_espera abierto
  SELECT id INTO v_existe FROM despacho_motoristas
   WHERE motorista_id = p_motorista_id AND fecha = CURRENT_DATE AND estado = 'en_espera'
   LIMIT 1;
  IF v_existe IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ya tienes un despacho en espera abierto. Espera la salida o anúlalo.');
  END IF;

  -- 6. Número de ciclo
  SELECT COALESCE(MAX(numero_ciclo), 0) + 1 INTO v_ciclo
    FROM despacho_motoristas
   WHERE motorista_id = p_motorista_id AND fecha = CURRENT_DATE;

  -- 7. ¿Llegó tarde?
  v_llego_tarde := v_hora_local > v_config.horario_llegada_objetivo;

  -- 8. Insertar
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


-- 4.2 Motivo tardanza (post-llegada)
CREATE OR REPLACE FUNCTION fn_set_motivo_tardanza_despacho(
  p_despacho_id UUID,
  p_motivo      TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN
    RETURN json_build_object('ok', false, 'error', 'Motivo de tardanza requerido (mínimo 3 caracteres)');
  END IF;

  UPDATE despacho_motoristas
     SET motivo_tardanza = trim(p_motivo)
   WHERE id = p_despacho_id
     AND llego_tarde = TRUE
     AND estado = 'en_espera';

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Despacho no encontrado o no requiere motivo');
  END IF;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_set_motivo_tardanza_despacho TO authenticated, anon;


-- 4.3 Marcar salida
CREATE OR REPLACE FUNCTION fn_marcar_salida_despacho(
  p_despacho_id     UUID,
  p_lat             DOUBLE PRECISION,
  p_lng             DOUBLE PRECISION,
  p_sucursales      JSONB,      -- [{"sucursal_id":"uuid","producto_faltante":"texto?"}, ...]
  p_notas_generales TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_despacho   despacho_motoristas%ROWTYPE;
  v_matriz     sucursales%ROWTYPE;
  v_config     configuracion_despacho_kpi%ROWTYPE;
  v_distancia  DOUBLE PRECISION;
  v_now        TIMESTAMPTZ := NOW();
  v_tiempo_min NUMERIC;
  v_item       JSONB;
BEGIN
  -- Sucursales obligatorias
  IF p_sucursales IS NULL OR jsonb_array_length(p_sucursales) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Debes seleccionar al menos una sucursal');
  END IF;

  -- Cargar despacho
  SELECT * INTO v_despacho FROM despacho_motoristas WHERE id = p_despacho_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Despacho no encontrado');
  END IF;
  IF v_despacho.estado <> 'en_espera' THEN
    RETURN json_build_object('ok', false, 'error', 'Este despacho ya está ' || v_despacho.estado);
  END IF;
  IF v_despacho.llego_tarde AND COALESCE(v_despacho.motivo_tardanza, '') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'Debes registrar el motivo de tardanza antes de marcar salida');
  END IF;

  -- GPS
  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;
  SELECT * INTO v_matriz FROM sucursales WHERE store_code = v_config.matriz_store_code;
  v_distancia := fn_haversine_metros(p_lat, p_lng, v_matriz.lat, v_matriz.lng);
  IF v_distancia > COALESCE(v_matriz.radio_metros, 300) THEN
    RETURN json_build_object('ok', false, 'error', 'Debes estar en casa matriz para marcar salida (a ' || round(v_distancia)::TEXT || 'm).');
  END IF;

  -- Tiempo
  v_tiempo_min := EXTRACT(EPOCH FROM (v_now - v_despacho.hora_llegada)) / 60.0;

  UPDATE despacho_motoristas
     SET hora_salida = v_now,
         lat_salida = p_lat,
         lng_salida = p_lng,
         tiempo_despacho_minutos = round(v_tiempo_min::numeric, 2),
         notas_generales = NULLIF(trim(COALESCE(p_notas_generales, '')), ''),
         estado = 'despachado'
   WHERE id = p_despacho_id;

  -- Insertar sucursales destino
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
    'tiempo_despacho_minutos', round(v_tiempo_min::numeric, 2),
    'color', CASE
      WHEN v_tiempo_min < v_config.tiempo_max_verde_min    THEN 'verde'
      WHEN v_tiempo_min < v_config.tiempo_max_amarillo_min THEN 'amarillo'
      ELSE 'rojo'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_marcar_salida_despacho TO authenticated, anon;


-- 4.4 Anular marcaje
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
    RETURN json_build_object('ok', false, 'error', 'Pasaron más de ' || v_config.minutos_anulacion || ' min. Ya no se puede anular.');
  END IF;

  UPDATE despacho_motoristas
     SET estado = 'anulado',
         anulado_en = NOW(),
         anulado_por = p_motorista_id
   WHERE id = p_despacho_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_anular_marcaje_despacho TO authenticated, anon;


-- 4.5 Justificar retraso (encargado)
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
-- 5. VIEW para frontend (despachos del día + agregados)
-- ============================================================
CREATE OR REPLACE VIEW v_despachos_kpi AS
SELECT
  d.id,
  d.motorista_id,
  d.motorista_nombre,
  d.fecha,
  d.numero_ciclo,
  d.hora_llegada,
  d.hora_salida,
  d.llego_tarde,
  d.motivo_tardanza,
  d.tiempo_despacho_minutos,
  d.notas_generales,
  d.estado,
  d.anulado_en,
  -- Semáforo
  CASE
    WHEN d.estado = 'anulado'                                              THEN 'gris'
    WHEN d.tiempo_despacho_minutos IS NULL                                 THEN 'pendiente'
    WHEN d.tiempo_despacho_minutos < cfg.tiempo_max_verde_min               THEN 'verde'
    WHEN d.tiempo_despacho_minutos < cfg.tiempo_max_amarillo_min            THEN 'amarillo'
    ELSE 'rojo'
  END AS color_semaforo,
  -- Minutos en espera (si aplica)
  CASE WHEN d.estado = 'en_espera'
       THEN EXTRACT(EPOCH FROM (NOW() - d.hora_llegada)) / 60.0
       ELSE NULL END AS minutos_en_espera,
  -- Sucursales destino
  COALESCE(
    (SELECT json_agg(json_build_object(
              'sucursal_id', dks.sucursal_id,
              'sucursal_nombre', s.nombre,
              'store_code', s.store_code,
              'producto_faltante', dks.producto_faltante
            ) ORDER BY s.nombre)
       FROM despacho_kpi_sucursales dks
       JOIN sucursales s ON s.id = dks.sucursal_id
      WHERE dks.despacho_id = d.id),
    '[]'::json
  ) AS sucursales,
  -- Justificación si existe
  (SELECT json_build_object(
            'categoria', j.motivo_categoria,
            'detalle',   j.motivo_detalle,
            'encargado_nombre', j.encargado_nombre,
            'obligatoria', j.obligatoria,
            'created_at', j.created_at
          )
     FROM justificacion_retrasos_despacho j
    WHERE j.despacho_id = d.id) AS justificacion
FROM despacho_motoristas d
CROSS JOIN (SELECT * FROM configuracion_despacho_kpi WHERE id = 1) cfg;

GRANT SELECT ON v_despachos_kpi TO authenticated, anon;


-- ============================================================
-- 6. RPC dashboard (agregaciones)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_kpi_despacho_dashboard(
  p_fecha_inicio DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
  p_fecha_fin    DATE DEFAULT CURRENT_DATE
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_config configuracion_despacho_kpi%ROWTYPE;
  v_result JSON;
BEGIN
  SELECT * INTO v_config FROM configuracion_despacho_kpi WHERE id = 1;

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
    )
  ) INTO v_result FROM base;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_kpi_despacho_dashboard TO authenticated, anon;


-- ============================================================
-- 7. RLS (patrón ERP: SELECT abierto, escritura via RPCs)
-- ============================================================
ALTER TABLE despacho_motoristas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE despacho_kpi_sucursales          ENABLE ROW LEVEL SECURITY;
ALTER TABLE justificacion_retrasos_despacho  ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_despacho_kpi       ENABLE ROW LEVEL SECURITY;

-- SELECT abierto (anon + authenticated). La app valida rol via PIN/RPCs.
CREATE POLICY pol_dm_select  ON despacho_motoristas             FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pol_dks_select ON despacho_kpi_sucursales         FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pol_jrd_select ON justificacion_retrasos_despacho FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pol_cfg_select ON configuracion_despacho_kpi      FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON despacho_motoristas             TO anon, authenticated;
GRANT SELECT ON despacho_kpi_sucursales         TO anon, authenticated;
GRANT SELECT ON justificacion_retrasos_despacho TO anon, authenticated;
GRANT SELECT ON configuracion_despacho_kpi      TO anon, authenticated;


-- ============================================================
-- 8. COMENTARIOS (autodocumentación)
-- ============================================================
COMMENT ON TABLE despacho_motoristas             IS 'KPI tiempo de despacho. Cada fila = ciclo llegada→salida del motorista en CM001. Mide productividad del equipo de bodega (Marcos, Denny, Jessica). Independiente de despachos_sucursal.';
COMMENT ON TABLE despacho_kpi_sucursales         IS 'Sucursales destino por ciclo. 1 ciclo → N sucursales. UNIQUE(despacho_id, sucursal_id).';
COMMENT ON TABLE justificacion_retrasos_despacho IS 'Justificación por encargados. Obligatoria si tiempo > tiempo_max_amarillo_min (rojo). Opcional caso contrario.';
COMMENT ON TABLE configuracion_despacho_kpi      IS 'Singleton (id=1) con thresholds y horarios. GPS de matriz se lee de sucursales.matriz_store_code.';

-- ============================================================
-- FIN MIGRATION
-- ============================================================
