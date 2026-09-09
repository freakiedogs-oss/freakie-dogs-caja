// api/n1co.js
//
// Edge Function de Vercel: cobra con tarjeta los pedidos del delivery web
// contra la pasarela n1co (EPay). Sustituye el ida y vuelta por WhatsApp
// para coordinar el pago.
//
// Por qué existe un servidor en el medio y no se llama a n1co desde el browser:
//   · n1co autentica con clientId/clientSecret → Bearer. Ese secreto no puede
//     vivir en el bundle (misma lección que dejó DTE_API_KEY hardcodeada,
//     hallazgo P0 de mayo-2026).
//   · El monto a cobrar sale de la BD, no del navegador. Un cliente que edite
//     el JS podría, si no, pagar $1 un pedido de $30.
//   · El PAN entra acá, se reenvía a n1co y muere. No se loguea, no se guarda,
//     no se devuelve al front. Solo persisten marca, últimos 4 y el token.
//
// Operaciones (POST /api/n1co/<op>):
//   pagar          → { tracking_token, email, card{...}, billing? }
//                    abre el intento, tokeniza, cobra y comanda si aprueba.
//   confirmar-3ds  → { pago_id }
//                    reintenta el cobro con el authenticationId ya guardado,
//                    después de que el cliente completó el reto del banco.
//   estado         → { pago_id }  consulta idempotente, para recuperar la UI.
//
// Vars de entorno en Vercel:
//   N1CO_CLIENT_ID              — credencial de la plataforma n1co
//   N1CO_CLIENT_SECRET          — idem (jamás en el repo)
//   N1CO_BASE_URL               — default https://api-sandbox.n1co.shop
//   N1CO_AMBIENTE               — 'sandbox' | 'produccion' (default sandbox)
//   N1CO_LOCATION_CODE          — código de sucursal del Portal n1co (requerido)
//   N1CO_LOCATION_CODES         — opcional, JSON {"<sucursal_id>":"<code>"}
//   N1CO_ORIGENES               — opcional, orígenes extra permitidos (coma)
//   SUPABASE_URL                — https://btboxlwfqcbrdfrlnwln.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — para las RPC pago_online_* (no anon)

export const config = { runtime: 'edge' };

// ── Config ───────────────────────────────────────────────────────────
const env = (k, def = '') =>
  (typeof process !== 'undefined' && process.env?.[k]) || def;

// La doc de n1co publica la base CON la versión (`.../api/v3`) y nosotros la
// concatenamos en cada llamada, así que se le saca si vino incluida. Sin esto,
// pegar la URL tal cual de la doc pide `/api/v3/api/v3/Token` y da 404.
const N1CO_BASE = env('N1CO_BASE_URL', 'https://api-sandbox.n1co.shop')
  .replace(/\/+$/, '').replace(/\/api\/v\d+$/i, '');
const AMBIENTE = env('N1CO_AMBIENTE', 'sandbox') === 'produccion' ? 'produccion' : 'sandbox';
const SUPA_URL = env('SUPABASE_URL', 'https://btboxlwfqcbrdfrlnwln.supabase.co');

const ALLOWED_OPS = new Set([
  'pagar', 'confirmar-3ds', 'estado',
  'tarjetas', 'cobrar-guardada', 'olvidar',
]);
const UPSTREAM_TIMEOUT_MS = 30_000;

// ── Frenos para estrenar en producción ───────────────────────────────
// El sandbox de n1co no se pudo usar (entrar al modo sandbox cierra la sesión y
// devuelve a producción), así que la validación se hace con dinero real. Estos
// dos límites acotan el daño de cualquier error mientras se prueba.
//
// 1) Piloto por teléfono: con N1CO_TELEFONOS_PRUEBA seteada, SOLO esos números
//    pueden pagar con tarjeta; el resto ve efectivo como siempre. Es el
//    interruptor del lanzamiento suave — vacía, el pago queda abierto a todos.
const TELEFONOS_PILOTO = new Set(
  env('N1CO_TELEFONOS_PRUEBA').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean),
);

// 2) Techo por cobro: un pedido de delivery de smash burgers no llega a $150.
//    Si el monto lo supera, algo está muy mal (un total corrupto, un bug de
//    cantidades) y es mejor no cobrar que cobrar de más. Ajustable por env.
const MONTO_MAX = Number(env('N1CO_MONTO_MAX', '150')) || 150;

// Devuelve el motivo por el que NO se puede cobrar este pedido, o null si se
// puede. Se exporta solo para poder probarlo (scripts/test-frenos-n1co.mjs):
// decide si se cobra o no, y eso no se verifica leyéndolo.
export function frenoDeProduccion(sesion) {
  const tel = String(sesion?.cliente_telefono || '').replace(/\D/g, '');
  if (TELEFONOS_PILOTO.size > 0 && !TELEFONOS_PILOTO.has(tel)) {
    return {
      code: 'FUERA_DE_PILOTO',
      detalle: `tel ${tel.slice(0, 3)}***** no está en el piloto`,
      mensaje: 'El pago con tarjeta está en pruebas y todavía no está disponible. Elegí efectivo 💵',
    };
  }
  if (Number(sesion?.monto) > MONTO_MAX) {
    return {
      code: 'MONTO_SOBRE_TECHO',
      detalle: `monto ${sesion?.monto} > techo ${MONTO_MAX}`,
      mensaje: 'Tu pedido supera el máximo para pagar con tarjeta. Escribinos por WhatsApp y lo coordinamos 📲',
    };
  }
  return null;
}

// Orígenes que pueden llamar a este endpoint. El menú público vive en un
// dominio distinto al del ERP, así que no alcanza con same-origin.
// Los de freakiedogs.com son los definitivos (zona en Cloudflare, sirviendo
// desde Vercel); los .vercel.app quedan mientras se completa la mudanza.
// Cualquier subdominio nuevo se agrega con la env N1CO_ORIGENES sin tocar
// código; si falta, el navegador bloquea el cobro por CORS.
const ORIGENES_OK = new Set([
  'https://pedidos.freakiedogs.com',   // el menú público: de acá sale el cobro
  'https://freakiedogs.com',
  'https://www.freakiedogs.com',
  'https://erp.freakiedogs.com',
  'https://pos.freakiedogs.com',
  'https://freakiedelivery.vercel.app',
  'https://freakie-dogs-caja.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  ...env('N1CO_ORIGENES').split(',').map(s => s.trim()).filter(Boolean),
]);

// Previews de Vercel de ESTE repo. El patrón exige el nombre del proyecto:
// `https://<algo>.vercel.app` a secas habilita cualquier proyecto de cualquier
// cuenta de Vercel, y alcanzaba con desplegar uno propio para quedar dentro.
const PREVIEW_PROPIO = /^https:\/\/(freakiedelivery|freakie-dogs-caja)[a-z0-9-]*\.vercel\.app$/;
const esPreviewPropio = (origin) => PREVIEW_PROPIO.test(origin);

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  // Los previews de Vercel son dominios efímeros, así que se aceptan por patrón.
  // Pero acotado a NUESTROS proyectos: `[a-z0-9-]+\.vercel\.app` a secas deja
  // entrar cualquier proyecto de cualquier cuenta de Vercel.
  if (origin && (ORIGENES_OK.has(origin) || esPreviewPropio(origin))) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(origin) },
  });
}

// ── Token de n1co (cacheado por isolate) ─────────────────────────────
// expiresIn ronda la hora; se renueva 60 s antes para no cobrar con un token
// que expira en pleno vuelo.
let tokenCache = { value: '', expiraEn: 0 };

async function n1coToken() {
  const ahora = Date.now();
  if (tokenCache.value && ahora < tokenCache.expiraEn) return tokenCache.value;

  const clientId = env('N1CO_CLIENT_ID');
  const clientSecret = env('N1CO_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new ErrorConfig('faltan credenciales n1co');

  const res = await fetchConTimeout(`${N1CO_BASE}/api/v3/Token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const data = await leerJson(res);
  if (!res.ok || !data?.accessToken) {
    throw new ErrorConfig(`n1co no entregó token (HTTP ${res.status})`);
  }
  tokenCache = {
    value: data.accessToken,
    expiraEn: ahora + Math.max(30, Number(data.expiresIn || 3600) - 60) * 1000,
  };
  return tokenCache.value;
}

class ErrorConfig extends Error {}

async function fetchConTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function leerJson(res) {
  const txt = await res.text();
  try { return txt ? JSON.parse(txt) : {}; } catch { return { _raw: txt.slice(0, 500) }; }
}

async function n1co(path, body) {
  const token = await n1coToken();
  const res = await fetchConTimeout(`${N1CO_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok, data: await leerJson(res) };
}

// ── Supabase con service_role ────────────────────────────────────────
async function rpc(fn, args) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new ErrorConfig('falta SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetchConTimeout(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await leerJson(res);
  if (!res.ok) throw new Error(`rpc ${fn}: ${data?.message || res.status}`);
  return data;
}

async function leerPago(pagoId) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const cols = 'id,delivery_id,estado,monto,order_id,card_id,authentication_id,marca,last4,intento';
  const res = await fetchConTimeout(
    `${SUPA_URL}/rest/v1/pagos_online?id=eq.${encodeURIComponent(pagoId)}&select=${cols}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' } },
  );
  const rows = await leerJson(res);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ── Validación de tarjeta (antes de gastar un intento) ───────────────
function luhn(num) {
  let suma = 0, alterna = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alterna) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
    alterna = !alterna;
  }
  return suma % 10 === 0;
}

function validarTarjeta(card) {
  const numero = String(card?.number || '').replace(/\D/g, '');
  if (numero.length < 13 || numero.length > 19 || !luhn(numero)) {
    return { error: 'numero_invalido', mensaje: 'Revisá el número de la tarjeta' };
  }
  const mes = String(card?.expirationMonth || '').padStart(2, '0');
  const anio = String(card?.expirationYear || '');
  const mesN = Number(mes), anioN = Number(anio.length === 2 ? `20${anio}` : anio);
  if (!(mesN >= 1 && mesN <= 12) || !(anioN >= 2000 && anioN <= 2100)) {
    return { error: 'vencimiento_invalido', mensaje: 'Revisá el vencimiento' };
  }
  // Vence al cierre de su mes: comparamos contra el primer día del mes siguiente.
  const hoy = new Date();
  if (new Date(Date.UTC(anioN, mesN, 1)) <= hoy) {
    return { error: 'tarjeta_vencida', mensaje: 'La tarjeta está vencida' };
  }
  const cvv = String(card?.cvv || '').replace(/\D/g, '');
  if (cvv.length < 3 || cvv.length > 4) {
    return { error: 'cvv_invalido', mensaje: 'Revisá el código de seguridad' };
  }
  if (!String(card?.cardHolder || '').trim()) {
    return { error: 'titular_invalido', mensaje: 'Escribí el nombre como aparece en la tarjeta' };
  }
  return { numero, mes, anio: String(anioN), cvv };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── Identidad del dispositivo (para la tarjeta guardada) ─────────────
// El navegador manda un secreto aleatorio que solo él conoce; a Postgres nunca
// llega en claro, solo este hash. Así un volcado de `tarjetas_guardadas` no
// alcanza para cobrarle a nadie: haría falta el secreto original, que no está
// en la base y no es adivinable (uuid v4, 122 bits).
async function dispositivoHash(secreto) {
  const s = String(secreto || '');
  // Se exige forma de uuid para que no entre un "1" y termine compartiendo
  // tarjetas entre clientes distintos.
  if (!/^[0-9a-f-]{36}$/i.test(s)) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Mensajes al cliente: cortos, accionables y sin filtrar detalle del emisor
// (el detalle técnico queda en pagos_online.error_msg para soporte).
function mensajeRechazo(data) {
  const code = String(data?.error || data?.errorCode || '').toUpperCase();
  if (/INSUFFICIENT|FONDOS/.test(code)) return 'La tarjeta no tiene fondos suficientes.';
  if (/EXPIRED|VENCID/.test(code)) return 'La tarjeta está vencida.';
  if (/CVV|SECURITY/.test(code)) return 'El código de seguridad no coincide.';
  if (/STOLEN|LOST|FRAUD|RESTRICT/.test(code)) return 'Tu banco rechazó la tarjeta. Probá con otra.';
  return 'Tu banco rechazó el cobro. Probá con otra tarjeta o pagá en efectivo.';
}

function respuestaNoDisponible(sesion) {
  const motivos = {
    no_existe: 'No encontramos ese pedido.',
    ya_pagado: 'Este pedido ya está pagado.',
    cancelado: 'Este pedido fue cancelado.',
    expirado: 'El pedido venció. Hacelo de nuevo, por favor.',
    demasiados_intentos: 'Demasiados intentos. Escribinos por WhatsApp para ayudarte.',
    monto_invalido: 'No pudimos calcular el total del pedido.',
  };
  return {
    ok: false, error: sesion?.motivo || 'no_disponible',
    mensaje: motivos[sesion?.motivo] || 'No pudimos iniciar el cobro.',
  };
}

function locationCode(sucursalId) {
  try {
    const mapa = JSON.parse(env('N1CO_LOCATION_CODES', '{}'));
    if (sucursalId && mapa[sucursalId]) return String(mapa[sucursalId]);
  } catch { /* mapa mal formado: cae al default */ }
  return env('N1CO_LOCATION_CODE');
}

// Guarda lo que sirve para conciliar y para soporte. Nunca el PAN ni el CVV:
// n1co devuelve el bin (6 primeros) y nosotros ya teníamos los últimos 4.
function saneaRespuesta(data) {
  if (!data || typeof data !== 'object') return null;
  const { status, message, error, order, createdAt, authentication } = data;
  return {
    status, message, error, createdAt,
    order: order ? {
      id: order.id, amount: order.amount,
      authorizationCode: order.authorizationCode ?? order.authorization_code,
    } : undefined,
    // Del objeto de 3DS solo el id: la url es de un solo uso y no aporta al log.
    authentication: authentication ? { id: authentication.id } : undefined,
  };
}

// ── Cobro (compartido por `pagar` y `confirmar-3ds`) ─────────────────
async function cobrar({ pago, sesion, cardId, authenticationId, billing, email, customerId }) {
  const payload = {
    customer: {
      // Con tarjeta guardada se reusa el customer.id con el que n1co tokenizó
      // esa tarjeta; si no coincide, el token no resuelve.
      id: customerId || `SV${sesion.cliente_telefono}`,
      name: sesion.cliente_nombre || 'Cliente',
      email,
      phoneNumber: `+503${sesion.cliente_telefono}`,
    },
    order: {
      id: sesion.order_id,
      // El monto sale de pago_online_iniciar, que lo leyó de delivery_clientes.
      // Nunca del body del request.
      amount: Number(sesion.monto),
      name: `Pedido ${sesion.numero_orden}`,
      description: `Freakie Dogs · ${sesion.tipo === 'para_llevar' ? 'Retiro en tienda' : 'Delivery'}`,
    },
    cardId,
    locationCode: locationCode(sesion.sucursal_id),
    ...(authenticationId ? { authenticationId } : {}),
    ...(billing ? { billingInfo: billing } : {}),
  };

  const { data } = await n1co('/api/v3/Charges', payload);
  const status = String(data?.status || '').toUpperCase();

  if (status === 'AUTHENTICATION_REQUIRED' && data?.authentication?.url) {
    await rpc('pago_online_resolver', {
      p: {
        pago_id: pago, estado: 'requiere_3ds',
        card_id: cardId,
        authentication_id: data.authentication.id,
        raw: saneaRespuesta(data),
      },
    });
    return {
      estado: 'requiere_3ds',
      pago_id: pago,
      // La url del reto va al front porque tiene que renderizarse en el iframe.
      // El authenticationId se queda en la BD: el reintento lo toma de ahí.
      autenticacion_url: data.authentication.url,
    };
  }

  if (status === 'SUCCEEDED') {
    const res = await rpc('pago_online_resolver', {
      p: {
        pago_id: pago, estado: 'aprobado',
        card_id: cardId,
        authentication_id: authenticationId || null,
        authorization_code: data?.order?.authorizationCode ?? data?.order?.authorization_code ?? null,
        raw: saneaRespuesta(data),
      },
    });
    return {
      estado: 'aprobado',
      pago_id: pago,
      comandado: res?.comandado !== false,
      autorizacion: data?.order?.authorizationCode ?? null,
    };
  }

  await rpc('pago_online_resolver', {
    p: {
      pago_id: pago, estado: 'rechazado',
      card_id: cardId,
      error_code: String(data?.error || data?.errorCode || status || 'DESCONOCIDO'),
      error_msg: String(data?.message || ''),
      raw: saneaRespuesta(data),
    },
  });
  return { estado: 'rechazado', pago_id: pago, mensaje: mensajeRechazo(data) };
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req) {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' }, origin);
  }

  const url = new URL(req.url);
  let op = url.searchParams.get('op') || url.pathname.split('/').filter(Boolean).pop() || '';
  op = op.trim();
  if (!ALLOWED_OPS.has(op)) {
    return json(400, { ok: false, error: 'op_not_allowed', op }, origin);
  }

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'json_invalido' }, origin); }

  try {
    // ── estado ──
    if (op === 'estado') {
      const pago = await leerPago(String(body?.pago_id || ''));
      if (!pago) return json(404, { ok: false, error: 'no_existe' }, origin);
      return json(200, {
        ok: true, estado: pago.estado, pago_id: pago.id,
        marca: pago.marca, last4: pago.last4,
      }, origin);
    }

    // ── tarjetas guardadas + si el cobro está disponible ──
    // Devuelve solo lo cosmético (marca, últimos 4, vence). El token de n1co
    // NO sale de la BD: si viajara al navegador, cualquiera que lo capturara
    // podría intentar cobrar con él.
    //
    // Acá también se responde si ESTE pedido puede pagarse con tarjeta, y por
    // eso el front lo llama al abrir. Sin este chequeo previo, un cliente fuera
    // del piloto llenaba todo el formulario —tarjeta, CVV, correo— y solo
    // entonces le decíamos que no. El freno de `pagar` sigue en su lugar: este
    // es para la UI, no es la barrera.
    if (op === 'tarjetas') {
      const hash = await dispositivoHash(body?.dispositivo);
      const tarjetas = hash ? await rpc('tarjetas_listar', { p_dispositivo_hash: hash }) : [];

      let habilitado = true;
      let mensaje = null;
      // Código legible por máquina, aparte del mensaje para el cliente. Los
      // textos en español se parecen entre sí a propósito (todos terminan en
      // "elegí efectivo") y distinguirlos por el texto es frágil: el
      // verificador de despliegue llegó a reportar "faltan credenciales"
      // cuando en realidad el piloto estaba funcionando bien.
      let motivo = null;

      if (!env('N1CO_CLIENT_ID') || !env('N1CO_CLIENT_SECRET')) {
        habilitado = false;
        motivo = 'SIN_CREDENCIALES';
        mensaje = 'El pago con tarjeta no está disponible ahora. Elegí efectivo 💵';
      } else {
        // Dos momentos preguntan lo mismo:
        //  · el checkout, ANTES de crear el pedido → solo tiene el teléfono que
        //    el cliente tecleó, y sirve para no ofrecerle una opción que no va
        //    a poder usar;
        //  · el drawer de pago, con el pedido ya creado → manda el
        //    tracking_token, que es autoritativo y además trae el monto.
        const tt = String(body?.tracking_token || '');
        let sujeto = null;

        if (/^[0-9a-f-]{36}$/i.test(tt)) {
          const ped = await pedidoPorToken(tt);
          // Si no se encuentra el pedido no opinamos: `pagar` lo va a rechazar
          // con su propio motivo, más preciso que lo que podamos decir acá.
          if (ped) sujeto = { cliente_telefono: ped.cliente_telefono, monto: ped.total };
        } else {
          const tel = String(body?.telefono || '').replace(/\D/g, '');
          // Sin monto todavía: solo se evalúa el piloto. El techo se revisa
          // después, cuando el total lo puso la BD.
          if (tel.length === 8) sujeto = { cliente_telefono: tel, monto: 0 };
        }

        if (sujeto) {
          const f = frenoDeProduccion(sujeto);
          if (f) { habilitado = false; motivo = f.code; mensaje = f.mensaje; }
        }
      }

      return json(200, { ok: true, tarjetas: tarjetas || [], habilitado, motivo, mensaje }, origin);
    }

    // ── olvidar una tarjeta guardada ──
    if (op === 'olvidar') {
      const hash = await dispositivoHash(body?.dispositivo);
      if (!hash) return json(400, { ok: false, error: 'dispositivo_invalido' }, origin);
      const r = await rpc('tarjeta_olvidar', {
        p_dispositivo_hash: hash,
        p_tarjeta_id: String(body?.tarjeta_id || ''),
      });
      return json(200, { ok: !!r?.ok }, origin);
    }

    // ── cobrar con una tarjeta ya guardada ──
    // El camino de fricción cero: el cliente no teclea nada. El token sale de
    // la BD y solo si esa tarjeta pertenece a ESTE dispositivo.
    if (op === 'cobrar-guardada') {
      const trackingToken = String(body?.tracking_token || '');
      if (!/^[0-9a-f-]{36}$/i.test(trackingToken)) {
        return json(400, { ok: false, error: 'pedido_invalido' }, origin);
      }
      const hash = await dispositivoHash(body?.dispositivo);
      if (!hash) return json(400, { ok: false, error: 'dispositivo_invalido' }, origin);

      const tarjeta = await rpc('tarjeta_para_cobro', {
        p_dispositivo_hash: hash,
        p_tarjeta_id: String(body?.tarjeta_id || ''),
      });
      if (!tarjeta?.ok) {
        return json(404, { ok: false, error: 'tarjeta_no_disponible',
          mensaje: 'Esa tarjeta ya no está guardada. Ingresá los datos de nuevo.' }, origin);
      }

      const sesion = await rpc('pago_online_iniciar', {
        p_tracking_token: trackingToken, p_ambiente: AMBIENTE,
      });
      if (!sesion?.ok) return json(409, respuestaNoDisponible(sesion), origin);

      const frenoG = frenoDeProduccion(sesion);
      if (frenoG) {
        await rpc('pago_online_resolver', {
          p: { pago_id: sesion.pago_id, estado: 'error',
               error_code: frenoG.code, error_msg: frenoG.detalle },
        });
        return json(409, { ok: false, error: frenoG.code, mensaje: frenoG.mensaje }, origin);
      }

      if (!locationCode(sesion.sucursal_id)) {
        await rpc('pago_online_resolver', {
          p: { pago_id: sesion.pago_id, estado: 'error', error_code: 'SIN_LOCATION_CODE',
               error_msg: 'N1CO_LOCATION_CODE no configurado' },
        });
        return json(500, { ok: false, error: 'config',
          mensaje: 'El pago con tarjeta no está disponible ahora. Elegí efectivo.' }, origin);
      }

      const out = await cobrar({
        pago: sesion.pago_id, sesion,
        cardId: tarjeta.card_id,
        customerId: tarjeta.customer_id,
        email: tarjeta.email || '',
        billing: normalizarBilling(body?.billing),
      });
      await marcarTarjeta(sesion.pago_id, {
        marca: tarjeta.marca, last4: tarjeta.last4, emisor: null,
      });
      return json(200, { ok: true, ...out, marca: tarjeta.marca, last4: tarjeta.last4 }, origin);
    }

    // ── confirmar-3ds ──
    // El cliente solo avisa "terminé el reto". El authenticationId y el cardId
    // se leen de la BD: si vinieran del body, cualquiera podría inyectar el
    // id de una autenticación ajena.
    if (op === 'confirmar-3ds') {
      const pago = await leerPago(String(body?.pago_id || ''));
      if (!pago) return json(404, { ok: false, error: 'no_existe' }, origin);
      if (pago.estado === 'aprobado') {
        return json(200, { ok: true, estado: 'aprobado', pago_id: pago.id }, origin);
      }
      if (pago.estado !== 'requiere_3ds' || !pago.card_id || !pago.authentication_id) {
        return json(409, { ok: false, error: 'estado_invalido', estado: pago.estado }, origin);
      }
      // Todo sale de la BD. Nada del body salvo el correo y el billing, que no
      // afectan el monto ni a qué pedido se imputa el cobro.
      const sesion = {
        ...(await datosPedido(pago.delivery_id)),
        order_id: pago.order_id,
        monto: pago.monto,
      };
      const out = await cobrar({
        pago: pago.id, sesion,
        cardId: pago.card_id,
        authenticationId: pago.authentication_id,
        billing: normalizarBilling(body?.billing),
        email: String(body?.email || '').trim(),
      });

      // La tarjeta que pasó por 3DS se guarda acá, no en `pagar`: allá el cobro
      // todavía no estaba aprobado.
      const hash3ds = await dispositivoHash(body?.dispositivo);
      if (body?.guardar === true && hash3ds && out.estado === 'aprobado') {
        await guardarTarjeta({
          hash: hash3ds, cardId: pago.card_id,
          customerId: `SV${sesion.cliente_telefono}`,
          email: String(body?.email || '').trim(),
          telefono: sesion.cliente_telefono,
          titular: String(body?.titular || '').trim(),
          marca: pago.marca, last4: pago.last4,
          mes: String(body?.vence_mes || ''), anio: String(body?.vence_anio || ''),
        });
      }
      return json(200, { ok: true, ...out, guardada: body?.guardar === true && out.estado === 'aprobado' }, origin);
    }

    // ── pagar ──
    const trackingToken = String(body?.tracking_token || '');
    if (!/^[0-9a-f-]{36}$/i.test(trackingToken)) {
      return json(400, { ok: false, error: 'pedido_invalido' }, origin);
    }
    const email = String(body?.email || '').trim();
    if (!EMAIL_RE.test(email)) {
      return json(400, { ok: false, error: 'email_invalido',
        mensaje: 'Necesitamos un correo válido para enviarte el comprobante' }, origin);
    }

    const card = validarTarjeta(body?.card);
    if (card.error) {
      return json(400, { ok: false, error: card.error, mensaje: card.mensaje }, origin);
    }

    // Abrir el intento ANTES de tocar n1co: es lo que frena el uso del endpoint
    // como validador de tarjetas robadas (exige un pedido real, reciente, impago,
    // y topea los intentos por pedido).
    const sesion = await rpc('pago_online_iniciar', {
      p_tracking_token: trackingToken,
      p_ambiente: AMBIENTE,
    });
    if (!sesion?.ok) return json(409, respuestaNoDisponible(sesion), origin);

    const freno = frenoDeProduccion(sesion);
    if (freno) {
      await rpc('pago_online_resolver', {
        p: { pago_id: sesion.pago_id, estado: 'error',
             error_code: freno.code, error_msg: freno.detalle },
      });
      return json(409, { ok: false, error: freno.code, mensaje: freno.mensaje }, origin);
    }

    if (!locationCode(sesion.sucursal_id)) {
      await rpc('pago_online_resolver', {
        p: { pago_id: sesion.pago_id, estado: 'error', error_code: 'SIN_LOCATION_CODE',
             error_msg: 'N1CO_LOCATION_CODE no configurado' },
      });
      return json(500, { ok: false, error: 'config',
        mensaje: 'El pago con tarjeta no está disponible ahora. Elegí efectivo.' }, origin);
    }

    // Guardar la tarjeta exige un token multi-uso: con `singleUse: true` el
    // token muere en este cobro y no serviría para la próxima compra. Solo se
    // pide multi-uso si el cliente marcó guardar.
    const hashDisp = await dispositivoHash(body?.dispositivo);
    const guardar = body?.guardar === true && !!hashDisp;
    const customerId = `SV${sesion.cliente_telefono}`;

    // Tokenizar: acá muere el PAN.
    const tok = await n1co('/api/v3/PaymentMethods', {
      customer: {
        id: customerId,
        name: sesion.cliente_nombre || 'Cliente',
        email,
        phoneNumber: `+503${sesion.cliente_telefono}`,
      },
      card: {
        number: card.numero,
        cardHolder: String(body.card.cardHolder).trim(),
        expirationMonth: card.mes,
        expirationYear: card.anio,
        cvv: card.cvv,
        singleUse: !guardar,
      },
    });

    if (!tok.ok || !tok.data?.id) {
      await rpc('pago_online_resolver', {
        p: { pago_id: sesion.pago_id, estado: 'rechazado',
             error_code: String(tok.data?.error || `HTTP_${tok.status}`),
             error_msg: String(tok.data?.message || ''), raw: saneaRespuesta(tok.data) },
      });
      return json(200, { ok: true, estado: 'rechazado', pago_id: sesion.pago_id,
        mensaje: 'No pudimos validar la tarjeta. Revisá los datos o probá con otra.' }, origin);
    }

    const last4 = card.numero.slice(-4);
    const bin = tok.data.bin || {};

    // billingInfo es obligatorio solo para emisores de EE.UU. y Canadá, y el
    // país recién se conoce con el bin. Si hace falta y no vino, se le pide al
    // cliente en vez de gastar el intento en un rechazo seguro.
    const paisEmisor = String(bin.countryCode || '').toUpperCase();
    const billing = normalizarBilling(body?.billing);
    if (['USA', 'US', 'CAN', 'CA'].includes(paisEmisor) && !billing) {
      await rpc('pago_online_resolver', {
        p: { pago_id: sesion.pago_id, estado: 'error', card_id: tok.data.id,
             marca: bin.brand, last4, emisor: bin.issuerName,
             error_code: 'REQUIERE_BILLING', error_msg: `emisor ${paisEmisor}` },
      });
      return json(200, {
        ok: true, estado: 'requiere_billing', pago_id: sesion.pago_id,
        mensaje: 'Tu tarjeta es de EE.UU./Canadá: necesitamos el código postal de facturación.',
      }, origin);
    }

    // El resolver guarda marca/últimos4 aunque el cobro después falle: sirve
    // para que soporte sepa con qué tarjeta se intentó.
    const out = await cobrar({
      pago: sesion.pago_id, sesion,
      cardId: tok.data.id, customerId, billing, email,
    });
    await marcarTarjeta(sesion.pago_id, { marca: bin.brand, last4, emisor: bin.issuerName });

    // Se guarda SOLO si el cobro pasó: un token que el emisor rechazó no sirve
    // para la próxima compra y solo ensuciaría la lista del cliente.
    // Ojo: si quedó en 3DS, la tarjeta se guarda al confirmar, no acá.
    if (guardar && out.estado === 'aprobado') {
      await guardarTarjeta({
        hash: hashDisp, cardId: tok.data.id, customerId, email,
        telefono: sesion.cliente_telefono, titular: String(body.card.cardHolder).trim(),
        marca: bin.brand, last4, emisor: bin.issuerName, mes: card.mes, anio: card.anio,
      });
    }

    return json(200, {
      ok: true, ...out, marca: bin.brand || null, last4,
      guardada: guardar && out.estado === 'aprobado',
    }, origin);
  } catch (err) {
    const esConfig = err instanceof ErrorConfig;
    // El mensaje del error puede traer detalle de upstream; al cliente le va
    // uno genérico y el detalle se queda en el log del servidor.
    console.error('[n1co]', op, esConfig ? 'config' : 'error', String(err?.message || err));
    return json(esConfig ? 500 : 502, {
      ok: false,
      error: esConfig ? 'config' : 'upstream',
      mensaje: 'No pudimos procesar el pago. Probá de nuevo o elegí efectivo.',
    }, origin);
  }
}

// Datos del pedido para el reintento de 3DS (el primer intento los trae de
// pago_online_iniciar; acá hay que releerlos).
async function datosPedido(deliveryId) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const cols = 'numero_orden,cliente_nombre,cliente_telefono,sucursal_id,tipo,total';
  const res = await fetchConTimeout(
    `${SUPA_URL}/rest/v1/delivery_clientes?id=eq.${encodeURIComponent(deliveryId)}&select=${cols}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' } },
  );
  const rows = await leerJson(res);
  return Array.isArray(rows) && rows.length ? rows[0] : {};
}

// Best-effort a propósito: si falla, el cobro ya está aprobado y lo peor que
// pasa es que el cliente vuelva a teclear la tarjeta la próxima vez. Nunca
// romper un pago bueno por no poder guardar una comodidad.
async function guardarTarjeta({ hash, cardId, customerId, email, telefono, titular,
                                marca, last4, emisor, mes, anio }) {
  try {
    await rpc('tarjeta_guardar', {
      p: {
        dispositivo_hash: hash, card_id: cardId, customer_id: customerId,
        telefono: telefono || '', titular: titular || '', email: email || '',
        marca: marca || '', last4: last4 || '', emisor: emisor || '',
        vence_mes: mes || '', vence_anio: anio || '',
      },
    });
  } catch (e) {
    console.error('[n1co] no se pudo guardar la tarjeta:', String(e?.message || e));
  }
}

// Lectura liviana para el chequeo previo de disponibilidad. NO abre un intento
// de cobro: si usara `pago_online_iniciar`, con solo abrir el drawer el cliente
// quemaría uno de sus 5 intentos.
async function pedidoPorToken(trackingToken) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) return null;
  try {
    const res = await fetchConTimeout(
      `${SUPA_URL}/rest/v1/delivery_clientes?tracking_token=eq.${encodeURIComponent(trackingToken)}`
      + '&select=cliente_telefono,total&limit=1',
      { headers: { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' } },
    );
    const rows = await leerJson(res);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

async function marcarTarjeta(pagoId, { marca, last4, emisor }) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  try {
    await fetchConTimeout(`${SUPA_URL}/rest/v1/pagos_online?id=eq.${encodeURIComponent(pagoId)}`, {
      method: 'PATCH',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'content-type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ marca: marca || null, last4: last4 || null, emisor: emisor || null }),
    });
  } catch { /* best-effort: no romper un cobro aprobado por un dato de log */ }
}

function normalizarBilling(b) {
  if (!b) return null;
  const zip = String(b.zipCode || b.zip || '').trim();
  if (!zip) return null;
  return {
    countryCode: String(b.countryCode || 'USA').trim().toUpperCase(),
    stateCode: String(b.stateCode || b.state || '').trim().toUpperCase(),
    zipCode: zip,
  };
}
