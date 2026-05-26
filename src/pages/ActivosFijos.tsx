import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { useKaeruQuery } from '@/hooks/useKaeruQuery';
import { formatUSD, formatDate } from '@/lib/utils';

interface Activo {
  id: string;
  categoria: string | null;
  descripcion: string;
  proveedor: string | null;
  fecha_adquisicion: string | null;
  monto_total: number;
  vida_util_meses: number;
  depreciacion_acumulada: number;
  valor_libros: number | null;
  compras_dte_id: string | null;
  dte_pendiente: boolean | null;
  notas: string | null;
}

const mesesEntre = (desde: string, hasta = new Date().toISOString().slice(0, 10)) => {
  const a = new Date(desde);
  const b = new Date(hasta);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};

export default function ActivosFijos() {
  const q = useKaeruQuery<Activo>('activos_fijos', { orderBy: { column: 'monto_total', ascending: false } });

  const totalCapex = q.data.reduce((s, a) => s + Number(a.monto_total || 0), 0);
  const conDTE = q.data.filter((a) => !a.dte_pendiente).length;
  const sinDTE = q.data.filter((a) => a.dte_pendiente).length;
  const depreciacionMensualTotal = q.data.reduce((s, a) => s + Number(a.monto_total || 0) / a.vida_util_meses, 0);
  const valorLibrosTotal = q.data.reduce((s, a) => {
    if (!a.fecha_adquisicion) return s + Number(a.monto_total || 0);
    const meses = mesesEntre(a.fecha_adquisicion);
    const depAcum = Math.min(meses, a.vida_util_meses) * (Number(a.monto_total) / a.vida_util_meses);
    return s + (Number(a.monto_total) - depAcum);
  }, 0);

  return (
    <PageShell
      kanji="資"
      titulo="Activos Fijos"
      subtitulo="CAPEX con depreciación lineal — el DTE manda el monto, los pagos NO suman"
      badge={{ label: `${conDTE}/${q.count} con DTE`, variant: sinDTE > 0 ? 'warning' : 'kaeru' }}
    >
      {q.loading ? <LoadingCard /> : q.error ? <ErrorCard error={q.error} /> : (
        <>
          {/* Nota pedagógica del modelo */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>Modelo de monto canónico</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              El <strong>monto canónico</strong> de cada activo fijo viene del <strong>DTE de compra</strong> (FK <code>compras_dte_id</code>). Los pagos en BAC apuntan al DTE como cancelación pero <strong>NO suman</strong> al monto del activo.
              <br />
              Si un activo aún no tiene DTE vinculado, mostramos el monto declarado provisional con badge <span className="badge badge-warning" style={{ marginLeft: 4 }}>Pendiente DTE</span>. Cuando llegue el DTE por correo, el cron Apps Script lo vincula y el monto se reemplaza por el del DTE.
              <br />
              Excepción: gastos sin DTE (cash menor) van a <code>uso_caja_chica</code>, no acá.
            </div>
          </div>

          <div className="card-grid card-grid-3">
            <div className="card">
              <div className="card-title">CAPEX total</div>
              <div className="metric-xl text-kaeru">{formatUSD(totalCapex)}</div>
              <div className="metric-row text-muted">{q.count} activos · {conDTE} con DTE · {sinDTE} pendientes</div>
            </div>
            <div className="card">
              <div className="card-title">Depreciación mensual</div>
              <div className="metric-xl text-purple">{formatUSD(depreciacionMensualTotal)}</div>
              <div className="metric-row text-muted">Aplicada al P&L cada mes</div>
            </div>
            <div className="card">
              <div className="card-title">Valor en libros (hoy)</div>
              <div className="metric-xl">{formatUSD(valorLibrosTotal)}</div>
              <div className="metric-row text-muted">Después de depreciación acumulada</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Catálogo de activos fijos</div>
            </div>
            {q.data.length === 0 ? <EmptyCard message="Sin activos fijos registrados" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Descripción</th>
                      <th>Categoría</th>
                      <th>Proveedor</th>
                      <th>DTE</th>
                      <th>Adquisición</th>
                      <th style={{ textAlign: 'right' }}>Monto</th>
                      <th style={{ textAlign: 'right' }}>Vida útil</th>
                      <th style={{ textAlign: 'right' }}>Dep./mes</th>
                      <th style={{ textAlign: 'right' }}>Valor libros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.map((a) => {
                      const depMensual = Number(a.monto_total) / a.vida_util_meses;
                      const meses = a.fecha_adquisicion ? mesesEntre(a.fecha_adquisicion) : 0;
                      const depAcum = Math.min(meses, a.vida_util_meses) * depMensual;
                      const valorLibros = Number(a.monto_total) - depAcum;
                      return (
                        <tr key={a.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{a.descripcion}</div>
                            {a.notas && <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>{a.notas}</div>}
                          </td>
                          <td><span className="badge badge-muted">{a.categoria ?? '—'}</span></td>
                          <td className="text-muted" style={{ fontSize: 12 }}>{a.proveedor ?? '—'}</td>
                          <td>
                            {a.dte_pendiente
                              ? <span className="badge badge-warning">Pendiente DTE</span>
                              : <span className="badge badge-kaeru">✓ DTE vinculado</span>
                            }
                          </td>
                          <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(a.fecha_adquisicion)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatUSD(a.monto_total)}</td>
                          <td style={{ textAlign: 'right' }} className="text-muted">{a.vida_util_meses} meses</td>
                          <td style={{ textAlign: 'right' }} className="text-purple">{formatUSD(depMensual)}</td>
                          <td style={{ textAlign: 'right' }}>{formatUSD(valorLibros)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Aclaración explícita sobre los pagos */}
          <div className="card" style={{ borderColor: 'rgba(95,224,169,0.2)' }}>
            <div className="card-title text-kaeru" style={{ marginBottom: 8 }}>Pagos en BAC ≠ Monto del activo</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              Ejemplo: <strong>Artcool</strong> aparece con $14,207.52 en pagos BAC (8 TF entre ago-25 y ene-26), pero ese es el <em>cash desembolsado</em>, no necesariamente el monto del activo. Cuando llegue el DTE de Artcool veremos el monto real (puede coincidir, puede haber retenciones).
              <br />
              <strong>Investment Design</strong> $82K es la inversión total declarada por Jose. Los pagos BAC identificados fueron $21.8K (resto pre-BAC en efectivo). Cuando lleguen los DTEs, se vinculan.
              <br />
              <span className="text-warning">⚠️ Por eso ves "Pendiente DTE"</span> — el sistema aún no debe asumir que los pagos = activo hasta tener el documento fiscal.
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
