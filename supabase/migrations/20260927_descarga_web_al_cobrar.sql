-- 27-sep-2026 (Frank): los pedidos web descargan inventario AL COBRAR, no al entrar a cocina.
--
-- Dos escenarios, porque no todos se cobran igual:
--   * Tarjeta en línea (n1co / link_pago): el cobro ocurre en el checkout. La cuenta ya nace
--     'cobrada' (pago_online_resolver o torre_confirmar_pago con cobrado=true) y descarga en ese
--     momento. Esto NO cambia.
--   * Efectivo (y el que al final paga con link o transferencia en caja): la torre lo manda a
--     cocina con la cuenta en 'enviada_cocina'. Antes descargaba ahí; ahora NO: descarga cuando
--     la caja lo cobra (POSMain → pos_deducir_inventario), con la cuenta ya corregida.
--
-- Por qué: si el pedido se corrige en caja (se quita o agrega algo), antes quedaba la descarga
-- vieja + una devolución, o peor: lo agregado nunca descargaba (pos_deducir_inventario es
-- idempotente por cuenta y se salía sin descontar lo nuevo).

-- Descarga solo si la cuenta ya está cobrada. Aislada: nunca frena el envío a cocina.
create or replace function public._web_descargar_si_cobrada(p_cuenta_id uuid, p_store_code text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_estado text;
begin
  if p_cuenta_id is null or p_store_code is null then
    return jsonb_build_object('ok', false, 'nota', 'sin cuenta o sucursal');
  end if;
  select estado into v_estado from public.pos_cuentas where id = p_cuenta_id;
  if v_estado is distinct from 'cobrada' then
    return jsonb_build_object('ok', true, 'descargada', false,
      'nota', 'se descarga al cobrar (cuenta ' || coalesce(v_estado,'?') || ')');
  end if;
  begin
    return public.pos_deducir_inventario(p_cuenta_id, p_store_code);
  exception when others then
    raise warning 'inventario no descargado (cuenta %): %', p_cuenta_id, sqlerrm;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
end $$;

-- ── confirmar_pago_delivery: ya no descarga al comandar un pedido sin cobrar ──
create or replace function public.confirmar_pago_delivery(p_delivery_id uuid, p_sucursal_id uuid default null::uuid, p_metodo_pago text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_row public.delivery_clientes%rowtype;
  v_suc uuid; v_cuenta uuid; v_store text; v_ded jsonb;
begin
  select * into v_row from public.delivery_clientes where id = p_delivery_id for update;
  if not found then raise exception 'delivery % no existe', p_delivery_id; end if;

  if v_row.pos_cuenta_id is not null then
    -- Ya estaba comandado: descarga solo si ya se cobró (si no, lo hace la caja al cobrar).
    select store_code into v_store from public.sucursales where id = v_row.sucursal_id;
    v_ded := public._web_descargar_si_cobrada(v_row.pos_cuenta_id, v_store);
    return jsonb_build_object('ok', true, 'ya_comandado', true,
      'pos_cuenta_id', v_row.pos_cuenta_id, 'inventario', v_ded);
  end if;

  v_suc := coalesce(p_sucursal_id, v_row.sucursal_id);
  if v_suc is null then
    raise exception 'sin sucursal: rutear el pedido antes de confirmar el pago';
  end if;

  update public.delivery_clientes
     set sucursal_id = v_suc,
         metodo_pago = coalesce(p_metodo_pago, metodo_pago),
         estado = 'preparando'
   where id = v_row.id;

  v_cuenta := public._comanda_delivery(v_row.id);

  select store_code into v_store from public.sucursales where id = v_suc;
  -- La cuenta recién comandada está en 'enviada_cocina': no descarga. Si viene de
  -- pago_online_resolver, esa función la pasa a 'cobrada' y descarga después.
  v_ded := public._web_descargar_si_cobrada(v_cuenta, v_store);

  return jsonb_build_object('ok', true, 'pos_cuenta_id', v_cuenta, 'inventario', v_ded);
end;
$function$;

-- ── torre_confirmar_pago: descarga solo si el pedido ya venía pagado en línea ──
create or replace function public.torre_confirmar_pago(p_token uuid, p_delivery_id uuid, p_sucursal_id uuid default null::uuid, p_metodo text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_row    public.delivery_clientes%rowtype;
  v_suc    uuid;
  v_cuenta uuid;
  v_pago   public.pagos_online%rowtype;
  v_store  text;
  v_ignore record;
begin
  select * into v_ignore from public._staff_valida(p_token); -- lanza si invalido
  select * into v_row from public.delivery_clientes where id = p_delivery_id for update;
  if not found then raise exception 'pedido no existe'; end if;
  if v_row.pos_cuenta_id is not null then
    return jsonb_build_object('ok', true, 'ya_comandado', true, 'pos_cuenta_id', v_row.pos_cuenta_id);
  end if;

  v_suc := coalesce(p_sucursal_id, v_row.sucursal_id);
  if v_suc is null then raise exception 'sin sucursal: asigna una antes de confirmar el pago'; end if;

  update public.delivery_clientes
     set sucursal_id = v_suc,
         metodo_pago = coalesce(p_metodo, metodo_pago),
         estado      = 'preparando'
   where id = v_row.id;

  v_cuenta := public._comanda_delivery(v_row.id);

  if v_cuenta is not null then
    select store_code into v_store from public.sucursales where id = v_suc;

    -- Tarjeta en línea: ya se cobró en el checkout → la cuenta queda cobrada y descarga ya.
    if v_row.cobrado then
      select * into v_pago from public.pagos_online
       where delivery_id = v_row.id and estado = 'aprobado'
       order by updated_at desc limit 1;

      if found and not exists (select 1 from public.pos_cuenta_pagos
                                where cuenta_id = v_cuenta and anulado = false) then
        insert into public.pos_cuenta_pagos (cuenta_id, metodo, monto, referencia)
        values (v_cuenta, 'link_pago', v_pago.monto,
                'n1co ' || coalesce(v_pago.order_id, v_pago.id::text)
                || coalesce(' aut.' || v_pago.authorization_code, ''));
      end if;

      update public.pos_cuentas
         set estado     = 'cobrada',
             cobrada_at = coalesce(cobrada_at, now())
       where id = v_cuenta and estado <> 'cobrada';
    end if;

    -- Efectivo: la cuenta sigue sin cobrar y esto no hace nada; descarga la caja al cobrar.
    perform public._web_descargar_si_cobrada(v_cuenta, v_store);
  end if;

  return jsonb_build_object('ok', true, 'pos_cuenta_id', v_cuenta);
end;
$function$;

-- ── torre_mover_sucursal: en la sucursal nueva descarga solo si el cobro venía hecho ──
create or replace function public.torre_mover_sucursal(p_token uuid, p_delivery_id uuid, p_sucursal_destino uuid, p_motivo text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_row      public.delivery_clientes%rowtype;
  v_staff    record;
  v_origen   uuid;
  v_cta_vieja uuid;
  v_cta_nueva uuid;
  v_store_d  text;
  v_pago     public.pos_cuenta_pagos%rowtype;
  v_traslado uuid;
  v_nom_o    text;
  v_nom_d    text;
begin
  select * into v_staff from public._staff_valida(p_token);

  select * into v_row from public.delivery_clientes where id = p_delivery_id for update;
  if not found then raise exception 'pedido no existe'; end if;

  if v_row.estado not in ('preparando','lista') then
    raise exception 'este pedido ya va en camino o fue entregado (%): no se puede cambiar de sucursal', v_row.estado;
  end if;

  v_origen := v_row.sucursal_id;
  if v_origen is null then raise exception 'el pedido no tiene sucursal de origen'; end if;
  if v_origen = p_sucursal_destino then
    raise exception 'el pedido ya esta en esa sucursal';
  end if;

  select nombre into v_nom_o from public.sucursales where id = v_origen;
  select nombre, store_code into v_nom_d, v_store_d from public.sucursales where id = p_sucursal_destino;
  if v_store_d is null then raise exception 'sucursal destino no existe'; end if;

  v_cta_vieja := v_row.pos_cuenta_id;

  if v_cta_vieja is not null then
    delete from public.pos_cocina_queue where cuenta_id = v_cta_vieja;

    select * into v_pago from public.pos_cuenta_pagos
     where cuenta_id = v_cta_vieja and anulado = false limit 1;
    delete from public.pos_cuenta_pagos where cuenta_id = v_cta_vieja;

    update public.pos_cuentas
       set estado = 'cancelada',
           cancelada_motivo = 'Trasladado a ' || v_nom_d ||
                              coalesce(' · ' || nullif(btrim(p_motivo),''), ''),
           cancelada_por = v_staff.usuario_id,
           updated_at = now()
     where id = v_cta_vieja;
  end if;

  update public.delivery_clientes
     set sucursal_id   = p_sucursal_destino,
         pos_cuenta_id = null,
         estado        = 'preparando',
         updated_at    = now()
   where id = v_row.id;

  v_cta_nueva := public._comanda_delivery(v_row.id);

  if v_cta_nueva is not null then
    if v_pago.id is not null then
      insert into public.pos_cuenta_pagos (cuenta_id, metodo, monto, referencia, monto_recibido, cambio)
      values (v_cta_nueva, v_pago.metodo, v_pago.monto,
              coalesce(v_pago.referencia,'') || ' · trasladado de ' || v_nom_o,
              v_pago.monto_recibido, v_pago.cambio);

      update public.pos_cuentas
         set estado = 'cobrada', cobrada_at = coalesce(cobrada_at, now())
       where id = v_cta_nueva;
    end if;

    -- Pagado en línea: descarga ya en la nueva. Efectivo: descarga la caja nueva al cobrar.
    perform public._web_descargar_si_cobrada(v_cta_nueva, v_store_d);
  end if;

  -- La sucursal de origen responde si alcanzó a prepararlo (traslado_responder / _kds).
  insert into public.delivery_traslados
    (delivery_id, sucursal_origen_id, sucursal_destino_id,
     cuenta_origen_id, cuenta_destino_id, motivo, movido_por)
  values (v_row.id, v_origen, p_sucursal_destino,
          v_cta_vieja, v_cta_nueva, nullif(btrim(p_motivo),''), v_staff.usuario_id)
  returning id into v_traslado;

  return jsonb_build_object(
    'ok', true,
    'traslado_id', v_traslado,
    'de', v_nom_o, 'a', v_nom_d,
    'cuenta_nueva', v_cta_nueva,
    'pregunta_pendiente', 'La sucursal de origen debe confirmar si ya habia preparado el pedido');
end;
$function$;

-- ── Traslados: si el origen YA lo preparó y nunca se descargó (efectivo), va como merma ──
create or replace function public._traslado_merma_origen(p_t public.delivery_traslados, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_store text;
begin
  if p_t.cuenta_origen_id is null then return jsonb_build_object('nota','sin cuenta de origen'); end if;
  if exists (select 1 from public.kardex_movimientos k
              where k.referencia_tipo='pos_cuenta' and k.referencia_id = p_t.cuenta_origen_id
                and k.tipo in ('venta','merma')) then
    return jsonb_build_object('nota','ya estaba descontado en origen (pagado en línea)');
  end if;
  select store_code into v_store from public.sucursales where id = p_t.sucursal_origen_id;
  return public.pos_deducir_inventario(p_t.cuenta_origen_id, v_store, 'merma');
end $$;

create or replace function public.traslado_responder(p_token uuid, p_traslado_id uuid, p_ya_preparado boolean)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_staff record;
  v_t     public.delivery_traslados%rowtype;
  v_items jsonb;
  v_store text;
  v_n     int := 0;
  v_m     jsonb;
begin
  select * into v_staff from public._staff_valida(p_token);

  select * into v_t from public.delivery_traslados where id = p_traslado_id for update;
  if not found then raise exception 'traslado no existe'; end if;
  if v_t.ya_preparado is not null then
    return jsonb_build_object('ok', true, 'ya_respondido', true, 'ya_preparado', v_t.ya_preparado);
  end if;

  update public.delivery_traslados
     set ya_preparado = p_ya_preparado, respondido_por = v_staff.usuario_id, respondido_at = now()
   where id = v_t.id;

  if p_ya_preparado then
    v_m := public._traslado_merma_origen(v_t, v_staff.usuario_id);
    return jsonb_build_object('ok', true, 'ya_preparado', true,
                              'inventario', 'merma en origen', 'kardex', v_m);
  end if;

  select store_code into v_store from public.sucursales where id = v_t.sucursal_origen_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', x.producto_id, 'cantidad', -x.total)), '[]'::jsonb)
    into v_items
  from (select k.producto_id, sum(k.cantidad) as total
          from public.kardex_movimientos k
         where k.referencia_tipo='pos_cuenta' and k.referencia_id = v_t.cuenta_origen_id
           and k.tipo='venta'
         group by k.producto_id) x;

  if v_items <> '[]'::jsonb then
    perform public.kardex_mover_lote(
      v_items, 'devolucion', 'traslado_sucursal', v_t.id,
      'Devolucion por traslado del pedido a otra sucursal: la tienda confirmo que NO alcanzo a prepararlo',
      v_staff.usuario_id, v_t.sucursal_origen_id, true);
    select jsonb_array_length(v_items) into v_n;
    update public.delivery_traslados set kardex_revertido = true where id = v_t.id;
  end if;

  return jsonb_build_object('ok', true, 'ya_preparado', false,
                            'insumos_devueltos', v_n,
                            'inventario', case when v_n > 0 then 'devuelto a ' || coalesce(v_store,'origen')
                                               else 'no se había descontado (efectivo): nada que devolver' end);
end;
$function$;

create or replace function public.traslado_responder_kds(p_store_code text, p_traslado_id uuid, p_ya_preparado boolean, p_usuario_id uuid default null::uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_t     public.delivery_traslados%rowtype;
  v_suc   uuid;
  v_items jsonb;
  v_n     int := 0;
  v_m     jsonb;
begin
  select id into v_suc from public.sucursales where store_code = p_store_code;
  if v_suc is null then raise exception 'sucursal % no existe', p_store_code; end if;

  select * into v_t from public.delivery_traslados where id = p_traslado_id for update;
  if not found then raise exception 'traslado no existe'; end if;
  if v_t.sucursal_origen_id <> v_suc then
    raise exception 'ese traslado no es de esta sucursal';
  end if;
  if v_t.ya_preparado is not null then
    return jsonb_build_object('ok', true, 'ya_respondido', true, 'ya_preparado', v_t.ya_preparado);
  end if;

  update public.delivery_traslados
     set ya_preparado = p_ya_preparado, respondido_por = p_usuario_id, respondido_at = now()
   where id = v_t.id;

  if p_ya_preparado then
    v_m := public._traslado_merma_origen(v_t, p_usuario_id);
    return jsonb_build_object('ok', true, 'ya_preparado', true,
                              'inventario', 'merma en origen', 'kardex', v_m);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', x.producto_id, 'cantidad', -x.total)), '[]'::jsonb)
    into v_items
  from (select k.producto_id, sum(k.cantidad) as total
          from public.kardex_movimientos k
         where k.referencia_tipo='pos_cuenta' and k.referencia_id = v_t.cuenta_origen_id
           and k.tipo='venta'
         group by k.producto_id) x;

  if v_items <> '[]'::jsonb then
    perform public.kardex_mover_lote(
      v_items, 'devolucion', 'traslado_sucursal', v_t.id,
      'Devolucion por traslado: la sucursal confirmo que NO alcanzo a preparar el pedido',
      p_usuario_id, v_t.sucursal_origen_id, true);
    select jsonb_array_length(v_items) into v_n;
    update public.delivery_traslados set kardex_revertido = true where id = v_t.id;
  end if;

  return jsonb_build_object('ok', true, 'ya_preparado', false, 'insumos_devueltos', v_n);
end;
$function$;

-- ── Barrido de respaldo: el corte es la hora del COBRO, no la de entrada ──
-- Un pedido en efectivo que entró antes del conteo y se cobró después se descarga
-- en el día siguiente (el conteo ya lo encontró físicamente fuera): no se salta.
create or replace function public.barrer_cuentas_sin_descarga(p_dias integer default 3)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v record; v_r jsonb; v_n int := 0; v_ok int := 0; v_mal int := 0;
  v_saltadas int := 0; v_detalle jsonb := '[]'::jsonb;
begin
  for v in
    with corte as (
      select k.sucursal_id, max(k.created_at) as conteo_at
        from public.kardex_movimientos k
       where k.tipo = 'conteo_fisico'
         and k.created_at > now() - interval '30 days'
       group by k.sucursal_id
    )
    select c.id, c.store_code, c.tipo, c.total, c.created_at,
           (co.conteo_at is not null and coalesce(c.cobrada_at, c.created_at) < co.conteo_at) as ya_contada
      from public.pos_cuentas c
      left join public.sucursales s on s.store_code = c.store_code
      left join corte co on co.sucursal_id = s.id
     where c.created_at > now() - make_interval(days => greatest(1, p_dias))
       and c.estado = 'cobrada'
       and c.store_code is not null
       and not exists (
         select 1 from public.kardex_movimientos k
          where k.referencia_tipo='pos_cuenta' and k.referencia_id = c.id
            and k.tipo in ('venta','merma'))
     order by c.created_at
     limit 500
  loop
    if v.ya_contada then
      v_saltadas := v_saltadas + 1;
      continue;
    end if;
    v_n := v_n + 1;
    begin
      v_r := public.pos_deducir_inventario(v.id, v.store_code);
      if coalesce((v_r->>'ok')::boolean, false)
         and coalesce((v_r#>>'{kardex,n}')::int, 0) > 0 then
        v_ok := v_ok + 1;
        v_detalle := v_detalle || jsonb_build_object(
          'cuenta', v.id, 'tienda', v.store_code, 'canal', v.tipo,
          'total', v.total, 'resultado', 'descargada');
      end if;
    exception when others then
      v_mal := v_mal + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'cuenta', v.id, 'tienda', v.store_code, 'error', sqlerrm);
    end;
  end loop;

  if v_n > 0 or v_saltadas > 0 then
    insert into public.inventario_barrido_log(cuentas, reparadas, fallidas, detalle)
    values (v_n, v_ok, v_mal,
            v_detalle || jsonb_build_object('saltadas_por_conteo', v_saltadas));
  end if;

  return jsonb_build_object('ok', true, 'revisadas', v_n, 'reparadas', v_ok,
    'fallidas', v_mal, 'saltadas_por_conteo', v_saltadas);
end;
$function$;

revoke all on function public._web_descargar_si_cobrada(uuid, text) from public, anon, authenticated;
revoke all on function public._traslado_merma_origen(public.delivery_traslados, uuid) from public, anon, authenticated;
