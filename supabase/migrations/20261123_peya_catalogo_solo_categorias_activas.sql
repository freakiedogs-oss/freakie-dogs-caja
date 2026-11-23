-- PeYa: el catálogo sólo manda productos de categorías activas.
--
-- 23-nov-2026, pase a producción de la tienda piloto (SV-FREAKIE-DOGS-0001).
-- Al igualar el menú de PedidosYa al de Metro Centro se desactivaron las
-- categorías viejas y sus productos quedaron ocultos. DataFridge rechazó el
-- import completo (91 errores «Product or one or more of its variants does not
-- belong to a category»): un producto que no cuelga de ninguna categoría no
-- puede viajar, aunque vaya con active=false. Ese import falló entero y quedó
-- vigente el anterior.
--
-- Un producto de una categoría inactiva no se vende en ningún lado, así que
-- simplemente no se manda. Los productos sin categoría (categoria_id null)
-- tampoco: tendrían el mismo error.

create or replace function public.peya_items_catalogo(p_menu_id uuid, p_pruebas boolean default false)
returns table(id uuid, menu_id uuid, categoria_id uuid, nombre text, descripcion text, precio numeric, imagen_url text, disponible boolean, orden integer)
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
    join public.pos_menu_categorias c on c.id = i.categoria_id and c.menu_id = i.menu_id and c.activo
    left join public.peya_item_prueba o on o.item_id = i.id
   where i.menu_id = p_menu_id
     and coalesce(i.precio, 0) > 0
     and not (p_pruebas and coalesce(o.excluido, false));
$function$;
