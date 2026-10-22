/* ═══════════════════════════════════════════════════════════════════════
   La etiqueta, en ZPL — Zebra ZD421

   La impresora de Casa Matriz es una Zebra ZD421 (part number
   ZD4A042-301E00EZ), así que habla ZPL y no hace falta pasar por el diálogo
   de impresión del navegador: se le mandan los comandos por USB y la
   etiqueta sale sola al terminar de pesar.

   Todo está en PUNTOS, no en milímetros, porque ZPL trabaja en puntos y la
   cantidad de puntos depende de la resolución del cabezal. Por eso el
   módulo recibe `dpi` y escala. Si se hornea el número de una resolución y
   la impresora es de la otra, el texto sale corrido o cortado — de ahí que
   la pantalla deje elegirlo y no lo adivine.

   25-sep-2026 (Cesar, por foto): la cinta NO trae una etiqueta de 3×2" por
   fila como se asumió el 24-sep — trae DOS etiquetas de 2×1", una junto a la
   otra, con un espacio angosto entre ellas. El diseño viejo (una sola pieza
   de 3×2") quedaba a caballo entre las dos etiquetas físicas: el título caía
   en la de la izquierda y el QR en la de la derecha. Ahora cada fila que sale
   de la impresora lleva DOS unidades distintas, una por celda — a pedido de
   Cesar, no la misma duplicada. La celda suelta (cuando el total pesado es
   impar) sí se duplica en las dos posiciones, para no dejar una en blanco.
   ═══════════════════════════════════════════════════════════════════════ */

export const DPI_OPCIONES = [203, 300]

// Una celda = una etiqueta física. Ajustar ESPACIO_ENTRE si al calibrar la
// fila no calza exacto con el espacio real entre las dos etiquetas de la
// cinta (es la única medida que no se pudo tomar con regla).
const CELDA = { ancho: 2, alto: 1 }
const ESPACIO_ENTRE = 0.1
const FILA = { ancho: CELDA.ancho * 2 + ESPACIO_ENTRE, alto: CELDA.alto }

// Diseño de una celda sola (2×1"). 4-oct-2026 (Cesar, por foto): salían
// etiquetas corridas, con el título cortado arriba y el QR pasándose del borde
// derecho, y faltaba la fecha de elaboración. Cambios:
//  - Margen de seguridad arriba (0.12") y a los lados (0.10"): la impresora no
//    siempre arranca exactamente en el borde del papel y 0.04" no alcanzaba.
//  - El peso baja de 0.22" a 0.13" de alto (no hace falta que sea lo más
//    grande); lo que importa es el producto y el vencimiento.
//  - Se agrega «ELAB» con fecha y hora de elaboración, arriba del vencimiento.
//  - El título ocupa TODO el ancho (el QR arranca debajo de él), así un
//    nombre largo se achica menos y no se sale.
// Además hay un ajuste fino (opciones.ajuste, en centésimas de pulgada) que se
// toca desde la pantalla para compensar el corrimiento real de ESA impresora
// sin tocar código.
const DISENO = {
  margen: 0.10,
  // El tamaño del QR ya no es fijo: depende de cuánto texto lleva (ver ladoQr).
  qr: { y: 0.24, mag: 3, maxLado: 0.62 },
  titulo: { y: 0.12, alto: 0.12 },
  lote:   { y: 0.28, alto: 0.09 },
  peso:   { y: 0.42, alto: 0.13 },
  elab:   { y: 0.60, alto: 0.085 },
  vence:  { y: 0.72, alto: 0.10, caja: { ancho: 1.2, alto: 0.15 } },
}

/* El QR crece con el texto que lleva. Con el payload real (lote · clave del
   producto · n/total · gramos · bruto/tara · fecha · hora · quién) llega a la
   versión 5–7 (37–45 módulos), o sea 0.55"–0.67" a 3 puntos por módulo, y no
   los 0.5" que se le reservaban: de ahí que se saliera por la derecha. Se
   estima la versión con la capacidad en bytes del nivel M (UTF-8, que es el
   caso más ancho) y se devuelve el lado real en pulgadas. Si a magnificación
   3 no cabe en el alto de la etiqueta, baja a 2. */
const CAPACIDAD_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]   // versiones 1–10
function ladoQr(texto, dpi, magBase) {
  const bytes = new TextEncoder().encode(String(texto)).length
  let v = CAPACIDAD_M.findIndex(c => c >= bytes) + 1
  if (v === 0) v = 11
  const modulos = 17 + 4 * v
  let mag = magBase
  if (modulos * mag / dpi > DISENO.qr.maxLado && mag > 2) mag -= 1
  return { mag, lado: modulos * mag / dpi }
}

const pt = (pulgadas, dpi) => Math.round(pulgadas * dpi)

/* ZPL termina los campos con ^FS, así que un `^` o un `~` dentro del texto
   rompe la etiqueta. Se limpian; no se escapan, porque ZPL no tiene escape
   para el carácter de control y lo que importa es que la etiqueta salga. */
function limpio(s) {
  return String(s == null ? '' : s).replace(/[\^~]/g, ' ').trim()
}

/* La fuente 0 de Zebra es proporcional, pero el ancho medio de un carácter
   ronda el 0.6 del alto que se le pide. Sirve para estimar si una línea se
   va a salir de la etiqueta. Es una estimación conservadora a propósito:
   más vale que el texto quede algo chico a que salga cortado. */
const RATIO_ANCHO = 0.6

/* Una línea de texto que SE ACHICA sola si no cabe. Con celdas de 2" de
   ancho esto importa más que antes: un producto de nombre largo se sale del
   borde derecho fácil. */
function texto(x, y, alto, valor, dpi, anchoDisponible) {
  const txt = limpio(valor)
  if (!txt) return ''
  let h = pt(alto, dpi)
  if (anchoDisponible) {
    const cabe = pt(anchoDisponible, dpi)
    const necesario = txt.length * h * RATIO_ANCHO
    if (necesario > cabe) h = Math.max(12, Math.floor(cabe / (txt.length * RATIO_ANCHO)))
  }
  return `^FO${pt(x, dpi)},${pt(y, dpi)}^A0N,${h},${h}^FD${txt}^FS`
}

/* El ZPL de UNA celda, con todas sus coordenadas corridas x0 pulgadas a la
   derecha — así la misma función arma tanto la celda izquierda (x0=0) como
   la derecha (x0 = ancho de celda + espacio), sin duplicar el diseño.

   { producto, lote, indice, total, gramos, libras, vence, qr } */
function celda(d, dpi, x0, y0 = 0) {
  const D = DISENO
  const m = D.margen
  const anchoPleno = CELDA.ancho - m * 2
  const Y = (v) => v + y0

  const qrTxt = d.qr ? limpio(d.qr) : ''
  const q = qrTxt ? ladoQr(qrTxt, dpi, dpi >= 300 ? 4 : D.qr.mag) : { mag: 0, lado: 0 }
  const qx = x0 + CELDA.ancho - m - q.lado
  const anchoIzq = qrTxt ? (qx - (x0 + m) - 0.05) : anchoPleno   // lo que queda a la izquierda del QR

  const L = []

  // El título va solo en la primera línea, a todo el ancho.
  L.push(texto(x0 + m, Y(D.titulo.y), D.titulo.alto, String(d.producto || '').toUpperCase(), dpi, anchoPleno))

  if (qrTxt) L.push(`^FO${pt(qx, dpi)},${pt(Y(D.qr.y), dpi)}^BQN,2,${q.mag}^FDMA,${qrTxt}^FS`)

  const deTotal = d.total ? ` · ${d.indice}/${d.total}` : ''
  L.push(texto(x0 + m, Y(D.lote.y), D.lote.alto, `${d.lote}${deTotal}`, dpi, anchoIzq))

  L.push(texto(x0 + m, Y(D.peso.y), D.peso.alto, `${d.libras} lb (${d.gramos} g)`, dpi, anchoIzq))

  if (d.elaborado) {
    L.push(texto(x0 + m, Y(D.elab.y), D.elab.alto, `ELAB ${String(d.elaborado).toUpperCase()}`, dpi, anchoIzq))
  }

  // El vencimiento va en recuadro porque es el dato que se busca de lejos en
  // el freezer, sin sacar la bolsa. Nunca invade la columna del QR.
  const cajaAncho = Math.min(D.vence.caja.ancho, anchoIzq)
  L.push(`^FO${pt(x0 + m, dpi)},${pt(Y(D.vence.y), dpi)}^GB${pt(cajaAncho, dpi)},${pt(D.vence.caja.alto, dpi)},2^FS`)
  L.push(texto(x0 + m + 0.05, Y(D.vence.y + 0.025), D.vence.alto, `VENCE ${String(d.vence || '').toUpperCase()}`, dpi, cajaAncho - 0.10))

  return L.filter(Boolean)
}

/* La unidad de impresión real: UNA fila de la cinta, con sus dos etiquetas.
   `der` puede ser el mismo objeto que `izq` (se duplica) cuando queda una
   unidad suelta al final de un lote con total impar — nunca `null`, para no
   dejar una etiqueta en blanco a mitad de la cinta. */
export function armarZplFila(izq, der, opciones = {}) {
  const dpi = Number(opciones.dpi) || 203
  // Ajuste fino en centésimas de pulgada: x positivo = a la derecha, y
  // positivo = hacia abajo. Se acota a ±0.30" para que un toque de más no
  // saque todo de la etiqueta.
  const acota = (v) => Math.max(-30, Math.min(30, Number(v) || 0)) / 100
  const ax = acota(opciones.ajuste && opciones.ajuste.x)
  const ay = acota(opciones.ajuste && opciones.ajuste.y)
  const L = []
  L.push('^XA')
  L.push('^CI28')                                   // UTF-8: los acentos y el ·
  L.push(`^PW${pt(FILA.ancho, dpi)}`)               // ancho de la fila completa (2 etiquetas + espacio)
  L.push(`^LL${pt(FILA.alto, dpi)}`)                // largo de una fila (1 etiqueta de alto)
  L.push('^LH0,0')
  L.push('^MNY')                                    // corte por marca/gap
  L.push('^PON')                                    // sin rotar
  L.push(...celda(izq, dpi, ax, ay))
  if (der) L.push(...celda(der, dpi, CELDA.ancho + ESPACIO_ENTRE + ax, ay))
  L.push('^PQ1')                                    // una copia de la fila
  L.push('^XZ')
  return L.join('\n')
}

/* Etiqueta de prueba: una fila completa con datos de ejemplo en las dos
   celdas, para ver si el tamaño calza (izquierda y derecha) sin pesar nada
   ni gastar una unidad real. */
export function zplPruebaFila(dpi, ajuste) {
  const hoy = new Date().toLocaleDateString('es-SV')
  const base = (i) => ({
    producto: `Prueba ${i === 1 ? 'izquierda' : 'derecha'}`,
    lote: 'L-0000', indice: i, total: 2,
    gramos: '907', libras: '2.00',
    vence: '00-xxx-0000', elaborado: '00-xxx-0000 00:00',
    qr: `PRUEBA-${i}-${hoy}`,
  })
  return armarZplFila(base(1), base(2), { dpi, ajuste })
}
