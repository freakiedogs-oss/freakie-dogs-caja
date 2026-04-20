import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { STORES, today } from '../../config'
import PaymentModal from './PaymentModal'
import MesaTransferModal from './MesaTransferModal'
import SplitCheckModal from './SplitCheckModal'
import { emitDTE } from './dteService'

// ──────────────────────────────────────────────
// Constantes de display
// ──────────────────────────────────────────────
const TIPO_INFO = {
  'mesa':           { icon: '🪑', label: 'Mesa',        color: '#2dd4a8', canal: 'local'          },
  'para_llevar':    { icon: '🥡', label: 'Para Llevar', color: '#f4a261', canal: 'para_llevar'     },
  'delivery_propio':{ icon: '🛵', label: 'Delivery',    color: '#60a5fa', canal: 'delivery_propio' },
  'pedidos_ya':     { icon: '📱', label: 'PedidosYa',   color: '#a78bfa', canal: 'pedidos_ya'      },
  'drive_through':  { icon: '🚗', label: 'Drive Thru',  color: '#fbbf24', canal: 'drive_through'   },
  'delivery_app':   { icon: '📲', label: 'App Delivery', color: '#f472b6', canal: 'delivery_app'   },
}

// ── Permisos por rol ──
const PERMISOS_POR_ROL = {
  mesero:    { comandar: true,  moverMesa: true,  preCuenta: true,  anular: false, editarGuardado: false, cobrar: false, descuento: false },
  mesera:    { comandar: true,  moverMesa: true,  preCuenta: true,  anular: false, editarGuardado: false, cobrar: false, descuento: false },
  cajero:    { comandar: true,  moverMesa: true,  preCuenta: true,  anular: true,  editarGuardado: true,  cobrar: true,  descuento: false },
  cajera:    { comandar: true,  moverMesa: true,  preCuenta: true,  anular: true,  editarGuardado: true,  cobrar: true,  descuento: false },
  gerente:   { comandar: true,  moverMesa: true,  preCuenta: true,  anular: true,  editarGuardado: true,  cobrar: true,  descuento: true  },
  admin:     { comandar: true,  moverMesa: true,  preCuenta: true,  anular: true,  editarGuardado: true,  cobrar: true,  descuento: true  },
  ejecutivo:  { comandar: true,  moverMesa: true,  preCuenta: true,  anular: true,  editarGuardado: true,  cobrar: true,  descuento: true  },
  superadmin: { comandar: true,  moverMesa: true,  preCuenta: true,  anular: true,  editarGuardado: true,  cobrar: true,  descuento: true  },
}
const DEFAULT_PERMS = { comandar: false, moverMesa: false, preCuenta: false, anular: false, editarGuardado: false, cobrar: false, descuento: false }

// Mapeo tipoDte UI → código MH para CHECK constraint en BD
const DTE_TIPO_MAP = { factura: '01', ccf: '03', se: '14', ticket: null }

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

  // Permisos del rol activo
  const perms = PERMISOS_POR_ROL[user.rol] || DEFAULT_PERMS

  // Contexto de la cuenta actual
  const tipo     = cuentaCtx?.tipo     || 'para_llevar'
  const mesaRef  = cuentaCtx?.mesa_ref || null
  const tipoInfo = TIPO_INFO[tipo] || TIPO_INFO['para_llevar']

  // Menú data
  const [menus,       setMenus]       = useState({})
  const [loadingMenu, setLoadingMenu] = useState(true)

  // Cuenta activa en DB
  const [cuentaId,   setCuentaId]   = useState(cuentaCtx?.cuentaId || null)
  const [cuentaNum,  setCuentaNum]  = useState(null)
  const [mesaActual, setMesaActual] = useState(mesaRef)
  const [comandaSeq, setComandaSeq] = useState(1)

  // Ítems: los ya guardados (comandados) + los nuevos (pendientes de comandar)
  const [items,          setItems]         = useState([])
  const [commandedCount, setCommandedCount] = useState(0)

  // UI
  const [activeCat,         setActiveCat]         = useState(null)
  const [showPayModal,      setShowPayModal]       = useState(false)
  const [showNoteModal,     setShowNoteModal]      = useState(null)
  const [noteText,          setNoteText]           = useState('')
  const [showTransferModal, setShowTransferModal]  = useState(false)
  const [showSplitModal,    setShowSplitModal]     = useState(false)
  const [saving,            setSaving]             = useState(false)
  const [commanding,        setCommanding]         = useState(false)
  const [loadingCuenta,     setLoadingCuenta]      = useState(!!cuentaCtx?.cuentaId)

  // Descuento
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [descuento, setDescuento]   = useState(0)
  const [descuentoTipo, setDescuentoTipo] = useState(null) // 'porcentaje' | 'monto' | 'cortesia'
  const [descuentoMotivo, setDescuentoMotivo] = useState('')

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
              id, nombre, nombre_corto, descripcion, precio, disponible, orden, estacion
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
        .select('id, menu_item_id, nombre, precio_unitario, cantidad, notas')
        .eq('cuenta_id', cuentaCtx.cuentaId)
        .is('cancelado_motivo', null)
        .order('created_at')

      if (itemsData) {
        const loaded = itemsData.map(it => ({
          id:     it.menu_item_id,
          dbId:   it.id,
          nombre: it.nombre,
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
    if (cuentaCtx?.cuentaId) return
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
        estacion: product.estacion || 'general',
      }]
    })
  }, [])

  const removeItem = useCallback((idx) => {
    setItems(prev => {
      const item = prev[idx]
      if (item.saved && !perms.anular) return prev
      const next = [...prev]
      if (item.qty > 1 && !item.saved) {
        next[idx] = { ...next[idx], qty: item.qty - 1 }
      } else {
        next.splice(idx, 1)
      }
      return next
    })
  }, [perms.anular])

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
  const subtotal = items.reduce((s, i) => s + i.precio * i.qty, 0)
  const descuentoMonto = descuentoTipo === 'porcentaje'
    ? Math.round(subtotal * descuento / 100 * 100) / 100
    : descuentoTipo === 'cortesia'
    ? subtotal
    : descuento
  const total = Math.max(0, subtotal - descuentoMonto)
  const newItems = items.filter(i => !i.saved)
  const hasNew   = newItems.length > 0

  // ── PRE-CUENTA ──
  const handlePreCuenta = () => {
    if (items.length === 0) return
    const storeName_ = storeName
    const mesaStr    = mesaActual ? `Mesa #${mesaActual}` : (tipoInfo.label)
    const now        = new Date(Date.now() - 6 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16)

    const rows = items.map(i =>
      `<tr>
        <td>${i.qty}x</td>
        <td>${i.nombre}${i.nota ? ` <span style="color:#888;font-size:11px">(${i.nota})</span>` : ''}</td>
        <td style="text-align:right">$${(i.precio * i.qty).toFixed(2)}</td>
      </tr>`
    ).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Pre-Cuenta</title>
    <style>
      body { font-family: monospace; font-size: 13px; margin: 20px; max-width: 320px; }
      h2 { text-align: center; margin: 0; font-size: 16px; }
      .sub { text-align: center; color: #555; font-size: 11px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 3px 2px; vertical-align: top; }
      .total { border-top: 1px dashed #333; margin-top: 8px; padding-top: 8px;
               display:flex; justify-content:space-between; font-weight:bold; font-size:15px; }
      .aviso { text-align:center; color:#888; font-size:10px; margin-top:14px; }
      hr { border: none; border-top: 1px dashed #999; }
    </style></head><body>
    <h2>🍔 FREAKIE DOGS</h2>
    <p class="sub">${storeName_} · ${mesaStr}<br>${now}</p>
    <hr>
    <table>${rows}</table>
    <hr>
    <div class="total"><span>SUBTOTAL</span><span>$${subtotal.toFixed(2)}</span></div>
    <p class="aviso">— PRE-CUENTA —<br>No es documento fiscal</p>
    <script>window.onload=()=>{window.print();}</script>
    </body></html>`

    const w = window.open('', '_blank', 'width=400,height=600')
    w.document.write(html)
    w.document.close()
  }

  // ── MOVER MESA ──
  const handleMesaTransfer = async (nuevaMesaRef) => {
    if (!cuentaId) return
    const { error } = await db
      .from('pos_cuentas')
      .update({ mesa_ref: nuevaMesaRef, updated_at: new Date().toISOString() })
      .eq('id', cuentaId)
    if (!error) setMesaActual(nuevaMesaRef)
    setShowTransferModal(false)
  }

  // ── COMANDAR ──
  const handleComandar = async () => {
    if (!hasNew || !perms.comandar) return
    setCommanding(true)
    try {
      let currentCuentaId = cuentaId

      if (!currentCuentaId) {
        const { data: cuenta, error } = await db
          .from('pos_cuentas')
          .insert({
            store_code: storeCode,
            cajero_id:  user.id,
            tipo:       tipo,
            mesa_ref:   mesaActual,
            menu_id:    menuActivo?.id || null,
            estado:     'enviada_cocina',
            subtotal:   subtotal,
            iva:        0,
            total:      total,
          })
          .select()
          .single()

        if (error) throw error
        currentCuentaId = cuenta.id
        setCuentaId(currentCuentaId)
      } else {
        await db
          .from('pos_cuentas')
          .update({ subtotal, total, estado: 'enviada_cocina', updated_at: new Date().toISOString() })
          .eq('id', currentCuentaId)
      }

      const toInsert = newItems.map(it => ({
        cuenta_id:       currentCuentaId,
        menu_item_id:    it.id,
        nombre:          it.nombre,
        precio_unitario: it.precio,
        cantidad:        it.qty,
        notas:           it.nota || null,
        comanda_numero:  comandaSeq,
        enviado_cocina_at: new Date().toISOString(),
      }))
      const { data: insertedItems } = await db.from('pos_cuenta_items').insert(toInsert).select('id')

      await db.from('pos_cocina_queue').insert(
        newItems.map((it, idx) => ({
          cuenta_id:      currentCuentaId,
          cuenta_item_id: insertedItems?.[idx]?.id || null,
          store_code:     storeCode,
          canal:          tipo,
          mesa_ref:       mesaActual,
          nombre_item:    it.nombre,
          cantidad:       it.qty,
          nota:           it.nota || null,
          estacion:       it.estacion || 'general',
          estado:         'pendiente',
          prioridad:      tipo === 'pedidos_ya' ? 8 : tipo === 'drive_through' ? 7 : 5,
          comanda_numero: comandaSeq,
        }))
      )

      setComandaSeq(s => s + 1)
      setItems(prev => prev.map(i => ({ ...i, saved: true })))
      setCommandedCount(items.length)

    } catch (err) {
      console.error('Error al comandar:', err)
      alert('Error al comandar: ' + err.message)
    } finally {
      setCommanding(false)
    }
  }

  // ── COBRAR (con integración DTEaaS) ──
  const saveCuenta = async (paymentData) => {
    setSaving(true)
    let dteResult = null
    let dteError  = null

    try {
      let currentCuentaId = cuentaId
      const itemsToSave   = currentCuentaId ? newItems : items

      // 1. Guardar cuenta en BD
      if (!currentCuentaId) {
        const { data: cuenta, error: cuentaErr } = await db
          .from('pos_cuentas')
          .insert({
            store_code:  storeCode,
            cajero_id:   user.id,
            tipo:        tipo,
            mesa_ref:    mesaActual,
            menu_id:     menuActivo?.id || null,
            estado:      'cobrada',
            subtotal:    subtotal,
            iva:         0,
            propina:     paymentData.propina || 0,
            total:       total + (paymentData.propina || 0),
            descuento:    descuentoMonto,
            descuento_tipo: descuentoTipo,
            descuento_motivo: descuentoMotivo || null,
            descuento_autorizado_por: descuentoTipo ? user.id : null,
            dte_tipo:    DTE_TIPO_MAP[paymentData.tipoDte] || null,
            cliente_id:  paymentData.cliente?.id || null,
            cobrada_at:  new Date().toISOString(),
          })
          .select()
          .single()

        if (cuentaErr) throw cuentaErr
        currentCuentaId = cuenta.id
        setCuentaId(currentCuentaId)
      } else {
        const { error: updErr } = await db
          .from('pos_cuentas')
          .update({
            estado:     'cobrada',
            subtotal,
            iva:        0,
            propina:    paymentData.propina || 0,
            total:      total + (paymentData.propina || 0),
            descuento:    descuentoMonto,
            descuento_tipo: descuentoTipo,
            descuento_motivo: descuentoMotivo || null,
            descuento_autorizado_por: descuentoTipo ? user.id : null,
            dte_tipo:   DTE_TIPO_MAP[paymentData.tipoDte] || null,
            cliente_id: paymentData.cliente?.id || null,
            cobrada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentCuentaId)
        if (updErr) throw new Error('Error al marcar cobrada: ' + updErr.message)
      }

      // 2. Insertar ítems nuevos si hay
      if (itemsToSave.length > 0) {
        const toInsert = itemsToSave.map(it => ({
          cuenta_id:       currentCuentaId,
          menu_item_id:    it.id,
          nombre:          it.nombre,
          precio_unitario: it.precio,
          cantidad:        it.qty,
          notas:           it.nota || null,
          comanda_numero:  comandaSeq,
          enviado_cocina_at: new Date().toISOString(),
        }))
        const { data: insertedItems } = await db.from('pos_cuenta_items').insert(toInsert).select('id')

        await db.from('pos_cocina_queue').insert(
          itemsToSave.map((it, idx) => ({
            cuenta_id:      currentCuentaId,
            cuenta_item_id: insertedItems?.[idx]?.id || null,
            store_code:     storeCode,
            canal:          tipo,
            mesa_ref:       mesaActual,
            nombre_item:    it.nombre,
            cantidad:       it.qty,
            nota:           it.nota || null,
            estacion:       it.estacion || 'general',
            estado:         'pendiente',
            prioridad:      5,
            comanda_numero: comandaSeq,
          }))
        )
      }

      // 3. Registrar pago
      await db.from('pos_cuenta_pagos').insert({
        cuenta_id:      currentCuentaId,
        metodo:         paymentData.metodo,
        monto:          total + (paymentData.propina || 0),
        monto_recibido: paymentData.efectivo || null,
        cambio:         paymentData.cambio   || 0,
        referencia:     paymentData.referencia || null,
      })

      // 4. Emitir DTE (factura o CCF) — si falla, la venta YA se cobró
      if (paymentData.tipoDte === 'factura' || paymentData.tipoDte === 'ccf' || paymentData.tipoDte === 'se') {
        try {
          dteResult = await emitDTE({
            tipoDte:  paymentData.tipoDte,
            items:    items, // todos los items de la cuenta
            receptor: paymentData.cliente || null,
            metodo:   paymentData.metodo,
          })

          // 5. Guardar resultado DTE en la cuenta
          if (dteResult) {
            await db.from('pos_cuentas').update({
              dte_uuid:           dteResult.codigo_generacion || null,
              dte_numero_control: dteResult.numero_control || null,
              dte_sello:          dteResult.sello_recepcion || null,
              updated_at:         new Date().toISOString(),
            }).eq('id', currentCuentaId)
          }
        } catch (err) {
          console.error('Error emitiendo DTE:', err)
          dteError = err.message || 'Error desconocido al emitir DTE'
          // NO lanzamos error — la venta ya se cobró correctamente
        }
      }

      // 6. Actualizar última visita del cliente
      if (paymentData.cliente?.id) {
        db.from('pos_clientes').update({
          ultima_visita: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', paymentData.cliente.id).then(() => {}).catch(() => {})
      }

      // 7. Deducir inventario (best-effort — no bloquea el cobro)
      try {
        await db.rpc('pos_deducir_inventario', { p_cuenta_id: currentCuentaId, p_store_code: storeCode })
      } catch (invErr) {
        console.warn('Inventario no deducido:', invErr.message)
      }

      return { cuenta: { id: currentCuentaId }, dte: dteResult, dteError }

    } finally {
      setSaving(false)
    }
  }

  // handlePaymentConfirm devuelve resultado (NO cierra modal)
  // El modal se cierra solo cuando el usuario toca "Nueva orden"
  const handlePaymentConfirm = async (paymentData) => {
    return await saveCuenta(paymentData)
  }

  // Cuando el usuario confirma en el ticket de confirmación
  const handlePaymentComplete = () => {
    setItems([])
    setShowPayModal(false)
    onBack()
  }

  // ── Loading ──
  if (loadingCuenta) {
    return (
      <div style={{ minHeight: '100vh', background: '#1c1c22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="spin" />
        <span style={{ color: '#8b8997', fontSize: 14 }}>Cargando cuenta...</span>
      </div>
    )
  }

  return (
    <div className="pos-layout">

      {/* ── HEADER ── */}
      <header className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
        <img src="/icon-192.png" alt="Freakie Dogs" className="pos-header-logo" />
        <span className="pos-header-store">{storeName}</span>

        <span
          className="pos-header-btn"
          style={{ background: tipoInfo.color + '18', borderColor: tipoInfo.color, color: tipoInfo.color, cursor: 'default' }}
        >
          {tipoInfo.icon} {tipoInfo.label}{mesaActual ? ` #${mesaActual}` : ''}
        </span>

        {tipo === 'mesa' && perms.moverMesa && (
          <button
            className="pos-header-btn"
            onClick={() => setShowTransferModal(true)}
            title="Mover a otra mesa"
          >
            ↔ Mesa
          </button>
        )}

        {tipo === 'mesa' && perms.cobrar && cuentaId && items.length > 0 && (
          <button
            className="pos-header-btn"
            onClick={() => setShowSplitModal(true)}
            title="Dividir cuenta"
          >
            ✂ Dividir
          </button>
        )}

        {perms.preCuenta && items.length > 0 && (
          <button
            className="pos-header-btn"
            onClick={handlePreCuenta}
            title="Imprimir pre-cuenta"
          >
            🖨 Pre-cuenta
          </button>
        )}

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
                  <div style={{ color: '#6b6878', fontSize: 13, padding: 20, gridColumn: '1/-1' }}>
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
              {tipoInfo.icon} {tipoInfo.label}{mesaActual ? ` #${mesaActual}` : ''}
            </span>
            {cuentaId
              ? <span className="pos-order-open-badge">Cuenta Abierta</span>
              : <div className="pos-order-num">Orden #{String(cuentaNum || 1).padStart(4, '0')}</div>
            }
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
                  <div
                    className="pos-order-item-status"
                    title={item.saved ? 'Comandado' : 'Pendiente de comandar'}
                    style={{ color: item.saved ? '#2dd4a866' : '#fbbf24' }}
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
                          style={{ color: '#8b8997', fontSize: 12 }}
                          onClick={() => { setShowNoteModal(idx); setNoteText(item.nota || '') }}
                        >📝</button>
                        <button className="pos-order-item-del" onClick={() => removeItem(idx)}>✕</button>
                      </div>
                    )}
                    {item.saved && perms.anular && (
                      <button
                        className="pos-order-item-del"
                        style={{ color: '#f8717130', fontSize: 11 }}
                        title="Anular ítem (requiere cajera)"
                        onClick={() => {
                          if (confirm(`¿Anular "${item.nombre}"?`)) removeItem(idx)
                        }}
                      >🚫</button>
                    )}
                    {item.saved && !perms.anular && (
                      <span style={{ fontSize: 10, color: '#6b6878', marginTop: 2 }} title="Solo cajera puede anular">🔒</span>
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
            {descuentoMonto > 0 && (
              <div className="pos-order-subtotal" style={{ color: '#f87171' }}>
                <span>
                  {descuentoTipo === 'cortesia' ? '🎁 Cortesía' : descuentoTipo === 'porcentaje' ? `🏷 -${descuento}%` : '🏷 Descuento'}
                  {descuentoMotivo ? ` (${descuentoMotivo})` : ''}
                </span>
                <span>-${descuentoMonto.toFixed(2)}</span>
              </div>
            )}
            <div className="pos-order-total">
              <span>TOTAL</span>
              <span>${total.toFixed(2)}</span>
            </div>

            {perms.comandar && (
              <button
                className="pos-comandar-btn"
                disabled={!hasNew || commanding}
                onClick={handleComandar}
              >
                {commanding
                  ? '⏳ Comandando...'
                  : `🔔 COMANDAR${newItems.length > 0 ? ` (${newItems.reduce((s, i) => s + i.qty, 0)})` : ''}`
                }
              </button>
            )}

            {perms.cobrar ? (
              <button
                className="pos-cobrar-btn"
                disabled={items.length === 0 || saving}
                onClick={() => setShowPayModal(true)}
              >
                {saving ? '...' : `💳 COBRAR $${total.toFixed(2)}`}
              </button>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 12, color: '#6b6878', padding: '8px 0' }}>
                🔒 Cobro solo por cajera/gerente
              </div>
            )}

            {perms.descuento && items.length > 0 && (
              <button
                className="pos-header-btn"
                style={{ width: '100%', marginTop: 4, fontSize: 12, padding: '6px 0', color: '#f4a261', borderColor: '#f4a26133' }}
                onClick={() => setShowDiscountModal(true)}
              >
                🏷 {descuentoMonto > 0 ? `Descuento: -$${descuentoMonto.toFixed(2)}` : 'Aplicar descuento'}
              </button>
            )}

            {hasNew && (
              <button className="pos-clear-btn" onClick={clearNewItems}>
                🗑 Limpiar nuevos
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Nota */}
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
            <button className="pos-confirmar-btn" onClick={saveNota}>Guardar nota</button>
            <button className="pos-cancelar-btn" onClick={() => setShowNoteModal(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal: Pago + DTE */}
      {showPayModal && (
        <PaymentModal
          items={items}
          total={total}
          onConfirm={handlePaymentConfirm}
          onComplete={handlePaymentComplete}
          onClose={() => setShowPayModal(false)}
          saving={saving}
        />
      )}

      {/* Modal: Descuento */}
      {showDiscountModal && (
        <div className="pos-modal-overlay" onClick={() => setShowDiscountModal(false)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="pos-modal-title">🏷 Aplicar Descuento</div>
            <div style={{ color: '#8b8997', fontSize: 12, marginBottom: 12 }}>Subtotal: ${subtotal.toFixed(2)}</div>

            {/* Tipo de descuento */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[
                { key: 'porcentaje', label: '% Porcentaje' },
                { key: 'monto', label: '$ Monto fijo' },
                { key: 'cortesia', label: '🎁 Cortesía' },
              ].map(opt => (
                <button
                  key={opt.key}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    background: descuentoTipo === opt.key ? '#f4a26122' : '#1a1a1a',
                    border: `1px solid ${descuentoTipo === opt.key ? '#f4a261' : '#2a2a32'}`,
                    color: descuentoTipo === opt.key ? '#f4a261' : '#888',
                  }}
                  onClick={() => {
                    setDescuentoTipo(opt.key)
                    if (opt.key === 'cortesia') setDescuento(100)
                    else setDescuento(0)
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Valor */}
            {descuentoTipo && descuentoTipo !== 'cortesia' && (
              <div style={{ marginBottom: 12 }}>
                <label className="pos-payment-label">
                  {descuentoTipo === 'porcentaje' ? 'Porcentaje (%)' : 'Monto ($)'}
                </label>
                {descuentoTipo === 'porcentaje' ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[5, 10, 15, 20, 25, 50].map(p => (
                      <button
                        key={p}
                        style={{
                          flex: 1, padding: '8px 2px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                          background: descuento === p ? '#f4a26122' : '#1c1c22',
                          border: `1px solid ${descuento === p ? '#f4a261' : '#2a2a32'}`,
                          color: descuento === p ? '#f4a261' : '#888',
                        }}
                        onClick={() => setDescuento(p)}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    className="pos-payment-input"
                    type="number" min="0" max={subtotal} step="0.25"
                    value={descuento || ''}
                    onChange={e => setDescuento(Math.min(parseFloat(e.target.value) || 0, subtotal))}
                    placeholder="$0.00"
                    style={{ fontSize: 14, padding: '8px 12px' }}
                  />
                )}
              </div>
            )}

            {/* Motivo */}
            {descuentoTipo && (
              <div style={{ marginBottom: 12 }}>
                <label className="pos-payment-label">Motivo (opcional)</label>
                <input
                  className="pos-payment-input"
                  placeholder="Ej: Cliente frecuente, error en pedido..."
                  value={descuentoMotivo}
                  onChange={e => setDescuentoMotivo(e.target.value)}
                  style={{ fontSize: 13, padding: '8px 12px' }}
                />
              </div>
            )}

            {/* Preview */}
            {descuentoTipo && (
              <div style={{ background: '#1a0a0a', borderRadius: 8, padding: 10, marginBottom: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#8b8997' }}>Descuento aplicado</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#f87171' }}>
                  -${(descuentoTipo === 'porcentaje' ? subtotal * descuento / 100 : descuentoTipo === 'cortesia' ? subtotal : descuento).toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: '#2dd4a8' }}>
                  Total: ${Math.max(0, subtotal - (descuentoTipo === 'porcentaje' ? subtotal * descuento / 100 : descuentoTipo === 'cortesia' ? subtotal : descuento)).toFixed(2)}
                </div>
              </div>
            )}

            <button
              className="pos-confirmar-btn"
              disabled={!descuentoTipo}
              onClick={() => setShowDiscountModal(false)}
            >
              ✅ Aplicar descuento
            </button>
            {descuentoMonto > 0 && (
              <button
                className="pos-cancelar-btn"
                style={{ color: '#f87171' }}
                onClick={() => {
                  setDescuento(0)
                  setDescuentoTipo(null)
                  setDescuentoMotivo('')
                  setShowDiscountModal(false)
                }}
              >
                🗑 Quitar descuento
              </button>
            )}
            <button className="pos-cancelar-btn" onClick={() => setShowDiscountModal(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal: Transfer de mesa */}
      {showTransferModal && (
        <MesaTransferModal
          storeCode={storeCode}
          mesaActual={mesaActual}
          onTransfer={handleMesaTransfer}
          onClose={() => setShowTransferModal(false)}
        />
      )}

      {/* Modal: Dividir Cuenta */}
      {showSplitModal && (
        <SplitCheckModal
          cuentaId={cuentaId}
          items={items}
          storeCode={storeCode}
          userId={user.id}
          mesaRef={mesaRef}
          onClose={() => setShowSplitModal(false)}
          onSplit={() => {
            setShowSplitModal(false)
            onBack()
          }}
        />
      )}
    </div>
  )
}
