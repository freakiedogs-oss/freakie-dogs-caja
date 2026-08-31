import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../../supabase'
import { STORES, STORES_SIN_COMANDA, today } from '../../config'
import { confirmAsync } from '../confirmDialog'
import PaymentModal from './PaymentModal'
import MesaTransferModal from './MesaTransferModal'
import SplitCheckModal from './SplitCheckModal'
import ProductoModifiersModal from './ProductoModifiersModal'
import { emitDTE } from './dteService'
import { printComanda, printPreCuenta, printFactura, getImpresora } from '../print/printService'
import Icon, { EMOJI_ICON } from '../Icon'
import PinAuthModal from '../PinAuthModal'
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
// Fila deslizable: arrastra a la izquierda para revelar el boton rojo "Eliminar".
// Funciona con mouse (drag) y tactil (swipe). No bloquea el scroll vertical (touch-action: pan-y en CSS).
function SwipeRow({ children, onDelete }) {
  const [dx, setDx] = useState(0)
  const [open, setOpen] = useState(false)
  const start = useRef(null)
  const REVEAL = 96

  const down = (e) => { start.current = e.clientX; try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {} }
  const move = (e) => {
    if (start.current == null) return
    let d = e.clientX - start.current + (open ? -REVEAL : 0)
    d = Math.min(0, Math.max(-REVEAL - 24, d))
    setDx(d)
  }
  const up = () => {
    if (start.current == null) return
    start.current = null
    const abierto = dx < -REVEAL / 2
    setOpen(abierto); setDx(abierto ? -REVEAL : 0)
  }

  return (
    <div className="swipe-wrap">
      <button className="swipe-del" style={{ width: REVEAL }} onClick={() => { setOpen(false); setDx(0); onDelete() }}>
        <Icon name="trash" size={20} /><span>Eliminar</span>
      </button>
      <div
        className="swipe-fg"
        style={{ transform: `translateX(${dx}px)`, transition: start.current == null ? 'transform .18s ease' : 'none' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {children}
      </div>
    </div>
  )
}

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
// Arma las líneas del DTE. `descuento` es el monto en $ aplicado a la cuenta: se PRORRATEA
// entre las líneas, porque el DTE debe emitirse por lo que realmente se cobró. Sin esto, una
// cortesía del 100% emitía un DTE por el monto entero habiendo cobrado $0 (sobre-declaración).
function buildDteLineItems(cart, descuento = 0) {
  const lines = []
  cart.forEach(it => {
    lines.push({ nombre: it.nombre, precio: it.precio, qty: it.qty })
    ;(it.modificadores || []).forEach(m => {
      const px = Number(m.precio_extra) || 0
      if (px > 0) lines.push({ nombre: `  + ${m.nombre}`, precio: px, qty: it.qty })
    })
    // Extras de los componentes del combo
    ;(it.componentes || []).forEach(c => (c.modificadores || []).forEach(m => {
      const px = Number(m.precio_extra) || 0
      if (px > 0) lines.push({ nombre: `  + ${m.nombre}`, precio: px, qty: it.qty * (c.cantidad || 1) })
    }))
  })

  const desc = Number(descuento) || 0
  if (desc <= 0) return lines

  const bruto = lines.reduce((s, l) => s + l.precio * l.qty, 0)
  if (bruto <= 0) return lines
  const factor = Math.max(0, 1 - desc / bruto)

  // Se prorratea sobre cada línea y el residuo de redondeo se ajusta en la línea más grande,
  // para que la suma del DTE cuadre al centavo con el total cobrado.
  const ajustadas = lines.map(l => ({ ...l, precio: Math.round(l.precio * factor * 100) / 100 }))
  const objetivo = Math.round((bruto - desc) * 100) / 100
  const suma = Math.round(ajustadas.reduce((s, l) => s + l.precio * l.qty, 0) * 100) / 100
  const resto = Math.round((objetivo - suma) * 100) / 100
  if (resto !== 0) {
    let iMax = 0
    ajustadas.forEach((l, i) => { if (l.precio * l.qty > ajustadas[iMax].precio * ajustadas[iMax].qty) iMax = i })
    const l = ajustadas[iMax]
    l.precio = Math.round((l.precio + resto / l.qty) * 100) / 100
  }
  return ajustadas
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
export default function POSMain({ user, cuentaCtx, onBack, onLogout, onReport }) {
  const storeCode = user.store_code || 'S001'
  const caja = user.caja || null   // multi-caja (Lourdes): null = sucursal de 1 sola caja
  const storeName = STORES[storeCode] || storeCode
  const toast = useToast()

  // Precarga la impresora de la sucursal al abrir el POS: asi al imprimir, el
  // deep-link rawbt: se dispara SIN un await de red que en Android descartaria
  // el gesto del usuario y bloquearia la impresion (pre-cuenta/comanda).
  useEffect(() => { getImpresora(storeCode, caja).catch(() => {}) }, [storeCode, caja])


  // Permisos del rol activo
  const perms = PERMISOS_POR_ROL[user.rol] || DEFAULT_PERMS

  // Contexto de la cuenta actual
  const tipo     = cuentaCtx?.tipo     || 'para_llevar'
  const mesaRef  = cuentaCtx?.mesa_ref || null
  // Demografía recibida al abrir mesa (POSHome) — se guarda al crear la cuenta
  const paxCtx   = cuentaCtx?.pax || null
  const paxFields = paxCtx ? { pax_mujeres: paxCtx.mujeres || 0, pax_hombres: paxCtx.hombres || 0, pax_ninos: paxCtx.ninos || 0 } : {}
  const tipoInfo = TIPO_INFO[tipo] || TIPO_INFO['para_llevar']

  // Destino de empaque (Comer aquí / Llevar) — SOLO informa a cocina si empacar.
  // Se habilita únicamente en canales con consumo en sitio: mesa y para_llevar (food court).
  // El menú a usar no depende solo del tipo de orden, sino tambien del TIPO DE SUCURSAL:
  // en restaurante "para llevar" es el menu de mesa (sin bebida, solo cambia el empaque);
  // en food court "para llevar" si lleva bebida. Lo resuelve pos_contexto_servicio en la DB.
  // Si la consulta falla o no hay fila, se cae al comportamiento anterior.
  const [ctxServicio, setCtxServicio] = useState(null)
  const [ctxListo,    setCtxListo]    = useState(false)

  const destinoAplica  = ctxServicio ? ctxServicio.destino_editable
                                     : (tipo === 'mesa' || tipo === 'para_llevar')
  const destinoDefault = ctxServicio?.destino_default || (tipo === 'mesa' ? 'aqui' : 'llevar')

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
  const [pinAuth,           setPinAuth]            = useState(null)
  const [noteText,          setNoteText]           = useState('')
  const [modPicker,         setModPicker]          = useState(null)  // producto con grupos por elegir
  const [removibles,        setRemovibles]         = useState([])    // ingredientes que admiten "SIN"
  const [removiblesCombo,   setRemoviblesCombo]    = useState([])    // idem, para el combo (se resuelve desde el ítem padre)
  const [editIdx,           setEditIdx]            = useState(null)  // índice del ítem que se está editando (lápiz)
  const [ordenDestino,      setOrdenDestino]       = useState(destinoDefault)  // destino global por default (aqui/llevar)
  // Ref con el destino a aplicar al agregar un ítem (null si el canal no aplica).
  const destinoRef = useRef(null)
  destinoRef.current = destinoAplica ? ordenDestino : null
  const [comboPicker,       setComboPicker]        = useState(null)  // combo con componentes por armar
  const [showTransferModal, setShowTransferModal]  = useState(false)
  const [showSplitModal,    setShowSplitModal]     = useState(false)
  const [saving,            setSaving]             = useState(false)
  const [commanding,        setCommanding]         = useState(false)
  // Candado SÍNCRONO anti doble-comanda: se fija antes de cualquier await, por lo que
  // aunque el cajero apriete COMANDAR varias veces (tablet lenta), solo la 1ra pasa.
  // El disabled={commanding} del botón depende de estado async y llega tarde.
  const commandingRef = useRef(false)
  // Token de idempotencia por "tap de COMANDAR". Persiste entre reintentos (si el
  // insert llegó al server pero al cliente se le cortó la red) y se limpia al éxito,
  // para que la DB rebote el reenvío en vez de duplicar la orden en el KDS.
  const comandaUidRef = useRef(null)
  // Si el cajero edita los ítems, el token deja de ser válido: el próximo COMANDAR
  // arranca uno nuevo. Así el token solo deduplica un reenvío IDÉNTICO (nunca
  // descarta un ítem que cambió por reusar su `linea`).
  useEffect(() => { comandaUidRef.current = null }, [items])
  const [loadingCuenta,     setLoadingCuenta]      = useState(!!cuentaCtx?.cuentaId)
  // Pedido web original (menú público) detrás de esta cuenta: {referencia, cliente, total, tipo}.
  // Se usa como guardarraíl al cobrar — la cuenta se puede editar (el cliente corrige por
  // WhatsApp), pero un total distinto al del pedido pide confirmación viendo cliente+referencia.
  const [pedidoWeb,         setPedidoWeb]          = useState(null)

  // Descuento
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [descuento, setDescuento]   = useState(0)
  const [descuentoTipo, setDescuentoTipo] = useState(null) // 'porcentaje' | 'monto' | 'cortesia'
  const [descuentoMotivo, setDescuentoMotivo] = useState('')
  // Categoría estructurada del descuento ('empleado' | 'cliente' | 'promo'). Antes solo
  // había motivo texto libre (nombres sueltos) y era imposible reportar "descuentos de
  // empleado" en el corte — el ticket ahora los lista en su propio apartado.
  const [descuentoCategoria, setDescuentoCategoria] = useState('')
  const [descuentoEmpleadoId, setDescuentoEmpleadoId] = useState('') // ficha real del empleado (consistencia)
  const [empleadosLista, setEmpleadosLista] = useState(null)         // null = aún no cargada
  const [sucursalIdLocal, setSucursalIdLocal] = useState(null)

  // Lista de empleados para el descuento de empleado (lazy: solo al elegir esa categoría).
  // OJO: este efecto debe ir DESPUÉS de las declaraciones de estado que usa —
  // arriba provocaba "Cannot access before initialization" y tumbaba el POS (Metro 15-ago).
  useEffect(() => {
    if (descuentoCategoria !== 'empleado' || empleadosLista !== null) return
    Promise.all([
      db.from('sucursales').select('id').eq('store_code', storeCode).maybeSingle(),
      db.from('empleados').select('id,nombre_completo,sucursal_id').eq('activo', true).order('nombre_completo'),
    ]).then(([se, e]) => {
      setSucursalIdLocal(se.data?.id || null)
      setEmpleadosLista(e.data || [])
    }).catch(() => setEmpleadosLista([]))
  }, [descuentoCategoria, empleadosLista, storeCode])

  // ── Resolver la matriz de servicio (sucursal × tipo de orden) ──
  // Va antes del menú porque decide QUÉ canal cargar. Ante cualquier fallo marca ctxListo igual,
  // para que el menú cargue con el comportamiento anterior y el POS nunca se quede en blanco.
  useEffect(() => {
    let vivo = true
    setCtxListo(false)
    db.rpc('pos_resolver_contexto_store', { p_store_code: storeCode, p_tipo_orden: tipo })
      .then(({ data, error }) => {
        if (!vivo) return
        setCtxServicio(!error && data && data.length ? data[0] : null)
      })
      .catch(() => { if (vivo) setCtxServicio(null) })
      .finally(() => { if (vivo) setCtxListo(true) })
    return () => { vivo = false }
  }, [storeCode, tipo])

  // Si la matriz manda otro destino por defecto que el asumido al montar, se sincroniza.
  useEffect(() => {
    if (ctxServicio?.destino_default) setOrdenDestino(ctxServicio.destino_default)
  }, [ctxServicio])

  // ── Botón SIN: qué se le puede quitar al producto que se está pidiendo ──
  // Se resuelve en la DB porque lo removible no está en la receta del ítem sino dentro de sus
  // bloques (Combo Hamburguesa → Hamburguesa Sencilla armada → pepinillos, queso, cebolla…).
  // Si falla, la sección simplemente no aparece: nunca bloquea la venta.
  useEffect(() => {
    if (!modPicker?.id) { setRemovibles([]); return }
    let vivo = true
    db.rpc('pos_ingredientes_removibles', { p_menu_item_id: modPicker.id })
      .then(({ data, error }) => {
        if (vivo) setRemovibles(!error && Array.isArray(data) ? data : [])
      })
      .catch(() => { if (vivo) setRemovibles([]) })
    return () => { vivo = false }
  }, [modPicker?.id])

  // Lo mismo para el combo. Se pregunta por el ítem PADRE, no por cada
  // componente: la RPC ya explota los bloques hacia adentro
  // (Freakie Burger → Hamburguesa Sencilla armada → cebolla, pepinillos, queso…)
  // y devuelve el `bloque` de cada ingrediente. Preguntar por el componente
  // devuelve vacío, porque el componente no tiene receta propia.
  // El backend aplica el SIN por LÍNEA (pos_deducir_preview lo lee tanto de los
  // modificadores del padre como de los del componente), así que dejarlo a
  // nivel de combo descuenta igual.
  useEffect(() => {
    if (!comboPicker?.id) { setRemoviblesCombo([]); return }
    let vivo = true
    db.rpc('pos_ingredientes_removibles', { p_menu_item_id: comboPicker.id })
      .then(({ data, error }) => {
        if (vivo) setRemoviblesCombo(!error && Array.isArray(data) ? data : [])
      })
      .catch(() => { if (vivo) setRemoviblesCombo([]) })
    return () => { vivo = false }
  }, [comboPicker?.id])

  // ── Cargar menú ──
  useEffect(() => {
    if (!ctxListo) return          // esperar la matriz: define el canal
    const load = async () => {
      setLoadingMenu(true)
      const canal = ctxServicio?.canal || tipoInfo.canal
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

      // Componentes de combos + info de ítems (nombre, estación) del menú cargado
      const { data: comboData } = await db
        .from('pos_combo_componentes')
        .select('combo_item_id, componente_item_id, cantidad, orden')

      const itemInfo = {}
      ;(menuData || []).forEach(m => (m.pos_menu_categorias || []).forEach(c => (c.pos_menu_items || []).forEach(i => {
        itemInfo[i.id] = { nombre: i.nombre, estacion: i.estacion, precio: i.precio }
      })))

      const comboMap = {}  // combo_item_id -> [componentes]
      ;(comboData || []).forEach(cc => {
        const info = itemInfo[cc.componente_item_id]
        if (!info) return
        if (!comboMap[cc.combo_item_id]) comboMap[cc.combo_item_id] = []
        comboMap[cc.combo_item_id].push({
          item_id: cc.componente_item_id,
          nombre: info.nombre,
          estacion: info.estacion || 'general',
          cantidad: cc.cantidad || 1,
          orden: cc.orden || 0,
          modGrupos: modMap[cc.componente_item_id] || [],
        })
      })
      Object.values(comboMap).forEach(arr => arr.sort((a, b) => a.orden - b.orden))

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
                .map(i => ({ ...i, modGrupos: modMap[i.id] || [], componentes: comboMap[i.id] || [] })),
            }))
          map[m.canal] = { id: m.id, nombre: m.nombre, categorias: cats }
        })
        setMenus(map)
      }
      setLoadingMenu(false)
    }
    load()
  }, [tipoInfo.canal, ctxListo, ctxServicio?.canal])

  // ── Cargar cuenta existente ──
  useEffect(() => {
    if (!cuentaCtx?.cuentaId) {
      setLoadingCuenta(false)
      return
    }
    const loadCuenta = async () => {
      setLoadingCuenta(true)
      setPedidoWeb(null)

      // Si la cuenta viene de un pedido web, traer cliente/total del pedido ORIGINAL
      // (delivery_clientes vía RPC SECDEF; RLS no deja leerla directo). Incidente 29-ago
      // ("los dos Erick"): se cobró un pedido re-tecleado dentro de la cuenta de otro
      // cliente — con esta info el cobro puede avisar cuando el total no coincide.
      try {
        const { data: cab } = await db
          .from('pos_cuentas')
          .select('delivery_referencia, cliente_nombre, delivery_cliente_id')
          .eq('id', cuentaCtx.cuentaId)
          .maybeSingle()
        if (cab?.delivery_cliente_id) {
          const { data: dinfo } = await db.rpc('pos_cuentas_delivery_info', { p_cuenta_ids: [cuentaCtx.cuentaId] })
          const d = dinfo?.[cuentaCtx.cuentaId]
          if (d?.total != null) {
            setPedidoWeb({
              referencia: cab.delivery_referencia || d.numero_orden || null,
              cliente:    cab.cliente_nombre || null,
              total:      parseFloat(d.total),
              tipo:       d.tipo || null,
            })
          }
        }
      } catch { /* sin info del pedido web el cobro sigue, solo sin guardarraíl */ }

      const { data: itemsData } = await db
        .from('pos_cuenta_items')
        .select('id, menu_item_id, nombre, precio_unitario, cantidad, notas, modificadores, precio_modificadores, componentes, atencion_especial, destino')
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
          componentes:   it.componentes || [],
          esCombo:       Array.isArray(it.componentes) && it.componentes.length > 0,
          atencionEspecial: !!it.atencion_especial,
          destino:       it.destino || null,
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
  // El canal lo manda la matriz de servicio (restaurante+llevar -> menú local, sin bebida).
  const canal      = ctxServicio?.canal || tipoInfo.canal
  const menuActivo = menus[canal] || menus['local'] || null
  const categorias = menuActivo?.categorias || []

  useEffect(() => {
    // Se abre en la primera categoría CON ítems: las que quedan vacías (p.ej. "Componentes",
    // que solo alimenta combos) no se muestran, así que seleccionarlas dejaría la grilla vacía.
    const conItems = categorias.filter(c => (c.items || []).length > 0)
    if (conItems.length > 0 && !activeCat) {
      setActiveCat(conItems[0].id)
    }
  }, [categorias])

  const itemsActivaCat = categorias.find(c => c.id === activeCat)?.items || []

  // ── Acciones de orden ──
  const addItemToCart = useCallback((product, modificadores = [], precioExtra = 0, qty = 1, nota = '', atencionEspecial = false) => {
    setItems(prev => {
      // Solo fusiona líneas idénticas cuando NO hay modificadores ni nota
      if (modificadores.length === 0 && !nota && qty === 1 && !atencionEspecial) {
        const idx = prev.findIndex(i => i.id === product.id && !i.nota && !i.saved && (!i.modificadores || i.modificadores.length === 0) && (i.destino || null) === destinoRef.current)
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
        qty,
        nota,
        saved:  false,
        estacion: product.estacion || 'general',
        modificadores,
        precioExtra,
        atencionEspecial,
        destino: destinoRef.current,
        modGrupos: product.modGrupos || [],   // se guarda para poder re-editar el ítem desde el resumen
      }]
    })
  }, [])

  // `qty` = cuántos combos IGUALES se agregan de una vez. Es una sola línea con
  // cantidad N (no N líneas): así el ticket, la cocina y el descuento de
  // inventario la tratan como el POS ya trata cualquier ítem con cantidad.
  const addComboToCart = useCallback((combo, componentes, generalMods, precioExtra, qty = 1) => {
    setItems(prev => [...prev, {
      id:     combo.id,
      nombre: combo.nombre,
      precio: parseFloat(combo.precio),
      qty:    Math.max(1, parseInt(qty, 10) || 1),
      nota:   '',
      saved:  false,
      estacion: combo.estacion || 'general',
      esCombo: true,
      componentes,                 // [{item_id,nombre,estacion,cantidad,modificadores:[...]}]
      modificadores: generalMods || [],
      precioExtra: precioExtra || 0,
      destino: destinoRef.current,
    }])
  }, [])

  const addItem = useCallback((product) => {
    const esCombo = (product.componentes || []).length > 0
    if (esCombo) {
      const hayQuePedir = (product.modGrupos || []).length > 0 ||
        (product.componentes || []).some(c => (c.modGrupos || []).length > 0)
      if (hayQuePedir) { setComboPicker(product); return }
      // Combo sin modificadores: se agrega con sus componentes fijos
      addComboToCart(product, product.componentes.map(c => ({
        item_id: c.item_id, nombre: c.nombre, estacion: c.estacion, cantidad: c.cantidad, modificadores: [],
      })), [], 0)
      return
    }
    const grupos = product.modGrupos || []
    if (grupos.length === 0) { addItemToCart(product, [], 0); return }
    setModPicker(product)   // abre selector de modificadores
  }, [addItemToCart, addComboToCart])

  // Filas para la cola de cocina: un combo se explota en una fila por componente (cada uno a su estación)
  const buildQueueRows = (lista, insertedItems, cuentaId, prioridad, comandaUid) => {
    let linea = 0
    return lista.flatMap((it, idx) => {
      const base = {
        cuenta_id:      cuentaId,
        cuenta_item_id: insertedItems?.[idx]?.id || null,
        store_code:     storeCode,
        canal:          tipo,
        mesa_ref:       mesaActual,
        mesero:         user?.nombre || user?.name || null,
        estado:         'pendiente',
        prioridad,
        comanda_numero: comandaSeq,
        comanda_uid:    comandaUid,
        atencion_especial: !!it.atencionEspecial,
        destino:        it.destino || null,
      }
      if (it.esCombo && (it.componentes || []).length) {
        const comboSinMods = (it.modificadores || []).filter(m => m.grupo_nombre === 'SIN')
        return it.componentes.map(c => {
          const merged = [...(c.modificadores || []), ...comboSinMods]
          const extraComp = merged.reduce((s, m) => s + (parseFloat(m.precio_extra) || 0), 0)
          return {
            ...base,
            nombre_item:          c.nombre,
            cantidad:             (c.cantidad || 1) * it.qty,
            nota:                 [`Combo: ${it.nombre}`, it.nota].filter(Boolean).join(' · ') || null,
            modificadores:        merged.length ? merged : null,
            precio_modificadores: extraComp,
            estacion:             c.estacion || 'general',
            linea:                linea++,
          }
        })
      }
      return [{
        ...base,
        nombre_item:          it.nombre,
        cantidad:             it.qty,
        nota:                 it.nota || null,
        modificadores:        it.modificadores?.length ? it.modificadores : null,
        precio_modificadores: it.precioExtra || 0,
        estacion:             it.estacion || 'general',
        linea:                linea++,
      }]
    })
  }

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

  // Eliminar item: los NUEVOS (sin comandar) salen directo; los COMANDADOS exigen PIN de cajera/gerente.
  const handleDeleteItem = (idx) => {
    const item = items[idx]
    if (!item) return
    if (item.saved) {
      setPinAuth({
        titulo: 'Anular item comandado',
        subtitulo: `"${item.nombre}" · requiere cajera o gerente`,
        onOk: (auth) => { setPinAuth(null); doDeleteItem(idx, auth) },
      })
    } else {
      doDeleteItem(idx, null)
    }
  }

  const doDeleteItem = async (idx, auth) => {
    const item = items[idx]
    if (!item) return
    if (item.saved) {
      if (!item.dbId) { toast.error('Recarga la orden para anular este item'); return }
      try {
        await db.from('pos_cuenta_items')
          .update({ cancelado_motivo: `Anulado en POS (${auth?.nombre || 'sup'})`, cancelado_por: auth?.id || null })
          .eq('id', item.dbId)
        await db.from('pos_cocina_queue').delete().eq('cuenta_item_id', item.dbId)
        const next = items.filter((_, i) => i !== idx)
        setItems(next)
        if (cuentaId) {
          const s = next.reduce((a, i) => a + (i.precio + (i.precioExtra || 0)) * i.qty, 0)
          await db.from('pos_cuentas').update({ subtotal: s, total: s, updated_at: new Date().toISOString() }).eq('id', cuentaId)
        }
        toast.success('Item anulado')
      } catch (e) {
        toast.error('No se pudo anular: ' + e.message)
      }
    } else {
      setItems(items.filter((_, i) => i !== idx))
    }
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

  const clearNewItems = async () => {
    const newItems = items.filter(i => !i.saved)
    if (newItems.length === 0) return
    if (!(await confirmAsync('¿Quitar los ítems no comandados?', { title: 'Quitar ítems', confirmText: 'Quitar', danger: true }))) return
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

  // ── Rol mesero: para asignar mesero_id en la cuenta ──
  const esMesero = user?.rol === 'mesero' || user?.rol === 'mesera'

  // ── Normaliza el carrito al formato que espera printService ──
  const buildCuentaPrint = (lista = items) => ({
    storeCode,
    caja,
    storeName,
    mesa: mesaActual,
    tipoLabel: tipoInfo.label,
    orden: null,
    mesero: user?.nombre || user?.name || null,
    cajero: user?.nombre || user?.name || null,
    comandaNumero: comandaSeq,
    items: lista.map(i => {
      const modStr = (mods) => (mods || []).map(m => Number(m.precio_extra) > 0
        ? `${m.nombre} (+$${Number(m.precio_extra).toFixed(2)})`
        : m.nombre)
      const modificadores = [...modStr(i.modificadores)]
      // Combo: lista cada componente y debajo sus modificadores
      ;(i.componentes || []).forEach(c => {
        modificadores.push(`${c.cantidad > 1 ? c.cantidad + 'x ' : ''}${c.nombre}:`)
        modStr(c.modificadores).forEach(s => modificadores.push('   ' + s))
      })
      // El precio de la línea incluye los extras: con solo i.precio, las líneas del ticket
      // no sumaban el subtotal impreso y el cliente que sumaba a mano no le cuadraba.
      return { nombre: i.nombre, precio: i.precio + (i.precioExtra || 0), qty: i.qty,
               nota: i.nota || null, modificadores, destino: i.destino || null }
    }),
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
      const r = await printPreCuenta(buildCuentaPrint())
      if (r && r.ok === false) toast.error('⚠️ No se imprimió la pre-cuenta — revisá la impresora / puente')
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
    // Candado síncrono: si ya hay una comanda en vuelo, ignorá los toques extra.
    if (commandingRef.current) return
    commandingRef.current = true

    // Token de idempotencia: nuevo por cada tap; en un reintento manual se reutiliza
    // el mismo (no se limpió por el error previo) → la DB rebota el duplicado en el KDS.
    // Fallback UUID v4 por si el WebView de la tablet no expone crypto.randomUUID.
    const firstAttempt = !comandaUidRef.current
    if (firstAttempt) {
      comandaUidRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
          })
    }
    const comandaUid = comandaUidRef.current

    // 0. Requiere caja/turno abierto (1 caja por sucursal) ANTES de comandar.
    //    Sin caja abierta las cuentas quedan sin poder cobrarse (no se puede cobrar
    //    sin turno) y se acumulan abiertas. Fail-open ante error de consulta: un fallo
    //    de red no debe frenar la operación, igual que en el cobro.
    let turnoId = null
    try {
      let _q = db.from('pos_turnos').select('id')
        .eq('store_code', storeCode).eq('nivel', 'cajero').eq('estado', 'abierto')
      _q = caja ? _q.eq('caja', caja) : _q.is('caja', null)
      let { data: _t, error: _te } = await _q.order('abierto_at', { ascending: false }).limit(1).maybeSingle()
      // Auto-heal (transición multi-caja): si tengo caja pero no hay turno de esa caja,
      // adoptá MI propio turno huérfano abierto sin caja (lo abrí antes de tener caja asignada).
      if (!_te && !_t && caja) {
        const { data: _orf } = await db.from('pos_turnos').select('id')
          .eq('store_code', storeCode).eq('nivel', 'cajero').eq('estado', 'abierto')
          .eq('cajero_id', user.id).is('caja', null)
          .order('abierto_at', { ascending: false }).limit(1).maybeSingle()
        if (_orf) { await db.from('pos_turnos').update({ caja }).eq('id', _orf.id); _t = _orf }
      }
      if (!_te) {
        if (!_t) { commandingRef.current = false; toast.warning('No hay caja abierta. Abrí la caja/turno en Cierre de caja antes de comandar.'); return }
        turnoId = _t.id
      }
    } catch (_e) { /* fail-open: no bloquear la comanda por error de consulta */ }

    setCommanding(true)
    try {
      let currentCuentaId = cuentaId

      // Reintento: si el insert previo SÍ creó la cuenta pero se perdió la respuesta,
      // recuperala por el token en vez de crear una cuenta fantasma.
      if (!currentCuentaId && !firstAttempt) {
        const { data: prevC } = await db.from('pos_cuentas').select('id')
          .eq('comanda_uid', comandaUid).limit(1).maybeSingle()
        if (prevC?.id) { currentCuentaId = prevC.id; setCuentaId(currentCuentaId) }
      }

      if (!currentCuentaId) {
        const { data: cuenta, error } = await db
          .from('pos_cuentas')
          .insert({
            store_code: storeCode,
            cajero_id:  user.id,
            turno_id:   turnoId,
            mesero_id:  esMesero ? user.id : null,
            tipo:       tipo,
            mesa_ref:   mesaActual,
            menu_id:    menuActivo?.id || null,
            estado:     'enviada_cocina',
            subtotal:   subtotal,
            iva:        0,
            total:      total,
            comanda_uid: comandaUid,
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

      const toInsert = newItems.map((it, idx) => ({
        cuenta_id:       currentCuentaId,
        menu_item_id:    it.id,
        nombre:          it.nombre,
        precio_unitario: it.precio,
        cantidad:        it.qty,
        notas:           it.nota || null,
        modificadores:   it.modificadores?.length ? it.modificadores : null,
        precio_modificadores: it.precioExtra || 0,
        atencion_especial: !!it.atencionEspecial,
        destino:         it.destino || null,
        componentes:     it.componentes?.length ? it.componentes : null,
        comanda_numero:  comandaSeq,
        enviado_cocina_at: new Date().toISOString(),
        comanda_uid:     comandaUid,
        linea:           idx,
      }))
      // upsert ignoreDuplicates: un reenvío con el mismo (comanda_uid, linea) NO duplica.
      const { data: insertedItems, error: itemsErr } = await db.from('pos_cuenta_items')
        .upsert(toInsert, { onConflict: 'comanda_uid,linea', ignoreDuplicates: true })
        .select('id')
      if (itemsErr) throw new Error('No se guardaron los ítems: ' + itemsErr.message)

      const prioridadComanda = tipo === 'pedidos_ya' ? 8 : tipo === 'drive_through' ? 7 : 5
      await db.from('pos_cocina_queue').upsert(
        buildQueueRows(newItems, insertedItems, currentCuentaId, prioridadComanda, comandaUid),
        { onConflict: 'comanda_uid,linea', ignoreDuplicates: true }
      )

      // Blindaje (incidente Metro Centro 3-Ago-2026): NUNCA imprimir una comanda
      // si la orden no quedó realmente guardada en BD. Si llegamos aquí sin
      // currentCuentaId, algo falló silenciosamente antes → no imprimimos un
      // ticket que la cocina prepararía y que no existiría como venta.
      if (!currentCuentaId) throw new Error('La orden no se guardó — no se imprime la comanda')

      // Imprime la comanda térmica con SOLO los ítems recién enviados a cocina.
      // Venecia (S004) y otras en STORES_SIN_COMANDA no imprimen comanda al comandar;
      // la orden igual queda en el KDS (pos_cocina_queue).
      if (!STORES_SIN_COMANDA.includes(storeCode)) {
        try {
          const r = await printComanda(buildCuentaPrint(newItems), { cuentaId: currentCuentaId })
          if (r && r.ok === false) toast.error('⚠️ Comanda guardada, pero NO se imprimió — revisá la impresora / puente')
        } catch (pErr) {
          console.error('Comanda enviada pero no se imprimió:', pErr)
          toast.error('Comanda guardada, pero no se imprimió')
        }
      }

      setComandaSeq(s => s + 1)
      setItems(prev => {
        let _k = 0
        return prev.map(i => i.saved ? i : { ...i, saved: true, dbId: insertedItems?.[_k++]?.id ?? i.dbId ?? null })
      })
      setCommandedCount(items.length)
      comandaUidRef.current = null   // éxito → el próximo tap arranca un token nuevo

    } catch (err) {
      console.error('Error al comandar:', err)
      toast.error('Error al comandar: ' + err.message)
    } finally {
      commandingRef.current = false
      setCommanding(false)
    }
  }

  // ── COBRAR (con integración DTEaaS) ──
  const saveCuenta = async (paymentData) => {
    // Guardarraíl pedido web: editar SÍ se vale (correcciones por WhatsApp), pero si el
    // total a cobrar no es el del pedido original, la cajera confirma viendo CLIENTE y
    // REFERENCIA — así se atrapa el cobro hecho en la cuenta equivocada (29-ago: se
    // cobraron $13.98 de un retiro dentro del delivery de otro cliente de $23.97).
    if (pedidoWeb && Math.abs(total - pedidoWeb.total) > 0.009) {
      const ok = await confirmAsync(
        `Esta cuenta es el pedido web #${pedidoWeb.referencia || '?'} de ${pedidoWeb.cliente || 'cliente sin nombre'} ` +
        `por $${pedidoWeb.total.toFixed(2)}, y vas a cobrar $${total.toFixed(2)}.\n\n` +
        `Si el cliente corrigió el pedido, continuá. Si no, verificá que NO estés en la orden de otro cliente.`,
        { title: '⚠️ El total no coincide con el pedido web', confirmText: `Cobrar $${total.toFixed(2)}`, danger: true }
      )
      if (!ok) return
    }
    setSaving(true)
    let dteResult = null
    let dteError  = null

    try {
      // 0. Requiere turno abierto (1 caja por sucursal). Fail-open ante error de consulta.
      let turnoId = null
      try {
        let _q = db.from('pos_turnos').select('id')
          .eq('store_code', storeCode).eq('nivel', 'cajero').eq('estado', 'abierto')
        _q = caja ? _q.eq('caja', caja) : _q.is('caja', null)
        let { data: _t, error: _te } = await _q.order('abierto_at', { ascending: false }).limit(1).maybeSingle()
        // Auto-heal (transición multi-caja): adoptá MI turno huérfano abierto sin caja.
        if (!_te && !_t && caja) {
          const { data: _orf } = await db.from('pos_turnos').select('id')
            .eq('store_code', storeCode).eq('nivel', 'cajero').eq('estado', 'abierto')
            .eq('cajero_id', user.id).is('caja', null)
            .order('abierto_at', { ascending: false }).limit(1).maybeSingle()
          if (_orf) { await db.from('pos_turnos').update({ caja }).eq('id', _orf.id); _t = _orf }
        }
        if (!_te) {
          if (!_t) { toast.warning('No hay turno abierto. Abri el turno en Cierre de caja antes de cobrar.'); setSaving(false); return }
          turnoId = _t.id
        }
      } catch (_e) { /* fail-open: no bloquear la venta por error de consulta */ }

      let currentCuentaId = cuentaId
      const itemsToSave   = currentCuentaId ? newItems : items

      // 1. Guardar cuenta en BD
      if (!currentCuentaId) {
        const { data: cuenta, error: cuentaErr } = await db
          .from('pos_cuentas')
          .insert({
            store_code:  storeCode,
            cajero_id:   user.id,
            turno_id:    turnoId,
            mesero_id:   esMesero ? user.id : null,
            tipo:        paymentData.metodo === 'pedidos_ya' ? 'pedidos_ya' : tipo,
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
            descuento_categoria: descuentoCategoria || null,
            descuento_empleado_id: descuentoCategoria === 'empleado' ? (descuentoEmpleadoId || null) : null,
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
            ...(paymentData.metodo === 'pedidos_ya' ? { tipo: 'pedidos_ya' } : {}),
            subtotal,
            iva:        0,
            propina:    paymentData.propina || 0,
            total:      total + (paymentData.propina || 0),
            descuento:    descuentoMonto,
            descuento_tipo: descuentoTipo,
            descuento_motivo: descuentoMotivo || null,
            descuento_categoria: descuentoCategoria || null,
            descuento_empleado_id: descuentoCategoria === 'empleado' ? (descuentoEmpleadoId || null) : null,
            descuento_autorizado_por: descuentoTipo ? user.id : null,
            dte_tipo:   DTE_TIPO_MAP[paymentData.tipoDte] || null,
            cliente_id: paymentData.cliente?.id || null,
            cobrada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            turno_id:   turnoId,
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
          componentes:     it.componentes?.length ? it.componentes : null,
          comanda_numero:  comandaSeq,
          enviado_cocina_at: new Date().toISOString(),
        }))
        const { data: insertedItems, error: itemsErr } = await db.from('pos_cuenta_items').insert(toInsert).select('id')
        if (itemsErr) throw new Error('No se guardaron los ítems: ' + itemsErr.message)

        await db.from('pos_cocina_queue').insert(
          buildQueueRows(itemsToSave, insertedItems, currentCuentaId, 5)
        )
      }

      // 3. Registrar pago — con reintentos: una cuenta cobrada NUNCA debe quedar sin pago.
      //    MIXTO se guarda como DOS pagos (efectivo + tarjeta) para que el corte y los
      //    reportes cuenten cada parte en su método. Antes iba todo como un pago 'mixto'
      //    y se perdía el desglose efectivo/tarjeta en el cuadre de caja.
      {
        const _montoTotal = total + (paymentData.propina || 0)
        let _pagoRows
        if (paymentData.metodo === 'mixto') {
          const _ef = Math.min(Math.round((Number(paymentData.efectivo) || 0) * 100) / 100, _montoTotal)
          const _tj = Math.round((_montoTotal - _ef) * 100) / 100
          _pagoRows = []
          if (_ef > 0) _pagoRows.push({ cuenta_id: currentCuentaId, metodo: 'efectivo', monto: _ef, monto_recibido: _ef, cambio: 0, referencia: null })
          if (_tj > 0) _pagoRows.push({ cuenta_id: currentCuentaId, metodo: 'tarjeta', monto: _tj, monto_recibido: null, cambio: 0, referencia: paymentData.referencia || null })
          if (_pagoRows.length === 0) _pagoRows.push({ cuenta_id: currentCuentaId, metodo: 'efectivo', monto: _montoTotal, monto_recibido: _montoTotal, cambio: 0, referencia: null })
        } else {
          _pagoRows = [{
            cuenta_id:      currentCuentaId,
            metodo:         paymentData.metodo,
            monto:          _montoTotal,
            monto_recibido: paymentData.efectivo || null,
            cambio:         paymentData.cambio   || 0,
            referencia:     paymentData.referencia || null,
          }]
        }
        let _pagoOk = false
        for (let _i = 1; _i <= 3 && !_pagoOk; _i++) {
          const { error: _pagoErr } = await db.from('pos_cuenta_pagos').insert(_pagoRows)
          if (!_pagoErr) { _pagoOk = true; break }
          console.error('pos_cuenta_pagos intento ' + _i + ' fallo:', _pagoErr.message)
          if (_i < 3) await new Promise(r => setTimeout(r, 400 * _i))
        }
        if (!_pagoOk) {
          try { await db.from('pos_cuentas').update({ notas_internas: 'PAGO_NO_REGISTRADO metodo=' + paymentData.metodo + ' monto=' + _montoTotal.toFixed(2) }).eq('id', currentCuentaId) } catch (_e) {}
          try { toast.error('⚠️ El pago no se registró en el sistema — avisá a soporte (la venta sí se cobró)') } catch (_e) {}
        }
      }

      // 3b. Pager (food court): guardar en la cuenta y reflejar en la cola de cocina (KDS)
      if (paymentData.pager != null) {
        await db.from('pos_cuentas').update({ pager: paymentData.pager }).eq('id', currentCuentaId)
        await db.from('pos_cocina_queue').update({ pager: paymentData.pager }).eq('cuenta_id', currentCuentaId)
      }

      // 4. Emitir DTE (factura o CCF) — si falla, la venta YA se cobró
      if (paymentData.tipoDte === 'factura' || paymentData.tipoDte === 'ccf' || paymentData.tipoDte === 'se') {
        try {
          dteResult = await emitDTE({
            tipoDte:  paymentData.tipoDte,
            // ítems + extras como líneas separadas, con el descuento de la cuenta prorrateado
            items:    buildDteLineItems(items, descuentoMonto),
            receptor: paymentData.cliente || null,
            metodo:   paymentData.metodo,
            storeCode: storeCode,
            propina:  paymentData.propina || 0, // no gravada (no IVA) -> linea noGravado en el DTE
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
  const handlePrintFactura = async ({ dteResult, tipoDte, propina = 0, metodo, cliente, pager, efectivo, cambio }) => {
    const DTE_LABEL = {
      factura: 'FACTURA (Consumidor Final)',
      ccf:     'COMPROBANTE DE CRÉDITO FISCAL',
      se:      'FACTURA SUJETO EXCLUIDO',
    }
    const clientePrint = cliente
      ? { nombre: cliente.nombre, doc: cliente.nit || cliente.numero_documento || cliente.nrc || null }
      : null
    const r = await printFactura({
      ...buildCuentaPrint(items),
      propina,
      pager:      pager ?? null,
      total:      total + (propina || 0),
      metodoPago: metodo,
      // Efectivo: para imprimir recibido y cambio a entregar
      recibido:   metodo === 'efectivo' && efectivo != null ? efectivo : null,
      cambio:     metodo === 'efectivo' && cambio != null ? cambio : null,
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
    if (r && r.ok === false) toast.error('⚠️ El ticket NO se imprimió — revisá la impresora / puente (la venta SÍ quedó registrada)')
    return r
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
        {onReport && <button className="pos-header-btn" onClick={onReport} title="Reportar un problema" aria-label="Reportar un problema">🛟</button>}
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
                {/* Sin categorías vacías: los ítems componente de los combos (categoría
                    "Componentes") no son vendibles sueltos, así que su pestaña queda sin ítems. */}
                {categorias.filter(cat => (cat.items || []).length > 0).map(cat => (
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

          {/* Destino de empaque (solo mesa / para llevar). Un toque = toda la orden. */}
          {destinoAplica && (
            <div style={{ display: 'flex', gap: 6, padding: '8px 10px 0', alignItems: 'center' }}>
              {[['aqui', '🍽️ Comer aquí', '#2dd4a8'], ['llevar', '🥡 Para llevar', '#f4a261']].map(([val, lbl, col]) => (
                <button key={val}
                  onClick={() => { setOrdenDestino(val); setItems(prev => prev.map(it => it.saved ? it : { ...it, destino: val })) }}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                    border: '1.5px solid ' + (ordenDestino === val ? col : '#2a2a32'),
                    background: ordenDestino === val ? col + '26' : '#22222c',
                    color: ordenDestino === val ? col : '#b8b8c4' }}>{lbl}</button>
              ))}
              {new Set(items.map(i => i.destino || destinoDefault)).size > 1 && (
                <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800, color: '#fbbf24', background: '#fbbf2422', padding: '4px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>ORDEN MIXTA</span>
              )}
            </div>
          )}

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
                <SwipeRow key={idx} onDelete={() => handleDeleteItem(idx)}>
                <div
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
                    {(item.modificadores || []).length > 0 && (() => {
                      const porGrupo = {}
                      item.modificadores.forEach(m => {
                        const k = m.grupo_nombre || 'Modificadores'
                        if (!porGrupo[k]) porGrupo[k] = []
                        porGrupo[k].push(m)
                      })
                      return (
                        <div style={{ fontSize: 11, color: '#8b8997', lineHeight: 1.5, marginTop: 2 }}>
                          {Object.entries(porGrupo).map(([grupo, opts]) => (
                            <div key={grupo} style={{ marginBottom: 2 }}>
                              <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{grupo}:</div>
                              {opts.map((m, i) => (
                                <div key={i} style={{ paddingLeft: 6 }}>
                                  + {m.nombre}
                                  {Number(m.precio_extra) > 0 && (
                                    <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 4 }}>+${Number(m.precio_extra).toFixed(2)}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                    {(item.componentes || []).length > 0 && (
                      <div style={{ fontSize: 11, color: '#8b8997', lineHeight: 1.5 }}>
                        {item.componentes.map((c, ci) => {
                          const porGrupo = {}
                          ;(c.modificadores || []).forEach(m => {
                            const k = m.grupo_nombre || 'Modificadores'
                            if (!porGrupo[k]) porGrupo[k] = []
                            porGrupo[k].push(m)
                          })
                          return (
                            <div key={ci} style={{ marginTop: 3 }}>
                              <span style={{ color: '#b8b4c0', fontWeight: 600 }}>{c.cantidad > 1 ? `${c.cantidad}× ` : ''}{c.nombre}</span>
                              {Object.entries(porGrupo).map(([grupo, opts]) => (
                                <div key={grupo} style={{ paddingLeft: 10, marginTop: 1 }}>
                                  <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{grupo}:</div>
                                  {opts.map((m, mi) => (
                                    <div key={mi} style={{ paddingLeft: 6 }}>
                                      + {m.nombre}
                                      {Number(m.precio_extra) > 0 && (
                                        <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 4 }}>+${Number(m.precio_extra).toFixed(2)}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )
                        })}
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
                    {destinoAplica && (() => {
                      const d = item.destino || destinoDefault
                      const col = d === 'aqui' ? '#2dd4a8' : '#f4a261'
                      return (
                        <button
                          disabled={item.saved}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => setItems(prev => prev.map((x, i) => i === idx ? { ...x, destino: (x.destino || destinoDefault) === 'aqui' ? 'llevar' : 'aqui' } : x))}
                          title={item.saved ? 'Destino (comandado)' : 'Tocar para cambiar destino de este ítem'}
                          style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, cursor: item.saved ? 'default' : 'pointer', border: '1px solid ' + col, background: 'transparent', color: col, letterSpacing: '0.3px' }}
                        >{d === 'aqui' ? '🍽️ AQUÍ' : '🥡 LLEVAR'}</button>
                      )
                    })()}
                    {!item.saved && (
                      <button
                        className="pos-order-item-del"
                        style={{ color: '#8b8997', fontSize: 13 }}
                        title={(!item.esCombo && (item.modGrupos || []).length) ? 'Editar producto' : 'Editar nota'}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          // Con modificadores: reabre la config completa para editar sin borrar el ítem.
                          if (!item.esCombo && (item.modGrupos || []).length) {
                            setModPicker({ id: item.id, nombre: item.nombre, precio: item.precio, modGrupos: item.modGrupos })
                            setEditIdx(idx)
                          } else { setShowNoteModal(idx); setNoteText(item.nota || '') }
                        }}
                      ><Icon name="pencil" size={14} /></button>
                    )}
                    {item.saved && (
                      <span className="pos-order-item-swipehint" title="Desliza a la izquierda para anular (requiere PIN)"><Icon name="lock" size={12} color="#6b6878" /></span>
                    )}
                  </div>
                </div>
                </SwipeRow>
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

      {/* El modal de modificadores se renderiza UNA sola vez, más abajo
          (<ProductoModifiersModal>). Acá vivía un <ModPickerModal> viejo
          disparado por el MISMO estado `modPicker`: se montaban los dos a la
          vez y el viejo tapaba al nuevo, así que el POS perdió el botón SIN,
          la edición de líneas, la cantidad y la nota. */}

      {/* El ComboModal se renderiza UNA sola vez, más abajo. Acá había un
          segundo render del mismo modal con el mismo `comboPicker`: montaba dos
          instancias a la vez, cada una con su propio estado de selección. */}

      {/* Modal: Pago + DTE */}
      {pinAuth && (
        <PinAuthModal
          titulo={pinAuth.titulo}
          subtitulo={pinAuth.subtitulo}
          onSuccess={pinAuth.onOk}
          onCancel={() => setPinAuth(null)}
        />
      )}
      {showPayModal && (
        <PaymentModal
          items={items}
          total={total}
          storeCode={storeCode}
          tipo={tipo}
          onConfirm={handlePaymentConfirm}
          onComplete={handlePaymentComplete}
          onPrintFactura={handlePrintFactura}
          onClose={() => setShowPayModal(false)}
          saving={saving}
        />
      )}

      {/* Modal: Descuento */}
      {showDiscountModal && (
        <div className="pos-modal-overlay" onClick={() => {
          // Cerrar sin completar (categoría, o nombre si es empleado) = descuento NO aplicado.
          if (descuentoTipo && (!descuentoCategoria || (descuentoCategoria === 'empleado' && !descuentoEmpleadoId))) {
            setDescuento(0); setDescuentoTipo(null); setDescuentoMotivo(''); setDescuentoCategoria(''); setDescuentoEmpleadoId('')
          }
          setShowDiscountModal(false)
        }}>
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

            {/* Categoría: distingue el descuento de EMPLEADO (sale en su apartado del corte) */}
            {descuentoTipo && (
              <div style={{ marginBottom: 12 }}>
                <label className="pos-payment-label">¿Para quién es? (obligatorio)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { key: 'empleado', label: '👷 Empleado' },
                    { key: 'cliente', label: '🤝 Cliente' },
                    { key: 'promo', label: '🎟 Promo/Cupón' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      style={{
                        flex: 1, padding: '8px 4px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        background: descuentoCategoria === opt.key ? '#f4a26122' : '#1a1a1a',
                        border: `1px solid ${descuentoCategoria === opt.key ? '#f4a261' : '#2a2a32'}`,
                        color: descuentoCategoria === opt.key ? '#f4a261' : '#888',
                      }}
                      onClick={() => setDescuentoCategoria(descuentoCategoria === opt.key ? '' : opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Motivo */}
            {descuentoTipo && (
              <div style={{ marginBottom: 12 }}>
                <label className="pos-payment-label">{descuentoCategoria === 'empleado' ? 'Empleado (de la lista)' : 'Motivo (opcional)'}</label>
                {descuentoCategoria === 'empleado' ? (
                  <select
                    className="pos-payment-input"
                    value={descuentoEmpleadoId}
                    onChange={e => {
                      const id = e.target.value
                      setDescuentoEmpleadoId(id)
                      const emp = (empleadosLista || []).find(x => x.id === id)
                      setDescuentoMotivo(emp?.nombre_completo || '')
                    }}
                    style={{ fontSize: 13, padding: '8px 12px', width: '100%' }}
                  >
                    <option value="">{empleadosLista === null ? 'Cargando empleados…' : '— Elegí al empleado —'}</option>
                    <optgroup label="Esta sucursal">
                      {(empleadosLista || []).filter(x => x.sucursal_id === sucursalIdLocal).map(x => (
                        <option key={x.id} value={x.id}>{x.nombre_completo}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Otras sucursales">
                      {(empleadosLista || []).filter(x => x.sucursal_id !== sucursalIdLocal).map(x => (
                        <option key={x.id} value={x.id}>{x.nombre_completo}</option>
                      ))}
                    </optgroup>
                  </select>
                ) : (
                  <input
                    className="pos-payment-input"
                    placeholder="Ej: Cliente frecuente, error en pedido..."
                    value={descuentoMotivo}
                    onChange={e => setDescuentoMotivo(e.target.value)}
                    style={{ fontSize: 13, padding: '8px 12px' }}
                  />
                )}
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

            {/* Obligatorio (Jose 14-ago): sin categoría no hay descuento; empleado exige nombre */}
            {descuentoTipo && !descuentoCategoria && (
              <div style={{ fontSize: 12, color: '#f4a261', marginBottom: 8, textAlign: 'center' }}>⚠️ Elegí para quién es el descuento</div>
            )}
            {descuentoTipo && descuentoCategoria === 'empleado' && !descuentoEmpleadoId && (
              <div style={{ fontSize: 12, color: '#f4a261', marginBottom: 8, textAlign: 'center' }}>⚠️ Elegí al empleado de la lista</div>
            )}
            <button
              className="pos-confirmar-btn"
              disabled={!descuentoTipo || !descuentoCategoria || (descuentoCategoria === 'empleado' && !descuentoEmpleadoId)}
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
                  setDescuentoCategoria('')
                  setDescuentoEmpleadoId('')
                  setShowDiscountModal(false)
                }}
              >
                🗑 Quitar descuento
              </button>
            )}
            <button className="pos-cancelar-btn" onClick={() => {
              if (descuentoTipo && (!descuentoCategoria || (descuentoCategoria === 'empleado' && !descuentoEmpleadoId))) {
                setDescuento(0); setDescuentoTipo(null); setDescuentoMotivo(''); setDescuentoCategoria(''); setDescuentoEmpleadoId('')
              }
              setShowDiscountModal(false)
            }}>Cancelar</button>
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

      {/* Modal: Modificadores de producto individual (grid en una pantalla + cantidad + nota). Reutilizado para editar. */}
      {modPicker && (
        <ProductoModifiersModal
          producto={modPicker}
          grupos={modPicker.modGrupos || []}
          removibles={removibles}
          editMode={editIdx != null}
          initial={editIdx != null ? {
            qty: items[editIdx]?.qty || 1,
            nota: items[editIdx]?.nota || '',
            atencionEspecial: !!items[editIdx]?.atencionEspecial,
            // los "SIN" no son un grupo real: se excluyen de selecciones y se rearman aparte
            selecciones: (items[editIdx]?.modificadores || [])
              .filter(m => m.grupo_nombre !== 'SIN' && m.grupo_id)
              .reduce((acc, m) => {
                if (!acc[m.grupo_id]) acc[m.grupo_id] = []
                acc[m.grupo_id].push(m.opcion_id)
                return acc
              }, {}),
            sin: (items[editIdx]?.modificadores || [])
              .filter(m => m.grupo_nombre === 'SIN')
              .map(m => m.quitar || String(m.nombre || '').replace(/^SIN\s+/, '')),
          } : null}
          onClose={() => { setModPicker(null); setEditIdx(null) }}
          onConfirm={({ qty, nota, modificadores, precioModificadores, atencionEspecial }) => {
            if (editIdx != null) {
              setItems(prev => prev.map((it, i) => i === editIdx
                ? { ...it, qty, nota, modificadores, precioExtra: precioModificadores, atencionEspecial }
                : it))
            } else {
              addItemToCart(modPicker, modificadores, precioModificadores, qty, nota, atencionEspecial)
            }
            setModPicker(null); setEditIdx(null)
          }}
        />
      )}

      {/* Modal: Combo con componentes (arma el combo eligiendo mods por cada componente) */}
      {comboPicker && (
        <ComboModal
          combo={comboPicker}
          removiblesCombo={removiblesCombo}
          onCancel={() => setComboPicker(null)}
          onConfirm={(componentesOut, generalMods, extra, qty) => {
            addComboToCart(comboPicker, componentesOut, generalMods, extra, qty)
            setComboPicker(null)
          }}
        />
      )}

      <toast.Toast />
    </div>
  )
}

// ──────────────────────────────────────────────
// ComboModal — arma un combo: modificadores por cada componente
// ──────────────────────────────────────────────
// Botón −/+ de cantidad. Alto generoso porque se toca en pantalla táctil, con
// prisa y a veces con guantes.
const qtyBtn = (off) => ({
  width: 42, height: 42, borderRadius: 10,
  border: '1.5px solid ' + (off ? '#2a2a32' : '#3b82f6'),
  background: off ? '#1a1a22' : 'rgba(59,130,246,0.16)',
  color: off ? '#5a5a66' : '#e5e7eb',
  fontSize: 22, fontWeight: 900, lineHeight: 1,
  cursor: off ? 'not-allowed' : 'pointer',
})

function ComboModal({ combo, removiblesCombo = {}, onConfirm, onCancel }) {
  const [sel, setSel] = useState({})   // "secKey:grupoId" -> [modId,...]
  const [sin, setSin] = useState([])   // nombres de ingredientes a quitar del combo
  // Varios combos iguales de un solo golpe: si el cliente pide 3 Freakie Burger
  // con la misma personalización, la cajera arma uno y pone 3, en vez de repetir
  // toda la selección tres veces. Si uno tiene que ir distinto, se agrega aparte.
  const [qty, setQty] = useState(1)

  // Secciones con grupos por elegir: nivel combo (general) + cada componente
  const secciones = []
  if ((combo.modGrupos || []).length) secciones.push({ key: 'combo', titulo: 'General', grupos: combo.modGrupos })
  // Un combo puede llevar el mismo componente varias veces (2 hamburguesas del Burger Duo) y cada
  // una se personaliza por separado. Se numeran para que el cajero sepa cuál está armando.
  const repes = {}
  ;(combo.componentes || []).forEach(c => { repes[c.nombre] = (repes[c.nombre] || 0) + 1 })
  const vistos = {}
  ;(combo.componentes || []).forEach((c, i) => {
    if (!(c.modGrupos || []).length) return
    vistos[c.nombre] = (vistos[c.nombre] || 0) + 1
    const titulo = repes[c.nombre] > 1 ? `${c.nombre} ${vistos[c.nombre]}` : c.nombre
    secciones.push({ key: 'c' + i, titulo, grupos: c.modGrupos })
  })

  const toggle = (secKey, g, m) => {
    const k = secKey + ':' + g.id
    setSel(prev => {
      const cur = prev[k] || []
      if (g.tipo === 'unico') return { ...prev, [k]: [m.id] }
      if (cur.includes(m.id)) return { ...prev, [k]: cur.filter(x => x !== m.id) }
      if (g.max_selecciones > 0 && cur.length >= g.max_selecciones) return prev
      return { ...prev, [k]: [...cur, m.id] }
    })
  }

  // ── Bebida agrandada (incidente inventario 30-ago) ── El grupo "Bebida Agrandado"
  // contiene el sabor de $1.75 que REEMPLAZA a la bebida base cuando el cliente
  // agranda: oculto si no hay "Agrandado" marcado, y OBLIGATORIO si lo hay — así el
  // sabor real queda capturado y su insumo se descuenta del kardex (el modificador
  // Agrandado solo descuenta la papa extra; la bebida viaja en el sabor marcado).
  // Detección por nombre para no cablear ids de BD en el cliente.
  const esGrupoAgrandado = (g) => /agrandado/i.test(g?.nombre || '')
  // El agrandado se busca en TODO el combo, no solo en su sección: hay dos vías
  // vivas y ambas valen igual (decisión Jose 30-ago) — "Agrandado Papa y Bebida"
  // (sección Bebida) y "Agrandado Combo" (sección Fries, 773 usos/30d). Marcar
  // cualquiera pide el sabor, así nadie tiene que cambiar cómo lo hace hoy.
  const hayAgrandado = secciones.some(sec => (sec.grupos || []).some(g =>
    !esGrupoAgrandado(g) && (sel[sec.key + ':' + g.id] || []).some(mid =>
      /agrandado/i.test(g.opciones.find(o => o.id === mid)?.nombre || ''))))

  const modsDe = (secKey, grupos) => {
    const out = []
    ;(grupos || []).forEach(g => {
      if (esGrupoAgrandado(g) && !hayAgrandado) return   // selección huérfana (des-agrandó): se ignora
      ;(sel[secKey + ':' + g.id] || []).forEach(mid => {
        const m = g.opciones.find(o => o.id === mid)
        if (m) out.push({ id: m.id, nombre: m.nombre, nombre_corto: m.nombre_corto || '', precio_extra: Number(m.precio_extra) || 0 })
      })
    })
    return out
  }

  const componentesOut = (combo.componentes || []).map((c, i) => ({
    item_id: c.item_id, nombre: c.nombre, estacion: c.estacion, cantidad: c.cantidad,
    modificadores: modsDe('c' + i, c.modGrupos),
  }))

  // Los "SIN" viajan con los modificadores del combo, con grupo_nombre 'SIN' y
  // precio 0: es el formato que pos_deducir_preview ya lee para NO descontar el
  // insumo que el cliente pidió quitar. Van a nivel de combo porque el backend
  // aplica el SIN por línea, no por componente.
  const generalMods = [
    ...modsDe('combo', combo.modGrupos),
    ...sin.map(nombre => ({
      grupo_id: null, grupo_nombre: 'SIN', opcion_id: null,
      nombre: 'SIN ' + nombre, quitar: nombre, precio_extra: 0,
    })),
  ]

  let extra = 0
  componentesOut.forEach((c) => c.modificadores.forEach(m => { extra += (m.precio_extra || 0) * (c.cantidad || 1) }))
  generalMods.forEach(m => { extra += m.precio_extra || 0 })

  const falta = secciones.find(sec => sec.grupos.some(g => {
    const n = (sel[sec.key + ':' + g.id] || []).length
    // El grupo del agrandado solo es obligatorio cuando hay Agrandado marcado
    if (esGrupoAgrandado(g)) return hayAgrandado && n < 1
    if (g.obligatorio && n < 1) return true
    if (g.min_selecciones > 0 && n < g.min_selecciones) return true
    return false
  }))

  const reqLabel = (g) => {
    if (esGrupoAgrandado(g)) return 'Elige el sabor del agrandado'
    if (g.obligatorio || g.min_selecciones > 0) {
      const min = Math.max(g.min_selecciones || 0, g.obligatorio ? 1 : 0)
      return `Elige ${min}${g.max_selecciones > 0 && g.max_selecciones !== min ? `–${g.max_selecciones}` : ''}`
    }
    if (g.tipo === 'unico') return 'Elige 1 (opcional)'
    return g.max_selecciones > 0 ? `Hasta ${g.max_selecciones} (opcional)` : 'Opcional'
  }

  return (
    <div className="pos-modal-overlay" onClick={onCancel}>
      <div className="pos-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="pos-modal-title">{combo.nombre}</div>
        <div className="pos-modal-sub" style={{ marginBottom: 8 }}>Arma el combo</div>

        {/* Lista de componentes del combo (informativa) + sus grupos */}
        {(combo.componentes || []).map((c, i) => {
          const grupos = c.modGrupos || []
          return (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: grupos.length ? 6 : 0 }}>
                {c.cantidad > 1 ? `${c.cantidad}× ` : ''}{c.nombre}
                {grupos.length === 0 && <span style={{ color: '#6b6878', fontWeight: 400, fontSize: 12 }}> · incluido</span>}
              </div>
              {grupos.map(g => {
                // "Bebida Agrandado" solo aparece cuando el Agrandado está marcado
                // (en esta sección o en otra: papas o bebida, ambas vías valen)
                if (esGrupoAgrandado(g) && !hayAgrandado) return null
                return (
                <div key={g.id} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {g.nombre}{(g.obligatorio || esGrupoAgrandado(g)) && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
                    </span>
                    <span style={{ fontSize: 10, color: '#8b8997' }}>{reqLabel(g)}</span>
                  </div>
                  {/* Mismo grid de botones que ProductoModifiersModal: al pasar los combos a
                      componentes se perdía esta vista y el cajero veía una lista distinta. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
                    {g.opciones.map(m => {
                      const on = (sel['c' + i + ':' + g.id] || []).includes(m.id)
                      const px = Number(m.precio_extra) || 0
                      const enTope = g.max_selecciones > 0 && (sel['c' + i + ':' + g.id] || []).length >= g.max_selecciones
                      const bloqueada = !on && enTope && g.tipo !== 'unico'
                      return (
                        <button key={m.id} onClick={() => toggle('c' + i, g, m)} disabled={bloqueada}
                          style={{
                            position: 'relative', minHeight: 54, padding: 8, borderRadius: 10,
                            border: '1.5px solid ' + (on ? '#3b82f6' : '#2a2a32'),
                            background: on ? 'rgba(59,130,246,0.16)' : '#22222c',
                            color: bloqueada ? '#5a5a66' : '#e5e7eb',
                            cursor: bloqueada ? 'not-allowed' : 'pointer',
                            fontSize: 12.5, fontWeight: 600, textAlign: 'center',
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            justifyContent: 'center', gap: 3, lineHeight: 1.2,
                            opacity: bloqueada ? 0.5 : 1, transition: 'border-color .1s, background .1s',
                          }}>
                          <span style={{ position: 'absolute', top: 4, right: 5, fontSize: 11, fontWeight: 800,
                                         color: on ? '#3b82f6' : '#6b6878' }}>{on ? '✓' : '+'}</span>
                          <span style={{ padding: '0 4px' }}>{m.nombre}</span>
                          {px > 0 && <span style={{ fontSize: 11, color: '#10b981', fontWeight: 800 }}>+${px.toFixed(2)}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
                )
              })}
            </div>
          )
        })}

        {/* Grupos a nivel combo (si el combo tiene grupos propios) */}
        {(combo.modGrupos || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>General</div>
            {combo.modGrupos.map(g => {
              if (esGrupoAgrandado(g) && !hayAgrandado) return null
              return (
              <div key={g.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {g.nombre}{(g.obligatorio || esGrupoAgrandado(g)) && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
                  </span>
                  <span style={{ fontSize: 10, color: '#8b8997' }}>{reqLabel(g)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
                  {g.opciones.map(m => {
                    const on = (sel['combo:' + g.id] || []).includes(m.id)
                    const px = Number(m.precio_extra) || 0
                    const enTope = g.max_selecciones > 0 && (sel['combo:' + g.id] || []).length >= g.max_selecciones
                    const bloqueada = !on && enTope && g.tipo !== 'unico'
                    return (
                      <button key={m.id} onClick={() => toggle('combo', g, m)} disabled={bloqueada}
                        style={{
                          position: 'relative', minHeight: 54, padding: 8, borderRadius: 10,
                          border: '1.5px solid ' + (on ? '#3b82f6' : '#2a2a32'),
                          background: on ? 'rgba(59,130,246,0.16)' : '#22222c',
                          color: bloqueada ? '#5a5a66' : '#e5e7eb',
                          cursor: bloqueada ? 'not-allowed' : 'pointer',
                          fontSize: 12.5, fontWeight: 600, textAlign: 'center',
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          justifyContent: 'center', gap: 3, lineHeight: 1.2,
                          opacity: bloqueada ? 0.5 : 1, transition: 'border-color .1s, background .1s',
                        }}>
                        <span style={{ position: 'absolute', top: 4, right: 5, fontSize: 11, fontWeight: 800,
                                       color: on ? '#3b82f6' : '#6b6878' }}>{on ? '✓' : '+'}</span>
                        <span style={{ padding: '0 4px' }}>{m.nombre}</span>
                        {px > 0 && <span style={{ fontSize: 11, color: '#10b981', fontWeight: 800 }}>+${px.toFixed(2)}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
              )
            })}
          </div>
        )}

        {/* SIN — qué se le puede quitar al combo. La lista sale del ítem padre,
            que es quien conoce sus bloques; se agrupa por bloque para que el
            cajero sepa de dónde sale cada cosa ("Cebolla" es de la hamburguesa). */}
        {removiblesCombo.length > 0 && (() => {
          const porBloque = {}
          removiblesCombo.forEach(r => {
            const b = r.bloque || 'General'
            if (!porBloque[b]) porBloque[b] = []
            porBloque[b].push(r)
          })
          return (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: '#ef4444',
                            textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>
                Sin… <span style={{ color: '#6b6878', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                  · tocá lo que el cliente NO quiere
                </span>
              </div>
              {Object.entries(porBloque).map(([bloque, lista]) => (
                <div key={bloque} style={{ marginBottom: 8 }}>
                  {Object.keys(porBloque).length > 1 && (
                    <div style={{ fontSize: 11, color: '#8b8997', marginBottom: 5 }}>{bloque}</div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
                    {lista.map(r => {
                      const quitado = sin.includes(r.nombre)
                      return (
                        <button key={bloque + r.nombre}
                          onClick={() => setSin(prev => prev.includes(r.nombre)
                            ? prev.filter(x => x !== r.nombre)
                            : [...prev, r.nombre])}
                          style={{
                            position: 'relative', minHeight: 54, padding: 8, borderRadius: 10,
                            border: '1.5px solid ' + (quitado ? '#ef4444' : '#2a2a32'),
                            background: quitado ? 'rgba(239,68,68,0.22)' : '#22222c',
                            color: '#e5e7eb', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                            textAlign: 'center', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', lineHeight: 1.2,
                            textDecoration: quitado ? 'line-through' : 'none',
                          }}>
                          {quitado && (
                            <span style={{ position: 'absolute', top: 4, right: 5, fontSize: 9, fontWeight: 800,
                                           color: '#fff', background: '#ef4444', padding: '1px 4px', borderRadius: 4 }}>SIN</span>
                          )}
                          <span style={{ padding: '0 4px' }}>{r.nombre}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Cantidad — todos llevan la misma selección de arriba */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      margin: '4px 0 12px', padding: '10px 12px', background: '#1a1a22',
                      borderRadius: 10, border: '1px solid #2a2a32' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Cantidad</div>
            <div style={{ fontSize: 11, color: '#8b8997' }}>
              {qty > 1 ? 'Todos con la misma selección' : 'Si uno va distinto, agrégalo aparte'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1}
              style={qtyBtn(qty <= 1)} aria-label="Quitar uno">−</button>
            <span style={{ minWidth: 30, textAlign: 'center', fontSize: 20, fontWeight: 900 }}>{qty}</span>
            <button onClick={() => setQty(q => Math.min(50, q + 1))} disabled={qty >= 50}
              style={qtyBtn(qty >= 50)} aria-label="Agregar uno">+</button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 14px', fontSize: 14 }}>
          <span style={{ color: '#8b8997' }}>Precio</span>
          <span style={{ fontWeight: 700 }}>
            ${((parseFloat(combo.precio) + extra) * qty).toFixed(2)}
            {(extra > 0 || qty > 1) && (
              <span style={{ color: '#8b8997', fontWeight: 400, fontSize: 12 }}>
                {' '}({qty > 1 ? `${qty} × ` : ''}${(parseFloat(combo.precio) + extra).toFixed(2)}
                {extra > 0 ? ` — base $${parseFloat(combo.precio).toFixed(2)} + $${extra.toFixed(2)}` : ''})
              </span>
            )}
          </span>
        </div>

        <button
          className="pos-confirmar-btn"
          disabled={!!falta}
          style={falta ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
          onClick={() => onConfirm(componentesOut, generalMods, extra, qty)}
        >
          {falta ? `Falta elegir en: ${falta.titulo}` : (qty > 1 ? `Agregar ${qty} combos` : 'Agregar combo')}
        </button>
        <button className="pos-cancelar-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}


