import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'
import { STORE_ESTABLECIMIENTO } from '../../config'
import {
  TIPOS_EMISION, tipoPorId, FORMAS_PAGO, desglose, faltantesDeCliente, emitirDTE,
} from './dteErpService'

/**
 * EmitirDTEModal — emite un DTE desde el back-office.
 *
 * El caso que resuelve: facturar algo que no pasó por la caja (un evento, un
 * catering, una venta corporativa). Antes había que montarlo como venta del POS
 * o pedirle a la sucursal que lo cobrara.
 *
 * Tres guardarraíles, porque esto le manda un documento real a Hacienda:
 *   1. El PIN se pide acá y no se guarda: es la firma de quien emite.
 *   2. Antes de emitir se muestra el desglose exacto (gravado / IVA / total) y
 *      qué le falta al cliente para el tipo elegido.
 *   3. Si Hacienda rechaza, se muestra la observación textual de MH — no un
 *      "error al emitir" que obligue a reintentar a ciegas.
 */

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto',
  },
  modal: {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
    width: '100%', maxWidth: 620, padding: 18, marginTop: 20, marginBottom: 40,
  },
  label: { fontSize: 10, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' },
  input: {
    background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  row: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  btn: (bg, disabled) => ({
    background: disabled ? '#333' : bg, color: C.white, border: 'none', borderRadius: 9,
    padding: '11px 16px', fontSize: 13, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  }),
  chip: (activo) => ({
    padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    background: activo ? C.red : 'transparent', color: activo ? C.white : C.textMuted,
    border: `1px solid ${activo ? C.red : C.border}`,
  }),
}

const ITEM_VACIO = { descripcion: '', cantidad: 1, precio: '' }

export default function EmitirDTEModal({ user, onClose, onEmitido }) {
  const [tipoId, setTipoId]   = useState('factura')
  const [items, setItems]     = useState([{ ...ITEM_VACIO }])
  const [cliente, setCliente] = useState(null)
  const [busqueda, setBusqueda]     = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando]     = useState(false)
  const [formaPago, setFormaPago]   = useState('01')
  const [sucursales, setSucursales] = useState([])
  const [sucursalId, setSucursalId] = useState('')
  const [concepto, setConcepto]     = useState('')
  const [pin, setPin]         = useState('')
  const [emitiendo, setEmit]  = useState(false)
  const [error, setError]     = useState(null)
  const [ok, setOk]           = useState(null)

  const tipo = tipoPorId(tipoId)
  const d = useMemo(() => desglose(items, tipoId), [items, tipoId])
  const faltan = useMemo(() => faltantesDeCliente(cliente, tipoId), [cliente, tipoId])
  const necesitaCliente = tipo.requiere.length > 0

  // ── Buscador de clientes ──
  const buscar = useCallback(async () => {
    const q = busqueda.trim()
    if (q.length < 2) { setResultados([]); return }
    setBuscando(true)
    try {
      const limpio = q.replace(/[-\s]/g, '')
      let sel = db.from('pos_clientes')
        .select('id,nombre,nombre_comercial,tipo_documento,numero_documento,nrc,giro,codigo_actividad,email,telefono,direccion,departamento,municipio')
      sel = /^\d+$/.test(limpio)
        ? sel.or(`numero_documento.ilike.%${limpio}%,nrc.ilike.%${limpio}%`)
        : sel.or(`nombre.ilike.%${q}%,nombre_comercial.ilike.%${q}%`)
      const { data } = await sel.order('nombre').limit(12)
      setResultados(data || [])
    } finally { setBuscando(false) }
  }, [busqueda])

  useEffect(() => { const t = setTimeout(buscar, 300); return () => clearTimeout(t) }, [buscar])

  // Sucursales reales: el registro interno exige sucursal_id y el DTE toma de
  // acá el establecimiento. Arranca en Eventos, que es el caso típico de una
  // factura que no pasó por caja; si no existe, en Casa Matriz.
  useEffect(() => {
    let vivo = true
    db.from('sucursales').select('id,store_code,nombre').order('store_code')
      .then(({ data }) => {
        if (!vivo || !data) return
        setSucursales(data)
        const pref = data.find(s => s.store_code === 'EVT001') || data.find(s => s.store_code === 'CM001') || data[0]
        setSucursalId(pref?.id || '')
      })
    return () => { vivo = false }
  }, [])

  const sucursal = sucursales.find(s => s.id === sucursalId)

  const setItem = (i, campo, val) =>
    setItems(prev => prev.map((it, j) => j === i ? { ...it, [campo]: val } : it))
  const addItem = () => setItems(prev => [...prev, { ...ITEM_VACIO }])
  const delItem = (i) => setItems(prev => prev.length === 1 ? prev : prev.filter((_, j) => j !== i))

  const puedeEmitir = !emitiendo && d.total > 0 && pin.trim().length >= 4 && sucursalId
    && (!necesitaCliente || (cliente && faltan.length === 0))

  const emitir = async () => {
    setError(null); setEmit(true)
    try {
      const res = await emitirDTE({ tipoId, items, cliente, formaPago, storeCode: sucursal?.store_code || '', pin })

      // Registro interno de la emisión manual. `pos_dte_standalone` existe desde
      // el diseño original justo para esto y estaba sin usar. Va DESPUÉS del
      // sello: si el registro falla, el DTE ya es válido ante Hacienda y no se
      // puede "deshacer", así que el error se avisa sin tapar el resultado.
      try {
        const { data: reg, error: regErr } = await db.rpc('registrar_dte_standalone', {
          p_sucursal_id: sucursalId,
          p_dte_tipo: tipo.codigo,
          p_items: items.filter(it => String(it.descripcion || '').trim()),
          p_subtotal: d.gravado,
          p_iva: d.iva,
          p_total: d.total,
          p_dte_uuid: res.codigo_generacion,
          p_dte_numero_control: res.numero_control,
          p_dte_sello: res.sello_recepcion || null,
          p_creado_por: user?.id || null,
          p_cliente_id: cliente?.id || null,
          p_metodo_pago: FORMAS_PAGO.find(f => f.codigo === formaPago)?.nombre || formaPago,
          p_concepto: concepto.trim() || null,
          p_notas: `Emitido desde el ERP por ${user?.nombre || user?.id || 'staff'}`,
        })
        if (regErr) throw regErr
        if (reg && reg.ok === false) throw new Error(reg.error)
      } catch (e) {
        setError('El DTE se emitió correctamente ante Hacienda, pero no se pudo guardar el registro interno: ' + e.message)
      }

      setOk(res)
      onEmitido?.(res)
    } catch (e) {
      setError(e.message)
    } finally { setEmit(false) }
  }

  // ── Pantalla de resultado ──
  if (ok) {
    const aceptado = String(ok.estado || '').toLowerCase() === 'aceptado' || String(ok.estado || '').toUpperCase() === 'PROCESADO'
    return (
      <div style={s.overlay} onClick={onClose}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 38 }}>{aceptado ? '✅' : '⏳'}</div>
            <div style={{ color: aceptado ? C.greenLight : C.gold, fontWeight: 800, fontSize: 17, marginTop: 6 }}>
              {aceptado ? `${tipo.nombre} emitida` : `${tipo.nombre} en estado ${ok.estado}`}
            </div>
          </div>
          <div style={{ background: C.cardAlt, borderRadius: 10, padding: 12, fontSize: 12, color: C.white, lineHeight: 1.9 }}>
            <div><span style={{ color: C.textMuted }}>Nº Control:</span> <b>{ok.numero_control}</b></div>
            <div><span style={{ color: C.textMuted }}>Código generación:</span> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{ok.codigo_generacion}</span></div>
            <div><span style={{ color: C.textMuted }}>Estado:</span> <b>{ok.estado}</b></div>
            {ok.sello_recepcion && (
              <div style={{ wordBreak: 'break-all' }}>
                <span style={{ color: C.textMuted }}>Sello:</span>{' '}
                <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{ok.sello_recepcion}</span>
              </div>
            )}
            <div><span style={{ color: C.textMuted }}>Total:</span> <b>${Number(ok.monto_total ?? d.total).toFixed(2)}</b></div>
          </div>
          {!aceptado && (
            <div style={{ background: '#2a1a0a', border: '1px solid #7c5211', borderRadius: 8, padding: 10, marginTop: 10, fontSize: 11, color: C.gold }}>
              El documento no quedó aceptado todavía. Si quedó en contingencia, el DTEaaS lo reintenta;
              revisá el listado antes de volver a emitir para no duplicarlo.
            </div>
          )}
          {error && (
            <div style={{ background: '#2a1a0a', borderRadius: 8, padding: 10, marginTop: 10, fontSize: 11, color: C.gold }}>⚠️ {error}</div>
          )}
          <button style={{ ...s.btn(C.red), width: '100%', marginTop: 14 }} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: C.white, flex: 1 }}>🧾 Emitir DTE</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* Tipo */}
        <label style={s.label}>Tipo de documento</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {TIPOS_EMISION.map(t => (
            <button key={t.id} style={s.chip(tipoId === t.id)} onClick={() => setTipoId(t.id)}>{t.nombre}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14 }}>{tipo.ayuda}</div>

        {/* Cliente */}
        <label style={s.label}>Cliente {necesitaCliente ? '(obligatorio)' : '(opcional)'}</label>
        {cliente ? (
          <div style={{ background: C.cardAlt, border: `1px solid ${faltan.length ? C.red : C.border}`, borderRadius: 8, padding: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>{cliente.nombre}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  {cliente.tipo_documento || 'Doc'}: {cliente.numero_documento || '—'}
                  {cliente.nrc ? ` · NRC: ${cliente.nrc}` : ''}
                </div>
              </div>
              <button onClick={() => { setCliente(null); setBusqueda('') }}
                style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
                Cambiar
              </button>
            </div>
            {faltan.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.red }}>
                ⚠️ Para {tipo.nombre} le falta: <b>{faltan.join(', ')}</b>. Completalo en Clientes antes de emitir.
              </div>
            )}
          </div>
        ) : (
          <>
            <input style={s.input} placeholder="Buscar por nombre, NIT o NRC…" value={busqueda}
              onChange={e => setBusqueda(e.target.value)} />
            {buscando && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Buscando…</div>}
            {resultados.length > 0 && (
              <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 8, marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                {resultados.map(c => (
                  <div key={c.id} onClick={() => { setCliente(c); setResultados([]) }}
                    style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12, color: C.white }}>{c.nombre}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>
                      {c.numero_documento || 'sin documento'}{c.nrc ? ` · NRC ${c.nrc}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {necesitaCliente && (
              <div style={{ fontSize: 11, color: C.gold, marginTop: 6 }}>
                {tipo.nombre} no se puede emitir sin cliente.
              </div>
            )}
          </>
        )}

        {/* Ítems */}
        <label style={{ ...s.label, marginTop: 14 }}>Ítems · precios CON IVA, como se cobran</label>
        <div style={{ background: C.cardAlt, borderRadius: 8, padding: 8, marginBottom: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input style={{ ...s.input, flex: 1 }} placeholder="Descripción" value={it.descripcion}
                onChange={e => setItem(i, 'descripcion', e.target.value)} />
              <input style={{ ...s.input, width: 62 }} type="number" min="0" step="any" placeholder="Cant"
                value={it.cantidad} onChange={e => setItem(i, 'cantidad', e.target.value)} />
              <input style={{ ...s.input, width: 86 }} type="number" min="0" step="0.01" placeholder="Precio"
                value={it.precio} onChange={e => setItem(i, 'precio', e.target.value)} />
              <button onClick={() => delItem(i)} disabled={items.length === 1}
                style={{ background: 'none', border: 'none', color: items.length === 1 ? '#444' : C.red, fontSize: 18, cursor: items.length === 1 ? 'default' : 'pointer', padding: '0 4px' }}>×</button>
            </div>
          ))}
          <button onClick={addItem}
            style={{ background: 'none', border: `1px dashed ${C.border}`, color: C.textMuted, borderRadius: 7, padding: '6px 10px', fontSize: 12, cursor: 'pointer', width: '100%' }}>
            + Agregar ítem
          </button>
        </div>

        {/* Forma de pago + sucursal + concepto */}
        <div style={s.row}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={s.label}>Forma de pago</label>
            <select style={s.input} value={formaPago} onChange={e => setFormaPago(e.target.value)}>
              {FORMAS_PAGO.map(f => <option key={f.codigo} value={f.codigo}>{f.nombre}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={s.label}>Establecimiento</label>
            <select style={s.input} value={sucursalId} onChange={e => setSucursalId(e.target.value)}>
              {sucursales.length === 0 && <option value="">Cargando…</option>}
              {sucursales.map(x => <option key={x.id} value={x.id}>{x.store_code} — {x.nombre}</option>)}
            </select>
            {sucursal && !STORE_ESTABLECIMIENTO[sucursal.store_code] && (
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                Sin código de establecimiento MH: el DTE sale con el del emisor.
              </div>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={s.label}>Concepto (queda en el registro interno, no va al DTE)</label>
          <input style={s.input} placeholder="Ej: Evento corporativo 15-sep" value={concepto}
            onChange={e => setConcepto(e.target.value)} />
        </div>

        {/* Desglose */}
        <div style={{ background: C.cardAlt, borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textMuted, marginBottom: 4 }}>
            <span>{tipoId === 'se' ? 'Total compras' : 'Gravado'}</span><span style={{ fontFamily: 'monospace' }}>${d.gravado.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textMuted, marginBottom: 4 }}>
            <span>IVA 13%</span><span style={{ fontFamily: 'monospace' }}>${d.iva.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: C.white, fontWeight: 800, fontSize: 16, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
            <span>Total</span><span style={{ fontFamily: 'monospace' }}>${d.total.toFixed(2)}</span>
          </div>
        </div>

        {/* PIN */}
        <label style={s.label}>Tu PIN — firma la emisión del documento</label>
        <input style={s.input} type="password" inputMode="numeric" autoComplete="off"
          placeholder="••••" value={pin} onChange={e => setPin(e.target.value)} />

        {error && (
          <div style={{ background: '#2a0a0a', border: `1px solid ${C.red}`, borderRadius: 8, padding: 10, marginTop: 10, fontSize: 12, color: '#fca5a5' }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button style={{ ...s.btn(C.red, !puedeEmitir), flex: 1 }} disabled={!puedeEmitir} onClick={emitir}>
            {emitiendo ? '⏳ Emitiendo…' : `Emitir ${tipo.nombre} por $${d.total.toFixed(2)}`}
          </button>
          <button style={{ ...s.btn('#333'), flex: '0 0 auto' }} onClick={onClose}>Cancelar</button>
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          Esto emite un documento real ante Hacienda. Una vez sellado solo se corrige con Nota de Crédito o invalidación.
        </div>
      </div>
    </div>
  )
}
