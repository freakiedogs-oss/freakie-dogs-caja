import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { APP_VERSION } from '@/lib/version';
import { formatUSD } from '@/lib/utils';

// ============================================================
// /configuracion — Datos del negocio, sucursal, integraciones,
// tasas y schedule. Solo socio/admin pueden EDITAR.
// ============================================================

interface Empresa {
  id: string;
  nombre_comercial: string | null;
  razon_social: string | null;
  nit: string | null;
  nrc: string | null;
  giro_primario: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  moneda: string | null;
  iva_pct: number | null;
  timezone: string | null;
}

interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  capacidad_mesas: number | null;
  capacidad_pax: number | null;
  horario_apertura: string | null;
  horario_cierre: string | null;
  dias_operacion: string[] | null;
  fondo_caja: number | null;
  renta_mensual: number | null;
  activa: boolean | null;
}

const TASAS_FIJAS = {
  iva_pct: 13,
  isss_empleado_pct: 3,
  isss_patrono_pct: 7.5,
  afp_empleado_pct: 7.25,
  afp_patrono_pct: 7.75,
  peya_comision_pct: 24,
  propina_sugerida_pct: 10,
  bac_comision_pos_pct: 4.5
};

const CRONS_INFO = [
  { nombre: 'gmail_dte_to_supabase_kaeru', schedule: 'Cada 30 min', proposito: 'Ingest DTEs proveedor desde Gmail', estado: 'Productivo' },
  { nombre: 'cron_planilla_kaeru', schedule: 'Diario 7am, ejecuta solo días 1 y 16', proposito: 'Cálculo automático de planilla quincenal', estado: 'Productivo' },
  { nombre: 'cron_notif_barrer', schedule: 'Cada 30 min', proposito: 'Inbox in-app — evalúa 5 generadores y alerta Telegram', estado: 'Productivo (v0.9.0)' },
  { nombre: 'cron_alerta_pos_bac', schedule: 'Diario 11pm', proposito: 'Alerta si no se hizo cierre POS BAC del día', estado: 'Pendiente activar' },
  { nombre: 'cron_stock_bajo', schedule: 'Cada 6h', proposito: 'Alerta de ingredientes bajo mínimo', estado: 'Pendiente activar (depende stock real)' },
  { nombre: 'cron_cierre_diario', schedule: 'Diario 11pm', proposito: 'Resumen de cierre del día', estado: 'Pendiente activar' }
];

const INTEGRACIONES = [
  { nombre: 'Supabase', detalle: 'Schema kaeru en proyecto btboxlwfqcbrdfrlnwln', url: 'https://supabase.com/dashboard/project/btboxlwfqcbrdfrlnwln', estado: 'OK' },
  { nombre: 'Vercel', detalle: 'kaeru-chan-erp.vercel.app', url: 'https://vercel.com/freakiedogs-oss/kaeru-chan-erp', estado: 'OK' },
  { nombre: 'GitHub', detalle: 'freakiedogs-oss/kaeru-chan-erp (privado)', url: 'https://github.com/freakiedogs-oss/kaeru-chan-erp', estado: 'OK' },
  { nombre: 'Apps Script', detalle: 'Kaeru Chan ERP — Automation (compartido con Freakies)', url: 'https://script.google.com', estado: 'OK' },
  { nombre: 'Telegram bot', detalle: '@FreakieDogsMonitor → chat 8547715106', url: 'https://t.me/FreakieDogsMonitor', estado: 'OK' },
  { nombre: 'PedidosYa', detalle: 'Único delivery 3rd party · comisión 24% · liquidación viernes', url: null, estado: 'OK' }
];

export default function Configuracion() {
  const { session } = useSession();
  const toast = useToast();
  const [empresa,   setEmpresa]   = useState<Empresa | null>(null);
  const [sucursal,  setSucursal]  = useState<Sucursal | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [editing,   setEditing]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [draftEmpresa, setDraftEmpresa] = useState<Partial<Empresa>>({});

  const puedeEditar = session?.rol === 'super_admin' || session?.rol === 'admin' || session?.rol === 'socio';

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [ep, sc] = await Promise.all([
          kaeru.from('empresa').select('*').limit(1).maybeSingle(),
          kaeru.from('sucursales').select('*').eq('activa', true).limit(1).maybeSingle()
        ]);
        if (cancel) return;
        if (ep.error) throw ep.error;
        if (sc.error) throw sc.error;
        setEmpresa(ep.data as unknown as Empresa);
        setSucursal(sc.data as unknown as Sucursal);
      } catch (e: any) {
        if (!cancel) setError(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  function startEdit() {
    if (!empresa) return;
    setDraftEmpresa({ ...empresa });
    setEditing(true);
  }

  async function saveEmpresa() {
    if (!empresa) return;
    setSaving(true);
    const { error: err } = await kaeru
      .from('empresa')
      .update({
        nombre_comercial: draftEmpresa.nombre_comercial,
        telefono:         draftEmpresa.telefono,
        email:            draftEmpresa.email,
        direccion:        draftEmpresa.direccion
      })
      .eq('id', empresa.id);
    setSaving(false);
    if (err) {
      toast.error('No se pudo guardar: ' + err.message);
      return;
    }
    toast.success('Datos de empresa actualizados ✓');
    setEmpresa({ ...empresa, ...draftEmpresa });
    setEditing(false);
  }

  return (
    <PageShell
      kanji="設"
      titulo="Configuración"
      subtitulo="Empresa, sucursal, integraciones, tasas y schedule de automatizaciones"
      badge={{ label: APP_VERSION, variant: 'muted' }}
      actions={
        puedeEditar && !editing && empresa
          ? <button onClick={startEdit} className="btn btn-outline btn-sm">✏ Editar empresa</button>
          : undefined
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && (
        <>
          {/* Empresa */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">🏢 Empresa</div>
              {editing && (
                <div className="row" style={{ gap: 8 }}>
                  <button onClick={() => setEditing(false)} className="btn btn-ghost btn-sm" disabled={saving}>Cancelar</button>
                  <button onClick={saveEmpresa} className="btn btn-kaeru btn-sm" disabled={saving}>{saving ? '● Guardando…' : '✓ Guardar'}</button>
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <Field label="Razón social" value={empresa?.razon_social} />
              <Field label="NIT" value={empresa?.nit} mono />
              <Field label="NRC" value={empresa?.nrc} mono />
              <Field label="Giro" value={empresa?.giro_primario} />
              <Field label="Moneda" value={empresa?.moneda || 'USD'} />
              <Field label="IVA" value={`${empresa?.iva_pct ?? 13}%`} />
              <Field label="Timezone" value={empresa?.timezone || 'America/El_Salvador'} mono />
              {editing
                ? <EditField label="Nombre comercial"
                    value={draftEmpresa.nombre_comercial ?? ''}
                    onChange={(v) => setDraftEmpresa((d) => ({ ...d, nombre_comercial: v }))} />
                : <Field label="Nombre comercial" value={empresa?.nombre_comercial} />}
              {editing
                ? <EditField label="Teléfono / WhatsApp"
                    value={draftEmpresa.telefono ?? ''}
                    onChange={(v) => setDraftEmpresa((d) => ({ ...d, telefono: v }))} />
                : <Field label="Teléfono / WhatsApp" value={empresa?.telefono} />}
              {editing
                ? <EditField label="Email corporativo"
                    value={draftEmpresa.email ?? ''}
                    onChange={(v) => setDraftEmpresa((d) => ({ ...d, email: v }))} />
                : <Field label="Email corporativo" value={empresa?.email} />}
            </div>
            {editing && (
              <div style={{ marginTop: 12 }}>
                <EditField label="Dirección" multiline
                  value={draftEmpresa.direccion ?? ''}
                  onChange={(v) => setDraftEmpresa((d) => ({ ...d, direccion: v }))} />
              </div>
            )}
            {!editing && empresa?.direccion && (
              <Field label="Dirección" value={empresa.direccion} block />
            )}
          </div>

          {/* Sucursal */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">🏪 Sucursal {sucursal?.codigo}</div>
              <span className="badge badge-kaeru">{sucursal?.activa ? 'Activa' : 'Inactiva'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Field label="Código" value={sucursal?.codigo} mono />
              <Field label="Nombre" value={sucursal?.nombre} />
              <Field label="Capacidad" value={`${sucursal?.capacidad_mesas ?? '—'} mesas / ${sucursal?.capacidad_pax ?? '—'} pax`} />
              <Field label="Horario" value={`${sucursal?.horario_apertura?.slice(0,5) ?? '—'} – ${sucursal?.horario_cierre?.slice(0,5) ?? '—'}`} />
              <Field label="Días" value={(sucursal?.dias_operacion ?? []).join(', ')} />
              <Field label="Fondo de caja" value={sucursal?.fondo_caja != null ? formatUSD(sucursal.fondo_caja) : '—'} />
              <Field label="Renta mensual" value={sucursal?.renta_mensual != null ? formatUSD(sucursal.renta_mensual) : '—'} />
            </div>
            {sucursal?.direccion && (
              <Field label="Dirección" value={sucursal.direccion} block />
            )}
          </div>

          {/* Tasas fijas (read-only, vienen de ley o contrato) */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">📊 Tasas aplicadas</div>
              <span className="badge badge-muted">Hardcoded — actualizar via PR</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Tasa label="IVA Hacienda" value={`${TASAS_FIJAS.iva_pct}%`} nota="Incluido en precios de venta" />
              <Tasa label="ISSS empleado" value={`${TASAS_FIJAS.isss_empleado_pct}%`} nota="Tope $1,000 salario" />
              <Tasa label="ISSS patrono" value={`${TASAS_FIJAS.isss_patrono_pct}%`} nota="A cargo de Kaeru" />
              <Tasa label="AFP empleado" value={`${TASAS_FIJAS.afp_empleado_pct}%`} nota="Confía o Crecer" />
              <Tasa label="AFP patrono" value={`${TASAS_FIJAS.afp_patrono_pct}%`} nota="A cargo de Kaeru" />
              <Tasa label="PeYa comisión" value={`${TASAS_FIJAS.peya_comision_pct}%`} nota="Liquida viernes" />
              <Tasa label="Propina sugerida" value={`${TASAS_FIJAS.propina_sugerida_pct}%`} nota="Modificable en POS al cobrar" />
              <Tasa label="BAC POS comisión" value={`${TASAS_FIJAS.bac_comision_pos_pct}%`} nota="Estimado — confirmar contrato" />
            </div>
          </div>

          {/* Integraciones */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">🔗 Integraciones</div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Sistema</th>
                  <th>Detalle</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {INTEGRACIONES.map((i) => (
                  <tr key={i.nombre}>
                    <td style={{ fontWeight: 600 }}>{i.nombre}</td>
                    <td style={{ fontSize: 12 }}>
                      {i.detalle}{' '}
                      {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-purple" style={{ fontSize: 11 }}>→ abrir</a>}
                    </td>
                    <td>
                      <span className={`badge ${i.estado === 'OK' ? 'badge-kaeru' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                        {i.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Schedule de crons Apps Script */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">⏰ Schedule Apps Script</div>
              <span className="badge badge-purple">Kaeru Chan ERP — Automation</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Cron</th>
                    <th>Schedule</th>
                    <th>Propósito</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {CRONS_INFO.map((c) => {
                    const productivo = c.estado.startsWith('Productivo');
                    return (
                      <tr key={c.nombre}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.nombre}</td>
                        <td style={{ fontSize: 11 }}>{c.schedule}</td>
                        <td style={{ fontSize: 11 }}>{c.proposito}</td>
                        <td>
                          <span className={`badge ${productivo ? 'badge-kaeru' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                            {productivo ? '✓' : '⏳'} {c.estado.replace('Productivo', 'Live')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Telegram */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">📲 Telegram</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <Field label="Bot" value="@FreakieDogsMonitor" mono />
              <Field label="Chat" value="8547715106" mono />
              <Field label="Modo" value="DM directo a Jose (compartido con alertas DevOps Freakies)" />
            </div>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
              📌 Cuando exista grupo dedicado de socios Kaeru, cambiar <code>KAERU_TG_CHAT_ID</code> en <code>cron_notif_barrer.gs</code>.
            </div>
          </div>

          {/* Datos sistema */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>📦 Sistema</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              • <strong>Versión:</strong> {APP_VERSION}<br />
              • <strong>App:</strong> https://kaeru-chan-erp.vercel.app<br />
              • <strong>Schema BD:</strong> <code>kaeru</code> en proyecto Supabase compartido con Freakies<br />
              • <strong>Mono-sucursal:</strong> KC01 (Kaeru Chan EPIC Plaza)<br />
              • <strong>Mono-tenant:</strong> sin lógica de empresa_id en queries — el schema da el aislamiento<br />
              • <strong>RLS:</strong> activa en todas las tablas. Policy `_self_read` permite a authenticated leer su propia fila en user_roles
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

// ============================================================
function Field({ label, value, mono, block }: { label: string; value: any; mono?: boolean; block?: boolean }) {
  return (
    <div style={block ? { gridColumn: '1 / -1', marginTop: 8 } : undefined}>
      <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{
        fontSize: 13,
        marginTop: 2,
        fontFamily: mono ? 'monospace' : 'inherit',
        color: value ? 'var(--text-primary)' : 'var(--text-muted)'
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div style={multiline ? { gridColumn: '1 / -1' } : undefined}>
      <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          style={{
            width: '100%',
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-md)',
            padding: '8px 10px',
            color: 'var(--text-primary)',
            fontSize: 13
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-md)',
            padding: '8px 10px',
            color: 'var(--text-primary)',
            fontSize: 13
          }}
        />
      )}
    </div>
  );
}

function Tasa({ label, value, nota }: { label: string; value: string; nota: string }) {
  return (
    <div>
      <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 18, fontFamily: 'var(--font-metric)', fontWeight: 700, marginTop: 2, color: 'var(--accent-kaeru)' }}>{value}</div>
      <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>{nota}</div>
    </div>
  );
}
