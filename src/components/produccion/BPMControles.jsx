import { useEffect, useState } from 'react'
import { db } from '../../supabase'
import { useTema, estilos, Pill, Ayuda, limpiarNumero, mostrarNumero } from './bpmTema'

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

/* Los colores ya no viven acá: cada componente pide el tema con useTema()
   (bpmTema.jsx). La piloto sigue en el tema oscuro; la versión Mauricio usa
   el claro del anexo FD-CI-DO-013-A01. */

const COLORES_ESPONJA = ['Verde', 'Rojo', 'Azul', 'Amarillo', 'Blanco', 'Negro', 'Otro']

const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

const fmtHora = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/El_Salvador' }) : ''

const mmss = (seg) => {
  const s = Math.max(0, Math.round(seg || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ── Catálogos que administra Calidad (pantalla "Parámetros BPM") ──
/* Desde la versión Mauricio (23-sep-2026) un parámetro puede ser global
   —como fue siempre— o pertenecer a una plantilla. Si la plantilla define
   la clave, esa gana: así la v2 envasa a 70 °C sin cambiarle el criterio a
   la piloto, que sigue en 65. */
export function useCatalogosBPM(plantillaId) {
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
      const filas = p.data || []
      const parametros = {}
      for (const x of filas) if (x.plantilla_id == null) parametros[x.clave] = x.valor
      if (plantillaId) for (const x of filas) if (x.plantilla_id === plantillaId) parametros[x.clave] = x.valor
      setCat({
        equipos: e.data || [], quimicos: q.data || [], esponjas: s.data || [], desvios: d.data || [],
        parametros, listo: true,
      })
    })()
    return () => { vivo = false }
  }, [plantillaId])
  return cat
}

export function calibracionEstado(eq, hoy) {
  if (!eq) return null
  if (!eq.calibracion_vence) return { ok: false, texto: 'Sin calibración registrada' }
  if (eq.calibracion_vence < hoy) return { ok: false, texto: `Calibración vencida el ${eq.calibracion_vence}` }
  return { ok: true, texto: `Calibración vigente hasta ${eq.calibracion_vence}` }
}

// Un límite puede venir escrito en el control o, mejor, apuntar a un parámetro
// de Calidad (`min_param`) para que se cambie en un solo lugar.
function limite(campo, lado, cat) {
  const p = campo[lado + '_param']
  if (p != null && cat.parametros[p] != null && cat.parametros[p] !== '') return Number(cat.parametros[p])
  return campo[lado] != null ? Number(campo[lado]) : null
}
function rangoTexto(campo, cat) {
  const min = limite(campo, 'min', cat), max = limite(campo, 'max', cat)
  const ex = campo.exacto_param != null ? Number(cat.parametros[campo.exacto_param]) : campo.exacto
  const u = campo.unidad ? ` ${campo.unidad}` : ''
  if (ex != null && !Number.isNaN(ex)) return `${ex}${u}`
  if (min != null && max != null) return `${min} a ${max}${u}`
  if (min != null) return `≥ ${min}${u}`
  if (max != null) return `≤ ${max}${u}`
  return null
}
// Evalúa un campo numérico contra su rango o su valor exacto.
function fueraDeRango(campo, valor, cat) {
  if (valor === '' || valor == null) return false
  const n = Number(valor)
  if (Number.isNaN(n)) return true
  const ex = campo.exacto_param != null ? Number(cat.parametros[campo.exacto_param]) : campo.exacto
  if (ex != null && !Number.isNaN(ex)) return n !== ex
  const min = limite(campo, 'min', cat), max = limite(campo, 'max', cat)
  if (min != null && n < min) return true
  if (max != null && n > max) return true
  return false
}

// Minutos entre dos hitos ya sellados (redondeados a un decimal). null si falta alguno.
function duracionEntre(col, hitos) {
  const a = hitos?.[col.desde]?.hora, b = hitos?.[col.hasta]?.hora
  if (!a || !b) return null
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 600) / 100
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

    // ── Tabla: una fila por tanda/unidad, columnas con su propia validación ──
    if (c.tipo === 'tabla') {
      for (const f of c.filas || []) {
        const r = v[f.clave] || {}
        for (const col of c.columnas || []) {
          const val = r[col.clave]
          const nombre = `${f.nombre}: ${col.label}`
          if (val === '' || val == null) { pendientes.push(`${c.titulo} · ${nombre}`); continue }
          if (col.tipo === 'numero' && fueraDeRango(col, val, cat)) {
            falla({ clave: c.clave, tipo: col.falla_tipo || 'medicion', detalle: `${f.nombre}: ${col.label} fuera de lo permitido`,
                    valor_esperado: rangoTexto(col, cat) || '—', valor_real: `${val}${col.unidad ? ' ' + col.unidad : ''}` })
          }
          if (col.tipo === 'select' && val === 'No cumple') {
            falla({ clave: c.clave, tipo: col.falla_tipo || 'medicion', detalle: nombre, valor_esperado: 'Cumple', valor_real: 'No cumple' })
          }
        }
      }
    }

    // ── Eventos: hitos que se sellan con la hora del servidor, en orden ──
    if (c.tipo === 'eventos') {
      const ev = v.hitos || {}
      for (const hito of c.hitos || []) {
        if (!ev[hito.clave]?.hora) pendientes.push(`${c.titulo}: ${hito.texto}`)
        for (const col of hito.campos || []) {
          // Duración calculada entre dos hitos: nadie la teclea, así que no
          // se puede "redondear" un tiempo de retención que no se cumplió.
          if (col.tipo === 'duracion') {
            const min = duracionEntre(col, ev)
            if (min == null) { pendientes.push(`${c.titulo}: ${col.label}`); continue }
            if (fueraDeRango(col, min, cat)) {
              falla({ clave: c.clave, tipo: col.falla_tipo || 'tiempo', detalle: col.label,
                      valor_esperado: rangoTexto(col, cat) || '—', valor_real: `${min} ${col.unidad || 'min'}` })
            }
            continue
          }
          const val = (v.campos || {})[col.clave]
          if (val === '' || val == null) { pendientes.push(`${c.titulo}: ${col.label}`); continue }
          if (col.tipo === 'numero' && fueraDeRango(col, val, cat)) {
            falla({ clave: c.clave, tipo: col.falla_tipo || 'proceso', detalle: col.label,
                    valor_esperado: rangoTexto(col, cat) || '—', valor_real: `${val}${col.unidad ? ' ' + col.unidad : ''}` })
          }
          if (col.tipo === 'select' && val === 'No cumple') {
            falla({ clave: c.clave, tipo: col.falla_tipo || 'proceso', detalle: col.label, valor_esperado: 'Cumple', valor_real: 'No cumple' })
          }
        }
      }
    }

    // ── Campos sueltos con validación (lectura del infrarrojo, laurel, corte) ──
    if (c.tipo === 'campos') {
      for (const col of c.campos || []) {
        const val = (v.campos || {})[col.clave]
        if (val === '' || val == null) { pendientes.push(`${c.titulo}: ${col.label}`); continue }
        if (col.tipo === 'numero' && fueraDeRango(col, val, cat)) {
          falla({ clave: c.clave, tipo: col.falla_tipo || 'proceso', detalle: col.label,
                  valor_esperado: rangoTexto(col, cat) || '—', valor_real: `${val}${col.unidad ? ' ' + col.unidad : ''}` })
        }
        if (col.tipo === 'select' && val === 'No cumple') {
          falla({ clave: c.clave, tipo: col.falla_tipo || 'proceso', detalle: col.label, valor_esperado: 'Cumple', valor_real: 'No cumple' })
        }
      }
      // Un equipo asociado (el infrarrojo) se valida igual que en `equipo`.
      if (c.tipo_equipo) {
        const eq = cat.equipos.find(e => e.id === v.equipo_id)
        if (!eq) pendientes.push(`${c.titulo}: elegí el equipo por su código`)
        else {
          const cal = calibracionEstado(eq, hoy)
          if (!cal.ok) falla({ clave: c.clave, tipo: 'equipo', detalle: `${eq.codigo}: ${cal.texto}`, valor_esperado: 'calibración vigente', valor_real: cal.texto })
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
    if (c.tipo === 'tabla' && c.resumen_col) {
      const vals = (c.filas || []).map(f => v[f.clave]?.[c.resumen_col]).filter(x => x !== '' && x != null)
      if (vals.length) partes.push(vals.join(' / ') + (c.resumen_unidad ? ` ${c.resumen_unidad}` : ''))
    }
    if ((c.tipo === 'campos' || c.tipo === 'eventos') && c.resumen_campo) {
      const x = (v.campos || {})[c.resumen_campo]
      if (x !== '' && x != null) partes.push(`${x}${c.resumen_unidad ? ' ' + c.resumen_unidad : ''}`)
    }
  }
  return partes.join(' · ')
}

// ═══════════════ UI ═══════════════
/* Cada componente arma sus estilos desde el tema (useTema + estilos). En el
   tema claro las filas siguen el patrón del anexo: etiqueta (con su porqué)
   · control de captura · resultado calculado como pastilla. En el oscuro se
   ven como siempre. */

const useS = () => { const T = useTema(); return [T, estilos(T)] }

// Sí / No del anexo (segmentado) o el select de siempre. El valor guardado no
// cambia: 'Cumple' / 'No cumple' (/ 'No aplica'), así la evaluación y el
// expediente siguen leyendo lo mismo.
function SelCumple({ value, onChange, disabled, ancho = 130, noAplica = false, sinPill = false }) {
  const [T, S] = useS()
  if (S.claro) {
    const ops = [['Cumple', 'Sí'], ['No cumple', 'No'], ...(noAplica ? [['No aplica', 'N/A']] : [])]
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', opacity: disabled ? .5 : 1 }}>
        <div role="radiogroup" style={{ display: 'inline-flex', border: `1.5px solid ${T.txt}`, borderRadius: 8, overflow: 'hidden', minHeight: 44 }}>
          {ops.map(([val, txt]) => {
            const on = value === val
            return (
              <button key={val} type="button" role="radio" aria-checked={on} disabled={disabled}
                onClick={() => onChange(on ? '' : val)}
                style={{
                  minWidth: 68, padding: '0 16px', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
                  background: on ? T.txt : T.card, color: on ? T.card : T.txt,
                  fontFamily: 'inherit', fontSize: 15, fontWeight: 600,
                }}>{txt}</button>
            )
          })}
        </div>
        {!sinPill && <Resultado value={value} />}
      </div>
    )
  }
  const color = value === 'Cumple' ? T.ok : value === 'No cumple' ? T.bad : T.line
  return (
    <select value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)}
      style={{ ...S.inp, width: ancho, flexShrink: 0, border: `1px solid ${color}`, opacity: disabled ? .45 : 1 }}>
      <option value="">Seleccioná</option>
      <option value="Cumple">Cumple</option>
      <option value="No cumple">No cumple</option>
      {noAplica && <option value="No aplica">No aplica</option>}
    </select>
  )
}

// Resultado de una verificación Sí/No como pastilla (solo tema claro).
function Resultado({ value }) {
  if (value === 'Cumple') return <Pill tipo="ok">Cumple</Pill>
  if (value === 'No cumple') return <Pill tipo="bad">No cumple</Pill>
  if (value === 'No aplica') return <Pill tipo="neutro">No aplica</Pill>
  return <Pill tipo="espera">En espera</Pill>
}

// Fila del anexo: etiqueta y porqué a la izquierda, control a la derecha.
function Fila({ etiqueta, porque, ayuda, children, style }) {
  const [, S] = useS()
  if (!S.claro) {
    return (
      <div style={{ ...S.fila, ...style }}>
        <span style={{ flex: 1 }}>
          {etiqueta}
          {porque && <div style={S.porque}>{porque}</div>}
        </span>
        {children}
      </div>
    )
  }
  return (
    <div style={{ ...S.fila, ...style }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.4 }}>
          <span>{etiqueta}</span>{ayuda && <Ayuda texto={ayuda} />}
        </div>
        {porque && <div style={S.porque}>{porque}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', flex: '0 1 auto' }}>
        {children}
      </div>
    </div>
  )
}

function Sello({ r }) {
  const [T] = useS()
  return r?.hora
    ? <div style={{ fontSize: 12, color: T.dim, marginTop: 2 }}>Registrado {fmtHora(r.hora)}{r.por ? ` · ${r.por}` : ''}</div>
    : null
}

function Titulo({ c }) {
  const [, S] = useS()
  return (
    <div style={S.h}>
      <span>{c.titulo}</span>
      {S.claro && c.ayuda && <Ayuda texto={c.ayuda} />}
    </div>
  )
}

// Vigencia del equipo elegido, como pastilla (claro) o línea (oscuro).
function Vigencia({ eq, cal }) {
  const [T, S] = useS()
  if (!eq) return null
  if (S.claro) return cal.ok
    ? <Pill tipo="ok">Vigente{eq.calibracion_vence ? ` · hasta ${eq.calibracion_vence}` : ''}</Pill>
    : <Pill tipo="bad">{cal.texto}</Pill>
  return (
    <div style={{ fontSize: 13, marginBottom: 8, color: cal.ok ? T.okTxt : T.badTxt }}>
      {cal.ok ? '✓ ' : '✕ '}{cal.texto}{!cal.ok && ' · el sistema bloquea este equipo'}
    </div>
  )
}

// ── Equipo ──
function ControlEquipo({ c, v, set, cat, hoy }) {
  const [T, S] = useS()
  const equipos = cat.equipos.filter(e => e.tipo === c.tipo_equipo)
  const eq = cat.equipos.find(e => e.id === v.equipo_id)
  const cal = calibracionEstado(eq, hoy)
  const activo = !c.opcional || v.aplica === true
  return (
    <div style={S.box}>
      <Titulo c={c} />
      {!S.claro && c.ayuda && <div style={S.ayuda}>{c.ayuda}</div>}
      {c.opcional && (
        <div style={{ marginBottom: 10 }}>
          <span style={S.lbl}>{c.pregunta || '¿Aplica?'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['No aplica', false], ['Sí, se usa', true]].map(([t, val]) => (
              <button key={t} type="button" onClick={() => set({ ...v, aplica: val })} style={{
                flex: 1, padding: '10px', borderRadius: 8, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', minHeight: 44,
                background: v.aplica === val ? (val ? T.acc : T.neutroBg) : T.inputBg,
                color: v.aplica === val ? (val ? '#fff' : T.txt) : T.dim, border: `1px solid ${v.aplica === val ? 'transparent' : T.line}`,
              }}>{t}</button>
            ))}
          </div>
        </div>
      )}
      {activo && (
        <>
          <Fila etiqueta={S.claro ? 'Equipo' : 'Código del equipo'} porque={S.claro ? 'Confirma el código grabado o escanea el QR' : null}
                style={S.claro ? { borderTop: 'none', paddingTop: 4 } : { borderTop: 'none', padding: 0, display: 'block' }}>
            <select value={v.equipo_id || ''} onChange={e => set({ ...v, equipo_id: e.target.value })}
              style={{ ...S.inp, ...(S.claro ? { width: 'auto', minWidth: 220, maxWidth: 360 } : { marginBottom: 6 }) }}>
              <option value="">Elegí por código…</option>
              {equipos.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre || e.tipo}</option>)}
            </select>
            {S.claro && <Vigencia eq={eq} cal={cal} />}
          </Fila>
          {!S.claro && <Vigencia eq={eq} cal={cal} />}
          {(c.criterios || []).map(k => (
            <Fila key={k.clave} etiqueta={k.texto} porque={k.ayuda}>
              <SelCumple value={v.criterios?.[k.clave]} onChange={val => set({ ...v, criterios: { ...(v.criterios || {}), [k.clave]: val } })} />
            </Fila>
          ))}
        </>
      )}
    </div>
  )
}

// ── Matriz de condición ──
function ControlMatriz({ c, v, set }) {
  const [, S] = useS()
  return (
    <div style={S.box}>
      <Titulo c={c} />
      {!S.claro && c.ayuda && <div style={S.ayuda}>{c.ayuda}</div>}
      {c.cantidad && (
        <Fila etiqueta="¿Cuántos incluís en esta liberación?" style={{ borderTop: 'none' }}>
          <input type="number" inputMode="numeric" min="1" value={v.cantidad ?? ''} onChange={e => set({ ...v, cantidad: e.target.value })}
                 style={{ ...S.inp, width: 120 }} placeholder="Ej: 3" />
        </Fila>
      )}
      {(c.criterios || []).map(k => (
        <Fila key={k.clave} etiqueta={k.texto} porque={k.ayuda}>
          <SelCumple value={v.criterios?.[k.clave]} onChange={val => set({ ...v, criterios: { ...(v.criterios || {}), [k.clave]: val } })} />
        </Fila>
      ))}
    </div>
  )
}

// ── Químicos ──
function ControlQuimicos({ c, v, set, cat, hoy }) {
  const [T, S] = useS()
  return (
    <div style={S.box}>
      <Titulo c={{ ...c, ayuda: c.ayuda || 'Registrá lo que de verdad usaste. El sistema compara la concentración con el rango que cargó Calidad y revisa que no esté vencido.' }} />
      {!S.claro && <div style={S.ayuda}>Registrá lo que de verdad usaste. El sistema compara la concentración con el rango que cargó Calidad y revisa que no esté vencido.</div>}
      {(c.lineas || []).map(linea => {
        const l = v[linea] || {}
        const lista = cat.quimicos.filter(q => q.categoria === linea)
        const q = cat.quimicos.find(x => x.id === l.quimico_id)
        const upd = (patch) => set({ ...v, [linea]: { ...l, ...patch } })
        const rango = q && (q.concentracion_min != null || q.concentracion_max != null)
          ? `${q.concentracion_min ?? '…'}–${q.concentracion_max ?? '…'} ${q.unidad_concentracion}` : null
        const n = Number(l.concentracion)
        const tieneConc = l.concentracion !== '' && l.concentracion != null
        const fuera = rango && tieneConc &&
          ((q.concentracion_min != null && n < Number(q.concentracion_min)) || (q.concentracion_max != null && n > Number(q.concentracion_max)))
        const vencido = l.vencimiento && l.vencimiento < hoy
        const estadoConc = !q ? null : !tieneConc ? 'espera' : fuera ? 'bad' : rango ? 'ok' : 'neutro'
        return (
          <div key={linea} style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10, marginTop: 6 }}>
            <div style={{ fontSize: S.claro ? 15 : 13, fontWeight: 600, marginBottom: 6, color: T.txt, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {cap(linea)}
              {S.claro && q && q.categoria === 'sanitizante' && q.tiempo_contacto_seg != null && (
                <span style={{ fontSize: 12.5, color: T.dim, fontWeight: 400 }}>contacto ≥ {q.tiempo_contacto_seg} s</span>
              )}
            </div>
            <select value={l.quimico_id || ''} style={{ ...S.inp, marginBottom: 8 }}
              onChange={e => {
                const id = e.target.value
                const qq = cat.quimicos.find(x => x.id === id)
                upd({ quimico_id: id, proveedor: l.proveedor || qq?.proveedor || '' })
              }}>
              <option value="">Elegí el producto del catálogo…</option>
              {lista.map(x => <option key={x.id} value={x.id}>{x.nombre}{x.proveedor ? ` · ${x.proveedor}` : ''}</option>)}
              {/* H-10: en la versión Mauricio no existe «Otro»: solo químicos del catálogo. */}
              {!S.claro && <option value="otro">Otro (escribir el nombre)</option>}
            </select>
            {l.quimico_id === 'otro' && (
              <input value={l.otro || ''} onChange={e => upd({ otro: e.target.value })} style={{ ...S.inp, marginBottom: 6 }} placeholder="Nombre del producto" />
            )}
            <div style={{ display: 'grid', gridTemplateColumns: S.claro ? 'repeat(auto-fit, minmax(170px, 1fr))' : '1fr 1fr', gap: 8 }}>
              <div><span style={S.lbl}>Lote</span><input value={l.lote || ''} onChange={e => upd({ lote: e.target.value })} style={S.inp} placeholder="Como dice el envase" /></div>
              <div><span style={S.lbl}>Proveedor</span><input value={l.proveedor || ''} onChange={e => upd({ proveedor: e.target.value })} style={S.inp} placeholder="Proveedor" /></div>
              <div>
                <span style={S.lbl}>Vence</span>
                <input type="date" value={l.vencimiento || ''} onChange={e => upd({ vencimiento: e.target.value })} style={{ ...S.inp, border: `1px solid ${vencido ? T.bad : (S.claro ? '#8a8a8a' : T.line)}` }} />
                {vencido && <div style={{ fontSize: 12, color: T.badTxt, marginTop: 3 }}>Vencido: no se puede usar</div>}
              </div>
              <div>
                <span style={S.lbl}>Concentración{rango ? ` · ${rango}` : ''}</span>
                <CampoNumero valor={l.concentracion ?? ''} onChange={val => upd({ concentracion: val })} unidad={q?.unidad_concentracion || ''}
                  mal={!!fuera} placeholder={rango ? 'Dato real medido' : 'Dilución usada'} />
                {S.claro && estadoConc && (
                  <div style={{ marginTop: 6 }}>
                    {estadoConc === 'ok' && <Pill tipo="ok">En rango</Pill>}
                    {estadoConc === 'bad' && <Pill tipo="bad">{l.concentracion} {q.unidad_concentracion} fuera de {rango}</Pill>}
                    {estadoConc === 'espera' && <Pill tipo="espera">En espera</Pill>}
                    {estadoConc === 'neutro' && <Pill tipo="neutro">Sin rango: solo se registra</Pill>}
                  </div>
                )}
                {!S.claro && fuera && <div style={{ fontSize: 11.5, color: T.badTxt }}>Fuera del rango de Calidad</div>}
                {!S.claro && q && !rango && <div style={{ fontSize: 11.5, color: T.dim }}>Sin rango cargado: solo se registra</div>}
                {!S.claro && q?.categoria === 'sanitizante' && q.tiempo_contacto_seg != null && (
                  <div style={{ fontSize: 11.5, color: T.dim }}>Tiempo de contacto exigido: {q.tiempo_contacto_seg} s</div>
                )}
                {S.claro && q?.categoria === 'sanitizante' && (
                  <div style={{ fontSize: 12, color: T.dim, marginTop: 4 }}>Mide con tira reactiva; la lectura se registra en {q.unidad_concentracion || 'la unidad del catálogo'}.</div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Número con la unidad como sufijo fijo (anexo: la unidad nunca se escribe) ──
// Guarda el número puro; muestra separador de miles mientras se teclea.
function CampoNumero({ valor, onChange, unidad, mal, paso, placeholder, ancho, style }) {
  const [T, S] = useS()
  if (!S.claro) {
    return (
      <input type="number" inputMode="decimal" step={paso || 'any'} value={valor ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={{ ...S.inp, border: `1px solid ${mal ? T.bad : T.line}`, width: ancho || '100%', ...style }} />
    )
  }
  const lleno = valor !== '' && valor != null
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'stretch', width: ancho || '100%', minHeight: 44, borderRadius: 8, overflow: 'hidden',
      border: `1.5px solid ${lleno && mal ? T.bad : lleno ? T.ok : '#8a8a8a'}`, background: T.inputBg, ...style,
    }}>
      <input type="text" inputMode="decimal" value={mostrarNumero(valor)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === ',') e.preventDefault() }}
        onChange={e => onChange(limpiarNumero(e.target.value))}
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: T.txt,
                 padding: '10px 12px', fontSize: 17, fontWeight: 600, textAlign: 'right', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }} />
      {unidad && (
        <span style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderLeft: `1px solid ${T.line}`, color: T.dim, fontSize: 14, whiteSpace: 'nowrap' }}>
          {unidad}
        </span>
      )}
    </div>
  )
}

// ── Un campo con validación en vivo (numero | select | hora | texto) ──
function Campo({ col, val, onChange, cat, enFila = false }) {
  const [T, S] = useS()
  const mal = col.tipo === 'numero' ? fueraDeRango(col, val, cat) : val === 'No cumple'
  const rango = col.tipo === 'numero' ? rangoTexto(col, cat) : null
  const lleno = val !== '' && val != null
  const control = col.tipo === 'select'
    ? <SelCumple value={val} ancho={'100%'} onChange={onChange} />
    : col.tipo === 'numero'
      ? <CampoNumero valor={val} onChange={onChange} unidad={col.unidad} mal={mal} paso={col.paso}
          placeholder={col.placeholder || (S.claro ? '' : 'Dato real')} ancho={S.claro ? 200 : '100%'} />
      : <input type={col.tipo === 'hora' ? 'time' : 'text'} value={val ?? ''} onChange={e => onChange(e.target.value)}
          placeholder={col.placeholder || ''} style={{ ...S.inp, width: S.claro ? 200 : '100%' }} />
  if (S.claro) {
    const pill = col.tipo === 'numero'
      ? (!lleno ? <Pill tipo="espera">En espera</Pill> : mal ? <Pill tipo="bad">Fuera de {rango || 'criterio'}</Pill> : <Pill tipo="ok">{rango ? `Dentro de ${rango}` : 'Registrado'}</Pill>)
      : col.tipo === 'select' ? null
      : (lleno ? <Pill tipo="ok">Registrado</Pill> : <Pill tipo="espera">En espera</Pill>)
    return (
      <Fila etiqueta={col.label} porque={rango ? `Criterio ${rango}` : null} ayuda={col.ayuda} style={enFila ? undefined : { borderTop: 'none', padding: '6px 0' }}>
        {control}{pill}
      </Fila>
    )
  }
  return (
    <div>
      <span style={S.lbl}>
        {col.label}{rango ? ` · ${rango}` : ''}
        {col.ayuda && <div style={{ fontSize: 11, color: T.dim, fontWeight: 400 }}>{col.ayuda}</div>}
      </span>
      {control}
    </div>
  )
}

// ── Tabla: mismas columnas para cada tanda o unidad ──
function ControlTabla({ c, v, set, cat }) {
  const [T, S] = useS()
  return (
    <div style={S.box}>
      <Titulo c={c} />
      {!S.claro && c.ayuda && <div style={S.ayuda}>{c.ayuda}</div>}
      {(c.filas || []).map(f => {
        const r = v[f.clave] || {}
        return (
          <div key={f.clave} style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10, marginTop: 8 }}>
            <div style={{ fontSize: S.claro ? 15 : 13, fontWeight: 600, marginBottom: 6 }}>
              {f.nombre}{f.fijo && <span style={{ color: T.dim, fontWeight: 400 }}> · {f.fijo}</span>}
            </div>
            <div style={S.claro ? {} : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {(c.columnas || []).map(col => (
                <Campo key={col.clave} col={col} cat={cat} val={r[col.clave]} enFila
                  onChange={val => set({ ...v, [f.clave]: { ...r, [col.clave]: val } })} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Eventos: se toca cuando pasa, y el sistema pone la hora ──
// En el tema claro es la «línea de tiempo» del anexo: hora · punto · texto · resultado.
function ControlEventos({ c, v, set, cat, ahoraISO, quien }) {
  const [T, S] = useS()
  const ev = v.hitos || {}
  const campos = v.campos || {}
  const hitos = c.hitos || []
  const listo = (i) => i === 0 || !!ev[hitos[i - 1].clave]?.hora
  // Un hito puede exigir que otro ya esté registrado (el agua antes que los ácidos).
  const depOk = (hito) => !hito.depende || !!ev[hito.depende]?.hora
  return (
    <div style={S.box}>
      <Titulo c={c} />
      {!S.claro && c.ayuda && <div style={S.ayuda}>{c.ayuda}</div>}
      {hitos.map((hito, i) => {
        const r = ev[hito.clave]
        const habil = listo(i) && depOk(hito)
        const sellado = !!r?.hora
        return (
          <div key={hito.clave} style={{ ...S.fila, alignItems: 'flex-start', opacity: habil ? 1 : .55, flexWrap: 'nowrap' }}>
            {S.claro
              ? <div style={{ width: 74, flexShrink: 0, fontSize: 14, color: T.dim, fontVariantNumeric: 'tabular-nums', paddingTop: 3 }}>
                  {sellado ? fmtHora(r.hora).slice(0, 8) : '—'}
                </div>
              : null}
            <div style={{
              width: S.claro ? 14 : 22, height: S.claro ? 14 : 22, borderRadius: 11, flexShrink: 0, marginTop: S.claro ? 7 : 4,
              fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: sellado ? T.ok : (S.claro ? 'transparent' : T.neutroBg),
              border: S.claro && !sellado ? `2px solid ${T.dim}` : 'none',
              color: sellado ? '#fff' : T.dim,
            }}>{S.claro ? '' : (sellado ? '✓' : (hito.minuto ?? i + 1))}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ lineHeight: 1.45 }}>{hito.texto}</div>
              {hito.detalle && <div style={S.porque}>{hito.detalle}</div>}
              {sellado
                ? (!S.claro && <div style={{ fontSize: 11.5, color: T.dim, marginTop: 3 }}>Registrado {fmtHora(r.hora)}{r.por ? ` · ${r.por}` : ''}</div>)
                : !habil && <div style={{ fontSize: 12, color: T.warnTxt, marginTop: 3 }}>{hito.bloqueo || 'Se habilita al registrar lo anterior.'}</div>}
              {habil && (hito.campos || []).length > 0 && (
                <div style={{ display: S.claro ? 'block' : 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 8 }}>
                  {hito.campos.map(col => {
                    if (col.tipo === 'duracion') {
                      const min = duracionEntre(col, ev)
                      const mal = min != null && fueraDeRango(col, min, cat)
                      const rango = rangoTexto(col, cat)
                      if (S.claro) {
                        return (
                          <Fila key={col.clave} etiqueta={col.label} porque={rango ? `Criterio ${rango} · la calcula el servidor entre los dos hitos` : 'La calcula el servidor entre los dos hitos'} style={{ borderTop: 'none', padding: '6px 0' }}>
                            <span style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: T.txt }}>
                              {min == null ? '—' : `${min} ${col.unidad || 'min'}`}
                            </span>
                            {min == null ? <Pill tipo="espera">Al cerrar el hito</Pill> : mal ? <Pill tipo="bad">Fuera de {rango || 'criterio'}</Pill> : <Pill tipo="ok">Cumple</Pill>}
                          </Fila>
                        )
                      }
                      return (
                        <div key={col.clave} style={{ gridColumn: '1/-1' }}>
                          <span style={S.lbl}>{col.label}{rango ? ` · ${rango}` : ''}</span>
                          <div style={{
                            ...S.inp, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            border: `1px solid ${min == null ? T.line : mal ? T.bad : T.ok}`,
                            color: min == null ? T.dim : mal ? T.badTxt : T.okTxt,
                          }}>
                            <span>{min == null ? 'Se calcula al registrar los dos hitos' : `${min} ${col.unidad || 'min'}`}</span>
                            {min != null && <span style={{ fontSize: 11.5 }}>{mal ? 'fuera de lo exigido' : 'cumple'}</span>}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <Campo key={col.clave} col={col} cat={cat} val={campos[col.clave]}
                        onChange={val => set({ ...v, campos: { ...campos, [col.clave]: val } })} />
                    )
                  })}
                </div>
              )}
            </div>
            {sellado && S.claro && <Pill tipo="ok">{fmtHora(r.hora).slice(0, 5)}{r.por ? ` · ${r.por}` : ''}</Pill>}
            {!sellado && (
              <button type="button" disabled={!habil} onClick={() => set({ ...v, hitos: { ...ev, [hito.clave]: { hora: ahoraISO(), por: quien } } })}
                style={{
                  flexShrink: 0, minHeight: 44, background: habil ? (S.claro ? T.txt : T.acc) : T.neutroBg,
                  color: habil ? (S.claro ? T.card : '#fff') : T.dim,
                  border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 600,
                  cursor: habil ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                }}>{hito.boton || 'Registrar'}</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Campos sueltos, con o sin equipo asociado ──
function ControlCampos({ c, v, set, cat, hoy }) {
  const [, S] = useS()
  const campos = v.campos || {}
  const equipos = c.tipo_equipo ? cat.equipos.filter(e => e.tipo === c.tipo_equipo) : []
  const eq = cat.equipos.find(e => e.id === v.equipo_id)
  const cal = calibracionEstado(eq, hoy)
  return (
    <div style={S.box}>
      <Titulo c={c} />
      {!S.claro && c.ayuda && <div style={S.ayuda}>{c.ayuda}</div>}
      {c.tipo_equipo && (
        <Fila etiqueta={c.label_equipo || 'Equipo'} porque={S.claro ? 'Confirma el código grabado o escanea el QR' : null}
              style={S.claro ? { borderTop: 'none', paddingTop: 4 } : { borderTop: 'none', padding: 0, display: 'block' }}>
          <select value={v.equipo_id || ''} onChange={e => set({ ...v, equipo_id: e.target.value })}
            style={{ ...S.inp, ...(S.claro ? { width: 'auto', minWidth: 220, maxWidth: 360 } : { marginBottom: 6 }) }}>
            <option value="">Elegí por código…</option>
            {equipos.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre || ''}</option>)}
          </select>
          <Vigencia eq={eq} cal={cal} />
        </Fila>
      )}
      <div style={S.claro ? {} : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 9 }}>
        {(c.campos || []).map(col => (
          <Campo key={col.clave} col={col} cat={cat} val={campos[col.clave]} enFila
            onChange={val => set({ ...v, campos: { ...campos, [col.clave]: val } })} />
        ))}
      </div>
    </div>
  )
}

// ── Matriz de básculas (paso 7) ──
function ControlBasculas({ c, v, set, cat, hoy }) {
  const [T, S] = useS()
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
    <div style={S.box}>
      <div style={{ ...S.h, justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{c.titulo}{S.claro && c.ayuda && <Ayuda texto={c.ayuda} />}</span>
        {S.claro && (aptas >= minimo ? <Pill tipo="ok">{aptas} de {minimo} aptas</Pill> : <Pill tipo="espera">{aptas} de {minimo} aptas</Pill>)}
      </div>
      {!S.claro && c.ayuda && <div style={S.ayuda}>{c.ayuda}</div>}
      {orden.map(k => {
        const f = filas[k] || {}
        const eq = cat.equipos.find(e => e.id === f.equipo_id)
        const cal = calibracionEstado(eq, hoy)
        const est = apta(k)
        const alterna = k === '3'
        return (
          <div key={k} style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: S.claro ? 15 : 13, fontWeight: 600 }}>Báscula {k}{alterna ? ' · alterna' : ''}</span>
              {est != null && (S.claro
                ? (est ? <Pill tipo="ok">Apta</Pill> : <Pill tipo="bad">No apta</Pill>)
                : <span style={{ fontSize: 11.5, fontWeight: 600, color: est ? T.okTxt : T.badTxt }}>{est ? '✓ apta' : '✕ no apta'}</span>)}
            </div>
            {alterna && <div style={{ fontSize: 12, color: T.warnTxt, marginBottom: 6 }}>Se habilitó porque una de las otras no cumple. No hay una cuarta.</div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <select value={f.equipo_id || ''} onChange={e => upd(k, { equipo_id: e.target.value })} style={{ ...S.inp, width: S.claro ? 'auto' : '100%', minWidth: 220, maxWidth: 360 }}>
                <option value="">Elegí la báscula por su código…</option>
                {basculas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre || ''}</option>)}
              </select>
              {S.claro && <Vigencia eq={eq} cal={cal} />}
            </div>
            {!S.claro && <Vigencia eq={eq} cal={cal} />}
            {(c.criterios || []).map(x => (
              <Fila key={x.clave} etiqueta={x.texto}>
                <SelCumple value={f.criterios?.[x.clave]} noAplica={!!x.no_aplica}
                  onChange={val => upd(k, { criterios: { ...(f.criterios || {}), [x.clave]: val } })} />
              </Fila>
            ))}
          </div>
        )
      })}
      <div style={{
        marginTop: 10, padding: '9px 11px', borderRadius: 8, fontSize: 13, fontWeight: 600,
        background: aptas >= minimo ? T.okBg : T.badBg, color: aptas >= minimo ? T.okTxt : T.badTxt,
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
  const [T, S] = useS()
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

  const ayudaSec = 'Hacé cada etapa y marcala en orden. Cada «Sí» queda con hora y con tu nombre. Si una no la podés hacer como dice, marcá «No»: el paso queda fuera de criterio.'
  const btnPrim = { ...S.inp, background: S.claro ? T.txt : T.acc, color: S.claro ? T.card : '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', minHeight: 48 }

  return (
    <div style={S.box}>
      <Titulo c={{ ...c, ayuda: c.ayuda || ayudaSec }} />
      {!S.claro && <div style={S.ayuda}>{ayudaSec}</div>}
      {etapas.map((e, i) => {
        const r = et[e.clave]
        const habil = okAnterior(i)
        return (
          <div key={e.clave} style={{ ...S.fila, alignItems: 'flex-start', opacity: habil ? 1 : .55, flexWrap: 'wrap' }}>
            {!S.claro && (
              <div style={{
                width: 22, height: 22, borderRadius: 11, flexShrink: 0, marginTop: 6, fontSize: 11.5, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: r?.estado === 'Cumple' ? T.ok : r?.estado === 'No cumple' ? T.bad : T.neutroBg,
                color: r?.estado && r.estado !== 'Pendiente' ? '#fff' : T.dim,
              }}>{r?.estado === 'Cumple' ? '✓' : r?.estado === 'No cumple' ? '✕' : i + 1}</div>
            )}
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <div style={{ lineHeight: 1.45 }}>{S.claro ? `${i + 1} · ` : ''}{e.texto}</div>
              {!e.cronometro && (S.claro
                ? (r?.hora && <div style={S.porque}>{fmtHora(r.hora)}{r.por ? ` · ${r.por}` : ''}</div>)
                : <Sello r={r} />)}

              {e.esponja && habil && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: cfgEsponja ? 'repeat(auto-fit, minmax(200px, 1fr))' : '1fr', gap: 8 }}>
                  <div>
                    <span style={S.lbl}>Condición de la esponja (limpia, íntegra y de esta área)</span>
                    <SelCumple value={v.esponja?.condicion} ancho={'100%'} onChange={val => set({ ...v, esponja: { ...(v.esponja || {}), condicion: val } })} />
                  </div>
                  {cfgEsponja ? (
                    <div>
                      <span style={S.lbl}>Color de la esponja · autorizado: {cfgEsponja.color}</span>
                      <select value={v.esponja?.color || ''} onChange={ev => set({ ...v, esponja: { ...(v.esponja || {}), color: ev.target.value } })}
                        style={{ ...S.inp, border: `1px solid ${v.esponja?.color && v.esponja.color !== cfgEsponja.color ? T.bad : (S.claro ? '#8a8a8a' : T.line)}` }}>
                        <option value="">Color…</option>
                        {COLORES_ESPONJA.map(col => <option key={col} value={col}>{col}</option>)}
                      </select>
                      {S.claro && v.esponja?.color && v.esponja.color !== cfgEsponja.color && (
                        <div style={{ marginTop: 6 }}><Pill tipo="bad">Es de área {v.esponja.color}; este paso exige {cfgEsponja.color}</Pill></div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: T.warnTxt }}>Color por área: pendiente de que Calidad apruebe el catálogo. Por ahora no se valida color.</div>
                  )}
                </div>
              )}

              {e.cronometro && habil && (
                <div style={{ marginTop: 8, background: S.claro ? T.bg : '#0a0a0a', border: `1px solid ${corriendo ? T.acc : T.line}`, borderRadius: 9, padding: 12 }}>
                  <div style={{ fontSize: 13, color: T.dim, marginBottom: 6 }}>
                    Tiempo de contacto {req != null ? <>· exigido <b style={{ color: T.txt }}>≥ {req} s</b></> : <>· <span style={{ color: T.warnTxt }}>sin parámetro cargado: solo se registra</span></>}
                    {S.claro && ' · lo cuenta el servidor'}
                  </div>
                  {!cr.inicio && (
                    <button type="button" onClick={iniciar} style={btnPrim}>
                      ▶ Ya apliqué el sanitizante · empezar a contar
                    </button>
                  )}
                  {corriendo && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 44, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontFamily: T.fontTitulo, color: req != null && segCorriendo >= req ? T.ok : T.txt }}>
                        {mmss(segCorriendo)}{req != null && <span style={{ fontSize: 18, color: T.dim, fontWeight: 600 }}> de {req} s</span>}
                      </div>
                      <div style={{ fontSize: 12, color: T.dim, marginBottom: 8 }}>Empezó {fmtHora(cr.inicio)}{req != null && segCorriendo < req ? ' · no enjuagues todavía' : ''}</div>
                      <button type="button" onClick={() => terminar(e)} style={{ ...btnPrim, background: T.neutroBg, color: T.txt }}>
                        ■ Terminó el contacto
                      </button>
                    </div>
                  )}
                  {cr.fin && (
                    <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: cr.veredicto === 'No cumple' ? T.badTxt : T.okTxt }}>
                      <span>{fmtHora(cr.inicio)} → {fmtHora(cr.fin)} · <b>{Math.round(cr.seg)} s</b></span>
                      {cr.veredicto === 'Cumple' && (S.claro ? <Pill tipo="ok">≥ {req} s</Pill> : ' · ✓ cumple el tiempo exigido')}
                      {cr.veredicto === 'No cumple' && (S.claro ? <Pill tipo="bad">Faltaron {Math.ceil(req - cr.seg)} s de {req} s</Pill> : ` · ✕ faltaron ${Math.ceil(req - cr.seg)} s`)}
                      {cr.veredicto === 'sin_parametro' && (S.claro ? <Pill tipo="neutro">Registrado (sin parámetro)</Pill> : ' · registrado (sin parámetro)')}
                      <button type="button" onClick={() => { const nuevo = { ...et }; delete nuevo[e.clave]; set({ ...v, cronometro: {}, etapas: nuevo }) }}
                        style={{ background: 'none', border: `1px solid ${T.line}`, color: T.dim, borderRadius: 6, padding: '4px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                        volver a contar
                      </button>
                    </div>
                  )}
                </div>
              )}
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
  const [T, S] = useS()
  if (!Array.isArray(controles) || !controles.length) return null
  if (!cat.listo) return <div style={{ ...S.box, color: T.dim, fontSize: 13 }}>Cargando catálogos de Calidad…</div>
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
        if (c.tipo === 'tabla') return <ControlTabla key={c.clave} {...props} />
        if (c.tipo === 'campos') return <ControlCampos key={c.clave} {...props} />
        if (c.tipo === 'eventos') return <ControlEventos key={c.clave} {...props} ahoraISO={ahoraISO} quien={quien} />
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
  const [T, S] = useS()
  const causas = cat.desvios.filter(d => d.contexto === contexto && d.tipo === 'causa')
  const acciones = cat.desvios.filter(d => d.contexto === contexto && d.tipo === 'accion')
  const d = desvio || {}
  const upd = (p) => setDesvio({ ...d, ...p })
  return (
    <div style={{ background: T.badBg, border: `1px solid ${T.bad}`, borderRadius: 11, padding: 13, marginBottom: 12, color: T.badTxt }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>No cumple · el paso queda bloqueado</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>
        {esCritico
          ? 'Registrá la causa y la acción correctiva. La tanda se bloquea hasta que Calidad la libere; después se repite la verificación.'
          : 'Registrá la causa y la acción correctiva. Queda como desvío en el expediente de la tanda.'}
      </div>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        {fallas.map((f, i) => <li key={i}>{f.detalle} — esperado {f.valor_esperado}, real <b>{f.valor_real}</b></li>)}
      </ul>
      <span style={S.lbl}>Causa identificada</span>
      <select value={d.causa || ''} onChange={e => upd({ causa: e.target.value })} style={{ ...S.inp, marginBottom: 6 }}>
        <option value="">Seleccioná una causa…</option>
        {causas.map(x => <option key={x.id} value={x.texto}>{x.texto}</option>)}
        <option value="Otra">Otra (describir)</option>
      </select>
      {d.causa === 'Otra' && <input value={d.causa_otra || ''} onChange={e => upd({ causa_otra: e.target.value })} style={{ ...S.inp, marginBottom: 6 }} placeholder="Describí la causa" />}
      <span style={S.lbl}>Acción correctiva</span>
      <select value={d.accion || ''} onChange={e => upd({ accion: e.target.value })} style={{ ...S.inp, marginBottom: 6 }}>
        <option value="">Seleccioná una acción…</option>
        {acciones.map(x => <option key={x.id} value={x.texto}>{x.texto}</option>)}
        <option value="Otra">Otra (describir)</option>
      </select>
      {d.accion === 'Otra' && <input value={d.accion_otra || ''} onChange={e => upd({ accion_otra: e.target.value })} style={S.inp} placeholder="Describí la acción realizada" />}
    </div>
  )
}
