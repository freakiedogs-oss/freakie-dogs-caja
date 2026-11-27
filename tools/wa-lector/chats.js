// Lista los chats ya leídos con cuántos mensajes tienen y a qué empresa están asignados.
// Sirve para llenar config.json (empresa por chat, o "ignorar": true).
import { abrir, cargarConfig } from './db.js';

const cfg = cargarConfig();
const filas = abrir().prepare(`select c.nombre, c.es_grupo, count(m.id) n, max(m.dia) ultimo
  from chats c left join mensajes m on m.chat_id = c.id group by c.id order by c.es_grupo desc, n desc`).all();
for (const f of filas) {
  const c = cfg.chats?.[f.nombre];
  const marca = c?.ignorar ? 'IGNORADO' : c?.empresa || '(el modelo decide)';
  console.log(`${f.es_grupo ? 'grupo  ' : 'privado'}  ${String(f.n).padStart(5)} msgs  ${f.ultimo || '    —     '}  ${f.nombre}  →  ${marca}`);
}
console.log(`\n${filas.length} chats.`);
