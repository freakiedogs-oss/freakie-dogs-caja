/**
 * cron_kaeru_telegram_alerts.gs — 3 crons operativos en un solo archivo
 * Kaeru Chan ERP — v0.10.0
 *
 * Reemplaza los 3 stubs viejos que dependían de _lib.gs (cron_alerta_pos_bac,
 * cron_cierre_diario, cron_stock_bajo). Self-contained con lazy init y
 * Telegram hardcoded al bot @FreakieDogsMonitor — mismo chat que DevOps Freakies.
 *
 * Triggers:
 *   - kaeru_alerta_pos_bac      → diario 11pm  (alerta si POS BAC no se cerró)
 *   - kaeru_cierre_diario       → diario 10pm  (resumen del día al chat)
 *   - kaeru_stock_bajo          → cada 6h      (ingredientes bajo mínimo)
 *
 * Setup en Apps Script:
 *   1. Pegar este archivo en el proyecto "Kaeru Chan ERP — Automation"
 *   2. Script Properties requeridas: KAERU_SUPABASE_URL + KAERU_SUPABASE_KEY
 *   3. Test manual: kaeru_alerts_test() — corre las 3 sin mandar Telegram
 *   4. Activar: kaeru_alerts_activar_triggers()
 */

// ============================================================
// Lazy config Supabase + Telegram hardcoded
// ============================================================
function _kaeruAlertsSupaConfig() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('KAERU_SUPABASE_URL') || p.getProperty('SUPABASE_URL');
  var key = p.getProperty('KAERU_SUPABASE_KEY') || p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) {
    throw new Error('Faltan KAERU_SUPABASE_URL/KAERU_SUPABASE_KEY en Script Properties');
  }
  return {
    url:    url,
    key:    key,
    schema: p.getProperty('KAERU_SUPABASE_SCHEMA') || p.getProperty('SUPABASE_SCHEMA') || 'kaeru'
  };
}

// Mismo bot que cron_notif_barrer.gs y los crons de DevOps Freakies
var KAERU_ALERTS_BOT_TOKEN = '8783426656:AAFVCUeb980IGoAZtv_mOP7ydrlEx7FDIZU'; // @FreakieDogsMonitor
var KAERU_ALERTS_CHAT_ID   = '8547715106';                                     // Jose

function _kaeruAlertsTelegram(text) {
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + KAERU_ALERTS_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      payload: {
        chat_id: KAERU_ALERTS_CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
      },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    Logger.log('Telegram [' + code + ']: ' + res.getContentText().substring(0, 200));
    return code < 300;
  } catch (e) {
    Logger.log('Telegram error: ' + (e.message || String(e)));
    return false;
  }
}

function _kaeruAlertsQuery(table, queryString) {
  var supa = _kaeruAlertsSupaConfig();
  var url = supa.url + '/rest/v1/' + table + (queryString || '');
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': supa.key,
      'Authorization': 'Bearer ' + supa.key,
      'Accept-Profile': supa.schema
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 400) {
    throw new Error('Supabase query failed [' + code + ']: ' + res.getContentText().substring(0, 200));
  }
  return JSON.parse(res.getContentText());
}

function _kaeruHoyISO() {
  return Utilities.formatDate(new Date(), 'America/El_Salvador', 'yyyy-MM-dd');
}

// ============================================================
// CRON 1 — Alerta si POS BAC no se cerró (diario 11pm)
// Sin cierre POS → BAC no liquida → conciliación rota al día siguiente.
// ============================================================
function kaeru_alerta_pos_bac() {
  try {
    var hoy = _kaeruHoyISO();
    var liq = _kaeruAlertsQuery('liquidacion_pos', '?fecha_cierre=eq.' + hoy + '&select=id');
    if (liq && liq.length > 0) {
      Logger.log('POS BAC cerrado hoy (' + hoy + ') — sin alerta');
      return;
    }
    _kaeruAlertsTelegram(
      '⚠️ 🐸 *KAERU 蛙 — POS BAC NO se cerró hoy (' + hoy + ')*\n\n' +
      'No se registró cierre POS para hoy. Si no se cierra antes de fin de día, BAC NO liquida mañana y la conciliación va a saltar.\n\n' +
      '*Acción:* ir físicamente al datafono BAC y presionar CIERRE antes de medianoche.'
    );
  } catch (e) {
    Logger.log('kaeru_alerta_pos_bac error: ' + e.message);
    try { _kaeruAlertsTelegram('❌ 🐸 *KAERU 蛙 — alerta_pos_bac FALLÓ*\n\n' + e.message); } catch (_) {}
    throw e;
  }
}

// ============================================================
// CRON 2 — Resumen diario del cierre de caja (diario 10pm)
// ============================================================
function kaeru_cierre_diario() {
  try {
    var hoy = _kaeruHoyISO();
    var cierres = _kaeruAlertsQuery('cierre_caja', '?fecha=eq.' + hoy + '&select=*');

    if (!cierres || cierres.length === 0) {
      _kaeruAlertsTelegram(
        '🚨 🐸 *KAERU 蛙 — Cierre de caja pendiente*\n\n' +
        'El cierre del ' + hoy + ' aún no se ha registrado en el ERP.\n\n' +
        'Yessica / manager de turno — completar en https://kaeru-chan-erp.vercel.app/cierre'
      );
      return;
    }

    var c = cierres[0];
    var fmt = function(n) { return '$' + (Number(n) || 0).toFixed(2); };
    var dif = Number(c.diferencia) || 0;
    var difEmoji = Math.abs(dif) < 1 ? '✓' : Math.abs(dif) < 5 ? '🟡' : '🔴';

    var msg = '🍜 🐸 *KAERU 蛙 — Cierre ' + hoy + '*\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '💵 Esperado: ' + fmt(c.total_esperado) + '\n' +
      '💰 Contado:  ' + fmt(c.efectivo_contado) + '\n' +
      difEmoji + ' Dif:      ' + fmt(dif) + '\n\n' +
      '*Por método de pago:*\n' +
      '  Efectivo:   ' + fmt(c.ventas_efectivo) + '\n' +
      '  Tarjeta:    ' + fmt(c.ventas_tarjeta) + '\n' +
      '  Transfer:   ' + fmt(c.ventas_transferencia) + '\n' +
      '  PeYa:       ' + fmt(c.ventas_peya) + '\n\n' +
      '💸 Propinas: ' + fmt(c.propinas_total) + '\n' +
      '🏦 A depositar: ' + fmt(c.efectivo_a_depositar) + '\n' +
      '🪙 A caja chica: ' + fmt(c.efectivo_a_caja_chica);

    _kaeruAlertsTelegram(msg);
  } catch (e) {
    Logger.log('kaeru_cierre_diario error: ' + e.message);
    try { _kaeruAlertsTelegram('❌ 🐸 *KAERU 蛙 — cierre_diario FALLÓ*\n\n' + e.message); } catch (_) {}
    throw e;
  }
}

// ============================================================
// CRON 3 — Stock bajo (cada 6h)
// Alerta cuando ingredientes activos tienen stock_actual < stock_minimo.
// ============================================================
function kaeru_stock_bajo() {
  try {
    // PostgREST no soporta column-vs-column en lt directo, así que filtramos
    // por stock_minimo > 0 y comparamos en JS.
    var ingredientes = _kaeruAlertsQuery('ingredientes',
      '?activo=eq.true&stock_minimo=gt.0&select=codigo,nombre,unidad,stock_actual,stock_minimo'
    );
    var bajos = (ingredientes || []).filter(function(i) {
      return Number(i.stock_actual || 0) < Number(i.stock_minimo || 0);
    });

    if (bajos.length === 0) {
      Logger.log('Stock OK — sin alerta');
      return;
    }

    var lines = bajos.map(function(b) {
      return '  • ' + b.nombre + ' (' + b.codigo + '): ' + b.stock_actual + ' ' + b.unidad +
             ' (min ' + b.stock_minimo + ')';
    });

    var emoji = bajos.length >= 5 ? '🔴' : '⚠️';
    var msg = emoji + ' 🐸 *KAERU 蛙 — Stock bajo (' + bajos.length + ')*\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      lines.join('\n') +
      '\n\nAvisar a Yessica para reorden.';

    _kaeruAlertsTelegram(msg);
  } catch (e) {
    Logger.log('kaeru_stock_bajo error: ' + e.message);
    try { _kaeruAlertsTelegram('❌ 🐸 *KAERU 蛙 — stock_bajo FALLÓ*\n\n' + e.message); } catch (_) {}
    throw e;
  }
}

// ============================================================
// Test manual de las 3 funciones (sin mandar Telegram)
// ============================================================
function kaeru_alerts_test() {
  Logger.log('=== Test alerta_pos_bac ===');
  try {
    var hoy = _kaeruHoyISO();
    var liq = _kaeruAlertsQuery('liquidacion_pos', '?fecha_cierre=eq.' + hoy + '&select=id');
    Logger.log('  POS BAC hoy: ' + (liq && liq.length > 0 ? 'cerrado ✓' : 'NO cerrado ✗ (mandaría alerta)'));
  } catch (e) { Logger.log('  ERROR: ' + e.message); }

  Logger.log('\n=== Test cierre_diario ===');
  try {
    var hoy2 = _kaeruHoyISO();
    var c = _kaeruAlertsQuery('cierre_caja', '?fecha=eq.' + hoy2 + '&select=*');
    Logger.log('  Cierre hoy: ' + (c && c.length > 0 ? 'sí (mandaría resumen)' : 'no (mandaría alerta pendiente)'));
  } catch (e) { Logger.log('  ERROR: ' + e.message); }

  Logger.log('\n=== Test stock_bajo ===');
  try {
    var ing = _kaeruAlertsQuery('ingredientes', '?activo=eq.true&stock_minimo=gt.0&select=codigo,nombre,stock_actual,stock_minimo');
    var bajos = (ing || []).filter(function(i) { return Number(i.stock_actual || 0) < Number(i.stock_minimo || 0); });
    Logger.log('  Stock bajo: ' + bajos.length + ' ingrediente(s) (mandaría alerta si >0)');
    if (bajos.length > 0) Logger.log('  → ' + bajos.map(function(b) { return b.codigo; }).join(', '));
  } catch (e) { Logger.log('  ERROR: ' + e.message); }
}

// ============================================================
// Triggers — activar / desactivar idempotente
// ============================================================
var KAERU_ALERTS_HANDLERS = ['kaeru_alerta_pos_bac', 'kaeru_cierre_diario', 'kaeru_stock_bajo'];

function kaeru_alerts_activar_triggers() {
  // Limpiar triggers existentes de estos handlers
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    if (KAERU_ALERTS_HANDLERS.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }
  Logger.log('Triggers existentes eliminados: ' + deleted);

  // Crear los 3 nuevos
  ScriptApp.newTrigger('kaeru_cierre_diario')
    .timeBased()
    .everyDays(1)
    .atHour(22)
    .inTimezone('America/El_Salvador')
    .create();
  Logger.log('✓ kaeru_cierre_diario → diario 10pm hora SV');

  ScriptApp.newTrigger('kaeru_alerta_pos_bac')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .inTimezone('America/El_Salvador')
    .create();
  Logger.log('✓ kaeru_alerta_pos_bac → diario 11pm hora SV');

  ScriptApp.newTrigger('kaeru_stock_bajo')
    .timeBased()
    .everyHours(6)
    .create();
  Logger.log('✓ kaeru_stock_bajo → cada 6h');
}

function kaeru_alerts_desactivar_triggers() {
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    if (KAERU_ALERTS_HANDLERS.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }
  Logger.log('Triggers de kaeru alerts eliminados: ' + deleted);
}
