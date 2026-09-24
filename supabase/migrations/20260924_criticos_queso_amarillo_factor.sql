-- Conteo de Críticos — Queso Amarillo (orden 8)
--
-- El descuadre recurrente de este ítem NO era consumo de más: la venta del kardex
-- es exactamente burgers * 0.0667 lb (receta viva "Hamburguesa Sencilla (armada)" =
-- 2 lascas, "Extra Carne y Queso" = 1 lasca). Las recetas con 0.33 / 0.5 lb de queso
-- amarillo suelto son duplicados sin catalogo_id y el POS no las ejecuta.
--
-- El sesgo venía de la conversión: 0.0667 / 0.0333 = 2.003 lascas en vez de 2 (+0.15%),
-- que a ~166 burgers ya vale media lasca — justo el piso de redondeo del semáforo.
-- Se usa el valor físico: 3 lb por paquete / 90 lascas = 0.033333 lb por lasca.
--
-- Los conteos ya guardados no cambian: criticos_conteo_items guarda factor y
-- factor_suelta como snapshot al momento de guardar.

update criticos_items set
  factor_suelta = 0.033333,
  nota_config = 'Corregido 24-sep-2026. Las recetas VIVAS están bien: "Hamburguesa Sencilla (armada)" lleva 0.0667 lb (2 lascas) y "Extra Carne y Queso" 0.0334 lb (1 lasca). Las recetas con 0.33 lb y 0.5 lb son duplicados viejos SIN producto ligado (catalogo_id nulo) — el POS no las usa. La descarga del kardex es exactamente burgers x 0.0667 lb, o sea el descuadre no es consumo de más: es redondeo de conversión. 0.0667 / 0.0333 = 2.003 lascas en vez de 2 (+0.15%), y ese sesgo crece con el volumen (a ~166 burgers ya vale media lasca). Fix definitivo: subir decimales en la receta (0.066667 y 0.033333) y poner factor_suelta = 1/30 = 0.033333; ahí se le quita el tolerancia_pct = 5 y vuelve a exigirse exacto.',
  updated_at = now()
where orden = 8;
