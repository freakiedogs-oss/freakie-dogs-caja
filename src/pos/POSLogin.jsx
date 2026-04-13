import { useState } from 'react'
import { db } from '../supabase'

// Roles que pueden usar el POS
const POS_ROLES = ['cajero', 'cajera', 'mesero', 'mesera', 'cocina', 'gerente', 'admin', 'ejecutivo', 'superadmin']

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
      if (data) {
        if (!POS_ROLES.includes(data.rol)) {
          setErr('Sin acceso al POS'); setPin(''); return
        }
        onLogin(data); return
      }
      // PIN de 4-5 dígitos sin match: seguir esperando más dígitos
      if (np.length < 6) return
      // 6 dígitos sin match: error y resetear
      setErr('PIN incorrecto'); setPin('')
    }
  }

  const keys = ['1','2','3','4','5','6','7','8','9','','0','del']

  return (
    <div style={{
      minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#141418', padding: '0 24px'
    }}>
      <img
        src="/icon-192.png"
        alt="Freakie Dogs"
        style={{ width: 120, height: 120, borderRadius: 20, marginBottom: 12, objectFit: 'contain' }}
      />
      <div style={{ fontWeight: 800, fontSize: 22, color: '#ff6b35' }}>
        Freakie Dogs
      </div>
      <div style={{ color: '#8b8997', fontSize: 12, marginTop: 3, marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
        Punto de Venta
      </div>
      <div style={{ color: '#8b8997', fontSize: 12, marginBottom: 32 }}>
        Ingresa tu PIN
      </div>

      {/* Dots */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: '50%',
            background: pin.length > i ? '#ff6b35' : '#2a2a32',
            border: '2px solid ' + (pin.length > i ? '#ff6b35' : '#2a2a32'),
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
            background: k === 'del' ? '#1e1e26' : '#1c1c22',
            color: '#e8e6ef', fontSize: k === 'del' ? 18 : 20,
            fontWeight: 700, cursor: 'pointer',
            border: '1px solid #2a2a32', transition: 'background 0.1s'
          }}
            onMouseOver={e => e.currentTarget.style.background = '#2a2a32'}
            onMouseOut={e => e.currentTarget.style.background = k === 'del' ? '#1e1e26' : '#1c1c22'}
          >
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 40, fontSize: 11, color: '#6b6878' }}>
        Freakie Dogs POS v1.0
      </div>
    </div>
  )
}
