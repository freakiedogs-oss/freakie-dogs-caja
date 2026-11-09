-- ════════════════════════════════════════════════════════════════════
-- Números equivocados (9-nov-2026, pedido de Cesar)
--
-- 1) Confirmación del número en el menú web: a los números que nunca
--    recibieron un pedido se les muestra en grande antes de enviar
--    («¿Este es tu número?»). telefono_verificado() solo devuelve sí/no.
--    (En 30 días ningún número tenía formato inválido: el problema es un
--    dígito equivocado; la mitad de los pedidos vienen de números nuevos.)
-- 2) Botón «Llegué» del motorista: driver_llegue() marca llego_at y la página
--    de seguimiento del cliente avisa en grande «¡Tu motorista está afuera!»
--    (con sonido, vibración y título parpadeando). Llega aunque el teléfono
--    esté mal. tracking_pedido devuelve 'llego_at' y mis_pedidos_driver
--    también (aplicadas: telefono_verificado, driver_llegue, mis_pedidos_driver_llego).
-- ════════════════════════════════════════════════════════════════════

create index if not exists idx_delivery_tel_digitos on public.delivery_clientes
  ((regexp_replace(coalesce(cliente_telefono, ''), '\D', '', 'g'))) where estado = 'entregada';

create or replace function public.telefono_verificado(p_telefono text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from delivery_clientes
     where estado = 'entregada'
       and regexp_replace(coalesce(cliente_telefono, ''), '\D', '', 'g') = right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 8)
       and length(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) >= 8);
$function$;
grant execute on function public.telefono_verificado(text) to anon, authenticated;

alter table public.delivery_clientes add column if not exists llego_at timestamptz;

create or replace function public.driver_llegue(p_empleado_id uuid, p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v delivery_clientes%rowtype;
begin
  select * into v from delivery_clientes where id = p_delivery_id for update;
  if not found then raise exception 'pedido no existe'; end if;
  if v.motorista_id is distinct from p_empleado_id then raise exception 'ese pedido no está asignado a vos'; end if;
  if v.estado <> 'en_camino' then raise exception 'ese pedido no está en camino'; end if;
  update delivery_clientes set llego_at = coalesce(llego_at, now()) where id = p_delivery_id;
  return jsonb_build_object('ok', true, 'llego_at', coalesce(v.llego_at, now()));
end;
$function$;
grant execute on function public.driver_llegue(uuid, uuid) to anon, authenticated;

-- tracking_pedido: mismo cuerpo que en 20261108 + 'llego_at', case when d.estado = 'en_camino' then d.llego_at end
-- mis_pedidos_driver: mismo cuerpo + 'llego_at', d.llego_at
