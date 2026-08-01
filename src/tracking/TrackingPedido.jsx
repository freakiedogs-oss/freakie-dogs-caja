// ────────────────────────────────────────────────────────────────────
// Tracking del pedido — pantalla que ve el cliente (Fase 6).
// Entra por /track?t=<tracking_token>. Se refresca cada 15s.
// Cuando el pedido va en camino aparece el mapa con el motorista en vivo.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { db } from '../supabase'

const MapaEnVivo = lazy(() => import('./MapaEnVivo'))
const Juego = lazy(() => import('./Juego'))

const PASOS = [
  { k: 'recibida',   ic: '📝', t: 'Pedido recibido',  sub: 'Te vamos a escribir para coordinar el pago' },
  { k: 'preparando', ic: '👨‍🍳', t: 'En cocina',        sub: 'Estamos preparando tu pedido' },
  { k: 'lista',      ic: '🎒', t: 'Listo',            sub: 'Esperando al motorista' },
  { k: 'en_camino',  ic: '🛵', t: 'En camino',        sub: 'Tu pedido va para allá' },
  { k: 'entregada',  ic: '🎉', t: 'Entregado',        sub: '¡Buen provecho!' },
]
const idxDe = (e) => Math.max(0, PASOS.findIndex(p => p.k === e))
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`

export default function TrackingPedido() {
  const [token] = useState(() => new URLSearchParams(location.search).get('t') || '')
  const juegoRef = useRef(null)
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

  return (
    <Marco>
      <div className="tk-hero">
        <div className="tk-hero-ic">{PASOS[paso].ic}</div>
        <h1 className="tk-hero-t">{PASOS[paso].t}</h1>
        <p className="tk-hero-s">{PASOS[paso].sub}</p>
        {enCamino && d.eta_min && (
          <div className="tk-eta">Llega en ~{d.eta_min} min{d.motorista ? ` · ${d.motorista} lo lleva` : ''}</div>
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
      </div>

      {/* Juego mientras espera (no cuando ya llegó) */}
      {!entregado && (
        <div ref={juegoRef}>
          <Suspense fallback={null}>
            <Juego trackingToken={token} numeroOrden={d.numero_orden} />
          </Suspense>
        </div>
      )}

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
