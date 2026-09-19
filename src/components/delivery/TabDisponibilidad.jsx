// ────────────────────────────────────────────────────────────────────
// Torre · Disponibilidad por sucursal (canal delivery propio)
//
// El menú de la web es uno solo para las seis tiendas. Hasta hoy, si a
// Santa Tecla se le acababa el queso frito, la única forma de quitarlo
// era apagarlo en el POS — y se caía también en Plaza Mundo, que sí
// tenía.
//
// Dos cosas que hay que entender de esta pantalla:
//
//  1. Se apaga un PRODUCTO, no una línea del menú. El mismo queso frito
//     vive en tres lados: suelto, adentro de los combos y como extra.
//     Apagarlo acá lo apaga en los tres a la vez, porque en la cocina
//     es la misma paila.
//
//  2. Apagar sin ofrecer cambio es perder la venta. Por eso, al apagar,
//     Karina elige con qué se puede reemplazar. El cliente lo escoge él
//     mismo en la página y NUNCA paga de más: si el cambio cuesta más,
//     la diferencia se la come la casa.
//
// Afecta únicamente el menú de pedidos propios: el POS de mostrador y
// PedidosYa no se tocan. Usa la misma sesión de staff (PIN) que Pedidos.
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
const campo = {
  width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 8,
  border: `1px solid ${c.border}`, background: c.input, color: c.text, fontSize: 13,
};

// "hasta" viaja en UTC; acá se opera en hora de El Salvador.
const horaSV = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('es-SV', {
      timeZone: 'America/El_Salvador', weekday: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return null; }
};

// Dónde vive un producto, en palabras.
const dondeVive = (p) => {
  const partes = [];
  if (p.suelto) partes.push('suelto');
  if ((p.combos || []).length) partes.push(`en ${p.combos.length} combo${p.combos.length > 1 ? 's' : ''}`);
  if (p.extra) partes.push('como extra');
  return partes.join(' · ') || 'en el menú';
};

export default function TabDisponibilidad({ show = () => {} }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [sucSel, setSucSel] = useState('');
  const [busca, setBusca] = useState('');
  const [abriendo, setAbriendo] = useState(null);   // clave del producto que se está apagando
  const [motivo, setMotivo] = useState('');
  const [soloHoy, setSoloHoy] = useState(true);
  const [cambios, setCambios] = useState([]);       // claves elegidas, en orden
  const [buscaCambio, setBuscaCambio] = useState('');
  const [ocupado, setOcupado] = useState(null);

  const cargar = () => db.rpc('torre_disponibilidad_listar', { p_token: token })
    .then(({ data: d, error }) => {
      if (error) { setErr(error.message); return; }
      setData(d || null);
      setSucSel(s => s || d?.sucursales?.[0]?.id || '');
    });

  useEffect(() => { if (token) cargar(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const productos = useMemo(() => data?.productos || [], [data]);
  const porClave = useMemo(
    () => Object.fromEntries(productos.map(p => [p.clave, p])), [productos]);

  // Bloqueos vivos de la sucursal elegida, por clave
  const bloqueado = useMemo(() => {
    const m = {};
    for (const b of data?.bloqueos || []) if (b.sucursal_id === sucSel) m[b.clave] = b;
    return m;
  }, [data, sucSel]);

  const nombreSuc = (id) => data?.sucursales?.find(s => s.id === id)?.nombre || 'esa tienda';

  const abrir = (p) => {
    setAbriendo(p.clave); setMotivo(''); setSoloHoy(true);
    setCambios([]); setBuscaCambio('');
  };

  const toggleCambio = (clave) => setCambios(xs =>
    xs.includes(clave) ? xs.filter(x => x !== clave) : [...xs, clave]);

  const aplicar = async (p, bloquear) => {
    setOcupado(p.clave);
    try {
      const { data: r, error } = await db.rpc('torre_disponibilidad_set', {
        p_token: token, p_sucursal_id: sucSel, p_clave: p.clave,
        p_bloquear: bloquear,
        p_motivo: bloquear ? (motivo.trim() || null) : null,
        p_solo_hoy: bloquear ? soloHoy : true,
        p_cambios: bloquear ? cambios : [],
      });
      if (error) throw error;
      show(bloquear
        ? `🚫 ${r?.producto} apagado en ${r?.sucursal}${r?.hasta ? ` · vuelve solo ${horaSV(r.hasta)}` : ' · hasta que lo prendás'}`
        : `✅ ${r?.producto} vuelve a aparecer en ${r?.sucursal}`);
      setAbriendo(null); setCambios([]); setMotivo(''); setSoloHoy(true);
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
  const lista = productos.filter(p => !q || p.nombre.toLowerCase().includes(q));
  const apagados = data.bloqueos || [];

  return (
    <div style={{ color: c.text }}>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 10,
                    padding: 12, marginBottom: 14, fontSize: 12.5, color: c.dim, lineHeight: 1.5 }}>
        Apagá un producto <b style={{ color: c.text }}>solo en la tienda que se quedó sin él</b>.
        Se apaga en todos lados a la vez: suelto, adentro de los combos y como extra.
        Elegí también <b style={{ color: c.text }}>con qué se puede cambiar</b> — así el cliente
        escoge y no perdemos la venta. Si el cambio cuesta más, no se le cobra la diferencia.
      </div>

      {/* ── Lo apagado ahora mismo, en todas las tiendas ── */}
      {apagados.length > 0 && (
        <div style={{ background: '#2a1a1a', border: `1px solid ${c.red}`, borderRadius: 10,
                      padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: c.red, fontSize: 13, marginBottom: 8 }}>
            🚫 Apagado ahora ({apagados.length})
          </div>
          {apagados.map(b => (
            <div key={`${b.clave}|${b.sucursal_id}`}
                 style={{ fontSize: 12.5, padding: '5px 0', borderTop: `1px solid ${c.border}`, lineHeight: 1.45 }}>
              <b>{b.nombre}</b>{' en '}<b style={{ color: c.yellow }}>{nombreSuc(b.sucursal_id)}</b>
              {b.motivo ? ` · ${b.motivo}` : ''}
              <div style={{ color: c.dim, fontSize: 11.5 }}>
                {(b.cambios || []).length
                  ? `Se cambia por: ${b.cambios.map(x => x.nombre).join(' · ')}`
                  : '⚠️ sin cambio ofrecido — el cliente solo lo puede quitar'}
                {b.hasta ? ` · vuelve solo ${horaSV(b.hasta)}` : ' · hasta que alguien lo prenda'}
                {b.quien ? ` · ${b.quien}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: c.dim, marginBottom: 6 }}>¿Qué tienda se quedó sin producto?</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {(data.sucursales || []).map(s => {
          const n = apagados.filter(b => b.sucursal_id === s.id).length;
          return (
            <button key={s.id} onClick={() => { setSucSel(s.id); setAbriendo(null); }} style={{
              ...btn(sucSel === s.id ? c.red : '#222', sucSel === s.id ? '#fff' : c.dim), fontSize: 12.5,
            }}>{s.nombre}{n > 0 ? ` · ${n} 🚫` : ''}</button>
          );
        })}
      </div>

      <input value={busca} onChange={e => setBusca(e.target.value)}
             placeholder="Buscar producto…" style={{ ...campo, marginBottom: 14 }} />

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {lista.length === 0 && (
          <div style={{ padding: 16, color: c.dim, fontSize: 13 }}>Nada con ese nombre.</div>
        )}
        {lista.map((p, n) => {
          const b = bloqueado[p.clave];
          const enCombos = (p.combos || []).length > 0;
          // Un cambio solo sirve si vive en el mismo lugar que lo que se apagó.
          const cubreCombos = cambios.some(k => (porClave[k]?.combos || []).length > 0);
          const cubreSuelto = cambios.some(k => porClave[k]?.suelto);
          return (
            <div key={p.clave} style={{ padding: '10px 11px',
                                        borderTop: n ? `1px solid ${c.border}` : 'none',
                                        background: b ? '#2a1a1a' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: b ? c.dim : c.text,
                                textDecoration: b ? 'line-through' : 'none' }}>
                    {p.nombre}
                  </div>
                  <div style={{ fontSize: 11, color: c.dim, marginTop: 1 }}>{dondeVive(p)}</div>
                  {b && (
                    <div style={{ fontSize: 11.5, color: c.red, marginTop: 3, lineHeight: 1.4 }}>
                      Apagado en {nombreSuc(sucSel)}{b.motivo ? ` · ${b.motivo}` : ''}
                      <br />
                      {(b.cambios || []).length
                        ? `Se cambia por: ${b.cambios.map(x => x.nombre).join(' · ')}`
                        : '⚠️ sin cambio ofrecido'}
                      {b.hasta ? ` · vuelve ${horaSV(b.hasta)}` : ' · hasta que lo prendás'}
                    </div>
                  )}
                </div>
                {b ? (
                  <button disabled={ocupado === p.clave} onClick={() => aplicar(p, false)}
                          style={btn(c.green, '#0a0a0a')}>
                    {ocupado === p.clave ? '…' : '✅ Ya hay'}
                  </button>
                ) : abriendo === p.clave ? (
                  <button onClick={() => setAbriendo(null)}
                          style={{ ...btn('none', c.dim), border: `1px solid ${c.border}` }}>
                    Dejar así
                  </button>
                ) : (
                  <button onClick={() => abrir(p)}
                          style={{ ...btn('none', c.dim), border: `1px solid ${c.border}` }}>
                    🚫 Se acabó
                  </button>
                )}
              </div>

              {abriendo === p.clave && !b && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${c.border}` }}>
                  {enCombos && (
                    <div style={{ fontSize: 11.5, color: c.yellow, marginBottom: 8, lineHeight: 1.4 }}>
                      Ojo: también sale en {p.combos.join(', ')}. Al apagarlo, esos combos
                      necesitan un cambio o nadie los va a poder pedir.
                    </div>
                  )}

                  <input value={motivo} onChange={e => setMotivo(e.target.value)}
                         placeholder="¿Por qué? (opcional — ej. no llegó el despacho)"
                         style={{ ...campo, marginBottom: 10, fontSize: 12.5 }} />

                  {/* ── Con qué se cambia ── */}
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
                    ¿Por qué se lo podemos cambiar al cliente?
                  </div>
                  {cambios.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 7 }}>
                      {cambios.map((k, i) => (
                        <button key={k} onClick={() => toggleCambio(k)}
                                style={{ ...btn(c.blue, '#0a0a0a'), fontSize: 12 }}>
                          {i + 1}. {porClave[k]?.nombre || k} ✕
                        </button>
                      ))}
                    </div>
                  )}
                  <input value={buscaCambio} onChange={e => setBuscaCambio(e.target.value)}
                         placeholder="Buscar con qué cambiarlo…"
                         style={{ ...campo, marginBottom: 7, fontSize: 12.5 }} />
                  {buscaCambio.trim() && (
                    <div style={{ maxHeight: 170, overflowY: 'auto', border: `1px solid ${c.border}`,
                                  borderRadius: 8, marginBottom: 8 }}>
                      {productos
                        .filter(x => x.clave !== p.clave
                          && !cambios.includes(x.clave)
                          && !bloqueado[x.clave]
                          && x.nombre.toLowerCase().includes(buscaCambio.trim().toLowerCase()))
                        .slice(0, 25)
                        .map(x => (
                          <button key={x.clave} onClick={() => { toggleCambio(x.clave); setBuscaCambio(''); }}
                                  style={{ display: 'block', width: '100%', textAlign: 'left',
                                           padding: '7px 10px', background: 'none', border: 'none',
                                           borderBottom: `1px solid ${c.border}`, color: c.text,
                                           fontSize: 12.5, cursor: 'pointer' }}>
                            {x.nombre}
                            <span style={{ color: c.dim, fontSize: 11 }}> · {dondeVive(x)}</span>
                          </button>
                        ))}
                    </div>
                  )}

                  {cambios.length === 0 && (
                    <div style={{ fontSize: 11.5, color: c.yellow, marginBottom: 8, lineHeight: 1.4 }}>
                      Sin cambio, al cliente solo le queda quitarlo del pedido. Se pierde la venta.
                    </div>
                  )}
                  {cambios.length > 0 && enCombos && !cubreCombos && (
                    <div style={{ fontSize: 11.5, color: c.red, marginBottom: 8, lineHeight: 1.4 }}>
                      ⚠️ Ninguno de esos cambios existe adentro de los combos, así que
                      {' '}{p.combos.join(', ')} van a quedar sin poder pedirse. Agregá uno que
                      sí salga en combos.
                    </div>
                  )}
                  {cambios.length > 0 && p.suelto && !cubreSuelto && (
                    <div style={{ fontSize: 11.5, color: c.yellow, marginBottom: 8, lineHeight: 1.4 }}>
                      Ojo: ninguno de esos cambios se vende suelto, así que a quien lo pida solo
                      no le vamos a poder ofrecer nada.
                    </div>
                  )}

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
                      : 'No vuelve hasta que alguien lo prenda desde esta pantalla. Ojo: si nadie se acuerda, se queda escondido.'}
                  </div>

                  <button disabled={ocupado === p.clave} onClick={() => aplicar(p, true)}
                          style={{ ...btn(c.red), width: '100%' }}>
                    {ocupado === p.clave ? '…' : `🚫 Apagar ${p.nombre} en ${nombreSuc(sucSel)}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
