-- Correcciones de recetas y combos (23-sep-2026), revisadas con Frank.
-- Sale de la revisión "Combos por partes": errores que descargaban el
-- producto equivocado o que cocina no veía. Solo datos; no toca funciones.
--
-- 1. Papa waffle: las recetas descargaban "Papa Waffle 27LB" y "PAPA WAFFLE NAT
--    CAJA" (inactivo), que nadie recibe ni cuenta. Pasan a "Papa Waffle", que es
--    la que se recibe y entra al conteo nocturno.
-- 2. Aros dentro de combos (Chili Duo, Combros, Freakie Box): la sub-receta
--    "Aros de Cebolla" tiene catalogo_id, así que la explosión se detenía y
--    descargaba "Aros de Cebolla porción" (no se cuenta). Se abre en sus
--    ingredientes: 6 aros + 2 oz de ranch por porción.
-- 3. Combos Pilsener: su receta era "1× <combo base>" y se descargaba el combo
--    como artículo de bodega. Se reemplaza por los ingredientes del combo base.
-- 4. Pilsener Royal: la cerveza de la receta sobra (sus 2 bebidas salen de los
--    grupos Bebida Royal 1 y 2); con ella se descontaban 3 bebidas.
-- 5. Nota del Coca-Cola Combo XL: los jalapeños van en uno de los dos hot dogs.
-- 6. Configuración de combos:
--    a. Duplicado "Combo Super Freak" de Delivery (creado 27-ago): su parte
--       Super Freak era el plato completo (descargaba doble). Pasa al componente.
--    b. Combo Chilli Dog de Delivery: faltaba la parte Hot Dog.
--    c. Chili Duo: parte Aros de Cebolla (lleva aros, confirmado por Frank).
--    d. Sweet Burger Duo: parte Postre (cheesecake).
--    e. Partes nuevas para recipientes aparte: "Jalapeños 2 oz" (Burger Box y
--       Pilsener Burger Box) y "Cheddar 8 oz" (Combpleto).
-- Pendiente (no va acá): el depósito de 2 oz del Burger Box, hasta confirmar
-- cuántos trae la caja; y los insumos de las mejoras (Papas Trufa, Fancy Fries,
-- Aros, Peperoncini, Clásica).

-- ── 1. Waffle ─────────────────────────────────────────────────────────────
update public.receta_ingredientes ri
   set producto_id = 'c3a0697a-5b97-4d00-9173-fd43c7e204bc'   -- Papa Waffle (se recibe y se cuenta)
  from public.recetas r
 where r.id = ri.receta_id and coalesce(r.activo, true)
   and ri.producto_id in ('45c837d5-e6ba-4eaf-843e-0ac4d9c1b013',   -- Papa Waffle 27LB
                          '9f50cf16-3fe3-415d-8d53-61a5a1f4fa2b');  -- PAPA WAFFLE NAT CAJA (inactivo)

-- ── 2. Aros abiertos dentro de los combos ────────────────────────────────
insert into public.receta_ingredientes
  (receta_id, tipo_ingrediente, producto_id, sub_receta_id, cantidad, unidad_medida,
   factor_a_stock, merma_pct, removible, etiqueta, notas)
select ri.receta_id, a.tipo_ingrediente, a.producto_id, a.sub_receta_id,
       ri.cantidad * a.cantidad / coalesce(nullif(s.rendimiento, 0), 1),
       a.unidad_medida, a.factor_a_stock, a.merma_pct, false, null,
       'Aros de cebolla del combo (antes descargaba la porción): ' || coalesce(a.notas, '')
  from public.receta_ingredientes ri
  join public.recetas r on r.id = ri.receta_id and coalesce(r.activo, true)
  join public.recetas s on s.id = ri.sub_receta_id
  join public.receta_ingredientes a on a.receta_id = s.id
 where ri.tipo_ingrediente = 'sub_receta'
   and ri.sub_receta_id = 'e8a0efd5-0c54-49ee-8100-0d12cc737b57';   -- Aros de Cebolla

delete from public.receta_ingredientes ri
 using public.recetas r
 where r.id = ri.receta_id and coalesce(r.activo, true)
   and ri.tipo_ingrediente = 'sub_receta'
   and ri.sub_receta_id = 'e8a0efd5-0c54-49ee-8100-0d12cc737b57';

-- ── 3. Pilsener: ingredientes reales del combo base ──────────────────────
-- (va después de 1 y 2 para copiar el waffle ya corregido)
insert into public.receta_ingredientes
  (receta_id, tipo_ingrediente, producto_id, sub_receta_id, cantidad, unidad_medida,
   factor_a_stock, merma_pct, removible, etiqueta, notas)
select ri.receta_id, b.tipo_ingrediente, b.producto_id, b.sub_receta_id,
       ri.cantidad * b.cantidad / coalesce(nullif(s.rendimiento, 0), 1),
       b.unidad_medida, b.factor_a_stock, b.merma_pct, b.removible, b.etiqueta,
       'Del combo base ' || s.nombre || coalesce(' · ' || nullif(b.notas, ''), '')
  from public.receta_ingredientes ri
  join public.recetas s on s.id = ri.sub_receta_id
  join public.receta_ingredientes b on b.receta_id = s.id
 where ri.tipo_ingrediente = 'sub_receta'
   and ri.receta_id in ('1a7a0d29-575b-4114-aa7e-f37853884f46',   -- Pilsener Burger Box
                        '8d38bc0f-e753-473f-a7fb-94591faf32b1',   -- Pilsener Freakie Burger
                        '22dffae7-82d7-4d73-a4f6-58a6abaf6710',   -- Pilsener Freakie Combo
                        '426931ca-53bc-467d-98c7-c29930f35dce')   -- Pilsener Royal Truffle Combo
   and ri.sub_receta_id in ('2474264e-569a-4f63-9b44-441218dbc420',   -- Burger Box
                            '906f8d63-a330-4b56-bdbc-542a682208c0',   -- Freakie Burger
                            'a568d385-be0c-4bd2-a278-4d902022354c',   -- Coca-Cola Combo
                            '0fda7056-d8d9-4d87-85e8-bd2546211d8e');  -- Royal Truffle Combo

delete from public.receta_ingredientes ri
 where ri.tipo_ingrediente = 'sub_receta'
   and ri.receta_id in ('1a7a0d29-575b-4114-aa7e-f37853884f46', '8d38bc0f-e753-473f-a7fb-94591faf32b1',
                        '22dffae7-82d7-4d73-a4f6-58a6abaf6710', '426931ca-53bc-467d-98c7-c29930f35dce')
   and ri.sub_receta_id in ('2474264e-569a-4f63-9b44-441218dbc420', '906f8d63-a330-4b56-bdbc-542a682208c0',
                            'a568d385-be0c-4bd2-a278-4d902022354c', '0fda7056-d8d9-4d87-85e8-bd2546211d8e');

-- ── 4. Pilsener Royal: sin cerveza fija ──────────────────────────────────
delete from public.receta_ingredientes
 where receta_id = '426931ca-53bc-467d-98c7-c29930f35dce'
   and producto_id = 'd1e36449-5d6a-42de-9b81-04246eeb378e';        -- Cerveza Pilsener VR 330ml

-- ── 5. Nota del XL ───────────────────────────────────────────────────────
update public.receta_ingredientes
   set notas = 'Una orden de jalapeños (2 oz), va en uno de los dos hot dogs.'
 where id = 'ccec083a-a405-437a-96c4-835bb3813585';

-- ── 6a. Super Freak duplicado de Delivery ────────────────────────────────
update public.pos_combo_componentes
   set componente_item_id = 'b7e39842-c703-498a-b7b2-45724f8d719e', orden = 1   -- componente Super Freak
 where id = 'a2521052-bba2-440b-8e61-4f678cbb086f'
   and componente_item_id = 'ed15b32a-342e-400c-91f9-dddde3197775';             -- el plato completo
update public.pos_combo_componentes set orden = 3 where id = '7f3539d7-f948-4a32-b229-6b0977ff28bb';  -- Bebida

-- ── 6b. Combo Chilli Dog de Delivery: parte Hot Dog ─────────────────────
insert into public.pos_combo_componentes (combo_item_id, componente_item_id, cantidad, orden)
select '8f3e2d13-537a-4728-8029-82000c1e145b', '39acd735-9869-40b4-b56b-57fde457ba1f', 1, 1
 where not exists (select 1 from public.pos_combo_componentes
                    where combo_item_id = '8f3e2d13-537a-4728-8029-82000c1e145b'
                      and componente_item_id = '39acd735-9869-40b4-b56b-57fde457ba1f');

-- Componente de cada menú por nombre (los componentes son casillas por menú).
create temporary table _comp_por_menu on commit drop as
select distinct on (c.menu_id, c.nombre) c.menu_id, c.nombre, c.id, c.categoria_id
  from public.pos_menu_items c
 where c.id in (select componente_item_id from public.pos_combo_componentes)
 order by c.menu_id, c.nombre, c.created_at;

-- ── 6e. Partes nuevas: Jalapeños 2 oz y Cheddar 8 oz (una por menú) ──────
insert into public.pos_menu_items
  (menu_id, categoria_id, producto_id, nombre, precio, disponible, orden,
   requiere_preparacion, estacion, visible_publico)
select p.menu_id, p.categoria_id, null, n.nombre, 0, false, n.orden, true, 'general', false
  from _comp_por_menu p
  cross join (values ('Jalapeños 2 oz', 11), ('Cheddar 8 oz', 12)) n(nombre, orden)
 where p.nombre = 'Postre'
   and not exists (select 1 from public.pos_menu_items x
                    where x.menu_id = p.menu_id and x.nombre = n.nombre);

insert into _comp_por_menu
select x.menu_id, x.nombre, x.id, x.categoria_id
  from public.pos_menu_items x
 where x.nombre in ('Jalapeños 2 oz', 'Cheddar 8 oz')
   and not exists (select 1 from _comp_por_menu c where c.menu_id = x.menu_id and c.nombre = x.nombre);

-- ── 6c/6d/6e. Agregar la parte a cada combo, en todos sus menús ──────────
insert into public.pos_combo_componentes (combo_item_id, componente_item_id, cantidad, orden)
select mi.id, p.id, 1,
       (select coalesce(max(cc.orden), 0) + 1 from public.pos_combo_componentes cc where cc.combo_item_id = mi.id)
  from public.pos_menu_items mi
  join public.catalogo_productos cp on cp.id = mi.producto_id
  join (values ('Chili Duo',           'Aros de Cebolla'),
               ('Sweet Burger Duo',    'Postre'),
               ('Burger Box',          'Jalapeños 2 oz'),
               ('Pilsener Burger Box', 'Jalapeños 2 oz'),
               ('Combpleto',           'Cheddar 8 oz')) v(combo, parte) on v.combo = cp.nombre
  join _comp_por_menu p on p.menu_id = mi.menu_id and p.nombre = v.parte
 where exists (select 1 from public.pos_combo_componentes cc where cc.combo_item_id = mi.id)
   and not exists (select 1 from public.pos_combo_componentes cc
                    where cc.combo_item_id = mi.id and cc.componente_item_id = p.id);
