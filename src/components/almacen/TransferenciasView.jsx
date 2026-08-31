import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../supabase';
import { fmtDate, n } from '../../config';
import { Badge } from '../ui/Badge';

// ── TRANSFERENCIAS ENTRE SUCURSALES (solo admin) ──────────────
// Crea un despacho ya 'despachado' con origen_sucursal_id: entra al flujo
// existente (motorista lo ve en Confirmar Entregas, la sucursal destino lo
// recepciona con despacho_confirmar y ahí se suma su kardex). La salida del
// origen la asienta el RPC transferencia_crear en la misma transacción.

const ROLES_OK = ['admin', 'superadmin', 'ejecutivo'];

const inputStyle = {
  width: '100%', padding: '12px', background: '#1a1a1a',
  border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 14,
};

export default function TransferenciasView({ user, show }) {
  const [tab, setTab] = useState('nueva'); // nueva | historial
  const [sucursales, setSucursales] = useState([]);

  useEffect(() => {
    db.from('sucursales').select('id,nombre,store_code,activa').order('nombre')
      .then(({ data }) => setSucursales((data || []).filter(s => s.activa)));
  }, []);

  if (!ROLES_OK.includes(user?.rol)) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
        <div>Solo administración puede hacer transferencias entre sucursales.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button className={`btn btn-sm ${tab === 'nueva' ? 'btn-red' : 'btn-ghost'}`} onClick={() => setTab('nueva')}>➕ Nueva transferencia</button>
        <button className={`btn btn-sm ${tab === 'historial' ? 'btn-red' : 'btn-ghost'}`} onClick={() => setTab('historial')}>📋 Historial</button>
      </div>
      {tab === 'nueva'
        ? <NuevaTransferencia user={user} show={show} sucursales={sucursales} onCreada={() => setTab('historial')} />
        : <HistorialTransferencias sucursales={sucursales} />}
    </div>
  );
}

// ── NUEVA ─────────────────────────────────────────────────────
function NuevaTransferencia({ user, show, sucursales, onCreada }) {
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [cart, setCart] = useState([]); // [{id,nombre,unidad_medida,categoria,qty,stock}]
  const [motoristas, setMotoristas] = useState([]);
  const [motoristaId, setMotoristaId] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    db.from('usuarios_erp').select('id,nombre').in('rol', ['despachador', 'motorista']).order('nombre')
      .then(({ data }) => setMotoristas(data || []));
  }, []);

  // Búsqueda con debounce
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    const q = query.trim();
    if (q.length < 2) { setResultados([]); return; }
    debRef.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data, error } = await db.from('catalogo_productos')
          .select('id,nombre,unidad_medida,categoria')
          .eq('activo', true).ilike('nombre', `%${q}%`)
          .order('nombre').limit(25);
        if (error) throw error;
        let rows = data || [];
        if (origen && rows.length) {
          const { data: inv } = await db.from('inventario')
            .select('producto_id,stock_actual')
            .eq('sucursal_id', origen)
            .in('producto_id', rows.map(r => r.id));
          const m = new Map((inv || []).map(i => [i.producto_id, Number(i.stock_actual)]));
          rows = rows.map(r => ({ ...r, stock: m.get(r.id) ?? 0 }));
        }
        setResultados(rows);
      } catch (e) { show('⚠️ ' + e.message); }
      finally { setBuscando(false); }
    }, 300);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [query, origen]);

  // Si cambia el origen, refrescar el stock del carrito
  useEffect(() => {
    if (!origen || cart.length === 0) return;
    db.from('inventario').select('producto_id,stock_actual')
      .eq('sucursal_id', origen).in('producto_id', cart.map(c => c.id))
      .then(({ data }) => {
        const m = new Map((data || []).map(i => [i.producto_id, Number(i.stock_actual)]));
        setCart(prev => prev.map(c => ({ ...c, stock: m.get(c.id) ?? 0 })));
      });
  }, [origen]);

  const agregar = (p) => {
    setCart(prev => {
      const ya = prev.find(c => c.id === p.id);
      if (ya) return prev.map(c => c.id === p.id ? { ...c, qty: n(c.qty) + 1 } : c);
      return [...prev, { ...p, qty: 1, stock: p.stock ?? 0 }];
    });
  };
  const setQty = (id, v) => setCart(prev => prev.map(c => c.id === id ? { ...c, qty: v } : c));
  const quitar = (id) => setCart(prev => prev.filter(c => c.id !== id));

  const totalUnidades = cart.reduce((s, c) => s + n(c.qty), 0);
  const sobregiro = cart.filter(c => origen && n(c.qty) > n(c.stock));
  const origenNombre = sucursales.find(s => s.id === origen)?.nombre || '';
  const destinoNombre = sucursales.find(s => s.id === destino)?.nombre || '';

  const crear = async () => {
    if (!origen || !destino) { show('⚠️ Elegí sucursal de origen y destino'); return; }
    if (origen === destino) { show('⚠️ Origen y destino no pueden ser la misma'); return; }
    const items = cart.filter(c => n(c.qty) > 0);
    if (items.length === 0) { show('⚠️ Agregá al menos un producto'); return; }
    if (!motoristaId) { show('⚠️ Asigná el motorista que lleva la transferencia'); return; }
    let msg = `¿Transferir ${items.length} producto(s) (${totalUnidades} unidades) de ${origenNombre} a ${destinoNombre}?\n\nEl stock sale del origen AHORA y entra al destino cuando confirmen la entrega.`;
    if (sobregiro.length > 0) {
      msg = `⚠️ ${sobregiro.length} producto(s) superan el stock del origen (quedará negativo).\n\n` + msg;
    }
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      const moto = motoristas.find(m => m.id === motoristaId);
      const { data, error } = await db.rpc('transferencia_crear', {
        p_origen_sucursal_id: origen,
        p_destino_sucursal_id: destino,
        p_items: items.map(c => ({ producto_id: c.id, cantidad: n(c.qty) })),
        p_usuario_id: user.id,
        p_motorista_id: motoristaId,
        p_motorista_nombre: moto?.nombre || null,
        p_notas: notas.trim() || null,
      });
      if (error) throw error;
      show(`✅ Transferencia creada — ${data.items} producto(s) hacia ${data.destino}. El motorista ya la ve en sus entregas.`);
      setCart([]); setNotas(''); setQuery(''); setResultados([]);
      onCreada();
    } catch (e) { show('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      {/* Origen → Destino */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-title">RUTA DE LA TRANSFERENCIA</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: '#888' }}>Sale de</label>
            <select value={origen} onChange={e => setOrigen(e.target.value)} style={inputStyle}>
              <option value="">— Origen —</option>
              {sucursales.map(s => <option key={s.id} value={s.id} disabled={s.id === destino}>{s.nombre}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 20, color: '#e63946', paddingTop: 16 }}>→</div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: '#888' }}>Entra a</label>
            <select value={destino} onChange={e => setDestino(e.target.value)} style={inputStyle}>
              <option value="">— Destino —</option>
              {sucursales.map(s => <option key={s.id} value={s.id} disabled={s.id === origen}>{s.nombre}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Buscador de productos */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-title">PRODUCTOS (bebida o comida)</div>
        <input
          type="text" placeholder="🔍 Buscar producto del catálogo…"
          value={query} onChange={e => setQuery(e.target.value)} style={inputStyle}
        />
        {!origen && query.trim().length >= 2 && (
          <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 8 }}>Elegí el origen para ver su stock.</div>
        )}
        {buscando && <div className="spin" style={{ width: 20, height: 20, margin: '10px auto' }} />}
        {!buscando && resultados.map(p => {
          const enCarrito = cart.find(c => c.id === p.id);
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid #1a1a1a' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.nombre}</div>
                <div style={{ fontSize: 11, color: '#666' }}>
                  {p.categoria || '—'} · {p.unidad_medida || 'unidad'}
                  {origen && <span style={{ marginLeft: 8, color: n(p.stock) > 0 ? '#4ade80' : '#f97316' }}>stock origen: {n(p.stock)}</span>}
                </div>
              </div>
              <button className={`btn btn-sm ${enCarrito ? 'btn-green' : 'btn-ghost'}`} onClick={() => agregar(p)}>
                {enCarrito ? `✓ ${enCarrito.qty}` : '+ Agregar'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Carrito */}
      {cart.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="sec-title">A TRANSFERIR ({cart.length} · {totalUnidades} unidades)</div>
          {cart.map(c => {
            const excede = origen && n(c.qty) > n(c.stock);
            return (
              <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid #1a1a1a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.nombre}</div>
                    <div style={{ fontSize: 11, color: excede ? '#f97316' : '#666' }}>
                      {origen ? `stock origen: ${n(c.stock)} ${c.unidad_medida || ''}` : (c.unidad_medida || 'unidad')}
                      {excede && ' — ⚠️ quedará negativo'}
                    </div>
                  </div>
                  <button onClick={() => quitar(c.id)} style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 16, cursor: 'pointer', padding: '0 6px' }}>✕</button>
                </div>
                <div className="num-input">
                  <button className="num-btn" onClick={() => setQty(c.id, String(Math.max(0, n(c.qty) - 1)))}>−</button>
                  <input type="number" className="num-field" min="0" step="0.01" value={c.qty}
                    onChange={e => setQty(c.id, e.target.value)} />
                  <button className="num-btn" onClick={() => setQty(c.id, String(n(c.qty) + 1))}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Motorista + notas + crear */}
      <div className="card">
        <div className="sec-title">ENVÍO</div>
        <label style={{ fontSize: 11, color: '#888' }}>🚚 Motorista que la lleva</label>
        <select value={motoristaId} onChange={e => setMotoristaId(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
          <option value="">— Seleccionar motorista —</option>
          {motoristas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
        <textarea
          placeholder="Notas (opcional): motivo de la transferencia…"
          value={notas} onChange={e => setNotas(e.target.value)}
          style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit', marginBottom: 12 }}
        />
        <button className="btn btn-red" style={{ width: '100%', padding: 14 }} onClick={crear}
          disabled={saving || !origen || !destino || cart.length === 0}>
          {saving ? 'Creando…' : `🔁 Transferir ${destinoNombre ? 'a ' + destinoNombre : ''}`}
        </button>
        <div style={{ fontSize: 11, color: '#666', marginTop: 8, textAlign: 'center' }}>
          El stock sale del origen al crear. Entra al destino cuando la sucursal confirma la entrega (flujo normal de despachos).
        </div>
      </div>
    </>
  );
}

// ── HISTORIAL ─────────────────────────────────────────────────
function HistorialTransferencias({ sucursales }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandId, setExpandId] = useState(null);
  const [items, setItems] = useState([]);

  const nombreSuc = (id) => sucursales.find(s => s.id === id)?.nombre || '—';

  useEffect(() => {
    db.from('despachos_sucursal')
      .select('id,sucursal_id,origen_sucursal_id,fecha_despacho,estado,motorista_nombre,hora_salida,hora_recepcion,notas_despacho,costo_total')
      .not('origen_sucursal_id', 'is', null)
      .order('created_at', { ascending: false }).limit(40)
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, []);

  const toggle = async (id) => {
    if (expandId === id) { setExpandId(null); return; }
    setExpandId(id); setItems([]);
    const { data } = await db.from('despacho_items')
      .select('id,descripcion,cantidad_despachada,cantidad_recibida,unidad_medida')
      .eq('despacho_id', id).order('descripcion');
    setItems(data || []);
  };

  if (loading) return <div className="spin" style={{ width: 28, height: 28, margin: '20px auto' }} />;
  if (rows.length === 0) return (
    <div className="empty"><div className="empty-icon">🔁</div><div className="empty-text">Aún no hay transferencias entre sucursales</div></div>
  );

  return rows.map(d => (
    <div key={d.id} className="card" style={{ cursor: 'pointer' }} onClick={() => toggle(d.id)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {nombreSuc(d.origen_sucursal_id)} <span style={{ color: '#e63946' }}>→</span> {nombreSuc(d.sucursal_id)}
          </div>
          <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{fmtDate(d.fecha_despacho)}</div>
          {d.motorista_nombre && <div style={{ fontSize: 12, color: '#60a5fa', marginTop: 2 }}>🚚 {d.motorista_nombre}</div>}
        </div>
        <Badge estado={d.estado} />
      </div>
      {d.hora_recepcion && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 4 }}>Recibido: {new Date(d.hora_recepcion).toLocaleString('es-SV')}</div>}
      {expandId === d.id && (
        <div style={{ marginTop: 10, borderTop: '1px solid #2a2a2a', paddingTop: 8 }} onClick={e => e.stopPropagation()}>
          {items.length === 0 && <div className="spin" style={{ width: 18, height: 18, margin: '6px auto' }} />}
          {items.map(it => (
            <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid #1a1a1a' }}>
              <span>{it.descripcion}</span>
              <span style={{ color: '#888' }}>
                {n(it.cantidad_despachada)} {it.unidad_medida || ''}
                {it.cantidad_recibida != null && n(it.cantidad_recibida) !== n(it.cantidad_despachada) &&
                  <span style={{ color: '#f97316' }}> · recibido {n(it.cantidad_recibida)}</span>}
              </span>
            </div>
          ))}
          {d.notas_despacho && <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>📝 {d.notas_despacho}</div>}
        </div>
      )}
    </div>
  ));
}
