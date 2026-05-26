import { useEffect, useMemo, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { useKaeruQuery } from '@/hooks/useKaeruQuery';
import { kaeru } from '@/lib/supabase';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';

// ============================================================
// /conciliacion — 4 tabs
//   1. Resumen     — categorías agregadas de BAC
//   2. POS ↔ BAC   — match diario ventas tarjeta vs crédito BAC (T+1)
//   3. DTE ↔ Pago  — match DTE proveedor vs TF saliente
//   4. Planilla    — match planilla vs BAC (vista existente v_planilla_match_bac)
// ============================================================

type Tab = 'resumen' | 'pos_bac' | 'pago_proveedor' | 'planilla';

interface Movimiento {
  id: string;
  fecha: string;
  descripcion: string | null;
  monto: number;
  tipo: string;
  categoria_sugerida: string | null;
  conciliado: boolean | null;
  periodo: string | null;
}

interface PosBacRow {
  fecha_venta: string;
  n_tickets_tarjeta: number;
  total_tarjeta: number;
  bac_movimiento_id: string | null;
  bac_fecha_credito: string | null;
  bac_monto: number | null;
  bac_descripcion: string | null;
  dias_diferencia: number | null;
  dif_monto: number | null;
  match_status: 'match_perfecto' | 'match_aproximado' | 'discrepancia' | 'sin_match';
}

interface PagoProvRow {
  dte_id: string;
  dte_fecha: string;
  tipo_dte: string;
  numero_control: string | null;
  emisor_nit: string | null;
  emisor_nombre: string | null;
  dte_total: number;
  proveedor_nombre: string | null;
  bac_fecha_debito: string | null;
  bac_monto: number | null;
  bac_descripcion: string | null;
  dias_pago_post_dte: number | null;
  match_status: 'match_perfecto' | 'match_aproximado' | 'discrepancia' | 'sin_pago';
}

interface ResumenRow {
  dominio: string;
  total: number;
  perfecto: number;
  aproximado: number;
  discrepancia: number;
  sin_match: number;
  monto_sin_match: number;
}

const STATUS_COLOR: Record<string, string> = {
  match_perfecto:   'var(--accent-kaeru)',
  match_aproximado: '#f5b400',
  discrepancia:     'var(--state-danger, #e74c3c)',
  sin_match:        'var(--text-muted)',
  sin_pago:         'var(--state-danger, #e74c3c)'
};

const STATUS_LABEL: Record<string, string> = {
  match_perfecto:   '✓ Perfecto',
  match_aproximado: '≈ Aprox.',
  discrepancia:     '⚠ Discrep.',
  sin_match:        '✕ Sin match',
  sin_pago:         '✕ Sin pago'
};

export default function Conciliacion() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('resumen');
  const [resumen, setResumen] = useState<ResumenRow[]>([]);
  const [autoBusy, setAutoBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await kaeru.from('v_conciliacion_resumen').select('*');
      setResumen((data || []) as unknown as ResumenRow[]);
    })();
  }, [tick]);

  const totalSinMatch  = resumen.reduce((s, r) => s + Number(r.monto_sin_match || 0), 0);
  const totalPerfectos = resumen.reduce((s, r) => s + Number(r.perfecto || 0), 0);

  async function autoConciliarTodo() {
    if (!confirm(`¿Auto-conciliar ${totalPerfectos} match(es) perfecto(s)? Esto marca conciliado=true los créditos/débitos BAC que tienen match exacto contra ventas tarjeta o DTE proveedor.`)) return;
    setAutoBusy(true);
    const { data, error: err } = await kaeru.rpc('auto_conciliar_todo');
    setAutoBusy(false);
    if (err) {
      toast.error('Error al auto-conciliar: ' + err.message);
      return;
    }
    const conciliados = ((data || []) as any[]).reduce((s, r) => s + Number(r.conciliados || 0), 0);
    if (conciliados === 0) {
      toast.info('No había nada por conciliar (los matches ya estaban marcados)');
    } else {
      toast.success(`✓ ${conciliados} movimiento(s) BAC marcados como conciliados`);
    }
    setTick((x) => x + 1);
  }

  return (
    <PageShell
      kanji="対"
      titulo="Conciliación Bancaria"
      subtitulo="Match automático: POS↔BAC · DTE↔Pago · Planilla↔BAC"
      badge={
        totalSinMatch > 0
          ? { label: `${formatUSD(totalSinMatch)} sin match`, variant: 'warning' }
          : { label: '✓ Todo conciliado', variant: 'kaeru' }
      }
      actions={
        totalPerfectos > 0
          ? (
            <button
              onClick={autoConciliarTodo}
              disabled={autoBusy}
              className="btn btn-kaeru btn-sm"
              title="Marca conciliado=true los movimientos BAC que tienen match perfecto contra ventas o DTEs"
            >
              {autoBusy ? '● Conciliando…' : `✓ Auto-conciliar ${totalPerfectos} matches`}
            </button>
          )
          : undefined
      }
    >
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('resumen')}       className={`btn btn-sm ${tab === 'resumen'       ? 'btn-kaeru' : 'btn-outline'}`}>📊 Resumen BAC</button>
        <button onClick={() => setTab('pos_bac')}       className={`btn btn-sm ${tab === 'pos_bac'       ? 'btn-kaeru' : 'btn-outline'}`}>💳 POS ↔ BAC</button>
        <button onClick={() => setTab('pago_proveedor')} className={`btn btn-sm ${tab === 'pago_proveedor' ? 'btn-kaeru' : 'btn-outline'}`}>🧾 DTE ↔ Pago</button>
        <button onClick={() => setTab('planilla')}      className={`btn btn-sm ${tab === 'planilla'      ? 'btn-kaeru' : 'btn-outline'}`}>👥 Planilla ↔ BAC</button>
      </div>

      {tab === 'resumen'        && <TabResumenBAC />}
      {tab === 'pos_bac'        && <TabPosBac />}
      {tab === 'pago_proveedor' && <TabPagoProveedor />}
      {tab === 'planilla'       && <TabPlanilla />}
    </PageShell>
  );
}

// ============================================================
// TAB 1 — Resumen categorías BAC (versión previa)
// ============================================================
function TabResumenBAC() {
  const q = useKaeruQuery<Movimiento>('estados_cuenta_bancarios', {
    select: 'id,fecha,descripcion,monto,tipo,categoria_sugerida,conciliado,periodo',
    orderBy: { column: 'fecha', ascending: false },
    limit: 1500
  });

  if (q.loading) return <LoadingCard />;
  if (q.error) return <ErrorCard error={q.error} />;

  const porCategoria: Record<string, { count: number; total: number; conciliados: number }> = {};
  q.data.forEach((m) => {
    const cat = m.categoria_sugerida || 'sin_categoria';
    if (!porCategoria[cat]) porCategoria[cat] = { count: 0, total: 0, conciliados: 0 };
    porCategoria[cat].count++;
    porCategoria[cat].total += Math.abs(Number(m.monto || 0));
    if (m.conciliado) porCategoria[cat].conciliados++;
  });

  const categorias = Object.entries(porCategoria)
    .map(([nombre, stats]) => ({ nombre, ...stats }))
    .sort((a, b) => b.total - a.total);

  const totalConciliados = q.data.filter((m) => m.conciliado).length;

  return (
    <>
      <div className="card-grid card-grid-3">
        <div className="card"><div className="card-title">Movimientos totales</div><div className="metric-xl">{q.count}</div></div>
        <div className="card"><div className="card-title">Auto-clasificados</div><div className="metric-xl text-kaeru">{q.data.length - (porCategoria.sin_categoria?.count || 0)}</div></div>
        <div className="card"><div className="card-title">Sin categoría</div><div className="metric-xl text-warning">{porCategoria.sin_categoria?.count || 0}</div></div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Movimientos BAC por categoría auto-sugerida</div>
          <span className="badge badge-muted">{totalConciliados} conciliados</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th style={{ textAlign: 'right' }}>Movs</th>
              <th style={{ textAlign: 'right' }}>Total $</th>
              <th style={{ textAlign: 'right' }}>Conciliados</th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((c) => (
              <tr key={c.nombre}>
                <td style={{ fontWeight: 600 }}>{c.nombre.replace(/_/g, ' ')}</td>
                <td style={{ textAlign: 'right' }}>{c.count}</td>
                <td style={{ textAlign: 'right' }}>{formatUSD(c.total)}</td>
                <td style={{ textAlign: 'right' }} className={c.conciliados > 0 ? 'text-kaeru' : 'text-muted'}>{c.conciliados}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// TAB 2 — POS ↔ BAC (liquidación tarjeta T+1)
// ============================================================
function TabPosBac() {
  const [data, setData] = useState<PosBacRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'sin_match' | 'discrepancia'>('todos');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: rows, error: err } = await kaeru
        .from('v_pos_bac_match')
        .select('*')
        .limit(180);
      if (err) setError(err.message);
      setData((rows || []) as unknown as PosBacRow[]);
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingCard />;
  if (error) {
    return (
      <div className="card">
        <div className="card-title text-danger">Error</div>
        <pre style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{error}</pre>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Si dice "relation v_pos_bac_match does not exist", aplicá la migración{' '}
          <code>20260521_matchers_bac.sql</code>.
        </div>
      </div>
    );
  }
  if (data.length === 0) return <EmptyCard message="Sin ventas tarjeta para conciliar" />;

  const stats = {
    perfecto:    data.filter((r) => r.match_status === 'match_perfecto').length,
    aproximado:  data.filter((r) => r.match_status === 'match_aproximado').length,
    discrepancia: data.filter((r) => r.match_status === 'discrepancia').length,
    sin_match:   data.filter((r) => r.match_status === 'sin_match').length
  };
  const pctOk = data.length > 0 ? ((stats.perfecto + stats.aproximado) / data.length) * 100 : 0;

  const visibles = data.filter((r) => {
    if (filtro === 'sin_match')   return r.match_status === 'sin_match';
    if (filtro === 'discrepancia') return r.match_status === 'discrepancia';
    return true;
  });

  return (
    <>
      <div className="card-grid card-grid-4">
        <div className="card"><div className="card-title">✓ Perfecto</div><div className="metric-xl text-kaeru">{stats.perfecto}</div></div>
        <div className="card"><div className="card-title">≈ Aproximado</div><div className="metric-xl text-warning">{stats.aproximado}</div></div>
        <div className="card"><div className="card-title">⚠ Discrepancia</div><div className="metric-xl text-danger">{stats.discrepancia}</div></div>
        <div className="card"><div className="card-title">✕ Sin match</div><div className="metric-xl text-muted">{stats.sin_match}</div></div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <button onClick={() => setFiltro('todos')}        className={`btn btn-sm ${filtro === 'todos' ? 'btn-kaeru' : 'btn-outline'}`}>Todos ({data.length})</button>
        <button onClick={() => setFiltro('discrepancia')} className={`btn btn-sm ${filtro === 'discrepancia' ? 'btn-kaeru' : 'btn-outline'}`}>Discrepancias ({stats.discrepancia})</button>
        <button onClick={() => setFiltro('sin_match')}    className={`btn btn-sm ${filtro === 'sin_match' ? 'btn-kaeru' : 'btn-outline'}`}>Sin match ({stats.sin_match})</button>
        <span className="text-muted" style={{ fontSize: 11, marginLeft: 'auto', alignSelf: 'center' }}>{pctOk.toFixed(0)}% conciliado</span>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Match diario · Ventas tarjeta → Crédito BAC (T+1)</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Día venta</th>
                <th style={{ textAlign: 'right' }}>Tickets</th>
                <th style={{ textAlign: 'right' }}>Tarjeta $</th>
                <th>Fecha BAC</th>
                <th style={{ textAlign: 'right' }}>BAC $</th>
                <th style={{ textAlign: 'right' }}>Δ días</th>
                <th style={{ textAlign: 'right' }}>Δ $</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => (
                <tr key={r.fecha_venta}>
                  <td style={{ fontWeight: 700 }}>{formatDate(r.fecha_venta)}</td>
                  <td style={{ textAlign: 'right' }}>{r.n_tickets_tarjeta}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(r.total_tarjeta)}</td>
                  <td>{r.bac_fecha_credito ? formatDate(r.bac_fecha_credito) : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-kaeru)' }}>
                    {r.bac_monto != null ? formatUSD(r.bac_monto) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.dias_diferencia ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{r.dif_monto != null ? formatUSD(r.dif_monto) : '—'}</td>
                  <td>
                    <span className="badge" style={{
                      background: STATUS_COLOR[r.match_status],
                      color: 'var(--bg-base)',
                      fontSize: 10
                    }}>
                      {STATUS_LABEL[r.match_status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// TAB 3 — DTE ↔ Pago proveedor
// ============================================================
function TabPagoProveedor() {
  const [data, setData] = useState<PagoProvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'sin_pago' | 'discrepancia'>('sin_pago');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: rows, error: err } = await kaeru
        .from('v_pago_proveedor_match')
        .select('*')
        .limit(500);
      if (err) setError(err.message);
      setData((rows || []) as unknown as PagoProvRow[]);
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingCard />;
  if (error) {
    return (
      <div className="card">
        <div className="card-title text-danger">Error</div>
        <pre style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{error}</pre>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Aplicá la migración <code>20260521_matchers_bac.sql</code>.
        </div>
      </div>
    );
  }
  if (data.length === 0) return <EmptyCard message="Sin DTEs de proveedor para conciliar" />;

  const stats = {
    perfecto:     data.filter((r) => r.match_status === 'match_perfecto').length,
    aproximado:   data.filter((r) => r.match_status === 'match_aproximado').length,
    discrepancia: data.filter((r) => r.match_status === 'discrepancia').length,
    sin_pago:     data.filter((r) => r.match_status === 'sin_pago').length
  };
  const montoSinPago = data
    .filter((r) => r.match_status === 'sin_pago')
    .reduce((s, r) => s + Number(r.dte_total || 0), 0);

  const visibles = data.filter((r) => {
    if (filtro === 'sin_pago')     return r.match_status === 'sin_pago';
    if (filtro === 'discrepancia') return r.match_status === 'discrepancia';
    return true;
  });

  return (
    <>
      <div className="card-grid card-grid-4">
        <div className="card"><div className="card-title">✓ Pagados</div><div className="metric-xl text-kaeru">{stats.perfecto + stats.aproximado}</div></div>
        <div className="card"><div className="card-title">⚠ Discrepancia</div><div className="metric-xl text-warning">{stats.discrepancia}</div></div>
        <div className="card"><div className="card-title">✕ Sin pago</div><div className="metric-xl text-danger">{stats.sin_pago}</div></div>
        <div className="card"><div className="card-title">$ Por pagar</div><div className="metric-xl text-danger">{formatUSD(montoSinPago)}</div></div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <button onClick={() => setFiltro('sin_pago')}     className={`btn btn-sm ${filtro === 'sin_pago' ? 'btn-kaeru' : 'btn-outline'}`}>Sin pago ({stats.sin_pago})</button>
        <button onClick={() => setFiltro('discrepancia')} className={`btn btn-sm ${filtro === 'discrepancia' ? 'btn-kaeru' : 'btn-outline'}`}>Discrepancias ({stats.discrepancia})</button>
        <button onClick={() => setFiltro('todos')}        className={`btn btn-sm ${filtro === 'todos' ? 'btn-kaeru' : 'btn-outline'}`}>Todos ({data.length})</button>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Match · DTE proveedor → TF saliente BAC</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha DTE</th>
                <th>Proveedor</th>
                <th>NIT</th>
                <th style={{ textAlign: 'right' }}>DTE $</th>
                <th>Fecha pago</th>
                <th style={{ textAlign: 'right' }}>BAC $</th>
                <th style={{ textAlign: 'right' }}>Días</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => (
                <tr key={r.dte_id}>
                  <td>{r.dte_fecha && formatDate(r.dte_fecha)}</td>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{r.proveedor_nombre || r.emisor_nombre || '?'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.emisor_nit || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(r.dte_total)}</td>
                  <td>{r.bac_fecha_debito ? formatDate(r.bac_fecha_debito) : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-kaeru)' }}>
                    {r.bac_monto != null ? formatUSD(r.bac_monto) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.dias_pago_post_dte ?? '—'}</td>
                  <td>
                    <span className="badge" style={{
                      background: STATUS_COLOR[r.match_status],
                      color: 'var(--bg-base)',
                      fontSize: 10
                    }}>
                      {STATUS_LABEL[r.match_status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// TAB 4 — Planilla ↔ BAC (vista existente)
// ============================================================
function TabPlanilla() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: rows, error: err } = await kaeru
        .from('v_planilla_match_bac')
        .select('*')
        .order('quincena_inicio', { ascending: false })
        .limit(200);
      if (err) setError(err.message);
      setData(rows || []);
      setLoading(false);
    })();
  }, []);

  const counts = useMemo(() => {
    return {
      total: data.length,
      matcheadas: data.filter((r: any) => r.bac_movimiento_id != null).length
    };
  }, [data]);

  if (loading) return <LoadingCard />;
  if (error) {
    return (
      <div className="card">
        <div className="card-title text-danger">Error</div>
        <pre style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{error}</pre>
      </div>
    );
  }
  if (data.length === 0) return <EmptyCard message="Sin planillas para conciliar" />;

  return (
    <>
      <div className="card-grid card-grid-3">
        <div className="card"><div className="card-title">Total planilla</div><div className="metric-xl">{counts.total}</div></div>
        <div className="card"><div className="card-title">Matcheadas BAC</div><div className="metric-xl text-kaeru">{counts.matcheadas}</div></div>
        <div className="card"><div className="card-title">Sin match</div><div className="metric-xl text-warning">{counts.total - counts.matcheadas}</div></div>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Cruce planilla ↔ BAC (v_planilla_match_bac)</div>
          <span className="badge badge-kaeru">{Math.round((counts.matcheadas / counts.total) * 100)}% match</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>
          Vista existente desde v0.7.3. Mostrando últimas {data.length} filas — para detalle por empleado ir a <code>/planilla</code>.
        </div>
      </div>
    </>
  );
}
