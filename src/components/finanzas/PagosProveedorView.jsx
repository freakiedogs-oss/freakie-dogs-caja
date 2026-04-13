import { useState, useEffect, useCallback, useRef } from 'react'
import { db, URL_SB, KEY_SB } from '../../supabase'

// ─── Helpers ───────────────────────────────────────────────
const fmt = (n) => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const today = () => new Date().toISOString().slice(0, 10)
const daysDiff = (d) => d ? Math.floor((new Date(d) - new Date(today())) / 86400000) : null

const BADGE = {
  pagado: { bg: '#065f46', color: '#6ee7b7', label: 'Pagado' },
  parcial: { bg: '#92400e', color: '#fcd34d', label: 'Parcial' },
  pendiente: { bg: '#7f1d1d', color: '#fca5a5', label: 'Pendiente' },
  conciliado: { bg: '#065f46', color: '#6ee7b7', label: 'Conciliado' },
}

function Badge({ status }) {
  const s = BADGE[status] || BADGE.pendiente
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: s.bg, color: s.color, fontWeight: 700 }}>{s.label}</span>
}

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

// Meses en español para parsear fechas BAC
const MESES_MAP = {
  'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
  'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
  'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12',
  'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04',
  'may': '05', 'jun': '06', 'jul': '07', 'ago': '08',
  'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12',
}

function parseBAC(text) {
  const result = {}
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Proveedor: línea después de "Cuenta destino" (nombre empresa)
  const idxDest = lines.findIndex(l => /cuenta\s*destino/i.test(l))
  if (idxDest >= 0) {
    // Siguiente línea no-numérica después de "Cuenta destino"
    for (let i = idxDest + 1; i < Math.min(idxDest + 3, lines.length); i++) {
      if (lines[i] && !/^\d+$/.test(lines[i].replace(/\s/g, '')) && !/cuenta/i.test(lines[i])) {
        result.proveedor_nombre = lines[i].replace(/[^A-Za-zÀ-ÿ\s.,&\-]/g, '').trim()
        break
      }
    }
  }

  // Monto: "Monto debitado" o "$XXX.XX" o "Monto  $350.00"
  const montoMatch = text.match(/monto\s*(?:debitado)?\s*\$?\s*([\d,]+\.?\d*)/i)
    || text.match(/\$([\d,]+\.\d{2})/i)
  if (montoMatch) {
    result.monto = montoMatch[1].replace(/,/g, '')
  }

  // Fecha: "13 abril", "13 abr 2026", "13/04/2026"
  const fechaMatch = text.match(/(\d{1,2})\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\.?\s*(\d{4})?/i)
  if (fechaMatch) {
    const day = fechaMatch[1].padStart(2, '0')
    const mon = MESES_MAP[fechaMatch[2].toLowerCase()] || '01'
    const year = fechaMatch[3] || new Date().getFullYear()
    result.fecha_pago = `${year}-${mon}-${day}`
  } else {
    const fechaNum = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
    if (fechaNum) result.fecha_pago = `${fechaNum[3]}-${fechaNum[2].padStart(2,'0')}-${fechaNum[1].padStart(2,'0')}`
  }

  // N° comprobante: número largo (8+ dígitos) después de "comprobante"
  const compMatch = text.match(/comprobante\s*[:\s]*(\d{6,})/i)
    || text.match(/\b(\d{8,12})\b/)
  if (compMatch) result.referencia_bancaria = compMatch[1]

  // CCF / DTE: "CCF 2347" o "CCF-2347" o "DTE 2347"
  const ccfMatches = text.match(/(?:CCF|DTE|CRF)[\s\-#]*(\d{3,6})/gi)
  if (ccfMatches) {
    const codes = ccfMatches.map(m => {
      const n = m.match(/(\d{3,6})/)
      return n ? n[1].slice(-4) : null
    }).filter(Boolean)
    if (codes.length) result.dtes_input = codes.join(', ')
  }

  // Descripción completa como nota si incluye "CCF" o texto útil
  const descIdx = lines.findIndex(l => /descripci[oó]n/i.test(l))
  if (descIdx >= 0 && lines[descIdx + 1]) {
    result.descripcion_raw = lines[descIdx + 1]
  }

  return result
}

async function ocrParseImage(file) {
  await loadTesseract()
  const { data: { text } } = await window.Tesseract.recognize(file, 'spa', {
    logger: () => {},
  })
  return parseBAC(text)
}

// ─── Storage upload helper ─────────────────────────────────
async function uploadFile(file) {
  const ext = file.name.split('.').pop()
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await db.storage.from('pagos-comprobantes').upload(path, file, { contentType: file.type })
  if (error) throw error
  return `${URL_SB}/storage/v1/object/public/pagos-comprobantes/${path}`
}

// ─── Fetch all (paginado) ──────────────────────────────────
async function fetchAll(table, query) {
  const PAGE = 1000
  let all = [], offset = 0, done = false
  while (!done) {
    const q = query ? query.range(offset, offset + PAGE - 1) : db.from(table).select('*').range(offset, offset + PAGE - 1)
    const { data, error } = await q
    if (error) throw error
    all = all.concat(data || [])
    done = !data || data.length < PAGE
    offset += PAGE
  }
  return all
}

// ═══════════════════════════════════════════════════════════
// TAB 1: SUBIR PAGOS
// ═══════════════════════════════════════════════════════════
function SubirPagos({ user, proveedores, onSaved }) {
  const [entries, setEntries] = useState([])
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  // Add files from input or drop — auto-OCR each one
  const addFiles = (files) => {
    const newEntries = Array.from(files).map(f => ({
      file: f,
      preview: URL.createObjectURL(f),
      proveedor_nombre: '',
      monto: '',
      fecha_pago: today(),
      referencia_bancaria: '',
      dtes_input: '',
      notas: '',
      metodo_pago: 'transferencia',
      ocr_status: 'scanning', // scanning | done | error
    }))
    setEntries(prev => {
      const startIdx = prev.length
      // Launch OCR for each new file
      newEntries.forEach((entry, j) => {
        ocrParseImage(entry.file).then(parsed => {
          setEntries(cur => cur.map((e, idx) => {
            if (idx !== startIdx + j) return e
            return {
              ...e,
              proveedor_nombre: parsed.proveedor_nombre || e.proveedor_nombre,
              monto: parsed.monto || e.monto,
              fecha_pago: parsed.fecha_pago || e.fecha_pago,
              referencia_bancaria: parsed.referencia_bancaria || e.referencia_bancaria,
              dtes_input: parsed.dtes_input || e.dtes_input,
              ocr_status: 'done',
            }
          }))
        }).catch(() => {
          setEntries(cur => cur.map((e, idx) => idx === startIdx + j ? { ...e, ocr_status: 'error' } : e))
        })
      })
      return [...prev, ...newEntries]
    })
  }

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }
  const updateEntry = (i, field, val) => setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e))
  const removeEntry = (i) => setEntries(prev => { URL.revokeObjectURL(prev[i].preview); return prev.filter((_, idx) => idx !== i) })

  // Match DTEs by last N digits of numero_control (fuzzy, no proveedor filter)
  const matchDTEs = async (digits4, provNombre) => {
    if (!digits4 || digits4.length < 3) return []
    const codes = digits4.split(/[,;\s]+/).map(c => c.trim()).filter(Boolean)
    const results = []
    for (const code of codes) {
      // Search by numero_control only — more reliable than OCR proveedor name
      const { data } = await db.from('compras_dte')
        .select('id, numero_control, monto_total, fecha_emision, estado_pago, proveedor_nombre')
        .like('numero_control', `%${code}`)
        .neq('estado_pago', 'pagado')
        .order('fecha_emision', { ascending: false })
        .limit(10)
      if (data) results.push(...data)
    }
    // Deduplicate
    const unique = [...new Map(results.map(r => [r.id, r])).values()]
    // Score: prefer matches where proveedor partially matches OCR text
    const provFirst = (provNombre || '').split(/[\s,]+/)[0]?.toLowerCase() || ''
    if (provFirst.length >= 3) {
      unique.sort((a, b) => {
        const aMatch = a.proveedor_nombre?.toLowerCase().includes(provFirst) ? 1 : 0
        const bMatch = b.proveedor_nombre?.toLowerCase().includes(provFirst) ? 1 : 0
        return bMatch - aMatch // proveedor matches first
      })
    }
    return unique
  }

  // Save all entries
  const saveAll = async () => {
    if (entries.length === 0) return
    setSaving(true)
    try {
      for (const entry of entries) {
        // 1) Upload image
        const url = await uploadFile(entry.file)

        // 2) Insert pago
        const { data: pago, error: pErr } = await db.from('pagos_proveedor').insert({
          fecha_pago: entry.fecha_pago,
          proveedor_nombre: entry.proveedor_nombre,
          monto: parseFloat(entry.monto) || 0,
          metodo_pago: entry.metodo_pago,
          referencia_bancaria: entry.referencia_bancaria,
          banco: 'BAC',
          foto_urls: [url],
          notas: entry.notas,
          created_by: user.id,
        }).select().single()
        if (pErr) throw pErr

        // 3) Try auto-matching DTEs by last digits
        if (entry.dtes_input) {
          const allMatches = await matchDTEs(entry.dtes_input, entry.proveedor_nombre)
          const montoTotal = parseFloat(entry.monto) || 0

          // Per CCF code entered, find best match
          const codes = entry.dtes_input.split(/[,;\s]+/).map(c => c.trim()).filter(Boolean)
          const toApply = []

          for (const code of codes) {
            // Find matches for this specific code
            const codeMatches = allMatches.filter(m => m.numero_control?.endsWith(code))

            if (codeMatches.length === 1 && Math.abs(Number(codeMatches[0].monto_total) - montoTotal) < 0.50) {
              // Unique match + monto coincide → apply
              toApply.push(codeMatches[0])
            } else if (codeMatches.length > 1) {
              // Multiple matches: only auto-apply if one has exact monto
              const exactMonto = codeMatches.find(m => Math.abs(Number(m.monto_total) - montoTotal) < 0.50)
              if (exactMonto) toApply.push(exactMonto)
              // Otherwise → pendiente, user resolves manually
            }
            // 0 matches or no monto match → pendiente
          }

          if (toApply.length > 0) {
            // Distribute monto across matched DTEs
            const perDTE = toApply.length > 1 ? montoTotal / toApply.length : montoTotal
            const apps = toApply.map(m => ({
              pago_id: pago.id,
              compras_dte_id: m.id,
              monto_aplicado: Math.min(perDTE, Number(m.monto_total)),
            }))
            await db.from('pagos_proveedor_aplicacion').insert(apps)
          }
        }
      }
      // Refresh MATVIEW
      await db.rpc('refresh_cxp')
      entries.forEach(e => URL.revokeObjectURL(e.preview))
      setEntries([])
      onSaved()
    } catch (err) {
      alert('Error guardando: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Proveedor autocomplete
  const provList = [...new Set(proveedores.map(p => p.proveedor_nombre))].sort()

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#4ade80' : '#555'}`,
          borderRadius: 12,
          padding: '32px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.03)',
          marginBottom: 16,
          transition: 'all 0.2s',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#ccc' }}>
          Arrastrá capturas aquí o tocá para seleccionar
        </div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          Podés subir varias a la vez
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Entry cards */}
      {entries.map((entry, i) => (
        <div key={i} className="card" style={{ marginBottom: 12, padding: 12, position: 'relative' }}>
          <button onClick={() => removeEntry(i)} style={{
            position: 'absolute', top: 8, right: 8, background: '#7f1d1d', border: 'none',
            color: '#fca5a5', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12,
          }}>✕</button>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Thumbnail + OCR status */}
            <div style={{ position: 'relative', width: 100 }}>
              <img src={entry.preview} alt="comprobante" style={{
                width: 100, height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid #333',
                cursor: 'pointer',
              }} onClick={() => window.open(entry.preview, '_blank')} />
              {entry.ocr_status === 'scanning' && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'rgba(37,99,235,0.85)', color: '#fff', fontSize: 10,
                  textAlign: 'center', padding: '3px 0', borderRadius: '0 0 8px 8px',
                  fontWeight: 700, animation: 'pulse 1.5s infinite',
                }}>🔍 Leyendo...</div>
              )}
              {entry.ocr_status === 'done' && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'rgba(22,163,106,0.85)', color: '#fff', fontSize: 10,
                  textAlign: 'center', padding: '3px 0', borderRadius: '0 0 8px 8px',
                  fontWeight: 700,
                }}>✅ Leído</div>
              )}
              {entry.ocr_status === 'error' && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'rgba(220,38,38,0.85)', color: '#fff', fontSize: 10,
                  textAlign: 'center', padding: '3px 0', borderRadius: '0 0 8px 8px',
                  fontWeight: 700,
                }}>⚠️ Manual</div>
              )}
            </div>

            {/* Fields */}
            <div style={{ flex: 1, minWidth: 200, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Proveedor */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>Proveedor</label>
                <input
                  list={`prov-list-${i}`}
                  value={entry.proveedor_nombre}
                  onChange={(e) => updateEntry(i, 'proveedor_nombre', e.target.value)}
                  placeholder="Nombre proveedor"
                  style={inputSt}
                />
                <datalist id={`prov-list-${i}`}>
                  {provList.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>

              {/* Monto */}
              <div>
                <label style={labelSt}>Monto $</label>
                <input
                  type="number" step="0.01"
                  value={entry.monto}
                  onChange={(e) => updateEntry(i, 'monto', e.target.value)}
                  placeholder="350.00"
                  style={inputSt}
                />
              </div>

              {/* Fecha */}
              <div>
                <label style={labelSt}>Fecha pago</label>
                <input type="date" value={entry.fecha_pago}
                  onChange={(e) => updateEntry(i, 'fecha_pago', e.target.value)}
                  style={inputSt}
                />
              </div>

              {/* Referencia bancaria */}
              <div>
                <label style={labelSt}>N° comprobante</label>
                <input
                  value={entry.referencia_bancaria}
                  onChange={(e) => updateEntry(i, 'referencia_bancaria', e.target.value)}
                  placeholder="205498567"
                  style={inputSt}
                />
              </div>

              {/* Método pago */}
              <div>
                <label style={labelSt}>Método</label>
                <select value={entry.metodo_pago} onChange={(e) => updateEntry(i, 'metodo_pago', e.target.value)} style={inputSt}>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="otro">Otro</option>
                </select>
              </div>

              {/* DTEs input */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>CCFs/DTEs (últimos 4 dígitos, separados por coma)</label>
                <input
                  value={entry.dtes_input}
                  onChange={(e) => updateEntry(i, 'dtes_input', e.target.value)}
                  placeholder="2347, 2348"
                  style={inputSt}
                />
              </div>

              {/* Notas */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>Notas</label>
                <input
                  value={entry.notas}
                  onChange={(e) => updateEntry(i, 'notas', e.target.value)}
                  placeholder="Pago quincenal, etc."
                  style={inputSt}
                />
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Save button */}
      {entries.length > 0 && (
        <button onClick={saveAll} disabled={saving} style={{
          width: '100%', padding: 14, borderRadius: 10,
          background: saving ? '#555' : '#16a34a', color: '#fff',
          fontWeight: 800, fontSize: 15, border: 'none', cursor: saving ? 'wait' : 'pointer',
          marginTop: 8,
        }}>
          {saving ? '⏳ Guardando...' : `✅ Registrar ${entries.length} pago${entries.length > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 2: PENDIENTES DE CONCILIAR
// ═══════════════════════════════════════════════════════════
function PendientesConciliar({ pagos, onRefresh }) {
  const pendientes = pagos.filter(p => p.estado !== 'conciliado')
  const [expandedId, setExpandedId] = useState(null)
  const [matchInput, setMatchInput] = useState('')
  const [matchResults, setMatchResults] = useState([])
  const [searching, setSearching] = useState(false)

  const searchDTEs = async (pagoId, provNombre) => {
    if (!matchInput.trim()) return
    setSearching(true)
    const codes = matchInput.split(/[,;\s]+/).filter(Boolean)
    const results = []
    for (const code of codes) {
      const { data } = await db.from('compras_dte')
        .select('id, numero_control, monto_total, fecha_emision, estado_pago, proveedor_nombre')
        .or(`numero_control.like.%${code},proveedor_nombre.ilike.%${provNombre.split(' ')[0]}%`)
        .like('numero_control', `%${code}`)
        .limit(10)
      if (data) results.push(...data)
    }
    // Deduplicate
    const unique = [...new Map(results.map(r => [r.id, r])).values()]
    setMatchResults(unique)
    setSearching(false)
  }

  const applyMatch = async (pagoId, dteId, monto) => {
    const { error } = await db.from('pagos_proveedor_aplicacion').insert({
      pago_id: pagoId,
      compras_dte_id: dteId,
      monto_aplicado: monto,
    })
    if (error) { alert(error.message); return }
    await db.rpc('refresh_cxp')
    setMatchResults(prev => prev.filter(r => r.id !== dteId))
    onRefresh()
  }

  if (pendientes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Todo conciliado</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>No hay pagos pendientes de asignar</div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
        {pendientes.length} pago{pendientes.length > 1 ? 's' : ''} sin conciliar completamente
      </div>

      {pendientes.map(p => (
        <div key={p.id} className="card" style={{ marginBottom: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.proveedor_nombre}</div>
              <div style={{ fontSize: 12, color: '#aaa' }}>
                {fmtDate(p.fecha_pago)} · {fmt(p.monto)} · Ref: {p.referencia_bancaria || '—'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge status={p.estado} />
              {p.foto_urls?.[0] && (
                <img
                  src={p.foto_urls[0]} alt="comp"
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #444' }}
                  onClick={() => window.open(p.foto_urls[0], '_blank')}
                />
              )}
              <button onClick={() => { setExpandedId(expandedId === p.id ? null : p.id); setMatchResults([]); setMatchInput('') }}
                style={{ background: 'none', border: '1px solid #555', color: '#aaa', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                {expandedId === p.id ? '▲' : '🔗 Asignar'}
              </button>
            </div>
          </div>

          {/* Existing applications */}
          {p.aplicaciones && p.aplicaciones.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #333' }}>
              {p.aplicaciones.map(a => (
                <div key={a.id} style={{ fontSize: 12, color: '#aaa', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>🔗 {a.compras_dte?.numero_control?.slice(-10) || 'Sin DTE'}</span>
                  <span>{fmt(a.monto_aplicado)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Expanded: search & assign */}
          {expandedId === p.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #333' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={matchInput}
                  onChange={(e) => setMatchInput(e.target.value)}
                  placeholder="Últimos 4 dígitos del CCF..."
                  style={{ ...inputSt, flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && searchDTEs(p.id, p.proveedor_nombre)}
                />
                <button onClick={() => searchDTEs(p.id, p.proveedor_nombre)} disabled={searching}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  {searching ? '...' : '🔍'}
                </button>
              </div>

              {matchResults.length > 0 && (
                <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 8 }}>
                  {matchResults.map(m => (
                    <div key={m.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 4px', borderBottom: '1px solid #333', fontSize: 12,
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, color: '#ddd' }}>{m.numero_control?.slice(-12)}</div>
                        <div style={{ color: '#888' }}>{m.proveedor_nombre} · {fmtDate(m.fecha_emision)} · {fmt(m.monto_total)}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Badge status={m.estado_pago} />
                        <button onClick={() => applyMatch(p.id, m.id, m.monto_total)}
                          style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}>
                          ✓ Aplicar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {matchResults.length === 0 && matchInput && !searching && (
                <div style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: 12 }}>
                  Sin resultados. Probá otros dígitos.
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB 3: CUENTAS POR PAGAR
// ═══════════════════════════════════════════════════════════
function CuentasPorPagar({ cxp, onRefresh }) {
  const [expandedProv, setExpandedProv] = useState(null)
  const [detalle, setDetalle] = useState([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  const totalPendiente = cxp.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0)
  const totalVencido = cxp.reduce((s, c) => s + Number(c.monto_vencido || 0), 0)
  const provConVencidos = cxp.filter(c => c.facturas_vencidas > 0).length

  const loadDetalle = async (provNombre) => {
    if (expandedProv === provNombre) { setExpandedProv(null); return }
    setExpandedProv(provNombre)
    setLoadingDetail(true)
    const { data } = await db.from('compras_dte')
      .select('id, numero_control, monto_total, total_pagado, estado_pago, fecha_emision, fecha_vencimiento')
      .eq('proveedor_nombre', provNombre)
      .neq('estado_pago', 'pagado')
      .order('fecha_emision', { ascending: true })
      .limit(100)
    setDetalle(data || [])
    setLoadingDetail(false)
  }

  const agingBucket = (d) => {
    const diff = daysDiff(d)
    if (diff === null) return { label: 'Sin plazo', color: '#888' }
    if (diff >= 0) return { label: `${diff}d restante`, color: '#4ade80' }
    if (diff >= -30) return { label: `${Math.abs(diff)}d vencido`, color: '#fbbf24' }
    if (diff >= -60) return { label: `${Math.abs(diff)}d vencido`, color: '#f97316' }
    return { label: `${Math.abs(diff)}d vencido`, color: '#ef4444' }
  }

  return (
    <div>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <div className="card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Total por pagar</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#60a5fa' }}>{fmt(totalPendiente)}</div>
        </div>
        <div className="card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Monto vencido</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{fmt(totalVencido)}</div>
        </div>
        <div className="card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Proveedores</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24' }}>
            {provConVencidos > 0 ? `${provConVencidos} ⚠️` : cxp.length}
          </div>
          <div style={{ fontSize: 10, color: '#888' }}>{cxp.length} con saldo</div>
        </div>
      </div>

      {/* Supplier list */}
      {cxp.map(c => {
        const vencido = Number(c.monto_vencido) > 0
        const isExpanded = expandedProv === c.proveedor_nombre
        return (
          <div key={c.proveedor_nombre} className="card" style={{
            marginBottom: 8, padding: 12,
            borderLeft: `3px solid ${vencido ? '#ef4444' : '#333'}`,
          }}>
            <div
              onClick={() => loadDetalle(c.proveedor_nombre)}
              style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.proveedor_nombre}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {c.facturas_pendientes} factura{c.facturas_pendientes > 1 ? 's' : ''} ·
                  {c.proximo_vencimiento ? ` Próx: ${fmtDate(c.proximo_vencimiento)}` : ' Sin plazo'}
                  {c.facturas_vencidas > 0 && (
                    <span style={{ color: '#ef4444', fontWeight: 700 }}> · {c.facturas_vencidas} vencida{c.facturas_vencidas > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: vencido ? '#ef4444' : '#60a5fa' }}>
                  {fmt(c.saldo_pendiente)}
                </div>
                {vencido && (
                  <div style={{ fontSize: 11, color: '#ef4444' }}>
                    {fmt(c.monto_vencido)} vencido
                  </div>
                )}
              </div>
            </div>

            {/* Detalle expandido */}
            {isExpanded && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #333' }}>
                {loadingDetail ? (
                  <div style={{ textAlign: 'center', padding: 12, color: '#888' }}>Cargando...</div>
                ) : detalle.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 12, color: '#888' }}>Sin facturas pendientes</div>
                ) : (
                  <div style={{ fontSize: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 80px 80px 90px', gap: 4, fontWeight: 700, color: '#888', marginBottom: 6, padding: '0 4px' }}>
                      <span>Control</span>
                      <span>Emitida</span>
                      <span style={{ textAlign: 'right' }}>Total</span>
                      <span style={{ textAlign: 'right' }}>Pagado</span>
                      <span style={{ textAlign: 'right' }}>Vence</span>
                    </div>
                    {detalle.map(d => {
                      const aging = agingBucket(d.fecha_vencimiento)
                      const saldo = Number(d.monto_total) - Number(d.total_pagado || 0)
                      return (
                        <div key={d.id} style={{
                          display: 'grid', gridTemplateColumns: '1fr 70px 80px 80px 90px', gap: 4,
                          padding: '4px', borderBottom: '1px solid #222', alignItems: 'center',
                        }}>
                          <span style={{ color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.numero_control?.slice(-12) || '—'}
                          </span>
                          <span style={{ color: '#aaa' }}>{fmtDate(d.fecha_emision)?.slice(0, 6)}</span>
                          <span style={{ textAlign: 'right', color: '#ddd' }}>{fmt(d.monto_total)}</span>
                          <span style={{ textAlign: 'right', color: Number(d.total_pagado) > 0 ? '#4ade80' : '#555' }}>
                            {Number(d.total_pagado) > 0 ? fmt(d.total_pagado) : '—'}
                          </span>
                          <span style={{ textAlign: 'right', color: aging.color, fontWeight: 600, fontSize: 11 }}>
                            {d.fecha_vencimiento ? aging.label : '—'}
                          </span>
                        </div>
                      )
                    })}
                    <div style={{ marginTop: 6, textAlign: 'right', fontWeight: 700, color: '#60a5fa', padding: '0 4px' }}>
                      Saldo: {fmt(detalle.reduce((s, d) => s + Number(d.monto_total) - Number(d.total_pagado || 0), 0))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════
const TABS = [
  { key: 'subir', label: '📸 Subir Pagos' },
  { key: 'pendientes', label: '⏳ Pendientes' },
  { key: 'cxp', label: '📋 Cuentas x Pagar' },
]

export default function PagosProveedorView({ user }) {
  const [tab, setTab] = useState('subir')
  const [pagos, setPagos] = useState([])
  const [cxp, setCxp] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Pagos with their applications
      const { data: pagosData } = await db.from('pagos_proveedor')
        .select('*, aplicaciones:pagos_proveedor_aplicacion(id, monto_aplicado, compras_dte_id, compras_dte:compras_dte_id(numero_control, monto_total))')
        .order('created_at', { ascending: false })
        .limit(200)
      setPagos(pagosData || [])

      // CxP materialized view
      const { data: cxpData } = await db.from('v_cuentas_por_pagar')
        .select('*')
        .order('saldo_pendiente', { ascending: false })
      setCxp(cxpData || [])

      // Proveedores para autocomplete
      const { data: provData } = await db.from('catalogo_contable')
        .select('nombre_dte')
        .eq('activo', true)
        .order('nombre_dte')
      setProveedores((provData || []).map(p => ({ proveedor_nombre: p.nombre_dte })))
    } catch (err) {
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Access check
  const canAccess = ['ejecutivo', 'superadmin'].includes(user.rol)
  if (!canAccess) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <div>Acceso restringido a ejecutivos</div>
      </div>
    )
  }

  const pendientesCount = pagos.filter(p => p.estado !== 'conciliado').length

  return (
    <div style={{ padding: '12px 16px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>💰 Pagos & Cuentas por Pagar</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Registrar pagos, conciliar y ver saldos</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: tab === t.key ? '2px solid #60a5fa' : '1px solid #444',
              background: tab === t.key ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: tab === t.key ? '#60a5fa' : '#aaa',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              position: 'relative',
            }}
          >
            {t.label}
            {t.key === 'pendientes' && pendientesCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800,
                borderRadius: '50%', minWidth: 18, height: 18, display: 'flex',
                alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>{pendientesCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Cargando...</div>
      ) : (
        <>
          {tab === 'subir' && <SubirPagos user={user} proveedores={proveedores} onSaved={loadData} />}
          {tab === 'pendientes' && <PendientesConciliar pagos={pagos} onRefresh={loadData} />}
          {tab === 'cxp' && <CuentasPorPagar cxp={cxp} onRefresh={loadData} />}
        </>
      )}
    </div>
  )
}

// ─── Shared styles ─────────────────────────────────────────
const labelSt = { fontSize: 11, color: '#888', display: 'block', marginBottom: 2, fontWeight: 600 }
const inputSt = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid #444', background: '#1a1a2e', color: '#eee',
  fontSize: 13, boxSizing: 'border-box',
}
