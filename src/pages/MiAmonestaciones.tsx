import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';
import { verAmonestacionPdf } from '@/lib/amonestacionPdf';

// ============================================================
// /mi-amonestaciones — Vista personal del empleado
// ------------------------------------------------------------
// El empleado ve SOLO sus propias amonestaciones (RLS por user_roles.empleado_id).
// Útil para que esté al tanto de su historial sin tener que pedírselo al manager.
// Si tiene amonestaciones tipo='descuento' sin aplicar todavía → ve el monto pendiente
// que va a salir en su próxima planilla.
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
  aplicada_en_planilla_id: string | null;
  aplicada_en_fecha: string | null;
}

interface EmpleadoRow {
  id: string;
  nombre: string;
  cargo: string | null;
  dui: string | null;
}

const TIPO_META: Record<string, { label: string; emoji: string; color: string; positivo: boolean }> = {
  verbal:         { label: 'Verbal',          emoji: '💬', color: '#f5b400',                   positivo: false },
  escrita:        { label: 'Escrita',         emoji: '✍',  color: '#f5b400',                   positivo: false },
  suspension:     { label: 'Suspensión',      emoji: '⏸',  color: 'var(--state-danger,#e74c3c)', positivo: false },
  descuento:      { label: 'Descuento',       emoji: '💸', color: 'var(--state-danger,#e74c3c)', positivo: false },
  reconocimiento: { label: 'Reconocimiento',  emoji: '⭐', color: 'var(--accent-kaeru)',        positivo: true  },
};

export default function MiAmonestaciones() {
  const { session } = useSession();
  const toast = useToast();
  const [empleado, setEmpleado] = useState<EmpleadoRow | null>(null);
  const [items, setItems]       = useState<AmonestacionRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    if (!session) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Resolver empleado
        let empleadoId = session.empleado_id;
        let empData: EmpleadoRow | null = null;
        if (empleadoId) {
          const { data, error: err } = await kaeru.from('empleados')
            .select('id,nombre,cargo,dui').eq('id', empleadoId).maybeSingle();
          if (err) throw err;
          empData = data as unknown as EmpleadoRow;
        }
        if (!empData && session.email) {
          const { data, error: err } = await kaeru.from('empleados')
            .select('id,nombre,cargo,dui').eq('email', session.email).maybeSingle();
          if (err) throw err;
          empData = data as unknown as EmpleadoRow;
          if (empData) empleadoId = empData.id;
        }
        if (cancel) return;
        if (!empData || !empleadoId) {
          setEmpleado(null);
          setItems([]);
          setLoading(false);
          return;
        }
        setEmpleado(empData);

        // 2. Cargar mis amonestaciones (RLS filtra automático)
        const { data: rows, error: rErr } = await kaeru
          .from('amonestaciones')
          .select('*')
          .eq('empleado_id', empleadoId)
          .order('fecha', { ascending: false });
        if (cancel) return;
        if (rErr) throw rErr;
        setItems((rows || []) as unknown as AmonestacionRow[]);
      } catch (e: any) {
        if (!cancel) setError(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [session]);

  function abrirPdf(a: AmonestacionRow) {
    if (!empleado) return;
    verAmonestacionPdf({
      empleado_nombre: empleado.nombre,
      empleado_cargo:  empleado.cargo,
      empleado_dui:    empleado.dui,
      fecha:           a.fecha,
      tipo:            a.tipo,
      motivo:          a.motivo,
      detalle:         a.detalle,
      monto_descuento: a.monto_descuento,
      reportado_por:   a.reportado_por,
      empleado_firmo:  a.empleado_firmo,
      fecha_firma:     a.fecha_firma
    }, () => toast.warning('Permití las ventanas emergentes para abrir el documento'));
  }

  // Stats
  const total          = items.length;
  const sinFirmar      = items.filter((i) => !i.empleado_firmo && !i.resuelto).length;
  const descuentosPend = items.filter((i) => i.tipo === 'descuento' && i.aplicada_en_planilla_id == null)
                              .reduce((s, i) => s + Number(i.monto_descuento || 0), 0);
  const reconocimientos = items.filter((i) => i.tipo === 'reconocimiento').length;

  return (
    <PageShell
      kanji="罰"
      titulo="Mis Amonestaciones"
      subtitulo={empleado ? `${empleado.nombre} · ${total} registros` : 'Mis registros'}
      badge={
        sinFirmar > 0
          ? { label: `${sinFirmar} sin firmar`, variant: 'warning' }
          : descuentosPend > 0
          ? { label: `−${formatUSD(descuentosPend)} pendientes en planilla`, variant: 'danger' }
          : { label: '✓ todo al día', variant: 'kaeru' }
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && !empleado && (
        <div className="card" style={{ borderColor: 'rgba(245,180,0,0.3)' }}>
          <div className="card-title text-warning" style={{ marginBottom: 8 }}>⚠ Empleado no vinculado</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Tu usuario <code>{session?.email}</code> no está vinculado a un empleado en la BD.<br />
            Contactá a Yessica o Jose para que mapeen tu cuenta a tu registro en <code>kaeru.empleados</code>.
          </div>
        </div>
      )}

      {!loading && !error && empleado && (
        <>
          {/* KPIs */}
          <div className="card-grid card-grid-4">
            <div className="card">
              <div className="card-title">Total registros</div>
              <div className="metric-xl">{total}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>histórico completo</div>
            </div>
            <div className="card">
              <div className="card-title">Sin firmar / acuse</div>
              <div className="metric-xl text-warning">{sinFirmar}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>pendientes de tu firma</div>
            </div>
            <div className="card">
              <div className="card-title">Descuentos pendientes</div>
              <div className="metric-xl text-danger">{formatUSD(descuentosPend)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>se aplican en próxima planilla</div>
            </div>
            <div className="card">
              <div className="card-title">⭐ Reconocimientos</div>
              <div className="metric-xl text-kaeru">{reconocimientos}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>buen trabajo</div>
            </div>
          </div>

          {/* Card si hay descuentos pendientes — alerta clara */}
          {descuentosPend > 0 && (
            <div className="card" style={{ borderColor: 'var(--state-danger,#e74c3c)', borderLeftWidth: 4 }}>
              <div className="card-title text-danger" style={{ marginBottom: 8 }}>💸 Descuentos pendientes</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                Tenés <strong>{formatUSD(descuentosPend)}</strong> en descuentos que se aplicarán en tu próxima planilla.<br />
                Detalle abajo en la lista (filas con badge "Pendiente de aplicar").<br />
                Si no estás de acuerdo con alguno, hablá con Yessica o el manager <strong>antes del corte</strong> de la quincena.
              </div>
            </div>
          )}

          {/* Lista */}
          {items.length === 0 ? (
            <EmptyCard message="No tenés amonestaciones registradas. Buen trabajo 🎉" />
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {items.map((a) => {
                const meta = TIPO_META[a.tipo] || TIPO_META.verbal;
                const descuentoPendiente = a.tipo === 'descuento' && a.aplicada_en_planilla_id == null;
                return (
                  <div
                    key={a.id}
                    className="card"
                    style={{
                      borderLeft: `4px solid ${meta.color}`,
                      opacity: a.resuelto && !descuentoPendiente ? 0.7 : 1
                    }}
                  >
                    <div className="row-between" style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 18 }}>{meta.emoji}</span>
                          <span className="badge" style={{ background: meta.color, color: 'var(--bg-base)', fontSize: 10 }}>{meta.label}</span>
                          {a.monto_descuento != null && a.monto_descuento > 0 && (
                            <span className="badge badge-danger" style={{ fontSize: 10 }}>−{formatUSD(a.monto_descuento)}</span>
                          )}
                          {descuentoPendiente && (
                            <span className="badge badge-warning" style={{ fontSize: 10 }}>⏳ Pendiente de aplicar</span>
                          )}
                          {a.aplicada_en_planilla_id && (
                            <span className="badge badge-muted" style={{ fontSize: 10 }}>✓ Aplicada {a.aplicada_en_fecha?.slice(0, 10)}</span>
                          )}
                          {a.resuelto && !descuentoPendiente && (
                            <span className="badge badge-kaeru" style={{ fontSize: 10 }}>✓ resuelto</span>
                          )}
                          {a.empleado_firmo && (
                            <span className="badge badge-purple" style={{ fontSize: 10 }}>✍ firmado</span>
                          )}
                          {!a.empleado_firmo && !a.resuelto && (
                            <span className="badge" style={{ background: '#f5b400', color: 'var(--bg-base)', fontSize: 10 }}>⚠ sin firmar</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{a.motivo}</div>
                        {a.detalle && (
                          <div className="text-muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {a.detalle}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="text-muted" style={{ fontSize: 11 }}>{formatDate(a.fecha)}</div>
                        <button
                          onClick={() => abrirPdf(a)}
                          className="btn btn-outline btn-sm"
                          style={{ marginTop: 6 }}
                        >
                          📄 Ver / Imprimir
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Card explicación */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>ℹ Cómo funciona</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              • Sólo VOS ves tus amonestaciones (privacidad total — los demás empleados no las ven).<br />
              • Las que dicen <span className="badge" style={{ background: '#f5b400', color: 'var(--bg-base)', fontSize: 9 }}>⚠ sin firmar</span> requieren tu firma como acuse de recibo.<br />
              • Las de tipo <strong>💸 Descuento</strong> se descuentan de tu próxima planilla si no las disputás antes del corte.<br />
              • Tap en <strong>📄 Ver / Imprimir</strong> para abrir el documento formal y guardarlo como PDF.<br />
              • <strong>⭐ Reconocimientos</strong> también aparecen aquí — todo lo que el manager registró sobre tu trabajo.<br />
              • Si ves algo que no entendés o no recordás, hablá con el manager directamente.
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
