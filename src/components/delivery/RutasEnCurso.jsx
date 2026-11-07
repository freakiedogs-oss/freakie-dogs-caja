// ────────────────────────────────────────────────────────────────────
// Torre · Viajes en curso (7-nov-2026, pedido de Cesar)
//
// El orden de entrega lo pone el sistema solo (fn_ruta_recalcular, fórmula
// "balance": distancia + espera). Karina no tiene que hacer nada; este panel
// es para VER cada viaje con su 1°, 2°, 3° y la hora estimada de cada
// parada. Las flechas ↑↓ son solo para emergencias (calle cerrada, cliente
// que pide esperar) y quedan registradas con el motivo.
// También avisa cuando un pedido lleva más de 10 min listo sin salir.
// ────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { db } from '../../supabase';

const REFRESH_MS = 15000;
const hora = (iso) => iso
  ? new Date(iso).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit' })
  : '';

export default function RutasEnCurso({ token, show = () => {} }) {
  const [data, setData] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    const { data: res, error } = await db.rpc('torre_rutas_activas', { p_token: token });
    if (!error && res?.ok) setData(res);
  }, [token]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cargar]);

  const mover = async (parada, nuevaPos) => {
    const motivo = window.prompt('¿Por qué cambiás el orden? (queda registrado)', '');
    if (motivo === null) return;
    setOcupado(parada.id);
    try {
      const { error } = await db.rpc('torre_cambiar_orden', {
        p_token: token, p_delivery_id: parada.id, p_posicion: nuevaPos, p_motivo: motivo,
      });
      if (error) throw error;
      show?.('✅ Orden cambiado. El motorista ya lo ve.');
      await cargar();
    } catch (e) {
      show?.('❌ ' + (e.message || 'No se pudo cambiar el orden'));
    } finally { setOcupado(null); }
  };

  const rutas = (data?.rutas || []).filter(r => (r.paradas || []).length > 1);
  const esperando = data?.esperando || [];
  if (!rutas.length && !esperando.length) return null;

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <b style={{ fontSize: 14 }}>🗺️ Viajes en curso</b>
        <span style={S.auto}>● Orden automático</span>
      </div>

      {esperando.map(e => (
        <div key={e.numero_orden} style={S.alerta}>
          ⏱ <b>{e.sucursal}:</b> {e.numero_orden} lleva {e.min_lista} min listo
          {e.motorista ? ` (asignado a ${e.motorista})` : ' sin motorista'}. Que salga ya.
        </div>
      ))}

      {rutas.map(r => {
        const pendientes = r.paradas.filter(p => p.estado !== 'entregada');
        const km = null;
        return (
          <div key={r.ruta_id} style={S.viaje}>
            <div style={S.vh}>
              <span>
                <b style={{ fontSize: 13.5 }}>🛵 {r.motorista}</b>
                <span style={S.dim}> · {r.sucursal} · {r.paradas.length} entregas{km ? ` · ${km} km` : ''}</span>
                {r.manual && <span style={S.manual}>✋ cambiado a mano</span>}
              </span>
              <span style={r.estado === 'en_camino' ? S.estC : S.estS}>
                {r.estado === 'en_camino' ? 'En camino' : 'Por salir'}
              </span>
            </div>

            {r.paradas.map(p => {
              const hecho = p.estado === 'entregada';
              const idx = pendientes.findIndex(x => x.id === p.id);
              return (
                <div key={p.id} style={S.stop}>
                  <span style={hecho ? S.nOk : S.n}>{hecho ? '✓' : p.orden}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.numero_orden} · {(p.direccion || '').replace(/^\[[^\]]*\]\s*/, '')}
                    </span>
                    <small style={S.dim}>
                      {hecho ? `Entregado ${hora(p.entregado_at)} · esperó ${p.espera_min} min`
                             : `Pidió hace ${p.espera_min} min · ${p.metodo_pago || 'efectivo'}`}
                    </small>
                  </span>
                  {!hecho && p.eta_at && <span style={S.eta}>~{hora(p.eta_at)}</span>}
                  {!hecho && pendientes.length > 1 && (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button disabled={idx === 0 || ocupado === p.id} onClick={() => mover(p, idx)}
                              style={S.flecha} title="Subir (solo emergencias)">↑</button>
                      <button disabled={idx === pendientes.length - 1 || ocupado === p.id} onClick={() => mover(p, idx + 2)}
                              style={S.flecha} title="Bajar (solo emergencias)">↓</button>
                    </span>
                  )}
                </div>
              );
            })}
            <div style={S.pie}>
              {r.fijada
                ? 'El orden quedó fijo con la primera entrega. El motorista no lo puede cambiar.'
                : r.estado === 'en_camino'
                  ? 'El motorista no lo puede cambiar.'
                  : 'Si entra otro pedido para este motorista antes de que salga, el orden se recalcula solo.'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const S = {
  wrap: { marginTop: 14, background: '#17140f', border: '1px solid #3a342e', borderRadius: 12, padding: 12, color: '#f5efe6' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  auto: { background: '#14361f', color: '#7ee2a0', borderRadius: 20, padding: '3px 9px', fontSize: 11 },
  alerta: { background: '#3b1416', border: '1px solid #7a2a30', color: '#fecaca', borderRadius: 8, padding: '7px 9px',
            fontSize: 12, marginBottom: 9 },
  viaje: { background: '#1f1c19', border: '1px solid #3a342e', borderRadius: 10, padding: 10, marginBottom: 9 },
  vh: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  dim: { color: '#9a9088', fontSize: 11 },
  manual: { marginLeft: 6, background: '#3b2f0a', color: '#FFD900', borderRadius: 6, padding: '1px 6px', fontSize: 10.5 },
  estC: { background: '#3b2f0a', color: '#FFD900', borderRadius: 6, padding: '2px 7px', fontSize: 11, whiteSpace: 'nowrap' },
  estS: { background: '#0f2b3d', color: '#7cc8f5', borderRadius: 6, padding: '2px 7px', fontSize: 11, whiteSpace: 'nowrap' },
  stop: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #2a2622', fontSize: 12.5 },
  n: { width: 24, height: 24, borderRadius: '50%', background: '#FFD900', color: '#1a1200', fontWeight: 800,
       display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12.5 },
  nOk: { width: 24, height: 24, borderRadius: '50%', background: '#2f6b45', color: '#d6f5e0', fontWeight: 800,
         display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12.5 },
  eta: { color: '#cfc6bc', fontSize: 11.5, whiteSpace: 'nowrap' },
  flecha: { width: 24, height: 18, lineHeight: '16px', padding: 0, borderRadius: 5, border: '1px solid #3a342e',
            background: '#2a2622', color: '#cfc6bc', cursor: 'pointer', fontSize: 11 },
  pie: { color: '#9a9088', fontSize: 10.5, marginTop: 6 },
};
