-- 11-nov-2026 — Límite de intentos de PIN en los proxies de Vercel
-- (api/dte-proxy.js y api/dte-email.js).
--
-- Por qué: validaban el PIN contra usuarios_erp sin tope de intentos; un script
-- recorría los 10.000 PINs de 4 dígitos en minutos. Las funciones serverless no
-- comparten memoria, así que el conteo de fallos por IP vive acá.
--
-- Regla: 8 fallos o más en 10 minutos desde una IP → esa IP queda bloqueada
-- hasta que los fallos salgan de la ventana. Solo cuentan los FALLOS: un PIN
-- válido nunca suma. El umbral es holgado porque todas las cajas de una
-- sucursal salen por la misma IP.
--
-- Los proxies fallan abierto: si estas funciones no existen o dan error, la
-- emisión de DTE sigue como antes. Aplicar esta migración activa el límite.

create table if not exists public.proxy_pin_intentos (
  id      bigint generated always as identity primary key,
  ip      text        not null,
  origen  text        not null,
  momento timestamptz not null default now()
);

create index if not exists proxy_pin_intentos_ip_momento_idx
  on public.proxy_pin_intentos (ip, momento desc);

-- RLS activado SIN políticas: solo service_role (que salta RLS) y las
-- funciones security definer de abajo tocan la tabla.
alter table public.proxy_pin_intentos enable row level security;
revoke all on table public.proxy_pin_intentos from public, anon, authenticated;

create or replace function public.proxy_pin_bloqueado(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 8
  from public.proxy_pin_intentos
  where ip = p_ip
    and momento > now() - interval '10 minutes';
$$;

create or replace function public.proxy_pin_fallo(p_ip text, p_origen text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ip is null or p_ip = '' then
    return;
  end if;

  insert into public.proxy_pin_intentos (ip, origen)
  values (left(p_ip, 64), left(coalesce(p_origen, ''), 64));

  -- Limpieza de paso: nada de esto sirve pasadas 24 horas.
  delete from public.proxy_pin_intentos
  where momento < now() - interval '24 hours';
end;
$$;

revoke all on function public.proxy_pin_bloqueado(text) from public, anon, authenticated;
revoke all on function public.proxy_pin_fallo(text, text) from public, anon, authenticated;
grant execute on function public.proxy_pin_bloqueado(text) to service_role;
grant execute on function public.proxy_pin_fallo(text, text) to service_role;

-- Que PostgREST vea las RPC nuevas sin esperar al próximo reinicio.
notify pgrst, 'reload schema';
