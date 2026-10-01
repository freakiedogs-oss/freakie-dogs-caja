-- Aplicada el 01-oct-2026 vía apply_migration (peya_quitar_bebida_delivery2_masivo_01oct).
-- El grupo "Bebida Delivery 2" (obligatorio, 1-10) quedó pegado a 119 de 120 ítems
-- del menú PedidosYa por el botón "asignar a todos" de Admin Menú. El combo pedía
-- bebida en cada componente. La bebida del combo ya la cubre el grupo "Bebida"
-- del componente Bebida, igual que en Para Llevar. Respaldo antes de borrar.
create table if not exists _bk_peya_bebida_delivery2_01oct as
select im.menu_item_id, im.grupo_id
from pos_item_modificadores im
join pos_modificadores_grupo g on g.id = im.grupo_id
join pos_menu_items i on i.id = im.menu_item_id
join pos_menus m on m.id = i.menu_id
where g.nombre = 'Bebida Delivery 2' and m.canal = 'pedidos_ya';

delete from pos_item_modificadores im
using _bk_peya_bebida_delivery2_01oct b
where im.menu_item_id = b.menu_item_id and im.grupo_id = b.grupo_id;
