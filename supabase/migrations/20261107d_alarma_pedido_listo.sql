-- ════════════════════════════════════════════════════════════════════
-- Alarma «pedido listo» para el motorista (7-nov-2026, pedido de Cesar)
--
-- La app (servicio nativo de Android, cada 20 s, y la pantalla web mientras
-- está abierta) pregunta driver_alarma_estado(). Suena cuando TODOS los
-- pedidos que el motorista tiene asignados en esa sucursal están listos, para
-- que no le suene con uno y se quede esperando el otro. Excepción: si el
-- primero lleva 8 min o más listo, suena igual para que no se enfríe.
-- «Ya los retiré» = driver_recoger_listos(): marca en camino todos sus
-- pedidos listos (el orden de entrega se arma solo con el trigger de ruta).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.driver_alarma_estado(p_empleado_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with mios as (
    select d.id, d.numero_orden, d.estado, d.sucursal_id, s.nombre sucursal,
           (select max(l.cambiado_at) from delivery_estado_log l
             where l.delivery_id = d.id and l.estado_nuevo = 'lista') lista_at
      from delivery_clientes d
      left join sucursales s on s.id = d.sucursal_id
     where d.motorista_id = p_empleado_id and d.tipo = 'delivery'
       and d.estado in ('preparando', 'lista')),
  grupo as (
    -- La sucursal con el pedido listo más antiguo
    select sucursal_id from mios where estado = 'lista' order by lista_at nulls last limit 1),
  g as (select m.* from mios m join grupo using (sucursal_id))
  select case when not exists (select 1 from g where estado = 'lista')
    then jsonb_build_object('sonar', false)
    else jsonb_build_object(
      'sonar', bool_and(g.estado = 'lista')
               or min(g.lista_at) filter (where g.estado = 'lista') <= now() - interval '8 minutes',
      'sucursal', min(g.sucursal),
      'listos', count(*) filter (where g.estado = 'lista'),
      'total', count(*),
      'min_espera', coalesce(round(extract(epoch from now() - min(g.lista_at) filter (where g.estado = 'lista')) / 60), 0),
      'pedidos', jsonb_agg(jsonb_build_object('id', g.id, 'numero_orden', g.numero_orden, 'estado', g.estado)
                           order by g.numero_orden))
  end
  from g;
$function$;
grant execute on function public.driver_alarma_estado(uuid) to anon, authenticated;

create or replace function public.driver_recoger_listos(p_empleado_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare r record; n int := 0;
begin
  for r in select id from delivery_clientes
            where motorista_id = p_empleado_id and estado = 'lista' and tipo = 'delivery'
            order by created_at loop
    perform driver_marcar_recogido(p_empleado_id, r.id);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'recogidos', n);
end;
$function$;
grant execute on function public.driver_recoger_listos(uuid) to anon, authenticated;
