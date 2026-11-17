// ────────────────────────────────────────────────────────────────────
// Tracking del pedido — pantalla que ve el cliente (Fase 6).
// Entra por /track?t=<tracking_token>. Se refresca cada 15s.
// Cuando el pedido va en camino aparece el mapa con el motorista en vivo.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { db } from '../supabase'
import EncuestaEntrega from './EncuestaEntrega'

const MapaEnVivo = lazy(() => import('./MapaEnVivo'))
const Juego = lazy(() => import('./Juego'))
// El bloque de pago del menú sirve igual acá: con un pedido ya creado cobra ese
// en vez de crear uno nuevo.
const BloquePago = lazy(() => import('../menu-publico/PagoTarjeta'))

const PASOS = [
  { k: 'recibida',   ic: '📝', t: 'Pedido recibido',  sub: 'Te vamos a escribir para coordinar el pago' },
  { k: 'preparando', ic: '👨‍🍳', t: 'En cocina',        sub: 'Estamos preparando tu pedido' },
  { k: 'lista',      ic: '🎒', t: 'Listo',            sub: 'Esperando al motorista' },
  { k: 'en_camino',  ic: '🛵', t: 'En camino',        sub: 'Tu pedido va para allá' },
  { k: 'entregada',  ic: '🎉', t: 'Entregado',        sub: '¡Buen provecho!' },
]
// OJO: `Math.max(0, …)` colapsa cualquier estado que no esté en PASOS al paso
// 0, o sea "Pedido recibido — Te vamos a escribir para coordinar el pago". Para
// un pedido sin pagar eso era una promesa falsa: nadie le iba a escribir porque
// el pedido ni siquiera está en la torre. Por eso `pendiente_pago` se atiende
// antes, con su propia pantalla, y nunca llega acá.
const idxDe = (e) => Math.max(0, PASOS.findIndex(p => p.k === e))
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`

export default function TrackingPedido() {
  const [token] = useState(() => new URLSearchParams(location.search).get('t') || '')
  const juegoRef = useRef(null)
  const tuvoParadas = useRef(false)
  const [d, setD] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setError('Link incompleto'); return }
    let vivo = true
    const cargar = async () => {
      const { data, error: e } = await db.rpc('tracking_pedido', { p_token: token })
      if (!vivo) return
      if (e) { setError('No pudimos cargar tu pedido'); return }
      if (!data?.ok) { setError('No encontramos ese pedido'); return }
      setD(data)
    }
    cargar()
    const t = setInterval(cargar, 15000)
    return () => { vivo = false; clearInterval(t) }
  }, [token])

  if (error) return <Marco><div className="tk-error">😕 {error}</div></Marco>
  if (!d) return <Marco><div className="tk-cargando"><span className="tk-spin" /> Cargando tu pedido…</div></Marco>

  const paso = idxDe(d.estado)
  const enCamino = d.estado === 'en_camino'
  const entregado = d.estado === 'entregada'
  const sinPagar = d.estado === 'pendiente_pago'

  // Entregas que el motorista hace antes que la tuya (7-nov-2026). Sin explicar
  // el porqué: solo dónde va y que después seguís vos.
  const paradas = enCamino ? (d.paradas_antes || []) : []
  const nAntes = paradas.length
  if (nAntes > 0) tuvoParadas.current = true
  const quien = d.motorista || 'El motorista'
  const subEnCamino = nAntes > 0
    ? `${quien} va a dejar ${nAntes === 1 ? 'una orden' : `${nAntes} órdenes`} antes y luego seguís vos, inmediatamente.`
    : tuvoParadas.current
      ? `¡Seguís vos! ${quien} va directo a tu dirección.`
      : null

  // ── Pedido sin pagar: honesto y con salida ──
  // No se muestra la línea de tiempo ni el juego: no hay nada en marcha
  // todavía. Lo único que corresponde es terminar de pagarlo.
  if (sinPagar) {
    return (
      <Marco>
        <div className="tk-hero">
          <div className="tk-hero-ic">💳</div>
          <h1 className="tk-hero-t">Falta pagar tu pedido</h1>
          <p className="tk-hero-s">
            Todavía no lo mandamos a cocina. Pagalo acá y sale de una.
          </p>
        </div>

        <div className="mp-pago-resumen">
          <span>Pedido {d.numero_orden}</span>
          <b>{fmt(d.total)}</b>
        </div>

        <Suspense fallback={<div className="tk-cargando"><span className="tk-spin" /></div>}>
          <BloquePago
            total={Number(d.total)}
            trackingToken={token}
            onAprobado={() => window.location.reload()}
            onEfectivo={() => window.location.reload()}
            onNoDisponible={() => {}}
          />
        </Suspense>
      </Marco>
    )
  }

  // Aviso de la central (8-nov-2026): p. ej. «tu pedido ya está afuera»
  const aviso = d.aviso
  const llego = enCamino && d.llego_at
  const avisoTel = String(aviso?.tel || '').replace(/\D/g, '')

  return (
    <Marco>
      {llego && <AvisoLlego motorista={d.motorista} />}
      {aviso && (
        <div style={{ background: '#FFD900', color: '#1a1200', borderRadius: 16, padding: '16px 16px 14px',
                      margin: '4px 0 14px', textAlign: 'center', boxShadow: '0 4px 14px rgba(0,0,0,.18)' }}>
          <div style={{ fontSize: 30 }}>📣</div>
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3, marginTop: 4 }}>{aviso.texto}</div>
          {avisoTel.length >= 8 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <a href={`tel:${avisoTel}`} style={{ flex: 1, background: '#1a1200', color: '#FFD900', borderRadius: 12,
                 padding: 12, fontWeight: 800, textDecoration: 'none' }}>📞 Llamar</a>
              <a href={`https://wa.me/${avisoTel.length === 8 ? '503' + avisoTel : avisoTel}`} target="_blank" rel="noopener"
                 style={{ flex: 1, background: '#25D366', color: '#04220f', borderRadius: 12, padding: 12,
                          fontWeight: 800, textDecoration: 'none' }}>💬 WhatsApp</a>
            </div>
          )}
        </div>
      )}
      <div className="tk-hero">
        <div className="tk-hero-ic">{PASOS[paso].ic}</div>
        <h1 className="tk-hero-t">{PASOS[paso].t}</h1>
        <p className="tk-hero-s">
          {(enCamino && subEnCamino)
            || (d.motorista_en_otra_entrega && `${d.motorista || 'Tu motorista'} está terminando otra entrega y regresa a la tienda por tu pedido.`)
            || PASOS[paso].sub}
        </p>
        {enCamino && d.eta_min && (
          <div className="tk-eta">
            Llega en ~{d.eta_min} min
            {nAntes > 0 ? ` · sos la entrega ${nAntes + 1} de ${nAntes + 1}` : d.motorista ? ` · ${d.motorista} lo lleva` : ''}
          </div>
        )}
      </div>

      {/* Invitación al juego: hot dog corriendo a lo ancho */}
      {!entregado && (
        <button className="tk-invita" onClick={() => juegoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <div className="tk-invita-pista">
            <span className="tk-invita-dog">🌭</span>
            <span className="tk-invita-dog dos">🌭</span>
          </div>
          <div className="tk-invita-txt">
            <b>¿Se te hace largo?</b> Hacé correr al hot dog y ganate un combo
            <span className="tk-invita-cta">Jugar ↓</span>
          </div>
        </button>
      )}

      {/* Mapa en vivo mientras va en camino */}
      {enCamino && d.driver_lat && (
        <Suspense fallback={<div className="tk-mapa-ph">Cargando mapa…</div>}>
          <MapaEnVivo
            driver={{ lat: d.driver_lat, lng: d.driver_lng }}
            cliente={d.cliente_lat ? { lat: d.cliente_lat, lng: d.cliente_lng } : null}
            nombre={d.motorista}
            paradas={paradas}
          />
        </Suspense>
      )}
      {enCamino && !d.driver_lat && (
        // Sin motorista asignado no hay señal que esperar: decirlo así haría
        // pensar que algo falla. Solo se promete el mapa cuando hay alguien.
        <div className="tk-mapa-ph">
          {d.motorista
            ? '📡 Buscando la señal del motorista…'
            : '🛵 Tu pedido ya salió y va en camino'}
        </div>
      )}

      {/* Línea de tiempo */}
      <ol className="tk-pasos">
        {PASOS.map((p, i) => (
          <li key={p.k} className={`tk-paso ${i < paso ? 'hecho' : ''} ${i === paso ? 'activo' : ''}`}>
            <span className="tk-punto">{i < paso ? '✓' : p.ic}</span>
            <span className="tk-paso-t">{p.t}</span>
          </li>
        ))}
      </ol>

      {/* Resumen */}
      <div className="tk-card">
        <div className="tk-card-h">
          <span>Pedido {d.numero_orden}</span>
          <span className="tk-total">{fmt(d.total)}</span>
        </div>
        <ul className="tk-items">
          {(d.items || []).map((i, k) => (
            <li key={k}><span className="tk-qty">{i.cantidad}×</span> {i.nombre}</li>
          ))}
        </ul>
        {d.direccion && <div className="tk-dir">📍 {d.direccion}</div>}
        {d.sucursal && <div className="tk-dir">🏪 Sale de {d.sucursal}</div>}
        {/* «Esperá y ahorrá» (16-nov-2026): le recordamos lo que eligió */}
        {d.espera_ahorra && !entregado && (
          <div style={{ marginTop: 8, background: '#EEF8EC', border: '1px solid #b7e4c4', color: '#2f5f27',
                        borderRadius: 10, padding: '8px 10px', fontSize: 13 }}>
            ⏳ Elegiste <b>Esperá y ahorrá</b>: ahorraste <b>{fmt(d.descuento)}</b>.
            {d.espera_promesa_at && (
              <> Llega a más tardar a las <b>{new Date(d.espera_promesa_at).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit' })}</b>.</>
            )}
          </div>
        )}
      </div>

      {/* Juego mientras espera (no cuando ya llegó) */}
      {!entregado && (
        <div ref={juegoRef}>
          <Suspense fallback={null}>
            <Juego trackingToken={token} numeroOrden={d.numero_orden} />
          </Suspense>
        </div>
      )}

      <RegaloBienvenida token={token} estado={d.estado} />
      {entregado && <CuponGanado token={token} />}

      {entregado && <EncuestaEntrega token={token} inicial={d.calificacion} />}

      {entregado && (
        <div className="tk-gracias">
          ¡Gracias por pedir en Freakie Dogs! 🌭<br />
          <span>Ese extra extraordinario</span>
        </div>
      )}

      <footer className="tk-foot">Esta página se actualiza sola</footer>
    </Marco>
  )
}

// Cupón de regreso (10-nov-2026, Cesar): si este pedido lo ganó (subtotal desde
// $20 y no usó cupón), se muestra al entregar con su vencimiento (21 días) y el
// mínimo. Queda guardado con el teléfono: el cliente no copia ningún código.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
function CuponGanado({ token }) {
  const [c, setC] = useState(null)
  useEffect(() => {
    let vivo = true
    db.rpc('cupon_de_pedido', { p_token: token })
      .then(({ data }) => { if (vivo && data && Number(data.monto) > 0) setC(data) })
      .catch(() => {})
    return () => { vivo = false }
  }, [token])
  if (!c) return null
  const vence = new Date(c.vence_at)
  const fecha = `${vence.getDate()} de ${MESES[vence.getMonth()]}`
  const monto = `$${Number(c.monto).toFixed(2)}`
  if (!c.libre) {
    return (
      <div style={{ margin: '14px 12px 4px', border: '1px solid #e5ddd3', borderRadius: 14, padding: 12, textAlign: 'center',
                    color: '#6b5a48', fontSize: 13 }}>
        🎁 El cupón de {monto} que ganaste con este pedido ya se usó o venció.
      </div>
    )
  }
  return (
    <div style={{ margin: '14px 12px 4px', border: '2px dashed #BA7517', background: '#FAEEDA', color: '#633806',
                  borderRadius: 16, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>🎁 ¡Ganaste un cupón!</div>
      <div style={{ fontSize: 34, fontWeight: 800, margin: '2px 0', color: '#9a3412' }}>{monto}</div>
      <div style={{ fontSize: 14 }}>de descuento en tu próximo pedido de $20 o más</div>
      <div style={{ fontSize: 12.5, marginTop: 6 }}>
        Tenés <b>{c.dias} días</b> para usarlo · vence el <b>{fecha}</b>
      </div>
      <div style={{ fontSize: 11.5, marginTop: 8, opacity: .85 }}>
        Queda guardado con tu número: no tenés que copiar ningún código.
      </div>
      <a href="/" style={{ display: 'inline-block', marginTop: 10, background: '#E63946', color: '#fff', borderRadius: 10,
                           padding: '9px 16px', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
        Pedir otra vez
      </a>
    </div>
  )
}

// Regalo de bienvenida (17-nov-2026): primer pedido → Queso Frito gratis en el
// siguiente. Antes de entregar se promete; al entregar se muestra ganado con
// la opción de que le avisemos por WhatsApp antes de que venza.
function RegaloBienvenida({ token, estado }) {
  const [r, setR] = useState(null)
  const [aviso, setAviso] = useState(true)
  useEffect(() => {
    let vivo = true
    db.rpc('regalo_de_pedido', { p_token: token })
      .then(({ data }) => { if (vivo && data) { setR(data); if (data.aviso_ok != null) setAviso(!!data.aviso_ok) } })
      .catch(() => {})
    return () => { vivo = false }
  }, [token, estado])
  if (!r) return null
  const valor = `$${Number(r.valor).toFixed(2)}`
  const img = r.imagen_url
    ? <img src={r.imagen_url} alt="" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 12, margin: '6px auto' }} />
    : <div style={{ fontSize: 46 }}>🧀</div>
  if (r.estado === 'usado_aqui') {
    return (
      <div style={{ margin: '14px 12px 4px', border: '1px solid #F09595', background: '#FCEBEB', color: '#501313',
                    borderRadius: 14, padding: 12, textAlign: 'center', fontSize: 13.5 }}>
        🎁 Tu <b>{r.nombre}</b> de regalo va en este pedido · ahorraste <b>{valor}</b> 🧀
      </div>
    )
  }
  if (r.estado === 'pendiente') {
    return (
      <div style={{ margin: '14px 12px 4px', border: '1px dashed #E63946', background: '#FCEBEB', color: '#501313',
                    borderRadius: 14, padding: 12, textAlign: 'center', fontSize: 13 }}>
        🎁 <b>¡Es tu primer pedido!</b> Cuando te llegue, te regalamos un <b>{r.nombre}</b> para tu próxima compra
        <div style={{ fontSize: 11.5, opacity: .85, marginTop: 3 }}>Válido {r.dias_validez} días en pedidos desde ${Number(r.minimo).toFixed(2)}</div>
      </div>
    )
  }
  if (r.estado !== 'ganado') return null
  const vence = new Date(r.vence_at)
  const fecha = `${vence.getDate()} de ${MESES[vence.getMonth()]}`
  const cambiarAviso = (v) => {
    setAviso(v)
    db.rpc('regalo_aviso', { p_token: token, p_ok: v }).then(() => {}, () => {})
  }
  return (
    <div style={{ margin: '14px 12px 4px', border: '2px dashed #E63946', background: '#fff', color: '#2C2C2A',
                  borderRadius: 16, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#E63946', letterSpacing: .5 }}>🎁 REGALO DE BIENVENIDA</div>
      {img}
      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.25 }}>Tu próximo {r.nombre}<br />va por nuestra cuenta</div>
      <div style={{ fontSize: 12.5, color: '#666', marginTop: 4 }}>
        Valorado en <b>{valor}</b> · en tu siguiente pedido desde ${Number(r.minimo).toFixed(2)}
      </div>
      <div style={{ display: 'inline-block', marginTop: 8, background: '#FAEEDA', color: '#633806', borderRadius: 8,
                    padding: '4px 10px', fontSize: 12.5, fontWeight: 700 }}>
        ⏳ Válido {r.dias} días · hasta el {fecha}
      </div>
      <a href="/" style={{ display: 'block', marginTop: 12, background: '#E63946', color: '#fff', borderRadius: 12,
                           padding: '12px 16px', fontWeight: 800, fontSize: 15, textDecoration: 'none' }}>
        Pedir otra vez 🍔
      </a>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, fontSize: 12.5, color: '#444', cursor: 'pointer' }}>
        <input type="checkbox" checked={aviso} onChange={e => cambiarAviso(e.target.checked)} />
        Avisame por WhatsApp antes de que venza
      </label>
      <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>Queda guardado con tu número: se agrega solito a tu próximo pedido.</div>
    </div>
  )
}

// El motorista tocó «Llegué». Suena una campana (si el navegador lo permite),
// vibra y el título de la pestaña parpadea por si la tiene en segundo plano.
function AvisoLlego({ motorista }) {
  useEffect(() => {
    const titulo = document.title
    let alterna = false
    const avisar = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        const ctx = new Ctx()
        const t = ctx.currentTime + 0.05
        ;[[1318, 0], [1046, 0.35]].forEach(([f, dt]) => {
          const o = ctx.createOscillator(), g = ctx.createGain()
          o.type = 'sine'; o.frequency.value = f
          g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.5, t + dt + 0.015)
          g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.8)
          o.connect(g).connect(ctx.destination); o.start(t + dt); o.stop(t + dt + 0.85)
        })
      } catch { /* sin audio */ }
      navigator.vibrate?.([400, 200, 400])
    }
    avisar()
    const sonido = setInterval(avisar, 20000)
    const parpadeo = setInterval(() => { alterna = !alterna; document.title = alterna ? '🔔 ¡Tu pedido llegó!' : titulo }, 1000)
    return () => { clearInterval(sonido); clearInterval(parpadeo); document.title = titulo }
  }, [])
  return (
    <div style={{ background: '#FFD900', color: '#1a1200', borderRadius: 16, padding: '18px 16px', margin: '4px 0 14px',
                  textAlign: 'center', boxShadow: '0 4px 14px rgba(0,0,0,.18)' }}>
      <div style={{ fontSize: 40 }}>🛵📍</div>
      <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>¡Tu motorista está afuera!</div>
      <div style={{ fontSize: 15, marginTop: 6, lineHeight: 1.4 }}>
        {motorista ? `${motorista} llegó` : 'Llegó'} con tu pedido. Salí a recibirlo 🙌
      </div>
    </div>
  )
}

function Marco({ children }) {
  return (
    <div className="tk-page">
      <div className="tk-wrap">
        <div className="tk-marca">Freakie Dogs</div>
        {children}
      </div>
    </div>
  )
}
