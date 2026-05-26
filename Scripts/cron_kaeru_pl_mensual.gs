/**
 * cron_kaeru_pl_mensual.gs — PDF/HTML mensual de rentabilidad al chat
 * Kaeru Chan ERP — v0.10.0
 *
 * Trigger: día 1 de cada mes a las 8am hora SV.
 * Lee kaeru.v_rentabilidad_mensual del MES ANTERIOR, renderiza un
 * resumen formato Markdown (Telegram) + adjunta link a HTML imprimible
 * que vive en /rentabilidad de la app.
 *
 * Setup en Apps Script:
 *   1. Pegar este archivo en el proyecto "Kaeru Chan ERP — Automation"
 *   2. Script Properties requeridas: KAERU_SUPABASE_URL + KAERU_SUPABASE_KEY
 *   3. Test manual: kaeru_pl_mensual_test() — corre sin mandar Telegram
 *   4. Activar: kaeru_pl_mensual_activar_triggers()
 *
 * Email opcional: si querés enviar también por email a los socios,
 * agregar sus emails en KAERU_SOCIOS_EMAILS (separados por coma) en
 * Script Properties. Si está vacío, solo manda Telegram.
 */

// ============================================================
// Lazy config — patrón Kaeru estándar
// ============================================================
function _kaeruPlSupaConfig() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('KAERU_SUPABASE_URL') || p.getProperty('SUPABASE_URL');
  var key = p.getProperty('KAERU_SUPABASE_KEY') || p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Faltan KAERU_SUPABASE_URL/KAERU_SUPABASE_KEY');
  return {
    url:    url,
    key:    key,
    schema: p.getProperty('KAERU_SUPABASE_SCHEMA') || 'kaeru'
  };
}

function _kaeruPlSociosEmails() {
  var p = PropertiesService.getScriptProperties();
  var raw = p.getProperty('KAERU_SOCIOS_EMAILS') || '';
  return raw.split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e.length > 0; });
}

var KAERU_PL_BOT_TOKEN = '8783426656:AAFVCUeb980IGoAZtv_mOP7ydrlEx7FDIZU'; // @FreakieDogsMonitor
var KAERU_PL_CHAT_ID   = '8547715106';

function _kaeruPlTelegram(text) {
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + KAERU_PL_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      payload: {
        chat_id: KAERU_PL_CHAT_ID,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      },
      muteHttpExceptions: true
    });
    Logger.log('Telegram [' + res.getResponseCode() + ']');
    return res.getResponseCode() < 300;
  } catch (e) {
    Logger.log('Telegram error: ' + e.message);
    return false;
  }
}

// ============================================================
// Query a v_rentabilidad_mensual
// ============================================================
function _kaeruPlGetMes(mesIso) {
  var supa = _kaeruPlSupaConfig();
  var url = supa.url + '/rest/v1/v_rentabilidad_mensual?mes=eq.' + encodeURIComponent(mesIso) + '&select=*';
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': supa.key,
      'Authorization': 'Bearer ' + supa.key,
      'Accept-Profile': supa.schema
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) {
    throw new Error('Query v_rentabilidad_mensual fail [' + res.getResponseCode() + ']: ' + res.getContentText());
  }
  var data = JSON.parse(res.getContentText());
  return data && data.length > 0 ? data[0] : null;
}

// Mes ANTERIOR en formato YYYY-MM hora SV
function _kaeruPlMesAnterior() {
  var sv = new Date(Date.now() - 6 * 3600 * 1000);
  sv.setUTCDate(1);              // primer día del mes actual
  sv.setUTCDate(0);              // último día del mes anterior
  var y = sv.getUTCFullYear();
  var m = String(sv.getUTCMonth() + 1).padStart(2, '0');
  return y + '-' + m;
}

// ============================================================
// Render Markdown para Telegram
// ============================================================
function _kaeruPlComposeTelegram(row, mesLabel) {
  var fmt = function(n) {
    var v = Number(n) || 0;
    var s = (v >= 0 ? '$' : '-$') + Math.abs(v).toFixed(2);
    // Insertar comas en miles
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  var utilidad = Number(row.utilidad_neta) || 0;
  var emoji = utilidad > 0 ? '🟢' : utilidad === 0 ? '⚪' : '🔴';

  var lines = [];
  lines.push(emoji + ' 🐸 *KAERU 蛙 — P&L ' + mesLabel + '*');
  lines.push('━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('*Ventas:*');
  lines.push('  • Mesa:   ' + fmt(row.ventas_mesa));
  lines.push('  • PeYa:   ' + fmt(row.ventas_peya));
  lines.push('  • _Total bruto:_ ' + fmt(row.ventas_total));
  lines.push('');
  lines.push('*Deducciones de ventas:*');
  lines.push('  − Comisión PeYa:    ' + fmt(row.comision_peya));
  lines.push('  − Comisión POS BAC: ' + fmt(row.comision_pos_bac));
  lines.push('  *= Ingreso neto:* ' + fmt(row.ingreso_neto));
  lines.push('');
  lines.push('*Costos operativos:*');
  lines.push('  − COGS:          ' + fmt(row.cogs_estimado));
  lines.push('  − Planilla neta: ' + fmt(row.planilla_neta));
  lines.push('  − Aportes:       ' + fmt(row.planilla_aportes));
  lines.push('  − Propinas:      ' + fmt(row.propinas_pagadas));
  lines.push('  − Renta:         ' + fmt(row.renta));
  lines.push('  − Depreciación:  ' + fmt(row.depreciacion));
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━');
  lines.push('*' + emoji + ' Utilidad neta:* ' + fmt(utilidad));
  if (Number(row.ventas_total) > 0) {
    var margenPct = (utilidad / Number(row.ventas_total)) * 100;
    lines.push('Margen: ' + margenPct.toFixed(1) + '% sobre venta bruta');
  }
  lines.push('');
  lines.push('Ver desglose: https://kaeru-chan-erp.vercel.app/rentabilidad');

  return lines.join('\n');
}

// ============================================================
// Render HTML imprimible (para email opcional + link de archivo)
// ============================================================
function _kaeruPlComposeHTML(row, mesLabel) {
  var fmt = function(n) {
    var v = Number(n) || 0;
    var s = (v >= 0 ? '$' : '-$') + Math.abs(v).toFixed(2);
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  var utilidad = Number(row.utilidad_neta) || 0;
  var margenPct = Number(row.ventas_total) > 0 ? (utilidad / Number(row.ventas_total)) * 100 : 0;
  var color = utilidad > 0 ? '#5fe0a9' : utilidad === 0 ? '#a8a8a8' : '#e74c3c';
  var sign = utilidad > 0 ? '+' : utilidad === 0 ? '' : '−';

  function tr(label, val, isResta) {
    var v = Number(val) || 0;
    if (v === 0) return '';
    var c = isResta ? '#e74c3c' : '#f4f0e6';
    return '<tr><td style="padding:8px 0;color:#a8a8a8;font-size:13px;">' + (isResta ? '− ' : '') + label + '</td>' +
           '<td style="text-align:right;font-family:\'Bebas Neue\',sans-serif;color:' + c + ';font-size:15px;">' +
           (isResta ? '−' : '') + fmt(v) + '</td></tr>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<title>P&L ' + mesLabel + ' · Kaeru Chan</title>' +
    '<style>body{font-family:Arial,sans-serif;background:#0a0a0a;color:#f4f0e6;padding:32px;max-width:640px;margin:0 auto;}' +
    'h1{color:#5fe0a9;font-weight:200;font-size:32px;margin:0 0 6px;}' +
    'h2{color:#9a6fd1;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:24px 0 8px;}' +
    'table{width:100%;border-collapse:collapse;}' +
    '.neto-box{background:linear-gradient(135deg,rgba(95,224,169,0.15),rgba(154,111,209,0.15));border:1.5px solid ' + color + ';border-radius:12px;padding:20px;margin-top:24px;display:flex;justify-content:space-between;align-items:center;}' +
    '.neto-label{font-weight:700;font-size:14px;letter-spacing:1px;}' +
    '.neto-amt{color:' + color + ';font-family:\'Bebas Neue\',sans-serif;font-size:42px;font-weight:700;}' +
    '@media print{body{background:#fff;color:#222;}}' +
    '</style></head><body>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #5fe0a9;padding-bottom:16px;margin-bottom:24px;">' +
      '<div><span style="font-size:40px;color:#5fe0a9;">蛙</span> <h1>Kaeru Chan — P&L</h1></div>' +
      '<div style="text-align:right;color:#9a6fd1;font-size:14px;letter-spacing:2px;text-transform:uppercase;">' + mesLabel + '</div>' +
    '</div>' +
    '<h2>Ventas</h2><table>' +
      tr('Mesa', row.ventas_mesa) +
      tr('PedidosYa', row.ventas_peya) +
      '<tr style="border-top:1px solid #333;"><td style="padding-top:6px;font-weight:700;">Total bruto</td>' +
      '<td style="text-align:right;font-family:\'Bebas Neue\',sans-serif;font-weight:700;font-size:18px;color:#5fe0a9;">' + fmt(row.ventas_total) + '</td></tr>' +
    '</table>' +
    '<h2>Deducciones</h2><table>' +
      tr('Comisión PeYa (24%)', row.comision_peya, true) +
      tr('Comisión POS BAC', row.comision_pos_bac, true) +
      '<tr style="border-top:1px solid #333;"><td style="padding-top:6px;font-weight:700;">Ingreso neto</td>' +
      '<td style="text-align:right;font-family:\'Bebas Neue\',sans-serif;font-weight:700;font-size:18px;">' + fmt(row.ingreso_neto) + '</td></tr>' +
    '</table>' +
    '<h2>Costos operativos</h2><table>' +
      tr('COGS', row.cogs_estimado, true) +
      tr('Planilla neta', row.planilla_neta, true) +
      tr('Aportes patronales (ISSS/AFP)', row.planilla_aportes, true) +
      tr('Propinas pagadas', row.propinas_pagadas, true) +
      tr('Renta EPIC', row.renta, true) +
      tr('Depreciación CAPEX', row.depreciacion, true) +
    '</table>' +
    '<div class="neto-box"><div><div class="neto-label">UTILIDAD NETA</div>' +
      '<div style="font-size:11px;color:#a8a8a8;margin-top:4px;">margen ' + margenPct.toFixed(1) + '% sobre venta bruta</div></div>' +
      '<div class="neto-amt">' + sign + fmt(Math.abs(utilidad)) + '</div></div>' +
    '<p style="margin-top:32px;font-size:10px;color:#6b6b6b;text-align:center;line-height:1.6;">' +
      'Kaeru Chan, S.A. de C.V. · NIT 0623-010725-109-7 · NRC 366756-0<br>' +
      'EPIC Plaza, Nivel 2, Local #228, Nuevo Cuscatlán<br>' +
      'Generado por ERP Kaeru el ' + new Date().toLocaleString('es-SV') +
    '</p></body></html>';
}

// ============================================================
// Email opcional a los 4 socios (si KAERU_SOCIOS_EMAILS está configurado)
// ============================================================
function _kaeruPlEmailSocios(html, mesLabel) {
  var emails = _kaeruPlSociosEmails();
  if (emails.length === 0) {
    Logger.log('Sin emails de socios configurados (KAERU_SOCIOS_EMAILS) — skip email');
    return false;
  }
  try {
    GmailApp.sendEmail(emails.join(','), '🐸 Kaeru Chan — P&L ' + mesLabel, 'Adjunto el P&L del mes. También disponible en https://kaeru-chan-erp.vercel.app/rentabilidad', {
      htmlBody: html,
      name: 'Kaeru Chan ERP'
    });
    Logger.log('Email enviado a ' + emails.length + ' socio(s)');
    return true;
  } catch (e) {
    Logger.log('Email error: ' + e.message);
    return false;
  }
}

// ============================================================
// Trigger principal — día 1 de cada mes 8am SV
// ============================================================
var KAERU_PL_HANDLER = ['kaeru_pl_mensual_cron'];

function kaeru_pl_mensual_cron() {
  try {
    var mesIso = _kaeruPlMesAnterior();         // ej: '2026-05' si corre el 1-jun
    var mesLabel = _kaeruPlMesLabel(mesIso);    // ej: 'Mayo 2026'

    var row = _kaeruPlGetMes(mesIso);
    if (!row) {
      _kaeruPlTelegram('⚠ 🐸 *KAERU 蛙 — Sin data P&L ' + mesLabel + '*\n\nLa vista v_rentabilidad_mensual no retornó fila para ' + mesIso + '. Verificar que hay ventas en el mes.');
      return;
    }

    // Telegram resumen
    var msg = _kaeruPlComposeTelegram(row, mesLabel);
    _kaeruPlTelegram(msg);

    // Email a socios (opcional)
    var html = _kaeruPlComposeHTML(row, mesLabel);
    _kaeruPlEmailSocios(html, mesLabel);

    Logger.log('P&L ' + mesLabel + ' enviado · utilidad=' + row.utilidad_neta);
  } catch (e) {
    Logger.log('kaeru_pl_mensual_cron error: ' + e.message);
    try { _kaeruPlTelegram('❌ 🐸 *KAERU 蛙 — P&L mensual FALLÓ*\n\n' + e.message); } catch (_) {}
    throw e;
  }
}

function _kaeruPlMesLabel(mesIso) {
  var meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var parts = mesIso.split('-');
  return meses[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
}

// ============================================================
// Test manual — corre con el mes ANTERIOR sin mandar nada
// ============================================================
function kaeru_pl_mensual_test() {
  var mesIso = _kaeruPlMesAnterior();
  var mesLabel = _kaeruPlMesLabel(mesIso);
  Logger.log('Mes evaluado: ' + mesIso + ' (' + mesLabel + ')');

  var row = _kaeruPlGetMes(mesIso);
  Logger.log('Data: ' + JSON.stringify(row));
  if (!row) { Logger.log('Sin data — no se generaría P&L'); return; }

  var msg = _kaeruPlComposeTelegram(row, mesLabel);
  Logger.log('Telegram message preview:\n' + msg);

  var emails = _kaeruPlSociosEmails();
  Logger.log('Socios para email: ' + (emails.length > 0 ? emails.join(', ') : '(ninguno configurado)'));
}

// Test con un mes específico (útil para validar con data histórica)
function kaeru_pl_mensual_test_mes(mesIso) {
  if (!mesIso) { Logger.log('Pasar mes en formato YYYY-MM como argumento'); return; }
  var row = _kaeruPlGetMes(mesIso);
  Logger.log('Data ' + mesIso + ': ' + JSON.stringify(row));
}

// ============================================================
// Triggers
// ============================================================
function kaeru_pl_mensual_activar_triggers() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (KAERU_PL_HANDLER.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  // Trigger mensual: Apps Script no tiene "el primer día del mes" directo,
  // así que usamos diario 8am + check `dia === 1` dentro de la función? No —
  // mejor usar el trigger de Mes (onMonthly no existe). La solución es
  // crear un trigger diario y que el handler haga el check.
  // Cambiamos: trigger diario 8am SV + guard en kaeru_pl_mensual_cron.
  ScriptApp.newTrigger('kaeru_pl_mensual_cron_diario_check')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('America/El_Salvador')
    .create();
  Logger.log('✓ Trigger diario 8am — handler solo dispara si es día 1 del mes');
}

// Wrapper que solo ejecuta si es día 1
function kaeru_pl_mensual_cron_diario_check() {
  var sv = new Date(Date.now() - 6 * 3600 * 1000);
  if (sv.getUTCDate() !== 1) {
    Logger.log('Hoy no es día 1 (es día ' + sv.getUTCDate() + ') — skip P&L');
    return;
  }
  kaeru_pl_mensual_cron();
}

function kaeru_pl_mensual_desactivar_triggers() {
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    var name = existing[i].getHandlerFunction();
    if (name === 'kaeru_pl_mensual_cron' || name === 'kaeru_pl_mensual_cron_diario_check') {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }
  Logger.log('Triggers P&L eliminados: ' + deleted);
}
