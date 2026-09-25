-- 25-sep-2026 · CORRER DESPUÉS DE DESPLEGAR este PR (con OK de Frank).
-- 1) Revierte el parche temporal: con la Coca-Cola 300ml marcada por defecto el grupo
--    «Bebida» vuelve a ser obligatorio (así la PET siempre se descuenta).
update pos_modificadores_grupo set obligatorio=true, min_selecciones=1
 where id='d8f75292-f61c-4b73-9c69-53edb99ded8c' and nombre='Bebida';
-- 2) Freakie Fries $1.99 de food court (menús Local y Para Llevar): se les asigna el grupo de
--    sabores «Bebida Agrandado». Con eso el POS muestra «Agrandado Papa y Bebida» ($1.25) y, al
--    marcarlo, pide el sabor de la bebida, que es lo que se descuenta.
insert into pos_item_modificadores (menu_item_id, grupo_id)
select x, 'ffaafa80-a170-48c6-8597-689cf38f2431'::uuid
  from unnest(array['5013a8cd-a395-45ed-b49f-ac768303f2c7','f72fba99-44ae-4a71-9f94-5610ed0a7b0b']::uuid[]) x
 where not exists (select 1 from pos_item_modificadores im where im.menu_item_id = x and im.grupo_id = 'ffaafa80-a170-48c6-8597-689cf38f2431');
