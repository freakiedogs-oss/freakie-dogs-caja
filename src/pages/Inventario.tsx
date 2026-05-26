import { useEffect, useState, FormEvent, useMemo } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { formatUSD } from '@/lib/utils';

interface Ingrediente {
  id: string;
  codigo: string;
  nombre: string;
  unidad: string;
  precio_costo: number | null;
  stock_actual: number;
  stock_minimo: number | null;
  proveedor_default: string | null;
  proveedor_default_id: string | null;
  tipo: string | null;
  notas: string | null;
  activo: boolean;
}
interface Proveedor { id: string; nombre: string; }

const TIPOS = ['verdura', 'proteina', 'lacteo', 'cereales', 'condimentos', 'bebida', 'empaque', 'limpieza', 'otros'];
const UNIDADES = ['kg', 'g', 'lb', 'oz', 'L', 'ml', 'unidad', 'docena', 'caja', 'bolsa', 'paquete', 'galon'];

const TIPO_LABELS: Record<string, { icon: string; color: string }> = {
  verdura: { icon: '🥬', color: 'var(--accent-kaeru)' },
  proteina: { icon: '🥩', color: '#e74c3c' },
  lacteo: { icon: '🥛', color: '#f1c40f' },
  cereales: { icon: '🌾', color: '#d35400' },
  condimentos: { icon: '🧂', color: 'var(--accent-purple)' },
  bebida: { icon: '🥤', color: '#3498db' },
  empaque: { icon: '📦', color: 'var(--text-muted)' },
  limpieza: { icon: '🧴', color: '#16a085' },
  otros: { icon: '•', color: 'var(--text-muted)' }
};

const ingredienteVacio: Partial<Ingrediente> = {
  codigo: '', nombre: '', unidad: 'unidad',
  precio_costo: null, stock_actual: 0, stock_minimo: 0,
  tipo: 'otros', activo: true
};

export default function Inventario() {
  const [items, setItems] = useState<Ingrediente[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Ingrediente> | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [iRes, pRes] = await Promise.all([
        kaeru.from('ingredientes').select('*').order('nombre'),
        kaeru.from('proveedores').select('id,nombre').eq('activo', true).order('nombre')
      ]);
      if (cancel) return;
      if (iRes.error) { setError(iRes.error.message); setLoading(false); return; }
      setItems((iRes.data || []) as unknown as Ingrediente[]);
      setProveedores((pRes.data || []) as unknown as Proveedor[]);
      setError(null);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  const refresh = () => setReloadKey((k) => k + 1);

  const filtrados = useMemo(() => {
    return items.filter((i) => {
      if (filtroTipo !== 'todos' && i.tipo !== filtroTipo) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!i.nombre.toLowerCase().includes(s) && !i.codigo.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, filtroTipo, search]);

  const activos = items.filter((i) => i.activo);
  const conCosto = activos.filter((i) => i.precio_costo != null);
  const sinCosto = activos.filter((i) => i.precio_costo == null);
  const stockBajo = activos.filter((i) => i.stock_minimo != null && i.stock_actual < (i.stock_minimo || 0));
  const valorInventario = activos.reduce((s, i) => s + Number(i.precio_costo || 0) * Number(i.stock_actual || 0), 0);

  return (
    <PageShell
      kanji="在"
      titulo="Inventario"
      subtitulo={`${items.length} ingredientes · ${activos.length} activos · ${conCosto.length} con costo · ${sinCosto.length} pendientes`}
      badge={stockBajo.length > 0 ? { label: `⚠️ ${stockBajo.length} bajo mínimo`, variant: 'warning' } : { label: '✓ Stock OK', variant: 'kaeru' }}
      actions={<button className="btn btn-kaeru" onClick={() => setEditing({ ...ingredienteVacio })}>+ Nuevo ingrediente</button>}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card"><div className="card-title">Activos</div><div className="metric-xl text-kaeru">{activos.length}</div></div>
            <div className="card"><div className="card-title">Con costo unit.</div><div className="metric-xl">{conCosto.length}</div></div>
            <div className="card"><div className="card-title">Sin costo</div><div className="metric-xl text-warning">{sinCosto.length}</div></div>
            <div className="card"><div className="card-title">Valor inventario</div><div className="metric-xl">{formatUSD(valorInventario)}</div></div>
          </div>

          {/* Filtros */}
          <div className="card" style={{ padding: 10 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="ki-input" placeholder="🔍 Buscar nombre o código" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                <button className={`btn btn-sm ${filtroTipo === 'todos' ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => setFiltroTipo('todos')}>
                  Todos ({items.length})
                </button>
                {TIPOS.map((t) => {
                  const count = items.filter((i) => i.tipo === t).length;
                  if (count === 0) return null;
                  return (
                    <button key={t} className={`btn btn-sm ${filtroTipo === t ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => setFiltroTipo(t)}>
                      {TIPO_LABELS[t]?.icon} {t} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Catálogo ({filtrados.length})</div>
              <span className="badge badge-muted">Click → editar</span>
            </div>
            {filtrados.length === 0 ? <EmptyCard message="Sin ingredientes en este filtro. Click + Nuevo ingrediente." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Ingrediente</th>
                      <th>Tipo</th>
                      <th>Unidad</th>
                      <th style={{ textAlign: 'right' }}>Costo</th>
                      <th style={{ textAlign: 'right' }}>Stock</th>
                      <th style={{ textAlign: 'right' }}>Mínimo</th>
                      <th>Proveedor</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((i) => {
                      const bajo = i.stock_minimo != null && i.stock_actual < (i.stock_minimo || 0);
                      const tipoMeta = i.tipo ? TIPO_LABELS[i.tipo] : null;
                      const prov = proveedores.find((p) => p.id === i.proveedor_default_id);
                      return (
                        <tr key={i.id} onClick={() => setEditing(i)} style={{ cursor: 'pointer' }}>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{i.codigo}</td>
                          <td style={{ fontWeight: 600 }}>{i.nombre}</td>
                          <td>
                            {tipoMeta ? (
                              <span style={{ color: tipoMeta.color, fontSize: 11, fontWeight: 600 }}>
                                {tipoMeta.icon} {i.tipo}
                              </span>
                            ) : <span className="text-dim">—</span>}
                          </td>
                          <td><span className="badge badge-muted">{i.unidad}</span></td>
                          <td style={{ textAlign: 'right' }} className={i.precio_costo == null ? 'text-dim' : ''}>
                            {i.precio_costo != null ? formatUSD(i.precio_costo) : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }} className={bajo ? 'text-warning' : ''}>{Number(i.stock_actual || 0).toFixed(2)}</td>
                          <td style={{ textAlign: 'right' }} className="text-muted">{i.stock_minimo != null ? Number(i.stock_minimo).toFixed(2) : '—'}</td>
                          <td className="text-muted" style={{ fontSize: 11 }}>{prov?.nombre || i.proveedor_default || <span className="text-dim">—</span>}</td>
                          <td>
                            {bajo ? <span className="badge badge-warning">⚠ Bajo</span>
                              : i.activo ? <span className="badge badge-kaeru">Activo</span>
                              : <span className="badge badge-muted">Inactivo</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Editar · ${editing.nombre}` : 'Nuevo ingrediente'}>
        {editing && (
          <IngredienteForm
            initial={editing}
            proveedores={proveedores}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); refresh(); }}
          />
        )}
      </Drawer>
    </PageShell>
  );
}

// =============================================================================
// FORM
// =============================================================================
function IngredienteForm({ initial, proveedores, onCancel, onSaved }: {
  initial: Partial<Ingrediente>;
  proveedores: Proveedor[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Partial<Ingrediente>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = !initial.id;
  const upd = (k: keyof Ingrediente, v: any) => setData((d) => ({ ...d, [k]: v }));

  // Auto-código si nuevo y vacío
  useEffect(() => {
    if (isNew && !data.codigo && data.nombre) {
      const codigo = data.nombre.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (codigo) upd('codigo', codigo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.nombre]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);

    if (!data.nombre?.trim()) { setError('Nombre requerido'); setSaving(false); return; }
    if (!data.unidad?.trim()) { setError('Unidad requerida'); setSaving(false); return; }
    if (!data.codigo?.trim()) { setError('Código requerido'); setSaving(false); return; }

    const payload: any = { ...data };
    for (const k of Object.keys(payload)) {
      if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
    }
    if (isNew) delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;

    if (isNew) {
      const { error: e1 } = await kaeru.from('ingredientes').insert(payload);
      if (e1) { setError(e1.message); setSaving(false); return; }
    } else {
      const { error: e1 } = await kaeru.from('ingredientes').update(payload).eq('id', data.id);
      if (e1) { setError(e1.message); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  }

  const f = (label: string, child: any, hint?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      <span className="card-title">{label}</span>
      {child}
      {hint && <span className="text-dim" style={{ fontSize: 10 }}>{hint}</span>}
    </label>
  );

  return (
    <form onSubmit={handleSubmit} className="stack-sm">
      <div className="row" style={{ gap: 8 }}>
        <div style={{ flex: 2 }}>
          {f('Nombre *', <input className="ki-input" required value={data.nombre || ''} onChange={(e) => upd('nombre', e.target.value)} placeholder="Ej: Tomate de cocina rojo" />)}
        </div>
        <div style={{ flex: 1 }}>
          {f('Código *', <input className="ki-input" required value={data.codigo || ''} onChange={(e) => upd('codigo', e.target.value.toUpperCase())} placeholder="Auto" style={{ fontFamily: 'monospace' }} />, 'Auto del nombre. Editable.')}
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1 }}>
          {f('Tipo', (
            <select className="ki-input" value={data.tipo || 'otros'} onChange={(e) => upd('tipo', e.target.value)}>
              {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABELS[t]?.icon} {t}</option>)}
            </select>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {f('Unidad *', (
            <select className="ki-input" required value={data.unidad || ''} onChange={(e) => upd('unidad', e.target.value)}>
              <option value="">—</option>
              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          ), 'Unidad de uso en recetas')}
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1 }}>
          {f('Precio costo', <input className="ki-input" type="number" step="0.0001" value={data.precio_costo ?? ''} onChange={(e) => upd('precio_costo', e.target.value === '' ? null : Number(e.target.value))} placeholder="0.00" />, 'Por unidad. Se auto-actualiza con DTEs entrantes.')}
        </div>
        <div style={{ flex: 1 }}>
          {f('Stock actual', <input className="ki-input" type="number" step="0.001" value={data.stock_actual ?? 0} onChange={(e) => upd('stock_actual', Number(e.target.value))} />, 'Se suma al matchear líneas DTE.')}
        </div>
        <div style={{ flex: 1 }}>
          {f('Stock mínimo', <input className="ki-input" type="number" step="0.001" value={data.stock_minimo ?? ''} onChange={(e) => upd('stock_minimo', e.target.value === '' ? null : Number(e.target.value))} placeholder="—" />, 'Alerta Telegram si baja.')}
        </div>
      </div>

      {f('Proveedor default', (
        <select className="ki-input" value={data.proveedor_default_id || ''} onChange={(e) => upd('proveedor_default_id', e.target.value || null)}>
          <option value="">— Sin definir —</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      ), 'Proveedor preferido para este ingrediente')}

      {f('Notas', <textarea className="ki-input" rows={2} value={data.notas || ''} onChange={(e) => upd('notas', e.target.value)} placeholder="Ej: variedad importada, marca preferida, equivalencias" />)}

      <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 12, background: 'var(--bg-inset)', padding: 10, borderRadius: 6 }}>
        <input type="checkbox" checked={!!data.activo} onChange={(e) => upd('activo', e.target.checked)} />
        <span><strong>Activo</strong> — aparece en recetas y matcher DTE. Desmarcar si descontinuado.</span>
      </label>

      {error && (
        <div style={{ background: 'rgba(200,80,74,0.1)', border: '1px solid var(--state-danger)', borderRadius: 'var(--r-md)', padding: 10, fontSize: 11, color: 'var(--state-danger)' }}>
          {error}
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn btn-kaeru" disabled={saving}>
          {saving ? 'Guardando…' : isNew ? 'Crear ingrediente' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
