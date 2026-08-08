/**
 * Freakie DTE Mailer — Google Apps Script (webapp)
 * Envía al cliente el DTE sellado: JSON + PDF, desde la cuenta de Freakie.
 * Desplegado bajo freakiedogs@gmail.com (remitente "Freakie Dogs").
 *
 * DESPLIEGUE (una vez):
 *   1) script.google.com (cuenta Gmail normal, NO dominio Workspace) → pegá esto como Code.gs
 *   2) Poné tu SECRET abajo
 *   3) Implementar → Nueva implementación → "Aplicación web"
 *        Ejecutar como: Yo   ·   Acceso: Cualquier usuario
 *   4) Autorizá Gmail
 *   ⚠️ Cambios de código solo aplican al publicar VERSIÓN NUEVA (Administrar implementaciones → ✏️ → Versión nueva).
 *
 * Env en Supabase (edge function freakie-dte-email): FREAKIE_EMAIL_URL (/exec) y FREAKIE_EMAIL_SECRET.
 * Contrato: POST { secret, to, nombre, tipo, codigoGeneracion, numeroControl, ambiente, total, selloRecepcion, fecEmi, dteJson }
 * Respuesta: { ok:true, adjuntos:[...] } | { ok:false, error }
 */

const SECRET = "ENVIODTESFREAKIES";
const REMITENTE_NOMBRE = "Freakie Dogs";

const TIPO_LABEL = {
  "01": "Factura de Consumidor Final",
  "03": "Comprobante de Crédito Fiscal",
  "05": "Nota de Crédito",
  "06": "Nota de Débito",
  "14": "Factura de Sujeto Excluido",
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (body.secret !== SECRET) return out({ ok: false, error: "unauthorized" });

    const to = String(body.to || "").trim();
    if (!to) return out({ ok: false, error: "falta 'to'" });
    const dte = body.dteJson || {};
    const tipo = body.tipo || dte?.identificacion?.tipoDte || "01";
    const cg = body.codigoGeneracion || dte?.identificacion?.codigoGeneracion || "";
    const nc = body.numeroControl || dte?.identificacion?.numeroControl || "";
    const ambiente = body.ambiente || dte?.identificacion?.ambiente || "01";
    const fecEmi = body.fecEmi || dte?.identificacion?.fecEmi || "";
    const sello = body.selloRecepcion || "";
    const tipoLabel = TIPO_LABEL[tipo] || "Documento Tributario Electrónico";

    const jsonBlob = Utilities.newBlob(JSON.stringify(dte, null, 2), "application/json", `DTE_${cg || "documento"}.json`);
    const html = buildHtml({ dte, tipo, tipoLabel, cg, nc, ambiente, fecEmi, sello, nombre: body.nombre, total: body.total });
    const pdfBlob = Utilities.newBlob(html, "text/html", "dte.html").getAs("application/pdf").setName(`DTE_${cg || "documento"}.pdf`);

    const asunto = `${REMITENTE_NOMBRE} — ${tipoLabel} ${nc || ""}`.trim();
    const cuerpo =
      `Estimado/a ${body.nombre || "cliente"},\n\n` +
      `Adjunto encontrará su ${tipoLabel} en formato PDF y el archivo JSON del DTE.\n\n` +
      `Código de generación: ${cg}\n` +
      `Número de control: ${nc}\n` +
      `Sello de recepción: ${sello}\n\n` +
      `Puede verificar este documento en:\n${consultaUrl(ambiente, cg, fecEmi)}\n\n` +
      `Gracias por su compra.\n${REMITENTE_NOMBRE}`;

    GmailApp.sendEmail(to, asunto, cuerpo, { name: REMITENTE_NOMBRE, attachments: [jsonBlob, pdfBlob] });
    return out({ ok: true, adjuntos: [jsonBlob.getName(), pdfBlob.getName()] });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function consultaUrl(ambiente, cg, fecEmi) {
  return `https://admin.factura.gob.sv/consultapublica?ambiente=${ambiente}&codGen=${cg}&fechaEmi=${fecEmi}`;
}
function money(n) { return "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

function buildHtml(d) {
  const dte = d.dte || {};
  const emisor = dte.emisor || {};
  const receptor = dte.receptor || dte.sujetoExcluido || {};
  const resumen = dte.resumen || {};
  const cuerpo = dte.cuerpoDocumento || [];
  const rows = cuerpo.map(function (it) {
    const cant = it.cantidad || 1;
    const pu = it.precioUni != null ? it.precioUni : (it.compra || 0);
    const monto = it.ventaGravada || it.ventaExenta || it.compra || (cant * pu);
    return `<tr><td>${cant}</td><td>${esc(it.descripcion || "")}</td><td style="text-align:right">${money(pu)}</td><td style="text-align:right">${money(monto)}</td></tr>`;
  }).join("");
  const total = d.total != null ? d.total : (resumen.totalPagar || resumen.totalCompras || 0);
  const iva = resumen.totalIva != null ? resumen.totalIva : (resumen.tributos && resumen.tributos[0] ? resumen.tributos[0].valor : null);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;font-size:12px;margin:24px}
    h1{font-size:16px;margin:0 0 2px} .muted{color:#666;font-size:11px}
    .box{border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin:10px 0}
    .grid{display:flex;justify-content:space-between;gap:16px}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{border-bottom:1px solid #eee;padding:5px 6px;text-align:left;font-size:11px}
    th{background:#fafafa} .tot{text-align:right;margin-top:8px;font-size:12px}
    .tot b{display:inline-block;min-width:120px}
  </style></head><body>
    <div class="grid">
      <div><h1>${esc(emisor.nombre || REMITENTE_NOMBRE)}</h1>
        <div class="muted">NIT: ${esc(emisor.nit || "")} · NRC: ${esc(emisor.nrc || "")}</div>
        <div class="muted">${esc(emisor.correo || "")}</div></div>
      <div style="text-align:right"><h1>${esc(d.tipoLabel)}</h1>
        <div class="muted">${d.ambiente === "01" ? "Producción" : "Pruebas"} · ${esc(d.fecEmi)}</div></div>
    </div>
    <div class="box"><div><b>Código de generación:</b> ${esc(d.cg)}</div>
      <div><b>Número de control:</b> ${esc(d.nc)}</div>
      <div><b>Sello de recepción:</b> ${esc(d.sello)}</div></div>
    <div class="box"><b>Receptor</b><br>${esc(receptor.nombre || d.nombre || "Consumidor Final")}<br>
      <span class="muted">${receptor.nit ? "NIT: " + esc(receptor.nit) : (receptor.numDocumento ? "Doc: " + esc(receptor.numDocumento) : "")}${receptor.nrc ? " · NRC: " + esc(receptor.nrc) : ""}</span></div>
    <table><thead><tr><th>Cant.</th><th>Descripción</th><th style="text-align:right">P. Unit.</th><th style="text-align:right">Monto</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="tot">${iva != null ? "<div><b>IVA (13%):</b> " + money(iva) + "</div>" : ""}
      <div style="font-size:14px"><b>Total a pagar:</b> ${money(total)}</div></div>
    <p class="muted" style="margin-top:16px">Verifique este documento en:<br>${consultaUrl(d.ambiente, d.cg, d.fecEmi)}</p>
  </body></html>`;
}

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function out(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
