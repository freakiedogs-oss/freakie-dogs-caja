-- Aviso de la central en el link de seguimiento (8-nov-2026, pedido de Cesar).
-- Caso: el cliente no contesta y el motorista ya está afuera. La central pone un
-- texto y un teléfono; el tracking lo muestra en grande con botones Llamar / WhatsApp.
-- tracking_pedido devuelve 'aviso' = {texto, tel} mientras el pedido no esté entregado
-- (aplicada como tracking_aviso_cliente; mismo cuerpo de tracking_pedido + ese campo).
alter table public.delivery_clientes
  add column if not exists aviso_cliente text,
  add column if not exists aviso_tel text,
  add column if not exists aviso_at timestamptz;
