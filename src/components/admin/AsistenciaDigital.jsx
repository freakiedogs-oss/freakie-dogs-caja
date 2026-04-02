import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
};
const cardStyle = { background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const inputStyle = { width: '100%', background: c.input, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
const labelStyle = { fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 };
const btnPrimary = { width: '100%', padding: 12, borderRadius: 10, background: c.red, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700 };
const btnGreen = { ...btnPrimary, background: c.greenDark };

const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' }) : '—';

export default function AsistenciaDigital({ sucursales, user }) {
  const [tab, setTab] = useState('historial');
  const [selectedSuc, setSelectedSuc] = useState(sucursales[0]?.store_code || '');

  const tabs = [
    { id: 'alertas', label: '🚨 Alertas' },
    { id: 'historial', label: 'Historial' },
    { id: 'correcciones', label: 'Ajustes' },
    { id: 'geofence', label: '📍 Config' },
  ];

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${c.border}`, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.id ? c.red : c.textOff, fontSize: 12, fontWeight: tab === t.id ? 700 : 400,
            borderBottom: tab === t.id ? `2px solid ${c.red}` : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Selector sucursal (para historial y alertas) */}
      {(tab === 'historial' || tab === 'alertas') && (
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Sucursal</label>
          <select value={selectedSuc} onChange={e => setSelectedSuc(e.target.value)} style={inputStyle}>
            <option value="">Todas</option>
            {sucursales.map(s => <option key={s.id} value={s.store_code}>{s.nombre}</option>)}
          </select>
        </div>
      )}

      {tab === 'alertas'    && <AlertasPanel selectedSuc={selectedSuc} user={user} />}
      {tab === 'historial'  && <HistorialPanel selectedSuc={selectedSuc} />}
      {tab === 'correcciones' && <CorreccionesPanel sucursales={sucursales} user={user} />}
      {tab === 'geofence'   && <GeofenceConfig sucursales={sucursales} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ALERTAS — lo que Majo necesita para detectar irregularidades
// ═══════════════════════════════════════════════════════════════
function AlertasPanel({ selectedSuc, user }) {
  const [alertas, setAlertas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('todas');

  const load = useCallback(async () => {
    setLoading(true);
    let q = db.from('asistencia')
      .select('*, usuarios_erp(nombre, apellido, store_code)')
      .order('fecha', { ascending: false })
      .limit(100);

    if (selectedSuc) q = q.eq('sucursal', selectedSuc);

    const { data } = await q;
    setAlertas(data || []);
    setLoading(false);
  }, [selectedSuc]);

  useEffect(() => { load(); }, [load]);

  const aprobar = async (id) => {
    await db.from('asistencia').update({ alerta_rrhh: false, notas: 'Revisado por RRHH - OK' }).eq('id', id);
    load();
  };

  const filtered = alertas.filter(r => {
    if (filter === 'fuera') return r.fuera_geofence;
    if (filter === 'sin_salida') return r.hora_entrada && !r.hora_salida;
    if (filter === 'alerta') return r.alerta_rrhh;
    return r.fuera_geofence || r.alerta_rrhh || !r.hora_salida;
  });

  const conteos = {
    fuera: alertas.filter(r => r.fuera_geofence).length,
    sin_salida: alertas.filter(r => r.hora_entrada && !r.hora_salida).length,
    alerta: alertas.filter(r => r.alerta_rrhh).length,
  };

  return (
    <div>
      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Fuera de rango', val: conteos.fuera, color: c.orange },
          { label: 'Sin salida', val: conteos.sin_salida, color: c.yellow },
          { label: 'Con alerta', val: conteos.alerta, color: c.red },
        ].map((s, i) => (
          <div key={i} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', padding: 12 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: c.textDim, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { id: 'todas', label: 'Todas' },
          { id: 'fuera', label: '📍 Fuera de rango' },
          { id: 'sin_salida', label: '⏰ Sin salida' },
          { id: 'alerta', label: '🚨 Con alerta' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '5px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
            background: filter === f.id ? c.red : c.input,
            color: filter === f.id ? '#fff' : c.textDim, fontWeight: filter === f.id ? 700 : 400,
          }}>{f.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: c.textDim, padding: 32 }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 32, borderColor: c.greenDark }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, color: c.green }}>Sin irregularidades</div>
        </div>
      ) : (
        filtered.map((r, i) => {
          const emp = r.usuarios_erp;
          const nombre = emp ? `${emp.nombre} ${emp.apellido}` : '—';
          const fueraRango = r.fuera_geofence;
          const sinSalida = r.hora_entrada && !r.hora_salida;

          return (
            <div key={i} style={{
              ...cardStyle,
              borderLeft: `3px solid ${fueraRango ? c.orange : sinSalida ? c.yellow : c.red}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>{nombre}</div>
                  <div style={{ fontSize: 12, color: c.textDim, marginTop: 2 }}>
                    {fmtDate(r.fecha)} · Entrada: {fmtTime(r.hora_entrada)} · Salida: {fmtTime(r.hora_salida)}
                  </div>

                  {/* Badges de alerta */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {fueraRango && (
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'rgba(249,115,22,0.15)', color: c.orange }}>
                        📍 {r.distancia_entrada_m}m del local
                      </span>
                    )}
                    {sinSalida && (
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'rgba(251,191,36,0.15)', color: c.yellow }}>
                        ⏰ Sin salida
                      </span>
                    )}
                    {r.alerta_rrhh && (
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'rgba(230,57,70,0.15)', color: c.red }}>
                        🚨 Alerta activa
                      </span>
                    )}
                    {r.notas && (
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, background: c.input, color: c.textDim }}>
                        {r.notas}
                      </span>
                    )}
                  </div>
                </div>

                {/* Coordenadas GPS */}
                {r.gps_entrada?.lat && (
                  <a
                    href={`https://maps.google.com/?q=${r.gps_entrada.lat},${r.gps_entrada.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 20, textDecoration: 'none', marginLeft: 8, flexShrink: 0 }}
                    title="Ver en Google Maps"
                  >🗺️</a>
                )}
              </div>

              {r.alerta_rrhh && (
                <button onClick={() => aprobar(r.id)} style={{
                  marginTop: 10, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: c.greenDark, color: c.green, border: 'none', cursor: 'pointer',
                }}>
                  ✓ Marcar revisado
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HISTORIAL GENERAL
// ═══════════════════════════════════════════════════════════════
function HistorialPanel({ selectedSuc }) {
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fecha, setFecha] = useState(new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0]);

  useEffect(() => {
    setLoading(true);
    let q = db.from('asistencia')
      .select('*, usuarios_erp(nombre, apellido)')
      .eq('fecha', fecha)
      .order('hora_entrada', { ascending: true })
      .limit(100);
    if (selectedSuc) q = q.eq('sucursal', selectedSuc);
    q.then(({ data }) => { setRegistros(data || []); setLoading(false); });
  }, [selectedSuc, fecha]);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Fecha</label>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
          style={{ ...inputStyle, width: 'auto' }} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: c.textDim, padding: 32 }}>Cargando...</div>
      ) : registros.length === 0 ? (
        <div style={{ textAlign: 'center', color: c.textOff, padding: 32 }}>Sin registros para esta fecha</div>
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Empleado', 'Entrada', 'Salida', 'Distancia', 'Estado'].map((h, i) => (
                  <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: c.textDim, borderBottom: `2px solid ${c.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registros.map((r, i) => {
                const emp = r.usuarios_erp;
                const nombre = emp ? `${emp.nombre} ${emp.apellido}` : '—';
                return (
                  <tr key={i}>
                    <td style={{ padding: '9px 10px', fontSize: 13, color: c.text, borderBottom: `1px solid ${c.border}` }}>{nombre}</td>
                    <td style={{ padding: '9px 10px', fontSize: 13, color: c.green, borderBottom: `1px solid ${c.border}` }}>{fmtTime(r.hora_entrada)}</td>
                    <td style={{ padding: '9px 10px', fontSize: 13, color: r.hora_salida ? c.red : c.textOff, borderBottom: `1px solid ${c.border}` }}>{fmtTime(r.hora_salida)}</td>
                    <td style={{ padding: '9px 10px', fontSize: 12, borderBottom: `1px solid ${c.border}` }}>
                      {r.distancia_entrada_m != null ? (
                        <span style={{ color: r.fuera_geofence ? c.orange : c.textDim }}>
                          {r.distancia_entrada_m}m {r.fuera_geofence ? '⚠️' : ''}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${c.border}` }}>
                      {r.fuera_geofence ? (
                        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(249,115,22,0.15)', color: c.orange, fontWeight: 700 }}>Fuera rango</span>
                      ) : (
                        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', color: c.green, fontWeight: 700 }}>OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CORRECCIONES MANUALES
// ═══════════════════════════════════════════════════════════════
function CorreccionesPanel({ sucursales, user }) {
  const [empleadoPin, setEmpleadoPin] = useState('');
  const [empleado, setEmpleado] = useState(null);
  const [registros, setRegistros] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [razon, setRazon] = useState('');
  const [saving, setSaving] = useState(false);
  const [buscando, setBuscando] = useState(false);

  const buscarEmpleado = async () => {
    if (!empleadoPin) return;
    setBuscando(true);
    const { data } = await db.from('usuarios_erp').select('*').eq('pin', empleadoPin).maybeSingle();
    setEmpleado(data);
    if (data) {
      const { data: regs } = await db.from('asistencia')
        .select('*').eq('usuario_id', data.id)
        .order('fecha', { ascending: false }).limit(10);
      setRegistros(regs || []);
    }
    setBuscando(false);
  };

  const handleAjuste = async () => {
    if (!selectedId || !razon.trim()) return;
    setSaving(true);
    const { error } = await db.from('asistencia').update({ notas: razon, alerta_rrhh: false }).eq('id', selectedId);
    if (!error) { setRazon(''); setSelectedId(''); alert('Ajuste guardado ✅'); }
    setSaving(false);
  };

  return (
    <div>
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.yellow, marginBottom: 10 }}>🔍 Buscar empleado por PIN</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={empleadoPin} onChange={e => setEmpleadoPin(e.target.value)}
            placeholder="PIN del empleado" style={{ ...inputStyle, flex: 1 }}
            onKeyDown={e => e.key === 'Enter' && buscarEmpleado()} />
          <button onClick={buscarEmpleado} disabled={buscando} style={{
            padding: '10px 16px', borderRadius: 8, background: c.red, color: '#fff',
            border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          }}>{buscando ? '...' : 'Buscar'}</button>
        </div>
      </div>

      {empleado && (
        <div>
          <div style={{ ...cardStyle, borderLeft: `3px solid ${c.blue}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>{empleado.nombre} {empleado.apellido}</div>
            <div style={{ fontSize: 12, color: c.textDim }}>PIN {empleado.pin} · {empleado.rol} · {empleado.store_code}</div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Registro a corregir</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={inputStyle}>
              <option value="">Selecciona una fecha...</option>
              {registros.map(r => (
                <option key={r.id} value={r.id}>
                  {r.fecha} · Entrada {fmtTime(r.hora_entrada)} · Salida {fmtTime(r.hora_salida)}
                  {r.fuera_geofence ? ' ⚠️' : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Nota / razón de corrección</label>
            <textarea value={razon} onChange={e => setRazon(e.target.value)}
              placeholder="Ej: Empleado trabajó en otra sucursal ese día por apoyo..." rows={3}
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} />
          </div>

          <button onClick={handleAjuste} disabled={saving || !selectedId || !razon.trim()}
            style={{ ...btnGreen, opacity: saving || !selectedId || !razon.trim() ? 0.5 : 1 }}>
            {saving ? 'Guardando...' : '💾 Guardar corrección'}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CONFIG GEOFENCE — coordenadas y radio por sucursal
// ═══════════════════════════════════════════════════════════════
function GeofenceConfig({ sucursales }) {
  const [selected, setSelected] = useState(sucursales[0]?.store_code || '');
  const [form, setForm] = useState({ lat: '', lng: '', radio_metros: 200 });
  const [saving, setSaving] = useState(false);
  const [gpsActual, setGpsActual] = useState(null);

  useEffect(() => {
    const suc = sucursales.find(s => s.store_code === selected);
    if (suc) setForm({ lat: suc.lat || '', lng: suc.lng || '', radio_metros: suc.radio_metros || 200 });
  }, [selected, sucursales]);

  const capturarGPS = () => {
    navigator.geolocation.getCurrentPosition(
      p => { setForm(f => ({ ...f, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })); setGpsActual({ acc: Math.round(p.coords.accuracy) }); },
      () => alert('No se pudo obtener GPS'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const guardar = async () => {
    const suc = sucursales.find(s => s.store_code === selected);
    if (!suc) return;
    setSaving(true);
    const { error } = await db.from('sucursales').update({
      lat: parseFloat(form.lat), lng: parseFloat(form.lng), radio_metros: parseInt(form.radio_metros),
    }).eq('id', suc.id);
    setSaving(false);
    if (!error) alert(`✅ Coordenadas guardadas para ${suc.nombre}`);
    else alert('Error: ' + error.message);
  };

  return (
    <div>
      <div style={{ ...cardStyle, borderLeft: `3px solid ${c.blue}` }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: c.blue, marginBottom: 4 }}>📍 Configurar geofence por sucursal</div>
        <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.5 }}>
          Define las coordenadas GPS del centro de cada local y el radio máximo aceptado.
          El sistema alertará cuando alguien marque asistencia fuera de ese radio.
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Sucursal</label>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={inputStyle}>
          {sucursales.map(s => <option key={s.id} value={s.store_code}>{s.nombre}</option>)}
        </select>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Latitud</label>
            <input value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))}
              placeholder="13.6803" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Longitud</label>
            <input value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))}
              placeholder="-89.2539" style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Radio permitido (metros)</label>
          <input type="number" value={form.radio_metros} onChange={e => setForm(f => ({ ...f, radio_metros: e.target.value }))}
            min={50} max={1000} style={{ ...inputStyle, width: 'auto' }} />
          <div style={{ fontSize: 11, color: c.textDim, marginTop: 4 }}>
            Recomendado: 150-250m para locales en plaza · 300m+ para local con estacionamiento
          </div>
        </div>

        <button onClick={capturarGPS} style={{ ...btnPrimary, background: c.input, color: c.text, border: `1px solid ${c.border}`, marginBottom: 8 }}>
          📱 Capturar mi GPS actual {gpsActual ? `(±${gpsActual.acc}m)` : ''}
        </button>

        {form.lat && form.lng && (
          <a href={`https://maps.google.com/?q=${form.lat},${form.lng}`} target="_blank" rel="noreferrer"
            style={{ display: 'block', textAlign: 'center', fontSize: 12, color: c.blue, marginBottom: 10 }}>
            🗺️ Verificar en Google Maps
          </a>
        )}

        <button onClick={guardar} disabled={saving || !form.lat || !form.lng}
          style={{ ...btnGreen, opacity: saving || !form.lat || !form.lng ? 0.5 : 1 }}>
          {saving ? 'Guardando...' : '💾 Guardar coordenadas'}
        </button>
      </div>
    </div>
  );
}
