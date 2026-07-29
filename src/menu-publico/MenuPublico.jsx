// ────────────────────────────────────────────────────────────────────
// Menú Público — Freakie Dogs (reemplazo de BuhoPay)
// Réplica visual del catálogo BuhoPay. Entry: /menu (menu.html)
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef } from 'react'
import { db } from '../supabase'
import { CATEGORIAS, PRODUCTOS, NEGOCIO, BANNERS } from './catalogoBuho'

const fmt = (n) => `$${Number(n).toFixed(2)}`

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
  const [categoriaActiva, setCategoriaActiva] = useState(CATEGORIAS[0].id)
  const [carrito, setCarrito] = useState([])
  const [productoModal, setProductoModal] = useState(null)
  const [carritoAbierto, setCarritoAbierto] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [showTop, setShowTop] = useState(false)
  const seccionesRef = useRef({})
  const abierto = abiertoAhora()

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
      for (const cat of CATEGORIAS) {
        const el = seccionesRef.current[cat.id]
        if (el && el.offsetTop <= viewport) setCategoriaActiva(cat.id)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const totalCarrito = useMemo(
    () => carrito.reduce((s, it) => s + it.precio * it.qty, 0),
    [carrito]
  )
  const cantidadCarrito = carrito.reduce((s, it) => s + it.qty, 0)

  const agregarAlCarrito = (producto, qty = 1, nota = '', mods = []) => {
    setCarrito(prev => {
      // Si mismo producto sin nota ni mods → suma qty
      if (!nota && mods.length === 0) {
        const idx = prev.findIndex(i => i.id === producto.id && !i.nota && (!i.mods || i.mods.length === 0))
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], qty: next[idx].qty + qty }
          return next
        }
      }
      return [...prev, { lineaId: Date.now() + Math.random(), ...producto, qty, nota, mods }]
    })
    setToast('Producto añadido')
  }

  const scrollACategoria = (catId) => {
    const el = seccionesRef.current[catId]
    if (el) window.scrollTo({ top: el.offsetTop - 60, behavior: 'smooth' })
  }

  const productosPorCategoria = useMemo(() => {
    const map = {}
    for (const cat of CATEGORIAS) map[cat.id] = []
    for (const p of PRODUCTOS) if (map[p.categoria]) map[p.categoria].push(p)
    return map
  }, [])

  return (
    <div className="mp-page">
      <div className="mp-container">

        {/* HERO BANNER */}
        <HeroBanner />

        {/* LOGO + INFO NEGOCIO */}
        <HeaderNegocio />

        {/* TABS CATEGORIAS (sticky) */}
        <div className="mp-tabs-wrap">
          <div className="mp-tabs">
            {CATEGORIAS.map(cat => (
              <button
                key={cat.id}
                className={`mp-tab ${categoriaActiva === cat.id ? 'active' : ''}`}
                onClick={() => scrollACategoria(cat.id)}
              >
                {cat.nombre} {cat.emoji}
              </button>
            ))}
          </div>
        </div>

        {/* SECCIONES POR CATEGORIA */}
        {CATEGORIAS.map(cat => (
          <section
            key={cat.id}
            ref={el => { if (el) seccionesRef.current[cat.id] = el }}
            className="mp-seccion"
          >
            <h2 className="mp-seccion-titulo">{cat.nombre} {cat.emoji}</h2>
            <div className="mp-productos">
              {productosPorCategoria[cat.id].map(prod => (
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
  return (
    <button className="mp-card" onClick={onClick}>
      <div className="mp-card-info">
        <div className="mp-card-nombre">{producto.nombre}</div>
        {producto.descripcion && (
          <div className="mp-card-descripcion">{producto.descripcion}</div>
        )}
        <div className="mp-card-precio-row">
          <span className="mp-card-precio">{fmt(producto.precio)}</span>
          {producto.destacado && <span className="mp-card-star">⭐</span>}
          {producto.like && <span className="mp-card-like">👍</span>}
        </div>
      </div>
      <div className="mp-card-foto">
        {producto.imagen ? (
          <img
            src={producto.imagen}
            alt={producto.nombre}
            loading="lazy"
            className={producto.artwork ? 'contain' : ''}
          />
        ) : (
          <div className="mp-card-foto-placeholder">
            🍔
          </div>
        )}
      </div>
    </button>
  )
}

function ProductoModal({ producto, onClose, onAgregar, abierto }) {
  const [qty, setQty] = useState(1)
  const [nota, setNota] = useState('')
  const [mods, setMods] = useState([])

  const precioTotal = producto.precio * qty +
    mods.reduce((s, m) => s + (m.precio_extra || 0) * qty, 0)

  return (
    <div className="mp-modal-overlay" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <button className="mp-modal-close" onClick={onClose}>×</button>

        <div className="mp-modal-hero">
          {producto.imagen ? (
            <img src={producto.imagen} alt={producto.nombre} />
          ) : (
            <div className="mp-modal-hero-placeholder">🍔</div>
          )}
        </div>

        <div className="mp-modal-body">
          <h2 className="mp-modal-nombre">{producto.nombre}</h2>
          {producto.descripcion && (
            <p className="mp-modal-descripcion">{producto.descripcion}</p>
          )}
          <div className="mp-modal-precio">{fmt(producto.precio)}</div>

          {/* MODIFICADORES — placeholder hasta que Cesar mande capturas */}
          {producto.modificadores && producto.modificadores.length > 0 && (
            <div className="mp-modal-mods">
              {/* TODO: renderizar grupos de modificadores */}
              <div className="mp-modal-mods-todo">
                Modificadores próximamente
              </div>
            </div>
          )}

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
              <button
                className="mp-qty-btn"
                onClick={() => setQty(q => Math.max(1, q - 1))}
                disabled={qty <= 1}
              >−</button>
              <span className="mp-qty-num">{qty}</span>
              <button
                className="mp-qty-btn"
                onClick={() => setQty(q => q + 1)}
              >+</button>
            </div>
            <button
              className="mp-btn-agregar"
              disabled={!abierto}
              onClick={() => onAgregar(qty, nota, mods)}
            >
              {abierto
                ? `Añadir · ${fmt(precioTotal)}`
                : 'Cerrado ahora'}
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
                    <div key={i} className="mp-linea-mod">+ {m.nombre}</div>
                  ))}
                  <div className="mp-linea-precio">{fmt(it.precio * it.qty)}</div>
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
  const [tipo, setTipo] = useState('delivery') // 'delivery' | 'pickup'
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')
  const [zona, setZona] = useState('')
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
