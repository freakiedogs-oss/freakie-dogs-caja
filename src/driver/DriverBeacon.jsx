// ────────────────────────────────────────────────────────────────────
// Freakie Motorista — PWA del driver (Fase 5).
// Tabs: 📦 Pedidos (recoger/entregar) · 🧾 Historial · 📊 Métricas.
// El GPS se comparte SOLO mientras hay una entrega en curso (ahorro de
// batería) — se prende al recoger y se apaga al entregar el último.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { db } from '../supabase'
import UpdateGate from '../components/layout/UpdateGate'

const KEY = 'freakie_driver_v1'
const HEARTBEAT_MS = 15000
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`
// En El Salvador las llamadas del delivery se hacen por WhatsApp. Normalizamos
// el número a formato internacional (503 + 8 dígitos) para abrir el chat.
const waHref = (tel) => {
  const d = String(tel || '').replace(/\D/g, '')
  if (d.length < 8) return null
  return `https://wa.me/${d.length === 8 ? '503' + d : d}`
}
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
  const [cobros, setCobros] = useState([])   // entregas por cuadrar (día + pendientes)
  const beacon = useBeacon(yo)
  const dispo = useDisponible(yo)
  const audioCtxRef = useRef(null)
  const prevPedIds = useRef(null)

  // Beep + vibración cuando cae un pedido nuevo. El audio se desbloquea al
  // Entrar (los navegadores móviles no dejan sonar sin un gesto previo).
  const beep = useCallback(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ctx = audioCtxRef.current || (audioCtxRef.current = new AC())
      if (ctx.state === 'suspended') ctx.resume()
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'sine'; g.gain.value = 0.18; o.connect(g); g.connect(ctx.destination)
      const t = ctx.currentTime
      o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(660, t + 0.15)
      o.start(t); o.stop(t + 0.32)
      navigator.vibrate?.([200, 80, 200])
    } catch { /* sin audio */ }
  }, [])

  const cargarPedidos = useCallback(async () => {
    if (!yo) return
    const [ped, cob] = await Promise.all([
      db.rpc('mis_pedidos_driver', { p_empleado_id: yo.id }),
      db.rpc('mis_entregas_driver', { p_empleado_id: yo.id }),
    ])
    const lista = ped.data || []
    const ids = lista.map(p => p.id)
    // Suena solo si aparece un pedido con id no visto (no en la primera carga)
    if (prevPedIds.current && ids.some(id => !prevPedIds.current.has(id))) beep()
    prevPedIds.current = new Set(ids)
    setPedidos(lista)
    setCobros(cob.data || [])
  }, [yo, beep])

  const pendientesCobro = cobros.filter(o => !o.cobrado).length

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
      setPin('')          // que no quede escrito para el próximo que abra la app
      setYo(data)
      // Desbloquear el audio ahora que hay un gesto (para que el beep suene luego)
      try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { audioCtxRef.current = audioCtxRef.current || new AC(); audioCtxRef.current.resume?.() } } catch { /* noop */ }
      try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* noop */ }
    } catch (e) {
      setErrPin(e.message || 'No se pudo entrar'); setPin('')
    } finally { setEntrando(false) }
  }
  // Salir: se apaga el GPS, se da de baja de la central y se limpia todo,
  // incluido el PIN escrito — si no, la pantalla vuelve con los puntitos
  // llenos y al tocar Entrar reingresa el mismo motorista.
  // Aviso al servidor de que termina el turno. Es sólo eso: la salida de la
  // sesión la hace el enlace de abajo, que navega aunque este código no corra.
  const avisarSalida = () => {
    try { localStorage.removeItem(KEY) } catch { /* noop */ }
    beacon.detener()
    if (yo) db.rpc('driver_disponible', { p_empleado_id: yo.id, p_activo: false }).catch(() => {})
  }

  if (!yo) {
    return (
      <UpdateGate>
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
      </UpdateGate>
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
          <a href="/manual-driver.html" target="_blank" rel="noopener" style={S.salirBtn}>📘 Manual</a>
          <a href="/driver?salir=1" onClick={avisarSalida} style={S.salirBtn}>Salir</a>
        </span>
      </header>

      <main style={S.main}>
        {tab === 'pedidos'   && <Pedidos yo={yo} pedidos={pedidos} recargar={cargarPedidos} beacon={beacon} dispo={dispo} />}
        {tab === 'cobros'    && <Cobros cobros={cobros} />}
        {tab === 'historial' && <Historial yo={yo} />}
        {tab === 'metricas'  && <Metricas  yo={yo} />}
      </main>

      <nav style={S.nav}>
        {[['pedidos','📦','Pedidos'],['cobros','💵','Cobros'],['historial','🧾','Historial'],['metricas','📊','Métricas']].map(([k, ic, et]) => {
          const n = k === 'pedidos' ? pedidos.length : k === 'cobros' ? pendientesCobro : 0;
          return (
            <button key={k} onClick={() => setTab(k)} style={{ ...S.navBtn, color: tab === k ? '#E63946' : '#888' }}>
              <div style={{ fontSize: 20, position: 'relative' }}>
                {ic}
                {n > 0 && <span style={S.badge}>{n}</span>}
              </div>{et}
            </button>
          );
        })}
      </nav>
    </div>
  )
}

// ── Beacon de ubicación (hook compartido) ───────────────────────────
// ── Disponibilidad ──────────────────────────────────────────────────
// Darse de alta NO comparte ubicación: solo le avisa a la central que está
// de turno. Un latido cada 5 min mantiene el alta viva (la central descarta
// a quien no dio señales en 30 min), y no cuesta batería ni datos apreciables.
const LATIDO_MS = 5 * 60 * 1000

function useDisponible(yo) {
  const [disponible, setDisponible] = useState(false)
  const [almorzando, setAlmorzando] = useState(false)
  const [info, setInfo] = useState(null)   // sucursal, distancia y atraso al marcarse
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const latidoRef = useRef(null)

  // Una sola lectura del GPS, no un rastreo: solo para comprobar que está en
  // la sucursal. Se pide desde el toque del botón, que es cuando el navegador
  // permite mostrar el pedido de permiso.
  const dondeEstoy = () => new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Tu teléfono no comparte ubicación.'))
    navigator.geolocation.getCurrentPosition(
      (pos) => res({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => rej(new Error(err.code === 1
        ? 'Necesitamos tu ubicación para marcarte de turno. Activala y volvé a intentar.'
        : 'No pudimos leer tu ubicación. Salí al aire libre y probá de nuevo.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  })

  const marcar = useCallback(async (activo) => {
    if (!yo || ocupado) return
    setOcupado(true); setError('')
    try {
      let donde = null
      try { donde = await dondeEstoy() } catch (e) { if (activo) throw e }

      const { data, error: e } = await db.rpc('driver_disponible', {
        p_empleado_id: yo.id, p_nombre: yo.nombre, p_activo: activo,
        p_lat: donde?.lat ?? null, p_lng: donde?.lng ?? null,
      })
      if (e) throw e
      setDisponible(activo)
      setInfo(activo ? data : null)

      if (latidoRef.current) { clearInterval(latidoRef.current); latidoRef.current = null }
      if (activo) {
        // El latido mantiene el alta viva. No vuelve a pedir GPS: la sucursal
        // ya quedó comprobada al marcarse.
        latidoRef.current = setInterval(() => {
          db.rpc('driver_disponible', {
            p_empleado_id: yo.id, p_nombre: yo.nombre, p_activo: true,
            p_lat: donde?.lat ?? null, p_lng: donde?.lng ?? null,
          }).catch(() => {})
        }, LATIDO_MS)
      }
    } catch (e) { setError(e.message || 'No se pudo avisar a la central') }
    finally { setOcupado(false) }
  }, [yo, ocupado])

  // El turno vive en el servidor, no en esta pantalla: al abrir la app hay
  // que preguntarlo. Si no, recargar mostraba 'No estás de turno' aunque la
  // central lo estuviera viendo en línea.
  useEffect(() => {
    if (!yo) return
    let vivo = true
    db.rpc('driver_estado_turno', { p_empleado_id: yo.id }).then(({ data }) => {
      if (!vivo || !data?.disponible) return
      setDisponible(true)
      setAlmorzando(!!data?.almorzando)
      if (!latidoRef.current) {
        latidoRef.current = setInterval(() => {
          db.rpc('driver_disponible', { p_empleado_id: yo.id, p_nombre: yo.nombre, p_activo: true })
            .catch(() => {})
        }, LATIDO_MS)
      }
    })
    return () => { vivo = false }
  }, [yo])

  useEffect(() => () => { if (latidoRef.current) clearInterval(latidoRef.current) }, [])

  // Los navegadores móviles CONGELAN el setInterval del latido cuando la app
  // queda en segundo plano (pantalla bloqueada) → a los 30 min sin señal la
  // central da de baja el turno ("se desconecta después de un rato"). Al volver
  // a primer plano re-marcamos de una para recuperar el turno enseguida.
  useEffect(() => {
    if (!yo) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !disponible) return
      db.rpc('driver_disponible', { p_empleado_id: yo.id, p_nombre: yo.nombre, p_activo: true }).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [yo, disponible])

  // Almuerzo: sigue de turno (asignable); Kari lo ve "Almorzando". Vuelve con el
  // botón o al empezar una ruta (ahí el server cierra el almuerzo solo).
  const almorzar = useCallback(async () => {
    if (!yo || ocupado) return
    setOcupado(true); setError('')
    try {
      const { error: e } = await db.rpc('driver_almorzar', { p_empleado_id: yo.id })
      if (e) throw e
      setAlmorzando(true)
    } catch (e) { setError(e.message || 'No se pudo marcar el almuerzo') }
    finally { setOcupado(false) }
  }, [yo, ocupado])

  const finAlmuerzo = useCallback(async () => {
    if (!yo || ocupado) return
    setOcupado(true); setError('')
    try {
      const { error: e } = await db.rpc('driver_fin_almuerzo', { p_empleado_id: yo.id })
      if (e) throw e
      setAlmorzando(false)
    } catch (e) { setError(e.message || 'No se pudo cerrar el almuerzo') }
    finally { setOcupado(false) }
  }, [yo, ocupado])

  return { disponible, almorzando, ocupado, error, info, marcar, almorzar, finAlmuerzo }
}

function useBeacon(yo) {
  const [activo, setActivo] = useState(false)
  const [auto, setAuto] = useState(false)
  const [ultima, setUltima] = useState(null)
  const [error, setError] = useState('')
  const watchRef = useRef(null); const hbRef = useRef(null)
  const posRef = useRef(null); const lastSentRef = useRef(0); const wakeRef = useRef(null)
  const nativeRef = useRef(false)
  const nativeGps = () => { try { return !!(window.AndroidPrinter && window.AndroidPrinter.hasLocationNative && window.AndroidPrinter.hasLocationNative()) } catch { return false } }

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
    if (nativeRef.current || watchRef.current != null) return
    // APK nativo (sabor driver → GPS en segundo plano, tipo 'delivery')
    if (nativeGps() && yo) {
      try {
        window.AndroidPrinter.startLocation(String(yo.id), yo.nombre || 'Motorista', 'delivery')
        nativeRef.current = true; setError(''); setActivo(true); setAuto(esAuto); return
      } catch { /* cae a web */ }
    }
    if (!navigator.geolocation) return
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
    if (nativeRef.current) { try { window.AndroidPrinter.stopLocation() } catch { /* noop */ } nativeRef.current = false }
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
function Pedidos({ yo, pedidos, recargar, beacon, dispo }) {
  const [ocupado, setOcupado] = useState(null)
  const [cambiarPago, setCambiarPago] = useState(null)
  const [devolviendo, setDevolviendo] = useState(null)
  const [confirmando, setConfirmando] = useState(null)   // evita marcar Entregado por accidente
  const [msg, setMsg] = useState('')

  // Con varios pedidos a la vez, marcar uno por uno es tedioso y se presta a
  // que salgan a la calle con alguno sin marcar.
  const recogerTodos = async () => {
    const listos = pedidos.filter(x => x.estado === 'lista')
    if (!listos.length) return
    setOcupado('todos')
    try {
      for (const x of listos) {
        await db.rpc('driver_marcar_recogido', { p_empleado_id: yo.id, p_delivery_id: x.id })
      }
      beacon.iniciar()
      setMsg(`🚀 Saliste con ${listos.length} pedidos. Estamos compartiendo tu ubicación.`)
      await recargar()
    } catch (e) { setMsg('❌ ' + (e.message || 'No se pudo')) }
    finally { setOcupado(null) }
  }

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

  const MOTIVOS = [
    'Se me descompuso la moto',
    'No encontré la dirección',
    'El cliente no contesta',
    'El cliente ya no lo quiere',
    'Otro',
  ]

  const devolver = async (p, motivo) => {
    setOcupado(p.id)
    try {
      const { error } = await db.rpc('driver_devolver_pedido', {
        p_empleado_id: yo.id, p_delivery_id: p.id, p_motivo: motivo, p_detalle: null,
      })
      if (error) throw error
      setMsg(`↩️ ${p.numero_orden} devuelto a la sucursal. La central lo va a reasignar.`)
      setDevolviendo(null)
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

  // Darse de alta no comparte ubicación: solo le dice a la central que está de
  // turno. El GPS arranca solo, al marcar que salió con un pedido.
  const Disponibilidad = () => (
    <div style={{ ...S.dispo, borderColor: dispo.disponible ? '#2f5f3f' : '#3a2a2a' }}>
      <div style={S.dispoFila}>
        <span style={{ fontSize: 26 }}>{dispo.almorzando ? '🍽️' : dispo.disponible ? '🟢' : '⚪'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: dispo.almorzando ? '#fbbf24' : dispo.disponible ? '#4ade80' : '#f0f0f0' }}>
            {dispo.almorzando ? 'Almorzando' : dispo.disponible ? 'Estás de turno' : 'No estás de turno'}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2, lineHeight: 1.4 }}>
            {dispo.almorzando
              ? 'Seguís disponible — la central puede asignarte para que salgas al terminar.'
              : dispo.disponible
              ? (dispo.info?.sucursal
                  ? `Marcaste entrada en ${dispo.info.sucursal}. La central te puede asignar pedidos.`
                  : 'La central te puede asignar pedidos.')
              : 'Tenés que estar en tu sucursal para marcarte de turno.'}
          </div>
        </div>
      </div>

      <button onClick={() => dispo.marcar(!dispo.disponible)} disabled={dispo.ocupado}
        style={{ ...S.dispoBtn,
                 background: dispo.disponible ? 'none' : '#16a34a',
                 border: dispo.disponible ? '1px solid #444' : 'none',
                 color: dispo.disponible ? '#aaa' : '#fff',
                 opacity: dispo.ocupado ? .6 : 1 }}>
        {dispo.ocupado ? '📍 Verificando dónde estás…' : dispo.disponible ? 'Terminé mi turno' : '🟢 Estoy de turno'}
      </button>

      {/* Almuerzo: seguís de turno; al volver o al salir con un pedido se cierra solo */}
      {dispo.disponible && (
        dispo.almorzando ? (
          <button onClick={dispo.finAlmuerzo} disabled={dispo.ocupado}
            style={{ ...S.dispoBtn, marginTop: 8, background: '#b45309', border: 'none', color: '#fff' }}>
            🍽️ Terminé de almorzar
          </button>
        ) : (
          <button onClick={dispo.almorzar} disabled={dispo.ocupado}
            style={{ ...S.dispoBtn, marginTop: 8, background: 'none', border: '1px solid #b45309', color: '#fbbf24' }}>
            🍽️ Salir a almorzar
          </button>
        )
      )}

      {dispo.error && <div style={S.dispoErr}>⚠️ {dispo.error}</div>}

      {dispo.disponible && dispo.info?.minutos_tarde > 0 && (
        <div style={S.tarde}>
          ⏰ Marcaste {dispo.info.minutos_tarde} min después de tu hora de entrada.
        </div>
      )}

      <div style={S.dispoPie}>
        {beacon.activo
          ? '📡 Compartiendo tu ubicación porque vas en camino con un pedido.'
          : 'Usamos tu ubicación una sola vez, para confirmar que estás en la sucursal. Después no se comparte hasta que salgas con un pedido.'}
      </div>
    </div>
  )

  if (pedidos.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Disponibilidad />
        <div style={{ textAlign: 'center', paddingTop: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>☕</div>
          <div style={S.dim}>No tenés pedidos asignados.<br />Te avisamos cuando la central te asigne uno.</div>
        </div>
        {msg && <div style={{ ...S.ok, marginTop: 4 }}>{msg}</div>}
      </div>
    )
  }

  const listos = pedidos.filter(x => x.estado === 'lista').length
  const rodando = pedidos.filter(x => x.estado === 'en_camino').length
  const cocinando = pedidos.filter(x => !['lista', 'en_camino'].includes(x.estado)).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Disponibilidad />
      {msg && <div style={S.banner}>{msg}</div>}

      {pedidos.length > 1 && (
        <div style={S.resumen}>
          <div style={S.resumenT}>
            Tenés {pedidos.length} pedidos
          </div>
          <div style={S.resumenS}>
            {[rodando && `${rodando} en ruta`, listos && `${listos} por recoger`,
              cocinando && `${cocinando} todavía en cocina`].filter(Boolean).join(' · ')}
          </div>
          {listos > 1 && (
            <button disabled={ocupado === 'todos'} onClick={recogerTodos} style={S.resumenBtn}>
              {ocupado === 'todos' ? 'Marcando…' : `📦 Salgo con los ${listos}`}
            </button>
          )}
        </div>
      )}
      {pedidos.map(p => (
        <div key={p.id} style={S.pedidoCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 800 }}>{p.numero_orden}</span>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                           color: p.estado === 'en_camino' ? '#f97316'
                                : p.estado === 'lista' ? '#4ade80' : '#8b807a' }}>
              {p.estado === 'en_camino' ? '🚀 En camino'
                : p.estado === 'lista' ? '📦 Listo para recoger'
                : '⏳ Todavía en cocina'}
            </span>
          </div>
          <div style={{ fontSize: 15, marginTop: 6 }}>{p.cliente_nombre}</div>
          <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>{p.cliente_direccion}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>🏪 {p.sucursal} · {fmt(p.total)} · {p.metodo_pago}</div>
          {/efectivo/i.test(p.metodo_pago || '') && p.paga_con > 0 && (
            <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 700, marginTop: 4 }}>
              💵 Paga con {fmt(p.paga_con)} → llevá cambio <b>{fmt(Math.max(0, p.paga_con - p.total))}</b>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {waHref(p.cliente_telefono) && (
              <a href={waHref(p.cliente_telefono)} target="_blank" rel="noopener"
                 style={{ ...S.btnSm('#25D366'), textDecoration: 'none', color: '#04220f' }}>💬 WhatsApp</a>
            )}
            <a href={`tel:${p.cliente_telefono}`} style={{ ...S.btnSm('#333'), textDecoration: 'none' }}
               title="Llamada normal">📞</a>
            {/* Muchos clientes no dan permiso de ubicación y solo escriben la
                dirección. Antes ahí no salía ningún botón; ahora se busca por
                texto, que es lo que haría el motorista a mano. */}
            {(p.cliente_lat || p.cliente_direccion) && (
              <a href={p.cliente_lat
                    ? `https://waze.com/ul?ll=${p.cliente_lat},${p.cliente_lng}&navigate=yes`
                    : `https://waze.com/ul?q=${encodeURIComponent(
                        String(p.cliente_direccion).replace(/^\[[^\]]*\]\s*/, '') + ', El Salvador')}&navigate=yes`}
                 target="_blank" rel="noopener" style={{ ...S.btnSm('#33ccff'), textDecoration: 'none', color: '#04212b' }}>
                {p.cliente_lat ? '🧭 Waze' : '🧭 Waze (buscar)'}
              </a>
            )}
            {p.cliente_lat && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.cliente_lat},${p.cliente_lng}`}
                 target="_blank" rel="noopener" style={{ ...S.btnSm('#2563eb'), textDecoration: 'none' }}>
                🗺️ Maps
              </a>
            )}
            {!p.cliente_lat && (
              <span style={S.sinGps}>Sin ubicación exacta — confirmá por teléfono</span>
            )}
          </div>

          {p.estado !== 'lista' && p.estado !== 'en_camino' ? (
            <div style={S.esperando}>
              Este ya es tuyo. Te avisamos apenas cocina lo termine.
            </div>
          ) : p.estado === 'lista' ? (
            <button disabled={ocupado === p.id} onClick={() => recoger(p)} style={{ ...S.accion('#E63946'), marginTop: 10 }}>
              {ocupado === p.id ? '…' : '📦 Ya lo recogí — salgo'}
            </button>
          ) : (
            <div style={{ marginTop: 10 }}>
              {/* El método ya viene definido desde el pedido (y confirmado por
                  la central). El motorista solo entrega; corregirlo es la
                  excepción, no el paso obligatorio. */}
              {devolviendo === p.id ? (
                <>
                  <div style={{ fontSize: 12.5, color: '#f0f0f0', marginBottom: 3, fontWeight: 700 }}>
                    ¿Qué pasó?
                  </div>
                  <div style={{ fontSize: 11.5, color: '#8b807a', marginBottom: 9, lineHeight: 1.45 }}>
                    El pedido vuelve a la sucursal y la central se lo pasa a otro.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {MOTIVOS.map(m => (
                      <button key={m} disabled={ocupado === p.id} onClick={() => devolver(p, m)}
                              style={S.motivo}>{ocupado === p.id ? '…' : m}</button>
                    ))}
                  </div>
                  <button onClick={() => setDevolviendo(null)} style={S.linkChico}>Cancelar</button>
                </>
              ) : cambiarPago === p.id ? (
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
              ) : confirmando === p.id ? (
                <>
                  <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 700, marginBottom: 8 }}>
                    ¿Confirmás la entrega de {p.numero_orden}?
                  </div>
                  <button disabled={ocupado === p.id}
                          onClick={() => { setConfirmando(null); entregar(p, p.metodo_pago || 'efectivo') }}
                          style={S.accion('#16a34a')}>
                    {ocupado === p.id ? '…' : '✅ Sí, entregado'}
                  </button>
                  <button onClick={() => setConfirmando(null)} style={S.linkChico}>No, volver</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: '#aaa', marginBottom: 8 }}>
                    Cobrar <b style={{ color: '#f0f0f0' }}>{fmt(p.total)}</b> en <b style={{ color: '#f0f0f0' }}>{p.metodo_pago || 'efectivo'}</b>
                  </div>
                  <button disabled={ocupado === p.id} onClick={() => setConfirmando(p.id)}
                          style={S.accion('#16a34a')}>
                    {ocupado === p.id ? '…' : '✅ Entregado'}
                  </button>
                  <button onClick={() => setCambiarPago(p.id)} style={S.linkChico}>Me pagó de otra forma</button>
                  <button onClick={() => setDevolviendo(p.id)} style={S.linkChico}>↩️ No lo pude entregar</button>
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

// ── 💵 Cobros ───────────────────────────────────────────────────────
// Conciliación de dinero: lo mismo que ve la caja por cada entrega (cliente,
// monto, método) y su estado. Se marca ✅ Pagado solo cuando la cajera cierra
// la orden en caja, así el motorista sabe cuáles todavía debe cuadrar.
function CobroCard({ o }) {
  return (
    <div style={{ ...S.rowCard, alignItems: 'flex-start', gap: 10,
                  borderLeft: `3px solid ${o.cobrado ? '#4ade80' : '#fbbf24'}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{o.cliente_nombre || 'Cliente'}</div>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 1 }}>
          {o.numero_orden} · {o.metodo_pago || '—'}{o.store_code ? ` · ${o.store_code}` : ''}
        </div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
          Entregado {o.entregado_at}{o.cobrado && o.cobrado_at ? ` · cerrado ${o.cobrado_at}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(o.total)}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: o.cobrado ? '#4ade80' : '#fbbf24' }}>
          {o.cobrado ? '✅ Pagado' : '⏳ Pendiente'}
        </div>
      </div>
    </div>
  )
}

function Cobros({ cobros }) {
  const pendientes = cobros.filter(o => !o.cobrado)
  const pagadas    = cobros.filter(o => o.cobrado)
  const efectivoPend = pendientes
    .filter(o => /efectivo/i.test(o.metodo_pago || ''))
    .reduce((s, o) => s + Number(o.total || 0), 0)

  if (cobros.length === 0) {
    return <div style={{ ...S.dim, textAlign: 'center', paddingTop: 30 }}>
      No tenés entregas para cuadrar. Acá aparecen tus entregas del día y las que falten cerrar en caja.
    </div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Resumen: lo que falta cuadrar */}
      <div style={{ background: pendientes.length ? '#2a2410' : '#122a19',
                    border: `1px solid ${pendientes.length ? '#fbbf24' : '#4ade80'}`,
                    borderRadius: 12, padding: 12 }}>
        {pendientes.length ? (
          <>
            <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 800 }}>
              ⏳ {pendientes.length} entrega(s) sin cerrar en caja
            </div>
            <div style={{ fontSize: 12, color: '#ccc', marginTop: 3 }}>
              Efectivo por entregar: <b style={{ color: '#fff' }}>{fmt(efectivoPend)}</b>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#4ade80', fontWeight: 800 }}>✅ Todo cuadrado</div>
        )}
      </div>

      {pendientes.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Pendientes de cerrar en caja</div>
          {pendientes.map(o => <CobroCard key={o.id} o={o} />)}
        </>
      )}

      {pagadas.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>Pagadas hoy</div>
          {pagadas.map(o => <CobroCard key={o.id} o={o} />)}
        </>
      )}

      <div style={{ fontSize: 11, color: '#555', textAlign: 'center', marginTop: 6 }}>
        Cada entrega pasa a ✅ Pagado cuando la cajera cierra la orden en caja.
      </div>
    </div>
  )
}

// ── 🧾 Historial ────────────────────────────────────────────────────
function Historial({ yo }) {
  const [viajes, setViajes] = useState(null)
  const [ruta, setRuta] = useState(null)   // viaje cuya ruta se está mostrando
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
            {v.cliente && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>👤 {v.cliente}{v.orden ? ` · ${v.orden}` : ''}</div>}
            {v.direccion && <div style={{ fontSize: 11.5, color: '#777', marginTop: 1 }}>📍 {String(v.direccion).replace(/^\[[^\]]*\]\s*/, '')}</div>}
            {(v.asignado || v.entregado) && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
                🕐 {v.asignado ? `asignado ${v.asignado}` : ''}{v.asignado && v.entregado ? ' → ' : ''}{v.entregado ? `entregado ${v.entregado}` : ''}
              </div>
            )}
            {v.lat && (
              <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center' }}>
                <a href={`https://waze.com/ul?ll=${v.lat},${v.lng}&navigate=yes`} target="_blank" rel="noopener"
                   style={{ fontSize: 11, color: '#33ccff', textDecoration: 'none' }}>🧭 Waze</a>
                <button onClick={() => setRuta(v)}
                   style={{ fontSize: 11, color: '#a78bfa', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>🗺️ Ver ruta</button>
              </div>
            )}
          </div>
          <div style={{ fontWeight: 800, color: '#4ade80' }}>{fmt(v.tarifa)}</div>
        </div>
      ))}
      {ruta && <RutaModal yo={yo} viaje={ruta} onClose={() => setRuta(null)} />}
    </div>
  )
}

// ── 🗺️ Ruta real de un viaje ────────────────────────────────────────
// Mapa Leaflet + OpenStreetMap (sin API key). Dibuja el origen (sucursal),
// el destino (cliente) y el rastro GPS grabado durante la entrega. Si el
// viaje es anterior a que se activara la grabación, no hay rastro: se
// muestra una línea recta punteada origen→destino y se avisa.
function RutaModal({ yo, viaje, onClose }) {
  const mapEl = useRef(null); const mapRef = useRef(null)
  const [estado, setEstado] = useState('cargando') // cargando | ok | sin_rastro | error
  const [meta, setMeta] = useState(null)

  useEffect(() => {
    let cancel = false
    db.rpc('viaje_ruta_driver', { p_empleado_id: yo.id, p_viaje_id: viaje.id }).then(({ data, error }) => {
      if (cancel) return
      if (error || !data) { setEstado('error'); return }
      setMeta(data)
      const org = data.origen, dst = data.destino, pts = data.puntos || []
      if (!mapEl.current) return
      const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
      const bounds = []
      if (org?.lat != null) {
        L.circleMarker([org.lat, org.lng], { radius: 8, color: '#4ade80', fillColor: '#4ade80', fillOpacity: 1, weight: 2 })
          .addTo(map).bindTooltip('🏪 ' + (org.nombre || 'Sucursal'))
        bounds.push([org.lat, org.lng])
      }
      if (dst?.lat != null) {
        L.circleMarker([dst.lat, dst.lng], { radius: 8, color: '#e63946', fillColor: '#e63946', fillOpacity: 1, weight: 2 })
          .addTo(map).bindTooltip('📍 ' + (dst.direccion || 'Cliente'))
        bounds.push([dst.lat, dst.lng])
      }
      if (pts.length >= 2) {
        const ll = pts.map(p => [p.lat, p.lng])
        L.polyline(ll, { color: '#33ccff', weight: 4, opacity: 0.9 }).addTo(map)
        ll.forEach(x => bounds.push(x))
        setEstado('ok')
      } else {
        if (org?.lat != null && dst?.lat != null) {
          L.polyline([[org.lat, org.lng], [dst.lat, dst.lng]], { color: '#888', weight: 3, dashArray: '6 8' }).addTo(map)
        }
        setEstado('sin_rastro')
      }
      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
      else map.setView([13.7, -89.2], 12)
      setTimeout(() => map.invalidateSize(), 120)
    })
    return () => { cancel = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [yo, viaje])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#161616', width: '100%', maxWidth: 520,
            borderRadius: '18px 18px 0 0', overflow: 'hidden', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>🗺️ Ruta del viaje</div>
            <div style={{ fontSize: 11.5, color: '#888' }}>
              {viaje.fecha}{meta?.orden ? ` · ${meta.orden}` : ''}
              {meta?.recogido ? ` · salió ${meta.recogido}` : ''}{meta?.entregado ? ` → entregó ${meta.entregado}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #333', color: '#aaa', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>✕</button>
        </div>
        <div ref={mapEl} style={{ height: '58vh', width: '100%', background: '#222' }} />
        <div style={{ padding: '10px 16px', fontSize: 11.5, color: '#888', borderTop: '1px solid #2a2a2a' }}>
          {estado === 'cargando' && 'Cargando ruta…'}
          {estado === 'error' && '❌ No se pudo cargar la ruta.'}
          {estado === 'ok' && <span>🟢 Sucursal · 🔵 recorrido real ({(meta?.puntos || []).length} puntos) · 🔴 cliente{meta?.distancia_km ? ` · ${Number(meta.distancia_km).toFixed(1)} km` : ''}</span>}
          {estado === 'sin_rastro' && '⚠️ Sin rastro GPS de este viaje (anterior a la grabación de rutas). La línea punteada es solo referencia sucursal→cliente.'}
        </div>
      </div>
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
      {/* Desglose del bono por tipo de viaje — para que el driver corrobore de dónde sale */}
      <div style={{ fontSize: 12, color: '#888', margin: '18px 0 8px', fontWeight: 700 }}>De dónde sale tu bono</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(m.desglose || []).map(d => {
          const emoji = { normal: '🛵', larga: '🛣️', fuera: '🌙', mandado: '📦' }[d.key] || '•'
          const activo = d.cantidad > 0
          return (
            <div key={d.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '10px 14px',
                    opacity: activo ? 1 : 0.5 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{emoji} {d.label}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{d.cantidad} × {fmt(d.tarifa)}</div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#4ade80' }}>{fmt(d.bono)}</div>
            </div>
          )
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid #2a2a2a', marginTop: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>TOTAL</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#4ade80' }}>{fmt(m.bono_total)}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
        "Entregas largas" = {m.umbral_km} km o más. El bono se confirma al cierre del mes por administración.
      </div>
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
  sinGps: { fontSize: 11.5, color: '#fbbf24', alignSelf: 'center' },
  motivo: { width: '100%', padding: '11px 12px', borderRadius: 10, textAlign: 'left',
            border: '1px solid #3a3230', background: '#1e1a19', color: '#e8e2df',
            fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  resumenS: { fontSize: 12.5, color: '#a99f99', marginTop: 3 },
  esperando: { marginTop: 10, padding: '11px 12px', borderRadius: 10, background: '#1e1a19',
               border: '1px dashed #3a3230', color: '#8b807a', fontSize: 12.5,
               textAlign: 'center', lineHeight: 1.45 },
  resumen: { background: '#1c1512', border: '1px solid #3a2a22', borderRadius: 14, padding: '13px 14px' },
  resumenT: { fontSize: 14, fontWeight: 700, color: '#fbbf24' },
  resumenBtn: { width: '100%', marginTop: 10, padding: '12px 0', borderRadius: 12, border: 'none',
                background: '#E63946', color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: 'pointer' },
  dispo: { padding: '14px', borderRadius: 14, background: '#161616', border: '1px solid #3a2a2a' },
  dispoFila: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 },
  dispoBtn: { width: '100%', padding: '13px 0', borderRadius: 12, fontSize: 14.5,
              fontWeight: 700, cursor: 'pointer' },
  tarde: { fontSize: 12, color: '#fbbf24', background: '#2a2416', border: '1px solid #4a3f1a',
           borderRadius: 9, padding: '8px 10px', marginTop: 8, lineHeight: 1.4 },
  dispoErr: { fontSize: 12, color: '#f87171', marginTop: 8 },
  dispoPie: { fontSize: 11.5, color: '#777', marginTop: 10, lineHeight: 1.45, textAlign: 'center' },
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
  salirBtn: { background: 'none', border: '1px solid #333', color: '#aaa', fontSize: 12,
              fontWeight: 600, padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
              flexShrink: 0, textDecoration: 'none', display: 'inline-block' },
  linkSm: { background: 'none', border: 'none', color: '#888', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' },
  rowCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '12px 14px' },
  btnSm: (bg) => ({ padding: '8px 12px', borderRadius: 8, background: bg, color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-block' }),
  linkChico: { background: 'none', border: 'none', color: '#888', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', marginTop: 8, padding: 0 },
  accion: (bg, chico) => ({ padding: chico ? '11px 12px' : '14px', borderRadius: 12, background: bg, color: '#fff', border: 'none', fontSize: chico ? 13 : 15, fontWeight: 800, cursor: 'pointer', width: chico ? 'auto' : '100%', flex: chico ? 1 : 'none' }),
}
