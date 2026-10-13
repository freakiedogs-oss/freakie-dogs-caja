-- ═══════════════════════════════════════════════════════════════════════
-- 4-oct-2026 · Red de seguridad: lo que el cliente pagó a nivel combo llega al KDS
-- (aplicada vía MCP; ver memoria.md, «Extras pagados en delivery que no llegaban al KDS»)
--
-- El KDS arma una tarjeta por COMPONENTE del combo y solo le pone las
-- opciones de ese componente. Las elegidas a nivel combo se guardaban en la
-- cuenta pero no viajaban a ninguna tarjeta: la torre las veía, la cocina no.
--
-- Ahora toda opción del combo que no esté ya en un componente va a la
-- tarjeta del componente al que pertenece su grupo (Tocino → Hamburguesa,
-- Cheddar → Fries); si su grupo no cuelga de ningún componente, a la primera
-- tarjeta. Si llega un extra pagado y había un «Sin…» del mismo grupo, el
-- «Sin…» se quita. Solo cambia pos_cocina_queue: la cuenta queda igual,
-- porque de ahí descarga inventario y cobra.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._comanda_delivery(p_delivery_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row public.delivery_clientes%rowtype;
  v_menu_id uuid; v_store_code text; v_num_pos int; v_comanda int;
  v_cuenta_id uuid; v_item jsonb; v_item_id uuid; v_mods jsonb; v_nota text; v_mi uuid;
  v_comps jsonb; v_comp jsonb; v_cmods jsonb; v_cest text; v_nota_combo text;
  v_cambio text; v_nota_item text;
  v_huerf jsonb; v_sobrantes jsonb; v_extra_comp jsonb; v_asignados jsonb; v_ord int;
begin
  select * into v_row from public.delivery_clientes where id = p_delivery_id for update;
  if not found then raise exception 'delivery % no existe', p_delivery_id; end if;
  if v_row.pos_cuenta_id is not null then return v_row.pos_cuenta_id; end if;
  if v_row.sucursal_id is null then
    raise exception 'sin sucursal asignada: rutear antes de comandar';
  end if;

  v_nota := nullif(btrim(coalesce(v_row.notas_cliente, '')), '');

  select id into v_menu_id from public.pos_menus
    where canal='delivery_propio' and activo order by created_at limit 1;
  select store_code into v_store_code from public.sucursales where id = v_row.sucursal_id;

  select coalesce(max(numero_orden),0)+1 into v_num_pos
    from public.pos_cuentas
    where sucursal_id = v_row.sucursal_id and created_at::date = current_date;

  insert into public.pos_cuentas (
    sucursal_id, store_code, tipo, numero_orden,
    cliente_nombre, delivery_direccion, delivery_plataforma, delivery_referencia,
    delivery_metodo_pago, subtotal, iva, total, estado, notas_cocina,
    delivery_cliente_id, menu_id
  ) values (
    v_row.sucursal_id, v_store_code, 'delivery_propio', v_num_pos,
    v_row.cliente_nombre, v_row.cliente_direccion, 'freakie_app', v_row.numero_orden,
    v_row.metodo_pago, v_row.subtotal, round(v_row.total - v_row.total/1.13, 2), v_row.total,
    'enviada_cocina', v_nota, v_row.id, v_menu_id
  ) returning id into v_cuenta_id;

  select coalesce(max(comanda_numero),0)+1 into v_comanda
    from public.pos_cocina_queue
    where store_code = v_store_code and recibido_at::date = current_date;

  for v_item in select * from jsonb_array_elements(coalesce(v_row.items, '[]'::jsonb))
  loop
    v_mi := nullif(v_item->>'menu_item_id','')::uuid;
    if v_mi is null or not exists (select 1 from public.pos_menu_items where id = v_mi) then
      raise exception 'El pedido % trae "%" sin producto válido del menú. Revisá el pedido en la torre.',
        v_row.numero_orden, coalesce(v_item->>'nombre','(sin nombre)');
    end if;

    select string_agg('⚠️ CAMBIO: ' || (x->>'a') || ' en vez de ' || (x->>'de'), ' · ')
      into v_cambio
      from jsonb_array_elements(
             case when jsonb_typeof(v_item->'cambios')='array'
                  then v_item->'cambios' else '[]'::jsonb end) x;

    v_nota_item := nullif(v_item->>'nota','');
    if v_cambio is not null then
      v_nota_item := v_cambio || coalesce(' · ' || v_nota_item, '');
    end if;

    select coalesce(jsonb_agg(
             m || jsonb_build_object('grupo_nombre', coalesce(g.nombre, 'Modificadores'))
           ), '[]'::jsonb)
      into v_mods
    from jsonb_array_elements(coalesce(v_item->'modificadores', '[]'::jsonb)) m
    left join public.pos_modificadores o on o.id = nullif(m->>'id','')::uuid
    left join public.pos_modificadores_grupo g on g.id = o.grupo_id;

    v_comps := case when jsonb_typeof(v_item->'componentes') = 'array'
                    then v_item->'componentes' else '[]'::jsonb end;

    insert into public.pos_cuenta_items (
      cuenta_id, menu_item_id, nombre, cantidad,
      precio_unitario, modificadores, precio_modificadores, notas, estado_cocina, componentes
    ) values (
      v_cuenta_id, v_mi, v_item->>'nombre', coalesce((v_item->>'cantidad')::int, 1),
      coalesce((v_item->>'precio')::numeric, 0), v_mods,
      coalesce((v_item->>'precio_modificadores')::numeric, 0),
      v_nota_item, 'pendiente',
      case when jsonb_array_length(v_comps) > 0 then v_comps else null end
    ) returning id into v_item_id;

    if jsonb_array_length(v_comps) > 0 then
      v_nota_combo := 'Combo: ' || coalesce(v_item->>'nombre','');
      if v_cambio is not null then
        v_nota_combo := v_nota_combo || ' · ' || v_cambio;
      end if;
      if nullif(v_item->>'nota','') is not null then
        v_nota_combo := v_nota_combo || ' · ' || (v_item->>'nota');
      end if;

      -- Opciones elegidas a nivel combo que no están en ningún componente:
      -- son las que antes se perdían camino a la cocina.
      select coalesce(jsonb_agg(h), '[]'::jsonb) into v_huerf
      from jsonb_array_elements(v_mods) h
      where not exists (
        select 1 from jsonb_array_elements(v_comps) c,
             jsonb_array_elements(case when jsonb_typeof(c->'modificadores')='array'
                                       then c->'modificadores' else '[]'::jsonb end) cm
        where cm->>'id' = h->>'id');

      -- Las que no tienen un componente natural van a la primera tarjeta.
      select coalesce(jsonb_agg(h), '[]'::jsonb) into v_sobrantes
      from jsonb_array_elements(v_huerf) h
      left join public.pos_modificadores o on o.id = nullif(h->>'id','')::uuid
      where o.id is null or not exists (
        select 1 from jsonb_array_elements(v_comps) c
        join public.pos_item_modificadores im
          on im.menu_item_id = nullif(c->>'item_id','')::uuid and im.grupo_id = o.grupo_id);

      v_asignados := '[]'::jsonb;
      v_ord := 0;

      for v_comp in select * from jsonb_array_elements(v_comps)
      loop
        v_ord := v_ord + 1;

        select coalesce(jsonb_agg(
                 m || jsonb_build_object('grupo_nombre', coalesce(g.nombre, 'Modificadores'))
               ), '[]'::jsonb)
          into v_cmods
        from jsonb_array_elements(coalesce(v_comp->'modificadores', '[]'::jsonb)) m
        left join public.pos_modificadores o on o.id = nullif(m->>'id','')::uuid
        left join public.pos_modificadores_grupo g on g.id = o.grupo_id;

        -- Huérfanas cuyo grupo cuelga de ESTE componente (una sola vez cada una)
        select coalesce(jsonb_agg(h), '[]'::jsonb) into v_extra_comp
        from jsonb_array_elements(v_huerf) h
        join public.pos_modificadores o on o.id = nullif(h->>'id','')::uuid
        where not (v_asignados ? (h->>'id'))
          and exists (select 1 from public.pos_item_modificadores im
                       where im.menu_item_id = nullif(v_comp->>'item_id','')::uuid
                         and im.grupo_id = o.grupo_id);

        if v_ord = 1 then
          v_extra_comp := v_extra_comp || v_sobrantes;
        end if;

        if jsonb_array_length(v_extra_comp) > 0 then
          -- Un «Sin Extra» al lado del extra pagado confunde a la cocina.
          select coalesce(jsonb_agg(cm), '[]'::jsonb) into v_cmods
          from jsonb_array_elements(v_cmods) cm
          left join public.pos_modificadores o on o.id = nullif(cm->>'id','')::uuid
          where not (
            coalesce((cm->>'precio_extra')::numeric, 0) = 0
            and (cm->>'nombre') ~* '^\s*sin\s'
            and exists (
              select 1 from jsonb_array_elements(v_extra_comp) e
              join public.pos_modificadores eo on eo.id = nullif(e->>'id','')::uuid
              where eo.grupo_id = o.grupo_id
                and coalesce((e->>'precio_extra')::numeric, 0) > 0));

          v_cmods := v_cmods || v_extra_comp;
          select v_asignados || coalesce(jsonb_agg(e->>'id'), '[]'::jsonb)
            into v_asignados from jsonb_array_elements(v_extra_comp) e;
        end if;

        select coalesce(estacion,'general') into v_cest
          from public.pos_menu_items where id = nullif(v_comp->>'item_id','')::uuid;

        insert into public.pos_cocina_queue (
          cuenta_id, cuenta_item_id, store_code, sucursal_id, canal, estacion,
          mesa_ref, nombre_item, cantidad, nota, nota_pedido, comanda_numero,
          modificadores, precio_modificadores, cliente, total
        ) values (
          v_cuenta_id, v_item_id, v_store_code, v_row.sucursal_id, 'delivery_propio',
          coalesce(v_cest,'general'),
          '📲 App #' || coalesce(v_row.numero_orden,''), v_comp->>'nombre',
          coalesce((v_comp->>'cantidad')::int, 1) * coalesce((v_item->>'cantidad')::int, 1), v_nota_combo, v_nota, v_comanda,
          v_cmods, 0, v_row.cliente_nombre, v_row.total
        );
      end loop;

    elsif v_cambio is not null then
      insert into public.pos_cocina_queue (
        cuenta_id, cuenta_item_id, store_code, sucursal_id, canal,
        mesa_ref, nombre_item, cantidad, nota, nota_pedido, comanda_numero,
        modificadores, precio_modificadores, cliente, total
      ) values (
        v_cuenta_id, v_item_id, v_store_code, v_row.sucursal_id, 'delivery_propio',
        '📲 App #' || coalesce(v_row.numero_orden,''), v_item->>'nombre',
        coalesce((v_item->>'cantidad')::int, 1), v_nota_item, v_nota, v_comanda,
        v_mods, coalesce((v_item->>'precio_modificadores')::numeric, 0),
        v_row.cliente_nombre, v_row.total
      );
    else
      insert into public.pos_cocina_queue (
        cuenta_id, cuenta_item_id, store_code, sucursal_id, canal,
        mesa_ref, nombre_item, cantidad, nota, nota_pedido, comanda_numero,
        modificadores, precio_modificadores, cliente, total
      ) values (
        v_cuenta_id, v_item_id, v_store_code, v_row.sucursal_id, 'delivery_propio',
        '📲 App #' || coalesce(v_row.numero_orden,''), v_item->>'nombre',
        coalesce((v_item->>'cantidad')::int, 1), nullif(v_item->>'nota',''), v_nota, v_comanda,
        v_mods, coalesce((v_item->>'precio_modificadores')::numeric, 0),
        v_row.cliente_nombre, v_row.total
      );
    end if;
  end loop;

  update public.delivery_clientes set pos_cuenta_id = v_cuenta_id where id = v_row.id;
  return v_cuenta_id;
end;
$function$;
