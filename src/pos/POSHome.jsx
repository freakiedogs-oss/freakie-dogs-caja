import { useState, useEffect, useCallback } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'

// ──────────────────────────────────────────────
// Config de tipos de orden (sin Mesa — esa se abre desde el plano)
// ──────────────────────────────────────────────
const QUICK_TYPES = [
  { tipo: 'para_llevar',    icon: '🥡', label: 'Para Llevar',  color: '#f4a261' },
  { tipo: 'delivery_propio',icon: '🛵', label: 'Delivery',     color: '#60a5fa' },
  { tipo: 'pedidos_ya',     icon: '📱', label: 'PedidosYa',    color: '#a78bfa' },
  { tipo: 'drive_through',  icon: '🚗', label: 'Drive Thru',   color: '#fbbf24' },
]

const ZONA_LABELS = {
  interior:  '🏠 Interior',
  principal: '🏠 Principal',
  terraza:   '🌿 Terraza',
  barra:     '🍺 Barra',
  vip:       '⭐ VIP',
  privado:   '🔒 Privado',
}

const ESTADO_ACTIVO = ['abierta','enviada_cocina','en_preparacion','lista','entregada']

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

export default function POSHome({ user, onStartOrder, onLogout }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  const [mesas,           setMesas]           = useState([])
  const [cuentas,         setCuentas]         = useState([])  // cuentas activas
  const [loading,         setLoading]         = useState(true)
  const [selectedZona,    setSelectedZona]    = useState(null)
  const [hasMesas,        setHasMesas]        = useState(false)
  const [refreshKey,      setRefreshKey]      = useState(0)

  // ── Cargar mesas + cuentas abiertas ──
  const load = useCallback(async () => {
    setLoading(true)

    const [{ data: mesasData }, { data: cuentasData }] = await Promise.all([
      db.from('pos_mesas')
        .select('*')
        .eq('store_code', storeCode)
        .eq('activa', true)
        .order('numero'),
      db.from('pos_cuentas')
        .select(`
          id, tipo, mesa_ref, store_code, estado,
          subtotal, total, created_at,
          pos_cuenta_items(id)
        `)
        .eq('store_code', storeCode)
        .in('estado', ESTADO_ACTIVO)
        .order('created_at'),
    ])

    const mList = mesasData || []
    setMesas(mList)
    setHasMesas(mList.length > 0)
    if (mList.length > 0) {
      setSelectedZona(mList[0].zona || 'principal')
    }
    setCuentas(cuentasData || [])
    setLoading(false)
  }, [storeCode])

  useEffect(() => { load() }, [load, refreshKey])

  // Suscripción Realtime a cuentas activas
  useEffect(() => {
    const sub = db
      .channel('pos_home_cuentas')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pos_cuentas',
        filter: `store_code=eq.${storeCode}`,
      }, () => setRefreshKey(k => k + 1))
      .subscribe()
    return () => db.removeChannel(sub)
  }, [storeCode])

  // ── Mapa mesa → cuenta ──
  const cuentaPorMesa = {}
  cuentas.forEach(c => {
    if (c.mesa_ref) cuentaPorMesa[c.mesa_ref] = c
  })

  // ── Zonas ──
  const zonas = [...new Set(mesas.map(m => m.zona || 'principal'))]
  const mesasZona = mesas.filter(m => (m.zona || 'principal') === selectedZona)

  // ── Cuentas no-mesa (para llevar, delivery, etc.) ──
  const cuentasRapidas = cuentas.filter(c => c.tipo !== 'mesa')

  // ── Handlers ──
  const handleMesaClick = (mesa) => {
    const cuentaExistente = cuentaPorMesa[String(mesa.numero)]
    onStartOrder({
      tipo:     'mesa',
      mesa_ref: String(mesa.numero),
      mesa_id:  mesa.id,
      cuentaId: cuentaExistente?.id || null,
    })
  }

  const handleCuentaRapidaClick = (cuenta) => {
    onStartOrder({
      tipo:     cuenta.tipo,
      mesa_ref: null,
      mesa_id:  null,
      cuentaId: cuenta.id,
    })
  }

  const handleQuickType = (tipo) => {
    onStartOrder({ tipo, mesa_ref: null, mesa_id: null, cuentaId: null })
  }

  // ── Estado de mesa ──
  const getMesaStatus = (mesa) => {
    const cuenta = cuentaPorMesa[String(mesa.numero)]
    if (!cuenta) return 'libre'
    if (['lista', 'entregada'].includes(cuenta.estado)) return 'lista'
    return 'activa'
  }

  const STATUS_COLORS = {
    libre:  { bg: '#0d1a10', border: '#4ade80', text: '#4ade80' },
    activa: { bg: '#1a1200', border: '#fbbf24', text: '#fbbf24' },
    lista:  { bg: '#0a1520', border: '#60a5fa', text: '#60a5fa' },
  }

  // ── Render loading ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="spin" />
        <span style={{ color: '#555', fontSize: 14 }}>Cargando...</span>
      </div>
    )
  }

  const totalAbiertas = cuentas.length

  return (
    <div className="poshome-root">

      {/* ── HEADER ── */}
      <header className="pos-header">
        <span className="pos-header-brand">🍔 FREAKIE POS</span>
        <span className="pos-header-store">{storeName}</span>
        <span className="poshome-badge">
          {totalAbiertas > 0
            ? <><span style={{ color: '#fbbf24' }}>●</span> {totalAbiertas} abiert{totalAbiertas === 1 ? 'a' : 'as'}</>
            : <><span style={{ color: '#4ade80' }}>●</span> Sin órdenes</>
          }
        </span>
        <span className="pos-header-user">👤 {user.nombre?.split(' ')[0]}</span>
        <Clock />
        <button className="pos-header-btn danger" onClick={onLogout}>Salir</button>
      </header>

      <div className="poshome-body">

        {/* ── PLANO DE MESAS ── */}
        {hasMesas && (
          <section className="poshome-section">
            <div className="poshome-section-header">
              <span className="poshome-section-title">🪑 Mesas</span>
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
                const colors  = STATUS_COLORS[status]
                const itemCnt = cuenta?.pos_cuenta_items?.length || 0

                return (
                  <button
                    key={mesa.id}
                    className="poshome-mesa-tile"
                    style={{ background: colors.bg, borderColor: colors.border }}
                    onClick={() => handleMesaClick(mesa)}
                  >
                    <div className="poshome-mesa-num" style={{ color: colors.text }}>
                      {mesa.numero}
                    </div>

                    {status === 'libre' ? (
                      <div className="poshome-mesa-status libre">
                        libre · {mesa.capacidad || 4}👥
                      </div>
                    ) : (
                      <>
                        <div className="poshome-mesa-total" style={{ color: colors.text }}>
                          ${parseFloat(cuenta.subtotal || 0).toFixed(2)}
                        </div>
                        <div className="poshome-mesa-meta">
                          {itemCnt} ítem{itemCnt !== 1 ? 's' : ''} · {elapsed(cuenta.created_at)}
                        </div>
                        {status === 'lista' && (
                          <div className="poshome-mesa-ready">✓ Lista</div>
                        )}
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ── CUENTAS ABIERTAS NO-MESA ── */}
        {cuentasRapidas.length > 0 && (
          <section className="poshome-section">
            <div className="poshome-section-header">
              <span className="poshome-section-title">📋 Órdenes Abiertas</span>
            </div>
            <div className="poshome-cuentas-list">
              {cuentasRapidas.map(c => {
                const TIPO_INFO = {
                  'para_llevar':    { icon: '🥡', label: 'Para Llevar',  color: '#f4a261' },
                  'delivery_propio':{ icon: '🛵', label: 'Delivery',     color: '#60a5fa' },
                  'pedidos_ya':     { icon: '📱', label: 'PedidosYa',    color: '#a78bfa' },
                  'drive_through':  { icon: '🚗', label: 'Drive Thru',   color: '#fbbf24' },
                }
                const info = TIPO_INFO[c.tipo] || { icon: '📦', label: c.tipo, color: '#888' }
                const items = c.pos_cuenta_items?.length || 0
                return (
                  <button
                    key={c.id}
                    className="poshome-cuenta-row"
                    style={{ borderLeftColor: info.color }}
                    onClick={() => handleCuentaRapidaClick(c)}
                  >
                    <span className="poshome-cuenta-icon">{info.icon}</span>
                    <span className="poshome-cuenta-label" style={{ color: info.color }}>
                      {info.label}
                    </span>
                    <span className="poshome-cuenta-items">{items} ítem{items !== 1 ? 's' : ''}</span>
                    <span className="poshome-cuenta-total">${parseFloat(c.subtotal || 0).toFixed(2)}</span>
                    <span className="poshome-cuenta-time">{elapsed(c.created_at)}</span>
                    <span className="poshome-cuenta-arrow">→</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ── MENSAJE SI NO HAY MESAS NI CUENTAS ── */}
        {!hasMesas && cuentas.length === 0 && (
          <div className="poshome-empty">
            <div style={{ fontSize: 48 }}>🍔</div>
            <div style={{ color: '#444', fontSize: 14, marginTop: 8 }}>
              Sin órdenes activas
            </div>
          </div>
        )}

      </div>

      {/* ── BARRA INFERIOR: ÓRDENES RÁPIDAS ── */}
      <div className="poshome-quick-bar">
        {QUICK_TYPES.map(qt => (
          <button
            key={qt.tipo}
            className="poshome-quick-btn"
            style={{ '--qt-color': qt.color }}
            onClick={() => handleQuickType(qt.tipo)}
          >
            <span className="poshome-quick-icon">{qt.icon}</span>
            <span className="poshome-quick-label">{qt.label}</span>
          </button>
        ))}
      </div>

    </div>
  )
}
