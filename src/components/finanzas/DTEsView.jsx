import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'
import { fetchAllRows } from '../../utils/fetchPaginated'
import { paletaC as C } from '@/theme'

/* ═══════════════════════════════════════════════════════════════
   FREAKIE DOGS — Vista DTEs (item del sidebar Finanzas)
   Sub-tabs:
     • Listado  → tabla con filtros + filas expandibles con items
     • KPIs     → buscador items/proveedores + Top + mix
   Fuentes:
     • v_dtes_finanzas        — DTE + categoría + sucursal + método pago
     • v_dtes_finanzas_items  — UNION compras_dte_items + json_original->cuerpoDocumento
     • v_kpi_proveedores      — Top + frecuencia + categoría principal
     • v_kpi_items_precios    — items min/avg/max/último
   ═══════════════════════════════════════════════════════════════ */

// ── Brand colors — ahora centralizados en src/theme.js (paletaC) ──

const fmt = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (n) => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US')
const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'

// Métodos de pago → estilo
const METODO_COLOR = {
  'Transferencia': C.blue,
  'Efectivo':      C.greenLight,
  'Mixto':         C.gold,
  'Pagado (sin trace)': '#a78bfa',
  'Pendiente':     C.gray,
}

const ESTADO_COLOR = {
  'pagado':    C.greenLight,
  'pendiente': C.gold,
  'parcial':   C.blue,
}

// Sucursales conocidas para filtro
const SUCURSALES_OPCIONES = ['M001', 'S001', 'S003', 'S004', 'S005', 'S006', 'S007', 'CM001', 'EVENTOS']

// ── Styles ──
const sCard = { background: C.card, borderRadius: 12, padding: 16, marginBottom: 12, border: `1px solid ${C.border}` }
const sInput = {
  background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`,
  borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none',
}
const sSelect = { ...sInput, cursor: 'pointer' }
const sBtn = (active) => ({
  padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontWeight: 700, fontSize: 11,
  background: active ? C.red : 'transparent',
  color: active ? C.white : C.textMuted,
  border: `1px solid ${active ? C.red : C.border}`,
  transition: 'all .15s',
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

// ── Helper local removido — usar fetchAllRows(db, table, q => ...) del helper central.
// El antiguo fetchAll(builder) reusaba el query builder entre iteraciones (bug Supabase JS).

// ══════════════════════════════════════════════════════
//   COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════

export default function DTEsView({ user }) {
  const [subtab, setSubtab] = useState('listado')

  return (
    <div style={{ padding: '12px 8px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Header de vista */}
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
//   SUB-TAB 1: Listado de DTEs
// ══════════════════════════════════════════════════════

function ListadoDTEs() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [categoriasOpts, setCategoriasOpts] = useState([])

  // Filtros
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

  // UI state
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState({}) // { dte_id: items[] }
  const [itemsLoading, setItemsLoading] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAllRows(db, 'v_dtes_finanzas', q => q
        .select('*')
        .gte('fecha_emision', fechaDesde)
        .lte('fecha_emision', fechaHasta)
        .order('fecha_emision', { ascending: false })
      )
      setRows(data)

      // Categorías únicas para filtro
      const catSet = new Set()
      data.forEach(r => { if (r.categoria_nombre) catSet.add(r.categoria_nombre) })
      setCategoriasOpts(Array.from(catSet).sort())
    } catch (e) {
      console.error('loadData DTEs', e)
    } finally {
      setLoading(false)
    }
  }, [fechaDesde, fechaHasta])

  useEffect(() => { loadData() }, [loadData])

  const loadItems = async (dteId) => {
    if (items[dteId]) return
    setItemsLoading(prev => ({ ...prev, [dteId]: true }))
    try {
      const { data, error } = await db
        .from('v_dtes_finanzas_items')
        .select('*')
        .eq('compras_dte_id', dteId)
        .order('linea', { ascending: true })
      if (error) throw error
      setItems(prev => ({ ...prev, [dteId]: data || [] }))
    } catch (e) {
      console.warn('loadItems', e)
      setItems(prev => ({ ...prev, [dteId]: [] }))
    } finally {
      setItemsLoading(prev => ({ ...prev, [dteId]: false }))
    }
  }

  const toggleExpand = (dteId) => {
    if (expandedId === dteId) {
      setExpandedId(null)
    } else {
      setExpandedId(dteId)
      loadItems(dteId)
    }
  }

  // Filtrado en memoria
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

  // Totales
  const totales = useMemo(() => {
    return filtered.reduce((acc, r) => {
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
    }, { count: 0, total: 0, iva: 0, pagado: 0, saldo: 0, tef: 0, efe: 0, pend: 0 })
  }, [filtered])

  return (
    <div>
      {/* Filtros */}
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
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Ej. BELCA, 06141908…"
              style={sInput}
            />
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

      {/* KPIs */}
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

      {/* Tabla */}
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
                <th style={sTh}>Fecha</th>
                <th style={sTh}>Tipo</th>
                <th style={sTh}>Proveedor</th>
                <th style={sTh}>NIT</th>
                <th style={sTh}>N° Control</th>
                <th style={sTh}>Categoría</th>
                <th style={sTh}>Suc.</th>
                <th style={sThR}>Subtotal</th>
                <th style={sThR}>IVA</th>
                <th style={sThR}>Total</th>
                <th style={sTh}>Estado</th>
                <th style={sTh}>Método</th>
                <th style={sTh}>Vencimiento</th>
                <th style={sThR}>Saldo</th>
                <th style={sTh}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map(r => (
                <React.Fragment key={r.id}>
                  <tr
                    onClick={() => toggleExpand(r.id)}
                    style={{
                      cursor: 'pointer',
                      background: expandedId === r.id ? 'rgba(244,162,97,0.06)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (expandedId !== r.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                    onMouseLeave={e => { if (expandedId !== r.id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <td style={sTd}>{expandedId === r.id ? '▾' : '▸'}</td>
                    <td style={sTd}>{r.fecha_emision}</td>
                    <td style={sTd}><span style={sChip(C.gold)}>{r.tipo_dte_nombre || '—'}</span></td>
                    <td style={{ ...sTd, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.proveedor_nombre}>
                      {r.proveedor_nombre || '—'}
                    </td>
                    <td style={sTdMuted}>{r.proveedor_nit || '—'}</td>
                    <td style={sTdMuted}>{r.dte_codigo || r.numero_control || '—'}</td>
                    <td style={sTdMuted}>{r.categoria_nombre || '—'}</td>
                    <td style={sTdMuted}>{r.sucursal_code || '—'}</td>
                    <td style={sTdR}>{fmt(r.subtotal)}</td>
                    <td style={sTdR}>{fmt(r.iva)}</td>
                    <td style={{ ...sTdR, fontWeight: 700 }}>{fmt(r.monto_total)}</td>
                    <td style={sTd}>
                      <span style={sChip(ESTADO_COLOR[r.estado_pago] || C.white)}>
                        {r.estado_pago || '—'}
                      </span>
                    </td>
                    <td style={sTd}>
                      <span style={sChip(METODO_COLOR[r.metodo_pago] || C.white)}>
                        {r.metodo_pago}
                      </span>
                    </td>
                    <td style={sTdMuted}>
                      {r.fecha_vencimiento || '—'}
                      {r.dias_vencido > 0 && (
                        <span style={{ ...sChip(C.red, 'rgba(230,57,70,0.15)'), marginLeft: 4 }}>+{r.dias_vencido}d</span>
                      )}
                    </td>
                    <td style={{ ...sTdR, color: r.saldo > 0 ? C.gold : C.textMuted }}>
                      {r.saldo > 0 ? fmt(r.saldo) : '—'}
                    </td>
                    <td style={sTd}>
                      {r.archivo_pdf_url ? (
                        <a
                          href={r.archivo_pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: C.blue, textDecoration: 'none' }}
                        >📄</a>
                      ) : '—'}
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr>
                      <td colSpan={16} style={{ padding: 0, background: 'rgba(15,52,96,0.4)' }}>
                        <ExpandedRow
                          dte={r}
                          items={items[r.id]}
                          loading={itemsLoading[r.id]}
                        />
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

// ══════════════════════════════════════════════════════
//   FILA EXPANDIDA: items + detalles de pago
// ══════════════════════════════════════════════════════

function ExpandedRow({ dte, items, loading }) {
  return (
    <div style={{ padding: 14 }}>
      {/* Detalles de pago / cruce */}
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

      {/* Items */}
      <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Items del DTE
      </div>
      {loading ? (
        <div style={{ padding: 14, textAlign: 'center', color: C.textMuted }}>⏳ Cargando items…</div>
      ) : !items || items.length === 0 ? (
        <div style={{ padding: 14, textAlign: 'center', color: C.textMuted, fontSize: 11 }}>
          Este DTE no tiene items extraídos. {dte.archivo_pdf_url && <a href={dte.archivo_pdf_url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>Ver PDF</a>}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ ...sTh, fontSize: 9 }}>#</th>
              <th style={{ ...sTh, fontSize: 9 }}>Descripción</th>
              <th style={{ ...sTh, fontSize: 9 }}>Producto mapeado</th>
              <th style={{ ...sThR, fontSize: 9 }}>Cant.</th>
              <th style={{ ...sThR, fontSize: 9 }}>P. Unit.</th>
              <th style={{ ...sThR, fontSize: 9 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id}>
                <td style={sTdMuted}>{it.linea}</td>
                <td style={sTd}>{it.descripcion_original}</td>
                <td style={sTdMuted}>
                  {it.producto_nombre ? (
                    <span style={sChip(C.greenLight, 'rgba(74,222,128,0.1)')}>{it.producto_nombre}</span>
                  ) : '—'}
                </td>
                <td style={sTdR}>{Number(it.cantidad).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                <td style={sTdR}>{fmt(it.precio_unitario)}</td>
                <td style={{ ...sTdR, fontWeight: 700 }}>{fmt(it.monto_linea)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Field({ label, value, color, mono, small }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: small ? 10 : 12, color: color || C.white, fontWeight: 600,
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-word',
      }}>{value || '—'}</div>
    </div>
  )
}

function KPI({ label, value, color }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '8px 12px', minWidth: 110, flex: 1,
    }}>
      <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || C.white, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//   SUB-TAB 2: KPIs (Proveedores / Items)
// ══════════════════════════════════════════════════════

function KPIsTab() {
  const [vista, setVista] = useState('proveedores') // 'proveedores' | 'items' | 'mix'
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

// ── Top Proveedores ──
function ProveedoresKPI() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [ventana, setVentana] = useState('365d') // '30d' | '90d' | '365d'
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      const data = await fetchAllRows(db, 'v_kpi_proveedores', q => q
        .select('*').order('monto_365d', { ascending: false })
      )
      setRows(data)
      setLoading(false)
    })()
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    const montoKey = `monto_${ventana}`
    const nKey = `n_dtes_${ventana}`
    return rows
      .filter(r => !s || (r.proveedor_nombre || '').toLowerCase().includes(s) || (r.proveedor_nit || '').toLowerCase().includes(s))
      .map(r => ({ ...r, monto: Number(r[montoKey]) || 0, n: Number(r[nKey]) || 0 }))
      .filter(r => r.monto > 0)
      .sort((a, b) => b.monto - a.monto)
  }, [rows, search, ventana])

  const top10 = filtered.slice(0, 10)
  const totalVentana = filtered.reduce((s, r) => s + r.monto, 0)

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
      </div>

      <div style={sCard}>
        <div style={{ fontSize: 12, color: C.gold, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Top 10 proveedores ({ventana})
        </div>
        {top10.map((r, i) => {
          const w = totalVentana > 0 ? (r.monto / top10[0].monto) * 100 : 0
          return (
            <div key={r.proveedor_nit} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                <span style={{ color: C.white, fontSize: 12, fontWeight: 600 }}>{i + 1}. {r.proveedor_nombre}</span>
                <span style={{ color: C.gold, fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>{fmt0(r.monto)}</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${w}%`, height: '100%', background: `linear-gradient(90deg, ${C.red}, ${C.gold})` }} />
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, display: 'flex', gap: 12 }}>
                <span>{r.n} DTEs</span>
                <span>cada {r.dias_promedio_entre_compras_365d || '—'}d</span>
                <span>última hace {r.dias_desde_ultima ?? '—'}d</span>
                {r.categoria_principal && <span style={sChip(C.gold)}>{r.categoria_principal}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Tabla completa */}
      <div style={{ ...sCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead style={{ background: C.cardAlt }}>
            <tr>
              <th style={sTh}>#</th>
              <th style={sTh}>Proveedor</th>
              <th style={sTh}>NIT</th>
              <th style={sTh}>Categoría</th>
              <th style={sThR}>Monto ({ventana})</th>
              <th style={sThR}>% del total</th>
              <th style={sThR}>DTEs</th>
              <th style={sThR}>Frec. (d)</th>
              <th style={sThR}>Últ. hace</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>⏳ Cargando…</td></tr>
            ) : filtered.slice(0, 200).map((r, i) => (
              <tr key={r.proveedor_nit}>
                <td style={sTdMuted}>{i + 1}</td>
                <td style={sTd}>{r.proveedor_nombre}</td>
                <td style={sTdMuted}>{r.proveedor_nit}</td>
                <td style={sTdMuted}>{r.categoria_principal || '—'}</td>
                <td style={{ ...sTdR, fontWeight: 700 }}>{fmt0(r.monto)}</td>
                <td style={sTdR}>{totalVentana > 0 ? ((r.monto / totalVentana) * 100).toFixed(1) + '%' : '—'}</td>
                <td style={sTdR}>{r.n}</td>
                <td style={sTdR}>{r.dias_promedio_entre_compras_365d || '—'}</td>
                <td style={{ ...sTdR, color: r.dias_desde_ultima > 60 ? C.red : C.textMuted }}>
                  {r.dias_desde_ultima ?? '—'}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Buscador de Items ──
function ItemsBuscador() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      const data = await fetchAllRows(db, 'v_kpi_items_precios', q => q
        .select('*').order('n_compras', { ascending: false })
      )
      setRows(data)
      setLoading(false)
    })()
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows.slice(0, 300)
    return rows.filter(r =>
      (r.descripcion_display || '').toLowerCase().includes(s) ||
      (r.ultimo_proveedor || '').toLowerCase().includes(s)
    ).slice(0, 300)
  }, [rows, search])

  return (
    <div>
      <div style={sCard}>
        <label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 4 }}>
          Buscar item o proveedor (precios)
        </label>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Ej. queso, papas, pan, BELCA…"
          style={{ ...sInput, width: '100%', fontSize: 14, padding: '12px 14px' }}
        />
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>
          {loading ? 'Cargando…' : `${rows.length.toLocaleString()} items con histórico de precios · mostrando ${filtered.length}`}
        </div>
      </div>

      <div style={{ ...sCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead style={{ background: C.cardAlt }}>
            <tr>
              <th style={sTh}>Descripción</th>
              <th style={sThR}>#</th>
              <th style={sThR}>Provs</th>
              <th style={sThR}>Mín</th>
              <th style={sThR}>Prom</th>
              <th style={sThR}>Máx</th>
              <th style={sThR}>Variación</th>
              <th style={sThR}>Último</th>
              <th style={sTh}>Último proveedor</th>
              <th style={sTh}>Última compra</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>⏳ Cargando…</td></tr>
            ) : filtered.map(r => {
              const variacion = (r.precio_max && r.precio_min && r.precio_min > 0)
                ? ((r.precio_max - r.precio_min) / r.precio_min) * 100
                : 0
              const alta = variacion > 20
              return (
                <tr key={r.descripcion_normalizada}>
                  <td style={{ ...sTd, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.descripcion_display}>
                    {r.descripcion_display}
                  </td>
                  <td style={sTdR}>{r.n_compras}</td>
                  <td style={sTdR}>{r.n_proveedores}</td>
                  <td style={sTdR}>{fmt(r.precio_min)}</td>
                  <td style={sTdR}>{fmt(r.precio_avg)}</td>
                  <td style={sTdR}>{fmt(r.precio_max)}</td>
                  <td style={{ ...sTdR, color: alta ? C.red : variacion > 5 ? C.gold : C.greenLight, fontWeight: 700 }}>
                    {variacion.toFixed(1)}%
                  </td>
                  <td style={{ ...sTdR, fontWeight: 700 }}>{fmt(r.ultimo_precio)}</td>
                  <td style={{ ...sTd, fontSize: 10, color: C.textMuted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.ultimo_proveedor}>
                    {r.ultimo_proveedor || '—'}
                  </td>
                  <td style={sTdMuted}>{r.ultima_compra || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Mix por Categoría ──
function MixCategorias() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [ventana, setVentana] = useState(90) // días

  useEffect(() => {
    (async () => {
      setLoading(true)
      const desde = new Date(Date.now() - ventana * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const data = await fetchAllRows(db, 'v_dtes_finanzas', q => q
        .select('monto_total, categoria_nombre, categoria_grupo')
        .gte('fecha_emision', desde)
      )
      setRows(data)
      setLoading(false)
    })()
  }, [ventana])

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

  return (
    <div>
      <div style={{ ...sCard, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: C.textMuted, fontSize: 11 }}>Ventana:</span>
        {[30, 90, 180, 365].map(d => (
          <button key={d} onClick={() => setVentana(d)} style={sBtn(ventana === d)}>{d}d</button>
        ))}
        <KPI label={`Total ${ventana}d`} value={fmt0(mix.total)} color={C.gold} />
      </div>

      <div style={sCard}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>⏳ Cargando…</div>
        ) : mix.arr.map((r, i) => {
          const w = mix.total > 0 ? (r.monto / mix.total) * 100 : 0
          return (
            <div key={r.cat} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ color: C.white, fontSize: 12, fontWeight: 600 }}>
                  {r.cat} <span style={{ color: C.textMuted, fontSize: 10 }}>· {r.grupo}</span>
                </span>
                <span style={{ color: C.gold, fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>
                  {fmt0(r.monto)} <span style={{ color: C.textMuted, fontWeight: 400 }}>({w.toFixed(1)}%)</span>
                </span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 10, overflow: 'hidden', marginTop: 4 }}>
                <div style={{ width: `${w}%`, height: '100%', background: COLORS[i % COLORS.length] }} />
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{r.n.toLocaleString()} DTEs</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
