// Freakie Flow en el teléfono (/flow).
//
// Es la MISMA pantalla de Freakie Flow del ERP (FreakieFlowView), sin el menú
// del ERP, con su propio ícono para instalarla como app (manifest
// /flow.webmanifest). Se entra con el PIN del ERP, validado en el servidor
// (erp_login), y la sesión queda guardada en el teléfono para no pedir el PIN
// cada vez que se abre.
import { useEffect, useRef, useState } from 'react'
import { db } from '../supabase'
import FreakieFlowView from '../components/marketing/FreakieFlowView'

const SESION = 'freakie_flow_v1'
const DURACION_MS = 30 * 24 * 3600 * 1000 // la sesión vence a los 30 días
// Mismos roles que ven «Freakie Flow» en el menú del ERP (config.js), más superadmin.
const ROLES = ['marketing', 'ejecutivo', 'admin', 'superadmin']

const BG = '#0e0e0f', SURFACE = '#1a1a1a', LINE = '#2a2a2a', INK = '#f2f0ec', MUTED = '#9c9aa0', RED = '#E32829'

function leerSesion() {
  try {
    const s = JSON.parse(localStorage.getItem(SESION) || 'null')
    if (s && s.user && Date.now() - s.t < DURACION_MS) return s.user
  } catch { /* noop */ }
  return null
}

function guardarSesion(user) {
  // Solo lo necesario para la pantalla; el PIN nunca se guarda.
  const u = { id: user.id, nombre: user.nombre, apellido: user.apellido || '', rol: user.rol }
  try { localStorage.setItem(SESION, JSON.stringify({ user: u, t: Date.now() })) } catch { /* noop */ }
  return u
}

const esIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
const instalada = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

function Login({ onLogin }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [cargando, setCargando] = useState(false)
  const inputRef = useRef(null)

  const entrar = async (e) => {
    e?.preventDefault()
    const p = pin.trim()
    if (p.length < 4 || cargando) return
    if (!navigator.onLine) { setErr('Sin conexión a internet'); return }
    setCargando(true); setErr('')
    const { data, error } = await db.rpc('erp_login', { p_pin: p })
    setCargando(false)
    if (error) { setErr(error.message || 'Error conectando al servidor'); setPin(''); return }
    if (!data) { setErr('PIN incorrecto'); setPin(''); inputRef.current?.focus(); return }
    if (!ROLES.includes(data.rol)) {
      setErr('Freakie Flow es solo para el equipo de Marketing.')
      setPin('')
      return
    }
    onLogin(guardarSesion(data))
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={entrar} style={{ width: '100%', maxWidth: 340, textAlign: 'center' }}>
        <img src="/flow-logo.png?v=2" alt="Flow" style={{ width: 220, maxWidth: '70%', margin: '0 auto 6px', display: 'block' }} />
        <p style={{ color: MUTED, fontSize: 14, margin: '0 0 22px' }}>Misiones y objetivos del equipo de Marketing</p>
        <input
          ref={inputRef}
          type="password" inputMode="numeric" autoComplete="current-password" autoFocus
          placeholder="Tu PIN del ERP" value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setErr('') }}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: 22, letterSpacing: pin ? 6 : 0,
            textAlign: 'center', background: SURFACE, color: INK, border: `1px solid ${LINE}`, borderRadius: 12, outline: 'none',
          }}
        />
        {err && <div style={{ color: '#ff8b7a', fontSize: 14, marginTop: 10 }}>{err}</div>}
        <button
          type="submit" disabled={pin.length < 4 || cargando}
          style={{
            width: '100%', marginTop: 14, padding: 14, fontSize: 16, fontWeight: 800, border: 0, borderRadius: 12,
            background: pin.length < 4 ? '#3a1a1a' : RED, color: '#fff', cursor: 'pointer',
          }}
        >{cargando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}

// Aviso para instalar: en Android abre el diálogo del navegador; en iPhone
// explica los pasos de Safari (Apple no deja instalar con un botón).
function AvisoInstalar() {
  const [puede, setPuede] = useState(!!window.__instalar)
  const [cerrado, setCerrado] = useState(() => {
    try { return localStorage.getItem('freakie_flow_aviso') === '1' } catch { return false }
  })
  useEffect(() => {
    const f = () => setPuede(true)
    window.addEventListener('flow:instalable', f)
    return () => window.removeEventListener('flow:instalable', f)
  }, [])
  if (instalada() || cerrado || (!puede && !esIOS())) return null
  const cerrar = () => { setCerrado(true); try { localStorage.setItem('freakie_flow_aviso', '1') } catch { /* noop */ } }
  const instalar = async () => {
    const ev = window.__instalar
    if (!ev) return
    ev.prompt()
    try { await ev.userChoice } catch { /* noop */ }
    window.__instalar = null
    setPuede(false)
  }
  return (
    <div style={{ margin: '10px 12px 0', padding: '10px 12px', background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 12, display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5 }}>
      <div style={{ flex: 1, color: INK }}>
        {puede
          ? 'Instalá Flow en tu teléfono para abrirlo como una app.'
          : <>Para instalar Flow: tocá <b>Compartir</b> en Safari y después <b>Agregar a inicio</b>.</>}
      </div>
      {puede && <button onClick={instalar} style={{ background: RED, color: '#fff', border: 0, borderRadius: 9, padding: '8px 12px', fontWeight: 800 }}>Instalar</button>}
      <button onClick={cerrar} aria-label="Cerrar" style={{ background: 'transparent', color: MUTED, border: 0, fontSize: 18 }}>×</button>
    </div>
  )
}

export default function FlowApp() {
  const [user, setUser] = useState(leerSesion)

  if (!user) return <Login onLogin={setUser} />

  return (
    <div style={{ minHeight: '100vh', background: BG, paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: 'calc(env(safe-area-inset-top) + 8px) 14px 8px', borderBottom: `1px solid ${LINE}`,
        position: 'sticky', top: 0, background: BG, zIndex: 20,
      }}>
        <img src="/flow-logo.png?v=2" alt="Flow" style={{ height: 34 }} />
        <div style={{ textAlign: 'right', fontSize: 12.5, color: MUTED, lineHeight: 1.3 }}>
          <div style={{ color: INK, fontWeight: 700 }}>{user.nombre}</div>
          <a href="/flow?salir=1" style={{ color: MUTED }}>Salir</a>
        </div>
      </div>
      <AvisoInstalar />
      <FreakieFlowView user={user} />
    </div>
  )
}
