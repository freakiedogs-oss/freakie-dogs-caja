-- ══════════════════════════════════════════════════════════════════════
-- Prueba de la capa de BD del pago con tarjeta (n1co) — SE REVIERTE SOLA
-- ══════════════════════════════════════════════════════════════════════
--
-- Corre el ciclo completo contra la base REAL y después lo deshace: el bloque
-- termina con un RAISE EXCEPTION que aborta la transacción. Por eso puede
-- ejecutar `_comanda_delivery` sin que el pedido de prueba llegue nunca al KDS
-- de una tienda ni deje un pago fantasma en `pagos_online`.
--
-- Los resultados salen en el mensaje de la excepción. Que "falle" es lo
-- esperado: si termina sin excepción, algo dejó datos escritos.
--
-- Uso: pegarlo en el SQL editor de Supabase, o
--      psql "$DATABASE_URL" -f scripts/test-pago-online.sql
--
-- Qué verifica:
--   1. iniciar devuelve el monto de la BD (no el que mande el cliente)
--   2. resolver 'aprobado' marca cobrado y comanda a cocina
--   3. resolver repetido es idempotente (no comanda dos veces)
--   4. iniciar sobre un pedido ya pagado se rechaza
--   5. un pedido viejo se rechaza por expirado
--   6. anon NO puede ejecutar las RPC de pago
-- ══════════════════════════════════════════════════════════════════════

do $$
declare
  SUCURSAL constant uuid := '1382bdc6-4349-43af-86e9-1989b9b529de';  -- S002 Usulután
  ITEM     constant uuid := '2df64fe9-e101-4cb9-8ae1-a8c8179f1a0e';  -- Friki Soda $0.50

  v_ped    uuid;
  v_token  uuid;
  v_ini    jsonb;
  v_res1   jsonb;
  v_res2   jsonb;
  v_ini2   jsonb;
  v_viejo  jsonb;
  v_cob    boolean;
  v_cuenta uuid;
  v_estado text;
  v_anon   boolean;
  r        text := '';
  ok       int := 0;
  fallas   int := 0;
begin
  -- ── Pedido de prueba ──
  insert into public.delivery_clientes(
    numero_orden, sucursal_id, cliente_nombre, cliente_telefono, cliente_direccion,
    items, metodo_pago, subtotal, costo_envio, total, estado, tipo)
  values (
    'TEST-PAGO-' || substr(gen_random_uuid()::text, 1, 6), SUCURSAL,
    'Cliente Prueba', '70000000', '[Prueba] no despachar',
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', ITEM, 'nombre', 'Friki Soda', 'precio', 0.50,
      'cantidad', 2, 'modificadores', '[]'::jsonb,
      'precio_modificadores', 0, 'subtotal', 1.00)),
    'tarjeta', 1.00, 1.00, 2.00, 'recibida', 'delivery')
  returning id, tracking_token into v_ped, v_token;

  -- ── 1. iniciar devuelve el monto de la BD ──
  v_ini := public.pago_online_iniciar(v_token, 'sandbox');
  if (v_ini->>'ok')::boolean and (v_ini->>'monto')::numeric = 2.00 then
    ok := ok + 1; r := r || E'\n  ✅ 1. iniciar → monto autoritativo $' || (v_ini->>'monto');
  else
    fallas := fallas + 1; r := r || E'\n  ❌ 1. iniciar → ' || v_ini::text;
  end if;

  -- ── 2. aprobar cobra y comanda ──
  v_res1 := public.pago_online_resolver(jsonb_build_object(
    'pago_id', v_ini->>'pago_id', 'estado', 'aprobado',
    'card_id', 'tok_prueba', 'authorization_code', '123456',
    'marca', 'Visa', 'last4', '5556'));
  select cobrado, pos_cuenta_id, estado into v_cob, v_cuenta, v_estado
    from public.delivery_clientes where id = v_ped;
  if v_cob and v_cuenta is not null and v_estado = 'preparando' then
    ok := ok + 1;
    r := r || E'\n  ✅ 2. aprobado → cobrado=t, estado=preparando, comanda ' || v_cuenta;
  else
    fallas := fallas + 1;
    r := r || E'\n  ❌ 2. aprobado → cobrado=' || v_cob || ' cuenta=' || coalesce(v_cuenta::text,'null')
           || ' estado=' || v_estado || ' res=' || v_res1::text;
  end if;

  -- ── 3. resolver repetido es idempotente ──
  v_res2 := public.pago_online_resolver(jsonb_build_object(
    'pago_id', v_ini->>'pago_id', 'estado', 'aprobado'));
  if (v_res2->>'ya_resuelto')::boolean
     and (select count(*) from public.pos_cuentas where id = v_cuenta) = 1 then
    ok := ok + 1; r := r || E'\n  ✅ 3. resolver x2 → idempotente, una sola comanda';
  else
    fallas := fallas + 1; r := r || E'\n  ❌ 3. resolver x2 → ' || v_res2::text;
  end if;

  -- ── 4. no se puede volver a cobrar ──
  v_ini2 := public.pago_online_iniciar(v_token, 'sandbox');
  if not (v_ini2->>'ok')::boolean and v_ini2->>'motivo' = 'ya_pagado' then
    ok := ok + 1; r := r || E'\n  ✅ 4. segundo cobro → rechazado (ya_pagado)';
  else
    fallas := fallas + 1; r := r || E'\n  ❌ 4. segundo cobro → ' || v_ini2::text;
  end if;

  -- ── 5. pedido viejo: expirado ──
  update public.delivery_clientes
     set cobrado = false, pos_cuenta_id = null, created_at = now() - interval '5 hours'
   where id = v_ped;
  v_viejo := public.pago_online_iniciar(v_token, 'sandbox');
  if not (v_viejo->>'ok')::boolean and v_viejo->>'motivo' = 'expirado' then
    ok := ok + 1; r := r || E'\n  ✅ 5. pedido de hace 5 h → rechazado (expirado)';
  else
    fallas := fallas + 1; r := r || E'\n  ❌ 5. pedido viejo → ' || v_viejo::text;
  end if;

  -- ── 6. anon no puede tocar las RPC de pago ──
  select has_function_privilege('anon', 'public.pago_online_resolver(jsonb)', 'execute')
      or has_function_privilege('anon', 'public.pago_online_iniciar(uuid,text)', 'execute')
    into v_anon;
  if not v_anon then
    ok := ok + 1; r := r || E'\n  ✅ 6. anon sin execute sobre las RPC de pago';
  else
    fallas := fallas + 1; r := r || E'\n  ❌ 6. ANON PUEDE EJECUTAR LAS RPC DE PAGO — comida gratis';
  end if;

  -- El RAISE aborta la transacción: todo lo de arriba se deshace.
  raise exception E'\n═══ PRUEBA PAGO ONLINE ═══%\n\n  %/% pasaron · todo revertido, no quedó nada escrito',
    r, ok, ok + fallas;
end $$;
