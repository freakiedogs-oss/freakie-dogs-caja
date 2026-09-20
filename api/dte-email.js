// api/dte-email.js
//
// Reenvío manual de un DTE ya emitido al correo del cliente, desde
// Finanzas → DTEs Emitidos.
//
// Por qué hace falta un proxy y no se llama a la Edge Function directo:
// `freakie-dte-email` se abre con el header `x-fn-secret`, y ese secreto no
// puede viajar en el bundle del browser (la anon key ya es pública; un segundo
// secreto en el mismo lugar sería un botón de "mandale correos a los clientes"
// para cualquiera con DevTools). Mismo patrón que `api/dte-proxy.js`: el
// secreto vive en el env de Vercel y el browser solo manda el PIN.
//
// Qué NO hace: no firma, no transmite y no emite nada ante Hacienda. El
// documento ya existe y ya tiene sello; esto solo vuelve a entregarlo. Por eso
// la Edge Function rechaza cualquier DTE sin `sello_recepcion`.
//
// El envío automático (pg_cron `freakie-dte-email-sweep`, cada 3 min) solo
// alcanza los DTE de las últimas 2 horas con correo en el receptor. Pasada esa
// ventana —o si el cliente dictó mal el correo— no había forma de reenviar.
// Esta es esa forma.
//
// Vars de entorno requeridas en Vercel:
//   FREAKIE_DTE_EMAIL_FN_SECRET — el mismo valor que la Edge Function espera en
//                                 `x-fn-secret` (está en los secrets de Supabase).
//   SUPABASE_URL                — https://btboxlwfqcbrdfrlnwln.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — para validar el PIN sin RLS.

export const config = {
  runtime: 'edge',
};

const SUPA_URL = (typeof process !== 'undefined' && process.env?.SUPABASE_URL)
  || 'https://btboxlwfqcbrdfrlnwln.supabase.co';

const FN_URL = (typeof process !== 'undefined' && process.env?.FREAKIE_DTE_EMAIL_URL)
  || `${SUPA_URL}/functions/v1/freakie-dte-email`;

// Reenviar un documento fiscal es una operación de gerencia, igual que emitirlo
// a mano: misma whitelist que usa `dte-proxy` para el origen `erp`. Una cajera
// no reenvía facturas del back-office.
const ROLES_OK = new Set(['admin', 'ejecutivo', 'superadmin', 'super']);

const UPSTREAM_TIMEOUT_MS = 30_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-pos-pin',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

/** Igual que en dte-proxy: PIN contra usuarios_erp con service_role. */
async function validatePin(pin) {
  const serviceKey = (typeof process !== 'undefined' && process.env?.SUPABASE_SERVICE_ROLE_KEY) || '';
  if (!serviceKey || !pin) return null;
  const url = `${SUPA_URL}/rest/v1/usuarios_erp?pin=eq.${encodeURIComponent(String(pin))}&activo=eq.true&select=id,nombre,apellido,rol,store_code&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch (_) {
    return null;
  }
}

/** Log best-effort en la misma tabla que el resto de las operaciones DTE. */
async function logOperation({ user_id, store_code, status, upstream_status, error }) {
  const serviceKey = (typeof process !== 'undefined' && process.env?.SUPABASE_SERVICE_ROLE_KEY) || '';
  if (!serviceKey) return;
  try {
    await fetch(`${SUPA_URL}/rest/v1/pos_dte_proxy_log`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        op: 'reenviar-email',
        user_id: user_id || null,
        store_code: store_code || null,
        status,
        upstream_status: upstream_status || null,
        error: error ? String(error).slice(0, 500) : null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch (_) {
    // best-effort: que falle el log no puede tumbar el reenvío
  }
}

/**
 * Mismo saneo que exige Hacienda para el correo del receptor (ASCII estricto).
 * Acá no es por MH —el documento ya está sellado— sino para no mandarle el
 * `to` crudo del browser a Gmail: si no parece un correo, no sale.
 */
function correoValido(s) {
  const v = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });

  const fnSecret = (typeof process !== 'undefined' && process.env?.FREAKIE_DTE_EMAIL_FN_SECRET) || '';
  if (!fnSecret) {
    // Se dice explícito en vez de fallar con un 401 del upstream: el modo de
    // falla "falta la variable en Vercel" no se puede confundir con "PIN malo".
    return jsonResponse(503, {
      ok: false,
      error: 'no_configurado',
      message: 'Falta FREAKIE_DTE_EMAIL_FN_SECRET en el servidor.',
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'invalid_json' });
  }

  const codigoGeneracion = String(body?.codigo_generacion || '').trim();
  if (!codigoGeneracion) return jsonResponse(400, { ok: false, error: 'codigo_generacion requerido' });

  // `to` es opcional. Sin él, la Edge Function usa el correo con el que se
  // facturó. Con él, se manda a otro lado — y eso es sacar un documento fiscal
  // con datos del cliente hacia una dirección que nadie validó, así que queda
  // registrado en el log con el usuario que lo pidió.
  let to = null;
  if (body?.to) {
    to = correoValido(body.to);
    if (!to) return jsonResponse(400, { ok: false, error: 'correo_invalido', message: 'Ese correo no tiene un formato válido.' });
  }

  const pin = req.headers.get('x-pos-pin') || body?.pin || '';
  const user = await validatePin(pin);
  if (!user) {
    await logOperation({ status: 'auth_fail', error: 'pin_invalid' });
    return jsonResponse(401, { ok: false, error: 'pin_invalido', message: 'PIN incorrecto.' });
  }
  const rol = String(user.rol || '').toLowerCase();
  if (!ROLES_OK.has(rol)) {
    await logOperation({ user_id: user.id, store_code: user.store_code, status: 'auth_fail', error: `role_not_allowed:${rol}` });
    return jsonResponse(403, { ok: false, error: 'rol_no_autorizado', message: `Tu rol (${rol}) no puede reenviar DTE.` });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstreamRes;
  try {
    upstreamRes = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fn-secret': fnSecret },
      body: JSON.stringify(to ? { codigo_generacion: codigoGeneracion, to } : { codigo_generacion: codigoGeneracion }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err?.name === 'AbortError';
    await logOperation({
      user_id: user.id, store_code: user.store_code,
      status: isAbort ? 'upstream_timeout' : 'upstream_error',
      error: String(err?.message || err),
    });
    return jsonResponse(502, { ok: false, error: isAbort ? 'upstream_timeout' : 'upstream_error', message: String(err?.message || err) });
  }
  clearTimeout(timer);

  const text = await upstreamRes.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: 'upstream_invalid_json', raw: text.slice(0, 500) };
  }

  await logOperation({
    user_id: user.id,
    store_code: user.store_code,
    status: data?.ok ? 'ok' : 'upstream_reject',
    upstream_status: upstreamRes.status,
    error: data?.ok ? null : (data?.error || data?.message || null),
  });

  // La Edge Function contesta 200 con ok:false cuando el receptor no tiene
  // correo (no es un error del servidor, es que no hay nada que enviar). Se
  // reenvía tal cual para que la UI pueda decirlo con esas palabras.
  return new Response(JSON.stringify(data), {
    status: upstreamRes.status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}
