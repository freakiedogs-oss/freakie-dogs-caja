-- Apartado «Equipo y PINs» para el jefe de Casa Matriz (Kevin): ve quién de su equipo de producción
-- tiene PIN y, con su propio PIN, consulta el de una persona para dárselo. Cada consulta queda en la bitácora.
-- Solo ve a su equipo (misma sucursal, roles produccion y despachador): nunca los PIN de otros encargados.
-- La lista NO trae PIN; el PIN de una persona sale solo por fn_equipo_pin_ver, de a uno.

create or replace function public.fn_equipo_lista(p_pin_encargado text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb; v_store text;
begin
  a := public.fn_prep_actor(p_pin_encargado, true);
  if a is null then raise exception 'Ese PIN no es de un encargado.'; end if;
  v_store := coalesce(nullif(a->>'store_code',''), 'CM001');
  return jsonb_build_object(
    'store', v_store,
    'equipo', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', trim(concat_ws(' ', u.nombre, u.apellido)), 'rol', u.rol,
                                          'tiene_pin', coalesce(btrim(u.pin), '') <> '') order by u.nombre)
        from public.usuarios_erp u
       where u.activo and u.store_code = v_store and u.rol in ('produccion','despachador')), '[]'::jsonb));
end $function$;

create or replace function public.fn_equipo_pin_ver(p_pin_encargado text, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a jsonb; v_store text; t record;
begin
  a := public.fn_prep_actor(p_pin_encargado, true);
  if a is null then raise exception 'Ese PIN no es de un encargado.'; end if;
  v_store := coalesce(nullif(a->>'store_code',''), 'CM001');
  select u.id, trim(concat_ws(' ', u.nombre, u.apellido)) as nombre, u.pin into t
    from public.usuarios_erp u
   where u.id = p_usuario and u.activo and u.store_code = v_store and u.rol in ('produccion','despachador');
  if not found then raise exception 'Esa persona no es de tu equipo.'; end if;
  if coalesce(btrim(t.pin), '') = '' then raise exception 'Esa persona todavía no tiene PIN asignado.'; end if;
  insert into public.prep_bitacora(accion, actor_id, actor, detalle)
  values ('pin_consultado', (a->>'id')::uuid, a->>'nombre', jsonb_build_object('persona', t.nombre));
  return jsonb_build_object('nombre', t.nombre, 'pin', t.pin);
end $function$;

grant execute on function public.fn_equipo_lista(text) to anon, authenticated;
grant execute on function public.fn_equipo_pin_ver(text, uuid) to anon, authenticated;
