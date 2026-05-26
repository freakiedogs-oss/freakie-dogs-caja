import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { kaeru } from '@/lib/supabase';
import { useSession, signOut } from '@/lib/auth';
import { formatUSD } from '@/lib/utils';
import {
  isKioskoMode,
  inicializarModoKioskoEnPagina,
  olvidarCredencialesKiosko,
  desactivarConfirmacionCierre
} from '@/lib/kiosko';

interface MesaConfig {
  code: string;
  zona: 'Interior' | 'Terraza' | 'PeYa';
  tipo: string;
  pax: number;
}

const MESAS: MesaConfig[] = [
  // PeYa virtual (4 órdenes simultáneas — alcanza para el ritmo de delivery)
  { code: 'PEYA-1', zona: 'PeYa', tipo: 'Delivery PeYa', pax: 0 },
  { code: 'PEYA-2', zona: 'PeYa', tipo: 'Delivery PeYa', pax: 0 },
  { code: 'PEYA-3', zona: 'PeYa', tipo: 'Delivery PeYa', pax: 0 },
  { code: 'PEYA-4', zona: 'PeYa', tipo: 'Delivery PeYa', pax: 0 },
  // Interior
  { code: 'INT-B1',  zona: 'Interior', tipo: 'Butaca 4',  pax: 4 },
  { code: 'INT-B2',  zona: 'Interior', tipo: 'Butaca 4',  pax: 4 },
  { code: 'INT-L1',  zona: 'Interior', tipo: 'Mesa 10',   pax: 10 },
  { code: 'INT-BR1', zona: 'Interior', tipo: 'Barra',     pax: 1 },
  { code: 'INT-BR2', zona: 'Interior', tipo: 'Barra',     pax: 1 },
  { code: 'INT-BR3', zona: 'Interior', tipo: 'Barra',     pax: 1 },
  // Terraza
  { code: 'TER-A1',  zona: 'Terraza',  tipo: 'Alta 4',    pax: 4 },
  { code: 'TER-A2',  zona: 'Terraza',  tipo: 'Alta 4',    pax: 4 },
  { code: 'TER-A3',  zona: 'Terraza',  tipo: 'Alta 4',    pax: 4 },
  { code: 'TER-A4',  zona: 'Terraza',  tipo: 'Alta 4',    pax: 4 },
  { code: 'TER-B1',  zona: 'Terraza',  tipo: 'Baja 4',    pax: 4 },
  { code: 'TER-B2',  zona: 'Terraza',  tipo: 'Baja 4',    pax: 4 },
  { code: 'TER-B3',  zona: 'Terraza',  tipo: 'Baja 4',    pax: 4 },
  { code: 'TER-B4',  zona: 'Terraza',  tipo: 'Baja 4',    pax: 4 },
  { code: 'TER-B5',  zona: 'Terraza',  tipo: 'Baja 4',    pax: 4 },
  { code: 'TER-G1',  zona: 'Terraza',  tipo: 'Grupal 6',  pax: 6 },
  { code: 'TER-G2',  zona: 'Terraza',  tipo: 'Grupal 6',  pax: 6 },
  { code: 'TER-G3',  zona: 'Terraza',  tipo: 'Grupal 6',  pax: 6 }
];

interface CuentaAbierta {
  mesa_numero: string;
  total_items: number;
  total_acumulado: number;
  created_at: string | null;
  pendientes_cocina: number;
  canal: 'mesa' | 'peya';
}

function fmtTiempoAbierta(iso: string | null): string {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'ahora';
  if (diff < 60) return `${diff}m`;
  const h = Math.floor(diff / 60);
  return `${h}h ${diff % 60}m`;
}

function tiempoMinutos(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export default function POS() {
  const { session } = useSession();
  const [cuentas, setCuentas] = useState<Record<string, CuentaAbierta>>({});
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const kiosko = isKioskoMode();

  useEffect(() => {
    const cleanup = inicializarModoKioskoEnPagina();
    return cleanup;
  }, []);

  async function cambiarMesero() {
    if (!confirm('¿Cambiar mesero? Se cerrará la sesión actual y se volverá al PIN pad.')) return;
    olvidarCredencialesKiosko();
    desactivarConfirmacionCierre();
    await signOut();
    window.location.href = '/login';
  }

  async function salirKiosko() {
    if (!confirm('¿Salir del modo kiosko? Esta acción debería hacerla solo un admin.')) return;
    desactivarConfirmacionCierre();
    await signOut();
    window.location.href = '/login?kiosko=off';
  }

  useEffect(() => {
    let cancel = false;
    async function refresh() {
      // Traer todas las cuentas abiertas (mesa + peya)
      const { data } = await kaeru
        .from('ventas')
        .select('id,mesa_numero,total,created_at,canal')
        .in('canal', ['mesa', 'peya'])
        .eq('estado', 'abierta');
      if (cancel) return;

      const map: Record<string, CuentaAbierta> = {};
      for (const v of (data || []) as any[]) {
        if (!v.mesa_numero) continue;
        const { count } = await kaeru
          .from('venta_detalles')
          .select('*', { count: 'exact', head: true })
          .eq('venta_id', v.id);
        const { count: pend } = await kaeru
          .from('venta_detalles')
          .select('*', { count: 'exact', head: true })
          .eq('venta_id', v.id)
          .eq('estado_cocina', 'pendiente');
        if (cancel) return;
        map[v.mesa_numero] = {
          mesa_numero: v.mesa_numero,
          total_items: count || 0,
          total_acumulado: Number(v.total || 0),
          created_at: v.created_at,
          pendientes_cocina: pend || 0,
          canal: v.canal
        };
      }
      setCuentas(map);
      setLoading(false);
    }
    refresh();
    const t = setInterval(() => setTick((x) => x + 1), 10_000);
    return () => { cancel = true; clearInterval(t); };
  }, [tick]);

  const peya = MESAS.filter((m) => m.zona === 'PeYa');
  const interior = MESAS.filter((m) => m.zona === 'Interior');
  const terraza = MESAS.filter((m) => m.zona === 'Terraza');
  const cuentasAbiertas = Object.keys(cuentas).length;
  const totalAcumuladoAbierto = Object.values(cuentas).reduce((s, c) => s + c.total_acumulado, 0);
  const peyaActivas = Object.values(cuentas).filter((c) => c.canal === 'peya').length;
  const mesaActivas = Object.values(cuentas).filter((c) => c.canal === 'mesa').length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)', gap: 8, flexWrap: 'wrap' }}>
        <div className="row">
          <span style={{ fontFamily: 'var(--font-kanji)', fontSize: 32, color: 'var(--accent-kaeru)' }}>蛙</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>POS Kaeru Chan</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {loading ? 'Cargando...' : (
                <>
                  {cuentasAbiertas} cuenta{cuentasAbiertas !== 1 ? 's' : ''} abierta{cuentasAbiertas !== 1 ? 's' : ''} ·{' '}
                  <span style={{ color: 'var(--accent-kaeru)' }}>🍜 {mesaActivas} mesa</span> ·{' '}
                  <span style={{ color: 'var(--accent-purple)' }}>🛵 {peyaActivas} PeYa</span> ·{' '}
                  {formatUSD(totalAcumuladoAbierto)}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {session && (
            <span className="text-muted" style={{ fontSize: 11 }}>{session.nombre_display}</span>
          )}
          {kiosko ? (
            <>
              <span className="badge badge-purple" style={{ fontSize: 10 }} title="Modo kiosko activo">KIOSKO</span>
              <button className="btn btn-outline btn-sm" onClick={cambiarMesero}>↻ Cambiar mesero</button>
              <button className="btn btn-ghost btn-sm" onClick={salirKiosko} title="Salir del modo kiosko (admin)">⎋ Admin</button>
            </>
          ) : (
            <>
              <Link to="/cocina" className="btn btn-outline btn-sm">厨 Cocina</Link>
              <Link to="/dashboard" className="btn btn-outline btn-sm">← ERP</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => signOut().then(() => window.location.href = '/login')}>⎋</button>
            </>
          )}
        </div>
      </header>

      {/* PeYa virtual */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--accent-purple)' }}>
          🛵 PeYa · órdenes delivery · {peyaActivas}/4 activas
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {peya.map((m) => <MesaCard key={m.code} mesa={m} cuenta={cuentas[m.code]} />)}
        </div>
      </section>

      {/* Interior */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)' }}>
          Interior · 6 mesas / 21 pax
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {interior.map((m) => <MesaCard key={m.code} mesa={m} cuenta={cuentas[m.code]} />)}
        </div>
      </section>

      {/* Terraza */}
      <section>
        <h3 style={{ marginBottom: 12, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)' }}>
          Terraza · 12 mesas / 54 pax
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {terraza.map((m) => <MesaCard key={m.code} mesa={m} cuenta={cuentas[m.code]} />)}
        </div>
      </section>
    </div>
  );
}

function MesaCard({ mesa, cuenta }: { mesa: MesaConfig; cuenta?: CuentaAbierta }) {
  const isOpen = !!cuenta;
  const isPeya = mesa.zona === 'PeYa';
  const minutos = isOpen ? tiempoMinutos(cuenta.created_at) : 0;
  const esVieja = minutos > 120; // >2h sin cobrar

  // Colores: cerrada=gris, abierta normal=púrpura, abierta PeYa=púrpura más fuerte+borde, abierta vieja=warning
  const borderColor = !isOpen
    ? 'var(--border-default)'
    : esVieja
      ? 'var(--state-warning, #e97a6a)'
      : isPeya
        ? 'var(--accent-purple)'
        : 'var(--accent-purple)';
  const bgColor = !isOpen
    ? 'var(--bg-card)'
    : esVieja
      ? 'rgba(233,122,106,0.12)'
      : isPeya
        ? 'rgba(154,111,209,0.18)'
        : 'rgba(154,111,209,0.15)';
  const titleColor = !isOpen
    ? (isPeya ? 'var(--accent-purple)' : 'var(--text-primary)')
    : esVieja
      ? 'var(--state-warning, #e97a6a)'
      : 'var(--accent-purple)';

  return (
    <Link
      to={`/pos/mesa/${encodeURIComponent(mesa.code)}`}
      style={{
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 'var(--r-lg)',
        padding: 16,
        textDecoration: 'none',
        color: 'var(--text-primary)',
        minHeight: 130,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        transition: 'all 0.15s',
        cursor: 'pointer'
      }}
    >
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ fontFamily: 'var(--font-metric)', fontSize: 22, lineHeight: 1, color: titleColor }}>
          {isPeya ? '🛵 ' : ''}{mesa.code}
        </div>
        {isOpen && (
          <span className="text-muted" style={{ fontSize: 10, fontWeight: 600 }}>
            ⏱ {fmtTiempoAbierta(cuenta.created_at)}
          </span>
        )}
      </div>
      <div className="text-muted" style={{ fontSize: 11 }}>
        {mesa.tipo}{!isPeya && ` · ${mesa.pax} pax`}
      </div>

      <div style={{ marginTop: 'auto' }}>
        {isOpen ? (
          <>
            <div className="text-kaeru" style={{ fontFamily: 'var(--font-metric)', fontSize: 18, lineHeight: 1 }}>
              {formatUSD(cuenta.total_acumulado)}
            </div>
            <div className="row" style={{ gap: 4, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="text-muted" style={{ fontSize: 10 }}>{cuenta.total_items} item{cuenta.total_items !== 1 ? 's' : ''}</span>
              {cuenta.pendientes_cocina > 0 && (
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-purple)', background: 'rgba(154,111,209,0.25)', padding: '1px 5px', borderRadius: 3 }}>
                  {cuenta.pendientes_cocina} en cocina
                </span>
              )}
            </div>
            <span className={`badge ${esVieja ? '' : 'badge-purple'}`} style={{
              marginTop: 4,
              background: esVieja ? 'rgba(233,122,106,0.2)' : undefined,
              color: esVieja ? 'var(--state-warning, #e97a6a)' : undefined
            }}>
              {esVieja ? `⚠ ABIERTA >${Math.floor(minutos/60)}h` : 'OCUPADA'}
            </span>
          </>
        ) : (
          <span className="badge badge-muted">{isPeya ? 'Libre · tap para crear orden' : 'Libre'}</span>
        )}
      </div>
    </Link>
  );
}
