import { useEffect, useMemo, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useToast } from '@/lib/toast';
import { formatUSD } from '@/lib/utils';

// ============================================================
// /gastos-consolidados — P&L de gastos por mes/categoría/grupo
// ------------------------------------------------------------
// Lee de kaeru.v_gastos_consolidados que agrupa todos los DTEs
// proveedor por mes + categoria + grupo. Útil para que los socios
// vean dónde se va la plata cada mes.
//
// Filtros: mes (default actual) · grupo · solo afectan_pl (default ON)
// ============================================================

interface FilaGasto {
  mes: string;
  categoria_id: string;
  categoria_nombre: string;
  categoria_grupo: string;
  categoria_emoji: string | null;
  afecta_pl: boolean;
  dtes: number;
  subtotal: number;
  iva: number;
  total_con_iva: number;
  auto_clasificados: number;
  manuales: number;
  sin_clasificar: number;
}

function mesActual(): string {
  const sv = new Date(Date.now() - 6 * 3600 * 1000);
  return `${sv.getUTCFullYear()}-${String(sv.getUTCMonth() + 1).padStart(2, '0')}`;
}

const GRUPO_ORDEN = ['COGS', 'Gasto Local', 'Gasto Admin', 'Planilla', 'Impuestos', 'Inversión', 'No Operativo', 'Pasivo', 'Sin Clasificar'];
const GRUPO_COLOR: Record<string, string> = {
  'COGS':            'var(--state-danger,#e74c3c)',
  'Gasto Local':     '#f5b400',
  'Gasto Admin':     'var(--accent-purple)',
  'Planilla':        '#3b82f6',
  'Impuestos':       '#9333ea',
  'Inversión':       'var(--accent-kaeru)',
  'No Operativo':    'var(--text-muted)',
  'Pasivo':          'var(--text-dim)',
  'Sin Clasificar':  '#ff6b6b',
};

export default function GastosConsolidados() {
  const toast = useToast();
  const [rows, setRows] = useState<FilaGasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mes, setMes] = useState<string>(mesActual());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await kaeru.from('v_gastos_consolidados').select('*').limit(1000);
      if (cancel) return;
      if (err) setError(err.message);
      else     setRows((data || []) as unknown as FilaGasto[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [refreshing]);

  async function reaplicarReglas() {
    if (!confirm('Aplicar reglas auto-clasificación a TODOS los DTEs?\nLos ya clasificados manualmente NO se tocan.')) return;
    const { data, error: err } = await kaeru.rpc('dte_aplicar_reglas');
    if (err) { toast.error('Error: ' + err.message); return; }
    const r = (Array.isArray(data) && data.length > 0 ? data[0] : null) as any;
    if (r) {
      toast.success(`✓ ${r.total_procesados} DTEs · auto ${r.clasificados_auto} · sin match ${r.sin_match} · ya clasificados ${r.ya_clasificados}`);
    }
    setRefreshing((x) => !x);
  }

  const mesesUnicos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.mes))).sort().reverse(),
    [rows]
  );

  const filasDelMes = useMemo(
    () => rows.filter((r) => r.mes === mes),
    [rows, mes]
  );

  const porGrupo = useMemo(() => {
    const grupos = new Map<string, { categorias: FilaGasto[]; total_grupo: number; dtes_grupo: number }>();
    for (const r of filasDelMes) {
      if (!grupos.has(r.categoria_grupo)) {
        grupos.set(r.categoria_grupo, { categorias: [], total_grupo: 0, dtes_grupo: 0 });
      }
      const g = grupos.get(r.categoria_grupo)!;
      g.categorias.push(r);
      g.total_grupo += Number(r.total_con_iva);
      g.dtes_grupo += r.dtes;
    }
    return Array.from(grupos.entries())
      .map(([nombre, data]) => ({ nombre, ...data }))
      .sort((a, b) => GRUPO_ORDEN.indexOf(a.nombre) - GRUPO_ORDEN.indexOf(b.nombre));
  }, [filasDelMes]);

  const totalMes      = filasDelMes.reduce((s, r) => s + Number(r.total_con_iva), 0);
  const totalAfectaPl = filasDelMes.filter((r) => r.afecta_pl).reduce((s, r) => s + Number(r.total_con_iva), 0);
  const dtesMes       = filasDelMes.reduce((s, r) => s + r.dtes, 0);
  const sinClasif     = filasDelMes.find((r) => r.categoria_id === 'sin_clasificar');

  return (
    <PageShell
      kanji="損"
      titulo="Gastos Consolidados"
      subtitulo={`P&L gastos por categoría · ${dtesMes} DTEs en ${mes}`}
      badge={
        sinClasif
          ? { label: `${sinClasif.dtes} sin clasificar`, variant: 'warning' }
          : { label: '✓ todo clasificado', variant: 'kaeru' }
      }
      actions={
        <div className="row" style={{ gap: 8 }}>
          <select value={mes} onChange={(e) => setMes(e.target.value)} className="ki-input" style={{ maxWidth: 130 }}>
            {mesesUnicos.length === 0 && <option value={mes}>{mes}</option>}
            {mesesUnicos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={reaplicarReglas} className="btn btn-outline btn-sm" title="Re-aplicar reglas auto a DTEs sin clasificar">
            🪄 Aplicar reglas
          </button>
        </div>
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && filasDelMes.length === 0 && (
        <EmptyCard message={`Sin gastos clasificados en ${mes}. Probá "🪄 Aplicar reglas" para auto-clasificar los DTEs existentes.`} />
      )}

      {!loading && !error && filasDelMes.length > 0 && (
        <>
          {/* Resumen */}
          <div className="card-grid card-grid-3">
            <div className="card">
              <div className="card-title">Total gastos mes</div>
              <div className="metric-xl text-danger">{formatUSD(totalMes)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{dtesMes} DTEs · IVA incluido</div>
            </div>
            <div className="card">
              <div className="card-title">Afecta P&L</div>
              <div className="metric-xl">{formatUSD(totalAfectaPl)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>excluye Pasivo y Sin Clasificar</div>
            </div>
            <div className="card">
              <div className="card-title">Sin clasificar</div>
              <div className="metric-xl text-warning">
                {sinClasif ? formatUSD(sinClasif.total_con_iva) : '$0.00'}
              </div>
              <div className="text-muted" style={{ fontSize: 11 }}>{sinClasif?.dtes || 0} DTEs requieren revisión</div>
            </div>
          </div>

          {/* Desglose por grupo */}
          {porGrupo.map((g) => {
            const color = GRUPO_COLOR[g.nombre] || 'var(--text-muted)';
            const pct = totalMes > 0 ? (g.total_grupo / totalMes) * 100 : 0;
            return (
              <div key={g.nombre} className="card" style={{ borderLeft: `4px solid ${color}` }}>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <div>
                    <div className="card-title">{g.nombre}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{g.dtes_grupo} DTEs · {pct.toFixed(1)}% del mes</div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-metric)', fontSize: 22, fontWeight: 700, color }}>
                    {formatUSD(g.total_grupo)}
                  </div>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Categoría</th>
                      <th style={{ textAlign: 'right' }}>DTEs</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                      <th style={{ textAlign: 'right' }}>IVA</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>% mes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.categorias.map((c) => {
                      const pctCat = totalMes > 0 ? (Number(c.total_con_iva) / totalMes) * 100 : 0;
                      return (
                        <tr key={c.categoria_id}>
                          <td style={{ fontWeight: 600 }}>
                            <span style={{ marginRight: 6 }}>{c.categoria_emoji || ''}</span>
                            {c.categoria_nombre}
                            {c.sin_clasificar > 0 && (
                              <span className="badge badge-warning" style={{ fontSize: 9, marginLeft: 6 }}>⚠ sin match</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>{c.dtes}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(c.subtotal)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(c.iva)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700 }}>{formatUSD(c.total_con_iva)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>{pctCat.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          {/* Info */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>ℹ Cómo se clasifican</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              • Los DTEs entrantes se clasifican <strong>automáticamente</strong> usando reglas en <code>kaeru.dte_reglas_clasificacion</code> (match por NIT preferido, regex por nombre como fallback).<br />
              • Para clasificar manualmente o aprender una regla nueva, ir a <code>/dtes</code> → drawer → seleccionar categoría + ✓ "Aprender".<br />
              • Los DTEs en <span className="badge badge-warning" style={{ fontSize: 9 }}>sin match</span> requieren clasificación manual.<br />
              • Botón "🪄 Aplicar reglas" arriba re-procesa todos los pendientes con las reglas actuales.
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
