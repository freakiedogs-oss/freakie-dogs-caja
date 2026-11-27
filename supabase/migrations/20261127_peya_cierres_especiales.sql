-- PeYa: cierres puntuales programados (p. ej. «Black Freaky», 27-nov-2026: todas las
-- tiendas cerradas en PedidosYa hasta las 14:00).
--
-- Cada fila dice «esta tienda cerrada en PedidosYa entre `desde` y `hasta`». El cron
-- `peya_horario_tick` (cada minuto) llama a la Edge Function `peya-horario`, que:
--   · cierra con estado CLOSED y un motivo distinto de CLOSED (para que el cierre por
--     horario nunca lo confunda con el suyo y lo reabra a la hora de apertura);
--   · si PedidosYa la tiene cerrada por su propio horario (changeable:false), no
--     puede tocarla: reintenta cada minuto hasta que PedidosYa la abra y ahí la cierra;
--   · a la hora `hasta` la reabre, sólo si sigue cerrada con el motivo que puso.
-- Si la API rechaza la tienda (todavía no integrada: 401/403/404), queda en `fallo`
-- y no se insiste.

create table if not exists public.peya_cierres_especiales (
  id            bigserial primary key,
  remote_id     text not null,
  desde         timestamptz not null,
  hasta         timestamptz not null,
  motivo        text not null default 'OTHER',
  nota          text,
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','cerrada','abierta','fallo','vencida')),
  motivo_usado  text,
  cerrado_at    timestamptz,
  abierto_at    timestamptz,
  intento_at    timestamptz,
  ultimo        jsonb,
  created_at    timestamptz not null default now(),
  check (hasta > desde)
);
alter table public.peya_cierres_especiales enable row level security;

create or replace function public.peya_especial_pendientes()
returns table(id bigint, remote_id text, accion text, motivo text, motivo_usado text, hasta timestamptz)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id, c.remote_id,
         case when now() < c.hasta then 'cerrar' else 'abrir' end,
         c.motivo, c.motivo_usado, c.hasta
    from public.peya_cierres_especiales c
   where (c.intento_at is null or c.intento_at < now() - interval '50 seconds')
     and (
       (c.estado = 'pendiente' and now() >= c.desde and now() < c.hasta)
       or (c.estado = 'cerrada' and now() >= c.hasta)
     );
$$;

create or replace function public.peya_especial_marcar(
  p_id bigint, p_accion text, p_resultado text, p_motivo_usado text default null, p_detalle jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c record;
begin
  -- p_resultado: 'hecho' (cerró / reabrió), 'reintentar', 'fallo' (no insistir)
  update public.peya_cierres_especiales
     set intento_at = now(),
         ultimo = jsonb_build_object('accion', p_accion, 'resultado', p_resultado, 'at', now(), 'detalle', p_detalle)
   where id = p_id
  returning * into c;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;

  if p_resultado = 'fallo' then
    update public.peya_cierres_especiales set estado = 'fallo' where id = p_id;
  elsif p_accion = 'cerrar' and p_resultado = 'hecho' then
    update public.peya_cierres_especiales
       set estado = 'cerrada', cerrado_at = now(), motivo_usado = coalesce(p_motivo_usado, c.motivo)
     where id = p_id;
    -- Que la caja lo vea en la bandeja.
    update public.peya_vendor_map
       set cierres = jsonb_build_array(jsonb_build_object(
             'reason', coalesce(p_motivo_usado, c.motivo),
             'start', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'end', to_char(c.hasta at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'changeable', true)),
           disponible = false, disponible_at = now(),
           cierre_origen = 'pos', cierre_motivo = coalesce(p_motivo_usado, c.motivo),
           cerrada_hasta = c.hasta, cierre_changeable = true
     where remote_id = c.remote_id;
  elsif p_accion = 'abrir' and p_resultado = 'hecho' then
    update public.peya_cierres_especiales set estado = 'abierta', abierto_at = now() where id = p_id;
    update public.peya_vendor_map
       set cierres = '[]'::jsonb, disponible = true, disponible_at = now(),
           cierre_origen = null, cierre_motivo = null, cerrada_hasta = null
     where remote_id = c.remote_id and cierre_origen = 'pos'
       and cierre_motivo = coalesce(c.motivo_usado, c.motivo);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Lo que nunca llegó a cerrarse y ya pasó su hora queda como vencido.
create or replace function public.peya_horario_tick()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  n integer;
begin
  update public.peya_cierres_especiales set estado = 'vencida'
   where estado = 'pendiente' and now() >= hasta;
  select (select count(*) from public.peya_horario_pendientes())
       + (select count(*) from public.peya_especial_pendientes()) into n;
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

revoke all on table public.peya_cierres_especiales from anon, authenticated;
revoke all on function public.peya_especial_pendientes() from public, anon, authenticated;
revoke all on function public.peya_especial_marcar(bigint, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.peya_horario_tick() from public, anon, authenticated;
grant execute on function public.peya_especial_pendientes() to service_role;
grant execute on function public.peya_especial_marcar(bigint, text, text, text, jsonb) to service_role;
grant all on table public.peya_cierres_especiales to service_role;
grant usage on sequence public.peya_cierres_especiales_id_seq to service_role;
