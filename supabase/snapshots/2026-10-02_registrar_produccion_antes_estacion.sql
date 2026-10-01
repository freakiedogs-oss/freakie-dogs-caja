-- Snapshot de la definición VIVA de registrar_produccion al 02-oct-2026, tomada con
-- pg_get_functiondef ANTES del refactor de la estación de etiquetado (M2). Se guarda
-- para poder comparar o volver atrás; no se aplica.
CREATE OR REPLACE FUNCTION public.registrar_produccion(p_receta_id uuid, p_cantidad numeric, p_turno text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_responsable_id uuid DEFAULT NULL::uuid, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_fecha date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cm uuid := '584aee3c-a842-496f-9f2b-1e3bac6e6b23';
  v_fecha date := coalesce(p_fecha, (now() - interval '6 hours')::date);
  v_seq int; v_lote text; v_prod uuid; ing record;
  v_need numeric; v_costo_unit numeric; v_costo_total numeric;
  v_consumidos int := 0;
  v_cat uuid; v_rend numeric; v_producido numeric;
  v_alta boolean := false; v_aviso text := null; v_sub_cat uuid;
  v_sub_sin_rastro int := 0;
begin
  if p_receta_id is null or coalesce(p_cantidad,0) <= 0 then
    raise exception 'receta y cantidad (>0) son obligatorias'; end if;

  select count(*)+1 into v_seq from public.produccion_diaria where fecha = v_fecha;
  v_lote := 'LOT-' || to_char(v_fecha,'YYYYMMDD') || '-' || lpad(v_seq::text,3,'0');
  v_costo_total := round(p_cantidad * public.receta_costo_total(p_receta_id), 2);

  insert into public.produccion_diaria(fecha, receta_id, cantidad_producida, cantidad_enviada,
      turno, lote, responsable_id, created_by, created_by_id, notas, costo_total)
  values (v_fecha, p_receta_id, p_cantidad, 0, p_turno, v_lote, p_responsable_id,
      p_usuario_nombre, p_usuario_id, p_notas, v_costo_total)
  returning id into v_prod;

  for ing in
    select ri.*, cp.unidad_medida cp_unidad
    from public.receta_ingredientes ri
    left join public.catalogo_productos cp on cp.id = ri.producto_id
    where ri.receta_id = p_receta_id
  loop
    v_need := round(p_cantidad * coalesce(ing.cantidad,0) * coalesce(ing.factor_a_stock,1) * (1 + coalesce(ing.merma_pct,0)/100.0), 4);
    if v_need = 0 then continue; end if;

    if ing.tipo_ingrediente = 'materia_prima' and ing.producto_id is not null then
      v_costo_unit := public.costo_producto(ing.producto_id);
      perform public.kardex_mover(ing.producto_id, v_cm, 'consumo', -v_need,
        'produccion', v_prod, 'Producción '||v_lote, p_usuario_id, true);
      insert into public.produccion_diaria_items(produccion_id, producto_id, cantidad_consumida,
          unidad_medida, costo_unitario, es_subproducto)
      values (v_prod, ing.producto_id, v_need, coalesce(ing.unidad_medida, ing.cp_unidad,'unidad'),
          v_costo_unit, false);
      v_consumidos := v_consumidos + 1;
    elsif ing.tipo_ingrediente = 'sub_receta' and ing.sub_receta_id is not null then
      select sr.catalogo_id into v_sub_cat from public.recetas sr where sr.id = ing.sub_receta_id;
      if v_sub_cat is not null then
        v_costo_unit := public.costo_producto(v_sub_cat);
        perform public.kardex_mover(v_sub_cat, v_cm, 'consumo', -v_need,
          'produccion', v_prod, 'Producción '||v_lote||' (sub-receta)', p_usuario_id, true);
        insert into public.produccion_diaria_items(produccion_id, producto_id, cantidad_consumida,
            unidad_medida, costo_unitario, es_subproducto)
        values (v_prod, v_sub_cat, v_need, coalesce(ing.unidad_medida,'unidad'), v_costo_unit, true);
        v_consumidos := v_consumidos + 1;
      else
        v_sub_sin_rastro := v_sub_sin_rastro + 1;
      end if;
    end if;
  end loop;

  select r.catalogo_id, r.rendimiento into v_cat, v_rend
    from public.recetas r where r.id = p_receta_id;
  v_producido := round(p_cantidad * coalesce(nullif(v_rend,0), 1), 4);
  if v_cat is not null then
    perform public.kardex_mover(v_cat, v_cm, 'produccion', v_producido,
      'produccion', v_prod, 'Producción '||v_lote, p_usuario_id, true);
    v_alta := true;
  else
    v_aviso := 'La receta no tiene producto de catálogo asignado: se consumieron '
            || 'los insumos pero NO se dio de alta el producto terminado. '
            || 'Asigná el producto en la receta y registrá el alta a mano.';
  end if;

  if v_sub_sin_rastro > 0 then
    v_aviso := coalesce(v_aviso || ' · ', '') || v_sub_sin_rastro ||
      ' sub-receta(s) sin producto de catálogo: su consumo NO se descontó del ' ||
      'inventario ni quedó registrado. Asignales un producto para poder medirlo.';
  end if;

  return jsonb_build_object('ok', true, 'produccion_id', v_prod, 'lote', v_lote,
    'costo_total', v_costo_total, 'insumos_consumidos', v_consumidos,
    'producto_dado_de_alta', v_alta, 'unidades_producidas', v_producido,
    'aviso', v_aviso);
end;
$function$;
