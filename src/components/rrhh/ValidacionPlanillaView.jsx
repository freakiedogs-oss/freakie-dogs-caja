import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { db } from '../../supabase'
import InfoTip from '../ui/InfoTip'

const ALLOWED = ['c67b81a8-d9d3-4be7-9e7b-daf7114f4331', '2ed69499-4ad4-4cee-b827-aac250e25125']
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ')
const money = (v) => (v == null || v === '') ? '—' : '$' + Number(v).toFixed(2)
const C = { bg: '#0f172a', card: '#1e293b', border: '#334155', text: '#e2e8f0', muted: '#94a3b8', red: '#ef4444', gold: '#f59e0b', green: '#22c55e', blue: '#3b82f6' }

// [key, header, tip, type, flag]
const COLS = [
  ['periodo', 'Período', 'Quincena, del nombre del archivo Excel.', 'text'],
  ['hoja_excel', 'Sucursal', 'Del EXCEL: la hoja donde aparece esa quincena.', 'text'],
  ['dui_bd', 'DUI (BD)', 'De la BASE DE DATOS: DUI del empleado con ese código (fuente limpia).', 'text'],
  ['cargo_excel', 'Cargo', 'Del EXCEL: cargo en la hoja de esa quincena.', 'text'],
  ['dias_excel', 'Días', 'Del EXCEL: días laborados en la quincena.', 'int'],
  ['salario_base_excel', 'Devengado Q', 'Del EXCEL: Salario Devengado Quincenal (base de la quincena). Es el número que se usa en TODOS los cálculos.', 'money'],
  ['salario_base_mensual', 'Base Mensual', 'Del EXCEL: Salario Base Mensual (informativo). ⚠️ A veces está desactualizado ($450 default) y no cuadra con el devengado real; usar el Devengado Q.', 'money'],
  ['total_mensual', 'Total Mensual', 'Del EXCEL: base + viático mensual (informativo).', 'money'],
  ['viatico_excel', 'Viático Q', 'Del EXCEL: viático quincenal. Se SUMA al pago.', 'money'],
  ['dias_extra_monto', 'Días Extra $', 'Del EXCEL: monto de días extra.', 'money'],
  ['he_diurna_monto', 'HE Diurna $', 'Del EXCEL: horas extra diurnas en $.', 'money'],
  ['he_nocturna_monto', 'HE Nocturna $', 'Del EXCEL: horas extra nocturnas en $.', 'money'],
  ['propina_excel', 'Propina', 'Del EXCEL: propina / comisión de la quincena.', 'money'],
  ['isss_empleado', 'ISSS emp', 'Del EXCEL: retención ISSS 3% del empleado. Va a la línea ISSS/AFP del P&L.', 'money'],
  ['afp_empleado', 'AFP emp', 'Del EXCEL: retención AFP 7.25% del empleado. Va a la línea ISSS/AFP.', 'money'],
  ['renta', 'Renta', 'Del EXCEL: retención de renta. Va a la línea ISSS/AFP.', 'money'],
  ['adelanto', 'Adelanto', 'Del EXCEL: anticipos que el empleado recibió en la quincena.', 'money'],
  ['total_deducciones', 'Total Deduc', 'Del EXCEL: ISSS + AFP + renta + adelanto.', 'money'],
  ['total_a_pagar', 'Total a Pagar', 'Del EXCEL: líquido = Devengado Q + Viático + Extras + Propina − ISSS − AFP − Renta − Adelanto.', 'money'],
  ['pago_liquido', 'Pago Líquido', 'PAGO LÍQUIDO = Total a Pagar + Adelanto. Alimenta la línea Planilla del P&L (incluye horas/días extra y propina; excluye ISSS/AFP/renta).', 'money', 'hi'],
  ['isss_patronal', 'ISSS patrono', 'Del EXCEL: ISSS patronal 7.5%. Va a la línea ISSS/AFP.', 'money'],
  ['afp_patronal', 'AFP patrono', 'Del EXCEL: AFP patronal 8.75%. Va a la línea ISSS/AFP.', 'money'],
  ['salario_sujeto_renta', 'Sujeto Renta', 'Del EXCEL: base sobre la que se calcula la renta.', 'money'],
  ['cuenta_bancaria', 'Cuenta', 'Del EXCEL: cuenta bancaria.', 'text'],
  ['observaciones', 'Obs', 'Del EXCEL: observaciones.', 'text'],
]

export default function ValidacionPlanillaView({ user }) {
  if (!ALLOWED.includes(user?.id) && user?.rol !== 'superadmin') {
    return <div style={{ padding: 40, textAlign: 'center', color: C.red, fontWeight: 700 }}>⛔ Acceso restringido — solo Jose y Majo</div>
  }
  const [rows, setRows] = useState([]); const [emps, setEmps] = useState([]); const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState('todos'); const [soloRev, setSoloRev] = useState(false); const [q, setQ] = useState('')
  const [editId, setEditId] = useState(null); const [empQ, setEmpQ] = useState('')

  const fetchAll = useCallback(async (table, select, order) => {
    let all = [], from = 0; const size = 1000
    while (true) {
      let query = db.from(table).select(select).range(from, from + size - 1)
      if (order) query = query.order(order)
      const { data, error } = await query
      if (error) { console.error(table, error); break }
      all = all.concat(data || []); if (!data || data.length < size) break; from += size
    }
    return all
  }, [])
  const load = useCallback(async () => {
    setLoading(true)
    const [v, e] = await Promise.all([
      fetchAll('v_planilla_validacion', '*', 'periodo'),
      fetchAll('empleados', 'id,codigo_empleado,nombre_completo,dui,activo,cargo', 'codigo_empleado'),
    ])
    setRows(v); setEmps(e); setLoading(false)
  }, [fetchAll])
  useEffect(() => { load() }, [load])

  const periodos = useMemo(() => [...new Set(rows.map(r => r.periodo))].sort(), [rows])
  const necesitaRev = (r) => r.estado !== 'validado' && (r.es_nuevo || norm(r.nombre_excel) !== norm(r.nombre_bd))
  const revCount = useMemo(() => rows.filter(necesitaRev).length, [rows])
  const filtered = useMemo(() => rows.filter(r => {
    if (periodo !== 'todos' && r.periodo !== periodo) return false
    if (soloRev && !necesitaRev(r)) return false
    if (q) { const s = q.toLowerCase(); if (!((r.nombre_excel || '').toLowerCase().includes(s) || (r.nombre_bd || '').toLowerCase().includes(s) || (r.codigo_asignado || '').toLowerCase().includes(s))) return false }
    return true
  }), [rows, periodo, soloRev, q])
  const empMatches = useMemo(() => {
    if (!empQ) return []
    const s = empQ.toLowerCase()
    return emps.filter(e => (e.nombre_completo || '').toLowerCase().includes(s) || (e.codigo_empleado || '').toLowerCase().includes(s)).slice(0, 10)
  }, [empQ, emps])

  const reasignar = async (row, e) => {
    const { error } = await db.rpc('fn_planilla_valid_reasignar', { p_id: row.id, p_empleado_id: e.id })
    if (error) { alert('Error: ' + error.message); return }
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, empleado_id: e.id, codigo_asignado: e.codigo_empleado, nombre_bd: e.nombre_completo, dui_bd: e.dui, estado: 'validado', es_nuevo: false } : r))
    setEditId(null); setEmpQ('')
  }
  const confirmar = async (row) => {
    const { error } = await db.rpc('fn_planilla_valid_confirmar', { p_id: row.id })
    if (error) { alert('Error: ' + error.message); return }
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, estado: 'validado' } : r))
  }

  const th = { padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: C.muted, textAlign: 'left', position: 'sticky', top: 0, background: C.card, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '5px 8px', fontSize: 11, color: C.text, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
  const cell = (r, c) => {
    const v = r[c[0]]
    if (c[3] === 'money') return money(v)
    if (c[3] === 'int') return v ?? '—'
    return v || '—'
  }

  return (
    <div style={{ padding: '12px 8px', color: C.text }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: C.red, fontWeight: 800 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Validación de Planilla · Base Canónica</div>
        <div style={{ fontSize: 11, color: C.muted }}>Todas las columnas del Excel, auditadas por quincena. Pasa el cursor sobre la ⓘ de cada columna para ver su fuente y fórmula. La tabla scrollea horizontal →</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px' }}><div style={{ fontSize: 10, color: C.muted }}>Filas Excel</div><div style={{ fontSize: 18, fontWeight: 800 }}>{rows.length}</div></div>
        <div style={{ background: C.card, border: `1px solid ${C.gold}`, borderRadius: 8, padding: '6px 12px' }}><div style={{ fontSize: 10, color: C.gold }}>Requieren revisión</div><div style={{ fontSize: 18, fontWeight: 800, color: C.gold }}>{revCount}</div></div>
        <div style={{ background: C.card, border: `1px solid ${C.green}`, borderRadius: 8, padding: '6px 12px' }}><div style={{ fontSize: 10, color: C.green }}>Σ Pago Líquido (filtro)</div><div style={{ fontSize: 18, fontWeight: 800, color: C.green }}>{money(filtered.reduce((a, r) => a + (Number(r.pago_liquido) || 0), 0))}</div></div>
        <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12 }}>
          <option value="todos">Todos los períodos</option>{periodos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={soloRev} onChange={e => setSoloRev(e.target.checked)} /> Solo revisión</label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre / código…" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, flex: 1, minWidth: 140 }} />
        <button onClick={load} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>↻ Recargar</button>
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Cargando…</div> : (
        <div style={{ overflow: 'auto', maxHeight: '74vh', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Nombre (Excel) <InfoTip text="Del EXCEL: nombre tal cual en la hoja de esa quincena. Es lo que se valida contra el código." /></th>
              <th style={th}>Código <InfoTip text="Código único del empleado (EMP-xxx) asignado. Reasignable." /></th>
              <th style={th}>Nombre (BD) <InfoTip text="De la BASE DE DATOS: nombre oficial del empleado con ese código." /></th>
              <th style={th}>Estado <InfoTip text="nuevo = sin asignar · revisar = nombre Excel ≠ BD · validado/ok = confirmado." /></th>
              {COLS.map(c => <th key={c[0]} style={{ ...th, ...(c[4] === 'hi' ? { color: C.green } : {}) }}>{c[1]} <InfoTip text={c[2]} /></th>)}
              <th style={th}>Acción</th>
            </tr></thead>
            <tbody>
              {filtered.map(r => {
                const rev = necesitaRev(r)
                return (
                  <tr key={r.id} style={{ background: rev ? '#3b1a1a' : 'transparent' }}>
                    <td style={{ ...td, fontWeight: 600, position: 'sticky', left: 0, background: rev ? '#3b1a1a' : C.bg, zIndex: 1 }}>{r.nombre_excel}</td>
                    <td style={{ ...td, color: C.gold, fontWeight: 700 }}>{r.codigo_asignado || '—'}</td>
                    <td style={{ ...td, color: rev ? C.red : C.text }}>{r.nombre_bd || 'SIN ASIGNAR'}</td>
                    <td style={td}>{r.estado === 'validado' ? <span style={{ color: C.green }}>✓ validado</span> : r.es_nuevo ? <span style={{ color: C.red }}>● nuevo</span> : rev ? <span style={{ color: C.gold }}>● revisar</span> : <span style={{ color: C.green }}>● ok</span>}</td>
                    {COLS.map(c => <td key={c[0]} style={{ ...td, ...(c[4] === 'hi' ? { fontWeight: 800, color: C.green } : {}), ...(c[0] === 'adelanto' && r.adelanto ? { color: C.gold } : {}) }}>{cell(r, c)}</td>)}
                    <td style={{ ...td, position: 'sticky', right: 0, background: rev ? '#3b1a1a' : C.bg }}>
                      {editId === r.id ? (
                        <div style={{ position: 'relative' }}>
                          <input autoFocus value={empQ} onChange={e => setEmpQ(e.target.value)} placeholder="buscar…" style={{ background: C.bg, color: C.text, border: `1px solid ${C.blue}`, borderRadius: 4, padding: '3px 6px', fontSize: 11, width: 150 }} />
                          {empMatches.length > 0 && (
                            <div style={{ position: 'absolute', zIndex: 5, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, marginTop: 2, width: 240, maxHeight: 220, overflow: 'auto' }}>
                              {empMatches.map(e => (<div key={e.id} onClick={() => reasignar(r, e)} style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}><b style={{ color: C.gold }}>{e.codigo_empleado}</b> · {e.nombre_completo}{!e.activo && <span style={{ color: C.muted }}> (inact.)</span>}</div>))}
                            </div>
                          )}
                          <button onClick={() => { setEditId(null); setEmpQ('') }} style={{ marginLeft: 4, fontSize: 10, background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => { setEditId(r.id); setEmpQ('') }} style={{ background: rev && r.es_nuevo ? C.gold : C.card, color: rev && r.es_nuevo ? '#000' : C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>Reasignar</button>
                          {rev && !r.es_nuevo && <button onClick={() => confirmar(r)} style={{ background: C.green, color: '#052e16', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>✓</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>{filtered.length} de {rows.length} filas · <b style={{ color: C.green }}>Pago Líquido</b> = Total a Pagar + Adelanto → línea Planilla del P&L. Filas rojas: nombre Excel ≠ BD → Confirmar (misma persona) o Reasignar (otra).</div>
    </div>
  )
}
