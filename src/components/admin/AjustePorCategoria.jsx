import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'

/**
 * AjustePorCategoria — Tab del Simulador de Rentabilidad.
 * Muestra datos REALES del mes anterior cerrado, organizados por sucursal y categoría.
 * Cada categoría tiene un slider de % de cambio para simular ajustes (recortar planilla,
 * negociar proveedores, reducir gastos varios, etc.) y ver cómo impacta en la utilidad.
 *
 * Lee de fn_simulador_categorias() que retorna sucursales + Casa Matriz con
 * gastos centralizados ya prorrateados por peso de ventas.
 */

const c = {
  bg: '#0a0a0a', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  purple: '#a78bfa', pink: '#ec4899', cyan: '#22d3ee',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
}

const cardStyle = {
  background: c.card, border: `1px solid ${c.cardBorder}`,
  borderRadius: 12, padding: 16, marginBottom: 12,
}

// Categorías con su color
const CAT_META = {
  'COGS': { color: c.red, icon: '🥩', label: 'COGS (insumos)' },
  'Planilla': { color: c.blue, icon: '👥', label: 'Planilla' },
  'Gasto Admin': { color: c.purple, icon: '💼', label: 'Gasto Admin' },
  'Gasto Local': { color: c.orange, icon: '🏠', label: 'Gasto Local' },
  'Planilla Gerencial': { color: c.pink, icon: '👔', label: 'Planilla Gerencial' },
}

function fmtUSD(v) {
  return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtUSDInt(v) {
  return '$' + Math.round(Number(v) || 0).toLocaleString('en-US')
}
function fmtPct(v, decimals = 2) {
  return (Number(v) || 0).toFixed(decimals) + '%'
}

// ───────────────────────────────────────────────
// Categoría colapsable con slider
// ───────────────────────────────────────────────
function CategoriaCard({ catKey, grupo, monto, subcategorias, ajustePct, setAjuste, color, expanded, onToggle }) {
  const ajuste = ajustePct / 100
  const montoNuevo = monto * (1 + ajuste)
  const delta = montoNuevo - monto

  return (
    <div style={{ background: c.input, borderRadius: 8, padding: 10, marginBottom: 6, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: c.text }}>
          <span style={{ color: c.textDim, fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
          <span>{grupo}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: ajuste !== 0 ? color : c.text }}>
            {fmtUSD(montoNuevo)}
          </div>
          {ajuste !== 0 && (
            <div style={{ fontSize: 10, color: delta < 0 ? c.green : c.red, fontWeight: 600 }}>
              {delta >= 0 ? '+' : ''}{fmtUSDInt(delta)} ({ajustePct >= 0 ? '+' : ''}{ajustePct}%)
            </div>
          )}
        </div>
      </div>
      
      {/* Slider */}
      <div style={{ marginTop: 8 }}>
        <input
          type="range" min={-50} max={50} step={1} value={ajustePct}
          onChange={(e) => setAjuste(Number(e.target.value))}
          style={{ width: '100%', accentColor: color, height: 4 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: c.textOff, marginTop: 2 }}>
          <span>-50%</span><span>0</span><span>+50%</span>
        </div>
      </div>

      {/* Subcategorías */}
      {expanded && subcategorias && subcategorias.length > 0 && (
        <div style={{ marginTop: 8, padding: 8, background: c.bg, borderRadius: 6 }}>
          {subcategorias.map(sub => {
            const subNuevo = Number(sub.monto) * (1 + ajuste)
            return (
              <div key={sub.nombre} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: `1px solid ${c.border}` }}>
                <span style={{ color: c.textDim }}>{sub.nombre || 'Sin subcategoría'}</span>
                <span style={{ color: ajuste !== 0 ? color : c.text, fontWeight: ajuste !== 0 ? 700 : 400 }}>
                  {fmtUSDInt(subNuevo)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────
// Card de Sucursal
// ───────────────────────────────────────────────
function SucursalCard({ suc, ajustes, setAjuste, expandedKeys, toggleExpand, esCasaMatriz }) {
  // Lista de categorías a mostrar
  const categoriasItems = []
  
  if (esCasaMatriz) {
    categoriasItems.push({
      key: 'planilla_gerencial',
      grupo: 'Planilla Gerencial',
      monto: Number(suc.planilla_gerencial || 0),
      subcategorias: [{ nombre: 'Planilla Gerencial (devengado)', monto: Number(suc.planilla_gerencial || 0) }],
    })
  } else {
    categoriasItems.push({
      key: 'planilla',
      grupo: 'Planilla',
      monto: Number(suc.planilla || 0),
      subcategorias: [{ nombre: 'Planilla operativa (prorrateada por peso)', monto: Number(suc.planilla || 0) }],
    })
  }

  ;(suc.categorias || []).forEach(cat => {
    categoriasItems.push({
      key: cat.grupo,
      grupo: cat.grupo,
      monto: Number(cat.monto || 0),
      subcategorias: cat.subcategorias || [],
    })
  })

  // Calcular total por sucursal con ajustes
  const totalActual = categoriasItems.reduce((sum, c) => sum + c.monto, 0)
  const totalSimulado = categoriasItems.reduce((sum, c) => {
    const aj = ajustes[`${suc.store_code}:${c.key}`] ?? 0
    return sum + c.monto * (1 + aj / 100)
  }, 0)
  const deltaTotal = totalSimulado - totalActual
  const ventas = Number(suc.ventas_si || 0)
  const utilActual = ventas - totalActual
  const utilSimulada = ventas - totalSimulado
  const margenSim = ventas > 0 ? (utilSimulada / ventas) * 100 : 0

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: esCasaMatriz ? c.pink : c.cyan }}>
            {esCasaMatriz ? '🏛️' : '🏪'} {suc.nombre}
          </div>
          <div style={{ fontSize: 10, color: c.textDim }}>
            {suc.store_code} · {suc.tipo || 'central'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase' }}>Ventas mes</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: ventas > 0 ? c.green : c.textOff }}>
            {ventas > 0 ? fmtUSD(ventas) : 'Sin ventas'}
          </div>
        </div>
      </div>

      {/* Resumen utilidad */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
        <div style={{ padding: 6, background: c.bg, borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: c.textDim }}>COSTOS</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{fmtUSDInt(totalSimulado)}</div>
          {deltaTotal !== 0 && (
            <div style={{ fontSize: 9, color: deltaTotal < 0 ? c.green : c.red }}>
              {deltaTotal >= 0 ? '+' : ''}{fmtUSDInt(deltaTotal)}
            </div>
          )}
        </div>
        <div style={{ padding: 6, background: c.bg, borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: c.textDim }}>UTILIDAD</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: utilSimulada >= 0 ? c.green : c.red }}>
            {fmtUSDInt(utilSimulada)}
          </div>
        </div>
        <div style={{ padding: 6, background: c.bg, borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: c.textDim }}>MARGEN</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: margenSim >= 0 ? c.green : c.red }}>
            {ventas > 0 ? fmtPct(margenSim, 1) : '—'}
          </div>
        </div>
      </div>

      {/* Categorías */}
      <div>
        {categoriasItems.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', color: c.textDim, fontSize: 12 }}>
            Sin gastos registrados
          </div>
        ) : categoriasItems.map(cat => {
          const key = `${suc.store_code}:${cat.key}`
          const meta = CAT_META[cat.grupo] || { color: c.blue, icon: '📊', label: cat.grupo }
          return (
            <CategoriaCard
              key={cat.key}
              catKey={cat.key}
              grupo={cat.grupo}
              monto={cat.monto}
              subcategorias={cat.subcategorias}
              ajustePct={ajustes[key] ?? 0}
              setAjuste={(v) => setAjuste(key, v)}
              color={meta.color}
              expanded={expandedKeys[key] || false}
              onToggle={() => toggleExpand(key)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────
// Componente principal del tab
// ───────────────────────────────────────────────
export default function AjustePorCategoria({ user }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState(null)
  const [metaRent, setMetaRent] = useState(5)
  const [ajustes, setAjustes] = useState({}) // {"<store>:<cat>": pct}
  const [expandedKeys, setExpandedKeys] = useState({})

  const cargar = useCallback(async () => {
    setLoading(true)
    setErrMsg(null)
    try {
      const { data: result, error } = await db.rpc('fn_simulador_categorias')
      if (error) {
        console.error('AjustePorCategoria RPC error:', error)
        setErrMsg(error.message || JSON.stringify(error))
        setData(null)
      } else {
        setData(result || null)
      }
    } catch (e) {
      setErrMsg('Excepción: ' + (e.message || String(e)))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const setAjuste = useCallback((key, pct) => {
    setAjustes(prev => ({ ...prev, [key]: pct }))
  }, [])
  const toggleExpand = useCallback((key) => {
    setExpandedKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])
  const resetAjustes = useCallback(() => setAjustes({}), [])

  // Cálculo global con ajustes
  const summary = useMemo(() => {
    if (!data) return null
    const sucursales = data.sucursales || []
    const cm = data.casa_matriz || {}

    let ventasTotal = 0
    let costoActual = 0
    let costoSimulado = 0

    sucursales.forEach(suc => {
      ventasTotal += Number(suc.ventas_si || 0)
      // Planilla
      const planillaActual = Number(suc.planilla || 0)
      const ajP = ajustes[`${suc.store_code}:planilla`] ?? 0
      costoActual += planillaActual
      costoSimulado += planillaActual * (1 + ajP / 100)
      // Categorías
      ;(suc.categorias || []).forEach(cat => {
        const monto = Number(cat.monto || 0)
        const aj = ajustes[`${suc.store_code}:${cat.grupo}`] ?? 0
        costoActual += monto
        costoSimulado += monto * (1 + aj / 100)
      })
    })

    // Casa Matriz
    const planillaGer = Number(cm.planilla_gerencial || 0)
    const ajPG = ajustes['CM001:planilla_gerencial'] ?? 0
    costoActual += planillaGer
    costoSimulado += planillaGer * (1 + ajPG / 100)
    ;(cm.categorias || []).forEach(cat => {
      const monto = Number(cat.monto || 0)
      const aj = ajustes[`CM001:${cat.grupo}`] ?? 0
      costoActual += monto
      costoSimulado += monto * (1 + aj / 100)
    })

    const utilActual = ventasTotal - costoActual
    const utilSimulada = ventasTotal - costoSimulado
    const margenActual = ventasTotal > 0 ? (utilActual / ventasTotal) * 100 : 0
    const margenSimulado = ventasTotal > 0 ? (utilSimulada / ventasTotal) * 100 : 0
    const utilidadMeta = ventasTotal * (metaRent / 100)
    const gapMeta = utilidadMeta - utilSimulada
    const ajusteNecesario = gapMeta  // cuanto recortar más para llegar a meta

    return {
      ventasTotal,
      costoActual, costoSimulado,
      utilActual, utilSimulada,
      margenActual, margenSimulado,
      utilidadMeta, gapMeta, ajusteNecesario,
      ahorroSimulado: costoActual - costoSimulado,
      metaAlcanzada: margenSimulado >= metaRent,
    }
  }, [data, ajustes, metaRent])

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>Cargando datos por categoría…</div>
  if (!data || !summary) return (
    <div style={{ padding: 30, color: c.text, maxWidth: 800, margin: '20px auto' }}>
      <div style={{ ...cardStyle, borderColor: c.red, textAlign: 'center' }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ color: c.red, fontWeight: 700 }}>Error cargando categorías</div>
        {errMsg && <div style={{ marginTop: 10, padding: 12, background: c.input, borderRadius: 8, color: c.textDim, fontSize: 12, fontFamily: 'monospace' }}>{errMsg}</div>}
        <button onClick={cargar} style={{ marginTop: 14, padding: '8px 16px', borderRadius: 8, background: c.blue, color: '#000', fontWeight: 700, border: 'none', cursor: 'pointer' }}>Reintentar</button>
      </div>
    </div>
  )

  const sucursales = data.sucursales || []
  const casaMatriz = data.casa_matriz || {}
  const mesLabel = data.periodo?.mes_label || '—'
  const margenSimColor = summary.margenSimulado >= metaRent ? c.green : summary.margenSimulado >= 0 ? c.yellow : c.red

  return (
    <div>
      {/* Header con info + meta */}
      <div style={{ ...cardStyle, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: c.textDim, textTransform: 'uppercase' }}>Datos reales · {mesLabel} (mes cerrado)</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
              {sucursales.length} sucursal{sucursales.length !== 1 ? 'es' : ''} operativa{sucursales.length !== 1 ? 's' : ''} + Casa Matriz
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={resetAjustes} style={{ padding: '6px 12px', borderRadius: 8, background: c.input, color: c.text, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 12 }}>
              ↺ Reset ajustes
            </button>
            <button onClick={cargar} style={{ padding: '6px 12px', borderRadius: 8, background: c.input, color: c.text, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 12 }}>
              🔄 Refrescar
            </button>
          </div>
        </div>

        {/* Slider meta */}
        <div style={{ marginTop: 14, padding: 12, background: c.input, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: c.textDim, textTransform: 'uppercase', fontWeight: 600 }}>🎯 Meta de rentabilidad</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c.yellow }}>{fmtPct(metaRent, 1)}</div>
          </div>
          <input type="range" min={0} max={20} step={0.5} value={metaRent}
                 onChange={(e) => setMetaRent(Number(e.target.value))}
                 style={{ width: '100%', accentColor: c.yellow }} />
        </div>
      </div>

      {/* KPIs resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ ...cardStyle, marginBottom: 0, padding: 12, borderLeft: `4px solid ${c.cyan}` }}>
          <div style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase' }}>Ventas grupo</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: c.cyan }}>{fmtUSD(summary.ventasTotal)}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, padding: 12, borderLeft: `4px solid ${c.orange}` }}>
          <div style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase' }}>Costos simulados</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: c.orange }}>{fmtUSD(summary.costoSimulado)}</div>
          {summary.ahorroSimulado !== 0 && (
            <div style={{ fontSize: 11, color: summary.ahorroSimulado > 0 ? c.green : c.red, fontWeight: 600 }}>
              {summary.ahorroSimulado > 0 ? `Ahorro: ${fmtUSDInt(summary.ahorroSimulado)}` : `Incremento: ${fmtUSDInt(-summary.ahorroSimulado)}`}
            </div>
          )}
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, padding: 12, borderLeft: `4px solid ${summary.utilSimulada >= 0 ? c.green : c.red}` }}>
          <div style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase' }}>Utilidad simulada</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: summary.utilSimulada >= 0 ? c.green : c.red }}>
            {fmtUSD(summary.utilSimulada)}
          </div>
          <div style={{ fontSize: 11, color: c.textDim }}>actual: {fmtUSD(summary.utilActual)}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, padding: 12, borderLeft: `4px solid ${margenSimColor}` }}>
          <div style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase' }}>Margen simulado</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: margenSimColor }}>{fmtPct(summary.margenSimulado)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>actual: {fmtPct(summary.margenActual)}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, padding: 12, borderLeft: `4px solid ${c.yellow}` }}>
          <div style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase' }}>vs Meta {fmtPct(metaRent, 1)}</div>
          {summary.metaAlcanzada ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.green }}>✓ Meta</div>
              <div style={{ fontSize: 11, color: c.green }}>{fmtPct(summary.margenSimulado - metaRent)} arriba</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.yellow }}>Faltan {fmtUSDInt(summary.gapMeta)}</div>
              <div style={{ fontSize: 11, color: c.textDim }}>recortar más costos o subir ventas</div>
            </>
          )}
        </div>
      </div>

      {/* Grid de sucursales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
        {sucursales.map(suc => (
          <SucursalCard key={suc.store_code} suc={suc} ajustes={ajustes} setAjuste={setAjuste}
                         expandedKeys={expandedKeys} toggleExpand={toggleExpand} esCasaMatriz={false} />
        ))}
        <SucursalCard suc={casaMatriz} ajustes={ajustes} setAjuste={setAjuste}
                       expandedKeys={expandedKeys} toggleExpand={toggleExpand} esCasaMatriz={true} />
      </div>
    </div>
  )
}
