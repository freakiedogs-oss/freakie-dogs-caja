import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../supabase'
import Icon from './Icon'
import { STORES } from '../config'
import { useToast } from '../hooks/useToast'

// ──────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────
const CANAL_INFO = {
  mesa:            { ic: 'armchair', label: 'Sucursal',    color: '#2dd4a8' },
  para_llevar:     { ic: 'bag',      label: 'Para Llevar', color: '#f4a261' },
  delivery_propio: { ic: 'bike',     label: 'Delivery',    color: '#60a5fa' },
  pedidos_ya:      { ic: 'bike',     label: 'PedidosYa',   color: '#a78bfa' },
  drive_through:   { ic: 'car',      label: 'Drive Thru',  color: '#fbbf24' },
  delivery_app:    { ic: 'phone',    label: 'App Delivery', color: '#f472b6' },
}

// Sucursal = mesa + para_llevar (se atienden juntos en cocina)
const CANAL_FILTER = {
  todos:      null,
  sucursal:   ['mesa', 'para_llevar'],
  delivery:   ['delivery_propio', 'delivery_app'],
  pedidos_ya: ['pedidos_ya'],
  drive:      ['drive_through'],
}

const FILTROS = [
  { key: 'todos',      ic: 'grid',     label: 'Todos'       },
  { key: 'sucursal',   ic: 'armchair', label: 'Sucursal'    },
  { key: 'delivery',   ic: 'bike',     label: 'Delivery'    },
  { key: 'pedidos_ya', ic: 'bike',     label: 'PedidosYa'   },
  { key: 'drive',      ic: 'car',      label: 'Drive Thru'  },
]

const ESTACIONES = [
  { key: 'general',  ic: 'chef',  label: 'General'   },
  { key: 'parrilla', ic: 'flame', label: 'Parrilla'  },
  { key: 'freidora', ic: 'bag',   label: 'Freidora'  },
  { key: 'bebidas',  ic: 'cup',   label: 'Bebidas'   },
  { key: 'ensamble', ic: 'box',   label: 'Ensamble'  },
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
  if (!isoStr) return { text: '', color: '#8b8997', urgent: false }
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000)
  if (mins < 5)  return { text: `${mins}m`,                    color: '#2dd4a8', urgent: false }
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

// Beep de alerta para nuevas órdenes.
// Contexto de audio persistente; se "desbloquea"/reanuda con cualquier interacción
// del usuario (política de autoplay del navegador).
let _audioCtx = null
function getAudioCtx() {
  if (typeof window === 'undefined') return null
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)() } catch { return null }
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
  return _audioCtx
}

function _tone(ctx, freq, start, dur) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain); gain.connect(ctx.destination)
  osc.type = 'triangle'
  const t = ctx.currentTime + start
  osc.frequency.setValueAtTime(freq, t)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.start(t)
  osc.stop(t + dur + 0.03)
}

// Campanita "ding-dong" repetida para llamar la atención en cocina
function playBeep() {
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    _tone(ctx, 988, 0.00, 0.18)   // B5
    _tone(ctx, 1319, 0.20, 0.32)  // E6
    _tone(ctx, 988, 0.58, 0.18)
    _tone(ctx, 1319, 0.78, 0.34)
  } catch (_) {}
}

// ──────────────────────────────────────────────
// KDSScreen
// ──────────────────────────────────────────────
export default function KDSScreen({ user, onBack }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode
  const toast = useToast()

  const [mode,        setMode]        = useState('canal')    // 'canal' | 'estacion'
  const [filtroCanal, setFiltroCanal] = useState('todos')
  const [filtroEst,   setFiltroEst]   = useState('general')
  const [queue,       setQueue]       = useState([])         // rows de pos_cocina_queue
  const [historial,   setHistorial]   = useState([])         // rows de pos_cocina_queue completadas hoy
  const [loading,     setLoading]     = useState(true)
  const [bumping,     setBumping]     = useState(null)       // cuenta_id+comanda en proceso
  const [tab,         setTab]         = useState('activas')  // 'activas' | 'historial'
  const [reverting,   setReverting]   = useState(null)       // id de item en revert
  const prevIds = useRef(null)   // Set de ids ya vistos (null = primera carga, no suena)
  useTimer()  // fuerza re-render cada 10s para actualizar timers

  // Desbloquear/reanudar audio con la primera interacción (autoplay policy)
  useEffect(() => {
    const unlock = () => getAudioCtx()
    unlock()  // intento al montar (venimos de un clic de navegación)
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // ── Carga ──
  const load = useCallback(async () => {
    const { data } = await db
      .from('pos_cocina_queue')
      .select('*')
      .eq('store_code', storeCode)
      .neq('estado', 'completado')
      .order('recibido_at', { ascending: true })

    const rows = data || []
    // Beep si aparece alguna fila NUEVA (id no visto antes). La 1ª carga no suena.
    const ids = new Set(rows.map(r => r.id))
    if (prevIds.current && rows.some(r => !prevIds.current.has(r.id))) playBeep()
    prevIds.current = ids
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
          pager:          row.pager,
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
        toast.warning('No se puede revertir una comanda de una cuenta cobrada.')
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
  const canalInfo = (canal) => CANAL_INFO[canal] || { ic: 'box', label: canal, color: '#8b8997' }

  return (
    <div className="kds-root">

      {/* ── HEADER ── */}
      <header className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
        <span className="pos-header-brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="chef" size={18} /> Cocina KDS</span>
        <span className="pos-header-store">{storeName}</span>

        {/* Toggle ACTIVAS / HISTORIAL */}
        <div className="kds-mode-toggle">
          <button
            className={`kds-mode-btn${tab === 'activas' ? ' active' : ''}`}
            onClick={() => setTab('activas')}
          ><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chef" size={15} /> Activas</span></button>
          <button
            className={`kds-mode-btn${tab === 'historial' ? ' active' : ''}`}
            onClick={() => setTab('historial')}
          ><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="list" size={15} /> Historial</span></button>
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
            <span style={{ fontSize: 12, color: queue.length > 0 ? '#fbbf24' : '#2dd4a8', fontWeight: 700 }}>
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
                  <span className="poshome-filter-icon"><Icon name={f.ic} size={16} /></span>
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
                  <span className="poshome-filter-icon"><Icon name={e.ic} size={16} /></span>
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
              <div style={{ display: 'flex', justifyContent: 'center' }}><Icon name="check" size={52} color="#2dd4a8" /></div>
              <div style={{ color: '#2dd4a8', fontSize: 18, fontWeight: 700, marginTop: 12 }}>
                Cocina al día
              </div>
              <div style={{ color: '#8b8997', fontSize: 13, marginTop: 4 }}>
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
                        <span style={{ color: info.color, display: 'inline-flex' }}><Icon name={info.ic} size={18} color={info.color} /></span>
                        <span className="kds-card-canal" style={{ color: info.color }}>
                          {comanda.canal === 'mesa' ? `Mesa #${comanda.mesa_ref}` : info.label}
                        </span>
                        {comanda.comanda_numero && (
                          <span className="kds-card-num">#{comanda.comanda_numero}</span>
                        )}
                        {comanda.pager != null && (
                          <span className="kds-card-num" style={{ background: '#fbbf24', color: '#000', fontSize: 18, fontWeight: 800, padding: '2px 10px' }}>📟 {comanda.pager}</span>
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
                              {done ? <Icon name="check" size={14} color="#2dd4a8" /> : inProg ? <Icon name="rotate" size={14} color="#fbbf24" /> : <Icon name="circle" size={12} color="#6b6878" />}
                            </span>
                            <span className="kds-item-qty">{item.cantidad || 1}×</span>
                            <span className="kds-item-name">{item.nombre_item}</span>
                            {Array.isArray(item.modificadores) && item.modificadores.length > 0 && (
                              <span className="kds-item-nota" style={{ color: '#2dd4a8' }}>
                                {item.modificadores.map(m => `+ ${m.nombre}${Number(m.precio_extra) > 0 ? ` ($${Number(m.precio_extra).toFixed(2)})` : ''}`).join('  ')}
                              </span>
                            )}
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
              <div style={{ display: 'flex', justifyContent: 'center' }}><Icon name="list" size={52} color="#43382f" /></div>
              <div style={{ color: '#8b8997', fontSize: 18, fontWeight: 700, marginTop: 12 }}>
                Sin completadas hoy
              </div>
              <div style={{ color: '#8b8997', fontSize: 13, marginTop: 4 }}>
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
          pager:          row.pager,
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
                          <span style={{ color: info.color, display: 'inline-flex' }}><Icon name={info.ic} size={18} color={info.color} /></span>
                          <span className="kds-card-canal" style={{ color: info.color }}>
                            {comanda.canal === 'mesa' ? `Mesa #${comanda.mesa_ref}` : info.label}
                          </span>
                          {comanda.comanda_numero && (
                            <span className="kds-card-num">#{comanda.comanda_numero}</span>
                          )}
                        {comanda.pager != null && (
                          <span className="kds-card-num" style={{ background: '#fbbf24', color: '#000', fontSize: 18, fontWeight: 800, padding: '2px 10px' }}>📟 {comanda.pager}</span>
                        )}
                        </div>
                        <span className="kds-card-timer" style={{ color: '#2dd4a8' }}>
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
                            <span className="kds-item-status"><Icon name="check" size={13} color="#2dd4a8" /></span>
                            <span className="kds-item-qty">{item.cantidad || 1}×</span>
                            <span className="kds-item-name">{item.nombre_item}</span>
                            {Array.isArray(item.modificadores) && item.modificadores.length > 0 && (
                              <span className="kds-item-nota" style={{ color: '#2dd4a8' }}>
                                {item.modificadores.map(m => `+ ${m.nombre}${Number(m.precio_extra) > 0 ? ` ($${Number(m.precio_extra).toFixed(2)})` : ''}`).join('  ')}
                              </span>
                            )}
                            {item.nota && (
                              <span className="kds-item-nota">📝 {item.nota}</span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Botón Revertir */}
                      <div className="kds-card-footer">
                        <span className="kds-card-count" style={{ color: '#2dd4a8' }}>
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
      <toast.Toast />
    </div>
  )
}
