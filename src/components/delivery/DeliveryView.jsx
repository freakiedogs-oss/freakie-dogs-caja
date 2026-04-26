import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';
import { today, n } from '../../config';

// ── Paleta ──────────────────────────────────────────────────────────────────
const c = {
  bg: '#111', card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', purple: '#a78bfa', text: '#f0f0f0', dim: '#888', off: '#555',
};
const card = (ex = {}) => ({ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14, marginBottom: 10, ...ex });
const btn  = (bg, fg = '#fff') => ({ padding: '9px 16px', borderRadius: 8, background: bg, color: fg, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
const inp  = { background: c.input, border: `1px solid #333`, borderRadius: 8, padding: '9px 12px', color: c.text, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const lbl  = { display: 'block', fontSize: 11, color: c.dim, marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
const kpi  = (color) => ({ flex: 1, minWidth: 140, background: '#16213e', padding: 12, borderRadius: 8, borderLeft: `3px solid ${color}` });

// ── Cargos de motoristas (case-sensitive, tal como está en BD) ───────────────
const CARGOS_DRIVER = ['Motorista', 'Domicilio', 'Motorista Interno', 'Domicilios Propios'];

// ── config_delivery: array {parametro,valor} → objeto plano ─────────────────
const parseCfg = rows => (rows || []).reduce((a, r) => { a[r.parametro] = parseFloat(r.valor); return a; }, {});

// ── Tarifa EXCLUSIVA: fuera_de_horario reemplaza el bono de distancia ────────
// $0.50 viaje <17km | $1.00 viaje ≥17km | $3.00 viaje fuera de horario (flat)
// Un viaje fuera de horario siempre vale $3 sin importar la distancia
function calcTarifa(tipo, dist, fuera, cfg) {
  if (fuera) return cfg.tarifa_fuera_horario ?? 3.0;
  if (tipo === 'mandado') return cfg.tarifa_mandado ?? 0.5;
  const umbral = cfg.km_umbral_doble ?? 17;
  return n(dist) >= umbral ? (cfg.tarifa_entrega_larga ?? 1.0) : (cfg.tarifa_entrega_normal ?? 0.5);
}

// ── Resumen de bono mensual por driver ───────────────────────────────────────
function bonoDriver(viajes, cfg) {
  const umbral   = cfg.km_umbral_doble ?? 17;
  // fuera_horario es exclusivo: esos viajes NO cuentan en normal/larga/mandados
  const fuera    = viajes.filter(v => v.es_fuera_de_horario).length;
  const normal   = viajes.filter(v => !v.es_fuera_de_horario && v.tipo === 'entrega' && n(v.distancia_km) < umbral).length;
  const larga    = viajes.filter(v => !v.es_fuera_de_horario && v.tipo === 'entrega' && n(v.distancia_km) >= umbral).length;
  const mandados = viajes.filter(v => !v.es_fuera_de_horario && v.tipo === 'mandado').length;
  const total    = normal * (cfg.tarifa_entrega_normal ?? 0.5)
                 + larga  * (cfg.tarifa_entrega_larga  ?? 1.0)
                 + fuera  * (cfg.tarifa_fuera_horario  ?? 3.0)
                 + mandados * (cfg.tarifa_mandado       ?? 0.5);
  return { normal, larga, fuera, mandados, total: Math.round(total * 100) / 100 };
}

const mesActual = () => {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const fmtMes = m => { if (!m) return ''; const [y, mo] = m.split('-'); return `${MESES[+mo - 1]} ${y}`; };

// ═══════════════════════════════════════════════════════════════════════════════
export default function DeliveryView({ user, show = () => {} }) {
  const [tab, setTab] = useState('viajes');
  const rol = user?.rol || '';
  const puedeAprobar = ['ejecutivo', 'superadmin', 'admin'].includes(rol);

  return (
    <div style={{ padding: '16px 16px 100px', background: c.bg, minHeight: '100vh' }}>
      {/* TABS */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {[['despacho','📋 Despacho'],['viajes','🚗 Viajes'],['bonos','💰 Bonos']].map(([k, etq]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            background: tab === k ? c.red : '#222',
            color: tab === k ? '#fff' : c.dim,
          }}>{etq}</button>
        ))}
      </div>

      {tab === 'despacho' && <TabDespacho user={user} show={show} puedeAprobar={puedeAprobar} />}
      {tab === 'viajes'   && <TabViajes   user={user} show={show} />}
      {tab === 'bonos'    && <TabBonos    user={user} show={show} puedeAprobar={puedeAprobar} />}
    </div>
  );
}

// ── TAB 1: PANEL DESPACHADOR ─────────────────────────────────────────────────
function TabDespacho({ user, show }) {
  const [pedidos, setPedidos]     = useState([]);
  const [drivers, setDrivers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [nuevo, setNuevo]         = useState({ cliente_nombre: '', cliente_telefono: '', direccion: '', zona: '', items: '', total: '' });

  const cargar = useCallback(async () => {
    setLoading(true);
    const [ped, emp] = await Promise.all([
      db.from('delivery_clientes').select('*').order('created_at', { ascending: false }).limit(50),
      db.from('empleados').select('id,nombre,cargo').in('cargo', CARGOS_DRIVER).eq('activo', true),
    ]);
    setPedidos(ped.data || []);
    setDrivers(emp.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const crearPedido = async () => {
    if (!nuevo.cliente_nombre.trim()) { show('⚠️ Ingresa nombre del cliente'); return; }
    const { error } = await db.from('delivery_clientes').insert({
      ...nuevo, total: n(nuevo.total), estado: 'pendiente', created_at: new Date().toISOString(),
    });
    if (error) { show('❌ ' + error.message); return; }
    show('✅ Pedido creado');
    setNuevo({ cliente_nombre: '', cliente_telefono: '', direccion: '', zona: '', items: '', total: '' });
    setShowForm(false);
    cargar();
  };

  const asignar = async (pedidoId, driverId) => {
    if (!driverId) { show('⚠️ Selecciona un conductor'); return; }
    const { error } = await db.from('delivery_clientes').update({ empleado_id: driverId, estado: 'asignado' }).eq('id', pedidoId);
    if (error) { show('❌ ' + error.message); return; }
    show('✅ Conductor asignado');
    cargar();
  };

  const cambiarEstado = async (id, estado) => {
    const { error } = await db.from('delivery_clientes').update({ estado }).eq('id', id);
    if (error) { show('❌ ' + error.message); return; }
    cargar();
  };

  const colorEstado = { pendiente: c.yellow, asignado: c.blue, en_camino: c.orange, entregado: c.green, cancelado: c.off };

  return (
    <div>
      <button onClick={() => setShowForm(!showForm)} style={{ ...btn(c.red), width: '100%', marginBottom: 16 }}>
        {showForm ? '✕ Cancelar' : '+ Nuevo Pedido'}
      </button>

      {showForm && (
        <div style={card({ borderLeft: `3px solid ${c.red}`, marginBottom: 16 })}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.red, marginBottom: 12 }}>NUEVO PEDIDO</div>
          {[
            ['cliente_nombre', 'Cliente *', 'text'],
            ['cliente_telefono', 'Teléfono', 'tel'],
            ['direccion', 'Dirección', 'text'],
            ['zona', 'Zona / Colonia', 'text'],
            ['items', 'Descripción del pedido', 'text'],
            ['total', 'Total ($)', 'number'],
          ].map(([field, label, type]) => (
            <div key={field} style={{ marginBottom: 10 }}>
              <label style={lbl}>{label}</label>
              <input type={type} placeholder={label} value={nuevo[field]}
                onChange={e => setNuevo({ ...nuevo, [field]: e.target.value })}
                style={inp} />
            </div>
          ))}
          <button onClick={crearPedido} style={{ ...btn(c.green), width: '100%' }}>💾 Crear Pedido</button>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 32, color: c.dim }}>Cargando...</div>}

      {!loading && pedidos.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: c.dim }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🛵</div>
          <div>Sin pedidos registrados</div>
        </div>
      )}

      {!loading && pedidos.map(p => {
        const driverNombre = drivers.find(d => d.id === p.empleado_id)?.nombre;
        return (
          <PedidoCard key={p.id} pedido={p} drivers={drivers} driverNombre={driverNombre}
            colorEstado={colorEstado} onAsignar={asignar} onCambiar={cambiarEstado} />
        );
      })}
    </div>
  );
}

function PedidoCard({ pedido: p, drivers, driverNombre, colorEstado, onAsignar, onCambiar }) {
  const [selDriver, setSelDriver] = useState('');
  return (
    <div style={card()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{p.cliente_nombre}</div>
          {p.direccion && <div style={{ fontSize: 12, color: c.dim, marginTop: 2 }}>{p.direccion}{p.zona ? ` · ${p.zona}` : ''}</div>}
          {p.cliente_telefono && <div style={{ fontSize: 12, color: c.blue, marginTop: 2 }}>📱 {p.cliente_telefono}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colorEstado[p.estado] || c.dim }}>{p.estado?.toUpperCase()}</div>
          {p.total > 0 && <div style={{ fontSize: 14, fontWeight: 700, color: c.green, marginTop: 4 }}>${n(p.total).toFixed(2)}</div>}
        </div>
      </div>

      {p.items && (
        <div style={{ fontSize: 12, color: '#ccc', background: '#16213e', padding: 8, borderRadius: 6, marginBottom: 8 }}>{p.items}</div>
      )}

      {p.estado === 'pendiente' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <select value={selDriver} onChange={e => setSelDriver(e.target.value)}
            style={{ ...inp, flex: 1, fontSize: 12 }}>
            <option value="">— Conductor —</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.nombre} ({d.cargo})</option>)}
          </select>
          <button onClick={() => onAsignar(p.id, selDriver)} style={btn(c.blue)}>Asignar</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {p.estado === 'asignado'  && <button onClick={() => onCambiar(p.id, 'en_camino')} style={btn(c.purple)}>🚗 En Camino</button>}
        {p.estado === 'en_camino' && <button onClick={() => onCambiar(p.id, 'entregado')} style={btn(c.green)}>✅ Entregado</button>}
        {!['entregado','cancelado'].includes(p.estado) && (
          <button onClick={() => onCambiar(p.id, 'cancelado')} style={btn('#333', c.dim)}>🚫 Cancelar</button>
        )}
      </div>

      {driverNombre && (
        <div style={{ fontSize: 11, color: c.blue, marginTop: 8, paddingTop: 8, borderTop: `1px solid #333` }}>
          🚚 Conductor: {driverNombre}
        </div>
      )}
    </div>
  );
}

// ── TAB 2: REGISTRO DE VIAJES ────────────────────────────────────────────────
function TabViajes({ user, show }) {
  const [viajes, setViajes]     = useState([]);
  const [drivers, setDrivers]   = useState([]);
  const [config, setConfig]     = useState({});
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filtroFecha, setFiltroFecha] = useState(today());
  const [form, setForm] = useState({
    empleado_id: '', tipo: 'entrega', distancia_km: '',
    es_fuera_de_horario: false, descripcion_mandado: '', notas: '',
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    const [vjs, emp, cfg] = await Promise.all([
      db.from('viajes_delivery')
        .select('*, empleados(nombre,cargo)')
        .eq('fecha', filtroFecha)
        .order('created_at', { ascending: false }),
      db.from('empleados').select('id,nombre,cargo').in('cargo', CARGOS_DRIVER).eq('activo', true),
      db.from('config_delivery').select('parametro,valor'),
    ]);
    setViajes(vjs.data || []);
    setDrivers(emp.data || []);
    setConfig(parseCfg(cfg.data));
    setLoading(false);
  }, [filtroFecha]);

  useEffect(() => { cargar(); }, [cargar]);

  const f = form;
  const tarifaPreview = useMemo(() =>
    (f.tipo && Object.keys(config).length > 0)
      ? calcTarifa(f.tipo, n(f.distancia_km), f.es_fuera_de_horario, config)
      : null,
    [f.tipo, f.distancia_km, f.es_fuera_de_horario, config]
  );

  const registrar = async () => {
    if (!form.empleado_id) { show('⚠️ Selecciona un conductor'); return; }
    if (form.tipo === 'entrega' && !form.distancia_km) { show('⚠️ Ingresa la distancia en km'); return; }

    const payload = {
      empleado_id: form.empleado_id,
      fecha: filtroFecha,
      tipo: form.tipo,
      distancia_km: form.tipo === 'entrega' ? n(form.distancia_km) : 0,
      es_fuera_de_horario: form.es_fuera_de_horario,
      descripcion_mandado: form.descripcion_mandado.trim() || null,
      notas: form.notas.trim() || null,
      created_at: new Date().toISOString(),
    };
    const { error } = await db.from('viajes_delivery').insert(payload);
    if (error) { show('❌ ' + error.message); return; }
    show(`✅ Viaje registrado — $${tarifaPreview?.toFixed(2)}`);
    setForm({ empleado_id: '', tipo: 'entrega', distancia_km: '', es_fuera_de_horario: false, descripcion_mandado: '', notas: '' });
    setShowForm(false);
    cargar();
  };

  // Totales del día
  const totalDia     = viajes.length;
  const bonoDia      = viajes.reduce((s, v) => s + calcTarifa(v.tipo, n(v.distancia_km), v.es_fuera_de_horario, config), 0);
  const fueraHorario = viajes.filter(v => v.es_fuera_de_horario).length;

  return (
    <div>
      {/* Filtro fecha */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)}
          style={{ ...inp, flex: 1 }} />
        <button onClick={() => setFiltroFecha(today())} style={btn('#333', c.dim)}>Hoy</button>
      </div>

      {/* KPIs del día */}
      {!loading && viajes.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={kpi(c.blue)}><div style={{ fontSize: 10, color: c.dim }}>VIAJES</div><div style={{ fontSize: 20, fontWeight: 700, color: c.blue }}>{totalDia}</div></div>
          <div style={kpi(c.green)}><div style={{ fontSize: 10, color: c.dim }}>BONO DÍA</div><div style={{ fontSize: 20, fontWeight: 700, color: c.green }}>${bonoDia.toFixed(2)}</div></div>
          <div style={kpi(c.orange)}><div style={{ fontSize: 10, color: c.dim }}>FUERA HORARIO</div><div style={{ fontSize: 20, fontWeight: 700, color: c.orange }}>{fueraHorario}</div></div>
        </div>
      )}

      {/* Botón registrar */}
      <button onClick={() => setShowForm(!showForm)} style={{ ...btn(c.orange), width: '100%', marginBottom: 14 }}>
        {showForm ? '✕ Cancelar' : '+ Registrar Viaje'}
      </button>

      {/* Formulario */}
      {showForm && (
        <div style={card({ borderLeft: `3px solid ${c.orange}`, marginBottom: 14 })}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.orange, marginBottom: 12 }}>NUEVO VIAJE</div>

          <label style={lbl}>Conductor *</label>
          <select value={form.empleado_id} onChange={e => setForm({ ...form, empleado_id: e.target.value })}
            style={{ ...inp, marginBottom: 10 }}>
            <option value="">— Seleccionar conductor —</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.nombre} ({d.cargo})</option>)}
          </select>

          <label style={lbl}>Tipo</label>
          <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}
            style={{ ...inp, marginBottom: 10 }}>
            <option value="entrega">Entrega</option>
            <option value="mandado">Mandado</option>
          </select>

          {form.tipo === 'entrega' && (
            <>
              <label style={lbl}>Distancia (km) *</label>
              <input type="number" step="0.5" min="0" placeholder="0.0"
                value={form.distancia_km}
                onChange={e => setForm({ ...form, distancia_km: e.target.value })}
                style={{ ...inp, marginBottom: 10 }} />
            </>
          )}

          {form.tipo === 'mandado' && (
            <>
              <label style={lbl}>Descripción del mandado</label>
              <input type="text" placeholder="Ej: Comprar papel para caja..."
                value={form.descripcion_mandado}
                onChange={e => setForm({ ...form, descripcion_mandado: e.target.value })}
                style={{ ...inp, marginBottom: 10 }} />
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input type="checkbox" id="fh" checked={form.es_fuera_de_horario}
              onChange={e => setForm({ ...form, es_fuera_de_horario: e.target.checked })}
              style={{ width: 18, height: 18, cursor: 'pointer' }} />
            <label htmlFor="fh" style={{ fontSize: 13, color: '#ddd', cursor: 'pointer' }}>
              ⏰ Fuera de horario (+${(config.tarifa_fuera_horario ?? 3).toFixed(2)})
            </label>
          </div>

          <label style={lbl}>Notas (opcional)</label>
          <textarea placeholder="Observaciones..." value={form.notas}
            onChange={e => setForm({ ...form, notas: e.target.value })}
            style={{ ...inp, minHeight: 48, marginBottom: 12, fontFamily: 'inherit' }} />

          {/* Tarifa preview */}
          {tarifaPreview !== null && (
            <div style={{ background: '#0a1628', padding: 10, borderRadius: 8, marginBottom: 12, border: '1px solid #1e3a5f' }}>
              <div style={{ fontSize: 11, color: c.dim, marginBottom: 4 }}>TARIFA ESTIMADA</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.green }}>${tarifaPreview.toFixed(2)}</div>
              {form.tipo === 'entrega' && (
                <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>
                  {n(form.distancia_km) >= (config.km_umbral_doble ?? 17)
                    ? `Entrega larga ≥${config.km_umbral_doble ?? 17}km: $${(config.tarifa_entrega_larga ?? 1).toFixed(2)}`
                    : `Entrega normal <${config.km_umbral_doble ?? 17}km: $${(config.tarifa_entrega_normal ?? 0.5).toFixed(2)}`}
                  {form.es_fuera_de_horario && ` + fuera horario: $${(config.tarifa_fuera_horario ?? 3).toFixed(2)}`}
                </div>
              )}
            </div>
          )}

          <button onClick={registrar} style={{ ...btn(c.green), width: '100%' }}>💾 Registrar</button>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 32, color: c.dim }}>Cargando...</div>}

      {!loading && viajes.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: c.dim }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🚗</div>
          <div style={{ marginBottom: 4 }}>Sin viajes en esta fecha</div>
          <div style={{ fontSize: 12 }}>{drivers.length === 0 ? 'No hay conductores activos en BD' : `${drivers.length} conductores disponibles`}</div>
        </div>
      )}

      {!loading && viajes.map(v => {
        const tarifa = calcTarifa(v.tipo, n(v.distancia_km), v.es_fuera_de_horario, config);
        return (
          <div key={v.id} style={card()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{v.empleados?.nombre || '—'}</div>
                <div style={{ fontSize: 12, color: c.dim, marginTop: 2 }}>{v.empleados?.cargo}</div>
                <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                  {v.tipo === 'mandado' ? '📦 Mandado' : `🚗 Entrega · ${n(v.distancia_km).toFixed(1)} km`}
                  {v.es_fuera_de_horario && <span style={{ color: c.orange, marginLeft: 8 }}>⏰ Fuera hr.</span>}
                </div>
                {v.descripcion_mandado && <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>{v.descripcion_mandado}</div>}
                {v.notas && <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>📝 {v.notas}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: c.green }}>${tarifa.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>
                  {new Date(v.created_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── TAB 3: BONOS DEL MES ─────────────────────────────────────────────────────
function TabBonos({ user, show, puedeAprobar }) {
  const [mes, setMes]           = useState(mesActual());
  const [drivers, setDrivers]   = useState([]);
  const [viajes, setViajes]     = useState([]);
  const [config, setConfig]     = useState({});
  const [guardados, setGuardados] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [expandido, setExpandido] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    const [emp, vjs, cfg, bon] = await Promise.all([
      db.from('empleados').select('id,nombre,cargo').in('cargo', CARGOS_DRIVER).eq('activo', true),
      db.from('viajes_delivery').select('*').like('fecha', mes + '%'),
      db.from('config_delivery').select('parametro,valor'),
      db.from('bonos_delivery_mensual').select('*, empleados(nombre,cargo)').eq('mes', mes),
    ]);
    setDrivers(emp.data || []);
    setViajes(vjs.data || []);
    setConfig(parseCfg(cfg.data));
    setGuardados(bon.data || []);
    setLoading(false);
  }, [mes]);

  useEffect(() => { cargar(); }, [cargar]);

  // Calcular bonos cliente-side (cálculo correcto aditivo)
  const resumen = useMemo(() => {
    if (!drivers.length || !Object.keys(config).length) return [];
    return drivers
      .map(d => {
        const vjs = viajes.filter(v => v.empleado_id === d.id);
        if (vjs.length === 0 && !guardados.find(g => g.empleado_id === d.id)) return null;
        const calc  = bonoDriver(vjs, config);
        const saved = guardados.find(g => g.empleado_id === d.id);
        return { ...d, viajes: vjs.length, calc, saved };
      })
      .filter(Boolean)
      .sort((a, b) => b.calc.total - a.calc.total);
  }, [drivers, viajes, config, guardados]);

  const totales = useMemo(() => ({
    viajes: resumen.reduce((s, d) => s + d.viajes, 0),
    bono:   resumen.reduce((s, d) => s + d.calc.total, 0),
    drivers: resumen.length,
  }), [resumen]);

  const guardar = async () => {
    if (viajes.length === 0) { show('⚠️ No hay viajes registrados en este mes'); return; }
    setGuardando(true);
    try {
      const { data, error } = await db.rpc('calcular_bonos_delivery_mes', { p_mes: mes });
      if (error) throw error;
      show(`✅ Bonos calculados para ${data} conductor(es)`);
      cargar();
    } catch (e) {
      show('❌ ' + e.message);
    }
    setGuardando(false);
  };

  const aprobar = async (empleadoId) => {
    const { error } = await db.from('bonos_delivery_mensual')
      .update({ estado: 'aprobado' })
      .eq('mes', mes).eq('empleado_id', empleadoId);
    if (error) { show('❌ ' + error.message); return; }
    show('✅ Bono aprobado');
    cargar();
  };

  const cfgKeys = [
    ['km_umbral_doble','Umbral km doble','km'],
    ['tarifa_entrega_normal','Tarifa normal','$'],
    ['tarifa_entrega_larga','Tarifa larga','$'],
    ['tarifa_fuera_horario','Fuera de horario','$'],
    ['tarifa_mandado','Mandado','$'],
  ];

  return (
    <div>
      {/* Selector de mes */}
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Período</label>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)}
          style={inp} />
      </div>

      {/* Tarifas configuradas */}
      <div style={card({ marginBottom: 14 })}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.dim, marginBottom: 8 }}>⚙️ TARIFAS CONFIGURADAS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cfgKeys.map(([k, label, unit]) => (
            <div key={k} style={{ background: '#111', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
              <span style={{ color: c.dim }}>{label}: </span>
              <span style={{ color: c.yellow, fontWeight: 700 }}>
                {unit === '$' ? `$${(config[k] ?? '-')}` : `${config[k] ?? '-'} km`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 32, color: c.dim }}>Cargando...</div>}

      {!loading && resumen.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: c.dim }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💰</div>
          <div style={{ marginBottom: 4 }}>Sin viajes en {fmtMes(mes)}</div>
          <div style={{ fontSize: 12 }}>Registra viajes en la pestaña 🚗 para calcular bonos</div>
        </div>
      )}

      {/* KPIs resumen */}
      {!loading && resumen.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={kpi(c.green)}><div style={{ fontSize: 10, color: c.dim }}>BONO TOTAL</div><div style={{ fontSize: 20, fontWeight: 700, color: c.green }}>${totales.bono.toFixed(2)}</div></div>
            <div style={kpi(c.blue)}><div style={{ fontSize: 10, color: c.dim }}>VIAJES</div><div style={{ fontSize: 20, fontWeight: 700, color: c.blue }}>{totales.viajes}</div></div>
            <div style={kpi(c.purple)}><div style={{ fontSize: 10, color: c.dim }}>DRIVERS</div><div style={{ fontSize: 20, fontWeight: 700, color: c.purple }}>{totales.drivers}</div></div>
          </div>

          {/* Tabla por driver */}
          <div style={{ overflowX: 'auto', marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid #444` }}>
                  <th style={{ padding: '8px 6px', textAlign: 'left', color: c.dim, fontWeight: 600 }}>Conductor</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.blue }}>Nrm</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.yellow }}>Lrg</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.orange }}>F.Hr</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', color: c.dim }}>Mnd</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', color: c.green }}>Bono</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', color: c.dim }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map(d => {
                  const estado = d.saved?.estado;
                  const estadoColor = { aprobado: c.green, calculado: c.yellow }[estado] || c.dim;
                  return (
                    <tr key={d.id} style={{ borderBottom: `1px solid #333`, cursor: 'pointer' }}
                      onClick={() => setExpandido(expandido === d.id ? null : d.id)}>
                      <td style={{ padding: '8px 6px', fontWeight: 600, color: c.text }}>
                        {d.nombre}
                        <div style={{ fontSize: 10, color: c.dim, fontWeight: 400 }}>{d.cargo}</div>
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.blue }}>{d.calc.normal}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.yellow }}>{d.calc.larga}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.orange }}>{d.calc.fuera}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', color: c.dim }}>{d.calc.mandados}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: c.green }}>${d.calc.total.toFixed(2)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'center', fontSize: 11, color: estadoColor }}>
                        {estado ? estado.toUpperCase() : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: `2px solid #555`, background: '#161616' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 700, color: '#fff' }}>TOTAL</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.blue }}>{resumen.reduce((s,d)=>s+d.calc.normal,0)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.yellow }}>{resumen.reduce((s,d)=>s+d.calc.larga,0)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.orange }}>{resumen.reduce((s,d)=>s+d.calc.fuera,0)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', color: c.dim }}>{resumen.reduce((s,d)=>s+d.calc.mandados,0)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: c.green, fontSize: 14 }}>${totales.bono.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Panel expandido por driver */}
          {expandido && (() => {
            const d = resumen.find(x => x.id === expandido);
            if (!d) return null;
            return (
              <div style={card({ borderLeft: `3px solid ${c.green}`, marginBottom: 14 })}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{d.nombre}</div>
                <div style={{ fontSize: 12, color: c.dim, marginBottom: 10 }}>{d.viajes} viajes en {fmtMes(mes)}</div>
                {[
                  ['Entregas normales', d.calc.normal, config.tarifa_entrega_normal, c.blue],
                  ['Entregas largas', d.calc.larga, config.tarifa_entrega_larga, c.yellow],
                  ['Fuera de horario', d.calc.fuera, config.tarifa_fuera_horario, c.orange],
                  ['Mandados', d.calc.mandados, config.tarifa_mandado, c.dim],
                ].map(([lbl2, qty, tarifa, color]) => qty > 0 && (
                  <div key={lbl2} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #333', fontSize: 13 }}>
                    <span style={{ color }}>{lbl2}: <strong>{qty}</strong></span>
                    <span style={{ color: c.green }}>× ${(tarifa ?? 0).toFixed(2)} = ${(qty * (tarifa ?? 0)).toFixed(2)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                  <span style={{ color: c.text }}>BONO TOTAL</span>
                  <span style={{ color: c.green }}>${d.calc.total.toFixed(2)}</span>
                </div>
                {puedeAprobar && d.saved && d.saved.estado !== 'aprobado' && (
                  <button onClick={() => aprobar(d.id)} style={{ ...btn(c.green), width: '100%', marginTop: 8 }}>
                    ✅ Aprobar Bono
                  </button>
                )}
                {d.saved?.estado === 'aprobado' && (
                  <div style={{ textAlign: 'center', padding: 8, color: c.green, fontSize: 13, fontWeight: 600 }}>✅ BONO APROBADO</div>
                )}
              </div>
            );
          })()}

          {/* Botón guardar */}
          {puedeAprobar && (
            <button onClick={guardar} disabled={guardando || viajes.length === 0}
              style={{ ...btn(guardando ? '#333' : c.yellow, guardando ? c.dim : '#000'), width: '100%' }}>
              {guardando ? 'Calculando...' : `💾 Calcular y Guardar Bonos — ${fmtMes(mes)}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
