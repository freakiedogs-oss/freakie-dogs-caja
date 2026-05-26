/**
 * cron_kaeru_resumen_semanal.gs — Digest semanal a los 4 socios
 * Kaeru Chan ERP — v0.14.0
 *
 * Trigger: domingo 8am hora SV. Envía un resumen al grupo Telegram con:
 *   • Ventas semana (lun-dom previa) · Mesa vs PeYa
 *   • Promedio diario y comparativo vs semana anterior
 *   • Utilidad neta MTD (margen %)
 *   • Top 5 productos por revenue de la semana
 *   • Ingredientes bajo mínimo (stock crítico)
 *   • Pendientes/amonestaciones de la semana
 *
 * Self-contained: no depende de _lib.gs. Lazy init Supabase + Telegram hardcoded
 * (@FreakieDogsMonitor mismo bot/chat que los demás crons).
 *
 * Setup:
 *   1. Pegar este archivo en el proyecto "Kaeru Chan ERP — Automation"
 *   2. Script Properties requeridas: KAERU_SUPABASE_URL + KAERU_SUPABASE_KEY
 *   3. Test manual sin Telegram: kaeru_resumen_test()
 *   4. Test enviando Telegram:   kaeru_resumen_semanal()
 *   5. Activar trigger:           kaeru_resumen_activar_trigger()
 */

// ============================================================
// Config compartida (mismo patrón que cron_kaeru_telegram_alerts.gs)
// ============================================================
function _kaeruResumenSupaConfig() {
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

var KAERU_RESUMEN_BOT_TOKEN = '8783426656:AAFVCUeb980IGoAZtv_mOP7ydrlEx7FDIZU'; // @FreakieDogsMonitor
var KAERU_RESUMEN_CHAT_ID   = '8547715106';

function _kaeruResumenTelegram(text) {
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + KAERU_RESUMEN_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      payload: {
        chat_id: KAERU_RESUMEN_CHAT_ID,
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

function _kaeruResumenQuery(table, queryString) {
  var supa = _kaeruResumenSupaConfig();
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

function _kaeruDateISO(d) {
  return Utilities.formatDate(d, 'America/El_Salvador', 'yyyy-MM-dd');
}

function _kaeruYM(d) {
  return Utilities.formatDate(d, 'America/El_Salvador', 'yyyy-MM');
}

/** Lunes 00:00 de la semana que contiene la fecha dada */
function _kaeruLunesDe(d) {
  var x = new Date(d);
  var day = x.getDay();             // 0=dom, 1=lun
  var diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Domingo 23:59 de la semana que contiene la fecha dada */
function _kaeruDomingoDe(d) {
  var lun = _kaeruLunesDe(d);
  var dom = new Date(lun);
  dom.setDate(lun.getDate() + 6);
  dom.setHours(23, 59, 59, 0);
  return dom;
}

function _fmtUSD(n) {
  return '$' + (Number(n) || 0).toFixed(2);
}

function _fmtPct(n) {
  if (!isFinite(n)) return '·';
  var s = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  return s;
}

// ============================================================
// MAIN — Resumen semanal
// ============================================================
function kaeru_resumen_semanal() {
  try {
    var now = new Date();
    // Trigger corre domingo 8am → "semana cerrada" = semana inmediata anterior (lun-dom previo).
    // Sacamos 1 día (sábado) para que _kaeruLunesDe nos dé el lunes de la semana cerrada.
    var ref = new Date(now);
    ref.setDate(now.getDate() - 1);

    var lunes  = _kaeruLunesDe(ref);
    var domingo = _kaeruDomingoDe(ref);
    var lunesPrev = new Date(lunes); lunesPrev.setDate(lunes.getDate() - 7);
    var domingoPrev = new Date(domingo); domingoPrev.setDate(domingo.getDate() - 7);

    var lunesISO   = _kaeruDateISO(lunes);
    var domingoISO = _kaeruDateISO(domingo);
    var lunesPrevISO = _kaeruDateISO(lunesPrev);
    var domingoPrevISO = _kaeruDateISO(domingoPrev);

    // ─── Ventas semana cerrada ─────────────────────────────────
    var ventasSem = _kaeruResumenQuery('ventas',
      '?estado=neq.anulada' +
      '&fecha_hora=gte.' + lunesISO + 'T00:00:00' +
      '&fecha_hora=lte.' + domingoISO + 'T23:59:59' +
      '&select=total,canal,fecha_hora,propina'
    ) || [];
    var ventasPrev = _kaeruResumenQuery('ventas',
      '?estado=neq.anulada' +
      '&fecha_hora=gte.' + lunesPrevISO + 'T00:00:00' +
      '&fecha_hora=lte.' + domingoPrevISO + 'T23:59:59' +
      '&select=total'
    ) || [];

    var totalSem = ventasSem.reduce(function(s, v) { return s + Number(v.total || 0); }, 0);
    var totalPrev = ventasPrev.reduce(function(s, v) { return s + Number(v.total || 0); }, 0);
    var mesaSem = ventasSem.filter(function(v) { return v.canal === 'mesa'; }).reduce(function(s, v) { return s + Number(v.total || 0); }, 0);
    var peyaSem = ventasSem.filter(function(v) { return v.canal === 'peya'; }).reduce(function(s, v) { return s + Number(v.total || 0); }, 0);
    var propinasSem = ventasSem.reduce(function(s, v) { return s + Number(v.propina || 0); }, 0);
    var diasOp = (function() {
      var set = {};
      ventasSem.forEach(function(v) { set[v.fecha_hora.slice(0, 10)] = 1; });
      return Object.keys(set).length;
    })();
    var promDiario = diasOp > 0 ? totalSem / diasOp : 0;
    var deltaPct = totalPrev > 0 ? ((totalSem - totalPrev) / totalPrev) * 100 : 0;

    // ─── Utilidad MTD ──────────────────────────────────────────
    var ymActual = _kaeruYM(now);
    var rent = _kaeruResumenQuery('v_rentabilidad_mensual', '?mes=eq.' + ymActual + '&select=*');
    var rentRow = (rent && rent.length > 0) ? rent[0] : null;
    var utilidadNeta = rentRow ? Number(rentRow.utilidad_neta || 0) : 0;
    var ventasMes = rentRow ? Number(rentRow.ventas_total || 0) : 0;
    var margenPct = ventasMes > 0 ? (utilidadNeta / ventasMes) * 100 : 0;

    // ─── Top 5 productos de la semana ──────────────────────────
    var detSem = _kaeruResumenQuery('venta_detalles',
      '?ventas.estado=neq.anulada' +
      '&ventas.fecha_hora=gte.' + lunesISO + 'T00:00:00' +
      '&ventas.fecha_hora=lte.' + domingoISO + 'T23:59:59' +
      '&select=cantidad,subtotal,productos:producto_id(codigo,nombre),ventas:venta_id!inner(fecha_hora,estado)' +
      '&limit=5000'
    ) || [];
    var prodAcc = {};
    detSem.forEach(function(r) {
      var p = r.productos; if (!p) return;
      if (!prodAcc[p.codigo]) prodAcc[p.codigo] = { codigo: p.codigo, nombre: p.nombre, vendidos: 0, revenue: 0 };
      prodAcc[p.codigo].vendidos += Number(r.cantidad || 0);
      prodAcc[p.codigo].revenue  += Number(r.subtotal || 0);
    });
    var top5 = Object.keys(prodAcc).map(function(k) { return prodAcc[k]; })
      .sort(function(a, b) { return b.revenue - a.revenue; })
      .slice(0, 5);

    // ─── Stock bajo ────────────────────────────────────────────
    var ingredientes = _kaeruResumenQuery('ingredientes',
      '?activo=eq.true&stock_minimo=gt.0&select=codigo,nombre,unidad,stock_actual,stock_minimo'
    ) || [];
    var bajos = ingredientes.filter(function(i) {
      return Number(i.stock_actual || 0) < Number(i.stock_minimo || 0);
    });

    // ─── Pendientes (notificaciones inbox no leídas) ───────────
    // Tabla opcional — si falla devolvemos 0 sin abortar
    var pendientes = 0;
    try {
      var notif = _kaeruResumenQuery('notificaciones',
        '?leida=eq.false&select=id&limit=200'
      ) || [];
      pendientes = notif.length;
    } catch (e) {
      Logger.log('Notificaciones no disponible: ' + e.message);
    }

    // ─── Amonestaciones de la semana ───────────────────────────
    var amonest = 0;
    try {
      var am = _kaeruResumenQuery('amonestaciones',
        '?fecha=gte.' + lunesISO + '&fecha=lte.' + domingoISO + '&select=id&limit=200'
      ) || [];
      amonest = am.length;
    } catch (e) {
      Logger.log('Amonestaciones no disponible: ' + e.message);
    }

    // ─── Render Markdown ───────────────────────────────────────
    var rangoTxt = lunesISO + ' → ' + domingoISO;
    var pctMesa = totalSem > 0 ? (mesaSem / totalSem) * 100 : 0;
    var pctPeya = totalSem > 0 ? (peyaSem / totalSem) * 100 : 0;

    var msg = '🐸 *KAERU 蛙 — Resumen semanal*\n';
    msg += '_' + rangoTxt + '_\n';
    msg += '━━━━━━━━━━━━━━━━━━\n\n';

    msg += '💰 *VENTAS:* ' + _fmtUSD(totalSem) + '  (' + _fmtPct(deltaPct) + ' vs sem prev)\n';
    msg += '   ' + diasOp + ' días op · prom ' + _fmtUSD(promDiario) + '/día\n';
    msg += '   🍜 Mesa: ' + _fmtUSD(mesaSem) + ' (' + pctMesa.toFixed(0) + '%)\n';
    msg += '   🛵 PeYa: ' + _fmtUSD(peyaSem) + ' (' + pctPeya.toFixed(0) + '%)\n';
    msg += '   💵 Propinas: ' + _fmtUSD(propinasSem) + '\n\n';

    msg += '📊 *UTILIDAD MTD (' + ymActual + '):*\n';
    if (rentRow) {
      msg += '   Neta: ' + _fmtUSD(utilidadNeta) + ' · margen ' + margenPct.toFixed(1) + '%\n';
      msg += '   Ventas mes: ' + _fmtUSD(ventasMes) + '\n\n';
    } else {
      msg += '   _Sin datos en v_rentabilidad_mensual_\n\n';
    }

    msg += '🏆 *TOP 5 productos:*\n';
    if (top5.length === 0) {
      msg += '   _Sin ventas registradas_\n\n';
    } else {
      top5.forEach(function(p, i) {
        msg += '   ' + (i + 1) + '. ' + p.nombre + ' — ' + _fmtUSD(p.revenue) + ' (' + p.vendidos.toFixed(0) + ')\n';
      });
      msg += '\n';
    }

    msg += '📦 *STOCK BAJO:* ' + bajos.length + ' ingrediente(s)\n';
    if (bajos.length > 0) {
      bajos.slice(0, 6).forEach(function(b) {
        msg += '   • ' + b.nombre + ': ' + b.stock_actual + ' ' + b.unidad + ' (min ' + b.stock_minimo + ')\n';
      });
      if (bajos.length > 6) msg += '   _…y ' + (bajos.length - 6) + ' más_\n';
      msg += '\n';
    } else {
      msg += '   ✓ todos los ingredientes OK\n\n';
    }

    msg += '⚠️ *PENDIENTES:*\n';
    msg += '   • Inbox notificaciones: ' + pendientes + '\n';
    msg += '   • Amonestaciones esta semana: ' + amonest + '\n\n';

    msg += '━━━━━━━━━━━━━━━━━━\n';
    msg += '🌐 erp: https://kaeru-chan-erp.vercel.app';

    _kaeruResumenTelegram(msg);
    Logger.log('Resumen semanal enviado ✓');
    return msg;
  } catch (e) {
    Logger.log('kaeru_resumen_semanal error: ' + e.message);
    try { _kaeruResumenTelegram('❌ 🐸 *KAERU 蛙 — resumen_semanal FALLÓ*\n\n' + e.message); } catch (_) {}
    throw e;
  }
}

// ============================================================
// Test manual SIN enviar Telegram — solo loggea el mensaje
// ============================================================
function kaeru_resumen_test() {
  // Mock telegramSend temporalmente
  var realSend = _kaeruResumenTelegram;
  // eslint-disable-next-line no-global-assign
  _kaeruResumenTelegram = function(text) {
    Logger.log('=== Mensaje que se enviaría ===\n' + text);
    return true;
  };
  try {
    kaeru_resumen_semanal();
  } finally {
    // eslint-disable-next-line no-global-assign
    _kaeruResumenTelegram = realSend;
  }
}

// ============================================================
// Trigger management
// ============================================================
function kaeru_resumen_activar_trigger() {
  // Limpiar triggers existentes del mismo handler
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'kaeru_resumen_semanal') {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }
  Logger.log('Triggers existentes eliminados: ' + deleted);

  // Crear nuevo: domingo 8am hora SV
  ScriptApp.newTrigger('kaeru_resumen_semanal')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(8)
    .inTimezone('America/El_Salvador')
    .create();
  Logger.log('✓ kaeru_resumen_semanal → domingo 8am hora SV');
}

function kaeru_resumen_desactivar_trigger() {
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'kaeru_resumen_semanal') {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }
  Logger.log('Triggers eliminados: ' + deleted);
}
