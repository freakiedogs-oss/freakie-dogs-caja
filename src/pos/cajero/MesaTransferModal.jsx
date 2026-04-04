import { useState, useEffect } from 'react'
import { db } from '../../supabase'

const MESA_STATUS_COLORS = {
  libre:  { bg: '#0d1a10', border: '#4ade80', text: '#4ade80' },
  activa: { bg: '#1a1200', border: '#fbbf24', text: '#fbbf24' },
}

export default function MesaTransferModal({ storeCode, mesaActual, onTransfer, onClose }) {
  const [mesas,    setMesas]    = useState([])
  const [cuentas,  setCuentas]  = useState({})
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const load = async () => {
      const [{ data: mesasData }, { data: cuentasData }] = await Promise.all([
        db.from('pos_mesas')
          .select('*')
          .eq('store_code', storeCode)
          .eq('activa', true)
          .order('numero'),
        db.from('pos_cuentas')
          .select('id, mesa_ref')
          .eq('store_code', storeCode)
          .in('estado', ['abierta', 'enviada_cocina', 'en_preparacion', 'lista', 'entregada']),
      ])
      const ocupadas = {}
      ;(cuentasData || []).forEach(c => { if (c.mesa_ref) ocupadas[c.mesa_ref] = true })
      setMesas(mesasData || [])
      setCuentas(ocupadas)
      setLoading(false)
    }
    load()
  }, [storeCode])

  const handleConfirm = () => {
    if (!selected) return
    onTransfer(selected)
  }

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="pos-modal-title">↔ Mover Mesa</div>
        <div className="pos-modal-sub" style={{ marginBottom: 16 }}>
          Cuenta actual: Mesa <strong style={{ color: '#fbbf24' }}>#{mesaActual}</strong> · Selecciona la nueva mesa
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <div className="spin" style={{ width: 24, height: 24, margin: '0 auto 8px' }} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, marginBottom: 20 }}>
            {mesas.map(mesa => {
              const mesaStr  = String(mesa.numero)
              const esActual = mesaStr === String(mesaActual)
              const ocupada  = cuentas[mesaStr] && !esActual
              const isSelected = mesaStr === selected
              const colors   = ocupada
                ? { bg: '#1a0a0a', border: '#f87171', text: '#f87171' }
                : esActual
                  ? { bg: '#0a1a0a', border: '#4ade80aa', text: '#4ade8066' }
                  : { bg: '#1a1a1a', border: '#2a2a2a',  text: '#888' }

              return (
                <button
                  key={mesa.id}
                  onClick={() => { if (!esActual && !ocupada) setSelected(mesaStr) }}
                  disabled={esActual || ocupada}
                  style={{
                    background: isSelected ? '#e6394618' : colors.bg,
                    border: `2px solid ${isSelected ? '#e63946' : colors.border}`,
                    borderRadius: 10,
                    padding: '10px 6px',
                    textAlign: 'center',
                    cursor: esActual || ocupada ? 'not-allowed' : 'pointer',
                    opacity: esActual ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 900, color: isSelected ? '#e63946' : colors.text, fontFamily: 'monospace' }}>
                    {mesa.numero}
                  </div>
                  <div style={{ fontSize: 9, color: ocupada ? '#f87171' : '#444', marginTop: 2 }}>
                    {esActual ? 'actual' : ocupada ? 'ocupada' : 'libre'}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <button
          className="pos-confirmar-btn"
          disabled={!selected}
          onClick={handleConfirm}
          style={{ background: selected ? '#4ade80' : undefined, color: selected ? '#0d2818' : undefined }}
        >
          {selected ? `↔ Mover a Mesa #${selected}` : 'Selecciona una mesa'}
        </button>
        <button className="pos-cancelar-btn" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  )
}
