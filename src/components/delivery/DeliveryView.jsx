import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n, STORES } from '../../config';

// ── PINS Y ACCESO ──────────────────────────────────────────────
const EDIT_PINS = ['1000', '2000']; // Jose, Cesar
const ALLOWED_ROLES = ['ejecutivo', 'admin', 'despachador', 'gerente'];

// ── DELIVERY VIEW - GESTIÓN ENTREGAS Y DESPACHO ──────────────
export default function DeliveryView({ user, show }) {
  const [tab, setTab] = useState('despachador'); // despachador | viajes | bonos
  const [loading, setLoading] = useState(true);

  const canEdit = EDIT_PINS.includes(user?.pin) || ALLOWED_ROLES.includes(user?.cargo);

  // Control de acceso
  useEffect(() => {
    if (!canEdit) {
      show('❌ No tienes permisos para acceder a Delivery');
    }
  }, []);

  if (!canEdit) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#e63946' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🚫 Acceso Denegado</div>
        <div style={{ color: '#888', fontSize: 13 }}>Solo ejecutivos y gerentes pueden acceder a este módulo.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      {/* TABS */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', flexWrap: 'nowrap' }}>
        <button
          className={`btn btn-sm ${tab === 'despachador' ? 'btn-red' : 'btn-ghost'}`}
          onClick={() => setTab('despachador')}
        >
          📋 Despacho
        </button>
        <button
          className={`btn btn-sm ${tab === 'viajes' ? 'btn-red' : 'btn-ghost'}`}
          onClick={() => setTab('viajes')}
        >
          🚗 Viajes
        </button>
        <button
          className={`btn btn-sm ${tab === 'bonos' ? 'btn-red' : 'btn-ghost'}`}
          onClick={() => setTab('bonos')}
        >
          💰 Bonos del Mes
        </button>
      </div>

      {/* CONTENIDO TABS */}
      {tab === 'despachador' && <PanelDespachador user={user} show={show} />}
      {tab === 'viajes' && <RegistroViajes user={user} show={show} />}
      {tab === 'bonos' && <BonossDelMes user={user} show={show} />}
    </div>
  );
}

// ── TAB 1: PANEL DESPACHADOR ────────────────────────────────────
function PanelDespachador({ user, show }) {
  const [pedidos, setPedidos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newPedido, setNewPedido] = useState({
    cliente_nombre: '',
    cliente_telefono: '',
    direccion: '',
    zona: '',
    items: '',
    total: '',
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [ped, emp] = await Promise.all([
        db.from('delivery_clientes')
          .select('*')
          .in('estado', ['pendiente', 'asignado', 'en_camino'])
          .order('created_at', { ascending: false }),
        db.from('empleados')
          .select('id,nombre,cargo,sucursal_id')
          .eq('cargo', 'delivery')
          .eq('activo', true),
      ]);
      setPedidos(ped.data || []);
      setEmpleados(emp.data || []);
    } catch (e) {
      show('❌ ' + e.message);
    }
    setLoading(false);
  }, [show]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const crearPedido = async () => {
    if (!newPedido.cliente_nombre.trim()) {
      show('⚠️ Ingresa el nombre del cliente');
      return;
    }
    if (!newPedido.direccion.trim()) {
      show('⚠️ Ingresa la dirección');
      return;
    }
    if (!newPedido.total) {
      show('⚠️ Ingresa el total');
      return;
    }

    try {
      const { error } = await db.from('delivery_clientes').insert({
        sucursal_id: user.sucursal_id || 1,
        cliente_nombre: newPedido.cliente_nombre.trim(),
        cliente_telefono: newPedido.cliente_telefono.trim(),
        direccion: newPedido.direccion.trim(),
        zona: newPedido.zona.trim(),
        items: newPedido.items.trim(),
        total: n(newPedido.total),
        estado: 'pendiente',
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
      show('✅ Pedido creado');
      setNewPedido({ cliente_nombre: '', cliente_telefono: '', direccion: '', zona: '', items: '', total: '' });
      setShowForm(false);
      await cargar();
    } catch (e) {
      show('❌ ' + e.message);
    }
  };

  const asignarDriver = async (pedidoId, driverId) => {
    if (!driverId) {
      show('⚠️ Selecciona un conductor');
      return;
    }
    try {
      const { error } = await db.from('delivery_clientes')
        .update({ estado: 'asignado', repartidor_id: driverId })
        .eq('id', pedidoId);
      if (error) throw error;
      show('✅ Conductor asignado');
      await cargar();
    } catch (e) {
      show('❌ ' + e.message);
    }
  };

  const cambiarEstado = async (pedidoId, nuevoEstado) => {
    try {
      const { error } = await db.from('delivery_clientes')
        .update({ estado: nuevoEstado })
        .eq('id', pedidoId);
      if (error) throw error;
      show(`✅ Pedido marcado como ${nuevoEstado}`);
      await cargar();
    } catch (e) {
      show('❌ ' + e.message);
    }
  };

  // Contar por estado
  const contadores = {
    pendiente: pedidos.filter(p => p.estado === 'pendiente').length,
    asignado: pedidos.filter(p => p.estado === 'asignado').length,
    en_camino: pedidos.filter(p => p.estado === 'en_camino').length,
  };

  return (
    <div>
      {/* CONTADORES */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="badge-count">
          <div style={{ fontSize: 12, color: '#f59e0b' }}>📋 Pendientes</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{contadores.pendiente}</div>
        </div>
        <div className="badge-count">
          <div style={{ fontSize: 12, color: '#3b82f6' }}>📌 Asignados</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{contadores.asignado}</div>
        </div>
        <div className="badge-count">
          <div style={{ fontSize: 12, color: '#8b5cf6' }}>🚗 En Camino</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#8b5cf6' }}>{contadores.en_camino}</div>
        </div>
      </div>

      {/* BOTÓN NUEVO PEDIDO */}
      <button className="btn btn-orange" style={{ width: '100%', marginBottom: 16 }} onClick={() => setShowForm(!showForm)}>
        {showForm ? '✕ Cancelar' : '+ Nuevo Pedido'}
      </button>

      {/* FORM NUEVO PEDIDO */}
      {showForm && (
        <div className="card" style={{ marginBottom: 16, padding: 14, background: '#16213e', borderLeft: '3px solid #f59e0b' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#f59e0b' }}>CREAR PEDIDO</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Cliente"
              value={newPedido.cliente_nombre}
              onChange={e => setNewPedido({ ...newPedido, cliente_nombre: e.target.value })}
              style={inputStyle}
            />
            <input
              type="tel"
              placeholder="Teléfono"
              value={newPedido.cliente_telefono}
              onChange={e => setNewPedido({ ...newPedido, cliente_telefono: e.target.value })}
              style={inputStyle}
            />
          </div>
          <input
            type="text"
            placeholder="Dirección"
            value={newPedido.direccion}
            onChange={e => setNewPedido({ ...newPedido, direccion: e.target.value })}
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Zona"
              value={newPedido.zona}
              onChange={e => setNewPedido({ ...newPedido, zona: e.target.value })}
              style={inputStyle}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Total ($)"
              value={newPedido.total}
              onChange={e => setNewPedido({ ...newPedido, total: e.target.value })}
              style={inputStyle}
            />
          </div>
          <textarea
            placeholder="Items (Ej: 1x Smash Burger, 1x Refr.)"
            value={newPedido.items}
            onChange={e => setNewPedido({ ...newPedido, items: e.target.value })}
            style={{ ...inputStyle, minHeight: 50, marginBottom: 8, fontFamily: 'monospace', fontSize: 12 }}
          />
          <button className="btn btn-green" style={{ width: '100%' }} onClick={crearPedido}>
            💾 Crear Pedido
          </button>
        </div>
      )}

      {/* LISTA PEDIDOS */}
      {loading && <div className="spin" style={{ width: 28, height: 28, margin: '20px auto' }} />}
      {!loading && pedidos.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <div className="empty-text">No hay pedidos activos</div>
        </div>
      )}

      {!loading &&
        pedidos.map(ped => (
          <PedidoCard
            key={ped.id}
            pedido={ped}
            empleados={empleados}
            onAsignar={asignarDriver}
            onCambiarEstado={cambiarEstado}
          />
        ))}
    </div>
  );
}

// ── CARD PEDIDO ────────────────────────────────────────────────
function PedidoCard({ pedido, empleados, onAsignar, onCambiarEstado }) {
  const [selectedDriver, setSelectedDriver] = useState(pedido.repartidor_id || '');
  const driverNombre = empleados.find(e => e.id === selectedDriver)?.nombre || empleados.find(e => e.id === pedido.repartidor_id)?.nombre || '';

  const estadoColor = {
    pendiente: '#f59e0b',
    asignado: '#3b82f6',
    en_camino: '#8b5cf6',
    entregado: '#4ade80',
    cancelado: '#ef4444',
  };

  const estadoColor_ = estadoColor[pedido.estado] || '#666';

  return (
    <div className="card" style={{ borderLeft: `4px solid ${estadoColor_}`, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{pedido.cliente_nombre}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>📍 {pedido.direccion}</div>
          {pedido.zona && <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>Zona: {pedido.zona}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: estadoColor_ }}>
            {pedido.estado.toUpperCase()}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#4ade80', marginTop: 4 }}>
            ${n(pedido.total).toFixed(2)}
          </div>
        </div>
      </div>

      {pedido.cliente_telefono && (
        <div style={{ fontSize: 12, color: '#60a5fa', marginBottom: 8 }}>
          📱 {pedido.cliente_telefono}
        </div>
      )}

      {pedido.items && (
        <div style={{ fontSize: 12, color: '#ddd', background: '#16213e', padding: 8, borderRadius: 6, marginBottom: 8 }}>
          {pedido.items}
        </div>
      )}

      {pedido.distancia_km && (
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
          📏 {n(pedido.distancia_km).toFixed(1)} km
        </div>
      )}

      {/* SELECTOR CONDUCTOR */}
      {pedido.estado === 'pendiente' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <select
            value={selectedDriver}
            onChange={e => setSelectedDriver(e.target.value)}
            style={{ ...inputStyle, flex: 1, fontSize: 12 }}
          >
            <option value="">— Seleccionar conductor —</option>
            {empleados.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.nombre}
              </option>
            ))}
          </select>
          <button
            className="btn btn-blue btn-sm"
            onClick={() => onAsignar(pedido.id, selectedDriver)}
          >
            Asignar
          </button>
        </div>
      )}

      {/* BOTONES ACCIÓN */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {pedido.estado === 'asignado' && (
          <button
            className="btn btn-purple btn-sm"
            onClick={() => onCambiarEstado(pedido.id, 'en_camino')}
          >
            🚗 En Camino
          </button>
        )}
        {pedido.estado === 'en_camino' && (
          <button
            className="btn btn-green btn-sm"
            onClick={() => onCambiarEstado(pedido.id, 'entregado')}
          >
            ✅ Entregado
          </button>
        )}
        {pedido.estado !== 'entregado' && pedido.estado !== 'cancelado' && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onCambiarEstado(pedido.id, 'cancelado')}
          >
            🚫 Cancelar
          </button>
        )}
      </div>

      {driverNombre && (
        <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 8, paddingTop: 8, borderTop: '1px solid #333' }}>
          🚚 Conductor: {driverNombre}
        </div>
      )}
    </div>
  );
}

// ── TAB 2: REGISTRO DE VIAJES ──────────────────────────────────
function RegistroViajes({ user, show }) {
  const [viajes, setViajes] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newViaje, setNewViaje] = useState({
    empleado_id: '',
    delivery_id: '',
    distancia_km: '',
    es_fuera_de_horario: false,
    tipo: 'entrega',
    notas: '',
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [vjs, emp, ped, cfg] = await Promise.all([
        db.from('viajes_delivery')
          .select('*, empleados(nombre)')
          .eq('fecha', today())
          .order('created_at', { ascending: false }),
        db.from('empleados')
          .select('id,nombre,cargo')
          .eq('cargo', 'delivery')
          .eq('activo', true),
        db.from('delivery_clientes')
          .select('id,cliente_nombre,cliente_telefono,estado')
          .eq('estado', 'en_camino')
          .order('created_at', { ascending: false }),
        db.from('config_delivery')
          .select('*')
          .limit(1)
          .single(),
      ]);
      setViajes(vjs.data || []);
      setEmpleados(emp.data || []);
      setPedidos(ped.data || []);
      setConfig(cfg.data || {});
    } catch (e) {
      show('❌ ' + e.message);
    }
    setLoading(false);
  }, [show]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const registrarViaje = async () => {
    if (!newViaje.empleado_id) {
      show('⚠️ Selecciona un conductor');
      return;
    }
    if (!newViaje.distancia_km) {
      show('⚠️ Ingresa la distancia en km');
      return;
    }

    try {
      const { error } = await db.from('viajes_delivery').insert({
        empleado_id: newViaje.empleado_id,
        delivery_id: newViaje.delivery_id || null,
        fecha: today(),
        distancia_km: n(newViaje.distancia_km),
        es_fuera_de_horario: newViaje.es_fuera_de_horario,
        tipo: newViaje.tipo,
        notas: newViaje.notas.trim(),
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
      show('✅ Viaje registrado');
      setNewViaje({
        empleado_id: '',
        delivery_id: '',
        distancia_km: '',
        es_fuera_de_horario: false,
        tipo: 'entrega',
        notas: '',
      });
      setShowForm(false);
      await cargar();
    } catch (e) {
      show('❌ ' + e.message);
    }
  };

  // Calcular tarifa
  const calcularTarifa = () => {
    if (!config || !newViaje.distancia_km) return 0;
    const dist = n(newViaje.distancia_km);
    const umbral = n(config.km_umbral || 17);
    let tarifa = 0;

    if (newViaje.es_fuera_de_horario) {
      tarifa = n(config.tarifa_fuera_horario || 3.0);
    } else if (dist > umbral) {
      tarifa = n(config.tarifa_larga || 1.0);
    } else {
      tarifa = newViaje.tipo === 'mandado' ? n(config.tarifa_mandado || 0.5) : n(config.tarifa_normal || 0.5);
    }
    return tarifa;
  };

  return (
    <div>
      {/* BOTÓN REGISTRAR VIAJE */}
      <button className="btn btn-orange" style={{ width: '100%', marginBottom: 16 }} onClick={() => setShowForm(!showForm)}>
        {showForm ? '✕ Cancelar' : '+ Registrar Viaje'}
      </button>

      {/* FORM VIAJE */}
      {showForm && (
        <div className="card" style={{ marginBottom: 16, padding: 14, background: '#16213e', borderLeft: '3px solid #f59e0b' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#f59e0b' }}>NUEVO VIAJE</div>

          <label style={labelStyle}>Conductor</label>
          <select
            value={newViaje.empleado_id}
            onChange={e => setNewViaje({ ...newViaje, empleado_id: e.target.value })}
            style={{ ...inputStyle, marginBottom: 10 }}
          >
            <option value="">— Seleccionar conductor —</option>
            {empleados.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.nombre}
              </option>
            ))}
          </select>

          <label style={labelStyle}>Pedido (Opcional)</label>
          <select
            value={newViaje.delivery_id}
            onChange={e => setNewViaje({ ...newViaje, delivery_id: e.target.value })}
            style={{ ...inputStyle, marginBottom: 10 }}
          >
            <option value="">— Sin pedido específico —</option>
            {pedidos.map(ped => (
              <option key={ped.id} value={ped.id}>
                {ped.cliente_nombre}
              </option>
            ))}
          </select>

          <label style={labelStyle}>Distancia (km)</label>
          <input
            type="number"
            step="0.1"
            placeholder="0.0"
            value={newViaje.distancia_km}
            onChange={e => setNewViaje({ ...newViaje, distancia_km: e.target.value })}
            style={{ ...inputStyle, marginBottom: 10 }}
          />

          <label style={labelStyle}>Tipo</label>
          <select
            value={newViaje.tipo}
            onChange={e => setNewViaje({ ...newViaje, tipo: e.target.value })}
            style={{ ...inputStyle, marginBottom: 10 }}
          >
            <option value="entrega">Entrega</option>
            <option value="mandado">Mandado</option>
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input
              type="checkbox"
              id="fuera_horario"
              checked={newViaje.es_fuera_de_horario}
              onChange={e => setNewViaje({ ...newViaje, es_fuera_de_horario: e.target.checked })}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <label htmlFor="fuera_horario" style={{ fontSize: 13, color: '#ddd', cursor: 'pointer' }}>
              ⏰ Fuera de horario
            </label>
          </div>

          <label style={labelStyle}>Notas</label>
          <textarea
            placeholder="Observaciones del viaje..."
            value={newViaje.notas}
            onChange={e => setNewViaje({ ...newViaje, notas: e.target.value })}
            style={{ ...inputStyle, minHeight: 50, marginBottom: 12, fontFamily: 'monospace', fontSize: 12 }}
          />

          {/* TARIFA CALCULADA */}
          <div
            style={{
              background: '#1a1a2e',
              padding: 10,
              borderRadius: 6,
              marginBottom: 12,
              border: '1px solid #333',
            }}
          >
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>TARIFA ESTIMADA</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80' }}>
              ${calcularTarifa().toFixed(2)}
            </div>
          </div>

          <button className="btn btn-green" style={{ width: '100%' }} onClick={registrarViaje}>
            💾 Registrar Viaje
          </button>
        </div>
      )}

      {/* LISTA VIAJES */}
      {loading && <div className="spin" style={{ width: 28, height: 28, margin: '20px auto' }} />}
      {!loading && viajes.length === 0 && (
        <div className="empty">
          <div className="empty-icon">🚗</div>
          <div className="empty-text">Sin viajes hoy</div>
        </div>
      )}

      {!loading &&
        viajes.map(viaje => (
          <div key={viaje.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {viaje.empleados?.nombre || 'Conductor'}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {viaje.tipo === 'mandado' ? '📦' : '🚗'} {viaje.tipo}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>
                  {n(viaje.distancia_km).toFixed(1)} km
                </div>
                {viaje.es_fuera_de_horario && (
                  <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>⏰ Fuera de horario</div>
                )}
              </div>
            </div>
            {viaje.notas && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 4, paddingTop: 4, borderTop: '1px solid #333' }}>
                📝 {viaje.notas}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

// ── TAB 3: BONOS DEL MES ───────────────────────────────────────
function BonossDelMes({ user, show }) {
  const [bonos, setBonos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [viajes, setViajes] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mesSelec, setMesSelec] = useState(today().substring(0, 7)); // YYYY-MM

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [emp, vjs, cfg] = await Promise.all([
        db.from('empleados')
          .select('id,nombre,cargo')
          .eq('cargo', 'delivery')
          .eq('activo', true),
        db.from('viajes_delivery')
          .select('*')
          .like('fecha', mesSelec + '%'),
        db.from('config_delivery')
          .select('*')
          .limit(1)
          .single(),
      ]);
      setEmpleados(emp.data || []);
      setViajes(vjs.data || []);
      setConfig(cfg.data || {});
    } catch (e) {
      show('❌ ' + e.message);
    }
    setLoading(false);
  }, [mesSelec, show]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Calcular bonos por driver
  const calcularBonos = useMemo(() => {
    const result = {};
    empleados.forEach(emp => {
      const empViajes = viajes.filter(v => v.empleado_id === emp.id);
      const entregas_normal = empViajes.filter(
        v => v.tipo === 'entrega' && !v.es_fuera_de_horario && n(v.distancia_km) <= (config.km_umbral || 17)
      ).length;
      const entregas_larga_distancia = empViajes.filter(
        v => v.tipo === 'entrega' && n(v.distancia_km) > (config.km_umbral || 17)
      ).length;
      const fuera_horario = empViajes.filter(v => v.es_fuera_de_horario).length;
      const mandados = empViajes.filter(v => v.tipo === 'mandado').length;

      const bono =
        entregas_normal * n(config.tarifa_normal || 0.5) +
        entregas_larga_distancia * n(config.tarifa_larga || 1.0) +
        fuera_horario * n(config.tarifa_fuera_horario || 3.0) +
        mandados * n(config.tarifa_mandado || 0.5);

      result[emp.id] = {
        nombre: emp.nombre,
        entregas_normal,
        entregas_larga_distancia,
        fuera_horario,
        mandados,
        bono_total: bono,
        viajes_total: empViajes.length,
      };
    });
    return result;
  }, [empleados, viajes, config]);

  const totalBono = Object.values(calcularBonos).reduce((sum, d) => sum + n(d.bono_total), 0);
  const totalViajes = Object.values(calcularBonos).reduce((sum, d) => sum + d.viajes_total, 0);

  // Inputs para mes
  const minDate = '2026-01-01';
  const maxDate = today();

  return (
    <div>
      {/* SELECTOR MES */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Período</label>
        <input
          type="month"
          value={mesSelec}
          onChange={e => setMesSelec(e.target.value)}
          min={minDate}
          max={maxDate}
          style={{ ...inputStyle }}
        />
      </div>

      {/* TABLA BONOS */}
      {loading && <div className="spin" style={{ width: 28, height: 28, margin: '20px auto' }} />}

      {!loading && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #444' }}>
                <th style={thStyle}>Conductor</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Normal</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Largas</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Fuera Hr</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Mandados</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Bono Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(calcularBonos).map(driver => (
                <tr key={driver.nombre} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#ddd' }}>{driver.nombre}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#60a5fa' }}>{driver.entregas_normal}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#f59e0b' }}>{driver.entregas_larga_distancia}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#e63946' }}>{driver.fuera_horario}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>{driver.mandados}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>
                    ${n(driver.bono_total).toFixed(2)}
                  </td>
                </tr>
              ))}

              {/* TOTALES */}
              <tr style={{ borderTop: '2px solid #666', background: '#16213e' }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#fff' }}>TOTAL</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}></td>
                <td style={{ ...tdStyle, textAlign: 'center' }}></td>
                <td style={{ ...tdStyle, textAlign: 'center' }}></td>
                <td style={{ ...tdStyle, textAlign: 'center' }}></td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#4ade80', fontSize: 14 }}>
                  ${totalBono.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* RESUMEN */}
      {!loading && (
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150, background: '#16213e', padding: 12, borderRadius: 8, borderLeft: '3px solid #4ade80' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Total Bonos</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80' }}>${totalBono.toFixed(2)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 150, background: '#16213e', padding: 12, borderRadius: 8, borderLeft: '3px solid #60a5fa' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Total Viajes</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa' }}>{totalViajes}</div>
          </div>
          <div style={{ flex: 1, minWidth: 150, background: '#16213e', padding: 12, borderRadius: 8, borderLeft: '3px solid #f59e0b' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Promedio/Viaje</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>
              ${totalViajes > 0 ? (totalBono / totalViajes).toFixed(2) : '0.00'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ESTILOS REUTILIZABLES ──────────────────────────────────────
const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#16213e',
  color: '#eee',
  fontSize: 13,
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: 12,
  color: '#888',
  marginBottom: 6,
  fontWeight: 600,
};

const thStyle = {
  padding: '10px 8px',
  fontSize: 12,
  color: '#888',
  textAlign: 'left',
  fontWeight: 600,
};

const tdStyle = {
  padding: '10px 8px',
  fontSize: 13,
  color: '#ddd',
};
