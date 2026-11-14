-- PeYa: pendientes de homologación de catálogo (correo de Marcos Mendez, 13-nov).
--
-- 1) HORARIO POR SECCIÓN, como lo pide PedidosYa: el ScheduleEntry va suelto
--    en `items` y se REFERENCIA dentro de `products` de la Category; el Menu
--    lista Categories (no productos). La versión anterior mandaba la sección
--    como un Menu aparte: DH lo aceptaba pero la app no respetaba el horario.
--
-- 2) CAMBIOS DE PRUEBA SIN TOCAR EL MENÚ REAL. PedidosYa pide editar varios
--    ítems («prueba» en nombre/descripción + precio), borrar ítems y cambiar
--    el precio del combo con promoción. Hacerlo sobre `pos_menu_items` pisaría
--    el menú que usa la caja, y una copia del menú cambiaría los IDs (y la
--    promoción que cargaron queda colgada del ID viejo). Entonces:
--      · `peya_item_prueba` guarda overrides (nombre, descripción, precio,
--        foto) y exclusiones («borrado») por ítem.
--      · `peya_catalogo(p_menu_id, p_pruebas)` los aplica SÓLO con
--        p_pruebas = true; el responder lo pasa cuando todas las tiendas del
--        envío son de prueba. Una tienda real nunca los ve.
--      · `peya_categoria_horario.solo_pruebas` hace lo mismo con el horario.

create table if not exists public.peya_item_prueba (
  item_id        uuid primary key references public.pos_menu_items(id) on delete cascade,
  nombre         text,
  descripcion    text,
  precio         numeric(10,2) check (precio is null or precio > 0),
  imagen_url     text,
  excluido       boolean not null default false,
  nota           text,
  actualizado_at timestamptz not null default now()
);
alter table public.peya_item_prueba enable row level security;

alter table public.peya_categoria_horario
  add column if not exists solo_pruebas boolean not null default false;

-- Ítems del menú tal como salen al catálogo (con o sin overrides de prueba).
create or replace function public.peya_items_catalogo(p_menu_id uuid, p_pruebas boolean default false)
returns table(id uuid, menu_id uuid, categoria_id uuid, nombre text, descripcion text,
              precio numeric, imagen_url text, disponible boolean, orden integer)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select i.id, i.menu_id, i.categoria_id,
         case when p_pruebas then coalesce(o.nombre, i.nombre) else i.nombre end,
         case when p_pruebas then coalesce(o.descripcion, i.descripcion) else i.descripcion end,
         case when p_pruebas then coalesce(o.precio, i.precio) else i.precio end,
         case when p_pruebas then coalesce(o.imagen_url, i.imagen_url) else i.imagen_url end,
         i.disponible, i.orden
    from public.pos_menu_items i
    left join public.peya_item_prueba o on o.item_id = i.id
   where i.menu_id = p_menu_id
     and coalesce(i.precio, 0) > 0
     and not (p_pruebas and coalesce(o.excluido, false));
$function$;

drop function if exists public.peya_catalogo(uuid);

create or replace function public.peya_catalogo(p_menu_id uuid default null, p_pruebas boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_menu     record;
  v_items    jsonb := '{}'::jsonb;
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
  -- `precio > 0` (dentro de peya_items_catalogo): lo que vale 0 es andamiaje
  -- interno de combos (categoría "Componentes"), no se vende suelto.
  select coalesce(jsonb_object_agg(i.id::text, jsonb_strip_nulls(jsonb_build_object(
      'id',    i.id::text,
      'type',  'Product',
      'title', jsonb_build_object('default', left(i.nombre, 300)),
      'description', case when nullif(btrim(i.descripcion), '') is null then null
                          else jsonb_build_object('default', left(i.descripcion, 300)) end,
      'price', to_char(i.precio, 'FM9999990.00'),
      -- Desactivar NO es borrar: el ítem sigue en el catálogo y vuelve solo.
      'active', coalesce(i.disponible, false),
      'images', case when nullif(btrim(i.imagen_url), '') is not null then
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
    ))), '{}'::jsonb)
  into v_items
  from public.peya_items_catalogo(v_menu.id, p_pruebas) i;

  -- ── Imágenes (sólo la foto propia del ítem) ──────────────────────────────
  v_items := v_items || coalesce((
    select jsonb_object_agg('IMG-' || i.id, jsonb_build_object(
      'id',   'IMG-' || i.id,
      'type', 'Image',
      'url',  btrim(i.imagen_url),
      'alt',  jsonb_build_object('default', left(i.nombre, 300))))
    from public.peya_items_catalogo(v_menu.id, p_pruebas) i
    where nullif(btrim(i.imagen_url), '') is not null
  ), '{}'::jsonb);

  -- ── Grupos de modificadores (Topping) ────────────────────────────────────
  -- Grupos colgados de un ítem que sale al catálogo y los de los componentes
  -- de un combo que sale. `TOP-<id>` y, si un combo lo repite, `TOP-<id>-2`…
  v_items := v_items || coalesce((
    with vend as (select i.id from public.peya_items_catalogo(v_menu.id, p_pruebas) i),
    slots as (select s.* from public.peya_combo_slots(v_menu.id) s
               where s.combo_item_id in (select id from vend)),
    grupos as (
      select g.*
        from public.pos_modificadores_grupo g
       where g.activo and (
         exists (select 1 from public.pos_item_modificadores im
                  where im.grupo_id = g.id and im.menu_item_id in (select id from vend))
         or exists (select 1 from slots s where s.grupo_id = g.id))
    ),
    base as (
      select g.id, g.nombre, jsonb_build_object(
        'type',  'Topping',
        'order', coalesce(nullif(g.orden, 0), 65536),
        'quantity', jsonb_build_object(
          'minimum', coalesce(g.min_selecciones, case when g.obligatorio then 1 else 0 end),
          -- `maximum` es obligatorio: sin declararlo, cuántas opciones tiene.
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
        join (select distinct grupo_id, slot from slots where slot > 1) s on s.grupo_id = b.id
    )
    select jsonb_object_agg(v.tid, v.cuerpo || jsonb_build_object(
             'id', v.tid, 'title', jsonb_build_object('default', left(v.titulo, 300))))
      from variantes v
  ), '{}'::jsonb);

  -- ── Cada opción es TAMBIÉN un producto del catálogo ──────────────────────
  v_opciones := coalesce((
    with vend as (select i.id from public.peya_items_catalogo(v_menu.id, p_pruebas) i)
    select jsonb_object_agg(m.id::text, jsonb_build_object(
      'id',    m.id::text,
      'type',  'Product',
      'title', jsonb_build_object('default', left(m.nombre, 300)),
      'active', true))
    from public.pos_modificadores m
    join public.pos_modificadores_grupo g on g.id = m.grupo_id and g.activo
    where m.activo and (
      exists (select 1 from public.pos_item_modificadores im
               where im.grupo_id = g.id and im.menu_item_id in (select id from vend))
      or exists (select 1 from public.peya_combo_slots(v_menu.id) s
                  where s.grupo_id = g.id and s.combo_item_id in (select id from vend)))
  ), '{}'::jsonb);
  v_items := v_items || v_opciones;

  -- ── Horarios de sección ──────────────────────────────────────────────────
  -- Sueltos en `items`; la Category los referencia dentro de `products`.
  v_items := v_items || coalesce((
    select jsonb_object_agg('HORARIO-CAT-' || h.categoria_id, jsonb_build_object(
      'id',        'HORARIO-CAT-' || h.categoria_id,
      'type',      'ScheduleEntry',
      'startTime', to_char(h.hora_inicio, 'HH24:MI:SS'),
      'endTime',   to_char(h.hora_fin, 'HH24:MI:SS'),
      'weekDays',  to_jsonb(h.dias)))
    from public.peya_categoria_horario h
    join public.pos_menu_categorias c on c.id = h.categoria_id and c.menu_id = v_menu.id and c.activo
    where p_pruebas or not h.solo_pruebas
  ), '{}'::jsonb);

  -- ── Categorías ───────────────────────────────────────────────────────────
  -- Una categoría sin productos exportables (p.ej. "Componentes") no se manda.
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
        from public.peya_items_catalogo(v_menu.id, p_pruebas) i
        where i.categoria_id = c.id
      ) || coalesce((
        select jsonb_build_object('HORARIO-CAT-' || h.categoria_id, jsonb_build_object(
          'id', 'HORARIO-CAT-' || h.categoria_id, 'type', 'ScheduleEntry'))
        from public.peya_categoria_horario h
        where h.categoria_id = c.id and (p_pruebas or not h.solo_pruebas)
      ), '{}'::jsonb)
    ))
    from public.pos_menu_categorias c
    where c.menu_id = v_menu.id and c.activo
      and exists (select 1 from public.peya_items_catalogo(v_menu.id, p_pruebas) i
                  where i.categoria_id = c.id)
  ), '{}'::jsonb);

  -- ── Categoría OCULTA con las opciones de modificador ─────────────────────
  -- DH rechaza el catálogo si un Product no cuelga de una Category, y las
  -- opciones de Topping son Products. Ésta NO va en el Menu: el cliente no la ve.
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
  -- Todo el día; la hora real de atención la manda la tienda.
  v_items := v_items || jsonb_build_object('HORARIO-' || v_menu.id, jsonb_build_object(
    'id',        'HORARIO-' || v_menu.id,
    'type',      'ScheduleEntry',
    'startTime', '00:00:00',
    'endTime',   '23:59:59',
    'weekDays',  jsonb_build_array('MONDAY','TUESDAY','WEDNESDAY','THURSDAY',
                                   'FRIDAY','SATURDAY','SUNDAY')
  ));

  -- ── El menú: referencia las CATEGORÍAS visibles (como el ejemplo de PeYa) ─
  v_items := v_items || jsonb_build_object('MENU-' || v_menu.id, jsonb_build_object(
    'id',       'MENU-' || v_menu.id,
    'type',     'Menu',
    'menuType', 'DELIVERY',
    'title',    jsonb_build_object('default', left(coalesce(v_menu.nombre, 'Menú'), 300)),
    'products', coalesce((
      select jsonb_object_agg(e.key, jsonb_build_object(
               'id', e.key, 'type', 'Category', 'order', (e.value->>'order')::int))
        from jsonb_each(v_items) e
       where e.value->>'type' = 'Category' and e.key <> 'CAT-EXTRAS-' || v_menu.id
    ), '{}'::jsonb),
    'schedule', jsonb_build_object('HORARIO-' || v_menu.id,
                  jsonb_build_object('id', 'HORARIO-' || v_menu.id, 'type', 'ScheduleEntry'))
  ));

  return jsonb_build_object('ok', true, 'menu_id', v_menu.id, 'pruebas', p_pruebas,
                            'catalog', jsonb_build_object('items', v_items));
end $function$;
