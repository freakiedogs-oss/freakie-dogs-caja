import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';
import { verAmonestacionPdf } from '@/lib/amonestacionPdf';

// ============================================================
// /amonestaciones — Registro de incidentes con empleados
// ------------------------------------------------------------
// 5 tipos: verbal · escrita · suspension · descuento · reconocimiento
// El reconocimiento (positivo) está incluido para balancear — no todo
// son incidentes negativos.
//
// Roles: manager/admin/socio crean. Empleado ve solo las SUYAS (RLS).
// Si tipo='descuento' con monto_descuento, se puede aplicar a planilla.
// ============================================================

interface AmonestacionRow {
  id: string;
  empleado_id: string;
  fecha: string;
  tipo: 'verbal' | 'escrita' | 'suspension' | 'descuento' | 'reconocimiento';
  motivo: string;
  detalle: string | null;
  monto_descuento: number | null;
  reportado_por: string | null;
  empleado_firmo: boolean | null;
  fecha_firma: string | null;
  resuelto: boolean | null;
  fecha_resolucion: string | null;
  notas_resolucion: string | null;
  empleado_nombre: string;
  empleado_cargo: string | null;
}

interface EmpleadoOpt {
  id: string;
  nombre: string;
  cargo: string | null;
}

const TIPOS = [
  { value: 'verbal',         label: 'Verbal',          emoji: '💬', color: '#f5b400' },
  { value: 'escrita',        label: 'Escrita',         emoji: '✍',  color: '#f5b400' },
  { value: 'suspension',     label: 'Suspensión',      emoji: '⏸',  color: 'var(--state-danger,#e74c3c)' },
  { value: 'descuento',      label: 'Descuento',       emoji: '💸', color: 'var(--state-danger,#e74c3c)' },
  { value: 'reconocimiento', label: 'Reconocimiento',  emoji: '⭐', color: 'var(--accent-kaeru)' }
];

const TIPO_META: Record<string, typeof TIPOS[number]> = Object.fromEntries(TIPOS.map((t) => [t.value, t])) as any;

export default function Amonestaciones() {
  const { session } = useSession();
  const toast = useToast();
  const [items, setItems]     = useState<AmonestacionRow[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<AmonestacionRow | null>(null);
  const [filterTipo, setFilterTipo] = useState<string | null>(null);
  const [filterPendientes, setFilterPendientes] = useState(false);
  const [tick, setTick] = useState(0);

  const puedeCrear = session?.rol && ['super_admin','admin','manager','socio_operativo'].includes(session.rol);
  const puedeEditar = session?.rol && ['super_admin','admin','manager'].includes(session.rol);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [a, e] = await Promise.all([
          kaeru.from('v_amonestaciones_full').select('*').limit(500),
          kaeru.from('empleados').select('id,nombre,cargo').eq('activo', true).order('nombre')
        ]);
        if (cancel) return;
        if (a.error) throw a.error;
        if (e.error) throw e.error;
        setItems((a.data || []) as unknown as AmonestacionRow[]);
        setEmpleados((e.data || []) as unknown as EmpleadoOpt[]);
      } catch (err: any) {
        if (!cancel) setError(err?.message || String(err));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [tick]);

  const visibles = items.filter((i) => {
    if (filterTipo && i.tipo !== filterTipo) return false;
    if (filterPendientes && i.resuelto) return false;
    return true;
  });

  const counts = {
    total:    items.length,
    pendientes: items.filter((i) => !i.resuelto).length,
    verbal:   items.filter((i) => i.tipo === 'verbal').length,
    escrita:  items.filter((i) => i.tipo === 'escrita').length,
    suspension: items.filter((i) => i.tipo === 'suspension').length,
    descuento: items.filter((i) => i.tipo === 'descuento').length,
    reconocimiento: items.filter((i) => i.tipo === 'reconocimiento').length
  };
  const totalDescuentos = items.filter((i) => i.tipo === 'descuento' && !i.resuelto)
                              .reduce((s, i) => s + Number(i.monto_descuento || 0), 0);

  return (
    <PageShell
      kanji="罰"
      titulo="Amonestaciones"
      subtitulo={`${items.length} registros · ${counts.pendientes} sin resolver`}
      badge={
        counts.pendientes > 0
          ? { label: `${counts.pendientes} pendientes`, variant: 'warning' }
          : { label: '✓ Todo resuelto', variant: 'kaeru' }
      }
      actions={
        puedeCrear
          ? <button onClick={() => setCreating(true)} className="btn btn-kaeru btn-sm">+ Reportar incidente</button>
          : undefined
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && (
        <>
          {/* KPIs */}
          <div className="card-grid card-grid-4">
            <div className="card">
              <div className="card-title">Pendientes</div>
              <div className="metric-xl text-warning">{counts.pendientes}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>sin resolver</div>
            </div>
            <div className="card">
              <div className="card-title">Descuentos pendientes</div>
              <div className="metric-xl text-danger">{formatUSD(totalDescuentos)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>aplicar a planilla</div>
            </div>
            <div className="card">
              <div className="card-title">Reconocimientos</div>
              <div className="metric-xl text-kaeru">{counts.reconocimiento}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>positivos ⭐</div>
            </div>
            <div className="card">
              <div className="card-title">Suspensiones</div>
              <div className="metric-xl text-danger">{counts.suspension}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>histórico</div>
            </div>
          </div>

          {/* Filtros */}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setFilterTipo(null)} className={`btn btn-sm ${filterTipo === null ? 'btn-kaeru' : 'btn-outline'}`}>
              Todos ({counts.total})
            </button>
            {TIPOS.map((t) => {
              const n = items.filter((i) => i.tipo === t.value).length;
              if (n === 0) return null;
              return (
                <button key={t.value} onClick={() => setFilterTipo(t.value)} className={`btn btn-sm ${filterTipo === t.value ? 'btn-kaeru' : 'btn-outline'}`}>
                  {t.emoji} {t.label} ({n})
                </button>
              );
            })}
            <label className="row" style={{ gap: 6, fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto', cursor: 'pointer' }}>
              <input type="checkbox" checked={filterPendientes} onChange={(e) => setFilterPendientes(e.target.checked)} />
              Solo pendientes
            </label>
          </div>

          {/* Lista */}
          {visibles.length === 0 ? (
            <EmptyCard message={items.length === 0 ? 'Sin amonestaciones registradas todavía.' : 'No hay registros con esos filtros.'} />
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {visibles.map((a) => (
                <AmonestacionRowCard key={a.id} a={a} onClick={() => setEditing(a)} />
              ))}
            </div>
          )}

          {/* Drawer crear */}
          {creating && (
            <Drawer open onClose={() => setCreating(false)} title="Reportar incidente / reconocimiento">
              <CrearForm
                empleados={empleados}
                onClose={() => setCreating(false)}
                onSaved={() => {
                  setCreating(false);
                  setTick((x) => x + 1);
                  toast.success('✓ Registrado');
                }}
                reportadoPor={session?.email || ''}
              />
            </Drawer>
          )}

          {/* Drawer detalle/editar */}
          {editing && (
            <Drawer open onClose={() => setEditing(null)} title={`${TIPO_META[editing.tipo]?.emoji} ${editing.empleado_nombre}`}>
              <DetalleForm
                a={editing}
                puedeEditar={!!puedeEditar}
                onClose={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  setTick((x) => x + 1);
                  toast.success('✓ Actualizado');
                }}
              />
            </Drawer>
          )}
        </>
      )}
    </PageShell>
  );
}

// ============================================================
function AmonestacionRowCard({ a, onClick }: { a: AmonestacionRow; onClick: () => void }) {
  const meta = TIPO_META[a.tipo] || TIPO_META.verbal;
  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        cursor: 'pointer',
        borderLeft: `4px solid ${meta.color}`,
        opacity: a.resuelto ? 0.6 : 1
      }}
    >
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>{meta.emoji}</span>
            <strong>{a.empleado_nombre}</strong>
            <span className="text-muted" style={{ fontSize: 11 }}>{a.empleado_cargo}</span>
            <span className="badge" style={{ background: meta.color, color: 'var(--bg-base)', fontSize: 10 }}>{meta.label}</span>
            {a.monto_descuento != null && a.monto_descuento > 0 && (
              <span className="badge badge-danger" style={{ fontSize: 10 }}>−{formatUSD(a.monto_descuento)}</span>
            )}
            {a.resuelto && <span className="badge badge-kaeru" style={{ fontSize: 10 }}>✓ resuelto</span>}
            {a.empleado_firmo && <span className="badge badge-purple" style={{ fontSize: 10 }}>✍ firmado</span>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{a.motivo}</div>
          {a.detalle && (
            <div className="text-muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
              {a.detalle.length > 140 ? a.detalle.slice(0, 140) + '…' : a.detalle}
            </div>
          )}
        </div>
        <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>
          {formatDate(a.fecha)}
          {a.reportado_por && <div style={{ fontSize: 10, marginTop: 2 }}>por {a.reportado_por.split('@')[0]}</div>}
        </div>
      </div>
    </div>
  );
}

function CrearForm({ empleados, onClose, onSaved, reportadoPor }: {
  empleados: EmpleadoOpt[];
  onClose: () => void;
  onSaved: () => void;
  reportadoPor: string;
}) {
  const toast = useToast();
  const [empleadoId, setEmpleadoId] = useState('');
  const [tipo, setTipo] = useState<'verbal' | 'escrita' | 'suspension' | 'descuento' | 'reconocimiento'>('verbal');
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [monto, setMonto] = useState('');
  const [saving, setSaving] = useState(false);

  async function guardar() {
    if (!empleadoId || !motivo.trim()) {
      toast.warning('Empleado y motivo son obligatorios');
      return;
    }
    setSaving(true);
    const { error } = await kaeru.from('amonestaciones').insert({
      empleado_id: empleadoId,
      tipo,
      motivo: motivo.trim(),
      detalle: detalle.trim() || null,
      monto_descuento: tipo === 'descuento' ? Number(monto) || 0 : null,
      reportado_por: reportadoPor
    });
    setSaving(false);
    if (error) { toast.error('Error: ' + error.message); return; }
    onSaved();
  }

  return (
    <div className="stack">
      <Campo label="Empleado">
        <select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} className="ki-input">
          <option value="">— seleccionar —</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre} ({e.cargo || '—'})</option>
          ))}
        </select>
      </Campo>

      <Campo label="Tipo">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {TIPOS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTipo(t.value as any)}
              className={`btn btn-sm ${tipo === t.value ? 'btn-kaeru' : 'btn-outline'}`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </Campo>

      <Campo label="Motivo (1 línea)">
        <input
          type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder={tipo === 'reconocimiento' ? 'Ej: Excelente atención al cliente en mesa 8' : 'Ej: Llegada tarde 45 min sin aviso'}
          className="ki-input"
        />
      </Campo>

      <Campo label="Detalle (opcional)">
        <textarea
          value={detalle} onChange={(e) => setDetalle(e.target.value)}
          rows={3} placeholder="Contexto adicional, qué se conversó, plan de acción…"
          className="ki-input"
          style={{ resize: 'vertical' }}
        />
      </Campo>

      {tipo === 'descuento' && (
        <Campo label="Monto descuento USD">
          <input
            type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)}
            placeholder="0.00"
            className="ki-input"
          />
          <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
            Se descontará de la próxima planilla quincenal del empleado.
          </div>
        </Campo>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button onClick={onClose} disabled={saving} className="btn btn-ghost btn-sm">Cancelar</button>
        <button onClick={guardar} disabled={saving} className="btn btn-kaeru">
          {saving ? '● Guardando…' : '✓ Registrar'}
        </button>
      </div>
    </div>
  );
}

function DetalleForm({ a, puedeEditar, onClose, onSaved }: {
  a: AmonestacionRow;
  puedeEditar: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [empleadoFirmo, setEmpleadoFirmo] = useState(!!a.empleado_firmo);
  const [resuelto, setResuelto]   = useState(!!a.resuelto);
  const [notasResolucion, setNotasResolucion] = useState(a.notas_resolucion || '');
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setSaving(true);
    const cambios: any = {
      empleado_firmo: empleadoFirmo,
      fecha_firma: empleadoFirmo && !a.empleado_firmo ? new Date().toISOString() : a.fecha_firma,
      resuelto,
      fecha_resolucion: resuelto && !a.resuelto ? new Date().toISOString().split('T')[0] : a.fecha_resolucion,
      notas_resolucion: notasResolucion.trim() || null
    };
    const { error } = await kaeru.from('amonestaciones').update(cambios).eq('id', a.id);
    setSaving(false);
    if (error) { toast.error('Error: ' + error.message); return; }
    onSaved();
  }

  const meta = TIPO_META[a.tipo];

  return (
    <div className="stack">
      <div className="card" style={{ borderLeft: `4px solid ${meta.color}` }}>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>{meta.emoji}</span>
          <strong>{meta.label}</strong>
          <span className="text-muted" style={{ fontSize: 11 }}>{formatDate(a.fecha)}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{a.motivo}</div>
        {a.detalle && (
          <div className="text-muted" style={{ fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {a.detalle}
          </div>
        )}
        {a.monto_descuento != null && a.monto_descuento > 0 && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="badge badge-danger">−{formatUSD(a.monto_descuento)}</span>
            <span className="text-muted" style={{ fontSize: 11 }}>descuento a aplicar en planilla</span>
          </div>
        )}
        <div className="text-muted" style={{ fontSize: 10, marginTop: 8 }}>
          Reportado por {a.reportado_por || '—'}
        </div>
      </div>

      <button
        onClick={() => verAmonestacionPdf({
          empleado_nombre: a.empleado_nombre,
          empleado_cargo:  a.empleado_cargo,
          fecha:           a.fecha,
          tipo:            a.tipo,
          motivo:          a.motivo,
          detalle:         a.detalle,
          monto_descuento: a.monto_descuento,
          reportado_por:   a.reportado_por,
          empleado_firmo:  a.empleado_firmo,
          fecha_firma:     a.fecha_firma
        }, () => toast.warning('Permití las ventanas emergentes'))}
        className="btn btn-outline btn-sm"
      >
        📄 Imprimir / PDF
      </button>

      {puedeEditar ? (
        <>
          <Campo label="">
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={empleadoFirmo} onChange={(e) => setEmpleadoFirmo(e.target.checked)} />
              <span style={{ fontSize: 13 }}>✍ Empleado firmó / acuse de recibo</span>
            </label>
          </Campo>

          <Campo label="">
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={resuelto} onChange={(e) => setResuelto(e.target.checked)} />
              <span style={{ fontSize: 13 }}>✓ Marcar como resuelto</span>
            </label>
          </Campo>

          {resuelto && (
            <Campo label="Notas de resolución">
              <textarea
                value={notasResolucion} onChange={(e) => setNotasResolucion(e.target.value)}
                rows={3} placeholder="Cómo se cerró el incidente…"
                className="ki-input"
                style={{ resize: 'vertical' }}
              />
            </Campo>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button onClick={onClose} disabled={saving} className="btn btn-ghost btn-sm">Cerrar</button>
            <button onClick={guardar} disabled={saving} className="btn btn-kaeru">
              {saving ? '● Guardando…' : '✓ Guardar cambios'}
            </button>
          </div>
        </>
      ) : (
        <div className="text-muted" style={{ fontSize: 12 }}>Solo manager+ puede editar.</div>
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      {label && (
        <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
