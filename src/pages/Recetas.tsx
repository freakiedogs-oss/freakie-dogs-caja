import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { useKaeruQuery } from '@/hooks/useKaeruQuery';
import { formatUSD } from '@/lib/utils';

interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  precio_venta: number;
  costo_estimado: number | null;
  tipo_producto: string | null;
  activo: boolean;
  categoria_id: string | null;
}

interface Categoria {
  id: string;
  nombre: string;
}

export default function Recetas() {
  const prodQ = useKaeruQuery<Producto>('productos', { orderBy: { column: 'nombre', ascending: true }, limit: 200 });
  const catQ = useKaeruQuery<Categoria>('categorias_menu', {});
  const recQ = useKaeruQuery<{ producto_id: string }>('recetas', { select: 'producto_id', limit: 5000 });

  const loading = prodQ.loading || catQ.loading || recQ.loading;
  const error = prodQ.error || catQ.error || recQ.error;

  const catMap: Record<string, string> = {};
  catQ.data.forEach((c) => { catMap[c.id] = c.nombre; });

  const recetaCount: Record<string, number> = {};
  recQ.data.forEach((r: any) => {
    recetaCount[r.producto_id] = (recetaCount[r.producto_id] || 0) + 1;
  });

  const platosPrincipales = prodQ.data.filter((p) => p.activo && p.tipo_producto === 'plato_principal');
  const conReceta = platosPrincipales.filter((p) => recetaCount[p.id]).length;
  const sinReceta = platosPrincipales.length - conReceta;
  const conCostoConocido = platosPrincipales.filter((p) => p.costo_estimado != null).length;

  return (
    <PageShell
      kanji="麺"
      titulo="Recetas (BOM)"
      subtitulo={`${platosPrincipales.length} productos activos · ${conReceta} con receta · ${sinReceta} pendientes workshop`}
      badge={sinReceta > 0 ? { label: '⏳ Workshop pendiente', variant: 'warning' } : { label: '✓ Todos con BOM', variant: 'kaeru' }}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error!} /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card"><div className="card-title">Productos activos</div><div className="metric-xl text-kaeru">{platosPrincipales.length}</div></div>
            <div className="card"><div className="card-title">Con receta cargada</div><div className="metric-xl">{conReceta}</div></div>
            <div className="card"><div className="card-title">Pendientes BOM</div><div className="metric-xl text-warning">{sinReceta}</div><div className="metric-row text-muted">Workshop con Iván/Roberto</div></div>
            <div className="card"><div className="card-title">Con costo estimado</div><div className="metric-xl text-purple">{conCostoConocido}</div></div>
          </div>

          {sinReceta > 0 && (
            <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
              <div className="card-title text-purple" style={{ marginBottom: 8 }}>Workshop pendiente</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                Los {sinReceta} productos sin receta necesitan workshop con <strong>Iván (Jefe de Cocina)</strong>, <strong>Roberto (Chef)</strong> y <strong>Yessica (Manager)</strong>.<br />
                La plantilla XLSX está lista en <code>_KAERU_CHAN_BLUEPRINT/Workshop_Recetas/Workshop_Recetas_Kaeru_Chan.xlsx</code>.<br />
                Cuando completen la plantilla, cargo los BOMs vía edge function bulk-sql-kaeru y los costos se calculan automáticamente.
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <div className="card-title">Productos del menú activo</div>
            </div>
            {platosPrincipales.length === 0 ? <EmptyCard message="Sin productos activos" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Producto</th>
                      <th>Categoría</th>
                      <th style={{ textAlign: 'right' }}>Precio venta</th>
                      <th style={{ textAlign: 'right' }}>Costo estimado</th>
                      <th style={{ textAlign: 'right' }}>Margen %</th>
                      <th>Receta BOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platosPrincipales.map((p) => {
                      const tieneReceta = !!recetaCount[p.id];
                      const margenPct = p.costo_estimado != null && p.precio_venta > 0
                        ? ((p.precio_venta - p.costo_estimado) / p.precio_venta) * 100
                        : null;
                      return (
                        <tr key={p.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.codigo}</td>
                          <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                          <td><span className="badge badge-muted">{p.categoria_id ? catMap[p.categoria_id] : '—'}</span></td>
                          <td style={{ textAlign: 'right' }}>{formatUSD(p.precio_venta)}</td>
                          <td style={{ textAlign: 'right' }} className={p.costo_estimado == null ? 'text-dim' : ''}>
                            {p.costo_estimado != null ? formatUSD(p.costo_estimado) : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }} className={margenPct == null ? 'text-dim' : margenPct < 50 ? 'text-warning' : 'text-kaeru'}>
                            {margenPct != null ? `${margenPct.toFixed(1)}%` : '—'}
                          </td>
                          <td>
                            {tieneReceta
                              ? <span className="badge badge-kaeru">{recetaCount[p.id]} ingredientes</span>
                              : <span className="badge badge-warning">Sin BOM</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
