import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'

// ──────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────
const TIPO_INFO = {
  mesa:            { icon: '🪑', label: 'Mesas',       color: '#2dd4a8' },
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
  libre:  { bg: '#0d1a18', border: '#2dd4a8', text: '#2dd4a8' },
  activa: { bg: '#1a1800', border: '#fbbf24', text: '#fbbf24' },
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
const KDS_ROLES = ['cocina', 'gerente', 'admin', 'ejecutivo', 'superadmin']
const MESERO_ROLES = ['mesero', 'mesera']

export default function POSHome({ user, onStartOrder, onLogout, onGoToKDS, onGoToHistorial, onChangeStore }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  const [mesas,        setMesas]        = useState([])
  const [cuentas,      setCuentas]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selectedZona, setSelectedZona] = useState(null)
  const [hasMesas,     setHasMesas]     = useState(false)
  const [filtro,       setFiltro]       = useState('todos')   // clave activa
  const [refreshKey,   setRefreshKey]   = useState(0)
  const [mesaMenu,     setMesaMenu]     = useState(null)      // mesa con menú contextual
  const longPressRef   = useRef(null)

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
        .select('id, tipo, mesa_ref, store_code, estado, subtotal, total, created_at, pos_cuenta_items!pos_cuenta_items_cuenta_id_fkey(id)')
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

  // Long-press para mostrar menú contextual en mesas ocupadas
  const handleMesaTouchStart = (mesa) => {
    const c = cuentaPorMesa[String(mesa.numero)]
    if (!c) return // solo mesas ocupadas
    longPressRef.current = setTimeout(() => {
      setMesaMenu(mesa)
      longPressRef.current = null
    }, 600)
  }
  const handleMesaTouchEnd = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  // Liberar mesa: cerrar cuenta atascada
  const handleLiberarMesa = async (mesa) => {
    const c = cuentaPorMesa[String(mesa.numero)]
    if (!c) return
    if (!confirm(`¿Liberar mesa ${mesa.numero}? La cuenta se cerrará como cobrada.`)) return
    await db.from('pos_cuentas')
      .update({ estado: 'cobrada', cobrada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', c.id)
    setMesaMenu(null)
    setRefreshKey(k => k + 1)
  }

  const handleMesaClick = (mesa) => {
    if (mesaMenu) { setMesaMenu(null); return } // cerrar menú si está abierto
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
      <div style={{ minHeight: '100vh', background: '#141418', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="spin" /><span style={{ color: '#8b8997', fontSize: 14 }}>Cargando...</span>
      </div>
    )
  }

  return (
    <div className="poshome-root">

      {/* ── HEADER (igual a .topbar del ERP) ── */}
      <header className="pos-header">
        <img src="/icon-192.png" className="pos-header-logo" alt="Freakie Dogs" />
        <span className="pos-header-brand">Freakie POS</span>
        {onChangeStore ? (
          <button
            className="pos-header-store"
            onClick={onChangeStore}
            style={{ cursor: 'pointer', background: 'none', border: '1px solid #2a2a32', borderRadius: 6, padding: '2px 8px', color: '#ff6b35', fontWeight: 700, fontSize: 13 }}
            title="Cambiar sucursal"
          >
            {storeName} ▾
          </button>
        ) : (
          <span className="pos-header-store">{storeName}</span>
        )}
        <span className="pos-header-sep" />
        <span className="pos-header-user">{user.nombre?.split(' ')[0]}</span>
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
                  <div key={mesa.id} style={{ position: 'relative' }}>
                  <button
                    className="poshome-mesa-tile"
                    style={{ background: colors.bg, borderColor: colors.border }}
                    onClick={() => handleMesaClick(mesa)}
                    onTouchStart={() => handleMesaTouchStart(mesa)}
                    onTouchEnd={handleMesaTouchEnd}
                    onContextMenu={e => { e.preventDefault(); if (cuenta) setMesaMenu(mesa) }}
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
                  {/* Menú contextual liberar mesa */}
                  {mesaMenu?.id === mesa.id && cuenta && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4, zIndex: 50,
                      background: '#1e1e26', border: '1px solid #ff6b35', borderRadius: 8,
                      padding: '6px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,.6)',
                    }}>
                      <button
                        style={{ display: 'block', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#f4a261', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => handleLiberarMesa(mesa)}
                      >🔓 Liberar mesa</button>
                      <button
                        style={{ display: 'block', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#8b8997', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => setMesaMenu(null)}
                      >✕ Cancelar</button>
                    </div>
                  )}
                  </div>
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
                const info   = TIPO_INFO[c.tipo] || { icon: '📦', label: c.tipo, color: '#8b8997' }
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
            <div style={{ color: '#8b8997', fontSize: 14, marginTop: 8 }}>
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
            <div style={{ color: '#8b8997', fontSize: 14, marginTop: 8 }}>Sin órdenes activas</div>
            <div style={{ color: '#6b6878', fontSize: 12 }}>Usa los botones de abajo para crear una nueva</div>
          </div>
        )}

      </div>

      {/* ── BARRA INFERIOR: NUEVA ORDEN ── */}
      <div className="poshome-quick-bar">
        {/* Mesa: solo si hay mesas configuradas */}
        {hasMesas && (
          <button
            className="poshome-quick-btn"
            style={{ '--qt-color': '#2dd4a8' }}
            onClick={() => setFiltro('mesa')}
          >
            <span className="poshome-quick-icon">🪑</span>
            <span className="poshome-quick-label">Mesas</span>
          </button>
        )}
        {/* Para Llevar / Delivery / PedidosYa / Drive: solo cajero+ (no mesero) */}
        {!MESERO_ROLES.includes(user.rol) && (<>
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
        </>)}
        {/* KDS: acceso rápido para cocina / gerente / admin / ejecutivo */}
        {KDS_ROLES.includes(user.rol) && onGoToKDS && (
          <button className="poshome-quick-btn" style={{ '--qt-color': '#ff6b35' }} onClick={onGoToKDS}>
            <span className="poshome-quick-icon">🍳</span><span className="poshome-quick-label">Cocina KDS</span>
          </button>
        )}
        {/* Historial: cajero+ (cajero, cajera, gerente, admin, ejecutivo, superadmin) */}
        {!MESERO_ROLES.includes(user.rol) && onGoToHistorial && (
          <button className="poshome-quick-btn" style={{ '--qt-color': '#2dd4a8' }} onClick={onGoToHistorial}>
            <span className="poshome-quick-icon">📋</span><span className="poshome-quick-label">Historial</span>
          </button>
        )}
      </div>

    </div>
  )
}
