-- Hamburguesa en lechuga (1-oct-2026, Frank): cambiar el pan por lechuga en
-- cualquier hamburguesa, en todos los canales, una por una.
-- · Grupo nuevo «Pan» (opcional, una opción) con «EN LECHUGA (sin pan)».
-- · Se cuelga de cada componente «Hamburguesa» de los combos (una fila por
--   hamburguesa: en un Duo sale dos veces y se elige por separado) y de las
--   hamburguesas que se venden sin componentes (Burger La Clasica, cumpleaños,
--   Hamburguesa sola). No se toca ningún grupo, receta ni precio existente.
-- · Insumos de la opción: −1 Pan de Hamburguesa Brioche 2.8oz y +0.11 lb
--   de Lechuga libra escarolada. El −1 se compensa contra el pan que trae la
--   receta del combo en la misma cuenta (pos_deducir_inventario suma por cuenta).
-- · En cocina se ve en el KDS como «Pan: EN LECHUGA (sin pan)» en la fila de esa
--   hamburguesa.
do $$
declare v_g uuid; v_m uuid;
begin
  select id into v_g from public.pos_modificadores_grupo where nombre = 'Pan' and tipo = 'unico';
  if v_g is null then
    insert into public.pos_modificadores_grupo (nombre, tipo, obligatorio, min_selecciones, max_selecciones, orden, activo)
    values ('Pan', 'unico', false, 0, 1, 1, true) returning id into v_g;
  end if;

  select id into v_m from public.pos_modificadores where grupo_id = v_g and nombre = 'EN LECHUGA (sin pan)';
  if v_m is null then
    insert into public.pos_modificadores (grupo_id, nombre, nombre_corto, precio_extra, orden, activo)
    values (v_g, 'EN LECHUGA (sin pan)', 'LECHUGA', 0, 0, true) returning id into v_m;
    insert into public.pos_modificador_insumos (modificador_id, tipo, producto_id, cantidad, unidad_medida, notas) values
      (v_m, 'producto', '4eea6d84-ffff-4ad1-a0be-6ad2771a943d', -1, 'unidad', 'Hamburguesa en lechuga: no lleva pan'),
      (v_m, 'producto', '47636c35-5cb0-4e59-9ea0-8fb0f0ae0dd1', 0.11, 'lb', 'Hamburguesa en lechuga: hojas en lugar del pan');
  end if;

  -- Componentes «Hamburguesa»/«Freakie Burger» de combos cuya receta trae pan de
  -- hamburguesa, y hamburguesas sueltas (con pan en su receta y sin componentes).
  with recursive bun_rec as (
    select ri.receta_id, 1 d from public.receta_ingredientes ri where ri.producto_id = '4eea6d84-ffff-4ad1-a0be-6ad2771a943d'
    union
    select ri.receta_id, b.d + 1 from bun_rec b join public.receta_ingredientes ri on ri.sub_receta_id = b.receta_id where b.d < 5),
  con_pan as (
    select mi.id from public.pos_menu_items mi
      join public.recetas r on r.catalogo_id = mi.producto_id and coalesce(r.activo, true)
     where r.id in (select receta_id from bun_rec)),
  destino as (
    select cc.componente_item_id id
      from public.pos_combo_componentes cc join public.pos_menu_items c on c.id = cc.componente_item_id
     where cc.combo_item_id in (select id from con_pan)
       and (c.nombre ilike '%hamburguesa%' or c.nombre ilike '%burger%')
    union
    select cp.id from con_pan cp
     where not exists (select 1 from public.pos_combo_componentes cc where cc.combo_item_id = cp.id))
  insert into public.pos_item_modificadores (menu_item_id, grupo_id)
  select d.id, v_g from destino d
   where not exists (select 1 from public.pos_item_modificadores x where x.menu_item_id = d.id and x.grupo_id = v_g);
end $$;
