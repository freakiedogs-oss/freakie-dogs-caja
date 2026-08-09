// src/pos/cajero/ProductoModifiersModal.jsx
// Modal que se abre al tocar un producto del menu POS (o al editarlo desde el resumen).
// UNA sola pantalla (sin tabs ni desplegables):
//   - Cada grupo de modificadores se muestra como grid de botones (✓ incluido / + con precio).
//   - Cantidad (−/+), notas del producto y subtotal, todo visible.
// Respeta tipo (single/multiple) y min/max selecciones.
// Props:
//   producto, grupos, onClose, onConfirm({ qty, nota, modificadores, precioModificadores })
//   initial? { qty, nota, selecciones }  → precarga para EDITAR un ítem existente
//   editMode? bool  → cambia el label del botón a "Guardar cambios"

import { useMemo, useState } from 'react'

export default function ProductoModifiersModal({
  producto,
  grupos: gruposRaw = [],
  onClose,
  onConfirm,
  initial = null,
  editMode = false,
}) {
  // Defensive normalize: cada grupo debe tener opciones como array.
  const grupos = useMemo(() => {
    return (gruposRaw || []).map(g => ({
      ...g,
      opciones: Array.isArray(g?.opciones) ? g.opciones : [],
    })).filter(g => g.opciones.length > 0)
  }, [gruposRaw])

  const [qty, setQty]                 = useState(initial?.qty || 1)
  const [nota, setNota]               = useState(initial?.nota || '')
  const [selecciones, setSelecciones] = useState(initial?.selecciones || {})
  const [atencionEspecial, setAtencionEspecial] = useState(initial?.atencionEspecial || false)

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
      if (validacion.length > 0) alert(validacion.join('\n'))
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
      atencionEspecial,
    })
  }

  const btnLabel = editMode ? 'Guardar cambios' : (qty > 1 ? `Agregar ${qty} a la orden` : 'Agregar a la orden')

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div
        className="pos-modal pos-modifiers-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 620, width: '96%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: '#1a1a22', color: '#e5e7eb' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #2a2a32' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#fff' }}>
            {editMode && <span style={{ fontSize: 13, color: '#fbbf24', marginRight: 6 }}>✎ Editar</span>}
            {producto.nombre}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#8b8997' }} aria-label="Cerrar">×</button>
        </div>

        {/* Cuerpo: grupos en grid + cantidad + nota */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {grupos.length === 0 && (
            <div style={{ color: '#8b8997', fontSize: 14, textAlign: 'center', padding: '8px 0' }}>
              Este producto no tiene modificadores.
            </div>
          )}

          {grupos.map(grupo => {
            const seleccionadas = selecciones[grupo.id] || []
            const esUnico = grupo.tipo === 'single' || grupo.tipo === 'unico'
            const topeMax = grupo.max_selecciones && !esUnico ? grupo.max_selecciones : null
            const enTope = topeMax ? seleccionadas.length >= topeMax : false
            return (
              <div key={grupo.id}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {grupo.nombre}{grupo.obligatorio && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
                  </span>
                  {topeMax && <span style={{ fontSize: 10, color: '#8b8997' }}>(máx {topeMax})</span>}
                  {esUnico && <span style={{ fontSize: 10, color: '#8b8997' }}>(elegí 1)</span>}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
                  {grupo.opciones.map(opt => {
                    const selected = seleccionadas.includes(opt.id)
                    const pe = parseFloat(opt.precio_extra) || 0
                    const bloqueada = !selected && enTope
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOpcion(grupo, opt.id)}
                        disabled={bloqueada}
                        style={{
                          position: 'relative',
                          minHeight: 54,
                          padding: '8px 8px 8px 8px',
                          borderRadius: 10,
                          border: '1.5px solid ' + (selected ? '#3b82f6' : '#2a2a32'),
                          background: selected ? 'rgba(59,130,246,0.16)' : '#22222c',
                          color: bloqueada ? '#5a5a66' : '#e5e7eb',
                          cursor: bloqueada ? 'not-allowed' : 'pointer',
                          fontSize: 12.5,
                          fontWeight: 600,
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 3,
                          lineHeight: 1.2,
                          opacity: bloqueada ? 0.5 : 1,
                          transition: 'border-color .1s, background .1s',
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 4, right: 5, fontSize: 11, fontWeight: 800,
                          color: selected ? '#3b82f6' : '#6b6878',
                        }}>{selected ? '✓' : '+'}</span>
                        <span style={{ padding: '0 4px' }}>{opt.nombre}</span>
                        {pe > 0 && (
                          <span style={{ fontSize: 11, color: '#10b981', fontWeight: 800 }}>+${pe.toFixed(2)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Cantidad + Notas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12, marginTop: 4 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 11, marginBottom: 6, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Cantidad</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #2a2a32', borderRadius: 12, padding: 4, background: '#22222c' }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))}
                  style={{ background: '#1a1a22', border: '1px solid #2a2a32', width: 48, height: 42, borderRadius: 8, fontSize: 22, cursor: 'pointer', color: '#e5e7eb' }}>−</button>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{qty}</div>
                <button onClick={() => setQty(q => q + 1)}
                  style={{ background: '#1a1a22', border: '1px solid #2a2a32', width: 48, height: 42, borderRadius: 8, fontSize: 22, cursor: 'pointer', color: '#e5e7eb' }}>+</button>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 11, marginBottom: 6, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Notas del pedido <span style={{ color: '#8b8997', fontWeight: 500, textTransform: 'none' }}>(opcional)</span></div>
              <textarea
                value={nota}
                onChange={e => setNota(e.target.value.slice(0, 120))}
                placeholder="Ej: sin cebolla, poco picante..."
                rows={2}
                style={{ width: '100%', border: '1px solid #2a2a32', borderRadius: 8, padding: 10, fontSize: 13, resize: 'none', fontFamily: 'inherit', background: '#22222c', color: '#e5e7eb', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Atención especial → la comanda llega ROJA a cocina. Manual, para cosas delicadas
              (quitar ingrediente incluido, cambio de queso, alergias, indicación importante). */}
          <button
            onClick={() => setAtencionEspecial(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '11px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              border: '1.5px solid ' + (atencionEspecial ? '#ef4444' : '#2a2a32'),
              background: atencionEspecial ? 'rgba(239,68,68,0.14)' : '#22222c',
              color: atencionEspecial ? '#fca5a5' : '#b8b8c4', fontWeight: 700, fontSize: 13.5,
            }}
          >
            <span style={{ fontSize: 16 }}>{atencionEspecial ? '🔴' : '⚪'}</span>
            <span style={{ flex: 1 }}>Marcar como atención especial
              <span style={{ display: 'block', fontWeight: 400, fontSize: 11, color: '#8b8997', marginTop: 1 }}>
                Llega ROJA a cocina (alergia, cambio de queso, quitar ingrediente…)
              </span>
            </span>
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a32', background: '#1e1e26' }}>
          {precioModificadoresUnit > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8b8997', marginBottom: 6 }}>
              <span>${precioProductoUnit.toFixed(2)} + extras ${precioModificadoresUnit.toFixed(2)} × {qty}</span>
              <span style={{ fontWeight: 700, color: '#10b981' }}>${subtotalTotal.toFixed(2)}</span>
            </div>
          )}
          <button
            onClick={handleConfirm}
            disabled={!puedeAgregar}
            style={{
              width: '100%', padding: '14px 20px',
              background: puedeAgregar ? '#2563eb' : '#3a3a44',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700,
              cursor: puedeAgregar ? 'pointer' : 'not-allowed',
            }}
          >{btnLabel} — ${subtotalTotal.toFixed(2)}</button>
          {validacion.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#f87171', textAlign: 'center' }}>{validacion[0]}</div>
          )}
        </div>
      </div>
    </div>
  )
}
