// ────────────────────────────────────────────────────────────────────
// Torre · Mapa de asignación
// Va dentro de la pestaña de Pedidos, debajo de las cuatro columnas.
// Sirve para una sola cosa: decidir a quién le toca cada pedido viendo
// dónde está todo, en vez de elegir a ciegas de una lista.
//
// Al tocar un pedido sin asignar, el panel de la derecha muestra a los
// motoristas ordenados por conveniencia, con el porqué escrito en palabras.
// El orden es sugerencia: cualquiera de la lista se puede asignar.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '../../supabase';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { km, ordenarRuta, pedidosPorMotorista as agruparPorMotorista, MIN_POR_KM } from './rutaOrden';

const TOKEN_KEY = 'freakie_torre_token';
const REFRESH_MS = 20000;
const PENAL_POR_PEDIDO = 8;  // minutos que "cuesta" cada pedido que ya lleva encima

const C = {
  card: '#1a1a1a', border: '#2a2a2a', text: '#f0f0f0', dim: '#8a8a8a',
  amarillo: '#f59e0b', rojo: '#e63946', verde: '#16a34a', azul: '#2563eb',
};

// Qué tan conveniente es cada motorista para un pedido. Todo en minutos para
// que las tres cosas se puedan sumar y comparar:
//   · cuánto tarda en llegar
//   · cuánto le pesa lo que ya lleva encima
//   · cuánto se desvía de donde ya iba (si el pedido le queda de paso, casi nada)
function rankearMotoristas(pedido, motoristas, pedidosPorMotorista) {
  return motoristas
    .filter(m => m.lat != null && m.lng != null)
    .map(m => {
      const dist = km(m.lat, m.lng, pedido.cliente_lat, pedido.cliente_lng);
      const llegada = dist * MIN_POR_KM;
      const carga = (m.pedidos_activos || 0) + (m.pedidos_asignados || 0);

      // Desvío: comparar ir directo a lo suyo contra pasar antes por el nuevo.
      let desvio = 0;
      let dePaso = false;
      const suyos = pedidosPorMotorista.get(m.empleado_id) || [];
      if (suyos.length > 0) {
        const primero = suyos[0];
        const directo = km(m.lat, m.lng, primero.cliente_lat, primero.cliente_lng);
        const conEscala = dist + km(pedido.cliente_lat, pedido.cliente_lng,
                                    primero.cliente_lat, primero.cliente_lng);
        desvio = Math.max(0, (conEscala - directo) * MIN_POR_KM);
        dePaso = desvio <= 4; // menos de 4 minutos extra: prácticamente le queda al paso
      }

      const puntaje = llegada + carga * PENAL_POR_PEDIDO + desvio * 0.5;

      return {
        ...m,
        dist, llegada: Math.ceil(llegada), carga, dePaso,
        desvio: Math.ceil(desvio), puntaje,
      };
    })
    .sort((a, b) => a.puntaje - b.puntaje);
}

function iconPedido(estado, tieneMot, seleccionado) {
  const color = estado === 'lista' && !tieneMot ? C.amarillo
              : estado === 'en_camino' ? C.rojo
              : estado === 'lista' ? C.rojo
              : '#9ca3af';
  const halo = !tieneMot && estado === 'lista'
    ? `box-shadow:0 0 0 ${seleccionado ? 8 : 5}px ${seleccionado ? 'rgba(245,158,11,.55)' : 'rgba(245,158,11,.28)'};`
    : '';
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};
                       border:2px solid #fff;${halo}"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
}

function iconMotorista(nombre, libre) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px)">
             <div style="width:24px;height:24px;border-radius:50%;background:${libre ? C.verde : C.rojo};
                         border:2px solid #fff;display:flex;align-items:center;justify-content:center;
                         font-size:12px">🛵</div>
             <div style="background:rgba(0,0,0,.72);color:#fff;font-size:9px;padding:1px 4px;
                         border-radius:4px;margin-top:2px;white-space:nowrap">${nombre}</div>
           </div>`,
    iconSize: [0, 0], iconAnchor: [12, 12],
  });
}

export default function MapaAsignacion({ onAsignar, ocupado, recargarPadre }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const capas = useRef(null);
  const encuadrado = useRef(false);

  const [abierto, setAbierto] = useState(
    () => localStorage.getItem('torre_mapa_asig_abierto') === '1');
  const [data, setData] = useState(null);
  const [selId, setSelId] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const { data: res, error: e } = await db.rpc('torre_mapa_vivo', { p_token: token });
      if (e) throw e;
      if (res?.ok) { setData(res); setError(''); }
    } catch (e) { setError(e.message || 'No se pudo cargar el mapa'); }
  }, []);

  useEffect(() => {
    if (!abierto) return;
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [abierto, cargar]);

  // El mapa se crea recién cuando el panel se abre: si se monta escondido,
  // Leaflet calcula mal el tamaño y aparece cortado.
  useEffect(() => {
    if (!abierto || mapRef.current || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: true }).setView([13.72, -89.20], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    capas.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [abierto]);

  // Redibujado de marcadores
  useEffect(() => {
    if (!abierto || !mapRef.current || !data || !capas.current) return;
    capas.current.clearLayers();
    const puntos = [];

    for (const s of data.sucursales || []) {
      if (s.lat == null) continue;
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:20px;height:20px;background:${C.azul};color:#fff;font-size:9px;
                             font-weight:700;display:flex;align-items:center;justify-content:center;
                             border:2px solid #fff;border-radius:4px">${String(s.store_code).slice(-2)}</div>`,
          iconSize: [20, 20], iconAnchor: [10, 10],
        }),
        interactive: false,
      }).addTo(capas.current);
      puntos.push([s.lat, s.lng]);
    }

    for (const p of data.pedidos || []) {
      if (p.cliente_lat == null) continue;
      const sinAsignar = p.estado === 'lista' && !p.motorista_id;
      const m = L.marker([p.cliente_lat, p.cliente_lng], {
        icon: iconPedido(p.estado, !!p.motorista_id, selId === p.id),
        zIndexOffset: sinAsignar ? 600 : 200,
      });
      m.on('click', () => setSelId(sinAsignar ? p.id : null));
      m.bindTooltip(`${p.numero_orden} · ${p.cliente_nombre || ''}`, { direction: 'top' });
      m.addTo(capas.current);
      puntos.push([p.cliente_lat, p.cliente_lng]);
    }

    // Ruta de cada motorista, numerada en el orden sugerido de entrega.
    // Sin los números, dos pedidos cercanos no dicen cuál va primero — que es
    // justo lo que necesita saber el motorista al salir.
    const agrupados = agruparPorMotorista(data.pedidos || []);
    for (const [motoristaId, suyos] of agrupados) {
      const mot = (data.motoristas || []).find(x => x.empleado_id === motoristaId);
      if (!mot || mot.lat == null) continue;

      const ruta = ordenarRuta({ lat: mot.lat, lng: mot.lng }, suyos);
      L.polyline([[mot.lat, mot.lng], ...ruta.map(p => [p.cliente_lat, p.cliente_lng])],
        { color: C.rojo, weight: 2, opacity: .7, dashArray: '5,4' }).addTo(capas.current);

      ruta.forEach((p, i) => {
        L.marker([p.cliente_lat, p.cliente_lng], {
          icon: L.divIcon({
            className: '',
            html: `<div style="min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#111;
                               color:#fff;font-size:9.5px;font-weight:700;display:flex;align-items:center;
                               justify-content:center;border:1.5px solid ${C.rojo};white-space:nowrap">${i + 1}º</div>`,
            iconSize: [16, 16], iconAnchor: [-7, 15],
          }),
          interactive: false, zIndexOffset: 450,
        }).addTo(capas.current);
      });
    }

    for (const m of data.motoristas || []) {
      if (m.lat == null) continue;
      L.marker([m.lat, m.lng], {
        icon: iconMotorista((m.nombre || '').split(' ')[0], (m.pedidos_activos || 0) === 0),
        zIndexOffset: 500,
      }).addTo(capas.current);
      puntos.push([m.lat, m.lng]);
    }

    if (!encuadrado.current && puntos.length) {
      encuadrado.current = true;
      mapRef.current.fitBounds(L.latLngBounds(puntos), { padding: [30, 30], maxZoom: 14 });
    }
  }, [data, selId, abierto]);

  const sinAsignar = (data?.pedidos || []).filter(p => p.estado === 'lista' && !p.motorista_id);
  const sel = (data?.pedidos || []).find(p => p.id === selId) || null;

  // Pedidos que ya tiene cada motorista, para calcular el desvío
  const pedidosPorMotorista = new Map();
  for (const p of data?.pedidos || []) {
    if (!p.motorista_id || p.cliente_lat == null) continue;
    if (!pedidosPorMotorista.has(p.motorista_id)) pedidosPorMotorista.set(p.motorista_id, []);
    pedidosPorMotorista.get(p.motorista_id).push(p);
  }

  const ranking = sel ? rankearMotoristas(sel, data.motoristas || [], pedidosPorMotorista) : [];

  const asignarDesdeMapa = async (motoristaId) => {
    if (!sel) return;
    await onAsignar(sel, motoristaId);
    setSelId(null);
    await cargar();
    recargarPadre?.();
  };

  return (
    <div style={{ marginTop: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <div onClick={() => setAbierto(v => {
             localStorage.setItem('torre_mapa_asig_abierto', v ? '0' : '1');
             return !v;
           })}
           style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <span style={{ fontSize: 14 }}>🗺️</span>
        <span style={{ fontWeight: 800, fontSize: 13.5, color: C.text }}>Mapa de asignación</span>
        {sinAsignar.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: C.amarillo }}>
            {sinAsignar.length} por asignar
          </span>
        )}
        <span style={{ fontSize: 11.5, color: C.dim }}>
          · {(data?.motoristas || []).length} motorista(s) en línea
        </span>
        <span style={{ marginLeft: 'auto', color: C.dim, fontSize: 13 }}>{abierto ? '▾' : '▸'}</span>
      </div>

      {abierto && (
        <div style={{ padding: '0 12px 12px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px', minWidth: 300, position: 'relative' }}>
            <div ref={mapEl} style={{ height: 340, borderRadius: 10, overflow: 'hidden',
                                      border: `1px solid ${C.border}`, background: '#222' }} />
            {error && (
              <div style={{ position: 'absolute', top: 8, left: 8, background: '#7f1d1d', color: '#fff',
                            fontSize: 11.5, padding: '5px 9px', borderRadius: 6, zIndex: 500 }}>
                ⚠️ {error}
              </div>
            )}
          </div>

          <div style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 340 }}>
            {!sel ? (
              <div style={{ background: '#141414', borderRadius: 10, padding: '14px 12px',
                            color: C.dim, fontSize: 12, lineHeight: 1.6 }}>
                {sinAsignar.length === 0
                  ? 'No hay pedidos esperando motorista.'
                  : <>Tocá un punto <b style={{ color: C.amarillo }}>amarillo</b> del mapa para ver
                     quién le queda mejor y asignarlo desde acá.</>}
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
                  <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                                    background: C.amarillo, marginRight: 6 }} />Por asignar</span>
                  <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                                    background: C.rojo, marginRight: 6 }} />Ya asignado</span>
                  <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                                    background: C.verde, marginRight: 6 }} />Motorista libre</span>
                </div>
              </div>
            ) : (
              <div style={{ background: '#141414', borderRadius: 10, padding: '11px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 12.5, color: C.text }}>{sel.numero_orden}</span>
                  <span style={{ fontSize: 12, color: C.dim }}>${Number(sel.total).toFixed(2)}</span>
                  <button onClick={() => setSelId(null)}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.dim,
                             cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
                <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>{sel.cliente_nombre}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2, lineHeight: 1.4 }}>
                  {sel.cliente_direccion}
                </div>

                <div style={{ fontSize: 10.5, color: C.dim, fontWeight: 700, margin: '10px 0 6px' }}>
                  {ranking.length ? 'QUIÉN LE QUEDA MEJOR' : 'SIN MOTORISTAS CON GPS'}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                              maxHeight: 210, overflowY: 'auto' }}>
                  {ranking.map((m, i) => (
                    <div key={m.empleado_id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                               borderRadius: 8,
                               background: i === 0 ? '#12281c' : '#1c1c1c',
                               border: `1px solid ${i === 0 ? C.verde : C.border}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? '#c9f2d6' : C.text }}>
                          {m.nombre}
                          <span style={{ fontWeight: 500, color: C.dim }}>
                            {' · '}{m.carga === 0 ? 'libre' : `${m.carga} pedido${m.carga > 1 ? 's' : ''}`}
                          </span>
                        </div>
                        <div style={{ fontSize: 10.5, color: C.dim, marginTop: 1 }}>
                          {m.dist.toFixed(1)} km · llega en {m.llegada} min
                          {m.dePaso && <span style={{ color: C.verde }}> · le queda de paso</span>}
                        </div>
                      </div>
                      <button
                        disabled={ocupado === sel.id}
                        onClick={() => asignarDesdeMapa(m.empleado_id)}
                        style={{ background: i === 0 ? C.rojo : '#2a2a2a',
                                 color: i === 0 ? '#fff' : C.text, border: 'none', borderRadius: 6,
                                 padding: '5px 10px', fontSize: 11, fontWeight: 700,
                                 cursor: ocupado === sel.id ? 'default' : 'pointer',
                                 opacity: ocupado === sel.id ? .6 : 1 }}>
                        Asignar
                      </button>
                    </div>
                  ))}
                  {ranking.length === 0 && (
                    <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>
                      Ningún motorista está compartiendo GPS ahora. Asignalo desde la tarjeta del pedido.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
