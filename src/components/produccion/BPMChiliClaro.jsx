import { useEffect, useState } from 'react'
import { Controles } from './BPMControles'
import { TEMAS, TemaBPM, Pill, Ayuda, estilos, fmtNum, limpiarNumero, mostrarNumero, useFuentesClaras } from './bpmTema'
import { uiDePaso, CLASES, FASES } from './bpmChiliV2Ui'

/* ═══════════════════════════════════════════════════════════════════════
   BPM Chili · versión Mauricio · pantalla en el formato del anexo

   Es la «vista» del anexo FD-CI-DO-013-A01 (Marco común): barra de
   aplicación con la marca, riel de pasos, encabezado con clase de control,
   franja de criterio de aceptación con acceso a los documentos, tarjetas de
   captura y un pie con una sola acción de 48 px.

   No tiene lógica propia: recibe de BPMChiliView el modelo `m` (estado,
   evaluación y acciones) y solo lo pinta. La piloto sigue usando la
   pantalla oscura de siempre; esta se abre cuando la plantilla es la v2.
   ═══════════════════════════════════════════════════════════════════════ */

const T = TEMAS.claro
const S = estilos(T)

const hhmmss = (d) => d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/El_Salvador' })
const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador' }) : '—'
const mmss = (seg) => {
  const s = Math.max(0, Math.round(seg || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// Lote CHI-AAMMDD-NN del anexo. La base todavía no lo genera: se deriva de la
// fecha de la tanda hasta que el servidor lo asigne (T10, open_run).
const loteDe = (corrida) => {
  if (!corrida) return null
  if (corrida.lote) return corrida.lote
  const f = String(corrida.fecha || '').replace(/-/g, '')
  return f.length === 8 ? `CHI-${f.slice(2)}-01` : null
}

// Estilos responsivos (media queries no se pueden en línea).
const CSS = `
.bpm2 { background: ${T.bg}; color: ${T.txt}; font-family: ${T.fontBase}; min-height: 100vh; -webkit-font-smoothing: antialiased; }
.bpm2 * { box-sizing: border-box; }
.bpm2 select, .bpm2 input, .bpm2 button { font-family: inherit; }
.bpm2 select { appearance: auto; -webkit-appearance: menulist; background: #fff; color: ${T.txt}; }
.bpm2 input[type=date], .bpm2 input[type=time] { color-scheme: light; }
.bpm2-barra { background: ${T.barra}; color: #fff; height: 52px; display: flex; align-items: center; gap: 14px; padding: 0 16px; position: sticky; top: 0; z-index: 30; }
.bpm2-marca { color: ${T.marca}; font-weight: 900; font-style: italic; font-size: 22px; letter-spacing: -.5px; white-space: nowrap; text-shadow: 0 1px 0 #7a0000; }
.bpm2-barra .sep { width: 1px; height: 26px; background: #444; }
.bpm2-barra .sist { font-weight: 700; font-size: 16px; white-space: nowrap; }
.bpm2-barra .lote { color: #cfcfcf; font-size: 15px; white-space: nowrap; }
.bpm2-barra .modo { margin-left: auto; border: 1.5px solid #cfcfcf; border-radius: 999px; padding: 4px 14px; font-size: 14px; white-space: nowrap; }
.bpm2-barra .modo.rev { border-style: dashed; color: #fcd34d; border-color: #fcd34d; }
.bpm2-barra .usuario { font-size: 14px; color: #ddd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.bpm2-barra .reloj { font-weight: 700; font-size: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bpm2-riel { display: flex; gap: 8px; padding: 10px 16px; overflow-x: auto; background: #fff; border-bottom: 1px solid ${T.line}; scrollbar-width: thin; }
.bpm2-riel .paso { flex: 0 0 auto; height: 44px; min-width: 44px; border-radius: 22px; border: 1.5px solid ${T.line}; background: ${T.bg}; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; color: ${T.dim}; font-size: 14px; }
.bpm2-riel .paso.ok { background: ${T.okBg}; color: ${T.ok}; border-color: ${T.okBg}; }
.bpm2-riel .paso.act { border: 2px solid ${T.bad}; background: #fff; color: ${T.txt}; font-weight: 700; padding-right: 16px; }
.bpm2-riel .paso.act .num { background: #fff; color: ${T.bad}; border: 1.5px solid ${T.bad}; }
.bpm2-riel .paso.ret { border: 2px solid ${T.bad}; background: #fff; color: ${T.txt}; font-weight: 700; padding-right: 16px; }
.bpm2-riel .paso .num { width: 26px; height: 26px; border-radius: 13px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; }
.bpm2-cuerpo { max-width: 1180px; margin: 0 auto; padding: 14px 16px 120px; }
.bpm2-enc { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.bpm2-enc h1 { font-family: ${T.fontTitulo}; font-size: 26px; font-weight: 700; margin: 0; line-height: 1.2; flex: 1 1 320px; }
.bpm2-clase { display: inline-block; font-size: 12.5px; font-weight: 800; letter-spacing: .3px; border-radius: 6px; padding: 5px 9px; line-height: 1; }
.bpm2-clase.solido { background: ${T.txt}; color: #fff; }
.bpm2-clase.contorno { background: #fff; color: ${T.txt}; border: 1.5px solid ${T.txt}; }
.bpm2-clase.claro { background: ${T.neutroBg}; color: ${T.txt}; }
.bpm2-sub { color: ${T.dim}; font-size: 14px; margin: 4px 0 10px; }
.bpm2-crit { border-top: 1px solid ${T.line}; border-bottom: 1px solid ${T.line}; padding: 12px 0 10px; margin: 0 -16px 14px; padding-left: 16px; padding-right: 16px; background: ${T.bg}; }
.bpm2-crit .tit { color: ${T.bad}; font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.bpm2-crit .txt { font-size: 16px; font-weight: 600; margin-bottom: 10px; line-height: 1.4; }
.bpm2-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.bpm2-chip { display: inline-flex; align-items: center; gap: 6px; border: 1.5px solid ${T.line}; background: #fff; border-radius: 6px; padding: 7px 11px; font-size: 14px; font-weight: 700; color: ${T.bad}; cursor: pointer; min-height: 40px; }
.bpm2-chip small { color: ${T.dim}; font-weight: 500; font-size: 12px; }
.bpm2-chip.pend { border-style: dashed; color: ${T.dim}; cursor: default; }
.bpm2-card { background: #fff; border: 1px solid ${T.line}; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.bpm2-card.marcada { border-top: 3px solid ${T.txt}; }
.bpm2-card h2 { font-family: ${T.fontTitulo}; font-size: 18px; font-weight: 700; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bpm2-nota { border: 1.5px solid ${T.warn}; background: #fff; border-radius: 8px; padding: 12px 14px; font-size: 14.5px; line-height: 1.55; margin-bottom: 12px; }
.bpm2-nota.roja { border-color: ${T.bad}; border-left-width: 5px; }
.bpm2-nota.azul { border-color: ${T.acc}; border-left-width: 5px; }
.bpm2-pie { position: fixed; left: 0; right: 0; bottom: 0; background: ${T.bg}; border-top: 1px solid ${T.line}; padding: 10px 16px 14px; z-index: 25; }
.bpm2-pie .txt { color: ${T.dim}; font-size: 14px; margin-bottom: 8px; line-height: 1.4; max-width: 1180px; margin-left: auto; margin-right: auto; }
.bpm2-pie .txt.mal { color: ${T.bad}; font-weight: 600; }
.bpm2-btn { display: block; width: 100%; max-width: 1180px; margin: 0 auto; height: 48px; border-radius: 8px; border: none; font-size: 17px; font-weight: 700; cursor: pointer; background: ${T.txt}; color: #fff; }
.bpm2-btn:disabled { background: #c9c9c5; color: #5a5a5a; cursor: not-allowed; }
.bpm2-btn.rojo { background: ${T.bad}; }
.bpm2-btn.blanco { background: #fff; color: ${T.txt}; border: 1.5px solid ${T.txt}; }
.bpm2-btn.sec { background: #fff; color: ${T.txt}; border: 1.5px solid ${T.txt}; height: 44px; font-size: 15px; width: auto; display: inline-block; padding: 0 18px; margin: 0; }
.bpm2-kpi { font-family: ${T.fontTitulo}; font-size: 56px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.bpm2-kpi small { font-size: 22px; color: ${T.dim}; font-weight: 600; margin-left: 6px; }
.bpm2-bar { height: 10px; border-radius: 5px; background: #d9d9d4; overflow: hidden; margin: 12px 0 8px; }
.bpm2-bar > div { height: 100%; background: ${T.acc}; transition: width .4s; }
.bpm2-t { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.bpm2-t th { text-align: left; color: ${T.dim}; font-weight: 500; font-size: 13.5px; padding: 6px 8px; border-bottom: 2px solid ${T.txt}; white-space: nowrap; }
.bpm2-t td { padding: 10px 8px; border-bottom: 1px solid ${T.line}; vertical-align: middle; }
.bpm2-t td.num, .bpm2-t th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bpm2-seg { display: inline-flex; border: 1.5px solid ${T.txt}; border-radius: 8px; overflow: hidden; min-height: 44px; }
.bpm2-seg button { min-width: 110px; padding: 0 16px; border: none; background: #fff; color: ${T.txt}; font-weight: 600; font-size: 15px; cursor: pointer; }
.bpm2-seg button.on { background: ${T.txt}; color: #fff; }
.bpm2-seg button:disabled { color: #aaa; cursor: not-allowed; }
.bpm2 input[type=radio] { accent-color: ${T.txt}; }
.bpm2 select { max-width: 100%; }
.bpm2-modal { position: fixed; inset: 0; background: #e9e9e6; z-index: 50; display: flex; flex-direction: column; }
.bpm2-tabs { display: flex; gap: 4px; padding: 10px 12px 0; background: #dcdcd8; align-items: flex-end; }
.bpm2-tab { background: #efefec; border: 1px solid #cfcfca; border-bottom: none; border-radius: 8px 8px 0 0; padding: 12px 16px; font-size: 15px; font-weight: 700; cursor: pointer; display: flex; gap: 8px; align-items: center; color: ${T.txt}; }
.bpm2-tab.on { background: #fff; border-top: 4px solid ${T.bad}; }
.bpm2-tab small { color: ${T.dim}; font-weight: 500; }
.bpm2-doc { flex: 1; overflow: auto; padding: 20px 16px; }
.bpm2-doc .hoja { background: #fff; border: 1px solid #cfcfca; max-width: 860px; margin: 0 auto; padding: 28px 30px; min-height: 60vh; font-size: 16px; line-height: 1.6; }
.bpm2-doc h3 { font-family: ${T.fontTitulo}; font-size: 22px; margin: 0 0 4px; }
.bpm2-doc .meta { color: ${T.dim}; font-size: 14.5px; border-bottom: 2px solid ${T.txt}; padding-bottom: 10px; margin-bottom: 14px; }
.bpm2-doc .cita { border-left: 4px solid ${T.txt}; background: #f3f3f0; padding: 10px 14px; font-weight: 600; margin: 8px 0 14px; }
.bpm2-modal .pie { background: ${T.bg}; border-top: 1px solid ${T.line}; padding: 10px 16px 14px; }
.bpm2-hist td { padding: 8px 6px; border-bottom: 1px solid ${T.line}; font-size: 14px; }
.bpm2-hist td:first-child { white-space: nowrap; }
@media (max-width: 700px) {
  .bpm2-barra { height: auto; flex-wrap: wrap; padding: 8px 12px; gap: 8px; }
  .bpm2-barra .lote, .bpm2-barra .sep, .bpm2-barra .usuario { display: none; }
  .bpm2-barra .marca-sist { display: none; }
  .bpm2-enc h1 { font-size: 22px; }
  .bpm2-cuerpo { padding: 12px 12px 130px; }
  .bpm2-crit { margin: 0 -12px 12px; padding-left: 12px; padding-right: 12px; }
  .bpm2-kpi { font-size: 44px; }
  .bpm2-t { font-size: 13.5px; }
}
`

function Estilos() {
  useEffect(() => {
    if (document.getElementById('bpm2-css')) return
    const s = document.createElement('style'); s.id = 'bpm2-css'; s.textContent = CSS
    document.head.appendChild(s)
  }, [])
  return null
}

const Candado = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="bloqueado">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

const Clase = ({ clase }) => {
  const c = CLASES[clase]
  if (!c) return null
  return <span className={`bpm2-clase ${c.estilo}`} title={c.nombre}>{c.etiqueta}</span>
}

// ── Barra de aplicación ──
function Barra({ m, lote }) {
  const nombre = [m.user?.nombre, m.user?.apellido].filter(Boolean).join(' ') || 'usuario'
  return (
    <div className="bpm2-barra">
      <span className="bpm2-marca">Freakie Dogs</span>
      <span className="sep" />
      <span className="sist">Control BPM</span>
      <span className="lote">{lote || (m.plantilla?.version ? m.plantilla.version : 'Chili')}</span>
      <span className={`modo ${m.enRevision ? 'rev' : ''}`}>{m.enRevision ? 'Revisión' : m.corrida ? 'Producción' : (m.plantilla?.activo ? 'Producción' : 'En pruebas')}</span>
      <span className="usuario">{nombre}</span>
      <span className="reloj">{hhmmss(m.horaServidor())}</span>
    </div>
  )
}

// ── Riel de pasos ──
function Riel({ m }) {
  const { pasos, registros, corrida } = m
  return (
    <div className="bpm2-riel" role="list" aria-label="Pasos del proceso">
      {pasos.map(p => {
        const r = [...registros].reverse().find(x => x.paso_id === p.id)
        const ui = uiDePaso(p)
        const actual = corrida && p.orden === corrida.paso_actual && corrida.estado !== 'completada'
        const retenido = actual && corrida.estado === 'bloqueada'
        const hecho = r?.cumple === true && !actual
        const cls = retenido ? 'ret' : actual ? 'act' : hecho ? 'ok' : ''
        return (
          <div key={p.id} className={`paso ${cls}`} role="listitem" title={p.titulo} aria-current={actual ? 'step' : undefined}>
            {retenido ? <span className="num" style={{ color: T.bad, border: `1.5px solid ${T.bad}` }}>✕</span>
              : actual ? <span className="num">{p.orden}</span>
              : hecho ? <span aria-label="conforme">✓</span>
              : <Candado />}
            {(actual || retenido) && <span>{p.orden} {ui?.corto || p.titulo}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── Ventana de documentos (DocViewer): una pestaña por documento ──
function DocViewer({ docs, paso, ui, cat, inicial, onCerrar }) {
  const [tab, setTab] = useState(inicial || 0)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [onCerrar])
  const d = docs[tab]
  return (
    <div className="bpm2-modal" role="dialog" aria-modal="true" aria-label="Documentos del paso">
      <div className="bpm2-tabs">
        {docs.map((x, i) => (
          <button key={i} type="button" className={`bpm2-tab ${i === tab ? 'on' : ''}`} onClick={() => setTab(i)}>
            {x.codigo}{x.version && <small>{x.version}</small>}
          </button>
        ))}
        <button type="button" onClick={onCerrar} aria-label="Cerrar" style={{ marginLeft: 'auto', marginBottom: 6, width: 44, height: 44, borderRadius: 8, border: `1.5px solid ${T.txt}`, background: '#fff', fontSize: 20, cursor: 'pointer' }}>✕</button>
      </div>
      <div className="bpm2-doc">
        <div className="hoja">
          {d?.tipo === 'do' && d.codigo.startsWith('DO-013') && (
            <>
              <h3>FD-CI-DO-013</h3>
              <div className="meta">Elaboración de chili con carne · paso {paso.orden} · {ui?.titulo || paso.titulo}<br />Versión 02 · vigente desde 22-09-2026</div>
              {ui?.criterio && <><b>Criterio de aceptación</b><div className="cita">{ui.criterio}</div></>}
              <b>Procedimiento</b>
              <div style={{ whiteSpace: 'pre-line', marginTop: 6 }}>{paso.instruccion || 'Sin texto cargado para este paso.'}</div>
            </>
          )}
          {d?.tipo === 'video' && (
            <>
              <h3>{d.largo}</h3>
              <div className="meta">Video del paso {paso.orden} · {d.version}</div>
              {paso.video_url
                ? <video src={paso.video_url} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 720, borderRadius: 8, border: `1px solid ${T.line}` }} />
                : <div className="cita">Video pendiente de cargar en Documentos controlados (T19).</div>}
            </>
          )}
          {d?.tipo === 'do' && !d.codigo.startsWith('DO-013') && (
            <>
              <h3>{d.largo.split(' · ')[0]}</h3>
              <div className="meta">{d.largo.split(' · ').slice(1).join(' · ')}</div>
              <div className="cita">Documento {d.estado === 'pendiente' ? 'mapeado en la Lista Maestra FD-CI-LM-001 v02 · pendiente de elaboración' : 'vigente'}. Su contenido se consulta con Calidad hasta que se cargue en Documentos controlados.</div>
            </>
          )}
          {d?.tipo === 'instructivo' && (
            <>
              <h3>{d.largo.split(' · ')[0]}</h3>
              <div className="meta">{d.largo.split(' · ').slice(1).join(' · ')} · {d.version}</div>
              <div className="cita">Instructivo mapeado en la Lista Maestra FD-CI-LM-001 v02. El procedimiento del paso está en la pestaña DO-013.</div>
            </>
          )}
          {d?.tipo === 'concentraciones' && (
            <>
              <h3>Concentraciones y tiempos de contacto</h3>
              <div className="meta">Catálogo de químicos de Calidad · vigente hoy</div>
              <table className="bpm2-t">
                <thead><tr><th>Químico</th><th>Categoría</th><th className="num">Rango</th><th className="num">Contacto</th><th>Proveedor</th></tr></thead>
                <tbody>
                  {(cat?.quimicos || []).map(q => (
                    <tr key={q.id}>
                      <td><b>{q.nombre}</b></td>
                      <td>{q.categoria}</td>
                      <td className="num">{q.concentracion_min ?? '…'}–{q.concentracion_max ?? '…'} {q.unidad_concentracion || ''}</td>
                      <td className="num">{q.tiempo_contacto_seg != null ? `≥ ${q.tiempo_contacto_seg} s` : '—'}</td>
                      <td>{q.proveedor || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      <div className="pie">
        <div style={{ color: T.dim, fontSize: 13.5, marginBottom: 8 }}>
          {d?.version ? `${d.version} · ` : ''}el paso sigue activo detrás y el temporizador no se detiene.
        </div>
        <button type="button" className="bpm2-btn blanco" onClick={onCerrar}>Volver al paso {paso.orden}</button>
      </div>
    </div>
  )
}

// ── Franja de criterio ──
function Criterio({ ui, paso, cat, onAbrir }) {
  if (!ui) return null
  const docs = ui.docs || []
  return (
    <div className="bpm2-crit">
      <div className="tit"><span aria-hidden>◎</span> Criterio de aceptación</div>
      <div className="txt">{ui.criterio}</div>
      <div className="bpm2-chips">
        {docs.map((d, i) => (
          <button key={i} type="button" className={`bpm2-chip ${d.estado === 'pendiente' ? 'pend' : ''}`} onClick={() => onAbrir(i)}>
            <span aria-hidden>{d.tipo === 'video' ? '▶' : '▤'}</span> {d.codigo}
            <small>{d.estado === 'pendiente' ? 'pendiente' : d.version}</small>
          </button>
        ))}
        {ui.concentraciones && (
          <button type="button" className="bpm2-chip" onClick={() => onAbrir(docs.length)}>
            <span aria-hidden>⚗</span> Concentraciones
          </button>
        )}
      </div>
    </div>
  )
}

// ── Fila simple del anexo (etiqueta · control · resultado) ──
function Fila({ etiqueta, porque, ayuda, children, sinBorde }) {
  return (
    <div style={{ ...S.fila, ...(sinBorde ? { borderTop: 'none' } : {}) }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>{etiqueta}</span>{ayuda && <Ayuda texto={ayuda} />}</div>
        {porque && <div style={S.porque}>{porque}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  )
}

function Numero({ valor, onChange, unidad, mal, placeholder }) {
  const lleno = valor !== '' && valor != null
  return (
    <div style={{ display: 'inline-flex', width: 200, minHeight: 44, borderRadius: 8, overflow: 'hidden', border: `1.5px solid ${lleno && mal ? T.bad : lleno ? T.ok : '#8a8a8a'}`, background: '#fff' }}>
      <input type="text" inputMode="decimal" value={mostrarNumero(valor)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === ',') e.preventDefault() }}
        onChange={e => onChange(limpiarNumero(e.target.value))}
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: T.txt, padding: '10px 12px', fontSize: 17, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
      {unidad && <span style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderLeft: `1px solid ${T.line}`, color: T.dim, fontSize: 14 }}>{unidad}</span>}
    </div>
  )
}

// ── Temporizador por fases (sellado, vegetales, reducción) ──
function Temporizador({ m }) {
  const p = m.pasoActual
  const fases = p.temporizador || []
  if (!fases.length) return null
  const { fase, restan, hechas } = m
  const total = fases.reduce((a, f) => a + f.s, 0)
  const corridas = hechas.reduce((a, i) => a + (fases[i]?.s || 0), 0) + (fase != null ? fases[fase].s - restan : 0)
  return (
    <div className="bpm2-card marcada">
      <h2>Temporizador <Ayuda texto="Tocá cada fase cuando la vayas a empezar. Suena al terminar. Las fases con encadenado automático arrancan solas." /></h2>
      {fase != null ? (
        <>
          <div style={{ color: T.acc, fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{fases[fase].t}</div>
          <div className="bpm2-kpi" style={{ color: restan <= 10 ? T.bad : T.txt }}>{mmss(restan)}<small>/ {mmss(fases[fase].s)} min</small></div>
          <div className="bpm2-bar"><div style={{ width: `${total ? 100 * corridas / total : 0}%` }} /></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: T.dim, fontSize: 14 }}>Fase {fase + 1} de {fases.length}</span>
            <button type="button" className="bpm2-btn sec" onClick={() => { m.setFase(null); m.setRestan(0) }}>Cancelar</button>
          </div>
        </>
      ) : (
        <>
          {fases.map((f, i) => {
            const lista = hechas.includes(i)
            return (
              <Fila key={i} etiqueta={f.t} porque={f.auto ? 'Arranca sola al terminar la anterior' : null}>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: T.dim }}>{mmss(f.s)}</span>
                {lista ? <Pill tipo="ok">Hecha</Pill>
                  : <button type="button" className="bpm2-btn sec" onClick={() => { m.setFase(i); m.setRestan(f.s) }}>Iniciar</button>}
              </Fila>
            )
          })}
          {hechas.length > 0 && (
            <button type="button" onClick={() => m.setHechas([])} style={{ marginTop: 10, background: 'none', border: `1px solid ${T.line}`, color: T.dim, borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>
              Reiniciar el conteo de fases
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── Pesaje (T03): tabla de ingredientes con lo que llegó de la tablet ──
function Pesaje({ m }) {
  const { pesajeItems, pesajes, pesajeHechos, pesajeMalos, pesajeListo, enRevision } = m
  const pct = (it, p) => {
    const o = Number(it.gramos_objetivo); if (!o || !p) return null
    return (Number(p.g) - o) / o * 100
  }
  return (
    <div className="bpm2-card">
      <h2>
        Ingredientes de la fórmula · {pesajeHechos} de {pesajeItems.length}
        <Ayuda texto="El pesaje se hace en la tablet cableada a la báscula. Esta pantalla solo muestra lo que llegó; tocá «Actualizar» si acabás de pesar." />
        <span style={{ marginLeft: 'auto' }}>
          {enRevision ? <Pill tipo="neutro">En revisión no aplica</Pill>
            : pesajeListo ? (pesajeMalos ? <Pill tipo="warn">{pesajeMalos} fuera de tolerancia</Pill> : <Pill tipo="ok">{pesajeItems.length} de {pesajeItems.length} dentro de tolerancia</Pill>)
            : <Pill tipo="espera">Faltan {pesajeItems.length - pesajeHechos}</Pill>}
        </span>
      </h2>
      {!pesajeItems.length && !enRevision && (
        <div className="bpm2-nota roja">Este paso no tiene ingredientes cargados para esta versión del proceso. Avisá a Calidad: sin fórmula no se puede pesar.</div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="bpm2-t" style={{ minWidth: 720 }}>
          <thead><tr>
            <th>Ingrediente</th><th className="num">Objetivo</th><th className="num">Tol.</th><th className="num">Real</th>
            <th>Báscula</th><th>Lote / recepción</th><th>Vence</th><th>Resultado</th>
          </tr></thead>
          <tbody>
            {pesajeItems.map(it => {
              const p = pesajes[it.id]
              const b = m.banda(it)
              const d = pct(it, p)
              const falta = (pide, val) => it[pide] && !val
              return (
                <tr key={it.id}>
                  <td>{it.ingrediente}{p?.motivo && <div style={{ fontSize: 12.5, color: T.bad }}>{p.motivo}</div>}</td>
                  <td className="num">{fmtNum(it.gramos_objetivo, 0)} {it.unidad}</td>
                  <td className="num">{Number(it.tolerancia_pct) > 0 ? `±${fmtNum(it.tolerancia_pct, 0)} %` : `±${fmtNum(b, b < 1 ? 2 : 0)}`}</td>
                  <td className="num" style={{ fontWeight: p?.cumple === false ? 700 : 400 }}>{p ? `${fmtNum(p.g, 0)} ${it.unidad}` : '—'}</td>
                  <td>{p?.bascula || '—'}</td>
                  <td style={{ color: p && falta('requiere_lote', p.lote) ? T.bad : undefined }}>{p ? (p.lote || (it.requiere_lote ? 'falta' : '—')) : '—'}</td>
                  <td style={{ color: p && falta('requiere_vencimiento', p.vencimiento) ? T.bad : undefined, whiteSpace: 'nowrap' }}>{p ? (p.vencimiento || (it.requiere_vencimiento ? 'falta' : '—')) : '—'}</td>
                  <td>
                    {!p ? <Pill tipo="espera">Pendiente</Pill>
                      : p.cumple === false ? <Pill tipo="bad">{d != null ? `${d > 0 ? '+' : ''}${d.toFixed(1)} %` : 'No cumple'}</Pill>
                      : <Pill tipo="ok">{d != null ? (Math.abs(d) < 0.05 ? 'Exacto' : `${d > 0 ? '+' : ''}${d.toFixed(1)} %`) : 'Cumple'}</Pill>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!enRevision && !pesajeListo && pesajeItems.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="bpm2-btn sec" onClick={m.cargarPesajes}>Actualizar desde la tablet</button>
          <span style={{ color: T.dim, fontSize: 14 }}>Andá a la tablet de la báscula, pesá y volvé acá.</span>
        </div>
      )}
      {pesajeMalos > 0 && (
        <div className="bpm2-nota" style={{ marginTop: 12 }}>
          <b>{pesajeMalos} ingrediente(s) fuera de tolerancia:</b> retirá el excedente o completá y volvé a pesar en la tablet. El primer pesaje queda como corrección en el historial.
        </div>
      )}
    </div>
  )
}

// ── Evidencia: foto del paso ──
function Evidencia({ m }) {
  const p = m.pasoActual
  const requerida = p.requiere_foto && !m.enRevision
  return (
    <div className="bpm2-card marcada">
      <h2>Evidencia · foto del paso <Ayuda texto="La foto se toma con la cámara en el momento: no se elige de la galería, así no se sube una foto de otro día. Queda con la hora del servidor." /></h2>
      <input ref={m.fileRef} type="file" accept="image/*" capture="environment" onChange={m.onFoto} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <button type="button" className="bpm2-btn" style={{ width: 'auto', padding: '0 22px', margin: 0 }} onClick={() => m.fileRef.current?.click()}>
          📷 {m.preview ? 'Tomar otra' : 'Tomar foto'}
        </button>
        {m.preview
          ? <div style={{ display: 'flex', gap: 12, alignItems: 'center', border: `1px solid ${T.line}`, borderLeft: `4px solid ${T.ok}`, borderRadius: 8, padding: 8, background: '#fff' }}>
              <img src={m.preview} alt="Evidencia del paso" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} />
              <div><b>Lista para enviar</b><div style={{ color: T.dim, fontSize: 13 }}>{hhmm(m.ahoraISO())} · cámara</div></div>
              <Pill tipo="ok">Adjunta</Pill>
            </div>
          : <Pill tipo={requerida ? 'espera' : 'neutro'}>{requerida ? 'Falta foto' : 'Opcional en revisión'}</Pill>}
      </div>
    </div>
  )
}

// ── Cabecera de la tanda: tablero (T11) cuando está retenida o completada ──
function Tablero({ m, lote }) {
  const { corrida, desviaciones, registros, pasos } = m
  const abiertas = desviaciones.filter(d => !d.resuelta_at)
  const retenida = corrida.estado === 'bloqueada'
  const [just, setJust] = useState('')
  const [dec, setDec] = useState('retest')
  const pasoRet = pasos.find(p => p.orden === corrida.paso_actual)
  const uiRet = uiDePaso(pasoRet)
  const esPCC = uiRet?.clase === 'PCC1' || uiRet?.clase === 'PCC2'
  const puedeFirmar = m.puedeLiberar && just.trim().length >= 20 && (dec !== 'liberar' || !esPCC)
  return (
    <>
      <div className="bpm2-enc">
        <span className="bpm2-clase claro">Tanda</span>
        <h1>{lote}</h1>
        {retenida ? <Pill tipo="bad">Retenida · {uiRet ? CLASES[uiRet.clase]?.etiqueta : `paso ${corrida.paso_actual}`}</Pill>
          : corrida.estado === 'completada' ? <Pill tipo="info">Registrada · pendiente de Calidad</Pill>
          : corrida.estado === 'liberada' ? <Pill tipo="ok">Liberada por Calidad</Pill>
          : <Pill tipo="info">En proceso</Pill>}
      </div>
      <div className="bpm2-sub">Abierta {hhmm(corrida.iniciada_at)} · {registros.filter(r => r.cumple).length} de {pasos.length} pasos conformes</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="bpm2-card marcada" style={{ margin: 0 }}><div className="bpm2-kpi">{abiertas.length}</div><div style={{ color: T.dim, marginTop: 6 }}>Desviación{abiertas.length === 1 ? '' : 'es'} abierta{abiertas.length === 1 ? '' : 's'}</div></div>
        <div className="bpm2-card" style={{ margin: 0 }}><div className="bpm2-kpi">{registros.filter(r => !r.cumple).length}</div><div style={{ color: T.dim, marginTop: 6 }}>Intentos retenidos en la tanda</div></div>
        <div className="bpm2-card" style={{ margin: 0 }}><div className="bpm2-kpi">{corrida.estado === 'liberada' ? 1 : 0}</div><div style={{ color: T.dim, marginTop: 6 }}>Liberaciones · la tanda solo la libera Calidad</div></div>
      </div>

      {retenida && (
        <div className="bpm2-nota roja">
          <b>Qué tenés que hacer ahora:</b> mantené la contención del paso {corrida.paso_actual} ({uiRet?.titulo || pasoRet?.titulo}). El paso se repite como intento {(registros.filter(r => r.paso_id === pasoRet?.id).length || 0) + 1} cuando Calidad lo habilite. No sigas al paso siguiente.
        </div>
      )}
      {corrida.estado === 'completada' && (
        <div className="bpm2-nota azul"><b>Registro guardado · pendiente de Calidad.</b> Los {pasos.length} pasos quedaron con hora y responsable. Guardar no es liberar: solo Calidad libera, con todas las desviaciones cerradas.</div>
      )}

      {desviaciones.length > 0 && (
        <div className="bpm2-card">
          <h2>Desviaciones de la tanda</h2>
          {desviaciones.map(d => {
            const p = pasos.find(x => x.id === d.paso_id)
            return (
              <div key={d.id} style={{ ...S.fila, alignItems: 'flex-start' }}>
                <div style={{ width: 74, flexShrink: 0, color: T.dim, fontVariantNumeric: 'tabular-nums' }}>{hhmm(d.creada_at)}</div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div>{p ? `Paso ${p.orden} · ` : ''}{d.detalle}</div>
                  <div style={S.porque}>Criterio {d.valor_esperado} · se midió <b>{d.valor_real}</b>{d.causa ? ` · causa: ${d.causa}` : ''}{d.accion ? ` · acción: ${d.accion}` : ''}</div>
                  {d.resuelta_at && <div style={S.porque}>Decisión de Calidad: {d.resolucion}</div>}
                </div>
                {d.resuelta_at ? <Pill tipo="ok">Cerrada</Pill> : <Pill tipo="bad">Abierta</Pill>}
              </div>
            )
          })}
        </div>
      )}

      {retenida && m.puedeLiberar && (
        <div className="bpm2-card marcada">
          <h2>Decisión de Calidad · disposiciones permitidas para un {uiRet ? CLASES[uiRet.clase]?.etiqueta : 'paso'}</h2>
          {[
            ['retest', 'Retest', `Repetir el paso ${corrida.paso_actual} como intento ${(registros.filter(r => r.paso_id === pasoRet?.id).length || 0) + 1}.`, false],
            ['liberar', 'Liberar con justificación', esPCC ? 'No disponible para un PCC.' : 'Avanzar al paso siguiente sin repetir. Queda como excepción explícita.', esPCC],
          ].map(([k, t, sub, off]) => (
            <label key={k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', border: `1.5px solid ${dec === k && !off ? T.txt : T.line}`, borderRadius: 8, padding: '12px 14px', marginBottom: 8, opacity: off ? .5 : 1, cursor: off ? 'not-allowed' : 'pointer', background: '#fff' }}>
              <input type="radio" name="dec" value={k} checked={dec === k} disabled={off} onChange={() => setDec(k)} style={{ width: 22, height: 22, marginTop: 2 }} />
              <span><b style={{ fontSize: 16 }}>{t}</b><div style={{ color: T.dim, fontSize: 14 }}>{sub}</div></span>
            </label>
          ))}
          <textarea value={just} onChange={e => setJust(e.target.value)} rows={2} placeholder="Justificación (mínimo 20 caracteres): qué se corrigió y por qué procede."
            style={{ ...S.inp, marginTop: 4, resize: 'vertical', fontSize: 15 }} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="bpm2-btn" style={{ width: 'auto', padding: '0 22px', margin: 0 }} disabled={!puedeFirmar || m.guardando}
              onClick={() => m.liberar({ decision: dec, justificacion: just.trim() })}>
              Firmar decisión: {dec === 'retest' ? 'Retest' : 'Liberar con justificación'}
            </button>
            <span style={{ color: T.dim, fontSize: 13.5 }}>Queda con tu nombre y la hora del servidor.</span>
          </div>
        </div>
      )}
      {retenida && !m.puedeLiberar && (
        <div className="bpm2-nota">Esperando la decisión de Calidad. Avisá a Casa Matriz: no se puede seguir hasta que dispongan el retest.</div>
      )}
    </>
  )
}

// ── Abrir tanda (T10) ──
function AbrirTanda({ m }) {
  const [modo, setModo] = useState('produccion')
  const fecha = m.horaServidor().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })
  const lote = `CHI-${fecha.replace(/-/g, '').slice(2)}-01`
  const rev = modo === 'revision'
  return (
    <>
      <div className="bpm2-enc">
        <span className="bpm2-clase claro">Tanda</span>
        <h1>Abrir tanda de chili</h1>
        <Pill tipo="neutro">Sin tanda abierta hoy</Pill>
      </div>
      <div className="bpm2-sub">Una tanda de producción por día. La hora la registra el servidor, no el teléfono.</div>

      {m.plantillas.length > 1 && m.puedeRevisar && (
        <div className="bpm2-card">
          <h2>Versión del control <Ayuda texto="La piloto es la que corre en Casa Matriz hoy. La versión Mauricio aplica el anexo FD-CI-DO-013-A01: un paso fuera de criterio queda retenido y lo dispone Calidad." /></h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {m.plantillas.map(p => (
              <button key={p.id} type="button" className={`bpm2-btn ${p.id === m.plantilla?.id ? '' : 'sec'}`} style={{ width: 'auto', padding: '0 18px', margin: 0, height: 44, fontSize: 15 }} onClick={() => m.cargar(p.id)}>
                {p.version || p.nombre}{!p.activo ? ' · en pruebas' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bpm2-card marcada">
        <h2>Proceso y modo</h2>
        <Fila etiqueta="Proceso · versión" porque={m.plantilla?.descripcion?.slice(0, 120)} sinBorde>
          <b>{m.plantilla?.nombre}</b>
          {m.plantilla?.activo ? <Pill tipo="ok">Aprobada</Pill> : <Pill tipo="warn">En pruebas · no reemplaza a la piloto</Pill>}
        </Fila>
        <Fila etiqueta="Modo" porque={rev ? 'Revisión: se recorren los pasos sin fotos ni pesaje. No cuenta como producción.' : 'Producción: exige fotos, pesaje y evidencia. Genera lote.'}>
          <div className="bpm2-seg" role="radiogroup">
            <button type="button" className={modo === 'produccion' ? 'on' : ''} onClick={() => setModo('produccion')}>Producción</button>
            <button type="button" className={modo === 'revision' ? 'on' : ''} disabled={!m.puedeRevisar} onClick={() => setModo('revision')} title={!m.puedeRevisar ? 'Solo supervisores' : undefined}>Revisión</button>
          </div>
        </Fila>
      </div>
      <div className="bpm2-card">
        <h2>Lo que el sistema asigna</h2>
        <Fila etiqueta="Lote" porque="Correlativo por proceso y día (America/El_Salvador)" sinBorde><b style={{ fontFamily: T.fontTitulo, fontSize: 18 }}>{rev ? 'Sin lote · revisión' : lote}</b></Fila>
        <Fila etiqueta="Fecha de la tanda"><b>{fecha}</b></Fila>
        <Fila etiqueta="Parámetros en validación" porque="RVP-01, 02, 04, 06, 07, 08, 09, 10, 11 abiertos: la liberación de esta versión es interina hasta que Calidad los cierre.">
          <Pill tipo="info">Liberación interina</Pill>
        </Fila>
      </div>
      <Pie texto={rev ? 'Revisión y Capacitación nunca generan lote liberable.' : (m.plantilla?.activo ? 'Producción exige versión aprobada por Calidad.' : 'Esta versión está en pruebas: la tanda sirve para validar el control, no reemplaza a la piloto.')}>
        <button type="button" className="bpm2-btn" disabled={m.guardando || !m.plantilla || !m.puedeRegistrar} onClick={() => m.iniciarTanda(rev)}>
          {m.guardando ? 'Abriendo…' : rev ? 'Abrir corrida de revisión' : 'Abrir tanda de producción'}
        </button>
      </Pie>
    </>
  )
}

function Pie({ texto, mal, children }) {
  return (
    <div className="bpm2-pie">
      {texto && <div className={`txt ${mal ? 'mal' : ''}`}>{texto}</div>}
      {children}
    </div>
  )
}

// ── Historial (últimas tandas) ──
function Historial({ m }) {
  if (m.historial.length < 1) return null
  return (
    <div className="bpm2-card">
      <h2>Últimas tandas <Ayuda texto="El expediente baja en PDF: pasos con hora y responsable, químicos, pesaje con lotes y desviaciones." /></h2>
      <div style={{ overflowX: 'auto' }}><table className="bpm2-t bpm2-hist">
        <tbody>
          {m.historial.map(h => (
            <tr key={h.id}>
              <td>{h.es_revision ? '🔍 ' : ''}{loteDe(h)} · {h.fecha}</td>
              <td className="num">{hhmm(h.iniciada_at)}</td>
              <td>
                {h.estado === 'bloqueada' ? <Pill tipo="bad">Retenida</Pill>
                  : h.estado === 'completada' ? <Pill tipo="info">Pendiente de Calidad</Pill>
                  : h.estado === 'liberada' ? <Pill tipo="ok">Liberada</Pill>
                  : h.estado === 'anulada' ? <Pill tipo="neutro">Anulada</Pill>
                  : <Pill tipo="espera">En proceso</Pill>}
              </td>
              <td className="num">
                <button type="button" className="bpm2-btn sec" style={{ height: 36, fontSize: 13.5 }} disabled={m.expediente === h.id} onClick={() => m.bajarExpediente(h.id)}>
                  {m.expediente === h.id ? 'Armando…' : 'Expediente PDF'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  )
}

// ═══════════════ Vista principal ═══════════════
export default function BPMChiliClaro({ m }) {
  useFuentesClaras(true)
  const [docAbierto, setDocAbierto] = useState(null)
  const { corrida, pasoActual, plantilla } = m
  const lote = loteDe(corrida)
  const ui = uiDePaso(pasoActual)
  const enPaso = corrida && pasoActual && corrida.estado === 'en_proceso' && m.puedeRegistrar
  const intentos = pasoActual ? m.registros.filter(r => r.paso_id === pasoActual.id).length : 0
  const cerrarDoc = () => setDocAbierto(null)

  // ── Estado del paso para la pastilla del encabezado y el pie ──
  const pend = []
  if (enPaso && !m.enRevision) {
    if (pasoActual.requiere_foto && !m.foto) pend.push('foto')
    if (pasoActual.requiere_temp && m.temp === '') pend.push('temperatura')
    if (pasoActual.requiere_duracion && m.dur === '') pend.push('duración')
    if (pasoActual.requiere_pesaje && !m.pesajeListo) pend.push(`${m.pesajeItems.length - m.pesajeHechos} por pesar`)
    if (m.tieneControles) pend.push(...m.evalC.pendientes)
  }
  const hayFalla = enPaso && !m.enRevision && m.fallasVivas.length > 0
  const faltan = pend.length
  const esperando = enPaso && !m.esperaOk
  const bloqueado = m.guardando || esperando || faltan > 0 || (m.tieneControles && !m.cat.listo)

  const estadoPill = !enPaso ? null
    : m.guardando ? <Pill tipo="info">Guardando…</Pill>
    : hayFalla ? <Pill tipo="bad">Fuera de criterio</Pill>
    : esperando ? <Pill tipo="info">En espera · {mmss(pasoActual.espera_min_seg - (m.segDesdePrevio ?? 0))}</Pill>
    : faltan ? <Pill tipo="espera">Faltan {faltan} dato(s)</Pill>
    : <Pill tipo="ok">Conforme · listo para registrar</Pill>

  const textoPie = hayFalla
    ? `Fuera de criterio: ${m.fallasVivas[0].detalle}${m.fallasVivas[0].valor_real != null ? ` (se midió ${m.fallasVivas[0].valor_real}, se pide ${m.fallasVivas[0].valor_esperado})` : ''}. Corregí y volvé a medir, o retené el paso para que Calidad disponga.`
    : esperando ? `Esperá ${mmss(pasoActual.espera_min_seg - (m.segDesdePrevio ?? 0))} antes de medir.`
    : faltan ? `Faltan ${faltan} dato(s): ${pend[0]}${faltan > 1 ? ` (y ${faltan - 1} más)` : ''}.`
    : (ui?.pie || 'Conforme · listo para registrar.')

  const docs = ui ? [...(ui.docs || []), ...(ui.concentraciones ? [{ codigo: 'Concentraciones', tipo: 'concentraciones' }] : [])] : []

  return (
    <TemaBPM value={T}>
      <Estilos />
      <div className="bpm2">
        <Barra m={m} lote={lote} />
        {corrida && <Riel m={m} />}
        <div className="bpm2-cuerpo">
          {m.error && <div className="bpm2-nota roja" role="alert">{m.error}</div>}
          {m.enRevision && <div className="bpm2-nota"><b>Corrida de revisión — no es producción.</b> No se piden fotos, temperaturas ni pesaje. No queda evidencia de nada.</div>}
          {!plantilla?.activo && corrida && <div className="bpm2-nota azul"><b>Versión en pruebas.</b> Esta tanda sirve para validar el control de la versión Mauricio; no reemplaza a la piloto.</div>}

          {!corrida && <AbrirTanda m={m} />}

          {corrida && (corrida.estado === 'bloqueada' || corrida.estado === 'completada' || corrida.estado === 'liberada' || !m.puedeRegistrar) && (
            <Tablero m={m} lote={lote} />
          )}

          {enPaso && (
            <>
              <div className="bpm2-enc">
                <Clase clase={ui?.clase} />
                <h1>Paso {pasoActual.orden} · {ui?.titulo || pasoActual.titulo}</h1>
                {estadoPill}
              </div>
              <div className="bpm2-sub">
                {ui?.fase ? `${FASES[ui.fase]} · ` : ''}Intento {intentos + 1}{intentos > 0 ? ` · retest del intento ${intentos}` : ''}
                {ui?.rvp?.length ? ` · ${ui.rvp.join(', ')} en validación` : ''}
              </div>
              <Criterio ui={ui} paso={pasoActual} cat={m.cat} onAbrir={setDocAbierto} />

              {m.intentoPrevio && (
                <div className="bpm2-nota azul">
                  <b>Intento {Math.max(intentos, 1)} · {hhmm(m.intentoPrevio.registrado_at)} · Retenido</b> → Calidad dispuso el retest{corrida.liberacion_motivo ? `: «${corrida.liberacion_motivo}»` : ''}. El intento anterior queda en el historial. Repetí el paso completo.
                </div>
              )}

              {esperando && (
                <div className="bpm2-nota azul">Esperá <b>{mmss(pasoActual.espera_min_seg - (m.segDesdePrevio ?? 0))}</b> más antes de medir. Van {Math.round((m.segDesdePrevio ?? 0) / 60)} min desde el paso anterior.</div>
              )}
              {m.esperaTarde && (
                <div className="bpm2-nota">Pasaron <b>{Math.round(m.segDesdePrevio / 60)} min</b> desde el paso anterior. Se va a marcar como medición tardía.</div>
              )}

              <Temporizador m={m} />

              {m.tieneControles && (
                <Controles controles={pasoActual.controles} valores={m.valores} setValores={m.setValores}
                           cat={m.cat} hoy={m.hoy} ahoraISO={m.ahoraISO} quien={m.quien} ahora={m.ahora} />
              )}

              {pasoActual.requiere_pesaje && <Pesaje m={m} />}

              {(pasoActual.requiere_temp || pasoActual.requiere_duracion) && (
                <div className="bpm2-card">
                  <h2>Lectura del paso</h2>
                  {pasoActual.requiere_temp && (() => {
                    const n = m.temp === '' ? null : Number(m.temp)
                    const min = pasoActual.temp_min != null ? Number(pasoActual.temp_min) : null
                    const max = pasoActual.temp_max != null ? Number(pasoActual.temp_max) : null
                    const rango = min != null && max != null ? `${min} a ${max} °C` : min != null ? `≥ ${min} °C` : max != null ? `≤ ${max} °C` : null
                    const mal = n != null && ((min != null && n < min) || (max != null && n > max))
                    return (
                      <Fila etiqueta={pasoActual.temp_label || 'Temperatura'} porque={rango ? `Criterio ${rango}` : null} sinBorde
                            ayuda="Escribí la lectura tal como aparece en la pantalla del termómetro. La unidad ya está en el campo.">
                        <Numero valor={m.temp} onChange={m.setTemp} unidad="°C" mal={mal} />
                        {n == null ? <Pill tipo="espera">En espera</Pill> : mal ? <Pill tipo="bad">Fuera de {rango}</Pill> : <Pill tipo="ok">{rango ? `Dentro de ${rango}` : 'Registrada'}</Pill>}
                      </Fila>
                    )
                  })()}
                  {pasoActual.requiere_duracion && (() => {
                    const n = m.dur === '' ? null : Number(m.dur)
                    const min = pasoActual.duracion_min_seg
                    const mal = n != null && min != null && n < min
                    return (
                      <Fila etiqueta="Segundos que se sostuvo" porque={min != null ? `Criterio ≥ ${min} s` : null}>
                        <Numero valor={m.dur} onChange={m.setDur} unidad="s" mal={mal} />
                        {n == null ? <Pill tipo="espera">En espera</Pill> : mal ? <Pill tipo="bad">Menos de {min} s</Pill> : <Pill tipo="ok">Cumple</Pill>}
                      </Fila>
                    )
                  })()}
                </div>
              )}

              {pasoActual.requiere_foto && <Evidencia m={m} />}

              <div className="bpm2-card">
                <Fila etiqueta="Nota" porque="Opcional. Queda en el expediente con tu nombre." sinBorde>
                  <input value={m.nota} onChange={e => m.setNota(e.target.value)} placeholder="Observación" style={{ ...S.inp, width: 320, maxWidth: '100%' }} />
                </Fila>
              </div>

              {hayFalla && (
                <div className="bpm2-nota roja">
                  <b>Fuera de criterio.</b> Esta versión no cierra un paso con un criterio en falla.
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {m.fallasVivas.map((f, i) => (
                      <li key={i}>{f.detalle}{f.valor_real != null && <> — se midió <b>{f.valor_real}</b>{f.valor_esperado ? `, criterio ${f.valor_esperado}` : ''}</>}</li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 6 }}>Si se puede corregir, corregí y volvé a medir: el botón se habilita solo. Si no, retené el paso: se abre la desviación y Calidad dispone.</div>
                </div>
              )}

              <Pie texto={textoPie} mal={hayFalla}>
                {hayFalla
                  ? <button type="button" className="bpm2-btn rojo" disabled={m.guardando} onClick={() => m.registrarPaso({ retener: true })}>
                      {m.guardando ? 'Guardando…' : `Retener y abrir desviación · paso ${pasoActual.orden}`}
                    </button>
                  : <button type="button" className="bpm2-btn" disabled={bloqueado} onClick={() => m.registrarPaso()}>
                      {m.guardando ? 'Guardando…'
                        : esperando ? `En espera · faltan ${mmss(pasoActual.espera_min_seg - (m.segDesdePrevio ?? 0))}`
                        : faltan > 0 ? `Faltan ${faltan} dato(s)`
                        : (m.tieneControles && !m.cat.listo) ? 'Cargando catálogos…'
                        : (ui?.boton || `Registrar: paso ${pasoActual.orden}`)}
                    </button>}
              </Pie>
            </>
          )}

          {corrida && !enPaso && corrida.estado !== 'bloqueada' && (
            <Pie texto="Guardar no es liberar. Solo Calidad libera, con todas las desviaciones cerradas.">
              <button type="button" className="bpm2-btn blanco" disabled={m.expediente === corrida.id} onClick={() => m.bajarExpediente(corrida.id)}>
                {m.expediente === corrida.id ? 'Armando el PDF…' : 'Expediente de esta tanda'}
              </button>
            </Pie>
          )}
          {corrida && corrida.estado === 'bloqueada' && !m.puedeLiberar && (
            <Pie texto={`El avance a los pasos ${Math.min(corrida.paso_actual + 1, m.pasos.length)}–${m.pasos.length} no existe hasta que el paso ${corrida.paso_actual} quede conforme.`}>
              <button type="button" className="bpm2-btn blanco" disabled={m.expediente === corrida.id} onClick={() => m.bajarExpediente(corrida.id)}>Expediente de esta tanda</button>
            </Pie>
          )}

          {corrida && m.puedeRevisar && corrida.estado !== 'anulada' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 16px' }}>
              <button type="button" className="bpm2-btn sec" disabled={m.expediente === corrida.id} onClick={() => m.bajarExpediente(corrida.id)}>Expediente PDF</button>
              <button type="button" className="bpm2-btn sec" style={{ color: T.bad, borderColor: T.bad }} disabled={m.guardando} onClick={m.anular}>Anular esta tanda</button>
              <span style={{ color: T.dim, fontSize: 13.5 }}>Anular no borra: queda en el historial con tu nombre y el motivo.</span>
            </div>
          )}

          <Historial m={m} />
        </div>
        {docAbierto != null && pasoActual && (
          <DocViewer docs={docs} paso={pasoActual} ui={ui} cat={m.cat} inicial={docAbierto} onCerrar={cerrarDoc} />
        )}
      </div>
    </TemaBPM>
  )
}
