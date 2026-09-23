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

   ── Dos clases de producto (Saúl, 23-sep) ──────────────────────────────
     PORCIONADO (8)  vienen en piezas contables — bolitas, panes, lascas,
                     porciones. Deben cuadrar EXACTO: si se cuentan piezas,
                     la cuenta da o no da. "En Línea" son piezas sueltas.
     PESO (7)        vienen en bolsa o bandeja. Se cuentan bolsas enteras en
                     el TPS y la bolsa abierta se PESA: "En Línea" es la
                     FRACCIÓN del empaque que queda (0.40 de bolsa), no una
                     unidad suelta. Como la báscula tiene error propio, van
                     con 5% de margen sobre la venta.

   ── Las columnas, como las llena Saúl ──────────────────────────────────
     CID        apertura: paquetes enteros + unidades sueltas. Se arrastra
                solo del cierre de ayer (TPS Final + En Línea de ese día)
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

/* ── Umbrales del semáforo, por clase ───────────────────────────────────
   Los PORCIONADOS cuadran exacto: no hay margen porcentual, sólo el medio
   grano de redondeo que meten los factores de conversión con decimales
   (1/21 de bolsa de pan = 0.047619…). Media pieza nunca alcanza para tapar
   un faltante real, que siempre es de una pieza o más.
   Los de PESO llevan 5% de la venta, porque la báscula tiene error propio
   y exigirles exactitud sería pintar rojo todos los días.
   Un ítem puede traer su propio `tolerancia_pct` y ese manda sobre los dos
   —existe para sacar temporalmente del "exacto" a un producto cuyo dato de
   conversión todavía está mal, sin mentir sobre a qué clase pertenece. */
export const TOL_PCT_PESO = 5
export const EPS_PIEZA = 0.5

/** El margen que le toca a un ítem, en % de la venta. 0 = tiene que cuadrar. */
export function tolerancinaPct(item) {
  if (item?.tolerancia_pct != null && item.tolerancia_pct !== '') return n(item.tolerancia_pct)
  return item?.clase === 'peso' ? TOL_PCT_PESO : 0
}

/** Unidades de stock que trae un empaque cerrado. */
export const facCerrado = (item) => n(item?.factor) || 1

/* Unidades de stock que vale UNA suelta. En los porcionados es la pieza
   (una bolita, un pan). En los de peso vale un empaque entero, porque ahí
   "En Línea" es la FRACCIÓN de la bolsa: 0.40 × bolsa. Los 15 ítems lo
   declaran, así que el fallback sólo cubre un dato incompleto. */
export const facSuelta = (item) => n(item?.factor_suelta) || facCerrado(item)

/** ¿Este ítem se cuenta pesando la bolsa abierta? */
export const esPeso = (item) => item?.clase === 'peso'

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

/* El redondeo que se le perdona a un porcionado, en unidad de stock: media
   pieza. No es tolerancia de conteo — es el ruido de los factores con
   decimales periódicos. */
export function pisoRedondeo(item) {
  return EPS_PIEZA * facSuelta(item)
}

/* ── La auditoría de una fila ──────────────────────────────────────────── */
export function auditar(item) {
  /* El CID se arrastra del cierre REAL de ayer (su TPS Final y su En Línea)
     igual que "Se pidió" se arrastra del kardex: el sistema lo propone y, si
     Saúl no escribe nada encima, el cálculo lo usa. Así la diferencia se va
     contabilizando día a día sin tener que redigitar la apertura cada mañana.
     Si ayer no se contó, no hay sugerencia y la fila queda sin veredicto. */
  const cidDigitado = aStock(item, item.cid_enteros, item.cid_sueltas)
  const cidSugerido = aStock(item, item.cid_sug_enteros, item.cid_sug_sueltas)
  const cid = cidDigitado != null ? cidDigitado : cidSugerido
  const cidFuente = cidDigitado != null ? 'digitado' : (cidSugerido != null ? 'arrastrado' : null)
  const cidDifiere = cidDigitado != null && cidSugerido != null &&
    Math.abs(cidDigitado - cidSugerido) > 0.0005
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

  /* Lo que el descuadre significa en dinero, al costo del insumo. Es el
     número que hace accionable la pantalla: "faltan 4 paquetes" no mueve a
     nadie, "faltan $47" sí. */
  const costoUnit = n(item.costo_unit)
  const difUsd = diferencia == null ? null : diferencia * costoUnit
  const ventaUsd = venta * costoUnit

  /* En los de peso, "En Línea" es la fracción de la bolsa abierta, así que
     vive entre 0 y 1. Más de 1 significa que hay una bolsa entera de más y
     esa va en el TPS — se avisa en vez de aceptarlo callando, porque un 2
     tecleado ahí infla el cierre y tapa un faltante. */
  const fraccionInvalida = esPeso(item) &&
    !vacio(item.linea_sueltas) && n(item.linea_sueltas) > 1

  return {
    fraccionInvalida,
    cid, cidDigitado, cidSugerido, cidFuente, cidDifiere,
    pedido, pedidoDigitado, pedidoSistema, pedidoFuente, pedidoDifiere,
    tps, linea, venta, descargaAm, descargaPm, descargas,
    real, teorico, consumoFisico, diferencia, pct, costoUnit, difUsd, ventaUsd,
    completa: hayApertura && hayCierre,
    estado: estadoFila({ diferencia, pct, item }),
  }
}

/* ── Semáforo, con la regla que le toca a cada clase ────────────────────
   'sin_datos' → todavía no se puede juzgar (falta apertura o cierre).
   'ok' → cuadra según su clase.
   'alerta' → hay que ir a ver.

   No hay estado intermedio: Saúl pidió que los porcionados cuadren "sin
   error" y que los de peso lleven 5%. Un "revisar" en medio sería un umbral
   que nadie definió, y en una pantalla de auditoría un color de más se
   vuelve un color que se ignora.
   ─────────────────────────────────────────────────────────────────────── */
export function estadoFila({ diferencia, pct, item }) {
  if (diferencia == null) return 'sin_datos'
  const tol = tolerancinaPct(item)

  /* Porcionado sin margen propio: tiene que dar. Sólo se perdona el medio
     grano de redondeo de los factores con decimales periódicos, que nunca
     alcanza para tapar una pieza faltante. */
  if (tol === 0) return Math.abs(diferencia) <= pisoRedondeo(item) ? 'ok' : 'alerta'

  /* Con margen porcentual hace falta una venta contra la cual medirlo. Si no
     hubo venta y aun así falta producto, eso es justo lo que la pantalla
     busca: se fue del físico sin que nada lo descontara. */
  if (pct == null) return Math.abs(diferencia) <= pisoRedondeo(item) ? 'ok' : 'alerta'
  return Math.abs(pct) <= tol ? 'ok' : 'alerta'
}

/* ── La hoja entera ────────────────────────────────────────────────────── */
export function auditarHoja(items) {
  return (items || []).map(it => ({ ...it, aud: auditar(it) }))
}

/** Resumen de cabecera: cuántas filas cuadran, cuántas faltan por contar. */
export function resumenHoja(filas) {
  const r = {
    total: filas.length, ok: 0, aviso: 0, alerta: 0, sin_datos: 0, completas: 0,
    difUsd: 0, faltanteUsd: 0, sobranteUsd: 0, ventaUsd: 0, peor: null,
  }
  for (const f of filas) {
    r[f.aud.estado] = (r[f.aud.estado] || 0) + 1
    r.ventaUsd += n(f.aud.ventaUsd)
    if (!f.aud.completa) continue
    r.completas++
    const d = n(f.aud.difUsd)
    r.difUsd += d
    if (d < 0) r.faltanteUsd += d; else r.sobranteUsd += d
    /* El peor descuadre es el de más PLATA, no el de más unidades: 3 bolsas
       de chili pesan más que 30 bolitas de carne. */
    if (r.peor == null || Math.abs(d) > Math.abs(n(r.peor.aud.difUsd))) r.peor = f
  }
  /* Merma implícita sobre la venta: cuánto del costo vendido se fue sin que
     una venta lo descontara. Es el food cost oculto de estos 15 productos. */
  r.pctSobreVenta = r.ventaUsd > 0.005 ? (r.difUsd / r.ventaUsd) * 100 : null
  return r
}

/* ── Sumatorias de la semana ────────────────────────────────────────────
   `fn_criticos_semana` ya cierra la ecuación DÍA POR DÍA y suma sólo los
   días completos: sumar 7 aperturas y 7 cierres y restarlos no significa
   nada, porque cada día tiene su propia apertura. Acá sólo se valoriza. */
export function auditarSemana(items) {
  return (items || []).map(it => {
    const costoUnit = n(it.costo_unit)
    const dif = it.diferencia == null ? null : n(it.diferencia)
    const venta = n(it.venta)
    const pct = (dif != null && Math.abs(venta) > 0.0005) ? (dif / venta) * 100 : null
    return {
      ...it,
      aud: {
        venta, pedido: n(it.pedido), descargas: n(it.descargas),
        diferencia: dif, pct, costoUnit,
        difUsd: dif == null ? null : dif * costoUnit,
        ventaUsd: venta * costoUnit,
        diasCompletos: n(it.dias_completos),
        completa: dif != null,
        estado: dif == null ? 'sin_datos' : estadoFila({ diferencia: dif, pct, item: it }),
      },
    }
  })
}

/** Las semanas del selector: lunes a domingo, de la más reciente hacia atrás. */
export function semanasRecientes(hoyIso, cuantas = 10) {
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const d = new Date(hoyIso + 'T12:00:00')
  // getDay(): 0 = domingo. El lunes de esta semana está a (día+6)%7 días atrás.
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const iso = (x) => x.toISOString().slice(0, 10)
  const out = []
  for (let i = 0; i < cuantas; i++) {
    const a = new Date(lunes); a.setDate(lunes.getDate() - 7 * i)
    const b = new Date(a); b.setDate(a.getDate() + 6)
    const mismoMes = a.getMonth() === b.getMonth()
    out.push({
      desde: iso(a), hasta: iso(b),
      etiqueta: i === 0 ? 'Esta semana' : i === 1 ? 'Semana pasada'
        : mismoMes ? `${a.getDate()}–${b.getDate()} ${MES[b.getMonth()]}`
                   : `${a.getDate()} ${MES[a.getMonth()]} – ${b.getDate()} ${MES[b.getMonth()]}`,
      rango: mismoMes ? `${a.getDate()}–${b.getDate()} ${MES[b.getMonth()]}`
                      : `${a.getDate()} ${MES[a.getMonth()]} – ${b.getDate()} ${MES[b.getMonth()]}`,
    })
  }
  return out
}

/** Dinero, con signo explícito: un faltante tiene que verse como faltante. */
export function fmtUSD(v) {
  if (v == null) return '—'
  const x = n(v)
  return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
