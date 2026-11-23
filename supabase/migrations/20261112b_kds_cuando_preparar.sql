-- Aplicada como migración kds_cuando_preparar (12-nov-2026)
-- KDS delivery: cuándo empezar a preparar cada pedido para que salga recién
-- hecho cuando llega el motorista (12-nov-2026, Cesar).
-- Capas: GPS fresco (<2 min) → eventos de la app (ETA de ruta / Recogí /
-- Entregado) → sin dato = asume motorista en tienda (sale «Preparar ya»).
-- empezar = llegada motorista − cocina típica − 2 min; nunca más de 20 min
-- desde que entró el pedido. Solo informativo: no reordena ni bloquea.
create or replace function public.kds_cuando_preparar(p_store_code text)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_suc record; v_cocina numeric; v_now timestamptz := now();
  v_disp jsonb := '{}'::jsonb;   -- motorista → minutos hasta estar en tienda
  v_fte  jsonb := '{}'::jsonb;   -- motorista → fuente
  v_libre jsonb := '{}'::jsonb;  -- motorista → minutos hasta quedar libre (después de lo ya asignado)
  r record; s record; v_t numeric; v_lat float8; v_lng float8; v_eta timestamptz;
  v_slot_id text; v_slot numeric; v_lleg numeric; v_fuente text; v_mot text;
  v_emp numeric; v_out jsonb := '[]'::jsonb; k text;
begin
  select id, lat::float8 lat, lng::float8 lng into v_suc from sucursales where store_code = p_store_code;
  if v_suc.id is null or v_suc.lat is null then return '[]'::jsonb; end if;

  -- Cocina típica: de que entra la comanda a que se completa (delivery, esta sucursal, esta franja, 14 días)
  select percentile_cont(0.5) within group (order by m) into v_cocina from (
    select extract(epoch from max(q.completado_at) - min(q.recibido_at)) / 60 m
      from pos_cocina_queue q
      join delivery_clientes d on d.pos_cuenta_id = q.cuenta_id and d.tipo = 'delivery'
     where q.store_code = p_store_code and q.recibido_at > v_now - interval '14 days'
       and q.estado = 'completado'
       and _franja_delivery(q.recibido_at) = _franja_delivery(v_now)
     group by q.cuenta_id) x where m between 2 and 60;
  v_cocina := least(greatest(round(coalesce(v_cocina, 15)), 5), 30);

  -- Motoristas de la sucursal en turno o con pedidos activos
  for r in
    select m.empleado_id, du.lat::float8 lat, du.lng::float8 lng, du.updated_at
      from (select du2.empleado_id from driver_ubicaciones du2 join empleados e on e.id = du2.empleado_id
             where e.sucursal_id = v_suc.id and du2.en_linea and coalesce(du2.tipo,'delivery') = 'delivery'
               and du2.updated_at > v_now - interval '12 hours'
            union
            select d.motorista_id from delivery_clientes d
             where d.sucursal_id = v_suc.id and d.motorista_id is not null
               and d.estado in ('recibida','preparando','lista','en_camino')) m
      left join driver_ubicaciones du on du.empleado_id = m.empleado_id
  loop
    k := r.empleado_id::text;
    if not exists (select 1 from delivery_clientes d where d.motorista_id = r.empleado_id
                     and d.sucursal_id = v_suc.id and d.estado = 'en_camino') then
      -- Sin viaje en curso
      if r.updated_at > v_now - interval '5 minutes' and r.lat is not null then
        v_t := _metros_entre(r.lat, r.lng, v_suc.lat, v_suc.lng) / 1000.0;
        v_t := case when v_t < 0.3 then 0 else minutos_viaje(v_suc.id, v_t::numeric, v_now) end;
        v_fuente := 'gps';
      else
        v_t := 0; v_fuente := 'sin_dato';
      end if;
    elsif r.updated_at > v_now - interval '2 minutes' and r.lat is not null then
      -- GPS fresco: desde donde está, por las paradas que le faltan, y de regreso
      v_t := 0; v_lat := r.lat; v_lng := r.lng;
      for s in select d.cliente_lat::float8 lat, d.cliente_lng::float8 lng from delivery_clientes d
                where d.motorista_id = r.empleado_id and d.estado = 'en_camino' and d.cliente_lat is not null
                order by d.orden_entrega nulls last, d.orden_eta_at nulls last, d.created_at loop
        v_t := v_t + minutos_viaje(v_suc.id, (_metros_entre(v_lat, v_lng, s.lat, s.lng) / 1000.0)::numeric, v_now);
        v_lat := s.lat; v_lng := s.lng;
      end loop;
      v_t := v_t + minutos_viaje(v_suc.id, (_metros_entre(v_lat, v_lng, v_suc.lat, v_suc.lng) / 1000.0)::numeric, v_now);
      v_fuente := 'gps';
    else
      -- Sin GPS: la ETA de la última parada (ruta / Recogí / Entregado) + regreso
      v_t := 0; v_lat := v_suc.lat; v_lng := v_suc.lng; v_eta := null;
      for s in select d.cliente_lat::float8 lat, d.cliente_lng::float8 lng, d.orden_eta_at, d.recogido_at
                 from delivery_clientes d
                where d.motorista_id = r.empleado_id and d.estado = 'en_camino' and d.cliente_lat is not null
                order by d.orden_entrega nulls last, d.orden_eta_at nulls last, d.created_at loop
        v_t := v_t + minutos_viaje(v_suc.id, (_metros_entre(v_lat, v_lng, s.lat, s.lng) / 1000.0)::numeric, v_now);
        v_lat := s.lat; v_lng := s.lng;
        v_eta := coalesce(s.orden_eta_at, coalesce(s.recogido_at, v_now) + make_interval(secs => v_t * 60));
      end loop;
      v_t := greatest(extract(epoch from coalesce(v_eta, v_now) - v_now) / 60, 0)
             + minutos_viaje(v_suc.id, (_metros_entre(v_lat, v_lng, v_suc.lat, v_suc.lng) / 1000.0)::numeric, v_now);
      v_fuente := 'eventos';
    end if;
    v_disp := v_disp || jsonb_build_object(k, round(v_t, 1));
    v_fte  := v_fte  || jsonb_build_object(k, v_fuente);

    -- Lo que ya tiene asignado y aún no sale: ida por esas paradas y regreso
    v_lat := v_suc.lat; v_lng := v_suc.lng; v_eta := null; v_lleg := 0;
    for s in select d.cliente_lat::float8 lat, d.cliente_lng::float8 lng from delivery_clientes d
              where d.motorista_id = r.empleado_id and d.estado in ('recibida','preparando','lista')
                and d.tipo = 'delivery' and d.cliente_lat is not null
              order by d.orden_entrega nulls last, d.created_at loop
      v_lleg := v_lleg + minutos_viaje(v_suc.id, (_metros_entre(v_lat, v_lng, s.lat, s.lng) / 1000.0)::numeric, v_now);
      v_lat := s.lat; v_lng := s.lng;
    end loop;
    if v_lleg > 0 then
      v_lleg := v_lleg + minutos_viaje(v_suc.id, (_metros_entre(v_lat, v_lng, v_suc.lat, v_suc.lng) / 1000.0)::numeric, v_now);
    end if;
    v_libre := v_libre || jsonb_build_object(k, round(v_t + v_lleg, 1));
  end loop;

  -- Pedidos de delivery que cocina todavía tiene pendientes
  for r in
    select d.id, d.pos_cuenta_id, d.motorista_id, d.cliente_lat::float8 lat, d.cliente_lng::float8 lng,
           (select min(q.recibido_at) from pos_cocina_queue q where q.cuenta_id = d.pos_cuenta_id) recibido_at
      from delivery_clientes d
     where d.sucursal_id = v_suc.id and d.tipo = 'delivery'
       and d.estado in ('recibida','preparando') and d.pos_cuenta_id is not null
       and exists (select 1 from pos_cocina_queue q where q.cuenta_id = d.pos_cuenta_id and q.estado = 'pendiente')
     order by d.created_at
  loop
    v_lleg := null; v_fuente := 'sin_motorista'; v_mot := null;
    if r.motorista_id is not null and v_disp ? r.motorista_id::text then
      v_lleg := (v_disp ->> r.motorista_id::text)::numeric;
      v_fuente := v_fte ->> r.motorista_id::text;
      v_mot := r.motorista_id::text;
    elsif r.motorista_id is null and v_libre <> '{}'::jsonb then
      -- Sin asignar: el primer motorista que se va a liberar; después ese
      -- motorista queda ocupado con la ida y vuelta de este pedido.
      select key, value::numeric into v_slot_id, v_slot from jsonb_each_text(v_libre) order by value::numeric limit 1;
      v_lleg := v_slot; v_fuente := v_fte ->> v_slot_id; v_mot := v_slot_id;
      v_libre := v_libre || jsonb_build_object(v_slot_id, v_slot + case when r.lat is null then 15
                   else 2 * minutos_viaje(v_suc.id, (_metros_entre(v_suc.lat, v_suc.lng, r.lat, r.lng) / 1000.0)::numeric, v_now) end);
    end if;

    if v_lleg is null or v_fuente = 'sin_dato' then
      v_emp := 0;
    else
      v_emp := greatest(v_lleg - v_cocina - 2, 0);
    end if;
    -- Tope: ningún pedido espera más de 20 min desde que entró
    v_emp := least(v_emp, greatest(extract(epoch from (coalesce(r.recibido_at, v_now) + interval '20 minutes') - v_now) / 60, 0));
    v_emp := round(v_emp);

    v_out := v_out || jsonb_build_object(
      'cuenta_id', r.pos_cuenta_id, 'delivery_id', r.id,
      'empezar_min', v_emp,
      'empezar_at', v_now + make_interval(mins => v_emp::int),
      'estado', case when v_emp <= 2 then 'ya' when v_emp <= 10 then 'pronto' else 'espera' end,
      'llegada_min', round(v_lleg), 'cocina_min', v_cocina, 'fuente', v_fuente,
      'asignado', r.motorista_id is not null,
      'motorista', (select split_part(btrim(coalesce(e.nombre_completo, '')), ' ', 1) from empleados e where e.id::text = v_mot));
  end loop;
  return v_out;
end $$;

grant execute on function public.kds_cuando_preparar(text) to anon, authenticated;
