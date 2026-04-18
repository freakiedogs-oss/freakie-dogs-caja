import { useState, useEffect, useCallback, useMemo } from 'react'
import { db } from '../../supabase'
import { STORES, n } from '../../config'

/* ══════════════════════════════════════════════
   Rentabilidad × Sucursal — Fintech v2
   Comparación periodo-a-periodo · Tendencias
   ══════════════════════════════════════════════ */

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const SUC_KEYS = Object.keys(STORES).filter(s => s !== 'CM001')

// ── Theme tokens ──
const T = {
  bg: '#0B0F1A', bgCard: '#111827', bgHover: '#1A2234', bgSurface: '#1E293B',
  border: '#1E293B', borderLight: '#334155',
  text: '#F1F5F9', textSec: '#94A3B8', textMuted: '#64748B',
  accent: '#3B82F6', accentLight: '#60A5FA',
  green: '#10B981', greenBg: 'rgba(16,185,129,0.1)',
  red: '#EF4444', redBg: 'rgba(239,68,68,0.1)',
  yellow: '#F59E0B', yellowBg: 'rgba(245,158,11,0.1)',
  purple: '#8B5CF6',
}

// ── Mapeo categorías (mismo que FinanzasDashboard) ──
// categoria_nombre → P&L group
const CATNAME_TO_PL = {
  'Insumo Cocina': 'costo_comida', 'Insumo Bebida': 'costo_comida', 'Insumo Producción': 'costo_comida',
  'Insumo Merchandising': 'insumo_venta', 'Insumo Despacho': 'insumo_venta', 'Insumo Empaque': 'insumo_venta',
  'Insumo Limpieza': 'limpieza', 'Insumo Colaboradores': 'costo_comida',
  'Alquiler': 'costo_fijo', 'Electricidad': 'costo_fijo', 'Agua': 'costo_fijo',
  'Gasto Mantenimiento': 'costo_fijo', 'Gasto Alcaldía': 'costo_fijo', 'Gasto Transporte': 'gastos_operativos',
  'Gasto de Venta (POS/PEYA)': 'gastos_operativos', 'Gasto Mercadeo': 'gastos_operativos',
  'Gasto Logístico': 'gastos_operativos', 'Gasto Logístico (Admin)': 'gastos_operativos',
  'Gasto Financiero': 'gasto_financiero', 'Gasto Contabilidad': 'gasto_financiero',
  'Gasto Planilla': 'planilla', 'Gastos Legales': 'gasto_financiero',
  'Gasto Impuesto': 'gasto_financiero', 'Activo Fijo': 'activo_fijo',
  'Gastos Varios': 'gastos_operativos', 'Gasto Colaboradores': 'gastos_operativos',
  'Gasto Oficina': 'gastos_operativos', 'Gasto Personal (Socios)': 'gastos_operativos',
  'Fuera de Freakie': 'gastos_operativos',
}
// categoria_grupo fallback (includes both display names AND raw catalog values)
const GRUPO_TO_PL = {
  'COGS': 'costo_comida', 'Gasto Local': 'costo_fijo', 'Gasto Venta': 'gastos_operativos',
  'Gasto Admin': 'gasto_financiero', 'Inversión': 'activo_fijo', 'No Operativo': 'gastos_operativos',
  // Raw catalogo_contable.categoria values (in case categoria_grupo uses these)
  'costo_comida': 'costo_comida', 'insumo_venta': 'insumo_venta', 'limpieza': 'limpieza',
  'costo_fijo': 'costo_fijo', 'gastos_operativos': 'gastos_operativos',
  'gasto_financiero': 'gasto_financiero', 'activo_fijo': 'activo_fijo',
  'gastos_logisticos': 'gastos_logisticos', 'planilla_legal': 'planilla',
}
// P&L keys → display groups for the P&L table
const PL_TO_DISPLAY = {
  'costo_comida': 'costoComida',
  'insumo_venta': 'costoComida',
  'limpieza': 'costoComida',
  'costo_fijo': 'gastosFijos',
  'gastos_operativos': 'gastosOp',
  'gastos_logisticos': 'gastosOp',
  'gasto_financiero': 'gastosFinan',
  'planilla': 'planilla',
  'impuestos': 'gastosFinan',
  'activo_fijo': 'inversion',
}

// ── Helpers ──
function fmt(v) { return '$' + n(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }
function fmt2(v) { return '$' + n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pct(a, b) { return b ? ((a / b) * 100).toFixed(1) + '%' : '—' }
function delta(curr, prev) {
  if (!prev || prev === 0) return { val: 0, label: '—', dir: 'neutral' }
  const d = ((curr - prev) / Math.abs(prev)) * 100
  return { val: d, label: (d >= 0 ? '+' : '') + d.toFixed(1) + '%', dir: d > 1 ? 'up' : d < -1 ? 'down' : 'neutral' }
}
function daysInMonth(y, m) { return new Date(y, m, 0).getDate() }
function periodRange(year, month, maxDay) {
  const desde = `${year}-${String(month).padStart(2, '0')}-01`
  const clampedDay = Math.min(maxDay, daysInMonth(year, month))
  // Use Date object to correctly handle month overflow (day 32 → next month)
  const hastaDate = new Date(year, month - 1, clampedDay + 1)
  const hasta = hastaDate.toISOString().split('T')[0]
  return { desde, hasta }
}
function prevMonth(y, m, offset = 1) {
  let ny = y, nm = m - offset
  while (nm < 1) { nm += 12; ny -= 1 }
  return { year: ny, month: nm }
}
// Valid P&L keys (same as FinanzasDashboard initMonth)
const VALID_PL_KEYS = { costo_comida: true, insumo_venta: true, limpieza: true, costo_fijo: true, gastos_operativos: true, gastos_logisticos: true, gasto_financiero: true, planilla: true, impuestos: true, activo_fijo: true }

function classifyGasto(g) {
  const catNombre = g.categoria_nombre || ''
  // Same 3-step logic as FinanzasDashboard line 300:
  // 1. CATNAME_TO_PL by exact name (e.g., 'Insumo Cocina' → 'costo_comida')
  // 2. GRUPO_TO_PL by group (e.g., 'COGS' → 'costo_comida')
  // 3. catNombre directly if it's a valid PL key (e.g., 'costo_comida' → 'costo_comida')
  let plKey = CATNAME_TO_PL[catNombre] || GRUPO_TO_PL[g.categoria_grupo] || catNombre || 'gastos_operativos'
  if (plKey === 'Alquiler') plKey = 'costo_fijo'
  // Validate: if plKey is not a recognized P&L key, fallback
  if (!VALID_PL_KEYS[plKey]) plKey = 'gastos_operativos'
  return plKey
}

// ── Paginated fetch (Supabase max 1000) ──
async function fetchAll(table, select, filter) {
  const PAGE = 1000
  let all = [], offset = 0
  while (true) {
    let q = db.from(table).select(select).range(offset, offset + PAGE - 1)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) { console.error(`fetchAll ${table}:`, error); break }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

// ── Process raw data into P&L structure ──
// Uses CATNAME_TO_PL + GRUPO_TO_PL (same as FinanzasDashboard) for correct classification
function buildPnL(ventas, gastos, conIva, planillaBySuc) {
  const ventasPorSuc = {}
  ;(ventas || []).forEach(v => {
    if (!ventasPorSuc[v.store_code]) ventasPorSuc[v.store_code] = 0
    ventasPorSuc[v.store_code] += conIva ? n(v.total_ventas_quanto) : n(v.total_ventas_quanto) / 1.13
  })

  // P&L groups per branch: { sucursal: { costoComida, gastosFijos, gastosOp, gastosFinan, planilla, inversion } }
  const initPL = () => ({ costoComida: 0, gastosFijos: 0, gastosOp: 0, gastosFinan: 0, planilla: 0, inversion: 0 })
  const plPorSuc = {}
  const gastosPorCat = {}    // For category breakdown tab
  const gastosPorSucCat = {} // For category breakdown per branch
  const catToGrupo = {}      // Display mapping

  // FIX 17-Abr-2026: sumar planilla real por sucursal desde v_planilla_por_sucursal
  // Empleados sin sucursal → store_code NULL → se atribuyen a CORP y se prorratean por peso de ventas
  ;(planillaBySuc || []).forEach(p => {
    const suc = p.store_code || 'CORP'
    if (!plPorSuc[suc]) plPorSuc[suc] = initPL()
    plPorSuc[suc].planilla += n(p.monto) || 0
    const catName = 'Gasto Planilla'
    gastosPorCat[catName] = (gastosPorCat[catName] || 0) + (n(p.monto) || 0)
    if (!gastosPorSucCat[suc]) gastosPorSucCat[suc] = {}
    gastosPorSucCat[suc][catName] = (gastosPorSucCat[suc][catName] || 0) + (n(p.monto) || 0)
    catToGrupo[catName] = 'Planilla'
  })

  ;(gastos || []).forEach(g => {
    const suc = g.store_code || 'CORP'
    const monto = conIva ? (n(g.monto) || 0) : (n(g.monto_sin_iva) || n(g.monto) || 0)

    // Classify using the same logic as FinanzasDashboard
    const plKey = classifyGasto(g)
    const displayGroup = PL_TO_DISPLAY[plKey] || 'gastosOp'

    if (!plPorSuc[suc]) plPorSuc[suc] = initPL()
    plPorSuc[suc][displayGroup] = (plPorSuc[suc][displayGroup] || 0) + monto

    // For category breakdown tab
    const catName = g.categoria_nombre || g.subcategoria_contable || 'Sin Clasificar'
    gastosPorCat[catName] = (gastosPorCat[catName] || 0) + monto
    if (!gastosPorSucCat[suc]) gastosPorSucCat[suc] = {}
    gastosPorSucCat[suc][catName] = (gastosPorSucCat[suc][catName] || 0) + monto

    // Map category name → display group for the categories tab
    const grupoLabels = {
      costoComida: 'Costo Comida', gastosFijos: 'Gasto Fijo', gastosOp: 'Gasto Operativo',
      gastosFinan: 'Gasto Financiero', planilla: 'Planilla', inversion: 'Inversión'
    }
    catToGrupo[catName] = grupoLabels[displayGroup] || 'Gasto Operativo'
  })

  const corpPL = plPorSuc['CORP'] || initPL()
  const totalVentas = Object.values(ventasPorSuc).reduce((a, b) => a + b, 0)

  const pnl = {}
  SUC_KEYS.forEach(suc => {
    const venta = ventasPorSuc[suc] || 0
    const peso = totalVentas > 0 ? venta / totalVentas : 0
    const sucPL = plPorSuc[suc] || initPL()

    // Direct costs + prorated corporate costs
    let costoComida = sucPL.costoComida + (corpPL.costoComida * peso)
    let gastosFijos = sucPL.gastosFijos + (corpPL.gastosFijos * peso)
    let gastosOp = sucPL.gastosOp + (corpPL.gastosOp * peso)
    let gastosFinan = sucPL.gastosFinan + (corpPL.gastosFinan * peso)
    let planilla = sucPL.planilla + (corpPL.planilla * peso)

    const utilidadBruta = venta - costoComida
    const totalGastos = gastosFijos + gastosOp + gastosFinan + planilla
    const utilidadOperativa = utilidadBruta - totalGastos

    pnl[suc] = {
      venta, costoComida, utilidadBruta,
      margenBruto: venta > 0 ? (utilidadBruta / venta) * 100 : 0,
      gastosFijos, gastosOp, gastosFinan, planilla,
      totalGastos, utilidadOperativa,
      margenOperativo: venta > 0 ? (utilidadOperativa / venta) * 100 : 0,
    }
  })

  const totalCOGS = SUC_KEYS.reduce((s, k) => s + n(pnl[k]?.costoComida), 0)
  const totalUB = SUC_KEYS.reduce((s, k) => s + n(pnl[k]?.utilidadBruta), 0)
  const totalGastosOp = SUC_KEYS.reduce((s, k) => s + n(pnl[k]?.totalGastos), 0)
  const totalUO = SUC_KEYS.reduce((s, k) => s + n(pnl[k]?.utilidadOperativa), 0)

  return { pnl, ventasPorSuc, totalVentas, totalCOGS, totalUB, totalGastosOp, totalUO, gastosPorCat, gastosPorSucCat, catToGrupo }
}

// ── Fetch period data ──
async function fetchPeriod(year, month, maxDay, conIva) {
  const { desde, hasta } = periodRange(year, month, maxDay)
  const [ventasRes, gastos, planillaRes] = await Promise.all([
    db.from('v_ventas_unificadas').select('store_code, total_ventas_quanto, fecha, fuente').gte('fecha', desde).lt('fecha', hasta),
    fetchAll('v_gastos_consolidados',
      'fecha, proveedor_nombre, monto, monto_sin_iva, categoria_nombre, categoria_grupo, subcategoria_contable, origen, store_code',
      q => q.gte('fecha', desde).lt('fecha', hasta)),
    // FIX 17-Abr-2026: leer planilla por sucursal desde vista nueva (gasto empresa = devengado + patronales)
    db.from('v_planilla_por_sucursal').select('store_code, monto, fecha').gte('fecha', desde).lt('fecha', hasta)
  ])
  return buildPnL(ventasRes.data, gastos, conIva, planillaRes.data)
}

// ═══════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════

function KpiCard({ label, value, sub, changeLabel, changeDir, color, sparkData }) {
  const gradients = {
    blue: 'linear-gradient(90deg, #3B82F6, #60A5FA)',
    green: 'linear-gradient(90deg, #059669, #10B981)',
    red: 'linear-gradient(90deg, #DC2626, #EF4444)',
    yellow: 'linear-gradient(90deg, #D97706, #F59E0B)',
    purple: 'linear-gradient(90deg, #7C3AED, #8B5CF6)',
  }
  const baseColors = { blue: T.accent, green: T.green, red: T.red, yellow: T.yellow, purple: T.purple }
  return (
    <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px', flex: 1, minWidth: 170, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: gradients[color] || gradients.blue }} />
      <div style={{ fontSize: 11, fontWeight: 500, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: T.text, letterSpacing: -0.5 }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        {changeLabel && <Delta label={changeLabel} dir={changeDir} />}
        {sub && <span style={{ fontSize: 11, color: T.textMuted }}>{sub}</span>}
      </div>
      {sparkData && sparkData.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, marginTop: 8 }}>
          {sparkData.map((v, i) => {
            const max = Math.max(...sparkData)
            const h = max > 0 ? (v / max) * 100 : 0
            const opacity = 0.3 + (i / sparkData.length) * 0.7
            return <div key={i} style={{ flex: 1, height: `${h}%`, background: baseColors[color] || T.accent, opacity, borderRadius: 2, minWidth: 4 }} />
          })}
        </div>
      )}
    </div>
  )
}

function Delta({ label, dir, style: sx }) {
  if (!label || label === '—') return <span style={{ fontSize: 11, color: T.textMuted, ...sx }}>—</span>
  const colors = { up: T.green, down: T.red, neutral: T.yellow }
  const bgs = { up: T.greenBg, down: T.redBg, neutral: T.yellowBg }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4, color: colors[dir], background: bgs[dir], ...sx }}>
      {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●'} {label}
    </span>
  )
}

function StackedBar({ segments }) {
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 12 }}>
      {segments.map((s, i) => <div key={i} style={{ width: `${s.pct}%`, height: '100%', background: s.color }} title={`${s.label} ${s.pct.toFixed(1)}%`} />)}
    </div>
  )
}

// ═══════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════

export default function RentabilidadView({ user }) {
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date(Date.now() - 6 * 3600 * 1000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [tab, setTab] = useState('pnl')
  const [conIva, setConIva] = useState(false)
  const [compMode, setCompMode] = useState('1m') // 1m | 3m | 6m
  const [datos, setDatos] = useState(null)
  const [toast, setToast] = useState(null)

  const [year, month] = periodo.split('-').map(Number)
  const mesLabel = `${MESES_FULL[month - 1]} ${year}`

  // Calculate current day into the period
  const hoy = new Date(Date.now() - 6 * 3600 * 1000)
  const isCurrentMonth = hoy.getFullYear() === year && (hoy.getMonth() + 1) === month
  const diaActual = isCurrentMonth ? hoy.getDate() : daysInMonth(year, month)
  const diasEnMes = daysInMonth(year, month)
  const pctMes = Math.round((diaActual / diasEnMes) * 100)

  // ── Load data ──
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      // Current period (up to diaActual)
      const curr = await fetchPeriod(year, month, diaActual, conIva)

      // Comparison periods (same # of days)
      const comp1m = prevMonth(year, month, 1)
      const prev1 = await fetchPeriod(comp1m.year, comp1m.month, diaActual, conIva)

      // 3M and 6M averages
      let sum3 = null, sum6 = null
      const prevPeriods = []
      for (let i = 1; i <= 6; i++) {
        const pm = prevMonth(year, month, i)
        if (i <= 1) { prevPeriods.push(prev1); continue } // already fetched
        const pd = await fetchPeriod(pm.year, pm.month, diaActual, conIva)
        prevPeriods.push(pd)
      }

      // Average function
      const avgPeriods = (periods) => {
        const avg = { totalVentas: 0, totalCOGS: 0, totalUB: 0, totalGastosOp: 0, totalUO: 0, pnl: {} }
        const count = periods.length
        if (!count) return avg
        SUC_KEYS.forEach(s => {
          avg.pnl[s] = { venta: 0, costoComida: 0, utilidadBruta: 0, gastosFijos: 0, gastosOp: 0, gastosFinan: 0, planilla: 0, totalGastos: 0, utilidadOperativa: 0, margenBruto: 0, margenOperativo: 0 }
        })
        periods.forEach(p => {
          avg.totalVentas += p.totalVentas / count
          avg.totalCOGS += p.totalCOGS / count
          avg.totalUB += p.totalUB / count
          avg.totalGastosOp += p.totalGastosOp / count
          avg.totalUO += p.totalUO / count
          SUC_KEYS.forEach(s => {
            if (!p.pnl[s]) return
            const a = avg.pnl[s]
            Object.keys(a).forEach(k => { a[k] += (p.pnl[s][k] || 0) / count })
          })
        })
        return avg
      }

      sum3 = avgPeriods(prevPeriods.slice(0, 3))
      sum6 = avgPeriods(prevPeriods.slice(0, 6))

      // Sparkline data: last 6 months total ventas
      const sparkVentas = prevPeriods.map(p => p.totalVentas).reverse()
      sparkVentas.push(curr.totalVentas)
      const sparkUB = prevPeriods.map(p => p.totalUB).reverse()
      sparkUB.push(curr.totalUB)
      const sparkGastos = prevPeriods.map(p => p.totalGastosOp).reverse()
      sparkGastos.push(curr.totalGastosOp)
      const sparkUO = prevPeriods.map(p => p.totalUO).reverse()
      sparkUO.push(curr.totalUO)

      // Trend data for chart
      const trendLabels = []
      for (let i = 5; i >= 0; i--) {
        const pm = prevMonth(year, month, i)
        trendLabels.push(MESES[pm.month - 1])
      }
      trendLabels.push(MESES[month - 1])

      setDatos({
        curr, prev1, avg3: sum3, avg6: sum6,
        spark: { ventas: sparkVentas, ub: sparkUB, gastos: sparkGastos, uo: sparkUO },
        trend: {
          labels: trendLabels,
          ventas: [...prevPeriods.map(p => p.totalVentas).reverse(), curr.totalVentas],
          ub: [...prevPeriods.map(p => p.totalUB).reverse(), curr.totalUB],
          uo: [...prevPeriods.map(p => p.totalUO).reverse(), curr.totalUO],
        },
        prevPeriods,
      })
    } catch (err) {
      console.error('Error cargando rentabilidad:', err)
      setToast({ msg: 'Error cargando datos: ' + err.message, tipo: 'error' })
    }
    setLoading(false)
  }, [year, month, diaActual, conIva])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Comparison ref based on mode
  const comp = useMemo(() => {
    if (!datos) return null
    if (compMode === '1m') return datos.prev1
    if (compMode === '3m') return datos.avg3
    return datos.avg6
  }, [datos, compMode])

  const compLabel = compMode === '1m' ? `${MESES[prevMonth(year, month, 1).month - 1]}` : compMode === '3m' ? 'Prom. 3M' : 'Prom. 6M'

  // Projection
  const proyeccion = datos && diaActual > 0 ? (datos.curr.totalVentas / diaActual) * diasEnMes : 0

  // ── Navigation ──
  const navPeriodo = (dir) => {
    let ny = year, nm = month + dir
    if (nm > 12) { nm = 1; ny++ }
    if (nm < 1) { nm = 12; ny-- }
    setPeriodo(`${ny}-${String(nm).padStart(2, '0')}`)
  }

  // ═══════ RENDER ═══════
  return (
    <div style={{ padding: '0 0 40px 0', maxWidth: 1440, color: T.text }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: toast.tipo === 'error' ? '#7F1D1D' : '#064E3B', color: '#fff', border: `1px solid ${toast.tipo === 'error' ? T.red : T.green}`, borderRadius: 10, padding: '12px 20px', fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Rentabilidad × Sucursal</h2>
          <span style={{ background: T.accent, color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 100 }}>LIVE</span>
        </div>
        <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 12, color: T.textMuted }}>
          Día <strong style={{ color: T.accentLight, fontWeight: 700 }}>{diaActual}</strong> de {diasEnMes} · {pctMes}% del mes
        </div>
      </div>

      {/* ═══ CONTROLS ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, padding: '4px 8px' }}>
          <button onClick={() => navPeriodo(-1)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', padding: '4px 8px', fontSize: 16, borderRadius: 4 }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text, minWidth: 120, textAlign: 'center' }}>{mesLabel}</span>
          <button onClick={() => navPeriodo(1)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', padding: '4px 8px', fontSize: 16, borderRadius: 4 }}>›</button>
        </div>

        {/* Comparison mode */}
        <div style={{ display: 'flex', background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {[{ key: '1m', label: 'vs Mes Ant.' }, { key: '3m', label: 'vs 3M Prom.' }, { key: '6m', label: 'vs 6M Prom.' }].map(b => (
            <button key={b.key} onClick={() => setCompMode(b.key)} style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', transition: 'all 0.2s',
              background: compMode === b.key ? T.accent : 'transparent',
              color: compMode === b.key ? '#fff' : T.textMuted,
            }}>{b.label}</button>
          ))}
        </div>

        {/* IVA toggle */}
        <div onClick={() => setConIva(!conIva)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: T.textSec, userSelect: 'none' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: conIva ? T.yellow : T.green }} />
          {conIva ? 'Con IVA' : 'Sin IVA'}
        </div>
      </div>

      {/* ═══ LOADING ═══ */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: T.textMuted }}>
          <div style={{ fontSize: 14 }}>Cargando datos de {mesLabel}...</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>Obteniendo 7 períodos para comparación</div>
        </div>
      ) : !datos ? (
        <div style={{ textAlign: 'center', padding: 60, color: T.textMuted }}>Sin datos</div>
      ) : (
        <>
          {/* ═══ KPIs ═══ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 14, marginBottom: 24 }}>
            <KpiCard
              label={`Ventas (${diaActual}d)`} value={fmt(datos.curr.totalVentas)}
              changeLabel={delta(datos.curr.totalVentas, comp?.totalVentas).label}
              changeDir={delta(datos.curr.totalVentas, comp?.totalVentas).dir}
              sub={`${compLabel}: ${fmt(comp?.totalVentas)}`}
              color="blue" sparkData={datos.spark.ventas}
            />
            <KpiCard
              label="Utilidad Bruta" value={fmt(datos.curr.totalUB)}
              changeLabel={delta(datos.curr.totalUB, comp?.totalUB).label}
              changeDir={delta(datos.curr.totalUB, comp?.totalUB).dir}
              sub={`Margen ${pct(datos.curr.totalUB, datos.curr.totalVentas)}`}
              color="green" sparkData={datos.spark.ub}
            />
            <KpiCard
              label="Gastos Operativos" value={fmt(datos.curr.totalGastosOp + datos.curr.totalCOGS)}
              changeLabel={delta(datos.curr.totalGastosOp + datos.curr.totalCOGS, (comp?.totalGastosOp || 0) + (comp?.totalCOGS || 0)).label}
              changeDir={(() => { const d = delta(datos.curr.totalGastosOp + datos.curr.totalCOGS, (comp?.totalGastosOp || 0) + (comp?.totalCOGS || 0)); return d.dir === 'up' ? 'down' : d.dir === 'down' ? 'up' : 'neutral' })()}
              sub={`${compLabel}: ${fmt((comp?.totalGastosOp || 0) + (comp?.totalCOGS || 0))}`}
              color="red" sparkData={datos.spark.gastos}
            />
            <KpiCard
              label="Utilidad Operativa" value={fmt(datos.curr.totalUO)}
              changeLabel={delta(datos.curr.totalUO, comp?.totalUO).label}
              changeDir={delta(datos.curr.totalUO, comp?.totalUO).dir}
              sub={`Margen ${pct(datos.curr.totalUO, datos.curr.totalVentas)}`}
              color="yellow" sparkData={datos.spark.uo}
            />
            <KpiCard
              label="Proyección Mes" value={fmt(proyeccion)}
              changeLabel={datos.prev1 ? delta(proyeccion, datos.prev1.totalVentas * (diasEnMes / diaActual)).label : '—'}
              changeDir={datos.prev1 ? delta(proyeccion, datos.prev1.totalVentas * (diasEnMes / diaActual)).dir : 'neutral'}
              sub={`vs ${MESES[prevMonth(year, month, 1).month - 1]} completo`}
              color="purple" sparkData={[]}
            />
          </div>

          {/* ═══ TABS ═══ */}
          <div style={{ display: 'flex', gap: 0, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
            {[
              { key: 'pnl', label: '📊 P&L por Sucursal' },
              { key: 'sucursales', label: '🏪 Vista por Sucursal' },
              { key: 'categorias', label: '📁 Desglose Categorías' },
              { key: 'tendencias', label: '📈 Tendencias' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                flex: 1, padding: '12px 20px', textAlign: 'center', fontSize: 13, fontWeight: tab === t.key ? 600 : 500,
                color: tab === t.key ? '#fff' : T.textMuted, cursor: 'pointer', transition: 'all 0.2s',
                background: tab === t.key ? T.accent : 'transparent',
                border: 'none', borderRight: `1px solid ${T.border}`,
              }}>{t.label}</button>
            ))}
          </div>

          {/* ═══ TAB: P&L TABLE ═══ */}
          {tab === 'pnl' && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Estado de Resultados — Primeros {diaActual} días</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>Comparando {MESES[month - 1]} 1-{diaActual} vs {compLabel} (mismos días) · {conIva ? 'Con' : 'Sin'} IVA</div>
              </div>

              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Concepto</th>
                        {SUC_KEYS.map(s => (
                          <th key={s} style={thStyle}>
                            {STORES[s]}<br/><span style={{ fontWeight: 400, fontSize: 10, color: T.textMuted }}>{s}</span>
                          </th>
                        ))}
                        <th style={thStyle}>Δ%</th>
                        <th style={{ ...thStyle, borderLeft: `2px solid ${T.borderLight}` }}>TOTAL</th>
                        <th style={thStyle}>Δ%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* VENTAS */}
                      <tr style={sectionRow}><td colSpan={SUC_KEYS.length + 4} style={sectionTd}>INGRESOS</td></tr>
                      <PnlRow label="Ventas Netas" curr={datos.curr} comp={comp} field="venta" positive />

                      {/* COGS */}
                      <tr style={sectionRow}><td colSpan={SUC_KEYS.length + 4} style={sectionTd}>COSTO DE VENTAS</td></tr>
                      <PnlRow label="(–) Costo Comida" curr={datos.curr} comp={comp} field="costoComida" negative invertDelta />

                      {/* Utilidad Bruta */}
                      <PnlRow label="= Utilidad Bruta" curr={datos.curr} comp={comp} field="utilidadBruta" subtotal positive />
                      <MarginRow label="% Margen Bruto" curr={datos.curr} field="margenBruto" comp={comp} />

                      {/* GASTOS OPERATIVOS */}
                      <tr style={sectionRow}><td colSpan={SUC_KEYS.length + 4} style={sectionTd}>GASTOS OPERATIVOS</td></tr>
                      <PnlRow label="(–) Gastos Fijos (Alq/Luz/Agua)" curr={datos.curr} comp={comp} field="gastosFijos" negative invertDelta />
                      <PnlRow label="(–) Gastos Operativos" curr={datos.curr} comp={comp} field="gastosOp" negative invertDelta />
                      <PnlRow label="(–) Planilla" curr={datos.curr} comp={comp} field="planilla" negative invertDelta />
                      <PnlRow label="(–) Gastos Financieros" curr={datos.curr} comp={comp} field="gastosFinan" negative invertDelta />

                      {/* Utilidad Operativa */}
                      <PnlRow label="= Utilidad Operativa" curr={datos.curr} comp={comp} field="utilidadOperativa" subtotal positive isFinal />
                      <MarginRow label="% Margen Operativo" curr={datos.curr} field="margenOperativo" comp={comp} />
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ marginTop: 12, padding: '8px 14px', fontSize: 11, color: T.textMuted }}>
                CORP = gastos sin sucursal asignada (prorrateados por peso de venta). Fuente: ventas_diarias + v_gastos_consolidados + catalogo_contable.
              </div>
            </div>
          )}

          {/* ═══ TAB: BRANCH CARDS ═══ */}
          {tab === 'sucursales' && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Resumen por Sucursal</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>Performance relativo — {MESES[month - 1]} 1-{diaActual} vs {compLabel}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 24 }}>
                {SUC_KEYS.map(s => {
                  const c = datos.curr.pnl[s]
                  const p = comp?.pnl[s]
                  if (!c || !c.venta) return null
                  const dVenta = delta(c.venta, p?.venta)
                  const dUO = delta(c.utilidadOperativa, p?.utilidadOperativa)
                  const isWarning = dVenta.dir === 'down' || dUO.dir === 'down'

                  const total = c.venta || 1
                  const segments = [
                    { pct: (c.costoComida / total) * 100, color: T.red, label: 'Costo Comida' },
                    { pct: (c.gastosFijos / total) * 100, color: T.yellow, label: 'Gasto Fijo' },
                    { pct: (c.gastosOp / total) * 100, color: T.purple, label: 'Gasto Op.' },
                    { pct: ((c.gastosFinan + c.planilla) / total) * 100, color: '#64748B', label: 'Planilla/Finan.' },
                    { pct: Math.max(0, (c.utilidadOperativa / total) * 100), color: T.green, label: 'Utilidad' },
                  ]

                  return (
                    <div key={s} style={{ background: T.bgCard, border: `1px solid ${isWarning ? 'rgba(239,68,68,0.3)' : T.border}`, borderRadius: 12, padding: '18px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{STORES[s]}</span>
                        <span style={{ fontSize: 11, color: T.textMuted, background: T.bgSurface, padding: '2px 8px', borderRadius: 4 }}>{s}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ventas</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginTop: 2 }}>{fmt(c.venta)}</div>
                          <div style={{ marginTop: 2 }}><Delta label={dVenta.label} dir={dVenta.dir} /></div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Utilidad Op.</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: c.utilidadOperativa >= 0 ? T.green : T.red, marginTop: 2 }}>{fmt(c.utilidadOperativa)}</div>
                          <div style={{ marginTop: 2 }}><Delta label={dUO.label} dir={dUO.dir} /></div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Margen Bruto</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginTop: 2 }}>{c.margenBruto.toFixed(1)}%</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Margen Op.</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: c.margenOperativo >= 25 ? T.green : c.margenOperativo >= 15 ? T.yellow : T.red, marginTop: 2 }}>{c.margenOperativo.toFixed(1)}%</div>
                        </div>
                      </div>
                      <StackedBar segments={segments} />
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { color: T.red, label: 'Costo Comida' }, { color: T.yellow, label: 'Gasto Fijo' },
                  { color: T.purple, label: 'Gasto Operativo' }, { color: '#64748B', label: 'Planilla/Financiero' },
                  { color: T.green, label: 'Utilidad Operativa' },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />{l.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ TAB: CATEGORY BREAKDOWN ═══ */}
          {tab === 'categorias' && (() => {
            const cats = datos.curr.gastosPorCat
            const totalVentas = datos.curr.totalVentas || 1

            // Group by P&L grupo
            const grupos = {}
            Object.entries(cats).forEach(([cat, monto]) => {
              const grupo = datos.curr.catToGrupo[cat] || 'Otro'
              if (!grupos[grupo]) grupos[grupo] = { total: 0, items: [] }
              grupos[grupo].total += monto
              grupos[grupo].items.push({ name: cat, monto })
            })
            Object.values(grupos).forEach(g => g.items.sort((a, b) => b.monto - a.monto))

            const grupoMeta = {
              'Costo Comida': { icon: '🥩', label: 'Costo Comida', color: T.red },
              'Gasto Fijo': { icon: '🏢', label: 'Costos Fijos (Alquiler/Luz/Agua)', color: T.yellow },
              'Gasto Operativo': { icon: '⚙️', label: 'Gastos Operativos', color: T.purple },
              'Gasto Financiero': { icon: '🏦', label: 'Gastos Financieros', color: T.accent },
              'Planilla': { icon: '👥', label: 'Planilla', color: '#0EA5E9' },
              'Inversión': { icon: '🔧', label: 'Inversión / Activo Fijo', color: '#64748B' },
            }

            return (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Desglose por Categoría de Gasto</div>
                  <div style={{ fontSize: 12, color: T.textMuted }}>Subcategorías y proveedores — {MESES[month - 1]} 1-{diaActual}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginBottom: 24 }}>
                  {Object.entries(grupos).sort((a, b) => b[1].total - a[1].total).map(([grupo, data]) => {
                    const meta = grupoMeta[grupo] || { icon: '📋', label: grupo, color: T.textSec }
                    const pctVentas = ((data.total / totalVentas) * 100).toFixed(1)
                    return (
                      <div key={grupo} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{meta.icon} {meta.label}</div>
                            <div style={{ fontSize: 12, color: T.textMuted }}>{pctVentas}% de ventas</div>
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: meta.color }}>{fmt(data.total)}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                          {data.items.slice(0, 8).map(item => {
                            const maxItem = data.items[0]?.monto || 1
                            return (
                              <div key={item.name} style={{ display: 'flex', alignItems: 'center', fontSize: 12 }}>
                                <span style={{ color: T.textSec, minWidth: 120, flexShrink: 0 }}>{item.name}</span>
                                <div style={{ flex: 1, margin: '0 12px', height: 4, background: T.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${(item.monto / maxItem) * 100}%`, background: meta.color, borderRadius: 2 }} />
                                </div>
                                <span style={{ color: T.text, fontWeight: 600, minWidth: 70, textAlign: 'right' }}>{fmt(item.monto)}</span>
                              </div>
                            )
                          })}
                          {data.items.length > 8 && (
                            <div style={{ fontSize: 11, color: T.textMuted, textAlign: 'center', marginTop: 4 }}>
                              +{data.items.length - 8} categorías más
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ═══ TAB: TRENDS ═══ */}
          {tab === 'tendencias' && datos.trend && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Tendencia de Márgenes — Últimos 6 meses</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>Primeros {diaActual} días de cada mes para comparabilidad</div>
              </div>

              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                  {[{ color: T.accent, label: 'Ventas' }, { color: T.green, label: 'Utilidad Bruta' }, { color: T.yellow, label: 'Utilidad Operativa' }].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted }}>
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />{l.label}
                    </div>
                  ))}
                </div>

                {/* Bar chart */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, padding: '0 4px' }}>
                  {datos.trend.labels.map((label, i) => {
                    const maxV = Math.max(...datos.trend.ventas)
                    const isLast = i === datos.trend.labels.length - 1
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', width: '100%', height: 140 }}>
                          <div style={{ flex: 1, height: `${maxV > 0 ? (datos.trend.ventas[i] / maxV) * 100 : 0}%`, background: T.accent, opacity: isLast ? 1 : 0.5 + i * 0.07, borderRadius: '3px 3px 0 0', border: isLast ? `2px solid ${T.accentLight}` : 'none' }} />
                          <div style={{ flex: 1, height: `${maxV > 0 ? (datos.trend.ub[i] / maxV) * 100 : 0}%`, background: T.green, opacity: isLast ? 1 : 0.5 + i * 0.07, borderRadius: '3px 3px 0 0', border: isLast ? '2px solid #34D399' : 'none' }} />
                          <div style={{ flex: 1, height: `${maxV > 0 ? (datos.trend.uo[i] / maxV) * 100 : 0}%`, background: T.yellow, opacity: isLast ? 1 : 0.5 + i * 0.07, borderRadius: '3px 3px 0 0', border: isLast ? '2px solid #FCD34D' : 'none' }} />
                        </div>
                        <div style={{ fontSize: 10, color: isLast ? T.accentLight : T.textMuted, fontWeight: isLast ? 700 : 400 }}>{label}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Summary metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Margen Bruto (actual)</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: T.green }}>{pct(datos.curr.totalUB, datos.curr.totalVentas)}</div>
                    {datos.prevPeriods.length >= 6 && (
                      <div style={{ fontSize: 11, color: T.green }}>
                        {(() => {
                          const old = datos.prevPeriods[5]
                          const oldMargin = old.totalVentas > 0 ? (old.totalUB / old.totalVentas) * 100 : 0
                          const currMargin = datos.curr.totalVentas > 0 ? (datos.curr.totalUB / datos.curr.totalVentas) * 100 : 0
                          const diff = currMargin - oldMargin
                          return `${diff >= 0 ? '▲' : '▼'} ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp vs 6M atrás`
                        })()}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Margen Operativo (actual)</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: T.yellow }}>{pct(datos.curr.totalUO, datos.curr.totalVentas)}</div>
                    {datos.prevPeriods.length >= 6 && (
                      <div style={{ fontSize: 11, color: T.green }}>
                        {(() => {
                          const old = datos.prevPeriods[5]
                          const oldMargin = old.totalVentas > 0 ? (old.totalUO / old.totalVentas) * 100 : 0
                          const currMargin = datos.curr.totalVentas > 0 ? (datos.curr.totalUO / datos.curr.totalVentas) * 100 : 0
                          const diff = currMargin - oldMargin
                          return `${diff >= 0 ? '▲' : '▼'} ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp vs 6M atrás`
                        })()}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Venta Promedio Diaria</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: T.accentLight }}>{fmt(datos.curr.totalVentas / Math.max(diaActual, 1))}</div>
                    <div style={{ fontSize: 11, color: T.textMuted }}>
                      {fmt(datos.curr.totalVentas / Math.max(diaActual, 1) / SUC_KEYS.length)} / sucursal
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-branch trend table */}
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Evolución por Sucursal</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, textAlign: 'left' }}>Sucursal</th>
                        {datos.trend.labels.map((l, i) => (
                          <th key={i} style={{ ...thStyle, color: i === datos.trend.labels.length - 1 ? T.accentLight : T.textSec }}>{l}</th>
                        ))}
                        <th style={thStyle}>Δ 6M</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SUC_KEYS.map(s => {
                        const periods = [...datos.prevPeriods.map(p => p.pnl[s]?.venta || 0).reverse(), datos.curr.pnl[s]?.venta || 0]
                        const first = periods[0] || 1
                        const last = periods[periods.length - 1]
                        const d = delta(last, first)
                        return (
                          <tr key={s}>
                            <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500, color: T.text }}>{STORES[s]}</td>
                            {periods.map((v, i) => (
                              <td key={i} style={{ ...tdStyle, color: i === periods.length - 1 ? T.text : T.textSec, fontWeight: i === periods.length - 1 ? 600 : 400 }}>
                                {fmt(v)}
                              </td>
                            ))}
                            <td style={tdStyle}><Delta label={d.label} dir={d.dir} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ═══ FOOTER ═══ */}
          <div style={{ textAlign: 'center', padding: 20, color: T.textMuted, fontSize: 11, marginTop: 16 }}>
            Datos: ventas_diarias + v_gastos_consolidados + catalogo_contable · Costos CORP prorrateados por peso de ventas · IVA {conIva ? 'incluido' : 'excluido'}
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// Table row components
// ═══════════════════════════════════════════

const thStyle = {
  background: '#1E293B', padding: '10px 14px', fontWeight: 600, color: '#94A3B8',
  textAlign: 'right', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
  whiteSpace: 'nowrap', borderBottom: '1px solid #1E293B', position: 'sticky', top: 0,
}
const tdStyle = {
  padding: '10px 14px', textAlign: 'right', borderBottom: '1px solid #1E293B',
  whiteSpace: 'nowrap', color: '#94A3B8',
}
const sectionRow = {}
const sectionTd = {
  padding: '14px 14px 6px', fontWeight: 600, color: '#60A5FA', fontSize: 11,
  textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: 'none',
}

function PnlRow({ label, curr, comp, field, positive, negative, subtotal, invertDelta, isFinal }) {
  const totalCurr = SUC_KEYS.reduce((s, k) => s + n(curr.pnl[k]?.[field]), 0)
  const totalComp = comp ? SUC_KEYS.reduce((s, k) => s + n(comp.pnl[k]?.[field]), 0) : 0

  const bgStyle = subtotal ? { background: 'rgba(59,130,246,0.05)' } : {}
  const tdBase = { ...tdStyle }
  if (subtotal) { tdBase.fontWeight = 600; tdBase.color = '#F1F5F9'; tdBase.borderTop = `2px solid #334155` }

  // Find best delta for the "combined" column
  const bestDelta = delta(totalCurr, totalComp)

  return (
    <tr style={bgStyle}>
      <td style={{ ...tdBase, textAlign: 'left', fontWeight: subtotal ? 700 : 500, color: subtotal ? '#F1F5F9' : '#F1F5F9' }}>{label}</td>
      {SUC_KEYS.map(s => {
        const v = n(curr.pnl[s]?.[field])
        const color = negative ? '#EF4444' : positive ? (v >= 0 ? '#10B981' : '#EF4444') : '#94A3B8'
        return (
          <td key={s} style={{ ...tdBase, color: subtotal ? (v >= 0 ? '#10B981' : '#EF4444') : color }}>
            {negative ? '-' : ''}{fmt(Math.abs(v))}
          </td>
        )
      })}
      {/* Delta column: shows best/worst per row */}
      <td style={tdBase}>
        <Delta label={bestDelta.label} dir={invertDelta ? (bestDelta.dir === 'up' ? 'down' : bestDelta.dir === 'down' ? 'up' : 'neutral') : bestDelta.dir} />
      </td>
      {/* Total */}
      <td style={{ ...tdBase, borderLeft: `2px solid #334155`, fontWeight: 700, color: isFinal ? '#F1F5F9' : negative ? '#EF4444' : '#F1F5F9', fontSize: isFinal ? 14 : 13 }}>
        {negative ? '-' : ''}{fmt(Math.abs(totalCurr))}
      </td>
      <td style={tdBase}>
        <Delta label={bestDelta.label} dir={invertDelta ? (bestDelta.dir === 'up' ? 'down' : bestDelta.dir === 'down' ? 'up' : 'neutral') : bestDelta.dir} />
      </td>
    </tr>
  )
}

function MarginRow({ label, curr, field, comp }) {
  const currTotal = curr.totalVentas > 0 ? (SUC_KEYS.reduce((s, k) => s + n(curr.pnl[k]?.[field === 'margenBruto' ? 'utilidadBruta' : 'utilidadOperativa']), 0) / curr.totalVentas) * 100 : 0
  const compTotal = comp && comp.totalVentas > 0 ? (SUC_KEYS.reduce((s, k) => s + n(comp.pnl[k]?.[field === 'margenBruto' ? 'utilidadBruta' : 'utilidadOperativa']), 0) / comp.totalVentas) * 100 : 0
  const diff = currTotal - compTotal

  return (
    <tr>
      <td style={{ ...tdStyle, textAlign: 'left', color: '#64748B', fontStyle: 'italic', fontSize: 12 }}>&nbsp;&nbsp;{label}</td>
      {SUC_KEYS.map(s => {
        const v = n(curr.pnl[s]?.[field])
        const color = v >= 25 ? '#10B981' : v >= 15 ? '#F59E0B' : '#EF4444'
        return <td key={s} style={{ ...tdStyle, color, fontWeight: 500 }}>{v.toFixed(1)}%</td>
      })}
      <td style={tdStyle}></td>
      <td style={{ ...tdStyle, borderLeft: `2px solid #334155`, color: currTotal >= 25 ? '#10B981' : currTotal >= 15 ? '#F59E0B' : '#EF4444', fontWeight: 600 }}>{currTotal.toFixed(1)}%</td>
      <td style={tdStyle}>
        {comp && <span style={{ fontSize: 11, color: diff >= 0 ? '#10B981' : '#EF4444' }}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}pp</span>}
      </td>
    </tr>
  )
}
