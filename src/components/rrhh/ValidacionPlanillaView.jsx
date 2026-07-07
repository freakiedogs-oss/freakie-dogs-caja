import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { db } from '../../supabase'
import InfoTip from '../ui/InfoTip'

const ALLOWED = ['c67b81a8-d9d3-4be7-9e7b-daf7114f4331', '2ed69499-4ad4-4cee-b827-aac250e25125']
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ')
const money = (v) => (v == null || v === '') ? '—' : '$' + Number(v).toFixed(2)
const C = { bg: '#0f172a', card: '#1e293b', border: '#334155', text: '#e2e8f0', muted: '#94a3b8', red: '#ef4444', gold: '#f59e0b', green: '#22c55e', blue: '#3b82f6' }

const TIPS = {
  nombre_excel: 'Del EXCEL: nombre tal cual en la hoja de esa quincena. Es lo que se valida contra el código.',
  codigo: 'Código único del empleado (EMP-xxx) asignado. Auto por DUI/nombre; puedes reasignarlo.',
  nombre_bd: 'De la BASE DE DATOS: nombre oficial del empleado con ese código (fuente limpia).',
  estado: 'nuevo = sin asignar · revisar = nombre Excel ≠ BD · validado / ok = confirmado.',
  periodo: 'Quincena, del nombre del archivo Excel.',
  sucursal: 'Del EXCEL: la hoja donde aparece esa quincena (respeta cambios de sucursal).',
  dui: 'De la BASE DE DATOS: DUI del empleado con ese código (fuente limpia).',
  cargo: 'Del EXCEL: cargo en la hoja de esa quincena.',
  dias: 'Del EXCEL: días laborados en la quincena.',
  base: 'Del EXCEL: salario base devengado de la quincena.',
  viatico: 'Del EXCEL: viático quincenal.',
  propina: 'Del EXCEL: propina / comisión de la quincena.',
  adelanto: 'Del EXCEL (Otras deducciones por Adelanto): anticipos que el empleado recibió en la quincena.',
  total_pagar: 'Del EXCEL (Total a Pagar): líquido que se le paga al final de la quincena = bruto − ISSS − AFP − renta − adelanto.',
  pago_liquido: 'PAGO LÍQUIDO = Total a Pagar + Adelanto. Es lo que alimenta la línea Planilla del P&L (ya incluye horas/días extra y propina; excluye ISSS/AFP/renta que van a su propia línea).',
}

export default function ValidacionPlanillaView({ user }) {
  if (!ALLOWED.includes(user?.id) && user?.rol !== 'superadmin') {
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
  const [detId, setDetId] = useState(null)

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
  const necesitaRev = (r) => r.estado !== 'validado' && (r.es_nuevo || norm(r.nombre_excel) !== norm(r.nombre_bd))
  const revCount = useMemo(() => rows.filter(necesitaRev).length, [rows])
  const totalLiq = useMemo(() => rows.reduce((a, r) => a + (Number(r.pago_liquido) || 0), 0), [rows])
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
  const H = (label, key) => <th style={th}>{label} <InfoTip text={TIPS[key]} /></th>
  const NCOLS = 18

  return (
    <div style={{ padding: '12px 8px', maxWidth: 1600, margin: '0 auto', color: C.text }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: C.red, fontWeight: 800 }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Validación de Planilla · Base Canónica</div>
        <div style={{ fontSize: 11, color: C.muted }}>Todas las columnas del Excel, auditadas por quincena. Pasa el cursor sobre la ⓘ de cada columna para ver su fuente. Reasigna/Confirma el código; abre 🔍 para el detalle completo (ISSS/AFP/renta/extras).</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px' }}><div style={{ fontSize: 10, color: C.muted }}>Filas Excel</div><div style={{ fontSize: 18, fontWeight: 800 }}>{rows.length}</div></div>
        <div style={{ background: C.card, border: `1px solid ${C.gold}`, borderRadius: 8, padding: '6px 12px' }}><div style={{ fontSize: 10, color: C.gold }}>Requieren revisión</div><div style={{ fontSize: 18, fontWeight: 800, color: C.gold }}>{revCount}</div></div>
        <div style={{ background: C.card, border: `1px solid ${C.green}`, borderRadius: 8, padding: '6px 12px' }}><div style={{ fontSize: 10, color: C.green }}>Σ Pago Líquido {periodo !== 'todos' ? `(${periodo})` : '(todo)'}</div><div style={{ fontSize: 18, fontWeight: 800, color: C.green }}>{money(filtered.reduce((a, r) => a + (Number(r.pago_liquido) || 0), 0))}</div></div>
        <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12 }}>
          <option value="todos">Todos los períodos</option>{periodos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={soloRev} onChange={e => setSoloRev(e.target.checked)} /> Solo revisión</label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre / código…" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, flex: 1, minWidth: 140 }} />
        <button onClick={load} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>↻ Recargar</button>
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Cargando…</div> : (
        <div style={{ overflow: 'auto', maxHeight: '72vh', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              {H('Nombre (Excel)', 'nombre_excel')}{H('Código', 'codigo')}{H('Nombre (BD)', 'nombre_bd')}{H('Estado', 'estado')}
              {H('Período', 'periodo')}{H('Sucursal', 'sucursal')}{H('DUI (BD)', 'dui')}{H('Cargo', 'cargo')}{H('Días', 'dias')}
              {H('Base', 'base')}{H('Viático', 'viatico')}{H('Propina', 'propina')}{H('Adelanto', 'adelanto')}{H('Total a Pagar', 'total_pagar')}{H('Pago Líquido', 'pago_liquido')}
              <th style={th}>Detalle</th><th style={th}>Acción</th>
            </tr></thead>
            <tbody>
              {filtered.map(r => {
                const rev = necesitaRev(r)
                return (
                  <Fragment key={r.id}>
                  <tr style={{ background: rev ? '#3b1a1a' : 'transparent' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.nombre_excel}</td>
                    <td style={{ ...td, color: C.gold, fontWeight: 700 }}>{r.codigo_asignado || '—'}</td>
                    <td style={{ ...td, color: rev ? C.red : C.text }}>{r.nombre_bd || 'SIN ASIGNAR'}</td>
                    <td style={td}>{r.estado === 'validado' ? <span style={{ color: C.green }}>✓ validado</span> : r.es_nuevo ? <span style={{ color: C.red }}>● nuevo</span> : rev ? <span style={{ color: C.gold }}>● revisar</span> : <span style={{ color: C.green }}>● ok</span>}</td>
                    <td style={td}>{r.periodo}</td><td style={td}>{r.hoja_excel}</td><td style={td}>{r.dui_bd || '—'}</td><td style={td}>{r.cargo_excel || '—'}</td><td style={td}>{r.dias_excel ?? '—'}</td>
                    <td style={td}>{money(r.salario_base_excel)}</td><td style={td}>{money(r.viatico_excel)}</td><td style={td}>{money(r.propina_excel)}</td>
                    <td style={{ ...td, color: r.adelanto ? C.gold : C.muted }}>{money(r.adelanto)}</td><td style={td}>{money(r.total_a_pagar)}</td>
                    <td style={{ ...td, fontWeight: 800, color: C.green }}>{money(r.pago_liquido)}</td>
                    <td style={td}><button onClick={() => setDetId(detId === r.id ? null : r.id)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>{detId === r.id ? '▲' : '🔍'}</button></td>
                    <td style={td}>
                      {editId === r.id ? (
                        <div style={{ position: 'relative' }}>
                          <input autoFocus value={empQ} onChange={e => setEmpQ(e.target.value)} placeholder="buscar empleado…" style={{ background: C.bg, color: C.text, border: `1px solid ${C.blue}`, borderRadius: 4, padding: '3px 6px', fontSize: 11, width: 180 }} />
                          {empMatches.length > 0 && (
                            <div style={{ position: 'absolute', zIndex: 5, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, marginTop: 2, width: 250, maxHeight: 220, overflow: 'auto' }}>
                              {empMatches.map(e => (<div key={e.id} onClick={() => reasignar(r, e)} style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}><b style={{ color: C.gold }}>{e.codigo_empleado}</b> · {e.nombre_completo}{!e.activo && <span style={{ color: C.muted }}> (inactivo)</span>}</div>))}
                            </div>
                          )}
                          <button onClick={() => { setEditId(null); setEmpQ('') }} style={{ marginLeft: 4, fontSize: 10, background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => { setEditId(r.id); setEmpQ('') }} style={{ background: rev && r.es_nuevo ? C.gold : C.card, color: rev && r.es_nuevo ? '#000' : C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>Reasignar</button>
                          {rev && !r.es_nuevo && <button onClick={() => confirmar(r)} style={{ background: C.green, color: '#052e16', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>✓ Confirmar</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                  {detId === r.id && (
                    <tr key={r.id + '-d'} style={{ background: '#0c1320' }}>
                      <td colSpan={NCOLS} style={{ ...td, whiteSpace: 'normal', padding: '8px 12px', color: C.muted }}>
                        <b style={{ color: C.text }}>Detalle Excel:</b>{'  '}
                        Base mensual {money(r.salario_base_mensual)} · Total mensual {money(r.total_mensual)} · Días extra {money(r.dias_extra_monto)} · HE diurna {money(r.he_diurna_monto)} · HE nocturna {money(r.he_nocturna_monto)}
                        {'  ||  '}<span style={{ color: C.gold }}>Retenciones→ línea ISSS/AFP:</span> ISSS emp {money(r.isss_empleado)} · ISSS patrono {money(r.isss_patronal)} · AFP emp {money(r.afp_empleado)} · AFP patrono {money(r.afp_patronal)} · Renta {money(r.renta)} · Sujeto renta {money(r.salario_sujeto_renta)} · Total deducciones {money(r.total_deducciones)}
                        {r.cuenta_bancaria ? `  ||  Cuenta: ${r.cuenta_bancaria}` : ''}{r.observaciones ? `  ||  Obs: ${r.observaciones}` : ''}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>{filtered.length} de {rows.length} filas · <b style={{ color: C.green }}>Pago Líquido</b> = Total a Pagar + Adelanto (alimenta la línea Planilla del P&L). Filas rojas: nombre Excel ≠ BD → Confirmar (si es la misma persona) o Reasignar (si es otra).</div>
    </div>
  )
}
