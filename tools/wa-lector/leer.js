// Abre WhatsApp Web en un Chrome real (sesión guardada en datos/sesion), y copia los
// mensajes a la base local. SOLO LEE: este programa no manda mensajes, no marca como
// leído y no descarga fotos ni audios.
//
//   node leer.js            → se queda abierto: escucha en vivo y repasa todo cada N minutos
//   node leer.js --una-vez  → repasa todos los chats una vez y se cierra
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import wweb from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { abrir, cargarConfig, guardarChat, guardarMensaje, DATOS } from './db.js';

const { Client, LocalAuth } = wweb;
const UNA_VEZ = process.argv.includes('--una-vez');
const cfg = cargarConfig();
const db = abrir();
const log = (...a) => console.log(new Date().toLocaleTimeString('es-SV', { hour12: false }), ...a);

const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = cfg.chromePath || process.env.WA_CHROME || (existsSync(CHROME_MAC) ? CHROME_MAC : undefined);

const cliente = new Client({
  authStrategy: new LocalAuth({ dataPath: join(DATOS, 'sesion') }),
  puppeteer: {
    headless: !cfg.navegadorVisible,
    executablePath: chrome,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
  },
});

const ignorado = (nombre) => cfg.chats?.[nombre]?.ignorar === true;
const nombres = new Map();   // id de contacto → nombre

async function nombreDe(msg) {
  if (msg.fromMe) return 'Yo';
  const id = msg.author || msg.from;
  if (nombres.has(id)) return nombres.get(id);
  let n = msg._data?.notifyName || null;
  try { const c = await msg.getContact(); n = c.name || c.pushname || n || c.number; } catch { /* queda notifyName */ }
  n = n || String(id).split('@')[0];
  nombres.set(id, n);
  return n;
}

async function fila(msg, chatId) {
  return {
    id: msg.id._serialized, chat_id: chatId, autor_id: msg.author || msg.from, autor: await nombreDe(msg),
    de_mi: msg.fromMe, ts: msg.timestamp, tipo: msg.type, texto: msg.body || '', tiene_media: msg.hasMedia,
  };
}

const esEstado = (id) => id === 'status@broadcast' || id.endsWith('@newsletter') || id.endsWith('@broadcast');

async function repasar() {
  const chats = (await cliente.getChats()).filter(c => !esEstado(c.id._serialized));
  let nuevos = 0, leidos = 0;
  for (const chat of chats) {
    const nombre = chat.name || chat.id.user;
    if (ignorado(nombre)) continue;
    guardarChat(db, { id: chat.id._serialized, nombre, es_grupo: chat.isGroup });
    try {
      const msgs = await chat.fetchMessages({ limit: cfg.mensajesPorChat });
      for (const m of msgs) {
        if (m.type === 'e2e_notification' || m.type === 'notification_template' || m.type === 'gp2') continue;
        if (guardarMensaje(db, await fila(m, chat.id._serialized))) nuevos++;
      }
      leidos++;
    } catch (e) {
      log(`⚠️  no pude leer «${nombre}»: ${e.message}`);
    }
  }
  log(`Repaso listo: ${leidos} chats, ${nuevos} mensajes nuevos.`);
}

cliente.on('qr', (qr) => {
  log('Escaneá este código desde el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo');
  qrcode.generate(qr, { small: true });
});
cliente.on('authenticated', () => log('Sesión iniciada.'));
cliente.on('auth_failure', (m) => log('❌ No se pudo iniciar sesión:', m));
cliente.on('disconnected', (r) => { log('❌ WhatsApp cerró la sesión:', r, '— volvé a correr leer.js y escaneá el código.'); process.exit(1); });

cliente.on('ready', async () => {
  log('WhatsApp Web listo. Leyendo conversaciones…');
  await repasar();
  if (UNA_VEZ) { await cliente.destroy(); process.exit(0); }
  setInterval(() => repasar().catch(e => log('⚠️  repaso falló:', e.message)), cfg.cadaMinutos * 60000);
});

// En vivo: lo que entra y lo que escribo yo desde el teléfono.
cliente.on('message_create', async (msg) => {
  try {
    const chatId = msg.fromMe ? msg.to : msg.from;
    if (esEstado(chatId)) return;
    const chat = await msg.getChat();
    const nombre = chat.name || chat.id.user;
    if (ignorado(nombre)) return;
    guardarChat(db, { id: chat.id._serialized, nombre, es_grupo: chat.isGroup });
    guardarMensaje(db, await fila(msg, chat.id._serialized));
  } catch (e) { log('⚠️  mensaje en vivo no guardado:', e.message); }
});

log(`Abriendo WhatsApp Web${chrome ? '' : ' (Chromium de puppeteer)'}…`);
cliente.initialize().catch((e) => { log('❌ No arrancó:', e.message); process.exit(1); });
