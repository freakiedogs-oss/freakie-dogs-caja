// ────────────────────────────────────────────────────────────────────
// Torre · Recordatorios del regalo de bienvenida (17-nov-2026, Cesar)
// Primer pedido entregado → Queso Frito gratis en el siguiente (21 días).
// Karina manda dos avisos por WhatsApp, solo a quien aceptó en su seguimiento:
//   · día 12: «¿Se te antoja otra vez?»
//   · faltando 2 días: «Te quedan 2 días»
// El botón abre WhatsApp con el número y el mensaje listos (lo envía ella,
// desde el número del negocio, a clientes que ya le escribieron) y marca la
// fila como enviada. Si el cliente pide antes, desaparece solo de la lista.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react';
import { db } from '../../supabase';
import { URL_DELIVERY } from '../../config';

const TOKEN_KEY = 'freakie_torre_token';
const c = {
  card: '#1a1a1a', panel: '#151515', border: '#2a2a2a',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', text: '#f0f0f0', dim: '#8a8a8a',
};
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fechaCorta = (d) => { const x = new Date(`${d}T12:00:00`); return `${DIAS[x.getDay()]} ${x.getDate()} ${MESES[x.getMonth()]}`; };

function mensaje(r, cual) {
  const n = primerNombre(r.nombre);
  if (cual === 1) {
    return `Hola${n ? ` ${n}` : ''}, ¿se te antoja Freakie otra vez?☺️\n\n`
      + `Tu *Queso Frito de regalo* sigue esperándote🫶🏼 Pedí cuando quieras y se agrega solito a tu pedido.\n\n${URL_DELIVERY}`;
  }
  return `Hola${n ? ` ${n}` : ''}☺️ *te quedan 2 días* para usar tu Queso Frito gratis (vence el ${fechaCorta(r.vence)}).\n\n`
    + `Válido en pedidos desde $${Number(r.minimo).toFixed(2)}🙌🏻\n\n${URL_DELIVERY}`;
}

export default function TabRecordatorios({ show = () => {} }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [prev, setPrev] = useState(null);   // {r, cual} para la vista previa

  const cargar = useCallback(async () => {
    if (!token) return;
    const { data: d, error } = await db.rpc('torre_regalo_recordatorios', { p_token: token });
    if (error) { setErr(error.message); return; }
    setErr(''); setData(d);
  }, [token]);
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [cargar]);

  const marcar = async (r, accion) => {
    const { error } = await db.rpc('torre_regalo_marcar', { p_token: token, p_id: r.id, p_accion: accion });
    if (error) { show('❌ ' + error.message); return; }
    cargar();
  };
  const enviar = (r, cual) => {
    const num = String(r.telefono || '').replace(/\D/g, '').slice(-8);
    window.open(`https://wa.me/503${num}?text=${encodeURIComponent(mensaje(r, cual))}`, '_blank', 'noopener');
    marcar(r, cual === 1 ? 'enviado1' : 'enviado2');
    show(`💬 Recordatorio para ${primerNombre(r.nombre) || num} abierto en WhatsApp`);
  };

  if (!token) {
    return <div style={{ color: c.dim, padding: 20 }}>Entrá primero a la pestaña 📥 Pedidos con tu PIN.</div>;
  }
  if (err) return <div style={{ color: c.red, padding: 20 }}>{err}</div>;
  if (!data) return <div style={{ color: c.dim, padding: 20 }}>Cargando…</div>;

  const porEnviar = (data.primero?.length || 0) + (data.ultimo?.length || 0);
  const Kpi = ({ t, v, col }) => (
    <div style={{ flex: '1 1 160px', background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: '10px 14px' }}>
      <div style={{ fontSize: 11.5, color: c.dim }}>{t}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: col || c.text }}>{v}</div>
    </div>
  );
  const Lista = ({ titulo, sub, filas, cual }) => (
    <div style={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${c.border}`, display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <b style={{ fontSize: 13.5 }}>{titulo}</b><span style={{ fontSize: 12, color: c.dim }}>{sub}</span>
        <span style={{ marginLeft: 'auto', fontWeight: 800, color: c.yellow }}>{filas.length}</span>
      </div>
      {filas.length === 0
        ? <div style={{ color: '#555', fontSize: 12.5, padding: 14, textAlign: 'center' }}>Nadie para hoy 👍</div>
        : filas.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: `1px solid ${c.border}`, flexWrap: 'wrap' }}
               onMouseEnter={() => setPrev({ r, cual })}>
            <div style={{ flex: '1 1 170px', minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.nombre || '—'}</div>
              <div style={{ fontSize: 11.5, color: c.dim }}>{r.sucursal || '—'}</div>
            </div>
            <div style={{ flex: '1 1 150px', fontSize: 12, color: c.dim }}>
              {cual === 1 ? <>1er pedido: {fechaCorta(r.ganado)}{r.hora_pedido ? ` · ${r.hora_pedido}` : ''}</> : <>Vence: {fechaCorta(r.vence)}</>}
            </div>
            <button onClick={() => enviar(r, cual)}
              style={{ background: '#0d3a1f', border: `1px solid ${c.green}`, color: c.green, borderRadius: 8, padding: '7px 12px',
                       fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>
              Enviar por WhatsApp
            </button>
            <button onClick={() => marcar(r, 'omitir')}
              style={{ background: '#242424', border: '1px solid #3a3a3a', color: c.dim, borderRadius: 8, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}>
              Omitir
            </button>
          </div>
        ))}
    </div>
  );

  const vista = prev || (data.primero?.[0] ? { r: data.primero[0], cual: 1 } : data.ultimo?.[0] ? { r: data.ultimo[0], cual: 2 } : null);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Kpi t="Por enviar hoy" v={porEnviar} col={c.yellow} />
        <Kpi t="Enviados hoy" v={data.enviados_hoy ?? 0} col={c.green} />
        <Kpi t="Regalos activos" v={data.activos ?? 0} />
        <Kpi t="Ganados / canjeados (7 días)" v={`${data.ganados_semana ?? 0} / ${data.canjeados_semana ?? 0}`} />
        <Kpi t="Canjearon después del aviso" v={data.pct_canje_tras_aviso != null ? `${data.pct_canje_tras_aviso}%` : '—'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(260px,1fr)', gap: 14, alignItems: 'start' }}>
        <div>
          <Lista titulo="Primer recordatorio" sub="· día 12 · «¿Se te antoja otra vez?»" filas={data.primero || []} cual={1} />
          <Lista titulo="Último aviso" sub="· faltando 2 días · «Te quedan 2 días»" filas={data.ultimo || []} cual={2} />
        </div>
        <div style={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14 }}>
          <b style={{ fontSize: 13.5 }}>Al tocar «Enviar por WhatsApp»</b>
          <div style={{ fontSize: 12, color: c.dim, margin: '4px 0 10px' }}>
            Se abre WhatsApp con el número y el mensaje listos. Solo tocás enviar y la fila queda marcada.
          </div>
          {vista ? (
            <div style={{ background: '#0b141a', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12, color: '#8696a0', marginBottom: 6 }}>{vista.r.nombre} · {vista.r.telefono}</div>
              <div style={{ background: '#005c4b', color: '#e9edef', borderRadius: 8, padding: '8px 10px', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                {mensaje(vista.r, vista.cual).replace(/\*/g, '')}
              </div>
            </div>
          ) : <div style={{ color: '#555', fontSize: 12.5 }}>Cuando haya alguien para avisar, acá ves el mensaje.</div>}
          <div style={{ fontSize: 11.5, color: c.dim, marginTop: 10, lineHeight: 1.45 }}>
            Solo aparecen clientes que aceptaron los avisos y que todavía no canjearon. Si piden antes, desaparecen solos.
            Mandá solo a quienes ya tienen chat con el negocio: mensajes masivos a números nuevos pueden bloquear el WhatsApp.
          </div>
        </div>
      </div>
    </div>
  );
}
