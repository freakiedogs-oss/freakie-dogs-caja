// Pasa cada conversación de cada día por el modelo LOCAL (Ollama) y guarda lo importante
// en la tabla items: reuniones, decisiones, cambios, pagos, pendientes. Nada sale de la máquina.
//
//   node extraer.js                 → días cerrados que falten (hasta ayer)
//   node extraer.js --hoy           → incluye hoy (se rehace cada vez que se corre)
//   node extraer.js --dia 2026-11-25 [--rehacer]
import { abrir, cargarConfig, hoySV, horaSV } from './db.js';

export const TIPOS = ['reunion', 'decision', 'cambio', 'pago', 'pendiente', 'problema'];
const MAX_CARACTERES = 9000;   // por pedazo; un día largo se parte en varios

const esquema = (empresas) => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: TIPOS },
          empresa: { type: 'string', enum: [...empresas, 'Sin clasificar'] },
          resumen: { type: 'string' },
          responsable: { type: ['string', 'null'] },
          fecha_limite: { type: ['string', 'null'] },
          monto: { type: ['number', 'null'] },
          mensajes: { type: 'array', items: { type: 'integer' } },
        },
        required: ['tipo', 'empresa', 'resumen', 'responsable', 'fecha_limite', 'monto', 'mensajes'],
      },
    },
  },
  required: ['items'],
});

const instrucciones = (empresas, chat, empresaFija, dia) => `Sos el asistente de Jose, dueño de varios negocios en El Salvador (${empresas.join(', ')}).
Vas a leer los mensajes de UN chat de WhatsApp de UN día y sacar solo lo que Jose necesita tener registrado.

Chat: «${chat.nombre}» (${chat.es_grupo ? 'grupo' : 'conversación privada'}). Día: ${dia}. «Yo» es Jose.
${empresaFija ? `Este chat es de la empresa «${empresaFija}»: usá esa empresa en todos los items.` : `Elegí la empresa por el contenido; si no se sabe, «Sin clasificar».`}

Tipos:
- reunion: se acordó o se hizo una reunión, llamada o visita (con fecha/hora si la dicen).
- decision: alguien decidió algo que cambia cómo se trabaja.
- cambio: cambio de precio, horario, turno, proveedor, personal, menú o proceso.
- pago: pago hecho, pedido o pendiente (factura, proveedor, planilla, transferencia). Poné el monto en dólares si lo dicen.
- pendiente: tarea que alguien quedó de hacer. Poné quién en «responsable».
- problema: falla, queja o faltante que hay que atender.

Reglas:
- Un item por hecho. Resumen en una frase clara en español, con nombres y cifras tal como aparecen.
- No inventes nada: si no dicen monto, fecha o responsable, van en null. fecha_limite en formato AAAA-MM-DD.
- «mensajes» = los números [n] de los mensajes de donde salió el item.
- Saludos, stickers, chistes, charla personal y mensajes sin contenido NO son items.
- Si no hay nada que registrar, devolvé {"items": []}.`;

async function preguntar(cfg, system, user) {
  const cuerpo = {
    model: cfg.modelo, stream: false, format: esquema(cfg.empresas),
    options: { temperature: 0, num_ctx: 8192 },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  // think:false apaga el «pensar en voz alta» de qwen3; los modelos que no lo soportan dan 400.
  for (const extra of [{ think: false }, {}]) {
    const r = await fetch(`${cfg.ollamaUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...cuerpo, ...extra }) });
    if (r.status === 400 && 'think' in extra) continue;
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const items = JSON.parse(j.message?.content || '{}').items;
    if (!Array.isArray(items)) throw new Error('el modelo no devolvió items');
    return items;
  }
}

function pedazos(msgs) {
  const lineas = msgs.map((m, i) => {
    const cuerpo = m.texto?.trim() || `(${m.tiene_media ? m.tipo : 'sin texto'})`;
    return `[${i + 1}] ${horaSV(m.ts)} ${m.autor}: ${cuerpo.slice(0, 1500)}`;
  });
  const out = []; let actual = [];
  for (const l of lineas) {
    if (actual.length && actual.join('\n').length + l.length > MAX_CARACTERES) { out.push(actual); actual = []; }
    actual.push(l);
  }
  if (actual.length) out.push(actual);
  return out;
}

export async function procesarLote(db, cfg, chat, dia) {
  const msgs = db.prepare('select id, autor, ts, tipo, texto, tiene_media from mensajes where chat_id = ? and dia = ? order by ts, id').all(chat.id, dia);
  const conTexto = msgs.filter(m => m.texto?.trim()).length;
  const empresaFija = cfg.chats?.[chat.nombre]?.empresa || null;
  let items = [], error = null;
  if (conTexto > 0) {
    try {
      for (const p of pedazos(msgs)) {
        items.push(...await preguntar(cfg, instrucciones(cfg.empresas, chat, empresaFija, dia), p.join('\n')));
      }
    } catch (e) { error = String(e.message || e).slice(0, 300); items = []; }
  }
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('delete from items where chat_id = ? and dia = ?').run(chat.id, dia);
  const ins = db.prepare('insert into items (chat_id, dia, empresa, tipo, resumen, responsable, fecha_limite, monto, mensaje_ids, creado_en) values (?,?,?,?,?,?,?,?,?,?)');
  for (const it of items) {
    if (!TIPOS.includes(it.tipo) || !it.resumen?.trim()) continue;
    const ids = (it.mensajes || []).map(n => msgs[n - 1]?.id).filter(Boolean);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(it.fecha_limite || '') ? it.fecha_limite : null;
    ins.run(chat.id, dia, empresaFija || it.empresa || 'Sin clasificar', it.tipo, it.resumen.trim(), it.responsable || null, fecha,
      typeof it.monto === 'number' ? it.monto : null, JSON.stringify(ids), ahora);
  }
  // Con error no se marca el lote: la próxima corrida lo reintenta.
  if (!error) {
    db.prepare(`insert into lotes (chat_id, dia, modelo, mensajes, procesado_en, error) values (?,?,?,?,?,null)
      on conflict(chat_id, dia) do update set modelo = excluded.modelo, mensajes = excluded.mensajes, procesado_en = excluded.procesado_en, error = null`)
      .run(chat.id, dia, cfg.modelo, msgs.length, ahora);
  }
  return { items: error ? 0 : items.length, error };
}

export async function extraer(db, cfg, { dia = null, hoy = false, rehacer = false } = {}) {
  const hoyTxt = hoySV();
  // Pendientes: chat+día sin lote, o con más mensajes que cuando se procesó (llegaron después).
  const filas = db.prepare(`
    select m.chat_id, m.dia, count(*) n, c.nombre, c.es_grupo, l.mensajes hechos
    from mensajes m join chats c on c.id = m.chat_id left join lotes l on l.chat_id = m.chat_id and l.dia = m.dia
    group by m.chat_id, m.dia order by m.dia, c.nombre`).all()
    .filter(f => dia ? f.dia === dia : (hoy ? f.dia <= hoyTxt : f.dia < hoyTxt))
    .filter(f => rehacer || f.hechos == null || f.hechos < f.n)
    .filter(f => cfg.chats?.[f.nombre]?.ignorar !== true);
  let total = 0, errores = 0;
  for (const f of filas) {
    const r = await procesarLote(db, cfg, { id: f.chat_id, nombre: f.nombre, es_grupo: !!f.es_grupo }, f.dia);
    total += r.items; if (r.error) errores++;
    console.log(`${f.dia} · ${f.nombre}: ${r.error ? '❌ ' + r.error : r.items + ' items'} (${f.n} mensajes)`);
  }
  return { lotes: filas.length, items: total, errores };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const cfg = cargarConfig();
  const r = await extraer(abrir(), cfg, { dia: a.includes('--dia') ? a[a.indexOf('--dia') + 1] : null, hoy: a.includes('--hoy'), rehacer: a.includes('--rehacer') });
  console.log(`\nListo con ${cfg.modelo}: ${r.lotes} conversaciones-día, ${r.items} items, ${r.errores} con error.`);
  if (r.errores) process.exitCode = 1;
}
