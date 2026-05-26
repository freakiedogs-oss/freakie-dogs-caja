import { useState, useEffect } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { formatUSD, formatDate } from '@/lib/utils';

interface Venta {
  id: string;
  numero_orden: number | null;
  fecha_hora: string;
  canal: 'mesa' | 'peya';
  tipo_dte: string;
  total: number;
  propina: number;
  metodo_pago: string | null;
  estado: string;
  codigo_generacion: string | null;
}

const PAGE_SIZE = 50;

export default function Ventas() {
  const [page, setPage] = useState(0);
  const [canalFilter, setCanalFilter] = useState<'all' | 'mesa' | 'peya'>('all');
  const [tipoFilter, setTipoFilter] = useState<string>('all');
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');
  const [data, setData] = useState<Venta[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        let q: any = kaeru
          .from('ventas')
          .select('id,numero_orden,fecha_hora,canal,tipo_dte,total,propina,metodo_pago,estado,codigo_generacion', { count: 'exact' })
          .order('fecha_hora', { ascending: false })
          .limit(PAGE_SIZE * (page + 1));

        if (canalFilter !== 'all') q = q.eq('canal', canalFilter);
        if (tipoFilter !== 'all') q = q.eq('tipo_dte', tipoFilter);
        if (desde) q = q.gte('fecha_hora', `${desde}T00:00:00`);
        if (hasta) q = q.lte('fecha_hora', `${hasta}T23:59:59`);

        const { data: rows, count: c, error: e } = await q;
        if (cancel) return;
        if (e) { setError(e.message); setLoading(false); return; }
        setData(rows || []);
        setCount(c || 0);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (!cancel) { setError(String(e?.message || e)); setLoading(false); }
      }
    })();
    return () => { cancel = true; };
  }, [page, canalFilter, tipoFilter, desde, hasta]);

  const totalMostrado = data.reduce((s, v) => s + Number(v.total || 0), 0);

  return (
    <PageShell
      kanji="売"
      titulo="Ventas"
      subtitulo={`${count.toLocaleString()} transacciones totales en kaeru.ventas`}
      badge={{ label: 'Live · Supabase', variant: 'kaeru' }}
    >
      <div className="card">
        <div className="card-header">
          <div className="card-title">Filtros</div>
          <span className="text-muted" style={{ fontSize: 11 }}>{data.length} mostrados · {formatUSD(totalMostrado)} sumados</span>
        </div>
        <div className="stack-sm">
          {/* Rango fechas */}
          <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="card-title">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => { setDesde(e.target.value); setPage(0); }}
                style={{
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--r-md)',
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  colorScheme: 'dark'
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="card-title">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => { setHasta(e.target.value); setPage(0); }}
                style={{
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--r-md)',
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  colorScheme: 'dark'
                }}
              />
            </div>
            {(desde || hasta) && (
              <button className="btn btn-outline btn-sm" onClick={() => { setDesde(''); setHasta(''); setPage(0); }}>
                Limpiar fechas
              </button>
            )}
          </div>

          {/* Canal */}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ marginRight: 8 }}>Canal:</span>
            <button className={`btn btn-sm ${canalFilter === 'all' ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => { setCanalFilter('all'); setPage(0); }}>Todos</button>
            <button className={`btn btn-sm ${canalFilter === 'mesa' ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => { setCanalFilter('mesa'); setPage(0); }}>Mesa</button>
            <button className={`btn btn-sm ${canalFilter === 'peya' ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => { setCanalFilter('peya'); setPage(0); }}>PeYa</button>
          </div>

          {/* Tipo DTE */}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ marginRight: 8 }}>Tipo DTE:</span>
            {['all', 'factura', 'ccf', 'nota_credito', 'pre_dte'].map((t) => (
              <button key={t} className={`btn btn-sm ${tipoFilter === t ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setTipoFilter(t); setPage(0); }}>
                {t === 'all' ? 'Todos' : t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Resultados</div>
          </div>
          {data.length === 0 ? <EmptyCard message="Sin resultados con los filtros actuales" /> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Orden</th>
                    <th>Tipo DTE</th>
                    <th>Canal</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Propina</th>
                    <th>Método pago</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((v) => (
                    <tr key={v.id}>
                      <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(v.fecha_hora)}</td>
                      <td>{v.numero_orden ?? '—'}</td>
                      <td><span className={`badge badge-${v.tipo_dte === 'nota_credito' ? 'danger' : v.tipo_dte === 'ccf' ? 'purple' : 'muted'}`}>{v.tipo_dte}</span></td>
                      <td>
                        <span className={`badge ${v.canal === 'peya' ? 'badge-purple' : 'badge-kaeru'}`}>{v.canal}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatUSD(v.total)}</td>
                      <td style={{ textAlign: 'right' }} className={v.propina > 0 ? 'text-kaeru' : 'text-dim'}>{formatUSD(v.propina)}</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{v.metodo_pago ?? '—'}</td>
                      <td>
                        <span className={`badge ${v.estado === 'anulada' ? 'badge-danger' : 'badge-muted'}`}>{v.estado}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length < count && data.length >= PAGE_SIZE * (page + 1) && (
                <div style={{ textAlign: 'center', padding: 12 }}>
                  <button className="btn btn-outline" onClick={() => setPage(page + 1)}>
                    Cargar más ({Math.min(PAGE_SIZE, count - data.length)} más de {count})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
