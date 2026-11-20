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
//   POST /api/wa?op=ia       { msg_id, tel, texto, modo, respaldo, respaldo_escalar }
//        Mismo header X-FD-Secret. Lo llama el trigger wa_bot_auto solo para las
//        ramas «suaves»; contesta con Claude usando wa_ia_contexto(). Ver 20261120b.
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
    const r = await sb('app_secretos?select=clave,valor&clave=in.(kapso_api_key,kapso_phone_number_id,kapso_webhook_secret,wa_internal_secret,anthropic_api_key,wa_ia_modelo)', { method: 'GET', headers: { Prefer: '' } });
    const filas = r.ok ? await r.json() : [];
    _cfg = Object.fromEntries(filas.map(f => [f.clave, f.valor])); _cfgAt = Date.now();
  }
  const v = _cfg[k]; return v && v !== 'PEGAR_AQUI' ? v : null;
}
const registrar = (fila) => sb('whatsapp_mensajes', { method: 'POST', body: JSON.stringify(fila), headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' } });

const autorizado = async (req) => {
  const secreto = await cfg('wa_internal_secret');
  return !!secreto && igualSeguro(req.headers.get('x-fd-secret') || '', secreto);
};

// Manda un texto (varias burbujas cortas separadas por '¶', en orden y con pausa) y lo registra.
async function mandarTexto(toRaw, textoRaw, motivo, pedido_id) {
  const KEY = await cfg('kapso_api_key'), PNID = await cfg('kapso_phone_number_id');
  if (!KEY || !PNID) return { ok: false, error: 'faltan_vars_kapso', status: 500 };
  const to = normalizarTel(toRaw), texto = String(textoRaw || '').slice(0, 4000);
  if (to.length < 10 || !texto) return { ok: false, error: 'falta_to_o_texto', status: 400 };
  const partes = texto.split('¶').map(x => x.trim()).filter(Boolean);
  let ok = true, ids = [], errores = [];
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise(res => setTimeout(res, 1300));
    const r = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${PNID}/messages`, {
      method: 'POST',
      headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: partes[i], preview_url: true } }),
    });
    const resp = await r.json().catch(() => ({}));
    const kid = resp?.messages?.[0]?.id || null;
    const err = r.ok ? null : String(resp?.error?.message || resp?.error || `HTTP ${r.status}`).slice(0, 500);
    await registrar({ direccion: 'sale', telefono: to, texto: partes[i], motivo: motivo || null, pedido_id: pedido_id || null, kapso_message_id: kid, estado: r.ok ? 'enviado' : 'fallo', error: err });
    ids.push(kid); if (!r.ok) { ok = false; errores.push(err); break; }
  }
  return { ok, ids, error: errores[0] || null, status: ok ? 200 : 502 };
}

async function enviar(req) {
  if (!(await autorizado(req))) return json(403, { ok: false, error: 'no_autorizado' });
  let b; try { b = await req.json(); } catch { return json(400, { ok: false, error: 'json_invalido' }); }
  const r = await mandarTexto(b.to, b.texto, b.motivo, b.pedido_id);
  return json(r.status, { ok: r.ok, ids: r.ids, error: r.error });
}

// ── Cerebro con Claude (20-nov-2026) ─────────────────────────────────────
// La BD solo manda acá las ramas «suaves» (saludo genérico y «no entendí»).
// Lo delicado (quejas, reembolsos, facturas, estado del pedido, vuelto…) lo
// siguen resolviendo las reglas, nunca Claude. Si algo falla, sale el respaldo
// de la regla: el cliente siempre recibe respuesta.
const ESTILO = `Sos el asistente de WhatsApp de Freakie Dogs (smash burgers y hot dogs, El Salvador) y contestás como Cesar, el dueño.
ESTILO:
- Trato de usted ("su pedido", "fíjese que", "permítame"). Cálido, corto, rápido. Nada robótico.
- Varias burbujas cortas separadas por el carácter ¶ (máximo 3). Cada burbuja de 1 o 2 líneas.
- A veces alarga la última vocal para sonar amable ("gustooo", "graciaaas", "Listoooo"), máximo una palabra por burbuja.
- Emojis al FINAL de la burbuja, pegados al texto: ☺️🫶🏼 (firma), 🙌🏻 (buenas noticias), 🙏🏻 (paciencia), 🥰 (cariño), 🥺 (algo salió mal). No en todas.
- Salude según la hora (te paso el saludo) solo si es el primer mensaje del día o el cliente saludó.
- Para pedir: siempre el link del menú, que es donde se hace la orden. No se toman pedidos por WhatsApp.
REGLAS DURAS:
- Usá SOLO los datos del CONTEXTO (horarios de hoy, sucursales, menú y precios, preguntas frecuentes, pedido activo). Si un dato no está, no lo inventes: decí "permítame ahorita consulto🙏🏻" y poné escalar=true.
- Nunca prometas descuentos, regalos, reembolsos, cambios de precio ni horarios especiales.
- Quejas, faltantes, devoluciones, facturas, empleo, eventos, reservas, cancelaciones, datos bancarios, feriados → solo "permítame ya verifico🙏🏻" y escalar=true.
- Si preguntan si están abiertos, usá "abierto_ahora" de cada sucursal. Se puede pedir hasta 5 minutos antes del cierre.
- Envío gratis. Solo productos Coca-Cola (no Pepsi). Efectivo, tarjeta y transferencia (no bitcoin).
- Si el mensaje es ofensivo, spam o no tiene que ver con Freakie Dogs, contestá corto y amable o escalá.
Respondé SOLO un JSON: {"texto": "...", "escalar": true|false}`;

async function ia(req) {
  if (!(await autorizado(req))) return json(403, { ok: false, error: 'no_autorizado' });
  let b; try { b = await req.json(); } catch { return json(400, { ok: false }); }
  const t0 = Date.now();
  const marcar = (cambios) => b.msg_id ? sb(`whatsapp_mensajes?id=eq.${encodeURIComponent(b.msg_id)}`, { method: 'PATCH', body: JSON.stringify(cambios) }) : null;
  let texto = null, escalar = false, info = {};
  try {
    const KEY = await cfg('anthropic_api_key');
    if (!KEY || !KEY.startsWith('sk-ant-')) throw new Error('sin_api_key');
    const modelo = (await cfg('wa_ia_modelo')) || 'claude-haiku-5-5';
    const rc = await sb('rpc/wa_ia_contexto', { method: 'POST', body: JSON.stringify({ p_tel: b.tel }), headers: { Prefer: '' } });
    const ctx = rc.ok ? await rc.json() : {};
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelo, max_tokens: 400, temperature: 0.4,
        system: [{ type: 'text', text: ESTILO }, { type: 'text', text: 'CONTEXTO (datos reales de hoy):\n' + JSON.stringify(ctx) }],
        messages: [{ role: 'user', content: `Mensaje nuevo del cliente: «${String(b.texto || '').slice(0, 1500)}»\n(El historial de la conversación está en el CONTEXTO.)` }],
      }),
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(String(resp?.error?.message || `HTTP ${r.status}`).slice(0, 300));
    const crudo = (resp.content || []).map(c => c.text || '').join('').trim();
    const m = crudo.match(/\{[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : null;
    if (!j || typeof j.texto !== 'string' || !j.texto.trim()) throw new Error('respuesta_sin_json');
    texto = j.texto.trim().slice(0, 1200); escalar = !!j.escalar;
    info = { modelo, ms: Date.now() - t0, tokens: resp.usage || null };
  } catch (e) {
    info = { error: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 };
  }

  const usoIA = !!texto;
  if (!usoIA) { texto = b.respaldo || null; escalar = !!b.respaldo_escalar; }
  await marcar({ ia_sugerencia: usoIA ? texto : null, ia_info: { ...info, usada: usoIA && b.modo !== 'borrador' }, ...(b.modo !== 'borrador' && escalar ? { requiere_cesar: true } : {}) });
  if (b.modo === 'borrador' || !texto) return json(200, { ok: true, borrador: b.modo === 'borrador', usoIA });
  const s = await mandarTexto(b.tel, texto, usoIA ? 'bot_ia' : 'bot', null);
  return json(s.status, { ok: s.ok, usoIA, error: s.error });
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
  if (op === 'ia') return ia(req);
  return json(404, { ok: false, error: 'op' });
}
