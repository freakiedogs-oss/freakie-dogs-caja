/* ═════════════════════════════════════════════════════════════════
   Equipo y PINs — para el jefe de Casa Matriz (Kevin)

   Los PIN existen pero la gente no sabe cuál es el suyo. Aquí el encargado
   ve a su equipo de producción y, persona por persona, consulta el PIN para
   dárselo.

   Cuidados (el PIN es lo que ata cada etiqueta a una persona):
   · Entra con el PIN del encargado; el servidor decide quién puede (fn_equipo_lista).
   · La lista NO trae PIN: cada PIN se pide de a uno (fn_equipo_pin_ver), se ve
     15 segundos y se vuelve a ocultar.
   · Cada consulta queda en la bitácora con el nombre de quien la hizo.
   · Solo ve a su equipo (producción y despacho de su sucursal), nunca a otros encargados.
   · Se cierra sola a los 60 s sin tocar nada.
   ═════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../supabase'
import PinModal from './PinModal'

const C = { bg: '#0a0a0b', card: '#141416', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92', acc: '#3b82f6', ok: '#22c55e', warn: '#f59e0b', bad: '#fca5a5' }
const ROL = { produccion: 'Producción', despachador: 'Despacho' }
const VER_SEG = 15      // cuánto se ve un PIN
const INACTIVO_SEG = 60 // sin tocar nada: se cierra

export default function EquipoPines({ onCerrar }) {
  const [fase, setFase] = useState('pin')          // 'pin' → 'lista'
  const [equipo, setEquipo] = useState([])
  const [error, setError] = useState('')
  const [visto, setVisto] = useState(null)         // { id, nombre, pin, resta }
  const [cargando, setCargando] = useState(null)   // id que se está pidiendo
  const pinEnc = useRef('')                        // vive solo en memoria mientras esta pantalla está abierta
  const idle = useRef(null)

  const armarInactividad = useCallback(() => {
    clearTimeout(idle.current)
    idle.current = setTimeout(() => { pinEnc.current = ''; onCerrar() }, INACTIVO_SEG * 1000)
  }, [onCerrar])

  useEffect(() => {
    if (fase !== 'lista') return
    armarInactividad()
    const f = () => armarInactividad()
    const ev = ['pointerdown', 'keydown', 'touchstart']
    ev.forEach(e => window.addEventListener(e, f, true))
    return () => { clearTimeout(idle.current); ev.forEach(e => window.removeEventListener(e, f, true)) }
  }, [fase, armarInactividad])

  // Cuenta regresiva del PIN a la vista.
  useEffect(() => {
    if (!visto) return
    if (visto.resta <= 0) { setVisto(null); return }
    const t = setTimeout(() => setVisto(v => v && { ...v, resta: v.resta - 1 }), 1000)
    return () => clearTimeout(t)
  }, [visto])

  async function entrar(_actor, pin) {
    pinEnc.current = pin
    setError('')
    try {
      const { data, error: e } = await db.rpc('fn_equipo_lista', { p_pin_encargado: pin })
      if (e) throw new Error(e.message)
      setEquipo(data?.equipo || [])
      setFase('lista')
    } catch (e) { setError(e.message || 'No pude cargar el equipo. Revisá la conexión.'); pinEnc.current = ''; onCerrar() }
  }

  async function verPin(p) {
    setError(''); setCargando(p.id)
    try {
      const { data, error: e } = await db.rpc('fn_equipo_pin_ver', { p_pin_encargado: pinEnc.current, p_usuario: p.id })
      if (e) throw new Error(e.message)
      setVisto({ id: p.id, nombre: data.nombre, pin: data.pin, resta: VER_SEG })
    } catch (e) { setError(e.message || 'No pude pedir el PIN.'); setVisto(null) }
    setCargando(null)
  }

  const cerrar = () => { pinEnc.current = ''; setVisto(null); onCerrar() }

  if (fase === 'pin') return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <PinModal
        soloEncargado
        titulo="Equipo y PINs"
        sub="Entrá con tu PIN de encargado para ver a tu equipo y darles su PIN. Cada consulta queda registrada con tu nombre."
        onListo={entrar}
        onCancelar={onCerrar}
      />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.txt, padding: 14,
                  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>👥 Equipo y PINs</div>
            <div style={{ color: C.dim, fontSize: 13, marginTop: 2 }}>
              Tocá «Ver PIN» y decíselo en persona. Se oculta solo a los {VER_SEG} s y queda anotado quién lo consultó.
            </div>
          </div>
          <button onClick={cerrar}
            style={{ background: C.acc, color: '#fff', border: 0, borderRadius: 10, padding: '10px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
            Listo
          </button>
        </div>

        {error && <div style={{ background: '#2a0e0e', border: '1px solid #7f1d1d', color: C.bad, borderRadius: 10, padding: '9px 12px', fontSize: 13.5, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'grid', gap: 8 }}>
          {equipo.map(p => {
            const abierto = visto && visto.id === p.id
            return (
              <div key={p.id} data-testid={`eq-${p.id}`}
                style={{ background: C.card, border: `1px solid ${abierto ? C.ok : C.line}`, borderRadius: 14, padding: '12px 14px',
                         display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{p.nombre}</div>
                  <div style={{ color: C.dim, fontSize: 12.5, marginTop: 2 }}>{ROL[p.rol] || p.rol}</div>
                </div>
                {abierto ? (
                  <div style={{ textAlign: 'right' }}>
                    <div data-testid="pin-visto" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 30, fontWeight: 800, letterSpacing: 6, color: C.ok }}>{visto.pin}</div>
                    <div style={{ color: C.dim, fontSize: 12 }}>se oculta en {visto.resta} s</div>
                  </div>
                ) : p.tiene_pin ? (
                  <button onClick={() => verPin(p)} disabled={cargando === p.id}
                    style={{ background: '#1c1c20', color: C.txt, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: cargando === p.id ? .5 : 1 }}>
                    {cargando === p.id ? '…' : 'Ver PIN'}
                  </button>
                ) : (
                  <span style={{ color: C.warn, fontSize: 13 }}>Sin PIN asignado</span>
                )}
              </div>
            )
          })}
          {!equipo.length && <div style={{ color: C.dim, padding: 20, textAlign: 'center' }}>No hay personas de producción en tu sucursal.</div>}
        </div>
        <div style={{ color: C.dim, fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
          Cada PIN es personal: las etiquetas y los insumos quedan a nombre de quien lo usa. Si alguien cree que otra persona conoce el suyo, hay que cambiárselo.
        </div>
      </div>
    </div>
  )
}
