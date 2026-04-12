import { useState } from 'react'
import CustomerSearch from './CustomerSearch'

const DTE_TYPES = [
  { key: 'ticket',  label: '🧾 Ticket',   desc: 'Comprobante interno' },
  { key: 'factura', label: '📄 Factura',   desc: 'Factura consumidor final' },
  { key: 'ccf',     label: '🏢 CCF',       desc: 'Crédito Fiscal' },
]

export default function PaymentModal({ items, total, onConfirm, onComplete, onClose, saving }) {
  const [metodo, setMetodo]     = useState('efectivo')
  const [efectivo, setEfectivo] = useState('')
  const [tarjeta, setTarjeta]   = useState('')
  const [propina, setPropina]   = useState('')
  const [tipoDte, setTipoDte]   = useState('ticket')
  const [ref, setRef]           = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [cuentaResult, setCuentaResult] = useState(null)
  const [dteResult, setDteResult] = useState(null)
  const [dteError, setDteError]   = useState(null)
  const [processing, setProcessing] = useState(false)

  // Cliente seleccionado (para CCF)
  const [cliente, setCliente] = useState(null)

  const propinaNum  = parseFloat(propina) || 0
  const efectivoNum = parseFloat(efectivo) || 0
  const tarjetaNum  = parseFloat(tarjeta) || 0
  const totalConProp = total + propinaNum

  const cambio = metodo === 'efectivo'
    ? Math.max(0, efectivoNum - totalConProp)
    : 0

  const totalMixto = efectivoNum + tarjetaNum

  const canConfirm = () => {
    if (metodo === 'efectivo' && efectivoNum < totalConProp) return false
    if (metodo === 'mixto' && Math.abs(totalMixto - totalConProp) >= 0.01) return false
    // CCF requiere cliente seleccionado
    if (tipoDte === 'ccf' && !cliente) return false
    return true
  }

  const handleConfirm = async () => {
    setProcessing(true)
    setDteError(null)

    const payData = {
      metodo,
      efectivo: metodo === 'efectivo' ? efectivoNum : (metodo === 'mixto' ? efectivoNum : 0),
      tarjeta:  metodo === 'tarjeta'  ? totalConProp : (metodo === 'mixto' ? tarjetaNum : 0),
      cambio,
      propina: propinaNum,
      tipoDte,
      referencia: ref || null,
      // Datos del cliente para DTE
      cliente: cliente ? {
        id: cliente.id,
        nombre: cliente.nombre,
        nit: cliente.numero_documento,
        nrc: cliente.nrc,
        giro: cliente.giro,
        codActividad: '56101',
        descActividad: cliente.giro || 'Restaurantes',
        nombreComercial: cliente.nombre_comercial || null,
        correo: cliente.email || null,
        telefono: cliente.telefono || null,
        direccionTexto: cliente.direccion || null,
        direccion: (cliente.departamento && cliente.municipio) ? {
          departamento: cliente.departamento,
          municipio: cliente.municipio,
          complemento: cliente.direccion || 'San Salvador, El Salvador',
        } : null,
      } : null,
    }

    try {
      const result = await onConfirm(payData)
      setCuentaResult(result?.cuenta || result)
      setDteResult(result?.dte || null)
      setDteError(result?.dteError || null)
      setConfirmed(true)
    } catch (err) {
      alert('Error al procesar pago: ' + err.message)
    } finally {
      setProcessing(false)
    }
  }

  // ── Ticket de confirmación ──
  if (confirmed) {
    return (
      <div className="pos-modal-overlay">
        <div className="pos-modal" style={{ maxWidth: 420 }}>
          <div className="pos-ticket">
            <div className="pos-ticket-icon">✅</div>
            <div className="pos-ticket-title">¡Pago confirmado!</div>

            <div className="pos-ticket-detail">
              <div className="pos-ticket-row">
                <span className="lbl">Total cobrado</span>
                <span className="val">${totalConProp.toFixed(2)}</span>
              </div>
              <div className="pos-ticket-row">
                <span className="lbl">Método</span>
                <span className="val">{metodo.charAt(0).toUpperCase() + metodo.slice(1)}</span>
              </div>
              {cambio > 0 && (
                <div className="pos-ticket-row">
                  <span className="lbl">Cambio</span>
                  <span className="val" style={{ color: '#4ade80' }}>${cambio.toFixed(2)}</span>
                </div>
              )}
              {propinaNum > 0 && (
                <div className="pos-ticket-row">
                  <span className="lbl">Propina</span>
                  <span className="val">${propinaNum.toFixed(2)}</span>
                </div>
              )}
              <div className="pos-ticket-row">
                <span className="lbl">Documento</span>
                <span className="val">{DTE_TYPES.find(d => d.key === tipoDte)?.label}</span>
              </div>
            </div>

            {/* ── Resultado DTE ── */}
            {dteResult && (
              <div style={{
                background: '#0a2a0a', border: '1px solid #166534', borderRadius: 8,
                padding: '10px 12px', marginTop: 12, marginBottom: 8
              }}>
                <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                  📄 DTE Emitido — {dteResult.estado === 'PROCESADO' ? '✅ Aceptado por Hacienda' : dteResult.estado}
                </div>
                <div style={{ fontSize: 11, color: '#8b8', lineHeight: 1.6 }}>
                  <div><b>Nº Control:</b> {dteResult.numero_control}</div>
                  <div><b>Código Gen:</b> {dteResult.codigo_generacion?.slice(0, 18)}...</div>
                  <div><b>Sello:</b> {dteResult.sello_recepcion?.slice(0, 24)}...</div>
                  <div><b>Monto:</b> ${dteResult.monto_total?.toFixed(2)} (IVA: ${dteResult.monto_iva?.toFixed(2)})</div>
                </div>
              </div>
            )}

            {/* ── Error DTE (venta sí se cobró) ── */}
            {dteError && (
              <div style={{
                background: '#2a1a0a', border: '1px solid #92400e', borderRadius: 8,
                padding: '10px 12px', marginTop: 12, marginBottom: 8
              }}>
                <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                  ⚠️ DTE no emitido
                </div>
                <div style={{ fontSize: 11, color: '#d97706', lineHeight: 1.5 }}>
                  {dteError}
                </div>
                <div style={{ fontSize: 10, color: '#92400e', marginTop: 4 }}>
                  La venta se registró correctamente. El DTE puede emitirse después desde el admin.
                </div>
              </div>
            )}

            {/* Si es ticket (sin DTE) */}
            {tipoDte === 'ticket' && !dteResult && !dteError && (
              <div style={{
                background: '#1a1a1a', borderRadius: 8, padding: '8px 12px',
                marginTop: 8, fontSize: 11, color: '#555', textAlign: 'center'
              }}>
                Comprobante interno — sin documento fiscal
              </div>
            )}

            <button
              className="pos-confirmar-btn"
              onClick={onComplete || onClose}
              style={{ marginTop: 12 }}
            >
              ✅ Nueva orden
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="pos-modal-title">💳 Cobrar orden</div>

        {/* Total */}
        <div className="pos-payment-total">
          <div className="pos-payment-total-label">Total a cobrar</div>
          <div className="pos-payment-total-amount">${totalConProp.toFixed(2)}</div>
          {propinaNum > 0 && (
            <div style={{ fontSize: 11, color: '#666' }}>
              (incl. propina ${propinaNum.toFixed(2)})
            </div>
          )}
        </div>

        {/* Método de pago */}
        <div className="pos-method-tabs">
          {['efectivo','tarjeta','mixto'].map(m => (
            <button
              key={m}
              className={`pos-method-tab${metodo === m ? ' active' : ''}`}
              onClick={() => setMetodo(m)}
            >
              {m === 'efectivo' ? '💵' : m === 'tarjeta' ? '💳' : '🔀'}{' '}
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Efectivo */}
        {metodo === 'efectivo' && (
          <>
            <div className="pos-payment-field">
              <label className="pos-payment-label">Efectivo recibido</label>
              <input
                className="pos-payment-input"
                type="number"
                step="0.25"
                min={totalConProp}
                placeholder={`Mín $${totalConProp.toFixed(2)}`}
                value={efectivo}
                onChange={e => setEfectivo(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[totalConProp, Math.ceil(totalConProp), 20, 50].map(v => {
                if (v < totalConProp && v !== totalConProp) return null
                return (
                  <button
                    key={v}
                    style={{
                      padding: '6px 12px', background: '#1e1e1e', border: '1px solid #333',
                      borderRadius: 8, color: '#ccc', fontSize: 12, cursor: 'pointer'
                    }}
                    onClick={() => setEfectivo(v.toFixed(2))}
                  >
                    ${v.toFixed(2)}
                  </button>
                )
              }).filter(Boolean)}
            </div>
            {efectivoNum >= totalConProp && (
              <div className="pos-cambio">
                <span className="pos-cambio-label">Cambio a dar</span>
                <span className="pos-cambio-value">${cambio.toFixed(2)}</span>
              </div>
            )}
          </>
        )}

        {/* Tarjeta */}
        {metodo === 'tarjeta' && (
          <div className="pos-payment-field">
            <label className="pos-payment-label">Referencia de voucher (opcional)</label>
            <input
              className="pos-payment-input"
              type="text"
              placeholder="Últimos 4 dígitos o referencia..."
              value={ref}
              onChange={e => setRef(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {/* Mixto */}
        {metodo === 'mixto' && (
          <>
            <div className="pos-payment-field">
              <label className="pos-payment-label">Efectivo</label>
              <input
                className="pos-payment-input"
                type="number" step="0.01" min="0"
                placeholder="$0.00"
                value={efectivo}
                onChange={e => setEfectivo(e.target.value)}
                autoFocus
              />
            </div>
            <div className="pos-payment-field">
              <label className="pos-payment-label">
                Tarjeta (restante: ${Math.max(0, totalConProp - efectivoNum).toFixed(2)})
              </label>
              <input
                className="pos-payment-input"
                type="number" step="0.01" min="0"
                placeholder="$0.00"
                value={tarjeta}
                onChange={e => setTarjeta(e.target.value)}
              />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 12, color: Math.abs(totalMixto - totalConProp) < 0.01 ? '#4ade80' : '#f87171',
              marginBottom: 8
            }}>
              <span>Suma: ${totalMixto.toFixed(2)}</span>
              <span>
                {Math.abs(totalMixto - totalConProp) < 0.01
                  ? '✓ Correcto'
                  : `Diferencia: $${(totalConProp - totalMixto).toFixed(2)}`
                }
              </span>
            </div>
          </>
        )}

        {/* Propina */}
        <div className="pos-payment-field">
          <label className="pos-payment-label">Propina (opcional)</label>
          <input
            className="pos-payment-input"
            type="number" step="0.25" min="0"
            placeholder="$0.00"
            value={propina}
            onChange={e => setPropina(e.target.value)}
            style={{ fontSize: 14, padding: '8px 12px' }}
          />
        </div>

        {/* Tipo DTE */}
        <div style={{ marginBottom: 12 }}>
          <label className="pos-payment-label" style={{ display: 'block', marginBottom: 6 }}>
            Documento fiscal
          </label>
          <div className="pos-dte-options">
            {DTE_TYPES.map(d => (
              <button
                key={d.key}
                className={`pos-dte-opt${tipoDte === d.key ? ' active' : ''}`}
                onClick={() => { setTipoDte(d.key); if (d.key !== 'ccf') setCliente(null) }}
                title={d.desc}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── CustomerSearch para CCF ── */}
        {tipoDte === 'ccf' && (
          <CustomerSearch
            selected={cliente}
            onSelect={setCliente}
          />
        )}

        {/* Items resumen */}
        <div style={{
          background: '#1a1a1a', borderRadius: 8, padding: '8px 10px',
          marginBottom: 12, maxHeight: 80, overflowY: 'auto'
        }}>
          {items.map((it, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: '#666', padding: '1px 0'
            }}>
              <span>{it.qty}x {it.nombre}</span>
              <span>${(it.precio * it.qty).toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* Validación CCF */}
        {tipoDte === 'ccf' && !cliente && (
          <div style={{
            background: '#2a1a0a', borderRadius: 6, padding: '6px 10px',
            marginBottom: 8, fontSize: 11, color: '#d97706'
          }}>
            ⚠️ Selecciona un cliente para emitir CCF
          </div>
        )}

        <button
          className="pos-confirmar-btn"
          disabled={!canConfirm() || saving || processing}
          onClick={handleConfirm}
        >
          {processing ? '⏳ Emitiendo DTE...' : saving ? '⏳ Procesando...' : `✅ Confirmar pago $${totalConProp.toFixed(2)}`}
        </button>
        <button className="pos-cancelar-btn" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
