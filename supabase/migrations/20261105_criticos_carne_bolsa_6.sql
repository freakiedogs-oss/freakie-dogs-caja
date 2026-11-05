-- Conteo crítico: la carne (Carne P Burguer) se cuenta en BOLSAS DE 6 bolitas
-- en vez de paquetes de 20. La unidad de stock sigue siendo la bolita, así que
-- la venta, los pedidos del kardex y el costo no cambian: sólo cambia el empaque.
--
-- Las hojas ya guardadas tienen los paquetes de 20 y su `factor` = 20. Para que
-- se sigan leyendo igual con el nuevo empaque, se pasan a bolsas de 6 sin
-- cambiar ninguna cantidad en bolitas:
--   * CID y TPS Final: bolsas enteras = floor(paquetes*20/6); las bolitas que
--     sobran pasan a la casilla suelta (cid_sueltas / linea_sueltas).
--   * Se pidió y descargas AM/PM: sólo van en empaques → paquetes*20/6.
--   * factor del renglón → 6.
-- Solo se tocan renglones con factor = 20, así que correrla dos veces no hace nada.

update criticos_items
   set unidades_derivadas = '6 Bolitas',
       unidad_conteo      = 'Bolsa de 6 bolitas',
       presentacion       = 'Bolsa',
       factor             = 6,
       nota_config        = 'Desde el 5-nov-2026 se cuenta en bolsas de 6 bolitas (antes paquete de 20). Las hojas anteriores se convirtieron a bolsas de 6 conservando las bolitas.',
       updated_at         = now()
 where id = 'a7b1e9c6-6ce0-4a50-b764-718201fbca5b';

update criticos_conteo_items
   set cid_enteros    = case when cid_enteros is null then null else floor(cid_enteros * 20 / 6) end,
       cid_sueltas    = case when cid_enteros is null then cid_sueltas
                             else coalesce(cid_sueltas, 0) + (cid_enteros * 20 - floor(cid_enteros * 20 / 6) * 6) end,
       tps_enteros    = case when tps_enteros is null then null else floor(tps_enteros * 20 / 6) end,
       linea_sueltas  = case when tps_enteros is null then linea_sueltas
                             else coalesce(linea_sueltas, 0) + (tps_enteros * 20 - floor(tps_enteros * 20 / 6) * 6) end,
       pedido_enteros = round(pedido_enteros * 20 / 6, 4),
       descarga_am    = round(descarga_am * 20 / 6, 4),
       descarga_pm    = round(descarga_pm * 20 / 6, 4),
       factor         = 6,
       updated_at     = now()
 where item_id = 'a7b1e9c6-6ce0-4a50-b764-718201fbca5b'
   and factor = 20;
