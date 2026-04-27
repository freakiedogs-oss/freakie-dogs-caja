import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { db } from '../../supabase'

// ─── Helpers ───────────────────────────────────────────────
const fmt = (n) => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const today = () => new Date().toISOString().slice(0, 10)
const fmtPct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—'

// fetchAll helper para tablas grandes (Supabase limit 1000)
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

function EstadoBadge({ estado }) {
  const s = ESTADO_COLOR[estado] || ESTADO_COLOR.sin_clasificar
  return <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: s.bg, color: s.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.label}</span>
}

const TABS = [
  { key: 'resumen', label: '📊 Resumen' },
  { key: 'importar', label: '📥 Importar' },
  { key: 'cola', label: '🔍 Cola Manual' },
  { key: 'reglas', label: '⚙️ Reglas' },
  { key: 'comprobantes', label: '📷 Comprobantes' },
  { key: 'auditoria', label: '📋 Auditoría' },
]

// ─── OCR: Tesseract.js lazy-load desde CDN ─────────────────
let _tesseractLoaded = false
async function loadTesseract() {
  if (_tesseractLoaded) return
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
  }
  _tesseractLoaded = true
}

// SHA-256 hash del archivo (idempotencia)
async function sha256File(file) {
  const buf = await file.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const MESES_MAP = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
}

// Parser regex para comprobantes de transferencia bancaria SV
function parseComprobante(text) {
  const out = {}
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Monto: "$1,234.56" o "USD 1,234.56" o "Monto debitado $..."
  const montoMatch = text.match(/(?:monto|total|valor|debitado)[:\s]*\$?\s*([\d,]+\.\d{2})/i)
    || text.match(/\$\s*([\d,]+\.\d{2})/)
    || text.match(/USD\s*([\d,]+\.\d{2})/i)
  if (montoMatch) out.monto = parseFloat(montoMatch[1].replace(/,/g, ''))

  // Fecha: "13 abril 2026", "13/04/2026", "13-04-2026"
  const fechaTexto = text.match(/(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\.?\s*(?:de\s+)?(\d{4})?/i)
  if (fechaTexto) {
    const day = fechaTexto[1].padStart(2, '0')
    const mon = MESES_MAP[fechaTexto[2].toLowerCase()] || '01'
    const year = fechaTexto[3] || new Date().getFullYear()
    out.fecha_extraida = `${year}-${mon}-${day}`
  } else {
    const fnum = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (fnum) {
      const d = fnum[1].padStart(2, '0'), m = fnum[2].padStart(2, '0')
      let y = fnum[3]
      if (y.length === 2) y = '20' + y
      out.fecha_extraida = `${y}-${m}-${d}`
    }
  }

  // Beneficiario: línea después de "A favor de", "Beneficiario", "Cuenta destino"
  const idxBenef = lines.findIndex(l => /(?:beneficiario|a favor de|cuenta destino|destinatario)/i.test(l))
  if (idxBenef >= 0) {
    for (let i = idxBenef + 1; i < Math.min(idxBenef + 4, lines.length); i++) {
      const cand = lines[i]
      if (cand && !/^\d+$/.test(cand.replace(/\s/g, '')) && cand.length > 3 && /[A-Za-z]/.test(cand)) {
        out.beneficiario = cand.replace(/[^A-Za-zÀ-ÿ0-9\s.,&\-]/g, '').trim().slice(0, 100)
        break
      }
    }
  }

  // Últimos 4 dígitos cuenta destino: "***1234", "...-1234", "20150045 1" última cifra final
  const u4 = text.match(/(?:cuenta|cta|account)[\s\S]{0,40}?(?:\*+|x+|\.+|-+)\s*(\d{4})/i)
    || text.match(/(?:cuenta|cta)[\s\S]{0,40}?(\d{10,})/i)
  if (u4) {
    const raw = u4[1]
    out.ultimos_4_digitos = raw.length >= 4 ? raw.slice(-4) : raw.padStart(4, '0')
  }

  // Banco origen
  const bancos = ['BAC', 'Agricola', 'Agrícola', 'Davivienda', 'Promerica', 'Cuscatlan', 'Cuscatlán', 'Banco Industrial', 'Hipotecario', 'Atlantida', 'Atlántida']
  for (const b of bancos) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(text)) { out.banco_origen = b; break }
  }

  // N° referencia
  const ref = text.match(/(?:referencia|comprobante|n[uúº]?mero|trans?accion)[:\s#]*(\d{6,})/i)
    || text.match(/\b(\d{8,12})\b/)
  if (ref) out.numero_referencia = ref[1]

  return out
}

async function ocrComprobante(file) {
  await loadTesseract()
  const { data: { text } } = await window.Tesseract.recognize(file, 'spa', { logger: () => {} })
  return { text, parsed: parseComprobante(text) }
}

const ESTADOS_CLASIFICAR = [
  { val: 'auto_match', label: 'Auto-match' },
  { val: 'match_manual', label: 'Manual' },
  { val: 'movimiento_socio', label: 'Socio' },
  { val: 'comision_bancaria', label: 'Comisión bancaria' },
  { val: 'transferencia_interna', label: 'Transferencia interna' },
  { val: 'sin_dte', label: 'Sin DTE (gasto sin factura)' },
  { val: 'ignorar', label: 'Ignorar' },
]

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function BancoView({ user }) {
  const [tab, setTab] = useState('resumen')

  // Acceso restringido
  const canAccess = ['ejecutivo', 'superadmin'].includes(user?.rol)
  if (!canAccess) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <div>Acceso restringido a ejecutivos</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 16px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>🏦 BancoView — Conciliación Bancaria</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>BAC #201500451 USD · Auto-match conservador + revisión manual</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 14px', borderRadius: 8,
              border: tab === t.key ? '2px solid #60a5fa' : '1px solid #444',
              background: tab === t.key ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: tab === t.key ? '#60a5fa' : '#aaa',
              fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <TabResumen />}
      {tab === 'importar' && <TabImportar />}
      {tab === 'cola' && <TabColaManual user={user} />}
      {tab === 'reglas' && <TabReglas />}
      {tab === 'comprobantes' && <TabComprobantes user={user} />}
      {tab === 'auditoria' && <TabAuditoria />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 6: COMPROBANTES — multi-upload + OCR Tesseract.js + auto-match
// ═══════════════════════════════════════════════════════════
function TabComprobantes({ user }) {
  const [comprobantes, setComprobantes] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, currentMsg: '' })
  const [lastBatch, setLastBatch] = useState(null) // { ok, dup, err, matched, sin_match }
  const fileInputRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await db.from('bank_comprobantes')
        .select('*, bank_transacciones:bank_transaccion_id(fecha,codigo_bac,descripcion,debito)')
        .order('created_at', { ascending: false })
        .limit(100)
      setComprobantes(data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return
    setProcessing(true)
    setProgress({ done: 0, total: files.length, currentMsg: 'Cargando OCR…' })
    let ok = 0, dup = 0, err = 0

    try {
      await loadTesseract()

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setProgress({ done: i, total: files.length, currentMsg: `Procesando ${file.name}…` })
        try {
          const hash = await sha256File(file)

          // Verificar duplicado por hash antes de subir
          const { data: existing } = await db.from('bank_comprobantes').select('id').eq('hash_imagen', hash).maybeSingle()
          if (existing) { dup++; continue }

          // OCR
          const { text, parsed } = await ocrComprobante(file)

          // Upload a storage
          const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
          const yyyy = (parsed.fecha_extraida || new Date().toISOString().slice(0,10)).slice(0,4)
          const mm = (parsed.fecha_extraida || new Date().toISOString().slice(0,10)).slice(5,7)
          const path = `${yyyy}/${mm}/${hash}.${ext}`
          const { error: upErr } = await db.storage.from('bank-comprobantes').upload(path, file, { upsert: true, contentType: file.type })
          if (upErr) throw upErr
          const { data: urlData } = db.storage.from('bank-comprobantes').getPublicUrl(path)

          // INSERT
          const { error: insErr } = await db.from('bank_comprobantes').insert({
            foto_url: urlData.publicUrl,
            storage_path: path,
            hash_imagen: hash,
            ocr_text: text.slice(0, 5000),
            ocr_data: parsed,
            monto: parsed.monto || null,
            fecha_extraida: parsed.fecha_extraida || null,
            beneficiario: parsed.beneficiario || null,
            ultimos_4_digitos: parsed.ultimos_4_digitos || null,
            banco_origen: parsed.banco_origen || null,
            numero_referencia: parsed.numero_referencia || null,
            uploaded_by: user?.nombre || user?.rol || 'unknown',
          })
          if (insErr) {
            if (insErr.code === '23505') { dup++; continue } // hash UNIQUE conflict
            throw insErr
          }
          ok++
        } catch (e) {
          console.error('Error procesando', file.name, e)
          err++
        }
      }

      // Después del batch: ejecutar matcher
      const { data: mres } = await db.rpc('bancoview_match_comprobantes')
      const matched = mres?.[0]?.matches_creados ?? 0
      const sin_match = mres?.[0]?.sin_match ?? 0

      setLastBatch({ ok, dup, err, matched, sin_match })
      await load()
    } finally {
      setProcessing(false)
      setProgress({ done: 0, total: 0, currentMsg: '' })
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  return (
    <>
      {/* Upload zone */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 20, marginBottom: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>📷 Subir comprobantes en lote</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 14, lineHeight: 1.5 }}>
          Selecciona varias imágenes desde tu galería o cámara. Cada imagen se procesa con OCR<br/>
          (Tesseract.js español) y se intenta vincular automáticamente a una transacción del banco.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={processing}
          style={{ display: 'none' }}
          id="bank-comp-upload"
        />
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={processing}
          style={{ display: 'none' }}
          id="bank-comp-camera"
        />
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <label htmlFor="bank-comp-upload" style={{
            padding: '10px 20px', borderRadius: 8,
            background: processing ? '#374151' : 'rgba(96,165,250,0.15)',
            border: '1px solid #60a5fa', color: '#60a5fa', fontWeight: 700, fontSize: 13,
            cursor: processing ? 'not-allowed' : 'pointer',
          }}>
            {processing ? '⏳ Procesando…' : '🖼️ Galería (multi)'}
          </label>
          <label htmlFor="bank-comp-camera" style={{
            padding: '10px 20px', borderRadius: 8,
            background: processing ? '#374151' : 'rgba(52,211,153,0.15)',
            border: '1px solid #34d399', color: '#34d399', fontWeight: 700, fontSize: 13,
            cursor: processing ? 'not-allowed' : 'pointer',
          }}>
            📷 Cámara
          </label>
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

      {/* Resultados último batch */}
      {lastBatch && (
        <div style={{ background: '#064e3b', border: '1px solid #065f46', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7', marginBottom: 6 }}>✅ Último batch procesado</div>
          <div style={{ fontSize: 11, color: '#a7f3d0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px,1fr))', gap: 8 }}>
            <div>📥 Subidos: <b style={{ color: '#fff' }}>{lastBatch.ok}</b></div>
            <div>⚠️ Duplicados: <b style={{ color: '#fcd34d' }}>{lastBatch.dup}</b></div>
            <div>❌ Errores: <b style={{ color: '#fca5a5' }}>{lastBatch.err}</b></div>
            <div>🔗 Auto-match: <b style={{ color: '#fff' }}>{lastBatch.matched}</b></div>
            <div>🔍 Sin match: <b style={{ color: '#fbbf24' }}>{lastBatch.sin_match}</b></div>
          </div>
        </div>
      )}

      {/* Lista de comprobantes */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Últimos {comprobantes.length} comprobantes</div>
        {comprobantes.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
            <div>Aún no hay comprobantes. Sube las capturas de tu galería arriba.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #374151' }}>
                  <th style={th}>Foto</th>
                  <th style={th}>Fecha</th>
                  <th style={{ ...th, textAlign: 'right' }}>Monto</th>
                  <th style={th}>Beneficiario</th>
                  <th style={th}>4 dig</th>
                  <th style={th}>Banco</th>
                  <th style={th}>Match</th>
                </tr>
              </thead>
              <tbody>
                {comprobantes.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #2a3340' }}>
                    <td style={td}>
                      <a href={c.foto_url} target="_blank" rel="noopener noreferrer">
                        <img src={c.foto_url} alt="comp" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid #374151' }} />
                      </a>
                    </td>
                    <td style={td}>{c.fecha_extraida ? fmtDate(c.fecha_extraida) : <span style={{ color: '#666' }}>—</span>}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{c.monto != null ? fmt(c.monto) : <span style={{ color: '#666' }}>—</span>}</td>
                    <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.beneficiario || <span style={{ color: '#666' }}>—</span>}</td>
                    <td style={td}><code style={codeSt}>{c.ultimos_4_digitos || '—'}</code></td>
                    <td style={td}>{c.banco_origen || <span style={{ color: '#666' }}>—</span>}</td>
                    <td style={td}>
                      {c.bank_transaccion_id ? (
                        <span style={{ color: '#34d399', fontWeight: 700 }}>✅ {c.match_metodo}</span>
                      ) : (
                        <span style={{ color: '#fbbf24' }}>⏳ sin match</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 1: RESUMEN — KPIs cobertura por mes
// ═══════════════════════════════════════════════════════════
function TabResumen() {
  const [data, setData] = useState({ porMes: [], topPendientes: [], totalKpis: null })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const txAll = await fetchAll(
        db.from('bank_transacciones').select('fecha, debito, credito, estado, codigo_bac, descripcion, id, contraparte_raw').order('fecha', { ascending: false })
      )

      // Agrupar por mes
      const mesMap = {}
      let totalFilas = 0, totalClasif = 0
      let totalMonto = 0, totalMontoClasif = 0
      for (const t of txAll) {
        const mes = (t.fecha || '').slice(0, 7)
        if (!mesMap[mes]) mesMap[mes] = { mes, total: 0, clasif: 0, monto: 0, montoClasif: 0 }
        mesMap[mes].total++
        const m = (Number(t.debito) || 0) + (Number(t.credito) || 0)
        mesMap[mes].monto += m
        totalFilas++
        totalMonto += m
        if (t.estado !== 'sin_clasificar') {
          mesMap[mes].clasif++
          mesMap[mes].montoClasif += m
          totalClasif++
          totalMontoClasif += m
        }
      }
      const porMes = Object.values(mesMap).sort((a, b) => b.mes.localeCompare(a.mes))

      // Top 10 sin_clasificar por monto
      const topPendientes = txAll
        .filter(t => t.estado === 'sin_clasificar')
        .map(t => ({ ...t, monto: (Number(t.debito) || 0) + (Number(t.credito) || 0) }))
        .sort((a, b) => b.monto - a.monto)
        .slice(0, 10)

      const totalKpis = {
        totalFilas, totalClasif, pctFilas: totalFilas ? (totalClasif * 100 / totalFilas) : 0,
        totalMonto, totalMontoClasif, pctMonto: totalMonto ? (totalMontoClasif * 100 / totalMonto) : 0,
      }
      setData({ porMes, topPendientes, totalKpis })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>
  const k = data.totalKpis || {}

  return (
    <>
      {/* KPIs globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Cobertura filas" value={fmtPct(k.pctFilas)} sub={`${k.totalClasif} de ${k.totalFilas}`} color="#60a5fa" />
        <KpiCard label="Cobertura monto" value={fmtPct(k.pctMonto)} sub={`${fmt(k.totalMontoClasif)} de ${fmt(k.totalMonto)}`} color="#34d399" />
        <KpiCard label="Pendientes" value={(k.totalFilas - k.totalClasif).toString()} sub={fmt(k.totalMonto - k.totalMontoClasif)} color="#fb7185" />
      </div>

      {/* Tabla por mes */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Cobertura por mes</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={th}>Mes</th>
                <th style={th}>Filas</th>
                <th style={th}>% Filas</th>
                <th style={th}>Monto</th>
                <th style={th}>% Monto</th>
              </tr>
            </thead>
            <tbody>
              {data.porMes.map(m => (
                <tr key={m.mes} style={{ borderBottom: '1px solid #2a3340' }}>
                  <td style={td}>{m.mes}</td>
                  <td style={td}>{m.clasif} / {m.total}</td>
                  <td style={{ ...td, color: m.clasif === m.total ? '#34d399' : (m.clasif / m.total > 0.7 ? '#fbbf24' : '#fb7185') }}>
                    {fmtPct(m.total ? m.clasif * 100 / m.total : 0)}
                  </td>
                  <td style={td}>{fmt(m.montoClasif)} / {fmt(m.monto)}</td>
                  <td style={td}>{fmtPct(m.monto ? m.montoClasif * 100 / m.monto : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top 10 pendientes */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Top 10 sin clasificar (por monto)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={th}>Fecha</th>
                <th style={th}>Cód</th>
                <th style={th}>Descripción</th>
                <th style={{ ...th, textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {data.topPendientes.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid #2a3340' }}>
                  <td style={td}>{fmtDate(t.fecha)}</td>
                  <td style={td}><code style={codeSt}>{t.codigo_bac}</code></td>
                  <td style={{ ...td, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.descripcion}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(t.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 2: IMPORTAR — placeholder con instrucciones
// ═══════════════════════════════════════════════════════════
function TabImportar() {
  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 24, textAlign: 'center', color: '#aaa' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📥</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Importar estado de cuenta BAC</div>
      <div style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
        Por ahora la carga se hace desde el script Python <code style={codeSt}>parse_bac_q1.py</code>.<br/>
        Subir archivo desde la PWA estará disponible en una próxima iteración.
      </div>
      <div style={{ fontSize: 12, color: '#888', textAlign: 'left', maxWidth: 500, margin: '0 auto', background: '#0f172a', padding: 14, borderRadius: 6 }}>
        <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: 6 }}>Mientras tanto:</div>
        1. Descarga el estado de cuenta del BAC en formato Excel (.xls)<br/>
        2. Mándalo a tu equipo de tech para procesarlo<br/>
        3. Re-ejecutar <code style={codeSt}>bancoview_aplicar_reglas()</code> en tab Reglas
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 3: COLA MANUAL — sin_clasificar con filtros y bulk actions
// ═══════════════════════════════════════════════════════════
function TabColaManual({ user }) {
  const [tx, setTx] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroMes, setFiltroMes] = useState('todos')
  const [filtroCodigo, setFiltroCodigo] = useState('todos')
  const [seleccion, setSeleccion] = useState(new Set())
  const [bulkEstado, setBulkEstado] = useState('match_manual')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAll(
        db.from('bank_transacciones').select('*').eq('estado', 'sin_clasificar').order('fecha', { ascending: false })
      )
      setTx(data)
      setSeleccion(new Set())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const meses = useMemo(() => {
    const s = new Set(tx.map(t => (t.fecha || '').slice(0, 7)))
    return ['todos', ...Array.from(s).sort().reverse()]
  }, [tx])

  const codigos = useMemo(() => {
    const s = new Set(tx.map(t => t.codigo_bac).filter(Boolean))
    return ['todos', ...Array.from(s).sort()]
  }, [tx])

  const filtrados = tx.filter(t =>
    (filtroMes === 'todos' || (t.fecha || '').startsWith(filtroMes)) &&
    (filtroCodigo === 'todos' || t.codigo_bac === filtroCodigo)
  ).sort((a, b) => ((Number(b.debito) || 0) + (Number(b.credito) || 0)) - ((Number(a.debito) || 0) + (Number(a.credito) || 0)))

  const toggleSel = (id) => {
    const ns = new Set(seleccion)
    if (ns.has(id)) ns.delete(id); else ns.add(id)
    setSeleccion(ns)
  }
  const toggleSelAll = () => {
    if (seleccion.size === filtrados.length) setSeleccion(new Set())
    else setSeleccion(new Set(filtrados.map(t => t.id)))
  }

  const aplicarBulk = async () => {
    if (seleccion.size === 0) return alert('Selecciona al menos una transacción')
    if (!confirm(`Marcar ${seleccion.size} transacciones como "${bulkEstado}"?`)) return
    try {
      const { error } = await db.from('bank_transacciones')
        .update({ estado: bulkEstado, notas: `[manual:${user?.rol || 'user'}_${today()}]` })
        .in('id', Array.from(seleccion))
      if (error) throw error
      await load()
      alert(`✅ ${seleccion.size} transacciones actualizadas`)
    } catch (e) { alert('Error: ' + e.message) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  return (
    <>
      {/* Filtros + bulk */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={labelSt}>Mes</div>
          <select value={filtroMes} onChange={e => setFiltroMes(e.target.value)} style={inputSt}>
            {meses.map(m => <option key={m} value={m}>{m === 'todos' ? 'Todos' : m}</option>)}
          </select>
        </div>
        <div>
          <div style={labelSt}>Código</div>
          <select value={filtroCodigo} onChange={e => setFiltroCodigo(e.target.value)} style={inputSt}>
            {codigos.map(c => <option key={c} value={c}>{c === 'todos' ? 'Todos' : c}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <div>
            <div style={labelSt}>Marcar selección como</div>
            <select value={bulkEstado} onChange={e => setBulkEstado(e.target.value)} style={inputSt}>
              {ESTADOS_CLASIFICAR.map(e => <option key={e.val} value={e.val}>{e.label}</option>)}
            </select>
          </div>
          <button onClick={aplicarBulk} disabled={seleccion.size === 0} style={{ ...btnSt, opacity: seleccion.size === 0 ? 0.5 : 1 }}>
            Aplicar ({seleccion.size})
          </button>
        </div>
      </div>

      {/* Stats filtro actual */}
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
        {filtrados.length} transacciones · suma: {fmt(filtrados.reduce((s, t) => s + (Number(t.debito) || 0) + (Number(t.credito) || 0), 0))}
      </div>

      {/* Tabla */}
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 8, overflow: 'auto', maxHeight: '60vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#1f2937', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={{ ...th, width: 30 }}>
                <input type="checkbox" checked={seleccion.size === filtrados.length && filtrados.length > 0} onChange={toggleSelAll} />
              </th>
              <th style={th}>Fecha</th>
              <th style={th}>Cód</th>
              <th style={th}>Descripción</th>
              <th style={{ ...th, textAlign: 'right' }}>Débito</th>
              <th style={{ ...th, textAlign: 'right' }}>Crédito</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0, 200).map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid #2a3340', cursor: 'pointer', background: seleccion.has(t.id) ? 'rgba(96,165,250,0.06)' : 'transparent' }}
                  onClick={() => toggleSel(t.id)}>
                <td style={td}><input type="checkbox" checked={seleccion.has(t.id)} onChange={() => toggleSel(t.id)} onClick={e => e.stopPropagation()} /></td>
                <td style={td}>{fmtDate(t.fecha)}</td>
                <td style={td}><code style={codeSt}>{t.codigo_bac}</code></td>
                <td style={{ ...td, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.descripcion}</td>
                <td style={{ ...td, textAlign: 'right', color: Number(t.debito) > 0 ? '#fb7185' : '#666' }}>{Number(t.debito) > 0 ? fmt(t.debito) : '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: Number(t.credito) > 0 ? '#34d399' : '#666' }}>{Number(t.credito) > 0 ? fmt(t.credito) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > 200 && (
          <div style={{ padding: 12, textAlign: 'center', color: '#888', fontSize: 11 }}>Mostrando 200 de {filtrados.length}. Filtra para ver más.</div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 4: REGLAS — listar + ejecutar motor
// ═══════════════════════════════════════════════════════════
function TabReglas() {
  const [reglas, setReglas] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await db.from('bank_reglas_clasificacion').select('*').order('prioridad', { ascending: true })
      setReglas(data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const ejecutar = async () => {
    if (!confirm('Ejecutar motor de matching ahora? Solo afecta transacciones sin_clasificar.')) return
    setRunning(true)
    try {
      const { data, error } = await db.rpc('bancoview_aplicar_reglas')
      if (error) throw error
      setLastRun(data || [])
      await load()
    } catch (e) { alert('Error: ' + e.message) }
    finally { setRunning(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  return (
    <>
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={ejecutar} disabled={running} style={{ ...btnSt, opacity: running ? 0.5 : 1 }}>
          {running ? '⏳ Ejecutando…' : '▶️ Aplicar reglas ahora'}
        </button>
        <div style={{ fontSize: 11, color: '#888' }}>
          Idempotente: solo procesa transacciones con estado <code style={codeSt}>sin_clasificar</code>.
        </div>
      </div>

      {lastRun && (
        <div style={{ background: '#064e3b', border: '1px solid #065f46', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7', marginBottom: 6 }}>✅ Última corrida</div>
          <table style={{ width: '100%', fontSize: 11 }}>
            <tbody>
              {lastRun.map(r => (
                <tr key={r.regla_id}>
                  <td style={{ padding: '2px 6px', color: '#a7f3d0' }}>{r.regla_nombre}</td>
                  <td style={{ padding: '2px 6px', textAlign: 'right', color: '#fff', fontWeight: 700 }}>{r.transacciones_afectadas} tx</td>
                  <td style={{ padding: '2px 6px', textAlign: 'right', color: '#a7f3d0' }}>{r.matches_creados} matches</td>
                  <td style={{ padding: '2px 6px', textAlign: 'right', color: '#a7f3d0' }}>{fmt(r.monto_afectado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Reglas activas ({reglas.length})</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={{ ...th, width: 50 }}>Pri</th>
              <th style={th}>Nombre</th>
              <th style={th}>Activa</th>
              <th style={{ ...th, textAlign: 'right' }}>Hits</th>
              <th style={th}>Última</th>
            </tr>
          </thead>
          <tbody>
            {reglas.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #2a3340' }}>
                <td style={td}>{r.prioridad}</td>
                <td style={td}>{r.nombre}</td>
                <td style={td}>{r.activa ? <span style={{ color: '#34d399' }}>●</span> : <span style={{ color: '#666' }}>○</span>}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{r.hits}</td>
                <td style={{ ...td, color: '#888' }}>{r.last_hit_at ? new Date(r.last_hit_at).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 5: AUDITORÍA — bank_match
// ═══════════════════════════════════════════════════════════
function TabAuditoria() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await db.from('bank_match')
        .select('*, bank_transacciones:bank_transaccion_id(fecha, codigo_bac, descripcion, debito, credito)')
        .order('created_at', { ascending: false })
        .limit(200)
      setMatches(data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const undo = async (id) => {
    if (!confirm('Eliminar este match? La transacción volverá a sin_clasificar.')) return
    try {
      const { error: delErr } = await db.from('bank_match').delete().eq('id', id)
      if (delErr) throw delErr
      await load()
    } catch (e) { alert('Error: ' + e.message) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Cargando…</div>

  if (matches.length === 0) {
    return (
      <div style={{ background: '#1f2937', borderRadius: 8, padding: 24, textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
        <div>Aún no hay bank_match registrados.</div>
        <div style={{ fontSize: 11, marginTop: 6 }}>Los matches se crean cuando hay coincidencia única monto+fecha contra <code style={codeSt}>pagos_proveedor</code> o suma exacta de planilla.</div>
      </div>
    )
  }

  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Últimos {matches.length} matches</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #374151' }}>
            <th style={th}>Fecha tx</th>
            <th style={th}>Cód</th>
            <th style={th}>Descripción</th>
            <th style={th}>Target</th>
            <th style={{ ...th, textAlign: 'right' }}>Monto</th>
            <th style={th}>Confianza</th>
            <th style={th}>Método</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {matches.map(m => {
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
                <td style={td}>
                  <button onClick={() => undo(m.id)} style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', cursor: 'pointer' }}>Undo</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// SHARED COMPONENTS / STYLES
// ═══════════════════════════════════════════════════════════
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
