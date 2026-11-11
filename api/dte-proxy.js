// api/dte-proxy.js
//
// Edge Function de Vercel que actúa como proxy seguro al servicio DTE (DTEaaS).
// Reemplaza el patrón anterior donde DTE_API_KEY estaba hardcoded en el bundle
// del browser (P0 audit 24-may-2026).
//
// Flujo:
//   1. POS llama a /api/dte-proxy/{op}  (op ∈ whitelist)
//   2. Proxy valida PIN del usuario contra usuarios_erp (rol POS válido)
//   3. Proxy reenvía al DTE service con X-API-Key desde env
//   4. Proxy intenta log best-effort en pos_dte_proxy_log
//   5. Retorna la respuesta upstream tal cual
//
// Vars de entorno requeridas en Vercel:
//   DTE_API_KEY               — la API key del servicio DTE (la que estaba hardcoded)
//   DTE_BASE_URL              — opcional, default https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/dte-service
//   SUPABASE_URL              — https://btboxlwfqcbrdfrlnwln.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (NO anon) — para lookup en usuarios_erp sin RLS
//

export const config = {
  runtime: 'edge',
};

// ── Config ──
const DTE_BASE = (typeof process !== 'undefined' && process.env?.DTE_BASE_URL)
  || 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/dte-service';

const SUPA_URL = (typeof process !== 'undefined' && process.env?.SUPABASE_URL)
  || 'https://btboxlwfqcbrdfrlnwln.supabase.co';

// Whitelist estricta de operaciones permitidas
const ALLOWED_OPS = new Set([
  'emit-factura',
  'emit-ccf',
  'emit-sujeto-excluido',
  'emit-nota-credito',
  'invalidar',
]);

// Roles autorizados a emitir DTE desde POS
const POS_ROLES_OK = new Set([
  'cajero', 'cajera', 'gerente', 'admin', 'ejecutivo', 'superadmin', 'super',
]);

// Emisión desde el back-office (header X-DTE-Origen: erp). Más estricta que el
// POS a propósito: en la caja emite quien cobra, pero facturar a mano desde el
// ERP es una operación de gerencia. Sin este corte la restricción del front
// sería cosmética — bastaba el PIN de una cajera para emitir desde el ERP.
// `eventos` (1-oct-2026): factura a los clientes de eventos desde el ERP.
const ERP_ROLES_OK = new Set(['admin', 'ejecutivo', 'superadmin', 'super', 'eventos']);

// Timeout upstream
const UPSTREAM_TIMEOUT_MS = 30_000;

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-pos-pin, x-pos-user-id, x-dte-origen',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

// ── Límite de intentos de PIN por IP (11-nov-2026) ──
// Sin límite, un script recorría los 10.000 PINs de 4 dígitos en minutos. El
// conteo vive en la base (`proxy_pin_intentos`) porque las funciones no
// comparten memoria: 8 fallos en 10 minutos bloquean esa IP.
// FALLA ABIERTO: si el limitador da error, tarda, o la migración aún no está
// aplicada (404), la petición sigue como siempre. Nunca devuelve 5xx.
// Riesgo conocido: todas las cajas de una sucursal salen por la misma IP. Por
// eso el umbral es holgado y solo cuentan los fallos; el POS manda el PIN ya
// validado del usuario logueado, así que los fallos legítimos son raros.
const LIMITE_TIMEOUT_MS = 1500;

function ipCliente(req) {
  const h = req.headers;
  const ip = (
    h.get('x-real-ip')
    || (h.get('x-vercel-forwarded-for') || '').split(',')[0]
    || (h.get('x-forwarded-for') || '').split(',')[0]
    || ''
  ).trim();
  return ip && ip.length <= 64 ? ip : '';
}

// Devuelve el JSON de la RPC, o null ante CUALQUIER problema (falla abierto).
async function rpcLimite(fn, args) {
  const serviceKey = (typeof process !== 'undefined' && process.env?.SUPABASE_SERVICE_ROLE_KEY) || '';
  if (!serviceKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITE_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Solo un `true` literal bloquea; sin IP identificable no se limita.
async function ipBloqueada(ip) {
  if (!ip) return false;
  return (await rpcLimite('proxy_pin_bloqueado', { p_ip: ip })) === true;
}

async function registrarFallo(ip, origen) {
  if (!ip) return;
  await rpcLimite('proxy_pin_fallo', { p_ip: ip, p_origen: origen });
}

function demasiadosIntentos(extra) {
  const msg = 'Demasiados intentos. Esperá unos minutos.';
  // El texto va también en `error` porque el POS muestra ese campo tal cual.
  return new Response(JSON.stringify({ ...extra, error: msg, code: 'demasiados_intentos', message: msg }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'Retry-After': '600', ...CORS_HEADERS },
  });
}

/**
 * Valida PIN contra usuarios_erp via REST con service_role (bypassea RLS).
 * Retorna { id, nombre, rol, store_code } o null.
 * `info.noExiste` (11-nov-2026) distingue "ese PIN no existe" de "falló la
 * consulta": un error de red no debe contarle un intento fallido a la caja.
 */
async function validatePin(pin, info = {}) {
  const serviceKey = (typeof process !== 'undefined' && process.env?.SUPABASE_SERVICE_ROLE_KEY) || '';
  if (!serviceKey || !pin) return null;
  const url = `${SUPA_URL}/rest/v1/usuarios_erp?pin=eq.${encodeURIComponent(String(pin))}&activo=eq.true&select=id,nombre,apellido,rol,store_code&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    if (rows.length === 0) {
      info.noExiste = true;
      return null;
    }
    return rows[0];
  } catch (_) {
    return null;
  }
}

/**
 * Log best-effort. Si la tabla no existe o el insert falla, no rompe la operación.
 */
async function logOperation({ op, user_id, store_code, status, upstream_status, error }) {
  const serviceKey = (typeof process !== 'undefined' && process.env?.SUPABASE_SERVICE_ROLE_KEY) || '';
  if (!serviceKey) return;
  try {
    await fetch(`${SUPA_URL}/rest/v1/pos_dte_proxy_log`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        op,
        user_id: user_id || null,
        store_code: store_code || null,
        status,
        upstream_status: upstream_status || null,
        error: error ? String(error).slice(0, 500) : null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch (_) {
    // swallow
  }
}

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'method_not_allowed' });
  }

  // Extraer operación: /api/dte-proxy/emit-factura  o  ?op=emit-factura
  const url = new URL(req.url);
  let op = url.searchParams.get('op') || '';
  if (!op) {
    const parts = url.pathname.split('/').filter(Boolean);
    op = parts[parts.length - 1] || '';
  }
  op = op.replace(/^\/+/, '').trim();

  if (!ALLOWED_OPS.has(op)) {
    return jsonResponse(400, { success: false, error: 'op_not_allowed', op });
  }

  // Auth: PIN en X-POS-PIN o Authorization: PIN <pin>
  const pinHeader = req.headers.get('x-pos-pin') || '';
  let pin = pinHeader;
  if (!pin) {
    const auth = req.headers.get('authorization') || '';
    const m = auth.match(/^PIN\s+(.+)$/i);
    if (m) pin = m[1];
  }
  if (!pin) {
    return jsonResponse(401, { success: false, error: 'missing_pin' });
  }

  // Validar PIN + rol. El chequeo de bloqueo corre EN PARALELO con la consulta
  // del PIN para no sumarle latencia a la emisión (11-nov-2026); si la IP está
  // bloqueada se responde 429 sin mirar el resultado del PIN.
  const ip = ipCliente(req);
  const pinInfo = {};
  const [bloqueada, user] = await Promise.all([ipBloqueada(ip), validatePin(pin, pinInfo)]);
  if (bloqueada) {
    return demasiadosIntentos({ success: false });
  }
  // 11-nov-2026: "PIN no existe" y "rol no permitido" responden IGUAL (antes
  // 401 vs 403 + `rol`): la diferencia confirmaba qué PINs existen y de quién.
  // El detalle queda solo en el log del servidor.
  const noAutorizado = () => jsonResponse(401, {
    success: false,
    error: 'invalid_pin',
    message: 'PIN incorrecto o sin permiso para esta operación.',
  });
  if (!user) {
    await Promise.all([
      logOperation({ op, status: 'auth_fail', error: 'pin_invalid' }),
      pinInfo.noExiste ? registrarFallo(ip, `dte-proxy:${op}`) : null,
    ]);
    return noAutorizado();
  }
  const origen = (req.headers.get('x-dte-origen') || 'pos').toLowerCase();
  const rolesOk = origen === 'erp' ? ERP_ROLES_OK : POS_ROLES_OK;
  if (!rolesOk.has((user.rol || '').toLowerCase())) {
    await Promise.all([
      logOperation({ op, user_id: user.id, store_code: user.store_code, status: 'auth_fail', error: `role_not_allowed:${user.rol}:${origen}` }),
      registrarFallo(ip, `dte-proxy:${op}`),
    ]);
    return noAutorizado();
  }

  // Leer body del POS
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse(400, { success: false, error: 'invalid_json_body' });
  }

  // Server-side API key
  const apiKey = (typeof process !== 'undefined' && process.env?.DTE_API_KEY) || '';
  if (!apiKey) {
    await logOperation({ op, user_id: user.id, store_code: user.store_code, status: 'config_error', error: 'DTE_API_KEY_missing' });
    return jsonResponse(500, { success: false, error: 'proxy_misconfigured' });
  }

  // Forward al servicio DTE con timeout
  const target = `${DTE_BASE}/${op}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstreamRes;
  try {
    upstreamRes = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err?.name === 'AbortError';
    await logOperation({
      op, user_id: user.id, store_code: user.store_code,
      status: isAbort ? 'upstream_timeout' : 'upstream_error',
      error: String(err?.message || err),
    });
    return jsonResponse(502, {
      success: false,
      error: isAbort ? 'upstream_timeout' : 'upstream_error',
      message: String(err?.message || err),
    });
  }
  clearTimeout(timer);

  // Leer respuesta upstream y reenviarla
  let data;
  const text = await upstreamRes.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { success: false, error: 'upstream_invalid_json', raw: text.slice(0, 500) };
  }

  await logOperation({
    op,
    user_id: user.id,
    store_code: user.store_code,
    status: upstreamRes.ok && data?.success !== false ? 'ok' : 'upstream_reject',
    upstream_status: upstreamRes.status,
    error: data?.error || data?.message || null,
  });

  return new Response(JSON.stringify(data), {
    status: upstreamRes.status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}
