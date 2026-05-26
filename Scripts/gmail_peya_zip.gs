/**
 * gmail_peya_zip.gs — Detectar ZIPs PeYa y marcarlos para procesar
 * Trigger: Time-driven, Every hour
 *
 * Cuando PeYa envía el ZIP semanal/diario, lo sube a Supabase Storage y deja
 * un flag para que el skill `peya-import` (parametrizado a schema kaeru) lo procese.
 */

function gmail_peya_zip_main() {
  var query = 'from:(pedidosya OR peya) has:attachment filename:zip -label:kaeru/peya_subido newer_than:7d';
  var threads = GmailApp.search(query, 0, 10);

  var label = GmailApp.getUserLabelByName('kaeru/peya_subido') ||
              GmailApp.createLabel('kaeru/peya_subido');

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      msg.getAttachments().forEach(function(att) {
        if (att.getName().toLowerCase().indexOf('.zip') === -1) return;

        // TODO: implementar subida a Supabase Storage bucket 'peya-zips/kaeru/'
        // El skill peya-import detecta archivos nuevos y los procesa
        Logger.log('PeYa ZIP detectado: ' + att.getName() + ' (' + att.getSize() + ' bytes)');

        telegramSend(
          '📥 *ZIP PeYa recibido*\n\nArchivo: ' + att.getName() +
          '\nFecha: ' + Utilities.formatDate(msg.getDate(), 'America/El_Salvador', 'yyyy-MM-dd HH:mm') +
          '\n\nProcesando con skill peya-import...'
        );
      });
    });
    thread.addLabel(label);
  });
}
