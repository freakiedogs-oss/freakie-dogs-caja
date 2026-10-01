-- ═════════════════════════════════════════════════════════════════════════════
-- Banco de ensayo de pedidos PedidosYa (flujo completo, sin dejar rastro).
--
--   do $$ begin raise exception '%', public.peya_ensayo_lote(1); end $$;
--
-- Cada lote arma pedidos sintéticos con la MISMA forma que manda Delivery Hero
-- (remoteCode = nuestro id, toppings anidados grupo→opción, unitPrice/paidPrice,
-- price.totalNet/grandTotal), los baja por `peya_crear_cuenta`, los recorre
-- (cocina → listo → cobro / cancelación) y valida cada tabla. Termina con
-- `raise exception` adrede: la transacción entera se revierte y ni el KDS ni
-- los números de comanda se enteran. Abre un turno de ensayo si la sucursal
-- no tiene caja (también se revierte).
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.peya_ensayo_top(
  p_grupo text, p_opcion text, p_precio numeric default null,
  p_estilo text default 'anidado', p_nombre_peya text default null)
 returns jsonb language plpgsql stable set search_path to 'public','pg_temp' as $$
declare m record; v_leaf jsonb; v_precio numeric;
begin
  select mo.id, btrim(mo.nombre) as nombre, mo.precio_extra, g.nombre as gnombre into m
    from pos_modificadores mo join pos_modificadores_grupo g on g.id = mo.grupo_id
   where g.nombre = p_grupo and mo.nombre = p_opcion and mo.activo limit 1;
  v_precio := coalesce(p_precio, m.precio_extra, 0);
  v_leaf := jsonb_build_object(
    'id', 'PYT-' || md5(p_grupo || p_opcion), 'name', coalesce(p_nombre_peya, m.nombre, p_opcion),
    'price', to_char(v_precio, 'FM999990.00'), 'quantity', 1, 'type', 'EXTRA',
    'children', '[]'::jsonb, 'discounts', '[]'::jsonb);
  if m.id is not null and p_estilo not like '%sinrc%' then
    v_leaf := v_leaf || jsonb_build_object('remoteCode', m.id::text);
  end if;
  if p_estilo like 'plano%' then return v_leaf; end if;
  v_leaf := jsonb_build_object('id', 'PYG-' || md5(p_grupo), 'name', coalesce(m.gnombre, p_grupo),
              'price', '0.00', 'quantity', 1, 'type', 'PRODUCT', 'children', jsonb_build_array(v_leaf));
  if p_estilo like 'anidado2%' then
    v_leaf := jsonb_build_object('id', 'PYG-raiz', 'name', 'Personalizá tu pedido',
                'price', '0.00', 'quantity', 1, 'type', 'PRODUCT', 'children', jsonb_build_array(v_leaf));
  end if;
  return v_leaf;
end $$;

create or replace function public.peya_ensayo_grupo(p_grupo text, p_hijos jsonb)
 returns jsonb language sql immutable set search_path to 'public','pg_temp' as $$
  select jsonb_build_object('id', 'PYG-' || md5(p_grupo), 'name', p_grupo, 'price', '0.00',
           'quantity', 1, 'type', 'PRODUCT', 'children', p_hijos);
$$;

create or replace function public.peya_ensayo_prod(
  p_nombre text, p_cant int default 1, p_comment text default null,
  p_tops jsonb default '[]'::jsonb, p_remote boolean default true,
  p_nombre_peya text default null, p_unit numeric default null, p_paid numeric default null,
  p_extra jsonb default '{}'::jsonb)
 returns jsonb language plpgsql stable set search_path to 'public','pg_temp' as $$
declare i record; v_tops numeric; v_unit numeric; v_paid numeric; v_out jsonb;
begin
  select id, btrim(nombre) as nombre, precio into i from pos_menu_items
   where menu_id = 'db0f8d05-0d72-435f-bf82-41a776802549' and btrim(nombre) = btrim(p_nombre)
   order by disponible desc, precio desc limit 1;
  select coalesce(sum((t->>'price')::numeric), 0) into v_tops
    from jsonb_array_elements(public.peya_toppings_planos(p_tops)) t;
  v_unit := coalesce(p_unit, i.precio, 0);
  v_paid := coalesce(p_paid, (v_unit + v_tops) * p_cant);
  v_out := jsonb_build_object(
    'id', 'PYP-' || md5(coalesce(i.id::text, p_nombre)),
    'name', coalesce(p_nombre_peya, i.nombre, p_nombre),
    'description', '', 'comment', p_comment,
    'quantity', p_cant::text,
    'unitPrice', to_char(v_unit, 'FM999990.00'),
    'paidPrice', to_char(v_paid, 'FM999990.00'),
    'selectedChoices', '[]'::jsonb, 'selectedToppings', coalesce(p_tops, '[]'::jsonb),
    'discounts', '[]'::jsonb, 'variation', jsonb_build_object('name', ''), 'vatPercentage', '0');
  if p_remote and i.id is not null then v_out := v_out || jsonb_build_object('remoteCode', i.id::text); end if;
  return v_out || coalesce(p_extra, '{}'::jsonb);
end $$;

-- Un pedido: lo inserta, lo baja, lo recorre y valida. Devuelve {n, titulo, ok, fallos, info}.
create or replace function public.peya_ensayo_pedido(p_n int, p_titulo text, p_productos jsonb, p_opts jsonb default '{}'::jsonb)
 returns jsonb language plpgsql volatile set search_path to 'public','pg_temp' as $$
declare
  v_suc      uuid := coalesce(nullif(p_opts->>'sucursal','')::uuid, '8ffb29ec-3d58-4ae1-b0d4-bcd12202456e');
  v_vendor   text := coalesce(p_opts->>'vendor', 'SIMULADO-ENSAYO');
  v_prueba   boolean := coalesce((p_opts->>'es_prueba')::boolean, false);
  v_exp      text := coalesce(p_opts->>'expedition', 'delivery');
  v_short    text := case when coalesce((p_opts->>'sin_short_code')::boolean,false) then null else 'ENS' || lpad(p_n::text, 3, '0') end;
  v_code     text := 'ENSAYO-' || lpad(p_n::text, 3, '0') || '-' || to_char(clock_timestamp(), 'HH24MISSMS');
  v_token    text := 'tok-ensayo-' || p_n || '-' || md5(clock_timestamp()::text);
  v_coment   text := p_opts->>'comentario';
  v_fee      numeric := coalesce((p_opts->>'delivery_fee')::numeric, 1.50);
  v_desc     numeric := coalesce((p_opts->>'descuento')::numeric, 0);
  v_suma_pay numeric;
  v_totalnet numeric;
  v_grand    numeric;
  v_payload  jsonb;
  v_orden    bigint;
  r          jsonb;
  r2         jsonb;
  c          record;
  v_espera   text;
  v_lineas   int;
  v_total    numeric;
  v_fallos   text[] := array[]::text[];
  v_info     jsonb := '{}'::jsonb;
  v_cuenta   uuid;
  v_n        int;
  v_x        numeric;
  v_t        text;
  v_items    jsonb;
  v_q        jsonb;
  v_m        jsonb;
  v_i        int;
  v_nombre   text;
  v_ciclo    text := coalesce(p_opts->>'ciclo', 'ninguno');
  v_c1 int; v_c2 int; v_c3 int; v_c4 int; v_c5 int; v_c6 int; v_c7 int;
  v_uuid uuid; v_ts timestamptz;
begin
  -- ── Armar el payload con la forma de Delivery Hero ────────────────────────
  select coalesce(sum(coalesce(nullif(p->>'paidPrice','')::numeric, nullif(p->>'unitPrice','')::numeric * greatest(1, coalesce(nullif(p->>'quantity','')::numeric,1)))), 0) into v_suma_pay from jsonb_array_elements(p_productos) p;
  v_totalnet := coalesce((p_opts->>'total_net')::numeric, v_suma_pay - v_desc);
  v_grand    := coalesce((p_opts->>'grand_total')::numeric, v_totalnet + v_fee);
  v_payload := jsonb_build_object(
    'token', v_token, 'code', v_code, 'shortCode', v_short,
    'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'expiryDate', to_char((now() + interval '20 min') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'expeditionType', v_exp, 'preOrder', false, 'test', v_prueba,
    'localInfo', jsonb_build_object('countryCode', 'SV', 'currencySymbol', '$', 'platform', 'PedidosYa', 'platformKey', 'PY'),
    'platformRestaurant', jsonb_build_object('id', coalesce(p_opts->>'platform_restaurant_id', 'PR-ENSAYO')),
    'customer', case when coalesce((p_opts->>'sin_customer')::boolean,false) then null
                     else jsonb_build_object('firstName', coalesce(p_opts->>'nombre', 'Ensayo'),
                                             'lastName', coalesce(p_opts->>'apellido', '#' || p_n),
                                             'mobilePhone', '+50370000000', 'code', 'CUST-' || p_n) end,
    'comments', jsonb_build_object('customerComment', v_coment, 'vendorComment', ''),
    'delivery', jsonb_build_object('expectedDeliveryTime', to_char((now() + interval '35 min') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                   'expressDelivery', false, 'riderPickupTime', ''),
    'payment', jsonb_build_object('type', 'online', 'remoteCode', 'online', 'status', 'paid', 'requiredMoneyChange', ''),
    'price', jsonb_build_object(
      'deliveryFees', jsonb_build_array(jsonb_build_object('name', 'DeliveryFee', 'value', v_fee)),
      'grandTotal', to_char(v_grand, 'FM999990.00'), 'minimumDeliveryValue', '',
      'payRestaurant', '0', 'riderTip', '0', 'subTotal', to_char(v_totalnet, 'FM999990.00'),
      'totalNet', to_char(v_totalnet, 'FM999990.00'), 'vatTotal', '0',
      'collectFromCustomer', '', 'discountAmountTotal', to_char(v_desc, 'FM999990.00')),
    'discounts', coalesce(p_opts->'discounts', '[]'::jsonb),
    'vouchers', coalesce(p_opts->'vouchers', '[]'::jsonb),
    'products', p_productos,
    'callbackUrls', jsonb_build_object('orderAcceptedUrl', 'https://ensayo.invalid/accept',
                                        'orderRejectedUrl', 'https://ensayo.invalid/reject',
                                        'orderPickedUpUrl', 'https://ensayo.invalid/pickedup',
                                        'orderPreparedUrl', 'https://ensayo.invalid/prepared'));
  if p_opts ? 'payload_patch' then v_payload := v_payload || (p_opts->'payload_patch'); end if;

  insert into peya_ordenes (order_token, remote_order_id, vendor_remote_id, sucursal_id, expedition_type,
                            tipo_orden, estado, callback_urls, payload, es_prueba, code, short_code,
                            platform_restaurant_id, expiry_date)
  values (v_token, v_code, v_vendor,
          case when coalesce((p_opts->>'sin_sucursal')::boolean,false) then null else v_suc end,
          v_exp, case v_exp when 'delivery' then 'vendor_delivery' when 'pickup' then 'pickup' else 'desconocido' end,
          'recibido', v_payload->'callbackUrls', v_payload, v_prueba, v_code, v_short,
          v_payload->'platformRestaurant'->>'id', now() + interval '20 min')
  returning id into v_orden;

  v_espera := coalesce(p_opts->>'espera', case when v_prueba then 'omitida' else 'cuenta' end);
  v_lineas := coalesce((p_opts->>'lineas')::int, jsonb_array_length(p_productos));
  v_total  := coalesce((p_opts->>'total')::numeric, v_totalnet);

  -- ── Bajar a caja ──────────────────────────────────────────────────────────
  begin
    r := public.peya_crear_cuenta(v_orden);
  exception when others then
    if v_espera = 'error' then
      if position(coalesce(p_opts->>'error_contiene', '') in SQLERRM) = 0 then
        v_fallos := v_fallos || ('error distinto al esperado: ' || left(SQLERRM, 160));
      end if;
      return jsonb_build_object('n', p_n, 'titulo', p_titulo, 'ok', cardinality(v_fallos) = 0,
               'fallos', to_jsonb(v_fallos), 'info', jsonb_build_object('error', left(SQLERRM, 160)));
    end if;
    return jsonb_build_object('n', p_n, 'titulo', p_titulo, 'ok', false,
             'fallos', jsonb_build_array('EXCEPCIÓN en peya_crear_cuenta: ' || left(SQLERRM, 200)), 'info', '{}'::jsonb);
  end;

  if v_espera = 'error' then
    v_fallos := v_fallos || ('se esperaba un error y no hubo: ' || left(r::text, 120));
  end if;

  if v_espera = 'omitida' then
    if not coalesce((r->>'omitida')::boolean, false) then v_fallos := v_fallos || ('no fue omitida: ' || left(r::text, 120)); end if;
    select pos_cuenta_id into v_cuenta from peya_ordenes where id = v_orden;
    if v_cuenta is not null then v_fallos := v_fallos || ('omitida pero con pos_cuenta_id'::text); end if;
    if v_ciclo = 'cancelar' then
      r2 := public.peya_cancelar_cuenta(v_orden, 'ensayo');
      if not coalesce((r2->>'sin_cuenta')::boolean,false) then v_fallos := v_fallos || ('cancelar sin cuenta: ' || left(r2::text,120)); end if;
    elsif v_ciclo = 'cerrar' then
      r2 := public.peya_cerrar_cuenta(v_orden, 'ensayo');
      if coalesce((r2->>'ok')::boolean,true) or r2->>'motivo' <> 'sin_cuenta' then v_fallos := v_fallos || ('cerrar sin cuenta: ' || left(r2::text,120)); end if;
    end if;
    return jsonb_build_object('n', p_n, 'titulo', p_titulo, 'ok', cardinality(v_fallos) = 0,
             'fallos', to_jsonb(v_fallos), 'info', jsonb_build_object('omitida', true));
  end if;

  -- ── espera = cuenta ───────────────────────────────────────────────────────
  v_cuenta := nullif(r->>'cuenta_id','')::uuid;
  if not coalesce((r->>'ok')::boolean,false) or v_cuenta is null or coalesce((r->>'omitida')::boolean,false) then
    return jsonb_build_object('n', p_n, 'titulo', p_titulo, 'ok', false,
             'fallos', jsonb_build_array('no creó cuenta: ' || left(r::text, 160)), 'info', '{}'::jsonb);
  end if;

  select * into c from pos_cuentas where id = v_cuenta;
  if c.tipo <> 'pedidos_ya' or c.delivery_plataforma <> 'pedidos_ya' then v_fallos := v_fallos || ('tipo/plataforma ≠ pedidos_ya'::text); end if;
  if c.estado <> 'abierta' then v_fallos := v_fallos || ('estado inicial ' || c.estado); end if;
  if c.sucursal_id <> v_suc then v_fallos := v_fallos || ('sucursal distinta'::text); end if;
  if c.turno_id is null then v_fallos := v_fallos || ('sin turno'::text); end if;
  if c.menu_id <> 'db0f8d05-0d72-435f-bf82-41a776802549' then v_fallos := v_fallos || ('menu_id ≠ menú PeYa'::text); end if;
  if abs(coalesce(c.total,0) - v_total) >= 0.01 then v_fallos := v_fallos || ('total ' || c.total || ' ≠ ' || v_total); end if;
  if abs(coalesce(c.subtotal,0) - v_total) >= 0.01 then v_fallos := v_fallos || ('subtotal ≠ total'::text); end if;
  if c.delivery_referencia is distinct from coalesce(v_short, v_code) then v_fallos := v_fallos || ('referencia ' || coalesce(c.delivery_referencia,'∅')); end if;
  if c.numero_orden <> (r->>'numero_orden')::int then v_fallos := v_fallos || ('numero_orden ≠ devuelto'::text); end if;
  if coalesce((p_opts->>'sin_customer')::boolean,false) then
    if c.cliente_nombre is not null then v_fallos := v_fallos || ('cliente debía ser null'::text); end if;
  elsif c.cliente_nombre is distinct from (coalesce(p_opts->>'nombre','Ensayo') || ' ' || coalesce(p_opts->>'apellido', '#' || p_n)) then
    v_fallos := v_fallos || ('cliente ' || coalesce(c.cliente_nombre,'∅'));
  end if;
  if v_coment is not null and position(v_coment in coalesce(c.notas_cocina,'')) = 0 then v_fallos := v_fallos || ('nota del cliente no está en notas_cocina'::text); end if;
  if v_coment is null and not v_prueba and c.notas_cocina is not null then v_fallos := v_fallos || ('notas_cocina inesperada: ' || left(c.notas_cocina,60)); end if;
  if coalesce((p_opts->>'nota_mismatch')::boolean,false) then
    if c.notas_internas is null or position('≠ totalNet' in c.notas_internas) = 0 then v_fallos := v_fallos || ('faltó aviso suma≠totalNet'::text); end if;
  elsif c.notas_internas is not null and position('≠ totalNet' in c.notas_internas) > 0 then
    v_fallos := v_fallos || ('aviso suma≠totalNet inesperado: ' || left(c.notas_internas, 90));
  end if;
  if coalesce((p_opts->>'sin_mapear_prod')::int,0) = 0 and coalesce((p_opts->>'sin_mapear_mod')::int,0) = 0
     and c.notas_internas is not null and position('sin mapear' in c.notas_internas) > 0 then
    v_fallos := v_fallos || ('aviso sin mapear inesperado'::text);
  end if;

  -- líneas
  select jsonb_agg(to_jsonb(i) order by coalesce(i.linea, 32767), i.ctid) into v_items from pos_cuenta_items i where i.cuenta_id = v_cuenta;
  v_n := coalesce(jsonb_array_length(v_items), 0);
  if v_n <> v_lineas then v_fallos := v_fallos || ('líneas ' || v_n || ' ≠ ' || v_lineas); end if;
  select count(distinct comanda_numero) into v_i from pos_cuenta_items where cuenta_id = v_cuenta;
  if v_i > 1 then v_fallos := v_fallos || ('comanda_numero distinto entre líneas'::text); end if;
  select count(*) into v_i from pos_cuenta_items where cuenta_id = v_cuenta and nombre like '%⚠️%';
  if v_i <> coalesce((p_opts->>'sin_mapear_prod')::int,0) then v_fallos := v_fallos || ('productos ⚠️ ' || v_i || ' ≠ ' || coalesce((p_opts->>'sin_mapear_prod')::int,0)); end if;
  if coalesce((r->>'lineas_sin_mapear')::int,0) <> coalesce((p_opts->>'sin_mapear_prod')::int,0) then v_fallos := v_fallos || ('lineas_sin_mapear devuelto ≠ esperado'::text); end if;
  select count(*) into v_i from pos_cuenta_items i, jsonb_array_elements(i.modificadores) m
   where i.cuenta_id = v_cuenta and (m->>'nombre' like '%⚠️%' or m->>'opcion_id' is null);
  if v_i <> coalesce((p_opts->>'sin_mapear_mod')::int,0) then v_fallos := v_fallos || ('modificadores ⚠️/sin opcion_id ' || v_i || ' ≠ ' || coalesce((p_opts->>'sin_mapear_mod')::int,0)); end if;
  select coalesce(sum((precio_unitario + coalesce(precio_modificadores,0)) * cantidad),0) into v_x from pos_cuenta_items where cuenta_id = v_cuenta;
  if abs(v_x - (r->>'suma_lineas')::numeric) >= 0.01 then v_fallos := v_fallos || ('suma_lineas devuelta ' || (r->>'suma_lineas') || ' ≠ tablas ' || v_x); end if;
  if abs(v_x - v_suma_pay) >= 0.01 and not coalesce((p_opts->>'suma_libre')::boolean,false) then
    v_fallos := v_fallos || ('suma de líneas $' || v_x || ' ≠ Σ paidPrice $' || v_suma_pay || ' (precio unitario/cantidad mal)');
  end if;
  -- cada línea contra su producto
  for v_i in 0 .. jsonb_array_length(p_productos) - 1 loop
    v_m := v_items -> v_i;
    if v_m is null then exit; end if;
    if (v_m->>'cantidad')::int <> greatest(1, (p_productos->v_i->>'quantity')::int) then
      v_fallos := v_fallos || ('L' || v_i || ' cantidad ' || (v_m->>'cantidad') || ' ≠ ' || (p_productos->v_i->>'quantity'));
    end if;
    if p_productos->v_i ? 'unitPrice' and abs((v_m->>'precio_unitario')::numeric - (p_productos->v_i->>'unitPrice')::numeric) >= 0.01
       and not coalesce((p_opts->>'suma_libre')::boolean,false) then
      v_fallos := v_fallos || ('L' || v_i || ' precio_unitario ' || (v_m->>'precio_unitario') || ' ≠ unitPrice ' || (p_productos->v_i->>'unitPrice'));
    end if;
    if (p_productos->v_i ? 'remoteCode') and (v_m->>'menu_item_id') <> (p_productos->v_i->>'remoteCode') then
      v_fallos := v_fallos || ('L' || v_i || ' menu_item_id ≠ remoteCode');
    end if;
  end loop;
  -- nombres esperados por línea (para producto_map: nombre de PeYa → nuestro ítem)
  if p_opts ? 'nombres' then
    for v_i in 0 .. jsonb_array_length(p_opts->'nombres') - 1 loop
      if (v_items -> v_i ->> 'nombre') is distinct from (p_opts->'nombres'->>v_i) then
        v_fallos := v_fallos || ('L' || v_i || ' nombre «' || coalesce(v_items -> v_i ->> 'nombre','∅') || '» ≠ «' || (p_opts->'nombres'->>v_i) || '»');
      end if;
    end loop;
  end if;
  -- modificadores esperados: opts.mods = [{"l":0,"n":["Ketchup","Chipotle"],"g":["Salsas Papas"]}]
  if p_opts ? 'mods' then
    for v_m in select * from jsonb_array_elements(p_opts->'mods') loop
      v_q := (v_items -> (v_m->>'l')::int) -> 'modificadores';
      for v_nombre in select * from jsonb_array_elements_text(coalesce(v_m->'n','[]'::jsonb)) loop
        if not exists (select 1 from jsonb_array_elements(coalesce(v_q,'[]'::jsonb)) x where lower(x->>'nombre') = lower(v_nombre)) then
          v_fallos := v_fallos || ('L' || (v_m->>'l') || ' falta modificador «' || v_nombre || '» (hay: ' ||
            coalesce((select string_agg(x->>'nombre', ', ') from jsonb_array_elements(coalesce(v_q,'[]'::jsonb)) x), '∅') || ')');
        end if;
      end loop;
      for v_nombre in select * from jsonb_array_elements_text(coalesce(v_m->'g','[]'::jsonb)) loop
        if not exists (select 1 from jsonb_array_elements(coalesce(v_q,'[]'::jsonb)) x where x->>'grupo_nombre' = v_nombre) then
          v_fallos := v_fallos || ('L' || (v_m->>'l') || ' falta grupo «' || v_nombre || '» (hay: ' ||
            coalesce((select string_agg(distinct x->>'grupo_nombre', ', ') from jsonb_array_elements(coalesce(v_q,'[]'::jsonb)) x), '∅') || ')');
        end if;
      end loop;
      if v_m ? 'cuantos' and coalesce(jsonb_array_length(v_q),0) <> (v_m->>'cuantos')::int then
        v_fallos := v_fallos || ('L' || (v_m->>'l') || ' ' || coalesce(jsonb_array_length(v_q),0) || ' modificadores ≠ ' || (v_m->>'cuantos'));
      end if;
      if v_m ? 'extra' and abs(((v_items -> (v_m->>'l')::int)->>'precio_modificadores')::numeric - (v_m->>'extra')::numeric) >= 0.01 then
        v_fallos := v_fallos || ('L' || (v_m->>'l') || ' precio_modificadores ' || ((v_items -> (v_m->>'l')::int)->>'precio_modificadores') || ' ≠ ' || (v_m->>'extra'));
      end if;
    end loop;
  end if;

  -- cola de cocina
  select count(*), count(*) filter (where estado <> 'pendiente'), count(*) filter (where mesa_ref is distinct from (r->>'etiqueta')),
         count(*) filter (where canal <> 'pedidos_ya' or store_code is null or estacion is null or sucursal_id <> v_suc),
         count(*) filter (where abs(coalesce(total,0) - v_total) >= 0.01),
         count(*) filter (where v_coment is not null and position(v_coment in coalesce(nota_pedido,'')) = 0),
         count(*) filter (where cuenta_item_id is null or comanda_numero is distinct from (r->>'comanda')::int)
    into v_c1, v_c2, v_c3, v_c4, v_c5, v_c6, v_c7
    from pos_cocina_queue where cuenta_id = v_cuenta;
  if v_c1 <> v_lineas then v_fallos := v_fallos || ('cola ' || v_c1 || ' ≠ ' || v_lineas); end if;
  if v_c2 > 0 then v_fallos := v_fallos || ('cola no pendiente'::text); end if;
  if v_c3 > 0 then v_fallos := v_fallos || ('cola mesa_ref ≠ etiqueta ' || (r->>'etiqueta')); end if;
  if v_c4 > 0 then v_fallos := v_fallos || ('cola canal/store/estacion/sucursal'::text); end if;
  if v_c5 > 0 then v_fallos := v_fallos || ('cola total ≠ totalNet'::text); end if;
  if v_c6 > 0 then v_fallos := v_fallos || ('cola nota_pedido sin comentario del cliente'::text); end if;
  if v_c7 > 0 then v_fallos := v_fallos || ('cola sin cuenta_item_id o comanda distinta'::text); end if;
  -- nota por producto llega a la línea de cocina
  for v_i in 0 .. jsonb_array_length(p_productos) - 1 loop
    if nullif(p_productos->v_i->>'comment','') is not null and not exists (
         select 1 from pos_cocina_queue q where q.cuenta_id = v_cuenta and q.nota = p_productos->v_i->>'comment') then
      v_fallos := v_fallos || ('L' || v_i || ' nota de producto no llegó a cocina');
    end if;
  end loop;
  if (r->>'etiqueta') not like '%' || coalesce(v_short, v_code) || '%' then v_fallos := v_fallos || ('etiqueta ' || (r->>'etiqueta')); end if;
  select pos_cuenta_id into v_uuid from peya_ordenes where id = v_orden;
  if v_uuid is distinct from v_cuenta then v_fallos := v_fallos || ('peya_ordenes.pos_cuenta_id no quedó'::text); end if;

  -- ── Duplicado: DH reintenta el webhook ────────────────────────────────────
  if coalesce((p_opts->>'duplicado')::boolean,false) then
    r2 := public.peya_crear_cuenta(v_orden);
    if not coalesce((r2->>'ya_existia')::boolean,false) or (r2->>'cuenta_id')::uuid <> v_cuenta then v_fallos := v_fallos || ('reintento no idempotente: ' || left(r2::text,100)); end if;
    select count(*) into v_i from pos_cuenta_items where cuenta_id = v_cuenta;
    if v_i <> v_lineas then v_fallos := v_fallos || ('reintento duplicó líneas'::text); end if;
    select count(*) into v_i from pos_cuentas where sucursal_id = v_suc and delivery_referencia = coalesce(v_short, v_code);
    if v_i <> 1 then v_fallos := v_fallos || ('reintento creó ' || v_i || ' cuentas'); end if;
  end if;

  -- ── Ciclo de vida ─────────────────────────────────────────────────────────
  if v_ciclo in ('parcial', 'cancelar_parcial') then
    update pos_cocina_queue set estado = 'completado', completado_at = now()
     where id = (select id from pos_cocina_queue where cuenta_id = v_cuenta order by coalesce(linea, 32767), ctid limit 1);
    r2 := public.peya_listo_para_retirar(v_orden);
    if v_lineas > 1 and coalesce((r2->>'listo')::boolean,true) then v_fallos := v_fallos || ('listo con líneas pendientes'::text); end if;
    if v_lineas > 1 and (r2->>'pendientes')::int <> v_lineas - 1 then v_fallos := v_fallos || ('pendientes ' || (r2->>'pendientes')); end if;
  end if;
  if v_ciclo in ('cerrar', 'cancelar_cobrada') then
    r2 := public.peya_listo_para_retirar(v_orden);
    if coalesce((r2->>'listo')::boolean,true) then v_fallos := v_fallos || ('listo antes de que cocina terminara'::text); end if;
    update pos_cocina_queue set estado = 'completado', completado_at = now() where cuenta_id = v_cuenta;
    r2 := public.peya_listo_para_retirar(v_orden);
    if not coalesce((r2->>'listo')::boolean,false) then v_fallos := v_fallos || ('no listo tras completar: ' || left(r2::text,100)); end if;
    r2 := public.peya_cerrar_cuenta(v_orden, 'ensayo');
    if not coalesce((r2->>'ok')::boolean,false) or abs((r2->>'total')::numeric - v_total) >= 0.01 then v_fallos := v_fallos || ('cerrar: ' || left(r2::text,120)); end if;
    select * into c from pos_cuentas where id = v_cuenta;
    if c.estado <> 'cobrada' or c.cobrada_at is null or c.dte_tipo is not null then v_fallos := v_fallos || ('tras cobro estado ' || c.estado || ' dte ' || coalesce(c.dte_tipo,'∅')); end if;
    select count(*), coalesce(sum(monto),0), min(metodo), min(referencia) into v_i, v_x, v_t, v_nombre from pos_cuenta_pagos where cuenta_id = v_cuenta and not anulado;
    if v_i <> 1 or abs(v_x - v_total) >= 0.01 or v_t <> 'pedidos_ya' then v_fallos := v_fallos || ('pagos ' || v_i || ' $' || v_x || ' ' || coalesce(v_t,'∅')); end if;
    if v_nombre not like '%' || coalesce(v_short, v_code) || '%' then v_fallos := v_fallos || ('referencia de pago ' || coalesce(v_nombre,'∅')); end if;
    r2 := public.peya_cerrar_cuenta(v_orden, 'ensayo');
    if not coalesce((r2->>'ya_cobrada')::boolean,false) then v_fallos := v_fallos || ('segundo cierre no idempotente'::text); end if;
    select count(*) into v_i from pos_cuenta_pagos where cuenta_id = v_cuenta;
    if v_i <> 1 then v_fallos := v_fallos || ('segundo cierre duplicó pago'::text); end if;
  end if;
  if v_ciclo in ('cancelar', 'cancelar_parcial', 'cancelar_cobrada') then
    r2 := public.peya_cancelar_cuenta(v_orden, 'el cliente se arrepintió');
    if not coalesce((r2->>'ok')::boolean,false) then v_fallos := v_fallos || ('cancelar: ' || left(r2::text,120)); end if;
    select * into c from pos_cuentas where id = v_cuenta;
    if v_ciclo = 'cancelar_cobrada' then
      if not coalesce((r2->>'ya_cobrada')::boolean,false) then v_fallos := v_fallos || ('cancelar cobrada sin aviso ya_cobrada'::text); end if;
      if c.estado <> 'cobrada' then v_fallos := v_fallos || ('cancelar cobrada cambió estado a ' || c.estado); end if;
      if coalesce(c.notas_internas,'') not like '%canceló DESPUÉS%' then v_fallos := v_fallos || ('cancelar cobrada sin nota de liquidación'::text); end if;
      select count(*) into v_i from pos_cuenta_pagos where cuenta_id = v_cuenta and not anulado;
      if v_i <> 1 then v_fallos := v_fallos || ('cancelar cobrada tocó el pago'::text); end if;
    else
      if c.estado <> 'cancelada' or coalesce(c.cancelada_motivo,'') not like 'PedidosYa:%' then v_fallos := v_fallos || ('cancelada: estado ' || c.estado || ' motivo ' || coalesce(c.cancelada_motivo,'∅')); end if;
      if v_ciclo = 'cancelar_parcial' and ((r2->>'lineas_listas')::int <> 1 or coalesce(r2->>'aviso','') not like '%descartar%') then v_fallos := v_fallos || ('parcial: ' || left(r2::text,120)); end if;
      if v_ciclo = 'cancelar' and (r2->>'lineas_listas')::int <> 0 then v_fallos := v_fallos || ('cancelar limpio reporta líneas listas'::text); end if;
      r := public.peya_cancelar_cuenta(v_orden, 'otra vez');
      if not coalesce((r->>'ya_cancelada')::boolean,false) then v_fallos := v_fallos || ('segunda cancelación no idempotente'::text); end if;
    end if;
    select count(*) filter (where estado <> 'cancelado'), count(*) filter (where nota_pedido not like '❌ CANCELADO%') into v_i, v_n from pos_cocina_queue where cuenta_id = v_cuenta;
    if v_i > 0 or v_n > 0 then v_fallos := v_fallos || ('cola tras cancelar: ' || v_i || ' no canceladas, ' || v_n || ' sin aviso'); end if;
    select estado, cancelado_at into v_t, v_ts from peya_ordenes where id = v_orden;
    if v_t <> 'cancelado' or v_ts is null then v_fallos := v_fallos || ('orden tras cancelar: ' || v_t); end if;
  end if;

  v_info := jsonb_build_object('cuenta', left(v_cuenta::text, 8), 'num', r->>'numero_orden', 'comanda', r->>'comanda',
              'total', r->>'total_venta', 'lineas', v_lineas,
              'mods', (select string_agg(x->>'nombre', '/') from pos_cuenta_items i, jsonb_array_elements(i.modificadores) x where i.cuenta_id = v_cuenta));
  return jsonb_build_object('n', p_n, 'titulo', p_titulo, 'ok', cardinality(v_fallos) = 0, 'fallos', to_jsonb(v_fallos), 'info', v_info);
end $$;

-- Corre un lote y devuelve el informe. NO hace commit de nada por sí solo:
-- llamalo dentro de `do $$ ... raise exception '%', ... $$` para revertir todo.
create or replace function public.peya_ensayo_lote(p_lote int)
 returns jsonb language plpgsql volatile set search_path to 'public','pg_temp' as $$
declare
  v_suc   uuid := '8ffb29ec-3d58-4ae1-b0d4-bcd12202456e';  -- Plaza Cafetalón (M001)
  v_cajero uuid;
  v_res   jsonb := '[]'::jsonb;
  v_r     jsonb;
  v_ok    int := 0;
  v_tot   int := 0;
  v_prev_num int; v_prev_com int;
  v_lineas text[] := array[]::text[];
  v_fallos jsonb := '[]'::jsonb;
  v_turno_ensayo boolean := false;
  p jsonb; t jsonb;
begin
  if not exists (select 1 from pos_turnos where store_code = 'M001' and cerrado_at is null) then
    select id into v_cajero from usuarios_erp order by created_at limit 1;
    insert into pos_turnos (sucursal_id, cajero_id, store_code, nivel, fecha, estado, notas, fondo_apertura)
    values (v_suc, v_cajero, 'M001', 'cajero', current_date, 'abierto', 'TURNO DE ENSAYO PEYA — se revierte', 0);
    v_turno_ensayo := true;
  end if;

  for v_r in select * from public.peya_ensayo_escenarios(p_lote) loop
    v_tot := v_tot + 1;
    begin
      v_r := public.peya_ensayo_pedido((v_r->>'n')::int, v_r->>'titulo', v_r->'productos', coalesce(v_r->'opts', '{}'::jsonb));
    exception when others then
      v_r := jsonb_build_object('n', v_r->>'n', 'titulo', v_r->>'titulo', 'ok', false,
               'fallos', jsonb_build_array('EXCEPCIÓN del banco: ' || left(SQLERRM, 200)), 'info', '{}'::jsonb);
    end;
    -- numeración consecutiva dentro de la sucursal
    if v_r->'info' ? 'num' then
      if v_prev_num is not null and (v_r->'info'->>'num')::int <> v_prev_num + 1 then
        v_r := jsonb_set(v_r, '{fallos}', (v_r->'fallos') || to_jsonb('numero_orden ' || (v_r->'info'->>'num') || ' no es ' || (v_prev_num+1)));
        v_r := jsonb_set(v_r, '{ok}', 'false');
      end if;
      if v_prev_com is not null and (v_r->'info'->>'comanda')::int <> v_prev_com + 1 then
        v_r := jsonb_set(v_r, '{fallos}', (v_r->'fallos') || to_jsonb('comanda ' || (v_r->'info'->>'comanda') || ' no es ' || (v_prev_com+1)));
        v_r := jsonb_set(v_r, '{ok}', 'false');
      end if;
      v_prev_num := (v_r->'info'->>'num')::int; v_prev_com := (v_r->'info'->>'comanda')::int;
    end if;
    if (v_r->>'ok')::boolean then
      v_ok := v_ok + 1;
      v_lineas := v_lineas || (lpad(v_r->>'n', 2, '0') || ' ✓ ' || (v_r->>'titulo') ||
        coalesce(' [$' || (v_r->'info'->>'total') || ' ' || (v_r->'info'->>'lineas') || 'L' ||
                 coalesce(' · ' || left(v_r->'info'->>'mods', 70), '') || ']', ''));
    else
      v_lineas := v_lineas || (lpad(v_r->>'n', 2, '0') || ' ✗ ' || (v_r->>'titulo') || ' → ' ||
        (select string_agg(x, ' | ') from jsonb_array_elements_text(v_r->'fallos') x));
    end if;
  end loop;

  return jsonb_build_object('lote', p_lote, 'ok', v_ok, 'de', v_tot, 'turno_ensayo', v_turno_ensayo,
           'detalle', to_jsonb(v_lineas));
end $$;

-- Los 50 escenarios del banco de ensayo PeYa, 10 por lote. Cada fila:
-- {n, titulo, productos: [producto DH...], opts: {...}} (ver peya_ensayo_pedido).
create or replace function public.peya_ensayo_escenarios(p_lote int)
 returns setof jsonb language plpgsql stable set search_path to 'public','pg_temp' as $$
declare
  j jsonb;
begin
  if p_lote = 1 then
    return next jsonb_build_object('n', 1, 'titulo', 'Freakie Dog solo + nota del cliente + cobro',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Dog')),
      'opts', jsonb_build_object('comentario', 'Sin cebolla por favor', 'ciclo', 'cerrar'));
    return next jsonb_build_object('n', 2, 'titulo', 'Freakie Fries + 2 salsas anidadas (nombres PeYa, sin remoteCode)',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Fries', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Ketchup', null, 'anidado-sinrc'),
        public.peya_ensayo_top('Salsas Papas', 'Chipotle', null, 'anidado-sinrc')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Ketchup', 'Chipotle'), 'g', jsonb_build_array('Salsas Papas'), 'cuantos', 2, 'extra', 0))));
    return next jsonb_build_object('n', 3, 'titulo', 'Coca Lata ×3 (paidPrice = unit × 3) + cobro',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Coca Lata', 3)),
      'opts', jsonb_build_object('total', 5.25, 'ciclo', 'cerrar'));
    return next jsonb_build_object('n', 4, 'titulo', 'Fancys + Tocino(+0.75, remoteCode) + BBQ como «Barbacoa»',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Complementos Hamburguesa', 'Tocino'),
        public.peya_ensayo_top('Salsas Papas', 'BBQ', null, 'anidado-sinrc', 'Barbacoa')))),
      'opts', jsonb_build_object('total', 9.74, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Tocino', 'BBQ'), 'cuantos', 2, 'extra', 0.75))));
    return next jsonb_build_object('n', 5, 'titulo', 'Super Freak + «Jalapeños» (ñ) + preset «Con todo (Ketchup, Mayonesa, Chipotle, Cheddar, Barbacoa)» → Con Todo',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Super Freak', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Super Freak Complementos', 'Jalapeños', null, 'anidado-sinrc', 'Jalapeños'),
        public.peya_ensayo_top('Salsas Papas', 'Con Todo', 0, 'anidado-sinrc', 'Con todo (Ketchup, Mayonesa, Chipotle, Cheddar, Barbacoa)')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Con Todo'), 'cuantos', 2, 'extra', 0.50))));
    return next jsonb_build_object('n', 6, 'titulo', '3 productos con nota por producto + cobro',
      'productos', jsonb_build_array(
        public.peya_ensayo_prod('Combo Hamburguesa', 1, 'sin tomate'),
        public.peya_ensayo_prod('Combo Freakie Dog'),
        public.peya_ensayo_prod('Agua', 1, 'bien fría')),
      'opts', jsonb_build_object('ciclo', 'cerrar'));
    return next jsonb_build_object('n', 7, 'titulo', 'test:true de Delivery Hero (vendor real M001) → se acepta pero NO baja a cocina; cancelar sin cuenta',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys')),
      'opts', jsonb_build_object('es_prueba', true, 'vendor', 'M001', 'ciclo', 'cancelar'));
    return next jsonb_build_object('n', 8, 'titulo', 'Webhook reintentado (mismo pedido dos veces) → idempotente',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Chili'), public.peya_ensayo_prod('Coca Zero Lata')),
      'opts', jsonb_build_object('duplicado', true));
    return next jsonb_build_object('n', 9, 'titulo', 'Producto desconocido («Hamburguesa Fantasma») + uno conocido → cuenta con línea ⚠️',
      'productos', jsonb_build_array(
        public.peya_ensayo_prod('Hamburguesa Fantasma', 1, null, '[]'::jsonb, false, null, 6.50),
        public.peya_ensayo_prod('Freakie Fries')),
      'opts', jsonb_build_object('sin_mapear_prod', 1));
    return next jsonb_build_object('n', 10, 'titulo', 'Modificador desconocido («Salsa Secreta» +0.25) → línea con ⚠️ y precio respetado',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Fries', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Salsa Secreta', 0.25)))),
      'opts', jsonb_build_object('sin_mapear_mod', 1, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'cuantos', 1, 'extra', 0.25))));

  elsif p_lote = 2 then
    return next jsonb_build_object('n', 11, 'titulo', 'Chilli Dog + preset «Todo menos Chipotle» → 7 opciones',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Chilli Dog', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Complemento de Hot Dog', 'Todo menos Chipotle', 0, 'anidado-sinrc', 'Chilli Dog (Todo menos Chipotle)')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Ketchup', 'Escabeche', 'Pepinillos'), 'g', jsonb_build_array('Complemento de Hot Dog'), 'cuantos', 7, 'extra', 0))));
    return next jsonb_build_object('n', 12, 'titulo', 'Chilli Dog + preset vacío «Pan y Salchicha» → 0 opciones',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Chilli Dog', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Complemento de Hot Dog', 'Pan y Salchicha', 0, 'anidado-sinrc', 'Solo (Pan y Salchicha)')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'cuantos', 0, 'extra', 0))));
    return next jsonb_build_object('n', 13, 'titulo', 'Chili con carne: Ketchup, Mayonesa, Ketchup → segunda unidad en «Salsas Papas 2»',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Chili con carne', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Ketchup', null, 'plano'),
        public.peya_ensayo_top('Salsas Papas', 'Mayonesa', null, 'plano'),
        public.peya_ensayo_top('Salsas Papas', 'Ketchup', null, 'plano')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'g', jsonb_build_array('Salsas Papas', 'Salsas Papas 2'), 'cuantos', 3))));
    return next jsonb_build_object('n', 14, 'titulo', 'Mini Fancys: 3 grupos distintos, dos con precio (+1.50, +1.25 como «Fancy fries»)',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Mini Fancys', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Topping Fancy', 'Mermelada de Tocino'),
        public.peya_ensayo_top('Complementos Hamburguesa', 'Carne y Queso Extra'),
        public.peya_ensayo_top('Salsas Papas', 'Fancy Fries', null, 'anidado-sinrc', 'Fancy fries')))),
      'opts', jsonb_build_object('total', 7.74, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Mermelada de Tocino', 'Carne y Queso Extra', 'Fancy Fries'), 'g', jsonb_build_array('Topping Fancy', 'Complementos Hamburguesa', 'Salsas Papas'), 'cuantos', 3, 'extra', 2.75))));
    return next jsonb_build_object('n', 15, 'titulo', 'Freakie Dog: un grupo con 5 hijos planos (multi-select) con remoteCode',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Dog', 1, null, jsonb_build_array(
        public.peya_ensayo_grupo('Complemento de Hot Dog', jsonb_build_array(
          public.peya_ensayo_top('Complemento de Hot Dog', 'Ketchup', null, 'plano'),
          public.peya_ensayo_top('Complemento de Hot Dog', 'Mayonesa', null, 'plano'),
          public.peya_ensayo_top('Complemento de Hot Dog', 'Escabeche', null, 'plano'),
          public.peya_ensayo_top('Complemento de Hot Dog', 'Cebolla', null, 'plano'),
          public.peya_ensayo_top('Complemento de Hot Dog', 'Pepinillos', null, 'plano')))))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Ketchup', 'Mayonesa', 'Escabeche', 'Cebolla', 'Pepinillos'), 'cuantos', 5, 'extra', 0))));
    return next jsonb_build_object('n', 16, 'titulo', 'Aros de Cebolla + «Sin Complementos» → Sin Extra',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Aros de Cebolla', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Sin Extra', null, 'anidado-sinrc', 'Sin Complementos')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Sin Extra'), 'cuantos', 1))));
    return next jsonb_build_object('n', 17, 'titulo', 'Fancys XL + topping anidado a 2 niveles, nombre PeYa «Chili» (+1.25)',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys XL', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Chili con Carne', null, 'anidado2-sinrc', 'Chili')))),
      'opts', jsonb_build_object('total', 10.24, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Chili con Carne'), 'cuantos', 1, 'extra', 1.25))));
    return next jsonb_build_object('n', 18, 'titulo', 'Freakie Fries ×2 con «Tocino Extra» (+0.75): paidPrice = (1.99+0.75)×2',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Fries', 2, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Tocino', null, 'anidado-sinrc', 'Tocino Extra')))),
      'opts', jsonb_build_object('total', 5.48, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Tocino'), 'extra', 0.75))));
    return next jsonb_build_object('n', 19, 'titulo', 'Topping con nombre raro pero remoteCode válido → resuelve por id',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Super Freak', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Super Freak Complementos', 'Costra de Queso', null, 'anidado', 'Costra XL (nombre que PeYa cambió)')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Costra de Queso'), 'cuantos', 1, 'extra', 1.00))));
    return next jsonb_build_object('n', 20, 'titulo', 'Chilli Dog con NUESTROS nombres sin remoteCode («Cebolla», «Cheddar») — como los devuelve el catálogo nuevo',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Chilli Dog', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Complemento de Hot Dog', 'Cebolla', null, 'anidado-sinrc'),
        public.peya_ensayo_top('Complemento de Hot Dog', 'Cheddar', null, 'anidado-sinrc')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Cebolla', 'Cheddar'), 'g', jsonb_build_array('Complemento de Hot Dog'), 'cuantos', 2))));

  elsif p_lote = 3 then
    return next jsonb_build_object('n', 21, 'titulo', 'Combo Hamburguesa + bebida «Coca-Cola 300ml» (nuestro nombre, sin remoteCode)',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Hamburguesa', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Bebida', 'Coca-Cola 300ml', null, 'anidado-sinrc')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Coca-Cola 300ml'), 'cuantos', 1, 'extra', 0))));
    return next jsonb_build_object('n', 22, 'titulo', 'Combo Freakie Dog + bebida «Agua» (mapa) → Botella Agua',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Freakie Dog', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Bebida', 'Botella Agua', null, 'anidado-sinrc', 'Agua')))),
      'opts', jsonb_build_object('mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Botella Agua'), 'cuantos', 1))));
    return next jsonb_build_object('n', 23, 'titulo', 'Combo Super Freak + Agrandado (+0.50) + Té Durazno (remoteCode)',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Super Freak', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Agrandado de bebida', 'Agrandado de bebida'),
        public.peya_ensayo_top('Bebida Agrandado', 'Té Durazno')))),
      'opts', jsonb_build_object('total', 6.49, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Agrandado de bebida', 'Té Durazno'), 'cuantos', 2, 'extra', 0.50))));
    return next jsonb_build_object('n', 24, 'titulo', 'Cambio de bebida ($0.50) + Sabor del agrandado «Fanta Vidrio»',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Cambio de bebida', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Sabor del agrandado', 'Fanta Vidrio')))),
      'opts', jsonb_build_object('total', 0.50, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Fanta Vidrio'), 'cuantos', 1))));
    return next jsonb_build_object('n', 25, 'titulo', 'Nombre de PeYa «Combo dúo» sin remoteCode → producto_map',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Duo', 1, null, '[]'::jsonb, false, 'Combo dúo')),
      'opts', jsonb_build_object('nombres', jsonb_build_array('Combo Duo')));
    return next jsonb_build_object('n', 26, 'titulo', 'Nombre largo de PeYa «2 Mega Promos + 2 Papas + 2 Bebidas» → Mega Promo',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Mega Promo', 1, null, '[]'::jsonb, false, '2 Mega Promos + 2 Papas + 2 Bebidas')),
      'opts', jsonb_build_object('nombres', jsonb_build_array('Mega Promo')));
    return next jsonb_build_object('n', 27, 'titulo', 'Combo Trio ×2 + nota larga con emojis, comillas y salto de línea + cobro',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Trio', 2, 'extra servilletas')),
      'opts', jsonb_build_object('comentario', E'Tocar el timbre 2 veces 🔔, casa con portón ''negro'' "grande"\nSin cebolla; 100% sin picante', 'total', 27.98, 'ciclo', 'cerrar'));
    return next jsonb_build_object('n', 28, 'titulo', '5 bebidas distintas + cobro',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Sprite Lata'), public.peya_ensayo_prod('Fresa Lata'),
        public.peya_ensayo_prod('Té Limón'), public.peya_ensayo_prod('Kinley'), public.peya_ensayo_prod('Friki Soda')),
      'opts', jsonb_build_object('total', 7.50, 'ciclo', 'cerrar'));
    return next jsonb_build_object('n', 29, 'titulo', 'Cafés: ítem con estación nula (« capuchino original») + Latte',
      'productos', jsonb_build_array(public.peya_ensayo_prod('capuchino original'), public.peya_ensayo_prod('Latte caliente')),
      'opts', jsonb_build_object('total', 4.74));
    return next jsonb_build_object('n', 30, 'titulo', 'Combo Fancy Duo (sin grupos propios): Clasica+Jalapenos planos con remoteCode + Cheddar',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Fancy Duo', 1, null, jsonb_build_array(
        public.peya_ensayo_grupo('Complementos Hamburguesa', jsonb_build_array(
          public.peya_ensayo_top('Complementos Hamburguesa', 'Clasica', null, 'plano'),
          public.peya_ensayo_top('Complementos Hamburguesa', 'Jalapenos', null, 'plano'))),
        public.peya_ensayo_top('Salsas Papas', 'Cheddar')))),
      'opts', jsonb_build_object('total', 11.99, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Clasica', 'Jalapenos', 'Cheddar'), 'cuantos', 3, 'extra', 1.00))));

  elsif p_lote = 4 then
    return next jsonb_build_object('n', 31, 'titulo', 'Descuento PLATFORM a nivel pedido ($2) → total = totalNet, aviso suma≠totalNet',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys'), public.peya_ensayo_prod('Freakie Fries')),
      'opts', jsonb_build_object('descuento', 2.00, 'total', 8.98, 'nota_mismatch', true,
        'discounts', jsonb_build_array(jsonb_build_object('name', 'Promo lanzamiento', 'amount', '2.00', 'type', 'PERCENTAGE',
          'sponsorships', jsonb_build_array(jsonb_build_object('sponsor', 'PLATFORM', 'amount', '2.00'))))));
    return next jsonb_build_object('n', 32, 'titulo', 'Descuento VENDOR a nivel ítem ($2 en Fancys) → total 6.99',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys', 1, null, '[]'::jsonb, true, null, null, null,
        jsonb_build_object('discountAmount', '2.00', 'discounts', jsonb_build_array(jsonb_build_object('name', 'Fancys -2', 'amount', '2.00',
          'sponsorships', jsonb_build_array(jsonb_build_object('sponsor', 'VENDOR', 'amount', '2.00'))))))),
      'opts', jsonb_build_object('total_net', 6.99, 'total', 6.99, 'nota_mismatch', true));
    return next jsonb_build_object('n', 33, 'titulo', 'Voucher $1 (nodo vouchers) → total 6.99',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Hamburguesa')),
      'opts', jsonb_build_object('descuento', 1.00, 'total', 6.99, 'nota_mismatch', true,
        'vouchers', jsonb_build_array(jsonb_build_object('amount', '1.00', 'type', 'voucher', 'code', 'BIENVENIDO', 'sponsor', 'PLATFORM'))));
    return next jsonb_build_object('n', 34, 'titulo', 'totalNet "0.00" (promo 100%) → cae a suma de líneas (comportamiento actual)',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Dog')),
      'opts', jsonb_build_object('total_net', 0, 'total', 1.99));
    return next jsonb_build_object('n', 35, 'titulo', 'grandTotal con envío $3.50: la venta es totalNet, sin aviso',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys')),
      'opts', jsonb_build_object('delivery_fee', 3.50, 'total', 8.99));
    return next jsonb_build_object('n', 36, 'titulo', 'quantity como string "2" y precios con 3 decimales',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Coca Lata', 2, null, '[]'::jsonb, true, null, null, null,
        jsonb_build_object('quantity', '2', 'unitPrice', '1.750', 'paidPrice', '3.500'))),
      'opts', jsonb_build_object('total', 3.50));
    return next jsonb_build_object('n', 37, 'titulo', 'Sin paidPrice (sólo unitPrice) ×2',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Chili', 2, null, '[]'::jsonb, true, null, null, null, jsonb_build_object('paidPrice', null))),
      'opts', jsonb_build_object('total_net', 9.98, 'total', 9.98));
    return next jsonb_build_object('n', 38, 'titulo', 'Sin unitPrice (sólo paidPrice con topping) ×2 → se deshace la cuenta',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Fries', 2, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Tocino')), true, null, null, null, jsonb_build_object('unitPrice', null))),
      'opts', jsonb_build_object('total', 5.48, 'mods', jsonb_build_array(jsonb_build_object('l', 0, 'n', jsonb_build_array('Tocino'), 'extra', 0.75))));
    return next jsonb_build_object('n', 39, 'titulo', 'Pedido grande: 8 productos distintos + cobro',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys'), public.peya_ensayo_prod('Freakie Dog'), public.peya_ensayo_prod('Super Freak'),
        public.peya_ensayo_prod('Chilli Dog'), public.peya_ensayo_prod('Coca Lata'), public.peya_ensayo_prod('Fanta Lata'),
        public.peya_ensayo_prod('Aros de Cebolla'), public.peya_ensayo_prod('Queso Frito')),
      'opts', jsonb_build_object('ciclo', 'cerrar'));
    return next jsonb_build_object('n', 40, 'titulo', 'Pickup (cliente retira) + cocina a medias → no está listo',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys'), public.peya_ensayo_prod('Coca Lata')),
      'opts', jsonb_build_object('expedition', 'pickup', 'ciclo', 'parcial'));

  elsif p_lote = 5 then
    return next jsonb_build_object('n', 41, 'titulo', 'Ciclo completo: recibir → cocina → listo → cobro → reintento de cobro',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Hamburguesa', 1, null, jsonb_build_array(
        public.peya_ensayo_top('Salsas Papas', 'Ketchup'))), public.peya_ensayo_prod('Coca Lata')),
      'opts', jsonb_build_object('ciclo', 'cerrar'));
    return next jsonb_build_object('n', 42, 'titulo', 'PeYa cancela antes de que cocina empiece',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys'), public.peya_ensayo_prod('Freakie Fries')),
      'opts', jsonb_build_object('ciclo', 'cancelar'));
    return next jsonb_build_object('n', 43, 'titulo', 'PeYa cancela con 1 de 2 líneas ya hechas → aviso de comida a descartar',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Chilli Dog'), public.peya_ensayo_prod('Freakie Dog')),
      'opts', jsonb_build_object('ciclo', 'cancelar_parcial'));
    return next jsonb_build_object('n', 44, 'titulo', 'PeYa cancela DESPUÉS de cobrada → no se revierte el cobro, queda nota',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Super Freak')),
      'opts', jsonb_build_object('ciclo', 'cancelar_cobrada'));
    return next jsonb_build_object('n', 45, 'titulo', 'test:true (vendor real M001) + intento de cobro → sin_cuenta',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Combo Duo')),
      'opts', jsonb_build_object('es_prueba', true, 'vendor', 'M001', 'ciclo', 'cerrar'));
    return next jsonb_build_object('n', 46, 'titulo', 'Pedido del local de homologación (vendor es_pruebas) → omitido aunque no diga test',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys')),
      'opts', jsonb_build_object('vendor', 'AR-PRUEBAS-INTEGRACION-0001', 'espera', 'omitida'));
    return next jsonb_build_object('n', 47, 'titulo', '3 líneas, cocina marca 1 → listo=false, pendientes=2',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys'), public.peya_ensayo_prod('Freakie Fries'), public.peya_ensayo_prod('Coca Lata')),
      'opts', jsonb_build_object('ciclo', 'parcial'));
    return next jsonb_build_object('n', 48, 'titulo', 'Sin customer, sin comentario, sin shortCode → etiqueta y pago con el code + cobro',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Freakie Dog', 2)),
      'opts', jsonb_build_object('sin_customer', true, 'sin_short_code', true, 'ciclo', 'cerrar', 'total', 3.98));
    return next jsonb_build_object('n', 49, 'titulo', 'Pedido sin sucursal mapeada → error claro, nada creado',
      'productos', jsonb_build_array(public.peya_ensayo_prod('Fancys')),
      'opts', jsonb_build_object('sin_sucursal', true, 'espera', 'error', 'error_contiene', 'no tiene sucursal'));
    return next jsonb_build_object('n', 50, 'titulo', 'Nombres de PeYa con tildes y mayúsculas («Combo Fancy Dúo», «Freakie fries») sin remoteCode + cobro',
      'productos', jsonb_build_array(
        public.peya_ensayo_prod('Combo Fancy Duo', 1, null, '[]'::jsonb, false, 'Combo Fancy Dúo'),
        public.peya_ensayo_prod('Freakie Fries', 1, null, '[]'::jsonb, false, 'FREAKIE FRIES')),
      'opts', jsonb_build_object('nombres', jsonb_build_array('Combo Fancy Duo', 'Freakie Fries'), 'ciclo', 'cerrar'));
  end if;
  return;
end $$;
