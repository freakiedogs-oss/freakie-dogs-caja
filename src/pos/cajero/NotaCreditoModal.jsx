import { useState } from 'react'
import { db } from '../../supabase'

/**
 * NotaCreditoModal — Emitir NC (tipo 05) contra un DTE existente
 * Se abre desde HistorialCobros cuando el usuario quiere hacer una devolución parcial o total.
 */
const DTE_BASE = 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/dte-service'
const DTE_API_KEY = 'dk_live_6230574b3a01728fce1799ca8c7c5da904b39d9c29d37cfa'

export default function NotaCreditoModal({ cuenta, onClose, onSuccess }) {
  const [motivo, setMotivo]     = useState('')
  const [items, setItems]       = useState(() =>
    (cuenta.pos_cuenta_items || []).map(it => ({
      ...it,
      incluir: true,
      cantidadNC: it.cantidad,
    }))
  )
  const [processing, setProcessing] = useState(false)
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState(null)

  const itemsSeleccionados = items.filter(it => it.incluir && it.cantidadNC > 0)
  const totalNC = itemsSeleccionados.reduce((s, it) => s + (it.precio_unitario * it.cantidadNC), 0)

  const toggleItem = (idx) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, incluir: !it.incluir } : it))
  }

  const setCantidad = (idx, val) => {
    const max = items[idx].cantidad
    const n = Math.min(Math.max(0, parseInt(val) || 0), max)
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidadNC: n } : it))
  }

  const handleEmitir = async () => {
    if (!motivo.trim()) { alert('Ingresa el motivo de la Nota de Crédito'); return }
    if (itemsSeleccionados.length === 0) { alert('Selecciona al menos un ítem'); return }
    setProcessing(true)
    setError(null)

    try {
      // Build NC items — precios netos (sin IVA) porque NC tipo 05 es como CCF
      const ncItems = itemsSeleccionados.map(it => ({
        descripcion: it.nombre,
        cantidad: it.cantidadNC,
        precioUni: Math.round((it.precio_unitario / 1.13) * 100) / 100,
        codigo: it.menu_item_id || null,
      }))

      // Documento relacionado — el DTE original
      const docRel = [{
        tipoDocumento: cuenta.dte_tipo || '01',
        tipoGeneracion: 2,
        numeroDocumento: cuenta.dte_uuid,
        fechaEmision: cuenta.cobrada_at?.split('T')[0] || new Date().toISOString().split('T')[0],
      }]

      // Receptor — del DTE original (buscar cliente si es CCF)
      let receptor = { nombre: 'Consumidor Final' }
      if (cuenta.cliente_id) {
        const { data: cli } = await db.from('pos_clientes')
          .select('*')
          .eq('id', cuenta.cliente_id)
          .single()
        if (cli) {
          receptor = {
            nit: cli.numero_documento,
            nrc: (cli.nrc || '').replace(/-/g, ''),
            nombre: cli.nombre,
            codActividad: cli.codigo_actividad || '46900',
            descActividad: cli.giro || 'Venta al por mayor de otros productos',
            nombreComercial: cli.nombre_comercial || null,
            direccion: (cli.departamento && cli.municipio) ? {
              departamento: cli.departamento,
              municipio: cli.municipio,
              complemento: cli.direccion || 'San Salvador, El Salvador',
            } : { departamento: '06', municipio: '14', complemento: 'San Salvador' },
            telefono: cli.telefono || '00000000',
            correo: cli.email || 'sin-correo@freakiedogs.com',
          }
        }
      }

      const body = {
        items: ncItems,
        documentoRelacionado: docRel,
        receptor,
        condicionOperacion: 1,
        pagos: [{ codigo: '01', montoPago: Math.round(totalNC / 1.13 * 100) / 100 + Math.round(totalNC / 1.13 * 0.13 * 100) / 100, referencia: null, plazo: null, periodo: null }],
      }

      const res = await fetch(`${DTE_BASE}/emit-nota-credito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': DTE_API_KEY },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || data.message || 'Error emitiendo NC')
      // Verificar si Hacienda rechazó aunque success=true (edge case: contingency=false pero rechazado)
      if (data.estado === 'RECHAZADO' || data.estado === 'rechazado') {
        const obs = data.hacienda_response?.observaciones
        const obsMsg = Array.isArray(obs) ? obs.join(', ') : (data.hacienda_response?.descripcionMsg || 'Rechazado por Hacienda')
        throw new Error(`Rechazado: ${obsMsg}`)
      }

      // Guardar referencia NC en la cuenta original (solo si fue aceptada)
      if (data.estado === 'PROCESADO' || data.estado === 'aceptado') {
        await db.from('pos_cuentas').update({
          nc_codigo_generacion: data.codigo_generacion,
          nc_emitida_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', cuenta.id)
      }

      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  // ── Resultado ──
  if (result) {
    return (
      <div className="pos-modal-overlay">
        <div className="pos-modal" style={{ maxWidth: 400 }}>
          <div style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <div style={{ color: '#2dd4a8', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
              Nota de Crédito emitida
            </div>
            <div style={{ background: '#0a2a0a', border: '1px solid #166534', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, color: '#8b8', textAlign: 'left' }}>
              <div><b>Estado:</b> {result.estado}</div>
              <div><b>Nº Control:</b> {result.numero_control}</div>
              <div><b>Código Gen:</b> {result.codigo_generacion?.slice(0, 20)}...</div>
              <div><b>Monto:</b> ${result.monto_total?.toFixed(2)}</div>
            </div>
            <button className="pos-confirmar-btn" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="pos-modal-title">📋 Nota de Crédito</div>

        {/* Info del DTE original */}
        <div style={{ background: '#1e1e26', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#8b8997' }}>
          <div>DTE Original: <span style={{ color: '#60a5fa' }}>{cuenta.dte_tipo === '01' ? 'Factura' : cuenta.dte_tipo === '03' ? 'CCF' : cuenta.dte_tipo}</span></div>
          <div>UUID: {cuenta.dte_uuid?.slice(0, 24)}...</div>
          <div>Total original: <b style={{ color: '#fff' }}>${parseFloat(cuenta.total || 0).toFixed(2)}</b></div>
        </div>

        {/* Motivo */}
        <div style={{ marginBottom: 12 }}>
          <label className="pos-payment-label">Motivo de la Nota de Crédito</label>
          <input
            className="pos-payment-input"
            placeholder="Ej: Devolución de producto, error en cobro..."
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            style={{ fontSize: 13, padding: '8px 12px', width: '100%' }}
          />
        </div>

        {/* Items seleccionables */}
        <div style={{ marginBottom: 12 }}>
          <label className="pos-payment-label">Ítems a incluir en NC</label>
          <div style={{ background: '#1c1c22', borderRadius: 8, padding: 8, maxHeight: 180, overflowY: 'auto' }}>
            {items.map((it, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
                borderBottom: idx < items.length - 1 ? '1px solid #222' : 'none',
                opacity: it.incluir ? 1 : 0.4,
              }}>
                <input
                  type="checkbox"
                  checked={it.incluir}
                  onChange={() => toggleItem(idx)}
                  style={{ accentColor: '#ff6b35' }}
                />
                <span style={{ flex: 1, fontSize: 12, color: '#ccc' }}>{it.nombre}</span>
                <input
                  type="number" min="0" max={it.cantidad}
                  value={it.cantidadNC}
                  onChange={e => setCantidad(idx, e.target.value)}
                  disabled={!it.incluir}
                  style={{ width: 40, textAlign: 'center', background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#fff', fontSize: 12, padding: 2 }}
                />
                <span style={{ fontSize: 11, color: '#8b8997', minWidth: 20 }}>/{it.cantidad}</span>
                <span style={{ fontSize: 12, color: '#2dd4a8', minWidth: 55, textAlign: 'right' }}>
                  ${(it.precio_unitario * it.cantidadNC).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Total NC */}
        <div style={{ textAlign: 'center', marginBottom: 12, padding: 8, background: '#1a0a0a', borderRadius: 8, border: '1px solid #7f1d1d' }}>
          <div style={{ fontSize: 11, color: '#f87171' }}>Total Nota de Crédito</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f87171' }}>${totalNC.toFixed(2)}</div>
        </div>

        {error && (
          <div style={{ background: '#2a1a0a', borderRadius: 6, padding: '6px 10px', marginBottom: 8, fontSize: 11, color: '#d97706' }}>
            ⚠️ {error}
          </div>
        )}

        <button
          className="pos-confirmar-btn"
          disabled={processing || !motivo.trim() || itemsSeleccionados.length === 0}
          onClick={handleEmitir}
          style={{ background: '#7f1d1d' }}
        >
          {processing ? '⏳ Emitiendo NC...' : `📋 Emitir NC por $${totalNC.toFixed(2)}`}
        </button>
        <button className="pos-cancelar-btn" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  )
}
