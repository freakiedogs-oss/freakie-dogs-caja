-- ══════════════════════════════════════════════════════════════════
-- Aprobación de egresos de caja vía Telegram — esquema base
-- Aplicada en prod el 29-jul-2026 (migración `egresos_aprobacion_base`).
-- NACE APAGADA: sucursales.aprobacion_egresos = 'off' en todas.
--
-- Modelo: DM al gerente de la sucursal → escala al grupo a los 15 min.
-- El DM original sigue válido tras escalar (gana el primero que decida).
-- ══════════════════════════════════════════════════════════════════

-- 1. Store de secretos (patrón Eatalia). Solo service_role.
create table if not exists public.app_secretos (
  clave text primary key,
  valor text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secretos enable row level security;
revoke all on public.app_secretos from anon, authenticated;

-- 2. Allowlist de aprobadores (telegram_id ↔ usuario_erp). Solo service_role.
create table if not exists public.telegram_aprobadores (
  telegram_id bigint primary key,
  nombre text,
  usuario_id uuid references public.usuarios_erp(id),
  rol_aprobacion text not null default 'gerente'
    check (rol_aprobacion in ('gerente','ejecutivo')),
  store_code text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.telegram_aprobadores enable row level security;
revoke all on public.telegram_aprobadores from anon, authenticated;

-- 3. Interruptor por sucursal: off | sombra | bloqueante
alter table public.sucursales
  add column if not exists aprobacion_egresos text not null default 'off'
  check (aprobacion_egresos in ('off','sombra','bloqueante'));

-- 4. Solicitudes de egreso
create table if not exists public.egresos_solicitudes (
  id bigserial primary key,
  store_code text not null,
  turno_id uuid,
  fecha date not null default ((now() at time zone 'America/El_Salvador')::date),
  motivo_id uuid,
  motivo_nombre text,
  monto numeric not null check (monto > 0),
  persona_recibe text,
  empleado_id uuid,
  comentario text,
  foto_url text,
  solicitante_id uuid,
  solicitante_nombre text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','aprobado','denegado','cancelado')),
  modo text not null default 'sombra' check (modo in ('sombra','bloqueante')),
  aprobador_asignado_id uuid references public.usuarios_erp(id),
  aprobador_asignado_nombre text,
  aprobado_por text,
  aprobado_telegram_id bigint,
  resuelto_at timestamptz,
  escalado_at timestamptz,
  tg_dm_chat_id text,      tg_dm_message_id bigint,
  tg_grupo_chat_id text,   tg_grupo_message_id bigint,
  cierre_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists ix_egr_sol_pend on public.egresos_solicitudes (estado, created_at)
  where estado = 'pendiente';
create index if not exists ix_egr_sol_turno on public.egresos_solicitudes (store_code, fecha, turno_id);

alter table public.egresos_solicitudes enable row level security;
-- El POS (rol anon vía /sb) crea y consulta; NUNCA resuelve (eso solo por RPC service_role).
drop policy if exists egr_sol_anon_ins on public.egresos_solicitudes;
create policy egr_sol_anon_ins on public.egresos_solicitudes for insert to anon, authenticated with check (true);
drop policy if exists egr_sol_anon_sel on public.egresos_solicitudes;
create policy egr_sol_anon_sel on public.egresos_solicitudes for select to anon, authenticated using (true);
grant select, insert on public.egresos_solicitudes to anon, authenticated;
grant usage, select on sequence public.egresos_solicitudes_id_seq to anon, authenticated;

-- 5. Ruteo: gerente activo de la sucursal, EXCLUYENDO al solicitante.
--    Sin resultado ⇒ va directo al grupo. Cubre los dos huecos reales:
--    (a) sucursal sin gerente (S006 Metro Centro),
--    (b) el gerente pidiendo su propio egreso (S004: el gerente opera la caja).
create or replace function public.fn_egreso_aprobador(p_store_code text, p_solicitante_id uuid)
returns table (usuario_id uuid, nombre text)
language sql stable as $$
  select u.id, u.nombre
  from public.usuarios_erp u
  where u.rol = 'gerente'
    and u.activo is not false
    and u.store_code = p_store_code
    and (p_solicitante_id is null or u.id <> p_solicitante_id)
  order by u.nombre
  limit 1;
$$;

-- 6. Resolver (aprobar/denegar) desde Telegram. Anti doble-tap con FOR UPDATE.
create or replace function public.resolver_aprobacion_egreso(
  p_id bigint, p_telegram_id bigint, p_aprobador_fallback text, p_aprueba boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record; a record; v_nombre text; v_nuevo text;
begin
  select * into a from public.telegram_aprobadores where telegram_id = p_telegram_id and activo;
  if not found then return jsonb_build_object('error','no_autorizado'); end if;

  select * into v from public.egresos_solicitudes where id = p_id for update;
  if not found then return jsonb_build_object('error','no_existe'); end if;

  if v.estado <> 'pendiente' then
    return jsonb_build_object('error','ya_resuelta','estado',v.estado,'aprobado_por',v.aprobado_por);
  end if;

  -- Un ejecutivo (Jose/Cesar/Jazz) puede resolver cualquiera; un gerente, solo la suya.
  if not (a.rol_aprobacion = 'ejecutivo'
          or (v.aprobador_asignado_id is not null and a.usuario_id = v.aprobador_asignado_id)) then
    return jsonb_build_object('error','no_autorizado');
  end if;

  v_nombre := coalesce(a.nombre, p_aprobador_fallback, 'desconocido');
  v_nuevo  := case when p_aprueba then 'aprobado' else 'denegado' end;

  update public.egresos_solicitudes
     set estado = v_nuevo, aprobado_por = v_nombre,
         aprobado_telegram_id = p_telegram_id, resuelto_at = now()
   where id = p_id;

  return jsonb_build_object(
    'ok', true, 'id', v.id, 'estado', v_nuevo, 'aprobado_por', v_nombre,
    'monto', v.monto, 'motivo', v.motivo_nombre, 'store_code', v.store_code,
    'solicitante', v.solicitante_nombre, 'modo', v.modo,
    'tg_dm_chat_id', v.tg_dm_chat_id, 'tg_dm_message_id', v.tg_dm_message_id,
    'tg_grupo_chat_id', v.tg_grupo_chat_id, 'tg_grupo_message_id', v.tg_grupo_message_id
  );
end; $$;
revoke all on function public.resolver_aprobacion_egreso(bigint,bigint,text,boolean) from public, anon, authenticated;
