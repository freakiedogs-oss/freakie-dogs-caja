import { useState, useEffect } from 'react'
import { db } from '../../supabase'

export default function SplitCheckModal({ cuentaId, items, storeCode, userId, mesaRef, onClose, onSplit }) {
  const [loading, setLoading] = useState(false)
  const [selectedItems, setSelectedItems] = useState({}) // { itemId: { selected: bool, qtyToMove: number } }
  const [accountData, setAccountData] = useState(null)

  // Load current account data to get subtotal, total, tipo, etc.
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

  // Calculate totals
  const originalItems = items || []
  const originalSubtotal = originalItems.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  // Items selected for split
  const selectedIds = Object.keys(selectedItems).filter(id => selectedItems[id].selected)
  const newAccountItems = selectedIds.map(id => {
    const item = originalItems.find(i => i.id === id)
    const qtyToMove = selectedItems[id].qtyToMove || 1
    return { ...item, cantidad: qtyToMove }
  })
  const newAccountSubtotal = newAccountItems.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  // Remaining items
  const remainingItems = originalItems.map(item => {
    if (!selectedItems[item.id] || !selectedItems[item.id].selected) return item
    const qtyToMove = selectedItems[item.id].qtyToMove || 1
    const remaining = item.cantidad - qtyToMove
    return remaining > 0 ? { ...item, cantidad: remaining } : null
  }).filter(Boolean)
  const remainingSubtotal = remainingItems.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)

  const handleToggleItem = (itemId) => {
    setSelectedItems(prev => {
      const item = originalItems.find(i => i.id === itemId)
      const isSelected = prev[itemId]?.selected
      return {
        ...prev,
        [itemId]: {
          selected: !isSelected,
          qtyToMove: !isSelected ? 1 : prev[itemId]?.qtyToMove || 1
        }
      }
    })
  }

  const handleQtyChange = (itemId, newQty) => {
    const item = originalItems.find(i => i.id === itemId)
    if (newQty < 1 || newQty > item.cantidad) return
    setSelectedItems(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], qtyToMove: newQty }
    }))
  }

  const handleConfirm = async () => {
    if (selectedIds.length === 0) return
    setLoading(true)

    try {
      // 1. Create new pos_cuentas record
      const newCuenta = {
        store_code: storeCode,
        tipo: accountData.tipo,
        mesa_ref: mesaRef,
        estado: 'abierta',
        subtotal: newAccountSubtotal,
        total: newAccountSubtotal,
        fecha_inicio: new Date().toISOString(),
      }
      const { data: createdCuenta, error: cuentaErr } = await db
        .from('pos_cuentas')
        .insert([newCuenta])
        .select()
        .single()
      if (cuentaErr) throw cuentaErr

      const newCuentaId = createdCuenta.id

      // 2. For each selected item, INSERT new pos_cuenta_items in new cuenta
      const newItems = selectedIds.map(itemId => {
        const item = originalItems.find(i => i.id === itemId)
        const qtyToMove = selectedItems[itemId].qtyToMove
        return {
          cuenta_id: newCuentaId,
          producto_id: item.producto_id,
          nombre: item.nombre,
          precio: item.precio,
          cantidad: qtyToMove,
          cuenta_origen_id: item.id,
          movido_at: new Date().toISOString(),
          movido_por: userId,
        }
      })
      const { error: insertErr } = await db
        .from('pos_cuenta_items')
        .insert(newItems)
      if (insertErr) throw insertErr

      // 3. UPDATE original items: reduce qty or delete if all moved
      for (const itemId of selectedIds) {
        const item = originalItems.find(i => i.id === itemId)
        const qtyToMove = selectedItems[itemId].qtyToMove
        const remaining = item.cantidad - qtyToMove

        if (remaining > 0) {
          const { error: updateErr } = await db
            .from('pos_cuenta_items')
            .update({ cantidad: remaining })
            .eq('id', itemId)
          if (updateErr) throw updateErr
        } else {
          const { error: delErr } = await db
            .from('pos_cuenta_items')
            .delete()
            .eq('id', itemId)
          if (delErr) throw delErr
        }
      }

      // 4. UPDATE original pos_cuentas subtotal and total
      const { error: updateCuentaErr } = await db
        .from('pos_cuentas')
        .update({ subtotal: remainingSubtotal, total: remainingSubtotal })
        .eq('id', cuentaId)
      if (updateCuentaErr) throw updateCuentaErr

      // 5. Call onSplit callback
      onSplit()
    } catch (err) {
      console.error('Error splitting check:', err)
      alert('Error al dividir la cuenta: ' + err.message)
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
          <div style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>
            Selecciona los ítems a mover a una nueva cuenta
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
            {originalItems.length === 0 ? (
              <div style={{ color: '#666', textAlign: 'center', padding: 24 }}>Sin ítems</div>
            ) : (
              originalItems.map(item => {
                const itemSel = selectedItems[item.id] || { selected: false, qtyToMove: 1 }
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 10,
                      marginBottom: 8,
                      background: itemSel.selected ? '#2a2a2a' : 'transparent',
                      borderRadius: 6,
                      border: `1px solid ${itemSel.selected ? '#4ade80' : '#333'}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={itemSel.selected}
                      onChange={() => handleToggleItem(item.id)}
                      style={{ cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{item.nombre}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        ${item.precio.toFixed(2)} × {item.cantidad} = ${(item.precio * item.cantidad).toFixed(2)}
                      </div>
                    </div>
                    {itemSel.selected && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => handleQtyChange(item.id, itemSel.qtyToMove - 1)}
                          disabled={itemSel.qtyToMove <= 1}
                          style={{
                            background: '#333',
                            border: '1px solid #444',
                            color: '#888',
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
                          max={item.cantidad}
                          value={itemSel.qtyToMove}
                          onChange={e => handleQtyChange(item.id, parseInt(e.target.value) || 1)}
                          style={{
                            width: 40,
                            textAlign: 'center',
                            background: '#1a1a1a',
                            border: '1px solid #333',
                            color: '#fff',
                            padding: '4px 6px',
                            borderRadius: 4,
                            fontSize: 12,
                          }}
                        />
                        <button
                          onClick={() => handleQtyChange(item.id, itemSel.qtyToMove + 1)}
                          disabled={itemSel.qtyToMove >= item.cantidad}
                          style={{
                            background: '#333',
                            border: '1px solid #444',
                            color: '#888',
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
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, color: '#f87171' }}>Cuenta Original</div>
            <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 12, fontSize: 12 }}>
              {remainingItems.length === 0 ? (
                <div style={{ color: '#666' }}>Sin ítems</div>
              ) : (
                remainingItems.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#ccc' }}>
                    <span>{item.nombre} ×{item.cantidad}</span>
                    <span>${(item.precio * item.cantidad).toFixed(2)}</span>
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
          <div style={{ background: '#1a1a1a', border: '1px solid #4ade80', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, color: '#4ade80' }}>Nueva Cuenta</div>
            <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 12, fontSize: 12 }}>
              {newAccountItems.length === 0 ? (
                <div style={{ color: '#666' }}>Selecciona ítems arriba</div>
              ) : (
                newAccountItems.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#ccc' }}>
                    <span>{item.nombre} ×{item.cantidad}</span>
                    <span>${(item.precio * item.cantidad).toFixed(2)}</span>
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
            background: selectedIds.length > 0 && !loading ? '#4ade80' : '#333',
            color: selectedIds.length > 0 && !loading ? '#0d2818' : '#666',
          }}
        >
          {loading ? 'Dividiendo...' : selectedIds.length > 0 ? `✂ Dividir (${selectedIds.length} ítems)` : 'Selecciona ítems'}
        </button>
        <button className="pos-cancelar-btn" onClick={onClose} disabled={loading}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
