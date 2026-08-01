// ────────────────────────────────────────────────────────────────────
// Torre de control · Zona de cobertura por sucursal (polígonos editables)
// Mapa Leaflet + OpenStreetMap (sin API key) + leaflet-geoman para dibujar
// y editar el polígono moviendo las puntas. Se guarda como GeoJSON en
// sucursales.cobertura_geojson (RPC guardar_cobertura_sucursal). El ruteo
// (sucursal_mas_cercana) prefiere el polígono; sin polígono usa radio ≤20km.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { db } from '../../supabase';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

const RED = '#e63946';
const CENTRO_SV = [13.72, -89.20];

const TOKEN_KEY = 'freakie_torre_token';

export default function TabCobertura({ show = () => {} }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const polyRef = useRef(null);
  const markersRef = useRef([]);
  const driversRef = useRef({}); // empleado_id → L.marker
  const [sucursales, setSucursales] = useState([]);
  const [selId, setSelId] = useState('');
  const [msg, setMsg] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [nDrivers, setNDrivers] = useState(0);
  const radiosRef = useRef([]);   // círculos que muestran hasta dónde se pueden marcar de turno

  // Init del mapa (una vez) + carga de sucursales
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: true }).setView(CENTRO_SV, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);

    db.from('sucursales')
      // Solo las que reparten. Si algún día se enciende el delivery de otra
      // sucursal, aparece acá sola.
      .select('id,store_code,nombre,lat,lng,cobertura_geojson,radio_alta_m')
      .eq('tiene_delivery', true).eq('activa', true)
      .then(({ data }) => {
        const list = (data || []).filter(s => s.lat != null && s.lng != null);
        setSucursales(list);
        if (list[0]) setSelId(list[0].id);
      });

    // ── Drivers en vivo (Realtime + polling de respaldo) ────────────
    const drivers = driversRef.current;
    const FRESCO_MS = 15 * 60 * 1000; // 15 min sin señal = se cae del mapa
    const quitar = (id) => { if (id && drivers[id]) { drivers[id].remove(); delete drivers[id]; setNDrivers(Object.keys(drivers).length); } };
    const upsert = (r) => {
      if (!r || r.lat == null || r.lng == null) return;
      if (r.en_linea === false) { quitar(r.empleado_id); return; }
      const ll = [r.lat, r.lng];
      // Rodando = mandó GPS hace poco. Si no, es la posición con la que se
      // marcó de turno: está en la sucursal esperando.
      const rodando = Date.now() - new Date(r.updated_at).getTime() < 90 * 1000;
      const etiqueta = `${rodando ? '🛵' : '🅿️'} ${r.nombre || 'Motorista'}` +
                       (rodando ? ' — en ruta' : ' — en la sucursal');
      const html = rodando
        ? '<div style="font-size:24px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))">🛵</div>'
        : '<div style="font-size:19px;opacity:.75;filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))">🅿️</div>';

      if (drivers[r.empleado_id]) {
        drivers[r.empleado_id].setLatLng(ll).setTooltipContent(etiqueta)
          .setIcon(L.divIcon({ className: 'fk-driver', html, iconSize: [28, 28], iconAnchor: [14, 14] }));
      } else {
        drivers[r.empleado_id] = L.marker(ll, {
          icon: L.divIcon({ className: 'fk-driver', html, iconSize: [28, 28], iconAnchor: [14, 14] }),
          zIndexOffset: 1000,
        }).addTo(map).bindTooltip(etiqueta);
      }
      setNDrivers(Object.keys(drivers).length);
    };

    // Polling de respaldo: refleja el estado real de la DB aunque Realtime
    // falle o el driver emita esporádicamente. Reconcilia (agrega/actualiza/quita).
    const refrescar = async () => {
      const { data } = await db.from('driver_ubicaciones').select('*').eq('en_linea', true);
      const frescos = (data || []).filter(r => r.lat != null && Date.now() - new Date(r.updated_at).getTime() < FRESCO_MS);
      const vivos = new Set(frescos.map(r => r.empleado_id));
      frescos.forEach(upsert);
      Object.keys(drivers).forEach(id => { if (!vivos.has(id)) quitar(id); }); // se cayeron / stale
    };
    refrescar();
    const poll = setInterval(refrescar, 15000);

    const canal = db.channel('torre-drivers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_ubicaciones' }, (p) => {
        if (p.eventType === 'DELETE') quitar(p.old?.empleado_id);
        else upsert(p.new);
      })
      .subscribe();

    return () => { clearInterval(poll); db.removeChannel(canal); map.remove(); mapRef.current = null; };
  }, []);

  // Marcadores de las sucursales — ARRASTRABLES.
  // De este punto depende que los motoristas puedan marcarse de turno, y las
  // coordenadas venían cargadas a ojo. El círculo muestra hasta dónde alcanza.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sucursales.length) return;
    markersRef.current.forEach(m => m.remove());
    radiosRef.current.forEach(c => c.remove());

    radiosRef.current = sucursales.map(s =>
      L.circle([s.lat, s.lng], {
        radius: s.radio_alta_m || 100, color: '#fbbf24', weight: 2,
        fillColor: '#fbbf24', fillOpacity: 0.15, dashArray: '6 5', interactive: false,
      }).addTo(map)
    );

    markersRef.current = sucursales.map((s, i) => {
      // Alfiler dibujado a mano: el marcador que trae Leaflet depende de una
      // imagen que el empaquetador no incluye, y salía roto.
      const icon = L.divIcon({
        className: '',
        iconSize: [30, 42],
        iconAnchor: [15, 42],
        tooltipAnchor: [0, -38],
        html: `
          <div style="position:relative;width:30px;height:42px;cursor:grab;">
            <div style="
              position:absolute;left:3px;top:0;width:24px;height:24px;
              background:${RED};border:2.5px solid #fff;border-radius:50% 50% 50% 0;
              transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.55);"></div>
            <div style="
              position:absolute;left:0;top:24px;width:30px;text-align:center;
              font:700 10px/12px system-ui,sans-serif;color:#fff;
              text-shadow:0 1px 3px rgba(0,0,0,.9);">${s.store_code}</div>
          </div>`,
      });

      const m = L.marker([s.lat, s.lng], { draggable: true, autoPan: true, icon })
        .addTo(map)
        .bindTooltip(`${s.store_code} · ${s.nombre} — arrastralo para corregirlo`);

      m.on('drag', (e) => radiosRef.current[i]?.setLatLng(e.latlng));

      m.on('dragend', async (e) => {
        const { lat, lng } = e.target.getLatLng();
        const token = localStorage.getItem(TOKEN_KEY) || '';
        try {
          const { error } = await db.rpc('torre_guardar_ubicacion_sucursal', {
            p_token: token, p_sucursal_id: s.id, p_lat: lat, p_lng: lng, p_radio: null,
          });
          if (error) throw error;
          setSucursales(prev => prev.map(x => x.id === s.id ? { ...x, lat, lng } : x));
          show(`📍 ${s.nombre} movida`);
        } catch (err) {
          // Se devuelve al lugar anterior para no dejar en pantalla algo que no se guardó
          m.setLatLng([s.lat, s.lng]);
          radiosRef.current[i]?.setLatLng([s.lat, s.lng]);
          show('❌ ' + (err.message || 'No se pudo mover'));
        }
      });
      return m;
    });

    const grp = L.featureGroup(markersRef.current);
    try { map.fitBounds(grp.getBounds().pad(0.3)); } catch { /* 1 punto */ }
  }, [sucursales]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar el polígono de la sucursal seleccionada (editable)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selId) return;
    map.pm && map.pm.disableDraw();
    if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }
    const s = sucursales.find(x => x.id === selId);
    const ring = s?.cobertura_geojson?.coordinates?.[0];
    if (ring && ring.length >= 4) {
      const latlngs = ring.slice(0, -1).map(([lng, lat]) => [lat, lng]); // GeoJSON=[lng,lat]
      const poly = L.polygon(latlngs, { color: RED, weight: 2, fillOpacity: 0.12 }).addTo(map);
      poly.pm.enable({ allowSelfIntersection: false });
      polyRef.current = poly;
      try { map.fitBounds(poly.getBounds().pad(0.2)); } catch { /* noop */ }
    } else if (s) {
      map.setView([s.lat, s.lng], 13);
    }
    setMsg('');
  }, [selId, sucursales]);

  const dibujar = () => {
    const map = mapRef.current;
    if (!map) return;
    if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }
    map.pm.enableDraw('Polygon', {
      snappable: true,
      templineStyle: { color: RED },
      hintlineStyle: { color: RED, dashArray: '5,5' },
      pathOptions: { color: RED, fillOpacity: 0.12 },
    });
    map.once('pm:create', (e) => {
      map.pm.disableDraw();
      polyRef.current = e.layer;
      e.layer.pm.enable({ allowSelfIntersection: false });
      setMsg('Zona dibujada. Movés las puntas para ajustar y luego «Guardar».');
    });
    setMsg('Tocá el mapa para marcar cada punta. Cerrá haciendo clic en el primer punto.');
  };

  const guardar = async () => {
    if (!selId) return;
    const geo = polyRef.current ? polyRef.current.toGeoJSON().geometry : null;
    setGuardando(true);
    try {
      const { error } = await db.rpc('guardar_cobertura_sucursal', { p_sucursal_id: selId, p_geojson: geo });
      if (error) throw error;
      setSucursales(prev => prev.map(s => s.id === selId ? { ...s, cobertura_geojson: geo } : s));
      setMsg('✅ Zona guardada');
      show('✅ Zona de cobertura guardada');
    } catch (e) {
      setMsg('❌ No se pudo guardar: ' + (e.message || ''));
    } finally { setGuardando(false); }
  };

  const quitar = async () => {
    if (!selId) return;
    if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }
    setGuardando(true);
    try {
      await db.rpc('guardar_cobertura_sucursal', { p_sucursal_id: selId, p_geojson: null });
      setSucursales(prev => prev.map(s => s.id === selId ? { ...s, cobertura_geojson: null } : s));
      setMsg('Zona quitada — esta sucursal vuelve a cobertura por radio (≤20 km).');
    } finally { setGuardando(false); }
  };

  const sel = sucursales.find(s => s.id === selId);
  const tienePoly = !!sel?.cobertura_geojson;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5, flex: 1, minWidth: 240 }}>
          Dibujá la zona de reparto de cada sucursal como un polígono y movés las puntas para ajustarla.
          Un pedido se rutea a la sucursal cuyo polígono lo contiene. Sin polígono, la sucursal cubre por radio (≤20 km).
          <br />
          <b style={{ color: '#f0f0f0' }}>📍 Los alfileres son las sucursales: arrastralos hasta el local exacto.</b>{' '}
          El círculo punteado marca hasta dónde puede un motorista marcarse de turno. Se guarda solo al soltar.
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: nDrivers > 0 ? '#4ade80' : '#888', whiteSpace: 'nowrap' }}>
          🛵 {nDrivers} en línea
        </div>
      </div>

      {/* Selector de sucursal */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {sucursales.map(s => (
          <button key={s.id} onClick={() => setSelId(s.id)} style={{
            padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            background: selId === s.id ? RED : '#222',
            color: selId === s.id ? '#fff' : '#aaa',
          }}>
            {s.store_code} {s.cobertura_geojson ? '▨' : '○'}
          </button>
        ))}
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <button onClick={dibujar} disabled={!selId} style={bt('#2563eb')}>
          {tienePoly ? '✏️ Redibujar zona' : '✏️ Dibujar zona'}
        </button>
        <button onClick={guardar} disabled={!selId || guardando} style={bt(RED)}>
          {guardando ? 'Guardando…' : '💾 Guardar'}
        </button>
        <button onClick={quitar} disabled={!selId || guardando || !tienePoly} style={bt('#444')}>
          🗑️ Quitar zona
        </button>
        {sel && <span style={{ fontSize: 12, color: '#888' }}>{sel.nombre}</span>}
      </div>

      {msg && <div style={{ fontSize: 12, color: '#cbd5e1', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>{msg}</div>}

      {/* Mapa */}
      <div ref={mapEl} style={{ height: '62vh', minHeight: 380, borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a2a' }} />

      <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
        ▨ = tiene polígono · ○ = por radio · 🛵 en ruta · 🅿️ en la sucursal. Mapa © OpenStreetMap.
      </div>
    </div>
  );
}

const bt = (bg, fg = '#fff') => ({
  padding: '9px 14px', borderRadius: 8, background: bg, color: fg, border: 'none',
  cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: 1,
});
