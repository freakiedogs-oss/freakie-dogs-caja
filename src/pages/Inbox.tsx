import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell, { LoadingCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';

// ============================================================
// /inbox — Bandeja in-app de notificaciones
// ------------------------------------------------------------
// Lee de kaeru.v_notif_activas (RLS filtra por rol/email).
// 4 tipos de severidad: danger (rojo), warning (ámbar), info (cream), success (verde).
// Acciones por fila:
//   ✓ Marcar leída  → notif_marcar_leida(id)
//   ✕ Resolver      → notif_resolver(id)
//   ↻ Barrer        → notif_barrer() (re-evalúa todos los generadores)
// ============================================================

interface Notif {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  severidad: 'danger' | 'warning' | 'info' | 'success';
  dirigido_a_rol: string | null;
  dirigido_a_email: string | null;
  leida_por_mi: boolean;
  link_app: string | null;
  payload: any;
  creada_en: string;
  resuelta_en: string | null;
}

const SEV_LABEL: Record<string, { label: string; color: string }> = {
  danger:  { label: '🚨 Crítica',     color: 'var(--state-danger, #e74c3c)' },
  warning: { label: '⚠ Atención',     color: '#f5b400' },
  info:    { label: 'ℹ Informativa',  color: 'var(--text-muted)' },
  success: { label: '✓ OK',           color: 'var(--accent-kaeru)' }
};

function tiempoRel(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1)   return 'ahora';
  if (diff === 1) return 'hace 1 min';
  if (diff < 60)  return `hace ${diff} min`;
  if (diff < 1440) {
    const h = Math.floor(diff / 60);
    return `hace ${h}h ${diff % 60}m`;
  }
  const d = Math.floor(diff / 1440);
  return `hace ${d}d`;
}

export default function Inbox() {
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'no_leidas' | 'todas'>('no_leidas');
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await kaeru
        .from('v_notif_activas')
        .select('*')
        .limit(200);
      if (cancel) return;
      if (err) setError(err.message);
      else     setItems((data || []) as unknown as Notif[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [tick]);

  async function marcarLeida(id: string) {
    setBusy(id);
    await kaeru.rpc('notif_marcar_leida', { p_id: id });
    setBusy(null);
    setTick((x) => x + 1);
  }

  async function resolver(id: string) {
    if (!confirm('¿Resolver esta alerta? Desaparecerá del inbox.')) return;
    setBusy(id);
    await kaeru.rpc('notif_resolver', { p_id: id });
    setBusy(null);
    setTick((x) => x + 1);
  }

  async function barrer() {
    setBusy('barrer');
    await kaeru.rpc('notif_barrer');
    setBusy(null);
    setTick((x) => x + 1);
  }

  const visibles = filtro === 'no_leidas'
    ? items.filter((n) => !n.leida_por_mi)
    : items;

  const noLeidas = items.filter((n) => !n.leida_por_mi).length;

  return (
    <PageShell
      kanji="函"
      titulo="Inbox"
      subtitulo={`${items.length} alertas activas · ${noLeidas} sin leer`}
      badge={
        noLeidas > 0
          ? { label: `${noLeidas} sin leer`, variant: 'purple' }
          : { label: '✓ Sin pendientes', variant: 'kaeru' }
      }
      actions={
        <div className="row" style={{ gap: 8 }}>
          <button
            onClick={() => setFiltro(filtro === 'no_leidas' ? 'todas' : 'no_leidas')}
            className="btn btn-outline btn-sm"
          >
            {filtro === 'no_leidas' ? 'Ver todas' : 'Solo no leídas'}
          </button>
          <button
            onClick={barrer}
            disabled={busy === 'barrer'}
            className="btn btn-kaeru btn-sm"
            title="Re-evaluar todos los generadores y crear/actualizar notificaciones"
          >
            {busy === 'barrer' ? '● Barriendo…' : '↻ Barrer alertas'}
          </button>
        </div>
      }
    >
      {/* KPIs por severidad */}
      <div className="card-grid card-grid-4">
        <KpiCard label="🚨 Críticas"     count={items.filter((n) => n.severidad === 'danger').length}  className="text-danger" />
        <KpiCard label="⚠ Atención"      count={items.filter((n) => n.severidad === 'warning').length} className="text-warning" />
        <KpiCard label="ℹ Informativas"  count={items.filter((n) => n.severidad === 'info').length}    className="text-muted" />
        <KpiCard label="✓ Resueltas hoy" count={0}                                                      className="text-kaeru" />
      </div>

      {loading && <LoadingCard />}
      {error && (
        <div className="card">
          <div className="card-title text-danger">Error</div>
          <pre style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{error}</pre>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Si dice "relation v_notif_activas does not exist", aplicá la migración{' '}
            <code>20260521_notificaciones_inbox.sql</code> a Supabase.
          </div>
        </div>
      )}
      {!loading && !error && visibles.length === 0 && (
        <EmptyCard message={filtro === 'no_leidas' ? 'Sin notificaciones sin leer ✓' : 'Sin notificaciones activas ✓'} />
      )}

      {/* Lista */}
      <div className="stack" style={{ gap: 8 }}>
        {visibles.map((n) => (
          <NotifRow
            key={n.id}
            n={n}
            busy={busy === n.id}
            onMarcarLeida={() => marcarLeida(n.id)}
            onResolver={() => resolver(n.id)}
          />
        ))}
      </div>

      <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)', marginTop: 16 }}>
        <div className="card-title text-purple" style={{ marginBottom: 8 }}>Generadores activos</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          • <strong>DTEs sin clasificar</strong> — facturas recibidas sin mapear a ingrediente (rompe COGS real)<br />
          • <strong>Stock bajo</strong> — ingredientes activos con <code>stock_actual &lt; stock_minimo</code><br />
          • <strong>Cierre pendiente</strong> — después de las 22:00 sin <code>cierre_caja</code> del día<br />
          • <strong>Planilla pendiente</strong> — quincenas en borrador hace +2 días<br />
          • <strong>DTE sin pago</strong> — DTE recibido sin TF saliente correspondiente<br />
          <br />
          Programar Apps Script <code>cron_notif_barrer.gs</code> cada 30 min para auto-evaluar.
        </div>
      </div>
    </PageShell>
  );
}

// ============================================================
function KpiCard({ label, count, className }: { label: string; count: number; className?: string }) {
  return (
    <div className="card">
      <div className="card-title">{label}</div>
      <div className={`metric-xl ${className || ''}`}>{count}</div>
    </div>
  );
}

function NotifRow({
  n, busy, onMarcarLeida, onResolver
}: {
  n: Notif;
  busy: boolean;
  onMarcarLeida: () => void;
  onResolver: () => void;
}) {
  const sev = SEV_LABEL[n.severidad] || SEV_LABEL.info;
  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${sev.color}`,
        opacity: n.leida_por_mi ? 0.65 : 1,
        background: n.leida_por_mi ? 'var(--bg-card)' : 'rgba(154,111,209,0.04)'
      }}
    >
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span className="badge" style={{ background: sev.color, color: 'var(--bg-base)', fontSize: 10 }}>
              {sev.label}
            </span>
            {n.dirigido_a_rol && <span className="badge badge-muted" style={{ fontSize: 10 }}>{n.dirigido_a_rol}</span>}
            <span className="text-muted" style={{ fontSize: 10 }}>{tiempoRel(n.creada_en)}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{n.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.mensaje}</div>
        </div>
        <div className="row" style={{ gap: 4, flexShrink: 0 }}>
          {n.link_app && (
            <Link to={n.link_app} className="btn btn-outline btn-sm">Abrir →</Link>
          )}
          {!n.leida_por_mi && (
            <button onClick={onMarcarLeida} disabled={busy} className="btn btn-ghost btn-sm" title="Marcar leída">
              ✓
            </button>
          )}
          <button onClick={onResolver} disabled={busy} className="btn btn-ghost btn-sm" title="Resolver y archivar">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
