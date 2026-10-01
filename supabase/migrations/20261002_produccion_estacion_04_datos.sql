-- ═══════════════════════════════════════════════════════════════════════
-- Estación de pesaje y etiquetado → kardex · M4: datos
-- docs/PLAN-ESTACION-ETIQUETADO-ERP.md §7 (decisiones de Jose, 01/02-oct) y §8
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Empaques: se descuentan por unidades producidas, no por peso ──
-- Las tres bolsas de vacío que ya aparecen en recetas (Chili 12x14, Cebolla
-- Morada 1 lb / Escabeche / Mermelada 8x12, Salchicha 10x12).
update public.receta_ingredientes
   set es_empaque = true
 where tipo_ingrediente = 'materia_prima'
   and producto_id in (
     '0d732100-9c0e-421c-a779-c7ee2c84f312',   -- AB-BVNT-M621214070 Bolsa de Vacío 12x14x70
     '1e990560-2d38-4fa0-b262-982a4eb2d602',   -- AB-BVNT-M620812070 Bolsa de Vacío 8x12x70
     'd521021d-ec68-46a1-b1cf-3a064630b2da');  -- AB-BVNT-M621012070 Bolsa de Vacío 10x12x70

-- ── 2. Cebolla Morada: una sola receta, la de bolsa 1 lb (decisión 4) ──
-- Jose confirmó 66 lb crudas → 30 bolsas y que el vinagre es 0.5 L (la
-- línea decía 0.005). La receta vieja (rinde "1 tanda", SP-004) solo la
-- consume Sweat Freak, que está inactiva: se desactiva.
update public.receta_ingredientes
   set cantidad = 0.5
 where id = '59eab096-d1ce-44b0-a7db-e05e55bfb697'   -- Vinagre en Galon, receta 7cb31083
   and cantidad = 0.005;
update public.recetas set activo = false, updated_at = now()
 where id = 'ead99615-761f-4d30-934e-f3b233aeb674' and nombre = 'Cebolla Morada';

-- ── 3. Ranch ya no se porciona: se manda el bote completo (Jose, 02-oct) ──
update public.recetas set activo = false, updated_at = now()
 where id = 'a140b670-618f-46ab-8254-2eb8fdc00a35' and nombre = 'Ranch Porcionado';

-- ── 4. Parámetros de etiquetado (reemplaza src/etiquetado/productos.js) ──
-- peso_nominal_g NULL = todavía no se pesó una tanda completa: la estación
-- solo deja producirlo en modo prueba hasta que se cargue (Producción →
-- Etiquetado). Los días son los provisionales de la estación; Mauricio los
-- pasa a 'validado' al cerrar el RVP-13.
insert into public.produccion_etiquetado_productos
  (producto_id, receta_id, nombre_etiqueta, requiere_peso, peso_nominal_g, banda_g, vida_util_dias, conservacion, orden, activo)
values
  ('648e4f72-c088-44dd-8984-fe3f307b9bfa', '5f12329e-39a5-4aa3-a59c-113df8820ec0', 'Cheddar Porcionado',        true,  907,  50, 30,  'Mantener refrigerado', 1, true),
  ('18aa0ec1-5ee5-4af9-a429-ef30e8fcc582', 'f9e150d6-f0e4-4728-a303-a38891a12555', 'Chili con carne',           true,  2268, 50, 90,  'Mantener congelado',   2, true),
  ('1f863333-2676-4aa2-a1c1-b569dfb03ee8', '7cb31083-ec3e-43a0-bc9f-757c3d19602b', 'Cebolla Morada encurtida',  true,  454,  30, 30,  'Mantener refrigerado', 3, true),
  ('f41aa115-4217-47ef-9565-407cbb641958', '16efeb6c-da3a-4907-b119-62e720eff83a', 'Sal de hamburguesa',        true,  907,  40, 180, 'Lugar seco',           4, true),
  ('f971739b-df59-4c18-a9ad-97bb40d28b69', '2dc5b021-5715-4bbf-ad83-38c0d6537036', 'Escabeche',                 true,  null, null, 30, 'Mantener refrigerado', 5, true),
  ('374cd9a1-325d-44f6-a2df-8e4874c3c0c8', '9d90ccfe-eb97-4956-b262-235680a32e18', 'Salsa Mil Islas',           true,  null, null, 15, 'Mantener refrigerado', 6, true),
  ('c3e6a382-6d74-4502-9fda-2845058a4f7a', 'a49aaa40-38b5-4e77-8a23-6b9ce57a04ee', 'Salsa Chipotle',            true,  null, null, 15, 'Mantener refrigerado', 7, true),
  -- Truffa y Mermelada quedan INACTIVOS hasta corregir sus recetas (ver §5):
  -- con el rendimiento actual (0.2125 bolsa / 4 "tanda") el cierre descontaría
  -- insumos disparatados o daría de alta la unidad equivocada.
  ('0207f18f-b3d6-42c2-97f6-d43e6b0cd978', 'f30c5efb-a459-4834-bedc-ebf5f913a07e', 'Salsa Truffa',              true,  454,  30, 15,  'Mantener refrigerado', 8, false),
  ('6399f9e9-1f0e-4215-a7dc-08fcfc9464fd', '93347334-ef6f-45a3-adb4-0e34eb12ea4b', 'Mermelada de Tocino',       true,  2268, 60, 21,  'Mantener refrigerado', 9, false),
  ('a4a7b644-64af-4d3b-964d-0a1b5259e2e5', '6fe5b6de-83c6-4b49-85a1-dd9a251143f3', 'Salchicha reempacada 25 un', false, null, null, 20, 'Mantener refrigerado', 10, true),
  ('39946903-2b85-46cb-afd1-518df61f847b', 'cd67cde8-101f-487b-915c-c0fd96306aa0', 'Cebolla Blanca',            true,  907,  50, 7,   'Mantener refrigerado', 11, true)
on conflict (producto_id) do nothing;

-- ── 5. PENDIENTE (se aplica cuando Cesar pese; NO ejecutar todavía) ──
-- Mermelada de Tocino → rendir bolsas (decisión 4). Jose asume bolsa de 5 lb,
-- a confirmar. Hoy el catálogo tiene dos productos: "Mermelada de Tocino"
-- (SP-015, unidad "tanda", lo que produce CM) y "Mermelada bolsa" (CC007, lo
-- que cuentan las sucursales), unidos por inventario_equivalencias ×2.1797
-- (que asume bolsas de 2 lb, no de 5). Cuando se tenga el peso real de la
-- tanda y de la bolsa:
--   update recetas set catalogo_id = 'd4627645-fa6e-48a6-b7de-865d34f280c4', -- Mermelada bolsa
--          rendimiento = <bolsas por tanda>, unidad_rendimiento = 'bolsa' where id = '93347334-…';
--   update catalogo_productos set tipo = 'sub_producto' where id = 'd4627645-…';
--   update inventario_equivalencias set activo = false where producto_origen = '6399f9e9-…';
--   -- y las 5 consumidoras (Mini Fancy, Fancys XL, Fancy Fries Combo, Combo Fancy Duo,
--   -- Extra Mermelada) pasan de sub_receta 4 oz × 0.014337 a factor = 1 / (oz por bolsa).
--   update produccion_etiquetado_productos set producto_id = 'd4627645-…', activo = true where receta_id = '93347334-…';
--
-- Salsa Truffa → bolsas de 1 lb (Jose, 02-oct). Rendimiento 0.2125 no es de
-- producción; mayo (1 "bote") y Dijon (3 "cucharadas") sin factor_a_stock
-- contra stock en oz. Cuando se pese una preparación:
--   update recetas set rendimiento = <bolsas de 1 lb>, unidad_rendimiento = 'bolsa' where id = 'f30c5efb-…';
--   update receta_ingredientes set factor_a_stock = <oz por bote> where id = '76663818-55b4-4dcd-bb35-8ecfeb2e15e4';
--   update receta_ingredientes set factor_a_stock = 0.5 where id = 'f37a0682-0dda-47ab-a057-116814b75750'; -- 1 cucharada ≈ 0.5 oz
--   -- consumidoras (Extra Salsa de Trufa, Papa Trufa, Royal Truffle ×2) hoy asumen bolsa de 32 oz
--   -- (factor 0.03125 / 0.0625 bolsa): con bolsa de 16 oz pasan a 0.0625 / 0.125.
--   update produccion_etiquetado_productos set activo = true where producto_id = '0207f18f-…';
