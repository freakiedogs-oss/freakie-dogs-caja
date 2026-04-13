import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'

/**
 * CustomerSearch — Búsqueda y creación rápida de clientes para CCF
 *
 * Se muestra inline dentro del PaymentModal cuando el usuario selecciona CCF.
 * Busca en pos_clientes por NIT, NRC o nombre.
 * Permite crear cliente nuevo con campos mínimos para CCF.
 */
export default function CustomerSearch({ onSelect, selected }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [showNew, setShowNew]   = useState(false)

  // Campos nuevo cliente
  const [form, setForm] = useState({
    nombre: '',
    nit: '',
    nrc: '',
    giro: 'Restaurantes',
    codActividad: '56101',
    email: '',
    telefono: '',
    direccion: '',
    departamento: '06',
    municipio: '01',
    tipo_documento: 'NIT',
  })

  // ── Búsqueda ──
  const search = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      // Buscar por NIT, NRC o nombre (ilike)
      const cleanQ = q.replace(/[-\s]/g, '')
      const isNumeric = /^\d+$/.test(cleanQ)

      let query_
      if (isNumeric) {
        // Buscar en numero_documento o nrc
        query_ = db.from('pos_clientes')
          .select('*')
          .or(`numero_documento.ilike.%${cleanQ}%,nrc.ilike.%${cleanQ}%`)
          .limit(10)
      } else {
        query_ = db.from('pos_clientes')
          .select('*')
          .ilike('nombre', `%${q}%`)
          .limit(10)
      }

      const { data } = await query_
      setResults(data || [])
    } catch (err) {
      console.error('Error buscando clientes:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300)
    return () => clearTimeout(timer)
  }, [query, search])

  // ── Crear cliente ──
  const handleCreate = async () => {
    if (!form.nombre || !form.nit || !form.nrc) {
      alert('Nombre, NIT y NRC son obligatorios para CCF')
      return
    }

    try {
      const { data, error } = await db.from('pos_clientes').insert({
        nombre:           form.nombre,
        tipo_documento:   'NIT',
        numero_documento: form.nit.replace(/[-\s]/g, ''),
        nrc:              form.nrc.replace(/[-\s]/g, ''),
        giro:             form.giro,
        email:            form.email || null,
        telefono:         form.telefono || null,
        direccion:        form.direccion || null,
        departamento:     form.departamento || '06',
        municipio:        form.municipio || '01',
        tipo_cliente:     'ccf',
      }).select().single()

      if (error) throw error
      onSelect(data)
      setShowNew(false)
    } catch (err) {
      alert('Error al crear cliente: ' + err.message)
    }
  }

  // ── Cliente seleccionado ──
  if (selected) {
    return (
      <div style={{
        background: '#0d1a18', border: '1px solid #1a3a32', borderRadius: 8,
        padding: '8px 12px', marginBottom: 12
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#2dd4a8', fontWeight: 700, fontSize: 13 }}>
              🏢 {selected.nombre}
            </div>
            <div style={{ color: '#8b8997', fontSize: 11, marginTop: 2 }}>
              NIT: {selected.numero_documento} · NRC: {selected.nrc}
              {selected.giro && ` · ${selected.giro}`}
            </div>
          </div>
          <button
            onClick={() => onSelect(null)}
            style={{
              background: 'none', border: 'none', color: '#f87171',
              cursor: 'pointer', fontSize: 14, padding: '4px 8px'
            }}
          >✕</button>
        </div>
      </div>
    )
  }

  // ── Formulario nuevo cliente ──
  if (showNew) {
    const fieldStyle = {
      background: '#1e1e26', border: '1px solid #2a2a32', borderRadius: 6,
      color: '#e8e6ef', padding: '6px 10px', fontSize: 12, width: '100%',
      marginBottom: 6, outline: 'none',
    }
    const labelStyle = { color: '#8b8997', fontSize: 11, marginBottom: 2, display: 'block' }

    return (
      <div style={{
        background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8,
        padding: 12, marginBottom: 12
      }}>
        <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
          ➕ Nuevo cliente CCF
        </div>

        <label style={labelStyle}>Razón social *</label>
        <input style={fieldStyle} placeholder="EMPRESA S.A. DE C.V."
          value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
          autoFocus />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <label style={labelStyle}>NIT * (sin guiones)</label>
            <input style={fieldStyle} placeholder="06142211000115"
              value={form.nit} onChange={e => setForm(f => ({ ...f, nit: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>NRC *</label>
            <input style={fieldStyle} placeholder="123456-7"
              value={form.nrc} onChange={e => setForm(f => ({ ...f, nrc: e.target.value }))} />
          </div>
        </div>

        <label style={labelStyle}>Giro / Actividad</label>
        <input style={fieldStyle} placeholder="Restaurantes"
          value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={fieldStyle} placeholder="contabilidad@empresa.com" type="email"
              value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Teléfono</label>
            <input style={fieldStyle} placeholder="22345678"
              value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
          </div>
        </div>

        <label style={labelStyle}>Dirección</label>
        <input style={fieldStyle} placeholder="Col. Escalón, Calle Principal #123"
          value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} />

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            onClick={handleCreate}
            style={{
              flex: 1, padding: '8px', background: '#166534', border: 'none',
              borderRadius: 6, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12
            }}
          >✅ Crear y seleccionar</button>
          <button
            onClick={() => setShowNew(false)}
            style={{
              padding: '8px 12px', background: '#1e1e26', border: '1px solid #2a2a32',
              borderRadius: 6, color: '#8b8997', cursor: 'pointer', fontSize: 12
            }}
          >Cancelar</button>
        </div>
      </div>
    )
  }

  // ── Buscador ──
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ color: '#8b8997', fontSize: 11, display: 'block', marginBottom: 4 }}>
        🏢 Cliente para CCF (buscar por NIT, NRC o nombre)
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={{
            flex: 1, background: '#1e1e26', border: '1px solid #2a2a32', borderRadius: 6,
            color: '#e8e6ef', padding: '8px 12px', fontSize: 13, outline: 'none',
          }}
          placeholder="Buscar: 0614... o EMPRESA..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        <button
          onClick={() => setShowNew(true)}
          style={{
            padding: '8px 12px', background: '#1e1e26', border: '1px solid #2a2a32',
            borderRadius: 6, color: '#fbbf24', cursor: 'pointer', fontSize: 13, fontWeight: 700,
            whiteSpace: 'nowrap'
          }}
        >+ Nuevo</button>
      </div>

      {loading && <div style={{ color: '#8b8997', fontSize: 11, marginTop: 4 }}>Buscando...</div>}

      {results.length > 0 && (
        <div style={{
          background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 6,
          marginTop: 4, maxHeight: 140, overflowY: 'auto'
        }}>
          {results.map(c => (
            <button
              key={c.id}
              onClick={() => { onSelect(c); setQuery(''); setResults([]) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                background: 'none', border: 'none', borderBottom: '1px solid #2a2a32',
                cursor: 'pointer', color: '#e8e6ef',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 12 }}>{c.nombre}</div>
              <div style={{ fontSize: 10, color: '#8b8997' }}>
                NIT: {c.numero_documento || '—'} · NRC: {c.nrc || '—'}
                {c.giro && ` · ${c.giro}`}
              </div>
            </button>
          ))}
        </div>
      )}

      {query.length >= 2 && !loading && results.length === 0 && (
        <div style={{ color: '#8b8997', fontSize: 11, marginTop: 4 }}>
          Sin resultados.{' '}
          <span
            style={{ color: '#fbbf24', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => { setShowNew(true); setForm(f => ({ ...f, nombre: query })) }}
          >
            Crear nuevo cliente
          </span>
        </div>
      )}
    </div>
  )
}
