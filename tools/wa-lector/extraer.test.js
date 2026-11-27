// Prueba de punta a punta sin WhatsApp ni Ollama real: base temporal + un Ollama de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WA_DATOS = mkdtempSync(join(tmpdir(), 'wa-lector-'));
const { abrir, guardarChat, guardarMensaje, diaSV } = await import('./db.js');
const { extraer } = await import('./extraer.js');
const { reporte } = await import('./reporte.js');

const TS = Date.UTC(2026, 10, 25, 20, 0) / 1000;   // 25-nov 14:00 SV

test('día SV: 03:00 UTC todavía es el día anterior', () => {
  assert.equal(diaSV(Date.UTC(2026, 10, 26, 3, 0) / 1000), '2026-11-25');
});

test('extrae, respeta empresa fija, no duplica y reprocesa si llegan mensajes', async () => {
  const pedidos = [];
  let falla = false;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const j = JSON.parse(b); pedidos.push(j);
      if ('think' in j) { res.writeHead(400).end('{"error":"does not support thinking"}'); return; }
      if (falla) { res.writeHead(500).end('boom'); return; }
      const items = j.messages[1].content.includes('transfer') ? [
        { tipo: 'pago', empresa: 'Kako', resumen: 'Pagar factura de carne', responsable: 'Ana', fecha_limite: 'mañana', monto: 450.5, mensajes: [2, 99] },
        { tipo: 'inventado', empresa: 'Kako', resumen: 'no debe entrar', responsable: null, fecha_limite: null, monto: null, mensajes: [] },
      ] : [];
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    });
  });
  await new Promise(r => srv.listen(0, r));
  const cfg = { empresas: ['Freakie Dogs', 'Kako'], modelo: 'prueba', ollamaUrl: `http://127.0.0.1:${srv.address().port}`,
    chats: { 'Gerentes': { empresa: 'Freakie Dogs' }, 'Familia': { ignorar: true } } };
  const db = abrir();
  guardarChat(db, { id: 'g1', nombre: 'Gerentes', es_grupo: true });
  guardarChat(db, { id: 'f1', nombre: 'Familia', es_grupo: true });
  const m = (id, chat, texto, extra = {}) => guardarMensaje(db, { id, chat_id: chat, autor: 'Ana', ts: TS, texto, ...extra });
  assert.equal(m('a', 'g1', 'buenas'), true);
  assert.equal(m('b', 'g1', 'hay que transferir $450.50 al proveedor de carne'), true);
  assert.equal(m('b', 'g1', 'repetido'), false);
  m('c', 'f1', 'transferir algo personal');

  let r = await extraer(db, cfg, { dia: '2026-11-25' });
  assert.deepEqual(r, { lotes: 1, items: 2, errores: 0 });   // el modelo devolvió 2; solo 1 es válido
  const items = db.prepare('select * from items').all();
  assert.equal(items.length, 1);
  assert.equal(items[0].empresa, 'Freakie Dogs');            // gana la empresa fija del chat
  assert.equal(items[0].monto, 450.5);
  assert.equal(items[0].fecha_limite, null);                 // «mañana» no es fecha
  assert.deepEqual(JSON.parse(items[0].mensaje_ids), ['b']); // [99] no existe
  assert.equal(pedidos.length, 2);                           // con think (400) y sin think
  assert.ok(!pedidos.some(p => p.messages[1].content.includes('personal')));   // chat ignorado no viaja

  assert.equal((await extraer(db, cfg, { dia: '2026-11-25' })).lotes, 0);   // ya procesado
  m('d', 'g1', 'listo, ya hice la transferencia', { ts: TS + 60 });
  assert.equal((await extraer(db, cfg, { dia: '2026-11-25' })).lotes, 1);   // llegó uno nuevo → se rehace
  assert.equal(db.prepare('select count(*) n from items').get().n, 1);      // sin duplicar

  falla = true;
  r = await extraer(db, cfg, { dia: '2026-11-25', rehacer: true });
  assert.equal(r.errores, 1);
  falla = false;
  m('e', 'g1', 'otra transferencia', { ts: TS + 120 });
  assert.equal((await extraer(db, cfg, { dia: '2026-11-25' })).errores, 0);

  const txt = reporte(db, '2026-11-25');
  assert.match(txt, /## Freakie Dogs/);
  assert.match(txt, /Pagar factura de carne \(\$450\.50 · → Ana\) — _Gerentes_/);
  srv.close();
});
