// ────────────────────────────────────────────────────────────────────
// Modal ÚNICO de sesión de finanzas (SEG-1 Capa 2).
//
// Se monta una sola vez en la raíz del ERP. Cuando cualquier pantalla de
// finanzas choca con el gate del proxy, `supabaseFinanzas` emite un evento y
// este modal pide el PIN. Así no hay que repetir el prompt en las 6 pantallas
// que leen datos cerrados.
//
// Al abrir la sesión se recarga la página: es la forma simple y confiable de
// que TODAS las consultas de la pantalla se rehagan con la sesión nueva, sin
// tener que cablear un re-fetch en cada componente.
//
// La sesión dura 30 min (`staff_sesiones`) y se comparte con RRHH, SuperAdmin
// y la subida de fotos del menú.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { paletaT as T } from '@/theme'
import { abrirSesionFinanzas, EVENTO_SESION_REQUERIDA } from '../../supabaseFinanzas'

export default function SesionFinanzasModal() {
  const [abierto, setAbierto] = useState(false)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [cargando, setCargando] = useState(false)
  const input = useRef(null)

  useEffect(() => {
    const alPedir = () => setAbierto(true)
    window.addEventListener(EVENTO_SESION_REQUERIDA, alPedir)
    return () => window.removeEventListener(EVENTO_SESION_REQUERIDA, alPedir)
  }, [])

  useEffect(() => { if (abierto) setTimeout(() => input.current?.focus(), 60) }, [abierto])

  const entrar = async () => {
    setErr(''); setCargando(true)
    try {
      await abrirSesionFinanzas(pin)
      // Recargar para que todas las consultas se rehagan ya con la sesión.
      window.location.reload()
    } catch (e) {
      setErr(e.message || 'PIN incorrecto')
      setPin(''); setCargando(false)
      setTimeout(() => input.current?.focus(), 40)
    }
  }

  if (!abierto) return null

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Sesión de finanzas"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 380, background: T.bgCard, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: 28, textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>
          Sesión de finanzas
        </div>
        <div style={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.55, marginBottom: 18 }}>
          Los datos financieros no se sirven con la llave pública.
          Ingresá tu PIN para verlos. La sesión dura 30 minutos.
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <input
            ref={input} type="password" inputMode="numeric" value={pin}
            placeholder="Tu PIN" disabled={cargando}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && pin.length >= 3 && !cargando && entrar()}
            style={{
              width: 130, padding: '11px 12px', borderRadius: 8,
              border: `1px solid ${T.border}`, background: T.bg, color: T.text,
              fontSize: 15, textAlign: 'center',
            }}
          />
          <button
            type="button" onClick={entrar} disabled={pin.length < 3 || cargando}
            style={{
              padding: '11px 18px', borderRadius: 8, border: 'none', background: T.green,
              color: '#04140c', fontSize: 13, fontWeight: 700,
              cursor: pin.length < 3 || cargando ? 'not-allowed' : 'pointer',
              opacity: pin.length < 3 || cargando ? .5 : 1,
            }}
          >{cargando ? '…' : 'Entrar'}</button>
        </div>

        {err && <div style={{ fontSize: 12, color: T.red, marginTop: 12 }}>⚠️ {err}</div>}

        <button
          type="button" onClick={() => setAbierto(false)}
          style={{
            marginTop: 16, padding: '7px 12px', borderRadius: 7, border: 'none',
            background: 'transparent', color: T.textMuted, fontSize: 12, cursor: 'pointer',
          }}
        >Cancelar</button>
      </div>
    </div>
  )
}
