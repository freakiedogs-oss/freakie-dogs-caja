import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../supabase';
import { BUCKET_CIERRES as BUCKET } from '../../config';
import { useToast } from '../../hooks/useToast';

// ── BANDEJA DE RECEPCIÓN DE DTE (F1) ──────────────────────────────────
// Bodega Casa Matriz recibe con 1 clic los DTE de compra que llegaron por
// correo y que aún no se reciben. Solo aparecen los de proveedores marcados
// "requiere recepción" (catalogo_contable). Cada línea inventariable debe
// mapearse a un producto (sugerencia + búsqueda + crear) o marcarse "omitir";
// la recepción se BLOQUEA hasta resolver todas. Suma inventario por lo REAL
// recibido (kardex), registra faltante/sobrante, foto opcional.
const C = {
  bg: '#0f0f0f', card: '#1a1a1a', card2: '#151515', border: '#2a2a2a',
  green: '#4ade80', red: '#e63946', yellow: '#fbbf24', blue: '#60a5fa',
  purple: '#a78bfa', text: '#f0f0f0', dim: '#8a8a8a', input: '#1e1e1e',
};
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export default function RecepcionDTE({ user, show }) {
  const toast = useToast?.() || { success: show, error: show, warning: show };
  const [dtes, setDtes] = useState([]);
  const [sinNorm, setSinNorm] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);         // DTE abierto
  const [lineas, setLineas] = useState([]);      // estado editable por línea
  const [foto, setFoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [opciones, setOpciones] = useState({ categorias: [], subcategorias: [] });
  const [normProv, setNormProv] = useState(null); // proveedor que se está clasificando
  const [manualOpen, setManualOpen] = useState(false);

  const cargar = async () => {
    setLoading(true);
    const [b, s, cat, op] = await Promise.all([
      db.rpc('bandeja_recepcion_dte', { p_dias: 120 }),
      db.rpc('bandeja_recepcion_sin_normalizar', { p_dias: 120 }),
      db.from('catalogo_productos').select('id,nombre,unidad_medida,sku,categoria,incluir_inventario_fisico').eq('activo', true).order('nombre'),
      db.rpc('catalogo_contable_opciones'),
    ]);
    setDtes(b.data || []);
    setSinNorm(s.data || []);
    setCatalogo(cat.data || []);
    setOpciones(op.data || { categorias: [], subcategorias: [] });
    setLoading(false);
  };
  useEffect(() => { cargar(); }, []);

  const catById = useMemo(() => Object.fromEntries(catalogo.map(p => [p.id, p])), [catalogo]);

  // Abrir un DTE: resolver sugerencias por línea no mapeada
  const abrir = async (dte) => {
    setSel(dte); setFoto(null);
    const base = (dte.items || []).map(it => ({
      ...it,
      cantidad_recibida: Number(it.cantidad) || 0,
      producto_id: it.producto_id || null,
      omitir: false,
      candidatos: [],
      buscando: false,
    }));
    setLineas(base);
    // resolver en paralelo las no mapeadas
    const res = await Promise.all(base.map(l =>
      l.producto_id ? Promise.resolve(null)
        : db.rpc('resolver_item_dte', { p_nit: dte.nit, p_codigo: l.codigo || null, p_descripcion: l.descripcion })
    ));
    setLineas(base.map((l, i) => {
      const r = res[i]?.data;
      if (!r) return l;
      return { ...l, producto_id: r.producto_id || null, candidatos: r.candidatos || [], confianza: r.confianza };
    }));
  };

  const setLinea = (i, patch) => setLineas(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));

  // Mapear una línea a un producto (y aprender)
  const mapear = async (i, producto_id) => {
    setLinea(i, { producto_id, omitir: false });
    const l = lineas[i];
    db.rpc('mapear_proveedor_item', {
      p_nit: sel.nit, p_codigo: l.codigo || null, p_descripcion: l.descripcion,
      p_producto_id: producto_id, p_usuario: user?.id || null,
    }).catch(() => {});
  };

  const pendientes = lineas.filter(l => !l.producto_id && !l.omitir).length;

  const recibir = async () => {
    if (pendientes > 0) { toast.warning?.('Faltan líneas por mapear u omitir'); return; }
    setSaving(true);
    try {
      let fotoUrl = null;
      if (foto) {
        const path = `recepciones/dte_${sel.id}_${foto.name}`.replace(/\s+/g, '_');
        const { error: e } = await db.storage.from(BUCKET).upload(path, foto, { cacheControl: '3600', upsert: true });
        if (!e) { const { data: pu } = db.storage.from(BUCKET).getPublicUrl(path); fotoUrl = pu?.publicUrl; }
      }
      const items = lineas.map(l => ({
        producto_id: l.omitir ? null : l.producto_id,
        cantidad_esperada: Number(l.cantidad) || 0,
        cantidad_recibida: l.omitir ? 0 : (Number(l.cantidad_recibida) || 0),
        descripcion: l.descripcion, unidad: null,
        precio_unitario: Number(l.precio_unitario) || 0,
        notas: l.omitir ? 'omitido (no inventariar)' : null,
      }));
      const { data, error } = await db.rpc('recibir_dte', {
        p_dte_id: sel.id, p_items: items, p_foto_url: fotoUrl,
        p_usuario_id: user?.id || null, p_notas: null,
      });
      if (error) throw error;
      toast.success?.(`✅ Recibido · ${data.inventariados} al inventario${data.con_diferencias ? ` · ${data.con_diferencias} con diferencia` : ''}`);
      setSel(null);
      cargar();
    } catch (e) { toast.error?.('❌ ' + (e.message || 'No se pudo recibir')); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 24, color: C.dim }}>Cargando bandeja…</div>;

  // ── Detalle de un DTE ──
  if (sel) {
    return (
      <div style={{ padding: 16, color: C.text, maxWidth: 900, margin: '0 auto' }}>
        <button onClick={() => setSel(null)} style={btn('#333')}>← Volver a la bandeja</button>
        <div style={{ ...box, marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{sel.proveedor}{sel.manual ? <span style={{ fontSize: 11, color: C.blue, marginLeft: 8 }}>· manual</span> : null}</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
              {sel.fecha_emision} · {fmt(sel.monto_total)} · {sel.dte_codigo || sel.numero_control}
              {sel.categoria ? ` · ${sel.categoria}${sel.subcategoria ? ' / ' + sel.subcategoria : ''}` : ''}
            </div>
          </div>
          <PagoBadge estado={sel.estado_pago} />
          {(sel.comprobante_urls || []).map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noopener"
               style={{ ...btn('#1e293b'), border: `1px solid ${C.green}`, color: C.green, textDecoration: 'none', fontSize: 12 }}>
              📎 Comprobante{(sel.comprobante_urls.length > 1) ? ` ${i + 1}` : ''}
            </a>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {lineas.map((l, i) => (
            <LineaCard key={i} l={l} i={i} nit={sel.nit} catalogo={catalogo} catById={catById}
              onMapear={mapear} onSet={setLinea} user={user} />
          ))}
        </div>

        {/* Foto + recibir */}
        <div style={{ ...box, marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: C.dim }}>
            📷 Foto (opcional):{' '}
            <input type="file" accept="image/*" capture="environment" onChange={e => setFoto(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          </label>
          <div style={{ flex: 1 }} />
          {pendientes > 0 && (
            <span style={{ color: C.yellow, fontSize: 13, fontWeight: 700 }}>
              ⚠️ {pendientes} línea{pendientes !== 1 ? 's' : ''} sin resolver
            </span>
          )}
          <button onClick={recibir} disabled={saving || pendientes > 0}
            style={{ ...btn(pendientes > 0 ? '#333' : C.green), color: pendientes > 0 ? C.dim : '#04220f',
                     fontWeight: 800, cursor: pendientes > 0 ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Recibiendo…' : '✅ Recibir'}
          </button>
        </div>
      </div>
    );
  }

  // ── Bandeja (lista) ──
  return (
    <div style={{ padding: 16, color: C.text, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>📋 Bandeja de Recepción (DTE)</div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setManualOpen(true)} style={{ ...btn(C.blue), color: '#04212b' }}>+ DTE manual</button>
        <button onClick={cargar} style={btn('#333')}>↻</button>
      </div>

      {manualOpen && (
        <DteManualModal user={user} onClose={() => setManualOpen(false)}
          onSaved={() => { setManualOpen(false); cargar(); }} />
      )}

      {sinNorm.length > 0 && (
        <div style={{ ...box, borderLeft: `3px solid ${C.yellow}`, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: C.yellow, fontSize: 13, marginBottom: 8 }}>
            ⚠️ {sinNorm.length} proveedor{sinNorm.length !== 1 ? 'es' : ''} sin clasificar — clasificalos y sus DTE entran a la bandeja
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sinNorm.map(p => (
              <div key={p.nit || p.proveedor} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <div style={{ flex: 1 }}>{p.proveedor} <span style={{ color: C.dim, fontSize: 11 }}>· {p.dtes} DTE · {fmt(p.monto)}</span></div>
                <button onClick={() => setNormProv(p)} style={{ ...btn(C.yellow), color: '#1a1a1a', fontSize: 12 }}>Clasificar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {normProv && (
        <NormalizarModal prov={normProv} opciones={opciones} user={user}
          onClose={() => setNormProv(null)} onSaved={() => { setNormProv(null); cargar(); }} />
      )}

      {dtes.length === 0 ? (
        <div style={{ ...box, textAlign: 'center', color: C.dim, padding: 30 }}>
          ✅ No hay DTE pendientes de recibir.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>{dtes.length} DTE por recibir</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dtes.map(d => (
          <div key={d.id} style={{ ...box, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
            onClick={() => abrir(d)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{d.proveedor}</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                {d.fecha_emision} · {(d.items || []).length} línea{(d.items || []).length !== 1 ? 's' : ''}
                {d.categoria ? ` · ${d.categoria}` : ''}
              </div>
            </div>
            <PagoBadge estado={d.estado_pago} />
            <div style={{ fontWeight: 800 }}>{fmt(d.monto_total)}</div>
            <button style={{ ...btn(C.blue), color: '#04212b' }}>Revisar →</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tarjeta de una línea del DTE ──
function LineaCard({ l, i, nit, catalogo, catById, onMapear, onSet, user }) {
  const [q, setQ] = useState('');
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: l.descripcion, unidad: 'unidad', categoria: '' });
  const prod = l.producto_id ? catById[l.producto_id] : null;
  const resuelto = !!l.producto_id || l.omitir;
  const dif = (Number(l.cantidad_recibida) || 0) - (Number(l.cantidad) || 0);

  const resultados = useMemo(() => {
    if (!q.trim()) return [];
    const nq = norm(q);
    return catalogo.filter(p => norm(p.nombre).includes(nq) || norm(p.sku).includes(nq)).slice(0, 8);
  }, [q, catalogo]);

  const crear = async () => {
    if (!nuevo.nombre.trim()) return;
    const { data, error } = await db.rpc('recepcion_crear_producto', {
      p_nombre: nuevo.nombre, p_unidad_medida: nuevo.unidad, p_categoria: nuevo.categoria || null,
      p_nit: nit, p_codigo: l.codigo || null, p_descripcion_dte: l.descripcion, p_usuario: user?.id || null,
    });
    if (!error && data?.producto_id) {
      catalogo.push({ id: data.producto_id, nombre: data.nombre, unidad_medida: data.unidad, sku: data.sku });
      onMapear(i, data.producto_id);
      setCreando(false);
    }
  };

  return (
    <div style={{ ...box, borderLeft: `3px solid ${resuelto ? (l.omitir ? C.dim : C.green) : C.yellow}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{l.descripcion}</div>
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
            {l.codigo ? `cód ${l.codigo} · ` : ''}facturado {l.cantidad} · {fmt(l.precio_unitario)}
          </div>
        </div>
        {/* cantidad recibida */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: C.dim }}>Recibido</div>
          <input type="number" step="any" value={l.cantidad_recibida} disabled={l.omitir}
            onChange={e => onSet(i, { cantidad_recibida: e.target.value })}
            style={{ ...inp, width: 80, textAlign: 'right' }} />
          {!l.omitir && Math.abs(dif) > 0.001 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: dif < 0 ? C.red : C.yellow }}>
              {dif < 0 ? `faltan ${Math.abs(dif)}` : `sobran ${dif}`}
            </div>
          )}
        </div>
      </div>

      {/* Estado de mapeo */}
      {l.producto_id ? (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, background: '#0a2a0a', borderRadius: 8, padding: '8px 10px' }}>
          <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓ {prod?.nombre || 'producto'}</span>
          <span style={{ fontSize: 11, color: C.dim }}>{prod?.unidad_medida || ''}{prod?.sku ? ` · ${prod.sku}` : ''}</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => onSet(i, { producto_id: null })} style={{ ...btn('#333'), fontSize: 11 }}>Cambiar</button>
        </div>
      ) : l.omitir ? (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.dim, fontSize: 13 }}>➖ Omitida (no se inventaría)</span>
          <button onClick={() => onSet(i, { omitir: false })} style={{ ...btn('#333'), fontSize: 11 }}>Deshacer</button>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {/* sugerencias top-3 */}
          {l.candidatos?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {l.candidatos.map(c => (
                <button key={c.producto_id} onClick={() => onMapear(i, c.producto_id)}
                  style={{ ...btn('#1e293b'), border: `1px solid ${C.blue}`, fontSize: 12 }}>
                  {c.nombre} <span style={{ color: C.dim }}>· {c.unidad}{c.sku ? ` · ${c.sku}` : ''} · {Math.round((c.sim || 0) * 100)}%</span>
                </button>
              ))}
            </div>
          )}
          {/* búsqueda */}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto por nombre o SKU…" style={{ ...inp, width: '100%' }} />
          {resultados.length > 0 && (
            <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
              {resultados.map(p => (
                <div key={p.id} onClick={() => { onMapear(i, p.id); setQ(''); }}
                  style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
                  {p.nombre} <span style={{ color: C.dim, fontSize: 11 }}>· {p.unidad_medida}{p.sku ? ` · ${p.sku}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          {/* crear + omitir */}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {!creando ? (
              <button onClick={() => setCreando(true)} style={{ ...btn('#333'), fontSize: 12 }}>➕ Crear producto</button>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: C.card2, padding: 8, borderRadius: 8 }}>
                <input value={nuevo.nombre} onChange={e => setNuevo(v => ({ ...v, nombre: e.target.value }))} placeholder="Nombre" style={{ ...inp, width: 160 }} />
                <input value={nuevo.unidad} onChange={e => setNuevo(v => ({ ...v, unidad: e.target.value }))} placeholder="unidad" style={{ ...inp, width: 80 }} />
                <button onClick={crear} style={{ ...btn(C.green), color: '#04220f', fontSize: 12 }}>Crear y usar</button>
                <button onClick={() => setCreando(false)} style={{ ...btn('#333'), fontSize: 12 }}>✕</button>
              </div>
            )}
            <button onClick={() => onSet(i, { omitir: true })} style={{ ...btn('#333'), fontSize: 12, color: C.dim }}>Omitir (no inventariar)</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PagoBadge({ estado }) {
  const map = { pagado: [C.green, 'Pagado'], parcial: [C.yellow, 'Parcial'], pendiente: [C.red, 'Sin pagar'] };
  const [col, txt] = map[estado] || map.pendiente;
  return <span style={{ fontSize: 11, fontWeight: 700, color: col, border: `1px solid ${col}`, borderRadius: 999, padding: '2px 8px' }}>{txt}</span>;
}

// ── Clasificar (normalizar) un proveedor sin salir de la página de DTEs ──
function NormalizarModal({ prov, opciones, user, onClose, onSaved }) {
  const toast = useToast?.() || {};
  const REQ_DEFAULT = ['costo_comida', 'insumo_venta']; // categorías que suelen requerir recepción
  const [form, setForm] = useState({ nombre_normalizado: prov.proveedor || '', categoria: '', subcategoria: '', requiere_recepcion: false });
  const [saving, setSaving] = useState(false);
  const setCat = (c) => setForm(f => ({ ...f, categoria: c, requiere_recepcion: REQ_DEFAULT.includes(c) ? true : f.requiere_recepcion }));
  const guardar = async () => {
    if (!form.categoria) return;
    setSaving(true);
    const { error } = await db.rpc('normalizar_proveedor', {
      p_nombre_dte: prov.proveedor, p_nombre_normalizado: form.nombre_normalizado,
      p_categoria: form.categoria, p_subcategoria: form.subcategoria || 'Varios',
      p_requiere_recepcion: form.requiere_recepcion, p_usuario: user?.nombre || null,
    });
    setSaving(false);
    if (error) { toast.error?.('❌ ' + error.message); return; }
    onSaved();
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...box, width: '100%', maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Clasificar proveedor</div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>{prov.proveedor}</div>
        <label style={lbl}>Nombre normalizado</label>
        <input value={form.nombre_normalizado} onChange={e => setForm(f => ({ ...f, nombre_normalizado: e.target.value }))} style={{ ...inp, width: '100%', marginBottom: 10 }} />
        <label style={lbl}>Categoría</label>
        <select value={form.categoria} onChange={e => setCat(e.target.value)} style={{ ...inp, width: '100%', marginBottom: 10 }}>
          <option value="">— elegí —</option>
          {(opciones.categorias || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={lbl}>Subcategoría</label>
        <input value={form.subcategoria} onChange={e => setForm(f => ({ ...f, subcategoria: e.target.value }))} list="norm-subcats" placeholder="Varios" style={{ ...inp, width: '100%', marginBottom: 10 }} />
        <datalist id="norm-subcats">{(opciones.subcategorias || []).map(s => <option key={s} value={s} />)}</datalist>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '6px 0 14px', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.requiere_recepcion} onChange={e => setForm(f => ({ ...f, requiere_recepcion: e.target.checked }))} />
          Requiere recepción física en almacén (insumos / producto tangible)
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('#333')}>Cancelar</button>
          <button onClick={guardar} disabled={!form.categoria || saving} style={{ ...btn(form.categoria ? C.green : '#333'), color: form.categoria ? '#04220f' : C.dim }}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Ingresar un DTE que no llegó por correo (manual) ──
function DteManualModal({ user, onClose, onSaved }) {
  const toast = useToast?.() || {};
  const [f, setF] = useState({ proveedor: '', nit: '', fecha: new Date().toISOString().slice(0, 10), numero_control: '' });
  const [items, setItems] = useState([{ descripcion: '', cantidad: '', precio_unitario: '' }]);
  const [saving, setSaving] = useState(false);
  const setItem = (i, k, v) => setItems(is => is.map((it, j) => j === i ? { ...it, [k]: v } : it));
  const addItem = () => setItems(is => [...is, { descripcion: '', cantidad: '', precio_unitario: '' }]);
  const delItem = (i) => setItems(is => is.filter((_, j) => j !== i));
  const monto = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0);
  const valido = f.proveedor.trim() && items.some(it => it.descripcion.trim() && Number(it.cantidad) > 0);

  const guardar = async () => {
    if (!valido) return;
    setSaving(true);
    const { data, error } = await db.rpc('crear_dte_manual', {
      p_proveedor: f.proveedor, p_nit: f.nit || null, p_fecha: f.fecha,
      p_monto: monto, p_numero_control: f.numero_control || null,
      p_items: items.filter(it => it.descripcion.trim()).map(it => ({
        descripcion: it.descripcion, cantidad: Number(it.cantidad) || 0, precio_unitario: Number(it.precio_unitario) || 0,
      })),
      p_usuario: user?.nombre || null,
    });
    setSaving(false);
    if (error) { toast.error?.('❌ ' + error.message); return; }
    toast.success?.('✅ DTE ingresado — ya está en la bandeja para recibir');
    onSaved();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ ...box, width: '100%', maxWidth: 560, marginTop: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>Ingresar DTE manual</div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>Para facturas de proveedor que no llegaron por correo. Aparecerá en la bandeja para recibir.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div><label style={lbl}>Proveedor *</label><input value={f.proveedor} onChange={e => setF(v => ({ ...v, proveedor: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
          <div><label style={lbl}>NIT</label><input value={f.nit} onChange={e => setF(v => ({ ...v, nit: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
          <div><label style={lbl}>Fecha</label><input type="date" value={f.fecha} onChange={e => setF(v => ({ ...v, fecha: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
          <div><label style={lbl}>Nº control / factura</label><input value={f.numero_control} onChange={e => setF(v => ({ ...v, numero_control: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
        </div>
        <label style={lbl}>Ítems</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={it.descripcion} onChange={e => setItem(i, 'descripcion', e.target.value)} placeholder="Descripción" style={{ ...inp, flex: 1 }} />
              <input value={it.cantidad} onChange={e => setItem(i, 'cantidad', e.target.value)} placeholder="Cant" type="number" step="any" style={{ ...inp, width: 70 }} />
              <input value={it.precio_unitario} onChange={e => setItem(i, 'precio_unitario', e.target.value)} placeholder="P.U." type="number" step="any" style={{ ...inp, width: 80 }} />
              {items.length > 1 && <button onClick={() => delItem(i)} style={{ ...btn('#333'), fontSize: 12 }}>✕</button>}
            </div>
          ))}
        </div>
        <button onClick={addItem} style={{ ...btn('#333'), fontSize: 12 }}>+ Ítem</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <div style={{ fontWeight: 800 }}>Total: {fmt(monto)}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btn('#333')}>Cancelar</button>
            <button onClick={guardar} disabled={!valido || saving} style={{ ...btn(valido ? C.green : '#333'), color: valido ? '#04220f' : C.dim }}>{saving ? 'Guardando…' : 'Ingresar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const box = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 };
const lbl = { fontSize: 11, color: C.dim, display: 'block', marginBottom: 3 };
const inp = { background: C.input, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const btn = (bg) => ({ background: bg, border: 'none', color: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
