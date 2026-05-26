/**
 * cron_stock_bajo.gs — Alertas de stock bajo
 * Trigger: Time-driven, Every 6 hours
 */

function cron_stock_bajo() {
  // Query: ingredientes activos donde stock_actual < stock_minimo
  var bajos = supabaseQuery('ingredientes',
    '?activo=eq.true&stock_minimo=gt.0&stock_actual=lt.stock_minimo&select=codigo,nombre,unidad,stock_actual,stock_minimo'
  );

  if (!bajos || bajos.length === 0) return;

  var lines = bajos.map(function(b) {
    return '  • ' + b.nombre + ' (' + b.codigo + '): ' + b.stock_actual + ' ' + b.unidad +
           ' (min ' + b.stock_minimo + ')';
  });

  var msg = '⚠️ *Stock bajo — ' + bajos.length + ' ingrediente(s)*\n\n' + lines.join('\n') +
    '\n\nFavor avisar a Yessica para reorden.';

  telegramSend(msg);
}
