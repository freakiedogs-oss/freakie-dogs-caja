import PageShell, { LoadingCard, ErrorCard } from '@/components/ui/PageShell';
import { useKaeruQuery } from '@/hooks/useKaeruQuery';
import { formatUSD } from '@/lib/utils';

interface Socio {
  id: string;
  nombre: string;
  email: string | null;
  participacion_pct: number;
  tipo: 'operativo' | 'inversor';
  rol_descripcion: string | null;
  sueldo_mensual_fijo: number;
}

interface BalanceVista {
  socio_id: string;
  nombre: string;
  activo: boolean | null;
  total_aportado: number;
  total_capital_repagado: number;
  capital_pendiente: number;
  intereses_acumulados: number;
  intereses_pagados: number;
  deuda_total: number;
  aportes_activos: number;
}

export default function Socios() {
  const sQ = useKaeruQuery<Socio>('socios', { orderBy: { column: 'tipo', ascending: true } });
  const bQ = useKaeruQuery<BalanceVista>('v_socios_balance', {});

  const loading = sQ.loading || bQ.loading;
  const error = sQ.error || bQ.error;

  const totalAportado = bQ.data.reduce((s, b) => s + Number(b.total_aportado || 0), 0);
  const totalPendiente = bQ.data.reduce((s, b) => s + Number(b.capital_pendiente || 0), 0);

  return (
    <PageShell
      kanji="株"
      titulo="Socios"
      subtitulo="Gobierno corporativo — 4 socios al 25% cada uno"
      badge={{ label: 'Live · v_socios_balance', variant: 'kaeru' }}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error!} /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card">
              <div className="card-title">Total socios</div>
              <div className="metric-xl text-kaeru">{sQ.count}</div>
              <div className="metric-row text-muted">{sQ.data.filter((s) => s.tipo === 'operativo').length} operativos · {sQ.data.filter((s) => s.tipo === 'inversor').length} inversor</div>
            </div>
            <div className="card">
              <div className="card-title">Aportes acumulados</div>
              <div className="metric-xl">{formatUSD(totalAportado)}</div>
              <div className="metric-row text-muted">Capital inyectado al ERP histórico</div>
            </div>
            <div className="card">
              <div className="card-title">Capital pendiente devolución</div>
              <div className="metric-xl text-warning">{formatUSD(totalPendiente)}</div>
              <div className="metric-row text-muted">Saldo deuda con socios</div>
            </div>
            <div className="card">
              <div className="card-title">Sueldo gerencial mensual</div>
              <div className="metric-xl text-purple">{formatUSD(sQ.data.reduce((s, x) => s + Number(x.sueldo_mensual_fijo || 0), 0))}</div>
              <div className="metric-row text-muted">Fijo a 3 operativos</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Detalle de socios</div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>%</th>
                  <th style={{ textAlign: 'right' }}>Sueldo mes</th>
                </tr>
              </thead>
              <tbody>
                {sQ.data.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{s.email ?? '— pendiente —'}</td>
                    <td className="text-muted">{s.rol_descripcion ?? '—'}</td>
                    <td><span className={`badge ${s.tipo === 'operativo' ? 'badge-kaeru' : 'badge-purple'}`}>{s.tipo}</span></td>
                    <td style={{ textAlign: 'right' }}>{s.participacion_pct}%</td>
                    <td style={{ textAlign: 'right' }}>{formatUSD(s.sueldo_mensual_fijo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Balance financiero por socio (v_socios_balance)</div>
              <span className="badge badge-muted">Aportes + intereses devengados</span>
            </div>
            {bQ.data.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center' }} className="text-muted">
                Aún sin movimientos de socios cargados en kaeru.movimientos_socios.<br />
                <span className="text-dim" style={{ fontSize: 12 }}>Cuando se vincule cada aporte BAC ($53.8K identificados en discovery) la vista se llenará.</span>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Socio</th>
                    <th style={{ textAlign: 'right' }}>Aportado</th>
                    <th style={{ textAlign: 'right' }}>Repagado</th>
                    <th style={{ textAlign: 'right' }}>Pendiente</th>
                    <th style={{ textAlign: 'right' }}>Intereses</th>
                    <th style={{ textAlign: 'right' }}>Deuda total</th>
                  </tr>
                </thead>
                <tbody>
                  {bQ.data.map((b) => (
                    <tr key={b.socio_id}>
                      <td style={{ fontWeight: 600 }}>{b.nombre}</td>
                      <td style={{ textAlign: 'right' }}>{formatUSD(b.total_aportado)}</td>
                      <td style={{ textAlign: 'right' }} className="text-muted">{formatUSD(b.total_capital_repagado)}</td>
                      <td style={{ textAlign: 'right' }} className="text-warning">{formatUSD(b.capital_pendiente)}</td>
                      <td style={{ textAlign: 'right' }} className="text-purple">{formatUSD(b.intereses_acumulados)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatUSD(b.deuda_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
