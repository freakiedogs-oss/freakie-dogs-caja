/* Personas en la mesa (6-nov-2026, pedido de Cesar).
   A veces llegan clientes después de abrir la mesa y el ticket por persona queda mal.
   Este modal corrige mujeres / hombres / niños de una cuenta abierta (pos_cuentas.pax_*;
   pax_total es columna generada). Se usa desde el plano (mantener presionada la mesa) y
   desde la pantalla de la cuenta (chip «👥 N · editar»).
   Ticket por persona = total ÷ (mujeres + hombres), igual que HistorialCobros. */
import { useState } from 'react'
import { db } from '../../supabase'

const FILAS = [{ k: 'm', label: 'Mujeres' }, { k: 'h', label: 'Hombres' }, { k: 'k', label: 'Niños' }]

export default function PaxEditorModal({ cuentaId, mesaRef, total = 0, inicial, onClose, onSaved }) {
  const [pax, setPax] = useState({
    m: Number(inicial?.mujeres) || 0,
    h: Number(inicial?.hombres) || 0,
    k: Number(inicial?.ninos) || 0,
  })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState('')

  const bump = (k, d) => setPax(p => ({ ...p, [k]: Math.max(0, p[k] + d) }))
  const adultos = pax.m + pax.h
  const totalPax = adultos + pax.k
  const porPersona = adultos > 0 ? (Number(total) || 0) / adultos : null

  const guardar = async () => {
    if (totalPax === 0) return
    // Mesa recién abierta sin cuenta todavía: solo se corrige lo que se va a guardar al comandar.
    if (!cuentaId) { onSaved?.({ mujeres: pax.m, hombres: pax.h, ninos: pax.k, total: totalPax }); onClose?.(); return }
    setGuardando(true); setErr('')
    const { error } = await db.from('pos_cuentas')
      .update({ pax_mujeres: pax.m, pax_hombres: pax.h, pax_ninos: pax.k, updated_at: new Date().toISOString() })
      .eq('id', cuentaId)
    setGuardando(false)
    if (error) { setErr(error.message || 'No se pudo guardar'); return }
    onSaved?.({ mujeres: pax.m, hombres: pax.h, ninos: pax.k, total: totalPax })
    onClose?.()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1f1c19', border: '1px solid #3a342e', borderRadius: 14,
                                                     padding: 18, width: 'min(340px, 100%)', color: '#f5efe6' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>👥 Personas en la mesa {mesaRef || ''}</div>
        <div style={{ color: '#9a9088', fontSize: 12.5, margin: '2px 0 10px' }}>Si llegaron más clientes, sumalos aquí.</div>

        {FILAS.map(f => (
          <div key={f.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #2a2622' }}>
            <span style={{ fontSize: 15 }}>{f.label}</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={() => bump(f.k, -1)} style={btn}>−</button>
              <span style={{ minWidth: 24, textAlign: 'center', fontSize: 19, fontWeight: 800 }}>{pax[f.k]}</span>
              <button onClick={() => bump(f.k, 1)} style={btn}>+</button>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 4px' }}>
          <span style={{ color: '#9a9088' }}>Total en la mesa</span>
          <b style={{ color: '#FFD900', fontSize: 22 }}>{totalPax}</b>
        </div>
        <div style={{ color: '#9a9088', fontSize: 12.5 }}>
          Ticket por persona: <b style={{ color: '#f5efe6' }}>{porPersona != null ? `$${porPersona.toFixed(2)}` : '—'}</b>
          <span style={{ fontSize: 11 }}> (sin contar niños)</span>
        </div>
        {err && <div style={{ color: '#fca5a5', fontSize: 12.5, marginTop: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ flex: 1, background: 'none', border: '1px solid #3a342e', color: '#9a9088', borderRadius: 10, padding: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          <button onClick={guardar} disabled={guardando || totalPax === 0}
            style={{ flex: 2, background: '#FFD900', color: '#1a1200', border: 0, borderRadius: 10, padding: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: guardando || totalPax === 0 ? .5 : 1 }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

const btn = { width: 38, height: 38, borderRadius: 10, border: 0, background: '#2a2622', color: '#fff', fontSize: 20, cursor: 'pointer', fontFamily: 'inherit' }
