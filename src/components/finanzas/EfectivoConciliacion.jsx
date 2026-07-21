import React, { useState, useEffect, useMemo } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'
import InfoTip from '../ui/InfoTip'

const fmt = n => (n == null || isNaN(+n)) ? '—' : (+n < 0 ? '-' : '') + '$' + Math.abs(+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function EfectivoConciliacion() {
  const [puente, setPuente] = useState(null)
  const [sucs, setSucs] = useState([])
  const [mes, setMes] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      db.from('v_efectivo_conciliacion_mensual').select('*'),
      db.from('v_ingreso_efectivo_sucursal_mensual').select('*'),
    ]).then(([p, s]) => {
      if (!alive) return
      const pr = (p.data || []).slice().sort((a, b) => a.mes < b.mes ? 1 : -1)
      setPuente(pr); setSucs(s.data || []); setMes(pr[0]?.mes || null)
    })
    return () => { alive = false }
  }, [])

  const r = useMemo(() => puente?.find(x => x.mes === mes) || {}, [puente, mes])
  const sucMes = useMemo(() => sucs.filter(x => x.mes === mes).sort((a, b) => (+b.efectivo_depositado) - (+a.efectivo_depositado)), [sucs, mes])
  if (!puente) return null

  const row = (label, val, tip, color) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: C.textMuted }}>{label}{tip && <InfoTip text={tip} />}</span>
      <span style={{ fontFamily: 'monospace', color: color || C.white, fontWeight: 600 }}>{fmt(val)}</span>
    </div>
  )
  return (
    <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.white }}>💵 Conciliación de efectivo <InfoTip text="Puente del efectivo: de las ventas en efectivo a lo que realmente llegó al banco. El faltante es dinero que debió depositarse y no aparece (más allá de la diferencia de caja)." /></div>
        <select value={mes || ''} onChange={e => setMes(e.target.value)} style={{ background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 9px', fontSize: 12, fontWeight: 700 }}>
          {puente.map(x => <option key={x.mes} value={x.mes}>{x.mes}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
        <div style={{ background: C.dark, borderRadius: 8, padding: 12 }}>
          {row('Ventas en efectivo', r.ventas_efectivo)}
          {row('(−) Usado en egresos + cambio', r.usado_egresos_y_cambio != null ? -Math.abs(r.usado_egresos_y_cambio) : null, 'Efectivo del cajón usado para pagar egresos de caja y para dar cambio — no llega al banco.')}
          <div style={{ borderTop: `1px solid ${C.border}`, margin: '4px 0' }} />
          {row('= Debería depositar', r.deberia_depositar, null, C.gold)}
          {row('Depositado en banco', r.depositado_banco, null, C.blue)}
          {row('= Faltante de depósito', r.faltante_deposito, 'Diferencia entre lo que debía depositarse y lo que realmente entró al banco. Negativo = falta dinero por depositar (timing o descuadre).', (+r.faltante_deposito < -0.5) ? '#f87171' : C.greenLight)}
        </div>
        <div style={{ background: C.dark, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Efectivo depositado por sucursal</div>
          {sucMes.length === 0 ? <div style={{ fontSize: 11, color: C.textMuted }}>Sin depósitos con sucursal identificada.</div> :
            sucMes.map(s => (
              <div key={s.store_code} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                <span style={{ color: C.white }}>{s.sucursal} <span style={{ color: C.textMuted, fontSize: 10 }}>· {s.store_code} · {s.n_depositos}</span></span>
                <span style={{ fontFamily: 'monospace', color: C.white }}>{fmt(s.efectivo_depositado)}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
