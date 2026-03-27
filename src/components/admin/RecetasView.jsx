import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { n } from '../../config';

// ── Usuarios con acceso de edición ──
const EDIT_EMAILS = ['joseisart2008@gmail.com'];
const EDIT_PINS = ['5002', '1234']; // Cesar Rodriguez, Jose Isart

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

  const canEdit = EDIT_PINS.includes(user?.pin);

  // ── Cargar datos ──
  const cargar = useCallback(async () => {
    setLoading(true);
    const [rRes, iRes, cRes] = await Promise.all([
      db.from('recetas').select('*').eq('activo', true).order('tipo').order('nombre'),
      db.from('receta_ingredientes').select('*, catalogo_productos(id,nombre,unidad_medida,precio_referencia), sub:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,tipo,costo_calculado)'),
      db.from('catalogo_productos').select('id,nombre,categoria,unidad_medida,precio_referencia').eq('activo', true).order('nombre'),
    ]);
    setRecetas(rRes.data || []);
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

  // ── Guardar ingredientes editados ──
  const guardarIngredientes = async () => {
    if (!sel) return;
    // Delete existing
    await db.from('receta_ingredientes').delete().eq('receta_id', sel.id);
    // Insert new
    const rows = editIngredients.filter(i => (i.producto_id || i.sub_receta_id) && n(i.cantidad) > 0).map(i => ({
      receta_id: sel.id,
      tipo_ingrediente: i.tipo_ingrediente,
      producto_id: i.tipo_ingrediente === 'materia_prima' ? i.producto_id : null,
      sub_receta_id: i.tipo_ingrediente === 'sub_receta' ? i.sub_receta_id : null,
      cantidad: n(i.cantidad),
      unidad_medida: i.unidad_medida || 'unidad',
      merma_pct: n(i.merma_pct),
      notas: i.notas || '',
    }));
    if (rows.length > 0) await db.from('receta_ingredientes').insert(rows);
    // Update costo_calculado
    const costo = rows.reduce((sum, r) => {
      const prod = catalogo.find(c => c.id === r.producto_id);
      if (prod) return sum + r.cantidad * n(prod.precio_referencia);
      return sum;
    }, 0);
    await db.from('recetas').update({ costo_calculado: Math.round(costo * 100) / 100 }).eq('id', sel.id);
    setEditMode(false);
    await cargar();
  };

  // ── Guardar receta nueva/editada ──
  const guardarReceta = async () => {
    if (!editReceta?.nombre) return;
    if (editReceta.id) {
      await db.from('recetas').update({
        nombre: editReceta.nombre, tipo: editReceta.tipo, categoria: editReceta.categoria,
        rendimiento: n(editReceta.rendimiento) || 1, unidad_rendimiento: editReceta.unidad_rendimiento || 'porcion',
        precio_venta: editReceta.precio_venta ? n(editReceta.precio_venta) : null,
        notas: editReceta.notas || '',
      }).eq('id', editReceta.id);
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

  // ── Iniciar edición de ingredientes ──
  const startEditIngredients = () => {
    const current = (ingredientes[sel.id] || []).map(i => ({
      tipo_ingrediente: i.tipo_ingrediente,
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

  // ── Render ──
  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>Cargando recetas...</div>;

  // ── LISTA ──
  if (!sel) return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>🍔 Recetas / BOM</h2>
        {canEdit && (
          <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setEditReceta({ nombre: '', tipo: 'sub_receta', categoria: '', rendimiento: 1, unidad_rendimiento: 'porcion' }); setShowNewReceta(true); }}>
            + Nueva Receta
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[['todos', 'Todos'], ['plato_menu', 'Menú'], ['sub_receta', 'Sub-recetas'], ['porcionado', 'Porcionados']].map(([k, l]) => (
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
        {[['plato_menu', '🍔'], ['sub_receta', '🥣'], ['porcionado', '📦']].map(([t, icon]) => {
          const cnt = recetas.filter(r => r.tipo === t).length;
          return <div key={t} style={{ background: '#1a1a2e', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#aaa' }}>{icon} {cnt}</div>;
        })}
      </div>

      {/* Lista */}
      {filtradas.map(r => {
        const ings = ingredientes[r.id] || [];
        const costo = calcCosto(r.id);
        return (
          <div key={r.id} className="card" onClick={() => setSel(r)}
            style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{r.nombre}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {r.categoria} · {ings.length} ingredientes
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {tipoBadge(r.tipo)}
                {r.precio_venta > 0 && (
                  <div style={{ fontSize: 12, color: '#4ade80', marginTop: 4 }}>
                    ${n(r.precio_venta).toFixed(2)}
                    {costo > 0 && <span style={{ color: '#888', marginLeft: 4 }}>({Math.round((1 - costo / n(r.precio_venta)) * 100)}%)</span>}
                  </div>
                )}
                {costo > 0 && <div style={{ fontSize: 11, color: '#e9c46a' }}>Costo: ${costo.toFixed(2)}</div>}
              </div>
            </div>
          </div>
        );
      })}

      {filtradas.length === 0 && <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay recetas que mostrar</div>}

      {/* Modal nueva receta */}
      {showNewReceta && (
        <div className="modal-bg" onClick={() => setShowNewReceta(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 12px', color: '#fff' }}>{editReceta?.id ? 'Editar' : 'Nueva'} Receta</h3>
            <label style={lbl}>Nombre</label>
            <input style={inp} value={editReceta?.nombre || ''} onChange={e => setEditReceta({ ...editReceta, nombre: e.target.value })} />
            <label style={lbl}>Tipo</label>
            <select style={inp} value={editReceta?.tipo || 'sub_receta'} onChange={e => setEditReceta({ ...editReceta, tipo: e.target.value })}>
              <option value="plato_menu">Plato del Menú</option>
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
                <input style={inp} value={editReceta?.unidad_rendimiento || 'porcion'} onChange={e => setEditReceta({ ...editReceta, unidad_rendimiento: e.target.value })} />
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
      )}
    </div>
  );

  // ── DETALLE ──
  const ings = ingredientes[sel.id] || [];
  const costo = calcCosto(sel.id);

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
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{sel.categoria} · Rinde {n(sel.rendimiento)} {sel.unidad_rendimiento}</div>
            {sel.notas && <div style={{ fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' }}>{sel.notas}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            {sel.precio_venta > 0 && <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80' }}>${n(sel.precio_venta).toFixed(2)}</div>}
            {costo > 0 && (
              <>
                <div style={{ fontSize: 13, color: '#e9c46a' }}>Costo: ${costo.toFixed(2)}</div>
                {sel.precio_venta > 0 && (
                  <div style={{ fontSize: 12, color: '#888' }}>Margen: {Math.round((1 - costo / n(sel.precio_venta)) * 100)}%</div>
                )}
              </>
            )}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={() => { setEditReceta({ ...sel }); setShowNewReceta(true); }}>
              ✏️ Editar Receta
            </button>
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
                  const costoLine = i.tipo_ingrediente === 'materia_prima'
                    ? n(i.cantidad) * n(i.catalogo_productos?.precio_referencia)
                    : n(i.cantidad) * calcCosto(i.sub?.id);
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
                  </select>
                  <button style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 6, padding: '0 8px', cursor: 'pointer' }}
                    onClick={() => setEditIngredients(editIngredients.filter((_, i) => i !== idx))}>✕</button>
                </div>

                {ing.tipo_ingrediente === 'materia_prima' ? (
                  <select style={{ ...inp, fontSize: 12 }} value={ing.producto_id || ''}
                    onChange={e => {
                      const arr = [...editIngredients];
                      const prod = catalogo.find(c => c.id === e.target.value);
                      arr[idx] = { ...arr[idx], producto_id: e.target.value, unidad_medida: prod?.unidad_medida || 'unidad', _nombre: prod?.nombre };
                      setEditIngredients(arr);
                    }}>
                    <option value="">— Seleccionar producto —</option>
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
                    <option value="">— Seleccionar sub-receta —</option>
                    {recetas.filter(r => r.tipo === 'sub_receta' || r.tipo === 'porcionado').map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                )}

                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input style={{ ...inp, flex: 1 }} type="number" step="0.001" placeholder="Cantidad"
                    value={ing.cantidad || ''} onChange={e => { const arr = [...editIngredients]; arr[idx] = { ...arr[idx], cantidad: e.target.value }; setEditIngredients(arr); }} />
                  <input style={{ ...inp, width: 80 }} placeholder="Unidad" value={ing.unidad_medida || ''}
                    onChange={e => { const arr = [...editIngredients]; arr[idx] = { ...arr[idx], unidad_medida: e.target.value }; setEditIngredients(arr); }} />
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
    </div>
  );
}

// ── Styles ──
const lbl = { display: 'block', fontSize: 12, color: '#888', marginBottom: 2, marginTop: 8 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
const btnSec = { padding: '8px 12px', borderRadius: 8, border: '1px solid #444', background: '#333', color: '#fff', fontSize: 13, cursor: 'pointer' };
const th = { padding: '6px 4px', fontSize: 11, color: '#666', textAlign: 'left', fontWeight: 600 };
