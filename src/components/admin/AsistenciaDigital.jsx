import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';

// ── Colores consistentes con el resto del ERP ──
const c = {
  bg: '#111',
  card: '#1a1a1a',
  cardBorder: '#2a2a2a',
  input: '#1e1e1e',
  red: '#e63946',
  green: '#4ade80',
  greenDark: '#2d6a4f',
  yellow: '#fbbf24',
  orange: '#f97316',
  blue: '#60a5fa',
  border: '#333',
  text: '#f0f0f0',
  textDim: '#888',
  textOff: '#555',
};

const cardStyle = {
  background: c.card,
  border: `1px solid ${c.cardBorder}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
};

const inputStyle = {
  width: '100%',
  background: c.input,
  border: `1px solid ${c.border}`,
  borderRadius: 8,
  color: c.text,
  padding: '10px 12px',
  fontSize: 15,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const labelStyle = { fontSize: 13, color: c.textDim, display: 'block', marginBottom: 4 };

const btnPrimary = {
  width: '100%',
  padding: 14,
  borderRadius: 10,
  background: c.red,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 700,
  transition: '0.15s',
};

const btnGreen = { ...btnPrimary, background: c.greenDark };
const btnGhost = {
  ...btnPrimary,
  background: c.input,
  color: '#ccc',
  border: `1px solid ${c.border}`,
  fontWeight: 600,
};

// ── Helpers ──
const fmtDateTime = (iso) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-SV', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

const fmtTime = (iso) => {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
};

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function AsistenciaDigital({ sucursales, user }) {
  const [view, setView] = useState('checkin');
  const [selectedSucursal, setSelectedSucursal] = useState(sucursales[0]?.id || '');

  const views = [
    { id: 'checkin', label: 'Check-in' },
    { id: 'historia', label: 'Historial' },
    { id: 'correcciones', label: 'Ajustes' },
  ];

  return (
    <div>
      {/* Sub-navigation — estilo tab underline como el resto de la app */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${c.cardBorder}`,
        marginBottom: 16,
        gap: 0,
      }}>
        {views.map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            style={{
              flex: 1,
              padding: '12px 6px',
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 700,
              color: view === v.id ? c.red : c.textOff,
              cursor: 'pointer',
              borderBottom: view === v.id ? `2px solid ${c.red}` : '2px solid transparent',
              background: 'none',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: view === v.id ? c.red : 'transparent',
              transition: '0.15s',
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Sucursal Selector */}
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Sucursal</label>
        <select
          value={selectedSucursal}
          onChange={(e) => setSelectedSucursal(e.target.value)}
          style={inputStyle}
        >
          {sucursales.map(s => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </div>

      {/* Views */}
      {view === 'checkin' && <CheckinWidget sucursal={selectedSucursal} user={user} />}
      {view === 'historia' && <HistorialAsistencia sucursal={selectedSucursal} />}
      {view === 'correcciones' && <CorrecionesPanel sucursal={selectedSucursal} user={user} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHECK-IN / CHECK-OUT
// ═══════════════════════════════════════════════════════════════
function CheckinWidget({ sucursal, user }) {
  const [position, setPosition] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [estado, setEstado] = useState('checkin');
  const [loading, setLoading] = useState(false);
  const [lastCheckin, setLastCheckin] = useState(null);

  // GPS
  const getLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsLoading(false);
      },
      () => { setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // Auto-get GPS on mount
  useEffect(() => { getLocation(); }, [getLocation]);

  // Último check-in
  useEffect(() => {
    if (!user?.id) return;
    db.from('asistencia_gps')
      .select('*')
      .eq('empleado_id', user.id)
      .order('timestamp_checkin', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.timestamp_checkout === null) {
          setEstado('checkout');
          setLastCheckin(data[0]);
        }
      });
  }, [user?.id]);

  // Guardar
  const handleSave = async () => {
    if (!position) return alert('Esperando ubicación GPS...');
    setLoading(true);
    try {
      if (estado === 'checkin') {
        await db.from('asistencia_gps').insert({
          empleado_id: user.id,
          sucursal_id: sucursal,
          timestamp_checkin: new Date().toISOString(),
          lat_checkin: position.lat,
          lon_checkin: position.lon,
          distancia_metros: Math.round(position.accuracy),
        });
        alert('Check-in registrado ✅');
      } else if (lastCheckin) {
        await db.from('asistencia_gps').update({
          timestamp_checkout: new Date().toISOString(),
          lat_checkout: position.lat,
          lon_checkout: position.lon,
        }).eq('id', lastCheckin.id);
        alert('Check-out registrado ✅');
        setEstado('checkin');
        setLastCheckin(null);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const isCheckout = estado === 'checkout';
  const canSave = !!position && !loading;

  return (
    <div>
      {/* Estado badge */}
      <div style={{
        ...cardStyle,
        borderLeft: `3px solid ${isCheckout ? c.orange : c.green}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>
            {isCheckout ? 'Tienes un turno activo' : 'Nuevo turno'}
          </div>
          <div style={{ fontSize: 12, color: c.textDim, marginTop: 2 }}>
            {isCheckout
              ? `Entrada: ${fmtTime(lastCheckin?.timestamp_checkin)}`
              : 'Registra tu entrada con GPS y foto'}
          </div>
        </div>
        <span style={{
          display: 'inline-block',
          padding: '3px 9px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 700,
          background: isCheckout ? '#7c2d12' : '#14532d',
          color: isCheckout ? '#fb923c' : '#4ade80',
        }}>
          {isCheckout ? 'Check-out' : 'Check-in'}
        </span>
      </div>

      {/* GPS */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.textDim }}>Ubicación GPS</span>
          <button
            onClick={getLocation}
            disabled={gpsLoading}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              background: c.input,
              color: c.text,
              border: `1px solid ${c.border}`,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {gpsLoading ? '...' : '↻ Actualizar'}
          </button>
        </div>
        {position ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{
              padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: '#14532d', color: '#4ade80',
            }}>GPS OK</span>
            <span style={{ fontSize: 12, color: c.textDim }}>
              {position.lat.toFixed(5)}, {position.lon.toFixed(5)} · ±{position.accuracy.toFixed(0)}m
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: '#7f1d1d', color: '#f87171',
            }}>Sin GPS</span>
            <span style={{ fontSize: 12, color: c.textDim }}>Esperando permisos de ubicación</span>
          </div>
        )}
      </div>

      {/* Botón guardar */}
      <button
        onClick={handleSave}
        disabled={!canSave}
        style={{
          ...btnPrimary,
          background: canSave ? (isCheckout ? '#e07c00' : c.greenDark) : c.textOff,
          cursor: canSave ? 'pointer' : 'not-allowed',
          opacity: loading ? 0.5 : 1,
          marginTop: 4,
        }}
      >
        {loading
          ? '⏳ Registrando...'
          : isCheckout ? '🔴 Registrar Check-out' : '🟢 Registrar Check-in'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HISTORIAL
// ═══════════════════════════════════════════════════════════════
function HistorialAsistencia({ sucursal }) {
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    db.from('asistencia_gps')
      .select('*, empleados(nombre_completo)')
      .eq('sucursal_id', sucursal)
      .order('timestamp_checkin', { ascending: false })
      .limit(50)
      .then(({ data }) => setRegistros(data || []))
      .finally(() => setLoading(false));
  }, [sucursal]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: c.textOff }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
        <div style={{ fontSize: 14 }}>Cargando historial...</div>
      </div>
    );
  }

  if (registros.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: c.textOff }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
        <div style={{ fontSize: 14 }}>No hay registros de asistencia para esta sucursal</div>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Empleado', 'Entrada', 'Salida', 'Precisión'].map((h, i) => (
              <th key={i} style={{
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: 12,
                fontWeight: 700,
                color: c.textDim,
                borderBottom: `2px solid ${c.border}`,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {registros.map(r => (
            <tr key={r.id}>
              <td style={{ padding: '10px 12px', fontSize: 13, color: c.text, borderBottom: `1px solid ${c.border}` }}>
                {r.empleados?.nombre_completo || '-'}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 13, color: c.text, borderBottom: `1px solid ${c.border}` }}>
                {fmtDateTime(r.timestamp_checkin)}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 13, borderBottom: `1px solid ${c.border}` }}>
                {r.timestamp_checkout ? (
                  <span style={{ color: c.text }}>{fmtTime(r.timestamp_checkout)}</span>
                ) : (
                  <span style={{
                    padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: '#7c2d12', color: '#fb923c',
                  }}>Activo</span>
                )}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 13, color: c.textDim, borderBottom: `1px solid ${c.border}` }}>
                {r.distancia_metros ? `±${r.distancia_metros}m` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CORRECCIONES / AJUSTES MANUALES
// ═══════════════════════════════════════════════════════════════
function CorrecionesPanel({ sucursal, user }) {
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [razon, setRazon] = useState('');
  const [saving, setSaving] = useState(false);

  const loadRegistros = useCallback(() => {
    setLoading(true);
    db.from('asistencia_gps')
      .select('*, empleados(nombre_completo)')
      .eq('sucursal_id', sucursal)
      .order('timestamp_checkin', { ascending: false })
      .limit(30)
      .then(({ data }) => setRegistros(data || []))
      .finally(() => setLoading(false));
  }, [sucursal]);

  useEffect(() => { loadRegistros(); }, [loadRegistros]);

  const handleAjuste = async () => {
    if (!selectedId || !razon.trim()) return alert('Selecciona registro y escribe razón');
    setSaving(true);
    try {
      await db.from('asistencia_gps').update({
        ajuste_manual_por: user?.id,
        ajuste_manual_timestamp: new Date().toISOString(),
        ajuste_razon: razon,
      }).eq('id', selectedId);
      alert('Ajuste registrado ✅');
      setSelectedId('');
      setRazon('');
      loadRegistros();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: c.textOff }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
        <div style={{ fontSize: 14 }}>Cargando registros...</div>
      </div>
    );
  }

  const selected = registros.find(r => r.id === selectedId);

  return (
    <div>
      {/* Info card */}
      <div style={{ ...cardStyle, borderLeft: `3px solid ${c.yellow}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: c.text, marginBottom: 4 }}>
          Correcciones de asistencia
        </div>
        <div style={{ fontSize: 12, color: c.textDim }}>
          Selecciona un registro para agregar una nota de ajuste. Solo personal RRHH puede realizar correcciones.
        </div>
      </div>

      {/* Form */}
      <div style={cardStyle}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Registro a ajustar</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={inputStyle}
          >
            <option value="">Selecciona un registro...</option>
            {registros.map(r => (
              <option key={r.id} value={r.id}>
                {r.empleados?.nombre_completo} — {fmtDateTime(r.timestamp_checkin)}
                {r.ajuste_razon ? ' (ya ajustado)' : ''}
              </option>
            ))}
          </select>
        </div>

        {selected?.ajuste_razon && (
          <div style={{
            background: '#78350f20', border: '1px solid #78350f',
            borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12, color: c.yellow,
          }}>
            Ajuste previo: {selected.ajuste_razon}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Razón del ajuste</label>
          <textarea
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            placeholder="Ej: Empleado olvidó marcar salida, se confirma hora real con supervisor..."
            rows={3}
            style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
          />
        </div>

        <button
          onClick={handleAjuste}
          disabled={saving || !selectedId || !razon.trim()}
          style={{
            ...btnGreen,
            opacity: (saving || !selectedId || !razon.trim()) ? 0.45 : 1,
            cursor: (selectedId && razon.trim() && !saving) ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? '⏳ Guardando...' : '💾 Guardar ajuste'}
        </button>
      </div>
    </div>
  );
}
