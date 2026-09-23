-- 23-sep-2026, decisiones de Frank.
-- 1. "Combo Super Freak" repetido en el menú Delivery: se unifica en el original
--    (421c4de2, el que tiene slug y sale en el menú público). Las 10 ventas del
--    repetido pasan al original (mismo producto, mismo precio) y el repetido se
--    borra; sus filas de pos_combo_componentes caen por cascade.
-- 2. Burger Box y Pilsener Burger Box: los jalapeños van en un depósito de 2 oz
--    con tapa. Casa Matriz los guarda por caja de 1,000 (depósitos y tapaderas),
--    así que cada combo descuenta 1/1000 de caja de cada uno.

update public.pos_cuenta_items
   set menu_item_id = '421c4de2-faae-4101-b4e7-19fa2e9d4cfa'
 where menu_item_id = 'b0f2f876-5ee4-4eec-ab18-e5c684af41ef';

delete from public.pos_menu_items
 where id = 'b0f2f876-5ee4-4eec-ab18-e5c684af41ef'
   and not exists (select 1 from public.pos_cuenta_items where menu_item_id = 'b0f2f876-5ee4-4eec-ab18-e5c684af41ef')
   and not exists (select 1 from public.peya_producto_map where menu_item_id = 'b0f2f876-5ee4-4eec-ab18-e5c684af41ef');

insert into public.receta_ingredientes
  (receta_id, tipo_ingrediente, producto_id, cantidad, unidad_medida, factor_a_stock, merma_pct, removible, notas)
select r.receta_id, 'materia_prima', p.producto_id, 1, 'unidad', 0.001, 0, false, p.nota
  from (values ('2474264e-569a-4f63-9b44-441218dbc420'::uuid),    -- Burger Box
               ('1a7a0d29-575b-4114-aa7e-f37853884f46'::uuid))    -- Pilsener Burger Box
         r(receta_id)
 cross join (values ('68d94b59-99ef-4dc9-aeea-d6563a473b6a'::uuid, 'Depósito de 2 oz para los jalapeños (caja de 1,000).'),
                    ('e62658b4-4ea5-4fe9-b3da-59f236ecf33f'::uuid, 'Tapadera de 2 oz para los jalapeños (caja de 1,000).'))
         p(producto_id, nota)
 where not exists (select 1 from public.receta_ingredientes x
                    where x.receta_id = r.receta_id and x.producto_id = p.producto_id);
