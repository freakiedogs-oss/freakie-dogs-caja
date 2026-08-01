// ────────────────────────────────────────────────────────────────────
// Torre de Karina · Tablero de pedidos
// En computadora: 4 columnas (por cobrar → en cocina → por asignar → en
// ruta), que es donde se opera todo el día. En teléfono: las mismas 4 como
// pestañas con contador, para que siga siendo usable en pantalla chica.
// Las entregadas salen del tablero y quedan en el historial.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '../../supabase';
import { URL_DELIVERY } from '../../config';

const TOKEN_KEY = 'freakie_torre_token';
const c = {
  card: '#1a1a1a', panel: '#151515', border: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', text: '#f0f0f0', dim: '#8a8a8a',
};
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;

// Las 4 etapas que Karina opera
const COLS = [
  { k: 'recibida',   t: 'Por cobrar',  ic: '💰', col: c.yellow, ayuda: 'Cobrá por WhatsApp y confirmá' },
  { k: 'preparando', t: 'En cocina',   ic: '👨‍🍳', col: c.blue,   ayuda: 'Pagados, cocinándose' },
  { k: 'lista',      t: 'Por asignar', ic: '🛵', col: c.green,  ayuda: 'Listos, esperando motorista' },
  { k: 'en_camino',  t: 'En ruta',     ic: '🚗', col: c.orange, ayuda: 'Ya salieron' },
];

// Cuánto lleva esperando el pedido, con semáforo
function useReloj(desde) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t); }, []);
  const min = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 60000));
  return {
    color: min >= 25 ? c.red : min >= 12 ? c.yellow : c.dim,
    txt: min < 1 ? 'recién' : min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`,
  };
}

function useEsCompu() {
  const [ancho, setAncho] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const f = () => setAncho(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return ancho >= 900;
}

export default function TabPedidos({ show = () => {} }) {
  const esCompu = useEsCompu();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [sesion, setSesion] = useState(null);
  const [pin, setPin] = useState('');
  const [pedidos, setPedidos] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [verHistorial, setVerHistorial] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [todosDrivers, setTodosDrivers] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [asignSel, setAsignSel] = useState({});
  const [sucSel, setSucSel] = useState({});
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState(null);
  const [err, setErr] = useState('');
  const [ocupado, setOcupado] = useState(null);
  const [colMovil, setColMovil] = useState('recibida');
  const [mOpen, setMOpen] = useState(false);
  const [mForm, setMForm] = useState({ driver: '', sucursal: '', desc: '', dist: '', fuera: false });
  // "En cocina" es solo consulta: arranca plegada para dar aire a las columnas
  // donde sí hay que actuar. La preferencia se recuerda.
  const [cocinaAbierta, setCocinaAbierta] = useState(() => localStorage.getItem('torre_cocina_abierta') === '1');
  const pollRef = useRef(null);

  const toggleCocina = () => setCocinaAbierta(v => {
    localStorage.setItem('torre_cocina_abierta', v ? '0' : '1');
    return !v;
  });

  const cargar = useCallback(async (tk) => {
    const t = tk || token;
    if (!t) return;
    setCargando(true);
    try {
      const [{ data, error }, dr] = await Promise.all([
        db.rpc('torre_listar_pedidos', { p_token: t }),
        db.rpc('drivers_en_linea'),
      ]);
      if (error) throw error;
      setPedidos(data || []);
      setDrivers(dr?.data || []);
      setUltima(new Date());
      setErr('');
    } catch (e) {
      if (String(e.message || '').includes('Sesión')) { localStorage.removeItem(TOKEN_KEY); setToken(''); setSesion(null); }
      setErr(e.message || 'No se pudo cargar');
    } finally { setCargando(false); }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    cargar(token);
    pollRef.current = setInterval(() => cargar(token), 20000);
    return () => clearInterval(pollRef.current);
  }, [token, cargar]);

  useEffect(() => {
    if (!token) return;
    db.rpc('drivers_disponibles').then(({ data }) => setTodosDrivers(data || []));
    db.from('sucursales').select('id,store_code,nombre').eq('tiene_delivery', true).eq('activa', true)
      .then(({ data }) => setSucursales(data || []));
  }, [token]);

  const abrirHistorial = async () => {
    const { data } = await db.rpc('torre_pendientes_liquidar', { p_token: token });
    setHistorial(data || []);
    setVerHistorial(true);
  };

  const entrar = async () => {
    setErr('');
    try {
      const { data, error } = await db.rpc('staff_login', { p_pin: pin });
      if (error) throw error;
      localStorage.setItem(TOKEN_KEY, data.token);
      setSesion({ nombre: data.nombre, rol: data.rol });
      setToken(data.token); setPin('');
    } catch (e) { setErr(e.message || 'PIN incorrecto'); }
  };
  const salir = () => { localStorage.removeItem(TOKEN_KEY); setToken(''); setSesion(null); setPedidos([]); };

  const sucursalDe = (p) => p.sucursal_id
    || (p.ruteo_sugerido?.en_cobertura ? p.ruteo_sugerido.sucursal_id : null) || sucSel[p.id] || null;

  const confirmar = async (p) => {
    const suc = sucursalDe(p);
    if (!suc) { show('⚠️ Elegí de qué sucursal sale el pedido'); return; }
    setOcupado(p.id);
    try {
      const { error } = await db.rpc('torre_confirmar_pago', {
        p_token: token, p_delivery_id: p.id, p_sucursal_id: suc, p_metodo: p.metodo_pago || 'efectivo',
      });
      if (error) throw error;
      show('✅ Pago confirmado — va a cocina');
      await cargar(token);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  const asignar = async (p) => {
    const mid = asignSel[p.id] || p.motorista_sugerido?.motorista_id;
    if (!mid) { show('⚠️ Elegí un motorista'); return; }
    setOcupado(p.id);
    try {
      const { error } = await db.rpc('torre_asignar_motorista', { p_token: token, p_delivery_id: p.id, p_motorista_id: mid });
      if (error) throw error;
      show('🛵 Motorista asignado'); await cargar(token);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  const asignarMandado = async () => {
    if (!mForm.driver || !mForm.sucursal || !mForm.desc.trim()) { show('⚠️ Completá motorista, sucursal y descripción'); return; }
    try {
      const { data, error } = await db.rpc('torre_asignar_mandado', {
        p_token: token, p_empleado_id: mForm.driver, p_sucursal_id: mForm.sucursal,
        p_descripcion: mForm.desc.trim(), p_distancia_km: Number(mForm.dist) || 0, p_fuera_horario: mForm.fuera,
      });
      if (error) throw error;
      show(`📦 Mandado asignado a ${data.motorista} · ${fmt(data.tarifa)}`);
      setMForm({ driver: '', sucursal: '', desc: '', dist: '', fuera: false }); setMOpen(false);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
  };

  // Apunta al dominio público del delivery, NO al del ERP donde corre la torre:
  // este link se lo mandamos al cliente por WhatsApp.
  const trackUrl = (p) => `${URL_DELIVERY}/track?t=${p.tracking_token}`;
  const waLink = (tel, p) => {
    const num = String(tel || '').replace(/\D/g, '');
    const base = `Hola! Soy de Freakie Dogs 🌭 Sobre tu pedido ${p.numero_orden} por ${fmt(p.total)}.`;
    const msg = p.estado === 'recibida'
      ? `${base} ¿Cómo querés pagar (efectivo/transferencia)?`
      : `${base} Seguí tu pedido en vivo acá: ${trackUrl(p)}`;
    return `https://wa.me/503${num}?text=${encodeURIComponent(msg)}`;
  };

  // ── Ingreso por PIN ──
  if (!token) {
    return (
      <div style={{ maxWidth: 320, margin: '30px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 42, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Torre de pedidos</div>
        <div style={{ fontSize: 13, color: c.dim, marginBottom: 18 }}>Ingresá tu PIN para operar.</div>
        <input type="password" inputMode="numeric" value={pin} autoFocus placeholder="PIN"
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && entrar()}
          style={{ background: c.input, border: '1px solid #333', borderRadius: 10, padding: '12px 14px',
                   color: c.text, fontSize: 18, textAlign: 'center', width: '100%', letterSpacing: 4 }} />
        <button onClick={entrar} disabled={pin.length < 3}
          style={{ marginTop: 12, width: '100%', padding: 13, borderRadius: 10, border: 'none',
                   background: c.red, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Entrar</button>
        {err && <div style={{ color: c.red, fontSize: 13, marginTop: 10 }}>{err}</div>}
      </div>
    );
  }

  const porEstado = (k) => pedidos.filter(p => p.estado === k);
  const totalCol = (k) => porEstado(k).reduce((s, p) => s + Number(p.total || 0), 0);
  const accesorios = { ocupado, confirmar, asignar, sucursalDe, sucSel, setSucSel,
                       asignSel, setAsignSel, drivers, sucursales, waLink, trackUrl, show };

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 170 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Pedidos a domicilio</div>
          <div style={{ fontSize: 11.5, color: c.dim, marginTop: 2 }}>
            {sesion?.nombre ? `${sesion.nombre} · ` : ''}{pedidos.length} activos · 🛵 {drivers.length} en línea
            {ultima && ` · ${ultima.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
        <button onClick={() => setMOpen(o => !o)} style={btn('#f97316')}>📦 Mandado</button>
        <button onClick={() => verHistorial ? setVerHistorial(false) : abrirHistorial()} style={btn('#333')}>
          {verHistorial ? '← Tablero' : '🧾 Historial'}
        </button>
        <button onClick={() => cargar(token)} style={btn('#333')} title="Actualizar">{cargando ? '…' : '↻'}</button>
        <button onClick={salir} style={btn('#333')}>Salir</button>
      </div>

      {err && <div style={{ color: c.red, fontSize: 13, marginBottom: 10 }}>{err}</div>}

      {/* Mandado suelto */}
      {mOpen && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14,
                      marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: c.dim }}>Encargo suelto para un motorista (suma a su bono).</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={mForm.driver} onChange={e => setMForm(f => ({ ...f, driver: e.target.value }))} style={sel}>
              <option value="">— motorista —</option>
              {todosDrivers.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            <select value={mForm.sucursal} onChange={e => setMForm(f => ({ ...f, sucursal: e.target.value }))} style={sel}>
              <option value="">— sucursal —</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.store_code} · {s.nombre}</option>)}
            </select>
          </div>
          <input value={mForm.desc} onChange={e => setMForm(f => ({ ...f, desc: e.target.value }))}
                 placeholder="¿Qué tiene que hacer?" style={{ ...sel, width: '100%' }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={mForm.dist} onChange={e => setMForm(f => ({ ...f, dist: e.target.value.replace(/[^\d.]/g, '') }))}
                   placeholder="km" style={{ ...sel, width: 90, flex: 'none' }} inputMode="decimal" />
            <label style={{ fontSize: 12, color: c.dim, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={mForm.fuera} onChange={e => setMForm(f => ({ ...f, fuera: e.target.checked }))} />
              De noche
            </label>
            <button onClick={asignarMandado} style={{ ...btn('#f97316'), marginLeft: 'auto' }}>Asignar</button>
          </div>
        </div>
      )}

      {verHistorial ? (
        <Historial historial={historial} />
      ) : esCompu ? (
        /* ── Computadora: 4 columnas ── */
        <div style={{ display: 'grid', alignItems: 'start', gap: 12,
                      gridTemplateColumns: cocinaAbierta ? 'repeat(4, minmax(0,1fr))' : '1fr 52px 1fr 1fr' }}>
          {COLS.map(col => {
            const lista = porEstado(col.k);
            const esCocina = col.k === 'preparando';
            const plegada = esCocina && !cocinaAbierta;

            // Columna de cocina plegada: barra angosta que solo muestra cuántos hay
            if (plegada) {
              return (
                <button key={col.k} onClick={toggleCocina} title={`${col.t} — ${lista.length} pedido(s). Clic para abrir`}
                  style={{ background: c.panel, border: `1px solid ${c.border}`, borderTop: `2px solid ${col.col}`,
                           borderRadius: 12, padding: '12px 4px', cursor: 'pointer', minHeight: 190,
                           display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{col.ic}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: lista.length ? col.col : '#555' }}>{lista.length}</span>
                  <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 11,
                                 fontWeight: 700, color: c.dim, letterSpacing: '.04em' }}>{col.t}</span>
                  <span style={{ marginTop: 'auto', fontSize: 13, color: c.dim }}>›</span>
                </button>
              );
            }

            return (
              <div key={col.k} style={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', borderBottom: `2px solid ${col.col}`, background: '#181818' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>{col.ic}</span>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{col.t}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: col.col }}>{lista.length}</span>
                    {esCocina && (
                      <button onClick={toggleCocina} title="Plegar esta columna"
                        style={{ background: 'none', border: 'none', color: c.dim, cursor: 'pointer',
                                 fontSize: 14, padding: '0 2px', lineHeight: 1 }}>‹</button>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: c.dim, marginTop: 3 }}>
                    {lista.length > 0 ? fmt(totalCol(col.k)) : col.ayuda}
                  </div>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8,
                              maxHeight: '68vh', overflowY: 'auto' }}>
                  {lista.length === 0
                    ? <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: '18px 6px' }}>—</div>
                    : lista.map(p => <Tarjeta key={p.id} p={p} col={col} compacta {...accesorios} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Teléfono: pestañas ── */
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
            {COLS.map(col => {
              const n = porEstado(col.k).length;
              return (
                <button key={col.k} onClick={() => setColMovil(col.k)}
                  style={{ padding: '8px 11px', borderRadius: 9, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                           fontSize: 12, fontWeight: 700,
                           background: colMovil === col.k ? col.col : '#222',
                           color: colMovil === col.k ? '#111' : c.dim }}>
                  {col.ic} {col.t}{n > 0 ? ` (${n})` : ''}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {porEstado(colMovil).length === 0
              ? <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>
                  Nada en “{COLS.find(x => x.k === colMovil)?.t}”.
                </div>
              : porEstado(colMovil).map(p => (
                  <Tarjeta key={p.id} p={p} col={COLS.find(x => x.k === colMovil)} {...accesorios} />
                ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Historial: entregados que faltan cobrar en caja ──
function Historial({ historial }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: c.dim, marginBottom: 10 }}>
        Entregados en los últimos 2 días que todavía no se cobraron en caja.
      </div>
      {historial.length === 0
        ? <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>Nada pendiente de liquidar 👍</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {historial.map((h, i) => (
              <div key={i} style={{ ...tarjeta, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{h.numero_orden}</div>
                  <div style={{ fontSize: 12, color: c.dim, marginTop: 2 }}>
                    🛵 {h.motorista || '—'} · 🏪 {h.sucursal || '—'} · {h.metodo_pago}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: c.green }}>{fmt(h.total)}</div>
                  <div style={{ fontSize: 11, color: c.yellow }}>{h.cuenta_estado || 'sin cobrar'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Tarjeta de pedido ──
function Tarjeta({ p, col, compacta, ocupado, confirmar, asignar, sucursalDe, sucSel, setSucSel,
                   asignSel, setAsignSel, drivers, sucursales, waLink, trackUrl, show }) {
  const reloj = useReloj(p.created_at);
  const faltaSucursal = !sucursalDe(p);
  const nItems = Array.isArray(p.items) ? p.items.reduce((s, i) => s + (i.cantidad || 1), 0) : 0;
  const suc = p.sucursal_nombre || (p.ruteo_sugerido?.en_cobertura ? p.ruteo_sugerido.nombre : null);

  return (
    <div style={{ ...tarjeta, borderLeft: `3px solid ${col.col}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontWeight: 800, fontSize: compacta ? 12.5 : 14 }}>{p.numero_orden}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: reloj.color }}>{reloj.txt}</span>
      </div>
      <div style={{ fontSize: compacta ? 13 : 14.5, marginTop: 4 }}>{p.cliente_nombre || 'Cliente'}</div>
      <div style={{ fontSize: 11.5, color: c.dim, marginTop: 2, lineHeight: 1.4 }}>{p.cliente_direccion}</div>
      <div style={{ fontSize: 11.5, color: c.dim, marginTop: 4 }}>
        <b style={{ color: c.text }}>{fmt(p.total)}</b> · {p.metodo_pago} · {nItems} ít.{suc ? ` · 🏪 ${suc}` : ''}
      </div>
      {p.motorista_nombre && <div style={{ fontSize: 11.5, color: c.green, marginTop: 3 }}>🛵 {p.motorista_nombre}</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
        <a href={waLink(p.cliente_telefono, p)} target="_blank" rel="noopener" title="Escribirle al cliente"
           style={{ ...btn('#25D366'), textDecoration: 'none', fontSize: 11.5, padding: '6px 10px' }}>💬</a>
        {p.estado !== 'recibida' && (
          <button title="Copiar link de seguimiento"
            onClick={() => { navigator.clipboard?.writeText(trackUrl(p)); show('🔗 Link de seguimiento copiado'); }}
            style={{ ...btn('#333'), fontSize: 11.5, padding: '6px 10px' }}>🔗</button>
        )}
        {p.estado === 'recibida' && !faltaSucursal && (
          <button disabled={ocupado === p.id} onClick={() => confirmar(p)}
            style={{ ...btn(c.red), fontSize: 11.5, padding: '6px 10px', flex: 1 }}>
            {ocupado === p.id ? '…' : '✅ Cobrado'}
          </button>
        )}
      </div>

      {/* Sin ubicación: elegir sucursal */}
      {p.estado === 'recibida' && faltaSucursal && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
          <div style={{ fontSize: 11, color: c.yellow, marginBottom: 5 }}>📍 Sin ubicación — ¿de qué sucursal sale?</div>
          <select value={sucSel[p.id] || ''} onChange={e => setSucSel(s => ({ ...s, [p.id]: e.target.value }))}
                  style={{ ...sel, width: '100%', marginBottom: 6 }}>
            <option value="">— sucursal —</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.store_code} · {s.nombre}</option>)}
          </select>
          <button disabled={ocupado === p.id || !sucSel[p.id]} onClick={() => confirmar(p)}
                  style={{ ...btn(c.red), width: '100%', fontSize: 12 }}>
            {ocupado === p.id ? '…' : '✅ Confirmar pago'}
          </button>
        </div>
      )}

      {/* Listo: asignar motorista */}
      {p.estado === 'lista' && !p.motorista_id && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
          {p.motorista_sugerido && (
            <div style={{ fontSize: 11, color: c.dim, marginBottom: 5 }}>
              Cerca: <b style={{ color: c.text }}>{p.motorista_sugerido.nombre}</b> ({p.motorista_sugerido.distancia_km} km)
            </div>
          )}
          <select value={asignSel[p.id] || p.motorista_sugerido?.motorista_id || ''}
                  onChange={e => setAsignSel(s => ({ ...s, [p.id]: e.target.value }))}
                  style={{ ...sel, width: '100%', marginBottom: 6 }}>
            <option value="">— motorista en línea —</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
          <button disabled={ocupado === p.id} onClick={() => asignar(p)}
                  style={{ ...btn(c.blue), width: '100%', fontSize: 12 }}>
            {ocupado === p.id ? '…' : '🛵 Asignar'}
          </button>
        </div>
      )}
    </div>
  );
}

const tarjeta = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: 11 };
const btn = (bg, fg = '#fff') => ({
  padding: '7px 12px', borderRadius: 8, background: bg, color: fg, border: 'none',
  cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
});
const sel = {
  background: '#1e1e1e', border: '1px solid #333', borderRadius: 8,
  padding: '7px 9px', color: '#f0f0f0', fontSize: 12, flex: 1, minWidth: 120,
};
