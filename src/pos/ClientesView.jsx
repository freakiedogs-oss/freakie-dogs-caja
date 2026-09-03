import { useState, useEffect, useCallback } from 'react'
import { db } from '../supabase'
// Esta pantalla también se monta en el back-office (Finanzas → Clientes de
// Facturación), y ahí `pos.css` no está cargado: el ERP entra por otro entry
// point. Se importa acá para que viaje con el chunk. Es seguro: pos.css no
// tiene selectores de elemento, todo va prefijado (.pos-*, .floorplan-*), así
// que no puede pisar estilos del ERP.
import './pos.css'
import Icon from './Icon'
import { useToast } from '../hooks/useToast'
import {
  DEPTOS, TIPO_DOC, onlyDigits, validDUI, validNIT, validNRC,
  normalizeEmail, validEmail, faltantesParaCCF,
} from './cajero/clienteValidacion'

/**
 * ClientesView — Banco de clientes de facturación, dentro del POS.
 *
 * Antes el cliente SOLO se podía crear en medio del cobro (CustomerSearch), con
 * el cliente esperando en la caja: se tecleaba a la carrera y quedaban fichas a
 * medias que después tumbaban el DTE. Acá la cajera puede buscar, corregir y
 * dar de alta con calma, y ve de un vistazo a quién le falta algo para CCF.
 *
 * Las reglas de validación son las MISMAS del cobro (clienteValidacion.js).
 */

const VACIO = {
  nombre: '', tipo_persona: 'juridica', tipo_documento: 'NIT', numero_documento: '',
  nrc: '', giro: '', codigo_actividad: '', email: '', telefono: '',
  direccion: '', departamento: '06', municipio: '01', nombre_comercial: '', notas: '',
}

export default function ClientesView({ user, onBack }) {
  const toast = useToast()
  const [query, setQuery]     = useState('')
  const [lista, setLista]     = useState([])
  const [cargando, setCarg]   = useState(true)
  const [edit, setEdit]       = useState(null)   // ficha en edición (null = lista)
  const [guardando, setGuard] = useState(false)
  const [soloIncompletos, setSoloIncompletos] = useState(false)

  const cargar = useCallback(async () => {
    setCarg(true)
    try {
      const q = query.trim()
      let sel = db.from('pos_clientes').select('*')
      if (q.length >= 2) {
        const clean = q.replace(/[-\s]/g, '')
        sel = /^\d+$/.test(clean)
          ? sel.or(`numero_documento.ilike.%${clean}%,nrc.ilike.%${clean}%,telefono.ilike.%${clean}%`)
          : sel.or(`nombre.ilike.%${q}%,email.ilike.%${q}%,nombre_comercial.ilike.%${q}%`)
      }
      const { data, error } = await sel.order('nombre').limit(200)
      if (error) throw error
      setLista(data || [])
    } catch (e) {
      toast.error('No se pudo cargar: ' + e.message)
    } finally { setCarg(false) }
  }, [query])

  useEffect(() => { const t = setTimeout(cargar, 300); return () => clearTimeout(t) }, [cargar])

  const guardar = async () => {
    const f = edit
    if (!f.nombre.trim()) { toast.warning('El nombre / razón social es obligatorio'); return }
    // El correo es lo único que SIEMPRE se valida: es lo que tumba el DTE entero.
    if (f.email && !validEmail(f.email)) { toast.warning('Correo inválido (sin tildes ni espacios)'); return }
    if (f.numero_documento) {
      const num = onlyDigits(f.numero_documento)
      if (f.tipo_documento === 'DUI' && !validDUI(num)) { toast.warning('DUI inválido: 9 dígitos'); return }
      if (f.tipo_documento === 'NIT' && !validNIT(num)) { toast.warning('NIT inválido: 14 dígitos (o 9)'); return }
    }
    if (f.nrc && !validNRC(f.nrc)) { toast.warning('NRC inválido: 1 a 8 dígitos'); return }

    const row = {
      nombre: f.nombre.trim(),
      nombre_comercial: f.nombre_comercial?.trim() || null,
      tipo_persona: f.tipo_persona || 'juridica',
      tipo_documento: f.numero_documento ? f.tipo_documento : null,
      numero_documento: f.numero_documento ? onlyDigits(f.numero_documento) : null,
      nrc: f.nrc ? onlyDigits(f.nrc) : null,
      giro: f.giro?.trim() || null,
      codigo_actividad: f.codigo_actividad?.trim() || null,
      email: f.email ? normalizeEmail(f.email) : null,   // se guarda normalizado
      telefono: f.telefono?.trim() || null,
      direccion: f.direccion?.trim() || null,
      departamento: f.departamento || null,
      municipio: f.municipio || null,
      notas: f.notas?.trim() || null,
      updated_at: new Date().toISOString(),
    }

    setGuard(true)
    try {
      if (f.id) {
        const { error } = await db.from('pos_clientes').update(row).eq('id', f.id)
        if (error) throw error
        toast.success('Cliente actualizado')
      } else {
        // Anti-duplicado: mismo criterio que el alta desde el cobro
        const ors = []
        if (row.numero_documento) ors.push(`numero_documento.eq.${row.numero_documento}`)
        if (row.nrc)              ors.push(`nrc.eq.${row.nrc}`)
        if (ors.length) {
          const { data: dup } = await db.from('pos_clientes').select('id,nombre').or(ors.join(',')).limit(1).maybeSingle()
          if (dup) { toast.warning(`Ya existe: ${dup.nombre}`); setGuard(false); return }
        }
        const { error } = await db.from('pos_clientes').insert({ ...row, tipo_cliente: 'regular' })
        if (error) throw error
        toast.success('Cliente creado')
      }
      setEdit(null)
      cargar()
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message)
    } finally { setGuard(false) }
  }

  const set = (k, v) => setEdit(f => ({ ...f, [k]: v }))

  // ── FICHA (alta / edición) ──
  if (edit) {
    const falta = faltantesParaCCF(edit)
    const inp = { width: '100%', padding: '11px 12px', background: '#0d0d12', border: '1px solid #2a2a32',
                  borderRadius: 9, color: '#e5e7eb', fontSize: 14 }
    const lbl = { fontSize: 11, color: '#8b8997', margin: '10px 0 4px', fontWeight: 600 }
    return (
      <div className="poshome-root">
        <toast.Toast />
        <header className="pos-header">
          <button className="pos-header-btn" onClick={() => setEdit(null)}>← Volver</button>
          <span className="pos-header-brand">{edit.id ? 'Editar cliente' : 'Nuevo cliente'}</span>
          <span className="pos-header-sep" />
        </header>

        {/* El scroll va acá y no en `.poshome-root`, que es height:100vh +
            overflow:hidden — sin este contenedor la ficha se corta abajo y el
            botón de guardar queda inalcanzable en pantallas chicas. */}
        <div style={{ padding: '0 16px 100px', maxWidth: 620, flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* Qué le falta para poder emitirle CCF — se ve ANTES de que el cliente esté esperando */}
          <div style={{ padding: '9px 12px', borderRadius: 9, marginBottom: 6,
                        background: falta.length ? 'rgba(244,162,97,0.12)' : 'rgba(45,212,168,0.12)',
                        border: `1px solid ${falta.length ? '#f4a26155' : '#2dd4a855'}`,
                        fontSize: 12, color: falta.length ? '#f4a261' : '#2dd4a8' }}>
            {falta.length
              ? <>Para <b>CCF</b> le falta: {falta.join(', ')}. Para factura normal basta el nombre y el correo.</>
              : <>✓ Listo para <b>CCF</b> y factura.</>}
          </div>

          <div style={lbl}>Nombre / razón social *</div>
          <input style={inp} value={edit.nombre} onChange={e => set('nombre', e.target.value)} autoFocus />

          <div style={lbl}>Nombre comercial</div>
          <input style={inp} value={edit.nombre_comercial || ''} onChange={e => set('nombre_comercial', e.target.value)} />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Tipo de persona</div>
              <select style={inp} value={edit.tipo_persona} onChange={e => set('tipo_persona', e.target.value)}>
                <option value="juridica">Empresa</option>
                <option value="natural">Persona natural</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Documento</div>
              <select style={inp} value={edit.tipo_documento} onChange={e => set('tipo_documento', e.target.value)}>
                {TIPO_DOC.map(([, l]) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>N° de documento</div>
              <input style={inp} inputMode="numeric" value={edit.numero_documento || ''}
                onChange={e => set('numero_documento', e.target.value)} placeholder="NIT 14 díg · DUI 9 díg" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>NRC (solo contribuyentes)</div>
              <input style={inp} inputMode="numeric" value={edit.nrc || ''}
                onChange={e => set('nrc', e.target.value)} placeholder="1 a 8 dígitos" />
            </div>
          </div>

          <div style={lbl}>Correo * (se le manda el DTE)</div>
          <input style={{ ...inp, borderColor: edit.email && !validEmail(edit.email) ? '#e63946' : '#2a2a32' }}
            value={edit.email || ''} onChange={e => set('email', e.target.value)}
            placeholder="facturacion@empresa.com" />
          {edit.email && !validEmail(edit.email) && (
            <div style={{ fontSize: 11, color: '#e63946', marginTop: 4 }}>
              Hacienda rechaza el DTE completo si el correo lleva tildes o espacios.
            </div>
          )}

          <div style={lbl}>Teléfono</div>
          <input style={inp} inputMode="tel" value={edit.telefono || ''} onChange={e => set('telefono', e.target.value)} />

          <div style={lbl}>Giro / actividad (CCF)</div>
          <input style={inp} value={edit.giro || ''} onChange={e => set('giro', e.target.value)}
            placeholder="Ej: Laboratorios farmacéuticos" />

          <div style={lbl}>Dirección (CCF)</div>
          <input style={inp} value={edit.direccion || ''} onChange={e => set('direccion', e.target.value)} />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Departamento</div>
              <select style={inp} value={edit.departamento || '06'} onChange={e => set('departamento', e.target.value)}>
                {DEPTOS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Municipio (código)</div>
              <input style={inp} value={edit.municipio || ''} onChange={e => set('municipio', e.target.value)} />
            </div>
          </div>

          <div style={lbl}>Notas</div>
          <input style={inp} value={edit.notas || ''} onChange={e => set('notas', e.target.value)} />

          <button className="pos-confirmar-btn" style={{ marginTop: 18 }} disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : edit.id ? 'Guardar cambios' : 'Crear cliente'}
          </button>
          <button className="pos-cancelar-btn" onClick={() => setEdit(null)}>Cancelar</button>
        </div>
      </div>
    )
  }

  // ── LISTA ──
  const visibles = soloIncompletos ? lista.filter(c => faltantesParaCCF(c).length > 0) : lista
  return (
    <div className="poshome-root">
      <toast.Toast />
      <header className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
        <span className="pos-header-brand">Clientes de factura</span>
        <span className="pos-header-sep" />
        <span className="pos-header-store">{lista.length} en el banco</span>
      </header>

      {/* `.poshome-root` es height:100vh + overflow:hidden, así que la lista
          tiene que scrollear en su propio contenedor. Sin `minHeight:0` un hijo
          flex no se encoge por debajo de su contenido y el overflow no aplica:
          con 95 clientes la lista se cortaba a la altura de la pantalla. */}
      <div style={{ padding: '0 16px 90px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por nombre, NIT, NRC, correo o teléfono…"
          style={{ width: '100%', padding: '13px 14px', background: '#0d0d12', border: '1px solid #2a2a32',
                   borderRadius: 10, color: '#e5e7eb', fontSize: 15, marginBottom: 10 }} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <button onClick={() => setSoloIncompletos(s => !s)}
            style={{ padding: '7px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                     border: '1px solid ' + (soloIncompletos ? '#f4a261' : '#2a2a32'),
                     background: soloIncompletos ? 'rgba(244,162,97,0.16)' : '#161620',
                     color: soloIncompletos ? '#f4a261' : '#8b8997' }}>
            Incompletos para CCF
          </button>
          <button onClick={() => setEdit({ ...VACIO })}
            style={{ marginLeft: 'auto', padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                     background: '#E62329', color: '#fff', fontSize: 14, fontWeight: 800 }}>
            + Nuevo cliente
          </button>
        </div>

        {cargando ? (
          <div style={{ color: '#8b8997', fontSize: 13, padding: 20, textAlign: 'center' }}>Cargando…</div>
        ) : visibles.length === 0 ? (
          <div style={{ color: '#8b8997', fontSize: 13, padding: 30, textAlign: 'center' }}>
            {query ? 'Sin resultados' : 'Todavía no hay clientes'}
          </div>
        ) : visibles.map(c => {
          const falta = faltantesParaCCF(c)
          return (
            <button key={c.id} onClick={() => setEdit({ ...VACIO, ...c })}
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 8, padding: '12px 14px',
                       background: '#141419', border: '1px solid #23232c', borderRadius: 10,
                       borderLeft: `3px solid ${falta.length ? '#f4a261' : '#2dd4a8'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb' }}>{c.nombre}</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: falta.length ? '#f4a261' : '#2dd4a8' }}>
                  {falta.length ? 'FACTURA' : 'CCF ✓'}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: '#8b8997', marginTop: 3, lineHeight: 1.5 }}>
                {c.numero_documento ? `${c.tipo_documento || 'Doc'}: ${c.numero_documento}` : 'sin documento'}
                {c.nrc ? ` · NRC ${c.nrc}` : ''}
                {c.email ? ` · ${c.email}` : ''}
              </div>
              {falta.length > 0 && (
                <div style={{ fontSize: 10.5, color: '#f4a261', marginTop: 3 }}>Falta para CCF: {falta.join(', ')}</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
