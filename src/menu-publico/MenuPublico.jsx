// ────────────────────────────────────────────────────────────────────
// Menú Público — Freakie Dogs (reemplazo de BuhoPay)
// Entry: /menu (menu.html). El menú se lee EN VIVO del POS
// (RPC menu_publico_delivery → canal delivery_propio, con modificadores),
// así los precios y opciones son los mismos que cobra la caja.
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef } from 'react'
import { db } from '../supabase'
import { URL_DELIVERY } from '../config'
import { NEGOCIO, BANNERS } from './catalogoBuho'

const fmt = (n) => `$${Number(n).toFixed(2)}`

// Emoji decorativo por categoría (el POS no guarda emoji)
const EMOJI_CAT = {
  combos: '🌭🍟🥤', 'freakie burger': '🍔', individuales: '🌭',
  'fries & sides': '🍟', bebidas: '🥤', cervezas: '🍺', extras: '⭐',
}
const emojiDe = (nombre) => EMOJI_CAT[(nombre || '').toLowerCase()] || ''

// Cómo desbloquear la ubicación según el teléfono. En iPhone, si Localización
// está en "Nunca" para el navegador, el sistema NO vuelve a preguntar: el modal
// de permiso no aparece nunca, así que hablar del "candado" no sirve.
function comoPermitirUbicacion() {
  const ua = navigator.userAgent || ''
  const esIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const esAndroid = /Android/.test(ua)
  if (esIOS) return {
    titulo: 'Activá la ubicación en tu iPhone',
    pasos: ['Abrí Ajustes', 'Privacidad y seguridad → Localización', 'Elegí tu navegador (Safari o Chrome)',
            'Marcá “Preguntar la próxima vez” o “Al usar la app”', 'Volvé acá y tocá Reintentar'],
  }
  if (esAndroid) return {
    titulo: 'Activá la ubicación en tu Android',
    pasos: ['Abrí Ajustes', 'Aplicaciones → tu navegador (Chrome)', 'Permisos → Ubicación',
            'Elegí “Permitir solo mientras se usa la app”', 'Volvé acá y tocá Reintentar'],
  }
  return {
    titulo: 'Activá la ubicación en tu navegador',
    pasos: ['Tocá el candado 🔒 junto a la dirección web', 'Buscá Ubicación', 'Elegí Permitir', 'Tocá Reintentar'],
  }
}

// ── Perfil del cliente recurrente ──────────────────────────────────
// Se guarda SOLO en este dispositivo (localStorage), no en el servidor:
// así el cliente que ya pidió no rellena todo otra vez, y NO abrimos un
// hueco de privacidad (una búsqueda por teléfono desde el menú público
// —rol anon— dejaría que cualquiera obtenga nombre+dirección ajenos).
// El perfil server-side para la CRM de Karina se lee por el canal
// autenticado de la torre de control (Fase 0-B).
const PERFIL_KEY = 'freakie_cliente_v1'
function leerPerfil() {
  try { return JSON.parse(localStorage.getItem(PERFIL_KEY)) || {} } catch { return {} }
}
function guardarPerfil(p) {
  try { localStorage.setItem(PERFIL_KEY, JSON.stringify(p)) } catch { /* modo incógnito / storage lleno */ }
}

// Número de día (0=domingo) en hora de El Salvador (UTC-6, sin DST). Sólo se
// usa en el fallback local; la fuente primaria es la BD (ver horarioHoy).
function diaHoySV() {
  return new Date(Date.now() - 6 * 3600 * 1000).getUTCDay()
}

// Horario de HOY. Fuente PRIMARIA: BD en vivo (RPC menu_publico_horario, el
// mismo dato que edita el Panel Delivery, agregado sobre las sucursales con
// delivery y calculado en hora de El Salvador). Si la BD no responde, cae al
// horario de respaldo quemado en NEGOCIO.horarios (catalogoBuho.js).
function horarioHoy(bd) {
  if (bd && bd.hoy) {
    const h = bd.hoy
    return { dia: bd.dia, horario: h.abierto ? `${h.apertura} - ${h.cierre}` : 'Cerrado' }
  }
  const dias = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado']
  const dia = diaHoySV()
  return { dia, horario: NEGOCIO.horarios[dias[dia]] || 'Cerrado' }
}

function abiertoAhora(bd) {
  // Con dato de BD, el servidor ya resolvió "abierto ahora" (hora SV real).
  if (bd) return !!bd.abierto_ahora
  // Fallback local sobre el horario de respaldo.
  const { horario } = horarioHoy(null)
  if (!horario || horario === 'Cerrado') return false
  const m = horario.match(/^(\d{2}):(\d{2}).*?(\d{2}):(\d{2})$/)
  if (!m) return false
  const d = new Date(Date.now() - 6 * 3600 * 1000)
  const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes()
  const from = +m[1] * 60 + +m[2]
  const to   = +m[3] * 60 + +m[4]
  return nowMin >= from && nowMin < to
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
export default function MenuPublico() {
  const [menu, setMenu] = useState([])          // [{id,nombre,orden,items:[{...,grupos}]}]
  const [reglas, setReglas] = useState(null)    // {minimo, gratis_desde} del servidor
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [categoriaActiva, setCategoriaActiva] = useState('')
  const [carrito, setCarrito] = useState([])
  const [productoModal, setProductoModal] = useState(null)
  const [carritoAbierto, setCarritoAbierto] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [pedidoOk, setPedidoOk] = useState(null)  // respuesta de crear_pedido_delivery + nombre
  const [toast, setToast] = useState(null)
  const [showTop, setShowTop] = useState(false)
  const [horarioBD, setHorarioBD] = useState(null)   // horario en vivo del Panel Delivery
  const [misPedidos, setMisPedidos] = useState(null) // {activos, pasados} del teléfono guardado
  const [misPedidosOpen, setMisPedidosOpen] = useState(false)
  const [sugerenciaOculta, setSugerenciaOculta] = useState(false)
  const seccionesRef = useRef({})
  const abierto = abiertoAhora(horarioBD)

  // Horario del storefront en vivo desde la BD (mismo dato que el Panel Delivery).
  // Si falla, horarioHoy/abiertoAhora caen al horario de respaldo quemado.
  useEffect(() => {
    db.rpc('menu_publico_horario')
      .then(({ data }) => data && setHorarioBD(data))
      .catch(() => {})
  }, [])

  // Reglas de pedido mínimo / envío gratis (para avisar desde el carrito)
  useEffect(() => {
    db.rpc('calcular_costo_envio', { p_distancia_km: 0, p_subtotal: 0 })
      .then(({ data }) => data && setReglas({ minimo: Number(data.minimo), gratisDesde: Number(data.gratis_desde) }))
      .catch(() => {})
  }, [])

  // Cargar el menú en vivo del POS (canal delivery_propio)
  useEffect(() => {
    let vivo = true
    db.rpc('menu_publico_delivery')
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) { setErrorCarga(true); return }
        const cats = (data || []).filter(c => (c.items || []).length > 0)
        setMenu(cats)
        if (cats[0]) setCategoriaActiva(cats[0].id)
      })
      .catch(() => vivo && setErrorCarga(true))
      .finally(() => vivo && setCargando(false))
    return () => { vivo = false }
  }, [])

  // Toast (auto-hide 2s)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  // Scroll → botón "arriba" + categoría activa
  useEffect(() => {
    const onScroll = () => {
      setShowTop(window.scrollY > 400)
      // Detectar categoría visible
      const viewport = window.scrollY + 200
      for (const cat of menu) {
        const el = seccionesRef.current[cat.id]
        if (el && el.offsetTop <= viewport) setCategoriaActiva(cat.id)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [menu])

  const totalCarrito = useMemo(
    () => carrito.reduce((s, it) => s + (it.precio + (it.precioMods || 0)) * it.qty, 0),
    [carrito]
  )
  const cantidadCarrito = carrito.reduce((s, it) => s + it.qty, 0)

  const agregarAlCarrito = (producto, qty = 1, nota = '', mods = []) => {
    const precioMods = mods.reduce((s, m) => s + (Number(m.precio_extra) || 0), 0)
    setCarrito(prev => {
      // Mismo producto sin nota ni mods → suma qty
      if (!nota && mods.length === 0) {
        const idx = prev.findIndex(i => i.id === producto.id && !i.nota && (!i.mods || i.mods.length === 0))
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], qty: next[idx].qty + qty }
          return next
        }
      }
      return [...prev, {
        lineaId: Date.now() + Math.random(),
        id: producto.id, nombre: producto.nombre, precio: Number(producto.precio),
        precioMods, qty, nota, mods,
      }]
    })
    setToast('Producto añadido')
  }

  const scrollACategoria = (catId) => {
    const el = seccionesRef.current[catId]
    if (el) window.scrollTo({ top: el.offsetTop - 60, behavior: 'smooth' })
  }

  // ── Mis pedidos: el cliente se identifica por el teléfono guardado en el
  // dispositivo (perfil). Trae pedido activo (→ tracking) + últimos entregados
  // (→ volver a pedir). Se recarga al completar un pedido nuevo.
  useEffect(() => {
    const tel = leerPerfil().telefono
    if (!tel) return
    db.rpc('mis_pedidos_delivery', { p_telefono: tel })
      .then(({ data }) => data && setMisPedidos(data))
      .catch(() => {})
  }, [pedidoOk])

  // Reconstruye el carrito desde un pedido viejo, contra el MENÚ ACTUAL:
  // precios vigentes, modificadores re-matcheados por id, y lo que ya no
  // existe se omite (avisando cuántos).
  const volverAPedir = (pedido) => {
    const porId = {}
    for (const cat of menu) for (const it of (cat.items || [])) porId[it.id] = it
    const nuevo = []; let fuera = 0
    for (const it of (pedido.items || [])) {
      const prod = porId[it.menu_item_id]
      if (!prod) { fuera += Number(it.cantidad) || 1; continue }
      const modsActuales = []
      for (const m of (it.modificadores || [])) {
        for (const g of (prod.grupos || [])) {
          const op = (g.opciones || []).find(o => o.id === m.id)
          if (op) { modsActuales.push(op); break }
        }
      }
      const precioMods = modsActuales.reduce((s, m) => s + (Number(m.precio_extra) || 0), 0)
      nuevo.push({
        lineaId: Date.now() + Math.random(),
        id: prod.id, nombre: prod.nombre, precio: Number(prod.precio),
        precioMods, qty: Number(it.cantidad) || 1, nota: it.nota || '', mods: modsActuales,
      })
    }
    if (!nuevo.length) { setToast('Ese pedido ya no está disponible en el menú'); return }
    setCarrito(nuevo)
    setMisPedidosOpen(false)
    setSugerenciaOculta(true)
    setCarritoAbierto(true)
    setToast(fuera ? `Cargado — ${fuera} producto(s) ya no disponibles` : '¡Pedido cargado! Revisalo y confirmá')
  }

  const resumenPedido = (p) => (p.items || []).map(i => `${i.cantidad}x ${i.nombre}`).join(', ')

  return (
    <div className="mp-page">
      <div className="mp-container">

        {/* HERO BANNER */}
        <HeroBanner />

        {/* LOGO + INFO NEGOCIO */}
        <HeaderNegocio horarioBD={horarioBD} />

        {/* MIS PEDIDOS: pedido activo → seguir en vivo; si no, sugerencia de repetir */}
        {misPedidos?.activos?.length > 0 && (
          <a href={`${URL_DELIVERY}/track?t=${misPedidos.activos[0].tracking_token}`}
             style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0', padding: '12px 14px', borderRadius: 12, background: '#0d2818', border: '1px solid #2d6a4f', color: '#d8f3dc', textDecoration: 'none', fontSize: 14 }}>
            <span style={{ fontSize: 22 }}>🛵</span>
            <span style={{ flex: 1 }}><b>Tenés un pedido en curso</b> ({misPedidos.activos[0].numero_orden})<br />
              <span style={{ fontSize: 12, opacity: .8 }}>Tocá para seguirlo en vivo</span></span>
            <span style={{ fontSize: 18 }}>→</span>
          </a>
        )}
        {!misPedidos?.activos?.length && misPedidos?.pasados?.length > 0 && !sugerenciaOculta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0', padding: '12px 14px', borderRadius: 12, background: '#221a0d', border: '1px solid #6a512d', color: '#f3ead8', fontSize: 14 }}>
            <span style={{ fontSize: 22 }}>🍔</span>
            <span style={{ flex: 1, minWidth: 0 }}><b>¿Repetimos?</b><br />
              <span style={{ fontSize: 12, opacity: .85, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumenPedido(misPedidos.pasados[0])} · {fmt(misPedidos.pasados[0].total)}</span></span>
            <button onClick={() => volverAPedir(misPedidos.pasados[0])}
              style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 12px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>Volver a pedir</button>
            <button onClick={() => setSugerenciaOculta(true)} aria-label="Cerrar"
              style={{ background: 'none', border: 'none', color: '#8a7d66', fontSize: 16, cursor: 'pointer', padding: 4 }}>✕</button>
          </div>
        )}
        {(misPedidos?.activos?.length > 0 || misPedidos?.pasados?.length > 0) && (
          <button onClick={() => setMisPedidosOpen(true)}
            style={{ display: 'block', margin: '0 0 6px', background: 'none', border: 'none', color: '#b8b2a7', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
            🧾 Mis pedidos
          </button>
        )}

        {/* TABS CATEGORIAS (sticky) */}
        {menu.length > 0 && (
          <div className="mp-tabs-wrap">
            <div className="mp-tabs">
              {menu.map(cat => (
                <button
                  key={cat.id}
                  className={`mp-tab ${categoriaActiva === cat.id ? 'active' : ''}`}
                  onClick={() => scrollACategoria(cat.id)}
                >
                  {cat.nombre} {emojiDe(cat.nombre)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ESTADOS DE CARGA */}
        {cargando && (
          <div className="mp-cargando">
            <div className="mp-spinner" /> Cargando el menú…
          </div>
        )}
        {errorCarga && !cargando && (
          <div className="mp-cargando">😕 No pudimos cargar el menú. Recargá la página o intentá en un momento.</div>
        )}

        {/* SECCIONES POR CATEGORIA */}
        {menu.map(cat => (
          <section
            key={cat.id}
            ref={el => { if (el) seccionesRef.current[cat.id] = el }}
            className="mp-seccion"
          >
            <h2 className="mp-seccion-titulo">{cat.nombre} {emojiDe(cat.nombre)}</h2>
            <div className="mp-productos">
              {(cat.items || []).map(prod => (
                <ProductoCard
                  key={prod.id}
                  producto={prod}
                  onClick={() => setProductoModal(prod)}
                />
              ))}
            </div>
          </section>
        ))}

        <div style={{ height: cantidadCarrito > 0 ? 80 : 40 }} />
      </div>

      {/* BOTÓN ARRIBA */}
      {showTop && (
        <button
          className="mp-btn-arriba"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Ir arriba"
        >
          ↑
        </button>
      )}

      {/* CARRITO FLOTANTE BOTTOM */}
      {cantidadCarrito > 0 && !carritoAbierto && !checkoutOpen && (
        <button className="mp-carrito-fab" onClick={() => setCarritoAbierto(true)}>
          <span className="mp-carrito-count">{cantidadCarrito}</span>
          <span className="mp-carrito-label">Ver mi pedido</span>
          <span className="mp-carrito-total">{fmt(totalCarrito)}</span>
        </button>
      )}

      {/* MODAL PRODUCTO */}
      {productoModal && (
        <ProductoModal
          producto={productoModal}
          onClose={() => setProductoModal(null)}
          onAgregar={(qty, nota, mods) => {
            agregarAlCarrito(productoModal, qty, nota, mods)
            setProductoModal(null)
          }}
          abierto={abierto}
        />
      )}

      {/* CARRITO DRAWER */}
      {carritoAbierto && (
        <CarritoDrawer
          items={carrito}
          total={totalCarrito}
          reglas={reglas}
          onClose={() => setCarritoAbierto(false)}
          onUpdate={setCarrito}
          onCheckout={() => { setCarritoAbierto(false); setCheckoutOpen(true) }}
        />
      )}

      {/* CHECKOUT DRAWER */}
      {checkoutOpen && (
        <Checkout
          items={carrito}
          total={totalCarrito}
          onClose={() => setCheckoutOpen(false)}
          onEnviado={(datos) => {
            setCarrito([])
            setCheckoutOpen(false)
            setPedidoOk(datos)
          }}
        />
      )}

      {/* CONFIRMACIÓN POST-PEDIDO */}
      {pedidoOk && (
        <PedidoEnviado datos={pedidoOk} onClose={() => setPedidoOk(null)} />
      )}

      {/* TOAST */}
      {misPedidosOpen && (
        <MisPedidosModal
          datos={misPedidos}
          onClose={() => setMisPedidosOpen(false)}
          onVolverAPedir={volverAPedir}
        />
      )}

      {toast && <div className="mp-toast">{toast}</div>}

      {/* BANNER CERRADO (si aplica) */}
      {!abierto && (
        <div className="mp-cerrado-banner">
          <div className="mp-cerrado-icon">🏪</div>
          <div>
            <div className="mp-cerrado-titulo">Estamos fuera de horario</div>
            <div className="mp-cerrado-sub">Podés dejar tu pedido igual — lo atendemos al abrir.</div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="mp-footer">
        <a href="/privacy.html" target="_blank" rel="noopener">Política de Privacidad</a>
        <span> · </span>
        <a href="/terms.html" target="_blank" rel="noopener">Términos de Servicio</a>
      </footer>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUBCOMPONENTES
// ═══════════════════════════════════════════════════════════════════

// ── Mis pedidos: activo (→ tracking en vivo) + entregados (→ volver a pedir) ──
function MisPedidosModal({ datos, onClose, onVolverAPedir }) {
  const activos = datos?.activos || []
  const pasados = datos?.pasados || []
  const fecha = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', timeZone: 'America/El_Salvador' })
    } catch { return '' }
  }
  const ESTADOS = { recibida: '💰 Por confirmar', preparando: '👨‍🍳 En cocina', lista: '✅ Lista', en_camino: '🛵 En camino' }
  const resumen = (p) => (p.items || []).map(i => `${i.cantidad}x ${i.nombre}`).join(', ')
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#191512', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto', padding: '18px 16px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#f3ead8', flex: 1 }}>🧾 Mis pedidos</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8a7d66', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {activos.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: '#8a7d66', fontWeight: 700, textTransform: 'uppercase', margin: '4px 0 6px' }}>En curso</div>
            {activos.map(p => (
              <a key={p.numero_orden} href={`${URL_DELIVERY}/track?t=${p.tracking_token}`}
                 style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px', borderRadius: 12, background: '#0d2818', border: '1px solid #2d6a4f', color: '#d8f3dc', textDecoration: 'none', marginBottom: 8, fontSize: 14 }}>
                <span style={{ flex: 1 }}><b>{p.numero_orden}</b> · {fmt(p.total)}<br />
                  <span style={{ fontSize: 12, opacity: .85 }}>{ESTADOS[p.estado] || p.estado} — tocá para seguirlo en vivo</span></span>
                <span style={{ fontSize: 18 }}>🛵→</span>
              </a>
            ))}
          </>
        )}

        {pasados.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: '#8a7d66', fontWeight: 700, textTransform: 'uppercase', margin: '10px 0 6px' }}>Pedí de nuevo</div>
            {pasados.map((p, i) => (
              <div key={`${p.numero_orden}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px', borderRadius: 12, background: '#221e19', border: '1px solid #3a332a', marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#f3ead8', fontWeight: 700 }}>{fecha(p.created_at)} · {fmt(p.total)}</div>
                  <div style={{ fontSize: 12, color: '#b8b2a7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumen(p)}</div>
                </div>
                <button onClick={() => onVolverAPedir(p)}
                  style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 12px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Volver a pedir
                </button>
              </div>
            ))}
          </>
        )}

        {activos.length === 0 && pasados.length === 0 && (
          <div style={{ color: '#8a7d66', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>Todavía no tenés pedidos con este teléfono.</div>
        )}
      </div>
    </div>
  )
}

function HeroBanner() {
  const [idx, setIdx] = useState(0)
  // Auto-slide cada 4s
  useEffect(() => {
    if (BANNERS.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % BANNERS.length), 4000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="mp-hero">
      <div className="mp-hero-slider">
        {BANNERS.map((b, i) => (
          <div
            key={b.id}
            className={`mp-hero-slide ${i === idx ? 'active' : ''}`}
            style={{ backgroundImage: `url("${b.imagen}")` }}
          />
        ))}
      </div>
      {BANNERS.length > 1 && (
        <div className="mp-hero-dots">
          {BANNERS.map((b, i) => (
            <button
              key={b.id}
              className={`mp-hero-dot ${i === idx ? 'active' : ''}`}
              onClick={() => setIdx(i)}
              aria-label={`Banner ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HeaderNegocio({ horarioBD }) {
  const { dia, horario } = horarioHoy(horarioBD)
  const nombresDia = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
  const hoy = nombresDia[dia]

  return (
    <div className="mp-header">
      <div className="mp-logo">
        <img src="/icon-512.png" alt="Freakie Dogs" className="mp-logo-img" />
      </div>
      <div className="mp-header-nombre">🎮 Mientras esperás, hacé correr al hot dog y ganate un combo</div>
      <div className="mp-header-info">
        <div className="mp-info-row">🕐 <span>{hoy}: {horario}</span></div>
        <div className="mp-info-row">$ Moneda: United State Dollar</div>
      </div>
      <div className="mp-consumo-min">
        Consumo mínimo de {fmt(NEGOCIO.consumoMinimo)} para envíos a domicilio
      </div>
    </div>
  )
}

function ProductoCard({ producto, onClick }) {
  const tieneOpciones = (producto.grupos || []).length > 0
  return (
    <button className="mp-card" onClick={onClick}>
      <div className="mp-card-info">
        <div className="mp-card-nombre">{producto.nombre}</div>
        {producto.descripcion && (
          <div className="mp-card-descripcion">{producto.descripcion}</div>
        )}
        <div className="mp-card-precio-row">
          <span className="mp-card-precio">{fmt(producto.precio)}</span>
          {tieneOpciones && <span className="mp-card-personaliza">Personalizable</span>}
        </div>
      </div>
      <div className="mp-card-foto">
        {producto.imagen_url ? (
          <img src={producto.imagen_url} alt={producto.nombre} loading="lazy" />
        ) : (
          <div className="mp-card-foto-placeholder">🌭</div>
        )}
      </div>
    </button>
  )
}

function ProductoModal({ producto, onClose, onAgregar, abierto }) {
  const [qty, setQty] = useState(1)
  const [nota, setNota] = useState('')
  // sel: { [grupoId]: [ {id,nombre,precio_extra}, ... ] }
  const [sel, setSel] = useState({})
  const [intento, setIntento] = useState(false)
  // Acordeón: un grupo abierto a la vez. Arrancan TODOS cerrados — con combos
  // de varios hot dogs la lista se hacía larguísima y la gente se perdía
  // scroleando sin saber qué le faltaba.
  const [grupoAbierto, setGrupoAbierto] = useState(null)

  const grupos = producto.grupos || []
  const esUnico = (g) => (g.max === 1) || g.tipo === 'unico' || g.tipo === 'single'
  const requerido = (g) => g.obligatorio || (Number(g.min) || 0) > 0
  const minDe = (g) => g.obligatorio ? Math.max(1, Number(g.min) || 0) : (Number(g.min) || 0)

  // El siguiente grupo al que conviene llevar a la persona: el primero que
  // todavía no cumple su mínimo.
  const siguientePendiente = (desdeId) => {
    const i = grupos.findIndex(g => g.id === desdeId)
    const resto = [...grupos.slice(i + 1), ...grupos.slice(0, Math.max(0, i))]
    return resto.find(g => (sel[g.id]?.length || 0) < minDe(g))?.id ?? null
  }

  const toggle = (g, op) => {
    setSel(prev => {
      const actual = prev[g.id] || []
      const ya = actual.some(x => x.id === op.id)
      let next
      if (esUnico(g)) {
        next = ya ? [] : [op]
      } else if (ya) {
        next = actual.filter(x => x.id !== op.id)
      } else {
        if (g.max && actual.length >= g.max) return prev  // tope alcanzado
        next = [...actual, op]
      }
      return { ...prev, [g.id]: next }
    })
    // En los de una sola opción ya no hay nada más que hacer ahí: se cierra y
    // se abre el siguiente que falte, para no obligar a buscarlo scroleando.
    if (esUnico(g)) {
      setTimeout(() => setGrupoAbierto(a => (a === g.id ? siguientePendiente(g.id) : a)), 180)
    }
  }

  const modsPlanos = useMemo(
    () => Object.entries(sel).flatMap(([grupoId, ops]) =>
      ops.map(o => ({ id: o.id, nombre: o.nombre, precio_extra: Number(o.precio_extra) || 0, grupoId }))),
    [sel]
  )
  const extrasUnidad = modsPlanos.reduce((s, m) => s + m.precio_extra, 0)
  const precioTotal = (Number(producto.precio) + extrasUnidad) * qty

  const faltantes = grupos.filter(g => (sel[g.id]?.length || 0) < minDe(g))

  const confirmar = () => {
    if (faltantes.length > 0) {
      setIntento(true)
      setGrupoAbierto(faltantes[0].id)   // llevarlo a lo que falta, no dejarlo buscando
      return
    }
    onAgregar(qty, nota, modsPlanos)
  }

  return (
    <div className="mp-modal-overlay" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <button className="mp-modal-close" onClick={onClose}>×</button>

        <div className="mp-modal-hero">
          {producto.imagen_url ? (
            <img src={producto.imagen_url} alt={producto.nombre} />
          ) : (
            <div className="mp-modal-hero-placeholder">🌭</div>
          )}
        </div>

        <div className="mp-modal-body">
          <h2 className="mp-modal-nombre">{producto.nombre}</h2>
          {producto.descripcion && (
            <p className="mp-modal-descripcion">{producto.descripcion}</p>
          )}
          <div className="mp-modal-precio">{fmt(producto.precio)}</div>

          {/* GRUPOS DE MODIFICADORES */}
          {grupos.map(g => {
            const cuenta = sel[g.id]?.length || 0
            const incompleto = intento && cuenta < minDe(g)
            const listo = cuenta >= minDe(g) && cuenta > 0
            const estaAbierto = grupoAbierto === g.id
            const elegidas = (sel[g.id] || []).map(o => o.nombre).join(', ')
            return (
              <div key={g.id} className={`mp-grupo ${incompleto ? 'error' : ''} ${estaAbierto ? 'abierto' : ''}`}>
                <button type="button" className="mp-grupo-head"
                        aria-expanded={estaAbierto}
                        onClick={() => setGrupoAbierto(a => (a === g.id ? null : g.id))}>
                  <span className="mp-grupo-check" aria-hidden="true">
                    {listo ? '✓' : requerido(g) ? '' : '+'}
                  </span>
                  <span className="mp-grupo-textos">
                    <span className="mp-grupo-nombre">{g.nombre}</span>
                    {/* Cerrado, el resumen dice qué se eligió o qué falta: así no
                        hay que abrir cada grupo para revisar el pedido. */}
                    <span className="mp-grupo-resumen">
                      {elegidas
                        ? elegidas
                        : requerido(g)
                          ? `Elegí ${minDe(g)}`
                          : g.max > 1 ? `Opcional · hasta ${g.max}` : 'Opcional'}
                    </span>
                  </span>
                  <span className="mp-grupo-flecha" aria-hidden="true">{estaAbierto ? '▲' : '▼'}</span>
                </button>
                <div className="mp-opciones" hidden={!estaAbierto}>
                  {(g.opciones || []).map(op => {
                    const activa = (sel[g.id] || []).some(x => x.id === op.id)
                    return (
                      <button
                        key={op.id}
                        type="button"
                        className={`mp-opcion ${activa ? 'active' : ''} ${esUnico(g) ? 'radio' : 'check'}`}
                        onClick={() => toggle(g, op)}
                      >
                        <span className="mp-opcion-nombre">{op.nombre}</span>
                        {Number(op.precio_extra) > 0 && (
                          <span className="mp-opcion-extra">+{fmt(op.precio_extra)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {incompleto && <div className="mp-grupo-error">Elegí al menos {minDe(g)}</div>}
              </div>
            )
          })}

          {/* NOTA */}
          <div className="mp-modal-nota-wrap">
            <label className="mp-modal-label">Notas para la cocina (opcional)</label>
            <textarea
              className="mp-modal-nota"
              placeholder="Sin cebolla, extra picante, etc."
              value={nota}
              onChange={e => setNota(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>

          {/* CANTIDAD + AGREGAR */}
          <div className="mp-modal-footer">
            <div className="mp-qty">
              <button className="mp-qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
              <span className="mp-qty-num">{qty}</span>
              <button className="mp-qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
            </div>
            <button
              className="mp-btn-agregar"
              onClick={confirmar}
            >
              {`Añadir · ${fmt(precioTotal)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CarritoDrawer({ items, total, onClose, onUpdate, onCheckout, reglas }) {
  const faltaMinimo = reglas ? Math.max(0, reglas.minimo - total) : 0
  const faltaGratis = reglas ? Math.max(0, reglas.gratisDesde - total) : 0
  const removeLinea = (lineaId) => {
    onUpdate(items.filter(i => i.lineaId !== lineaId))
  }
  const updateQty = (lineaId, delta) => {
    onUpdate(items.map(i => {
      if (i.lineaId !== lineaId) return i
      const nueva = Math.max(0, i.qty + delta)
      return nueva === 0 ? null : { ...i, qty: nueva }
    }).filter(Boolean))
  }

  return (
    <div className="mp-drawer-overlay" onClick={onClose}>
      <div className="mp-drawer" onClick={e => e.stopPropagation()}>
        <div className="mp-drawer-header">
          <button className="mp-drawer-close" onClick={onClose}>×</button>
          <h2>Mi Pedido</h2>
        </div>

        <div className="mp-drawer-body">
          {items.length === 0 ? (
            <div className="mp-drawer-vacio">
              Tu carrito está vacío
            </div>
          ) : (
            items.map(it => (
              <div key={it.lineaId} className="mp-linea">
                <div className="mp-linea-info">
                  <div className="mp-linea-nombre">{it.nombre}</div>
                  {it.nota && <div className="mp-linea-nota">📝 {it.nota}</div>}
                  {it.mods && it.mods.map((m, i) => (
                    <div key={i} className="mp-linea-mod">
                      + {m.nombre}{Number(m.precio_extra) > 0 ? ` (${fmt(m.precio_extra)})` : ''}
                    </div>
                  ))}
                  <div className="mp-linea-precio">{fmt((it.precio + (it.precioMods || 0)) * it.qty)}</div>
                </div>
                <div className="mp-linea-controles">
                  <button className="mp-qty-btn" onClick={() => updateQty(it.lineaId, -1)}>−</button>
                  <span className="mp-qty-num">{it.qty}</span>
                  <button className="mp-qty-btn" onClick={() => updateQty(it.lineaId, +1)}>+</button>
                  <button className="mp-linea-del" onClick={() => removeLinea(it.lineaId)}>🗑️</button>
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="mp-drawer-footer">
            {faltaMinimo > 0 && (
              <div className="mp-falta-minimo">
                Te faltan <b>{fmt(faltaMinimo)}</b> para el pedido mínimo de {fmt(reglas.minimo)} 🛵
              </div>
            )}
            {faltaMinimo === 0 && faltaGratis > 0 && (
              <div className="mp-falta-gratis">
                Agregá <b>{fmt(faltaGratis)}</b> más y el envío te sale <b>gratis</b> 🚀
              </div>
            )}
            <div className="mp-drawer-total">
              <span>Total</span>
              <span className="mp-drawer-total-num">{fmt(total)}</span>
            </div>
            <button className="mp-btn-checkout" onClick={onCheckout} disabled={faltaMinimo > 0}>
              {faltaMinimo > 0 ? `Mínimo ${fmt(reglas.minimo)} para pedir` : 'Continuar al pedido →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Confirmación post-pedido ────────────────────────────────────────
// El chat de WhatsApp lo inicia EL CLIENTE hacia nuestro número
// (config_delivery.whatsapp_pedidos): abrir nosotros conversaciones
// nuevas con el mismo texto + link es lo que WhatsApp castiga con
// bloqueos. Con el cliente iniciando, la torre solo responde dentro
// de un chat existente. El link de tracking va acá en pantalla para
// que el seguimiento no dependa de WhatsApp.
function PedidoEnviado({ datos, onClose }) {
  const waNum = String(datos.whatsapp || '').replace(/\D/g, '')
  const waMsg = `¡Hola! Soy ${datos.nombre || 'cliente'} 🌭 Confirmo mi pedido ${datos.numero_orden}${datos.total ? ` por ${fmt(datos.total)}` : ''}.`
  const waHref = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(waMsg)}` : null
  const trackHref = datos.tracking_token ? `${URL_DELIVERY}/track?t=${datos.tracking_token}` : null

  return (
    <div className="mp-drawer-overlay" onClick={onClose}>
      <div className="mp-drawer mp-enviado" onClick={e => e.stopPropagation()}>
        <div className="mp-drawer-header">
          <button className="mp-drawer-close" onClick={onClose}>×</button>
          <h2>¡Pedido enviado! 🌭</h2>
        </div>
        <div className="mp-drawer-body">
          <div className="mp-enviado-num">
            Tu pedido es el <b>{datos.numero_orden}</b>
            {datos.total ? <> · <b>{fmt(datos.total)}</b></> : null}
          </div>

          {waHref ? (
            <>
              <a className="mp-enviado-wa" href={waHref} target="_blank" rel="noreferrer">
                📲 Confirmar mi pedido por WhatsApp
              </a>
              <div className="mp-enviado-ayuda">
                Escribinos vos con este botón: así te contestamos en el mismo chat
                para coordinar el pago y avisarte de tu pedido. Guardanos como
                <b> Freakie Dogs</b> 💾
              </div>
            </>
          ) : (
            <div className="mp-enviado-ayuda">
              Te contactaremos pronto para coordinar el pago 📞
            </div>
          )}

          {trackHref && (
            <a className="mp-enviado-track" href={trackHref} target="_blank" rel="noreferrer">
              🛵 Seguir mi pedido en vivo
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Checkout({ items, total, onClose, onEnviado }) {
  const perfil = useMemo(leerPerfil, [])
  const clienteConocido = !!(perfil.nombre || perfil.telefono)
  const [tipo, setTipo] = useState('delivery') // 'delivery' | 'pickup'
  const [nombre, setNombre] = useState(perfil.nombre || '')
  const [telefono, setTelefono] = useState(perfil.telefono || '')
  const [direccion, setDireccion] = useState(perfil.direccion || '')
  const [zona, setZona] = useState(perfil.zona || '')
  const [notas, setNotas] = useState('')
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [pagaCon, setPagaCon] = useState('')   // billete con que paga (para el vuelto)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  // Ubicación / ruteo de sucursal (Fase 2)
  const [geoEstado, setGeoEstado] = useState('idle') // idle|buscando|ok|denegado|error
  const [ubic, setUbic] = useState(null)             // {lat,lng}
  const [ruteo, setRuteo] = useState(null)           // resultado de sucursal_mas_cercana

  // Ubicación en dos intentos: primero por red/wifi (rápido y funciona
  // dentro de centros comerciales), y si falla se reintenta con el GPS
  // fino. Con un solo intento de alta precisión el navegador cortaba a
  // los 10 s en interiores y el cliente veía "no pudimos leer tu ubicación".
  const usarMiUbicacion = () => {
    if (!navigator.geolocation) { setGeoEstado('sin_soporte'); return }
    setGeoEstado('buscando')

    const ok = async (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude
      setUbic({ lat, lng })
      try {
        const { data } = await db.rpc('sucursal_mas_cercana', { p_lat: lat, p_lng: lng })
        setRuteo(data || null)
      } catch { setRuteo(null) }
      setGeoEstado('ok')
    }

    const falla = (err) => {
      // 1 = permiso denegado · 2 = sin señal · 3 = se agotó el tiempo
      if (err?.code === 1) setGeoEstado('denegado')
      else if (err?.code === 2) setGeoEstado('sin_senal')
      else setGeoEstado('lento')
    }

    // Intento 1: rápido, por red (no exige GPS fino)
    navigator.geolocation.getCurrentPosition(ok,
      () => {
        // Intento 2: GPS fino, con más paciencia
        navigator.geolocation.getCurrentPosition(ok, falla,
          { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 })
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 })
  }

  // Tiendas donde se puede recoger (pickup)
  const [tiendas, setTiendas] = useState([])
  const [tiendaSel, setTiendaSel] = useState('')
  useEffect(() => {
    if (tipo !== 'pickup' || tiendas.length) return
    db.rpc('sucursales_pickup').then(({ data }) => setTiendas(data || [])).catch(() => {})
  }, [tipo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Costo de envío según distancia a la sucursal ruteada (parametrizable en la torre)
  const [envio, setEnvio] = useState(null)
  useEffect(() => {
    if (tipo !== 'delivery') { setEnvio(null); return }
    let vivo = true
    db.rpc('calcular_costo_envio', { p_distancia_km: ruteo?.distancia_km ?? 0, p_subtotal: total })
      .then(({ data }) => { if (vivo) setEnvio(data || null) })
      .catch(() => {})
    return () => { vivo = false }
  }, [tipo, total, ruteo?.distancia_km])

  const costoEnvio = tipo === 'delivery' ? Number(envio?.costo ?? 0) : 0
  const totalConEnvio = total + costoEnvio
  const cumpleMinimo = envio ? (envio.cumple_minimo ?? true) : (total >= NEGOCIO.consumoMinimo || tipo === 'pickup')

  const enviar = async () => {
    setError('')
    if (!nombre.trim()) return setError('Ingresá tu nombre')
    if (!telefono.trim() || telefono.trim().length < 8) return setError('Teléfono inválido')
    if (tipo === 'pickup' && !tiendaSel) return setError('Elegí en qué tienda vas a recoger')
    if (tipo === 'delivery') {
      if (!direccion.trim()) return setError('Dirección requerida para delivery')
      if (!zona) return setError('Elegí tu zona')
      if (!cumpleMinimo) return setError(`Pedido mínimo ${fmt(envio?.minimo ?? NEGOCIO.consumoMinimo)} para delivery`)
    }
    setEnviando(true)
    try {
      // El pedido se crea vía RPC: valida precios contra el menú real,
      // guarda el shape canónico y entra 'recibida' SIN comandar. La comanda
      // a cocina la dispara Karina al confirmar el pago (torre de control).
      const { data, error: rpcErr } = await db.rpc('crear_pedido_delivery', {
        p: {
          cliente_nombre: nombre.trim(),
          cliente_telefono: telefono.trim(),
          tipo,
          cliente_direccion: tipo === 'delivery' ? `[${zona}] ${direccion.trim()}` : null,
          zona: tipo === 'delivery' ? zona : null,
          sucursal_id: tipo === 'pickup' ? tiendaSel : null,
          cliente_lat: tipo === 'delivery' ? (ubic?.lat ?? null) : null,
          cliente_lng: tipo === 'delivery' ? (ubic?.lng ?? null) : null,
          metodo_pago: metodoPago,
          paga_con: metodoPago === 'efectivo' ? (parseFloat(pagaCon) || null) : null,
          notas_cliente: notas.trim() || null,
          items: items.map(i => ({
            menu_item_id: i.id,
            cantidad: i.qty,
            nota: i.nota || null,
            modificadores: (i.mods || []).map(m => m.id),
          })),
        },
      })
      if (rpcErr) throw rpcErr
      if (!data?.ok) throw new Error('respuesta inesperada')

      // Recordar datos en este dispositivo para el próximo pedido (el CRM
      // server-side lo actualiza la propia RPC).
      guardarPerfil({
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        direccion: direccion.trim(),
        zona,
      })

      onEnviado({ ...data, nombre: nombre.trim() })
    } catch (err) {
      console.error('Error enviando pedido:', err)
      setError('No se pudo enviar el pedido. Intentá otra vez o llamanos.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mp-drawer-overlay" onClick={onClose}>
      <div className="mp-drawer mp-checkout" onClick={e => e.stopPropagation()}>
        <div className="mp-drawer-header">
          <button className="mp-drawer-close" onClick={onClose}>×</button>
          <h2>Datos del pedido</h2>
        </div>

        <div className="mp-drawer-body">
          {clienteConocido && (
            <div className="mp-cliente-conocido">
              👋 ¡Hola de nuevo{perfil.nombre ? `, ${perfil.nombre.split(' ')[0]}` : ''}! Ya llenamos tus datos — revisalos y confirmá.
            </div>
          )}

          {/* TIPO */}
          <div className="mp-tipo-toggle">
            <button
              className={`mp-tipo-btn ${tipo === 'delivery' ? 'active' : ''}`}
              onClick={() => setTipo('delivery')}
            >🛵 A domicilio</button>
            <button
              className={`mp-tipo-btn ${tipo === 'pickup' ? 'active' : ''}`}
              onClick={() => setTipo('pickup')}
            >🏃 Pasar a recoger</button>
          </div>

          {/* NOMBRE + TEL */}
          <div className="mp-field">
            <label>Nombre *</label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" />
          </div>
          <div className="mp-field">
            <label>Teléfono *</label>
            <input
              type="tel"
              value={telefono}
              onChange={e => setTelefono(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              placeholder="7777-7777"
            />
          </div>

          {/* SI PICKUP: en qué tienda retira */}
          {tipo === 'pickup' && (
            <div className="mp-field">
              <label>¿En qué tienda lo recogés? *</label>
              <select value={tiendaSel} onChange={e => setTiendaSel(e.target.value)}>
                <option value="">Elegí la tienda</option>
                {tiendas.map(t => (
                  <option key={t.id} value={t.id}>{t.nombre}</option>
                ))}
              </select>
              {tiendaSel && (
                <div className="mp-pickup-info">
                  🏪 Te esperamos en <b>{tiendas.find(t => t.id === tiendaSel)?.nombre}</b>
                  {tiendas.find(t => t.id === tiendaSel)?.direccion ? ` · ${tiendas.find(t => t.id === tiendaSel).direccion}` : ''}
                </div>
              )}
            </div>
          )}

          {/* SI DELIVERY: UBICACIÓN + DIRECCIÓN + ZONA */}
          {tipo === 'delivery' && (
            <>
              <div className="mp-field">
                <label>Tu ubicación *</label>
                <div className="mp-geo-ayuda">
                  Con tu ubicación asignamos la tienda más cercana y calculamos el envío exacto. Sin ella, te lo confirmamos por WhatsApp.
                </div>
                <button type="button" className="mp-geo-btn" onClick={usarMiUbicacion} disabled={geoEstado === 'buscando'}>
                  {geoEstado === 'buscando' ? '📍 Buscando tu ubicación…'
                    : geoEstado === 'ok' ? '📍 Cambiar mi ubicación'
                    : '📍 Usar mi ubicación'}
                </button>
                {geoEstado === 'ok' && ruteo?.en_cobertura && (
                  <div className="mp-geo-ok">
                    ✅ Te atiende <b>{ruteo.nombre}</b> · a {ruteo.distancia_km} km
                  </div>
                )}
                {geoEstado === 'ok' && ruteo && !ruteo.en_cobertura && (
                  <div className="mp-geo-warn">
                    ⚠️ Estás fuera de nuestra cobertura de reparto. Podés seguir con el pedido y te confirmamos por WhatsApp.
                  </div>
                )}
                {geoEstado === 'denegado' && (() => {
                  const g = comoPermitirUbicacion()
                  return (
                    <div className="mp-geo-warn">
                      <b>{g.titulo}</b>
                      <ol className="mp-geo-pasos">{g.pasos.map((paso, i) => <li key={i}>{paso}</li>)}</ol>
                      <div className="mp-geo-nota">
                        Si preferís no hacerlo ahora, seguí igual y escribí bien tu dirección — te confirmamos el envío por WhatsApp.
                      </div>
                      <button type="button" className="mp-geo-reintentar" onClick={usarMiUbicacion}>Reintentar</button>
                    </div>
                  )
                })()}
                {geoEstado === 'sin_senal' && (
                  <div className="mp-geo-warn">
                    No encontramos señal de ubicación. Probá cerca de una ventana o con los datos móviles encendidos.
                    <button type="button" className="mp-geo-reintentar" onClick={usarMiUbicacion}>Reintentar</button>
                  </div>
                )}
                {geoEstado === 'lento' && (
                  <div className="mp-geo-warn">
                    Tardó demasiado en ubicarte. Podés reintentar, o seguir y escribir bien tu dirección — te confirmamos el envío por WhatsApp.
                    <button type="button" className="mp-geo-reintentar" onClick={usarMiUbicacion}>Reintentar</button>
                  </div>
                )}
                {geoEstado === 'sin_soporte' && (
                  <div className="mp-geo-warn">Tu navegador no permite compartir ubicación. Escribí bien tu dirección y te confirmamos el envío por WhatsApp.</div>
                )}
              </div>
              <div className="mp-field">
                <label>Zona *</label>
                <select value={zona} onChange={e => setZona(e.target.value)}>
                  <option value="">Elegí una zona</option>
                  {NEGOCIO.zonasDelivery.map(z => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div className="mp-field">
                <label>Dirección exacta *</label>
                <textarea
                  value={direccion}
                  onChange={e => setDireccion(e.target.value)}
                  placeholder="Colonia, calle, número de casa, referencia..."
                  rows={3}
                />
              </div>
            </>
          )}

          {/* MÉTODO DE PAGO */}
          <div className="mp-field">
            <label>Método de pago</label>
            <div className="mp-pago-opts">
              {['efectivo', 'tarjeta', 'transferencia'].map(m => (
                <button
                  key={m}
                  className={`mp-pago-btn ${metodoPago === m ? 'active' : ''}`}
                  onClick={() => setMetodoPago(m)}
                >
                  {m === 'efectivo' ? '💵 Efectivo' : m === 'tarjeta' ? '💳 Tarjeta' : '🏦 Transferencia'}
                </button>
              ))}
            </div>
          </div>

          {/* Con cuánto paga (efectivo): para que el motorista lleve el cambio */}
          {metodoPago === 'efectivo' && (
            <div className="mp-field">
              <label>¿Con cuánto vas a pagar? <span style={{ color: '#8a8a8a', fontWeight: 400 }}>(para llevarte el cambio)</span></label>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={pagaCon}
                     onChange={e => setPagaCon(e.target.value)} placeholder="Ej: 20" />
            </div>
          )}

          {/* NOTAS */}
          <div className="mp-field">
            <label>Notas (opcional)</label>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Alguna indicación especial..."
              rows={2}
            />
          </div>

          {/* RESUMEN */}
          <div className="mp-resumen">
            <div className="mp-resumen-row">
              <span>Productos ({items.reduce((s, i) => s + i.qty, 0)})</span>
              <span>{fmt(total)}</span>
            </div>
            {tipo === 'delivery' && (
              <div className="mp-resumen-row mp-resumen-envio">
                <span>Envío{ruteo?.distancia_km != null ? ` · ${ruteo.distancia_km} km` : ''}</span>
                {envio?.gratis
                  ? <span className="mp-envio-gratis">¡GRATIS! 🎉</span>
                  : <span>{envio ? fmt(costoEnvio) : '—'}{envio && envio.estimado === false ? ' *' : ''}</span>}
              </div>
            )}
            {tipo === 'delivery' && envio && envio.estimado === false && (
              <div className="mp-envio-tip">
                * Sin tu ubicación no podemos calcular el envío exacto. Te confirmamos el monto por WhatsApp antes de cobrarte.
              </div>
            )}
            {tipo === 'delivery' && envio && !envio.gratis && Number(envio.falta_para_gratis) > 0 && (
              <div className="mp-envio-tip">
                Agregá {fmt(envio.falta_para_gratis)} más y el envío te sale gratis 🚀
              </div>
            )}
            <div className="mp-resumen-total">
              <span>Total</span>
              <span>{fmt(totalConEnvio)}</span>
            </div>
          </div>

          {error && <div className="mp-error">{error}</div>}
        </div>

        <div className="mp-drawer-footer">
          <button
            className="mp-btn-checkout"
            onClick={enviar}
            disabled={enviando}
          >
            {enviando ? 'Enviando...' : `Confirmar pedido · ${fmt(totalConEnvio)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
