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

  const cargar = async () => {
    setLoading(true);
    const [b, s, cat] = await Promise.all([
      db.rpc('bandeja_recepcion_dte', { p_dias: 120 }),
      db.rpc('bandeja_recepcion_sin_normalizar', { p_dias: 120 }),
      db.from('catalogo_productos').select('id,nombre,unidad_medida,sku,categoria,incluir_inventario_fisico').eq('activo', true).order('nombre'),
    ]);
    setDtes(b.data || []);
    setSinNorm(s.data || []);
    setCatalogo(cat.data || []);
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
        <div style={{ ...box, marginTop: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{sel.proveedor}</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
            {sel.fecha_emision} · {fmt(sel.monto_total)} · {sel.dte_codigo || sel.numero_control}
            {sel.categoria ? ` · ${sel.categoria}${sel.subcategoria ? ' / ' + sel.subcategoria : ''}` : ''}
          </div>
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
            <input type="file" accept="image/*" onChange={e => setFoto(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
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
        <button onClick={cargar} style={btn('#333')}>↻</button>
      </div>

      {sinNorm.length > 0 && (
        <div style={{ ...box, borderLeft: `3px solid ${C.yellow}`, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: C.yellow, fontSize: 13 }}>
            ⚠️ {sinNorm.length} proveedor{sinNorm.length !== 1 ? 'es' : ''} sin clasificar
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>
            No se sabe si requieren recepción. Clasificalos en Finanzas → Catálogo (marcá "requiere recepción").{' '}
            {sinNorm.slice(0, 6).map(p => p.proveedor).join(' · ')}{sinNorm.length > 6 ? '…' : ''}
          </div>
        </div>
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

const box = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 };
const inp = { background: C.input, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const btn = (bg) => ({ background: bg, border: 'none', color: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
