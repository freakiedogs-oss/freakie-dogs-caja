// api/n1co-link.js
//
// Cobro con tarjeta del delivery web usando el **CheckoutLink API** de n1co:
// generamos un link de pago, mandamos al cliente a la página de n1co, y él pone
// la tarjeta allá. Es la vía preferida sobre el formulario propio de
// `api/n1co.js` por dos razones:
//
//   · Es self-service: la llave sale de portal.n1co.shop → Ajustes → Opciones
//     de desarrollador → Checkout Link. No hay que esperar a que el equipo de
//     n1co habilite credenciales de API.
//   · El número de tarjeta NUNCA toca nuestros servidores, así que Freakie Dogs
//     se queda fuera del alcance PCI que impone tener el formulario propio.
//
// Operaciones (POST /api/n1co-link/<op>):
//   crear    → { tracking_token }  abre el intento y devuelve el paymentLinkUrl
//   estado   → { pago_id }         consulta a n1co y confirma si ya pagó
//   webhook  → n1co nos avisa (firmado con HMAC-SHA256)
//
// Vars de entorno en Vercel:
//   N1CO_CHECKOUT_SECRET   — llave secreta del Checkout Link (portal n1co)
//   N1CO_WEBHOOK_SECRET    — llave del webhook (portal n1co). Si falta, el
//                            webhook se rechaza entero: sin firma no se confía.
//   N1CO_PAY_BASE_URL      — default https://api-pay-sandbox.n1co.shop/api
//   N1CO_AMBIENTE          — 'sandbox' | 'produccion' (default sandbox)
//   N1CO_LOCATION_CODE     — opcional acá; el link funciona sin él
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'edge' };

const env = (k, def = '') =>
  (typeof process !== 'undefined' && process.env?.[k]) || def;

const PAY_BASE = env('N1CO_PAY_BASE_URL', 'https://api-pay-sandbox.n1co.shop/api').replace(/\/+$/, '');
const AMBIENTE = env('N1CO_AMBIENTE', 'sandbox') === 'produccion' ? 'produccion' : 'sandbox';
const SUPA_URL = env('SUPABASE_URL', 'https://btboxlwfqcbrdfrlnwln.supabase.co');
const URL_DELIVERY = 'https://freakiedelivery.vercel.app';

const ALLOWED_OPS = new Set(['crear', 'estado', 'webhook']);
const TIMEOUT_MS = 20_000;

// El link vence solo. 45 min alcanza de sobra para pagar y deja de ser cobrable
// mucho antes de que el pedido pierda sentido para la cocina.
const VENCE_MIN = 45;

const ORIGENES_OK = new Set([
  URL_DELIVERY,
  'https://freakie-dogs-caja.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  ...env('N1CO_ORIGENES').split(',').map(s => s.trim()).filter(Boolean),
]);

const origenValido = (o) =>
  !!o && (ORIGENES_OK.has(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o));

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origenValido(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(origin) },
  });
}

async function fetchConTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function leerJson(res) {
  const txt = await res.text();
  try { return txt ? JSON.parse(txt) : {}; } catch { return { _raw: txt.slice(0, 500) }; }
}

// ── Supabase con service_role ────────────────────────────────────────
const claveServicio = () => env('SUPABASE_SERVICE_ROLE_KEY');

async function rpc(fn, args) {
  const key = claveServicio();
  if (!key) throw new Error('falta SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetchConTimeout(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await leerJson(res);
  if (!res.ok) throw new Error(`rpc ${fn}: ${data?.message || res.status}`);
  return data;
}

async function pagosOnline(filtro) {
  const key = claveServicio();
  const cols = 'id,delivery_id,estado,monto,order_id,order_code,link_url,intento';
  const res = await fetchConTimeout(`${SUPA_URL}/rest/v1/pagos_online?${filtro}&select=${cols}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' },
  });
  const rows = await leerJson(res);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function parchearPago(pagoId, campos) {
  const key = claveServicio();
  await fetchConTimeout(`${SUPA_URL}/rest/v1/pagos_online?id=eq.${encodeURIComponent(pagoId)}`, {
    method: 'PATCH',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'content-type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(campos),
  });
}

// ── n1co CheckoutLink ────────────────────────────────────────────────
async function n1coPay(path, { method = 'POST', body } = {}) {
  const secret = env('N1CO_CHECKOUT_SECRET');
  if (!secret) { const e = new Error('sin_secret'); e.codigo = 'no_configurado'; throw e; }
  const res = await fetchConTimeout(`${PAY_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ok: res.ok, status: res.status, data: await leerJson(res) };
}

// ── Confirmar un pago contra el estado real de la orden ──────────────
// Se usa igual desde `estado` (el cliente volvió) y desde `webhook` (n1co
// avisó). Las dos rutas llegan a `pago_online_resolver`, que es idempotente,
// así que da lo mismo cuál gane la carrera.
async function confirmarContraN1co(pago) {
  if (pago.estado === 'aprobado') return { estado: 'aprobado', pago_id: pago.id };
  if (!pago.order_code) return { estado: pago.estado, pago_id: pago.id };

  const { ok, data } = await n1coPay(`/paymentlink/order/${encodeURIComponent(pago.order_code)}`, { method: 'GET' });
  if (!ok) return { estado: pago.estado, pago_id: pago.id };

  const st = String(data?.orderStatus || '').toUpperCase();

  if (st === 'PAID' || st === 'FINALIZED') {
    const res = await rpc('pago_online_resolver', {
      p: {
        pago_id: pago.id, estado: 'aprobado',
        authorization_code: data?.payment?.authorizationCode || null,
        marca: data?.payment?.cardBrand || data?.payment?.brand || null,
        last4: data?.payment?.last4 || data?.payment?.cardLast4 || null,
        raw: { orderStatus: st, orderCode: data?.orderCode, total: data?.total,
               voucherUrl: data?.payment?.voucherUrl || null },
      },
    });
    return {
      estado: 'aprobado', pago_id: pago.id,
      comandado: res?.comandado !== false,
      autorizacion: data?.payment?.authorizationCode || null,
      voucher: data?.payment?.voucherUrl || null,
    };
  }

  if (st === 'CANCELLED') {
    await rpc('pago_online_resolver', {
      p: { pago_id: pago.id, estado: 'rechazado', error_code: 'CANCELLED',
           error_msg: 'el cliente canceló el pago', raw: { orderStatus: st } },
    });
    return { estado: 'rechazado', pago_id: pago.id, mensaje: 'Cancelaste el pago.' };
  }

  return { estado: 'pendiente', pago_id: pago.id };
}

// ── Verificación de la firma del webhook ─────────────────────────────
// n1co manda X-H4B-Hmac-Sha256 = HMAC-SHA256 del cuerpo crudo con la llave del
// portal. Sin esto, cualquiera que adivine la URL marca pedidos como pagados.
async function firmaValida(cuerpoCrudo, firmaRecibida) {
  const secreto = env('N1CO_WEBHOOK_SECRET');
  if (!secreto || !firmaRecibida) return false;

  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpoCrudo)),
  );

  let b64 = '';
  for (const b of mac) b64 += String.fromCharCode(b);
  const esperadoB64 = btoa(b64);
  const esperadoHex = Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('');

  // La doc no dice si la firma viaja en base64 o hex, así que se aceptan las dos.
  return igualdadConstante(firmaRecibida.trim(), esperadoB64)
      || igualdadConstante(firmaRecibida.trim().toLowerCase(), esperadoHex);
}

// Comparar con === filtra por tiempo y deja medir la firma byte a byte.
function igualdadConstante(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req) {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);

  const url = new URL(req.url);
  const op = (url.searchParams.get('op') || url.pathname.split('/').filter(Boolean).pop() || '').trim();
  if (!ALLOWED_OPS.has(op)) return json(400, { ok: false, error: 'op_not_allowed', op }, origin);

  // El webhook necesita el cuerpo crudo para verificar la firma: parsearlo
  // antes rompería el HMAC.
  const crudo = await req.text();
  let body;
  try { body = crudo ? JSON.parse(crudo) : {}; }
  catch { return json(400, { ok: false, error: 'json_invalido' }, origin); }

  try {
    // ── webhook ──
    if (op === 'webhook') {
      const firma = req.headers.get('x-h4b-hmac-sha256') || '';
      if (!(await firmaValida(crudo, firma))) {
        console.error('[n1co-link] webhook con firma inválida');
        return json(401, { ok: false, error: 'firma_invalida' }, origin);
      }
      // `orderReference` es el order_id que nosotros generamos al abrir el intento.
      const ref = String(body?.orderReference || '');
      if (!ref) return json(200, { ok: true, ignorado: 'sin_orderReference' }, origin);

      const pago = await pagosOnline(`order_id=eq.${encodeURIComponent(ref)}`);
      if (!pago) return json(200, { ok: true, ignorado: 'pago_desconocido' }, origin);

      // No se confía en el `type` del evento para dar por pagado: se relee la
      // orden desde n1co, que es la fuente de verdad.
      const out = await confirmarContraN1co(pago);
      return json(200, { ok: true, ...out }, origin);
    }

    // A partir de acá solo hablamos con nuestro propio front.
    if (origin && !origenValido(origin)) {
      return json(403, { ok: false, error: 'origen_no_permitido' }, origin);
    }

    // ── estado ──
    if (op === 'estado') {
      const pago = await pagosOnline(`id=eq.${encodeURIComponent(String(body?.pago_id || ''))}`);
      if (!pago) return json(404, { ok: false, error: 'no_existe' }, origin);
      const out = await confirmarContraN1co(pago);
      return json(200, { ok: true, ...out }, origin);
    }

    // ── crear ──
    const trackingToken = String(body?.tracking_token || '');
    if (!/^[0-9a-f-]{36}$/i.test(trackingToken)) {
      return json(400, { ok: false, error: 'pedido_invalido' }, origin);
    }

    // Igual que en el cobro directo: el intento se abre en la BD ANTES de hablar
    // con n1co, y de ahí sale el monto. El navegador no elige cuánto paga.
    const sesion = await rpc('pago_online_iniciar', {
      p_tracking_token: trackingToken, p_ambiente: AMBIENTE,
    });
    if (!sesion?.ok) {
      const motivos = {
        no_existe: 'No encontramos ese pedido.',
        ya_pagado: 'Este pedido ya está pagado.',
        cancelado: 'Este pedido fue cancelado.',
        expirado: 'El pedido venció. Hacelo de nuevo, por favor.',
        demasiados_intentos: 'Demasiados intentos. Escribinos por WhatsApp para ayudarte.',
        monto_invalido: 'No pudimos calcular el total del pedido.',
      };
      return json(409, {
        ok: false, error: sesion?.motivo || 'no_disponible',
        mensaje: motivos[sesion?.motivo] || 'No pudimos iniciar el cobro.',
      }, origin);
    }

    // A dónde vuelve el cliente. Sale del Origin ya validado, no de un campo del
    // body: si no, cualquiera generaría links que devuelven a su propio sitio.
    const base = origenValido(origin) ? origin : URL_DELIVERY;
    const volver = (r) => `${base}/menu?pago=${r}&t=${trackingToken}&p=${sesion.pago_id}`;

    const { ok, status, data } = await n1coPay('/paymentlink/checkout', {
      body: {
        orderReference: sesion.order_id,
        orderName: `Pedido ${sesion.numero_orden}`,
        orderDescription: `Freakie Dogs · ${sesion.tipo === 'para_llevar' ? 'Retiro en tienda' : 'Delivery'}`,
        amount: Number(sesion.monto),
        successUrl: volver('ok'),
        cancelUrl: volver('cancelado'),
        expirationMinutes: VENCE_MIN,
        ...(env('N1CO_LOCATION_CODE') ? { locationCode: env('N1CO_LOCATION_CODE') } : {}),
        metadata: [
          { key: 'numero_orden', value: sesion.numero_orden },
          { key: 'delivery_id', value: String(sesion.delivery_id) },
        ],
      },
    });

    if (!ok || !data?.paymentLinkUrl) {
      await rpc('pago_online_resolver', {
        p: { pago_id: sesion.pago_id, estado: 'error',
             error_code: `HTTP_${status}`,
             error_msg: String(data?.message || data?._raw || 'sin paymentLinkUrl') },
      });
      return json(502, { ok: false, error: 'upstream',
        mensaje: 'No pudimos abrir el pago con tarjeta. Probá de nuevo o elegí efectivo.' }, origin);
    }

    await parchearPago(sesion.pago_id, {
      metodo: 'link',
      order_code: data.orderCode || null,
      link_url: data.paymentLinkUrl,
    });

    return json(200, {
      ok: true,
      pago_id: sesion.pago_id,
      url: data.paymentLinkUrl,
      numero_orden: sesion.numero_orden,
      monto: Number(sesion.monto),
    }, origin);
  } catch (err) {
    if (err?.codigo === 'no_configurado') {
      // El front lo usa para caer al formulario propio, si ese sí está configurado.
      return json(501, { ok: false, error: 'no_configurado',
        mensaje: 'El pago con tarjeta todavía no está habilitado.' }, origin);
    }
    console.error('[n1co-link]', op, String(err?.message || err));
    return json(502, { ok: false, error: 'upstream',
      mensaje: 'No pudimos procesar el pago. Probá de nuevo o elegí efectivo.' }, origin);
  }
}
