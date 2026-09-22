import { useState, useEffect, useCallback, useMemo } from 'react'
import { db } from '../../supabase'
import { today, fmtDate } from '../../config'
import { useToast } from '../../hooks/useToast'

// ── Equipo (roles reales de Freakie Dogs Marketing) ──
const TEAM = {
  frank: { name: 'Frank', role: 'Director creativo · Marketing Lead', color: '#4FBFA4', duty: 'Detecta necesidades, define prioridades y aprueba decisiones clave.' },
  adri: { name: 'Adriana', role: 'Marketing Project Manager + Diseño', color: '#FF7256', duty: 'Convierte prioridades en proyectos, asigna responsables, controla fechas y coordina producción.' },
  kenya: { name: 'Kenia', role: 'Content & Growth Creative', color: '#7AAAD6', duty: 'Da seguimiento a lo digital: pautas, nuevas estrategias, pilares de contenido y grabaciones.' },
  sam: { name: 'Samantha', role: 'Video Editor', color: '#B79CE8', duty: 'Convierte el material grabado en piezas terminadas según calendario.' },
}
const TEAM_ORDER = ['frank', 'adri', 'kenya', 'sam']

// ── Las 5 etapas del pipeline ──
const ETAPAS = {
  definicion: { label: 'Definición', pct: 0, icon: '🔒', color: '#9C9AA0', significa: 'Ya decidimos hacerlo, pero estamos aterrizando exactamente qué queremos.', avanza: 'Objetivo, entregable, responsable y fecha están claros.' },
  planificado: { label: 'Planificado', pct: 25, icon: '🔥', color: '#F2B25A', significa: 'Ya sabemos cómo se va a ejecutar.', avanza: 'Tiene tareas, materiales/recursos y fecha de inicio.' },
  proceso: { label: 'En proceso', pct: 50, icon: '🔥', color: '#7AAAD6', significa: 'Alguien está trabajando activamente en ello.', avanza: 'Existe una primera versión o entregable.' },
  revision: { label: 'En revisión', pct: 75, icon: '🔥', color: '#B79CE8', significa: 'Ya está hecho y necesita aprobación o correcciones.', avanza: 'Frank o el responsable aprueba la versión final.' },
  finalizado: { label: 'Finalizado', pct: 100, icon: '🏆', color: '#E8C158', significa: 'Ya no requiere ninguna acción del equipo.', avanza: 'Fue publicado, instalado, enviado, impreso o implementado.' },
}
const ETAPA_ORDER = ['definicion', 'planificado', 'proceso', 'revision', 'finalizado']

// ── Tipos de evento en el historial (inmutable: ver migración, sin policy de update/delete) ──
const ACCION_META = {
  creado: { icon: '✨', label: 'Creado', color: '#7AAAD6' },
  editado: { icon: '✏️', label: 'Editado', color: '#9C9AA0' },
  etapa_cambiada: { icon: '🔥', label: 'Cambio de etapa', color: '#F2B25A' },
  eliminado: { icon: '🗑️', label: 'Eliminado', color: '#ff8b7a' },
}

const BG = '#0e0e0f'
const SURFACE = '#1a1a1a'
const SURFACE_2 = '#202022'
const LINE = '#2a2a2a'
const INK = '#f2f0ec'
const MUTED = '#9c9aa0'
const RED = '#e63946'
const DANGER = '#ff8b7a'
const GOOD = '#4FBFA4'

const isOverdue = (o) => o.deadline && o.etapa !== 'finalizado' && o.deadline < today()

const fmtDateTime = (iso) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('es-SV', {
      timeZone: 'America/El_Salvador', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

// Lunes de la semana que contiene `dateStr` (YYYY-MM-DD)
const startOfWeek = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay() // 0=dom..6=sab
  const diff = dow === 0 ? 6 : dow - 1
  d.setDate(d.getDate() - diff)
  return d.toISOString().split('T')[0]
}
const startOfMonth = (dateStr) => dateStr.slice(0, 7) + '-01'

function ProgressRing({ pct, color, icon, overdue }) {
  const ringColor = overdue ? DANGER : color
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
      background: `conic-gradient(${ringColor} ${pct * 3.6}deg, ${LINE} 0deg)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', background: SURFACE,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
      }}>
        {overdue ? '⚠️' : icon}
      </div>
    </div>
  )
}

function Avatar({ who, size = 26 }) {
  const t = TEAM[who] || { name: who || '?', color: '#555' }
  return (
    <div title={t.name} style={{
      width: size, height: size, borderRadius: '50%', background: t.color,
      color: '#101010', fontWeight: 800, fontSize: size * 0.42,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {(t.name || '?').charAt(0).toUpperCase()}
    </div>
  )
}

function ObjetivoCard({ o, onClick }) {
  const etapa = ETAPAS[o.etapa] || ETAPAS.definicion
  const overdue = isOverdue(o)
  return (
    <div
      onClick={onClick}
      style={{
        background: SURFACE, border: `1px solid ${overdue ? DANGER + '55' : LINE}`, borderRadius: 14,
        padding: 14, marginBottom: 10, cursor: 'pointer', display: 'flex', gap: 12,
      }}
    >
      <ProgressRing pct={etapa.pct} color={etapa.color} icon={etapa.icon} overdue={overdue} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ color: INK, fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{o.titulo}</div>
          <Avatar who={o.responsable} />
        </div>
        {o.entregable && <div style={{ color: MUTED, fontSize: 12.5, marginTop: 3 }}>{o.entregable}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: etapa.color, background: etapa.color + '22',
            padding: '2px 8px', borderRadius: 8,
          }}>{etapa.label}</span>
          {o.deadline && (
            <span style={{ fontSize: 11, color: overdue ? DANGER : '#777' }}>
              {overdue ? '⚠️ venció ' : '📅 '}{fmtDate(o.deadline)}
            </span>
          )}
          {o.checklist && o.checklist.length > 0 && (
            <span style={{ fontSize: 11, color: o.checklist.every(i => i.hecho) ? GOOD : MUTED, fontWeight: 700 }}>
              ✓ {o.checklist.filter(i => i.hecho).length}/{o.checklist.length}
            </span>
          )}
          {overdue && (
            <span style={{ fontSize: 10, color: DANGER, border: `1px solid ${DANGER}55`, borderRadius: 6, padding: '1px 6px' }}>
              Origen: {o.scope === 'mensual' ? 'Mensual' : 'Semanal'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, subtitle, items, onCardClick, empty }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ color: INK, fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{title}</div>
      {subtitle && <div style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>{subtitle}</div>}
      {items.length === 0 ? (
        <div style={{ color: '#666', fontSize: 12.5, background: SURFACE_2, border: `1px dashed ${LINE}`, borderRadius: 12, padding: 14, textAlign: 'center' }}>
          {empty}
        </div>
      ) : items.map(o => <ObjetivoCard key={o.id} o={o} onClick={() => onCardClick(o)} />)}
    </div>
  )
}

function EditModal({ objetivo, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(objetivo)
  const isNew = !objetivo.id
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const inputStyle = { background: '#151516', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 11px', color: INK, fontSize: 13.5, width: '100%' }
  const labelStyle = { fontSize: 11.5, color: MUTED, marginBottom: 4, display: 'block', fontWeight: 600 }

  // ── Subtareas (checklist con burbujitas dentro del objetivo) ──
  const checklist = form.checklist || []
  const [nuevoItem, setNuevoItem] = useState('')
  const addItem = () => {
    if (!nuevoItem.trim()) return
    const item = { id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), texto: nuevoItem.trim(), hecho: false }
    set('checklist', [...checklist, item])
    setNuevoItem('')
  }
  const toggleItem = (id) => set('checklist', checklist.map(it => it.id === id ? { ...it, hecho: !it.hecho } : it))
  const removeItem = (id) => set('checklist', checklist.filter(it => it.id !== id))

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: SURFACE, borderTop: `1px solid ${LINE}`, borderRadius: '16px 16px 0 0',
          padding: 18, width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ color: INK, fontWeight: 800, fontSize: 16 }}>{isNew ? '+ Nuevo objetivo' : 'Editar objetivo'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Objetivo</label>
          <input style={inputStyle} value={form.titulo || ''} onChange={e => set('titulo', e.target.value)} placeholder="Ej: Activación de Bingo en Lourdes" />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Entregable</label>
          <input style={inputStyle} value={form.entregable || ''} onChange={e => set('entregable', e.target.value)} placeholder="¿Qué queda listo?" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Responsable</label>
            <select style={inputStyle} value={form.responsable || 'adri'} onChange={e => set('responsable', e.target.value)}>
              {TEAM_ORDER.map(k => <option key={k} value={k}>{TEAM[k].name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Alcance</label>
            <select style={inputStyle} value={form.scope || 'semanal'} onChange={e => set('scope', e.target.value)}>
              <option value="semanal">Semanal</option>
              <option value="mensual">Mensual</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Etapa</label>
            <select style={inputStyle} value={form.etapa || 'definicion'} onChange={e => set('etapa', e.target.value)}>
              {ETAPA_ORDER.map(k => <option key={k} value={k}>{ETAPAS[k].label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Deadline</label>
            <input type="date" style={inputStyle} value={form.deadline || ''} onChange={e => set('deadline', e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Notas</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notas || ''} onChange={e => set('notas', e.target.value)} placeholder="Contexto, bloqueos, aclaraciones..." />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Subtareas {checklist.length > 0 && `· ${checklist.filter(i => i.hecho).length}/${checklist.length}`}
          </label>
          {checklist.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {checklist.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px' }}>
                  <button
                    onClick={() => toggleItem(item.id)}
                    title={item.hecho ? 'Marcar como pendiente' : 'Marcar como hecho'}
                    style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', padding: 0,
                      border: `2px solid ${item.hecho ? GOOD : LINE}`, background: item.hecho ? GOOD : 'transparent',
                      color: '#0e0e0f', fontSize: 12, fontWeight: 900,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {item.hecho ? '✓' : ''}
                  </button>
                  <div style={{ flex: 1, fontSize: 13, color: item.hecho ? MUTED : INK, textDecoration: item.hecho ? 'line-through' : 'none' }}>
                    {item.texto}
                  </div>
                  <button onClick={() => removeItem(item.id)} title="Quitar" style={{ background: 'none', border: 'none', color: '#666', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 4px' }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={nuevoItem}
              onChange={e => setNuevoItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
              placeholder="Agregar paso y Enter para añadirlo"
            />
            <button onClick={addItem} style={{ background: SURFACE_2, border: `1px solid ${LINE}`, color: INK, borderRadius: 8, padding: '0 14px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>+</button>
          </div>
        </div>

        {!isNew && (
          <div style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
            Si lo eliminás, queda guardado en el Historial (no se puede editar ni borrar) para que nada se pierda.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: isNew ? 'flex-end' : 'space-between' }}>
          {!isNew && (
            <button onClick={() => onDelete(form)} style={{ background: 'none', border: `1px solid ${DANGER}55`, color: DANGER, borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>
              Eliminar
            </button>
          )}
          <button onClick={() => onSave(form)} disabled={!form.titulo || !form.responsable} style={{ background: RED, border: 'none', color: '#fff', borderRadius: 10, padding: '10px 20px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', opacity: form.titulo ? 1 : 0.5 }}>
            {isNew ? 'Crear objetivo' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HistorialRow({ entry, onRestaurar }) {
  const meta = ACCION_META[entry.accion] || ACCION_META.editado
  const etapaAnt = entry.etapa_anterior ? ETAPAS[entry.etapa_anterior]?.label : null
  const etapaNueva = entry.etapa_nueva ? ETAPAS[entry.etapa_nueva]?.label : null
  return (
    <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ fontSize: 18, lineHeight: 1 }}>{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ color: INK, fontWeight: 700, fontSize: 13 }}>{entry.titulo}</div>
          <Avatar who={entry.responsable} size={20} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.color + '22', padding: '1px 7px', borderRadius: 7 }}>
            {meta.label}
          </span>
          {etapaAnt && etapaNueva && (
            <span style={{ fontSize: 11, color: MUTED }}>{etapaAnt} → {etapaNueva}</span>
          )}
          <span style={{ fontSize: 11, color: '#666' }}>{fmtDateTime(entry.created_at)}</span>
          {entry.usuario_nombre && <span style={{ fontSize: 11, color: '#666' }}>· {entry.usuario_nombre}</span>}
        </div>
      </div>
      {entry.accion === 'eliminado' && onRestaurar && (
        <button onClick={() => onRestaurar(entry)} style={{ background: 'none', border: `1px solid ${GOOD}66`, color: GOOD, borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          ↺ Restaurar
        </button>
      )}
    </div>
  )
}

export default function FreakieFlowView({ user }) {
  const toast = useToast()
  const [objetivos, setObjetivos] = useState([])
  const [historial, setHistorial] = useState([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('lunes') // 'lunes' | 'kanban' | 'historial'
  const [periodo, setPeriodo] = useState('semana') // 'semana' | 'mes' | 'todo'
  const [editing, setEditing] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data, error } = await db.from('freakie_flow_objetivos').select('*').order('deadline', { ascending: true, nullsFirst: false })
    if (error) toast.error('Error cargando Freakie Flow: ' + error.message)
    setObjetivos(data || [])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistorial = useCallback(async () => {
    const { data, error } = await db.from('freakie_flow_historial').select('*').order('created_at', { ascending: false }).limit(300)
    if (error) { toast.error('Error cargando historial: ' + error.message); return }
    setHistorial(data || [])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); loadHistorial() }, [loadData, loadHistorial])

  const logHistorial = async (entry) => {
    try {
      await db.from('freakie_flow_historial').insert({
        objetivo_id: entry.objetivo_id || null,
        accion: entry.accion,
        titulo: entry.titulo,
        responsable: entry.responsable || null,
        etapa_anterior: entry.etapa_anterior || null,
        etapa_nueva: entry.etapa_nueva || null,
        snapshot: entry.snapshot || {},
        usuario_nombre: user?.nombre || user?.email || null,
        usuario_id: user?.id || null,
      })
    } catch (e) {
      console.warn('No se pudo registrar en el historial de Freakie Flow', e)
    }
  }

  const { semanal, mensual, vencidos } = useMemo(() => {
    const semanal = [], mensual = [], vencidos = []
    for (const o of objetivos) {
      if (isOverdue(o)) vencidos.push(o)
      else if (o.scope === 'mensual') mensual.push(o)
      else semanal.push(o)
    }
    return { semanal, mensual, vencidos }
  }, [objetivos])

  const porPersona = useMemo(() => {
    const map = {}
    for (const k of TEAM_ORDER) map[k] = 0
    for (const o of objetivos) {
      if (o.etapa !== 'finalizado' && TEAM_ORDER.includes(o.responsable)) map[o.responsable]++
    }
    return map
  }, [objetivos])

  const { historialFiltrado, stats } = useMemo(() => {
    let desde = null
    if (periodo === 'semana') desde = startOfWeek(today())
    else if (periodo === 'mes') desde = startOfMonth(today())
    const filtrado = desde ? historial.filter(h => (h.created_at || '').slice(0, 10) >= desde) : historial
    const st = { creados: 0, finalizados: 0, eliminados: 0, cambios: 0 }
    for (const h of filtrado) {
      if (h.accion === 'creado') st.creados++
      else if (h.accion === 'eliminado') st.eliminados++
      else if (h.accion === 'etapa_cambiada') {
        st.cambios++
        if (h.etapa_nueva === 'finalizado') st.finalizados++
      }
    }
    return { historialFiltrado: filtrado, stats: st }
  }, [historial, periodo])

  const guardar = async (form) => {
    const payload = {
      titulo: form.titulo,
      entregable: form.entregable || null,
      responsable: form.responsable,
      etapa: form.etapa || 'definicion',
      scope: form.scope || 'semanal',
      deadline: form.deadline || null,
      notas: form.notas || null,
      checklist: form.checklist || [],
      updated_at: new Date().toISOString(),
    }
    if (form.id) {
      const etapaAnterior = objetivos.find(o => o.id === form.id)?.etapa
      const { data, error } = await db.from('freakie_flow_objetivos').update(payload).eq('id', form.id).select().single()
      if (error) { toast.error('Error: ' + error.message); return }
      const cambioEtapa = etapaAnterior && etapaAnterior !== payload.etapa
      await logHistorial({
        objetivo_id: form.id,
        accion: cambioEtapa ? 'etapa_cambiada' : 'editado',
        titulo: payload.titulo,
        responsable: payload.responsable,
        etapa_anterior: cambioEtapa ? etapaAnterior : null,
        etapa_nueva: cambioEtapa ? payload.etapa : null,
        snapshot: data,
      })
    } else {
      const { data, error } = await db.from('freakie_flow_objetivos').insert(payload).select().single()
      if (error) { toast.error('Error: ' + error.message); return }
      await logHistorial({ objetivo_id: data.id, accion: 'creado', titulo: data.titulo, responsable: data.responsable, snapshot: data })
    }
    setEditing(null)
    loadData()
    loadHistorial()
  }

  const eliminar = async (objetivo) => {
    const { error } = await db.from('freakie_flow_objetivos').delete().eq('id', objetivo.id)
    if (error) { toast.error('Error: ' + error.message); return }
    await logHistorial({
      objetivo_id: objetivo.id,
      accion: 'eliminado',
      titulo: objetivo.titulo,
      responsable: objetivo.responsable,
      etapa_anterior: objetivo.etapa,
      snapshot: objetivo,
    })
    setEditing(null)
    loadData()
    loadHistorial()
  }

  const restaurar = async (entry) => {
    const snap = entry.snapshot || {}
    if (!snap.titulo) { toast.error('Este registro no tiene datos suficientes para restaurar.'); return }
    const payload = {
      titulo: snap.titulo,
      entregable: snap.entregable || null,
      responsable: snap.responsable || 'adri',
      etapa: snap.etapa || 'definicion',
      scope: snap.scope || 'semanal',
      deadline: snap.deadline || null,
      notas: snap.notas || null,
      checklist: snap.checklist || [],
    }
    const { data, error } = await db.from('freakie_flow_objetivos').insert(payload).select().single()
    if (error) { toast.error('Error al restaurar: ' + error.message); return }
    await logHistorial({ objetivo_id: data.id, accion: 'creado', titulo: data.titulo, responsable: data.responsable, snapshot: { ...data, restaurado_de: entry.id } })
    loadData()
    loadHistorial()
  }

  const nuevoObjetivo = () => setEditing({ titulo: '', responsable: 'adri', etapa: 'definicion', scope: 'semanal', checklist: [] })

  const btnTab = (active) => ({
    background: active ? RED : 'none', color: active ? '#fff' : MUTED,
    border: active ? 'none' : `1px solid ${LINE}`, borderRadius: 10, padding: '8px 16px',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  })
  const btnPeriodo = (active) => ({
    background: active ? SURFACE_2 : 'none', color: active ? INK : MUTED,
    border: `1px solid ${active ? INK + '33' : LINE}`, borderRadius: 8, padding: '5px 12px',
    fontSize: 12, fontWeight: 700, cursor: 'pointer',
  })

  if (loading) return <div style={{ padding: 20, color: MUTED, textAlign: 'center' }}>Cargando Freakie Flow...</div>

  return (
    <div style={{ padding: '16px 12px', maxWidth: 820, margin: '0 auto', background: BG }}>
      <h2 style={{ color: INK, margin: '0 0 4px' }}>📅 Freakie Flow</h2>
      <p style={{ color: MUTED, fontSize: 13, margin: '0 0 16px' }}>Puntos de contacto con el cliente en desarrollo — la reunión de los lunes de Marketing.</p>

      {/* Roster del equipo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 16 }}>
        {TEAM_ORDER.map(k => {
          const t = TEAM[k]
          return (
            <div key={k} style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Avatar who={k} size={22} />
                <div style={{ color: INK, fontWeight: 700, fontSize: 12.5 }}>{t.name}</div>
              </div>
              <div style={{ color: MUTED, fontSize: 10.5, lineHeight: 1.3, marginBottom: 4 }}>{t.role}</div>
              <div style={{ color: t.color, fontSize: 11, fontWeight: 700 }}>{porPersona[k]} tareas activas</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button style={btnTab(vista === 'lunes')} onClick={() => setVista('lunes')}>Vista de los lunes</button>
        <button style={btnTab(vista === 'kanban')} onClick={() => setVista('kanban')}>Flujo interno · Kanban</button>
        <button style={btnTab(vista === 'historial')} onClick={() => setVista('historial')}>Historial</button>
        <button onClick={nuevoObjetivo} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${RED}88`, color: RED, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Objetivo
        </button>
      </div>

      {vista === 'lunes' && (
        <>
          <Section
            title="🎯 Misiones de la semana"
            items={semanal}
            onCardClick={setEditing}
            empty="Sin objetivos semanales activos."
          />
          <Section
            title="👑 Objetivos del mes"
            items={mensual}
            onCardClick={setEditing}
            empty="Sin objetivos mensuales activos."
          />
          <Section
            title="🔁 Reintentos pendientes"
            subtitle="Vencieron, pero se ejecutan igual — no desaparecen del tablero."
            items={vencidos}
            onCardClick={setEditing}
            empty="No hay objetivos vencidos. 🎉"
          />
        </>
      )}

      {vista === 'kanban' && (
        <>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, marginBottom: 18 }}>
            {ETAPA_ORDER.map(key => {
              const etapa = ETAPAS[key]
              const items = objetivos.filter(o => o.etapa === key)
              return (
                <div key={key} style={{ minWidth: 220, flex: '1 0 220px', background: SURFACE_2, borderRadius: 12, border: `1px solid ${LINE}`, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <span>{etapa.icon}</span>
                    <span style={{ color: etapa.color, fontWeight: 800, fontSize: 12.5 }}>{etapa.label}</span>
                    <span style={{ marginLeft: 'auto', color: MUTED, fontSize: 11 }}>{items.length}</span>
                  </div>
                  {items.map(o => (
                    <div key={o.id} onClick={() => setEditing(o)} style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, marginBottom: 8, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ color: INK, fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{o.titulo}</div>
                        <Avatar who={o.responsable} size={20} />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          <div style={{ color: INK, fontWeight: 800, fontSize: 14, marginBottom: 8 }}>Guía de etapas</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, color: '#ccc' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                  <th style={{ textAlign: 'left', padding: 8, color: MUTED }}>#</th>
                  <th style={{ textAlign: 'left', padding: 8, color: MUTED }}>Etapa</th>
                  <th style={{ textAlign: 'left', padding: 8, color: MUTED }}>¿Qué significa?</th>
                  <th style={{ textAlign: 'left', padding: 8, color: MUTED }}>¿Cuándo avanza?</th>
                </tr>
              </thead>
              <tbody>
                {ETAPA_ORDER.map((key, i) => {
                  const etapa = ETAPAS[key]
                  return (
                    <tr key={key} style={{ borderBottom: `1px solid #222` }}>
                      <td style={{ padding: 8, color: MUTED }}>{i + 1}</td>
                      <td style={{ padding: 8, color: etapa.color, fontWeight: 700 }}>{etapa.icon} {etapa.label}</td>
                      <td style={{ padding: 8 }}>{etapa.significa}</td>
                      <td style={{ padding: 8 }}>{etapa.avanza}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {vista === 'historial' && (
        <>
          <div style={{ color: MUTED, fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
            Registro de todo lo que pasa con los objetivos — sobre todo lo eliminado, que queda guardado acá para siempre (no se puede editar ni borrar) y sirve para medir el avance semana a semana o mes a mes.
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button style={btnPeriodo(periodo === 'semana')} onClick={() => setPeriodo('semana')}>Esta semana</button>
            <button style={btnPeriodo(periodo === 'mes')} onClick={() => setPeriodo('mes')}>Este mes</button>
            <button style={btnPeriodo(periodo === 'todo')} onClick={() => setPeriodo('todo')}>Todo</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Creados', val: stats.creados, color: ACCION_META.creado.color },
              { label: 'Cambios de etapa', val: stats.cambios, color: ACCION_META.etapa_cambiada.color },
              { label: 'Finalizados', val: stats.finalizados, color: '#E8C158' },
              { label: 'Eliminados', val: stats.eliminados, color: ACCION_META.eliminado.color },
            ].map((s, i) => (
              <div key={i} style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 10, color: MUTED }}>{s.label}</div>
              </div>
            ))}
          </div>

          {historialFiltrado.length === 0 ? (
            <div style={{ color: '#666', fontSize: 12.5, background: SURFACE_2, border: `1px dashed ${LINE}`, borderRadius: 12, padding: 14, textAlign: 'center' }}>
              Sin movimientos en este período.
            </div>
          ) : historialFiltrado.map(h => (
            <HistorialRow key={h.id} entry={h} onRestaurar={restaurar} />
          ))}
        </>
      )}

      {editing && (
        <EditModal
          objetivo={editing}
          onClose={() => setEditing(null)}
          onSave={guardar}
          onDelete={eliminar}
        />
      )}
      <toast.Toast />
    </div>
  )
}
