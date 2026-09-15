import { useEffect, useState } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   BPM Chili · controles estructurados por paso (fase 1, 14-sep-2026)

   Sale de la auditoría de Mauricio: "foto + nota" no demuestra que la olla
   se lavó en orden, con qué químico, a qué concentración ni cuánto tiempo
   actuó el sanitizante. Cada paso declara sus controles en
   `bpm_pasos.controles` (jsonb) y esta pantalla los rinde, los evalúa y
   guarda lo capturado en `bpm_registros.datos`.

   Regla de diseño (la del informe): el operario registra HECHOS; el
   sistema decide Cumple / No cumple contra lo que Calidad cargó en los
   catálogos (equipos, químicos, esponjas, parámetros). Si algo no cumple,
   el registro se bloquea y se abre el desvío con causa y acción.

   Tipos de control:
     equipo    → código del equipo + calibración vigente (auto) + criterios
     matriz    → criterios Cumple / No cumple (+ cantidad opcional)
     quimicos  → detergente y sanitizante: producto, lote, proveedor,
                 vencimiento, concentración (validada contra el catálogo)
     secuencia → etapas en orden; cada "Cumple" sella hora y responsable.
                 Una etapa puede pedir esponja (condición + color) o llevar
                 cronómetro de contacto con veredicto automático.
     basculas  → fase 2: una fila por báscula (código del catálogo,
                 calibración automática, USB, cero/tara, uso exclusivo).
                 Se exige un mínimo de básculas aptas; la alterna aparece
                 sola cuando alguna de las dos primeras no cumple.
   ═══════════════════════════════════════════════════════════════════════ */

const C = {
  card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', acc: '#3b82f6', sub: '#101012',
}

const COLORES_ESPONJA = ['Verde', 'Rojo', 'Azul', 'Amarillo', 'Blanco', 'Negro', 'Otro']

const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

const fmtHora = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/El_Salvador' }) : ''

const mmss = (seg) => {
  const s = Math.max(0, Math.round(seg || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ── Catálogos que administra Calidad (pantalla "Parámetros BPM") ──
export function useCatalogosBPM() {
  const [cat, setCat] = useState({ equipos: [], quimicos: [], esponjas: [], desvios: [], parametros: {}, listo: false })
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [e, q, s, d, p] = await Promise.all([
        db.from('bpm_equipos').select('*').eq('activo', true).order('codigo'),
        db.from('bpm_quimicos').select('*').eq('activo', true).order('nombre'),
        db.from('bpm_esponjas').select('*'),
        db.from('bpm_desvio_catalogo').select('*').eq('activo', true).order('orden'),
        db.from('bpm_parametros').select('*'),
      ])
      if (!vivo) return
      setCat({
        equipos: e.data || [], quimicos: q.data || [], esponjas: s.data || [], desvios: d.data || [],
        parametros: Object.fromEntries((p.data || []).map(x => [x.clave, x.valor])),
        listo: true,
      })
    })()
    return () => { vivo = false }
  }, [])
  return cat
}

export function calibracionEstado(eq, hoy) {
  if (!eq) return null
  if (!eq.calibracion_vence) return { ok: false, texto: 'Sin calibración registrada' }
  if (eq.calibracion_vence < hoy) return { ok: false, texto: `Calibración vencida el ${eq.calibracion_vence}` }
  return { ok: true, texto: `Calibración vigente hasta ${eq.calibracion_vence}` }
}

// Tiempo de contacto exigido: viene del sanitizante elegido en el control de químicos.
function tiempoContactoRequerido(controles, valores, cat) {
  const cq = (controles || []).find(c => c.tipo === 'quimicos')
  if (!cq) return null
  const san = valores?.[cq.clave]?.sanitizante
  if (!san?.quimico_id || san.quimico_id === 'otro') return null
  const q = cat.quimicos.find(x => x.id === san.quimico_id)
  return q?.tiempo_contacto_seg ?? null
}

// ═══════════════ Evaluación ═══════════════
// Devuelve lo que falta por llenar (pendientes) y lo que NO cumple (fallas).
// Las fallas se convierten en bpm_desviaciones al registrar.
export function evaluarControles(controles, valores, cat, hoy) {
  const fallas = [], pendientes = []
  const falla = (o) => fallas.push(o)

  for (const c of controles || []) {
    const v = valores?.[c.clave] || {}

    if (c.tipo === 'equipo') {
      if (c.opcional) {
        if (v.aplica == null) { pendientes.push(`${c.titulo}: indicá si aplica`); continue }
        if (v.aplica === false) continue
      }
      const eq = cat.equipos.find(e => e.id === v.equipo_id)
      if (!eq) { pendientes.push(`${c.titulo}: elegí el equipo por su código`); continue }
      const cal = calibracionEstado(eq, hoy)
      if (!cal.ok) falla({ clave: c.clave, tipo: 'equipo', detalle: `${eq.codigo}: ${cal.texto}`, valor_esperado: 'calibración vigente', valor_real: cal.texto })
      for (const k of c.criterios || []) {
        const r = v.criterios?.[k.clave]
        if (!r) pendientes.push(`${c.titulo}: ${k.texto}`)
        else if (r === 'No cumple') falla({ clave: c.clave, tipo: 'equipo', detalle: `${eq.codigo}: ${k.texto}`, valor_esperado: 'Cumple', valor_real: 'No cumple' })
      }
    }

    if (c.tipo === 'matriz') {
      if (c.cantidad && !(Number(v.cantidad) > 0)) pendientes.push(`${c.titulo}: cuántos incluís`)
      for (const k of c.criterios || []) {
        const r = v.criterios?.[k.clave]
        if (!r) pendientes.push(`${c.titulo}: ${k.texto}`)
        else if (r === 'No cumple') falla({ clave: c.clave, tipo: 'condicion', detalle: `${c.titulo}: ${k.texto}`, valor_esperado: 'Cumple', valor_real: 'No cumple' })
      }
    }

    if (c.tipo === 'quimicos') {
      for (const linea of c.lineas || []) {
        const l = v[linea] || {}
        const q = cat.quimicos.find(x => x.id === l.quimico_id)
        const nombre = l.quimico_id === 'otro' ? (l.otro || '').trim() : q?.nombre
        if (!nombre) { pendientes.push(`${cap(linea)}: elegí el producto`); continue }
        if (!(l.lote || '').trim()) pendientes.push(`${nombre}: lote`)
        if (!(l.proveedor || '').trim()) pendientes.push(`${nombre}: proveedor`)
        if (!l.vencimiento) pendientes.push(`${nombre}: fecha de vencimiento`)
        else if (l.vencimiento < hoy) falla({ clave: c.clave, tipo: 'quimico_vencido', detalle: `${nombre} vencido`, valor_esperado: `vence después de ${hoy}`, valor_real: l.vencimiento })
        if (l.concentracion === '' || l.concentracion == null) pendientes.push(`${nombre}: concentración`)
        else if (q && (q.concentracion_min != null || q.concentracion_max != null)) {
          const n = Number(l.concentracion)
          const min = q.concentracion_min != null ? Number(q.concentracion_min) : null
          const max = q.concentracion_max != null ? Number(q.concentracion_max) : null
          if (Number.isNaN(n) || (min != null && n < min) || (max != null && n > max)) {
            falla({ clave: c.clave, tipo: 'concentracion', detalle: `${nombre}: concentración fuera de parámetro`,
                    valor_esperado: `${min ?? '…'}–${max ?? '…'} ${q.unidad_concentracion}`, valor_real: `${l.concentracion} ${q.unidad_concentracion}` })
          }
        }
      }
    }

    if (c.tipo === 'basculas') {
      // Una fila por báscula. "Apta" = equipo elegido, calibración vigente y
      // todos los criterios en Cumple (USB puede ir en No aplica).
      const minimo = c.minimo || 2
      const filas = v.filas || {}
      const claves = Object.keys(filas)
      let aptas = 0
      for (const k of claves) {
        const f = filas[k] || {}
        const eq = cat.equipos.find(e => e.id === f.equipo_id)
        if (!eq) continue
        const cal = calibracionEstado(eq, hoy)
        const crit = (c.criterios || []).map(x => f.criterios?.[x.clave])
        if (crit.some(r => !r)) continue
        const malo = crit.some(r => r === 'No cumple')
        if (!cal.ok) {
          falla({ clave: c.clave, tipo: 'bascula', detalle: `${eq.codigo}: ${cal.texto}`, valor_esperado: 'calibración vigente', valor_real: cal.texto })
          continue
        }
        if (malo) {
          for (const x of c.criterios || []) {
            if (f.criterios?.[x.clave] === 'No cumple') {
              falla({ clave: c.clave, tipo: 'bascula', detalle: `${eq.codigo}: ${x.texto}`, valor_esperado: 'Cumple', valor_real: 'No cumple' })
            }
          }
          continue
        }
        aptas++
      }
      // Solo se exige completar las dos primeras filas; la alterna es opcional.
      const base = (v.orden || ['1', '2']).slice(0, 2)
      for (const k of base) {
        const f = filas[k] || {}
        if (!f.equipo_id) { pendientes.push(`${c.titulo}: elegí la báscula de la línea ${k}`); continue }
        for (const x of c.criterios || []) {
          if (!f.criterios?.[x.clave]) pendientes.push(`${c.titulo}: ${x.texto} (línea ${k})`)
        }
      }
      if (!pendientes.length && aptas < minimo) {
        falla({ clave: c.clave, tipo: 'bascula', detalle: `No hay ${minimo} básculas vigentes y aptas para pesar`,
                valor_esperado: `${minimo} básculas`, valor_real: `${aptas}` })
      }
    }

    if (c.tipo === 'secuencia') {
      const et = v.etapas || {}
      for (const e of c.etapas || []) {
        const r = et[e.clave]
        if (e.cronometro) {
          const cr = v.cronometro || {}
          if (!cr.fin) pendientes.push(`${c.titulo}: registrá inicio y fin del tiempo de contacto`)
          else {
            const req = tiempoContactoRequerido(controles, valores, cat)
            if (req != null && Number(cr.seg) < req) {
              falla({ clave: c.clave, tipo: 'contacto', detalle: 'Tiempo de contacto insuficiente', valor_esperado: `≥ ${req} s`, valor_real: `${Math.round(cr.seg)} s` })
            }
          }
          continue
        }
        if (!r?.estado || r.estado === 'Pendiente') pendientes.push(`${c.titulo}: "${e.texto}"`)
        else if (r.estado === 'No cumple') falla({ clave: c.clave, tipo: 'etapa', detalle: `${c.titulo}: ${e.texto}`, valor_esperado: 'Cumple', valor_real: 'No cumple' })
        if (e.esponja) {
          const sp = v.esponja || {}
          if (!sp.condicion) pendientes.push('Condición de la esponja')
          else if (sp.condicion === 'No cumple') falla({ clave: c.clave, tipo: 'esponja', detalle: 'Esponja en mal estado o de otra área', valor_esperado: 'Cumple', valor_real: 'No cumple' })
          const cfg = cat.esponjas.find(x => x.area === c.area && x.vigente && x.color)
          if (cfg) {
            if (!sp.color) pendientes.push('Color de la esponja')
            else if (sp.color !== cfg.color) falla({ clave: c.clave, tipo: 'esponja', detalle: `Esponja de color ${sp.color} en el área ${c.area}`, valor_esperado: cfg.color, valor_real: sp.color })
          }
        }
      }
    }
  }
  return { fallas, pendientes, ok: fallas.length === 0 && pendientes.length === 0 }
}

// Resumen corto para la lista de pasos y el expediente.
export function resumenDatos(controles, valores, cat) {
  const partes = []
  for (const c of controles || []) {
    const v = valores?.[c.clave] || {}
    if (c.tipo === 'equipo') {
      if (c.opcional && v.aplica === false) { partes.push(`${c.titulo}: no aplica`); continue }
      const eq = cat.equipos.find(e => e.id === v.equipo_id)
      if (eq) partes.push(eq.codigo)
    }
    if (c.tipo === 'quimicos') {
      const nombres = (c.lineas || []).map(l => {
        const x = v[l] || {}
        const q = cat.quimicos.find(y => y.id === x.quimico_id)
        const n = x.quimico_id === 'otro' ? x.otro : q?.nombre
        return n ? `${n} ${x.concentracion ?? ''} ${q?.unidad_concentracion || ''}`.trim() : null
      }).filter(Boolean)
      if (nombres.length) partes.push(nombres.join(' + '))
    }
    if (c.tipo === 'secuencia' && v.cronometro?.fin) partes.push(`contacto ${Math.round(v.cronometro.seg)} s`)
    if (c.tipo === 'matriz' && c.cantidad && v.cantidad) partes.push(`${v.cantidad} cucharones`)
    if (c.tipo === 'basculas') {
      const cods = Object.values(v.filas || {})
        .map(f => cat.equipos.find(e => e.id === f.equipo_id)?.codigo).filter(Boolean)
      if (cods.length) partes.push(cods.join(' + '))
    }
  }
  return partes.join(' · ')
}

// ═══════════════ UI ═══════════════
const box = { background: C.sub, border: `1px solid ${C.line}`, borderRadius: 11, padding: 13, marginBottom: 12 }
const h = { fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: C.txt }
const ayudaSt = { fontSize: 12.5, color: C.dim, lineHeight: 1.5, marginBottom: 10 }
const fila = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${C.line}`, fontSize: 13.5 }
const inp = {
  background: '#141416', border: `1px solid ${C.line}`, color: C.txt, borderRadius: 8,
  padding: '9px 10px', fontSize: 15, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl = { fontSize: 12, color: C.dim, display: 'block', marginBottom: 4 }

function SelCumple({ value, onChange, disabled, ancho = 130 }) {
  const color = value === 'Cumple' ? C.ok : value === 'No cumple' ? C.bad : C.line
  return (
    <select value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)}
      style={{ ...inp, width: ancho, flexShrink: 0, border: `1px solid ${color}`, opacity: disabled ? .45 : 1 }}>
      <option value="">Seleccioná</option>
      <option value="Cumple">Cumple</option>
      <option value="No cumple">No cumple</option>
    </select>
  )
}

const Sello = ({ r }) => r?.hora
  ? <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>Registrado {fmtHora(r.hora)}{r.por ? ` · ${r.por}` : ''}</div>
  : null

// ── Equipo ──
function ControlEquipo({ c, v, set, cat, hoy }) {
  const equipos = cat.equipos.filter(e => e.tipo === c.tipo_equipo)
  const eq = cat.equipos.find(e => e.id === v.equipo_id)
  const cal = calibracionEstado(eq, hoy)
  const activo = !c.opcional || v.aplica === true
  return (
    <div style={box}>
      <div style={h}>{c.titulo}</div>
      {c.ayuda && <div style={ayudaSt}>{c.ayuda}</div>}
      {c.opcional && (
        <div style={{ marginBottom: 10 }}>
          <span style={lbl}>{c.pregunta || '¿Aplica?'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['No aplica', false], ['Sí, se usa', true]].map(([t, val]) => (
              <button key={t} onClick={() => set({ ...v, aplica: val })} style={{
                flex: 1, padding: '10px', borderRadius: 8, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
                background: v.aplica === val ? (val ? C.acc : '#3f3f46') : '#141416',
                color: v.aplica === val ? '#fff' : C.dim, border: `1px solid ${v.aplica === val ? 'transparent' : C.line}`,
              }}>{t}</button>
            ))}
          </div>
        </div>
      )}
      {activo && (
        <>
          <span style={lbl}>Código del equipo</span>
          <select value={v.equipo_id || ''} onChange={e => set({ ...v, equipo_id: e.target.value })} style={{ ...inp, marginBottom: 6 }}>
            <option value="">Elegí por código…</option>
            {equipos.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre || e.tipo}</option>)}
          </select>
          {eq && (
            <div style={{ fontSize: 13, marginBottom: 8, color: cal.ok ? '#86efac' : '#fca5a5' }}>
              {cal.ok ? '✓ ' : '✕ '}{cal.texto}{!cal.ok && ' · el sistema bloquea este equipo'}
            </div>
          )}
          {(c.criterios || []).map(k => (
            <div key={k.clave} style={fila}>
              <span style={{ flex: 1 }}>{k.texto}</span>
              <SelCumple value={v.criterios?.[k.clave]} onChange={val => set({ ...v, criterios: { ...(v.criterios || {}), [k.clave]: val } })} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── Matriz de condición ──
function ControlMatriz({ c, v, set }) {
  return (
    <div style={box}>
      <div style={h}>{c.titulo}</div>
      {c.ayuda && <div style={ayudaSt}>{c.ayuda}</div>}
      {c.cantidad && (
        <div style={{ marginBottom: 8 }}>
          <span style={lbl}>¿Cuántos incluís en esta liberación?</span>
          <input type="number" inputMode="numeric" min="1" value={v.cantidad ?? ''} onChange={e => set({ ...v, cantidad: e.target.value })} style={{ ...inp, width: 120 }} placeholder="Ej: 3" />
        </div>
      )}
      {(c.criterios || []).map(k => (
        <div key={k.clave} style={fila}>
          <span style={{ flex: 1 }}>
            {k.texto}
            {k.ayuda && <div style={{ fontSize: 11.5, color: C.dim }}>{k.ayuda}</div>}
          </span>
          <SelCumple value={v.criterios?.[k.clave]} onChange={val => set({ ...v, criterios: { ...(v.criterios || {}), [k.clave]: val } })} />
        </div>
      ))}
    </div>
  )
}

// ── Químicos ──
function ControlQuimicos({ c, v, set, cat, hoy }) {
  return (
    <div style={box}>
      <div style={h}>{c.titulo}</div>
      <div style={ayudaSt}>Registrá lo que de verdad usaste. El sistema compara la concentración con el rango que cargó Calidad y revisa que no esté vencido.</div>
      {(c.lineas || []).map(linea => {
        const l = v[linea] || {}
        const lista = cat.quimicos.filter(q => q.categoria === linea)
        const q = cat.quimicos.find(x => x.id === l.quimico_id)
        const upd = (patch) => set({ ...v, [linea]: { ...l, ...patch } })
        const rango = q && (q.concentracion_min != null || q.concentracion_max != null)
          ? `${q.concentracion_min ?? '…'}–${q.concentracion_max ?? '…'} ${q.unidad_concentracion}` : null
        const n = Number(l.concentracion)
        const fuera = rango && l.concentracion !== '' && l.concentracion != null &&
          ((q.concentracion_min != null && n < Number(q.concentracion_min)) || (q.concentracion_max != null && n > Number(q.concentracion_max)))
        const vencido = l.vencimiento && l.vencimiento < hoy
        return (
          <div key={linea} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginTop: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: C.txt }}>{cap(linea)}</div>
            <select value={l.quimico_id || ''} style={{ ...inp, marginBottom: 6 }}
              onChange={e => {
                const id = e.target.value
                const qq = cat.quimicos.find(x => x.id === id)
                upd({ quimico_id: id, proveedor: l.proveedor || qq?.proveedor || '' })
              }}>
              <option value="">Elegí el producto…</option>
              {lista.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              <option value="otro">Otro (escribir el nombre)</option>
            </select>
            {l.quimico_id === 'otro' && (
              <input value={l.otro || ''} onChange={e => upd({ otro: e.target.value })} style={{ ...inp, marginBottom: 6 }} placeholder="Nombre del producto" />
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><span style={lbl}>Lote</span><input value={l.lote || ''} onChange={e => upd({ lote: e.target.value })} style={inp} placeholder="Como dice el envase" /></div>
              <div><span style={lbl}>Proveedor</span><input value={l.proveedor || ''} onChange={e => upd({ proveedor: e.target.value })} style={inp} placeholder="Proveedor" /></div>
              <div>
                <span style={lbl}>Vence</span>
                <input type="date" value={l.vencimiento || ''} onChange={e => upd({ vencimiento: e.target.value })} style={{ ...inp, border: `1px solid ${vencido ? C.bad : C.line}` }} />
                {vencido && <div style={{ fontSize: 11.5, color: '#fca5a5' }}>Vencido: no se puede usar</div>}
              </div>
              <div>
                <span style={lbl}>Concentración{q ? ` (${q.unidad_concentracion})` : ''}{rango ? ` · rango ${rango}` : ''}</span>
                <input type="number" inputMode="decimal" step="any" value={l.concentracion ?? ''} onChange={e => upd({ concentracion: e.target.value })}
                  style={{ ...inp, border: `1px solid ${fuera ? C.bad : C.line}` }} placeholder={rango ? 'Dato real medido' : 'Dilución usada'} />
                {fuera && <div style={{ fontSize: 11.5, color: '#fca5a5' }}>Fuera del rango de Calidad</div>}
                {q && !rango && <div style={{ fontSize: 11.5, color: C.dim }}>Sin rango cargado: solo se registra</div>}
                {q?.categoria === 'sanitizante' && q.tiempo_contacto_seg != null && (
                  <div style={{ fontSize: 11.5, color: C.dim }}>Tiempo de contacto exigido: {q.tiempo_contacto_seg} s</div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Matriz de básculas (paso 7) ──
function ControlBasculas({ c, v, set, cat, hoy }) {
  const minimo = c.minimo || 2
  const basculas = cat.equipos.filter(e => e.tipo === 'bascula')
  const filas = v.filas || {}
  // La alterna aparece sola: mientras las dos primeras cumplan, no estorba.
  const problema = ['1', '2'].some(k => {
    const f = filas[k] || {}
    const eq = cat.equipos.find(e => e.id === f.equipo_id)
    if (eq && !calibracionEstado(eq, hoy).ok) return true
    return (c.criterios || []).some(x => f.criterios?.[x.clave] === 'No cumple')
  })
  const orden = problema ? ['1', '2', '3'] : ['1', '2']
  const ordenTxt = orden.join()
  // `orden` se guarda porque la evaluación necesita saber qué filas exigir.
  useEffect(() => {
    if ((v.orden || []).join() !== ordenTxt) set({ ...v, orden })
  }, [ordenTxt]) // eslint-disable-line react-hooks/exhaustive-deps

  const apta = (k) => {
    const f = filas[k] || {}
    const eq = cat.equipos.find(e => e.id === f.equipo_id)
    if (!eq) return null
    if (!calibracionEstado(eq, hoy).ok) return false
    const crit = (c.criterios || []).map(x => f.criterios?.[x.clave])
    if (crit.some(r => !r)) return null
    return !crit.some(r => r === 'No cumple')
  }
  const aptas = orden.filter(k => apta(k) === true).length
  const upd = (k, patch) => set({ ...v, orden, filas: { ...filas, [k]: { ...(filas[k] || {}), ...patch } } })

  return (
    <div style={box}>
      <div style={h}>{c.titulo}</div>
      {c.ayuda && <div style={ayudaSt}>{c.ayuda}</div>}
      {orden.map(k => {
        const f = filas[k] || {}
        const eq = cat.equipos.find(e => e.id === f.equipo_id)
        const cal = calibracionEstado(eq, hoy)
        const est = apta(k)
        const alterna = k === '3'
        return (
          <div key={k} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Báscula {k}{alterna ? ' · alterna' : ''}</span>
              {est != null && (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: est ? '#86efac' : '#fca5a5' }}>
                  {est ? '✓ apta' : '✕ no apta'}
                </span>
              )}
            </div>
            {alterna && <div style={{ fontSize: 11.5, color: C.warn, marginBottom: 6 }}>Se habilitó porque una de las otras no cumple. No hay una cuarta.</div>}
            <select value={f.equipo_id || ''} onChange={e => upd(k, { equipo_id: e.target.value })} style={{ ...inp, marginBottom: 6 }}>
              <option value="">Elegí la báscula por su código…</option>
              {basculas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre || ''}</option>)}
            </select>
            {eq && (
              <div style={{ fontSize: 12.5, marginBottom: 4, color: cal.ok ? '#86efac' : '#fca5a5' }}>
                {cal.ok ? '✓ ' : '✕ '}{cal.texto}
              </div>
            )}
            {(c.criterios || []).map(x => (
              <div key={x.clave} style={fila}>
                <span style={{ flex: 1 }}>{x.texto}</span>
                <select value={f.criterios?.[x.clave] || ''} style={{ ...inp, width: 128, flexShrink: 0 }}
                  onChange={e => upd(k, { criterios: { ...(f.criterios || {}), [x.clave]: e.target.value } })}>
                  <option value="">Seleccioná</option>
                  <option value="Cumple">Cumple</option>
                  <option value="No cumple">No cumple</option>
                  {x.no_aplica && <option value="No aplica">No aplica</option>}
                </select>
              </div>
            ))}
          </div>
        )
      })}
      <div style={{
        marginTop: 10, padding: '9px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
        background: aptas >= minimo ? '#0e1f14' : '#3a1414',
        color: aptas >= minimo ? '#86efac' : '#fca5a5',
      }}>
        {aptas >= minimo
          ? `${aptas} básculas vigentes y aptas. Ya se puede pesar.`
          : `Se necesitan ${minimo} básculas vigentes y aptas para pesar. Van ${aptas}.`}
      </div>
    </div>
  )
}

// ── Secuencia de etapas ──
function ControlSecuencia({ c, v, set, cat, controles, valores, ahoraISO, quien, ahora }) {
  const et = v.etapas || {}
  const cr = v.cronometro || {}
  const req = tiempoContactoRequerido(controles, valores, cat)
  const cfgEsponja = cat.esponjas.find(x => x.area === c.area && x.vigente && x.color)

  // Cuánto va corriendo el cronómetro (se calcula con la hora del servidor)
  const corriendo = cr.inicio && !cr.fin
  const segCorriendo = corriendo ? Math.max(0, (new Date(ahoraISO()).getTime() - new Date(cr.inicio).getTime()) / 1000) : 0

  const setEtapa = (clave, estado) => {
    const nuevo = { ...et }
    nuevo[clave] = estado && estado !== 'Pendiente'
      ? { estado, hora: ahoraISO(), por: quien }
      : { estado: 'Pendiente' }
    set({ ...v, etapas: nuevo })
  }

  const etapas = c.etapas || []
  const okAnterior = (i) => {
    if (i === 0) return true
    const prev = etapas[i - 1]
    if (prev.cronometro) return et[prev.clave]?.estado === 'Cumple'
    return et[prev.clave]?.estado === 'Cumple'
  }

  const iniciar = () => set({ ...v, cronometro: { inicio: ahoraISO(), fin: null, seg: null, veredicto: null } })
  const terminar = (e) => {
    const fin = ahoraISO()
    const seg = Math.max(0, (new Date(fin).getTime() - new Date(cr.inicio).getTime()) / 1000)
    const veredicto = req == null ? 'sin_parametro' : (seg >= req ? 'Cumple' : 'No cumple')
    const nuevo = { ...et, [e.clave]: { estado: veredicto === 'No cumple' ? 'No cumple' : 'Cumple', hora: fin, por: quien } }
    set({ ...v, cronometro: { inicio: cr.inicio, fin, seg, veredicto, requerido: req }, etapas: nuevo })
  }

  return (
    <div style={box}>
      <div style={h}>{c.titulo}</div>
      <div style={ayudaSt}>Hacé cada etapa y marcala en orden. Cada "Cumple" queda con hora y con tu nombre. Si una no la podés hacer como dice, marcá "No cumple": se abre el desvío.</div>
      {etapas.map((e, i) => {
        const r = et[e.clave]
        const habil = okAnterior(i)
        return (
          <div key={e.clave} style={{ ...fila, alignItems: 'flex-start', opacity: habil ? 1 : .5 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 11, flexShrink: 0, marginTop: 6, fontSize: 11.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: r?.estado === 'Cumple' ? C.ok : r?.estado === 'No cumple' ? C.bad : '#2a2a2e',
              color: r?.estado && r.estado !== 'Pendiente' ? '#fff' : C.dim,
            }}>{r?.estado === 'Cumple' ? '✓' : r?.estado === 'No cumple' ? '✕' : i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ lineHeight: 1.45 }}>{e.texto}</div>

              {e.esponja && habil && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: cfgEsponja ? '1fr 1fr' : '1fr', gap: 8 }}>
                  <div>
                    <span style={lbl}>Condición de la esponja (limpia, íntegra y de esta área)</span>
                    <SelCumple value={v.esponja?.condicion} ancho={'100%'} onChange={val => set({ ...v, esponja: { ...(v.esponja || {}), condicion: val } })} />
                  </div>
                  {cfgEsponja ? (
                    <div>
                      <span style={lbl}>Color de la esponja · autorizado: {cfgEsponja.color}</span>
                      <select value={v.esponja?.color || ''} onChange={ev => set({ ...v, esponja: { ...(v.esponja || {}), color: ev.target.value } })}
                        style={{ ...inp, border: `1px solid ${v.esponja?.color && v.esponja.color !== cfgEsponja.color ? C.bad : C.line}` }}>
                        <option value="">Color…</option>
                        {COLORES_ESPONJA.map(col => <option key={col} value={col}>{col}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: C.warn }}>Color por área: pendiente de que Calidad apruebe el catálogo. Por ahora no se valida color.</div>
                  )}
                </div>
              )}

              {e.cronometro && habil && (
                <div style={{ marginTop: 8, background: '#0a0a0a', border: `1px solid ${corriendo ? C.acc : C.line}`, borderRadius: 9, padding: 10 }}>
                  <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>
                    Tiempo de contacto {req != null ? <>· exigido <b style={{ color: C.txt }}>{req} s</b></> : <>· <span style={{ color: C.warn }}>sin parámetro cargado: solo se registra</span></>}
                  </div>
                  {!cr.inicio && (
                    <button onClick={iniciar} style={{ ...inp, background: C.acc, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                      ▶ Ya apliqué el sanitizante · empezar a contar
                    </button>
                  )}
                  {corriendo && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: req != null && segCorriendo >= req ? C.ok : C.txt }}>{mmss(segCorriendo)}</div>
                      <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 8 }}>Empezó {fmtHora(cr.inicio)}</div>
                      <button onClick={() => terminar(e)} style={{ ...inp, background: '#3f3f46', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                        ■ Terminó el contacto
                      </button>
                    </div>
                  )}
                  {cr.fin && (
                    <div style={{ fontSize: 13, color: cr.veredicto === 'No cumple' ? '#fca5a5' : '#86efac' }}>
                      {fmtHora(cr.inicio)} → {fmtHora(cr.fin)} · <b>{Math.round(cr.seg)} s</b>
                      {cr.veredicto === 'Cumple' && ' · ✓ cumple el tiempo exigido'}
                      {cr.veredicto === 'No cumple' && ` · ✕ faltaron ${Math.ceil(req - cr.seg)} s`}
                      {cr.veredicto === 'sin_parametro' && ' · registrado (sin parámetro)'}
                      <button onClick={() => { const nuevo = { ...et }; delete nuevo[e.clave]; set({ ...v, cronometro: {}, etapas: nuevo }) }}
                        style={{ marginLeft: 10, background: 'none', border: `1px solid ${C.line}`, color: C.dim, borderRadius: 6, padding: '3px 8px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                        volver a contar
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!e.cronometro && <Sello r={r} />}
            </div>
            {!e.cronometro && (
              <SelCumple value={r?.estado === 'Pendiente' ? '' : r?.estado} disabled={!habil} ancho={118}
                onChange={val => setEtapa(e.clave, val)} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Controles({ controles, valores, setValores, cat, hoy, ahoraISO, quien, ahora }) {
  if (!Array.isArray(controles) || !controles.length) return null
  if (!cat.listo) return <div style={{ ...box, color: C.dim, fontSize: 13 }}>Cargando catálogos de Calidad…</div>
  const setDe = (clave) => (nv) => setValores(prev => ({ ...prev, [clave]: nv }))
  return (
    <div>
      {controles.map(c => {
        const v = valores?.[c.clave] || {}
        const props = { c, v, set: setDe(c.clave), cat, hoy }
        if (c.tipo === 'equipo') return <ControlEquipo key={c.clave} {...props} />
        if (c.tipo === 'matriz') return <ControlMatriz key={c.clave} {...props} />
        if (c.tipo === 'quimicos') return <ControlQuimicos key={c.clave} {...props} />
        if (c.tipo === 'basculas') return <ControlBasculas key={c.clave} {...props} />
        if (c.tipo === 'secuencia') return <ControlSecuencia key={c.clave} {...props} controles={controles} valores={valores} ahoraISO={ahoraISO} quien={quien} ahora={ahora} />
        return null
      })}
    </div>
  )
}

// ── Desvío: causa y acción de catálogo, "Otra" con texto obligatorio ──
export function desvioValido(d) {
  if (!d?.causa || !d?.accion) return false
  if (d.causa === 'Otra' && !(d.causa_otra || '').trim()) return false
  if (d.accion === 'Otra' && !(d.accion_otra || '').trim()) return false
  return true
}

export function PanelDesvio({ contexto, cat, fallas, desvio, setDesvio, esCritico }) {
  const causas = cat.desvios.filter(d => d.contexto === contexto && d.tipo === 'causa')
  const acciones = cat.desvios.filter(d => d.contexto === contexto && d.tipo === 'accion')
  const d = desvio || {}
  const upd = (p) => setDesvio({ ...d, ...p })
  return (
    <div style={{ background: '#3a1414', border: `1px solid ${C.bad}`, borderRadius: 11, padding: 13, marginBottom: 12, color: '#fecaca' }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>No cumple · el paso queda bloqueado</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>
        {esCritico
          ? 'Registrá la causa y la acción correctiva. La tanda se bloquea hasta que Calidad la libere; después se repite la verificación.'
          : 'Registrá la causa y la acción correctiva. Queda como desvío en el expediente de la tanda.'}
      </div>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        {fallas.map((f, i) => <li key={i}>{f.detalle} — esperado {f.valor_esperado}, real <b>{f.valor_real}</b></li>)}
      </ul>
      <span style={lbl}>Causa identificada</span>
      <select value={d.causa || ''} onChange={e => upd({ causa: e.target.value })} style={{ ...inp, marginBottom: 6 }}>
        <option value="">Seleccioná una causa…</option>
        {causas.map(x => <option key={x.id} value={x.texto}>{x.texto}</option>)}
        <option value="Otra">Otra (describir)</option>
      </select>
      {d.causa === 'Otra' && <input value={d.causa_otra || ''} onChange={e => upd({ causa_otra: e.target.value })} style={{ ...inp, marginBottom: 6 }} placeholder="Describí la causa" />}
      <span style={lbl}>Acción correctiva</span>
      <select value={d.accion || ''} onChange={e => upd({ accion: e.target.value })} style={{ ...inp, marginBottom: 6 }}>
        <option value="">Seleccioná una acción…</option>
        {acciones.map(x => <option key={x.id} value={x.texto}>{x.texto}</option>)}
        <option value="Otra">Otra (describir)</option>
      </select>
      {d.accion === 'Otra' && <input value={d.accion_otra || ''} onChange={e => upd({ accion_otra: e.target.value })} style={inp} placeholder="Describí la acción realizada" />}
    </div>
  )
}
