import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { db } from '../../supabase'

// ─── Helpers ───────────────────────────────────────────────
const fmt = (n) => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const today = () => new Date().toISOString().slice(0, 10)
const fmtPct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—'

async function fetchAll(query, { pageSize = 1000 } = {}) {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

const ESTADO_COLOR = {
  sin_clasificar: { bg: '#7f1d1d', color: '#fca5a5', label: 'Sin clasificar' },
  auto_match: { bg: '#065f46', color: '#6ee7b7', label: 'Auto-match' },
  match_manual: { bg: '#1e40af', color: '#93c5fd', label: 'Manual' },
  movimiento_socio: { bg: '#5b21b6', color: '#c4b5fd', label: 'Socio' },
  comision_bancaria: { bg: '#92400e', color: '#fcd34d', label: 'Comisión' },
  transferencia_interna: { bg: '#374151', color: '#d1d5db', label: 'Interna' },
  sin_dte: { bg: '#9a3412', color: '#fdba74', label: 'Sin DTE' },
  ignorar: { bg: '#374151', color: '#9ca3af', label: 'Ignorar' },
}

const TABS = [
  { key: 'resumen', label: '📊 Resumen' },
  { key: 'wizard', label: '⚡ Wizard' },
  { key: 'comprobantes', label: '📷 Comprobantes' },
  { key: 'cola', label: '🔍 Cola Manual' },
  { key: 'vincular', label: '📎 Vincular DTE' },
  { key: 'socios', label: '👥 Socios' },
  { key: 'reglas', label: '⚙️ Reglas' },
  { key: 'auditoria', label: '📋 Auditoría' },
]

const TIPOS_MOV_SOCIO = [
  { val: 'aporte_capital', label: 'Aporte de capital', dir: 'I', clasif: 'capital_aportado' },
  { val: 'prestamo_socio', label: 'Préstamo del socio (con interés)', dir: 'I', clasif: 'capital_aportado' },
  { val: 'repago_capital', label: 'Repago de capital', dir: 'E', clasif: 'capital_repagado' },
  { val: 'pago_interes', label: 'Pago de interés acumulado', dir: 'E', clasif: 'interes_pagado' },
  { val: 'salario_socio', label: 'Salario del socio (gasto P&L)', dir: 'E', clasif: 'gasto_salario' },
  { val: 'manejo_efectivo', label: 'Manejo de efectivo (no afecta P&L)', dir: 'B', clasif: 'no_afecta_pl' },
  { val: 'dividendo', label: 'Dividendo (reparte utilidades)', dir: 'E', clasif: 'gasto_dividendo' },
  { val: 'otro', label: 'Otro (especificar en notas)', dir: 'B', clasif: 'no_afecta_pl' },
]

const ESTADOS_CLASIFICAR = [
  { val: 'auto_match', label: 'Auto-match' },
  { val: 'match_manual', label: 'Manual' },
  { val: 'movimiento_socio', label: 'Socio' },
  { val: 'comision_bancaria', label: 'Comisión bancaria' },
  { val: 'transferencia_interna', label: 'Transferencia interna' },
  { val: 'sin_dte', label: 'Sin DTE (gasto sin factura)' },
  { val: 'ignorar', label: 'Ignorar' },
]

// ─── OCR / ZIP lazy-load ───────────────────────────────────
let _tesseractLoaded = false, _jszipLoaded = false
async function loadTesseract() {
  if (_tesseractLoaded) return
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
      s.onload = resolve; s.onerror = reject
      document.head.appendChild(s)
    })
  }
  _tesseractLoaded = true
}
async function loadJSZip() {
  if (_jszipLoaded) return
  if (!window.JSZip) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
      s.onload = resolve; s.onerror = reject
      document.head.appendChild(s)
    })
  }
  _jszipLoaded = true
}

async function sha256File(file) {
  const buf = await file.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const MESES_MAP = {
  enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12',
  ene:'01',feb:'02',mar:'03',abr:'04',may:'05',jun:'06',jul:'07',ago:'08',sep:'09',oct:'10',nov:'11',dic:'12',
}

// Parser OCR enriquecido: monto, fecha, beneficiario, 4 dig, banco, referencia, concepto, cuenta_origen, nombre_emisor
function parseComprobante(text) {
  const out = {}
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Monto
  const montoMatch = text.match(/(?:monto|total|valor|debitado|pagado)[:\s]*\$?\s*([\d,]+\.\d{2})/i)
    || text.match(/\$\s*([\d,]+\.\d{2})/) || text.match(/USD\s*([\d,]+\.\d{2})/i)
  if (montoMatch) out.monto = parseFloat(montoMatch[1].replace(/,/g, ''))

  // Fecha
  const fT = text.match(/(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\.?\s*(?:de\s+)?(\d{4})?/i)
  if (fT) {
    const day = fT[1].padStart(2, '0'); const mon = MESES_MAP[fT[2].toLowerCase()] || '01'
    const year = fT[3] || new Date().getFullYear()
    out.fecha_extraida = `${year}-${mon}-${day}`
  } else {
    const fn = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (fn) { let y = fn[3]; if (y.length === 2) y = '20' + y; out.fecha_extraida = `${y}-${fn[2].padStart(2,'0')}-${fn[1].padStart(2,'0')}` }
  }

  // Beneficiario
  const idxBenef = lines.findIndex(l => /(?:beneficiario|a favor de|cuenta destino|destinatario|para)/i.test(l))
  if (idxBenef >= 0) {
    for (let i = idxBenef + 1; i < Math.min(idxBenef + 4, lines.length); i++) {
      const c = lines[i]
      if (c && !/^\d+$/.test(c.replace(/\s/g, '')) && c.length > 3 && /[A-Za-z]/.test(c)) {
        out.beneficiario = c.replace(/[^A-Za-zÀ-ÿ0-9\s.,&\-]/g, '').trim().slice(0, 100); break
      }
    }
  }

  // Emisor (origen)
  const idxEmi = lines.findIndex(l => /(?:de|origen|titular|cuenta origen|enviado por|remitente)/i.test(l))
  if (idxEmi >= 0 && idxEmi !== idxBenef) {
    for (let i = idxEmi + 1; i < Math.min(idxEmi + 3, lines.length); i++) {
      const c = lines[i]
      if (c && c.length > 3 && /[A-Za-z]/.test(c) && !/cuenta destino|beneficiario/i.test(c)) {
        out.nombre_emisor = c.replace(/[^A-Za-zÀ-ÿ0-9\s.,&\-]/g, '').trim().slice(0, 100); break
      }
    }
  }

  // Cuenta destino — últimos 4 dígitos
  const u4 = text.match(/(?:cuenta|cta|account)[\s\S]{0,40}?(?:\*+|x+|\.+|-+)\s*(\d{4})/i)
    || text.match(/(?:cuenta|cta)[\s\S]{0,40}?(\d{8,})/i)
  if (u4) {
    const raw = u4[1]
    out.ultimos_4_digitos = raw.length >= 4 ? raw.slice(-4) : raw.padStart(4, '0')
  }

  // Cuenta origen 4 dig
  const co = text.match(/(?:cuenta origen|cta origen|de la cuenta)[\s\S]{0,40}?(?:\*+|x+|\.+|-+)?\s*(\d{4,})/i)
  if (co) out.cuenta_origen = co[1].slice(-4)

  // Banco
  const bancos = ['BAC', 'Agricola', 'Agrícola', 'Davivienda', 'Promerica', 'Cuscatlan', 'Cuscatlán', 'Banco Industrial', 'Hipotecario', 'Atlantida', 'Atlántida']
  for (const b of bancos) { if (new RegExp(`\\b${b}\\b`, 'i').test(text)) { out.banco_origen = b; break } }

  // Referencia
  const ref = text.match(/(?:referencia|comprobante|n[uúº]?mero|trans?accion|operacion)[:\s#]*(\d{6,})/i) || text.match(/\b(\d{8,12})\b/)
  if (ref) out.numero_referencia = ref[1]

  // Concepto / memo
  const idxConcepto = lines.findIndex(l => /(?:concepto|motivo|raz[oó]n|descripci[oó]n|memo|comentario|detalle)/i.test(l))
  if (idxConcepto >= 0 && lines[idxConcepto + 1]) {
    out.concepto = lines[idxConcepto + 1].slice(0, 250)
  }

  return out
}

async function ocrComprobante(file) {
  await loadTesseract()
  const { data: { text } } = await window.Tesseract.recognize(file, 'spa', { logger: () => {} })
  return { text, parsed: parseComprobante(text) }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
export default function BancoView({ user }) {
  const [tab, setTab] = useState('resumen')
  const [notifs, setNotifs] = useState([])

  const canAccess = ['ejecutivo', 'superadmin'].includes(user?.rol)
  if (!canAccess) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}><div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div><div>Acceso restringido a ejecutivos</div></div>
  }

  const pushNotif = (msg) => setNotifs(ns => [...ns, { id: Date.now() + Math.random(), msg }])
  const dismissNotif = (id) => setNotifs(ns => ns.filter(n => n.id !== id))

  return (
    <div style={{ padding: '12px 16px', maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>🏦 BancoView — Conciliación Bancaria</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>BAC #201500451 USD · Auto-match conservador + Wizard manual + Aprendizaje</div>
      </div>

      {/* Notificaciones de aprendizaje */}
      {notifs.map(n => (
        <div key={n.id} style={{ background: '#1e3a8a', border: '1px solid #3b82f6', borderRadius: 8, padding: 10, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#bfdbfe' }}>🧠 <b>Aprendizaje:</b> {n.msg}</div>
          <button onClick={() => dismissNotif(n.id)} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '8px 14px', borderRadius: 8, border: tab === t.key ? '2px solid #60a5fa' : '1px solid #444',
              background: tab === t.key ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: tab === t.key ? '#60a5fa' : '#aaa', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <TabResumen />}
      {tab === 'wizard' && <TabWizard user={user} pushNotif={pushNotif} />}
      {tab === 'comprobantes' && <TabComprobantes user={user} />}
      {tab === 'cola' && <TabColaManual user={user} />}
      {tab === 'vincular' && <TabVincularDTE user={user} pushNotif={pushNotif} />}
      {tab === 'socios' && <TabSocios user={user} pushNotif={pushNotif} />}
      {tab === 'reglas' && <TabReglas />}
      {tab === 'auditoria' && <TabAuditoria />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB RESUMEN — KPIs + filtro centro costo
// ═══════════════════════════════════════════════════════════
function TabResumen() {
  const [data, setData] = useState({ porMes: [], topPendientes: [], totalKpis: null })
  const [loading, setLoading] = useState(true)
  const [centros, setCentros] = useState([])
  const [filtroCentro, setFiltroCentro] = useState('todos')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [txAll, cc] = await Promise.all([
        fetchAll(db.from('bank_transacciones').select('fecha,debito,credito,estado,codigo_bac,descripcion,id,centro_costo_id').order('fecha', { ascending: false })),
        db.from('centros_costo').select('*').eq('activo', true).order('orden'),
      ])
      setCentros(cc.data || [])

      const filtered = filtroCentro === 'todos' ? txAll
        : filtroCentro === 'sin_centro' ? txAll.filter(t => t.centro_costo_id == null)
        : txAll.filter(t => String(t.centro_costo_id) === filtroCentro)

      const mesMap = {}; let tF = 0, tC = 0, tM = 0, tMC = 0
      for (const t of filtered) {
        const mes = (t.fecha || '').slice(0, 7)
        if (!mesMap[mes]) mesMap[mes] = { mes, total: 0, clasif: 0, monto: 0, montoClasif: 0 }
        mesMap[mes].total++
        const m = (Number(t.debito) || 0) + (Number(t.credito) || 0)
        mesMap[mes].monto += m; tF++; tM += m
        if (t.estado !== 'sin_clasificar') { mesMap[mes].clasif++; mesMap[mes].montoClasif += m; tC++; tMC += m }
      }
      const porMes = Object.values(mesMap).sort((a, b) => b.mes.localeCompare(a.mes))
      const topPendientes = filtered.filter(t => t.estado === 'sin_clasificar')
        .map(t => ({ ...t, monto: (Number(t.debito) || 0) + (Number(t.credito) || 0) }))
        .sort((a, b) => b.monto - a.monto).slice(0, 10)
      setData({ porMes, topPendientes, totalKpis: { totalFilas: tF, totalClasif: tC, pctFilas: tF ? (tC * 100 / tF) : 0, totalMonto: tM, totalMontoClasif: tMC, pctMonto: tM ? (tMC * 100 / tM) : 0 } })
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [filtroCentro])

  useEffect(() => { load() }, [load])
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>
  const k = data.totalKpis || {}

  return (
    <>
      {/* Filtro centro de costo */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>🎯 Centro de costo:</div>
        <select value={filtroCentro} onChange={e => setFiltroCentro(e.target.value)} style={inputSt}>
          <option value="todos">Todos</option>
          <option value="sin_centro">Sin centro asignado</option>
          {centros.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.tipo})</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Cobertura filas" value={fmtPct(k.pctFilas)} sub={`${k.totalClasif} de ${k.totalFilas}`} color="#60a5fa" />
        <KpiCard label="Cobertura monto" value={fmtPct(k.pctMonto)} sub={`${fmt(k.totalMontoClasif)} de ${fmt(k.totalMonto)}`} color="#34d399" />
        <KpiCard label="Pendientes" value={(k.totalFilas - k.totalClasif).toString()} sub={fmt(k.totalMonto - k.totalMontoClasif)} color="#fb7185" />
      </div>

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Cobertura por mes</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #374151' }}>
            <th style={th}>Mes</th><th style={th}>Filas</th><th style={th}>% Filas</th><th style={th}>Monto</th><th style={th}>% Monto</th>
          </tr></thead>
          <tbody>{data.porMes.map(m => (
            <tr key={m.mes} style={{ borderBottom: '1px solid #2a3340' }}>
              <td style={td}>{m.mes}</td><td style={td}>{m.clasif}/{m.total}</td>
              <td style={{ ...td, color: m.clasif === m.total ? '#34d399' : (m.clasif / m.total > 0.7 ? '#fbbf24' : '#fb7185') }}>{fmtPct(m.total ? m.clasif * 100 / m.total : 0)}</td>
              <td style={td}>{fmt(m.montoClasif)} / {fmt(m.monto)}</td>
              <td style={td}>{fmtPct(m.monto ? m.montoClasif * 100 / m.monto : 0)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Top 10 sin clasificar (monto)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ borderBottom: '1px solid #374151' }}>
            <th style={th}>Fecha</th><th style={th}>Cód</th><th style={th}>Descripción</th><th style={{ ...th, textAlign: 'right' }}>Monto</th>
          </tr></thead>
          <tbody>{data.topPendientes.map(t => (
            <tr key={t.id} style={{ borderBottom: '1px solid #2a3340' }}>
              <td style={td}>{fmtDate(t.fecha)}</td><td style={td}><code style={codeSt}>{t.codigo_bac}</code></td>
              <td style={{ ...td, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.descripcion}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(t.monto)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB WIZARD — corazón del sistema (1 tx a la vez con sugerencias)
// ═══════════════════════════════════════════════════════════
function TabWizard({ user, pushNotif }) {
  const [pendientes, setPendientes] = useState([])
  const [idx, setIdx] = useState(0)
  const [sugerencias, setSugerencias] = useState([])
  const [comprobante, setComprobante] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showCrearGasto, setShowCrearGasto] = useState(false)
  const [filtros, setFiltros] = useState({ codigo: 'todos', mes: 'todos', direccion: 'todos' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAll(
        db.from('bank_transacciones').select('*').eq('estado', 'sin_clasificar')
          .order('debito', { ascending: false }).order('credito', { ascending: false })
      )
      setPendientes(data)
      setIdx(0)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const filtrados = useMemo(() => pendientes.filter(t =>
    (filtros.codigo === 'todos' || t.codigo_bac === filtros.codigo) &&
    (filtros.mes === 'todos' || (t.fecha || '').startsWith(filtros.mes)) &&
    (filtros.direccion === 'todos' || t.direccion === filtros.direccion)
  ), [pendientes, filtros])

  const actual = filtrados[idx]

  // Cargar sugerencias y comprobante para tx actual
  useEffect(() => {
    if (!actual) { setSugerencias([]); setComprobante(null); return }
    (async () => {
      try {
        const [sug, comp] = await Promise.all([
          db.from('v_bank_sugerencias').select('*').eq('bank_id', actual.id).order('confianza', { ascending: false }).limit(5),
          db.from('bank_comprobantes').select('*').eq('bank_transaccion_id', actual.id).maybeSingle(),
        ])
        setSugerencias(sug.data || [])
        setComprobante(comp.data)
      } catch (e) { console.error(e) }
    })()
  }, [actual?.id])

  const codigos = useMemo(() => ['todos', ...new Set(pendientes.map(t => t.codigo_bac).filter(Boolean))], [pendientes])
  const meses = useMemo(() => ['todos', ...new Set(pendientes.map(t => (t.fecha || '').slice(0, 7)))].sort().reverse(), [pendientes])

  const next = () => setIdx(i => Math.min(i + 1, filtrados.length - 1))
  const prev = () => setIdx(i => Math.max(i - 1, 0))

  const aplicarSugerencia = async (sug) => {
    if (!actual) return
    setSaving(true)
    try {
      // 1. Insertar bank_match
      await db.from('bank_match').insert({
        bank_transaccion_id: actual.id,
        target_tabla: sug.target_tabla,
        target_id: null, // target_id es INT en bank_match pero sug.target_id es TEXT (UUID)
        monto_aplicado: actual.debito || actual.credito,
        confianza: 1.00,
        metodo: 'wizard_manual',
        created_by: user?.nombre || 'wizard',
      })
      // 2. Update bank_transaccion → match_manual
      await db.from('bank_transacciones').update({
        estado: 'match_manual',
        notas: (actual.notas || '') + ` [wizard:${sug.target_tabla}/${sug.target_id}]`,
      }).eq('id', actual.id)
      // 3. Aprendizaje
      const { data: aprData } = await db.rpc('bancoview_aprender_match', {
        p_bank_transaccion_id: actual.id,
        p_target_tabla: sug.target_tabla,
        p_target_id: sug.target_id,
        p_proveedor_nombre: sug.sugerencia_label,
        p_categoria_gasto_id: null,
        p_centro_costo_id: null,
      })
      if (aprData && aprData[0]?.notificaciones?.length > 0) {
        for (const n of aprData[0].notificaciones) pushNotif(n)
      }
      // Quitar de la lista local + avanzar
      setPendientes(ps => ps.filter(p => p.id !== actual.id))
      setIdx(i => Math.min(i, filtrados.length - 2))
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
  }

  const marcarComo = async (estado) => {
    if (!actual) return
    setSaving(true)
    try {
      await db.from('bank_transacciones').update({
        estado,
        notas: (actual.notas || '') + ` [wizard:${estado}:${user?.rol || 'user'}]`,
      }).eq('id', actual.id)
      setPendientes(ps => ps.filter(p => p.id !== actual.id))
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
  }

  const onGastoCreado = async (gastoId) => {
    setShowCrearGasto(false)
    // El modal ya creó compras_sin_dte con bank_transaccion_id vinculado.
    // Aquí marcamos la transacción.
    if (!actual) return
    try {
      await db.from('bank_match').insert({
        bank_transaccion_id: actual.id, target_tabla: 'sin_dte_clasificacion',
        target_id: null, monto_aplicado: actual.debito || actual.credito,
        confianza: 1.00, metodo: 'wizard_crear_gasto', created_by: user?.nombre || 'wizard',
      })
      await db.from('bank_transacciones').update({ estado: 'sin_dte', notas: (actual.notas || '') + ' [wizard:gasto_creado]' }).eq('id', actual.id)
      setPendientes(ps => ps.filter(p => p.id !== actual.id))
    } catch (e) { console.error(e) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>
  if (filtrados.length === 0) return (
    <div style={{ background: '#064e3b', borderRadius: 8, padding: 40, textAlign: 'center', color: '#6ee7b7' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>¡Todo conciliado!</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>No hay transacciones sin clasificar con esos filtros.</div>
    </div>
  )

  return (
    <>
      {/* Filtros */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={labelSt}>Mes</div><select value={filtros.mes} onChange={e => { setFiltros({ ...filtros, mes: e.target.value }); setIdx(0) }} style={inputSt}>
          {meses.map(m => <option key={m} value={m}>{m === 'todos' ? 'Todos' : m}</option>)}
        </select></div>
        <div><div style={labelSt}>Código</div><select value={filtros.codigo} onChange={e => { setFiltros({ ...filtros, codigo: e.target.value }); setIdx(0) }} style={inputSt}>
          {codigos.map(c => <option key={c} value={c}>{c === 'todos' ? 'Todos' : c}</option>)}
        </select></div>
        <div><div style={labelSt}>Dirección</div><select value={filtros.direccion} onChange={e => { setFiltros({ ...filtros, direccion: e.target.value }); setIdx(0) }} style={inputSt}>
          <option value="todos">Todas</option><option value="D">Débitos</option><option value="C">Créditos</option>
        </select></div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#aaa' }}>
          {idx + 1} / {filtrados.length} pendientes
        </div>
      </div>

      {/* Card transacción + comprobante */}
      <div style={{ background: '#1f2937', borderRadius: 12, padding: 16, marginBottom: 12, border: '2px solid #60a5fa' }}>
        <div style={{ display: 'grid', gridTemplateColumns: comprobante ? '1fr 220px' : '1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{fmtDate(actual.fecha)} · <code style={codeSt}>{actual.codigo_bac}</code> · ref {actual.referencia}</div>
            <div style={{ fontSize: 16, color: '#fff', marginBottom: 6, fontWeight: 700 }}>{actual.descripcion}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: actual.direccion === 'D' ? '#fb7185' : '#34d399' }}>
              {actual.direccion === 'D' ? '−' : '+'}{fmt(actual.debito || actual.credito)}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Saldo después: {fmt(actual.balance)}</div>
          </div>
          {comprobante && (
            <div style={{ borderLeft: '1px solid #374151', paddingLeft: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>📷 Comprobante OCR vinculado</div>
              <a href={comprobante.foto_url} target="_blank" rel="noreferrer">
                <img src={comprobante.foto_url} alt="comp" style={{ width: '100%', maxWidth: 180, borderRadius: 6, border: '1px solid #374151' }} />
              </a>
              <div style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>
                {comprobante.beneficiario && <div><b>A:</b> {comprobante.beneficiario}</div>}
                {comprobante.banco_origen && <div><b>Banco:</b> {comprobante.banco_origen}</div>}
                {comprobante.concepto && <div><b>Concepto:</b> {comprobante.concepto}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sugerencias */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 8 }}>💡 Sugerencias rankeadas ({sugerencias.length})</div>
        {sugerencias.length === 0 ? (
          <div style={{ fontSize: 12, color: '#888', padding: 12, textAlign: 'center' }}>
            Sin sugerencias automáticas. Crea gasto sin DTE o marca como otro tipo abajo.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {sugerencias.map(s => (
              <div key={`${s.target_tabla}-${s.target_id}`} style={{
                padding: 10, borderRadius: 6, background: '#0f172a', border: '1px solid #2a3340',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sugerencia_label}</div>
                  <div style={{ fontSize: 10, color: '#888' }}>{s.target_tabla} · {fmtDate(s.sugerencia_fecha)} · diff {s.dias_diff}d</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{fmt(s.sugerencia_monto)}</div>
                  <div style={{ fontSize: 10, color: s.confianza >= 0.85 ? '#34d399' : s.confianza >= 0.6 ? '#fbbf24' : '#fb7185' }}>
                    {(s.confianza * 100).toFixed(0)}% confianza
                  </div>
                </div>
                <button onClick={() => aplicarSugerencia(s)} disabled={saving} style={{ ...btnSt, background: 'rgba(52,211,153,0.2)', border: '1px solid #34d399', color: '#6ee7b7', whiteSpace: 'nowrap' }}>
                  ✅ Match
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Multi-DTE: pagar varias facturas con un solo pago */}
      <MultiDteSelector bankTx={actual} user={user} pushNotif={pushNotif}
        onApplied={() => { setPendientes(ps => ps.filter(p => p.id !== actual.id)); setIdx(i => Math.min(i, filtrados.length - 2)) }} />

      {/* Acciones alternativas */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 8 }}>🛠 Otras acciones</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowCrearGasto(true)} disabled={saving} style={{ ...btnSt, background: 'rgba(251,191,36,0.15)', border: '1px solid #fbbf24', color: '#fbbf24' }}>🆕 Crear gasto sin DTE</button>
          <button onClick={() => marcarComo('movimiento_socio')} disabled={saving} style={{ ...btnSt, background: 'rgba(196,181,253,0.15)', border: '1px solid #c4b5fd', color: '#c4b5fd' }}>👤 Movimiento socio</button>
          <button onClick={() => marcarComo('comision_bancaria')} disabled={saving} style={{ ...btnSt, background: 'rgba(252,211,77,0.15)', border: '1px solid #fcd34d', color: '#fcd34d' }}>🏦 Comisión bancaria</button>
          <button onClick={() => marcarComo('transferencia_interna')} disabled={saving} style={{ ...btnSt, background: 'rgba(209,213,219,0.15)', border: '1px solid #d1d5db', color: '#d1d5db' }}>🔄 Trans. interna</button>
          <button onClick={() => marcarComo('ignorar')} disabled={saving} style={{ ...btnSt, background: 'rgba(156,163,175,0.15)', border: '1px solid #9ca3af', color: '#9ca3af' }}>🗑 Ignorar</button>
        </div>
      </div>

      {/* Navegación */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <button onClick={prev} disabled={idx === 0} style={{ ...btnSt, opacity: idx === 0 ? 0.4 : 1 }}>← Anterior</button>
        <button onClick={next} disabled={idx >= filtrados.length - 1} style={{ ...btnSt, opacity: idx >= filtrados.length - 1 ? 0.4 : 1 }}>⏭️ Saltar →</button>
      </div>

      {showCrearGasto && (
        <ModalCrearGasto bankTx={actual} comprobante={comprobante} user={user} onClose={() => setShowCrearGasto(false)} onCreated={onGastoCreado} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// MODAL CREAR GASTO SIN DTE — con autocomplete proveedor + crear nuevo + centro costo
// ═══════════════════════════════════════════════════════════
function ModalCrearGasto({ bankTx, comprobante, user, onClose, onCreated }) {
  const [proveedores, setProveedores] = useState([])
  const [centros, setCentros] = useState([])
  const [categorias, setCategorias] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showNuevoProv, setShowNuevoProv] = useState(false)

  const [form, setForm] = useState({
    proveedor_nombre: comprobante?.beneficiario || '',
    proveedor_nit: '',
    monto_total: bankTx?.debito || bankTx?.credito || 0,
    fecha: bankTx?.fecha || today(),
    descripcion: comprobante?.concepto || bankTx?.descripcion || '',
    forma_pago: 'transferencia',
    categoria_gasto_id: '',
    centro_costo_id: '',
    sucursal_id: '',
    notas: '',
  })

  // Form nuevo proveedor
  const [nuevoProv, setNuevoProv] = useState({ nombre_dte: '', categoria: '', subcategoria: '', sucursal_default: '' })

  // Subcategorías agrupadas por categoría (desde catalogo_contable existente) — evita duplicados tipo "bebidas" vs "Bebidas"
  const subcatsPorCategoria = useMemo(() => {
    const map = {}
    for (const p of proveedores) {
      if (!p.categoria || !p.subcategoria) continue
      if (!map[p.categoria]) map[p.categoria] = new Set()
      map[p.categoria].add(p.subcategoria.trim())
    }
    const result = {}
    for (const [cat, set] of Object.entries(map)) {
      result[cat] = [...set].sort((a, b) => a.localeCompare(b))
    }
    return result
  }, [proveedores])

  useEffect(() => {
    (async () => {
      try {
        const [provs, ccs, cats, sucs] = await Promise.all([
          db.from('catalogo_contable').select('id,nombre_dte,categoria,subcategoria,sucursal_default').eq('activo', true).order('nombre_dte'),
          db.from('centros_costo').select('*').eq('activo', true).order('orden'),
          db.from('categorias_gasto').select('id,nombre').order('id'),
          db.from('sucursales').select('id,store_code,nombre').order('store_code'),
        ])
        setProveedores(provs.data || [])
        setCentros(ccs.data || [])
        setCategorias(cats.data || [])
        setSucursales(sucs.data || [])
      } catch (e) { console.error(e) } finally { setLoading(false) }
    })()
  }, [])

  const onSelectProv = (nombre) => {
    const p = proveedores.find(p => p.nombre_dte === nombre)
    setForm(f => ({
      ...f, proveedor_nombre: nombre,
      categoria_gasto_id: p?.categoria || f.categoria_gasto_id,
    }))
  }

  const crearProveedor = async () => {
    if (!nuevoProv.nombre_dte.trim()) return alert('Nombre obligatorio')
    try {
      const { data, error } = await db.from('catalogo_contable').insert({
        nombre_dte: nuevoProv.nombre_dte.trim(),
        nombre_normalizado: nuevoProv.nombre_dte.trim().toUpperCase(),
        categoria: nuevoProv.categoria || null,
        subcategoria: nuevoProv.subcategoria || null,
        sucursal_default: nuevoProv.sucursal_default || null,
        requiere_recepcion: false,
        activo: true,
      }).select().single()
      if (error) throw error
      setProveedores(ps => [...ps, data].sort((a, b) => a.nombre_dte.localeCompare(b.nombre_dte)))
      setForm(f => ({ ...f, proveedor_nombre: data.nombre_dte, categoria_gasto_id: data.categoria || f.categoria_gasto_id }))
      setShowNuevoProv(false)
      setNuevoProv({ nombre_dte: '', categoria: '', subcategoria: '', sucursal_default: '' })
    } catch (e) { alert('Error creando proveedor: ' + e.message) }
  }

  const guardar = async () => {
    if (!form.proveedor_nombre || !form.monto_total || !form.fecha) return alert('Completa proveedor, monto y fecha')
    setSaving(true)
    try {
      const { data, error } = await db.from('compras_sin_dte').insert({
        fecha: form.fecha,
        proveedor_nombre: form.proveedor_nombre,
        proveedor_nit: form.proveedor_nit || null,
        monto_total: parseFloat(form.monto_total),
        descripcion: form.descripcion,
        forma_pago: form.forma_pago,
        categoria_gasto_id: form.categoria_gasto_id || null,
        centro_costo_id: form.centro_costo_id ? parseInt(form.centro_costo_id) : null,
        sucursal_id: form.sucursal_id || null,
        bank_transaccion_id: bankTx?.id || null,
        bank_comprobante_id: comprobante?.id || null,
        foto_url: comprobante?.foto_url || null,
        conciliado: true,
        tipo: 'gasto_sin_dte',
        notas: form.notas,
      }).select().single()
      if (error) throw error
      onCreated?.(data.id)
    } catch (e) { alert('Error guardando gasto: ' + e.message) } finally { setSaving(false) }
  }

  if (loading) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: '#1f2937', borderRadius: 12, padding: 20, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>🆕 Crear Gasto sin DTE</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 24, cursor: 'pointer' }}>×</button>
        </div>

        {/* Proveedor */}
        <div style={{ marginBottom: 12 }}>
          <div style={labelSt}>Proveedor *</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input list="provs-list" value={form.proveedor_nombre} onChange={e => onSelectProv(e.target.value)} placeholder="Buscar o crear…" style={{ ...inputSt, flex: 1 }} />
            <button onClick={() => setShowNuevoProv(true)} style={{ ...btnSt, padding: '6px 10px', fontSize: 11 }}>+ Nuevo</button>
          </div>
          <datalist id="provs-list">{proveedores.map(p => <option key={p.id} value={p.nombre_dte} />)}</datalist>
        </div>

        {showNuevoProv && (
          <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 12, border: '1px solid #fbbf24' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>+ Nuevo proveedor</div>
            <div style={{ display: 'grid', gap: 6 }}>
              <input value={nuevoProv.nombre_dte} onChange={e => setNuevoProv({ ...nuevoProv, nombre_dte: e.target.value })} placeholder="Nombre completo" style={inputSt} />
              <select value={nuevoProv.categoria} onChange={e => setNuevoProv({ ...nuevoProv, categoria: e.target.value })} style={inputSt}>
                <option value="">— Categoría P&L —</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <input
                list="subcats-list"
                value={nuevoProv.subcategoria}
                onChange={e => setNuevoProv({ ...nuevoProv, subcategoria: e.target.value })}
                placeholder={nuevoProv.categoria ? `Subcategoría (existentes para ${nuevoProv.categoria}: ${(subcatsPorCategoria[nuevoProv.categoria] || []).length})` : 'Subcategoría (opcional)'}
                style={inputSt}
              />
              <datalist id="subcats-list">
                {(subcatsPorCategoria[nuevoProv.categoria] || []).map(s => <option key={s} value={s} />)}
              </datalist>
              {nuevoProv.subcategoria && nuevoProv.categoria && (() => {
                const existentes = subcatsPorCategoria[nuevoProv.categoria] || []
                const exact = existentes.find(s => s.toLowerCase() === nuevoProv.subcategoria.toLowerCase().trim())
                const similar = existentes.find(s => s.toLowerCase().includes(nuevoProv.subcategoria.toLowerCase().trim()) || nuevoProv.subcategoria.toLowerCase().trim().includes(s.toLowerCase()))
                if (exact && exact !== nuevoProv.subcategoria) return (
                  <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 4, padding: '4px 8px', background: 'rgba(251,191,36,0.1)', borderRadius: 4 }}>
                    ⚠️ Existe ya como <b>"{exact}"</b> (mismo texto, distinta capitalización). <button type="button" onClick={() => setNuevoProv({ ...nuevoProv, subcategoria: exact })} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline', fontSize: 10 }}>Usar la existente</button>
                  </div>
                )
                if (similar && similar !== nuevoProv.subcategoria) return (
                  <div style={{ fontSize: 10, color: '#a7f3d0', marginTop: 4, padding: '4px 8px', background: 'rgba(52,211,153,0.08)', borderRadius: 4 }}>
                    💡 Hay una similar: <b>"{similar}"</b>. <button type="button" onClick={() => setNuevoProv({ ...nuevoProv, subcategoria: similar })} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline', fontSize: 10 }}>Usar esa</button>
                  </div>
                )
                if (!existentes.some(s => s.toLowerCase() === nuevoProv.subcategoria.toLowerCase().trim())) return (
                  <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>✨ Nueva subcategoría (no existía antes)</div>
                )
                return null
              })()}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={crearProveedor} style={btnSt}>Guardar proveedor</button>
                <button onClick={() => setShowNuevoProv(false)} style={{ ...btnSt, background: 'transparent', border: '1px solid #374151', color: '#aaa' }}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div><div style={labelSt}>Monto *</div><input type="number" step="0.01" value={form.monto_total} onChange={e => setForm({ ...form, monto_total: e.target.value })} style={inputSt} /></div>
          <div><div style={labelSt}>Fecha *</div><input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} style={inputSt} /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div><div style={labelSt}>Categoría P&L</div>
            <select value={form.categoria_gasto_id} onChange={e => setForm({ ...form, categoria_gasto_id: e.target.value })} style={inputSt}>
              <option value="">— Selecciona —</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div><div style={labelSt}>Centro de costo</div>
            <select value={form.centro_costo_id} onChange={e => setForm({ ...form, centro_costo_id: e.target.value })} style={inputSt}>
              <option value="">— Default sucursal —</option>
              {centros.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.tipo})</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelSt}>Sucursal</div>
          <select value={form.sucursal_id} onChange={e => setForm({ ...form, sucursal_id: e.target.value })} style={inputSt}>
            <option value="">— Sin sucursal —</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.store_code} {s.nombre}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelSt}>Descripción / concepto</div>
          <textarea rows={2} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelSt}>NIT proveedor (opcional)</div>
          <input value={form.proveedor_nit} onChange={e => setForm({ ...form, proveedor_nit: e.target.value })} style={inputSt} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ ...btnSt, background: 'transparent', border: '1px solid #374151', color: '#aaa' }}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{ ...btnSt, background: 'rgba(52,211,153,0.2)', border: '1px solid #34d399', color: '#6ee7b7' }}>{saving ? '⏳' : '💾 Guardar gasto'}</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MULTI-DTE SELECTOR — pagar varias facturas con un solo pago bancario
// ═══════════════════════════════════════════════════════════
function MultiDteSelector({ bankTx, user, pushNotif, onApplied }) {
  const [proveedoresPend, setProveedoresPend] = useState([])
  const [provFiltro, setProvFiltro] = useState('')
  const [provSeleccionado, setProvSeleccionado] = useState(null)
  const [facturas, setFacturas] = useState([])
  const [seleccionadas, setSeleccionadas] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [incluirPagadas, setIncluirPagadas] = useState(false)

  const target = bankTx?.debito || bankTx?.credito || 0

  // Cargar proveedores: agrupar desde v_compras_dte_para_match con filtro segun incluirPagadas
  useEffect(() => {
    if (!expanded) return
    (async () => {
      setLoading(true)
      try {
        let q = db.from('v_compras_dte_para_match').select('proveedor_nombre, monto_para_match, ya_pagada')
        if (!incluirPagadas) q = q.eq('ya_pagada', false)
        const data = await fetchAll(q)
        const byProv = {}
        for (const f of data) {
          if (!byProv[f.proveedor_nombre]) byProv[f.proveedor_nombre] = { nombre: f.proveedor_nombre, count: 0, total: 0, count_pagadas: 0 }
          byProv[f.proveedor_nombre].count++
          byProv[f.proveedor_nombre].total += Number(f.monto_para_match) || 0
          if (f.ya_pagada) byProv[f.proveedor_nombre].count_pagadas++
        }
        setProveedoresPend(Object.values(byProv).sort((a, b) => b.total - a.total))
      } catch (e) { console.error(e) } finally { setLoading(false) }
    })()
  }, [expanded, incluirPagadas])

  // Cargar facturas del proveedor seleccionado
  useEffect(() => {
    if (!provSeleccionado) { setFacturas([]); setSeleccionadas(new Set()); return }
    (async () => {
      setLoading(true)
      try {
        let q = db.from('v_compras_dte_para_match').select('*').eq('proveedor_nombre', provSeleccionado)
        if (!incluirPagadas) q = q.eq('ya_pagada', false)
        const { data } = await q.order('fecha', { ascending: false })
        setFacturas(data || [])
        // Auto-sugerir: combinacion que sume al target
        const list = data || []
        let acum = 0
        const auto = new Set()
        for (const f of list) {
          const monto = Number(f.monto_para_match) || 0
          if (acum + monto <= target + 0.01) {
            auto.add(f.id); acum += monto
            if (Math.abs(acum - target) < 0.01) break
          }
        }
        if (Math.abs(acum - target) < 0.01 && auto.size > 0) setSeleccionadas(auto)
        else setSeleccionadas(new Set())
      } catch (e) { console.error(e) } finally { setLoading(false) }
    })()
  }, [provSeleccionado, target, incluirPagadas])

  const provFiltrados = provFiltro
    ? proveedoresPend.filter(p => p.nombre.toLowerCase().includes(provFiltro.toLowerCase()))
    : proveedoresPend.slice(0, 8)

  const seleccionadasArr = facturas.filter(f => seleccionadas.has(f.id))
  const sumaSeleccionada = seleccionadasArr.reduce((s, f) => s + Number(f.monto_para_match), 0)
  const restante = target - sumaSeleccionada
  const cuadra = Math.abs(restante) < 0.01

  const toggleFactura = (id) => {
    const ns = new Set(seleccionadas); if (ns.has(id)) ns.delete(id); else ns.add(id); setSeleccionadas(ns)
  }

  const aplicar = async () => {
    if (seleccionadas.size === 0) return alert('Selecciona al menos 1 factura')
    if (!cuadra && !confirm(`La suma seleccionada (${fmt(sumaSeleccionada)}) no cuadra con el monto del banco (${fmt(target)}). ¿Continuar de todos modos?`)) return
    setSaving(true)
    try {
      const matches = seleccionadasArr.map(f => ({
        target_tabla: 'compras_dte',
        target_id: f.id,
        monto_aplicado: Number(f.monto_para_match),
        proveedor_nombre: f.proveedor_nombre,
      }))
      const { data, error } = await db.rpc('bancoview_aplicar_match_multiple', {
        p_bank_transaccion_id: bankTx.id,
        p_matches: matches,
        p_created_by: user?.nombre || 'wizard',
      })
      if (error) throw error
      const result = data?.[0]
      if (result?.notificaciones?.length) for (const n of result.notificaciones) pushNotif(n)
      alert(`✅ ${result?.matches_creados || matches.length} facturas vinculadas (${fmt(result?.monto_aplicado_total || sumaSeleccionada)})`)
      onApplied?.()
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
  }

  if (!expanded) {
    return (
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <button onClick={() => setExpanded(true)} style={{ ...btnSt, width: '100%', background: 'rgba(168,85,247,0.15)', border: '1px solid #a855f7', color: '#c4b5fd' }}>
          💼 Pagar múltiples facturas (multi-DTE) ▾
        </button>
      </div>
    )
  }

  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #a855f7' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#c4b5fd' }}>💼 Pagar múltiples facturas a un proveedor</div>
        <button onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      {/* Toggle incluir pagadas — útil para entrenar el sistema con DTEs marcados como pagados pre-conciliación */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: 8, background: '#0f172a', borderRadius: 6 }}>
        <input type="checkbox" id="inc-pagadas" checked={incluirPagadas} onChange={e => { setIncluirPagadas(e.target.checked); setProvSeleccionado(null); setSeleccionadas(new Set()) }} />
        <label htmlFor="inc-pagadas" style={{ fontSize: 11, color: '#aaa', cursor: 'pointer' }}>
          📂 <b>Incluir DTEs marcadas como pagadas</b> (útil para vincular pagos antiguos sin conciliar y entrenar el sistema)
        </label>
      </div>

      {!provSeleccionado && (
        <>
          <input value={provFiltro} onChange={e => setProvFiltro(e.target.value)} placeholder="🔍 Buscar proveedor con facturas pendientes…" style={{ ...inputSt, width: '100%', marginBottom: 10 }} />
          {loading ? <div style={{ color: '#888', textAlign: 'center', padding: 16 }}>Cargando…</div> : (
            <div style={{ display: 'grid', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
              {provFiltrados.map(p => (
                <button key={p.nombre} onClick={() => setProvSeleccionado(p.nombre)}
                  style={{ padding: '8px 10px', background: '#0f172a', border: '1px solid #2a3340', borderRadius: 6, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.nombre}</span>
                  <span style={{ color: '#a7f3d0' }}>
                    {p.count} fact{p.count_pagadas > 0 && incluirPagadas ? ` (${p.count_pagadas} pag)` : ''} · {fmt(p.total)}
                  </span>
                </button>
              ))}
              {provFiltrados.length === 0 && <div style={{ color: '#888', fontSize: 11, padding: 8 }}>Sin proveedores que coincidan</div>}
            </div>
          )}
        </>
      )}

      {provSeleccionado && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#fff', fontWeight: 700 }}>{provSeleccionado}</div>
            <button onClick={() => { setProvSeleccionado(null); setSeleccionadas(new Set()) }} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11 }}>← cambiar</button>
          </div>

          {/* Tracker */}
          <div style={{
            padding: 10, borderRadius: 6, marginBottom: 10,
            background: cuadra ? '#064e3b' : restante < 0 ? '#7f1d1d' : '#92400e',
            border: `1px solid ${cuadra ? '#34d399' : restante < 0 ? '#fb7185' : '#fbbf24'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <div>Pago banco: <b style={{ color: '#fff' }}>{fmt(target)}</b></div>
              <div>Seleccionado: <b style={{ color: '#fff' }}>{fmt(sumaSeleccionada)}</b> ({seleccionadas.size})</div>
              <div>{cuadra ? '✅ Cuadra' : restante < 0 ? '⚠️ Excedido' : '⏳ Restan'} <b style={{ color: '#fff' }}>{fmt(Math.abs(restante))}</b></div>
            </div>
          </div>

          {/* Lista facturas */}
          {loading ? <div style={{ color: '#888', textAlign: 'center', padding: 16 }}>Cargando…</div> : (
            <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ borderBottom: '1px solid #374151', position: 'sticky', top: 0, background: '#1f2937' }}>
                  <th style={{ ...th, width: 30 }}></th>
                  <th style={th}>Fecha</th><th style={th}>N° DTE</th>
                  <th style={th}>Estado</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total</th>
                  <th style={{ ...th, textAlign: 'right' }}>Para match</th>
                  <th style={th}>Vence</th>
                </tr></thead>
                <tbody>{facturas.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #2a3340', cursor: 'pointer', background: seleccionadas.has(f.id) ? 'rgba(168,85,247,0.1)' : (f.ya_pagada ? 'rgba(52,211,153,0.04)' : 'transparent'), opacity: f.ya_pagada ? 0.85 : 1 }} onClick={() => toggleFactura(f.id)}>
                    <td style={td}><input type="checkbox" checked={seleccionadas.has(f.id)} onChange={() => toggleFactura(f.id)} onClick={e => e.stopPropagation()} /></td>
                    <td style={td}>{fmtDate(f.fecha)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 10 }}>{f.numero_control || f.id.slice(0, 8)}</td>
                    <td style={td}>
                      {f.ya_pagada ? (
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#065f46', color: '#6ee7b7', fontWeight: 700 }}>✓ pagada</span>
                      ) : (
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#92400e', color: '#fcd34d', fontWeight: 700 }}>pendiente</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt(f.monto_total)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: f.ya_pagada ? '#6ee7b7' : '#fbbf24' }}>{fmt(f.monto_para_match)}</td>
                    <td style={td}>{f.fecha_vencimiento ? fmtDate(f.fecha_vencimiento) : '—'}{f.dias_para_vencer != null && f.dias_para_vencer < 0 && !f.ya_pagada && <span style={{ color: '#fb7185' }}> ⚠️</span>}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}

          <button onClick={aplicar} disabled={saving || seleccionadas.size === 0}
            style={{ ...btnSt, width: '100%', background: cuadra ? 'rgba(52,211,153,0.2)' : 'rgba(168,85,247,0.2)', border: `1px solid ${cuadra ? '#34d399' : '#a855f7'}`, color: cuadra ? '#6ee7b7' : '#c4b5fd' }}>
            {saving ? '⏳ Aplicando…' : `✅ Vincular ${seleccionadas.size} facturas (${fmt(sumaSeleccionada)})`}
          </button>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB COMPROBANTES — multi-upload + ZIP + cámara + galería
// ═══════════════════════════════════════════════════════════
function TabComprobantes({ user }) {
  const [comprobantes, setComprobantes] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, currentMsg: '' })
  const [lastBatch, setLastBatch] = useState(null)
  const galRef = useRef(null), camRef = useRef(null), zipRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await db.from('bank_comprobantes')
        .select('*, bank_transacciones:bank_transaccion_id(fecha,codigo_bac,descripcion,debito)')
        .order('created_at', { ascending: false }).limit(100)
      setComprobantes(data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Procesa un array de Files (puede venir de input o de un ZIP)
  const procesarFiles = async (files) => {
    if (!files || files.length === 0) return
    setProcessing(true); setProgress({ done: 0, total: files.length, currentMsg: 'Cargando OCR…' })
    let ok = 0, dup = 0, err = 0

    try {
      await loadTesseract()
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setProgress({ done: i, total: files.length, currentMsg: `Procesando ${file.name || 'imagen ' + (i + 1)}…` })
        try {
          const hash = await sha256File(file)
          const { data: existing } = await db.from('bank_comprobantes').select('id').eq('hash_imagen', hash).maybeSingle()
          if (existing) { dup++; continue }

          const { text, parsed } = await ocrComprobante(file)
          const ext = (file.name || '').split('.').pop()?.toLowerCase() || 'jpg'
          const yyyy = (parsed.fecha_extraida || new Date().toISOString().slice(0, 10)).slice(0, 4)
          const mm = (parsed.fecha_extraida || new Date().toISOString().slice(0, 10)).slice(5, 7)
          const path = `${yyyy}/${mm}/${hash}.${ext}`
          const { error: upErr } = await db.storage.from('bank-comprobantes').upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })
          if (upErr) throw upErr
          const { data: urlData } = db.storage.from('bank-comprobantes').getPublicUrl(path)

          const { error: insErr } = await db.from('bank_comprobantes').insert({
            foto_url: urlData.publicUrl, storage_path: path, hash_imagen: hash,
            ocr_text: text.slice(0, 5000), ocr_data: parsed,
            monto: parsed.monto || null, fecha_extraida: parsed.fecha_extraida || null,
            beneficiario: parsed.beneficiario || null, ultimos_4_digitos: parsed.ultimos_4_digitos || null,
            banco_origen: parsed.banco_origen || null, numero_referencia: parsed.numero_referencia || null,
            concepto: parsed.concepto || null, cuenta_origen: parsed.cuenta_origen || null,
            nombre_emisor: parsed.nombre_emisor || null,
            uploaded_by: user?.nombre || user?.rol || 'unknown',
          })
          if (insErr) { if (insErr.code === '23505') { dup++; continue } else throw insErr }
          ok++
        } catch (e) { console.error('Error procesando', file.name, e); err++ }
      }
      const { data: mres } = await db.rpc('bancoview_match_comprobantes')
      const matched = mres?.[0]?.matches_creados ?? 0, sin_match = mres?.[0]?.sin_match ?? 0
      setLastBatch({ ok, dup, err, matched, sin_match })
      await load()
    } finally { setProcessing(false); setProgress({ done: 0, total: 0, currentMsg: '' }) }
  }

  const handleFiles = async (files) => procesarFiles(Array.from(files))

  const handleZip = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    setProcessing(true); setProgress({ done: 0, total: 1, currentMsg: 'Descomprimiendo ZIP…' })
    try {
      await loadJSZip()
      const zip = await window.JSZip.loadAsync(f)
      const imgFiles = []
      const entries = Object.entries(zip.files).filter(([_, ent]) => !ent.dir && /\.(jpe?g|png|webp|heic|heif)$/i.test(ent.name))
      for (const [name, ent] of entries) {
        const blob = await ent.async('blob')
        imgFiles.push(new File([blob], name, { type: blob.type || 'image/jpeg' }))
      }
      if (imgFiles.length === 0) { alert('El ZIP no contiene imágenes válidas'); return }
      await procesarFiles(imgFiles)
    } catch (err) { alert('Error procesando ZIP: ' + err.message) } finally {
      setProcessing(false); if (zipRef.current) zipRef.current.value = ''
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  return (
    <>
      {/* Upload zone con 3 botones */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 20, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 6, textAlign: 'center' }}>📷 Subir comprobantes</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 14, lineHeight: 1.5, textAlign: 'center' }}>
          OCR Tesseract.js español + auto-match contra bank_transacciones por monto+fecha+4 dígitos.
        </div>

        <input ref={galRef} type="file" multiple accept="image/*" onChange={(e) => handleFiles(e.target.files)} disabled={processing} style={{ display: 'none' }} id="comp-gal" />
        <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={(e) => handleFiles(e.target.files)} disabled={processing} style={{ display: 'none' }} id="comp-cam" />
        <input ref={zipRef} type="file" accept=".zip,application/zip" onChange={handleZip} disabled={processing} style={{ display: 'none' }} id="comp-zip" />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="comp-gal" style={{ ...uploadBtn(processing, '#60a5fa') }}>🖼️ Galería (multi)</label>
          <label htmlFor="comp-cam" style={{ ...uploadBtn(processing, '#34d399') }}>📷 Cámara</label>
          <label htmlFor="comp-zip" style={{ ...uploadBtn(processing, '#fbbf24') }}>📦 Subir ZIP</label>
        </div>

        <div style={{ fontSize: 10, color: '#666', marginTop: 10, textAlign: 'center', maxWidth: 480, margin: '10px auto 0' }}>
          💡 <b>Para 1000+ capturas:</b> AirDrop iPhone→Mac → carpeta → click derecho → Compress → subí el .zip aquí
        </div>

        {processing && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>{progress.currentMsg}</div>
            <div style={{ background: '#0f172a', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ background: '#60a5fa', height: '100%', width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{progress.done} / {progress.total}</div>
          </div>
        )}
      </div>

      {lastBatch && (
        <div style={{ background: '#064e3b', border: '1px solid #065f46', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7', marginBottom: 6 }}>✅ Último batch</div>
          <div style={{ fontSize: 11, color: '#a7f3d0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px,1fr))', gap: 8 }}>
            <div>📥 Subidos: <b style={{ color: '#fff' }}>{lastBatch.ok}</b></div>
            <div>⚠️ Duplicados: <b style={{ color: '#fcd34d' }}>{lastBatch.dup}</b></div>
            <div>❌ Errores: <b style={{ color: '#fca5a5' }}>{lastBatch.err}</b></div>
            <div>🔗 Auto-match: <b style={{ color: '#fff' }}>{lastBatch.matched}</b></div>
            <div>🔍 Sin match: <b style={{ color: '#fbbf24' }}>{lastBatch.sin_match}</b></div>
          </div>
        </div>
      )}

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Últimos {comprobantes.length} comprobantes</div>
        {comprobantes.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div><div>Aún no hay comprobantes.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={th}>Foto</th><th style={th}>Fecha</th><th style={{ ...th, textAlign: 'right' }}>Monto</th>
                <th style={th}>Beneficiario</th><th style={th}>4 dig</th><th style={th}>Banco</th><th style={th}>Match</th>
              </tr></thead>
              <tbody>{comprobantes.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #2a3340' }}>
                  <td style={td}><a href={c.foto_url} target="_blank" rel="noreferrer">
                    <img src={c.foto_url} alt="comp" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid #374151' }} />
                  </a></td>
                  <td style={td}>{c.fecha_extraida ? fmtDate(c.fecha_extraida) : <span style={{ color: '#666' }}>—</span>}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{c.monto != null ? fmt(c.monto) : <span style={{ color: '#666' }}>—</span>}</td>
                  <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.beneficiario || <span style={{ color: '#666' }}>—</span>}</td>
                  <td style={td}><code style={codeSt}>{c.ultimos_4_digitos || '—'}</code></td>
                  <td style={td}>{c.banco_origen || <span style={{ color: '#666' }}>—</span>}</td>
                  <td style={td}>{c.bank_transaccion_id ? <span style={{ color: '#34d399', fontWeight: 700 }}>✅ {c.match_metodo}</span> : <span style={{ color: '#fbbf24' }}>⏳</span>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB COLA MANUAL — versión bulk (igual a la anterior)
// ═══════════════════════════════════════════════════════════
function TabColaManual({ user }) {
  const [tx, setTx] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('sin_clasificar')
  const [filtroMes, setFiltroMes] = useState('todos')
  const [filtroCodigo, setFiltroCodigo] = useState('todos')
  const [filtroProveedor, setFiltroProveedor] = useState('todos')
  const [filtroCategoria, setFiltroCategoria] = useState('todos')
  const [filtroCentro, setFiltroCentro] = useState('todos')
  const [search, setSearch] = useState('')
  const [seleccion, setSeleccion] = useState(new Set())
  const [bulkEstado, setBulkEstado] = useState('match_manual')
  const [expandido, setExpandido] = useState(null) // id de tx con drawer abierto

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Usa la vista enriquecida que incluye proveedores matcheados
      let q = db.from('v_bank_tx_con_match').select('*').order('fecha', { ascending: false })
      if (filtroEstado !== 'todos') q = q.eq('estado', filtroEstado)
      const data = await fetchAll(q)
      setTx(data); setSeleccion(new Set())
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [filtroEstado])
  useEffect(() => { load() }, [load])

  const meses = useMemo(() => ['todos', ...new Set(tx.map(t => (t.fecha || '').slice(0, 7))).values()].sort().reverse(), [tx])
  const codigos = useMemo(() => ['todos', ...new Set(tx.map(t => t.codigo_bac).filter(Boolean))], [tx])
  const proveedores = useMemo(() => {
    const set = new Set()
    tx.forEach(t => { if (t.proveedores_matcheados) t.proveedores_matcheados.split(' · ').forEach(p => set.add(p.trim())) })
    return ['todos', ...Array.from(set).sort()]
  }, [tx])
  const categorias = useMemo(() => ['todos', 'sin_categoria', ...new Set(tx.map(t => t.categoria_efectiva).filter(Boolean))].sort(), [tx])
  const centrosCosto = useMemo(() => ['todos', 'sin_centro', ...new Set(tx.map(t => t.centro_costo_nombre).filter(Boolean))].sort(), [tx])

  const searchLow = search.trim().toLowerCase()
  const filtrados = tx.filter(t => {
    if (filtroMes !== 'todos' && !(t.fecha || '').startsWith(filtroMes)) return false
    if (filtroCodigo !== 'todos' && t.codigo_bac !== filtroCodigo) return false
    if (filtroProveedor !== 'todos' && !(t.proveedores_matcheados || '').includes(filtroProveedor)) return false
    if (filtroCategoria === 'sin_categoria' && t.categoria_efectiva) return false
    if (filtroCategoria !== 'todos' && filtroCategoria !== 'sin_categoria' && t.categoria_efectiva !== filtroCategoria) return false
    if (filtroCentro === 'sin_centro' && t.centro_costo_nombre) return false
    if (filtroCentro !== 'todos' && filtroCentro !== 'sin_centro' && t.centro_costo_nombre !== filtroCentro) return false
    if (searchLow) {
      const hay = `${t.descripcion || ''} ${t.proveedores_matcheados || ''} ${t.referencia || ''} ${t.cuenta_destino_4dig || ''} ${t.notas || ''} ${t.centro_costo_nombre || ''} ${t.categoria_efectiva || ''} ${t.subcategoria || ''}`.toLowerCase()
      if (!hay.includes(searchLow)) return false
    }
    return true
  }).sort((a, b) => ((Number(b.debito) || 0) + (Number(b.credito) || 0)) - ((Number(a.debito) || 0) + (Number(a.credito) || 0)))

  const toggleSel = (id) => { const ns = new Set(seleccion); if (ns.has(id)) ns.delete(id); else ns.add(id); setSeleccion(ns) }
  const toggleSelAll = () => { if (seleccion.size === filtrados.length) setSeleccion(new Set()); else setSeleccion(new Set(filtrados.map(t => t.id))) }

  const aplicarBulk = async () => {
    if (seleccion.size === 0) return alert('Selecciona al menos una')
    if (!confirm(`Marcar ${seleccion.size} como "${bulkEstado}"?`)) return
    try {
      const { error } = await db.from('bank_transacciones').update({ estado: bulkEstado, notas: `[manual:${user?.rol || 'user'}_${today()}]` }).in('id', Array.from(seleccion))
      if (error) throw error; await load()
    } catch (e) { alert('Error: ' + e.message) }
  }

  const revertir = async (id) => {
    if (!confirm('Revertir a sin_clasificar?')) return
    try {
      // Eliminar bank_match asociados (si los hay)
      await db.from('bank_match').delete().eq('bank_transaccion_id', id)
      await db.from('bank_transacciones').update({
        estado: 'sin_clasificar',
        notas: `[reverted:${user?.rol || 'user'}_${today()}]`,
      }).eq('id', id)
      await load()
    } catch (e) { alert('Error: ' + e.message) }
  }

  const revertirBulk = async () => {
    if (seleccion.size === 0) return alert('Selecciona al menos una')
    if (!confirm(`Revertir ${seleccion.size} transacciones a sin_clasificar? (también borra sus matches)`)) return
    try {
      const ids = Array.from(seleccion)
      await db.from('bank_match').delete().in('bank_transaccion_id', ids)
      await db.from('bank_transacciones').update({
        estado: 'sin_clasificar',
        notas: `[reverted_bulk:${user?.rol || 'user'}_${today()}]`,
      }).in('id', ids)
      await load()
    } catch (e) { alert('Error: ' + e.message) }
  }

  const ESTADOS_FILTRO = [
    { val: 'todos', label: 'Todos los estados' },
    { val: 'sin_clasificar', label: '🔴 Sin clasificar' },
    { val: 'auto_match', label: '🟢 Auto-match' },
    { val: 'match_manual', label: '🔵 Manual (Wizard)' },
    { val: 'movimiento_socio', label: '🟣 Socio' },
    { val: 'sin_dte', label: '🟠 Sin DTE' },
    { val: 'comision_bancaria', label: '🟡 Comisión bancaria' },
    { val: 'transferencia_interna', label: '⚪ Transferencia interna' },
    { val: 'ignorar', label: '🗑 Ignoradas' },
  ]

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>
  const verRevertir = filtroEstado !== 'sin_clasificar' && filtroEstado !== 'todos'

  return (
    <>
      {/* Buscador global */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 8 }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Buscar en descripción, proveedor, referencia, 4 dig, categoría, centro, notas…"
            style={{ ...inputSt, width: '100%', padding: '10px 14px', fontSize: 13 }}
          />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#888', fontSize: 16, cursor: 'pointer' }}>×</button>}
        </div>
      </div>

      {/* Filtros + bulk */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={labelSt}>Estado</div><select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ ...inputSt, minWidth: 160 }}>
          {ESTADOS_FILTRO.map(e => <option key={e.val} value={e.val}>{e.label}</option>)}
        </select></div>
        <div><div style={labelSt}>Mes</div><select value={filtroMes} onChange={e => setFiltroMes(e.target.value)} style={inputSt}>
          {meses.map(m => <option key={m} value={m}>{m === 'todos' ? 'Todos' : m}</option>)}
        </select></div>
        <div><div style={labelSt}>Cód</div><select value={filtroCodigo} onChange={e => setFiltroCodigo(e.target.value)} style={inputSt}>
          {codigos.map(c => <option key={c} value={c}>{c === 'todos' ? 'Todos' : c}</option>)}
        </select></div>
        <div><div style={labelSt}>Proveedor</div><select value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)} style={{ ...inputSt, maxWidth: 200 }}>
          {proveedores.map(p => <option key={p} value={p}>{p === 'todos' ? 'Todos' : (p.length > 30 ? p.slice(0, 30) + '…' : p)}</option>)}
        </select></div>
        <div><div style={labelSt}>Categoría</div><select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={inputSt}>
          {categorias.map(c => <option key={c} value={c}>{c === 'todos' ? 'Todas' : c === 'sin_categoria' ? '— sin categoría' : c}</option>)}
        </select></div>
        <div><div style={labelSt}>Centro</div><select value={filtroCentro} onChange={e => setFiltroCentro(e.target.value)} style={inputSt}>
          {centrosCosto.map(c => <option key={c} value={c}>{c === 'todos' ? 'Todos' : c === 'sin_centro' ? '— sin centro' : c}</option>)}
        </select></div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {verRevertir ? (
            <button onClick={revertirBulk} disabled={seleccion.size === 0} style={{ ...btnSt, background: 'rgba(251,191,36,0.15)', border: '1px solid #fbbf24', color: '#fbbf24', opacity: seleccion.size === 0 ? 0.5 : 1 }}>
              ↩️ Revertir ({seleccion.size})
            </button>
          ) : (
            <>
              <div><div style={labelSt}>Marcar como</div><select value={bulkEstado} onChange={e => setBulkEstado(e.target.value)} style={inputSt}>
                {ESTADOS_CLASIFICAR.map(e => <option key={e.val} value={e.val}>{e.label}</option>)}
              </select></div>
              <button onClick={aplicarBulk} disabled={seleccion.size === 0} style={{ ...btnSt, opacity: seleccion.size === 0 ? 0.5 : 1 }}>Aplicar ({seleccion.size})</button>
            </>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>{filtrados.length} tx · suma: {fmt(filtrados.reduce((s, t) => s + (Number(t.debito) || 0) + (Number(t.credito) || 0), 0))}</div>

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 8, overflow: 'auto', maxHeight: '70vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#1f2937', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={{ ...th, width: 30 }}><input type="checkbox" checked={seleccion.size === filtrados.length && filtrados.length > 0} onChange={toggleSelAll} /></th>
              <th style={th}>Fecha</th>
              <th style={th}>Cód</th>
              {filtroEstado === 'todos' && <th style={th}>Estado</th>}
              <th style={th}>Descripción</th>
              <th style={th}>4 dig</th>
              <th style={th}>Match (proveedor)</th>
              <th style={th}>Categoría</th>
              <th style={th}>Centro</th>
              <th style={th}>Foto</th>
              <th style={{ ...th, textAlign: 'right' }}>Débito</th>
              <th style={{ ...th, textAlign: 'right' }}>Crédito</th>
              {verRevertir && <th style={{ ...th, width: 50 }}></th>}
            </tr>
          </thead>
          <tbody>{filtrados.slice(0, 200).map(t => {
            const ec = ESTADO_COLOR[t.estado] || ESTADO_COLOR.sin_clasificar
            const isExp = expandido === t.id
            const comp = t.comprobante_info
            return (<>
            <tr key={t.id} style={{ borderBottom: isExp ? 'none' : '1px solid #2a3340', cursor: 'pointer', background: seleccion.has(t.id) ? 'rgba(96,165,250,0.06)' : (isExp ? 'rgba(96,165,250,0.04)' : 'transparent') }}
                onClick={() => setExpandido(isExp ? null : t.id)}>
              <td style={td} onClick={e => e.stopPropagation()}><input type="checkbox" checked={seleccion.has(t.id)} onChange={() => toggleSel(t.id)} /></td>
              <td style={td}>{fmtDate(t.fecha)}</td>
              <td style={td}><code style={codeSt}>{t.codigo_bac}</code></td>
              {filtroEstado === 'todos' && <td style={td}><span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: ec.bg, color: ec.color, fontWeight: 700 }}>{ec.label}</span></td>}
              <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.descripcion}</td>
              <td style={td}><code style={codeSt}>{t.cuenta_destino_4dig || '—'}</code></td>
              <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.matches_count > 0 ? '#a7f3d0' : '#666' }}>
                {t.proveedores_matcheados ? <>{t.proveedores_matcheados}{t.matches_count > 1 && <span style={{ color: '#888' }}> ({t.matches_count})</span>}</> : '—'}
              </td>
              <td style={{ ...td, color: t.categoria_efectiva ? '#bfdbfe' : '#666' }}>{t.categoria_efectiva || '—'}</td>
              <td style={{ ...td, color: t.centro_costo_nombre ? '#fcd34d' : '#666' }}>{t.centro_costo_nombre || '—'}</td>
              <td style={td}>{comp?.foto_url ? <img src={comp.foto_url} alt="comp" style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 3, border: '1px solid #374151' }} /> : <span style={{ color: '#444' }}>—</span>}</td>
              <td style={{ ...td, textAlign: 'right', color: Number(t.debito) > 0 ? '#fb7185' : '#666' }}>{Number(t.debito) > 0 ? fmt(t.debito) : '—'}</td>
              <td style={{ ...td, textAlign: 'right', color: Number(t.credito) > 0 ? '#34d399' : '#666' }}>{Number(t.credito) > 0 ? fmt(t.credito) : '—'}</td>
              {verRevertir && <td style={td} onClick={e => e.stopPropagation()}>
                <button onClick={() => revertir(t.id)} title="Revertir a sin_clasificar"
                  style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid #fbbf24', background: 'transparent', color: '#fbbf24', cursor: 'pointer' }}>↩️</button>
              </td>}
            </tr>
            {isExp && (
              <tr key={t.id + '-exp'} style={{ borderBottom: '1px solid #2a3340', background: 'rgba(15,23,42,0.6)' }}>
                <td colSpan={filtroEstado === 'todos' ? (verRevertir ? 13 : 12) : (verRevertir ? 12 : 11)} style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: comp?.foto_url ? '1fr 220px' : '1fr', gap: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, fontSize: 11 }}>
                      <DetailField label="Referencia BAC" value={t.referencia} mono />
                      <DetailField label="Cuenta destino (full)" value={t.descripcion?.match(/\d{6,}/)?.[0]} mono />
                      <DetailField label="Subcategoría" value={t.subcategoria} />
                      <DetailField label="Sucursal" value={t.sucursal_inferida} />
                      <DetailField label="Categoría P&L grupo" value={t.categoria_grupo} />
                      <DetailField label="Centro costo tipo" value={t.centro_costo_tipo} />
                      <DetailField label="Match método" value={t.match_metodo} mono />
                      <DetailField label="Confianza" value={t.match_confianza ? `${(t.match_confianza * 100).toFixed(0)}%` : null} />
                      <DetailField label="N° matches" value={t.matches_count > 0 ? t.matches_count : null} />
                      <DetailField label="Monto aplicado" value={t.monto_aplicado_total ? fmt(t.monto_aplicado_total) : null} />
                      {comp?.concepto && <DetailField label="Concepto OCR" value={comp.concepto} wide />}
                      {comp?.banco_origen && <DetailField label="Banco origen" value={comp.banco_origen} />}
                      {t.notas && <DetailField label="Notas / audit" value={t.notas} wide mono />}
                    </div>
                    {comp?.foto_url && (
                      <div>
                        <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>📷 Comprobante OCR</div>
                        <a href={comp.foto_url} target="_blank" rel="noreferrer">
                          <img src={comp.foto_url} alt="comp" style={{ width: '100%', maxWidth: 200, borderRadius: 6, border: '1px solid #374151' }} />
                        </a>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            )}
            </>)
          })}
          </tbody>
        </table>
        {filtrados.length > 200 && <div style={{ padding: 12, textAlign: 'center', color: '#888', fontSize: 11 }}>Mostrando 200 de {filtrados.length}.</div>}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB REGLAS
// ═══════════════════════════════════════════════════════════
function TabReglas() {
  const [reglas, setReglas] = useState([])
  const [aprendizaje, setAprendizaje] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reg, apr] = await Promise.all([
        db.from('bank_reglas_clasificacion').select('*').order('prioridad', { ascending: true }),
        db.from('bank_aprendizaje').select('*').order('confirmaciones', { ascending: false }).limit(20),
      ])
      setReglas(reg.data || []); setAprendizaje(apr.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const ejecutar = async () => {
    if (!confirm('Ejecutar motor ahora?')) return
    setRunning(true)
    try { const { data } = await db.rpc('bancoview_aplicar_reglas'); setLastRun(data || []); await load() }
    catch (e) { alert('Error: ' + e.message) } finally { setRunning(false) }
  }

  const toggleRegla = async (id, activa) => {
    try { await db.from('bank_reglas_clasificacion').update({ activa: !activa }).eq('id', id); await load() }
    catch (e) { alert('Error: ' + e.message) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  return (
    <>
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={ejecutar} disabled={running} style={{ ...btnSt, opacity: running ? 0.5 : 1 }}>{running ? '⏳' : '▶️ Aplicar 10 reglas base'}</button>
        <button onClick={async () => {
          if (!confirm('Aplicar TODAS las reglas aprendidas (AUTO—) a las tx pendientes que matcheen?')) return
          setRunning(true)
          try {
            const { data, error } = await db.rpc('bancoview_aplicar_aprendizaje')
            if (error) throw error
            const r = data?.[0]
            alert(`✅ ${r?.reglas_evaluadas || 0} reglas evaluadas · ${r?.transacciones_marcadas || 0} tx marcadas · ${r?.matches_creados || 0} matches creados`)
            await load()
          } catch (e) { alert('Error: ' + e.message) } finally { setRunning(false) }
        }} disabled={running} style={{ ...btnSt, background: 'rgba(168,85,247,0.15)', border: '1px solid #a855f7', color: '#c4b5fd', opacity: running ? 0.5 : 1 }}>
          🚀 Aplicar aprendizaje (reglas AUTO—)
        </button>
        <div style={{ fontSize: 11, color: '#888' }}>Idempotente: solo procesa <code style={codeSt}>sin_clasificar</code>.</div>
      </div>

      {lastRun && (
        <div style={{ background: '#064e3b', border: '1px solid #065f46', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7', marginBottom: 6 }}>✅ Última corrida</div>
          <table style={{ width: '100%', fontSize: 11 }}><tbody>{lastRun.map(r => (
            <tr key={r.regla_id}>
              <td style={{ padding: '2px 6px', color: '#a7f3d0' }}>{r.regla_nombre}</td>
              <td style={{ padding: '2px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{r.transacciones_afectadas} tx</td>
              <td style={{ padding: '2px 6px', textAlign: 'right', color: '#a7f3d0' }}>{r.matches_creados} m</td>
              <td style={{ padding: '2px 6px', textAlign: 'right', color: '#a7f3d0' }}>{fmt(r.monto_afectado)}</td>
            </tr>))}</tbody></table>
        </div>
      )}

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Reglas activas ({reglas.length})</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ borderBottom: '1px solid #374151' }}>
            <th style={{ ...th, width: 50 }}>Pri</th><th style={th}>Nombre</th><th style={th}>Activa</th>
            <th style={{ ...th, textAlign: 'right' }}>Hits</th><th style={th}>Última</th>
          </tr></thead>
          <tbody>{reglas.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #2a3340' }}>
              <td style={td}>{r.prioridad}</td><td style={td}>{r.nombre}</td>
              <td style={td}><button onClick={() => toggleRegla(r.id, r.activa)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>{r.activa ? '🟢' : '⚪'}</button></td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{r.hits}</td>
              <td style={{ ...td, color: '#888' }}>{r.last_hit_at ? new Date(r.last_hit_at).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
            </tr>))}
          </tbody>
        </table>
      </div>

      {aprendizaje.length > 0 && (
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>🧠 Patrones aprendidos ({aprendizaje.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={th}>Patrón</th><th style={th}>Valor</th><th style={th}>→ Proveedor</th>
              <th style={{ ...th, textAlign: 'right' }}>Confirmaciones</th><th style={th}>Regla</th>
            </tr></thead>
            <tbody>{aprendizaje.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid #2a3340' }}>
                <td style={td}>{a.patron_tipo}</td>
                <td style={td}><code style={codeSt}>{a.patron_valor}</code></td>
                <td style={td}>{a.proveedor_nombre || '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: a.confirmaciones >= 3 ? '#34d399' : '#fbbf24' }}>{a.confirmaciones}</td>
                <td style={td}>{a.regla_creada_id ? <span style={{ color: '#34d399' }}>✅ R{a.regla_creada_id}</span> : <span style={{ color: '#888' }}>aprendiendo…</span>}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB AUDITORÍA
// ═══════════════════════════════════════════════════════════
function TabAuditoria() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await db.from('bank_match')
        .select('*, bank_transacciones:bank_transaccion_id(fecha,codigo_bac,descripcion,debito,credito)')
        .order('created_at', { ascending: false }).limit(200)
      setMatches(data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const undo = async (id) => {
    if (!confirm('Eliminar match? La tx vuelve a sin_clasificar.')) return
    try { await db.from('bank_match').delete().eq('id', id); await load() }
    catch (e) { alert('Error: ' + e.message) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>
  if (matches.length === 0) return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 24, textAlign: 'center', color: '#888' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div><div>Aún no hay matches.</div>
      <div style={{ fontSize: 11, marginTop: 6 }}>Los matches se crean desde el Wizard, OCR comprobantes o las reglas auto.</div>
    </div>
  )

  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Últimos {matches.length} matches</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ borderBottom: '1px solid #374151' }}>
          <th style={th}>Fecha</th><th style={th}>Cód</th><th style={th}>Descripción</th><th style={th}>Target</th>
          <th style={{ ...th, textAlign: 'right' }}>Monto</th><th style={th}>Conf</th><th style={th}>Método</th><th style={th}></th>
        </tr></thead>
        <tbody>{matches.map(m => {
          const t = m.bank_transacciones
          return (
            <tr key={m.id} style={{ borderBottom: '1px solid #2a3340' }}>
              <td style={td}>{t ? fmtDate(t.fecha) : '—'}</td>
              <td style={td}><code style={codeSt}>{t?.codigo_bac}</code></td>
              <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t?.descripcion}</td>
              <td style={td}>{m.target_tabla}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(m.monto_aplicado)}</td>
              <td style={td}>{m.confianza ? `${(m.confianza * 100).toFixed(0)}%` : '—'}</td>
              <td style={{ ...td, fontSize: 10, color: '#888' }}>{m.metodo}</td>
              <td style={td}><button onClick={() => undo(m.id)} style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', cursor: 'pointer' }}>Undo</button></td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB VINCULAR DTE — Gastos sin DTE → DTE generado después (F5.6)
// ═══════════════════════════════════════════════════════════
function TabVincularDTE({ user, pushNotif }) {
  const [gastos, setGastos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroProv, setFiltroProv] = useState('')
  const [filtroMin, setFiltroMin] = useState('')
  const [filtroMax, setFiltroMax] = useState('')
  const [sugerencias, setSugerencias] = useState({}) // { gastoId: [...candidatos] }
  const [loadingSug, setLoadingSug] = useState({}) // { gastoId: bool }
  const [saving, setSaving] = useState({}) // { gastoId: bool }
  const [stats, setStats] = useState({ total: 0, monto: 0, vinculados_hoy: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await fetchAll(
        db.from('v_gastos_sin_dte_pendientes_vinculacion').select('*').order('fecha', { ascending: false })
      )
      setGastos(all || [])
      const totalMonto = (all || []).reduce((s, g) => s + Number(g.monto_total || 0), 0)
      // contar vinculados hoy: la función inserta "el YYYY-MM-DD" en notas
      const hoy = today()
      const { count } = await db.from('compras_sin_dte')
        .select('*', { count: 'exact', head: true })
        .eq('tipo', 'pagado_anticipado_con_dte')
        .ilike('notas', `%vinculado_a_dte:%el ${hoy}%`)
      setStats({ total: all?.length || 0, monto: totalMonto, vinculados_hoy: count || 0 })
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const cargarSugerencias = async (gastoId) => {
    if (sugerencias[gastoId]) return // ya cargadas
    setLoadingSug(s => ({ ...s, [gastoId]: true }))
    try {
      const { data, error } = await db.rpc('bancoview_sugerir_dtes_para_gasto', { p_gasto_id: gastoId })
      if (error) throw error
      setSugerencias(s => ({ ...s, [gastoId]: data || [] }))
    } catch (e) {
      console.error(e)
      setSugerencias(s => ({ ...s, [gastoId]: [] }))
    } finally {
      setLoadingSug(s => ({ ...s, [gastoId]: false }))
    }
  }

  const vincular = async (gastoId, dteId, score) => {
    if (!confirm(`Vincular este gasto al DTE seleccionado?\n\nScore: ${(score * 100).toFixed(0)}%\n\nEsto marcará el gasto como 'pagado_anticipado_con_dte' y actualizará el DTE como pagado.`)) return
    setSaving(s => ({ ...s, [gastoId]: true }))
    try {
      const { error } = await db.rpc('bancoview_vincular_gasto_a_dte', {
        p_gasto_id: gastoId,
        p_dte_id: dteId,
        p_usuario: user?.nombre || user?.pin || 'desconocido',
      })
      if (error) throw error
      pushNotif?.(`Gasto vinculado a DTE — ahora aparecerá pagado en compras DTE`)
      // remover gasto de la lista
      setGastos(gs => gs.filter(g => g.id !== gastoId))
      setSugerencias(s => { const c = { ...s }; delete c[gastoId]; return c })
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(s => ({ ...s, [gastoId]: false }))
    }
  }

  const ignorar = async (gastoId) => {
    if (!confirm('Marcar como gasto sin DTE formal? (acepta que no habrá factura)')) return
    setSaving(s => ({ ...s, [gastoId]: true }))
    try {
      await db.from('compras_sin_dte').update({ tipo: 'sin_dte_formal' }).eq('id', gastoId)
      setGastos(gs => gs.filter(g => g.id !== gastoId))
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(s => ({ ...s, [gastoId]: false }))
    }
  }

  const filtered = useMemo(() => {
    return gastos.filter(g => {
      if (filtroProv && !(g.proveedor_nombre || '').toLowerCase().includes(filtroProv.toLowerCase())) return false
      const m = Number(g.monto_total || 0)
      if (filtroMin && m < parseFloat(filtroMin)) return false
      if (filtroMax && m > parseFloat(filtroMax)) return false
      return true
    })
  }, [gastos, filtroProv, filtroMin, filtroMax])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando gastos pendientes…</div>

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        <KpiCard label="Pendientes" value={stats.total} sub="gastos sin DTE" color="#f59e0b" />
        <KpiCard label="Monto total" value={fmt(stats.monto)} sub="por vincular" color="#60a5fa" />
        <KpiCard label="Vinculados hoy" value={stats.vinculados_hoy} sub="DTE encontrado" color="#34d399" />
      </div>

      {/* Info banner */}
      <div style={{ background: '#1e3a8a22', border: '1px solid #1e3a8a', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: '#bfdbfe' }}>
        💡 <b>Cómo funciona:</b> Estos son pagos hechos por banco sin DTE al momento. Si después llegó un DTE del proveedor, vincúlalos aquí. El sistema sugiere candidatos por monto exacto + proveedor + fecha posterior. Score ≥80% es match seguro.
      </div>

      {/* Filtros */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 10, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelSt}>Proveedor</label>
          <input type="text" value={filtroProv} onChange={e => setFiltroProv(e.target.value)} placeholder="buscar…" style={{ ...inputSt, width: 180 }} />
        </div>
        <div>
          <label style={labelSt}>Monto mín</label>
          <input type="number" value={filtroMin} onChange={e => setFiltroMin(e.target.value)} placeholder="0" style={{ ...inputSt, width: 90 }} />
        </div>
        <div>
          <label style={labelSt}>Monto máx</label>
          <input type="number" value={filtroMax} onChange={e => setFiltroMax(e.target.value)} placeholder="∞" style={{ ...inputSt, width: 90 }} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>
          Mostrando <b style={{ color: '#fff' }}>{filtered.length}</b> de {gastos.length}
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 24, textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{gastos.length === 0 ? '✅' : '🔎'}</div>
          <div>{gastos.length === 0 ? 'No hay gastos pendientes de vincular' : 'No hay gastos que coincidan con los filtros'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(g => (
            <GastoVincularCard
              key={g.id}
              gasto={g}
              sugerencias={sugerencias[g.id]}
              loadingSug={loadingSug[g.id]}
              saving={saving[g.id]}
              onLoad={() => cargarSugerencias(g.id)}
              onVincular={(dteId, score) => vincular(g.id, dteId, score)}
              onIgnorar={() => ignorar(g.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GastoVincularCard({ gasto, sugerencias, loadingSug, saving, onLoad, onVincular, onIgnorar }) {
  const [open, setOpen] = useState(false)
  const toggle = () => {
    if (!open) onLoad()
    setOpen(o => !o)
  }
  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, border: '1px solid #374151' }}>
      {/* Header del gasto */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{gasto.proveedor_nombre || '(sin proveedor)'}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            {fmtDate(gasto.fecha)} · {gasto.descripcion || 'sin descripción'}
            {gasto.proveedor_nit && <span> · NIT {gasto.proveedor_nit}</span>}
          </div>
          {gasto.categoria_nombre && (
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
              📂 {gasto.categoria_nombre}{gasto.catalogo_subcategoria && ` › ${gasto.catalogo_subcategoria}`}
              {gasto.centro_costo_nombre && ` · 🏗️ ${gasto.centro_costo_nombre}`}
            </div>
          )}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24', minWidth: 100, textAlign: 'right' }}>{fmt(gasto.monto_total)}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={toggle} disabled={saving} style={{
            ...btnSt, padding: '6px 12px', fontSize: 11,
            background: open ? 'rgba(96,165,250,0.25)' : 'rgba(96,165,250,0.10)',
          }}>
            {open ? '▼ Ocultar' : '🔍 Buscar DTE'}
          </button>
          <button onClick={onIgnorar} disabled={saving} style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #6b7280',
            background: 'transparent', color: '#9ca3af', fontWeight: 700, fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer',
          }}>Sin DTE formal</button>
        </div>
      </div>

      {/* Sugerencias */}
      {open && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #374151' }}>
          {loadingSug ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 12, fontSize: 12 }}>Buscando candidatos…</div>
          ) : !sugerencias || sugerencias.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 12, fontSize: 12 }}>
              📭 Sin candidatos. Verifica que el DTE haya sido emitido o cárgalo manualmente.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8, fontWeight: 600 }}>Top {sugerencias.length} candidatos:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sugerencias.map(c => {
                  const score = Number(c.score || 0)
                  const scoreColor = score >= 0.8 ? '#34d399' : score >= 0.5 ? '#fbbf24' : '#9ca3af'
                  return (
                    <div key={c.dte_id} style={{
                      background: '#0f172a', borderRadius: 6, padding: 8, display: 'flex', gap: 10, alignItems: 'center',
                      border: `1px solid ${score >= 0.8 ? '#065f46' : '#374151'}`,
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: scoreColor, minWidth: 50 }}>{(score * 100).toFixed(0)}%</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
                          {c.proveedor_nombre || '(sin proveedor)'} · {fmt(c.monto_total)}
                          {Math.abs(Number(c.diff_monto || 0)) > 0.01 && (
                            <span style={{ color: '#fca5a5', fontSize: 10, marginLeft: 6 }}>(Δ {fmt(Math.abs(c.diff_monto))})</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>
                          {fmtDate(c.fecha_emision)}
                          {c.diff_dias != null && <span> · {c.diff_dias > 0 ? `+${c.diff_dias}d después` : `${c.diff_dias}d antes`}</span>}
                          {c.numero_control && <span> · {c.numero_control}</span>}
                          {c.tipo_dte && <span> · tipo {c.tipo_dte}</span>}
                        </div>
                        {c.razon && (
                          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1, fontStyle: 'italic' }}>{c.razon}</div>
                        )}
                      </div>
                      <button
                        onClick={() => onVincular(c.dte_id, score)}
                        disabled={saving}
                        style={{
                          padding: '6px 12px', borderRadius: 6,
                          border: `1px solid ${scoreColor}`,
                          background: `${scoreColor}22`, color: scoreColor,
                          fontWeight: 700, fontSize: 11,
                          cursor: saving ? 'not-allowed' : 'pointer',
                        }}
                      >Vincular</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB SOCIOS — F6: Movimientos socios + aportes FIFO + intereses
// ═══════════════════════════════════════════════════════════
function TabSocios({ user, pushNotif }) {
  const [subTab, setSubTab] = useState('cola')
  const SUB_TABS = [
    { key: 'cola', label: '📥 Cola pendiente' },
    { key: 'balance', label: '⚖️ Balance socios' },
    { key: 'aportes', label: '🧾 Aportes FIFO' },
    { key: 'prestamos', label: '🏦 Préstamos' },
  ]
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            border: subTab === t.key ? '2px solid #a78bfa' : '1px solid #444',
            background: subTab === t.key ? 'rgba(167,139,250,0.15)' : 'transparent',
            color: subTab === t.key ? '#a78bfa' : '#aaa',
          }}>{t.label}</button>
        ))}
      </div>
      {subTab === 'cola' && <SubColaSocios user={user} pushNotif={pushNotif} />}
      {subTab === 'balance' && <SubBalanceSocios />}
      {subTab === 'aportes' && <SubAportesFIFO />}
      {subTab === 'prestamos' && <SubPrestamos user={user} pushNotif={pushNotif} />}
    </div>
  )
}

// Sub-tab Cola: bank_tx pendientes de clasificar como movimiento socio
function SubColaSocios({ user, pushNotif }) {
  const [pendientes, setPendientes] = useState([])
  const [socios, setSocios] = useState([])
  const [loading, setLoading] = useState(true)
  const [forms, setForms] = useState({}) // {tx_id: {socio_id, tipo, notas, ...}}
  const [saving, setSaving] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pendData, sociosData] = await Promise.all([
        fetchAll(db.from('v_bank_tx_socio_pendientes').select('*')),
        db.from('socios').select('*').eq('activo', true).order('nombre'),
      ])
      setPendientes(pendData || [])
      setSocios(sociosData.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const updateForm = (txId, patch) => setForms(f => ({ ...f, [txId]: { ...f[txId], ...patch } }))

  const clasificar = async (tx) => {
    const f = forms[tx.id] || {}
    const socioId = f.socio_id || tx.socio_sugerido_id
    const tipo = f.tipo
    if (!socioId) { alert('Falta socio'); return }
    if (!tipo) { alert('Falta tipo'); return }
    const tipoConfig = TIPOS_MOV_SOCIO.find(t => t.val === tipo)
    if (!tipoConfig) { alert('Tipo inválido'); return }
    if (tipoConfig.dir === 'I' && tx.direccion !== 'I') {
      if (!confirm(`Tipo "${tipoConfig.label}" suele ser ingreso pero esta tx es egreso. ¿Continuar?`)) return
    }
    if (tipoConfig.dir === 'E' && tx.direccion !== 'E') {
      if (!confirm(`Tipo "${tipoConfig.label}" suele ser egreso pero esta tx es ingreso. ¿Continuar?`)) return
    }
    setSaving(s => ({ ...s, [tx.id]: true }))
    try {
      const { data, error } = await db.rpc('bancoview_clasificar_movimiento_socio', {
        p_bank_tx_id: tx.id,
        p_socio_id: socioId,
        p_tipo: tipo,
        p_clasif_pl: tipoConfig.clasif,
        p_centro_costo_id: f.centro_costo_id || null,
        p_notas: f.notas || null,
        p_usuario: user?.nombre || user?.pin || 'desconocido',
      })
      if (error) throw error
      const result = data?.[0]
      if (result?.ok) {
        pushNotif?.(result.mensaje)
        setPendientes(p => p.filter(x => x.id !== tx.id))
        setForms(f2 => { const c = { ...f2 }; delete c[tx.id]; return c })
      } else {
        alert('Error: ' + (result?.mensaje || 'desconocido'))
      }
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(s => ({ ...s, [tx.id]: false }))
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  const totalI = pendientes.filter(p => p.direccion === 'I').reduce((s, p) => s + Number(p.monto || 0), 0)
  const totalE = pendientes.filter(p => p.direccion === 'E').reduce((s, p) => s + Number(p.monto || 0), 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
        <KpiCard label="Pendientes" value={pendientes.length} sub="bank_tx por clasificar" color="#a78bfa" />
        <KpiCard label="Ingresos" value={fmt(totalI)} sub="entradas hacia banco" color="#34d399" />
        <KpiCard label="Egresos" value={fmt(totalE)} sub="salidas del banco" color="#fbbf24" />
      </div>

      <div style={{ background: '#1e3a8a22', border: '1px solid #1e3a8a', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: '#bfdbfe' }}>
        💡 <b>Cómo funciona:</b> Cada bank_tx detectada como movimiento socio (R03) requiere clasificación caso por caso. Los <b>aportes/préstamos de socio</b> crean lotes FIFO que devengan 10% anual capitalizado mensual tras 30 días sin repago. Los <b>repagos</b> consumen los aportes desde el más antiguo. Los <b>salarios</b> y <b>dividendos</b> impactan P&L directamente.
      </div>

      {pendientes.length === 0 ? (
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 24, textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div>No hay movimientos socio pendientes</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pendientes.slice(0, 50).map(tx => {
            const f = forms[tx.id] || {}
            const socioActual = f.socio_id || tx.socio_sugerido_id
            return (
              <div key={tx.id} style={{ background: '#1f2937', borderRadius: 8, padding: 10, border: '1px solid #374151' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#888' }}>{fmtDate(tx.fecha)} · <code style={codeSt}>{tx.codigo_bac}</code></div>
                    <div style={{ fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.descripcion}>{tx.descripcion}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: tx.direccion === 'I' ? '#34d399' : '#fbbf24' }}>
                    {tx.direccion === 'I' ? '+' : '−'}{fmt(tx.monto)}
                  </div>
                  <select value={socioActual || ''} onChange={e => updateForm(tx.id, { socio_id: parseInt(e.target.value) })}
                    style={{ ...inputSt, fontSize: 11 }}>
                    <option value="">— socio —</option>
                    {socios.map(s => <option key={s.id} value={s.id}>{s.nombre}{tx.socio_sugerido_id === s.id ? ' ✨' : ''}</option>)}
                  </select>
                  <select value={f.tipo || ''} onChange={e => updateForm(tx.id, { tipo: e.target.value })}
                    style={{ ...inputSt, fontSize: 11 }}>
                    <option value="">— tipo —</option>
                    {TIPOS_MOV_SOCIO
                      .filter(t => t.dir === 'B' || t.dir === tx.direccion)
                      .map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
                  </select>
                  <button onClick={() => clasificar(tx)} disabled={saving[tx.id]} style={{
                    ...btnSt, padding: '6px 12px', fontSize: 11,
                    background: saving[tx.id] ? '#374151' : 'rgba(167,139,250,0.15)',
                    border: '1px solid #a78bfa', color: '#a78bfa',
                  }}>{saving[tx.id] ? '…' : 'Clasificar'}</button>
                </div>
                <input type="text" value={f.notas || ''} onChange={e => updateForm(tx.id, { notas: e.target.value })}
                  placeholder="Notas (opcional, ej: 'aporte para inversión Plaza Olímpica')"
                  style={{ ...inputSt, width: '100%', marginTop: 6, fontSize: 11 }} />
              </div>
            )
          })}
          {pendientes.length > 50 && (
            <div style={{ textAlign: 'center', color: '#888', fontSize: 11, padding: 8 }}>
              Mostrando 50 de {pendientes.length}. Sigue clasificando para ver más.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SubBalanceSocios() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [devengando, setDevengando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await db.from('v_socios_balance').select('*').order('deuda_total', { ascending: false })
      setData(data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const devengar = async () => {
    if (!confirm('Devengar intereses al día de hoy? Esto capitaliza intereses para todos los aportes activos con > 30 días sin repago.')) return
    setDevengando(true)
    try {
      const { data, error } = await db.rpc('bancoview_devengar_intereses_socios', { p_fecha_corte: today() })
      if (error) throw error
      const r = data?.[0]
      alert(r?.mensaje || 'OK')
      await load()
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setDevengando(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  const totales = data.reduce((acc, d) => ({
    aportado: acc.aportado + Number(d.total_aportado || 0),
    repagado: acc.repagado + Number(d.total_capital_repagado || 0),
    pendiente: acc.pendiente + Number(d.capital_pendiente || 0),
    int_acum: acc.int_acum + Number(d.intereses_acumulados || 0),
    int_pag: acc.int_pag + Number(d.intereses_pagados || 0),
    salarios: acc.salarios + Number(d.total_salarios || 0),
    deuda: acc.deuda + Number(d.deuda_total || 0),
  }), { aportado: 0, repagado: 0, pendiente: 0, int_acum: 0, int_pag: 0, salarios: 0, deuda: 0 })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Balance por socio</div>
        <button onClick={devengar} disabled={devengando} style={{
          padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: devengando ? 'not-allowed' : 'pointer',
          border: '1px solid #a78bfa', background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
        }}>{devengando ? 'Devengando…' : '⚡ Devengar intereses (hoy)'}</button>
      </div>
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 10, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 800 }}>
          <thead><tr style={{ borderBottom: '2px solid #374151' }}>
            <th style={{ ...th, position: 'sticky', left: 0, background: '#1f2937', zIndex: 1 }}>Socio</th>
            <th style={{ ...th, textAlign: 'right' }}>Aportado</th>
            <th style={{ ...th, textAlign: 'right' }}>Repagado</th>
            <th style={{ ...th, textAlign: 'right' }}>Capital pendiente</th>
            <th style={{ ...th, textAlign: 'right' }}>Int. acum</th>
            <th style={{ ...th, textAlign: 'right' }}>Int. pagado</th>
            <th style={{ ...th, textAlign: 'right' }}>Salarios</th>
            <th style={{ ...th, textAlign: 'right' }}>Deuda total</th>
            <th style={{ ...th, textAlign: 'right' }}>Aportes activos</th>
          </tr></thead>
          <tbody>
            {data.map(d => (
              <tr key={d.socio_id} style={{ borderBottom: '1px solid #2a3340' }}>
                <td style={{ ...td, fontWeight: 700, position: 'sticky', left: 0, background: '#1f2937' }}>{d.nombre}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(d.total_aportado)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#34d399' }}>{fmt(d.total_capital_repagado)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#fbbf24', fontWeight: 700 }}>{fmt(d.capital_pendiente)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#fca5a5' }}>{fmt(d.intereses_acumulados)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(d.intereses_pagados)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(d.total_salarios)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#f87171' }}>{fmt(d.deuda_total)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{d.aportes_activos}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid #374151', background: '#0f172a' }}>
              <td style={{ ...td, fontWeight: 800, color: '#fff', position: 'sticky', left: 0, background: '#0f172a' }}>TOTAL</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#fff' }}>{fmt(totales.aportado)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#34d399' }}>{fmt(totales.repagado)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#fbbf24' }}>{fmt(totales.pendiente)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#fca5a5' }}>{fmt(totales.int_acum)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{fmt(totales.int_pag)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{fmt(totales.salarios)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#f87171' }}>{fmt(totales.deuda)}</td>
              <td style={{ ...td }}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SubAportesFIFO() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroSocio, setFiltroSocio] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await fetchAll(db.from('v_socio_aportes_detalle').select('*').order('fecha_aporte', { ascending: false }))
      setData(all || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  const filtered = data.filter(a => !filtroSocio || a.socio_nombre === filtroSocio)
  const socios = [...new Set(data.map(a => a.socio_nombre))]

  return (
    <div>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={filtroSocio} onChange={e => setFiltroSocio(e.target.value)} style={{ ...inputSt, fontSize: 11 }}>
          <option value="">Todos los socios</option>
          {socios.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 11, color: '#888' }}>{filtered.length} aportes</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 24, textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div>No hay aportes registrados aún. Clasifica bank_tx en "Cola pendiente" para crear lotes.</div>
        </div>
      ) : (
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 900 }}>
            <thead><tr style={{ borderBottom: '2px solid #374151' }}>
              <th style={th}>Socio</th>
              <th style={th}>Fecha</th>
              <th style={{ ...th, textAlign: 'right' }}>Días</th>
              <th style={{ ...th, textAlign: 'right' }}>Monto</th>
              <th style={{ ...th, textAlign: 'right' }}>Repagado</th>
              <th style={{ ...th, textAlign: 'right' }}>Cap. pend</th>
              <th style={{ ...th, textAlign: 'right' }}>Int. acum</th>
              <th style={{ ...th, textAlign: 'right' }}>Int. pagado</th>
              <th style={{ ...th, textAlign: 'right' }}>Deuda total</th>
              <th style={th}>Estado</th>
              <th style={th}>Último corte</th>
            </tr></thead>
            <tbody>
              {filtered.map(a => {
                const dias = a.dias_antiguedad
                const venceCorte = dias >= 30
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid #2a3340' }}>
                    <td style={{ ...td, fontWeight: 700 }}>{a.socio_nombre}</td>
                    <td style={td}>{fmtDate(a.fecha_aporte)}</td>
                    <td style={{ ...td, textAlign: 'right', color: venceCorte ? '#fbbf24' : '#888' }}>{dias}d</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt(a.monto_original)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#34d399' }}>{fmt(a.capital_repagado)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#fbbf24' }}>{fmt(a.capital_pendiente)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#fca5a5' }}>{fmt(a.interes_acumulado)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt(a.interes_pagado)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#f87171' }}>{fmt(a.deuda_total)}</td>
                    <td style={td}>
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                        background: a.estado === 'liquidado' ? '#065f46' : '#7c2d12',
                        color: a.estado === 'liquidado' ? '#6ee7b7' : '#fdba74',
                      }}>{a.estado}</span>
                    </td>
                    <td style={{ ...td, fontSize: 10, color: '#888' }}>{a.fecha_ultimo_corte ? fmtDate(a.fecha_ultimo_corte) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SubPrestamos({ user, pushNotif }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await db.from('v_prestamos_estado').select('*').eq('activo', true).order('capital_pendiente', { ascending: false })
      setData(data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  const totales = data.reduce((acc, p) => ({
    original: acc.original + Number(p.monto_original || 0),
    pagado: acc.pagado + Number(p.capital_pagado || 0),
    pendiente: acc.pendiente + Number(p.capital_pendiente || 0),
    intereses: acc.intereses + Number(p.intereses_pagados_total || 0),
  }), { original: 0, pagado: 0, pendiente: 0, intereses: 0 })

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
        <KpiCard label="Préstamos activos" value={data.length} sub="instituciones" color="#a78bfa" />
        <KpiCard label="Capital pendiente" value={fmt(totales.pendiente)} sub={`de ${fmt(totales.original)} original`} color="#f87171" />
        <KpiCard label="Capital pagado" value={fmt(totales.pagado)} sub="acumulado" color="#34d399" />
        <KpiCard label="Intereses YTD" value={fmt(totales.intereses)} sub="pagados" color="#fbbf24" />
      </div>

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 10, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 800 }}>
          <thead><tr style={{ borderBottom: '2px solid #374151' }}>
            <th style={th}>Institución</th>
            <th style={th}>Tipo</th>
            <th style={th}>Origen</th>
            <th style={{ ...th, textAlign: 'right' }}>Monto orig</th>
            <th style={{ ...th, textAlign: 'right' }}>Cap. pagado</th>
            <th style={{ ...th, textAlign: 'right' }}>Cap. pendiente</th>
            <th style={{ ...th, textAlign: 'right' }}>Int. pagados</th>
            <th style={{ ...th, textAlign: 'right' }}>Movs</th>
            <th style={th}>Notas</th>
          </tr></thead>
          <tbody>
            {data.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #2a3340' }}>
                <td style={{ ...td, fontWeight: 700 }}>{p.institucion}</td>
                <td style={td}><span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: p.tipo === 'prestamo' ? '#1e40af' : '#7c2d12', color: '#fff' }}>{p.tipo}</span></td>
                <td style={{ ...td, fontSize: 10 }}>{fmtDate(p.fecha_origen)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(p.monto_original)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#34d399' }}>{fmt(p.capital_pagado)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#f87171' }}>{fmt(p.capital_pendiente)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#fbbf24' }}>{fmt(p.intereses_pagados_total)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{p.movimientos_count}</td>
                <td style={{ ...td, fontSize: 10, color: '#888', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.notas}>{p.notas || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: '#888', fontStyle: 'italic' }}>
        💡 Para registrar pagos a estos préstamos, ve al <b>Wizard</b>, selecciona la bank_tx del débito (ej: "PAGO INTERESES 406034530"), y usa "Acción → Pago a préstamo" — pendiente UI dedicada en el Wizard.
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// SHARED COMPONENTS / STYLES
// ═══════════════════════════════════════════════════════════
function DetailField({ label, value, mono, wide }) {
  return (
    <div style={{ gridColumn: wide ? 'span 2' : 'auto', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: 11, color: value ? '#d1d5db' : '#555',
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-word', whiteSpace: 'pre-wrap',
      }}>{value || '—'}</div>
    </div>
  )
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 14, border: `1px solid ${color}33` }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

const th = { textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }
const td = { padding: '6px 8px', color: '#d1d5db' }
const codeSt = { fontFamily: 'monospace', fontSize: 10, padding: '1px 4px', background: '#0f172a', borderRadius: 3, color: '#93c5fd' }
const labelSt = { fontSize: 11, color: '#888', display: 'block', marginBottom: 2, fontWeight: 600 }
const inputSt = { padding: '6px 10px', borderRadius: 6, border: '1px solid #374151', background: '#0f172a', color: '#fff', fontSize: 12 }
const btnSt = { padding: '8px 14px', borderRadius: 6, border: '1px solid #60a5fa', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontWeight: 700, fontSize: 12, cursor: 'pointer' }
const uploadBtn = (disabled, color) => ({
  padding: '10px 20px', borderRadius: 8,
  background: disabled ? '#374151' : `rgba(${color === '#60a5fa' ? '96,165,250' : color === '#34d399' ? '52,211,153' : '251,191,36'},0.15)`,
  border: `1px solid ${color}`, color: color, fontWeight: 700, fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-block',
})
