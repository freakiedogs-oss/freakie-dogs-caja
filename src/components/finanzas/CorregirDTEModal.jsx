import { useState, useEffect } from 'react'
import { dbFin } from '../../supabaseFinanzas'
import { paletaC as C } from '@/theme'
import { db } from '../../supabase'
import { emitirNotaCredito, invalidarDTE, totalConIva } from './dteErpService'

/**
 * CorregirDTEModal — las dos formas de corregir un documento ya sellado.
 *
 *   • Nota de Crédito (tipo 05): acredita parte o todo de un CCF. El documento
 *     original sigue existiendo; la NC lo compensa. Es lo correcto cuando hubo
 *     una devolución o se cobró de más.
 *   • Invalidación: le pide a Hacienda anular el documento. Es irreversible y
 *     es la única salida para una Factura de consumidor final, porque MH no
 *     acepta NC sobre tipo 01.
 *
 * Por eso el modal elige la acción según el tipo del DTE en vez de ofrecer las
 * dos siempre: ofrecer una NC sobre una factura sería mandar al usuario a un
 * rechazo seguro.
 */

const MOTIVOS_ANULACION = [
  { valor: 2, nombre: 'Rescindir la operación (no hubo venta)' },
  { valor: 1, nombre: 'Error en la emisión (se reemplaza por otro documento)' },
  { valor: 3, nombre: 'Otro' },
]

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' },
  modal: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth: 560, padding: 18, marginTop: 20, marginBottom: 40 },
  label: { fontSize: 10, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' },
  input: { background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  btn: (bg, disabled) => ({ background: disabled ? '#333' : bg, color: C.white, border: 'none', borderRadius: 9, padding: '11px 16px', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }),
  chip: (activo) => ({ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: activo ? C.red : 'transparent', color: activo ? C.white : C.textMuted, border: `1px solid ${activo ? C.red : C.border}` }),
}

export default function CorregirDTEModal({ dte, onClose, onListo }) {
  // Una NC sobre Factura (01) la rechaza Hacienda, así que para esas el modal
  // abre directamente en invalidación.
  const ncPosible = dte.tipo_dte === '03'
  const [accion, setAccion] = useState(ncPosible ? 'nc' : 'anular')
  const [detalle, setDetalle] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [items, setItems] = useState([])
  const [cliente, setCliente] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [tipoAnulacion, setTipoAnulacion] = useState(2)
  const [pin, setPin] = useState('')
  const [procesando, setProc] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data, error: e } = await dbFin.rpc('dte_emitido_detalle', { p_codigo_generacion: dte.codigo_generacion })
        if (e) throw e
        if (!vivo) return
        setDetalle(data)
        // Los ítems del DTE guardan el precio SIN IVA cuando es CCF. Acá se
        // trabaja siempre con precio CON IVA, que es la convención de toda la
        // pantalla, y el servicio hace la conversión de vuelta al emitir.
        const cuerpo = Array.isArray(data?.items) ? data.items : []
        setItems(cuerpo.map(it => ({
          descripcion: it.descripcion || 'Ítem',
          codigo: it.codigo || null,
          cantidadOriginal: Number(it.cantidad) || 0,
          cantidad: Number(it.cantidad) || 0,
          precio: Math.round((Number(it.precioUni) || 0) * 1.13 * 100) / 100,
          incluir: true,
        })))
        // El receptor del DTE original es el que tiene que ir en la NC.
        if (dte.receptor_nit) {
          const { data: cli } = await db.from('pos_clientes')
            .select('id,nombre,nombre_comercial,tipo_documento,numero_documento,nrc,giro,codigo_actividad,email,telefono,direccion,departamento,municipio')
            .eq('numero_documento', String(dte.receptor_nit).replace(/[-\s]/g, ''))
            .limit(1).maybeSingle()
          if (vivo && cli) setCliente(cli)
        }
      } catch (e) {
        if (vivo) setError('No se pudo cargar el detalle del DTE: ' + e.message)
      } finally { if (vivo) setCargando(false) }
    })()
    return () => { vivo = false }
  }, [dte.codigo_generacion, dte.receptor_nit])

  const seleccionados = items.filter(it => it.incluir && Number(it.cantidad) > 0)
  const totalNC = totalConIva(seleccionados)

  const setItem = (i, campo, val) => setItems(prev => prev.map((it, j) => j === i ? { ...it, [campo]: val } : it))

  const puedeNC = !procesando && seleccionados.length > 0 && totalNC > 0 && pin.trim().length >= 4
    && cliente && motivo.trim().length > 0
  const puedeAnular = !procesando && motivo.trim().length >= 5 && pin.trim().length >= 4

  const hacerNC = async () => {
    setError(null); setProc(true)
    try {
      const res = await emitirNotaCredito({
        dte, cliente, pin,
        items: seleccionados.map(it => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio: Number(it.precio), codigo: it.codigo })),
      })
      setOk({ tipo: 'nc', res })
      onListo?.()
    } catch (e) { setError(e.message) } finally { setProc(false) }
  }

  const hacerAnular = async () => {
    setError(null); setProc(true)
    try {
      const res = await invalidarDTE({ codigoGeneracion: dte.codigo_generacion, motivo, tipoAnulacion, pin })
      setOk({ tipo: 'anular', res })
      onListo?.()
    } catch (e) { setError(e.message) } finally { setProc(false) }
  }

  if (ok) {
    return (
      <div style={s.overlay} onClick={onClose}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 38 }}>✅</div>
            <div style={{ color: C.greenLight, fontWeight: 800, fontSize: 17, marginTop: 6 }}>
              {ok.tipo === 'nc' ? 'Nota de Crédito emitida' : 'Documento invalidado'}
            </div>
          </div>
          <div style={{ background: C.cardAlt, borderRadius: 10, padding: 12, fontSize: 12, color: C.white, lineHeight: 1.9 }}>
            {ok.res?.numero_control && <div><span style={{ color: C.textMuted }}>Nº Control:</span> <b>{ok.res.numero_control}</b></div>}
            <div><span style={{ color: C.textMuted }}>Estado:</span> <b>{ok.res?.estado || 'procesado'}</b></div>
            {ok.res?.codigo_generacion && (
              <div style={{ wordBreak: 'break-all' }}>
                <span style={{ color: C.textMuted }}>Código:</span>{' '}
                <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{ok.res.codigo_generacion}</span>
              </div>
            )}
            {ok.tipo === 'nc' && <div><span style={{ color: C.textMuted }}>Monto acreditado:</span> <b>${totalNC.toFixed(2)}</b></div>}
          </div>
          <button style={{ ...s.btn(C.red), width: '100%', marginTop: 14 }} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: C.white, flex: 1 }}>Corregir documento</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* DTE original */}
        <div style={{ background: C.cardAlt, borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: C.textMuted, lineHeight: 1.7 }}>
          <div><b style={{ color: C.white }}>{dte.tipo_nombre}</b> · {dte.numero_control}</div>
          <div>{dte.receptor_nombre || 'Consumidor Final'} · {dte.fecha_emision}</div>
          <div>Total: <b style={{ color: C.white }}>${Number(dte.monto_total || 0).toFixed(2)}</b> · estado <b style={{ color: C.white }}>{dte.estado}</b></div>
        </div>

        {/* Selector de acción */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button style={s.chip(accion === 'nc')} disabled={!ncPosible}
            onClick={() => ncPosible && setAccion('nc')}
            title={ncPosible ? '' : 'Hacienda no acepta Nota de Crédito sobre Factura de consumidor final'}>
            📋 Nota de Crédito
          </button>
          <button style={s.chip(accion === 'anular')} onClick={() => setAccion('anular')}>🚫 Invalidar</button>
        </div>
        {!ncPosible && (
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>
            Este documento es {dte.tipo_nombre}: Hacienda solo acepta Nota de Crédito sobre CCF, así que la
            única corrección posible es invalidarlo.
          </div>
        )}

        {cargando && <div style={{ color: C.textMuted, fontSize: 12, padding: '12px 0' }}>Cargando detalle…</div>}

        {/* ── Nota de Crédito ── */}
        {!cargando && accion === 'nc' && (
          <>
            {!cliente && (
              <div style={{ background: '#2a1a0a', border: '1px solid #7c5211', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 11, color: C.gold }}>
                No se encontró en el banco de clientes a <b>{dte.receptor_nombre}</b> (NIT {dte.receptor_nit || '—'}).
                La NC necesita los datos fiscales del receptor: creá o corregí ese cliente en la sección Clientes y volvé.
              </div>
            )}
            <label style={s.label}>Ítems a acreditar</label>
            <div style={{ background: C.cardAlt, borderRadius: 8, padding: 8, marginBottom: 10, maxHeight: 220, overflowY: 'auto' }}>
              {items.length === 0 && <div style={{ fontSize: 11, color: C.textMuted }}>El DTE no trae detalle de ítems.</div>}
              {items.map((it, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none', opacity: it.incluir ? 1 : 0.45 }}>
                  <input type="checkbox" checked={it.incluir} onChange={() => setItem(i, 'incluir', !it.incluir)} style={{ accentColor: C.red }} />
                  <span style={{ flex: 1, fontSize: 12, color: C.white }}>{it.descripcion}</span>
                  <input type="number" min="0" max={it.cantidadOriginal} step="any" value={it.cantidad}
                    disabled={!it.incluir} onChange={e => setItem(i, 'cantidad', Math.min(Number(e.target.value) || 0, it.cantidadOriginal))}
                    style={{ ...s.input, width: 54, padding: '4px 6px', textAlign: 'center' }} />
                  <span style={{ fontSize: 10, color: C.textMuted, minWidth: 26 }}>/{it.cantidadOriginal}</span>
                  <span style={{ fontSize: 12, color: C.greenLight, minWidth: 62, textAlign: 'right', fontFamily: 'monospace' }}>
                    ${(Number(it.precio) * Number(it.cantidad || 0)).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', background: '#1a0a0a', border: `1px solid ${C.red}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#fca5a5' }}>Total a acreditar</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#fca5a5', fontFamily: 'monospace' }}>${totalNC.toFixed(2)}</div>
            </div>
            <label style={s.label}>Motivo</label>
            <input style={s.input} placeholder="Ej: devolución de 2 combos del evento del 15-sep"
              value={motivo} onChange={e => setMotivo(e.target.value)} />
          </>
        )}

        {/* ── Invalidación ── */}
        {!cargando && accion === 'anular' && (
          <>
            <div style={{ background: '#2a0a0a', border: `1px solid ${C.red}`, borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 11, color: '#fca5a5' }}>
              La invalidación es <b>irreversible</b> y queda registrada en Hacienda. El documento no se puede reactivar.
            </div>
            <label style={s.label}>Tipo de anulación</label>
            <select style={{ ...s.input, marginBottom: 10 }} value={tipoAnulacion} onChange={e => setTipoAnulacion(Number(e.target.value))}>
              {MOTIVOS_ANULACION.map(m => <option key={m.valor} value={m.valor}>{m.nombre}</option>)}
            </select>
            {tipoAnulacion === 1 && (
              <div style={{ fontSize: 11, color: C.gold, marginBottom: 10 }}>
                Con "error en la emisión" Hacienda espera que exista un documento de reemplazo. Si todavía no
                lo emitiste, usá "rescindir la operación".
              </div>
            )}
            <label style={s.label}>Motivo (queda en el registro fiscal)</label>
            <input style={s.input} placeholder="Mínimo 5 caracteres" value={motivo} onChange={e => setMotivo(e.target.value)} />
          </>
        )}

        {/* PIN */}
        <label style={{ ...s.label, marginTop: 12 }}>Tu PIN — firma la operación</label>
        <input style={s.input} type="password" inputMode="numeric" autoComplete="off" placeholder="••••"
          value={pin} onChange={e => setPin(e.target.value)} />

        {error && (
          <div style={{ background: '#2a0a0a', border: `1px solid ${C.red}`, borderRadius: 8, padding: 10, marginTop: 10, fontSize: 12, color: '#fca5a5' }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {accion === 'nc' ? (
            <button style={{ ...s.btn('#7f1d1d', !puedeNC), flex: 1 }} disabled={!puedeNC} onClick={hacerNC}>
              {procesando ? '⏳ Emitiendo NC…' : `Emitir NC por $${totalNC.toFixed(2)}`}
            </button>
          ) : (
            <button style={{ ...s.btn('#7f1d1d', !puedeAnular), flex: 1 }} disabled={!puedeAnular} onClick={hacerAnular}>
              {procesando ? '⏳ Invalidando…' : 'Invalidar en Hacienda'}
            </button>
          )}
          <button style={{ ...s.btn('#333'), flex: '0 0 auto' }} onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
