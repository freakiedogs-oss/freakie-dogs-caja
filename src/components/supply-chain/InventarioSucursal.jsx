import { useState, useEffect } from 'react';
import { db } from '../../supabase';

// ── DASHBOARD DE INVENTARIO POR SUCURSAL ──────────────────────────────
// Cada sucursal ve su inventario; Casa Matriz (jefes/ejecutivos) puede ver
// cualquiera en tiempo real. Agrupado por categoría de conteo, con bajo-mínimo.
const ROLES_MULTI = ['jefe_casa_matriz', 'admin', 'ejecutivo', 'superadmin'];
const C = { card: '#1a1a1a', card2: '#151515', border: '#2a2a2a', text: '#f0f0f0', dim: '#8a8a8a', red: '#e63946', green: '#4ade80', yellow: '#fbbf24' };

export default function InventarioSucursal({ user }) {
  const multi = ROLES_MULTI.includes(user?.rol);
  const [sucursales, setSucursales] = useState([]);
  const [sucId, setSucId] = useState('');
  const [data, setData] = useState(null);
  const [openG, setOpenG] = useState({});
  const [soloBajos, setSoloBajos] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    db.from('sucursales').select('id,store_code,nombre').eq('activa', true).neq('store_code', 'CM001')
      .order('store_code').then(({ data }) => {
        setSucursales(data || []);
        const mine = (data || []).find(s => s.store_code === user?.store_code);
        setSucId(mine ? mine.id : (data || [])[0]?.id || '');
      });
  }, []);

  const cargar = async (id) => {
    if (!id) return;
    setData(null);
    const { data: d } = await db.rpc('dashboard_inventario_sucursal', { p_sucursal_id: id });
    setData(d || null);
    setOpenG({});
  };
  useEffect(() => { if (sucId) cargar(sucId); }, [sucId]); // eslint-disable-line

  const sucNombre = sucursales.find(s => s.id === sucId);
  const nq = q.trim().toLowerCase();
  const grupos = (data?.grupos || [])
    .map(g => ({ ...g, items: (g.items || []).filter(it => (!soloBajos || it.bajo) && (!nq || (it.producto || '').toLowerCase().includes(nq))) }))
    .filter(g => g.items.length > 0);

  return (
    <div style={{ padding: 16, color: C.text, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>📦 Inventario por Sucursal</div>
        <div style={{ flex: 1 }} />
        <button onClick={() => cargar(sucId)} style={btn('#333')}>↻</button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        {multi ? (
          <select value={sucId} onChange={e => setSucId(e.target.value)} style={{ ...inp, minWidth: 220 }}>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.store_code} — {s.nombre}</option>)}
          </select>
        ) : (
          <div style={{ ...box, padding: '8px 12px', fontWeight: 700 }}>{sucNombre ? `${sucNombre.store_code} — ${sucNombre.nombre}` : '…'}</div>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Producto…" style={{ ...inp, flex: 1, minWidth: 140 }} />
        <button onClick={() => setSoloBajos(v => !v)} style={{ ...btn(soloBajos ? C.yellow : '#333'), color: soloBajos ? '#1a1a1a' : C.text }}>
          ⚠️ Bajo mínimo {data ? `(${data.bajos})` : ''}
        </button>
      </div>

      {!data ? (
        <div style={{ color: C.dim, padding: 12 }}>Cargando…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>
            {data.total} productos · {data.bajos} bajo mínimo
            {data.actualizado ? ` · actualizado ${new Date(data.actualizado).toLocaleString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {grupos.map(g => (
              <div key={g.grupo} style={box}>
                <div onClick={() => setOpenG(o => ({ ...o, [g.grupo]: !o[g.grupo] }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <div style={{ flex: 1, fontWeight: 700 }}>{g.grupo}</div>
                  {g.n_bajos > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.yellow }}>⚠️ {g.n_bajos}</span>}
                  <span style={{ fontSize: 12, color: C.dim }}>{g.items.length}</span>
                  <span style={{ color: C.dim }}>{openG[g.grupo] ? '▲' : '▼'}</span>
                </div>
                {openG[g.grupo] && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {g.items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: it.bajo ? '#2a1414' : C.card2 }}>
                        <div style={{ flex: 1, fontSize: 13 }}>{it.producto}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: it.bajo ? C.red : C.green }}>
                          {Number(it.stock ?? 0)} <span style={{ color: C.dim, fontWeight: 400, fontSize: 11 }}>{it.unidad || ''}</span>
                        </div>
                        {it.minimo > 0 && <div style={{ fontSize: 10, color: C.dim, width: 60, textAlign: 'right' }}>mín {Number(it.minimo)}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {grupos.length === 0 && <div style={{ ...box, textAlign: 'center', color: C.dim, padding: 24 }}>Sin resultados.</div>}
          </div>
        </>
      )}
    </div>
  );
}

const box = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 };
const inp = { background: '#1e1e1e', border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 13 };
const btn = (bg) => ({ background: bg, border: 'none', color: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
