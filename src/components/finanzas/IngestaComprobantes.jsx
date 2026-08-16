import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { useToast } from '../../hooks/useToast'
import InfoTip from '../ui/InfoTip'

// ═══════════════════════════════════════════════════════════
// TAB INGESTA — administración de comprobantes que entran solos
// desde las capturas del iPhone (worker pagos-ingesta de la mini).
// Estados (cxp_resultado): aplicado / propuesto / revisar / sin_ccf /
// ya_pagada / descartado. Aprobar = fn_ingesta_resolver.
// ═══════════════════════════════════════════════════════════

const ESTADOS = [
  { key: '', label: 'Todos', color: '#9ca3af' },
  { key: 'propuesto', label: '🟡 Propuestos', color: '#f59e0b' },
  { key: 'revisar', label: '🔍 A revisar', color: '#f97316' },
  { key: 'sin_ccf', label: '📄 Sin CCF', color: '#6b7280' },
  { key: 'aplicado', label: '✅ Aplicados', color: '#10b981' },
  { key: 'ya_pagada', label: '♻️ Ya pagada', color: '#8b5cf6' },
  { key: 'descartado', label: '🗑 Descartados', color: '#4b5563' },
]
const PAGE = 40

const fmt = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

const badge = (estado) => {
  const e = ESTADOS.find(x => x.key === estado)
  return (
    <span style={{ background: (e?.color || '#6b7280') + '22', color: e?.color || '#9ca3af', border: `1px solid ${e?.color || '#6b7280'}55`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {e?.label || estado || '—'}
    </span>
  )
}

export default function IngestaComprobantes() {
  const toast = useToast()
  const [filtro, setFiltro] = useState('propuesto')
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [abierto, setAbierto] = useState(null)      // comprobante expandido
  const [candidatas, setCandidatas] = useState(null) // resultado fn_ingesta_candidatas
  const [busqueda, setBusqueda] = useState('')
  const [resultadosBusqueda, setResultadosBusqueda] = useState([])
  const [seleccion, setSeleccion] = useState({})    // compra_id -> true
  const [trabajando, setTrabajando] = useState(false)

  const cargarCounts = useCallback(async () => {
    const out = {}
    await Promise.all(ESTADOS.filter(e => e.key).map(async (e) => {
      const { count } = await db.from('bank_comprobantes')
        .select('id', { count: 'exact', head: true })
        .ilike('uploaded_by', 'ingesta%').eq('cxp_resultado', e.key)
      out[e.key] = count || 0
    }))
    setCounts(out)
  }, [])

  const cargar = useCallback(async (pag = 0) => {
    setLoading(true)
    try {
      let q = db.from('bank_comprobantes')
        .select('id, foto_url, monto, fecha_extraida, beneficiario, concepto, numero_referencia, ccfs, cxp_resultado, cxp_confianza, pago_proveedor_id, created_at')
        .ilike('uploaded_by', 'ingesta%')
        .order('fecha_extraida', { ascending: false, nullsFirst: false })
        .range(pag * PAGE, pag * PAGE + PAGE)
      if (filtro) q = q.eq('cxp_resultado', filtro)
      const { data, error } = await q
      if (error) throw error
      setHayMas((data || []).length > PAGE)
      const pageRows = (data || []).slice(0, PAGE)
      if (pag === 0) setRows(pageRows)
      else setRows(prev => [...prev, ...pageRows])
      setPagina(pag)
    } catch (e) { toast.error('No pude cargar: ' + e.message) } finally { setLoading(false) }
  }, [filtro, toast])

  useEffect(() => { cargar(0); cargarCounts(); setAbierto(null) }, [filtro]) // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = async (c) => {
    if (abierto === c.id) { setAbierto(null); return }
    setAbierto(c.id); setCandidatas(null); setSeleccion({}); setBusqueda(''); setResultadosBusqueda([])
    if ((c.ccfs || []).length > 0) {
      const { data, error } = await db.rpc('fn_ingesta_candidatas', { p_comprobante_id: c.id })
      if (!error) setCandidatas(data)
    }
  }

  const buscarCompras = async (q) => {
    setBusqueda(q)
    if (q.trim().length < 3) { setResultadosBusqueda([]); return }
    const { data } = await db.from('compras_dte')
      .select('id, proveedor_nombre, numero_control, fecha_emision, monto_total, total_pagado, estado_pago')
      .or(`proveedor_nombre.ilike.%${q.trim()}%,numero_control.ilike.%${q.trim()}%`)
      .neq('invalidado', true)
      .order('fecha_emision', { ascending: false }).limit(15)
    setResultadosBusqueda(data || [])
  }

  const resolver = async (c, accion, aplicaciones = []) => {
    setTrabajando(true)
    try {
      const { data, error } = await db.rpc('fn_ingesta_resolver', {
        p_comprobante_id: c.id, p_accion: accion, p_aplicaciones: aplicaciones,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast.success(accion === 'aplicar' ? `✅ Aplicado ${fmt(data.monto_aplicado)}` : accion === 'descartar' ? 'Descartado' : 'Reabierto')
      setAbierto(null)
      await cargar(0); await cargarCounts()
    } catch (e) { toast.error('No se pudo: ' + e.message) } finally { setTrabajando(false) }
  }

  const aplicarSeleccion = (c) => {
    const apps = Object.keys(seleccion).filter(k => seleccion[k]).map(id => ({ compra_id: id }))
    if (apps.length === 0) { toast.error('Marcá al menos una factura'); return }
    resolver(c, 'aplicar', apps)
  }

  const candPlanas = (candidatas?.detalle || []).flatMap(d => (d.candidatas || []).map(x => ({ ...x, ccf: d.ccf })))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>🤖 Ingesta automática de pagos</h3>
        <InfoTip text="Cada captura de comprobante que Jose toma en su iPhone llega sola a la mini, se lee con OCR y entra aquí. Si el CCF y el monto cuadran exacto con una factura pendiente, se aplica solo. Lo demás queda para aprobar o corregir en esta pantalla." />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {ESTADOS.map(e => (
          <button key={e.key || 'todos'} onClick={() => setFiltro(e.key)}
            style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
              border: `1px solid ${filtro === e.key ? e.color : '#374151'}`,
              background: filtro === e.key ? e.color + '22' : '#111827', color: filtro === e.key ? e.color : '#9ca3af' }}>
            {e.label}{e.key ? ` · ${counts[e.key] ?? '…'}` : ''}
          </button>
        ))}
      </div>

      {loading && rows.length === 0 && <div style={{ color: '#9ca3af', padding: 20 }}>Cargando…</div>}
      {!loading && rows.length === 0 && <div style={{ color: '#9ca3af', padding: 20 }}>Nada en este estado 🎉</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(c => (
          <div key={c.id} style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => abrir(c)}>
              {c.foto_url && (
                <a href={c.foto_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                  <img src={c.foto_url} alt="comprobante" loading="lazy" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #374151' }} />
                </a>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 16 }}>{fmt(c.monto)}</b>
                  {badge(c.cxp_resultado)}
                  {c.cxp_confianza && c.cxp_confianza !== c.cxp_resultado && <span style={{ fontSize: 11, color: '#6b7280' }}>({c.cxp_confianza})</span>}
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{c.fecha_extraida || 'sin fecha'}</span>
                </div>
                <div style={{ fontSize: 13, color: '#d1d5db', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.beneficiario || c.concepto || 'Sin beneficiario legible'}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {(c.ccfs || []).length > 0 ? `CCF: ${c.ccfs.join(', ')}` : 'sin CCF en el concepto'}
                  {c.numero_referencia ? ` · ref ${c.numero_referencia}` : ''}
                </div>
              </div>
              <div style={{ color: '#6b7280', fontSize: 18 }}>{abierto === c.id ? '▾' : '▸'}</div>
            </div>

            {abierto === c.id && (
              <div style={{ marginTop: 12, borderTop: '1px solid #374151', paddingTop: 12 }}>
                {c.cxp_resultado === 'aplicado' ? (
                  <div style={{ fontSize: 13, color: '#10b981' }}>✅ Ya aplicado a cuentas por pagar (pago {String(c.pago_proveedor_id).slice(0, 8)}…)</div>
                ) : c.cxp_resultado === 'descartado' ? (
                  <button disabled={trabajando} onClick={() => resolver(c, 'reabrir')} style={btn('#374151')}>↩️ Reabrir</button>
                ) : (
                  <>
                    {candPlanas.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
                          Facturas que matchean por CCF <InfoTip text="Candidatas encontradas buscando el número de CCF que se leyó en el concepto de la transferencia. Marcá las correctas y aplicá." />
                        </div>
                        {candPlanas.map(k => (
                          <label key={k.compra_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, background: '#111827', marginBottom: 4, cursor: k.ya_pagada ? 'not-allowed' : 'pointer', opacity: k.ya_pagada ? 0.5 : 1 }}>
                            <input type="checkbox" disabled={k.ya_pagada} checked={!!seleccion[k.compra_id]}
                              onChange={e => setSeleccion(s => ({ ...s, [k.compra_id]: e.target.checked }))} />
                            <span style={{ fontSize: 12, flex: 1 }}>
                              <b>{k.proveedor}</b> · CCF …{k.ccf} · {k.fecha_emision} · total {fmt(k.monto_total)} · saldo <b>{fmt(k.saldo)}</b>
                              {k.ya_pagada ? ' · YA PAGADA' : ''}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
                        Buscar factura a mano <InfoTip text="Si el OCR no leyó el CCF o el match no es el correcto, buscá la factura por proveedor o número de control y aplicá el pago contra ella." />
                      </div>
                      <input value={busqueda} onChange={e => buscarCompras(e.target.value)} placeholder="Proveedor o número de control (mín. 3 letras)"
                        style={{ width: '100%', maxWidth: 420, padding: '8px 10px', borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#e5e7eb', fontSize: 13 }} />
                      {resultadosBusqueda.map(k => (
                        <label key={k.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, background: '#111827', marginTop: 4, cursor: k.estado_pago === 'pagado' ? 'not-allowed' : 'pointer', opacity: k.estado_pago === 'pagado' ? 0.5 : 1 }}>
                          <input type="checkbox" disabled={k.estado_pago === 'pagado'} checked={!!seleccion[k.id]}
                            onChange={e => setSeleccion(s => ({ ...s, [k.id]: e.target.checked }))} />
                          <span style={{ fontSize: 12, flex: 1 }}>
                            <b>{k.proveedor_nombre}</b> · {k.numero_control?.slice(-8)} · {k.fecha_emision} · total {fmt(k.monto_total)} · pagado {fmt(k.total_pagado || 0)} ({k.estado_pago})
                          </span>
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button disabled={trabajando} onClick={() => aplicarSeleccion(c)} style={btn('#059669')}>✅ Aplicar a marcadas</button>
                      <button disabled={trabajando} onClick={() => resolver(c, 'descartar')} style={btn('#7f1d1d')}>🗑 Descartar</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {hayMas && (
        <button onClick={() => cargar(pagina + 1)} disabled={loading} style={{ ...btn('#374151'), marginTop: 12 }}>
          {loading ? 'Cargando…' : 'Cargar más'}
        </button>
      )}
    </div>
  )
}

const btn = (bg) => ({ padding: '8px 14px', borderRadius: 8, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 })
