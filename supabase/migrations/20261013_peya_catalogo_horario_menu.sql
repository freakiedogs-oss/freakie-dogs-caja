-- PeYa: el menú del catálogo va con horario (ScheduleEntry).
--
-- 13-oct-2026. Tras el primer import exitoso al sandbox (`done`, sin errores) la
-- tienda dejó de aparecer en la app aunque DH la reporta OPEN. El menú era lo
-- único del ejemplo del contrato que no mandábamos completo: iba sin
-- `schedule`. Se declara un ScheduleEntry de todos los días, 00:00–23:59, y el
-- Menu lo referencia. La hora de atención real sigue mandándola la tienda.
-- Misma función que `20261013_peya_catalogo_categoria_oculta_extras.sql` más
-- ese bloque.

create or replace function public.peya_catalogo(p_menu_id uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_menu     record;
  v_items    jsonb := '{}'::jsonb;
  v_prods    jsonb := '{}'::jsonb;
  v_opciones jsonb := '{}'::jsonb;
begin
  if p_menu_id is null then
    select * into v_menu from public.pos_menus where canal = 'pedidos_ya' and activo limit 1;
  else
    select * into v_menu from public.pos_menus where id = p_menu_id;
  end if;
  if v_menu.id is null then
    return jsonb_build_object('ok', false, 'error', 'sin_menu_pedidos_ya');
  end if;

  -- ── Productos vendibles ──────────────────────────────────────────────────
  -- `precio > 0`: lo que vale 0 es andamiaje interno de combos (la categoría
  -- "Componentes": Bebida, Fries, Hamburguesa…), no es vendible, y un producto
  -- de $0.00 en un marketplace es hallazgo de certificación.
  select
    coalesce(jsonb_object_agg(i.id::text, jsonb_strip_nulls(jsonb_build_object(
      'id',    i.id::text,
      'type',  'Product',
      'title', jsonb_build_object('default', left(i.nombre, 300)),
      'description', case when nullif(btrim(i.descripcion), '') is null then null
                          else jsonb_build_object('default', left(i.descripcion, 300)) end,
      'price', to_char(i.precio, 'FM9999990.00'),
      -- Desactivar NO es borrar: el ítem sigue en el catálogo y vuelve solo.
      'active', coalesce(i.disponible, false),
      'toppings', (
        select jsonb_object_agg('TOP-' || g.id,
                 jsonb_build_object('id', 'TOP-' || g.id, 'type', 'Topping'))
        from public.pos_item_modificadores im
        join public.pos_modificadores_grupo g on g.id = im.grupo_id and g.activo
        where im.menu_item_id = i.id
      )
    ))), '{}'::jsonb),
    coalesce(jsonb_object_agg(i.id::text, jsonb_build_object(
      'id', i.id::text, 'type', 'Product',
      'order', coalesce(nullif(i.orden, 0), 65536))), '{}'::jsonb)
  into v_items, v_prods
  from public.pos_menu_items i
  where i.menu_id = v_menu.id
    and coalesce(i.precio, 0) > 0;

  -- ── Grupos de modificadores (Topping) ────────────────────────────────────
  v_items := v_items || coalesce((
    select jsonb_object_agg('TOP-' || g.id, jsonb_build_object(
      'id',    'TOP-' || g.id,
      'type',  'Topping',
      'title', jsonb_build_object('default', left(g.nombre, 300)),
      'order', coalesce(nullif(g.orden, 0), 65536),
      'quantity', jsonb_build_object(
        'minimum', coalesce(g.min_selecciones, case when g.obligatorio then 1 else 0 end),
        -- `maximum` es obligatorio. Sin declararlo, se toma cuántas opciones
        -- tiene: es el techo real y es mejor que inventar un número.
        'maximum', coalesce(nullif(g.max_selecciones, 0),
                            (select count(*) from public.pos_modificadores m
                              where m.grupo_id = g.id and m.activo), 1)
      ),
      'products', coalesce((
        select jsonb_object_agg(m.id::text, jsonb_build_object(
          'id',    m.id::text,
          'type',  'Product',
          -- El precio del extra va ACÁ, en la referencia, no en el Product.
          'price', to_char(coalesce(m.precio_extra, 0), 'FM9999990.00'),
          'order', coalesce(nullif(m.orden, 0), 65536)))
        from public.pos_modificadores m where m.grupo_id = g.id and m.activo
      ), '{}'::jsonb)
    ))
    from public.pos_modificadores_grupo g
    where g.activo and exists (
      select 1 from public.pos_item_modificadores im
      join public.pos_menu_items i on i.id = im.menu_item_id
      where im.grupo_id = g.id and i.menu_id = v_menu.id
        and coalesce(i.precio, 0) > 0)
  ), '{}'::jsonb);

  -- ── Cada opción es TAMBIÉN un producto del catálogo ──────────────────────
  v_opciones := coalesce((
    select jsonb_object_agg(m.id::text, jsonb_build_object(
      'id',    m.id::text,
      'type',  'Product',
      'title', jsonb_build_object('default', left(m.nombre, 300)),
      'active', true))
    from public.pos_modificadores m
    join public.pos_modificadores_grupo g on g.id = m.grupo_id and g.activo
    where m.activo and exists (
      select 1 from public.pos_item_modificadores im
      join public.pos_menu_items i on i.id = im.menu_item_id
      where im.grupo_id = g.id and i.menu_id = v_menu.id
        and coalesce(i.precio, 0) > 0)
  ), '{}'::jsonb);
  v_items := v_items || v_opciones;

  -- ── Categorías ───────────────────────────────────────────────────────────
  -- Una categoría que se queda sin productos exportables (p.ej. "Componentes")
  -- no se manda: ensucia la carta con secciones vacías.
  v_items := v_items || coalesce((
    select jsonb_object_agg('CAT-' || c.id, jsonb_build_object(
      'id',    'CAT-' || c.id,
      'type',  'Category',
      'title', jsonb_build_object('default', left(c.nombre, 300)),
      'order', coalesce(nullif(c.orden, 0), 65536),
      'products', (
        select jsonb_object_agg(i.id::text, jsonb_build_object(
          'id', i.id::text, 'type', 'Product',
          'order', coalesce(nullif(i.orden, 0), 65536)))
        from public.pos_menu_items i
        where i.categoria_id = c.id and i.menu_id = v_menu.id
          and coalesce(i.precio, 0) > 0
      )
    ))
    from public.pos_menu_categorias c
    where c.menu_id = v_menu.id and c.activo
      and exists (select 1 from public.pos_menu_items i
                  where i.categoria_id = c.id and i.menu_id = v_menu.id
                    and coalesce(i.precio, 0) > 0)
  ), '{}'::jsonb);

  -- ── Categoría OCULTA con las opciones de modificador ─────────────────────
  -- DH rechaza el catálogo entero si un solo Product no cuelga de una
  -- Category («Product … does not belong to a category»), y las opciones de
  -- los Topping son Products. Van en una categoría propia que NO se agrega al
  -- Menu: así existe para la validación pero el cliente no la ve.
  if v_opciones <> '{}'::jsonb then
    v_items := v_items || jsonb_build_object('CAT-EXTRAS-' || v_menu.id, jsonb_build_object(
      'id',    'CAT-EXTRAS-' || v_menu.id,
      'type',  'Category',
      'title', jsonb_build_object('default', 'Extras y modificadores'),
      'order', 65536,
      'products', (
        select jsonb_object_agg(o.key, jsonb_build_object('id', o.key, 'type', 'Product'))
        from jsonb_each(v_opciones) o
      )
    ));
  end if;

  -- ── Horario del menú ─────────────────────────────────────────────────────
  -- El ejemplo del contrato siempre lleva un ScheduleEntry. Sin horario no hay
  -- franja en la que el menú "esté vigente"; se declara todo el día, todos los
  -- días: la hora real de atención la manda la tienda (availability), no el menú.
  -- Ojo: inicio y fin no pueden cruzar la medianoche (00:00 → 23:59 está bien).
  v_items := v_items || jsonb_build_object('HORARIO-' || v_menu.id, jsonb_build_object(
    'id',        'HORARIO-' || v_menu.id,
    'type',      'ScheduleEntry',
    'startTime', '00:00:00',
    'endTime',   '23:59:59',
    'weekDays',  jsonb_build_array('MONDAY','TUESDAY','WEDNESDAY','THURSDAY',
                                   'FRIDAY','SATURDAY','SUNDAY')
  ));

  -- ── El menú ──────────────────────────────────────────────────────────────
  v_items := v_items || jsonb_build_object('MENU-' || v_menu.id, jsonb_build_object(
    'id',       'MENU-' || v_menu.id,
    'type',     'Menu',
    'menuType', 'DELIVERY',
    'title',    jsonb_build_object('default', left(coalesce(v_menu.nombre, 'Menú'), 300)),
    'products', v_prods,
    'schedule', jsonb_build_object('HORARIO-' || v_menu.id,
                  jsonb_build_object('id', 'HORARIO-' || v_menu.id, 'type', 'ScheduleEntry'))
  ));

  return jsonb_build_object('ok', true, 'menu_id', v_menu.id,
                            'catalog', jsonb_build_object('items', v_items));
end $function$;
