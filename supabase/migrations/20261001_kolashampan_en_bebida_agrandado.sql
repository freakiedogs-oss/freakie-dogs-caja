-- Aplicada el 01-oct-2026 vía apply_migration (kolashampan_en_bebida_agrandado_01oct).
-- Pedido Jose (vía Jazz): al marcar el agrandado, el cliente que quiere conservar
-- su Kolashampan y solo agrandar las papas tiene que poder elegirla. La opción ya
-- existía en "Bebida Agrandado" (apagada desde el 31-ago, $0, descuenta 1
-- Kolashampan del kardex). Solo se enciende. Aplica a todas las sucursales: los
-- menús no son por sucursal.
update pos_modificadores mo
   set activo = true
  from pos_modificadores_grupo g
 where g.id = mo.grupo_id
   and g.nombre = 'Bebida Agrandado'
   and mo.nombre = 'Kolashampan';
