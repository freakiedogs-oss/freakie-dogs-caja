import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { n } from '../../config';

// ════════════════════════════════════════════════════════════════
//  TRANSFERENCIAS DE BEBIDAS ENTRE SUCURSALES (encargados)
//
//  27-sep-2026 (Frank): solo dos rutas y en un solo sentido —
//  Cafetalón (Tecla) → Metrocentro y Plaza Mundo Soyapango → Plaza Mundo
//  Usulután — y solo bebidas de La Constancia. Las rutas viven en la tabla
//  `transferencia_rutas`; el RPC decide el destino, no la pantalla.
//
//  · Mandar  (encargado del origen): cajas + sueltas, igual que el conteo.
//    `transferencia_bebidas_crear` descuenta del origen en ese momento.
//  · Recibir (personal del destino): confirma lo que llegó.
//    `transferencia_bebidas_recibir` → `despacho_confirmar` suma al destino.
//  Sin motorista obligatorio. Si nadie la confirma, el cron de despachos
//  colgados la da por recibida a las 6 h (marcada como AUTO).
// ════════════════════════════════════════════════════════════════

const ROLES_ADMIN = ['admin', 'superadmin', 'ejecutivo', 'jefe_casa_matriz'];
const ROLES_RECIBE = ['gerente', 'cocina', 'cajera', 'cajero'];

const nombreCorto = (s) => String(s || '')
  .replace(/^Gaseosa\s+/i, '').replace(/\s+1x\d+\s*un\.?$/i, '').replace(/\s+\d+\s*un\.?$/i, '').trim();
const fmtNum = (v) => { const x = Number(v) || 0; return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, ''); };
const entero = (v) => { const x = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(x) && x > 0 ? x : 0; };
const partir = (unidades, factor) => {
  const f = Math.max(1, n(factor)), u = Math.max(0, Math.round(n(unidades)));
  return f > 1 ? { cajas: Math.floor(u / f), sueltas: u % f } : { cajas: u, sueltas: 0 };
};
const textoCant = (p, cajas, sueltas) => {
  const c = n(cajas), s = n(sueltas);
  if (!p || n(p.factor) <= 1) return `${fmtNum(c + s)} ${c + s === 1 ? 'unidad' : 'unidades'}`;
  return [c > 0 ? `${fmtNum(c)} caja${c === 1 ? '' : 's'}` : null, s > 0 ? `${fmtNum(s)} ${p.unidad_suelta}` : null].filter(Boolean).join(' + ') || '0';
};

const inputStyle = {
  width: '100%', padding: '12px', background: '#1a1a1a',
  border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 14,
};

// ── Bloque para la pantalla principal de Bebidas: botón de mandar + por recibir ──
export function TransferenciasBebidasPanel({ user, sucursales, verTodas, onMandar, onRecibir, refrescar }) {
  const [rutas, setRutas] = useState([]);
  const [entrantes, setEntrantes] = useState([]);
  const miSuc = sucursales.find(s => s.store_code === user?.store_code) || null;
  const esAdmin = ROLES_ADMIN.includes(user?.rol);

  useEffect(() => {
    db.from('transferencia_rutas').select('origen_sucursal_id,destino_sucursal_id').eq('tipo', 'bebidas').eq('activa', true)
      .then(({ data }) => setRutas(data || []));
  }, []);

  useEffect(() => {
    if (!sucursales.length) return;
    let q = db.from('despachos_sucursal')
      .select('id,sucursal_id,origen_sucursal_id,estado,hora_salida,notas_despacho,despacho_items(id,producto_id,descripcion,cantidad_despachada)')
      .not('origen_sucursal_id', 'is', null).in('estado', ['despachado', 'en_ruta'])
      .order('created_at', { ascending: false }).limit(20);
    if (!verTodas && miSuc) q = q.eq('sucursal_id', miSuc.id);
    q.then(({ data }) => setEntrantes((data || []).filter(d => (d.notas_despacho || '').startsWith('TRANSFERENCIA BEBIDAS'))));
  }, [sucursales.length, verTodas, miSuc?.id, refrescar]);

  const nombre = (id) => sucursales.find(s => s.id === id)?.nombre || '—';
  // Rutas que este usuario puede usar para mandar: la de su sucursal (encargado) o todas (admin).
  const misRutas = rutas.filter(r => esAdmin || (user?.rol === 'gerente' && miSuc && r.origen_sucursal_id === miSuc.id));
  const puedeRecibir = esAdmin || ROLES_RECIBE.includes(user?.rol);

  if (!misRutas.length && !entrantes.length) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {misRutas.map(r => (
        <button key={r.origen_sucursal_id} className="btn" onClick={() => onMandar(r)}
          style={{ width: '100%', padding: '14px', fontSize: 15, marginBottom: 8, background: '#1d2a3a', border: '1px solid #60a5fa66', color: '#cfe3ff' }}>
          🔁 Mandar bebidas {esAdmin ? `de ${nombre(r.origen_sucursal_id)} ` : ''}a {nombre(r.destino_sucursal_id)}
        </button>
      ))}
      {entrantes.map(d => {
        const horas = d.hora_salida ? Math.round((Date.now() - new Date(d.hora_salida).getTime()) / 36e5) : 0;
        return (
          <div key={d.id} className="card" style={{ borderColor: '#fbbf24', background: '#fbbf2410', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: 14 }}>
              🔁 Transferencia de {nombre(d.origen_sucursal_id)}{verTodas ? ` → ${nombre(d.sucursal_id)}` : ''} por recibir
            </div>
            <div style={{ fontSize: 12, color: '#ccc', margin: '4px 0 8px' }}>
              {(d.despacho_items || []).length} bebida(s) · salió {d.hora_salida ? new Date(d.hora_salida).toLocaleString('es-SV', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—'}
              {horas >= 4 && ' · si no se confirma, a las 6 h se da por recibida sola'}
            </div>
            {puedeRecibir
              ? <button className="btn btn-red" onClick={() => onRecibir(d)} style={{ width: '100%', padding: 12 }}>Contar y recibir</button>
              : <div style={{ fontSize: 12, color: '#888' }}>La recibe el encargado de la sucursal.</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Mandar ──
export function MandarBebidas({ user, show, ruta, sucursales, onBack }) {
  const origen = sucursales.find(s => s.id === ruta.origen_sucursal_id);
  const destino = sucursales.find(s => s.id === ruta.destino_sucursal_id);
  const [catalogo, setCatalogo] = useState([]);
  const [stock, setStock] = useState({});
  const [cargando, setCargando] = useState(true);
  const [busca, setBusca] = useState('');
  const [cant, setCant] = useState({});
  const [paso, setPaso] = useState('items'); // items | confirmar | listo
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const { data, error } = await db.rpc('bees_catalogo_entrega', { p_sucursal_id: ruta.origen_sucursal_id });
        if (error) throw error;
        const cat = (data || []).filter(p => !/nescaf/i.test(p.nombre));
        setCatalogo(cat);
        const { data: inv } = await db.from('inventario').select('producto_id,stock_actual')
          .eq('sucursal_id', ruta.origen_sucursal_id).in('producto_id', cat.map(p => p.producto_id));
        setStock(Object.fromEntries((inv || []).map(i => [i.producto_id, Number(i.stock_actual)])));
      } catch (e) { show('⚠️ No se pudo cargar la lista de bebidas: ' + e.message); }
      finally { setCargando(false); }
    })();
  }, [ruta.origen_sucursal_id]);

  const unidadesDe = (p) => entero(cant[p.producto_id]?.cajas) * Math.max(1, n(p.factor)) + entero(cant[p.producto_id]?.sueltas);
  const elegidos = catalogo.filter(p => unidadesDe(p) > 0);
  const setQ = (pid, campo, v) => setCant(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), [campo]: entero(v) } }));
  const mas = (pid, campo, d) => setCant(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), [campo]: Math.max(0, entero(prev[pid]?.[campo]) + d) } }));

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return catalogo.filter(p => unidadesDe(p) > 0 || (q ? p.nombre.toLowerCase().includes(q) : (p.en_sucursal || n(stock[p.producto_id]) > 0)));
  }, [catalogo, busca, cant, stock]);
  const grupos = useMemo(() => {
    const m = new Map();
    visibles.forEach(p => { if (!m.has(p.grupo)) m.set(p.grupo, []); m.get(p.grupo).push(p); });
    return [...m.entries()];
  }, [visibles]);

  const mandar = async () => {
    if (guardando || !elegidos.length) return;
    setGuardando(true);
    try {
      const { data, error } = await db.rpc('transferencia_bebidas_crear', {
        p_usuario_id: user.id,
        p_origen_sucursal_id: ruta.origen_sucursal_id,
        p_items: elegidos.map(p => ({ producto_id: p.producto_id, cajas: entero(cant[p.producto_id]?.cajas), sueltas: entero(cant[p.producto_id]?.sueltas) })),
        p_notas: notas.trim() || null,
      });
      if (error) throw error;
      setResultado(data); setPaso('listo');
    } catch (e) { show('⚠️ ' + (e.message || e)); }
    finally { setGuardando(false); }
  };

  const volver = () => {
    if (paso === 'confirmar') { setPaso('items'); return; }
    if (elegidos.length && paso === 'items' && !window.confirm('¿Salir sin mandar la transferencia? Se pierde lo que digitaste.')) return;
    onBack(paso === 'listo');
  };

  if (paso === 'listo') {
    return (
      <div style={{ padding: '16px 16px 100px' }}>
        <div className="card" style={{ textAlign: 'center', padding: '22px 16px', borderColor: '#22c55e55' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 6 }}>Transferencia enviada a {resultado?.destino}</div>
          <div style={{ color: '#aaa', fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            {resultado?.productos} bebida(s) · {fmtNum(resultado?.unidades)} unidades salieron del inventario de {resultado?.origen}.
            <br />Entran a {resultado?.destino} cuando su encargado la confirme en «Bebidas La Constancia».
          </div>
        </div>
        {(resultado?.resumen || []).map((r, i) => (
          <div key={i} className="card" style={{ padding: '10px 12px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13 }}>{nombreCorto(r.nombre)}</span>
            <span style={{ fontSize: 13, color: '#aaa', whiteSpace: 'nowrap' }}>
              {textoCant(catalogo.find(p => p.nombre === r.nombre), r.cajas, r.sueltas)} · <b style={{ color: '#e8e6ef' }}>{fmtNum(r.unidades)} u</b>
            </span>
          </div>
        ))}
        <button className="btn btn-red" onClick={() => onBack(true)} style={{ width: '100%', marginTop: 14 }}>Listo</button>
      </div>
    );
  }

  if (paso === 'confirmar') {
    return (
      <div style={{ padding: '16px 16px 120px' }}>
        <button onClick={volver} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 10, cursor: 'pointer', width: 'auto', padding: 0 }}>‹ Corregir bebidas</button>
        <h2 style={{ margin: 0, fontSize: 19 }}>🔁 {origen?.nombre} → {destino?.nombre}</h2>
        <div style={{ color: '#888', fontSize: 12, marginTop: 4, marginBottom: 14 }}>Revisá que sea exactamente lo que va a salir.</div>
        <div className="card" style={{ padding: '4px 12px', marginBottom: 14 }}>
          {elegidos.map(p => {
            const c = entero(cant[p.producto_id]?.cajas), s = entero(cant[p.producto_id]?.sueltas);
            const queda = n(stock[p.producto_id]) - unidadesDe(p);
            return (
              <div key={p.producto_id} style={{ padding: '8px 0', borderBottom: '1px solid #2a2a32', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ minWidth: 0 }}>{nombreCorto(p.nombre)}</span>
                  <span style={{ whiteSpace: 'nowrap', color: '#aaa' }}>{textoCant(p, c, s)}{n(p.factor) > 1 && <> · <b style={{ color: '#e8e6ef' }}>{fmtNum(unidadesDe(p))} u</b></>}</span>
                </div>
                {queda < 0 && <div style={{ fontSize: 11, color: '#fb923c', marginTop: 2 }}>⚠️ El sistema tiene {fmtNum(stock[p.producto_id] || 0)}: quedará en negativo</div>}
              </div>
            );
          })}
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6, fontWeight: 600 }}>Notas (opcional)</div>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Ej: la lleva Carlos en el carro, se acabó la Coca en Metro…" style={{ ...inputStyle, fontSize: 13 }} />
        </div>
        <button className="btn btn-red" onClick={mandar} disabled={guardando} style={{ width: '100%', padding: 15, fontSize: 15 }}>
          {guardando ? 'Enviando…' : `🔁 Mandar a ${destino?.nombre} · sale del inventario`}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 130px' }}>
      <button onClick={volver} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 10, cursor: 'pointer', width: 'auto', padding: 0 }}>‹ Volver</button>
      <h2 style={{ margin: 0, fontSize: 19 }}>🔁 Mandar bebidas a {destino?.nombre}</h2>
      <div style={{ color: '#888', fontSize: 12, marginTop: 4, marginBottom: 14, lineHeight: 1.45 }}>
        Poné lo que <b>de verdad sale</b> de {origen?.nombre}, en cajas cerradas y sueltas. Sale de tu inventario al mandarla y entra al de {destino?.nombre} cuando lo confirmen.
      </div>
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar bebida…" style={{ ...inputStyle, marginBottom: 12 }} />
      {cargando ? (
        <div style={{ textAlign: 'center', padding: 30 }}><div className="spin" style={{ width: 26, height: 26, margin: '0 auto' }} /></div>
      ) : grupos.map(([g, prods]) => (
        <div key={g} style={{ marginBottom: 12 }}>
          <div className="sec-title" style={{ marginBottom: 6 }}>{g}</div>
          {prods.map(p => {
            const c = entero(cant[p.producto_id]?.cajas), s = entero(cant[p.producto_id]?.sueltas);
            const u = unidadesDe(p), porCaja = n(p.factor) > 1, st = stock[p.producto_id];
            return (
              <div key={p.producto_id} className="card" style={{ padding: '10px 12px', marginBottom: 6, borderColor: u > 0 ? '#60a5fa88' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>{nombreCorto(p.nombre)}</div>
                  <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{porCaja ? `caja de ${fmtNum(p.factor)}` : 'por unidad'}{st != null ? ` · hay ${fmtNum(st)}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  <Stepper etiqueta={porCaja ? 'Cajas' : 'Unidades'} valor={c} onMenos={() => mas(p.producto_id, 'cajas', -1)} onMas={() => mas(p.producto_id, 'cajas', 1)} onCambia={v => setQ(p.producto_id, 'cajas', v)} />
                  {porCaja && <Stepper etiqueta={`Sueltas (${p.unidad_suelta})`} valor={s} chico onMenos={() => mas(p.producto_id, 'sueltas', -1)} onMas={() => mas(p.producto_id, 'sueltas', 1)} onCambia={v => setQ(p.producto_id, 'sueltas', v)} />}
                  {porCaja && u > 0 && <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 700 }}>= {fmtNum(u)} {p.unidad_suelta}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', background: '#111116ee', borderTop: '1px solid #2a2a32', zIndex: 20 }}>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6, textAlign: 'center' }}>
          {elegidos.length ? `${elegidos.length} bebida(s) · ${fmtNum(elegidos.reduce((a, p) => a + unidadesDe(p), 0))} unidades` : 'Todavía no agregaste bebidas'}
        </div>
        <button className="btn btn-red" disabled={!elegidos.length} onClick={() => setPaso('confirmar')} style={{ width: '100%', padding: 14, fontSize: 15 }}>Siguiente: revisar →</button>
      </div>
    </div>
  );
}

// ── Recibir ──
export function RecibirTransferencia({ user, show, despacho, sucursales, onBack }) {
  const origen = sucursales.find(s => s.id === despacho.origen_sucursal_id);
  const [pres, setPres] = useState({});   // producto_id → {factor, unidad_suelta}
  const [rec, setRec] = useState({});     // despacho_item_id → {cajas, sueltas}
  const [guardando, setGuardando] = useState(false);
  const items = despacho.despacho_items || [];

  useEffect(() => {
    db.rpc('bees_catalogo_entrega', { p_sucursal_id: despacho.sucursal_id }).then(({ data }) => {
      const m = Object.fromEntries((data || []).map(p => [p.producto_id, p]));
      setPres(m);
      setRec(Object.fromEntries(items.map(it => [it.id, partir(it.cantidad_despachada, m[it.producto_id]?.factor)])));
    });
  }, [despacho.id]);

  const factorDe = (it) => Math.max(1, n(pres[it.producto_id]?.factor));
  const recibidoDe = (it) => entero(rec[it.id]?.cajas) * factorDe(it) + entero(rec[it.id]?.sueltas);
  const setQ = (id, campo, v) => setRec(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [campo]: entero(v) } }));
  const mas = (id, campo, d) => setRec(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [campo]: Math.max(0, entero(prev[id]?.[campo]) + d) } }));
  const conDiferencia = items.filter(it => recibidoDe(it) !== Math.round(n(it.cantidad_despachada)));

  const recibir = async () => {
    if (guardando) return;
    // Recibir MÁS de lo enviado exige explicar por qué (el RPC lo rechaza sin nota).
    const deMas = items.filter(it => recibidoDe(it) > Math.round(n(it.cantidad_despachada)));
    let notaDeMas = null;
    if (deMas.length) {
      notaDeMas = (window.prompt(`Estás recibiendo MÁS de lo que mandaron en: ${deMas.map(it => it.descripcion).join(', ')}.\nEscribí qué pasó (obligatorio):`) || '').trim();
      if (!notaDeMas) { show('❌ Para recibir más de lo enviado tenés que escribir qué pasó'); return; }
    } else if (conDiferencia.length && !window.confirm(`${conDiferencia.length} bebida(s) no llegaron completas. Se registra lo que contaste y la diferencia queda en la transferencia. ¿Confirmar?`)) return;
    setGuardando(true);
    try {
      const { data, error } = await db.rpc('transferencia_bebidas_recibir', {
        p_usuario_id: user.id, p_despacho_id: despacho.id,
        p_items: items.map(it => ({ despacho_item_id: it.id, cantidad_recibida: recibidoDe(it),
          nota: recibidoDe(it) > Math.round(n(it.cantidad_despachada)) ? notaDeMas : null })),
      });
      if (error) throw error;
      show(data?.ya_recibido ? 'Esta transferencia ya estaba recibida' : `✅ Recibida: ${items.length} bebida(s) sumadas al inventario`);
      onBack(true);
    } catch (e) { show('⚠️ ' + (e.message || e)); }
    finally { setGuardando(false); }
  };

  return (
    <div style={{ padding: '16px 16px 120px' }}>
      <button onClick={() => onBack(false)} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 10, cursor: 'pointer', width: 'auto', padding: 0 }}>‹ Volver</button>
      <h2 style={{ margin: 0, fontSize: 19 }}>🔁 Recibir de {origen?.nombre}</h2>
      <div style={{ color: '#888', fontSize: 12, marginTop: 4, marginBottom: 14, lineHeight: 1.45 }}>
        Contá lo que llegó. Ya viene lleno con lo que mandaron: cambiá solo lo que no cuadre.
      </div>
      {items.map(it => {
        const p = pres[it.producto_id], porCaja = factorDe(it) > 1;
        const env = partir(it.cantidad_despachada, factorDe(it));
        const r = recibidoDe(it), dif = r - Math.round(n(it.cantidad_despachada));
        return (
          <div key={it.id} className="card" style={{ padding: '10px 12px', marginBottom: 6, borderColor: dif ? '#fb923c' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <div style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>{nombreCorto(it.descripcion)}</div>
              <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>mandaron {textoCant(p, env.cajas, env.sueltas)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <Stepper etiqueta={porCaja ? 'Cajas' : 'Unidades'} valor={entero(rec[it.id]?.cajas)} onMenos={() => mas(it.id, 'cajas', -1)} onMas={() => mas(it.id, 'cajas', 1)} onCambia={v => setQ(it.id, 'cajas', v)} />
              {porCaja && <Stepper etiqueta={`Sueltas (${p?.unidad_suelta || 'unid.'})`} valor={entero(rec[it.id]?.sueltas)} chico onMenos={() => mas(it.id, 'sueltas', -1)} onMas={() => mas(it.id, 'sueltas', 1)} onCambia={v => setQ(it.id, 'sueltas', v)} />}
              <div style={{ fontSize: 12, fontWeight: 700, color: dif ? '#fb923c' : '#22c55e' }}>
                = {fmtNum(r)} u{dif ? ` (${dif > 0 ? '+' : ''}${fmtNum(dif)})` : ' ✓'}
              </div>
            </div>
          </div>
        );
      })}
      <button className="btn btn-red" onClick={recibir} disabled={guardando || !Object.keys(pres).length} style={{ width: '100%', padding: 15, fontSize: 15, marginTop: 10 }}>
        {guardando ? 'Guardando…' : '✅ Confirmar recepción · suma al inventario'}
      </button>
    </div>
  );
}

function Stepper({ etiqueta, valor, onMenos, onMas, onCambia, chico }) {
  const b = { width: 38, height: 38, borderRadius: 8, border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer', padding: 0, flexShrink: 0 };
  return (
    <div>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>{etiqueta}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" onClick={onMenos} style={b} aria-label="menos">−</button>
        <input type="text" inputMode="numeric" pattern="[0-9]*" value={valor || ''} placeholder="0" onChange={e => onCambia(e.target.value)}
          style={{ width: chico ? 48 : 56, height: 38, textAlign: 'center', background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8, color: '#e8e6ef', fontSize: 16, fontWeight: 700, padding: 0 }} />
        <button type="button" onClick={onMas} style={{ ...b, background: '#e63946', borderColor: '#e63946' }} aria-label="más">+</button>
      </div>
    </div>
  );
}
