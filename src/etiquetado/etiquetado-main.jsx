/* ═══════════════════════════════════════════════════════════════════════
   Entrada de la tablet de pesaje y etiquetado
   freakie-dogs-caja.vercel.app/etiquetado.html

   Mismo criterio que la tablet del pesaje del chili: sin PIN. La tablet está
   dedicada, cableada a la báscula y a la impresora, y bajo control de Casa
   Matriz. Se pregunta el nombre una vez al día porque va impreso en cada
   etiqueta: si una bolsa aparece mal, tiene que poder saberse quién la pesó.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import EtiquetadoApp from './EtiquetadoApp'
import '../styles/global.css'

const CLAVE = 'etiquetado_operario'
const OPERARIOS = ['Diego Enrique', 'Mauricio', 'Wendy', 'Otra persona']

const hoySV = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })

function guardado() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || 'null')
    return v && v.fecha === hoySV() ? v.nombre : null
  } catch { return null }
}

function App() {
  const [quien, setQuien] = useState(guardado)

  const elegir = (nombre) => {
    try { localStorage.setItem(CLAVE, JSON.stringify({ nombre, fecha: hoySV() })) } catch { /* sin storage igual sigue */ }
    setQuien(nombre)
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 'min(380px, 100%)' }}>
          {OPERARIOS.map(n => (
            <button key={n} onClick={() => elegir(n)} style={{
              background: '#141416', border: '1px solid #2a2a2e', color: '#f0f0f2',
              borderRadius: 12, padding: '22px 18px', fontSize: 20, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{n}</button>
          ))}
        </div>
        <div style={{ color: '#8a8a92', fontSize: 12.5, marginTop: 22, textAlign: 'center', maxWidth: 360 }}>
          El nombre va impreso en cada etiqueta. Se pregunta una vez al día.
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
        <button onClick={() => { localStorage.removeItem(CLAVE); setQuien(null) }} style={{
          background: 'none', border: '1px solid #2a2a2e', color: '#8a8a92',
          borderRadius: 7, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>No soy yo</button>
      </div>
      <EtiquetadoApp quien={quien} />
    </>
  )
}

createRoot(document.getElementById('etiquetado-root')).render(<App />)
