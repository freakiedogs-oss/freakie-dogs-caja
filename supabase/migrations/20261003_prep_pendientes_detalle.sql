-- Qué imprimió una persona y todavía no tiene insumos registrados, por lote y por producto.
-- La estación de insumos solo deja registrar lo que aparece aquí (salvo encargados).
create or replace function public.fn_prep_pendientes_detalle(p_usuario uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'deuda_id', d.id, 'lote_id', d.lote_id, 'lote', d.lote, 'fecha', d.fecha,
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', x.producto_id, 'clave', x.clave, 'nombre', x.nombre, 'unidades', x.unidades) order by x.nombre)
      from (
        select e.producto_id, max(p.clave) as clave, coalesce(max(p.nombre), max(e.producto)) as nombre, sum(e.unidades) as unidades
          from public.etiqueta_impresiones e
          left join public.etiquetado_productos p on p.id::text = e.producto_id
         where e.lote_id = d.lote_id and e.usuario_id = d.usuario_id
         group by e.producto_id
      ) x), '[]'::jsonb)
  ) order by d.created_at), '[]'::jsonb)
  from public.prep_deudas d
  where d.usuario_id = p_usuario and d.estado = 'abierta'
$function$;

grant execute on function public.fn_prep_pendientes_detalle(uuid) to anon, authenticated;
