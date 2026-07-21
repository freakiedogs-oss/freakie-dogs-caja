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
  const [cats, setCats] = useState({}); const [subs, setSubs] = useState({})
  const [dtes, setDtes] = useState({}); const [sel, setSel] = useState({})
  const [msg, setMsg] = useState(null)

  const load = () => db.from('v_banco_por_clasificar').select('*').then(({ data }) => {
    const d = (data || []).slice().sort((a, b) => a.fecha < b.fecha ? 1 : -1)
    setRows(d); setMes(m => m || [...new Set(d.map(x => x.mes))].sort().reverse()[0] || null)
  })
  useEffect(() => { load() }, [])

  const meses = useMemo(() => [...new Set((rows || []).map(x => x.mes))].sort().reverse(), [rows])
  const list = useMemo(() => (rows || []).filter(x => x.mes === mes), [rows, mes])
  const totalMes = useMemo(() => list.reduce((s, x) => s + (+x.debito || 0), 0), [list])

  const catOf = d => cats[d.id] ?? (d.categoria_sugerida && CATS.includes(d.categoria_sugerida) ? d.categoria_sugerida : 'gastos_operativos')
  const subOf = d => subs[d.id] ?? (d.subcategoria_sugerida || '')

  async function revisar(d, destino) {
    setBusy(d.id); setMsg(null)
    const { error } = await db.rpc('fn_banco_revisar', { p_id: d.id, p_destino: destino, p_usuario: 'pl-inline',
      p_categoria: destino === 'pl_directo' ? catOf(d) : null, p_subcategoria: destino === 'pl_directo' ? (subOf(d) || null) : null })
    setBusy(null)
    if (error) return setMsg('⚠️ ' + error.message)
    setRows(rs => rs.filter(x => x.id !== d.id))
  }
  async function sugerir(id) { setBusy(id); const { data } = await db.rpc('fn_banco_sugerir_dte', { p_id: id }); setBusy(null); setDtes(x => ({ ...x, [id]: data || [] })) }
  function toggle(id, dteId) { setSel(s => { const cur = new Set(s[id] || []); cur.has(dteId) ? cur.delete(dteId) : cur.add(dteId); return { ...s, [id]: cur } }) }
  async function aplicarDtes(d) {
    const arr = [...(sel[d.id] || [])]; if (!arr.length) return
    setBusy(d.id); const { error } = await db.rpc('fn_banco_revisar_multi_dte', { p_id: d.id, p_dtes: arr, p_usuario: 'pl-inline' })
    setBusy(null); if (error) return setMsg('⚠️ ' + error.message)
    setRows(rs => rs.filter(x => x.id !== d.id))
  }

  if (!rows) return null
  const btn = (bg) => ({ padding: '3px 8px', fontSize: 10, fontWeight: 700, border: 'none', borderRadius: 5, cursor: 'pointer', color: '#fff', background: bg })
  const inp = { fontSize: 10, background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 5px' }
  return (
    <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.red}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.white }}>🧩 Débitos por clasificar <InfoTip text="Débitos que el sistema no clasificó solo. NO suman al P&L hasta clasificarlos: Gasto P&L (categoría+subcategoría), Vía DTE (uno o varios si la transferencia pagó varias facturas) o No P&L. Al clasificar, el sistema APRENDE la regla por número de cuenta y auto-clasifica lo que entre igual después." /> <span style={{ fontSize: 11, color: C.textMuted }}>· {list.length} · {fmt(totalMes)}</span></div>
        <select value={mes || ''} onChange={e => setMes(e.target.value)} style={{ ...inp, fontSize: 12, fontWeight: 700, padding: '5px 9px' }}>
          {meses.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {msg && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6 }}>{msg}</div>}
      {list.length === 0 ? <div style={{ fontSize: 12, color: C.greenLight }}>✓ Nada por clasificar este mes.</div> :
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {list.map(d => (
          <div key={d.id} style={{ borderBottom: `1px solid ${C.border}55`, padding: '8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: C.white, fontWeight: 700 }}>{d.cuenta_destino || d.descripcion}{d.cuenta_destino && d.sugerido_origen && d.sugerido_origen !== 'freakie' && <span style={{ fontSize: 9, color: C.gold }}> · vía {d.sugerido_origen}</span>}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.white, whiteSpace: 'nowrap' }}>{fmt(d.debito)}</span>
            </div>
            <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 4 }}>{d.cuenta_destino ? d.descripcion + ' · ' : ''}{String(d.fecha).slice(0, 10)}{d.destino_pl ? ' · auto: ' + d.destino_pl : ''}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={catOf(d)} onChange={e => setCats(c => ({ ...c, [d.id]: e.target.value }))} style={inp}>
                {CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="subcategoría" value={subOf(d)} onChange={e => setSubs(s => ({ ...s, [d.id]: e.target.value }))} style={{ ...inp, width: 120 }} />
              <button disabled={busy === d.id} style={btn('#2d6a4f')} onClick={() => revisar(d, 'pl_directo')}>Gasto P&L</button>
              <button disabled={busy === d.id} style={btn(C.gray)} onClick={() => revisar(d, 'no_pl')}>No P&L</button>
              <button disabled={busy === d.id} style={btn(C.blue)} onClick={() => sugerir(d.id)}>Vía DTE ▾</button>
            </div>
            {dtes[d.id] && (
              <div style={{ marginTop: 5, paddingLeft: 8 }}>
                {dtes[d.id].length === 0 ? <span style={{ fontSize: 10, color: C.textMuted }}>Sin DTEs candidatos.</span> : <>
                  {dtes[d.id].map(c => (
                    <label key={c.dte_id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: C.white, marginBottom: 2, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!(sel[d.id] && sel[d.id].has(c.dte_id))} onChange={() => toggle(d.id, c.dte_id)} />
                      {c.proveedor} · {fmt(c.monto)} · {String(c.fecha).slice(0, 10)} · Δ{c.delta_dias}d
                    </label>
                  ))}
                  <button disabled={busy === d.id || !(sel[d.id] && sel[d.id].size)} style={{ ...btn(C.blue), marginTop: 3 }} onClick={() => aplicarDtes(d)}>Aplicar {sel[d.id] ? sel[d.id].size : 0} DTE(s)</button>
                </>}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  )
}
