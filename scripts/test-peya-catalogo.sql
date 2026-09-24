-- Pruebas del Bloque 3 de homologación PedidosYa (catálogo).
--
-- Cómo correrlo:
--     select public.peya_test_catalogo();
--   → { "verde": 23, "de": 23, "todo_ok": true, "fallos": [], "items": 259 }
--
-- Y el Bloque 1/2 va aparte:
--     select public.peya_test_homologacion();
--
-- La función vive en la base (migración `peya_test_catalogo_fix`) y no en este
-- archivo a propósito: corre contra el menú REAL de PedidosYa
-- (`pos_menus.canal = 'pedidos_ya'`), así que tiene que poder ejecutarse en
-- cualquier momento desde el dashboard, no sólo cuando alguien clona el repo.
--
-- ┌─ QUÉ VIGILA, Y POR QUÉ ESO ─────────────────────────────────────────────┐
-- │ Delivery Hero valida el catálogo ENTERO y lo rechaza completo. No dice  │
-- │ qué ítem estaba mal. Con ~260 ítems, encontrarlo a mano es una tarde.   │
-- │ Los chequeos están ordenados por lo que cuesta cada falla:              │
-- │                                                                         │
-- │  5. referencias colgadas  → bota el import completo. El más caro.       │
-- │  6. type que no coincide con el ítem real                               │
-- │  9. Topping sin quantity.maximum → es `required` en el schema           │
-- │ 12. producto vendible a $0.00 → un cliente pide "Hamburguesa" gratis    │
-- │ 13. la categoría "Componentes" (andamiaje interno) no debe viajar       │
-- │ 16. el precio del extra va en la REFERENCIA, no en el Product suelto    │
-- │ 18. una opción de modificador no puede venderse sola en el menú         │
-- │ 22-23. el registro de imports valida su enum y no inventa filas         │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- MUTACIÓN COMPROBADA (23-sep-2026): se quitó el filtro `precio > 0` del
-- serializador en una copia y el chequeo 12 encontró los 13 productos de $0.00;
-- y con un catálogo roto a mano (PROD-A → TOP-FANTASMA) el chequeo 5 lo marcó.
-- Los tests fallan cuando deben fallar, no sólo pasan cuando todo está bien.

select public.peya_test_catalogo() as bloque_3_catalogo;

-- Detalle del catálogo que se mandaría ahora mismo, para mirarlo a ojo:
select
  v->>'type'                            as tipo,
  count(*)                              as cuantos,
  count(*) filter (where (v->>'active')::boolean) as activos
from jsonb_each(public.peya_catalogo()->'catalog'->'items') as e(k, v)
group by 1
order by 1;

-- Historial de imports (estado real, el que llega por callback):
select * from public.peya_catalogo_imports();
