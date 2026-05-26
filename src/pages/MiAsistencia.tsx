import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

// ============================================================
// /mi-asistencia — Vista personal de asistencia del empleado
// ------------------------------------------------------------
// El empleado entra con su PIN y ve SOLO sus marcajes.
// RLS de kaeru.asistencia filtra por empleado_id del session.
//
// Útil para que el empleado audite sus horas antes de la quincena
// y compare con su recibo en /mi-boleta.
// ============================================================

interface AsistenciaRow {
  id: string;
  fecha: string;
  entrada_at: string | null;
  salida_at: string | null;
  minutos_trabajados: number | null;
  notas: string | null;
}

interface EmpleadoRow {
  id: string;
  nombre: string;
  cargo: string | null;
}

function fmtHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtMin(m: number | null): string {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

function dayOfWeek(fechaIso: string): string {
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return dias[new Date(fechaIso + 'T12:00:00').getDay()];
}

export default function MiAsistencia() {
  const { session } = useSession();
  const [empleado, setEmpleado] = useState<EmpleadoRow | null>(null);
  const [registros, setRegistros] = useState<AsistenciaRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    if (!session) return;
    (async () => {
      setLoading(true);
      try {
        let empleadoId = session.empleado_id;
        let empData: EmpleadoRow | null = null;

        if (empleadoId) {
          const { data, error: err } = await kaeru.from('empleados').select('id,nombre,cargo').eq('id', empleadoId).maybeSingle();
          if (err) throw err;
          empData = data as unknown as EmpleadoRow;
        }
        if (!empData && session.email) {
          const { data, error: err } = await kaeru.from('empleados').select('id,nombre,cargo').eq('email', session.email).maybeSingle();
          if (err) throw err;
          empData = data as unknown as EmpleadoRow;
          if (empData) empleadoId = empData.id;
        }
        if (cancel) return;
        if (!empData || !empleadoId) {
          setEmpleado(null);
          setRegistros([]);
          setLoading(false);
          return;
        }
        setEmpleado(empData);

        const { data: rows, error: rErr } = await kaeru
          .from('asistencia')
          .select('id,fecha,entrada_at,salida_at,minutos_trabajados,notas')
          .eq('empleado_id', empleadoId)
          .order('fecha', { ascending: false })
          .limit(60);
        if (cancel) return;
        if (rErr) throw rErr;
        setRegistros((rows || []) as unknown as AsistenciaRow[]);
      } catch (e: any) {
        if (!cancel) setError(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [session]);

  // KPIs últimos 15 días
  const ultimos15 = (() => {
    const hace15 = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString().split('T')[0];
    return registros.filter((r) => r.fecha >= hace15);
  })();
  const totalMin15  = ultimos15.reduce((s, r) => s + (r.minutos_trabajados || 0), 0);
  const diasMarcados15 = ultimos15.filter((r) => r.entrada_at).length;
  const promedioMin = diasMarcados15 > 0 ? Math.round(totalMin15 / diasMarcados15) : 0;
  const hoy = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0];
  const hoyRow = registros.find((r) => r.fecha === hoy);
  const estadoHoy = !hoyRow ? 'no marcado'
                  : hoyRow.salida_at ? 'cerrado'
                  : 'trabajando';

  return (
    <PageShell
      kanji="勤"
      titulo="Mi Asistencia"
      subtitulo={empleado ? `${empleado.nombre} · últimos ${registros.length} días` : 'Mis registros de asistencia'}
      badge={
        estadoHoy === 'trabajando' ? { label: '🟢 Trabajando ahora', variant: 'kaeru' }
        : estadoHoy === 'cerrado'  ? { label: '✓ Cerraste hoy',     variant: 'purple' }
        : { label: '⚪ Sin marcar hoy',   variant: 'muted' }
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
          <div className="card-grid card-grid-3">
            <div className="card">
              <div className="card-title">Días marcados (últ. 15)</div>
              <div className="metric-xl">{diasMarcados15}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>de 15 días posibles</div>
            </div>
            <div className="card">
              <div className="card-title">Horas trabajadas (últ. 15)</div>
              <div className="metric-xl text-kaeru">{fmtMin(totalMin15)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>todos los días con marcaje completo</div>
            </div>
            <div className="card">
              <div className="card-title">Promedio diario</div>
              <div className="metric-xl text-purple">{fmtMin(promedioMin)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>horas/día en días trabajados</div>
            </div>
          </div>

          {/* Tabla histórica */}
          {registros.length === 0 ? (
            <EmptyCard message="Aún no tenés registros de asistencia. Marca con tu PIN en /asistencia." />
          ) : (
            <div className="card">
              <div className="card-header">
                <div className="card-title">📅 Mis marcajes</div>
                <span className="badge badge-muted">Privacidad total · solo vos los ves</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Entrada</th>
                    <th style={{ textAlign: 'right' }}>Salida</th>
                    <th style={{ textAlign: 'right' }}>Trabajadas</th>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => {
                    const incompleto = r.entrada_at && !r.salida_at && r.fecha < hoy;
                    return (
                      <tr key={r.id}>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dayOfWeek(r.fecha)}</td>
                        <td style={{ fontSize: 12, fontWeight: r.fecha === hoy ? 700 : 400 }}>{formatDate(r.fecha)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: r.entrada_at ? 'var(--accent-kaeru)' : 'var(--text-muted)' }}>
                          {fmtHora(r.entrada_at)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: r.salida_at ? 'var(--accent-purple)' : incompleto ? 'var(--state-danger)' : 'var(--text-muted)' }}>
                          {incompleto ? '⚠ falta' : fmtHora(r.salida_at)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{fmtMin(r.minutos_trabajados)}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.notas || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Card explicación */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>ℹ Sobre tu asistencia</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              • Marcá entrada y salida con tu PIN en la tablet de <strong>/asistencia</strong> (la pantalla grande de la cocina).<br />
              • Si olvidaste marcar salida un día → aparece <span className="text-danger">⚠ falta</span>. Avisá a Yessica para que ajuste.<br />
              • Las horas que ves acá son las que se usan para calcular tu planilla quincenal en <strong>/mi-boleta</strong>.<br />
              • Si ves un día que no marcaste por error, contactá al manager — la corrección queda registrada para auditoría.
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
