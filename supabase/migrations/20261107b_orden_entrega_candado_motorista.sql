-- ════════════════════════════════════════════════════════════════════
-- Orden de entrega · candado para el motorista (7-nov-2026)
-- Va APARTE de 20261107_orden_entrega_automatico.sql y se aplica DESPUÉS de
-- que la app nueva del motorista esté en producción: con la app vieja el
-- motorista no ve el orden y le saldría el error sin saber por qué.
-- ════════════════════════════════════════════════════════════════════

-- ── Motorista: no se puede entregar fuera de orden ───────────────────
create or replace function public.driver_marcar_entregado(p_empleado_id uuid, p_delivery_id uuid, p_metodo_cobrado text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.delivery_clientes%rowtype;
  v_dist numeric := 0; v_hora int; v_fuera boolean;
  v_viaje uuid; v_tarifa numeric; v_nombre text;
  v_antes record;
begin
  select * into v_row from public.delivery_clientes where id = p_delivery_id for update;
  if not found then raise exception 'pedido no existe'; end if;
  if v_row.motorista_id is distinct from p_empleado_id then
    raise exception 'ese pedido no está asignado a vos';
  end if;
  if v_row.viaje_id is not null then
    return jsonb_build_object('ok', true, 'ya_entregado', true, 'viaje_id', v_row.viaje_id);
  end if;

  -- Orden de entrega: primero el que va antes (7-nov-2026)
  if v_row.orden_entrega is not null then
    select numero_orden, orden_entrega into v_antes
      from public.delivery_clientes
     where motorista_id = p_empleado_id and estado = 'en_camino' and id <> v_row.id
       and orden_entrega is not null and orden_entrega < v_row.orden_entrega
     order by orden_entrega limit 1;
    if found then
      raise exception 'Primero tenés que entregar el %° (%). Si no podés, avisale a la central.',
        v_antes.orden_entrega, v_antes.numero_orden;
    end if;
  end if;

  select round((6371 * 2 * asin(sqrt(
      power(sin(radians(v_row.cliente_lat - s.lat)/2),2) +
      cos(radians(s.lat)) * cos(radians(v_row.cliente_lat)) *
      power(sin(radians(v_row.cliente_lng - s.lng)/2),2))))::numeric, 2)
    into v_dist
  from public.sucursales s
  where s.id = v_row.sucursal_id and v_row.cliente_lat is not null;
  v_dist := coalesce(v_dist, 0);

  v_hora := extract(hour from (now() - interval '6 hours'));
  v_fuera := v_hora >= 21 or v_hora < 6;

  insert into public.viajes_delivery(fecha, empleado_id, sucursal_id, orden_id, tipo,
                                     distancia_km, es_fuera_de_horario, hora_regreso)
  values ((now() - interval '6 hours')::date, p_empleado_id, v_row.sucursal_id, v_row.id,
          'entrega', v_dist, v_fuera, (now() - interval '6 hours')::time)
  returning id into v_viaje;

  update public.delivery_clientes
     set estado = 'entregada', entregado_at = now(), viaje_id = v_viaje,
         distancia_km = v_dist, metodo_pago = coalesce(p_metodo_cobrado, metodo_pago)
   where id = p_delivery_id;

  select nombre_completo into v_nombre from public.empleados where id = p_empleado_id;
  if v_row.pos_cuenta_id is not null then
    update public.pos_cuentas
       set notas_internas = concat_ws(' | ', nullif(notas_internas,''),
             'Entregado por '||coalesce(v_nombre,'motorista')||' · cobró '||coalesce(p_metodo_cobrado, v_row.metodo_pago, 'n/d'))
     where id = v_row.pos_cuenta_id;
  end if;

  v_tarifa := public._tarifa_viaje('entrega', v_dist, v_fuera);
  return jsonb_build_object('ok', true, 'viaje_id', v_viaje,
    'distancia_km', v_dist, 'bono', v_tarifa, 'fuera_horario', v_fuera);
end;
$function$;

