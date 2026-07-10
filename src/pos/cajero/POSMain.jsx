import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { STORES, today } from '../../config'
import PaymentModal from './PaymentModal'
import MesaTransferModal from './MesaTransferModal'
import SplitCheckModal from './SplitCheckModal'
import { emitDTE } from './dteService'
import { printComanda, printPreCuenta, printFactura } from '../print/printService'
import Icon, { EMOJI_ICON } from '../Icon'
import { useToast } from '../../hooks/useToast'

// ──────────────────────────────────────────────
// Constantes de display
// ──────────────────────────────────────────────
const TIPO_INFO = {
  'mesa':           { ic: 'armchair', label: 'Mesa',        color: '#2dd4a8', canal: 'local'          },
  'para_llevar':    { ic: 'bag',      label: 'Para Llevar', color: '#f4a261', canal: 'para_llevar'     },
  'delivery_propio':{ ic: 'bike',     label: 'Delivery',    color: '#60a5fa', canal: 'delivery_propio' },
  'pedidos_ya':     { ic: 'bike',     label: 'PedidosYa',   color: '#a78bfa', canal: 'pedidos_ya'      },
  'drive_through':  { ic: 'car',      label: 'Drive Thru',  color: '#fbbf24', canal: 'drive_through'   },
  'delivery_app':   { ic: 'phone',    label: 'App Delivery', color: '#f472b6', canal: 'delivery_app'   },
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

// Aplana el carrito a líneas de DTE: ítem base + una línea por cada extra con precio (>0).
// Los extras gratis no generan línea. Cada extra hereda la cantidad del ítem padre.
function buildDteLineItems(cart) {
  const lines = []
  cart.forEach(it => {
    lines.push({ nombre: it.nombre, precio: it.precio, qty: it.qty })
    ;(it.modificadores || []).forEach(m => {
      const px = Number(m.precio_extra) || 0
      if (px > 0) lines.push({ nombre: `  + ${m.nombre}`, precio: px, qty: it.qty })
    })
  })
  return lines
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
  const toast = useToast()

  // Permisos del rol activo
  const perms = PERMISOS_POR_ROL[user.rol] || DEFAULT_PERMS

  // Contexto de la cuenta actual
  const tipo     = cuentaCtx?.tipo     || 'para_llevar'
  const mesaRef  = cuentaCtx?.mesa_ref || null
  // Demografía recibida al abrir mesa (POSHome) — se guarda al crear la cuenta
  const paxCtx   = cuentaCtx?.pax || null
  const paxFields = paxCtx ? { pax_mujeres: paxCtx.mujeres || 0, pax_hombres: paxCtx.hombres || 0, pax_ninos: paxCtx.ninos || 0 } : {}
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
  const [modPicker,         setModPicker]          = useState(null)  // producto con grupos por elegir
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

      // Grupos de modificadores asignados a ítems
      const { data: asignData } = await db
        .from('pos_item_modificadores')
        .select(`
          menu_item_id,
          pos_modificadores_grupo (
            id, nombre, tipo, obligatorio, min_selecciones, max_selecciones, orden, activo,
            pos_modificadores ( id, nombre, nombre_corto, precio_extra, orden, activo )
          )
        `)

      const modMap = {}  // menu_item_id -> [grupos normalizados]
      ;(asignData || []).forEach(a => {
        const g = a.pos_modificadores_grupo
        if (!g || g.activo === false) return
        const opciones = (g.pos_modificadores || [])
          .filter(o => o.activo !== false)
          .sort((x, y) => (x.orden || 0) - (y.orden || 0))
        if (opciones.length === 0) return
        if (!modMap[a.menu_item_id]) modMap[a.menu_item_id] = []
        modMap[a.menu_item_id].push({
          id: g.id, nombre: g.nombre, tipo: g.tipo,
          obligatorio: g.obligatorio, min_selecciones: g.min_selecciones || 0,
          max_selecciones: g.max_selecciones || 0, orden: g.orden || 0, opciones,
        })
      })
      Object.values(modMap).forEach(arr => arr.sort((a, b) => a.orden - b.orden))

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
                .map(i => ({ ...i, modGrupos: modMap[i.id] || [] })),
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
        .select('id, menu_item_id, nombre, precio_unitario, cantidad, notas, modificadores, precio_modificadores')
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
          modificadores: it.modificadores || [],
          precioExtra:   parseFloat(it.precio_modificadores) || 0,
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
  const addItemToCart = useCallback((product, modificadores = [], precioExtra = 0) => {
    setItems(prev => {
      // Solo fusiona líneas idénticas cuando NO hay modificadores ni nota
      if (modificadores.length === 0) {
        const idx = prev.findIndex(i => i.id === product.id && !i.nota && !i.saved && (!i.modificadores || i.modificadores.length === 0))
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
          return next
        }
      }
      return [...prev, {
        id:     product.id,
        nombre: product.nombre,
        precio: parseFloat(product.precio),
        qty:    1,
        nota:   '',
        saved:  false,
        estacion: product.estacion || 'general',
        modificadores,
        precioExtra,
      }]
    })
  }, [])

  const addItem = useCallback((product) => {
    const grupos = product.modGrupos || []
    if (grupos.length === 0) { addItemToCart(product, [], 0); return }
    setModPicker(product)   // abre selector de modificadores
  }, [addItemToCart])

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
  const subtotal = items.reduce((s, i) => s + (i.precio + (i.precioExtra || 0)) * i.qty, 0)
  const descuentoMonto = descuentoTipo === 'porcentaje'
    ? Math.round(subtotal * descuento / 100 * 100) / 100
    : descuentoTipo === 'cortesia'
    ? subtotal
    : descuento
  const total = Math.max(0, subtotal - descuentoMonto)
  const newItems = items.filter(i => !i.saved)
  const hasNew   = newItems.length > 0

  // ── Normaliza el carrito al formato que espera printService ──
  const buildCuentaPrint = (lista = items) => ({
    storeCode,
    storeName,
    mesa: mesaActual,
    tipoLabel: tipoInfo.label,
    orden: null,
    mesero: user?.nombre || user?.name || null,
    cajero: user?.nombre || user?.name || null,
    comandaNumero: comandaSeq,
    items: lista.map(i => ({
      nombre: i.nombre,
      precio: i.precio,
      qty: i.qty,
      nota: i.nota || null,
      modificadores: (i.modificadores || []).map(m => Number(m.precio_extra) > 0
        ? `${m.nombre} (+$${Number(m.precio_extra).toFixed(2)})`
        : m.nombre),
    })),
    subtotal,
    descuento: descuentoMonto,
    total,
    propinaSugerida: !!mesaActual,
  })

  // ── PRE-CUENTA (impresión térmica centralizada) ──
  // Al salir: si la cuenta quedó sin ítems activos, cancelarla para no dejar órdenes vacías
  const handleBack = async () => {
    try {
      if (cuentaId) {
        const { count } = await db
          .from('pos_cuenta_items')
          .select('id', { count: 'exact', head: true })
          .eq('cuenta_id', cuentaId)
          .is('cancelado_motivo', null)
        if ((count || 0) === 0) {
          await db.from('pos_cocina_queue').delete().eq('cuenta_id', cuentaId).in('estado', ['pendiente', 'en_preparacion'])
          await db.from('pos_cuentas')
            .update({ estado: 'cancelada', cancelada_motivo: 'Orden vacía al salir', updated_at: new Date().toISOString() })
            .eq('id', cuentaId)
            .neq('estado', 'cobrada')
        }
      }
    } catch (e) {
      console.error('No se pudo auto-cancelar orden vacía:', e)
    }
    onBack()
  }

  const handlePreCuenta = async () => {
    if (items.length === 0) return
    try {
      await printPreCuenta(buildCuentaPrint())
    } catch (err) {
      console.error('Error al imprimir pre-cuenta:', err)
      toast.error('No se pudo imprimir la pre-cuenta')
    }
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
            ...paxFields,
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
        modificadores:   it.modificadores?.length ? it.modificadores : null,
        precio_modificadores: it.precioExtra || 0,
        comanda_numero:  comandaSeq,
        enviado_cocina_at: new Date().toISOString(),
      }))
      const { data: insertedItems, error: itemsErr } = await db.from('pos_cuenta_items').insert(toInsert).select('id')
      if (itemsErr) throw new Error('No se guardaron los ítems: ' + itemsErr.message)

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
          modificadores:  it.modificadores?.length ? it.modificadores : null,
          estacion:       it.estacion || 'general',
          estado:         'pendiente',
          prioridad:      tipo === 'pedidos_ya' ? 8 : tipo === 'drive_through' ? 7 : 5,
          comanda_numero: comandaSeq,
        }))
      )

      // Imprime la comanda térmica con SOLO los ítems recién enviados a cocina
      try {
        await printComanda(buildCuentaPrint(newItems))
      } catch (pErr) {
        console.error('Comanda enviada pero no se imprimió:', pErr)
        toast.error('Comanda guardada, pero no se imprimió')
      }

      setComandaSeq(s => s + 1)
      setItems(prev => prev.map(i => ({ ...i, saved: true })))
      setCommandedCount(items.length)

    } catch (err) {
      console.error('Error al comandar:', err)
      toast.error('Error al comandar: ' + err.message)
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
            ...paxFields,
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
          modificadores:   it.modificadores?.length ? it.modificadores : null,
          precio_modificadores: it.precioExtra || 0,
          comanda_numero:  comandaSeq,
          enviado_cocina_at: new Date().toISOString(),
        }))
        const { data: insertedItems, error: itemsErr } = await db.from('pos_cuenta_items').insert(toInsert).select('id')
        if (itemsErr) throw new Error('No se guardaron los ítems: ' + itemsErr.message)

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
            modificadores:  it.modificadores?.length ? it.modificadores : null,
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
            items:    buildDteLineItems(items), // ítems + extras con precio como líneas separadas
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

      // La impresión de la factura/ticket se dispara desde el botón de la
      // pantalla de confirmación (PaymentModal → onPrintFactura), porque el
      // navegador bloquea el deep-link rawbt: si no hay gesto del usuario
      // reciente (la emisión del DTE a Hacienda puede tardar varios segundos).
      return { cuenta: { id: currentCuentaId }, dte: dteResult, dteError }

    } finally {
      setSaving(false)
    }
  }

  // Imprime factura/ticket desde el botón de confirmación (gesto del usuario).
  const handlePrintFactura = ({ dteResult, tipoDte, propina = 0, metodo, cliente }) => {
    const DTE_LABEL = {
      factura: 'FACTURA (Consumidor Final)',
      ccf:     'COMPROBANTE DE CRÉDITO FISCAL',
      se:      'FACTURA SUJETO EXCLUIDO',
    }
    const clientePrint = cliente
      ? { nombre: cliente.nombre, doc: cliente.nit || cliente.numero_documento || cliente.nrc || null }
      : null
    return printFactura({
      ...buildCuentaPrint(items),
      propina,
      total:      total + (propina || 0),
      metodoPago: metodo,
      iva:        dteResult?.monto_iva ?? null,
      cliente:    clientePrint,
      fecha:      new Date(),
      // Solo es fiscal si el DTE se emitió OK; si falló, sale como ticket interno
      dte: dteResult ? {
        tipo:             tipoDte,
        label:            DTE_LABEL[tipoDte] || 'DTE',
        numeroControl:    dteResult.numero_control || null,
        codigoGeneracion: dteResult.codigo_generacion || null,
        sello:            dteResult.sello_recepcion || null,
        fecha:            new Date(),
      } : null,
    })
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
        <button className="pos-header-btn" onClick={handleBack}>← Inicio</button>
        <img src="/icon-192.png" alt="Freakie Dogs" className="pos-header-logo" />
        <span className="pos-header-store">{storeName}</span>

        <span
          className="pos-header-btn"
          style={{ background: tipoInfo.color + '18', borderColor: tipoInfo.color, color: tipoInfo.color, cursor: 'default' }}
        >
          <Icon name={tipoInfo.ic} size={15} /> {tipoInfo.label}{mesaActual ? ` #${mesaActual}` : ''}
        </span>

        {tipo === 'mesa' && perms.moverMesa && (
          <button
            className="pos-header-btn"
            onClick={() => setShowTransferModal(true)}
            title="Mover a otra mesa"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="move" size={15} /> Mesa</span>
          </button>
        )}

        {tipo === 'mesa' && perms.cobrar && cuentaId && items.length > 0 && (
          <button
            className="pos-header-btn"
            onClick={() => setShowSplitModal(true)}
            title="Dividir cuenta"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="scissors" size={15} /> Dividir</span>
          </button>
        )}

        {perms.preCuenta && items.length > 0 && (
          <button
            className="pos-header-btn"
            onClick={handlePreCuenta}
            title="Imprimir pre-cuenta"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="receipt" size={16} /> Pre-cuenta
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
                    <span className="pos-cat-icon">{EMOJI_ICON[cat.icono] ? <Icon name={EMOJI_ICON[cat.icono]} size={16} /> : cat.icono}</span>
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
              <Icon name={tipoInfo.ic} size={15} /> {tipoInfo.label}{mesaActual ? ` #${mesaActual}` : ''}
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
                <div className="pos-order-empty-icon" style={{ display: 'flex', justifyContent: 'center' }}><Icon name="cart" size={40} color="#43382f" /></div>
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
                    {(item.modificadores || []).length > 0 && (
                      <div style={{ fontSize: 11, color: '#8b8997', lineHeight: 1.5 }}>
                        {item.modificadores.map((m, i) => (
                          <div key={i}>+ {m.nombre}{Number(m.precio_extra) > 0 ? ` ($${Number(m.precio_extra).toFixed(2)})` : ''}</div>
                        ))}
                      </div>
                    )}
                    {item.nota && (
                      <div className="pos-order-item-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="pencil" size={11} /> {item.nota}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <div className="pos-order-item-price">
                      ${((item.precio + (item.precioExtra || 0)) * item.qty).toFixed(2)}
                    </div>
                    {!item.saved && (
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button
                          className="pos-order-item-del"
                          style={{ color: '#8b8997', fontSize: 12 }}
                          onClick={() => { setShowNoteModal(idx); setNoteText(item.nota || '') }}
                        ><Icon name="pencil" size={13} /></button>
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
                      ><Icon name="ban" size={13} /></button>
                    )}
                    {item.saved && !perms.anular && (
                      <span style={{ marginTop: 2 }} title="Solo cajera puede anular"><Icon name="lock" size={12} color="#6b6878" /></span>
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

            {perms.preCuenta && items.length > 0 && (
              <button
                className="pos-clear-btn"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#e8e6ef', borderColor: '#43382f' }}
                onClick={handlePreCuenta}
              >
                <Icon name="receipt" size={16} /> Pre-cuenta
              </button>
            )}

            {perms.comandar && (
              <button
                className="pos-comandar-btn"
                disabled={!hasNew || commanding}
                onClick={handleComandar}
              >
                {commanding
                  ? '⏳ Comandando...'
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="bell" size={18} /> COMANDAR{newItems.length > 0 ? ` (${newItems.reduce((s, i) => s + i.qty, 0)})` : ''}
                    </span>
                }
              </button>
            )}

            {perms.cobrar ? (
              <button
                className="pos-cobrar-btn"
                disabled={items.length === 0 || saving}
                onClick={() => setShowPayModal(true)}
              >
                {saving ? '...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="card" size={18} /> COBRAR ${total.toFixed(2)}</span>}
              </button>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 12, color: '#6b6878', padding: '8px 0' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="lock" size={13} /> Cobro solo por cajera/gerente</span>
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
            <div className="pos-modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="pencil" size={16} /> Nota para cocina</div>
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

      {/* Modal: Selección de modificadores */}
      {modPicker && (
        <ModPickerModal
          product={modPicker}
          onConfirm={(mods, extra) => { addItemToCart(modPicker, mods, extra); setModPicker(null) }}
          onCancel={() => setModPicker(null)}
        />
      )}

      {/* Modal: Pago + DTE */}
      {showPayModal && (
        <PaymentModal
          items={items}
          total={total}
          onConfirm={handlePaymentConfirm}
          onComplete={handlePaymentComplete}
          onPrintFactura={handlePrintFactura}
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
      <toast.Toast />
    </div>
  )
}

// ──────────────────────────────────────────────
// ModPickerModal — selección de modificadores al agregar un ítem
// ──────────────────────────────────────────────
function ModPickerModal({ product, onConfirm, onCancel }) {
  const grupos = product.modGrupos || []
  const [sel, setSel] = useState({})   // grupoId -> [modId, ...]

  const toggle = (g, m) => {
    setSel(prev => {
      const cur = prev[g.id] || []
      if (g.tipo === 'unico') return { ...prev, [g.id]: [m.id] }
      if (cur.includes(m.id)) return { ...prev, [g.id]: cur.filter(x => x !== m.id) }
      if (g.max_selecciones > 0 && cur.length >= g.max_selecciones) return prev  // tope alcanzado
      return { ...prev, [g.id]: [...cur, m.id] }
    })
  }

  // Modificadores elegidos + precio extra total
  const elegidos = []
  grupos.forEach(g => (sel[g.id] || []).forEach(mid => {
    const m = g.opciones.find(o => o.id === mid)
    if (m) elegidos.push({ id: m.id, nombre: m.nombre, nombre_corto: m.nombre_corto || '', precio_extra: Number(m.precio_extra) || 0 })
  }))
  const extra = elegidos.reduce((s, m) => s + m.precio_extra, 0)

  // Validación de grupos obligatorios / mínimos
  const falta = grupos.find(g => {
    const n = (sel[g.id] || []).length
    if (g.obligatorio && n < 1) return true
    if (g.min_selecciones > 0 && n < g.min_selecciones) return true
    return false
  })

  const reqLabel = (g) => {
    if (g.obligatorio || g.min_selecciones > 0) {
      const min = Math.max(g.min_selecciones || 0, g.obligatorio ? 1 : 0)
      return `Elige ${min}${g.max_selecciones > 0 && g.max_selecciones !== min ? `–${g.max_selecciones}` : ''}`
    }
    if (g.tipo === 'unico') return 'Elige 1 (opcional)'
    return g.max_selecciones > 0 ? `Hasta ${g.max_selecciones} (opcional)` : 'Opcional'
  }

  return (
    <div className="pos-modal-overlay" onClick={onCancel}>
      <div className="pos-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="pos-modal-title">{product.nombre}</div>
        <div className="pos-modal-sub" style={{ marginBottom: 8 }}>Personaliza tu pedido</div>

        {grupos.map(g => {
          const cur = sel[g.id] || []
          return (
            <div key={g.id} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{g.nombre}</span>
                <span style={{ fontSize: 11, color: '#8b8997' }}>{reqLabel(g)}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {g.opciones.map(m => {
                  const on = cur.includes(m.id)
                  const px = Number(m.precio_extra) || 0
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggle(g, m)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${on ? '#2dd4a8' : '#2a2a32'}`,
                        background: on ? 'rgba(45,212,168,0.12)' : '#1c1c22',
                        color: '#e8e6ef', fontSize: 14,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 15 }}>{on ? (g.tipo === 'unico' ? '🔘' : '☑️') : (g.tipo === 'unico' ? '⚪' : '⬜')}</span>
                        {m.nombre}
                      </span>
                      <span style={{ color: px > 0 ? '#2dd4a8' : '#8b8997', fontSize: 13, fontWeight: 600 }}>
                        {px > 0 ? `+$${px.toFixed(2)}` : 'gratis'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 14px', fontSize: 14 }}>
          <span style={{ color: '#8b8997' }}>Precio</span>
          <span style={{ fontWeight: 700 }}>
            ${(parseFloat(product.precio) + extra).toFixed(2)}
            {extra > 0 && <span style={{ color: '#8b8997', fontWeight: 400, fontSize: 12 }}> (base ${parseFloat(product.precio).toFixed(2)} + ${extra.toFixed(2)})</span>}
          </span>
        </div>

        <button
          className="pos-confirmar-btn"
          disabled={!!falta}
          style={falta ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
          onClick={() => onConfirm(elegidos, extra)}
        >
          {falta ? `Falta elegir: ${falta.nombre}` : 'Agregar al pedido'}
        </button>
        <button className="pos-cancelar-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
