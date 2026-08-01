// ────────────────────────────────────────────────────────────────────
// Freakie Motorista — PWA del driver (Fase 5).
// Tabs: 📦 Pedidos (recoger/entregar) · 🧾 Historial · 📊 Métricas.
// El GPS se comparte SOLO mientras hay una entrega en curso (ahorro de
// batería) — se prende al recoger y se apaga al entregar el último.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react'
import { db } from '../supabase'

const KEY = 'freakie_driver_v1'
const HEARTBEAT_MS = 15000
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const fmtMes = (m) => { if (!m) return ''; const [y, mo] = m.split('-'); return `${MESES[+mo - 1]} ${y}` }

// ── Instalar en la pantalla de inicio ─────────────────────────────
// Android/Chrome deja abrir el diálogo del sistema (guardado en window.__instalar
// por driver.html). iPhone no tiene forma de pedirlo por código: ahí solo se
// pueden dar las instrucciones. Si ya está instalada, no se ofrece nada.
function useInstalar() {
  const yaInstalada = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
  const esIOS = typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

  const [puedeAndroid, setPuedeAndroid] = useState(() => typeof window !== 'undefined' && !!window.__instalar)
  useEffect(() => {
    const avisar = () => setPuedeAndroid(true)
    window.addEventListener('freakie:instalable', avisar)
    return () => window.removeEventListener('freakie:instalable', avisar)
  }, [])

  const instalar = async () => {
    const ev = window.__instalar
    if (!ev) return
    ev.prompt()
    await ev.userChoice
    window.__instalar = null
    setPuedeAndroid(false)
  }

  return { yaInstalada, esIOS, puedeAndroid, instalar }
}

export default function DriverBeacon() {
  const [yo, setYo] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null } })
  const [pin, setPin] = useState('')
  const [errPin, setErrPin] = useState('')
  const [entrando, setEntrando] = useState(false)
  const inst = useInstalar()
  const [tab, setTab] = useState('pedidos')
  const [pedidos, setPedidos] = useState([])
  const beacon = useBeacon(yo)

  const cargarPedidos = useCallback(async () => {
    if (!yo) return
    const { data } = await db.rpc('mis_pedidos_driver', { p_empleado_id: yo.id })
    setPedidos(data || [])
  }, [yo])

  useEffect(() => {
    if (!yo) return
    cargarPedidos()
    const t = setInterval(cargarPedidos, 20000)
    return () => clearInterval(t)
  }, [yo, cargarPedidos])

  // GPS automático: encendido mientras haya una entrega en curso
  const enRuta = pedidos.some(p => p.estado === 'en_camino')
  useEffect(() => {
    if (enRuta && !beacon.activo) beacon.iniciar()
    if (!enRuta && beacon.activo && beacon.auto) beacon.detener()
  }, [enRuta]) // eslint-disable-line react-hooks/exhaustive-deps

  const entrar = async () => {
    if (pin.length < 4 || entrando) return
    setEntrando(true); setErrPin('')
    try {
      const { data, error } = await db.rpc('driver_login', { p_pin: pin })
      if (error) throw error
      if (!data) { setErrPin('PIN incorrecto'); setPin(''); return }
      setYo(data)
      try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* noop */ }
    } catch (e) {
      setErrPin(e.message || 'No se pudo entrar'); setPin('')
    } finally { setEntrando(false) }
  }
  const cambiar = () => { beacon.detener(); setYo(null); try { localStorage.removeItem(KEY) } catch { /* noop */ } }

  if (!yo) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={S.logo}>🛵</div>
          <h1 style={S.h1}>Freakie Motorista</h1>
          <p style={S.sub}>Entrá con tu PIN.</p>
          <div style={S.puntos}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <span key={i} style={{ ...S.punto, ...(i < pin.length ? S.puntoLleno : null) }} />
            ))}
          </div>
          {errPin && <div style={S.errPin}>⚠️ {errPin}</div>}
          <div style={S.teclado}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => d === '' ? <span key={i} /> : (
              <button key={i} style={S.tecla}
                onClick={() => {
                  setErrPin('')
                  if (d === '⌫') setPin(p => p.slice(0, -1))
                  else setPin(p => (p + d).slice(0, 6))
                }}>{d}</button>
            ))}
          </div>
          <button style={{ ...S.entrarBtn, opacity: pin.length >= 4 && !entrando ? 1 : .45 }}
            disabled={pin.length < 4 || entrando} onClick={entrar}>
            {entrando ? 'Verificando…' : 'Entrar'}
          </button>

          {!inst.yaInstalada && (inst.puedeAndroid || inst.esIOS) && (
            <div style={S.instalar}>
              <div style={S.instalarTit}>📲 Tenela a mano</div>
              {inst.puedeAndroid ? (
                <>
                  <p style={S.instalarTxt}>Agregala a tu pantalla de inicio y abrila como una app, sin buscar el link.</p>
                  <button style={S.instalarBtn} onClick={inst.instalar}>Agregar a la pantalla de inicio</button>
                </>
              ) : (
                <p style={S.instalarTxt}>
                  En tu iPhone: tocá <b>Compartir</b> <span style={{ fontSize: 15 }}>􀈂</span> abajo en Safari,
                  bajá y elegí <b>“Agregar a inicio”</b>. Te queda como una app más.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={S.appPage}>
      <header style={S.header}>
        <span style={{ fontWeight: 800, color: '#E63946' }}>🛵 {yo.nombre.split(' ')[0]}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: beacon.activo ? '#4ade80' : '#666' }}>
            {beacon.activo ? '📡 En línea' : '○ Sin compartir'}
          </span>
          <button style={S.linkSm} onClick={cambiar}>Cambiar</button>
        </span>
      </header>

      <main style={S.main}>
        {tab === 'pedidos'   && <Pedidos yo={yo} pedidos={pedidos} recargar={cargarPedidos} beacon={beacon} />}
        {tab === 'historial' && <Historial yo={yo} />}
        {tab === 'metricas'  && <Metricas  yo={yo} />}
      </main>

      <nav style={S.nav}>
        {[['pedidos','📦','Pedidos'],['historial','🧾','Historial'],['metricas','📊','Métricas']].map(([k, ic, et]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.navBtn, color: tab === k ? '#E63946' : '#888' }}>
            <div style={{ fontSize: 20, position: 'relative' }}>
              {ic}
              {k === 'pedidos' && pedidos.length > 0 && <span style={S.badge}>{pedidos.length}</span>}
            </div>{et}
          </button>
        ))}
      </nav>
    </div>
  )
}

// ── Beacon de ubicación (hook compartido) ───────────────────────────
function useBeacon(yo) {
  const [activo, setActivo] = useState(false)
  const [auto, setAuto] = useState(false)
  const [ultima, setUltima] = useState(null)
  const [error, setError] = useState('')
  const watchRef = useRef(null); const hbRef = useRef(null)
  const posRef = useRef(null); const lastSentRef = useRef(0); const wakeRef = useRef(null)

  const enviar = useCallback(async () => {
    const p = posRef.current
    if (!p || !yo) return
    const ahora = Date.now()
    if (ahora - lastSentRef.current < 4000) return
    lastSentRef.current = ahora
    try {
      await db.rpc('actualizar_ubicacion_driver', {
        p_empleado_id: yo.id, p_nombre: yo.nombre, p_lat: p.lat, p_lng: p.lng,
        p_rumbo: p.heading, p_exactitud: p.accuracy,
      })
    } catch { /* reintenta en el próximo heartbeat */ }
  }, [yo])

  const iniciar = useCallback((esAuto = true) => {
    if (watchRef.current != null || !navigator.geolocation) return
    setError(''); setActivo(true); setAuto(esAuto)
    try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(w => { wakeRef.current = w }).catch(() => {}) } catch { /* noop */ }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords
        posRef.current = { lat, lng, heading: (heading != null && !Number.isNaN(heading)) ? heading : null, accuracy: accuracy ?? null }
        setUltima({ lat, lng, at: new Date() })
        enviar()
      },
      (err) => setError(err.code === 1 ? 'Permiso de ubicación denegado.' : 'No se pudo leer el GPS.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    )
    hbRef.current = setInterval(enviar, HEARTBEAT_MS)
  }, [enviar])

  const detener = useCallback(() => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
    if (hbRef.current != null) { clearInterval(hbRef.current); hbRef.current = null }
    if (wakeRef.current) { wakeRef.current.release().catch(() => {}); wakeRef.current = null }
    setActivo(false); setAuto(false)
    if (yo) db.rpc('desconectar_driver', { p_empleado_id: yo.id }).catch(() => {})
  }, [yo])

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    if (hbRef.current != null) clearInterval(hbRef.current)
    if (wakeRef.current) wakeRef.current.release().catch(() => {})
  }, [])

  return { activo, auto, ultima, error, iniciar, detener }
}

// ── 📦 Mis pedidos ──────────────────────────────────────────────────
function Pedidos({ yo, pedidos, recargar, beacon }) {
  const [ocupado, setOcupado] = useState(null)
  const [cambiarPago, setCambiarPago] = useState(null)
  const [msg, setMsg] = useState('')

  const recoger = async (p) => {
    setOcupado(p.id)
    try {
      await db.rpc('driver_marcar_recogido', { p_empleado_id: yo.id, p_delivery_id: p.id })
      beacon.iniciar()   // empieza a compartir ubicación al salir
      setMsg('🚀 ¡En camino! Estamos compartiendo tu ubicación.')
      await recargar()
    } catch (e) { setMsg('❌ ' + (e.message || 'No se pudo')) }
    finally { setOcupado(null) }
  }

  const entregar = async (p, metodo) => {
    setOcupado(p.id)
    try {
      const { data, error } = await db.rpc('driver_marcar_entregado', {
        p_empleado_id: yo.id, p_delivery_id: p.id, p_metodo_cobrado: metodo,
      })
      if (error) throw error
      setMsg(`✅ Entregado · ${data.distancia_km} km · bono ${fmt(data.bono)}`)
      setCambiarPago(null)
      await recargar()
    } catch (e) { setMsg('❌ ' + (e.message || 'No se pudo')) }
    finally { setOcupado(null) }
  }

  if (pedidos.length === 0) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>☕</div>
        <div style={S.dim}>No tenés pedidos asignados.<br />Te avisamos cuando la central te asigne uno.</div>
        {msg && <div style={{ ...S.ok, marginTop: 16 }}>{msg}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {msg && <div style={S.banner}>{msg}</div>}
      {pedidos.map(p => (
        <div key={p.id} style={S.pedidoCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 800 }}>{p.numero_orden}</span>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: p.estado === 'en_camino' ? '#f97316' : '#4ade80' }}>
              {p.estado === 'en_camino' ? '🚀 En camino' : '📦 Listo para recoger'}
            </span>
          </div>
          <div style={{ fontSize: 15, marginTop: 6 }}>{p.cliente_nombre}</div>
          <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>{p.cliente_direccion}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>🏪 {p.sucursal} · {fmt(p.total)} · {p.metodo_pago}</div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <a href={`tel:${p.cliente_telefono}`} style={{ ...S.btnSm('#333'), textDecoration: 'none' }}>📞 Llamar</a>
            {p.cliente_lat && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.cliente_lat},${p.cliente_lng}`}
                 target="_blank" rel="noopener" style={{ ...S.btnSm('#2563eb'), textDecoration: 'none' }}>🗺️ Cómo llegar</a>
            )}
          </div>

          {p.estado === 'lista' ? (
            <button disabled={ocupado === p.id} onClick={() => recoger(p)} style={{ ...S.accion('#E63946'), marginTop: 10 }}>
              {ocupado === p.id ? '…' : '📦 Ya lo recogí — salgo'}
            </button>
          ) : (
            <div style={{ marginTop: 10 }}>
              {/* El método ya viene definido desde el pedido (y confirmado por
                  la central). El motorista solo entrega; corregirlo es la
                  excepción, no el paso obligatorio. */}
              {cambiarPago === p.id ? (
                <>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>¿Con qué te pagó realmente?</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[['efectivo','💵 Efectivo'],['tarjeta','💳 Tarjeta'],['transferencia','🏦 Transfer.']].map(([m, et]) => (
                      <button key={m} disabled={ocupado === p.id} onClick={() => entregar(p, m)} style={S.accion('#16a34a', true)}>
                        {ocupado === p.id ? '…' : et}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setCambiarPago(null)} style={S.linkChico}>Cancelar</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: '#aaa', marginBottom: 8 }}>
                    Cobrar <b style={{ color: '#f0f0f0' }}>{fmt(p.total)}</b> en <b style={{ color: '#f0f0f0' }}>{p.metodo_pago || 'efectivo'}</b>
                  </div>
                  <button disabled={ocupado === p.id} onClick={() => entregar(p, p.metodo_pago || 'efectivo')}
                          style={S.accion('#16a34a')}>
                    {ocupado === p.id ? '…' : '✅ Entregado'}
                  </button>
                  <button onClick={() => setCambiarPago(p.id)} style={S.linkChico}>Me pagó de otra forma</button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#555', textAlign: 'center', marginTop: 4 }}>
        Al entregar se registra tu viaje y suma a tu bono. Después liquidás en caja.
      </div>
    </div>
  )
}

// ── 🧾 Historial ────────────────────────────────────────────────────
function Historial({ yo }) {
  const [viajes, setViajes] = useState(null)
  useEffect(() => { db.rpc('mis_viajes_driver', { p_empleado_id: yo.id }).then(({ data }) => setViajes(data || [])) }, [yo])
  if (viajes === null) return <div style={S.dim}>Cargando…</div>
  if (viajes.length === 0) return <div style={{ ...S.dim, textAlign: 'center', paddingTop: 30 }}>Todavía no tenés viajes este mes.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#888' }}>Este mes · {viajes.length} viaje(s)</div>
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

// ── 📊 Métricas ─────────────────────────────────────────────────────
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
  badge: { position: 'absolute', top: -4, right: -10, background: '#E63946', color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 999, padding: '1px 5px' },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 18, padding: '28px 22px', width: '100%', maxWidth: 380, textAlign: 'center' },
  pedidoCard: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 14, padding: 16 },
  logo: { fontSize: 54, marginBottom: 6 },
  h1: { fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#E63946' },
  sub: { fontSize: 14, color: '#aaa', margin: '0 0 16px' },
  // Entrada por PIN: teclado grande, pensado para usarse con una mano en la moto
  puntos: { display: 'flex', gap: 10, justifyContent: 'center', margin: '18px 0 6px' },
  punto: { width: 13, height: 13, borderRadius: '50%', border: '1.5px solid #444', display: 'inline-block' },
  puntoLleno: { background: '#e63946', borderColor: '#e63946' },
  errPin: { color: '#f87171', fontSize: 13, textAlign: 'center', margin: '6px 0' },
  teclado: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '14px 0' },
  tecla: { padding: '16px 0', borderRadius: 14, border: '1px solid #333', background: '#1e1e1e',
           color: '#f0f0f0', fontSize: 22, fontWeight: 600, cursor: 'pointer' },
  instalar: { marginTop: 18, padding: '12px 14px', borderRadius: 14, background: '#161616',
              border: '1px solid #2a2a2a' },
  instalarTit: { fontSize: 13, fontWeight: 700, color: '#f0f0f0', marginBottom: 4 },
  instalarTxt: { fontSize: 12.5, color: '#999', lineHeight: 1.5, margin: '0 0 10px' },
  instalarBtn: { width: '100%', padding: '11px 0', borderRadius: 12, border: '1px solid #e63946',
                 background: 'none', color: '#e63946', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' },
  entrarBtn: { width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: '#e63946',
               color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  ok: { fontSize: 14, color: '#4ade80', fontWeight: 600 },
  dim: { fontSize: 13, color: '#888', margin: '8px 0', lineHeight: 1.5 },
  banner: { background: '#1e2a1e', border: '1px solid #2f5f3f', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#a7e8bd' },
  linkSm: { background: 'none', border: 'none', color: '#888', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' },
  rowCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '12px 14px' },
  btnSm: (bg) => ({ padding: '8px 12px', borderRadius: 8, background: bg, color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-block' }),
  linkChico: { background: 'none', border: 'none', color: '#888', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', marginTop: 8, padding: 0 },
  accion: (bg, chico) => ({ padding: chico ? '11px 12px' : '14px', borderRadius: 12, background: bg, color: '#fff', border: 'none', fontSize: chico ? 13 : 15, fontWeight: 800, cursor: 'pointer', width: chico ? 'auto' : '100%', flex: chico ? 1 : 'none' }),
}
