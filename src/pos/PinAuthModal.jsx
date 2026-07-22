import { useState } from 'react'
import { db } from './supabase'
import Icon from './Icon'

// Roles que pueden AUTORIZAR (eliminar ítems comandados / anular cuenta)
export const ROLES_AUTORIZA = ['cajero', 'cajera', 'gerente', 'admin', 'ejecutivo', 'superadmin']

// Modal de autorización por PIN. Valida contra usuarios_erp y exige un rol autorizado.
// onSuccess recibe el usuario que autorizó { id, nombre, apellido, rol }.
export default function PinAuthModal({ titulo = 'Autorización requerida', subtitulo, onSuccess, onCancel, roles = ROLES_AUTORIZA }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [checking, setChecking] = useState(false)

  const press = (d) => { setErr(''); setPin(p => (p + d).slice(0, 6)) }
  const back  = () => { setErr(''); setPin(p => p.slice(0, -1)) }

  const validar = async () => {
    if (pin.length < 4 || checking) return
    setChecking(true); setErr('')
    const { data, error } = await db
      .from('usuarios_erp')
      .select('id, nombre, apellido, rol')
      .eq('pin', pin).eq('activo', true).maybeSingle()
    setChecking(false)
    if (error || !data) { setErr('PIN incorrecto'); setPin(''); return }
    if (!roles.includes(data.rol)) { setErr(`${data.nombre}: ese rol no puede autorizar`); setPin(''); return }
    onSuccess(data)
  }

  return (
    <div className="pos-modal-overlay" onClick={onCancel}>
      <div className="pos-modal pin-auth" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
        <div className="pos-modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={18} color="#E62329" /> {titulo}
        </div>
        {subtitulo && <div style={{ color: '#9a9088', fontSize: 12, margin: '2px 0 8px' }}>{subtitulo}</div>}
        <div style={{ color: '#8b8997', fontSize: 12, margin: '6px 0 12px' }}>Ingresa el PIN de cajera o gerente</div>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'center', margin: '2px 0 14px' }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: pin.length > i ? '#E62329' : '#2a2a32', border: '2px solid ' + (pin.length > i ? '#E62329' : '#2a2a32'), transition: 'all .1s' }} />
          ))}
        </div>
        {err && <div style={{ color: '#f87171', fontSize: 13, textAlign: 'center', marginBottom: 10 }}>{err}</div>}
        <div className="pin-keypad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button key={n} className="pin-key" onClick={() => press(String(n))}>{n}</button>
          ))}
          <button className="pin-key pin-key-sec" onClick={back}>⌫</button>
          <button className="pin-key" onClick={() => press('0')}>0</button>
          <button className="pin-key pin-key-ok" disabled={pin.length < 4 || checking} onClick={validar}>{checking ? '…' : 'OK'}</button>
        </div>
        <button className="pin-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
