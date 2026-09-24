import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../supabase';
import InfoTip from '../ui/InfoTip'
import { today, fmtDate, n, BUCKET_CIERRES as BUCKET } from '../../config';

// ════════════════════════════════════════════════════════════════
//  BEBIDAS LA CONSTANCIA — recepción en sucursal
//
//  24-sep-2026 (Frank, Yasmín, Jose): la ingesta por correo no registra nada
//  desde el 04-sep y el "+ Manual" (OCR de una captura + INSERT directo) nunca
//  funcionó: RLS bloquea el INSERT de anon y además buscaba `user.sucursal_id`,
//  que el login no trae. Resultado: ninguna entrega de La Constancia entraba al
//  inventario de bebidas.
//
//  Ahora el camino principal es «📦 Registrar entrega»: se eligen las bebidas
//  de una lista (cajas + sueltas, como en el conteo), se toma foto del recibo o
//  de la captura como respaldo, y un solo RPC (`bees_registrar_entrega`) crea la
//  compra ya recibida y suma al kardex EN UNIDADES (botella/lata), que es como
//  vive el stock de bebidas. Si el correo de BEES vuelve a entrar, esos pedidos
//  siguen apareciendo en «Por recibir» y se confirman con `bees_recepcionar`.
// ════════════════════════════════════════════════════════════════

const ROLES_TODAS = ['ejecutivo', 'admin', 'superadmin'];
const LS_SUC = 'bees_entrega_sucursal';

const nuevoToken = () => {
  try { if (window.crypto?.randomUUID) return window.crypto.randomUUID(); } catch (e) { /* sigue */ }
  return 'ent-' + Date.now() + '-' + Math.random().toString(36).slice(2);
};
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } };

// "Gaseosa Coca-Cola Vr 354ml 1x24 un" → "Coca-Cola Vr 354ml"
const nombreCorto = (s) => String(s || '')
  .replace(/^Gaseosa\s+/i, '')
  .replace(/\s+1x\d+\s*un\.?$/i, '')
  .replace(/\s+\d+\s*un\.?$/i, '')
  .trim();
const fmtNum = (v) => {
  const x = Number(v) || 0;
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, '');
};
const entero = (v) => {
  const x = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

// Foto del recibo más liviana (≤1600 px, JPEG): con mala señal un original de
// 5 MB no sube. Si algo falla se manda el archivo tal cual.
async function comprimirFoto(file) {
  try {
    if (!file || !/^image\//.test(file.type) || file.size < 400 * 1024) return file;
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
    return blob && blob.size < file.size ? new File([blob], 'recibo.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}

async function subirFoto(file, prefijo) {
  const f = await comprimirFoto(file);
  const ext = f.type === 'image/jpeg' ? 'jpg' : ((f.name || '').split('.').pop() || 'jpg').toLowerCase();
  const path = `bees/${prefijo}_${Date.now()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, f, { cacheControl: '3600', upsert: false });
  if (error) throw new Error('No se pudo subir la foto: ' + error.message);
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('No se pudo obtener el enlace de la foto');
  return data.publicUrl;
}

const diasDesde = (fecha) => {
  if (!fecha) return 0;
  const a = new Date(fecha + 'T12:00:00'), b = new Date(today() + 'T12:00:00');
  return Math.round((b - a) / 86400000);
};

export default function RecepcionBeesView({ user, show }) {
  const [view, setView] = useState('lista');
  const [tab, setTab] = useState('pendientes');
  const [compras, setCompras] = useState([]);
  const [stock, setStock] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sucursales, setSucursales] = useState([]);

  const verTodas = ROLES_TODAS.includes(user?.rol) || !user?.store_code;
  // El login no trae sucursal_id: la sucursal se resuelve por store_code.
  const miSucursal = sucursales.find(s => s.store_code === user?.store_code) || null;

  useEffect(() => {
    db.from('sucursales').select('id,nombre,store_code').eq('activa', true).order('nombre')
      .then(({ data }) => setSucursales(data || []));
  }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      if (tab === 'stock') {
        let qs = db.from('v_stock_bebidas')
          .select('producto_id,sucursal_id,store_code,sucursal_nombre,producto_nombre,categoria,unidad_medida,stock_actual,stock_minimo,stock_maximo,ultima_actualizacion,estado_stock')
          .order('producto_nombre', { ascending: true });
        if (!verTodas) qs = qs.eq('store_code', user.store_code);
        const { data } = await qs;
        setStock(data || []);
        setCompras([]);
      } else {
        let q = db.from('compras_bees')
          .select('id,id_factura,numero_pedido,fecha,sucursal_id,store_code,sucursal_header,monto_total,items_count,foto_pedido_url,foto_recepcion_url,estado_recepcion,fecha_recepcion_real,inventariado,notas_recepcion,origen,created_at')
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(60);
        if (!verTodas) q = q.eq('store_code', user.store_code);
        if (tab === 'pendientes') q = q.or('estado_recepcion.in.(pendiente,en_transito),and(estado_recepcion.eq.recepcionado,inventariado.eq.false)');
        else q = q.eq('inventariado', true);
        const { data } = await q;
        setCompras(data || []);
        setStock([]);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, [tab, user?.store_code]);

  if (view === 'detalle' && sel) {
    return <BeesDetalle compra={sel} user={user} show={show}
      onBack={() => { setSel(null); setView('lista'); cargar(); }} />;
  }
  if (view === 'entrega') {
    return <EntregaBees user={user} show={show} verTodas={verTodas} sucursales={sucursales} miSucursal={miSucursal}
      onBack={(registrada) => { setView('lista'); if (registrada) setTab('historial'); else cargar(); }} />;
  }

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>🥤 Bebidas La Constancia <InfoTip text="Cuando llegue el camión de La Constancia, registrá lo que bajaron con «Registrar entrega» y tomale foto al recibo. Eso suma al inventario de bebidas. El conteo de bebidas de la noche ya cuenta con lo que registraste." /></h2>
      <div style={{ color: '#888', fontSize: 12, marginTop: 2, marginBottom: 14 }}>
        {verTodas ? 'Todas las sucursales' : (miSucursal?.nombre || user?.store_code || '—')}
      </div>

      <button className="btn btn-red" onClick={() => setView('entrega')}
        style={{ width: '100%', padding: '16px 14px', fontSize: 16, marginBottom: 16 }}>
        📦 Registrar entrega de La Constancia
      </button>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #2a2a32' }}>
        {[['pendientes', '🚚 Por recibir'], ['historial', '✅ Recibidos'], ['stock', '🥤 Stock']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              flex: 1, padding: '10px 6px', background: 'transparent',
              color: tab === key ? '#e63946' : '#aaa',
              border: 'none', borderBottom: tab === key ? '2px solid #e63946' : '2px solid transparent',
              cursor: 'pointer', fontWeight: 600, fontSize: 13, width: 'auto',
            }}>{label}</button>
        ))}
      </div>

      {tab === 'pendientes' && !loading && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.45 }}>
          Acá aparecen los pedidos que BEES mandó por correo. Si la entrega que te llegó no está acá, usá <b>Registrar entrega</b>.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} /></div>
      ) : tab === 'stock' ? (
        <StockBebidasTab stock={stock} verTodas={verTodas} />
      ) : compras.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🥤</div>
          <div className="empty-text">
            {tab === 'pendientes' ? 'No hay pedidos por recibir' : 'Todavía no hay entregas recibidas'}
          </div>
        </div>
      ) : (
        compras.map(c => <CompraCard key={c.id} compra={c} tab={tab} verTodas={verTodas}
          onClick={() => { setSel(c); setView('detalle'); }} />)
      )}
    </div>
  );
}

// ── REGISTRAR ENTREGA (manual, con foto del recibo) ─────────────
function EntregaBees({ user, show, verTodas, sucursales, miSucursal, onBack }) {
  const [paso, setPaso] = useState('items');          // items | confirmar | listo
  const [sucId, setSucId] = useState(() => verTodas ? (lsGet(LS_SUC) || '') : '');
  const [catalogo, setCatalogo] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [busca, setBusca] = useState('');
  const [verTodo, setVerTodo] = useState(false);
  const [cant, setCant] = useState({});               // {producto_id: {cajas, sueltas}}
  const [foto, setFoto] = useState(null);
  const [fotoPreview, setFotoPreview] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');         // ya subida (no se re-sube si hay que confirmar)
  const [doc, setDoc] = useState('');
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [previas, setPrevias] = useState(null);       // entregas ya registradas hoy → confirmar
  const [resultado, setResultado] = useState(null);
  const tokenRef = useRef(nuevoToken());
  const camRef = useRef(); const galRef = useRef();

  const sucursal = verTodas ? sucursales.find(s => s.id === sucId) || null : miSucursal;

  useEffect(() => {
    if (!sucursal?.id) { setCatalogo([]); return; }
    setCargando(true);
    db.rpc('bees_catalogo_entrega', { p_sucursal_id: sucursal.id })
      .then(({ data, error }) => {
        if (error) show('⚠️ No se pudo cargar la lista de bebidas: ' + error.message);
        setCatalogo(data || []);
      })
      .finally(() => setCargando(false));
  }, [sucursal?.id]);

  const setQ = (pid, campo, v) => setCant(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), [campo]: entero(v) } }));
  const paso1 = (pid, campo, d) => setCant(prev => {
    const act = entero(prev[pid]?.[campo]);
    return { ...prev, [pid]: { ...(prev[pid] || {}), [campo]: Math.max(0, act + d) } };
  });

  const unidadesDe = (p) => entero(cant[p.producto_id]?.cajas) * n(p.factor) + entero(cant[p.producto_id]?.sueltas);
  const elegidos = catalogo.filter(p => unidadesDe(p) > 0);
  // Las bebidas por unidad (Heineken, Blue Moon, XX, Nescafé) no son cajas:
  // se suman aparte para no decir «12 cajas» cuando son 12 botellas.
  const porCajaP = (p) => n(p.factor) > 1;
  const totCajas = elegidos.filter(porCajaP).reduce((a, p) => a + entero(cant[p.producto_id]?.cajas), 0);
  const totSueltas = elegidos.filter(porCajaP).reduce((a, p) => a + entero(cant[p.producto_id]?.sueltas), 0);
  const totUnid = elegidos.filter(p => !porCajaP(p)).reduce((a, p) => a + entero(cant[p.producto_id]?.cajas), 0);
  const resumenTotal = [
    totCajas > 0 ? `${totCajas} caja(s)` : null,
    totSueltas > 0 ? `${totSueltas} sueltas` : null,
    totUnid > 0 ? `${totUnid} por unidad` : null,
  ].filter(Boolean).join(' + ');
  // "12 cajas" / "12 unidades" según la presentación del producto
  const textoCant = (p, cajas, sueltas) => {
    const c = n(cajas), s = n(sueltas);
    if (!p || !porCajaP(p)) return `${fmtNum(c + s)} ${c + s === 1 ? 'unidad' : 'unidades'}`;
    return [c > 0 ? `${fmtNum(c)} caja${c === 1 ? '' : 's'}` : null, s > 0 ? `${fmtNum(s)} ${p.unidad_suelta}` : null].filter(Boolean).join(' + ') || '0';
  };

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return catalogo.filter(p => {
      if (unidadesDe(p) > 0) return true;
      if (q) return p.nombre.toLowerCase().includes(q);
      return verTodo || p.en_sucursal;
    });
  }, [catalogo, busca, verTodo, cant]);
  const grupos = useMemo(() => {
    const m = new Map();
    visibles.forEach(p => { if (!m.has(p.grupo)) m.set(p.grupo, []); m.get(p.grupo).push(p); });
    return [...m.entries()];
  }, [visibles]);
  const ocultas = catalogo.filter(p => !p.en_sucursal).length;

  const elegirFoto = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setFoto(f); setFotoUrl('');
    const r = new FileReader();
    r.onload = ev => setFotoPreview(ev.target.result);
    r.readAsDataURL(f);
    e.target.value = '';
  };

  const confirmar = async (repetidaOk = false) => {
    if (guardando) return;
    if (!sucursal?.id) { show('⚠️ Elegí la sucursal'); return; }
    if (!elegidos.length) { show('⚠️ No hay bebidas en la entrega'); return; }
    if (!foto && !fotoUrl) { show('📷 Falta la foto del recibo o de la captura'); return; }
    setGuardando(true);
    try {
      let url = fotoUrl;
      if (!url) { url = await subirFoto(foto, `entrega_${sucursal.store_code}`); setFotoUrl(url); }
      const { data, error } = await db.rpc('bees_registrar_entrega', {
        p_sucursal_id: sucursal.id,
        p_usuario_id: user.id,
        p_items: elegidos.map(p => ({
          producto_id: p.producto_id,
          cajas: entero(cant[p.producto_id]?.cajas),
          sueltas: entero(cant[p.producto_id]?.sueltas),
        })),
        p_foto_url: url,
        p_numero_documento: doc.trim() || null,
        p_monto_total: n(monto) > 0 ? n(monto) : null,
        p_notas: notas.trim() || null,
        p_client_token: tokenRef.current,
        p_confirmar_repetida: repetidaOk,
      });
      if (error) throw error;
      if (data?.requiere_confirmacion) { setPrevias(data.previas || []); return; }
      setPrevias(null);
      setResultado(data?.ya_registrado ? { ya: true } : data);
      setPaso('listo');
    } catch (e) {
      show('⚠️ ' + (e.message || e));
    } finally { setGuardando(false); }
  };

  const volver = () => {
    if (paso === 'confirmar') { setPaso('items'); setPrevias(null); return; }
    if (elegidos.length && paso === 'items' && !window.confirm('¿Salir sin registrar la entrega? Se pierde lo que digitaste.')) return;
    onBack(false);
  };

  // ── Paso final ──
  if (paso === 'listo') {
    return (
      <div style={{ padding: '16px 16px 100px' }}>
        <div className="card" style={{ textAlign: 'center', padding: '22px 16px', borderColor: '#22c55e55' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 6 }}>
            {resultado?.ya ? 'Esta entrega ya estaba registrada' : 'Entrega registrada'}
          </div>
          {!resultado?.ya && (
            <div style={{ color: '#aaa', fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              {resultado?.productos} producto(s) · {fmtNum(resultado?.unidades)} unidades sumadas al inventario de {sucursal?.nombre}.
              <br />El conteo de bebidas de esta noche ya las toma en cuenta.
            </div>
          )}
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

  // ── Paso 2: foto del recibo + confirmar ──
  if (paso === 'confirmar') {
    return (
      <div style={{ padding: '16px 16px 120px' }}>
        <button onClick={volver} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 10, cursor: 'pointer', width: 'auto', padding: 0 }}>‹ Corregir bebidas</button>
        <h2 style={{ margin: 0, fontSize: 19 }}>📷 Foto del recibo</h2>
        <div style={{ color: '#888', fontSize: 12, marginTop: 4, marginBottom: 14 }}>
          {sucursal?.nombre} · Revisá que lo digitado sea igual al recibo de La Constancia.
        </div>

        <div className="card" style={{ padding: '4px 12px', marginBottom: 14 }}>
          {elegidos.map(p => {
            const c = entero(cant[p.producto_id]?.cajas), s = entero(cant[p.producto_id]?.sueltas);
            return (
              <div key={p.producto_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid #2a2a32', fontSize: 13 }}>
                <span style={{ minWidth: 0 }}>{nombreCorto(p.nombre)}</span>
                <span style={{ whiteSpace: 'nowrap', color: '#aaa' }}>
                  {textoCant(p, c, s)}
                  {n(p.factor) > 1 && <> · <b style={{ color: '#e8e6ef' }}>{fmtNum(unidadesDe(p))} u</b></>}
                </span>
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, fontWeight: 700 }}>
            <span>{elegidos.length} producto(s)</span>
            <span>{resumenTotal}</span>
          </div>
        </div>

        <input type="file" accept="image/*" capture="environment" ref={camRef} onChange={elegirFoto} style={{ display: 'none' }} />
        <input type="file" accept="image/*" ref={galRef} onChange={elegirFoto} style={{ display: 'none' }} />
        {fotoPreview ? (
          <div className="card" style={{ padding: 8, marginBottom: 10 }}>
            <img src={fotoPreview} alt="Recibo" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 6 }} />
            <button className="btn" onClick={() => camRef.current?.click()} style={{ marginTop: 8, background: '#2a2a32', width: '100%' }}>🔄 Cambiar foto</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <button className="btn btn-red" onClick={() => camRef.current?.click()} style={{ flex: 1, padding: 16 }}>📷 Tomar foto</button>
            <button className="btn" onClick={() => galRef.current?.click()} style={{ flex: 1, padding: 16, background: '#2a2a32' }}>🖼️ Captura / galería</button>
          </div>
        )}
        {!fotoPreview && <div style={{ fontSize: 12, color: '#fb923c', marginBottom: 12 }}>La foto del recibo (o la captura de BEES) es obligatoria.</div>}

        <Field label="N° de factura o recibo (opcional)">
          <input value={doc} onChange={e => setDoc(e.target.value)} placeholder="Ej: B2B17330761" style={inputStyle} />
        </Field>
        <Field label="Total del recibo en $ (opcional)">
          <input value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0.00" style={inputStyle} />
        </Field>
        <Field label="Notas (opcional)">
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Ej: faltó 1 caja de Fanta, venía una botella quebrada…" style={{ ...inputStyle, fontSize: 13 }} />
        </Field>

        {previas && (
          <div className="card" style={{ borderColor: '#fb923c', background: '#fb923c14', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: '#fb923c', marginBottom: 6 }}>⚠️ Hoy ya se registró una entrega en {sucursal?.nombre}</div>
            {previas.map((p, i) => (
              <div key={i} style={{ fontSize: 13, color: '#ccc' }}>• {p.hora} · {p.items} producto(s){p.doc && !String(p.doc).startsWith('ENTREGA-') ? ` · ${p.doc}` : ''}</div>
            ))}
            <div style={{ fontSize: 13, color: '#ccc', margin: '8px 0 10px' }}>¿Es otra entrega distinta? Si es la misma, no la registres de nuevo: sumaría doble al inventario.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setPrevias(null)} style={{ flex: 1, background: '#2a2a32' }}>No, es la misma</button>
              <button className="btn btn-red" onClick={() => confirmar(true)} disabled={guardando} style={{ flex: 1 }}>Sí, es otra</button>
            </div>
          </div>
        )}

        {!previas && (
          <button className="btn btn-red" onClick={() => confirmar(false)} disabled={guardando || !fotoPreview}
            style={{ width: '100%', padding: 15, fontSize: 15 }}>
            {guardando ? 'Guardando…' : '✅ Confirmar entrega · suma al inventario'}
          </button>
        )}
      </div>
    );
  }

  // ── Paso 1: qué bajaron del camión ──
  return (
    <div style={{ padding: '16px 16px 130px' }}>
      <button onClick={volver} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 10, cursor: 'pointer', width: 'auto', padding: 0 }}>‹ Volver</button>
      <h2 style={{ margin: 0, fontSize: 19 }}>📦 Entrega de La Constancia</h2>
      <div style={{ color: '#888', fontSize: 12, marginTop: 4, marginBottom: 14, lineHeight: 1.45 }}>
        Poné lo que <b>de verdad bajaron</b> del camión, en cajas cerradas y botellas o latas sueltas. Después le tomás foto al recibo.
      </div>

      {verTodas && (
        <Field label="Sucursal">
          <select value={sucId} onChange={e => { setSucId(e.target.value); lsSet(LS_SUC, e.target.value); setCant({}); }} style={inputStyle}>
            <option value="">— Elegí la sucursal —</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Field>
      )}
      {!verTodas && !miSucursal && (
        <div className="card" style={{ color: '#fb923c', fontSize: 13 }}>Tu usuario no tiene sucursal asignada. Pedile a administración que la asigne.</div>
      )}

      {sucursal && (
        <>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar bebida…"
            style={{ ...inputStyle, marginBottom: 12 }} />
          {cargando ? (
            <div style={{ textAlign: 'center', padding: 30 }}><div className="spin" style={{ width: 26, height: 26, margin: '0 auto' }} /></div>
          ) : grupos.map(([g, prods]) => (
            <div key={g} style={{ marginBottom: 12 }}>
              <div className="sec-title" style={{ marginBottom: 6 }}>{g}</div>
              {prods.map(p => {
                const c = entero(cant[p.producto_id]?.cajas), s = entero(cant[p.producto_id]?.sueltas);
                const u = unidadesDe(p), porCaja = n(p.factor) > 1;
                return (
                  <div key={p.producto_id} className="card" style={{ padding: '10px 12px', marginBottom: 6, borderColor: u > 0 ? '#22c55e66' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>{nombreCorto(p.nombre)}</div>
                      <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{porCaja ? `caja de ${fmtNum(p.factor)}` : 'por unidad'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <Stepper etiqueta={porCaja ? 'Cajas' : 'Unidades'} valor={c}
                        onMenos={() => paso1(p.producto_id, 'cajas', -1)} onMas={() => paso1(p.producto_id, 'cajas', 1)}
                        onCambia={v => setQ(p.producto_id, 'cajas', v)} />
                      {porCaja && (
                        <Stepper etiqueta={`Sueltas (${p.unidad_suelta})`} valor={s} chico
                          onMenos={() => paso1(p.producto_id, 'sueltas', -1)} onMas={() => paso1(p.producto_id, 'sueltas', 1)}
                          onCambia={v => setQ(p.producto_id, 'sueltas', v)} />
                      )}
                      {porCaja && u > 0 && <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>= {fmtNum(u)} {p.unidad_suelta}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {!cargando && !busca && ocultas > 0 && (
            <button className="btn" onClick={() => setVerTodo(v => !v)} style={{ width: '100%', background: '#2a2a32', fontSize: 13 }}>
              {verTodo ? 'Mostrar solo las de esta sucursal' : `Ver ${ocultas} bebida(s) más que esta sucursal no suele recibir`}
            </button>
          )}
        </>
      )}

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', background: '#111116ee', borderTop: '1px solid #2a2a32', zIndex: 20 }}>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6, textAlign: 'center' }}>
          {elegidos.length ? `${elegidos.length} producto(s) · ${resumenTotal}` : 'Todavía no agregaste bebidas'}
        </div>
        <button className="btn btn-red" disabled={!elegidos.length || !sucursal} onClick={() => setPaso('confirmar')}
          style={{ width: '100%', padding: 14, fontSize: 15 }}>
          Siguiente: foto del recibo →
        </button>
      </div>
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
        <input type="text" inputMode="numeric" pattern="[0-9]*" value={valor || ''} placeholder="0"
          onChange={e => onCambia(e.target.value)}
          style={{ width: chico ? 48 : 56, height: 38, textAlign: 'center', background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8, color: '#e8e6ef', fontSize: 16, fontWeight: 700, padding: 0 }} />
        <button type="button" onClick={onMas} style={{ ...b, background: '#e63946', borderColor: '#e63946' }} aria-label="más">+</button>
      </div>
    </div>
  );
}

// ── TAB STOCK BEBIDAS — agrupado por sucursal ─────────────────
function StockBebidasTab({ stock, verTodas }) {
  if (!stock.length) {
    return (
      <div className="empty">
        <div className="empty-icon">🥤</div>
        <div className="empty-text">Sin stock de bebidas registrado</div>
      </div>
    );
  }
  const porSucursal = stock.reduce((acc, r) => {
    const k = r.store_code;
    if (!acc[k]) acc[k] = { nombre: r.sucursal_nombre, store_code: k, items: [] };
    acc[k].items.push(r);
    return acc;
  }, {});
  const sucursales = Object.values(porSucursal).sort((a, b) => a.store_code.localeCompare(b.store_code));
  const colorEstado = (e) => e === 'critico' ? '#ef4444' : e === 'bajo' ? '#fb923c' : '#22c55e';

  return (
    <div>
      <div className="card" style={{ background: '#1c1c22', marginBottom: 12, padding: 10, fontSize: 12, color: '#888', lineHeight: 1.45 }}>
        💡 En <b>unidades</b> (botellas o latas). Sube con cada entrega registrada, baja con cada venta, y el conteo de bebidas de la noche lo deja igual a lo contado.
      </div>
      {sucursales.map(s => (
        <div key={s.store_code} style={{ marginBottom: 18 }}>
          {verTodas && (
            <div className="sec-title" style={{ marginBottom: 8 }}>
              {s.store_code} · {s.nombre} <span style={{ color: '#666', fontWeight: 400 }}>({s.items.length} productos)</span>
            </div>
          )}
          {s.items.map(it => (
            <div key={it.producto_id + it.sucursal_id} className="card" style={{ padding: '10px 12px', marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{nombreCorto(it.producto_nombre)}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{it.categoria}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: colorEstado(it.estado_stock) }}>
                    {Number(it.stock_actual).toFixed(0)}
                  </div>
                  {(it.stock_minimo > 0 || it.stock_maximo > 0) && (
                    <div style={{ fontSize: 10, color: '#666' }}>
                      mín {Number(it.stock_minimo || 0).toFixed(0)} · máx {Number(it.stock_maximo || 0).toFixed(0)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── CARD RESUMEN ───────────────────────────────────────────────
function CompraCard({ compra, tab, verTodas, onClick }) {
  const viejo = tab === 'pendientes' && compra.estado_recepcion !== 'recepcionado' && diasDesde(compra.fecha) > 10;
  const badgeColor =
    viejo ? '#888' :
    compra.estado_recepcion === 'pendiente' ? '#fb923c' :
    compra.estado_recepcion === 'en_transito' ? '#3b82f6' :
    compra.inventariado ? '#22c55e' : '#a855f7';
  const badgeLabel =
    viejo ? 'VENCIDO' :
    compra.estado_recepcion === 'pendiente' ? 'PENDIENTE' :
    compra.estado_recepcion === 'en_transito' ? 'POR RECIBIR' :
    compra.inventariado ? 'RECIBIDO' : 'POR INVENTARIAR';
  const isAuto = compra.origen === 'auto_email';
  const isManual = compra.origen === 'manual_sucursal';
  const titulo = isManual ? 'Entrega registrada en sucursal'
    : (compra.sucursal_header && !/^hola\s/i.test(compra.sucursal_header) ? compra.sucursal_header : 'Pedido BEES');
  const esDocPropio = compra.id_factura && !String(compra.id_factura).startsWith('ENTREGA-');

  return (
    <div className="card" style={{ cursor: 'pointer', borderLeft: `3px solid ${badgeColor}` }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {titulo}
            {isAuto && <span style={{ marginLeft: 6, fontSize: 10, color: '#3b82f6', background: '#3b82f622', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>📧 Correo</span>}
            {isManual && <span style={{ marginLeft: 6, fontSize: 10, color: '#22c55e', background: '#22c55e22', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>✍️ Manual</span>}
          </div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
            {verTodas && `${compra.store_code} · `}{fmtDate(isManual ? (compra.fecha_recepcion_real || compra.fecha) : compra.fecha)}
            {n(compra.monto_total) > 0 && ` · $${Number(compra.monto_total).toFixed(2)}`} · {compra.items_count} producto(s)
          </div>
          {(compra.numero_pedido || esDocPropio) && (
            <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
              {compra.numero_pedido ? `Pedido #${compra.numero_pedido}` : `Doc ${compra.id_factura}`}
            </div>
          )}
        </div>
        <span style={{ background: badgeColor + '22', color: badgeColor, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>{badgeLabel}</span>
      </div>
      {viejo && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#fb923c' }}>
          Pedido de hace {diasDesde(compra.fecha)} días: no lo confirmes. Administración lo cierra.
        </div>
      )}
      {!viejo && tab === 'pendientes' && isAuto && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#3b82f6' }}>Cuando llegue, tocá para revisar y confirmar →</div>
      )}
    </div>
  );
}

// ── DETALLE / RECEPCIÓN ────────────────────────────────────────
function BeesDetalle({ compra, user, show, onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notas, setNotas] = useState(compra.notas_recepcion || '');
  const [fotoRecep, setFotoRecep] = useState(null);
  const [fotoRecepUrl, setFotoRecepUrl] = useState(compra.foto_recepcion_url || '');
  const fRef = useRef();
  const fGaleriaRecRef = useRef();
  const isManual = compra.origen === 'manual_sucursal';
  const vencido = !compra.inventariado && diasDesde(compra.fecha) > 10;

  useEffect(() => {
    db.from('v_compras_bees_items')
      .select('id,linea,descripcion,empaque,cantidad,total,cantidad_recibida,diferencia,estado_item,producto_id,confianza_mapeo,notas_item')
      .eq('compra_bees_id', compra.id).order('linea')
      .then(({ data }) => {
        setItems((data || []).map(it => ({ ...it, cantidad_recibida: it.cantidad_recibida ?? it.cantidad })));
        setLoading(false);
      });
  }, [compra.id]);

  const updItem = (i, v) => setItems(prev => prev.map((it, idx) =>
    idx === i ? { ...it, cantidad_recibida: v === '' ? '' : n(v) } : it));

  const handleFotoRecep = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setFotoRecep(f);
    const r = new FileReader();
    r.onload = ev => setFotoRecepUrl(ev.target.result);
    r.readAsDataURL(f);
  };

  const recepcionar = async () => {
    const itemsSinProducto = items.filter(it => !it.producto_id && n(it.cantidad_recibida) > 0);
    let confirmMsg = '¿Confirmar que llegó? Suma al inventario de bebidas.';
    if (itemsSinProducto.length > 0) {
      confirmMsg = `⚠️ ${itemsSinProducto.length} producto(s) sin catálogo no se van a sumar al inventario. ¿Continuar?`;
    }
    if (!window.confirm(confirmMsg)) return;
    setSaving(true);
    try {
      const fotoUrl = fotoRecep ? await subirFoto(fotoRecep, `recep_${compra.id_factura}`) : null;
      const { data, error } = await db.rpc('bees_recepcionar', {
        p_compra_id: compra.id,
        p_items: items.map(it => ({ id: it.id, cantidad_recibida: n(it.cantidad_recibida) })),
        p_usuario_id: user?.id || null,
        p_foto_url: fotoUrl,
        p_notas: notas.trim() || null,
      });
      if (error) throw error;
      if (data?.ya_recepcionado) {
        show('ℹ️ Este pedido ya estaba recibido — no se movió inventario de nuevo');
      } else {
        show(data?.items_kardex > 0
          ? `✅ Recibido — ${data.items_kardex} productos al inventario`
          : '✅ Recibido — sin productos de catálogo para el inventario');
      }
      onBack();
    } catch (e) { show('⚠️ ' + e.message); }
    finally { setSaving(false); }
  };

  const reabrir = async () => {
    if (!window.confirm('⚠️ Reabrir NO descuenta el stock ya recibido (revisar manual). ¿Continuar?')) return;
    const { error } = await db.rpc('bees_reabrir', { p_compra_id: compra.id });
    if (error) { show('⚠️ Error: ' + error.message); return; }
    show('↩️ Recepción reabierta (stock NO descontado automáticamente — revisar manual)');
    onBack();
  };

  const readOnly = compra.inventariado || vencido;
  const esAdmin = ROLES_TODAS.includes(user?.rol);

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 12, cursor: 'pointer', width: 'auto', padding: 0 }}>‹ Volver</button>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{isManual ? 'Entrega registrada en sucursal' : 'Pedido BEES'} · {compra.store_code}</div>
        <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
          {compra.numero_pedido ? <>Pedido <b>{compra.numero_pedido}</b></> : <>Doc <b>{compra.id_factura}</b></>}
        </div>
        <div style={{ color: '#888', fontSize: 12 }}>
          {!isManual && <>Fecha pedido: {fmtDate(compra.fecha)}</>}
          {compra.fecha_recepcion_real && `${isManual ? '' : ' · '}Recibido: ${fmtDate(compra.fecha_recepcion_real)}`}
        </div>
        {n(compra.monto_total) > 0 && (
          <div style={{ color: '#e63946', fontSize: 14, fontWeight: 700, marginTop: 6 }}>Total: ${Number(compra.monto_total).toFixed(2)}</div>
        )}
        {compra.notas_recepcion && <div style={{ fontSize: 12, color: '#ccc', marginTop: 6 }}>📝 {compra.notas_recepcion}</div>}
      </div>

      {compra.inventariado && compra.foto_recepcion_url && (
        <div className="card" style={{ marginBottom: 16, padding: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, margin: '4px 4px 8px' }}>📷 Foto del recibo</div>
          <a href={compra.foto_recepcion_url} target="_blank" rel="noreferrer">
            <img src={compra.foto_recepcion_url} alt="Recibo" style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 6 }} />
          </a>
        </div>
      )}

      <div className="sec-title">{readOnly ? 'Lo que se recibió' : 'Cajas que llegaron'}</div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}><div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} /></div>
      ) : (
        items.map((it, i) => (
          <div key={it.id} className="card" style={{ padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{nombreCorto(it.descripcion)}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {it.notas_item || [it.empaque, n(it.total) > 0 ? `$${Number(it.total).toFixed(2)}` : null].filter(Boolean).join(' · ')}
                  {!it.producto_id && <span style={{ color: '#fb923c', marginLeft: 6 }}>⚠️ sin catálogo</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {!isManual && <div style={{ fontSize: 10, color: '#888' }}>Pedido: {fmtNum(it.cantidad)}</div>}
                {readOnly ? (
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtNum(it.cantidad_recibida)} <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>caja(s)</span></div>
                ) : (
                  <input type="text" inputMode="decimal" value={it.cantidad_recibida}
                    onChange={e => updItem(i, e.target.value.replace(/[^\d.]/g, ''))}
                    style={{
                      width: 70, textAlign: 'right', padding: '6px 8px',
                      background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 6,
                      color: '#e8e6ef', fontSize: 14, fontWeight: 700,
                    }} />
                )}
                {!isManual && n(it.cantidad_recibida) !== n(it.cantidad) && (
                  <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color: n(it.cantidad_recibida) > n(it.cantidad) ? '#22c55e' : '#ef4444' }}>
                    {n(it.cantidad_recibida) > n(it.cantidad) ? '+' : ''}{fmtNum(n(it.cantidad_recibida) - n(it.cantidad))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {vencido && (
        <div className="card" style={{ borderColor: '#fb923c', background: '#fb923c14', fontSize: 13, color: '#fbd5a8', lineHeight: 1.5 }}>
          Este pedido es de hace {diasDesde(compra.fecha)} días. Esas bebidas ya se vendieron, así que confirmarlo hoy inflaría el inventario. Administración lo cierra sin mover stock.
        </div>
      )}

      {!readOnly && (
        <>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📷 Foto del recibo (opcional)</div>
            <input type="file" accept="image/*" capture="environment" ref={fRef} onChange={handleFotoRecep} style={{ display: 'none' }} />
            <input type="file" accept="image/*" ref={fGaleriaRecRef} onChange={handleFotoRecep} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => fRef.current?.click()} style={{ flex: 1 }}>{fotoRecep ? '✅ Foto cargada' : '📷 Cámara'}</button>
              <button className="btn" onClick={() => fGaleriaRecRef.current?.click()} style={{ flex: 1, background: '#2a2a32' }}>🖼️ Galería</button>
            </div>
            {fotoRecep && fotoRecepUrl && <img src={fotoRecepUrl} style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, marginTop: 8 }} alt="" />}
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📝 Notas</div>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
              placeholder="Ej: faltaron 2 cajas, llegaron dañadas..."
              style={{ width: '100%', padding: 10, background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8, color: '#e8e6ef', fontSize: 13 }} />
          </div>
        </>
      )}

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!compra.inventariado && !vencido && (
          <button className="btn btn-red" onClick={recepcionar} disabled={saving}>
            {saving ? 'Guardando…' : '✅ Llegó: confirmar y sumar al inventario'}
          </button>
        )}
        {compra.inventariado && (
          <>
            <div style={{ textAlign: 'center', padding: 12, background: '#22c55e22', color: '#22c55e', borderRadius: 8, fontWeight: 600 }}>
              ✅ Recibido — ya está sumado al inventario de bebidas
            </div>
            {esAdmin && !isManual && (
              <button className="btn" onClick={reabrir} disabled={saving} style={{ background: '#2a2a32' }}>
                ↩️ Reabrir para editar
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── UTILS LOCALES ──────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '10px 12px',
  background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8,
  color: '#e8e6ef', fontSize: 14,
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
