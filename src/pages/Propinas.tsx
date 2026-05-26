import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { formatUSD, formatDate } from '@/lib/utils';

interface Semana {
  id: string;
  semana_lunes: string;
  semana_domingo: string;
  total_recaudado_liquido: number;
  monto_a_repartir: number;
  monto_casa: number;
  pagado_el: string | null;
  estado: string;
  empleados_pagados: number;
}
interface PagoEmpleado {
  id: string;
  empleado_nombre: string;
  monto_diurno: number;
  monto_nocturno: number;
  penalizacion: number;
  neto_pagado: number;
  fecha_pago: string | null;
}

export default function Propinas() {
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Semana | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await kaeru
        .from('propina_semanal')
        .select('id,semana_lunes,semana_domingo,total_recaudado_liquido,monto_a_repartir,monto_casa,pagado_el,estado,propina_pago(id)')
        .order('semana_lunes', { ascending: false });
      if (cancel) return;
      setSemanas(((data || []) as any[]).map((s) => ({
        ...s,
        total_recaudado_liquido: Number(s.total_recaudado_liquido || 0),
        monto_a_repartir: Number(s.monto_a_repartir || 0),
        monto_casa: Number(s.monto_casa || 0),
        empleados_pagados: (s.propina_pago || []).length
      })));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  const totalRepartido = semanas.reduce((s, w) => s + w.monto_a_repartir, 0);
  const totalCasa = semanas.reduce((s, w) => s + w.monto_casa, 0);
  const totalRecaudado = semanas.reduce((s, w) => s + w.total_recaudado_liquido, 0);

  return (
    <PageShell
      kanji="心"
      titulo="Propinas Semanales"
      subtitulo="Cierre Lun-Dom · 90% reparte · 10% casa · Pago Transfer365 los martes"
      badge={{ label: `${semanas.length} semanas`, variant: 'purple' }}
    >
      {loading ? <LoadingCard /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card"><div className="card-title">Semanas registradas</div><div className="metric-xl text-purple">{semanas.length}</div></div>
            <div className="card"><div className="card-title">Total recaudado</div><div className="metric-xl">{formatUSD(totalRecaudado)}</div></div>
            <div className="card"><div className="card-title">Repartido (90%)</div><div className="metric-xl text-kaeru">{formatUSD(totalRepartido)}</div></div>
            <div className="card"><div className="card-title">Casa (10%)</div><div className="metric-xl">{formatUSD(totalCasa)}</div></div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Histórico semanas</div>
              <span className="badge badge-muted">Click → ver detalle por empleado</span>
            </div>
            {semanas.length === 0 ? <EmptyCard message="Sin propinas registradas" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Semana</th>
                      <th>Pagado el</th>
                      <th>Empleados</th>
                      <th style={{ textAlign: 'right' }}>Recaudado</th>
                      <th style={{ textAlign: 'right' }}>Casa 10%</th>
                      <th style={{ textAlign: 'right' }}>Repartido 90%</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanas.map((s) => (
                      <tr key={s.id} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600 }}>{formatDate(s.semana_lunes)} → {formatDate(s.semana_domingo)}</td>
                        <td className="text-muted" style={{ fontSize: 11 }}>{s.pagado_el ? formatDate(s.pagado_el) : '—'}</td>
                        <td>{s.empleados_pagados}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(s.total_recaudado_liquido)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--text-muted)' }}>{formatUSD(s.monto_casa)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-kaeru)', fontWeight: 700 }}>{formatUSD(s.monto_a_repartir)}</td>
                        <td>{s.estado === 'pagada' ? <span className="badge badge-kaeru">✓ Pagada</span> : <span className="badge badge-purple">{s.estado}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>Cómo funciona</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              • Semana cierra <strong>Domingo 11 PM</strong>. Lunes 7 AM la edge function calcula reparto<br />
              • <strong>Reparto 90/10:</strong> 90% reparte entre quienes atendieron · 10% queda como casa<br />
              • <strong>Turnos:</strong> diurno 12-5 / nocturno 5-9. Quien hace partido cobra ambos<br />
              • <strong>Pago Transfer365 los martes</strong> al BAC de cada empleado<br />
              • Histórico Dic 2025 - Marzo 2026 importado del estado de cuenta BAC<br />
              • <strong>Pendiente Fase 3:</strong> edge function que corre lunes 7AM calcula + Yessica autoriza + bot manda recordatorio
            </div>
          </div>
        </>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `${formatDate(selected.semana_lunes)} → ${formatDate(selected.semana_domingo)}` : ''}>
        {selected && <SemanaDetalle semanaId={selected.id} repartido={selected.monto_a_repartir} casa={selected.monto_casa} />}
      </Drawer>
    </PageShell>
  );
}

function SemanaDetalle({ semanaId, repartido, casa }: { semanaId: string; repartido: number; casa: number }) {
  const [pagos, setPagos] = useState<PagoEmpleado[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await kaeru
        .from('propina_pago')
        .select('id,monto_diurno,monto_nocturno,penalizacion,neto_pagado,fecha_pago,empleados:empleado_id(nombre)')
        .eq('propina_semanal_id', semanaId)
        .order('neto_pagado', { ascending: false });
      if (cancel) return;
      setPagos(((data || []) as any[]).map((p) => ({
        id: p.id,
        empleado_nombre: p.empleados?.nombre || '?',
        monto_diurno: Number(p.monto_diurno || 0),
        monto_nocturno: Number(p.monto_nocturno || 0),
        penalizacion: Number(p.penalizacion || 0),
        neto_pagado: Number(p.neto_pagado || 0),
        fecha_pago: p.fecha_pago
      })));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [semanaId]);

  if (loading) return <div className="text-muted">Cargando…</div>;

  return (
    <div className="stack-sm">
      <div className="row-between" style={{ background: 'rgba(154,111,209,0.1)', padding: 10, borderRadius: 'var(--r-md)' }}>
        <div>
          <div className="text-muted" style={{ fontSize: 11 }}>Casa (10%)</div>
          <div style={{ fontFamily: 'var(--font-metric)', fontSize: 18 }}>{formatUSD(casa)}</div>
        </div>
        <div>
          <div className="text-muted" style={{ fontSize: 11 }}>Repartido (90%)</div>
          <div style={{ fontFamily: 'var(--font-metric)', fontSize: 22, color: 'var(--accent-kaeru)' }}>{formatUSD(repartido)}</div>
        </div>
        <div>
          <div className="text-muted" style={{ fontSize: 11 }}>Empleados</div>
          <div style={{ fontFamily: 'var(--font-metric)', fontSize: 18 }}>{pagos.length}</div>
        </div>
      </div>

      {pagos.map((p) => (
        <div key={p.id} className="card" style={{ padding: 12 }}>
          <div className="row-between" style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.empleado_nombre}</div>
            <div style={{ fontFamily: 'var(--font-metric)', fontSize: 20, color: 'var(--accent-kaeru)' }}>{formatUSD(p.neto_pagado)}</div>
          </div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {p.fecha_pago && `Pagado ${formatDate(p.fecha_pago)} · `}
            Diurno {formatUSD(p.monto_diurno)} · Nocturno {formatUSD(p.monto_nocturno)}
            {p.penalizacion > 0 && <span style={{ color: 'var(--state-danger)' }}> · Penalización −{formatUSD(p.penalizacion)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
