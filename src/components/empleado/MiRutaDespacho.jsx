import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../../supabase';

// ── MI RUTA DE DESPACHO (motorista interno) ──────────────────────────
// Reemplaza el auto-marcaje de carga. El reloj arranca cuando Kevin marca
// el despacho como "despachado" (hora_salida). Desde ese momento el GPS del
// motorista se comparte solo (tipo='despacho') mientras tenga despachos en
// ruta, y en cada sucursal marca ENTREGADO con foto de la hoja firmada
// (despacho_confirmar → recibido + hora_recepcion). Al entregar todas, para el GPS.
const C = { card:'#1a1a1a', border:'#2a2a2a', text:'#f0f0f0', dim:'#8a8a8a',
  green:'#4ade80', red:'#e63946', yellow:'#fbbf24', blue:'#60a5fa', panel:'#111' };

export default function MiRutaDespacho({ user }) {
  const [ruta, setRuta] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [gpsOn, setGpsOn] = useState(false);
  const watchId = useRef(null);
  const lastSent = useRef(0);
  const fileRef = useRef();
  const pending = useRef(null);

  const cargar = useCallback(async () => {
    const { data } = await db.rpc('mis_despachos_ruta', { p_motorista_id: user.id });
    setRuta(data || []); setLoading(false);
  }, [user.id]);
  useEffect(() => { cargar(); const iv = setInterval(cargar, 30_000); return () => clearInterval(iv); }, [cargar]);

  // ── GPS automático mientras haya despachos en ruta ──
  const startGps = useCallback(() => {
    if (!navigator.geolocation || watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(async (p) => {
      const now = Date.now(); if (now - lastSent.current < 4000) return; lastSent.current = now;
      await db.rpc('actualizar_ubicacion_driver', {
        p_empleado_id: user.id, p_nombre: user.nombre || 'Motorista',
        p_lat: p.coords.latitude, p_lng: p.coords.longitude,
        p_rumbo: p.coords.heading || null, p_exactitud: p.coords.accuracy || null, p_tipo: 'despacho',
      }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
    setGpsOn(true);
  }, [user.id, user.nombre]);
  const stopGps = useCallback(async () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null; setGpsOn(false);
    await db.rpc('desconectar_driver', { p_empleado_id: user.id }).catch(() => {});
  }, [user.id]);

  useEffect(() => {
    if (ruta.length > 0) startGps(); else if (gpsOn) stopGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta.length]);
  useEffect(() => () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); }, []);

  const getPos = () => new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 6000 });
  });

  const pedirFoto = (id) => { pending.current = id; fileRef.current?.click(); };
  const onFoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    const id = pending.current; pending.current = null;
    if (!file || !id) return;
    setBusyId(id);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `entregas/${id}-${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from('despachos-fotos').upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = db.storage.from('despachos-fotos').getPublicUrl(path);
      const { data: items } = await db.from('despacho_items').select('id,producto_id,cantidad_despachada').eq('despacho_id', id);
      const p_items = (items || []).map(it => ({ id: it.id, producto_id: it.producto_id, cantidad_recibida: it.cantidad_despachada }));
      const { error } = await db.rpc('despacho_confirmar', { p_despacho_id: id, p_usuario: user.id, p_foto_url: pub.publicUrl, p_items });
      if (error) throw error;
      cargar();
    } catch (err) { alert('No se pudo registrar la entrega: ' + (err.message || err)); }
    setBusyId(null);
  };

  const elapsed = (t) => { if (!t) return ''; const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };

  return (
    <div style={{ padding: 14, color: C.text, maxWidth: 640, margin: '0 auto' }}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFoto} style={{ display: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>🚚 Mi ruta de despacho</div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: gpsOn ? C.green : C.dim, background: gpsOn ? '#123020' : '#222', padding: '3px 8px', borderRadius: 12 }}>
          {gpsOn ? '📍 GPS activo' : 'GPS apagado'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
        Aparecen los despachos que ya salieron de Casa Matriz. Al llegar a cada sucursal, marcá <b>entregado</b> con foto de la hoja firmada. Tu ubicación se comparte sola mientras tengas despachos en ruta.
      </div>

      {loading && <div style={{ color: C.dim }}>Cargando…</div>}
      {!loading && ruta.length === 0 && (
        <div style={{ textAlign: 'center', color: C.dim, padding: 30 }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ marginTop: 8 }}>No tenés despachos en ruta.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Cuando bodega marque un despacho como despachado, aparece acá.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ruta.map(d => (
          <div key={d.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{d.store_code} · {d.sucursal}</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                  {d.n_items} items {d.hora_salida && <>· salió hace <b style={{ color: C.yellow }}>{elapsed(d.hora_salida)}</b></>}
                </div>
              </div>
            </div>
            <button onClick={() => pedirFoto(d.id)} disabled={busyId === d.id}
              style={{ width: '100%', marginTop: 12, background: C.green, color: '#04220f', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
              {busyId === d.id ? 'Registrando…' : '📸 Marcar entregado (foto hoja firmada)'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
