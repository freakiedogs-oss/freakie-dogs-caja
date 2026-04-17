// Edge Function de Vercel que hace proxy transparente a Supabase.
// Se accede vía rewrite en vercel.json:
//   /api/sb/:path*  →  /api/supaproxy?_p=:path*
// El cliente supabase-js usa URL base /api/sb y no necesita saber del rewrite.
//
// Motivo: algunos ISPs/WiFis en El Salvador (y ciertos DNS) están bloqueando
// la resolución DNS de *.supabase.co. Al pasar por vercel.app, la PWA funciona
// en todas las redes sin pedirle al usuario cambiar DNS.

export const config = {
  runtime: 'edge',
};

const SUPA_URL = 'https://btboxlwfqcbrdfrlnwln.supabase.co';

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
