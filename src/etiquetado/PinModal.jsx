/* ═══════════════════════════════════════════════════════════════════════
   PIN por persona para imprimir etiquetas.
   Se valida en el servidor (fn_prep_actor: mismo freno de intentos que el login)
   y devuelve quién es. El PIN no se guarda: vive en esta pantalla mientras se
   teclea. La etiqueta sale a nombre de quien entra, por eso no hay "sesión del
   día": al terminar el lote o volver atrás, el siguiente vuelve a poner el suyo.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react'
import { db } from '../supabase'

const C = { bg: '#0a0a0b', card: '#141416', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92', ok: '#22c55e', bad: '#fca5a5' }

export default function PinModal({ titulo, sub, onListo, onCancelar, soloEncargado = false }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [yendo, setYendo] = useState(false)
  const timer = useRef(null)

  async function probar(valor) {
    if (valor.length < 4 || yendo) return
    setErr(''); setYendo(true)
    try {
      const { data, error } = await db.rpc('fn_prep_actor', { p_pin: valor, p_solo_encargado: soloEncargado })
      if (error) throw new Error(error.message)
      if (!data) { setErr(soloEncargado ? 'Ese PIN no es de un encargado' : 'PIN incorrecto'); setPin('') }
      else onListo({ id: data.id, nombre: data.nombre, rol: data.rol }, valor)   // el PIN solo viaja a quien lo pidió (p. ej. el apartado Equipo y PINs)
    } catch (e) { setErr(e.message || 'No hay conexión. Intentá de nuevo.'); setPin('') }
    setYendo(false)
  }

  // Mismo ritmo que el login: con 4 o 5 dígitos espera un momento por si sigue
  // tecleando; con 6 entra directo.
  useEffect(() => {
    clearTimeout(timer.current)
    if (pin.length >= 6) probar(pin)
    else if (pin.length >= 4) timer.current = setTimeout(() => probar(pin), 450)
    return () => clearTimeout(timer.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  const tecla = (k) => {
    if (yendo) return
    setErr('')
    if (k === '←') setPin(p => p.slice(0, -1))
    else if (k === '✓') probar(pin)
    else setPin(p => (p.length >= 6 ? p : p + k))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 50,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18,
                    width: 'min(380px, 100%)', color: C.txt, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{titulo}</div>
        <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5, margin: '6px 0 12px' }}>{sub}</div>
        <div data-testid="pin-puntos" style={{ textAlign: 'center', fontSize: 34, letterSpacing: 12, minHeight: 44,
                      fontFamily: 'ui-monospace, monospace', padding: '4px 0 8px' }}>
          {pin ? '•'.repeat(pin.length) : <span style={{ color: C.line }}>••••</span>}
        </div>
        <div style={{ color: C.bad, fontSize: 13.5, textAlign: 'center', minHeight: 20, marginBottom: 6 }}>{err}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', '✓'].map(k => (
            <button key={k} onClick={() => tecla(k)} disabled={yendo}
              style={{ background: k === '✓' ? C.ok : '#1c1c20', color: k === '✓' ? '#06180c' : C.txt,
                       border: 0, borderRadius: 12, padding: 17, fontSize: 21, cursor: 'pointer',
                       fontFamily: 'ui-monospace, monospace', opacity: yendo ? .5 : 1 }}>{k}</button>
          ))}
        </div>
        {onCancelar && (
        <button onClick={onCancelar}
          style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 10, padding: 11,
                   width: '100%', marginTop: 10, color: C.dim, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancelar
        </button>
        )}
      </div>
    </div>
  )
}
