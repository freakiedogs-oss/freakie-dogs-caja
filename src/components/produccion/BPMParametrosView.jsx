import { useEffect, useState } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   Parámetros BPM — lo que administra Calidad (Mauricio), no el operario.

   Equipos con su calibración, químicos con rango de concentración y tiempo
   de contacto, color de esponja por área, causas y acciones de desvío, y
   parámetros sueltos (temperaturas objetivo, laurel, corte de vegetales).
   El motor de controles (BPMControles.jsx) valida contra lo que esté acá.
   ═══════════════════════════════════════════════════════════════════════ */

const ROLES_EDITAN = ['jefe_casa_matriz', 'ing_alimentos', 'admin', 'ejecutivo', 'superadmin']

const C = { card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92', ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', acc: '#3b82f6' }
const inp = { background: '#141416', border: `1px solid ${C.line}`, color: C.txt, borderRadius: 7, padding: '7px 9px', fontSize: 13.5, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }
const btn = (bg, dis) => ({ background: dis ? '#3a3a40' : bg, color: dis ? C.dim : '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13.5, fontWeight: 600, cursor: dis ? 'not-allowed' : 'pointer', fontFamily: 'inherit' })

const COLORES = ['Verde', 'Rojo', 'Azul', 'Amarillo', 'Blanco', 'Negro', 'Otro']
const AREAS = ['vegetales', 'carnes', 'chili', 'tapa', 'cucharones']
const CONTEXTOS = ['termometro', 'limpieza', 'tapa', 'cucharones', 'pesaje', 'coccion', 'integracion', 'general']

const TABS = [
  { key: 'equipos', label: 'Equipos', tabla: 'bpm_equipos', orden: 'codigo',
    ayuda: 'Cada termómetro y báscula con su código visible y hasta cuándo vale su calibración. Sin fecha o vencida, el sistema bloquea el paso que lo use.',
    cols: [
      { k: 'codigo', label: 'Código', tipo: 'text', w: 110 },
      { k: 'tipo', label: 'Tipo', tipo: 'select', opciones: ['termometro', 'infrarrojo', 'bascula', 'otro'], w: 120 },
      { k: 'nombre', label: 'Nombre', tipo: 'text' },
      { k: 'calibracion_vence', label: 'Calibración vence', tipo: 'date', w: 150 },
      { k: 'activo', label: 'Activo', tipo: 'bool', w: 60 },
      { k: 'notas', label: 'Notas', tipo: 'text' },
    ],
    nuevo: () => ({ codigo: '', tipo: 'termometro', nombre: '', calibracion_vence: '', activo: true, notas: '' }) },
  { key: 'quimicos', label: 'Químicos', tabla: 'bpm_quimicos', orden: 'nombre',
    ayuda: 'Detergentes y sanitizantes aprobados. Si cargás rango de concentración, el sistema marca "No cumple" fuera de él. El tiempo de contacto (segundos) es el que el cronómetro exige al sanitizante.',
    cols: [
      { k: 'nombre', label: 'Producto', tipo: 'text' },
      { k: 'categoria', label: 'Categoría', tipo: 'select', opciones: ['detergente', 'sanitizante'], w: 120 },
      { k: 'proveedor', label: 'Proveedor', tipo: 'text' },
      { k: 'unidad_concentracion', label: 'Unidad', tipo: 'text', w: 70 },
      { k: 'concentracion_min', label: 'Mín', tipo: 'number', w: 70 },
      { k: 'concentracion_max', label: 'Máx', tipo: 'number', w: 70 },
      { k: 'tiempo_contacto_seg', label: 'Contacto (s)', tipo: 'number', w: 90 },
      { k: 'activo', label: 'Activo', tipo: 'bool', w: 60 },
      { k: 'notas', label: 'Notas', tipo: 'text' },
    ],
    nuevo: () => ({ nombre: '', categoria: 'sanitizante', proveedor: '', unidad_concentracion: 'ppm', concentracion_min: '', concentracion_max: '', tiempo_contacto_seg: '', activo: true, notas: '' }) },
  { key: 'esponjas', label: 'Esponjas', tabla: 'bpm_esponjas', orden: 'area',
    ayuda: 'Color de esponja autorizado por área. Mientras "Vigente" esté apagado, el sistema no valida color: solo pide la condición de la esponja.',
    cols: [
      { k: 'area', label: 'Área', tipo: 'select', opciones: AREAS, w: 120 },
      { k: 'color', label: 'Color', tipo: 'select', opciones: COLORES, w: 110 },
      { k: 'vigente', label: 'Vigente', tipo: 'bool', w: 70 },
      { k: 'version', label: 'Versión', tipo: 'text', w: 90 },
      { k: 'aprobado_por', label: 'Aprobó', tipo: 'ro' },
      { k: 'aprobado_at', label: 'Cuándo', tipo: 'ro', fmt: v => v ? new Date(v).toLocaleDateString('es-SV') : '' },
    ],
    alGuardar: (row, user) => row.vigente ? { ...row, aprobado_por: user?.nombre || 'Calidad', aprobado_at: new Date().toISOString() } : row,
    nuevo: () => ({ area: 'vegetales', color: '', vigente: false, version: '' }) },
  { key: 'desvios', label: 'Causas y acciones', tabla: 'bpm_desvio_catalogo', orden: 'contexto',
    ayuda: 'Lo que el operario puede elegir cuando algo no cumple, por contexto. "Otra (describir)" siempre existe y exige texto.',
    cols: [
      { k: 'contexto', label: 'Contexto', tipo: 'select', opciones: CONTEXTOS, w: 120 },
      { k: 'tipo', label: 'Tipo', tipo: 'select', opciones: ['causa', 'accion'], w: 90 },
      { k: 'texto', label: 'Texto', tipo: 'text' },
      { k: 'orden', label: 'Orden', tipo: 'number', w: 60 },
      { k: 'activo', label: 'Activo', tipo: 'bool', w: 60 },
    ],
    nuevo: () => ({ contexto: 'limpieza', tipo: 'causa', texto: '', orden: 9, activo: true }) },
  { key: 'ingredientes', label: 'Ingredientes del chili', tabla: 'bpm_pesaje_items', orden: 'orden',
    ayuda: 'La fórmula que se pesa en la tablet. La tolerancia efectiva es la mayor entre el porcentaje y el piso en gramos. Lo que marques acá es lo que la tablet le va a exigir al operario antes de dejarlo guardar.',
    cols: [
      { k: 'orden', label: '#', tipo: 'number', w: 45 },
      { k: 'ingrediente', label: 'Ingrediente', tipo: 'text' },
      { k: 'gramos_objetivo', label: 'Objetivo', tipo: 'number', w: 85 },
      { k: 'unidad', label: 'Unidad', tipo: 'text', w: 70 },
      { k: 'tolerancia_pct', label: 'Tol. %', tipo: 'number', w: 70 },
      { k: 'tolerancia_g', label: 'Piso g', tipo: 'number', w: 70 },
      { k: 'fuente', label: 'Se pesa en', tipo: 'select', opciones: ['balanza_grande', 'balanza_precision', 'conteo'], w: 150 },
      { k: 'requiere_lote', label: 'Lote', tipo: 'bool', w: 50 },
      { k: 'requiere_proveedor', label: 'Proveedor', tipo: 'bool', w: 70 },
      { k: 'requiere_vencimiento', label: 'Vence', tipo: 'bool', w: 55 },
      { k: 'requiere_foto', label: 'Foto', tipo: 'bool', w: 50 },
      { k: 'activo', label: 'Activo', tipo: 'bool', w: 55 },
    ],
    nuevo: () => ({ orden: 99, grupo: 'base', ingrediente: '', gramos_objetivo: 0, unidad: 'g', tolerancia_pct: 10, tolerancia_g: 2, fuente: 'balanza_grande', requiere_lote: false, requiere_proveedor: false, requiere_vencimiento: false, requiere_foto: false, activo: true }) },
  { key: 'parametros', label: 'Parámetros', tabla: 'bpm_parametros', orden: 'clave', pk: 'clave',
    ayuda: 'Valores sueltos que usan los pasos de cocción (fase 2): temperaturas objetivo, hojas de laurel, corte de vegetales.',
    cols: [
      { k: 'clave', label: 'Clave', tipo: 'text', w: 220 },
      { k: 'valor', label: 'Valor', tipo: 'text', w: 100 },
      { k: 'descripcion', label: 'Descripción', tipo: 'text' },
    ],
    alGuardar: (row, user) => ({ ...row, actualizado_por: user?.nombre || 'Calidad', updated_at: new Date().toISOString() }),
    nuevo: () => ({ clave: '', valor: '', descripcion: '' }) },
]

export default function BPMParametrosView({ user }) {
  const puedeEditar = ROLES_EDITAN.includes(user?.rol)
  const [tab, setTab] = useState('equipos')
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState('')
  const [guardando, setGuardando] = useState(null)
  const def = TABS.find(t => t.key === tab)
  const pk = def.pk || 'id'

  // La fórmula del chili cuelga del paso 7 de la plantilla activa: se resuelve
  // una vez para poder filtrar y para poder crear filas nuevas.
  const [pasoPesaje, setPasoPesaje] = useState(null)
  useEffect(() => {
    db.from('bpm_pasos').select('id, plantilla_id, bpm_plantillas!inner(activo)')
      .eq('clave', 'pesaje_ingredientes').eq('bpm_plantillas.activo', true).limit(1)
      .then(({ data }) => setPasoPesaje(data?.[0]?.id || null))
  }, [])

  async function cargar() {
    setCargando(true); setMsg('')
    let q = db.from(def.tabla).select('*').order(def.orden)
    if (def.tabla === 'bpm_pesaje_items' && pasoPesaje) q = q.eq('paso_id', pasoPesaje)
    const { data, error } = await q
    if (error) setMsg('❌ ' + error.message)
    setFilas((data || []).map(r => ({ ...r, _dirty: false })))
    setCargando(false)
  }
  useEffect(() => { cargar() }, [tab, pasoPesaje]) // eslint-disable-line

  const edit = (i, k, v) => setFilas(fs => fs.map((f, j) => j === i ? { ...f, [k]: v, _dirty: true } : f))

  async function guardar(i) {
    if (!puedeEditar) return
    const f = filas[i]
    setGuardando(i); setMsg('')
    try {
      let row = { ...f }
      delete row._dirty; delete row._nuevo
      for (const c of def.cols) {
        if (c.tipo === 'number' || c.tipo === 'date') { if (row[c.k] === '' || row[c.k] == null) row[c.k] = null }
        if (c.tipo === 'number' && row[c.k] != null) row[c.k] = Number(row[c.k])
        if (c.tipo === 'ro') delete row[c.k]
      }
      if (def.alGuardar) {
        const extra = def.alGuardar({ ...f }, user)
        for (const c of def.cols) if (c.tipo === 'ro' && extra[c.k] !== undefined) row[c.k] = extra[c.k]
        if (extra.actualizado_por !== undefined) row.actualizado_por = extra.actualizado_por
        if (extra.updated_at !== undefined) row.updated_at = extra.updated_at
      }
      if (def.tabla === 'bpm_equipos' || def.tabla === 'bpm_quimicos') row.actualizado_por = user?.nombre || null
      if (def.tabla === 'bpm_pesaje_items' && f._nuevo) row.paso_id = pasoPesaje
      if (f._nuevo) {
        if (pk === 'id') delete row.id
        const { error } = await db.from(def.tabla).insert(row)
        if (error) throw error
      } else {
        const { error } = await db.from(def.tabla).update(row).eq(pk, f[pk])
        if (error) throw error
      }
      setMsg('✓ Guardado')
      await cargar()
    } catch (e) {
      setMsg('❌ ' + (e.message || 'No se pudo guardar'))
    }
    setGuardando(null)
  }

  const agregar = () => setFilas(fs => [...fs, { ...def.nuevo(), _dirty: true, _nuevo: true }])

  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })
  const estadoCal = (f) => !f.calibracion_vence ? ['Sin calibración', C.bad] : f.calibracion_vence < hoy ? ['Vencida', C.bad] : ['Vigente', C.ok]

  return (
    <div style={{ padding: 14, color: C.txt }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 4px' }}>🧪 Parámetros BPM · Calidad</h2>
        <div style={{ color: C.dim, fontSize: 13, marginBottom: 14 }}>
          Lo que se carga acá es contra lo que el Control BPM del chili decide "cumple" o "no cumple". {!puedeEditar && 'Tu rol solo lee.'}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              ...btn(tab === t.key ? C.acc : '#2a2a2e'), padding: '8px 12px',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>{def.ayuda}</div>
          {msg && <div style={{ fontSize: 13, marginBottom: 8, color: msg.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{msg}</div>}
          {cargando ? <div style={{ color: C.dim }}>Cargando…</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                    {def.cols.map(c => <th key={c.k} style={{ textAlign: 'left', padding: '6px 4px', fontSize: 10.5, color: C.dim, textTransform: 'uppercase', letterSpacing: .4, width: c.w }}>{c.label}</th>)}
                    {tab === 'equipos' && <th style={{ fontSize: 10.5, color: C.dim, textAlign: 'left', padding: '6px 4px' }}>ESTADO</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={f[pk] || `n${i}`} style={{ borderBottom: `1px solid #222` }}>
                      {def.cols.map(c => (
                        <td key={c.k} style={{ padding: '5px 4px', verticalAlign: 'middle' }}>
                          {c.tipo === 'ro' ? <span style={{ color: C.dim }}>{c.fmt ? c.fmt(f[c.k]) : (f[c.k] || '')}</span>
                          : c.tipo === 'bool' ? <input type="checkbox" checked={!!f[c.k]} disabled={!puedeEditar} onChange={e => edit(i, c.k, e.target.checked)} />
                          : c.tipo === 'select' ? (
                            <select value={f[c.k] || ''} disabled={!puedeEditar || (c.k === 'area' && !f._nuevo)} onChange={e => edit(i, c.k, e.target.value)} style={inp}>
                              <option value="">—</option>
                              {c.opciones.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>)
                          : <input type={c.tipo === 'number' ? 'number' : c.tipo === 'date' ? 'date' : 'text'} step="any"
                              value={f[c.k] ?? ''} disabled={!puedeEditar || (c.k === pk && !f._nuevo && pk !== 'id')}
                              onChange={e => edit(i, c.k, e.target.value)} style={inp} />}
                        </td>
                      ))}
                      {tab === 'equipos' && (() => { const [t, col] = estadoCal(f); return <td style={{ padding: '5px 4px', color: col, fontWeight: 600, whiteSpace: 'nowrap' }}>{t}</td> })()}
                      <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>
                        {puedeEditar && (
                          <button onClick={() => guardar(i)} disabled={!f._dirty || guardando === i} style={btn(C.ok, !f._dirty || guardando === i)}>
                            {guardando === i ? '…' : f._nuevo ? 'Crear' : 'Guardar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {puedeEditar && !cargando && (
            <button onClick={agregar} style={{ ...btn('#2a2a2e'), marginTop: 10 }}>+ Agregar fila</button>
          )}
        </div>
      </div>
    </div>
  )
}
