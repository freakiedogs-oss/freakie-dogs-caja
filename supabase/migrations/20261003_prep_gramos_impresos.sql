-- Guarda los gramos netos realmente pesados en cada impresión, para que la estación de insumos
-- compare lo registrado contra lo que de verdad se pesó.
alter table public.etiqueta_impresiones add column if not exists gramos numeric;

create or replace function public.fn_etiqueta_registrar_v2(p_usuario uuid, p_lote_id uuid, p_producto_id text, p_producto text, p_unidades int default 1, p_gramos numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_lote record; v_con boolean; v_deuda boolean := false;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  select * into v_lote from public.prep_lotes where id = p_lote_id;
  if not found then raise exception 'Ese lote no existe.'; end if;
  v_con := (v_lote.estado = 'cerrado');

  insert into public.etiqueta_impresiones(lote_id, lote, fecha, producto_id, producto, unidades, usuario_id, usuario_nombre, con_insumos, gramos)
  values (v_lote.id, v_lote.lote, v_lote.fecha, p_producto_id, p_producto, greatest(coalesce(p_unidades,1),1), p_usuario, n, v_con, p_gramos);

  if not v_con and not exists (select 1 from public.prep_deudas where lote_id = v_lote.id and usuario_id = p_usuario and estado = 'abierta') then
    insert into public.prep_deudas(lote_id, lote, fecha, usuario_id, usuario_nombre) values (v_lote.id, v_lote.lote, v_lote.fecha, p_usuario, n);
    v_deuda := true;
    insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('deuda_abierta', p_usuario, n, jsonb_build_object('lote', v_lote.lote, 'producto', p_producto));
  end if;
  return jsonb_build_object('con_insumos', v_con, 'deuda_nueva', v_deuda);
end $function$;

grant execute on function public.fn_etiqueta_registrar_v2(uuid, uuid, text, text, int, numeric) to anon, authenticated;

create or replace function public.fn_prep_pendientes_detalle(p_usuario uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'deuda_id', d.id, 'lote_id', d.lote_id, 'lote', d.lote, 'fecha', d.fecha,
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', x.producto_id, 'clave', x.clave, 'nombre', x.nombre, 'unidades', x.unidades,
                                          'gramos', x.gramos, 'gramos_objetivo', x.objetivo) order by x.nombre)
      from (
        select e.producto_id, max(p.clave) as clave, coalesce(max(p.nombre), max(e.producto)) as nombre, sum(e.unidades) as unidades,
               sum(e.gramos) as gramos, max(p.gramos) as objetivo
          from public.etiqueta_impresiones e
          left join public.etiquetado_productos p on p.id::text = e.producto_id
         where e.lote_id = d.lote_id
         group by e.producto_id
      ) x), '[]'::jsonb)
  ) order by d.created_at), '[]'::jsonb)
  from public.prep_deudas d
  where d.usuario_id = p_usuario and d.estado = 'abierta'
$function$;
