import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { STORES, fmtDate } from '../../config'

/* ── helpers ────────────────────────────────────────────────── */
const badge = (n, color = '#e63946') => (
  <span style={{
    background: n > 0 ? color : '#333',
    color: '#fff',
    borderRadius: 12,
    padding: '2px 10px',
    fontSize: 13,
    fontWeight: 700,
    marginLeft: 8,
    minWidth: 24,
    display: 'inline-block',
    textAlign: 'center',
  }}>{n}</span>
)

function SectionCard({ icon, title, count, color, children }) {
  const [open, setOpen] = useState(count > 0)
  return (
    <div style={{
      background: '#1a1a2e',
      border: `1px solid ${count > 0 ? color : '#333'}`,
      borderRadius: 12,
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          background: count > 0 ? `${color}15` : 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>{icon}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#eee' }}>{title}</span>
          {badge(count, color)}
        </div>
        <span style={{ color: '#888', fontSize: 18 }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && count > 0 && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid #ffffff10' }}>
          {children}
        </div>
      )}
    </div>
  )
}

const itemRow = (left, right, sub, onClick) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid #ffffff08',
      cursor: onClick ? 'pointer' : 'default',
    }}
  >
    <div>
      <div style={{ fontSize: 13, color: '#ddd', fontWeight: 600 }}>{left}</div>
      {sub && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{sub}</div>}
    </div>
    <div style={{ fontSize: 12, color: '#aaa', textAlign: 'right', flexShrink: 0 }}>{right}</div>
  </div>
)

/* ── main component ─────────────────────────────────────────── */
export default function PendientesView({ user, onNavigate }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({
    huerfanas: [],
    devoluciones: [],
    incidentes: [],
    incidentesProd: [],
    pedidos: [],
    ordenes: [],
    despachos: [],
    planillas: [],
    entregas: [],
  })
  const [lastRefresh, setLastRefresh] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      // Run all queries in parallel
      const [
        rHuerfanas,
        rDevoluciones,
        rIncidentes,
        rIncidentesProd,
        rPedidos,
        rOrdenes,
        rDespachos,
        rPlanillas,
        rEntregas,
      ] = await Promise.all([
        // 1. Recepciones huérfanas (sin DTE)
        supabase.rpc('get_recepciones_huerfanas').then(r => r.data || []).catch(() =>
          // Fallback: manual query if RPC doesn't exist
          supabase
            .from('recepciones')
            .select('id, fecha, proveedor, dte_codigo, foto_url')
            .not('dte_codigo', 'is', null)
            .order('fecha', { ascending: false })
            .then(async (res) => {
              if (!res.data?.length) return []
              const codigos = res.data.map(r => r.dte_codigo)
              const { data: dtes } = await supabase
                .from('compras_dte')
                .select('dte_codigo')
                .in('dte_codigo', codigos)
              const matched = new Set((dtes || []).map(d => d.dte_codigo))
              return res.data.filter(r => !matched.has(r.dte_codigo))
            })
        ),

        // 2. Devoluciones pendientes
        supabase
          .from('devoluciones_sucursal')
          .select('id, fecha, sucursal_id, tipo, estado, motivo, created_at')
          .in('estado', ['pendiente', 'enviada'])
          .order('created_at', { ascending: false })
          .then(r => r.data || []),

        // 3. Incidentes abiertos (sucursales)
        supabase
          .from('incidentes')
          .select('id, fecha, sucursal_id, categoria, severidad, descripcion, estado')
          .not('estado', 'in', '("resuelto","cerrado")')
          .order('fecha', { ascending: false })
          .then(r => r.data || []),

        // 4. Incidentes producción con seguimiento
        supabase
          .from('incidentes_produccion')
          .select('id, fecha, categoria, severidad, descripcion, requiere_seguimiento, seguimiento_resuelto')
          .eq('requiere_seguimiento', true)
          .eq('seguimiento_resuelto', false)
          .order('fecha', { ascending: false })
          .then(r => r.data || []),

        // 5. Pedidos pendientes
        supabase
          .from('pedidos_sucursal')
          .select('id, fecha, sucursal_id, estado, total, created_at')
          .in('estado', ['pendiente', 'borrador'])
          .order('created_at', { ascending: false })
          .then(r => r.data || []),

        // 6. Órdenes de compra pendientes
        supabase
          .from('ordenes_compra')
          .select('id, fecha, proveedor_id, estado, total, created_at')
          .in('estado', ['borrador', 'pendiente'])
          .order('created_at', { ascending: false })
          .then(r => r.data || []),

        // 7. Despachos en preparación
        supabase
          .from('despachos_sucursal')
          .select('id, fecha, sucursal_destino_id, estado, created_at')
          .in('estado', ['pendiente', 'preparando'])
          .order('created_at', { ascending: false })
          .then(r => r.data || []),

        // 8. Planillas sin aprobar
        supabase
          .from('planillas')
          .select('id, quincena, mes, anio, estado, created_at')
          .in('estado', ['borrador', 'pendiente'])
          .order('created_at', { ascending: false })
          .then(r => r.data || []),

        // 9. Entregas por confirmar (hoy)
        supabase
          .from('despachos_sucursal')
          .select('id, fecha, sucursal_destino_id, estado, created_at')
          .eq('estado', 'en_ruta')
          .order('created_at', { ascending: false })
          .then(r => r.data || []),
      ])

      setData({
        huerfanas: rHuerfanas,
        devoluciones: rDevoluciones,
        incidentes: rIncidentes,
        incidentesProd: rIncidentesProd,
        pedidos: rPedidos,
        ordenes: rOrdenes,
        despachos: rDespachos,
        planillas: rPlanillas,
        entregas: rEntregas,
      })
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Error cargando pendientes:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const totalPendientes =
    data.huerfanas.length +
    data.devoluciones.length +
    data.incidentes.length +
    data.incidentesProd.length +
    data.pedidos.length +
    data.ordenes.length +
    data.despachos.length +
    data.planillas.length +
    data.entregas.length

  const nav = (screen) => onNavigate && onNavigate(screen)

  return (
    <div style={{ padding: '16px', maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
            Panel de Pendientes
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            {lastRefresh
              ? `Actualizado ${lastRefresh.toLocaleTimeString('es-SV')}`
              : 'Cargando...'}
          </div>
        </div>
        <button
          onClick={cargar}
          disabled={loading}
          style={{
            background: '#2d6a4f',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? '...' : 'Refrescar'}
        </button>
      </div>

      {/* Summary bar */}
      <div style={{
        background: totalPendientes > 0 ? '#e6394615' : '#2d6a4f15',
        border: `1px solid ${totalPendientes > 0 ? '#e63946' : '#2d6a4f'}`,
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 16,
        textAlign: 'center',
      }}>
        <span style={{ fontSize: 32, fontWeight: 800, color: totalPendientes > 0 ? '#e63946' : '#4ade80' }}>
          {totalPendientes}
        </span>
        <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>
          {totalPendientes === 0 ? 'Todo al día' : 'tareas pendientes'}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          Cargando pendientes...
        </div>
      )}

      {!loading && (
        <>
          {/* 1. Recepciones huérfanas */}
          <SectionCard icon="🔴" title="Recepciones sin DTE" count={data.huerfanas.length} color="#e63946">
            {data.huerfanas.map(r => (
              <div key={r.id} onClick={() => nav('historial')} style={{ cursor: 'pointer' }}>
                {itemRow(`${r.proveedor || 'Sin proveedor'}`, `****${r.dte_codigo}`, r.fecha ? fmtDate(r.fecha) : '')}
              </div>
            ))}
          </SectionCard>

          {/* 2. Devoluciones */}
          <SectionCard icon="🔄" title="Devoluciones por confirmar" count={data.devoluciones.length} color="#f4a261">
            {data.devoluciones.map(d => (
              <div key={d.id} onClick={() => nav('devoluciones')} style={{ cursor: 'pointer' }}>
                {itemRow(`${d.tipo || 'Devolución'} — ${STORES[d.sucursal_id] || d.sucursal_id?.slice(0,8)}`, d.estado, d.motivo?.slice(0,50) || fmtDate(d.fecha || d.created_at))}
              </div>
            ))}
          </SectionCard>

          {/* 3. Incidentes sucursales */}
          <SectionCard icon="🚨" title="Incidentes abiertos" count={data.incidentes.length} color="#e63946">
            {data.incidentes.map(i => (
              <div key={i.id} onClick={() => nav('incidentes')} style={{ cursor: 'pointer' }}>
                {itemRow(`[${i.severidad?.toUpperCase()}] ${i.categoria}`, STORES[i.sucursal_id] || i.sucursal_id?.slice(0,8), `${i.descripcion?.slice(0,60)}`)}
              </div>
            ))}
          </SectionCard>

          {/* 4. Incidentes producción */}
          <SectionCard icon="🏭" title="Seguimiento producción" count={data.incidentesProd.length} color="#f4a261">
            {data.incidentesProd.map(i => (
              <div key={i.id} onClick={() => nav('incidentes-cm')} style={{ cursor: 'pointer' }}>
                {itemRow(`[${i.severidad}] ${i.categoria}`, fmtDate(i.fecha), i.descripcion?.slice(0,60))}
              </div>
            ))}
          </SectionCard>

          {/* 5. Pedidos */}
          <SectionCard icon="📦" title="Pedidos por aprobar" count={data.pedidos.length} color="#457b9d">
            {data.pedidos.map(p => (
              <div key={p.id} onClick={() => nav('conteo')} style={{ cursor: 'pointer' }}>
                {itemRow(STORES[p.sucursal_id] || p.sucursal_id?.slice(0,8), `$${parseFloat(p.total||0).toFixed(2)}`, `${p.estado} — ${fmtDate(p.fecha || p.created_at)}`)}
              </div>
            ))}
          </SectionCard>

          {/* 6. Órdenes de compra */}
          <SectionCard icon="🛒" title="Órdenes de compra pendientes" count={data.ordenes.length} color="#457b9d">
            {data.ordenes.map(o => (
              <div key={o.id} onClick={() => nav('compras')} style={{ cursor: 'pointer' }}>
                {itemRow(`OC #${o.id?.slice(0,8)}`, o.estado, fmtDate(o.fecha || o.created_at))}
              </div>
            ))}
          </SectionCard>

          {/* 7. Despachos en preparación */}
          <SectionCard icon="🚚" title="Despachos en preparación" count={data.despachos.length} color="#457b9d">
            {data.despachos.map(d => (
              <div key={d.id} onClick={() => nav('despacho')} style={{ cursor: 'pointer' }}>
                {itemRow(STORES[d.sucursal_destino_id] || d.sucursal_destino_id?.slice(0,8), d.estado, fmtDate(d.fecha || d.created_at))}
              </div>
            ))}
          </SectionCard>

          {/* 8. Entregas en ruta */}
          <SectionCard icon="✅" title="Entregas por confirmar" count={data.entregas.length} color="#2d6a4f">
            {data.entregas.map(e => (
              <div key={e.id} onClick={() => nav('entregas')} style={{ cursor: 'pointer' }}>
                {itemRow(STORES[e.sucursal_destino_id] || e.sucursal_destino_id?.slice(0,8), 'en ruta', fmtDate(e.fecha || e.created_at))}
              </div>
            ))}
          </SectionCard>

          {/* 9. Planilla */}
          <SectionCard icon="💵" title="Planillas por aprobar" count={data.planillas.length} color="#f4a261">
            {data.planillas.map(p => (
              <div key={p.id} onClick={() => nav('planilla')} style={{ cursor: 'pointer' }}>
                {itemRow(`Q${p.quincena} — ${p.mes}/${p.anio}`, p.estado, fmtDate(p.created_at))}
              </div>
            ))}
          </SectionCard>

          {/* All clear */}
          {totalPendientes === 0 && (
            <div style={{
              textAlign: 'center',
              padding: 40,
              color: '#4ade80',
              fontSize: 16,
              fontWeight: 700,
            }}>
              Todo al día. No hay tareas pendientes.
            </div>
          )}
        </>
      )}
    </div>
  )
}
