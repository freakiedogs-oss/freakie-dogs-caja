-- 25-sep-2026 (OK Frank, YA APLICADA) · PARCHE TEMPORAL: el grupo «Bebida» de los combos era
-- obligatorio y abría vacío, y la cajera no podía agregar el Coca-Cola Combo XL sin tocarlo.
-- Queda opcional hasta que se despliegue el POS con la Coca-Cola 300ml marcada por defecto.
update pos_modificadores_grupo set obligatorio=false, min_selecciones=0
 where id='d8f75292-f61c-4b73-9c69-53edb99ded8c' and nombre='Bebida';
