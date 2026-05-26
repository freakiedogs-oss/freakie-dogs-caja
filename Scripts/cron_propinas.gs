/**
 * cron_propinas.gs — Calcular propinas semanales
 * Trigger: Time-driven, Weekly Monday 7am
 * Cubre semana anterior Lunes-Domingo, pago martes
 */

function cron_propinas() {
  // Calcular semana anterior: Lunes T-7 a Domingo T-1
  var hoy = new Date();
  var lunesAnterior = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);
  var domingo       = new Date(hoy.getTime() - 1 * 24 * 60 * 60 * 1000);

  var fmt = function(d) { return Utilities.formatDate(d, 'America/El_Salvador', 'yyyy-MM-dd'); };

  var r = supabaseEdgeFunction('kaeru-calcular-propinas-semana', {
    semana_lunes: fmt(lunesAnterior),
    semana_domingo: fmt(domingo)
  });

  if (r.code >= 400) {
    telegramSend('🚨 *Error calculando propinas semana ' + fmt(lunesAnterior) + '*\n\n' + r.body);
    return;
  }

  var data = JSON.parse(r.body);
  telegramSend(
    '💸 *Propinas semana ' + fmt(lunesAnterior) + ' – ' + fmt(domingo) + '*\n\n' +
    'Total recaudado: $' + (data.total_recaudado_liquido || 0).toFixed(2) + '\n' +
    'A repartir (90%): $' + (data.monto_a_repartir || 0).toFixed(2) + '\n' +
    'Casa (10%): $' + (data.monto_casa || 0).toFixed(2) + '\n\n' +
    'Yessica: revisa el reparto sugerido en el ERP y aprueba para pagar HOY (martes) vía Transfer365.'
  );
}
