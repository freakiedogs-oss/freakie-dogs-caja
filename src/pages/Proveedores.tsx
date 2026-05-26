import { useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { useKaeruQuery } from '@/hooks/useKaeruQuery';
import { kaeru } from '@/lib/supabase';

interface Proveedor {
  id: string;
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  dias_credito: number | null;
  activo: boolean;
}

interface CuentaTercero {
  id: string;
  cuenta_numero: string;
  banco: string | null;
  nombre_titular: string;
  relacion_tipo: string;
  proveedor_id: string | null;
  notas: string | null;
  activo: boolean;
}

export default function Proveedores() {
  const provQ = useKaeruQuery<Proveedor>('proveedores', { orderBy: { column: 'nombre', ascending: true }, limit: 200 });
  const ctaQ = useKaeruQuery<CuentaTercero>('cuentas_bancarias_terceros', { orderBy: { column: 'nombre_titular', ascending: true }, limit: 200 });

  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loading = provQ.loading || ctaQ.loading;
  const error = provQ.error || ctaQ.error;

  const cuentasPorProv: Record<string, CuentaTercero[]> = {};
  ctaQ.data.forEach((c) => {
    if (c.proveedor_id) {
      if (!cuentasPorProv[c.proveedor_id]) cuentasPorProv[c.proveedor_id] = [];
      cuentasPorProv[c.proveedor_id].push(c);
    }
  });

  const cuentasSinProv = ctaQ.data.filter((c) => !c.proveedor_id);

  async function handleSave(updated: Proveedor) {
    setSaving(true);
    try {
      const { error: e } = await kaeru
        .from('proveedores')
        .update({
          nombre: updated.nombre,
          nit: updated.nit,
          contacto: updated.contacto,
          telefono: updated.telefono,
          email: updated.email,
          dias_credito: updated.dias_credito,
          activo: updated.activo
        })
        .eq('id', updated.id);
      if (e) { alert('Error guardando: ' + e.message); }
      else {
        setEditing(null);
        setReloadKey(reloadKey + 1);
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      kanji="商"
      titulo="Proveedores"
      subtitulo={`${provQ.count} proveedores · ${ctaQ.count} cuentas BAC catalogadas — Click en una fila para editar`}
      badge={{ label: 'Live · Editable', variant: 'kaeru' }}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error!} /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card"><div className="card-title">Proveedores</div><div className="metric-xl text-kaeru">{provQ.count}</div></div>
            <div className="card"><div className="card-title">Cuentas BAC</div><div className="metric-xl">{ctaQ.count}</div></div>
            <div className="card"><div className="card-title">Cuentas s/ FK proveedor</div><div className="metric-xl text-warning">{cuentasSinProv.length}</div></div>
            <div className="card"><div className="card-title">Activos</div><div className="metric-xl text-kaeru">{provQ.data.filter((p) => p.activo).length}</div></div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Catálogo de proveedores</div>
              <span className="badge badge-muted">Click → editar</span>
            </div>
            {provQ.data.length === 0 ? <EmptyCard message="Sin proveedores" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>NIT</th>
                      <th>Cuenta BAC</th>
                      <th>Contacto</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provQ.data.map((p) => {
                      const ctas = cuentasPorProv[p.id] || [];
                      return (
                        <tr
                          key={p.id}
                          onClick={() => setEditing(p)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                            {p.contacto && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{p.contacto}</div>}
                          </td>
                          <td className="text-muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>{p.nit ?? '—'}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {ctas.length === 0 ? <span className="text-dim">—</span> : ctas.map((c) => c.cuenta_numero).join(', ')}
                          </td>
                          <td className="text-muted" style={{ fontSize: 11 }}>
                            {p.telefono ?? ''} {p.email ? `· ${p.email}` : ''}
                          </td>
                          <td>{p.activo ? <span className="badge badge-kaeru">Activo</span> : <span className="badge badge-muted">Inactivo</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {cuentasSinProv.length > 0 && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Cuentas terceras sin FK a proveedor ({cuentasSinProv.length})</div>
                <span className="badge badge-muted">Socios, ejecutivas, inter-empresa, empleados</span>
              </div>
              <table className="table">
                <thead>
                  <tr><th>Cuenta</th><th>Titular</th><th>Relación</th><th>Activa</th></tr>
                </thead>
                <tbody>
                  {cuentasSinProv.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.cuenta_numero}</td>
                      <td>{c.nombre_titular}</td>
                      <td><span className={`badge badge-${c.relacion_tipo === 'socio' ? 'kaeru' : c.relacion_tipo === 'inter_empresa' ? 'purple' : 'muted'}`}>{c.relacion_tipo}</span></td>
                      <td>{c.activo ? '✓' : '✗'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing ? `Editar · ${editing.nombre}` : ''}>
        {editing && (
          <ProveedorForm
            initial={editing}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={handleSave}
          />
        )}
      </Drawer>
    </PageShell>
  );
}

function ProveedorForm({ initial, saving, onCancel, onSave }: { initial: Proveedor; saving: boolean; onCancel: () => void; onSave: (p: Proveedor) => void }) {
  const [form, setForm] = useState<Proveedor>(initial);

  const update = (k: keyof Proveedor, v: any) => setForm((s) => ({ ...s, [k]: v }));

  return (
    <div className="stack-sm">
      <Field label="Nombre">
        <input className="ki-input" value={form.nombre} onChange={(e) => update('nombre', e.target.value)} />
      </Field>
      <Field label="NIT">
        <input className="ki-input" value={form.nit ?? ''} onChange={(e) => update('nit', e.target.value || null)} />
      </Field>
      <Field label="Contacto">
        <textarea className="ki-input" rows={3} value={form.contacto ?? ''} onChange={(e) => update('contacto', e.target.value || null)} />
      </Field>
      <Field label="Teléfono">
        <input className="ki-input" value={form.telefono ?? ''} onChange={(e) => update('telefono', e.target.value || null)} />
      </Field>
      <Field label="Email">
        <input className="ki-input" type="email" value={form.email ?? ''} onChange={(e) => update('email', e.target.value || null)} />
      </Field>
      <Field label="Días de crédito">
        <input className="ki-input" type="number" value={form.dias_credito ?? 0} onChange={(e) => update('dias_credito', Number(e.target.value))} />
      </Field>
      <Field label="Estado">
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={`btn btn-sm ${form.activo ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => update('activo', true)}>Activo</button>
          <button type="button" className={`btn btn-sm ${!form.activo ? 'btn-danger' : 'btn-outline'}`} onClick={() => update('activo', false)}>Inactivo</button>
        </div>
      </Field>

      <div className="row" style={{ marginTop: 20, gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-kaeru" onClick={() => onSave(form)} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="card-title">{label}</span>
      {children}
    </label>
  );
}
