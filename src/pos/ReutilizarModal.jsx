import { useEffect, useState } from 'react'
import { db } from '../supabase'

// ── ¿A qué orden va lo que ya estaba hecho? (22-sep-2026, fase 1) ──
// Se abre cuando un plato anulado "se usa en otra orden" (lo marca la caja al
// anular o cocina al confirmar en el KDS). Sólo muestra órdenes de la misma
// sucursal que llevan EXACTAMENTE ese plato (en cualquier canal) y que todavía
// están esperando en cocina. Al elegir una:
//   · queda el vínculo origen → destino en pos_mermas_producto,
//   · la orden destino aparece en cocina con "♻️ Usar el ya hecho de …",
//   · no hay merma y la orden destino descuenta normal al cobrarse: una sola vez.
// Si no se elige ninguna, el plato queda "reutilizado sin destino" y sale
// marcado en el cuadre nocturno para revisar.
//
// props:
//   mermaId, cuentaItemId — el plato anulado (pos_mermas_producto / pos_cuenta_items)
//   titulo      — "2× Freakie Dog · Mesa 17"
//   usuarioNombre
//   modo        — 'caja' | 'cocina' (cocina puede cambiar a "se botó")
//   onClose(resultado) — { asignado: 'Mesa 6' } | { pendiente: true } | { botado: true }

const CANALES_DELIVERY = ['delivery_propio', 'pedidos_ya', 'web', 'delivery_app']
const esDelivery = (canal) => CANALES_DELIVERY.includes(canal)

function esperando(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return min < 1 ? 'recién' : `${min} min`
}

export default function ReutilizarModal({ mermaId, cuentaItemId, titulo, usuarioNombre, modo = 'caja', onClose }) {
  const [opciones, setOpciones] = useState(null)
  const [tab, setTab] = useState('local')
  const [elegida, setElegida] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error: e } = await db.rpc('pos_merma_destinos_posibles', { p_cuenta_item_id: cuentaItemId })
      if (!vivo) return
      if (e) { setError('No se pudieron cargar las órdenes: ' + e.message); setOpciones([]); return }
      const lista = Array.isArray(data) ? data : []
      setOpciones(lista)
      // Abre en la pestaña que tenga órdenes.
      if (!lista.some(o => !esDelivery(o.canal)) && lista.some(o => esDelivery(o.canal))) setTab('delivery')
    })()
    return () => { vivo = false }
  }, [cuentaItemId])

  const local = (opciones || []).filter(o => !esDelivery(o.canal))
  const delivery = (opciones || []).filter(o => esDelivery(o.canal))
  const visibles = tab === 'local' ? local : delivery

  const asignar = async () => {
    if (!elegida) return
    setGuardando(true); setError(null)
    const { data, error: e } = await db.rpc('pos_merma_asignar_destino', {
      p_merma_id: mermaId, p_destino_item_id: elegida.item_id, p_nombre: usuarioNombre || null,
    })
    setGuardando(false)
    if (e) { setError(e.message); return }
    onClose({ asignado: data?.destino_ref || elegida.ref })
  }

  const botar = async () => {
    setGuardando(true); setError(null)
    const { error: e } = await db.rpc('pos_merma_confirmar_cocina', {
      p_cuenta_item_id: cuentaItemId, p_respuesta: 'preparado', p_nombre: usuarioNombre || 'Cocina',
    })
    setGuardando(false)
    if (e) { setError(e.message); return }
    onClose({ botado: true })
  }

  const tabBtn = (key, label, n) => (
    <button key={key} onClick={() => { setTab(key); setElegida(null) }}
      style={{
        flex: 1, padding: '9px 6px', borderRadius: 9, cursor: 'pointer', fontWeight: 800, fontSize: 13,
        border: `1.5px solid ${tab === key ? '#3b82f6' : '#2a2a32'}`,
        background: tab === key ? '#3b82f622' : 'transparent', color: tab === key ? '#bfdbfe' : '#9ca3af',
      }}>
      {label} <span style={{ opacity: .75 }}>({n})</span>
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1100,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#111827', border: '2px solid #3b82f6', borderRadius: 14, width: '100%',
                    maxWidth: 460, maxHeight: '88vh', overflowY: 'auto', padding: 18, color: '#f3f4f6' }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>♻️ ¿A qué orden va?</div>
        <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
          <b style={{ color: '#e5e7eb' }}>{titulo}</b> ya estaba hecho. Elegí la orden que lo va a recibir:
          cocina la verá marcada para no cocinar otro.
        </div>

        {opciones === null ? (
          <div style={{ padding: '18px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Buscando órdenes…</div>
        ) : opciones.length === 0 ? (
          <div style={{ background: '#1f2937', borderRadius: 10, padding: 14, fontSize: 13.5, color: '#d1d5db', marginBottom: 10 }}>
            Ahora mismo ninguna orden abierta lleva este mismo producto esperando en cocina.
            {modo === 'cocina'
              ? ' Si se va a botar, marcalo como merma. Si lo van a usar más tarde, dejalo pendiente.'
              : ' Si lo dejás pendiente, sale marcado en el cuadre de la noche para revisar.'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {tabBtn('local', 'Mesas y para llevar', local.length)}
              {tabBtn('delivery', 'Delivery', delivery.length)}
            </div>
            {visibles.length === 0 ? (
              <div style={{ fontSize: 13, color: '#9ca3af', padding: '10px 2px' }}>Ninguna orden en esta pestaña lleva este producto.</div>
            ) : visibles.map(o => {
              const sel = elegida?.item_id === o.item_id
              return (
                <button key={o.item_id} onClick={() => setElegida(o)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, width: '100%',
                    textAlign: 'left', padding: '11px 12px', marginBottom: 7, borderRadius: 10, cursor: 'pointer',
                    border: `1.5px solid ${sel ? '#22c55e' : '#2a2a32'}`, background: sel ? '#22c55e1f' : '#1f2937', color: '#f3f4f6',
                  }}>
                  <span>
                    <span style={{ display: 'block', fontWeight: 800, fontSize: 15 }}>{o.ref}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: '#9ca3af' }}>{o.cantidad}× {o.producto}</span>
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'block', fontWeight: 700, color: o.estado_cocina === 'en_preparacion' ? '#fbbf24' : '#93c5fd' }}>
                      {o.estado_cocina === 'en_preparacion' ? 'preparándose' : 'esperando'}
                    </span>
                    <span style={{ color: '#6b7280' }}>{esperando(o.recibido_at)}</span>
                  </span>
                </button>
              )
            })}
          </>
        )}

        {error && <div style={{ color: '#fca5a5', fontSize: 12.5, margin: '6px 2px' }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {opciones && opciones.length > 0 && (
            <button onClick={asignar} disabled={!elegida || guardando}
              style={{ padding: '12px 0', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 800, cursor: elegida ? 'pointer' : 'default',
                       background: elegida ? '#059669' : '#1f2937', color: elegida ? '#fff' : '#6b7280' }}>
              {guardando ? 'Guardando…' : elegida ? `Pasarlo a ${elegida.ref}` : 'Elegí una orden'}
            </button>
          )}
          {modo === 'cocina' && (
            <button onClick={botar} disabled={guardando}
              style={{ padding: '10px 0', borderRadius: 10, border: '1px solid #ef444488', background: '#ef444422', color: '#fecaca', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              🗑️ Mejor no: se botó (merma)
            </button>
          )}
          <button onClick={() => onClose({ pendiente: true })} disabled={guardando}
            style={{ padding: '10px 0', borderRadius: 10, border: '1px solid #2a2a32', background: 'transparent', color: '#9ca3af', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Dejar pendiente
          </button>
        </div>
      </div>
    </div>
  )
}
