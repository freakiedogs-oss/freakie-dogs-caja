/* Arnés del Conteo de Críticos (src/components/dashboard/criticosConteo.js)
 *
 *   node scripts/test-criticos.mjs
 *
 * Casos sintéticos armados con las FORMAS REALES de la base: los factores de
 * los 15 productos de la hoja de Saúl tal como están en `criticos_items`, y
 * las descargas reales de Venecia (S004) del 20-sep-2026 — el único día y la
 * única sucursal donde la caja abrió dos turnos, que es el caso que parte
 * AM/PM de verdad.
 *
 * Corre sin red: sirve de regresión en cualquier máquina.
 */
import {
  auditar, auditarHoja, resumenHoja, agruparPorCategoria,
  aStock, aEmpaques, aPayload, estadoFila, pisoTolerancia,
  decirEnEmpaques, fmtCant, vacio,
  TOL_PCT_OK, TOL_PCT_AVISO, TOL_PISO_SUELTAS,
} from '../src/components/dashboard/criticosConteo.js'

let fallos = 0, pruebas = 0
const chk = (ok, txt) => { pruebas++; console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) fallos++ }
const cerca = (a, b, tol = 0.0005) => a != null && b != null && Math.abs(a - b) < tol

/* ── Los ítems, con los factores REALES de criticos_items ───────────────── */
const CARNE = {
  item_id: 'i1', orden: 1, categoria: 'Carnicos', nombre: 'Carne P Burguer',
  unidad_conteo: 'Paquete de 20 bolitas', unidad_stock: 'unidad',
  factor: 20, fraccionado: true, unidad_suelta: 'bolitas', factor_suelta: 1,
}
const CHILI = {
  item_id: 'i4', orden: 4, categoria: 'Carnicos', nombre: 'Chili',
  unidad_conteo: 'Bolsa de 5 libras', unidad_stock: 'bolsa',
  factor: 1, fraccionado: false, unidad_suelta: null, factor_suelta: null,
}
const PAN = {
  item_id: 'i13', orden: 13, categoria: 'Harinas Panes', nombre: 'Pan Para Burguer',
  unidad_conteo: 'Bolsa de 12 unidades', unidad_stock: 'unidad',
  factor: 12, fraccionado: true, unidad_suelta: 'panes', factor_suelta: 1,
}
const PAPA = {
  item_id: 'i9', orden: 9, categoria: 'Congelados', nombre: 'Papas Sazonadas',
  unidad_conteo: 'Bolsa de 5 libras', unidad_stock: 'libra',
  factor: 5, fraccionado: false, unidad_suelta: null, factor_suelta: null,
}

/* ══ 1. Conversión de unidades ═════════════════════════════════════════ */
function conversion() {
  console.log('\n═ 1. Empaques ↔ unidad de stock ═\n')

  chk(aStock(CARNE, 20, 7) === 407, '20 paquetes + 7 bolitas = 407 unidades')
  chk(aStock(CHILI, 3, null) === 3, 'Chili: 3 bolsas = 3 unidades de stock (factor 1)')
  chk(aStock(PAPA, 4, null) === 20, 'Papa: 4 bolsas de 5 lb = 20 libras')
  chk(aStock(PAN, 15, 0) === 180, '15 bolsas de 12 panes = 180 unidades')

  chk(aStock(CARNE, null, null) === null, 'celda totalmente vacía → null (no 0)')
  chk(aStock(CARNE, null, 7) === 7, 'sólo sueltas contadas = 7 unidades')
  chk(aStock(CARNE, 0, 0) === 0, 'cero explícito es 0, no null')

  // El fraccionado apagado ignora las sueltas: si el empaque no se abre en
  // sucursal, un número ahí sería un dato inventado.
  chk(aStock(CHILI, 2, 99) === 2, 'no fraccionado: las sueltas se ignoran')

  chk(cerca(aEmpaques(CARNE, 407), 20.35), '407 unidades = 20.35 paquetes')
  chk(aEmpaques(CARNE, null) === null, 'aEmpaques(null) = null')

  chk(decirEnEmpaques(CARNE, 407) === '20 + 7 bolitas', `407 se dice "20 + 7 bolitas" (dio "${decirEnEmpaques(CARNE, 407)}")`)
  chk(decirEnEmpaques(CARNE, 400) === '20', '400 exactas se dicen "20", sin el "+ 0"')
  chk(decirEnEmpaques(CHILI, 3).startsWith('3'), 'no fraccionado se dice en su empaque')
}

/* ══ 2. La ecuación, con las descargas reales de Venecia 20-sep ═════════ */
function ecuacion() {
  console.log('\n═ 2. La ecuación de auditoría (S004 · 20-sep-2026, datos reales) ═\n')

  // Carne en Venecia ese día: AM 225 bolitas, PM 111, entraron 400 (20 paquetes).
  // Si abrió con 3 paquetes (60) y cerró con 3 paquetes + 4 bolitas (64):
  //   teórico = 60 + 400 − 336 = 124
  //   real    = 64  →  dif = 64 − 124 = −60 (faltan 3 paquetes)
  const f = auditar({
    ...CARNE, descarga_am: 225, descarga_pm: 111, pedido_sistema: 400,
    cid_enteros: 3, cid_sueltas: 0, tps_enteros: 3, tps_sueltas: 4, linea_enteros: 0,
  })
  chk(f.descargas === 336, 'descargas = AM 225 + PM 111 = 336 bolitas')
  chk(f.cid === 60, 'CID = 3 paquetes = 60 bolitas')
  chk(f.pedido === 400, 'Se pidió sale del sistema cuando no se digitó')
  chk(f.pedidoFuente === 'sistema', 'y queda marcado como "sistema"')
  chk(f.teorico === 124, 'teórico = 60 + 400 − 336 = 124')
  chk(f.real === 64, 'real = TPS 60 + 4 sueltas + línea 0 = 64')
  chk(f.diferencia === -60, 'diferencia = 64 − 124 = −60 bolitas (faltan 3 paquetes)')
  chk(f.consumoFisico === 396, 'consumo físico = 60 + 400 − 64 = 396')

  // La identidad que sostiene toda la pantalla.
  chk(cerca(f.diferencia, f.descargas - f.consumoFisico),
      'IDENTIDAD: diferencia ≡ descargas del sistema − consumo físico')

  chk(cerca(f.pct, -17.857), `% = −60/336 = −17.9% (dio ${f.pct.toFixed(3)}%)`)
  chk(f.estado === 'alerta', 'un −17.9% pinta alerta')
  chk(f.completa === true, 'la fila está completa (hay apertura y cierre)')
}

/* ══ 3. null ≠ 0 ═══════════════════════════════════════════════════════
   Es la regla que evita que la pantalla le invente faltantes a la sucursal
   el primer día que se use, con la hoja a medio llenar. */
function nulos() {
  console.log('\n═ 3. Una celda vacía NO es un cero ═\n')

  const base = { ...CARNE, descarga_am: 225, descarga_pm: 111, pedido_sistema: 400 }

  const sinNada = auditar({ ...base })
  chk(sinNada.diferencia === null, 'hoja en blanco → sin diferencia')
  chk(sinNada.estado === 'sin_datos', 'y el semáforo dice "sin contar", no "descuadre"')
  chk(sinNada.completa === false, 'la fila no está completa')

  const soloApertura = auditar({ ...base, cid_enteros: 3 })
  chk(soloApertura.teorico === 124, 'con sólo el CID ya hay teórico')
  chk(soloApertura.real === null, 'pero no hay cierre real')
  chk(soloApertura.diferencia === null, 'así que tampoco hay veredicto')

  const soloCierre = auditar({ ...base, tps_enteros: 3 })
  chk(soloCierre.real === 60, 'con sólo el TPS ya hay cierre real')
  chk(soloCierre.diferencia === null, 'pero sin CID no hay teórico ni veredicto')

  // "En línea" vacío SÍ vale cero, pero sólo si el TPS está contado: quien
  // contó la bodega y no anotó nada en línea es porque no había nada.
  const sinLinea = auditar({ ...base, cid_enteros: 3, tps_enteros: 3, tps_sueltas: 4 })
  chk(sinLinea.real === 64, '"En línea" vacío cuenta como 0 cuando el TPS sí se contó')
  chk(sinLinea.linea === null, 'aunque el campo siga siendo null')

  // Un cero explícito sí es un dato.
  const cero = auditar({ ...base, cid_enteros: 0, tps_enteros: 0 })
  chk(cero.cid === 0 && cero.real === 0, 'contar 0 es contar')
  // Abrió en 0, entraron 400, se descargaron 336: debían quedar 64. Cerró en
  // 0 → faltan esas 64. (El cero explícito es lo que hace posible el
  // veredicto; con la celda vacía la fila quedaría "sin contar".)
  chk(cero.teorico === 64, 'teórico = 0 + 400 − 336 = 64')
  chk(cero.diferencia === -64, 'cerró en 0 con 64 esperadas → −64')
}

/* ══ 4. "Se pidió": el sistema propone, Saúl dispone ════════════════════ */
function pedido() {
  console.log('\n═ 4. "Se pidió" — sistema vs. digitado ═\n')

  const base = { ...PAPA, descarga_am: 0, descarga_pm: 35, pedido_sistema: 150, cid_enteros: 10, tps_enteros: 20 }

  const delSistema = auditar({ ...base })
  chk(delSistema.pedido === 150 && delSistema.pedidoFuente === 'sistema',
      'sin digitar, manda el kardex (150 lb)')
  chk(delSistema.pedidoDifiere === false, 'y no hay discrepancia que avisar')

  // La hoja de papel dice 30 bolsas = 150 lb: coincide.
  const igual = auditar({ ...base, pedido_enteros: 30 })
  chk(igual.pedido === 150 && igual.pedidoFuente === 'digitado', 'digitado manda cuando existe')
  chk(igual.pedidoDifiere === false, '30 bolsas × 5 lb = 150 lb: no difiere del sistema')

  // La hoja dice 28 bolsas: llegaron 2 menos de las que registró el kardex.
  const distinto = auditar({ ...base, pedido_enteros: 28 })
  chk(distinto.pedido === 140, 'digitado 28 bolsas = 140 lb')
  chk(distinto.pedidoDifiere === true, 'y se marca la discrepancia contra el kardex')
  chk(distinto.teorico === 50 + 140 - 35, 'el teórico usa lo digitado, no lo del sistema')

  // Digitar 0 es una afirmación: "no llegó nada", aunque el kardex diga 150.
  const ceroExplicito = auditar({ ...base, pedido_enteros: 0 })
  chk(ceroExplicito.pedido === 0 && ceroExplicito.pedidoDifiere === true,
      'digitar 0 pisa al sistema y avisa (no llegó lo que el kardex dice)')
}

/* ══ 5. Semáforo ═══════════════════════════════════════════════════════ */
function semaforo() {
  console.log('\n═ 5. Semáforo y piso de tolerancia ═\n')

  chk(pisoTolerancia(CARNE) === TOL_PISO_SUELTAS, 'carne fraccionada: piso = 2 bolitas')
  chk(pisoTolerancia(CHILI) === TOL_PISO_SUELTAS, 'chili no fraccionado: piso = 2 bolsas (su unidad de stock)')
  chk(pisoTolerancia(PAPA) === TOL_PISO_SUELTAS, 'papa no fraccionada: piso = 2 libras')

  // Un día flojo: 3 bolitas descargadas y 1 de diferencia. Sin piso absoluto
  // eso es −33% y pinta rojo por una sola pieza.
  const flojo = auditar({ ...CARNE, descarga_am: 3, descarga_pm: 0, pedido_sistema: 0,
                          cid_enteros: 0, cid_sueltas: 10, tps_enteros: 0, tps_sueltas: 8 })
  chk(flojo.diferencia === 1, 'diferencia de 1 bolita')
  chk(Math.abs(flojo.pct) > TOL_PCT_AVISO, `su % es ${flojo.pct.toFixed(1)}%, fuera del 5%`)
  chk(flojo.estado === 'ok', 'pero cabe en el piso de 2 bolitas → cuadra')

  // Un día normal con la misma proporción sí debe gritar.
  const fuerte = auditar({ ...CARNE, descarga_am: 300, descarga_pm: 0, pedido_sistema: 0,
                           cid_enteros: 20, tps_enteros: 0, tps_sueltas: 0 })
  chk(fuerte.diferencia === -100 && fuerte.estado === 'alerta',
      '−100 bolitas sobre 300 descargadas → alerta')

  // Escalones exactos del porcentaje.
  const conPct = (dif, desc) => estadoFila({ diferencia: dif, pct: (dif / desc) * 100, item: CARNE })
  chk(conPct(10, 1000) === 'ok', '1% → cuadra')
  chk(conPct(20, 1000) === 'ok', `${TOL_PCT_OK}% justo → cuadra`)
  chk(conPct(35, 1000) === 'aviso', '3.5% → revisar')
  chk(conPct(50, 1000) === 'aviso', `${TOL_PCT_AVISO}% justo → revisar`)
  chk(conPct(60, 1000) === 'alerta', '6% → descuadre')

  // Producto que no se vendió pero desapareció del físico: no hay denominador
  // y aun así es exactamente lo que la pantalla busca.
  const sinVenta = auditar({ ...CHILI, descarga_am: 0, descarga_pm: 0, pedido_sistema: 0,
                             cid_enteros: 10, tps_enteros: 4 })
  chk(sinVenta.pct === null, 'sin descargas no hay porcentaje')
  chk(sinVenta.diferencia === -6, 'faltan 6 bolsas')
  chk(sinVenta.estado === 'alerta', 'y con 0 ventas eso es alerta, no un caso a perdonar')

  const sinVentaSinDif = auditar({ ...CHILI, descarga_am: 0, descarga_pm: 0, pedido_sistema: 0,
                                   cid_enteros: 10, tps_enteros: 10 })
  chk(sinVentaSinDif.estado === 'ok', 'sin ventas y sin diferencia: cuadra')
}

/* ══ 6. Hoja completa ══════════════════════════════════════════════════ */
function hoja() {
  console.log('\n═ 6. La hoja entera: resumen y agrupación ═\n')

  const items = [
    { ...CARNE, descarga_am: 225, descarga_pm: 111, pedido_sistema: 400, cid_enteros: 3, tps_enteros: 3, tps_sueltas: 4 }, // alerta
    { ...CHILI, descarga_am: 1.6, descarga_pm: 0.5, pedido_sistema: 3, cid_enteros: 2, tps_enteros: 2 },                   // ok (piso)
    { ...PAN,   descarga_am: 112, descarga_pm: 55, pedido_sistema: 180, cid_enteros: 5, tps_enteros: 3, tps_sueltas: 5 },  // ok/aviso
    { ...PAPA,  descarga_am: 0, descarga_pm: 0.7, pedido_sistema: 150 },                                                   // sin contar
  ]
  const filas = auditarHoja(items)
  chk(filas.length === 4 && filas.every(f => f.aud), 'auditarHoja anota cada fila con su veredicto')

  const r = resumenHoja(filas)
  chk(r.total === 4, 'el resumen cuenta las 4 filas')
  chk(r.sin_datos === 1, 'la papa sin contar queda como "sin contar"')
  chk(r.completas === 3, '3 filas completas')
  chk(r.ok + r.aviso + r.alerta + r.sin_datos === 4, 'los estados suman el total')

  const g = agruparPorCategoria(filas)
  chk(g.length === 3, '3 categorías (Carnicos, Harinas Panes, Congelados)')
  chk(g[0].categoria === 'Carnicos', 'y salen en el orden de la hoja, no alfabético')
  chk(g[0].filas.length === 2, 'Carnicos trae carne y chili')
}

/* ══ 7. Payload ════════════════════════════════════════════════════════
   Lo que viaja a fn_criticos_guardar. Un vacío que llegue como 0 se guarda
   como conteo hecho y le inventa un faltante a la sucursal. */
function payload() {
  console.log('\n═ 7. El payload preserva los nulos ═\n')

  const p = aPayload([
    { item_id: 'i1', cid_enteros: '3', cid_sueltas: '', tps_enteros: 0, linea_enteros: null },
    { item_id: 'i4' },
  ])
  chk(p[0].cid_enteros === 3, 'un string numérico llega como número')
  chk(p[0].cid_sueltas === null, 'un string vacío llega como null, NO como 0')
  chk(p[0].tps_enteros === 0, 'un cero explícito llega como 0')
  chk(p[0].linea_enteros === null, 'un null sigue siendo null')
  chk(Object.values(p[1]).every(v => v === null || v === 'i4'),
      'una fila sin tocar llega toda en null (el servidor la borra en vez de guardar ceros)')

  chk(vacio('') && vacio(null) && vacio(undefined), 'vacio() reconoce "", null y undefined')
  chk(!vacio(0) && !vacio('0'), 'vacio() NO considera vacío al cero')

  chk(fmtCant(null) === '—', 'fmtCant(null) = —')
  chk(fmtCant(1234) === '1,234', 'los enteros van sin decimales')
  chk(fmtCant(0.0952) === '0.1', 'lo chico lleva decimales')
}

conversion(); ecuacion(); nulos(); pedido(); semaforo(); hoja(); payload()

console.log(`\n${'─'.repeat(60)}`)
console.log(fallos === 0 ? `✓ ${pruebas} pruebas OK` : `✗ ${fallos} de ${pruebas} fallaron`)
process.exit(fallos === 0 ? 0 : 1)
