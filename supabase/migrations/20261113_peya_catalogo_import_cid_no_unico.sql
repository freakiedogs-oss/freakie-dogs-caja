-- PeYa: menú unificado — varias filas (una por tienda) comparten catalog_import_id.
--
-- 13-nov-2026. En la primera carga unificada (2 tiendas de prueba) la segunda
-- fila de `peya_catalogo_import` quedó en «enviando» sin catalog_import_id:
-- `peya_catalogo_import_enviado` chocaba con el índice ÚNICO y el responder no
-- revisaba el error. Del lado de DH las dos tiendas quedaron `done`.
-- Ahora el índice es normal y `peya_catalogo_import_estado` ya actualiza todas
-- las filas del mismo import (migración 20261113_peya_catalogo_import_varias_tiendas).
drop index if exists public.peya_catalogo_import_cid_uidx;
create index if not exists peya_catalogo_import_cid_idx on public.peya_catalogo_import (catalog_import_id);
