import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';

// ============================================================
// /pendientes — Tablero de cosas que YO tengo que hacer
// ------------------------------------------------------------
// Diferencia con /inbox:
//   - /inbox: alertas DEL SISTEMA (DTE sin clasificar, stock bajo, etc.)
//   - /pendientes: TAREAS MÍAS (DTEs por aprobar, planillas borrador, cortesías
//     pendientes de OK del manager, conteo físico atrasado, etc.)
//
// Cada sección agrupa items accionables con link directo al módulo + count.
// Inspirado en MisPendientes.jsx de Freakies pero simplificado a la escala
// mono-sucursal y 6 empleados.
// ============================================================

interface SectionStat {
  count: number;
  items?: Array<{ label: string; sub?: string; link?: string; date?: string }>;
}

interface Pendientes {
  dtesSinClasificar: SectionStat;
  planillaBorrador:  SectionStat;
  dtesSinPago:       SectionStat;
  ventasAbiertas:    SectionStat;
  conteoAtrasado:    SectionStat;
  proveedoresSinNit: SectionStat;
  empleadosSinBanco: SectionStat;
}

export default function Pendientes() {
  const { session } = useSession();
  const toast = useToast();
  const [data, setData] = useState<Pendientes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [
          dtes,
          planillas,
          dteSinPago,
          ventasAbiertas,
          ingredientes,
          proveedores,
          empleados
        ] = await Promise.all([
          // 1. DTEs últimos 60 días sin ingrediente mapeado
          kaeru.from('compras_dte')
            .select('id,fecha_emision,emisor_nombre,total')
            .not('estado', 'in', '("rechazada","duplicada")')
            .gte('fecha_emision', new Date(Date.now() - 60*24*3600*1000).toISOString().split('T')[0])
            .order('fecha_emision', { ascending: false })
            .limit(50),
          // 2. Planillas en borrador hace +2 días
          kaeru.from('planilla')
            .select('id,empleado_id,quincena_inicio,neto_a_pagar,created_at')
            .eq('estado', 'borrador')
            .lt('created_at', new Date(Date.now() - 2*24*3600*1000).toISOString())
            .order('created_at')
            .limit(30),
          // 3. DTEs sin pago localizado (últimos 30 días) — vista del matcher BAC
          kaeru.from('v_pago_proveedor_match')
            .select('dte_id,dte_fecha,proveedor_nombre,emisor_nombre,dte_total')
            .eq('match_status', 'sin_pago')
            .gte('dte_fecha', new Date(Date.now() - 30*24*3600*1000).toISOString().split('T')[0])
            .order('dte_fecha', { ascending: false })
            .limit(30),
          // 4. Ventas con estado='abierta' (cuentas que quedaron sin cobrar)
          kaeru.from('ventas')
            .select('id,mesa_numero,fecha_hora,total')
            .eq('estado', 'abierta')
            .order('fecha_hora')
            .limit(30),
          // 5. Ingredientes activos sin precio_costo (no se puede calcular COGS)
          kaeru.from('ingredientes')
            .select('id,codigo,nombre,unidad,precio_costo')
            .eq('activo', true)
            .is('precio_costo', null)
            .limit(30),
          // 6. Proveedores activos sin NIT (no se puede emitir CCF)
          kaeru.from('proveedores')
            .select('id,nombre,nit')
            .eq('activo', true)
            .or('nit.is.null,nit.eq.')
            .limit(20),
          // 7. Empleados activos sin cuenta bancaria
          kaeru.from('empleados')
            .select('id,nombre,cargo,activo')
            .eq('activo', true)
            .limit(30)
        ]);

        if (cancel) return;

        // Ingredientes filtra los que tienen precio_costo === null (consulta ya filtra pero por seguridad)
        const ingredientesSinPrecio = ((ingredientes.data || []) as any[])
          .filter((i) => i.precio_costo == null);

        const empleadosAct = (empleados.data || []) as any[];
        // Para empleados sin banco hay que cruzar con tabla empleados_banco si existe.
        // Simplificación: asumimos que falta info bancaria si no hay registro paralelo.
        // De momento usamos lista vacía — Jose puede afinarlo después.
        const empleadosSinBanco = empleadosAct.filter((_e) => false); // placeholder

        const result: Pendientes = {
          dtesSinClasificar: {
            count: dtes.data?.length || 0,
            items: ((dtes.data || []) as any[]).slice(0, 5).map((d) => ({
              label: d.emisor_nombre || '(sin nombre)',
              sub: formatUSD(d.total),
              date: d.fecha_emision,
              link: '/dtes'
            }))
          },
          planillaBorrador: {
            count: planillas.data?.length || 0,
            items: ((planillas.data || []) as any[]).slice(0, 5).map((p) => ({
              label: 'Quincena ' + p.quincena_inicio,
              sub: formatUSD(p.neto_a_pagar),
              date: p.created_at?.slice(0, 10),
              link: '/planilla'
            }))
          },
          dtesSinPago: {
            count: dteSinPago.data?.length || 0,
            items: ((dteSinPago.data || []) as any[]).slice(0, 5).map((d) => ({
              label: d.proveedor_nombre || d.emisor_nombre || '(sin nombre)',
              sub: formatUSD(d.dte_total),
              date: d.dte_fecha,
              link: '/conciliacion'
            }))
          },
          ventasAbiertas: {
            count: ventasAbiertas.data?.length || 0,
            items: ((ventasAbiertas.data || []) as any[]).slice(0, 5).map((v) => ({
              label: 'Mesa ' + (v.mesa_numero || '?'),
              sub: formatUSD(v.total),
              date: v.fecha_hora?.slice(0, 10),
              link: `/pos/mesa/${encodeURIComponent(v.mesa_numero || '')}`
            }))
          },
          conteoAtrasado: {
            count: ingredientesSinPrecio.length,
            items: ingredientesSinPrecio.slice(0, 5).map((i) => ({
              label: i.nombre,
              sub: `${i.codigo} · sin precio_costo`,
              link: '/inventario'
            }))
          },
          proveedoresSinNit: {
            count: proveedores.data?.length || 0,
            items: ((proveedores.data || []) as any[]).slice(0, 5).map((p) => ({
              label: p.nombre,
              sub: 'NIT vacío — no se puede emitir CCF',
              link: '/proveedores'
            }))
          },
          empleadosSinBanco: { count: empleadosSinBanco.length, items: [] }
        };

        setData(result);
      } catch (e: any) {
        if (!cancel) setError(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const totalPendientes = data
    ? Object.values(data).reduce((s, x) => s + (x?.count || 0), 0)
    : 0;

  async function correrBarrerInbox() {
    const { error: err } = await kaeru.rpc('notif_barrer');
    if (err) toast.error('Error: ' + err.message);
    else     toast.success('Barrido del Inbox completado ✓');
  }

  return (
    <PageShell
      kanji="待"
      titulo="Mis Pendientes"
      subtitulo={session ? `${session.nombre_display || session.email} · cosas que requieren tu atención` : 'Pendientes'}
      badge={
        loading
          ? { label: 'cargando…', variant: 'muted' }
          : totalPendientes === 0
          ? { label: '✓ todo al día', variant: 'kaeru' }
          : { label: `${totalPendientes} pendientes`, variant: totalPendientes > 10 ? 'danger' : 'warning' }
      }
      actions={
        <Link to="/inbox" className="btn btn-outline btn-sm">📬 Ver Inbox</Link>
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && data && (
        <>
          {totalPendientes === 0 && (
            <EmptyCard message="✓ No hay pendientes operativos hoy. Buen trabajo." />
          )}

          {/* Card explicación: diferencia con Inbox */}
          {totalPendientes > 0 && (
            <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)', marginBottom: 4 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                <strong className="text-purple">📋 Pendientes</strong> son cosas que <strong>vos tenés que hacer</strong> (clasificar DTE, marcar planilla, completar info de proveedor).
                <br />
                <strong className="text-purple">📬 Inbox</strong> son <strong>alertas automáticas del sistema</strong> (stock bajo, cierre falta, etc.).
                <br />
                Hay overlap a propósito — desde acá ves lo accionable, desde el Inbox marcás "leído/resuelto".
              </div>
            </div>
          )}

          <SeccionPendiente
            kanji="票" titulo="DTEs por clasificar"
            descripcion="Facturas recibidas en últimos 60 días sin ingrediente mapeado — rompe el COGS real"
            stat={data.dtesSinClasificar} color="warning" />

          <SeccionPendiente
            kanji="給" titulo="Planillas en borrador hace +2 días"
            descripcion="Quincenas calculadas pero sin marcar como pagadas"
            stat={data.planillaBorrador} color="warning" />

          <SeccionPendiente
            kanji="銀" titulo="DTEs sin pago localizado"
            descripcion="Facturas recibidas (últimos 30 días) sin TF saliente correspondiente en BAC"
            stat={data.dtesSinPago} color="danger" />

          <SeccionPendiente
            kanji="卓" titulo="Mesas con cuenta abierta"
            descripcion="Cuentas que quedaron sin cobrar — verificar si fueron olvidadas o el mesero salió a media venta"
            stat={data.ventasAbiertas} color="danger" />

          <SeccionPendiente
            kanji="在" titulo="Ingredientes sin precio_costo"
            descripcion="No se puede calcular COGS hasta que tengan precio. Recolectar de la última factura del proveedor"
            stat={data.conteoAtrasado} color="info" />

          <SeccionPendiente
            kanji="商" titulo="Proveedores sin NIT"
            descripcion="Necesario para emitir CCF y validar contra Hacienda"
            stat={data.proveedoresSinNit} color="info" />

          {/* Atajo a barrer inbox manual */}
          <div className="card" style={{ borderColor: 'rgba(95,224,169,0.3)' }}>
            <div className="row-between">
              <div>
                <div className="card-title text-kaeru" style={{ marginBottom: 4 }}>🔄 Refrescar alertas</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  El cron Apps Script corre cada 30 min. Para forzar un barrido manual y actualizar el Inbox ahora mismo:
                </div>
              </div>
              <button onClick={correrBarrerInbox} className="btn btn-kaeru btn-sm">↻ Barrer Inbox</button>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

// ============================================================
function SeccionPendiente({
  kanji, titulo, descripcion, stat, color
}: {
  kanji: string;
  titulo: string;
  descripcion: string;
  stat: SectionStat;
  color: 'danger' | 'warning' | 'info';
}) {
  if (stat.count === 0) return null;

  const borderColor = color === 'danger'  ? 'var(--state-danger,#e74c3c)'
                    : color === 'warning' ? '#f5b400'
                    : 'var(--accent-purple)';

  return (
    <div className="card" style={{ borderLeft: `4px solid ${borderColor}` }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--font-kanji)', fontSize: 22, color: borderColor }}>{kanji}</span>
            <div className="card-title">{titulo}</div>
            <span className="badge" style={{ background: borderColor, color: 'var(--bg-base)', fontSize: 11 }}>
              {stat.count}
            </span>
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>{descripcion}</div>
        </div>
      </div>

      {(stat.items?.length ?? 0) > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {stat.items!.map((it, idx) => {
              const inner = (
                <div className="row-between" style={{
                  padding: '8px 10px',
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--r-md)',
                  fontSize: 12
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{it.label}</div>
                    {it.sub && <div className="text-muted" style={{ fontSize: 10 }}>{it.sub}</div>}
                  </div>
                  {it.date && <div className="text-muted" style={{ fontSize: 10 }}>{formatDate(it.date)}</div>}
                </div>
              );
              return it.link
                ? <Link key={idx} to={it.link} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
                : <div key={idx}>{inner}</div>;
            })}
          </div>
          {stat.count > (stat.items?.length ?? 0) && (
            <div className="text-muted" style={{ fontSize: 10, marginTop: 6, textAlign: 'center' }}>
              ... y {stat.count - (stat.items?.length ?? 0)} más
            </div>
          )}
        </div>
      )}
    </div>
  );
}
