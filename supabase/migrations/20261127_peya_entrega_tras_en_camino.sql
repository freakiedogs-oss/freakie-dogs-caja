-- PeYa: la bolsa se entrega DESPUÉS de que el motorista marca «en camino», y
-- un pedido retirado no vuelve a «listo».
--
-- 26/27-nov-2026, pedido de Jose.
--
-- 1) Pedidos que no se cerraban (#5856, #5857, #5900 en Cafetalón): el motorista
--    marcó «en camino» (ORDER_PICKED_UP → estado 'retirado') ANTES de que la cajera
--    apretara «Listo para el driver». Ese botón llegaba después y pisaba el estado
--    con 'preparado', así que el pedido volvía a «Esperando al driver» aunque la
--    cuenta ya estaba cobrada. Ahora un estado final (retirado / cancelado /
--    rechazado) no se puede bajar a uno anterior, venga de donde venga.
--
-- 2) Pasos 8 y 9 al revés: antes la cajera entregaba y después esperábamos que el
--    motorista marcara «en camino» (con alarma a los 2 min). Ahora el motorista
--    marca «en camino» primero; cuando PedidosYa nos lo avisa, la caja le dice a la
--    cajera que ya puede entregar. `peya_registrar_entrega` lo exige en el servidor
--    para pedidos con motorista de PedidosYa: sin «en camino» no hay entrega.
--
-- 3) Hora de cada paso para la bandeja: se agrega `preparado_at` (cuándo se marcó
--    «Listo para el driver») y el panel devuelve también `actualizado_at`.

alter table public.peya_ordenes add column if not exists preparado_at timestamptz;

create or replace function public._peya_marca_retirado()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Un estado final no retrocede. DH puede mandar avisos desordenados y la caja
  -- puede apretar un botón tarde; ninguno de los dos reabre un pedido cerrado.
  if old.estado in ('retirado', 'cancelado', 'rechazado')
     and new.estado in ('recibido', 'aceptado', 'preparado') then
    new.estado := old.estado;
  end if;

  if new.estado = 'retirado' and new.estado is distinct from old.estado
     and new.retirado_at is null then
    new.retirado_at := now();
  end if;

  if new.estado = 'preparado' and new.estado is distinct from old.estado
     and new.preparado_at is null then
    new.preparado_at := now();
  end if;
  return new;
end;
$$;

-- Los tres pedidos pisados vuelven a su estado real. Sus cuentas ya están cobradas.
update public.peya_ordenes
   set estado = 'retirado'
 where estado in ('aceptado', 'preparado')
   and retirado_at is not null;

create or replace function public.peya_registrar_entrega(p_pin text, p_orden_id bigint, p_foto_url text default null)
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
  -- Con motorista de PedidosYa la bolsa sale sólo después de «en camino».
  if v_o.tipo_orden = 'own_delivery' and v_o.estado <> 'retirado' then
    raise exception 'Todavía no: el motorista tiene que marcar «pedido en camino» en su app antes de que le entregues la bolsa';
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

create or replace function public.peya_panel(p_pin text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user record; v_suc_id uuid; v_todas boolean;
  v_pedidos jsonb; v_tienda jsonb; v_rid text;
begin
  select u.rol, u.store_code, u.nombre into v_user
  from public.usuarios_erp u where u.pin = btrim(p_pin) and u.activo limit 1;

  if v_user.store_code is null then raise exception 'PIN inválido'; end if;
  if v_user.rol not in ('cocina','gerente','cajero','cajera','jefe_casa_matriz',
                        'admin','superadmin','ejecutivo','telefono') then
    raise exception 'Tu rol no puede ver los pedidos de PedidosYa';
  end if;

  v_todas := v_user.rol in ('admin','superadmin','ejecutivo','telefono');
  select id into v_suc_id from public.sucursales where store_code = v_user.store_code;

  select v.remote_id into v_rid from public.peya_vendor_map v
  where v.sucursal_id = v_suc_id and v.activo and not v.es_pruebas limit 1;

  if v_rid is not null then
    v_tienda := public.peya_disponibilidad(v_rid)
      || jsonb_build_object('puede_cambiar',
           v_user.rol in ('gerente','jefe_casa_matriz','admin','superadmin','ejecutivo'));
  end if;

  select coalesce(jsonb_agg(p order by p.orden_prio, p.recibido_at), '[]'::jsonb)
    into v_pedidos
  from (
    select
      o.id, o.remote_order_id, o.order_token, o.estado, o.tipo_orden,
      o.expedition_type, o.es_prueba, o.code, o.short_code, o.expiry_date,
      o.recibido_at, o.aceptado_at, o.preparado_at, o.actualizado_at,
      o.motivo_rechazo, o.respuesta_http, o.notas,
      s.nombre as sucursal, s.store_code,
      case when o.estado = 'recibido' and o.expiry_date is not null
           then greatest(0, floor(extract(epoch from (o.expiry_date - now()))))::int
      end as segundos_restantes,
      public.peya_listo_para_retirar(o.id) as cocina,
      c.numero_orden as numero_orden,
      (select max(q.comanda_numero) from public.pos_cocina_queue q
        where q.cuenta_id = o.pos_cuenta_id) as comanda_numero,
      o.motorista_llego_at,
      o.motorista_esperando,
      o.motorista_cobro_at,
      o.entregado_at, o.entregado_por, o.entrega_foto_url, o.retirado_at,
      case when o.entregado_at is not null
           then greatest(0, floor(extract(epoch from (now() - o.entregado_at))))::int
      end as entregado_segundos,
      case when o.retirado_at is not null
           then greatest(0, floor(extract(epoch from (now() - o.retirado_at))))::int
      end as retirado_segundos,
      greatest(0, floor(extract(epoch from (now() - o.recibido_at))))::int as recibido_segundos,
      case when o.motorista_llego_at is not null
           then greatest(0, floor(extract(epoch from (now() - o.motorista_llego_at))))::int
      end as motorista_segundos,
      case when o.motorista_cobro_at is not null
           then floor(extract(epoch from (o.motorista_cobro_at - now())))::int
      end as motorista_segundos_para_cobro,
      o.payload->'customer'  as cliente,
      o.payload->'products'  as productos,
      o.payload->'delivery'  as delivery,
      o.payload->'pickup'    as pickup,
      o.payload->'price'     as precio,
      o.payload->'discounts' as descuentos,
      o.payload->'comments'  as comentarios,
      case when o.estado = 'recibido' then 0
           when o.estado = 'retirado' and o.tipo_orden = 'own_delivery'
                and o.entregado_at is null then 1
           when o.estado = 'aceptado' then 2
           when o.estado = 'preparado' then 3 else 4 end as orden_prio
    from public.peya_ordenes o
    left join public.sucursales s on s.id = o.sucursal_id
    left join public.pos_cuentas c on c.id = o.pos_cuenta_id
    where (v_todas or o.sucursal_id = v_suc_id)
      and (o.estado in ('recibido','aceptado','preparado')
           or o.actualizado_at > now() - interval '3 hours'
           or (o.estado = 'retirado' and o.tipo_orden = 'own_delivery'
               and o.entregado_at is null and o.retirado_at > now() - interval '3 hours'))
  ) p;

  return jsonb_build_object('ok', true, 'usuario', v_user.nombre, 'rol', v_user.rol,
    've_todas', v_todas, 'sucursal', v_user.store_code, 'tienda', v_tienda,
    'servidor_ahora', now(), 'pedidos', v_pedidos);
end;
$$;
