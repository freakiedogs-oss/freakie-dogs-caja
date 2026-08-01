// ────────────────────────────────────────────────────────────────────
// Torre · Sucursales y horarios de delivery
// Cada tienda tiene su horario por día y su switch de delivery.
// Usa la misma sesión de staff (PIN) que la pestaña de Pedidos.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';
const c = { card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e', red: '#e63946',
            green: '#4ade80', yellow: '#fbbf24', text: '#f0f0f0', dim: '#888' };
const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

export default function TabSucursales({ show = () => {} }) {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [sucs, setSucs] = useState(null);
  const [abierta, setAbierta] = useState(null);   // sucursal expandida
  const [guardando, setGuardando] = useState(null);
  const [err, setErr] = useState('');
  const [ubicando, setUbicando] = useState(null);   // sucursal cuya ubicación se está fijando

  const cargar = () => db.rpc('torre_sucursales_horarios', { p_token: token })
    .then(({ data, error }) => { if (error) setErr(error.message); else setSucs(data || []); });

  useEffect(() => { if (token) cargar(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return <div style={{ color: c.dim, textAlign: 'center', padding: 30 }}>Entrá con tu PIN en la pestaña 📥 Pedidos para ver esta sección.</div>;
  if (err) return <div style={{ color: c.red, padding: 20 }}>{err}</div>;
  if (!sucs) return <div style={{ color: c.dim, padding: 20 }}>Cargando…</div>;

  const setHorario = (sucId, dia, campo, valor) => {
    setSucs(prev => prev.map(s => s.id !== sucId ? s : {
      ...s, horarios: s.horarios.map(h => h.dia !== dia ? h : { ...h, [campo]: valor }),
    }));
  };

  const guardarDia = async (suc, h) => {
    setGuardando(`${suc.id}-${h.dia}`);
    try {
      const { error } = await db.rpc('torre_guardar_horario', {
        p_token: token, p_sucursal_id: suc.id, p_dia: h.dia,
        p_apertura: h.apertura, p_cierre: h.cierre, p_abierto: h.abierto,
      });
      if (error) throw error;
      show(`✅ ${suc.nombre} · ${DIAS[h.dia]} guardado`);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo guardar')); }
    finally { setGuardando(null); }
  };

  // Fija el punto de la sucursal con la ubicación de quien está parado ahí.
  // Es la forma confiable: las coordenadas cargadas a ojo desde un mapa suelen
  // quedar a cientos de metros, y entonces nadie puede marcarse de turno.
  const fijarAqui = async (suc) => {
    if (!navigator.geolocation) { show('❌ Este dispositivo no comparte ubicación'); return; }
    setUbicando(suc.id);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (accuracy > 60) {
        show(`⚠️ Tu ubicación tiene ±${Math.round(accuracy)} m de margen. Salí al aire libre y probá otra vez.`);
        setUbicando(null); return;
      }
      try {
        const { error } = await db.rpc('torre_guardar_ubicacion_sucursal', {
          p_token: token, p_sucursal_id: suc.id, p_lat: lat, p_lng: lng, p_radio: null,
        });
        if (error) throw error;
        setSucs(prev => prev.map(s => s.id === suc.id ? { ...s, lat, lng } : s));
        show(`📍 ${suc.nombre} quedó fijada acá (±${Math.round(accuracy)} m)`);
      } catch (e) { show('❌ ' + (e.message || 'No se pudo guardar')); }
      finally { setUbicando(null); }
    }, () => {
      show('❌ No pudimos leer tu ubicación. Revisá el permiso.');
      setUbicando(null);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };

  const guardarRadio = async (suc, metros) => {
    try {
      const { error } = await db.rpc('torre_guardar_ubicacion_sucursal', {
        p_token: token, p_sucursal_id: suc.id, p_lat: suc.lat, p_lng: suc.lng, p_radio: metros,
      });
      if (error) throw error;
      setSucs(prev => prev.map(s => s.id === suc.id ? { ...s, radio_alta_m: metros } : s));
      show(`✅ ${suc.nombre}: los motoristas se marcan hasta ${metros} m`);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo guardar')); }
  };

  const toggleDelivery = async (suc) => {
    const nuevo = !suc.tiene_delivery;
    setGuardando(suc.id);
    try {
      const { error } = await db.rpc('torre_toggle_delivery', {
        p_token: token, p_sucursal_id: suc.id, p_activo: nuevo,
      });
      if (error) throw error;
      setSucs(prev => prev.map(s => s.id === suc.id ? { ...s, tiene_delivery: nuevo } : s));
      show(nuevo ? `🛵 ${suc.nombre} ya reparte a domicilio` : `⏸️ ${suc.nombre} sin delivery`);
    } catch (e) { show('❌ ' + (e.message || 'No se pudo cambiar')); }
    finally { setGuardando(null); }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: c.dim, marginBottom: 14, lineHeight: 1.5 }}>
        Horario de cada tienda y si reparte a domicilio. Las que están sin delivery no reciben
        pedidos del menú público, pero conservan su horario para cuando se activen.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sucs.map(s => {
          const abiertoPanel = abierta === s.id;
          return (
            <div key={s.id} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {/* Encabezado */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{s.nombre}</div>
                  <div style={{ fontSize: 11.5, color: c.dim, marginTop: 2 }}>{s.store_code}</div>
                </div>

                <button onClick={() => toggleDelivery(s)} disabled={guardando === s.id}
                  title={s.tiene_delivery ? 'Dejar de repartir a domicilio' : 'Empezar a repartir a domicilio'}
                  style={{
                    padding: '7px 13px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                    background: s.tiene_delivery ? '#14351f' : '#2a1a1a',
                    color: s.tiene_delivery ? c.green : c.dim,
                  }}>
                  {guardando === s.id ? '…' : s.tiene_delivery ? '🛵 Reparte a domicilio' : '⏸️ Sin delivery'}
                </button>

                <button onClick={() => setAbierta(abiertoPanel ? null : s.id)}
                  style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${c.border}`,
                           background: 'none', color: c.text, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {abiertoPanel ? 'Cerrar' : '🕐 Horarios'}
                </button>
              </div>

              {/* Horario semanal */}
              {abiertoPanel && (
                <div style={{ borderTop: `1px solid ${c.border}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(s.horarios || []).map(h => (
                    <div key={h.dia} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ width: 88, fontSize: 13, color: h.abierto ? c.text : c.dim }}>{DIAS[h.dia]}</span>

                      <input type="time" value={h.apertura} disabled={!h.abierto}
                        onChange={e => setHorario(s.id, h.dia, 'apertura', e.target.value)}
                        style={inp(h.abierto)} />
                      <span style={{ color: c.dim, fontSize: 12 }}>a</span>
                      <input type="time" value={h.cierre} disabled={!h.abierto}
                        onChange={e => setHorario(s.id, h.dia, 'cierre', e.target.value)}
                        style={inp(h.abierto)} />

                      <label style={{ fontSize: 12, color: c.dim, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="checkbox" checked={h.abierto}
                          onChange={e => setHorario(s.id, h.dia, 'abierto', e.target.checked)} />
                        {h.abierto ? 'Abre' : 'Cerrado'}
                      </label>

                      <button onClick={() => guardarDia(s, h)} disabled={guardando === `${s.id}-${h.dia}`}
                        style={{ marginLeft: 'auto', padding: '6px 11px', borderRadius: 8, border: 'none',
                                 background: c.red, color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                        {guardando === `${s.id}-${h.dia}` ? '…' : 'Guardar'}
                      </button>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    Hora de El Salvador. Destildá “Abre” para marcar el día como cerrado.
                  </div>

                  {/* Punto del local: de acá depende que los motoristas puedan marcarse de turno */}
                  <div style={{ borderTop: `1px solid ${c.border}`, marginTop: 12, paddingTop: 12 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: c.text, marginBottom: 4 }}>
                      📍 Ubicación del local
                    </div>
                    <div style={{ fontSize: 11.5, color: c.dim, lineHeight: 1.5, marginBottom: 10 }}>
                      Los motoristas solo pueden marcarse de turno estando cerca de este punto.
                      {s.lat
                        ? <> Está en <a href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                              target="_blank" rel="noreferrer" style={{ color: c.green }}>
                              {Number(s.lat).toFixed(5)}, {Number(s.lng).toFixed(5)}
                            </a>. Verificalo en el mapa; si no cae sobre el local, paráte adentro y fijalo de nuevo.</>
                        : <> <b style={{ color: c.red }}>Todavía no está puesta</b>, así que nadie puede marcarse de turno acá.</>}
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => fijarAqui(s)} disabled={ubicando === s.id}
                        title="Usá tu ubicación actual como punto del local. Tenés que estar adentro."
                        style={{ padding: '9px 13px', borderRadius: 9, border: 'none', background: c.red,
                                 color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                        {ubicando === s.id ? '📍 Leyendo tu ubicación…' : '📍 Estoy acá, fijar este punto'}
                      </button>

                      <label style={{ fontSize: 12, color: c.dim, display: 'flex', gap: 6, alignItems: 'center' }}>
                        Radio
                        <select value={s.radio_alta_m || 100}
                          onChange={e => guardarRadio(s, Number(e.target.value))}
                          disabled={!s.lat} style={{ ...inp(true), padding: '6px 8px' }}>
                          {[50, 100, 150, 200, 300, 500].map(m => <option key={m} value={m}>{m} m</option>)}
                        </select>
                      </label>
                    </div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 8, lineHeight: 1.45 }}>
                      Dentro de un centro comercial el GPS se desvía: si los motoristas no logran
                      marcarse estando ahí, subí el radio en vez de mover el punto.
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inp = (activo) => ({
  background: c.input, border: `1px solid #333`, borderRadius: 8, padding: '7px 9px',
  color: activo ? c.text : c.dim, fontSize: 13, opacity: activo ? 1 : .5,
});
