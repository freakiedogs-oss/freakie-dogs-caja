-- PeYa: la tienda se cierra en PedidosYa a la hora de cierre de cada sucursal.
--
-- 25-nov-2026, pedido de Jose. Hasta acá lo que cortaba los pedidos era el turno
-- de caja (`peya_auto_decidir` rechaza si no hay turno abierto), así que mientras
-- la caja siguiera abierta después de la hora de cierre podían seguir entrando
-- pedidos. Ahora:
--
--   · A la hora de cierre del día (`horarios_sucursal`, dia_semana 0 = domingo)
--     la tienda se cierra en PedidosYa con CLOSED_TODAY, motivo CLOSED.
--   · A la hora de apertura del día siguiente, si PedidosYa la sigue mostrando
--     cerrada POR ESE MISMO CIERRE, se reabre. Un cierre del gerente o de
--     PedidosYa nunca se toca.
--
-- `peya_horario_pendientes()` dice qué hay que hacer ahora; la Edge Function
-- `peya-horario` lo ejecuta contra PedidosYa y lo anota con
-- `peya_horario_marcar`. La acción no lleva PIN ni secreto a propósito: sólo
-- puede cerrar lo que ya pasó su hora de cierre o reabrir lo que ella misma
-- cerró, así que llamarla de más no hace daño. Un cron por minuto la dispara
-- sólo cuando hay algo pendiente.

alter table public.peya_vendor_map
  add column if not exists cierre_horario_fecha    date,         -- día en que se cerró por horario
  add column if not exists apertura_horario_fecha  date,         -- día en que se verificó/reabrió
  add column if not exists horario_intento_at      timestamptz,  -- último intento (freno de reintentos)
  add column if not exists horario_ultimo          jsonb;        -- resultado del último intento

-- Tiendas reales, activas y ya integradas (con plataformas conocidas): las cinco
-- que pasan el 30-nov entran solas cuando PedidosYa las active.
create or replace function public.peya_horario_pendientes()
returns table(remote_id text, accion text, store_code text, hora time, cierre_hasta timestamptz)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with ahora as (
    select (now() at time zone 'America/El_Salvador') as t
  ), v as (
    select v.remote_id, s.store_code, v.cierre_horario_fecha, v.apertura_horario_fecha,
           v.horario_intento_at, h.hora_apertura, h.hora_cierre,
           -- Próxima apertura (mañana) para fechar el cierre local.
           (select ((a.t::date + 1) + coalesce(h2.hora_apertura, h.hora_apertura))
                     at time zone 'America/El_Salvador'
              from public.horarios_sucursal h2
             where h2.sucursal_id = v.sucursal_id and h2.activo
               and h2.dia_semana = extract(dow from a.t::date + 1)::int
             limit 1) as proxima_apertura,
           a.t
      from public.peya_vendor_map v
      join public.sucursales s on s.id = v.sucursal_id
      cross join ahora a
      join public.horarios_sucursal h
        on h.sucursal_id = v.sucursal_id and h.activo
       and h.dia_semana = extract(dow from a.t)::int
     where v.activo and not v.es_pruebas
       and jsonb_array_length(coalesce(v.plataformas, '[]'::jsonb)) > 0
       and (v.horario_intento_at is null or v.horario_intento_at < now() - interval '2 minutes')
  )
  select v.remote_id, 'cerrar', v.store_code, v.hora_cierre,
         coalesce(v.proxima_apertura, now() + interval '12 hours')
    from v
   where v.t::time >= v.hora_cierre
     and v.cierre_horario_fecha is distinct from v.t::date
  union all
  select v.remote_id, 'abrir', v.store_code, v.hora_apertura, null
    from v
   where v.t::time >= v.hora_apertura and v.t::time < v.hora_cierre
     and v.cierre_horario_fecha is not null
     and v.cierre_horario_fecha < v.t::date
     and v.apertura_horario_fecha is distinct from v.t::date;
$$;

-- Anota el resultado. `p_ok` = PedidosYa aceptó (o no había nada que hacer).
create or replace function public.peya_horario_marcar(
  p_remote_id text, p_accion text, p_ok boolean,
  p_cierre_hasta timestamptz default null, p_detalle jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
  v_ahora timestamptz := now();
begin
  update public.peya_vendor_map
     set horario_intento_at = v_ahora,
         horario_ultimo = jsonb_build_object('accion', p_accion, 'ok', p_ok, 'at', v_ahora,
                                             'detalle', p_detalle)
   where remote_id = p_remote_id;

  if not p_ok then
    return jsonb_build_object('ok', false);
  end if;

  if p_accion = 'cerrar' then
    update public.peya_vendor_map
       set cierre_horario_fecha = v_hoy,
           cierres = jsonb_build_array(jsonb_build_object(
             'reason', 'CLOSED',
             'start', to_char(v_ahora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'end', case when p_cierre_hasta is not null
                         then to_char(p_cierre_hasta at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
             'changeable', true)),
           disponible = false, disponible_at = v_ahora,
           cierre_origen = 'horario', cierre_motivo = 'CLOSED',
           cerrada_hasta = p_cierre_hasta, cierre_changeable = true
     where remote_id = p_remote_id;
  elsif p_accion = 'abrir' then
    update public.peya_vendor_map
       set apertura_horario_fecha = v_hoy
     where remote_id = p_remote_id;
    -- Sólo se limpia el estado local si el cierre vigente era el nuestro.
    update public.peya_vendor_map
       set cierres = '[]'::jsonb, disponible = true, disponible_at = v_ahora,
           cierre_origen = null, cierre_motivo = null, cerrada_hasta = null
     where remote_id = p_remote_id and cierre_origen = 'horario'
       and coalesce((p_detalle->>'reabierta')::boolean, false);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.peya_horario_pendientes() from public, anon, authenticated;
revoke all on function public.peya_horario_marcar(text, text, boolean, timestamptz, jsonb) from public, anon, authenticated;
-- La Edge Function `peya-horario` entra con service_role.
grant execute on function public.peya_horario_pendientes() to service_role;
grant execute on function public.peya_horario_marcar(text, text, boolean, timestamptz, jsonb) to service_role;

-- El tick: sólo llama a la Edge Function cuando hay algo que hacer.
create or replace function public.peya_horario_tick()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  n integer;
begin
  select count(*) into n from public.peya_horario_pendientes();
  if n > 0 then
    perform net.http_post(
      url := 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/peya-horario',
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 55000);
  end if;
  return n;
end;
$$;

revoke all on function public.peya_horario_tick() from public, anon, authenticated;

select cron.schedule('peya_horario_tick', '* * * * *', 'select public.peya_horario_tick();');
