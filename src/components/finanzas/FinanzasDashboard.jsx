import { useState, useEffect, useMemo } from 'react'
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
  gastos_operativos:[22731.31, 26440.79, 23136.88, 15765.47, 20764.86],
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

// ── Provider → P&L category mapping for 2026 ──
// Categorías: costo_comida, insumo_venta, limpieza, costo_fijo, gastos_operativos,
//             gasto_financiero, planilla_legal, impuestos, activo_fijo
const PROV_CAT = {
  // COSTO COMIDA — ingredientes, cárnicos, lácteos, bebidas, condimentos, aceite freidoras
  'Corte Argentino': 'costo_comida', 'BELCA': 'costo_comida', 'FLAMO': 'costo_comida',
  'INDUSTRIAS CARNICAS': 'costo_comida', 'Excel Protein': 'costo_comida', 'Lácteos del Corral': 'costo_comida',
  'Lacteos del Corral': 'costo_comida', 'Productos Cárnicos': 'costo_comida', 'MULTICONGELADOS': 'costo_comida',
  'AGROINDUSTRIAS LACTEAS': 'costo_comida', 'AGROINDUSTRIAS SAN JULIAN': 'costo_comida',
  'URBINA DE UMAÑA': 'costo_comida', 'CALLEJA': 'costo_comida', 'Pricesmart': 'costo_comida',
  'GOOD PRICE': 'costo_comida', 'DISTRIBUIDORA EUROPEA': 'costo_comida', 'DISTRIBUIDORA SALVADOREÑA': 'costo_comida',
  'DISTRIBUIDORA SANTA ELENA': 'costo_comida', 'PATRONIC': 'costo_comida', 'TECNISPICE': 'costo_comida',
  'OPERADORA DEL SUR': 'costo_comida', 'Embotelladora La Cascada': 'costo_comida',
  'CRISTIAN JAVIER': 'costo_comida', 'MONICA ALEXANDRA': 'costo_comida',
  'BOLCA': 'costo_comida', // aceite freidoras
  // INSUMO VENTA — empaques, moldes, impresión
  'MOLDEADOS SALVADOREÑOS': 'insumo_venta', 'EMPAQUES ECOLOGICOS': 'insumo_venta',
  'INDUSTRIAS GRAFICAS': 'insumo_venta', 'ROBERTONI': 'insumo_venta',
  // LIMPIEZA — productos limpieza, ferretería, limpieza planchas
  'ALMACENES VIDRI': 'limpieza', 'DIVE': 'limpieza', 'FREUND': 'limpieza',
  'ALKEMY': 'limpieza', // limpieza planchas
  // COSTO FIJO — alquileres, electricidad, agua, mantenimiento food court
  'FONDO DE TITULARIZACION': 'costo_fijo', 'EMPRESA SALV. DE SERVICIOS': 'costo_fijo',
  'COMERCIALIZADORA DE ENERGIA': 'costo_fijo', 'Distribuidora de Electricidad': 'costo_fijo',
  'JOSE MANUEL ROMERO': 'costo_fijo', // alquiler sucursal Lourdes
  'DEICE': 'costo_fijo', // alquiler PM Usulután + PM Soyapango
  'ADINCE': 'costo_fijo', // mantenimiento food courts PM
  // GASTOS OPERATIVOS — delivery, gas, seguros, transporte, extintores
  'Delivery Hero': 'gastos_operativos',
  'TROPIGAS': 'gastos_operativos', 'UNIGAS': 'gastos_operativos',
  'SOINTEC': 'gastos_operativos',
  'AUTOFACIL': 'gastos_operativos', // seguro camión transporte
  'ARSEGUI': 'gastos_operativos', // extintores cocina
  'RINA XIOMARA': 'gastos_operativos', // transporte empleados
  // GASTO FINANCIERO — bancos, préstamos
  'Servicios Financieros': 'gasto_financiero', 'SOCIEDAD DE AHORRO': 'gasto_financiero',
  'TS CAPITAL': 'gasto_financiero', 'BANCO DE AMERICA': 'gasto_financiero',
  // ACTIVO FIJO — equipos, construcción, toldos (no entra al P&L como gasto)
  'GALVANIZADORA INDUSTRIAL': 'activo_fijo', // techos casa matriz
  'PROMAICA': 'activo_fijo', // equipos cocina
  'LONAS DECORATIVAS': 'activo_fijo', // toldos canopys eventos
}

function classifyProvider(name) {
  for (const [key, cat] of Object.entries(PROV_CAT)) {
    if (name.toUpperCase().includes(key.toUpperCase())) return cat
  }
  return 'gastos_operativos'
}

// ══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════

export default function FinanzasDashboard({ user }) {
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [data2026, setData2026] = useState(null)

  // ── Access check ──
  useEffect(() => {
    if (!ROLES.includes(user?.rol)) return
    loadData2026()
  }, [])

  async function loadData2026() {
    setLoading(true)
    try {
      // 1. Monthly sales
      const { data: ventas } = await db.from('ventas_diarias')
        .select('fecha, store_code, efectivo_quanto, tarjeta_quanto, ventas_transferencia, ventas_link_pago, total_egresos, total_ingresos')
        .gte('fecha', '2026-01-01')
        .order('fecha')

      // 2. Monthly purchases (compras_dte for amounts)
      const { data: compras } = await db.from('compras_dte')
        .select('fecha_emision, proveedor_nombre, monto_total')
        .gte('fecha_emision', '2026-01-01')
        .order('fecha_emision')

      // 3. Planilla
      const { data: planillas } = await db.from('planillas')
        .select('periodo, fecha_pago, total_bruto, total_neto, total_patronal, estado')
        .gte('fecha_pago', '2026-01-01')

      setData2026({ ventas: ventas || [], compras: compras || [], planillas: planillas || [] })
    } catch (e) {
      console.error('FinanzasDashboard load error:', e)
    }
    setLoading(false)
  }

  // ── Process 2026 data into monthly P&L ──
  const months2026 = useMemo(() => {
    if (!data2026) return []
    const monthMap = {}

    // Sales
    data2026.ventas.forEach(v => {
      const m = v.fecha?.substring(0, 7) // "2026-01"
      if (!m) return
      if (!monthMap[m]) monthMap[m] = { ventas: 0, bySuc: {}, pl: { costo_comida: 0, insumo_venta: 0, limpieza: 0, costo_fijo: 0, gastos_operativos: 0, gasto_financiero: 0, planilla_legal: 0, impuestos: 0, activo_fijo: 0 }, egresos: 0 }
      const total = (v.efectivo_quanto || 0) + (v.tarjeta_quanto || 0) + (v.ventas_transferencia || 0) + (v.ventas_link_pago || 0)
      monthMap[m].ventas += total
      monthMap[m].egresos += (v.total_egresos || 0)
      const sc = v.store_code || 'Otro'
      monthMap[m].bySuc[sc] = (monthMap[m].bySuc[sc] || 0) + total
    })

    // Purchases → classify
    data2026.compras.forEach(c => {
      const m = c.fecha_emision?.substring(0, 7)
      if (!m || !monthMap[m]) return
      const cat = classifyProvider(c.proveedor_nombre || '')
      const monto = parseFloat(c.monto_total) || 0
      if (monthMap[m].pl[cat] !== undefined) {
        monthMap[m].pl[cat] += monto
      } else {
        monthMap[m].pl.gastos_operativos += monto
      }
    })

    // Planilla supplement
    data2026.planillas?.forEach(p => {
      const m = p.fecha_pago?.substring(0, 7)
      if (!m || !monthMap[m]) return
      monthMap[m].pl.planilla_legal += (p.total_bruto || 0) + (p.total_patronal || 0)
    })

    return Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => {
      const ebitda = v.ventas - v.pl.costo_comida - v.pl.insumo_venta - v.pl.limpieza - v.pl.costo_fijo - v.pl.gastos_operativos - v.pl.gasto_financiero - v.pl.planilla_legal
      const utilidad = ebitda - v.pl.impuestos
      return { key: k, label: formatMonth(k), ...v, ebitda, utilidad }
    })
  }, [data2026])

  if (!ROLES.includes(user?.rol)) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.red }}>⛔ Acceso restringido</div>
  }

  const TABS = [
    { key: 'dashboard', label: '📊 Dashboard', icon: '📊' },
    { key: 'estado-resultados', label: '📋 Estado de Resultados', icon: '📋' },
    { key: 'balance', label: '⚖️ Balance', icon: '⚖️' },
    { key: 'flujo-caja', label: '💰 Flujo de Caja', icon: '💰' },
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
  const ytd2025 = { ventas: sum(HIST_PL.ventas), ebitda: sum(HIST_PL.ventas.map((v, i) => v - HIST_PL.costo_comida[i] - HIST_PL.insumo_venta[i] - HIST_PL.limpieza[i] - HIST_PL.costo_fijo[i] - HIST_PL.gastos_operativos[i] - HIST_PL.gasto_financiero[i] - HIST_PL.planilla_legal[i])) }
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
  const keys = ['ventas', 'costo_comida', 'insumo_venta', 'limpieza', 'costo_fijo', 'gastos_operativos', 'gasto_financiero', 'planilla_legal', 'impuestos']
  keys.forEach(k => { totals[k] = allMonths.reduce((s, m) => s + (m[k] || 0), 0) })
  totals.ebitda = allMonths.reduce((s, m) => s + m.ebitda, 0)
  totals.utilidad = allMonths.reduce((s, m) => s + m.utilidad, 0)

  const totalCostos = totals.costo_comida + totals.insumo_venta + totals.limpieza
  const totalGastosOp = totals.gastos_operativos + totals.costo_fijo + totals.gasto_financiero
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
    gasto_financiero: HIST_PL.gasto_financiero[i],
    planilla_legal: HIST_PL.planilla_legal[i],
    impuestos: HIST_PL.impuestos[i],
    ebitda: HIST_PL.ventas[i] - HIST_PL.costo_comida[i] - HIST_PL.insumo_venta[i] - HIST_PL.limpieza[i] - HIST_PL.costo_fijo[i] - HIST_PL.gastos_operativos[i] - HIST_PL.gasto_financiero[i] - HIST_PL.planilla_legal[i],
    utilidad: HIST_PL.ventas[i] - HIST_PL.costo_comida[i] - HIST_PL.insumo_venta[i] - HIST_PL.limpieza[i] - HIST_PL.costo_fijo[i] - HIST_PL.gastos_operativos[i] - HIST_PL.gasto_financiero[i] - HIST_PL.planilla_legal[i] - HIST_PL.impuestos[i],
    bySuc: Object.fromEntries(Object.entries(HIST_SUCURSAL).map(([k, v]) => [k, v[i]])),
  }))

  const live = months2026.map(m => ({
    ...m, is2026: true,
    costo_comida: m.pl.costo_comida,
    insumo_venta: m.pl.insumo_venta,
    limpieza: m.pl.limpieza,
    costo_fijo: m.pl.costo_fijo,
    gastos_operativos: m.pl.gastos_operativos,
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
