import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../supabase';

// ── PEDIDO ANTES DE ABRIR (17-nov-2026, Cesar) ───────────────────────
// Para lo que la sucursal necesita ANTES de abrir: se pide de 9 p. m. a 11 a. m.,
// máximo 2 por mes por sucursal, de cualquier producto. Casa Matriz lo prepara y
// lo manda por InDrive o Uber (pega el link y el costo). En la BD es
// pedidos_sucursal.tipo = 'urgente' (crear_pedido_antes_abrir).
const n = (v) => Number(v) || 0;
const sinTildes = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nuevoToken = () => {
  try { if (window.crypto?.randomUUID) return window.crypto.randomUUID(); } catch (e) { /* sigue */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const horaTxt = (d) => d.toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', timeZone: 'America/El_Salvador' });

// Horas para elegir: cada 30 min desde 30 min después de ahora, hasta el mediodía del día de apertura.
function horasPosibles() {
  const out = [];
  let t = new Date(Math.ceil((Date.now() + 30 * 60000) / (30 * 60000)) * 30 * 60000);
  for (let i = 0; i < 32 && out.length < 12; i++, t = new Date(t.getTime() + 30 * 60000)) {
    const h = Number(t.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/El_Salvador' }));
    if (h >= 6 && h <= 12) out.push(t);
  }
  return out;
}

export default function PedidoAntesAbrirModal({ sucursalId, sucursalNombre, user, onClose, onDone }) {
  const [estado, setEstado] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const [para, setPara] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tokenRef = useRef(nuevoToken());
  const horas = useMemo(horasPosibles, []);

  useEffect(() => {
    db.rpc('antes_abrir_estado', { p_sucursal_id: sucursalId }).then(({ data }) => setEstado(data || null));
    db.rpc('antes_abrir_catalogo').then(({ data, error }) => {
      if (error) setErr('No se pudo cargar la lista de productos: ' + error.message);
      setCatalogo(Array.isArray(data) ? data : []);
    });
  }, [sucursalId]);
  useEffect(() => { tokenRef.current = nuevoToken(); }, [JSON.stringify(sel.map(s => [s.producto_id, s.empaques])), para, nota]);

  const res = useMemo(() => {
    if (!catalogo || q.trim().length < 2) return [];
    const t = sinTildes(q.trim());
    return catalogo.filter(p => sinTildes(p.nombre).includes(t) && !sel.some(s => s.producto_id === p.producto_id)).slice(0, 12);
  }, [q, catalogo, sel]);

  const add = (p) => { setSel(s => [...s, { ...p, empaques: '1' }]); setQ(''); };
  const setEmp = (id, v) => setSel(s => s.map(x => x.producto_id === id ? { ...x, empaques: v } : x));
  const paso = (id, d) => setSel(s => s.map(x => x.producto_id === id ? { ...x, empaques: String(Math.max(1, Math.round(n(x.empaques)) + d)) } : x));
  const quitar = (id) => setSel(s => s.filter(x => x.producto_id !== id));

  const bloqueado = estado && (!estado.abierto || estado.quedan <= 0);
  const mes = MESES[new Date(Date.now() - 6 * 3600000).getUTCMonth()];

  const enviar = async () => {
    setErr('');
    if (sel.length === 0) { setErr('Agregá al menos un producto.'); return; }
    if (!para) { setErr('Elegí para qué hora lo necesitan.'); return; }
    const malos = sel.filter(s => !(n(s.empaques) > 0));
    if (malos.length) { setErr(`Revisá la cantidad de: ${malos.map(m => m.nombre).join(', ')}.`); return; }
    setBusy(true);
    const { data, error } = await db.rpc('crear_pedido_antes_abrir', {
      p_sucursal_id: sucursalId, p_usuario_id: user.id,
      p_items: sel.map(s => ({ producto_id: s.producto_id, empaques: n(s.empaques) })),
      p_para: para, p_nota: nota.trim() || null, p_token: tokenRef.current,
    });
    setBusy(false);
    if (error) { setErr('No se pudo enviar. Revisá la señal y tocá Enviar otra vez: no se va a duplicar.'); return; }
    if (!data?.ok) { setErr(data?.error || 'No se pudo enviar.'); return; }
    onDone(data.duplicado ? '🌅 Ese pedido ya estaba enviado; no se duplicó.'
      : `🌅 Pedido antes de abrir enviado a Casa Matriz · te queda${data.quedan === 1 ? '' : 'n'} ${data.quedan} este mes`);
  };

  const chip = (on) => ({ padding: '7px 11px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: on ? '1px solid #d97706' : '1px solid #333', background: on ? '#d97706' : '#111', color: on ? '#fff' : '#bbb' });
  const stepBtn = { width: 34, height: 34, borderRadius: 8, border: '1px solid #333', background: '#111', color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a1a', border: '1px solid #4a3410', borderRadius: 14, width: '100%', maxWidth: 540, maxHeight: '92vh', display: 'flex', flexDirection: 'column', color: '#f0f0f0' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fcd34d' }}>🌅 Pedido antes de abrir</div>
            {estado && (
              <span style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 10px', borderRadius: 999, fontWeight: 700,
                             background: estado.quedan > 0 ? '#3b2a0a' : '#3a1414', color: estado.quedan > 0 ? '#fde68a' : '#fca5a5' }}>
                Te queda{estado.quedan === 1 ? '' : 'n'} {estado.quedan} de {estado.limite} en {mes}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 3 }}>
            {sucursalNombre} · se pide de {estado?.desde || '9:00 p. m.'} a {estado?.hasta || '11:00 a. m.'} · Casa Matriz lo manda por InDrive o Uber
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px' }}>
          {estado && !estado.abierto && (
            <div style={{ background: '#2a1f0a', border: '1px solid #7c5a10', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 13, color: '#fcd34d' }}>
              ⏰ Ahora está cerrado. Se abre a las <b>{estado.desde}</b> y se puede pedir hasta las <b>{estado.hasta}</b>. Si es algo que no puede esperar, usá el 🚨 Pedido SOS.
            </div>
          )}
          {estado && estado.abierto && estado.quedan <= 0 && (
            <div style={{ background: '#2a1111', border: '1px solid #7f1d1d', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 13, color: '#fca5a5' }}>
              Ya usaste tus {estado.limite} pedidos antes de abrir de {mes}. Vuelven el 1 del próximo mes. Para algo urgente usá el 🚨 Pedido SOS.
            </div>
          )}

          <div style={{ fontSize: 12, color: '#aaa', fontWeight: 700, marginBottom: 6 }}>1. ¿Qué necesitan?</div>
          <input value={q} onChange={e => setQ(e.target.value)} disabled={!catalogo || bloqueado}
            placeholder={catalogo ? 'Buscar cualquier producto (mín. 2 letras)…' : 'Cargando productos…'}
            style={{ width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 14 }} />
          {res.length > 0 && (
            <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', border: '1px solid #2a2a2a', borderRadius: 8 }}>
              {res.map(p => (
                <button key={p.producto_id} type="button" onClick={() => add(p)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid #222', color: '#eee', padding: '9px 10px', cursor: 'pointer', fontSize: 13.5 }}>
                  {p.nombre}<div style={{ color: '#888', fontSize: 11.5 }}>{p.presentacion}</div>
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {sel.length === 0 && <div style={{ color: '#666', fontSize: 12.5, textAlign: 'center', padding: 12 }}>Todavía no agregaste productos.</div>}
            {sel.map(s => (
              <div key={s.producto_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid #222', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px', fontSize: 13.5, fontWeight: 600 }}>{s.nombre}</div>
                <button type="button" style={stepBtn} onClick={() => paso(s.producto_id, -1)}>−</button>
                <input type="number" inputMode="decimal" min="0.5" step="0.5" value={s.empaques} onChange={e => setEmp(s.producto_id, e.target.value)}
                  style={{ width: 58, height: 34, boxSizing: 'border-box', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 700, textAlign: 'center' }} />
                <button type="button" style={stepBtn} onClick={() => paso(s.producto_id, 1)}>+</button>
                <span style={{ fontSize: 12, color: '#ccc' }}>× {s.presentacion}</span>
                <button type="button" onClick={() => quitar(s.producto_id)} aria-label="Quitar" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: '#aaa', fontWeight: 700, margin: '14px 0 6px' }}>2. ¿Para qué hora lo necesitan?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {horas.map(h => (
              <button key={h.toISOString()} type="button" disabled={bloqueado} style={chip(para === h.toISOString())}
                onClick={() => setPara(h.toISOString())}>{horaTxt(h)}</button>
            ))}
            {horas.length === 0 && <span style={{ fontSize: 12, color: '#888' }}>Se puede elegir hora de 6:00 a. m. a 12:00 m.</span>}
          </div>

          <div style={{ fontSize: 12, color: '#aaa', fontWeight: 700, margin: '14px 0 6px' }}>3. Nota <span style={{ fontWeight: 400, color: '#777' }}>(opcional)</span></div>
          <input value={nota} onChange={e => setNota(e.target.value)} maxLength={140} disabled={bloqueado} placeholder="Ej.: no llegó el queso en el pedido de ayer"
            style={{ width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '9px 12px', color: '#fff', fontSize: 13 }} />
        </div>

        {err && <div style={{ padding: '8px 16px', color: '#fca5a5', fontSize: 13 }}>{err}</div>}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a2a', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-sm" disabled={busy || bloqueado || sel.length === 0} onClick={enviar}
            style={{ background: '#d97706', color: '#fff', fontWeight: 700 }}>
            {busy ? 'Enviando…' : `Pedir a Casa Matriz${estado ? ` (usa 1 de ${estado.limite})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
