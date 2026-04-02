import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../../supabase'
import { STORES, today } from '../../config'
import OrderTypeSelector from './OrderTypeSelector'
import PaymentModal from './PaymentModal'

// Tipo de orden a canal BD
const TYPE_TO_CANAL = {
  local:           'local',
  para_llevar:     'para_llevar',
  delivery:        'delivery_propio',
  pedidos_ya:      'pedidos_ya',
  drive_thru:      'drive_through',
}

const TYPE_LABELS = {
  local:       { icon: '🪑', label: 'Mesa',        color: '#4ade80' },
  para_llevar: { icon: '🥡', label: 'Para Llevar',  color: '#f4a261' },
  delivery:    { icon: '🛵', label: 'Delivery',     color: '#60a5fa' },
  pedidos_ya:  { icon: '📱', label: 'PedidosYa',    color: '#a78bfa' },
  drive_thru:  { icon: '🚗', label: 'Drive Thru',   color: '#fbbf24' },
}

// Reloj
function Clock() {
  const [t, setT] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date(Date.now() - 6*3600*1000)
      setT(now.toISOString().split('T')[1].slice(0,8))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="pos-header-clock">{t}</span>
}

export default function POSMain({ user, onLogout }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  // Menú data
  const [menus, setMenus]       = useState({})   // canal → {id, categorias:[{id,nombre,color,icono,items:[]}]}
  const [loadingMenu, setLoadingMenu] = useState(true)

  // UI estado
  const [orderType, setOrderType]   = useState(null)   // null = selector abierto
  const [mesaRef, setMesaRef]       = useState('')
  const [activeCat, setActiveCat]   = useState(null)
  const [items, setItems]           = useState([])      // [{id,nombre,precio,qty,nota}]
  const [showTypeModal, setShowTypeModal]   = useState(false)
  const [showPayModal, setShowPayModal]     = useState(false)
  const [showNoteModal, setShowNoteModal]   = useState(null) // item index
  const [noteText, setNoteText]     = useState('')
  const [cuentaNum, setCuentaNum]   = useState(null)
  const [saving, setSaving]         = useState(false)

  // Cargar menús de Supabase
  useEffect(() => {
    const load = async () => {
      setLoadingMenu(true)
      const { data: menuData } = await db
        .from('pos_menus')
        .select(`
          id, nombre, canal,
          pos_menu_categorias (
            id, nombre, color, icono, orden,
            pos_menu_items (
              id, nombre, nombre_corto, descripcion, precio, disponible, orden
            )
          )
        `)
        .eq('activo', true)
        .is('sucursal_id', null) // menús globales + por sucursal
        .order('nombre')

      if (menuData) {
        const map = {}
        menuData.forEach(m => {
          const cats = (m.pos_menu_categorias || [])
            .sort((a, b) => a.orden - b.orden)
            .map(c => ({
              ...c,
              items: (c.pos_menu_items || [])
                .filter(i => i.disponible)
                .sort((a, b) => a.orden - b.orden)
            }))
          map[m.canal] = { id: m.id, nombre: m.nombre, categorias: cats }
        })
        setMenus(map)
      }
      setLoadingMenu(false)
    }
    load()
  }, [])

  // Obtener siguiente número de cuenta
  useEffect(() => {
    const getNum = async () => {
      const { count } = await db
        .from('pos_cuentas')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today() + 'T00:00:00-06:00')
      setCuentaNum((count || 0) + 1)
    }
    getNum()
  }, [])

  // Menú activo
  const canal = orderType ? TYPE_TO_CANAL[orderType] : null
  const menuActivo = canal ? (menus[canal] || menus['local'] || null) : null
  const categorias = menuActivo?.categorias || []

  // Categoría activa (auto-select primera)
  useEffect(() => {
    if (categorias.length > 0 && !activeCat) {
      setActiveCat(categorias[0].id)
    }
  }, [categorias])

  const itemsActivaCat = categorias.find(c => c.id === activeCat)?.items || []

  // ── ACCIONES DE ORDEN ──

  const addItem = useCallback((product) => {
    if (!product.disponible) return
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === product.id && !i.nota)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, {
        id: product.id,
        nombre: product.nombre,
        precio: parseFloat(product.precio),
        qty: 1,
        nota: ''
      }]
    })
  }, [])

  const removeItem = useCallback((idx) => {
    setItems(prev => {
      const next = [...prev]
      if (next[idx].qty > 1) {
        next[idx] = { ...next[idx], qty: next[idx].qty - 1 }
      } else {
        next.splice(idx, 1)
      }
      return next
    })
  }, [])

  const clearOrder = () => {
    if (items.length === 0) return
    if (!confirm('¿Limpiar la orden?')) return
    setItems([])
  }

  const saveNota = () => {
    if (showNoteModal === null) return
    setItems(prev => {
      const next = [...prev]
      next[showNoteModal] = { ...next[showNoteModal], nota: noteText }
      return next
    })
    setShowNoteModal(null)
    setNoteText('')
  }

  // Totales
  const subtotal = items.reduce((s, i) => s + i.precio * i.qty, 0)
  const total = subtotal

  // ── GUARDAR CUENTA en BD ──
  const saveCuenta = async (paymentData) => {
    setSaving(true)
    try {
      const { data: cuenta, error: cuentaErr } = await db
        .from('pos_cuentas')
        .insert({
          sucursal_id: storeCode,
          menu_id: menuActivo?.id || null,
          cajero_id: user.id,
          tipo: orderType || 'para_llevar',
          mesa_ref: mesaRef || null,
          estado: 'pagada',
          subtotal: subtotal,
          descuento: 0,
          propina: paymentData.propina || 0,
          total: total + (paymentData.propina || 0),
          tipo_dte: paymentData.tipoDte || 'ticket',
        })
        .select()
        .single()

      if (cuentaErr) throw cuentaErr

      // Insertar items
      const itemsToInsert = items.map(it => ({
        cuenta_id: cuenta.id,
        menu_item_id: it.id,
        nombre_snapshot: it.nombre,
        precio_unitario: it.precio,
        cantidad: it.qty,
        notas: it.nota || null,
      }))
      await db.from('pos_cuenta_items').insert(itemsToInsert)

      // Insertar pago
      await db.from('pos_cuenta_pagos').insert({
        cuenta_id: cuenta.id,
        metodo: paymentData.metodo,
        monto: total + (paymentData.propina || 0),
        monto_efectivo: paymentData.efectivo || null,
        monto_tarjeta: paymentData.tarjeta || null,
        cambio: paymentData.cambio || 0,
        referencia: paymentData.referencia || null,
        cajero_id: user.id,
      })

      // Enviar a cocina queue
      const kitchenItems = items.filter(i => i.qty > 0)
      if (kitchenItems.length > 0) {
        await db.from('pos_cocina_queue').insert(
          kitchenItems.map(it => ({
            cuenta_id: cuenta.id,
            cuenta_item_id: null,
            sucursal_id: storeCode,
            nombre_item: it.nombre,
            cantidad: it.qty,
            notas: it.nota || null,
            estado: 'pendiente',
            prioridad: 5,
          }))
        )
      }

      setCuentaNum(n => (n || 1) + 1)
      return cuenta
    } finally {
      setSaving(false)
    }
  }

  const handlePaymentConfirm = async (paymentData) => {
    const cuenta = await saveCuenta(paymentData)
    setItems([])
    setShowPayModal(false)
    return cuenta
  }

  // ── Si no hay tipo de orden: mostrar selector ──
  if (!orderType) {
    return (
      <OrderTypeSelector
        onSelect={(type, mesa) => {
          setOrderType(type)
          setMesaRef(mesa || '')
          setActiveCat(null)
        }}
      />
    )
  }

  const typeInfo = TYPE_LABELS[orderType]

  return (
    <div className="pos-layout">
      {/* Header */}
      <header className="pos-header">
        <span className="pos-header-brand">🍔 FREAKIE POS</span>
        <span className="pos-header-store">{storeName}</span>
        <button
          className="pos-header-btn"
          style={{ background: '#1a0a0d', borderColor: typeInfo.color, color: typeInfo.color }}
          onClick={() => setShowTypeModal(true)}
        >
          {typeInfo.icon} {typeInfo.label}{mesaRef ? ` #${mesaRef}` : ''}
        </button>
        <span className="pos-header-user">👤 {user.nombre?.split(' ')[0]}</span>
        <Clock />
        <button className="pos-header-btn danger" onClick={onLogout}>Salir</button>
      </header>

      <div className="pos-body">
        {/* ── LEFT: Menú ── */}
        <div className="pos-menu-area">
          {loadingMenu ? (
            <div className="pos-loading">
              <div className="spin" />
              Cargando menú...
            </div>
          ) : (
            <>
              {/* Categorías */}
              <div className="pos-categories">
                {categorias.map(cat => (
                  <button
                    key={cat.id}
                    className={`pos-cat-btn${activeCat === cat.id ? ' active' : ''}`}
                    style={activeCat === cat.id
                      ? { background: cat.color + '22', color: cat.color, borderColor: cat.color }
                      : {}
                    }
                    onClick={() => setActiveCat(cat.id)}
                  >
                    <span className="pos-cat-icon">{cat.icono}</span>
                    {cat.nombre}
                  </button>
                ))}
              </div>

              {/* Productos */}
              <div className="pos-products">
                {itemsActivaCat.map(product => (
                  <button
                    key={product.id}
                    className={`pos-product-btn${!product.disponible ? ' unavailable' : ''}`}
                    onClick={() => addItem(product)}
                    disabled={!product.disponible}
                  >
                    <div className="pos-product-name">
                      {product.nombre}
                    </div>
                    <div className="pos-product-price">
                      ${parseFloat(product.precio).toFixed(2)}
                    </div>
                    {product.descripcion && (
                      <div className="pos-product-desc">{product.descripcion}</div>
                    )}
                  </button>
                ))}
                {itemsActivaCat.length === 0 && (
                  <div style={{ color: '#333', fontSize: 13, padding: 20, gridColumn: '1/-1' }}>
                    No hay productos en esta categoría
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT: Order Panel ── */}
        <div className="pos-order-panel">
          <div className="pos-order-header">
            <div>
              <span
                className="pos-order-type-badge"
                style={{ background: typeInfo.color + '22', color: typeInfo.color }}
                onClick={() => setShowTypeModal(true)}
              >
                {typeInfo.icon} {typeInfo.label}{mesaRef ? ` #${mesaRef}` : ''}
              </span>
            </div>
            <div className="pos-order-num">
              Orden #{String(cuentaNum || 1).padStart(4, '0')}
            </div>
          </div>

          {/* Items */}
          <div className="pos-order-items">
            {items.length === 0 ? (
              <div className="pos-order-empty">
                <div className="pos-order-empty-icon">🛒</div>
                <div>Orden vacía</div>
                <div style={{ fontSize: 11, color: '#2a2a2a' }}>
                  Toca un producto para agregar
                </div>
              </div>
            ) : (
              items.map((item, idx) => (
                <div key={idx} className="pos-order-item">
                  <div className="pos-order-item-qty">{item.qty}</div>
                  <div className="pos-order-item-info">
                    <div className="pos-order-item-name">{item.nombre}</div>
                    {item.nota && (
                      <div className="pos-order-item-note">📝 {item.nota}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <div className="pos-order-item-price">
                      ${(item.precio * item.qty).toFixed(2)}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button
                        className="pos-order-item-del"
                        title="Nota"
                        onClick={() => { setShowNoteModal(idx); setNoteText(item.nota || '') }}
                        style={{ color: '#555', fontSize: 12 }}
                      >
                        📝
                      </button>
                      <button
                        className="pos-order-item-del"
                        onClick={() => removeItem(idx)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="pos-order-footer">
            <div className="pos-order-subtotal">
              <span>{items.reduce((s,i) => s + i.qty, 0)} artículos</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="pos-order-total">
              <span>TOTAL</span>
              <span>${total.toFixed(2)}</span>
            </div>
            <button
              className="pos-cobrar-btn"
              disabled={items.length === 0 || saving}
              onClick={() => setShowPayModal(true)}
            >
              {saving ? '...' : `💳 COBRAR $${total.toFixed(2)}`}
            </button>
            <button className="pos-clear-btn" onClick={clearOrder}>
              🗑 Limpiar orden
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Cambiar tipo de orden */}
      {showTypeModal && (
        <OrderTypeSelector
          current={orderType}
          currentMesa={mesaRef}
          modal
          onSelect={(type, mesa) => {
            setOrderType(type)
            setMesaRef(mesa || '')
            setActiveCat(null)
            setShowTypeModal(false)
          }}
          onClose={() => setShowTypeModal(false)}
        />
      )}

      {/* Modal: Nota de item */}
      {showNoteModal !== null && (
        <div className="pos-modal-overlay" onClick={() => setShowNoteModal(null)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()}>
            <div className="pos-modal-title">📝 Nota para cocina</div>
            <div className="pos-modal-sub">
              {items[showNoteModal]?.nombre}
            </div>
            <textarea
              className="pos-note-textarea"
              placeholder="Ej: Sin cebolla, bien cocido, sin sal..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              autoFocus
              maxLength={200}
            />
            <button className="pos-confirmar-btn" onClick={saveNota}>
              Guardar nota
            </button>
            <button className="pos-cancelar-btn" onClick={() => setShowNoteModal(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal: Pago */}
      {showPayModal && (
        <PaymentModal
          items={items}
          total={total}
          onConfirm={handlePaymentConfirm}
          onClose={() => setShowPayModal(false)}
          saving={saving}
        />
      )}
    </div>
  )
}
