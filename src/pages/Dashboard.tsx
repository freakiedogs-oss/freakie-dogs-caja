import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
  LineChart, Line, AreaChart, Area
} from 'recharts';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { formatUSD, formatDate } from '@/lib/utils';

// ============================================================
// Dashboard v0.14.0 — Vista socios mejorada
// + Sparkline 30d en cada KPI
// + Comparativo MTD vs mes anterior con delta %
// + Card Utilidad neta del mes (con delta vs anterior)
// + Breakdown Mesa vs PeYa con %
// + Próximos eventos del mes (planilla, F-14, cierres)
// ============================================================

// Sparkline componente inline (sin axis, sin tooltip)
function Sparkline({ data, color = '#5fe0a9' }: { data: number[]; color?: string }) {
  const series = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#spark-${color})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Helper: pinta delta % con color (verde positivo, rojo negativo)
function DeltaPct({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (!isFinite(value) || value === 0) return <span className="text-muted">·</span>;
  const positivo = value >= 0;
  const arrow = positivo ? '▲' : '▼';
  const cls = positivo ? 'text-kaeru' : 'text-danger';
  return (
    <span className={cls} style={{ fontSize: 11, fontWeight: 600 }}>
      {arrow} {Math.abs(value).toFixed(1)}%{suffix}
    </span>
  );
}

// Helper: traduce 'YYYY-MM' a "Mar 26"
function formatMes(ym: string): string {
  if (!ym || ym.length < 7) return ym || '—';
  const [y, m] = ym.split('-');
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${meses[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

export default function Dashboard() {
  const m = useDashboardMetrics();

  if (m.loading) {
    return (
      <div className="stack">
        <div className="page-header">
          <div className="page-title">
            <span className="page-title-kanji">家</span>
            <div>
              <div className="page-title-text">Dashboard</div>
              <div className="page-title-sub">Cargando datos del schema kaeru…</div>
            </div>
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          ● Consultando Supabase…
        </div>
      </div>
    );
  }

  if (m.error) {
    return (
      <div className="stack">
        <div className="page-header">
          <div className="page-title">
            <span className="page-title-kanji text-danger">家</span>
            <div>
              <div className="page-title-text">Dashboard</div>
              <div className="page-title-sub text-danger">Error de conexión Supabase</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title text-danger">Error</div>
          <pre style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{m.error}</pre>
        </div>
      </div>
    );
  }

  // Sparkline split: últimos 15 días para KPI mes-actual, últimos 30 para tendencia
  const spark15 = m.sparkline30.slice(-15);

  return (
    <div className="stack">
      <div className="page-header">
        <div className="page-title">
          <span className="page-title-kanji">家</span>
          <div>
            <div className="page-title-text">Dashboard</div>
            <div className="page-title-sub">Vista live para socios · Schema kaeru</div>
          </div>
        </div>
        <div className="page-actions">
          <span className="badge badge-kaeru">Live ●</span>
        </div>
      </div>

      {/* ─── FILA 1 · KPIs principales con sparklines y deltas ─── */}
      <div className="card-grid card-grid-4">
        {/* Último día */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Último día con venta</div>
            <span className="badge badge-muted">{m.ultimoDia.fecha ? formatDate(m.ultimoDia.fecha) : '—'}</span>
          </div>
          <div className="metric-xl text-kaeru">{formatUSD(m.ultimoDia.total)}</div>
          <div className="metric-row">
            <span>Mesa: {formatUSD(m.ultimoDia.mesa)}</span>
            <span>·</span>
            <span>PeYa: {formatUSD(m.ultimoDia.peya)}</span>
          </div>
          <div className="metric-delta">{m.ultimoDia.tickets} tickets</div>
        </div>

        {/* MTD con sparkline + delta vs mes anterior */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Mes actual (MTD)</div>
            <DeltaPct value={m.mesAnterior.delta_total_pct} suffix=" vs prev" />
          </div>
          <div className="metric-xl">{formatUSD(m.mtd.total)}</div>
          <div className="metric-row">
            <span>{m.mtd.dias_operados} días · prom {formatUSD(m.mtd.promedio_diario)}</span>
          </div>
          <div style={{ marginTop: 6 }}><Sparkline data={spark15} color="#5fe0a9" /></div>
          <div className="metric-delta" style={{ marginTop: 4 }}>
            vs {formatMes(m.mesAnterior.mes)}: {formatUSD(m.mesAnterior.total)}
          </div>
        </div>

        {/* Utilidad neta del mes */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Utilidad neta {formatMes(m.utilidad.mes)}</div>
            <DeltaPct value={m.utilidad.delta_pct} suffix=" vs prev" />
          </div>
          <div className={`metric-xl ${m.utilidad.utilidad_neta >= 0 ? 'text-kaeru' : 'text-danger'}`}>
            {formatUSD(m.utilidad.utilidad_neta)}
          </div>
          <div className="metric-row">
            <span>Margen: {m.utilidad.margen_pct.toFixed(1)}%</span>
          </div>
          <div className="metric-delta" style={{ fontSize: 10 }}>
            Ing.neto {formatUSD(m.utilidad.ingreso_neto)} − COGS {formatUSD(m.utilidad.cogs)} − Pla {formatUSD(m.utilidad.planilla)}
          </div>
        </div>

        {/* Propinas semana */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Propinas semana</div>
            <span className="badge badge-purple">Próx. martes</span>
          </div>
          <div className="metric-xl text-purple">{formatUSD(m.propinasSemana.total)}</div>
          <div className="metric-row">
            <span>{m.propinasSemana.desde} → {m.propinasSemana.hasta}</span>
          </div>
          <div className="metric-delta text-muted">90% reparte · 10% casa</div>
        </div>
      </div>

      {/* ─── FILA 2 · Mesa vs PeYa breakdown ─── */}
      <div className="card-grid card-grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Canal MTD · Mesa vs PeYa</div>
            <span className="badge badge-muted">{formatUSD(m.mtd.total)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mesa</div>
              <div className="metric-md text-kaeru">{formatUSD(m.mtd.mesa)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.mtd.pct_mesa.toFixed(1)}% del total</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PeYa</div>
              <div className="metric-md text-purple">{formatUSD(m.mtd.peya)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.mtd.pct_peya.toFixed(1)}% del total</div>
            </div>
          </div>
          {/* Barra horizontal proporcional */}
          <div style={{ marginTop: 14, height: 12, background: 'rgba(244,240,230,0.08)', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${m.mtd.pct_mesa}%`, background: '#5fe0a9' }} />
            <div style={{ width: `${m.mtd.pct_peya}%`, background: '#9a6fd1' }} />
          </div>
        </div>

        {/* Tendencia 30 días */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Tendencia 30 días</div>
            <span className="badge badge-muted">Total diario</span>
          </div>
          {m.sparkline30.length === 0 ? (
            <div style={{ height: 160, display: 'grid', placeItems: 'center', color: 'var(--text-dim)' }}>Sin data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={m.sparkline30.map((v, i) => ({ i, v }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(244,240,230,0.06)" />
                <XAxis dataKey="i" stroke="#9a9690" fontSize={10} tickFormatter={(i) => `D${i + 1}`} />
                <YAxis stroke="#9a9690" fontSize={10} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#131313', border: '1px solid rgba(244,240,230,0.14)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#f4f0e6' }}
                  formatter={(v: number) => `$${v.toFixed(2)}`}
                />
                <Line type="monotone" dataKey="v" stroke="#5fe0a9" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── FILA 3 · 7 días + Top productos ─── */}
      <div className="card-grid card-grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Últimos 7 días · Mesa vs PeYa</div>
          </div>
          {m.ultimos7.length === 0 ? (
            <div style={{ height: 220, display: 'grid', placeItems: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
              Sin data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={m.ultimos7}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(244,240,230,0.06)" />
                <XAxis dataKey="fecha" stroke="#9a9690" fontSize={10} tickFormatter={(d) => d.slice(5)} />
                <YAxis stroke="#9a9690" fontSize={10} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#131313', border: '1px solid rgba(244,240,230,0.14)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#f4f0e6' }}
                  formatter={(v: number) => `$${v.toFixed(2)}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="mesa" stackId="a" fill="#5fe0a9" name="Mesa" />
                <Bar dataKey="peya" stackId="a" fill="#9a6fd1" name="PeYa" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Top productos del mes</div>
            <span className="badge badge-muted">Por revenue</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Producto</th>
                <th style={{ textAlign: 'right' }}>Vendidos</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {m.topProductos.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin ventas este mes</td></tr>
              ) : (
                m.topProductos.map((p, idx) => (
                  <tr key={p.codigo}>
                    <td style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}</td>
                    <td>{p.nombre}</td>
                    <td style={{ textAlign: 'right' }}>{p.vendidos.toFixed(0)}</td>
                    <td style={{ textAlign: 'right' }}>{formatUSD(p.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── FILA 4 · Próximos eventos + Hoy ─── */}
      <div className="card-grid card-grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Próximos eventos</div>
            <span className="badge badge-purple">Operación + fiscal</span>
          </div>
          <div style={{ marginTop: 4 }}>
            {m.proximosEventos.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>Sin eventos próximos</div>
            ) : (
              m.proximosEventos.map((ev) => {
                const diasDif = Math.ceil((new Date(ev.fecha).getTime() - Date.now()) / 86400000);
                const urgente = diasDif <= 2;
                return (
                  <div
                    key={`${ev.fecha}-${ev.titulo}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px solid rgba(244,240,230,0.06)',
                      fontSize: 13
                    }}
                  >
                    <span>
                      <span style={{ marginRight: 8, fontSize: 16 }}>{ev.emoji}</span>
                      {ev.titulo}
                    </span>
                    <span style={{ fontSize: 11, color: urgente ? 'var(--accent-purple)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {formatDate(ev.fecha)} · en {diasDif}d
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Hoy en operación</div>
            <span className="badge badge-kaeru">{m.hoy.tickets} tickets</span>
          </div>
          <div className="card-grid card-grid-2" style={{ marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ventas hoy</div>
              <div className="metric-md text-kaeru">{formatUSD(m.hoy.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ticket promedio</div>
              <div className="metric-md">{formatUSD(m.hoy.ticket_promedio)}</div>
            </div>
          </div>
          <div className="metric-delta" style={{ marginTop: 12 }}>
            Breakeven $700/día ·{' '}
            <span className={m.mtd.promedio_diario >= 700 ? 'text-kaeru' : 'text-warning'}>
              Promedio MTD: {formatUSD(m.mtd.promedio_diario)} ({((m.mtd.promedio_diario / 700 - 1) * 100).toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
