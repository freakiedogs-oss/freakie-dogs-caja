import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { formatUSD, formatDate } from '@/lib/utils';

interface Movimiento {
  id: string;
  banco: string | null;
  cuenta: string | null;
  fecha: string;
  descripcion: string | null;
  monto: number;
  tipo: string | null;
  codigo_bac: string | null;
  balance_post: number | null;
  categoria_sugerida: string | null;
  conciliado: boolean | null;
  periodo: string | null;
}

interface ResumenMes {
  periodo: string;
  ingresos: number;
  egresos: number;
  movimientos: number;
  saldo_cierre: number | null;
}

const PAGE_SIZE = 100;
const PERIODOS_ORDEN = [
  'AGO 2025', 'SEP 2025', 'OCT 2025', 'NOV 2025', 'DIC 2025',
  'Ene 2026', 'FEB 2026', 'Marzo 2026'
];

export default function Bancos() {
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [resumen, setResumen] = useState<ResumenMes[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [periodoFilter, setPeriodoFilter] = useState<string>('all');
  const [categoriaFilter, setCategoriaFilter] = useState<string>('all');
  const [tipoFilter, setTipoFilter] = useState<'all' | 'credito' | 'debito'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<string[]>([]);

  // Carga inicial: resumen mensual + categorías únicas
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data: all } = await kaeru
          .from('estados_cuenta_bancarios')
          .select('periodo, monto, tipo, balance_post, fecha, categoria_sugerida')
          .order('fecha', { ascending: false });
        if (cancel || !all) return;

        // Resumen por periodo
        const buckets: Record<string, ResumenMes> = {};
        all.forEach((m: any) => {
          const p = m.periodo || '—';
          if (!buckets[p]) buckets[p] = { periodo: p, ingresos: 0, egresos: 0, movimientos: 0, saldo_cierre: null };
          if (m.tipo === 'credito') buckets[p].ingresos += Number(m.monto);
          else if (m.tipo === 'debito') buckets[p].egresos += Number(m.monto);
          buckets[p].movimientos += 1;
        });
        // Saldo cierre = último balance_post de cada periodo (el primero en orden DESC fecha)
        for (const periodo in buckets) {
          const ultimoDelPeriodo = all.find((m: any) => m.periodo === periodo);
          if (ultimoDelPeriodo) buckets[periodo].saldo_cierre = Number(ultimoDelPeriodo.balance_post);
        }
        const ordered = PERIODOS_ORDEN
          .map((p) => buckets[p])
          .filter(Boolean);
        setResumen(ordered);

        // Categorías únicas
        const cats = Array.from(new Set(all.map((m: any) => m.categoria_sugerida).filter(Boolean))).sort();
        setCategorias(cats as string[]);
      } catch (e: any) {
        if (!cancel) setError(String(e?.message || e));
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Carga movimientos paginados con filtros
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        let q: any = kaeru
          .from('estados_cuenta_bancarios')
          .select('*', { count: 'exact' })
          .order('fecha', { ascending: false })
          .limit(PAGE_SIZE * (page + 1));
        if (periodoFilter !== 'all') q = q.eq('periodo', periodoFilter);
        if (categoriaFilter !== 'all') q = q.eq('categoria_sugerida', categoriaFilter);
        if (tipoFilter !== 'all') q = q.eq('tipo', tipoFilter);
        if (search) q = q.ilike('descripcion', `%${search}%`);

        const { data, count: c, error: e } = await q;
        if (cancel) return;
        if (e) { setError(e.message); setLoading(false); return; }
        setMovs(data || []);
        setCount(c || 0);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (!cancel) { setError(String(e?.message || e)); setLoading(false); }
      }
    })();
    return () => { cancel = true; };
  }, [page, periodoFilter, categoriaFilter, tipoFilter, search]);

  const saldoActual = resumen.length > 0 ? resumen[resumen.length - 1].saldo_cierre : null;
  const totalIngresos = resumen.reduce((s, r) => s + r.ingresos, 0);
  const totalEgresos = resumen.reduce((s, r) => s + r.egresos, 0);

  return (
    <PageShell
      kanji="銀"
      titulo="Bancos"
      subtitulo="BAC El Salvador · USD 201589959 · Movimientos históricos Ago 25 → Mar 26"
      badge={{ label: 'Live · 777 movimientos', variant: 'kaeru' }}
    >
      <div className="card-grid card-grid-4">
        <div className="card">
          <div className="card-title">Saldo actual</div>
          <div className="metric-xl text-kaeru">{formatUSD(saldoActual)}</div>
          <div className="metric-row text-muted">Cierre mar-2026</div>
        </div>
        <div className="card">
          <div className="card-title">Total ingresos (8 meses)</div>
          <div className="metric-xl">{formatUSD(totalIngresos)}</div>
          <div className="metric-row text-muted">Incluye aportes socios</div>
        </div>
        <div className="card">
          <div className="card-title">Total egresos (8 meses)</div>
          <div className="metric-xl text-warning">{formatUSD(totalEgresos)}</div>
          <div className="metric-row text-muted">Renta, proveedores, TC</div>
        </div>
        <div className="card">
          <div className="card-title">Movimientos</div>
          <div className="metric-xl">{count.toLocaleString()}</div>
          <div className="metric-row text-muted">{categorias.length} categorías</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Resumen mensual</div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Periodo</th>
              <th style={{ textAlign: 'right' }}>Ingresos</th>
              <th style={{ textAlign: 'right' }}>Egresos</th>
              <th style={{ textAlign: 'right' }}>Neto</th>
              <th style={{ textAlign: 'right' }}>Movimientos</th>
              <th style={{ textAlign: 'right' }}>Saldo cierre</th>
            </tr>
          </thead>
          <tbody>
            {resumen.map((r) => {
              const neto = r.ingresos + r.egresos;
              return (
                <tr key={r.periodo}>
                  <td style={{ fontWeight: 600 }}>{r.periodo}</td>
                  <td style={{ textAlign: 'right' }} className="text-kaeru">{formatUSD(r.ingresos)}</td>
                  <td style={{ textAlign: 'right' }} className="text-warning">{formatUSD(r.egresos)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }} className={neto >= 0 ? 'text-kaeru' : 'text-danger'}>
                    {formatUSD(neto)}
                  </td>
                  <td style={{ textAlign: 'right' }} className="text-muted">{r.movimientos}</td>
                  <td style={{ textAlign: 'right' }}>{formatUSD(r.saldo_cierre)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Filtros</div>
          <span className="text-muted" style={{ fontSize: 11 }}>{movs.length} mostrados de {count}</span>
        </div>
        <div className="stack-sm">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ marginRight: 8 }}>Periodo:</span>
            <button className={`btn btn-sm ${periodoFilter === 'all' ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => { setPeriodoFilter('all'); setPage(0); }}>Todos</button>
            {PERIODOS_ORDEN.map((p) => (
              <button key={p} className={`btn btn-sm ${periodoFilter === p ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => { setPeriodoFilter(p); setPage(0); }}>{p}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ marginRight: 8 }}>Tipo:</span>
            <button className={`btn btn-sm ${tipoFilter === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setTipoFilter('all'); setPage(0); }}>Todos</button>
            <button className={`btn btn-sm ${tipoFilter === 'credito' ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => { setTipoFilter('credito'); setPage(0); }}>Crédito</button>
            <button className={`btn btn-sm ${tipoFilter === 'debito' ? 'btn-danger' : 'btn-outline'}`} onClick={() => { setTipoFilter('debito'); setPage(0); }}>Débito</button>
          </div>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="card-title">Categoría auto-clasificada</label>
              <select
                className="ki-input"
                value={categoriaFilter}
                onChange={(e) => { setCategoriaFilter(e.target.value); setPage(0); }}
              >
                <option value="all">Todas las categorías</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 240px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="card-title">Buscar descripción</label>
              <input
                className="ki-input"
                placeholder="Ej. PEDIDOSYA, RENTA, TEF A ..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Movimientos</div>
          </div>
          {movs.length === 0 ? <EmptyCard message="Sin movimientos con los filtros actuales" /> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th>Conciliado</th>
                  </tr>
                </thead>
                <tbody>
                  {movs.map((m) => (
                    <tr key={m.id}>
                      <td className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(m.fecha)}</td>
                      <td style={{ fontSize: 12 }}>{m.descripcion}</td>
                      <td>
                        {m.categoria_sugerida && (
                          <span className="badge badge-muted" style={{ fontSize: 9 }}>
                            {m.categoria_sugerida.replace(/_/g, ' ')}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }} className={m.tipo === 'credito' ? 'text-kaeru' : 'text-warning'}>
                        {m.tipo === 'credito' ? '+' : ''}{formatUSD(m.monto)}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }} className="text-muted">{formatUSD(m.balance_post)}</td>
                      <td>{m.conciliado ? <span className="badge badge-kaeru">✓</span> : <span className="badge badge-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {movs.length < count && (
                <div style={{ textAlign: 'center', padding: 12 }}>
                  <button className="btn btn-outline" onClick={() => setPage(page + 1)}>
                    Cargar más ({Math.min(PAGE_SIZE, count - movs.length)} más)
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
