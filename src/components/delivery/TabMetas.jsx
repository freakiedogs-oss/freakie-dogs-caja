// ─────────────────────────────────────────────────────────────────────────────
// Torre de Control · Metas de motoristas (27-nov-2026, Cesar)
// Mes en curso: cuánto bono lleva cada motorista vs la meta en $ (config
// `meta_bono_mes`), con viajes, dobles (≥ km_umbral_doble por calle),
// mandados, fuera de horario, km y proyección a fin de mes.
// Lee por la RPC gateada torre_metas_motoristas(p_token); la meta se cambia con
// torre_set_meta_bono (solo admin/superadmin/ejecutivo).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';
const c = {
  card: '#1a1a1a', border: '#2a2a2a', red: '#e63946', green: '#4ade80', yellow: '#fbbf24',
  orange: '#f97316', blue: '#60a5fa', purple: '#a78bfa', text: '#f0f0f0', dim: '#888',
};
const n = (x) => Number(x) || 0;
const fmt = (x) => `$${n(x).toFixed(2)}`;
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const colorPct = (p) => (p >= 100 ? c.green : p >= 70 ? c.yellow : p >= 40 ? c.orange : c.red);

function Chip({ etq, val, col }) {
  return (
    <div style={{ background: '#111', borderRadius: 8, padding: '6px 8px', minWidth: 58, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: col || c.text }}>{val}</div>
      <div style={{ fontSize: 10, color: c.dim }}>{etq}</div>
    </div>
  );
}

export default function TabMetas({ show = () => {} }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(false);
  const [nuevaMeta, setNuevaMeta] = useState('');
  const [suc, setSuc] = useState('todas');

  const cargar = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true); setErr('');
    const { data: d, error } = await db.rpc('torre_metas_motoristas', { p_token: token });
    if (error) { setErr(error.message || 'No se pudo cargar'); setData(null); }
    else setData(d);
    setLoading(false);
  }, [token]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { const t = setInterval(cargar, 120000); return () => clearInterval(t); }, [cargar]);

  const guardarMeta = async () => {
    const v = parseFloat(nuevaMeta);
    if (!(v > 0)) { show('Escribí una meta válida', 'error'); return; }
    const { error } = await db.rpc('torre_set_meta_bono', { p_token: token, p_valor: v });
    if (error) { show(error.message, 'error'); return; }
    show('Meta actualizada', 'success'); setEditando(false); cargar();
  };

  const meta = n(data?.meta);
  const sucursales = useMemo(() => [...new Set((data?.motoristas || []).map(m => m.sucursal || 'Sin sucursal'))].sort(), [data]);
  const lista = useMemo(() => (data?.motoristas || [])
    .filter(m => suc === 'todas' || (m.sucursal || 'Sin sucursal') === suc), [data, suc]);

  const tot = useMemo(() => lista.reduce((a, m) => ({
    viajes: a.viajes + n(m.viajes), dobles: a.dobles + n(m.dobles), bono: a.bono + n(m.bono),
    llegan: a.llegan + (n(m.proyeccion) >= meta && meta > 0 ? 1 : 0),
  }), { viajes: 0, dobles: 0, bono: 0, llegan: 0 }), [lista, meta]);

  if (!token) return <div style={{ color: c.dim, padding: 20 }}>Entrá primero con tu PIN en la pestaña Pedidos.</div>;
  if (loading && !data) return <div style={{ color: c.dim, padding: 20 }}>Cargando metas…</div>;
  if (err) return (
    <div style={{ color: c.red, padding: 20 }}>{err}
      <div><button onClick={cargar} style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#333', color: '#fff', cursor: 'pointer' }}>Reintentar</button></div>
    </div>
  );
  if (!data) return null;

  const [y, mo] = (data.mes || '').split('-');
  const pctMes = Math.round(n(data.dias_pasados) / n(data.dias_mes) * 100);

  return (
    <div>
      {/* Encabezado: mes, meta y avance del mes */}
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: c.dim }}>Metas de {MESES[+mo - 1]} {y} · día {data.dias_pasados} de {data.dias_mes} ({pctMes}% del mes)</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.text, marginTop: 2 }}>
              Meta por motorista: <span style={{ color: c.yellow }}>{fmt(meta)}</span>
            </div>
            <div style={{ fontSize: 11, color: c.dim, marginTop: 2 }}>Doble = entrega de {n(data.umbral_km)} km o más por calle (Google Maps)</div>
          </div>
          {data.puede_editar && (editando ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min="1" step="5" value={nuevaMeta} onChange={e => setNuevaMeta(e.target.value)} placeholder="150"
                style={{ width: 90, background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, padding: '8px 10px', color: c.text }} />
              <button onClick={guardarMeta} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: c.green, color: '#000', fontWeight: 700, cursor: 'pointer' }}>Guardar</button>
              <button onClick={() => setEditando(false)} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#333', color: '#fff', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <button onClick={() => { setNuevaMeta(String(meta)); setEditando(true); }}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #444', background: 'transparent', color: c.text, cursor: 'pointer', fontSize: 13 }}>✏️ Cambiar meta</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Chip etq="viajes" val={tot.viajes} col={c.purple} />
          <Chip etq="dobles" val={tot.dobles} col={c.orange} />
          <Chip etq="bono total" val={fmt(tot.bono)} col={c.green} />
          <Chip etq="llegan a la meta*" val={`${tot.llegan}/${lista.length}`} col={c.yellow} />
        </div>
        <div style={{ fontSize: 10, color: c.dim, marginTop: 6 }}>* según la proyección a fin de mes al ritmo que llevan.</div>
      </div>

      {/* Filtro por sucursal */}
      {sucursales.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
          {['todas', ...sucursales].map(s => (
            <button key={s} onClick={() => setSuc(s)} style={{
              padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
              background: suc === s ? c.red : '#222', color: suc === s ? '#fff' : c.dim, fontWeight: 600,
            }}>{s === 'todas' ? 'Todas' : s}</button>
          ))}
        </div>
      )}

      {/* Tarjeta por motorista */}
      {lista.map((m, i) => {
        const pct = meta > 0 ? Math.round(n(m.bono) / meta * 100) : 0;
        const pctProy = meta > 0 ? Math.round(n(m.proyeccion) / meta * 100) : 0;
        const col = colorPct(pct);
        const falta = Math.max(0, meta - n(m.bono));
        return (
          <div key={m.empleado_id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div>
                <span style={{ fontSize: 12, color: c.dim, marginRight: 6 }}>#{i + 1}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: c.text }}>{m.nombre}</span>
                <div style={{ fontSize: 11, color: c.dim }}>{m.sucursal || 'Sin sucursal'} · hoy {m.viajes_hoy} viaje(s)</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: col }}>{fmt(m.bono)}</div>
                <div style={{ fontSize: 11, color: c.dim }}>de {fmt(meta)} · {pct}%</div>
              </div>
            </div>

            {/* Barra de avance + marca de la proyección */}
            <div style={{ position: 'relative', height: 10, background: '#2a2a2a', borderRadius: 6, marginTop: 10 }}>
              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: col, borderRadius: 6 }} />
              {pctProy > 0 && (
                <div title="Proyección a fin de mes" style={{ position: 'absolute', top: -3, left: `calc(${Math.min(pctProy, 100)}% - 1px)`, width: 2, height: 16, background: '#fff', opacity: 0.6 }} />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: c.dim, marginTop: 4 }}>
              <span>{pct >= 100 ? '✅ Meta cumplida' : `Le faltan ${fmt(falta)}`}</span>
              <span>Proyección fin de mes: <b style={{ color: pctProy >= 100 ? c.green : c.text }}>{fmt(m.proyeccion)}</b></span>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <Chip etq="viajes" val={m.viajes} col={c.purple} />
              <Chip etq="normales" val={m.normales} />
              <Chip etq="dobles" val={m.dobles} col={c.orange} />
              <Chip etq="mandados" val={m.mandados} col={c.blue} />
              <Chip etq="fuera hor." val={m.fuera_horario} col={c.red} />
              <Chip etq="km" val={n(m.km).toFixed(0)} />
            </div>
          </div>
        );
      })}
      {lista.length === 0 && <div style={{ color: c.dim, padding: 20 }}>Sin motoristas para mostrar.</div>}
    </div>
  );
}
