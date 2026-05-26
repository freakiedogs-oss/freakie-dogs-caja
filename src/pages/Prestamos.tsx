import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { useKaeruQuery } from '@/hooks/useKaeruQuery';
import { formatUSD, formatDate } from '@/lib/utils';

interface Prestamo {
  id: string;
  institucion: string;
  monto: number;
  fecha: string | null;
  tipo: string;
  notas: string | null;
  activo: boolean;
}

interface PrestamoEstado {
  id: string;
  institucion: string;
  tipo: string;
  monto_original: number;
  fecha_origen: string | null;
  capital_pagado: number;
  capital_pendiente: number;
  intereses_pagados_total: number;
  fecha_ultimo_movimiento: string | null;
  movimientos_count: number;
}

export default function Prestamos() {
  const pQ = useKaeruQuery<Prestamo>('prestamos', { orderBy: { column: 'fecha', ascending: false } });
  const eQ = useKaeruQuery<PrestamoEstado>('v_prestamos_estado', {});

  const loading = pQ.loading || eQ.loading;
  const error = pQ.error || eQ.error;

  const totalPrestamos = pQ.data.reduce((s, p) => s + Number(p.monto || 0), 0);
  const totalPendiente = eQ.data.reduce((s, e) => s + Number(e.capital_pendiente || 0), 0);
  const totalPagado = eQ.data.reduce((s, e) => s + Number(e.capital_pagado || 0), 0);

  return (
    <PageShell
      kanji="借"
      titulo="Préstamos Inter-empresa"
      subtitulo={`${pQ.count} préstamos activos — Liquidez bidireccional con empresas hermanas`}
      badge={{ label: 'Live · v_prestamos_estado', variant: 'kaeru' }}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error!} /> : (
        <>
          <div className="card-grid card-grid-3">
            <div className="card"><div className="card-title">Total prestado original</div><div className="metric-xl">{formatUSD(totalPrestamos)}</div></div>
            <div className="card"><div className="card-title">Capital pendiente</div><div className="metric-xl text-warning">{formatUSD(totalPendiente)}</div></div>
            <div className="card"><div className="card-title">Capital ya pagado</div><div className="metric-xl text-kaeru">{formatUSD(totalPagado)}</div></div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Préstamos registrados</div>
            </div>
            {pQ.data.length === 0 ? <EmptyCard message="Sin préstamos registrados" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Institución</th>
                      <th>Tipo</th>
                      <th style={{ textAlign: 'right' }}>Monto original</th>
                      <th>Fecha origen</th>
                      <th>Notas</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pQ.data.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>{p.institucion}</td>
                        <td><span className={`badge badge-${p.tipo === 'inter_empresa' ? 'purple' : 'muted'}`}>{p.tipo}</span></td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatUSD(p.monto)}</td>
                        <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(p.fecha)}</td>
                        <td className="text-muted" style={{ fontSize: 11 }}>{p.notas ?? '—'}</td>
                        <td>{p.activo ? <span className="badge badge-kaeru">Activo</span> : <span className="badge badge-muted">Cerrado</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ borderColor: 'rgba(95,224,169,0.2)' }}>
            <div className="card-title text-kaeru" style={{ marginBottom: 8 }}>Sobre el modelo inter-empresa</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <strong>Freakie Dogs S.A.</strong> y <strong>Kako Cakes</strong> prestan liquidez a Kaeru cuando hace falta. Los movimientos son bidireccionales (desembolso + abono_capital).<br />
              Los pagos identificados en BAC (cuenta 201500451 = Freakies, 201620788 = Kako) se vinculan a estos préstamos via <code>prestamo_movimientos.bank_transaccion_id</code>.<br />
              Cuando se haga el barrido de clasificación BAC manual, cada TF a estas cuentas se categoriza correctamente.
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
