import { useState } from 'react'
import { db } from '../supabase'

// Roles que pueden usar el POS
const POS_ROLES = ['cajero', 'cajera', 'gerente', 'admin', 'ejecutivo']

export default function POSLogin({ onLogin }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const press = async (k) => {
    if (loading) return
    if (k === 'del') { setPin(p => p.slice(0, -1)); setErr(''); return }
    const np = pin + k
    setPin(np)
    if (np.length >= 4) {
      setLoading(true)
      const { data, error } = await db
        .from('usuarios_erp')
        .select('*')
        .eq('pin', np)
        .eq('activo', true)
        .maybeSingle()
      setLoading(false)
      if (error || !data) { setErr('PIN incorrecto'); setPin(''); return }
      if (!POS_ROLES.includes(data.rol)) {
        setErr('Sin acceso al POS'); setPin(''); return
      }
      onLogin(data)
    }
  }

  const keys = ['1','2','3','4','5','6','7','8','9','','0','del']

  return (
    <div style={{
      minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#0d0d0d', padding: '0 24px'
    }}>
      <div style={{ fontSize: 56, marginBottom: 10 }}>🍔</div>
      <div style={{ fontWeight: 900, fontSize: 24, color: '#e63946', letterSpacing: 1 }}>
        FREAKIE DOGS
      </div>
      <div style={{ color: '#555', fontSize: 13, marginTop: 4, marginBottom: 8, fontWeight: 600 }}>
        PUNTO DE VENTA
      </div>
      <div style={{ color: '#444', fontSize: 12, marginBottom: 32 }}>
        Ingresa tu PIN
      </div>

      {/* Dots */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: '50%',
            background: pin.length > i ? '#e63946' : '#222',
            border: '2px solid ' + (pin.length > i ? '#e63946' : '#333'),
            transition: 'all 0.1s'
          }} />
        ))}
      </div>

      {err && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {loading && <div className="spin" style={{ marginBottom: 12 }} />}

      {/* Keypad */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: 220
      }}>
        {keys.map((k, i) => k === '' ? <div key={i} /> : (
          <button key={i} onClick={() => press(k)} style={{
            padding: '16px', border: 'none', borderRadius: 12,
            background: k === 'del' ? '#1e1e1e' : '#181818',
            color: '#f0f0f0', fontSize: k === 'del' ? 18 : 20,
            fontWeight: 700, cursor: 'pointer',
            border: '1px solid #222', transition: 'background 0.1s'
          }}
            onMouseOver={e => e.currentTarget.style.background = '#2a2a2a'}
            onMouseOut={e => e.currentTarget.style.background = k === 'del' ? '#1e1e1e' : '#181818'}
          >
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 40, fontSize: 11, color: '#333' }}>
        Freakie Dogs POS v1.0
      </div>
    </div>
  )
}
