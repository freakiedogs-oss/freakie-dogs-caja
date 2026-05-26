/**
 * gmail_dte_proveedores.gs — Ingesta DTEs entrantes de proveedores
 * Trigger: Time-driven, Every hour (búsqueda de mails nuevos con DTE adjunto)
 *
 * Patrón inspirado en Freakies (/Scripts/gmail_dte_to_supabase.gs).
 *
 * Busca mails con adjunto JSON de Hacienda → parsea → INSERT en kaeru.compras_dte.
 */

function gmail_dte_proveedores_main() {
  // Buscar mails sin label "kaeru/dte_procesado" con adjunto .json
  var query = 'has:attachment filename:json -label:kaeru/dte_procesado newer_than:2d';
  var threads = GmailApp.search(query, 0, 30);

  var label = GmailApp.getUserLabelByName('kaeru/dte_procesado') ||
              GmailApp.createLabel('kaeru/dte_procesado');

  threads.forEach(function(thread) {
    var msgs = thread.getMessages();
    msgs.forEach(function(msg) {
      var attachments = msg.getAttachments();
      attachments.forEach(function(att) {
        if (att.getName().toLowerCase().indexOf('.json') === -1) return;

        try {
          var json = JSON.parse(att.getDataAsString());
          // Estructura DTE Hacienda — extraer campos
          var ident = json.identificacion || {};
          var emisor = json.emisor || {};
          var resumen = json.resumen || {};

          // Verificar que el receptor sea Kaeru
          var receptorNIT = (json.receptor && json.receptor.nit) || '';
          if (receptorNIT !== '06230107251097' && receptorNIT !== '0623-010725-109-7') {
            // No es para Kaeru — ignorar
            return;
          }

          var payload = {
            codigo_generacion: ident.codigoGeneracion,
            numero_control: ident.numeroControl,
            fecha_emision: ident.fecEmi,
            subtotal: resumen.totalGravada || 0,
            iva: resumen.tributos ? resumen.tributos.reduce(function(s, t) {
              return t.codigo === '20' ? s + (t.valor || 0) : s;
            }, 0) : 0,
            total: resumen.totalPagar || resumen.montoTotalOperacion || 0,
            json_dte: json,
            estado: 'pendiente_clasificar'
          };

          // Buscar proveedor por NIT en cuentas_bancarias_terceros o proveedores
          var prov = supabaseQuery('proveedores', '?nit=eq.' + emisor.nit + '&select=id');
          if (prov && prov.length > 0) {
            payload.proveedor_id = prov[0].id;
          }

          supabaseInsert('compras_dte', payload);
          Logger.log('DTE insertado: ' + ident.codigoGeneracion);
        } catch (e) {
          Logger.log('Error procesando DTE: ' + e.toString());
        }
      });
    });
    thread.addLabel(label);
  });
}
