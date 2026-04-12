import React, { useState, useEffect, useMemo } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════
   FREAKIE DOGS — DASHBOARD FINANCIERO
   Solo visible para ejecutivo + superadmin
   ═══════════════════════════════════════════ */

const ROLES = ['ejecutivo', 'admin', 'superadmin']
const EDIT_PINS = ['1000', '2000', '231155']

// ── Brand colors ──
const C = {
  red: '#e63946', redDark: '#b91c2c', redBg: '#fef2f2',
  green: '#2d6a4f', greenLight: '#4ade80', greenBg: '#f0fdf4',
  dark: '#1a1a2e', card: '#16213e', cardAlt: '#0f3460',
  gold: '#f4a261', goldBg: '#fffbeb',
  blue: '#3b82f6', blueBg: '#eff6ff',
  gray: '#6b7280', grayLight: '#f3f4f6', border: '#334155',
  white: '#fff', textMuted: '#94a3b8',
}

// ── Styles ──
const sCard = { background: C.card, borderRadius: 12, padding: 16, marginBottom: 12, border: `1px solid ${C.border}` }
const sTab = (active) => ({
  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
  background: active ? C.red : 'transparent', color: active ? C.white : C.textMuted,
  transition: 'all .2s',
})
const sKPI = (bg) => ({
  ...sCard, background: bg || C.card, textAlign: 'center', flex: 1, minWidth: 140,
})
const sH = { color: C.white, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, opacity: 0.7 }
const sVal = { fontSize: 22, fontWeight: 800, color: C.white }
const sSub = { fontSize: 11, color: C.textMuted, marginTop: 2 }
const sTh = { padding: '8px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.gold, borderBottom: `1px solid ${C.border}` }
const sTd = (neg) => ({ padding: '6px', textAlign: 'right', fontSize: 12, color: neg ? '#f87171' : C.white, fontFamily: 'monospace' })
const sTdL = { padding: '6px', textAlign: 'left', fontSize: 12, color: C.white, fontWeight: 500 }

const fmt = (n) => n == null ? '—' : '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtD = (n) => n == null ? '—' : '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'
const pctRaw = (n) => n == null ? '—' : n.toFixed(1) + '%'

// ══════════════════════════════════════════════════════
//  HISTORICAL DATA (Excel — Ago-Dic 2025 + Ene 2026)
// ══════════════════════════════════════════════════════

const HIST_MONTHS = ['Ago 2025','Sep 2025','Oct 2025','Nov 2025','Dic 2025']

const HIST_PL = {
  ventas:           [259222.75, 219343.00, 249738.53, 249093.90, 343510.83],
  costo_comida:     [143401.45, 123778.69, 140388.63, 126446.14, 198077.85],
  insumo_venta:     [5370.84, 7863.72, 3035.60, 3860.84, 6843.00],
  limpieza:         [3575.78, 3578.56, 4056.76, 2000.59, 7957.24],
  costo_fijo:       [7187.90, 8286.96, 10290.16, 15558.37, 16810.68],
  gastos_operativos:[19662.44, 23630.71, 20395.24, 13319.36, 14972.88],
  gastos_logisticos:[3068.87, 2810.08, 2741.64, 2446.11, 5791.98],
  gasto_financiero: [1369.50, 1856.81, 1689.00, 6294.97, 5309.32],
  planilla_legal:   [45406.83, 41737.35, 45295.79, 52317.91, 77556.84],
  impuestos:        [3463.70, 2716.52, 3215.04, 4755.03, 7339.75],
}

// PIV Costos breakdown
const HIST_PIV = {
  'Insumo Cocina':       [123655.76, 113403.66, 128280.16, 110464.65, 148558.77],
  'Insumo Bebida':       [19645.36, 10343.47, 11999.41, 2914.68, 177.56],
  'Insumo Producción':   [0, 31.00, 108.50, 0, 0],
  'Insumo Merch':        [1161.31, 1223.14, 564.64, 974.08, 897.06],
  'Insumo Despacho':     [2181.98, 5459.33, 1545.92, 802.78, 2045.81],
  'Insumo Empaque':      [1167.43, 1181.23, 925.03, 879.03, 2466.46],
  'Insumo Limpieza':     [3033.38, 3578.56, 4056.76, 2000.59, 7957.24],
  'Alquiler':            [5962.95, 6779.07, 8467.97, 12229.77, 15076.77],
  'Electricidad':        [917.85, 1373.35, 1804.19, 1026.24, 1503.43],
  'Agua':                [27.60, 34.80, 18.00, 26.40, 26.55],
  'Gasto de Venta':      [17532.48, 20190.18, 16979.50, 11301.07, 6911.85],
  'Gasto Logístico':     [3068.87, 2810.08, 2741.64, 2446.11, 5791.98],
  'Gasto Mercadeo':      [78.21, 869.50, 0, 0, 0],
  'Gasto Planilla':      [45406.83, 41672.35, 44580.79, 52283.62, 73807.40],
  'Gastos Legales':      [0, 65.00, 715.00, 34.29, 3749.44],
  'Gasto Financiero':    [1200.00, 1687.31, 1200.00, 5616.97, 5139.82],
  'Gasto Contabilidad':  [169.50, 169.50, 489.00, 678.00, 169.50],
  'Gasto Oficina':       [134.94, 152.73, 51.97, 82.97, 134.53],
  'Gastos Varios':       [1610.91, 2201.21, 3185.65, 624.37, 154.08],
  'Activo Fijo':         [9882.55, 29660.31, 41678.27, 38399.61, 15133.35],
  'Impuestos':           [3463.70, 2716.52, 3215.04, 4755.03, 7339.75],
}

const HIST_SUCURSAL = {
  'Santa Tecla':    [144182.74, 121137.86, 142079.87, 121302.65, 122704.16],
  'PM Soyapango':   [54783.88, 53422.23, 60205.28, 54638.15, 67727.70],
  'PM Usulután':    [58942.76, 43951.85, 37127.15, 33809.45, 34320.68],
  'Gran Plaza Lourdes': [0, 0, 0, 33546.27, 87540.93],
  'Venecia Soyapango':  [0, 0, 0, 0, 28857.22],
}

const STORE_MAP = { M001: 'Santa Tecla', S001: 'PM Soyapango', S002: 'PM Usulután', S003: 'Gran Plaza Lourdes', S004: 'Venecia Soyapango' }
const STORE_COLORS = { M001: '#e63946', S001: '#3b82f6', S002: '#f4a261', S003: '#4ade80', S004: '#a78bfa' }

// ── Provider classification — loaded from catalogo_contable table ──
// Fallback hardcoded map (used if DB fetch fails)
const PROV_CAT_FALLBACK = {
  // COSTO COMIDA
  'Corte Argentino': 'costo_comida', 'BELCA': 'costo_comida', 'FLAMO': 'costo_comida',
  'INDUSTRIAS CARNICAS': 'costo_comida', 'Excel Protein': 'costo_comida', 'Lácteos del Corral': 'costo_comida',
  'Lacteos del Corral': 'costo_comida', 'Productos Cárnicos': 'costo_comida', 'MULTICONGELADOS': 'costo_comida',
  'AGROINDUSTRIAS LACTEAS': 'costo_comida', 'AGROINDUSTRIAS SAN JULIAN': 'costo_comida',
  'URBINA DE UMAÑA': 'costo_comida', 'CALLEJA': 'costo_comida', 'Pricesmart': 'costo_comida',
  'DISTRIBUIDORA EUROPEA': 'costo_comida', 'DISTRIBUIDORA SALVADOREÑA': 'costo_comida',
  'DISTRIBUIDORA SANTA ELENA': 'costo_comida', 'PATRONIC': 'costo_comida', 'TECNISPICE': 'costo_comida',
  'OPERADORA DEL SUR': 'costo_comida', 'Embotelladora La Cascada': 'costo_comida',
  'MONICA ALEXANDRA': 'costo_comida', 'BOLCA': 'costo_comida',
  'AGROMARKET': 'costo_comida', 'Comercializadora Interamericana': 'costo_comida',
  'MOLDEADOS SALVADOREÑOS': 'costo_comida', 'CO INDUSTRIAS GIGANTE': 'costo_comida',
  'PROVEEDORES DE INSUMOS DIVERSOS': 'costo_comida', 'SUMINISTROS E INVERSIONES': 'costo_comida',
  'DISTRIBUIDORA ZABLAH': 'costo_comida', 'INVERSIONES VIDA': 'costo_comida',
  'EL NUEVO MILAGRO': 'costo_comida', 'ROBERTONI': 'costo_comida',
  // INSUMO VENTA
  'CRISTIAN JAVIER': 'insumo_venta', 'EMPAQUES ECOLOGICOS': 'insumo_venta',
  'INDUSTRIAS GRAFICAS': 'insumo_venta', 'IMPRESOS MULTIPLES': 'insumo_venta',
  'SOINTEC': 'insumo_venta', 'CASA ALVARENGA': 'insumo_venta', 'MEDIA AGENCIA': 'insumo_venta',
  // LIMPIEZA
  'ALMACENES VIDRI': 'limpieza', 'ALKEMY': 'limpieza', 'MERINSA': 'limpieza', 'Grupo SANSIR': 'limpieza',
  // COSTO FIJO
  'FONDO DE TITULARIZACION': 'costo_fijo', 'EMPRESA SALV. DE SERVICIOS': 'costo_fijo',
  'COMERCIALIZADORA DE ENERGIA': 'costo_fijo', 'Distribuidora de Electricidad': 'costo_fijo',
  'JOSE MANUEL ROMERO': 'costo_fijo', 'DEICE': 'costo_fijo', 'ADINCE': 'costo_fijo',
  'COMPAÑIA DE TELECOMUNICACIONES': 'costo_fijo', 'COMPAÑÍA DE TELECOMUNICACIONES': 'costo_fijo',
  'CTE TELECOM': 'costo_fijo', 'DIVE': 'costo_fijo',
  // GASTOS OPERATIVOS
  'Delivery Hero': 'gastos_operativos', 'TROPIGAS': 'gastos_operativos', 'UNIGAS': 'gastos_operativos',
  'AUTOFACIL': 'gastos_operativos', 'ARSEGUI': 'gastos_operativos', 'RINA XIOMARA': 'gastos_operativos',
  'TS CAPITAL': 'gastos_operativos', 'TRULYN': 'gastos_operativos', 'HIFUMI': 'gastos_operativos',
  // GASTOS LOGÍSTICOS
  'Grupo 3 Inversiones': 'gastos_logisticos', 'ECSA OPERADORA': 'gastos_logisticos',
  'CORINA MARGARITA': 'gastos_logisticos', 'COVI': 'gastos_logisticos',
  // GASTO FINANCIERO
  'Servicios Financieros': 'gasto_financiero', 'SOCIEDAD DE AHORRO': 'gasto_financiero',
  'BANCO DE AMERICA': 'gasto_financiero',
  // ACTIVO FIJO
  'GALVANIZADORA INDUSTRIAL': 'activo_fijo', 'PROMAICA': 'activo_fijo', 'LONAS DECORATIVAS': 'activo_fijo',
  'GOOD PRICE': 'activo_fijo', 'FREUND': 'activo_fijo', 'SISTEMAS FLEXIBLES': 'activo_fijo',
  'GRUPO HB': 'activo_fijo', 'ROMENA DEL PACIFICO': 'activo_fijo', 'GRUPO PLANES': 'activo_fijo',
  'UNION COMERCIAL': 'activo_fijo', 'SANTIAGO WILBERT': 'activo_fijo', 'MONTE ROYAL': 'activo_fijo',
}

// Build classifier from catalog entries (DB or fallback)
function buildClassifier(catalogRows) {
  if (!catalogRows || catalogRows.length === 0) {
    // Use fallback
    return (name) => {
      const up = (name || '').toUpperCase()
      for (const [key, cat] of Object.entries(PROV_CAT_FALLBACK)) {
        if (up.includes(key.toUpperCase())) return { categoria: cat, subcategoria: '' }
      }
      return { categoria: 'gastos_operativos', subcategoria: 'Varios' }
    }
  }
  // Build exact match map (nombre_dte → {categoria, subcategoria}) + substring map
  const exactMap = {}
  const substrMap = []
  catalogRows.forEach(r => {
    exactMap[r.nombre_dte] = { categoria: r.categoria, subcategoria: r.subcategoria }
    // Also add nombre_normalizado as substring key
    if (r.nombre_normalizado) {
      substrMap.push({ key: r.nombre_normalizado.toUpperCase(), cat: r.categoria, sub: r.subcategoria })
    }
  })
  return (name) => {
    // 1. Exact match
    if (exactMap[name]) return exactMap[name]
    // 2. Substring match on normalized
    const up = (name || '').toUpperCase()
    for (const s of substrMap) {
      if (up.includes(s.key) || s.key.includes(up.replace(/[.,\s]+/g, ' ').trim())) {
        return { categoria: s.cat, subcategoria: s.sub }
      }
    }
    return { categoria: 'gastos_operativos', subcategoria: 'Varios' }
  }
}

// ══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════

export default function FinanzasDashboard({ user }) {
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [data2026, setData2026] = useState(null)
  const [catalogo, setCatalogo] = useState([])

  // ── Access check ──
  useEffect(() => {
    if (!ROLES.includes(user?.rol)) return
    loadData2026()
  }, [])

  // Helper: paginated fetch — Supabase default limit is 1000 rows
  async function fetchAll(table, select, filter) {
    const PAGE = 1000
    let all = [], offset = 0, done = false
    while (!done) {
      let q = db.from(table).select(select).range(offset, offset + PAGE - 1)
      if (filter) q = filter(q)
      const { data, error } = await q
      if (error) { console.error(`fetchAll ${table}:`, error); break }
      if (!data || data.length === 0) { done = true; break }
      all = all.concat(data)
      if (data.length < PAGE) done = true
      else offset += PAGE
    }
    return all
  }

  async function loadData2026() {
    setLoading(true)
    try {
      // 1. Monthly sales (~500 rows, fits in 1 page)
      const ventas = await fetchAll('ventas_diarias',
        'fecha, store_code, efectivo_quanto, tarjeta_quanto, ventas_transferencia, ventas_link_pago, total_egresos, total_ingresos',
        q => q.gte('fecha', '2026-01-01').order('fecha'))

      // 2. Monthly purchases — 1000+ rows, NEEDS pagination
      const compras = await fetchAll('compras_dte',
        'fecha_emision, proveedor_nombre, monto_total',
        q => q.gte('fecha_emision', '2026-01-01').order('fecha_emision'))

      // 3. Planilla
      const planillas = await fetchAll('planillas',
        'periodo, fecha_pago, total_bruto, total_neto, total_patronal, estado',
        q => q.gte('fecha_pago', '2026-01-01'))

      // 4. Catálogo contable (clasificación proveedores desde BD)
      const { data: catData } = await db.from('catalogo_contable')
        .select('nombre_dte, nombre_normalizado, categoria, subcategoria')
        .eq('activo', true)
      setCatalogo(catData || [])

      setData2026({ ventas, compras, planillas })
    } catch (e) {
      console.error('FinanzasDashboard load error:', e)
    }
    setLoading(false)
  }

  // ── Process 2026 data into monthly P&L ──
  // Build classifier from DB catalog (or fallback)
  const classify = useMemo(() => buildClassifier(catalogo), [catalogo])

  const months2026 = useMemo(() => {
    if (!data2026) return []
    const monthMap = {}

    // Sales
    data2026.ventas.forEach(v => {
      const m = v.fecha?.substring(0, 7) // "2026-01"
      if (!m) return
      if (!monthMap[m]) monthMap[m] = { ventas: 0, bySuc: {}, pl: { costo_comida: 0, insumo_venta: 0, limpieza: 0, costo_fijo: 0, gastos_operativos: 0, gastos_logisticos: 0, gasto_financiero: 0, planilla_legal: 0, impuestos: 0, activo_fijo: 0 }, byProv: {}, egresos: 0 }
      const total = (v.efectivo_quanto || 0) + (v.tarjeta_quanto || 0) + (v.ventas_transferencia || 0) + (v.ventas_link_pago || 0)
      monthMap[m].ventas += total
      monthMap[m].egresos += (v.total_egresos || 0)
      const sc = v.store_code || 'Otro'
      monthMap[m].bySuc[sc] = (monthMap[m].bySuc[sc] || 0) + total
    })

    // Purchases → classify using DB catalog
    data2026.compras.forEach(c => {
      const m = c.fecha_emision?.substring(0, 7)
      if (!m || !monthMap[m]) return
      const { categoria: cat, subcategoria: sub } = classify(c.proveedor_nombre || '')
      const monto = parseFloat(c.monto_total) || 0
      if (monthMap[m].pl[cat] !== undefined) {
        monthMap[m].pl[cat] += monto
      } else {
        monthMap[m].pl.gastos_operativos += monto
      }
      // Track by provider for TabProveedores
      const prov = c.proveedor_nombre || 'Desconocido'
      if (!monthMap[m].byProv[prov]) monthMap[m].byProv[prov] = { monto: 0, cat, sub }
      monthMap[m].byProv[prov].monto += monto
    })

    // Planilla supplement
    data2026.planillas?.forEach(p => {
      const m = p.fecha_pago?.substring(0, 7)
      if (!m || !monthMap[m]) return
      monthMap[m].pl.planilla_legal += (p.total_bruto || 0) + (p.total_patronal || 0)
    })

    return Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => {
      const ebitda = v.ventas - v.pl.costo_comida - v.pl.insumo_venta - v.pl.limpieza - v.pl.costo_fijo - v.pl.gastos_operativos - v.pl.gastos_logisticos - v.pl.gasto_financiero - v.pl.planilla_legal
      const utilidad = ebitda - v.pl.impuestos
      return { key: k, label: formatMonth(k), ...v, ebitda, utilidad }
    })
  }, [data2026, classify])

  if (!ROLES.includes(user?.rol)) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.red }}>⛔ Acceso restringido</div>
  }

  const TABS = [
    { key: 'dashboard', label: '📊 Dashboard', icon: '📊' },
    { key: 'estado-resultados', label: '📋 Estado de Resultados', icon: '📋' },
    { key: 'balance', label: '⚖️ Balance', icon: '⚖️' },
    { key: 'flujo-caja', label: '💰 Flujo de Caja', icon: '💰' },
    { key: 'proveedores', label: '🏢 Proveedores', icon: '🏢' },
  ]

  return (
    <div style={{ padding: '12px 8px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: C.red, fontWeight: 800 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.white, marginTop: 2 }}>Dashboard Financiero</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Ago 2025 — Abr 2026 · Datos en USD</div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', padding: '4px 0' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={sTab(tab === t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.textMuted }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
          Cargando datos financieros...
        </div>
      ) : (
        <>
          {tab === 'dashboard' && <TabDashboard months2026={months2026} />}
          {tab === 'estado-resultados' && <TabEstadoResultados months2026={months2026} />}
          {tab === 'balance' && <TabBalance months2026={months2026} />}
          {tab === 'flujo-caja' && <TabFlujoCaja months2026={months2026} />}
          {tab === 'proveedores' && <TabProveedores data2026={data2026} months2026={months2026} classify={classify} />}
        </>
      )}

      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: C.gray }}>
        2025: Datos históricos (Excel) · 2026: Datos en tiempo real (Supabase) · Última carga: {new Date().toLocaleString('es-SV')}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  TAB 1: DASHBOARD GENERAL (KPIs + Tendencias)
// ══════════════════════════════════════════════════════

function TabDashboard({ months2026 }) {
  // Combine all months
  const allMonths = buildAllMonths(months2026)
  const latest = allMonths[allMonths.length - 1]
  const prev = allMonths.length > 1 ? allMonths[allMonths.length - 2] : null

  // YTD totals
  const ytd2025 = { ventas: sum(HIST_PL.ventas), ebitda: sum(HIST_PL.ventas.map((v, i) => v - HIST_PL.costo_comida[i] - HIST_PL.insumo_venta[i] - HIST_PL.limpieza[i] - HIST_PL.costo_fijo[i] - HIST_PL.gastos_operativos[i] - HIST_PL.gastos_logisticos[i] - HIST_PL.gasto_financiero[i] - HIST_PL.planilla_legal[i])) }
  const ytd2026 = { ventas: months2026.reduce((s, m) => s + m.ventas, 0), ebitda: months2026.reduce((s, m) => s + m.ebitda, 0) }

  return (
    <>
      {/* KPIs Row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Ventas Último Mes</div>
          <div style={sVal}>{fmt(latest?.ventas)}</div>
          <div style={sSub}>{latest?.label}{prev ? ` · ${delta(latest?.ventas, prev?.ventas)}` : ''}</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>EBITDA Último Mes</div>
          <div style={{ ...sVal, color: latest?.ebitda >= 0 ? C.greenLight : '#f87171' }}>{fmt(latest?.ebitda)}</div>
          <div style={sSub}>Margen: {pct(latest?.ventas ? latest.ebitda / latest.ventas : 0)}</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Costo Comida %</div>
          <div style={sVal}>{pct(latest?.ventas ? latest.costo_comida / latest.ventas : 0)}</div>
          <div style={sSub}>Target: 50-55%</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Planilla / Ventas</div>
          <div style={sVal}>{pct(latest?.ventas ? latest.planilla_legal / latest.ventas : 0)}</div>
          <div style={sSub}>Target: &lt;20%</div>
        </div>
      </div>

      {/* YTD Comparison */}
      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 12 }}>Acumulados YTD</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 11, color: C.textMuted }}>2025 (Ago-Dic)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.white }}>Ventas: {fmt(ytd2025.ventas)}</div>
            <div style={{ fontSize: 14, color: C.greenLight }}>EBITDA: {fmt(ytd2025.ebitda)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 11, color: C.textMuted }}>2026 (Ene-Abr)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.white }}>Ventas: {fmt(ytd2026.ventas)}</div>
            <div style={{ fontSize: 14, color: ytd2026.ebitda >= 0 ? C.greenLight : '#f87171' }}>EBITDA: {fmt(ytd2026.ebitda)}</div>
          </div>
        </div>
      </div>

      {/* Trend Table */}
      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 8 }}>Tendencia Mensual</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...sTh, textAlign: 'left' }}>Mes</th>
                <th style={sTh}>Ventas</th>
                <th style={sTh}>Costos</th>
                <th style={sTh}>EBITDA</th>
                <th style={sTh}>Margen</th>
                <th style={sTh}>Utilidad</th>
              </tr>
            </thead>
            <tbody>
              {allMonths.map((m, i) => (
                <tr key={i} style={{ background: i % 2 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                  <td style={{ ...sTdL, color: m.is2026 ? C.blue : C.textMuted, fontWeight: m.is2026 ? 700 : 400 }}>
                    {m.is2026 ? '🔵 ' : ''}{m.label}
                  </td>
                  <td style={sTd()}>{fmt(m.ventas)}</td>
                  <td style={sTd()}>{fmt(m.costo_comida)}</td>
                  <td style={sTd(m.ebitda < 0)}>{m.ebitda < 0 ? '-' : ''}{fmt(m.ebitda)}</td>
                  <td style={sTd(m.ebitda < 0)}>{pct(m.ventas ? m.ebitda / m.ventas : 0)}</td>
                  <td style={sTd(m.utilidad < 0)}>{m.utilidad < 0 ? '-' : ''}{fmt(m.utilidad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sales by sucursal - bar chart simplified */}
      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 8 }}>Ventas por Sucursal (Último Mes Completo)</div>
        {(() => {
          const lastComplete = months2026.length > 1 ? months2026[months2026.length - 2] : months2026[months2026.length - 1]
          if (!lastComplete) return <div style={{ color: C.textMuted, fontSize: 12 }}>Sin datos</div>
          const maxV = Math.max(...Object.values(lastComplete.bySuc || {}))
          return Object.entries(lastComplete.bySuc || {}).sort((a, b) => b[1] - a[1]).map(([sc, v]) => (
            <div key={sc} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: STORE_COLORS[sc] || C.white, fontWeight: 600 }}>{STORE_MAP[sc] || sc}</span>
                <span style={{ color: C.white, fontWeight: 700 }}>{fmt(v)}</span>
              </div>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, marginTop: 3 }}>
                <div style={{ height: 8, borderRadius: 4, background: STORE_COLORS[sc] || C.blue, width: `${(v / maxV * 100)}%`, transition: 'width .5s' }} />
              </div>
            </div>
          ))
        })()}
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════
//  TAB 2: ESTADO DE RESULTADOS (P&L)
// ══════════════════════════════════════════════════════

function TabEstadoResultados({ months2026 }) {
  const allMonths = buildAllMonths(months2026)

  const plLines = [
    { key: 'ventas', label: 'VENTAS TOTALES', bold: true, positive: true },
    { key: 'costo_comida', label: '(-) Costo de Comida', indent: true },
    { key: 'insumo_venta', label: '(-) Insumo de Venta', indent: true },
    { key: 'limpieza', label: '(-) Limpieza', indent: true },
    { key: 'costo_fijo', label: '(-) Costo Fijo (Alquiler+Elec)', indent: true },
    { key: 'gastos_operativos', label: '(-) Gastos Operativos', indent: true },
    { key: 'gastos_logisticos', label: '(-) Gastos Logísticos', indent: true },
    { key: 'gasto_financiero', label: '(-) Gasto Financiero', indent: true },
    { key: 'planilla_legal', label: '(-) Planilla + Legal', indent: true },
    { key: 'ebitda', label: 'EBITDA', bold: true, computed: true },
    { key: 'impuestos', label: '(-) Impuestos', indent: true },
    { key: 'utilidad', label: 'UTILIDAD NETA', bold: true, computed: true },
  ]

  // Totals
  const totals = {}
  plLines.forEach(l => {
    totals[l.key] = allMonths.reduce((s, m) => s + (m[l.key] || 0), 0)
  })

  return (
    <div style={sCard}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.red, letterSpacing: 2 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.white, marginTop: 2 }}>Estado de Resultados Consolidado</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Agosto 2025 — Abril 2026</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.red}` }}>
              <th style={{ ...sTh, textAlign: 'left', color: C.white }}>Concepto</th>
              {allMonths.map((m, i) => (
                <th key={i} style={{ ...sTh, fontSize: 10, color: m.is2026 ? C.blue : C.gold }}>
                  {m.label}
                </th>
              ))}
              <th style={{ ...sTh, color: C.red }}>Total</th>
              <th style={{ ...sTh, color: C.textMuted }}>% Venta</th>
            </tr>
          </thead>
          <tbody>
            {plLines.map((line, li) => {
              const isSeparator = line.key === 'ebitda' || line.key === 'utilidad'
              return (
                <tr key={line.key} style={{
                  background: isSeparator ? 'rgba(230,57,70,0.1)' : li % 2 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  borderTop: isSeparator ? `1px solid ${C.red}` : 'none',
                }}>
                  <td style={{
                    ...sTdL,
                    fontWeight: line.bold ? 800 : 400,
                    paddingLeft: line.indent ? 20 : 6,
                    color: line.bold ? C.white : C.textMuted,
                    fontSize: line.bold ? 12 : 11,
                  }}>
                    {line.label}
                  </td>
                  {allMonths.map((m, i) => {
                    const val = m[line.key] || 0
                    const isNeg = !line.positive && val < 0
                    return (
                      <td key={i} style={{
                        ...sTd(isNeg || (line.computed && val < 0)),
                        fontWeight: line.bold ? 700 : 400,
                        fontSize: 11,
                      }}>
                        {val < 0 && line.computed ? '-' : ''}{fmt(val)}
                      </td>
                    )
                  })}
                  <td style={{ ...sTd(totals[line.key] < 0 && line.computed), fontWeight: 700, borderLeft: `1px solid ${C.border}` }}>
                    {totals[line.key] < 0 && line.computed ? '-' : ''}{fmt(totals[line.key])}
                  </td>
                  <td style={{ ...sTd(), fontSize: 11, color: C.textMuted }}>
                    {totals.ventas ? pct(totals[line.key] / totals.ventas) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Margin analysis */}
      <div style={{ marginTop: 16 }}>
        <div style={{ ...sH, marginBottom: 8 }}>Análisis de Márgenes Mensuales</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...sTh, textAlign: 'left' }}>Mes</th>
                <th style={sTh}>Costo Comida %</th>
                <th style={sTh}>Planilla %</th>
                <th style={sTh}>EBITDA %</th>
                <th style={sTh}>Utilidad %</th>
              </tr>
            </thead>
            <tbody>
              {allMonths.map((m, i) => (
                <tr key={i}>
                  <td style={{ ...sTdL, color: m.is2026 ? C.blue : C.textMuted }}>{m.is2026 ? '🔵 ' : ''}{m.label}</td>
                  <td style={sTd(m.ventas && m.costo_comida / m.ventas > 0.55)}>
                    {pct(m.ventas ? m.costo_comida / m.ventas : 0)}
                  </td>
                  <td style={sTd(m.ventas && m.planilla_legal / m.ventas > 0.22)}>
                    {pct(m.ventas ? m.planilla_legal / m.ventas : 0)}
                  </td>
                  <td style={sTd(m.ebitda < 0)}>
                    {pct(m.ventas ? m.ebitda / m.ventas : 0)}
                  </td>
                  <td style={sTd(m.utilidad < 0)}>
                    {pct(m.ventas ? m.utilidad / m.ventas : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  TAB 3: BALANCE DE COMPROBACIÓN
// ══════════════════════════════════════════════════════

function TabBalance({ months2026 }) {
  const allMonths = buildAllMonths(months2026)
  const totals = {}
  const keys = ['ventas', 'costo_comida', 'insumo_venta', 'limpieza', 'costo_fijo', 'gastos_operativos', 'gastos_logisticos', 'gasto_financiero', 'planilla_legal', 'impuestos']
  keys.forEach(k => { totals[k] = allMonths.reduce((s, m) => s + (m[k] || 0), 0) })
  totals.ebitda = allMonths.reduce((s, m) => s + m.ebitda, 0)
  totals.utilidad = allMonths.reduce((s, m) => s + m.utilidad, 0)

  const totalCostos = totals.costo_comida + totals.insumo_venta + totals.limpieza
  const totalGastosOp = totals.gastos_operativos + totals.gastos_logisticos + totals.costo_fijo + totals.gasto_financiero
  const totalPlanilla = totals.planilla_legal

  // Simplified trial balance
  const cuentas = [
    { grupo: 'ACTIVO', items: [
      { cuenta: '1100 — Caja y Bancos', debito: totals.ventas * 0.38, credito: 0, nota: 'Efectivo en caja + depósitos' },
      { cuenta: '1200 — Cuentas por Cobrar', debito: totals.ventas * 0.12, credito: 0, nota: 'Tarjeta + transferencias pendientes' },
      { cuenta: '1300 — Inventario', debito: totalCostos * 0.15, credito: 0, nota: 'Stock en almacén + sucursales' },
      { cuenta: '1400 — Activo Fijo', debito: allMonths.reduce((s, m) => s + (HIST_PIV['Activo Fijo']?.[HIST_MONTHS.indexOf(m.label)] || 0), 0) || 15000, credito: 0, nota: 'Equipo, mobiliario' },
    ]},
    { grupo: 'PASIVO', items: [
      { cuenta: '2100 — Proveedores por Pagar', debito: 0, credito: totalCostos * 0.22, nota: 'CxP proveedores' },
      { cuenta: '2200 — Préstamos Bancarios', debito: 0, credito: 454000, nota: 'Optima + Caja de Crédito + otros' },
      { cuenta: '2300 — Impuestos por Pagar', debito: 0, credito: totals.impuestos, nota: 'IVA + ISR + retenciones' },
      { cuenta: '2400 — Planilla por Pagar', debito: 0, credito: totalPlanilla * 0.08, nota: 'ISSS + AFP pendiente' },
    ]},
    { grupo: 'PATRIMONIO', items: [
      { cuenta: '3100 — Capital Social', debito: 0, credito: 100000, nota: 'Aporte socios' },
      { cuenta: '3200 — Utilidad Acumulada', debito: 0, credito: totals.utilidad > 0 ? totals.utilidad : 0, nota: 'Resultado del periodo' },
      { cuenta: '3300 — Pérdida Acumulada', debito: totals.utilidad < 0 ? Math.abs(totals.utilidad) : 0, credito: 0, nota: '' },
    ]},
    { grupo: 'INGRESOS', items: [
      { cuenta: '4100 — Ventas Netas', debito: 0, credito: totals.ventas, nota: 'Venta Quanto + extras' },
    ]},
    { grupo: 'COSTOS', items: [
      { cuenta: '5100 — Costo de Ventas (COGS)', debito: totalCostos, credito: 0, nota: 'Comida + insumo + limpieza' },
    ]},
    { grupo: 'GASTOS', items: [
      { cuenta: '6100 — Gastos Operativos', debito: totalGastosOp, credito: 0, nota: 'Delivery + logística + fijo' },
      { cuenta: '6200 — Planilla y Legal', debito: totalPlanilla, credito: 0, nota: 'Sueldos + prestaciones + legal' },
      { cuenta: '6300 — Impuestos', debito: totals.impuestos, credito: 0, nota: 'IVA, ISR, municipales' },
    ]},
  ]

  let totalDebito = 0, totalCredito = 0
  cuentas.forEach(g => g.items.forEach(c => { totalDebito += c.debito; totalCredito += c.credito }))

  return (
    <div style={sCard}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.red, letterSpacing: 2 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.white, marginTop: 2 }}>Balance de Comprobación</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Periodo: Ago 2025 — Abr 2026</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.gold}` }}>
              <th style={{ ...sTh, textAlign: 'left', color: C.white }}>Cuenta</th>
              <th style={{ ...sTh, color: C.greenLight }}>Débito</th>
              <th style={{ ...sTh, color: '#f87171' }}>Crédito</th>
              <th style={{ ...sTh, textAlign: 'left', color: C.textMuted }}>Nota</th>
            </tr>
          </thead>
          <tbody>
            {cuentas.map(grupo => (
              <>
                <tr key={grupo.grupo}>
                  <td colSpan={4} style={{ padding: '10px 6px 4px', fontWeight: 800, color: C.gold, fontSize: 12, letterSpacing: 1, borderTop: `1px solid ${C.border}` }}>
                    {grupo.grupo}
                  </td>
                </tr>
                {grupo.items.map((c, i) => (
                  <tr key={i} style={{ background: i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                    <td style={{ ...sTdL, fontSize: 11, paddingLeft: 16 }}>{c.cuenta}</td>
                    <td style={{ ...sTd(), color: c.debito > 0 ? C.greenLight : C.textMuted }}>{c.debito > 0 ? fmt(c.debito) : '—'}</td>
                    <td style={{ ...sTd(), color: c.credito > 0 ? '#f87171' : C.textMuted }}>{c.credito > 0 ? fmt(c.credito) : '—'}</td>
                    <td style={{ ...sTdL, fontSize: 10, color: C.gray }}>{c.nota}</td>
                  </tr>
                ))}
              </>
            ))}
            <tr style={{ borderTop: `2px solid ${C.gold}`, background: 'rgba(244,162,97,0.1)' }}>
              <td style={{ ...sTdL, fontWeight: 800, color: C.gold }}>TOTALES</td>
              <td style={{ ...sTd(), fontWeight: 800, color: C.greenLight }}>{fmt(totalDebito)}</td>
              <td style={{ ...sTd(), fontWeight: 800, color: '#f87171' }}>{fmt(totalCredito)}</td>
              <td style={{ ...sTdL, fontSize: 10, color: totalDebito === totalCredito ? C.greenLight : C.red }}>
                {Math.abs(totalDebito - totalCredito) < 1 ? '✅ Cuadrado' : `⚠️ Dif: ${fmt(totalDebito - totalCredito)}`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, padding: 10, background: 'rgba(59,130,246,0.1)', borderRadius: 8, fontSize: 11, color: C.textMuted }}>
        ⚠️ Balance estimado a partir de datos operativos. Cuentas de activo calculadas por distribución histórica. Préstamos reflejan saldo acumulado reportado. Para balance auditado, consultar con Angel Ortiz.
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  TAB 4: FLUJO DE CAJA
// ══════════════════════════════════════════════════════

function TabFlujoCaja({ months2026 }) {
  const allMonths = buildAllMonths(months2026)

  // Cash flow from Excel for 2025
  const HIST_CF = [19277.13, -23860.20, -19832.55, -24488.91, -4942.32]

  return (
    <div style={sCard}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.red, letterSpacing: 2 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.white, marginTop: 2 }}>Estado de Flujo de Caja</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Método indirecto · Ago 2025 — Abr 2026</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 650 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.gold}` }}>
              <th style={{ ...sTh, textAlign: 'left', color: C.white }}>Concepto</th>
              {allMonths.map((m, i) => (
                <th key={i} style={{ ...sTh, fontSize: 10, color: m.is2026 ? C.blue : C.gold }}>{m.label}</th>
              ))}
              <th style={{ ...sTh, color: C.red }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {/* Operating activities */}
            <tr><td colSpan={allMonths.length + 2} style={{ padding: '10px 6px 4px', fontWeight: 800, color: C.gold, fontSize: 12 }}>ACTIVIDADES DE OPERACIÓN</td></tr>

            <PLRow label="Utilidad Neta" months={allMonths} getVal={m => m.utilidad} bold />
            <PLRow label="(+) Depreciación estimada" months={allMonths} getVal={() => 1500} />
            <PLRow label="(-) Aumento en CxC" months={allMonths} getVal={m => -(m.ventas * 0.02)} />
            <PLRow label="(+/-) Cambio en inventario" months={allMonths} getVal={m => -(m.costo_comida * 0.03)} />
            <PLRow label="(+) Aumento en CxP" months={allMonths} getVal={m => m.costo_comida * 0.05} />

            {(() => {
              const opCF = allMonths.map(m => m.utilidad + 1500 - (m.ventas * 0.02) - (m.costo_comida * 0.03) + (m.costo_comida * 0.05))
              return <PLRow label="Flujo Operativo" months={allMonths} getVal={(m, i) => opCF[i]} bold highlight />
            })()}

            {/* Investing */}
            <tr><td colSpan={allMonths.length + 2} style={{ padding: '10px 6px 4px', fontWeight: 800, color: C.gold, fontSize: 12 }}>ACTIVIDADES DE INVERSIÓN</td></tr>
            <PLRow label="(-) Compra de activos fijos" months={allMonths} getVal={(m, i) => {
              const histIdx = HIST_MONTHS.indexOf(m.label)
              if (histIdx >= 0 && HIST_PIV['Activo Fijo']) return -(HIST_PIV['Activo Fijo'][histIdx] || 0)
              return -3000 // estimate for 2026
            }} />

            {/* Financing */}
            <tr><td colSpan={allMonths.length + 2} style={{ padding: '10px 6px 4px', fontWeight: 800, color: C.gold, fontSize: 12 }}>ACTIVIDADES DE FINANCIAMIENTO</td></tr>
            <PLRow label="(-) Pago préstamos" months={allMonths} getVal={() => -5000} />
            <PLRow label="(-) Retiros socios" months={allMonths} getVal={(m) => m.is2026 ? -2000 : -3000} />

            {/* Net CF */}
            {(() => {
              const netCF = allMonths.map((m, i) => {
                const histIdx = HIST_MONTHS.indexOf(m.label)
                if (histIdx >= 0) return HIST_CF[histIdx] // Use Excel data for 2025
                const op = m.utilidad + 1500 - (m.ventas * 0.02) - (m.costo_comida * 0.03) + (m.costo_comida * 0.05)
                const inv = -3000
                const fin = -5000 - 2000
                return op + inv + fin
              })
              return (
                <>
                  <tr style={{ borderTop: `2px solid ${C.red}`, background: 'rgba(230,57,70,0.1)' }}>
                    <td style={{ ...sTdL, fontWeight: 800, color: C.white, fontSize: 12 }}>FLUJO NETO DEL PERIODO</td>
                    {netCF.map((v, i) => (
                      <td key={i} style={{ ...sTd(v < 0), fontWeight: 800, fontSize: 12 }}>{v < 0 ? '-' : ''}{fmt(v)}</td>
                    ))}
                    <td style={{ ...sTd(sum(netCF) < 0), fontWeight: 800, fontSize: 12, borderLeft: `1px solid ${C.border}` }}>
                      {sum(netCF) < 0 ? '-' : ''}{fmt(sum(netCF))}
                    </td>
                  </tr>
                  {/* Cumulative */}
                  <tr>
                    <td style={{ ...sTdL, fontWeight: 600, color: C.textMuted }}>Acumulado</td>
                    {netCF.map((_, i) => {
                      const cum = netCF.slice(0, i + 1).reduce((a, b) => a + b, 0)
                      return <td key={i} style={{ ...sTd(cum < 0), fontSize: 11 }}>{cum < 0 ? '-' : ''}{fmt(cum)}</td>
                    })}
                    <td style={{ ...sTd(), borderLeft: `1px solid ${C.border}` }}>—</td>
                  </tr>
                </>
              )
            })()}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, padding: 10, background: 'rgba(59,130,246,0.1)', borderRadius: 8, fontSize: 11, color: C.textMuted }}>
        ⚠️ 2025: Flujo de caja del Excel consolidado original. 2026: Estimado usando método indirecto desde P&L + supuestos de capital de trabajo. Para flujo exacto se requiere integración bancaria (conciliación).
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  TAB 5: DETALLE PROVEEDORES (por categoría, últimos 6 meses)
// ══════════════════════════════════════════════════════

const CAT_LABELS = {
  costo_comida: '🥩 Costo Comida',
  insumo_venta: '📦 Insumo Venta',
  limpieza: '🧹 Limpieza',
  costo_fijo: '🏠 Costo Fijo',
  gastos_operativos: '⚙️ Gastos Operativos',
  gasto_financiero: '🏦 Gasto Financiero',
  planilla_legal: '👥 Planilla / Legal',
  activo_fijo: '🔧 Activo Fijo',
  impuestos: '📋 Impuestos',
}

const CAT_COLORS = {
  costo_comida: '#e63946',
  insumo_venta: '#f4a261',
  limpieza: '#2d6a4f',
  costo_fijo: '#3b82f6',
  gastos_operativos: '#a78bfa',
  gasto_financiero: '#f87171',
  planilla_legal: '#60a5fa',
  activo_fijo: '#6b7280',
  impuestos: '#fbbf24',
}

function TabProveedores({ data2026, months2026, classify }) {
  const [expandedCats, setExpandedCats] = useState({})

  const result = useMemo(() => {
    if (!data2026?.compras) return { categories: {}, monthKeys: [], ventasPorMes: {} }

    // Get last 6 months from available data
    const allKeys = [...new Set(data2026.compras.map(c => c.fecha_emision?.substring(0, 7)).filter(Boolean))].sort()
    const monthKeys = allKeys.slice(-6)

    // Ventas por mes (para calcular %)
    const ventasPorMes = {}
    months2026.forEach(m => { ventasPorMes[m.key] = m.ventas })

    // Build provider → category → month → monto
    const provData = {} // { provName: { cat, months: { '2026-01': monto } } }
    data2026.compras.forEach(c => {
      const m = c.fecha_emision?.substring(0, 7)
      if (!m || !monthKeys.includes(m)) return
      const name = c.proveedor_nombre || 'Sin nombre'
      const monto = parseFloat(c.monto_total) || 0
      if (!provData[name]) {
        const { categoria, subcategoria } = classify(name)
        provData[name] = { cat: categoria, sub: subcategoria, months: {}, total: 0 }
      }
      provData[name].months[m] = (provData[name].months[m] || 0) + monto
      provData[name].total += monto
    })

    // Group by category
    const categories = {}
    Object.entries(provData).forEach(([name, d]) => {
      if (!categories[d.cat]) categories[d.cat] = { providers: [], totals: {}, grandTotal: 0 }
      categories[d.cat].providers.push({ name, ...d })
      monthKeys.forEach(mk => {
        categories[d.cat].totals[mk] = (categories[d.cat].totals[mk] || 0) + (d.months[mk] || 0)
      })
      categories[d.cat].grandTotal += d.total
    })

    // Sort providers within each category by total desc
    Object.values(categories).forEach(cat => {
      cat.providers.sort((a, b) => b.total - a.total)
    })

    return { categories, monthKeys, ventasPorMes }
  }, [data2026, months2026])

  const { categories, monthKeys, ventasPorMes } = result
  const totalVentas6m = monthKeys.reduce((s, k) => s + (ventasPorMes[k] || 0), 0)

  // Sort categories by grandTotal desc
  const sortedCats = Object.entries(categories).sort((a, b) => b[1].grandTotal - a[1].grandTotal)

  // Grand total across all categories
  const grandTotal = sortedCats.reduce((s, [, c]) => s + c.grandTotal, 0)
  const grandByMonth = {}
  monthKeys.forEach(mk => {
    grandByMonth[mk] = sortedCats.reduce((s, [, c]) => s + (c.totals[mk] || 0), 0)
  })

  const toggleCat = (cat) => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))

  const fmtShort = (n) => {
    if (n == null || n === 0) return '—'
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K'
    return '$' + n.toFixed(0)
  }

  return (
    <div>
      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 10 }}>DETALLE DE COSTOS Y GASTOS POR PROVEEDOR</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>
          Últimos {monthKeys.length} meses · Click en categoría para expandir/colapsar proveedores · % sobre ventas del mes
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...sTh, textAlign: 'left', minWidth: 180 }}>Categoría / Proveedor</th>
                {monthKeys.map(mk => (
                  <th key={mk} colSpan={2} style={{ ...sTh, textAlign: 'center', borderLeft: `1px solid ${C.border}` }}>
                    {formatMonth(mk)}
                  </th>
                ))}
                <th colSpan={2} style={{ ...sTh, textAlign: 'center', borderLeft: `2px solid ${C.gold}`, background: 'rgba(244,162,97,0.1)' }}>
                  TOTAL
                </th>
              </tr>
              <tr>
                <th style={{ ...sTh, borderBottom: `2px solid ${C.border}` }}></th>
                {monthKeys.map(mk => (
                  <React.Fragment key={mk}>
                    <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>$</th>
                    <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, color: C.textMuted }}>%</th>
                  </React.Fragment>
                ))}
                <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, borderLeft: `2px solid ${C.gold}` }}>$</th>
                <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, color: C.textMuted }}>%</th>
              </tr>
            </thead>
            <tbody>
              {sortedCats.map(([catKey, catData]) => {
                const isOpen = expandedCats[catKey]
                const catColor = CAT_COLORS[catKey] || C.textMuted
                return (
                  <React.Fragment key={catKey}>
                    {/* Category header row */}
                    <tr
                      onClick={() => toggleCat(catKey)}
                      style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }}
                    >
                      <td style={{ padding: '8px 6px', fontWeight: 700, color: C.white, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ display: 'inline-block', width: 8, marginRight: 6, fontSize: 9, color: C.textMuted }}>{isOpen ? '▼' : '▶'}</span>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: catColor, marginRight: 6 }}></span>
                        {CAT_LABELS[catKey] || catKey}
                        <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 6 }}>({catData.providers.length})</span>
                      </td>
                      {monthKeys.map(mk => {
                        const v = catData.totals[mk] || 0
                        const pctV = ventasPorMes[mk] ? (v / ventasPorMes[mk]) * 100 : 0
                        return (
                          <React.Fragment key={mk}>
                            <td style={{ ...sTd(false), fontWeight: 700, fontSize: 12, borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                              {v > 0 ? fmtShort(v) : '—'}
                            </td>
                            <td style={{ padding: '6px 4px', textAlign: 'right', fontSize: 10, color: pctV > 15 ? '#f87171' : C.textMuted, borderBottom: `1px solid ${C.border}`, fontFamily: 'monospace' }}>
                              {v > 0 ? pctV.toFixed(1) + '%' : ''}
                            </td>
                          </React.Fragment>
                        )
                      })}
                      <td style={{ ...sTd(false), fontWeight: 700, fontSize: 12, borderBottom: `1px solid ${C.border}`, borderLeft: `2px solid ${C.gold}`, background: 'rgba(244,162,97,0.05)' }}>
                        {fmt(catData.grandTotal)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: C.gold, borderBottom: `1px solid ${C.border}`, background: 'rgba(244,162,97,0.05)', fontFamily: 'monospace' }}>
                        {totalVentas6m ? ((catData.grandTotal / totalVentas6m) * 100).toFixed(1) + '%' : ''}
                      </td>
                    </tr>
                    {/* Provider detail rows */}
                    {isOpen && catData.providers.map((prov, pi) => (
                      <tr key={pi} style={{ background: pi % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                        <td style={{ padding: '5px 6px 5px 28px', fontSize: 10, color: C.textMuted, borderBottom: `1px solid rgba(51,65,85,0.4)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}
                          title={prov.name}>
                          {prov.name.length > 30 ? prov.name.substring(0, 28) + '…' : prov.name}
                        </td>
                        {monthKeys.map(mk => {
                          const v = prov.months[mk] || 0
                          const pctV = ventasPorMes[mk] ? (v / ventasPorMes[mk]) * 100 : 0
                          return (
                            <React.Fragment key={mk}>
                              <td style={{ padding: '4px 4px', textAlign: 'right', fontSize: 10, color: C.white, fontFamily: 'monospace', borderBottom: `1px solid rgba(51,65,85,0.4)`, borderLeft: `1px solid rgba(51,65,85,0.4)` }}>
                                {v > 0 ? fmtShort(v) : '—'}
                              </td>
                              <td style={{ padding: '4px 3px', textAlign: 'right', fontSize: 9, color: C.textMuted, fontFamily: 'monospace', borderBottom: `1px solid rgba(51,65,85,0.4)` }}>
                                {v > 0 ? pctV.toFixed(1) + '%' : ''}
                              </td>
                            </React.Fragment>
                          )
                        })}
                        <td style={{ padding: '4px 4px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: C.white, fontFamily: 'monospace', borderBottom: `1px solid rgba(51,65,85,0.4)`, borderLeft: `2px solid ${C.gold}`, background: 'rgba(244,162,97,0.03)' }}>
                          {fmt(prov.total)}
                        </td>
                        <td style={{ padding: '4px 3px', textAlign: 'right', fontSize: 9, color: C.textMuted, fontFamily: 'monospace', borderBottom: `1px solid rgba(51,65,85,0.4)`, background: 'rgba(244,162,97,0.03)' }}>
                          {totalVentas6m ? ((prov.total / totalVentas6m) * 100).toFixed(1) + '%' : ''}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
              {/* Grand total row */}
              <tr style={{ background: 'rgba(230,57,70,0.1)' }}>
                <td style={{ padding: '10px 6px', fontWeight: 800, color: C.white, fontSize: 12, borderTop: `2px solid ${C.red}` }}>
                  TOTAL COSTOS + GASTOS
                </td>
                {monthKeys.map(mk => {
                  const v = grandByMonth[mk] || 0
                  const pctV = ventasPorMes[mk] ? (v / ventasPorMes[mk]) * 100 : 0
                  return (
                    <React.Fragment key={mk}>
                      <td style={{ ...sTd(false), fontWeight: 800, fontSize: 12, borderTop: `2px solid ${C.red}`, borderLeft: `1px solid ${C.border}` }}>
                        {fmt(v)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: pctV > 80 ? '#f87171' : C.gold, borderTop: `2px solid ${C.red}`, fontFamily: 'monospace' }}>
                        {pctV.toFixed(1)}%
                      </td>
                    </React.Fragment>
                  )
                })}
                <td style={{ ...sTd(false), fontWeight: 800, fontSize: 13, borderTop: `2px solid ${C.red}`, borderLeft: `2px solid ${C.gold}`, background: 'rgba(244,162,97,0.1)' }}>
                  {fmt(grandTotal)}
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'right', fontSize: 11, fontWeight: 800, color: C.gold, borderTop: `2px solid ${C.red}`, background: 'rgba(244,162,97,0.1)', fontFamily: 'monospace' }}>
                  {totalVentas6m ? ((grandTotal / totalVentas6m) * 100).toFixed(1) + '%' : ''}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div style={{ ...sCard, padding: 12 }}>
        <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>CATEGORÍAS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {sortedCats.map(([catKey, catData]) => (
            <div key={catKey} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.textMuted }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: CAT_COLORS[catKey] || C.gray }}></span>
              {CAT_LABELS[catKey] || catKey}: {fmt(catData.grandTotal)} ({totalVentas6m ? ((catData.grandTotal / totalVentas6m) * 100).toFixed(1) : 0}%)
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════

function PLRow({ label, months, getVal, bold, highlight }) {
  const vals = months.map((m, i) => getVal(m, i))
  const total = sum(vals)
  return (
    <tr style={{ background: highlight ? 'rgba(230,57,70,0.08)' : 'transparent' }}>
      <td style={{ ...sTdL, fontWeight: bold ? 700 : 400, paddingLeft: bold ? 6 : 16, color: bold ? C.white : C.textMuted, fontSize: 11 }}>{label}</td>
      {vals.map((v, i) => (
        <td key={i} style={{ ...sTd(v < 0), fontWeight: bold ? 700 : 400, fontSize: 11 }}>{v < 0 ? '-' : ''}{fmt(v)}</td>
      ))}
      <td style={{ ...sTd(total < 0), fontWeight: bold ? 700 : 400, fontSize: 11, borderLeft: `1px solid ${C.border}` }}>
        {total < 0 ? '-' : ''}{fmt(total)}
      </td>
    </tr>
  )
}

function buildAllMonths(months2026) {
  const hist = HIST_MONTHS.map((label, i) => ({
    label, is2026: false,
    ventas: HIST_PL.ventas[i],
    costo_comida: HIST_PL.costo_comida[i],
    insumo_venta: HIST_PL.insumo_venta[i],
    limpieza: HIST_PL.limpieza[i],
    costo_fijo: HIST_PL.costo_fijo[i],
    gastos_operativos: HIST_PL.gastos_operativos[i],
    gastos_logisticos: HIST_PL.gastos_logisticos[i],
    gasto_financiero: HIST_PL.gasto_financiero[i],
    planilla_legal: HIST_PL.planilla_legal[i],
    impuestos: HIST_PL.impuestos[i],
    ebitda: HIST_PL.ventas[i] - HIST_PL.costo_comida[i] - HIST_PL.insumo_venta[i] - HIST_PL.limpieza[i] - HIST_PL.costo_fijo[i] - HIST_PL.gastos_operativos[i] - HIST_PL.gastos_logisticos[i] - HIST_PL.gasto_financiero[i] - HIST_PL.planilla_legal[i],
    utilidad: HIST_PL.ventas[i] - HIST_PL.costo_comida[i] - HIST_PL.insumo_venta[i] - HIST_PL.limpieza[i] - HIST_PL.costo_fijo[i] - HIST_PL.gastos_operativos[i] - HIST_PL.gastos_logisticos[i] - HIST_PL.gasto_financiero[i] - HIST_PL.planilla_legal[i] - HIST_PL.impuestos[i],
    bySuc: Object.fromEntries(Object.entries(HIST_SUCURSAL).map(([k, v]) => [k, v[i]])),
  }))

  const live = months2026.map(m => ({
    ...m, is2026: true,
    costo_comida: m.pl.costo_comida,
    insumo_venta: m.pl.insumo_venta,
    limpieza: m.pl.limpieza,
    costo_fijo: m.pl.costo_fijo,
    gastos_operativos: m.pl.gastos_operativos,
    gastos_logisticos: m.pl.gastos_logisticos,
    gasto_financiero: m.pl.gasto_financiero,
    planilla_legal: m.pl.planilla_legal,
    impuestos: m.pl.impuestos,
  }))

  return [...hist, ...live]
}

function formatMonth(key) {
  const [y, m] = key.split('-')
  const names = { '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic' }
  return `${names[m] || m} ${y}`
}

function sum(arr) { return arr.reduce((a, b) => a + (b || 0), 0) }

function delta(curr, prev) {
  if (!prev || prev === 0) return ''
  const d = ((curr - prev) / prev) * 100
  return `${d >= 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(1)}%`
}
