import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { dbFin } from '../../supabaseFinanzas'
import { paletaC as C } from '@/theme'
import InfoTip from '../ui/InfoTip'
import EmitirDTEModal from './EmitirDTEModal'
import CorregirDTEModal from './CorregirDTEModal'

/**
 * DTEsEmitidosView — los documentos que Freakie le EMITE a Hacienda.
 *
 * No confundir con `DTEsView`, que son los DTE de COMPRA (los que recibimos de
 * proveedores y alimentan el P&L). Esta pantalla es el otro lado: las ventas
 * facturadas, vengan del POS o emitidas a mano desde acá.
 *
 * Los datos salen de `v_dtes_emitidos`, que lee `dte_service.documents` con el
 * business_id de Freakie fijo — el DTEaaS es multi-tenant (también sirve a
 * Kaeru y Kako) y el aislamiento no puede depender de que el front filtre.
 * La vista está cerrada a la llave pública: se pide con `dbFin`, que pasa por
 * el gate del proxy y exige sesión de staff con rol de finanzas.
 */

const ESTADO_STYLE = {
  aceptado:     { color: C.greenLight, bg: 'rgba(74,222,128,0.12)', label: 'Aceptado' },
  rechazado:    { color: '#fca5a5',    bg: 'rgba(230,35,41,0.14)',  label: 'Rechazado' },
  invalidado:   { color: '#c4b5fd',    bg: 'rgba(167,139,250,0.14)', label: 'Invalidado' },
  contingencia: { color: C.gold,       bg: 'rgba(250,204,21,0.12)', label: 'Contingencia' },
  pendiente:    { color: C.gold,       bg: 'rgba(250,204,21,0.12)', label: 'Pendiente' },
  firmado:      { color: C.blue,       bg: 'rgba(96,165,250,0.12)', label: 'Firmado' },
  generado:     { color: C.gray,       bg: 'rgba(255,255,255,0.06)', label: 'Generado' },
}
const estiloEstado = (e) => ESTADO_STYLE[String(e || '').toLowerCase()] || { color: C.gray, bg: 'rgba(255,255,255,0.06)', label: e || '—' }

const TIPOS_FILTRO = [
  { codigo: '', nombre: 'Todos' },
  { codigo: '01', nombre: 'Factura' },
  { codigo: '03', nombre: 'CCF' },
  { codigo: '05', nombre: 'Nota de Crédito' },
  { codigo: '06', nombre: 'Nota de Débito' },
  { codigo: '14', nombre: 'Sujeto Excluido' },
]

const ROLES_EMISION = new Set(['admin', 'superadmin', 'ejecutivo'])

const fmt = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyISO = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)
const haceDias = (d) => new Date(Date.now() - 6 * 3600 * 1000 - d * 86400000).toISOString().slice(0, 10)

const sCard = { background: C.card, borderRadius: 12, padding: 14, border: `1px solid ${C.border}` }
const sInput = { background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 9px', fontSize: 12, outline: 'none' }
const sTh = { padding: '8px 6px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.gold, borderBottom: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }
const sTd = { padding: '8px 6px', fontSize: 12, color: C.white, borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' }

const PAGINA = 100

export default function DTEsEmitidosView({ user }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [total, setTotal] = useState(0)

  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(hoyISO())
  const [tipo, setTipo] = useState('')
  const [estado, setEstado] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(0)

  const [expandido, setExpandido] = useState(null)
  const [detalles, setDetalles] = useState({})
  const [emitiendo, setEmitiendo] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(null)

  // Modo duplicados: lista las facturas que quedaron emitidas dos veces por un
  // doble cobro del POS y siguen aceptadas en Hacienda (v_dte_duplicados_pendientes).
  // Ignora el rango de fechas a propósito — son pocos y hay que verlos todos.
  const [soloDuplicados, setSoloDuplicados] = useState(false)
  const [dupInfo, setDupInfo] = useState({})   // { codigo_generacion: fila de la vista }

  const puedeEmitir = ROLES_EMISION.has(String(user?.rol || '').toLowerCase())

  const cargar = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      if (soloDuplicados) {
        const { data: dups, error: dupErr } = await dbFin
          .from('v_dte_duplicados_pendientes')
          .select('*')
          .order('fecha_emision', { ascending: false })
        if (dupErr) throw dupErr
        const info = {}
        ;(dups || []).forEach(d => { info[d.codigo_generacion] = d })
        setDupInfo(info)
        const codigos = (dups || []).map(d => d.codigo_generacion)
        if (!codigos.length) { setRows([]); setTotal(0); return }
        const { data, error: e2 } = await dbFin.from('v_dtes_emitidos')
          .select('id,codigo_generacion,numero_control,tipo_dte,tipo_nombre,estado,fecha_emision,hora_emision,receptor_nombre,receptor_nit,receptor_nrc,monto_total,monto_iva,monto_gravado,sello_recepcion,descripcion_msg,num_items,pos_cuenta_id,standalone_id')
          .in('codigo_generacion', codigos)
          .order('fecha_emision', { ascending: false })
        if (e2) throw e2
        setRows(data || [])
        setTotal((data || []).length)
        return
      }
      setDupInfo({})
      let q = dbFin.from('v_dtes_emitidos')
        .select('id,codigo_generacion,numero_control,tipo_dte,tipo_nombre,estado,fecha_emision,hora_emision,receptor_nombre,receptor_nit,receptor_nrc,monto_total,monto_iva,monto_gravado,sello_recepcion,descripcion_msg,num_items,pos_cuenta_id,standalone_id', { count: 'exact' })
        .gte('fecha_emision', desde)
        .lte('fecha_emision', hasta)
        .order('fecha_emision', { ascending: false })
        .order('hora_emision', { ascending: false })
        .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)

      if (tipo) q = q.eq('tipo_dte', tipo)
      if (estado) q = q.eq('estado', estado)
      const b = busqueda.trim()
      if (b.length >= 2) {
        const limpio = b.replace(/[-\s]/g, '')
        q = /^\d+$/.test(limpio)
          ? q.or(`receptor_nit.ilike.%${limpio}%,receptor_nrc.ilike.%${limpio}%,numero_control.ilike.%${b}%`)
          : q.or(`receptor_nombre.ilike.%${b}%,numero_control.ilike.%${b}%,codigo_generacion.ilike.%${b}%`)
      }

      const { data, error: e, count } = await q
      if (e) throw e
      setRows(data || [])
      setTotal(count || 0)
    } catch (e) {
      setError(e.message || String(e))
      setRows([])
    } finally { setLoading(false) }
  }, [desde, hasta, tipo, estado, busqueda, pagina, soloDuplicados])

  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t) }, [cargar])
  // Cambiar un filtro tiene que volver a la primera página: si estabas en la 3
  // y el filtro nuevo devuelve 40 filas, la tabla salía vacía sin explicación.
  useEffect(() => { setPagina(0) }, [desde, hasta, tipo, estado, busqueda])

  // Los totales se calculan sobre la página visible: sumar 28k filas del lado
  // del cliente exigiría traerlas todas. Se dice explícitamente en la UI.
  const kpis = useMemo(() => {
    const aceptados = rows.filter(r => r.estado === 'aceptado')
    const problemas = rows.filter(r => ['rechazado', 'pendiente', 'contingencia'].includes(r.estado))
    return {
      docs: rows.length,
      facturado: aceptados.reduce((s, r) => s + Number(r.monto_total || 0), 0),
      iva: aceptados.reduce((s, r) => s + Number(r.monto_iva || 0), 0),
      problemas: problemas.length,
      invalidados: rows.filter(r => r.estado === 'invalidado').length,
    }
  }, [rows])

  const verDetalle = async (r) => {
    if (expandido === r.codigo_generacion) { setExpandido(null); return }
    setExpandido(r.codigo_generacion)
    if (detalles[r.codigo_generacion]) return
    try {
      const { data, error: e } = await dbFin.rpc('dte_emitido_detalle', { p_codigo_generacion: r.codigo_generacion })
      if (e) throw e
      setDetalles(prev => ({ ...prev, [r.codigo_generacion]: data }))
    } catch (e) {
      setDetalles(prev => ({ ...prev, [r.codigo_generacion]: { _error: e.message } }))
    }
  }

  const ultimaPagina = Math.max(0, Math.ceil(total / PAGINA) - 1)

  return (
    <div style={{ padding: '12px 8px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ color: C.red, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>FREAKIE DOGS</div>
        <h1 style={{ color: C.white, fontSize: 24, fontWeight: 800, margin: '4px 0' }}>
          🧾 DTEs Emitidos <InfoTip text="Los documentos que Freakie le emite a Hacienda: facturas, CCF, notas de crédito y sujeto excluido. Vengan del POS o emitidos a mano desde acá. No confundir con la pantalla de DTEs, que son las compras a proveedores." />
        </h1>
        <div style={{ color: C.textMuted, fontSize: 11 }}>
          Facturación electrónica emitida · consulta, emisión manual, notas de crédito e invalidación
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Documentos', valor: kpis.docs, sub: `de ${total.toLocaleString()} en el rango`, color: C.white },
          { label: 'Facturado aceptado', valor: fmt(kpis.facturado), sub: 'en esta página', color: C.greenLight },
          { label: 'IVA', valor: fmt(kpis.iva), sub: 'en esta página', color: C.blue },
          { label: 'Con problema', valor: kpis.problemas, sub: 'rechazado / pendiente / contingencia', color: kpis.problemas ? '#fca5a5' : C.gray },
          { label: 'Invalidados', valor: kpis.invalidados, sub: 'anulados ante MH', color: '#c4b5fd' },
        ].map(k => (
          <div key={k.label} style={sCard}>
            <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.valor}</div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filtros + acción */}
      <div style={{ ...sCard, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>Desde</div>
          <input type="date" style={sInput} value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>Hasta</div>
          <input type="date" style={sInput} value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>Tipo</div>
          <select style={{ ...sInput, cursor: 'pointer' }} value={tipo} onChange={e => setTipo(e.target.value)}>
            {TIPOS_FILTRO.map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>Estado</div>
          <select style={{ ...sInput, cursor: 'pointer' }} value={estado} onChange={e => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {Object.keys(ESTADO_STYLE).map(k => <option key={k} value={k}>{ESTADO_STYLE[k].label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>Buscar</div>
          <input style={{ ...sInput, width: '100%', boxSizing: 'border-box' }} placeholder="Cliente, NIT, Nº control o código…"
            value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <button onClick={() => setSoloDuplicados(v => !v)}
          title="Facturas emitidas dos veces por un doble cobro del POS que siguen aceptadas en Hacienda"
          style={{
            background: soloDuplicados ? C.gold : 'transparent',
            color: soloDuplicados ? '#1a1400' : C.gold,
            border: `1px solid ${C.gold}`, borderRadius: 9, padding: '9px 14px',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
          ⚠️ Duplicados{soloDuplicados ? ' ✓' : ''}
        </button>
        {puedeEmitir && (
          <button onClick={() => setEmitiendo(true)}
            style={{ background: C.red, color: C.white, border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Emitir DTE
          </button>
        )}
      </div>

      {soloDuplicados && (
        <div style={{ ...sCard, marginBottom: 12, borderColor: C.gold, background: '#2a1f05' }}>
          <div style={{ color: C.gold, fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
            Facturas duplicadas por doble cobro del POS · {rows.length} pendientes
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.7 }}>
            Cada una de estas es la <b>segunda</b> factura de una venta que se cobró dos veces: la
            primera (que se deja viva) va indicada en cada fila. Sobre Factura de consumidor final
            Hacienda no acepta Nota de Crédito, así que la corrección es <b>Invalidar</b>, con tipo
            de anulación <b>2 — rescindir la operación</b>. El motivo viene precargado.
            <br />La invalidación es irreversible. Si alguna es de hace varias semanas puede estar
            fuera del plazo que admite Hacienda: confirmalo con el contador antes de correrlas todas.
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...sCard, borderColor: C.red, marginBottom: 12, color: '#fca5a5', fontSize: 12 }}>
          ⚠️ {error}
          <div style={{ color: C.textMuted, marginTop: 6, fontSize: 11 }}>
            Si dice que falta la sesión, ingresá tu PIN cuando lo pida. En desarrollo local esta pantalla
            necesita el deploy (o <code>vercel dev</code>): el gate vive en el proxy.
          </div>
        </div>
      )}

      {/* Tabla */}
      <div style={{ ...sCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={sTh}>Fecha</th>
              <th style={sTh}>Tipo</th>
              <th style={sTh}>Nº Control</th>
              <th style={sTh}>Cliente</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Gravado</th>
              <th style={{ ...sTh, textAlign: 'right' }}>IVA</th>
              <th style={{ ...sTh, textAlign: 'right' }}>Total</th>
              <th style={sTh}>Estado</th>
              <th style={sTh}>Origen</th>
              <th style={sTh}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} style={{ ...sTd, textAlign: 'center', color: C.textMuted, padding: 24 }}>Cargando…</td></tr>
            )}
            {!loading && rows.length === 0 && !error && (
              <tr><td colSpan={10} style={{ ...sTd, textAlign: 'center', color: C.textMuted, padding: 24 }}>
                No hay documentos con esos filtros.
              </td></tr>
            )}
            {!loading && rows.map(r => {
              const est = estiloEstado(r.estado)
              const abierto = expandido === r.codigo_generacion
              const det = detalles[r.codigo_generacion]
              return (
                <Fragment key={r.id}>
                  <tr onClick={() => verDetalle(r)} style={{ cursor: 'pointer', background: abierto ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                    <td style={sTd}>
                      {r.fecha_emision}
                      <div style={{ fontSize: 10, color: C.textMuted }}>{String(r.hora_emision || '').slice(0, 5)}</div>
                    </td>
                    <td style={sTd}>{r.tipo_nombre}</td>
                    <td style={{ ...sTd, fontFamily: 'monospace', fontSize: 11 }}>{r.numero_control}</td>
                    <td style={sTd}>
                      {r.receptor_nombre || <span style={{ color: C.textMuted }}>Consumidor Final</span>}
                      {r.receptor_nit && <div style={{ fontSize: 10, color: C.textMuted }}>NIT {r.receptor_nit}</div>}
                    </td>
                    <td style={{ ...sTd, textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.monto_gravado)}</td>
                    <td style={{ ...sTd, textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.monto_iva)}</td>
                    <td style={{ ...sTd, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(r.monto_total)}</td>
                    <td style={sTd}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: est.bg, color: est.color, fontSize: 10, fontWeight: 700 }}>
                        {est.label}
                      </span>
                    </td>
                    <td style={{ ...sTd, fontSize: 10, color: C.textMuted }}>
                      {r.pos_cuenta_id ? 'POS' : r.standalone_id ? 'ERP' : '—'}
                    </td>
                    <td style={{ ...sTd, textAlign: 'right', color: C.textMuted, fontSize: 11 }}>{abierto ? '▲' : '▼'}</td>
                  </tr>

                  {abierto && (
                    <tr>
                      <td colSpan={10} style={{ padding: 12, background: 'rgba(0,0,0,0.25)', borderBottom: `1px solid ${C.border}` }}>
                        {!det && <div style={{ fontSize: 12, color: C.textMuted }}>Cargando detalle…</div>}
                        {det?._error && <div style={{ fontSize: 12, color: '#fca5a5' }}>⚠️ {det._error}</div>}
                        {det && !det._error && (
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            {/* Ítems */}
                            <div style={{ flex: 2, minWidth: 280 }}>
                              <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Ítems</div>
                              {(det.items || []).length === 0 && <div style={{ fontSize: 11, color: C.textMuted }}>Sin detalle de ítems.</div>}
                              {(det.items || []).map((it, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.white, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                  <span>{it.cantidad}× {it.descripcion}</span>
                                  <span style={{ fontFamily: 'monospace', color: C.textMuted }}>
                                    {fmt(Number(it.precioUni || 0) * Number(it.cantidad || 0))}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {/* Datos fiscales */}
                            <div style={{ flex: 1, minWidth: 240, fontSize: 11, color: C.textMuted, lineHeight: 1.8 }}>
                              <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Documento</div>
                              <div style={{ wordBreak: 'break-all' }}>Código: <span style={{ fontFamily: 'monospace', color: C.white }}>{r.codigo_generacion}</span></div>
                              {r.sello_recepcion && (
                                <div style={{ wordBreak: 'break-all' }}>Sello: <span style={{ fontFamily: 'monospace', color: C.white, fontSize: 10 }}>{r.sello_recepcion}</span></div>
                              )}
                              {r.descripcion_msg && <div>Mensaje MH: <span style={{ color: C.white }}>{r.descripcion_msg}</span></div>}
                              {Array.isArray(det.observaciones_mh) && det.observaciones_mh.length > 0 && (
                                <div style={{ color: C.gold, marginTop: 4 }}>Observaciones: {det.observaciones_mh.join(' · ')}</div>
                              )}
                              {dupInfo[r.codigo_generacion] && (
                                <div style={{ marginTop: 8, padding: 8, background: '#2a1f05', border: `1px solid ${C.gold}`, borderRadius: 8, color: C.gold, fontSize: 11, lineHeight: 1.7 }}>
                                  <b>Duplicado por doble cobro.</b> La factura buena de esta venta es{' '}
                                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{dupInfo[r.codigo_generacion].nc_original}</span>
                                  {' '}({dupInfo[r.codigo_generacion].store_code} · {dupInfo[r.codigo_generacion].metodos}
                                  {dupInfo[r.codigo_generacion].gap_min > 0 ? ` · recobrada ${dupInfo[r.codigo_generacion].gap_min} min después` : ' · doble tap'}).
                                  Esta es la que hay que invalidar.
                                </div>
                              )}
                              {puedeEmitir && ['aceptado'].includes(r.estado) && (
                                <button onClick={(ev) => { ev.stopPropagation(); setCorrigiendo({ ...r, _dup: dupInfo[r.codigo_generacion] || null }) }}
                                  style={{ marginTop: 10, background: 'transparent', border: `1px solid ${C.red}`, color: '#fca5a5', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                  Corregir (NC / invalidar)
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {total > PAGINA && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 12 }}>
          <button disabled={pagina === 0} onClick={() => setPagina(p => Math.max(0, p - 1))}
            style={{ background: 'transparent', border: `1px solid ${C.border}`, color: pagina === 0 ? '#444' : C.white, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: pagina === 0 ? 'default' : 'pointer' }}>
            ← Anterior
          </button>
          <span style={{ fontSize: 11, color: C.textMuted }}>
            Página {pagina + 1} de {ultimaPagina + 1} · {total.toLocaleString()} documentos
          </span>
          <button disabled={pagina >= ultimaPagina} onClick={() => setPagina(p => Math.min(ultimaPagina, p + 1))}
            style={{ background: 'transparent', border: `1px solid ${C.border}`, color: pagina >= ultimaPagina ? '#444' : C.white, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: pagina >= ultimaPagina ? 'default' : 'pointer' }}>
            Siguiente →
          </button>
        </div>
      )}

      {emitiendo && (
        <EmitirDTEModal user={user} onClose={() => setEmitiendo(false)} onEmitido={() => cargar()} />
      )}
      {corrigiendo && (
        <CorregirDTEModal dte={corrigiendo} onClose={() => setCorrigiendo(null)} onListo={() => cargar()} />
      )}
    </div>
  )
}
