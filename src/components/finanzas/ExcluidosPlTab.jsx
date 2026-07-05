// ExcluidosPlTab — Drill-down de egresos con excluir_pl=TRUE (F5 Tinder Conciliación)
// Para que Marco/Angel auditen las exclusiones que el Tinder genera + reverten errores.
// Carga lazy desde FinanzasDashboard.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { db as supabase } from '../../supabase'
import InfoTip from '../ui/InfoTip'
import { fmtDate, n } from '../../config'

const colors = {
  bg: '#1a1a2e', card: '#16213e', card2: '#1e2a4a',
  accent: '#e63946', gold: '#ffd60a', green: '#4ade80', blue: '#60a5fa',
  gray: '#9ca3af', border: '#2d3a5f'
}
const fmt$ = (v) => `$${n(v).toFixed(2)}`

const SUPA_HOST = 'https://btboxlwfqcbrdfrlnwln.supabase.co'
const fotoUrlSafe = (url) => {
  if (!url) return url
  if (url.includes('/sb/storage/')) return url.replace(/^https?:\/\/[^/]+\/sb\//, SUPA_HOST + '/')
  if (url.startsWith('/sb/storage/')) return SUPA_HOST + url.replace(/^\/sb\//, '/')
  return url
}

const SUCURSALES = [
  { code: '',     nombre: 'Todas' },
  { code: 'CM001', nombre: 'Casa Matriz' },
  { code: 'M001',  nombre: 'Cafetalón' },
  { code: 'S001',  nombre: 'Soyapango' },
  { code: 'S002',  nombre: 'Usulután' },
  { code: 'S003',  nombre: 'Lourdes' },
  { code: 'S004',  nombre: 'Venecia' },
  { code: 'S005',  nombre: 'Drive Thru' },
]

const hace60 = () => {
  const d = new Date(); d.setDate(d.getDate() - 60)
  return d.toISOString().split('T')[0]
}
const hoy = () => new Date().toISOString().split('T')[0]

export default function ExcluidosPlTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [desde, setDesde] = useState(hace60())
  const [hasta, setHasta] = useState(hoy())
  const [sucursal, setSucursal] = useState('')
  const [motivo, setMotivo] = useState('')
  const [toast, setToast] = useState(null)
  const [confirmRevertir, setConfirmRevertir] = useState(null)
  const [reverting, setReverting] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('v_egresos_excluidos_pl')
      .select('*')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('asignado_at', { ascending: false, nullsLast: true })
      .limit(1000)
    if (sucursal) q = q.eq('store_code', sucursal)
    const { data, error } = await q
    if (error) console.error('[Excluidos]', error)
    setRows(data || [])
    setLoading(false)
  }, [desde, hasta, sucursal])

  useEffect(() => { cargar() }, [cargar])

  // KPIs
  const kpis = useMemo(() => {
    const filtered = motivo ? rows.filter(r => r.motivo_exclusion === motivo) : rows
    const total = filtered.reduce((s, r) => s + n(r.monto), 0)
    const porMotivo = {}
    rows.forEach(r => { porMotivo[r.motivo_exclusion] = (porMotivo[r.motivo_exclusion] || 0) + n(r.monto) })
    return { n: filtered.length, total, porMotivo }
  }, [rows, motivo])

  const filtradas = useMemo(() => {
    return motivo ? rows.filter(r => r.motivo_exclusion === motivo) : rows
  }, [rows, motivo])

  const showToast = (msg, type='ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }

  const ejecutarRevertir = async () => {
    if (!confirmRevertir) return
    setReverting(true)
    const { data, error } = await supabase
      .rpc('revertir_asignacion_egreso', { p_egreso_id: confirmRevertir.id })
    setReverting(false)
    if (error) {
      showToast('❌ ' + error.message, 'error')
      return
    }
    const result = (data || [])[0]
    if (!result?.ok) {
      showToast('❌ ' + (result?.msg || 'Error desconocido'), 'error')
      return
    }
    showToast(`✓ Asignación revertida${result.dte_id_liberado ? ' · DTE liberado' : ''}`, 'ok')
    setRows(prev => prev.filter(r => r.id !== confirmRevertir.id))
    setConfirmRevertir(null)
  }

  return (
    <div>
      <div style={S.header}>
        <div>
          <div style={S.title}>🚫 Egresos Excluidos del P&amp;L <InfoTip text="Egresos que NO cuentan en el P&L porque ya están contabilizados por otra fuente (un DTE, BEES, Excel o PeYa). Sirve para evitar el doble conteo." /></div>
          <div style={S.subtitle}>
            Egresos asignados a proveedores que ya están contabilizados por otra fuente (DTE / BEES / Excel / PeYa). No cuentan en P&amp;L para evitar doble conteo.
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div style={S.filtros}>
        <div style={S.filtroBox}>
          <span style={S.filtroLabel}>Desde</span>
          <input type="date" style={S.input} value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div style={S.filtroBox}>
          <span style={S.filtroLabel}>Hasta</span>
          <input type="date" style={S.input} value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
        <div style={S.filtroBox}>
          <span style={S.filtroLabel}>Sucursal</span>
          <select style={S.input} value={sucursal} onChange={e => setSucursal(e.target.value)}>
            {SUCURSALES.map(s => <option key={s.code} value={s.code}>{s.nombre}</option>)}
          </select>
        </div>
        <div style={S.filtroBox}>
          <span style={S.filtroLabel}>Motivo</span>
          <select style={S.input} value={motivo} onChange={e => setMotivo(e.target.value)}>
            <option value="">Todos</option>
            {Object.keys(kpis.porMotivo).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <button style={S.btnFiltrar} onClick={cargar}>🔄 Refrescar</button>
      </div>

      {/* KPIs */}
      <div style={S.kpiRow}>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Total excluidos <InfoTip text="Cuántos egresos están marcados como excluidos del P&L." /></div>
          <div style={{ ...S.kpiValue, color: colors.accent }}>{kpis.n}</div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Monto total excluido <InfoTip text="Suma en dólares de esos egresos excluidos del P&L." /></div>
          <div style={{ ...S.kpiValue, color: colors.gold }}>{fmt$(kpis.total)}</div>
        </div>
        {Object.entries(kpis.porMotivo).map(([m, v]) => (
          <div key={m} style={S.kpi}>
            <div style={S.kpiLabel}>{m.length > 26 ? m.slice(0,26)+'…' : m}</div>
            <div style={{ ...S.kpiValue, color: colors.blue, fontSize: 16 }}>{fmt$(v)}</div>
          </div>
        ))}
      </div>

      {/* Tabla */}
      <div style={S.tableWrap}>
        {loading && <div style={S.empty}>⏳ Cargando…</div>}
        {!loading && filtradas.length === 0 && (
          <div style={{ ...S.empty, color: colors.green }}>
            ✅ Sin egresos excluidos en este filtro
          </div>
        )}
        {!loading && filtradas.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['Fecha', 'Sucursal', 'Motivo', 'Monto', 'Proveedor asignado', 'Categoría P&L',
                    'Motivo exclusión', 'Asignado por', 'Cuándo', 'DTE/Foto', 'Acción'].map(h =>
                    <th key={h} style={S.th}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtradas.map(r => (
                  <tr key={r.id} style={S.tr}>
                    <td style={S.td}>{r.fecha ? fmtDate(r.fecha) : '—'}</td>
                    <td style={S.td}>{r.store_code || '—'}</td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11 }}>{r.motivo_nombre}</span>
                    </td>
                    <td style={{ ...S.td, fontWeight: 700, color: colors.gold }}>{fmt$(r.monto)}</td>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600 }}>{r.proveedor_nombre || '—'}</div>
                      {r.subcategoria && (
                        <div style={{ fontSize: 10, color: colors.gray }}>{r.subcategoria}</div>
                      )}
                    </td>
                    <td style={S.td}>
                      <span style={S.pill}>{r.categoria || '—'}</span>
                    </td>
                    <td style={S.td}>
                      <span style={{
                        ...S.pill,
                        background: r.motivo_exclusion === 'DTE match exacto' ? '#1a3a1a' : '#3a2510',
                        color:      r.motivo_exclusion === 'DTE match exacto' ? '#86efac'  : colors.gold,
                      }}>
                        {r.motivo_exclusion}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11 }}>
                        {r.asignado_por_nombre || <em style={{ color: colors.gray }}>backfill</em>}
                        {r.asignado_por_rol && (
                          <span style={{ color: colors.gray, fontSize: 10 }}> · {r.asignado_por_rol}</span>
                        )}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, color: colors.gray }}>
                        {r.asignado_at ? fmtDate(r.asignado_at.split('T')[0]) : '—'}
                      </span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {r.foto_url && (
                          <a href={fotoUrlSafe(r.foto_url)} target="_blank" rel="noreferrer" style={S.btnIcon} title="Ver foto egreso">📷</a>
                        )}
                        {r.compras_dte_id && (
                          <span style={{ ...S.pill, background: '#1a2a4a', color: '#93c5fd' }}
                                title={r.dte_numero_control}>
                            DTE
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={S.td}>
                      <button style={S.btnRevertir} onClick={() => setConfirmRevertir(r)}>
                        ↩ Revertir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ ...S.toast, ...(toast.type === 'error' ? S.toastError : toast.type === 'warn' ? S.toastWarn : S.toastOk) }}>
          {toast.msg}
        </div>
      )}

      {/* Modal revertir */}
      {confirmRevertir && (
        <div style={S.modalBg} onClick={() => !reverting && setConfirmRevertir(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>↩ Revertir asignación</div>
            <div style={{ fontSize: 13, color: colors.gray, marginBottom: 12 }}>
              El egreso de <strong style={{ color: colors.gold }}>{fmt$(confirmRevertir.monto)}</strong>{' '}
              del {fmtDate(confirmRevertir.fecha)} ({confirmRevertir.store_code}) volverá a estado{' '}
              <strong>pendiente</strong> y aparecerá de nuevo en la cola del Tinder.
            </div>
            <div style={S.confirmInfo}>
              <strong>Proveedor actual:</strong> {confirmRevertir.proveedor_nombre || '—'}<br/>
              <strong>Motivo exclusión:</strong> {confirmRevertir.motivo_exclusion}<br/>
              {confirmRevertir.compras_dte_id && (
                <>
                  <strong>DTE vinculado:</strong> {confirmRevertir.dte_proveedor_real} · {fmt$(confirmRevertir.dte_monto)} · {fmtDate(confirmRevertir.dte_fecha)}<br/>
                  <em style={{ color: colors.gold, fontSize: 11 }}>El DTE será liberado y podrá cruzarse con otro egreso.</em>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={S.btnCancel} disabled={reverting} onClick={() => setConfirmRevertir(null)}>Cancelar</button>
              <button style={S.btnConfirm} disabled={reverting} onClick={ejecutarRevertir}>
                {reverting ? 'Revirtiendo…' : '↩ Confirmar reversión'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────── Estilos ──────────────────────
const S = {
  header: { marginBottom: 14 },
  title: { fontSize: 19, fontWeight: 800, color: colors.accent },
  subtitle: { fontSize: 12, color: colors.gray, marginTop: 2 },

  filtros: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14, background: colors.card, border: `1px solid ${colors.border}`, padding: 12, borderRadius: 10 },
  filtroBox: { display: 'flex', flexDirection: 'column', minWidth: 130, flex: '1 1 130px' },
  filtroLabel: { fontSize: 10, color: colors.gray, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  input: { background: colors.bg, border: `1px solid ${colors.border}`, color: '#f0f0f0', padding: '7px 10px', borderRadius: 7, fontSize: 13, width: '100%', boxSizing: 'border-box' },
  btnFiltrar: { background: colors.accent, color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer', alignSelf: 'flex-end' },

  kpiRow: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 },
  kpi: { background: colors.card, border: `1px solid ${colors.border}`, padding: '10px 14px', borderRadius: 10, minWidth: 140, flex: '1 1 140px' },
  kpiLabel: { fontSize: 10, color: colors.gray, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 22, fontWeight: 800, marginTop: 3 },

  tableWrap: { background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' },
  empty: { textAlign: 'center', padding: 36, fontSize: 13, color: colors.gray },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: colors.gray, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${colors.border}`, background: colors.card2 },
  tr: { borderBottom: `1px solid ${colors.border}` },
  td: { padding: '10px 12px', verticalAlign: 'top' },
  pill: { display: 'inline-block', padding: '2px 8px', background: colors.card2, border: `1px solid ${colors.border}`, borderRadius: 5, fontSize: 10, color: colors.gray },
  btnIcon: { textDecoration: 'none', fontSize: 14, padding: '3px 6px', background: colors.card2, borderRadius: 5, border: `1px solid ${colors.border}` },
  btnRevertir: { background: colors.card2, color: colors.accent, border: '1px solid #7a1a2a', padding: '5px 11px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },

  toast: { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '13px 20px', borderRadius: 11, fontWeight: 700, fontSize: 13, boxShadow: '0 6px 18px rgba(0,0,0,0.4)', zIndex: 1000 },
  toastOk:    { background: colors.green, color: '#0a2418' },
  toastWarn:  { background: colors.gold,  color: '#3a2510' },
  toastError: { background: colors.accent, color: '#fff' },

  modalBg: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 20 },
  modal: { background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 20, maxWidth: 480, width: '100%', boxShadow: '0 12px 36px rgba(0,0,0,0.5)' },
  modalTitle: { fontSize: 17, fontWeight: 800, marginBottom: 10, color: colors.accent },
  confirmInfo: { padding: 12, background: colors.card2, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12, color: '#f0f0f0', lineHeight: 1.7 },
  btnCancel:   { flex: 1, background: colors.card2, border: `1px solid ${colors.border}`, color: '#f0f0f0', padding: '10px', borderRadius: 7, cursor: 'pointer', fontWeight: 600 },
  btnConfirm:  { flex: 2, background: colors.accent, border: 'none', color: '#fff', padding: '10px', borderRadius: 7, cursor: 'pointer', fontWeight: 700 },
}
