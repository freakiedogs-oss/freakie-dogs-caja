import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kaeru } from '@/lib/supabase';
import { useSession, signOut } from '@/lib/auth';
import {
  isKioskoMode,
  inicializarModoKioskoEnPagina,
  olvidarCredencialesKiosko,
  desactivarConfirmacionCierre
} from '@/lib/kiosko';

interface ItemCocina {
  id: string;
  cantidad: number;
  producto_nombre: string;
  producto_codigo: string;
  notas: string | null;
  estado_cocina: 'pendiente' | 'listo';
  cocina_marcado_at: string | null;
  creado_en: string | null;
}
interface MesaConItems {
  venta_id: string;
  mesa_numero: string;
  canal: 'mesa' | 'peya';
  created_at: string | null;
  items: ItemCocina[];
  pendientes: number;
  listos: number;
}

const REFRESH_MS = 5000;

function fmtHaceMin(iso: string | null): string {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'ahora';
  if (diff === 1) return 'hace 1 min';
  if (diff < 60) return `hace ${diff} min`;
  const h = Math.floor(diff / 60);
  return `hace ${h}h ${diff % 60}m`;
}

export default function Cocina() {
  const { session } = useSession();
  const [mesas, setMesas] = useState<MesaConItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [hideListas, setHideListas] = useState(false);
  const [tick, setTick] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const kiosko = isKioskoMode();

  // Activar wake lock + fullscreen + confirmación de cierre si estamos en kiosko
  useEffect(() => inicializarModoKioskoEnPagina(), []);

  async function cambiarUsuario() {
    if (!confirm('¿Cambiar usuario de cocina?')) return;
    olvidarCredencialesKiosko();
    desactivarConfirmacionCierre();
    await signOut();
    window.location.href = '/login';
  }

  useEffect(() => {
    let cancel = false;
    async function refresh() {
      // 1. Cuentas abiertas en mesa + peya (PeYa virtual del POS)
      const { data: ventas } = await kaeru
        .from('ventas')
        .select('id,mesa_numero,created_at,canal')
        .in('canal', ['mesa', 'peya'])
        .eq('estado', 'abierta')
        .order('created_at', { ascending: true });

      if (cancel) return;

      if (!ventas || ventas.length === 0) {
        setMesas([]);
        setLoading(false);
        return;
      }

      // 2. Para cada venta, sus detalles con producto info + notas
      const ventaIds = (ventas as any[]).map((v) => v.id);
      const { data: dets } = await kaeru
        .from('venta_detalles')
        .select('id,venta_id,cantidad,notas,estado_cocina,cocina_marcado_at,creado_en,productos:producto_id(codigo,nombre)')
        .in('venta_id', ventaIds)
        .order('creado_en', { ascending: true });

      if (cancel) return;

      const byVenta = new Map<string, ItemCocina[]>();
      for (const d of (dets || []) as any[]) {
        const arr = byVenta.get(d.venta_id) || [];
        arr.push({
          id: d.id,
          cantidad: Number(d.cantidad),
          producto_nombre: d.productos?.nombre || '(sin nombre)',
          producto_codigo: d.productos?.codigo || '',
          notas: d.notas,
          estado_cocina: d.estado_cocina,
          cocina_marcado_at: d.cocina_marcado_at,
          creado_en: d.creado_en
        });
        byVenta.set(d.venta_id, arr);
      }

      const resultado: MesaConItems[] = (ventas as any[]).map((v) => {
        const items = byVenta.get(v.id) || [];
        return {
          venta_id: v.id,
          mesa_numero: v.mesa_numero || '?',
          canal: (v.canal === 'peya' ? 'peya' : 'mesa') as 'mesa' | 'peya',
          created_at: v.created_at,
          items,
          pendientes: items.filter((i) => i.estado_cocina === 'pendiente').length,
          listos: items.filter((i) => i.estado_cocina === 'listo').length
        };
      });

      // Orden: mesas con pendientes primero (más viejas arriba), luego solo listas
      resultado.sort((a, b) => {
        if (a.pendientes > 0 && b.pendientes === 0) return -1;
        if (a.pendientes === 0 && b.pendientes > 0) return 1;
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      });

      setMesas(resultado);
      setLoading(false);
    }
    refresh();
    const t = setInterval(() => setTick((x) => x + 1), REFRESH_MS);
    return () => { cancel = true; clearInterval(t); };
  }, [tick]);

  async function toggleItem(item: ItemCocina) {
    setSavingId(item.id);
    const nuevoEstado = item.estado_cocina === 'pendiente' ? 'listo' : 'pendiente';
    await kaeru.from('venta_detalles')
      .update({ estado_cocina: nuevoEstado, cocina_marcado_at: new Date().toISOString() })
      .eq('id', item.id);
    setSavingId(null);
    setTick((x) => x + 1);
  }

  const mesasVisibles = hideListas ? mesas.filter((m) => m.pendientes > 0) : mesas;
  const totalPendientes = mesas.reduce((s, m) => s + m.pendientes, 0);
  const totalMesasActivas = mesas.filter((m) => m.pendientes > 0).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', padding: 16 }}>
      {/* Header */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div className="row">
          <span style={{ fontFamily: 'var(--font-kanji)', fontSize: 32, color: 'var(--accent-kaeru)' }}>厨</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Cocina Kaeru Chan</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {loading ? 'Cargando...' :
                totalPendientes === 0 ? 'Sin comandas pendientes' :
                  `${totalPendientes} item${totalPendientes !== 1 ? 's' : ''} pendiente${totalPendientes !== 1 ? 's' : ''} en ${totalMesasActivas} mesa${totalMesasActivas !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={hideListas} onChange={(e) => setHideListas(e.target.checked)} />
            Ocultar mesas listas
          </label>
          {session && (
            <span className="text-muted" style={{ fontSize: 11 }}>{session.nombre_display}</span>
          )}
          {kiosko ? (
            <>
              <span className="badge badge-purple" style={{ fontSize: 10 }}>KIOSKO</span>
              <button className="btn btn-outline btn-sm" onClick={cambiarUsuario}>↻ Cambiar</button>
            </>
          ) : (
            <>
              <Link to="/dashboard" className="btn btn-outline btn-sm">← ERP</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => signOut().then(() => window.location.href = '/login')}>⎋</button>
            </>
          )}
        </div>
      </header>

      {/* Estado vacío */}
      {!loading && mesasVisibles.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)',
          borderRadius: 'var(--r-lg)', padding: 40, textAlign: 'center'
        }}>
          <div style={{ fontFamily: 'var(--font-kanji)', fontSize: 48, color: 'var(--accent-kaeru)', marginBottom: 8 }}>休</div>
          <div className="card-title">Sin comandas pendientes</div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Cuando los meseros agreguen items en `/pos/mesa/:codigo`, aparecerán aquí en tiempo real.
          </div>
        </div>
      )}

      {/* Grid de mesas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {mesasVisibles.map((m) => {
          const todoListo = m.pendientes === 0 && m.items.length > 0;
          const esPeya = m.canal === 'peya';
          return (
            <div key={m.venta_id} style={{
              background: todoListo
                ? 'rgba(95,224,169,0.08)'
                : esPeya
                  ? 'rgba(154,111,209,0.10)'
                  : 'var(--bg-card)',
              border: `1.5px solid ${todoListo ? 'var(--accent-kaeru)' : (m.pendientes > 0 ? 'var(--accent-purple)' : 'var(--border-default)')}`,
              borderRadius: 'var(--r-lg)',
              padding: 12,
              display: 'flex', flexDirection: 'column', gap: 8
            }}>
              {/* Mesa header */}
              <div className="row-between">
                <div>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    {esPeya && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent-purple)', background: 'rgba(154,111,209,0.25)', padding: '2px 6px', borderRadius: 4 }}>🛵 PEYA</span>
                    )}
                    <div style={{ fontFamily: 'var(--font-metric)', fontSize: 22, color: todoListo ? 'var(--accent-kaeru)' : (esPeya ? 'var(--accent-purple)' : 'var(--text-primary)') }}>{m.mesa_numero}</div>
                  </div>
                  <div className="text-muted" style={{ fontSize: 10 }}>Abierta {fmtHaceMin(m.created_at)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {m.pendientes > 0 ? (
                    <span className="badge badge-purple" style={{ fontSize: 11 }}>{m.pendientes} pendiente{m.pendientes !== 1 ? 's' : ''}</span>
                  ) : (
                    <span className="badge" style={{ background: 'rgba(95,224,169,0.2)', color: 'var(--accent-kaeru)', fontSize: 11 }}>✓ Mesa lista</span>
                  )}
                  {m.listos > 0 && m.pendientes > 0 && (
                    <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>{m.listos} listo{m.listos !== 1 ? 's' : ''}</div>
                  )}
                </div>
              </div>

              {/* Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {m.items.map((item) => {
                  const isPendiente = item.estado_cocina === 'pendiente';
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggleItem(item)}
                      disabled={savingId === item.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: isPendiente ? 'rgba(154,111,209,0.15)' : 'var(--bg-inset)',
                        border: `1px solid ${isPendiente ? 'var(--accent-purple)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--r-md)',
                        padding: '8px 10px',
                        cursor: savingId === item.id ? 'wait' : 'pointer',
                        opacity: savingId === item.id ? 0.5 : 1,
                        textAlign: 'left',
                        color: 'var(--text-primary)',
                        transition: 'all 0.15s'
                      }}
                    >
                      {/* Checkbox visual */}
                      <div style={{
                        width: 22, height: 22, minWidth: 22,
                        borderRadius: 4,
                        border: `2px solid ${isPendiente ? 'var(--accent-purple)' : 'var(--accent-kaeru)'}`,
                        background: isPendiente ? 'transparent' : 'var(--accent-kaeru)',
                        display: 'grid', placeItems: 'center',
                        color: 'var(--bg-base)', fontSize: 14, fontWeight: 900
                      }}>
                        {isPendiente ? '' : '✓'}
                      </div>

                      {/* Item info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 600, lineHeight: 1.25,
                          textDecoration: isPendiente ? 'none' : 'line-through',
                          color: isPendiente ? 'var(--text-primary)' : 'var(--text-muted)'
                        }}>
                          {item.cantidad}× {item.producto_nombre}
                        </div>
                        {item.notas && (
                          <div style={{
                            fontSize: 11, fontWeight: 600,
                            color: isPendiente ? 'var(--accent-purple)' : 'var(--text-muted)',
                            fontStyle: 'italic',
                            marginTop: 3, paddingLeft: 6,
                            borderLeft: `2px solid ${isPendiente ? 'var(--accent-purple)' : 'var(--border-subtle)'}`,
                            textDecoration: isPendiente ? 'none' : 'line-through'
                          }}>
                            ✎ {item.notas}
                          </div>
                        )}
                        <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>
                          {isPendiente
                            ? `Pedido ${fmtHaceMin(item.creado_en)}`
                            : `Listo ${fmtHaceMin(item.cocina_marcado_at)}`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div className="text-muted" style={{ textAlign: 'center', padding: 30 }}>
          ● Cargando comandas…
        </div>
      )}
    </div>
  );
}
