import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES } from '../../config';

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
};
const cardStyle = { background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const btnPrimary = { width: '100%', padding: 14, borderRadius: 10, background: c.red, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, transition: '0.15s' };

// Haversine — distancia en metros entre dos coords
function calcDistancia(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function MiAsistencia({ user }) {
  const [tab, setTab] = useState('marcar');
  const [gps, setGps] = useState(null);
  const [gpsErr, setGpsErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [todayRecord, setTodayRecord] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [sucursal, setSucursal] = useState(null);
  const [loading, setLoading] = useState(true);

  const hoy = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0];
  const storeName = STORES[user.store_code] || user.store_code || '';

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) { setGpsErr('GPS no disponible'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => setGpsErr(e.code === 1 ? 'Permiso GPS denegado' : 'Error obteniendo GPS'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Coordenadas de la sucursal
      const { data: suc } = await db.from('sucursales')
        .select('id, nombre, lat, lng, radio_metros')
        .eq('store_code', user.store_code)
        .maybeSingle();
      setSucursal(suc);

      const { data: hoyData } = await db.from('asistencia')
        .select('*').eq('usuario_id', user.id).eq('fecha', hoy).maybeSingle();
      setTodayRecord(hoyData);

      const { data: hist } = await db.from('asistencia')
        .select('*').eq('usuario_id', user.id)
        .order('fecha', { ascending: false }).limit(14);
      setHistorial(hist || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [user.id, user.store_code, hoy]);

  useEffect(() => { load(); }, [load]);

  const distanciaInfo = () => {
    if (!gps || !sucursal?.lat) return null;
    const dist = calcDistancia(gps.lat, gps.lng, sucursal.lat, sucursal.lng);
    const dentro = dist <= (sucursal.radio_metros || 200);
    return { dist, dentro, radio: sucursal.radio_metros || 200 };
  };

  const marcar = async (tipo) => {
    if (!gps) return;
    setSaving(true);
    setMsg(null);

    const dInfo = distanciaInfo();
    const fueraGeofence = dInfo ? !dInfo.dentro : false;

    try {
      if (tipo === 'entrada') {
        const { error } = await db.from('asistencia').insert({
          usuario_id: user.id,
          fecha: hoy,
          hora_entrada: new Date().toISOString(),
          gps_entrada: gps,
          sucursal: user.store_code,
          distancia_entrada_m: dInfo?.dist ?? null,
          fuera_geofence: fueraGeofence,
          alerta_rrhh: fueraGeofence,
        });
        if (error) throw error;
        setMsg({ ok: !fueraGeofence, warn: fueraGeofence, text: fueraGeofence ? `⚠️ Entrada registrada pero estás a ${dInfo.dist}m del local (límite: ${dInfo.radio}m)` : '✓ Entrada registrada correctamente' });
      } else {
        const { error } = await db.from('asistencia').update({
          hora_salida: new Date().toISOString(),
          gps_salida: gps,
          distancia_salida_m: dInfo?.dist ?? null,
        }).eq('usuario_id', user.id).eq('fecha', hoy);
        if (error) throw error;
        setMsg({ ok: true, text: '✓ Salida registrada' });
      }
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Error al guardar' });
    }
    setSaving(false);
  };

  const fmtTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  };

  const dInfo = distanciaInfo();

  return (
    <div style={{ padding: '16px 12px', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>📍 Mi Asistencia</div>
        <div style={{ fontSize: 13, color: c.textDim, marginTop: 2 }}>{user.nombre} · {storeName}</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${c.border}`, marginBottom: 16 }}>
        {[{ id: 'marcar', label: 'Marcar' }, { id: 'historial', label: 'Historial' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.id ? c.red : c.textDim, fontSize: 14, fontWeight: tab === t.id ? 700 : 400,
            borderBottom: tab === t.id ? `2px solid ${c.red}` : '2px solid transparent', transition: '0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando...</div>
      ) : tab === 'marcar' ? (
        <div>
          {/* GPS + Distancia */}
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: gps ? (dInfo ? (dInfo.dentro ? c.green : c.orange) : c.green) : gpsErr ? c.red : c.yellow }} />
            <div style={{ fontSize: 13, color: c.textDim, lineHeight: 1.4 }}>
              {!gps && !gpsErr && 'Obteniendo GPS...'}
              {gpsErr && <span style={{ color: c.red }}>{gpsErr}</span>}
              {gps && !dInfo && `GPS activo (±${gps.acc}m)`}
              {gps && dInfo && (
                <span>
                  GPS activo · <span style={{ color: dInfo.dentro ? c.green : c.orange, fontWeight: 600 }}>
                    {dInfo.dist}m del local
                  </span>
                  {' '}
                  <span style={{ color: dInfo.dentro ? c.green : c.orange }}>
                    {dInfo.dentro ? `✓ dentro del rango (${dInfo.radio}m)` : `⚠️ fuera del rango (${dInfo.radio}m)`}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Hoy */}
          <div style={cardStyle}>
            <div style={{ fontSize: 13, color: c.textDim, marginBottom: 8 }}>Hoy — {hoy}</div>
            {todayRecord ? (
              <div style={{ display: 'flex', gap: 24 }}>
                <div>
                  <div style={{ fontSize: 11, color: c.textDim }}>Entrada</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: c.green }}>{fmtTime(todayRecord.hora_entrada)}</div>
                  {todayRecord.distancia_entrada_m != null && (
                    <div style={{ fontSize: 11, color: todayRecord.fuera_geofence ? c.orange : c.textDim }}>
                      {todayRecord.distancia_entrada_m}m del local
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: c.textDim }}>Salida</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: todayRecord.hora_salida ? c.red : c.textOff }}>{fmtTime(todayRecord.hora_salida)}</div>
                  {todayRecord.distancia_salida_m != null && (
                    <div style={{ fontSize: 11, color: c.textDim }}>{todayRecord.distancia_salida_m}m del local</div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: c.textOff }}>Sin registro hoy</div>
            )}
          </div>

          {/* Botón */}
          {!todayRecord ? (
            <button onClick={() => marcar('entrada')} disabled={saving || !gps}
              style={{ ...btnPrimary, opacity: saving || !gps ? 0.5 : 1, background: c.greenDark }}>
              {saving ? 'Guardando...' : '📍 Marcar Entrada'}
            </button>
          ) : !todayRecord.hora_salida ? (
            <button onClick={() => marcar('salida')} disabled={saving || !gps}
              style={{ ...btnPrimary, opacity: saving || !gps ? 0.5 : 1 }}>
              {saving ? 'Guardando...' : '🚪 Marcar Salida'}
            </button>
          ) : (
            <div style={{ ...cardStyle, textAlign: 'center', borderColor: c.greenDark }}>
              <div style={{ fontSize: 14, color: c.green, fontWeight: 600 }}>✓ Jornada completa</div>
            </div>
          )}

          {msg && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 8, fontSize: 13, lineHeight: 1.5,
              background: msg.warn ? 'rgba(249,115,22,0.1)' : msg.ok ? 'rgba(74,222,128,0.1)' : 'rgba(230,57,70,0.1)',
              color: msg.warn ? c.orange : msg.ok ? c.green : c.red, border: `1px solid ${msg.warn ? c.orange : msg.ok ? c.greenDark : c.red}` }}>
              {msg.text}
            </div>
          )}
        </div>
      ) : (
        /* Historial */
        <div>
          {historial.length === 0 ? (
            <div style={{ textAlign: 'center', color: c.textOff, padding: 40 }}>Sin registros</div>
          ) : historial.map((r, i) => (
            <div key={i} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: c.text }}>{r.fecha}</div>
                <div style={{ fontSize: 12, color: c.textDim, marginTop: 2 }}>{STORES[r.sucursal] || r.sucursal}</div>
                {r.distancia_entrada_m != null && (
                  <div style={{ fontSize: 11, marginTop: 2, color: r.fuera_geofence ? c.orange : c.textOff }}>
                    {r.fuera_geofence ? `⚠️ ${r.distancia_entrada_m}m del local` : `${r.distancia_entrada_m}m del local`}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: c.green }}>{fmtTime(r.hora_entrada)}</div>
                <div style={{ fontSize: 13, color: r.hora_salida ? c.red : c.textOff }}>{fmtTime(r.hora_salida)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
