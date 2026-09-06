/**
 * BEES Email → Freakie Dogs ERP (Google Apps Script)
 *
 * Cada 5 minutos busca correos de pedidos BEES sin procesar en
 * freakiedogs@gmail.com, manda su contenido al Edge Function
 * ingest-bees-email (que parsea, resuelve sucursal, deduplica por número
 * B2B y auto-mapea items) y etiqueta el hilo como "bees-procesado".
 *
 * SETUP (una sola vez, ~5 min, con la cuenta freakiedogs@gmail.com):
 *  1. Abrir script.google.com → Nuevo proyecto → pegar este archivo entero.
 *  2. En el editor, elegir la función setupBeesTrigger y darle ▶ Ejecutar.
 *  3. Autorizar los permisos de Gmail + conexiones externas cuando lo pida.
 *  4. Probar: elegir beesIngest y ▶ Ejecutar → ver el registro (Ctrl+Enter).
 *  5. Avisarle a Claude "listo el appscript" para apagar la Routine de
 *     claude.ai que hoy hace este mismo trabajo 2×/día (comparten la
 *     etiqueta bees-procesado y el dedup por B2B, así que mientras
 *     convivan no se duplica nada).
 *
 * Notas:
 *  - La búsqueda usa el NOMBRE de la etiqueta (bees-procesado), igual que
 *    la Routine. La etiqueta ya existe en el buzón.
 *  - Se manda texto plano Y HTML: el Edge Function (v9) tiene estrategias
 *    para ambos formatos (bees.com tabla única y mybees.sv mini-tablas por
 *    producto) y resuelve la sucursal por la Dirección de entrega.
 *  - Cancelaciones ("ha sido cancelado") no se ingieren; solo se etiquetan.
 *  - Si el POST falla (red), el hilo NO se etiqueta y el próximo run lo
 *    reintenta. Respuestas ok:false de formato sí se etiquetan (reintentar
 *    no las arregla) y quedan en el log.
 */

var BEES = {
  EDGE_URL: 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/ingest-bees-email',
  LABEL: 'bees-procesado',
  QUERY: '(from:mybees.sv OR from:bees.com) -label:bees-procesado',
  MAX_THREADS: 10,
};

function beesIngest() {
  var label = _beesLabel(BEES.LABEL);
  var threads = GmailApp.search(BEES.QUERY, 0, BEES.MAX_THREADS);
  if (!threads.length) return;

  Logger.log('BEES: ' + threads.length + ' hilo(s) sin procesar');

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    var etiquetar = true;

    for (var j = 0; j < msgs.length; j++) {
      var text = msgs[j].getPlainBody() || '';
      var html = msgs[j].getBody() || '';
      if (text.length < 50 && html.length < 200) continue;

      // Cancelaciones: no ingerir (el edge fn también las salta por si acaso)
      if (/ha sido cancelado/i.test(text) || /ha sido cancelado/i.test(html)) {
        Logger.log('BEES: cancelación, se etiqueta sin ingerir');
        continue;
      }
      // Solo correos con detalle de productos
      if (!/Producto|Detalles del pedido/i.test(text + html)) continue;

      try {
        var resp = UrlFetchApp.fetch(BEES.EDGE_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ text: text, html: html }),
          muteHttpExceptions: true,
        });
        var r = JSON.parse(resp.getContentText());

        if (r.ok && !r.skipped) {
          Logger.log('BEES: ' + r.numero_pedido + ' → ' + r.store_code +
            ' · $' + r.monto_total + ' · ' + r.items_mapped + '/' + r.items_total + ' items mapeados');
        } else if (r.ok && r.skipped) {
          Logger.log('BEES: ' + (r.numero_pedido || '?') + ' → skip (' + r.reason + ')');
        } else {
          // Error de formato: se registra y el hilo igual se etiqueta
          // (reintentar el mismo correo no cambia el resultado).
          Logger.log('BEES: ERROR de parseo → ' + r.error);
        }
      } catch (e) {
        // Error de red: NO etiquetar, que el próximo run reintente.
        Logger.log('BEES: fetch error → ' + e.message);
        etiquetar = false;
      }
      break; // un POST por hilo (Registrado/Confirmado llegan en hilos separados; dedup cubre el resto)
    }

    if (etiquetar) threads[i].addLabel(label);
  }
}

function _beesLabel(name) {
  var l = GmailApp.getUserLabelByName(name);
  return l || GmailApp.createLabel(name);
}

function setupBeesTrigger() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'beesIngest') {
      ScriptApp.deleteTrigger(all[i]);
    }
  }
  ScriptApp.newTrigger('beesIngest').timeBased().everyMinutes(5).create();
  Logger.log('Trigger BEES creado: beesIngest cada 5 min');
}
