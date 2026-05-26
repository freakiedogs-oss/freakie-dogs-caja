import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useToast } from '@/lib/toast';
import { APP_VERSION } from '@/lib/version';
import { formatUSD } from '@/lib/utils';

// ============================================================
// /devops — Health monitor del ERP Kaeru
// ------------------------------------------------------------
// Inspirado en DevOpsTab.jsx de Freakies, simplificado para
// la escala mono-sucursal de Kaeru. 6 KPIs:
//
//   1. DTE ingest         — última factura recibida vía gmail_dte_to_supabase
//   2. Ventas hoy         — # ventas cerradas hoy
//   3. Cierre del día     — si existe cierre_caja del día (después de las 22:00)
//   4. Planilla           — última planilla creada
//   5. Inbox notif        — # notificaciones activas no resueltas
//   6. Auth y BD          — health check del schema kaeru
//
// Cada KPI tiene semáforo 🟢🟡🔴 con umbrales claros.
// ============================================================

interface KpiState {
  label: string;
  emoji: string;          // 🟢🟡🔴⏳
  color: string;          // var --accent-kaeru | warning | danger
  big: string;            // valor grande
  sub: string;            // detalle
  link?: string;          // ruta in-app si aplica
}

const COLORS = {
  ok:      'var(--accent-kaeru)',
  warn:    'var(--state-warning, #f5b400)',
  danger:  'var(--state-danger, #e74c3c)',
  loading: 'var(--text-muted)',
};

function tiempoRel(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1)   return 'recién';
  if (diff < 60)  return `hace ${diff} min`;
  if (diff < 1440) {
    const h = Math.floor(diff / 60);
    return `hace ${h}h`;
  }
  const d = Math.floor(diff / 1440);
  return `hace ${d}d`;
}

function horaSV(): number {
  // El Salvador UTC-6, sin DST.
  const sv = new Date(Date.now() - 6 * 3600 * 1000);
  return sv.getUTCHours();
}

export default function DevOps() {
  const toast = useToast();
  const [kpis, setKpis] = useState<KpiState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  async function loadKpis() {
    setRefreshing(true);
    setError(null);
    try {
      const [
        dte,
        ventas24h,
        cierreHoy,
        planilla,
        notif,
        healthBd,
      ] = await Promise.all([
        kaeru.from('compras_dte').select('importado_en', { count: 'exact', head: true }).order('importado_en', { ascending: false }).limit(1),
        kaeru.from('ventas').select('id', { count: 'exact', head: true }).gte('fecha_hora', new Date(Date.now() - 24*3600*1000).toISOString()).eq('estado', 'cerrada'),
        kaeru.from('cierre_caja').select('fecha,total_esperado,efectivo_contado,diferencia').order('fecha', { ascending: false }).limit(1),
        kaeru.from('planilla').select('created_at,estado,quincena_inicio').order('created_at', { ascending: false }).limit(1),
        kaeru.from('notificaciones').select('id,severidad', { count: 'exact', head: false }).is('resuelta_en', null),
        kaeru.from('user_roles').select('email').limit(1)
      ]);

      // 1. DTE ingest
      const { data: dteData } = await kaeru.from('compras_dte').select('importado_en').order('importado_en', { ascending: false }).limit(1).maybeSingle();
      const lastDte = (dteData as any)?.importado_en ?? null;
      const dteMin = lastDte ? Math.floor((Date.now() - new Date(lastDte).getTime()) / 60000) : Infinity;
      let dteKpi: KpiState;
      if (lastDte && dteMin < 120) {
        dteKpi = { label: 'DTE ingest', emoji: '🟢', color: COLORS.ok, big: tiempoRel(lastDte), sub: `${dte.count ?? 0} DTEs en total`, link: '/dtes' };
      } else if (lastDte && dteMin < 1440) {
        dteKpi = { label: 'DTE ingest', emoji: '🟡', color: COLORS.warn, big: tiempoRel(lastDte), sub: `${dte.count ?? 0} DTEs · cron cada 30min`, link: '/dtes' };
      } else {
        dteKpi = { label: 'DTE ingest', emoji: '🔴', color: COLORS.danger, big: tiempoRel(lastDte), sub: `verificar cron gmail_dte_to_supabase`, link: '/dtes' };
      }

      // 2. Ventas 24h
      const ventas24Count = ventas24h.count ?? 0;
      const ventasKpi: KpiState = {
        label: 'Ventas 24h',
        emoji: ventas24Count > 0 ? '🟢' : '🟡',
        color: ventas24Count > 0 ? COLORS.ok : COLORS.warn,
        big: String(ventas24Count),
        sub: ventas24Count > 0 ? 'cerradas en las últimas 24h' : 'sin ventas cerradas — verificar POS',
        link: '/ventas'
      };

      // 3. Cierre del día
      const cierreData = ((cierreHoy.data || []) as any[])[0];
      const hora = horaSV();
      const hoyStr = (() => {
        const sv = new Date(Date.now() - 6 * 3600 * 1000);
        return sv.toISOString().split('T')[0];
      })();
      const tieneHoy = cierreData?.fecha === hoyStr;
      let cierreKpi: KpiState;
      if (tieneHoy) {
        const dif = Math.abs(Number(cierreData?.diferencia ?? 0));
        cierreKpi = {
          label: 'Cierre del día',
          emoji: dif < 5 ? '🟢' : '🟡',
          color: dif < 5 ? COLORS.ok : COLORS.warn,
          big: dif < 5 ? '✓' : '±' + formatUSD(dif),
          sub: `cerrado hoy · esperado ${formatUSD(cierreData?.total_esperado ?? 0)}`,
          link: '/cierre'
        };
      } else if (hora >= 22) {
        cierreKpi = {
          label: 'Cierre del día',
          emoji: '🔴',
          color: COLORS.danger,
          big: 'falta',
          sub: 'pasadas las 22h sin cierre — BAC no liquida',
          link: '/cierre'
        };
      } else {
        cierreKpi = {
          label: 'Cierre del día',
          emoji: '⏳',
          color: COLORS.loading,
          big: 'pendiente',
          sub: `cerrar después del último servicio`,
          link: '/cierre'
        };
      }

      // 4. Planilla
      const planData = ((planilla.data || []) as any[])[0];
      const planKpi: KpiState = {
        label: 'Planilla',
        emoji: planData ? '🟢' : '🟡',
        color: planData ? COLORS.ok : COLORS.warn,
        big: planData ? tiempoRel(planData.created_at) : 'sin data',
        sub: planData ? `última quincena ${planData.quincena_inicio} · estado ${planData.estado}` : 'no hay planillas calculadas',
        link: '/planilla'
      };

      // 5. Inbox
      const notifData = (notif.data || []) as any[];
      const notifDanger = notifData.filter((n) => n.severidad === 'danger').length;
      const notifWarn   = notifData.filter((n) => n.severidad === 'warning').length;
      const notifKpi: KpiState = {
        label: 'Inbox activo',
        emoji: notifDanger > 0 ? '🔴' : notifWarn > 0 ? '🟡' : '🟢',
        color: notifDanger > 0 ? COLORS.danger : notifWarn > 0 ? COLORS.warn : COLORS.ok,
        big: String(notif.count ?? 0),
        sub: notifDanger > 0
          ? `${notifDanger} críticas · ${notifWarn} atención`
          : notifWarn > 0
          ? `${notifWarn} alertas de atención`
          : 'todo limpio',
        link: '/inbox'
      };

      // 6. Health BD
      const bdKpi: KpiState = {
        label: 'BD Supabase',
        emoji: healthBd.error ? '🔴' : '🟢',
        color: healthBd.error ? COLORS.danger : COLORS.ok,
        big: healthBd.error ? 'fail' : 'OK',
        sub: healthBd.error ? healthBd.error.message : 'schema kaeru responde',
      };

      setKpis([dteKpi, ventasKpi, cierreKpi, planKpi, notifKpi, bdKpi]);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadKpis();
    // auto-refresh cada 60s (solo si la pestaña está visible)
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadKpis();
      }
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allOk    = kpis.length > 0 && kpis.every((k) => k.emoji === '🟢');
  const hayRojo  = kpis.some((k) => k.emoji === '🔴');
  const hayAmar  = kpis.some((k) => k.emoji === '🟡');

  async function correrBarrer() {
    setRefreshing(true);
    const { error: err } = await kaeru.rpc('notif_barrer');
    if (err) {
      toast.error('Error al barrer notificaciones: ' + err.message);
    } else {
      toast.success('Barrido manual completado ✓');
      await loadKpis();
    }
    setRefreshing(false);
  }

  return (
    <PageShell
      kanji="守"
      titulo="DevOps"
      subtitulo="Health monitor del ERP Kaeru · auto-refresh cada 60s"
      badge={
        loading
          ? { label: 'cargando…', variant: 'muted' }
          : hayRojo
          ? { label: '🔴 problema crítico', variant: 'danger' }
          : hayAmar
          ? { label: '🟡 atención', variant: 'warning' }
          : allOk
          ? { label: '🟢 todo OK', variant: 'kaeru' }
          : { label: 'sin data', variant: 'muted' }
      }
      actions={
        <div className="row" style={{ gap: 8 }}>
          <span className="text-muted" style={{ fontSize: 11 }}>
            actualizado {tiempoRel(lastRefresh.toISOString())}
          </span>
          <button onClick={loadKpis} disabled={refreshing} className="btn btn-outline btn-sm">
            {refreshing ? '● refresh…' : '↻ refresh'}
          </button>
          <button onClick={correrBarrer} disabled={refreshing} className="btn btn-kaeru btn-sm" title="Re-evaluar generadores del Inbox">
            ↻ Barrer Inbox
          </button>
        </div>
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && (
        <>
          {/* Grid KPIs */}
          <div className="card-grid card-grid-3">
            {kpis.map((k) => (
              <KpiCard key={k.label} kpi={k} />
            ))}
          </div>

          {/* Info sistema */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">📦 Versión & entorno</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
              <InfoCell label="Versión app"   value={APP_VERSION} mono />
              <InfoCell label="Schema BD"     value="kaeru" mono />
              <InfoCell label="App"           value="kaeru-chan-erp.vercel.app" mono />
              <InfoCell label="Supabase"      value="btboxlwfqcbrdfrlnwln" mono />
              <InfoCell label="Telegram bot"  value="@FreakieDogsMonitor" mono />
              <InfoCell label="Chat alertas"  value="8547715106" mono />
            </div>
          </div>

          {/* Atajos diagnóstico */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>🔧 Atajos</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a href="https://supabase.com/dashboard/project/btboxlwfqcbrdfrlnwln" target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                Supabase dashboard →
              </a>
              <a href="https://vercel.com/freakiedogs-oss/kaeru-chan-erp" target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                Vercel project →
              </a>
              <a href="https://github.com/freakiedogs-oss/kaeru-chan-erp" target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                GitHub repo →
              </a>
              <a href="https://script.google.com" target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                Apps Script →
              </a>
              <a href="https://t.me/FreakieDogsMonitor" target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                Bot Telegram →
              </a>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

// ============================================================
function KpiCard({ kpi }: { kpi: KpiState }) {
  const inner = (
    <>
      <div className="row-between">
        <div className="card-title">{kpi.label}</div>
        <span style={{ fontSize: 16 }}>{kpi.emoji}</span>
      </div>
      <div className="metric-xl" style={{ color: kpi.color }}>{kpi.big}</div>
      <div className="text-muted" style={{ fontSize: 11 }}>{kpi.sub}</div>
    </>
  );

  if (kpi.link) {
    return (
      <a href={kpi.link} className="card" style={{
        textDecoration: 'none',
        color: 'inherit',
        borderLeft: `4px solid ${kpi.color}`,
        cursor: 'pointer'
      }}>
        {inner}
      </a>
    );
  }
  return (
    <div className="card" style={{ borderLeft: `4px solid ${kpi.color}` }}>
      {inner}
    </div>
  );
}

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: mono ? 'monospace' : 'inherit', marginTop: 2 }}>{value}</div>
    </div>
  );
}
