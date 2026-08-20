// ────────────────────────────────────────────────────────────────────
// Torre de control · Mapa en vivo
// Vista de dueño para Karina: todos los pedidos activos como puntos +
// motoristas con GPS + rutas trazadas + ETAs calculados (Haversine × 2.4 min/km).
// Refresh cada 15s. Al tocar un marcador se abre popup con detalle y
// botón de WhatsApp / tracking.
// Cesar 20-ago-2026 — Fase 1 (cálculo simple, gratis). Fase 2 opcional:
// Google Distance Matrix API para tráfico real.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '../../supabase';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const CENTRO_SV = [13.72, -89.20];
const TOKEN_KEY = 'freakie_torre_token';
const REFRESH_MS = 15000;

const COLORS = {
  motoristaLibre: '#16a34a',    // verde
  motoristaOcupado: '#e63946',  // rojo
  pedidoSinCobrar: '#9ca3af',   // gris — recibida
  pedidoEnCocina: '#9ca3af',    // gris — preparando
  pedidoPorAsignar: '#f59e0b',  // amarillo — lista
  pedidoEnCamino: '#e63946',    // rojo — en_camino
  sucursal: '#1e40af',          // azul
  ruta: '#e63946',              // rojo punteado
};

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const waHref = (tel) => {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length < 8) return null;
  return `https://wa.me/${d.length === 8 ? '503' + d : d}`;
};

// ── Iconos custom (divIcons) ────────────────────────────────────────
function iconMotorista({ nombre, pedidos, libre }) {
  const color = libre ? COLORS.motoristaLibre : COLORS.motoristaOcupado;
  const badge = !libre
    ? `<span style="position:absolute;top:-4px;right:-4px;background:#fff;color:${color};border-radius:50%;width:14px;height:14px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:1px solid ${color};">${pedidos}</span>`
    : '';
  return L.divIcon({
    className: 'fk-mot',
    html: `<div style="position:relative;display:flex;flex-direction:column;align-items:center;">
      <div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);"></div>
      ${badge}
      <div style="font-size:10px;font-weight:600;color:${libre ? '#065f46' : '#7f1d1d'};background:rgba(255,255,255,.85);padding:1px 5px;border-radius:4px;margin-top:2px;white-space:nowrap;">${nombre}</div>
    </div>`,
    iconSize: [80, 40],
    iconAnchor: [40, 11],
  });
}

function iconPedido({ estado, tieneMotorista }) {
  let color = COLORS.pedidoSinCobrar;
  let label = '';
  if (estado === 'recibida') { color = COLORS.pedidoSinCobrar; label = 'Sin cobrar'; }
  else if (estado === 'preparando') { color = COLORS.pedidoEnCocina; label = 'En cocina'; }
  else if (estado === 'lista' && !tieneMotorista) { color = COLORS.pedidoPorAsignar; label = 'Por asignar'; }
  else if (estado === 'lista' && tieneMotorista) { color = COLORS.pedidoEnCamino; label = 'Asignado'; }
  else if (estado === 'en_camino') { color = COLORS.pedidoEnCamino; label = 'En camino'; }
  return L.divIcon({
    className: 'fk-ped',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4);" title="${label}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function iconSucursal({ store_code }) {
  return L.divIcon({
    className: 'fk-suc',
    html: `<div style="width:22px;height:22px;background:${COLORS.sucursal};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.5);">${store_code.slice(-2)}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// ═══════════════════════════════════════════════════════════════════
export default function TabMapaVivo({ show = () => {} }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layerMotoristas = useRef(null);
  const layerPedidos = useRef(null);
  const layerSucursales = useRef(null);
  const layerRutas = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ultimaAct, setUltimaAct] = useState(null);

  // ── Init del mapa (una vez) ───────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: true }).setView(CENTRO_SV, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;
    layerSucursales.current = L.layerGroup().addTo(map);
    layerRutas.current = L.layerGroup().addTo(map);
    layerPedidos.current = L.layerGroup().addTo(map);
    layerMotoristas.current = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // ── Carga de datos vía RPC ────────────────────────────────────────
  const cargar = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setError('No hay sesión de Torre. Volvé a entrar.'); return; }
    try {
      const { data: res, error: e } = await db.rpc('torre_mapa_vivo', { p_token: token });
      if (e) throw e;
      if (!res?.ok) throw new Error('Respuesta inválida');
      setData(res);
      setUltimaAct(new Date());
      setError('');
    } catch (ex) {
      setError(ex.message || 'No se pudo cargar el mapa');
    }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cargar]);

  // ── Re-render de marcadores cuando cambia data ────────────────────
  useEffect(() => {
    if (!mapRef.current || !data) return;
    const map = mapRef.current;

    // Limpiar layers
    layerSucursales.current.clearLayers();
    layerPedidos.current.clearLayers();
    layerMotoristas.current.clearLayers();
    layerRutas.current.clearLayers();

    // Sucursales
    for (const s of data.sucursales || []) {
      L.marker([s.lat, s.lng], { icon: iconSucursal({ store_code: s.store_code }) })
        .bindTooltip(`🏪 ${s.nombre}`, { direction: 'top' })
        .addTo(layerSucursales.current);
    }

    // Índice de motoristas por id (para trazar rutas)
    const motMap = new Map();
    for (const m of data.motoristas || []) motMap.set(m.empleado_id, m);

    // Pedidos + rutas
    for (const p of data.pedidos || []) {
      if (p.cliente_lat == null || p.cliente_lng == null) continue;
      const tieneMot = !!p.motorista_id;
      const marker = L.marker([p.cliente_lat, p.cliente_lng], {
        icon: iconPedido({ estado: p.estado, tieneMotorista: tieneMot }),
      });

      const wa = waHref(p.cliente_telefono);
      const trackUrl = p.tracking_token ? `/track?t=${p.tracking_token}` : null;
      const etaTxt = p.eta_min != null ? `<div style="color:#e63946;font-weight:700;">🕐 ETA ${p.eta_min} min · ${p.distancia_km} km</div>` : '';
      const motTxt = p.motorista_nombre ? `<div>🛵 ${p.motorista_nombre}</div>` : '<div style="color:#666;">Sin motorista asignado</div>';
      marker.bindPopup(`
        <div style="min-width:200px;font-size:12px;">
          <div style="font-weight:700;font-size:13px;">${p.numero_orden}</div>
          <div>${p.cliente_nombre || 'Cliente'} · ${fmt(p.total)}</div>
          <div style="color:#555;">${p.cliente_direccion || ''}</div>
          ${motTxt}
          ${etaTxt}
          <div style="margin-top:6px;display:flex;gap:6px;">
            ${wa ? `<a href="${wa}" target="_blank" style="background:#25D366;color:#04220f;padding:3px 8px;border-radius:4px;text-decoration:none;font-weight:600;">WhatsApp</a>` : ''}
            ${trackUrl ? `<a href="${trackUrl}" target="_blank" style="background:#2563eb;color:#fff;padding:3px 8px;border-radius:4px;text-decoration:none;font-weight:600;">Tracking</a>` : ''}
          </div>
        </div>
      `);
      marker.addTo(layerPedidos.current);

      // Trazar ruta motorista → pedido si en_camino y tenemos GPS del driver
      if (p.estado === 'en_camino' && p.driver_lat != null && p.driver_lng != null) {
        L.polyline(
          [[p.driver_lat, p.driver_lng], [p.cliente_lat, p.cliente_lng]],
          { color: COLORS.ruta, weight: 2.5, opacity: 0.85, dashArray: '6,4' }
        ).addTo(layerRutas.current);
      }
    }

    // Motoristas
    for (const m of data.motoristas || []) {
      if (m.lat == null || m.lng == null) continue;
      const libre = (m.pedidos_activos || 0) === 0;
      const nombreCorto = (m.nombre || '').split(' ')[0];
      const marker = L.marker([m.lat, m.lng], {
        icon: iconMotorista({ nombre: nombreCorto, pedidos: m.pedidos_activos, libre }),
        zIndexOffset: 500,
      });
      const etaRegreso = !libre && m.eta_regreso_min != null
        ? `<div style="color:#059669;">↩ Regreso a ${m.sucursal_nombre}: ${m.eta_regreso_min} min</div>`
        : '';
      const secs = m.seg_desde_ultima || 0;
      const gpsFresco = secs < 60 ? `hace ${secs}s` : secs < 3600 ? `hace ${Math.round(secs/60)} min` : `hace ${Math.round(secs/3600)} h`;
      marker.bindPopup(`
        <div style="min-width:180px;font-size:12px;">
          <div style="font-weight:700;font-size:13px;">🛵 ${m.nombre}</div>
          <div>🏪 ${m.sucursal_nombre || 'Sin sucursal'}</div>
          <div>${libre ? '🟢 Disponible' : `🔴 ${m.pedidos_activos} pedido(s) activo(s)`}</div>
          <div style="color:#666;">GPS ${gpsFresco}</div>
          ${etaRegreso}
        </div>
      `);
      marker.addTo(layerMotoristas.current);
    }
  }, [data]);

  // ── Contadores para el panel ─────────────────────────────────────
  const stats = data ? {
    pedidosTot: (data.pedidos || []).length,
    porCobrar: (data.pedidos || []).filter(p => p.estado === 'recibida').length,
    enCocina: (data.pedidos || []).filter(p => p.estado === 'preparando').length,
    porAsignar: (data.pedidos || []).filter(p => p.estado === 'lista' && !p.motorista_id).length,
    enCamino: (data.pedidos || []).filter(p => p.estado === 'en_camino').length,
    motTot: (data.motoristas || []).length,
    motLibres: (data.motoristas || []).filter(m => (m.pedidos_activos || 0) === 0).length,
    motOcupados: (data.motoristas || []).filter(m => (m.pedidos_activos || 0) > 0).length,
  } : null;

  const S = {
    card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 12 },
    kpi: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#f0f0f0' },
    dot: (bg) => ({ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: bg, flexShrink: 0 }),
    num: { fontWeight: 800, minWidth: 20, textAlign: 'right', color: '#f0f0f0' },
  };

  return (
    <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 180px)', minHeight: 500 }}>
      {/* Mapa */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
        <div ref={mapEl} style={{ width: '100%', height: '100%', background: '#222' }} />
        {ultimaAct && (
          <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,.75)', color: '#4ade80',
                        fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, zIndex: 500 }}>
            ● en vivo · actualizado {ultimaAct.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: '#7f1d1d', color: '#fff',
                        fontSize: 12, padding: '6px 10px', borderRadius: 6, zIndex: 500 }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* Panel lateral */}
      <div style={{ width: 240, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
        {stats ? (
          <>
            <div style={S.card}>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 700, marginBottom: 10 }}>PEDIDOS ACTIVOS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={S.kpi}><span style={S.dot(COLORS.pedidoSinCobrar)} /> Sin cobrar <span style={{ ...S.num, marginLeft: 'auto' }}>{stats.porCobrar}</span></div>
                <div style={S.kpi}><span style={S.dot(COLORS.pedidoEnCocina)} /> En cocina <span style={{ ...S.num, marginLeft: 'auto' }}>{stats.enCocina}</span></div>
                <div style={S.kpi}><span style={S.dot(COLORS.pedidoPorAsignar)} /> Por asignar <span style={{ ...S.num, marginLeft: 'auto' }}>{stats.porAsignar}</span></div>
                <div style={S.kpi}><span style={S.dot(COLORS.pedidoEnCamino)} /> En camino <span style={{ ...S.num, marginLeft: 'auto' }}>{stats.enCamino}</span></div>
                <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 6, marginTop: 2, fontSize: 12, color: '#888', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Total</span><span style={{ color: '#f0f0f0', fontWeight: 800 }}>{stats.pedidosTot}</span>
                </div>
              </div>
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 700, marginBottom: 10 }}>MOTORISTAS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={S.kpi}><span style={S.dot(COLORS.motoristaLibre)} /> Disponibles <span style={{ ...S.num, marginLeft: 'auto' }}>{stats.motLibres}</span></div>
                <div style={S.kpi}><span style={S.dot(COLORS.motoristaOcupado)} /> En ruta <span style={{ ...S.num, marginLeft: 'auto' }}>{stats.motOcupados}</span></div>
                <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 6, marginTop: 2, fontSize: 12, color: '#888', display: 'flex', justifyContent: 'space-between' }}>
                  <span>En línea</span><span style={{ color: '#f0f0f0', fontWeight: 800 }}>{stats.motTot}</span>
                </div>
              </div>
              {stats.motTot === 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#f59e0b', lineHeight: 1.4 }}>
                  Ningún motorista compartiendo GPS. Recordales tocar "🟢 Compartir mi GPS" al inicio del turno.
                </div>
              )}
            </div>

            <div style={{ ...S.card, fontSize: 11, color: '#888', lineHeight: 1.5 }}>
              <div style={{ marginBottom: 6, fontWeight: 700, color: '#f0f0f0' }}>ETAs</div>
              Cálculo simple: distancia recta × 2.4 min/km (≈25 km/h en tráfico). Precisión ±5-10 min.
            </div>
          </>
        ) : (
          <div style={S.card}>Cargando…</div>
        )}
      </div>
    </div>
  );
}
