import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n } from '../../config';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/Badge';

// ── Helpers ──
const ESTADO_COLOR = {
  planificacion: 'bg-yellow-100 text-yellow-800',
  activo: 'bg-green-100 text-green-800',
  cerrado: 'bg-blue-100 text-blue-800',
  aprobado: 'bg-purple-100 text-purple-800',
  cancelado: 'bg-red-100 text-red-800',
};
const PAGO_ICONS = { efectivo: '💵', tarjeta: '💳', transferencia: '🏦', link_pago: '🔗' };
const PAGO_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', link_pago: 'Link de Pago' };
const isAdmin = (r) => ['ejecutivo','admin','superadmin'].includes(r);
const isCM = (r) => ['jefe_casa_matriz','bodeguero'].includes(r);
const fmt$ = (v) => `$${n(v).toFixed(2)}`;

export default function EventosView({ user }) {
  const [tab, setTab] = useState('lista');
  const [eventos, setEventos] = useState([]);
  const [selectedEvento, setSelectedEvento] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // ── Cargar eventos ──
  const fetchEventos = useCallback(async () => {
    setLoading(true);
    const { data } = await db.from('eventos')
      .select('*, responsable:usuarios_erp!responsable_id(nombre), cerrador:usuarios_erp!cerrado_por(nombre), aprobador:usuarios_erp!aprobado_por(nombre)')
      .order('fecha_evento', { ascending: false });
    setEventos(data || []);
    // Refresh selectedEvento if active
    if (selectedEvento) {
      const fresh = (data || []).find(e => e.id === selectedEvento.id);
      if (fresh) setSelectedEvento(fresh);
    }
    setLoading(false);
  }, [selectedEvento?.id]);

  useEffect(() => { fetchEventos(); }, []);

  const show = (m, t = 3000) => { setMsg(m); setTimeout(() => setMsg(''), t); };

  // ── RENDER ──
  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">🎪 Eventos</h1>
      {msg && <div className="bg-green-100 text-green-800 p-3 rounded-lg text-sm font-medium">{msg}</div>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full flex-wrap">
          <TabsTrigger value="lista">📋 Eventos</TabsTrigger>
          {selectedEvento && <TabsTrigger value="menu">🍔 Menú</TabsTrigger>}
          {selectedEvento && <TabsTrigger value="pedido">📦 Pedido CM</TabsTrigger>}
          {selectedEvento && (selectedEvento.estado === 'activo' || selectedEvento.estado === 'planificacion') && <TabsTrigger value="venta">🛒 Venta</TabsTrigger>}
          {selectedEvento && <TabsTrigger value="cierre">✅ Cierre</TabsTrigger>}
        </TabsList>

        <TabsContent value="lista">
          <TabLista
            user={user} eventos={eventos} selectedEvento={selectedEvento}
            onSelect={(e) => {
              setSelectedEvento(e);
              // Auto-navegar a tab relevante según estado
              if (e.estado === 'planificacion') setTab('menu');
              else if (e.estado === 'activo') setTab('venta');
              else setTab('cierre');
            }}
            onRefresh={fetchEventos} show={show}
            onGoToTab={(t) => setTab(t)}
          />
        </TabsContent>

        {selectedEvento && (
          <>
            <TabsContent value="menu">
              <TabMenu user={user} evento={selectedEvento} show={show} />
            </TabsContent>
            <TabsContent value="pedido">
              <TabPedido user={user} evento={selectedEvento} show={show} onRefresh={fetchEventos} />
            </TabsContent>
            {(selectedEvento.estado === 'activo' || selectedEvento.estado === 'planificacion') && (
              <TabsContent value="venta">
                <TabVenta user={user} evento={selectedEvento} show={show} onRefresh={fetchEventos} />
              </TabsContent>
            )}
            <TabsContent value="cierre">
              <TabCierre user={user} evento={selectedEvento} show={show} onRefresh={fetchEventos} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 1: LISTA DE EVENTOS + CREAR NUEVO
// ═══════════════════════════════════════════════════
function TabLista({ user, eventos, selectedEvento, onSelect, onRefresh, show, onGoToTab }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ nombre: '', descripcion: '', fecha_evento: today(), hora_inicio: '', hora_fin: '', ubicacion: '', cliente: '', precio_pactado: '' });

  const handleCreate = async () => {
    if (!form.nombre || !form.fecha_evento) return show('Nombre y fecha son requeridos');
    const payload = {
      ...form,
      precio_pactado: form.precio_pactado ? n(form.precio_pactado) : null,
      hora_inicio: form.hora_inicio || null,
      hora_fin: form.hora_fin || null,
      responsable_id: user.id,
    };
    const { data: newEvento, error } = await db.from('eventos').insert(payload).select().single();
    if (error) return show('Error: ' + error.message);
    show('Evento creado — configura el menú y pedidos');
    setCreating(false);
    setForm({ nombre: '', descripcion: '', fecha_evento: today(), hora_inicio: '', hora_fin: '', ubicacion: '', cliente: '', precio_pactado: '' });
    await onRefresh();
    if (newEvento) { onSelect(newEvento); onGoToTab('menu'); }
  };

  const activar = async (ev) => {
    await db.from('eventos').update({ estado: 'activo', updated_at: new Date().toISOString() }).eq('id', ev.id);
    show('Evento activado');
    onRefresh();
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mis Eventos</h2>
        <Button size="sm" onClick={() => setCreating(!creating)}>{creating ? 'Cancelar' : '+ Nuevo Evento'}</Button>
      </div>

      {creating && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Input placeholder="Nombre del evento *" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} />
            <Input placeholder="Descripción" value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-400">Fecha *</label><Input type="date" value={form.fecha_evento} onChange={e => setForm({...form, fecha_evento: e.target.value})} /></div>
              <div><label className="text-xs text-gray-400">Ubicación</label><Input placeholder="Lugar" value={form.ubicacion} onChange={e => setForm({...form, ubicacion: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-400">Hora inicio</label><Input type="time" value={form.hora_inicio} onChange={e => setForm({...form, hora_inicio: e.target.value})} /></div>
              <div><label className="text-xs text-gray-400">Hora fin</label><Input type="time" value={form.hora_fin} onChange={e => setForm({...form, hora_fin: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Cliente / Contratante" value={form.cliente} onChange={e => setForm({...form, cliente: e.target.value})} />
              <Input placeholder="Precio pactado $" type="number" step="0.01" value={form.precio_pactado} onChange={e => setForm({...form, precio_pactado: e.target.value})} />
            </div>
            <Button className="w-full" onClick={handleCreate}>Crear Evento</Button>
          </CardContent>
        </Card>
      )}

      {/* Lista de eventos */}
      <div className="space-y-2">
        {eventos.map(ev => (
          <Card key={ev.id} className={`cursor-pointer transition ${selectedEvento?.id === ev.id ? 'ring-2 ring-blue-500' : ''}`}
            onClick={() => onSelect(ev)}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{ev.nombre}</div>
                  <div className="text-xs text-gray-400">{fmtDate(ev.fecha_evento)} · {ev.ubicacion || 'Sin ubicación'} {ev.cliente ? `· ${ev.cliente}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[ev.estado]}`}>{ev.estado}</span>
                  {ev.estado === 'planificacion' && (
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); activar(ev); }}>Activar</Button>
                  )}
                </div>
              </div>
              {ev.total_ventas > 0 && (
                <div className="text-xs mt-1 text-gray-400">Ventas: {fmt$(ev.total_ventas)} · {ev.num_transacciones} tx</div>
              )}
            </CardContent>
          </Card>
        ))}
        {eventos.length === 0 && <p className="text-gray-400 text-center py-8">No hay eventos aún. Crea el primero.</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 2: MENÚ DEL EVENTO (jalar de pos_menu_items)
// ═══════════════════════════════════════════════════
function TabMenu({ user, evento, show }) {
  const [menuItems, setMenuItems] = useState([]);
  const [posItems, setPosItems] = useState([]);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');

  const fetchMenu = useCallback(async () => {
    const { data } = await db.from('evento_menu').select('*').eq('evento_id', evento.id).order('orden');
    setMenuItems(data || []);
  }, [evento.id]);

  const fetchPosItems = useCallback(async () => {
    const { data } = await db.from('pos_menu_items').select('id, nombre, precio, imagen_url').eq('disponible', true).order('nombre');
    // Deduplicar por nombre (hay 1 registro por sucursal/menú)
    const seen = new Map();
    (data || []).forEach(item => {
      if (!seen.has(item.nombre)) seen.set(item.nombre, item);
    });
    setPosItems([...seen.values()]);
  }, []);

  useEffect(() => { fetchMenu(); fetchPosItems(); }, [fetchMenu, fetchPosItems]);

  const addFromPos = async (item) => {
    const precio = customPrice ? n(customPrice) : item.precio;
    const { error } = await db.from('evento_menu').insert({
      evento_id: evento.id,
      nombre: customName || item.nombre,
      precio,
      imagen_url: item.imagen_url,
      pos_menu_item_id: item.id,
      orden: menuItems.length,
    });
    if (error) return show(error.message.includes('unique') ? 'Ya existe ese item en el menú' : 'Error: ' + error.message);
    show(`${item.nombre} agregado al menú`);
    setCustomName('');
    setCustomPrice('');
    fetchMenu();
  };

  const addCustom = async () => {
    if (!customName || !customPrice) return show('Nombre y precio requeridos');
    const { error } = await db.from('evento_menu').insert({
      evento_id: evento.id,
      nombre: customName,
      precio: n(customPrice),
      orden: menuItems.length,
    });
    if (error) return show('Error: ' + error.message);
    show('Item agregado');
    setCustomName('');
    setCustomPrice('');
    fetchMenu();
  };

  const toggleItem = async (item) => {
    await db.from('evento_menu').update({ activo: !item.activo }).eq('id', item.id);
    fetchMenu();
  };

  const updatePrice = async (item, newPrice) => {
    if (!newPrice) return;
    await db.from('evento_menu').update({ precio: n(newPrice) }).eq('id', item.id);
    show('Precio actualizado');
    fetchMenu();
  };

  const removeItem = async (item) => {
    await db.from('evento_menu').delete().eq('id', item.id);
    show('Item eliminado');
    fetchMenu();
  };

  const filtered = posItems.filter(i => i.nombre.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">🍔 Menú: {evento.nombre}</h2>
        <Badge className={ESTADO_COLOR[evento.estado]}>{evento.estado}</Badge>
      </div>

      {/* Items actuales del menú del evento */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Items del Evento ({menuItems.length})</CardTitle></CardHeader>
        <CardContent className="p-3 space-y-2">
          {menuItems.length === 0 && <p className="text-gray-400 text-sm text-center py-4">Sin items. Agrega desde el catálogo POS abajo.</p>}
          {menuItems.map(item => (
            <div key={item.id} className={`flex items-center justify-between p-2 rounded border ${item.activo ? 'border-gray-700 bg-gray-800' : 'border-gray-800 bg-gray-900 opacity-50'}`}>
              <div className="flex-1">
                <span className="font-medium text-sm text-gray-100">{item.nombre}</span>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" step="0.01" className="w-20 text-right text-sm" defaultValue={item.precio}
                  onBlur={e => updatePrice(item, e.target.value)} />
                <Button size="sm" variant="ghost" onClick={() => toggleItem(item)}>{item.activo ? '👁️' : '🚫'}</Button>
                <Button size="sm" variant="ghost" className="text-red-400" onClick={() => removeItem(item)}>✕</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Agregar items */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Agregar Items al Menú</CardTitle></CardHeader>
        <CardContent className="p-3 space-y-3">
          <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
            {adding ? 'Cerrar catálogo' : '📋 Jalar del catálogo POS'}
          </Button>

          {adding && (
            <div className="space-y-2">
              <Input placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} />
              <div className="grid grid-cols-1 gap-1 max-h-60 overflow-y-auto">
                {filtered.slice(0, 30).map(item => (
                  <div key={item.id} className="flex items-center justify-between p-2 rounded border border-gray-700 bg-gray-800 text-sm">
                    <span className="text-gray-200">{item.nombre} — <span className="text-green-400 font-medium">{fmt$(item.precio)}</span></span>
                    <Button size="sm" onClick={() => addFromPos(item)}>+ Agregar</Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-700 pt-3">
            <p className="text-xs text-gray-400 mb-2">O agrega un item personalizado:</p>
            <div className="space-y-2">
              <Input placeholder="Nombre del item" value={customName} onChange={e => setCustomName(e.target.value)} />
              <div className="flex gap-2">
                <Input placeholder="Precio $" type="number" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} className="flex-1" />
                <Button onClick={addCustom}>+ Agregar</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 3: PEDIDO DE INVENTARIO A CASA MATRIZ
// ═══════════════════════════════════════════════════
function TabPedido({ user, evento, show, onRefresh }) {
  const [pedidos, setPedidos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [expandedPedido, setExpandedPedido] = useState(null);
  const [pedidoItems, setPedidoItems] = useState({});

  const fetchPedidos = useCallback(async () => {
    const { data } = await db.from('evento_pedidos')
      .select('*, solicitante:usuarios_erp!solicitado_por(nombre)')
      .eq('evento_id', evento.id).order('created_at', { ascending: false });
    setPedidos(data || []);
  }, [evento.id]);

  const fetchProductos = useCallback(async () => {
    const { data } = await db.from('catalogo_productos').select('id, nombre, codigo, unidad_medida, categoria').eq('activo', true).order('nombre');
    setProductos(data || []);
  }, []);

  useEffect(() => { fetchPedidos(); fetchProductos(); }, [fetchPedidos, fetchProductos]);

  const loadPedidoItems = async (pedidoId) => {
    if (expandedPedido === pedidoId) { setExpandedPedido(null); return; }
    const { data } = await db.from('evento_pedido_items')
      .select('*, producto:catalogo_productos(nombre, unidad_medida)')
      .eq('evento_pedido_id', pedidoId);
    setPedidoItems(prev => ({ ...prev, [pedidoId]: data || [] }));
    setExpandedPedido(pedidoId);
  };

  const addItem = (prod) => {
    if (items.find(i => i.producto_id === prod.id)) return show('Ya agregado');
    setItems([...items, { producto_id: prod.id, nombre: prod.nombre, unidad: prod.unidad_medida, cantidad_solicitada: 1 }]);
  };

  const updateQty = (idx, val) => {
    const updated = [...items];
    updated[idx].cantidad_solicitada = n(val);
    setItems(updated);
  };

  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));

  const crearPedido = async () => {
    if (items.length === 0) return show('Agrega al menos un producto');
    const { data: pedido, error } = await db.from('evento_pedidos').insert({
      evento_id: evento.id,
      solicitado_por: user.id,
    }).select().single();
    if (error) return show('Error: ' + error.message);

    const rows = items.map(i => ({
      evento_pedido_id: pedido.id,
      producto_id: i.producto_id,
      cantidad_solicitada: i.cantidad_solicitada,
    }));
    const { error: e2 } = await db.from('evento_pedido_items').insert(rows);
    if (e2) return show('Error items: ' + e2.message);

    show('Pedido creado');
    setItems([]);
    setCreating(false);
    fetchPedidos();
  };

  // CM: Despachar pedido
  const despachar = async (pedido, itemsData) => {
    // Actualizar cantidades despachadas = solicitadas (CM puede editar)
    for (const it of itemsData) {
      await db.from('evento_pedido_items').update({ cantidad_despachada: it.cantidad_solicitada }).eq('id', it.id);
    }
    await db.from('evento_pedidos').update({
      estado: 'despachado',
      despachado_por: user.id,
      despachado_at: new Date().toISOString(),
    }).eq('id', pedido.id);
    show('Pedido despachado — inventario CM001 actualizado');
    fetchPedidos();
    onRefresh();
  };

  // Merari: Confirmar recepción
  const confirmarRecepcion = async (pedido) => {
    await db.from('evento_pedidos').update({
      estado: 'recibido',
      recibido_at: new Date().toISOString(),
    }).eq('id', pedido.id);
    show('Recepción confirmada');
    fetchPedidos();
  };

  const filtered = productos.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">📦 Pedido a Casa Matriz</h2>
        {(evento.estado === 'planificacion' || evento.estado === 'activo') && (
          <Button size="sm" onClick={() => setCreating(!creating)}>{creating ? 'Cancelar' : '+ Nuevo Pedido'}</Button>
        )}
      </div>

      {creating && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Input placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="max-h-40 overflow-y-auto space-y-1">
              {filtered.slice(0, 20).map(p => (
                <div key={p.id} className="flex items-center justify-between p-2 bg-gray-800 rounded text-sm">
                  <span>{p.nombre} <span className="text-gray-400">({p.unidad_medida})</span></span>
                  <Button size="sm" variant="outline" onClick={() => addItem(p)}>+</Button>
                </div>
              ))}
            </div>
            {items.length > 0 && (
              <div className="border-t pt-2 space-y-1">
                <p className="text-xs font-medium text-gray-400">Items del pedido:</p>
                {items.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{it.nombre} ({it.unidad})</span>
                    <Input type="number" step="0.1" className="w-20 text-right" value={it.cantidad_solicitada}
                      onChange={e => updateQty(idx, e.target.value)} />
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => removeItem(idx)}>✕</Button>
                  </div>
                ))}
                <Button className="w-full mt-2" onClick={crearPedido}>Enviar Pedido a CM</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lista de pedidos */}
      <div className="space-y-2">
        {pedidos.map(p => (
          <Card key={p.id}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => loadPedidoItems(p.id)}>
                <div>
                  <span className="text-sm font-medium">Pedido {fmtDate(p.created_at?.split('T')[0] || '')}</span>
                  <span className="text-xs text-gray-400 ml-2">por {p.solicitante?.nombre || '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={ESTADO_COLOR[p.estado] || 'bg-gray-100'}>{p.estado}</Badge>
                  <span className="text-xs">{expandedPedido === p.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedPedido === p.id && pedidoItems[p.id] && (
                <div className="mt-2 border-t pt-2 space-y-1">
                  {pedidoItems[p.id].map(it => (
                    <div key={it.id} className="flex items-center justify-between text-sm">
                      <span>{it.producto?.nombre}</span>
                      <span>{it.cantidad_solicitada} {it.producto?.unidad_medida} {it.cantidad_despachada > 0 ? `(desp: ${it.cantidad_despachada})` : ''}</span>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    {p.estado === 'pendiente' && isCM(user.rol) && (
                      <Button size="sm" variant="outline" onClick={() => despachar(p, pedidoItems[p.id])}>🚚 Despachar</Button>
                    )}
                    {p.estado === 'pendiente' && isAdmin(user.rol) && (
                      <Button size="sm" variant="outline" onClick={async () => {
                        await db.from('evento_pedidos').update({ estado: 'aprobado', aprobado_por: user.id, aprobado_at: new Date().toISOString() }).eq('id', p.id);
                        show('Pedido aprobado'); fetchPedidos();
                      }}>✅ Aprobar</Button>
                    )}
                    {p.estado === 'despachado' && (
                      <Button size="sm" onClick={() => confirmarRecepcion(p)}>📥 Confirmar Recepción</Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {pedidos.length === 0 && <p className="text-gray-400 text-center py-4 text-sm">No hay pedidos para este evento.</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 4: VENTA RÁPIDA (botones grandes, 1 tap)
// ═══════════════════════════════════════════════════
function TabVenta({ user, evento, show, onRefresh }) {
  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [metodo, setMetodo] = useState('efectivo');
  const [ventas, setVentas] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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
    const existing = cart.find(c => c.evento_menu_id === item.id);
    if (existing) {
      setCart(cart.map(c => c.evento_menu_id === item.id ? { ...c, cantidad: c.cantidad + 1 } : c));
    } else {
      setCart([...cart, { evento_menu_id: item.id, nombre: item.nombre, precio_unitario: item.precio, cantidad: 1 }]);
    }
  };

  const updateCartQty = (menuId, delta) => {
    setCart(cart.map(c => {
      if (c.evento_menu_id !== menuId) return c;
      const newQty = c.cantidad + delta;
      return newQty > 0 ? { ...c, cantidad: newQty } : null;
    }).filter(Boolean));
  };

  const cartTotal = cart.reduce((s, c) => s + c.precio_unitario * c.cantidad, 0);

  const registrarVenta = async () => {
    if (cart.length === 0) return show('Agrega items al carrito');
    setSaving(true);

    const { data: venta, error } = await db.from('evento_ventas').insert({
      evento_id: evento.id,
      metodo_pago: metodo,
      total: cartTotal,
      registrado_por: user.id,
    }).select().single();

    if (error) { setSaving(false); return show('Error: ' + error.message); }

    const rows = cart.map(c => ({
      evento_venta_id: venta.id,
      evento_menu_id: c.evento_menu_id,
      cantidad: c.cantidad,
      precio_unitario: c.precio_unitario,
    }));
    await db.from('evento_venta_items').insert(rows);

    show(`Venta registrada: ${fmt$(cartTotal)} (${PAGO_LABELS[metodo]})`);
    setCart([]);
    setSaving(false);
    fetchVentas();
  };

  const anularVenta = async (ventaId) => {
    await db.from('evento_ventas').update({ anulada: true, anulada_por: user.id, anulada_at: new Date().toISOString() }).eq('id', ventaId);
    show('Venta anulada');
    fetchVentas();
  };

  // Resumen rápido
  const totalHoy = ventas.reduce((s, v) => s + n(v.total), 0);
  const numVentas = ventas.length;

  return (
    <div className="space-y-4 mt-4">
      {/* Resumen rápido */}
      <div className="grid grid-cols-2 gap-2">
        <Card><CardContent className="p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{fmt$(totalHoy)}</div>
          <div className="text-xs text-gray-400">Total ventas</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-2xl font-bold">{numVentas}</div>
          <div className="text-xs text-gray-400">Transacciones</div>
        </CardContent></Card>
      </div>

      {/* Método de pago */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(PAGO_LABELS).map(([key, label]) => (
          <Button key={key} size="sm" variant={metodo === key ? 'default' : 'outline'}
            onClick={() => setMetodo(key)}>
            {PAGO_ICONS[key]} {label}
          </Button>
        ))}
      </div>

      {/* Grid de botones de menú */}
      <div className="grid grid-cols-2 gap-2">
        {menuItems.map(item => (
          <Button key={item.id}
            variant="outline"
            className="h-20 flex flex-col items-center justify-center text-center"
            onClick={() => addToCart(item)}>
            <span className="font-bold text-sm leading-tight">{item.nombre}</span>
            <span className="text-green-600 font-bold">{fmt$(item.precio)}</span>
          </Button>
        ))}
      </div>
      {menuItems.length === 0 && <p className="text-gray-400 text-center text-sm">Configura items en la pestaña Menú primero.</p>}

      {/* Carrito */}
      {cart.length > 0 && (
        <Card className="border-2 border-green-500">
          <CardContent className="p-3 space-y-2">
            <p className="text-sm font-semibold">🛒 Carrito</p>
            {cart.map(c => (
              <div key={c.evento_menu_id} className="flex items-center justify-between text-sm">
                <span className="flex-1">{c.nombre}</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => updateCartQty(c.evento_menu_id, -1)}>−</Button>
                  <span className="w-6 text-center font-medium">{c.cantidad}</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => updateCartQty(c.evento_menu_id, 1)}>+</Button>
                  <span className="ml-2 font-medium w-16 text-right">{fmt$(c.precio_unitario * c.cantidad)}</span>
                </div>
              </div>
            ))}
            <div className="border-t pt-2 flex items-center justify-between">
              <span className="text-lg font-bold">{fmt$(cartTotal)}</span>
              <Button className="bg-green-600 hover:bg-green-700 text-white px-6" onClick={registrarVenta} disabled={saving}>
                {saving ? 'Guardando...' : `💰 Cobrar ${PAGO_ICONS[metodo]}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historial */}
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'Ocultar historial' : `📜 Ver historial (${numVentas})`}
        </Button>
      </div>
      {showHistory && (
        <div className="space-y-1">
          {ventas.map(v => (
            <div key={v.id} className="flex items-center justify-between text-sm p-2 bg-gray-800 rounded">
              <div>
                <span>{PAGO_ICONS[v.metodo_pago]} {fmt$(v.total)}</span>
                <span className="text-xs text-gray-400 ml-2">{new Date(v.created_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</span>
                {v.items && <span className="text-xs text-gray-400 ml-1">({v.items.map(i => i.menu?.nombre).join(', ')})</span>}
              </div>
              <Button size="sm" variant="ghost" className="text-red-400 text-xs" onClick={() => anularVenta(v.id)}>Anular</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB 5: CIERRE + DEVOLUCIÓN + APROBACIÓN
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
      .select('*, items:evento_devolucion_items(*, producto:catalogo_productos(nombre, unidad_medida))')
      .eq('evento_id', evento.id).order('created_at', { ascending: false });
    setDevoluciones(data || []);
  }, [evento.id]);

  const fetchProductos = useCallback(async () => {
    const { data } = await db.from('catalogo_productos').select('id, nombre, unidad_medida').eq('activo', true).order('nombre');
    setProductos(data || []);
  }, []);

  useEffect(() => { fetchVentas(); fetchDevoluciones(); fetchProductos(); }, [fetchVentas, fetchDevoluciones, fetchProductos]);

  // Totales
  const totalVentas = ventas.reduce((s, v) => s + n(v.total), 0);
  const porMetodo = ventas.reduce((acc, v) => {
    acc[v.metodo_pago] = (acc[v.metodo_pago] || 0) + n(v.total);
    return acc;
  }, {});

  // Devolución
  const addDevItem = (prod) => {
    if (devItems.find(i => i.producto_id === prod.id)) return;
    setDevItems([...devItems, { producto_id: prod.id, nombre: prod.nombre, unidad: prod.unidad_medida, cantidad: 1, notas: '' }]);
  };

  const crearDevolucion = async () => {
    if (devItems.length === 0) return show('Agrega items a devolver');
    const { data: dev, error } = await db.from('evento_devoluciones').insert({
      evento_id: evento.id,
      devuelto_por: user.id,
    }).select().single();
    if (error) return show('Error: ' + error.message);

    await db.from('evento_devolucion_items').insert(devItems.map(i => ({
      evento_devolucion_id: dev.id,
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      notas: i.notas || null,
    })));
    show('Devolución creada');
    setDevItems([]);
    setCreatingDev(false);
    fetchDevoluciones();
  };

  // CM: Confirmar devolución
  const confirmarDev = async (dev) => {
    await db.from('evento_devoluciones').update({
      estado: 'recibida',
      recibido_por: user.id,
      recibido_at: new Date().toISOString(),
    }).eq('id', dev.id);
    show('Devolución confirmada — inventario CM001 actualizado');
    fetchDevoluciones();
  };

  // Cerrar evento
  const cerrarEvento = async () => {
    const { data, error } = await db.rpc('cerrar_evento', {
      p_evento_id: evento.id,
      p_usuario_id: user.id,
      p_notas: notasCierre || null,
    });
    if (error) return show('Error: ' + error.message);
    if (data && !data.ok) return show(data.error);
    show(`Evento cerrado — Total: ${fmt$(data.total_ventas)}`);
    onRefresh();
  };

  // Aprobar evento
  const aprobarEvento = async () => {
    const { data, error } = await db.rpc('aprobar_evento', {
      p_evento_id: evento.id,
      p_usuario_id: user.id,
      p_notas: notasAprobacion || null,
    });
    if (error) return show('Error: ' + error.message);
    if (data && !data.ok) return show(data.error);
    show('Evento aprobado');
    onRefresh();
  };

  const filteredDev = productos.filter(p => p.nombre.toLowerCase().includes(searchDev.toLowerCase()));

  return (
    <div className="space-y-4 mt-4">
      <h2 className="text-lg font-semibold">✅ Cierre: {evento.nombre}</h2>

      {/* Resumen financiero */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Resumen de Ventas</CardTitle></CardHeader>
        <CardContent className="p-3">
          <div className="text-2xl font-bold text-green-600 mb-2">{fmt$(evento.estado === 'cerrado' || evento.estado === 'aprobado' ? evento.total_ventas : totalVentas)}</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(evento.estado === 'cerrado' || evento.estado === 'aprobado'
              ? { efectivo: evento.total_efectivo, tarjeta: evento.total_tarjeta, transferencia: evento.total_transferencia, link_pago: evento.total_link_pago }
              : porMetodo
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{PAGO_ICONS[k]} {PAGO_LABELS[k]}</span>
                <span className="font-medium">{fmt$(v)}</span>
              </div>
            ))}
          </div>
          <div className="text-sm mt-2 text-gray-400">
            Transacciones: {evento.estado === 'cerrado' || evento.estado === 'aprobado' ? evento.num_transacciones : ventas.length}
            {evento.precio_pactado && <span className="ml-4">Precio pactado: {fmt$(evento.precio_pactado)}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Devoluciones */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">↩️ Devoluciones a CM</CardTitle>
            {(evento.estado === 'activo' || evento.estado === 'cerrado') && (
              <Button size="sm" variant="outline" onClick={() => setCreatingDev(!creatingDev)}>
                {creatingDev ? 'Cancelar' : '+ Devolución'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {creatingDev && (
            <div className="border rounded p-3 space-y-2 bg-gray-800">
              <Input placeholder="Buscar producto..." value={searchDev} onChange={e => setSearchDev(e.target.value)} />
              <div className="max-h-32 overflow-y-auto space-y-1">
                {filteredDev.slice(0, 15).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm p-1">
                    <span>{p.nombre} ({p.unidad_medida})</span>
                    <Button size="sm" variant="ghost" onClick={() => addDevItem(p)}>+</Button>
                  </div>
                ))}
              </div>
              {devItems.length > 0 && (
                <div className="space-y-1 border-t pt-2">
                  {devItems.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{it.nombre}</span>
                      <Input type="number" step="0.1" className="w-16" value={it.cantidad}
                        onChange={e => { const u = [...devItems]; u[idx].cantidad = n(e.target.value); setDevItems(u); }} />
                      <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDevItems(devItems.filter((_, i) => i !== idx))}>✕</Button>
                    </div>
                  ))}
                  <Button size="sm" className="w-full" onClick={crearDevolucion}>Enviar Devolución</Button>
                </div>
              )}
            </div>
          )}

          {devoluciones.map(dev => (
            <div key={dev.id} className="p-2 bg-gray-800 rounded border text-sm">
              <div className="flex items-center justify-between">
                <Badge className={ESTADO_COLOR[dev.estado] || 'bg-gray-100'}>{dev.estado}</Badge>
                {dev.estado === 'pendiente' && (isCM(user.rol) || isAdmin(user.rol)) && (
                  <Button size="sm" variant="outline" onClick={() => confirmarDev(dev)}>📥 Confirmar</Button>
                )}
              </div>
              {dev.items?.map(it => (
                <div key={it.id} className="text-xs text-gray-400 mt-1">
                  {it.producto?.nombre}: {it.cantidad} {it.producto?.unidad_medida}
                </div>
              ))}
            </div>
          ))}
          {devoluciones.length === 0 && !creatingDev && <p className="text-xs text-gray-400 text-center">Sin devoluciones</p>}
        </CardContent>
      </Card>

      {/* Acciones de cierre/aprobación */}
      {evento.estado === 'activo' && (
        <Card className="border-2 border-orange-300">
          <CardContent className="p-4 space-y-3">
            <p className="font-semibold text-sm">Cerrar Evento</p>
            <Input placeholder="Notas de cierre (opcional)" value={notasCierre} onChange={e => setNotasCierre(e.target.value)} />
            <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white" onClick={cerrarEvento}>
              🔒 Cerrar Evento
            </Button>
          </CardContent>
        </Card>
      )}

      {evento.estado === 'cerrado' && isAdmin(user.rol) && (
        <Card className="border-2 border-purple-300">
          <CardContent className="p-4 space-y-3">
            <p className="font-semibold text-sm">Aprobar Evento</p>
            <Input placeholder="Notas de aprobación (opcional)" value={notasAprobacion} onChange={e => setNotasAprobacion(e.target.value)} />
            <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" onClick={aprobarEvento}>
              ✅ Aprobar Evento
            </Button>
          </CardContent>
        </Card>
      )}

      {evento.estado === 'aprobado' && (
        <div className="text-center py-4">
          <span className="text-lg">✅</span>
          <p className="text-green-600 font-medium">Evento aprobado por {evento.aprobador?.nombre || '—'}</p>
          <p className="text-xs text-gray-400">{evento.aprobado_at && new Date(evento.aprobado_at).toLocaleString('es-SV')}</p>
        </div>
      )}
    </div>
  );
}
