-- "Agrandado de Papa" $1.00 en el grupo "Salsas Papas" (Cesar, 24-sep-2026).
--
-- En los combos SIN bebida (restaurante por la regla del 1-sep, Royal Truffle)
-- y en las papas sueltas, la única opción era "Agrandado Papa y Bebida $1.25":
-- se cobraba una bebida agrandada que no existía. Esta opción es solo la papa
-- extra. El POS decide cuál mostrar: con bebida en el combo, la de $1.25; sin
-- bebida, esta. Descuenta lo mismo que la de $1.25: 1 porción de Papa Sazonada.
insert into pos_modificadores (grupo_id, nombre, nombre_corto, precio_extra, orden, activo)
select g.id, 'Agrandado de Papa', 'Agr. Papa', 1.00,
       coalesce((select max(orden) from pos_modificadores where grupo_id = g.id), 0) + 1, true
from pos_modificadores_grupo g
where g.nombre = 'Salsas Papas'
  and not exists (select 1 from pos_modificadores m where m.grupo_id = g.id and m.nombre = 'Agrandado de Papa');

insert into pos_modificador_insumos (modificador_id, tipo, producto_id, receta_id, cantidad, unidad_medida, notas, canales)
select m.id, 'producto', i.producto_id, null, 1, 'porcion', 'Igual que Agrandado Papa y Bebida: 1 porción de papa extra', null
from pos_modificadores m
join pos_modificadores_grupo g on g.id = m.grupo_id and g.nombre = 'Salsas Papas'
join pos_modificadores m125 on m125.grupo_id = g.id and m125.nombre = 'Agrandado Papa y Bebida'
join pos_modificador_insumos i on i.modificador_id = m125.id and i.tipo = 'producto'
where m.nombre = 'Agrandado de Papa'
  and not exists (select 1 from pos_modificador_insumos x where x.modificador_id = m.id);
