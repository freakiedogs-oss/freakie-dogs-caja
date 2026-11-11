-- 18-oct-2026 · Proveedores duplicados por cómo viene escrito el nombre (pedido de Cesar).
--
-- Caso: «BELCA EL SALVADOR, S.A. de CV.» (id 3, costo_comida) y las facturas nuevas que vienen como
-- «BELCA EL SALVADOR, S.A. DE C.V.». normalizar_proveedor busca el nombre EXACTO; como no lo encontró,
-- creó un proveedor nuevo (id 266) con la categoría que eligieron en el modal (insumo_venta) y la
-- vista prefiere el match exacto → $12.4k de papas de octubre salieron del food cost.
--
-- Arreglo:
--  1. _prov_clave(nombre): clave sin tildes, puntuación ni sufijos societarios (S.A. DE C.V., SOCIEDAD
--     ANONIMA DE CAPITAL VARIABLE, LTDA, S.A.S., EL/LA…). «BELCA EL SALVADOR, S.A. de CV.» = «BELCASALVADOR».
--  2. normalizar_proveedor: si ya hay un proveedor con la misma clave, NO crea otro ni le cambia la
--     categoría; devuelve el existente (ya_existia = true) para que la pantalla lo diga.
--  3. v_gastos_consolidados: además del nombre exacto y del «contiene nombre normalizado», también
--     empareja por clave. Prioridad: exacto > clave > contiene.
--  4. Duplicados con la MISMA categoría se marcan duplicado_de del original (Belca, Corte Argentino,
--     Banco Agrícola, Plásticos Diversos). Los que tienen categorías distintas quedan para que Cesar decida.

create or replace function public._prov_clave(p text)
 returns text language sql immutable parallel safe as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(translate(upper(coalesce(p,'')), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÃÕÑ', 'AEIOUAEIOUAEIOUAEIOUAON'),
                            '[^A-Z0-9 ]', ' ', 'g'),
             '\m(S|A|DE|C|V|SA|CV|SAS|LTDA|SOCIEDAD|ANONIMA|CAPITAL|VARIABLE|ACCIONES|SIMPLIFICADA|POR|EL|LA|Y)\M', '', 'g'),
           '\s+', '', 'g');
$$;
grant execute on function public._prov_clave(text) to anon, authenticated;

create or replace function public.normalizar_proveedor(p_nombre_dte text, p_nombre_normalizado text, p_categoria text, p_subcategoria text, p_requiere_recepcion boolean, p_usuario text default null)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_id int; v_ex record;
begin
  if coalesce(btrim(p_nombre_dte),'') = '' then raise exception 'nombre_dte requerido'; end if;
  select id into v_id from public.catalogo_contable
   where lower(btrim(nombre_dte)) = lower(btrim(p_nombre_dte)) limit 1;

  if v_id is null then
    -- Mismo proveedor escrito distinto: no se duplica ni se le cambia la categoría.
    select id, nombre_dte, categoria, subcategoria into v_ex
      from public.catalogo_contable
     where activo and duplicado_de is null
       and public._prov_clave(nombre_dte) = public._prov_clave(p_nombre_dte)
       and length(public._prov_clave(p_nombre_dte)) >= 4
     order by id limit 1;
    if found then
      return jsonb_build_object('ok', true, 'id', v_ex.id, 'ya_existia', true,
        'nombre_existente', v_ex.nombre_dte, 'categoria', v_ex.categoria, 'subcategoria', v_ex.subcategoria);
    end if;
  end if;

  if v_id is not null then
    update public.catalogo_contable set
      nombre_normalizado = coalesce(nullif(btrim(p_nombre_normalizado),''), nombre_normalizado, btrim(p_nombre_dte)),
      categoria = coalesce(nullif(btrim(p_categoria),''), categoria),
      subcategoria = coalesce(nullif(btrim(p_subcategoria),''), subcategoria),
      requiere_recepcion = coalesce(p_requiere_recepcion, requiere_recepcion),
      activo = true, updated_at = now()
    where id = v_id;
  else
    insert into public.catalogo_contable(nombre_dte, nombre_normalizado, categoria, subcategoria, requiere_recepcion, activo, created_at, updated_at)
    values (btrim(p_nombre_dte),
            coalesce(nullif(btrim(p_nombre_normalizado),''), btrim(p_nombre_dte)),
            coalesce(nullif(btrim(p_categoria),''), 'gastos_operativos'),
            coalesce(nullif(btrim(p_subcategoria),''), 'Varios'),
            coalesce(p_requiere_recepcion, false), true, now(), now())
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'ya_existia', false);
end;
$function$;

-- Vista: emparejar también por clave (parche sobre la definición vigente).
do $$
declare v text; a text; b text;
begin
  v := pg_get_viewdef('public.v_gastos_consolidados'::regclass);
  a := '((upper(cd.proveedor_nombre) = upper(cc_1.nombre_dte)) OR (upper(cd.proveedor_nombre) ~~';
  b := '((upper(cd.proveedor_nombre) = upper(cc_1.nombre_dte)) OR (public._prov_clave(cd.proveedor_nombre) = public._prov_clave(cc_1.nombre_dte)) OR (upper(cd.proveedor_nombre) ~~';
  if position(a in v) = 0 then raise exception 'No encontré el match de proveedor en v_gastos_consolidados'; end if;
  v := replace(v, a, b);
  a := 'ORDER BY (upper(cd.proveedor_nombre) = upper(cc_1.nombre_dte)) DESC, (length(cc_1.nombre_normalizado)) DESC';
  b := 'ORDER BY (upper(cd.proveedor_nombre) = upper(cc_1.nombre_dte)) DESC, (public._prov_clave(cd.proveedor_nombre) = public._prov_clave(cc_1.nombre_dte)) DESC, (length(cc_1.nombre_normalizado)) DESC, cc_1.id';
  if position(a in v) = 0 then raise exception 'No encontré el ORDER BY del match en v_gastos_consolidados'; end if;
  v := replace(v, a, b);
  execute 'create or replace view public.v_gastos_consolidados as ' || v;
end $$;

-- Duplicados con la misma categoría → apuntan al original.
update public.catalogo_contable set duplicado_de = 3,   updated_at = now() where id = 266 and duplicado_de is null; -- Belca
update public.catalogo_contable set duplicado_de = 1,   updated_at = now() where id = 213 and duplicado_de is null; -- Corte Argentino
update public.catalogo_contable set duplicado_de = 197, updated_at = now() where id = 200 and duplicado_de is null; -- Banco Agrícola
update public.catalogo_contable set duplicado_de = 134, updated_at = now() where id = 167 and duplicado_de is null; -- Plásticos Diversos
