/* ═══════════════════════════════════════════════════════════════════════
   Productos Críticos — la aritmética de la auditoría (sin React, sin Supabase).

   Espejo de la hoja "Criticos_FD_FORMATO.xlsx" de Saúl. Vive aparte de la
   pantalla para poder probarla en Node (`scripts/test-criticos.mjs`), que es
   la única forma de saber que el rojo es rojo de verdad.

   ── La ecuación ────────────────────────────────────────────────────────
     teórico de cierre = CID + Se pidió − Descargas AM − Descargas PM
     cierre real       = TPS Final + En Línea
     diferencia        = real − teórico

   Que es lo mismo que decir:

     diferencia = Descargas del sistema − Consumo físico

   porque el consumo físico es lo que faltó entre la apertura y el cierre
   (CID + pedido − real). Por eso el signo se lee así:

     diferencia < 0  → el sistema descargó MENOS de lo que se fue del físico.
                       Se consumió producto que ninguna venta descontó:
                       merma no reportada, sobre-porcionado, fuga.
     diferencia > 0  → el sistema descargó MÁS de lo que se fue del físico.
                       Sobra producto: receta que descuenta de más, o el
                       conteo de cierre está inflado.

   ── Unidades ───────────────────────────────────────────────────────────
   Saúl cuenta en EMPAQUES (paquetes, bolsas, cajas); el kardex vive en
   unidad de stock (unidades, libras, porciones). `factor` es el puente, y
   los ítems que se abren en sucursal llevan además la casilla de sueltos
   con su propio factor — misma convención que el conteo nocturno, que es
   la que las sucursales ya tienen aprendida.
   ═══════════════════════════════════════════════════════════════════════ */

export const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

/* NULL NO ES CERO. `null` es "no lo contó"; `0` es "contó y no había".
   Tratar el vacío como cero le inventa un faltante a la sucursal por cada
   celda que Saúl todavía no llenó, que es la forma más fácil de que la
   pantalla mienta el primer día que se use. */
export const vacio = (v) => v === null || v === undefined || v === ''

/** Umbrales del semáforo. El porcentaje es sobre lo que descargó el sistema. */
export const TOL_PCT_OK = 2      // ≤ 2% de la descarga: cuadra
export const TOL_PCT_AVISO = 5   // ≤ 5%: revisar
/* Piso absoluto, en unidades SUELTAS (la más chica que la sucursal cuenta).
   Sin esto, un día flojo con 3 unidades descargadas pinta rojo por una sola
   pieza de diferencia y el rojo se vuelve ruido que se aprende a ignorar.
   El 2 sale del `margen_sobrante_sueltas` que ya usa el conteo nocturno. */
export const TOL_PISO_SUELTAS = 2

const facCerrado = (item) => n(item?.factor) || 1
const facSuelta = (item) => n(item?.factor_suelta) || 1

/** Una celda de la hoja (enteros + sueltas) a unidad de stock. */
export function aStock(item, enteros, sueltas) {
  if (vacio(enteros) && vacio(sueltas)) return null
  return n(enteros) * facCerrado(item) + (item?.fraccionado ? n(sueltas) * facSuelta(item) : 0)
}

/** Unidad de stock → empaques, que es como Saúl lee la hoja. */
export const aEmpaques = (item, qty) => (qty == null ? null : qty / facCerrado(item))

/** El piso de tolerancia de un ítem, llevado a unidad de stock. */
export function pisoTolerancia(item) {
  return TOL_PISO_SUELTAS * (item?.fraccionado ? facSuelta(item) : 1)
}

/* ── La auditoría de una fila ──────────────────────────────────────────── */
export function auditar(item) {
  const cid    = aStock(item, item.cid_enteros,    item.cid_sueltas)
  const tps    = aStock(item, item.tps_enteros,    item.tps_sueltas)
  const linea  = aStock(item, item.linea_enteros,  item.linea_sueltas)
  const pedidoDigitado = aStock(item, item.pedido_enteros, item.pedido_sueltas)

  const am = n(item.descarga_am)
  const pm = n(item.descarga_pm)
  const descargas = am + pm

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

  const teorico = hayApertura ? cid + pedido - descargas : null
  const consumoFisico = (hayApertura && hayCierre) ? cid + pedido - real : null
  const diferencia = (teorico != null && real != null) ? real - teorico : null

  const pct = (diferencia != null && Math.abs(descargas) > 0.0005)
    ? (diferencia / descargas) * 100
    : null

  return {
    cid, pedido, pedidoDigitado, pedidoSistema, pedidoFuente, pedidoDifiere,
    tps, linea, am, pm, descargas,
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
  /* Sin descargas no hay porcentaje posible. Si aun así hay diferencia por
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
  return filas.map(f => ({
    item_id: f.item_id,
    cid_enteros:    vacio(f.cid_enteros)    ? null : n(f.cid_enteros),
    cid_sueltas:    vacio(f.cid_sueltas)    ? null : n(f.cid_sueltas),
    pedido_enteros: vacio(f.pedido_enteros) ? null : n(f.pedido_enteros),
    pedido_sueltas: vacio(f.pedido_sueltas) ? null : n(f.pedido_sueltas),
    tps_enteros:    vacio(f.tps_enteros)    ? null : n(f.tps_enteros),
    tps_sueltas:    vacio(f.tps_sueltas)    ? null : n(f.tps_sueltas),
    linea_enteros:  vacio(f.linea_enteros)  ? null : n(f.linea_enteros),
    linea_sueltas:  vacio(f.linea_sueltas)  ? null : n(f.linea_sueltas),
    notas: f.notas || null,
  }))
}
