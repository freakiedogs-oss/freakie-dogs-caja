import { useState } from 'react'

const TYPES = [
  { key: 'local',       icon: '🪑', label: 'Mesa',        desc: 'Servicio en mesa' },
  { key: 'para_llevar', icon: '🥡', label: 'Para Llevar', desc: 'El cliente espera' },
  { key: 'delivery',    icon: '🛵', label: 'Delivery',    desc: 'Envío a domicilio' },
  { key: 'pedidos_ya',  icon: '📱', label: 'PedidosYa',   desc: 'Plataforma delivery' },
  { key: 'drive_thru',  icon: '🚗', label: 'Drive Thru',  desc: 'Ventanilla' },
]

export default function OrderTypeSelector({ onSelect, onClose, current, currentMesa, modal }) {
  const [selected, setSelected]   = useState(current || null)
  const [mesa, setMesa]           = useState(currentMesa || '')

  const handleConfirm = () => {
    if (!selected) return
    onSelect(selected, mesa)
  }

  const content = (
    <div className="pos-modal" onClick={e => e.stopPropagation()}>
      <div className="pos-modal-title">
        {modal ? '🔄 Cambiar tipo de orden' : '¿Cómo es esta orden?'}
      </div>
      <div className="pos-modal-sub">
        Selecciona el canal de venta
      </div>

      <div className="pos-type-grid">
        {TYPES.map(t => (
          <button
            key={t.key}
            className={`pos-type-btn${selected === t.key ? ' selected' : ''}`}
            onClick={() => setSelected(t.key)}
          >
            <span className="pos-type-icon">{t.icon}</span>
            <span className="pos-type-label">{t.label}</span>
            <span style={{ fontSize: 10, color: '#555' }}>{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Mesa input: solo para local */}
      {selected === 'local' && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            Número de mesa (opcional)
          </label>
          <input
            className="pos-mesa-input"
            type="text"
            placeholder="Ej: 5, A3, Terraza 2..."
            value={mesa}
            onChange={e => setMesa(e.target.value)}
            maxLength={10}
            autoFocus
          />
        </div>
      )}

      {/* Para llevar / Delivery: referencia */}
      {(selected === 'delivery' || selected === 'pedidos_ya') && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            Referencia / Nombre cliente (opcional)
          </label>
          <input
            className="pos-mesa-input"
            type="text"
            placeholder="Ej: Juan García, Pedido #1234..."
            value={mesa}
            onChange={e => setMesa(e.target.value)}
            maxLength={60}
          />
        </div>
      )}

      <button
        className="pos-confirmar-btn"
        disabled={!selected}
        onClick={handleConfirm}
      >
        {modal ? 'Actualizar orden' : `Continuar → ${TYPES.find(t => t.key === selected)?.label || ''}`}
      </button>

      {modal && (
        <button className="pos-cancelar-btn" onClick={onClose}>
          Cancelar
        </button>
      )}
    </div>
  )

  // Sin modal: pantalla completa
  if (!modal) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0d0d0d',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
      }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 40 }}>🍔</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#e63946', marginTop: 6 }}>
              FREAKIE DOGS POS
            </div>
          </div>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      {content}
    </div>
  )
}
