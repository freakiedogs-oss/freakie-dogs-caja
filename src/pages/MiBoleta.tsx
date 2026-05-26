import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';
import { verRecibo, ReciboDetalle, ReciboQuincena } from '@/lib/recibo';

// ============================================================
// /mi-boleta — Vista personal del empleado
// ------------------------------------------------------------
// El empleado entra con su PIN y VE SOLO sus propios recibos.
// No ve los de los demás. RLS hace el filtrado al server-side
// vía session.empleado_id (preferido) o session.email (fallback).
//
// Si la sesión no tiene empleado_id mapeado, le muestra mensaje
// para contactar a Yessica/admin.
// ============================================================

interface ReciboRow {
  id: string;
  quincena_inicio: string;
  quincena_fin: string;
  dias_trabajados: number;
  horas_extra: number;
  salario_base: number;
  bono: number;
  propina: number;
  isss: number;
  afp: number;
  isr: number;
  otros_descuentos: number;
  total_descuentos: number;
  neto_a_pagar: number;
  estado: string;
  fecha_pago: string | null;
}

interface EmpleadoRow {
  id: string;
  nombre: string;
  cargo: string | null;
  email: string | null;
}

export default function MiBoleta() {
  const { session } = useSession();
  const toast = useToast();
  const [empleado, setEmpleado] = useState<EmpleadoRow | null>(null);
  const [recibos,  setRecibos]  = useState<ReciboRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    if (!session) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Resolver empleado: por empleado_id si está mapeado, sino por email
        let empleadoId = session.empleado_id;
        let empData: EmpleadoRow | null = null;

        if (empleadoId) {
          const { data, error: err } = await kaeru
            .from('empleados')
            .select('id,nombre,cargo,email')
            .eq('id', empleadoId)
            .maybeSingle();
          if (err) throw err;
          empData = data as unknown as EmpleadoRow;
        }

        if (!empData && session.email) {
          const { data, error: err } = await kaeru
            .from('empleados')
            .select('id,nombre,cargo,email')
            .eq('email', session.email)
            .maybeSingle();
          if (err) throw err;
          empData = data as unknown as EmpleadoRow;
          if (empData) empleadoId = empData.id;
        }

        if (cancel) return;

        if (!empData || !empleadoId) {
          setEmpleado(null);
          setRecibos([]);
          setLoading(false);
          return;
        }

        setEmpleado(empData);

        // 2. Cargar SOLO mis recibos
        const { data: recs, error: recErr } = await kaeru
          .from('planilla')
          .select('id,quincena_inicio,quincena_fin,dias_trabajados,horas_extra,salario_base,bono,propina,isss,afp,isr,otros_descuentos,total_descuentos,neto_a_pagar,estado,fecha_pago')
          .eq('empleado_id', empleadoId)
          .order('quincena_inicio', { ascending: false });

        if (cancel) return;
        if (recErr) throw recErr;
        setRecibos((recs || []) as unknown as ReciboRow[]);
      } catch (e: any) {
        if (!cancel) setError(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => { cancel = true; };
  }, [session]);

  function abrirRecibo(r: ReciboRow) {
    if (!empleado) return;
    const detalle: ReciboDetalle = {
      empleado_nombre: empleado.nombre,
      cargo: empleado.cargo,
      dias_trabajados: r.dias_trabajados,
      horas_extra: r.horas_extra,
      salario_base: r.salario_base,
      bono: r.bono,
      propina: r.propina,
      isss: r.isss,
      afp: r.afp,
      isr: r.isr,
      otros_descuentos: r.otros_descuentos,
      total_descuentos: r.total_descuentos,
      neto_a_pagar: r.neto_a_pagar,
      estado: r.estado,
      fecha_pago: r.fecha_pago
    };
    const quincena: ReciboQuincena = {
      quincena_inicio: r.quincena_inicio,
      quincena_fin: r.quincena_fin
    };
    verRecibo(detalle, quincena, () => toast.warning('Permití las ventanas emergentes para abrir tu recibo'));
  }

  const ultimoPagado = recibos.find((r) => r.estado === 'pagada');
  const totalAcum    = recibos.filter((r) => r.estado === 'pagada')
                              .reduce((s, r) => s + Number(r.neto_a_pagar || 0), 0);

  return (
    <PageShell
      kanji="個"
      titulo="Mi Boleta"
      subtitulo={empleado ? `${empleado.nombre} · ${recibos.length} recibo(s) generados` : 'Mis recibos de pago'}
      badge={ultimoPagado
        ? { label: `Último: ${formatUSD(ultimoPagado.neto_a_pagar)}`, variant: 'kaeru' }
        : { label: 'Sin recibos', variant: 'muted' }}
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
          {/* Resumen */}
          <div className="card-grid card-grid-3">
            <div className="card">
              <div className="card-title">Recibos generados</div>
              <div className="metric-xl">{recibos.length}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {recibos.filter((r) => r.estado === 'pagada').length} pagados ·{' '}
                {recibos.filter((r) => r.estado !== 'pagada').length} en borrador
              </div>
            </div>
            <div className="card">
              <div className="card-title">Neto acumulado pagado</div>
              <div className="metric-xl text-kaeru">{formatUSD(totalAcum)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>Suma de quincenas con estado "pagada"</div>
            </div>
            <div className="card">
              <div className="card-title">Último recibo</div>
              <div className="metric-xl text-purple">
                {ultimoPagado ? formatUSD(ultimoPagado.neto_a_pagar) : '—'}
              </div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {ultimoPagado ? `quincena ${formatDate(ultimoPagado.quincena_inicio)}` : 'aún sin pagos'}
              </div>
            </div>
          </div>

          {/* Lista */}
          {recibos.length === 0 ? (
            <EmptyCard message="Aún no tenés recibos generados. Aparecerán acá cuando Jose corra la planilla." />
          ) : (
            <div className="card">
              <div className="card-header">
                <div className="card-title">📄 Mis recibos</div>
                <span className="badge badge-muted">Privacidad total — solo vos los ves</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Quincena</th>
                    <th style={{ textAlign: 'right' }}>Días</th>
                    <th style={{ textAlign: 'right' }}>Propina</th>
                    <th style={{ textAlign: 'right' }}>Descuentos</th>
                    <th style={{ textAlign: 'right' }}>Neto</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recibos.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontSize: 11 }}>
                        <div style={{ fontWeight: 600 }}>{formatDate(r.quincena_inicio)} → {formatDate(r.quincena_fin)}</div>
                        {r.fecha_pago && <div className="text-muted" style={{ fontSize: 10 }}>pagado {formatDate(r.fecha_pago)}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.dias_trabajados}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(r.propina)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--state-danger)' }}>−{formatUSD(r.total_descuentos)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-kaeru)' }}>{formatUSD(r.neto_a_pagar)}</td>
                      <td>
                        <span className={`badge ${r.estado === 'pagada' ? 'badge-kaeru' : 'badge-muted'}`} style={{ fontSize: 10 }}>
                          {r.estado === 'pagada' ? '✓ Pagada' : 'Borrador'}
                        </span>
                      </td>
                      <td>
                        <button onClick={() => abrirRecibo(r)} className="btn btn-outline btn-sm">
                          📄 Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Info para empleado */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>ℹ Cómo funciona</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              • Tu recibo se genera automáticamente cada quincena (días 1 y 16).<br />
              • Cuando dice <span className="badge badge-muted" style={{ fontSize: 9 }}>Borrador</span>, Jose aún no marca el pago.<br />
              • Cuando dice <span className="badge badge-kaeru" style={{ fontSize: 9 }}>✓ Pagada</span>, ya está depositado en tu cuenta.<br />
              • Tocá "📄 Ver" → se abre el recibo formal listo para imprimir o guardar como PDF.<br />
              • Si ves un descuento que no entendés, hablá con Yessica.
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
