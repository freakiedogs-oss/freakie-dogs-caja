-- PeYa: los combos salían al catálogo SIN modificadores.
--
-- 13-oct-2026, con la carta ya publicada en la tienda sandbox: «Combo
-- Hamburguesa», «Combo Duo», «Mega Promo», «Freakie Family»… no dejaban elegir
-- ni salsas ni bebida. En el POS un combo no tiene grupos propios: se arma con
-- componentes (Hamburguesa, Fries, Bebida… a $0, categoría «Componentes») y las
-- salsas, extras y sabor de bebida cuelgan de CADA componente. El catálogo
-- excluía los componentes (valen $0, no se venden sueltos) y con ellos se iban
-- sus grupos.
--
-- Ahora un combo lleva, por cada unidad de componente, los grupos de ese
-- componente: Combo Duo (2 hot dogs, 2 papas, 2 bebidas) sale con
-- «Complemento de Hot Dog», «Complemento de Hot Dog 2», «Salsas Papas»,
-- «Salsas Papas 2», «Bebida», «Bebida 2»… La numeración es la misma convención
-- de los grupos del POS («Salsas Papas 2») y la que entiende el intake
-- (`peya_familia_slot` lee el número final; `peya_traducir_toppings` reparte
-- las opciones repetidas en unidades). Los Topping numerados son copias del
-- grupo base con id `TOP-<grupo>-<n>`: mismas opciones, mismo min/max.
--
-- `peya_combo_slots(menu)` es el único lugar que sabe armar esas unidades.

create or replace function public.peya_combo_slots(p_menu_id uuid)
returns table(combo_item_id uuid, grupo_id uuid, grupo_nombre text, slot integer, orden integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with comp as (
    -- Una fila por UNIDAD de componente (cantidad 2 = dos filas).
    select cc.combo_item_id, cc.componente_item_id,
           row_number() over (partition by cc.combo_item_id
                              order by cc.orden nulls last, cc.created_at, cc.id, u.n) as fila
      from pos_combo_componentes cc
      join pos_menu_items ci on ci.id = cc.combo_item_id
      cross join lateral generate_series(1, greatest(coalesce(cc.cantidad, 1), 1)) as u(n)
     where ci.menu_id = p_menu_id and coalesce(ci.precio, 0) > 0
  ),
  cg as (
    select c.combo_item_id, c.fila, g.id as grupo_id, g.nombre as grupo_nombre,
           -- Dentro de una unidad: orden del POS, luego el obligatorio primero
           -- (Bebida antes que Agrandado de bebida), luego alfabético.
           coalesce(nullif(g.orden, 0), 65536) as g_orden,
           (not coalesce(g.obligatorio, false))::int as g_opcional
      from comp c
      join pos_item_modificadores im on im.menu_item_id = c.componente_item_id
      join pos_modificadores_grupo g on g.id = im.grupo_id and g.activo
  )
  select combo_item_id, grupo_id, grupo_nombre,
         (row_number() over (partition by combo_item_id, grupo_id order by fila))::int as slot,
         (fila * 100 + row_number() over (partition by combo_item_id, fila order by g_orden, g_opcional, grupo_nombre))::int as orden
    from cg;
$function$;

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
      -- Grupos propios del ítem + los de cada unidad de componente si es combo.
      'toppings', nullif(
        coalesce((
          select jsonb_object_agg('TOP-' || g.id,
                   jsonb_build_object('id', 'TOP-' || g.id, 'type', 'Topping',
                                      'order', coalesce(nullif(g.orden, 0), 65536)))
          from public.pos_item_modificadores im
          join public.pos_modificadores_grupo g on g.id = im.grupo_id and g.activo
          where im.menu_item_id = i.id
        ), '{}'::jsonb)
        ||
        coalesce((
          select jsonb_object_agg(
                   'TOP-' || s.grupo_id || case when s.slot > 1 then '-' || s.slot else '' end,
                   jsonb_build_object(
                     'id', 'TOP-' || s.grupo_id || case when s.slot > 1 then '-' || s.slot else '' end,
                     'type', 'Topping', 'order', s.orden))
          from public.peya_combo_slots(v_menu.id) s
          where s.combo_item_id = i.id
        ), '{}'::jsonb),
        '{}'::jsonb)
    ))), '{}'::jsonb),
    coalesce(jsonb_object_agg(i.id::text, jsonb_build_object(
      'id', i.id::text, 'type', 'Product',
      'order', coalesce(nullif(i.orden, 0), 65536))), '{}'::jsonb)
  into v_items, v_prods
  from public.pos_menu_items i
  where i.menu_id = v_menu.id
    and coalesce(i.precio, 0) > 0;

  -- ── Grupos de modificadores (Topping) ────────────────────────────────────
  -- Entran los grupos colgados de un ítem vendible y los de los componentes de
  -- un combo vendible. Cada grupo sale como `TOP-<id>` y, si algún combo lo
  -- repite (dos hot dogs), también como `TOP-<id>-2`, `-3`…: misma pregunta,
  -- mismas opciones, título numerado.
  v_items := v_items || coalesce((
    with grupos as (
      select g.*
        from public.pos_modificadores_grupo g
       where g.activo and (
         exists (select 1 from public.pos_item_modificadores im
                   join public.pos_menu_items i on i.id = im.menu_item_id
                  where im.grupo_id = g.id and i.menu_id = v_menu.id
                    and coalesce(i.precio, 0) > 0)
         or exists (select 1 from public.peya_combo_slots(v_menu.id) s where s.grupo_id = g.id))
    ),
    base as (
      select g.id, g.nombre, jsonb_build_object(
        'type',  'Topping',
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
      ) as cuerpo
      from grupos g
    ),
    variantes as (
      select 'TOP-' || b.id as tid, b.nombre as titulo, b.cuerpo from base b
      union all
      select 'TOP-' || b.id || '-' || s.slot, b.nombre || ' ' || s.slot, b.cuerpo
        from base b
        join (select distinct grupo_id, slot from public.peya_combo_slots(v_menu.id) where slot > 1) s
          on s.grupo_id = b.id
    )
    select jsonb_object_agg(v.tid, v.cuerpo || jsonb_build_object(
             'id', v.tid, 'title', jsonb_build_object('default', left(v.titulo, 300))))
      from variantes v
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
    where m.activo and (
      exists (select 1 from public.pos_item_modificadores im
                join public.pos_menu_items i on i.id = im.menu_item_id
               where im.grupo_id = g.id and i.menu_id = v_menu.id
                 and coalesce(i.precio, 0) > 0)
      or exists (select 1 from public.peya_combo_slots(v_menu.id) s where s.grupo_id = g.id))
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
  -- El ejemplo del contrato siempre lleva un ScheduleEntry. Se declara todo el
  -- día, todos los días: la hora real de atención la manda la tienda. Inicio y
  -- fin no pueden cruzar la medianoche.
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
