import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db } from '../../supabase';

// ── #7 DESPACHO GPS ──────────────────────────────────────────────────
// Motoristas de despacho interno (CM→sucursales): posición en vivo en mapa,
// beacon GPS propio (reusa actualizar_ubicacion_driver), y mandados con bitácora.
// Reutiliza driver_ubicaciones/driver_recorrido del sistema de delivery.
const C = { card:'#1a1a1a', border:'#2a2a2a', text:'#f0f0f0', dim:'#8a8a8a',
  green:'#4ade80', red:'#e63946', yellow:'#fbbf24', blue:'#60a5fa', panel:'#111' };
const ROLES_MOTO = ['motorista', 'despachador'];
const FRESH_MS = 90_000; // considerar en línea si actualizó hace < 90s

const EST = {
  pendiente: { label:'Pendiente', color:C.yellow, bg:'#3a2f0f' },
  en_curso:  { label:'En curso',  color:C.blue,   bg:'#12233a' },
  hecho:     { label:'Hecho',     color:C.green,  bg:'#123020' },
  cancelado: { label:'Cancelado', color:C.dim,    bg:'#222' },
};

export default function DespachoGPS({ user }) {
  const esMoto = ROLES_MOTO.includes(user?.rol);
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef({});
  const [online, setOnline] = useState([]);
  const [mandados, setMandados] = useState([]);
  const [broadcasting, setBroadcasting] = useState(false);
  const watchId = useRef(null);
  const lastSent = useRef(0);
  const [nuevo, setNuevo] = useState(false);

  // ── posición actual (para sellar mandados) ──
  const getPos = () => new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => res(null), { enableHighAccuracy: true, timeout: 6000 });
  });

  // ── mapa ──
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: true }).setView([13.6929, -89.2182], 12); // SS
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markers.current = {}; };
  }, []);

  const cargarOnline = useCallback(async () => {
    const { data } = await db.from('driver_ubicaciones').select('empleado_id,nombre,lat,lng,rumbo,updated_at,en_linea').eq('en_linea', true);
    const now = Date.now();
    const frescos = (data || []).filter(d => d.lat && d.lng && (now - new Date(d.updated_at).getTime()) < FRESH_MS);
    setOnline(frescos);
  }, []);

  const cargarMandados = useCallback(async () => {
    const { data } = await db.rpc('listar_mandados', { p_dias: 3, p_motorista_id: null });
    setMandados(data || []);
  }, []);

  useEffect(() => {
    cargarOnline(); cargarMandados();
    const ch = db.channel('despacho-gps')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_ubicaciones' }, cargarOnline)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mandados' }, cargarMandados)
      .subscribe();
    const iv = setInterval(cargarOnline, 30_000);
    return () => { db.removeChannel(ch); clearInterval(iv); };
  }, [cargarOnline, cargarMandados]);

  // pintar markers
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const vivos = new Set(online.map(o => o.empleado_id));
    Object.keys(markers.current).forEach(id => { if (!vivos.has(id)) { map.removeLayer(markers.current[id]); delete markers.current[id]; } });
    online.forEach(o => {
      const ll = [o.lat, o.lng];
      if (markers.current[o.empleado_id]) markers.current[o.empleado_id].setLatLng(ll);
      else markers.current[o.empleado_id] = L.marker(ll).addTo(map).bindTooltip(o.nombre || 'Motorista', { permanent: false });
    });
    if (online.length) { try { map.fitBounds(online.map(o => [o.lat, o.lng]), { padding: [40, 40], maxZoom: 15 }); } catch { /* noop */ } }
  }, [online]);

  // ── beacon GPS ──
  const toggleBeacon = async () => {
    if (broadcasting) {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      await db.rpc('desconectar_driver', { p_empleado_id: user.id }).catch(() => {});
      setBroadcasting(false);
      return;
    }
    if (!navigator.geolocation) { alert('Este dispositivo no tiene GPS'); return; }
    watchId.current = navigator.geolocation.watchPosition(async (p) => {
      const now = Date.now();
      if (now - lastSent.current < 4000) return; // throttle 4s
      lastSent.current = now;
      await db.rpc('actualizar_ubicacion_driver', {
        p_empleado_id: user.id, p_nombre: user.nombre || 'Motorista',
        p_lat: p.coords.latitude, p_lng: p.coords.longitude,
        p_rumbo: p.coords.heading || null, p_exactitud: p.coords.accuracy || null,
      }).catch(() => {});
    }, (e) => { alert('GPS: ' + e.message); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
    setBroadcasting(true);
  };
  useEffect(() => () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); }, []);

  // ── mandados ──
  const crearMandado = async (descripcion, prioridad) => {
    const pos = await getPos();
    await db.rpc('crear_mandado', {
      p_descripcion: descripcion, p_prioridad: prioridad,
      p_motorista_id: esMoto ? user.id : null, p_motorista_nombre: esMoto ? (user.nombre || null) : null,
      p_creado_por: user.id, p_lat: pos?.lat || null, p_lng: pos?.lng || null,
    });
    setNuevo(false); cargarMandados();
  };
  const cambiarEstado = async (m, estado) => {
    let monto = null, notas = null;
    if (estado === 'hecho') {
      const mo = window.prompt('Gasto del mandado ($) — opcional, dejá vacío si no aplica:', '');
      if (mo && !isNaN(Number(mo))) monto = Number(mo);
      notas = window.prompt('Nota / bitácora (opcional):', '') || null;
    }
    const pos = await getPos();
    await db.rpc('mandado_estado', { p_id: m.id, p_estado: estado, p_lat: pos?.lat || null, p_lng: pos?.lng || null, p_monto: monto, p_notas: notas });
    cargarMandados();
  };

  const hora = (t) => t ? new Date(t).toLocaleString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div style={{ padding: 14, color: C.text, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>🛵 Despacho — Motoristas</div>
        <div style={{ flex: 1 }} />
        {esMoto && (
          <button onClick={toggleBeacon} style={{ background: broadcasting ? C.red : C.green, color: broadcasting ? '#fff' : '#04220f',
            border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 800, cursor: 'pointer' }}>
            {broadcasting ? '⏹️ Detener GPS' : '📍 Compartir mi ubicación'}
          </button>
        )}
      </div>

      {/* Mapa en vivo */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <div ref={mapEl} style={{ height: '42vh', minHeight: 260, borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }} />
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 500, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11, padding: '4px 8px', borderRadius: 8 }}>
          🟢 {online.length} en línea
        </div>
      </div>
      {online.length === 0 && <div style={{ color: C.dim, fontSize: 12, marginBottom: 8 }}>Ningún motorista compartiendo ubicación ahora.</div>}

      {/* Mandados / bitácora */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>📋 Mandados <span style={{ fontSize: 11, color: C.dim, fontWeight: 400 }}>(bitácora últimos 3 días)</span></div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setNuevo(true)} style={{ background: '#333', color: C.text, border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' }}>+ Nuevo mandado</button>
      </div>

      {nuevo && <NuevoMandado onCancel={() => setNuevo(false)} onCrear={crearMandado} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mandados.length === 0 && <div style={{ color: C.dim, textAlign: 'center', padding: 20 }}>Sin mandados en el rango.</div>}
        {mandados.map(m => {
          const e = EST[m.estado] || EST.pendiente;
          return (
            <div key={m.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{m.prioridad === 'urgente' && '🔴 '}{m.descripcion}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                    {m.motorista_nombre ? `🛵 ${m.motorista_nombre} · ` : ''}{hora(m.created_at)}
                    {m.completado_at && ` → ✅ ${hora(m.completado_at)}`}
                    {m.monto != null && ` · 💵 $${Number(m.monto).toFixed(2)}`}
                  </div>
                  {m.notas && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>📝 {m.notas}</div>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: e.color, background: e.bg, padding: '3px 8px', borderRadius: 12 }}>{e.label}</span>
              </div>
              {m.estado !== 'hecho' && m.estado !== 'cancelado' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {m.estado === 'pendiente' && <button onClick={() => cambiarEstado(m, 'en_curso')} style={btn(C.blue)}>▶ Tomar</button>}
                  <button onClick={() => cambiarEstado(m, 'hecho')} style={btn(C.green)}>✓ Hecho</button>
                  <button onClick={() => cambiarEstado(m, 'cancelado')} style={btn('#555')}>Cancelar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NuevoMandado({ onCancel, onCrear }) {
  const [desc, setDesc] = useState('');
  const [prio, setPrio] = useState('normal');
  const [busy, setBusy] = useState(false);
  const crear = async () => { if (!desc.trim()) return; setBusy(true); await onCrear(desc.trim(), prio); setBusy(false); };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <input autoFocus value={desc} onChange={e => setDesc(e.target.value)} placeholder="¿Qué hay que hacer? (ej. Comprar hielo en Super Selectos)"
        style={{ width: '100%', boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: '#fff', fontSize: 13, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={prio} onChange={e => setPrio(e.target.value)} style={{ background: C.panel, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 13 }}>
          <option value="normal">Normal</option>
          <option value="urgente">🔴 Urgente</option>
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} style={btn('#555')}>Cancelar</button>
        <button onClick={crear} disabled={busy || !desc.trim()} style={{ ...btn(C.green), color: '#04220f' }}>{busy ? 'Guardando…' : 'Crear'}</button>
      </div>
    </div>
  );
}

const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
