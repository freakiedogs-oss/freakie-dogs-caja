import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'

const ESTADOS = ['pendiente', 'confirmado', 'ignorar']
const TABS = ['mapeo', 'unidades']

const BADGE = {
  pendiente:  { bg: '#FEF3C7', color: '#92400E', label: '⏳ Pendiente' },
  confirmado: { bg: '#D1FAE5', color: '#065F46', label: '✅ Confirmado' },
  ignorar:    { bg: '#F3F4F6', color: '#6B7280', label: '🚫 Ignorar' },
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 18px', minWidth: 100 }}>
      <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || '#111827', marginTop: 2 }}>{value}</div>
    </div>
  )
}

/* ---- Verificar Unidades sub-view ---- */
function VerificarUnidades() {
  const [datos, setDatos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('todos') // todos | ok | warning | error

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      // Traer catálogo con unidades + contenido_neto
      const { data: cat } = await db
        .from('catalogo_productos')
        .select('id, nombre, categoria, unidad_medida, contenido_neto, unidad_contenido')
        .eq('activo', true)
        .order('nombre')

      // Traer ingredientes de recetas (materia prima)
      const { data: ingr } = await db
        .from('receta_ingredientes')
        .select('id, producto_id, cantidad, unidad_medida, cantidad_catalogo, notas, receta_id')
        .eq('tipo_ingrediente', 'materia_prima')

      // Traer recetas para nombres
      const { data: recetas } = await db
        .from('recetas')
        .select('id, nombre')

      // Traer mapeos DTE confirmados/pendientes
      const { data: mapeos } = await db
        .from('dte_item_catalogo_map')
        .select('catalogo_id, dte_descripcion, unidad_compra, factor_conversion, estado')

      const catMap = {}
      ;(cat || []).forEach(c => { catMap[c.id] = c })
      const recetaMap = {}
      ;(recetas || []).forEach(r => { recetaMap[r.id] = r.nombre })
      const mapeosByCat = {}
      ;(mapeos || []).forEach(m => {
        if (m.catalogo_id) {
          if (!mapeosByCat[m.catalogo_id]) mapeosByCat[m.catalogo_id] = []
          mapeosByCat[m.catalogo_id].push(m)
        }
      })

      // Agrupar por producto catálogo
      const porProducto = {}
      ;(ingr || []).forEach(i => {
        const pid = i.producto_id
        if (!porProducto[pid]) porProducto[pid] = { producto: catMap[pid], recetas: [], mapeos: mapeosByCat[pid] || [] }
        porProducto[pid].recetas.push({ ...i, receta_nombre: recetaMap[i.receta_id] || '?' })
      })

      // Calcular status de cada producto
      const resultado = Object.values(porProducto).map(p => {
        const prod = p.producto
        if (!prod) return null
        const tieneMapeo = p.mapeos.length > 0
        const tieneContenido = prod.contenido_neto != null
        const todasConvertidas = p.recetas.every(r => r.cantidad_catalogo != null)
        const unidadBase = prod.unidad_medida

        let status = 'ok'
        let problemas = []

        if (!tieneMapeo) { status = 'warning'; problemas.push('Sin mapeo DTE') }
        if (!tieneContenido && p.recetas.some(r => r.unidad_medida !== unidadBase)) {
          status = 'error'; problemas.push('Falta contenido_neto para conversión')
        }
        if (!todasConvertidas) { status = 'error'; problemas.push('cantidad_catalogo incompleto') }

        // Verificar conversiones sospechosas (>100x o <0.0001)
        p.recetas.forEach(r => {
          if (r.cantidad_catalogo && r.cantidad > 0) {
            const ratio = r.cantidad_catalogo / r.cantidad
            if (ratio > 100 || ratio < 0.0001) {
              status = 'warning'
              problemas.push(`Ratio ${ratio.toFixed(4)} sospechoso en ${r.receta_nombre}`)
            }
          }
        })

        return { ...p, status, problemas }
      }).filter(Boolean).sort((a, b) => {
        const orden = { error: 0, warning: 1, ok: 2 }
        return (orden[a.status] ?? 3) - (orden[b.status] ?? 3) || a.producto.nombre.localeCompare(b.producto.nombre)
      })

      setDatos(resultado)
      setLoading(false)
    })()
  }, [])

  const statusIcon = { ok: '✅', warning: '⚠️', error: '❌' }
  const statusColor = { ok: '#059669', warning: '#D97706', error: '#DC2626' }

  const filtrados = datos.filter(d => filtro === 'todos' || d.status === filtro)
  const counts = { ok: 0, warning: 0, error: 0 }
  datos.forEach(d => { counts[d.status] = (counts[d.status] || 0) + 1 })

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>Cargando verificación de unidades...</div>

  return (
    <div>
      {/* Mini stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Productos OK" value={counts.ok} color="#059669" />
        <StatCard label="Advertencias" value={counts.warning} color="#D97706" />
        <StatCard label="Errores" value={counts.error} color="#DC2626" />
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {['todos', 'error', 'warning', 'ok'].map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{
            padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 12,
            background: filtro === f ? '#1D4ED8' : '#F3F4F6',
            color: filtro === f ? '#fff' : '#6B7280'
          }}>
            {f === 'todos' ? `Todos (${datos.length})` :
             f === 'error' ? `❌ Errores (${counts.error})` :
             f === 'warning' ? `⚠️ Advertencias (${counts.warning})` :
             `✅ OK (${counts.ok})`}
          </button>
        ))}
      </div>

      {/* Lista de productos */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtrados.map(item => (
          <div key={item.producto.id} style={{
            background: '#fff', border: `1px solid ${item.status === 'error' ? '#FCA5A5' : item.status === 'warning' ? '#FCD34D' : '#E5E7EB'}`,
            borderRadius: 12, overflow: 'hidden'
          }}>
            {/* Header producto */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18 }}>{statusIcon[item.status]}</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{item.producto.nombre}</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  {item.producto.categoria} ·
                  Unidad: <strong style={{ color: '#1D4ED8' }}>{item.producto.unidad_medida}</strong>
                  {item.producto.contenido_neto && (
                    <> · {item.producto.contenido_neto} {item.producto.unidad_contenido} por {item.producto.unidad_medida}</>
                  )}
                </div>
              </div>
              {item.problemas.length > 0 && (
                <div style={{ fontSize: 11, color: statusColor[item.status], fontWeight: 600, maxWidth: 300 }}>
                  {item.problemas.join(' · ')}
                </div>
              )}
            </div>

            {/* Cadena: DTE → Catálogo → Receta */}
            <div style={{ borderTop: '1px solid #F3F4F6', padding: '8px 16px', fontSize: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {/* DTE Mapeos */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, color: '#6B7280', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
                  DTE (Facturas)
                </div>
                {item.mapeos.length === 0 ? (
                  <div style={{ color: '#D97706', fontStyle: 'italic' }}>Sin mapeo DTE</div>
                ) : item.mapeos.map((m, i) => (
                  <div key={i} style={{ marginBottom: 3, color: '#374151' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{m.dte_descripcion}</span>
                    <span style={{ color: '#9CA3AF' }}> · {m.unidad_compra || '?'} · x{m.factor_conversion}</span>
                    <span style={{
                      marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: m.estado === 'confirmado' ? '#D1FAE5' : '#FEF3C7',
                      color: m.estado === 'confirmado' ? '#065F46' : '#92400E'
                    }}>{m.estado}</span>
                  </div>
                ))}
              </div>

              {/* Recetas que lo usan */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, color: '#6B7280', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
                  Recetas (Uso)
                </div>
                {item.recetas.map((r, i) => {
                  const match = r.unidad_medida?.toLowerCase() === item.producto.unidad_medida?.toLowerCase()
                  return (
                    <div key={i} style={{ marginBottom: 3, color: '#374151' }}>
                      <span style={{ fontWeight: 600 }}>{r.receta_nombre}:</span>{' '}
                      {r.cantidad} {r.unidad_medida}
                      {' → '}
                      <span style={{ color: r.cantidad_catalogo ? '#059669' : '#DC2626', fontWeight: 700 }}>
                        {r.cantidad_catalogo ? `${parseFloat(r.cantidad_catalogo).toFixed(4)} ${item.producto.unidad_medida}` : 'FALTA'}
                      </span>
                      {match && <span style={{ color: '#9CA3AF', marginLeft: 4, fontSize: 10 }}>(directo)</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtrados.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', background: '#F9FAFB', borderRadius: 12, border: '1px dashed #D1D5DB' }}>
          No hay productos con este filtro.
        </div>
      )}
    </div>
  )
}

/* ---- Main Component ---- */
export default function DTEMapeoView({ user }) {
  const [tab, setTab] = useState('mapeo')
  const [mapeos, setMapeos] = useState([])
  const [catalogo, setCatalogo] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('pendiente')
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState(null)
  const [editData, setEditData] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [stats, setStats] = useState({ pendiente: 0, confirmado: 0, ignorar: 0, total: 0 })

  const showToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  const cargarCatalogo = useCallback(async () => {
    const categorias = [
      'Insumo Cocina', 'Insumo Hamburguesa', 'Salsas y Aderezos',
      'Bebidas', 'Panes', 'Vegetales y Verduras', 'Quesos y Lácteos', 'Carnes'
    ]
    const { data } = await db
      .from('catalogo_productos')
      .select('id, nombre, categoria, unidad_medida')
      .eq('activo', true)
      .in('categoria', categorias)
      .order('nombre')
    setCatalogo(data || [])
  }, [])

  const cargarMapeos = useCallback(async () => {
    setLoading(true)
    const { data: allRows } = await db
      .from('dte_item_catalogo_map')
      .select('estado')
    const s = { pendiente: 0, confirmado: 0, ignorar: 0, total: 0 }
    ;(allRows || []).forEach(r => { s[r.estado] = (s[r.estado] || 0) + 1; s.total++ })
    setStats(s)

    const { data } = await db
      .from('dte_item_catalogo_map')
      .select(`
        id, dte_descripcion, dte_unidad, factor_conversion, unidad_compra,
        notas, estado, mapeado_por, updated_at,
        catalogo_productos(id, nombre, categoria, unidad_medida, precio_referencia, contenido_neto, unidad_contenido)
      `)
      .eq('estado', filtroEstado)
      .order('dte_descripcion')
    setMapeos(data || [])
    setLoading(false)
  }, [filtroEstado])

  useEffect(() => {
    cargarCatalogo()
  }, [cargarCatalogo])

  useEffect(() => {
    if (tab === 'mapeo') cargarMapeos()
  }, [cargarMapeos, tab])

  const mapeosFiltrados = mapeos.filter(m =>
    !busqueda || m.dte_descripcion.toLowerCase().includes(busqueda.toLowerCase())
  )

  const abrirEditor = (mapeo) => {
    setEditando(mapeo.id)
    setEditData({
      catalogo_id: mapeo.catalogo_productos?.id || '',
      factor_conversion: mapeo.factor_conversion || 1,
      unidad_compra: mapeo.unidad_compra || '',
      notas: mapeo.notas || '',
      estado: mapeo.estado
    })
  }

  const cerrarEditor = () => {
    setEditando(null)
    setEditData({})
  }

  const guardarEdicion = async (id) => {
    setSaving(true)
    const payload = {
      catalogo_id: editData.catalogo_id || null,
      factor_conversion: parseFloat(editData.factor_conversion) || 1,
      unidad_compra: editData.unidad_compra || null,
      notas: editData.notas || null,
      estado: editData.estado,
      mapeado_por: user?.nombre || user?.email || 'usuario'
    }
    const { error } = await db
      .from('dte_item_catalogo_map')
      .update(payload)
      .eq('id', id)
    setSaving(false)
    if (error) { showToast('Error guardando: ' + error.message, 'error'); return }
    showToast('Mapeo guardado')
    cerrarEditor()
    cargarMapeos()
  }

  const confirmarRapido = async (mapeo) => {
    if (!mapeo.catalogo_productos?.id) {
      showToast('Asigna un producto antes de confirmar', 'error')
      abrirEditor(mapeo)
      return
    }
    setSaving(true)
    const { error } = await db
      .from('dte_item_catalogo_map')
      .update({ estado: 'confirmado', mapeado_por: user?.nombre || 'usuario' })
      .eq('id', mapeo.id)
    setSaving(false)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast('Confirmado')
    setMapeos(prev => prev.filter(m => m.id !== mapeo.id))
    setStats(prev => ({ ...prev, pendiente: prev.pendiente - 1, confirmado: prev.confirmado + 1 }))
  }

  const ignorarRapido = async (mapeo) => {
    setSaving(true)
    const { error } = await db
      .from('dte_item_catalogo_map')
      .update({ estado: 'ignorar', mapeado_por: user?.nombre || 'usuario' })
      .eq('id', mapeo.id)
    setSaving(false)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast('Ignorado')
    setMapeos(prev => prev.filter(m => m.id !== mapeo.id))
    setStats(prev => ({ ...prev, pendiente: prev.pendiente - 1, ignorar: prev.ignorar + 1 }))
  }

  const catalogoPorCategoria = catalogo.reduce((acc, p) => {
    if (!acc[p.categoria]) acc[p.categoria] = []
    acc[p.categoria].push(p)
    return acc
  }, {})

  return (
    <div style={{ padding: '0 0 40px 0', maxWidth: 1100 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.tipo === 'error' ? '#FEE2E2' : '#D1FAE5',
          color: toast.tipo === 'error' ? '#991B1B' : '#065F46',
          border: `1px solid ${toast.tipo === 'error' ? '#FCA5A5' : '#6EE7B7'}`,
          borderRadius: 10, padding: '12px 20px', fontWeight: 600, fontSize: 14,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>{toast.msg}</div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#111827' }}>
          Mapeo DTE → Catalogo
        </h2>
        <p style={{ margin: '4px 0 0', color: '#6B7280', fontSize: 13 }}>
          Vincula facturas DTE con ingredientes del catalogo y verifica la cadena de unidades hasta las recetas.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #E5E7EB', paddingBottom: 0 }}>
        <button onClick={() => setTab('mapeo')} style={{
          padding: '8px 20px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
          borderBottom: tab === 'mapeo' ? '3px solid #1D4ED8' : '3px solid transparent',
          color: tab === 'mapeo' ? '#1D4ED8' : '#6B7280',
          background: 'transparent', marginBottom: -2
        }}>
          Mapeo DTE
        </button>
        <button onClick={() => setTab('unidades')} style={{
          padding: '8px 20px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
          borderBottom: tab === 'unidades' ? '3px solid #1D4ED8' : '3px solid transparent',
          color: tab === 'unidades' ? '#1D4ED8' : '#6B7280',
          background: 'transparent', marginBottom: -2
        }}>
          Verificar Unidades
        </button>
      </div>

      {/* Tab: Verificar Unidades */}
      {tab === 'unidades' && <VerificarUnidades />}

      {/* Tab: Mapeo DTE */}
      {tab === 'mapeo' && (
        <>
          {/* Stats */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <StatCard label="Total" value={stats.total} color="#1D4ED8" />
            <StatCard label="Pendientes" value={stats.pendiente} color="#D97706" />
            <StatCard label="Confirmados" value={stats.confirmado} color="#059669" />
            <StatCard label="Ignorados" value={stats.ignorar} color="#9CA3AF" />
          </div>

          {/* Progreso */}
          {stats.total > 0 && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Progreso de mapeo</span>
                <span style={{ fontSize: 13, color: '#6B7280' }}>
                  {stats.confirmado} / {stats.total - stats.ignorar} activos confirmados
                </span>
              </div>
              <div style={{ height: 8, background: '#F3F4F6', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round((stats.confirmado / Math.max(stats.total - stats.ignorar, 1)) * 100)}%`,
                  background: 'linear-gradient(90deg, #059669, #10B981)',
                  borderRadius: 4, transition: 'width 0.4s'
                }} />
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                {Math.round((stats.confirmado / Math.max(stats.total - stats.ignorar, 1)) * 100)}% completado
              </div>
            </div>
          )}

          {/* Filtros */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {ESTADOS.map(e => (
                <button key={e} onClick={() => setFiltroEstado(e)} style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontWeight: 600, fontSize: 13, transition: 'all 0.2s',
                  background: filtroEstado === e ? BADGE[e].bg : '#F9FAFB',
                  color: filtroEstado === e ? BADGE[e].color : '#6B7280',
                  outline: filtroEstado === e ? `2px solid ${BADGE[e].color}` : 'none'
                }}>
                  {BADGE[e].label} ({stats[e] || 0})
                </button>
              ))}
            </div>
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar descripcion DTE..."
              style={{
                flex: 1, minWidth: 200, padding: '7px 12px', borderRadius: 8,
                border: '1px solid #D1D5DB', fontSize: 13, outline: 'none'
              }}
            />
          </div>

          {/* Lista */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>Cargando mapeos...</div>
          ) : mapeosFiltrados.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: 40, background: '#F9FAFB',
              borderRadius: 12, border: '1px dashed #D1D5DB', color: '#6B7280'
            }}>
              {filtroEstado === 'confirmado' ? 'Todo confirmado en esta vista.' :
               filtroEstado === 'ignorar' ? 'No hay items ignorados.' :
               'No hay pendientes. Todo mapeado!'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mapeosFiltrados.map(m => (
                <div key={m.id} style={{
                  background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
                  overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                }}>
                  {/* Fila principal */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
                    {/* Descripcion DTE */}
                    <div style={{ flex: 2, minWidth: 200 }}>
                      <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 2 }}>
                        Descripcion DTE
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', fontFamily: 'monospace' }}>
                        {m.dte_descripcion}
                      </div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
                        SAF: {m.dte_unidad || '?'}
                        {m.unidad_compra && <> · Compra: <strong style={{ color: '#374151' }}>{m.unidad_compra}</strong></>}
                      </div>
                    </div>

                    {/* Flecha */}
                    <div style={{ color: '#9CA3AF', fontSize: 20 }}>→</div>

                    {/* Producto catalogo */}
                    <div style={{ flex: 2, minWidth: 160 }}>
                      <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 2 }}>
                        Producto Catalogo
                      </div>
                      {m.catalogo_productos ? (
                        <>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#1D4ED8' }}>
                            {m.catalogo_productos.nombre}
                          </div>
                          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>
                            {m.catalogo_productos.categoria} · <strong>{m.catalogo_productos.unidad_medida}</strong>
                            {m.catalogo_productos.contenido_neto && (
                              <span style={{ color: '#059669' }}>
                                {' '}({m.catalogo_productos.contenido_neto} {m.catalogo_productos.unidad_contenido})
                              </span>
                            )}
                            {m.catalogo_productos.precio_referencia && ` · $${m.catalogo_productos.precio_referencia}`}
                          </div>
                        </>
                      ) : (
                        <div style={{ color: '#EF4444', fontWeight: 600, fontSize: 13 }}>
                          Sin producto asignado
                        </div>
                      )}
                    </div>

                    {/* Factor */}
                    <div style={{ minWidth: 80, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 2 }}>
                        Factor
                      </div>
                      <div style={{
                        fontWeight: 800, fontSize: 16, color: '#374151',
                        background: '#F3F4F6', borderRadius: 6, padding: '2px 10px', display: 'inline-block'
                      }}>
                        x{m.factor_conversion}
                      </div>
                    </div>

                    {/* Acciones */}
                    {filtroEstado === 'pendiente' && editando !== m.id && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => confirmarRapido(m)} disabled={saving} style={{
                          padding: '6px 12px', background: '#059669', color: '#fff',
                          border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12
                        }}>OK</button>
                        <button onClick={() => abrirEditor(m)} style={{
                          padding: '6px 12px', background: '#EFF6FF', color: '#1D4ED8',
                          border: '1px solid #BFDBFE', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12
                        }}>Editar</button>
                        <button onClick={() => ignorarRapido(m)} disabled={saving} style={{
                          padding: '6px 10px', background: '#F9FAFB', color: '#9CA3AF',
                          border: '1px solid #E5E7EB', borderRadius: 7, cursor: 'pointer', fontSize: 12
                        }}>X</button>
                      </div>
                    )}
                    {filtroEstado !== 'pendiente' && editando !== m.id && (
                      <button onClick={() => abrirEditor(m)} style={{
                        padding: '6px 12px', background: '#EFF6FF', color: '#1D4ED8',
                        border: '1px solid #BFDBFE', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12
                      }}>Editar</button>
                    )}
                  </div>

                  {/* Notas */}
                  {m.notas && editando !== m.id && (
                    <div style={{ padding: '0 16px 10px', fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>
                      {m.notas}
                    </div>
                  )}

                  {/* Editor inline */}
                  {editando === m.id && (
                    <div style={{
                      background: '#F8FAFF', borderTop: '1px solid #DBEAFE',
                      padding: '16px', display: 'flex', flexDirection: 'column', gap: 12
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1D4ED8', marginBottom: 4 }}>
                        Editando mapeo
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {/* Selector catalogo */}
                        <div style={{ flex: 3, minWidth: 240 }}>
                          <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            Producto Catalogo
                          </label>
                          <select
                            value={editData.catalogo_id}
                            onChange={e => setEditData(d => ({ ...d, catalogo_id: e.target.value }))}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12 }}
                          >
                            <option value="">-- Sin asignar --</option>
                            {Object.entries(catalogoPorCategoria).map(([cat, prods]) => (
                              <optgroup key={cat} label={cat}>
                                {prods.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.nombre} ({p.unidad_medida})
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>

                        {/* Factor conversion */}
                        <div style={{ minWidth: 110 }}>
                          <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            Factor conversion
                          </label>
                          <input
                            type="number" step="0.001" min="0.001"
                            value={editData.factor_conversion}
                            onChange={e => setEditData(d => ({ ...d, factor_conversion: e.target.value }))}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12 }}
                          />
                        </div>

                        {/* Unidad compra */}
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            Unidad de compra
                          </label>
                          <input
                            type="text"
                            value={editData.unidad_compra}
                            onChange={e => setEditData(d => ({ ...d, unidad_compra: e.target.value }))}
                            placeholder="ej: caja 6x5lb, kg, lb"
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12 }}
                          />
                        </div>

                        {/* Estado */}
                        <div style={{ minWidth: 120 }}>
                          <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            Estado
                          </label>
                          <select
                            value={editData.estado}
                            onChange={e => setEditData(d => ({ ...d, estado: e.target.value }))}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12 }}
                          >
                            {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Notas */}
                      <div>
                        <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Notas
                        </label>
                        <input
                          type="text"
                          value={editData.notas}
                          onChange={e => setEditData(d => ({ ...d, notas: e.target.value }))}
                          placeholder="Notas opcionales..."
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12 }}
                        />
                      </div>

                      {/* Hint factor */}
                      <div style={{ fontSize: 11, color: '#6B7280', background: '#EFF6FF', borderRadius: 6, padding: '6px 10px' }}>
                        <strong>Factor:</strong> Si el DTE viene en cajas de 6x5lb y el catalogo es en lb, factor = 30.
                        Si viene en kg y catalogo es lb, factor = 2.205. Factor 1 = misma unidad.
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => guardarEdicion(m.id)} disabled={saving} style={{
                          padding: '8px 20px', background: '#1D4ED8', color: '#fff',
                          border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13
                        }}>
                          {saving ? 'Guardando...' : 'Guardar'}
                        </button>
                        <button onClick={cerrarEditor} style={{
                          padding: '8px 16px', background: '#fff', color: '#6B7280',
                          border: '1px solid #D1D5DB', borderRadius: 8, cursor: 'pointer', fontSize: 13
                        }}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Info footer */}
          <div style={{
            marginTop: 24, padding: '14px 18px', background: '#FFFBEB',
            border: '1px solid #FCD34D', borderRadius: 10, fontSize: 12, color: '#78350F'
          }}>
            <strong>Factor de Conversion:</strong> Indica cuantas unidades del catalogo equivalen a 1 unidad en el DTE.
            Ejemplo: si el DTE registra "cajas" de 30 lbs y el catalogo mide en "lb", factor = 30.
            Asi el Kardex calcula el costo real por lb de cada ingrediente.
          </div>
        </>
      )}
    </div>
  )
}
