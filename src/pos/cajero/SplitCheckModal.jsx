import { useState, useEffect } from 'react'
import { db } from '../../supabase'
import { useToast } from '../../hooks/useToast'

// Dividir cuenta: mueve ítems YA comandados (con dbId = fila en pos_cuenta_items) a una cuenta nueva.
// Los ítems del carrito usan { id: menu_item_id, dbId: id de fila, qty, precio, precioExtra, ... }.
export default function SplitCheckModal({ cuentaId, items, storeCode, userId, mesaRef, onClose, onSplit }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [selectedItems, setSelectedItems] = useState({}) // { dbId: { selected, qtyToMove } }
  const [accountData, setAccountData] = useState(null)

  // Cargar la cuenta original (tipo, menu_id, demografía, etc.)
  useEffect(() => {
    const load = async () => {
      const { data } = await db
        .from('pos_cuentas')
        .select('*')
        .eq('id', cuentaId)
        .single()
      setAccountData(data)
    }
    load()
  }, [cuentaId])

  // Precio unitario REAL = base + modificadores (para cuadrar con el carrito)
  const unit = (it) => (Number(it?.precio) || 0) + (Number(it?.precioExtra) || 0)

  // Solo se pueden dividir ítems que ya existen en BD (comandados → tienen dbId)
  const originalItems = (items || []).filter(it => it && it.dbId)
  const hayPendientes = (items || []).some(it => it && !it.dbId)
  const originalSubtotal = originalItems.reduce((sum, it) => sum + unit(it) * it.qty, 0)

  // Ítems seleccionados para mover
  const selectedIds = Object.keys(selectedItems).filter(id => selectedItems[id].selected)
  const newAccountItems = selectedIds.map(id => {
    const it = originalItems.find(i => i.dbId === id)
    if (!it) return null
    const qtyToMove = selectedItems[id].qtyToMove || 1
    return { ...it, qty: qtyToMove }
  }).filter(Boolean)
  const newAccountSubtotal = newAccountItems.reduce((sum, it) => sum + unit(it) * it.qty, 0)

  // Ítems que quedan en la cuenta original
  const remainingItems = originalItems.map(it => {
    const sel = selectedItems[it.dbId]
    if (!sel || !sel.selected) return it
    const qtyToMove = sel.qtyToMove || 1
    const rem = it.qty - qtyToMove
    return rem > 0 ? { ...it, qty: rem } : null
  }).filter(Boolean)
  const remainingSubtotal = remainingItems.reduce((sum, it) => sum + unit(it) * it.qty, 0)

  const handleToggleItem = (dbId) => {
    setSelectedItems(prev => {
      const isSelected = prev[dbId]?.selected
      return {
        ...prev,
        [dbId]: {
          selected: !isSelected,
          qtyToMove: !isSelected ? 1 : prev[dbId]?.qtyToMove || 1,
        },
      }
    })
  }

  const handleQtyChange = (dbId, newQty) => {
    const it = originalItems.find(i => i.dbId === dbId)
    if (!it) return
    if (newQty < 1 || newQty > it.qty) return
    setSelectedItems(prev => ({
      ...prev,
      [dbId]: { ...prev[dbId], qtyToMove: newQty },
    }))
  }

  const handleConfirm = async () => {
    if (selectedIds.length === 0) return
    setLoading(true)

    try {
      // 1. Crear la nueva cuenta (mismos campos que abre POSMain)
      const newCuenta = {
        store_code: storeCode,
        cajero_id: userId,
        tipo: accountData.tipo,
        mesa_ref: mesaRef,
        menu_id: accountData.menu_id || null,
        estado: 'abierta',
        subtotal: newAccountSubtotal,
        iva: 0,
        total: newAccountSubtotal,
        pax_mujeres: accountData.pax_mujeres || 0,
        pax_hombres: accountData.pax_hombres || 0,
        pax_ninos: accountData.pax_ninos || 0,
      }
      const { data: createdCuenta, error: cuentaErr } = await db
        .from('pos_cuentas')
        .insert([newCuenta])
        .select()
        .single()
      if (cuentaErr) throw cuentaErr
      const newCuentaId = createdCuenta.id

      // 2. Mover cada ítem seleccionado
      for (const dbId of selectedIds) {
        const it = originalItems.find(i => i.dbId === dbId)
        if (!it) continue
        const qtyToMove = selectedItems[dbId].qtyToMove || 1

        if (qtyToMove >= it.qty) {
          // Movimiento TOTAL: reasignar la fila a la nueva cuenta (conserva modificadores y la cola de cocina)
          const { error } = await db
            .from('pos_cuenta_items')
            .update({ cuenta_id: newCuentaId, cuenta_origen_id: cuentaId, movido_at: new Date().toISOString(), movido_por: userId })
            .eq('id', dbId)
          if (error) throw error
        } else {
          // Movimiento PARCIAL: reducir la original e insertar una fila nueva en la nueva cuenta
          const { error: updErr } = await db
            .from('pos_cuenta_items')
            .update({ cantidad: it.qty - qtyToMove })
            .eq('id', dbId)
          if (updErr) throw updErr

          const { error: insErr } = await db
            .from('pos_cuenta_items')
            .insert({
              cuenta_id: newCuentaId,
              menu_item_id: it.id,
              nombre: it.nombre,
              cantidad: qtyToMove,
              precio_unitario: Number(it.precio) || 0,
              modificadores: it.modificadores?.length ? it.modificadores : null,
              precio_modificadores: Number(it.precioExtra) || 0,
              componentes: it.componentes?.length ? it.componentes : null,
              cuenta_origen_id: cuentaId,
              movido_at: new Date().toISOString(),
              movido_por: userId,
            })
          if (insErr) throw insErr
        }
      }

      // 3. Actualizar totales de la cuenta original
      const { error: updCuentaErr } = await db
        .from('pos_cuentas')
        .update({ subtotal: remainingSubtotal, total: remainingSubtotal, updated_at: new Date().toISOString() })
        .eq('id', cuentaId)
      if (updCuentaErr) throw updCuentaErr

      toast.success('Cuenta dividida')
      onSplit()
    } catch (err) {
      console.error('Error splitting check:', err)
      toast.error('Error al dividir la cuenta: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!accountData) {
    return (
      <div className="pos-modal-overlay" onClick={onClose}>
        <div className="pos-modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
          <div className="spin" style={{ width: 24, height: 24, margin: '0 auto' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-modal" style={{ maxWidth: 720, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="pos-modal-title">✂ Dividir Cuenta</div>

        {/* Items List */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#8b8997', fontSize: 12, marginBottom: 10 }}>
            Selecciona los ítems a mover a una nueva cuenta
          </div>
          {hayPendientes && (
            <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: 10 }}>
              Hay ítems sin comandar: solo se pueden dividir los ítems ya enviados a cocina.
            </div>
          )}
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
            {originalItems.length === 0 ? (
              <div style={{ color: '#8b8997', textAlign: 'center', padding: 24 }}>No hay ítems comandados para dividir</div>
            ) : (
              originalItems.map(item => {
                const itemSel = selectedItems[item.dbId] || { selected: false, qtyToMove: 1 }
                return (
                  <div
                    key={item.dbId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 10,
                      marginBottom: 8,
                      background: itemSel.selected ? '#2a2a2a' : 'transparent',
                      borderRadius: 6,
                      border: `1px solid ${itemSel.selected ? '#2dd4a8' : '#2a2a32'}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={itemSel.selected}
                      onChange={() => handleToggleItem(item.dbId)}
                      style={{ cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{item.nombre}</div>
                      <div style={{ fontSize: 12, color: '#8b8997' }}>
                        ${unit(item).toFixed(2)} × {item.qty} = ${(unit(item) * item.qty).toFixed(2)}
                      </div>
                    </div>
                    {itemSel.selected && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => handleQtyChange(item.dbId, itemSel.qtyToMove - 1)}
                          disabled={itemSel.qtyToMove <= 1}
                          style={{
                            background: '#2a2a32',
                            border: '1px solid #444',
                            color: '#8b8997',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={item.qty}
                          value={itemSel.qtyToMove}
                          onChange={e => handleQtyChange(item.dbId, parseInt(e.target.value) || 1)}
                          style={{
                            width: 40,
                            textAlign: 'center',
                            background: '#1e1e26',
                            border: '1px solid #333',
                            color: '#fff',
                            padding: '4px 6px',
                            borderRadius: 4,
                            fontSize: 12,
                          }}
                        />
                        <button
                          onClick={() => handleQtyChange(item.dbId, itemSel.qtyToMove + 1)}
                          disabled={itemSel.qtyToMove >= item.qty}
                          style={{
                            background: '#2a2a32',
                            border: '1px solid #444',
                            color: '#8b8997',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Preview */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          {/* Cuenta Original */}
          <div style={{ background: '#1e1e26', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, color: '#f87171' }}>Cuenta Original</div>
            <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 12, fontSize: 12 }}>
              {remainingItems.length === 0 ? (
                <div style={{ color: '#8b8997' }}>Sin ítems</div>
              ) : (
                remainingItems.map(item => (
                  <div key={item.dbId} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#ccc' }}>
                    <span>{item.nombre} ×{item.qty}</span>
                    <span>${(unit(item) * item.qty).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ borderTop: '1px solid #333', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#fff' }}>
                <span>Subtotal:</span>
                <span>${remainingSubtotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Nueva Cuenta */}
          <div style={{ background: '#1e1e26', border: '1px solid #2dd4a8', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, color: '#2dd4a8' }}>Nueva Cuenta</div>
            <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 12, fontSize: 12 }}>
              {newAccountItems.length === 0 ? (
                <div style={{ color: '#8b8997' }}>Selecciona ítems arriba</div>
              ) : (
                newAccountItems.map(item => (
                  <div key={item.dbId} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#ccc' }}>
                    <span>{item.nombre} ×{item.qty}</span>
                    <span>${(unit(item) * item.qty).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ borderTop: '1px solid #333', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#fff' }}>
                <span>Subtotal:</span>
                <span>${newAccountSubtotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <button
          className="pos-confirmar-btn"
          disabled={selectedIds.length === 0 || loading}
          onClick={handleConfirm}
          style={{
            background: selectedIds.length > 0 && !loading ? '#2dd4a8' : '#2a2a32',
            color: selectedIds.length > 0 && !loading ? '#0d2818' : '#666',
          }}
        >
          {loading ? 'Dividiendo...' : selectedIds.length > 0 ? `✂ Dividir (${selectedIds.length} ítems)` : 'Selecciona ítems'}
        </button>
        <button className="pos-cancelar-btn" onClick={onClose} disabled={loading}>
          Cancelar
        </button>
        <toast.Toast />
      </div>
    </div>
  )
}
