-- ════════════════════════════════════════════════════════════════════
-- Cupón de regreso del menú web (10-nov-2026, Cesar; cambio en cobro/DTE
-- AUTORIZADO por Cesar en chat). Aplicadas como cupon_regreso_base,
-- cupon_regreso_en_crear_pedido y cupon_regreso_en_cuenta_pos.
--
-- Regla: un pedido WEB entregado con subtotal ≥ $19.99 («$20» en los textos,
-- así el Burger Box cuenta) que NO usó cupón gana $2 para el próximo pedido de
-- $19.99 o más, válido 21 días, ligado al teléfono. Un cupón activo por
-- teléfono. Si el pedido que lo usó se cancela (o queda sin pagar > 3 h) el
-- cupón vuelve a estar libre.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.delivery_cupones (
  id uuid primary key default gen_random_uuid(),
  telefono text not null,
  monto numeric(10,2) not null default 2.00,
  minimo numeric(10,2) not null default 19.99,
  origen_delivery_id uuid unique references public.delivery_clientes(id) on delete set null,
  creado_at timestamptz not null default now(),
  vence_at timestamptz not null,
  usado_at timestamptz,
  usado_delivery_id uuid references public.delivery_clientes(id) on delete set null
);
create index if not exists delivery_cupones_tel_idx on public.delivery_cupones (telefono, vence_at);
alter table public.delivery_cupones enable row level security;   -- solo vía funciones SECURITY DEFINER

alter table public.delivery_clientes add column if not exists descuento numeric(10,2) not null default 0;
alter table public.delivery_clientes add column if not exists cupon_id uuid references public.delivery_cupones(id) on delete set null;

create or replace function public._cupon_libre(p_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select c.usado_delivery_id is null
      or exists (select 1 from delivery_clientes d where d.id = c.usado_delivery_id
                  and (d.estado = 'cancelada' or (d.estado = 'pendiente_pago' and d.created_at < now() - interval '3 hours')))
    from delivery_cupones c where c.id = p_id;
$$;

create or replace function public.trg_cupon_al_entregar()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if new.estado = 'entregada' and coalesce(old.estado, '') <> 'entregada'
     and new.numero_orden like 'WEB-%' and new.cupon_id is null
     and coalesce(new.subtotal, 0) >= 19.99
     and nullif(new.cliente_telefono, '') is not null
     and not exists (select 1 from delivery_cupones c
                      where c.telefono = new.cliente_telefono and c.vence_at > now() and _cupon_libre(c.id)) then
    insert into delivery_cupones (telefono, monto, minimo, origen_delivery_id, vence_at)
    values (new.cliente_telefono, 2.00, 19.99, new.id, now() + interval '21 days')
    on conflict (origen_delivery_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_cupon_al_entregar on public.delivery_clientes;
create trigger trg_cupon_al_entregar after update of estado on public.delivery_clientes
  for each row execute function public.trg_cupon_al_entregar();

create or replace function public.cupon_activo(p_telefono text)
returns jsonb
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object('monto', c.monto, 'minimo', c.minimo, 'vence_at', c.vence_at,
           'dias', greatest(0, ceil(extract(epoch from (c.vence_at - now())) / 86400))::int)
    from delivery_cupones c
   where c.telefono = regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')
     and c.vence_at > now() and _cupon_libre(c.id)
   order by c.vence_at limit 1;
$$;

create or replace function public.cupon_de_pedido(p_token uuid)
returns jsonb
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object('monto', c.monto, 'minimo', c.minimo, 'vence_at', c.vence_at,
           'dias', greatest(0, ceil(extract(epoch from (c.vence_at - now())) / 86400))::int,
           'libre', c.vence_at > now() and _cupon_libre(c.id))
    from delivery_clientes d join delivery_cupones c on c.origen_delivery_id = d.id
   where d.tracking_token = p_token;
$$;

revoke all on function public._cupon_libre(uuid) from public, anon, authenticated;
grant execute on function public.cupon_activo(text) to anon, authenticated;
grant execute on function public.cupon_de_pedido(uuid) to anon, authenticated;

-- crear_pedido_delivery: aplica el cupón activo del teléfono si el subtotal llega al
-- mínimo (total = subtotal + envío − descuento; guarda descuento y cupon_id; marca el
-- cupón usado; la respuesta trae 'descuento'). Aplicado con replace sobre la
-- definición vigente (ver migración cupon_regreso_en_crear_pedido).
--
-- _comanda_delivery: la cuenta de caja nace con descuento = delivery_clientes.descuento,
-- descuento_tipo 'monto', categoría 'promo', motivo 'Cupón app' (ver
-- cupon_regreso_en_cuenta_pos). POSMain precarga ese descuento al cobrar, así el
-- cobro y el DTE (prorrateo existente de buildDteLineItems) cuadran con lo pagado.
