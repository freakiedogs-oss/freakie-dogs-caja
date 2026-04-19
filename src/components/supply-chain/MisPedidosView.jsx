import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { STORES, fmtDate, n } from '../../config';
import { useToast } from '../../hooks/useToast';
import { Badge } from '../ui/Badge';

// ── MIS PEDIDOS (view-only, gerente/cocina de sucursal) ─────────
// Historial de pedidos de la sucursal del usuario + estado del proceso:
// enviado → preparando → despachado → recibido
// Solo lectura: no edita ni aprueba nada. Filtro fecha (default 30d).
// ─────────────────────────────────────────────────────────────

const ROLES_VER_TODAS = ['ejecutivo', 'admin', 'superadmin', 'jefe_casa_matriz'];

const STEPS = [
  { key: 'enviado',    label: 'Enviado',    icon: '📤' },
  { key: 'preparando', label: 'Preparando', icon: '📦' },
  { key: 'despachado', label: 'Despachado', icon: '🚚' },
  { key: 'recibido',   label: 'Recibido',   icon: '✅' },
];

const estadoIndex = (estado) => {
  const i = STEPS.findIndex(s => s.key === estado);
  return i < 0 ? 0 : i;
};

function RangoFechas({ desde, hasta, setDesde, setHasta }) {
  const setQuick = (dias) => {
    const h = new Date();
    const d = new Date();
    d.setDate(d.getDate() - dias);
    setDesde(d.toISOString().slice(0, 10));
    setHasta(h.toISOString().slice(0, 10));
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      <button className="btn btn-sm btn-ghost" onClick={() => setQuick(0)}>Hoy</button>
      <button className="btn btn-sm btn-ghost" onClick={() => setQuick(7)}>7 días</button>
      <button className="btn btn-sm btn-ghost" onClick={() => setQuick(30)}>30 días</button>
      <input type="date" className="input" value={desde} onChange={e => setDesde(e.target.value)} style={{ width: 130 }} />
      <span style={{ alignSelf: 'center', color: '#888' }}>→</span>
      <input type="date" className="input" value={hasta} onChange={e => setHasta(e.target.value)} style={{ width: 130 }} />
    </div>
  );
}

function Timeline({ estado, despacho }) {
  const activeIdx = estadoIndex(estado);
  // Si el pedido está 'recibido' por el despacho (no el pedido), mostrar paso 3 activo
  const despachoEstado = despacho?.estado;
  let actual = activeIdx;
  if (despachoEstado === 'recibido') actual = 3;
  else if (despachoEstado === 'despachado' || despachoEstado === 'en_ruta') actual = Math.max(actual, 2);
  else if (despachoEstado === 'preparando') actual = Math.max(actual, 1);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
      {STEPS.map((s, i) => {
        const done = i <= actual;
        const current = i === actual;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: done ? (current ? '#e63946' : '#22c55e') : '#2a2a2a',
                color: done ? '#fff' : '#666',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
                border: current ? '2px solid #fca5a5' : 'none',
              }}>{s.icon}</div>
              <div style={{
                fontSize: 10, marginTop: 3,
                color: done ? '#fff' : '#666',
                fontWeight: current ? 700 : 500,
              }}>{s.label}</div>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: '0 2px',
                background: i < actual ? '#22c55e' : '#2a2a2a',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MisPedidosView({ user, onBack }) {
  const { show, Toast } = useToast();

  // Fechas default: últimos 30 días
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [desde, setDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });

  const [sucursalId, setSucursalId] = useState(null);
  const [sucursalNombre, setSucursalNombre] = useState('');
  const [sucursales, setSucursales] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [despachos, setDespachos] = useState([]);      // despachos_sucursal indexed by pedido_id
  const [itemsPorPedido, setItemsPorPedido] = useState({});  // pedido_id → pedido_items[]
  const [itemsDespacho, setItemsDespacho] = useState({});    // despacho_id → despacho_items[]
  const [productosMap, setProductosMap] = useState({});      // producto_id → {nombre, unidad}
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');

  const canViewAll = ROLES_VER_TODAS.includes(user.rol);

  // Resolver sucursal del usuario
  useEffect(() => {
    (async () => {
      if (canViewAll) {
        const { data } = await db.from('sucursales').select('id,store_code,nombre').order('store_code');
        setSucursales(data || []);
        // Default: casa matriz no aplica aquí, usar primer local
        const first = (data || []).find(s => s.store_code?.startsWith('S') || s.store_code?.startsWith('M'));
        if (first) { setSucursalId(first.id); setSucursalNombre(first.nombre); }
      } else if (user.store_code) {
        const { data } = await db.from('sucursales').select('id,nombre').eq('store_code', user.store_code).maybeSingle();
        if (data) { setSucursalId(data.id); setSucursalNombre(data.nombre); }
      }
    })();
  }, []);

  // Cargar pedidos + despachos + items en rango
  useEffect(() => {
    if (!sucursalId) return;
    cargar();
  }, [sucursalId, desde, hasta]);

  const cargar = async () => {
    setLoading(true);
    try {
      // Pedidos en rango para esta sucursal
      const { data: peds, error: eP } = await db.from('pedidos_sucursal')
        .select('id,fecha_pedido,sucursal_id,estado,solicitado_por,fecha_entrega_estimada,notas,created_at')
        .eq('sucursal_id', sucursalId)
        .gte('fecha_pedido', desde)
        .lte('fecha_pedido', hasta)
        .order('fecha_pedido', { ascending: false })
        .order('created_at', { ascending: false });
      if (eP) throw eP;
      setPedidos(peds || []);
      const pedIds = (peds || []).map(p => p.id);

      // Despachos relacionados
      let desps = [];
      if (pedIds.length > 0) {
        const { data: d, error: eD } = await db.from('despachos_sucursal')
          .select('id,pedido_id,sucursal_id,fecha_despacho,estado,preparado_por,recibido_por,fecha_recepcion,notas_despacho,notas_recepcion,costo_total,hora_salida,hora_recepcion,motorista_nombre,foto_recepcion_url')
          .in('pedido_id', pedIds);
        if (eD) throw eD;
        desps = d || [];
      }
      setDespachos(desps);

      // Pedido items
      let pitems = {};
      if (pedIds.length > 0) {
        const { data: pi, error: ePI } = await db.from('pedido_items')
          .select('id,pedido_id,producto_id,cantidad_solicitada,cantidad_despachada,unidad')
          .in('pedido_id', pedIds);
        if (ePI) throw ePI;
        (pi || []).forEach(it => {
          if (!pitems[it.pedido_id]) pitems[it.pedido_id] = [];
          pitems[it.pedido_id].push(it);
        });
      }
      setItemsPorPedido(pitems);

      // Despacho items (para cantidad recibida)
      let ditems = {};
      if (desps.length > 0) {
        const despIds = desps.map(d => d.id);
        const { data: di, error: eDI } = await db.from('despacho_items')
          .select('id,despacho_id,producto_id,cantidad_despachada,cantidad_recibida,unidad_medida,diferencia,notas')
          .in('despacho_id', despIds);
        if (eDI) throw eDI;
        (di || []).forEach(it => {
          if (!ditems[it.despacho_id]) ditems[it.despacho_id] = [];
          ditems[it.despacho_id].push(it);
        });
      }
      setItemsDespacho(ditems);

      // Productos map
      const prodIds = new Set();
      Object.values(pitems).flat().forEach(i => prodIds.add(i.producto_id));
      Object.values(ditems).flat().forEach(i => prodIds.add(i.producto_id));
      if (prodIds.size > 0) {
        const { data: prods } = await db.from('productos')
          .select('id,nombre,unidad_medida,categoria')
          .in('id', Array.from(prodIds));
        const map = {};
        (prods || []).forEach(p => { map[p.id] = p; });
        setProductosMap(map);
      }
    } catch (e) {
      show('❌ Error al cargar: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const despachoByPedido = useMemo(() => {
    const m = {};
    despachos.forEach(d => { m[d.pedido_id] = d; });
    return m;
  }, [despachos]);

  const pedidosFiltrados = useMemo(() => {
    if (filtroEstado === 'todos') return pedidos;
    return pedidos.filter(p => {
      const d = despachoByPedido[p.id];
      const efectivo = d?.estado === 'recibido' ? 'recibido'
        : d?.estado === 'despachado' || d?.estado === 'en_ruta' ? 'despachado'
        : d?.estado === 'preparando' ? 'preparando'
        : p.estado;
      return efectivo === filtroEstado;
    });
  }, [pedidos, filtroEstado, despachoByPedido]);

  const renderItems = (pedido) => {
    const d = despachoByPedido[pedido.id];
    const pItems = itemsPorPedido[pedido.id] || [];
    const dItems = d ? (itemsDespacho[d.id] || []) : [];
    const dMap = {};
    dItems.forEach(it => { dMap[it.producto_id] = it; });

    if (pItems.length === 0) {
      return <div style={{ color: '#888', padding: 8, fontSize: 13 }}>Sin items registrados.</div>;
    }

    return (
      <div style={{ marginTop: 8, background: '#0f0f0f', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 4, padding: '8px 10px', background: '#1a1a1a', fontSize: 11, color: '#888', fontWeight: 600 }}>
          <div>Producto</div>
          <div style={{ textAlign: 'right' }}>Solicit.</div>
          <div style={{ textAlign: 'right' }}>Despach.</div>
          <div style={{ textAlign: 'right' }}>Recibido</div>
          <div style={{ textAlign: 'right' }}>Dif.</div>
        </div>
        {pItems.map(it => {
          const prod = productosMap[it.producto_id];
          const di = dMap[it.producto_id];
          const solicit = n(it.cantidad_solicitada);
          const despach = n(it.cantidad_despachada ?? di?.cantidad_despachada);
          const recib   = di?.cantidad_recibida != null ? n(di.cantidad_recibida) : null;
          const dif = recib != null ? recib - despach : null;
          return (
            <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 4, padding: '6px 10px', fontSize: 13, borderTop: '1px solid #1a1a1a' }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {prod?.nombre || it.producto_id.slice(0, 8)}
                <span style={{ color: '#666', fontSize: 11, marginLeft: 4 }}>{it.unidad || prod?.unidad_medida || ''}</span>
              </div>
              <div style={{ textAlign: 'right', color: '#fff' }}>{solicit}</div>
              <div style={{ textAlign: 'right', color: despach > 0 ? '#fbbf24' : '#666' }}>{despach || '—'}</div>
              <div style={{ textAlign: 'right', color: recib != null ? '#22c55e' : '#666' }}>{recib != null ? recib : '—'}</div>
              <div style={{ textAlign: 'right', color: dif == null ? '#666' : (dif === 0 ? '#22c55e' : (dif < 0 ? '#ef4444' : '#fbbf24')), fontWeight: 600 }}>
                {dif == null ? '—' : (dif > 0 ? '+' : '') + dif}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const stats = useMemo(() => {
    const s = { total: pedidos.length, enviados: 0, preparando: 0, despachados: 0, recibidos: 0 };
    pedidos.forEach(p => {
      const d = despachoByPedido[p.id];
      if (d?.estado === 'recibido') s.recibidos++;
      else if (d?.estado === 'despachado' || d?.estado === 'en_ruta') s.despachados++;
      else if (d?.estado === 'preparando' || p.estado === 'preparando') s.preparando++;
      else s.enviados++;
    });
    return s;
  }, [pedidos, despachoByPedido]);

  return (
    <div style={{ padding: '16px 16px 100px', maxWidth: 900, margin: '0 auto' }}>
      <Toast />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>📦 Mis Pedidos</h2>
          <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>
            {sucursalNombre ? `Sucursal: ${sucursalNombre}` : 'Cargando sucursal…'}
          </div>
        </div>
        {canViewAll && sucursales.length > 0 && (
          <select className="input" value={sucursalId || ''} onChange={e => {
            setSucursalId(e.target.value);
            const s = sucursales.find(s => s.id === e.target.value);
            setSucursalNombre(s?.nombre || '');
          }}>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.store_code} — {s.nombre}</option>)}
          </select>
        )}
      </div>

      {/* Filtros */}
      <RangoFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />

      {/* Stats chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          ['todos',      `Todos ${stats.total}`, '#666'],
          ['enviado',    `Enviados ${stats.enviados}`, '#fbbf24'],
          ['preparando', `Preparando ${stats.preparando}`, '#3b82f6'],
          ['despachado', `Despachados ${stats.despachados}`, '#fbbf24'],
          ['recibido',   `Recibidos ${stats.recibidos}`, '#22c55e'],
        ].map(([k, label, color]) => (
          <button
            key={k}
            className={`btn btn-sm ${filtroEstado === k ? 'btn-red' : 'btn-ghost'}`}
            onClick={() => setFiltroEstado(k)}
            style={filtroEstado !== k ? { borderLeft: `3px solid ${color}` } : {}}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading && <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />}

      {!loading && pedidosFiltrados.length === 0 && (
        <div className="empty" style={{ padding: '40px 16px', textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: 40 }}>📋</div>
          <div style={{ marginTop: 8 }}>
            No hay pedidos en el rango seleccionado
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {fmtDate(desde)} — {fmtDate(hasta)}
          </div>
        </div>
      )}

      {!loading && pedidosFiltrados.map(p => {
        const d = despachoByPedido[p.id];
        const pItems = itemsPorPedido[p.id] || [];
        const totalUnidades = pItems.reduce((s, it) => s + n(it.cantidad_solicitada), 0);
        const isOpen = expanded === p.id;

        return (
          <div key={p.id} className="card" style={{ marginBottom: 10, cursor: 'pointer' }}
               onClick={() => setExpanded(isOpen ? null : p.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  Pedido {fmtDate(p.fecha_pedido)}
                </div>
                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                  {pItems.length} items · {totalUnidades} unidades
                  {p.fecha_entrega_estimada && (
                    <> · Entrega: {fmtDate(p.fecha_entrega_estimada)}</>
                  )}
                </div>
                {p.notas && (
                  <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 4 }}>📝 {p.notas}</div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <Badge estado={d?.estado || p.estado} />
                {d?.motorista_nombre && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>🛵 {d.motorista_nombre}</div>
                )}
              </div>
            </div>

            <Timeline estado={p.estado} despacho={d} />

            {/* Meta estados */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, fontSize: 11, color: '#888' }}>
              {d?.fecha_despacho && <span>🚚 Despacho: {fmtDate(d.fecha_despacho)}</span>}
              {d?.hora_salida && <span>⏰ Salida: {new Date(d.hora_salida).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</span>}
              {d?.fecha_recepcion && <span>✅ Recibido: {new Date(d.fecha_recepcion).toLocaleString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
              {!d && <span style={{ color: '#fbbf24' }}>⏳ Aún no preparado por almacén</span>}
            </div>

            {isOpen && (
              <div onClick={e => e.stopPropagation()}>
                {renderItems(p)}
                {(d?.notas_despacho || d?.notas_recepcion) && (
                  <div style={{ marginTop: 8, padding: 10, background: '#0f0f0f', borderRadius: 8, fontSize: 12 }}>
                    {d?.notas_despacho && <div><strong style={{ color: '#fbbf24' }}>Notas despacho:</strong> {d.notas_despacho}</div>}
                    {d?.notas_recepcion && <div style={{ marginTop: 4 }}><strong style={{ color: '#22c55e' }}>Notas recepción:</strong> {d.notas_recepcion}</div>}
                  </div>
                )}
                {d?.foto_recepcion_url && (
                  <a href={d.foto_recepcion_url} target="_blank" rel="noreferrer"
                     style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#3b82f6' }}
                     onClick={e => e.stopPropagation()}>
                    📸 Ver foto de recepción
                  </a>
                )}
              </div>
            )}

            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#555' }}>
              {isOpen ? '▲ Ocultar detalle' : '▼ Ver detalle de items'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
