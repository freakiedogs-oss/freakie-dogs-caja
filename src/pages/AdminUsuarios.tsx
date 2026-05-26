import { useState, useEffect, FormEvent } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

interface UserRole {
  email: string;
  pin: string | null;
  rol: string;
  nombre_display: string;
  activo: boolean;
  notas: string | null;
  created_at: string;
  updated_at: string;
  empleado_id: string | null;
}

interface EmpleadoOpt {
  id: string;
  nombre: string;
}

const PIN_SETUP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kaeru-pin-setup`;
const SETUP_SECRET = 'kaeru-pin-setup-2026';

const ROLES = [
  'super_admin', 'admin',
  'socio_operativo', 'socio_inversor',
  'manager', 'jefe_cocina',
  'mesero', 'cocinero', 'steward'
];

export default function AdminUsuarios() {
  const { session } = useSession();
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error: e } = await kaeru
        .from('user_roles')
        .select('*')
        .order('rol', { ascending: true });
      if (cancel) return;
      if (e) { setError(e.message); setLoading(false); return; }
      setUsers((data || []) as UserRole[]);
      setError(null);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  // Guard adicional: solo super_admin
  if (session && session.rol !== 'super_admin') {
    return (
      <PageShell kanji="🔒" titulo="Acceso Restringido" subtitulo="Solo super_admin">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="text-muted">Tu rol actual ({session.rol}) no tiene permisos para administrar usuarios.</p>
        </div>
      </PageShell>
    );
  }

  const refresh = () => setReloadKey((k) => k + 1);

  return (
    <PageShell
      kanji="管"
      titulo="Administración de Usuarios"
      subtitulo="Whitelist · PINs · Roles · Solo super_admin tiene acceso"
      badge={{ label: 'Super Admin', variant: 'purple' }}
      actions={<button className="btn btn-kaeru" onClick={() => setCreating(true)}>+ Nuevo Usuario</button>}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card">
              <div className="card-title">Usuarios totales</div>
              <div className="metric-xl text-kaeru">{users.length}</div>
            </div>
            <div className="card">
              <div className="card-title">Activos</div>
              <div className="metric-xl">{users.filter((u) => u.activo).length}</div>
            </div>
            <div className="card">
              <div className="card-title">Super Admins</div>
              <div className="metric-xl text-purple">{users.filter((u) => u.rol === 'super_admin').length}</div>
            </div>
            <div className="card">
              <div className="card-title">Roles distintos</div>
              <div className="metric-xl">{new Set(users.map((u) => u.rol)).size}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Whitelist de usuarios</div>
              <span className="badge badge-muted">Click → editar</span>
            </div>
            {users.length === 0 ? <EmptyCard message="Sin usuarios registrados" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Email</th>
                      <th>PIN</th>
                      <th>Rol</th>
                      <th>Activo</th>
                      <th>Última actualización</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.email} onClick={() => setEditing(u)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600 }}>{u.nombre_display}</td>
                        <td className="text-muted" style={{ fontSize: 12 }}>{u.email}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 14 }}>
                          {u.pin ?? <span className="text-dim">—</span>}
                        </td>
                        <td>
                          <span className={`badge badge-${u.rol === 'super_admin' || u.rol === 'admin' ? 'purple' : u.rol.startsWith('socio') ? 'kaeru' : 'muted'}`}>
                            {u.rol}
                          </span>
                        </td>
                        <td>{u.activo ? <span className="badge badge-kaeru">Activo</span> : <span className="badge badge-danger">Inactivo</span>}</td>
                        <td className="text-muted" style={{ fontSize: 11 }}>{formatDate(u.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>Cómo funciona la auth</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              • Cada usuario tiene un <strong>PIN único de 6 dígitos</strong> que sirve también como password en <code>auth.users</code><br />
              • Al cambiar/asignar PIN aquí, el sistema <strong>sincroniza automáticamente</strong> con auth.users via edge function <code>kaeru-pin-setup</code><br />
              • <strong>Convenciones de PIN:</strong> 100xxx super_admin/admin · 200xxx socios · 300xxx manager/cocina · 400xxx meseros/steward<br />
              • Solo super_admin puede ver/editar esta página y los PINs<br />
              • Para <strong>desactivar a alguien</strong>: toggle "Activo" → el usuario no podrá hacer login pero su histórico queda<br />
              • Para <strong>cambiar PIN</strong>: edita el campo PIN en el form de edición → al guardar se sincroniza auth.users
            </div>
          </div>
        </>
      )}

      <Drawer open={!!editing || creating} onClose={() => { setEditing(null); setCreating(false); }} title={creating ? 'Nuevo Usuario' : editing ? `Editar · ${editing.nombre_display}` : ''}>
        {(editing || creating) && (
          <UserForm
            initial={editing}
            isCreating={creating}
            onCancel={() => { setEditing(null); setCreating(false); }}
            onSaved={() => { setEditing(null); setCreating(false); refresh(); }}
          />
        )}
      </Drawer>
    </PageShell>
  );
}

function UserForm({ initial, isCreating, onCancel, onSaved }: {
  initial: UserRole | null;
  isCreating: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(initial?.email ?? '');
  const [nombre, setNombre] = useState(initial?.nombre_display ?? '');
  const [pin, setPin] = useState(initial?.pin ?? '');
  const [rol, setRol] = useState(initial?.rol ?? 'mesero');
  const [activo, setActivo] = useState(initial?.activo ?? true);
  const [notas, setNotas] = useState(initial?.notas ?? '');
  const [empleadoId, setEmpleadoId] = useState<string | ''>(initial?.empleado_id ?? '');
  const [empleados, setEmpleados] = useState<EmpleadoOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar empleados activos para el selector
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await kaeru.from('empleados').select('id,nombre').eq('activo', true).order('nombre');
      if (!cancel) setEmpleados(((data || []) as any[]).map((e) => ({ id: e.id, nombre: e.nombre })));
    })();
    return () => { cancel = true; };
  }, []);

  const generateRandomPin = () => {
    const prefix = rol === 'super_admin' || rol === 'admin' ? '1'
      : rol.startsWith('socio') ? '2'
      : rol === 'manager' || rol === 'jefe_cocina' ? '3'
      : '4';
    const suffix = String(Math.floor(Math.random() * 90000) + 10000); // 5 dígitos
    setPin(prefix + suffix);
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    if (!/^[0-9]{6}$/.test(pin)) {
      setError('PIN debe ser exactamente 6 dígitos numéricos');
      setSaving(false);
      return;
    }

    try {
      if (isCreating) {
        const { error: e1 } = await kaeru.from('user_roles').insert({
          email, pin, rol, nombre_display: nombre, activo, notas: notas || null,
          empleado_id: empleadoId || null
        });
        if (e1) { setError(e1.message); setSaving(false); return; }
      } else {
        const { error: e1 } = await kaeru.from('user_roles').update({
          pin, rol, nombre_display: nombre, activo, notas: notas || null,
          empleado_id: empleadoId || null
        }).eq('email', email);
        if (e1) { setError(e1.message); setSaving(false); return; }
      }

      // Sincronizar con auth.users (password = pin)
      const resp = await fetch(PIN_SETUP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-setup-secret': SETUP_SECRET },
        body: JSON.stringify({ email, pin })
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Error sync auth' }));
        setError(`Guardado en user_roles pero error sync auth.users: ${body.error}`);
        setSaving(false);
        return;
      }

      onSaved();
    } catch (e: any) {
      setError(String(e?.message || e));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="stack-sm">
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">Email *</span>
        <input className="ki-input" type="email" required disabled={!isCreating} value={email} onChange={(e) => setEmail(e.target.value)} />
        {!isCreating && <span className="text-dim" style={{ fontSize: 10 }}>El email no se puede cambiar (es la primary key)</span>}
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">Nombre display *</span>
        <input className="ki-input" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">Rol *</span>
        <select className="ki-input" value={rol} onChange={(e) => setRol(e.target.value)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">PIN (6 dígitos) *</span>
        <div className="row" style={{ gap: 6 }}>
          <input className="ki-input" required pattern="[0-9]{6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 4, flex: 1 }} />
          <button type="button" className="btn btn-outline btn-sm" onClick={generateRandomPin}>↻ Random</button>
        </div>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">Empleado vinculado</span>
        <select className="ki-input" value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
          <option value="">— Sin vincular (admin sin operación) —</option>
          {empleados.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
        </select>
        <span className="text-dim" style={{ fontSize: 10 }}>
          Necesario para meseros/cocineros: el POS asocia ventas y propinas a este empleado.
        </span>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">Notas</span>
        <textarea className="ki-input" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title">Estado</span>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={`btn btn-sm ${activo ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => setActivo(true)}>Activo</button>
          <button type="button" className={`btn btn-sm ${!activo ? 'btn-danger' : 'btn-outline'}`} onClick={() => setActivo(false)}>Inactivo</button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(200,80,74,0.1)', border: '1px solid var(--state-danger)', borderRadius: 'var(--r-md)', padding: 10, fontSize: 11, color: 'var(--state-danger)' }}>
          {error}
        </div>
      )}

      <div className="row" style={{ marginTop: 16, gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn btn-kaeru" disabled={saving}>
          {saving ? 'Guardando…' : isCreating ? 'Crear usuario' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
