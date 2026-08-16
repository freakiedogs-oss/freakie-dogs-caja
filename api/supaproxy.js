// Edge Function de Vercel que hace proxy transparente a Supabase.
// Se accede vía rewrite en vercel.json:
//   /api/sb/:path*  →  /api/supaproxy?_p=:path*
// El cliente supabase-js usa URL base /api/sb y no necesita saber del rewrite.
//
// Motivo: algunos ISPs/WiFis en El Salvador (y ciertos DNS) están bloqueando
// la resolución DNS de *.supabase.co. Al pasar por vercel.app, la PWA funciona
// en todas las redes sin pedirle al usuario cambiar DNS.

// ── Gate de finanzas (SEG-1 Capa 2) ──
// El ERP entero pega como `anon`, y la anon key es PÚBLICA (viaja en el bundle).
// Por eso los objetos de finanzas NO se le abren a anon: el proxy exige una
// sesión de staff (la misma "torre": `staff_sesiones` + `erp_admin_sesion`) y
// recién ahí cambia la llave por el token del rol privado `erp_finanzas_ro`,
// que es de SOLO LECTURA y no puede ver la columna `pin` de usuarios_erp.
//
// Los objetos de esta lista HOY YA devuelven `permission denied` para anon
// (las Capas 0/1 revocaron las tablas base y rompieron de rebote las vistas
// `security_invoker`). Ponerles candado no puede romper nada que funcione:
// solo puede arreglar. Las tablas que hoy SÍ se leen (`compras_dte`,
// `empleados`, `bank_transacciones`) van en una segunda tanda, porque las
// usa también Almacén.

export const config = {
  runtime: 'edge',
};

const SUPA_URL = 'https://btboxlwfqcbrdfrlnwln.supabase.co';

const FINANZAS_OBJETOS = new Set([
  'v_gastos_consolidados',
  'v_ventas_sucursal_diario',
  'v_peya_peso_mensual',
  'v_pl_pagado_categoria_mensual',
  'v_bank_saldos_consolidados',
  'v_bank_tx_pendientes_match',
  'v_cobertura_cruce',
  'v_ajustes_cruce_resumen',
  'v_egresos_excluidos_pl',
  'v_prestamos_estado',
  'v_planilla_gerencial_pl',
]);

// Ojo: `staff_login` (torre de delivery) emite sesiones para roles que NO
// deben ver el P&L (telefono, despachador, gerente). Por eso acá se valida el
// ROL, no solo que la sesión exista.
const ROLES_FINANZAS = new Set(['admin', 'superadmin', 'ejecutivo']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cache corta de tokens ya validados: evita un viaje extra a la DB por request.
// El TTL es chico para que revocar una sesión surta efecto rápido.
const cacheSesion = new Map();
const CACHE_MS = 60_000;

function objetoDe(path) {
  const m = /^rest\/v1\/(?:rpc\/)?([a-zA-Z0-9_]+)/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

async function rolDeSesion(token, apikey) {
  if (!token || !UUID_RE.test(token)) return null;

  const cacheado = cacheSesion.get(token);
  if (cacheado && cacheado.hasta > Date.now()) return cacheado.rol;

  const url =
    `${SUPA_URL}/rest/v1/staff_sesiones?token=eq.${token}` +
    `&expira=gt.${encodeURIComponent(new Date().toISOString())}` +
    `&select=rol&limit=1`;

  try {
    const r = await fetch(url, {
      headers: {
        apikey,
        // El rol de finanzas SÍ puede leer staff_sesiones; anon NO (verificado).
        authorization: `Bearer ${process.env.SB_FINANZAS_TOKEN}`,
      },
    });
    if (!r.ok) return null;
    const filas = await r.json();
    const rol = Array.isArray(filas) && filas[0]?.rol ? String(filas[0].rol) : null;
    if (rol) cacheSesion.set(token, { rol, hasta: Date.now() + CACHE_MS });
    return rol;
  } catch {
    return null;
  }
}

function noAutorizado(motivo) {
  return new Response(
    JSON.stringify({
      code: 'FIN_SIN_SESION',
      message: motivo,
      hint: 'Ingresá tu PIN para abrir la sesión de finanzas.',
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
    }
  );
}

const STRIP_REQ_HEADERS = new Set([
  'host',
  'x-forwarded-host',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-vercel-forwarded-for',
  'x-vercel-id',
  'x-vercel-ip-country',
  'x-vercel-ip-country-region',
  'x-vercel-ip-city',
  'x-vercel-ip-latitude',
  'x-vercel-ip-longitude',
  'x-vercel-ip-timezone',
  'x-real-ip',
  'via',
  'forwarded',
]);

const STRIP_RES_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

export default async function handler(req) {
  const url = new URL(req.url);

  // El rewrite en vercel.json inyecta _p=<path>. También soportamos llamada
  // directa con ?_p=rest/v1/xxx.
  const rawPath = url.searchParams.get('_p') || '';
  url.searchParams.delete('_p');
  // Eliminar leading slash duplicado
  const path = rawPath.replace(/^\/+/, '');
  const qs = url.search; // ya sin _p
  const target = `${SUPA_URL}/${path}${qs}`;

  // Preflight CORS (probable que no haga falta, mismo origen)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'authorization, apikey, content-type, prefer, x-client-info, range, accept-profile, content-profile, x-torre-token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Construir headers para upstream
  const upstreamHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    if (!STRIP_REQ_HEADERS.has(key.toLowerCase())) {
      upstreamHeaders.set(key, value);
    }
  }

  // ── Gate de finanzas ──
  // El token de sesión nunca viaja a Supabase: se consume acá.
  const tokenTorre = upstreamHeaders.get('x-torre-token');
  upstreamHeaders.delete('x-torre-token');

  if (FINANZAS_OBJETOS.has(objetoDe(path))) {
    if (!process.env.SB_FINANZAS_TOKEN) {
      return noAutorizado('El gate de finanzas no está configurado en el servidor.');
    }
    const rol = await rolDeSesion(tokenTorre, upstreamHeaders.get('apikey'));
    if (!rol) {
      return noAutorizado('Sesión de finanzas ausente o vencida.');
    }
    if (!ROLES_FINANZAS.has(rol)) {
      return noAutorizado(`Tu rol (${rol}) no tiene acceso a finanzas.`);
    }
    // Cambiar la llave pública por el rol privado de solo lectura.
    upstreamHeaders.set('authorization', `Bearer ${process.env.SB_FINANZAS_TOKEN}`);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(target, {
      method: req.method,
      headers: upstreamHeaders,
      body: hasBody ? req.body : undefined,
      // @ts-ignore duplex requerido para streaming
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        proxy_error: 'upstream_fetch_failed',
        message: String(e?.message || e),
        target,
      }),
      {
        status: 502,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      }
    );
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (!STRIP_RES_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }
  responseHeaders.set('access-control-allow-origin', '*');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
