import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n } from '../../config';

// ── Constants ──
const EVT_SUCURSAL_ID = 'a2889f21-948b-4b58-8261-dc78ee2dc803';
const ESTADO_COLOR = {
  planificacion: { background: '#332b00', color: '#fbbf24', border: '1px solid #554400' },
  activo:        { background: '#003320', color: '#34d399', border: '1px solid #005533' },
  cerrado:       { background: '#002244', color: '#60a5fa', border: '1px solid #003366' },
  aprobado:      { background: '#220033', color: '#c084fc', border: '1px solid #440055' },
  cancelado:     { background: '#330011', color: '#f87171', border: '1px solid #550022' },
  enviado:       { background: '#332b00', color: '#fbbf24', border: '1px solid #554400' },
  preparando:    { background: '#003320', color: '#34d399', border: '1px solid #005533' },
  despachado:    { background: '#002244', color: '#60a5fa', border: '1px solid #003366' },
  recibido:      { background: '#220033', color: '#c084fc', border: '1px solid #440055' },
  pendiente:     { background: '#332b00', color: '#fbbf24', border: '1px solid #554400' },
  recibida:      { background: '#003320', color: '#34d399', border: '1px solid #005533' },
};
const PAGO_ICONS = { efectivo: '💵', tarjeta: '💳', transferencia: '🏦', link_pago: '🔗' };
const PAGO_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', link_pago: 'Link Pago' };
const isAdmin = (r) => ['ejecutivo', 'admin', 'superadmin'].includes(r);
const isCM = (r) => ['jefe_casa_matriz', 'bodeguero'].includes(r);
const fmt$ = (v) => '$' + n(v).toFixed(2);

const stepBtn = { width: 48, height: 48, borderRadius: 12, border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', flexShrink: 0 };
const inputStyle = { background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '8px 12px', fontSize: 14, width: '100%', outline: 'none' };
const badgeStyle = (estado) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, ...(ESTADO_COLOR[estado] || { background: '#222', color: '#aaa' }) });

// ── Main Component ──
export default function EventosView({ user }) {
  const [tab, setTab] = useState('lista');
  const [eventos, setEventos] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchEventos = useCallback(async () => {
    setLoading(true);
    const { data } = await db.from('eventos')
      .select('*, responsable:usuarios_erp!responsable_id(nombre), cerrador:usuarios_erp!cerrado_por(nombre), aprobador:usuarios_erp!aprobado_por(nombre)')
      .order('fecha_evento', { ascending: false });
    setEventos(data || []);
    if (sel) {
      const fresh = (data || []).find(e => e.id === sel.id);
      if (fresh) setSel(fresh);
    }
    setLoading(false);
  }, [sel?.id]);

  useEffect(() => { fetchEventos(); }, []);

  const show = (m, t = 3000) => { setMsg(m); setTimeout(() => setMsg(''), t); };

  const tabs = [
    { key: 'lista', label: 'Eventos', icon: '📋' },
    { key: 'menu', label: 'Menu', icon: '🍔', needSel: true },
    { key: 'pedido', label: 'Pedido CM', icon: '📦', needSel: true },
    { key: 'venta', label: 'Ventas', icon: '🛒', needSel: true },
    { key: 'cierre', label: 'Cierre', icon: '✅', needSel: true },
  ];

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
      <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>🎪 Eventos</h1>
      {msg && <div style={{ background: '#003320', border: '1px solid #005533', color: '#34d399', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, marginBottom: 12 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {tabs.map(t => {
          if (t.needSel && !sel) return null;
          const active = tab === t.key;
          return (
            <button key={t.key} className={active ? 'btn btn-sm btn-red' : 'btn btn-sm btn-ghost'}
              onClick={() => setTab(t.key)}>{t.icon} {t.label}</button>
          );
        })}
        {sel && <span style={{ color: '#aaa', fontSize: 12, alignSelf: 'center', marginLeft: 8 }}>{sel.nombre}</span>}
      </div>

      {tab === 'lista' && <TabLista user={user} eventos={eventos} sel={sel} onSelect={(e) => { setSel(e); if (e.estado === 'planificacion') setTab('pedido'); else if (e.estado === 'activo') setTab('venta'); else setTab('cierre'); }} onRefresh={fetchEventos} show={show} setTab={setTab} />}
      {tab === 'menu' && sel && <TabMenu user={user} evento={sel} show={show} />}
      {tab === 'pedido' && sel && <TabPedido user={user} evento={sel} show={show} onRefresh={fetchEventos} />}
      {tab === 'venta' && sel && <TabVenta user={user} evento={sel} show={show} onRefresh={fetchEventos} />}
      {tab === 'cierre' && sel && <TabCierre user={user} evento={sel} show={show} onRefresh={fetchEventos} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 1: LISTA DE EVENTOS + CREAR
// ═══════════════════════════════════════════════════
function TabLista({ user, eventos, sel, onSelect, onRefresh, show, setTab }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ nombre: '', descripcion: '', fecha_evento: today(), hora_inicio: '', hora_fin: '', ubicacion: '', cliente: '', precio_pactado: '' });

  const handleCreate = async () => {
    if (!form.nombre || !form.fecha_evento) return show('Nombre y fecha son requeridos');
    const payload = { ...form, precio_pactado: form.precio_pactado ? n(form.precio_pactado) : null, hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null, responsable_id: user.id };
    const { data: newEvt, error } = await db.from('eventos').insert(payload).select().single();
    if (error) return show('Error: ' + error.message);
    show('Evento creado — configura menu y pedidos');
    setCreating(false);
    setForm({ nombre: '', descripcion: '', fecha_evento: today(), hora_inicio: '', hora_fin: '', ubicacion: '', cliente: '', precio_pactado: '' });
    await onRefresh();
    if (newEvt) { onSelect(newEvt); setTab('menu'); }
  };

  const activar = async (ev, e) => {
    e.stopPropagation();
    await db.from('eventos').update({ estado: 'activo', updated_at: new Date().toISOString() }).eq('id', ev.id);
    show('Evento activado');
    onRefresh();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="sec-title">Mis Eventos</p>
        <button className="btn btn-red" onClick={() => setCreating(!creating)}>{creating ? 'Cancelar' : '+ Nuevo'}</button>
      </div>

      {creating && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input style={inputStyle} placeholder="Nombre del evento *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            <input style={inputStyle} placeholder="Descripcion (opcional)" value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label style={{ color: '#666', fontSize: 11, textTransform: 'uppercase' }}>Fecha *</label><input style={inputStyle} type="date" value={form.fecha_evento} onChange={e => setForm({ ...form, fecha_evento: e.target.value })} /></div>
              <div><label style={{ color: '#666', fontSize: 11, textTransform: 'uppercase' }}>Ubicacion</label><input style={inputStyle} placeholder="Lugar" value={form.ubicacion} onChange={e => setForm({ ...form, ubicacion: e.target.value })} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label style={{ color: '#666', fontSize: 11, textTransform: 'uppercase' }}>Hora inicio</label><input style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setForm({ ...form, hora_inicio: e.target.value })} /></div>
              <div><label style={{ color: '#666', fontSize: 11, textTransform: 'uppercase' }}>Hora fin</label><input style={inputStyle} type="time" value={form.hora_fin} onChange={e => setForm({ ...form, hora_fin: e.target.value })} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input style={inputStyle} placeholder="Cliente / Contratante" value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} />
              <input style={inputStyle} placeholder="Precio pactado $" type="number" step="0.01" value={form.precio_pactado} onChange={e => setForm({ ...form, precio_pactado: e.target.value })} />
            </div>
            <button className="btn btn-green" style={{ width: '100%' }} onClick={handleCreate}>Crear Evento</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {eventos.map(ev => (
          <div key={ev.id} className="card" style={{ padding: 14, cursor: 'pointer', border: sel?.id === ev.id ? '2px solid #e53e3e' : '1px solid #2a2a2a' }} onClick={() => onSelect(ev)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{ev.nombre}</div>
                <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{fmtDate(ev.fecha_evento)} · {ev.ubicacion || 'Sin ubicacion'}{ev.cliente ? ` · ${ev.cliente}` : ''}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={badgeStyle(ev.estado)}>{ev.estado}</span>
                {ev.estado === 'planificacion' && <button className="btn btn-sm btn-orange" onClick={(e) => activar(ev, e)}>Activar</button>}
              </div>
            </div>
            {ev.total_ventas > 0 && <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>Ventas: {fmt$(ev.total_ventas)} · {ev.num_transacciones} tx</div>}
          </div>
        ))}
        {eventos.length === 0 && <p style={{ color: '#555', textAlign: 'center', padding: 32 }}>No hay eventos. Crea el primero.</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 2: MENU DEL EVENTO
// ═══════════════════════════════════════════════════
function TabMenu({ user, evento, show }) {
  const [menuItems, setMenuItems] = useState([]);
  const [posItems, setPosItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showPos, setShowPos] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');

  const fetchMenu = useCallback(async () => {
    const { data } = await db.from('evento_menu').select('*').eq('evento_id', evento.id).order('orden');
    setMenuItems(data || []);
  }, [evento.id]);

  const fetchPos = useCallback(async () => {
    const { data } = await db.from('pos_menu_items').select('id, nombre, precio, imagen_url').eq('disponible', true).order('nombre');
    const seen = new Map();
    (data || []).forEach(item => { if (!seen.has(item.nombre)) seen.set(item.nombre, item); });
    setPosItems([...seen.values()]);
  }, []);

  useEffect(() => { fetchMenu(); fetchPos(); }, [fetchMenu, fetchPos]);

  const addFromPos = async (item) => {
    const { error } = await db.from('evento_menu').insert({ evento_id: evento.id, nombre: item.nombre, precio: item.precio, imagen_url: item.imagen_url, pos_menu_item_id: item.id, orden: menuItems.length });
    if (error) return show(error.message.includes('unique') ? 'Ya existe en el menu' : 'Error: ' + error.message);
    show(item.nombre + ' agregado');
    fetchMenu();
  };

  const addCustom = async () => {
    if (!customName || !customPrice) return show('Nombre y precio requeridos');
    const { error } = await db.from('evento_menu').insert({ evento_id: evento.id, nombre: customName, precio: n(customPrice), orden: menuItems.length });
    if (error) return show('Error: ' + error.message);
    show('Item agregado');
    setCustomName(''); setCustomPrice('');
    fetchMenu();
  };

  const toggleItem = async (item) => { await db.from('evento_menu').update({ activo: !item.activo }).eq('id', item.id); fetchMenu(); };
  const updatePrice = async (item, val) => { if (!val) return; await db.from('evento_menu').update({ precio: n(val) }).eq('id', item.id); show('Precio actualizado'); fetchMenu(); };
  const removeItem = async (item) => { await db.from('evento_menu').delete().eq('id', item.id); show('Eliminado'); fetchMenu(); };

  const filtered = posItems.filter(i => i.nombre.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <p className="sec-title">Menu del Evento ({menuItems.length} items)</p>

      {/* Current menu items */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        {menuItems.length === 0 && <p style={{ color: '#555', textAlign: 'center', padding: 16, fontSize: 13 }}>Sin items. Agrega del catalogo POS o crea uno personalizado.</p>}
        {menuItems.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 4px', borderBottom: '1px solid #222', opacity: item.activo ? 1 : 0.4 }}>
            <span style={{ color: '#fff', fontSize: 14, flex: 1 }}>{item.nombre}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input style={{ ...inputStyle, width: 80, textAlign: 'right', padding: '4px 8px' }} type="number" step="0.01" defaultValue={item.precio} onBlur={e => updatePrice(item, e.target.value)} />
              <button style={{ ...stepBtn, width: 36, height: 36, fontSize: 16 }} onClick={() => toggleItem(item)}>{item.activo ? '👁️' : '🚫'}</button>
              <button style={{ ...stepBtn, width: 36, height: 36, fontSize: 16, color: '#f87171' }} onClick={() => removeItem(item)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* Add from POS */}
      <button className="btn btn-ghost" style={{ marginBottom: 12 }} onClick={() => setShowPos(!showPos)}>
        {showPos ? 'Cerrar catalogo' : '📋 Jalar del catalogo POS'}
      </button>

      {showPos && (
        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
          <input style={{ ...inputStyle, marginBottom: 8 }} placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.slice(0, 30).map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px', borderBottom: '1px solid #1a1a1a' }}>
                <span style={{ color: '#ccc', fontSize: 13 }}>{item.nombre} — <span style={{ color: '#34d399', fontWeight: 600 }}>{fmt$(item.precio)}</span></span>
                <button className="btn btn-sm btn-green" onClick={() => addFromPos(item)}>+ Agregar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom item */}
      <div className="card" style={{ padding: 12 }}>
        <p style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>Item personalizado</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input style={inputStyle} placeholder="Nombre del item" value={customName} onChange={e => setCustomName(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="Precio $" type="number" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
            <button className="btn btn-green" onClick={addCustom}>+ Agregar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 3: PEDIDO A CASA MATRIZ (pedidos_sucursal)
// ═══════════════════════════════════════════════════
function TabPedido({ user, evento, show, onRefresh }) {
  const [pedidos, setPedidos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [pedidoItems, setPedidoItems] = useState({});

  const notasPrefix = `EVT:${evento.id}`;

  const fetchPedidos = useCallback(async () => {
    const { data } = await db.from('pedidos_sucursal')
      .select('*, solicitante:usuarios_erp!solicitado_por(nombre)')
      .eq('sucursal_id', EVT_SUCURSAL_ID)
      .ilike('notas', notasPrefix + '%')
      .order('created_at', { ascending: false });
    setPedidos(data || []);
  }, [evento.id]);

  const fetchProductos = useCallback(async () => {
    const { data } = await db.from('catalogo_productos').select('id, nombre, codigo, unidad_medida, categoria').eq('activo', true).order('nombre');
    setProductos(data || []);
  }, []);

  useEffect(() => { fetchPedidos(); fetchProductos(); }, [fetchPedidos, fetchProductos]);

  const loadItems = async (pid) => {
    if (expanded === pid) { setExpanded(null); return; }
    const { data } = await db.from('pedido_items')
      .select('*, producto:catalogo_productos(nombre, unidad_medida)')
      .eq('pedido_id', pid);
    setPedidoItems(prev => ({ ...prev, [pid]: data || [] }));
    setExpanded(pid);
  };

  const addItem = (prod) => {
    if (items.find(i => i.producto_id === prod.id)) return show('Ya agregado');
    setItems([...items, { producto_id: prod.id, nombre: prod.nombre, unidad: prod.unidad_medida, cantidad: 1 }]);
  };

  const updateQty = (idx, delta) => {
    const u = [...items];
    u[idx].cantidad = Math.max(0.5, n(u[idx].cantidad) + delta);
    setItems(u);
  };

  const setQty = (idx, val) => {
    const u = [...items];
    u[idx].cantidad = n(val);
    setItems(u);
  };

  const crearPedido = async () => {
    if (items.length === 0) return show('Agrega al menos un producto');
    const notasFull = `${notasPrefix} | ${evento.nombre}`;
    const { data: pedido, error } = await db.from('pedidos_sucursal').insert({
      fecha_pedido: today(),
      sucursal_id: EVT_SUCURSAL_ID,
      estado: 'enviado',
      solicitado_por: user.id,
      notas: notasFull,
    }).select().single();
    if (error) return show('Error: ' + error.message);

    const rows = items.map(i => ({ pedido_id: pedido.id, producto_id: i.producto_id, cantidad_solicitada: i.cantidad, unidad: i.unidad }));
    const { error: e2 } = await db.from('pedido_items').insert(rows);
    if (e2) return show('Error items: ' + e2.message);

    show('Pedido enviado a Casa Matriz');
    setItems([]); setCreating(false);
    fetchPedidos();
  };

  const confirmarRecepcion = async (p) => {
    await db.from('pedidos_sucursal').update({ estado: 'recibido' }).eq('id', p.id);
    show('Recepcion confirmada');
    fetchPedidos(); onRefresh();
  };

  const filtered = productos.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="sec-title">Pedido a Casa Matriz</p>
        {(evento.estado === 'planificacion' || evento.estado === 'activo') && (
          <button className="btn btn-red" onClick={() => setCreating(!creating)}>{creating ? 'Cancelar' : '+ Nuevo Pedido'}</button>
        )}
      </div>

      {creating && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 10 }}>
            {filtered.slice(0, 25).map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px', borderBottom: '1px solid #1a1a1a' }}>
                <span style={{ color: '#ccc', fontSize: 13 }}>{p.nombre} <span style={{ color: '#666' }}>({p.unidad_medida})</span></span>
                <button className="btn btn-sm btn-ghost" onClick={() => addItem(p)}>+</button>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div style={{ borderTop: '1px solid #333', paddingTop: 10 }}>
              <p style={{ color: '#aaa', fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Items del pedido</p>
              {items.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{it.nombre} <span style={{ color: '#666' }}>({it.unidad})</span></span>
                  <button style={stepBtn} onClick={() => updateQty(idx, -1)}>-</button>
                  <input style={{ ...inputStyle, width: 60, textAlign: 'center', padding: '6px 4px' }} type="number" step="0.5" value={it.cantidad} onChange={e => setQty(idx, e.target.value)} />
                  <button style={stepBtn} onClick={() => updateQty(idx, 1)}>+</button>
                  <button style={{ ...stepBtn, width: 36, height: 36, fontSize: 16, color: '#f87171' }} onClick={() => setItems(items.filter((_, i) => i !== idx))}>✕</button>
                </div>
              ))}
              <button className="btn btn-green" style={{ width: '100%', marginTop: 8 }} onClick={crearPedido}>📦 Enviar Pedido a CM</button>
            </div>
          )}
        </div>
      )}

      {/* Pedidos list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pedidos.map(p => (
          <div key={p.id} className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => loadItems(p.id)}>
              <div>
                <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>Pedido {fmtDate(p.fecha_pedido || p.created_at?.split('T')[0] || '')}</span>
                <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>por {p.solicitante?.nombre || '—'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={badgeStyle(p.estado)}>{p.estado}</span>
                <span style={{ color: '#555', fontSize: 12 }}>{expanded === p.id ? '▲' : '▼'}</span>
              </div>
            </div>
            {expanded === p.id && pedidoItems[p.id] && (
              <div style={{ borderTop: '1px solid #222', marginTop: 8, paddingTop: 8 }}>
                {pedidoItems[p.id].map(it => (
                  <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                    <span style={{ color: '#ccc' }}>{it.producto?.nombre}</span>
                    <span style={{ color: '#aaa' }}>{it.cantidad_solicitada} {it.producto?.unidad_medida}{it.cantidad_despachada > 0 ? ` (desp: ${it.cantidad_despachada})` : ''}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {p.estado === 'despachado' && <button className="btn btn-sm btn-green" onClick={() => confirmarRecepcion(p)}>📥 Confirmar Recepcion</button>}
                </div>
              </div>
            )}
          </div>
        ))}
        {pedidos.length === 0 && <p style={{ color: '#555', textAlign: 'center', padding: 24, fontSize: 13 }}>No hay pedidos para este evento.</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 4: VENTAS RAPIDAS
// ═══════════════════════════════════════════════════
function TabVenta({ user, evento, show, onRefresh }) {
  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [metodo, setMetodo] = useState('efectivo');
  const [ventas, setVentas] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showHist, setShowHist] = useState(false);

  const fetchMenu = useCallback(async () => {
    const { data } = await db.from('evento_menu').select('*').eq('evento_id', evento.id).eq('activo', true).order('orden');
    setMenuItems(data || []);
  }, [evento.id]);

  const fetchVentas = useCallback(async () => {
    const { data } = await db.from('evento_ventas')
      .select('*, items:evento_venta_items(*, menu:evento_menu(nombre))')
      .eq('evento_id', evento.id).eq('anulada', false)
      .order('created_at', { ascending: false }).limit(50);
    setVentas(data || []);
  }, [evento.id]);

  useEffect(() => { fetchMenu(); fetchVentas(); }, [fetchMenu, fetchVentas]);

  const addToCart = (item) => {
    const ex = cart.find(c => c.evento_menu_id === item.id);
    if (ex) setCart(cart.map(c => c.evento_menu_id === item.id ? { ...c, cantidad: c.cantidad + 1 } : c));
    else setCart([...cart, { evento_menu_id: item.id, nombre: item.nombre, precio_unitario: item.precio, cantidad: 1 }]);
  };

  const updateCartQty = (menuId, delta) => {
    setCart(cart.map(c => {
      if (c.evento_menu_id !== menuId) return c;
      const nq = c.cantidad + delta;
      return nq > 0 ? { ...c, cantidad: nq } : null;
    }).filter(Boolean));
  };

  const cartTotal = cart.reduce((s, c) => s + c.precio_unitario * c.cantidad, 0);

  const registrarVenta = async () => {
    if (cart.length === 0) return show('Agrega items al carrito');
    setSaving(true);
    const { data: venta, error } = await db.from('evento_ventas').insert({ evento_id: evento.id, metodo_pago: metodo, total: cartTotal, registrado_por: user.id }).select().single();
    if (error) { setSaving(false); return show('Error: ' + error.message); }
    const rows = cart.map(c => ({ evento_venta_id: venta.id, evento_menu_id: c.evento_menu_id, cantidad: c.cantidad, precio_unitario: c.precio_unitario }));
    await db.from('evento_venta_items').insert(rows);
    show(`Venta: ${fmt$(cartTotal)} (${PAGO_LABELS[metodo]})`);
    setCart([]); setSaving(false);
    fetchVentas();
  };

  const anular = async (vid) => {
    await db.from('evento_ventas').update({ anulada: true, anulada_por: user.id, anulada_at: new Date().toISOString() }).eq('id', vid);
    show('Venta anulada');
    fetchVentas();
  };

  const totalHoy = ventas.reduce((s, v) => s + n(v.total), 0);

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div className="card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ color: '#34d399', fontSize: 26, fontWeight: 700 }}>{fmt$(totalHoy)}</div>
          <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase' }}>Total ventas</div>
        </div>
        <div className="card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ color: '#fff', fontSize: 26, fontWeight: 700 }}>{ventas.length}</div>
          <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase' }}>Transacciones</div>
        </div>
      </div>

      {/* Payment method */}
      <p className="sec-title">Metodo de pago</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {Object.entries(PAGO_LABELS).map(([key, label]) => (
          <button key={key} className={metodo === key ? 'btn btn-sm btn-red' : 'btn btn-sm btn-ghost'} onClick={() => setMetodo(key)}>
            {PAGO_ICONS[key]} {label}
          </button>
        ))}
      </div>

      {/* Menu grid */}
      <p className="sec-title">Menu</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {menuItems.map(item => (
          <div key={item.id} className="card" style={{ padding: 16, textAlign: 'center', cursor: 'pointer', border: '1px solid #333' }} onClick={() => addToCart(item)}>
            <div style={{ color: '#fff', fontWeight: 600, fontSize: 14, lineHeight: '1.2' }}>{item.nombre}</div>
            <div style={{ color: '#34d399', fontWeight: 700, fontSize: 16, marginTop: 4 }}>{fmt$(item.precio)}</div>
          </div>
        ))}
      </div>
      {menuItems.length === 0 && <p style={{ color: '#555', textAlign: 'center', fontSize: 13, marginBottom: 16 }}>Configura items en la tab Menu primero.</p>}

      {/* Cart */}
      {cart.length > 0 && (
        <div className="card" style={{ padding: 14, border: '2px solid #34d399', marginBottom: 16 }}>
          <p style={{ color: '#fff', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>🛒 Carrito</p>
          {cart.map(c => (
            <div key={c.evento_menu_id} style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: '#ccc', fontSize: 13, flex: 1 }}>{c.nombre}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button style={{ ...stepBtn, width: 36, height: 36 }} onClick={() => updateCartQty(c.evento_menu_id, -1)}>-</button>
                <span style={{ color: '#fff', fontWeight: 600, width: 28, textAlign: 'center', fontSize: 15 }}>{c.cantidad}</span>
                <button style={{ ...stepBtn, width: 36, height: 36 }} onClick={() => updateCartQty(c.evento_menu_id, 1)}>+</button>
                <span style={{ color: '#aaa', fontWeight: 500, width: 64, textAlign: 'right', fontSize: 13 }}>{fmt$(c.precio_unitario * c.cantidad)}</span>
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #333', paddingTop: 10, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>{fmt$(cartTotal)}</span>
            <button className="btn btn-green" style={{ padding: '10px 24px', fontSize: 15 }} onClick={registrarVenta} disabled={saving}>
              {saving ? 'Guardando...' : `💰 Cobrar ${PAGO_ICONS[metodo]}`}
            </button>
          </div>
        </div>
      )}

      {/* History toggle */}
      <button className="btn btn-ghost" onClick={() => setShowHist(!showHist)}>
        {showHist ? 'Ocultar historial' : `📜 Historial (${ventas.length})`}
      </button>
      {showHist && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ventas.map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#111', borderRadius: 8, border: '1px solid #222' }}>
              <div>
                <span style={{ color: '#fff', fontSize: 13 }}>{PAGO_ICONS[v.metodo_pago]} {fmt$(v.total)}</span>
                <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>{new Date(v.created_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</span>
                {v.items && <span style={{ color: '#555', fontSize: 11, marginLeft: 4 }}>({v.items.map(i => i.menu?.nombre).join(', ')})</span>}
              </div>
              <button className="btn btn-sm btn-ghost" style={{ color: '#f87171', fontSize: 11 }} onClick={() => anular(v.id)}>Anular</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 5: CIERRE + DEVOLUCIONES + APROBACION
// ═══════════════════════════════════════════════════
function TabCierre({ user, evento, show, onRefresh }) {
  const [ventas, setVentas] = useState([]);
  const [devoluciones, setDevoluciones] = useState([]);
  const [creatingDev, setCreatingDev] = useState(false);
  const [devItems, setDevItems] = useState([]);
  const [productos, setProductos] = useState([]);
  const [searchDev, setSearchDev] = useState('');
  const [notasCierre, setNotasCierre] = useState('');
  const [notasAprobacion, setNotasAprobacion] = useState('');

  const fetchVentas = useCallback(async () => {
    const { data } = await db.from('evento_ventas').select('*').eq('evento_id', evento.id).eq('anulada', false);
    setVentas(data || []);
  }, [evento.id]);

  const fetchDevoluciones = useCallback(async () => {
    const { data } = await db.from('evento_devoluciones')
      .select('*, items:evento_devolucion_items(*, producto:catalogo_productos(nombre, unidad_medida)), devolvedor:usuarios_erp!devuelto_por(nombre)')
      .eq('evento_id', evento.id).order('created_at', { ascending: false });
    setDevoluciones(data || []);
  }, [evento.id]);

  const fetchProductos = useCallback(async () => {
    const { data } = await db.from('catalogo_productos').select('id, nombre, unidad_medida').eq('activo', true).order('nombre');
    setProductos(data || []);
  }, []);

  useEffect(() => { fetchVentas(); fetchDevoluciones(); fetchProductos(); }, [fetchVentas, fetchDevoluciones, fetchProductos]);

  // Totals
  const isClosed = evento.estado === 'cerrado' || evento.estado === 'aprobado';
  const totalVentas = isClosed ? n(evento.total_ventas) : ventas.reduce((s, v) => s + n(v.total), 0);
  const porMetodo = isClosed
    ? { efectivo: n(evento.total_efectivo), tarjeta: n(evento.total_tarjeta), transferencia: n(evento.total_transferencia), link_pago: n(evento.total_link_pago) }
    : ventas.reduce((acc, v) => { acc[v.metodo_pago] = (acc[v.metodo_pago] || 0) + n(v.total); return acc; }, {});
  const numTx = isClosed ? n(evento.num_transacciones) : ventas.length;

  // Devolucion
  const addDevItem = (prod) => {
    if (devItems.find(i => i.producto_id === prod.id)) return;
    setDevItems([...devItems, { producto_id: prod.id, nombre: prod.nombre, unidad: prod.unidad_medida, cantidad: 1, notas: '' }]);
  };

  const updateDevQty = (idx, delta) => {
    const u = [...devItems];
    u[idx].cantidad = Math.max(0.5, n(u[idx].cantidad) + delta);
    setDevItems(u);
  };

  const crearDevolucion = async () => {
    if (devItems.length === 0) return show('Agrega items a devolver');
    const { data: dev, error } = await db.from('evento_devoluciones').insert({ evento_id: evento.id, devuelto_por: user.id }).select().single();
    if (error) return show('Error: ' + error.message);
    await db.from('evento_devolucion_items').insert(devItems.map(i => ({ evento_devolucion_id: dev.id, producto_id: i.producto_id, cantidad: i.cantidad, notas: i.notas || null })));
    show('Devolucion creada');
    setDevItems([]); setCreatingDev(false);
    fetchDevoluciones();
  };

  const confirmarDev = async (dev) => {
    await db.from('evento_devoluciones').update({ estado: 'recibida', recibido_por: user.id, recibido_at: new Date().toISOString() }).eq('id', dev.id);
    show('Devolucion confirmada');
    fetchDevoluciones();
  };

  const cerrarEvento = async () => {
    const { data, error } = await db.rpc('cerrar_evento', { p_evento_id: evento.id, p_usuario_id: user.id, p_notas: notasCierre || null });
    if (error) return show('Error: ' + error.message);
    if (data && !data.ok) return show(data.error);
    show('Evento cerrado — Total: ' + fmt$(data.total_ventas));
    onRefresh();
  };

  const aprobarEvento = async () => {
    const { data, error } = await db.rpc('aprobar_evento', { p_evento_id: evento.id, p_usuario_id: user.id, p_notas: notasAprobacion || null });
    if (error) return show('Error: ' + error.message);
    if (data && !data.ok) return show(data.error);
    show('Evento aprobado');
    onRefresh();
  };

  const filteredDev = productos.filter(p => p.nombre.toLowerCase().includes(searchDev.toLowerCase()));

  return (
    <div>
      <p className="sec-title">Cierre: {evento.nombre}</p>

      {/* Financial summary */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ color: '#34d399', fontSize: 32, fontWeight: 700 }}>{fmt$(totalVentas)}</div>
          <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase' }}>Total ventas · {numTx} transacciones</div>
          {evento.precio_pactado && <div style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>Precio pactado: {fmt$(evento.precio_pactado)}</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {Object.entries(porMetodo).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: '#111', borderRadius: 8, border: '1px solid #222' }}>
              <span style={{ color: '#aaa', fontSize: 13 }}>{PAGO_ICONS[k]} {PAGO_LABELS[k]}</span>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{fmt$(v)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Devoluciones */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ color: '#aaa', fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }}>↩️ Devoluciones a CM</p>
          {(evento.estado === 'activo' || evento.estado === 'cerrado') && (
            <button className="btn btn-sm btn-ghost" onClick={() => setCreatingDev(!creatingDev)}>{creatingDev ? 'Cancelar' : '+ Devolucion'}</button>
          )}
        </div>

        {creatingDev && (
          <div style={{ background: '#111', borderRadius: 10, padding: 12, border: '1px solid #333', marginBottom: 12 }}>
            <input style={{ ...inputStyle, marginBottom: 8 }} placeholder="Buscar producto..." value={searchDev} onChange={e => setSearchDev(e.target.value)} />
            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
              {filteredDev.slice(0, 15).map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ color: '#ccc', fontSize: 12 }}>{p.nombre} ({p.unidad_medida})</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => addDevItem(p)}>+</button>
                </div>
              ))}
            </div>
            {devItems.length > 0 && (
              <div style={{ borderTop: '1px solid #333', paddingTop: 10, marginTop: 8 }}>
                {devItems.map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{it.nombre}</span>
                    <button style={{ ...stepBtn, width: 36, height: 36 }} onClick={() => updateDevQty(idx, -1)}>-</button>
                    <input style={{ ...inputStyle, width: 56, textAlign: 'center', padding: '4px' }} type="number" step="0.5" value={it.cantidad}
                      onChange={e => { const u = [...devItems]; u[idx].cantidad = n(e.target.value); setDevItems(u); }} />
                    <button style={{ ...stepBtn, width: 36, height: 36 }} onClick={() => updateDevQty(idx, 1)}>+</button>
                    <button style={{ ...stepBtn, width: 36, height: 36, color: '#f87171', fontSize: 16 }} onClick={() => setDevItems(devItems.filter((_, i) => i !== idx))}>✕</button>
                  </div>
                ))}
                <button className="btn btn-orange" style={{ width: '100%', marginTop: 8 }} onClick={crearDevolucion}>↩️ Enviar Devolucion</button>
              </div>
            )}
          </div>
        )}

        {devoluciones.map(dev => (
          <div key={dev.id} style={{ padding: 10, background: '#111', borderRadius: 8, border: '1px solid #222', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={badgeStyle(dev.estado)}>{dev.estado}</span>
                <span style={{ color: '#666', fontSize: 11 }}>{dev.devolvedor?.nombre || '—'}</span>
              </div>
              {dev.estado === 'pendiente' && (isCM(user.rol) || isAdmin(user.rol)) && (
                <button className="btn btn-sm btn-green" onClick={() => confirmarDev(dev)}>📥 Confirmar</button>
              )}
            </div>
            {dev.items?.map(it => (
              <div key={it.id} style={{ color: '#888', fontSize: 12, paddingLeft: 4 }}>
                {it.producto?.nombre}: {it.cantidad} {it.producto?.unidad_medida}
              </div>
            ))}
          </div>
        ))}
        {devoluciones.length === 0 && !creatingDev && <p style={{ color: '#555', textAlign: 'center', fontSize: 12 }}>Sin devoluciones</p>}
      </div>

      {/* Close event */}
      {evento.estado === 'activo' && (
        <div className="card" style={{ padding: 16, border: '2px solid #f59e0b', marginBottom: 16 }}>
          <p style={{ color: '#fff', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>🔒 Cerrar Evento</p>
          <p style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>Esto congela las ventas y genera el resumen financiero.</p>
          <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="Notas de cierre (opcional)" value={notasCierre} onChange={e => setNotasCierre(e.target.value)} />
          <button className="btn btn-orange" style={{ width: '100%' }} onClick={cerrarEvento}>🔒 Cerrar Evento</button>
        </div>
      )}

      {/* Approve event */}
      {evento.estado === 'cerrado' && isAdmin(user.rol) && (
        <div className="card" style={{ padding: 16, border: '2px solid #8b5cf6', marginBottom: 16 }}>
          <p style={{ color: '#fff', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>✅ Aprobar Evento</p>
          <p style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>Solo ejecutivos/admin. Confirma que los numeros estan correctos.</p>
          <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="Notas de aprobacion (opcional)" value={notasAprobacion} onChange={e => setNotasAprobacion(e.target.value)} />
          <button className="btn btn-red" style={{ width: '100%' }} onClick={aprobarEvento}>✅ Aprobar Evento</button>
        </div>
      )}

      {/* Approved status */}
      {evento.estado === 'aprobado' && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 4 }}>✅</div>
          <p style={{ color: '#34d399', fontWeight: 600, fontSize: 15 }}>Evento aprobado por {evento.aprobador?.nombre || '—'}</p>
          {evento.aprobado_at && <p style={{ color: '#666', fontSize: 12 }}>{new Date(evento.aprobado_at).toLocaleString('es-SV')}</p>}
          {evento.notas_aprobacion && <p style={{ color: '#888', fontSize: 12, marginTop: 4 }}>"{evento.notas_aprobacion}"</p>}
        </div>
      )}

      {/* Closed info */}
      {evento.estado === 'cerrado' && evento.cerrador && (
        <div style={{ textAlign: 'center', padding: 12, marginBottom: 8 }}>
          <p style={{ color: '#60a5fa', fontSize: 13 }}>Cerrado por {evento.cerrador?.nombre || '—'} {evento.cerrado_at && <span style={{ color: '#666' }}>({new Date(evento.cerrado_at).toLocaleString('es-SV')})</span>}</p>
          {evento.notas_cierre && <p style={{ color: '#888', fontSize: 12, marginTop: 2 }}>"{evento.notas_cierre}"</p>}
        </div>
      )}
    </div>
  );
}
