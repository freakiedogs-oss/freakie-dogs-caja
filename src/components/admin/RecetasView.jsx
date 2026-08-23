import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { n } from '../../config';
import { UnidadSelect } from '../UnidadSelect';

// ── Usuarios con acceso de edición ──
const EDIT_EMAILS = ['joseisart2008@gmail.com'];
// Quién puede editar recetas. Va por rol, no por una lista de PINs en el código.
const ROLES_EDITAN = ['ejecutivo', 'jefe_casa_matriz', 'superadmin'];

// ── RECETAS / BOM ──────────────────────────────────────────
export default function RecetasView({ user }) {
  const [recetas, setRecetas] = useState([]);
  const [ingredientes, setIngredientes] = useState({});
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [buscar, setBuscar] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editIngredients, setEditIngredients] = useState([]);
  const [editReceta, setEditReceta] = useState(null);
  const [showNewReceta, setShowNewReceta] = useState(false);
  const [editRend, setEditRend] = useState(null); // { valor, unidad } for inline rendimiento edit
  // Costos REALES desde el motor Postgres (promedio ponderado de compras DTE),
  // el mismo que usan Costeo y Menú/BOM. Ya NO se usa precio_referencia manual.
  const [costoReceta, setCostoReceta] = useState({}); // { receta_id: costo_total }
  const [costoProd, setCostoProd] = useState({});     // { producto_id: costo_x_unidad }

  const canEdit = ROLES_EDITAN.includes(user?.rol);

  // ── Cargar datos ──
  const cargar = useCallback(async () => {
    setLoading(true);
    const [rRes, iRes, cRes, crRes, cpRes] = await Promise.all([
      // Solo bloques de CM: sub-recetas + porcionados. Los platos/combos del
      // menú se componen en Menú (BOM), no se listan acá (evita redundancia).
      db.from('recetas').select('id,nombre,tipo,categoria,rendimiento,unidad_rendimiento,precio_venta,notas,activo,costo_calculado').eq('activo', true).in('tipo', ['sub_receta', 'porcionado']).order('tipo').order('nombre'),
      db.from('receta_ingredientes').select('*, catalogo_productos(id,nombre,unidad_medida), sub:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,tipo,rendimiento)'),
      // Selector de Materia Prima = mismas MP que el tab Inventario (materia_prima o sin tipo).
      // No trae porcionados/sub-productos/empaque clasificado — esos se eligen como Sub-receta.
      db.from('catalogo_productos').select('id,nombre,categoria,unidad_medida').eq('activo', true).or('tipo.eq.materia_prima,tipo.is.null').order('nombre'),
      // Costos reales del motor (1 llamada cada uno; wrappers costos_recetas_bloques / costos_productos_recetas).
      db.rpc('costos_recetas_bloques'),
      db.rpc('costos_productos_recetas'),
    ]);
    setRecetas(rRes.data || []);
    const crMap = {}; (crRes.data || []).forEach(x => { crMap[x.receta_id] = n(x.costo_total); });
    setCostoReceta(crMap);
    const cpMap = {}; (cpRes.data || []).forEach(x => { cpMap[x.producto_id] = n(x.costo); });
    setCostoProd(cpMap);
    // Group ingredients by receta_id
    const grouped = {};
    (iRes.data || []).forEach(i => {
      if (!grouped[i.receta_id]) grouped[i.receta_id] = [];
      grouped[i.receta_id].push(i);
    });
    setIngredientes(grouped);
    setCatalogo(cRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Filtrar recetas ──
  const filtradas = recetas.filter(r => {
    if (filtro !== 'todos' && r.tipo !== filtro) return false;
    if (buscar && !r.nombre.toLowerCase().includes(buscar.toLowerCase())) return false;
    return true;
  });

  // ── Tipo badges ──
  const tipoBadge = (tipo) => {
    const colors = {
      plato_menu: { bg: '#e63946', label: 'Menú' },
      combo: { bg: '#457b9d', label: 'Combo' },
      sub_receta: { bg: '#2d6a4f', label: 'Sub-receta' },
      porcionado: { bg: '#e9c46a', label: 'Porcionado', color: '#000' },
    };
    const c = colors[tipo] || { bg: '#666', label: tipo };
    return (
      <span style={{ background: c.bg, color: c.color || '#fff', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
        {c.label}
      </span>
    );
  };

  // ── Costo REAL de una receta (motor Postgres, promedio ponderado de compras DTE) ──
  const calcCosto = (recetaId) => n(costoReceta[recetaId]);

  // ── Guardar ingredientes editados ──
  const guardarIngredientes = async () => {
    if (!sel) return;
    // Delete existing
    await db.from('receta_ingredientes').delete().eq('receta_id', sel.id);
    // Insert new
    const rows = editIngredients.filter(i => (i.producto_id || i.sub_receta_id) && n(i.cantidad) > 0).map(i => ({
      receta_id: sel.id,
      // En DB solo hay 2 tipos; 'porcionado' es UI y se guarda como sub_receta.
      tipo_ingrediente: i.tipo_ingrediente === 'materia_prima' ? 'materia_prima' : 'sub_receta',
      producto_id: i.tipo_ingrediente === 'materia_prima' ? i.producto_id : null,
      sub_receta_id: i.tipo_ingrediente !== 'materia_prima' ? i.sub_receta_id : null,
      cantidad: n(i.cantidad),
      unidad_medida: i.unidad_medida || 'unidad',
      merma_pct: n(i.merma_pct),
      notas: i.notas || '',
      // El guardado es delete + insert: TODO campo que no viaje acá se pierde.
      // factor_a_stock es el puente oz→bolsa que usan los 4 motores (costeo,
      // deducción ×2 y producción): si se cae a NULL, el POS vuelve a descontar
      // 32× de más. removible/etiqueta alimentan el botón SIN del POS.
      factor_a_stock: i.factor_a_stock ?? null,
      removible: i.removible ?? false,
      etiqueta: i.etiqueta || null,
      cantidad_catalogo: i.cantidad_catalogo ?? null,
    }));
    if (rows.length > 0) await db.from('receta_ingredientes').insert(rows);
    // Cachear costo_calculado desde el motor real (incluye sub-recetas + merma + costo DTE).
    // Se corre DESPUÉS del insert para que la función vea los ingredientes nuevos.
    const { data: ct } = await db.rpc('receta_costo_total', { p_receta_id: sel.id, p_depth: 0 });
    await db.from('recetas').update({ costo_calculado: n(ct) }).eq('id', sel.id);
    setEditMode(false);
    await cargar();
  };

  // ── Guardar receta nueva/editada ──
  const guardarReceta = async () => {
    if (!editReceta?.nombre) return;
    if (editReceta.id) {
      const cambios = {
        nombre: editReceta.nombre, tipo: editReceta.tipo, categoria: editReceta.categoria,
        rendimiento: n(editReceta.rendimiento) || 1, unidad_rendimiento: editReceta.unidad_rendimiento || 'porcion',
        precio_venta: editReceta.precio_venta ? n(editReceta.precio_venta) : null,
        notas: editReceta.notas || '',
      };
      await db.from('recetas').update(cambios).eq('id', editReceta.id);
      // Refrescar la receta abierta con los mismos valores normalizados que se
      // guardaron, para que el subtítulo "Rinde X" no quede viejo (cargar() solo
      // recarga la lista, no `sel`).
      setSel(s => (s?.id === editReceta.id ? { ...s, ...cambios } : s));
    } else {
      await db.from('recetas').insert({
        nombre: editReceta.nombre, tipo: editReceta.tipo || 'sub_receta',
        categoria: editReceta.categoria || '', rendimiento: n(editReceta.rendimiento) || 1,
        unidad_rendimiento: editReceta.unidad_rendimiento || 'porcion',
        precio_venta: editReceta.precio_venta ? n(editReceta.precio_venta) : null,
        notas: editReceta.notas || '', created_by: user.nombre,
      });
    }
    setShowNewReceta(false);
    setEditReceta(null);
    await cargar();
  };

  // ── Guardar rendimiento inline ──
  const guardarRendimiento = async () => {
    if (!sel || !editRend) return;
    const rend = n(editRend.valor) || 1;
    const unid = editRend.unidad || 'porcion';
    await db.from('recetas').update({ rendimiento: rend, unidad_rendimiento: unid }).eq('id', sel.id);
    setSel({ ...sel, rendimiento: rend, unidad_rendimiento: unid });
    setEditRend(null);
    await cargar();
  };

  // ── Iniciar edición de ingredientes ──
  const startEditIngredients = () => {
    const current = (ingredientes[sel.id] || []).map(i => ({
      // UI: distingue porcionado de sub-receta según el tipo de la receta enlazada
      tipo_ingrediente: i.tipo_ingrediente === 'materia_prima' ? 'materia_prima'
        : (i.sub?.tipo === 'porcionado' ? 'porcionado' : 'sub_receta'),
      producto_id: i.producto_id,
      sub_receta_id: i.sub_receta_id,
      cantidad: i.cantidad,
      unidad_medida: i.unidad_medida,
      merma_pct: i.merma_pct || 0,
      notas: i.notas || '',
      _nombre: i.tipo_ingrediente === 'materia_prima' ? i.catalogo_productos?.nombre : i.sub?.nombre,
    }));
    setEditIngredients(current.length ? current : [emptyRow()]);
    setEditMode(true);
  };

  const emptyRow = () => ({ tipo_ingrediente: 'materia_prima', producto_id: null, sub_receta_id: null, cantidad: 0, unidad_medida: 'unidad', merma_pct: 0, notas: '' });

  // Crear un ingrediente (MP) al vuelo mientras se edita la receta → puebla Inventario
  const crearIngredienteInline = async (idx) => {
    const nombre = window.prompt('Nombre del nuevo ingrediente (Materia Prima):');
    if (!nombre || !nombre.trim()) return;
    const { data } = await db.rpc('crear_ingrediente', { p_nombre: nombre.trim(), p_unidad: 'unidad', p_tipo: 'materia_prima' });
    if (!data?.ok) { alert('No se pudo crear el ingrediente'); return; }
    const nuevo = { id: data.id, nombre: data.nombre, unidad_medida: data.unidad || 'unidad', codigo: data.codigo };
    setCatalogo(cur => cur.some(c => c.id === nuevo.id) ? cur : [...cur, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setEditIngredients(cur => cur.map((r, i) => i === idx ? { ...r, producto_id: nuevo.id, unidad_medida: nuevo.unidad_medida, _nombre: nuevo.nombre } : r));
    if (data.reusado) alert(`Ya existía "${nuevo.nombre}" — se usó ese.`);
  };

  // ── Render ──
  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>Cargando recetas...</div>;

  // ── Detalle: variables usadas si sel existe ──
  const eliminar = async () => {
    if (!sel) return;
    if (!window.confirm(`¿Eliminar la receta "${sel.nombre}"? Se quita de la lista.`)) return;
    const { error } = await db.rpc('eliminar_receta', { p_receta_id: sel.id });
    if (error) { window.alert('❌ ' + error.message); return; }
    setSel(null); setEditMode(false); cargar();
  };

  const ings = sel ? (ingredientes[sel.id] || []) : [];
  const costo = sel ? calcCosto(sel.id) : 0;

  // ── Modal receta (compartido entre lista y detalle) ──
  const recetaModal = showNewReceta && (
    <div className="modal-bg" onClick={() => setShowNewReceta(false)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 12px', color: '#fff' }}>{editReceta?.id ? 'Editar' : 'Nueva'} Receta</h3>
        <label style={lbl}>Nombre</label>
        <input style={inp} value={editReceta?.nombre || ''} onChange={e => setEditReceta({ ...editReceta, nombre: e.target.value })} />
        <label style={lbl}>Tipo</label>
        <select style={inp} value={editReceta?.tipo || 'sub_receta'} onChange={e => setEditReceta({ ...editReceta, tipo: e.target.value })}>
          <option value="sub_receta">Sub-receta</option>
          <option value="porcionado">Porcionado</option>
        </select>
        <label style={lbl}>Categoría</label>
        <input style={inp} value={editReceta?.categoria || ''} onChange={e => setEditReceta({ ...editReceta, categoria: e.target.value })}
          placeholder="Ej: Salsas, Preparaciones, Combos..." />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Rendimiento</label>
            <input style={inp} type="number" value={editReceta?.rendimiento || 1} onChange={e => setEditReceta({ ...editReceta, rendimiento: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Unidad</label>
            <UnidadSelect selectStyle={inp} value={editReceta?.unidad_rendimiento || 'porcion'} onChange={v => setEditReceta({ ...editReceta, unidad_rendimiento: v })} />
          </div>
        </div>
        <label style={lbl}>Precio Venta ($)</label>
        <input style={inp} type="number" step="0.01" value={editReceta?.precio_venta || ''} onChange={e => setEditReceta({ ...editReceta, precio_venta: e.target.value })} />
        <label style={lbl}>Notas</label>
        <textarea style={{ ...inp, minHeight: 50 }} value={editReceta?.notas || ''} onChange={e => setEditReceta({ ...editReceta, notas: e.target.value })} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={guardarReceta}>Guardar</button>
          <button style={{ flex: 1, ...btnSec }} onClick={() => setShowNewReceta(false)}>Cancelar</button>
        </div>
      </div>
    </div>
  );

  // ── LISTA ──
  if (!sel) return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>🥣 Recetas / Bloques CM</h2>
        {canEdit && (
          <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setEditReceta({ nombre: '', tipo: 'sub_receta', categoria: '', rendimiento: 1, unidad_rendimiento: 'porcion' }); setShowNewReceta(true); }}>
            + Nueva Receta
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
        Solo <b>sub-recetas y porcionados</b> (lo que se prepara en Casa Matriz y se reúsa). Los platos y combos del menú
        se arman en <b>Menú (BOM)</b> usando estos bloques + ingredientes del conteo.
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[['todos', 'Todos'], ['sub_receta', 'Sub-recetas'], ['porcionado', 'Porcionados']].map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)}
            style={{ padding: '4px 12px', borderRadius: 16, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: filtro === k ? '#e63946' : '#333', color: filtro === k ? '#fff' : '#aaa' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Búsqueda */}
      <input type="text" placeholder="Buscar receta..." value={buscar} onChange={e => setBuscar(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #444', background: '#1a1a2e', color: '#fff', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }} />

      {/* Resumen */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['sub_receta', '🥣'], ['porcionado', '📦']].map(([t, icon]) => {
          const cnt = recetas.filter(r => r.tipo === t).length;
          return <div key={t} style={{ background: '#1a1a2e', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#aaa' }}>{icon} {cnt}</div>;
        })}
      </div>

      {/* Lista */}
      {filtradas.map(r => {
        const rIngs = ingredientes[r.id] || [];
        const rCosto = calcCosto(r.id);
        return (
          <div key={r.id} className="card" onClick={() => setSel(r)}
            style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{r.nombre}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {r.categoria} · {rIngs.length} ingredientes
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {tipoBadge(r.tipo)}
                {r.precio_venta > 0 && (
                  <div style={{ fontSize: 12, color: '#4ade80', marginTop: 4 }}>
                    ${n(r.precio_venta).toFixed(2)}
                    {rCosto > 0 && <span style={{ color: '#888', marginLeft: 4 }}>({Math.round((1 - rCosto / n(r.precio_venta)) * 100)}%)</span>}
                  </div>
                )}
                {rCosto > 0
                  ? <div style={{ fontSize: 11, color: '#e9c46a' }}>Costo: ${rCosto.toFixed(2)}</div>
                  : rIngs.length > 0 && <div style={{ fontSize: 11, color: '#f59e0b' }}>⚠️ Sin costo DTE</div>}
              </div>
            </div>
          </div>
        );
      })}

      {filtradas.length === 0 && <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay recetas que mostrar</div>}
      {recetaModal}
    </div>
  );

  // ── DETALLE ──
  return (
    <div style={{ padding: '16px' }}>
      <button onClick={() => { setSel(null); setEditMode(false); }} style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Volver a lista
      </button>

      {/* Header */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>{sel.nombre}</h2>
            <div style={{ marginTop: 4 }}>{tipoBadge(sel.tipo)}</div>
            {canEdit && editRend ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 12, color: '#888' }}>Rinde:</span>
                <input type="number" step="0.1" value={editRend.valor}
                  onChange={e => setEditRend({ ...editRend, valor: e.target.value })}
                  style={{ width: 60, padding: '3px 6px', borderRadius: 4, border: '1px solid #e63946', background: '#16213e', color: '#fff', fontSize: 12 }}
                  autoFocus />
                <UnidadSelect value={editRend.unidad}
                  onChange={v => setEditRend({ ...editRend, unidad: v })}
                  selectStyle={{ width: 90, padding: '3px 6px', borderRadius: 4, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 12 }} />
                <button onClick={guardarRendimiento}
                  style={{ background: '#4ade80', color: '#000', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✓</button>
                <button onClick={() => setEditRend(null)}
                  style={{ background: '#444', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>✕</button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#888', marginTop: 4, cursor: canEdit ? 'pointer' : 'default' }}
                onClick={() => canEdit && setEditRend({ valor: n(sel.rendimiento) || 1, unidad: sel.unidad_rendimiento || 'porcion' })}>
                {sel.categoria} · Rinde {n(sel.rendimiento)} {sel.unidad_rendimiento}
                {canEdit && <span style={{ marginLeft: 4, fontSize: 10, color: '#e63946' }}>✏️</span>}
              </div>
            )}
            {sel.notas && <div style={{ fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' }}>{sel.notas}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            {sel.precio_venta > 0 && <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80' }}>${n(sel.precio_venta).toFixed(2)}</div>}
            {costo > 0 ? (
              <>
                <div style={{ fontSize: 13, color: '#e9c46a' }}>Costo: ${costo.toFixed(2)}</div>
                {sel.precio_venta > 0 && (
                  <div style={{ fontSize: 12, color: '#888' }}>Margen: {Math.round((1 - costo / n(sel.precio_venta)) * 100)}%</div>
                )}
              </>
            ) : ings.length > 0 && (
              <div style={{ fontSize: 12, color: '#f59e0b' }}>⚠️ Sin costo DTE — mapeá la compra</div>
            )}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={() => { setEditReceta({ ...sel }); setShowNewReceta(true); }}>
              ✏️ Editar Receta
            </button>
            <button style={{ fontSize: 12, padding: '6px 12px', background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
              onClick={eliminar}>🗑️ Eliminar</button>
          </div>
        )}
      </div>

      {/* Ingredientes */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: '#fff' }}>Ingredientes ({ings.length})</h3>
          {canEdit && !editMode && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={startEditIngredients}>
              ✏️ Editar
            </button>
          )}
        </div>

        {!editMode ? (
          /* Vista lectura */
          ings.length === 0 ? (
            <div style={{ color: '#666', fontSize: 13 }}>Sin ingredientes definidos.{canEdit && ' Presiona Editar para agregar.'}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={th}>Ingrediente</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cant.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Costo Est.</th>
                </tr>
              </thead>
              <tbody>
                {ings.map(i => {
                  const nombre = i.tipo_ingrediente === 'materia_prima' ? i.catalogo_productos?.nombre : i.sub?.nombre;
                  // Misma fórmula que el motor: cantidad × (1+merma) × costo unitario.
                  // MP → costo_producto; sub-receta → costo_total ÷ su rendimiento.
                  const mermaMul = 1 + n(i.merma_pct) / 100;
                  const costoUnit = i.tipo_ingrediente === 'materia_prima'
                    ? n(costoProd[i.producto_id])
                    : calcCosto(i.sub?.id) / (n(i.sub?.rendimiento) || 1);
                  const costoLine = n(i.cantidad) * mermaMul * costoUnit;
                  return (
                    <tr key={i.id} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: '8px 4px', fontSize: 13, color: '#ddd' }}>
                        <div>{nombre || '?'}</div>
                        {i.notas && <div style={{ fontSize: 11, color: '#666' }}>{i.notas}</div>}
                        {i.tipo_ingrediente === 'sub_receta' && <span style={{ fontSize: 10, color: '#2d6a4f' }}>↳ sub-receta</span>}
                      </td>
                      <td style={{ padding: '8px 4px', fontSize: 13, color: '#aaa', textAlign: 'right' }}>
                        {n(i.cantidad)} {i.unidad_medida}
                      </td>
                      <td style={{ padding: '8px 4px', fontSize: 13, color: '#e9c46a', textAlign: 'right' }}>
                        ${costoLine.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: '2px solid #444' }}>
                  <td style={{ padding: '8px 4px', fontWeight: 700, color: '#fff', fontSize: 13 }}>Total</td>
                  <td></td>
                  <td style={{ padding: '8px 4px', fontWeight: 700, color: '#4ade80', fontSize: 14, textAlign: 'right' }}>${costo.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          )
        ) : (
          /* Vista edición */
          <div>
            {editIngredients.map((ing, idx) => (
              <div key={idx} style={{ background: '#1a1a2e', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <select style={{ ...inp, flex: 1 }} value={ing.tipo_ingrediente}
                    onChange={e => {
                      const arr = [...editIngredients];
                      arr[idx] = { ...arr[idx], tipo_ingrediente: e.target.value, producto_id: null, sub_receta_id: null };
                      setEditIngredients(arr);
                    }}>
                    <option value="materia_prima">Materia Prima</option>
                    <option value="sub_receta">Sub-receta</option>
                    <option value="porcionado">Porcionado</option>
                  </select>
                  <button style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 6, padding: '0 8px', cursor: 'pointer' }}
                    onClick={() => setEditIngredients(editIngredients.filter((_, i) => i !== idx))}>✕</button>
                </div>

                {ing.tipo_ingrediente === 'materia_prima' ? (
                  <select style={{ ...inp, fontSize: 12 }} value={ing.producto_id || ''}
                    onChange={e => {
                      if (e.target.value === '__new__') { crearIngredienteInline(idx); return; }
                      const arr = [...editIngredients];
                      const prod = catalogo.find(c => c.id === e.target.value);
                      arr[idx] = { ...arr[idx], producto_id: e.target.value, unidad_medida: prod?.unidad_medida || 'unidad', _nombre: prod?.nombre };
                      setEditIngredients(arr);
                    }}>
                    <option value="">— Seleccionar producto —</option>
                    <option value="__new__">➕ Crear ingrediente nuevo…</option>
                    {catalogo.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.unidad_medida})</option>)}
                  </select>
                ) : (
                  <select style={{ ...inp, fontSize: 12 }} value={ing.sub_receta_id || ''}
                    onChange={e => {
                      const arr = [...editIngredients];
                      const sr = recetas.find(r => r.id === e.target.value);
                      arr[idx] = { ...arr[idx], sub_receta_id: e.target.value, unidad_medida: sr?.unidad_rendimiento || 'porcion', _nombre: sr?.nombre };
                      setEditIngredients(arr);
                    }}>
                    <option value="">— Seleccionar {ing.tipo_ingrediente === 'porcionado' ? 'porcionado' : 'sub-receta'} —</option>
                    {recetas.filter(r => r.tipo === ing.tipo_ingrediente).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                )}

                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input style={{ ...inp, flex: 1 }} type="number" step="0.001" placeholder="Cantidad"
                    value={ing.cantidad || ''} onChange={e => { const arr = [...editIngredients]; arr[idx] = { ...arr[idx], cantidad: e.target.value }; setEditIngredients(arr); }} />
                  <UnidadSelect selectStyle={{ ...inp, width: 100 }} value={ing.unidad_medida || 'unidad'}
                    onChange={v => { const arr = [...editIngredients]; arr[idx] = { ...arr[idx], unidad_medida: v }; setEditIngredients(arr); }} />
                </div>
                <input style={{ ...inp, marginTop: 4, fontSize: 11 }} placeholder="Notas (opcional)" value={ing.notas || ''}
                  onChange={e => { const arr = [...editIngredients]; arr[idx] = { ...arr[idx], notas: e.target.value }; setEditIngredients(arr); }} />
              </div>
            ))}

            <button style={{ ...btnSec, width: '100%', marginBottom: 12 }} onClick={() => setEditIngredients([...editIngredients, emptyRow()])}>
              + Agregar ingrediente
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={guardarIngredientes}>💾 Guardar</button>
              <button style={{ flex: 1, ...btnSec }} onClick={() => setEditMode(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
      {recetaModal}
    </div>
  );
}

// ── Styles ──
const lbl = { display: 'block', fontSize: 12, color: '#888', marginBottom: 2, marginTop: 8 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
const btnSec = { padding: '8px 12px', borderRadius: 8, border: '1px solid #444', background: '#333', color: '#fff', fontSize: 13, cursor: 'pointer' };
const th = { padding: '6px 4px', fontSize: 11, color: '#666', textAlign: 'left', fontWeight: 600 };
