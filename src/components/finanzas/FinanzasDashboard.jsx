import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'
import InfoTip from '../ui/InfoTip'

// Componentes aislados lazy + defensivos (si fallan, ErrorBoundary los aísla)
const CardDataDisponible = lazy(() => import('./CardDataDisponible'))
const CardVentasComparativo = lazy(() => import('./CardVentasComparativo'))
const ExcluidosPlTab = lazy(() => import('./ExcluidosPlTab'))
const CashFlowNeto = lazy(() => import('./CashFlowNeto'))

// ErrorBoundary defensivo — si el componente lazy crashea, no rompe el dashboard
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error, info) { console.warn('ErrorBoundary caught:', error && error.message) }
  render() { return this.state.hasError ? null : this.props.children }
}

/* ═══════════════════════════════════════════
   FREAKIE DOGS — DASHBOARD FINANCIERO
   Solo visible para ejecutivo + superadmin
   ═══════════════════════════════════════════ */

const ROLES = ['ejecutivo', 'admin', 'superadmin']
const EDIT_PINS = ['1000', '2000', '231155']

// Mapa categorías_gasto.nombre → P&L key (la vista devuelve nombres legibles de categorias_gasto)
const CATNAME_TO_PL = {
  // Nombres CANÓNICOS de categorias_gasto.nombre (match directo, prioritario)
  'Costo Comida': 'costo_comida', 'Insumo Venta': 'insumo_venta', 'Limpieza': 'limpieza',
  'Costo Fijo': 'costo_fijo', 'Gastos Operativos': 'gastos_operativos',
  'Gastos Logísticos': 'gastos_logisticos', 'Gasto Financiero': 'gasto_financiero',
  'Activo Fijo': 'activo_fijo',
  // Aliases legacy/históricos
  'Insumo Cocina': 'costo_comida', 'Insumo Bebida': 'costo_comida', 'Insumo Producción': 'costo_comida',
  'Insumo Merchandising': 'insumo_venta', 'Insumo Despacho': 'insumo_venta', 'Insumo Empaque': 'insumo_venta',
  'Insumo Limpieza': 'limpieza', 'Insumo Colaboradores': 'costo_comida',
  'Alquiler': 'costo_fijo', 'Electricidad': 'costo_fijo', 'Agua': 'costo_fijo',
  'Gasto Mantenimiento': 'costo_fijo', 'Gasto Alcaldía': 'costo_fijo', 'Gasto Transporte': 'gastos_logisticos',
  'Gasto de Venta (POS/PEYA)': 'gastos_operativos', 'Gasto Mercadeo': 'gastos_operativos',
  'Gasto Logístico': 'gastos_logisticos', 'Gasto Logístico (Admin)': 'gastos_logisticos',
  'Gasto Contabilidad': 'gasto_financiero',
  'Gasto Planilla': 'planilla_legal', 'Gastos Legales': 'planilla_legal',
  'Gasto Impuesto': 'impuestos',
  'Gastos Varios': 'gastos_operativos', 'Gasto Colaboradores': 'gastos_operativos',
  'Gasto Oficina': 'gastos_operativos', 'Gasto Personal (Socios)': 'gastos_operativos',
  'Fuera de Freakie': 'gastos_operativos',
}
// Fallback por categoria_grupo → P&L key (último recurso si CATNAME_TO_PL no tiene match)
// IMPORTANTE: 'Gasto Admin' agrupa gastos_operativos+gastos_logisticos en BD,
// caída por defecto a gastos_operativos. 'No Operativo' es donde vive 'Gasto Financiero'.
const GRUPO_TO_PL = {
  'COGS': 'costo_comida', 'Gasto Local': 'costo_fijo', 'Gasto Venta': 'gastos_operativos',
  'Gasto Admin': 'gastos_operativos', 'Inversión': 'activo_fijo', 'No Operativo': 'gasto_financiero',
}

// ── Brand colors — ahora centralizados en src/theme.js (paletaC) ──

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

const STORE_MAP = { M001: 'Santa Tecla', S001: 'PM Soyapango', S002: 'PM Usulután', S003: 'Gran Plaza Lourdes', S004: 'Venecia Soyapango', S006: 'Metro Centro' }
const STORE_COLORS = { M001: '#e63946', S001: '#3b82f6', S002: '#f4a261', S003: '#4ade80', S004: '#a78bfa', S006: '#f59e0b' }

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
  'MONICA ALEXANDRA': 'gastos_logisticos', 'BOLCA': 'costo_comida',
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
  const [conIva, setConIva] = useState(false)  // false = sin IVA (default)
  const [peyaLoading, setPeyaLoading] = useState(false)

  // ── Access check ──
  useEffect(() => {
    if (!ROLES.includes(user?.rol)) return
    loadData2026()
  }, [])

  // ── Recargar P&L cuando el botón "Refrescar P&L" termina (fn_refresh_pl) ──
  // 4-Jun-2026: antes solo CardVentasComparativo escuchaba este evento, por lo que
  // el Estado de Resultados quedaba con el snapshot del mount aunque las MVs ya
  // estuvieran refrescadas en BD.
  useEffect(() => {
    if (!ROLES.includes(user?.rol)) return
    const h = () => {
      setData2026(prev => prev ? { ...prev, peyaOrders: null } : prev)  // invalida lazy cache PeYa
      loadData2026()
    }
    window.addEventListener('freakie:refresh-pl', h)
    return () => window.removeEventListener('freakie:refresh-pl', h)
  }, [])

  // ── Lazy load peyaOrders — solo cuando user abre TabPeya ──
  // pedidos_peya tiene ~22K filas. Cargarlo al inicio agregaba ~5s al dashboard.
  // Lazy: solo se trae cuando hace click en tab "peya".
  useEffect(() => {
    if (tab !== 'peya') return
    if (data2026?.peyaOrders) return        // ya cargado
    if (peyaLoading) return                  // ya en curso
    setPeyaLoading(true)
    ;(async () => {
      try {
        const peyaOrders = await fetchAll('pedidos_peya',
          'store_code, estado, fecha_pedido, total_pedido, comision, ingreso_estimado, tarifa_publicidad, avoidable_cancellation_fee, descuento_tienda, mes_csv',
          q => q.gte('fecha_pedido', '2026-01-01').order('fecha_pedido'))
        setData2026(prev => prev ? { ...prev, peyaOrders } : prev)
      } catch (e) {
        console.error('peyaOrders lazy load error:', e)
      } finally {
        setPeyaLoading(false)
      }
    })()
  }, [tab, data2026, peyaLoading])

  // Helper: paginated fetch — Supabase default limit is 1000 rows
  // Mantenido para tablas pequeñas (<1000 filas) que no se materializan
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

  // Helper: fetch simple sin paginacion (para matviews y tablas pequeñas conocidas)
  async function fetchSimple(table, select, filter) {
    let q = db.from(table).select(select)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) { console.error(`fetchSimple ${table}:`, error); return [] }
    return data || []
  }

  async function loadData2026() {
    setLoading(true)
    try {
      // OLA 4 — 2026-05-08: Reduccion de 134 → 3 requests principales
      // Los 3 fetches pesados (ventas diarias row-by-row, gastos consolidados,
      // bank_transacciones) se reemplazan por 3 matviews pre-agregadas.
      // Fetches pequeños (<1000 filas, sin paginacion real) quedan igual.

      // OLA 4.5 — 2026-05-09: Paralelizar las 19 queries con Promise.all
      // Antes: secuenciales (suma de tiempos = ~5-7s acumulado).
      // Después: paralelas, total = max(tiempo individual) ≈ 700ms.
      const [
        ventasMV,
        gastosMV,
        bancoMV,
        bankSaldosResp,
        catResp,
        dhDtes,
        peya_liq,
        planillas,
        planillaPorSuc,
        movsSocios,
        prestamoMovs,
        eventosCerrados,
        serfinsaValid,
        depositos,
        planillaGerencial,
        obligaciones,
        planillaOp,
        planillaDesglose,
      ] = await Promise.all([
        fetchSimple('mv_finanzas_ventas_mensual',
          'mes, store_code, fuente, total_ventas, total_sin_iva, venta_neta, propina_cobrada, iva_recaudado, efectivo, tarjeta, otros, num_dias, num_pedidos',
          q => q.gte('mes', '2026-01-01').order('mes')),
        fetchSimple('mv_finanzas_gastos_mensual',
          'mes, store_code, categoria_gasto_id, categoria_nombre, categoria_grupo, subcategoria_contable, origen, proveedor_nombre, total_monto, total_sin_iva, num_movimientos',
          q => q.gte('mes', '2026-01-01').order('mes')),
        fetchSimple('mv_finanzas_banco_mensual',
          'mes, cuenta_id, estado, codigo_bac, total_credito, total_debito, num_tx, balance_max, total_peya_credito, total_serfinsa_credito, total_efectivo_deposito, total_pos_bac, total_transfers_credito',
          q => q.gte('mes', '2026-01-01').order('mes')),
        db.from('v_bank_saldos_consolidados').select('cuenta_id,banco,alias,numero_cuenta,saldo_actual,total_tx,tx_ultimos_30d'),
        db.from('catalogo_contable').select('nombre_dte, nombre_normalizado, categoria, subcategoria, sucursal_default').eq('activo', true),
        fetchAll('compras_dte',
          'id, fecha_emision, monto_total, subtotal, iva, numero_control',
          q => q.ilike('proveedor_nombre', '%delivery hero%').gte('fecha_emision', '2026-01-01').order('fecha_emision')),
        fetchAll('peya_liquidaciones', 'id, semana_inicio, semana_fin, fecha_deposito, monto_depositado, notas', null),
        fetchAll('planillas',
          'periodo, fecha_pago, total_bruto, total_neto, total_patronal, estado',
          q => q.gte('fecha_pago', '2026-01-01')),
        fetchAll('v_planilla_por_sucursal',
          'fecha, store_code, monto, n_empleados',
          q => q.gte('fecha', '2026-01-01')),
        fetchAll('movimientos_socios',
          'fecha, tipo, monto, direccion, socio_nombre, clasificacion_pl',
          q => q.gte('fecha', '2026-01-01').order('fecha')),
        fetchAll('prestamo_movimientos',
          'fecha, tipo, monto',
          q => q.gte('fecha', '2026-01-01').order('fecha')),
        fetchAll('eventos',
          'fecha_evento, estado, total_ventas, cerrado_at, nombre, cliente',
          q => q.not('cerrado_at', 'is', null).gte('fecha_evento', '2026-01-01').order('fecha_evento')),
        fetchAll('serfinsa_validacion_diaria',
          'fecha, total_serfinsa, total_tarjeta_reportado, diferencia, num_terminales, estado',
          q => q.gte('fecha', '2026-01-01').order('fecha')),
        fetchAll('depositos_bancarios',
          'fecha_deposito, store_code, monto, monto_esperado, diferencia_deposito, estado',
          q => q.gte('fecha_deposito', '2026-01-01').order('fecha_deposito')),
        fetchAll('v_planilla_gerencial_pl',
          'mes, provisionado, pagado_real, pendiente_pago',
          q => q.gte('mes', '2026-01-01').order('mes')),
        fetchAll('v_obligaciones_provisionadas',
          'mes, codigo, nombre, grupo, categoria_gasto_id, monto_pl, estado',
          q => q.gte('mes', '2026-01-01').order('mes')),
        fetchAll('v_planilla_operativa_pl',
          'mes, pagado_real, provisionado, monto_pl, estado',
          q => q.gte('mes', '2026-01-01').order('mes')),
        fetchAll('v_planilla_desglose_pl',
          'mes, grupo, empleado_id, nombre_completo, cargo, propina, devengado',
          q => q.gte('mes', '2026-01-01')),
      ])
      const bankSaldos = bankSaldosResp?.data
      const catData = catResp?.data
      if (catResp?.error) console.warn('catalogo_contable:', catResp.error.message)

      // Separar ventas Quanto y PeYa desde la matview
      const ventasQuantoMV = ventasMV.filter(v => v.fuente === 'quanto')
      const ventaspeyaMV   = ventasMV.filter(v => v.fuente === 'peya')
      const ventasPosMV    = ventasMV.filter(v => v.fuente === 'pos')

      // Adaptar ventaspeya al shape que espera TabPeya y TabLiquidez:
      // { fecha, store_code, total } — granularidad mensual (suficiente para graficas)
      const ventaspeya = ventaspeyaMV.map(v => ({
        fecha: v.mes,
        store_code: v.store_code === '_TODAS' ? null : v.store_code,
        total: parseFloat(v.total_ventas) || 0,
        total_ventas: parseFloat(v.total_ventas) || 0,
        total_sin_iva: parseFloat(v.total_sin_iva) || 0,
      }))
      // POS propio (S006) — fuente propia, paralela a Quanto/PeYa
      const ventaspos = ventasPosMV.map(v => ({
        fecha: v.mes,
        store_code: v.store_code === '_TODAS' ? null : v.store_code,
        total_ventas: parseFloat(v.total_ventas) || 0,
        total_sin_iva: parseFloat(v.total_sin_iva) || 0,
      }))

      // Adaptar ventas Quanto al shape que espera months2026 useMemo
      const ventas = ventasQuantoMV.map(v => ({
        fecha: v.mes,
        store_code: v.store_code === '_TODAS' ? null : v.store_code,
        total_ventas: parseFloat(v.total_ventas) || 0,
        total_sin_iva: parseFloat(v.total_sin_iva) || 0,
        venta_neta: parseFloat(v.venta_neta) || 0,
        propina_cobrada: parseFloat(v.propina_cobrada) || 0,
        iva_recaudado: parseFloat(v.iva_recaudado) || 0,
        efectivo: parseFloat(v.efectivo) || 0,
        tarjeta: parseFloat(v.tarjeta) || 0,
        otros: parseFloat(v.otros) || 0,
        total_egresos: 0,
        total_ingresos: 0,
      }))

      // Adaptar gastosMV al shape que espera months2026 useMemo y TabProveedores
      const gastos = gastosMV.map(g => ({
        fecha: g.mes,
        proveedor_nombre: g.proveedor_nombre,
        monto: parseFloat(g.total_monto) || 0,
        monto_sin_iva: parseFloat(g.total_sin_iva) || 0,
        categoria_gasto_id: g.categoria_gasto_id,
        categoria_nombre: g.categoria_nombre,
        categoria_grupo: g.categoria_grupo,
        subcategoria_contable: g.subcategoria_contable,
        origen: g.origen,
        store_code: g.store_code === '_TODAS' ? null : g.store_code,
      }))

      // peyaOrders lazy-loaded — solo se carga cuando user abre TabPeya (~22K filas)
      const peyaOrders = null

      setData2026({
        ventas,
        gastos,
        bancoMV,
        bankTx: [],
        bankSaldos: bankSaldos || [],
        planillas,
        planillaPorSuc,
        catalogo: catData || [],
        dhDtes,
        ventaspeya,
        ventaspos,
        peya_liq,
        peyaOrders,
        movsSocios,
        prestamoMovs,
        eventosCerrados,
        serfinsaValid,
        depositos,
        planillaGerencial,
        obligaciones,
        planillaOp,
        planillaDesglose,
      })
    } catch (e) {
      console.error('FinanzasDashboard load error:', e)
    }
    setLoading(false)
  }

  // ── Process 2026 data into monthly P&L ──
  // Classifier from DB catalog — used only by TabCatalogo/TabProveedores for display
  const classify = useMemo(() => buildClassifier(data2026?.catalogo || []), [data2026])

  const months2026 = useMemo(() => {
    if (!data2026) return []
    const monthMap = {}

    const initMonth = () => ({ ventas: 0, propinaCobrada: 0, ventaNeta: 0, bySuc: {}, pl: { costo_comida: 0, insumo_venta: 0, limpieza: 0, costo_fijo: 0, gastos_operativos: 0, gastos_logisticos: 0, gasto_financiero: 0, planilla_legal: 0, planilla_gerencial: 0, isss_afp: 0, impuestos: 0, activo_fijo: 0 }, plSubs: {}, planillaDesglose: {}, byProv: {}, egresos: 0, gastosOrigen: { compras_dte: 0, egresos_cierre: 0, descuadre: 0, compras_sin_dte: 0 }, cf: { repago_capital_socios: 0, repago_capital_prestamos: 0, aportes_socios_recibidos: 0, dividendos_pagados: 0 } })

    // Sales — 5-May-2026: ahora desde v_quanto_ordenes_diario
    // total_ventas    = con IVA con propina (lo que entró al cliente)
    // total_sin_iva   = sin IVA con propina
    // venta_neta      = sin IVA sin propina (sub-fila informativa)
    // propina_cobrada = propina al 100% (sub-fila informativa, no tributa IVA)
    data2026.ventas.forEach(v => {
      const m = v.fecha?.substring(0, 7) // "2026-01"
      if (!m) return
      if (!monthMap[m]) monthMap[m] = initMonth()
      const conIvaTotal = parseFloat(v.total_ventas) || 0
      const sinIvaTotal = parseFloat(v.total_sin_iva) || 0
      const total = conIva ? conIvaTotal : sinIvaTotal
      const propina = parseFloat(v.propina_cobrada) || 0  // propina no tiene IVA, igual con/sin
      const neta = parseFloat(v.venta_neta) || 0          // sin IVA sin propina
      monthMap[m].ventas += total
      monthMap[m].propinaCobrada += propina
      monthMap[m].ventaNeta += conIva ? (neta + parseFloat(v.iva_recaudado || 0)) : neta
      monthMap[m].egresos += (v.total_egresos || 0)
      const sc = v.store_code || 'Otro'
      monthMap[m].bySuc[sc] = (monthMap[m].bySuc[sc] || 0) + total
    })

    // Desglose ventas: PeYa vs Local (Quanto POS) vs Eventos cerrados
    // PeYa viene en quanto_transacciones con fuente=PedidosYa
    const peyaByMonth = {}
    ;(data2026.ventaspeya || []).forEach(v => {
      const m = v.fecha?.substring(0, 7)
      if (!m) return
      const t = parseFloat(v.total) || 0
      if (t > 0) peyaByMonth[m] = (peyaByMonth[m] || 0) + t
    })
    // Eventos cerrados — venta adicional NO incluida en Quanto, hay que sumarla a m.ventas
    const eventosByMonth = {}
    ;(data2026.eventosCerrados || []).forEach(ev => {
      const m = ev.fecha_evento?.substring(0, 7)
      if (!m) return
      const t = parseFloat(ev.total_ventas) || 0
      if (t > 0) eventosByMonth[m] = (eventosByMonth[m] || 0) + t
    })
    // Sumar eventos al total de ventas del mes (no estaban incluidos antes)
    Object.entries(eventosByMonth).forEach(([m, total]) => {
      if (!monthMap[m]) monthMap[m] = initMonth()
      const totalAdj = conIva ? total : total / 1.13
      monthMap[m].ventas += totalAdj
    })
    // 5-May-2026: PeYa también debe sumar al total (porque quanto_ordenes excluye PeYa
    // a diferencia de la vista vieja v_ventas_unificadas que sí la incluía)
    Object.entries(peyaByMonth).forEach(([m, total]) => {
      if (!monthMap[m]) monthMap[m] = initMonth()
      const totalAdj = conIva ? total : total / 1.13
      monthMap[m].ventas += totalAdj
    })
    // POS propio (S006): sumar al total del mes (ya trae total_sin_iva)
    const posVentasByMonth = {}
    ;(data2026.ventaspos || []).forEach(v => {
      const m = v.fecha?.substring(0, 7)
      if (!m) return
      const val = conIva ? (parseFloat(v.total_ventas) || 0) : (parseFloat(v.total_sin_iva) || 0)
      posVentasByMonth[m] = (posVentasByMonth[m] || 0) + val
    })
    Object.entries(posVentasByMonth).forEach(([m, total]) => {
      if (!monthMap[m]) monthMap[m] = initMonth()
      monthMap[m].ventas += total
    })
    // Acumular subcategorías de venta por mes
    Object.keys(monthMap).forEach(m => {
      const peyaBruto = peyaByMonth[m] || 0
      const peya = conIva ? peyaBruto : peyaBruto / 1.13
      const eventosBruto = eventosByMonth[m] || 0
      const eventos = conIva ? eventosBruto : eventosBruto / 1.13
      // local ya es Quanto puro CON propina (gracias a v_quanto_ordenes_diario)
      const local = Math.max(0, monthMap[m].ventas - peya - eventos)
      const propina = monthMap[m].propinaCobrada || 0
      if (!monthMap[m].plSubs.ventas) monthMap[m].plSubs.ventas = {}
      // (canales/sucursales ahora en el arbol ventasTree; aqui solo info)
      if (eventos > 0) monthMap[m].plSubs.ventas['🎉 Eventos (cerrados)'] = eventos
      // Propina cobrada como sub-fila INFORMATIVA (ya está incluida en Venta Local arriba)
      if (propina > 0) monthMap[m].plSubs.ventas['ℹ️ Propina cobrada (incluida en Venta Local)'] = propina
    })

    // GASTOS CONSOLIDADOS — clasificados vía categorias_gasto + catalogo_contable
    data2026.gastos.forEach(g => {
      const m = g.fecha?.substring(0, 7)
      if (!m) return
      if (!monthMap[m]) monthMap[m] = initMonth()
      // Anti-doble-conteo: estas categorías Planilla se manejan por vistas dedicadas
      // (v_planilla_gerencial_pl + v_obligaciones_provisionadas) — NO sumar acá
      const catGastoId = g.categoria_gasto_id || g.categoria_id || ''
      const catNombre = g.categoria_nombre || ''
      if (['planilla_gerencial', 'isss_afp', 'planilla_operativa'].includes(catGastoId) ||
          ['Planilla Gerencial', 'ISSS y AFP (cuotas patronales)', 'Planilla Operativa'].includes(catNombre)) {
        return // skip — ya viene por vistas dedicadas
      }
      // Determinar P&L key: primero por nombre exacto, luego por grupo, luego por nombre directo
      let cat = CATNAME_TO_PL[catNombre] || GRUPO_TO_PL[g.categoria_grupo] || catNombre || 'gastos_operativos'
      if (cat === 'Alquiler') cat = 'costo_fijo'
      const sub = g.subcategoria_contable || ''
      const monto = conIva ? (parseFloat(g.monto) || 0) : (parseFloat(g.monto_sin_iva) || parseFloat(g.monto) || 0)
      const catFinal = monthMap[m].pl[cat] !== undefined ? cat : 'gastos_operativos'
      monthMap[m].pl[catFinal] += monto
      // Acumular subcategorías para vista expandible
      const subKey = (sub && sub.trim()) ? sub.trim() : '(sin subcategoría)'
      if (!monthMap[m].plSubs[catFinal]) monthMap[m].plSubs[catFinal] = {}
      monthMap[m].plSubs[catFinal][subKey] = (monthMap[m].plSubs[catFinal][subKey] || 0) + monto
      // Track by origin
      if (monthMap[m].gastosOrigen[g.origen] !== undefined) monthMap[m].gastosOrigen[g.origen] += monto
      // Track by provider for TabProveedores
      const prov = g.proveedor_nombre || 'Desconocido'
      if (!monthMap[m].byProv[prov]) monthMap[m].byProv[prov] = { monto: 0, cat: catFinal, sub, origen: g.origen }
      monthMap[m].byProv[prov].monto += monto
    })

    // Planilla operativa: leer de v_planilla_operativa_pl que ya devuelve
    // - meses cerrados: pagado_real total
    // - mes en curso: provisión incremental diaria (avg 2 meses, normalizada por días equivalentes con asuetos x2)
    // El patronal real (ISSS+AFP) se trae aparte de v_obligaciones_provisionadas
    data2026.planillaOp?.forEach(po => {
      const m = po.mes?.substring(0, 7)
      if (!m) return
      if (!monthMap[m]) monthMap[m] = initMonth()
      monthMap[m].pl.planilla_legal += (parseFloat(po.monto_pl) || 0)
    })

    // Planilla Gerencial — provisión devengada (con auto-saldo si hay pago real)
    // v_planilla_gerencial_pl ya tiene la lógica: monto_pl = COALESCE(pagado_real, provisionado)
    data2026.planillaGerencial?.forEach(pg => {
      const m = pg.mes?.substring(0, 7)
      if (!m) return
      if (!monthMap[m]) monthMap[m] = initMonth()
      const monto = parseFloat(pg.provisionado) || 0  // siempre $10K mensual devengado
      monthMap[m].pl.planilla_gerencial += monto
    })

    // Obligaciones (ISSS/AFP/Impuestos) — provisión auto-saldable
    // monto_pl = pagado_real cuando existe, sino promedio últimos 2 pagos
    data2026.obligaciones?.forEach(o => {
      const m = o.mes?.substring(0, 7)
      if (!m) return
      if (!monthMap[m]) monthMap[m] = initMonth()
      const monto = parseFloat(o.monto_pl) || 0
      if (o.grupo === 'Planilla') {
        monthMap[m].pl.isss_afp += monto
        // Subcategorías para vista expandible
        if (!monthMap[m].plSubs.isss_afp) monthMap[m].plSubs.isss_afp = {}
        const label = `${o.nombre} ${o.estado === 'pagado' ? '✅' : '⏳ prov'}`
        monthMap[m].plSubs.isss_afp[label] = (monthMap[m].plSubs.isss_afp[label] || 0) + monto
      } else if (o.grupo === 'Impuestos') {
        monthMap[m].pl.impuestos += monto
        if (!monthMap[m].plSubs.impuestos) monthMap[m].plSubs.impuestos = {}
        const label = `${o.nombre} ${o.estado === 'pagado' ? '✅' : '⏳ prov'}`
        monthMap[m].plSubs.impuestos[label] = (monthMap[m].plSubs.impuestos[label] || 0) + monto
      }
    })

    // Planilla desglose 3 niveles (grupo → persona → salario normal + propina)
    // Fuente: v_planilla_desglose_pl. El devengado suma EXACTO a la línea Planilla
    // Operativa (v_planilla_operativa_pl). El patronal NO se incluye acá: ya se
    // contabiliza en la línea ISSS+AFP, así que solo mostramos lo que suma a la línea.
    data2026.planillaDesglose?.forEach(d => {
      const m = d.mes?.substring(0, 7)
      if (!m || !monthMap[m]) return
      const grupo = d.grupo || 'Sin grupo'
      const dev = parseFloat(d.devengado) || 0
      const prop = parseFloat(d.propina) || 0
      const sn = dev - prop  // salario normal = base + viático + horas extra + bonos
      const tree = monthMap[m].planillaDesglose
      if (!tree[grupo]) tree[grupo] = { total: 0, personas: {} }
      tree[grupo].total += dev
      const eid = d.empleado_id || d.nombre_completo
      if (!tree[grupo].personas[eid]) tree[grupo].personas[eid] = { nombre: d.nombre_completo, cargo: d.cargo, devengado: 0, salarioNormal: 0, propina: 0 }
      const P = tree[grupo].personas[eid]
      P.devengado += dev
      P.salarioNormal += sn
      P.propina += prop
    })

    // Movimientos socios (F6) — solo afectan caja, NO P&L (excepto salario_socio que ya viene en planillas y pago_interes que va a gasto_financiero)
    data2026.movsSocios?.forEach(ms => {
      const m = ms.fecha?.substring(0, 7)
      if (!m) return
      if (!monthMap[m]) monthMap[m] = initMonth()
      const monto = parseFloat(ms.monto) || 0
      if (ms.tipo === 'repago_capital') {
        monthMap[m].cf.repago_capital_socios += monto
      } else if (ms.tipo === 'dividendo') {
        monthMap[m].cf.dividendos_pagados += monto
      } else if ((ms.tipo === 'aporte_capital' || ms.tipo === 'prestamo_socio') && ms.direccion === 'I') {
        monthMap[m].cf.aportes_socios_recibidos += monto
      }
      // Nota: salario_socio y pago_interes NO se suman acá porque ya entran al P&L vía planillas/gasto_financiero
    })

    // Movimientos préstamos institucionales (F6) — abono_capital NO va al P&L pero sí afecta caja
    data2026.prestamoMovs?.forEach(pm => {
      const m = pm.fecha?.substring(0, 7)
      if (!m) return
      if (!monthMap[m]) monthMap[m] = initMonth()
      const monto = parseFloat(pm.monto) || 0
      if (pm.tipo === 'abono_capital') {
        monthMap[m].cf.repago_capital_prestamos += monto
      }
      // pago_interes y desembolso NO se contabilizan acá — interés ya en gasto_financiero, desembolso es entrada de caja pero crea pasivo
    })

    return Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => {
      const ebitda = v.ventas - v.pl.costo_comida - v.pl.insumo_venta - v.pl.limpieza - v.pl.costo_fijo - v.pl.gastos_operativos - v.pl.gastos_logisticos - v.pl.gasto_financiero - v.pl.planilla_legal - v.pl.planilla_gerencial - v.pl.isss_afp
      const utilidad = ebitda - v.pl.impuestos
      // Free cash flow: utilidad NETA - CapEx - repagos capital + aportes socios recibidos
      const capex = v.pl.activo_fijo
      const totalSalidasNoPL = capex + v.cf.repago_capital_socios + v.cf.repago_capital_prestamos + v.cf.dividendos_pagados
      const caja_neta = utilidad - totalSalidasNoPL + v.cf.aportes_socios_recibidos
      // Promote categorías P&L al nivel raíz para acceso fácil desde plLines
      const plRaiz = { ...v.pl }
      return {
        key: k, label: formatMonth(k), ...v, ebitda, utilidad,
        ...plRaiz, // costo_comida, insumo_venta, limpieza, etc. al nivel raíz
        // Y los CF
        activo_fijo: capex,
        repago_capital_socios: v.cf.repago_capital_socios,
        repago_capital_prestamos: v.cf.repago_capital_prestamos,
        dividendos_pagados: v.cf.dividendos_pagados,
        aportes_socios_recibidos: v.cf.aportes_socios_recibidos,
        caja_neta,
      }
    })
  }, [data2026, conIva])

  if (!ROLES.includes(user?.rol)) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.red }}>⛔ Acceso restringido</div>
  }

  const TABS = [
    { key: 'dashboard', label: '📊 Dashboard', icon: '📊' },
    { key: 'estado-resultados', label: '📋 Estado de Resultados', icon: '📋' },
    { key: 'balance', label: '⚖️ Balance', icon: '⚖️' },
    { key: 'flujo-caja', label: '💰 Flujo de Caja', icon: '💰' },
    { key: 'banco', label: '🏦 Banco', icon: '🏦' },
    { key: 'liquidez', label: '💧 Liquidez Real', icon: '💧' },
    { key: 'peya', label: '🛵 PEYA', icon: '🛵' },
    { key: 'proveedores', label: '🏢 Proveedores', icon: '🏢' },
    { key: 'catalogo', label: '⚙️ Catálogo', icon: '⚙️' },
    { key: 'excluidos', label: '🚫 Excluidos P&L', icon: '🚫' },
  ]

  return (
    <div style={{ padding: '12px 8px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: C.red, fontWeight: 800 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.white, marginTop: 2 }}>Dashboard Financiero</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Ago 2025 — Abr 2026 · Datos en USD</div>
        {/* Toggle IVA */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, background: C.card, borderRadius: 8, padding: '4px 12px', border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, color: conIva ? C.textMuted : C.gold, fontWeight: conIva ? 400 : 700 }}>Sin IVA</span>
          <div
            onClick={() => setConIva(!conIva)}
            style={{ width: 36, height: 20, borderRadius: 10, background: conIva ? C.red : C.gray, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}
          >
            <div style={{ width: 16, height: 16, borderRadius: 8, background: C.white, position: 'absolute', top: 2, left: conIva ? 18 : 2, transition: 'left .2s' }} />
          </div>
          <span style={{ fontSize: 11, color: conIva ? C.gold : C.textMuted, fontWeight: conIva ? 700 : 400 }}>Con IVA</span>
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>Ventas {conIva ? 'con' : 'sin'} IVA · <strong>Con propina cobrada</strong> · Fuente: quanto_ordenes (DTE)</div>

        {/* Card autónoma: última fecha de data + comparador apples-to-apples + botón refresh */}
        <ErrorBoundary>
          <Suspense fallback={null}>
            <CardDataDisponible />
          </Suspense>
        </ErrorBoundary>
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
          {tab === 'dashboard' && <TabDashboard months2026={months2026} ventasRaw={data2026?.ventas} ventaspeya={data2026?.ventaspeya} />}
          {tab === 'estado-resultados' && <TabEstadoResultados months2026={months2026} data2026={data2026} conIva={conIva} />}
          {tab === 'balance' && <TabBalance months2026={months2026} />}
          {tab === 'flujo-caja' && <TabFlujoCaja months2026={months2026} />}
          {tab === 'banco' && <TabBanco bancoMV={data2026?.bancoMV} bankSaldos={data2026?.bankSaldos} months2026={months2026} />}
          {tab === 'liquidez' && <TabLiquidez data2026={data2026} months2026={months2026} conIva={conIva} />}
          {tab === 'peya' && <TabPeya data2026={data2026} conIva={conIva} onRefresh={loadData2026} />}
          {tab === 'proveedores' && <TabProveedores data2026={data2026} months2026={months2026} conIva={conIva} />}
          {tab === 'catalogo' && <TabCatalogo user={user} data2026={data2026} onRefresh={loadData2026} />}
          {tab === 'excluidos' && (
            <ErrorBoundary>
              <Suspense fallback={<div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>⏳ Cargando…</div>}>
                <ExcluidosPlTab />
              </Suspense>
            </ErrorBoundary>
          )}
        </>
      )}

      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: C.gray }}>
        2025: Datos históricos (Excel) · 2026: Datos en tiempo real (Supabase) · Última carga: {new Date().toLocaleString('es-SV')}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  COMPONENTE: VENTAS POR CANAL (reutilizable)
// ══════════════════════════════════════════════════════

const CANAL_COLORS = {
  'PedidosYa': '#e84393',
  'Efectivo':  '#4ade80',
  'Tarjeta':   '#3b82f6',
  'Otros':     '#f4a261',
}

function VentasPorCanal({ ventasRaw, ventaspeya, months2026 }) {
  const [viewMode, setViewMode] = useState('total') // 'total' | 'mensual'

  const canalData = useMemo(() => {
    // Agrupa ventas brutas de cierre por mes
    const byMonth = {}
    ;(ventasRaw || []).forEach(v => {
      const m = v.fecha?.substring(0, 7)
      if (!m || !m.startsWith('2026')) return
      if (!byMonth[m]) byMonth[m] = { efectivo: 0, tarjeta: 0, total: 0 }
      byMonth[m].efectivo += parseFloat(v.efectivo) || 0
      byMonth[m].tarjeta  += parseFloat(v.tarjeta)  || 0
      byMonth[m].total    += parseFloat(v.total_ventas) ||
        ((parseFloat(v.efectivo)||0) + (parseFloat(v.tarjeta)||0) + (parseFloat(v.otros)||0))
    })

    // PeYa por mes (quanto_transacciones, solo positivos = entregados)
    const peyaByMonth = {}
    ;(ventaspeya || []).forEach(v => {
      const m = v.fecha?.substring(0, 7)
      if (!m || !m.startsWith('2026')) return
      const t = parseFloat(v.total) || 0
      if (t > 0) peyaByMonth[m] = (peyaByMonth[m] || 0) + t
    })

    const months = Array.from(new Set([...Object.keys(byMonth), ...Object.keys(peyaByMonth)])).sort()
    const rows = months.map(m => {
      const ef  = byMonth[m]?.efectivo || 0
      const tar = byMonth[m]?.tarjeta  || 0
      const peya = peyaByMonth[m] || 0
      // Total from months2026 (más preciso, ya incluye todo)
      const m26 = months2026?.find(x => x.mes === m)
      const total = m26?.ventas || byMonth[m]?.total || 0
      const otros = Math.max(0, total - ef - tar - peya)
      return { mes: m, label: formatMonth(m), efectivo: ef, tarjeta: tar, peya, otros, total }
    })

    // Totales acumulados
    const tot = rows.reduce((a, r) => ({
      efectivo: a.efectivo + r.efectivo, tarjeta: a.tarjeta + r.tarjeta,
      peya: a.peya + r.peya, otros: a.otros + r.otros, total: a.total + r.total,
    }), { efectivo: 0, tarjeta: 0, peya: 0, otros: 0, total: 0 })

    return { rows, tot }
  }, [ventasRaw, ventaspeya, months2026])

  const { rows, tot } = canalData
  if (!rows.length) return null

  const canales = [
    { key: 'peya',     label: '🛵 PedidosYa', color: CANAL_COLORS['PedidosYa'] },
    { key: 'tarjeta',  label: '💳 Tarjeta',    color: CANAL_COLORS['Tarjeta'] },
    { key: 'efectivo', label: '💵 Efectivo',   color: CANAL_COLORS['Efectivo'] },
    { key: 'otros',    label: '🔗 Otros',      color: CANAL_COLORS['Otros'] },
  ]

  return (
    <div style={sCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div style={sH}>VENTAS POR CANAL 2026</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['total', 'mensual'].map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                border: '1px solid ' + (viewMode === v ? C.red : C.border),
                background: viewMode === v ? 'rgba(230,57,70,0.15)' : 'transparent',
                color: viewMode === v ? C.red : C.textMuted }}>
              {v === 'total' ? 'Resumen' : 'Por Mes'}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'total' ? (
        // Vista resumen — KPI cards + barras proporcionales
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {canales.map(c => {
              const val = tot[c.key]
              const share = tot.total > 0 ? val / tot.total : 0
              return (
                <div key={c.key} style={{ ...sKPI(C.cardAlt), minWidth: 130, textAlign: 'left', padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: c.color, fontWeight: 700, marginBottom: 2 }}>{c.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>{fmt(val)}</div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>{(share * 100).toFixed(1)}% del total</div>
                  <div style={{ background: C.border, borderRadius: 2, height: 3, width: '100%', marginTop: 6 }}>
                    <div style={{ background: c.color, height: 3, borderRadius: 2, width: `${share * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          {/* Stacked bar total */}
          <div style={{ height: 18, borderRadius: 6, display: 'flex', overflow: 'hidden', marginBottom: 4 }}>
            {canales.map(c => {
              const share = tot.total > 0 ? (tot[c.key] / tot.total) * 100 : 0
              return share > 0 ? (
                <div key={c.key} title={`${c.label}: ${share.toFixed(1)}%`}
                  style={{ height: '100%', width: `${share}%`, background: c.color }} />
              ) : null
            })}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>Total: {fmt(tot.total)} · 2026 acumulado</div>
        </>
      ) : (
        // Vista mensual — tabla
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...sTh, textAlign: 'left', minWidth: 70 }}>Mes</th>
                {canales.map(c => <th key={c.key} style={{ ...sTh, color: c.color }}>{c.label}</th>)}
                <th style={{ ...sTh, color: C.gold }}>Total</th>
                <th style={{ ...sTh, color: CANAL_COLORS['PedidosYa'] }}>PeYa %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.mes} style={{ background: i % 2 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                  <td style={{ ...sTdL, fontWeight: 600 }}>{r.label}</td>
                  {canales.map(c => (
                    <td key={c.key} style={{ ...sTd(false), color: c.color }}>{fmt(r[c.key])}</td>
                  ))}
                  <td style={{ ...sTd(false), fontWeight: 700, color: C.gold }}>{fmt(r.total)}</td>
                  <td style={{ ...sTd(false), color: CANAL_COLORS['PedidosYa'] }}>
                    {r.total > 0 ? (r.peya / r.total * 100).toFixed(1) + '%' : '—'}
                  </td>
                </tr>
              ))}
              <tr style={{ background: 'rgba(244,162,97,0.08)', borderTop: `2px solid ${C.gold}` }}>
                <td style={{ ...sTdL, fontWeight: 700, color: C.gold }}>TOTAL</td>
                {canales.map(c => <td key={c.key} style={{ ...sTd(false), fontWeight: 700, color: c.color }}>{fmt(tot[c.key])}</td>)}
                <td style={{ ...sTd(false), fontWeight: 700, color: C.gold }}>{fmt(tot.total)}</td>
                <td style={{ ...sTd(false), fontWeight: 700, color: CANAL_COLORS['PedidosYa'] }}>
                  {tot.total > 0 ? (tot.peya / tot.total * 100).toFixed(1) + '%' : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  TAB 1: DASHBOARD GENERAL (KPIs + Tendencias)
// ══════════════════════════════════════════════════════

function TabDashboard({ months2026, ventasRaw, ventaspeya }) {
  // Combine all months
  const allMonths = buildAllMonths(months2026)
  const latest = allMonths[allMonths.length - 1]
  const prev = allMonths.length > 1 ? allMonths[allMonths.length - 2] : null

  // NOTA: card "Ventas por Sucursal" ahora es <CardVentasComparativo /> aislado.
  // El cálculo apples-to-apples vive en la RPC fn_ventas_comparativo_igualado.

  // YTD totals
  const ytd2025 = { ventas: sum(HIST_PL.ventas), ebitda: sum(HIST_PL.ventas.map((v, i) => v - HIST_PL.costo_comida[i] - HIST_PL.insumo_venta[i] - HIST_PL.limpieza[i] - HIST_PL.costo_fijo[i] - HIST_PL.gastos_operativos[i] - HIST_PL.gastos_logisticos[i] - HIST_PL.gasto_financiero[i] - HIST_PL.planilla_legal[i])) }
  const ytd2026 = { ventas: months2026.reduce((s, m) => s + m.ventas, 0), ebitda: months2026.reduce((s, m) => s + m.ebitda, 0) }

  return (
    <>
      {/* KPIs Row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Ventas Último Mes <InfoTip text="Ventas netas del último mes con datos, de todos los canales (Quanto/POS + PeYa + Eventos), sin IVA. El % compara contra el mes anterior." /></div>
          <div style={sVal}>{fmt(latest?.ventas)}</div>
          <div style={sSub}>{latest?.label}{prev ? ` · ${delta(latest?.ventas, prev?.ventas)}` : ''}</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>EBITDA Último Mes <InfoTip text="Utilidad operativa del último mes: ventas menos todos los costos y gastos operativos, antes de impuestos, intereses y depreciación. El margen es EBITDA ÷ ventas." /></div>
          <div style={{ ...sVal, color: latest?.ebitda >= 0 ? C.greenLight : '#f87171' }}>{fmt(latest?.ebitda)}</div>
          <div style={sSub}>Margen: {pct(latest?.ventas ? latest.ebitda / latest.ventas : 0)}</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Costo Comida % <InfoTip text="Costo de los ingredientes vendidos (food cost) como % de las ventas. Palanca #1 de rentabilidad; entre más bajo, mejor margen." /></div>
          <div style={sVal}>{pct(latest?.ventas ? latest.costo_comida / latest.ventas : 0)}</div>
          <div style={sSub}>Target: 50-55%</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Planilla / Ventas <InfoTip text="Costo de la planilla operativa (sueldos líquidos del personal de sucursal) como % de las ventas. Objetivo: menos del 20%." /></div>
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

      {/* Ventas por Canal */}
      <VentasPorCanal ventasRaw={ventasRaw} ventaspeya={ventaspeya} months2026={months2026} />

      {/* Ventas por Sucursal — Comparativo apples-to-apples (componente lazy aislado) */}
      <ErrorBoundary>
        <Suspense fallback={null}>
          <CardVentasComparativo />
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

// ══════════════════════════════════════════════════════
//  TAB 2: ESTADO DE RESULTADOS (P&L)
// ══════════════════════════════════════════════════════

// Explicaciones (ⓘ) por línea del Estado de Resultados — lenguaje de dueño
const PL_TIPS = {
  ventas: 'Ingresos de TODOS los canales (Quanto/POS + PedidosYa entregados + Eventos). Sin IVA por defecto; incluye propina cobrada.',
  costo_comida: 'Costo de los ingredientes de la comida vendida (COGS de alimentos). Palanca #1 de rentabilidad; meta típica <35% de ventas.',
  insumo_venta: 'Empaques, desechables y otros insumos que se van directo con cada venta.',
  limpieza: 'Productos e insumos de limpieza de los locales.',
  costo_fijo: 'Costos fijos mensuales: alquiler de los locales + electricidad. No varían con las ventas.',
  gastos_operativos: 'Gastos de operación varios: mantenimiento, servicios, papelería, software, etc.',
  gastos_logisticos: 'Costos de logística y reparto: motoristas propios, combustible, envíos.',
  gasto_financiero: 'Comisiones bancarias, intereses y costos financieros.',
  planilla_legal: 'Sueldos líquidos del personal operativo (lo que reciben en mano, ya sin descuentos).',
  isss_afp: 'Aporte patronal de seguridad social (ISSS) y pensión (AFP). "Real" si ya se pagó; "provisión" si aún se está acumulando.',
  planilla_gerencial: 'Sueldos de gerencia y administración, provisionados cada mes.',
  ebitda: 'Utilidad operativa antes de intereses, impuestos y depreciación. = Ventas − todos los costos y gastos operativos. Mide si el negocio gana dinero operando.',
  impuestos: 'Impuestos según DGII (IVA neto, renta, municipales).',
  utilidad: 'Utilidad neta contable del periodo: EBITDA − impuestos.',
  activo_fijo: 'CapEx: compra de activos (equipo, mobiliario, remodelación). No es gasto del P&L, pero SÍ sale de caja.',
  repago_capital_socios: 'Devolución de capital aportado por socios. No afecta el P&L; reduce la caja.',
  repago_capital_prestamos: 'Pago del capital (no los intereses) de préstamos. Reduce caja, no es gasto del P&L.',
  dividendos_pagados: 'Reparto de utilidades a los socios. Sale de caja; no es un gasto.',
  aportes_socios_recibidos: 'Dinero que socios o préstamos inyectan al negocio. Entra a caja; no es una venta.',
  caja_neta: 'Caja neta real: la utilidad neta ajustada por los movimientos que mueven efectivo pero no pasan por el P&L (CapEx, socios, préstamos, dividendos).',
}

function TabEstadoResultados({ months2026, data2026, conIva }) {
  const allMonths = buildAllMonths(months2026)
  const [expanded, setExpanded] = useState({})  // { categoryKey: true }
  const toggleExpand = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }))

  // Calcular subcategorías agregadas por categoría a través de todos los meses
  const subsByCategory = useMemo(() => {
    const result = {}
    allMonths.forEach(m => {
      if (!m.plSubs) return
      Object.entries(m.plSubs).forEach(([cat, subs]) => {
        if (!result[cat]) result[cat] = {}
        Object.entries(subs).forEach(([sub, monto]) => {
          if (!result[cat][sub]) result[cat][sub] = { total: 0, perMonth: {} }
          result[cat][sub].total += monto || 0
          result[cat][sub].perMonth[m.key] = (result[cat][sub].perMonth[m.key] || 0) + (monto || 0)
        })
      })
    })
    // Ordenar subcategorías por total desc
    Object.keys(result).forEach(cat => {
      result[cat] = Object.entries(result[cat])
        .sort((a, b) => b[1].total - a[1].total)
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {})
    })
    return result
  }, [allMonths])

  // Árbol de planilla 3 niveles: grupo → persona → (salario normal + propina).
  // Devengado agregado por mes; suma exacto a la línea Planilla Operativa.
  const planillaTree = useMemo(() => {
    const grupos = {}
    allMonths.forEach(m => {
      const des = m.planillaDesglose
      if (!des) return
      Object.entries(des).forEach(([grupo, gd]) => {
        if (!grupos[grupo]) grupos[grupo] = { total: 0, perMonth: {}, personas: {} }
        grupos[grupo].total += gd.total || 0
        grupos[grupo].perMonth[m.key] = (grupos[grupo].perMonth[m.key] || 0) + (gd.total || 0)
        Object.entries(gd.personas || {}).forEach(([eid, p]) => {
          if (!grupos[grupo].personas[eid]) grupos[grupo].personas[eid] = { nombre: p.nombre, cargo: p.cargo, total: 0, perMonth: {}, sn: { total: 0, perMonth: {} }, prop: { total: 0, perMonth: {} } }
          const P = grupos[grupo].personas[eid]
          P.total += p.devengado || 0
          P.perMonth[m.key] = (P.perMonth[m.key] || 0) + (p.devengado || 0)
          P.sn.total += p.salarioNormal || 0
          P.sn.perMonth[m.key] = (P.sn.perMonth[m.key] || 0) + (p.salarioNormal || 0)
          P.prop.total += p.propina || 0
          P.prop.perMonth[m.key] = (P.prop.perMonth[m.key] || 0) + (p.propina || 0)
        })
      })
    })
    return Object.entries(grupos)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([grupo, g]) => ({
        grupo, total: g.total, perMonth: g.perMonth,
        personas: Object.entries(g.personas).map(([eid, p]) => ({ eid, ...p })).sort((a, b) => b.total - a.total),
      }))
  }, [allMonths])
  const hasPlanillaTree = planillaTree.length > 0

  // Arbol de ventas: canal (Quanto / POS / PeYa) -> sucursal, para desglose en Estado de Resultados
  const ventasTree = useMemo(() => {
    if (!data2026) return []
    const NOMBRE = { M001: 'Cafetalón', S001: 'Soyapango', S002: 'Usulután', S003: 'Lourdes', S004: 'Venecia', S006: 'Metro Centro' }
    const mk = (key, label) => ({ key, label, total: 0, perMonth: {}, sucMap: {} })
    const chans = {
      quanto: mk('quanto', '🏪 Venta Local (Quanto)'),
      pos:    mk('pos', '🏬 Venta Local POS (Metro Centro)'),
      peya:   mk('peya', '🛵 PedidosYa (Delivery)'),
    }
    const add = (chan, arr) => (arr || []).forEach(v => {
      const mkey = v.fecha?.substring(0, 7); if (!mkey) return
      const gross = parseFloat(v.total_ventas) || parseFloat(v.total) || 0
      const val = conIva ? gross : (parseFloat(v.total_sin_iva) || gross / 1.13)
      if (!val) return
      const sc = v.store_code || 'Otro'
      chan.total += val; chan.perMonth[mkey] = (chan.perMonth[mkey] || 0) + val
      if (!chan.sucMap[sc]) chan.sucMap[sc] = { sc, nombre: NOMBRE[sc] || sc, total: 0, perMonth: {} }
      chan.sucMap[sc].total += val; chan.sucMap[sc].perMonth[mkey] = (chan.sucMap[sc].perMonth[mkey] || 0) + val
    })
    add(chans.quanto, data2026.ventas)
    add(chans.pos, data2026.ventaspos)
    add(chans.peya, data2026.ventaspeya)
    return [chans.quanto, chans.pos, chans.peya]
      .filter(c => c.total > 0.005)
      .map(c => ({ ...c, sucs: Object.values(c.sucMap).sort((a, b) => b.total - a.total) }))
  }, [data2026, conIva])
  const hasVentasTree = ventasTree.length > 0

  const plLines = [
    { key: 'ventas', label: 'VENTAS TOTALES', bold: true, positive: true },
    { key: 'costo_comida', label: '(-) Costo de Comida', indent: true },
    { key: 'insumo_venta', label: '(-) Insumo de Venta', indent: true },
    { key: 'limpieza', label: '(-) Limpieza', indent: true },
    { key: 'costo_fijo', label: '(-) Costo Fijo (Alquiler+Elec)', indent: true },
    { key: 'gastos_operativos', label: '(-) Gastos Operativos', indent: true },
    { key: 'gastos_logisticos', label: '(-) Gastos Logísticos', indent: true },
    { key: 'gasto_financiero', label: '(-) Gasto Financiero', indent: true },
    { key: 'planilla_legal', label: '(-) Planilla Operativa (líquidos)', indent: true },
    { key: 'isss_afp', label: '(-) ISSS + AFP (real / provisión)', indent: true },
    { key: 'planilla_gerencial', label: '(-) Planilla Gerencial (provisionado)', indent: true },
    { key: 'ebitda', label: 'EBITDA', bold: true, computed: true },
    { key: 'impuestos', label: '(-) Impuestos', indent: true },
    { key: 'utilidad', label: 'UTILIDAD NETA', bold: true, computed: true },
    // ─── Movimientos no-P&L que sí afectan caja ───
    { key: 'activo_fijo', label: '(-) CapEx (Activo Fijo)', indent: true, noPL: true },
    { key: 'repago_capital_socios', label: '(-) Repago Capital Socios', indent: true, noPL: true },
    { key: 'repago_capital_prestamos', label: '(-) Repago Capital Préstamos', indent: true, noPL: true },
    { key: 'dividendos_pagados', label: '(-) Dividendos Pagados', indent: true, noPL: true },
    { key: 'aportes_socios_recibidos', label: '(+) Aportes/Préstamos Socios Recibidos', indent: true, noPL: true, positive: true },
    { key: 'caja_neta', label: 'CAJA NETA REAL', bold: true, computed: true },
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

      <div style={{ overflowX: 'auto', maxHeight: '75vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead style={{ position: 'sticky', top: 0, background: C.card, zIndex: 3 }}>
            <tr style={{ borderBottom: `2px solid ${C.red}` }}>
              <th style={{ ...sTh, textAlign: 'left', color: C.white, position: 'sticky', left: 0, background: C.card, zIndex: 4, minWidth: 180 }}>Concepto</th>
              {allMonths.map((m, i) => (
                <th key={i} style={{ ...sTh, fontSize: 10, color: m.is2026 ? C.blue : C.gold, background: C.card }}>
                  {m.label}
                </th>
              ))}
              <th style={{ ...sTh, color: C.red, background: C.card }}>Total</th>
              <th style={{ ...sTh, color: C.textMuted, background: C.card }}>% Venta</th>
            </tr>
          </thead>
          <tbody>
            {plLines.map((line, li) => {
              const isSeparator = line.key === 'ebitda' || line.key === 'utilidad' || line.key === 'caja_neta'
              const isCFSection = line.noPL
              const rowBg = isSeparator ? '#2a2a3e' : isCFSection ? '#1a2540' : li % 2 ? '#192237' : C.card
              const prevLine = plLines[li - 1]
              const showCFHeader = isCFSection && (!prevLine || !prevLine.noPL)
              const hasSubs = (subsByCategory[line.key] && Object.keys(subsByCategory[line.key]).length > 0) || (line.key === 'planilla_legal' && hasPlanillaTree) || (line.key === 'ventas' && hasVentasTree)
              const isExp = !!expanded[line.key]
              return (
                <React.Fragment key={line.key}>
                {showCFHeader && (
                  <tr style={{ background: '#0d1424' }}>
                    <td colSpan={allMonths.length + 3} style={{
                      padding: '8px 8px 4px 8px', fontSize: 10, fontWeight: 800,
                      color: C.gold, letterSpacing: 1.5, textTransform: 'uppercase',
                      borderTop: `2px solid ${C.gold}`,
                      position: 'sticky', left: 0, background: '#0d1424',
                    }}>
                      ▸ Salidas/Entradas de caja NO contabilizadas en P&L
                    </td>
                  </tr>
                )}
                <tr style={{
                  background: rowBg,
                  borderTop: isSeparator ? `1px solid ${C.red}` : 'none',
                }}>
                  <td style={{
                    ...sTdL,
                    fontWeight: line.bold ? 800 : 400,
                    paddingLeft: line.indent ? 20 : 6,
                    color: line.bold ? C.white : C.textMuted,
                    fontSize: line.bold ? 12 : 11,
                    position: 'sticky', left: 0, background: rowBg, zIndex: 1,
                    boxShadow: '2px 0 4px rgba(0,0,0,0.3)',
                    cursor: hasSubs ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                  onClick={hasSubs ? () => toggleExpand(line.key) : undefined}>
                    {hasSubs && (
                      <span style={{ display: 'inline-block', width: 14, color: isExp ? C.gold : C.textMuted, fontSize: 9, marginRight: 2 }}>
                        {isExp ? '▼' : '▶'}
                      </span>
                    )}
                    {line.label}{PL_TIPS[line.key] ? <InfoTip text={PL_TIPS[line.key]} /> : null}
                  </td>
                  {allMonths.map((m, i) => {
                    const val = m[line.key] || 0
                    const isNeg = !line.positive && val < 0
                    const ventasMes = m.ventas || 0
                    const pctMes = ventasMes && line.key !== 'ventas' ? (val / ventasMes) : null
                    return (
                      <td key={i} style={{
                        ...sTd(isNeg || (line.computed && val < 0)),
                        fontWeight: line.bold ? 700 : 400,
                        fontSize: 11,
                      }}>
                        <div>{val < 0 && line.computed ? '-' : ''}{fmt(val)}</div>
                        {pctMes !== null && val !== 0 && (
                          <div style={{ fontSize: 9, color: C.textMuted, fontWeight: 400, marginTop: 1 }}>
                            {pct(pctMes)}
                          </div>
                        )}
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
                {/* Filas hijas si está expandido */}
                {isExp && subsByCategory[line.key] && Object.entries(subsByCategory[line.key]).map(([sub, info]) => {
                  // Sub-filas informativas (prefijo ℹ️) — NO se suman al total, se muestran en gris
                  const esInfo = sub.startsWith('ℹ️')
                  const colorTxt = esInfo ? '#64748b' : '#94a3b8'
                  const colorVal = esInfo ? '#64748b' : '#cbd5e1'
                  return (
                  <tr key={`${line.key}-${sub}`} style={{ background: '#0f1828' }}>
                    <td style={{
                      ...sTdL, paddingLeft: 36,
                      color: colorTxt, fontSize: 10, fontStyle: 'italic',
                      position: 'sticky', left: 0, background: '#0f1828', zIndex: 1,
                      boxShadow: '2px 0 4px rgba(0,0,0,0.3)',
                      opacity: esInfo ? 0.75 : 1,
                    }}>
                      ↳ {sub}
                    </td>
                    {allMonths.map((m, i) => {
                      const v = info.perMonth[m.key] || 0
                      const ventasMes = m.ventas || 0
                      const pctMes = v && ventasMes && !esInfo ? (v / ventasMes) : null
                      return (
                        <td key={i} style={{ ...sTd(), fontSize: 10, color: v ? colorVal : '#475569', opacity: esInfo ? 0.75 : 1 }}>
                          <div>{v ? fmt(v) : '—'}</div>
                          {pctMes !== null && (
                            <div style={{ fontSize: 8, color: '#64748b', fontWeight: 400, marginTop: 1 }}>
                              {pct(pctMes)}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ ...sTd(), fontSize: 10, color: colorVal, fontWeight: esInfo ? 400 : 700, borderLeft: `1px solid ${C.border}`, opacity: esInfo ? 0.75 : 1 }}>
                      {fmt(info.total)}
                    </td>
                    <td style={{ ...sTd(), fontSize: 10, color: C.textMuted, opacity: esInfo ? 0.75 : 1 }}>
                      {esInfo ? '—' : (totals[line.key] ? pct(info.total / totals[line.key]) : '—')}
                    </td>
                  </tr>
                  )
                })}
                {/* Desglose planilla 3 niveles: grupo → persona → salario normal + propina */}
                {line.key === 'planilla_legal' && isExp && hasPlanillaTree && planillaTree.flatMap(g => {
                  const gKey = `pl::${g.grupo}`
                  const gExp = !!expanded[gKey]
                  const rows = [
                    <tr key={gKey} style={{ background: '#0f1828', cursor: 'pointer' }} onClick={() => toggleExpand(gKey)}>
                      <td style={{ ...sTdL, paddingLeft: 34, color: '#e2e8f0', fontSize: 10, fontWeight: 700, position: 'sticky', left: 0, background: '#0f1828', zIndex: 1, boxShadow: '2px 0 4px rgba(0,0,0,0.3)' }}>
                        <span style={{ display: 'inline-block', width: 12, color: gExp ? C.gold : C.textMuted, fontSize: 9 }}>{gExp ? '▼' : '▶'}</span>
                        {g.grupo}
                      </td>
                      {allMonths.map((m, i) => {
                        const v = g.perMonth[m.key] || 0
                        return <td key={i} style={{ ...sTd(), fontSize: 10, color: v ? '#e2e8f0' : '#475569' }}>{v ? fmt(v) : '—'}</td>
                      })}
                      <td style={{ ...sTd(), fontSize: 10, color: '#e2e8f0', fontWeight: 700, borderLeft: `1px solid ${C.border}` }}>{fmt(g.total)}</td>
                      <td style={{ ...sTd(), fontSize: 10, color: C.textMuted }}>{totals[line.key] ? pct(g.total / totals[line.key]) : '—'}</td>
                    </tr>
                  ]
                  if (gExp) {
                    g.personas.forEach(p => {
                      const pKey = `${gKey}::${p.eid}`
                      const pExp = !!expanded[pKey]
                      rows.push(
                        <tr key={pKey} style={{ background: '#0c1320', cursor: 'pointer' }} onClick={() => toggleExpand(pKey)}>
                          <td style={{ ...sTdL, paddingLeft: 50, color: '#cbd5e1', fontSize: 10, position: 'sticky', left: 0, background: '#0c1320', zIndex: 1, boxShadow: '2px 0 4px rgba(0,0,0,0.3)' }}>
                            <span style={{ display: 'inline-block', width: 12, color: pExp ? C.gold : '#475569', fontSize: 9 }}>{pExp ? '▼' : '▶'}</span>
                            {p.nombre}{p.cargo ? <span style={{ color: '#64748b', fontStyle: 'italic' }}> · {p.cargo}</span> : null}
                          </td>
                          {allMonths.map((m, i) => {
                            const v = p.perMonth[m.key] || 0
                            return <td key={i} style={{ ...sTd(), fontSize: 10, color: v ? '#cbd5e1' : '#475569' }}>{v ? fmt(v) : '—'}</td>
                          })}
                          <td style={{ ...sTd(), fontSize: 10, color: '#cbd5e1', fontWeight: 700, borderLeft: `1px solid ${C.border}` }}>{fmt(p.total)}</td>
                          <td style={{ ...sTd(), fontSize: 10, color: C.textMuted }}>{g.total ? pct(p.total / g.total) : '—'}</td>
                        </tr>
                      )
                      if (pExp) {
                        const comps = [{ lbl: '💵 Salario normal', d: p.sn }, { lbl: '🎁 Propina', d: p.prop }]
                        comps.forEach((c, ci) => {
                          if (!c.d.total) return
                          rows.push(
                            <tr key={`${pKey}::c${ci}`} style={{ background: '#080e18' }}>
                              <td style={{ ...sTdL, paddingLeft: 66, color: '#64748b', fontSize: 10, fontStyle: 'italic', position: 'sticky', left: 0, background: '#080e18', zIndex: 1, boxShadow: '2px 0 4px rgba(0,0,0,0.3)' }}>↳ {c.lbl}</td>
                              {allMonths.map((m, i) => {
                                const v = c.d.perMonth[m.key] || 0
                                return <td key={i} style={{ ...sTd(), fontSize: 10, color: v ? '#94a3b8' : '#475569' }}>{v ? fmt(v) : '—'}</td>
                              })}
                              <td style={{ ...sTd(), fontSize: 10, color: '#94a3b8', borderLeft: `1px solid ${C.border}` }}>{fmt(c.d.total)}</td>
                              <td style={{ ...sTd(), fontSize: 10, color: C.textMuted }}>{p.total ? pct(c.d.total / p.total) : '—'}</td>
                            </tr>
                          )
                        })
                      }
                    })
                  }
                  return rows
                })}
                {/* Desglose Ventas: canal -> sucursal */}
                {line.key === 'ventas' && isExp && hasVentasTree && ventasTree.flatMap(ch => {
                  const chKey = `ventas::${ch.key}`
                  const chExp = !!expanded[chKey]
                  const multi = ch.sucs.length > 1
                  const rows = [
                    <tr key={chKey} style={{ background: '#0f1828', cursor: multi ? 'pointer' : 'default' }} onClick={multi ? () => toggleExpand(chKey) : undefined}>
                      <td style={{ ...sTdL, paddingLeft: 34, color: '#e2e8f0', fontSize: 10, fontWeight: 700, position: 'sticky', left: 0, background: '#0f1828', zIndex: 1, boxShadow: '2px 0 4px rgba(0,0,0,0.3)' }}>
                        <span style={{ display: 'inline-block', width: 12, color: chExp ? C.gold : C.textMuted, fontSize: 9 }}>{multi ? (chExp ? '▼' : '▶') : ''}</span>
                        {ch.label}
                      </td>
                      {allMonths.map((m, i) => {
                        const v = ch.perMonth[m.key] || 0
                        const vm = m.ventas || 0
                        const pm = v && vm ? (v / vm) : null
                        return <td key={i} style={{ ...sTd(), fontSize: 10, color: v ? '#e2e8f0' : '#475569' }}><div>{v ? fmt(v) : '—'}</div>{pm !== null && <div style={{ fontSize: 8, color: '#64748b', marginTop: 1 }}>{pct(pm)}</div>}</td>
                      })}
                      <td style={{ ...sTd(), fontSize: 10, color: '#e2e8f0', fontWeight: 700, borderLeft: `1px solid ${C.border}` }}>{fmt(ch.total)}</td>
                      <td style={{ ...sTd(), fontSize: 10, color: C.textMuted }}>{totals.ventas ? pct(ch.total / totals.ventas) : '—'}</td>
                    </tr>
                  ]
                  if (chExp && multi) ch.sucs.forEach(su => {
                    rows.push(
                      <tr key={`${chKey}::${su.sc}`} style={{ background: '#0c1320' }}>
                        <td style={{ ...sTdL, paddingLeft: 50, color: '#cbd5e1', fontSize: 10, fontStyle: 'italic', position: 'sticky', left: 0, background: '#0c1320', zIndex: 1, boxShadow: '2px 0 4px rgba(0,0,0,0.3)' }}>↳ {su.nombre} <span style={{ color: '#64748b' }}>· {su.sc}</span></td>
                        {allMonths.map((m, i) => {
                          const v = su.perMonth[m.key] || 0
                          return <td key={i} style={{ ...sTd(), fontSize: 10, color: v ? '#cbd5e1' : '#475569' }}>{v ? fmt(v) : '—'}</td>
                        })}
                        <td style={{ ...sTd(), fontSize: 10, color: '#cbd5e1', fontWeight: 700, borderLeft: `1px solid ${C.border}` }}>{fmt(su.total)}</td>
                        <td style={{ ...sTd(), fontSize: 10, color: C.textMuted }}>{ch.total ? pct(su.total / ch.total) : '—'}</td>
                      </tr>
                    )
                  })
                  return rows
                })}
                </React.Fragment>
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
//  TAB LIQUIDEZ REAL — Reportado POS vs Recibido Banco
// ══════════════════════════════════════════════════════

const CANAL_LIQ = {
  tarjeta:      { icon: '💳', label: 'Tarjeta (Serfinsa)',  color: '#3b82f6', comision: 0.030 },
  pos_bac:      { icon: '🏦', label: 'POS Adquirente BAC',  color: '#06b6d4', comision: 0.025 },
  efectivo:     { icon: '💵', label: 'Efectivo (depósitos)', color: '#4ade80', comision: 0 },
  peya:         { icon: '🛵', label: 'PedidosYa',            color: '#e84393', comision: 0.275 },
  transfers:    { icon: '🔄', label: 'Transferencias',       color: '#a78bfa', comision: 0 },
}

function TabLiquidez({ data2026, months2026, conIva }) {
  const [filtroMes, setFiltroMes] = useState('')

  const liq = useMemo(() => {
    if (!data2026) return null
    const adj = (v) => conIva ? v : v / 1.13

    // ───── REPORTADO (POS Quanto)
    const posByMonth = {}
    ;(data2026.ventas || []).forEach(v => {
      const m = v.fecha?.substring(0, 7)
      if (!m) return
      if (!posByMonth[m]) posByMonth[m] = { tarjeta: 0, efectivo: 0, peya: 0, otros: 0 }
      posByMonth[m].tarjeta  += adj(parseFloat(v.tarjeta)  || 0)
      posByMonth[m].efectivo += adj(parseFloat(v.efectivo) || 0)
      posByMonth[m].otros    += adj(parseFloat(v.otros)    || 0)
    })
    ;(data2026.ventaspeya || []).forEach(v => {
      const m = v.fecha?.substring(0, 7)
      if (!m) return
      const t = parseFloat(v.total) || 0
      if (t > 0) {
        if (!posByMonth[m]) posByMonth[m] = { tarjeta: 0, efectivo: 0, peya: 0, otros: 0 }
        posByMonth[m].peya = (posByMonth[m].peya || 0) + adj(t)
      }
    })

    // ───── FUENTES OFICIALES PRIMERO (Opción A — más precisas)
    // 1. Serfinsa diaria → cuadre por fecha de operación (sin desfase T-2)
    const sValidByMonth = {}
    ;(data2026.serfinsaValid || []).forEach(s => {
      const m = s.fecha?.substring(0, 7)
      if (!m) return
      if (!sValidByMonth[m]) sValidByMonth[m] = { liquidado: 0, reportado: 0, diff: 0, dias: 0 }
      sValidByMonth[m].liquidado += parseFloat(s.total_serfinsa) || 0
      sValidByMonth[m].reportado += parseFloat(s.total_tarjeta_reportado) || 0
      sValidByMonth[m].diff      += parseFloat(s.diferencia) || 0
      sValidByMonth[m].dias      += 1
    })
    // 2. Depósitos bancarios (desde 23-Mar 2026)
    const depByMonth = {}
    ;(data2026.depositos || []).forEach(d => {
      const m = d.fecha_deposito?.substring(0, 7)
      if (!m) return
      if (!depByMonth[m]) depByMonth[m] = { monto: 0, esperado: 0, n: 0 }
      depByMonth[m].monto    += parseFloat(d.monto)          || 0
      depByMonth[m].esperado += parseFloat(d.monto_esperado) || 0
      depByMonth[m].n        += 1
    })
    // 3. PeYa liquidaciones oficiales (correos PedidosYa)
    // Asignar por mes de fecha_deposito (cuando entra al banco)
    const peyaLiqByMonth = {}
    ;(data2026.peya_liq || []).forEach(l => {
      const m = (l.fecha_deposito || l.semana_fin)?.substring(0, 7)
      if (!m) return
      if (!peyaLiqByMonth[m]) peyaLiqByMonth[m] = { monto: 0, n: 0 }
      peyaLiqByMonth[m].monto += parseFloat(l.monto_depositado) || 0
      peyaLiqByMonth[m].n     += 1
    })

    // ───── RECIBIDO (Bank BAC) — desde mv_finanzas_banco_mensual (pre-clasificada)
    // OLA 4: reemplaza el loop row-by-row sobre bankTx con clasificacion de texto.
    // La matview ya tiene los totales por canal pre-calculados en la BD.
    const bankByMonth = {}
    ;(data2026.bancoMV || []).forEach(row => {
      const m = row.mes?.substring(0, 7)
      if (!m) return
      if (!bankByMonth[m]) bankByMonth[m] = { serfinsa_bank: 0, pos_bac: 0, efectivo_bank: 0, peya_bank: 0, transfers: 0 }
      bankByMonth[m].serfinsa_bank += parseFloat(row.total_serfinsa_credito) || 0
      bankByMonth[m].pos_bac       += parseFloat(row.total_pos_bac) || 0
      bankByMonth[m].efectivo_bank += parseFloat(row.total_efectivo_deposito) || 0
      bankByMonth[m].peya_bank     += parseFloat(row.total_peya_credito) || 0
      bankByMonth[m].transfers     += parseFloat(row.total_transfers_credito) || 0
    })

    const allMeses = Array.from(new Set([
      ...Object.keys(posByMonth), ...Object.keys(bankByMonth), ...Object.keys(sValidByMonth)
    ])).sort()

    const rows = allMeses.map(m => {
      const p = posByMonth[m] || { tarjeta: 0, efectivo: 0, peya: 0, otros: 0 }
      const b = bankByMonth[m] || { serfinsa_bank: 0, pos_bac: 0, efectivo_bank: 0, peya_bank: 0, transfers: 0 }
      const sv = sValidByMonth[m]
      const dp = depByMonth[m]
      const peyaLiq = peyaLiqByMonth[m]

      // ── PRIORIZAR FUENTES OFICIALES ──
      // Tarjeta: usar serfinsa_validacion_diaria (fuente oficial Serfinsa, sin desfase T-2)
      const recSerfinsa = sv?.liquidado || b.serfinsa_bank
      const sourceSerfinsa = sv ? 'oficial' : 'bank_tx'

      // Efectivo: priorizar depositos_bancarios cuando hay; si no, bank_tx DP
      const recEfectivo = dp?.monto || b.efectivo_bank
      const sourceEfectivo = dp ? 'oficial' : 'bank_tx'

      // PeYa: priorizar peya_liquidaciones (correos PedidosYa)
      const recPeya = peyaLiq?.monto || b.peya_bank
      const sourcePeya = peyaLiq ? 'oficial' : 'bank_tx'

      const canales = {
        tarjeta:   { rep: p.tarjeta,  rec: recSerfinsa, comision: p.tarjeta * 0.030, source: sourceSerfinsa, _bank: b.serfinsa_bank },
        pos_bac:   { rep: 0,          rec: b.pos_bac,   comision: 0, source: 'bank_tx' },
        efectivo:  { rep: p.efectivo, rec: recEfectivo, comision: 0, source: sourceEfectivo, _bank: b.efectivo_bank },
        peya:      { rep: p.peya,     rec: recPeya,     comision: p.peya * 0.275, source: sourcePeya, _bank: b.peya_bank, _liqN: peyaLiq?.n || 0 },
        transfers: { rep: 0,          rec: b.transfers, comision: 0, source: 'bank_tx' },
      }
      const totalRep = p.tarjeta + p.efectivo + p.peya + p.otros
      const totalRec = recSerfinsa + b.pos_bac + recEfectivo + recPeya + b.transfers
      const cobertura = totalRep > 0 ? (totalRec / totalRep) * 100 : 0
      return { mes: m, p, b, canales, totalRep, totalRec, cobertura, gap: totalRep - totalRec, sv, dp, peyaLiq }
    })

    return { rows, peyaLiqVacio: !data2026.peya_liq?.length, depositosVacio: !data2026.depositos?.length }
  }, [data2026, conIva])

  if (!liq || !liq.rows.length) {
    return <div style={sCard}><div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>💧 Sin datos de liquidez</div></div>
  }

  const mesActual = filtroMes ? liq.rows.find(r => r.mes === filtroMes) : liq.rows[liq.rows.length - 1]
  const totales = liq.rows.reduce((acc, r) => ({
    rep: acc.rep + r.totalRep, rec: acc.rec + r.totalRec, gap: acc.gap + r.gap
  }), { rep: 0, rec: 0, gap: 0 })
  const coberturaGlobal = totales.rep > 0 ? (totales.rec / totales.rep) * 100 : 0

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>💧 Liquidez Real — Cash Conversion</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
          ¿Cuánto de la venta reportada en POS realmente entra líquido a la cuenta BAC? Compara <b style={{color: C.gold}}>POS (Quanto + PeYa)</b> vs <b style={{color: C.greenLight}}>liquidaciones BAC</b> por canal.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCardBanco label="Reportado POS total" value={fmt(totales.rep)} sub={`${liq.rows.length} meses`} color={C.gold} />
        <KpiCardBanco label="Recibido en banco" value={fmt(totales.rec)} sub="liquidaciones BAC identificadas" color={C.greenLight} />
        <KpiCardBanco label="% Cobertura" value={`${coberturaGlobal.toFixed(1)}%`} sub={coberturaGlobal >= 90 ? 'cuadre saludable' : coberturaGlobal >= 70 ? 'revisar gaps' : 'revisión urgente'} color={coberturaGlobal >= 90 ? C.greenLight : coberturaGlobal >= 70 ? C.gold : C.red} />
        <KpiCardBanco label="Gap (no recibido)" value={fmt(totales.gap)} sub="comisiones + retraso + faltantes" color={totales.gap >= 0 ? C.red : C.greenLight} />
      </div>

      <div style={{ background: '#0c4a6e22', border: '1px solid #0369a1', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 11, color: '#bae6fd' }}>
        📋 <b>Fuentes activas:</b> Tarjeta = <code>serfinsa_validacion_diaria</code> · Efectivo = <code>depositos_bancarios</code> (desde 23-Mar) + bank_tx DP (resto) · PeYa = <code>peya_liquidaciones</code> (15 correos cargados) + bank_tx fallback · POS BAC y Transfers = bank_tx.
        {liq.peyaLiqVacio && <><br/>⚠️ <code>peya_liquidaciones</code> vacía → PeYa solo desde bank_tx.</>}
        {liq.depositosVacio && <><br/>⚠️ <code>depositos_bancarios</code> vacía → Efectivo solo desde bank_tx.</>}
      </div>

      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 8 }}>Resumen mensual por canal</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 900 }}>
            <thead><tr style={{ borderBottom: `2px solid ${C.red}` }}>
              <th style={{ ...sTh, textAlign: 'left', position: 'sticky', left: 0, background: C.card, zIndex: 2 }}>Mes</th>
              <th style={{ ...sTh, textAlign: 'right' }}>💳 Tarj POS</th>
              <th style={{ ...sTh, textAlign: 'right' }}>↳ Serfinsa</th>
              <th style={{ ...sTh, textAlign: 'right' }}>🏦 POS BAC</th>
              <th style={{ ...sTh, textAlign: 'right' }}>💵 Efect POS</th>
              <th style={{ ...sTh, textAlign: 'right' }}>↳ Depósitos</th>
              <th style={{ ...sTh, textAlign: 'right' }}>🛵 PeYa POS</th>
              <th style={{ ...sTh, textAlign: 'right' }}>↳ PeYa banco</th>
              <th style={{ ...sTh, textAlign: 'right' }}>🔄 Transfers</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Cobertura</th>
            </tr></thead>
            <tbody>
              {liq.rows.map(r => {
                const isSel = r.mes === (filtroMes || liq.rows[liq.rows.length-1].mes)
                return (
                  <tr key={r.mes} onClick={() => setFiltroMes(r.mes)} style={{
                    borderBottom: '1px solid #2a3340', cursor: 'pointer',
                    background: isSel ? 'rgba(96,165,250,0.08)' : 'transparent',
                  }}>
                    <td style={{ ...sTdL, fontWeight: 700, color: isSel ? C.blue : C.white, position: 'sticky', left: 0, background: isSel ? '#1a2540' : C.card, zIndex: 1 }}>{formatMonth(r.mes)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: C.gold }}>{fmt(r.canales.tarjeta.rep)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: C.greenLight }}>{fmt(r.canales.tarjeta.rec)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: '#06b6d4' }}>{fmt(r.canales.pos_bac.rec)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: C.gold }}>{fmt(r.canales.efectivo.rep)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: C.greenLight }}>{fmt(r.canales.efectivo.rec)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: C.gold }}>{fmt(r.canales.peya.rep)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: r.canales.peya.rec > 0 ? C.greenLight : '#475569' }}>{r.canales.peya.rec > 0 ? fmt(r.canales.peya.rec) : '—'}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: '#a78bfa' }}>{r.canales.transfers.rec > 0 ? fmt(r.canales.transfers.rec) : '—'}</td>
                    <td style={{ ...sTd(), textAlign: 'right', fontWeight: 700, color: r.cobertura >= 90 ? C.greenLight : r.cobertura >= 70 ? C.gold : '#f87171' }}>
                      {r.cobertura.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6, fontStyle: 'italic' }}>
          💡 PeYa banco identificado por: "PARTNER PEDIDOSYA" + "Pay Adv Doc 6XXXXXXXXX" en viernes $3K-$15K (liquidación semanal típica).
        </div>
      </div>

      {mesActual && (
        <div style={{ ...sCard, marginTop: 16 }}>
          <div style={sH}>Análisis detallado de {formatMonth(mesActual.mes)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 10, marginTop: 8 }}>
            {Object.entries(mesActual.canales).map(([key, c]) => {
              const cfg = CANAL_LIQ[key]
              if (!cfg) return null
              const liquido_esperado = c.rep - c.comision
              const diff = c.rec - liquido_esperado
              const pct = c.rep > 0 ? (c.rec / c.rep) * 100 : (c.rec > 0 ? 100 : 0)
              const noReportado = c.rep === 0 && c.rec > 0
              return (
                <div key={key} style={{ background: '#0f1828', borderRadius: 8, padding: 12, border: `1px solid ${cfg.color}33` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.icon} {cfg.label}</div>
                    {!noReportado && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: pct >= 90 ? C.greenLight : pct >= 70 ? C.gold : '#f87171' }}>
                        {pct.toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textMuted, marginBottom: 3 }}>
                      <span>Reportado POS</span><span style={{ color: C.gold }}>{fmt(c.rep)}</span>
                    </div>
                    <div style={{ background: '#1a2540', borderRadius: 4, height: 8 }}>
                      <div style={{ background: C.gold, width: '100%', height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textMuted, marginBottom: 3 }}>
                      <span>Recibido banco</span><span style={{ color: C.greenLight }}>{fmt(c.rec)}</span>
                    </div>
                    <div style={{ background: '#1a2540', borderRadius: 4, height: 8 }}>
                      <div style={{ background: C.greenLight, width: c.rep > 0 ? `${Math.min(100, pct)}%` : '0%', height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>
                    {cfg.comision > 0 && (
                      <div>Comisión esperada ~{(cfg.comision*100).toFixed(1)}%: <b style={{ color: '#fca5a5' }}>−{fmt(c.comision)}</b></div>
                    )}
                    {!noReportado && (
                      <>
                        <div>Líquido esperado: <b style={{ color: C.white }}>{fmt(liquido_esperado)}</b></div>
                        <div>Gap: <b style={{ color: Math.abs(diff) < 100 ? C.greenLight : (diff < 0 ? '#f87171' : C.gold) }}>{diff >= 0 ? '+' : ''}{fmt(diff)}</b></div>
                      </>
                    )}
                    {noReportado && (
                      <div style={{ color: '#a78bfa' }}>ℹ️ No reportado en POS Quanto — flujo de banco directo</div>
                    )}
                    {/* Source badge */}
                    {c.source && (
                      <div style={{ marginTop: 4, fontSize: 9 }}>
                        Fuente: <span style={{
                          padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                          background: c.source === 'oficial' ? '#065f4622' : '#37415122',
                          color: c.source === 'oficial' ? '#6ee7b7' : '#9ca3af',
                        }}>{c.source === 'oficial' ? '✅ oficial' : 'bank_tx'}</span>
                        {c.source === 'oficial' && c._bank > 0 && Math.abs(c._bank - c.rec) > 100 && (
                          <span style={{ color: '#fdba74' }}> · bank_tx mostraría {fmt(c._bank)} (desfase T-2)</span>
                        )}
                      </div>
                    )}
                    {key === 'tarjeta' && mesActual.sv && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed #334155' }}>
                        ✅ Validación diaria Serfinsa: {mesActual.sv.dias} días · POS reportado {fmt(mesActual.sv.reportado)} · diff {mesActual.sv.diff >= 0 ? '+' : ''}{fmt(mesActual.sv.diff)}
                      </div>
                    )}
                    {key === 'efectivo' && mesActual.dp && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed #334155' }}>
                        📋 {mesActual.dp.n} depósitos · esperado {fmt(mesActual.dp.esperado)} · real {fmt(mesActual.dp.monto)}
                      </div>
                    )}
                    {key === 'peya' && mesActual.peyaLiq && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed #334155' }}>
                        📧 {mesActual.peyaLiq.n} liquidaciones de correos PedidosYa
                      </div>
                    )}
                    {key === 'efectivo' && c.rep > c.rec * 1.1 && (
                      <div style={{ marginTop: 4, color: '#fdba74' }}>
                        💸 Efectivo no depositado: <b>{fmt(c.rep - c.rec)}</b> (gastos cierre, viáticos, bóveda)
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 14, padding: 12, background: '#0d1424', borderRadius: 6, borderLeft: `3px solid ${mesActual.cobertura >= 90 ? C.greenLight : mesActual.cobertura >= 70 ? C.gold : '#f87171'}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase' }}>Conclusión {formatMonth(mesActual.mes)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, fontSize: 12 }}>
              <div><span style={{ color: C.textMuted }}>Total reportado POS:</span> <b style={{ color: C.gold }}>{fmt(mesActual.totalRep)}</b></div>
              <div><span style={{ color: C.textMuted }}>Total recibido banco:</span> <b style={{ color: C.greenLight }}>{fmt(mesActual.totalRec)}</b></div>
              <div><span style={{ color: C.textMuted }}>% Cobertura efectiva:</span> <b style={{ color: mesActual.cobertura >= 90 ? C.greenLight : mesActual.cobertura >= 70 ? C.gold : '#f87171' }}>{mesActual.cobertura.toFixed(1)}%</b></div>
              <div><span style={{ color: C.textMuted }}>Gap total:</span> <b style={{ color: mesActual.gap >= 0 ? '#fdba74' : C.greenLight }}>{mesActual.gap >= 0 ? '+' : ''}{fmt(mesActual.gap)}</b></div>
            </div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6, fontStyle: 'italic' }}>
              💡 Gap normal ~3-15% (comisiones POS + efectivo en bóveda + retraso liquidación). Si {'>'}25%: revisar canales individuales arriba.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  TAB BANCO — Vista del estado de cuenta BAC integrada (F7)
// ══════════════════════════════════════════════════════

const ESTADO_CHIP = {
  sin_clasificar: { bg: '#7f1d1d22', color: '#fca5a5', label: 'Sin clasif' },
  auto_match: { bg: '#065f4622', color: '#6ee7b7', label: 'Auto' },
  match_manual: { bg: '#1e40af22', color: '#93c5fd', label: 'Manual' },
  movimiento_socio: { bg: '#5b21b622', color: '#c4b5fd', label: 'Socio' },
  comision_bancaria: { bg: '#92400e22', color: '#fcd34d', label: 'Comisión' },
  transferencia_interna: { bg: '#37415122', color: '#d1d5db', label: 'Interna' },
  sin_dte: { bg: '#9a341222', color: '#fdba74', label: 'Sin DTE' },
  ignorar: { bg: '#37415122', color: '#9ca3af', label: 'Ignorar' },
}

// OLA 4 REFACTOR: TabBanco ahora usa bancoMV (mv_finanzas_banco_mensual) pre-agregada
// en lugar de bankTx raw. El detalle Top-10 se omite (no disponible sin rows individuales)
// para mantener el resumen mensual operativo sin paginacion.
function TabBanco({ bancoMV, bankSaldos, months2026 }) {
  const [filtroMes, setFiltroMes] = useState('') // '' = último mes con data

  const data = useMemo(() => {
    if (!bancoMV || bancoMV.length === 0) return null
    // Agregar bancoMV por mes (colapsar estados y codigos en un resumen por mes)
    const byMonth = {}
    bancoMV.forEach(row => {
      const m = row.mes?.substring(0, 7)
      if (!m) return
      if (!byMonth[m]) byMonth[m] = {
        mes: m, n: 0, ingresos: 0, egresos: 0, balance_final: 0,
        matched: 0, sin_clasif: 0, by_estado: {},
      }
      byMonth[m].n += (parseInt(row.num_tx) || 0)
      byMonth[m].ingresos += parseFloat(row.total_credito) || 0
      byMonth[m].egresos += parseFloat(row.total_debito) || 0
      // Saldo: tomar el máximo balance del mes (mejor aproximación al saldo final)
      const bal = parseFloat(row.balance_max) || 0
      if (bal > byMonth[m].balance_final) byMonth[m].balance_final = bal
      // Acumular por estado
      const est = row.estado || 'sin_clasificar'
      byMonth[m].by_estado[est] = (byMonth[m].by_estado[est] || 0) + (parseInt(row.num_tx) || 0)
      if (est === 'sin_clasificar') byMonth[m].sin_clasif += (parseInt(row.num_tx) || 0)
      else if (['auto_match', 'match_manual'].includes(est)) byMonth[m].matched += (parseInt(row.num_tx) || 0)
    })
    Object.values(byMonth).forEach(m => {
      m.pct_clasif = m.n > 0 ? (1 - m.sin_clasif / m.n) * 100 : 0
      m.neto = m.ingresos - m.egresos
    })
    const meses = Object.values(byMonth).sort((a, b) => a.mes.localeCompare(b.mes))
    const ultimoMes = meses[meses.length - 1]
    return { meses, ultimoMes }
  }, [bancoMV])

  if (!bancoMV || bancoMV.length === 0) {
    return (
      <div style={sCard}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏦</div>
          <div style={{ fontSize: 14, color: C.textMuted }}>No hay datos del banco cargados aún.</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Importa el estado de cuenta BAC desde el módulo BancoView.</div>
        </div>
      </div>
    )
  }

  const mesActual = filtroMes
    ? data.meses.find(m => m.mes === filtroMes)
    : data.ultimoMes

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>🏦 Bancos Freakie Dogs (Multi-cuenta)</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Estado de cuenta consolidado · BAC operativa + Agrícola cobranza</div>
        </div>
        <a href="?ver=banco" style={{
          padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.blue}`,
          background: 'rgba(96,165,250,0.15)', color: C.blue, fontWeight: 700, fontSize: 12,
          textDecoration: 'none',
        }}>Abrir BancoView →</a>
      </div>

      {/* Saldos por cuenta + consolidado (F8) */}
      {bankSaldos && bankSaldos.length > 0 && (() => {
        const saldoTotal = bankSaldos.reduce((s, c) => s + (parseFloat(c.saldo_actual) || 0), 0)
        return (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${bankSaldos.length + 1}, 1fr)`, gap: 8, marginBottom: 12 }}>
            {bankSaldos.map(c => (
              <div key={c.cuenta_id} style={{ background: '#0f1828', borderRadius: 8, padding: 10, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase' }}>
                  🏦 {c.banco} · {c.alias}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.white, marginTop: 2 }}>{fmt(c.saldo_actual)}</div>
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                  {c.total_tx} tx · {c.tx_ultimos_30d} en últimos 30d
                  {c.numero_cuenta === 'PENDIENTE_CONFIRMAR' && <span style={{ color: '#fdba74' }}> · ⚠️ # cuenta sin confirmar</span>}
                </div>
              </div>
            ))}
            <div style={{ background: 'rgba(96,165,250,0.10)', borderRadius: 8, padding: 10, border: `2px solid ${C.blue}` }}>
              <div style={{ fontSize: 10, color: C.blue, fontWeight: 700, textTransform: 'uppercase' }}>💰 Saldo Total Consolidado</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.blue, marginTop: 2 }}>{fmt(saldoTotal)}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{bankSaldos.length} cuentas activas</div>
            </div>
          </div>
        )
      })()}

      {/* KPIs operación banco (todas las cuentas) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCardBanco label="Ingresos último mes" value={fmt(data.ultimoMes?.ingresos || 0)} sub={`${data.ultimoMes?.n || 0} transacciones`} color={C.greenLight} />
        <KpiCardBanco label="Egresos último mes" value={fmt(data.ultimoMes?.egresos || 0)} sub={data.ultimoMes ? `Neto ${data.ultimoMes.neto >= 0 ? '+' : ''}${fmt(data.ultimoMes.neto)}` : '—'} color={C.red} />
        <KpiCardBanco label="Cobertura matching" value={`${(data.ultimoMes?.pct_clasif || 0).toFixed(1)}%`} sub={`${data.ultimoMes?.sin_clasif || 0} sin clasificar`} color={(data.ultimoMes?.pct_clasif || 0) >= 80 ? C.greenLight : C.gold} />
      </div>

      {/* Tabla mensual */}
      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 8 }}>Resumen mensual</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 600 }}>
            <thead><tr style={{ borderBottom: `2px solid ${C.red}` }}>
              <th style={{ ...sTh, textAlign: 'left' }}>Mes</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Tx</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Ingresos</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Egresos</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Neto</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Saldo aprox.</th>
              <th style={{ ...sTh, textAlign: 'right' }}>% matched</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Sin clasif</th>
            </tr></thead>
            <tbody>
              {data.meses.map(m => {
                const isSelected = m.mes === (filtroMes || data.ultimoMes?.mes)
                return (
                  <tr key={m.mes} onClick={() => setFiltroMes(m.mes)} style={{
                    borderBottom: '1px solid #2a3340', cursor: 'pointer',
                    background: isSelected ? 'rgba(96,165,250,0.08)' : 'transparent',
                  }}>
                    <td style={{ ...sTdL, fontWeight: 700, color: isSelected ? C.blue : C.white }}>{formatMonth(m.mes)}</td>
                    <td style={{ ...sTd(), textAlign: 'right' }}>{m.n}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: C.greenLight }}>{fmt(m.ingresos)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: '#fca5a5' }}>{fmt(m.egresos)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', fontWeight: 700, color: m.neto >= 0 ? C.greenLight : '#f87171' }}>
                      {m.neto >= 0 ? '+' : ''}{fmt(m.neto)}
                    </td>
                    <td style={{ ...sTd(), textAlign: 'right', fontWeight: 700, color: C.white }}>{fmt(m.balance_final)}</td>
                    <td style={{ ...sTd(), textAlign: 'right', color: m.pct_clasif >= 80 ? C.greenLight : m.pct_clasif >= 60 ? C.gold : '#f87171' }}>
                      {m.pct_clasif.toFixed(1)}%
                    </td>
                    <td style={{ ...sTd(), textAlign: 'right', color: C.textMuted }}>{m.sin_clasif}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6, fontStyle: 'italic' }}>
          💡 Datos desde mv_finanzas_banco_mensual (pre-agregada). Para ver transacciones individuales, usar BancoView.
        </div>
      </div>

      {/* Cuadre Banco vs P&L del mes seleccionado */}
      {mesActual && (() => {
        const m26 = months2026?.find(x => x.key === mesActual.mes)
        if (!m26) return null
        const gastoPL = (m26.pl?.costo_comida || 0) + (m26.pl?.insumo_venta || 0) + (m26.pl?.limpieza || 0) +
                      (m26.pl?.costo_fijo || 0) + (m26.pl?.gastos_operativos || 0) + (m26.pl?.gastos_logisticos || 0) +
                      (m26.pl?.gasto_financiero || 0) + (m26.pl?.planilla_legal || 0) + (m26.pl?.impuestos || 0) +
                      (m26.pl?.activo_fijo || 0)
        const diff = mesActual.egresos - gastoPL
        const pctDiff = gastoPL > 0 ? (diff / gastoPL) * 100 : 0
        return (
          <div style={{ ...sCard, marginTop: 16, borderLeft: `3px solid ${Math.abs(pctDiff) < 10 ? C.greenLight : C.gold}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 4, textTransform: 'uppercase' }}>Cuadre Banco vs P&L — {formatMonth(mesActual.mes)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: 12 }}>
              <div><span style={{ color: C.textMuted }}>Egresos banco:</span> <b style={{ color: C.white }}>{fmt(mesActual.egresos)}</b></div>
              <div><span style={{ color: C.textMuted }}>Gastos P&L (incl CapEx):</span> <b style={{ color: C.white }}>{fmt(gastoPL)}</b></div>
              <div><span style={{ color: C.textMuted }}>Diferencia:</span> <b style={{ color: Math.abs(pctDiff) < 10 ? C.greenLight : C.gold }}>{diff >= 0 ? '+' : ''}{fmt(diff)} ({pctDiff >= 0 ? '+' : ''}{pctDiff.toFixed(1)}%)</b></div>
            </div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, fontStyle: 'italic' }}>
              Distribución por estado este mes: {Object.entries(mesActual.by_estado).map(([est, n]) => {
                const chip = ESTADO_CHIP[est] || { label: est }
                return `${chip.label} (${n})`
              }).join(' · ')}
            </div>
          </div>
        )
      })()}
    </div>
  )
}


function KpiCardBanco({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, borderRadius: 8, padding: 12, border: `1px solid ${color}33` }}>
      <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function fmtDateBank(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })
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
      <ErrorBoundary>
        <Suspense fallback={null}>
          <CashFlowNeto />
        </Suspense>
      </ErrorBoundary>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.red, letterSpacing: 2 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.white, marginTop: 2 }}>Estado de Flujo de Caja <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 400 }}>(método indirecto · estimado)</span></div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Método indirecto · Ago 2025 — Abr 2026</div>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '75vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 650 }}>
          <thead style={{ position: 'sticky', top: 0, background: C.card, zIndex: 3 }}>
            <tr style={{ borderBottom: `2px solid ${C.gold}` }}>
              <th style={{ ...sTh, textAlign: 'left', color: C.white, background: C.card }}>Concepto</th>
              {allMonths.map((m, i) => (
                <th key={i} style={{ ...sTh, fontSize: 10, color: m.is2026 ? C.blue : C.gold, background: C.card }}>{m.label}</th>
              ))}
              <th style={{ ...sTh, color: C.red, background: C.card }}>Total</th>
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
  gastos_logisticos: '🚛 Gastos Logísticos',
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
  gastos_logisticos: '#f59e0b',
  gasto_financiero: '#f87171',
  planilla_legal: '#60a5fa',
  activo_fijo: '#6b7280',
  impuestos: '#fbbf24',
}

function TabProveedores({ data2026, months2026, conIva }) {
  const [collapsedCats, setCollapsedCats] = useState({})
  const [collapsedSubs, setCollapsedSubs] = useState({})

  const result = useMemo(() => {
    if (!data2026?.gastos) return { categories: {}, monthKeys: [], ventasPorMes: {} }

    const allKeys = [...new Set(data2026.gastos.map(g => g.fecha?.substring(0, 7)).filter(Boolean))].sort()
    const monthKeys = allKeys.slice(-6)

    const ventasPorMes = {}
    months2026.forEach(m => { ventasPorMes[m.key] = m.ventas })

    // Build provider data from gastos consolidados (ya clasificados)
    // FIX 17-Abr-2026: clasificar cada LÍNEA individualmente (antes fijaba cat del primer registro
    // del proveedor, causando desviación vs TabDashboard). Key compuesta name::cat permite que un
    // mismo proveedor aparezca bajo 2+ categorías si tiene gastos multi-categoría.
    const provData = {}
    data2026.gastos.forEach(g => {
      const m = g.fecha?.substring(0, 7)
      if (!m || !monthKeys.includes(m)) return
      const name = g.proveedor_nombre || 'Sin nombre'
      const monto = conIva ? (parseFloat(g.monto) || 0) : (parseFloat(g.monto_sin_iva) || parseFloat(g.monto) || 0)
      const catNombre = g.categoria_nombre || ''
      let cat = CATNAME_TO_PL[catNombre] || GRUPO_TO_PL[g.categoria_grupo] || catNombre || 'gastos_operativos'
      if (cat === 'Alquiler') cat = 'costo_fijo'
      const key = `${name}::${cat}`
      if (!provData[key]) {
        provData[key] = { name, cat, catDisplay: catNombre, sub: g.subcategoria_contable || 'Varios', months: {}, total: 0, origen: g.origen }
      }
      provData[key].months[m] = (provData[key].months[m] || 0) + monto
      provData[key].total += monto
    })

    // Group by category, then by subcategory within each
    const categories = {}
    Object.values(provData).forEach((d) => {
      if (!categories[d.cat]) categories[d.cat] = { subgroups: {}, totals: {}, grandTotal: 0, provCount: 0 }
      const cat = categories[d.cat]
      const subKey = d.sub || 'Varios'
      if (!cat.subgroups[subKey]) cat.subgroups[subKey] = { providers: [], totals: {}, grandTotal: 0 }
      const sg = cat.subgroups[subKey]
      sg.providers.push({ ...d })
      monthKeys.forEach(mk => {
        cat.totals[mk] = (cat.totals[mk] || 0) + (d.months[mk] || 0)
        sg.totals[mk] = (sg.totals[mk] || 0) + (d.months[mk] || 0)
      })
      cat.grandTotal += d.total
      sg.grandTotal += d.total
      cat.provCount++
    })

    // Sort providers within each subgroup by total desc, sort subgroups by total desc
    Object.values(categories).forEach(cat => {
      Object.values(cat.subgroups).forEach(sg => {
        sg.providers.sort((a, b) => b.total - a.total)
      })
      cat.sortedSubs = Object.entries(cat.subgroups).sort((a, b) => b[1].grandTotal - a[1].grandTotal)
    })

    return { categories, monthKeys, ventasPorMes }
  }, [data2026, months2026])

  const { categories, monthKeys, ventasPorMes } = result
  const totalVentas6m = monthKeys.reduce((s, k) => s + (ventasPorMes[k] || 0), 0)

  const sortedCats = Object.entries(categories).sort((a, b) => b[1].grandTotal - a[1].grandTotal)

  const grandTotal = sortedCats.reduce((s, [, c]) => s + c.grandTotal, 0)
  const grandByMonth = {}
  monthKeys.forEach(mk => {
    grandByMonth[mk] = sortedCats.reduce((s, [, c]) => s + (c.totals[mk] || 0), 0)
  })

  const toggleCat = (cat) => setCollapsedCats(prev => ({ ...prev, [cat]: !prev[cat] }))
  const toggleSub = (key) => setCollapsedSubs(prev => ({ ...prev, [key]: !prev[key] }))

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

        <div style={{ overflowX: 'auto', maxHeight: '75vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead style={{ position: 'sticky', top: 0, background: C.card, zIndex: 3 }}>
              <tr>
                <th style={{ ...sTh, textAlign: 'left', minWidth: 220, position: 'sticky', left: 0, background: C.card, zIndex: 4 }}>Categoría / Proveedor</th>
                {monthKeys.map(mk => (
                  <th key={mk} colSpan={2} style={{ ...sTh, textAlign: 'center', borderLeft: `1px solid ${C.border}`, background: C.card }}>
                    {formatMonth(mk)}
                  </th>
                ))}
                <th colSpan={2} style={{ ...sTh, textAlign: 'center', borderLeft: `2px solid ${C.gold}`, background: 'rgba(244,162,97,0.15)' }}>
                  TOTAL
                </th>
              </tr>
              <tr>
                <th style={{ ...sTh, borderBottom: `2px solid ${C.border}`, position: 'sticky', left: 0, background: C.card, zIndex: 4 }}></th>
                {monthKeys.map(mk => (
                  <React.Fragment key={mk}>
                    <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}`, background: C.card }}>$</th>
                    <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, color: C.textMuted, background: C.card }}>%</th>
                  </React.Fragment>
                ))}
                <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, borderLeft: `2px solid ${C.gold}`, background: C.card }}>$</th>
                <th style={{ ...sTh, fontSize: 9, borderBottom: `2px solid ${C.border}`, color: C.textMuted, background: C.card }}>%</th>
              </tr>
            </thead>
            <tbody>
              {sortedCats.map(([catKey, catData]) => {
                const isCatOpen = !collapsedCats[catKey]
                const catColor = CAT_COLORS[catKey] || C.textMuted
                return (
                  <React.Fragment key={catKey}>
                    {/* ── Category header row ── */}
                    <tr
                      onClick={() => toggleCat(catKey)}
                      style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }}
                    >
                      <td style={{ padding: '8px 6px', fontWeight: 700, color: C.white, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ display: 'inline-block', width: 8, marginRight: 6, fontSize: 9, color: C.textMuted }}>{isCatOpen ? '▼' : '▶'}</span>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: catColor, marginRight: 6 }}></span>
                        {CAT_LABELS[catKey] || catKey}
                        <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 6 }}>({catData.provCount})</span>
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
                    {/* ── Subcategory groups ── */}
                    {isCatOpen && catData.sortedSubs?.map(([subKey, sg]) => {
                      const subId = `${catKey}::${subKey}`
                      const isSubOpen = !collapsedSubs[subId]
                      return (
                        <React.Fragment key={subKey}>
                          {/* Subcategory header with totals */}
                          <tr
                            onClick={() => toggleSub(subId)}
                            style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.04)' }}
                          >
                            <td style={{ padding: '5px 6px 5px 20px', fontSize: 10, fontWeight: 700, color: catColor, letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>
                              <span style={{ display: 'inline-block', width: 8, marginRight: 4, fontSize: 8, color: C.textMuted }}>{isSubOpen ? '▾' : '▸'}</span>
                              {subKey} <span style={{ color: C.textMuted, fontWeight: 400 }}>({sg.providers.length})</span>
                            </td>
                            {monthKeys.map(mk => {
                              const v = sg.totals[mk] || 0
                              const pctV = ventasPorMes[mk] ? (v / ventasPorMes[mk]) * 100 : 0
                              return (
                                <React.Fragment key={mk}>
                                  <td style={{ padding: '5px 4px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: C.white, fontFamily: 'monospace', borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                                    {v > 0 ? fmtShort(v) : '—'}
                                  </td>
                                  <td style={{ padding: '5px 3px', textAlign: 'right', fontSize: 9, color: C.textMuted, fontFamily: 'monospace', borderBottom: `1px solid ${C.border}` }}>
                                    {v > 0 ? pctV.toFixed(1) + '%' : ''}
                                  </td>
                                </React.Fragment>
                              )
                            })}
                            <td style={{ padding: '5px 4px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: C.white, fontFamily: 'monospace', borderBottom: `1px solid ${C.border}`, borderLeft: `2px solid ${C.gold}`, background: 'rgba(244,162,97,0.03)' }}>
                              {fmt(sg.grandTotal)}
                            </td>
                            <td style={{ padding: '5px 3px', textAlign: 'right', fontSize: 9, color: C.textMuted, fontFamily: 'monospace', borderBottom: `1px solid ${C.border}`, background: 'rgba(244,162,97,0.03)' }}>
                              {totalVentas6m ? ((sg.grandTotal / totalVentas6m) * 100).toFixed(1) + '%' : ''}
                            </td>
                          </tr>
                          {/* Provider rows */}
                          {isSubOpen && sg.providers.map((prov, pi) => (
                            <tr key={pi} style={{ background: pi % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                              <td style={{ padding: '4px 6px 4px 36px', fontSize: 10, color: C.textMuted, borderBottom: `1px solid rgba(51,65,85,0.4)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}
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
//  TAB 6: CATÁLOGO CONTABLE (Admin CRUD)
// ══════════════════════════════════════════════════════

const CATEGORIAS_OPCIONES = [
  'costo_comida', 'insumo_venta', 'limpieza', 'costo_fijo',
  'gastos_operativos', 'gastos_logisticos', 'gasto_financiero',
  'activo_fijo', 'impuestos', 'planilla_legal',
]

function TabCatalogo({ user, data2026, onRefresh }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [editing, setEditing] = useState(null) // id of entry being edited
  const [editForm, setEditForm] = useState({})
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState({ nombre_dte: '', nombre_normalizado: '', categoria: 'gastos_operativos', subcategoria: 'Varios', notas: '', requiere_recepcion: true })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [showUnmatched, setShowUnmatched] = useState(false)

  const showMsg = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  // Load catalog
  const loadCatalog = async () => {
    setLoading(true)
    const { data, error } = await db.from('catalogo_contable')
      .select('id,nombre_dte,nombre_normalizado,categoria,subcategoria,activo,notas,requiere_recepcion')
      .order('categoria')
      .order('subcategoria')
      .order('nombre_normalizado')
    if (error) { showMsg('Error cargando catálogo: ' + error.message, 'error'); setLoading(false); return }
    setEntries(data || [])
    setLoading(false)
  }

  useEffect(() => { loadCatalog() }, [])

  // Unmatched providers (in gastos consolidados but not in catalog)
  const unmatched = useMemo(() => {
    if (!data2026?.gastos || !entries.length) return []
    const provTotals = {}
    data2026.gastos.filter(g => g.origen === 'compras_dte').forEach(g => {
      const name = g.proveedor_nombre || ''
      const inCatalog = entries.some(e => e.activo && (e.nombre_dte === name || name.toUpperCase().includes((e.nombre_normalizado || '').toUpperCase())))
      if (!inCatalog) {
        if (!provTotals[name]) provTotals[name] = { nombre: name, count: 0, total: 0 }
        provTotals[name].count++
        provTotals[name].total += parseFloat(g.monto_sin_iva) || parseFloat(g.monto) || 0
      }
    })
    return Object.values(provTotals).sort((a, b) => b.total - a.total)
  }, [data2026, entries])

  // Save edit
  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await db.from('catalogo_contable')
      .update({
        nombre_normalizado: editForm.nombre_normalizado,
        categoria: editForm.categoria,
        subcategoria: editForm.subcategoria,
        notas: editForm.notas,
        activo: editForm.activo,
        requiere_recepcion: editForm.requiere_recepcion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editing)
    setSaving(false)
    if (error) { showMsg('Error: ' + error.message, 'error'); return }
    showMsg('Proveedor actualizado')
    setEditing(null)
    await loadCatalog()
    if (onRefresh) onRefresh()
  }

  // Add new
  const saveNew = async () => {
    if (!newForm.nombre_dte.trim() || !newForm.nombre_normalizado.trim()) {
      showMsg('Nombre DTE y normalizado son obligatorios', 'error'); return
    }
    setSaving(true)
    const { error } = await db.from('catalogo_contable').insert({
      nombre_dte: newForm.nombre_dte.trim(),
      nombre_normalizado: newForm.nombre_normalizado.trim(),
      categoria: newForm.categoria,
      subcategoria: newForm.subcategoria || 'Varios',
      notas: newForm.notas,
      requiere_recepcion: newForm.requiere_recepcion,
      activo: true,
    })
    setSaving(false)
    if (error) { showMsg('Error: ' + error.message, 'error'); return }
    showMsg('Proveedor agregado al catálogo')
    setAdding(false)
    setNewForm({ nombre_dte: '', nombre_normalizado: '', categoria: 'gastos_operativos', subcategoria: 'Varios', notas: '', requiere_recepcion: true })
    await loadCatalog()
    if (onRefresh) onRefresh()
  }

  // Quick add from unmatched
  const quickAdd = (nombre) => {
    const words = nombre.split(/\s+/).slice(0, 3).join(' ')
    setNewForm({ nombre_dte: nombre, nombre_normalizado: words, categoria: 'gastos_operativos', subcategoria: 'Varios', notas: '', requiere_recepcion: true })
    setAdding(true)
    setShowUnmatched(false)
  }

  // Toggle activo
  const toggleActivo = async (id, current) => {
    await db.from('catalogo_contable').update({ activo: !current, updated_at: new Date().toISOString() }).eq('id', id)
    showMsg(current ? 'Desactivado' : 'Activado')
    loadCatalog()
  }

  // Filter
  const filtered = entries.filter(e => {
    if (filterCat && e.categoria !== filterCat) return false
    if (search) {
      const s = search.toLowerCase()
      return (e.nombre_dte || '').toLowerCase().includes(s) ||
        (e.nombre_normalizado || '').toLowerCase().includes(s) ||
        (e.subcategoria || '').toLowerCase().includes(s) ||
        (e.notas || '').toLowerCase().includes(s)
    }
    return true
  })

  const sInput = { padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.dark, color: C.white, fontSize: 12, width: '100%' }
  const sSelect = { ...sInput, cursor: 'pointer' }
  const sBtn = (bg) => ({ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: bg || C.red, color: C.white })

  // Get unique subcategories for a category (for autocomplete suggestions)
  const getSubcats = (cat) => {
    const subs = [...new Set(entries.filter(e => e.categoria === cat).map(e => e.subcategoria))]
    return subs.sort()
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.tipo === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: toast.tipo === 'error' ? '#991B1B' : '#065F46',
          border: `1px solid ${toast.tipo === 'error' ? '#FCA5A5' : '#6EE7B7'}`,
          borderRadius: 10, padding: '12px 20px', fontWeight: 600, fontSize: 13,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>{toast.msg}</div>
      )}

      {/* Header + Actions */}
      <div style={sCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ ...sH, marginBottom: 4 }}>CATÁLOGO CONTABLE</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>
              {entries.filter(e => e.activo).length} proveedores activos · {entries.filter(e => !e.activo).length} inactivos
              {unmatched.length > 0 && <span style={{ color: C.gold }}> · {unmatched.length} sin mapear en DTEs 2026</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setAdding(!adding)} style={sBtn(adding ? C.gray : C.red)}>
              {adding ? '✕ Cancelar' : '+ Agregar'}
            </button>
            <button onClick={() => setShowUnmatched(!showUnmatched)} style={sBtn(showUnmatched ? C.gray : C.gold)}>
              {showUnmatched ? '✕ Cerrar' : `🔍 Sin mapear (${unmatched.length})`}
            </button>
          </div>
        </div>

        {/* Search + Filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar proveedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...sInput, maxWidth: 280 }}
          />
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...sSelect, maxWidth: 200 }}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS_OPCIONES.map(c => (
              <option key={c} value={c}>{CAT_LABELS[c] || c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Add New Form */}
      {adding && (
        <div style={{ ...sCard, border: `2px solid ${C.red}`, background: 'rgba(230,57,70,0.05)' }}>
          <div style={{ ...sH, color: C.red, marginBottom: 10 }}>AGREGAR PROVEEDOR AL CATÁLOGO</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 2 }}>Nombre DTE (exacto)</label>
              <input value={newForm.nombre_dte} onChange={e => setNewForm(p => ({ ...p, nombre_dte: e.target.value }))} style={sInput} placeholder="EMPRESA S.A. DE C.V." />
            </div>
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 2 }}>Nombre Normalizado (para matching)</label>
              <input value={newForm.nombre_normalizado} onChange={e => setNewForm(p => ({ ...p, nombre_normalizado: e.target.value }))} style={sInput} placeholder="EMPRESA" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 2 }}>Categoría</label>
              <select value={newForm.categoria} onChange={e => setNewForm(p => ({ ...p, categoria: e.target.value }))} style={sSelect}>
                {CATEGORIAS_OPCIONES.map(c => <option key={c} value={c}>{CAT_LABELS[c] || c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 2 }}>Subcategoría</label>
              <input value={newForm.subcategoria} onChange={e => setNewForm(p => ({ ...p, subcategoria: e.target.value }))} style={sInput} placeholder="Varios" list="subcats-new" />
              <datalist id="subcats-new">
                {getSubcats(newForm.categoria).map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 2 }}>Notas</label>
            <input value={newForm.notas} onChange={e => setNewForm(p => ({ ...p, notas: e.target.value }))} style={sInput} placeholder="Opcional..." />
          </div>
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(244,162,97,0.08)', border: `1px solid ${C.gold}`, borderRadius: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: C.white, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={newForm.requiere_recepcion}
                onChange={e => setNewForm(p => ({ ...p, requiere_recepcion: e.target.checked }))}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.red }}
              />
              ¿Requiere recepción física?
            </label>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, marginLeft: 24 }}>
              ✅ <b>Marcado</b> (default): el DTE necesita recepción física en el almacén (insumos, productos tangibles).
              <br />
              ⛔ <b>Desmarcado</b>: gasto sin recepción (servicios, alquileres, comisiones, transferencias, intangibles).
            </div>
          </div>
          <button onClick={saveNew} disabled={saving} style={{ ...sBtn(C.red), opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Guardando...' : '💾 Guardar'}
          </button>
        </div>
      )}

      {/* Unmatched Providers Panel */}
      {showUnmatched && unmatched.length > 0 && (
        <div style={{ ...sCard, border: `1px solid ${C.gold}`, background: 'rgba(244,162,97,0.05)' }}>
          <div style={{ ...sH, color: C.gold, marginBottom: 8 }}>PROVEEDORES EN DTEs 2026 SIN MAPEAR EN CATÁLOGO</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 10 }}>
            Estos proveedores aparecen en compras_dte pero no tienen match en el catálogo.
            Click en "+" para agregar rápidamente.
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {unmatched.map((u, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                <div style={{ color: C.white, flex: 1 }}>
                  {u.nombre}
                  <span style={{ color: C.textMuted, marginLeft: 8 }}>{u.count} DTEs · ${u.total.toFixed(2)}</span>
                </div>
                <button onClick={() => quickAdd(u.nombre)} style={{ ...sBtn(C.gold), padding: '3px 10px', fontSize: 11 }}>+</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Cargando catálogo...</div>
      ) : (
        <div style={{ ...sCard, padding: 8 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, padding: '0 8px' }}>
            Mostrando {filtered.length} de {entries.length} proveedores
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...sTh, textAlign: 'left', minWidth: 140 }}>Proveedor</th>
                  <th style={{ ...sTh, textAlign: 'left', minWidth: 80 }}>Normalizado</th>
                  <th style={{ ...sTh, textAlign: 'left', minWidth: 100 }}>Categoría</th>
                  <th style={{ ...sTh, textAlign: 'left', minWidth: 90 }}>Subcategoría</th>
                  <th style={{ ...sTh, textAlign: 'center', width: 60 }} title="Requiere recepción física en almacén">Rec.</th>
                  <th style={{ ...sTh, textAlign: 'center', width: 40 }}>Act.</th>
                  <th style={{ ...sTh, textAlign: 'center', width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const isEditing = editing === e.id
                  const catColor = CAT_COLORS[e.categoria] || C.gray
                  return (
                    <tr key={e.id} style={{ background: !e.activo ? 'rgba(107,114,128,0.1)' : isEditing ? 'rgba(230,57,70,0.08)' : 'transparent', opacity: e.activo ? 1 : 0.5 }}>
                      <td style={{ padding: '5px 6px', color: C.white, borderBottom: `1px solid ${C.border}` }} title={e.nombre_dte}>
                        {e.nombre_dte.length > 28 ? e.nombre_dte.substring(0, 26) + '…' : e.nombre_dte}
                      </td>
                      <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                        {isEditing ? (
                          <input value={editForm.nombre_normalizado} onChange={ev => setEditForm(p => ({ ...p, nombre_normalizado: ev.target.value }))} style={{ ...sInput, padding: '3px 6px', fontSize: 11 }} />
                        ) : (
                          <span style={{ color: C.textMuted }}>{e.nombre_normalizado}</span>
                        )}
                      </td>
                      <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                        {isEditing ? (
                          <select value={editForm.categoria} onChange={ev => setEditForm(p => ({ ...p, categoria: ev.target.value }))} style={{ ...sSelect, padding: '3px 6px', fontSize: 11 }}>
                            {CATEGORIAS_OPCIONES.map(c => <option key={c} value={c}>{CAT_LABELS[c] || c}</option>)}
                          </select>
                        ) : (
                          <span style={{ color: catColor, fontWeight: 600 }}>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 2, background: catColor, marginRight: 4 }}></span>
                            {CAT_LABELS[e.categoria]?.replace(/^[^\s]+\s/, '') || e.categoria}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                        {isEditing ? (
                          <input value={editForm.subcategoria} onChange={ev => setEditForm(p => ({ ...p, subcategoria: ev.target.value }))} style={{ ...sInput, padding: '3px 6px', fontSize: 11 }} list={`subcats-edit-${e.id}`} />
                        ) : (
                          <span style={{ color: C.textMuted }}>{e.subcategoria}</span>
                        )}
                        {isEditing && (
                          <datalist id={`subcats-edit-${e.id}`}>
                            {getSubcats(editForm.categoria).map(s => <option key={s} value={s} />)}
                          </datalist>
                        )}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
                        {isEditing ? (
                          <input
                            type="checkbox"
                            checked={!!editForm.requiere_recepcion}
                            onChange={ev => setEditForm(p => ({ ...p, requiere_recepcion: ev.target.checked }))}
                            style={{ width: 14, height: 14, cursor: 'pointer', accentColor: C.red }}
                            title="¿Requiere recepción física?"
                          />
                        ) : (
                          <span style={{ fontSize: 13 }} title={e.requiere_recepcion ? 'Requiere recepción física' : 'Sin recepción (servicio/intangible)'}>
                            {e.requiere_recepcion ? '📦' : '—'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
                        <span onClick={() => toggleActivo(e.id, e.activo)} style={{ cursor: 'pointer', fontSize: 14 }} title={e.activo ? 'Desactivar' : 'Activar'}>
                          {e.activo ? '✅' : '⛔'}
                        </span>
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'center', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <button onClick={saveEdit} disabled={saving} title="Guardar" style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: '#059669', color: '#fff' }}>💾</button>
                            <button onClick={() => setEditing(null)} title="Cancelar" style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: C.gray, color: '#fff' }}>✕</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditing(e.id); setEditForm({ nombre_normalizado: e.nombre_normalizado, categoria: e.categoria, subcategoria: e.subcategoria, notas: e.notas || '', activo: e.activo, requiere_recepcion: e.requiere_recepcion !== false }) }} title="Editar" style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: C.cardAlt, color: '#fff' }}>✏️</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

// ══════════════════════════════════════════════════════
//  TAB PEYA — Análisis PedidosYa / Delivery Hero
// ══════════════════════════════════════════════════════

// Devuelve el lunes de la semana a la que pertenece una fecha
function getMonday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  return mon.toISOString().substring(0, 10)
}

function weekLabel(mondayStr) {
  const mon = new Date(mondayStr + 'T12:00:00')
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4)
  const fmt = (d) => `${d.getDate()}/${d.getMonth() + 1}`
  return `${fmt(mon)}–${fmt(fri)}`
}

function TabPeya({ data2026, conIva, onRefresh }) {
  const emptyForm = { semana_inicio: '', semana_fin: '', fecha_deposito: '', monto_depositado: '', notas: '' }
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [viewMode, setViewMode] = useState('semanal') // 'semanal' | 'mensual'
  const [peyaView, setPeyaView] = useState('resumen') // 'resumen' | 'sucursal'

  // Autofill semana_fin cuando se ingresa semana_inicio
  function handleSemanaInicioChange(val) {
    const mon = val
    let fin = ''
    if (mon) {
      const d = new Date(mon + 'T12:00:00')
      d.setDate(d.getDate() + 4) // +4 = viernes
      fin = d.toISOString().substring(0, 10)
    }
    setForm(f => ({ ...f, semana_inicio: mon, semana_fin: fin }))
  }

  // ── Análisis plataforma PeYa (datos ricos de pedidos_peya) ──
  const plataforma = useMemo(() => {
    const orders = (data2026?.peyaOrders || []).filter(o => o.estado === 'Entregado')
    const cancelled = (data2026?.peyaOrders || []).filter(o => o.estado === 'Cancelado')
    if (!orders.length) return null

    let ventaBruta = 0, comisionTotal = 0, ingresoEstimado = 0
    let tarifaPubli = 0, descTienda = 0, canceladoMonto = 0
    const bySuc = {}

    orders.forEach(o => {
      const vb = parseFloat(o.total_pedido) || 0
      const com = parseFloat(o.comision) || 0
      const ing = parseFloat(o.ingreso_estimado) || 0
      const pub = parseFloat(o.tarifa_publicidad) || 0
      const dt  = parseFloat(o.descuento_tienda) || 0
      ventaBruta     += vb
      comisionTotal  += com
      ingresoEstimado+= ing
      tarifaPubli    += pub
      descTienda     += dt
      const sc = o.store_code || 'Otro'
      if (!bySuc[sc]) bySuc[sc] = { vb: 0, com: 0, ing: 0, pedidos: 0 }
      bySuc[sc].vb      += vb
      bySuc[sc].com     += com
      bySuc[sc].ing     += ing
      bySuc[sc].pedidos += 1
    })
    cancelled.forEach(o => { canceladoMonto += parseFloat(o.total_pedido) || 0 })

    // Precio implícito PeYa vs Quanto:
    // comision / ventaBruta = tasa comisión plataforma sobre precio PeYa
    // ingresoEstimado / ventaBruta = fracción neta recibida
    const tasaComision = ventaBruta > 0 ? comisionTotal / ventaBruta : null
    const tasaNeta     = ventaBruta > 0 ? ingresoEstimado / ventaBruta : null

    return { ventaBruta, comisionTotal, ingresoEstimado, tarifaPubli, descTienda,
             canceladoMonto, tasaComision, tasaNeta, bySuc,
             totalPedidos: orders.length, cancelados: cancelled.length }
  }, [data2026?.peyaOrders])

  // ── Procesar datos semanales ──
  const { weeks, months, sucursales } = useMemo(() => {
    if (!data2026) return { weeks: [], months: [], sucursales: {} }

    // Ventas PeYa por semana y por sucursal
    // OLA 4: ventaspeya tiene granularidad mensual (matview). Para la vista semanal,
    // usamos peyaOrders que ya tiene fecha_pedido diaria y se carga en fetches pequeños.
    const salesByWeek = {}, salesBySuc = {}
    ;(data2026.peyaOrders || []).filter(o => o.estado === 'Entregado').forEach(v => {
      const wk = getMonday((v.fecha_pedido || '').substring(0, 10))
      if (!wk) return
      const total = parseFloat(v.total_pedido) || 0
      if (!salesByWeek[wk]) salesByWeek[wk] = { ventas: 0, pedidos: 0 }
      salesByWeek[wk].ventas += total
      salesByWeek[wk].pedidos++
      const sc = v.store_code || 'Otro'
      if (!salesBySuc[sc]) salesBySuc[sc] = 0
      salesBySuc[sc] += total
    })

    // DTEs Delivery Hero por semana
    const dhByWeek = {}
    ;(data2026.dhDtes || []).forEach(d => {
      const wk = getMonday(d.fecha_emision?.substring(0, 10) || '')
      if (!wk) return
      const monto = conIva ? (parseFloat(d.monto_total) || 0) : (parseFloat(d.subtotal) || 0)
      dhByWeek[wk] = (dhByWeek[wk] || 0) + monto
    })

    // Liquidaciones por semana
    const liqByWeek = {}
    ;(data2026.peya_liq || []).forEach(l => {
      liqByWeek[l.semana_inicio] = {
        id: l.id, monto: parseFloat(l.monto_depositado) || 0,
        fecha_deposito: l.fecha_deposito, notas: l.notas,
        semana_fin: l.semana_fin,
      }
    })

    // Unir semanas
    const allWeeks = new Set([
      ...Object.keys(salesByWeek),
      ...Object.keys(dhByWeek),
      ...Object.keys(liqByWeek),
    ])
    const weeks = Array.from(allWeeks).sort().map(wk => {
      const ventas = salesByWeek[wk]?.ventas || 0
      const pedidos = salesByWeek[wk]?.pedidos || 0
      const dh = dhByWeek[wk] || 0
      const liqD = liqByWeek[wk]
      const liq = liqD?.monto || 0
      const diferencia = ventas - liq
      return { wk, ventas, pedidos, dh, liq, diferencia, liqData: liqD,
        comisionEfectiva: ventas ? dh / ventas : null,
        netRate: ventas && liq ? liq / ventas : null,
      }
    })

    // Agrupar por mes para vista mensual
    const monthMap = {}
    weeks.forEach(w => {
      const m = w.wk.substring(0, 7)
      if (!monthMap[m]) monthMap[m] = { ventas: 0, pedidos: 0, dh: 0, liq: 0, semanas: 0 }
      monthMap[m].ventas += w.ventas
      monthMap[m].pedidos += w.pedidos
      monthMap[m].dh += w.dh
      monthMap[m].liq += w.liq
      monthMap[m].semanas++
    })
    const months = Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([m, d]) => ({
      mes: m, label: formatMonth(m), ...d,
      diferencia: d.ventas - d.liq,
      comisionEfectiva: d.ventas ? d.dh / d.ventas : null,
      netRate: d.ventas && d.liq ? d.liq / d.ventas : null,
    }))

    return { weeks, months, sucursales: salesBySuc }
  }, [data2026, conIva])

  // ── Totales ──
  const totVentas = weeks.reduce((s, w) => s + w.ventas, 0)
  const totDh     = weeks.reduce((s, w) => s + w.dh, 0)
  const totLiq    = weeks.reduce((s, w) => s + w.liq, 0)
  const totSemConLiq = weeks.filter(w => w.liq > 0).length
  const totSem = weeks.length
  const comisionGlobal = totVentas ? totDh / totVentas : null
  const netGlobal = totVentas && totLiq ? totLiq / totVentas : null

  // ── Guardar liquidación ──
  async function saveLiq() {
    if (!form.semana_inicio || !form.monto_depositado) {
      setMsg({ type: 'error', text: 'Semana inicio y monto son obligatorios' }); return
    }
    setSaving(true); setMsg(null)
    try {
      const payload = {
        semana_inicio: form.semana_inicio,
        semana_fin: form.semana_fin || form.semana_inicio,
        fecha_deposito: form.fecha_deposito || null,
        monto_depositado: parseFloat(form.monto_depositado),
        notas: form.notas || null,
      }
      let err
      if (editId) {
        const r = await db.from('peya_liquidaciones').update(payload).eq('id', editId)
        err = r.error
      } else {
        const r = await db.from('peya_liquidaciones').insert(payload)
        err = r.error
      }
      if (err) throw new Error(err.message)
      setMsg({ type: 'ok', text: editId ? 'Liquidación actualizada' : 'Liquidación guardada ✓' })
      setForm(emptyForm); setEditId(null)
      onRefresh()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    }
    setSaving(false)
  }

  async function deleteLiq(id) {
    if (!confirm('¿Eliminar esta liquidación?')) return
    const { error } = await db.from('peya_liquidaciones').delete().eq('id', id)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'ok', text: 'Eliminada' }); onRefresh() }
  }

  function startEdit(w) {
    const l = w.liqData
    setEditId(l.id)
    setForm({
      semana_inicio: w.wk,
      semana_fin: l.semana_fin || '',
      fecha_deposito: l.fecha_deposito || '',
      monto_depositado: String(l.monto),
      notas: l.notas || '',
    })
  }

  const pctFmt = (n) => n == null ? <span style={{ color: C.textMuted }}>—</span> : <span style={{ color: n > 0.28 ? '#f87171' : n > 0.22 ? C.gold : '#4ade80' }}>{(n * 100).toFixed(1)}%</span>
  const sInput = { background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', color: C.white, fontSize: 12, width: '100%' }
  const sBtn = (color) => ({ padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: color, color: '#fff' })

  const rows = viewMode === 'semanal' ? weeks : months

  return (
    <div>
      {/* KPIs fila 1 — Plataforma (pedidos_peya) */}
      {plataforma && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...sH, marginBottom: 6 }}>📊 DATOS PLATAFORMA PEDIDOSYA ({plataforma.totalPedidos.toLocaleString()} entregas · {plataforma.cancelados} cancelados)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={sKPI(C.cardAlt)}>
              <div style={sH}>Venta Bruta PeYa</div>
              <div style={sVal}>{fmt(plataforma.ventaBruta)}</div>
              <div style={sSub}>Precio publicado en plataforma</div>
            </div>
            <div style={sKPI(C.cardAlt)}>
              <div style={sH}>Comisión Plataforma</div>
              <div style={{ ...sVal, color: '#f87171' }}>{fmt(plataforma.comisionTotal)}</div>
              <div style={sSub}>{plataforma.tasaComision != null ? (plataforma.tasaComision * 100).toFixed(1) + '% de venta bruta' : '—'}</div>
            </div>
            <div style={sKPI(C.cardAlt)}>
              <div style={sH}>Ingreso Estimado PeYa</div>
              <div style={{ ...sVal, color: '#4ade80' }}>{fmt(plataforma.ingresoEstimado)}</div>
              <div style={sSub}>{plataforma.tasaNeta != null ? (plataforma.tasaNeta * 100).toFixed(1) + '% net de la venta' : '—'}</div>
            </div>
            <div style={sKPI(C.cardAlt)}>
              <div style={sH}>Tarifa Publicidad</div>
              <div style={{ ...sVal, color: C.gold }}>{fmt(plataforma.tarifaPubli)}</div>
              <div style={sSub}>Ads PeYa (sobre entregados)</div>
            </div>
            <div style={sKPI(C.cardAlt)}>
              <div style={sH}>Cancelados</div>
              <div style={{ ...sVal, color: '#f87171' }}>{fmt(plataforma.canceladoMonto)}</div>
              <div style={sSub}>{plataforma.cancelados} órdenes canceladas</div>
            </div>
          </div>
          {/* Insight: brecha precio PeYa vs Quanto */}
          <div style={{ ...sCard, background: 'rgba(232,67,147,0.08)', border: '1px solid rgba(232,67,147,0.3)', marginTop: 8, marginBottom: 0, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#e84393', fontWeight: 700, marginBottom: 4 }}>💡 ANÁLISIS DE PRECIO OCULTO</div>
            <div style={{ fontSize: 12, color: C.white, lineHeight: 1.6 }}>
              PeYa cobra la comisión sobre el <strong>precio PeYa</strong> (no sobre el precio de tu menú). Si tu precio en el menú Quanto es $9 pero PeYa lo lista a $8, la comisión del {plataforma.tasaComision != null ? (plataforma.tasaComision * 100).toFixed(1) : '?'}% se aplica sobre $8 → cobran ${plataforma.tasaComision != null ? (8 * plataforma.tasaComision).toFixed(2) : '?'} en lugar de ${plataforma.tasaComision != null ? (9 * plataforma.tasaComision).toFixed(2) : '?'}.
              Tu ingreso neto real es ~<strong style={{ color: '#4ade80' }}>{plataforma.tasaNeta != null ? (plataforma.tasaNeta * 100).toFixed(1) : '?'}%</strong> del precio publicado en PeYa.
            </div>
          </div>
        </div>
      )}

      {/* KPIs fila 2 — Quanto + DH */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Ventas PeYa en Quanto</div>
          <div style={sVal}>{fmt(totVentas)}</div>
          <div style={sSub}>Quanto · {weeks.reduce((s, w) => s + w.pedidos, 0).toLocaleString()} transacciones</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Cobros DH (DTEs)</div>
          <div style={{ ...sVal, color: '#f87171' }}>{fmt(totDh)}</div>
          <div style={sSub}>{conIva ? 'Con IVA' : 'Sin IVA'} · {(data2026?.dhDtes || []).length} facturas</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Liquidado Real</div>
          <div style={{ ...sVal, color: totLiq > 0 ? '#4ade80' : C.textMuted }}>{totLiq > 0 ? fmt(totLiq) : '—'}</div>
          <div style={sSub}>{totSemConLiq}/{totSem} semanas ingresadas</div>
        </div>
        <div style={sKPI(C.cardAlt)}>
          <div style={sH}>Comisión DH / Quanto</div>
          <div style={{ ...sVal, color: comisionGlobal > 0.28 ? '#f87171' : C.gold }}>{comisionGlobal != null ? (comisionGlobal * 100).toFixed(1) + '%' : '—'}</div>
          <div style={sSub}>DTE ÷ ventas brutas Quanto</div>
        </div>
        {netGlobal != null && (
          <div style={sKPI(C.cardAlt)}>
            <div style={sH}>Net Recibido / Quanto</div>
            <div style={{ ...sVal, color: '#4ade80' }}>{(netGlobal * 100).toFixed(1)}%</div>
            <div style={sSub}>Costo real: {((1 - netGlobal) * 100).toFixed(1)}% de la venta</div>
          </div>
        )}
      </div>

      {/* Toggle vista */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {['semanal', 'mensual'].map(v => (
          <button key={v} onClick={() => setViewMode(v)} style={{ ...sBtn(viewMode === v ? C.red : C.cardAlt), textTransform: 'capitalize' }}>{v}</button>
        ))}
      </div>

      {/* Tabla semanas / meses */}
      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 8 }}>
          {viewMode === 'semanal' ? 'DETALLE SEMANAL' : 'RESUMEN MENSUAL'}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...sTh, textAlign: 'left', minWidth: 90 }}>{viewMode === 'semanal' ? 'Semana' : 'Mes'}</th>
                {viewMode === 'semanal' && <th style={sTh}># Pedidos</th>}
                <th style={sTh}>Ventas Quanto</th>
                <th style={sTh}>DTEs DH</th>
                <th style={sTh}>Comis. %</th>
                <th style={{ ...sTh, color: '#4ade80' }}>Liquidado</th>
                <th style={sTh}>Dif. (Quanto−Liq)</th>
                <th style={sTh}>Net %</th>
                {viewMode === 'semanal' && <th style={sTh}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isWeek = viewMode === 'semanal'
                const key = isWeek ? row.wk : row.mes
                const hasLiq = row.liq > 0
                return (
                  <tr key={key} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                    <td style={{ ...sTdL, fontWeight: 600 }}>
                      {isWeek ? weekLabel(row.wk) : row.label}
                      {isWeek && <div style={{ fontSize: 9, color: C.textMuted }}>{row.wk}</div>}
                    </td>
                    {isWeek && <td style={sTd(false)}>{row.pedidos.toLocaleString()}</td>}
                    <td style={sTd(false)}>{fmt(row.ventas)}</td>
                    <td style={sTd(false)}><span style={{ color: '#f87171' }}>{fmt(row.dh)}</span></td>
                    <td style={{ ...sTd(false), textAlign: 'right' }}>{pctFmt(row.comisionEfectiva)}</td>
                    <td style={{ ...sTd(false), color: hasLiq ? '#4ade80' : C.textMuted, fontWeight: hasLiq ? 600 : 400 }}>
                      {hasLiq ? fmt(row.liq) : '—'}
                      {isWeek && hasLiq && row.liqData?.fecha_deposito && (
                        <div style={{ fontSize: 9, color: C.textMuted }}>dep. {row.liqData.fecha_deposito}</div>
                      )}
                    </td>
                    <td style={sTd(row.diferencia > 0)}>
                      {hasLiq ? fmt(row.diferencia) : <span style={{ color: C.textMuted }}>—</span>}
                    </td>
                    <td style={{ ...sTd(false), textAlign: 'right' }}>{hasLiq ? pctFmt(row.netRate) : <span style={{ color: C.textMuted }}>—</span>}</td>
                    {isWeek && (
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        {hasLiq ? (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <button onClick={() => startEdit(row)} style={{ ...sBtn(C.cardAlt), padding: '3px 8px', fontSize: 11 }}>✏️</button>
                            <button onClick={() => deleteLiq(row.liqData.id)} style={{ ...sBtn('#7f1d1d'), padding: '3px 8px', fontSize: 11 }}>🗑</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditId(null); handleSemanaInicioChange(row.wk) }}
                            style={{ ...sBtn(C.cardAlt), padding: '3px 8px', fontSize: 10, opacity: 0.7 }}
                          >+ Liq</button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
              {/* Totales */}
              <tr style={{ background: 'rgba(244,162,97,0.08)', borderTop: `2px solid ${C.gold}` }}>
                <td style={{ ...sTdL, fontWeight: 700, color: C.gold }}>TOTAL</td>
                {viewMode === 'semanal' && <td style={{ ...sTd(false), fontWeight: 700 }}>{weeks.reduce((s, w) => s + w.pedidos, 0).toLocaleString()}</td>}
                <td style={{ ...sTd(false), fontWeight: 700 }}>{fmt(totVentas)}</td>
                <td style={{ ...sTd(false), fontWeight: 700, color: '#f87171' }}>{fmt(totDh)}</td>
                <td style={{ ...sTd(false), fontWeight: 700, textAlign: 'right' }}>{pctFmt(comisionGlobal)}</td>
                <td style={{ ...sTd(false), fontWeight: 700, color: '#4ade80' }}>{totLiq > 0 ? fmt(totLiq) : '—'}</td>
                <td style={{ ...sTd(false), fontWeight: 700 }}>{totLiq > 0 ? fmt(totVentas - totLiq) : '—'}</td>
                <td style={{ ...sTd(false), fontWeight: 700, textAlign: 'right' }}>{netGlobal != null ? pctFmt(netGlobal) : <span style={{ color: C.textMuted }}>—</span>}</td>
                {viewMode === 'semanal' && <td></td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Ventas por sucursal */}
      {Object.keys(sucursales).length > 0 && (
        <div style={sCard}>
          <div style={{ ...sH, marginBottom: 8 }}>VENTAS PEYA POR SUCURSAL (2026)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(sucursales).sort((a, b) => b[1] - a[1]).map(([sc, v]) => {
              const pct = totVentas ? v / totVentas : 0
              const barW = Math.max(4, pct * 100)
              return (
                <div key={sc} style={{ ...sKPI(C.cardAlt), minWidth: 140, textAlign: 'left', padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: STORE_COLORS[sc] || C.textMuted, fontWeight: 700, marginBottom: 4 }}>{STORE_MAP[sc] || sc}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.white }}>{fmt(v)}</div>
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4 }}>{(pct * 100).toFixed(1)}% del total</div>
                  <div style={{ background: C.border, borderRadius: 2, height: 4, width: '100%' }}>
                    <div style={{ background: STORE_COLORS[sc] || C.red, height: 4, borderRadius: 2, width: `${barW}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Comisión real por sucursal (pedidos_peya) */}
      {plataforma && Object.keys(plataforma.bySuc).length > 0 && (
        <div style={sCard}>
          <div style={{ ...sH, marginBottom: 8 }}>COMISIÓN REAL POR SUCURSAL (plataforma 2026)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...sTh, textAlign: 'left' }}>Sucursal</th>
                  <th style={sTh}>Pedidos</th>
                  <th style={sTh}>Venta Bruta</th>
                  <th style={{ ...sTh, color: '#f87171' }}>Comisión</th>
                  <th style={{ ...sTh, color: '#f87171' }}>% Comisión</th>
                  <th style={{ ...sTh, color: '#4ade80' }}>Ingreso Est.</th>
                  <th style={{ ...sTh, color: '#4ade80' }}>% Neto</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(plataforma.bySuc).sort((a, b) => b[1].vb - a[1].vb).map(([sc, d], i) => {
                  const tasaCom = d.vb > 0 ? d.com / d.vb : null
                  const tasaNet = d.vb > 0 ? d.ing / d.vb : null
                  return (
                    <tr key={sc} style={{ background: i % 2 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                      <td style={{ ...sTdL, color: STORE_COLORS[sc] || C.white, fontWeight: 700 }}>{STORE_MAP[sc] || sc}</td>
                      <td style={sTd(false)}>{d.pedidos.toLocaleString()}</td>
                      <td style={sTd(false)}>{fmt(d.vb)}</td>
                      <td style={{ ...sTd(false), color: '#f87171' }}>{fmt(d.com)}</td>
                      <td style={{ ...sTd(false) }}>
                        <span style={{ color: tasaCom > 0.22 ? '#f87171' : C.gold }}>
                          {tasaCom != null ? (tasaCom * 100).toFixed(1) + '%' : '—'}
                        </span>
                      </td>
                      <td style={{ ...sTd(false), color: '#4ade80' }}>{fmt(d.ing)}</td>
                      <td style={{ ...sTd(false) }}>
                        <span style={{ color: tasaNet != null && tasaNet < 0.7 ? '#f87171' : '#4ade80' }}>
                          {tasaNet != null ? (tasaNet * 100).toFixed(1) + '%' : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Formulario de liquidación */}
      <div style={sCard}>
        <div style={{ ...sH, marginBottom: 10 }}>{editId ? '✏️ EDITAR LIQUIDACIÓN' : '+ REGISTRAR LIQUIDACIÓN SEMANAL'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div>
            <div style={{ ...sH, fontSize: 10 }}>Semana inicio (lunes) *</div>
            <input type="date" style={sInput} value={form.semana_inicio}
              onChange={e => handleSemanaInicioChange(e.target.value)} />
          </div>
          <div>
            <div style={{ ...sH, fontSize: 10 }}>Semana fin (viernes)</div>
            <input type="date" style={sInput} value={form.semana_fin}
              onChange={e => setForm(f => ({ ...f, semana_fin: e.target.value }))} />
          </div>
          <div>
            <div style={{ ...sH, fontSize: 10 }}>Fecha depósito</div>
            <input type="date" style={sInput} value={form.fecha_deposito}
              onChange={e => setForm(f => ({ ...f, fecha_deposito: e.target.value }))} />
          </div>
          <div>
            <div style={{ ...sH, fontSize: 10 }}>Monto depositado ($) *</div>
            <input type="number" step="0.01" min="0" placeholder="0.00" style={sInput} value={form.monto_depositado}
              onChange={e => setForm(f => ({ ...f, monto_depositado: e.target.value }))} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <div style={{ ...sH, fontSize: 10 }}>Notas (opcional)</div>
            <input type="text" placeholder="Ej: Semana 14, depósito Promerica..." style={sInput} value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={saveLiq} disabled={saving} style={sBtn(C.red)}>
            {saving ? 'Guardando...' : editId ? '💾 Actualizar' : '💾 Guardar'}
          </button>
          {editId && (
            <button onClick={() => { setEditId(null); setForm(emptyForm) }} style={sBtn(C.gray)}>Cancelar</button>
          )}
          {msg && (
            <span style={{ fontSize: 12, color: msg.type === 'ok' ? '#4ade80' : '#f87171', marginLeft: 8 }}>{msg.text}</span>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: C.textMuted, lineHeight: 1.5 }}>
          💡 <strong style={{ color: C.white }}>¿Cómo funciona?</strong> DH deposita cada viernes la liquidación de la semana anterior (lun–vier).
          La <strong style={{ color: C.white }}>comisión real</strong> = (Ventas Quanto − Liquidado) ÷ Ventas Quanto.
          Esto incluye el descuento de precio oculto: si Quanto dice $9 pero PeYa cobra $8, la comisión se aplica sobre $8.
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════

function delta(curr, prev) {
  if (!prev || prev === 0) return ''
  const d = ((curr - prev) / prev) * 100
  return `${d >= 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(1)}%`
}
