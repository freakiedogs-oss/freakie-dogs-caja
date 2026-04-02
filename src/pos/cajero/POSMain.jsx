import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { STORES, today } from '../../config'
import PaymentModal from './PaymentModal'

// ──────────────────────────────────────────────
// Constantes de display
// ──────────────────────────────────────────────
const TIPO_INFO = {
  'mesa':           { icon: '🪑', label: 'Mesa',        color: '#4ade80', canal: 'local'          },
  'para_llevar':    { icon: '🥡', label: 'Para Llevar', color: '#f4a261', canal: 'para_llevar'     },
  'delivery_propio':{ icon: '🛵', label: 'Delivery',    color: '#60a5fa', canal: 'delivery_propio' },
  'pedidos_ya':     { icon: '📱', label: 'PedidosYa',   color: '#a78bfa', canal: 'pedidos_ya'      },
  'drive_through':  { icon: '🚗', label: 'Drive Thru',  color: '#fbbf24', canal: 'drive_through'   },
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

// ──────────────────────────────────────────────
// POSMain
// ──────────────────────────────────────────────
export default function POSMain({ user, cuentaCtx, onBack, onLogout }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  // Contexto de la cuenta actual
  const tipo     = cuentaCtx?.tipo     || 'para_llevar'
  const mesaRef  = cuentaCtx?.mesa_ref || null
  const mesaId   = cuentaCtx?.mesa_id  || null
  const tipoInfo = TIPO_INFO[tipo] || TIPO_INFO['para_llevar']

  // Menú data
  const [menus,       setMenus]       = useState({})
  const [loadingMenu, setLoadingMenu] = useState(true)

  // Cuenta activa en DB
  const [cuentaId,   setCuentaId]   = useState(cuentaCtx?.cuentaId || null)
  const [cuentaNum,  setCuentaNum]  = useState(null)

  // Ítems: los ya guardados (comandados) + los nuevos (pendientes de comandar)
  const [items,         setItems]         = useState([])    // [{id,nombre,precio,qty,nota,saved}]
  const [commandedCount,setCommandedCount]= useState(0)     // cuántos al inicio son ya guardados

  // UI
  const [activeCat,      setActiveCat]      = useState(null)
  const [showPayModal,   setShowPayModal]   = useState(false)
  const [showNoteModal,  setShowNoteModal]  = useState(null)
  const [noteText,       setNoteText]       = useState('')
  const [saving,         setSaving]         = useState(false)
  const [commanding,     setCommanding]     = useState(false)
  const [loadingCuenta,  setLoadingCuenta]  = useState(!!cuentaCtx?.cuentaId)

  // ── Cargar menú ──
  useEffect(() => {
    const load = async () => {
      setLoadingMenu(true)
      const canal = tipoInfo.canal
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
        .is('sucursal_id', null)
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
                .sort((a, b) => a.orden - b.orden),
            }))
          map[m.canal] = { id: m.id, nombre: m.nombre, categorias: cats }
        })
        setMenus(map)
      }
      setLoadingMenu(false)
    }
    load()
  }, [tipoInfo.canal])

  // ── Cargar cuenta existente ──
  useEffect(() => {
    if (!cuentaCtx?.cuentaId) {
      setLoadingCuenta(false)
      return
    }
    const loadCuenta = async () => {
      setLoadingCuenta(true)
      const { data: itemsData } = await db
        .from('pos_cuenta_items')
        .select('id, menu_item_id, nombre_snapshot, precio_unitario, cantidad, notas')
        .eq('cuenta_id', cuentaCtx.cuentaId)
        .order('created_at')

      if (itemsData) {
        const loaded = itemsData.map(it => ({
          id:     it.menu_item_id,
          dbId:   it.id,
          nombre: it.nombre_snapshot,
          precio: parseFloat(it.precio_unitario),
          qty:    it.cantidad,
          nota:   it.notas || '',
          saved:  true,
        }))
        setItems(loaded)
        setCommandedCount(loaded.length)
      }
      setCuentaId(cuentaCtx.cuentaId)
      setLoadingCuenta(false)
    }
    loadCuenta()
  }, [cuentaCtx?.cuentaId])

  // ── Número de orden siguiente ──
  useEffect(() => {
    if (cuentaCtx?.cuentaId) return  // ya existe
    const getNum = async () => {
      const { count } = await db
        .from('pos_cuentas')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today() + 'T00:00:00-06:00')
      setCuentaNum((count || 0) + 1)
    }
    getNum()
  }, [cuentaCtx?.cuentaId])

  // ── Menú activo ──
  const canal      = tipoInfo.canal
  const menuActivo = menus[canal] || menus['local'] || null
  const categorias = menuActivo?.categorias || []

  useEffect(() => {
    if (categorias.length > 0 && !activeCat) {
      setActiveCat(categorias[0].id)
    }
  }, [categorias])

  const itemsActivaCat = categorias.find(c => c.id === activeCat)?.items || []

  // ── Acciones de orden ──
  const addItem = useCallback((product) => {
    setItems(prev => {
      // Agrupar solo con ítems nuevos (no guardados) sin nota
      const idx = prev.findIndex(i => i.id === product.id && !i.nota && !i.saved)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, {
        id:     product.id,
        nombre: product.nombre,
        precio: parseFloat(product.precio),
        qty:    1,
        nota:   '',
        saved:  false,
      }]
    })
  }, [])

  const removeItem = useCallback((idx) => {
    setItems(prev => {
      const next = [...prev]
      const item = next[idx]
      // No permitir borrar ítems ya guardados (haría falta una lógica de void)
      if (item.saved) return prev
      if (item.qty > 1) {
        next[idx] = { ...next[idx], qty: item.qty - 1 }
      } else {
        next.splice(idx, 1)
      }
      return next
    })
  }, [])

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

  const clearNewItems = () => {
    const newItems = items.filter(i => !i.saved)
    if (newItems.length === 0) return
    if (!confirm('¿Quitar los ítems no comandados?')) return
    setItems(prev => prev.filter(i => i.saved))
  }

  // Totales
  const subtotal  = items.reduce((s, i) => s + i.precio * i.qty, 0)
  const total     = subtotal
  const newItems  = items.filter(i => !i.saved)
  const hasNew    = newItems.length > 0

  // ── COMANDAR — guarda en BD y envía a cocina ──
  const handleComandar = async () => {
    if (!hasNew) return
    setCommanding(true)
    try {
      let currentCuentaId = cuentaId

      // Si no existe cuenta aún → crearla
      if (!currentCuentaId) {
        const { data: cuenta, error } = await db
          .from('pos_cuentas')
          .insert({
            store_code:  storeCode,
            cajero_id:   user.id,
            tipo:        tipo,
            mesa_ref:    mesaRef,
            menu_id:     menuActivo?.id || null,
            estado:      'enviada_cocina',
            subtotal:    subtotal,
            iva:         0,
            total:       total,
          })
          .select()
          .single()

        if (error) throw error
        currentCuentaId = cuenta.id
        setCuentaId(currentCuentaId)
      } else {
        // Actualizar subtotal de la cuenta existente
        await db
          .from('pos_cuentas')
          .update({ subtotal, total, estado: 'enviada_cocina', updated_at: new Date().toISOString() })
          .eq('id', currentCuentaId)
      }

      // Insertar solo los ítems nuevos
      const toInsert = newItems.map(it => ({
        cuenta_id:        currentCuentaId,
        menu_item_id:     it.id,
        nombre_snapshot:  it.nombre,
        precio_unitario:  it.precio,
        cantidad:         it.qty,
        notas:            it.nota || null,
      }))
      await db.from('pos_cuenta_items').insert(toInsert)

      // Enviar a cocina
      await db.from('pos_cocina_queue').insert(
        newItems.map(it => ({
          cuenta_id:   currentCuentaId,
          sucursal_id: null,
          nombre_item: it.nombre + (mesaRef ? ` [Mesa ${mesaRef}]` : ''),
          cantidad:    it.qty,
          notas:       it.nota || null,
          estado:      'pendiente',
          prioridad:   5,
        }))
      )

      // Marcar todos como guardados
      setItems(prev => prev.map(i => ({ ...i, saved: true })))
      setCommandedCount(items.length)

      // Volver al inicio automáticamente para que el mesero vea el plano actualizado
      // pero solo si es mesa (para el mesero pueda ir a otra mesa)
      // Para otros tipos, quedarse en pantalla

    } catch (err) {
      console.error('Error al comandar:', err)
      alert('Error al comandar: ' + err.message)
    } finally {
      setCommanding(false)
    }
  }

  // ── COBRAR — guarda cuenta + pago ──
  const saveCuenta = async (paymentData) => {
    setSaving(true)
    try {
      let currentCuentaId = cuentaId

      // Si hay ítems nuevos no comandados, los guardamos ahora
      const itemsToSave = currentCuentaId ? newItems : items

      if (!currentCuentaId) {
        const { data: cuenta, error: cuentaErr } = await db
          .from('pos_cuentas')
          .insert({
            store_code:  storeCode,
            cajero_id:   user.id,
            tipo:        tipo,
            mesa_ref:    mesaRef,
            menu_id:     menuActivo?.id || null,
            estado:      'cobrada',
            subtotal:    subtotal,
            iva:         0,
            propina:     paymentData.propina || 0,
            total:       total + (paymentData.propina || 0),
            dte_tipo:    paymentData.dteTipo || null,
            cobrada_at:  new Date().toISOString(),
          })
          .select()
          .single()

        if (cuentaErr) throw cuentaErr
        currentCuentaId = cuenta.id
        setCuentaId(currentCuentaId)
      } else {
        // Actualizar cuenta existente a cobrada
        await db
          .from('pos_cuentas')
          .update({
            estado:     'cobrada',
            subtotal,
            iva:        0,
            propina:    paymentData.propina || 0,
            total:      total + (paymentData.propina || 0),
            dte_tipo:   paymentData.dteTipo || null,
            cobrada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentCuentaId)
      }

      // Insertar ítems no guardados
      if (itemsToSave.length > 0) {
        await db.from('pos_cuenta_items').insert(
          itemsToSave.map(it => ({
            cuenta_id:       currentCuentaId,
            menu_item_id:    it.id,
            nombre_snapshot: it.nombre,
            precio_unitario: it.precio,
            cantidad:        it.qty,
            notas:           it.nota || null,
          }))
        )
      }

      // Insertar pago
      await db.from('pos_cuenta_pagos').insert({
        cuenta_id:     currentCuentaId,
        metodo:        paymentData.metodo,
        monto:         total + (paymentData.propina || 0),
        monto_efectivo:paymentData.efectivo || null,
        monto_tarjeta: paymentData.tarjeta  || null,
        cambio:        paymentData.cambio   || 0,
        referencia:    paymentData.referencia || null,
        cajero_id:     user.id,
      })

      // Cocina (para ítems no comandados)
      if (itemsToSave.length > 0) {
        await db.from('pos_cocina_queue').insert(
          itemsToSave.map(it => ({
            cuenta_id:   currentCuentaId,
            sucursal_id: null,
            nombre_item: it.nombre + (mesaRef ? ` [Mesa ${mesaRef}]` : ''),
            cantidad:    it.qty,
            notas:       it.nota || null,
            estado:      'pendiente',
            prioridad:   5,
          }))
        )
      }

      return { id: currentCuentaId }
    } finally {
      setSaving(false)
    }
  }

  const handlePaymentConfirm = async (paymentData) => {
    await saveCuenta(paymentData)
    setItems([])
    setShowPayModal(false)
    onBack()  // Volver al inicio tras cobrar
  }

  // ── Render cargando cuenta ──
  if (loadingCuenta) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="spin" />
        <span style={{ color: '#555', fontSize: 14 }}>Cargando cuenta...</span>
      </div>
    )
  }

  return (
    <div className="pos-layout">
      {/* ── HEADER (igual a .topbar del ERP) ── */}
      <header className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
        <span className="pos-header-brand">🍔 Freakie POS</span>
        <span className="pos-header-store">{storeName}</span>

        {/* Badge tipo / mesa */}
        <span
          className="pos-header-btn"
          style={{ background: tipoInfo.color + '18', borderColor: tipoInfo.color, color: tipoInfo.color, cursor: 'default' }}
        >
          {tipoInfo.icon} {tipoInfo.label}{mesaRef ? ` #${mesaRef}` : ''}
        </span>

        <span className="pos-header-sep" />
        <span className="pos-header-user">{user.nombre?.split(' ')[0]}</span>
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
                      : {}}
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
                    className="pos-product-btn"
                    onClick={() => addItem(product)}
                  >
                    <div className="pos-product-name">{product.nombre}</div>
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
            <span
              className="pos-order-type-badge"
              style={{ background: tipoInfo.color + '22', color: tipoInfo.color }}
            >
              {tipoInfo.icon} {tipoInfo.label}{mesaRef ? ` #${mesaRef}` : ''}
            </span>
            {cuentaId && (
              <span className="pos-order-open-badge">Cuenta Abierta</span>
            )}
            {!cuentaId && (
              <div className="pos-order-num">
                Orden #{String(cuentaNum || 1).padStart(4, '0')}
              </div>
            )}
          </div>

          {/* Lista de ítems */}
          <div className="pos-order-items">
            {items.length === 0 ? (
              <div className="pos-order-empty">
                <div className="pos-order-empty-icon">🛒</div>
                <div>Orden vacía</div>
                <div style={{ fontSize: 11, color: '#2a2a2a' }}>Toca un producto</div>
              </div>
            ) : (
              items.map((item, idx) => (
                <div
                  key={idx}
                  className={`pos-order-item${item.saved ? ' saved' : ' new'}`}
                >
                  {/* Indicador guardado/nuevo */}
                  <div
                    className="pos-order-item-status"
                    title={item.saved ? 'Comandado' : 'Pendiente de comandar'}
                    style={{ color: item.saved ? '#4ade8066' : '#fbbf24' }}
                  >
                    {item.saved ? '✓' : '●'}
                  </div>
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
                    {!item.saved && (
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button
                          className="pos-order-item-del"
                          style={{ color: '#555', fontSize: 12 }}
                          onClick={() => { setShowNoteModal(idx); setNoteText(item.nota || '') }}
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
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="pos-order-footer">
            <div className="pos-order-subtotal">
              <span>{items.reduce((s, i) => s + i.qty, 0)} artículos</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="pos-order-total">
              <span>TOTAL</span>
              <span>${total.toFixed(2)}</span>
            </div>

            {/* COMANDAR — envía a cocina, deja cuenta abierta */}
            <button
              className="pos-comandar-btn"
              disabled={!hasNew || commanding}
              onClick={handleComandar}
            >
              {commanding
                ? '⏳ Comandando...'
                : `🔔 COMANDAR${newItems.length > 0 ? ` (${newItems.reduce((s,i)=>s+i.qty,0)})` : ''}`
              }
            </button>

            {/* COBRAR */}
            <button
              className="pos-cobrar-btn"
              disabled={items.length === 0 || saving}
              onClick={() => setShowPayModal(true)}
            >
              {saving ? '...' : `💳 COBRAR $${total.toFixed(2)}`}
            </button>

            {hasNew && (
              <button className="pos-clear-btn" onClick={clearNewItems}>
                🗑 Limpiar nuevos
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Nota de ítem */}
      {showNoteModal !== null && (
        <div className="pos-modal-overlay" onClick={() => setShowNoteModal(null)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()}>
            <div className="pos-modal-title">📝 Nota para cocina</div>
            <div className="pos-modal-sub">{items[showNoteModal]?.nombre}</div>
            <textarea
              className="pos-note-textarea"
              placeholder="Ej: Sin cebolla, bien cocido..."
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
