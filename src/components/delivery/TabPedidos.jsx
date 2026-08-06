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
  const [reasignando, setReasignando] = useState(null);
  const [cancelando, setCancelando] = useState(null);   // pedido cuyo motorista se está cambiando
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

  // Lo que elige la central MANDA sobre lo que sugirió el sistema. Antes iba
  // último y por eso cambiar la sucursal a mano no tenía ningún efecto.
  const sucursalDe = (p) => sucSel[p.id]
    || p.sucursal_id
    || (p.ruteo_sugerido?.en_cobertura ? p.ruteo_sugerido.sucursal_id : null)
    || null;

  // La que propuso el sistema, para mostrarla marcada y poder avisar si se cambió
  const sucursalSugerida = (p) => p.sucursal_id
    || (p.ruteo_sugerido?.en_cobertura ? p.ruteo_sugerido.sucursal_id : null) || null;

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

  // Mientras la app de los motoristas no esté al día, la central mueve el
  // pedido a mano para que el cliente vea en su seguimiento que ya salió.
  const MOTIVOS_CANCELA = [
    'Pedido duplicado',
    'El cliente no pagó',
    'El cliente se arrepintió',
    'No llegamos a esa dirección',
    'Producto agotado',
    'Otro',
  ];

  // Sacar del tablero lo que no va a suceder. Queda documentado con motivo
  // y autor: si ya había entrado a cocina, es comida perdida y hay que saberlo.
  const cancelar = async (p, motivo) => {
    setOcupado(p.id);
    try {
      const { data, error } = await db.rpc('torre_cancelar_pedido', {
        p_token: token, p_delivery_id: p.id, p_motivo: motivo, p_detalle: null });
      if (error) throw error;
      show(data?.habia_entrado_a_cocina
        ? `🚫 ${p.numero_orden} cancelado — ya estaba en cocina, avisá a la sucursal`
        : `🚫 ${p.numero_orden} cancelado`);
      setCancelando(null);
      await cargar();
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  const marcarEnCamino = async (p) => {
    setOcupado(p.id);
    try {
      const { error } = await db.rpc('torre_marcar_en_camino', { p_token: token, p_delivery_id: p.id });
      if (error) throw error;
      show(`🛵 ${p.numero_orden} va en camino`);
      await cargar();
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  const marcarEntregado = async (p) => {
    setOcupado(p.id);
    try {
      const { error } = await db.rpc('torre_marcar_entregado', {
        p_token: token, p_delivery_id: p.id, p_metodo_cobrado: null });
      if (error) throw error;
      show(`✅ ${p.numero_orden} entregado`);
      await cargar();
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  const asignar = async (p, forzado) => {
    const mid = forzado || asignSel[p.id] || p.motorista_sugerido?.motorista_id;
    if (!mid) { show('⚠️ Elegí un motorista'); return; }
    setOcupado(p.id);
    try {
      const { data, error } = await db.rpc('torre_asignar_motorista', {
        p_token: token, p_delivery_id: p.id, p_motorista_id: mid });
      if (error) throw error;
      // El servidor dice si fue un cambio, para que quede claro qué pasó
      show(data?.reasignado
        ? `🔄 ${p.numero_orden}: pasó de ${data.anterior} a ${data.motorista}`
        : `🛵 ${data?.motorista || 'Motorista'} asignado`);
      setAsignSel(s => ({ ...s, [p.id]: '' }));
      await cargar(token);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  // Para llevar: el cliente retira en el local. Sin motorista ni envío; se cierra
  // solo cuando la caja cobra la cuenta (pasa a históricos).
  const marcarParaLlevar = async (p) => {
    setOcupado(p.id);
    try {
      const { data, error } = await db.rpc('torre_marcar_para_llevar', { p_token: token, p_delivery_id: p.id });
      if (error) throw error;
      show(`🥡 ${data?.numero_orden || p.numero_orden}: para retirar en local`);
      await cargar(token);
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
  const accesorios = { ocupado, confirmar, asignar, sucursalDe, sucursalSugerida, sucSel, setSucSel,
                       reasignando, setReasignando, cancelando, setCancelando, cancelar, MOTIVOS_CANCELA,
                       asignSel, setAsignSel, drivers, sucursales, waLink, trackUrl, show,
                   marcarEnCamino, marcarEntregado, marcarParaLlevar };

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 170 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Pedidos a domicilio</div>
          <div style={{ fontSize: 11.5, color: c.dim, marginTop: 2 }}>
            {sesion?.nombre ? `${sesion.nombre} · ` : ''}{pedidos.length} activos · 🛵 {drivers.length} en línea
            {drivers.length > 0 && (() => {
              const libres = drivers.filter(d => !d.pedidos).length;
              return libres === drivers.length ? ' (todos libres)'
                   : libres === 0 ? ' (todos con pedido)'
                   : ` (${libres} libre${libres === 1 ? '' : 's'})`;
            })()}
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
function Tarjeta({ p, col, compacta, ocupado, confirmar, asignar, sucursalDe, sucursalSugerida, sucSel, setSucSel,
                   reasignando, setReasignando, cancelando, setCancelando, cancelar, MOTIVOS_CANCELA,
                   asignSel, setAsignSel, drivers, sucursales, waLink, trackUrl, show,
                   marcarEnCamino, marcarEntregado, marcarParaLlevar }) {
  const paraLlevar = p.tipo === 'para_llevar';
  const reloj = useReloj(p.created_at);
  const sugerida = sucursalSugerida(p);
  const cambiada = !!sucSel[p.id] && sucSel[p.id] !== sugerida;
  const nItems = Array.isArray(p.items) ? p.items.reduce((s, i) => s + (i.cantidad || 1), 0) : 0;
  const suc = p.sucursal_nombre || (p.ruteo_sugerido?.en_cobertura ? p.ruteo_sugerido.nombre : null);

  return (
    <div style={{ ...tarjeta, borderLeft: `3px solid ${col.col}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontWeight: 800, fontSize: compacta ? 12.5 : 14 }}>{p.numero_orden}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: reloj.color }}>{reloj.txt}</span>
      </div>
      {paraLlevar && (
        <div style={{ display: 'inline-block', marginTop: 5, fontSize: 11, fontWeight: 800,
                      color: '#111', background: c.yellow, borderRadius: 6, padding: '2px 8px' }}>
          🥡 Para retirar en local
        </div>
      )}
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
      </div>

      {/* Volvió de la calle: la central tiene que notarlo. Puede que el
          problema sea la dirección y no el motorista. */}
      {p.devolucion && (
        <div style={{
          background: '#2a1a12', border: `1px solid ${c.orange}`, borderRadius: 9,
          padding: '8px 10px', marginTop: 8, fontSize: 11.5, lineHeight: 1.45, color: '#fbbf24',
        }}>
          <b>↩️ Devuelto{p.devolucion.veces > 1 ? ` ${p.devolucion.veces} veces` : ''}</b>
          {' — '}{p.devolucion.motivo}
          <div style={{ color: '#a08a6a', marginTop: 2 }}>
            {p.devolucion.motorista} · {new Date(p.devolucion.momento)
              .toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}

      {/* Antes de cobrar: de qué sucursal sale. Siempre editable — el sistema
          propone por la ubicación del cliente, pero la central decide. */}
      {p.estado === 'recibida' && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
          <div style={{ fontSize: 11, color: sugerida ? c.dim : c.yellow, marginBottom: 5 }}>
            {sugerida
              ? (cambiada ? '🏪 Sucursal cambiada a mano' : '🏪 Sale de — el sistema la escogió por la dirección')
              : '📍 Sin ubicación — ¿de qué sucursal sale?'}
          </div>
          <select value={sucursalDe(p) || ''}
                  onChange={e => setSucSel(s => ({ ...s, [p.id]: e.target.value }))}
                  style={{ ...sel, width: '100%', marginBottom: 6,
                           borderColor: cambiada ? c.yellow : '#333' }}>
            <option value="">— elegí la sucursal —</option>
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>
                {s.store_code} · {s.nombre}{s.id === sugerida ? '  (sugerida)' : ''}
              </option>
            ))}
          </select>
          <button disabled={ocupado === p.id || !sucursalDe(p)} onClick={() => confirmar(p)}
                  style={{ ...btn(c.red), width: '100%', fontSize: 12 }}>
            {ocupado === p.id ? '…' : '✅ Confirmar pago'}
          </button>
        </div>
      )}

      {/* Listo: asignar motorista (no aplica a los "para llevar") */}
      {['preparando','lista'].includes(p.estado) && !p.motorista_id && !paraLlevar && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
          {p.sugeridos?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: c.dim, marginBottom: 4 }}>💡 Sugeridos (tocá para asignar):</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {p.sugeridos.map((s, i) => (
                  <button key={s.motorista_id} disabled={ocupado === p.id} title={s.razon}
                    onClick={() => asignar(p, s.motorista_id)}
                    style={{ ...btn(i === 0 ? c.green : 'none', i === 0 ? '#04210f' : c.text),
                             fontSize: 11.5, padding: '5px 9px',
                             border: i === 0 ? 'none' : `1px solid ${c.border}` }}>
                    {i === 0 ? '⭐ ' : ''}{(s.nombre || '').split(' ')[0]}{s.razon ? ` · ${s.razon}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          <select value={asignSel[p.id] || p.motorista_sugerido?.motorista_id || ''}
                  onChange={e => setAsignSel(s => ({ ...s, [p.id]: e.target.value }))}
                  style={{ ...sel, width: '100%', marginBottom: 6 }}>
            <option value="">— motorista en línea —</option>
            {drivers.map(d => (
              <option key={d.id} value={d.id}>
                {d.nombre}
                {d.sucursal ? ` · ${d.sucursal}` : ''}
                {d.pedidos > 0
                  ? ` · lleva ${d.pedidos}${d.en_ruta > 0 ? ` (${d.en_ruta} en ruta)` : ''}`
                  : ' · libre'}
                {d.almorzando ? ` · 🍽️ almorzando${d.almuerzo_min ? ` ${d.almuerzo_min}m` : ''}` : ''}
              </option>
            ))}
          </select>
          <button disabled={ocupado === p.id} onClick={() => asignar(p)}
                  style={{ ...btn(c.blue), width: '100%', fontSize: 12 }}>
            {ocupado === p.id ? '…' : '🛵 Asignar'}
          </button>
          <button disabled={ocupado === p.id} onClick={() => marcarEnCamino(p)}
                  title="Avisale al cliente que ya salió, sin esperar a que el motorista lo marque"
                  style={{ ...btn('none', c.orange), width: '100%', fontSize: 11.5,
                           marginTop: 6, border: `1px solid ${c.orange}` }}>
            Ya salió, sin asignar
          </button>
          <button disabled={ocupado === p.id} onClick={() => marcarParaLlevar(p)}
                  title="El cliente retira en el local: sin motorista ni envío. Se cierra al cobrarse en caja."
                  style={{ ...btn('none', c.yellow), width: '100%', fontSize: 11.5,
                           marginTop: 6, border: `1px solid ${c.yellow}` }}>
            🥡 Para llevar (retira en local)
          </button>
        </div>
      )}

      {/* Ya asignado pero todavía en el local: se puede cambiar de motorista
          hasta que salga. Después no, porque el pedido ya va en su moto. */}
      {['preparando','lista'].includes(p.estado) && p.motorista_id && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
            <span style={{ fontSize: 12, color: c.text, flex: 1, minWidth: 0,
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🛵 {p.repartidor_nombre}
              {(() => {
                const d = drivers.find(x => x.id === p.motorista_id);
                return d && d.pedidos > 1
                  ? <b style={{ color: c.yellow }}> · lleva {d.pedidos}</b> : null;
              })()}
            </span>
            <button onClick={() => setReasignando(r => r === p.id ? null : p.id)}
                    style={{ ...btn('none', c.dim), border: `1px solid ${c.border}`,
                             fontSize: 11, padding: '4px 9px' }}>
              {reasignando === p.id ? 'Dejar así' : 'Cambiar'}
            </button>
          </div>

          {reasignando === p.id && (
            <>
              <select value={asignSel[p.id] || ''}
                      onChange={e => setAsignSel(s => ({ ...s, [p.id]: e.target.value }))}
                      style={{ ...sel, width: '100%', marginBottom: 6 }}>
                <option value="">— pasárselo a —</option>
                {drivers.filter(d => d.id !== p.motorista_id).map(d => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}{d.sucursal ? ` · ${d.sucursal}` : ''}
                    {d.pedidos > 0 ? ` · lleva ${d.pedidos}` : ' · libre'}
                    {d.almorzando ? ' · 🍽️ almorzando' : ''}
                  </option>
                ))}
              </select>
              <button disabled={ocupado === p.id || !asignSel[p.id]}
                      onClick={() => asignar(p).then(() => setReasignando(null))}
                      style={{ ...btn(c.blue), width: '100%', fontSize: 12, marginBottom: 6 }}>
                {ocupado === p.id ? '…' : '🔄 Reasignar'}
              </button>
            </>
          )}

          {p.estado === 'lista' ? (
            <button disabled={ocupado === p.id} onClick={() => marcarEnCamino(p)}
                    style={{ ...btn(c.orange), width: '100%', fontSize: 12 }}>
              {ocupado === p.id ? '…' : '🛵 Ya salió'}
            </button>
          ) : (
            <div style={{ fontSize: 11.5, color: c.dim, textAlign: 'center' }}>
              Reservado — sale cuando cocina lo marque listo
            </div>
          )}
        </div>
      )}

      {/* Cancelar: para duplicados, clientes que no pagan, arrepentidos.
          Solo mientras no se haya entregado. */}
      {p.estado !== 'entregada' && (
        cancelando === p.id ? (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 11.5, color: c.red, fontWeight: 700, marginBottom: 3 }}>
              ¿Por qué se cancela?
            </div>
            {p.pos_cuenta_id && (
              <div style={{ fontSize: 11, color: c.yellow, marginBottom: 6, lineHeight: 1.4 }}>
                ⚠️ Ya está en cocina. Avisale a la sucursal para que no lo preparen.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {MOTIVOS_CANCELA.map(m => (
                <button key={m} disabled={ocupado === p.id} onClick={() => cancelar(p, m)}
                        style={{ ...btn('none', c.text), border: `1px solid ${c.border}`,
                                 fontSize: 11.5, textAlign: 'left', padding: '8px 10px' }}>
                  {ocupado === p.id ? '…' : m}
                </button>
              ))}
            </div>
            <button onClick={() => setCancelando(null)}
                    style={{ ...btn('none', c.dim), fontSize: 11, marginTop: 6, width: '100%' }}>
              Dejar así
            </button>
          </div>
        ) : (
          <button onClick={() => setCancelando(p.id)}
                  title="Sacar este pedido del tablero"
                  style={{ ...btn('none', c.dim), border: `1px solid ${c.border}`,
                           fontSize: 11, marginTop: 8, width: '100%' }}>
            🚫 Cancelar pedido
          </button>
        )
      )}

      {/* En ruta: cerrarlo desde la central. El "para llevar" no lo cierra la
          central — se va solo cuando la caja cobra la cuenta. */}
      {p.estado === 'en_camino' && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
          {paraLlevar ? (
            <div style={{ fontSize: 11.5, color: c.dim, textAlign: 'center', lineHeight: 1.4 }}>
              🧾 Se cierra al cobrarse en caja
            </div>
          ) : (
            <button disabled={ocupado === p.id} onClick={() => marcarEntregado(p)}
                    style={{ ...btn(c.green, '#04210f'), width: '100%', fontSize: 12 }}>
              {ocupado === p.id ? '…' : '✅ Entregado'}
            </button>
          )}
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
