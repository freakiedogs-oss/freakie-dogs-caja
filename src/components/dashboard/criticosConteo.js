/* ═══════════════════════════════════════════════════════════════════════
   Productos Críticos — la aritmética de la auditoría (sin React, sin Supabase).

   Espejo de la hoja "Criticos_FD_FORMATO.xlsx" de Saúl. Vive aparte de la
   pantalla para poder probarla en Node (`scripts/test-criticos.mjs`), que es
   la única forma de saber que el rojo es rojo de verdad.

   ── La ecuación ────────────────────────────────────────────────────────
     teórico = CID + Se pidió − Venta del día
     real    = TPS Final + En Línea
     dif     = real − teórico

   Que es lo mismo que decir:

     dif = venta del día − consumo físico

   porque el consumo físico es lo que faltó entre la apertura y el cierre
   (CID + pedido − real). Por eso el signo se lee así:

     dif < 0  → la venta descargó MENOS de lo que se fue del físico.
                Se consumió producto que ninguna venta descontó: merma no
                reportada, sobre-porcionado, fuga.
     dif > 0  → la venta descargó MÁS de lo que se fue del físico. Sobra
                producto: receta que descuenta de más, o el cierre está
                inflado.

   ── Las columnas, como las llena Saúl ──────────────────────────────────
     CID        apertura: paquetes enteros + unidades sueltas
     Se pidió   lo que entró ese día, SIEMPRE en paquetes completos
     Desc AM/PM movimiento bodega de sucursal → cocina. CONTROL INTERNO que
                Saúl digita a mano: no es la venta y NO entra en la ecuación
     TPS Final  paquetes enteros que quedan en bodega al cerrar
     En Línea   unidades sueltas de los paquetes ya abiertos, en cocina

   TPS Final + En Línea es el cierre, con la misma forma que el CID:
   empaques cerrados por un lado, lo suelto por el otro.
   ═══════════════════════════════════════════════════════════════════════ */

export const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

/* NULL NO ES CERO. `null` es "no lo contó"; `0` es "contó y no había".
   Tratar el vacío como cero le inventa un faltante a la sucursal por cada
   celda que Saúl todavía no llenó, que es la forma más fácil de que la
   pantalla mienta el primer día que se use. */
export const vacio = (v) => v === null || v === undefined || v === ''

/** Umbrales del semáforo. El porcentaje es sobre la venta del día. */
export const TOL_PCT_OK = 2      // ≤ 2% de la venta: cuadra
export const TOL_PCT_AVISO = 5   // ≤ 5%: revisar
/* Piso absoluto, en unidades SUELTAS (la más chica que la sucursal cuenta).
   Sin esto, un día flojo con 3 unidades vendidas pinta rojo por una sola
   pieza de diferencia y el rojo se vuelve ruido que se aprende a ignorar.
   El 2 sale del `margen_sobrante_sueltas` que ya usa el conteo nocturno. */
export const TOL_PISO_SUELTAS = 2

/** Unidades de stock que trae un empaque cerrado. */
export const facCerrado = (item) => n(item?.factor) || 1

/* Unidades de stock que vale UNA suelta. Cuando el empaque no se abre en
   sucursal no hay unidad suelta propia, así que "En Línea" se cuenta en la
   misma unidad del empaque (una bolsa de chili abierta sigue siendo una
   bolsa). */
export const facSuelta = (item) =>
  item?.fraccionado ? (n(item?.factor_suelta) || 1) : facCerrado(item)

/** Apertura y cierre: paquetes enteros + lo suelto, a unidad de stock. */
export function aStock(item, enteros, sueltas) {
  if (vacio(enteros) && vacio(sueltas)) return null
  return n(enteros) * facCerrado(item) + n(sueltas) * facSuelta(item)
}

/** Una casilla que va sólo en paquetes (Se pidió, TPS Final). */
export function paquetesAStock(item, enteros) {
  return vacio(enteros) ? null : n(enteros) * facCerrado(item)
}

/** Una casilla que va sólo en sueltas (En Línea). */
export function sueltasAStock(item, sueltas) {
  return vacio(sueltas) ? null : n(sueltas) * facSuelta(item)
}

/** Unidad de stock → empaques, que es como Saúl lee la hoja. */
export const aEmpaques = (item, qty) => (qty == null ? null : qty / facCerrado(item))

/** El piso de tolerancia de un ítem, llevado a unidad de stock. */
export function pisoTolerancia(item) {
  return TOL_PISO_SUELTAS * facSuelta(item)
}

/* ── La auditoría de una fila ──────────────────────────────────────────── */
export function auditar(item) {
  const cid   = aStock(item, item.cid_enteros, item.cid_sueltas)
  const tps   = paquetesAStock(item, item.tps_enteros)
  const linea = sueltasAStock(item, item.linea_sueltas)
  const pedidoDigitado = paquetesAStock(item, item.pedido_enteros)

  const venta = n(item.venta_dia)

  /* Bodega → cocina. Control interno de Saúl, en paquetes. Se guarda y se
     muestra, pero NO entra en la ecuación: no dice cuánto se consumió, dice
     cuánto se movió de un cuarto al otro. */
  const descargaAm = vacio(item.descarga_am) ? null : n(item.descarga_am)
  const descargaPm = vacio(item.descarga_pm) ? null : n(item.descarga_pm)
  const descargas = (descargaAm == null && descargaPm == null)
    ? null : n(descargaAm) + n(descargaPm)

  /* "Se pidió" lo propone el sistema desde el kardex (traslados recibidos +
     recepciones del día) y Saúl puede corregirlo. Cuando corrige, manda lo
     que él digitó: la hoja de papel es la que vio la mercadería entrar. */
  const pedidoSistema = n(item.pedido_sistema)
  const pedido = pedidoDigitado != null ? pedidoDigitado : pedidoSistema
  const pedidoFuente = pedidoDigitado != null ? 'digitado' : 'sistema'
  const pedidoDifiere = pedidoDigitado != null &&
    Math.abs(pedidoDigitado - pedidoSistema) > 0.0005

  /* El cierre real exige al menos el TPS contado. "En línea" vacío se lee
     como cero sólo cuando el TPS existe — si no contó nada, no hay cierre
     y la fila queda sin veredicto en vez de dar uno falso. */
  const hayCierre = tps != null
  const real = hayCierre ? tps + (linea == null ? 0 : linea) : null
  const hayApertura = cid != null

  const teorico = hayApertura ? cid + pedido - venta : null
  const consumoFisico = (hayApertura && hayCierre) ? cid + pedido - real : null
  const diferencia = (teorico != null && real != null) ? real - teorico : null

  const pct = (diferencia != null && Math.abs(venta) > 0.0005)
    ? (diferencia / venta) * 100
    : null

  return {
    cid, pedido, pedidoDigitado, pedidoSistema, pedidoFuente, pedidoDifiere,
    tps, linea, venta, descargaAm, descargaPm, descargas,
    real, teorico, consumoFisico, diferencia, pct,
    completa: hayApertura && hayCierre,
    estado: estadoFila({ diferencia, pct, item }),
  }
}

/* ── Semáforo ──────────────────────────────────────────────────────────
   'sin_datos' → todavía no se puede juzgar (falta apertura o cierre).
   'ok' → la diferencia cabe en el piso absoluto o en el 2%.
   'aviso' / 'alerta' → hay que ir a ver.
   ─────────────────────────────────────────────────────────────────────── */
export function estadoFila({ diferencia, pct, item }) {
  if (diferencia == null) return 'sin_datos'
  if (Math.abs(diferencia) <= pisoTolerancia(item)) return 'ok'
  /* Sin venta no hay porcentaje posible. Si aun así hay diferencia por
     encima del piso, el producto se movió del físico sin que ninguna venta
     lo descontara: eso es exactamente lo que la pantalla busca, no un caso
     que haya que perdonar por falta de denominador. */
  if (pct == null) return 'alerta'
  const a = Math.abs(pct)
  if (a <= TOL_PCT_OK) return 'ok'
  if (a <= TOL_PCT_AVISO) return 'aviso'
  return 'alerta'
}

/* ── La hoja entera ────────────────────────────────────────────────────── */
export function auditarHoja(items) {
  return (items || []).map(it => ({ ...it, aud: auditar(it) }))
}

/** Resumen de cabecera: cuántas filas cuadran, cuántas faltan por contar. */
export function resumenHoja(filas) {
  const r = { total: filas.length, ok: 0, aviso: 0, alerta: 0, sin_datos: 0, completas: 0 }
  for (const f of filas) {
    r[f.aud.estado] = (r[f.aud.estado] || 0) + 1
    if (f.aud.completa) r.completas++
  }
  return r
}

/** Agrupa por la categoría de la hoja, conservando el orden del Excel. */
export function agruparPorCategoria(filas) {
  const mapa = new Map()
  for (const f of filas) {
    const k = f.categoria || 'Otros'
    if (!mapa.has(k)) mapa.set(k, { categoria: k, filas: [], orden: f.orden })
    mapa.get(k).filas.push(f)
  }
  return [...mapa.values()].sort((a, b) => a.orden - b.orden)
}

/* ── Formato ───────────────────────────────────────────────────────────── */

/** Cantidades que van de 400 bolitas a 0.09 bolsas: decimales sólo si hacen falta. */
export function fmtCant(v) {
  if (v == null) return '—'
  const x = n(v)
  if (Math.abs(x - Math.round(x)) < 0.005) return Math.round(x).toLocaleString('en-US')
  if (Math.abs(x) >= 10) return x.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return x.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** Una cantidad en unidad de stock, dicha en empaques + sueltas. */
export function decirEnEmpaques(item, qty) {
  if (qty == null) return '—'
  const f = facCerrado(item)
  const emp = qty / f
  if (!item?.fraccionado || f === 1) return `${fmtCant(emp)} ${item?.unidad_conteo || ''}`.trim()
  const enteros = Math.trunc(emp)
  const resto = qty - enteros * f
  const sueltas = resto / facSuelta(item)
  if (Math.abs(sueltas) < 0.005) return `${fmtCant(enteros)}`
  return `${fmtCant(enteros)} + ${fmtCant(sueltas)} ${item.unidad_suelta || ''}`.trim()
}

/** Lo que digitó Saúl, listo para mandar a fn_criticos_guardar. */
export function aPayload(filas) {
  const num = (v) => (vacio(v) ? null : n(v))
  return filas.map(f => ({
    item_id: f.item_id,
    cid_enteros:    num(f.cid_enteros),
    cid_sueltas:    num(f.cid_sueltas),
    pedido_enteros: num(f.pedido_enteros),
    descarga_am:    num(f.descarga_am),
    descarga_pm:    num(f.descarga_pm),
    tps_enteros:    num(f.tps_enteros),
    linea_sueltas:  num(f.linea_sueltas),
    notas: f.notas || null,
  }))
}
