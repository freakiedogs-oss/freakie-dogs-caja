/* ═══════════════════════════════════════════════════════════════════════
   Control de temperatura de carne boleada — hoja FD-BPM-02

   La hoja se llena a mano en la estacion (37 marcaciones cada 15 min, de
   8:00 a 17:00, dos columnas: carne boleandose y carne boleada). Al final
   del dia se le toma una foto y se sube aca.

   Quien sube: produccion (Diego).
   Quien revisa: Cesar y Mauricio — ven la FOTO junto a las anomalias.

   Decision de diseno (27-ago-2026): a nadie se le pide transcribir los 74
   numeros. Un modelo de vision los lee y esta vista muestra SOLO lo que
   esta fuera de rango o sin anotar, con la foto al lado en grande. El ojo
   de quien revisa es la verificacion — por eso la imagen nunca se esconde
   detras de la conclusion, y las lecturas dudosas se marcan como tales.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react'
import { db, URL_SB } from '../../supabase'

const BUCKET = 'bpm-hojas'
const FORMATO = 'FD-BPM-02'
const STORE = 'CM001'

const ROLES_SUBEN   = ['produccion', 'jefe_casa_matriz', 'admin', 'ejecutivo', 'superadmin']
const ROLES_REVISAN = ['jefe_casa_matriz', 'ing_alimentos', 'admin', 'ejecutivo', 'superadmin']

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', acc: '#3b82f6',
}

const card = {
  background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
  padding: 16, marginBottom: 14,
}
const btn = (color, off) => ({
  background: off ? '#3a3a3e' : color, color: '#fff', border: 'none',
  borderRadius: 9, padding: '11px 20px', fontSize: 15, fontWeight: 700,
  cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.6 : 1,
})

const fmtFecha = (f) => {
  if (!f) return '—'
  const [a, m, d] = f.split('-')
  return `${d}/${m}/${a}`
}

// Cada tipo de hallazgo tiene su color y su etiqueta.
const TIPOS = {
  fuera_de_rango: { color: C.bad,  label: 'Sobre el límite' },
  sin_registro:   { color: C.warn, label: 'Sin registro' },
  casilla_vacia:  { color: C.warn, label: 'Casilla vacía' },
  dato_raro:      { color: C.acc,  label: 'Dato extraño' },
}

export default function BPMTemperaturaView({ user }) {
  const [cargando, setCargando] = useState(true)
  const [error, setError]       = useState('')
  const [hojas, setHojas]       = useState([])
  const [sel, setSel]           = useState(null)
  const [foto, setFoto]         = useState(null)
  const [preview, setPreview]   = useState('')
  const [fecha, setFecha]       = useState('')
  const [subiendo, setSubiendo] = useState('')

  const rol = user?.rol || ''
  const puedeSubir  = ROLES_SUBEN.includes(rol)
  const puedeRevisar = ROLES_REVISAN.includes(rol)

  const hoySV = () =>
    new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })

  useEffect(() => { setFecha(hoySV()); cargar() }, [])

  async function cargar() {
    setCargando(true); setError('')
    try {
      const { data, error: e } = await db.from('bpm_hojas_temp')
        .select('*').eq('formato', FORMATO)
        .order('fecha', { ascending: false }).limit(60)
      if (e) throw e
      setHojas(data || [])
      setSel((prev) => (prev ? (data || []).find(h => h.id === prev.id) || null : (data || [])[0] || null))
    } catch (e) {
      setError(e.code === '42501' || /permission denied/i.test(e.message || '')
        ? 'El sistema no tiene permiso de leer las hojas. Avisá a Casa Matriz.'
        : (e.message || 'No se pudo cargar'))
    }
    setCargando(false)
  }

  function onFoto(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFoto(f); setPreview(URL.createObjectURL(f))
  }

  async function subir() {
    if (!foto) { setError('Elegí o tomá la foto de la hoja.'); return }
    if (!fecha) { setError('Poné la fecha de la hoja.'); return }
    setSubiendo('Subiendo la foto…'); setError('')
    try {
      const ext = (foto.name.split('.').pop() || 'jpg').toLowerCase()
      const ruta = `${FORMATO}/${fecha}-${Date.now()}.${ext}`
      const { error: eUp } = await db.storage.from(BUCKET)
        .upload(ruta, foto, { upsert: false, contentType: foto.type })
      if (eUp) throw eUp

      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(ruta)

      const { data: hoja, error: eIns } = await db.from('bpm_hojas_temp').insert({
        fecha,
        store_code: STORE,
        formato: FORMATO,
        foto_url: pub.publicUrl,
        subida_por: user?.id || null,
        subida_nombre: user?.nombre || null,
        estado: 'pendiente',
      }).select().single()
      if (eIns) {
        if (eIns.code === '23505') throw new Error('Ya hay una hoja subida para esa fecha.')
        throw eIns
      }

      setSubiendo('Leyendo la hoja… esto tarda unos segundos.')
      const r = await fetch(`${URL_SB}/functions/v1/bpm-leer-hoja`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja_id: hoja.id }),
      })
      const d = await r.json().catch(() => ({}))
      // Si la lectura falla, la hoja igual queda archivada con su foto:
      // el registro fisico no se pierde por un problema del modelo.
      if (!r.ok) setError(`La foto quedó guardada, pero no se pudo leer: ${d.error || r.status}`)

      setFoto(null); setPreview(''); setSubiendo('')
      await cargar()
    } catch (e) {
      setError(e.message || 'No se pudo subir')
      setSubiendo('')
    }
  }

  async function marcarRevisada(hoja) {
    try {
      await db.from('bpm_hojas_temp').update({
        revisada_por: user?.id || null,
        revisada_at: new Date().toISOString(),
      }).eq('id', hoja.id)
      await cargar()
    } catch (e) { setError(e.message) }
  }

  // El informe se arma en el navegador y se baja como archivo: no depende
  // de que el servidor genere PDFs ni de que haya internet al abrirlo.
  function bajarReporte(h) {
    const anom = h.anomalias || []
    const fila = (a) => `
      <tr>
        <td>${a.hora || '—'}</td>
        <td>${a.columna || '—'}</td>
        <td class="v">${a.valor ?? '—'}</td>
        <td><b style="color:${TIPOS[a.tipo]?.color || '#333'}">${TIPOS[a.tipo]?.label || a.tipo}</b></td>
        <td>${a.nota || ''}${a.confianza === 'baja' ? ' <i>(lectura dudosa)</i>' : ''}</td>
      </tr>`
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Informe temperatura ${h.fecha}</title><style>
@page{size:letter portrait;margin:.5in}
body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;font-size:10pt}
h1{font-size:15pt;margin:0}
.sub{font-size:8.5pt;color:#444;margin:3px 0 10px}
.barra{border-bottom:3px solid #000;margin-bottom:12px}
.meta{font-size:9pt;margin-bottom:12px;line-height:1.7}
.res{border:2px solid #000;padding:9px 12px;font-size:10pt;margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:9pt}
th,td{border:1px solid #000;padding:4px 6px;text-align:left}
th{background:#000;color:#fff;font-size:8.5pt}
td.v{text-align:center;font-weight:bold}
.ok{border:2px solid #16a34a;padding:12px;font-size:11pt;text-align:center}
img{max-width:100%;border:1px solid #666;margin-top:8px}
.pie{margin-top:26px;font-size:8pt;color:#444;border-top:1px solid #000;padding-top:6px}
</style></head><body>
<h1>Informe de control de temperatura — Carne boleada</h1>
<div class="sub">Formato ${h.formato} · Freakie Dogs · Generado el ${new Date().toLocaleString('es-SV')}</div>
<div class="barra"></div>
<div class="meta">
  <b>Fecha de la hoja:</b> ${fmtFecha(h.fecha)}<br>
  <b>Subida por:</b> ${h.subida_nombre || '—'} el ${new Date(h.subida_at).toLocaleString('es-SV')}<br>
  <b>Límite crítico:</b> ${h.limite_c} °C<br>
  <b>Lectura automática:</b> ${h.modelo || '—'}
</div>
<div class="res"><b>Resumen:</b> ${h.resumen || 'Sin lectura automática.'}</div>
${anom.length === 0
  ? '<div class="ok"><b>Sin anomalías.</b> Ninguna temperatura superó el límite y no se detectaron tramos sin registro.</div>'
  : `<table><thead><tr><th>Hora</th><th>Columna</th><th>Valor</th><th>Hallazgo</th><th>Detalle</th></tr></thead>
     <tbody>${anom.map(fila).join('')}</tbody></table>`}
<p style="font-size:9pt;margin-top:16px"><b>Hoja original:</b></p>
<img src="${h.foto_url}" alt="Hoja escaneada">
<div class="pie">Las temperaturas fueron leídas de una hoja manuscrita por un modelo automático.
La imagen original se incluye arriba y prevalece sobre la transcripción en caso de duda.</div>
</body></html>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Informe_temperatura_${h.fecha}.html`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }

  if (cargando) return <div style={{ padding: 20, color: C.dim }}>Cargando…</div>

  const anom = sel?.anomalias || []
  const criticas = anom.filter(a => a.tipo === 'fuera_de_rango')

  return (
    <div style={{ padding: 16, background: C.bg, color: C.txt, minHeight: '100%' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 21 }}>🌡️ Control de temperatura · Carne boleada</h2>
        <div style={{ color: C.dim, fontSize: 13, marginTop: 3 }}>
          Hoja {FORMATO} · se sube la foto al cierre y el sistema marca lo que se salió de rango
        </div>
      </div>

      {error && (
        <div style={{ ...card, background: '#3a1212', borderColor: C.bad, color: '#fecaca' }}>{error}</div>
      )}

      {/* ── Subir (Diego) ── */}
      {puedeSubir && (
        <div style={card}>
          <b style={{ fontSize: 15 }}>Subir la hoja del día</b>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 11 }}>
            <label style={{ fontSize: 13, color: C.dim }}>
              Fecha de la hoja<br />
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                style={{ background: '#101012', color: C.txt, border: `1px solid ${C.line}`,
                         borderRadius: 8, padding: '9px 11px', fontSize: 15, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 13, color: C.dim }}>
              Foto de la hoja<br />
              {/* capture fuerza la camara en el telefono, pero en la tablet de
                  Casa Matriz tambien deja elegir un archivo ya tomado. */}
              <input type="file" accept="image/*" capture="environment" onChange={onFoto}
                style={{ marginTop: 8, fontSize: 13, color: C.txt }} />
            </label>
          </div>

          {preview && (
            <img src={preview} alt="Vista previa"
              style={{ maxWidth: 300, marginTop: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
          )}

          <div style={{ marginTop: 13 }}>
            <button onClick={subir} disabled={!!subiendo || !foto} style={btn(C.ok, !!subiendo || !foto)}>
              {subiendo || 'Subir y analizar'}
            </button>
            {subiendo && <span style={{ color: C.dim, fontSize: 13, marginLeft: 11 }}>No cierres la página.</span>}
          </div>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 9, lineHeight: 1.5 }}>
            Tomá la foto de frente, con toda la hoja adentro y buena luz. Si sale
            torcida o borrosa, el sistema va a leer mal los números.
          </div>
        </div>
      )}

      {/* ── Selector de fecha ── */}
      {hojas.length > 0 && (
        <div style={{ ...card, display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: C.dim, fontSize: 13 }}>Hojas subidas:</span>
          {hojas.slice(0, 14).map(h => {
            const activa = sel?.id === h.id
            const malas = (h.anomalias || []).filter(a => a.tipo === 'fuera_de_rango').length
            return (
              <button key={h.id} onClick={() => setSel(h)}
                style={{
                  background: activa ? C.acc : '#232327', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                  fontWeight: activa ? 700 : 400,
                }}>
                {fmtFecha(h.fecha)}
                {malas > 0 && <span style={{ color: '#fca5a5', marginLeft: 6 }}>● {malas}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Revision: foto grande + solo anomalias ── */}
      {sel && puedeRevisar && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          <div style={{ ...card, flex: '1 1 340px', minWidth: 300 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <b style={{ fontSize: 15 }}>Hoja del {fmtFecha(sel.fecha)}</b>
              <span style={{ color: C.dim, fontSize: 12 }}>{sel.subida_nombre || 'sin nombre'}</span>
            </div>
            <a href={sel.foto_url} target="_blank" rel="noreferrer">
              <img src={sel.foto_url} alt={`Hoja del ${sel.fecha}`}
                style={{ width: '100%', borderRadius: 9, border: `1px solid ${C.line}`, display: 'block' }} />
            </a>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>
              Tocá la imagen para verla en grande. <b>La foto manda</b> — si algo
              abajo no coincide con lo escrito, vale lo que dice la hoja.
            </div>
          </div>

          <div style={{ flex: '1 1 340px', minWidth: 300 }}>
            <div style={card}>
              <b style={{ fontSize: 15 }}>Qué encontré</b>
              <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55, color: '#d8d8dc' }}>
                {sel.estado === 'error'
                  ? <span style={{ color: C.bad }}>No se pudo leer la hoja: {sel.error_lectura}</span>
                  : sel.estado === 'pendiente'
                    ? <span style={{ color: C.dim }}>Todavía sin analizar.</span>
                    : (sel.resumen || '—')}
              </div>
            </div>

            {sel.estado === 'leida' && (
              criticas.length === 0 && anom.length === 0 ? (
                <div style={{ ...card, borderColor: C.ok, background: '#0e2a17' }}>
                  <b style={{ color: C.ok, fontSize: 15 }}>✓ Sin anomalías</b>
                  <div style={{ marginTop: 5, fontSize: 13.5, color: '#bbf7d0' }}>
                    Ninguna temperatura superó los {sel.limite_c} °C y la hoja quedó completa.
                  </div>
                </div>
              ) : (
                <div style={card}>
                  <b style={{ fontSize: 15 }}>
                    {anom.length} punto{anom.length > 1 ? 's' : ''} para revisar
                  </b>
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {anom.map((a, i) => {
                      const t = TIPOS[a.tipo] || { color: C.dim, label: a.tipo }
                      return (
                        <div key={i} style={{
                          borderLeft: `4px solid ${t.color}`, background: '#101012',
                          borderRadius: 7, padding: '9px 12px',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <b style={{ fontSize: 14 }}>{a.hora}</b>
                            <span style={{ color: t.color, fontSize: 12, fontWeight: 700 }}>{t.label}</span>
                          </div>
                          <div style={{ fontSize: 13, color: '#c8c8ce', marginTop: 3 }}>
                            {a.columna ? <>{a.columna}: </> : null}
                            {a.valor != null && <b style={{ color: t.color, fontSize: 15 }}>{a.valor} °C</b>}
                            {a.valor != null && ' — '}{a.nota}
                          </div>
                          {a.confianza === 'baja' && (
                            <div style={{ fontSize: 12, color: C.warn, marginTop: 4 }}>
                              ⚠ Lectura dudosa — confirmá contra la foto antes de actuar.
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => bajarReporte(sel)} style={btn(C.acc)}>Descargar informe</button>
              {!sel.revisada_at
                ? <button onClick={() => marcarRevisada(sel)} style={btn('#3f3f46')}>Marcar como revisada</button>
                : <span style={{ color: C.ok, fontSize: 13, alignSelf: 'center' }}>
                    ✓ Revisada el {new Date(sel.revisada_at).toLocaleDateString('es-SV')}
                  </span>}
            </div>
          </div>
        </div>
      )}

      {sel && !puedeRevisar && (
        <div style={{ ...card, color: C.dim }}>
          La hoja quedó subida. El análisis lo ven Casa Matriz y el ingeniero de alimentos.
        </div>
      )}

      {hojas.length === 0 && (
        <div style={{ ...card, color: C.dim }}>Todavía no se ha subido ninguna hoja.</div>
      )}
    </div>
  )
}
