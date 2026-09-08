import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'
import { STORES_SHORT, today, shiftDate } from '../../config'
import InfoTip from '../ui/InfoTip'

/**
 * ConsumoVentaDashboard — "¿Qué se consumió por lo que se vendió?"
 *
 * Para Saúl (consultor) y ejecutivos: en un rango de fechas, cuánto salió de
 * cada componente en UNIDADES y en DINERO, agrupado por familia.
 *
 * De dónde sale cada cosa:
 *  · Consumo  → fn_consumo_venta, que lee el kardex tipo 'venta'. Ese kardex lo
 *    escribe pos_deducir_inventario al cobrar, así que YA resolvió combos,
 *    modificadores ("Bebida" → Coca-Cola 300ml) y sub-recetas. Es la única
 *    fuente completa: los componentes de combo en pos_cuenta_items tienen
 *    producto_id NULL, son casillas de pantalla sin producto detrás.
 *  · Venta    → fn_ventas_producto, líneas de cuentas cobradas. Los combos NO
 *    se desglosan (no tienen precio por componente); su desglose real está en
 *    la pestaña de consumo.
 *
 * Las familias de plato se deciden por RECETA, no por nombre: "Coca-Cola Combo"
 * es un combo de hot dog (Freakie Dog + Papa Sazonada), no una bebida.
 *
 * Acceso: admin, ejecutivo, superadmin.
 */

const c = {
  bg: '#0a0a0a', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', purple: '#a78bfa', cyan: '#22d3ee',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
}

const cardStyle = {
  background: c.card, border: `1px solid ${c.cardBorder}`,
  borderRadius: 12, padding: 16, marginBottom: 12,
}

const btn = {
  padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600,
}

// Ícono por familia. La clave es el nombre que devuelve la BD sin el prefijo
// numérico (_familia_insumo / _familia_menu devuelven "NN·Nombre").
const ICONOS = {
  'Panes': '🍞', 'Carnicos': '🥩', 'Quesos y lacteos': '🧀',
  'Papas y congelados': '🍟', 'Vegetales': '🥬', 'Salsas y aderezos': '🥫',
  'Especias y abarrotes': '🧂', 'Bebidas': '🥤', 'Cafe y calientes': '☕',
  'Cervezas': '🍺', 'Postres': '🍰', 'Empaques y desechables': '📦',
  'Limpieza': '🧽', 'Merch y promos': '🎁', 'Mano de obra': '👷',
  'Platos sin receta': '⚠️', 'Otros': '🔹',
  'Hamburguesas': '🍔', 'Hot Dogs': '🌭', 'Papas y sides': '🍟',
  'Extras y agrandados': '➕', 'Combos mixtos': '🍱',
}

const CONTEO_ICONOS = {
  'Carnicos': '🥩', 'Harina Panes': '🍞', 'Queso Lacteos': '🧀',
  'Congelado Papas': '🍟', 'Vegetales': '🥬', 'Aderezos y Salsas': '🥫',
  'Especies': '🧂', 'Bebidas': '🥤', 'Nescafé': '☕', 'Extras': '➕',
  'Desechables y Empaques': '📦', 'Utensilios de Limpieza': '🧽',
}

const TABS = [
  { key: 'componentes', label: 'Componentes', icon: '🍔' },
  { key: 'conteo', label: 'Ingredientes (Conteo)', icon: '📋' },
  { key: 'bebidas', label: 'Bebidas y Cervezas', icon: '🥤' },
  { key: 'ventas', label: 'Ventas por producto', icon: '💵' },
]

const n = (v) => Number(v) || 0
const fmtUSD = (v) => '$' + n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtUSD0 = (v) => '$' + Math.round(n(v)).toLocaleString('en-US')
const fmtPct = (v) => n(v).toFixed(1) + '%'

// Las cantidades van de 9,753 hamburguesas a 0.02 kg de Nescafé: los enteros se
// muestran sin decimales y lo fraccionario con los que necesite.
function fmtQty(v) {
  const x = n(v)
  if (Math.abs(x - Math.round(x)) < 0.0005) return Math.round(x).toLocaleString('en-US')
  if (Math.abs(x) >= 10) return x.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return x.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

function partirFamilia(f) {
  const s = String(f || '99·Otros')
  const i = s.indexOf('·')
  return i < 0 ? { orden: '99', nombre: s } : { orden: s.slice(0, i), nombre: s.slice(i + 1) }
}

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const primerDiaMes = (iso) => iso.slice(0, 8) + '01'

function rangosRapidos() {
  const hoy = today()
  const mesPasadoFin = shiftDate(primerDiaMes(hoy), -1)
  return [
    { label: 'Hoy', desde: hoy, hasta: hoy },
    { label: 'Ayer', desde: shiftDate(hoy, -1), hasta: shiftDate(hoy, -1) },
    { label: '7 días', desde: shiftDate(hoy, -6), hasta: hoy },
    { label: '30 días', desde: shiftDate(hoy, -29), hasta: hoy },
    { label: 'Este mes', desde: primerDiaMes(hoy), hasta: hoy },
    { label: 'Mes pasado', desde: primerDiaMes(mesPasadoFin), hasta: mesPasadoFin },
    { label: 'Este año', desde: hoy.slice(0, 4) + '-01-01', hasta: hoy },
  ]
}

function diasEntre(desde, hasta) {
  const a = new Date(desde + 'T12:00:00'), b = new Date(hasta + 'T12:00:00')
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

// ── piezas de UI ──────────────────────────────────────────────────────────

function Kpi({ label, valor, sub, color, tip }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 0, flex: '1 1 150px', minWidth: 150 }}>
      <div style={{ fontSize: 11, color: c.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}{tip && <InfoTip text={tip} />}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || c.text, marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: c.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Barra({ pct, color }) {
  return (
    <div style={{ height: 5, background: '#262626', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: color, borderRadius: 3 }} />
    </div>
  )
}

/** Grupo colapsable: encabezado con totales + tabla de filas al abrir. */
function Grupo({ id, icono, titulo, unidadesTexto, dinero, pctDinero, color, abierto, onToggle, children }) {
  return (
    <div style={{ border: `1px solid ${c.cardBorder}`, borderRadius: 10, marginBottom: 8, background: c.card, overflow: 'hidden' }}>
      <button
        onClick={() => onToggle(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
          background: 'transparent', border: 'none', color: c.text, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 16, width: 22 }}>{icono}</span>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{titulo}</span>
        {unidadesTexto && <span style={{ fontSize: 12, color: c.textDim, whiteSpace: 'nowrap' }}>{unidadesTexto}</span>}
        <span style={{ width: 90, textAlign: 'right', fontWeight: 800, fontSize: 14, color }}>{fmtUSD(dinero)}</span>
        <span style={{ width: 46, textAlign: 'right', fontSize: 11, color: c.textDim }}>{fmtPct(pctDinero)}</span>
        <span style={{ fontSize: 11, color: c.textOff, width: 12 }}>{abierto ? '▾' : '▸'}</span>
      </button>
      <div style={{ padding: '0 14px 8px 14px' }}>
        <Barra pct={pctDinero} color={color} />
      </div>
      {abierto && <div style={{ borderTop: `1px solid ${c.cardBorder}` }}>{children}</div>}
    </div>
  )
}

const th = { padding: '7px 10px', fontWeight: 700, fontSize: 10, color: c.textDim, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3 }
const td = { padding: '6px 10px', whiteSpace: 'nowrap', fontSize: 12.5 }

// ── pantalla ──────────────────────────────────────────────────────────────

export default function ConsumoVentaDashboard() {
  const hoy = today()
  const [desde, setDesde] = useState(shiftDate(hoy, -6))
  const [hasta, setHasta] = useState(hoy)
  const [stores, setStores] = useState([])          // [] = todas
  const [tab, setTab] = useState('componentes')
  const [busqueda, setBusqueda] = useState('')
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [consumo, setConsumo] = useState(null)
  const [ventas, setVentas] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    const args = { p_desde: desde, p_hasta: hasta, p_stores: stores.length ? stores : null }
    const [rc, rv] = await Promise.all([
      db.rpc('fn_consumo_venta', args),
      db.rpc('fn_ventas_producto', args),
    ])
    if (rc.error || rv.error) {
      setError(rc.error?.message || rv.error?.message || 'No se pudo cargar')
      setConsumo([]); setVentas([])
    } else {
      setConsumo(rc.data || []); setVentas(rv.data || [])
    }
    setCargando(false)
  }, [desde, hasta, stores])

  useEffect(() => { cargar() }, [cargar])

  const toggleStore = (code) =>
    setStores(prev => prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code])

  const toggle = (id) =>
    setAbiertos(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const dias = diasEntre(desde, hasta)

  // ── totales ──
  const totalCosto = useMemo(() => (consumo || []).reduce((a, r) => a + n(r.costo_total), 0), [consumo])
  const totalVenta = useMemo(() => (ventas || []).reduce((a, r) => a + n(r.venta), 0), [ventas])
  const foodCost = totalVenta > 0 ? (totalCosto / totalVenta) * 100 : 0
  const sinCosto = useMemo(() => (consumo || []).filter(r => r.costo_origen === 'sin_costo'), [consumo])

  const filtra = useCallback((txt) => {
    const q = busqueda.trim().toLowerCase()
    return !q || String(txt || '').toLowerCase().includes(q)
  }, [busqueda])

  // ── agrupaciones por pestaña ──
  const gruposComponentes = useMemo(
    () => agrupar(consumo, r => r.familia, r => filtra(r.producto), 'costo_total'),
    [consumo, filtra])

  const gruposConteo = useMemo(
    () => agrupar(
      (consumo || []).filter(r => r.incluir_conteo),
      r => r.conteo_categoria || 'Sin categoría de conteo',
      r => filtra(r.producto), 'costo_total'),
    [consumo, filtra])

  const gruposBebidas = useMemo(
    () => agrupar(
      (consumo || []).filter(r => /^(45|55)·/.test(r.familia || '')),
      r => r.familia, r => filtra(r.producto), 'costo_total'),
    [consumo, filtra])

  const gruposVentas = useMemo(
    () => agrupar(ventas, r => r.familia, r => filtra(r.plato), 'venta'),
    [ventas, filtra])

  const exportar = () => {
    const suf = `${desde}_${hasta}`
    if (tab === 'ventas') {
      downloadCSV(`ventas_producto_${suf}.csv`, [
        ['Familia', 'Producto', 'Categoría menú', 'Unidades', 'Venta', 'Descuento', 'Costo unit.', 'Costo total', 'Margen'],
        ...(ventas || []).map(r => [
          partirFamilia(r.familia).nombre, r.plato, r.categoria_menu || '',
          n(r.unidades), n(r.venta), n(r.descuento), n(r.costo_unit), n(r.costo_total),
          (n(r.venta) - n(r.costo_total)).toFixed(2),
        ]),
      ])
      return
    }
    const filas = tab === 'conteo' ? (consumo || []).filter(r => r.incluir_conteo)
      : tab === 'bebidas' ? (consumo || []).filter(r => /^(45|55)·/.test(r.familia || ''))
      : (consumo || [])
    downloadCSV(`consumo_${tab}_${suf}.csv`, [
      ['Familia', 'Categoría conteo', 'Producto', 'Unidades', 'Unidad', 'Empaque', 'Equiv. empaques', 'Costo unit.', 'Costo total', 'Origen costo'],
      ...filas.map(r => [
        partirFamilia(r.familia).nombre, r.conteo_categoria || '', r.producto,
        n(r.unidades), r.unidad, r.empaque || '',
        n(r.empaque_factor) > 0 ? (n(r.unidades) / n(r.empaque_factor)).toFixed(2) : '',
        n(r.costo_unit), n(r.costo_total), r.costo_origen,
      ]),
    ])
  }

  return (
    <div style={{ padding: 16, color: c.text, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>🍔 Consumo por Venta</div>
        <div style={{ flex: 1 }} />
        <button onClick={exportar} style={{ ...btn, background: '#2a2a2a', color: c.text }}>⬇ CSV</button>
        <button onClick={cargar} style={{ ...btn, background: '#2a2a2a', color: c.text }}>↻</button>
      </div>
      <div style={{ fontSize: 12, color: c.textDim, marginBottom: 12 }}>
        Lo que las ventas del rango se llevaron del inventario, en unidades y en dinero al costo.
      </div>

      {/* Filtros */}
      <div style={{ ...cardStyle, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 11, color: c.textDim, fontWeight: 600 }}>
          Desde<br />
          <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)}
            style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, marginTop: 3 }} />
        </label>
        <label style={{ fontSize: 11, color: c.textDim, fontWeight: 600 }}>
          Hasta<br />
          <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)}
            style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, marginTop: 3 }} />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rangosRapidos().filter(r => r.label).map(r => {
            const activo = r.desde === desde && r.hasta === hasta
            return (
              <button key={r.label} onClick={() => { setDesde(r.desde); setHasta(r.hasta) }}
                style={{ ...btn, padding: '6px 10px', fontSize: 12, background: activo ? c.blue : '#262626', color: activo ? '#0a0a0a' : c.textDim }}>
                {r.label}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ ...cardStyle, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: c.textDim, fontWeight: 600, marginRight: 4 }}>SUCURSAL</span>
        <button onClick={() => setStores([])}
          style={{ ...btn, padding: '6px 10px', fontSize: 12, background: stores.length === 0 ? c.green : '#262626', color: stores.length === 0 ? '#0a0a0a' : c.textDim }}>
          Todas
        </button>
        {Object.entries(STORES_SHORT).map(([code, nombre]) => {
          const activo = stores.includes(code)
          return (
            <button key={code} onClick={() => toggleStore(code)}
              style={{ ...btn, padding: '6px 10px', fontSize: 12, background: activo ? c.green : '#262626', color: activo ? '#0a0a0a' : c.textDim }}>
              {nombre}
            </button>
          )
        })}
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Kpi label="Venta" valor={fmtUSD0(totalVenta)} sub={`${dias} día${dias > 1 ? 's' : ''} · ${fmtUSD0(totalVenta / dias)}/día`} color={c.green}
          tip="Suma de las líneas de cuentas cobradas, con IVA incluido y neto de descuentos. No incluye propina." />
        <Kpi label="Costo de consumo" valor={fmtUSD0(totalCosto)} sub={`${fmtUSD0(totalCosto / dias)}/día`} color={c.orange}
          tip="Lo que las ventas descontaron del inventario, valorado al costo de compra (o de receta, para lo que se fabrica en Casa Matriz)." />
        <Kpi label="Food cost" valor={fmtPct(foodCost)} color={foodCost > 40 ? c.red : foodCost > 33 ? c.yellow : c.green}
          tip="Costo de consumo ÷ venta. No incluye planilla, mermas de bodega ni producción no vendida." />
        <Kpi label="Margen bruto" valor={fmtUSD0(totalVenta - totalCosto)} sub={fmtPct(100 - foodCost)} color={c.cyan} />
        <Kpi label="Componentes" valor={(consumo || []).length} sub={`${(ventas || []).length} productos vendidos`} color={c.purple} />
      </div>

      {error && (
        <div style={{ ...cardStyle, borderColor: c.red, color: c.red, fontSize: 13 }}>⚠️ {error}</div>
      )}

      {sinCosto.length > 0 && (
        <div style={{ ...cardStyle, borderColor: c.yellow, fontSize: 12, color: c.yellow }}>
          ⚠️ {sinCosto.length} componente{sinCosto.length > 1 ? 's' : ''} sin costo cargado — sus unidades sí cuentan, su dinero va en $0:{' '}
          <span style={{ color: c.textDim }}>{sinCosto.slice(0, 6).map(r => r.producto).join(' · ')}{sinCosto.length > 6 ? ' …' : ''}</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ ...btn, background: tab === t.key ? c.blue : '#1a1a1a', color: tab === t.key ? '#0a0a0a' : c.textDim, border: `1px solid ${tab === t.key ? c.blue : c.cardBorder}` }}>
            {t.icon} {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar componente…"
          style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, minWidth: 180 }} />
      </div>

      {cargando && <div style={{ padding: 24, color: c.textDim }}>Cargando…</div>}

      {!cargando && tab === 'componentes' && (
        <ListaConsumo grupos={gruposComponentes} total={totalCosto} abiertos={abiertos} onToggle={toggle}
          etiqueta={f => partirFamilia(f).nombre} icono={f => ICONOS[partirFamilia(f).nombre] || '🔹'} dias={dias}
          vacio="Sin consumo en el rango." />
      )}

      {!cargando && tab === 'conteo' && (
        <>
          <div style={{ fontSize: 12, color: c.textDim, marginBottom: 8 }}>
            Solo los productos que están en la <b>lista de conteo nocturno</b>, agrupados por su categoría de conteo.
            Es lo que la sucursal cuenta cada noche, así que este consumo es el <b>teórico contra el que se compara el conteo</b>.
          </div>
          <ListaConsumo grupos={gruposConteo} total={sumaGrupos(gruposConteo)} abiertos={abiertos} onToggle={toggle}
            etiqueta={f => f} icono={f => CONTEO_ICONOS[f] || '📋'} dias={dias}
            vacio="Ningún producto de la lista de conteo se consumió en el rango." />
        </>
      )}

      {!cargando && tab === 'bebidas' && (
        <ListaConsumo grupos={gruposBebidas} total={sumaGrupos(gruposBebidas)} abiertos={abiertos} onToggle={toggle}
          etiqueta={f => partirFamilia(f).nombre} icono={f => ICONOS[partirFamilia(f).nombre] || '🥤'} dias={dias}
          vacio="Sin bebidas consumidas en el rango." />
      )}

      {!cargando && tab === 'ventas' && (
        <ListaVentas grupos={gruposVentas} total={totalVenta} abiertos={abiertos} onToggle={toggle} dias={dias} />
      )}

      <div style={{ fontSize: 11, color: c.textOff, marginTop: 16, lineHeight: 1.6 }}>
        El consumo sale del kardex que escribe el POS al cobrar, ya con los combos y los modificadores resueltos:
        un "Coca-Cola Combo" aparece acá como su pan de hot dog, su salchicha, su papa y su gaseosa.
        Por eso <b>Componentes</b> y <b>Ventas por producto</b> no se suman entre sí — son la misma venta vista por el
        lado del insumo y por el lado del precio.
      </div>
    </div>
  )
}

// ── helpers de agrupación ────────────────────────────────────────────────

function agrupar(filas, claveFn, filtroFn, campoDinero) {
  if (!filas) return []
  const mapa = new Map()
  for (const r of filas) {
    if (!filtroFn(r)) continue
    const k = claveFn(r) || '99·Otros'
    if (!mapa.has(k)) mapa.set(k, { clave: k, filas: [], dinero: 0, items: 0 })
    const g = mapa.get(k)
    g.filas.push(r); g.dinero += n(r[campoDinero]); g.items += 1
  }
  return [...mapa.values()]
    .map(g => ({ ...g, filas: g.filas.sort((a, b) => n(b[campoDinero]) - n(a[campoDinero])) }))
    .sort((a, b) => String(a.clave).localeCompare(String(b.clave)))
}

const sumaGrupos = (grupos) => grupos.reduce((a, g) => a + g.dinero, 0)

const colorFamilia = (i) => [c.green, c.blue, c.yellow, c.purple, c.cyan, c.orange, c.red][i % 7]

// ── tabla de consumo ─────────────────────────────────────────────────────

function ListaConsumo({ grupos, total, abiertos, onToggle, etiqueta, icono, dias, vacio }) {
  if (!grupos.length) return <div style={{ ...cardStyle, color: c.textDim, textAlign: 'center' }}>{vacio}</div>
  return (
    <div>
      {grupos.map((g, i) => (
        <Grupo
          key={g.clave} id={g.clave} icono={icono(g.clave)} titulo={etiqueta(g.clave)}
          unidadesTexto={`${g.items} componente${g.items > 1 ? 's' : ''}`}
          dinero={g.dinero} pctDinero={total > 0 ? (g.dinero / total) * 100 : 0}
          color={colorFamilia(i)} abierto={abiertos.has(g.clave)} onToggle={onToggle}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Componente</th>
                  <th style={{ ...th, textAlign: 'right' }}>Consumo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Por día</th>
                  <th style={{ ...th, textAlign: 'right' }}>Equiv. empaques</th>
                  <th style={{ ...th, textAlign: 'right' }}>Costo unit.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Costo total</th>
                </tr>
              </thead>
              <tbody>
                {g.filas.map(r => {
                  const factor = n(r.empaque_factor)
                  return (
                    <tr key={r.producto_id} style={{ borderTop: `1px solid #222` }}>
                      <td style={{ ...td, whiteSpace: 'normal', maxWidth: 340 }}>
                        {r.producto}
                        {r.costo_origen === 'sin_costo' && <span style={{ color: c.yellow, fontSize: 10, marginLeft: 6 }}>sin costo</span>}
                        {r.costo_origen === 'receta' && <span style={{ color: c.textOff, fontSize: 10, marginLeft: 6 }}>costo de receta</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {fmtQty(r.unidades)} <span style={{ color: c.textDim, fontWeight: 400 }}>{r.unidad}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: c.textDim }}>{fmtQty(n(r.unidades) / dias)}</td>
                      <td style={{ ...td, textAlign: 'right', color: c.textDim }}>
                        {factor > 1 ? `${fmtQty(n(r.unidades) / factor)} × ${r.empaque || 'empaque'}` : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: c.textDim }}>
                        {n(r.costo_unit) > 0 ? '$' + n(r.costo_unit).toFixed(4) : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtUSD(r.costo_total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Grupo>
      ))}
    </div>
  )
}

// ── tabla de ventas ──────────────────────────────────────────────────────

function ListaVentas({ grupos, total, abiertos, onToggle, dias }) {
  if (!grupos.length) return <div style={{ ...cardStyle, color: c.textDim, textAlign: 'center' }}>Sin ventas en el rango.</div>
  return (
    <div>
      <div style={{ fontSize: 12, color: c.textDim, marginBottom: 8 }}>
        Los combos <b>no se desglosan</b>: no tienen precio por componente y repartirlo sería inventar.
        Cada combo cae en la familia del pan que lleva su receta — por eso "Coca-Cola Combo" está en Hot Dogs.
      </div>
      {grupos.map((g, i) => {
        const nombre = partirFamilia(g.clave).nombre
        const unidades = g.filas.reduce((a, r) => a + n(r.unidades), 0)
        const costo = g.filas.reduce((a, r) => a + n(r.costo_total), 0)
        return (
          <Grupo
            key={g.clave} id={'v' + g.clave} icono={ICONOS[nombre] || '🔹'} titulo={nombre}
            unidadesTexto={`${fmtQty(unidades)} un · costo ${fmtUSD0(costo)}`}
            dinero={g.dinero} pctDinero={total > 0 ? (g.dinero / total) * 100 : 0}
            color={colorFamilia(i)} abierto={abiertos.has('v' + g.clave)} onToggle={onToggle}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>Producto</th>
                    <th style={{ ...th, textAlign: 'right' }}>Unidades</th>
                    <th style={{ ...th, textAlign: 'right' }}>Por día</th>
                    <th style={{ ...th, textAlign: 'right' }}>Venta</th>
                    <th style={{ ...th, textAlign: 'right' }}>Costo</th>
                    <th style={{ ...th, textAlign: 'right' }}>Margen</th>
                    <th style={{ ...th, textAlign: 'right' }}>Food cost</th>
                  </tr>
                </thead>
                <tbody>
                  {g.filas.map(r => {
                    const venta = n(r.venta), costoR = n(r.costo_total)
                    const fc = venta > 0 ? (costoR / venta) * 100 : null
                    return (
                      <tr key={r.plato} style={{ borderTop: '1px solid #222' }}>
                        <td style={{ ...td, whiteSpace: 'normal', maxWidth: 300 }}>
                          {r.plato}
                          {n(r.cortesias) > 0 && <span style={{ color: c.textOff, fontSize: 10, marginLeft: 6 }}>{fmtQty(r.cortesias)} cortesía</span>}
                          {costoR === 0 && <span style={{ color: c.yellow, fontSize: 10, marginLeft: 6 }}>sin costo de receta</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtQty(r.unidades)}</td>
                        <td style={{ ...td, textAlign: 'right', color: c.textDim }}>{fmtQty(n(r.unidades) / dias)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtUSD(venta)}</td>
                        <td style={{ ...td, textAlign: 'right', color: c.textDim }}>{costoR > 0 ? fmtUSD(costoR) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', color: c.green }}>{costoR > 0 ? fmtUSD(venta - costoR) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', color: fc == null ? c.textOff : fc > 40 ? c.red : fc > 33 ? c.yellow : c.textDim }}>
                          {fc == null ? '—' : fmtPct(fc)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Grupo>
        )
      })}
    </div>
  )
}
