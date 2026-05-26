import { useEffect, useMemo, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';
import { verRecibo, ReciboDetalle, ReciboQuincena } from '@/lib/recibo';

// ============================================================
// /recibos — Histórico de recibos digitales por empleado
// ------------------------------------------------------------
// Diferencia con /planilla:
//   - /planilla: vista por quincena (todas las personas de una quincena)
//   - /recibos:  vista por empleado (todas las quincenas de una persona)
//
// Útil para: re-imprimir recibo viejo, ver evolución salarial de Empleado X,
// validar que recibió todos los pagos del año.
// ============================================================

interface EmpleadoRow {
  id: string;
  nombre: string;
  cargo: string | null;
  activo: boolean | null;
}

interface ReciboRow {
  id: string;
  empleado_id: string;
  quincena_inicio: string;
  quincena_fin: string;
  dias_trabajados: number;
  horas_extra: number;
  salario_base: number;
  bono: number;
  propina: number;
  isss: number;
  afp: number;
  isr: number;
  otros_descuentos: number;
  total_descuentos: number;
  neto_a_pagar: number;
  estado: string;
  fecha_pago: string | null;
}

export default function Recibos() {
  const toast = useToast();
  const [empleados,   setEmpleados]   = useState<EmpleadoRow[]>([]);
  const [recibos,     setRecibos]     = useState<ReciboRow[]>([]);
  const [empSel,      setEmpSel]      = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [bulkBusy,    setBulkBusy]    = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [emp, rec] = await Promise.all([
          kaeru.from('empleados').select('id,nombre,cargo,activo').order('nombre'),
          kaeru.from('planilla')
            .select('id,empleado_id,quincena_inicio,quincena_fin,dias_trabajados,horas_extra,salario_base,bono,propina,isss,afp,isr,otros_descuentos,total_descuentos,neto_a_pagar,estado,fecha_pago')
            .order('quincena_inicio', { ascending: false })
            .limit(2000)
        ]);
        if (cancel) return;
        if (emp.error) throw emp.error;
        if (rec.error) throw rec.error;
        setEmpleados((emp.data || []) as unknown as EmpleadoRow[]);
        setRecibos((rec.data || []) as unknown as ReciboRow[]);
      } catch (e: any) {
        if (!cancel) setError(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Agrupar recibos por empleado
  const porEmpleado = useMemo(() => {
    const map = new Map<string, ReciboRow[]>();
    for (const r of recibos) {
      const arr = map.get(r.empleado_id) || [];
      arr.push(r);
      map.set(r.empleado_id, arr);
    }
    return map;
  }, [recibos]);

  // Empleados con al menos un recibo, ordenados por # recibos
  const empleadosConRecibos = useMemo(() => {
    return empleados
      .map((e) => ({ ...e, count: porEmpleado.get(e.id)?.length ?? 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [empleados, porEmpleado]);

  const empSeleccionado = empleados.find((e) => e.id === empSel);
  const recibosEmpleado = empSel ? (porEmpleado.get(empSel) ?? []) : [];

  function abrirRecibo(r: ReciboRow, e: EmpleadoRow) {
    const detalle: ReciboDetalle = {
      empleado_nombre: e.nombre,
      cargo: e.cargo,
      dias_trabajados: r.dias_trabajados,
      horas_extra: r.horas_extra,
      salario_base: r.salario_base,
      bono: r.bono,
      propina: r.propina,
      isss: r.isss,
      afp: r.afp,
      isr: r.isr,
      otros_descuentos: r.otros_descuentos,
      total_descuentos: r.total_descuentos,
      neto_a_pagar: r.neto_a_pagar,
      estado: r.estado,
      fecha_pago: r.fecha_pago
    };
    const quincena: ReciboQuincena = {
      quincena_inicio: r.quincena_inicio,
      quincena_fin: r.quincena_fin
    };
    verRecibo(detalle, quincena, () => toast.warning('Permití las ventanas emergentes para abrir el recibo'));
  }

  async function abrirTodos() {
    if (!empSeleccionado) return;
    if (!confirm(`Abrir ${recibosEmpleado.length} recibo(s) de ${empSeleccionado.nombre}? Se abrirá una pestaña por cada uno.`)) return;
    setBulkBusy(true);
    for (const r of recibosEmpleado) {
      abrirRecibo(r, empSeleccionado);
      await new Promise((res) => setTimeout(res, 350));
    }
    setBulkBusy(false);
    toast.success(`${recibosEmpleado.length} recibo(s) abiertos ✓`);
  }

  const totalNetoEmpleado = recibosEmpleado.reduce((s, r) => s + Number(r.neto_a_pagar || 0), 0);
  const totalDescEmpleado = recibosEmpleado.reduce((s, r) => s + Number(r.total_descuentos || 0), 0);
  const totalPropinaEmp   = recibosEmpleado.reduce((s, r) => s + Number(r.propina || 0), 0);
  const pagadasEmp        = recibosEmpleado.filter((r) => r.estado === 'pagada').length;

  return (
    <PageShell
      kanji="領"
      titulo="Recibos Digitales"
      subtitulo={empSeleccionado
        ? `${empSeleccionado.nombre} · ${recibosEmpleado.length} recibo(s) · ${pagadasEmp} pagados`
        : `Histórico por empleado · ${empleadosConRecibos.length} empleados con recibos`}
      badge={empSeleccionado
        ? { label: formatUSD(totalNetoEmpleado), variant: 'kaeru' }
        : { label: `${recibos.length} recibos`, variant: 'muted' }}
      actions={
        empSel
          ? (
            <div className="row" style={{ gap: 8 }}>
              <button onClick={() => setEmpSel(null)} className="btn btn-ghost btn-sm">← Empleados</button>
              {recibosEmpleado.length > 0 && (
                <button onClick={abrirTodos} disabled={bulkBusy} className="btn btn-kaeru btn-sm">
                  {bulkBusy ? '● Abriendo…' : `📄 Abrir ${recibosEmpleado.length}`}
                </button>
              )}
            </div>
          )
          : undefined
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && !empSel && (
        <>
          {/* Vista lista de empleados */}
          {empleadosConRecibos.length === 0 ? (
            <EmptyCard message="Sin recibos generados todavía. Genera planilla en /planilla primero." />
          ) : (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Empleados con recibos generados</div>
                <span className="badge badge-purple">{recibos.length} recibos totales</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Cargo</th>
                    <th style={{ textAlign: 'right' }}>Recibos</th>
                    <th style={{ textAlign: 'right' }}>Neto acumulado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {empleadosConRecibos.map((e) => {
                    const recs = porEmpleado.get(e.id) ?? [];
                    const neto = recs.reduce((s, r) => s + Number(r.neto_a_pagar || 0), 0);
                    return (
                      <tr key={e.id} onClick={() => setEmpSel(e.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600 }}>{e.nombre}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.cargo || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{e.count}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-kaeru)' }}>{formatUSD(neto)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="text-muted" style={{ fontSize: 11 }}>Ver →</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && !error && empSel && empSeleccionado && (
        <>
          {/* KPIs del empleado */}
          <div className="card-grid card-grid-4">
            <div className="card">
              <div className="card-title">Recibos</div>
              <div className="metric-xl">{recibosEmpleado.length}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{pagadasEmp} pagados · {recibosEmpleado.length - pagadasEmp} borrador</div>
            </div>
            <div className="card">
              <div className="card-title">Neto acumulado</div>
              <div className="metric-xl text-kaeru">{formatUSD(totalNetoEmpleado)}</div>
            </div>
            <div className="card">
              <div className="card-title">Descuentos acum.</div>
              <div className="metric-xl text-danger">{formatUSD(totalDescEmpleado)}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>ISSS + AFP + ISR + otros</div>
            </div>
            <div className="card">
              <div className="card-title">Propinas acum.</div>
              <div className="metric-xl text-purple">{formatUSD(totalPropinaEmp)}</div>
            </div>
          </div>

          {/* Histórico de recibos */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Histórico de recibos</div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Quincena</th>
                  <th style={{ textAlign: 'right' }}>Días</th>
                  <th style={{ textAlign: 'right' }}>Salario</th>
                  <th style={{ textAlign: 'right' }}>Propina</th>
                  <th style={{ textAlign: 'right' }}>Descuentos</th>
                  <th style={{ textAlign: 'right' }}>Neto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recibosEmpleado.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11 }}>
                      <div style={{ fontWeight: 600 }}>{formatDate(r.quincena_inicio)} → {formatDate(r.quincena_fin)}</div>
                      {r.fecha_pago && <div className="text-muted" style={{ fontSize: 10 }}>pagado {formatDate(r.fecha_pago)}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.dias_trabajados}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(r.salario_base + r.horas_extra + r.bono)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>{formatUSD(r.propina)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--state-danger)' }}>−{formatUSD(r.total_descuentos)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-kaeru)' }}>{formatUSD(r.neto_a_pagar)}</td>
                    <td>
                      <span className={`badge ${r.estado === 'pagada' ? 'badge-kaeru' : 'badge-muted'}`} style={{ fontSize: 10 }}>
                        {r.estado === 'pagada' ? '✓ Pagada' : 'Borrador'}
                      </span>
                    </td>
                    <td>
                      <button onClick={() => abrirRecibo(r, empSeleccionado)} className="btn btn-outline btn-sm">
                        📄 Recibo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageShell>
  );
}
