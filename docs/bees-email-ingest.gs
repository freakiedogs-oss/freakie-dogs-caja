/**
 * BEES Email → Freakie Dogs ERP
 *
 * Busca correos de BEES no procesados, extrae el texto plano
 * y lo envía al Edge Function ingest-bees-email para crear
 * recepciones automáticas en compras_bees.
 *
 * Setup:
 *  1. Crear proyecto en script.google.com con la cuenta freakiedogs@gmail.com
 *     (ahí llegan los correos BEES reales, remitente test@mail.mybees.sv).
 *     ⚠️ 30-ago-2026: este GAS es OPCIONAL — ya corre una Routine de claude.ai
 *     2×/día que hace lo mismo (misma etiqueta bees-procesado + dedup B2B en la
 *     edge function, así que instalar ambos no duplica nada). Ver memoria.md.
 *  2. Pegar este script
 *  3. Ejecutar setupBeesTrigger() una vez → crea trigger cada 5 min
 *  4. Autorizar permisos de Gmail + UrlFetch
 *
 * El edge function resuelve la sucursal por el nombre de la cuenta en el saludo
 * ("Freakie Dogs Soyapango, Tu pedido a través de BEES...") o por la Información
 * de facturación; si el nombre no trae keyword de sucursal, responde
 * "Cannot resolve sucursal" y NO inserta (así los correos de otros negocios,
 * p.ej. Restaurante Pasquale, se descartan solos).
 */

var BEES = {
  EDGE_URL: 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/ingest-bees-email',
  LABEL: 'bees-procesado',
  QUERY: '(from:test@mail.mybees.sv OR from:noreply@bees.com) subject:pedido -label:bees-procesado',
  MAX: 10,
};

function beesIngest() {
  var label = _label(BEES.LABEL);
  var threads = GmailApp.search(BEES.QUERY, 0, BEES.MAX);
  if (!threads.length) return;

  Logger.log('BEES: ' + threads.length + ' threads');

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();

    for (var j = 0; j < msgs.length; j++) {
      var text = msgs[j].getPlainBody();
      if (!text || text.length < 50) continue;
      if (!/Producto/i.test(text)) continue;
      if (/ha sido cancelado/i.test(text)) continue; // cancelaciones: no ingestar

      try {
        var resp = UrlFetchApp.fetch(BEES.EDGE_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ text: text }),
          muteHttpExceptions: true,
        });
        var r = JSON.parse(resp.getContentText());

        if (r.ok && !r.skipped) {
          Logger.log('BEES: ' + r.numero_pedido + ' → ' + r.store_code +
            ' · ' + r.items_total + ' items (' + r.items_mapped + ' mapped) · $' + r.monto_total);
        } else if (r.ok && r.skipped) {
          Logger.log('BEES: ' + r.numero_pedido + ' → skip (' + r.reason + ')');
        } else {
          Logger.log('BEES: error → ' + r.error);
        }
      } catch (e) {
        Logger.log('BEES: fetch error → ' + e.message);
      }
      break;
    }

    threads[i].addLabel(label);
  }
}

function _label(name) {
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
  Logger.log('Trigger BEES: cada 5 min');
}
