import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n } from '../../config';

// ── Usuarios con acceso de edición ──
const EDIT_PINS = ['1000', '2000']; // Jose Isart, Cesar Rodriguez

// ── PRODUCCIÓN DIARIA ─────────────────────────────────────────
export default function ProduccionDiaria({ user }) {
  const [tab, setTab] = useState('registrar'); // 'registrar' | 'historial'

  // Estado para Registrar Producción
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

  // Estado para Historial
  const [producciones, setProducciones] = useState([]);
  const [filtroFecha, setFiltroFecha] = useState(today());
  const [filtroReceta, setFiltroReceta] = useState('');
  const [prodSelId, setProdSelId] = useState(null);
  const [prodItems, setProdItems] = useState([]);

  const canEdit = EDIT_PINS.includes(user?.pin);

  // ── Cargar datos iniciales ──
  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRes, iRes, cRes] = await Promise.all([
        db.from('recetas').select('*').eq('activo', true).order('nombre'),
        db.from('receta_ingredientes').select('*, catalogo_productos(id,nombre,unidad_medida,precio_referencia), sub:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,tipo,costo_calculado)'),
        db.from('catalogo_productos').select('id,nombre,categoria,unidad_medida,precio_referencia').eq('activo', true).order('nombre'),
      ]);

      setRecetas(rRes.data || []);

      // Agrupar ingredientes por receta_id
      const grouped = {};
      (iRes.data || []).forEach(i => {
        if (!grouped[i.receta_id]) grouped[i.receta_id] = [];
        grouped[i.receta_id].push(i);
      });
      setIngredientes(grouped);
      setCatalogo(cRes.data || []);
    } catch (err) {
      console.error('Error cargando datos:', err);
      setError('Error cargando recetas y productos');
    }
    setLoading(false);
  }, []);

  // ── Cargar historial de producción ──
  const cargarHistorial = useCallback(async () => {
    try {
      let query = db.from('produccion_diaria').select('*, recetas(id,nombre,tipo)').order('created_at', { ascending: false }).limit(30);

      if (filtroFecha) {
        const dateStr = typeof filtroFecha === 'string' ? filtroFecha : filtroFecha.split('T')[0];
        query = query.eq('fecha', dateStr);
      }

      const res = await query;
      let datos = res.data || [];

      if (filtroReceta) {
        datos = datos.filter(p => p.recetas?.nombre.toLowerCase().includes(filtroReceta.toLowerCase()));
      }

      setProducciones(datos);
    } catch (err) {
      console.error('Error cargando historial:', err);
      setError('Error cargando historial de producción');
    }
  }, [filtroFecha, filtroReceta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (tab === 'historial') {
      cargarHistorial();
    }
  }, [tab, cargarHistorial]);

  // ── Obtener receta seleccionada ──
  const recetaSel = recetas.find(r => r.id === recetaSelId);
  const ingsPorReceta = ingredientes[recetaSelId] || [];

  // ── Calcular costo de una receta ──
  const calcCosto = (recetaId) => {
    const ings = ingredientes[recetaId] || [];
    let total = 0;
    ings.forEach(i => {
      if (i.tipo_ingrediente === 'materia_prima' && i.catalogo_productos) {
        total += n(i.cantidad) * n(i.catalogo_productos.precio_referencia);
      } else if (i.tipo_ingrediente === 'sub_receta' && i.sub) {
        total += n(i.cantidad) * calcCosto(i.sub.id);
      }
    });
    return total;
  };

  // ── Calcular ingredientes necesarios con merma ──
  const calcIngredientesNecesarios = () => {
    if (!cantidadProducir || !recetaSel) return [];

    const cant = n(cantidadProducir);
    return ingsPorReceta.map(i => {
      const cantBase = n(i.cantidad) * cant;
      const mermaPct = n(i.merma_pct) || 0;
      const cantConMerma = cantBase * (1 + mermaPct / 100);
      return {
        ...i,
        cantidadNecesaria: cantConMerma,
        mermaCalculada: cantConMerma - cantBase,
      };
    });
  };

  const ingNecesarios = calcIngredientesNecesarios();

  // ── Registrar producción ──
  const registrarProduccion = async () => {
    if (!recetaSel || !cantidadProducir || !fecha) {
      setError('Faltan campos requeridos (fecha, receta, cantidad)');
      return;
    }

    if (n(cantidadProducir) <= 0) {
      setError('La cantidad a producir debe ser mayor a 0');
      return;
    }

    try {
      setError(null);
      setSuccess(null);

      // Insertar produccion_diaria
      const prodRes = await db.from('produccion_diaria').insert({
        fecha,
        receta_id: recetaSel.id,
        cantidad_producida: n(cantidadProducir),
        cantidad_enviada: 0,
        turno,
        created_by: user?.nombre || 'Usuario',
      }).select();

      const produccionId = prodRes.data?.[0]?.id;
      if (!produccionId) throw new Error('No se creó el registro de producción');

      // Insertar items consumidos
      const items = ingNecesarios.map(i => ({
        produccion_id: produccionId,
        producto_id: i.tipo_ingrediente === 'materia_prima' ? i.producto_id : null,
        cantidad_consumida: i.cantidadNecesaria,
        costo_unitario: i.tipo_ingrediente === 'materia_prima' ? n(i.catalogo_productos?.precio_referencia) : 0,
        es_subproducto: i.tipo_ingrediente === 'sub_receta',
      }));

      if (items.length > 0) {
        await db.from('produccion_diaria_items').insert(items);
      }

      setSuccess(`Producción registrada correctamente (ID: ${produccionId})`);

      // Limpiar formulario
      setCantidadProducir('');
      setRecetaSelId(null);
      setTurno('mañana');
      setFecha(today());

      // Recargar historial si estamos en esa tab
      setTimeout(() => cargarHistorial(), 500);
    } catch (err) {
      console.error('Error registrando producción:', err);
      setError(err.message || 'Error al registrar producción');
    }
  };

  // ── Cargar detalle de una producción ──
  const cargarDetalleProduccion = async (prodId) => {
    try {
      const res = await db.from('produccion_diaria_items').select('*').eq('produccion_id', prodId);
      setProdItems(res.data || []);
      setProdSelId(prodId);
    } catch (err) {
      console.error('Error cargando detalle:', err);
      setError('Error cargando detalle de producción');
    }
  };

  // ── Render: Loading ──
  if (loading && tab === 'registrar') {
    return <div style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>Cargando recetas...</div>;
  }

  // ── Render: TAB 1 - REGISTRAR PRODUCCIÓN ──
  if (tab === 'registrar') {
    return (
      <div style={{ padding: '16px' }}>
        {/* Header + Tabs */}
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#fff' }}>📦 Producción Diaria</h2>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #333' }}>
            <button onClick={() => setTab('registrar')}
              style={{ padding: '8px 16px', borderRadius: 0, border: 'none', background: 'none', color: tab === 'registrar' ? '#e63946' : '#666', borderBottom: tab === 'registrar' ? '2px solid #e63946' : 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              Registrar
            </button>
            <button onClick={() => setTab('historial')}
              style={{ padding: '8px 16px', borderRadius: 0, border: 'none', background: 'none', color: tab === 'historial' ? '#e63946' : '#666', borderBottom: tab === 'historial' ? '2px solid #e63946' : 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              Historial
            </button>
          </div>
        </div>

        {/* Alertas */}
        {error && <div style={{ background: '#8b0000', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {error}</div>}
        {success && <div style={{ background: '#2d6a4f', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>✓ {success}</div>}

        {/* Si no tiene permisos */}
        {!canEdit && (
          <div style={{ background: '#1a3a52', color: '#aaa', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            Solo usuarios con rol ejecutivo pueden registrar producción.
          </div>
        )}

        {canEdit && (
          <>
            {/* Formulario */}
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#fff' }}>Nuevos Registros</h3>

              {/* Fecha */}
              <label style={lbl}>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} />

              {/* Receta */}
              <label style={lbl}>Receta a Producir</label>
              <select value={recetaSelId || ''} onChange={e => setRecetaSelId(e.target.value)}
                style={inp}>
                <option value="">— Seleccionar receta —</option>
                {recetas.map(r => (
                  <option key={r.id} value={r.id}>{r.nombre} ({r.tipo})</option>
                ))}
              </select>

              {/* Mostrar BOM si hay receta seleccionada */}
              {recetaSel && (
                <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginTop: 12, marginBottom: 12 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#4ade80' }}>Ingredientes de {recetaSel.nombre}</h4>
                  {ingsPorReceta.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#666' }}>Sin ingredientes definidos</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #333' }}>
                          <th style={th}>Ingrediente</th>
                          <th style={{ ...th, textAlign: 'right' }}>Cantidad Base</th>
                          <th style={{ ...th, textAlign: 'right' }}>Merma %</th>
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

              {/* Cantidad a producir */}
              <label style={lbl}>Cantidad a Producir</label>
              <input type="number" step="0.01" value={cantidadProducir} onChange={e => setCantidadProducir(e.target.value)}
                placeholder="Ej: 10" style={inp} />

              {/* Mostrar cálculo si hay cantidad */}
              {cantidadProducir && recetaSel && (
                <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginTop: 12, marginBottom: 12 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#f59e0b' }}>Ingredientes Necesarios (x {cantidadProducir})</h4>
                  {ingNecesarios.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#666' }}>Sin ingredientes</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #333' }}>
                          <th style={th}>Ingrediente</th>
                          <th style={{ ...th, textAlign: 'right' }}>Cantidad</th>
                          <th style={{ ...th, textAlign: 'right' }}>Merma</th>
                          <th style={{ ...th, textAlign: 'right' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ingNecesarios.map(i => {
                          const nombre = i.tipo_ingrediente === 'materia_prima' ? i.catalogo_productos?.nombre : i.sub?.nombre;
                          return (
                            <tr key={i.id} style={{ borderBottom: '1px solid #222' }}>
                              <td style={{ padding: '6px 4px', fontSize: 12, color: '#ddd' }}>{nombre || '?'}</td>
                              <td style={{ padding: '6px 4px', fontSize: 12, color: '#aaa', textAlign: 'right' }}>
                                {i.cantidadNecesaria.toFixed(2)} {i.unidad_medida}
                              </td>
                              <td style={{ padding: '6px 4px', fontSize: 12, color: '#f59e0b', textAlign: 'right' }}>
                                {i.mermaCalculada.toFixed(2)}
                              </td>
                              <td style={{ padding: '6px 4px', fontSize: 12, color: '#4ade80', textAlign: 'right', fontWeight: 600 }}>
                                {i.cantidadNecesaria.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Turno */}
              <label style={lbl}>Turno</label>
              <select value={turno} onChange={e => setTurno(e.target.value)} style={inp}>
                <option value="mañana">🌅 Mañana</option>
                <option value="tarde">☀️ Tarde</option>
              </select>

              {/* Botón registrar */}
              <button onClick={registrarProduccion}
                style={{ width: '100%', marginTop: 16, background: '#e63946', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                📤 Registrar Producción
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Render: TAB 2 - HISTORIAL ──
  return (
    <div style={{ padding: '16px' }}>
      {/* Header + Tabs */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#fff' }}>📦 Producción Diaria</h2>
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #333' }}>
          <button onClick={() => setTab('registrar')}
            style={{ padding: '8px 16px', borderRadius: 0, border: 'none', background: 'none', color: tab === 'registrar' ? '#e63946' : '#666', borderBottom: tab === 'registrar' ? '2px solid #e63946' : 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            Registrar
          </button>
          <button onClick={() => setTab('historial')}
            style={{ padding: '8px 16px', borderRadius: 0, border: 'none', background: 'none', color: tab === 'historial' ? '#e63946' : '#666', borderBottom: tab === 'historial' ? '2px solid #e63946' : 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            Historial
          </button>
        </div>
      </div>

      {/* Alertas */}
      {error && <div style={{ background: '#8b0000', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {error}</div>}

      {/* Filtros */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={lbl}>Filtrar por Fecha</label>
            <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={lbl}>Filtrar por Receta</label>
            <input type="text" value={filtroReceta} onChange={e => setFiltroReceta(e.target.value)}
              placeholder="Nombre de receta..." style={inp} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button onClick={() => { setFiltroFecha(today()); setFiltroReceta(''); }}
              style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#333', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
              Limpiar
            </button>
          </div>
        </div>
      </div>

      {/* Vista detalle si hay una producción seleccionada */}
      {prodSelId ? (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <button onClick={() => setProdSelId(null)} style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
            ← Volver a lista
          </button>

          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#fff' }}>Detalle de Producción</h3>

          {prodItems.length === 0 ? (
            <div style={{ color: '#666', fontSize: 13 }}>Sin items registrados</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={th}>Producto</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cantidad Consumida</th>
                  <th style={{ ...th, textAlign: 'right' }}>Costo Unit.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {prodItems.map((item, idx) => {
                  const subtotal = n(item.cantidad_consumida) * n(item.costo_unitario);
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#ddd' }}>
                        {item.es_subproducto ? '↳ ' : ''}{item.producto_id ? 'Producto #' + item.producto_id : 'N/A'}
                      </td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#aaa', textAlign: 'right' }}>
                        {n(item.cantidad_consumida).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#e9c46a', textAlign: 'right' }}>
                        ${n(item.costo_unitario).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: '#4ade80', textAlign: 'right', fontWeight: 600 }}>
                        ${subtotal.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: '2px solid #444' }}>
                  <td colSpan="3" style={{ padding: '8px 4px', fontWeight: 700, color: '#fff', fontSize: 13, textAlign: 'right' }}>Total:</td>
                  <td style={{ padding: '8px 4px', fontWeight: 700, color: '#4ade80', fontSize: 14, textAlign: 'right' }}>
                    ${prodItems.reduce((sum, item) => sum + (n(item.cantidad_consumida) * n(item.costo_unitario)), 0).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <>
          {/* Resumen rápido */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#aaa' }}>
              📊 Total registros: <span style={{ color: '#fff', fontWeight: 600 }}>{producciones.length}</span>
            </div>
          </div>

          {/* Lista */}
          {producciones.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay registros de producción</div>
          ) : (
            producciones.map(p => (
              <div key={p.id} className="card" onClick={() => cargarDetalleProduccion(p.id)}
                style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
                      {p.recetas?.nombre || 'Receta desconocida'}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {fmtDate(p.fecha)} · {p.turno} · ID: {p.id}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: '#4ade80', fontWeight: 600 }}>
                      {n(p.cantidad_producida).toFixed(2)} unidades
                    </div>
                    {p.cantidad_enviada > 0 && (
                      <div style={{ fontSize: 12, color: '#f59e0b' }}>Enviadas: {n(p.cantidad_enviada).toFixed(2)}</div>
                    )}
                    {p.merma > 0 && (
                      <div style={{ fontSize: 11, color: '#e63946' }}>Merma: {n(p.merma).toFixed(2)}</div>
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
