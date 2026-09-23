import Icon from './Icon'

// ── ¿Cocina ya lo preparó? (21-sep-2026, pedido Cesar) ──
// Se muestra al anular algo que YA está en la cola de cocina. Antes la anulación
// borraba la fila del KDS y, si cocina ya lo había hecho, el producto se perdía
// sin rastro (caso mesa 17 → mesa 6 en Cafetalón). La respuesta decide si se
// registra como MERMA DE PRODUCTO PREPARADO (pos_mermas_producto) o no.
// Cocina confirma después desde el KDS; si no coincide, gana cocina.
//
// props:
//   titulo      — qué se anula ("2× Freakie Dog" o "Mesa #17")
//   cocinaListo — true si cocina ya lo marcó listo (se sugiere "Sí, se bota")
//   onElegir(respuesta) — 'preparado' | 'no_preparado' | 'reutilizado'
//     ('reutilizado' abre después ReutilizarModal para elegir la orden destino)
//   onCancel
export default function PreparadoModal({ titulo, cocinaListo = false, onElegir, onCancel }) {
  const opcion = (resp, color, icono, texto, sub) => (
    <button
      onClick={() => onElegir(resp)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
        padding: '13px 14px', marginBottom: 9, borderRadius: 12, cursor: 'pointer',
        border: `1.5px solid ${color}66`, background: `${color}14`, color: '#f3f4f6',
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icono}</span>
      <span>
        <span style={{ display: 'block', fontWeight: 800, fontSize: 15 }}>{texto}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{sub}</span>
      </span>
    </button>
  )

  return (
    <div className="pos-modal-overlay" onClick={onCancel}>
      <div className="pos-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="pos-modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="chef" size={18} color="#f59e0b" /> ¿Cocina ya lo preparó?
        </div>
        <div className="pos-modal-sub" style={{ marginBottom: 12 }}>
          {titulo} ya está en cocina.
          {cocinaListo && <b style={{ color: '#fbbf24' }}> Cocina ya lo marcó como listo.</b>}
        </div>

        {opcion('no_preparado', '#22c55e', '✋', 'No, no se preparó',
          'Se anula y no se descarga nada.')}
        {opcion('preparado', '#ef4444', '🗑️', 'Sí, ya estaba hecho y se bota',
          'Queda como merma de producto preparado.')}
        {opcion('reutilizado', '#3b82f6', '♻️', 'Sí, y va para otra orden',
          'Después elegís a cuál. No es merma y no se descuenta dos veces.')}

        <div style={{ fontSize: 11.5, color: '#8b8997', margin: '4px 2px 10px' }}>
          Cocina lo confirma en su pantalla. Si no coincide, vale lo que diga cocina.
        </div>
        <button onClick={onCancel}
          style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: '1px solid #2a2a32',
                   background: 'transparent', color: '#9ca3af', fontWeight: 700, cursor: 'pointer' }}>
          No anular
        </button>
      </div>
    </div>
  )
}
