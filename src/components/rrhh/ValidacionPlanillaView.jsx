import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'

const ALLOWED = ['c67b81a8-d9d3-4be7-9e7b-daf7114f4331', '2ed69499-4ad4-4cee-b827-aac250e25125']
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ')
const money = (v) => (v == null || v === '') ? '—' : '$' + Number(v).toFixed(2)
const C = { bg: '#0f172a', card: '#1e293b', border: '#334155', text: '#e2e8f0', muted: '#94a3b8', red: '#ef4444', gold: '#f59e0b', green: '#22c55e', blue: '#3b82f6' }

export default function ValidacionPlanillaView({ user }) {
  if (!ALLOWED.includes(user?.id)) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.red, fontWeight: 700 }}>⛔ Acceso restringido — solo Jose y Majo</div>
  }
  const [rows, setRows] = useState([])
  const [emps, setEmps] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState('todos')
  const [soloRev, setSoloRev] = useState(false)
  const [q, setQ] = useState('')
  const [editId, setEditId] = useState(null)
  const [empQ, setEmpQ] = useState('')

  const fetchAll = useCallback(async (table, select, order) => {
    let all = [], from = 0; const size = 1000
    while (true) {
      let query = db.from(table).select(select).range(from, from + size - 1)
      if (order) query = query.order(order)
      const { data, error } = await query
      if (error) { console.error(table, error); break }
      all = all.concat(data || [])
      if (!data || data.length < size) break
      from += size
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
  const necesitaRev = (r) => r.es_nuevo || norm(r.nombre_excel) !== norm(r.nombre_bd)
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
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, empleado_id: e.id, codigo_asignado: e.codigo_empleado, nombre_bd: e.nombre_completo, cargo_bd: e.cargo, estado: 'validado', es_nuevo: false } : r))
    setEditId(null); setEmpQ('')
  }

  const th = { padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: C.muted, textAlign: 'left', position: 'sticky', top: 0, background: C.card, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '5px 8px', fontSize: 11, color: C.text, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: '12px 8px', maxWidth: 1500, margin: '0 auto', color: C.text }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: C.red, fontWeight: 800 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Validación de Planilla · Nombre Excel → Código Empleado</div>
        <div style={{ fontSize: 11, color: C.muted }}>Valida a qué código de empleado corresponde cada nombre del Excel, por quincena. Reasigna donde el nombre del Excel no cuadre con el de la base de datos.</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px' }}>
          <div style={{ fontSize: 10, color: C.muted }}>Filas Excel</div><div style={{ fontSize: 18, fontWeight: 800 }}>{rows.length}</div>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.gold}`, borderRadius: 8, padding: '6px 12px' }}>
          <div style={{ fontSize: 10, color: C.gold }}>Requieren revisión</div><div style={{ fontSize: 18, fontWeight: 800, color: C.gold }}>{revCount}</div>
        </div>
        <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12 }}>
          <option value="todos">Todos los períodos</option>
          {periodos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloRev} onChange={e => setSoloRev(e.target.checked)} /> Solo revisión
        </label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre / código…" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, flex: 1, minWidth: 160 }} />
        <button onClick={load} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>↻ Recargar</button>
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Cargando…</div> : (
        <div style={{ overflow: 'auto', maxHeight: '70vh', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={th}>Nombre (Excel)</th><th style={th}>Código</th><th style={th}>Nombre (BD)</th><th style={th}>Estado</th>
              <th style={th}>Período</th><th style={th}>Sucursal (Excel)</th><th style={th}>DUI</th><th style={th}>Cargo</th>
              <th style={th}>Días</th><th style={th}>Base</th><th style={th}>Viático</th><th style={th}>Propina</th><th style={th}>Devengado</th><th style={th}>Acción</th>
            </tr></thead>
            <tbody>
              {filtered.map(r => {
                const rev = necesitaRev(r)
                return (
                  <tr key={r.id} style={{ background: rev ? '#3b1a1a' : 'transparent' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.nombre_excel}</td>
                    <td style={{ ...td, color: C.gold, fontWeight: 700 }}>{r.codigo_asignado || '—'}</td>
                    <td style={{ ...td, color: rev ? C.red : C.text }}>{r.nombre_bd || 'SIN ASIGNAR'}</td>
                    <td style={td}>{r.es_nuevo ? <span style={{ color: C.red }}>● nuevo</span> : rev ? <span style={{ color: C.gold }}>● revisar</span> : r.estado === 'validado' ? <span style={{ color: C.green }}>✓ validado</span> : <span style={{ color: C.green }}>● ok</span>}</td>
                    <td style={td}>{r.periodo}</td><td style={td}>{r.hoja_excel}</td><td style={td}>{r.dui_excel || '—'}</td><td style={td}>{r.cargo_excel || '—'}</td>
                    <td style={td}>{r.dias_excel ?? '—'}</td><td style={td}>{money(r.salario_base_excel)}</td><td style={td}>{money(r.viatico_excel)}</td><td style={td}>{money(r.propina_excel)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{money(r.devengado_excel)}</td>
                    <td style={td}>
                      {editId === r.id ? (
                        <div style={{ position: 'relative' }}>
                          <input autoFocus value={empQ} onChange={e => setEmpQ(e.target.value)} placeholder="buscar empleado…" style={{ background: C.bg, color: C.text, border: `1px solid ${C.blue}`, borderRadius: 4, padding: '3px 6px', fontSize: 11, width: 180 }} />
                          {empMatches.length > 0 && (
                            <div style={{ position: 'absolute', zIndex: 5, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, marginTop: 2, width: 250, maxHeight: 220, overflow: 'auto' }}>
                              {empMatches.map(e => (
                                <div key={e.id} onClick={() => reasignar(r, e)} style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
                                  <b style={{ color: C.gold }}>{e.codigo_empleado}</b> · {e.nombre_completo}{!e.activo && <span style={{ color: C.muted }}> (inactivo)</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          <button onClick={() => { setEditId(null); setEmpQ('') }} style={{ marginLeft: 4, fontSize: 10, background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditId(r.id); setEmpQ('') }} style={{ background: rev ? C.gold : C.card, color: rev ? '#000' : C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>Reasignar</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>{filtered.length} de {rows.length} filas · Las filas en rojo tienen el nombre del Excel distinto al de la base — reasígnalas al código correcto.</div>
    </div>
  )
}
