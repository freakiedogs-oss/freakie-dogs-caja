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

// Diseño de una celda sola, pensado para 1 pulgada de alto (la mitad de lo
// que había antes). No entran fecha/hora ni quién la hizo como texto propio
// — van dentro del QR, que se escanea si hace falta el detalle completo.
const DISENO = {
  margen: 0.06,
  // 26-sep-2026 (Cesar, por foto): el QR salía cortado en las 4 etiquetas.
  // Dos causas, no una:
  //  1) A este objeto de diseño le faltaba `qr.y` — la celda() de abajo hacía
  //     `pt(D.qr.y, dpi)` sobre `undefined` y mandaba un ^FO con la Y en
  //     "NaN" (ZPL inválido), así que el QR salía en una posición que no era
  //     la pensada en vez de alinearse arriba con el título/lote.
  //  2) El campo del QR se mandaba en nivel de corrección "Q" (alto, ~25%),
  //     y con el texto que lleva adentro (lote·producto·índice·peso·fecha·
  //     hora·quién) eso obliga a un QR de versión 4 o más — a mag 4/203dpi
  //     eso imprime ~0.65" físicos, bien por encima de los 0.5" reservados.
  // Se corrige la Y (alineada arriba, junto al título) y se baja a "M" (~15%,
  // sigue siendo robusto para el freezer/refri) con mag 3/203 · 4/300: para
  // el largo real de este texto no pasa de 33 módulos (~0.49" físicos),
  // entra en los 0.5" reservados y su borde inferior queda antes de donde
  // arranca el peso (y=0.56), sin pisarlo.
  qr: { size: 0.5, y: 0.04, mag: 3 },
  titulo: { y: 0.04, alto: 0.12 },
  lote:   { y: 0.18, alto: 0.12 },
  peso:   { y: 0.56, alto: 0.22 },
  vence:  { y: 0.80, alto: 0.12, caja: { ancho: 1.2, alto: 0.16 } },
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
function celda(d, dpi, x0) {
  const D = DISENO
  const m = D.margen
  const anchoArriba = CELDA.ancho - m - D.qr.size - m - 0.04   // lo que queda a la izquierda del QR
  const anchoPleno = CELDA.ancho - m * 2
  const magQr = dpi >= 300 ? 4 : D.qr.mag

  const L = []

  if (d.qr) {
    const qx = x0 + (CELDA.ancho - m - D.qr.size)
    L.push(`^FO${pt(qx, dpi)},${pt(D.qr.y, dpi)}^BQN,2,${magQr}^FDMA,${limpio(d.qr)}^FS`)
  }

  L.push(texto(x0 + m, D.titulo.y, D.titulo.alto, String(d.producto || '').toUpperCase(), dpi, anchoArriba))

  const deTotal = d.total ? ` · ${d.indice}/${d.total}` : ''
  L.push(texto(x0 + m, D.lote.y, D.lote.alto, `${d.lote}${deTotal}`, dpi, anchoArriba))

  L.push(texto(x0 + m, D.peso.y, D.peso.alto, `${d.libras} lb (${d.gramos} g)`, dpi, anchoPleno))

  // El vencimiento va en recuadro porque es el dato que se busca de lejos en
  // el freezer, sin sacar la bolsa.
  L.push(`^FO${pt(x0 + m, dpi)},${pt(D.vence.y, dpi)}^GB${pt(D.vence.caja.ancho, dpi)},${pt(D.vence.caja.alto, dpi)},3^FS`)
  L.push(texto(x0 + m + 0.05, D.vence.y + 0.025, D.vence.alto, `VENCE ${String(d.vence || '').toUpperCase()}`, dpi, D.vence.caja.ancho - 0.10))

  return L.filter(Boolean)
}

/* La unidad de impresión real: UNA fila de la cinta, con sus dos etiquetas.
   `der` puede ser el mismo objeto que `izq` (se duplica) cuando queda una
   unidad suelta al final de un lote con total impar — nunca `null`, para no
   dejar una etiqueta en blanco a mitad de la cinta. */
export function armarZplFila(izq, der, opciones = {}) {
  const dpi = Number(opciones.dpi) || 203
  const L = []
  L.push('^XA')
  L.push('^CI28')                                   // UTF-8: los acentos y el ·
  L.push(`^PW${pt(FILA.ancho, dpi)}`)               // ancho de la fila completa (2 etiquetas + espacio)
  L.push(`^LL${pt(FILA.alto, dpi)}`)                // largo de una fila (1 etiqueta de alto)
  L.push('^LH0,0')
  L.push('^MNY')                                    // corte por marca/gap
  L.push('^PON')                                    // sin rotar
  L.push(...celda(izq, dpi, 0))
  if (der) L.push(...celda(der, dpi, CELDA.ancho + ESPACIO_ENTRE))
  L.push('^PQ1')                                    // una copia de la fila
  L.push('^XZ')
  return L.join('\n')
}

/* Etiqueta de prueba: una fila completa con datos de ejemplo en las dos
   celdas, para ver si el tamaño calza (izquierda y derecha) sin pesar nada
   ni gastar una unidad real. */
export function zplPruebaFila(dpi) {
  const hoy = new Date().toLocaleDateString('es-SV')
  const base = (i) => ({
    producto: `Prueba ${i === 1 ? 'izquierda' : 'derecha'}`,
    lote: 'L-0000', indice: i, total: 2,
    gramos: '907', libras: '2.00',
    vence: '00-xxx-0000',
    qr: `PRUEBA-${i}-${hoy}`,
  })
  return armarZplFila(base(1), base(2), { dpi })
}
