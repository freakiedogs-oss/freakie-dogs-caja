import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import Icon from '../Icon'
import { useToast } from '../../hooks/useToast'

/**
 * CustomerSearch — Búsqueda y alta de clientes para Factura / CCF / Sujeto Excluido.
 * Se adapta al documento elegido (prop `tipoDte`) y al tipo de persona.
 *
 * Validación de formato (datos que viajan a Hacienda):
 *   DUI = 9 díg · NIT = 14 díg (o 9 si es DUI) · NRC = 1–8 díg.
 * Anti-duplicado: por numero_documento y por nrc → "Cliente ya creado" (reutiliza).
 */

// Departamentos El Salvador (código MH)
const DEPTOS = [
  ['06', 'San Salvador'], ['05', 'La Libertad'], ['02', 'Santa Ana'], ['10', 'Sonsonate'],
  ['03', 'Ahuachapán'], ['04', 'Chalatenango'], ['07', 'La Paz'], ['08', 'Cabañas'],
  ['09', 'San Vicente'], ['11', 'Usulután'], ['12', 'San Miguel'], ['13', 'Morazán'],
  ['14', 'La Unión'], ['01', 'Ahuachapán Norte'],
]
const TIPO_DOC = [
  ['13', 'DUI'], ['36', 'NIT'], ['03', 'Pasaporte'], ['02', 'Carnet de residente'], ['37', 'Otro'],
]

const onlyDigits = s => (s || '').replace(/\D/g, '')
const validDUI = s => /^\d{9}$/.test(onlyDigits(s))
const validNIT = s => { const d = onlyDigits(s); return d.length === 14 || d.length === 9 }
const validNRC = s => /^\d{1,8}$/.test(onlyDigits(s))

export default function CustomerSearch({ onSelect, selected, tipoDte = 'ccf' }) {
  const toast = useToast()
  const esCCF = tipoDte === 'ccf'
  const esSE  = tipoDte === 'se'

  const [query, setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [persona, setPersona] = useState('empresa')   // 'natural' | 'empresa'
  const [saving, setSaving]   = useState(false)

  const [form, setForm] = useState({
    nombre: '', docTipoMH: '36', docNum: '', nit: '', nrc: '',
    giro: '', codActividad: '', email: '', telefono: '',
    direccion: '', departamento: '06', municipio: '01',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Para CCF un contribuyente persona-natural igual usa NIT+NRC; empresa idem
  useEffect(() => { if (esCCF) setPersona('empresa'); if (esSE) setPersona('natural') }, [tipoDte])

  // ── Búsqueda ──
  const search = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const clean = q.replace(/[-\s]/g, '')
      const isNum = /^\d+$/.test(clean)
      const q_ = isNum
        ? db.from('pos_clientes').select('*').or(`numero_documento.ilike.%${clean}%,nrc.ilike.%${clean}%`).limit(10)
        : db.from('pos_clientes').select('*').ilike('nombre', `%${q}%`).limit(10)
      const { data } = await q_
      setResults(data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { const t = setTimeout(() => search(query), 300); return () => clearTimeout(t) }, [query, search])

  // ── Crear cliente con validación + anti-duplicado ──
  const handleCreate = async () => {
    if (!form.nombre.trim()) { toast.warning('El nombre / razón social es obligatorio'); return }

    let row = {
      nombre: form.nombre.trim(),
      email: form.email || null,
      telefono: form.telefono || null,
      tipo_persona: persona === 'natural' ? 'natural' : 'juridica',
      tipo_cliente: tipoDte,
    }

    if (esCCF) {
      if (!validNIT(form.nit)) { toast.warning('NIT inválido: debe tener 14 dígitos (o 9 si es DUI)'); return }
      if (!validNRC(form.nrc)) { toast.warning('NRC inválido: 1 a 8 dígitos'); return }
      if (!form.giro.trim())      { toast.warning('El giro / actividad es obligatorio para CCF'); return }
      if (!form.direccion.trim()) { toast.warning('La dirección es obligatoria para CCF'); return }
      if (!form.email.trim())     { toast.warning('El correo es obligatorio para CCF'); return }
      row = {
        ...row,
        tipo_documento: 'NIT',
        numero_documento: onlyDigits(form.nit),
        nrc: onlyDigits(form.nrc),
        giro: form.giro.trim(),
        codigo_actividad: form.codActividad || null,
        direccion: form.direccion.trim(),
        departamento: form.departamento, municipio: form.municipio,
      }
    } else {
      // Factura o Sujeto Excluido
      const tipoTxt = TIPO_DOC.find(t => t[0] === form.docTipoMH)?.[1] || 'DUI'
      const num = onlyDigits(form.docNum)
      if (esSE && !validDUI(form.docNum)) { toast.warning('Sujeto Excluido requiere DUI de 9 dígitos'); return }
      if (num) {
        if (form.docTipoMH === '13' && !validDUI(num)) { toast.warning('DUI inválido: 9 dígitos'); return }
        if (form.docTipoMH === '36' && !validNIT(num)) { toast.warning('NIT inválido: 14 dígitos (o 9)'); return }
      }
      row = {
        ...row,
        tipo_documento: tipoTxt,
        numero_documento: num || null,
        giro: form.giro.trim() || null,
      }
    }

    // Anti-duplicado (busca por documento o NRC)
    setSaving(true)
    try {
      const ors = []
      if (row.numero_documento) ors.push(`numero_documento.eq.${row.numero_documento}`)
      if (row.nrc)              ors.push(`nrc.eq.${row.nrc}`)
      if (ors.length) {
        const { data: dup } = await db.from('pos_clientes').select('*').or(ors.join(',')).limit(1).maybeSingle()
        if (dup) {
          toast.warning('Cliente ya creado — se reutiliza el existente')
          onSelect(dup); setShowNew(false); setSaving(false); return
        }
      }
      const { data, error } = await db.from('pos_clientes').insert(row).select().single()
      if (error) {
        // 23505 = unique_violation (carrera) → buscar y reutilizar
        if (error.code === '23505') {
          const { data: ex } = await db.from('pos_clientes').select('*')
            .or(ors.join(',') || 'id.eq.00000000-0000-0000-0000-000000000000').limit(1).maybeSingle()
          if (ex) { toast.warning('Cliente ya creado — se reutiliza'); onSelect(ex); setShowNew(false); return }
        }
        throw error
      }
      toast.success('Cliente creado')
      onSelect(data); setShowNew(false)
    } catch (err) {
      toast.error('Error al crear cliente: ' + (err.message || err.code))
    } finally { setSaving(false) }
  }

  const F = { background: '#1e1e26', border: '1px solid #2a2a32', borderRadius: 6, color: '#e8e6ef', padding: '7px 10px', fontSize: 12, width: '100%', marginBottom: 6, outline: 'none' }
  const L = { color: '#8b8997', fontSize: 11, marginBottom: 2, display: 'block' }

  // ── Cliente seleccionado ──
  if (selected) {
    return (
      <div style={{ background: '#0d1a18', border: '1px solid #1a3a32', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#2dd4a8', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name={selected.tipo_persona === 'natural' ? 'user' : 'store'} size={14} color="#2dd4a8" /> {selected.nombre}
            </div>
            <div style={{ color: '#8b8997', fontSize: 11, marginTop: 2 }}>
              {selected.tipo_documento || 'Doc'}: {selected.numero_documento || '—'}{selected.nrc ? ` · NRC: ${selected.nrc}` : ''}{selected.giro ? ` · ${selected.giro}` : ''}
            </div>
          </div>
          <button onClick={() => onSelect(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14, padding: '4px 8px' }}>✕</button>
        </div>
      </div>
    )
  }

  // ── Formulario nuevo cliente ──
  if (showNew) {
    return (
      <div style={{ background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ color: '#FFD900', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
          + Nuevo cliente · {esCCF ? 'CCF (contribuyente)' : esSE ? 'Sujeto Excluido' : 'Factura'}
        </div>

        {/* Persona natural / empresa (no para SE) */}
        {!esSE && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[['natural', 'Persona natural', 'user'], ['empresa', 'Empresa', 'store']].map(([k, lbl, ic]) => (
              <button key={k} onClick={() => setPersona(k)} style={{
                flex: 1, padding: '7px 4px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: persona === k ? '#2e1311' : '#1e1e26',
                border: `1px solid ${persona === k ? '#E62329' : '#2a2a32'}`,
                color: persona === k ? '#fff' : '#8b8997',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}><Icon name={ic} size={14} /> {lbl}</button>
            ))}
          </div>
        )}

        <label style={L}>{persona === 'empresa' ? 'Razón social *' : 'Nombre completo *'}</label>
        <input style={F} placeholder={persona === 'empresa' ? 'EMPRESA S.A. DE C.V.' : 'Juan Pérez'}
          value={form.nombre} onChange={e => set('nombre', e.target.value)} autoFocus />

        {esCCF ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div><label style={L}>NIT * (14 díg)</label><input style={F} placeholder="0614-000000-000-0" value={form.nit} onChange={e => set('nit', e.target.value)} /></div>
              <div><label style={L}>NRC * (1–8 díg)</label><input style={F} placeholder="123456-7" value={form.nrc} onChange={e => set('nrc', e.target.value)} /></div>
            </div>
            <label style={L}>Giro / actividad económica *</label>
            <input style={F} placeholder="Restaurantes, Comercio…" value={form.giro} onChange={e => set('giro', e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div><label style={L}>Departamento *</label>
                <select style={F} value={form.departamento} onChange={e => set('departamento', e.target.value)}>
                  {DEPTOS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select></div>
              <div><label style={L}>Cód. municipio</label><input style={F} placeholder="01" value={form.municipio} onChange={e => set('municipio', e.target.value)} /></div>
            </div>
            <label style={L}>Dirección *</label>
            <input style={F} placeholder="Col. Escalón, Calle X #123" value={form.direccion} onChange={e => set('direccion', e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div><label style={L}>Correo *</label><input style={F} type="email" placeholder="contabilidad@empresa.com" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              <div><label style={L}>Teléfono</label><input style={F} placeholder="2222-2222" value={form.telefono} onChange={e => set('telefono', e.target.value)} /></div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: esSE ? '1fr' : '1fr 1fr', gap: 6 }}>
              {!esSE && (
                <div><label style={L}>Tipo documento</label>
                  <select style={F} value={form.docTipoMH} onChange={e => set('docTipoMH', e.target.value)}>
                    {TIPO_DOC.filter(t => t[0] !== '37').map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </select></div>
              )}
              <div><label style={L}>{esSE ? 'DUI * (9 díg)' : `Número${' '}${form.docTipoMH === '13' ? '(9 díg)' : form.docTipoMH === '36' ? '(14 díg)' : ''}`}</label>
                <input style={F} placeholder={esSE || form.docTipoMH === '13' ? '00000000-0' : '0614-000000-000-0'}
                  value={form.docNum} onChange={e => set('docNum', e.target.value)} /></div>
            </div>
            <label style={L}>Correo (para enviar el DTE)</label>
            <input style={F} type="email" placeholder="cliente@correo.com" value={form.email} onChange={e => set('email', e.target.value)} />
            {!esSE && <div style={{ fontSize: 11, color: '#8b8997', marginBottom: 4 }}>La factura puede emitirse sin estos datos; complétalos solo si el cliente los pide.</div>}
          </>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button onClick={handleCreate} disabled={saving} style={{ flex: 1, padding: '8px', background: '#E62329', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            {saving ? 'Guardando…' : 'Crear y seleccionar'}
          </button>
          <button onClick={() => setShowNew(false)} style={{ padding: '8px 12px', background: '#1e1e26', border: '1px solid #2a2a32', borderRadius: 6, color: '#8b8997', cursor: 'pointer', fontSize: 12 }}>Cancelar</button>
        </div>
        <toast.Toast />
      </div>
    )
  }

  // ── Buscador ──
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ color: '#8b8997', fontSize: 11, display: 'block', marginBottom: 4 }}>
        {esCCF ? 'Cliente CCF — buscar por NIT, NRC o nombre' : 'Cliente — buscar o crear' + (esSE ? '' : ' (opcional)')}
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={{ flex: 1, background: '#1e1e26', border: '1px solid #2a2a32', borderRadius: 6, color: '#e8e6ef', padding: '8px 12px', fontSize: 13, outline: 'none' }}
          placeholder="Buscar: 0614… o EMPRESA…" value={query} onChange={e => setQuery(e.target.value)} autoFocus />
        <button onClick={() => { setShowNew(true); set('nombre', query) }}
          style={{ padding: '8px 12px', background: '#1e1e26', border: '1px solid #2a2a32', borderRadius: 6, color: '#FFD900', cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>+ Nuevo</button>
      </div>

      {loading && <div style={{ color: '#8b8997', fontSize: 11, marginTop: 4 }}>Buscando…</div>}

      {results.length > 0 && (
        <div style={{ background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 6, marginTop: 4, maxHeight: 140, overflowY: 'auto' }}>
          {results.map(c => (
            <button key={c.id} onClick={() => { onSelect(c); setQuery(''); setResults([]) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', borderBottom: '1px solid #2a2a32', cursor: 'pointer', color: '#e8e6ef' }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{c.nombre}</div>
              <div style={{ fontSize: 10, color: '#8b8997' }}>
                {c.tipo_documento || 'Doc'}: {c.numero_documento || '—'}{c.nrc ? ` · NRC: ${c.nrc}` : ''}{c.giro ? ` · ${c.giro}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}

      {query.length >= 2 && !loading && results.length === 0 && (
        <div style={{ color: '#8b8997', fontSize: 11, marginTop: 4 }}>
          Sin resultados.{' '}
          <span style={{ color: '#FFD900', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => { setShowNew(true); set('nombre', query) }}>Crear nuevo cliente</span>
        </div>
      )}
      <toast.Toast />
    </div>
  )
}
