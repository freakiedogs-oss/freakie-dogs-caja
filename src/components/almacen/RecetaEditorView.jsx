import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';
import { n } from '../../config';

// ── Editor de Recetas — versión ERP del editor HTML de Cesar (26-ago-2026) ──
// Lee y escribe recetas + receta_ingredientes: las mismas tablas que consumen
// Árbol BOM, Menú (BOM), Costeo y los motores de deducción/producción, así que
// cualquier cambio acá se refleja en todas las vistas y en la próxima venta.
// La baja de inventario por venta es snapshot al momento de la venta (kardex),
// así que editar una receta NO cambia deducciones pasadas, solo las futuras.

const ROLES_EDITAN = ['ejecutivo', 'jefe_casa_matriz', 'superadmin'];

const GRUPOS = [
  { key: 'menu', label: 'Productos del menú', tipos: ['combo', 'plato_menu'] },
  { key: 'porc', label: 'Componentes y porcionados', tipos: ['porcionado'] },
  { key: 'sub', label: 'Sub-recetas', tipos: ['sub_receta'] },
];

export default function RecetaEditorView({ user }) {
  const canEdit = ROLES_EDITAN.includes(user?.rol);
  const [loading, setLoading] = useState(true);
  const [recetas, setRecetas] = useState([]);
  const [ingBase, setIngBase] = useState({});    // { receta_id: [rows] } — como está en DB
  const [ing, setIng] = useState({});            // { receta_id: [rows] } — con ediciones locales
  const [catalogo, setCatalogo] = useState([]);
  const [costoProd, setCostoProd] = useState({});
  const [precioMenu, setPrecioMenu] = useState({}); // { producto_id: precio máx en pos_menu_items }
  const [sel, setSel] = useState(null);
  const [buscar, setBuscar] = useState('');
  const [addTxt, setAddTxt] = useState('');
  const [addQty, setAddQty] = useState('');
  const [notaLocal, setNotaLocal] = useState('');
  const [rendLocal, setRendLocal] = useState(null); // { valor, unidad }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    const [rRes, iRes, cRes, cpRes, pmRes] = await Promise.all([
      db.from('recetas').select('id,nombre,tipo,rendimiento,unidad_rendimiento,precio_venta,notas,activo,catalogo_id,aprobada_por,aprobada_at').eq('activo', true).order('nombre'),
      db.from('receta_ingredientes').select('*, catalogo_productos(id,nombre,unidad_medida,activo), sub:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,tipo,rendimiento,unidad_rendimiento,catalogo_id)'),
      db.from('catalogo_productos').select('id,nombre,unidad_medida,activo').eq('activo', true).order('nombre'),
      db.rpc('costos_productos_recetas'),
      db.from('pos_menu_items').select('producto_id,precio').not('producto_id', 'is', null),
    ]);
    setRecetas(rRes.data || []);
    const grouped = {};
    (iRes.data || []).forEach(i => { (grouped[i.receta_id] = grouped[i.receta_id] || []).push(i); });
    setIngBase(grouped);
    setIng(JSON.parse(JSON.stringify(grouped)));
    setCatalogo(cRes.data || []);
    const cpMap = {}; (cpRes.data || []).forEach(x => { cpMap[x.producto_id] = n(x.costo); });
    setCostoProd(cpMap);
    const pm = {}; (pmRes.data || []).forEach(x => { pm[x.producto_id] = Math.max(pm[x.producto_id] || 0, n(x.precio)); });
    setPrecioMenu(pm);
    setLoading(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const rMap = useMemo(() => Object.fromEntries(recetas.map(r => [r.id, r])), [recetas]);

  // ── Costo recursivo, misma fórmula que receta_costo_total del motor:
  //    Σ cantidad × factor_a_stock × (1+merma%) × (costo_producto | costo_sub/rinde_sub)
  const costoReceta = useCallback(function calc(rid, visto = {}) {
    if (!rid || visto[rid]) return 0;
    visto[rid] = 1;
    return (ing[rid] || []).reduce((s, l) => {
      const mul = n(l.cantidad) * (l.factor_a_stock != null && l.factor_a_stock !== '' ? n(l.factor_a_stock) : 1) * (1 + n(l.merma_pct) / 100);
      if (l.tipo_ingrediente === 'materia_prima') return s + mul * n(costoProd[l.producto_id]);
      const sub = rMap[l.sub_receta_id];
      return s + mul * (sub ? calc(l.sub_receta_id, visto) / (n(sub.rendimiento) || 1) : 0);
    }, 0);
  }, [ing, costoProd, rMap]);

  const dirty = sel ? JSON.stringify(ing[sel.id] || []) !== JSON.stringify(ingBase[sel.id] || []) : false;

  const seleccionar = (r) => {
    setSel(r); setNotaLocal(r.notas || '');
    setRendLocal({ valor: n(r.rendimiento) || 1, unidad: r.unidad_rendimiento || 'porcion' });
    setMsg(''); setAddTxt(''); setAddQty('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setLinea = (idx, patch) => {
    setIng(cur => ({ ...cur, [sel.id]: cur[sel.id].map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  };
  const quitarLinea = (idx) => {
    setIng(cur => ({ ...cur, [sel.id]: cur[sel.id].filter((_, i) => i !== idx) }));
  };

  const agregar = () => {
    const txt = addTxt.trim();
    if (!txt || !(n(addQty) > 0)) { setMsg('Elegí un producto o receta y una cantidad > 0'); return; }
    const esR = txt.startsWith('[receta] ');
    const nombre = esR ? txt.slice(9) : txt;
    const target = esR ? recetas.find(r => r.nombre === nombre) : catalogo.find(c => c.nombre === nombre);
    if (!target) { setMsg('No encontré ese ítem en la lista'); return; }
    const row = esR
      ? { receta_id: sel.id, tipo_ingrediente: 'sub_receta', producto_id: null, sub_receta_id: target.id, cantidad: n(addQty), unidad_medida: target.unidad_rendimiento || 'porcion', factor_a_stock: null, merma_pct: 0, removible: false, etiqueta: null, sub: target, _nuevo: true }
      : { receta_id: sel.id, tipo_ingrediente: 'materia_prima', producto_id: target.id, sub_receta_id: null, cantidad: n(addQty), unidad_medida: target.unidad_medida || 'unidad', factor_a_stock: null, merma_pct: 0, removible: false, etiqueta: null, catalogo_productos: target, _nuevo: true };
    setIng(cur => ({ ...cur, [sel.id]: [...(cur[sel.id] || []), row] }));
    setAddTxt(''); setAddQty(''); setMsg('');
  };

  const guardar = async () => {
    if (!sel || !canEdit) return;
    setSaving(true); setMsg('');
    try {
      const rows = (ing[sel.id] || []).filter(l => (l.producto_id || l.sub_receta_id) && n(l.cantidad) > 0).map(l => ({
        receta_id: sel.id,
        tipo_ingrediente: l.tipo_ingrediente === 'materia_prima' ? 'materia_prima' : 'sub_receta',
        producto_id: l.tipo_ingrediente === 'materia_prima' ? l.producto_id : null,
        sub_receta_id: l.tipo_ingrediente !== 'materia_prima' ? l.sub_receta_id : null,
        cantidad: n(l.cantidad),
        unidad_medida: l.unidad_medida || 'unidad',
        // factor_a_stock: puente unidad-de-receta → unidad-de-stock. Si se pierde,
        // el POS vuelve a descontar bolsas enteras por porción (bug 28-ago).
        factor_a_stock: (l.factor_a_stock === '' || l.factor_a_stock == null) ? null : n(l.factor_a_stock),
        merma_pct: n(l.merma_pct),
        removible: !!l.removible,
        etiqueta: l.removible ? (l.etiqueta || null) : null,
        notas: l.notas || '',
        cantidad_catalogo: l.cantidad_catalogo ?? null,
      }));
      await db.from('receta_ingredientes').delete().eq('receta_id', sel.id);
      if (rows.length) {
        const { error } = await db.from('receta_ingredientes').insert(rows);
        if (error) throw error;
      }
      const rend = n(rendLocal?.valor) || 1;
      const cambios = { rendimiento: rend, unidad_rendimiento: rendLocal?.unidad || 'porcion', notas: notaLocal || '' };
      const { error: e2 } = await db.from('recetas').update(cambios).eq('id', sel.id);
      if (e2) throw e2;
      const { data: ct } = await db.rpc('receta_costo_total', { p_receta_id: sel.id, p_depth: 0 });
      await db.from('recetas').update({ costo_calculado: n(ct) }).eq('id', sel.id);
      setMsg('✓ Guardado — la próxima venta ya descuenta con esta receta');
      await cargar();
      setSel(s => s ? { ...s, ...cambios } : s);
    } catch (err) {
      setMsg('❌ ' + (err.message || 'Error al guardar'));
    }
    setSaving(false);
  };

  const aprobar = async () => {
    if (!sel || !canEdit) return;
    const quien = user?.nombre || 'ERP';
    await db.from('recetas').update({ aprobada_por: quien, aprobada_at: new Date().toISOString() }).eq('id', sel.id);
    setSel(s => ({ ...s, aprobada_por: quien, aprobada_at: new Date().toISOString() }));
    setRecetas(cur => cur.map(r => r.id === sel.id ? { ...r, aprobada_por: quien } : r));
  };

  const deshacer = () => {
    setIng(cur => ({ ...cur, [sel.id]: JSON.parse(JSON.stringify(ingBase[sel.id] || [])) }));
    setNotaLocal(sel.notas || '');
    setRendLocal({ valor: n(sel.rendimiento) || 1, unidad: sel.unidad_rendimiento || 'porcion' });
    setMsg('');
  };

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>Cargando editor de recetas…</div>;

  const lineas = sel ? (ing[sel.id] || []) : [];
  const costo = sel ? costoReceta(sel.id, {}) : 0;
  const rendVal = n(rendLocal?.valor) || 1;
  const costoU = costo / rendVal;
  const precio = sel ? (precioMenu[sel.catalogo_id] || n(sel.precio_venta) || 0) : 0;
  const margen = precio > 0 ? (precio - costoU) / precio * 100 : null;
  const sinCosto = lineas.filter(l => l.tipo_ingrediente === 'materia_prima' && !(n(costoProd[l.producto_id]) > 0))
    .map(l => l.catalogo_productos?.nombre || '?');

  const filtro = buscar.trim().toLowerCase();
  const visible = (r) => !filtro || r.nombre.toLowerCase().includes(filtro);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
      {/* ── NAV ── */}
      <div className="card" style={{ padding: 10, position: 'sticky', top: 10, maxHeight: '82vh', overflowY: 'auto' }}>
        <input placeholder="Buscar receta…" value={buscar} onChange={e => setBuscar(e.target.value)}
          style={{ ...inp, marginBottom: 8 }} />
        {GRUPOS.map(g => {
          const rs = recetas.filter(r => g.tipos.includes(r.tipo) && visible(r));
          if (!rs.length) return null;
          return (
            <div key={g.key}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: '#777', fontWeight: 700, padding: '10px 6px 4px' }}>{g.label} ({rs.length})</div>
              {rs.map(r => (
                <button key={r.id} onClick={() => seleccionar(r)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                    padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, lineHeight: 1.3,
                    background: sel?.id === r.id ? '#e63946' : 'transparent', color: sel?.id === r.id ? '#fff' : '#999', fontWeight: sel?.id === r.id ? 700 : 400 }}>
                  <span>{r.nombre}{r.aprobada_por ? ' ✅' : ''}</span>
                  <span style={{ opacity: 0.6, fontSize: 10 }}>{(ing[r.id] || []).length}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* ── PANEL ── */}
      {!sel ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📝</div>
          Elegí una receta a la izquierda. Lo que guardés acá alimenta el costeo, el Árbol BOM
          <b> y la deducción de inventario de la próxima venta</b> (las ventas pasadas quedan como estaban — el kardex es snapshot).
        </div>
      ) : (
        <div>
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{sel.nombre}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 3, display: 'flex', gap: 6, alignItems: 'center' }}>
                  Rinde
                  <input type="number" step="0.001" value={rendLocal?.valor ?? ''} disabled={!canEdit}
                    onChange={e => setRendLocal(v => ({ ...v, valor: e.target.value }))}
                    style={{ ...inp, width: 70, padding: '3px 6px', textAlign: 'right' }} />
                  <input value={rendLocal?.unidad ?? ''} disabled={!canEdit}
                    onChange={e => setRendLocal(v => ({ ...v, unidad: e.target.value }))}
                    style={{ ...inp, width: 80, padding: '3px 6px' }} />
                  <span style={{ color: '#666' }}>· {sel.tipo}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {sel.aprobada_por
                  ? <div style={{ fontSize: 11, color: '#4ade80' }}>✅ Aprobada por {sel.aprobada_por}{sel.aprobada_at ? ` · ${String(sel.aprobada_at).slice(0, 10)}` : ''}</div>
                  : <div style={{ fontSize: 11, color: '#888' }}>Sin sello de aprobación</div>}
                {canEdit && <button onClick={aprobar} style={{ ...btnSec, marginTop: 6, fontSize: 11, padding: '4px 10px' }}>Sellar aprobación</button>}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 14, marginBottom: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                <th style={th}>Ingrediente</th><th style={th}>Tipo</th>
                <th style={{ ...th, textAlign: 'right' }}>Cantidad</th><th style={th}>Unidad</th>
                <th style={{ ...th, textAlign: 'right' }}>Factor→stock</th>
                <th style={th}>Quitable</th>
                <th style={{ ...th, textAlign: 'right' }}>Costo unit.</th>
                <th style={{ ...th, textAlign: 'right' }}>Aporte</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {lineas.map((l, i) => {
                  const esMP = l.tipo_ingrediente === 'materia_prima';
                  const nombre = esMP ? (l.catalogo_productos?.nombre || '?') : (l.sub?.nombre || rMap[l.sub_receta_id]?.nombre || '?');
                  const sub = rMap[l.sub_receta_id];
                  const cu = esMP ? n(costoProd[l.producto_id]) : (sub ? costoReceta(l.sub_receta_id, { [sel.id]: 1 }) / (n(sub.rendimiento) || 1) : 0);
                  const aporte = n(l.cantidad) * (l.factor_a_stock != null && l.factor_a_stock !== '' ? n(l.factor_a_stock) : 1) * (1 + n(l.merma_pct) / 100) * cu;
                  return (
                    <tr key={l.id || `new${i}`} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: '6px 4px', color: '#ddd' }}>{nombre}{l._nuevo && <span style={{ ...badge, background: '#14532d', color: '#86efac', marginLeft: 6 }}>nuevo</span>}</td>
                      <td style={{ padding: '6px 4px' }}><span style={{ ...badge, background: esMP ? '#2a2a2e' : '#1e3a5f', color: esMP ? '#aaa' : '#93c5fd' }}>{esMP ? 'producto' : 'receta'}</span></td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        <input type="number" step="0.0001" value={l.cantidad ?? ''} disabled={!canEdit}
                          onChange={e => setLinea(i, { cantidad: e.target.value })} style={{ ...inp, width: 78, textAlign: 'right' }} /></td>
                      <td style={{ padding: '6px 4px' }}>
                        <input value={l.unidad_medida || ''} disabled={!canEdit}
                          onChange={e => setLinea(i, { unidad_medida: e.target.value })} style={{ ...inp, width: 70 }} /></td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        <input type="number" step="0.000001" placeholder="—" value={l.factor_a_stock ?? ''} disabled={!canEdit}
                          onChange={e => setLinea(i, { factor_a_stock: e.target.value === '' ? null : e.target.value })} style={{ ...inp, width: 88, textAlign: 'right' }} /></td>
                      <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={!!l.removible} disabled={!canEdit}
                          onChange={e => setLinea(i, { removible: e.target.checked })} />
                        {l.removible && <input placeholder="etiqueta SIN" value={l.etiqueta || ''} disabled={!canEdit}
                          onChange={e => setLinea(i, { etiqueta: e.target.value })} style={{ ...inp, width: 90, marginLeft: 4, fontSize: 11 }} />}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {cu > 0 ? `$${cu.toFixed(4)}` : <span style={{ ...badge, background: '#4a1d1d', color: '#fca5a5' }}>sin costo</span>}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: '#e9c46a', fontVariantNumeric: 'tabular-nums' }}>${aporte.toFixed(4)}</td>
                      <td style={{ padding: '6px 2px' }}>{canEdit && <button onClick={() => quitarLinea(i)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 15 }}>✕</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {canEdit && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <input list="editor-cat" placeholder="Buscar producto o sub-receta para agregar…" value={addTxt}
                  onChange={e => setAddTxt(e.target.value)} style={{ ...inp, flex: 1, minWidth: 220 }} />
                <datalist id="editor-cat">
                  {recetas.filter(r => r.id !== sel.id).map(r => <option key={r.id} value={`[receta] ${r.nombre}`} />)}
                  {catalogo.map(c => <option key={c.id} value={c.nombre} />)}
                </datalist>
                <input type="number" step="0.001" placeholder="Cant." value={addQty} onChange={e => setAddQty(e.target.value)}
                  style={{ ...inp, width: 80, textAlign: 'right' }} />
                <button onClick={agregar} style={{ background: '#4ade80', color: '#04220f', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}>Agregar</button>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#777', marginTop: 8 }}>
              <b>Factor→stock:</b> cuántas unidades de STOCK es 1 unidad de la receta. Salsa en oz sobre bolsa de 32 oz → 0.03125.
              Si el producto ya vive en la unidad de la receta (pan por unidad, especias en g), dejalo vacío — ponerlo dividiría dos veces.
            </div>

            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'baseline', marginTop: 14, paddingTop: 12, borderTop: '1px solid #333' }}>
              <Tot lbl="Costo del lote" val={`$${costo.toFixed(4)}`} />
              <Tot lbl="Rinde" val={`${rendVal} ${rendLocal?.unidad || ''}`} />
              <Tot lbl="Costo / unidad" val={`$${costoU.toFixed(4)}`} />
              {precio > 0 && <Tot lbl={`Margen a $${precio.toFixed(2)}`} val={`${margen.toFixed(1)}%`}
                color={margen < 55 ? '#f87171' : margen < 65 ? '#fbbf24' : '#4ade80'} />}
            </div>
            {sinCosto.length > 0 && (
              <div style={{ background: '#3a2f0f', border: '1px solid #5c4a14', color: '#fcd34d', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginTop: 10 }}>
                ⚠ Sin costo cargado: {sinCosto.join(' · ')} — se consumen pero valen $0 en el costeo (mapeá su factura en Mapeo Compras).
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Notas de la receta</div>
            <textarea value={notaLocal} disabled={!canEdit} onChange={e => setNotaLocal(e.target.value)}
              placeholder="Ej: la mantequilla es para el pan, no para la plancha. Confirmar gramaje con cocina."
              style={{ ...inp, width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box' }} />
            {canEdit && (
              <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={guardar} disabled={saving} className="btn-primary" style={{ padding: '9px 18px', fontWeight: 700 }}>
                  {saving ? 'Guardando…' : '💾 Guardar receta'}
                </button>
                {dirty && <button onClick={deshacer} style={btnSec}>Deshacer cambios</button>}
                {dirty && <span style={{ fontSize: 12, color: '#fbbf24' }}>Hay cambios sin guardar</span>}
                {msg && <span style={{ fontSize: 12, color: msg.startsWith('❌') ? '#f87171' : '#4ade80' }}>{msg}</span>}
              </div>
            )}
            {!canEdit && <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>Solo lectura — tu rol no edita recetas.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Tot({ lbl, val, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>{lbl}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: color || '#fff', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
    </div>
  );
}

const inp = { padding: '6px 8px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13 };
const btnSec = { padding: '8px 12px', borderRadius: 8, border: '1px solid #444', background: '#333', color: '#fff', fontSize: 13, cursor: 'pointer' };
const th = { padding: '6px 4px', fontSize: 10.5, color: '#777', textAlign: 'left', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 };
const badge = { fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 600 };
