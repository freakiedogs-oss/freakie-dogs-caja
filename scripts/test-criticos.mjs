/* Arnés del Conteo de Críticos (src/components/dashboard/criticosConteo.js)
 *
 *   node scripts/test-criticos.mjs
 *
 * Casos sintéticos armados con las FORMAS REALES de la base: los factores y
 * los costos de los 15 productos de la hoja de Saúl tal como están en
 * `criticos_items` y `v_fd_costo_insumo`, y la venta real de Venecia (S004)
 * del 20-sep-2026 (336 bolitas de carne), verificada contra el kardex.
 *
 * Corre sin red: sirve de regresión en cualquier máquina.
 */
import {
  auditar, auditarHoja, resumenHoja, agruparPorCategoria,
  aStock, paquetesAStock, sueltasAStock, aEmpaques, aPayload,
  estadoFila, pisoTolerancia, facSuelta,
  auditarSemana, semanasRecientes, fmtUSD,
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
  costo_unit: 0.7168,   // real, de v_fd_costo_insumo
}
const CHILI = {
  item_id: 'i4', orden: 4, categoria: 'Carnicos', nombre: 'Chili',
  unidad_conteo: 'Bolsa de 5 libras', unidad_stock: 'bolsa',
  factor: 1, fraccionado: true, unidad_suelta: 'libras', factor_suelta: 0.2,
  costo_unit: 11.5775,
}
const PAN = {
  item_id: 'i13', orden: 13, categoria: 'Harinas Panes', nombre: 'Pan Para Burguer',
  unidad_conteo: 'Bolsa de 12 unidades', unidad_stock: 'unidad',
  factor: 12, fraccionado: true, unidad_suelta: 'panes', factor_suelta: 1,
}
const QUESO = {
  item_id: 'i6', orden: 6, categoria: 'Lacteos', nombre: 'Queso Mozzarela',
  unidad_conteo: 'Paquete de 5 libras', unidad_stock: 'lb',
  factor: 5, fraccionado: true, unidad_suelta: 'lascas', factor_suelta: 0.034,
  costo_unit: 3.45,
}
const PAPA = {
  item_id: 'i9', orden: 9, categoria: 'Congelados', nombre: 'Papas Sazonadas',
  unidad_conteo: 'Bolsa de 5 libras', unidad_stock: 'libra',
  factor: 5, fraccionado: true, unidad_suelta: 'libras', factor_suelta: 1,
  costo_unit: 1.2667,
}

/* ══ 1. Conversión de unidades ═════════════════════════════════════════ */
function conversion() {
  console.log('\n═ 1. Empaques ↔ unidad de stock ═\n')

  chk(aStock(CARNE, 20, 7) === 407, 'CID 20 paquetes + 7 bolitas = 407 unidades')
  chk(aStock(CHILI, 3, null) === 3, 'Chili: 3 bolsas = 3 unidades de stock (factor 1)')
  chk(aStock(PAPA, 4, null) === 20, 'Papa: 4 bolsas de 5 lb = 20 libras')

  chk(aStock(CARNE, null, null) === null, 'celda totalmente vacía → null (no 0)')
  chk(aStock(CARNE, null, 7) === 7, 'sólo sueltas contadas = 7 unidades')
  chk(aStock(CARNE, 0, 0) === 0, 'cero explícito es 0, no null')

  // "Se pidió" y "TPS Final" van SIEMPRE en paquetes completos.
  chk(paquetesAStock(CARNE, 20) === 400, 'Se pidió 20 paquetes = 400 unidades')
  chk(paquetesAStock(PAPA, 3) === 15, 'TPS 3 bolsas de papa = 15 libras')
  chk(paquetesAStock(CARNE, null) === null, 'paquetes vacío → null')

  // "En Línea" va en unidades SUELTAS...
  chk(sueltasAStock(CARNE, 7) === 7, 'En línea 7 bolitas = 7 unidades')
  chk(sueltasAStock(QUESO, 10) === 0.34, 'En línea 10 lascas de mozzarella = 0.34 lb')
  // ...y cuando el empaque NO se abre en sucursal, en la unidad del empaque:
  // una bolsa de chili abierta sigue siendo una bolsa.
  // Desde el 22-sep TODOS los ítems declaran unidad suelta (lo pidió Saúl
  // para que el CID tenga paquete + unidades en las 15 filas).
  chk(facSuelta(CHILI) === 0.2, 'chili: 1 libra suelta = 0.2 de su bolsa de 5')
  chk(cerca(sueltasAStock(CHILI, 3), 0.6), 'En línea 3 libras de chili = 0.6 bolsa')
  chk(sueltasAStock(PAPA, 2) === 2, 'En línea 2 libras de papa = 2 libras (su stock ya es libra)')

  chk(cerca(aEmpaques(CARNE, 407), 20.35), '407 unidades = 20.35 paquetes')
  chk(aEmpaques(CARNE, null) === null, 'aEmpaques(null) = null')

  chk(decirEnEmpaques(CARNE, 407) === '20 + 7 bolitas', `407 se dice "20 + 7 bolitas" (dio "${decirEnEmpaques(CARNE, 407)}")`)
  chk(decirEnEmpaques(CARNE, 400) === '20', '400 exactas se dicen "20", sin el "+ 0"')
}

/* ══ 2. La ecuación, con la venta real de Venecia 20-sep ════════════════ */
function ecuacion() {
  console.log('\n═ 2. teórico = CID + Se pidió − Venta del día (S004 · 20-sep, datos reales) ═\n')

  // Carne en Venecia ese día: la venta descargó 336 bolitas y entraron 400
  // (20 paquetes). Si abrió con 3 paquetes + 5 bolitas (65) y cerró con
  // 2 paquetes en bodega (40) + 7 sueltas en línea (47):
  //   teórico = 65 + 400 − 336 = 129
  //   real    = 47  →  dif = 47 − 129 = −82
  const f = auditar({
    ...CARNE, venta_dia: 336, pedido_sistema: 400,
    cid_enteros: 3, cid_sueltas: 5,
    descarga_am: 8, descarga_pm: 4,
    tps_enteros: 2, linea_sueltas: 7,
  })
  chk(f.venta === 336, 'la venta del día es UN número: 336 bolitas')
  chk(f.cid === 65, 'CID = 3 paquetes + 5 bolitas = 65')
  chk(f.pedido === 400 && f.pedidoFuente === 'sistema', 'Se pidió sale del sistema cuando no se digitó')
  chk(f.teorico === 129, 'teórico = 65 + 400 − 336 = 129')
  chk(f.real === 47, 'real = TPS 2 paquetes (40) + 7 sueltas en línea = 47')
  chk(f.diferencia === -82, 'diferencia = 47 − 129 = −82 bolitas')
  chk(f.consumoFisico === 418, 'consumo físico = 65 + 400 − 47 = 418')
  chk(cerca(f.diferencia, f.venta - f.consumoFisico),
      'IDENTIDAD: diferencia ≡ venta del día − consumo físico')
  chk(cerca(f.pct, -24.405), `% = −82/336 = −24.4% (dio ${f.pct.toFixed(3)}%)`)
  chk(f.estado === 'alerta', 'un −24.4% pinta alerta')
  chk(f.completa === true, 'la fila está completa')

  // Las descargas bodega→cocina se guardan y se muestran, pero NO tocan
  // ningún número de la auditoría. Esta es la corrección de Saúl.
  chk(f.descargaAm === 8 && f.descargaPm === 4, 'las descargas quedan registradas')
  chk(f.descargas === 12, 'y se suman para mostrarlas')
  const sinDescargas = auditar({
    ...CARNE, venta_dia: 336, pedido_sistema: 400,
    cid_enteros: 3, cid_sueltas: 5, tps_enteros: 2, linea_sueltas: 7,
  })
  chk(sinDescargas.teorico === f.teorico && sinDescargas.diferencia === f.diferencia,
      'quitar las descargas NO cambia ni el teórico ni la diferencia')
  chk(sinDescargas.descargas === null, 'y sin digitarlas quedan en null, no en 0')
}

/* ══ 3. null ≠ 0 ═══════════════════════════════════════════════════════ */
function nulos() {
  console.log('\n═ 3. Una celda vacía NO es un cero ═\n')

  const base = { ...CARNE, venta_dia: 336, pedido_sistema: 400 }

  const sinNada = auditar({ ...base })
  chk(sinNada.diferencia === null, 'hoja en blanco → sin diferencia')
  chk(sinNada.estado === 'sin_datos', 'y el semáforo dice "sin contar", no "descuadre"')
  chk(sinNada.completa === false, 'la fila no está completa')

  const soloApertura = auditar({ ...base, cid_enteros: 3, cid_sueltas: 5 })
  chk(soloApertura.teorico === 129, 'con sólo el CID ya hay teórico')
  chk(soloApertura.real === null && soloApertura.diferencia === null,
      'pero sin cierre no hay veredicto')

  const soloCierre = auditar({ ...base, tps_enteros: 2 })
  chk(soloCierre.real === 40, 'con sólo el TPS ya hay cierre real')
  chk(soloCierre.diferencia === null, 'pero sin CID no hay teórico ni veredicto')

  // "En línea" vacío SÍ vale cero, pero sólo si el TPS está contado: quien
  // contó la bodega y no anotó nada en línea es porque no había nada suelto.
  const sinLinea = auditar({ ...base, cid_enteros: 3, cid_sueltas: 5, tps_enteros: 2 })
  chk(sinLinea.real === 40, '"En línea" vacío cuenta como 0 cuando el TPS sí se contó')
  chk(sinLinea.linea === null, 'aunque el campo siga siendo null')

  const cero = auditar({ ...base, cid_enteros: 0, tps_enteros: 0 })
  chk(cero.cid === 0 && cero.real === 0, 'contar 0 es contar')
  chk(cero.teorico === 64, 'teórico = 0 + 400 − 336 = 64')
  chk(cero.diferencia === -64, 'cerró en 0 con 64 esperadas → −64')
}

/* ══ 4. "Se pidió": el sistema propone, Saúl dispone ════════════════════ */
function pedido() {
  console.log('\n═ 4. "Se pidió" — paquetes completos, sistema vs. digitado ═\n')

  const base = { ...PAPA, venta_dia: 35, pedido_sistema: 150, cid_enteros: 10, tps_enteros: 20 }

  const delSistema = auditar({ ...base })
  chk(delSistema.pedido === 150 && delSistema.pedidoFuente === 'sistema',
      'sin digitar, manda el kardex (150 lb)')
  chk(delSistema.pedidoDifiere === false, 'y no hay discrepancia que avisar')

  const igual = auditar({ ...base, pedido_enteros: 30 })
  chk(igual.pedido === 150 && igual.pedidoFuente === 'digitado', 'digitado manda cuando existe')
  chk(igual.pedidoDifiere === false, '30 bolsas × 5 lb = 150 lb: no difiere del sistema')

  const distinto = auditar({ ...base, pedido_enteros: 28 })
  chk(distinto.pedido === 140, 'digitado 28 bolsas = 140 lb')
  chk(distinto.pedidoDifiere === true, 'y se marca la discrepancia contra el kardex')
  chk(distinto.teorico === 50 + 140 - 35, 'el teórico usa lo digitado, no lo del sistema')

  const ceroExplicito = auditar({ ...base, pedido_enteros: 0 })
  chk(ceroExplicito.pedido === 0 && ceroExplicito.pedidoDifiere === true,
      'digitar 0 pisa al sistema y avisa (no llegó lo que el kardex dice)')
}

/* ══ 5. Semáforo ═══════════════════════════════════════════════════════ */
function semaforo() {
  console.log('\n═ 5. Semáforo y piso de tolerancia ═\n')

  chk(pisoTolerancia(CARNE) === 2, 'carne fraccionada: piso = 2 bolitas')
  chk(cerca(pisoTolerancia(CHILI), 0.4), 'chili: piso = 2 libras = 0.4 bolsa')
  chk(cerca(pisoTolerancia(QUESO), 0.068), 'mozzarella: piso = 2 lascas = 0.068 lb')

  // Un día flojo: 3 bolitas vendidas y 1 de diferencia. Sin piso absoluto
  // eso es −33% y pinta rojo por una sola pieza.
  const flojo = auditar({ ...CARNE, venta_dia: 3, pedido_sistema: 0,
                          cid_enteros: 0, cid_sueltas: 10, linea_sueltas: 8, tps_enteros: 0 })
  chk(flojo.diferencia === 1, 'diferencia de 1 bolita')
  chk(Math.abs(flojo.pct) > TOL_PCT_AVISO, `su % es ${flojo.pct.toFixed(1)}%, fuera del 5%`)
  chk(flojo.estado === 'ok', 'pero cabe en el piso de 2 bolitas → cuadra')

  const fuerte = auditar({ ...CARNE, venta_dia: 300, pedido_sistema: 0,
                           cid_enteros: 20, tps_enteros: 0, linea_sueltas: 0 })
  chk(fuerte.diferencia === -100 && fuerte.estado === 'alerta',
      '−100 bolitas sobre 300 vendidas → alerta')

  const conPct = (dif, v) => estadoFila({ diferencia: dif, pct: (dif / v) * 100, item: CARNE })
  chk(conPct(10, 1000) === 'ok', '1% → cuadra')
  chk(conPct(20, 1000) === 'ok', `${TOL_PCT_OK}% justo → cuadra`)
  chk(conPct(35, 1000) === 'aviso', '3.5% → revisar')
  chk(conPct(50, 1000) === 'aviso', `${TOL_PCT_AVISO}% justo → revisar`)
  chk(conPct(60, 1000) === 'alerta', '6% → descuadre')

  // Producto que no se vendió pero desapareció del físico: no hay
  // denominador y aun así es lo que la pantalla busca.
  const sinVenta = auditar({ ...CHILI, venta_dia: 0, pedido_sistema: 0,
                             cid_enteros: 10, tps_enteros: 4 })
  chk(sinVenta.pct === null, 'sin venta no hay porcentaje')
  chk(sinVenta.diferencia === -6 && sinVenta.estado === 'alerta',
      'faltan 6 bolsas y con 0 ventas eso es alerta')

  const sinVentaSinDif = auditar({ ...CHILI, venta_dia: 0, pedido_sistema: 0,
                                   cid_enteros: 10, tps_enteros: 10 })
  chk(sinVentaSinDif.estado === 'ok', 'sin ventas y sin diferencia: cuadra')
}

/* ══ 6. Hoja completa ══════════════════════════════════════════════════ */
function hoja() {
  console.log('\n═ 6. La hoja entera: resumen y agrupación ═\n')

  const items = [
    { ...CARNE, venta_dia: 336, pedido_sistema: 400, cid_enteros: 3, cid_sueltas: 5, tps_enteros: 2, linea_sueltas: 7 },
    { ...CHILI, venta_dia: 2.1, pedido_sistema: 3, cid_enteros: 2, tps_enteros: 2 },
    { ...QUESO, venta_dia: 0.87, pedido_sistema: 0, cid_enteros: 1, tps_enteros: 1 },
    { ...PAPA,  venta_dia: 0.7, pedido_sistema: 150 },   // sin contar
  ]
  const filas = auditarHoja(items)
  chk(filas.length === 4 && filas.every(f => f.aud), 'auditarHoja anota cada fila con su veredicto')

  const r = resumenHoja(filas)
  chk(r.total === 4, 'el resumen cuenta las 4 filas')
  chk(r.sin_datos === 1, 'la papa sin contar queda como "sin contar"')
  chk(r.completas === 3, '3 filas completas')
  chk(r.ok + r.aviso + r.alerta + r.sin_datos === 4, 'los estados suman el total')

  const g = agruparPorCategoria(filas)
  chk(g.length === 3, '3 categorías (Carnicos, Lacteos, Congelados)')
  chk(g[0].categoria === 'Carnicos', 'y salen en el orden de la hoja, no alfabético')
  chk(g[0].filas.length === 2, 'Carnicos trae carne y chili')
}

/* ══ 7. Payload ════════════════════════════════════════════════════════ */
function payload() {
  console.log('\n═ 7. El payload preserva los nulos ═\n')

  const p = aPayload([
    { item_id: 'i1', cid_enteros: '3', cid_sueltas: '', tps_enteros: 0,
      linea_sueltas: null, descarga_am: '8', pedido_enteros: '' },
    { item_id: 'i4' },
  ])
  chk(p[0].cid_enteros === 3, 'un string numérico llega como número')
  chk(p[0].cid_sueltas === null, 'un string vacío llega como null, NO como 0')
  chk(p[0].tps_enteros === 0, 'un cero explícito llega como 0')
  chk(p[0].linea_sueltas === null, 'un null sigue siendo null')
  chk(p[0].descarga_am === 8 && p[0].descarga_pm === null,
      'las descargas bodega→cocina viajan igual que el resto')
  chk(p[0].pedido_enteros === null, 'el pedido vacío no se inventa en 0')
  chk(!('pedido_sueltas' in p[0]) && !('tps_sueltas' in p[0]) && !('linea_enteros' in p[0]),
      'ya no viajan las casillas que Saúl mandó quitar')
  chk(Object.values(p[1]).every(v => v === null || v === 'i4'),
      'una fila sin tocar llega toda en null (el servidor la borra en vez de guardar ceros)')

  chk(vacio('') && vacio(null) && vacio(undefined), 'vacio() reconoce "", null y undefined')
  chk(!vacio(0) && !vacio('0'), 'vacio() NO considera vacío al cero')
  chk(fmtCant(null) === '—', 'fmtCant(null) = —')
  chk(fmtCant(1234) === '1,234', 'los enteros van sin decimales')
}


/* ══ 8. El CID se arrastra del cierre de ayer ══════════════════════════
   Pedido de Saúl (22-sep): que la apertura la ponga sola el sistema con lo
   que quedó real ayer, igual que "Se pidió", y que la diferencia se vaya
   contabilizando día a día sin redigitar nada. */
function arrastre() {
  console.log('\n═ 8. El CID se arrastra del cierre real de ayer ═\n')

  // Ayer cerró con 3 paquetes en bodega y 5 bolitas en línea = 65 unidades.
  const base = {
    ...CARNE, venta_dia: 336, pedido_sistema: 400,
    cid_sug_enteros: 3, cid_sug_sueltas: 5,
    tps_enteros: 2, linea_sueltas: 7,
  }

  const arrastrado = auditar({ ...base })
  chk(arrastrado.cid === 65, 'sin digitar el CID, se usa el cierre de ayer (65)')
  chk(arrastrado.cidFuente === 'arrastrado', 'y queda marcado como "arrastrado"')
  chk(arrastrado.teorico === 129, 'el teórico sale igual que si se hubiera digitado')
  chk(arrastrado.diferencia === -82, 'y la diferencia también: −82')
  chk(arrastrado.completa === true, 'la fila cuenta como completa aunque nadie digitó la apertura')
  chk(arrastrado.cidDifiere === false, 'no hay discrepancia que avisar si no se digitó')

  // Si Saúl digita, manda lo suyo.
  const digitado = auditar({ ...base, cid_enteros: 4, cid_sueltas: 0 })
  chk(digitado.cid === 80 && digitado.cidFuente === 'digitado', 'lo digitado pisa al arrastre')
  chk(digitado.cidDifiere === true, 'y se avisa que no coincide con el cierre de ayer')
  chk(digitado.teorico === 144, 'el teórico usa lo digitado: 80 + 400 − 336')

  // Digitar EXACTAMENTE lo de ayer no es una discrepancia.
  const igual = auditar({ ...base, cid_enteros: 3, cid_sueltas: 5 })
  chk(igual.cidDifiere === false, 'confirmar el arrastre a mano no dispara el aviso')

  // Sin cierre de ayer no hay de dónde arrastrar: la fila queda sin veredicto
  // en vez de abrir en cero, que le inventaría un faltante a la sucursal.
  const sinAyer = auditar({ ...CARNE, venta_dia: 336, pedido_sistema: 400, tps_enteros: 2 })
  chk(sinAyer.cid === null && sinAyer.cidFuente === null, 'sin cierre de ayer no hay CID')
  chk(sinAyer.diferencia === null && sinAyer.estado === 'sin_datos',
      'y la fila queda sin contar, no en descuadre')

  // Un cierre de ayer de CERO sí es un dato: abrió sin nada.
  const ayerEnCero = auditar({
    ...CARNE, venta_dia: 0, pedido_sistema: 0,
    cid_sug_enteros: 0, cid_sug_sueltas: 0, tps_enteros: 0,
  })
  chk(ayerEnCero.cid === 0 && ayerEnCero.cidFuente === 'arrastrado',
      'un cierre de ayer en 0 se arrastra como 0, no como "sin dato"')
}

/* ══ 9. Los KPIs en dinero ═════════════════════════════════════════════ */
function kpis() {
  console.log('\n═ 9. El descuadre valorizado al costo ═\n')

  const f = auditar({
    ...CARNE, venta_dia: 336, pedido_sistema: 400,
    cid_enteros: 3, cid_sueltas: 5, tps_enteros: 2, linea_sueltas: 7,
  })
  chk(cerca(f.difUsd, -82 * 0.7168), `−82 bolitas × $0.7168 = ${fmtUSD(f.difUsd)}`)
  chk(cerca(f.ventaUsd, 336 * 0.7168), 'la venta también se valoriza al costo')

  const filas = auditarHoja([
    // faltante fuerte
    { ...CARNE, venta_dia: 336, pedido_sistema: 400, cid_enteros: 3, cid_sueltas: 5, tps_enteros: 2, linea_sueltas: 7 },
    // sobrante: cerró con más de lo esperado
    { ...PAPA, venta_dia: 10, pedido_sistema: 0, cid_enteros: 4, tps_enteros: 3, linea_sueltas: 5 },
    // sin contar
    { ...QUESO, venta_dia: 5, pedido_sistema: 0 },
  ])
  const r = resumenHoja(filas)

  chk(r.completas === 2 && r.sin_datos === 1, '2 filas completas, 1 sin contar')
  chk(cerca(r.faltanteUsd, -82 * 0.7168), 'el faltante suma SÓLO lo negativo')
  chk(r.sobranteUsd > 0, 'y el sobrante sólo lo positivo')
  chk(cerca(r.difUsd, r.faltanteUsd + r.sobranteUsd),
      'el descuadre neto es la suma de los dos, no un tercer cálculo')
  // Separar faltante de sobrante importa: netear esconde la fuga.
  chk(Math.abs(r.difUsd) < Math.abs(r.faltanteUsd),
      'netear TAPA parte del faltante — por eso van en KPIs separados')

  chk(r.peor.nombre === 'Carne P Burguer', 'el peor descuadre es el de más PLATA')
  chk(r.ventaUsd > 0 && r.pctSobreVenta != null, 'hay % sobre la venta valorizada')
  // La fila sin contar no puede ensuciar el dinero.
  chk(cerca(r.difUsd, filas[0].aud.difUsd + filas[1].aud.difUsd),
      'la fila sin contar no aporta nada al descuadre')

  chk(fmtUSD(-47.5) === '-$47.50', 'un faltante se ve como faltante, con signo')
  chk(fmtUSD(0) === '$0.00' && fmtUSD(null) === '—', 'cero es cero; null es raya')
}

/* ══ 10. La semana ═════════════════════════════════════════════════════ */
function semana() {
  console.log('\n═ 10. Sumatorias de la semana ═\n')

  // `fn_criticos_semana` ya cerró la ecuación día por día; acá sólo se
  // valoriza y se clasifica.
  const filas = auditarSemana([
    { ...CARNE, venta: 1800, pedido: 2000, descargas: 40, dias_completos: 6, diferencia: -120 },
    { ...PAPA,  venta: 300,  pedido: 400,  descargas: 12, dias_completos: 6, diferencia: 2 },
    { ...QUESO, venta: 40,   pedido: 50,   descargas: 0,  dias_completos: 0, diferencia: null },
  ])
  chk(filas.length === 3, 'auditarSemana anota las 3 filas')
  chk(cerca(filas[0].aud.difUsd, -120 * 0.7168), 'la diferencia de la semana se valoriza igual')
  chk(cerca(filas[0].aud.pct, -120 / 1800 * 100), 'el % es sobre la venta de la semana')
  chk(filas[0].aud.estado === 'alerta', '−6.7% en la semana es descuadre')
  chk(filas[1].aud.estado === 'ok', '+2 libras de papa sobre 300 cabe en el piso')
  chk(filas[2].aud.estado === 'sin_datos' && filas[2].aud.completa === false,
      'sin días completos no hay veredicto de semana')
  chk(filas[0].aud.diasCompletos === 6, 'viaja cuántos días se contaron de verdad')

  const r = resumenHoja(filas)
  chk(r.completas === 2, 'el resumen semanal cuenta sólo las filas con veredicto')
  chk(r.peor.nombre === 'Carne P Burguer', 'y el peor sigue siendo el de más plata')

  // El selector de semanas: lunes a domingo, de la más reciente hacia atrás.
  const ss = semanasRecientes('2026-09-22', 5)   // martes
  chk(ss.length === 5, 'devuelve las 5 semanas pedidas')
  chk(ss[0].desde === '2026-09-21' && ss[0].hasta === '2026-09-27',
      `la semana del martes 22 va del lunes 21 al domingo 27 (dio ${ss[0].desde}..${ss[0].hasta})`)
  chk(ss[1].desde === '2026-09-14', 'la anterior arranca el lunes 14')
  chk(ss[0].etiqueta === 'Esta semana' && ss[1].etiqueta === 'Semana pasada',
      'las dos primeras se nombran en palabras')
  chk(ss.every(w => new Date(w.hasta) - new Date(w.desde) === 6 * 86400000),
      'todas duran exactamente 7 días')
  // Un domingo es el caso que rompe cualquier cálculo hecho con getDay() crudo.
  const dom = semanasRecientes('2026-09-27', 2)
  chk(dom[0].desde === '2026-09-21' && dom[0].hasta === '2026-09-27',
      `el domingo 27 cae en la semana que EMPIEZA el lunes 21 (dio ${dom[0].desde}..${dom[0].hasta})`)
  const lun = semanasRecientes('2026-09-21', 1)
  chk(lun[0].desde === '2026-09-21', 'y el lunes es el primer día de la suya')
}

conversion(); ecuacion(); nulos(); pedido(); semaforo(); hoja(); payload()
arrastre(); kpis(); semana()

console.log(`\n${'─'.repeat(60)}`)
console.log(fallos === 0 ? `✓ ${pruebas} pruebas OK` : `✗ ${fallos} de ${pruebas} fallaron`)
process.exit(fallos === 0 ? 0 : 1)
