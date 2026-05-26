/**
 * cron_planilla.gs — Calcular planilla quincenal
 * Trigger: Time-driven, Daily 7am-8am (chequea internamente si es día 1 o 16)
 */

function cron_planilla() {
  var hoy = new Date();
  var dia = hoy.getDate();

  // Solo correr día 1 y 16
  if (dia !== 1 && dia !== 16) return;

  var fmt = function(d) { return Utilities.formatDate(d, 'America/El_Salvador', 'yyyy-MM-dd'); };

  // Quincena que termina hoy (día 1 = quincena 16-fin del mes anterior, día 16 = quincena 1-15)
  var quincenaInicio, quincenaFin;
  if (dia === 1) {
    // Cerrar quincena 16-último día del mes anterior
    var ultimoMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    quincenaInicio = new Date(ultimoMesAnterior.getFullYear(), ultimoMesAnterior.getMonth(), 16);
    quincenaFin = ultimoMesAnterior;
  } else {
    quincenaInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    quincenaFin = new Date(hoy.getFullYear(), hoy.getMonth(), 15);
  }

  var r = supabaseEdgeFunction('kaeru-calcular-planilla', {
    quincena_inicio: fmt(quincenaInicio),
    quincena_fin: fmt(quincenaFin)
  });

  telegramSend(
    '📋 *Planilla quincenal ' + fmt(quincenaInicio) + ' – ' + fmt(quincenaFin) + '*\n\n' +
    (r.code < 400
      ? 'Cálculo OK. Yessica/Jose revisen en el ERP y firmen para pago.'
      : '🚨 Error: ' + r.body)
  );
}
