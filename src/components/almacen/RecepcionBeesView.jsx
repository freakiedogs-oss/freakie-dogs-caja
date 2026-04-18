import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n, BUCKET_CIERRES as BUCKET } from '../../config';
import { useToast } from '../../hooks/useToast';

// ════════════════════════════════════════════════════════════════
//  RECEPCIÓN BEES — La Constancia (flujo colaborador de sucursal)
//  Flujo:
//   1. Colaborador sube foto del pedido de la app BEES (en_transito)
//   2. Días después llega mercadería → abre detalle, edita cantidades
//      si hay diferencia, marca "recepcionado"
//   3. Revisa diferencias → marca "inventariar" → trigger suma stock
// ════════════════════════════════════════════════════════════════

export default function RecepcionBeesView({ user, show }) {
  const [view, setView] = useState('lista');         // lista | detalle | nueva
  const [tab, setTab] = useState('pendientes');      // pendientes | por_inventariar | historial
  const [compras, setCompras] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sucursal, setSucursal] = useState(null);

  // Resolver sucursal del usuario
  useEffect(() => {
    if (!user?.sucursal_id) return;
    db.from('sucursales').select('id,nombre,store_code')
      .eq('id', user.sucursal_id).single()
      .then(({ data }) => setSucursal(data));
  }, [user?.sucursal_id]);

  // Ejecutivo/admin ven todas las sucursales
  const esAdmin = ['ejecutivo', 'admin', 'superadmin'].includes(user?.rol);

  const cargar = async () => {
    setLoading(true);
    let q = db.from('compras_bees')
      .select('id,id_factura,numero_pedido,fecha,sucursal_id,store_code,sucursal_header,monto_total,items_count,foto_pedido_url,foto_recepcion_url,estado_recepcion,fecha_recepcion_real,inventariado,notas_recepcion')
      .order('fecha', { ascending: false })
      .limit(60);

    if (!esAdmin && user?.sucursal_id) {
      q = q.eq('sucursal_id', user.sucursal_id);
    }

    if (tab === 'pendientes') {
      q = q.in('estado_recepcion', ['pendiente', 'en_transito']);
    } else if (tab === 'por_inventariar') {
      q = q.eq('estado_recepcion', 'recepcionado').eq('inventariado', false);
    } else {
      q = q.eq('inventariado', true);
    }

    const { data } = await q;
    setCompras(data || []);
    setLoading(false);
  };

  useEffect(() => { cargar(); }, [tab, user?.sucursal_id]);

  if (view === 'detalle' && sel) {
    return <BeesDetalle
      compra={sel} user={user} show={show}
      onBack={() => { setSel(null); setView('lista'); cargar(); }}
    />;
  }
  if (view === 'nueva') {
    return <NuevaCompraBees
      user={user} sucursal={sucursal} esAdmin={esAdmin} show={show}
      onBack={() => { setView('lista'); cargar(); }}
    />;
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
          + Subir Pedido
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #2a2a32' }}>
        {[
          ['pendientes', '📷 En tránsito'],
          ['por_inventariar', '📦 Por inventariar'],
          ['historial', '✅ Inventariados'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '10px 14px',
              background: 'transparent',
              color: tab === key ? '#e63946' : '#aaa',
              border: 'none',
              borderBottom: tab === key ? '2px solid #e63946' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} />
        </div>
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
          onClick={() => { setSel(c); setView('detalle'); }}
        />)
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
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {compra.sucursal_header || 'BEES ' + compra.store_code}
          </div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
            {fmtDate(compra.fecha)} · ${Number(compra.monto_total).toFixed(2)} · {compra.items_count} items
          </div>
          <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
            Factura #{compra.id_factura} · Pedido #{compra.numero_pedido}
          </div>
        </div>
        <span style={{ background: badgeColor + '22', color: badgeColor, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>
          {badgeLabel}
        </span>
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
      .eq('compra_bees_id', compra.id)
      .order('linea')
      .then(({ data }) => {
        setItems((data || []).map(it => ({
          ...it,
          cantidad_recibida: it.cantidad_recibida ?? it.cantidad,
          editando: false,
        })));
        setLoading(false);
      });
  }, [compra.id]);

  const updItem = (i, v) => setItems(prev => prev.map((it, idx) =>
    idx === i ? { ...it, cantidad_recibida: n(v) } : it
  ));

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
      // Guardar cantidades recibidas por item
      for (const it of items) {
        await db.from('compras_bees_items')
          .update({ cantidad_recibida: n(it.cantidad_recibida) })
          .eq('id', it.id);
      }

      let fotoUrl = compra.foto_recepcion_url;
      if (fotoRecep) fotoUrl = await uploadFoto() || fotoUrl;

      await db.from('compras_bees').update({
        estado_recepcion: 'recepcionado',
        fecha_recepcion_real: today(),
        recepcionado_por: user.id,
        foto_recepcion_url: fotoUrl,
        notas_recepcion: notas.trim() || null,
      }).eq('id', compra.id);

      show('✅ Recepción confirmada');
      onBack();
    } catch (e) {
      show('⚠️ Error: ' + e.message);
    } finally { setSaving(false); }
  };

  const inventariar = async () => {
    const itemsSinProducto = items.filter(it => !it.producto_id && n(it.cantidad_recibida) > 0);
    if (itemsSinProducto.length > 0) {
      if (!confirm(`⚠️ ${itemsSinProducto.length} items NO están mapeados a catálogo y se omitirán del inventario. ¿Continuar?`)) return;
    } else if (!confirm('¿Sumar los productos al inventario de esta sucursal? Esta acción registra en kardex.')) return;

    setSaving(true);
    try {
      // Guardar cantidades por si editó algo
      for (const it of items) {
        await db.from('compras_bees_items')
          .update({ cantidad_recibida: n(it.cantidad_recibida) })
          .eq('id', it.id);
      }
      // Trigger dispara al poner inventariado=TRUE
      const { error } = await db.from('compras_bees').update({
        inventariado: true,
        notas_recepcion: notas.trim() || null,
      }).eq('id', compra.id);
      if (error) throw error;
      show('✅ Inventario actualizado + kardex registrado');
      onBack();
    } catch (e) {
      show('⚠️ Error: ' + e.message);
    } finally { setSaving(false); }
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
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
        ‹ Volver
      </button>

      {/* Header */}
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

      {/* Foto del pedido */}
      {compra.foto_pedido_url && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📷 Foto del pedido (BEES app)</div>
          <img src={compra.foto_pedido_url} alt="Pedido BEES" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}

      {/* Lista de items */}
      <div className="sec-title">Items del pedido</div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}><div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} /></div>
      ) : (
        items.map((it, i) => (
          <div key={it.id} className="card" style={{ padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.descripcion}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {it.empaque} · ${Number(it.total).toFixed(2)}
                  {!it.producto_id && <span style={{ color: '#fb923c', marginLeft: 6 }}>⚠️ sin catálogo</span>}
                  {it.confianza_mapeo === 'sugerido' && <span style={{ color: '#fb923c', marginLeft: 6 }}>⚠️ sugerido</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#888' }}>Pedido: {Number(it.cantidad).toFixed(0)}</div>
                <input
                  type="number"
                  step="0.01"
                  value={it.cantidad_recibida}
                  onChange={e => updItem(i, e.target.value)}
                  disabled={readOnly}
                  style={{
                    width: 70, textAlign: 'right', padding: '6px 8px',
                    background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 6, color: '#e8e6ef',
                    fontSize: 14, fontWeight: 700,
                  }}
                />
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

      {/* Totales */}
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

      {/* Foto recepción */}
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

      {/* Notas */}
      {!readOnly && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📝 Notas</div>
          <textarea
            value={notas} onChange={e => setNotas(e.target.value)} rows={2}
            placeholder="Ej: faltaron 2 cajas, llegaron dañadas..."
            style={{ width: '100%', padding: 10, background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 8, color: '#e8e6ef', fontSize: 13 }}
          />
        </div>
      )}

      {/* Acciones */}
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

// ── NUEVA COMPRA BEES (subir foto pedido) ──────────────────────
function NuevaCompraBees({ user, sucursal, esAdmin, show, onBack }) {
  const [idFactura, setIdFactura] = useState('');
  const [numeroPedido, setNumeroPedido] = useState('');
  const [numeroCuenta, setNumeroCuenta] = useState('');
  const [fecha, setFecha] = useState(today());
  const [montoTotal, setMontoTotal] = useState('');
  const [foto, setFoto] = useState(null);
  const [fotoUrl, setFotoUrl] = useState('');
  const [sucursalId, setSucursalId] = useState(user?.sucursal_id || '');
  const [sucursales, setSucursales] = useState([]);
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
  };

  const guardar = async () => {
    if (!idFactura.trim()) { show('⚠️ Ingresa el ID de factura del pedido BEES'); return; }
    if (!n(montoTotal)) { show('⚠️ Ingresa el monto total'); return; }
    const targetSuc = esAdmin ? sucursalId : user.sucursal_id;
    if (!targetSuc) { show('⚠️ Sucursal no definida'); return; }
    setSaving(true);
    try {
      const sucData = esAdmin
        ? sucursales.find(s => s.id === targetSuc)
        : sucursal;
      if (!sucData) throw new Error('Sucursal no encontrada');

      // Subir foto
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

      // Insertar compra_bees
      const subtotal = n(montoTotal) / 1.13;
      const impuestos = n(montoTotal) - subtotal;
      const { error: insErr } = await db.from('compras_bees').insert({
        id_factura: idFactura.trim(),
        numero_pedido: numeroPedido.trim() || null,
        numero_cuenta: numeroCuenta.trim() || null,
        sucursal_id: targetSuc,
        store_code: sucData.store_code,
        proveedor_nombre: 'LA CONSTANCIA (BEES)',
        fecha,
        sucursal_header: sucData.nombre,
        subtotal: subtotal.toFixed(2),
        impuestos: impuestos.toFixed(2),
        ahorro: 0,
        monto_total: n(montoTotal).toFixed(2),
        items_count: 0,
        pdf_archivo: null,
        foto_pedido_url: urlFoto,
        categoria: 'costo_comida',
        subcategoria: 'bebidas',
        estado_recepcion: 'en_transito',
        creado_por: user.id,
      });
      if (insErr) throw insErr;

      show('✅ Pedido registrado — esperando mercadería');
      onBack();
    } catch (e) {
      show('⚠️ Error: ' + e.message);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#e63946', fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
        ‹ Volver
      </button>
      <h2 style={{ margin: 0, fontSize: 20 }}>+ Nuevo pedido BEES</h2>
      <div style={{ color: '#888', fontSize: 12, marginTop: 4, marginBottom: 20 }}>
        Sube la foto del pedido desde la app BEES. Los items se cargarán cuando llegue la mercadería.
      </div>

      {esAdmin && (
        <Field label="Sucursal">
          <select value={sucursalId} onChange={e => setSucursalId(e.target.value)}
            style={inputStyle}>
            <option value="">-- Selecciona --</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Field>
      )}

      <Field label="ID de factura (BEES)">
        <input value={idFactura} onChange={e => setIdFactura(e.target.value)}
          placeholder="Ej: 6197605706" style={inputStyle} />
      </Field>

      <Field label="# de pedido">
        <input value={numeroPedido} onChange={e => setNumeroPedido(e.target.value)}
          placeholder="Ej: 1360991769" style={inputStyle} />
      </Field>

      <Field label="# de cuenta BEES">
        <input value={numeroCuenta} onChange={e => setNumeroCuenta(e.target.value)}
          placeholder="Ej: 14430065" style={inputStyle} />
      </Field>

      <Field label="Fecha del pedido">
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
          style={inputStyle} />
      </Field>

      <Field label="Monto total (USD, con IVA)">
        <input type="number" step="0.01" value={montoTotal} onChange={e => setMontoTotal(e.target.value)}
          placeholder="0.00" style={inputStyle} />
      </Field>

      <Field label="📷 Foto del pedido (app BEES)">
        <input type="file" accept="image/*" capture="environment" ref={fRef} onChange={handleFoto} style={{ display: 'none' }} />
        <button className="btn" type="button" onClick={() => fRef.current?.click()} style={{ width: '100%' }}>
          {foto ? '✅ Foto cargada' : '📷 Tomar / subir foto'}
        </button>
        {fotoUrl && <img src={fotoUrl} style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8, marginTop: 8 }} alt="" />}
      </Field>

      <button className="btn btn-red" onClick={guardar} disabled={saving} style={{ width: '100%', marginTop: 20 }}>
        {saving ? 'Guardando…' : 'Guardar pedido (en tránsito)'}
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
