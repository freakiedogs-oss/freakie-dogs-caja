// ────────────────────────────────────────────────────────────────────
// Torre · Motoristas sin señal (12-nov-2026, pedido de Cesar)
//
// Lista solo a los motoristas en turno que tienen algún problema con el GPS:
// llevan 3+ min sin mandar ubicación, tienen la ubicación apagada, les falta
// el permiso «Permitir todo el tiempo», o no usan la app nativa (desde el
// navegador el GPS se corta con la pantalla bloqueada). Con botones para
// escribirles o llamarles en el momento. Si todos están bien, no se muestra.
// ────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { db } from '../../supabase';

const REFRESH_MS = 30000;
const SIN_SENAL_MIN = 3;

const tel503 = (t) => {
  const d = String(t || '').replace(/\D/g, '');
  return d.length === 8 ? `503${d}` : d;
};

export default function MotoristasSenal({ token }) {
  const [lista, setLista] = useState([]);

  const cargar = useCallback(async () => {
    if (!token) return;
    const { data, error } = await db.rpc('motoristas_senal', { p_token: token });
    if (!error && Array.isArray(data)) setLista(data);
  }, [token]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cargar]);

  const problemas = lista.map(m => {
    const p = [];
    if (m.min_sin_senal >= SIN_SENAL_MIN) p.push(`sin señal hace ${m.min_sin_senal} min`);
    if (m.gps_activo === false) p.push('ubicación apagada');
    if (m.permiso_siempre === false) p.push('falta «Permitir todo el tiempo»');
    if (m.bateria_ok === false) p.push('ahorro de batería activo');
    if (!m.app_nativa) p.push('no usa la app nueva');
    return { ...m, p };
  }).filter(m => m.p.length > 0)
    .sort((a, b) => b.min_sin_senal - a.min_sin_senal);

  if (problemas.length === 0) return null;

  const grave = (m) => m.min_sin_senal >= SIN_SENAL_MIN || m.gps_activo === false;

  return (
    <div style={{ background: '#1f0f0f', border: '1px solid #7f1d1d', borderRadius: 12, padding: '10px 12px', margin: '8px 0 12px' }}>
      <div style={{ fontWeight: 800, color: '#fca5a5', fontSize: 14, marginBottom: 6 }}>
        📍 Motoristas con problemas de GPS ({problemas.length})
      </div>
      {problemas.map(m => (
        <div key={m.empleado_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                                           borderTop: '1px solid #3b1515', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16 }}>{grave(m) ? '🔴' : '🟡'}</span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 700, color: '#f5f5f4', fontSize: 13.5 }}>
              {m.nombre || 'Motorista'}{m.con_pedidos ? ' · con pedidos' : ''}
            </div>
            <div style={{ fontSize: 12, color: '#fca5a5' }}>{m.p.join(' · ')}</div>
          </div>
          {m.telefono && (
            <>
              <a href={`https://wa.me/${tel503(m.telefono)}?text=${encodeURIComponent('Hola, la torre no te ve en el mapa. Abrí la app Freakie Drivers y revisá que la ubicación esté prendida, por favor 🙏')}`}
                 target="_blank" rel="noreferrer"
                 style={{ background: '#14532d', color: '#bbf7d0', borderRadius: 8, padding: '5px 9px', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}>
                WhatsApp
              </a>
              <a href={`tel:${m.telefono}`}
                 style={{ background: '#292524', color: '#e7e5e4', borderRadius: 8, padding: '5px 9px', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}>
                Llamar
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
