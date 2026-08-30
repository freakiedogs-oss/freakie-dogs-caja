/* ═══════════════════════════════════════════════════════════════════════
   Entrada directa de la tablet del area de carne — freakie-dogs-caja.vercel.app/carne.html

   Sin PIN: la tablet esta dedicada a esto y esta bajo control de Casa Matriz.
   Obligarlas a teclear un PIN cada vez solo lograria que dejaran la sesion
   abierta para siempre, que es lo que rompio el porcionador esta semana.

   Pero un registro BPM sin saber quien lo hizo vale poco, asi que se pide el
   nombre UNA VEZ AL DIA con un toque, y se recuerda hasta la medianoche. No es
   autenticacion — nadie valida nada — es trazabilidad para el registro.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CarneBoleadoView from '../components/produccion/CarneBoleadoView'
import '../styles/global.css'

const CLAVE = 'carne_operario'
const STORE = 'CM001'

// Quienes bolean en Casa Matriz. Se edita aca, no requiere usuario en el ERP.
const OPERARIOS = ['Diego Enrique', 'Mauricio', 'Otra persona']

const hoySV = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })

function guardado() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || 'null')
    // Se olvida al cambiar el dia: el turno de mañana es otra persona.
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
        minHeight: '100vh', background: '#0f0f10', color: '#f0f0f2',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 24,
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      }}>
        <div style={{ fontSize: 44, marginBottom: 6 }}>🥩</div>
        <div style={{ fontSize: 23, fontWeight: 700 }}>Mezclado y boleado</div>
        <div style={{ color: '#8a8a92', fontSize: 15, marginTop: 8, marginBottom: 26, textAlign: 'center' }}>
          ¿Quién está boleando hoy?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 'min(360px, 100%)' }}>
          {OPERARIOS.map(n => (
            <button key={n} onClick={() => elegir(n)} style={{
              background: '#1a1a1c', border: '1px solid #2a2a2e', color: '#f0f0f2',
              borderRadius: 12, padding: '20px 18px', fontSize: 19, fontWeight: 700,
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
    <div style={{ minHeight: '100vh', background: '#0f0f10' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', borderBottom: '1px solid #2a2a2e',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      }}>
        <span style={{ color: '#8a8a92', fontSize: 13 }}>Casa Matriz · {quien}</span>
        <button onClick={() => { localStorage.removeItem(CLAVE); setQuien(null) }} style={{
          background: 'none', border: '1px solid #2a2a2e', color: '#8a8a92',
          borderRadius: 7, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>No soy yo</button>
      </div>
      {/* rol produccion para que la vista no bloquee nada; no hay sesion real */}
      <CarneBoleadoView user={{ nombre: quien, rol: 'produccion', store_code: STORE }} />
    </div>
  )
}

createRoot(document.getElementById('carne-root')).render(<App />)
