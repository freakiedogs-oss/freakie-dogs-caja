-- ══════════════════════════════════════════════════════════════════════
-- Pagos online con tarjeta (pasarela n1co / EPay) para el delivery propio
-- ══════════════════════════════════════════════════════════════════════
--
-- Contexto: hoy el pedido web nace impago (`estado='recibida'`) y la torre
-- confirma el cobro a mano por WhatsApp. Esta migración agrega la vía de
-- cobro con tarjeta al momento del pedido, saltándose ese paso.
--
-- Principios de diseño (leer antes de tocar):
--
--  1. EL MONTO LO PONE LA BD, NUNCA EL NAVEGADOR. `pago_online_iniciar`
--     devuelve el `total` que ya guardó `crear_pedido_delivery` (que a su
--     vez revalidó precios contra el menú). El servidor cobra ese número.
--
--  2. NADIE MÁS QUE service_role. Las dos RPC son SECURITY DEFINER y se
--     les REVOCA execute a public/anon/authenticated. Si `pago_online_resolver`
--     quedara expuesta a anon, cualquiera marcaría pedidos como pagados =
--     comida gratis. Es el mismo razonamiento por el que `confirmar_pago_delivery`
--     nunca se le dio a anon.
--
--  3. FRENO A LAS PRUEBAS DE TARJETA. Un endpoint de tokenización abierto es
--     un regalo para quien valida tarjetas robadas a fuerza bruta. Cada intento
--     queda anclado a un pedido real, reciente y no pagado, con tope de intentos.
--
--  4. CERO DATOS DE TARJETA. Acá solo entra marca, últimos 4 y el token de
--     n1co. El PAN y el CVV no se guardan, no se loguean y no tocan Postgres.
--
-- Aplicada: 8-sep-2026 · branch feat/pago-tarjeta-n1co
-- ══════════════════════════════════════════════════════════════════════

-- ── Tabla de intentos ────────────────────────────────────────────────
create table if not exists public.pagos_online (
  id                 uuid primary key default gen_random_uuid(),
  delivery_id        uuid not null references public.delivery_clientes(id) on delete cascade,
  proveedor          text not null default 'n1co',
  ambiente           text not null default 'sandbox',   -- sandbox | produccion
  -- iniciado → requiere_3ds → aprobado | rechazado | error ; reembolsado es terminal
  estado             text not null default 'iniciado',
  monto              numeric(12,2) not null,
  intento            int  not null default 1,
  order_id           text,            -- el id de orden que mandamos a n1co
  card_id            text,            -- token de tarjeta (single-use) devuelto por n1co
  authentication_id  text,            -- id del 3DS, solo para el reintento
  authorization_code text,
  marca              text,            -- Visa / Mastercard
  last4              text,
  emisor             text,
  error_code         text,
  error_msg          text,
  raw                jsonb,           -- respuesta de n1co saneada (sin PAN/CVV)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint pagos_online_estado_ck
    check (estado in ('iniciado','requiere_3ds','aprobado','rechazado','error','reembolsado')),
  constraint pagos_online_ambiente_ck
    check (ambiente in ('sandbox','produccion'))
);

create index if not exists pagos_online_delivery_idx on public.pagos_online(delivery_id);
create index if not exists pagos_online_created_idx  on public.pagos_online(created_at desc);

-- Un solo pago aprobado por pedido. Es la red de seguridad final contra el
-- doble cobro: si el webhook y la respuesta síncrona corren a la vez, el
-- segundo choca acá en vez de cobrar dos veces.
create unique index if not exists pagos_online_un_aprobado_por_pedido
  on public.pagos_online(delivery_id) where estado = 'aprobado';

alter table public.pagos_online enable row level security;
-- Sin policies a propósito: la tabla es solo para service_role, que bypassa RLS.
revoke all on public.pagos_online from anon, authenticated;

comment on table public.pagos_online is
  'Intentos de cobro con tarjeta del delivery web (n1co/EPay). Sin datos de tarjeta: solo marca, últimos 4 y el token del proveedor.';


-- ── Abrir un intento de cobro ────────────────────────────────────────
-- Devuelve el monto autoritativo y los datos del cliente que la pasarela
-- necesita. Rechaza pedidos ya pagados, cancelados, viejos o con demasiados
-- intentos fallidos.
create or replace function public.pago_online_iniciar(p_tracking_token uuid, p_ambiente text default 'sandbox')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  MAX_INTENTOS constant int := 5;
  VENTANA      constant interval := interval '3 hours';
  v_ped   public.delivery_clientes%rowtype;
  v_n     int;
  v_pago  uuid;
  v_order text;
begin
  select * into v_ped
    from public.delivery_clientes
   where tracking_token = p_tracking_token
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  -- Ya cobrado (por tarjeta o por la torre): no se vuelve a cobrar.
  if v_ped.cobrado or v_ped.pos_cuenta_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ya_pagado',
                              'numero_orden', v_ped.numero_orden);
  end if;

  if v_ped.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'motivo', 'cancelado');
  end if;

  -- Un pedido de ayer no se paga hoy: la cocina ya no lo espera.
  if v_ped.created_at < now() - VENTANA then
    return jsonb_build_object('ok', false, 'motivo', 'expirado');
  end if;

  if coalesce(v_ped.total, 0) <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'monto_invalido');
  end if;

  select count(*) into v_n from public.pagos_online where delivery_id = v_ped.id;
  if v_n >= MAX_INTENTOS then
    return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos');
  end if;

  -- El order id lleva el intento: n1co exige unicidad y un reintento tras un
  -- rechazo reusaría el mismo número de orden.
  v_order := v_ped.numero_orden || '-' || (v_n + 1)::text;

  insert into public.pagos_online(delivery_id, monto, intento, order_id, ambiente)
  values (v_ped.id, v_ped.total, v_n + 1, v_order,
          case when p_ambiente = 'produccion' then 'produccion' else 'sandbox' end)
  returning id into v_pago;

  return jsonb_build_object(
    'ok', true,
    'pago_id', v_pago,
    'delivery_id', v_ped.id,
    'order_id', v_order,
    'intento', v_n + 1,
    'intentos_restantes', MAX_INTENTOS - (v_n + 1),
    'monto', v_ped.total,                 -- ← el único monto que se cobra
    'numero_orden', v_ped.numero_orden,
    'cliente_nombre', v_ped.cliente_nombre,
    'cliente_telefono', v_ped.cliente_telefono,
    'sucursal_id', v_ped.sucursal_id,
    'tipo', v_ped.tipo
  );
end;
$function$;


-- ── Cerrar un intento de cobro ───────────────────────────────────────
-- Si aprueba: marca el pedido cobrado y lo comanda a cocina (mismo camino
-- que usa la torre). Es idempotente: reentrar con un pago ya aprobado
-- devuelve el estado actual sin volver a comandar.
create or replace function public.pago_online_resolver(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_pago    public.pagos_online%rowtype;
  v_ped     public.delivery_clientes%rowtype;
  v_estado  text := p->>'estado';
  v_res     jsonb;
begin
  if v_estado not in ('requiere_3ds','aprobado','rechazado','error') then
    raise exception 'estado de pago inválido: %', v_estado;
  end if;

  select * into v_pago from public.pagos_online
   where id = (p->>'pago_id')::uuid for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pago_no_existe');
  end if;

  -- Ya resuelto como aprobado: no reprocesar (webhook + respuesta síncrona
  -- pueden llegar los dos).
  if v_pago.estado = 'aprobado' then
    select * into v_ped from public.delivery_clientes where id = v_pago.delivery_id;
    return jsonb_build_object('ok', true, 'ya_resuelto', true, 'estado', 'aprobado',
                              'pos_cuenta_id', v_ped.pos_cuenta_id);
  end if;

  update public.pagos_online set
    estado             = v_estado,
    card_id            = coalesce(nullif(p->>'card_id',''), card_id),
    authentication_id  = coalesce(nullif(p->>'authentication_id',''), authentication_id),
    authorization_code = coalesce(nullif(p->>'authorization_code',''), authorization_code),
    marca              = coalesce(nullif(p->>'marca',''), marca),
    last4              = coalesce(nullif(p->>'last4',''), last4),
    emisor             = coalesce(nullif(p->>'emisor',''), emisor),
    error_code         = nullif(p->>'error_code',''),
    error_msg          = left(coalesce(nullif(p->>'error_msg',''), ''), 500),
    raw                = coalesce(p->'raw', raw),
    updated_at         = now()
  where id = v_pago.id;

  if v_estado <> 'aprobado' then
    return jsonb_build_object('ok', true, 'estado', v_estado);
  end if;

  -- ── Aprobado: cobrar y comandar ──
  select * into v_ped from public.delivery_clientes where id = v_pago.delivery_id for update;

  update public.delivery_clientes
     set cobrado     = true,
         cobrado_at  = coalesce(cobrado_at, now()),
         metodo_pago = 'tarjeta'
   where id = v_ped.id;

  -- Sin sucursal ruteada (pedido fuera de cobertura) el pedido queda pagado
  -- pero sin comandar: la torre le asigna tienda y confirma. Cobrar bien y
  -- avisar vale más que reventar la transacción con la plata ya capturada.
  if v_ped.sucursal_id is null then
    return jsonb_build_object('ok', true, 'estado', 'aprobado',
                              'comandado', false, 'motivo', 'sin_sucursal');
  end if;

  if v_ped.pos_cuenta_id is not null then
    return jsonb_build_object('ok', true, 'estado', 'aprobado',
                              'comandado', true, 'pos_cuenta_id', v_ped.pos_cuenta_id);
  end if;

  v_res := public.confirmar_pago_delivery(v_ped.id, v_ped.sucursal_id, 'tarjeta');
  return jsonb_build_object('ok', true, 'estado', 'aprobado',
                            'comandado', true,
                            'pos_cuenta_id', v_res->'pos_cuenta_id');
end;
$function$;


-- ── Blindaje de permisos ─────────────────────────────────────────────
-- En Postgres una función nace ejecutable por PUBLIC. Sin estos REVOKE,
-- `pago_online_resolver` sería llamable con la anon key y cualquiera podría
-- marcar su pedido como pagado. Solo service_role (que no pasa por estos
-- grants) debe poder invocarlas.
revoke all on function public.pago_online_iniciar(uuid, text) from public, anon, authenticated;
revoke all on function public.pago_online_resolver(jsonb)     from public, anon, authenticated;

-- Ojo: ese REVOKE ... FROM public también deja afuera a service_role, que
-- heredaba el permiso por PUBLIC (no lo bypassa como hace con RLS). Hay que
-- devolvérselo explícito o la Edge Function recibe "permission denied".
grant execute on function public.pago_online_iniciar(uuid, text) to service_role;
grant execute on function public.pago_online_resolver(jsonb)     to service_role;
grant select, insert, update on table public.pagos_online         to service_role;

comment on function public.pago_online_iniciar(uuid, text) is
  'Abre un intento de cobro con tarjeta y devuelve el monto autoritativo del pedido. Solo service_role.';
comment on function public.pago_online_resolver(jsonb) is
  'Cierra un intento de cobro; si aprueba, marca cobrado y comanda a cocina. Idempotente. Solo service_role.';


-- ══════════════════════════════════════════════════════════════════════
-- 9-sep-2026 · El cobro online tiene que llegar a la CAJA
-- ══════════════════════════════════════════════════════════════════════
--
-- Hallazgo tras el primer cobro real: `_comanda_delivery` crea la `pos_cuenta`
-- pero NUNCA inserta en `pos_cuenta_pagos`. Los 839 delivery de los últimos 14
-- días los cerró alguien en el POS, uno por uno. Con el cobro online eso deja
-- dos agujeros:
--
--   1. Al cajero le aparece una cuenta ABIERTA por un pedido ya pagado. El
--      cliente llega a retirar y le cobran de nuevo — el mismo riesgo que ya
--      se cerró en la torre y en el motorista, entrando por otra puerta.
--   2. La venta no entra en los totales del corte.
--
-- Se registra con **`link_pago`**, que ya existe en el check de
-- `pos_cuenta_pagos` y ya sale en línea propia en `pos_corte`. No hizo falta
-- inventar un método nuevo: `link_pago` significa exactamente esto —plata que
-- entró por n1co en línea y NO por el datáfono de la sucursal— y es como se
-- registra hoy el link que manda Karina a mano.
--
-- Eso es lo que protege la conciliación: el total de `tarjeta` de cada tienda
-- sigue cuadrando al centavo contra su lote del datáfono, que es la señal con
-- la que se detectaron $499.76 de pagos duplicados.
--
-- Efecto secundario asumido: la cuenta queda `cobrada` desde el momento del
-- pago, así que el KDS no deja revertir una comanda de estos pedidos ("la
-- cuenta ya está cobrada"). A cambio, tampoco puede reabrirlas y recobrarlas
-- —el incidente de Usulután del 4-sep—, que es el riesgo más caro de los dos.
-- El KDS no se ve afectado de otra forma: lee `pos_cocina_queue` filtrando por
-- `estado <> 'completado'` y no mira `pos_cuentas`.
--
-- Verificado con arnés reversible: pago link_pago $4.00, cuenta `cobrada`,
-- idempotente ante un segundo resolver, y `pos_corte` lo suma en `link_pago`
-- dejando `tarjeta` en $0. La definición vigente de `pago_online_resolver`
-- está en la migración `pago_online_referencia_con_autorizacion`.
-- ══════════════════════════════════════════════════════════════════════
