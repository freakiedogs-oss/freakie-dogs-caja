/**
 * DevolucionModal.jsx — Devolución de una venta YA COBRADA Y FACTURADA
 *
 * Regla de negocio (Jose, 07-sep-2026): cuando el cliente devuelve algo ya
 * facturado hay que INVALIDAR el DTE y EMITIR UNO NUEVO por lo que sí se llevó.
 *
 * Antes esto se hacía anulando el ítem con `doDeleteItem` desde la orden, que
 * bajaba el total de la cuenta y dejaba el pago y el DTE intactos: la factura
 * seguía viva en Hacienda por el monto viejo. 8 casos entre jul y sep-2026,
 * $23.87 declarados de más (auditoría del 05-sep). `doDeleteItem` ya no deja
 * tocar una cuenta cobrada y manda acá.
 *
 * Orden de las operaciones, a propósito:
 *   1. Invalidar el DTE viejo   ← primero, para no tener nunca dos vivos a la vez
 *   2. Emitir el nuevo (si queda algo que facturar)
 *   3. Recién ahí tocar la base
 * Si (2) falla, la cuenta queda marcada en `notas_internas` y se avisa fuerte:
 * la venta existe y quedó sin factura, hay que reintentar. Es el fallo menos
 * malo — el otro orden dejaría dos documentos vivos, que es lo que se acaba de
 * limpiar de toda la cadena.
 */
import { useState, useMemo } from 'react'
import { db } from '../../supabase'
import { useToast } from '../../hooks/useToast'
import { anularDTE, emitDTE } from './dteService'
import { printFactura } from '../print/printService'
import Icon from '../Icon'

const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)

// Precio realmente cobrado de la línea: base + modificadores + extras.
const precioLinea = (i) =>
  (parseFloat(i.precio_unitario) || 0) +
  (parseFloat(i.precio_modificadores) || 0) +
  (parseFloat(i.precio_extras) || 0)

const DTE_TIPO_A_EMIT = { '01': 'factura', '03': 'ccf', '14': 'se' }

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 14, overflowY: 'auto' },
  modal: { background: '#1c1c22', border: '1px solid #33333d', borderRadius: 14, width: '100%', maxWidth: 520, padding: 18, maxHeight: '92vh', overflowY: 'auto' },
  label: { fontSize: 10, color: '#8b8b96', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4, display: 'block' },
  input: { background: '#26262e', color: '#fff', border: '1px solid #33333d', borderRadius: 8, padding: '9px 11px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  fila: (sel) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, marginBottom: 6, cursor: 'pointer', background: sel ? '#3a1a1a' : '#26262e', border: `1px solid ${sel ? '#e5484d' : '#33333d'}` }),
  btn: (bg, off) => ({ background: off ? '#333' : bg, color: '#fff', border: 'none', borderRadius: 9, padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: off ? 'not-allowed' : 'pointer', opacity: off ? .6 : 1, flex: 1 }),
}

export default function DevolucionModal({ cuenta, user, storeCode, storeName, onClose, onListo }) {
  const toast = useToast()
  const vivos = useMemo(
    () => (cuenta.pos_cuenta_items || []).filter(i => !i.cancelado_motivo),
    [cuenta]
  )
  const [sel, setSel] = useState(() => new Set())
  const [motivo, setMotivo] = useState('')
  const [proc, setProc] = useState(false)
  const [paso, setPaso] = useState('')
  const [ok, setOk] = useState(null)

  const toggle = (id) => setSel(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const devueltos = vivos.filter(i => sel.has(i.id))
  const quedan    = vivos.filter(i => !sel.has(i.id))
  const montoDevuelto = devueltos.reduce((a, i) => a + precioLinea(i) * (i.cantidad || 1), 0)
  const propina = parseFloat(cuenta.propina) || 0
  // Devolución total: se va también la propina. Parcial: la propina se respeta.
  const esTotal = quedan.length === 0
  const nuevoSubtotal = quedan.reduce((a, i) => a + precioLinea(i) * (i.cantidad || 1), 0)
  const nuevoTotal = esTotal ? 0 : Math.round((nuevoSubtotal + propina) * 100) / 100
  const aDevolver = Math.round(((parseFloat(cuenta.total) || 0) - nuevoTotal) * 100) / 100

  // Solo los pagos vigentes: si esta cuenta ya tuvo una devolución antes, los
  // anteriores quedaron marcados `anulado` y no representan lo que hay en caja.
  const pagos = (cuenta.pos_cuenta_pagos || []).filter(p => !p.anulado)
  const metodoOriginal = pagos.length === 0 ? 'efectivo' : pagos.length > 1 ? 'mixto' : pagos[0].metodo
  const tipoEmit = DTE_TIPO_A_EMIT[cuenta.dte_tipo] || null

  const puede = !proc && devueltos.length > 0 && motivo.trim().length >= 5

  const confirmar = async () => {
    if (!puede) return
    if (!window.confirm(
      `¿Devolver ${devueltos.length} ítem(s) por ${money(montoDevuelto)}?\n\n` +
      `Se INVALIDA la factura ${cuenta.dte_numero_control}` +
      (esTotal ? ' y no se emite ninguna nueva (se devuelve todo).' : `\ny se emite una NUEVA por ${money(nuevoTotal)}.`) +
      `\n\nDevolvé ${money(aDevolver)} al cliente en ${metodoOriginal}.` +
      `\n\nLa invalidación es IRREVERSIBLE ante Hacienda.`
    )) return

    setProc(true)
    let nuevoDte = null
    try {
      // 1. Invalidar el DTE original
      setPaso('Invalidando la factura original…')
      const motivoInval =
        `Devolucion de producto. ${motivo.trim()}. ` +
        (esTotal ? 'Se devolvio la venta completa.' : `Se reemitio por ${money(nuevoTotal)}.`)
      await anularDTE({ codigoGeneracion: cuenta.dte_uuid, motivo: motivoInval, tipoAnulacion: 2 })

      // 2. Emitir el DTE nuevo por lo que el cliente sí se llevó
      if (!esTotal && tipoEmit) {
        setPaso('Emitiendo la factura nueva…')
        try {
          nuevoDte = await emitDTE({
            tipoDte: tipoEmit,
            items: quedan.map(i => ({ nombre: i.nombre, precio: precioLinea(i), qty: i.cantidad || 1 })),
            receptor: null,
            metodo: metodoOriginal,
            storeCode,
            propina,
          })
        } catch (eEmit) {
          // La invalidación YA pasó: la venta quedó sin factura. Se marca para
          // que no se pierda y se avisa sin ambigüedad.
          await db.from('pos_cuentas').update({
            notas_internas: `DTE_PENDIENTE_REEMISION tras devolucion ${new Date().toISOString()}: ${eEmit.message}`,
          }).eq('id', cuenta.id)
          throw new Error(
            'Se invalidó la factura vieja pero NO se pudo emitir la nueva: ' + eEmit.message +
            ' — la venta quedó SIN factura. Avisá a soporte para reemitirla.'
          )
        }
      }

      // 3. Base de datos
      setPaso('Actualizando la cuenta…')
      const ahora = new Date().toISOString()

      await db.from('pos_cuenta_items').update({
        cancelado_motivo: `Devuelto (${user?.nombre || 'POS'}): ${motivo.trim()}`,
        cancelado_por: user?.id || null,
      }).in('id', devueltos.map(i => i.id))

      await db.from('pos_cuentas').update({
        subtotal: nuevoSubtotal,
        total: nuevoTotal,
        propina: esTotal ? 0 : propina,
        estado: esTotal ? 'cancelada' : 'cobrada',
        ...(esTotal ? { cancelada_motivo: `Devolución total: ${motivo.trim()}`, cancelada_por: user?.id || null } : {}),
        dte_uuid: nuevoDte?.codigo_generacion || null,
        dte_numero_control: nuevoDte?.numero_control || null,
        dte_sello: nuevoDte?.sello_recepcion || null,
        updated_at: ahora,
      }).eq('id', cuenta.id)

      // Pagos: se anulan los vigentes y se deja uno solo por el neto que quedó
      // en caja, para que el corte del turno cuadre sin tocar nada a mano.
      // Límite conocido: `pos_corte` agrupa los pagos por la fecha de la CUENTA,
      // así que si se devuelve hoy una venta de ayer el corte de ayer queda bien
      // pero la gaveta de hoy sale con menos plata de la que el corte espera. Para
      // ese caso (poco común) hay que registrar la salida como egreso del turno.
      await db.from('pos_cuenta_pagos').update({
        anulado: true,
        anulado_motivo: `Devolución de producto (${user?.nombre || 'POS'}): ${motivo.trim()}`,
        anulado_at: ahora,
        anulado_por: user?.nombre || 'POS',
      }).eq('cuenta_id', cuenta.id).eq('anulado', false)

      if (nuevoTotal > 0) {
        await db.from('pos_cuenta_pagos').insert({
          cuenta_id: cuenta.id,
          metodo: metodoOriginal === 'mixto' ? 'efectivo' : metodoOriginal,
          monto: nuevoTotal,
          monto_recibido: null,
          cambio: 0,
          referencia: 'Reemitido tras devolución',
        })
      }

      try {
        await db.from('pos_operaciones_log').insert({
          sucursal_id: cuenta.sucursal_id || null,
          operacion: 'devolucion_con_reemision',
          cuenta_id: cuenta.id,
          motivo: motivo.trim(),
          usuario_id: user?.id || null,
          detalle: {
            dte_invalidado: cuenta.dte_numero_control,
            dte_nuevo: nuevoDte?.numero_control || null,
            items_devueltos: devueltos.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, precio: precioLinea(i) })),
            monto_devuelto: aDevolver,
            total_anterior: parseFloat(cuenta.total) || 0,
            total_nuevo: nuevoTotal,
          },
        })
      } catch { /* el log no bloquea la devolución */ }

      // 4. Ticket nuevo
      if (!esTotal) {
        setPaso('Imprimiendo el ticket nuevo…')
        try {
          await printFactura({
            storeCode, storeName, caja: user?.caja || null,
            mesa: cuenta.mesa_ref || null,
            tipoLabel: 'DEVOLUCIÓN — TICKET CORREGIDO',
            cajero: user?.nombre || null,
            metodoPago: metodoOriginal,
            items: quedan.map(i => ({ qty: i.cantidad, nombre: i.nombre, precio: precioLinea(i), modificadores: [], nota: i.notas || null })),
            subtotal: nuevoSubtotal, propina, total: nuevoTotal,
            fecha: new Date(),
            dte: nuevoDte ? {
              tipo: cuenta.dte_tipo,
              label: cuenta.dte_tipo === '03' ? 'COMPROBANTE DE CRÉDITO FISCAL' : 'FACTURA ELECTRÓNICA',
              numeroControl: nuevoDte.numero_control,
              codigoGeneracion: nuevoDte.codigo_generacion,
              sello: nuevoDte.sello_recepcion,
              fecha: new Date(),
            } : null,
          })
        } catch { toast.error('La devolución quedó registrada, pero el ticket no se imprimió') }
      }

      setOk({ nuevoDte, aDevolver, esTotal })
      onListo?.()
    } catch (e) {
      toast.error(e.message || 'No se pudo completar la devolución')
    } finally {
      setProc(false); setPaso('')
    }
  }

  if (ok) {
    return (
      <div style={s.overlay} onClick={onClose}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 38 }}>✅</div>
            <div style={{ color: '#2dd4a8', fontWeight: 800, fontSize: 17, marginTop: 6 }}>Devolución registrada</div>
          </div>
          <div style={{ background: '#26262e', borderRadius: 10, padding: 12, fontSize: 12.5, color: '#fff', lineHeight: 2 }}>
            <div>Factura invalidada: <b>{cuenta.dte_numero_control}</b></div>
            {ok.nuevoDte
              ? <div>Factura nueva: <b>{ok.nuevoDte.numero_control}</b></div>
              : <div style={{ color: '#fbbf24' }}>Se devolvió todo: no se emitió factura nueva.</div>}
            <div style={{ marginTop: 6, fontSize: 15 }}>
              Devolvé al cliente: <b style={{ color: '#e5484d' }}>{money(ok.aDevolver)}</b> en {metodoOriginal}
            </div>
          </div>
          <button style={{ ...s.btn('#e5484d'), width: '100%', marginTop: 14 }} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay} onClick={proc ? undefined : onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#fff', flex: 1 }}>Devolver productos</div>
          {!proc && <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b8b96', fontSize: 22, cursor: 'pointer' }}>×</button>}
        </div>

        <div style={{ background: '#26262e', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: '#8b8b96', lineHeight: 1.7 }}>
          <div><b style={{ color: '#fff' }}>{cuenta.dte_numero_control || 'Sin DTE'}</b></div>
          <div>Cobrada {money(cuenta.total)} · {metodoOriginal}</div>
        </div>

        <div style={{ background: '#2a1f05', border: '1px solid #fbbf24', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 11, color: '#fbbf24', lineHeight: 1.6 }}>
          Se <b>invalida</b> la factura actual en Hacienda y se emite una <b>nueva</b> por lo
          que el cliente sí se lleva. Es irreversible.
        </div>

        <div style={s.label}>¿Qué devuelve el cliente?</div>
        {vivos.map(i => (
          <div key={i.id} style={s.fila(sel.has(i.id))} onClick={() => !proc && toggle(i.id)}>
            <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${sel.has(i.id) ? '#e5484d' : '#55555f'}`, background: sel.has(i.id) ? '#e5484d' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {sel.has(i.id) && <Icon name="check" size={12} color="#fff" />}
            </div>
            <div style={{ flex: 1, fontSize: 13, color: '#fff' }}>
              {i.cantidad > 1 && <b>{i.cantidad}× </b>}{i.nombre}
            </div>
            <div style={{ fontSize: 13, color: '#8b8b96' }}>{money(precioLinea(i) * (i.cantidad || 1))}</div>
          </div>
        ))}

        {devueltos.length > 0 && (
          <div style={{ background: '#26262e', borderRadius: 9, padding: 11, marginTop: 10, fontSize: 13, color: '#fff', lineHeight: 1.9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b8b96' }}>Se devuelve</span><b style={{ color: '#e5484d' }}>{money(aDevolver)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b8b96' }}>Factura nueva por</span><b>{esTotal ? '— (devolución total)' : money(nuevoTotal)}</b></div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div style={s.label}>Motivo (mínimo 5 caracteres)</div>
          <input style={s.input} value={motivo} onChange={e => setMotivo(e.target.value)} disabled={proc}
            placeholder="Ej: el cliente no quiso la bebida" />
        </div>

        {paso && <div style={{ marginTop: 10, fontSize: 12, color: '#fbbf24' }}>⏳ {paso}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {!proc && <button style={{ ...s.btn('#33333d') }} onClick={onClose}>Cancelar</button>}
          <button style={s.btn('#e5484d', !puede)} disabled={!puede} onClick={confirmar}>
            {proc ? 'Procesando…' : `Devolver ${money(aDevolver)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
