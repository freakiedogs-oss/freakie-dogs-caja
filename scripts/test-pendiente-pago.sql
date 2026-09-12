-- ══════════════════════════════════════════════════════════════════════
-- Prueba del estado `pendiente_pago` — SE REVIERTE SOLA
-- ══════════════════════════════════════════════════════════════════════
--
-- Mismo patrón que los otros arneses: corre contra la base real, incluida la
-- comanda a cocina, y aborta con RAISE EXCEPTION al final. No deja pedidos
-- fantasma en el KDS. Que "falle" es lo esperado.
--
-- Las dos pruebas que sostienen el diseño:
--   · #2 — un pedido con tarjeta sin pagar es INVISIBLE para la torre.
--   · #5 — un pedido PAGADO fuera de cobertura sale a 'recibida' y NO se
--          queda invisible con la plata cobrada. Es el peor escenario posible
--          de este cambio.
--
-- Uso: psql "$DATABASE_URL" -f scripts/test-pendiente-pago.sql
-- Última corrida: 9/9 (12-sep-2026)
-- ══════════════════════════════════════════════════════════════════════

do $$
declare
  SUC constant uuid := '1382bdc6-4349-43af-86e9-1989b9b529de';  -- S002 Usulután
  IT  constant uuid := '2df64fe9-e101-4cb9-8ae1-a8c8179f1a0e';  -- Friki Soda $0.50
  TEL constant text := '70000000';
  v_a uuid; v_ta uuid; v_b uuid; v_tb uuid; v_c uuid; v_tc uuid;
  v_i jsonb; v_m jsonb; v_r jsonb; v_e jsonb; v_est text; v_mp text; v_cta uuid;
  v_mis jsonb;
  r text := ''; ok int := 0; f int := 0;
begin
  -- ══ A: pedido con tarjeta → se marca pendiente → se PAGA ══
  insert into public.delivery_clientes(numero_orden,sucursal_id,cliente_nombre,cliente_telefono,
    cliente_direccion,items,metodo_pago,subtotal,costo_envio,total,estado,tipo)
  values ('TEST-A-'||substr(gen_random_uuid()::text,1,6),SUC,'P',TEL,'dir',
    jsonb_build_array(jsonb_build_object('menu_item_id',IT,'nombre','Friki Soda','precio',0.50,
      'cantidad',8,'modificadores','[]'::jsonb,'precio_modificadores',0,'subtotal',4.00)),
    'tarjeta',4.00,0,4.00,'recibida','delivery')
  returning id, tracking_token into v_a, v_ta;

  v_m := public.pedido_marcar_pendiente_pago(v_ta);
  select estado into v_est from public.delivery_clientes where id = v_a;
  if (v_m->>'ok')::boolean and v_est = 'pendiente_pago' then
    ok:=ok+1; r:=r||E'\n  ✅ 1. marcar pendiente_pago';
  else f:=f+1; r:=r||E'\n  ❌ 1. '||v_m::text||' estado='||v_est; end if;

  if not exists (select 1 from public.delivery_clientes
                  where id=v_a and estado in ('recibida','preparando','lista','en_camino')) then
    ok:=ok+1; r:=r||E'\n  ✅ 2. INVISIBLE para la torre';
  else f:=f+1; r:=r||E'\n  ❌ 2. la torre lo vería'; end if;

  v_mis := public.mis_pedidos_delivery(TEL);
  if jsonb_array_length(v_mis->'pendientes') >= 1
     and not exists (select 1 from jsonb_array_elements(v_mis->'activos') a
                      where a->>'tracking_token' = v_ta::text) then
    ok:=ok+1; r:=r||E'\n  ✅ 3. sale en "pendientes" del cliente y NO en "activos"';
  else f:=f+1; r:=r||E'\n  ❌ 3. '||(v_mis->'pendientes')::text; end if;

  v_i := public.pago_online_iniciar(v_ta,'produccion');
  v_r := public.pago_online_resolver(jsonb_build_object(
    'pago_id', v_i->>'pago_id','estado','aprobado','authorization_code','111222'));
  select estado, pos_cuenta_id into v_est, v_cta from public.delivery_clientes where id = v_a;
  if v_est = 'preparando' and v_cta is not null then
    ok:=ok+1; r:=r||E'\n  ✅ 4. al aprobar sale de pendiente_pago → preparando + comanda';
  else f:=f+1; r:=r||E'\n  ❌ 4. estado='||v_est||' cuenta='||coalesce(v_cta::text,'null'); end if;

  -- ══ B: pagado FUERA DE COBERTURA (sin sucursal) — el peor escenario ══
  insert into public.delivery_clientes(numero_orden,sucursal_id,cliente_nombre,cliente_telefono,
    cliente_direccion,items,metodo_pago,subtotal,costo_envio,total,estado,tipo)
  values ('TEST-B-'||substr(gen_random_uuid()::text,1,6),NULL,'P',TEL,'dir',
    jsonb_build_array(jsonb_build_object('menu_item_id',IT,'nombre','Friki Soda','precio',0.50,
      'cantidad',8,'modificadores','[]'::jsonb,'precio_modificadores',0,'subtotal',4.00)),
    'tarjeta',4.00,0,4.00,'recibida','delivery')
  returning id, tracking_token into v_b, v_tb;
  perform public.pedido_marcar_pendiente_pago(v_tb);
  v_i := public.pago_online_iniciar(v_tb,'produccion');
  v_r := public.pago_online_resolver(jsonb_build_object('pago_id',v_i->>'pago_id','estado','aprobado'));
  select estado into v_est from public.delivery_clientes where id = v_b;
  if v_est = 'recibida' and (v_r->>'motivo') = 'sin_sucursal' then
    ok:=ok+1; r:=r||E'\n  ✅ 5. pagado sin cobertura → VISIBLE en recibida (no se pierde)';
  else f:=f+1; r:=r||E'\n  ❌ 5. estado='||v_est||' res='||v_r::text; end if;

  -- ══ C: rechazo → el cliente elige efectivo ══
  insert into public.delivery_clientes(numero_orden,sucursal_id,cliente_nombre,cliente_telefono,
    cliente_direccion,items,metodo_pago,subtotal,costo_envio,total,estado,tipo)
  values ('TEST-C-'||substr(gen_random_uuid()::text,1,6),SUC,'P',TEL,'dir',
    jsonb_build_array(jsonb_build_object('menu_item_id',IT,'nombre','Friki Soda','precio',0.50,
      'cantidad',8,'modificadores','[]'::jsonb,'precio_modificadores',0,'subtotal',4.00)),
    'tarjeta',4.00,0,4.00,'recibida','delivery')
  returning id, tracking_token into v_c, v_tc;
  perform public.pedido_marcar_pendiente_pago(v_tc);
  v_i := public.pago_online_iniciar(v_tc,'produccion');
  perform public.pago_online_resolver(jsonb_build_object(
    'pago_id',v_i->>'pago_id','estado','rechazado','error_code','51'));
  select estado into v_est from public.delivery_clientes where id = v_c;
  if v_est = 'pendiente_pago' then
    ok:=ok+1; r:=r||E'\n  ✅ 6. rechazo NO lo saca de pendiente_pago (puede reintentar)';
  else f:=f+1; r:=r||E'\n  ❌ 6. estado='||v_est; end if;

  v_e := public.pedido_cambiar_a_efectivo(v_tc);
  select estado, metodo_pago into v_est, v_mp from public.delivery_clientes where id = v_c;
  if (v_e->>'ok')::boolean and v_est='recibida' and v_mp='efectivo' then
    ok:=ok+1; r:=r||E'\n  ✅ 7. "mejor efectivo" → recibida + efectivo (visible para Karina)';
  else f:=f+1; r:=r||E'\n  ❌ 7. estado='||v_est||' metodo='||v_mp; end if;

  v_e := public.pedido_cambiar_a_efectivo(v_ta);
  if not (v_e->>'ok')::boolean then
    ok:=ok+1; r:=r||E'\n  ✅ 8. no deja pasar a efectivo un pedido YA COBRADO';
  else f:=f+1; r:=r||E'\n  ❌ 8. dejó convertir uno pagado'; end if;

  if not (has_function_privilege('anon','public.pedido_marcar_pendiente_pago(uuid)','execute')
       or has_function_privilege('anon','public.pedido_cambiar_a_efectivo(uuid)','execute')) then
    ok:=ok+1; r:=r||E'\n  ✅ 9. anon sin execute sobre las RPC nuevas';
  else f:=f+1; r:=r||E'\n  ❌ 9. ANON PUEDE EJECUTARLAS'; end if;

  raise exception E'\n═══ FASE 2: pendiente_pago ═══%\n\n  %/% pasaron · todo revertido', r, ok, ok+f;
end $$;
