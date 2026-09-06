/* ═══════════════════════════════════════════════════════════════════════
   Entrada de la tablet del pesaje del chili
   freakie-dogs-caja.vercel.app/pesaje.html

   Mismo criterio que la tablet de carne: sin PIN. Está dedicada, cableada a
   la balanza y bajo control de Casa Matriz. Pedir PIN cada vez solo lograría
   que dejaran la sesión abierta para siempre.

   Se pregunta el nombre una vez al día para que el registro diga quién pesó.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import PesajeChiliApp from './PesajeChiliApp'
import '../styles/global.css'

const CLAVE = 'pesaje_operario'
const OPERARIOS = ['Diego Enrique', 'Mauricio', 'Otra persona']

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
        <div style={{ fontSize: 46, marginBottom: 6 }}>⚖️</div>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Pesaje del chili</div>
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
        <div style={{ color: '#8a8a92', fontSize: 12.5, marginTop: 22, textAlign: 'center', maxWidth: 340 }}>
          Se pregunta una sola vez al día. Mañana vuelve a preguntar.
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
      <PesajeChiliApp quien={quien} />
    </>
  )
}

createRoot(document.getElementById('pesaje-root')).render(<App />)
