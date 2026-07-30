// ────────────────────────────────────────────────────────────────────
// Freakie Motorista — PWA del driver.
// Tabs: 📡 Compartir ubicación · 🧾 Mi historial · 📊 Mis métricas.
// Germen de la PWA del motorista (Fase 5): luego suma PIN + pedidos
// asignados (recoger / entregar).
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { db } from '../supabase'

const KEY = 'freakie_driver_v1'
const ENVIO_MS = 8000
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const fmtMes = (m) => { if (!m) return ''; const [y, mo] = m.split('-'); return `${MESES[+mo - 1]} ${y}` }

export default function DriverBeacon() {
  const [drivers, setDrivers] = useState([])
  const [yo, setYo] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null } })
  const [tab, setTab] = useState('compartir')

  useEffect(() => { if (!yo) db.rpc('drivers_disponibles').then(({ data }) => setDrivers(data || [])) }, [yo])

  const elegir = (d) => { setYo(d); try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* noop */ } }
  const cambiar = () => { setYo(null); try { localStorage.removeItem(KEY) } catch { /* noop */ } }

  if (!yo) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={S.logo}>🛵</div>
          <h1 style={S.h1}>Freakie Motorista</h1>
          <p style={S.sub}>Elegí tu nombre para empezar.</p>
          <div style={S.lista}>
            {drivers.length === 0 && <div style={S.dim}>Cargando motoristas…</div>}
            {drivers.map(d => <button key={d.id} style={S.driverBtn} onClick={() => elegir(d)}>{d.nombre}</button>)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.appPage}>
      <header style={S.header}>
        <span style={{ fontWeight: 800, color: '#E63946' }}>🛵 {yo.nombre.split(' ')[0]}</span>
        <button style={S.linkSm} onClick={cambiar}>Cambiar</button>
      </header>

      <main style={S.main}>
        {tab === 'compartir' && <Compartir yo={yo} />}
        {tab === 'historial' && <Historial yo={yo} />}
        {tab === 'metricas'  && <Metricas  yo={yo} />}
      </main>

      <nav style={S.nav}>
        {[['compartir','📡','Compartir'],['historial','🧾','Historial'],['metricas','📊','Métricas']].map(([k, ic, et]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.navBtn, color: tab === k ? '#E63946' : '#888' }}>
            <div style={{ fontSize: 20 }}>{ic}</div>{et}
          </button>
        ))}
      </nav>
    </div>
  )
}

// ── 📡 Compartir ubicación ──────────────────────────────────────────
function Compartir({ yo }) {
  const [activo, setActivo] = useState(false)
  const [estado, setEstado] = useState('')
  const [ultima, setUltima] = useState(null)
  const [error, setError] = useState('')
  const watchRef = useRef(null)
  const posRef = useRef(null)     // última posición conocida {lat,lng,heading,accuracy}
  const hbRef = useRef(null)      // heartbeat interval
  const lastSentRef = useRef(0)
  const wakeRef = useRef(null)

  // Enviar la última posición conocida (reusado por watch + heartbeat)
  const enviar = async () => {
    const p = posRef.current
    if (!p) return
    const ahora = Date.now()
    if (ahora - lastSentRef.current < 4000) return // throttle anti-spam
    lastSentRef.current = ahora
    try {
      await db.rpc('actualizar_ubicacion_driver', {
        p_empleado_id: yo.id, p_nombre: yo.nombre, p_lat: p.lat, p_lng: p.lng,
        p_rumbo: p.heading, p_exactitud: p.accuracy,
      })
      setEstado('📡 Compartiendo tu ubicación con la central')
    } catch { setEstado('⚠️ Sin conexión — reintentando…') }
  }

  // Mantener la pantalla despierta (si no, el GPS se corta al bloquear)
  const pedirWakeLock = async () => {
    try { if ('wakeLock' in navigator) wakeRef.current = await navigator.wakeLock.request('screen') } catch { /* noop */ }
  }
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && activo && !wakeRef.current) pedirWakeLock() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [activo])

  const iniciar = () => {
    setError('')
    if (!navigator.geolocation) { setError('Tu teléfono no permite ubicación.'); return }
    setActivo(true); setEstado('Buscando señal GPS…')
    pedirWakeLock()
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords
        posRef.current = {
          lat, lng,
          heading: (heading != null && !Number.isNaN(heading)) ? heading : null,
          accuracy: accuracy ?? null,
        }
        setUltima({ lat, lng, at: new Date() })
        enviar() // enviar apenas hay señal
      },
      (err) => { setError(err.code === 1 ? 'Permiso de ubicación denegado.' : 'No se pudo leer el GPS.') },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    )
    // Heartbeat: reenvía la última posición cada 10s aunque el driver esté quieto
    // (watchPosition solo dispara al moverse → sin esto se pone "stale").
    hbRef.current = setInterval(enviar, ENVIO_MS)
  }
  const detener = () => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
    if (hbRef.current != null) { clearInterval(hbRef.current); hbRef.current = null }
    if (wakeRef.current) { wakeRef.current.release().catch(() => {}); wakeRef.current = null }
    setActivo(false); setEstado('')
    db.rpc('desconectar_driver', { p_empleado_id: yo.id }).catch(() => {})
  }
  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    if (hbRef.current != null) clearInterval(hbRef.current)
    if (wakeRef.current) wakeRef.current.release().catch(() => {})
  }, [])

  return (
    <div style={{ textAlign: 'center', paddingTop: 10 }}>
      {!activo
        ? <button style={S.mainBtn} onClick={iniciar}>▶️ Compartir mi ubicación</button>
        : <button style={{ ...S.mainBtn, background: '#444' }} onClick={detener}>⏹️ Dejar de compartir</button>}
      {estado && <div style={activo ? S.ok : S.dim}>{estado}</div>}
      {ultima && <div style={S.dim}>Última señal: {ultima.at.toLocaleTimeString('es-SV')}<br />{ultima.lat.toFixed(5)}, {ultima.lng.toFixed(5)}</div>}
      {error && <div style={S.err}>{error}</div>}
      <div style={{ fontSize: 12, color: '#555', marginTop: 20 }}>Dejá esta pantalla abierta mientras repartís.</div>
    </div>
  )
}

// ── 🧾 Mi historial ─────────────────────────────────────────────────
function Historial({ yo }) {
  const [viajes, setViajes] = useState(null)
  useEffect(() => { db.rpc('mis_viajes_driver', { p_empleado_id: yo.id }).then(({ data }) => setViajes(data || [])) }, [yo])

  if (viajes === null) return <div style={S.dim}>Cargando…</div>
  if (viajes.length === 0) return <div style={{ ...S.dim, textAlign: 'center', paddingTop: 30 }}>Todavía no tenés viajes este mes.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Este mes · {viajes.length} viaje(s)</div>
      {viajes.map(v => (
        <div key={v.id} style={S.rowCard}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {v.tipo === 'mandado' ? '📦 Mandado' : `🚗 Entrega${v.distancia_km ? ` · ${Number(v.distancia_km).toFixed(1)} km` : ''}`}
              {v.fuera_horario && <span style={{ color: '#f97316', fontSize: 11, marginLeft: 6 }}>fuera de horario</span>}
            </div>
            <div style={{ fontSize: 12, color: '#888' }}>{v.fecha}{v.descripcion ? ` · ${v.descripcion}` : ''}</div>
          </div>
          <div style={{ fontWeight: 800, color: '#4ade80' }}>{fmt(v.tarifa)}</div>
        </div>
      ))}
    </div>
  )
}

// ── 📊 Mis métricas ─────────────────────────────────────────────────
function Metricas({ yo }) {
  const [m, setM] = useState(null)
  useEffect(() => { db.rpc('mis_metricas_driver', { p_empleado_id: yo.id }).then(({ data }) => setM(data || null)) }, [yo])

  if (!m) return <div style={S.dim}>Cargando…</div>
  return (
    <div>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>{fmtMes(m.mes)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Kpi label="Viajes" val={m.viajes} color="#60a5fa" />
        <Kpi label="Kilómetros" val={`${m.km_total} km`} color="#a78bfa" />
        <Kpi label="Bono generado" val={fmt(m.bono_total)} color="#4ade80" big />
        <Kpi label="Mandados" val={m.mandados} color="#fbbf24" />
      </div>
      <div style={{ fontSize: 12, color: '#888', marginTop: 14, lineHeight: 1.6 }}>
        🚗 {m.entregas} entregas · 📦 {m.mandados} mandados · 🌙 {m.fuera_horario} fuera de horario
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 12 }}>El bono se confirma al cierre del mes por administración.</div>
    </div>
  )
}
function Kpi({ label, val, color, big }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 14, borderLeft: `3px solid ${color}`, gridColumn: big ? '1 / -1' : 'auto' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 800, marginTop: 4, color }}>{val}</div>
    </div>
  )
}

const S = {
  page: { minHeight: '100vh', background: '#111', color: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' },
  appPage: { minHeight: '100vh', background: '#111', color: '#f0f0f0', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #2a2a2a' },
  main: { flex: 1, padding: 16, overflowY: 'auto', paddingBottom: 80 },
  nav: { position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', background: '#161616', borderTop: '1px solid #2a2a2a' },
  navBtn: { flex: 1, background: 'none', border: 'none', padding: '10px 0 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 18, padding: '28px 22px', width: '100%', maxWidth: 380, textAlign: 'center' },
  logo: { fontSize: 54, marginBottom: 6 },
  h1: { fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#E63946' },
  sub: { fontSize: 14, color: '#aaa', margin: '0 0 16px' },
  lista: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', overflowY: 'auto' },
  driverBtn: { padding: '13px 14px', borderRadius: 12, border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0', fontSize: 15, fontWeight: 600, cursor: 'pointer', textAlign: 'left' },
  mainBtn: { width: '100%', maxWidth: 360, padding: '16px', borderRadius: 14, border: 'none', background: '#E63946', color: '#fff', fontSize: 17, fontWeight: 800, cursor: 'pointer', marginBottom: 14 },
  ok: { fontSize: 14, color: '#4ade80', margin: '6px 0', fontWeight: 600 },
  dim: { fontSize: 13, color: '#888', margin: '8px 0', lineHeight: 1.5 },
  err: { fontSize: 13, color: '#E63946', margin: '10px 0', fontWeight: 600 },
  linkSm: { background: 'none', border: 'none', color: '#888', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' },
  rowCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '12px 14px' },
}
