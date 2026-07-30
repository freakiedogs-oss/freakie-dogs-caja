// ────────────────────────────────────────────────────────────────────
// Menú Público — Freakie Dogs (reemplazo de BuhoPay)
// Entry: /menu (menu.html). El menú se lee EN VIVO del POS
// (RPC menu_publico_delivery → canal delivery_propio, con modificadores),
// así los precios y opciones son los mismos que cobra la caja.
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef } from 'react'
import { db } from '../supabase'
import { NEGOCIO, BANNERS } from './catalogoBuho'

const fmt = (n) => `$${Number(n).toFixed(2)}`

// Emoji decorativo por categoría (el POS no guarda emoji)
const EMOJI_CAT = {
  combos: '🌭🍟🥤', 'freakie burger': '🍔', individuales: '🌭',
  'fries & sides': '🍟', bebidas: '🥤', cervezas: '🍺', extras: '⭐',
}
const emojiDe = (nombre) => EMOJI_CAT[(nombre || '').toLowerCase()] || ''

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

// Horario del día actual en El Salvador (UTC-6)
function horarioHoy() {
  const d = new Date(Date.now() - 6 * 3600 * 1000)
  const dias = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado']
  const dia = dias[d.getUTCDay()]
  return { dia, horario: NEGOCIO.horarios[dia] || 'Cerrado' }
}

function abiertoAhora() {
  const { horario } = horarioHoy()
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
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [categoriaActiva, setCategoriaActiva] = useState('')
  const [carrito, setCarrito] = useState([])
  const [productoModal, setProductoModal] = useState(null)
  const [carritoAbierto, setCarritoAbierto] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [showTop, setShowTop] = useState(false)
  const seccionesRef = useRef({})
  const abierto = abiertoAhora()

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

  return (
    <div className="mp-page">
      <div className="mp-container">

        {/* HERO BANNER */}
        <HeroBanner />

        {/* LOGO + INFO NEGOCIO */}
        <HeaderNegocio />

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
          onEnviado={() => {
            setCarrito([])
            setCheckoutOpen(false)
            setToast('¡Pedido enviado! Te contactaremos pronto 🌭')
          }}
        />
      )}

      {/* TOAST */}
      {toast && <div className="mp-toast">{toast}</div>}

      {/* BANNER CERRADO (si aplica) */}
      {!abierto && (
        <div className="mp-cerrado-banner">
          <div className="mp-cerrado-icon">🏪</div>
          <div>
            <div className="mp-cerrado-titulo">Nos encontramos cerrados</div>
            <div className="mp-cerrado-sub">Regresa en nuestro próximo horario de apertura.</div>
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

function HeaderNegocio() {
  const { horario } = horarioHoy()
  const nombresDia = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
  const hoy = nombresDia[new Date(Date.now() - 6 * 3600 * 1000).getUTCDay()]

  return (
    <div className="mp-header">
      <div className="mp-logo">
        <div className="mp-logo-inner">Freakie<br/>Dogs</div>
      </div>
      <div className="mp-header-nombre">{NEGOCIO.descripcion}</div>
      <div className="mp-header-info">
        <div className="mp-info-row">📍 <a href="#ubicacion">Ver Ubicación</a></div>
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

  const grupos = producto.grupos || []
  const esUnico = (g) => (g.max === 1) || g.tipo === 'unico' || g.tipo === 'single'
  const requerido = (g) => g.obligatorio || (Number(g.min) || 0) > 0
  const minDe = (g) => g.obligatorio ? Math.max(1, Number(g.min) || 0) : (Number(g.min) || 0)

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
    if (faltantes.length > 0) { setIntento(true); return }
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
            return (
              <div key={g.id} className={`mp-grupo ${incompleto ? 'error' : ''}`}>
                <div className="mp-grupo-head">
                  <span className="mp-grupo-nombre">{g.nombre}</span>
                  {requerido(g)
                    ? <span className="mp-grupo-badge req">Obligatorio</span>
                    : <span className="mp-grupo-badge">Opcional</span>}
                  {g.max > 1 && <span className="mp-grupo-hint">Hasta {g.max}</span>}
                </div>
                <div className="mp-opciones">
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
              disabled={!abierto}
              onClick={confirmar}
            >
              {abierto ? `Añadir · ${fmt(precioTotal)}` : 'Cerrado ahora'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CarritoDrawer({ items, total, onClose, onUpdate, onCheckout }) {
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
            <div className="mp-drawer-total">
              <span>Total</span>
              <span className="mp-drawer-total-num">{fmt(total)}</span>
            </div>
            <button className="mp-btn-checkout" onClick={onCheckout}>
              Continuar al pedido →
            </button>
          </div>
        )}
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
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const cumpleMinimo = total >= NEGOCIO.consumoMinimo || tipo === 'pickup'

  const enviar = async () => {
    setError('')
    if (!nombre.trim()) return setError('Ingresá tu nombre')
    if (!telefono.trim() || telefono.trim().length < 8) return setError('Teléfono inválido')
    if (tipo === 'delivery') {
      if (!direccion.trim()) return setError('Dirección requerida para delivery')
      if (!zona) return setError('Elegí tu zona')
      if (!cumpleMinimo) return setError(`Consumo mínimo ${fmt(NEGOCIO.consumoMinimo)} para delivery`)
    }
    setEnviando(true)
    try {
      // Costo de envío placeholder — el despachador lo ajusta al aceptar
      const costoEnvio = tipo === 'delivery' ? 0 : 0
      const numeroOrden = 'WEB-' + Date.now().toString().slice(-8)
      const { error: dbErr } = await db.from('delivery_clientes').insert({
        numero_orden: numeroOrden,
        cliente_nombre: nombre.trim(),
        cliente_telefono: telefono.trim(),
        cliente_direccion: tipo === 'delivery' ? `[${zona}] ${direccion.trim()}` : 'PICKUP',
        items: items.map(i => ({
          id: i.id,
          nombre: i.nombre,
          precio: i.precio,
          qty: i.qty,
          nota: i.nota || null,
          mods: i.mods || [],
        })),
        metodo_pago: metodoPago,
        subtotal: total,
        costo_envio: costoEnvio,
        total: total + costoEnvio,
        estado: 'pendiente',
        notas_cliente: notas.trim() || null,
      })
      if (dbErr) throw dbErr

      // Recordar datos en este dispositivo para el próximo pedido
      guardarPerfil({
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        direccion: direccion.trim(),
        zona,
      })

      // Registrar/actualizar en el CRM (tabla aislada) para marketing futuro:
      // promos a frecuentes, cumpleaños, reactivación. Va por RPC SECURITY
      // DEFINER (anon no toca la tabla directo). No bloquea el pedido si falla.
      db.rpc('registrar_cliente_delivery', {
        p_telefono: telefono.trim(),
        p_nombre: nombre.trim() || null,
        p_direccion: tipo === 'delivery' ? (direccion.trim() || null) : null,
        p_zona: tipo === 'delivery' ? (zona || null) : null,
      }).catch(() => {})

      onEnviado()
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

          {/* SI DELIVERY: DIRECCIÓN + ZONA */}
          {tipo === 'delivery' && (
            <>
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
                <span>Envío</span>
                <span>Se calcula al aceptar</span>
              </div>
            )}
            <div className="mp-resumen-total">
              <span>Total</span>
              <span>{fmt(total)}</span>
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
            {enviando ? 'Enviando...' : `Confirmar pedido · ${fmt(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
