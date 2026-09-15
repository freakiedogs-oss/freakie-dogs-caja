/* ═══════════════════════════════════════════════════════════════════════
   Conciliación de depósitos — lógica pura (sin React, sin Supabase).

   Vive aparte de la pantalla para poder probarla en Node contra los datos
   reales de la base (`scripts/probar-depositos.mjs`), que es la única forma
   de saber que el verde es verde de verdad.
   ═══════════════════════════════════════════════════════════════════════ */

// El efectivo de un día se deposita a la mañana siguiente: el día de ayer
// todavía está en plazo y no debe pintarse de rojo cada mañana.
export const DIAS_GRACIA = 1
// Mismos umbrales que usa la pantalla de registrar depósito (Deposito.jsx).
export const TOL_OK = 1
export const TOL_WARN = 5

const num = (v) => parseFloat(v) || 0

export const restarDias = (fecha, k) => {
  const d = new Date(fecha + 'T12:00:00')
  d.setDate(d.getDate() - k)
  return d.toISOString().split('T')[0]
}

/* ── Grupos de conciliación ─────────────────────────────────────────────
   Un depósito puede cubrir varios días y un día puede tener varios
   depósitos. Comparar un depósito multi-día contra UN día no significa
   nada: no hay forma de saber cuál de los 3 días vino corto. Así que se
   agrupan (componentes conexas) los días y depósitos que se tocan, y el
   veredicto cuadra / no cuadra es del grupo entero, que sí es verdadero.
   ─────────────────────────────────────────────────────────────────────── */
export function armarGrupos(deps, esperadoDe) {
  const padre = new Map()
  const add = (x) => { if (!padre.has(x)) padre.set(x, x) }
  const find = (x) => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x) } return x }
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) padre.set(ra, rb) }

  for (const d of deps) {
    add('x:' + d.id)
    for (const dia of (d.dias_cubiertos || [])) union('x:' + d.id, 'd:' + dia)
  }

  const grupos = new Map()
  const grupoDeDia = new Map()
  const nuevo = (r) => { if (!grupos.has(r)) grupos.set(r, { dias: [], deps: [] }); return grupos.get(r) }

  for (const d of deps) nuevo(find('x:' + d.id)).deps.push(d)
  for (const k of [...padre.keys()]) {
    if (!k.startsWith('d:')) continue
    const dia = k.slice(2), r = find(k)
    nuevo(r).dias.push(dia)
    grupoDeDia.set(dia, r)
  }

  for (const [, g] of grupos) {
    g.dias.sort()
    g.deps.sort((a, b) => (a.fecha_deposito || '').localeCompare(b.fecha_deposito || ''))
    g.depositado = g.deps.reduce((s, d) => s + num(d.monto), 0)
    // El esperado se recalcula del cierre VIVO, no del `monto_esperado` que
    // quedó congelado al registrar: si el cierre se corrigió después, el
    // número guardado miente. Es lo mismo que hace AdminView al abrir uno.
    g.esperado = g.dias.reduce((s, dia) => s + (esperadoDe.get(dia)?.esperado || 0), 0)
    g.dif = g.depositado - g.esperado
    g.pendientes = g.deps.filter(d => d.estado !== 'confirmado').length
  }
  return { grupos, grupoDeDia }
}

/* Arma, por sucursal, el esperado de cada día y sus grupos de conciliación. */
export function armarModelo(cierres, deps) {
  const porSuc = new Map()
  const get = (sc) => {
    if (!porSuc.has(sc)) porSuc.set(sc, { esperadoDe: new Map(), deps: [] })
    return porSuc.get(sc)
  }
  for (const c of cierres) {
    const s = get(c.store_code)
    if (!s.esperadoDe.has(c.fecha)) s.esperadoDe.set(c.fecha, { esperado: 0, cierres: [] })
    const e = s.esperadoDe.get(c.fecha)
    e.esperado += num(c.efectivo_real_depositar)
    e.cierres.push(c)
  }
  for (const d of deps) get(d.store_code).deps.push(d)
  for (const [, s] of porSuc) Object.assign(s, armarGrupos(s.deps, s.esperadoDe))
  return porSuc
}

/* Estado de una celda (día × sucursal). `null` = ni cierre ni depósito. */
export function estadoCelda(modelo, sc, fecha, hoy) {
  const s = modelo.get(sc)
  if (!s) return null
  const cierre = s.esperadoDe.get(fecha)
  const raiz = s.grupoDeDia.get(fecha)
  const grupo = raiz ? s.grupos.get(raiz) : null

  if (!cierre && !grupo) return null
  if (!cierre && grupo) return { estado: 'sinCierre', esperado: 0, grupo, cierre: null, grave: false }

  const esperado = cierre.esperado
  if (!grupo) {
    // `<= 0` y no `|x| < 0.01`: un cierre puede dar efectivo a depositar
    // NEGATIVO (se gastó del cajón más de lo que entró). Eso no es un
    // depósito que falta — no hay plata que llevar al banco.
    if (esperado < 0.01) return { estado: 'cero', esperado, grupo: null, cierre, grave: false }
    // Dentro del plazo todavía no es un hueco: es la plata que se deposita
    // mañana. Pintarlo rojo cada mañana entrenaría a ignorar el rojo.
    const enPlazo = fecha >= restarDias(hoy, DIAS_GRACIA)
    return { estado: enPlazo ? 'plazo' : 'falta', esperado, grupo: null, cierre, grave: false }
  }
  const ad = Math.abs(grupo.dif)
  return { estado: ad < TOL_OK ? 'ok' : 'warn', esperado, grupo, cierre, grave: ad > TOL_WARN }
}
