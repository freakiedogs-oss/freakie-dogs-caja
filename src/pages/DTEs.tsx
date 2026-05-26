import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';

interface CategoriaGasto {
  id: string;
  nombre: string;
  grupo: string;
  emoji: string | null;
}
interface ClasifActual {
  categoria_id: string;
  es_automatico: boolean;
}

interface DTE {
  id: string;
  proveedor_id: string | null;
  tipo_dte: string | null;
  codigo_generacion: string;
  numero_control: string | null;
  fecha_emision: string | null;
  subtotal: number;
  iva: number;
  total: number;
  estado: string;
  emisor_nit: string | null;
  emisor_nombre: string | null;
  gmail_msg_id: string | null;
  gmail_subject: string | null;
  gmail_from: string | null;
  gmail_fecha: string | null;
  notas_clasificacion: string | null;
  importado_en: string | null;
}

interface DetalleLinea {
  id: string;
  orden: number;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  precio_unitario: number;
  monto: number;
  iva: number;
  ingrediente_id: string | null;
  catalogo_id: number | null;
}

interface Proveedor { id: string; nombre: string; nit: string | null; }
interface Ingrediente { id: string; codigo: string; nombre: string; unidad: string | null; precio_costo: number | null; }
interface ItemCatalogo {
  id: number;
  nombre: string;
  categoria_id: string;
  subcategoria: string | null;
  activo: boolean;
}

const ESTADO_LABELS: Record<string, { label: string; color: string }> = {
  pendiente_clasificar: { label: '⚠ Sin clasificar', color: 'var(--state-warning)' },
  clasificada:          { label: '✓ Clasificada',   color: 'var(--accent-kaeru)' },
  pagada:               { label: '💵 Pagada',        color: 'var(--accent-purple)' },
  rechazada:            { label: '✕ Rechazada',     color: 'var(--state-danger)' },
  duplicada:            { label: '⊗ Duplicada',     color: 'var(--text-muted)' }
};

const TIPO_LABELS: Record<string, string> = {
  factura: 'Factura',
  ccf: 'CCF',
  nota_credito: 'NC',
  nota_debito: 'ND',
  factura_exportacion: 'F.Export',
  sujeto_excluido: 'Suj.Excl',
  comprobante_retencion: 'Retención'
};

export default function DTEs() {
  const toast = useToast();
  const [dtes, setDtes] = useState<DTE[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [clasifMap, setClasifMap] = useState<Map<string, ClasifActual>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');
  const [selected, setSelected] = useState<DTE | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [aplicandoReglas, setAplicandoReglas] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [dRes, pRes, cRes, clRes] = await Promise.all([
        kaeru.from('compras_dte').select('*').order('fecha_emision', { ascending: false }).order('importado_en', { ascending: false }).limit(200),
        kaeru.from('proveedores').select('id,nombre,nit').order('nombre'),
        kaeru.from('categorias_gasto').select('id,nombre,grupo,emoji').order('orden'),
        kaeru.from('dte_clasificacion').select('dte_id,categoria_id,es_automatico')
      ]);
      if (cancel) return;
      setDtes((dRes.data || []) as unknown as DTE[]);
      setProveedores((pRes.data || []) as unknown as Proveedor[]);
      setCategorias((cRes.data || []) as unknown as CategoriaGasto[]);
      const map = new Map<string, ClasifActual>();
      for (const c of (clRes.data || []) as any[]) {
        map.set(c.dte_id, { categoria_id: c.categoria_id, es_automatico: c.es_automatico });
      }
      setClasifMap(map);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  const refresh = () => setReloadKey((k) => k + 1);

  async function aplicarReglasMasivo() {
    if (!confirm('Aplicar reglas auto-clasificación a TODOS los DTEs sin clasificar?')) return;
    setAplicandoReglas(true);
    const { data, error } = await kaeru.rpc('dte_aplicar_reglas');
    setAplicandoReglas(false);
    if (error) { toast.error('Error: ' + error.message); return; }
    const r = (Array.isArray(data) && data.length > 0 ? data[0] : null) as any;
    if (r) toast.success(`✓ ${r.total_procesados} DTEs · auto ${r.clasificados_auto} · sin match ${r.sin_match} · ya ${r.ya_clasificados}`);
    refresh();
  }

  const dtesFiltrados = filtroEstado === 'todos' ? dtes : dtes.filter((d) => d.estado === filtroEstado);

  // Stats
  const pendientes = dtes.filter((d) => d.estado === 'pendiente_clasificar').length;
  const clasificadas = dtes.filter((d) => d.estado === 'clasificada').length;
  const pagadas = dtes.filter((d) => d.estado === 'pagada').length;
  const totalDolares = dtes.filter((d) => d.estado !== 'rechazada' && d.estado !== 'duplicada').reduce((s, d) => s + Number(d.total || 0), 0);

  if (loading) return <PageShell kanji="票" titulo="Inbox DTE" subtitulo=""><LoadingCard /></PageShell>;

  return (
    <PageShell
      kanji="票"
      titulo="Inbox DTE Proveedores"
      subtitulo={`${dtes.length} documentos recibidos · ${pendientes} sin clasificar · Apps Script trigger horario`}
      badge={pendientes > 0 ? { label: `⚠ ${pendientes} pendientes`, variant: 'warning' } : { label: '✓ Todo clasificado', variant: 'kaeru' }}
      actions={
        <button onClick={aplicarReglasMasivo} disabled={aplicandoReglas} className="btn btn-kaeru btn-sm" title="Auto-clasificar DTEs sin categoría contable">
          {aplicandoReglas ? '● Aplicando…' : '🪄 Aplicar reglas'}
        </button>
      }
    >
      <div className="card-grid card-grid-4">
        <div className="card"><div className="card-title">Total</div><div className="metric-xl">{dtes.length}</div></div>
        <div className="card"><div className="card-title">Sin clasificar</div><div className="metric-xl text-warning">{pendientes}</div></div>
        <div className="card"><div className="card-title">Clasificadas / Pagadas</div><div className="metric-xl text-kaeru">{clasificadas + pagadas}</div></div>
        <div className="card"><div className="card-title">Total $</div><div className="metric-xl text-purple">{formatUSD(totalDolares)}</div></div>
      </div>

      {/* Filtros */}
      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[
            ['todos', `Todos (${dtes.length})`],
            ['pendiente_clasificar', `⚠ Pendientes (${pendientes})`],
            ['clasificada', `✓ Clasificadas (${clasificadas})`],
            ['pagada', `💵 Pagadas (${pagadas})`],
            ['rechazada', 'Rechazadas'],
            ['duplicada', 'Duplicadas']
          ].map(([key, label]) => (
            <button key={key} onClick={() => setFiltroEstado(key)} className={`btn btn-sm ${filtroEstado === key ? 'btn-kaeru' : 'btn-outline'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Documentos</div>
          <span className="badge badge-muted">Click → ver detalle + clasificar</span>
        </div>
        {dtesFiltrados.length === 0 ? <EmptyCard message="Sin DTEs en este filtro. Apps Script poll cada hora." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Emisor</th>
                  <th>Núm. Control</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th style={{ textAlign: 'right' }}>IVA</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Proveedor</th>
                  <th>Categoría contable</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {dtesFiltrados.map((d) => {
                  const prov = proveedores.find((p) => p.id === d.proveedor_id);
                  const est = ESTADO_LABELS[d.estado] || { label: d.estado, color: 'var(--text-muted)' };
                  const clasif = clasifMap.get(d.id);
                  const cat = clasif ? categorias.find((c) => c.id === clasif.categoria_id) : null;
                  return (
                    <tr key={d.id} onClick={() => setSelected(d)} style={{ cursor: 'pointer' }}>
                      <td className="text-muted" style={{ fontSize: 11 }}>{formatDate(d.fecha_emision)}</td>
                      <td><span className="badge badge-muted">{TIPO_LABELS[d.tipo_dte || ''] || d.tipo_dte || '?'}</span></td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{d.emisor_nombre || '?'}</div>
                        {d.emisor_nit && <div className="text-muted" style={{ fontSize: 10, fontFamily: 'monospace' }}>{d.emisor_nit}</div>}
                      </td>
                      <td className="text-muted" style={{ fontSize: 10, fontFamily: 'monospace' }}>{d.numero_control || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(d.subtotal)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontSize: 11 }}>{formatUSD(d.iva)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{formatUSD(d.total)}</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{prov?.nombre || <span className="text-dim">— sin match —</span>}</td>
                      <td style={{ fontSize: 11 }}>
                        {cat
                          ? <span style={{ color: cat.id === 'sin_clasificar' ? '#f5b400' : 'var(--accent-kaeru)' }}>
                              {cat.emoji} {cat.nombre}
                              {clasif?.es_automatico && <span className="text-muted" style={{ fontSize: 9 }}> · auto</span>}
                            </span>
                          : <span className="text-dim">— pendiente —</span>}
                      </td>
                      <td><span style={{ color: est.color, fontSize: 11, fontWeight: 600 }}>{est.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Helper */}
      <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
        <div className="card-title text-purple" style={{ marginBottom: 8 }}>Cómo funciona la pipeline</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          1. <strong>Proveedor emite DTE</strong> y manda a <code>kaeruchansv@gmail.com</code><br />
          2. <strong>Gmail filter</strong> aplica label <code>Kaeru/DTE/Inbox</code><br />
          3. <strong>Apps Script trigger horario</strong> corre <code>kaeru_dte_pollGmail()</code><br />
          4. Para cada email: extrae adjunto <code>.json</code> → POST a <code>kaeru-dte-ingest</code> edge function<br />
          5. Edge function valida receptor NIT = Kaeru, busca proveedor por NIT, INSERT en <code>compras_dte</code> + <code>compras_dte_detalle</code><br />
          6. Si match proveedor → estado <strong>clasificada</strong>. Si no → <strong>pendiente_clasificar</strong> (manual)<br />
          7. Aparece aquí en tiempo real (refresh manual o auto-refresh futuro)<br />
          • <strong>Pendiente:</strong> matching ingredientes (DTE line item → kaeru.ingredientes) para COGS automático<br />
          • <strong>Pendiente:</strong> match con <code>pagos_proveedor</code> al pagar → estado pagada
        </div>
      </div>

      {/* Drawer detalle */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `DTE ${TIPO_LABELS[selected.tipo_dte || ''] || ''} · ${selected.emisor_nombre || '?'}` : ''}>
        {selected && <DTEDetalle dte={selected} proveedores={proveedores} onSaved={() => { setSelected(null); refresh(); }} />}
      </Drawer>
    </PageShell>
  );
}

// =============================================================================
// DETALLE
// =============================================================================
function DTEDetalle({ dte, proveedores, onSaved }: { dte: DTE; proveedores: Proveedor[]; onSaved: () => void }) {
  const toast = useToast();
  const [lineas, setLineas] = useState<DetalleLinea[]>([]);
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([]);
  const [loading, setLoading] = useState(true);
  const [proveedorId, setProveedorId] = useState<string>(dte.proveedor_id || '');
  const [estado, setEstado] = useState<string>(dte.estado);
  const [notas, setNotas] = useState<string>(dte.notas_clasificacion || '');
  const [saving, setSaving] = useState(false);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [aprenderRegla, setAprenderRegla] = useState(true);

  // Clasificación contable
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [categoriaActual, setCategoriaActual] = useState<string>('');
  const [aprenderCategoria, setAprenderCategoria] = useState(true);
  const [savingCategoria, setSavingCategoria] = useState(false);

  // Items del catálogo contable (para mapear líneas no-ingrediente)
  const [itemsCatalogo, setItemsCatalogo] = useState<ItemCatalogo[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [dRes, iRes, cRes, clRes, catRes] = await Promise.all([
        kaeru.from('compras_dte_detalle').select('*').eq('compra_dte_id', dte.id).order('orden'),
        kaeru.from('ingredientes').select('id,codigo,nombre,unidad,precio_costo').eq('activo', true).order('nombre'),
        kaeru.from('categorias_gasto').select('id,nombre,grupo,emoji').order('orden'),
        kaeru.from('dte_clasificacion').select('categoria_id').eq('dte_id', dte.id).maybeSingle(),
        kaeru.from('catalogo_contable').select('id,nombre,categoria_id,subcategoria,activo').eq('activo', true).order('nombre')
      ]);
      if (cancel) return;
      setLineas((dRes.data || []) as unknown as DetalleLinea[]);
      setIngredientes((iRes.data || []) as unknown as Ingrediente[]);
      setCategorias((cRes.data || []) as unknown as CategoriaGasto[]);
      setCategoriaActual((clRes.data as any)?.categoria_id || '');
      setItemsCatalogo((catRes.data || []) as unknown as ItemCatalogo[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [dte.id]);

  // Auto-guardar al cambiar el dropdown (sin botón separado para evitar UX confusa)
  async function cambiarCategoria(nuevaCategoria: string) {
    setCategoriaActual(nuevaCategoria);
    if (!nuevaCategoria) return;
    setSavingCategoria(true);
    const { error } = await kaeru.rpc('dte_clasificar', {
      p_dte_id: dte.id,
      p_categoria_id: nuevaCategoria,
      p_aprender: aprenderCategoria
    });
    setSavingCategoria(false);
    if (error) { toast.error('Error: ' + error.message); return; }
    const cat = categorias.find((c) => c.id === nuevaCategoria);
    toast.success(aprenderCategoria
      ? `✓ ${cat?.emoji} ${cat?.nombre} · regla aprendida para futuros DTEs de ${dte.emisor_nombre || dte.emisor_nit}`
      : `✓ ${cat?.emoji} ${cat?.nombre}`
    );
  }

  // Mapear línea: el value puede ser 'ing:<id>' o 'cat:<id>' o 'new:<categoria_id>' (crear subcategoría) o ''
  async function matchearLinea(linea: DetalleLinea, value: string) {
    if (!value) {
      // Limpiar mapeo
      setMatchingId(linea.id);
      await kaeru.from('compras_dte_detalle').update({ ingrediente_id: null, catalogo_id: null }).eq('id', linea.id);
      setMatchingId(null);
      setLineas((prev) => prev.map((l) => l.id === linea.id ? { ...l, ingrediente_id: null, catalogo_id: null } : l));
      return;
    }

    const [tipo, id] = value.split(':');

    if (tipo === 'new') {
      // Crear nueva subcategoría — prompt simple
      const categoriaId = id;
      const nombre = prompt(`Nuevo item para la categoría seleccionada:\n\nDescripción del DTE: "${linea.descripcion}"\n\nNombre del item (ej: "Software mensualidad Kolo"):`, linea.descripcion);
      if (!nombre || !nombre.trim()) return;
      const subcategoria = prompt('Subcategoría (opcional, ej: "Software" o "SaaS"):', '');

      setMatchingId(linea.id);
      const { data: created, error: cErr } = await kaeru.rpc('catalogo_agregar', {
        p_nombre: nombre.trim(),
        p_categoria_id: categoriaId,
        p_subcategoria: subcategoria?.trim() || null
      });
      if (cErr || !created || !Array.isArray(created) || created.length === 0) {
        setMatchingId(null);
        toast.error('Error creando subcategoría: ' + (cErr?.message || 'sin respuesta'));
        return;
      }
      const newId = (created[0] as any).id;
      // Refrescar catálogo
      const { data: catRes } = await kaeru.from('catalogo_contable').select('id,nombre,categoria_id,subcategoria,activo').eq('activo', true).order('nombre');
      setItemsCatalogo((catRes || []) as unknown as ItemCatalogo[]);
      // Mapear esta línea al item recién creado
      await kaeru.rpc('match_dte_linea_catalogo', { p_detalle_id: linea.id, p_catalogo_id: newId, p_aprender: aprenderRegla });
      setLineas((prev) => prev.map((l) => l.id === linea.id ? { ...l, ingrediente_id: null, catalogo_id: newId } : l));
      setMatchingId(null);
      toast.success(`✓ Item creado: ${nombre} · línea mapeada`);
      return;
    }

    if (tipo === 'cat') {
      setMatchingId(linea.id);
      const { error } = await kaeru.rpc('match_dte_linea_catalogo', {
        p_detalle_id: linea.id,
        p_catalogo_id: Number(id),
        p_aprender: aprenderRegla
      });
      setMatchingId(null);
      if (error) { toast.error('Error: ' + error.message); return; }
      const item = itemsCatalogo.find((i) => i.id === Number(id));
      setLineas((prev) => prev.map((l) => l.id === linea.id ? { ...l, ingrediente_id: null, catalogo_id: Number(id) } : l));
      toast.success(`✓ Mapeado a ${item?.nombre || 'item'}`);
      return;
    }

    // tipo === 'ing' — flujo viejo: match a ingrediente
    setMatchingId(linea.id);
    const { data, error } = await kaeru.rpc('match_dte_linea', {
      p_detalle_id: linea.id,
      p_ingrediente_id: id,
      p_aprender: aprenderRegla
    });
    setMatchingId(null);
    if (error) { toast.error('Error: ' + error.message); return; }
    setLineas((prev) => prev.map((l) => l.id === linea.id ? { ...l, ingrediente_id: id, catalogo_id: null } : l));
    if (data && (data as any).regla_creada) {
      const { data: iRes } = await kaeru.from('ingredientes').select('id,codigo,nombre,unidad,precio_costo').eq('activo', true).order('nombre');
      setIngredientes((iRes || []) as unknown as Ingrediente[]);
    }
  }

  async function aplicarReglas() {
    setSaving(true);
    const { data, error } = await kaeru.rpc('aplicar_reglas_a_dte', { p_compra_dte_id: dte.id });
    setSaving(false);
    if (error) { alert('Error: ' + error.message); return; }
    if (data) {
      alert(`Reglas aplicadas: ${(data as any).matcheadas}/${(data as any).pendientes_inicial} líneas matcheadas`);
    }
    // Recargar líneas
    const { data: dRes } = await kaeru.from('compras_dte_detalle').select('*').eq('compra_dte_id', dte.id).order('orden');
    setLineas((dRes || []) as unknown as DetalleLinea[]);
  }

  async function guardar() {
    setSaving(true);
    const { error } = await kaeru.from('compras_dte').update({
      proveedor_id: proveedorId || null,
      estado,
      notas_clasificacion: notas || null
    }).eq('id', dte.id);
    setSaving(false);
    if (error) { alert(error.message); return; }
    onSaved();
  }

  return (
    <div className="stack-sm">
      {/* Resumen header */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row-between" style={{ marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{dte.emisor_nombre || '?'}</div>
            {dte.emisor_nit && <div className="text-muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>NIT {dte.emisor_nit}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-metric)', fontSize: 26, color: 'var(--accent-kaeru)' }}>{formatUSD(dte.total)}</div>
            <div className="text-muted" style={{ fontSize: 10 }}>{formatDate(dte.fecha_emision)} · {TIPO_LABELS[dte.tipo_dte || ''] || dte.tipo_dte}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          <span>Subtotal: {formatUSD(dte.subtotal)}</span>
          <span>IVA: {formatUSD(dte.iva)}</span>
        </div>
        {dte.numero_control && <div className="text-muted" style={{ fontSize: 10, marginTop: 4, fontFamily: 'monospace' }}>NCF: {dte.numero_control}</div>}
        <div className="text-muted" style={{ fontSize: 9, marginTop: 2, fontFamily: 'monospace' }}>Cod.Gen: {dte.codigo_generacion}</div>
      </div>

      {/* Clasificación */}
      <div className="card" style={{ padding: 12 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Clasificar</div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          <span className="card-title" style={{ fontSize: 10 }}>Proveedor</span>
          <select className="ki-input" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">— Sin proveedor —</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.nit ? ` · ${p.nit}` : ''}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          <span className="card-title" style={{ fontSize: 10 }}>Estado</span>
          <select className="ki-input" value={estado} onChange={(e) => setEstado(e.target.value)}>
            {Object.keys(ESTADO_LABELS).map((k) => <option key={k} value={k}>{ESTADO_LABELS[k].label}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="card-title" style={{ fontSize: 10 }}>Notas</span>
          <textarea className="ki-input" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: Cobrado 2x, error proveedor — pedir NC" />
        </label>

        <button onClick={guardar} disabled={saving} className="btn btn-kaeru" style={{ width: '100%', marginTop: 10 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {/* Clasificación contable — auto-guarda al cambiar dropdown */}
      <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--accent-purple)' }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div className="card-title">📊 Categoría contable (P&L)</div>
          {savingCategoria && <span className="text-muted" style={{ fontSize: 10 }}>● guardando…</span>}
        </div>

        <label className="row" style={{ gap: 6, fontSize: 11, cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" checked={aprenderCategoria} onChange={(e) => setAprenderCategoria(e.target.checked)} />
          <span>Aprender regla: futuros DTEs de <strong>{dte.emisor_nombre || dte.emisor_nit}</strong> se clasifican igual</span>
        </label>

        <select
          className="ki-input"
          value={categoriaActual}
          onChange={(e) => cambiarCategoria(e.target.value)}
          disabled={savingCategoria}
          style={{
            width: '100%',
            background: categoriaActual ? 'rgba(154,111,209,0.10)' : 'var(--bg-card)',
            color:      categoriaActual ? 'var(--accent-purple)' : 'var(--text-primary)',
            fontWeight: categoriaActual ? 600 : 400
          }}
        >
          <option value="">— Seleccionar categoría (auto-guarda) —</option>
          {Array.from(new Set(categorias.map((c) => c.grupo))).map((grupo) => (
            <optgroup key={grupo} label={grupo}>
              {categorias.filter((c) => c.grupo === grupo).map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.nombre}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <div className="text-muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>
          Al cambiar este dropdown se guarda automáticamente. Aparece en <code>/gastos-consolidados</code> para el P&L mensual.
        </div>
      </div>

      {/* Gmail metadata */}
      {dte.gmail_subject && (
        <div className="card" style={{ padding: 10 }}>
          <div className="card-title" style={{ fontSize: 10, marginBottom: 4 }}>📧 Email origen</div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            <div><strong>De:</strong> {dte.gmail_from}</div>
            <div><strong>Asunto:</strong> {dte.gmail_subject}</div>
            <div><strong>Fecha:</strong> {dte.gmail_fecha ? formatDate(dte.gmail_fecha) : '—'}</div>
          </div>
        </div>
      )}

      {/* Líneas con mapping unificado: ingrediente O item contable */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div className="card-title">
            Items DTE ({lineas.length})
            {' · '}
            <span className="text-kaeru">{lineas.filter((l) => l.ingrediente_id || l.catalogo_id).length} mapeados</span>
          </div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <label className="row" style={{ gap: 4, fontSize: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={aprenderRegla} onChange={(e) => setAprenderRegla(e.target.checked)} />
              <span>Aprender match</span>
            </label>
            <button onClick={aplicarReglas} disabled={saving} className="btn btn-outline btn-sm">
              🪄 Aplicar reglas
            </button>
          </div>
        </div>

        {loading ? <div className="text-muted">Cargando…</div> : lineas.length === 0 ? (
          <div className="text-dim" style={{ fontSize: 12 }}>Sin items en este DTE</div>
        ) : (
          <div className="stack-xs">
            {lineas.map((l) => {
              const ing = l.ingrediente_id ? ingredientes.find((i) => i.id === l.ingrediente_id) : null;
              const cat = l.catalogo_id ? itemsCatalogo.find((c) => c.id === l.catalogo_id) : null;
              const mapeado = !!ing || !!cat;
              const color = ing ? 'var(--accent-kaeru)' : cat ? 'var(--accent-purple)' : 'var(--border-subtle)';
              const bg    = ing ? 'rgba(95,224,169,0.08)' : cat ? 'rgba(154,111,209,0.08)' : 'var(--bg-inset)';

              // Filtrar items del catálogo a la categoría actual del DTE (si está clasificado)
              const itemsRelevantes = categoriaActual
                ? itemsCatalogo.filter((i) => i.categoria_id === categoriaActual)
                : itemsCatalogo;

              const currentValue = ing ? `ing:${l.ingrediente_id}`
                                 : cat ? `cat:${l.catalogo_id}`
                                 : '';

              return (
                <div key={l.id} style={{
                  background: bg,
                  border: `1px solid ${color}`,
                  borderRadius: 6,
                  padding: 8,
                  fontSize: 11
                }}>
                  <div className="row-between" style={{ marginBottom: 4 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{l.descripcion}</div>
                      <div className="text-muted" style={{ fontSize: 10 }}>
                        #{l.orden} · {l.cantidad} {l.unidad || ''} · {formatUSD(l.precio_unitario)}/u
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginLeft: 8 }}>{formatUSD(l.monto)}</div>
                  </div>
                  <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span className="text-muted" style={{ fontSize: 10, minWidth: 50 }}>Item:</span>
                    <select
                      value={currentValue}
                      onChange={(e) => matchearLinea(l, e.target.value)}
                      disabled={matchingId === l.id}
                      className="ki-input"
                      style={{
                        flex: 1, fontSize: 11, padding: '4px 6px',
                        background: mapeado ? 'rgba(154,111,209,0.1)' : 'var(--bg-card)',
                        color: mapeado ? color : 'var(--text-primary)',
                        fontWeight: mapeado ? 600 : 400
                      }}
                    >
                      <option value="">— Sin mapeo —</option>
                      <optgroup label="🍜 Ingredientes (afecta COGS + stock)">
                        {ingredientes.map((i) => (
                          <option key={i.id} value={`ing:${i.id}`}>
                            {i.nombre}{i.unidad ? ` (${i.unidad})` : ''}{i.precio_costo ? ` · $${i.precio_costo}` : ''}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={`📊 Items contables ${categoriaActual ? '(categoría actual)' : '(todos)'}`}>
                        {itemsRelevantes.map((c) => (
                          <option key={c.id} value={`cat:${c.id}`}>
                            {c.nombre}{c.subcategoria ? ` · ${c.subcategoria}` : ''}
                          </option>
                        ))}
                      </optgroup>
                      {categoriaActual && (
                        <optgroup label="➕ Crear nuevo">
                          <option value={`new:${categoriaActual}`}>+ Crear subcategoría en {categorias.find((c) => c.id === categoriaActual)?.nombre}…</option>
                        </optgroup>
                      )}
                    </select>
                    {matchingId === l.id && <span className="text-muted" style={{ fontSize: 10 }}>…</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.6 }}>
          💡 <strong>Ingrediente</strong> → afecta receta + COGS real + suma stock. <strong>Item contable</strong> → solo afecta P&L de gastos (software, servicios, mantenimiento, etc.).<br />
          {!categoriaActual && <span className="text-warning">⚠ Primero seleccioná Categoría contable arriba para filtrar items y poder crear subcategorías.</span>}
        </div>
      </div>
    </div>
  );
}
