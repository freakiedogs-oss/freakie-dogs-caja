-- ════════════════════════════════════════════════════════════════════════
-- Delivery propio: la comida pasa a "Lista" cuando cocina la termina,
-- también en los pedidos de tarjeta (21-sep-2026, reporte de Lari / Torre)
--
-- Problema: la Torre sólo se enteraba de que la comida estaba lista por el
-- trigger trg_delivery_sync_lista, que escucha pos_cuentas.estado → 'lista'.
-- Ese cambio lo hace el KDS al bumpear la comanda, PERO con el filtro
-- "no tocar si ya está cobrada" (incidente Usulután 4-sep). Los pedidos de
-- tarjeta/link se cobran al entrar (168 de 193 en la última semana: cobrada
-- ANTES de que cocina los termine), así que el bump no cambia la cuenta, el
-- trigger nunca dispara y el pedido queda "En cocina" en la Torre hasta que
-- alguien lo marca a mano desde el panel de delivery del KDS (o hasta que el
-- motorista lo recoge, que salta directo a en_camino). Con efectivo nunca pasa
-- porque se cobra a la entrega.
--
-- Ahora: la señal sale de la cola de cocina, no del estado de la cuenta. Cuando
-- se completa el último ítem de una cuenta con pedido de delivery, el pedido
-- pasa a 'lista' sin importar si la cuenta ya se cobró. Si cocina revierte la
-- comanda (vuelve un ítem a pendiente) y el motorista todavía no lo recogió,
-- el pedido vuelve a 'preparando'. El trigger viejo queda: es idempotente y
-- sigue cubriendo el caso efectivo.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.fn_cocina_sync_delivery_lista()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_delivery_id uuid;
  v_pendientes  int;
begin
  if NEW.cuenta_id is null then return NEW; end if;

  select delivery_cliente_id into v_delivery_id
    from public.pos_cuentas where id = NEW.cuenta_id;
  if v_delivery_id is null then return NEW; end if;

  -- Lo que a cocina todavía le falta de esta cuenta. 'anulado' no cuenta: la
  -- caja ya lo quitó y sólo espera la confirmación de cocina (igual que el KDS,
  -- que bumpea la comanda sin mirar los anulados).
  select count(*) into v_pendientes
    from public.pos_cocina_queue
   where cuenta_id = NEW.cuenta_id
     and estado not in ('completado', 'cancelado', 'anulado');

  if NEW.estado = 'completado' and OLD.estado is distinct from 'completado' then
    if v_pendientes = 0 then
      update public.delivery_clientes
         set estado = 'lista', updated_at = now()
       where id = v_delivery_id
         and estado in ('preparando', 'recibida');
    end if;

  elsif NEW.estado = 'pendiente' and OLD.estado = 'completado' then
    -- Revertir en el KDS: la comida no estaba lista. Sólo si aún no salió.
    update public.delivery_clientes
       set estado = 'preparando', updated_at = now()
     where id = v_delivery_id
       and estado = 'lista'
       and recogido_at is null;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_cocina_sync_delivery_lista on public.pos_cocina_queue;
create trigger trg_cocina_sync_delivery_lista
  after update of estado on public.pos_cocina_queue
  for each row execute function public.fn_cocina_sync_delivery_lista();

comment on function public.fn_cocina_sync_delivery_lista() is
  'Pasa delivery_clientes a lista cuando cocina completa el último ítem de la cuenta, aunque la cuenta ya esté cobrada (pedidos de tarjeta). Revierte a preparando si el KDS deshace el bump y el motorista no lo ha recogido.';
