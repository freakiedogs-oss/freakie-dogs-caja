// ────────────────────────────────────────────────────────────────────
// Torre · Parámetros de bonos de delivery (admin)
// Edita config_delivery: cuánto vale cada viaje para el bono del motorista.
// Requiere sesión de staff (mismo token que Pedidos) y rol admin.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';
const c = { card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e', red: '#e63946', green: '#4ade80', text: '#f0f0f0', dim: '#888' };

const CAMPOS = [
  { k: 'tarifa_entrega_normal', label: 'Entrega normal',      ayuda: 'Viaje por debajo del umbral de km', pre: '$' },
  { k: 'tarifa_entrega_larga',  label: 'Entrega larga',       ayuda: 'Viaje igual o mayor al umbral de km', pre: '$' },
  { k: 'km_umbral_doble',       label: 'Umbral de km',        ayuda: 'A partir de cuántos km el viaje paga tarifa larga', pre: 'km' },
  { k: 'tarifa_fuera_horario',  label: 'Fuera de horario',    ayuda: 'Tarifa plana; reemplaza a la de distancia', pre: '$' },
  { k: 'tarifa_mandado',        label: 'Mandado',             ayuda: 'Encargo que no es entrega de pedido', pre: '$' },
];

const CAMPOS_ENVIO = [
  { k: 'pedido_minimo',      label: 'Pedido mínimo',   ayuda: 'Monto mínimo para poder pedir a domicilio', pre: '$' },
  { k: 'envio_gratis_desde', label: 'Envío gratis desde', ayuda: 'Desde este subtotal el envío no se cobra', pre: '$' },
];

export default function TabParametros({ show = () => {} }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [vals, setVals] = useState(null);
  const [orig, setOrig] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const [tramos, setTramos] = useState(null);
  const [tramosOrig, setTramosOrig] = useState(null);

  useEffect(() => {
    if (!token) return;
    db.rpc('torre_config_delivery', { p_token: token }).then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      const plano = {};
      Object.entries(data || {}).forEach(([k, v]) => { plano[k] = v.valor; });
      setVals(plano); setOrig(plano);
    });
    db.rpc('torre_envio_tramos', { p_token: token }).then(({ data }) => {
      const t = (data || []).map(x => ({ km_hasta: x.km_hasta ?? '', costo: x.costo }));
      setTramos(t); setTramosOrig(JSON.stringify(t));
    });
  }, [token]);

  if (!token) return <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>Entrá con tu PIN en la pestaña 📥 Pedidos para ver esta sección.</div>;
  if (err) return <div style={{ color: c.red, padding: 20 }}>{err}</div>;
  if (!vals) return <div style={{ color: c.dim, padding: 20 }}>Cargando…</div>;

  const cambiadoTramos = tramos && tramosOrig && JSON.stringify(tramos) !== tramosOrig;
  const cambiado = (orig && Object.keys(vals).some(k => String(vals[k]) !== String(orig[k]))) || cambiadoTramos;

  const guardar = async () => {
    setGuardando(true); setErr('');
    try {
      const { data, error } = await db.rpc('torre_guardar_config_delivery', { p_token: token, p_valores: vals });
      if (error) throw error;
      if (tramos) {
        const { error: e2 } = await db.rpc('torre_guardar_envio_tramos', {
          p_token: token,
          p_tramos: tramos.map(t => ({ km_hasta: t.km_hasta === '' ? null : Number(t.km_hasta), costo: Number(t.costo) || 0 })),
        });
        if (e2) throw e2;
        setTramosOrig(JSON.stringify(tramos));
      }
      setOrig({ ...vals });
      show(`✅ Parámetros guardados (${data.actualizados})`);
    } catch (e) { setErr(e.message || 'No se pudo guardar'); }
    finally { setGuardando(false); }
  };

  const n = (x) => Number(x || 0);
  const ejemplo = `Un viaje de 5 km paga ${fmt(vals.tarifa_entrega_normal)} · uno de ${n(vals.km_umbral_doble)} km o más paga ${fmt(vals.tarifa_entrega_larga)} · fuera de horario siempre ${fmt(vals.tarifa_fuera_horario)}`;

  return (
    <div>
      <div style={{ fontSize: 13, color: c.dim, marginBottom: 14, lineHeight: 1.5 }}>
        Cuánto suma cada viaje al bono del motorista. Aplica a los viajes nuevos; los ya registrados se recalculan con estos valores al ver el bono del mes.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {CAMPOS.map(f => (
          <div key={f.k} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{f.label}</div>
                <div style={{ fontSize: 12, color: c.dim, marginTop: 2 }}>{f.ayuda}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: c.dim, fontSize: 13 }}>{f.pre}</span>
                <input
                  value={vals[f.k] ?? ''}
                  onChange={e => setVals(v => ({ ...v, [f.k]: e.target.value.replace(/[^\d.]/g, '') }))}
                  inputMode="decimal"
                  style={{ background: c.input, border: `1px solid #333`, borderRadius: 8, padding: '9px 10px', color: c.text, fontSize: 15, fontWeight: 700, width: 84, textAlign: 'right' }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, color: c.dim, marginTop: 12, fontStyle: 'italic', lineHeight: 1.5 }}>{ejemplo}</div>

      {/* ── Costo de envío al cliente ── */}
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: '22px 0 8px' }}>🛵 Costo de envío al cliente</h3>
      <div style={{ fontSize: 12, color: c.dim, marginBottom: 10 }}>
        Cuánto paga el cliente por el envío según la distancia. El primer tramo que cumpla manda.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {CAMPOS_ENVIO.map(f => (
          <div key={f.k} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14,
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{f.label}</div>
              <div style={{ fontSize: 12, color: c.dim, marginTop: 2 }}>{f.ayuda}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: c.dim, fontSize: 13 }}>{f.pre}</span>
              <input value={vals[f.k] ?? ''} inputMode="decimal"
                onChange={e => setVals(v => ({ ...v, [f.k]: e.target.value.replace(/[^\d.]/g, '') }))}
                style={{ background: c.input, border: `1px solid #333`, borderRadius: 8, padding: '9px 10px',
                         color: c.text, fontSize: 15, fontWeight: 700, width: 84, textAlign: 'right' }} />
            </div>
          </div>
        ))}
      </div>

      {tramos && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14, marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Tramos por distancia</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tramos.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: c.dim, minWidth: 62 }}>
                  {i === 0 ? 'Hasta' : t.km_hasta === '' ? 'Más de' : 'Hasta'}
                </span>
                <input value={t.km_hasta} inputMode="decimal" placeholder="∞"
                  onChange={e => setTramos(ts => ts.map((x, j) => j === i ? { ...x, km_hasta: e.target.value.replace(/[^\d.]/g, '') } : x))}
                  style={{ background: c.input, border: '1px solid #333', borderRadius: 8, padding: '8px 10px',
                           color: c.text, fontSize: 14, width: 70, textAlign: 'right' }} />
                <span style={{ fontSize: 12, color: c.dim }}>km →</span>
                <span style={{ color: c.dim, fontSize: 13 }}>$</span>
                <input value={t.costo} inputMode="decimal"
                  onChange={e => setTramos(ts => ts.map((x, j) => j === i ? { ...x, costo: e.target.value.replace(/[^\d.]/g, '') } : x))}
                  style={{ background: c.input, border: '1px solid #333', borderRadius: 8, padding: '8px 10px',
                           color: c.text, fontSize: 14, fontWeight: 700, width: 74, textAlign: 'right' }} />
                <button onClick={() => setTramos(ts => ts.filter((_, j) => j !== i))}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: c.dim, cursor: 'pointer', fontSize: 15 }}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={() => setTramos(ts => [...ts, { km_hasta: '', costo: '0' }])}
            style={{ marginTop: 10, padding: '7px 12px', borderRadius: 8, border: `1px dashed ${c.border}`,
                     background: 'none', color: c.dim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + Agregar tramo
          </button>
          <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
            Dejá el km vacío para el último tramo (“de ahí en adelante”).
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <button onClick={guardar} disabled={!cambiado || guardando}
          style={{ padding: '11px 18px', borderRadius: 10, border: 'none', background: cambiado ? c.red : '#333', color: '#fff', fontSize: 14, fontWeight: 700, cursor: cambiado ? 'pointer' : 'default' }}>
          {guardando ? 'Guardando…' : '💾 Guardar cambios'}
        </button>
        {cambiado && <button onClick={() => setVals({ ...orig })} style={{ padding: '11px 14px', borderRadius: 10, border: 'none', background: '#333', color: c.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Descartar</button>}
        {!cambiado && <span style={{ fontSize: 12, color: c.green }}>✓ Al día</span>}
      </div>

      <div style={{ fontSize: 11, color: '#555', marginTop: 14 }}>Solo admin, superadmin o ejecutivo pueden guardar cambios.</div>
    </div>
  );
}

const fmt = (x) => `$${Number(x || 0).toFixed(2)}`;
