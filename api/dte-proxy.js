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

// Timeout upstream
const UPSTREAM_TIMEOUT_MS = 30_000;

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-pos-pin, x-pos-user-id',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * Valida PIN contra usuarios_erp via REST con service_role (bypassea RLS).
 * Retorna { id, nombre, rol, store_code } o null.
 */
async function validatePin(pin) {
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
    if (!Array.isArray(rows) || rows.length === 0) return null;
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

  // Validar PIN + rol
  const user = await validatePin(pin);
  if (!user) {
    await logOperation({ op, status: 'auth_fail', error: 'pin_invalid' });
    return jsonResponse(401, { success: false, error: 'invalid_pin' });
  }
  if (!POS_ROLES_OK.has((user.rol || '').toLowerCase())) {
    await logOperation({ op, user_id: user.id, store_code: user.store_code, status: 'auth_fail', error: `role_not_allowed:${user.rol}` });
    return jsonResponse(403, { success: false, error: 'role_not_allowed', rol: user.rol });
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
