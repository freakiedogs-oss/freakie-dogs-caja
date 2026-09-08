-- ══════════════════════════════════════════════════════════════════════
-- Prueba de las tarjetas guardadas (n1co) — SE REVIERTE SOLA
-- ══════════════════════════════════════════════════════════════════════
--
-- Igual que scripts/test-pago-online.sql: corre contra la base real y aborta
-- con un RAISE EXCEPTION al final, así que no deja tarjetas de prueba.
-- Los resultados salen en el mensaje. Que "falle" es lo esperado.
--
-- La prueba que importa es la 4: un dispositivo distinto NO puede cobrar la
-- tarjeta de otro aunque conozca el uuid de la tarjeta. Si esa se pone en rojo,
-- cualquiera podría pedir comida cobrándosela a un cliente ajeno.
--
-- Uso: psql "$DATABASE_URL" -f scripts/test-tarjetas-guardadas.sql
-- Última corrida: 6/6 (8-sep-2026)
-- ══════════════════════════════════════════════════════════════════════

do $$
declare
  -- En producción este hash lo calcula la Edge Function sobre un uuid v4 que
  -- solo conoce el navegador del cliente.
  H_MIO   constant text := encode(sha256('secreto-dispositivo-A'::bytea), 'hex');
  H_OTRO  constant text := encode(sha256('secreto-dispositivo-B'::bytea), 'hex');
  v_g     jsonb;
  v_lista jsonb;
  v_cobro jsonb;
  v_ajeno jsonb;
  v_olv   jsonb;
  v_post  jsonb;
  v_anon  boolean;
  r text := ''; ok int := 0; fallas int := 0;
begin
  v_g := public.tarjeta_guardar(jsonb_build_object(
    'dispositivo_hash', H_MIO, 'card_id', 'tok_n1co_abc123',
    'customer_id', 'SV70000000', 'telefono', '70000000',
    'titular', 'JOSE ISART', 'email', 'x@y.com',
    'marca', 'Visa', 'last4', '5556', 'emisor', 'Banco X',
    'vence_mes', '09', 'vence_anio', '2030'));
  if (v_g->>'ok')::boolean then
    ok := ok + 1; r := r || E'\n  ✅ 1. guardar tarjeta';
  else fallas := fallas + 1; r := r || E'\n  ❌ 1. ' || v_g::text; end if;

  -- El token NO puede salir al navegador: con él en mano cualquiera que lo
  -- capturara intentaría cobrar.
  v_lista := public.tarjetas_listar(H_MIO);
  if jsonb_array_length(v_lista) = 1
     and (v_lista->0->>'last4') = '5556'
     and (v_lista->0->>'vence') = '09/30'
     and not (v_lista->0 ? 'card_id') then
    ok := ok + 1; r := r || E'\n  ✅ 2. listar → Visa ····5556 09/30, SIN card_id';
  else fallas := fallas + 1; r := r || E'\n  ❌ 2. ' || v_lista::text; end if;

  v_cobro := public.tarjeta_para_cobro(H_MIO, (v_lista->0->>'id')::uuid);
  if (v_cobro->>'ok')::boolean and v_cobro->>'card_id' = 'tok_n1co_abc123' then
    ok := ok + 1; r := r || E'\n  ✅ 3. mi dispositivo → resuelve el token';
  else fallas := fallas + 1; r := r || E'\n  ❌ 3. ' || v_cobro::text; end if;

  -- ── LA PRUEBA QUE SOSTIENE TODO EL DISEÑO ──
  v_ajeno := public.tarjeta_para_cobro(H_OTRO, (v_lista->0->>'id')::uuid);
  if not (v_ajeno->>'ok')::boolean then
    ok := ok + 1; r := r || E'\n  ✅ 4. otro dispositivo → RECHAZADO (no cobra tarjeta ajena)';
  else fallas := fallas + 1; r := r || E'\n  ❌ 4. OTRO DISPOSITIVO PUDO COBRAR: ' || v_ajeno::text; end if;

  v_olv  := public.tarjeta_olvidar(H_MIO, (v_lista->0->>'id')::uuid);
  v_post := public.tarjeta_para_cobro(H_MIO, (v_lista->0->>'id')::uuid);
  if (v_olv->>'ok')::boolean
     and jsonb_array_length(public.tarjetas_listar(H_MIO)) = 0
     and not (v_post->>'ok')::boolean then
    ok := ok + 1; r := r || E'\n  ✅ 5. olvidar → fuera de la lista y no cobrable';
  else fallas := fallas + 1; r := r || E'\n  ❌ 5. olv=' || v_olv::text || ' post=' || v_post::text; end if;

  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into v_anon
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('tarjetas_listar','tarjeta_para_cobro','tarjeta_guardar','tarjeta_olvidar');
  if not coalesce(v_anon, false) then
    ok := ok + 1; r := r || E'\n  ✅ 6. anon sin execute sobre las RPC de tarjetas';
  else fallas := fallas + 1; r := r || E'\n  ❌ 6. ANON PUEDE EJECUTARLAS'; end if;

  raise exception E'\n═══ PRUEBA TARJETAS GUARDADAS ═══%\n\n  %/% pasaron · todo revertido', r, ok, ok + fallas;
end $$;
