/* ═══════════════════════════════════════════════════════════════════════
   Entrada de la tablet de pesaje y etiquetado
   freakie-dogs-caja.vercel.app/etiquetado.html

   Mismo criterio que la tablet del pesaje del chili: sin PIN. La tablet está
   dedicada, cableada a la báscula y a la impresora, y bajo control de Casa
   Matriz. Se pregunta quién pesa una vez al día porque va en cada unidad y
   en cada etiqueta: si una bolsa aparece mal, tiene que poder saberse quién
   la pesó.

   02-oct-2026: la lista de operarios sale de la base (usuarios_erp con
   es_productor en CM001, vía RPC que no expone el PIN), no de un arreglo
   fijo. Cada tablet se identifica con un id propio guardado en el navegador,
   para poder retomar su tanda abierta si se recarga la página.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { db } from '../supabase'
import EtiquetadoApp from './EtiquetadoApp'
import '../styles/global.css'

const CLAVE = 'etiquetado_operario_v2'
const CLAVE_DISP = 'etiquetado_dispositivo'

const hoySV = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })

function guardado() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || 'null')
    return v && v.fecha === hoySV() ? v.quien : null
  } catch { return null }
}

export function dispositivoId() {
  try {
    let d = localStorage.getItem(CLAVE_DISP)
    if (!d) {
      d = 'TAB-' + Math.random().toString(36).slice(2, 8).toUpperCase()
      localStorage.setItem(CLAVE_DISP, d)
    }
    return d
  } catch { return 'TAB-SIN-STORAGE' }
}

function App() {
  const [quien, setQuien] = useState(guardado)
  const [operarios, setOperarios] = useState(null)
  const [error, setError] = useState('')
  const [otro, setOtro] = useState('')

  useEffect(() => {
    if (quien) return
    let vivo = true
    db.rpc('produccion_estacion_operarios').then(({ data, error: e }) => {
      if (!vivo) return
      if (e) { setError('No se pudo cargar la lista de operarios: ' + e.message); setOperarios([]) }
      else setOperarios(data || [])
    })
    return () => { vivo = false }
  }, [quien])

  const elegir = (q) => {
    try { localStorage.setItem(CLAVE, JSON.stringify({ quien: q, fecha: hoySV() })) } catch { /* sin storage igual sigue */ }
    setQuien(q)
  }

  if (!quien) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0b', color: '#f0f0f2',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 24,
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      }}>
        <div style={{ fontSize: 46, marginBottom: 6 }}>🏷️</div>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Pesaje y etiquetado</div>
        <div style={{ color: '#8a8a92', fontSize: 15, marginTop: 8, marginBottom: 26 }}>
          ¿Quién está pesando hoy?
        </div>
        {error && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 14, maxWidth: 380, textAlign: 'center' }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 'min(380px, 100%)' }}>
          {operarios === null && <div style={{ color: '#8a8a92', textAlign: 'center' }}>Cargando…</div>}
          {(operarios || []).map(o => (
            <button key={o.id} onClick={() => elegir({ id: o.id, nombre: o.nombre })} style={{
              background: '#141416', border: '1px solid #2a2a2e', color: '#f0f0f2',
              borderRadius: 12, padding: '22px 18px', fontSize: 20, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{o.nombre}</button>
          ))}
          {operarios !== null && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={otro} onChange={e => setOtro(e.target.value)} placeholder="Otra persona (nombre)"
                style={{ flex: 1, background: '#141416', border: '1px solid #2a2a2e', color: '#f0f0f2',
                         borderRadius: 12, padding: '14px 16px', fontSize: 17, fontFamily: 'inherit' }} />
              <button disabled={otro.trim().length < 3} onClick={() => elegir({ id: null, nombre: otro.trim() })} style={{
                background: otro.trim().length < 3 ? '#1f2937' : '#22c55e', color: otro.trim().length < 3 ? '#6b7280' : '#06180c',
                border: 0, borderRadius: 12, padding: '0 18px', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              }}>Entrar</button>
            </div>
          )}
        </div>
        <div style={{ color: '#8a8a92', fontSize: 12.5, marginTop: 22, textAlign: 'center', maxWidth: 360 }}>
          El nombre queda en cada unidad pesada. Se pregunta una vez al día.
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        padding: '6px 14px', background: '#0a0a0b',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      }}>
        <button onClick={() => { try { localStorage.removeItem(CLAVE) } catch { /* nada */ } setQuien(null) }} style={{
          background: 'none', border: '1px solid #2a2a2e', color: '#8a8a92',
          borderRadius: 7, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>No soy yo</button>
      </div>
      <EtiquetadoApp quien={quien} dispositivo={dispositivoId()} />
    </>
  )
}

createRoot(document.getElementById('etiquetado-root')).render(<App />)
