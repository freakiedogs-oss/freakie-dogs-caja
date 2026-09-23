-- ─────────────────────────────────────────────────────────────────────────────
-- Pruebas de la integración con PedidosYa — lo que exige el Checklist Técnico
-- que mandaron el 22-sep-2026.
--
-- CÓMO SE CORRE
--   Pegar entero en el SQL editor de Supabase, o `psql -f`. No pide parámetros.
--
-- QUÉ NO HACE
--   No llama a PedidosYa. Prueba la lógica que vive en la base, que es donde
--   están las decisiones: qué cierre rige, si un aviso repetido reinicia el
--   reloj, cuánto de un descuento sale de nuestro bolsillo. Las llamadas
--   salientes se prueban con `peya-selftest`, que sí sale a la red.
--
-- POR QUÉ NO USA UNA SUCURSAL DE VERDAD
--   Crea su propio vendor `TEST-HOMOLOGACION`, lo usa y lo borra al final. Una
--   prueba que deja basura en Cafetalón es peor que no tener prueba.
--
-- Queda como función para poder re-correrla con `select peya_test_homologacion()`
-- sin volver a cargar el archivo entero.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.peya_test_homologacion()
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $fn$
declare
  v_suc     uuid;
  v_vendor  text := 'TEST-HOMOLOGACION';
  v_orden   bigint;
  v_r       jsonb;
  v_n       numeric;
  v_ok      int := 0;
  v_fail    int := 0;
  v_fallos  text[] := '{}';

  -- El payload de descuentos con los cinco escenarios que piden certificar,
  -- armado con la forma exacta del ejemplo de pluginApi.yaml.
  v_desc jsonb := '{
    "discounts": [
      {"name":"100% Partner","amount":"5.00","sponsorships":[{"sponsor":"VENDOR","amount":"5.00"}]},
      {"name":"100% PeYa","amount":"4.00","sponsorships":[{"sponsor":"PLATFORM","amount":"4.00"}]},
      {"name":"Compartido","amount":"6.00","sponsorships":[{"sponsor":"PLATFORM","amount":"3.00"},{"sponsor":"VENDOR","amount":"3.00"}]},
      {"name":"Voucher","amount":"3.00","sponsorships":[{"sponsor":"THIRD_PARTY","amount":"3.00"}]},
      {"name":"Sin atribucion","amount":"2.00"}
    ],
    "products": [
      {"name":"COMBO","paidPrice":"8.00",
       "discounts":[{"name":"Compartido","amount":"4.00","sponsorships":[{"sponsor":"PLATFORM","amount":"2.00"},{"sponsor":"VENDOR","amount":"2.00"}]}],
       "selectedToppings":[{"name":"extra queso","price":"1.50",
         "discounts":[{"name":"Compartido","amount":"2.00","sponsorships":[{"sponsor":"PLATFORM","amount":"1.00"},{"sponsor":"VENDOR","amount":"1.00"}]}]}]}
    ]}'::jsonb;
begin
  -- ── Montaje ────────────────────────────────────────────────────────────────
  select id into v_suc from public.sucursales where store_code = 'M001';
  if v_suc is null then raise exception 'no existe la sucursal M001'; end if;

  delete from public.peya_vendor_map where remote_id = v_vendor;
  -- `vendor_code` es NOT NULL: es el código del local del lado de la logística.
  insert into public.peya_vendor_map (remote_id, vendor_code, sucursal_id,
                                      activo, es_pruebas, chain_code)
  values (v_vendor, v_vendor, v_suc, true, false, 'CHAINDEPRUEBA0001');

  -- ═══ BLOQUE 1 · Estado y disponibilidad de la tienda ═══════════════════════

  -- 1. Lista de cierres vacía ⇒ la tienda está abierta.
  perform public.peya_availability_webhook(v_vendor, now() - interval '10 min', '[]'::jsonb);
  v_r := public.peya_disponibilidad(v_vendor);
  if (v_r->>'disponible')::boolean then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '1. cierres vacíos debería ser ABIERTA'; end if;

  -- 2. Un cierre vigente cierra la tienda, y gana sobre uno que aún no empieza.
  perform public.peya_availability_webhook(v_vendor, now() - interval '9 min', jsonb_build_array(
    jsonb_build_object('reason','TOO_BUSY_KITCHEN','start', now() - interval '1 hour',
                       'end', now() + interval '2 hours','changeable', true),
    jsonb_build_object('reason','UPDATES_IN_MENU','start', now() + interval '2 days',
                       'end', null,'changeable', true)));
  v_r := public.peya_disponibilidad(v_vendor);
  if not (v_r->>'disponible')::boolean and v_r->>'motivo' = 'TOO_BUSY_KITCHEN' then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('2. debería estar CERRADA por TOO_BUSY_KITCHEN, dio ' || coalesce(v_r::text,'null')); end if;

  -- 3. Un cierre que ya venció NO cierra: la tienda reabre sola, sin tarea de fondo.
  perform public.peya_availability_webhook(v_vendor, now() - interval '8 min', jsonb_build_array(
    jsonb_build_object('reason','TOO_BUSY_KITCHEN','start', now() - interval '3 hours',
                       'end', now() - interval '1 hour','changeable', true)));
  v_r := public.peya_disponibilidad(v_vendor);
  if (v_r->>'disponible')::boolean then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '3. un cierre vencido no debería cerrar la tienda'; end if;

  -- 4. Un cierre sin `end` es permanente.
  perform public.peya_availability_webhook(v_vendor, now() - interval '7 min', jsonb_build_array(
    jsonb_build_object('reason','FOOD_HYGIENE','start', now() - interval '1 hour',
                       'end', null,'changeable', false)));
  v_r := public.peya_disponibilidad(v_vendor);
  if not (v_r->>'disponible')::boolean and v_r->>'cerrada_hasta' is null then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '4. cierre sin end debería ser permanente'; end if;

  -- 5. `changeable: false` ⇒ el local no puede levantarlo.
  if (v_r->>'levantable')::boolean = false then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '5. changeable:false debería marcar levantable=false'; end if;

  -- 6. El `timestamp` es ancla de orden: una notificación vieja se ignora.
  --    Sin esto, un reenvío desordenado reabriría una tienda que está cerrada.
  v_r := public.peya_availability_webhook(v_vendor, now() - interval '30 min', '[]'::jsonb);
  if v_r->>'ignorado' is not null then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '6. una notificación más vieja debería ignorarse'; end if;

  -- 7. …y de verdad no la aplicó: la tienda sigue cerrada.
  v_r := public.peya_disponibilidad(v_vendor);
  if not (v_r->>'disponible')::boolean then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '7. la notificación vieja NO debía cambiar el estado'; end if;

  -- 8. Un vendor que no existe no revienta: contesta que no está mapeado.
  v_r := public.peya_availability_webhook('NO-EXISTE-JAMAS', now(), '[]'::jsonb);
  if (v_r->>'ok')::boolean = false and v_r->>'error' = 'vendor_no_mapeado' then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '8. vendor inexistente debería dar vendor_no_mapeado'; end if;

  -- ═══ BLOQUE 2 · Avisos del motorista ═══════════════════════════════════════

  insert into public.peya_ordenes (order_token, remote_order_id, vendor_remote_id,
                                   sucursal_id, estado, es_prueba, payload)
  values ('TOK-TEST-HOMOLOGACION', 'FD-TEST-HOMOLOGACION', v_vendor, v_suc, 'aceptado', true, v_desc)
  returning id into v_orden;

  -- 9. Llegó el motorista: queda la hora, pero todavía no está "esperando".
  v_r := public.peya_motorista_evento('FD-TEST-HOMOLOGACION','COURIER_ARRIVED_AT_VENDOR', null, null);
  if (v_r->>'ok')::boolean and v_r->>'llego_at' is not null and (v_r->>'esperando')::boolean = false
  then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '9. COURIER_ARRIVED debería fijar llego_at sin marcar esperando'; end if;

  -- 10. El aviso de espera usa el `waitingStartsAt` del contrato, no la hora en
  --     que nos llegó: es cuándo empezó a correr la espera de verdad.
  v_r := public.peya_motorista_evento('FD-TEST-HOMOLOGACION','SHOW_RIDER_WAITING_WARNING',
          null, now() + interval '5 min');
  if (v_r->>'esperando')::boolean and v_r->>'cobro_desde' is not null then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '10. SHOW_RIDER debería marcar esperando y guardar el cobro'; end if;

  -- 11. EL IMPORTANTE: un aviso repetido NO reinicia el reloj. Si lo reiniciara,
  --     "lleva 12 minutos esperando" sería mentira justo cuando más importa.
  declare v_antes timestamptz; v_despues timestamptz;
  begin
    select motorista_llego_at into v_antes from public.peya_ordenes where id = v_orden;
    perform pg_sleep(0.05);
    perform public.peya_motorista_evento('FD-TEST-HOMOLOGACION','SHOW_RIDER_WAITING_WARNING', null, null);
    select motorista_llego_at into v_despues from public.peya_ordenes where id = v_orden;
    if v_antes = v_despues then v_ok := v_ok + 1;
    else v_fail := v_fail + 1; v_fallos := v_fallos || '11. un aviso repetido NO debe reiniciar el reloj de espera'; end if;
  end;

  -- 12. HIDE apaga el cartel y borra la hora de cobro.
  v_r := public.peya_motorista_evento('FD-TEST-HOMOLOGACION','HIDE_RIDER_WAITING_WARNING', null, null);
  if (v_r->>'esperando')::boolean = false and v_r->>'cobro_desde' is null then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '12. HIDE_RIDER debería apagar el cartel y el cobro'; end if;

  -- 13. Si "está esperando" llega sin el "llegó" previo (se perdió o vino fuera de
  --     orden), igual se asume que está parado en la puerta.
  update public.peya_ordenes set motorista_llego_at = null, motorista_esperando = false
   where id = v_orden;
  v_r := public.peya_motorista_evento('FD-TEST-HOMOLOGACION','SHOW_RIDER_WAITING_WARNING', null, null);
  if v_r->>'llego_at' is not null then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '13. SHOW_RIDER sin COURIER_ARRIVED previo debería asumir que llegó'; end if;

  -- 14. Un pedido que no existe contesta not_found, no revienta.
  v_r := public.peya_motorista_evento('FD-NO-EXISTE','SHOW_RIDER_WAITING_WARNING', null, null);
  if (v_r->>'ok')::boolean = false and v_r->>'error' = 'not_found' then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '14. pedido inexistente debería dar not_found'; end if;

  -- ═══ BLOQUE 2 · Descuentos y patrocinio ════════════════════════════════════

  -- 15. Los cinco escenarios se leen: cinco descuentos a nivel orden.
  select count(*) into v_n from public.peya_descuentos(v_desc) where nivel = 'orden';
  if v_n = 5 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('15. deberían ser 5 descuentos de orden, hay ' || v_n); end if;

  -- 16. 100% Partner: todo sale de nuestro bolsillo.
  select nuestro into v_n from public.peya_descuentos(v_desc)
   where nivel='orden' and nombre='100% Partner';
  if v_n = 5.00 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('16. 100% Partner debería ser 5.00 nuestro, dio ' || v_n); end if;

  -- 17. 100% PeYa: no nos cuesta nada.
  select nuestro into v_n from public.peya_descuentos(v_desc)
   where nivel='orden' and nombre='100% PeYa';
  if v_n = 0 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('17. 100% PeYa no debería costarnos nada, dio ' || v_n); end if;

  -- 18. Compartido: mitad y mitad.
  select peya into v_n from public.peya_descuentos(v_desc)
   where nivel='orden' and nombre='Compartido';
  if v_n = 3.00 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('18. Compartido debería poner 3.00 PeYa, dio ' || v_n); end if;

  -- 19. Voucher: lo pone un tercero.
  select tercero into v_n from public.peya_descuentos(v_desc)
   where nivel='orden' and nombre='Voucher';
  if v_n = 3.00 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('19. el voucher debería ir a tercero, dio ' || v_n); end if;

  -- 20. Sin patrocinio NO es cero: es "no sabemos", y queda señalado.
  select sin_atribuir into v_n from public.peya_descuentos(v_desc)
   where nivel='orden' and nombre='Sin atribucion';
  if v_n = 2.00 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('20. un descuento sin patrocinio debería quedar sin_atribuir, dio ' || v_n); end if;

  -- 21. EL QUE DESCUADRA LA LIQUIDACIÓN: los montos de nivel ítem YA ESTÁN
  --     incluidos en los de orden. Sumar los tres niveles cuenta el mismo dinero
  --     hasta tres veces — acá serían $26 en vez de $20, un 30% inventado.
  v_r := public.peya_descuentos_resumen(v_orden);
  if (v_r->>'total')::numeric = 20.00 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('21. el total debe salir SOLO del nivel orden (20.00), dio ' || (v_r->>'total')); end if;

  -- 22. Lo que de verdad nos cuesta: 5 (Partner) + 3 (mitad del compartido).
  if (v_r->>'lo_ponemos_nosotros')::numeric = 8.00 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || ('22. deberían ser 8.00 nuestros, dio ' || (v_r->>'lo_ponemos_nosotros')); end if;

  -- 23. El resumen avisa cuando hay plata sin atribuir, para que alguien reclame.
  if (v_r->>'hay_sin_atribuir')::boolean then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '23. debería avisar que hay descuento sin atribuir'; end if;

  -- 24. Un pedido sin descuentos da cero, no error.
  update public.peya_ordenes set payload = '{}'::jsonb where id = v_orden;
  v_r := public.peya_descuentos_resumen(v_orden);
  if (v_r->>'ok')::boolean and (v_r->>'total')::numeric = 0 then v_ok := v_ok + 1;
  else v_fail := v_fail + 1; v_fallos := v_fallos || '24. un pedido sin descuentos debería dar total 0'; end if;

  -- ═══ Permisos ══════════════════════════════════════════════════════════════

  -- 25. Una cajera no puede abrir ni cerrar la tienda en PedidosYa.
  begin
    perform public.peya_tienda_abrir_cerrar(
      (select pin from public.usuarios_erp where rol='cajera' and activo limit 1), false, null, 30);
    v_fail := v_fail + 1; v_fallos := v_fallos || '25. una cajera NO debería poder cerrar la tienda';
  exception when others then v_ok := v_ok + 1;
  end;

  -- 26. Un PIN inválido tampoco.
  begin
    perform public.peya_tienda_abrir_cerrar('000000-no-existe', false, null, 30);
    v_fail := v_fail + 1; v_fallos := v_fallos || '26. un PIN inválido NO debería poder cerrar la tienda';
  exception when others then v_ok := v_ok + 1;
  end;

  -- ── Desmontaje ─────────────────────────────────────────────────────────────
  delete from public.peya_ordenes where id = v_orden;
  delete from public.peya_vendor_map where remote_id = v_vendor;

  -- ── Resultado ──────────────────────────────────────────────────────────────
  -- Falla ruidosa y con el detalle adentro del mensaje: los `raise notice` no
  -- siempre llegan al cliente, y una prueba que falla en silencio no sirve.
  return jsonb_build_object(
    'verde', v_ok,
    'de', v_ok + v_fail,
    'todo_ok', v_fail = 0,
    'fallos', to_jsonb(v_fallos)
  );
end $fn$;

-- Correrla deja el resultado a la vista. Si algo falla, `todo_ok` viene en false
-- y `fallos` dice exactamente cuál y qué se esperaba.
select public.peya_test_homologacion();
