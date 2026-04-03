import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n, STORES } from '../../config';

// ── Roles ──
const ROLES_SUCURSAL = ['gerente', 'cocina', 'admin', 'ejecutivo']; // Pueden crear devolución desde sucursal
const ROLES_CM = ['jefe_casa_matriz', 'produccion', 'admin', 'ejecutivo']; // Pueden recibir en CM

const MOTIVOS = {
  error_despacho: { label: 'Error de despacho', icon: '📦', desc: 'Producto incorrecto o cantidad errónea enviada' },
  vencimiento: { label: 'Vencimiento', icon: '📅', desc: 'Producto próximo a vencer o ya vencido' },
  mala_calidad: { label: 'Mala calidad', icon: '⚠️', desc: 'Producto en mal estado o calidad inaceptable' },
  sobrante: { label: 'Sobrante', icon: '📊', desc: 'Exceso de inventario, no se necesita' },
  otro: { label: 'Otro motivo', icon: '📋', desc: 'Otro motivo no listado' },
};

const ESTADO_COLORS = { enviada: '#3b82f6', recibida: '#4ade80', rechazada: '#ef4444' };
const ESTADO_LABELS = { enviada: '📤 Enviada', recibida: '✅ Recibida', rechazada: '❌ Rechazada' };

export default function DevolucionesView({ user }) {
  const [tab, setTab] = useState('crear');
  const esCM = ROLES_CM.includes(user?.rol);
  const esSucursal = ROLES_SUCURSAL.includes(user?.rol);

  // ── ESTADO: Crear devolución ──
  const [fecha, setFecha] = useState(today());
  const [motivo, setMotivo] = useState('');
  const [notas, setNotas] = useState('');
  const [items, setItems] = useState([]);
  const [productos, setProductos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // ── ESTADO: Historial / Recibir ──
  const [devoluciones, setDevoluciones] = useState([]);
  const [detalleSel, setDetalleSel] = useState(null);
  const [detalleItems, setDetalleItems] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [notasCM, setNotasCM] = useState('');

  // Cargar productos
  useEffect(() => {
    db.from('catalogo_productos').select('id,nombre,unidad_medida,categoria')
      .eq('activo', true).order('nombre')
      .then(res => setProductos(res.data || []));
  }, []);

  // ── Agregar item ──
  const addItem = () => {
    setItems(prev => [...prev, { _key: Date.now(), producto_id: '', cantidad: '', lote_origen: '', motivo_detalle: '' }]);
  };

  const updateItem = (key, field, value) => {
    setItems(prev => prev.map(i => i._key === key ? { ...i, [field]: value } : i));
  };

  const removeItem = (key) => {
    setItems(prev => prev.filter(i => i._key !== key));
  };

  // ── Crear devolución ──
  const crearDevolucion = async () => {
    if (!motivo) { setError('Selecciona un motivo'); return; }
    if (items.length === 0) { setError('Agrega al menos un producto'); return; }
    const sinProducto = items.find(i => !i.producto_id || !i.cantidad || n(i.cantidad) <= 0);
    if (sinProducto) { setError('Cada item necesita producto y cantidad > 0'); return; }

    setSaving(true);
    setError(null);
    try {
      // Insertar cabecera
      const { data: dev, error: err1 } = await db.from('devoluciones_sucursal').insert({
        fecha,
        store_code: user?.store_code || 'S001',
        motivo,
        notas_sucursal: notas || null,
        creado_por: `${user?.nombre || ''} ${user?.apellido || ''}`.trim(),
        creado_por_id: user?.id || null,
      }).select();
      if (err1) throw err1;

      const devId = dev[0].id;

      // Insertar items
      const rows = items.map(i => {
        const prod = productos.find(p => p.id === i.producto_id);
        return {
          devolucion_id: devId,
          producto_id: i.producto_id,
          cantidad: n(i.cantidad),
          unidad_medida: prod?.unidad_medida || 'unidad',
          lote_origen: i.lote_origen || null,
          motivo_detalle: i.motivo_detalle || null,
        };
      });
      const { error: err2 } = await db.from('devolucion_items').insert(rows);
      if (err2) throw err2;

      setSuccess(`✅ Devolución creada — ${items.length} producto(s). Pendiente recepción en Casa Matriz.`);
      setMotivo('');
      setNotas('');
      setItems([]);
      setFecha(today());
    } catch (err) {
      setError(err.message || 'Error al crear devolución');
    }
    setSaving(false);
  };

  // ── Cargar devoluciones ──
  const cargarDevoluciones = useCallback(async () => {
    setLoadingList(true);
    let query = db.from('devoluciones_sucursal')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    // Sucursales solo ven las suyas, CM ve todas
    if (!esCM && user?.store_code && user.store_code !== 'CM001') {
      query = query.eq('store_code', user.store_code);
    }

    const { data } = await query;
    setDevoluciones(data || []);
    setLoadingList(false);
  }, [user?.store_code, esCM]);

  useEffect(() => {
    if (tab === 'historial' || tab === 'recibir') cargarDevoluciones();
  }, [tab, cargarDevoluciones]);

  // ── Cargar detalle ──
  const verDetalle = async (dev) => {
    setDetalleSel(dev);
    setNotasCM('');
    const { data } = await db.from('devolucion_items')
      .select('*, catalogo_productos(nombre, unidad_medida)')
      .eq('devolucion_id', dev.id);
    setDetalleItems(data || []);
  };

  // ── Recibir / Rechazar ──
  const cambiarEstado = async (nuevoEstado) => {
    if (!detalleSel) return;
    try {
      await db.from('devoluciones_sucursal').update({
        estado: nuevoEstado,
        notas_cm: notasCM || null,
        recibido_por: `${user?.nombre || ''} ${user?.apellido || ''}`.trim(),
        recibido_por_id: user?.id || null,
        fecha_recepcion: new Date().toISOString(),
      }).eq('id', detalleSel.id);

      // Si se recibió, incrementar inventario CM001
      if (nuevoEstado === 'recibida') {
        const CM_ID = '584aee3c-a842-496f-9f2b-1e3bac6e6b23';
        const promises = detalleItems.map(async (item) => {
          // Intentar incrementar stock en CM
          const { data: inv } = await db.from('inventario')
            .select('id, stock_actual')
            .eq('producto_id', item.producto_id)
            .eq('sucursal_id', CM_ID)
            .limit(1);

          if (inv && inv.length > 0) {
            await db.from('inventario').update({
              stock_actual: n(inv[0].stock_actual) + n(item.cantidad),
              ultima_actualizacion: new Date().toISOString(),
            }).eq('id', inv[0].id);
          }

          // Decrementar stock en sucursal origen
          const { data: sucData } = await db.from('sucursales')
            .select('id').eq('store_code', detalleSel.store_code).limit(1);
          if (sucData && sucData.length > 0) {
            const { data: invSuc } = await db.from('inventario')
              .select('id, stock_actual')
              .eq('producto_id', item.producto_id)
              .eq('sucursal_id', sucData[0].id)
              .limit(1);
            if (invSuc && invSuc.length > 0) {
              await db.from('inventario').update({
                stock_actual: Math.max(0, n(invSuc[0].stock_actual) - n(item.cantidad)),
                ultima_actualizacion: new Date().toISOString(),
              }).eq('id', invSuc[0].id);
            }
          }
        });
        await Promise.all(promises);
      }

      setDetalleSel(null);
      cargarDevoluciones();
    } catch (err) {
      setError(err.message);
    }
  };

  // ── TABS ──
  const TabBar = () => (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#fff' }}>🔄 Devoluciones</h2>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #333', overflowX: 'auto' }}>
        {[
          { k: 'crear', l: '📤 Nueva', show: esSucursal },
          { k: 'recibir', l: `📥 Recibir (${devoluciones.filter(d => d.estado === 'enviada').length})`, show: esCM },
          { k: 'historial', l: '📋 Historial', show: true },
        ].filter(t => t.show).map(t => (
          <button key={t.k} onClick={() => { setTab(t.k); setDetalleSel(null); }}
            style={{ padding: '8px 14px', borderRadius: 0, border: 'none', background: 'none', whiteSpace: 'nowrap',
              color: tab === t.k ? '#e63946' : '#666', borderBottom: tab === t.k ? '2px solid #e63946' : 'none',
              cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            {t.l}
          </button>
        ))}
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  // TAB: CREAR DEVOLUCIÓN
  // ══════════════════════════════════════════════════════════════
  if (tab === 'crear') {
    return (
      <div style={{ padding: 16 }}>
        <TabBar />
        {error && <div style={{ background: '#8b0000', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {error}</div>}
        {success && <div style={{ background: '#2d6a4f', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{success}</div>}

        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
            📍 Sucursal: <strong style={{ color: '#4ade80' }}>{STORES[user?.store_code] || user?.store_code}</strong>
            <span style={{ color: '#666', marginLeft: 8 }}>→ Casa Matriz</span>
          </div>

          <label style={lbl}>Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} />

          {/* Motivo */}
          <label style={lbl}>Motivo de Devolución</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {Object.entries(MOTIVOS).map(([k, v]) => (
              <button key={k} onClick={() => setMotivo(k)}
                style={{ padding: '10px 14px', borderRadius: 8, textAlign: 'left',
                  border: motivo === k ? '2px solid #e63946' : '1px solid #333',
                  background: motivo === k ? '#1a0a0a' : '#16213e', color: '#fff', cursor: 'pointer' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{v.icon} {v.label}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{v.desc}</div>
              </button>
            ))}
          </div>

          {/* Notas */}
          <label style={lbl}>Notas (opcional)</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)}
            placeholder="Detalles adicionales..." rows={2} style={{ ...inp, resize: 'vertical' }} />
        </div>

        {/* Items */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: '#fff' }}>Productos a Devolver</h3>
            <button onClick={addItem}
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#e63946', color: '#fff',
                cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              + Agregar
            </button>
          </div>

          {items.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#666', padding: 16, fontSize: 13 }}>
              Presiona "+ Agregar" para incluir productos
            </div>
          ) : (
            items.map((item, idx) => (
              <div key={item._key} style={{ background: '#0d1b2a', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#888' }}>Item #{idx + 1}</span>
                  <button onClick={() => removeItem(item._key)}
                    style={{ background: 'none', border: 'none', color: '#e63946', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>

                <select value={item.producto_id} onChange={e => updateItem(item._key, 'producto_id', e.target.value)}
                  style={{ ...inp, marginBottom: 6 }}>
                  <option value="">— Seleccionar producto —</option>
                  {productos.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre} ({p.unidad_medida})</option>
                  ))}
                </select>

                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input type="number" step="0.01" min="0" value={item.cantidad}
                    onChange={e => updateItem(item._key, 'cantidad', e.target.value)}
                    placeholder="Cantidad" style={{ ...inp, flex: 1 }} />
                  <input type="text" value={item.lote_origen}
                    onChange={e => updateItem(item._key, 'lote_origen', e.target.value)}
                    placeholder="Lote (opc.)" style={{ ...inp, flex: 1 }} />
                </div>

                <input type="text" value={item.motivo_detalle}
                  onChange={e => updateItem(item._key, 'motivo_detalle', e.target.value)}
                  placeholder="Detalle del problema (opc.)" style={inp} />
              </div>
            ))
          )}
        </div>

        {/* Botón enviar */}
        {items.length > 0 && motivo && (
          <button onClick={crearDevolucion} disabled={saving}
            style={{ width: '100%', background: saving ? '#555' : '#e63946', color: '#fff',
              border: 'none', borderRadius: 8, padding: '14px', fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14 }}>
            {saving ? '⏳ Enviando...' : `📤 Enviar Devolución (${items.length} productos)`}
          </button>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: RECIBIR (solo CM)
  // ══════════════════════════════════════════════════════════════
  if (tab === 'recibir') {
    const pendientesRecibir = devoluciones.filter(d => d.estado === 'enviada');

    if (detalleSel) {
      return (
        <div style={{ padding: 16 }}>
          <TabBar />
          <button onClick={() => setDetalleSel(null)}
            style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
            ← Volver
          </button>

          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#fff' }}>
              Devolución de {STORES[detalleSel.store_code] || detalleSel.store_code}
            </h3>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
              {fmtDate(detalleSel.fecha)} · {detalleSel.creado_por}
            </div>
            <div style={{ fontSize: 13, color: '#f59e0b', marginBottom: 8 }}>
              {MOTIVOS[detalleSel.motivo]?.icon} {MOTIVOS[detalleSel.motivo]?.label}
            </div>
            {detalleSel.notas_sucursal && (
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12, fontStyle: 'italic' }}>
                📝 {detalleSel.notas_sucursal}
              </div>
            )}

            {/* Items de la devolución */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={th}>Producto</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cantidad</th>
                  <th style={th}>Lote</th>
                </tr>
              </thead>
              <tbody>
                {detalleItems.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '8px 4px', fontSize: 12, color: '#ddd' }}>
                      {item.catalogo_productos?.nombre || '?'}
                    </td>
                    <td style={{ padding: '8px 4px', fontSize: 12, color: '#f59e0b', textAlign: 'right' }}>
                      {n(item.cantidad)} {item.catalogo_productos?.unidad_medida || item.unidad_medida}
                    </td>
                    <td style={{ padding: '8px 4px', fontSize: 11, color: '#888' }}>
                      {item.lote_origen || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Notas CM */}
            <label style={lbl}>Notas de recepción (opcional)</label>
            <textarea value={notasCM} onChange={e => setNotasCM(e.target.value)}
              placeholder="Observaciones al recibir..." rows={2} style={{ ...inp, resize: 'vertical', marginBottom: 12 }} />

            {/* Botones */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => cambiarEstado('recibida')}
                style={{ flex: 1, padding: '12px', borderRadius: 8, border: 'none', background: '#2d6a4f',
                  color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                ✅ Confirmar Recepción
              </button>
              <button onClick={() => cambiarEstado('rechazada')}
                style={{ flex: 1, padding: '12px', borderRadius: 8, border: 'none', background: '#8b0000',
                  color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                ❌ Rechazar
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ padding: 16 }}>
        <TabBar />
        {pendientesRecibir.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#4ade80', padding: 20 }}>✅ No hay devoluciones pendientes de recepción</div>
        ) : (
          pendientesRecibir.map(d => (
            <div key={d.id} className="card" onClick={() => verDetalle(d)}
              style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8, borderLeft: '3px solid #3b82f6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
                    {STORES[d.store_code] || d.store_code}
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                    {fmtDate(d.fecha)} · {d.creado_por}
                  </div>
                  <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>
                    {MOTIVOS[d.motivo]?.icon} {MOTIVOS[d.motivo]?.label}
                  </div>
                </div>
                <div style={{ color: '#3b82f6', fontSize: 12, fontWeight: 600 }}>
                  📤 Pendiente →
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: HISTORIAL
  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: 16 }}>
      <TabBar />

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {Object.entries(ESTADO_COLORS).map(([est, col]) => (
          <div key={est} style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
            <span style={{ color: col }}>{ESTADO_LABELS[est]}: {devoluciones.filter(d => d.estado === est).length}</span>
          </div>
        ))}
      </div>

      {loadingList ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>Cargando...</div>
      ) : devoluciones.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay devoluciones registradas</div>
      ) : (
        devoluciones.map(d => (
          <div key={d.id} className="card" onClick={() => verDetalle(d)}
            style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8, borderLeft: `3px solid ${ESTADO_COLORS[d.estado]}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
                  {STORES[d.store_code] || d.store_code}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {fmtDate(d.fecha)} · {d.creado_por}
                </div>
                <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>
                  {MOTIVOS[d.motivo]?.icon} {MOTIVOS[d.motivo]?.label}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, color: ESTADO_COLORS[d.estado], fontWeight: 600 }}>
                  {ESTADO_LABELS[d.estado]}
                </span>
                {d.recibido_por && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    {d.recibido_por}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {/* Detalle modal si se seleccionó uno */}
      {detalleSel && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
          onClick={() => setDetalleSel(null)}>
          <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 20, maxWidth: 400, width: '100%', maxHeight: '80vh', overflow: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#fff' }}>
              Detalle — {STORES[detalleSel.store_code]}
            </h3>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              {fmtDate(detalleSel.fecha)} · {MOTIVOS[detalleSel.motivo]?.label} · {ESTADO_LABELS[detalleSel.estado]}
            </div>
            {detalleSel.notas_sucursal && <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>📝 Sucursal: {detalleSel.notas_sucursal}</div>}
            {detalleSel.notas_cm && <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 8 }}>📝 CM: {detalleSel.notas_cm}</div>}

            {detalleItems.map(item => (
              <div key={item.id} style={{ background: '#0d1b2a', borderRadius: 6, padding: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, color: '#ddd' }}>{item.catalogo_productos?.nombre}</div>
                <div style={{ fontSize: 12, color: '#f59e0b' }}>{n(item.cantidad)} {item.unidad_medida}</div>
                {item.lote_origen && <div style={{ fontSize: 11, color: '#888' }}>Lote: {item.lote_origen}</div>}
                {item.motivo_detalle && <div style={{ fontSize: 11, color: '#888' }}>{item.motivo_detalle}</div>}
              </div>
            ))}

            <button onClick={() => setDetalleSel(null)}
              style={{ width: '100%', marginTop: 12, padding: '10px', borderRadius: 8, border: 'none',
                background: '#333', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl = { display: 'block', fontSize: 12, color: '#888', marginBottom: 2, marginTop: 8 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
const th = { padding: '6px 4px', fontSize: 11, color: '#666', textAlign: 'left', fontWeight: 600 };
