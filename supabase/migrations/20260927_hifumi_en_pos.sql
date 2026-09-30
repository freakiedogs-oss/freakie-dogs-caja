-- 27-sep-2026 (Frank): pedidos de Hifumi en el POS.
-- Hifumi no entra solo: se digita en caja como tipo 'delivery_app' (botón «Hifumi»,
-- menú Delivery) y se cobra con el método nuevo 'hifumi' = cuenta por cobrar, como PeYa:
-- no entra dinero a la caja, Hifumi liquida por depósito cada 2–3 días. Sin DTE.
-- Descarga inventario al cobrar (POSMain → pos_deducir_inventario), como todo.

alter table public.pos_cuenta_pagos drop constraint pos_cuenta_pagos_metodo_check;
alter table public.pos_cuenta_pagos add constraint pos_cuenta_pagos_metodo_check
  check (metodo = any (array['efectivo','tarjeta','transferencia','link_pago','pedidos_ya','hifumi','otro']));

-- Corte: Hifumi va aparte. Si cayera en 'otros' se sumaría al CxC de PeYa del cierre
-- (sistema_pedidos_ya) y ensuciaría la conciliación de PeYa. Tampoco entra al efectivo
-- esperado ni a total_ventas_quanto de ventas_diarias (que suma ef+tj+tr+link).
create or replace function public.pos_corte(p_store_code text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_turno_id uuid default null::uuid, p_caja text default null::text)
returns jsonb language sql stable as $function$
  WITH cuentas AS (
    SELECT c.id, c.total, c.propina, c.estado, c.dte_tipo
    FROM public.pos_cuentas c
    WHERE c.store_code = p_store_code
      AND c.cobrada_at >= p_desde AND c.cobrada_at < p_hasta
      AND (p_turno_id IS NULL OR c.turno_id = p_turno_id OR c.turno_id IS NULL)
      AND c.estado = 'cobrada'
      AND (p_caja IS NULL OR c.turno_id IN (SELECT t.id FROM public.pos_turnos t WHERE t.caja = p_caja))
  ),
  pagos AS (
    SELECT lower(pg.metodo) AS metodo, SUM(pg.monto) AS monto
    FROM public.pos_cuenta_pagos pg
    JOIN cuentas c ON c.id = pg.cuenta_id
    WHERE pg.anulado = false
    GROUP BY 1
  ),
  canc AS (
    SELECT count(*) n FROM public.pos_cuentas c
    WHERE c.store_code = p_store_code
      AND c.updated_at >= p_desde AND c.updated_at < p_hasta
      AND c.estado = 'cancelada'
      AND (p_turno_id IS NULL OR c.turno_id = p_turno_id OR c.turno_id IS NULL)
      AND (p_caja IS NULL OR c.turno_id IN (SELECT t.id FROM public.pos_turnos t WHERE t.caja = p_caja))
  )
  SELECT jsonb_build_object(
    'efectivo',       COALESCE((SELECT monto FROM pagos WHERE metodo='efectivo'),0),
    'tarjeta',        COALESCE((SELECT monto FROM pagos WHERE metodo='tarjeta'),0),
    'transferencia',  COALESCE((SELECT monto FROM pagos WHERE metodo='transferencia'),0),
    'link_pago',      COALESCE((SELECT monto FROM pagos WHERE metodo='link_pago'),0),
    'mixto',          COALESCE((SELECT monto FROM pagos WHERE metodo='mixto'),0),
    'hifumi',         COALESCE((SELECT monto FROM pagos WHERE metodo='hifumi'),0),
    'otros',          COALESCE((SELECT SUM(monto) FROM pagos WHERE metodo NOT IN ('efectivo','tarjeta','transferencia','link_pago','mixto','hifumi')),0),
    'total',          COALESCE((SELECT SUM(total) FROM cuentas),0),
    'propinas',       COALESCE((SELECT SUM(propina) FROM cuentas),0),
    'n_cuentas',      (SELECT count(*) FROM cuentas),
    'n_cancelaciones',(SELECT n FROM canc),
    'ticket_promedio',CASE WHEN (SELECT count(*) FROM cuentas) > 0
                           THEN ROUND((SELECT SUM(total) FROM cuentas) / (SELECT count(*) FROM cuentas), 2) ELSE 0 END
  );
$function$;
