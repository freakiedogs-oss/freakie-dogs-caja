/* Arnés del Control de Depósitos (src/components/finanzas/depositosConciliacion.js)
 *
 *   node scripts/test-depositos-calendario.mjs
 *   node scripts/test-depositos-calendario.mjs --real 2026-09 2026-09-15
 *
 * Sin flags corre los casos sintéticos, que son las formas REALES que se
 * encontraron en la base de septiembre 2026 (depósito de 6 días, depósito de
 * $0.01, cierre con efectivo negativo, día sin cierre, cruce de fin de mes).
 * Corren sin red, así que sirven de regresión en cualquier máquina.
 *
 * Con `--real` pega a PostgREST con la anon key y corre las MISMAS consultas
 * de la pantalla contra producción (sólo lee). Necesita salida a
 * *.supabase.co, que no siempre está habilitada.
 */
import { armarModelo, estadoCelda, TOL_OK, TOL_WARN } from '../src/components/finanzas/depositosConciliacion.js'

let fallos = 0, pruebas = 0
const chk = (ok, txt) => { pruebas++; console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) fallos++ }
const cerca = (a, b) => Math.abs(a - b) < 0.005
const fmt = (v) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2)

const C = (store_code, fecha, efectivo_real_depositar) => ({ store_code, fecha, efectivo_real_depositar, turno: 'completo', estado: 'aprobado' })
const D = (id, store_code, monto, dias_cubiertos, estado = 'confirmado') =>
  ({ id, store_code, monto, dias_cubiertos, estado, fecha_deposito: dias_cubiertos[dias_cubiertos.length - 1], fotos_urls: ['x.jpg'] })

/* ══ 1. Casos sintéticos ══════════════════════════════════════════════ */
function sinteticos() {
  console.log('\n═ Casos sintéticos (formas reales de septiembre 2026) ═\n')
  const HOY = '2026-09-15'

  const cierres = [
    // S004 — depósitos multi-día, como los hace esa sucursal de verdad
    C('S004', '2026-09-01', 295.94), C('S004', '2026-09-02', 396.04), C('S004', '2026-09-03', 316.89),
    C('S004', '2026-09-04', 513.39), C('S004', '2026-09-05', 17.15), C('S004', '2026-09-06', 965.84),
    C('S004', '2026-09-07', 331.59),
    C('S004', '2026-09-08', 241.71), C('S004', '2026-09-09', 400.15), C('S004', '2026-09-10', 557.89),
    C('S004', '2026-09-11', 711.33), C('S004', '2026-09-12', 423.29), C('S004', '2026-09-13', 692.48),
    C('S004', '2026-09-14', 371.26),
    // S003 — dos cierres el mismo día (dos cajas): el esperado del día es la SUMA
    C('S003', '2026-09-11', 277.80), C('S003', '2026-09-11', 35.97),
    // S002 — cierre con efectivo a depositar NEGATIVO
    C('S002', '2026-09-01', -7.16),
    // S006 — día sin depósito y fuera de plazo
    C('S006', '2026-09-10', 434.68),
    // M001 — depósito que cruza el fin de mes
    C('M001', '2026-08-31', 60.90), C('M001', '2026-09-01', 362.87),
  ]
  const deps = [
    D('a', 'S004', 1010.99, ['2026-09-01', '2026-09-02', '2026-09-03']),
    D('b', 'S004', 1496.71, ['2026-09-04', '2026-09-05', '2026-09-06']),
    D('c', 'S004', 0.01, ['2026-09-07']),
    D('d', 'S004', 2985.42, ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'], 'pendiente'),
    D('e', 'S003', 313.77, ['2026-09-11']),
    // dos depósitos que se encadenan por un día en común → un solo grupo
    D('f', 'M001', 200.00, ['2026-08-31', '2026-09-01']),
    D('g', 'M001', 223.77, ['2026-09-01']),
    // depósito de un día que no tiene cierre
    D('h', 'S001', 500.00, ['2026-09-05']),
  ]
  const m = armarModelo(cierres, deps)
  const cel = (sc, f) => estadoCelda(m, sc, f, HOY)

  console.log('Grupos y veredicto')
  chk(cerca(cel('S004', '2026-09-02').grupo.dif, 2.12) && cel('S004', '2026-09-02').estado === 'warn',
    `multi-día 3 días: dif ${fmt(cel('S004', '2026-09-02').grupo.dif)} → amarillo (>${fmt(TOL_OK)})`)
  chk(cerca(cel('S004', '2026-09-05').grupo.dif, 0.33) && cel('S004', '2026-09-05').estado === 'ok',
    `multi-día 3 días: dif ${fmt(cel('S004', '2026-09-05').grupo.dif)} → verde (<${fmt(TOL_OK)})`)
  chk(cerca(cel('S004', '2026-09-07').grupo.dif, -331.58) && cel('S004', '2026-09-07').grave,
    `depósito de $0.01 contra $331.59: dif ${fmt(cel('S004', '2026-09-07').grupo.dif)} → marcado grave`)
  chk(cerca(cel('S004', '2026-09-10').grupo.dif, -41.43) && cel('S004', '2026-09-10').grupo.dias.length === 6,
    `multi-día 6 días: dif ${fmt(cel('S004', '2026-09-10').grupo.dif)} sobre los 6 días juntos`)
  chk(cel('S004', '2026-09-10').grupo.pendientes === 1, 'el grupo sabe que su depósito está sin confirmar')

  console.log('\nLos tres días del mismo depósito comparten veredicto')
  const tres = ['2026-09-01', '2026-09-02', '2026-09-03'].map(f => cel('S004', f))
  chk(tres.every(c => c.estado === 'warn' && cerca(c.grupo.dif, 2.12)),
    'un depósito multi-día no inventa un culpable: los 3 días dicen lo mismo')
  chk(tres[0].esperado === 295.94 && tres[1].esperado === 396.04,
    'pero cada celda muestra el esperado de SU día (295.94 / 396.04)')

  console.log('\nDos cierres el mismo día')
  chk(cerca(cel('S003', '2026-09-11').esperado, 313.77) && cel('S003', '2026-09-11').estado === 'ok',
    'S003 11-sep: 277.80 + 35.97 = 313.77, cuadra contra el depósito')
  chk(cel('S003', '2026-09-11').cierre.cierres.length === 2, 'el detalle conserva los 2 cierres del día')

  console.log('\nBordes')
  chk(cel('S002', '2026-09-01').estado === 'cero',
    'cierre con efectivo NEGATIVO (-7.16) no es un depósito que falta')
  chk(cel('S006', '2026-09-10').estado === 'falta' && cerca(cel('S006', '2026-09-10').esperado, 434.68),
    'día con efectivo, sin depósito y fuera de plazo → FALTA')
  chk(cel('S004', '2026-09-14').estado === 'plazo',
    'el día de ayer sin depósito está en plazo, no en rojo')
  chk(cel('S001', '2026-09-05').estado === 'sinCierre' && cerca(cel('S001', '2026-09-05').grupo.depositado, 500),
    'depósito de un día sin cierre no se esconde: sale como "sin cierre"')
  chk(cel('S004', '2026-09-20') === null && cel('S005', '2026-09-01') === null,
    'día sin nada y sucursal sin nada devuelven null (celda vacía)')

  console.log('\nEncadenado por un día en común')
  const g = cel('M001', '2026-09-01').grupo
  chk(g.deps.length === 2 && g.dias.length === 2,
    'dos depósitos que comparten el 1-sep forman UN grupo (2 depósitos, 2 días)')
  chk(cerca(g.depositado, 423.77) && cerca(g.esperado, 423.77) && cel('M001', '2026-09-01').estado === 'ok',
    `y cuadran juntos: ${fmt(g.depositado)} vs ${fmt(g.esperado)} → verde`)
  chk(cel('M001', '2026-08-31').estado === 'ok',
    'el día de agosto que arrastra el depósito hereda el mismo veredicto')

  console.log('\nInvariantes')
  const todosLosDias = [...new Set(cierres.map(c => c.fecha).concat(deps.flatMap(d => d.dias_cubiertos)))]
  const sucs = [...m.keys()]
  let enGrupo = new Set(), dobles = 0
  for (const sc of sucs) {
    const vistos = new Set()
    for (const [, gr] of m.get(sc).grupos) {
      gr.deps.forEach(d => enGrupo.add(d.id))
      for (const f of gr.dias) { if (vistos.has(f)) dobles++; vistos.add(f) }
      if (!cerca(gr.depositado, gr.deps.reduce((s, d) => s + +d.monto, 0))) chk(false, `${sc}: depositado no suma sus depósitos`)
      if (!cerca(gr.esperado, gr.dias.reduce((s, f) => s + (m.get(sc).esperadoDe.get(f)?.esperado || 0), 0))) chk(false, `${sc}: esperado no suma sus días`)
    }
  }
  chk(enGrupo.size === deps.length, `los ${deps.length} depósitos quedaron en algún grupo`)
  chk(dobles === 0, 'ningún día cae en dos grupos a la vez')
  let sinEstado = 0
  for (const sc of sucs) for (const f of todosLosDias) {
    const c = estadoCelda(m, sc, f, HOY)
    if (c && !['ok', 'warn', 'falta', 'plazo', 'sinCierre', 'cero'].includes(c.estado)) sinEstado++
  }
  chk(sinEstado === 0, 'toda celda con datos cae en uno de los 6 estados pintables')
  chk(TOL_OK === 1 && TOL_WARN === 5, 'los umbrales son los mismos de Deposito.jsx ($1 / $5)')
}

/* ══ 2. Contra producción (opcional) ══════════════════════════════════ */
async function real(mes, hoy) {
  const URL = 'https://btboxlwfqcbrdfrlnwln.supabase.co'
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Ym94bHdmcWNicmRmcmxud2xuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjcyMzQsImV4cCI6MjA4OTU0MzIzNH0.NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4'
  const get = async (p) => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    return r.json()
  }
  const [y, mm] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, mm, 0)).getUTCDate()
  const dias = Array.from({ length: ultimo }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`).filter(d => d <= hoy)
  const d1 = dias[0], d2 = dias[dias.length - 1]
  const SEL_C = 'fecha,store_code,turno,caja,efectivo_real_depositar,estado'
  const SEL_D = 'id,store_code,monto,fecha_deposito,dias_cubiertos,fotos_urls,estado,creado_por,created_at'

  console.log(`\n═ Producción · ${mes} (hoy = ${hoy}) ═\n`)
  let cierres = await get(`ventas_diarias?select=${SEL_C}&fecha=gte.${d1}&fecha=lte.${d2}&limit=5000`)
  const deps = await get(`depositos_bancarios?select=${SEL_D}&dias_cubiertos=ov.{${dias.join(',')}}&limit=5000`)
  const fuera = [...new Set(deps.flatMap(d => d.dias_cubiertos || []).filter(f => f < d1 || f > d2))]
  if (fuera.length) cierres = cierres.concat(await get(`ventas_diarias?select=${SEL_C}&fecha=in.(${fuera.join(',')})&limit=5000`))
  console.log(`${cierres.length} cierres · ${deps.length} depósitos · ${fuera.length} día(s) cubiertos fuera del mes\n`)

  const m = armarModelo(cierres, deps)
  const sucs = [...m.keys()].sort()
  const faltan = [], descuadres = []
  for (const sc of sucs) for (const f of dias) {
    const c = estadoCelda(m, sc, f, hoy)
    if (c?.estado === 'falta') faltan.push({ sc, f, m: c.esperado })
  }
  for (const sc of sucs) for (const [, g] of m.get(sc).grupos) if (Math.abs(g.dif) >= TOL_OK) descuadres.push({ sc, g })

  console.log(`FALTA el depósito de ${faltan.length} día(s) · ${fmt(faltan.reduce((s, x) => s + x.m, 0))}`)
  faltan.sort((a, b) => a.f.localeCompare(b.f)).forEach(x => console.log(`   ${x.f}  ${x.sc}  ${fmt(x.m)}`))
  console.log(`\nNO CUADRAN ${descuadres.length} depósito(s)`)
  descuadres.sort((a, b) => Math.abs(b.g.dif) - Math.abs(a.g.dif))
    .forEach(({ sc, g }) => console.log(`   ${sc}  ${g.dias.join(',')}  esperado ${fmt(g.esperado)}  depositado ${fmt(g.depositado)}  dif ${fmt(g.dif)}`))

  chk(!faltan.some(x => x.m <= 0), 'ningún "falta" con esperado ≤ 0')
  chk(!faltan.some(x => deps.some(d => d.store_code === x.sc && (d.dias_cubiertos || []).includes(x.f))),
    'ningún "falta" tiene en realidad un depósito que lo cubra')
  chk([...new Set(sucs.flatMap(sc => [...m.get(sc).grupos.values()].flatMap(g => g.deps.map(d => d.id))))].length === deps.length,
    `los ${deps.length} depósitos quedaron en algún grupo`)
}

sinteticos()
if (process.argv.includes('--real')) {
  const i = process.argv.indexOf('--real')
  await real(process.argv[i + 1] || '2026-09', process.argv[i + 2] || new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10))
}
console.log(`\n${fallos === 0 ? `✓ ${pruebas}/${pruebas} OK` : `✗ ${fallos} de ${pruebas} FALLARON`}\n`)
process.exit(fallos ? 1 : 0)
