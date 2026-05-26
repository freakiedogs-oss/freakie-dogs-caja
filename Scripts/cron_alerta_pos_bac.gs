/**
 * cron_alerta_pos_bac.gs — Alerta si POS BAC no se cerró
 * Trigger: Time-driven, Daily 11pm
 *
 * Verifica que exista una fila en kaeru.liquidacion_pos con fecha_cierre = hoy.
 * Si no, alerta — porque BAC no liquidará al día siguiente y rompemos conciliación.
 */

function cron_alerta_pos_bac() {
  var hoy = Utilities.formatDate(new Date(), 'America/El_Salvador', 'yyyy-MM-dd');
  var liq = supabaseQuery('liquidacion_pos', '?fecha_cierre=eq.' + hoy + '&select=id');

  if (!liq || liq.length === 0) {
    telegramSend(
      '⚠️ *POS BAC NO se cerró hoy (' + hoy + ')*\n\n' +
      'No se registró cierre POS para hoy. BAC no liquidará mañana → la conciliación va a saltar.\n\n' +
      'Acción: ir físicamente al datafono BAC y presionar CIERRE antes de que termine el día.'
    );
  }
}
