import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════
   FREAKIE DOGS — Vista DTEs (sidebar Finanzas)
   v2 — 23-May-2026:
     • Top items ordenados por VOLUMEN ($) en lugar de frecuencia
     • Botón ✕ por card para ocultarla; persistido en localStorage
     • Botón + para fijar cards específicas (item o proveedor)
     • MiniChart: eje derecho de precio + línea naranja + label "último"
     • Fix bug $0 Top Proveedores: optimización SQL (4.5s → 0.4s)
   ═══════════════════════════════════════════════════════════════ */

// ── Brand colors ──
const C = {
  red: '#e63946', redDark: '#b91c2c',
  green: '#2d6a4f', greenLight: '#4ade80',
  dark: '#1a1a2e', card: '#16213e', cardAlt: '#0f3460',
  gold: '#f4a261', goldBg: '#fffbeb',
  blue: '#3b82f6', blueBg: '#eff6ff',
  gray: '#6b7280', grayLight: '#f3f4f6', border: '#334155',
  white: '#fff', textMuted: '#94a3b8',
  pink: '#ec4899', purple: '#a78bfa', teal: '#2dd4bf',
}

const fmt = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (n) => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US')
const fmtNum = (n) => n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

const METODO_COLOR = {
  'Transferencia': C.blue, 'Efectivo': C.greenLight, 'Mixto': C.gold,
  'Pagado (sin trace)': '#a78bfa', 'Pendiente': C.gray,
}
const ESTADO_COLOR = { 'pagado': C.greenLight, 'pendiente': C.gold, 'parcial': C.blue }
const SUCURSALES_OPCIONES = ['M001', 'S001', 'S003', 'S004', 'S005', 'S006', 'S007', 'CM001', 'EVENTOS']

// ── Styles ──
const sCard = { background: C.card, borderRadius: 12, padding: 16, marginBottom: 12, border: `1px solid ${C.border}` }
const sCardMini = { background: C.card, borderRadius: 10, padding: 12, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }
const sInput = { background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none' }
const sSelect = { ...sInput, cursor: 'pointer' }
const sBtn = (active) => ({
  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 11,
  background: active ? C.red : 'transparent', color: active ? C.white : C.textMuted,
  border: `1px solid ${active ? C.red : C.border}`, transition: 'all .15s',
})
const sChip = (color, bg) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 6,
  background: bg || 'rgba(255,255,255,0.05)', color: color || C.white,
  fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
})
const sTh = { padding: '8px 6px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.gold, borderBottom: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }
const sThR = { ...sTh, textAlign: 'right' }
const sTd = { padding: '8px 6px', fontSize: 12, color: C.white, borderBottom: `1px solid rgba(255,255,255,0.04)`, verticalAlign: 'middle' }
const sTdR = { ...sTd, textAlign: 'right', fontFamily: 'monospace' }
const sTdMuted = { ...sTd, color: C.textMuted, fontSize: 11 }
const sBtnCloseCard = {
  position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10,
  background: 'rgba(0,0,0,0.3)', color: C.textMuted, border: 'none', cursor: 'pointer',
  fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
}

// ── localStorage keys (per-feature) ──
const LS_HIDDEN_PROVS = 'dtes_hidden_provs_v1'
const LS_HIDDEN_ITEMS = 'dtes_hidden_items_v1'
const LS_PINNED_PROVS = 'dtes_pinned_provs_v1'
const LS_PINNED_ITEMS = 'dtes_pinned_items_v1'

function loadLS(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}
function saveLS(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch {}
}

// ── Helper: cargar todas las filas paginadas ──
async function fetchAll(builder, label = 'rows') {
  const PAGE = 1000
  let all = []
  let from = 0
  while (true) {
    const { data, error } = await builder.range(from, from + PAGE - 1)
    if (error) { console.warn('fetchAll', label, error); break }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
    if (from > 50000) break
  }
  return all
}

function lastNMonths(n) {
  const out = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
function pctChange(prev, curr) {
  if (prev == null || prev === 0 || curr == null) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

// ══════════════════════════════════════════════════════
//   COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════

export default function DTEsView({ user }) {
  const [subtab, setSubtab] = useState('listado')
  return (
    <div style={{ padding: '12px 8px', maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ color: C.red, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>FREAKIE DOGS</div>
        <h1 style={{ color: C.white, fontSize: 24, fontWeight: 800, margin: '4px 0' }}>🧾 DTEs</h1>
        <div style={{ color: C.textMuted, fontSize: 11 }}>
          Documentos Tributarios Electrónicos · Items · Pagos · KPIs por proveedor e item
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setSubtab('listado')} style={sBtn(subtab === 'listado')}>📋 Listado de DTEs</button>
        <button onClick={() => setSubtab('kpis')} style={sBtn(subtab === 'kpis')}>📊 Proveedores / Items / KPIs</button>
      </div>
      {subtab === 'listado' ? <ListadoDTEs /> : <KPIsTab />}
    </div>
  )
}

// ══════════════════════════════════════════════════════
//   SUB-TAB 1: Listado de DTEs (sin cambios funcionales)
// ══════════════════════════════════════════════════════

function ListadoDTEs() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [categoriasOpts, setCategoriasOpts] = useState([])
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const [fechaDesde, setFechaDesde] = useState(monthAgo)
  const [fechaHasta, setFechaHasta] = useState(today)
  const [search, setSearch] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroSucursal, setFiltroSucursal] = useState('')
  const [filtroEstadoPago, setFiltroEstadoPago] = useState('')
  const [filtroMetodo, setFiltroMetodo] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState({})
  const [itemsLoading, setItemsLoading] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const builder = db.from('v_dtes_finanzas')
        .select('*')
        .gte('fecha_emision', fechaDesde)
        .lte('fecha_emision', fechaHasta)
        .order('fecha_emision', { ascending: false })
      const data = await fetchAll(builder, 'v_dtes_finanzas')
      setRows(data)
      const catSet = new Set()
      data.forEach(r => { if (r.categoria_nombre) catSet.add(r.categoria_nombre) })
      setCategoriasOpts(Array.from(catSet).sort())
    } catch (e) { console.error('loadData DTEs', e) }
    finally { setLoading(false) }
  }, [fechaDesde, fechaHasta])

  useEffect(() => { loadData() }, [loadData])

  const loadItems = async (dteId) => {
    if (items[dteId]) return
    setItemsLoading(prev => ({ ...prev, [dteId]: true }))
    try {
      const { data, error } = await db.from('v_dtes_finanzas_items').select('*').eq('compras_dte_id', dteId).order('linea', { ascending: true })
      if (error) throw error
      setItems(prev => ({ ...prev, [dteId]: data || [] }))
    } catch (e) {
      console.warn('loadItems', e)
      setItems(prev => ({ ...prev, [dteId]: [] }))
    } finally { setItemsLoading(prev => ({ ...prev, [dteId]: false })) }
  }

  const toggleExpand = (dteId) => {
    if (expandedId === dteId) setExpandedId(null)
    else { setExpandedId(dteId); loadItems(dteId) }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter(r => {
      if (s && !(
        (r.proveedor_nombre || '').toLowerCase().includes(s) ||
        (r.proveedor_nit || '').toLowerCase().includes(s) ||
        (r.numero_control || '').toLowerCase().includes(s) ||
        (r.dte_codigo || '').toLowerCase().includes(s)
      )) return false
      if (filtroCategoria && r.categoria_nombre !== filtroCategoria) return false
      if (filtroSucursal && r.sucursal_code !== filtroSucursal) return false
      if (filtroEstadoPago && r.estado_pago !== filtroEstadoPago) return false
      if (filtroMetodo && r.metodo_pago !== filtroMetodo) return false
      if (filtroTipo && r.tipo_dte !== filtroTipo) return false
      return true
    })
  }, [rows, search, filtroCategoria, filtroSucursal, filtroEstadoPago, filtroMetodo, filtroTipo])

  const totales = useMemo(() => filtered.reduce((acc, r) => {
    const t = Number(r.monto_total) || 0
    const p = Number(r.total_pagado) || 0
    acc.count += 1
    acc.total += t
    acc.iva += Number(r.iva) || 0
    acc.pagado += p
    acc.saldo += Math.max(t - p, 0)
    if (r.metodo_pago === 'Transferencia') acc.tef += t
    else if (r.metodo_pago === 'Efectivo') acc.efe += t
    else if (r.metodo_pago === 'Pendiente') acc.pend += t
    return acc
  }, { count: 0, total: 0, iva: 0, pagado: 0, saldo: 0, tef: 0, efe: 0, pend: 0 }), [filtered])

  return (
    <div>
      <div style={sCard}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Desde</label>
            <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} style={sInput} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Hasta</label>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} style={sInput} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Buscar (proveedor / NIT / N° control)</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Ej. BELCA, 06141908…" style={sInput} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Categoría</label>
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={sSelect}>
              <option value="">Todas</option>
              {categoriasOpts.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Sucursal</label>
            <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)} style={sSelect}>
              <option value="">Todas</option>
              {SUCURSALES_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Estado pago</label>
            <select value={filtroEstadoPago} onChange={e => setFiltroEstadoPago(e.target.value)} style={sSelect}>
              <option value="">Todos</option>
              <option value="pagado">Pagado</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Método</label>
            <select value={filtroMetodo} onChange={e => setFiltroMetodo(e.target.value)} style={sSelect}>
              <option value="">Todos</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Efectivo">Efectivo</option>
              <option value="Mixto">Mixto</option>
              <option value="Pagado (sin trace)">Pagado (sin trace)</option>
              <option value="Pendiente">Pendiente</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Tipo DTE</label>
            <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={sSelect}>
              <option value="">Todos</option>
              <option value="01">Factura (01)</option>
              <option value="03">CCF (03)</option>
              <option value="05">Nota Crédito (05)</option>
              <option value="06">Nota Débito (06)</option>
              <option value="14">Sujeto Excluido (14)</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <KPI label="DTEs" value={totales.count.toLocaleString()} />
        <KPI label="Total" value={fmt(totales.total)} />
        <KPI label="IVA" value={fmt(totales.iva)} />
        <KPI label="Pagado" value={fmt(totales.pagado)} color={C.greenLight} />
        <KPI label="Saldo" value={fmt(totales.saldo)} color={C.gold} />
        <KPI label="Transf." value={fmt(totales.tef)} color={C.blue} />
        <KPI label="Efectivo" value={fmt(totales.efe)} color={C.greenLight} />
        <KPI label="Pendiente" value={fmt(totales.pend)} color={C.gray} />
      </div>

      <div style={{ ...sCard, padding: 0, overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: C.textMuted }}>⏳ Cargando DTEs…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: C.textMuted }}>Sin DTEs en el rango seleccionado.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead style={{ background: C.cardAlt }}>
              <tr>
                <th style={{ ...sTh, width: 24 }}></th>
                <th style={sTh}>Fecha</th><th style={sTh}>Tipo</th><th style={sTh}>Proveedor</th>
                <th style={sTh}>NIT</th><th style={sTh}>N° Control</th><th style={sTh}>Categoría</th>
                <th style={sTh}>Suc.</th><th style={sThR}>Subtotal</th><th style={sThR}>IVA</th>
                <th style={sThR}>Total</th><th style={sTh}>Estado</th><th style={sTh}>Método</th>
                <th style={sTh}>Vencimiento</th><th style={sThR}>Saldo</th><th style={sTh}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map(r => (
                <React.Fragment key={r.id}>
                  <tr
                    onClick={() => toggleExpand(r.id)}
                    style={{ cursor: 'pointer', background: expandedId === r.id ? 'rgba(244,162,97,0.06)' : 'transparent' }}
                    onMouseEnter={e => { if (expandedId !== r.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                    onMouseLeave={e => { if (expandedId !== r.id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <td style={sTd}>{expandedId === r.id ? '▾' : '▸'}</td>
                    <td style={sTd}>{r.fecha_emision}</td>
                    <td style={sTd}><span style={sChip(C.gold)}>{r.tipo_dte_nombre || '—'}</span></td>
                    <td style={{ ...sTd, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.proveedor_nombre}>{r.proveedor_nombre || '—'}</td>
                    <td style={sTdMuted}>{r.proveedor_nit || '—'}</td>
                    <td style={sTdMuted}>{r.dte_codigo || r.numero_control || '—'}</td>
                    <td style={sTdMuted}>{r.categoria_nombre || '—'}</td>
                    <td style={sTdMuted}>{r.sucursal_code || '—'}</td>
                    <td style={sTdR}>{fmt(r.subtotal)}</td>
                    <td style={sTdR}>{fmt(r.iva)}</td>
                    <td style={{ ...sTdR, fontWeight: 700 }}>{fmt(r.monto_total)}</td>
                    <td style={sTd}><span style={sChip(ESTADO_COLOR[r.estado_pago] || C.white)}>{r.estado_pago || '—'}</span></td>
                    <td style={sTd}><span style={sChip(METODO_COLOR[r.metodo_pago] || C.white)}>{r.metodo_pago}</span></td>
                    <td style={sTdMuted}>
                      {r.fecha_vencimiento || '—'}
                      {r.dias_vencido > 0 && <span style={{ ...sChip(C.red, 'rgba(230,57,70,0.15)'), marginLeft: 4 }}>+{r.dias_vencido}d</span>}
                    </td>
                    <td style={{ ...sTdR, color: r.saldo > 0 ? C.gold : C.textMuted }}>{r.saldo > 0 ? fmt(r.saldo) : '—'}</td>
                    <td style={sTd}>{r.archivo_pdf_url ? (<a href={r.archivo_pdf_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: C.blue, textDecoration: 'none' }}>📄</a>) : '—'}</td>
                  </tr>
                  {expandedId === r.id && (
                    <tr>
                      <td colSpan={16} style={{ padding: 0, background: 'rgba(15,52,96,0.4)' }}>
                        <ExpandedRow dte={r} items={items[r.id]} loading={itemsLoading[r.id]} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {filtered.length > 500 && (
          <div style={{ padding: 8, textAlign: 'center', fontSize: 11, color: C.textMuted, background: C.cardAlt }}>
            Mostrando primeros 500 de {filtered.length.toLocaleString()} DTEs. Ajusta filtros para refinar.
          </div>
        )}
      </div>
    </div>
  )
}

function ExpandedRow({ dte, items, loading }) {
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginBottom: 12 }}>
        <Field label="Código generación" value={dte.codigo_generacion} mono />
        <Field label="N° Control" value={dte.numero_control} mono />
        <Field label="Cruzado con recepción" value={dte.cruzado ? 'Sí' : 'No'} color={dte.cruzado ? C.greenLight : C.gold} />
        <Field label="Total pagado" value={fmt(dte.total_pagado)} color={C.greenLight} />
        {dte.monto_tef > 0 && <Field label="Pago Transf." value={fmt(dte.monto_tef)} color={C.blue} />}
        {dte.bancos_tef && <Field label="Banco" value={dte.bancos_tef} />}
        {dte.referencias_tef && <Field label="Ref. bancaria" value={dte.referencias_tef} mono />}
        {dte.ultima_fecha_pago_tef && <Field label="Fecha transf." value={dte.ultima_fecha_pago_tef} />}
        {dte.monto_efectivo > 0 && <Field label="Pago Efectivo" value={fmt(dte.monto_efectivo)} color={C.greenLight} />}
        {dte.sucursales_pago_efectivo && <Field label="Sucursal pago" value={dte.sucursales_pago_efectivo} />}
        {dte.ultima_fecha_pago_efectivo && <Field label="Fecha efectivo" value={dte.ultima_fecha_pago_efectivo} />}
        <Field label="Categoría / Grupo" value={`${dte.categoria_nombre || '—'} / ${dte.categoria_grupo || '—'}`} />
        {dte.email_origen && <Field label="Email origen" value={dte.email_origen} small />}
      </div>
      <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Items del DTE</div>
      {loading ? (
        <div style={{ padding: 14, textAlign: 'center', color: C.textMuted }}>⏳ Cargando items…</div>
      ) : !items || items.length === 0 ? (
        <div style={{ padding: 14, textAlign: 'center', color: C.textMuted, fontSize: 11 }}>
          Este DTE no tiene items extraídos. {dte.archivo_pdf_url && <a href={dte.archivo_pdf_url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>Ver PDF</a>}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr>
            <th style={{ ...sTh, fontSize: 9 }}>#</th>
            <th style={{ ...sTh, fontSize: 9 }}>Descripción</th>
            <th style={{ ...sTh, fontSize: 9 }}>Producto mapeado</th>
            <th style={{ ...sThR, fontSize: 9 }}>Cant.</th>
            <th style={{ ...sThR, fontSize: 9 }}>P. Unit.</th>
            <th style={{ ...sThR, fontSize: 9 }}>Total</th>
          </tr></thead>
          <tbody>{items.map(it => (
            <tr key={it.id}>
              <td style={sTdMuted}>{it.linea}</td>
              <td style={sTd}>{it.descripcion_original}</td>
              <td style={sTdMuted}>{it.producto_nombre ? <span style={sChip(C.greenLight, 'rgba(74,222,128,0.1)')}>{it.producto_nombre}</span> : '—'}</td>
              <td style={sTdR}>{Number(it.cantidad).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
              <td style={sTdR}>{fmt(it.precio_unitario)}</td>
              <td style={{ ...sTdR, fontWeight: 700 }}>{fmt(it.monto_linea)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

function Field({ label, value, color, mono, small }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: small ? 10 : 12, color: color || C.white, fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-word' }}>{value || '—'}</div>
    </div>
  )
}

function KPI({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', minWidth: 110, flex: 1 }}>
      <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || C.white, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//   MINI-CHART SVG: barras (volumen) + línea (precio)
//   ✱ Eje izquierdo: volumen (barras azules)
//   ✱ Eje derecho: precio (línea naranja con axis con labels)
// ══════════════════════════════════════════════════════

function MiniChart({ bars, line, height = 80, barColor = C.blue, lineColor = C.gold, showXLabels = true, lineLabel = 'Último precio de compra' }) {
  const W = 320, H = height
  const PAD_L = 26, PAD_R = 38, PAD_T = 6, PAD_B = showXLabels ? 14 : 4
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const n = bars.length
  if (n === 0) return <div style={{ height: H, color: C.textMuted, fontSize: 10, textAlign: 'center' }}>—</div>

  const maxBar = Math.max(...bars.map(b => Number(b.value) || 0), 1)
  const lineVals = (line || []).map(p => Number(p.value) || 0).filter(v => v > 0)
  const lineValid = lineVals.length > 0
  const maxLine = lineValid ? Math.max(...lineVals) : 0
  const minLine = lineValid ? Math.min(...lineVals) : 0
  const lineRange = lineValid && maxLine > minLine ? (maxLine - minLine) : (maxLine || 1)

  const barW = innerW / n
  const barInnerW = Math.max(barW * 0.65, 4)
  const barGap = (barW - barInnerW) / 2

  // Calcular puntos de línea (saltando huecos)
  let pathParts = []
  let lastValidIdx = -1
  if (lineValid) {
    line.forEach((p, i) => {
      const v = Number(p.value) || 0
      if (v <= 0) return
      const cx = PAD_L + barW * i + barW / 2
      const cy = PAD_T + innerH - ((v - minLine) / lineRange) * innerH
      pathParts.push((lastValidIdx === -1 ? 'M' : 'L') + ` ${cx.toFixed(1)},${cy.toFixed(1)}`)
      lastValidIdx = i
    })
  }
  const polyPath = pathParts.join(' ')

  // Encontrar último precio (último valor > 0 en la línea)
  let ultimoPrecio = null
  let ultimoPrecioIdx = -1
  if (lineValid) {
    for (let i = line.length - 1; i >= 0; i--) {
      const v = Number(line[i].value) || 0
      if (v > 0) { ultimoPrecio = v; ultimoPrecioIdx = i; break }
    }
  }

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      {/* Eje izquierdo: ticks de volumen */}
      <text x={PAD_L - 3} y={PAD_T + 6} textAnchor="end" fontSize="8" fill={C.textMuted}>{fmt0(maxBar)}</text>
      <text x={PAD_L - 3} y={PAD_T + innerH} textAnchor="end" fontSize="8" fill={C.textMuted}>0</text>

      {/* Eje derecho: ticks de precio */}
      {lineValid && (
        <>
          <text x={W - PAD_R + 3} y={PAD_T + 6} textAnchor="start" fontSize="8" fill={lineColor} fontWeight="700">${maxLine.toFixed(2)}</text>
          <text x={W - PAD_R + 3} y={PAD_T + innerH} textAnchor="start" fontSize="8" fill={lineColor}>${minLine.toFixed(2)}</text>
        </>
      )}

      {/* Barras volumen */}
      {bars.map((b, i) => {
        const v = Number(b.value) || 0
        const h = (v / maxBar) * innerH
        const x = PAD_L + barW * i + barGap
        const y = PAD_T + innerH - h
        return (
          <g key={i}>
            <rect x={x} y={y} width={barInnerW} height={h} fill={barColor} rx={1} opacity={0.85}>
              <title>{b.label}: {fmt0(v)}</title>
            </rect>
          </g>
        )
      })}

      {/* Línea precio */}
      {lineValid && (
        <g>
          <path d={polyPath} fill="none" stroke={lineColor} strokeWidth="2" />
          {line.map((p, i) => {
            const v = Number(p.value) || 0
            if (!v) return null
            const cx = PAD_L + barW * i + barW / 2
            const cy = PAD_T + innerH - ((v - minLine) / lineRange) * innerH
            return (
              <circle key={i} cx={cx} cy={cy} r={i === ultimoPrecioIdx ? 3 : 2} fill={lineColor} stroke={C.card} strokeWidth={i === ultimoPrecioIdx ? 1 : 0}>
                <title>{p.label}: ${v.toFixed(2)}</title>
              </circle>
            )
          })}
          {/* Label "último precio" anclado al último punto */}
          {ultimoPrecio != null && ultimoPrecioIdx >= 0 && (() => {
            const cx = PAD_L + barW * ultimoPrecioIdx + barW / 2
            const cy = PAD_T + innerH - ((ultimoPrecio - minLine) / lineRange) * innerH
            const labelY = Math.max(cy - 6, PAD_T + 4)
            return (
              <text x={cx} y={labelY} textAnchor="middle" fontSize="9" fill={lineColor} fontWeight="700">
                ${ultimoPrecio.toFixed(2)}
              </text>
            )
          })()}
        </g>
      )}

      {/* X labels (cada 2 meses) */}
      {showXLabels && bars.map((b, i) => {
        if (i % 2 !== 0 && i !== n - 1) return null
        const x = PAD_L + barW * i + barW / 2
        return <text key={i} x={x} y={H - 2} textAnchor="middle" fontSize="8" fill={C.textMuted}>{b.label.slice(5)}</text>
      })}
    </svg>
  )
}

// ══════════════════════════════════════════════════════
//   SUB-TAB 2: KPIs
// ══════════════════════════════════════════════════════

function KPIsTab() {
  const [vista, setVista] = useState('proveedores')
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setVista('proveedores')} style={sBtn(vista === 'proveedores')}>🏢 Top Proveedores</button>
        <button onClick={() => setVista('items')} style={sBtn(vista === 'items')}>📦 Buscar Items / Precios</button>
        <button onClick={() => setVista('mix')} style={sBtn(vista === 'mix')}>🥧 Mix por Categoría</button>
      </div>
      {vista === 'proveedores' && <ProveedoresKPI />}
      {vista === 'items' && <ItemsBuscador />}
      {vista === 'mix' && <MixCategorias />}
    </div>
  )
}

// ══════════════════════════════════════════════════════
//   ProveedoresKPI
// ══════════════════════════════════════════════════════

function ProveedoresKPI() {
  const [loading, setLoading] = useState(true)
  const [provs, setProvs] = useState([])
  const [mensual, setMensual] = useState({})
  const [ventana, setVentana] = useState('365d')
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState(() => new Set(loadLS(LS_HIDDEN_PROVS)))
  const [pinned, setPinned] = useState(() => loadLS(LS_PINNED_PROVS))
  const [showPicker, setShowPicker] = useState(false)

  const meses = useMemo(() => lastNMonths(13), [])

  const persistHidden = (next) => { saveLS(LS_HIDDEN_PROVS, Array.from(next)) }
  const persistPinned = (next) => { saveLS(LS_PINNED_PROVS, next) }

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        // Carga separada con try independiente: si una falla, la otra sigue
        let provData = []
        let mensualData = []
        try {
          provData = await fetchAll(
            db.from('v_kpi_proveedores').select('*').order('monto_365d', { ascending: false, nullsFirst: false }),
            'v_kpi_proveedores'
          )
        } catch (e) { console.error('provs', e) }
        try {
          mensualData = await fetchAll(db.from('v_kpi_proveedor_mensual').select('*'), 'v_kpi_proveedor_mensual')
        } catch (e) { console.error('prov_mensual', e) }
        setProvs(provData)
        const idx = {}
        mensualData.forEach(r => {
          if (!idx[r.proveedor_nit]) idx[r.proveedor_nit] = {}
          idx[r.proveedor_nit][r.year_month] = r
        })
        setMensual(idx)
      } finally { setLoading(false) }
    })()
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    const montoKey = `monto_${ventana}`
    const nKey = `n_dtes_${ventana}`
    return provs
      .filter(r => !s || (r.proveedor_nombre || '').toLowerCase().includes(s) || (r.proveedor_nit || '').toLowerCase().includes(s))
      .map(r => ({ ...r, monto: Number(r[montoKey]) || 0, n: Number(r[nKey]) || 0 }))
      .filter(r => r.monto > 0)
      .sort((a, b) => b.monto - a.monto)
  }, [provs, search, ventana])

  const top10Raw = filtered.slice(0, 10 + hidden.size).filter(p => !hidden.has(p.proveedor_nit)).slice(0, 10)
  const totalVentana = filtered.reduce((s, r) => s + r.monto, 0)

  // Cards pinned: traer los registros completos para esos NITs
  const pinnedCards = useMemo(() => {
    const top10Ids = new Set(top10Raw.map(p => p.proveedor_nit))
    return pinned
      .map(nit => filtered.find(p => p.proveedor_nit === nit))
      .filter(Boolean)
      .filter(p => !top10Ids.has(p.proveedor_nit))
  }, [pinned, filtered, top10Raw])

  // Anomalías (excluye hidden)
  const anomalias = useMemo(() => {
    if (loading) return []
    const candidatos = []
    provs.forEach(p => {
      if (hidden.has(p.proveedor_nit)) return
      const serie = mensual[p.proveedor_nit]
      if (!serie) return
      const serieArr = meses.map(m => ({
        ym: m, monto: Number(serie[m]?.monto) || 0, n: Number(serie[m]?.n_dtes) || 0,
        ticket: Number(serie[m]?.ticket_promedio) || 0,
      }))
      const conActividad = serieArr.filter(s => s.monto > 0)
      if (conActividad.length < 2) return
      const last = serieArr[serieArr.length - 1]
      const prev = serieArr[serieArr.length - 2]
      const prev3 = serieArr.slice(-4, -1)
      const promPrev3 = prev3.length ? prev3.reduce((s, x) => s + x.monto, 0) / prev3.length : 0

      if (promPrev3 >= 500 && last.monto > 0 && last.monto < promPrev3 * 0.5) {
        candidatos.push({ tipo: 'caida_mensual', razon: `Caída ${((1 - last.monto / promPrev3) * 100).toFixed(0)}% vs prom 3 meses anteriores`, color: C.red, icon: '📉', proveedor: p, serieArr, metricKey: Math.abs(promPrev3 - last.monto) })
      } else if (promPrev3 >= 500 && last.monto > promPrev3 * 2) {
        candidatos.push({ tipo: 'subida_mensual', razon: `Subida ${((last.monto / promPrev3 - 1) * 100).toFixed(0)}% vs prom 3 meses anteriores`, color: C.gold, icon: '📈', proveedor: p, serieArr, metricKey: last.monto - promPrev3 })
      }
      const frec = Number(p.dias_promedio_entre_compras_365d) || 0
      const gap = Number(p.dias_desde_ultima) || 0
      const monto365 = Number(p.monto_365d) || 0
      if (frec >= 5 && frec <= 60 && gap > frec * 3 && monto365 >= 2000) {
        candidatos.push({ tipo: 'gap_inusual', razon: `Sin compras hace ${gap}d (frec normal ${frec.toFixed(0)}d)`, color: C.red, icon: '⚠️', proveedor: p, serieArr, metricKey: monto365 })
      }
      if (last.n >= 3 && prev.n >= 3 && prev.ticket > 0 && last.ticket > prev.ticket * 1.5) {
        candidatos.push({ tipo: 'ticket_sube', razon: `Ticket prom $${last.ticket.toFixed(0)} (era $${prev.ticket.toFixed(0)}, +${((last.ticket / prev.ticket - 1) * 100).toFixed(0)}%)`, color: C.gold, icon: '💰', proveedor: p, serieArr, metricKey: last.ticket - prev.ticket })
      }
    })
    const seen = new Set()
    const ordenPrioridad = ['caida_mensual', 'gap_inusual', 'subida_mensual', 'ticket_sube']
    candidatos.sort((a, b) => ordenPrioridad.indexOf(a.tipo) - ordenPrioridad.indexOf(b.tipo) || b.metricKey - a.metricKey)
    const out = []
    for (const c of candidatos) {
      if (seen.has(c.proveedor.proveedor_nit)) continue
      seen.add(c.proveedor.proveedor_nit)
      out.push(c)
      if (out.length >= 5) break
    }
    return out
  }, [provs, mensual, meses, loading, hidden])

  const hideCard = (nit) => {
    const next = new Set(hidden)
    next.add(nit)
    setHidden(next); persistHidden(next)
  }
  const unhideAll = () => {
    setHidden(new Set()); persistHidden(new Set())
  }
  const pinCard = (nit) => {
    if (pinned.includes(nit)) return
    const next = [...pinned, nit]
    setPinned(next); persistPinned(next)
    setShowPicker(false)
  }
  const unpinCard = (nit) => {
    const next = pinned.filter(x => x !== nit)
    setPinned(next); persistPinned(next)
  }

  return (
    <div>
      <div style={{ ...sCard, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Buscar proveedor / NIT</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Ej. BELCA, 0614..." style={{ ...sInput, width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['30d', '90d', '365d'].map(v => (
            <button key={v} onClick={() => setVentana(v)} style={sBtn(ventana === v)}>{v === '30d' ? '30 días' : v === '90d' ? '90 días' : '365 días'}</button>
          ))}
        </div>
        <KPI label={`Total ventana ${ventana}`} value={fmt0(totalVentana)} color={C.gold} />
        <KPI label="Proveedores activos" value={filtered.length} />
        {hidden.size > 0 && (
          <button onClick={unhideAll} style={{ ...sBtn(false), color: C.gold, borderColor: C.gold }}>↺ Mostrar {hidden.size} oculto{hidden.size === 1 ? '' : 's'}</button>
        )}
      </div>

      {loading ? (
        <div style={{ ...sCard, padding: 60, textAlign: 'center', color: C.textMuted }}>⏳ Cargando KPIs…</div>
      ) : (
        <>
          {/* Top 10 cards (por volumen) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              🏆 Top 10 proveedores por volumen ({ventana})
            </div>
            <button onClick={() => setShowPicker(true)} style={{ ...sBtn(false), color: C.gold, borderColor: C.gold }}>+ Agregar card</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, marginBottom: 16 }}>
            {top10Raw.map((p, i) => (
              <CardProveedor
                key={p.proveedor_nit}
                rank={i + 1}
                prov={p}
                serie={meses.map(m => mensual[p.proveedor_nit]?.[m])}
                meses={meses}
                onClose={() => hideCard(p.proveedor_nit)}
              />
            ))}
          </div>

          {/* Pinned (cards manualmente agregadas) */}
          {pinnedCards.length > 0 && (
            <>
              <div style={{ marginBottom: 6, color: C.purple, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                📌 Cards fijadas ({pinnedCards.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, marginBottom: 16 }}>
                {pinnedCards.map(p => (
                  <CardProveedor
                    key={`pinned_${p.proveedor_nit}`}
                    rank={'★'}
                    prov={p}
                    serie={meses.map(m => mensual[p.proveedor_nit]?.[m])}
                    meses={meses}
                    onClose={() => unpinCard(p.proveedor_nit)}
                    pinned
                  />
                ))}
              </div>
            </>
          )}

          {/* Anomalías */}
          {anomalias.length > 0 && (
            <>
              <div style={{ marginBottom: 6, color: C.red, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                ⚡ A revisar — {anomalias.length} señal{anomalias.length === 1 ? '' : 'es'} detectada{anomalias.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, marginBottom: 16 }}>
                {anomalias.map((a, i) => (
                  <CardAnomalia
                    key={`${a.tipo}_${a.proveedor.proveedor_nit}_${i}`}
                    icon={a.icon}
                    color={a.color}
                    razon={a.razon}
                    titulo={a.proveedor.proveedor_nombre}
                    subtitulo={a.proveedor.proveedor_nit}
                    serieArr={a.serieArr}
                    onClose={() => hideCard(a.proveedor.proveedor_nit)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Tabla completa */}
          <div style={{ marginBottom: 6, color: C.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Tabla completa ({filtered.length})
          </div>
          <div style={{ ...sCard, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead style={{ background: C.cardAlt }}>
                <tr>
                  <th style={sTh}>#</th><th style={sTh}>Proveedor</th><th style={sTh}>NIT</th><th style={sTh}>Categoría</th>
                  <th style={sThR}>Monto ({ventana})</th><th style={sThR}>% del total</th><th style={sThR}>DTEs</th>
                  <th style={sThR}>Frec. (d)</th><th style={sThR}>Últ. hace</th><th style={sTh}>Pin</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((r, i) => (
                  <tr key={r.proveedor_nit}>
                    <td style={sTdMuted}>{i + 1}</td>
                    <td style={sTd}>{r.proveedor_nombre}</td>
                    <td style={sTdMuted}>{r.proveedor_nit}</td>
                    <td style={sTdMuted}>{r.categoria_principal || '—'}</td>
                    <td style={{ ...sTdR, fontWeight: 700 }}>{fmt0(r.monto)}</td>
                    <td style={sTdR}>{totalVentana > 0 ? ((r.monto / totalVentana) * 100).toFixed(1) + '%' : '—'}</td>
                    <td style={sTdR}>{r.n}</td>
                    <td style={sTdR}>{r.dias_promedio_entre_compras_365d || '—'}</td>
                    <td style={{ ...sTdR, color: r.dias_desde_ultima > 60 ? C.red : C.textMuted }}>{r.dias_desde_ultima ?? '—'}d</td>
                    <td style={sTd}>
                      <button
                        onClick={() => pinned.includes(r.proveedor_nit) ? unpinCard(r.proveedor_nit) : pinCard(r.proveedor_nit)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: pinned.includes(r.proveedor_nit) ? C.purple : C.textMuted, fontSize: 14 }}
                        title={pinned.includes(r.proveedor_nit) ? 'Quitar pin' : 'Fijar como card'}
                      >
                        {pinned.includes(r.proveedor_nit) ? '📌' : '📍'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal picker */}
      {showPicker && (
        <PickerModal
          titulo="Agregar card de proveedor"
          opciones={filtered.map(p => ({ id: p.proveedor_nit, label: p.proveedor_nombre, sub: `NIT ${p.proveedor_nit} · ${fmt0(p.monto)} (${ventana})` }))}
          onPick={(id) => pinCard(id)}
          onClose={() => setShowPicker(false)}
          yaPinned={pinned}
        />
      )}
    </div>
  )
}

// ── Card de proveedor ──
function CardProveedor({ rank, prov, serie, meses, onClose, pinned }) {
  const bars = meses.map((m, i) => ({ label: m, value: Number(serie[i]?.monto) || 0 }))
  const ticketLine = meses.map((m, i) => ({ label: m, value: Number(serie[i]?.ticket_promedio) || 0 }))
  const last = bars[bars.length - 1]?.value || 0
  const prev = bars[bars.length - 2]?.value || 0
  const cambio = pctChange(prev, last)

  return (
    <div style={{ ...sCardMini, ...(pinned ? { borderLeft: `3px solid ${C.purple}` } : {}) }}>
      {onClose && (
        <button onClick={onClose} style={sBtnCloseCard} title="Ocultar card">✕</button>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingRight: 22 }}>
        <span style={{ color: pinned ? C.purple : C.gold, fontSize: 14, fontWeight: 800, fontFamily: 'monospace' }}>{typeof rank === 'number' ? `#${rank}` : rank}</span>
        <span style={{ color: C.white, fontSize: 13, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={prov.proveedor_nombre}>
          {prov.proveedor_nombre}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ color: C.gold, fontSize: 18, fontWeight: 800, fontFamily: 'monospace' }}>{fmt0(prov.monto)}</span>
        {cambio != null && (
          <span style={sChip(cambio >= 0 ? C.greenLight : C.red, cambio >= 0 ? 'rgba(74,222,128,0.1)' : 'rgba(230,57,70,0.1)')}>
            {cambio >= 0 ? '▲' : '▼'} {Math.abs(cambio).toFixed(1)}% MoM
          </span>
        )}
      </div>
      <MiniChart bars={bars} line={ticketLine} barColor={C.blue} lineColor={C.gold} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textMuted }}>
        <span>{prov.n} DTEs · cada {prov.dias_promedio_entre_compras_365d || '—'}d</span>
        <span>últ. {prov.dias_desde_ultima ?? '—'}d</span>
      </div>
      {prov.categoria_principal && <div><span style={sChip(C.gold)}>{prov.categoria_principal}</span></div>}
      <div style={{ fontSize: 9, color: C.textMuted, marginTop: -2 }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, background: C.blue, marginRight: 4, borderRadius: 1 }} />
        Volumen mensual
        <span style={{ display: 'inline-block', width: 8, height: 2, background: C.gold, margin: '0 4px 0 10px' }} />
        Ticket promedio
      </div>
    </div>
  )
}

// ── Card de anomalía ──
function CardAnomalia({ icon, color, razon, titulo, subtitulo, serieArr, onClose }) {
  const bars = serieArr.map(s => ({ label: s.ym, value: s.monto }))
  const ticketLine = serieArr.map(s => ({ label: s.ym, value: s.ticket || s.precio_avg || 0 }))
  return (
    <div style={{ ...sCardMini, borderLeft: `3px solid ${color}` }}>
      {onClose && <button onClick={onClose} style={sBtnCloseCard} title="Ocultar card">✕</button>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 22 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ color: color, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>{razon}</span>
      </div>
      <div style={{ color: C.white, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={titulo}>{titulo}</div>
      {subtitulo && <div style={{ fontSize: 10, color: C.textMuted, fontFamily: 'monospace' }}>{subtitulo}</div>}
      <MiniChart bars={bars} line={ticketLine} barColor={C.blue} lineColor={C.gold} />
      <div style={{ fontSize: 9, color: C.textMuted, marginTop: -2 }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, background: C.blue, marginRight: 4, borderRadius: 1 }} />
        Volumen
        <span style={{ display: 'inline-block', width: 8, height: 2, background: C.gold, margin: '0 4px 0 10px' }} />
        Último precio de compra
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//   ItemsBuscador (ahora ordenado por MONTO)
// ══════════════════════════════════════════════════════

function ItemsBuscador() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [mensual, setMensual] = useState({})
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState(() => new Set(loadLS(LS_HIDDEN_ITEMS)))
  const [pinned, setPinned] = useState(() => loadLS(LS_PINNED_ITEMS))
  const [showPicker, setShowPicker] = useState(false)

  const meses = useMemo(() => lastNMonths(13), [])
  const persistHidden = (next) => saveLS(LS_HIDDEN_ITEMS, Array.from(next))
  const persistPinned = (next) => saveLS(LS_PINNED_ITEMS, next)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        let itemsData = []
        let mensualData = []
        try {
          // ✱ Ordenar por MONTO (volumen $) en lugar de frecuencia
          itemsData = await fetchAll(
            db.from('v_kpi_items_precios').select('*').order('monto_total', { ascending: false, nullsFirst: false }),
            'v_kpi_items_precios'
          )
        } catch (e) { console.error('items', e) }
        try {
          mensualData = await fetchAll(db.from('v_kpi_item_mensual').select('*'), 'v_kpi_item_mensual')
        } catch (e) { console.error('item_mensual', e) }
        setItems(itemsData)
        const idx = {}
        mensualData.forEach(r => {
          if (!idx[r.descripcion_normalizada]) idx[r.descripcion_normalizada] = {}
          idx[r.descripcion_normalizada][r.year_month] = r
        })
        setMensual(idx)
      } finally { setLoading(false) }
    })()
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return items
    return items.filter(r => (r.descripcion_display || '').toLowerCase().includes(s) || (r.ultimo_proveedor || '').toLowerCase().includes(s))
  }, [items, search])

  const top10Raw = filtered.filter(it => !hidden.has(it.descripcion_normalizada)).slice(0, 10)

  const pinnedCards = useMemo(() => {
    const top10Ids = new Set(top10Raw.map(it => it.descripcion_normalizada))
    return pinned
      .map(key => filtered.find(it => it.descripcion_normalizada === key))
      .filter(Boolean)
      .filter(it => !top10Ids.has(it.descripcion_normalizada))
  }, [pinned, filtered, top10Raw])

  const anomalias = useMemo(() => {
    if (loading) return []
    const candidatos = []
    items.forEach(it => {
      if (hidden.has(it.descripcion_normalizada)) return
      const serie = mensual[it.descripcion_normalizada]
      if (!serie) return
      const serieArr = meses.map(m => ({
        ym: m,
        monto: Number(serie[m]?.monto) || 0,
        cantidad: Number(serie[m]?.cantidad) || 0,
        precio_avg: Number(serie[m]?.precio_avg) || 0,
      }))
      const conActividad = serieArr.filter(s => s.cantidad > 0)
      if (conActividad.length < 2) return

      const lastConPrecio = [...serieArr].reverse().find(s => s.precio_avg > 0)
      const prevConPrecio = [...serieArr].reverse().slice(1).find(s => s.precio_avg > 0)
      if (lastConPrecio && prevConPrecio && prevConPrecio.precio_avg > 0) {
        const ch = (lastConPrecio.precio_avg - prevConPrecio.precio_avg) / prevConPrecio.precio_avg
        if (Math.abs(ch) >= 0.20 && Number(it.monto_total) >= 200) {
          candidatos.push({
            tipo: 'salto_precio',
            razon: `Precio ${ch >= 0 ? '↑' : '↓'} ${(Math.abs(ch) * 100).toFixed(0)}% ($${prevConPrecio.precio_avg.toFixed(2)} → $${lastConPrecio.precio_avg.toFixed(2)})`,
            color: ch >= 0 ? C.red : C.greenLight, icon: ch >= 0 ? '🔺' : '🔻',
            item: it, serieArr, metricKey: Math.abs(ch) * Number(it.monto_total),
          })
        }
      }
      if (it.n_proveedores >= 4 && Number(it.monto_total) >= 1000) {
        const variacion = (it.precio_max && it.precio_min && it.precio_min > 0) ? (it.precio_max - it.precio_min) / it.precio_min : 0
        if (variacion >= 0.15) {
          candidatos.push({
            tipo: 'multi_proveedor',
            razon: `${it.n_proveedores} proveedores · variación ${(variacion * 100).toFixed(0)}% (min $${Number(it.precio_min).toFixed(2)} – max $${Number(it.precio_max).toFixed(2)})`,
            color: C.purple, icon: '🔄', item: it, serieArr, metricKey: variacion * Number(it.monto_total),
          })
        }
      }
      const last = serieArr[serieArr.length - 1]
      const prev3 = serieArr.slice(-4, -1)
      const promPrev3Cant = prev3.length ? prev3.reduce((s, x) => s + x.cantidad, 0) / prev3.length : 0
      if (promPrev3Cant >= 5 && last.cantidad > promPrev3Cant * 2.5) {
        candidatos.push({ tipo: 'volumen_sube', razon: `Consumo ↑ ${((last.cantidad / promPrev3Cant - 1) * 100).toFixed(0)}% vs prom 3 meses`, color: C.gold, icon: '📈', item: it, serieArr, metricKey: (last.cantidad - promPrev3Cant) * (it.precio_avg || 1) })
      }
      if (promPrev3Cant >= 10 && last.cantidad < promPrev3Cant * 0.3) {
        candidatos.push({ tipo: 'volumen_baja', razon: `Consumo ↓ ${((1 - last.cantidad / promPrev3Cant) * 100).toFixed(0)}% vs prom 3 meses`, color: C.blue, icon: '📉', item: it, serieArr, metricKey: (promPrev3Cant - last.cantidad) * (it.precio_avg || 1) })
      }
    })
    const seen = new Set()
    const ordenPrioridad = ['salto_precio', 'volumen_baja', 'volumen_sube', 'multi_proveedor']
    candidatos.sort((a, b) => ordenPrioridad.indexOf(a.tipo) - ordenPrioridad.indexOf(b.tipo) || b.metricKey - a.metricKey)
    const out = []
    for (const c of candidatos) {
      if (seen.has(c.item.descripcion_normalizada)) continue
      seen.add(c.item.descripcion_normalizada)
      out.push(c)
      if (out.length >= 5) break
    }
    return out
  }, [items, mensual, meses, loading, hidden])

  const hideCard = (key) => { const next = new Set(hidden); next.add(key); setHidden(next); persistHidden(next) }
  const unhideAll = () => { setHidden(new Set()); persistHidden(new Set()) }
  const pinCard = (key) => { if (pinned.includes(key)) return; const next = [...pinned, key]; setPinned(next); persistPinned(next); setShowPicker(false) }
  const unpinCard = (key) => { const next = pinned.filter(x => x !== key); setPinned(next); persistPinned(next) }

  return (
    <div>
      <div style={sCard}>
        <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>Buscar item o proveedor (precios)</label>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Ej. queso, papas, pan, BELCA…" style={{ ...sInput, width: '100%', fontSize: 14, padding: '12px 14px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <div style={{ fontSize: 10, color: C.textMuted }}>
            {loading ? 'Cargando…' : `${items.length.toLocaleString()} items con histórico de precios · ${filtered.length.toLocaleString()} coincidencia${filtered.length === 1 ? '' : 's'}`}
          </div>
          {hidden.size > 0 && (
            <button onClick={unhideAll} style={{ ...sBtn(false), color: C.gold, borderColor: C.gold }}>↺ Mostrar {hidden.size} oculto{hidden.size === 1 ? '' : 's'}</button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ ...sCard, padding: 60, textAlign: 'center', color: C.textMuted }}>⏳ Cargando KPIs…</div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              🏆 Top 10 items por volumen ($)
            </div>
            <button onClick={() => setShowPicker(true)} style={{ ...sBtn(false), color: C.gold, borderColor: C.gold }}>+ Agregar card</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, marginBottom: 16 }}>
            {top10Raw.map((it, i) => (
              <CardItem
                key={it.descripcion_normalizada}
                rank={i + 1}
                item={it}
                serie={meses.map(m => mensual[it.descripcion_normalizada]?.[m])}
                meses={meses}
                onClose={() => hideCard(it.descripcion_normalizada)}
              />
            ))}
          </div>

          {pinnedCards.length > 0 && (
            <>
              <div style={{ marginBottom: 6, color: C.purple, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                📌 Cards fijadas ({pinnedCards.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, marginBottom: 16 }}>
                {pinnedCards.map(it => (
                  <CardItem
                    key={`pinned_${it.descripcion_normalizada}`}
                    rank={'★'}
                    item={it}
                    serie={meses.map(m => mensual[it.descripcion_normalizada]?.[m])}
                    meses={meses}
                    onClose={() => unpinCard(it.descripcion_normalizada)}
                    pinned
                  />
                ))}
              </div>
            </>
          )}

          {anomalias.length > 0 && (
            <>
              <div style={{ marginBottom: 6, color: C.red, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                ⚡ A revisar — {anomalias.length} señal{anomalias.length === 1 ? '' : 'es'} detectada{anomalias.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, marginBottom: 16 }}>
                {anomalias.map((a, i) => (
                  <CardAnomalia
                    key={`${a.tipo}_${a.item.descripcion_normalizada}_${i}`}
                    icon={a.icon} color={a.color} razon={a.razon}
                    titulo={a.item.descripcion_display}
                    subtitulo={`Últ. proveedor: ${a.item.ultimo_proveedor || '—'} · ${a.item.n_compras} compras`}
                    serieArr={a.serieArr}
                    onClose={() => hideCard(a.item.descripcion_normalizada)}
                  />
                ))}
              </div>
            </>
          )}

          <div style={{ marginBottom: 6, color: C.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Tabla completa ({filtered.length})
          </div>
          <div style={{ ...sCard, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead style={{ background: C.cardAlt }}>
                <tr>
                  <th style={sTh}>Descripción</th><th style={sThR}>Volumen $</th><th style={sThR}>#</th><th style={sThR}>Provs</th>
                  <th style={sThR}>Mín</th><th style={sThR}>Prom</th><th style={sThR}>Máx</th>
                  <th style={sThR}>Variación</th><th style={sThR}>Último</th>
                  <th style={sTh}>Último proveedor</th><th style={sTh}>Última compra</th><th style={sTh}>Pin</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map(r => {
                  const variacion = (r.precio_max && r.precio_min && r.precio_min > 0) ? ((r.precio_max - r.precio_min) / r.precio_min) * 100 : 0
                  const alta = variacion > 20
                  return (
                    <tr key={r.descripcion_normalizada}>
                      <td style={{ ...sTd, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.descripcion_display}>{r.descripcion_display}</td>
                      <td style={{ ...sTdR, fontWeight: 700, color: C.gold }}>{fmt0(r.monto_total)}</td>
                      <td style={sTdR}>{r.n_compras}</td>
                      <td style={sTdR}>{r.n_proveedores}</td>
                      <td style={sTdR}>{fmt(r.precio_min)}</td>
                      <td style={sTdR}>{fmt(r.precio_avg)}</td>
                      <td style={sTdR}>{fmt(r.precio_max)}</td>
                      <td style={{ ...sTdR, color: alta ? C.red : variacion > 5 ? C.gold : C.greenLight, fontWeight: 700 }}>{variacion.toFixed(1)}%</td>
                      <td style={{ ...sTdR, fontWeight: 700 }}>{fmt(r.ultimo_precio)}</td>
                      <td style={{ ...sTd, fontSize: 10, color: C.textMuted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.ultimo_proveedor}>{r.ultimo_proveedor || '—'}</td>
                      <td style={sTdMuted}>{r.ultima_compra || '—'}</td>
                      <td style={sTd}>
                        <button
                          onClick={() => pinned.includes(r.descripcion_normalizada) ? unpinCard(r.descripcion_normalizada) : pinCard(r.descripcion_normalizada)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: pinned.includes(r.descripcion_normalizada) ? C.purple : C.textMuted, fontSize: 14 }}
                          title={pinned.includes(r.descripcion_normalizada) ? 'Quitar pin' : 'Fijar como card'}
                        >
                          {pinned.includes(r.descripcion_normalizada) ? '📌' : '📍'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showPicker && (
        <PickerModal
          titulo="Agregar card de item"
          opciones={filtered.map(it => ({ id: it.descripcion_normalizada, label: it.descripcion_display, sub: `${fmt0(it.monto_total)} · ${it.n_compras} compras · últ. $${Number(it.ultimo_precio || 0).toFixed(2)}` }))}
          onPick={(id) => pinCard(id)}
          onClose={() => setShowPicker(false)}
          yaPinned={pinned}
        />
      )}
    </div>
  )
}

// ── Card de item ──
function CardItem({ rank, item, serie, meses, onClose, pinned }) {
  const bars = meses.map((m, i) => ({ label: m, value: Number(serie[i]?.cantidad) || 0 }))
  const priceLine = meses.map((m, i) => ({ label: m, value: Number(serie[i]?.precio_avg) || 0 }))
  const conPrecio = priceLine.filter(p => p.value > 0)
  const lastP = conPrecio[conPrecio.length - 1]?.value || 0
  const prevP = conPrecio[conPrecio.length - 2]?.value || 0
  const cambio = pctChange(prevP, lastP)

  return (
    <div style={{ ...sCardMini, ...(pinned ? { borderLeft: `3px solid ${C.purple}` } : {}) }}>
      {onClose && <button onClick={onClose} style={sBtnCloseCard} title="Ocultar card">✕</button>}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingRight: 22 }}>
        <span style={{ color: pinned ? C.purple : C.gold, fontSize: 14, fontWeight: 800, fontFamily: 'monospace' }}>{typeof rank === 'number' ? `#${rank}` : rank}</span>
        <span style={{ color: C.white, fontSize: 12, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.descripcion_display}>
          {item.descripcion_display}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Volumen total</div>
          <span style={{ color: C.gold, fontSize: 16, fontWeight: 800, fontFamily: 'monospace' }}>{fmt0(item.monto_total)}</span>
        </div>
        {cambio != null ? (
          <span style={sChip(cambio >= 0 ? C.red : C.greenLight, cambio >= 0 ? 'rgba(230,57,70,0.1)' : 'rgba(74,222,128,0.1)')}>
            {cambio >= 0 ? '▲' : '▼'} {Math.abs(cambio).toFixed(1)}% precio
          </span>
        ) : (
          <span style={sChip(C.textMuted)}>{item.n_compras} compras</span>
        )}
      </div>
      <MiniChart bars={bars} line={priceLine} barColor={C.blue} lineColor={C.gold} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textMuted }}>
        <span>{item.n_compras} compras · {item.n_proveedores} prov.</span>
        <span>últ. {item.ultima_compra || '—'}</span>
      </div>
      <div style={{ fontSize: 10, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.ultimo_proveedor}>
        ← {item.ultimo_proveedor || '—'}
      </div>
      <div style={{ fontSize: 9, color: C.textMuted, marginTop: -2 }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, background: C.blue, marginRight: 4, borderRadius: 1 }} />
        Cantidad mensual
        <span style={{ display: 'inline-block', width: 8, height: 2, background: C.gold, margin: '0 4px 0 10px' }} />
        Último precio de compra
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//   PickerModal — buscador para agregar card
// ══════════════════════════════════════════════════════

function PickerModal({ titulo, opciones, onPick, onClose, yaPinned = [] }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return opciones.slice(0, 100)
    return opciones.filter(o => o.label.toLowerCase().includes(s) || (o.sub || '').toLowerCase().includes(s)).slice(0, 100)
  }, [q, opciones])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.dark, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 16, maxWidth: 600, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ color: C.white, margin: 0, fontSize: 16, fontWeight: 800 }}>{titulo}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.textMuted, fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
        </div>
        <input
          autoFocus
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar…"
          style={{ ...sInput, width: '100%', fontSize: 14, padding: '10px 12px' }}
        />
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 200 }}>
          {filtered.length === 0 ? (
            <div style={{ color: C.textMuted, fontSize: 12, padding: 16, textAlign: 'center' }}>Sin resultados.</div>
          ) : filtered.map(o => {
            const ya = yaPinned.includes(o.id)
            return (
              <button
                key={o.id}
                onClick={() => !ya && onPick(o.id)}
                disabled={ya}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: ya ? 'rgba(167,139,250,0.08)' : 'transparent',
                  border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginBottom: 6,
                  color: C.white, cursor: ya ? 'default' : 'pointer', fontSize: 12,
                }}
                onMouseEnter={e => { if (!ya) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!ya) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontWeight: 700 }}>{o.label} {ya && <span style={{ color: C.purple, fontSize: 10 }}>· ya fijado</span>}</div>
                {o.sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{o.sub}</div>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//   MixCategorias — categorías colapsables con drill-down
// ══════════════════════════════════════════════════════

function MixCategorias() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [ventana, setVentana] = useState(90)
  const [expanded, setExpanded] = useState(new Set())
  const [detalle, setDetalle] = useState({})
  const [detalleLoading, setDetalleLoading] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    const desde = new Date(Date.now() - ventana * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const data = await fetchAll(
      db.from('v_dtes_finanzas').select('monto_total, categoria_nombre, categoria_grupo').gte('fecha_emision', desde),
      'mix_dtes'
    )
    setRows(data)
    setLoading(false)
    setExpanded(new Set())
    setDetalle({})
  }, [ventana])

  useEffect(() => { loadData() }, [loadData])

  const mix = useMemo(() => {
    const byCat = {}
    rows.forEach(r => {
      const k = r.categoria_nombre || 'Sin categoría'
      const m = Number(r.monto_total) || 0
      if (!byCat[k]) byCat[k] = { cat: k, grupo: r.categoria_grupo || '—', monto: 0, n: 0 }
      byCat[k].monto += m
      byCat[k].n += 1
    })
    const arr = Object.values(byCat).sort((a, b) => b.monto - a.monto)
    const total = arr.reduce((s, r) => s + r.monto, 0)
    return { arr, total }
  }, [rows])

  const COLORS = ['#e63946', '#f4a261', '#4ade80', '#3b82f6', '#ec4899', '#a78bfa', '#2dd4bf', '#fbbf24', '#94a3b8']

  const toggle = async (cat) => {
    const newExp = new Set(expanded)
    if (newExp.has(cat)) { newExp.delete(cat); setExpanded(newExp); return }
    newExp.add(cat); setExpanded(newExp)
    if (detalle[cat]) return
    setDetalleLoading(prev => ({ ...prev, [cat]: true }))
    try {
      const desde = new Date(Date.now() - ventana * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const dtes = await fetchAll(
        db.from('v_dtes_finanzas').select('id, proveedor_nit, proveedor_nombre, monto_total, fecha_emision').eq('categoria_nombre', cat).gte('fecha_emision', desde),
        `detalle_dtes_${cat}`
      )
      const byProv = {}
      dtes.forEach(d => {
        const k = d.proveedor_nit || 'sin_nit'
        if (!byProv[k]) byProv[k] = { nit: d.proveedor_nit, nombre: d.proveedor_nombre, monto: 0, n: 0 }
        byProv[k].monto += Number(d.monto_total) || 0
        byProv[k].n += 1
      })
      const provs = Object.values(byProv).sort((a, b) => b.monto - a.monto).slice(0, 5)
      const dteIds = dtes.map(d => d.id)
      let topItems = []
      if (dteIds.length > 0) {
        const CHUNK = 200
        const allItems = []
        for (let i = 0; i < dteIds.length; i += CHUNK) {
          const chunk = dteIds.slice(i, i + CHUNK)
          const { data } = await db.from('compras_dte_items').select('descripcion_original, cantidad, monto_linea, precio_unitario').in('compras_dte_id', chunk)
          if (data) allItems.push(...data)
        }
        const byItem = {}
        allItems.forEach(it => {
          const k = (it.descripcion_original || '').trim().toLowerCase()
          if (!k) return
          if (!byItem[k]) byItem[k] = { desc: it.descripcion_original, monto: 0, cantidad: 0, n: 0 }
          byItem[k].monto += Number(it.monto_linea) || 0
          byItem[k].cantidad += Number(it.cantidad) || 0
          byItem[k].n += 1
        })
        topItems = Object.values(byItem).sort((a, b) => b.monto - a.monto).slice(0, 8)
      }
      setDetalle(prev => ({ ...prev, [cat]: { provs, items: topItems, totalDtes: dtes.length } }))
    } catch (e) {
      console.warn('detalle categoria', cat, e)
      setDetalle(prev => ({ ...prev, [cat]: { provs: [], items: [], totalDtes: 0 } }))
    } finally { setDetalleLoading(prev => ({ ...prev, [cat]: false })) }
  }

  return (
    <div>
      <div style={{ ...sCard, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: C.textMuted, fontSize: 11 }}>Ventana:</span>
        {[30, 90, 180, 365].map(d => (
          <button key={d} onClick={() => setVentana(d)} style={sBtn(ventana === d)}>{d}d</button>
        ))}
        <KPI label={`Total ${ventana}d`} value={fmt0(mix.total)} color={C.gold} />
        <KPI label="Categorías" value={mix.arr.length} />
      </div>

      <div style={sCard}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>⏳ Cargando…</div>
        ) : mix.arr.map((r, i) => {
          const w = mix.total > 0 ? (r.monto / mix.total) * 100 : 0
          const isExp = expanded.has(r.cat)
          const det = detalle[r.cat]
          return (
            <div key={r.cat} style={{ marginBottom: 10, borderBottom: `1px solid rgba(255,255,255,0.04)`, paddingBottom: 8 }}>
              <div onClick={() => toggle(r.cat)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ color: C.white, fontSize: 12, fontWeight: 600 }}>
                    <span style={{ color: C.textMuted, fontFamily: 'monospace', marginRight: 6 }}>{isExp ? '▾' : '▸'}</span>
                    {r.cat} <span style={{ color: C.textMuted, fontSize: 10 }}>· {r.grupo}</span>
                  </span>
                  <span style={{ color: C.gold, fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>
                    {fmt0(r.monto)} <span style={{ color: C.textMuted, fontWeight: 400 }}>({w.toFixed(1)}%)</span>
                  </span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 10, overflow: 'hidden', marginTop: 4 }}>
                  <div style={{ width: `${w}%`, height: '100%', background: COLORS[i % COLORS.length] }} />
                </div>
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{r.n.toLocaleString()} DTEs · clic para desplegar</div>
              </div>
              {isExp && (
                <div style={{ marginTop: 10, padding: 10, background: 'rgba(15,52,96,0.4)', borderRadius: 6 }}>
                  {detalleLoading[r.cat] ? (
                    <div style={{ color: C.textMuted, fontSize: 11, textAlign: 'center', padding: 12 }}>⏳ Cargando detalle…</div>
                  ) : !det ? (
                    <div style={{ color: C.textMuted, fontSize: 11, textAlign: 'center', padding: 12 }}>—</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                          Top proveedores ({det.provs.length})
                        </div>
                        {det.provs.length === 0 ? <div style={{ fontSize: 10, color: C.textMuted }}>—</div> : det.provs.map((p, j) => {
                          const pw = r.monto > 0 ? (p.monto / r.monto) * 100 : 0
                          return (
                            <div key={p.nit || j} style={{ marginBottom: 6 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                                <span style={{ color: C.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={p.nombre}>{j + 1}. {p.nombre || p.nit || '—'}</span>
                                <span style={{ color: C.gold, fontFamily: 'monospace', marginLeft: 8 }}>{fmt0(p.monto)}</span>
                              </div>
                              <div style={{ background: 'rgba(255,255,255,0.04)', height: 4, borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${pw}%`, height: '100%', background: COLORS[i % COLORS.length], opacity: 0.7 }} />
                              </div>
                              <div style={{ fontSize: 9, color: C.textMuted }}>{p.n} DTEs · {pw.toFixed(1)}%</div>
                            </div>
                          )
                        })}
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                          Top items ({det.items.length})
                        </div>
                        {det.items.length === 0 ? <div style={{ fontSize: 10, color: C.textMuted }}>No hay items extraídos en esta categoría.</div> : det.items.map((it, j) => (
                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4, gap: 6 }}>
                            <span style={{ color: C.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={it.desc}>{j + 1}. {it.desc}</span>
                            <span style={{ color: C.gold, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                              {fmt0(it.monto)} <span style={{ color: C.textMuted, fontSize: 9 }}>({fmtNum(it.cantidad)} u)</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
