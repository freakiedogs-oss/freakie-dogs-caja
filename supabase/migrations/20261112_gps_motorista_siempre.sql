-- ════════════════════════════════════════════════════════════════════
-- GPS del motorista «siempre disponible» + tiempos calibrados (12-nov-2026, Cesar)
-- Aplicadas como: gps_motorista_siempre, torre_asignar_bloqueo_sin_senal,
-- delivery_tiempos_calibrados.
--
--  · driver_estado_app + driver_reportar_estado(): la app nativa v12 reporta
--    versión, ubicación prendida, permiso «todo el tiempo», batería, puntos en cola.
--  · driver_puntos_lote(): puntos guardados sin internet (máx 500, últimas 12 h).
--  · actualizar_ubicacion_driver: el recorrido también graba el REGRESO
--    (hasta 45 min después de la última entrega).
--  · motoristas_senal(token): para la torre (MotoristasSenal.jsx).
--  · torre_asignar_motorista: bloqueo si el motorista lleva más de
--    config_delivery.bloquear_sin_senal_min sin señal (0 = APAGADO; prender
--    cuando todos tengan la app v12).
--  · delivery_tiempos_calibrados + recalibrar_tiempos_delivery() (cron lunes
--    3:15 am) + minutos_viaje(sucursal, km, ts): minutos por km en línea recta
--    por sucursal y franja, de entregas reales (incluye semáforos, altos, calles).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.driver_estado_app (
  empleado_id uuid primary key,
  version text,
  gps_activo boolean,
  permiso_siempre boolean,
  bateria_sin_restriccion boolean,
  bateria_pct int,
  pendientes int,
  updated_at timestamptz not null default now()
);
alter table public.driver_estado_app enable row level security;

create or replace function public.driver_reportar_estado(
  p_empleado_id uuid, p_version text, p_gps_activo boolean, p_permiso_siempre boolean,
  p_bateria_sin_restriccion boolean, p_bateria_pct int default null, p_pendientes int default 0)
returns void
language sql security definer set search_path to 'public', 'pg_temp'
as $$
  insert into driver_estado_app as e (empleado_id, version, gps_activo, permiso_siempre, bateria_sin_restriccion, bateria_pct, pendientes, updated_at)
  values (p_empleado_id, left(p_version, 40), p_gps_activo, p_permiso_siempre, p_bateria_sin_restriccion, p_bateria_pct, coalesce(p_pendientes, 0), now())
  on conflict (empleado_id) do update set
    version = excluded.version, gps_activo = excluded.gps_activo, permiso_siempre = excluded.permiso_siempre,
    bateria_sin_restriccion = excluded.bateria_sin_restriccion, bateria_pct = excluded.bateria_pct,
    pendientes = excluded.pendientes, updated_at = now();
$$;

create or replace function public.driver_puntos_lote(p_empleado_id uuid, p_puntos jsonb)
returns int
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare n int := 0; v_ult record;
begin
  if jsonb_typeof(p_puntos) <> 'array' then return 0; end if;
  insert into driver_recorrido (empleado_id, lat, lng, rumbo, exactitud, ts)
  select p_empleado_id, (x->>'lat')::float8, (x->>'lng')::float8, nullif(x->>'rumbo','')::float8, nullif(x->>'exactitud','')::float8,
         to_timestamp((x->>'ts')::float8 / 1000)
    from (select x from jsonb_array_elements(p_puntos) x limit 500) s
   where (x->>'lat') is not null and (x->>'lng') is not null
     and to_timestamp((x->>'ts')::float8 / 1000) between now() - interval '12 hours' and now() + interval '2 minutes';
  get diagnostics n = row_count;
  select (x->>'lat')::float8 lat, (x->>'lng')::float8 lng, to_timestamp((x->>'ts')::float8 / 1000) ts into v_ult
    from jsonb_array_elements(p_puntos) x where (x->>'lat') is not null
   order by (x->>'ts')::float8 desc limit 1;
  if v_ult.ts is not null then
    update driver_ubicaciones set lat = v_ult.lat, lng = v_ult.lng, updated_at = least(v_ult.ts, now()), en_linea = true
     where empleado_id = p_empleado_id and updated_at < v_ult.ts;
  end if;
  return n;
end $$;

create or replace function public.actualizar_ubicacion_driver(p_empleado_id uuid, p_nombre text, p_lat double precision, p_lng double precision,
  p_rumbo double precision default null, p_exactitud double precision default null, p_tipo text default 'delivery')
returns void
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.driver_ubicaciones as d (empleado_id, nombre, lat, lng, rumbo, exactitud, en_linea, updated_at, tipo)
  values (p_empleado_id, nullif(btrim(coalesce(p_nombre,'')),''), p_lat, p_lng, p_rumbo, p_exactitud, true, now(), coalesce(p_tipo,'delivery'))
  on conflict (empleado_id) do update set
    nombre = coalesce(excluded.nombre, d.nombre),
    lat = excluded.lat, lng = excluded.lng,
    rumbo = excluded.rumbo, exactitud = excluded.exactitud,
    en_linea = true, updated_at = now(), tipo = coalesce(excluded.tipo, d.tipo);
  if p_lat is not null and p_lng is not null
     and exists (select 1 from public.delivery_clientes
                 where motorista_id = p_empleado_id
                   and (estado = 'en_camino'
                        or (estado = 'entregada' and entregado_at > now() - interval '45 minutes'))) then
    insert into public.driver_recorrido(empleado_id, lat, lng, rumbo, exactitud)
    values (p_empleado_id, p_lat, p_lng, p_rumbo, p_exactitud);
  end if;
end;
$function$;

create or replace function public.motoristas_senal(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $$
declare v_ignore record;
begin
  select * into v_ignore from _staff_valida(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'empleado_id', u.empleado_id,
      'nombre', split_part(btrim(coalesce(e.nombre_completo, u.nombre, '')), ' ', 1)
                || coalesce(' ' || nullif(split_part(btrim(coalesce(e.nombre_completo, u.nombre, '')), ' ', 2), ''), ''),
      'telefono', e.telefono,
      'min_sin_senal', floor(extract(epoch from now() - u.updated_at) / 60)::int,
      'version', a.version, 'gps_activo', a.gps_activo, 'permiso_siempre', a.permiso_siempre,
      'bateria_ok', a.bateria_sin_restriccion, 'bateria_pct', a.bateria_pct,
      'app_nativa', a.empleado_id is not null and a.updated_at > now() - interval '10 minutes',
      'con_pedidos', exists (select 1 from delivery_clientes d where d.motorista_id = u.empleado_id
                              and d.estado in ('recibida','preparando','lista','en_camino')))
      order by u.updated_at)
      from driver_ubicaciones u
      left join empleados e on e.id = u.empleado_id
      left join driver_estado_app a on a.empleado_id = u.empleado_id
     where u.en_linea and coalesce(u.tipo, 'delivery') = 'delivery'
       and u.updated_at > now() - interval '12 hours'), '[]'::jsonb);
end $$;

insert into config_delivery (parametro, valor) values ('bloquear_sin_senal_min', '0')
on conflict (parametro) do nothing;

grant execute on function public.driver_reportar_estado(uuid, text, boolean, boolean, boolean, int, int) to anon, authenticated;
grant execute on function public.driver_puntos_lote(uuid, jsonb) to anon, authenticated;
grant execute on function public.motoristas_senal(uuid) to anon, authenticated;

-- torre_asignar_motorista: bloqueo sin señal (ver migración torre_asignar_bloqueo_sin_senal;
-- se insertó con replace justo después de validar el motorista).

-- ── Tiempos calibrados ──────────────────────────────────────────────
create table if not exists public.delivery_tiempos_calibrados (
  sucursal_id uuid not null,             -- '00000000-…' = todas las sucursales
  franja text not null,                  -- '11-14' | '14-17' | '17-20' | 'otras'
  min_por_km numeric(6,2) not null,
  min_fijo numeric(6,2) not null,
  n int not null,
  actualizado_at timestamptz not null default now(),
  primary key (sucursal_id, franja)
);
alter table public.delivery_tiempos_calibrados enable row level security;

create or replace function public._franja_delivery(p_ts timestamptz)
returns text language sql immutable as $$
  select case when h between 11 and 13 then '11-14' when h between 14 and 16 then '14-17'
              when h between 17 and 19 then '17-20' else 'otras' end
    from (select extract(hour from p_ts at time zone 'America/El_Salvador')::int h) x;
$$;

-- recalibrar_tiempos_delivery() y minutos_viaje(): ver migración delivery_tiempos_calibrados
-- (mediana de (minutos − 3) / km de la primera parada, ≥ 30 viajes por sucursal y franja).
