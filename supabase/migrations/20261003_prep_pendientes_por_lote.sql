-- Corrección: al pasar una deuda a un compañero, los productos del lote dejaban de verse (se filtraban por la
-- persona que imprimió). El lote del día es de una sola persona, así que los productos salen por lote.
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
         where e.lote_id = d.lote_id
         group by e.producto_id
      ) x), '[]'::jsonb)
  ) order by d.created_at), '[]'::jsonb)
  from public.prep_deudas d
  where d.usuario_id = p_usuario and d.estado = 'abierta'
$function$;

create or replace function public.fn_salida_pendientes(p_usuario uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'bloquear', coalesce((select (valor->>'bloquearSalida')::boolean from public.prep_config where clave = 'ajustes'), true),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'lote_id', d.lote_id, 'lote', d.lote, 'fecha', d.fecha,
      'productos', coalesce((select jsonb_agg(distinct e.producto) from public.etiqueta_impresiones e where e.lote_id = d.lote_id), '[]'::jsonb)
    ) order by d.created_at) from public.prep_deudas d where d.usuario_id = p_usuario and d.estado = 'abierta'), '[]'::jsonb)
  )
$function$;
