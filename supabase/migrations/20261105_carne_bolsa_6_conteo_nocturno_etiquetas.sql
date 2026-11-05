-- La carne de hamburguesa pasa a bolsas de 6 bolitas también en el conteo
-- nocturno y en las etiquetas de Casa Matriz.
--
-- Conteo nocturno: `catalogo_productos.conteo_factor` es cuántas bolitas trae
-- una bolsa cerrada (estaba en 15). El inventario y el kardex viven en bolitas,
-- así que los conteos guardados no se convierten: sólo cambia cómo se agrupa
-- lo que se ve en la mano. Este mismo factor lo usan despacho, transferencias
-- y confirmar entrega para mostrar empaques.
--
-- Etiquetas: el peso neto se escala del de 20 bolitas (1361 g = 68.05 g por
-- bolita) a 6 bolitas = 408 g; la banda de aceptación se escala igual
-- (34 g → 10 g). La tara se deja en 12 g hasta que Kevin pese la bolsa nueva.

update catalogo_productos
   set conteo_unidad = 'Bolsa de 6 bolitas',
       conteo_factor = 6
 where id = '79513e24-a4fd-4a7c-b117-87c9c899be1e';

update etiquetado_productos
   set unidad = 'bolsa 6 bolitas',
       gramos = 408,
       banda  = 10,
       updated_at = now()
 where clave = 'carne';
