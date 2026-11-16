-- ════════════════════════════════════════════════════════════════════
-- «Esperá y ahorrá» (16-nov-2026, Cesar)
-- Cuando el delivery de una sucursal está saturado, el checkout ofrece
-- esperar más a cambio de 10% de descuento (tope $3). No se ofrece a clientes
-- en su primer pedido. No se combina con el cupón de regreso (queda guardado).
-- La cocina no hace nada distinto: es solo descuento + menor prioridad.
--
-- Aplicadas en Supabase como:
--   espera_y_ahorra_base               columnas, config, tablas de saturación,
--                                      _delivery_eta(), delivery_espera_estado()
--   espera_y_ahorra_calibrar_eta       piso = mediana real pedido→entregado
--   espera_y_ahorra_eta_sobre_tipico   ETA = típico real + carga actual extra
--   espera_y_ahorra_eta_cola_sin_espera
--   espera_y_ahorra_crear_pedido_y_comanda  (replace sobre crear_pedido_delivery,
--                                      _comanda_delivery, kds_cuando_preparar)
--   espera_y_ahorra_torre_campos       torre_listar_pedidos trae espera_*
--   espera_y_ahorra_tracking           tracking_pedido trae espera_*
--   espera_y_ahorra_reporte            reporte_espera_ahorra(desde)
--   espera_y_ahorra_cron_saturacion    delivery_saturacion_tick() cada 5 min
-- ════════════════════════════════════════════════════════════════════

alter table public.delivery_clientes
  add column if not exists espera_ahorra boolean not null default false,
  add column if not exists espera_promesa_at timestamptz,
  add column if not exists descuento_motivo text;

-- Parámetros (torre → config_delivery):
--   espera_activa 1/0 · espera_umbral_min 50 · espera_pct 10 · espera_tope 3
--   espera_extra_min 25 (cuánto más se promete esperar)
insert into config_delivery (parametro, valor) values
  ('espera_activa','1'), ('espera_umbral_min','50'), ('espera_pct','10'),
  ('espera_tope','3'), ('espera_extra_min','25')
on conflict (parametro) do nothing;

create table if not exists public.delivery_saturacion (
  sucursal_id uuid primary key, saturado_desde timestamptz, ultimo_saturado_at timestamptz,
  eta_min int, updated_at timestamptz not null default now());
alter table public.delivery_saturacion enable row level security;

create table if not exists public.delivery_saturacion_log (
  id bigserial primary key, sucursal_id uuid not null, ts timestamptz not null default now(),
  eta_min int, saturado boolean);
alter table public.delivery_saturacion_log enable row level security;

-- Saturado = ETA ≥ max(umbral 50, típico de esa sucursal/franja + 12) y hay
-- motoristas conectados. ETA = mediana real pedido→entregado (21 días, misma
-- franja) + lo que la carga actual agrega (cocina con >4 comandas, motorista
-- que se libera primero después de la cola sin asignar).
--
-- crear_pedido_delivery(p): si p.espera = true y la sucursal estuvo saturada en
-- los últimos 15 min y el teléfono ya tiene un pedido entregado →
-- descuento = least(10% subtotal, $3), descuento_motivo = 'Espera y ahorra',
-- espera_promesa_at = now() + eta + 25 + 15 min, cupón no se consume.
-- Si no califica: pedido normal y la respuesta trae espera_rechazada = true.
--
-- _comanda_delivery: pos_cuentas.descuento_motivo = delivery_clientes.descuento_motivo
-- (antes fijo 'Cupón app'). El cobro en caja/DTE prorratea igual que el cupón.
-- kds_cuando_preparar: los «espera y ahorra» se ordenan después de los normales.
