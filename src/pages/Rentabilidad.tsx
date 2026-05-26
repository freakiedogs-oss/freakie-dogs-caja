import { useEffect, useState, useMemo } from 'react';
import PageShell, { LoadingCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { formatUSD } from '@/lib/utils';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, ReferenceLine } from 'recharts';

interface Mes {
  mes: string;
  mes_inicio: string;
  ventas_mesa: number;
  ventas_peya: number;
  ventas_total: number;
  comision_peya: number;
  comision_pos_bac: number;
  ingreso_neto: number;
  cogs_estimado: number;
  planilla_neta: number;
  planilla_aportes: number;
  propinas_pagadas: number;
  renta: number;
  depreciacion: number;
  utilidad_neta: number;
  cogs_real?: number;  // de v_cogs_real_mensual (líneas DTE mapeadas)
  lineas_mapeadas?: number;
}

function fmtMes(mes: string): string {
  const [y, m] = mes.split('-');
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${meses[Number(m) - 1]} ${y.slice(-2)}`;
}

export default function Rentabilidad() {
  const [meses, setMeses] = useState<Mes[]>([]);
  const [selectedMes, setSelectedMes] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [rRes, cRes] = await Promise.all([
        kaeru.from('v_rentabilidad_mensual').select('*').order('mes', { ascending: false }),
        kaeru.from('v_cogs_real_mensual').select('*')
      ]);
      if (cancel) return;
      const cogsMap = new Map<string, { cogs_real: number; lineas_mapeadas: number }>();
      for (const c of (cRes.data || []) as any[]) {
        cogsMap.set(c.mes, { cogs_real: Number(c.cogs_dte_mapeado || 0), lineas_mapeadas: Number(c.lineas_mapeadas || 0) });
      }
      const rows = ((rRes.data || []) as any[]).map((r) => {
        const obj = Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : v])
        ) as any;
        const cogsInfo = cogsMap.get(obj.mes);
        if (cogsInfo) {
          obj.cogs_real = cogsInfo.cogs_real;
          obj.lineas_mapeadas = cogsInfo.lineas_mapeadas;
        }
        return obj;
      }) as unknown as Mes[];
      setMeses(rows);
      // Default: último mes completo (no el actual si es parcial)
      const today = new Date();
      const ultimoCompleto = `${today.getFullYear()}-${String(today.getMonth()).padStart(2, '0')}`;
      const found = rows.find((r) => r.mes === ultimoCompleto) || rows[1] || rows[0];
      if (found) setSelectedMes(found.mes);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  const current = meses.find((m) => m.mes === selectedMes);
  const idx = meses.findIndex((m) => m.mes === selectedMes);
  const previous = idx >= 0 ? meses[idx + 1] : null;

  // Waterfall data: cada paso es un cambio acumulado
  const waterfallData = useMemo(() => {
    if (!current) return [];
    const steps: Array<{ name: string; cumulative: number; delta: number; color: string }> = [];
    let cum = 0;

    steps.push({ name: 'Ventas mesa', cumulative: cum + current.ventas_mesa, delta: current.ventas_mesa, color: 'var(--accent-kaeru)' });
    cum += current.ventas_mesa;
    if (current.ventas_peya > 0) {
      steps.push({ name: 'Ventas PeYa', cumulative: cum + current.ventas_peya, delta: current.ventas_peya, color: 'var(--accent-kaeru)' });
      cum += current.ventas_peya;
    }
    if (current.comision_peya > 0) {
      cum -= current.comision_peya;
      steps.push({ name: '− Comisión PeYa 24%', cumulative: cum, delta: -current.comision_peya, color: 'var(--state-danger)' });
    }
    cum -= current.comision_pos_bac;
    steps.push({ name: '− POS BAC ~3%', cumulative: cum, delta: -current.comision_pos_bac, color: 'var(--state-danger)' });
    // COGS: usar real (de DTEs mapeados) si disponible, si no estimado 32%
    const usarCogsReal = current.cogs_real && current.cogs_real > 0;
    const cogsFinal = usarCogsReal ? current.cogs_real! : current.cogs_estimado;
    cum -= cogsFinal;
    steps.push({
      name: usarCogsReal ? `− COGS real (${current.lineas_mapeadas} líneas)` : '− COGS 32% estimado',
      cumulative: cum,
      delta: -cogsFinal,
      color: 'var(--state-danger)'
    });
    cum -= current.planilla_neta;
    steps.push({ name: '− Planilla', cumulative: cum, delta: -current.planilla_neta, color: 'var(--state-danger)' });
    cum -= current.propinas_pagadas;
    steps.push({ name: '− Propinas', cumulative: cum, delta: -current.propinas_pagadas, color: 'var(--state-danger)' });
    cum -= current.renta;
    steps.push({ name: '− Renta EPIC', cumulative: cum, delta: -current.renta, color: 'var(--state-danger)' });
    cum -= current.depreciacion;
    steps.push({ name: '− Depreciación', cumulative: cum, delta: -current.depreciacion, color: 'var(--state-danger)' });
    steps.push({ name: '= Utilidad neta', cumulative: cum, delta: cum, color: cum > 0 ? 'var(--accent-kaeru)' : 'var(--state-danger)' });
    return steps;
  }, [current]);

  // Tendencia: últimos 6 meses
  const tendenciaData = useMemo(() => meses.slice(0, 6).reverse().map((m) => ({
    mes: fmtMes(m.mes),
    Ventas: m.ventas_total,
    Utilidad: m.utilidad_neta,
    Margen_pct: m.ventas_total > 0 ? Math.round((m.utilidad_neta / m.ventas_total) * 100) : 0
  })), [meses]);

  if (loading) return <PageShell kanji="利" titulo="Rentabilidad Mensual" subtitulo=""><LoadingCard /></PageShell>;

  return (
    <PageShell
      kanji="利"
      titulo="Rentabilidad Mensual"
      subtitulo="Waterfall ejecutivo · Reemplaza kaeruchan.pages.dev"
      badge={current ? { label: fmtMes(current.mes), variant: current.utilidad_neta > 0 ? 'kaeru' : 'danger' } : undefined}
      actions={
        <select className="ki-input" value={selectedMes} onChange={(e) => setSelectedMes(e.target.value)} style={{ maxWidth: 180 }}>
          {meses.map((m) => <option key={m.mes} value={m.mes}>{fmtMes(m.mes)}</option>)}
        </select>
      }
    >
      {current && (
        <>
          {/* KPIs principales */}
          <div className="card-grid card-grid-4">
            <div className="card">
              <div className="card-title">Ventas totales</div>
              <div className="metric-xl text-kaeru">{formatUSD(current.ventas_total)}</div>
              {previous && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  vs {fmtMes(previous.mes)}: {current.ventas_total > previous.ventas_total ? '+' : ''}
                  {(((current.ventas_total - previous.ventas_total) / previous.ventas_total) * 100).toFixed(1)}%
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-title">Ingreso neto</div>
              <div className="metric-xl">{formatUSD(current.ingreso_neto)}</div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Margen ingreso: {((current.ingreso_neto / current.ventas_total) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="card">
              <div className="card-title">Utilidad neta</div>
              <div className="metric-xl" style={{ color: current.utilidad_neta > 0 ? 'var(--accent-kaeru)' : 'var(--state-danger)' }}>
                {formatUSD(current.utilidad_neta)}
              </div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Margen neto: {((current.utilidad_neta / current.ventas_total) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="card">
              <div className="card-title">Por socio (÷4)</div>
              <div className="metric-xl text-purple">{formatUSD(current.utilidad_neta / 4)}</div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                25% para Jose, Luis, Roberto, Florian
              </div>
            </div>
          </div>

          {/* Waterfall */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Waterfall {fmtMes(current.mes)}</div>
              <span className="badge badge-muted">De ventas → utilidad neta</span>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={waterfallData} margin={{ top: 20, right: 16, bottom: 60, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(244,240,230,0.08)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={80} />
                <YAxis stroke="var(--text-muted)" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: any) => [formatUSD(Number(value)), 'Acumulado']}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <ReferenceLine y={0} stroke="var(--text-muted)" strokeWidth={1} />
                <Bar dataKey="cumulative" fill="var(--accent-kaeru)">
                  {waterfallData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Tabla detalle bajo el gráfico */}
            <table className="table" style={{ marginTop: 16 }}>
              <tbody>
                {waterfallData.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: s.delta >= 0 && i > 0 ? 'var(--accent-kaeru)' : (s.delta < 0 ? 'var(--state-danger)' : 'var(--text-primary)') }}>
                      {s.delta >= 0 && i > 0 ? '+' : ''}{formatUSD(s.delta)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: i === waterfallData.length - 1 ? 700 : 400 }}>
                      {formatUSD(s.cumulative)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tendencia 6 meses */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Tendencia 6 meses</div>
              <span className="badge badge-muted">Ventas + Utilidad</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={tendenciaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(244,240,230,0.08)" />
                <XAxis dataKey="mes" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: any) => formatUSD(Number(value))}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 8 }}
                />
                <Line type="monotone" dataKey="Ventas" stroke="var(--accent-kaeru)" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Utilidad" stroke="var(--accent-purple)" strokeWidth={2.5} dot={{ r: 4 }} />
                <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Helper */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>Supuestos del cálculo</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              • <strong>Comisión PeYa 24%</strong> sobre ventas canal PeYa<br />
              • <strong>Comisión POS BAC ~3%</strong> sobre ventas mesa (estimado pendiente de validar con BAC real)<br />
              • <strong>COGS 32%</strong> estimado del total (ajustar cuando recetas estén completas → CMV real por plato)<br />
              • <strong>Planilla neta</strong> = `kaeru.planilla.neto_a_pagar` SUM del mes<br />
              • <strong>Propinas</strong> = `propina_semanal.monto_a_repartir` SUM (lo que Kaeru pagó)<br />
              • <strong>Renta</strong> EPIC Plaza $3,328.25/mes fija<br />
              • <strong>Depreciación</strong> $1,604/mes (CAPEX $96K dividido 60 meses)<br />
              • <strong>Pendiente Fase 4:</strong> servicios reales (luz/agua/gas/internet) desde BAC categorizado, costos variables (papel, gas, descartables)<br />
              • <strong>Distribución socios</strong> 25/25/25/25 entre Jose, Luis, Roberto, Florian
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
