import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'
import Icon from './Icon'
import PlanoEditor from './cajero/PlanoEditor'

// ──────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────
const TIPO_INFO = {
  mesa:            { ic: 'armchair', label: 'Mesas',       color: '#2dd4a8' },
  para_llevar:     { ic: 'bag',      label: 'Para Llevar', color: '#f4a261' },
  delivery_propio: { ic: 'bike',     label: 'Delivery',    color: '#60a5fa' },
  delivery_app:    { ic: 'phone',    label: 'App Delivery', color: '#f472b6' },
  pedidos_ya:      { ic: 'bike',     label: 'PedidosYa',   color: '#a78bfa' },
  drive_through:   { ic: 'car',      label: 'Drive Thru',  color: '#fbbf24' },
}

const FILTROS = [
  { key: 'todos',          ic: 'grid',     label: 'Todos'       },
  { key: 'mesa',           ic: 'armchair', label: 'Mesas'       },
  { key: 'para_llevar',    ic: 'bag',      label: 'Para Llevar' },
  { key: 'delivery_propio',ic: 'bike',     label: 'Delivery'    },
  { key: 'delivery_app',   ic: 'phone',    label: 'App'         },
  { key: 'pedidos_ya',     ic: 'bike',     label: 'PedidosYa'   },
  { key: 'drive_through',  ic: 'car',      label: 'Drive Thru'  },
]

const ZONA_LABELS = {
  interior:  'Interior',
  principal: 'Principal',
  terraza:   'Terraza',
  barra:     'Barra',
  vip:       'VIP',
  privado:   'Privado',
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
const EDIT_PLANO_ROLES = ['gerente', 'admin', 'ejecutivo', 'superadmin']

export default function POSHome({ user, onStartOrder, onLogout, onGoToKDS, onGoToHistorial, onGoToCierre, onGoToMenuAdmin, onChangeStore }) {
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
  const [showPlanoEditor, setShowPlanoEditor] = useState(false)
  const [aperturaMesa, setAperturaMesa] = useState(null)      // mesa libre que se está abriendo (modal demografía)
  const [pax,          setPax]          = useState({ m: 1, h: 1, k: 0 })
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
        .select('id, tipo, mesa_ref, store_code, estado, subtotal, total, created_at, cliente_nombre, delivery_direccion, delivery_referencia, delivery_plataforma, pos_cuenta_items!pos_cuenta_items_cuenta_id_fkey(id)')
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
    delivery_app:    cuentas.filter(c => c.tipo === 'delivery_app').length,
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
    if (c) {
      // Mesa ocupada → continuar su cuenta
      onStartOrder({ tipo: 'mesa', mesa_ref: String(mesa.numero), mesa_id: mesa.id, cuentaId: c.id })
    } else {
      // Mesa libre → pedir demografía antes de abrir
      setPax({ m: 1, h: 1, k: 0 })
      setAperturaMesa(mesa)
    }
  }

  const handleAbrirMesa = () => {
    if (!aperturaMesa) return
    const m = aperturaMesa
    setAperturaMesa(null)
    onStartOrder({
      tipo: 'mesa', mesa_ref: String(m.numero), mesa_id: m.id, cuentaId: null,
      pax: { mujeres: pax.m, hombres: pax.h, ninos: pax.k },
    })
  }
  const bump = (k, d) => setPax(p => ({ ...p, [k]: Math.max(0, p[k] + d) }))

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
            style={{ cursor: 'pointer', background: 'none', border: '1px solid #2a2a32', borderRadius: 6, padding: '2px 8px', color: '#E62329', fontWeight: 700, fontSize: 13 }}
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
              <span className="poshome-filter-icon"><Icon name={f.ic} size={18} /></span>
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
              <span className="poshome-section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="armchair" size={16} /> Plano de Mesas</span>
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
              {EDIT_PLANO_ROLES.includes(user.rol) && (
                <button
                  onClick={() => setShowPlanoEditor(true)}
                  style={{ background: 'none', border: '1px solid #43382f', color: '#9a9088', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}
                  title="Editar plano / agregar mesas"
                >
                  <Icon name="pencil" size={13} /> Editar plano
                </button>
              )}
            </div>

            <div className="poshome-plano" style={{ position: 'relative', width: '100%', aspectRatio: '100 / 55', background: '#15110f', border: '1px dashed #43382f', borderRadius: 12, margin: '4px 0', overflow: 'hidden' }}>
              {mesasZona.map((mesa, i) => {
                const status  = getMesaStatus(mesa)
                const cuenta  = cuentaPorMesa[String(mesa.numero)]
                const colors  = MESA_STATUS_COLORS[status]
                const itemCnt = cuenta?.pos_cuenta_items?.length || 0
                // Posición: usa pos_x/pos_y (plano 100×55) o auto-grid si faltan
                const hasPos = mesa.pos_x != null && parseFloat(mesa.pos_x) !== 0
                const px = hasPos ? parseFloat(mesa.pos_x) : 5 + (i % 5) * 19
                const py = hasPos ? parseFloat(mesa.pos_y) : 8 + Math.floor(i / 5) * 16
                const pw = hasPos ? parseFloat(mesa.ancho || 13) : 15
                const ph = hasPos ? parseFloat(mesa.alto || 10)  : 11
                const redonda = (mesa.forma || '') === 'redonda'
                return (
                  <div key={mesa.id} style={{ position: 'absolute', left: `${px}%`, top: `${py / 55 * 100}%`, width: `${pw}%`, height: `${ph / 55 * 100}%` }}>
                  <button
                    className="poshome-mesa-tile"
                    style={{ width: '100%', height: '100%', margin: 0, background: colors.bg, borderColor: colors.border, borderRadius: redonda ? '50%' : 12, padding: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}
                    onClick={() => handleMesaClick(mesa)}
                    onTouchStart={() => handleMesaTouchStart(mesa)}
                    onTouchEnd={handleMesaTouchEnd}
                    onContextMenu={e => { e.preventDefault(); if (cuenta) setMesaMenu(mesa) }}
                  >
                    <div className="poshome-mesa-num" style={{ color: colors.text, fontSize: 22, lineHeight: 1 }}>{mesa.numero}</div>
                    {status === 'libre' ? (
                      <div className="poshome-mesa-status libre" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, justifyContent: 'center', fontSize: 10 }}>{mesa.capacidad || 4} <Icon name="users" size={10} /></div>
                    ) : (
                      <>
                        <div className="poshome-mesa-total" style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>
                          ${parseFloat(cuenta.subtotal || 0).toFixed(2)}
                        </div>
                        <div className="poshome-mesa-meta" style={{ fontSize: 9 }}>
                          {itemCnt} ít · {elapsed(cuenta.created_at)}
                        </div>
                        {status === 'lista' && <div className="poshome-mesa-ready" style={{ fontSize: 9 }}>✓ Lista</div>}
                      </>
                    )}
                  </button>
                  {/* Menú contextual liberar mesa */}
                  {mesaMenu?.id === mesa.id && cuenta && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4, zIndex: 50,
                      background: '#1e1e26', border: '1px solid #E62329', borderRadius: 8,
                      padding: '6px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,.6)',
                    }}>
                      <button
                        style={{ display: 'block', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#f4a261', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => handleLiberarMesa(mesa)}
                      >Liberar mesa</button>
                      <button
                        style={{ display: 'block', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#8b8997', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => setMesaMenu(null)}
                      >Cancelar</button>
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
                <span className="poshome-section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="bag" size={16} /> Para Llevar / Delivery</span>
              </div>
            )}
            <div className="poshome-cuentas-list">
              {cuentasFiltradas.map(c => {
                const info   = TIPO_INFO[c.tipo] || { ic: 'bag', label: c.tipo, color: '#8b8997' }
                const items  = c.pos_cuenta_items?.length || 0
                return (
                  <button
                    key={c.id}
                    className="poshome-cuenta-row"
                    style={{ borderLeftColor: info.color }}
                    onClick={() => handleCuentaClick(c)}
                  >
                    <span className="poshome-cuenta-icon"><Icon name={info.ic} size={20} color={info.color} /></span>
                    <div className="poshome-cuenta-info">
                      <span className="poshome-cuenta-label" style={{ color: info.color }}>
                        {info.label}{c.delivery_referencia ? ` #${c.delivery_referencia}` : ''}
                      </span>
                      <span className="poshome-cuenta-items">
                        {c.cliente_nombre ? `👤 ${c.cliente_nombre} · ` : ''}{items} ítem{items !== 1 ? 's' : ''}
                      </span>
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
            <div style={{ display: 'flex', justifyContent: 'center' }}><Icon name={FILTROS.find(f => f.key === filtro)?.ic || 'grid'} size={40} color="#8b8997" /></div>
            <div style={{ color: '#8b8997', fontSize: 14, marginTop: 8 }}>
              Sin órdenes de {FILTROS.find(f => f.key === filtro)?.label || filtro}
            </div>
            {filtro !== 'todos' && filtro !== 'mesa' && filtro !== 'delivery_app' && (
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
            <div style={{ display: 'flex', justifyContent: 'center' }}><Icon name="utensils" size={46} color="#43382f" /></div>
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
            <span className="poshome-quick-icon"><Icon name="armchair" size={22} /></span>
            <span className="poshome-quick-label">Mesas</span>
          </button>
        )}
        {/* Para Llevar / Delivery / PedidosYa / Drive: solo cajero+ (no mesero) */}
        {!MESERO_ROLES.includes(user.rol) && (<>
          <button className="poshome-quick-btn" style={{ '--qt-color': '#f4a261' }} onClick={() => handleNueva('para_llevar')}>
            <span className="poshome-quick-icon"><Icon name="bag" size={22} /></span><span className="poshome-quick-label">Para Llevar</span>
          </button>
          <button className="poshome-quick-btn" style={{ '--qt-color': '#60a5fa' }} onClick={() => handleNueva('delivery_propio')}>
            <span className="poshome-quick-icon"><Icon name="bike" size={22} /></span><span className="poshome-quick-label">Delivery</span>
          </button>
          <button className="poshome-quick-btn" style={{ '--qt-color': '#a78bfa' }} onClick={() => handleNueva('pedidos_ya')}>
            <span className="poshome-quick-icon"><Icon name="bike" size={22} /></span><span className="poshome-quick-label">PedidosYa</span>
          </button>
          <button className="poshome-quick-btn" style={{ '--qt-color': '#fbbf24' }} onClick={() => handleNueva('drive_through')}>
            <span className="poshome-quick-icon"><Icon name="car" size={22} /></span><span className="poshome-quick-label">Drive Thru</span>
          </button>
        </>)}
        {/* KDS: acceso rápido para cocina / gerente / admin / ejecutivo */}
        {KDS_ROLES.includes(user.rol) && onGoToKDS && (
          <button className="poshome-quick-btn" style={{ '--qt-color': '#E62329' }} onClick={onGoToKDS}>
            <span className="poshome-quick-icon"><Icon name="chef" size={22} /></span><span className="poshome-quick-label">Cocina KDS</span>
          </button>
        )}
        {/* Historial: cajero+ (cajero, cajera, gerente, admin, ejecutivo, superadmin) */}
        {!MESERO_ROLES.includes(user.rol) && onGoToHistorial && (
          <button className="poshome-quick-btn" style={{ '--qt-color': '#2dd4a8' }} onClick={onGoToHistorial}>
            <span className="poshome-quick-icon"><Icon name="list" size={22} /></span><span className="poshome-quick-label">Órdenes</span>
          </button>
        )}
        {!MESERO_ROLES.includes(user.rol) && onGoToCierre && (
          <button className="poshome-quick-btn" style={{ '--qt-color': '#FFD900' }} onClick={onGoToCierre}>
            <span className="poshome-quick-icon"><Icon name="cash" size={22} /></span><span className="poshome-quick-label">Cierre</span>
          </button>
        )}
        {onGoToMenuAdmin && (
          <button className="poshome-quick-btn" style={{ '--qt-color': '#E62329' }} onClick={onGoToMenuAdmin}>
            <span className="poshome-quick-icon"><Icon name="pencil" size={22} /></span><span className="poshome-quick-label">Menú Admin</span>
          </button>
        )}
        {EDIT_PLANO_ROLES.includes(user.rol) && (
          <button className="poshome-quick-btn" style={{ '--qt-color': '#2dd4a8' }} onClick={() => setShowPlanoEditor(true)}>
            <span className="poshome-quick-icon"><Icon name="armchair" size={22} /></span><span className="poshome-quick-label">Editar Plano</span>
          </button>
        )}
      </div>

      {/* ── MODAL APERTURA DE MESA (demografía) ── */}
      {aperturaMesa && (
        <div className="pos-modal-overlay" onClick={() => setAperturaMesa(null)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="pos-modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Icon name="users" size={18} color="#FFD900" /> Abrir Mesa #{aperturaMesa.numero}
            </div>
            <div style={{ color: '#9a9088', fontSize: 12, margin: '4px 0 14px' }}>
              ¿Quiénes se sientan? Para estadística y ticket por persona.
            </div>
            {[
              { k: 'm', label: 'Mujeres', color: '#ff7a6e' },
              { k: 'h', label: 'Hombres', color: '#60a5fa' },
              { k: 'k', label: 'Niños',   color: '#fbbf24', note: 'no cuentan para el promedio' },
            ].map(row => (
              <div key={row.k} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#241d19', border: '1px solid #332b27', borderRadius: 12, padding: '10px 14px', marginBottom: 9 }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: row.color }}>
                  {row.label}{row.note && <span style={{ display: 'block', color: '#9a9088', fontWeight: 400, fontSize: 11 }}>{row.note}</span>}
                </span>
                <button onClick={() => bump(row.k, -1)} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid #43382f', background: '#2b231e', color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer' }}>−</button>
                <span style={{ minWidth: 22, textAlign: 'center', fontSize: 18, fontWeight: 800 }}>{pax[row.k]}</span>
                <button onClick={() => bump(row.k, 1)} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid #43382f', background: '#2b231e', color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer' }}>+</button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#2e1311', border: '1px solid #E62329', borderRadius: 12, padding: '11px 15px', margin: '6px 0 14px' }}>
              <div>
                <div style={{ fontSize: 11, color: '#9a9088' }}>Total en mesa</div>
                <div style={{ fontSize: 12, color: '#9a9088' }}>{pax.m}M · {pax.h}H · {pax.k}N</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#FFD900' }}>{pax.m + pax.h + pax.k}</div>
            </div>
            <button className="pos-confirmar-btn" onClick={handleAbrirMesa} disabled={pax.m + pax.h + pax.k === 0}>
              Abrir mesa →
            </button>
            <button className="pos-cancelar-btn" onClick={() => setAperturaMesa(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── EDITOR DE PLANO (admin) ── */}
      {showPlanoEditor && (
        <PlanoEditor
          storeCode={storeCode}
          storeName={storeName}
          onClose={(reload) => { setShowPlanoEditor(false); if (reload) setRefreshKey(k => k + 1) }}
        />
      )}

    </div>
  )
}
