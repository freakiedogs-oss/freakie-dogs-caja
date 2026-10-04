-- Aplicada vía MCP el 4-oct-2026. Ver memoria.md (Extras pagados en delivery que no llegaban al KDS).
-- 19 combos del menú de delivery tenían el mismo grupo colgado del combo y de un componente.
-- Se borra la copia del combo (respaldada en _respaldo_item_mods_20261004).
create table if not exists _respaldo_item_mods_20261004 (
  menu_item_id uuid, grupo_id uuid, combo text, grupo text,
  respaldado_at timestamptz default now()
);
with m as (
  select id from pos_menus where canal='delivery_propio' and activo order by created_at limit 1
), dup as (
  select im.menu_item_id, im.grupo_id, mi.nombre combo, g.nombre grupo
  from pos_item_modificadores im
  join pos_menu_items mi on mi.id = im.menu_item_id and mi.menu_id = (select id from m)
  join pos_modificadores_grupo g on g.id = im.grupo_id
  where exists (
    select 1 from pos_combo_componentes cc
    join pos_item_modificadores cim on cim.menu_item_id = cc.componente_item_id
    where cc.combo_item_id = im.menu_item_id and cim.grupo_id = im.grupo_id)
)
insert into _respaldo_item_mods_20261004 (menu_item_id, grupo_id, combo, grupo)
select menu_item_id, grupo_id, combo, grupo from dup;
delete from pos_item_modificadores im
using _respaldo_item_mods_20261004 r
where im.menu_item_id = r.menu_item_id and im.grupo_id = r.grupo_id;
