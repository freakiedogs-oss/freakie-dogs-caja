import { useState, useEffect, useCallback } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'
import { anularDTE } from './cajero/dteService'
import NotaCreditoModal from './cajero/NotaCreditoModal'

// ──────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────
const TIPO_INFO = {
  mesa:            { icon: '🪑', label: 'Mesas',       color: '#2dd4a8' },
  para_llevar:     { icon: '🥡', label: 'Para Llevar', color: '#f4a261' },
  delivery_propio: { icon: '🛵', label: 'Delivery',    color: '#60a5fa' },
  pedidos_ya:      { icon: '📱', label: 'PedidosYa',   color: '#a78bfa' },
  drive_through:   { icon: '🚗', label: 'Drive Thru',  color: '#fbbf24' },
}

const DTE_DISPLAY = {
  '01': { icon: '📄', label: 'Factura' },
  '03': { icon: '🏢', label: 'CCF' },
  '14': { icon: '👤', label: 'Suj.Excl.' },
  null: { icon: '🧾', label: 'Ticket' },
}

// Reloj
function Clock() {
  const [t, setT] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date(Date.now() - 6 * 3600 * 1000)
      setT(now.toISOString().split('T')[1].slice(0, 8))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="pos-header-clock">{t}</span>
}

// Formato de hora
function formatTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toISOString().split('T')[1].slice(0, 5)
}

// ──────────────────────────────────────────────
// Componente Principal
// ──────────────────────────────────────────────
export default function HistorialCobros({ user, onBack }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  const [cuentas, setCuentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [ncCuenta, setNcCuenta] = useState(null)
  const [filtroFecha, setFiltroFecha] = useState('hoy') // 'hoy' | 'ayer' | 'custom'
  const [fechaCustom, setFechaCustom] = useState('')

  // Obtener hoy en zona horaria El Salvador
  const getToday = useCallback(() => {
    const now = new Date(Date.now() - 6 * 3600 * 1000)
    return now.toISOString().split('T')[0]
  }, [])

  // ── Cargar cobrados por fecha ──
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const todayStr = getToday()
      let fechaInicio, fechaFin

      if (filtroFecha === 'hoy') {
        fechaInicio = `${todayStr}T00:00:00-06:00`
        fechaFin = `${todayStr}T23:59:59-06:00`
      } else if (filtroFecha === 'ayer') {
        const ayer = new Date(Date.now() - 6 * 3600 * 1000)
        ayer.setDate(ayer.getDate() - 1)
        const ayerStr = ayer.toISOString().split('T')[0]
        fechaInicio = `${ayerStr}T00:00:00-06:00`
        fechaFin = `${ayerStr}T23:59:59-06:00`
      } else if (filtroFecha === 'custom' && fechaCustom) {
        fechaInicio = `${fechaCustom}T00:00:00-06:00`
        fechaFin = `${fechaCustom}T23:59:59-06:00`
      } else {
        fechaInicio = `${todayStr}T00:00:00-06:00`
        fechaFin = `${todayStr}T23:59:59-06:00`
      }

      const { data: cuentasData, error } = await db
        .from('pos_cuentas')
        .select(`
          id,
          tipo,
          mesa_ref,
          total,
          subtotal,
          propina,
          cobrada_at,
          dte_tipo,
          dte_uuid,
          dte_numero_control,
          dte_sello,
          cliente_id,
          nc_codigo_generacion,
          nc_emitida_at,
          pos_cuenta_items!pos_cuenta_items_cuenta_id_fkey (
            id,
            nombre,
            precio_unitario,
            cantidad,
            notas,
            menu_item_id
          )
        `)
        .eq('store_code', storeCode)
        .eq('estado', 'cobrada')
        .gte('cobrada_at', fechaInicio)
        .lte('cobrada_at', fechaFin)
        .order('cobrada_at', { ascending: false })

      if (error) throw error
      setCuentas(cuentasData || [])
    } catch (err) {
      console.error('Error cargando historial:', err)
      alert('Error al cargar historial: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [storeCode, getToday, filtroFecha, fechaCustom])

  useEffect(() => { load() }, [load, refreshKey])

  // Realtime: actualizar cuando haya nuevas cobradas
  useEffect(() => {
    const sub = db.channel('historial_cobros_rt')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pos_cuentas',
        filter: `store_code=eq.${storeCode}`,
      }, () => setRefreshKey(k => k + 1))
      .subscribe()
    return () => db.removeChannel(sub)
  }, [storeCode])

  // ── REIMPRIMIR TICKET ──
  const handleReimprimir = (cuenta) => {
    const tipoInfo = TIPO_INFO[cuenta.tipo] || TIPO_INFO['para_llevar']
    const storeName_ = storeName
    const tipoStr = tipoInfo.label
    const mesaStr = cuenta.mesa_ref ? `Mesa #${cuenta.mesa_ref}` : tipoStr
    const hora = formatTime(cuenta.cobrada_at)

    const items = cuenta.pos_cuenta_items || []
    const rows = items
      .map(i =>
        `<tr>
          <td>${i.cantidad}x</td>
          <td>${i.nombre}${i.notas ? ` <span style="color:#888;font-size:11px">(${i.notas})</span>` : ''}</td>
          <td style="text-align:right">$${(parseFloat(i.precio_unitario) * i.cantidad).toFixed(2)}</td>
        </tr>`
      )
      .join('')

    // DTE info
    const dteDisplay = DTE_DISPLAY[cuenta.dte_tipo] || DTE_DISPLAY[null]
    const dteInfoStr = cuenta.dte_numero_control
      ? `${dteDisplay.icon} ${dteDisplay.label} #${cuenta.dte_numero_control}`
      : `${dteDisplay.icon} ${dteDisplay.label}`

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Ticket</title>
    <style>
      body { font-family: monospace; font-size: 13px; margin: 20px; max-width: 320px; }
      h2 { text-align: center; margin: 0; font-size: 16px; }
      .sub { text-align: center; color: #555; font-size: 11px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin: 10px 0; }
      td { padding: 3px 2px; vertical-align: top; }
      .total-row { border-top: 1px dashed #333; padding-top: 8px;
               display:flex; justify-content:space-between; font-weight:bold; font-size:15px; margin: 8px 0; }
      .propina-row { display:flex; justify-content:space-between; font-size:13px; color:#666; }
      .dte-info { text-align:center; color:#555; font-size:11px; margin-top:14px; padding:8px 0;
                 border-top:1px dashed #999; border-bottom:1px dashed #999; }
      .aviso { text-align:center; color:#888; font-size:10px; margin-top:14px; }
      hr { border: none; border-top: 1px dashed #999; }
    </style></head><body>
    <h2>🍔 FREAKIE DOGS</h2>
    <p class="sub">${storeName_} · ${mesaStr}<br>${hora}</p>
    <hr>
    <table>${rows}</table>
    <hr>
    <div class="total-row"><span>SUBTOTAL</span><span>$${parseFloat(cuenta.subtotal || 0).toFixed(2)}</span></div>
    ${cuenta.propina ? `<div class="propina-row"><span>PROPINA</span><span>$${parseFloat(cuenta.propina).toFixed(2)}</span></div>` : ''}
    <div class="total-row"><span>TOTAL</span><span>$${parseFloat(cuenta.total || 0).toFixed(2)}</span></div>
    <div class="dte-info">${dteInfoStr}</div>
    <p class="aviso">— TICKET REIMPRESO —</p>
    <script>window.onload=()=>{window.print();}</script>
    </body></html>`

    const w = window.open('', '_blank', 'width=400,height=600')
    w.document.write(html)
    w.document.close()
  }

  const [anulando, setAnulando] = useState(null) // id de la cuenta en proceso

  // ── ANULAR DTE ──
  const handleAnularDTE = async (cuenta) => {
    if (!cuenta.dte_uuid) {
      alert('Esta cuenta no tiene código de generación DTE')
      return
    }

    // Check if invoice is older than 72h
    const horasDesde = (Date.now() - new Date(cuenta.cobrada_at).getTime()) / 3600000
    if (horasDesde > 72) {
      alert('⚠️ Esta factura tiene más de 72 horas. La anulación puede ser rechazada por Hacienda.')
      return
    }

    // Pedir motivo
    const motivo = prompt(
      '¿Motivo de anulación?\n\n' +
      'Ej: "Error en datos del cliente", "Venta cancelada", "Duplicado"\n\n' +
      '(Cancelar para no anular)'
    )
    if (!motivo || motivo.trim().length < 5) {
      if (motivo !== null) alert('El motivo debe tener al menos 5 caracteres')
      return
    }

    // Confirmar
    const dteLabel = cuenta.dte_tipo === '03' ? 'CCF' : 'Factura'
    if (!confirm(
      `⚠️ ¿Estás seguro de ANULAR este ${dteLabel}?\n\n` +
      `Control: ${cuenta.dte_numero_control}\n` +
      `Total: $${parseFloat(cuenta.total || 0).toFixed(2)}\n` +
      `Motivo: ${motivo}\n\n` +
      `Esta acción es IRREVERSIBLE ante Hacienda.`
    )) return

    setAnulando(cuenta.id)
    try {
      const result = await anularDTE({
        codigoGeneracion: cuenta.dte_uuid,
        motivo: motivo.trim(),
        tipoAnulacion: 2, // Rescindir operación
      })

      // Actualizar pos_cuentas para marcar como anulada
      await db
        .from('pos_cuentas')
        .update({
          dte_sello: `ANULADO|${result.selloRecibido || ''}`,
        })
        .eq('id', cuenta.id)

      alert(
        `✅ DTE Anulado exitosamente\n\n` +
        `Sello: ${result.selloRecibido || 'N/A'}\n` +
        `El documento ha sido invalidado ante Hacienda.`
      )

      // Refrescar lista
      setRefreshKey(k => k + 1)
    } catch (err) {
      console.error('Error anulando DTE:', err)
      alert(`❌ Error al anular DTE:\n\n${err.message}`)
    } finally {
      setAnulando(null)
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#141418', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="spin" />
        <span style={{ color: '#8b8997', fontSize: 14 }}>Cargando historial...</span>
      </div>
    )
  }

  return (
    <div className="historial-cobros-root">

      {/* ── HEADER ── */}
      <header className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
        <img src="/icon-192.png" className="pos-header-logo" alt="Freakie Dogs" />
        <span className="pos-header-brand">Freakie POS</span>
        <span className="pos-header-store">{storeName}</span>
        <span
          className="pos-header-btn"
          style={{ background: '#2dd4a818', borderColor: '#2dd4a8', color: '#2dd4a8', cursor: 'default' }}
        >
          📋 Historial de Cobros
        </span>
        <span className="pos-header-sep" />
        <span className="pos-header-user">{user.nombre?.split(' ')[0]}</span>
        <Clock />
        <button className="pos-header-btn danger" onClick={onBack}>Salir</button>
      </header>

      {/* ── FILTRO DE FECHA ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', background: '#1a1a20',
        borderBottom: '1px solid #2a2a32',
        flexWrap: 'wrap'
      }}>
        {['hoy', 'ayer', 'custom'].map(f => (
          <button
            key={f}
            onClick={() => setFiltroFecha(f)}
            style={{
              padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              border: '1px solid ' + (filtroFecha === f ? '#e63946' : '#333'),
              background: filtroFecha === f ? '#e63946' : '#1e1e24',
              color: filtroFecha === f ? '#fff' : '#8b8997',
              cursor: 'pointer',
            }}
          >
            {f === 'hoy' ? '📅 Hoy' : f === 'ayer' ? '⏪ Ayer' : '📆 Elegir fecha'}
          </button>
        ))}
        {filtroFecha === 'custom' && (
          <input
            type="date"
            value={fechaCustom}
            onChange={e => setFechaCustom(e.target.value)}
            max={getToday()}
            style={{
              background: '#1e1e24', border: '1px solid #333', borderRadius: 8,
              color: '#f0f0f0', padding: '6px 12px', fontSize: 13,
            }}
          />
        )}
      </div>

      {/* ── CUERPO ── */}
      <div className="historial-cobros-body">

        {cuentas.length === 0 ? (
          <div className="historial-empty">
            <div style={{ fontSize: 48 }}>📋</div>
            <div style={{ color: '#8b8997', fontSize: 14, marginTop: 8 }}>
              {filtroFecha === 'hoy' ? 'Sin cobros hoy' : filtroFecha === 'ayer' ? 'Sin cobros ayer' : 'Sin cobros en esta fecha'}
            </div>
            <div style={{ color: '#6b6878', fontSize: 12 }}>Los tickets aparecerán aquí una vez cobrados</div>
          </div>
        ) : (
          <div className="historial-cuentas-list">
            <div className="historial-count">
              {cuentas.length} cobro{cuentas.length !== 1 ? 's' : ''} {filtroFecha === 'hoy' ? 'hoy' : filtroFecha === 'ayer' ? 'ayer' : fechaCustom}
            </div>

            {cuentas.map((cuenta) => {
              const tipoInfo = TIPO_INFO[cuenta.tipo] || TIPO_INFO['para_llevar']
              const dteDisplay = DTE_DISPLAY[cuenta.dte_tipo] || DTE_DISPLAY[null]
              const items = cuenta.pos_cuenta_items || []
              const isExpanded = expandedId === cuenta.id

              return (
                <div key={cuenta.id} className="historial-ticket-card">

                  {/* Header de ticket */}
                  <div
                    className="historial-ticket-header"
                    onClick={() => setExpandedId(isExpanded ? null : cuenta.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="historial-ticket-tipo">
                      <span style={{ fontSize: 18 }}>{tipoInfo.icon}</span>
                      <span style={{ color: tipoInfo.color, fontWeight: 600 }}>
                        {tipoInfo.label}
                        {cuenta.mesa_ref && ` #${cuenta.mesa_ref}`}
                      </span>
                    </div>

                    <div className="historial-ticket-meta">
                      <span className="historial-ticket-time">{formatTime(cuenta.cobrada_at)}</span>
                      <span className="historial-ticket-dte" style={{ color: '#8b8997' }}>
                        {dteDisplay.icon} {dteDisplay.label}
                        {cuenta.dte_numero_control && ` #${cuenta.dte_numero_control}`}
                      </span>
                    </div>

                    <div className="historial-ticket-total" style={{ color: '#2dd4a8', fontWeight: 700, fontSize: 16 }}>
                      ${parseFloat(cuenta.total || 0).toFixed(2)}
                      {cuenta.nc_codigo_generacion && (
                        <div style={{ fontSize: 9, color: '#f87171', fontWeight: 600, marginTop: 2 }}>📋 NC emitida</div>
                      )}
                    </div>

                    <span style={{ color: '#8b8997', fontSize: 12, marginLeft: 8 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>

                  {/* Detalles (items) — expandible */}
                  {isExpanded && (
                    <>
                      <div className="historial-ticket-items">
                        {items.length === 0 ? (
                          <div style={{ color: '#8b8997', fontSize: 12, padding: 8 }}>Sin ítems registrados</div>
                        ) : (
                          <table className="historial-items-table">
                            <tbody>
                              {items.map((item) => (
                                <tr key={item.id} className="historial-item-row">
                                  <td className="historial-item-qty">{item.cantidad}x</td>
                                  <td className="historial-item-name">
                                    {item.nombre}
                                    {item.notas && <div className="historial-item-notas">📝 {item.notas}</div>}
                                  </td>
                                  <td className="historial-item-price">
                                    ${(parseFloat(item.precio_unitario) * item.cantidad).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      {/* Totales */}
                      <div className="historial-ticket-totals">
                        <div className="historial-total-row">
                          <span>Subtotal:</span>
                          <span>${parseFloat(cuenta.subtotal || 0).toFixed(2)}</span>
                        </div>
                        {cuenta.propina > 0 && (
                          <div className="historial-total-row">
                            <span>Propina:</span>
                            <span>${parseFloat(cuenta.propina).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="historial-total-row" style={{ fontSize: 14, fontWeight: 700, color: '#2dd4a8', borderTop: '1px solid #2a2a32', paddingTop: 6 }}>
                          <span>Total:</span>
                          <span>${parseFloat(cuenta.total || 0).toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Botones de acción */}
                      <div className="historial-ticket-actions">
                        <button
                          className="historial-action-btn reimprimir"
                          onClick={() => handleReimprimir(cuenta)}
                          title="Reimprimir ticket"
                        >
                          🖨 Reimprimir
                        </button>
                        {cuenta.dte_uuid && (cuenta.dte_tipo === '01' || cuenta.dte_tipo === '03') && !cuenta.nc_codigo_generacion && (
                          <button
                            className="historial-action-btn"
                            onClick={() => setNcCuenta(cuenta)}
                            title="Emitir Nota de Crédito contra este DTE"
                            style={{ background: '#7f1d1d', borderColor: '#be123c' }}
                          >
                            📋 NC
                          </button>
                        )}
                        {cuenta.nc_codigo_generacion && (
                          <span style={{ fontSize: 11, color: '#f87171', padding: '4px 8px', background: '#1a0a0a', borderRadius: 4, border: '1px solid #7f1d1d' }}>
                            📋 NC: {cuenta.nc_codigo_generacion.slice(0, 8)}...
                          </span>
                        )}
                        <button
                          className="historial-action-btn anular"
                          onClick={() => handleAnularDTE(cuenta)}
                          disabled={!cuenta.dte_uuid || anulando === cuenta.id || cuenta.dte_sello?.startsWith('ANULADO') || (Date.now() - new Date(cuenta.cobrada_at).getTime()) / 3600000 > 72}
                          title={
                            cuenta.dte_sello?.startsWith('ANULADO') ? 'DTE ya anulado' :
                            (Date.now() - new Date(cuenta.cobrada_at).getTime()) / 3600000 > 72 ? '⚠️ Factura > 72 horas (puede ser rechazada)' :
                            !cuenta.dte_uuid ? 'Solo para documentos fiscales' :
                            anulando === cuenta.id ? 'Anulando...' : 'Anular DTE ante Hacienda'
                          }
                        >
                          {cuenta.dte_sello?.startsWith('ANULADO') ? '✅ Anulado' :
                           anulando === cuenta.id ? '⏳ Anulando...' : '🚫 Anular DTE'}
                        </button>
                      </div>
                    </>
                  )}

                </div>
              )
            })}

          </div>
        )}

      </div>

      {/* ── Nota de Crédito Modal ── */}
      {ncCuenta && <NotaCreditoModal cuenta={ncCuenta} onClose={() => { setNcCuenta(null); load() }} onSuccess={() => { /* no cerrar — el usuario ve resultado y da click en Cerrar */ }} />}

    </div>
  )
}
