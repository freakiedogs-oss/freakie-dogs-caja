-- ══════════════════════════════════════════════════════════════════════
-- Tarjetas guardadas del delivery web — atadas al dispositivo
-- ══════════════════════════════════════════════════════════════════════
--
-- Objetivo: que el cliente que vuelve toque "Pagar con Visa ····1234" y no
-- teclee nada. La tarjeta la guarda n1co (token multi-uso, `singleUse:false`);
-- acá solo vive el token, la marca y los últimos 4.
--
-- ── Por qué "atada al dispositivo" y no al teléfono ──
--
-- El menú público corre con la anon key y ya identifica al cliente por el
-- teléfono guardado en su propio navegador. Si la tarjeta guardada se buscara
-- POR TELÉFONO, cualquiera escribiría el número de otro y pediría comida a su
-- casa cobrándosela a la tarjeta ajena. El teléfono es un identificador
-- público, no una credencial.
--
-- Por eso la llave es un secreto aleatorio (uuid v4, 122 bits) que se genera en
-- el navegador del cliente y no sale de ahí. Nosotros guardamos solo su
-- **SHA-256**: si alguien se lleva esta tabla, no puede cobrarle a nadie —
-- necesitaría el secreto original, que no es adivinable ni está acá.
-- Mismo patrón que las api_keys del dte_service.
--
-- Consecuencias aceptadas: si el cliente cambia de teléfono o borra los datos
-- del navegador, reingresa la tarjeta una vez. Y quien le robe el teléfono
-- desbloqueado puede pedir comida — el mismo riesgo que cualquier app de
-- delivery con tarjeta guardada.
--
-- Aplicada: 8-sep-2026 · branch feat/pago-tarjeta-n1co
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.tarjetas_guardadas (
  id                uuid primary key default gen_random_uuid(),
  -- SHA-256 en hex del secreto del dispositivo. Nunca el secreto en claro.
  dispositivo_hash  text not null,
  proveedor         text not null default 'n1co',
  -- Token multi-uso de n1co. No es un número de tarjeta: sirve solo con
  -- nuestras credenciales y contra nuestro comercio.
  card_id           text not null,
  customer_id       text not null,
  -- Se guardan para no volver a pedírselos en la próxima compra.
  telefono          text,
  titular           text,
  email             text,
  marca             text,
  last4             text,
  emisor            text,
  vence_mes         text,
  vence_anio        text,
  activa            boolean not null default true,
  ultimo_uso        timestamptz,
  created_at        timestamptz not null default now(),
  constraint tarjetas_guardadas_last4_ck check (last4 is null or last4 ~ '^\d{4}$')
);

create index if not exists tarjetas_guardadas_disp_idx
  on public.tarjetas_guardadas(dispositivo_hash) where activa;

-- La misma tarjeta en el mismo dispositivo no se duplica si vuelve a pagar
-- tecleándola en vez de usar la guardada.
create unique index if not exists tarjetas_guardadas_unica
  on public.tarjetas_guardadas(dispositivo_hash, card_id);

alter table public.tarjetas_guardadas enable row level security;
-- Sin policies: solo service_role, desde la Edge Function.
revoke all on public.tarjetas_guardadas from anon, authenticated;

comment on table public.tarjetas_guardadas is
  'Tarjetas guardadas del menú web, atadas al dispositivo por el SHA-256 de un secreto local. Guarda el token de n1co, nunca el número de tarjeta.';


-- ── Listar las tarjetas de un dispositivo ────────────────────────────
-- NO devuelve card_id: lo que sale de acá va al navegador, y con el token
-- en mano cualquiera podría intentar cobrar. Solo lo cosmético.
create or replace function public.tarjetas_listar(p_dispositivo_hash text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'marca', t.marca, 'last4', t.last4,
    'vence', t.vence_mes || '/' || right(t.vence_anio, 2),
    'titular', t.titular, 'email', t.email
  ) order by t.ultimo_uso desc nulls last, t.created_at desc), '[]'::jsonb)
  from public.tarjetas_guardadas t
  where t.dispositivo_hash = p_dispositivo_hash and t.activa;
$function$;


-- ── Resolver el token para cobrar ────────────────────────────────────
-- Solo la llama la Edge Function. Exige que la tarjeta pertenezca a ESE
-- dispositivo: sin eso, conocer un uuid de tarjeta bastaría para cobrarla.
create or replace function public.tarjeta_para_cobro(p_dispositivo_hash text, p_tarjeta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_t public.tarjetas_guardadas%rowtype;
begin
  select * into v_t from public.tarjetas_guardadas
   where id = p_tarjeta_id and dispositivo_hash = p_dispositivo_hash and activa;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  update public.tarjetas_guardadas set ultimo_uso = now() where id = v_t.id;

  return jsonb_build_object('ok', true,
    'card_id', v_t.card_id, 'customer_id', v_t.customer_id,
    'titular', v_t.titular, 'email', v_t.email,
    'marca', v_t.marca, 'last4', v_t.last4);
end;
$function$;


-- ── Guardar una tarjeta después de un cobro aprobado ─────────────────
-- Se guarda SOLO si el cobro pasó: un token que el emisor rechazó no sirve
-- para la próxima compra y solo ensuciaría la lista del cliente.
create or replace function public.tarjeta_guardar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  insert into public.tarjetas_guardadas(
    dispositivo_hash, card_id, customer_id, telefono, titular, email,
    marca, last4, emisor, vence_mes, vence_anio, ultimo_uso)
  values (
    p->>'dispositivo_hash', p->>'card_id', p->>'customer_id',
    nullif(p->>'telefono',''), nullif(p->>'titular',''), nullif(p->>'email',''),
    nullif(p->>'marca',''), nullif(p->>'last4',''), nullif(p->>'emisor',''),
    nullif(p->>'vence_mes',''), nullif(p->>'vence_anio',''), now())
  on conflict (dispositivo_hash, card_id) do update
    set activa = true, ultimo_uso = now(),
        email  = coalesce(excluded.email, public.tarjetas_guardadas.email)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;


-- ── Olvidar una tarjeta ──────────────────────────────────────────────
-- Baja lógica: el token queda por si hay que rastrear un contracargo, pero
-- deja de ofrecerse y `tarjeta_para_cobro` ya no la resuelve.
create or replace function public.tarjeta_olvidar(p_dispositivo_hash text, p_tarjeta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.tarjetas_guardadas set activa = false
   where id = p_tarjeta_id and dispositivo_hash = p_dispositivo_hash;
  return jsonb_build_object('ok', found);
end;
$function$;


-- ── Blindaje de permisos ─────────────────────────────────────────────
-- Ninguna de estas es llamable con la anon key: todas pasan por la Edge
-- Function, que es la única que ve el secreto del dispositivo en claro.
-- Recordá que el REVOKE ... FROM public también deja afuera a service_role.
revoke all on function public.tarjetas_listar(text)          from public, anon, authenticated;
revoke all on function public.tarjeta_para_cobro(text, uuid) from public, anon, authenticated;
revoke all on function public.tarjeta_guardar(jsonb)         from public, anon, authenticated;
revoke all on function public.tarjeta_olvidar(text, uuid)    from public, anon, authenticated;

grant execute on function public.tarjetas_listar(text)          to service_role;
grant execute on function public.tarjeta_para_cobro(text, uuid) to service_role;
grant execute on function public.tarjeta_guardar(jsonb)         to service_role;
grant execute on function public.tarjeta_olvidar(text, uuid)    to service_role;
grant select, insert, update on table public.tarjetas_guardadas to service_role;
