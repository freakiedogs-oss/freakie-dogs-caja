-- BPM chili · versión Mauricio: la fórmula del paso 7 se clona a la v2.
--
-- Los ítems de pesaje cuelgan del paso 7 por `paso_id`. Al clonar los 17
-- pasos para la v2 (bpm_version_mauricio_clonar_plantilla) el paso 7 nuevo
-- quedó sin ítems, y la tanda de prueba moría en el pesaje con «No cargó la
-- lista de ingredientes». Se copian los 25 activos de la piloto tal cual;
-- desde acá cada versión edita su propia fórmula en Parámetros BPM.
insert into bpm_pesaje_items (paso_id, orden, grupo, ingrediente, producto_id, gramos_objetivo, tolerancia_pct, tolerancia_g,
                              unidad, requiere_lote, referencia, activo, fuente, requiere_foto, requiere_proveedor, requiere_vencimiento)
select v2.id, i.orden, i.grupo, i.ingrediente, i.producto_id, i.gramos_objetivo, i.tolerancia_pct, i.tolerancia_g,
       i.unidad, i.requiere_lote, i.referencia, i.activo, i.fuente, i.requiere_foto, i.requiere_proveedor, i.requiere_vencimiento
from bpm_pesaje_items i
join bpm_pasos v1 on v1.id = i.paso_id and v1.plantilla_id = '489906c3-48b4-43d1-b9bb-e38bd2835a83' and v1.clave = 'pesaje_ingredientes'
join bpm_pasos v2 on v2.plantilla_id = '161b7148-2b29-47d5-8e67-bcba906a0590' and v2.clave = 'pesaje_ingredientes'
where i.activo
  and not exists (select 1 from bpm_pesaje_items x where x.paso_id = v2.id and x.ingrediente = i.ingrediente);
