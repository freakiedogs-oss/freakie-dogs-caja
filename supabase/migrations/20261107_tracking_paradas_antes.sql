-- Tracking: el cliente ve si el motorista va a dejar otro pedido antes (7-nov-2026, pedido de Cesar).
-- ~33% de las entregas tienen al menos otra entrega antes. Sin esto el cliente ve al motorista
-- alejarse y cree que se desvió.
-- Orden de paradas: no se guarda, se asume "vecino más cercano" desde la posición del motorista
-- (o desde la sucursal si no hay GPS). Solo se devuelven las paradas ANTES de este cliente, así
-- el cliente 1 nunca se entera de que después hay otra entrega.
-- Privacidad: de las otras paradas solo se devuelve lat/lng redondeada a 3 decimales (~100 m).
-- Nunca nombre, dirección ni número de orden.

create or replace function public._km(lat1 double precision, lng1 double precision,
                                      lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1)/2),2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1)/2),2)))
$$;

create or replace function public.tracking_pedido(p_token uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  d public.delivery_clientes%rowtype;
  v_suc_nombre text; v_suc_lat double precision; v_suc_lng double precision;
  v_drv_lat double precision; v_drv_lng double precision;
  v_nombre text; v_eta int;
  -- ruta
  v_cur_lat double precision; v_cur_lng double precision;
  v_km double precision := 0;
  v_antes jsonb := '[]'::jsonb;
  v_pend jsonb := '[]'::jsonb;
  v_next jsonb; v_best int; v_best_km double precision; v_k double precision; v_j int;
begin
  select * into d from public.delivery_clientes where tracking_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrado'); end if;

  select nombre, lat, lng into v_suc_nombre, v_suc_lat, v_suc_lng
  from public.sucursales where id = d.sucursal_id;

  -- Ventana ampliada a 15 min para tolerar background de la PWA
  if d.estado = 'en_camino' and d.motorista_id is not null then
    select du.lat, du.lng into v_drv_lat, v_drv_lng
    from public.driver_ubicaciones du
    where du.empleado_id = d.motorista_id and du.en_linea
      and du.updated_at > now() - interval '15 minutes';
  end if;

  select split_part(btrim(nombre_completo), ' ', 1) into v_nombre
  from public.empleados where id = d.motorista_id;

  -- Paradas antes de este cliente (vecino más cercano)
  if d.estado = 'en_camino' and d.motorista_id is not null and d.cliente_lat is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'lat', o.cliente_lat, 'lng', o.cliente_lng)), '[]'::jsonb)
      into v_pend
    from public.delivery_clientes o
    where o.motorista_id = d.motorista_id and o.id <> d.id
      and o.estado = 'en_camino' and o.cliente_lat is not null;

    v_cur_lat := coalesce(v_drv_lat, v_suc_lat);
    v_cur_lng := coalesce(v_drv_lng, v_suc_lng);

    if jsonb_array_length(v_pend) > 0 and v_cur_lat is not null then
      -- este cliente entra a la lista de candidatos
      v_pend := v_pend || jsonb_build_array(jsonb_build_object('id', d.id, 'lat', d.cliente_lat, 'lng', d.cliente_lng));
      loop
        v_best := null; v_best_km := null;
        -- OJO: no usar `i` como variable: choca con el alias `i` de items más abajo (rompió el tracking 1 min)
        for v_j in 0 .. jsonb_array_length(v_pend) - 1 loop
          v_k := public._km(v_cur_lat, v_cur_lng, (v_pend->v_j->>'lat')::float8, (v_pend->v_j->>'lng')::float8);
          if v_best_km is null or v_k < v_best_km then v_best := v_j; v_best_km := v_k; end if;
        end loop;
        v_next := v_pend->v_best;
        v_km := v_km + v_best_km;
        v_cur_lat := (v_next->>'lat')::float8; v_cur_lng := (v_next->>'lng')::float8;
        exit when (v_next->>'id') = d.id::text;
        v_antes := v_antes || jsonb_build_array(jsonb_build_object(
          'lat', round(v_cur_lat::numeric, 3), 'lng', round(v_cur_lng::numeric, 3)));
        v_pend := v_pend - v_best;
      end loop;
    end if;
  end if;

  if v_drv_lat is not null and d.cliente_lat is not null then
    if jsonb_array_length(v_antes) > 0 then
      -- tramos por las paradas previas + ~3 min por cada entrega
      v_eta := greatest(2, round(v_km * 4 + 5 + 3 * jsonb_array_length(v_antes))::int);
    else
      v_eta := greatest(2, round(public._km(v_drv_lat, v_drv_lng, d.cliente_lat, d.cliente_lng) * 4 + 5)::int);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'numero_orden', d.numero_orden, 'estado', d.estado, 'total', d.total,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'nombre', it->>'nombre', 'cantidad', it->>'cantidad')), '[]'::jsonb)
              from jsonb_array_elements(coalesce(d.items,'[]'::jsonb)) it),
    'cliente_nombre', split_part(btrim(coalesce(d.cliente_nombre,'')), ' ', 1),
    'direccion', d.cliente_direccion,
    'cliente_lat', d.cliente_lat, 'cliente_lng', d.cliente_lng,
    'sucursal', v_suc_nombre, 'sucursal_lat', v_suc_lat, 'sucursal_lng', v_suc_lng,
    'motorista', v_nombre,
    'driver_lat', v_drv_lat, 'driver_lng', v_drv_lng,
    'eta_min', v_eta,
    'paradas_antes', v_antes,
    'creado_at', d.created_at, 'recogido_at', d.recogido_at, 'entregado_at', d.entregado_at
  );
end;
$function$;

revoke all on function public._km(double precision, double precision, double precision, double precision) from public;
