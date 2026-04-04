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
  const [vista, setVista] = useState('resumen') // resumen | detalle | clasificar
  const [datos, setDatos] = useState(null)
  const [sinClasificar, setSinClasificar] = useState([])
  const [categorias, setCategorias] = useState([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  const [year, month] = periodo.split('-').map(Number)
  const mesLabel = `${MESES[month - 1]} ${year}`
  const desde = `${periodo}-01`
  const hasta = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const cargarDatos = useCallback(async () => {
    setLoading(true)

    // 1. Ventas por sucursal del mes
    const { data: ventas } = await db
      .from('ventas_diarias')
      .select('store_code, venta_total, fecha')
      .gte('fecha', desde)
      .lt('fecha', hasta)

    const ventasPorSuc = {}
    ;(ventas || []).forEach(v => {
      if (!ventasPorSuc[v.store_code]) ventasPorSuc[v.store_code] = 0
      ventasPorSuc[v.store_code] += n(v.venta_total)
    })

    // 2. Gastos clasificados del mes (por categoría y sucursal)
    const { data: gastos } = await db
      .from('dte_clasificacion')
      .select(`
        categoria_gasto_id, sucursal_code, monto,
        compras_dte!inner(fecha_emision)
      `)
      .gte('compras_dte.fecha_emision', desde)
      .lt('compras_dte.fecha_emision', hasta)

    // 3. Categorías
    const { data: cats } = await db
      .from('categorias_gasto')
      .select('*')
      .order('orden')
    setCategorias(cats || [])

    const catMap = {}
    ;(cats || []).forEach(c => { catMap[c.id] = c })

    // Agrupar gastos
    const gastosPorSucCat = {} // { sucursal: { categoria: monto } }
    const gastosPorCat = {} // { categoria: monto }
    let totalGastos = 0

    ;(gastos || []).forEach(g => {
      const suc = g.sucursal_code || 'CORP'
      const cat = g.categoria_gasto_id
      const monto = n(g.monto)

      if (!gastosPorSucCat[suc]) gastosPorSucCat[suc] = {}
      gastosPorSucCat[suc][cat] = (gastosPorSucCat[suc][cat] || 0) + monto
      gastosPorCat[cat] = (gastosPorCat[cat] || 0) + monto
      totalGastos += monto
    })

    // Calcular gastos corporativos (sin sucursal) para prorrateo
    const gastosCorp = gastosPorSucCat['CORP'] || {}
    const totalVentasGlobal = Object.values(ventasPorSuc).reduce((a, b) => a + b, 0)

    // P&L por sucursal
    const sucursales = Object.keys(STORES).filter(s => s !== 'CM001')
    const pnl = {}

    sucursales.forEach(suc => {
      const ventaSuc = ventasPorSuc[suc] || 0
      const pesoVenta = totalVentasGlobal > 0 ? ventaSuc / totalVentasGlobal : 0
      const gastosSuc = gastosPorSucCat[suc] || {}

      // COGS = insumos directos (asignados a suc) + prorrateo corporativos COGS
      let cogs = 0
      let gastosLocales = 0
      let gastosVenta = 0
      let gastosAdmin = 0
      let inversion = 0

      // Directos de esta sucursal
      Object.entries(gastosSuc).forEach(([catId, monto]) => {
        const cat = catMap[catId]
        if (!cat) return
        if (cat.grupo === 'COGS') cogs += monto
        else if (cat.grupo === 'Gasto Local') gastosLocales += monto
        else if (cat.grupo === 'Gasto Venta') gastosVenta += monto
        else if (cat.grupo === 'Gasto Admin') gastosAdmin += monto
        else if (cat.grupo === 'Inversión') inversion += monto
      })

      // Prorrateo corporativos (COGS sin sucursal → por peso de venta)
      Object.entries(gastosCorp).forEach(([catId, monto]) => {
        const cat = catMap[catId]
        if (!cat) return
        const porcion = monto * pesoVenta
        if (cat.grupo === 'COGS') cogs += porcion
        else if (cat.grupo === 'Gasto Venta') gastosVenta += porcion
        else if (cat.grupo === 'Gasto Admin') gastosAdmin += porcion
      })

      const utilidadBruta = ventaSuc - cogs
      const utilidadOperativa = utilidadBruta - gastosLocales - gastosVenta - gastosAdmin

      pnl[suc] = {
        venta: ventaSuc,
        cogs,
        utilidadBruta,
        margenBruto: ventaSuc > 0 ? (utilidadBruta / ventaSuc) * 100 : 0,
        gastosLocales,
        gastosVenta,
        gastosAdmin,
        inversion,
        utilidadOperativa,
        margenOperativo: ventaSuc > 0 ? (utilidadOperativa / ventaSuc) * 100 : 0
      }
    })

    // 4. DTEs sin clasificar del mes
    const { data: noClasif } = await db
      .from('compras_dte')
      .select('id, proveedor_nombre, monto_total, fecha_emision')
      .gte('fecha_emision', desde)
      .lt('fecha_emision', hasta)
      .not('id', 'in', `(${(gastos || []).map(g => {
        // This won't work with PostgREST syntax, so let's do it differently
        return ''
      }).join(',')})`)

    // Better approach: query sin clasificar separately
    const { data: noClasif2 } = await db.rpc('get_dtes_sin_clasificar', { fecha_desde: desde, fecha_hasta: hasta }).catch(() => ({ data: null }))

    setDatos({ pnl, ventasPorSuc, gastosPorCat, gastosPorSucCat, totalVentasGlobal, totalGastos, catMap })
    setLoading(false)
  }, [desde, hasta])

  // Cargar DTEs sin clasificar para la pestaña de clasificación
  const cargarSinClasificar = useCallback(async () => {
    const { data } = await db
      .from('compras_dte')
      .select('id, proveedor_nombre, monto_total, fecha_emision')
      .gte('fecha_emision', desde)
      .lt('fecha_emision', hasta)
      .order('monto_total', { ascending: false })

    // Filtrar los que ya tienen clasificación
    const { data: clasificados } = await db
      .from('dte_clasificacion')
      .select('dte_id')

    const clasifSet = new Set((clasificados || []).map(c => c.dte_id))
    const sinClasif = (data || []).filter(d => !clasifSet.has(d.id))
    setSinClasificar(sinClasif)
  }, [desde, hasta])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  useEffect(() => {
    if (vista === 'clasificar') {
      cargarSinClasificar()
    }
  }, [vista, cargarSinClasificar])

  const clasificarDTE = async (dteId, categoriaId, sucursalCode, monto) => {
    setSaving(true)
    const { error } = await db.from('dte_clasificacion').insert({
      dte_id: dteId,
      categoria_gasto_id: categoriaId,
      sucursal_code: sucursalCode || null,
      monto: monto,
      es_automatico: false,
      clasificado_por: user?.nombre || 'usuario'
    })
    setSaving(false)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast('Clasificado')
    setSinClasificar(prev => prev.filter(d => d.id !== dteId))
  }

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
            P&L operativo basado en DTEs clasificados + ventas diarias
          </p>
        </div>
        <select value={periodo} onChange={e => setPeriodo(e.target.value)}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontWeight: 600, fontSize: 14 }}>
          {mesesDisponibles.slice(0, 18).map(m => {
            const [y, mo] = m.split('-')
            return <option key={m} value={m}>{MESES[parseInt(mo) - 1]} {y}</option>
          })}
        </select>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #E5E7EB' }}>
        {[
          { key: 'resumen', label: 'Resumen P&L' },
          { key: 'detalle', label: 'Detalle por Categoria' },
          { key: 'clasificar', label: 'Clasificar DTEs' }
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
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Concepto</th>
                      {sucursales.map(s => (
                        <th key={s} style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: '#374151', borderBottom: '2px solid #E5E7EB', minWidth: 90 }}>
                          {STORES[s]}
                        </th>
                      ))}
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#1D4ED8', borderBottom: '2px solid #E5E7EB' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Ventas */}
                    <tr style={{ background: '#ECFDF5' }}>
                      <td style={{ padding: '8px 14px', fontWeight: 700, color: '#065F46' }}>Ventas</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#065F46' }}>
                          {fmt(datos.pnl[s]?.venta)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 800, color: '#065F46' }}>
                        {fmt(datos.totalVentasGlobal)}
                      </td>
                    </tr>

                    {/* COGS */}
                    <tr>
                      <td style={{ padding: '8px 14px', color: '#DC2626' }}>(-) Costo Insumos (COGS)</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 10px', textAlign: 'right', color: '#DC2626' }}>
                          {fmt(datos.pnl[s]?.cogs)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.cogs), 0))}
                      </td>
                    </tr>

                    {/* Utilidad Bruta */}
                    <tr style={{ background: '#F0FDF4', borderTop: '2px solid #86EFAC' }}>
                      <td style={{ padding: '8px 14px', fontWeight: 700, color: '#166534' }}>= Utilidad Bruta</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#166534' }}>
                          {fmt(datos.pnl[s]?.utilidadBruta)}
                          <div style={{ fontSize: 10, color: '#6B7280' }}>{datos.pnl[s]?.margenBruto.toFixed(1)}%</div>
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 800, color: '#166534' }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.utilidadBruta), 0))}
                      </td>
                    </tr>

                    {/* Gastos Locales */}
                    <tr>
                      <td style={{ padding: '8px 14px', color: '#92400E', paddingLeft: 24 }}>Alquiler / Luz / Agua</td>
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
                      <td style={{ padding: '8px 14px', color: '#92400E', paddingLeft: 24 }}>Gastos Venta (POS/PEYA/Mktg)</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 10px', textAlign: 'right', color: '#92400E' }}>
                          {fmt(datos.pnl[s]?.gastosVenta)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#92400E', fontWeight: 600 }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.gastosVenta), 0))}
                      </td>
                    </tr>

                    {/* Gastos Admin */}
                    <tr>
                      <td style={{ padding: '8px 14px', color: '#92400E', paddingLeft: 24 }}>Gastos Admin (prorrateados)</td>
                      {sucursales.map(s => (
                        <td key={s} style={{ padding: '8px 10px', textAlign: 'right', color: '#92400E' }}>
                          {fmt(datos.pnl[s]?.gastosAdmin)}
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#92400E', fontWeight: 600 }}>
                        {fmt(sucursales.reduce((sum, s) => sum + n(datos.pnl[s]?.gastosAdmin), 0))}
                      </td>
                    </tr>

                    {/* Utilidad Operativa */}
                    <tr style={{ background: '#EFF6FF', borderTop: '2px solid #93C5FD' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 800, color: '#1E40AF' }}>= Utilidad Operativa</td>
                      {sucursales.map(s => {
                        const uo = datos.pnl[s]?.utilidadOperativa || 0
                        return (
                          <td key={s} style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, color: uo >= 0 ? '#166534' : '#DC2626' }}>
                            {fmt(uo)}
                            <div style={{ fontSize: 10, color: '#6B7280' }}>{datos.pnl[s]?.margenOperativo.toFixed(1)}%</div>
                          </td>
                        )
                      })}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#1E40AF' }}>
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
          {vista === 'detalle' && (
            <div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB' }}>
                      <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid #E5E7EB' }}>Categoria</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid #E5E7EB' }}>Grupo</th>
                      {sucursales.map(s => (
                        <th key={s} style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, borderBottom: '2px solid #E5E7EB', fontSize: 11 }}>
                          {STORES[s]}
                        </th>
                      ))}
                      <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, borderBottom: '2px solid #E5E7EB', fontSize: 11 }}>CORP</th>
                      <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 800, borderBottom: '2px solid #E5E7EB', color: '#1D4ED8' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categorias.filter(c => datos.gastosPorCat[c.id]).map(cat => (
                      <tr key={cat.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '6px 14px', fontWeight: 600, color: '#374151' }}>{cat.nombre}</td>
                        <td style={{ padding: '6px 10px', fontSize: 11, color: '#9CA3AF' }}>{cat.grupo}</td>
                        {sucursales.map(s => (
                          <td key={s} style={{ padding: '6px 8px', textAlign: 'right', color: '#374151' }}>
                            {datos.gastosPorSucCat[s]?.[cat.id] ? fmt(datos.gastosPorSucCat[s][cat.id]) : '-'}
                          </td>
                        ))}
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6B7280' }}>
                          {datos.gastosPorSucCat['CORP']?.[cat.id] ? fmt(datos.gastosPorSucCat['CORP'][cat.id]) : '-'}
                        </td>
                        <td style={{ padding: '6px 14px', textAlign: 'right', fontWeight: 700, color: '#1D4ED8' }}>
                          {fmt(datos.gastosPorCat[cat.id])}
                        </td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr style={{ background: '#EFF6FF', borderTop: '2px solid #93C5FD' }}>
                      <td style={{ padding: '8px 14px', fontWeight: 800 }} colSpan={2}>Total</td>
                      {sucursales.map(s => {
                        const total = Object.values(datos.gastosPorSucCat[s] || {}).reduce((a, b) => a + b, 0)
                        return (
                          <td key={s} style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>{total ? fmt(total) : '-'}</td>
                        )
                      })}
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>
                        {fmt(Object.values(datos.gastosPorSucCat['CORP'] || {}).reduce((a, b) => a + b, 0))}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 800, color: '#1D4ED8' }}>
                        {fmt(datos.totalGastos)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ===== TAB: CLASIFICAR DTEs ===== */}
          {vista === 'clasificar' && (
            <div>
              <div style={{ marginBottom: 16, padding: '10px 16px', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, fontSize: 12, color: '#78350F' }}>
                <strong>{sinClasificar.length} DTEs sin clasificar</strong> en {mesLabel}.
                Asigna una categoria contable y sucursal para incluirlos en el P&L.
              </div>

              {sinClasificar.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#059669', background: '#F0FDF4', borderRadius: 12 }}>
                  Todos los DTEs de {mesLabel} estan clasificados.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sinClasificar.slice(0, 50).map(dte => (
                    <ClasificarRow key={dte.id} dte={dte} categorias={categorias} onClasificar={clasificarDTE} saving={saving} />
                  ))}
                  {sinClasificar.length > 50 && (
                    <div style={{ textAlign: 'center', padding: 12, color: '#6B7280', fontSize: 12 }}>
                      ... y {sinClasificar.length - 50} mas
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* Row para clasificar un DTE individual */
function ClasificarRow({ dte, categorias, onClasificar, saving }) {
  const [catId, setCatId] = useState('')
  const [sucCode, setSucCode] = useState('')
  const [open, setOpen] = useState(false)

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{dte.proveedor_nombre}</div>
          <div style={{ fontSize: 11, color: '#9CA3AF' }}>{dte.fecha_emision}</div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#1D4ED8', minWidth: 80, textAlign: 'right' }}>
          ${n(dte.monto_total).toFixed(2)}
        </div>
        {!open ? (
          <button onClick={() => setOpen(true)} style={{
            padding: '5px 14px', background: '#EFF6FF', color: '#1D4ED8',
            border: '1px solid #BFDBFE', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 12
          }}>Clasificar</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={catId} onChange={e => setCatId(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 11, maxWidth: 200 }}>
              <option value="">Categoria...</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.id} - {c.nombre}</option>)}
            </select>
            <select value={sucCode} onChange={e => setSucCode(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 11 }}>
              <option value="">Corporativo</option>
              {Object.entries(STORES).filter(([k]) => k !== 'CM001').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button onClick={() => { if (catId) onClasificar(dte.id, catId, sucCode, dte.monto_total) }}
              disabled={!catId || saving}
              style={{
                padding: '5px 12px', background: catId ? '#059669' : '#D1D5DB', color: '#fff',
                border: 'none', borderRadius: 6, cursor: catId ? 'pointer' : 'default', fontWeight: 700, fontSize: 11
              }}>OK</button>
            <button onClick={() => setOpen(false)} style={{
              padding: '5px 8px', background: '#F3F4F6', color: '#6B7280',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11
            }}>X</button>
          </div>
        )}
      </div>
    </div>
  )
}
