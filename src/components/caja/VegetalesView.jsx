// Módulo «Vegetales» — revisión de la compra de vegetales por sucursal y día.
// Lo llena la cajera en el Corte Z (VegetalesCierre → cierre_vegetales). Para Saúl (asesor,
// rol admin), gerencia y ejecutivos: una semana a la vez, todas las sucursales, con la foto
// de cada factura. Solo LEE.
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'
import { STORES, today } from '../../config'
import { semanaDe } from './VegetalesCierre'

const C = { card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92', ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444' }
const SUCS = ['M001', 'S001', 'S002', 'S003', 'S004', 'S006']
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const num = (v) => Number(v) || 0
const f$ = (v) => '$' + num(v).toFixed(2)
const fmtDia = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
const shift = (iso, dias) => { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y, m - 1, d + dias); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

export default function VegetalesView() {
  const hoy = today()
  const [ancla, setAncla] = useState(hoy)
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [sucFiltro, setSucFiltro] = useState('')
  const dias = useMemo(() => semanaDe(ancla), [ancla])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    db.from('cierre_vegetales').select('*').gte('fecha', dias[0]).lte('fecha', dias[6]).order('fecha', { ascending: false })
      .then(({ data }) => { if (vivo) { setFilas(data || []); setCargando(false) } })
      .catch(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [dias])

  const por = useMemo(() => { const m = {}; filas.forEach(r => { m[`${r.store_code}|${r.fecha}`] = r }); return m }, [filas])
  const sucs = sucFiltro ? [sucFiltro] : SUCS
  const visibles = filas.filter(r => SUCS.includes(r.store_code) && (!sucFiltro || r.store_code === sucFiltro))
  const tot = (k) => visibles.reduce((s, r) => s + num(r[k]), 0)
  const esFuturo = (f) => f > hoy

  const btn = { background: C.card, border: `1px solid ${C.line}`, color: C.txt, borderRadius: 9, padding: '6px 12px', fontSize: 16, cursor: 'pointer' }

  return (
    <div style={{ padding: '18px 14px 60px', color: C.txt, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ fontSize: 19, fontWeight: 800 }}>🥬 Vegetales por sucursal</div>
      <div style={{ fontSize: 12.5, color: C.dim, margin: '4px 0 14px' }}>
        Lo que cada sucursal registra en el Corte Z: si compró vegetales, libras de lechuga y tomate, monto, quién autorizó y la foto de la factura.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={btn} onClick={() => setAncla(shift(dias[0], -7))}>‹</button>
        <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>Semana {fmtDia(dias[0])} – {fmtDia(dias[6])}</span>
        <button style={{ ...btn, opacity: dias[6] >= hoy ? 0.35 : 1 }} disabled={dias[6] >= hoy} onClick={() => setAncla(shift(dias[0], 7))}>›</button>
        <select value={sucFiltro} onChange={(e) => setSucFiltro(e.target.value)}
          style={{ background: C.card, color: C.txt, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', fontSize: 13 }}>
          <option value="">Todas las sucursales</option>
          {SUCS.map(c => <option key={c} value={c}>{STORES[c] || c}</option>)}
        </select>
      </div>

      {/* Matriz sucursal × día */}
      <div style={{ overflowX: 'auto', marginBottom: 18 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10 }}>
          <thead>
            <tr style={{ color: C.dim, fontSize: 11.5 }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Sucursal</th>
              {dias.map((f, i) => <th key={f} style={{ padding: '8px 4px' }}>{DIAS[i]}<br /><span style={{ fontWeight: 400 }}>{fmtDia(f)}</span></th>)}
              <th style={{ padding: '8px 6px' }}>Compras</th>
            </tr>
          </thead>
          <tbody>
            {sucs.map(c => {
              const compras = dias.filter(f => por[`${c}|${f}`]?.comprado).length
              return (
                <tr key={c} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{STORES[c] || c}</td>
                  {dias.map(f => {
                    const r = por[`${c}|${f}`]
                    let t = '·', col = C.dim
                    if (r) { t = r.comprado ? '🥬' : '—'; col = C.txt }
                    else if (!esFuturo(f) && f < hoy) { t = '?'; col = C.warn }
                    return <td key={f} style={{ textAlign: 'center', padding: '8px 4px', color: col }} title={r ? '' : (f < hoy ? 'Sin registro' : '')}>{t}</td>
                  })}
                  <td style={{ textAlign: 'center', fontWeight: 700, color: compras > 3 ? C.bad : C.txt }}>{compras} / 3</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>🥬 compró · — no compró · ? sin registro de ese día · rojo = más de 3 requisiciones en la semana.</div>
      </div>

      {/* Totales */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {[['Lechuga', tot('lechuga_lb').toFixed(1) + ' lb'], ['Tomate', tot('tomate_lb').toFixed(1) + ' lb'], ['Facturas', f$(tot('monto'))]].map(([k, v]) => (
          <div key={k} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 16px' }}>
            <div style={{ fontSize: 11.5, color: C.dim }}>{k} (semana)</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Detalle */}
      {cargando ? <div style={{ color: C.dim }}>Cargando…</div> : visibles.length === 0 ? (
        <div style={{ color: C.dim, padding: 20, textAlign: 'center' }}>Sin registros de vegetales esta semana.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: C.dim, fontSize: 11.5, textAlign: 'left' }}>
                {['Día', 'Sucursal', 'Compró', 'Lechuga lb', 'Tomate lb', 'Monto', 'Autorizó', 'Factura', 'Registró'].map(h => <th key={h} style={{ padding: '6px 8px' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibles.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ padding: '8px' }}>{fmtDia(r.fecha)}</td>
                  <td style={{ padding: '8px' }}>{STORES[r.store_code] || r.store_code}</td>
                  <td style={{ padding: '8px' }}>{r.comprado ? 'Sí' : 'No'}</td>
                  <td style={{ padding: '8px' }}>{r.lechuga_lb ?? '—'}</td>
                  <td style={{ padding: '8px' }}>{r.tomate_lb ?? '—'}</td>
                  <td style={{ padding: '8px' }}>{r.monto != null ? f$(r.monto) : '—'}</td>
                  <td style={{ padding: '8px' }}>{r.autorizo || '—'}</td>
                  <td style={{ padding: '8px' }}>
                    {!r.comprado ? '—' : (r.foto_urls || []).length ? (
                      <span style={{ display: 'flex', gap: 4 }}>
                        {r.foto_urls.map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Factura" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.line}` }} /></a>
                        ))}
                      </span>
                    ) : <span style={{ color: r.sin_foto ? C.warn : C.bad }}>{r.sin_foto ? 'Sin foto (autorizado)' : 'Sin foto'}</span>}
                  </td>
                  <td style={{ padding: '8px', color: C.dim }}>{r.registrado_por || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
