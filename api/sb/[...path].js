// Edge Function de Vercel que hace proxy transparente a Supabase.
// Motivo: algunos ISPs en El Salvador (y ciertos DNS) están bloqueando la
// resolución de *.supabase.co. Al pasar por vercel.app (que sí resuelve en
// todas las redes), la PWA funciona sin pedirle al usuario cambiar DNS.
//
// Todas las llamadas a /api/sb/* se reenvían a
// https://btboxlwfqcbrdfrlnwln.supabase.co/* preservando método, headers y
// body. Así el SDK de supabase-js sigue funcionando igual.

export const config = {
  runtime: 'edge',
};

const SUPA_URL = 'https://btboxlwfqcbrdfrlnwln.supabase.co';

// Headers que NO debemos reenviar (identifican a Vercel/infra y confunden upstream)
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

// Headers que NO debemos devolver (content-encoding y length los maneja Vercel)
const STRIP_RES_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

export default async function handler(req) {
  const url = new URL(req.url);

  // /api/sb/rest/v1/usuarios_erp?... → /rest/v1/usuarios_erp?...
  const upstreamPath = url.pathname.replace(/^\/api\/sb/, '');
  const target = SUPA_URL + upstreamPath + url.search;

  // Preflight CORS — responder directo (Vercel same-origin, pero por si acaso)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'authorization, apikey, content-type, prefer, x-client-info, range, accept-profile, content-profile',
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

  // Body: streaming para soportar uploads grandes (fotos de cierres, etc.)
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(target, {
      method: req.method,
      headers: upstreamHeaders,
      body: hasBody ? req.body : undefined,
      // @ts-ignore — duplex es requerido cuando body es un ReadableStream
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

  // Copiar headers de respuesta
  const responseHeaders = new Headers();
  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (!STRIP_RES_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }
  // Asegurar CORS (mismo origen en realidad, pero no duele)
  responseHeaders.set('access-control-allow-origin', '*');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
