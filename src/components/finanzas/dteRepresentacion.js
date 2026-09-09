/**
 * dteRepresentacion.js — La representación gráfica de un DTE emitido.
 *
 * ES EL MISMO DOCUMENTO QUE EL CLIENTE RECIBE POR CORREO. El adjunto del correo
 * lo arma el Apps Script "Envio Correos DTE" (Drive de freakiedogs@gmail.com),
 * que hace `Utilities.newBlob(html,"text/html").getAs("application/pdf")` sobre
 * el HTML de su `buildHtml()`. Acá está portado ese mismo layout, campo por
 * campo y en el mismo orden, alimentado del MISMO `dte_json` firmado. Si algún
 * día se cambia uno de los dos, hay que cambiar el otro o el cliente y el
 * back-office dejan de ver el mismo papel.
 *
 * Por qué no se le pide el PDF al Apps Script, que sería la fuente única:
 * su `doPost` ignora los campos que no conoce y SIEMPRE termina en
 * `GmailApp.sendEmail`. Un flag nuevo tipo `soloPdf` no hace nada hasta que el
 * script se edite y se REDESPLIEGUE a mano en Google; mientras tanto, cada
 * descarga le mandaría un correo al cliente. Un botón de descargar no puede
 * tener como modo de falla "le llegó un correo a un cliente real".
 *
 * Los datos salen de `dte_emitido_detalle` (RPC del gate de finanzas), que
 * desde el 9-sep-2026 devuelve también `emisor` e `identificacion`. El emisor
 * se toma del documento y NO de la tabla `businesses`: si mañana cambia el NIT
 * o la dirección de la empresa, la representación de un DTE viejo tiene que
 * seguir mostrando lo que se le firmó y transmitió a Hacienda ese día.
 */

/** Mismos rótulos que usa el Apps Script para el asunto y el encabezado. */
export const TIPO_LABEL = {
  '01': 'Factura de Consumidor Final',
  '03': 'Comprobante de Crédito Fiscal',
  '05': 'Nota de Crédito',
  '06': 'Nota de Débito',
  '14': 'Factura de Sujeto Excluido',
}

export const tipoLabelDe = (tipo) =>
  TIPO_LABEL[String(tipo || '')] || 'Documento Tributario Electrónico'

/**
 * Consulta pública del MH — el link con el que cualquiera (el cliente, el
 * contador, Hacienda) verifica que el documento existe y está sellado.
 * Mismo formato que manda el correo, para que no haya dos URLs distintas.
 */
export function consultaUrlMH(ambiente, codigoGeneracion, fechaEmision) {
  const amb = ambiente || '01'
  const cg = codigoGeneracion || ''
  const fe = fechaEmision || ''
  return `https://admin.factura.gob.sv/consultapublica?ambiente=${amb}&codGen=${cg}&fechaEmi=${fe}`
}

const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)

/**
 * Normaliza un DTE (el detalle del RPC) a lo que necesita el papel.
 * Replica las mismas caídas que hace el Apps Script, incluidas las de `||`:
 * un ítem con ventaGravada 0 cae a ventaExenta y después a cantidad × precio,
 * que es exactamente lo que hoy sale impreso en el PDF del cliente.
 */
export function datosRepresentacion(det, fila) {
  const emisor = det?.emisor || {}
  const receptor = det?.receptor || {}
  const resumen = det?.resumen || {}
  const ident = det?.identificacion || {}
  const cuerpo = Array.isArray(det?.items) ? det.items : []

  const items = cuerpo.map((it) => {
    const cant = it.cantidad || 1
    const pu = it.precioUni != null ? it.precioUni : (it.compra || 0)
    const monto = it.ventaGravada || it.ventaExenta || it.compra || cant * pu
    return { cantidad: cant, descripcion: it.descripcion || '', precioUni: pu, monto }
  })

  const iva = resumen.totalIva != null
    ? resumen.totalIva
    : (Array.isArray(resumen.tributos) && resumen.tributos[0] ? resumen.tributos[0].valor : null)

  const total = fila?.monto_total != null
    ? fila.monto_total
    : (resumen.totalPagar || resumen.totalCompras || 0)

  const tipo = det?.tipo_dte || ident.tipoDte || fila?.tipo_dte || '01'
  const ambiente = ident.ambiente || '01'
  const fecEmi = ident.fecEmi || det?.fecha_emision || fila?.fecha_emision || ''

  return {
    emisor, receptor, items, iva, total, tipo, ambiente, fecEmi,
    tipoLabel: tipoLabelDe(tipo),
    codigoGeneracion: det?.codigo_generacion || fila?.codigo_generacion || '',
    numeroControl: det?.numero_control || fila?.numero_control || '',
    sello: det?.sello_recepcion || fila?.sello_recepcion || '',
    totalLetras: resumen.totalLetras || '',
    consultaUrl: consultaUrlMH(ambiente, det?.codigo_generacion || fila?.codigo_generacion, ident.fecEmi || det?.fecha_emision),
  }
}

/** Documento del receptor: NIT si es CCF, número de documento si es sujeto excluido. */
function lineaReceptor(receptor) {
  const partes = []
  if (receptor.nit) partes.push(`NIT: ${receptor.nit}`)
  else if (receptor.numDocumento) partes.push(`Doc: ${receptor.numDocumento}`)
  if (receptor.nrc) partes.push(`NRC: ${receptor.nrc}`)
  return partes.join(' · ')
}

/**
 * Genera y descarga el PDF. jsPDF entra por import dinámico: son ~390 kB que no
 * tienen por qué viajar en el bundle de una pantalla que casi siempre se usa
 * solo para consultar.
 *
 * Se escribe con texto vectorial (no una captura de pantalla): el contador
 * necesita poder seleccionar y copiar el código de generación y el sello.
 */
export async function construirPdfDTE(det, fila) {
  const d = datosRepresentacion(det, fila)
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const M = 16                            // margen, ~24px del HTML original
  const ancho = doc.internal.pageSize.getWidth()
  const dcha = ancho - M
  let y = 22

  // ── Encabezado: emisor a la izquierda, tipo de documento a la derecha ──
  doc.setFontSize(13); doc.setFont(undefined, 'bold'); doc.setTextColor(34)
  // La razón social de Freakie no entra en una línea, así que el alto del
  // encabezado depende de cuántas ocupe: fijarlo a ojo hacía que la segunda
  // línea se montara encima del NIT.
  const lineasEmisor = doc.splitTextToSize(d.emisor.nombre || 'Freakie Dogs', 100)
  doc.text(lineasEmisor, M, y)
  const ALTO_LINEA_TITULO = 5.3          // 13pt × 1.15 de interlineado, en mm
  doc.setFontSize(12)
  doc.text(doc.splitTextToSize(d.tipoLabel, 70), dcha, y, { align: 'right' })

  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(102)
  const subEmisor = [
    `NIT: ${d.emisor.nit || ''} · NRC: ${d.emisor.nrc || ''}`,
    d.emisor.correo || '',
  ].filter(Boolean)
  let yIzq = y + (lineasEmisor.length - 1) * ALTO_LINEA_TITULO + 6
  const yPrimerSub = yIzq
  subEmisor.forEach((linea) => { doc.text(linea, M, yIzq); yIzq += 4.5 })
  doc.text(`${d.ambiente === '01' ? 'Producción' : 'Pruebas'} · ${d.fecEmi}`, dcha, yPrimerSub, { align: 'right' })

  y = yIzq + 4

  // ── Caja 1: la identidad fiscal del documento ──
  const caja = (alto) => {
    doc.setDrawColor(221); doc.setLineWidth(0.2)
    doc.roundedRect(M, y, ancho - M * 2, alto, 1.5, 1.5)
  }
  const filaCaja = (etiqueta, valor, yy) => {
    doc.setFont(undefined, 'bold'); doc.setTextColor(34); doc.setFontSize(8.5)
    doc.text(etiqueta, M + 4, yy)
    const w = doc.getTextWidth(etiqueta)
    doc.setFont(undefined, 'normal')
    doc.text(String(valor || ''), M + 4 + w + 2, yy)
  }
  caja(20)
  filaCaja('Código de generación:', d.codigoGeneracion, y + 6)
  filaCaja('Número de control:', d.numeroControl, y + 12)
  filaCaja('Sello de recepción:', d.sello, y + 18)
  y += 26

  // ── Caja 2: receptor ──
  const lr = lineaReceptor(d.receptor)
  caja(lr ? 19 : 14)
  doc.setFont(undefined, 'bold'); doc.setTextColor(34); doc.setFontSize(8.5)
  doc.text('Receptor', M + 4, y + 6)
  doc.setFont(undefined, 'normal')
  doc.text(String(d.receptor.nombre || fila?.receptor_nombre || 'Consumidor Final'), M + 4, y + 11)
  if (lr) { doc.setTextColor(102); doc.text(lr, M + 4, y + 15.5) }
  y += (lr ? 19 : 14) + 6

  // ── Ítems ──
  autoTable(doc, {
    startY: y,
    head: [['Cant.', 'Descripción', 'P. Unit.', 'Monto']],
    body: d.items.map((it) => [
      String(it.cantidad),
      it.descripcion,
      money(it.precioUni),
      money(it.monto),
    ]),
    styles: { fontSize: 8.5, cellPadding: 1.8, textColor: 34 },
    headStyles: { fillColor: [250, 250, 250], textColor: 34, fontStyle: 'bold', lineWidth: { bottom: 0.2 }, lineColor: [238, 238, 238] },
    bodyStyles: { lineWidth: { bottom: 0.2 }, lineColor: [238, 238, 238] },
    theme: 'plain',
    margin: { left: M, right: M },
    columnStyles: { 0: { cellWidth: 14 }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'right', cellWidth: 28 } },
  })

  y = (doc.lastAutoTable?.finalY || y) + 7

  // ── Totales ──
  doc.setTextColor(34)
  if (d.iva != null) {
    doc.setFontSize(9); doc.setFont(undefined, 'bold')
    doc.text('IVA (13%):', dcha - 26, y, { align: 'right' })
    doc.setFont(undefined, 'normal')
    doc.text(money(d.iva), dcha, y, { align: 'right' })
    y += 6
  }
  doc.setFontSize(11); doc.setFont(undefined, 'bold')
  doc.text('Total a pagar:', dcha - 26, y, { align: 'right' })
  doc.text(money(d.total), dcha, y, { align: 'right' })
  y += 7

  if (d.totalLetras) {
    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(102)
    doc.text(doc.splitTextToSize(`Son: ${d.totalLetras}`, ancho - M * 2), M, y)
    y += 6
  }

  // ── Pie: cómo verificarlo ante Hacienda ──
  doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(120)
  doc.text('Verifique este documento en:', M, y + 4)
  doc.setTextColor(37, 99, 235)
  doc.textWithLink(d.consultaUrl, M, y + 8.5, { url: d.consultaUrl })

  // Mismo nombre que el adjunto del correo, para que sean el mismo archivo.
  return { doc, nombre: `DTE_${d.codigoGeneracion || 'documento'}.pdf` }
}

/**
 * Arma el PDF y lo baja. Separado de `construirPdfDTE` a propósito: `doc.save()`
 * solo existe en el browser, y sin esa costura no había forma de mirar el
 * documento generado sin abrir la PWA a mano.
 */
export async function descargarPdfDTE(det, fila) {
  const { doc, nombre } = await construirPdfDTE(det, fila)
  doc.save(nombre)
}
