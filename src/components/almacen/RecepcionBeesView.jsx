import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n, BUCKET_CIERRES as BUCKET } from '../../config';

// ════════════════════════════════════════════════════════════════
//  RECEPCIÓN BEES — La Constancia (flujo colaborador de sucursal)
//  FLUJO v3 con OCR Tesseract.js (GRATIS, client-side, sin API key):
//   1. Colaborador SOLO sube foto del pedido de la app BEES
//   2. Tesseract.js extrae texto + parser regex: cuenta, ID factura,
//      pedido, fecha, montos, items. Pre-llena todo.
//   3. Colaborador verifica + ajusta si hay error, guarda (en_transito)
//   4. Llega mercadería → abre detalle, ajusta cantidades recibidas,
//      marca recepcionado → inventariar (trigger suma stock + kardex)
// ════════════════════════════════════════════════════════════════

// ─── OCR: Tesseract.js lazy-load (mismo patrón que PagosProveedor) ──
let _tesseractLoaded = false;
async function loadTesseract() {
  if (_tesseractLoaded) return;
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  _tesseractLoaded = true;
}

const MESES_BEES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

// Parser del texto OCR del comprobante BEES
function parseBeesText(rawText) {
  const text = rawText.replace(/\r/g, '');
  const get = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };

  const sucursal_header = (() => {
    const first = text.split('\n').map(s => s.trim()).find(l => /FREAKIE/i.test(l));
    return first || null;
  })();
  const numero_cuenta = get(/N[úu]mero\s+de\s+cuenta[:\s]*(\d+)/i);
  const id_factura   = get(/ID\s+de\s+la\s+factura[:\s]*(\d+)/i);
  const numero_pedido = get(/#\s*de\s+pedido[:\s]*(\d+)/i);
  const fecha_texto = get(/(\d{1,2}\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))/i);

  const num = (re) => {
    const m = text.match(re);
    if (!m) return null;
    return parseFloat(m[1].replace(/,/g, ''));
  };
  const subtotal  = num(/Subtotal\s*\$?\s*([\d,]+\.\d{2})/i);
  const impuestos = num(/Impuestos\s*\$?\s*([\d,]+\.\d{2})/i);
  const ahorro    = num(/Ahorraste\s*\$?\s*([\d,]+\.\d{2})/i) ?? 0;
  const total     = num(/Total\s*\$?\s*([\d,]+\.\d{2})/i);

  // Items entre "Artículo Empaque Cant. Total" y "Subtotal"
  const items = [];
  const body = text.match(/Art[íi]culo[^\n]*\n([\s\S]+?)\n\s*Subtotal/i);
  if (body) {
    for (const rawLine of body[1].split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      // Formato típico: "<descripcion> <empaque> <cantidad> $<total>"
      // empaque: "24x 354mililitros" o "12x 300ml"
      const m = line.match(/^(.+?)\s+(\d+\s*x\s*\d+(?:\s*(?:ml|mililitros|gramos|g|L|l))?)\s+([\d.]+)\s+\$?([\d,]+\.\d{2})$/i);
      if (m) {
        items.push({
          descripcion: m[1].trim(),
          empaque: m[2].trim(),
          cantidad: parseFloat(m[3]),
          total: parseFloat(m[4].replace(/,/g, '')),
        });
      } else {
        // línea sin parsing perfecto → guardar como descripcion cruda
        items.push({ descripcion: line, empaque: null, cantidad: 0, total: 0 });
      }
    }
  }

  // Fecha ISO inferida (meses 9-12 año pasado si no hemos llegado; 1-8 año actual)
  let fechaIso = null;
  if (fecha_texto) {
    const m = fecha_texto.toLowerCase().match(/(\d{1,2})\s+(\w+)/);
    if (m && MESES_BEES[m[2]]) {
      const dia = parseInt(m[1]);
      const mes = MESES_BEES[m[2]];
      const now = new Date();
      const yearNow = now.getFullYear();
      const monthNow = now.getMonth() + 1;
      const anio = mes > monthNow ? yearNow - 1 : yearNow;
      fechaIso = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
  }

  return {
    sucursal_header, numero_cuenta, id_factura, numero_pedido,
    fecha_texto, fecha: fechaIso, subtotal, impuestos, ahorro, total, items,
  };
}

async function ocrParseBees(file) {
  await loadTesseract();
  const { data: { text } } = await window.Tesseract.recognize(file, 'spa', {
    logger: () => {},
  });
  return { raw: text, data: parseBeesText(text) };
}

export default function RecepcionBeesView({ user, show }) {
  const [view, setView] = useState('lista');
  const [tab, setTab] = useState('pendientes');
  const [compras, setCompras] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sucursal, setSucursal] = useState(null);

  useEffect(() => {
    if (!user?.sucursal_id) return;
    db.from('sucursales').select('id,nombre,store_code')
      .eq('id', user.sucursal_id).single()
      .then(({ data }) => setSucursal(data));
  }, [user?.sucursal_id]);

  const esAdmin = ['ejecutivo', 'admin', 'superadmin'].includes(user?.rol);

  const cargar = async () => {
    setLoading(true);
    let q = db.from('compras_bees')
      .select('id,id_factura,numero_pedido,fecha,sucursal_id,store_code,sucursal_header,monto_total,items_count,foto_pedido_url,foto_recepcion_url,estado_recepcion,fecha_recepcion_real,inventariado,notas_recepcion')
      .order('fecha', { ascending: false })
      .limit(60);
    if (!esAdmin && user?.sucursal_id) q = q.eq('sucursal_id', user.sucursal_id);
    if (tab === 'pendientes') q = q.in('estado_recepcion', ['pendiente', 'en_transito']);
    else if (tab === 'por_inventariar') q = q.eq('estado_recepcion', 'recepcionado').eq('inventariado', false);
    else q = q.eq('inventariado', true);
    const { data } = await q;
    setCompras(data || []);
    setLoading(false);
  };

  useEffect(() => { cargar(); }, [tab, user?.sucursal_id]);

  if (view === 'detalle' && sel) {
    return <BeesDetalle compra={sel} user={user} show={show}
      onBack={() => { setSel(null); setView('lista'); cargar(); }} />;
  }
  if (view === 'nueva') {
    return <NuevaCompraBees user={user} sucursal={sucursal} esAdmin={esAdmin} show={show}
      onBack={() => { setView('lista'); cargar(); }} />;
  }

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>🥤 Recepción BEES</h2>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
            La Constancia · {sucursal ? sucursal.nombre : esAdmin ? 'Todas las sucursales' : '—'}
          </div>
        </div>
        <button className="btn btn-red" onClick={() => setView('nueva')}>
          📷 Subir foto
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #2a2a32' }}>
        {[['pendientes', '📷 En tránsito'], ['por_inventariar', '📦 Por inventariar'], ['historial', '✅ Inventariados']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '10px 14px', background: 'transparent',
              color: tab === key ? '#e63946' : '#aaa',
              border: 'none', borderBottom: tab === key ? '2px solid #e63946' : '2px solid transparent',
              cursor: 'pointer', fontWeight: 600, fontSize: 13,
            }}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} /></div>
      ) : compras.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🥤</div>
          <div className="empty-text">
            {tab === 'pendientes' && 'No hay pedidos en tránsito'}
            {tab === 'por_inventariar' && 'No hay recepciones por inventariar'}
            {tab === 'historial' && 'No hay compras inventariadas'}
          </div>
        </div>
      ) : (
        compras.map(c => <CompraCard key={c.id} compra={c} tab={tab}
          onClick={() => { setSel(c); setView('detalle'); }} />)
      )}
    </div>
  );
}

// ── CARD RESUMEN ───────────────────────────────────────────────
function CompraCard({ compra, tab, onClick }) {
  const badgeColor =
    compra.estado_recepcion === 'pendiente' ? '#fb923c' :
    compra.estado_recepcion === 'en_transito' ? '#3b82f6' :
    compra.inventariado ? '#22c55e' : '#a855f7';
  const badgeLabel =
    compra.estado_recepcion === 'pendiente' ? 'PENDIENTE' :
    compra.estado_recepcion === 'en_transito' ? 'EN TRÁNSITO' :
    compra.inventariado ? 'INVENTARIADO' : 'POR INVENTARIAR';

  return (
    <div className="card" style={{ cursor: 'pointer', borderLeft: `3px solid ${badgeColor}` }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{compra.sucursal_header || 'BEES ' + compra.store_code}</div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
            {fmtDate(compra.fecha)} · ${Number(compra.monto_total).toFixed(2)} · {compra.items_count} items
          </div>
          <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
            Factura #{compra.id_factura} · Pedido #{compra.numero_pedido}
          </div>
        </div>
        <span style={{ background: badgeColor + '22', color: badgeColor, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{badgeLabel}</span>
      </div>
      {tab === 'pendientes' && compra.foto_pedido_url && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#3b82f6' }}>📷 Foto del pedido adjunta →</div>
      )}
      {tab === 'por_inventariar' && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#a855f7', fontWeight: 600 }}>Tap para revisar e inventariar →</div>
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

  useEffect(() => {
    db.from('v_compras_bees_items')
      .select('id,linea,descripcion,empaque,cantidad,total,cantidad_recibida,diferencia,estado_item,producto_id,confianza_mapeo')
      .eq('compra_bees_id', compra.id).order('linea')
      .then(({ data }) => {
        setItems((data || []).map(it => ({ ...it, cantidad_recibida: it.cantidad_recibida ?? it.cantidad })));
        setLoading(false);
      });
  }, [compra.id]);

  const updItem = (i, v) => setItems(prev => prev.map((it, idx) =>
    idx === i ? { ...it, cantidad_recibida: n(v) } : it));

  const handleFotoRecep = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setFotoRecep(f);
    const r = new FileReader();
    r.onload = ev => setFotoRecepUrl(ev.target.result);
    r.readAsDataURL(f);
  };

  const uploadFoto = async () => {
    if (!fotoRecep) return null;
    const ext = (fotoRecep.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `bees/recep_${compra.id_factura}_${Date.now()}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, fotoRecep, { cacheControl: '3600', upsert: false });
    if (error) { show('⚠️ Error subiendo foto: ' + error.message); return null; }
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  };

  const recepcionar = async () => {
    if (!confirm('¿Confirmar recepción? Se guardarán las cantidades editadas.')) return;
    setSaving(true);
    try {
      for (const it of items) {
        await db.from('compras_bees_items').update({ cantidad_recibida: n(it.cantidad_recibida) }).eq('id', it.id);
      }
      let fotoUrl = compra.foto_recepcion_url;
      if (fotoRecep) fotoUrl = await uploadFoto() || fotoUrl;
      await db.from('compras_bees').update({
        estado_recepcion: 'recepcionado', fecha_recepcion_real: today(),
        recepcionado_por: user.id, foto_recepcion_url: fotoUrl,
        notas_recepcion: notas.trim() || null,
      }).eq('id', compra.id);
      show('✅ Recepción confirmada');
      onBack();
    } catch (e) { show('⚠️ Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const inventariar = async () => {
    const itemsSinProducto = items.filter(it => !it.producto_id && n(it.cantidad_recibida) > 0);
    if (itemsSinProducto.length > 0) {
      if (!confirm(`⚠️ ${itemsSinProducto.length} items NO mapeados se omitirán del inventario. ¿Continuar?`)) return;
    } else if (!confirm('¿Sumar los productos al inventario? Registra en kardex.')) return;
    setSaving(true);
    try {
      for (const it of items) {
        await db.from('compras_bees_items').update({ cantidad_recibida: n(it.cantidad_recibida) }).eq('id', it.id);
      }
      const { error } = await db.from('compras_bees').update({
        inventariado: true, notas_recepcion: notas.trim() || null,
      }).eq('id', compra.id);
      if (error) throw error;
      show('✅ Inventario actualizado + kardex registrado');
      onBack();
    } catch (e) { show('⚠️ Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const reabrir = async () => {
    if (!confirm('¿Reabrir la recepción? Podrás editar cantidades de nuevo.')) return;
    await db.from('compras_bees').update({ estado_recepcion: 'en_transito' }).eq('id', compra.id);
    show('↩️ Recepción reabierta');
    onBack();
  };

  const totalDif = items.reduce((s, it) => s + (n(it.cantidad_recibida) - n(it.cantidad)), 0);
  const totalMontoReal = items.reduce((s, it) => s + (it.cantidad > 0 ? (n(it.cantidad_recibida) / n(it.cantidad)) * n(it.total) : 0), 0);
  const readOnly = compra.inventariado;

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>‹ Volver</button>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{compra.sucursal_header || 'BEES ' + compra.store_code}</div>
        <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
          Factura <b>{compra.id_factura}</b> · Pedido <b>{compra.numero_pedido}</b>
        </div>
        <div style={{ color: '#888', fontSize: 12 }}>
          Fecha pedido: {fmtDate(compra.fecha)}
          {compra.fecha_recepcion_real && ` · Recepcionado: ${fmtDate(compra.fecha_recepcion_real)}`}
        </div>
        <div style={{ color: '#e63946', fontSize: 14, fontWeight: 700, marginTop: 6 }}>
          Total: ${Number(compra.monto_total).toFixed(2)}
        </div>
      </div>

      {compra.foto_pedido_url && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📷 Foto del pedido (BEES app)</div>
          <img src={compra.foto_pedido_url} alt="Pedido BEES" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}

      <div className="sec-title">Items del pedido</div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}><div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} /></div>
      ) : (
        items.map((it, i) => (
          <div key={it.id} className="card" style={{ padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{it.descripcion}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {it.empaque} · ${Number(it.total).toFixed(2)}
                  {!it.producto_id && <span style={{ color: '#fb923c', marginLeft: 6 }}>⚠️ sin catálogo</span>}
                  {it.confianza_mapeo === 'sugerido' && <span style={{ color: '#fb923c', marginLeft: 6 }}>⚠️ sugerido</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#888' }}>Pedido: {Number(it.cantidad).toFixed(0)}</div>
                <input type="number" step="0.01" value={it.cantidad_recibida}
                  onChange={e => updItem(i, e.target.value)} disabled={readOnly}
                  style={{
                    width: 70, textAlign: 'right', padding: '6px 8px',
                    background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 6,
                    color: '#e8e6ef', fontSize: 14, fontWeight: 700,
                  }} />
                {n(it.cantidad_recibida) !== n(it.cantidad) && (
                  <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color: n(it.cantidad_recibida) > n(it.cantidad) ? '#22c55e' : '#ef4444' }}>
                    {n(it.cantidad_recibida) > n(it.cantidad) ? '+' : ''}{(n(it.cantidad_recibida) - n(it.cantidad)).toFixed(0)}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      <div className="card" style={{ background: '#1c1c22', marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#888' }}>Diferencia total items:</span>
          <b style={{ color: totalDif === 0 ? '#22c55e' : totalDif > 0 ? '#22c55e' : '#ef4444' }}>
            {totalDif > 0 ? '+' : ''}{totalDif.toFixed(0)}
          </b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 6 }}>
          <span style={{ color: '#888' }}>Monto real estimado:</span>
          <b>${totalMontoReal.toFixed(2)}</b>
        </div>
      </div>

      {!readOnly && compra.estado_recepcion === 'recepcionado' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📷 Foto al recepcionar (opcional)</div>
          <input type="file" accept="image/*" capture="environment" ref={fRef} onChange={handleFotoRecep} style={{ display: 'none' }} />
          <button className="btn" onClick={() => fRef.current?.click()}>
            {fotoRecep ? '✅ Foto cargada' : '📷 Tomar foto'}
          </button>
          {fotoRecepUrl && <img src={fotoRecepUrl} style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, marginTop: 8 }} alt="" />}
        </div>
      )}

      {!readOnly && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📝 Notas</div>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
            placeholder="Ej: faltaron 2 cajas, llegaron dañadas..."
            style={{ width: '100%', padding: 10, background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8, color: '#e8e6ef', fontSize: 13 }} />
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {compra.estado_recepcion !== 'recepcionado' && !compra.inventariado && (
          <button className="btn btn-red" onClick={recepcionar} disabled={saving}>
            {saving ? 'Guardando…' : '✅ Confirmar recepción'}
          </button>
        )}
        {compra.estado_recepcion === 'recepcionado' && !compra.inventariado && (
          <>
            <button className="btn btn-red" onClick={inventariar} disabled={saving}>
              {saving ? 'Inventariando…' : '📦 Sumar al inventario'}
            </button>
            <button className="btn" onClick={reabrir} disabled={saving} style={{ background: '#2a2a32' }}>
              ↩️ Reabrir para editar
            </button>
          </>
        )}
        {compra.inventariado && (
          <div style={{ textAlign: 'center', padding: 12, background: '#22c55e22', color: '#22c55e', borderRadius: 8, fontWeight: 600 }}>
            ✅ Ya inventariado — suma reflejada en stock
          </div>
        )}
      </div>
    </div>
  );
}

// ── NUEVA COMPRA BEES (OCR-first) ──────────────────────────────
// Flujo: usuario sube foto → edge function OCR → prellena campos + items →
// usuario verifica/corrige → guarda (estado=en_transito, items incluidos).
function NuevaCompraBees({ user, sucursal, esAdmin, show, onBack }) {
  const [step, setStep] = useState('upload');  // upload | procesando | revisar
  const [foto, setFoto] = useState(null);
  const [fotoUrl, setFotoUrl] = useState('');
  const [ocrData, setOcrData] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [sucursalId, setSucursalId] = useState(user?.sucursal_id || '');

  // Campos editables tras OCR
  const [idFactura, setIdFactura] = useState('');
  const [numeroPedido, setNumeroPedido] = useState('');
  const [numeroCuenta, setNumeroCuenta] = useState('');
  const [sucursalHeader, setSucursalHeader] = useState('');
  const [fecha, setFecha] = useState(today());
  const [subtotal, setSubtotal] = useState('');
  const [impuestos, setImpuestos] = useState('');
  const [ahorro, setAhorro] = useState('0');
  const [total, setTotal] = useState('');
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const fRef = useRef();

  useEffect(() => {
    if (!esAdmin) return;
    db.from('sucursales').select('id,nombre,store_code').eq('activa', true)
      .then(({ data }) => setSucursales(data || []));
  }, [esAdmin]);

  const handleFoto = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setFoto(f);
    const r = new FileReader();
    r.onload = ev => setFotoUrl(ev.target.result);
    r.readAsDataURL(f);
    // Auto-procesar al seleccionar foto
    await procesarOCR(f);
  };

  const procesarOCR = async (file) => {
    setStep('procesando');
    try {
      // Tesseract.js client-side (gratis, sin API key)
      const { data: d } = await ocrParseBees(file);

      setOcrData(d);
      setIdFactura(d.id_factura || '');
      setNumeroPedido(d.numero_pedido || '');
      setNumeroCuenta(d.numero_cuenta || '');
      setSucursalHeader(d.sucursal_header || '');
      if (d.fecha) setFecha(d.fecha);
      setSubtotal(d.subtotal != null ? String(d.subtotal) : '');
      setImpuestos(d.impuestos != null ? String(d.impuestos) : '');
      setAhorro(d.ahorro != null ? String(d.ahorro) : '0');
      setTotal(d.total != null ? String(d.total) : '');
      setItems((d.items || []).map((it, i) => ({
        linea: i + 1,
        descripcion: it.descripcion || '',
        empaque: it.empaque || '',
        cantidad: n(it.cantidad),
        total: n(it.total),
      })));

      show(`✅ OCR extrajo ${d.items?.length || 0} items`);
      setStep('revisar');
    } catch (e) {
      show('⚠️ OCR falló: ' + (e.message || e));
      setStep('upload');
    }
  };

  const updItem = (i, field, v) => setItems(prev => prev.map((it, idx) =>
    idx === i ? { ...it, [field]: field === 'descripcion' || field === 'empaque' ? v : n(v) } : it));
  const addItem = () => setItems(prev => [...prev, { linea: prev.length + 1, descripcion: '', empaque: '', cantidad: 0, total: 0 }]);
  const delItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i).map((it, idx) => ({ ...it, linea: idx + 1 })));

  const guardar = async () => {
    if (!idFactura.trim()) { show('⚠️ ID factura requerido'); return; }
    if (!n(total)) { show('⚠️ Monto total requerido'); return; }
    const targetSuc = esAdmin ? sucursalId : user.sucursal_id;
    if (!targetSuc) { show('⚠️ Sucursal no definida'); return; }
    setSaving(true);
    try {
      const sucData = esAdmin ? sucursales.find(s => s.id === targetSuc) : sucursal;
      if (!sucData) throw new Error('Sucursal no encontrada');

      // Subir foto al bucket
      let urlFoto = null;
      if (foto) {
        const ext = (foto.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `bees/pedido_${idFactura}_${Date.now()}.${ext}`;
        const { error } = await db.storage.from(BUCKET).upload(path, foto, { cacheControl: '3600', upsert: false });
        if (!error) {
          const { data } = db.storage.from(BUCKET).getPublicUrl(path);
          urlFoto = data?.publicUrl;
        }
      }

      // Calcular subtotal/impuestos si falta
      const totalNum = n(total);
      const subNum = n(subtotal) || +(totalNum / 1.13).toFixed(2);
      const impNum = n(impuestos) || +(totalNum - subNum).toFixed(2);

      // Insertar compra_bees
      const { data: inserted, error: insErr } = await db.from('compras_bees').insert({
        id_factura: idFactura.trim(),
        numero_pedido: numeroPedido.trim() || null,
        numero_cuenta: numeroCuenta.trim() || null,
        sucursal_id: targetSuc,
        store_code: sucData.store_code,
        proveedor_nombre: 'LA CONSTANCIA (BEES)',
        fecha, sucursal_header: sucursalHeader || sucData.nombre,
        subtotal: subNum, impuestos: impNum, ahorro: n(ahorro) || 0,
        monto_total: totalNum,
        items_count: items.length,
        pdf_archivo: null,
        foto_pedido_url: urlFoto,
        categoria: 'costo_comida',
        subcategoria: 'bebidas',
        estado_recepcion: 'en_transito',
        creado_por: user.id,
      }).select().single();
      if (insErr) throw insErr;

      // Insertar items — tratando de mapear a catalogo_productos por descripcion exacta
      if (items.length > 0) {
        // Resolver producto_id por nombre (match exacto normalizado)
        const descripciones = items.map(it => it.descripcion).filter(Boolean);
        const { data: prods } = await db.from('catalogo_productos')
          .select('id,nombre').in('nombre', descripciones);
        const mapNombre = new Map((prods || []).map(p => [p.nombre.toLowerCase().trim(), p.id]));

        const rows = items.map(it => ({
          compra_bees_id: inserted.id,
          linea: it.linea,
          descripcion: it.descripcion,
          empaque: it.empaque || null,
          cantidad: n(it.cantidad),
          total: n(it.total),
          producto_id: mapNombre.get(it.descripcion.toLowerCase().trim()) || null,
          confianza_mapeo: mapNombre.has(it.descripcion.toLowerCase().trim()) ? 'auto' : 'pendiente',
        }));
        const { error: itErr } = await db.from('compras_bees_items').insert(rows);
        if (itErr) throw itErr;
      }

      show('✅ Pedido registrado — esperando mercadería');
      onBack();
    } catch (e) {
      show('⚠️ Error: ' + (e.message || e));
    } finally { setSaving(false); }
  };

  // ── UI ──
  if (step === 'upload' || step === 'procesando') {
    return (
      <div style={{ padding: '16px 16px 100px' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>‹ Volver</button>
        <h2 style={{ margin: 0, fontSize: 20 }}>📷 Nuevo pedido BEES</h2>
        <div style={{ color: '#888', fontSize: 13, marginTop: 6, marginBottom: 24 }}>
          Sube la captura del pedido desde la app BEES. El sistema lee automáticamente todos los datos con IA.
        </div>

        {esAdmin && (
          <Field label="Sucursal (solo admin/ejecutivo)">
            <select value={sucursalId} onChange={e => setSucursalId(e.target.value)} style={inputStyle}>
              <option value="">-- Selecciona --</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Field>
        )}

        <input type="file" accept="image/*" capture="environment" ref={fRef} onChange={handleFoto} style={{ display: 'none' }} />

        {step === 'upload' && (
          <>
            <button className="btn btn-red" onClick={() => fRef.current?.click()} style={{ width: '100%', padding: '20px', fontSize: 16 }}>
              📷 Tomar / subir foto del pedido
            </button>
            <div style={{ marginTop: 16, padding: 12, background: '#1c1c22', borderRadius: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
              💡 Tip: toma la captura directa de la app BEES donde se ve el comprobante completo (ID, pedido, items, total). El OCR extrae todo y solo necesitas revisar. OCR gratis (Tesseract.js).
            </div>
          </>
        )}

        {step === 'procesando' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            {fotoUrl && <img src={fotoUrl} style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8, marginBottom: 20, opacity: 0.6 }} alt="" />}
            <div className="spin" style={{ width: 36, height: 36, margin: '0 auto 12px' }} />
            <div style={{ fontSize: 14, color: '#3b82f6', fontWeight: 600 }}>📖 Leyendo el comprobante…</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>(10-30 segundos, primera vez baja el motor OCR ~5MB)</div>
          </div>
        )}
      </div>
    );
  }

  // step === 'revisar'
  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <button onClick={() => { setStep('upload'); setOcrData(null); }} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
        ‹ Tomar otra foto
      </button>
      <h2 style={{ margin: 0, fontSize: 20 }}>✓ Verifica los datos</h2>
      <div style={{ color: '#888', fontSize: 12, marginTop: 4, marginBottom: 16 }}>
        El OCR extrajo estos datos. Corrige si hay error y guarda.
      </div>

      {fotoUrl && (
        <div className="card" style={{ marginBottom: 16, padding: 8 }}>
          <img src={fotoUrl} style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 6 }} alt="" />
        </div>
      )}

      <Field label="Local (según foto)"><input value={sucursalHeader} onChange={e => setSucursalHeader(e.target.value)} style={inputStyle} /></Field>
      <Field label="ID de factura (BEES)"><input value={idFactura} onChange={e => setIdFactura(e.target.value)} style={inputStyle} /></Field>
      <Field label="# de pedido"><input value={numeroPedido} onChange={e => setNumeroPedido(e.target.value)} style={inputStyle} /></Field>
      <Field label="# de cuenta BEES"><input value={numeroCuenta} onChange={e => setNumeroCuenta(e.target.value)} style={inputStyle} /></Field>
      <Field label="Fecha del pedido"><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} /></Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Subtotal"><input type="number" step="0.01" value={subtotal} onChange={e => setSubtotal(e.target.value)} style={inputStyle} /></Field>
        <Field label="Impuestos"><input type="number" step="0.01" value={impuestos} onChange={e => setImpuestos(e.target.value)} style={inputStyle} /></Field>
        <Field label="Ahorro"><input type="number" step="0.01" value={ahorro} onChange={e => setAhorro(e.target.value)} style={inputStyle} /></Field>
        <Field label="TOTAL"><input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value)} style={{...inputStyle, color: '#e63946', fontWeight: 700}} /></Field>
      </div>

      <div className="sec-title" style={{ marginTop: 8 }}>Items ({items.length})</div>
      {items.map((it, i) => (
        <div key={i} className="card" style={{ padding: 10, marginBottom: 8 }}>
          <input value={it.descripcion} onChange={e => updItem(i, 'descripcion', e.target.value)}
            placeholder="Descripción"
            style={{ ...inputStyle, fontSize: 13, marginBottom: 6 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.9fr auto', gap: 6, alignItems: 'center' }}>
            <input value={it.empaque} onChange={e => updItem(i, 'empaque', e.target.value)}
              placeholder="Empaque"
              style={{ ...inputStyle, fontSize: 12, padding: '6px 8px' }} />
            <input type="number" step="0.01" value={it.cantidad} onChange={e => updItem(i, 'cantidad', e.target.value)}
              placeholder="Cant"
              style={{ ...inputStyle, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
            <input type="number" step="0.01" value={it.total} onChange={e => updItem(i, 'total', e.target.value)}
              placeholder="Total $"
              style={{ ...inputStyle, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
            <button onClick={() => delItem(i)}
              style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
        </div>
      ))}
      <button onClick={addItem} className="btn" style={{ width: '100%', marginBottom: 16, background: '#2a2a32' }}>+ Agregar ítem manual</button>

      <button className="btn btn-red" onClick={guardar} disabled={saving} style={{ width: '100%', padding: 14, fontSize: 15 }}>
        {saving ? 'Guardando…' : '✅ Confirmar y guardar pedido'}
      </button>
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
