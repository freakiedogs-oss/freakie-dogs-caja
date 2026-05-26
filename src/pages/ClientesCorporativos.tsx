import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { formatDate } from '@/lib/utils';

interface ClienteCorp {
  id: string;
  nombre_razon_social: string;
  nit: string | null;
  nrc: string | null;
  dui: string | null;
  id_extranjero: string | null;
  primer_uso_at: string;
  ultimo_uso_at: string;
  notas: string | null;
}

interface VentaCount {
  cliente_corporativo_id: string | null;
  conteo: number;
  total: number;
}

export default function ClientesCorporativos() {
  const [data, setData] = useState<ClienteCorp[]>([]);
  const [conteos, setConteos] = useState<Record<string, { ccfs: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editando, setEditando] = useState<ClienteCorp | null>(null);
  const [creando, setCreando] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data: clientes, error: e } = await kaeru.from('cliente_corporativo')
        .select('*')
        .order('ultimo_uso_at', { ascending: false });
      if (cancel) return;
      if (e) { setError(e.message); setLoading(false); return; }
      setData((clientes || []) as ClienteCorp[]);

      // Conteo de CCFs por cliente
      const { data: vts } = await kaeru.from('ventas')
        .select('cliente_corporativo_id,total')
        .not('cliente_corporativo_id', 'is', null);
      if (cancel) return;
      const map: Record<string, { ccfs: number; total: number }> = {};
      for (const v of (vts || []) as VentaCount[]) {
        const id = v.cliente_corporativo_id as string;
        if (!map[id]) map[id] = { ccfs: 0, total: 0 };
        map[id].ccfs += 1;
        map[id].total += Number(v.total || 0);
      }
      setConteos(map);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  const filtrados = data.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.nombre_razon_social.toLowerCase().includes(q)
      || (c.nit || '').toLowerCase().includes(q)
      || (c.nrc || '').toLowerCase().includes(q);
  });

  async function handleGuardar(c: ClienteCorp) {
    const { error: e } = await kaeru.from('cliente_corporativo')
      .update({
        nombre_razon_social: c.nombre_razon_social,
        nit: c.nit || null,
        nrc: c.nrc || null,
        dui: c.dui || null,
        id_extranjero: c.id_extranjero || null,
        notas: c.notas || null
      })
      .eq('id', c.id);
    if (e) { alert('Error: ' + e.message); return; }
    setEditando(null);
    setReloadKey((k) => k + 1);
  }

  async function handleCrear(c: Omit<ClienteCorp, 'id' | 'primer_uso_at' | 'ultimo_uso_at'>) {
    const { error: e } = await kaeru.from('cliente_corporativo').insert({
      nombre_razon_social: c.nombre_razon_social,
      nit: c.nit || null,
      nrc: c.nrc || null,
      dui: c.dui || null,
      id_extranjero: c.id_extranjero || null,
      notas: c.notas || null
    });
    if (e) { alert('Error: ' + e.message); return; }
    setCreando(false);
    setReloadKey((k) => k + 1);
  }

  return (
    <PageShell
      kanji="客"
      titulo="Clientes Corporativos"
      subtitulo={`${data.length} clientes con NIT/NRC para emisión de Créditos Fiscales (CCF)`}
      actions={<button className="btn btn-kaeru" onClick={() => setCreando(true)}>+ Nuevo cliente</button>}
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}
      {!loading && !error && (
        <>
          <input className="ki-input" placeholder="🔍 Buscar por nombre, NIT o NRC..."
            value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 12 }} />

          {filtrados.length === 0 ? (
            <EmptyCard message={search ? 'Sin resultados' : 'No hay clientes corporativos registrados todavía'} />
          ) : (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)' }}>
                    <th style={th}>Razón social</th>
                    <th style={th}>NIT</th>
                    <th style={th}>NRC</th>
                    <th style={th}>CCFs emitidos</th>
                    <th style={th}>Último uso</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((c) => {
                    const stats = conteos[c.id] || { ccfs: 0, total: 0 };
                    return (
                      <tr key={c.id} onClick={() => setEditando(c)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{c.nombre_razon_social}</div>
                          {c.notas && <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>{c.notas}</div>}
                        </td>
                        <td style={td}>{c.nit || '—'}</td>
                        <td style={td}>{c.nrc || '—'}</td>
                        <td style={td}>
                          {stats.ccfs > 0 ? (
                            <span className="text-kaeru" style={{ fontWeight: 600 }}>{stats.ccfs}</span>
                          ) : <span className="text-muted">—</span>}
                          {stats.total > 0 && <span className="text-muted" style={{ fontSize: 10, marginLeft: 4 }}>(${stats.total.toFixed(0)})</span>}
                        </td>
                        <td style={td}>
                          <span className="text-muted" style={{ fontSize: 11 }}>{formatDate(c.ultimo_uso_at)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editando && (
        <ModalCliente
          cliente={editando}
          onClose={() => setEditando(null)}
          onSave={handleGuardar}
        />
      )}

      {creando && (
        <ModalCliente
          cliente={{
            id: '',
            nombre_razon_social: '',
            nit: '', nrc: '', dui: '', id_extranjero: '',
            primer_uso_at: '', ultimo_uso_at: '',
            notas: ''
          }}
          esNuevo
          onClose={() => setCreando(false)}
          onSave={(c) => handleCrear(c)}
        />
      )}
    </PageShell>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)' };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };

// ============================================================================
function ModalCliente({ cliente, esNuevo, onClose, onSave }: {
  cliente: ClienteCorp;
  esNuevo?: boolean;
  onClose: () => void;
  onSave: (c: ClienteCorp) => void;
}) {
  const [form, setForm] = useState<ClienteCorp>({ ...cliente });
  const [saving, setSaving] = useState(false);

  function update<K extends keyof ClienteCorp>(k: K, v: ClienteCorp[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function handleSubmit() {
    if (!form.nombre_razon_social.trim()) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-lg)', padding: 24, maxWidth: 520, width: '100%',
        maxHeight: '90vh', overflow: 'auto'
      }}>
        <div className="row-between" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {esNuevo ? '+ Nuevo cliente corporativo' : 'Editar cliente'}
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        <div className="stack-sm">
          <Field label="Razón social *">
            <input className="ki-input" value={form.nombre_razon_social} onChange={(e) => update('nombre_razon_social', e.target.value)} autoFocus />
          </Field>

          <div className="row" style={{ gap: 8 }}>
            <Field label="NIT" style={{ flex: 1 }}>
              <input className="ki-input" value={form.nit || ''} onChange={(e) => update('nit', e.target.value)} placeholder="0614-..." />
            </Field>
            <Field label="NRC" style={{ flex: 1 }}>
              <input className="ki-input" value={form.nrc || ''} onChange={(e) => update('nrc', e.target.value)} placeholder="123456-7" />
            </Field>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <Field label="DUI (consumidor final)" style={{ flex: 1 }}>
              <input className="ki-input" value={form.dui || ''} onChange={(e) => update('dui', e.target.value)} placeholder="00000000-0" />
            </Field>
            <Field label="ID extranjero" style={{ flex: 1 }}>
              <input className="ki-input" value={form.id_extranjero || ''} onChange={(e) => update('id_extranjero', e.target.value)} />
            </Field>
          </div>

          <Field label="Notas">
            <textarea className="ki-input" rows={2} value={form.notas || ''} onChange={(e) => update('notas', e.target.value)} placeholder="Ej: cliente recurrente, alianza, etc." />
          </Field>
        </div>

        <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-kaeru" onClick={handleSubmit} disabled={saving || !form.nombre_razon_social.trim()}>
            {saving ? 'Guardando…' : esNuevo ? '+ Crear' : '✓ Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <div className="text-muted" style={{ fontSize: 11, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
