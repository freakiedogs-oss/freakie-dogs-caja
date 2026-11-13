-- PeYa: fotos de producto y horario por sección en el catálogo.
--
-- 13-nov-2026, homologación con PedidosYa. Pidieron ver:
--   · «Cargar fotos para productos»: `pos_menu_items.imagen_url` existía pero el
--     catálogo no lo mandaba. Ahora cada producto con foto lleva un item `Image`
--     (`IMG-<item>`) referenciado desde `images`. Sólo la foto PROPIA del ítem
--     del menú PedidosYa: se probó heredar la del mismo `producto_id` de otro
--     menú del POS y DH rechazó exactamente esas 26 («Failed on 26 actions
--     while creating images») mientras aceptaba las 22 propias; quedó afuera
--     (aplicado en la base como `peya_catalogo_solo_fotos_propias`).
--     Límites de DH: ≤ 20 MB, < 4000 px por lado, GIF/JPEG/PNG/SVG/TIFF/WebP.
--   · «Cargar horarios a secciones»: en el contrato de DH el horario NO vive en
--     la Category sino en el Menu (ScheduleEntry referenciada). Una sección con
--     horario sale entonces como un Menu propio con su ScheduleEntry
--     (`MENU-<menu>-CAT-<cat>` / `HORARIO-CAT-<cat>`) y sus productos dejan de
--     ir en el menú general, que sigue 00:00–23:59.
--     El horario se guarda en `peya_categoria_horario`, aparte de
--     `pos_menu_categorias`, para no tocar la tabla que usa el POS.

create table if not exists public.peya_categoria_horario (
  categoria_id   uuid primary key references public.pos_menu_categorias(id) on delete cascade,
  hora_inicio    time not null,
  hora_fin       time not null,
  dias           text[] not null default array['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'],
  actualizado_at timestamptz not null default now(),
  constraint peya_categoria_horario_no_cruza check (hora_fin > hora_inicio),
  constraint peya_categoria_horario_dias check (
    dias <@ array['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'] and cardinality(dias) > 0)
);
alter table public.peya_categoria_horario enable row level security;
-- Sin políticas: sólo la lee `peya_catalogo` (security definer) y la escribe
-- el back-office por service role.

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
  v_fotos    jsonb := '{}'::jsonb;
begin
  if p_menu_id is null then
    select * into v_menu from public.pos_menus where canal = 'pedidos_ya' and activo limit 1;
  else
    select * into v_menu from public.pos_menus where id = p_menu_id;
  end if;
  if v_menu.id is null then
    return jsonb_build_object('ok', false, 'error', 'sin_menu_pedidos_ya');
  end if;

  -- ── Fotos ────────────────────────────────────────────────────────────────
  -- La propia del ítem; si no tiene, la del mismo producto en otro menú.
  select coalesce(jsonb_object_agg(f.item_id, f.url), '{}'::jsonb) into v_fotos
  from (
    select i.id::text as item_id,
           nullif(btrim(i.imagen_url), '') as url
      from public.pos_menu_items i
     where i.menu_id = v_menu.id and coalesce(i.precio, 0) > 0
  ) f
  where f.url is not null;

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
      'images', case when v_fotos ? i.id::text then
                  jsonb_build_object('IMG-' || i.id, jsonb_build_object(
                    'id', 'IMG-' || i.id, 'type', 'Image', 'order', 1)) end,
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
    -- Al menú general van sólo los productos de secciones SIN horario propio.
    coalesce(jsonb_object_agg(i.id::text, jsonb_build_object(
      'id', i.id::text, 'type', 'Product',
      'order', coalesce(nullif(i.orden, 0), 65536)))
      filter (where not exists (select 1 from public.peya_categoria_horario h
                                 where h.categoria_id = i.categoria_id)), '{}'::jsonb)
  into v_items, v_prods
  from public.pos_menu_items i
  where i.menu_id = v_menu.id
    and coalesce(i.precio, 0) > 0;

  -- ── Imágenes ─────────────────────────────────────────────────────────────
  v_items := v_items || coalesce((
    select jsonb_object_agg('IMG-' || i.id, jsonb_build_object(
      'id',  'IMG-' || i.id,
      'type', 'Image',
      'url', v_fotos ->> i.id::text,
      'alt', jsonb_build_object('default', left(i.nombre, 300))))
    from public.pos_menu_items i
    where i.menu_id = v_menu.id and coalesce(i.precio, 0) > 0
      and v_fotos ? i.id::text
  ), '{}'::jsonb);

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

  -- ── Horario del menú general ─────────────────────────────────────────────
  -- Todo el día, todos los días: la hora real de atención la manda la tienda.
  -- Inicio y fin no pueden cruzar la medianoche.
  v_items := v_items || jsonb_build_object('HORARIO-' || v_menu.id, jsonb_build_object(
    'id',        'HORARIO-' || v_menu.id,
    'type',      'ScheduleEntry',
    'startTime', '00:00:00',
    'endTime',   '23:59:59',
    'weekDays',  jsonb_build_array('MONDAY','TUESDAY','WEDNESDAY','THURSDAY',
                                   'FRIDAY','SATURDAY','SUNDAY')
  ));

  -- ── El menú general ──────────────────────────────────────────────────────
  v_items := v_items || jsonb_build_object('MENU-' || v_menu.id, jsonb_build_object(
    'id',       'MENU-' || v_menu.id,
    'type',     'Menu',
    'menuType', 'DELIVERY',
    'title',    jsonb_build_object('default', left(coalesce(v_menu.nombre, 'Menú'), 300)),
    'products', v_prods,
    'schedule', jsonb_build_object('HORARIO-' || v_menu.id,
                  jsonb_build_object('id', 'HORARIO-' || v_menu.id, 'type', 'ScheduleEntry'))
  ));

  -- ── Secciones con horario: un Menu + ScheduleEntry por sección ───────────
  v_items := v_items || coalesce((
    select jsonb_object_agg(k, v) from (
      select 'HORARIO-CAT-' || c.id as k, jsonb_build_object(
               'id',        'HORARIO-CAT-' || c.id,
               'type',      'ScheduleEntry',
               'startTime', to_char(h.hora_inicio, 'HH24:MI:SS'),
               'endTime',   to_char(h.hora_fin, 'HH24:MI:SS'),
               'weekDays',  to_jsonb(h.dias)) as v
        from public.peya_categoria_horario h
        join public.pos_menu_categorias c on c.id = h.categoria_id and c.menu_id = v_menu.id and c.activo
      union all
      select 'MENU-' || v_menu.id || '-CAT-' || c.id, jsonb_build_object(
               'id',       'MENU-' || v_menu.id || '-CAT-' || c.id,
               'type',     'Menu',
               'menuType', 'DELIVERY',
               'title',    jsonb_build_object('default', left(c.nombre, 300)),
               'products', (select jsonb_object_agg(i.id::text, jsonb_build_object(
                                     'id', i.id::text, 'type', 'Product',
                                     'order', coalesce(nullif(i.orden, 0), 65536)))
                              from public.pos_menu_items i
                             where i.categoria_id = c.id and i.menu_id = v_menu.id
                               and coalesce(i.precio, 0) > 0),
               'schedule', jsonb_build_object('HORARIO-CAT-' || c.id,
                             jsonb_build_object('id', 'HORARIO-CAT-' || c.id, 'type', 'ScheduleEntry')))
        from public.peya_categoria_horario h
        join public.pos_menu_categorias c on c.id = h.categoria_id and c.menu_id = v_menu.id and c.activo
       where exists (select 1 from public.pos_menu_items i
                      where i.categoria_id = c.id and i.menu_id = v_menu.id
                        and coalesce(i.precio, 0) > 0)
    ) s
  ), '{}'::jsonb);

  return jsonb_build_object('ok', true, 'menu_id', v_menu.id,
                            'catalog', jsonb_build_object('items', v_items));
end $function$;
