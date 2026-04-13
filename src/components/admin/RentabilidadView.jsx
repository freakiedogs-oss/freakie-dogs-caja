import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { STORES, n } from '../../config'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmt(v) { return '$' + n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pct(a, b) { return b ? ((a / b) * 100).toFixed(1) + '%' : '-' }

function StatCard({ label, value, sub, color, small }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: small ? '8px 14px' : '12px 18px', flex: 1, minWidth: small ? 120 : 150 }}>
      <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: small ? 18 : 24, fontWeight: 800, color: color || '#111827', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

/* Mini bar component */
function Bar({ value, max, color }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${w}%`, background: color || '#3B82F6', borderRadius: 3 }} />
    </div>
  )
}

export default function RentabilidadView({ user }) {
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date(Date.now() - 6 * 3600 * 1000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [vista, setVista] = useState('resumen') // resumen | detalle
  const [datos, setDatos] = useState(null)
  const [toast, setToast] = useState(null)
  const [conIva, setConIva] = useState(false)  // false = sin IVA

  const showToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  const [year, month] = periodo.split('-').map(Number)
  const mesLabel = `${MESES[month - 1]} ${year}`
  const desde = `${periodo}-01`
  const hasta = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`

  // Paginated fetch helper (Supabase max 1000 rows)
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

  const cargarDatos = useCallback(async () => {
    setLoading(true)

    // 1. Ventas por sucursal del mes
    const { data: ventas } = await db
      .from('ventas_diarias')
      .select('store_code, total_ventas_quanto, fecha')
      .gte('fecha', desde)
      .lt('fecha', hasta)

    const ventasPorSuc = {}
    ;(ventas || []).forEach(v => {
      if (!ventasPorSuc[v.store_code]) ventasPorSuc[v.store_code] = 0
      ventasPorSuc[v.store_code] += conIva ? n(v.total_ventas_quanto) : n(v.total_ventas_quanto) / 1.13
    })

    // 2. GASTOS CONSOLIDADOS — ya clasificados vía catalogo_contable
    const gastos = await fetchAll('v_gastos_consolidados',
      'fecha, proveedor_nombre, monto, monto_sin_iva, categoria_nombre, categoria_grupo, subcategoria_contable, origen, store_code',
      q => q.gte('fecha', desde).lt('fecha', hasta))

    // Agrupar gastos por sucursal y grupo P&L (usando categoria_grupo de la vista)
    const gastosPorSucGrupo = {} // { sucursal: { grupo: monto } }
    const gastosPorCat = {} // { cat_nombre: monto } para Detalle
    const gastosPorSucCat = {} // { sucursal: { cat_nombre: monto } } para Detalle
    const catToGrupo = {} // { "Insumo Cocina": "COGS", "Alquiler": "Gasto Local", ... }
    let totalGastos = 0
    const origenStats = { compras_dte: 0, egresos_cierre: 0, descuadre: 0, compras_sin_dte: 0 }

    gastos.forEach(g => {
      const suc = g.store_code || 'CORP'
      const grupo = g.categoria_grupo || 'Gasto Venta'  // COGS, Gasto Local, Gasto Venta, Gasto Admin, Inversión
      const cat = g.categoria_nombre || 'Sin Clasificar'
      const monto = conIva ? (n(g.monto) || 0) : (n(g.monto_sin_iva) || n(g.monto) || 0)

      // Mapa categoría → grupo (de la BD)
      if (cat && grupo) catToGrupo[cat] = grupo

      // Por grupo P&L (para Resumen)
      if (!gastosPorSucGrupo[suc]) gastosPorSucGrupo[suc] = {}
      gastosPorSucGrupo[suc][grupo] = (gastosPorSucGrupo[suc][grupo] || 0) + monto

      // Por categoría detallada (para tab Detalle)
      if (!gastosPorSucCat[suc]) gastosPorSucCat[suc] = {}
      gastosPorSucCat[suc][cat] = (gastosPorSucCat[suc][cat] || 0) + monto
      gastosPorCat[cat] = (gastosPorCat[cat] || 0) + monto

      totalGastos += monto
      if (origenStats[g.origen] !== undefined) origenStats[g.origen] += monto
    })

    // Calcular gastos corporativos (sin sucursal) para prorrateo
    const gruposCorp = gastosPorSucGrupo['CORP'] || {}
    const totalVentasGlobal = Object.values(ventasPorSuc).reduce((a, b) => a + b, 0)

    // P&L por sucursal
    const sucursales = Object.keys(STORES).filter(s => s !== 'CM001')
    const pnl = {}

    sucursales.forEach(suc => {
      const ventaSuc = ventasPorSuc[suc] || 0
      const pesoVenta = totalVentasGlobal > 0 ? ventaSuc / totalVentasGlobal : 0
      const gruposSuc = gastosPorSucGrupo[suc] || {}

      // Directos de esta sucursal (categoria_grupo viene de la BD)
      let cogs       = n(gruposSuc['COGS'])
      let gastosLocales = n(gruposSuc['Gasto Local'])
      let gastosVenta   = n(gruposSuc['Gasto Venta'])
      let gastosAdmin   = n(gruposSuc['Gasto Admin'])
      let inversion     = n(gruposSuc['Inversión'])

      // Prorrateo corporativos por peso de venta
      Object.entries(gruposCorp).forEach(([grupo, monto]) => {
        const porcion = monto * pesoVenta
        if (grupo === 'COGS') cogs += porcion
        else if (grupo === 'Gasto Local') gastosLocales += porcion
        else if (grupo === 'Gasto Venta') gastosVenta += porcion
        else if (grupo === 'Gasto Admin') gastosAdmin += porcion
      })

      const utilidadBruta = ventaSuc - cogs
      const utilidadOperativa = utilidadBruta - gastosLocales - gastosVenta - gastosAdmin

      pnl[suc] = {
        venta: ventaSuc, cogs, utilidadBruta,
        margenBruto: ventaSuc > 0 ? (utilidadBruta / ventaSuc) * 100 : 0,
        gastosLocales, gastosVenta, gastosAdmin, inversion, utilidadOperativa,
        margenOperativo: ventaSuc > 0 ? (utilidadOperativa / ventaSuc) * 100 : 0
      }
    })

    setDatos({ pnl, ventasPorSuc, gastosPorCat, gastosPorSucCat, gastosPorSucGrupo, catToGrupo, totalVentasGlobal, totalGastos, origenStats, totalRegistros: gastos.length })
    setLoading(false)
  }, [desde, hasta, conIva])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // Selector de período
  const mesesDisponibles = []
  for (let y = 2024; y <= year + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      if (key <= periodo.substring(0, 7)) mesesDisponibles.push(key)
    }
  }
  mesesDisponibles.reverse()

  const sucursales = Object.keys(STORES).filter(s => s !== 'CM001')

  return (
    <div style={{ padding: '0 0 40px 0', maxWidth: 1200 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.tipo === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: toast.tipo === 'error' ? '#991B1B' : '#065F46',
          border: `1px solid ${toast.tipo === 'error' ? '#FCA5A5' : '#6EE7B7'}`,
          borderRadius: 10, padding: '12px 20px', fontWeight: 600, fontSize: 14,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>{toast.msg}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#111827' }}>
            Rentabilidad por Sucursal
          </h2>
          <p style={{ margin: '4px 0 0', color: '#6B7280', fontSize: 13 }}>
            P&L operativo · Gastos consolidados + ventas diarias
            {datos && (
              <span style={{ display: 'block', fontSize: 11, marginTop: 2, color: '#059669' }}>
                {datos.totalRegistros} registros · DTEs {fmt(datos.origenStats?.compras_dte || 0)}
                {(datos.origenStats?.egresos_cierre || 0) > 0 && ` + Egresos caja ${fmt(datos.origenStats.egresos_cierre)}`}
                {(datos.origenStats?.descuadre || 0) > 0 && ` + Descuadres ${fmt(datos.origenStats.descuadre)}`}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Toggle IVA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F3F4F6', borderRadius: 8, padding: '4px 10px' }}>
            <span style={{ fontSize: 11, color: conIva ? '#9CA3AF' : '#D97706', fontWeight: conIva ? 400 : 700 }}>Sin IVA</span>
            <div
              onClick={() => setConIva(!conIva)}
              style={{ width: 32, height: 18, borderRadius: 9, background: conIva ? '#3B82F6' : '#9CA3AF', cursor: 'pointer', position: 'relative', transition: 'background .2s' }}
            >
              <div style={{ width: 14, height: 14, borderRadius: 7, background: '#fff', position: 'absolute', top: 2, left: conIva ? 16 : 2, transition: 'left .2s' }} />
            </div>
            <span style={{ fontSize: 11, color: conIva ? '#D97706' : '#9CA3AF', fontWeight: conIva ? 700 : 400 }}>Con IVA</span>
          </div>
          <select value={periodo} onChange={e => setPeriodo(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontWeight: 600, fontSize: 14 }}>
            {mesesDisponibles.slice(0, 18).map(m => {
              const [y, mo] = m.split('-')
              return <option key={m} value={m}>{MESES[parseInt(mo) - 1]} {y}</option>
            })}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #E5E7EB' }}>
        {[
          { key: 'resumen', label: 'Resumen P&L' },
          { key: 'detalle', label: 'Detalle por Categoria' },
        ].map(t => (
          <button key={t.key} onClick={() => setVista(t.key)} style={{
            padding: '8px 20px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
            borderBottom: vista === t.key ? '3px solid #1D4ED8' : '3px solid transparent',
            color: vista === t.key ? '#1D4ED8' : '#6B7280',
            background: 'transparent', marginBottom: -2
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>Cargando datos de {mesLabel}...</div>
      ) : !datos ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>Sin datos</div>
      ) : (
        <>
          {/* ===== TAB: RESUMEN P&L ===== */}
          {vista === 'resumen' && (
            <div>
              {/* Global stats */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <StatCard label={`Ventas ${mesLabel}`} value={fmt(datos.totalVentasGlobal)} color="#059669" />
                <StatCard label="Total Gastos" value={fmt(datos.totalGastos)} color="#DC2626" />
                <StatCard label="Resultado" value={fmt(datos.totalVentasGlobal - datos.totalGastos)}
                  color={datos.totalVentasGlobal - datos.totalGastos >= 0 ? '#059669' : '#DC2626'} />
                <StatCard label="Margen" value={pct(datos.totalVentasGlobal - datos.totalGastos, datos.totalVentasGlobal)}
                  color="#1D4ED8" />
              </div>

              {/* P&L table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #E5E7EB', minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '2px solid #E5E7EB', minWidth: 160, whiteSpace: 'nowrap' }}>Concepto</th>
                      {sucursales.map(s => (
                        <th key={s} style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700, color: '#374151', borderBottom: '2px solid #E5E7EB', fontSize: 11 }}>
                          {STORES[s]}
                        </th>
                      ))}
                      <th style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, color: '#1D4ED8', borderBottom: '2px solid #E5E7EB' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Ventas */}
                    <tr style={{ background: '#ECFDF5' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: '#065F46', whiteSpace: 'nowrap' }}>Ventas</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: '#065F46', fontSize: 12 }}>
                          {fmt(datos.pnl[s]?.venta)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#065F46' }}>
                        {fmt(datos.totalVentasGlobal)}
                      </td>
                    </tr>

                    {/* COGS */}
                    <tr>
                      <td style={{ padding: '8px 12px', color: '#DC2626', whiteSpace: 'nowrap' }}>(-) Costo Insumos</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 6px', textAlign: 'right', color: '#DC2626', fontSize: 12 }}>
                          {fmt(datos.pnl[s]?.cogs)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.cogs), 0))}
                      </td>
                    </tr>

                    {/* Utilidad Bruta */}
                    <tr style={{ background: '#F0FDF4', borderTop: '2px solid #86EFAC' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}>= Utilidad Bruta</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: '#166534', fontSize: 12 }}>
                          {fmt(datos.pnl[s]?.utilidadBruta)}
                          <div style={{ fontSize: 10, color: '#6B7280' }}>{datos.pnl[s]?.margenBruto.toFixed(1)}%</div>
                        </td>
                      ))}
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#166534' }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.utilidadBruta), 0))}
                      </td>
                    </tr>

                    {/* Gastos Locales */}
                    <tr>
                      <td style={{ padding: '8px 12px', color: '#92400E', paddingLeft: 20, whiteSpace: 'nowrap' }}>Alquiler / Luz / Agua</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 10px', textAlign: 'right', color: '#92400E' }}>
                          {fmt(datos.pnl[s]?.gastosLocales)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#92400E', fontWeight: 600 }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.gastosLocales), 0))}
                      </td>
                    </tr>

                    {/* Gastos Venta */}
                    <tr>
                      <td style={{ padding: '8px 12px', color: '#92400E', paddingLeft: 20, whiteSpace: 'nowrap' }}>Gastos Venta</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 6px', textAlign: 'right', color: '#92400E', fontSize: 12 }}>
                          {fmt(datos.pnl[s]?.gastosVenta)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#92400E', fontWeight: 600 }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.gastosVenta), 0))}
                      </td>
                    </tr>

                    {/* Gastos Admin */}
                    <tr>
                      <td style={{ padding: '8px 12px', color: '#92400E', paddingLeft: 20, whiteSpace: 'nowrap' }}>Gastos Admin</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 6px', textAlign: 'right', color: '#92400E', fontSize: 12 }}>
                          {fmt(datos.pnl[s]?.gastosAdmin)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#92400E', fontWeight: 600 }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.gastosAdmin), 0))}
                      </td>
                    </tr>

                    {/* Utilidad Operativa */}
                    <tr style={{ background: '#EFF6FF', borderTop: '2px solid #93C5FD' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: '#1E40AF', whiteSpace: 'nowrap' }}>= Utilidad Operativa</td>
                      {sucursales.map(s => {
                        const uo = datos.pnl[s]?.utilidadOperativa || 0
                        return (
                          <td key={s} style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 800, color: uo >= 0 ? '#166534' : '#DC2626', fontSize: 12 }}>
                            {fmt(uo)}
                            <div style={{ fontSize: 10, color: '#6B7280' }}>{datos.pnl[s]?.margenOperativo.toFixed(1)}%</div>
                          </td>
                        )
                      })}
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, color: '#1E40AF' }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.utilidadOperativa), 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Bar chart visual */}
              <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {sucursales.map(s => {
                  const p = datos.pnl[s]
                  if (!p || !p.venta) return null
                  const maxVenta = Math.max(...sucursales.map(x => datos.pnl[x]?.venta || 0))
                  return (
                    <div key={s} style={{ flex: 1, minWidth: 140, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 8 }}>{STORES[s]}</div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Venta: {fmt(p.venta)}</div>
                      <Bar value={p.venta} max={maxVenta} color="#10B981" />
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 8, marginBottom: 4 }}>COGS: {fmt(p.cogs)} ({pct(p.cogs, p.venta)})</div>
                      <Bar value={p.cogs} max={p.venta} color="#EF4444" />
                      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800, color: p.utilidadOperativa >= 0 ? '#059669' : '#DC2626' }}>
                        UO: {fmt(p.utilidadOperativa)} ({p.margenOperativo.toFixed(1)}%)
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ===== TAB: DETALLE POR CATEGORÍA ===== */}
          {vista === 'detalle' && (() => {
            const GRUPO_COLORS = {
              COGS: '#DC2626', 'Gasto Local': '#92400E', 'Gasto Venta': '#D97706',
              'Gasto Admin': '#6B7280', 'Inversión': '#7C3AED',
            }
            const sorted = Object.entries(datos.gastosPorCat).sort((a, b) => b[1] - a[1])
            return (
              <div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #E5E7EB', minWidth: 700 }}>
                    <thead>
                      <tr style={{ background: '#F9FAFB' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid #E5E7EB', minWidth: 140 }}>Categoría</th>
                        <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid #E5E7EB', fontSize: 11 }}>Grupo</th>
                        {sucursales.map(s => (
                          <th key={s} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, borderBottom: '2px solid #E5E7EB', fontSize: 11 }}>
                            {STORES[s]}
                          </th>
                        ))}
                        <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, borderBottom: '2px solid #E5E7EB', fontSize: 11 }}>CORP</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, borderBottom: '2px solid #E5E7EB', color: '#1D4ED8' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(([catName, total]) => {
                        const grupo = datos.catToGrupo[catName] || 'Otro'
                        const color = GRUPO_COLORS[grupo] || '#374151'
                        return (
                          <tr key={catName} style={{ borderBottom: '1px solid #F3F4F6' }}>
                            <td style={{ padding: '7px 12px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                              {catName}
                            </td>
                            <td style={{ padding: '7px 6px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
                              <span style={{ background: color + '18', color, padding: '2px 6px', borderRadius: 4 }}>{grupo}</span>
                            </td>
                            {sucursales.map(s => (
                              <td key={s} style={{ padding: '7px 6px', textAlign: 'right', color: '#374151', fontSize: 12 }}>
                                {datos.gastosPorSucCat[s]?.[catName] ? fmt(datos.gastosPorSucCat[s][catName]) : <span style={{ color: '#D1D5DB' }}>—</span>}
                              </td>
                            ))}
                            <td style={{ padding: '7px 6px', textAlign: 'right', color: '#6B7280', fontSize: 12 }}>
                              {datos.gastosPorSucCat['CORP']?.[catName] ? fmt(datos.gastosPorSucCat['CORP'][catName]) : <span style={{ color: '#D1D5DB' }}>—</span>}
                            </td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#1D4ED8', fontSize: 12 }}>
                              {fmt(total)}
                            </td>
                          </tr>
                        )
                      })}
                      {/* Total row */}
                      <tr style={{ background: '#EFF6FF', borderTop: '2px solid #93C5FD' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 800 }} colSpan={2}>Total</td>
                        {sucursales.map(s => {
                          const total = Object.values(datos.gastosPorSucCat[s] || {}).reduce((a, b) => a + b, 0)
                          return (
                            <td key={s} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, fontSize: 12 }}>{total ? fmt(total) : '—'}</td>
                          )
                        })}
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, fontSize: 12 }}>
                          {fmt(Object.values(datos.gastosPorSucCat['CORP'] || {}).reduce((a, b) => a + b, 0))}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1D4ED8' }}>
                          {fmt(datos.totalGastos)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Nota explicativa */}
                <div style={{ marginTop: 12, padding: '8px 14px', background: '#F9FAFB', borderRadius: 8, fontSize: 11, color: '#6B7280' }}>
                  CORP = gastos sin sucursal asignada (se prorratean por peso de venta en el Resumen P&L).
                  Sucursal directa solo aplica a proveedores con sucursal_default en el catálogo contable.
                </div>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}

