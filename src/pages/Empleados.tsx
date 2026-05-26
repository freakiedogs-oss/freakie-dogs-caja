import { useEffect, useState, FormEvent } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { formatUSD, formatDate } from '@/lib/utils';

interface Empleado {
  id: string;
  nombre: string;
  apellido: string | null;
  dui: string | null;
  email: string | null;
  telefono: string | null;
  cargo: string | null;
  pin: number | null;
  fecha_ingreso: string | null;
  fecha_salida: string | null;
  motivo_salida: string | null;
  salario_base: number | null;
  isss_pct: number | null;
  afp_pct: number | null;
  activo: boolean;
  aparece_en_horario: boolean;
  pendiente_formalizacion: boolean;
  fecha_formalizacion: string | null;
  notas_legal: string | null;
  banco: string | null;
  cuenta_bancaria: string | null;
  tipo_cuenta: string | null;
  tipo_contrato: string | null;
  contacto_emergencia_nombre: string | null;
  contacto_emergencia_telefono: string | null;
  direccion: string | null;
  numero_isss: string | null;
  numero_afp: string | null;
  aguinaldo_proporcional: number | null;
}

const CARGOS = ['gerencial', 'manager', 'jefe_cocina', 'cocinero', 'mesero', 'steward', 'apoyo', 'otro'];
const TIPOS_CONTRATO = ['indefinido', 'temporal', 'aprendiz', 'pasantia', 'honorarios'];
const TIPOS_CUENTA = ['ahorro', 'corriente', 'planilla'];
const BANCOS = ['Banco Agrícola', 'Banco Cuscatlán', 'BAC', 'Banco Promerica', 'Banco Davivienda', 'Banco Hipotecario', 'EFECTIVO', 'Otro'];

const cargoColor = (cargo: string | null) => {
  if (cargo === 'manager') return 'badge-kaeru';
  if (cargo === 'jefe_cocina' || cargo === 'gerencial') return 'badge-purple';
  return 'badge-muted';
};

const empleadoVacio: Partial<Empleado> = {
  nombre: '', apellido: '', dui: '', email: '', telefono: '', cargo: 'mesero', pin: null,
  fecha_ingreso: new Date().toISOString().slice(0, 10),
  salario_base: 480, isss_pct: 3, afp_pct: 7.25,
  activo: true, aparece_en_horario: true, pendiente_formalizacion: false,
  banco: '', cuenta_bancaria: '', tipo_cuenta: 'ahorro', tipo_contrato: 'indefinido'
};

export default function Empleados() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Empleado> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error: e } = await kaeru.from('empleados').select('*').order('activo', { ascending: false }).order('nombre');
      if (cancel) return;
      if (e) { setError(e.message); setLoading(false); return; }
      setEmpleados((data || []) as unknown as Empleado[]);
      setError(null);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  const activos = empleados.filter((e) => e.activo);
  const inactivos = empleados.filter((e) => !e.activo);
  const pendientesLegal = empleados.filter((e) => e.activo && e.pendiente_formalizacion);

  const refresh = () => setReloadKey((k) => k + 1);

  return (
    <PageShell
      kanji="人"
      titulo="Empleados"
      subtitulo={`${empleados.length} registros · ${activos.length} activos · ${inactivos.length} inactivos`}
      badge={pendientesLegal.length > 0 ? { label: `⚠️ ${pendientesLegal.length} sin formalizar`, variant: 'warning' } : { label: '✓ Compliance OK', variant: 'kaeru' }}
      actions={<button className="btn btn-kaeru" onClick={() => setEditing({ ...empleadoVacio })}>+ Nuevo empleado</button>}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <>
          <div className="card-grid card-grid-3">
            <div className="card"><div className="card-title">Activos</div><div className="metric-xl text-kaeru">{activos.length}</div></div>
            <div className="card"><div className="card-title">Inactivos / Salidos</div><div className="metric-xl text-muted">{inactivos.length}</div></div>
            <div className="card"><div className="card-title">Sin formalizar</div><div className="metric-xl text-warning">{pendientesLegal.length}</div></div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Plantilla completa</div>
              <span className="badge badge-muted">Click → editar</span>
            </div>
            {empleados.length === 0 ? <EmptyCard message="Sin empleados. Click + Nuevo empleado." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>DUI</th>
                      <th>Cargo</th>
                      <th style={{ textAlign: 'right' }}>Salario base</th>
                      <th>Ingreso</th>
                      <th>Banco / Cuenta</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empleados.map((e) => (
                      <tr key={e.id} onClick={() => setEditing(e)} style={{ cursor: 'pointer' }}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{e.nombre} {e.apellido ?? ''}</div>
                          {e.notas_legal && <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>{e.notas_legal.slice(0, 80)}</div>}
                        </td>
                        <td className="text-muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>{e.dui ?? '—'}</td>
                        <td><span className={`badge ${cargoColor(e.cargo)}`}>{e.cargo ?? '—'}</span></td>
                        <td style={{ textAlign: 'right' }}>{formatUSD(e.salario_base ?? 0)}</td>
                        <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(e.fecha_ingreso)}</td>
                        <td className="text-muted" style={{ fontSize: 11 }}>
                          {e.banco ?? '—'}<br />
                          <span className="text-dim">{e.cuenta_bancaria ?? '—'}</span>
                        </td>
                        <td>
                          {e.activo
                            ? <span className="badge badge-kaeru">Activo</span>
                            : <span className="badge badge-muted">Salió {e.fecha_salida ? formatDate(e.fecha_salida) : ''}</span>
                          }
                          {e.pendiente_formalizacion && e.activo && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Sin formalizar</span>}
                          {!e.aparece_en_horario && e.activo && <span className="badge badge-muted" style={{ marginLeft: 6 }}>Sin horario</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Editar · ${editing.nombre} ${editing.apellido ?? ''}` : 'Nuevo empleado'}>
        {editing && (
          <EmpleadoForm
            initial={editing}
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
function EmpleadoForm({ initial, onCancel, onSaved }: {
  initial: Partial<Empleado>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Partial<Empleado>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<'personal' | 'laboral' | 'comp' | 'banco' | 'compliance' | 'emergencia'>('personal');

  const isNew = !initial.id;
  const upd = (k: keyof Empleado, v: any) => setData((d) => ({ ...d, [k]: v }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);

    if (!data.nombre?.trim()) { setError('Nombre requerido'); setSaving(false); return; }

    // Normalizar campos vacíos → null
    const payload: any = { ...data };
    for (const k of Object.keys(payload)) {
      if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
    }
    // No mandar id en insert
    if (isNew) delete payload.id;
    delete payload.created_at;

    if (isNew) {
      const { error: e1 } = await kaeru.from('empleados').insert(payload);
      if (e1) { setError(e1.message); setSaving(false); return; }
    } else {
      const { error: e1 } = await kaeru.from('empleados').update(payload).eq('id', data.id);
      if (e1) { setError(e1.message); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  }

  const sections: Array<{ key: typeof section; label: string; icon: string }> = [
    { key: 'personal',   label: 'Personal',     icon: '👤' },
    { key: 'laboral',    label: 'Laboral',      icon: '💼' },
    { key: 'comp',       label: 'Compensación', icon: '💰' },
    { key: 'banco',      label: 'Bancario',     icon: '🏦' },
    { key: 'compliance', label: 'Compliance',   icon: '📋' },
    { key: 'emergencia', label: 'Emergencia',   icon: '🚨' }
  ];

  const f = (label: string, child: any, hint?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      <span className="card-title">{label}</span>
      {child}
      {hint && <span className="text-dim" style={{ fontSize: 10 }}>{hint}</span>}
    </label>
  );

  return (
    <form onSubmit={handleSubmit} className="stack-sm">
      {/* Section tabs */}
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8, marginBottom: 8 }}>
        {sections.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)} style={{
            padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: section === s.key ? 'rgba(95,224,169,0.15)' : 'transparent',
            border: `1px solid ${section === s.key ? 'var(--accent-kaeru)' : 'var(--border-default)'}`,
            color: section === s.key ? 'var(--accent-kaeru)' : 'var(--text-muted)'
          }}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {/* ============= PERSONAL ============= */}
      {section === 'personal' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>{f('Nombre *', <input className="ki-input" required value={data.nombre || ''} onChange={(e) => upd('nombre', e.target.value)} />)}</div>
            <div style={{ flex: 1 }}>{f('Apellido', <input className="ki-input" value={data.apellido || ''} onChange={(e) => upd('apellido', e.target.value)} />)}</div>
          </div>
          {f('DUI', <input className="ki-input" value={data.dui || ''} onChange={(e) => upd('dui', e.target.value)} placeholder="00000000-0" style={{ fontFamily: 'monospace' }} />, 'Formato: 8 dígitos + guión + dígito verificador')}
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>{f('Email', <input className="ki-input" type="email" value={data.email || ''} onChange={(e) => upd('email', e.target.value)} />)}</div>
            <div style={{ flex: 1 }}>{f('Teléfono', <input className="ki-input" value={data.telefono || ''} onChange={(e) => upd('telefono', e.target.value)} placeholder="+503 0000-0000" />)}</div>
          </div>
          {f('Dirección', <textarea className="ki-input" rows={2} value={data.direccion || ''} onChange={(e) => upd('direccion', e.target.value)} />)}
        </>
      )}

      {/* ============= LABORAL ============= */}
      {section === 'laboral' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>{f('Cargo *', (
              <select className="ki-input" value={data.cargo || 'mesero'} onChange={(e) => upd('cargo', e.target.value)}>
                {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ))}</div>
            <div style={{ flex: 1 }}>{f('Tipo de contrato', (
              <select className="ki-input" value={data.tipo_contrato || 'indefinido'} onChange={(e) => upd('tipo_contrato', e.target.value)}>
                {TIPOS_CONTRATO.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ))}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>{f('Fecha de ingreso', <input className="ki-input" type="date" value={data.fecha_ingreso || ''} onChange={(e) => upd('fecha_ingreso', e.target.value)} />)}</div>
            <div style={{ flex: 1 }}>{f('Fecha de salida', <input className="ki-input" type="date" value={data.fecha_salida || ''} onChange={(e) => upd('fecha_salida', e.target.value)} />, 'Si tiene salida, desactivar activo')}</div>
          </div>
          {data.fecha_salida && f('Motivo de salida', <input className="ki-input" value={data.motivo_salida || ''} onChange={(e) => upd('motivo_salida', e.target.value)} />)}

          <div className="stack-xs" style={{ background: 'var(--bg-inset)', padding: 10, borderRadius: 6, marginBottom: 10 }}>
            <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={!!data.activo} onChange={(e) => upd('activo', e.target.checked)} />
              <span><strong>Activo</strong> — recibe planilla, aparece en queries activas</span>
            </label>
            <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={!!data.aparece_en_horario} onChange={(e) => upd('aparece_en_horario', e.target.checked)} />
              <span><strong>Aparece en /horarios</strong> — desmarcar para socios/manager/admin</span>
            </label>
            <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={!!data.pendiente_formalizacion} onChange={(e) => upd('pendiente_formalizacion', e.target.checked)} />
              <span><strong>Pendiente formalización legal</strong> — sin ISSS/AFP activo, riesgo MTPS</span>
            </label>
          </div>
          {data.pendiente_formalizacion && f('Fecha planeada formalización', <input className="ki-input" type="date" value={data.fecha_formalizacion || ''} onChange={(e) => upd('fecha_formalizacion', e.target.value)} />)}
          {f('Notas legales', <textarea className="ki-input" rows={2} value={data.notas_legal || ''} onChange={(e) => upd('notas_legal', e.target.value)} />, 'Cualquier observación de RRHH')}
        </>
      )}

      {/* ============= COMPENSACIÓN ============= */}
      {section === 'comp' && (
        <>
          {f('Salario base mensual *', <input className="ki-input" type="number" step="0.01" value={data.salario_base ?? ''} onChange={(e) => upd('salario_base', e.target.value === '' ? null : Number(e.target.value))} />, 'USD mensual. Quincenal = salario/2')}
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>{f('ISSS %', <input className="ki-input" type="number" step="0.01" value={data.isss_pct ?? ''} onChange={(e) => upd('isss_pct', e.target.value === '' ? null : Number(e.target.value))} />, 'Default 3% El Salvador')}</div>
            <div style={{ flex: 1 }}>{f('AFP %', <input className="ki-input" type="number" step="0.01" value={data.afp_pct ?? ''} onChange={(e) => upd('afp_pct', e.target.value === '' ? null : Number(e.target.value))} />, 'Default 7.25%')}</div>
          </div>
          {f('Aguinaldo proporcional', <input className="ki-input" type="number" step="0.01" value={data.aguinaldo_proporcional ?? ''} onChange={(e) => upd('aguinaldo_proporcional', e.target.value === '' ? null : Number(e.target.value))} />, 'Calculable al cierre del año')}
          {f('PIN POS (4 dígitos)', <input className="ki-input" type="number" maxLength={4} value={data.pin ?? ''} onChange={(e) => upd('pin', e.target.value === '' ? null : Number(e.target.value))} placeholder="Ej: 4221" />, 'Para marcaje de entrada en tablet')}
        </>
      )}

      {/* ============= BANCO ============= */}
      {section === 'banco' && (
        <>
          {f('Banco', (
            <select className="ki-input" value={data.banco || ''} onChange={(e) => upd('banco', e.target.value)}>
              <option value="">— Sin definir —</option>
              {BANCOS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ))}
          {f('Número de cuenta', <input className="ki-input" value={data.cuenta_bancaria || ''} onChange={(e) => upd('cuenta_bancaria', e.target.value)} style={{ fontFamily: 'monospace' }} />)}
          {f('Tipo de cuenta', (
            <select className="ki-input" value={data.tipo_cuenta || 'ahorro'} onChange={(e) => upd('tipo_cuenta', e.target.value)}>
              {TIPOS_CUENTA.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ))}
          <div className="card" style={{ background: 'rgba(154,111,209,0.08)', borderColor: 'rgba(154,111,209,0.3)', padding: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            💡 Esta cuenta es a donde se envían planilla (T365) y propinas (T365). Si es a nombre de un tercero, anótalo en notas legales.
          </div>
        </>
      )}

      {/* ============= COMPLIANCE ============= */}
      {section === 'compliance' && (
        <>
          {f('Número ISSS', <input className="ki-input" value={data.numero_isss || ''} onChange={(e) => upd('numero_isss', e.target.value)} style={{ fontFamily: 'monospace' }} placeholder="Ej: 123003867" />)}
          {f('Número AFP', <input className="ki-input" value={data.numero_afp || ''} onChange={(e) => upd('numero_afp', e.target.value)} style={{ fontFamily: 'monospace' }} placeholder="Ej: 0575865-0" />, 'Confía o Crecer')}
        </>
      )}

      {/* ============= EMERGENCIA ============= */}
      {section === 'emergencia' && (
        <>
          {f('Nombre contacto emergencia', <input className="ki-input" value={data.contacto_emergencia_nombre || ''} onChange={(e) => upd('contacto_emergencia_nombre', e.target.value)} />)}
          {f('Teléfono contacto emergencia', <input className="ki-input" value={data.contacto_emergencia_telefono || ''} onChange={(e) => upd('contacto_emergencia_telefono', e.target.value)} placeholder="+503 0000-0000" />)}
        </>
      )}

      {/* Error + actions */}
      {error && (
        <div style={{ background: 'rgba(200,80,74,0.1)', border: '1px solid var(--state-danger)', borderRadius: 'var(--r-md)', padding: 10, fontSize: 11, color: 'var(--state-danger)', marginTop: 10 }}>
          {error}
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn btn-kaeru" disabled={saving}>
          {saving ? 'Guardando…' : isNew ? 'Crear empleado' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
