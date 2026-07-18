// src/pos/cajero/ProductoModifiersModal.jsx
// Modal que se abre al tocar un producto del menu POS.
// - Tab "Modificadores": grupos de modificadores como dropdowns COLAPSADOS.
//   Cada grupo se despliega al tocarlo. Respeta tipo (single/multiple) y min/max selecciones.
// - Tab "Producto seleccionado": cantidad (+/-) + nota al producto.
// Devuelve al POSMain: { qty, nota, modificadores, precioModificadores }

import { useEffect, useMemo, useState } from 'react'

export default function ProductoModifiersModal({
  producto,
  grupos: gruposRaw = [],
  onClose,
  onConfirm,
}) {
  // Defensive normalize: cada grupo debe tener opciones como array.
  const grupos = useMemo(() => {
    return (gruposRaw || []).map(g => ({
      ...g,
      opciones: Array.isArray(g?.opciones) ? g.opciones : [],
    })).filter(g => g.opciones.length > 0)
  }, [gruposRaw])

  const [tab, setTab]           = useState('modificadores')
  const [qty, setQty]           = useState(1)
  const [nota, setNota]         = useState('')
  const [selecciones, setSelecciones] = useState({})
  const [openGroupId, setOpenGroupId] = useState(null)

  useEffect(() => {
    const primerObligatorio = grupos.find(g => g.obligatorio && g.min_selecciones > 0)
    if (primerObligatorio) setOpenGroupId(primerObligatorio.id)
  }, [grupos])

  useEffect(() => {
    if (grupos.length === 0) setTab('producto')
  }, [grupos])

  const toggleOpcion = (grupo, opcionId) => {
    setSelecciones(prev => {
      const actual = prev[grupo.id] || []
      const yaSeleccionada = actual.includes(opcionId)
      let nueva
      if (grupo.tipo === 'single' || grupo.tipo === 'unico') {
        nueva = yaSeleccionada ? [] : [opcionId]
      } else {
        if (yaSeleccionada) {
          nueva = actual.filter(id => id !== opcionId)
        } else {
          if (grupo.max_selecciones && actual.length >= grupo.max_selecciones) return prev
          nueva = [...actual, opcionId]
        }
      }
      return { ...prev, [grupo.id]: nueva }
    })
  }

  const precioModificadoresUnit = useMemo(() => {
    let sum = 0
    for (const g of grupos) {
      const ids = selecciones[g.id] || []
      for (const oId of ids) {
        const opt = g.opciones.find(o => o.id === oId)
        if (opt) sum += parseFloat(opt.precio_extra) || 0
      }
    }
    return sum
  }, [selecciones, grupos])

  const precioProductoUnit = parseFloat(producto.precio) || 0
  const subtotalUnit = precioProductoUnit + precioModificadoresUnit
  const subtotalTotal = subtotalUnit * qty

  const validacion = useMemo(() => {
    const errores = []
    for (const g of grupos) {
      const nSel = (selecciones[g.id] || []).length
      const min = g.min_selecciones || 0
      if (g.obligatorio && nSel < Math.max(1, min)) {
        errores.push('Faltan opciones en "' + g.nombre + '" (min. ' + Math.max(1, min) + ')')
      }
    }
    return errores
  }, [selecciones, grupos])

  const puedeAgregar = validacion.length === 0 && qty > 0

  const handleConfirm = () => {
    if (!puedeAgregar) {
      if (validacion.length > 0) {
        alert(validacion.join('\n'))
        setTab('modificadores')
      }
      return
    }
    const modificadoresPlanos = []
    for (const g of grupos) {
      const ids = selecciones[g.id] || []
      for (const oId of ids) {
        const opt = g.opciones.find(o => o.id === oId)
        if (opt) {
          modificadoresPlanos.push({
            grupo_id: g.id,
            grupo_nombre: g.nombre,
            opcion_id: opt.id,
            nombre: opt.nombre,
            precio_extra: parseFloat(opt.precio_extra) || 0,
          })
        }
      }
    }
    onConfirm({
      qty,
      nota: nota.trim(),
      modificadores: modificadoresPlanos,
      precioModificadores: precioModificadoresUnit,
    })
  }

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div
        className="pos-modal pos-modifiers-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 560, width: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#1a1a22', color: '#e5e7eb' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #2a2a32' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#fff' }}>{producto.nombre}</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#8b8997' }}
            aria-label="Cerrar"
          >X</button>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 18px 0' }}>
          {grupos.length > 0 && (
            <button
              onClick={() => setTab('modificadores')}
              style={{
                padding: '8px 20px',
                borderRadius: 24,
                border: '1px solid ' + (tab === 'modificadores' ? '#3b82f6' : '#2a2a32'),
                fontWeight: 600,
                cursor: 'pointer',
                background: tab === 'modificadores' ? '#2563eb' : '#22222c',
                color: tab === 'modificadores' ? '#fff' : '#b8b8c4',
              }}
            >Modificadores</button>
          )}
          <button
            onClick={() => setTab('producto')}
            style={{
              padding: '8px 20px',
              borderRadius: 24,
              border: '1px solid ' + (tab === 'producto' ? '#3b82f6' : '#2a2a32'),
              fontWeight: 600,
              cursor: 'pointer',
              background: tab === 'producto' ? '#2563eb' : '#22222c',
              color: tab === 'producto' ? '#fff' : '#b8b8c4',
            }}
          >Producto seleccionado</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {tab === 'modificadores' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {grupos.length === 0 && (
                <div style={{ color: '#8b8997', fontSize: 14, textAlign: 'center', padding: 20 }}>
                  Este producto no tiene modificadores.
                </div>
              )}
              {grupos.map(grupo => {
                const seleccionadas = selecciones[grupo.id] || []
                const abierto = openGroupId === grupo.id
                const labelResumen = seleccionadas.length === 0
                  ? 'Seleccionar opcion'
                  : seleccionadas
                      .map(id => {
                        const opt = grupo.opciones.find(o => o.id === id)
                        if (!opt) return null
                        const pe = parseFloat(opt.precio_extra) || 0
                        return pe > 0 ? opt.nombre + ' (+$' + pe.toFixed(2) + ')' : opt.nombre
                      })
                      .filter(Boolean)
                      .join(', ')

                return (
                  <div key={grupo.id} style={{ border: '1px solid #2a2a32', borderRadius: 8, background: '#22222c', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 12px', fontWeight: 800, fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px', background: '#1e1e26', borderBottom: '1px solid #2a2a32' }}>
                      {grupo.nombre}
                      {grupo.obligatorio && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
                      {(grupo.tipo === 'multiple' || !grupo.tipo) && grupo.max_selecciones ? (
                        <span style={{ fontWeight: 500, fontSize: 10, color: '#8b8997', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                          (max {grupo.max_selecciones})
                        </span>
                      ) : null}
                    </div>

                    <button
                      onClick={() => setOpenGroupId(abierto ? null : grupo.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '11px 12px',
                        background: '#22222c',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 14,
                        textAlign: 'left',
                        color: seleccionadas.length === 0 ? '#6b6878' : '#e5e7eb',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                        {labelResumen}
                      </span>
                      <span style={{ color: '#8b8997', fontSize: 12 }}>{abierto ? '^' : 'v'}</span>
                    </button>

                    {abierto && (
                      <div style={{ borderTop: '1px solid #2a2a32', maxHeight: 260, overflowY: 'auto', background: '#1a1a22' }}>
                        {grupo.opciones.map(opt => {
                          const selected = seleccionadas.includes(opt.id)
                          const pe = parseFloat(opt.precio_extra) || 0
                          return (
                            <label
                              key={opt.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '10px 12px',
                                cursor: 'pointer',
                                background: selected ? '#1e3a5f' : 'transparent',
                                borderBottom: '1px solid #22222c',
                                color: '#e5e7eb',
                              }}
                            >
                              <input
                                type={(grupo.tipo === 'single' || grupo.tipo === 'unico') ? 'radio' : 'checkbox'}
                                checked={selected}
                                onChange={() => toggleOpcion(grupo, opt.id)}
                                style={{ cursor: 'pointer', accentColor: '#3b82f6' }}
                              />
                              <span style={{ flex: 1, fontSize: 14 }}>{opt.nombre}</span>
                              {pe > 0 && (
                                <span style={{
                                  fontSize: 12,
                                  color: '#10b981',
                                  fontWeight: 800,
                                  background: 'rgba(16, 185, 129, 0.18)',
                                  padding: '2px 8px',
                                  borderRadius: 12,
                                }}>
                                  +${pe.toFixed(2)}
                                </span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'producto' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: '#22222c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>#</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: '#fff' }}>{producto.nombre}</div>
              </div>

              <div>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Modificar cantidad</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #2a2a32', borderRadius: 12, padding: 4, background: '#22222c' }}>
                  <button
                    onClick={() => setQty(q => Math.max(1, q - 1))}
                    style={{ background: '#1a1a22', border: '1px solid #2a2a32', width: 60, height: 42, borderRadius: 8, fontSize: 22, cursor: 'pointer', color: '#e5e7eb' }}
                  >-</button>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{qty}</div>
                  <button
                    onClick={() => setQty(q => q + 1)}
                    style={{ background: '#1a1a22', border: '1px solid #2a2a32', width: 60, height: 42, borderRadius: 8, fontSize: 22, cursor: 'pointer', color: '#e5e7eb' }}
                  >+</button>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Agregar nota al producto</div>
                <textarea
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                  placeholder="Escribir nota..."
                  rows={4}
                  style={{ width: '100%', border: '1px solid #2a2a32', borderRadius: 8, padding: 12, fontSize: 14, resize: 'vertical', fontFamily: 'inherit', background: '#22222c', color: '#e5e7eb' }}
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a32', background: '#1e1e26' }}>
          {precioModificadoresUnit > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8b8997', marginBottom: 6 }}>
              <span>Producto ${precioProductoUnit.toFixed(2)} + mods ${precioModificadoresUnit.toFixed(2)} x {qty}</span>
              <span style={{ fontWeight: 700, color: '#10b981' }}>${subtotalTotal.toFixed(2)}</span>
            </div>
          )}
          <button
            onClick={handleConfirm}
            disabled={!puedeAgregar}
            style={{
              width: '100%',
              padding: '14px 20px',
              background: puedeAgregar ? '#2563eb' : '#3a3a44',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 700,
              cursor: puedeAgregar ? 'pointer' : 'not-allowed',
            }}
          >Agregar a la orden - ${subtotalTotal.toFixed(2)}</button>
          {validacion.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#f87171', textAlign: 'center' }}>
              {validacion[0]}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
