/**
 * cron_notif_barrer.gs — Barrer generadores del inbox in-app
 * Kaeru Chan ERP — Automation
 *
 * Trigger: Time-driven, cada 30 minutos.
 * Llama al RPC kaeru.notif_barrer() vía PostgREST, que re-evalúa los 5
 * generadores (dte_sin_clasificar, stock_bajo, cierre_pendiente,
 * planilla_pendiente, dte_sin_pago) y crea/actualiza notificaciones
 * con dedupe_key diario.
 *
 * Si hay alerta crítica o cambios reales, manda mensaje al grupo Telegram
 * (solo si TELEGRAM_BOT_TOKEN está configurado — silencioso si no).
 *
 * Self-contained: NO depende de _lib.gs (lazy init de Script Properties).
 *
 * Setup:
 *   1. Pegar este archivo en cualquier proyecto Apps Script
 *   2. Script Properties requeridas:
 *      - SUPABASE_URL          (https://btboxlwfqcbrdfrlnwln.supabase.co)
 *      - SUPABASE_SERVICE_KEY  (service_role key)
 *      - SUPABASE_SCHEMA       (kaeru) — opcional, default 'kaeru'
 *      - TELEGRAM_BOT_TOKEN    (opcional — si falta, no notifica)
 *      - TELEGRAM_CHAT_ID      (opcional)
 *   3. Test: kaeru_notif_barrer_test() — corre sin Telegram, ver logs
 *   4. Activar trigger: kaeru_notif_barrer_activar_triggers()
 */

// ============================================================
// Lazy config — se lee al ejecutar, no al cargar el módulo
// ============================================================
function _kaeruSupaConfig() {
  var p = PropertiesService.getScriptProperties();
  // Buscar primero con prefix KAERU_ (proyecto compartido con Freakies),
  // fallback a sin prefix (proyecto standalone). Key puede ser KAERU_SUPABASE_KEY
  // o SUPABASE_SERVICE_KEY (nombres distintos por convención histórica).
  var url = p.getProperty('KAERU_SUPABASE_URL') || p.getProperty('SUPABASE_URL');
  var key = p.getProperty('KAERU_SUPABASE_KEY') || p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) {
    throw new Error('Faltan Script Properties: necesito KAERU_SUPABASE_URL+KAERU_SUPABASE_KEY o SUPABASE_URL+SUPABASE_SERVICE_KEY');
  }
  return {
    url:    url,
    key:    key,
    schema: p.getProperty('KAERU_SUPABASE_SCHEMA') || p.getProperty('SUPABASE_SCHEMA') || 'kaeru'
  };
}

// ============================================================
// Telegram — patrón Freakies: hardcoded.
// Bot: @FreakieDogsMonitor (el mismo donde recibís alertas DevOps Freakies).
// Chat: 8547715106 (chat de Jose donde llegan todas las alertas operativas).
// Cuando exista grupo dedicado de socios Kaeru, cambiar KAERU_TG_CHAT_ID.
// ============================================================
var KAERU_TG_BOT_TOKEN = '8783426656:AAFVCUeb980IGoAZtv_mOP7ydrlEx7FDIZU'; // @FreakieDogsMonitor
var KAERU_TG_CHAT_ID   = '8547715106';                                     // Jose — mismo que DevOps Freakies

function _kaeruTelegramConfig() {
  return { token: KAERU_TG_BOT_TOKEN, chat: KAERU_TG_CHAT_ID };
}

// ============================================================
// Llama el RPC notif_barrer() del schema kaeru
// ============================================================
function kaeru_notif_barrer_rpc() {
  var supa = _kaeruSupaConfig();
  var url = supa.url + '/rest/v1/rpc/notif_barrer';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': supa.key,
      'Authorization': 'Bearer ' + supa.key,
      'Content-Profile': supa.schema,
      'Accept-Profile':  supa.schema
    },
    payload: '{}',
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 400) {
    throw new Error('notif_barrer RPC failed [' + code + ']: ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

// ============================================================
// Count de alertas activas por severidad
// ============================================================
function kaeru_notif_count_activas() {
  var supa = _kaeruSupaConfig();
  function countBy(sev) {
    var url = supa.url + '/rest/v1/notificaciones'
      + '?resuelta_en=is.null'
      + (sev ? '&severidad=eq.' + sev : '');
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'apikey': supa.key,
        'Authorization': 'Bearer ' + supa.key,
        'Accept-Profile': supa.schema,
        'Range-Unit': 'items',
        'Range': '0-0',
        'Prefer': 'count=exact'
      },
      muteHttpExceptions: true
    });
    var contentRange = res.getAllHeaders()['Content-Range'] || res.getAllHeaders()['content-range'] || '';
    var m = String(contentRange).match(/\/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  }
  return {
    total:   countBy(null),
    danger:  countBy('danger'),
    warning: countBy('warning'),
    info:    countBy('info')
  };
}

// ============================================================
// Telegram send — silencioso si no hay token configurado
// ============================================================
function _kaeruTelegramSend(text) {
  var tg = _kaeruTelegramConfig();
  if (!tg.token || !tg.chat) {
    Logger.log('Telegram no configurado (faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID) — skip notif');
    return false;
  }
  var url = 'https://api.telegram.org/bot' + tg.token + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: tg.chat,
      text: text,
      parse_mode: 'Markdown'
    }),
    muteHttpExceptions: true
  });
  return true;
}

// ============================================================
// Compose mensaje Telegram (null = no mandar)
// ============================================================
function kaeru_notif_compose_telegram(rpcResult, counts) {
  var hayDanger = counts.danger > 0;
  var hayActividadHoy = (rpcResult || []).some(function(r) { return r.cantidad > 0; });
  if (!hayDanger && !hayActividadHoy) return null;

  // Prefix 🐸 蛙 KAERU para distinguir en el grupo compartido con Freakies.
  var lines = [];
  if (hayDanger) {
    lines.push('🚨 🐸 *KAERU 蛙 — alerta crítica*');
  } else {
    lines.push('🐸 *KAERU 蛙 — Inbox barrido*');
  }
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('*Activas no leídas:*');
  lines.push('  • 🚨 Críticas: ' + counts.danger);
  lines.push('  • ⚠ Atención: ' + counts.warning);
  lines.push('  • ℹ Info: ' + counts.info);
  lines.push('  *Total:* ' + counts.total);

  if (hayActividadHoy) {
    lines.push('');
    lines.push('*Generadores hoy:*');
    (rpcResult || []).forEach(function(r) {
      if (r.cantidad > 0) {
        lines.push('  • ' + String(r.generador).replace(/_/g, ' ') + ': ' + r.cantidad);
      }
    });
  }

  lines.push('');
  lines.push('👉 https://kaeru-chan-erp.vercel.app/inbox');

  return lines.join('\n');
}

// ============================================================
// Trigger principal — cada 30 min
// ============================================================
var KAERU_NOTIF_HANDLER_FUNCTIONS = ['kaeru_notif_barrer_cron'];

function kaeru_notif_barrer_cron() {
  try {
    var rpcResult = kaeru_notif_barrer_rpc();
    var counts    = kaeru_notif_count_activas();
    var msg       = kaeru_notif_compose_telegram(rpcResult, counts);
    if (msg) _kaeruTelegramSend(msg);
    Logger.log('barrer ok: ' + JSON.stringify(rpcResult) + ' counts=' + JSON.stringify(counts));
  } catch (e) {
    var err = '❌ 🐸 *KAERU 蛙 — notif barrer FALLÓ*\n\n' + (e.message || String(e));
    try { _kaeruTelegramSend(err); } catch (_) {/* no romper si Telegram falla */}
    throw e;
  }
}

// ============================================================
// Test manual — sin mandar Telegram, solo logs
// ============================================================
function kaeru_notif_barrer_test() {
  var rpcResult = kaeru_notif_barrer_rpc();
  var counts    = kaeru_notif_count_activas();
  Logger.log('RPC: ' + JSON.stringify(rpcResult));
  Logger.log('Counts: ' + JSON.stringify(counts));
  var msg = kaeru_notif_compose_telegram(rpcResult, counts);
  Logger.log('Msg Telegram: ' + (msg || '(sin mensaje — no hay danger ni actividad)'));
  return { rpc: rpcResult, counts: counts, msg: msg };
}

// ============================================================
// Activar trigger 30 min — idempotente
// ============================================================
function kaeru_notif_barrer_activar_triggers() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (KAERU_NOTIF_HANDLER_FUNCTIONS.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('kaeru_notif_barrer_cron')
    .timeBased()
    .everyMinutes(30)
    .create();
  Logger.log('Trigger kaeru_notif_barrer_cron activado cada 30 min');
}

function kaeru_notif_barrer_desactivar_triggers() {
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    if (KAERU_NOTIF_HANDLER_FUNCTIONS.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }
  Logger.log('Triggers de notif_barrer eliminados: ' + deleted);
}
