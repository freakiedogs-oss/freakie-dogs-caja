import { useEffect, useRef, useState } from 'react'
import { db } from '../../supabase'
import { beepSOS } from '../supply-chain/sos'

// ── Píldora de cancelaciones por decidir (1-oct-2026) ─────────────────────────
// Complemento del aviso push: con el ERP abierto, en cualquier pantalla, quien
// puede decidir ve cuántas cancelaciones esperan y suena cuando entra una nueva.
// Revisa cada 30 s y al volver a la app. La base decide quién puede (gerente de
// la sucursal, primer aviso o grupo Frank/César/José): si no tiene sucursales,
// no se muestra nada.
const ROLES = ['gerente', 'ejecutivo', 'admin', 'superadmin']

export default function CancelacionesAlerta({ user, currentScreen, onNavigate }) {
  const [pend, setPend] = useState([])
  const vistos = useRef(null)
  const activo = ROLES.includes(user?.rol)

  useEffect(() => {
    if (!activo) return undefined
    let vivo = true
    const revisar = async () => {
      if (document.hidden) return
      const { data, error } = await db.rpc('cancelaciones_bandeja', { p_usuario_id: user.id, p_dias: 1 })
      if (!vivo || error || !data) return
      const p = (data.items || []).filter(c => c.estado === 'pendiente' && !c.es_mia)
      if (vistos.current && p.some(c => !vistos.current.has(c.id))) beepSOS()
      vistos.current = new Set(p.map(c => c.id))
      setPend(p)
    }
    revisar()
    const t = setInterval(revisar, 30000)
    const alVolver = () => { if (!document.hidden) revisar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [activo, user?.id])

  if (!activo || pend.length === 0 || currentScreen === 'cancelaciones') return null
  const viejo = Math.max(...pend.map(c => Number(c.minutos) || 0))
  return (
    <button
      onClick={() => onNavigate('cancelaciones')}
      style={{
        position: 'fixed', top: 54, left: '50%', transform: 'translateX(-50%)', zIndex: 69,
        background: viejo >= 15 ? '#dc2626' : '#d97706', color: '#fff', border: 'none', borderRadius: 999,
        padding: '10px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,.45)', maxWidth: 'calc(100vw - 32px)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      ↩️ {pend.length === 1 ? `Cancelación por decidir · ${pend[0].store_code}` : `${pend.length} cancelaciones por decidir`} · hace {viejo} min · Ver
    </button>
  )
}
