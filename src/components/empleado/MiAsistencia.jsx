import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES } from '../../config';

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  purple: '#a78bfa', border: '#333', text: '#f0f0f0',
  textDim: '#888', textOff: '#555',
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

// Lunes de la semana que contiene la fecha dada
function getLunes(fecha) {
  const d = new Date(fecha + 'T12:00:00');
  const day = d.getDay(); // 0=dom, 1=lun...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

// Fecha ISO de cada día de la semana dado el lunes
function fechaDia(lunesISO, diaNum) {
  const d = new Date(lunesISO + 'T12:00:00');
  d.setDate(d.getDate() + (diaNum - 1));
  return d.toISOString().split('T')[0];
}

// Retrocompat: obtener tramos desde registro (nuevo JSONB o legacy hora_inicio/fin)
function getTramos(h) {
  if (!h) return [];
  if (h.tramos && Array.isArray(h.tramos) && h.tramos.length > 0) return h.tramos;
  if (h.hora_inicio) return [{
    orden: 1,
    hora_inicio: String(h.hora_inicio).slice(0, 5),
    hora_fin: String(h.hora_fin || '').slice(0, 5),
    etiqueta: h.turno || '',
  }];
  return [];
}

// Color por etiqueta de turno
function colorEtiqueta(etiqueta) {
  const e = (etiqueta || '').toLowerCase();
  if (e === 'mañana') return c.blue;
  if (e === 'tarde') return c.orange;
  if (e === 'noche') return c.purple;
  if (e === 'extra') return c.yellow;
  return c.textDim;
}

const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

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

  // Horarios
  const [horarios, setHorarios] = useState({});   // { diaNum: registro }
  const [loadingHorarios, setLoadingHorarios] = useState(false);
  const [semanaOffset, setSemanaOffset] = useState(0); // 0=esta semana, 1=próxima, -1=anterior

  const hoy = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0];
  const storeName = STORES[user.store_code] || user.store_code || '';

  // Lunes de la semana visible según offset
  const lunesBase = getLunes(hoy);
  const lunesVisible = (() => {
    const d = new Date(lunesBase + 'T12:00:00');
    d.setDate(d.getDate() + semanaOffset * 7);
    return d.toISOString().split('T')[0];
  })();

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

  // Cargar horarios cuando cambia la semana visible o se abre el tab
  const loadHorarios = useCallback(async () => {
    setLoadingHorarios(true);
    try {
      // Traer plantillas (semana_inicio IS NULL) + overrides de la semana visible
      const { data } = await db.from('horarios_empleados')
        .select('*')
        .eq('usuario_id', user.id)
        .or(`es_plantilla.eq.true,semana_inicio.eq.${lunesVisible}`)
        .order('dia_semana')
        .order('es_plantilla', { ascending: false }); // overrides primero (es_plantilla=false)

      // Para cada día_semana (1-7): override gana sobre plantilla
      const mapa = {};
      (data || []).forEach(r => {
        const d = r.dia_semana;
        if (!mapa[d]) {
          mapa[d] = r;
        } else {
          // Si ya hay uno y el nuevo es override (semana_inicio coincide), reemplaza
          const esOverride = r.semana_inicio === lunesVisible;
          if (esOverride) mapa[d] = r;
        }
      });
      setHorarios(mapa);
    } catch (e) { console.error(e); }
    setLoadingHorarios(false);
  }, [user.id, lunesVisible]);

  useEffect(() => {
    if (tab === 'horario') loadHorarios();
  }, [tab, loadHorarios]);

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

  // Etiqueta del rango de semana para el header
  const fmtSemana = () => {
    const lun = new Date(lunesVisible + 'T12:00:00');
    const dom = new Date(lunesVisible + 'T12:00:00');
    dom.setDate(dom.getDate() + 6);
    const opts = { day: 'numeric', month: 'short' };
    return `${lun.toLocaleDateString('es-SV', opts)} – ${dom.toLocaleDateString('es-SV', opts)}`;
  };

  const dInfo = distanciaInfo();
  const esSemanaActual = semanaOffset === 0;

  return (
    <div style={{ padding: '16px 12px', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>📍 Mi Asistencia</div>
        <div style={{ fontSize: 13, color: c.textDim, marginTop: 2 }}>{user.nombre} · {storeName}</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${c.border}`, marginBottom: 16 }}>
        {[
          { id: 'marcar', label: 'Marcar' },
          { id: 'historial', label: 'Historial' },
          { id: 'horario', label: 'Mi Horario' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.id ? c.red : c.textDim, fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
            borderBottom: tab === t.id ? `2px solid ${c.red}` : '2px solid transparent', transition: '0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {loading && tab !== 'horario' ? (
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

      ) : tab === 'historial' ? (
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

      ) : (
        /* ── MI HORARIO ── */
        <div>
          {/* Navegación de semana */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <button onClick={() => setSemanaOffset(o => o - 1)} style={{
              background: c.card, border: `1px solid ${c.border}`, color: c.textDim,
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16,
            }}>‹</button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{fmtSemana()}</div>
              {esSemanaActual && (
                <div style={{ fontSize: 11, color: c.textDim, marginTop: 2 }}>Esta semana</div>
              )}
              {semanaOffset === 1 && (
                <div style={{ fontSize: 11, color: c.blue, marginTop: 2 }}>Próxima semana</div>
              )}
              {semanaOffset < 0 && (
                <div style={{ fontSize: 11, color: c.textOff, marginTop: 2 }}>Semana pasada</div>
              )}
            </div>
            <button onClick={() => setSemanaOffset(o => o + 1)} style={{
              background: c.card, border: `1px solid ${c.border}`, color: c.textDim,
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16,
            }}>›</button>
          </div>

          {/* Botón volver a hoy */}
          {semanaOffset !== 0 && (
            <button onClick={() => setSemanaOffset(0)} style={{
              width: '100%', marginBottom: 12, padding: '7px 0', background: 'none',
              border: `1px solid ${c.border}`, borderRadius: 8, color: c.textDim,
              fontSize: 12, cursor: 'pointer',
            }}>↩ Volver a esta semana</button>
          )}

          {loadingHorarios ? (
            <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando horario...</div>
          ) : (
            <div>
              {[1, 2, 3, 4, 5, 6, 7].map(diaNum => {
                const registro = horarios[diaNum];
                const tramos = getTramos(registro);
                const fechaDelDia = fechaDia(lunesVisible, diaNum);
                const esHoy = esSemanaActual && fechaDelDia === hoy;
                const esLibre = !registro || tramos.length === 0;

                return (
                  <div key={diaNum} style={{
                    ...cardStyle,
                    borderColor: esHoy ? c.yellow : c.cardBorder,
                    background: esHoy ? 'rgba(251,191,36,0.05)' : c.card,
                    marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      {/* Día */}
                      <div style={{ minWidth: 72 }}>
                        <div style={{ fontSize: 13, fontWeight: esHoy ? 800 : 600, color: esHoy ? c.yellow : c.text }}>
                          {DIAS_LARGO[diaNum - 1]}
                          {esHoy && <span style={{ fontSize: 10, marginLeft: 6, color: c.yellow }}>HOY</span>}
                        </div>
                        <div style={{ fontSize: 11, color: c.textOff, marginTop: 1 }}>
                          {new Date(fechaDelDia + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>

                      {/* Tramos o Libre */}
                      <div style={{ flex: 1, paddingLeft: 12 }}>
                        {esLibre ? (
                          <span style={{ fontSize: 13, color: c.textOff, fontStyle: 'italic' }}>Libre</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {tramos.map((t, i) => (
                              <div key={i} style={{
                                display: 'flex', flexDirection: 'column',
                                background: 'rgba(255,255,255,0.04)',
                                border: `1px solid ${colorEtiqueta(t.etiqueta)}44`,
                                borderRadius: 7, padding: '5px 9px',
                              }}>
                                {t.etiqueta && (
                                  <span style={{ fontSize: 10, color: colorEtiqueta(t.etiqueta), fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    {t.etiqueta}
                                  </span>
                                )}
                                <span style={{ fontSize: 13, fontWeight: 600, color: c.text, marginTop: t.etiqueta ? 1 : 0 }}>
                                  {t.hora_inicio}{t.hora_fin ? ` – ${t.hora_fin}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Aviso si no hay plantilla cargada */}
              {Object.keys(horarios).length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: c.textDim, fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📅</div>
                  Tu horario aún no ha sido configurado.<br />
                  <span style={{ color: c.textOff }}>Consulta con tu gerente.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
