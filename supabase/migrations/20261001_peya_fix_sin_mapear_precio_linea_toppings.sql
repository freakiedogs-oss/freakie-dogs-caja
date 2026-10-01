-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Producto comodín para líneas de PedidosYa que no mapean a nada del menú.
--    pos_cuenta_items.menu_item_id es NOT NULL + FK a pos_menu_items; el UUID
--    centinela 00000000-… no existe → un solo producto desconocido tiraba el
--    pedido ENTERO con FK violation. El comodín vive en el menú de PeYa a $0,
--    no disponible y no visible: el serializador del catálogo filtra precio>0,
--    así que nunca viaja a Delivery Hero.
-- ─────────────────────────────────────────────────────────────────────────────
insert into pos_menu_items (menu_id, categoria_id, nombre, nombre_corto, descripcion, precio,
                            disponible, orden, requiere_preparacion, estacion, slug, visible_publico)
select 'db0f8d05-0d72-435f-bf82-41a776802549',
       (select categoria_id from pos_menu_items
         where menu_id = 'db0f8d05-0d72-435f-bf82-41a776802549' and categoria_id is not null
         order by orden limit 1),
       '⚠️ Producto PeYa sin mapear', 'PeYa ?',
       'Comodín interno: la línea llegó de PedidosYa con un producto que no está en el menú. No se vende ni se exporta.',
       0, false, 9999, true, 'general', 'peya-sin-mapear', false
where not exists (select 1 from pos_menu_items
                   where slug = 'peya-sin-mapear' and menu_id = 'db0f8d05-0d72-435f-bf82-41a776802549');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. peya_traducir_toppings: resolver primero por remoteCode (el id de
--    pos_modificadores que mandamos en el catálogo y que PeYa nos devuelve),
--    luego por el mapa de nombres de PeYa, y al final por NUESTRO nombre de
--    opción. Antes sólo miraba el mapa: con el catálogo nuevo PeYa devuelve
--    nuestros nombres ("Coca-Cola Lata", "Sin Extra") y salían «⚠️ sin mapear».
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.peya_traducir_toppings(p_menu_item_id uuid, p_toppings jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_planos   jsonb;
  v_fams     jsonb := '{}'::jsonb;  -- "clave#slot" -> {id, nombre}
  v_opts     jsonb := '{}'::jsonb;  -- clave -> [opciones normalizadas]
  v_base     jsonb := '{}'::jsonb;  -- clave -> nombre legible de la familia
  v_slot     jsonb := '{}'::jsonb;  -- clave -> unidad en curso
  v_usados   jsonb := '{}'::jsonb;  -- "clave#slot" -> [nombres ya usados]
  v_cerrado  jsonb := '{}'::jsonb;  -- "clave#slot" -> true si la ocupó un preset
  v_tocada   jsonb := '{}'::jsonb;  -- clave -> true si ya se usó alguna vez
  v_previa   text  := null;
  f          record;
  v_top      jsonb;
  v_nombre   text;
  v_precio   numeric;
  v_rc       text;
  v_preset   record;
  v_es_preset boolean;
  v_hay      boolean;
  v_nombres  text[];
  v_hint     text;
  v_clave    text;
  v_cand     text;
  v_cabe     boolean;
  v_sin_estrenar boolean;
  v_s        int;
  v_usa      jsonb;
  v_grupo    jsonb;
  v_gnombre  text;
  v_gid      uuid;
  v_mod      record;
  v_n        text;
  v_out      jsonb := '[]'::jsonb;
  v_primero  boolean;
begin
  -- PedidosYa manda los modificadores como árbol: el grupo (la pregunta) es el
  -- padre y la opción elegida vive en `children`. Sin aplanar, acá entraba el
  -- nombre del grupo y salía «⚠️ sin mapear»: cocina veía la pregunta y nunca
  -- la respuesta.
  v_planos := public.peya_toppings_planos(p_toppings);
  if coalesce(jsonb_array_length(v_planos), 0) = 0 then return v_out; end if;

  for f in select * from public.peya_familias_item(p_menu_item_id) loop
    v_fams := jsonb_set(v_fams, array[f.clave || '#' || f.slot],
                jsonb_build_object('id', f.grupo_id, 'nombre', f.grupo_nombre), true);
    v_opts := jsonb_set(v_opts, array[f.clave],
                coalesce(v_opts->f.clave, '[]'::jsonb) ||
                to_jsonb(coalesce(f.opciones, array[]::text[])), true);
    if f.slot = 1 then
      v_base := jsonb_set(v_base, array[f.clave], to_jsonb(f.grupo_nombre), true);
    end if;
  end loop;

  for v_top in select value from jsonb_array_elements(v_planos) loop
    v_nombre := btrim(coalesce(v_top->>'name', ''));
    v_precio := coalesce(nullif(btrim(coalesce(v_top->>'price', '')), '')::numeric, 0);
    v_rc     := nullif(btrim(coalesce(v_top->>'remoteCode', '')), '');
    if v_nombre = '' and v_rc is null then continue; end if;

    -- ── 1. A qué opciones nuestras equivale ────────────────────────────────
    -- Orden: remoteCode (es NUESTRO id, viaja en el catálogo y vuelve en el
    -- pedido) → preset entre paréntesis → mapa de nombres de PeYa → nuestro
    -- propio nombre de opción → sin mapear.
    v_hint := null; v_es_preset := false; v_n := null; v_nombres := null;

    if v_rc ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select btrim(m.nombre) into v_n from pos_modificadores m
       where m.id = v_rc::uuid and m.activo;
    end if;

    if v_n is not null then
      v_nombres := array[v_n];
    else
      -- Preset: «Con todo (Ketchup, Mayonesa, …)» o el texto pelado sin paréntesis.
      select * into v_preset from peya_preset_map
       where parentesis_norm = public.peya_parentesis(v_nombre);
      v_hay := found;
      if not v_hay then
        select * into v_preset from peya_preset_map
         where parentesis_norm = public.peya_norm(v_nombre);
        v_hay := found;
      end if;

      if v_hay then
        v_es_preset := true;
        v_nombres   := coalesce(v_preset.expande_a, array[]::text[]);
        v_hint      := v_preset.grupo_pos;
      else
        select nombre_pos into v_n from peya_modificador_map
         where peya_nombre_norm = public.peya_norm(v_nombre);
        if v_n is null then
          select nombre_pos into v_n from peya_modificador_map
           where peya_nombre_norm = public.peya_sin_parentesis(v_nombre);
        end if;
        if v_n is null then
          -- Nuestro propio nombre, tal cual lo publica el catálogo. Preferimos
          -- una opción que pertenezca a los grupos de este producto.
          select btrim(m.nombre) into v_n
            from pos_modificadores m
            join pos_modificadores_grupo g on g.id = m.grupo_id
           where m.activo and g.activo
             and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_nombre)
           order by (exists (select 1 from jsonb_each(v_fams) e
                              where (e.value->>'id')::uuid = g.id)) desc, g.nombre
           limit 1;
        end if;
        if v_n is null then
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'grupo_id', null, 'grupo_nombre', 'PeYa sin mapear',
            'opcion_id', null, 'nombre', '⚠️ ' || coalesce(nullif(v_nombre, ''), v_rc),
            'precio_extra', v_precio));
          continue;
        end if;
        v_nombres := array[v_n];
      end if;
    end if;

    -- ── 2. Qué familia ─────────────────────────────────────────────────────
    -- Orden de preferencia: pista del preset → familia sin estrenar →
    -- seguir en la del topping anterior → cualquiera que encaje.
    v_clave := null; v_sin_estrenar := false;

    if v_hint is not null and v_opts ? public.peya_familia_clave(v_hint) then
      v_clave := public.peya_familia_clave(v_hint);
    end if;

    if v_clave is null and cardinality(v_nombres) > 0 then
      for v_cand in select k from jsonb_object_keys(v_opts) k loop
        select bool_and(to_jsonb(public.peya_norm(x)) <@ (v_opts->v_cand))
          into v_cabe from unnest(v_nombres) x;
        if coalesce(v_cabe, false) then
          if not (v_tocada ? v_cand) then
            v_clave := v_cand; v_sin_estrenar := true; exit;
          end if;
          if v_previa = v_cand then v_clave := v_cand;
          elsif v_clave is null then v_clave := v_cand; end if;
        end if;
      end loop;

      -- La continuidad le gana a "cualquiera", pero nunca a "sin estrenar".
      if not v_sin_estrenar
         and v_previa is not null and v_clave is not null and v_clave <> v_previa then
        select bool_and(to_jsonb(public.peya_norm(x)) <@ coalesce(v_opts->v_previa, '[]'::jsonb))
          into v_cabe from unnest(v_nombres) x;
        if coalesce(v_cabe, false) then v_clave := v_previa; end if;
      end if;
    end if;

    if v_clave is null and v_hint is not null then
      v_clave := public.peya_familia_clave(v_hint);
      if not (v_base ? v_clave) then
        v_base := jsonb_set(v_base, array[v_clave], to_jsonb(v_hint), true);
      end if;
    end if;

    if v_clave is null then
      select g.nombre into v_gnombre
        from pos_modificadores m
        join pos_modificadores_grupo g on g.id = m.grupo_id
       where m.activo and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_nombres[1])
       order by g.nombre limit 1;
      v_gnombre := coalesce(v_gnombre, 'Modificadores');
      v_clave   := public.peya_familia_clave(v_gnombre);
      if not (v_base ? v_clave) then
        v_base := jsonb_set(v_base, array[v_clave], to_jsonb(v_gnombre), true);
      end if;
    end if;

    -- ── 3. Qué unidad ──────────────────────────────────────────────────────
    v_s   := coalesce((v_slot->>v_clave)::int, 1);
    v_usa := coalesce(v_usados->(v_clave || '#' || v_s), '[]'::jsonb);
    if exists (select 1 from unnest(v_nombres) x where to_jsonb(public.peya_norm(x)) <@ v_usa)
       or coalesce((v_cerrado->>(v_clave || '#' || v_s))::boolean, false)
    then
      v_s := v_s + 1;
      v_usa := '[]'::jsonb;
    end if;
    v_slot   := jsonb_set(v_slot, array[v_clave], to_jsonb(v_s), true);
    v_tocada := jsonb_set(v_tocada, array[v_clave], 'true'::jsonb, true);
    v_previa := v_clave;

    v_grupo   := v_fams -> (v_clave || '#' || v_s);
    v_gid     := nullif(v_grupo->>'id', '')::uuid;
    v_gnombre := coalesce(v_grupo->>'nombre',
                   -- El menú no declara tantas unidades: se numera igual. Perder
                   -- el corte entre unidades es peor que un nombre que no existe.
                   (v_base->>v_clave) || case when v_s > 1 then ' ' || v_s else '' end,
                   'Modificadores');

    -- ── 4. Salen las opciones ──────────────────────────────────────────────
    v_primero := true;
    foreach v_n in array v_nombres loop
      select m.id, btrim(m.nombre) as nombre into v_mod
        from pos_modificadores m
       where m.activo and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_n)
         and (v_gid is null or m.grupo_id = v_gid)
       limit 1;
      if v_mod.id is null then
        select m.id, btrim(m.nombre) into v_mod from pos_modificadores m
         where m.activo and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_n)
         limit 1;
      end if;

      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'grupo_id', v_gid, 'grupo_nombre', v_gnombre,
        'opcion_id', v_mod.id, 'nombre', coalesce(v_mod.nombre, v_n),
        -- El precio lo manda PedidosYa y es el que nos liquidan. Sólo la primera
        -- opción de un preset se lo queda, para no multiplicarlo.
        'precio_extra', case when v_primero then v_precio else 0 end));
      v_usa := v_usa || to_jsonb(public.peya_norm(v_n));
      v_primero := false;
    end loop;

    if v_es_preset then
      if cardinality(v_nombres) = 0 then v_usa := v_usa || to_jsonb('∅'::text); end if;
      v_cerrado := jsonb_set(v_cerrado, array[v_clave || '#' || v_s], 'true'::jsonb, true);
    end if;

    v_usados := jsonb_set(v_usados, array[v_clave || '#' || v_s], v_usa, true);
  end loop;

  return v_out;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. peya_crear_cuenta:
--    · producto sin mapear → comodín real (antes: FK violation, pedido entero
--      sin comanda).
--    · precio por línea: `unitPrice` es la base por unidad; `paidPrice` es el
--      TOTAL de la línea (unitPrice × cantidad, con toppings). Verificado con el
--      payload real de PeYa: unitPrice 350 × quantity 3 = paidPrice 1050. Antes
--      se guardaba paidPrice como unitario y se multiplicaba otra vez.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.peya_crear_cuenta(p_orden_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_menu_peya  uuid := 'db0f8d05-0d72-435f-bf82-41a776802549';
  v_sin_mapear uuid;
  o            record;
  v_suc        record;
  v_turno      uuid;
  v_cuenta     uuid;
  v_numero     int;
  v_comanda    int;
  v_etiqueta   text;
  v_marca      text;
  v_nota_ped   text;
  v_prod       jsonb;
  v_item_id    uuid;
  v_menu_item  uuid;
  v_nombre_pos text;
  v_estacion   text;
  v_cant       int;
  v_unit       numeric;
  v_paid       numeric;
  v_precio     numeric;
  v_mods       jsonb;
  v_mods_precio numeric;
  v_suma       numeric := 0;
  v_total      numeric;
  v_grand      numeric;
  v_sin_map    int := 0;
  v_raras      int := 0;
  v_cliente    text;
  v_nota_int   text;
begin
  select * into o from peya_ordenes where id = p_orden_id for update;
  if not found then raise exception 'Pedido % no existe', p_orden_id; end if;
  if o.pos_cuenta_id is not null then
    return jsonb_build_object('ok', true, 'ya_existia', true, 'cuenta_id', o.pos_cuenta_id);
  end if;
  if o.sucursal_id is null then raise exception 'El pedido % no tiene sucursal mapeada', p_orden_id; end if;

  -- Lo que no se cocina, no baja. Decide `peya_debe_cocinar`, que es la única
  -- copia de esta regla.
  if not coalesce(public.peya_debe_cocinar(p_orden_id), false) then
    return jsonb_build_object('ok', true, 'omitida', true,
      'motivo', 'pedido de prueba: se acepta en PedidosYa pero no baja a cocina');
  end if;

  select id, store_code, nombre into v_suc from sucursales where id = o.sucursal_id;

  select t.id into v_turno from pos_turnos t
   where t.store_code = v_suc.store_code and t.cerrado_at is null
   order by t.abierto_at desc limit 1;
  if v_turno is null then
    raise exception 'No hay caja abierta en % — el pedido no debe aceptarse', v_suc.store_code;
  end if;

  -- El comodín para líneas desconocidas. Es un ítem real del menú (oculto, $0)
  -- porque pos_cuenta_items exige un menu_item_id que exista.
  select id into v_sin_mapear from pos_menu_items
   where menu_id = v_menu_peya and slug = 'peya-sin-mapear' limit 1;
  if v_sin_mapear is null then
    raise exception 'Falta el ítem comodín "peya-sin-mapear" en el menú de PedidosYa';
  end if;

  select coalesce(max(numero_orden), 0) + 1 into v_numero
    from pos_cuentas where sucursal_id = o.sucursal_id and created_at::date = current_date;
  select coalesce(max(comanda_numero), 0) + 1 into v_comanda
    from pos_cocina_queue where store_code = v_suc.store_code and recibido_at::date = current_date;

  -- El shortCode es por lo que pregunta el driver (spec de DH). Y si es prueba,
  -- la comanda lo dice: el cocinero no lee la bandeja de caja, lee el KDS.
  v_etiqueta := public.peya_etiqueta_comanda(o.short_code, o.code, o.remote_order_id, o.es_prueba);
  v_marca    := case when coalesce(o.es_prueba, false) then '🧪 ' else '' end;
  v_cliente  := btrim(coalesce(o.payload->'customer'->>'firstName', '') || ' ' ||
                      coalesce(o.payload->'customer'->>'lastName', ''));
  v_nota_ped := concat_ws(' · ',
                  case when coalesce(o.es_prueba, false) then 'PEDIDO DE PRUEBA — NO PREPARAR' end,
                  nullif(o.payload->'comments'->>'customerComment', ''));
  v_grand := coalesce(nullif(o.payload->'price'->>'grandTotal', '')::numeric, 0);

  insert into pos_cuentas (
    sucursal_id, store_code, turno_id, tipo, numero_orden,
    cliente_nombre, delivery_plataforma, delivery_referencia,
    subtotal, iva, total, estado, notas_cocina, menu_id
  ) values (
    o.sucursal_id, v_suc.store_code, v_turno, 'pedidos_ya', v_numero,
    nullif(v_cliente, ''), 'pedidos_ya', coalesce(o.short_code, o.code),
    0, 0, 0, 'abierta', nullif(v_nota_ped, ''), v_menu_peya
  ) returning id into v_cuenta;

  for v_prod in select * from jsonb_array_elements(coalesce(o.payload->'products', '[]'::jsonb))
  loop
    v_cant := greatest(1, coalesce(nullif(btrim(coalesce(v_prod->>'quantity', '')), '')::numeric, 1)::int);
    v_unit := nullif(btrim(coalesce(v_prod->>'unitPrice', '')), '')::numeric;
    v_paid := nullif(btrim(coalesce(v_prod->>'paidPrice', '')), '')::numeric;

    v_menu_item := null;
    if coalesce(v_prod->>'remoteCode', '') <> '' then
      select id into v_menu_item from pos_menu_items where id::text = v_prod->>'remoteCode' limit 1;
    end if;
    if v_menu_item is null then
      select m.menu_item_id into v_menu_item from peya_producto_map m
       where m.peya_nombre_norm = public.peya_norm(v_prod->>'name');
    end if;

    if v_menu_item is null then
      v_sin_map := v_sin_map + 1;
      insert into peya_sin_mapear (tipo, texto_crudo, texto_norm, ultimo_pedido)
      values ('producto', coalesce(v_prod->>'name', '(sin nombre)'),
              coalesce(public.peya_norm(v_prod->>'name'), '(sin nombre)'), o.remote_order_id)
      on conflict (tipo, texto_norm) do update
        set veces = peya_sin_mapear.veces + 1, ultimo_visto = now(),
            ultimo_pedido = excluded.ultimo_pedido;
      v_nombre_pos := '⚠️ ' || coalesce(v_prod->>'name', 'producto sin nombre');
      v_estacion   := 'general';
      v_menu_item  := v_sin_mapear;
    else
      select btrim(nombre), coalesce(estacion, 'general') into v_nombre_pos, v_estacion
        from pos_menu_items where id = v_menu_item;
    end if;

    -- La lista COMPLETA de una sola vez: es lo único que permite saber dónde
    -- termina una unidad y empieza la otra, y repartirlas en los grupos
    -- numerados del producto (Salsas Papas / Salsas Papas 2, etc.).
    v_mods := public.peya_traducir_toppings(
      v_menu_item, coalesce(v_prod->'selectedToppings', '[]'::jsonb));

    select coalesce(sum((x->>'precio_extra')::numeric), 0) into v_mods_precio
      from jsonb_array_elements(v_mods) x;

    -- unitPrice = base por unidad sin toppings. paidPrice = total de la línea.
    -- Si sólo viene paidPrice, se deshace la cuenta para no inflar la unidad.
    if v_unit is null then
      v_unit := case when v_paid is not null
                     then greatest(round(v_paid / v_cant - v_mods_precio, 2), 0)
                     else 0 end;
    end if;
    v_precio := v_unit;
    if v_paid is not null and abs(v_paid - (v_precio + v_mods_precio) * v_cant) >= 0.01 then
      v_raras := v_raras + 1;
    end if;

    insert into pos_cuenta_items (
      cuenta_id, menu_item_id, nombre, cantidad, precio_unitario,
      modificadores, precio_modificadores, estado_cocina, comanda_numero, enviado_cocina_at
    ) values (
      v_cuenta, v_menu_item, v_marca || v_nombre_pos, v_cant, v_precio,
      v_mods, v_mods_precio, 'pendiente', v_comanda, now()
    ) returning id into v_item_id;

    v_suma := v_suma + (v_precio + v_mods_precio) * v_cant;

    insert into pos_cocina_queue (
      cuenta_id, cuenta_item_id, sucursal_id, store_code, canal, estacion,
      mesa_ref, nombre_item, cantidad, nota, comanda_numero,
      modificadores, precio_modificadores, cliente, nota_pedido
    ) values (
      v_cuenta, v_item_id, o.sucursal_id, v_suc.store_code, 'pedidos_ya', v_estacion,
      v_etiqueta, v_marca || v_nombre_pos, v_cant, nullif(btrim(coalesce(v_prod->>'comment', '')), ''), v_comanda,
      v_mods, v_mods_precio, nullif(v_cliente, ''), nullif(v_nota_ped, '')
    );
  end loop;

  -- La venta es `totalNet`, no `grandTotal`: el segundo trae el envío, que cobra
  -- PedidosYa y no es venta nuestra.
  v_total := public.peya_total_venta(o.payload, v_suma);

  v_nota_int := concat_ws(' · ',
    case when abs(v_suma - v_total) >= 0.01
         then 'Suma de líneas $' || to_char(v_suma, 'FM999990.00') ||
              ' ≠ totalNet $' || to_char(v_total, 'FM999990.00') ||
              ' (grandTotal con envío: $' || to_char(v_grand, 'FM999990.00') || ')' end,
    case when v_raras > 0
         then v_raras || ' línea(s) con paidPrice ≠ unitPrice × cantidad + extras' end,
    case when v_sin_map > 0
         then v_sin_map || ' línea(s) sin mapear: revisar en Pedidos PeYa' end);

  update pos_cuentas
     set subtotal = v_total, total = v_total,
         notas_internas = nullif(v_nota_int, '')
   where id = v_cuenta;

  update pos_cocina_queue set total = v_total where cuenta_id = v_cuenta;
  update peya_ordenes set pos_cuenta_id = v_cuenta, actualizado_at = now() where id = p_orden_id;

  return jsonb_build_object(
    'ok', true, 'cuenta_id', v_cuenta, 'numero_orden', v_numero, 'comanda', v_comanda,
    'etiqueta', v_etiqueta, 'total_venta', v_total, 'suma_lineas', v_suma,
    'grand_total_peya', v_grand, 'lineas_sin_mapear', v_sin_map, 'lineas_precio_raro', v_raras,
    'es_prueba', coalesce(o.es_prueba,false));
end;
$function$;
