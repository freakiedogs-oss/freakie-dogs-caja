// Base local (SQLite, un solo archivo en datos/). Las conversaciones NO salen de la máquina.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = dirname(fileURLToPath(import.meta.url));
export const DATOS = process.env.WA_DATOS || join(RAIZ, 'datos');

const DEFECTO = {
  empresas: ['Freakie Dogs', 'Kaeru', 'Kako', 'Personal'],
  chats: {},                 // "Nombre del chat": { "empresa": "Kaeru" } o { "ignorar": true }
  mensajesPorChat: 300,      // cuántos mensajes hacia atrás se piden por chat en cada pasada
  cadaMinutos: 60,           // cada cuánto se repasan todos los chats (además de escuchar en vivo)
  navegadorVisible: true,
  chromePath: null,          // null = Google Chrome de /Applications si existe
  ollamaUrl: 'http://127.0.0.1:11434',
  modelo: 'qwen3:8b',
};

export function cargarConfig() {
  const ruta = process.env.WA_CONFIG || join(RAIZ, 'config.json');
  const propio = existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : {};
  return { ...DEFECTO, ...propio };
}

// El Salvador es UTC-6 todo el año.
export const diaSV = (ts) => new Date((ts - 6 * 3600) * 1000).toISOString().slice(0, 10);
export const horaSV = (ts) => new Date((ts - 6 * 3600) * 1000).toISOString().slice(11, 16);
export const hoySV = () => diaSV(Math.floor(Date.now() / 1000));

export function abrir() {
  mkdirSync(DATOS, { recursive: true });
  const db = new DatabaseSync(join(DATOS, 'wa.sqlite'));
  db.exec(`
    pragma journal_mode = wal;
    pragma busy_timeout = 5000;
    create table if not exists chats (
      id text primary key, nombre text, es_grupo integer, visto_ts integer
    );
    create table if not exists mensajes (
      id text primary key, chat_id text not null, autor_id text, autor text, de_mi integer,
      ts integer not null, dia text not null, tipo text, texto text, tiene_media integer,
      guardado_en integer not null
    );
    create index if not exists mensajes_chat_dia on mensajes (chat_id, dia, ts);
    -- un lote = un chat en un día ya pasado por el modelo
    create table if not exists lotes (
      chat_id text, dia text, modelo text, mensajes integer, procesado_en integer, error text,
      primary key (chat_id, dia)
    );
    create table if not exists items (
      id integer primary key autoincrement, chat_id text, dia text, empresa text, tipo text,
      resumen text, responsable text, fecha_limite text, monto real, mensaje_ids text, creado_en integer
    );
    create index if not exists items_dia on items (dia, empresa);
  `);
  return db;
}

// Devuelve true si el mensaje era nuevo.
export function guardarMensaje(db, m) {
  const r = db.prepare(`insert or ignore into mensajes
    (id, chat_id, autor_id, autor, de_mi, ts, dia, tipo, texto, tiene_media, guardado_en)
    values (?,?,?,?,?,?,?,?,?,?,?)`).run(
    m.id, m.chat_id, m.autor_id ?? null, m.autor ?? null, m.de_mi ? 1 : 0, m.ts, diaSV(m.ts),
    m.tipo ?? 'chat', m.texto ?? '', m.tiene_media ? 1 : 0, Math.floor(Date.now() / 1000));
  return r.changes > 0;
}

export function guardarChat(db, c) {
  db.prepare(`insert into chats (id, nombre, es_grupo, visto_ts) values (?,?,?,?)
    on conflict(id) do update set nombre = excluded.nombre, es_grupo = excluded.es_grupo, visto_ts = excluded.visto_ts`)
    .run(c.id, c.nombre ?? c.id, c.es_grupo ? 1 : 0, Math.floor(Date.now() / 1000));
}
