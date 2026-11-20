// api/wa.js — WhatsApp vía Kapso (19-nov-2026)
//
// Por qué un servidor en el medio: la API key de Kapso no puede vivir en el
// bundle, y los mensajes que entran (webhook) hay que verificarlos con firma.
//
// Operaciones:
//   POST /api/wa?op=enviar   { to, texto, motivo?, pedido_id? }
//        Header obligatorio: X-FD-Secret = WA_INTERNAL_SECRET (lo usan la BD
//        vía pg_net o tareas internas; nunca el navegador).
//   POST /api/wa?op=webhook  ← Kapso (whatsapp.message.received / sent /
//        delivered / read / failed). Verifica X-Webhook-Signature (HMAC-SHA256
//        hex del body crudo con KAPSO_WEBHOOK_SECRET).
//
// Todo queda en la tabla whatsapp_mensajes (migración 20261119c).
//
// Configuración: se lee de la tabla app_secretos (RLS sin políticas: solo
// service_role), así no hay que tocar las variables de Vercel. Si existe la
// variable de entorno con el mismo nombre en mayúsculas, tiene prioridad.
//   kapso_api_key          — Integrations → API keys en Kapso (jamás en el repo)
//   kapso_phone_number_id  — id del número (sandbox ahora, el real después)
//   kapso_webhook_secret   — signing secret del webhook en Kapso
//   wa_internal_secret     — generado en la BD; lo usa wa_enviar() vía pg_net
// En Vercel solo hacen falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ya existen por n1co).
export const config = { runtime: 'edge' };

const env = (k, def) => (typeof process !== 'undefined' && process.env?.[k]) || def;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// El Salvador: 8 dígitos → 503XXXXXXXX
export const normalizarTel = (t) => {
  const d = String(t || '').replace(/\D/g, '');
  return d.length === 8 ? '503' + d : d;
};

async function hmacHex(secret, raw) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function igualSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sb(path, init = {}) {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(init.headers || {}) },
  });
}

let _cfg = null, _cfgAt = 0;
async function cfg(k) {
  const e = env(k.toUpperCase()); if (e) return e;
  if (!_cfg || Date.now() - _cfgAt > 60000) {
    const r = await sb('app_secretos?select=clave,valor&clave=in.(kapso_api_key,kapso_phone_number_id,kapso_webhook_secret,wa_internal_secret)', { method: 'GET', headers: { Prefer: '' } });
    const filas = r.ok ? await r.json() : [];
    _cfg = Object.fromEntries(filas.map(f => [f.clave, f.valor])); _cfgAt = Date.now();
  }
  const v = _cfg[k]; return v && v !== 'PEGAR_AQUI' ? v : null;
}
const registrar = (fila) => sb('whatsapp_mensajes', { method: 'POST', body: JSON.stringify(fila), headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' } });

async function enviar(req) {
  const secreto = await cfg('wa_internal_secret');
  if (!secreto || !igualSeguro(req.headers.get('x-fd-secret') || '', secreto)) return json(403, { ok: false, error: 'no_autorizado' });
  const KEY = await cfg('kapso_api_key'), PNID = await cfg('kapso_phone_number_id');
  if (!KEY || !PNID) return json(500, { ok: false, error: 'faltan_vars_kapso' });
  let b; try { b = await req.json(); } catch { return json(400, { ok: false, error: 'json_invalido' }); }
  const to = normalizarTel(b.to), texto = String(b.texto || '').slice(0, 4000);
  if (to.length < 10 || !texto) return json(400, { ok: false, error: 'falta_to_o_texto' });

  const r = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${PNID}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto, preview_url: true } }),
  });
  const resp = await r.json().catch(() => ({}));
  const kid = resp?.messages?.[0]?.id || null;
  const err = r.ok ? null : String(resp?.error?.message || resp?.error || `HTTP ${r.status}`).slice(0, 500);
  await registrar({ direccion: 'sale', telefono: to, texto, motivo: b.motivo || null, pedido_id: b.pedido_id || null, kapso_message_id: kid, estado: r.ok ? 'enviado' : 'fallo', error: err });
  return json(r.ok ? 200 : 502, { ok: r.ok, id: kid, error: err });
}

async function webhook(req) {
  const raw = await req.text();
  const secreto = await cfg('kapso_webhook_secret');
  if (!secreto) return json(500, { ok: false, error: 'falta_secreto' });
  const firma = req.headers.get('x-webhook-signature') || '';
  if (!igualSeguro(await hmacHex(secreto, raw), firma)) return json(401, { ok: false, error: 'firma_invalida' });

  const evento = req.headers.get('x-webhook-event') || '';
  let body; try { body = JSON.parse(raw); } catch { return json(400, { ok: false }); }
  const lista = body?.batch ? (body.data || []) : [body];

  for (const p of lista) {
    const m = p?.message || {};
    if (evento === 'whatsapp.message.received') {
      await registrar({
        direccion: 'entra', telefono: m.from || p?.conversation?.phone_number || null,
        texto: m.kapso?.content || m.text?.body || null, tipo: m.type || 'text', motivo: 'respuesta',
        kapso_message_id: m.id || null, estado: 'recibido', payload: p,
      });
    } else if (/^whatsapp\.message\.(sent|delivered|read|failed)$/.test(evento) && m.id) {
      const estado = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallo' }[evento.split('.').pop()];
      const errs = (m.kapso?.statuses || []).flatMap(s => s.errors || []);
      const cambios = { estado }; if (errs.length) cambios.error = String(errs[0].message || errs[0].title).slice(0, 500);
      // no retroceder: leido > entregado > enviado
      const orden = estado === 'leido' ? '' : estado === 'entregado' ? '&estado=neq.leido' : '&estado=not.in.(leido,entregado)';
      await sb(`whatsapp_mensajes?kapso_message_id=eq.${encodeURIComponent(m.id)}&direccion=eq.sale${orden}`, { method: 'PATCH', body: JSON.stringify(cambios) });
    }
  }
  return json(200, { ok: true });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false });
  const op = new URL(req.url).searchParams.get('op');
  if (op === 'enviar') return enviar(req);
  if (op === 'webhook') return webhook(req);
  return json(404, { ok: false, error: 'op' });
}
