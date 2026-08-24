// Porcionador de papas — Rhino BAR-6X
// Estación fija Metrocentro S006 · PIN 3006
// Autor: integración ERP Freakie Dogs (v1, agosto 2026)
import { useEffect, useRef, useState } from 'react'
import { db, URL_SB_DIRECT, KEY_SB } from '../supabase'
import { requestCh340Port } from './ch340-webusb'

const STATION_ID = 'papas-s006'
const STORE_CODE = 'S006'
const APP_VERSION = 'erp-2-webusb'

// Android casi nunca expone el CH340 por Web Serial, aunque la propiedad
// navigator.serial exista. Por eso se decide por el sistema operativo ANTES
// de mirar qué APIs hay: en Android siempre WebUSB, en escritorio Web Serial.
const ES_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const TOKEN_KEY = 'porcionador_token'
const NOMBRE_KEY = 'porcionador_nombre'
const QUEUE_KEY = 'porcionador_cola_pendiente'

const SERIAL_CONFIG = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }

// ── Parser de peso (idéntico al de la app v11) ────────────────
function parseWeight(line) {
  const m = line.replace(/,/g, '.').match(/(-?\d+(?:\.\d+)?)\s*(kg|g|lb)s?/i)
  if (!m) return null
  const v = Number(m[1])
  const u = m[2].toLowerCase()
  if (!Number.isFinite(v)) return null
  if (u === 'kg') return Math.round(v * 1000)
  if (u === 'lb') return Math.round(v * 453.59237)
  return Math.round(v)
}

// ── Sonido de aprobación ──────────────────────────────────────
function beepOk(ctx) {
  if (!ctx) return
  try { ctx.resume() } catch {}
  const master = ctx.createGain(); master.gain.value = 1.2
  master.connect(ctx.destination)
  ;[659, 784, 988].forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain()
    const t0 = ctx.currentTime + i * 0.13
    o.type = 'triangle'; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42)
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + 0.44)
  })
}

// ── Cola offline con localStorage (simple; migrar a IndexedDB fase 2) ─
function guardarPendiente(payload) {
  const cola = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  cola.push({ payload, attempts: 0, addedAt: Date.now() })
  localStorage.setItem(QUEUE_KEY, JSON.stringify(cola))
}
function pendientes() { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') }
function quitarPendiente(eventId) {
  const cola = pendientes().filter(x => x.payload.event.event_id !== eventId)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(cola))
}

// ── POST a la edge function ───────────────────────────────────
async function enviarEvento(token, event) {
  const r = await fetch(`${URL_SB_DIRECT}/functions/v1/porcion-papa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, event })
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || (!d.ok && !d.duplicate)) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

// ── Contar porciones de papa pendientes en el KDS de la sucursal ──
async function contarPendientesKDS(storeCode) {
  const { count, error } = await db
    .from('pos_cuenta_items')
    .select('id, pos_cuentas!inner(store_code, estado)', { count: 'exact', head: true })
    .eq('pos_cuentas.store_code', storeCode)
    .in('pos_cuentas.estado', ['enviada_cocina', 'preparando'])
  if (error) return 0
  return count || 0
}

// ══════════════════════════════════════════════════════════════
export default function PorcionadorApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [nombre, setNombre] = useState(() => localStorage.getItem(NOMBRE_KEY) || '')
  const [pin, setPin] = useState('')
  const [loginMsg, setLoginMsg] = useState('')

  const [config, setConfig] = useState(null)         // rangos de la estación
  const [connection, setConnection] = useState('idle')
  const [connMsg, setConnMsg] = useState('Conectá la báscula para empezar')
  const [grams, setGrams] = useState(0)
  const [stable, setStable] = useState(false)
  const [completed, setCompleted] = useState(0)
  const [lastPortion, setLastPortion] = useState(null)
  const [diag, setDiag] = useState('Sin datos aún')
  const [pendientesCount, setPendientesCount] = useState(pendientes().length)
  const [kdsPendientes, setKdsPendientes] = useState(0)

  const portRef = useRef(null)
  const readerRef = useRef(null)
  const writerRef = useRef(null)
  const pollRef = useRef(null)
  const runRef = useRef(false)
  const sendingRef = useRef(false)
  const bufferRef = useRef('')
  const readingsRef = useRef([])
  const acceptedRef = useRef(false)
  const zeroReadingsRef = useRef(0)
  const responseCountRef = useRef(0)
  const audioRef = useRef(null)

  const CFG = config || { min_g: 150, target_g: 155, max_g: 160, empty_max_g: 4, stability_window_ms: 1100, stability_min_readings: 4, stability_max_spread_g: 2, poll_interval_ms: 250 }

  // ── Cargar config de la estación al montar ─────────────────
  useEffect(() => {
    if (!token) return
    fetch(`${URL_SB_DIRECT}/functions/v1/porcion-papa?station_id=${STATION_ID}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setConfig(d.config) })
      .catch(() => {})
  }, [token])

  // ── Poll del KDS cada 5s ─────────────────────────────────────
  useEffect(() => {
    if (!token) return
    const upd = () => contarPendientesKDS(STORE_CODE).then(setKdsPendientes)
    upd()
    const id = setInterval(upd, 5000)
    return () => clearInterval(id)
  }, [token])

  // ── Sincronizar cola pendiente cada 10s ─────────────────────
  useEffect(() => {
    if (!token) return
    const sync = async () => {
      const cola = pendientes()
      if (cola.length === 0) { setPendientesCount(0); return }
      for (const item of cola) {
        try {
          await enviarEvento(token, item.payload.event)
          quitarPendiente(item.payload.event.event_id)
        } catch { /* reintenta después */ }
      }
      setPendientesCount(pendientes().length)
    }
    sync()
    const id = setInterval(sync, 10000)
    return () => clearInterval(id)
  }, [token])

  // ── Cleanup al desmontar ────────────────────────────────────
  useEffect(() => () => {
    runRef.current = false
    if (pollRef.current) clearInterval(pollRef.current)
    try { readerRef.current?.cancel() } catch {}
    try { writerRef.current?.releaseLock() } catch {}
  }, [])

  // ══════════ LOGIN ══════════
  async function login() {
    const p = pin.trim()
    if (!p) { setLoginMsg('Ingresá el PIN'); return }
    setLoginMsg('Validando...')
    try {
      const { data, error } = await db.rpc('staff_login', { p_pin: p })
      if (error) throw error
      if (!data?.token) throw new Error('Login sin token')
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(NOMBRE_KEY, data.nombre || 'Estación')
      setToken(data.token); setNombre(data.nombre || 'Estación'); setPin('')
      setLoginMsg('')
    } catch (e) {
      setLoginMsg(e.message || 'PIN incorrecto')
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOMBRE_KEY)
    setToken(''); setNombre('')
  }

  // ══════════ CONEXIÓN BÁSCULA ══════════
  function processChunk(bytes) {
    bufferRef.current += new TextDecoder().decode(bytes)
    const lines = bufferRef.current.split(/[\r\n]+/)
    bufferRef.current = lines.pop() ?? ''
    for (const line of lines) {
      const g = parseWeight(line)
      if (g !== null) registerWeight(g)
    }
  }

  function registerWeight(nextG) {
    const now = Date.now()
    const recent = [...readingsRef.current, { g: nextG, at: now }]
      .filter(r => now - r.at <= CFG.stability_window_ms).slice(-6)
    readingsRef.current = recent
    const vals = recent.map(r => r.g)
    const isStable = recent.length >= CFG.stability_min_readings &&
                     (Math.max(...vals) - Math.min(...vals)) <= CFG.stability_max_spread_g
    setGrams(nextG); setStable(isStable)
    responseCountRef.current += 1
    setDiag(`${responseCountRef.current} lecturas · última: ${(nextG/1000).toFixed(3)} kg`)

    const inRange = nextG >= CFG.min_g && nextG <= CFG.max_g
    if (isStable && inRange && !acceptedRef.current) {
      acceptedRef.current = true
      setLastPortion(nextG)
      beepOk(audioRef.current)
      // Registrar porción
      const event = {
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        business_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' }),
        store_code: STORE_CODE,
        station_id: STATION_ID,
        producto: config?.producto || 'papa_sazonada',
        peso_g: nextG,
        target_g: CFG.target_g,
        min_g: CFG.min_g,
        max_g: CFG.max_g,
        stable_spread_g: Math.max(...vals) - Math.min(...vals),
        app_version: APP_VERSION,
      }
      // Guardar pendiente ANTES de enviar (por si no hay red)
      guardarPendiente({ event })
      setPendientesCount(pendientes().length)
      // Enviar en background
      enviarEvento(token, event)
        .then(() => { quitarPendiente(event.event_id); setPendientesCount(pendientes().length) })
        .catch(() => { /* queda en cola, reintenta el sync loop */ })
    }

    if (nextG <= CFG.empty_max_g) {
      zeroReadingsRef.current += 1
      if (acceptedRef.current && zeroReadingsRef.current >= 3) {
        acceptedRef.current = false; zeroReadingsRef.current = 0
        setCompleted(c => c + 1)
      }
    } else {
      zeroReadingsRef.current = 0
    }
  }

  async function requestWeight() {
    const w = writerRef.current
    if (!w || sendingRef.current) return
    sendingRef.current = true
    try { await w.write(new Uint8Array([80])) }
    catch (e) { setConnection('error'); setConnMsg(e.message || 'Error al pedir peso') }
    finally { sendingRef.current = false }
  }

  async function readLoop(port) {
    while (runRef.current && port.readable) {
      const reader = port.readable.getReader()
      readerRef.current = reader
      try {
        while (runRef.current) {
          const { value, done } = await reader.read()
          if (done) break
          if (value?.length) processChunk(value)
        }
      } catch (e) {
        if (runRef.current) { setConnection('error'); setConnMsg(e.message || 'Lectura interrumpida') }
      } finally {
        try { reader.releaseLock() } catch {}
        readerRef.current = null
      }
    }
  }

  async function connect() {
    const hayUsb = typeof navigator !== 'undefined' && 'usb' in navigator
    const haySerial = typeof navigator !== 'undefined' && 'serial' in navigator
    if (ES_ANDROID ? !hayUsb : !haySerial) {
      setConnection('error')
      setConnMsg(ES_ANDROID
        ? 'Esta versión de Chrome no soporta USB. Actualizá Chrome desde Play Store'
        : 'Abrí esta página en Chrome o Edge de escritorio')
      return
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (AC && !audioRef.current) audioRef.current = new AC()
      await audioRef.current?.resume()
      setConnection('connecting')

      let port
      let via
      if (ES_ANDROID) {
        // OJO: en Android no se llama navigator.serial.requestPort() ni aunque
        // navigator.serial exista — es justo lo que devolvía "sin dispositivos".
        setConnMsg('Elegí el USB de la báscula: CH340, QinHeng o USB2.0-Serial')
        port = await requestCh340Port(navigator.usb)
        via = 'usb'
      } else {
        setConnMsg('Seleccioná USB-SERIAL CH340')
        port = await navigator.serial.requestPort()
        via = 'serial'
      }

      await port.open(SERIAL_CONFIG)
      if (!port.writable) throw new Error('El puerto no permite escribir')
      portRef.current = port
      writerRef.current = port.writable.getWriter()
      bufferRef.current = ''; readingsRef.current = []; responseCountRef.current = 0
      setGrams(0); setStable(false)
      setConnection('connected'); setConnMsg('Rhino BAR-6X conectada')
      setDiag(via === 'usb'
        ? 'USB directo Android · esperando primera lectura'
        : 'Puerto serie abierto · esperando primera lectura')
      runRef.current = true
      void readLoop(port)
      await requestWeight()
      pollRef.current = setInterval(() => void requestWeight(), CFG.poll_interval_ms)
    } catch (e) {
      setConnection('error')
      // Mensajes concretos: un "no se pudo abrir" genérico esconde la causa y
      // hace perder media hora adivinando si es el cable, el permiso o el chip.
      const nombre = e instanceof DOMException ? e.name : ''
      if (nombre === 'NotFoundError') {
        setConnMsg(ES_ANDROID
          ? 'Android no ve ningún USB: revisá el cable o el adaptador OTG'
          : 'No se seleccionó ningún puerto')
      } else if (nombre === 'SecurityError' || nombre === 'NotAllowedError') {
        setConnMsg('No se concedió el permiso USB. Reconectá el cable y aceptá')
      } else {
        setConnMsg(e.message || 'No se pudo abrir la báscula')
      }
    }
  }

  async function disconnect() {
    runRef.current = false
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    try { await readerRef.current?.cancel() } catch {}
    try { writerRef.current?.releaseLock() } catch {}
    writerRef.current = null
    try { await portRef.current?.close() } catch {}
    portRef.current = null
    setConnection('idle'); setConnMsg('Desconectada')
  }

  // ══════════ RENDER ══════════
  if (!token) return (
    <div style={sLogin}>
      <div style={sLoginCard}>
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🍟</div>
        <h1 style={{ fontSize: 22, textAlign: 'center', margin: '0 0 4px' }}>Porcionador de papas</h1>
        <div style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 20 }}>Estación Metrocentro (S006)</div>
        <input type="password" inputMode="numeric" value={pin}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && login()}
          placeholder="PIN de la estación" style={sInput} autoFocus />
        <button onClick={login} style={sBtnPrimary}>Ingresar</button>
        {loginMsg && <div style={{ color: '#e63946', marginTop: 10, fontSize: 13, textAlign: 'center' }}>{loginMsg}</div>}
      </div>
    </div>
  )

  // Colores del semáforo
  const inRange = grams >= CFG.min_g && grams <= CFG.max_g
  let color = '#666', label = 'Colocá papa'
  if (connection !== 'connected') { color = '#999'; label = 'Sin báscula' }
  else if (grams <= CFG.empty_max_g) { color = '#4b5563'; label = 'Balanza vacía · Empezá' }
  else if (grams < CFG.min_g) { color = '#f59e0b'; label = `Agregá ${CFG.target_g - grams}g más` }
  else if (grams > CFG.max_g) { color = '#dc2626'; label = `¡Retirá ${grams - CFG.target_g}g!` }
  else if (stable) { color = '#16a34a'; label = '✓ ¡PORCIÓN LISTA!' }
  else { color = '#a3e635'; label = 'En rango, esperá que estabilice…' }

  return (
    <div style={sMain}>
      {/* Top bar */}
      <div style={sTopBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🍟</span>
          <b>Porcionador</b>
          <span style={{ color: '#888', fontSize: 12 }}>· {nombre} · S006</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
          {pendientesCount > 0
            ? <span style={{ color: '#f59e0b' }}>⏳ Pendientes: {pendientesCount}</span>
            : <span style={{ color: '#16a34a' }}>✓ Sincronizado</span>}
          <button onClick={logout} style={sBtnGhost}>Salir</button>
        </div>
      </div>

      {/* KDS pendientes */}
      <div style={sKdsBar}>
        <span style={{ fontSize: 14, color: '#888' }}>Órdenes en cocina S006:</span>
        <b style={{ fontSize: 22, color: kdsPendientes > 8 ? '#dc2626' : '#111' }}>{kdsPendientes}</b>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>(items pendientes)</span>
      </div>

      {/* Peso grande */}
      <div style={{ ...sPeso, background: color + '22', color: color }}>
        <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1 }}>{grams}<span style={{ fontSize: 32, marginLeft: 6 }}>g</span></div>
        <div style={{ fontSize: 24, fontWeight: 600, marginTop: 10 }}>{label}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
          Objetivo: {CFG.target_g}g · rango {CFG.min_g}–{CFG.max_g}g
        </div>
      </div>

      {/* KPIs turno */}
      <div style={sKpiRow}>
        <div style={sKpiCard}>
          <div style={sKpiLabel}>Porciones turno</div>
          <div style={sKpiValue}>{completed}</div>
        </div>
        <div style={sKpiCard}>
          <div style={sKpiLabel}>Última porción</div>
          <div style={sKpiValue}>{lastPortion ? `${lastPortion}g` : '—'}</div>
        </div>
      </div>

      {/* Controles conexión */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, justifyContent: 'center' }}>
        {connection === 'connected'
          ? <button onClick={disconnect} style={sBtnGhost}>Desconectar báscula</button>
          : <button onClick={connect} style={sBtnPrimary}>{connection === 'connecting' ? 'Conectando…' : 'Conectar Rhino BAR-6X'}</button>}
      </div>

      <div style={sDiag}>{connMsg} · {diag}</div>
      <div style={{ ...sDiag, opacity: 0.6, marginTop: 2 }}>
        {ES_ANDROID ? 'ANDROID WEBUSB CH340' : 'ESCRITORIO WEB SERIAL'} · {APP_VERSION}
      </div>
    </div>
  )
}

// ── Estilos inline ────────────────────────────────────────────
const sLogin = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f8f8', fontFamily: 'system-ui,sans-serif' }
const sLoginCard = { background: '#fff', borderRadius: 16, padding: 28, width: 320, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }
const sInput = { width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: 24, textAlign: 'center', letterSpacing: 4, border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }
const sBtnPrimary = { width: '100%', padding: '14px', fontSize: 16, background: '#e63946', color: '#fff', border: 0, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }
const sBtnGhost = { padding: '8px 14px', fontSize: 13, background: 'transparent', color: '#666', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer' }
const sMain = { minHeight: '100vh', background: '#f8f8f8', fontFamily: 'system-ui,sans-serif' }
const sTopBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#fff', borderBottom: '1px solid #eee' }
const sKdsBar = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#fff8dc', borderBottom: '1px solid #f5e9a8' }
const sPeso = { margin: '16px', borderRadius: 20, padding: '40px 20px', textAlign: 'center', transition: 'all 0.2s' }
const sKpiRow = { display: 'flex', gap: 12, padding: '0 16px' }
const sKpiCard = { flex: 1, background: '#fff', borderRadius: 12, padding: '14px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }
const sKpiLabel = { fontSize: 12, color: '#888' }
const sKpiValue = { fontSize: 28, fontWeight: 700, marginTop: 4 }
const sDiag = { padding: '20px 16px', fontSize: 11, color: '#888', textAlign: 'center', fontFamily: 'monospace' }
