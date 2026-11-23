// ────────────────────────────────────────────────────────────────────
// Torre · Motoristas esperando (22-nov-2026, pedido de Cesar)
//
// Con la ruta fija el motorista sale solo cuando TODOS sus pedidos están
// listos. Si uno lleva 8+ min listo esperando a otro que sigue en cocina,
// la decisión es de la torre: dejarlo esperar o quitarle el pedido que falta
// (vuelve a «sin asignar» para dárselo a otro). Si nadie espera, no se muestra.
// ────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { db } from '../../supabase';

const REFRESH_MS = 30000;
const MIN_ESPERA = 8;

export default function MotoristasEsperando({ token, onCambio }) {
  const [lista, setLista] = useState([]);
  const [ocultos, setOcultos] = useState({});   // «Dejarlo esperar»: se calla hasta que cambie algo
  const [ocupado, setOcupado] = useState(null);
  const [msg, setMsg] = useState('');

  const cargar = useCallback(async () => {
    if (!token) return;
    const { data, error } = await db.rpc('torre_motoristas_esperando', { p_token: token, p_min: MIN_ESPERA });
    if (!error && Array.isArray(data)) setLista(data);
  }, [token]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cargar]);

  const clave = (m) => m.motorista_id + ':' + (m.en_cocina || []).map(x => x.id).join(',');
  const visibles = lista.filter(m => !ocultos[clave(m)]);
  if (visibles.length === 0 && !msg) return null;

  const quitar = async (m, p) => {
    setOcupado(p.id); setMsg('');
    const { error } = await db.rpc('torre_quitar_de_ruta', { p_token: token, p_delivery_id: p.id });
    setOcupado(null);
    if (error) { setMsg('❌ ' + error.message); return; }
    setMsg(`✅ ${p.cliente || p.numero_orden} quedó sin motorista. ${m.motorista} ya puede salir con lo suyo.`);
    await cargar();
    onCambio?.();
  };

  return (
    <div style={{ background: '#2a1d08', border: '1px solid #7a5a1c', borderRadius: 12, padding: '10px 12px', margin: '8px 0 12px' }}>
      <div style={{ fontWeight: 800, color: '#fcd34d', fontSize: 14, marginBottom: 6 }}>
        ⏳ Motoristas esperando pedidos de cocina ({visibles.length})
      </div>
      {visibles.map(m => (
        <div key={m.motorista_id} style={{ padding: '7px 0', borderTop: '1px solid #4a3812' }}>
          <div style={{ fontWeight: 700, color: '#f5f5f4', fontSize: 13.5 }}>
            {m.motorista || 'Motorista'} espera hace {m.min_espera} min
          </div>
          <div style={{ fontSize: 12, color: '#fde68a', marginTop: 2 }}>
            Listo: {(m.listos || []).map(x => x.cliente || x.numero_orden).join(', ')} · En cocina: {(m.en_cocina || []).map(x => x.cliente || x.numero_orden).join(', ')}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setOcultos(o => ({ ...o, [clave(m)]: true }))}
                    style={{ background: '#292524', color: '#e7e5e4', border: 0, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              Dejarlo esperar
            </button>
            {(m.en_cocina || []).map(p => (
              <button key={p.id} disabled={ocupado === p.id} onClick={() => quitar(m, p)}
                      style={{ background: '#7c2d12', color: '#fed7aa', border: 0, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                {ocupado === p.id ? '…' : `Quitar a ${p.cliente || p.numero_orden} de su ruta`}
              </button>
            ))}
          </div>
        </div>
      ))}
      {msg && <div style={{ fontSize: 12.5, color: '#fde68a', marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
