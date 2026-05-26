/**
 * cron_cierre_diario.gs — Resumen diario al grupo Telegram
 * Trigger: Time-driven, Daily 10pm-11pm
 */

function cron_cierre_diario() {
  var hoy = Utilities.formatDate(new Date(), 'America/El_Salvador', 'yyyy-MM-dd');

  // Query del cierre del día
  var cierres = supabaseQuery('cierre_caja', '?fecha=eq.' + hoy + '&select=*');

  if (!cierres || cierres.length === 0) {
    telegramSend(
      '🚨 *Cierre de caja pendiente*\n\nEl cierre del ' + hoy + ' aún no se ha registrado en el ERP.\n\nFavor verificar con Yessica/manager de turno.',
      'Markdown'
    );
    return;
  }

  var c = cierres[0];
  var msg = '🍜 *Cierre Kaeru — ' + hoy + '*\n\n' +
    '💵 Total esperado: $' + (c.total_esperado || 0).toFixed(2) + '\n' +
    '💰 Efectivo contado: $' + (c.efectivo_contado || 0).toFixed(2) + '\n' +
    '📊 Diferencia: $' + (c.diferencia || 0).toFixed(2) + '\n\n' +
    '*Por método:*\n' +
    '  Efectivo: $' + (c.ventas_efectivo || 0).toFixed(2) + '\n' +
    '  Tarjeta: $' + (c.ventas_tarjeta || 0).toFixed(2) + '\n' +
    '  Transfer: $' + (c.ventas_transferencia || 0).toFixed(2) + '\n' +
    '  PeYa: $' + (c.ventas_peya || 0).toFixed(2) + '\n\n' +
    '💸 Propinas: $' + (c.propinas_total || 0).toFixed(2) + '\n' +
    '🏦 A depositar: $' + (c.efectivo_a_depositar || 0).toFixed(2) + '\n' +
    '🪙 A caja chica: $' + (c.efectivo_a_caja_chica || 0).toFixed(2);

  telegramSend(msg);
}
