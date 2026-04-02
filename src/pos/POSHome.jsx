import { useState, useEffect, useCallback } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'

// ──────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────
const TIPO_INFO = {
  mesa:            { icon: '🪑', label: 'Mesas',       color: '#4ade80' },
  para_llevar:     { icon: '🥡', label: 'Para Llevar', color: '#f4a261' },
  delivery_propio: { icon: '🛵', label: 'Delivery',    color: '#60a5fa' },
  pedidos_ya:      { icon: '📱', label: 'PedidosYa',   color: '#a78bfa' },
  drive_through:   { icon: '🚗', label: 'Drive Thru',  color: '#fbbf24' },
}

const FILTROS = [
  { key: 'todos',          icon: '📋', label: 'Todos'       },
  { key: 'mesa',           icon: '🪑', label: 'Mesas'       },
  { key: 'para_llevar',    icon: '🥡', label: 'Para Llevar' },
  { key: 'delivery_propio',icon: '🛵', label: 'Delivery'    },
  { key: 'pedidos_ya',     icon: '📱', label: 'PedidosYa'   },
  { key: 'drive_through',  icon: '🚗', label: 'Drive Thru'  },
]

const ZONA_LABELS = {
  interior:  '🏠 Interior',
  principal: '🏠 Principal',
  terraza:   '🌿 Terraza',
  barra:     '🍺 Barra',
  vip:       '⭐ VIP',
  privado:   '🔒 Privado',
}

const ESTADO_ACTIVO = ['abierta', 'enviada_cocina', 'en_preparacion', 'lista', 'entregada']

const MESA_STATUS_COLORS = {
  libre:  { bg: '#0d1a10', border: '#4ade80', text: '#4ade80' },
  activa: { bg: '#1a1200', border: '#fbbf24', text: '#fbbf24' },
  lista:  { bg: '#0a1520', border: '#60a5fa', text: '#60a5fa' },
}

// Reloj
function Clock() {
  const [t, setT] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date(Date.now() - 6 * 3600 * 1000)
      setT(now.toISOString().split('T')[1].slice(0, 8))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="pos-header-clock">{t}</span>
}

// Tiempo transcurrido
function elapsed(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000)
  if (diff < 1)  return 'ahora'
  if (diff < 60) return `${diff}m`
  return `${Math.floor(diff / 60)}h${diff % 60}m`
}

// ──────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────
export default function POSHome({ user, onStartOrder, onLogout }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  const [mesas,        setMesas]        = useState([])
  const [cuentas,      setCuentas]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selectedZona, setSelectedZona] = useState(null)
  const [hasMesas,     setHasMesas]     = useState(false)
  const [filtro,       setFiltro]       = useState('todos')   // clave activa
  const [refreshKey,   setRefreshKey]   = useState(0)

  // ── Carga ──
  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: mesasData }, { data: cuentasData }] = await Promise.all([
      db.from('pos_mesas')
        .select('*')
        .eq('store_code', storeCode)
        .eq('activa', true)
        .order('numero'),
      db.from('pos_cuentas')
        .select('id, tipo, mesa_ref, store_code, estado, subtotal, total, created_at, pos_cuenta_items(id)')
        .eq('store_code', storeCode)
        .in('estado', ESTADO_ACTIVO)
        .order('created_at'),
    ])
    const mList = mesasData || []
    setMesas(mList)
    setHasMesas(mList.length > 0)
    if (mList.length > 0 && !selectedZona) setSelectedZona(mList[0].zona || 'principal')
    setCuentas(cuentasData || [])
    setLoading(false)
  }, [storeCode])

  useEffect(() => { load() }, [load, refreshKey])

  // Realtime
  useEffect(() => {
    const sub = db.channel('pos_home_rt')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pos_cuentas',
        filter: `store_code=eq.${storeCode}`,
      }, () => setRefreshKey(k => k + 1))
      .subscribe()
    return () => db.removeChannel(sub)
  }, [storeCode])

  // ── Derivados ──
  const cuentaPorMesa = {}
  cuentas.forEach(c => { if (c.mesa_ref) cuentaPorMesa[c.mesa_ref] = c })

  const zonas     = [...new Set(mesas.map(m => m.zona || 'principal'))]
  const mesasZona = mesas.filter(m => (m.zona || 'principal') === selectedZona)

  // Conteos por filtro
  const conteo = {
    todos:           cuentas.length,
    mesa:            cuentas.filter(c => c.tipo === 'mesa').length,
    para_llevar:     cuentas.filter(c => c.tipo === 'para_llevar').length,
    delivery_propio: cuentas.filter(c => c.tipo === 'delivery_propio').length,
    pedidos_ya:      cuentas.filter(c => c.tipo === 'pedidos_ya').length,
    drive_through:   cuentas.filter(c => c.tipo === 'drive_through').length,
  }

  // Cuentas filtradas (para lista no-mesa)
  const cuentasFiltradas = cuentas.filter(c => {
    if (filtro === 'todos') return c.tipo !== 'mesa'   // mesas se muestran en el plano
    if (filtro === 'mesa')  return false               // mesas se muestran en el plano
    return c.tipo === filtro
  })

  const mostrarPlano = hasMesas && (filtro === 'todos' || filtro === 'mesa')

  // ── Handlers ──
  const getMesaStatus = (mesa) => {
    const c = cuentaPorMesa[String(mesa.numero)]
    if (!c) return 'libre'
    return ['lista', 'entregada'].includes(c.estado) ? 'lista' : 'activa'
  }

  const handleMesaClick = (mesa) => {
    const c = cuentaPorMesa[String(mesa.numero)]
    onStartOrder({ tipo: 'mesa', mesa_ref: String(mesa.numero), mesa_id: mesa.id, cuentaId: c?.id || null })
  }

  const handleCuentaClick = (c) => {
    onStartOrder({ tipo: c.tipo, mesa_ref: c.mesa_ref || null, mesa_id: null, cuentaId: c.id })
  }

  const handleNueva = (tipo) => {
    onStartOrder({ tipo, mesa_ref: null, mesa_id: null, cuentaId: null })
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="spin" /><span style={{ color: '#555', fontSize: 14 }}>Cargando...</span>
      </div>
    )
  }

  return (
    <div className="poshome-root">

      {/* ── HEADER ── */}
      <header className="pos-header">
        <span className="pos-header-brand">🍔 FREAKIE POS</span>
        <span className="pos-header-store">{storeName}</span>
        <span className="poshome-badge">
          {cuentas.length > 0
            ? <><span style={{ color: '#fbbf24' }}>●</span> {cuentas.length} abiert{cuentas.length === 1 ? 'a' : 'as'}</>
            : <><span style={{ color: '#4ade80' }}>●</span> Sin órdenes</>}
        </span>
        <span className="pos-header-user">👤 {user.nombre?.split(' ')[0]}</span>
        <Clock />
        <button className="pos-header-btn danger" onClick={onLogout}>Salir</button>
      </header>

      {/* ── FILTROS DE CUENTAS ABIERTAS ── */}
      <div className="poshome-filters">
        {FILTROS.map(f => {
          // Ocultar filtro 'mesa' si no hay mesas configuradas
          if (f.key === 'mesa' && !hasMesas) return null
          const cnt = conteo[f.key] ?? 0
          return (
            <button
              key={f.key}
              className={`poshome-filter-btn${filtro === f.key ? ' active' : ''}`}
              onClick={() => setFiltro(f.key)}
            >
              <span className="poshome-filter-icon">{f.icon}</span>
              <span className="poshome-filter-label">{f.label}</span>
              {cnt > 0 && (
                <span className="poshome-filter-badge">{cnt}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── BODY ── */}
      <div className="poshome-body">

        {/* ── PLANO DE MESAS (visible cuando filtro es 'todos' o 'mesa') ── */}
        {mostrarPlano && (
          <section className="poshome-section">
            <div className="poshome-section-header">
              <span className="poshome-section-title">🪑 Plano de Mesas</span>
              <div className="poshome-zona-tabs">
                {zonas.map(zona => (
                  <button
                    key={zona}
                    className={`poshome-zona-tab${selectedZona === zona ? ' active' : ''}`}
                    onClick={() => setSelectedZona(zona)}
                  >
                    {ZONA_LABELS[zona] || zona}
                  </button>
                ))}
              </div>
            </div>

            <div className="poshome-mesas-grid">
              {mesasZona.map(mesa => {
                const status  = getMesaStatus(mesa)
                const cuenta  = cuentaPorMesa[String(mesa.numero)]
                const colors  = MESA_STATUS_COLORS[status]
                const itemCnt = cuenta?.pos_cuenta_items?.length || 0
                return (
                  <button
                    key={mesa.id}
                    className="poshome-mesa-tile"
                    style={{ background: colors.bg, borderColor: colors.border }}
                    onClick={() => handleMesaClick(mesa)}
                  >
                    <div className="poshome-mesa-num" style={{ color: colors.text }}>{mesa.numero}</div>
                    {status === 'libre' ? (
                      <div className="poshome-mesa-status libre">libre · {mesa.capacidad || 4}👥</div>
                    ) : (
                      <>
                        <div className="poshome-mesa-total" style={{ color: colors.text }}>
                          ${parseFloat(cuenta.subtotal || 0).toFixed(2)}
                        </div>
                        <div className="poshome-mesa-meta">
                          {itemCnt} ítem{itemCnt !== 1 ? 's' : ''} · {elapsed(cuenta.created_at)}
                        </div>
                        {status === 'lista' && <div className="poshome-mesa-ready">✓ Lista</div>}
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ── LISTA DE CUENTAS ABIERTAS (no-mesa o filtradas) ── */}
        {cuentasFiltradas.length > 0 && (
          <section className="poshome-section">
            {filtro === 'todos' && (
              <div className="poshome-section-header">
                <span className="poshome-section-title">📋 Para Llevar / Delivery</span>
              </div>
            )}
            <div className="poshome-cuentas-list">
              {cuentasFiltradas.map(c => {
                const info   = TIPO_INFO[c.tipo] || { icon: '📦', label: c.tipo, color: '#888' }
                const items  = c.pos_cuenta_items?.length || 0
                return (
                  <button
                    key={c.id}
                    className="poshome-cuenta-row"
                    style={{ borderLeftColor: info.color }}
                    onClick={() => handleCuentaClick(c)}
                  >
                    <span className="poshome-cuenta-icon">{info.icon}</span>
                    <div className="poshome-cuenta-info">
                      <span className="poshome-cuenta-label" style={{ color: info.color }}>
                        {info.label}
                      </span>
                      <span className="poshome-cuenta-items">{items} ítem{items !== 1 ? 's' : ''}</span>
                    </div>
                    <span className="poshome-cuenta-total">${parseFloat(c.subtotal || 0).toFixed(2)}</span>
                    <span className="poshome-cuenta-time">{elapsed(c.created_at)}</span>
                    <span className="poshome-cuenta-estado" data-estado={c.estado}>
                      {c.estado === 'enviada_cocina' ? '🍳 Cocina'
                        : c.estado === 'lista'       ? '✅ Lista'
                        : c.estado === 'entregada'   ? '✓ Entregada'
                        : '⏳ Abierta'}
                    </span>
                    <span className="poshome-cuenta-arrow">→</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ── ESTADO VACÍO POR FILTRO ── */}
        {cuentasFiltradas.length === 0 && !mostrarPlano && (
          <div className="poshome-empty">
            <div style={{ fontSize: 40 }}>{FILTROS.find(f => f.key === filtro)?.icon || '📋'}</div>
            <div style={{ color: '#555', fontSize: 14, marginTop: 8 }}>
              Sin órdenes de {FILTROS.find(f => f.key === filtro)?.label || filtro}
            </div>
            {filtro !== 'todos' && filtro !== 'mesa' && (
              <button
                className="poshome-nueva-btn"
                style={{ '--color': TIPO_INFO[filtro]?.color || '#888' }}
                onClick={() => handleNueva(filtro)}
              >
                + Nueva {TIPO_INFO[filtro]?.label}
              </button>
            )}
          </div>
        )}

        {/* ── ESTADO VACÍO GENERAL ── */}
        {cuentas.length === 0 && filtro === 'todos' && (
          <div className="poshome-empty">
            <div style={{ fontSize: 48 }}>🍔</div>
            <div style={{ color: '#444', fontSize: 14, marginTop: 8 }}>Sin órdenes activas</div>
            <div style={{ color: '#333', fontSize: 12 }}>Usa los botones de abajo para crear una nueva</div>
          </div>
        )}

      </div>

      {/* ── BARRA INFERIOR: NUEVA ORDEN ── */}
      <div className="poshome-quick-bar">
        {/* Mesa: solo si hay mesas configuradas */}
        {hasMesas && (
          <button
            className="poshome-quick-btn"
            style={{ '--qt-color': '#4ade80' }}
            onClick={() => setFiltro('mesa')}
          >
            <span className="poshome-quick-icon">🪑</span>
            <span className="poshome-quick-label">Mesas</span>
          </button>
        )}
        <button className="poshome-quick-btn" style={{ '--qt-color': '#f4a261' }} onClick={() => handleNueva('para_llevar')}>
          <span className="poshome-quick-icon">🥡</span><span className="poshome-quick-label">Para Llevar</span>
        </button>
        <button className="poshome-quick-btn" style={{ '--qt-color': '#60a5fa' }} onClick={() => handleNueva('delivery_propio')}>
          <span className="poshome-quick-icon">🛵</span><span className="poshome-quick-label">Delivery</span>
        </button>
        <button className="poshome-quick-btn" style={{ '--qt-color': '#a78bfa' }} onClick={() => handleNueva('pedidos_ya')}>
          <span className="poshome-quick-icon">📱</span><span className="poshome-quick-label">PedidosYa</span>
        </button>
        <button className="poshome-quick-btn" style={{ '--qt-color': '#fbbf24' }} onClick={() => handleNueva('drive_through')}>
          <span className="poshome-quick-icon">🚗</span><span className="poshome-quick-label">Drive Thru</span>
        </button>
      </div>

    </div>
  )
}
