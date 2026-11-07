-- ════════════════════════════════════════════════════════════════════
-- Orden de entrega automático (7-nov-2026, pedido de Cesar)
--
-- El sistema decide en qué orden entrega cada motorista. Karina no tiene
-- que hacer nada (puede cambiarlo en una emergencia) y el motorista no puede
-- entregar fuera de orden.
--
-- Fórmula "balance": se prueban todas las combinaciones posibles y gana la
-- que minimiza Σ (espera_total_de_cada_cliente)². Junta distancia y espera:
-- evita el zigzag pero castiga dejar de último a quien ya esperó mucho.
-- Probada con 720 viajes reales (60 días): 62.9 min de espera promedio vs
-- 63.5 del orden que eligieron los motoristas y 65.4 de la fórmula anterior
-- de la torre (rutaOrden.js: espera − viaje), que casi era "el más viejo
-- primero" y hacía zigzag.
-- Modelo de tiempo calibrado con 1,482 entregas de un solo pedido:
--   2.14 min por km en línea recta + 6 min por parada.
--
-- Ciclo de vida de una ruta:
--   1. Asignado / recogido: el orden se recalcula cada vez que cambia el
--      grupo (pedidos del motorista en lista + en camino).
--   2. Primera entrega del viaje: el orden se FIJA (orden_fijado_at). Ya no
--      cambia; si recoge otro, va al final.
--   3. Karina puede cambiarlo con torre_cambiar_orden (queda 'manual' y en
--      delivery_orden_cambios).
-- Seguimiento: torre_rutas_resumen (acierto del ETA, % > 60 min, viajes de 4+).
-- ════════════════════════════════════════════════════════════════════

alter table public.delivery_clientes
  add column if not exists orden_entrega   smallint,
  add column if not exists orden_origen    text,          -- 'auto' | 'manual'
  add column if not exists orden_eta_at    timestamptz,   -- hora estimada de entrega al fijar
  add column if not exists orden_fijado_at timestamptz,   -- desde la 1ª entrega del viaje
  add column if not exists ruta_id         uuid;          -- agrupa los pedidos de un viaje

create index if not exists idx_delivery_motorista_activos
  on public.delivery_clientes (motorista_id)
  where estado in ('recibida','preparando','lista','en_camino');
create index if not exists idx_delivery_ruta on public.delivery_clientes (ruta_id) where ruta_id is not null;

create table if not exists public.delivery_orden_cambios (
  id           bigserial primary key,
  ruta_id      uuid,
  motorista_id uuid,
  delivery_id  uuid,
  antes        jsonb,
  despues      jsonb,
  cambiado_por uuid,
  nombre       text,
  motivo       text,
  created_at   timestamptz not null default now()
);
alter table public.delivery_orden_cambios enable row level security;  -- solo vía funciones

-- ── Recalcular la ruta de un motorista ──────────────────────────────
create or replace function public.fn_ruta_recalcular(p_motorista uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_min_km   constant float8 := 2.14;
  c_parada   constant float8 := 6;
  v_fijada   boolean;
  v_manual   boolean;
  v_ruta     uuid;
  v_ids      uuid[];
  v_lat      float8[];
  v_lng      float8[];
  v_w        float8[];
  v_n        int;
  v_slat     float8; v_slng float8;
  v_perm     int[];
  v_best     int[];
  v_best_val float8;
  v_val      float8; v_t float8; v_k float8; v_tot float8;
  v_clat     float8; v_clng float8;
  v_etas     float8[];
  v_max      int;
  j int; c int; r record;
begin
  if p_motorista is null then return; end if;

  -- Grupo del viaje: lo que lleva en camino + lo asignado listo para salir.
  -- Mientras no haya nada en camino, también entra lo que sigue en cocina.
  if exists (select 1 from delivery_clientes where motorista_id = p_motorista and estado = 'en_camino') then
    select bool_or(orden_fijado_at is not null) into v_fijada
      from delivery_clientes where motorista_id = p_motorista and estado = 'en_camino';
  else
    v_fijada := false;
  end if;

  -- Ruta ya fijada (hubo una entrega): no se reordena. Lo nuevo en camino va
  -- al final; lo que no salió queda para el próximo viaje (sin número).
  if v_fijada then
    select ruta_id, coalesce(max(orden_entrega), 0) into v_ruta, v_max
      from delivery_clientes
     where motorista_id = p_motorista and estado = 'en_camino' and orden_fijado_at is not null
     group by ruta_id order by max(orden_fijado_at) desc limit 1;
    for r in select id from delivery_clientes
              where motorista_id = p_motorista and estado = 'en_camino'
                and (orden_entrega is null or ruta_id is distinct from v_ruta)
              order by recogido_at nulls last, created_at loop
      v_max := v_max + 1;
      update delivery_clientes
         set orden_entrega = v_max, orden_origen = 'auto', ruta_id = v_ruta, orden_fijado_at = now()
       where id = r.id;
    end loop;
    update delivery_clientes
       set orden_entrega = null, orden_origen = null, orden_eta_at = null, ruta_id = null
     where motorista_id = p_motorista and estado in ('recibida','preparando','lista')
       and orden_entrega is not null;
    return;
  end if;

  -- Pedidos del grupo
  select array_agg(d.id order by d.created_at),
         array_agg(d.cliente_lat::float8 order by d.created_at),
         array_agg(d.cliente_lng::float8 order by d.created_at),
         array_agg(extract(epoch from now() - d.created_at)/60 order by d.created_at),
         bool_or(d.orden_origen = 'manual'),
         (array_agg(d.ruta_id) filter (where d.ruta_id is not null))[1],
         min(s.lat::float8), min(s.lng::float8)
    into v_ids, v_lat, v_lng, v_w, v_manual, v_ruta, v_slat, v_slng
    from delivery_clientes d
    left join sucursales s on s.id = d.sucursal_id
   where d.motorista_id = p_motorista
     and d.estado in ('preparando','lista','en_camino');

  -- Pedidos que ya no están en el grupo (entregados, devueltos) no se tocan.
  if v_ids is null then return; end if;
  v_n := array_length(v_ids, 1);
  v_ruta := coalesce(v_ruta, gen_random_uuid());

  -- Karina lo ordenó a mano: se respeta; lo nuevo va al final.
  if v_manual then
    select coalesce(max(orden_entrega), 0) into v_max from delivery_clientes where id = any(v_ids) and orden_entrega is not null;
    for r in select id from delivery_clientes where id = any(v_ids) and orden_entrega is null order by created_at loop
      v_max := v_max + 1;
      update delivery_clientes set orden_entrega = v_max, orden_origen = 'manual', ruta_id = v_ruta where id = r.id;
    end loop;
    return;
  end if;

  -- Sin ubicación del cliente o de la sucursal: orden de llegada.
  if v_slat is null or exists (select 1 from unnest(v_lat) x where x is null) then
    for j in 1..v_n loop
      update delivery_clientes set orden_entrega = j, orden_origen = 'auto', ruta_id = v_ruta, orden_eta_at = null
       where id = v_ids[j];
    end loop;
    return;
  end if;

  -- Balance: probar todas las combinaciones (hasta 6 pedidos = 720).
  if v_n <= 6 then
    for v_perm in
      with recursive p(arr) as (
        select array[i] from generate_series(1, v_n) i
        union all
        select p.arr || i from p, generate_series(1, v_n) i
         where not i = any(p.arr) and cardinality(p.arr) < v_n)
      select arr from p where cardinality(arr) = v_n
    loop
      v_t := 0; v_val := 0; v_clat := v_slat; v_clng := v_slng;
      for j in 1..v_n loop
        c := v_perm[j];
        v_k := _km(v_clat, v_clng, v_lat[c], v_lng[c]);
        v_t := v_t + c_min_km * v_k + c_parada;
        v_tot := v_w[c] + v_t;
        v_val := v_val + v_tot * v_tot;
        v_clat := v_lat[c]; v_clng := v_lng[c];
      end loop;
      if v_best_val is null or v_val < v_best_val - 1e-9 then v_best_val := v_val; v_best := v_perm; end if;
    end loop;
  else
    -- Más de 6: vecino más cercano (no debería pasar; queda en el reporte).
    v_best := '{}'; v_clat := v_slat; v_clng := v_slng;
    for j in 1..v_n loop
      v_best_val := null; v_k := null;
      for c in 1..v_n loop
        if not c = any(v_best) then
          v_val := _km(v_clat, v_clng, v_lat[c], v_lng[c]);
          if v_best_val is null or v_val < v_best_val then v_best_val := v_val; v_k := c; end if;
        end if;
      end loop;
      v_best := v_best || v_k::int; v_clat := v_lat[v_k::int]; v_clng := v_lng[v_k::int];
    end loop;
  end if;

  -- Guardar orden + hora estimada de cada parada
  v_t := 0; v_clat := v_slat; v_clng := v_slng;
  for j in 1..v_n loop
    c := v_best[j];
    v_t := v_t + c_min_km * _km(v_clat, v_clng, v_lat[c], v_lng[c]) + c_parada;
    v_clat := v_lat[c]; v_clng := v_lng[c];
    update delivery_clientes
       set orden_entrega = j, orden_origen = 'auto', ruta_id = v_ruta,
           orden_eta_at = now() + make_interval(secs => round(v_t * 60))
     where id = v_ids[c]
       and (orden_entrega is distinct from j or ruta_id is distinct from v_ruta
            or orden_eta_at is null or abs(extract(epoch from orden_eta_at - (now() + make_interval(secs => round(v_t * 60))))) > 60);
  end loop;
end;
$function$;

-- ── Trigger: recalcular al asignar, recoger, entregar, devolver o cancelar ──
create or replace function public.trg_ruta_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  begin
    -- Primera entrega del viaje: se fija el orden del resto
    if tg_op = 'UPDATE' and new.estado = 'entregada' and old.estado is distinct from 'entregada'
       and new.motorista_id is not null then
      update delivery_clientes
         set orden_fijado_at = now()
       where motorista_id = new.motorista_id and estado = 'en_camino'
         and orden_fijado_at is null and id <> new.id;
      update delivery_clientes set orden_fijado_at = coalesce(orden_fijado_at, now()) where id = new.id;
    end if;

    perform fn_ruta_recalcular(new.motorista_id);
    if tg_op = 'UPDATE' and old.motorista_id is distinct from new.motorista_id then
      perform fn_ruta_recalcular(old.motorista_id);
      -- El pedido cambió de motorista: su número anterior ya no aplica
      if new.motorista_id is null then
        update delivery_clientes set orden_entrega = null, orden_origen = null, orden_eta_at = null, ruta_id = null
         where id = new.id;
      end if;
    end if;
  exception when others then
    -- El orden nunca debe frenar una asignación o una entrega
    raise warning 'fn_ruta_recalcular: %', sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_ruta_delivery on public.delivery_clientes;
create trigger trg_ruta_delivery
  after insert or update of motorista_id, estado on public.delivery_clientes
  for each row execute function public.trg_ruta_delivery();

-- ── Karina cambia el orden (emergencias) ─────────────────────────────
create or replace function public.torre_cambiar_orden(p_token uuid, p_delivery_id uuid, p_posicion int, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sess record; v_row delivery_clientes%rowtype; v_lista uuid[]; v_antes jsonb; v_despues jsonb; v_n int; j int;
begin
  select * into v_sess from _staff_valida(p_token);
  select * into v_row from delivery_clientes where id = p_delivery_id;
  if not found then raise exception 'Ese pedido no existe'; end if;
  if v_row.motorista_id is null or v_row.orden_entrega is null then raise exception 'Ese pedido no tiene ruta'; end if;

  -- La ruta: mismos pedidos del motorista con número, sin entregar
  select array_agg(id order by orden_entrega) into v_lista
    from delivery_clientes
   where motorista_id = v_row.motorista_id and ruta_id is not distinct from v_row.ruta_id
     and estado in ('preparando','lista','en_camino') and orden_entrega is not null;
  v_n := array_length(v_lista, 1);
  if p_posicion < 1 or p_posicion > v_n then raise exception 'Posición inválida (1 a %)', v_n; end if;

  select jsonb_agg(numero_orden order by orden_entrega) into v_antes from delivery_clientes where id = any(v_lista);

  v_lista := array_remove(v_lista, p_delivery_id);
  v_lista := v_lista[1:p_posicion-1] || p_delivery_id || v_lista[p_posicion:];

  -- Los números siguen después de las entregas ya hechas del mismo viaje
  select coalesce(max(orden_entrega), 0) into j
    from delivery_clientes where ruta_id = v_row.ruta_id and estado = 'entregada';
  for v_n in 1..array_length(v_lista, 1) loop
    update delivery_clientes set orden_entrega = j + v_n, orden_origen = 'manual' where id = v_lista[v_n];
  end loop;

  select jsonb_agg(numero_orden order by orden_entrega) into v_despues from delivery_clientes where id = any(v_lista);
  insert into delivery_orden_cambios(ruta_id, motorista_id, delivery_id, antes, despues, cambiado_por, nombre, motivo)
  values (v_row.ruta_id, v_row.motorista_id, p_delivery_id, v_antes, v_despues, v_sess.usuario_id, v_sess.nombre, nullif(btrim(p_motivo), ''));

  return jsonb_build_object('ok', true, 'orden', v_despues);
end;
$function$;

-- ── App del motorista: pedidos en el orden de entrega ────────────────
create or replace function public.mis_pedidos_driver(p_empleado_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'numero_orden', d.numero_orden, 'estado', d.estado,
    'cliente_nombre', d.cliente_nombre, 'cliente_telefono', d.cliente_telefono,
    'cliente_direccion', d.cliente_direccion,
    'cliente_lat', d.cliente_lat, 'cliente_lng', d.cliente_lng,
    'total', d.total, 'metodo_pago', d.metodo_pago, 'paga_con', d.paga_con, 'items', d.items,
    'cobrado', d.cobrado,
    'pagado_online', exists (select 1 from public.pagos_online po
                              where po.delivery_id = d.id and po.estado = 'aprobado'),
    'sucursal', s.nombre, 'store_code', s.store_code,
    'recogido_at', d.recogido_at,
    'orden_entrega', d.orden_entrega, 'orden_eta_at', d.orden_eta_at,
    'orden_total', (select count(*) from public.delivery_clientes x
                     where x.ruta_id = d.ruta_id and d.ruta_id is not null
                       and x.estado in ('preparando','lista','en_camino','entregada'))
  ) order by
      case d.estado when 'en_camino' then 0 when 'lista' then 1 else 2 end,
      d.orden_entrega nulls last,
      d.created_at), '[]'::jsonb)
  from public.delivery_clientes d
  left join public.sucursales s on s.id = d.sucursal_id
  where d.motorista_id = p_empleado_id
    and d.estado in ('recibida','preparando','lista','en_camino');
$function$;

-- ── Tracking del cliente: usa el orden guardado ──────────────────────
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
  v_cur_lat double precision; v_cur_lng double precision;
  v_km double precision := 0;
  v_antes jsonb := '[]'::jsonb;
  r record;
begin
  select * into d from public.delivery_clientes where tracking_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrado'); end if;

  select nombre, lat, lng into v_suc_nombre, v_suc_lat, v_suc_lng
  from public.sucursales where id = d.sucursal_id;

  if d.estado = 'en_camino' and d.motorista_id is not null then
    select du.lat, du.lng into v_drv_lat, v_drv_lng
    from public.driver_ubicaciones du
    where du.empleado_id = d.motorista_id and du.en_linea
      and du.updated_at > now() - interval '15 minutes';
  end if;

  select split_part(btrim(nombre_completo), ' ', 1) into v_nombre
  from public.empleados where id = d.motorista_id;

  -- Entregas que van antes que este cliente según la ruta guardada.
  -- Solo coordenadas aproximadas (~100 m): nada del otro cliente.
  if d.estado = 'en_camino' and d.orden_entrega is not null then
    v_cur_lat := coalesce(v_drv_lat, v_suc_lat);
    v_cur_lng := coalesce(v_drv_lng, v_suc_lng);
    for r in
      select o.cliente_lat::float8 la, o.cliente_lng::float8 lo
        from public.delivery_clientes o
       where o.motorista_id = d.motorista_id and o.id <> d.id and o.estado = 'en_camino'
         and o.orden_entrega is not null and o.orden_entrega < d.orden_entrega
         and o.cliente_lat is not null
       order by o.orden_entrega
    loop
      if v_cur_lat is not null then v_km := v_km + public._km(v_cur_lat, v_cur_lng, r.la, r.lo); end if;
      v_cur_lat := r.la; v_cur_lng := r.lo;
      v_antes := v_antes || jsonb_build_array(jsonb_build_object(
        'lat', round(r.la::numeric, 3), 'lng', round(r.lo::numeric, 3)));
    end loop;
    if jsonb_array_length(v_antes) > 0 and d.cliente_lat is not null then
      v_km := v_km + public._km(v_cur_lat, v_cur_lng, d.cliente_lat, d.cliente_lng);
    end if;
  end if;

  if v_drv_lat is not null and d.cliente_lat is not null then
    if jsonb_array_length(v_antes) > 0 then
      v_eta := greatest(2, round(v_km * 2.14 + 6 * (jsonb_array_length(v_antes) + 1))::int);
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

-- ── Torre: rutas activas (panel de Karina) ───────────────────────────
create or replace function public.torre_rutas_activas(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ignore record;
begin
  select * into v_ignore from _staff_valida(p_token);
  return jsonb_build_object('ok', true,
    'rutas', coalesce((
      select jsonb_agg(r order by r->>'estado' desc, r->>'motorista')
      from (
        select jsonb_build_object(
          'ruta_id', d.ruta_id,
          'motorista_id', d.motorista_id,
          'motorista', split_part(btrim(e.nombre_completo), ' ', 1),
          'sucursal', s.nombre, 'store_code', s.store_code,
          'estado', case when bool_or(d.estado = 'en_camino') then 'en_camino' else 'por_salir' end,
          'fijada', bool_or(d.orden_fijado_at is not null),
          'manual', bool_or(d.orden_origen = 'manual'),
          'paradas', jsonb_agg(jsonb_build_object(
              'id', d.id, 'numero_orden', d.numero_orden, 'orden', d.orden_entrega,
              'estado', d.estado, 'direccion', d.cliente_direccion,
              'espera_min', round(extract(epoch from coalesce(d.entregado_at, now()) - d.created_at)/60),
              'eta_at', d.orden_eta_at, 'entregado_at', d.entregado_at,
              'metodo_pago', d.metodo_pago, 'total', d.total, 'paga_con', d.paga_con,
              'lat', d.cliente_lat, 'lng', d.cliente_lng)
            order by d.orden_entrega)
        ) r
        from delivery_clientes d
        join empleados e on e.id = d.motorista_id
        left join sucursales s on s.id = d.sucursal_id
        where d.ruta_id is not null and d.orden_entrega is not null
          and (d.estado in ('preparando','lista','en_camino')
               or (d.estado = 'entregada' and d.ruta_id in (
                     select x.ruta_id from delivery_clientes x
                      where x.estado in ('preparando','lista','en_camino') and x.ruta_id is not null)))
        group by d.ruta_id, d.motorista_id, e.nombre_completo, s.nombre, s.store_code
      ) t(r)
    ), '[]'::jsonb),
    -- Pedidos listos que llevan más de 10 min esperando que el motorista salga
    'esperando', coalesce((
      select jsonb_agg(jsonb_build_object('numero_orden', d.numero_orden, 'sucursal', s.nombre,
               'motorista', split_part(btrim(e.nombre_completo), ' ', 1),
               'min_lista', round(extract(epoch from now() - l.desde)/60)))
      from delivery_clientes d
      join lateral (select max(cambiado_at) desde from delivery_estado_log
                     where delivery_id = d.id and estado_nuevo = 'lista') l on true
      left join sucursales s on s.id = d.sucursal_id
      left join empleados e on e.id = d.motorista_id
      where d.estado = 'lista' and d.tipo = 'delivery' and l.desde < now() - interval '10 minutes'
    ), '[]'::jsonb));
end;
$function$;

-- ── Seguimiento: ¿qué tan bien funciona la lógica? ───────────────────
create or replace function public.torre_rutas_resumen(p_token uuid, p_dias int default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ignore record;
begin
  if p_token is not null then select * into v_ignore from _staff_valida(p_token); end if;
  return (
    with rutas as (
      -- Solo viajes terminados: todos sus pedidos entregados
      select d.ruta_id, min(d.motorista_id::text)::uuid motorista_id, count(*) n,
             bool_or(d.orden_origen = 'manual') manual,
             min(d.recogido_at) salida, max(d.entregado_at) fin
        from delivery_clientes d
       where d.ruta_id is not null and d.estado <> 'cancelada'
       group by d.ruta_id
      having bool_and(d.estado = 'entregada')
         and max(d.entregado_at) > now() - make_interval(days => p_dias)),
    ped as (
      select r.ruta_id, r.n, r.manual, d.orden_entrega,
             extract(epoch from d.entregado_at - d.created_at)/60 total_min,
             extract(epoch from d.entregado_at - r.salida)/60 calle_min,
             extract(epoch from d.entregado_at - d.orden_eta_at)/60 err_eta,
             -- ¿se entregó en el lugar que le tocaba?
             (row_number() over (partition by r.ruta_id order by d.entregado_at))
               = (rank() over (partition by r.ruta_id order by d.orden_entrega)) en_orden
        from rutas r join delivery_clientes d on d.ruta_id = r.ruta_id and d.estado = 'entregada')
    select jsonb_build_object(
      'dias', p_dias,
      'por_tamano', (select jsonb_agg(jsonb_build_object(
          'pedidos_por_viaje', t, 'viajes', viajes, 'pedidos', pedidos,
          'espera_total_prom', espera, 'pct_mas_60', pct60, 'min_en_calle_prom', calle,
          'eta_error_prom_min', err, 'pct_eta_dentro_10', dentro10,
          'pct_entregado_en_orden', en_orden, 'viajes_cambiados_a_mano', manuales) order by t)
        from (select least(n, 5) t, count(distinct ruta_id) viajes, count(*) pedidos,
                     round(avg(total_min)::numeric, 1) espera,
                     round(100.0 * avg((total_min > 60)::int)::numeric, 1) pct60,
                     round(avg(calle_min)::numeric, 1) calle,
                     round(avg(err_eta)::numeric, 1) err,
                     round(100.0 * avg((abs(err_eta) <= 10)::int) filter (where err_eta is not null)::numeric, 1) dentro10,
                     round(100.0 * avg(en_orden::int)::numeric, 1) en_orden,
                     count(distinct ruta_id) filter (where manual) manuales
                from ped group by 1) z),
      -- Viajes de 4 o más: cada cliente con su tiempo, para decidir si vale la pena
      'viajes_de_4_o_mas', (select jsonb_agg(v order by v->>'salida' desc) from (
          select jsonb_build_object(
                   'salida', r.salida, 'motorista', split_part(btrim(e.nombre_completo), ' ', 1),
                   'sucursal', s.nombre, 'pedidos', r.n,
                   'min_por_cliente', (select jsonb_agg(round(extract(epoch from x.entregado_at - x.created_at)/60) order by x.orden_entrega)
                                         from delivery_clientes x where x.ruta_id = r.ruta_id and x.estado = 'entregada')) v
            from rutas r
            join empleados e on e.id = r.motorista_id
            left join lateral (select sucursal_id from delivery_clientes where ruta_id = r.ruta_id limit 1) q on true
            left join sucursales s on s.id = q.sucursal_id
           where r.n >= 4) w),
      'cambios_manuales', (select count(*) from delivery_orden_cambios where created_at > now() - make_interval(days => p_dias))
    ));
end;
$function$;

-- ── Torre: el mapa en vivo trae el orden guardado ────────────────────
CREATE OR REPLACE FUNCTION public.torre_mapa_vivo(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ignore record;
  v_pedidos jsonb;
  v_pedidos_sin_ubicacion int;
  v_motoristas jsonb;
  v_sucursales jsonb;
  v_min_por_km numeric := 2.4;
BEGIN
  SELECT * INTO v_ignore FROM public._staff_valida(p_token);

  SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_sucursales
  FROM (
    SELECT store_code, nombre, lat::float8, lng::float8
    FROM public.sucursales
    WHERE tiene_delivery AND activa AND lat IS NOT NULL AND lng IS NOT NULL
  ) s;

  -- Solo pedidos a domicilio: un pedido para retirar en local nunca va a tener
  -- ubicación del cliente y no debe contarse como problema.
  SELECT COUNT(*) INTO v_pedidos_sin_ubicacion
  FROM public.delivery_clientes d
  WHERE d.estado IN ('recibida','preparando','lista','en_camino')
    AND d.tipo = 'delivery'
    AND (d.cliente_lat IS NULL OR d.cliente_lng IS NULL);

  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY (p.created_at) DESC), '[]'::jsonb) INTO v_pedidos
  FROM (
    SELECT
      d.id, d.numero_orden, d.cliente_nombre, d.cliente_telefono, d.cliente_direccion,
      d.cliente_lat::float8, d.cliente_lng::float8,
      d.ubicacion_origen,
      d.estado, d.total, d.created_at, d.tracking_token,
      d.motorista_id, e.nombre_completo AS motorista_nombre,
      d.orden_entrega, d.orden_origen, d.orden_eta_at, d.ruta_id,
      s.store_code, s.nombre AS sucursal_nombre,
      s.lat::float8 AS sucursal_lat, s.lng::float8 AS sucursal_lng,
      CASE
        WHEN du.lat IS NOT NULL AND d.cliente_lat IS NOT NULL
        THEN round((public._metros_entre(du.lat, du.lng, d.cliente_lat, d.cliente_lng) / 1000.0)::numeric, 2)
        WHEN d.motorista_id IS NOT NULL AND s.lat IS NOT NULL AND d.cliente_lat IS NOT NULL
        THEN round((public._metros_entre(s.lat, s.lng, d.cliente_lat, d.cliente_lng) / 1000.0)::numeric, 2)
      END AS distancia_km,
      CASE
        WHEN du.lat IS NOT NULL AND d.cliente_lat IS NOT NULL
        THEN ceil((public._metros_entre(du.lat, du.lng, d.cliente_lat, d.cliente_lng) / 1000.0 * v_min_por_km))::int
        WHEN d.motorista_id IS NOT NULL AND s.lat IS NOT NULL AND d.cliente_lat IS NOT NULL
        THEN ceil((public._metros_entre(s.lat, s.lng, d.cliente_lat, d.cliente_lng) / 1000.0 * v_min_por_km))::int
      END AS eta_min,
      CASE
        WHEN du.lat IS NOT NULL THEN 'driver'
        WHEN d.motorista_id IS NOT NULL AND s.lat IS NOT NULL THEN 'sucursal'
        ELSE NULL
      END AS eta_origen,
      du.lat::float8 AS driver_lat, du.lng::float8 AS driver_lng
    FROM public.delivery_clientes d
    LEFT JOIN public.sucursales s ON s.id = d.sucursal_id
    LEFT JOIN public.empleados e ON e.id = d.motorista_id
    LEFT JOIN public.driver_ubicaciones du ON du.empleado_id = d.motorista_id
      AND du.en_linea = true
      AND du.updated_at > now() - interval '30 minutes'
    WHERE d.estado IN ('recibida','preparando','lista','en_camino')
      AND d.tipo = 'delivery'
      AND d.cliente_lat IS NOT NULL AND d.cliente_lng IS NOT NULL
    ORDER BY d.created_at DESC
    LIMIT 200
  ) p;

  SELECT COALESCE(jsonb_agg(row_to_json(m)), '[]'::jsonb) INTO v_motoristas
  FROM (
    SELECT
      du.empleado_id,
      COALESCE(du.nombre, e.nombre_completo) AS nombre,
      du.lat::float8, du.lng::float8, du.updated_at,
      EXTRACT(EPOCH FROM (now() - du.updated_at))::int AS seg_desde_ultima,
      s.store_code, s.nombre AS sucursal_nombre,
      s.lat::float8 AS sucursal_lat, s.lng::float8 AS sucursal_lng,
      (SELECT COUNT(*) FROM public.delivery_clientes d
       WHERE d.motorista_id = du.empleado_id AND d.estado = 'en_camino')::int AS pedidos_activos,
      (SELECT COUNT(*) FROM public.delivery_clientes d
       WHERE d.motorista_id = du.empleado_id AND d.estado = 'lista')::int AS pedidos_asignados,
      CASE
        WHEN s.lat IS NOT NULL
        THEN ceil((public._metros_entre(du.lat, du.lng, s.lat, s.lng) / 1000.0 * v_min_por_km))::int
      END AS eta_regreso_min
    FROM public.driver_ubicaciones du
    JOIN public.empleados e ON e.id = du.empleado_id
    LEFT JOIN public.sucursales s ON s.id = e.sucursal_id
    WHERE du.en_linea = true
      AND du.updated_at > now() - interval '30 minutes'
      AND du.lat IS NOT NULL
  ) m;

  RETURN jsonb_build_object(
    'ok', true, 'ts', now(),
    'pedidos', v_pedidos,
    'motoristas', v_motoristas,
    'sucursales', v_sucursales,
    'pedidos_sin_ubicacion', v_pedidos_sin_ubicacion,
    'config', jsonb_build_object('min_por_km', v_min_por_km, 'ventana_gps_min', 30)
  );
END;
$function$;

revoke all on function public.fn_ruta_recalcular(uuid) from public, anon, authenticated;
revoke all on function public.trg_ruta_delivery() from public, anon, authenticated;

-- Arrancar con los pedidos que ya están activos
do $$
declare m uuid;
begin
  for m in select distinct motorista_id from public.delivery_clientes
            where motorista_id is not null and estado in ('preparando','lista','en_camino') loop
    perform public.fn_ruta_recalcular(m);
  end loop;
end $$;
