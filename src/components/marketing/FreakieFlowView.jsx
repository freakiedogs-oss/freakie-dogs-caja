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

const BG = '#0e0e0f'
const SURFACE = '#1a1a1a'
const SURFACE_2 = '#202022'
const LINE = '#2a2a2a'
const INK = '#f2f0ec'
const MUTED = '#9c9aa0'
const RED = '#e63946'
const DANGER = '#ff8b7a'

const isOverdue = (o) => o.deadline && o.etapa !== 'finalizado' && o.deadline < today()

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

        <div style={{ display: 'flex', gap: 8, justifyContent: isNew ? 'flex-end' : 'space-between' }}>
          {!isNew && (
            <button onClick={() => onDelete(form.id)} style={{ background: 'none', border: `1px solid ${DANGER}55`, color: DANGER, borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>
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

export default function FreakieFlowView({ user }) {
  const toast = useToast()
  const [objetivos, setObjetivos] = useState([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('lunes') // 'lunes' | 'kanban'
  const [editing, setEditing] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data, error } = await db.from('freakie_flow_objetivos').select('*').order('deadline', { ascending: true, nullsFirst: false })
    if (error) toast.error('Error cargando Freakie Flow: ' + error.message)
    setObjetivos(data || [])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData() }, [loadData])

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

  const guardar = async (form) => {
    const payload = {
      titulo: form.titulo,
      entregable: form.entregable || null,
      responsable: form.responsable,
      etapa: form.etapa || 'definicion',
      scope: form.scope || 'semanal',
      deadline: form.deadline || null,
      notas: form.notas || null,
      updated_at: new Date().toISOString(),
    }
    if (form.id) {
      const { error } = await db.from('freakie_flow_objetivos').update(payload).eq('id', form.id)
      if (error) { toast.error('Error: ' + error.message); return }
    } else {
      const { error } = await db.from('freakie_flow_objetivos').insert(payload)
      if (error) { toast.error('Error: ' + error.message); return }
    }
    setEditing(null)
    loadData()
  }

  const eliminar = async (id) => {
    const { error } = await db.from('freakie_flow_objetivos').delete().eq('id', id)
    if (error) { toast.error('Error: ' + error.message); return }
    setEditing(null)
    loadData()
  }

  const nuevoObjetivo = () => setEditing({ titulo: '', responsable: 'adri', etapa: 'definicion', scope: 'semanal' })

  const btnTab = (active) => ({
    background: active ? RED : 'none', color: active ? '#fff' : MUTED,
    border: active ? 'none' : `1px solid ${LINE}`, borderRadius: 10, padding: '8px 16px',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button style={btnTab(vista === 'lunes')} onClick={() => setVista('lunes')}>Vista de los lunes</button>
        <button style={btnTab(vista === 'kanban')} onClick={() => setVista('kanban')}>Flujo interno · Kanban</button>
        <button onClick={nuevoObjetivo} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${RED}88`, color: RED, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Objetivo
        </button>
      </div>

      {vista === 'lunes' ? (
        <>
          <Section
            title="🎯 Misiones de la semana"
            items={semanal}
            onCardClick={setEditing}
            empty="Sin objetivos semanales activos."
          />
          <Section
            title="👑 Jefes del mes"
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
      ) : (
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
