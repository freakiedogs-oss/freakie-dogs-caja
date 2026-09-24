/* ═══════════════════════════════════════════════════════════════════════
   La etiqueta, en ZPL — Zebra ZD421

   La impresora de Casa Matriz es una Zebra ZD421 (part number
   ZD4A042-301E00EZ), así que habla ZPL y no hace falta pasar por el diálogo
   de impresión del navegador: se le mandan los comandos por USB y la
   etiqueta sale sola al terminar de pesar.

   Todo está en PUNTOS, no en milímetros, porque ZPL trabaja en puntos y la
   cantidad de puntos depende de la resolución del cabezal. Por eso el
   módulo recibe `dpi` y escala: a 203 dpi una etiqueta de 3 × 2 pulgadas son
   609 × 406 puntos; a 300 dpi, 900 × 600. Si se hornea el número de una
   resolución y la impresora es de la otra, el texto sale corrido o cortado —
   de ahí que la pantalla deje elegirlo y no lo adivine.

   La medida de la etiqueta (3 × 2 pulgadas) la confirmó Cesar el 24-sep-2026.
   ═══════════════════════════════════════════════════════════════════════ */

export const DPI_OPCIONES = [203, 300]

// El diseño se escribe una sola vez, en pulgadas desde la esquina superior
// izquierda, y se convierte a puntos al final. Así cambiar de 203 a 300 dpi
// no obliga a recolocar nada a mano.
const DISENO = {
  ancho: 3, alto: 2,
  margen: 0.08,
  qr: { x: 2.16, y: 0.08, mag: 4 },        // mag se escala aparte, ver abajo
  titulo:   { y: 0.08, alto: 0.14 },
  regla:    { y: 0.26, alto: 0.012 },
  lote:     { y: 0.31, alto: 0.18 },
  peso:     { y: 0.54, alto: 0.30 },
  fecha:    { y: 0.90, alto: 0.12 },
  persona:  { y: 1.05, alto: 0.12 },
  vence:    { y: 1.22, alto: 0.16, caja: { ancho: 1.25, alto: 0.22 } },
  leyenda:  { y: 1.52, alto: 0.10 },
  unidad:   { y: 1.66, alto: 0.10 },
}

const pt = (pulgadas, dpi) => Math.round(pulgadas * dpi)

/* ZPL termina los campos con ^FS, así que un `^` o un `~` dentro del texto
   rompe la etiqueta. Se limpian; no se escapan, porque ZPL no tiene escape
   para el carácter de control y lo que importa es que la etiqueta salga. */
function limpio(s) {
  return String(s == null ? '' : s).replace(/[\^~]/g, ' ').trim()
}

/* Una línea de texto. `A0N` es la fuente escalable, orientación normal. */
function texto(x, y, alto, valor, dpi) {
  const h = pt(alto, dpi)
  return `^FO${pt(x, dpi)},${pt(y, dpi)}^A0N,${h},${h}^FD${limpio(valor)}^FS`
}

/* ── Los datos que van en la etiqueta ─────────────────────────────────
   { producto, unidad, lote, indice, total, gramos, libras, fecha, hora,
     quien, sede, vence, conservacion, qr } */
export function armarZpl(d, opciones = {}) {
  const dpi = Number(opciones.dpi) || 203
  const D = DISENO
  const m = D.margen
  const anchoUtil = D.ancho - m * 2

  // La magnificación del QR es un entero, no una escala continua: a 203 dpi
  // el 4 da un cuadro de ~13 mm y a 300 dpi hace falta 6 para el mismo
  // tamaño físico. Una tabla de dos entradas es más honesta que una fórmula.
  const magQr = dpi >= 300 ? 6 : D.qr.mag

  const L = []
  L.push('^XA')
  L.push('^CI28')                                   // UTF-8: los acentos y el ·
  L.push(`^PW${pt(D.ancho, dpi)}`)                  // ancho de impresión
  L.push(`^LL${pt(D.alto, dpi)}`)                   // largo de la etiqueta
  L.push('^LH0,0')
  L.push('^MNY')                                    // corte por marca/gap
  L.push('^PON')                                    // sin rotar

  if (d.qr) {
    L.push(`^FO${pt(D.qr.x, dpi)},${pt(D.qr.y, dpi)}^BQN,2,${magQr}^FDQA,${limpio(d.qr)}^FS`)
  }

  L.push(texto(m, D.titulo.y, D.titulo.alto, String(d.producto || '').toUpperCase(), dpi))
  L.push(`^FO${pt(m, dpi)},${pt(D.regla.y, dpi)}^GB${pt(anchoUtil - 0.85, dpi)},${pt(D.regla.alto, dpi)},${pt(D.regla.alto, dpi)}^FS`)

  const deTotal = d.total ? ` · ${d.indice} de ${d.total}` : ''
  L.push(texto(m, D.lote.y, D.lote.alto, `Lote ${d.lote}${deTotal}`, dpi))
  L.push(texto(m, D.peso.y, D.peso.alto, `${d.libras} lb (${d.gramos} g)`, dpi))
  L.push(texto(m, D.fecha.y, D.fecha.alto, `Elaborado: ${d.fecha} ${d.hora}`, dpi))
  L.push(texto(m, D.persona.y, D.persona.alto, `Elaboro: ${d.quien} · ${d.sede || 'Casa Matriz'}`, dpi))

  // El vencimiento va en recuadro porque es el dato que se busca de lejos en
  // el freezer, sin sacar la bolsa.
  L.push(`^FO${pt(m, dpi)},${pt(D.vence.y, dpi)}^GB${pt(D.vence.caja.ancho, dpi)},${pt(D.vence.caja.alto, dpi)},3^FS`)
  L.push(texto(m + 0.06, D.vence.y + 0.04, D.vence.alto, `VENCE ${String(d.vence || '').toUpperCase()}`, dpi))

  if (d.conservacion) L.push(texto(m, D.leyenda.y, D.leyenda.alto, d.conservacion, dpi))
  if (d.unidad)       L.push(texto(m, D.unidad.y, D.unidad.alto, d.unidad, dpi))

  L.push('^PQ1')                                    // una copia
  L.push('^XZ')
  return L.join('\n')
}

/* Etiqueta de prueba: sirve para ver si la impresora responde y si el
   tamaño calza, sin tener que pesar nada. */
export function zplPrueba(dpi) {
  return armarZpl({
    producto: 'Prueba de etiqueta', unidad: 'Freakie Dogs · ERP',
    lote: 'L-0000', indice: 1, total: 1,
    gramos: '907', libras: '2.00',
    fecha: new Date().toLocaleDateString('es-SV'), hora: new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }),
    quien: 'Prueba', sede: 'Casa Matriz',
    vence: '00-xxx-0000', conservacion: 'Si se lee todo esto, el tamano calza',
    qr: 'PRUEBA',
  }, { dpi })
}
