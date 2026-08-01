// ────────────────────────────────────────────────────────────────────
// Torre · Ganadores del juego
// Quién hizo la marca más alta cada día, con su pedido y su teléfono,
// para cotejar el posteo y entregar el premio. Se puede marcar entregado.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';
const c = { card: '#1a1a1a', border: '#2a2a2a', red: '#e63946', green: '#4ade80',
            yellow: '#fbbf24', text: '#f0f0f0', dim: '#8a8a8a' };
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function fechaBonita(f) {
  const d = new Date(f + 'T12:00:00');
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const dif = Math.round((hoy - d) / 86400000);
  if (dif === 0) return 'Hoy';
  if (dif === 1) return 'Ayer';
  return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function TabJuego({ show = () => {} }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState('');
  const [ocupado, setOcupado] = useState(null);

  const cargar = () => db.rpc('torre_ganadores_juego', { p_token: token, p_dias: 30 })
    .then(({ data, error }) => { if (error) setErr(error.message); else setDatos(data); });

  useEffect(() => { if (token) cargar(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcar = async (g) => {
    setOcupado(g.score_id);
    try {
      const { error } = await db.rpc('torre_marcar_premiado', {
        p_token: token, p_score_id: g.score_id, p_premiado: !g.premiado,
      });
      if (error) throw error;
      show(g.premiado ? 'Marcado como no entregado' : '🎁 Premio entregado');
      await cargar();
    } catch (e) { show('❌ ' + (e.message || 'No se pudo')); }
    finally { setOcupado(null); }
  };

  if (!token) return <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>Entrá con tu PIN en 📥 Pedidos para ver esta sección.</div>;
  if (err) return <div style={{ color: c.red, padding: 20 }}>{err}</div>;
  if (!datos) return <div style={{ color: c.dim, padding: 20 }}>Cargando…</div>;

  const { resumen, dias } = datos;

  return (
    <div>
      <div style={{ fontSize: 13, color: c.dim, marginBottom: 14, lineHeight: 1.5 }}>
        La marca más alta de cada día. Para entregar el combo, pedile que muestre su posteo
        con <b style={{ color: c.text }}>el número de pedido</b> y la etiqueta a @freakiedogs.
      </div>

      {/* Cuánto se está usando el juego, en total */}
      <div style={S.kpis}>
        <div style={S.kpi}>
          <div style={S.kpiN}>{resumen.partidas}</div>
          <div style={S.kpiT}>partidas jugadas</div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiN}>{resumen.jugadores}</div>
          <div style={S.kpiT}>clientes distintos</div>
        </div>
        <div style={S.kpi}>
          <div style={{ ...S.kpiN, color: c.green }}>
            {resumen.pct != null ? `${resumen.pct}%` : '—'}
          </div>
          <div style={S.kpiT}>de {resumen.pedidos} pedidos jugaron</div>
        </div>
      </div>
      {resumen.sin_pedido > 0 && (
        <div style={{ fontSize: 11.5, color: c.dim, marginTop: -4, marginBottom: 14 }}>
          Además {resumen.sin_pedido} partida(s) de gente sin pedido — no cuentan para el porcentaje.
        </div>
      )}

      {dias.length === 0 ? (
        <div style={{ color: c.dim, textAlign: 'center', padding: 34 }}>
          🎮 Todavía nadie jugó.<br />
          <span style={{ fontSize: 12 }}>Las marcas aparecen acá apenas los clientes empiecen a jugar mientras esperan.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {dias.map(d => {
            const g = d.ganador || {};
            return (
            <div key={d.fecha} style={{ background: c.card, border: `1px solid ${c.border}`,
                                           borderLeft: `3px solid ${g.premiado ? c.green : c.yellow}`,
                                           borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: c.dim }}>{fechaBonita(d.fecha)}</span>
                <span style={{ fontSize: 15, fontWeight: 800 }}>🏆 {g.alias || '—'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 17, fontWeight: 800, color: c.yellow }}>{g.score}</span>
              </div>

              {/* Cómo se movió el juego ese día */}
              <div style={S.kpisDia}>
                <span><b style={{ color: c.text }}>{d.partidas}</b> partidas</span>
                <span><b style={{ color: c.text }}>{d.jugadores}</b> de {d.pedidos} pedidos</span>
                <span style={{ color: c.green, fontWeight: 700 }}>
                  {d.pct != null ? `${d.pct}%` : '—'}
                </span>
              </div>

              <div style={{ fontSize: 12, color: c.dim, marginTop: 6, lineHeight: 1.6 }}>
                {g.pedido
                  ? <>Pedido <b style={{ color: c.text }}>{g.pedido}</b>
                      {g.cliente ? ` · ${g.cliente}` : ''}{g.total_pedido ? ` · ${fmt(g.total_pedido)}` : ''}</>
                  : <span style={{ color: c.yellow }}>⚠️ Jugó sin pedido — no puede reclamar premio</span>}
                {g.telefono && <><br />📞 {g.telefono}</>}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {g.telefono && (
                  <a href={`https://wa.me/503${String(g.telefono).replace(/\D/g, '')}?text=${encodeURIComponent(
                        `¡Felicidades ${g.alias}! 🏆 Ganaste el combo del día en Freakies Carreritas con ${g.score} puntos. Mostranos tu posteo con el pedido ${g.pedido || ''} y pasá a reclamarlo 🌭`)}`}
                     target="_blank" rel="noopener"
                     style={{ ...btn('#25D366'), textDecoration: 'none' }}>💬 Avisarle</a>
                )}
                {g.pedido && (
                  <button disabled={ocupado === g.score_id} onClick={() => marcar(g)}
                    style={btn(g.premiado ? '#333' : c.red)}>
                    {ocupado === g.score_id ? '…' : g.premiado ? '✓ Premio entregado' : '🎁 Marcar entregado'}
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const S = {
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 },
  kpi: { background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: '13px 12px', textAlign: 'center' },
  kpiN: { fontSize: 24, fontWeight: 800, color: c.yellow, lineHeight: 1.1 },
  kpiT: { fontSize: 11, color: c.dim, marginTop: 4, lineHeight: 1.35 },
  kpisDia: { display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: c.dim,
             marginTop: 9, paddingTop: 9, borderTop: `1px solid ${c.border}` },
};

const btn = (bg, fg = '#fff') => ({
  padding: '8px 13px', borderRadius: 8, background: bg, color: fg, border: 'none',
  cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
});
