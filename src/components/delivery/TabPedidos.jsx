// ────────────────────────────────────────────────────────────────────
// Torre de Karina · Pedidos web (delivery propio)
// Login por PIN → sesión de staff (token). Lista los pedidos, permite
// contactar al cliente por WhatsApp y confirmar el pago (→ comanda a
// cocina). Lee/escribe por RPCs gated por token (delivery_clientes ya no
// es legible por anon: la fuga de PII quedó cerrada).
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';
const c = {
  bg: '#111', card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', text: '#f0f0f0', dim: '#888',
};
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const COLOR_ESTADO = { recibida: c.yellow, preparando: c.blue, lista: c.green, en_camino: c.orange, entregada: c.dim };

export default function TabPedidos({ show = () => {} }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [sesion, setSesion] = useState(null);
  const [pin, setPin] = useState('');
  const [pedidos, setPedidos] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [asignSel, setAsignSel] = useState({}); // orderId → motorista_id
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState('');
  const [confirmando, setConfirmando] = useState(null);
  const [asignando, setAsignando] = useState(null);
  const pollRef = useRef(null);

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
      setErr('');
    } catch (e) {
      // token expirado / inválido → volver a pedir PIN
      if (String(e.message || '').includes('Sesión')) {
        localStorage.removeItem(TOKEN_KEY); setToken(''); setSesion(null);
      }
      setErr(e.message || 'No se pudo cargar');
    } finally { setCargando(false); }
  }, [token]);

  // Poll cada 20s mientras haya sesión
  useEffect(() => {
    if (!token) return;
    cargar(token);
    pollRef.current = setInterval(() => cargar(token), 20000);
    return () => clearInterval(pollRef.current);
  }, [token, cargar]);

  const entrar = async () => {
    setErr('');
    try {
      const { data, error } = await db.rpc('staff_login', { p_pin: pin });
      if (error) throw error;
      localStorage.setItem(TOKEN_KEY, data.token);
      setSesion({ nombre: data.nombre, rol: data.rol });
      setToken(data.token);
      setPin('');
    } catch (e) { setErr(e.message || 'PIN incorrecto'); }
  };

  const salir = () => { localStorage.removeItem(TOKEN_KEY); setToken(''); setSesion(null); setPedidos([]); };

  const sucursalParaConfirmar = (p) =>
    p.sucursal_id || (p.ruteo_sugerido?.en_cobertura ? p.ruteo_sugerido.sucursal_id : null);

  const confirmar = async (p, metodo) => {
    const suc = sucursalParaConfirmar(p);
    if (!suc) { show('⚠️ Sin sucursal (fuera de cobertura). Asigná una manualmente.'); return; }
    setConfirmando(p.id);
    try {
      const { data, error } = await db.rpc('torre_confirmar_pago', {
        p_token: token, p_delivery_id: p.id, p_sucursal_id: suc, p_metodo: metodo,
      });
      if (error) throw error;
      show('✅ Pago confirmado — pedido enviado a cocina');
      await cargar(token);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo confirmar')); }
    finally { setConfirmando(null); }
  };

  const asignar = async (p) => {
    const motoristaId = asignSel[p.id] || p.motorista_sugerido?.motorista_id;
    if (!motoristaId) { show('⚠️ Elegí un motorista'); return; }
    setAsignando(p.id);
    try {
      const { error } = await db.rpc('torre_asignar_motorista', {
        p_token: token, p_delivery_id: p.id, p_motorista_id: motoristaId,
      });
      if (error) throw error;
      show('🛵 Motorista asignado');
      await cargar(token);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo asignar')); }
    finally { setAsignando(null); }
  };

  const waLink = (tel, p) => {
    const num = String(tel || '').replace(/\D/g, '');
    const msg = `Hola! Soy de Freakie Dogs 🌭 Sobre tu pedido ${p.numero_orden} por ${fmt(p.total)}. ¿Cómo querés pagar (efectivo/transferencia)?`;
    return `https://wa.me/503${num}?text=${encodeURIComponent(msg)}`;
  };

  // ── Pantalla de PIN ──
  if (!token) {
    return (
      <div style={{ maxWidth: 320, margin: '10px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Torre de pedidos</div>
        <div style={{ fontSize: 13, color: c.dim, marginBottom: 16 }}>Ingresá tu PIN para ver y gestionar los pedidos.</div>
        <input
          type="password" inputMode="numeric" value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => e.key === 'Enter' && entrar()}
          placeholder="PIN" autoFocus
          style={{ background: c.input, border: `1px solid #333`, borderRadius: 10, padding: '12px 14px', color: c.text, fontSize: 18, textAlign: 'center', width: '100%', letterSpacing: 4 }}
        />
        <button onClick={entrar} disabled={pin.length < 3} style={{ marginTop: 12, width: '100%', padding: 13, borderRadius: 10, border: 'none', background: c.red, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Entrar</button>
        {err && <div style={{ color: c.red, fontSize: 13, marginTop: 10 }}>{err}</div>}
      </div>
    );
  }

  const recibidas = pedidos.filter(p => p.estado === 'recibida');

  // ── Lista de pedidos ──
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: c.dim }}>
          {sesion?.nombre ? `${sesion.nombre} · ` : ''}{recibidas.length} por cobrar · {pedidos.length} activos
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => cargar(token)} style={mini('#333')}>{cargando ? '…' : '↻ Actualizar'}</button>
          <button onClick={salir} style={mini('#333')}>Salir</button>
        </div>
      </div>

      {err && <div style={{ color: c.red, fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {pedidos.length === 0 && !cargando && <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>No hay pedidos activos.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pedidos.map(p => {
          const suc = p.sucursal_nombre || (p.ruteo_sugerido?.en_cobertura ? `sugerida: ${p.ruteo_sugerido.nombre}` : null);
          const fueraCobertura = !p.sucursal_id && !p.ruteo_sugerido?.en_cobertura;
          const nItems = Array.isArray(p.items) ? p.items.reduce((s, i) => s + (i.cantidad || 1), 0) : 0;
          return (
            <div key={p.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{p.numero_orden}</span>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: COLOR_ESTADO[p.estado] || c.dim }}>{p.estado}</span>
              </div>
              <div style={{ fontSize: 14 }}>{p.cliente_nombre || 'Cliente'} · {fmt(p.total)}</div>
              <div style={{ fontSize: 12, color: c.dim, marginTop: 2 }}>{p.cliente_direccion}</div>
              <div style={{ fontSize: 12, color: c.dim, marginTop: 2 }}>
                {nItems} ítem(s){suc ? ` · 🏪 ${suc}` : ''}{fueraCobertura ? ' · ⚠️ fuera de cobertura' : ''}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <a href={waLink(p.cliente_telefono, p)} target="_blank" rel="noopener"
                   style={{ ...mini('#25D366'), textDecoration: 'none', display: 'inline-block' }}>💬 WhatsApp</a>

                {p.estado === 'recibida' && (
                  <button disabled={confirmando === p.id || fueraCobertura}
                    onClick={() => confirmar(p, p.metodo_pago || 'efectivo')} style={mini(c.red)}>
                    {confirmando === p.id ? 'Enviando…' : '✅ Confirmar pago → cocina'}
                  </button>
                )}
              </div>

              {/* Asignación de motorista cuando cocina lo marca LISTA */}
              {p.estado === 'lista' && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.border}` }}>
                  {p.motorista_id ? (
                    <div style={{ fontSize: 13, color: c.green }}>🛵 Asignado: <b>{p.motorista_nombre}</b></div>
                  ) : (
                    <div style={{ fontSize: 12, color: c.dim, marginBottom: 6 }}>
                      {p.motorista_sugerido
                        ? <>Sugerido: <b style={{ color: c.text }}>{p.motorista_sugerido.nombre}</b> · a {p.motorista_sugerido.distancia_km} km</>
                        : 'Sin motoristas en línea cerca — elegí uno manualmente.'}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      value={asignSel[p.id] || p.motorista_id || p.motorista_sugerido?.motorista_id || ''}
                      onChange={e => setAsignSel(s => ({ ...s, [p.id]: e.target.value }))}
                      style={{ background: c.input, border: '1px solid #333', borderRadius: 8, padding: '8px 10px', color: c.text, fontSize: 12 }}>
                      <option value="">— motorista en línea —</option>
                      {drivers.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                    </select>
                    <button disabled={asignando === p.id} onClick={() => asignar(p)} style={mini(c.blue)}>
                      {asignando === p.id ? '…' : (p.motorista_id ? 'Cambiar' : '🛵 Asignar')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const mini = (bg, fg = '#fff') => ({
  padding: '8px 12px', borderRadius: 8, background: bg, color: fg, border: 'none',
  cursor: 'pointer', fontSize: 12, fontWeight: 700,
});
