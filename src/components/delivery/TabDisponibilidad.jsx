// ────────────────────────────────────────────────────────────────────
// Torre · Disponibilidad por sucursal (canal delivery propio)
//
// El menú de la web es uno solo para las seis tiendas. Hasta hoy, si a
// Santa Tecla se le acababa el queso frito, la única forma de quitarlo
// era apagarlo en el POS — y se caía también en Plaza Mundo, que sí
// tenía. Acá se apaga SOLO en la tienda que se quedó sin producto.
//
// Lo que se apaga acá no afecta al POS de mostrador ni a PedidosYa:
// es únicamente el menú de la página de pedidos propios.
// Usa la misma sesión de staff (PIN) que la pestaña de Pedidos.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';
const c = { card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e', red: '#e63946',
            green: '#4ade80', yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
            text: '#f0f0f0', dim: '#888' };

const btn = (bg, color = '#fff') => ({
  padding: '7px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
  fontSize: 12.5, fontWeight: 700, background: bg, color,
});

// "hasta" viene en UTC; acá se opera en hora de El Salvador.
const horaSV = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('es-SV', {
      timeZone: 'America/El_Salvador', weekday: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return null; }
};

export default function TabDisponibilidad({ show = () => {} }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [data, setData] = useState(null);      // {sucursales, categorias, bloqueos}
  const [err, setErr] = useState('');
  const [sucSel, setSucSel] = useState('');
  const [busca, setBusca] = useState('');
  const [abriendo, setAbriendo] = useState(null);   // item que se está por apagar
  const [motivo, setMotivo] = useState('');
  const [soloHoy, setSoloHoy] = useState(true);
  const [ocupado, setOcupado] = useState(null);

  const cargar = () => db.rpc('torre_disponibilidad_listar', { p_token: token })
    .then(({ data: d, error }) => {
      if (error) { setErr(error.message); return; }
      setData(d || null);
      setSucSel(s => s || d?.sucursales?.[0]?.id || '');
    });

  useEffect(() => { if (token) cargar(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Índice rápido: "itemId|sucursalId" → bloqueo vivo
  const idx = useMemo(() => {
    const m = {};
    for (const b of data?.bloqueos || []) m[`${b.menu_item_id}|${b.sucursal_id}`] = b;
    return m;
  }, [data]);

  const nombreSuc = (id) => data?.sucursales?.find(s => s.id === id)?.nombre || 'esa tienda';

  const aplicar = async (item, bloquear) => {
    setOcupado(item.id);
    try {
      const { data: r, error } = await db.rpc('torre_disponibilidad_set', {
        p_token: token, p_menu_item_id: item.id, p_sucursal_id: sucSel,
        p_bloquear: bloquear,
        p_motivo: bloquear ? (motivo.trim() || null) : null,
        p_solo_hoy: bloquear ? soloHoy : true,
      });
      if (error) throw error;
      show(bloquear
        ? `🚫 ${r?.producto} apagado en ${r?.sucursal}${r?.hasta ? ` · vuelve solo ${horaSV(r.hasta)}` : ' · hasta que lo prendás'}`
        : `✅ ${r?.producto} vuelve a aparecer en ${r?.sucursal}`);
      setAbriendo(null); setMotivo(''); setSoloHoy(true);
      await cargar();
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  if (!token) return <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>
    Entrá con tu PIN en la pestaña 📥 Pedidos para ver esta sección.
  </div>;
  if (err) return <div style={{ color: c.red, padding: 20 }}>{err}</div>;
  if (!data) return <div style={{ color: c.dim, padding: 20 }}>Cargando…</div>;

  const q = busca.trim().toLowerCase();
  const apagados = data.bloqueos || [];

  return (
    <div style={{ color: c.text }}>

      {/* ── Qué es esto ── */}
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 10,
                    padding: 12, marginBottom: 14, fontSize: 12.5, color: c.dim, lineHeight: 1.5 }}>
        Acá apagás un producto <b style={{ color: c.text }}>solo en una tienda</b>. El cliente
        que pide desde esa zona deja de verlo; los de las otras sucursales lo siguen viendo.
        Afecta únicamente el <b style={{ color: c.text }}>menú de pedidos propios</b> — no toca
        el POS de mostrador ni PedidosYa.
      </div>

      {/* ── Lo que está apagado ahora mismo ── */}
      {apagados.length > 0 && (
        <div style={{ background: '#2a1a1a', border: `1px solid ${c.red}`, borderRadius: 10,
                      padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: c.red, fontSize: 13, marginBottom: 8 }}>
            🚫 Apagado ahora ({apagados.length})
          </div>
          {apagados.map(b => (
            <div key={`${b.menu_item_id}|${b.sucursal_id}`}
                 style={{ fontSize: 12.5, padding: '4px 0', borderTop: `1px solid ${c.border}` }}>
              <b>{(data.categorias || []).flatMap(x => x.items)
                    .find(i => i.id === b.menu_item_id)?.nombre || 'producto'}</b>
              {' en '}<b style={{ color: c.yellow }}>{nombreSuc(b.sucursal_id)}</b>
              {b.motivo ? ` · ${b.motivo}` : ''}
              <span style={{ color: c.dim }}>
                {b.hasta ? ` · vuelve solo ${horaSV(b.hasta)}` : ' · hasta que alguien lo prenda'}
                {b.quien ? ` · lo apagó ${b.quien}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Tienda ── */}
      <div style={{ fontSize: 12, color: c.dim, marginBottom: 6 }}>¿Qué tienda se quedó sin producto?</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {(data.sucursales || []).map(s => {
          const n = apagados.filter(b => b.sucursal_id === s.id).length;
          return (
            <button key={s.id} onClick={() => { setSucSel(s.id); setAbriendo(null); }} style={{
              ...btn(sucSel === s.id ? c.red : '#222', sucSel === s.id ? '#fff' : c.dim),
              fontSize: 12.5,
            }}>
              {s.nombre}{n > 0 ? ` · ${n} 🚫` : ''}
            </button>
          );
        })}
      </div>

      <input value={busca} onChange={e => setBusca(e.target.value)}
             placeholder="Buscar producto…"
             style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8,
                      border: `1px solid ${c.border}`, background: c.input, color: c.text,
                      fontSize: 13, marginBottom: 14 }} />

      {/* ── Productos ── */}
      {(data.categorias || []).map(cat => {
        const items = (cat.items || []).filter(i => !q || i.nombre.toLowerCase().includes(q));
        if (!items.length) return null;
        return (
          <div key={cat.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: c.dim, textTransform: 'uppercase',
                          letterSpacing: 0.6, marginBottom: 6 }}>{cat.nombre}</div>
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 10,
                          overflow: 'hidden' }}>
              {items.map((i, n) => {
                const b = idx[`${i.id}|${sucSel}`];
                return (
                  <div key={i.id} style={{ padding: '9px 11px',
                                           borderTop: n ? `1px solid ${c.border}` : 'none',
                                           background: b ? '#2a1a1a' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600,
                                      color: b ? c.dim : c.text,
                                      textDecoration: b ? 'line-through' : 'none' }}>
                          {i.nombre}
                        </div>
                        {b && (
                          <div style={{ fontSize: 11, color: c.red, marginTop: 2 }}>
                            No aparece en {nombreSuc(sucSel)}
                            {b.motivo ? ` · ${b.motivo}` : ''}
                            {b.hasta ? ` · vuelve solo ${horaSV(b.hasta)}` : ' · hasta que lo prendás'}
                          </div>
                        )}
                      </div>
                      {b ? (
                        <button disabled={ocupado === i.id} onClick={() => aplicar(i, false)}
                                style={btn(c.green, '#0a0a0a')}>
                          {ocupado === i.id ? '…' : '✅ Ya hay'}
                        </button>
                      ) : abriendo === i.id ? (
                        <button onClick={() => setAbriendo(null)}
                                style={{ ...btn('none', c.dim), border: `1px solid ${c.border}` }}>
                          Dejar así
                        </button>
                      ) : (
                        <button onClick={() => { setAbriendo(i.id); setMotivo(''); setSoloHoy(true); }}
                                style={{ ...btn('none', c.dim), border: `1px solid ${c.border}` }}>
                          🚫 Se acabó
                        </button>
                      )}
                    </div>

                    {abriendo === i.id && !b && (
                      <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px dashed ${c.border}` }}>
                        <input value={motivo} onChange={e => setMotivo(e.target.value)}
                               placeholder="¿Por qué? (opcional — ej. no llegó el despacho)"
                               style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px',
                                        borderRadius: 7, border: `1px solid ${c.border}`,
                                        background: c.input, color: c.text, fontSize: 12.5,
                                        marginBottom: 8 }} />
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                          <button onClick={() => setSoloHoy(true)}
                                  style={btn(soloHoy ? c.blue : '#222', soloHoy ? '#0a0a0a' : c.dim)}>
                            Solo hoy
                          </button>
                          <button onClick={() => setSoloHoy(false)}
                                  style={btn(!soloHoy ? c.orange : '#222', !soloHoy ? '#0a0a0a' : c.dim)}>
                            Hasta que yo lo prenda
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: c.dim, marginBottom: 8, lineHeight: 1.4 }}>
                          {soloHoy
                            ? 'Vuelve a aparecer solo mañana a las 6:00 a.m. Si mañana tampoco hay, lo volvés a apagar.'
                            : 'No vuelve a aparecer hasta que alguien lo prenda desde esta pantalla. Ojo: si nadie se acuerda, se queda escondido.'}
                        </div>
                        <button disabled={ocupado === i.id} onClick={() => aplicar(i, true)}
                                style={{ ...btn(c.red), width: '100%' }}>
                          {ocupado === i.id ? '…' : `🚫 Quitarlo del menú de ${nombreSuc(sucSel)}`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
