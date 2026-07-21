import React, { useState, useEffect, useMemo } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'
import InfoTip from '../ui/InfoTip'

const fmt = n => (n == null || isNaN(+n)) ? '—' : '$' + Math.abs(+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CATS = ['costo_comida','insumo_venta','limpieza','costo_fijo','gastos_operativos','gastos_logisticos','gasto_financiero','impuestos_dgii','activo_fijo']

export default function DebitosPorClasificar() {
  const [rows, setRows] = useState(null)
  const [mes, setMes] = useState(null)
  const [busy, setBusy] = useState(null)
  const [cats, setCats] = useState({})   // {id: categoria}
  const [dtes, setDtes] = useState({})   // {id: [candidatos]}
  const [msg, setMsg] = useState(null)

  const load = () => db.from('v_banco_por_clasificar').select('*').then(({ data }) => {
    const d = (data || []).slice().sort((a, b) => a.fecha < b.fecha ? 1 : -1)
    setRows(d); setMes(m => m || [...new Set(d.map(x => x.mes))].sort().reverse()[0] || null)
  })
  useEffect(() => { load() }, [])

  const meses = useMemo(() => [...new Set((rows || []).map(x => x.mes))].sort().reverse(), [rows])
  const list = useMemo(() => (rows || []).filter(x => x.mes === mes), [rows, mes])
  const totalMes = useMemo(() => list.reduce((s, x) => s + (+x.debito || 0), 0), [list])

  async function revisar(id, destino, extra = {}) {
    setBusy(id); setMsg(null)
    const { error } = await db.rpc('fn_banco_revisar', { p_id: id, p_destino: destino, p_usuario: 'pl-inline', p_categoria: extra.cat || null, p_dte: extra.dte || null })
    setBusy(null)
    if (error) { setMsg('⚠️ ' + error.message); return }
    setRows(rs => rs.filter(x => x.id !== id))   // ya clasificado → sale de la lista
  }
  async function sugerir(id) {
    setBusy(id)
    const { data } = await db.rpc('fn_banco_sugerir_dte', { p_id: id })
    setBusy(null); setDtes(d => ({ ...d, [id]: data || [] }))
  }

  if (!rows) return null
  const btn = (bg) => ({ padding: '3px 8px', fontSize: 10, fontWeight: 700, border: 'none', borderRadius: 5, cursor: 'pointer', color: '#fff', background: bg })
  return (
    <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.red}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.white }}>🧩 Débitos por clasificar <InfoTip text="Débitos del banco que el sistema no pudo clasificar solo. NO suman al P&L hasta que los clasifiques aquí: Gasto P&L (con categoría), Vía DTE (si pagan una factura, para no doble contar), o No P&L (traslado/socio)." /> <span style={{ fontSize: 11, color: C.textMuted }}>· {list.length} · {fmt(totalMes)}</span></div>
        <select value={mes || ''} onChange={e => setMes(e.target.value)} style={{ background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 9px', fontSize: 12, fontWeight: 700 }}>
          {meses.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {msg && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6 }}>{msg}</div>}
      {list.length === 0 ? <div style={{ fontSize: 12, color: C.greenLight }}>✓ Nada por clasificar este mes.</div> :
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {list.map(d => (
          <div key={d.id} style={{ borderBottom: `1px solid ${C.border}55`, padding: '7px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: C.white }}>{d.descripcion}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.white, whiteSpace: 'nowrap' }}>{fmt(d.debito)}</span>
            </div>
            <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 4 }}>{String(d.fecha).slice(0, 10)}{d.destino_pl ? ' · auto: ' + d.destino_pl : ''}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={cats[d.id] || 'gastos_operativos'} onChange={e => setCats(c => ({ ...c, [d.id]: e.target.value }))} style={{ fontSize: 10, background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 4px' }}>
                {CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button disabled={busy === d.id} style={btn('#2d6a4f')} onClick={() => revisar(d.id, 'pl_directo', { cat: cats[d.id] || 'gastos_operativos' })}>Gasto P&L</button>
              <button disabled={busy === d.id} style={btn(C.gray)} onClick={() => revisar(d.id, 'no_pl')}>No P&L</button>
              <button disabled={busy === d.id} style={btn(C.blue)} onClick={() => sugerir(d.id)}>Vía DTE ▾</button>
            </div>
            {dtes[d.id] && (
              <div style={{ marginTop: 5, paddingLeft: 8 }}>
                {dtes[d.id].length === 0 ? <span style={{ fontSize: 10, color: C.textMuted }}>Sin DTEs candidatos.</span> :
                  dtes[d.id].map(c => (
                    <button key={c.dte_id} disabled={busy === d.id} style={{ ...btn(C.cardAlt), display: 'block', marginBottom: 3, textAlign: 'left', border: `1px solid ${C.blue}` }}
                      onClick={() => revisar(d.id, 'dte', { dte: c.dte_id })}>
                      {c.proveedor} · {fmt(c.monto)} · {String(c.fecha).slice(0, 10)} · Δ{c.delta_dias}d
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  )
}
