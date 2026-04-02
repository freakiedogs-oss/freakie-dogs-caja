import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../../supabase';

const colors = {
  bg: '#1a1a2e',
  bgCard: '#16213e',
  red: '#e63946',
  green: '#4ade80',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  border: '#333',
  text: '#eee',
  textDim: '#888',
};

/**
 * AsistenciaDigital Component
 * GPS-based attendance tracking with photo capture and real-time mapping
 * Supports check-in/check-out with location verification and corrections
 */
export default function AsistenciaDigital({ sucursales, user }) {
  const [view, setView] = useState('checkin'); // checkin, historia, mapa, correcciones
  const [selectedSucursal, setSelectedSucursal] = useState(sucursales[0]?.id || '');
  const [loading, setLoading] = useState(false);

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'checkin', label: '✅ Check-in/Out' },
          { id: 'historia', label: '📊 Historial' },
          { id: 'mapa', label: '🗺️ Mapa Sucursales' },
          { id: 'correcciones', label: '✏️ Ajustes' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: view === t.id ? colors.green : colors.bgCard,
              color: view === t.id ? '#000' : colors.text,
              border: `1px solid ${view === t.id ? colors.green : colors.border}`,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: view === t.id ? 700 : 400,
              transition: 'all 0.2s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sucursal Selector */}
      {view !== 'mapa' && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: colors.textDim }}>Sucursal:</label>
          <select
            value={selectedSucursal}
            onChange={(e) => setSelectedSucursal(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: colors.bgCard,
              color: colors.text,
              fontSize: 13,
              marginTop: 4,
            }}
          >
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {/* View Content */}
      {view === 'checkin' && <CheckinWidget sucursal={selectedSucursal} user={user} />}
      {view === 'historia' && <HistorialAsistencia sucursal={selectedSucursal} />}
      {view === 'mapa' && <MapaSucursales sucursales={sucursales} />}
      {view === 'correcciones' && <CorrecionesModal sucursal={selectedSucursal} user={user} />}
    </div>
  );
}

/**
 * CheckinWidget: GPS + Camera capture for check-in/out
 */
function CheckinWidget({ sucursal, user }) {
  const [position, setPosition] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [timestamp, setTimestamp] = useState(new Date());
  const [estado, setEstado] = useState('checkin'); // checkin o checkout
  const [loading, setLoading] = useState(false);
  const [lastCheckin, setLastCheckin] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Obtener ubicación GPS
  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      alert('Geolocalización no disponible en este dispositivo');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        console.error('Error de GPS:', err);
        alert('No se pudo obtener la ubicación. Verifica permisos de localización.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // Iniciar cámara
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Error de cámara:', err);
      alert('No se pudo acceder a la cámara.');
    }
  }, []);

  // Capturar foto
  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      const photoData = canvasRef.current.toDataURL('image/jpeg');
      setPhoto(photoData);
    }
  };

  // Cargar último check-in para saber si es check-out
  useEffect(() => {
    if (!user?.id) return;

    db.from('asistencia_gps')
      .select('*')
      .eq('empleado_id', user.id)
      .order('timestamp_checkin', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.length > 0) {
          const last = data[0];
          if (last.timestamp_checkout === null) {
            setEstado('checkout');
            setLastCheckin(last);
          }
        }
      })
      .catch(err => console.error('Error cargando último check-in:', err));
  }, [user?.id]);

  // Guardar registro
  const handleSave = async () => {
    if (!position || !photo) {
      alert('Por favor obtén ubicación y captura foto');
      return;
    }

    setLoading(true);
    try {
      // Upload foto a Supabase Storage
      let photoUrl = null;
      if (photo) {
        const filename = `asistencia/${user.id}/${Date.now()}.jpg`;
        const { error: uploadErr } = await db.storage
          .from('asistencia-fotos')
          .upload(filename, await fetch(photo).then(r => r.blob()), {
            contentType: 'image/jpeg',
          });

        if (!uploadErr) {
          const { data } = db.storage.from('asistencia-fotos').getPublicUrl(filename);
          photoUrl = data?.publicUrl;
        }
      }

      // Guardar registro en asistencia_gps
      if (estado === 'checkin') {
        await db.from('asistencia_gps').insert({
          empleado_id: user.id,
          sucursal_id: sucursal,
          timestamp_checkin: timestamp.toISOString(),
          lat_checkin: position.lat,
          lon_checkin: position.lon,
          foto_url: photoUrl,
          distancia_metros: Math.round(position.accuracy),
        });
      } else if (lastCheckin) {
        await db.from('asistencia_gps').update({
          timestamp_checkout: timestamp.toISOString(),
          lat_checkout: position.lat,
          lon_checkout: position.lon,
        }).eq('id', lastCheckin.id);
      }

      alert(`${estado === 'checkin' ? 'Check-in' : 'Check-out'} registrado ✅`);
      setPhoto(null);
      setPosition(null);
      if (estado === 'checkin') setEstado('checkin');
    } catch (err) {
      console.error('Error:', err);
      alert('Error al guardar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <div style={{ background: colors.bgCard, borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px 0', color: colors.text, fontSize: 14 }}>
          {estado === 'checkin' ? '✅ Check-in' : '❌ Check-out'}
        </h3>

        {/* Video Preview */}
        <div style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          background: '#000',
          borderRadius: 6,
          overflow: 'hidden',
          marginBottom: 12,
        }}>
          {photo ? (
            <img src={photo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Foto capturada" />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          <canvas ref={canvasRef} style={{ display: 'none' }} width={1280} height={720} />
        </div>

        {/* Botones */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <button
            onClick={startCamera}
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              background: colors.blue,
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            📹 Iniciar Cámara
          </button>
          <button
            onClick={capturePhoto}
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              background: colors.yellow,
              color: '#000',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            📸 Capturar Foto
          </button>
        </div>

        {/* GPS Info */}
        <div style={{
          background: colors.bg,
          padding: 10,
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 11,
          color: colors.textDim,
        }}>
          {position ? (
            <>
              <div>✅ GPS: {position.lat.toFixed(6)}, {position.lon.toFixed(6)}</div>
              <div>📍 Precisión: {position.accuracy.toFixed(0)}m</div>
            </>
          ) : (
            <div>❌ GPS no disponible</div>
          )}
        </div>

        {/* Guardar */}
        <button
          onClick={handleSave}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 6,
            background: photo && position ? colors.green : colors.textDim,
            color: '#000',
            border: 'none',
            cursor: photo && position ? 'pointer' : 'not-allowed',
            fontSize: 12,
            fontWeight: 700,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '⏳ Guardando...' : `💾 Guardar ${estado === 'checkin' ? 'Check-in' : 'Check-out'}`}
        </button>
      </div>
    </div>
  );
}

/**
 * HistorialAsistencia: Table de registros GPS
 */
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
      .catch(err => console.error('Error:', err))
      .finally(() => setLoading(false));
  }, [sucursal]);

  if (loading) return <div style={{ color: colors.textDim }}>⏳ Cargando...</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 11,
      }}>
        <thead>
          <tr style={{ background: colors.bgCard, borderBottom: `1px solid ${colors.border}` }}>
            <th style={{ padding: 8, textAlign: 'left', color: colors.textDim }}>Empleado</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.textDim }}>Check-in</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.textDim }}>Check-out</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.textDim }}>Distancia</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.textDim }}>Foto</th>
          </tr>
        </thead>
        <tbody>
          {registros.map(r => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: 8, color: colors.text }}>{r.empleados?.nombre_completo || '-'}</td>
              <td style={{ padding: 8, color: colors.text, fontSize: 10 }}>
                {new Date(r.timestamp_checkin).toLocaleString('es-SV')}
              </td>
              <td style={{ padding: 8, color: colors.text, fontSize: 10 }}>
                {r.timestamp_checkout ? new Date(r.timestamp_checkout).toLocaleTimeString('es-SV') : '🔴 Activo'}
              </td>
              <td style={{ padding: 8, color: colors.text }}>
                {r.distancia_metros ? `${r.distancia_metros}m` : '-'}
              </td>
              <td style={{ padding: 8, textAlign: 'center' }}>
                {r.foto_url ? <a href={r.foto_url} target="_blank" rel="noopener noreferrer" style={{ color: colors.blue }}>🖼️</a> : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {registros.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: colors.textDim }}>No hay registros</div>
      )}
    </div>
  );
}

/**
 * MapaSucursales: Google Maps (placeholder - requires API key)
 */
function MapaSucursales({ sucursales }) {
  return (
    <div style={{ background: colors.bgCard, borderRadius: 8, padding: 16, minHeight: 300 }}>
      <h3 style={{ margin: '0 0 16px 0', color: colors.text, fontSize: 14 }}>🗺️ Ubicaciones de Sucursales</h3>
      <div style={{ color: colors.textDim, fontSize: 12 }}>
        ⚠️ Requiere configuración de Google Maps API
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: colors.textDim }}>
        <p>Sucursales activas:</p>
        {sucursales.map(s => (
          <div key={s.id} style={{ padding: '4px 0' }}>
            📍 {s.nombre} (ID: {s.store_code})
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * CorrecionesModal: Manual adjustments for attendance
 */
function CorrecionesModal({ sucursal, user }) {
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [razon, setRazon] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    db.from('asistencia_gps')
      .select('*, empleados(nombre_completo)')
      .eq('sucursal_id', sucursal)
      .order('timestamp_checkin', { ascending: false })
      .limit(30)
      .then(({ data }) => setRegistros(data || []))
      .catch(err => console.error('Error:', err))
      .finally(() => setLoading(false));
  }, [sucursal]);

  const handleAjuste = async () => {
    if (!selectedId || !razon.trim()) {
      alert('Selecciona registro y proporciona razón');
      return;
    }

    setSaving(true);
    try {
      await db.from('asistencia_gps').update({
        ajuste_manual_por: user?.id,
        ajuste_manual_timestamp: new Date().toISOString(),
        ajuste_razon: razon,
      }).eq('id', selectedId);

      alert('Ajuste registrado ✅');
      setSelectedId(null);
      setRazon('');

      // Recargar
      const { data } = await db.from('asistencia_gps')
        .select('*, empleados(nombre_completo)')
        .eq('sucursal_id', sucursal)
        .order('timestamp_checkin', { ascending: false })
        .limit(30);
      setRegistros(data || []);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: colors.textDim }}>⏳ Cargando...</div>;

  return (
    <div>
      <div style={{ background: colors.bgCard, borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px 0', color: colors.text, fontSize: 14 }}>✏️ Ajustes Manuales</h3>

        <select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bg,
            color: colors.text,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          <option value="">Selecciona un registro...</option>
          {registros.map(r => (
            <option key={r.id} value={r.id}>
              {r.empleados?.nombre_completo} - {new Date(r.timestamp_checkin).toLocaleString('es-SV')}
            </option>
          ))}
        </select>

        <textarea
          value={razon}
          onChange={(e) => setRazon(e.target.value)}
          placeholder="Razón del ajuste..."
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bg,
            color: colors.text,
            fontSize: 12,
            minHeight: 60,
            marginBottom: 12,
            fontFamily: 'inherit',
          }}
        />

        <button
          onClick={handleAjuste}
          disabled={saving || !selectedId}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 6,
            background: selectedId ? colors.green : colors.textDim,
            color: '#000',
            border: 'none',
            cursor: selectedId ? 'pointer' : 'not-allowed',
            fontSize: 12,
            fontWeight: 700,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? '⏳ Guardando...' : '💾 Guardar Ajuste'}
        </button>
      </div>
    </div>
  );
}
