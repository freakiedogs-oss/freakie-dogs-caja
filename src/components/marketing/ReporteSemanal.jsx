// ────────────────────────────────────────────────────────────────────
// Reporte Semanal de Mercadeo — historial + feedback + solicitudes al AI.
// El reporte lo genera la routine de los lunes (07:00 SV) y lo guarda en
// mkt_reportes; acá el equipo lo lee, contesta la encuesta (mkt_feedback,
// 1 por persona por reporte, editable) y le pide cosas al próximo reporte
// (mkt_solicitudes → la routine las lee, las incorpora y responde).
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { useToast } from '../../hooks/useToast'

const C = { card: '#1a1a1a', border: '#333', dim: '#888', accent: '#e74c3c', green: '#2dd4a8', amber: '#f39c12' }

// Encuesta semanal (opción múltiple + texto largo). Las claves van al jsonb `respuestas`.
const PREGUNTAS = [
  { key: 'utilidad', q: '¿Qué tan útil fue este reporte?', ops: ['🔥 Excelente', '👍 Útil', '😐 Regular', '👎 Poco útil'] },
  { key: 'estrategias', q: '¿Las 5 estrategias por red aplican a la marca?', ops: ['Sí, todas', 'La mayoría', 'Solo algunas', 'No aplican'] },
  { key: 'cuentas_ref', q: '¿Las cuentas de referencia sirvieron de inspiración?', ops: ['Sí', 'Algunas', 'No'] },
  { key: 'youtube', q: '¿La estrategia de YouTube va por buen camino?', ops: ['Sí, dale', 'Ajustar detalles', 'Replantear'] },
]

// Mini-renderer de markdown (títulos, negrita, listas, links, hr) — suficiente
// para los reportes; sin dependencias nuevas.
function mdRender(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#4fc3f7">$1</a>')
  const lines = (md || '').split('\n')
  let html = '', inList = false
  for (const raw of lines) {
    const l = raw.trimEnd()
    if (/^\s*[-*] /.test(l)) {
      if (!inList) { html += '<ul style="margin:6px 0 10px 18px;padding:0">'; inList = true }
      html += `<li style="margin:3px 0">${inline(l.replace(/^\s*[-*] /, ''))}</li>`
      continue
    }
    if (inList) { html += '</ul>'; inList = false }
    if (/^### /.test(l)) html += `<h4 style="margin:14px 0 6px;color:#fff">${inline(l.slice(4))}</h4>`
    else if (/^## /.test(l)) html += `<h3 style="margin:18px 0 8px;color:#f39c12">${inline(l.slice(3))}</h3>`
    else if (/^# /.test(l)) html += `<h2 style="margin:20px 0 10px;color:#fff">${inline(l.slice(2))}</h2>`
    else if (/^---+$/.test(l)) html += '<hr style="border:none;border-top:1px solid #333;margin:14px 0"/>'
    else if (l === '') html += '<div style="height:6px"></div>'
    else html += `<p style="margin:4px 0;line-height:1.55">${inline(l)}</p>`
  }
  if (inList) html += '</ul>'
  return html
}

export default function ReporteSemanal({ user }) {
  const toast = useToast()
  const [reportes, setReportes] = useState([])
  const [sel, setSel] = useState(null)          // reporte seleccionado (objeto)
  const [respuestas, setRespuestas] = useState({})
  const [comentario, setComentario] = useState('')
  const [feedbackListo, setFeedbackListo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [solicitudes, setSolicitudes] = useState([])
  const [nuevaSolicitud, setNuevaSolicitud] = useState('')
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: reps }, { data: sols }] = await Promise.all([
      db.from('mkt_reportes').select('*').order('semana', { ascending: false }).limit(26),
      db.from('mkt_solicitudes').select('*').order('created_at', { ascending: false }).limit(30),
    ])
    setReportes(reps || [])
    setSolicitudes(sols || [])
    if ((reps || []).length && !sel) setSel(reps[0])
    setLoading(false)
  }, [sel])
  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // feedback existente del usuario para el reporte seleccionado (editable)
  useEffect(() => {
    if (!sel || !user?.id) return
    db.from('mkt_feedback').select('respuestas,comentario').eq('reporte_id', sel.id).eq('usuario_id', user.id).maybeSingle()
      .then(({ data }) => {
        setRespuestas(data?.respuestas || {})
        setComentario(data?.comentario || '')
        setFeedbackListo(!!data)
      }).catch(() => {})
  }, [sel, user?.id])

  const guardarFeedback = async () => {
    if (!sel) return
    if (!Object.keys(respuestas).length && !comentario.trim()) { toast.warning('Contestá al menos una pregunta o dejá un comentario'); return }
    setGuardando(true)
    const { error } = await db.rpc('mkt_feedback_guardar', {
      p_reporte_id: sel.id, p_usuario_id: user.id, p_usuario_nombre: user.nombre || '',
      p_respuestas: respuestas, p_comentario: comentario.trim() || null,
    })
    setGuardando(false)
    if (error) { toast.error('Error: ' + error.message); return }
    setFeedbackListo(true)
    toast.success('¡Gracias! El AI usa tu feedback para el próximo reporte.')
  }

  const enviarSolicitud = async () => {
    const t = nuevaSolicitud.trim()
    if (t.length < 5) { toast.warning('Contame un poco más qué querés en el reporte'); return }
    const { error } = await db.rpc('mkt_solicitud_crear', { p_usuario_id: user.id, p_usuario_nombre: user.nombre || '', p_texto: t })
    if (error) { toast.error('Error: ' + error.message); return }
    setNuevaSolicitud('')
    toast.success('Anotado — entra al reporte del próximo lunes.')
    cargar()
  }

  const card = (children, style = {}) => (
    <div style={{ background: C.card, borderRadius: 12, padding: 16, marginBottom: 12, border: `1px solid ${C.border}`, ...style }}>{children}</div>
  )
  const fSemana = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return d } }
  const EST_BADGE = { pendiente: ['⏳ pendiente', '#f39c12'], incorporada: ['✅ en el reporte', '#2dd4a8'], respondida: ['💬 respondida', '#4fc3f7'], descartada: ['— descartada', '#888'] }

  if (loading) return <div style={{ padding: 20, color: '#aaa', textAlign: 'center' }}>Cargando reportes…</div>

  return (
    <div>
      {/* Selector de semana (historial) */}
      {card(
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: C.dim }}>🗞 Reporte de la semana:</span>
          <select value={sel?.id || ''} onChange={e => setSel(reportes.find(r => r.id === e.target.value) || null)}
            style={{ background: '#222', border: '1px solid #444', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, flex: 1, minWidth: 200 }}>
            {reportes.map(r => <option key={r.id} value={r.id}>{fSemana(r.semana)} — {r.titulo}</option>)}
            {!reportes.length && <option value="">(aún no hay reportes — el primero llega el lunes)</option>}
          </select>
        </div>
      )}

      {/* Reporte */}
      {sel && card(<div dangerouslySetInnerHTML={{ __html: mdRender(sel.contenido_md) }} style={{ color: '#ddd', fontSize: 14 }} />)}
      {!sel && card(<p style={{ color: C.dim, textAlign: 'center', margin: 0 }}>El reporte semanal se genera cada lunes 7:00 AM y aparece aquí automáticamente.</p>)}

      {/* Encuesta de feedback */}
      {sel && card(
        <div>
          <h3 style={{ margin: '0 0 4px', color: '#fff' }}>📝 Tu feedback de esta semana {feedbackListo && <span style={{ fontSize: 12, color: C.green }}>· ya enviaste (podés editarlo)</span>}</h3>
          <p style={{ fontSize: 12, color: C.dim, margin: '0 0 12px' }}>2 minutos — el AI lee esto y ajusta el próximo reporte a los valores de la marca.</p>
          {PREGUNTAS.map(p => (
            <div key={p.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#ccc', marginBottom: 6 }}>{p.q}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {p.ops.map(op => (
                  <button key={op} onClick={() => setRespuestas(r => ({ ...r, [p.key]: r[p.key] === op ? undefined : op }))}
                    style={{
                      padding: '7px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                      background: respuestas[p.key] === op ? '#e74c3c22' : '#222',
                      border: `1px solid ${respuestas[p.key] === op ? C.accent : '#444'}`,
                      color: respuestas[p.key] === op ? '#ff8a80' : '#bbb', fontWeight: 600,
                    }}>{op}</button>
                ))}
              </div>
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: '#ccc', marginBottom: 6 }}>Comentarios largos (qué mejorar, qué falta, qué NO va con la marca…)</div>
            <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3}
              placeholder="Ej: las cuentas de referencia estuvieron buenísimas pero el tono de la estrategia 3 no es Freakie, nosotros somos más..."
              style={{ width: '100%', background: '#222', border: '1px solid #444', borderRadius: 8, padding: 10, color: '#fff', fontSize: 13, resize: 'vertical' }} />
          </div>
          <button onClick={guardarFeedback} disabled={guardando}
            style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {guardando ? 'Guardando…' : feedbackListo ? '💾 Actualizar mi feedback' : '📨 Enviar feedback'}
          </button>
        </div>
      )}

      {/* Solicitudes al AI */}
      {card(
        <div>
          <h3 style={{ margin: '0 0 4px', color: '#fff' }}>🤖 Pedile algo al próximo reporte</h3>
          <p style={{ fontSize: 12, color: C.dim, margin: '0 0 10px' }}>Lo que escribas acá lo lee el AI antes de generar el reporte del lunes: agregar secciones, analizar algo puntual, cambiar el enfoque…</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={nuevaSolicitud} onChange={e => setNuevaSolicitud(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && enviarSolicitud()}
              placeholder="Ej: analizá qué tipo de reel nos da más seguidores nuevos"
              style={{ flex: 1, background: '#222', border: '1px solid #444', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13 }} />
            <button onClick={enviarSolicitud}
              style={{ background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Enviar</button>
          </div>
          {solicitudes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {solicitudes.map(s => {
                const [lbl, col] = EST_BADGE[s.estado] || [s.estado, '#888']
                return (
                  <div key={s.id} style={{ padding: '8px 0', borderTop: '1px solid #2a2a2a', fontSize: 13 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: '#ddd', flex: 1 }}>{s.texto}</span>
                      <span style={{ color: col, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{lbl}</span>
                    </div>
                    <div style={{ color: C.dim, fontSize: 11 }}>{s.usuario_nombre || ''}</div>
                    {s.respuesta && <div style={{ color: '#9fd6ff', fontSize: 12, marginTop: 3 }}>↳ {s.respuesta}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
