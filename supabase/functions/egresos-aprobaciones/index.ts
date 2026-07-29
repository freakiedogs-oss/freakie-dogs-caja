import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ── Aprobación de egresos de caja vía Telegram ──────────────────────────────
// Flujo: el POS crea la solicitud → DM al gerente de la sucursal → si a los
// 15 min nadie decidió, escala al grupo. El DM del gerente SIGUE válido: gana
// el primero que decida (el FOR UPDATE de la RPC evita la carrera).
// Portado de `pos-aprobaciones` (Eatalia), adaptado a egresos.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ESCALAR_MIN  = 15;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const service = createClient(SUPABASE_URL, SERVICE_KEY);

async function secret(...keys: string[]): Promise<string> {
  for (const k of keys) { const v = Deno.env.get(k); if (v) return v; }
  for (const k of keys) {
    const { data } = await service.from("app_secretos").select("valor").eq("clave", k).maybeSingle();
    if (data?.valor) return data.valor as string;
  }
  return "";
}
async function getConfig() {
  return {
    BOT:            await secret("TELEGRAM_EGRESOS_BOT_TOKEN"),
    CHAT:           await secret("TELEGRAM_EGRESOS_CHAT_ID"),      // grupo de respaldo
    WEBHOOK_SECRET: await secret("TELEGRAM_EGRESOS_WEBHOOK_SECRET"),
    ADMIN_SECRET:   await secret("EGRESOS_ADMIN_SECRET"),
    REGISTRO_CLAVE: await secret("EGRESOS_REGISTRO_CLAVE"),
  };
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
const esc = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const nowHM = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(11, 16);
const nombreDe = (u: any) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || `user${u.id}`;

const keyboard = (id: number) => ({ inline_keyboard: [[
  { text: "✅ Aprobar",  callback_data: `egr:${id}:ok` },
  { text: "❌ Denegar",  callback_data: `egr:${id}:no` },
]]});

async function tg(BOT: string, method: string, payload: unknown) {
  if (!BOT) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return await r.json();
  } catch { return null; }
}
const sendMessage = (BOT: string, chat: string | number, text: string, reply_markup?: unknown) =>
  tg(BOT, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup });
const editMessageText = (BOT: string, chat: string | number, message_id: number, text: string) =>
  tg(BOT, "editMessageText", { chat_id: chat, message_id, text, parse_mode: "HTML", disable_web_page_preview: true });
const editCaption = (BOT: string, chat: string | number, message_id: number, caption: string) =>
  tg(BOT, "editMessageCaption", { chat_id: chat, message_id, caption, parse_mode: "HTML" });
const answerCb = (BOT: string, id: string, text: string) =>
  tg(BOT, "answerCallbackQuery", { callback_query_id: id, text });

/** Manda la tarjeta. Con foto usa sendPhoto; si la foto no es accesible, cae a texto. */
async function enviarTarjeta(BOT: string, chat: string | number, s: any, texto: string) {
  if (s.foto_url) {
    const r: any = await tg(BOT, "sendPhoto", {
      chat_id: chat, photo: s.foto_url, caption: texto, parse_mode: "HTML", reply_markup: keyboard(s.id) });
    if (r?.ok) return { ...r, _foto: true };
  }
  const t = s.foto_url ? `${texto}\n📷 <a href="${esc(s.foto_url)}">ver comprobante</a>` : texto;
  return await sendMessage(BOT, chat, t, keyboard(s.id));
}

function tarjeta(s: any, sucursal: string, escalada = false) {
  const L = [
    escalada
      ? `⏰ <b>SIN RESPUESTA ${ESCALAR_MIN} MIN</b> — requiere decisión`
      : `🔔 <b>Aprobación de egreso</b>`,
    `🏪 ${esc(sucursal)}`,
    `💵 <b>${money(s.monto)}</b> · ${esc(s.motivo_nombre ?? "—")}`,
  ];
  if (s.persona_recibe) L.push(`👤 Recibe: ${esc(s.persona_recibe)}`);
  if (s.comentario)     L.push(`💬 ${esc(s.comentario)}`);
  L.push(`🙋 Solicita: ${esc(s.solicitante_nombre ?? "—")}`);
  if (escalada && s.aprobador_asignado_nombre) L.push(`↪️ Asignado a ${esc(s.aprobador_asignado_nombre)} (no respondió)`);
  L.push(`🕒 ${nowHM()}`);
  if (s.modo === "sombra") L.push(`\n🧪 <i>MODO SOMBRA — el efectivo sale igual, esto es solo registro.</i>`);
  return L.join("\n");
}

async function nombreSucursal(store_code: string) {
  const { data } = await service.from("sucursales").select("nombre").eq("store_code", store_code).maybeSingle();
  return data?.nombre ?? store_code;
}

// ── Crear solicitud (la llama el POS) ──
async function crear(cfg: any, body: any) {
  const store_code = String(body.store_code ?? "");
  if (!store_code || !(Number(body.monto) > 0)) return json({ error: "bad_request" }, 400);

  const { data: suc } = await service.from("sucursales")
    .select("nombre, aprobacion_egresos").eq("store_code", store_code).maybeSingle();
  if (!suc) return json({ error: "sucursal_desconocida" }, 400);
  if (suc.aprobacion_egresos === "off") return json({ ok: true, skip: "off" });

  // Un egreso solo existe dentro de un turno ABIERTO de esa caja. Es regla de
  // negocio y además evita que el endpoint (anon) se use para spamear tarjetas.
  const { data: turno } = await service.from("pos_turnos")
    .select("id").eq("id", body.turno_id ?? "00000000-0000-0000-0000-000000000000")
    .eq("store_code", store_code).eq("estado", "abierto").maybeSingle();
  if (!turno) return json({ error: "turno_no_abierto" }, 400);

  // Ruteo: gerente de la sucursal, excluyendo al solicitante. Sin resultado ⇒ grupo.
  const { data: rut } = await service
    .rpc("fn_egreso_aprobador", { p_store_code: store_code, p_solicitante_id: body.solicitante_id ?? null });
  const asignado = Array.isArray(rut) && rut.length ? rut[0] : null;

  const { data: ins, error } = await service.from("egresos_solicitudes").insert({
    store_code, turno_id: body.turno_id ?? null,
    motivo_id: body.motivo_id ?? null, motivo_nombre: body.motivo_nombre ?? null,
    monto: Number(body.monto), persona_recibe: body.persona_recibe ?? null,
    empleado_id: body.empleado_id ?? null, comentario: body.comentario ?? null,
    foto_url: body.foto_url ?? null,
    solicitante_id: body.solicitante_id ?? null, solicitante_nombre: body.solicitante_nombre ?? null,
    modo: suc.aprobacion_egresos === "bloqueante" ? "bloqueante" : "sombra",
    aprobador_asignado_id: asignado?.usuario_id ?? null,
    aprobador_asignado_nombre: asignado?.nombre ?? null,
  }).select("*").single();
  if (error) return json({ error: error.message }, 500);

  // DM al gerente asignado; si no hay, va derecho al grupo (queda escalada).
  let dmChat: string | null = null;
  if (asignado?.usuario_id) {
    const { data: ap } = await service.from("telegram_aprobadores")
      .select("telegram_id").eq("usuario_id", asignado.usuario_id).eq("activo", true).maybeSingle();
    if (ap?.telegram_id) dmChat = String(ap.telegram_id);
  }

  const texto = tarjeta(ins, suc.nombre, !dmChat);
  const upd: Record<string, unknown> = {};

  if (dmChat) {
    const sent: any = await enviarTarjeta(cfg.BOT, dmChat, ins, texto);
    if (sent?.ok) { upd.tg_dm_chat_id = String(sent.result.chat.id); upd.tg_dm_message_id = sent.result.message_id; }
  }
  if (!dmChat || !upd.tg_dm_message_id) {
    // Sin gerente, sin Telegram vinculado, o falló el DM ⇒ grupo desde ya.
    if (cfg.CHAT) {
      const sent: any = await enviarTarjeta(cfg.BOT, cfg.CHAT, ins, tarjeta(ins, suc.nombre, true));
      if (sent?.ok) { upd.tg_grupo_chat_id = String(sent.result.chat.id); upd.tg_grupo_message_id = sent.result.message_id; }
    }
    upd.escalado_at = new Date().toISOString();
  }
  if (Object.keys(upd).length) await service.from("egresos_solicitudes").update(upd).eq("id", ins.id);

  return json({ ok: true, id: ins.id, modo: ins.modo, asignado: asignado?.nombre ?? null, escalada: !dmChat });
}

// ── Escalamiento (lo llama pg_cron cada minuto) ──
async function escalar(cfg: any) {
  const limite = new Date(Date.now() - ESCALAR_MIN * 60 * 1000).toISOString();
  const { data: pend } = await service.from("egresos_solicitudes").select("*")
    .eq("estado", "pendiente").is("escalado_at", null).lt("created_at", limite).limit(20);
  if (!pend?.length) return json({ ok: true, escaladas: 0 });
  let n = 0;
  for (const s of pend) {
    const upd: Record<string, unknown> = { escalado_at: new Date().toISOString() };
    if (cfg.CHAT) {
      const sent: any = await enviarTarjeta(cfg.BOT, cfg.CHAT, s, tarjeta(s, await nombreSucursal(s.store_code), true));
      if (sent?.ok) { upd.tg_grupo_chat_id = String(sent.result.chat.id); upd.tg_grupo_message_id = sent.result.message_id; }
    }
    await service.from("egresos_solicitudes").update(upd).eq("id", s.id);
    n++;
  }
  return json({ ok: true, escaladas: n });
}

async function registrar(cfg: any, from: any, ack: (t: string) => Promise<any>) {
  const nombre = nombreDe(from);
  const { data: ya } = await service.from("telegram_aprobadores")
    .select("telegram_id").eq("telegram_id", from.id).maybeSingle();
  if (ya) { await ack(`Ya estabas registrado: ${nombre}`); return; }
  await service.from("telegram_aprobadores")
    .upsert({ telegram_id: from.id, nombre, activo: true }, { onConflict: "telegram_id" });
  await ack(`✅ Registrado: ${nombre}. Falta que Jose te asigne sucursal/rol.`);
}

async function handleTelegramUpdate(cfg: any, update: any) {
  const BOT = cfg.BOT;

  if (update.callback_query) {
    const cq = update.callback_query;
    const from = cq.from;
    const data = String(cq.data ?? "");
    const [tag, idStr, act] = data.split(":");
    if (tag !== "egr") { await answerCb(BOT, cq.id, "Acción desconocida"); return json({ ok: true }); }

    const { data: res, error } = await service.rpc("resolver_aprobacion_egreso", {
      p_id: Number(idStr), p_telegram_id: from.id,
      p_aprobador_fallback: nombreDe(from), p_aprueba: act === "ok" });

    if (error || !res)             { await answerCb(BOT, cq.id, "Error del servidor"); return json({ ok: false }); }
    if (res.error === "no_autorizado") { await answerCb(BOT, cq.id, "⛔ No estás autorizado para este egreso"); return json({ ok: true }); }
    if (res.error === "no_existe")     { await answerCb(BOT, cq.id, "Solicitud no encontrada"); return json({ ok: true }); }
    if (res.error === "ya_resuelta")   { await answerCb(BOT, cq.id, `Ya fue ${res.estado} por ${res.aprobado_por ?? "otro"}`); return json({ ok: true }); }

    const ok = res.estado === "aprobado";
    const cab = ok ? `✅ <b>APROBADO</b>` : `❌ <b>DENEGADO</b>`;
    const texto = `${cab} por ${esc(res.aprobado_por)} · ${nowHM()}\n`
      + `💵 ${money(res.monto)} · ${esc(res.motivo ?? "—")}\n`
      + `🙋 ${esc(res.solicitante ?? "—")}`
      + (res.modo === "sombra" ? `\n🧪 <i>modo sombra</i>` : "");

    // Edita las DOS copias (DM y grupo) para que nadie decida dos veces.
    for (const [c, m] of [[res.tg_dm_chat_id, res.tg_dm_message_id], [res.tg_grupo_chat_id, res.tg_grupo_message_id]]) {
      if (c && m) { const r: any = await editMessageText(BOT, c as string, m as number, texto);
                    if (!r?.ok) await editCaption(BOT, c as string, m as number, texto); }
    }
    await answerCb(BOT, cq.id, ok ? "Aprobado ✅" : "Denegado ❌");
    return json({ ok: true });
  }

  if (update.message) {
    const msg = update.message;
    const text = String(msg.text ?? "").trim();
    if (text.startsWith("/id")) {
      await sendMessage(BOT, msg.chat.id, `chat_id: <code>${msg.chat.id}</code>\ntu id: <code>${msg.from.id}</code>`);
      return json({ ok: true });
    }
    if (text.startsWith("/registrarme")) {
      if (cfg.REGISTRO_CLAVE) {
        const clave = text.split(/\s+/)[1] ?? "";
        if (clave !== cfg.REGISTRO_CLAVE) { await sendMessage(BOT, msg.chat.id, "⛔ Clave incorrecta."); return json({ ok: true }); }
      }
      await registrar(cfg, msg.from, (t) => sendMessage(BOT, msg.chat.id, t));
      return json({ ok: true });
    }
    return json({ ok: true });
  }
  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "method" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const cfg = await getConfig();

  // Webhook de Telegram (validado por secret token del header)
  const tgSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (tgSecret !== null) {
    if (!cfg.WEBHOOK_SECRET || tgSecret !== cfg.WEBHOOK_SECRET) return json({ error: "bad_secret" }, 401);
    return await handleTelegramUpdate(cfg, body);
  }

  const isAdmin = ["set_webhook", "status", "escalar", "test_card"].includes(body.action);
  if (isAdmin) {
    if (!cfg.ADMIN_SECRET || (req.headers.get("x-admin-secret") ?? "") !== cfg.ADMIN_SECRET)
      return json({ error: "unauthorized" }, 401);
    if (body.action === "status")    return json({ ok: true, telegram: await tg(cfg.BOT, "getWebhookInfo", {}) });
    if (body.action === "escalar")   return await escalar(cfg);
    if (body.action === "test_card") {
      const { data: ins } = await service.from("egresos_solicitudes").insert({
        store_code: body.store_code ?? "S004", monto: 1, motivo_nombre: "PRUEBA (no es un egreso real)",
        comentario: "Tarjeta de prueba del circuito de aprobación.", solicitante_nombre: "Sistema (prueba)",
        modo: "sombra",
      }).select("*").single();
      const sent: any = await sendMessage(cfg.BOT, cfg.CHAT,
        tarjeta(ins, await nombreSucursal(ins!.store_code), false), keyboard(ins!.id));
      if (sent?.ok) await service.from("egresos_solicitudes").update({
        tg_grupo_chat_id: String(sent.result.chat.id), tg_grupo_message_id: sent.result.message_id,
        escalado_at: new Date().toISOString() }).eq("id", ins!.id);
      return json({ ok: true, id: ins!.id, sent: !!sent?.ok });
    }
    const url = `${SUPABASE_URL}/functions/v1/egresos-aprobaciones`;
    return json({ ok: true, url, telegram: await tg(cfg.BOT, "setWebhook", {
      url, secret_token: cfg.WEBHOOK_SECRET, allowed_updates: ["callback_query", "message"] }) });
  }

  if (body.action === "crear") return await crear(cfg, body);
  return json({ error: "bad_request" }, 400);
});
