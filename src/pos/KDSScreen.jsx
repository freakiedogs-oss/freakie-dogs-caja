import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'

// ──────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────
const CANAL_INFO = {
  mesa:            { icon: '🪑', label: 'Sucursal',    color: '#4ade80' },
  para_llevar:     { icon: '🥡', label: 'Para Llevar', color: '#f4a261' },
  delivery_propio: { icon: '🛵', label: 'Delivery',    color: '#60a5fa' },
  pedidos_ya:      { icon: '📱', label: 'PedidosYa',   color: '#a78bfa' },
  drive_through:   { icon: '🚗', label: 'Drive Thru',  color: '#fbbf24' },
}

// Sucursal = mesa + para_llevar (se atienden juntos en cocina)
const CANAL_FILTER = {
  todos:      null,
  sucursal:   ['mesa', 'para_llevar'],
  delivery:   ['delivery_propio'],
  pedidos_ya: ['pedidos_ya'],
  drive:      ['drive_through'],
}

const FILTROS = [
  { key: 'todos',      icon: '📋', label: 'Todos'       },
  { key: 'sucursal',   icon: '🏠', label: 'Sucursal'    },
  { key: 'delivery',   icon: '🛵', label: 'Delivery'    },
  { key: 'pedidos_ya', icon: '📱', label: 'PedidosYa'   },
  { key: 'drive',      icon: '🚗', label: 'Drive Thru'  },
]

const ESTACIONES = [
  { key: 'general',  icon: '🍳', label: 'General'   },
  { key: 'parrilla', icon: '🔥', label: 'Parrilla'  },
  { key: 'freidora', icon: '🍟', label: 'Freidora'  },
  { key: 'bebidas',  icon: '🥤', label: 'Bebidas'   },
  { key: 'ensamble', icon: '📦', label: 'Ensamble'  },
]

// Tiempo transcurrido con color
function useTimer() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(id)
  }, [])
  return tick
}

function elapsed(isoStr) {
  if (!isoStr) return { text: '', color: '#555', urgent: false }
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000)
  if (mins < 5)  return { text: `${mins}m`,                    color: '#4ade80', urgent: false }
  if (mins < 10) return { text: `${mins}m`,                    color: '#fbbf24', urgent: false }
  if (mins < 20) return { text: `${mins}m ⚡`,                  color: '#f97316', urgent: true  }
  return             { text: `${Math.floor(mins/60)}h${mins%60}m ‼️`, color: '#f87171', urgent: true  }
}

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

// Beep de alerta para nuevas órdenes
function playBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type      = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch (_) {}
}

// ──────────────────────────────────────────────
// KDSScreen
// ──────────────────────────────────────────────
export default function KDSScreen({ user, onBack }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  const [mode,        setMode]        = useState('canal')    // 'canal' | 'estacion'
  const [filtroCanal, setFiltroCanal] = useState('todos')
  const [filtroEst,   setFiltroEst]   = useState('general')
  const [queue,       setQueue]       = useState([])         // rows de pos_cocina_queue
  const [historial,   setHistorial]   = useState([])         // rows de pos_cocina_queue completadas hoy
  const [loading,     setLoading]     = useState(true)
  const [bumping,     setBumping]     = useState(null)       // cuenta_id+comanda en proceso
  const [tab,         setTab]         = useState('activas')  // 'activas' | 'historial'
  const [reverting,   setReverting]   = useState(null)       // id de item en revert
  const prevCount = useRef(0)
  useTimer()  // fuerza re-render cada 10s para actualizar timers

  // ── Carga ──
  const load = useCallback(async () => {
    const { data } = await db
      .from('pos_cocina_queue')
      .select('*')
      .eq('store_code', storeCode)
      .neq('estado', 'completado')
      .order('recibido_at', { ascending: true })

    const rows = data || []
    // Detectar nuevas órdenes para beep
    if (rows.length > prevCount.current && prevCount.current > 0) playBeep()
    prevCount.current = rows.length
    setQueue(rows)
    setLoading(false)
  }, [storeCode])

  // ── Carga Historial (completadas hoy) ──
  const loadHistorial = useCallback(async () => {
    const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0]
    const { data } = await db
      .from('pos_cocina_queue')
      .select('*')
      .eq('store_code', storeCode)
      .eq('estado', 'completado')
      .gte('completado_at', `${today}T00:00:00`)
      .order('completado_at', { ascending: false })

    setHistorial(data || [])
  }, [storeCode])

  useEffect(() => {
    load()
    loadHistorial()
  }, [load, loadHistorial])

  // Realtime
  useEffect(() => {
    const sub = db.channel('kds_rt')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pos_cocina_queue',
        filter: `store_code=eq.${storeCode}`,
      }, () => {
        load()
        loadHistorial()
      })
      .subscribe()
    return () => db.removeChannel(sub)
  }, [storeCode, load, loadHistorial])

  // ── Grouping ──
  // Agrupar queue por (cuenta_id + comanda_numero) → una "comanda"
  const buildComandas = (rows) => {
    const map = new Map()
    rows.forEach(row => {
      const key = `${row.cuenta_id}__${row.comanda_numero ?? 0}`
      if (!map.has(key)) {
        map.set(key, {
          key,
          cuenta_id:      row.cuenta_id,
          comanda_numero: row.comanda_numero,
          canal:          row.canal || 'mesa',
          mesa_ref:       row.mesa_ref,
          recibido_at:    row.recibido_at,
          items:          [],
        })
      }
      map.get(key).items.push(row)
    })
    return [...map.values()].sort((a, b) =>
      new Date(a.recibido_at) - new Date(b.recibido_at)
    )
  }

  // ── Filtrar según modo + filtro activo ──
  const filteredQueue = queue.filter(row => {
    if (mode === 'canal') {
      const canales = CANAL_FILTER[filtroCanal]
      return canales ? canales.includes(row.canal) : true
    } else {
      return row.estacion === filtroEst
    }
  })

  const comandas = buildComandas(filteredQueue)

  // Conteos para badges
  const conteos = {}
  FILTROS.forEach(f => {
    const c = CANAL_FILTER[f.key]
    conteos[f.key] = c ? queue.filter(r => c.includes(r.canal)).length : queue.length
  })
  const contEst = {}
  ESTACIONES.forEach(e => {
    contEst[e.key] = queue.filter(r => (r.estacion || 'general') === e.key).length
  })

  // ── Acciones ──
  // Marcar ítem individual como en_preparacion / listo
  const toggleItem = async (queueId, estadoActual) => {
    const siguiente = estadoActual === 'pendiente' ? 'en_preparacion'
      : estadoActual === 'en_preparacion' ? 'completado'
      : 'pendiente'
    await db.from('pos_cocina_queue')
      .update({ estado: siguiente, ...(siguiente === 'completado' ? { completado_at: new Date().toISOString() } : {}) })
      .eq('id', queueId)
    load()
  }

  // Marcar toda la comanda como LISTA → actualizar cuenta a 'lista'
  const bumparComanda = async (comanda) => {
    setBumping(comanda.key)
    try {
      // Marcar todos los ítems de esta comanda como completados
      const ids = comanda.items.map(i => i.id)
      await db.from('pos_cocina_queue')
        .update({ estado: 'completado', completado_at: new Date().toISOString() })
        .in('id', ids)

      // Actualizar cuenta a 'lista' SOLO si no está cobrada (evitar race condition)
      const { data: cuenta } = await db
        .from('pos_cuentas')
        .select('estado')
        .eq('id', comanda.cuenta_id)
        .single()

      if (cuenta?.estado !== 'cobrada') {
        await db.from('pos_cuentas')
          .update({ estado: 'lista', updated_at: new Date().toISOString() })
          .eq('id', comanda.cuenta_id)
      }

      load()
      loadHistorial()
    } finally {
      setBumping(null)
    }
  }

  // Revertir comanda completada → volver a pendiente
  const revertirComanda = async (comanda) => {
    setReverting(comanda.key)
    try {
      // Verificar que cuenta NO esté cobrada
      const { data: cuenta } = await db
        .from('pos_cuentas')
        .select('estado')
        .eq('id', comanda.cuenta_id)
        .single()

      if (cuenta?.estado === 'cobrada') {
        alert('No se puede revertir una comanda de una cuenta cobrada.')
        return
      }

      // Marcar todos los ítems como pendiente
      const ids = comanda.items.map(i => i.id)
      await db.from('pos_cocina_queue')
        .update({ estado: 'pendiente', completado_at: null })
        .in('id', ids)

      // Actualizar cuenta a en_preparacion
      await db.from('pos_cuentas')
        .update({ estado: 'en_preparacion', updated_at: new Date().toISOString() })
        .eq('id', comanda.cuenta_id)

      load()
      loadHistorial()
    } finally {
      setReverting(null)
    }
  }

  // ── Render ──
  const canalInfo = (canal) => CANAL_INFO[canal] || { icon: '📦', label: canal, color: '#888' }

  return (
    <div className="kds-root">

      {/* ── HEADER ── */}
      <header className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
        <span className="pos-header-brand">🍳 Cocina KDS</span>
        <span className="pos-header-store">{storeName}</span>

        {/* Toggle ACTIVAS / HISTORIAL */}
        <div className="kds-mode-toggle">
          <button
            className={`kds-mode-btn${tab === 'activas' ? ' active' : ''}`}
            onClick={() => setTab('activas')}
          >🍳 Activas</button>
          <button
            className={`kds-mode-btn${tab === 'historial' ? ' active' : ''}`}
            onClick={() => setTab('historial')}
          >📋 Historial</button>
        </div>

        {tab === 'activas' && (
          <>
            {/* Toggle CANAL / ESTACIÓN */}
            <div className="kds-mode-toggle">
              <button
                className={`kds-mode-btn${mode === 'canal' ? ' active' : ''}`}
                onClick={() => setMode('canal')}
              >🏷 Canal</button>
              <button
                className={`kds-mode-btn${mode === 'estacion' ? ' active' : ''}`}
                onClick={() => setMode('estacion')}
              >⚙️ Estación</button>
            </div>

            <span className="pos-header-sep" />
            <span style={{ fontSize: 12, color: queue.length > 0 ? '#fbbf24' : '#4ade80', fontWeight: 700 }}>
              {queue.length > 0 ? `● ${queue.length} pendiente${queue.length !== 1 ? 's' : ''}` : '● Sin órdenes'}
            </span>
          </>
        )}
        <Clock />
      </header>

      {/* ── BARRA DE FILTROS ── */}
      {tab === 'activas' && (
        mode === 'canal' ? (
          <div className="poshome-filters">
            {FILTROS.map(f => {
              const cnt = conteos[f.key] ?? 0
              // Ocultar Drive Thru si no es Lourdes (S003)
              if (f.key === 'drive' && storeCode !== 'S003') return null
              return (
                <button
                  key={f.key}
                  className={`poshome-filter-btn${filtroCanal === f.key ? ' active' : ''}`}
                  onClick={() => setFiltroCanal(f.key)}
                >
                  <span className="poshome-filter-icon">{f.icon}</span>
                  <span className="poshome-filter-label">{f.label}</span>
                  {cnt > 0 && <span className="poshome-filter-badge">{cnt}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="poshome-filters">
            {ESTACIONES.map(e => {
              const cnt = contEst[e.key] ?? 0
              return (
                <button
                  key={e.key}
                  className={`poshome-filter-btn${filtroEst === e.key ? ' active' : ''}`}
                  onClick={() => setFiltroEst(e.key)}
                >
                  <span className="poshome-filter-icon">{e.icon}</span>
                  <span className="poshome-filter-label">{e.label}</span>
                  {cnt > 0 && <span className="poshome-filter-badge">{cnt}</span>}
                </button>
              )
            })}
          </div>
        )
      )}

      {/* ── CUERPO ── */}
      <div className="kds-body">
        {tab === 'activas' ? (
          // ── VISTA ACTIVAS ──
          loading ? (
            <div className="pos-loading">
              <div className="spin" style={{ width: 32, height: 32 }} />
              <span>Cargando cocina...</span>
            </div>
          ) : comandas.length === 0 ? (
            <div className="kds-empty">
              <div style={{ fontSize: 56 }}>✅</div>
              <div style={{ color: '#4ade80', fontSize: 18, fontWeight: 700, marginTop: 12 }}>
                Cocina al día
              </div>
              <div style={{ color: '#444', fontSize: 13, marginTop: 4 }}>
                Sin órdenes pendientes
              </div>
            </div>
          ) : (
            <div className="kds-cards-grid">
              {comandas.map(comanda => {
                const info       = canalInfo(comanda.canal)
                const timer      = elapsed(comanda.recibido_at)
                const todosListos = comanda.items.every(i => i.estado === 'completado')
                const isBumping   = bumping === comanda.key
                const totalItems  = comanda.items.reduce((s, i) => s + (i.cantidad || 1), 0)

                return (
                  <div
                    key={comanda.key}
                    className="kds-card"
                    style={{ borderTopColor: info.color, ...(timer.urgent ? { boxShadow: `0 0 0 1px ${timer.color}33` } : {}) }}
                  >
                    {/* Card header */}
                    <div className="kds-card-header">
                      <div className="kds-card-title">
                        <span style={{ color: info.color, fontSize: 18 }}>{info.icon}</span>
                        <span className="kds-card-canal" style={{ color: info.color }}>
                          {comanda.canal === 'mesa' ? `Mesa #${comanda.mesa_ref}` : info.label}
                        </span>
                        {comanda.comanda_numero && (
                          <span className="kds-card-num">#{comanda.comanda_numero}</span>
                        )}
                      </div>
                      <span className="kds-card-timer" style={{ color: timer.color }}>
                        {timer.text}
                      </span>
                    </div>

                    {/* Items */}
                    <div className="kds-card-items">
                      {comanda.items.map(item => {
                        const done = item.estado === 'completado'
                        const inProg = item.estado === 'en_preparacion'
                        return (
                          <button
                            key={item.id}
                            className={`kds-item${done ? ' done' : inProg ? ' inprog' : ''}`}
                            onClick={() => toggleItem(item.id, item.estado)}
                            title="Toca para cambiar estado"
                          >
                            <span className="kds-item-status">
                              {done ? '✅' : inProg ? '🔄' : '○'}
                            </span>
                            <span className="kds-item-qty">{item.cantidad || 1}×</span>
                            <span className="kds-item-name">{item.nombre_item}</span>
                            {item.nota && (
                              <span className="kds-item-nota">📝 {item.nota}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {/* Resumen + botón LISTA */}
                    <div className="kds-card-footer">
                      <span className="kds-card-count">
                        {comanda.items.filter(i => i.estado === 'completado').length}/{comanda.items.length} listos
                      </span>
                      <button
                        className={`kds-bump-btn${todosListos ? ' ready' : ''}`}
                        onClick={() => bumparComanda(comanda)}
                        disabled={isBumping}
                      >
                        {isBumping ? '⏳' : todosListos ? '✓ LISTA' : '▷ LISTA'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          // ── VISTA HISTORIAL ──
          loading ? (
            <div className="pos-loading">
              <div className="spin" style={{ width: 32, height: 32 }} />
              <span>Cargando historial...</span>
            </div>
          ) : historial.length === 0 ? (
            <div className="kds-empty">
              <div style={{ fontSize: 56 }}>📋</div>
              <div style={{ color: '#888', fontSize: 18, fontWeight: 700, marginTop: 12 }}>
                Sin completadas hoy
              </div>
              <div style={{ color: '#444', fontSize: 13, marginTop: 4 }}>
                Las órdenes completadas aparecerán aquí
              </div>
            </div>
          ) : (
            <div className="kds-cards-grid">
              {/* Agrupar historial por comanda */}
              {(() => {
                const map = new Map()
                historial.forEach(row => {
                  const key = `${row.cuenta_id}__${row.comanda_numero ?? 0}`
                  if (!map.has(key)) {
                    map.set(key, {
                      key,
                      cuenta_id:      row.cuenta_id,
                      comanda_numero: row.comanda_numero,
                      canal:          row.canal || 'mesa',
                      mesa_ref:       row.mesa_ref,
                      completado_at:  row.completado_at,
                      items:          [],
                    })
                  }
                  map.get(key).items.push(row)
                })
                return [...map.values()].map(comanda => {
                  const info = canalInfo(comanda.canal)
                  const isReverting = reverting === comanda.key

                  // Calcular tiempo desde completado
                  const completedTime = comanda.items[0]?.completado_at
                  const mins = Math.floor((Date.now() - new Date(completedTime).getTime()) / 60000)
                  const timeStr = mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h${mins%60}m`

                  return (
                    <div
                      key={comanda.key}
                      className="kds-card"
                      style={{ borderTopColor: info.color, opacity: 0.85 }}
                    >
                      {/* Card header */}
                      <div className="kds-card-header">
                        <div className="kds-card-title">
                          <span style={{ color: info.color, fontSize: 18 }}>{info.icon}</span>
                          <span className="kds-card-canal" style={{ color: info.color }}>
                            {comanda.canal === 'mesa' ? `Mesa #${comanda.mesa_ref}` : info.label}
                          </span>
                          {comanda.comanda_numero && (
                            <span className="kds-card-num">#{comanda.comanda_numero}</span>
                          )}
                        </div>
                        <span className="kds-card-timer" style={{ color: '#4ade80' }}>
                          ✓ {timeStr}
                        </span>
                      </div>

                      {/* Items */}
                      <div className="kds-card-items">
                        {comanda.items.map(item => (
                          <div
                            key={item.id}
                            className="kds-item done"
                            style={{ opacity: 0.8 }}
                          >
                            <span className="kds-item-status">✅</span>
                            <span className="kds-item-qty">{item.cantidad || 1}×</span>
                            <span className="kds-item-name">{item.nombre_item}</span>
                            {item.nota && (
                              <span className="kds-item-nota">📝 {item.nota}</span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Botón Revertir */}
                      <div className="kds-card-footer">
                        <span className="kds-card-count" style={{ color: '#4ade80' }}>
                          {comanda.items.length} item{comanda.items.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          className="kds-revert-btn"
                          onClick={() => revertirComanda(comanda)}
                          disabled={isReverting}
                          title="Volver a en preparación (solo si no está cobrada)"
                        >
                          {isReverting ? '⏳' : '↩ Revertir'}
                        </button>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          )
        )}
      </div>
    </div>
  )
}
