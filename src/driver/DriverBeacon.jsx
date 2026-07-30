// ────────────────────────────────────────────────────────────────────
// Freakie Motorista — beacon de ubicación en vivo.
// El driver se identifica y comparte su GPS; la torre lo ve en el mapa.
// Germen de la PWA del motorista (Fase 5): luego suma login por PIN y
// los pedidos asignados (recoger / entregar).
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { db } from '../supabase'

const KEY = 'freakie_driver_v1'
const ENVIO_MS = 8000 // manda como mucho cada 8s

export default function DriverBeacon() {
  const [drivers, setDrivers] = useState([])
  const [yo, setYo] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null } })
  const [activo, setActivo] = useState(false)
  const [estado, setEstado] = useState('') // texto de estado
  const [ultima, setUltima] = useState(null) // {lat,lng,at}
  const [error, setError] = useState('')
  const watchRef = useRef(null)
  const lastSentRef = useRef(0)

  useEffect(() => {
    db.rpc('drivers_disponibles').then(({ data }) => setDrivers(data || []))
  }, [])

  const elegir = (d) => {
    setYo(d)
    try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* noop */ }
  }
  const cambiar = () => { detener(); setYo(null); try { localStorage.removeItem(KEY) } catch { /* noop */ } }

  const iniciar = () => {
    setError('')
    if (!yo) return
    if (!navigator.geolocation) { setError('Tu teléfono no permite ubicación.'); return }
    setActivo(true)
    setEstado('Buscando señal GPS…')
    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords
        setUltima({ lat, lng, at: new Date() })
        const ahora = Date.now()
        if (ahora - lastSentRef.current < ENVIO_MS) return
        lastSentRef.current = ahora
        try {
          await db.rpc('actualizar_ubicacion_driver', {
            p_empleado_id: yo.id, p_nombre: yo.nombre,
            p_lat: lat, p_lng: lng,
            p_rumbo: (heading != null && !Number.isNaN(heading)) ? heading : null,
            p_exactitud: accuracy ?? null,
          })
          setEstado('📡 Compartiendo tu ubicación con la central')
        } catch { setEstado('⚠️ Sin conexión — reintentando…') }
      },
      (err) => {
        setActivo(false)
        setError(err.code === 1 ? 'Permiso de ubicación denegado. Activalo para compartir.' : 'No se pudo leer el GPS.')
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    )
  }

  const detener = () => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
    setActivo(false)
    setEstado('')
    if (yo) db.rpc('desconectar_driver', { p_empleado_id: yo.id }).catch(() => {})
  }

  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current) }, [])

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>🛵</div>
        <h1 style={S.h1}>Freakie Motorista</h1>

        {!yo ? (
          <>
            <p style={S.sub}>Elegí tu nombre para empezar a compartir tu ubicación.</p>
            <div style={S.lista}>
              {drivers.length === 0 && <div style={S.dim}>Cargando motoristas…</div>}
              {drivers.map(d => (
                <button key={d.id} style={S.driverBtn} onClick={() => elegir(d)}>{d.nombre}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p style={S.hola}>Hola, <b>{yo.nombre.split(' ')[0]}</b></p>

            {!activo ? (
              <button style={S.mainBtn} onClick={iniciar}>▶️ Compartir mi ubicación</button>
            ) : (
              <button style={{ ...S.mainBtn, background: '#444' }} onClick={detener}>⏹️ Dejar de compartir</button>
            )}

            {estado && <div style={activo ? S.ok : S.dim}>{estado}</div>}
            {ultima && (
              <div style={S.dim}>
                Última señal: {ultima.at.toLocaleTimeString('es-SV')}<br />
                {ultima.lat.toFixed(5)}, {ultima.lng.toFixed(5)}
              </div>
            )}
            {error && <div style={S.err}>{error}</div>}

            <button style={S.link} onClick={cambiar}>No sos vos? Cambiar de motorista</button>
          </>
        )}
      </div>
      <div style={S.foot}>Dejá esta pantalla abierta mientras repartís.</div>
    </div>
  )
}

const S = {
  page: { minHeight: '100vh', background: '#111', color: '#f0f0f0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 18, padding: '28px 22px', width: '100%', maxWidth: 380, textAlign: 'center' },
  logo: { fontSize: 54, marginBottom: 6 },
  h1: { fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#E63946' },
  sub: { fontSize: 14, color: '#aaa', margin: '0 0 16px' },
  hola: { fontSize: 17, margin: '4px 0 18px' },
  lista: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto' },
  driverBtn: { padding: '13px 14px', borderRadius: 12, border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0', fontSize: 15, fontWeight: 600, cursor: 'pointer', textAlign: 'left' },
  mainBtn: { width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: '#E63946', color: '#fff', fontSize: 17, fontWeight: 800, cursor: 'pointer', marginBottom: 14 },
  ok: { fontSize: 14, color: '#4ade80', margin: '6px 0', fontWeight: 600 },
  dim: { fontSize: 13, color: '#888', margin: '8px 0', lineHeight: 1.5 },
  err: { fontSize: 13, color: '#E63946', margin: '10px 0', fontWeight: 600 },
  link: { background: 'none', border: 'none', color: '#888', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', marginTop: 16 },
  foot: { fontSize: 12, color: '#555', marginTop: 18 },
}
