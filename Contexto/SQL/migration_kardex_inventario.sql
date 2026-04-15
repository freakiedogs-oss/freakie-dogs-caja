-- Migración: Kardex + Items DTE — 14-Abr-2026

-- Table 1: Movimientos de Kardex (audit trail de inventario)
CREATE TABLE IF NOT EXISTS kardex_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID NOT NULL REFERENCES catalogo_productos(id),
  sucursal_id UUID NOT NULL REFERENCES sucursales(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('recepcion','despacho','ajuste_manual','conteo_fisico','produccion','merma','devolucion')),
  cantidad NUMERIC NOT NULL, -- positive = entry, negative = exit
  stock_anterior NUMERIC NOT NULL,
  stock_posterior NUMERIC NOT NULL,
  referencia_tipo TEXT, -- 'recepcion', 'despacho', 'inventario_fisico', 'manual'
  referencia_id UUID,
  notas TEXT,
  usuario_id UUID REFERENCES usuarios_erp(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kardex_producto ON kardex_movimientos(producto_id, created_at DESC);
CREATE INDEX idx_kardex_sucursal ON kardex_movimientos(sucursal_id, created_at DESC);
CREATE INDEX idx_kardex_tipo ON kardex_movimientos(tipo);

-- IMPORTANT: Grants for Supabase
GRANT SELECT ON kardex_movimientos TO anon;
GRANT ALL ON kardex_movimientos TO authenticated;

-- Table 2: Items extraídos de DTEs (para mapeo a catálogo)
CREATE TABLE IF NOT EXISTS compras_dte_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dte_codigo TEXT NOT NULL REFERENCES compras_dte(dte_codigo),
  linea INT NOT NULL,
  descripcion_original TEXT NOT NULL,
  cantidad NUMERIC,
  precio_unitario NUMERIC,
  monto_linea NUMERIC,
  producto_id UUID REFERENCES catalogo_productos(id),
  confianza_mapeo TEXT CHECK (confianza_mapeo IN ('auto','manual','sugerido')),
  mapeado_por UUID REFERENCES usuarios_erp(id),
  mapeado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dte_items_codigo ON compras_dte_items(dte_codigo);
CREATE INDEX idx_dte_items_sin_mapear ON compras_dte_items(producto_id) WHERE producto_id IS NULL;

GRANT SELECT ON compras_dte_items TO anon;
GRANT ALL ON compras_dte_items TO authenticated;

-- Function: Extraer items desde JSON de DTEs
CREATE OR REPLACE FUNCTION extraer_items_dte(p_dte_codigo TEXT DEFAULT NULL)
RETURNS INT AS $$
DECLARE
  rec RECORD;
  item JSONB;
  idx INT;
  total_inserted INT := 0;
BEGIN
  FOR rec IN
    SELECT dte_codigo, json_original
    FROM compras_dte
    WHERE json_original IS NOT NULL
      AND (p_dte_codigo IS NULL OR dte_codigo = p_dte_codigo)
      AND dte_codigo NOT IN (SELECT DISTINCT dte_codigo FROM compras_dte_items)
  LOOP
    idx := 1;
    FOR item IN SELECT jsonb_array_elements(
      COALESCE(
        rec.json_original->'cuerpoDocumento',
        rec.json_original->'body'->'cuerpoDocumento',
        '[]'::jsonb
      )
    )
    LOOP
      INSERT INTO compras_dte_items (dte_codigo, linea, descripcion_original, cantidad, precio_unitario, monto_linea)
      VALUES (
        rec.dte_codigo,
        idx,
        COALESCE(item->>'descripcion', item->>'nombre', 'Sin descripción'),
        (item->>'cantidad')::NUMERIC,
        COALESCE((item->>'precioUni')::NUMERIC, (item->>'precio')::NUMERIC),
        COALESCE((item->>'ventaGravada')::NUMERIC, (item->>'compra')::NUMERIC, (item->>'montoDescu')::NUMERIC)
      );
      idx := idx + 1;
      total_inserted := total_inserted + 1;
    END LOOP;
  END LOOP;
  RETURN total_inserted;
END;
$$ LANGUAGE plpgsql;
