-- PeYa: constancia de entrega al motorista (anti-robo de pedidos).
--
-- 23-nov-2026. Pasa seguido que un motorista de PedidosYa se lleva un pedido y
-- no lo marca como retirado en su app; después viene otro motorista a reclamarlo
-- y PedidosYa nos lo cobra a nosotros. PedidosYa no manda el nombre ni el ID del
-- motorista: lo único que tenemos es el webhook ORDER_PICKED_UP, que llega
-- cuando el motorista aprieta «pedido en camino».
--
-- Ahora la cajera registra el momento en que entrega la bolsa («Entregué al
-- motorista», con foto opcional del motorista/placa/bolsa). Si a los 2 minutos
-- no llegó ORDER_PICKED_UP, la caja suena y le avisa que no lo deje irse sin
-- marcar el retiro. Queda constancia (hora, quién entregó, foto, hora del
-- retiro) para pelear el reclamo con PedidosYa.

alter table public.peya_ordenes
  add column if not exists entregado_at      timestamptz,
  add column if not exists entregado_por     text,
  add column if not exists entrega_foto_url  text,
  add column if not exists retirado_at       timestamptz;

-- Hora en que PedidosYa confirmó el retiro (estado pasa a 'retirado').
create or replace function public._peya_marca_retirado()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.estado = 'retirado' and new.estado is distinct from old.estado
     and new.retirado_at is null then
    new.retirado_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_peya_marca_retirado on public.peya_ordenes;
create trigger trg_peya_marca_retirado
  before update of estado on public.peya_ordenes
  for each row execute function public._peya_marca_retirado();

-- La cajera registra la entrega. Mismo control de PIN/rol/sucursal que peya_panel.
create or replace function public.peya_registrar_entrega(
  p_pin text, p_orden_id bigint, p_foto_url text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user record; v_suc_id uuid; v_o record; v_foto text;
begin
  select u.rol, u.store_code, u.nombre into v_user
    from public.usuarios_erp u where u.pin = btrim(p_pin) and u.activo limit 1;
  if v_user.store_code is null then raise exception 'PIN inválido'; end if;
  if v_user.rol not in ('cocina','gerente','cajero','cajera','jefe_casa_matriz',
                        'admin','superadmin','ejecutivo','telefono') then
    raise exception 'Tu rol no puede registrar entregas de PedidosYa';
  end if;

  select id into v_suc_id from public.sucursales where store_code = v_user.store_code;
  select o.id, o.sucursal_id, o.estado, o.tipo_orden, o.entregado_at
    into v_o from public.peya_ordenes o where o.id = p_orden_id;
  if v_o.id is null then raise exception 'Pedido no encontrado'; end if;
  if v_o.sucursal_id is distinct from v_suc_id
     and v_user.rol not in ('admin','superadmin','ejecutivo','telefono') then
    raise exception 'Ese pedido es de otra sucursal';
  end if;
  if v_o.estado in ('rechazado','cancelado') then
    raise exception 'El pedido está %', v_o.estado;
  end if;

  v_foto := nullif(btrim(coalesce(p_foto_url, '')), '');
  if v_foto is not null and v_foto !~ '^https://' then
    raise exception 'URL de foto inválida';
  end if;

  update public.peya_ordenes
     set entregado_at     = coalesce(entregado_at, now()),
         entregado_por    = coalesce(entregado_por, v_user.nombre),
         entrega_foto_url = coalesce(v_foto, entrega_foto_url),
         actualizado_at   = now()
   where id = p_orden_id;

  return jsonb_build_object('ok', true, 'entregado_at',
    (select entregado_at from public.peya_ordenes where id = p_orden_id));
end;
$$;

revoke all on function public.peya_registrar_entrega(text, bigint, text) from public;
grant execute on function public.peya_registrar_entrega(text, bigint, text) to anon, authenticated;

-- peya_panel devuelve los datos de la entrega. Se reescribe la función vigente
-- agregando las columnas nuevas junto a las del motorista, sin tocar el resto.
do $$
declare
  v_def text := pg_get_functiondef('public.peya_panel(text)'::regprocedure);
begin
  if position('o.entregado_at' in v_def) = 0 then
    v_def := replace(v_def, '      o.motorista_cobro_at,',
      '      o.motorista_cobro_at,
      o.entregado_at, o.entregado_por, o.entrega_foto_url, o.retirado_at,
      case when o.entregado_at is not null
           then greatest(0, floor(extract(epoch from (now() - o.entregado_at))))::int
      end as entregado_segundos,');
    if position('o.entregado_at' in v_def) = 0 then
      raise exception 'peya_panel: no se encontró el punto de inserción';
    end if;
    execute v_def;
  end if;
end $$;
