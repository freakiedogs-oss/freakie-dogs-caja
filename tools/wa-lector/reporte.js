// Arma el resumen de un día por empresa, en Markdown (datos/reportes/AAAA-MM-DD.md).
//   node reporte.js              → ayer
//   node reporte.js --hoy
//   node reporte.js --dia 2026-11-25
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrir, DATOS, diaSV, hoySV } from './db.js';

const TITULOS = { pago: '💵 Pagos', pendiente: '✅ Pendientes', decision: '📌 Decisiones', cambio: '🔁 Cambios', reunion: '🗓️ Reuniones', problema: '⚠️ Problemas' };

export function reporte(db, dia) {
  const items = db.prepare(`select i.*, c.nombre chat from items i join chats c on c.id = i.chat_id where i.dia = ? order by i.empresa, i.tipo, i.id`).all(dia);
  const sinProcesar = db.prepare(`select count(*) n from (select m.chat_id from mensajes m left join lotes l on l.chat_id = m.chat_id and l.dia = m.dia where m.dia = ? and l.chat_id is null group by m.chat_id)`).get(dia).n;
  const lineas = [`# Resumen de WhatsApp — ${dia}`, ''];
  if (sinProcesar) lineas.push(`> ⚠️ ${sinProcesar} conversaciones de este día todavía no pasaron por el modelo (corré \`npm run extraer\`).`, '');
  if (!items.length) lineas.push('Sin nada que registrar.');
  const empresas = [...new Set(items.map(i => i.empresa))];
  for (const e of empresas) {
    lineas.push(`## ${e}`, '');
    for (const [tipo, titulo] of Object.entries(TITULOS)) {
      const de = items.filter(i => i.empresa === e && i.tipo === tipo);
      if (!de.length) continue;
      lineas.push(`### ${titulo}`);
      for (const i of de) {
        const extra = [i.monto != null ? `$${i.monto.toFixed(2)}` : null, i.responsable ? `→ ${i.responsable}` : null, i.fecha_limite ? `para ${i.fecha_limite}` : null].filter(Boolean).join(' · ');
        lineas.push(`- ${i.resumen}${extra ? ` (${extra})` : ''} — _${i.chat}_`);
      }
      lineas.push('');
    }
  }
  return lineas.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const dia = a.includes('--dia') ? a[a.indexOf('--dia') + 1] : a.includes('--hoy') ? hoySV() : diaSV(Math.floor(Date.now() / 1000) - 86400);
  const txt = reporte(abrir(), dia);
  mkdirSync(join(DATOS, 'reportes'), { recursive: true });
  const ruta = join(DATOS, 'reportes', `${dia}.md`);
  writeFileSync(ruta, txt);
  console.log(txt, `\n\nGuardado en ${ruta}`);
}
