// ConciliarTinderTab — UI tipo Tinder para asignar proveedor a cada egreso de caja
// F2 del plan Tinder Conciliación (17-May-2026).
// Reemplaza la tab "Conciliar DTEs" en FinanzasGastosView.
// Backend: RPC suggest_proveedor_para_egreso + columnas excluir_pl en egresos_cierre.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { db as supabase } from '../../supabase'
import { fmtDate, n } from '../../config'

const colors = {
  bg: '#1a1a2e', card: '#16213e', card2: '#1e2a4a',
  accent: '#e63946', gold: '#ffd60a', green: '#4ade80', blue: '#60a5fa',
  gray: '#9ca3af', border: '#2d3a5f'
}

const fmt$ = (v) => `$${n(v).toFixed(2)}`

const RAZON_MAP = {
  dte_alta:   { label: '⚡ DTE match exacto',  cls: 'dte' },
  dte_media:  { label: '⚡ DTE match',          cls: 'dte' },
  dte_baja:   { label: '⚡ DTE cercano',        cls: 'dte' },
  frecuente:  { label: '📊 Frecuente',          cls: 'frec' },
  comentario: { label: '💬 Comentario',         cls: 'coment' },
  ocr:        { label: '🔍 OCR',                cls: 'ocr' },
}

export default function ConciliarTinderTab({ user, filtroSucursal, filtroDesde, filtroHasta }) {
  const [tipo, setTipo] = useState('con')                // 'con' = Gasto con Factura, 'sin' = Gasto sin Factura
  const [pendientes, setPendientes] = useState([])       // cola completa
  const [idx, setIdx] = useState(0)                      // posición actual en la cola
  const [skipped, setSkipped] = useState(new Set())      // ids skipped en esta sesión (queda al final)
  const [loading, setLoading] = useState(false)
  const [card, setCard] = useState(null)                 // egreso actual con sugerencias
  const [loadingCard, setLoadingCard] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [counts, setCounts] = useState({ con: 0, sin: 0 })
  const [asignadosSesion, setAsignadosSesion] = useState(0)
  const [excluidosSesion, setExcluidosSesion] = useState(0)
  const [toast, setToast] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [fotoZoom, setFotoZoom] = useState(false)

  const cargandoCardRef = useRef(false)

  // ── Cargar cola de pendientes
  const cargarCola = useCallback(async () => {
    setLoading(true)
    setIdx(0)
    setCard(null)
    setSkipped(new Set())
    const motivo = tipo === 'con' ? 'Gasto con Factura' : 'Gasto sin Factura'
    const { data, error } = await supabase
      .from('egresos_cierre')
      .select(`
        id, motivo_nombre, monto, persona_recibe, comentario, foto_url, ocr_texto,
        estado_cruce, categoria_gasto_id, proveedor_id,
        ventas_diarias!inner(fecha, store_code)
      `)
      .eq('motivo_nombre', motivo)
      .is('proveedor_id', null)
      .in('estado_cruce', ['pendiente', 'sin_dte', 'ambiguo'])
      .gte('ventas_diarias.fecha', filtroDesde)
      .lte('ventas_diarias.fecha', filtroHasta)
      .order('monto', { ascending: false })
      .limit(500)
    if (error) { console.error('[Tinder] cola:', error); setLoading(false); return }
    if (filtroSucursal) {
      setPendientes((data || []).filter(r => r.ventas_diarias?.store_code === filtroSucursal))
    } else {
      setPendientes(data || [])
    }
    setLoading(false)
  }, [tipo, filtroSucursal, filtroDesde, filtroHasta])

  // ── Contadores por tipo (para badges del toggle)
  const cargarContadores = useCallback(async () => {
    const base = supabase.from('egresos_cierre')
      .select('id, ventas_diarias!inner(fecha)', { count: 'exact', head: true })
      .is('proveedor_id', null)
      .in('estado_cruce', ['pendiente','sin_dte','ambiguo'])
      .gte('ventas_diarias.fecha', filtroDesde)
      .lte('ventas_diarias.fecha', filtroHasta)
    const [{ count: c1 }, { count: c2 }] = await Promise.all([
      base.eq('motivo_nombre', 'Gasto con Factura'),
      supabase.from('egresos_cierre')
        .select('id, ventas_diarias!inner(fecha)', { count: 'exact', head: true })
        .eq('motivo_nombre', 'Gasto sin Factura')
        .is('proveedor_id', null)
        .in('estado_cruce', ['pendiente','sin_dte','ambiguo'])
        .gte('ventas_diarias.fecha', filtroDesde)
        .lte('ventas_diarias.fecha', filtroHasta),
    ])
    setCounts({ con: c1 || 0, sin: c2 || 0 })
  }, [filtroDesde, filtroHasta])

  useEffect(() => { cargarCola() }, [cargarCola])
  useEffect(() => { cargarContadores() }, [cargarContadores])

  // ── Cargar sugerencias de la card actual
  const cargarSugerencias = useCallback(async (egreso) => {
    if (!egreso || cargandoCardRef.current) return
    cargandoCardRef.current = true
    setLoadingCard(true)
    const { data: sugs, error } = await supabase
      .rpc('suggest_proveedor_para_egreso', { p_egreso_id: egreso.id })
    if (error) {
      console.error('[Tinder] suggest:', error)
      setCard({ egreso, sugerencias: [] })
    } else {
      setCard({ egreso, sugerencias: sugs || [] })
    }
    setLoadingCard(false)
    cargandoCardRef.current = false
  }, [])

  // ── Cuando avanza idx o se reorganiza la cola, cargar card
  useEffect(() => {
    if (loading) return
    const cola = pendientes.filter(p => !skipped.has(p.id))
                           .concat(pendientes.filter(p => skipped.has(p.id)))
    const egreso = cola[idx]
    if (egreso && (!card || card.egreso.id !== egreso.id)) {
      cargarSugerencias(egreso)
    } else if (!egreso) {
      setCard(null)
    }
  }, [idx, pendientes, skipped, loading, card, cargarSugerencias])

  // ── Pre-cargar siguiente card en background (para que sea instantáneo)
  const colaOrdenada = useMemo(() => {
    return pendientes.filter(p => !skipped.has(p.id))
                     .concat(pendientes.filter(p => skipped.has(p.id)))
  }, [pendientes, skipped])

  // ── Mostrar toast
  const showToast = (msg, type='') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }

  // ── Asignar proveedor (con confirmación si excluye P&L)
  const askAsignar = (sugerencia) => {
    if (!card?.egreso) return
    setConfirm({ sugerencia, egreso: card.egreso })
  }

  const ejecutarAsignar = async () => {
    if (!confirm) return
    const { sugerencia, egreso } = confirm
    setConfirm(null)
    const isExcluye = !!sugerencia.genera_dte
    const isMatchExacto = !!sugerencia.dte_match_id

    const estadoNuevo = isMatchExacto ? 'cruzado'
                      : isExcluye    ? 'excluido_dte_externo'
                      :                'asignado_directo'

    const updates = {
      proveedor_id:         sugerencia.catalogo_id,
      proveedor_genera_dte: isExcluye,
      excluir_pl:           isExcluye,
      categoria_gasto_id:   sugerencia.categoria,
      estado_cruce:         estadoNuevo,
      asignado_por:         user?.id || null,
      asignado_at:          new Date().toISOString(),
      ...(isMatchExacto ? { compras_dte_id: sugerencia.dte_match_id } : {}),
    }

    const { error: e1 } = await supabase
      .from('egresos_cierre').update(updates).eq('id', egreso.id)

    if (e1) {
      console.error('[Tinder] update egreso:', e1)
      showToast('❌ Error al asignar: ' + e1.message, 'error')
      return
    }

    // Si hay match exacto, marcar el DTE como cruzado
    if (isMatchExacto) {
      await supabase.from('compras_dte').update({ cruzado: true }).eq('id', sugerencia.dte_match_id)
    }

    setAsignadosSesion(x => x + 1)
    if (isExcluye) setExcluidosSesion(x => x + 1)

    showToast(
      isExcluye
        ? `✓ ${sugerencia.nombre} · EXCLUIDO del P&L (envía DTE)`
        : `✓ ${sugerencia.nombre} · Categoría: ${sugerencia.subcategoria || sugerencia.categoria}`,
      isExcluye ? 'warn' : 'ok'
    )

    // Sacar de la cola y avanzar
    setPendientes(prev => prev.filter(p => p.id !== egreso.id))
    setCard(null)
    setSearch(''); setSearchResults([])
    setCounts(c => ({ ...c, [tipo]: Math.max(0, c[tipo] - 1) }))
  }

  // ── Skip (queda al final de la cola)
  const skip = () => {
    if (!card?.egreso) return
    setSkipped(s => new Set([...s, card.egreso.id]))
    setIdx(i => i + 1)
    showToast('⏭ Skipeado · queda al final', 'info')
  }

  // ── Marcar No aplica P&L
  const noAplica = async () => {
    if (!card?.egreso) return
    const { error } = await supabase
      .from('egresos_cierre')
      .update({
        estado_cruce: 'ignorar',
        excluir_pl:   true,
        asignado_por: user?.id || null,
        asignado_at:  new Date().toISOString(),
      })
      .eq('id', card.egreso.id)
    if (error) { showToast('❌ ' + error.message, 'error'); return }
    setAsignadosSesion(x => x + 1)
    setExcluidosSesion(x => x + 1)
    showToast('🚫 No aplica P&L (excluido)', 'info')
    setPendientes(prev => prev.filter(p => p.id !== card.egreso.id))
    setCard(null)
    setCounts(c => ({ ...c, [tipo]: Math.max(0, c[tipo] - 1) }))
  }

  // ── Búsqueda en catalogo_contable
  const buscar = async (q) => {
    setSearch(q)
    if (!q || q.length < 2) { setSearchResults([]); return }
    const { data } = await supabase
      .from('catalogo_contable')
      .select('id, nombre_dte, categoria, subcategoria')
      .eq('activo', true)
      .is('duplicado_de', null)
      .ilike('nombre_dte', `%${q}%`)
      .order('nombre_dte')
      .limit(6)
    setSearchResults(data || [])
  }

  // Para mostrar genera_dte en resultados de búsqueda, leer de compras_dte últimos 90d en bulk
  const [generaDteSet, setGeneraDteSet] = useState(new Set())
  useEffect(() => {
    let cancel = false
    ;(async () => {
      if (searchResults.length === 0) return
      const ids = searchResults.map(r => r.nombre_dte.toUpperCase())
      if (!ids.length) return
      const { data } = await supabase
        .from('compras_dte')
        .select('proveedor_nombre')
        .gte('fecha_emision', new Date(Date.now() - 90*86400000).toISOString().split('T')[0])
      if (cancel) return
      const set = new Set((data || []).map(d => (d.proveedor_nombre || '').toUpperCase().trim()))
      setGeneraDteSet(set)
    })()
    return () => { cancel = true }
  }, [searchResults])

  // ── Asignar desde resultado de búsqueda manual
  const asignarBusqueda = (cat) => {
    const generaDte = generaDteSet.has((cat.nombre_dte || '').toUpperCase().trim())
    askAsignar({
      catalogo_id: cat.id,
      nombre: cat.nombre_dte,
      categoria: cat.categoria,
      subcategoria: cat.subcategoria,
      score: null,
      razones: ['manual'],
      genera_dte: generaDte,
      dte_match_id: null,
    })
  }

  // ────────────────────── UI ──────────────────────
  const egresoActual = card?.egreso
  const sugerencias  = card?.sugerencias || []
  const total = pendientes.length
  const completado = total + asignadosSesion === 0 ? 0
                   : (asignadosSesion / (total + asignadosSesion) * 100)

  return (
    <div>
      {/* Header con toggle + KPIs */}
      <div style={S.headerWrap}>
        <div style={S.toggle}>
          <button
            onClick={() => setTipo('con')}
            style={{ ...S.toggleBtn, ...(tipo === 'con' ? S.toggleBtnActive : {}) }}>
            🧾 Con Factura · {counts.con}
          </button>
          <button
            onClick={() => setTipo('sin')}
            style={{ ...S.toggleBtn, ...(tipo === 'sin' ? S.toggleBtnActive : {}) }}>
            📝 Sin Factura · {counts.sin}
          </button>
        </div>
        <div style={S.kpiRow}>
          <KPI label="Pendientes" value={total} color={colors.gold} />
          <KPI label="Asignados sesión" value={asignadosSesion} color={colors.green} />
          <KPI label="Excluidos P&L" value={excluidosSesion} color={colors.accent} />
        </div>
      </div>

      <div style={S.hintBox}>
        💡 Asigna el proveedor correcto. Si envía DTEs → <strong>excluido del P&L</strong> automáticamente (evita doble conteo). Si no, queda categorizado y sigue contando en P&L.
      </div>

      {/* Progress */}
      <div style={S.progressText}>
        <span>Tarjeta {idx + 1} de {total} · ({asignadosSesion} asignadas esta sesión)</span>
        <span>{completado.toFixed(1)}% completado</span>
      </div>
      <div style={S.progressBar}>
        <div style={{ ...S.progressFill, width: completado + '%' }} />
      </div>

      {loading && <div style={S.empty}>⏳ Cargando cola…</div>}

      {!loading && total === 0 && (
        <div style={{ ...S.empty, color: colors.green }}>
          ✅ Sin pendientes en este periodo y filtros
        </div>
      )}

      {/* Main grid foto + sugerencias */}
      {!loading && egresoActual && (
        <div style={S.main}>
          {/* Foto + meta */}
          <div style={S.cardFoto}>
            <div style={S.fotoWrap} onClick={() => egresoActual.foto_url && setFotoZoom(true)}>
              {egresoActual.foto_url ? (
                <img src={egresoActual.foto_url} alt="recibo"
                     style={S.fotoImg}
                     onError={(e) => { e.target.style.display = 'none' }} />
              ) : (
                <div style={S.fotoEmpty}>
                  <div style={{ fontSize: 56, opacity: 0.4 }}>📭</div>
                  <div>Sin foto · {egresoActual.motivo_nombre}</div>
                  {egresoActual.comentario && (
                    <div style={S.fotoEmptyComent}>
                      <strong style={{ color: colors.gold }}>Comentario:</strong><br/>
                      <em>"{egresoActual.comentario}"</em>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={S.metaEgreso}>
              <div style={S.metaMonto}>{fmt$(egresoActual.monto)}</div>
              <div style={S.metaFecha}>
                {egresoActual.ventas_diarias?.fecha ? fmtDate(egresoActual.ventas_diarias.fecha) : '—'} · {egresoActual.ventas_diarias?.store_code || '—'}
              </div>
              <div style={S.metaRow}>
                <div style={S.metaTag}>{egresoActual.motivo_nombre}</div>
                {egresoActual.persona_recibe && <div style={S.metaTag}>👤 {egresoActual.persona_recibe}</div>}
                <div style={{ ...S.metaTag, ...S.metaTagWarn }}>
                  {egresoActual.estado_cruce || 'pendiente'}
                </div>
              </div>
              {egresoActual.comentario && egresoActual.foto_url && (
                <div style={S.metaComent}>💬 {egresoActual.comentario}</div>
              )}
            </div>
          </div>

          {/* Panel sugerencias */}
          <div style={S.panel}>
            <div style={S.panelHead}>
              <div style={S.panelTitle}>💡 Sugerencias</div>
              <div style={S.panelCounter}>
                {loadingCard ? '…' : `${sugerencias.length} candidatos`}
              </div>
            </div>

            {loadingCard && <div style={S.empty}>Analizando…</div>}

            {!loadingCard && sugerencias.length === 0 && (
              <div style={{ ...S.empty, fontSize: 12 }}>
                Sin sugerencias automáticas. Usa la búsqueda abajo 👇
              </div>
            )}

            {!loadingCard && sugerencias.map((s, i) => {
              const scoreNum = Number(s.score || 0)
              const scoreCls = scoreNum >= 50 ? 'high'
                             : scoreNum >= 25 ? 'med'
                             : 'low'
              return (
                <div key={s.catalogo_id} style={S.sugRow} onClick={() => askAsignar(s)}>
                  <div style={{ ...S.scorePill, ...S.scorePillStyles[scoreCls] }}>
                    {scoreNum > 0 ? Math.round(scoreNum) : '?'}
                  </div>
                  <div style={S.sugInfo}>
                    <div style={S.sugNombre}>{s.nombre}</div>
                    <div style={S.sugMeta}>
                      {s.subcategoria || s.categoria || '—'}
                      {s.dte_proveedor && s.dte_monto && (
                        <span style={{ color: colors.gold }}> · DTE {fmt$(s.dte_monto)} {fmtDate(s.dte_fecha)}</span>
                      )}
                    </div>
                    <div style={S.razones}>
                      {(s.razones || []).map(r => {
                        const m = RAZON_MAP[r]
                        return m ? (
                          <span key={r} style={{ ...S.razon, ...S.razonStyles[m.cls] }}>{m.label}</span>
                        ) : null
                      })}
                    </div>
                    {s.genera_dte && (
                      <div style={S.excludeFlag}>⚠ Excluirá del P&L (envía DTE)</div>
                    )}
                  </div>
                  <button style={S.btnAsignar} onClick={(e) => { e.stopPropagation(); askAsignar(s) }}>
                    ✓ Asignar
                  </button>
                </div>
              )
            })}

            {/* Búsqueda manual */}
            <div style={S.searchBox}>
              <label style={S.searchLabel}>🔎 Buscar otro proveedor</label>
              <input
                style={S.searchInput}
                placeholder="Pricesmart, Tropigas, Freund..."
                value={search}
                onChange={(e) => buscar(e.target.value)}
              />
              {searchResults.length > 0 && (
                <div style={S.searchResults}>
                  {searchResults.map(r => {
                    const dte = generaDteSet.has((r.nombre_dte || '').toUpperCase().trim())
                    return (
                      <div key={r.id} style={S.searchRow} onClick={() => asignarBusqueda(r)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{r.nombre_dte}</div>
                          <div style={S.sugMeta}>
                            {r.subcategoria || r.categoria}{dte ? ' · ⚡ envía DTE' : ' · sin DTE'}
                          </div>
                        </div>
                        <button style={{ ...S.btnAsignar, padding: '5px 8px', fontSize: 11 }}>✓</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Acciones */}
            <div style={S.actions}>
              <button style={S.btnNoPl} onClick={noAplica}>🚫 No aplica P&L</button>
              <button style={S.btnSkip} onClick={skip}>⏭ Skip</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ ...S.toast, ...(toast.type === 'warn' ? S.toastWarn : toast.type === 'error' ? S.toastError : toast.type === 'info' ? S.toastInfo : S.toastOk) }}>
          {toast.msg}
        </div>
      )}

      {/* Confirm modal */}
      {confirm && (
        <div style={S.modalBg} onClick={() => setConfirm(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
              Asignar a <span style={{ color: colors.gold }}>{confirm.sugerencia.nombre}</span>
            </div>
            <div style={{ fontSize: 13, color: colors.gray, marginBottom: 14 }}>
              Egreso de <strong style={{ color: colors.gold }}>{fmt$(confirm.egreso.monto)}</strong>{' '}
              del {fmtDate(confirm.egreso.ventas_diarias?.fecha)} · {confirm.egreso.ventas_diarias?.store_code}
            </div>
            {confirm.sugerencia.genera_dte ? (
              <div style={S.confirmWarn}>
                ⚠ Este proveedor envía DTEs. El egreso se <strong>excluirá del P&L</strong> para evitar doble conteo.
                {confirm.sugerencia.dte_match_id && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    Además se vinculará al DTE {fmt$(confirm.sugerencia.dte_monto)} del {fmtDate(confirm.sugerencia.dte_fecha)}.
                  </div>
                )}
              </div>
            ) : (
              <div style={S.confirmOk}>
                ✓ Este proveedor no envía DTE. El gasto seguirá contando en P&L bajo <strong>{confirm.sugerencia.subcategoria || confirm.sugerencia.categoria}</strong>.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={S.btnCancel} onClick={() => setConfirm(null)}>Cancelar</button>
              <button style={S.btnConfirm} onClick={ejecutarAsignar}>Confirmar asignación</button>
            </div>
          </div>
        </div>
      )}

      {/* Foto zoom modal */}
      {fotoZoom && egresoActual?.foto_url && (
        <div style={S.modalBg} onClick={() => setFotoZoom(false)}>
          <img src={egresoActual.foto_url} alt="" style={S.fotoZoomImg} />
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, color }) {
  return (
    <div style={S.kpi}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color }}>{value}</div>
    </div>
  )
}

// ────────────────────── Estilos ──────────────────────
const S = {
  headerWrap: { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 },
  toggle: { display: 'flex', background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 4, gap: 4 },
  toggleBtn: { background: 'transparent', border: 'none', color: colors.gray, padding: '8px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.15s' },
  toggleBtnActive: { background: colors.accent, color: '#fff', boxShadow: '0 2px 8px rgba(230,57,70,0.4)' },
  kpiRow: { display: 'flex', gap: 8 },
  kpi: { background: colors.card, border: `1px solid ${colors.border}`, padding: '8px 12px', borderRadius: 8, minWidth: 90 },
  kpiLabel: { fontSize: 10, color: colors.gray, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 18, fontWeight: 800, marginTop: 2 },

  hintBox: { background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.3)', padding: '8px 12px', borderRadius: 8, fontSize: 12, color: '#93c5fd', marginBottom: 12 },
  progressText: { fontSize: 11, color: colors.gray, marginBottom: 6, display: 'flex', justifyContent: 'space-between' },
  progressBar: { background: colors.card, height: 5, borderRadius: 3, overflow: 'hidden', marginBottom: 14, border: `1px solid ${colors.border}` },
  progressFill: { height: '100%', background: `linear-gradient(90deg, ${colors.green}, ${colors.blue})`, transition: 'width 0.3s' },
  empty: { textAlign: 'center', padding: 30, fontSize: 13, color: colors.gray },

  main: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1.1fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start' },

  cardFoto: { background: colors.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${colors.border}`, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' },
  fotoWrap: { background: '#0a0a14', aspectRatio: '4/5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-in', overflow: 'hidden' },
  fotoImg: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  fotoEmpty: { textAlign: 'center', color: colors.gray, fontSize: 14, padding: 24 },
  fotoEmptyComent: { marginTop: 14, fontSize: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 },
  metaEgreso: { padding: '14px 16px', borderTop: `1px solid ${colors.border}` },
  metaMonto: { fontSize: 28, fontWeight: 800, color: colors.gold },
  metaFecha: { fontSize: 12, color: colors.gray, marginTop: 2 },
  metaRow: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  metaTag: { background: colors.card2, border: `1px solid ${colors.border}`, padding: '3px 9px', borderRadius: 6, fontSize: 11, color: colors.gray },
  metaTagWarn: { background: '#3a2510', borderColor: '#7a4a1a', color: colors.gold },
  metaComent: { marginTop: 8, fontSize: 12, color: '#cbd5e1', fontStyle: 'italic' },

  panel: { background: colors.card, borderRadius: 14, border: `1px solid ${colors.border}`, overflow: 'hidden' },
  panelHead: { padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { fontSize: 14, fontWeight: 700, color: '#f0f0f0' },
  panelCounter: { fontSize: 11, color: colors.gray, background: colors.card2, padding: '3px 9px', borderRadius: 10 },

  sugRow: { padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', transition: 'background 0.15s' },
  scorePill: { fontWeight: 800, fontSize: 12, padding: '5px 7px', borderRadius: 7, minWidth: 36, textAlign: 'center', alignSelf: 'center' },
  scorePillStyles: {
    high: { background: colors.green, color: '#0a2418' },
    med:  { background: colors.gold,  color: '#3a2510' },
    low:  { background: colors.gray,  color: '#1a1a2e' },
  },
  sugInfo: { flex: 1, minWidth: 0 },
  sugNombre: { fontWeight: 700, fontSize: 13, color: '#f0f0f0', marginBottom: 2 },
  sugMeta: { fontSize: 11, color: colors.gray, marginBottom: 4 },
  razones: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  razon: { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: colors.card2, color: colors.gray, border: `1px solid ${colors.border}` },
  razonStyles: {
    dte:    { background: '#1a3a1a', borderColor: '#2a5a2a', color: '#86efac' },
    frec:   { background: '#1a2a4a', borderColor: '#2a4a7a', color: '#93c5fd' },
    ocr:    { background: '#3a1a2a', borderColor: '#7a2a4a', color: '#f9a8d4' },
    coment: { background: '#3a3a1a', borderColor: '#7a7a2a', color: colors.gold },
  },
  excludeFlag: { fontSize: 10, color: colors.accent, marginTop: 4, fontWeight: 600 },
  btnAsignar: { background: colors.green, color: '#0a2418', border: 'none', padding: '7px 11px', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer', alignSelf: 'center', whiteSpace: 'nowrap' },

  searchBox: { padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, background: colors.card2 },
  searchLabel: { fontSize: 10, color: colors.gray, display: 'block', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  searchInput: { width: '100%', background: colors.bg, border: `1px solid ${colors.border}`, color: '#f0f0f0', padding: '8px 11px', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' },
  searchResults: { marginTop: 7, maxHeight: 200, overflowY: 'auto' },
  searchRow: { padding: '7px 0', borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' },

  actions: { padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' },
  btnNoPl: { flex: 1, background: colors.card2, border: `1px solid ${colors.border}`, color: colors.gray, padding: '10px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 90 },
  btnSkip: { flex: 1, background: colors.card2, border: '1px solid #7a5a10', color: colors.gold, padding: '10px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 90 },

  toast: { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '13px 20px', borderRadius: 11, fontWeight: 700, fontSize: 13, boxShadow: '0 6px 18px rgba(0,0,0,0.4)', zIndex: 1000 },
  toastOk:    { background: colors.green, color: '#0a2418' },
  toastWarn:  { background: colors.gold,  color: '#3a2510' },
  toastInfo:  { background: colors.blue,  color: '#0a1a3a' },
  toastError: { background: colors.accent, color: '#fff' },

  modalBg: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 20 },
  modal: { background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 20, maxWidth: 460, width: '100%', boxShadow: '0 12px 36px rgba(0,0,0,0.5)' },
  confirmWarn: { padding: 12, background: 'rgba(255,214,10,0.1)', border: '1px solid rgba(255,214,10,0.3)', borderRadius: 8, color: colors.gold, fontSize: 13 },
  confirmOk:   { padding: 12, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 8, color: colors.green, fontSize: 13 },
  btnCancel:   { flex: 1, background: colors.card2, border: `1px solid ${colors.border}`, color: '#f0f0f0', padding: '10px', borderRadius: 7, cursor: 'pointer', fontWeight: 600 },
  btnConfirm:  { flex: 2, background: colors.accent, border: 'none', color: '#fff', padding: '10px', borderRadius: 7, cursor: 'pointer', fontWeight: 700 },

  fotoZoomImg: { maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.6)' },
}
