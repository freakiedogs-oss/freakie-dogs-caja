import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n, STORES } from '../../config';

// ── Roles con acceso de edición ──
const ROLES_EDIT = ['ejecutivo', 'produccion', 'jefe_casa_matriz', 'admin', 'superadmin'];

// ── Generar número de lote ──
const generarLote = (fecha, seq) =>
  `LOT-${fecha.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;

// ── PRODUCCIÓN DIARIA ─────────────────────────────────────────
export default function ProduccionDiaria({ user }) {
  const [tab, setTab] = useState('registrar');

  // Estado Registrar
  const [fecha, setFecha] = useState(today());
  const [recetas, setRecetas] = useState([]);
  const [recetaSelId, setRecetaSelId] = useState(null);
  const [cantidadProducir, setCantidadProducir] = useState('');
  const [turno, setTurno] = useState('mañana');
  const [ingredientes, setIngredientes] = useState({});
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [productorId, setProductorId] = useState('');
  const [empleadosCM, setEmpleadosCM] = useState([]);

  // Estado Historial
  const [producciones, setProducciones] = useState([]);
  const [filtroFecha, setFiltroFecha] = useState('');
  const [filtroReceta, setFiltroReceta] = useState('');
  const [prodSelId, setProdSelId] = useState(null);
  const [prodItems, setProdItems] = useState([]);
  const [prodSelData, setProdSelData] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  // Inventario CM001
  const [inventarioCM, setInventarioCM] = useState({});

  const canEdit = ROLES_EDIT.includes(user?.rol);
  const CM_SUCURSAL_ID = '584aee3c-a842-496f-9f2b-1e3bac6e6b23'; // Casa Matriz

  // ── Cargar datos iniciales ──
  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRes, iRes, cRes, invRes, empRes] = await Promise.all([
        db.from('recetas').select('*').eq('activo', true).order('nombre'),
        db.from('receta_ingredientes').select('*, catalogo_productos(id,nombre,unidad_medida,precio_referencia), sub:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,tipo,costo_calculado)'),
        db.from('catalogo_productos').select('id,nombre,categoria,unidad_medida,precio_referencia').eq('activo', true).order('nombre'),
        db.from('inventario').select('producto_id,stock_actual').eq('sucursal_id', CM_SUCURSAL_ID),
        db.from('usuarios_erp').select('id,nombre,apellido,rol').eq('store_code', 'CM001').eq('activo', true).order('nombre'),
      ]);

      setRecetas(rRes.data || []);
      const grouped = {};
      (iRes.data || []).forEach(i => {
        if (!grouped[i.receta_id]) grouped[i.receta_id] = [];
        grouped[i.receta_id].push(i);
      });
      setIngredientes(grouped);
      setCatalogo(cRes.data || []);

      // Mapa producto_id → stock_actual
      const invMap = {};
      (invRes.data || []).forEach(r => { invMap[r.producto_id] = n(r.stock_actual); });
      setInventarioCM(invMap);
      setEmpleadosCM(empRes.data || []);
    } catch (err) {
      console.error('Error cargando datos:', err);
      setError('Error cargando recetas y productos');
    }
    setLoading(false);
  }, []);

  // ── Cargar historial ──
  const cargarHistorial = useCallback(async () => {
    try {
      let query = db.from('produccion_diaria')
        .select('*, recetas(id,nombre,tipo,rendimiento,unidad_rendimiento,costo_calculado), responsable:usuarios_erp!produccion_diaria_responsable_id_fkey(id,nombre,apellido)')
        .order('created_at', { ascending: false })
        .limit(50);

      if (filtroFecha) query = query.eq('fecha', filtroFecha);
      const res = await query;
      let datos = res.data || [];
      if (filtroReceta) {
        datos = datos.filter(p => p.recetas?.nombre?.toLowerCase().includes(filtroReceta.toLowerCase()));
      }
      setProducciones(datos);
    } catch (err) {
      console.error('Error cargando historial:', err);
    }
  }, [filtroFecha, filtroReceta]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (tab === 'historial') cargarHistorial(); }, [tab, cargarHistorial]);

  // ── Receta seleccionada ──
  const recetaSel = recetas.find(r => r.id === recetaSelId);
  const ingsPorReceta = ingredientes[recetaSelId] || [];

  // ── Calcular ingredientes necesarios ──
  const calcIngredientesNecesarios = () => {
    if (!cantidadProducir || !recetaSel) return [];
    const cant = n(cantidadProducir);
    return ingsPorReceta.map(i => {
      const cantBase = n(i.cantidad) * cant;
      const mermaPct = n(i.merma_pct) || 0;
      const cantConMerma = cantBase * (1 + mermaPct / 100);
      const prodId = i.tipo_ingrediente === 'materia_prima' ? i.producto_id : null;
      const stockDisp = prodId ? (inventarioCM[prodId] || 0) : null;
      return {
        ...i,
        cantidadNecesaria: cantConMerma,
        mermaCalculada: cantConMerma - cantBase,
        stockDisponible: stockDisp,
        faltante: prodId && stockDisp !== null ? Math.max(0, cantConMerma - stockDisp) : 0,
      };
    });
  };
  const ingNecesarios = calcIngredientesNecesarios();
  const hayFaltantes = ingNecesarios.some(i => i.faltante > 0);

  // ── Siguiente número de lote del día ──
  const getNextLote = async (fechaStr) => {
    const { data } = await db.from('produccion_diaria')
      .select('lote')
      .eq('fecha', fechaStr)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0 && data[0].lote) {
      const parts = data[0].lote.split('-');
      const seq = parseInt(parts[2] || '0', 10) + 1;
      return generarLote(fechaStr, seq);
    }
    return generarLote(fechaStr, 1);
  };

  // ── Registrar producción + descontar inventario CM ──
  const registrarProduccion = async () => {
    if (!recetaSel || !cantidadProducir || !fecha) {
      setError('Faltan campos requeridos (fecha, receta, cantidad)');
      return;
    }
    if (n(cantidadProducir) <= 0) {
      setError('La cantidad debe ser mayor a 0');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const lote = await getNextLote(fecha);

      // 1. Insertar produccion_diaria
      const productor = empleadosCM.find(e => e.id === productorId);
      const prodRes = await db.from('produccion_diaria').insert({
        fecha,
        receta_id: recetaSel.id,
        cantidad_producida: n(cantidadProducir),
        cantidad_enviada: 0,
        turno,
        lote,
        responsable_id: productorId || null,
        created_by: `${user?.nombre || ''} ${user?.apellido || ''}`.trim(),
        created_by_id: user?.id || null,
        notas: notas || null,
      }).select();

      const produccionId = prodRes.data?.[0]?.id;
      if (!produccionId) throw new Error('No se creó el registro de producción');

      // 2. Insertar items consumidos
      const items = ingNecesarios.map(i => ({
        produccion_id: produccionId,
        producto_id: i.tipo_ingrediente === 'materia_prima' ? i.producto_id : i.sub_receta_id,
        cantidad_consumida: i.cantidadNecesaria,
        unidad_medida: i.unidad_medida || 'unidad',
        costo_unitario: i.tipo_ingrediente === 'materia_prima' ? n(i.catalogo_productos?.precio_referencia) : 0,
        costo_linea: i.tipo_ingrediente === 'materia_prima' ? n(i.cantidadNecesaria) * n(i.catalogo_productos?.precio_referencia) : 0,
        es_subproducto: i.tipo_ingrediente === 'sub_receta',
      }));
      if (items.length > 0) {
        await db.from('produccion_diaria_items').insert(items);
      }

      // 3. Descontar inventario de materia prima en CM001
      const updatePromises = ingNecesarios
        .filter(i => i.tipo_ingrediente === 'materia_prima' && i.producto_id)
        .map(async (i) => {
          const currentStock = inventarioCM[i.producto_id] || 0;
          const newStock = Math.max(0, currentStock - i.cantidadNecesaria);
          await db.from('inventario')
            .update({ stock_actual: newStock, ultima_actualizacion: new Date().toISOString() })
            .eq('producto_id', i.producto_id)
            .eq('sucursal_id', CM_SUCURSAL_ID);
        });
      await Promise.all(updatePromises);

      setSuccess(`✅ Lote ${lote} registrado — ${n(cantidadProducir)} ${recetaSel.nombre}. Inventario CM descontado.`);
      setCantidadProducir('');
      setRecetaSelId(null);
      setTurno('mañana');
      setNotas('');
      setProductorId('');
      setFecha(today());
      // Recargar inventario
      cargar();
    } catch (err) {
      console.error('Error registrando producción:', err);
      setError(err.message || 'Error al registrar producción');
    }
    setSaving(false);
  };

  // ── Cargar detalle producción (BOM on-the-fly) ──
  const cargarDetalle = async (prod) => {
    setProdSelId(prod.id);
    setProdSelData(prod);
    setProdItems([]);
    setLoadingDetalle(true);
    try {
      const { data: bom, error: bomErr } = await db
        .from('receta_ingredientes')
        .select('*, catalogo_productos(id,nombre,unidad_medida,precio_referencia), sub_receta:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,costo_calculado,rendimiento)')
        .eq('receta_id', prod.receta_id);

      if (bomErr) throw bomErr;

      const tandas = n(prod.cantidad_producida);
      const items = (bom || []).map(ri => {
        const cantConsum = n(ri.cantidad) * tandas;
        const esMP = ri.tipo_ingrediente === 'materia_prima';
        const nombre  = esMP ? ri.catalogo_productos?.nombre : ri.sub_receta?.nombre;
        const unidad  = ri.unidad_medida || (esMP ? ri.catalogo_productos?.unidad_medida : '');
        const precioU = esMP
          ? n(ri.catalogo_productos?.precio_referencia)
          : n(ri.sub_receta?.costo_calculado);
        return { nombre, unidad, tipo: ri.tipo_ingrediente, cantidad_receta: n(ri.cantidad), cantidad_consumida: cantConsum, precio_unitario: precioU, costo_linea: cantConsum * precioU };
      });
      setProdItems(items);
    } catch (err) {
      console.error('Error cargando detalle BOM:', err);
    } finally {
      setLoadingDetalle(false);
    }
  };

  // ── TABS ──
  const TabBar = () => (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#fff' }}>🏭 Producción Diaria</h2>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #333' }}>
        {['registrar', 'historial'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', borderRadius: 0, border: 'none', background: 'none',
              color: tab === t ? '#e63946' : '#666', borderBottom: tab === t ? '2px solid #e63946' : 'none',
              cursor: 'pointer', fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>
            {t === 'registrar' ? '📝 Registrar' : '📋 Historial'}
          </button>
        ))}
      </div>
    </div>
  );

  const Alert = ({ type, msg }) => {
    if (!msg) return null;
    const bg = type === 'error' ? '#8b0000' : '#2d6a4f';
    const icon = type === 'error' ? '⚠️' : '✓';
    return <div style={{ background: bg, color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{icon} {msg}</div>;
  };

  // ── Loading ──
  if (loading && tab === 'registrar') {
    return <div style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>Cargando recetas...</div>;
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: REGISTRAR
  // ══════════════════════════════════════════════════════════════
  if (tab === 'registrar') {
    return (
      <div style={{ padding: '16px' }}>
        <TabBar />
        <Alert type="error" msg={error} />
        <Alert type="success" msg={success} />

        {!canEdit && (
          <div style={{ background: '#1a3a52', color: '#aaa', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            🔒 Solo producción, jefe casa matriz, ejecutivo o admin pueden registrar.
          </div>
        )}

        {canEdit && (
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#fff' }}>Nueva Producción</h3>

            {/* Registrado por */}
            <div style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
              📋 Registra: <strong style={{ color: '#60a5fa' }}>{user?.nombre} {user?.apellido}</strong>
              <span style={{ color: '#666', marginLeft: 8 }}>({user?.rol})</span>
            </div>

            {/* Productor (dropdown empleados CM) */}
            <label style={lbl}>👤 ¿Quién produjo?</label>
            <select value={productorId} onChange={e => setProductorId(e.target.value)} style={inp}>
              <option value="">— Seleccionar empleado —</option>
              {empleadosCM.filter(e => ['produccion', 'jefe_casa_matriz'].includes(e.rol)).map(e => (
                <option key={e.id} value={e.id}>
                  {e.nombre} {e.apellido} ({e.rol === 'jefe_casa_matriz' ? 'Jefe CM' : 'Producción'})
                </option>
              ))}
            </select>

            {/* Fecha */}
            <label style={lbl}>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} />

            {/* Receta */}
            <label style={lbl}>Receta a Producir</label>
            <select value={recetaSelId || ''} onChange={e => setRecetaSelId(e.target.value)} style={inp}>
              <option value="">— Seleccionar receta —</option>
              {recetas.filter(r => r.tipo === 'sub_receta' || r.tipo === 'porcionado').map(r => (
                <option key={r.id} value={r.id}>
                  {r.nombre} ({r.tipo === 'sub_receta' ? 'Sub-receta' : 'Porcionado'})
                  {r.rendimiento ? ` · Rinde ${r.rendimiento}` : ''}
                </option>
              ))}
            </select>

            {/* BOM de receta seleccionada */}
            {recetaSel && (
              <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginTop: 12, marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#4ade80' }}>
                  📦 BOM — {recetaSel.nombre}
                  {recetaSel.rendimiento && <span style={{ color: '#888', fontWeight: 400 }}> · Rinde {recetaSel.rendimiento}</span>}
                </h4>
                {ingsPorReceta.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#666' }}>Sin ingredientes definidos</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #333' }}>
                        <th style={th}>Ingrediente</th>
                        <th style={{ ...th, textAlign: 'right' }}>Cant/tanda</th>
                        <th style={{ ...th, textAlign: 'right' }}>Merma%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingsPorReceta.map(i => {
                        const nombre = i.tipo_ingrediente === 'materia_prima' ? i.catalogo_productos?.nombre : i.sub?.nombre;
                        return (
                          <tr key={i.id} style={{ borderBottom: '1px solid #222' }}>
                            <td style={{ padding: '6px 4px', fontSize: 12, color: '#ddd' }}>{nombre || '?'}</td>
                            <td style={{ padding: '6px 4px', fontSize: 12, color: '#aaa', textAlign: 'right' }}>
                              {n(i.cantidad)} {i.unidad_medida}
                            </td>
                            <td style={{ padding: '6px 4px', fontSize: 12, color: '#f59e0b', textAlign: 'right' }}>
                              {n(i.merma_pct)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Cantidad */}
            <label style={lbl}>Cantidad a Producir (tandas)</label>
            <input type="number" step="0.01" min="0" value={cantidadProducir}
              onChange={e => setCantidadProducir(e.target.value)}
              placeholder="Ej: 2" style={inp} />

            {/* Cálculo de necesidad vs stock */}
            {cantidadProducir && recetaSel && ingNecesarios.length > 0 && (
              <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginTop: 12, marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#f59e0b' }}>
                  📊 Necesidad × {cantidadProducir} tanda(s) — Stock CM
                </h4>
                {hayFaltantes && (
                  <div style={{ background: '#8b000044', padding: 8, borderRadius: 6, marginBottom: 8, fontSize: 12, color: '#ff6b6b' }}>
                    ⚠️ Algunos ingredientes tienen stock insuficiente en Casa Matriz
                  </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #333' }}>
                      <th style={th}>Ingrediente</th>
                      <th style={{ ...th, textAlign: 'right' }}>Necesita</th>
                      <th style={{ ...th, textAlign: 'right' }}>Stock CM</th>
                      <th style={{ ...th, textAlign: 'right' }}>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingNecesarios.map(i => {
                      const nombre = i.tipo_ingrediente === 'materia_prima' ? i.catalogo_productos?.nombre : i.sub?.nombre;
                      const ok = i.stockDisponible === null || i.faltante === 0;
                      return (
                        <tr key={i.id} style={{ borderBottom: '1px solid #222' }}>
                          <td style={{ padding: '6px 4px', fontSize: 12, color: '#ddd' }}>{nombre || '?'}</td>
                          <td style={{ padding: '6px 4px', fontSize: 12, color: '#aaa', textAlign: 'right' }}>
                            {i.cantidadNecesaria.toFixed(2)} {i.unidad_medida}
                          </td>
                          <td style={{ padding: '6px 4px', fontSize: 12, textAlign: 'right',
                            color: i.stockDisponible === null ? '#555' : ok ? '#4ade80' : '#ff6b6b' }}>
                            {i.stockDisponible !== null ? i.stockDisponible.toFixed(2) : '—'}
                          </td>
                          <td style={{ padding: '6px 4px', fontSize: 12, textAlign: 'right' }}>
                            {i.stockDisponible === null ? (
                              <span style={{ color: '#555' }}>sub-receta</span>
                            ) : ok ? (
                              <span style={{ color: '#4ade80' }}>✓ OK</span>
                            ) : (
                              <span style={{ color: '#ff6b6b' }}>⚠ Faltan {i.faltante.toFixed(2)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Turno */}
            <label style={lbl}>Turno</label>
            <select value={turno} onChange={e => setTurno(e.target.value)} style={inp}>
              <option value="mañana">🌅 Mañana</option>
              <option value="tarde">☀️ Tarde</option>
            </select>

            {/* Notas */}
            <label style={lbl}>Notas (opcional)</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Observaciones de la producción..."
              rows={2} style={{ ...inp, resize: 'vertical' }} />

            {/* Botón */}
            <button onClick={registrarProduccion} disabled={saving}
              style={{ width: '100%', marginTop: 16, background: saving ? '#555' : '#e63946', color: '#fff',
                border: 'none', borderRadius: 8, padding: '14px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14 }}>
              {saving ? '⏳ Registrando...' : '📤 Registrar Producción + Descontar Inventario'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: HISTORIAL
  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: '16px' }}>
      <TabBar />
      <Alert type="error" msg={error} />

      {/* Filtros */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={lbl}>Fecha</label>
            <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={lbl}>Receta</label>
            <input type="text" value={filtroReceta} onChange={e => setFiltroReceta(e.target.value)}
              placeholder="Buscar..." style={inp} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={() => { setFiltroFecha(''); setFiltroReceta(''); }}
              style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#333', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
              Ver todo
            </button>
          </div>
        </div>
      </div>

      {/* Detalle */}
      {prodSelId ? (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <button onClick={() => setProdSelId(null)}
            style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
            ← Volver
          </button>
          {/* Header del detalle */}
          {prodSelData && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
                {prodSelData.recetas?.nombre}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                {fmtDate(prodSelData.fecha)} · {prodSelData.turno} · {prodSelData.lote || ''}
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                {prodSelData.responsable
                  ? <>👤 Produjo: <strong style={{ color: '#4ade80' }}>{prodSelData.responsable.nombre} {prodSelData.responsable.apellido}</strong></>
                  : null}
                {prodSelData.created_by && <span style={{ color: '#666', marginLeft: 8 }}>📋 Registró: {prodSelData.created_by}</span>}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ background: '#1a3a52', color: '#60a5fa', padding: '3px 10px', borderRadius: 6, fontSize: 12 }}>
                  🏭 {n(prodSelData.cantidad_producida)} tandas producidas
                </span>
                <span style={{ background: '#1a2e1a', color: '#4ade80', padding: '3px 10px', borderRadius: 6, fontSize: 12 }}>
                  📦 {(n(prodSelData.cantidad_producida) * n(prodSelData.recetas?.rendimiento)).toFixed(1)} {prodSelData.recetas?.unidad_rendimiento || 'unidades'}
                </span>
              </div>
            </div>
          )}
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: '#aaa', fontWeight: 600 }}>💰 Costo de Ingredientes</h3>
          {loadingDetalle ? (
            <div style={{ color: '#666', fontSize: 13, padding: '10px 0' }}>Calculando costos...</div>
          ) : prodItems.length === 0 ? (
            <div style={{ color: '#555', fontSize: 13 }}>Esta receta no tiene ingredientes cargados aún.</div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    <th style={th}>Ingrediente</th>
                    <th style={{ ...th, textAlign: 'right' }}>Cant./tanda</th>
                    <th style={{ ...th, textAlign: 'right' }}>Total usado</th>
                    <th style={{ ...th, textAlign: 'right' }}>Precio u.</th>
                    <th style={{ ...th, textAlign: 'right' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {prodItems.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #1e1e1e' }}>
                      <td style={{ padding: '7px 4px', fontSize: 12, color: item.tipo === 'sub_receta' ? '#60a5fa' : '#ddd' }}>
                        {item.tipo === 'sub_receta' ? '🔗 ' : ''}{item.nombre || '—'}
                      </td>
                      <td style={{ padding: '7px 4px', fontSize: 11, color: '#666', textAlign: 'right' }}>
                        {n(item.cantidad_receta).toFixed(2)} {item.unidad}
                      </td>
                      <td style={{ padding: '7px 4px', fontSize: 12, color: '#aaa', textAlign: 'right' }}>
                        {n(item.cantidad_consumida).toFixed(2)} {item.unidad}
                      </td>
                      <td style={{ padding: '7px 4px', fontSize: 12, color: '#e9c46a', textAlign: 'right' }}>
                        ${n(item.precio_unitario).toFixed(2)}
                      </td>
                      <td style={{ padding: '7px 4px', fontSize: 12, color: n(item.costo_linea) > 0 ? '#4ade80' : '#555', textAlign: 'right', fontWeight: 600 }}>
                        ${n(item.costo_linea).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Totales */}
              {(() => {
                const totalCosto = prodItems.reduce((s, i) => s + n(i.costo_linea), 0);
                const totalUnidades = n(prodSelData?.cantidad_producida) * n(prodSelData?.recetas?.rendimiento);
                const costoPorUnidad = totalUnidades > 0 ? totalCosto / totalUnidades : 0;
                return (
                  <div style={{ marginTop: 12, borderTop: '2px solid #333', paddingTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: '#aaa' }}>Costo total de producción:</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#4ade80' }}>${totalCosto.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: '#666' }}>Costo por unidad ({prodSelData?.recetas?.unidad_rendimiento || 'u.'}):</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#e9c46a' }}>${costoPorUnidad.toFixed(4)}</span>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#aaa' }}>
              📊 Registros: <span style={{ color: '#fff', fontWeight: 600 }}>{producciones.length}</span>
            </div>
            <div style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#aaa' }}>
              📦 Total producido: <span style={{ color: '#4ade80', fontWeight: 600 }}>
                {producciones.reduce((s, p) => s + n(p.cantidad_producida), 0).toFixed(1)}
              </span>
            </div>
          </div>

          {/* Lista */}
          {producciones.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay registros</div>
          ) : (
            producciones.map(p => (
              <div key={p.id} className="card" onClick={() => cargarDetalle(p)}
                style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
                      {p.recetas?.nombre || 'Receta desconocida'}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {fmtDate(p.fecha)} · {p.turno}
                      {p.responsable ? ` · 👤 ${p.responsable.nombre} ${p.responsable.apellido}` : (p.created_by ? ` · ${p.created_by}` : '')}
                    </div>
                    {p.lote && (
                      <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2 }}>
                        🏷️ {p.lote}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: '#4ade80', fontWeight: 600 }}>
                      {n(p.cantidad_producida).toFixed(1)} tandas
                    </div>
                    {p.notas && (
                      <div style={{ fontSize: 11, color: '#888', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        📝 {p.notas}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

// ── Styles ──
const lbl = { display: 'block', fontSize: 12, color: '#888', marginBottom: 2, marginTop: 8 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
const th = { padding: '6px 4px', fontSize: 11, color: '#666', textAlign: 'left', fontWeight: 600 };
