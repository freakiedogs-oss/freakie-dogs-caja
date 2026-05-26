import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { useToast } from '@/lib/toast';
import { formatUSD, formatDate } from '@/lib/utils';
import { generarReciboHTML as _generarReciboHTML, ReciboDetalle, ReciboQuincena } from '@/lib/recibo';
// Re-export local para no romper otros usos dentro del archivo.
function adaptToHelper(d: DetallePlanilla, q: QuincenaRow): { detalle: ReciboDetalle; quincena: ReciboQuincena } {
  return {
    detalle: {
      empleado_nombre: d.empleado_nombre,
      cargo: d.cargo,
      dias_trabajados: d.dias_trabajados,
      horas_extra: d.horas_extra,
      salario_base: d.salario_base,
      bono: d.bono,
      propina: d.propina,
      isss: d.isss,
      afp: d.afp,
      isr: d.isr,
      otros_descuentos: d.otros_descuentos,
      total_descuentos: d.total_descuentos,
      neto_a_pagar: d.neto_a_pagar,
      estado: d.estado,
      fecha_pago: d.fecha_pago
    },
    quincena: { quincena_inicio: q.quincena_inicio, quincena_fin: q.quincena_fin }
  };
}

interface QuincenaRow {
  quincena_inicio: string;
  quincena_fin: string;
  empleados: number;
  pagadas: number;
  total_bruto: number;
  total_descuentos: number;
  total_propinas: number;
  total_neto: number;
}

interface DetallePlanilla {
  id: string;
  empleado_id: string;
  empleado_nombre: string;
  cargo: string | null;
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
  bac_match_fecha?: string | null;
  bac_match_desc?: string | null;
}

// ============================================================
// Wrapper local — delega al helper compartido en lib/recibo.ts
// (mantenemos esta función por compatibilidad con el resto del archivo)
// ============================================================
function generarReciboHTML(d: DetallePlanilla, quincena: QuincenaRow): string {
  const { detalle, quincena: q } = adaptToHelper(d, quincena);
  return _generarReciboHTML(detalle, q);
}

function verRecibo(d: DetallePlanilla, quincena: QuincenaRow) {
  const html = generarReciboHTML(d, quincena);
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) { alert('Permite ventanas emergentes para ver el recibo'); return; }
  w.document.write(html);
  w.document.close();
}

// ============================================================
// Header actions: 2 botones — Calcular borrador + Aplicar marcajes
// ============================================================
function HeaderActions() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  function quincenaActualISO(): string {
    const hoy = new Date();
    const dia = hoy.getDate();
    return dia <= 15
      ? `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
      : `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-16`;
  }

  async function calcularBorrador() {
    const qi = quincenaActualISO();
    if (!confirm(`Calcular borrador planilla para quincena ${qi}?\nCrea/actualiza filas estado='borrador'.`)) return;
    setBusy('calc');
    const { data, error } = await kaeru.rpc('calcular_planilla_quincena', { p_quincena_inicio: qi });
    setBusy(null);
    if (error) { toast.error('Error: ' + error.message); return; }
    const r = data as any;
    if (r?.ok) {
      toast.success(`✓ Quincena ${qi} · creados ${r.creados} · actualizados ${r.actualizados}`);
      setTimeout(() => window.location.reload(), 1200);
    } else {
      toast.error('Error: ' + (r?.error || 'sin detalle'));
    }
  }

  async function aplicarMarcajes() {
    const qi = quincenaActualISO();
    if (!confirm(`Aplicar marcajes de asistencia a planilla ${qi}?\nActualiza días trabajados + horas extra (a $3/h) en borradores.\nNo toca pagadas.`)) return;
    setBusy('marcajes');
    const { data, error } = await kaeru.rpc('planilla_aplicar_asistencia', { p_quincena_inicio: qi });
    setBusy(null);
    if (error) { toast.error('Error: ' + error.message); return; }
    const rows = (data || []) as any[];
    const actualizados = rows.filter((r) => r.accion === 'actualizado').length;
    const sinPlanilla  = rows.filter((r) => r.accion?.startsWith('sin_planilla')).length;
    const pagadas      = rows.filter((r) => r.accion === 'skip_pagada').length;
    toast.success(`✓ ${actualizados} actualizados · ${sinPlanilla} sin planilla · ${pagadas} pagadas (no tocadas)`);
    setTimeout(() => window.location.reload(), 1500);
  }

  async function aplicarDescuentosAmonestacion() {
    const qi = quincenaActualISO();
    if (!confirm(`Aplicar descuentos pendientes de amonestaciones a planilla ${qi}?\nSuma a otros_descuentos + recalcula neto + marca amonestaciones como resueltas.`)) return;
    setBusy('amonest');
    const { data, error } = await kaeru.rpc('planilla_aplicar_descuentos_amonestacion', { p_quincena_inicio: qi });
    setBusy(null);
    if (error) { toast.error('Error: ' + error.message); return; }
    const rows = (data || []) as any[];
    const aplicados   = rows.filter((r) => r.accion === 'aplicado');
    const sinPlanilla = rows.filter((r) => r.accion?.startsWith('sin_planilla')).length;
    const pagadas     = rows.filter((r) => r.accion === 'skip_pagada').length;
    const totalUSD    = aplicados.reduce((s, r) => s + Number(r.monto_aplicado || 0), 0);
    if (aplicados.length === 0 && sinPlanilla === 0 && pagadas === 0) {
      toast.info('No había descuentos pendientes para esta quincena');
    } else {
      toast.success(`✓ ${aplicados.length} empleados · $${totalUSD.toFixed(2)} aplicado · ${sinPlanilla} sin planilla · ${pagadas} pagadas (no tocadas)`);
    }
    if (aplicados.length > 0) setTimeout(() => window.location.reload(), 1500);
  }

  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <button
        className="btn btn-outline btn-sm"
        onClick={aplicarMarcajes}
        disabled={busy !== null}
        title="Pre-llena días trabajados + horas extra ($3/h) desde la tabla asistencia"
      >
        {busy === 'marcajes' ? '● Aplicando…' : '📊 Marcajes'}
      </button>
      <button
        className="btn btn-outline btn-sm"
        onClick={aplicarDescuentosAmonestacion}
        disabled={busy !== null}
        title="Aplica descuentos de amonestaciones tipo=descuento no aplicadas todavía"
      >
        {busy === 'amonest' ? '● Aplicando…' : '罰 Descuentos'}
      </button>
      <button
        className="btn btn-kaeru btn-sm"
        onClick={calcularBorrador}
        disabled={busy !== null}
      >
        {busy === 'calc' ? '● Calculando…' : '🪄 Calcular quincena'}
      </button>
    </div>
  );
}

function fmtQuincena(inicio: string, _fin: string): string {
  const d1 = new Date(inicio);
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const mes = meses[d1.getMonth()];
  const año = d1.getFullYear();
  const q = d1.getDate() <= 15 ? '1Q' : '2Q';
  return `${mes} ${q} ${año}`;
}

export default function Planilla() {
  const [quincenas, setQuincenas] = useState<QuincenaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQ, setSelectedQ] = useState<QuincenaRow | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error: e } = await kaeru
        .from('planilla')
        .select('quincena_inicio,quincena_fin,salario_base,bono,propina,total_descuentos,neto_a_pagar,estado')
        .order('quincena_inicio', { ascending: false });
      if (cancel) return;
      if (e) { setError(e.message); setLoading(false); return; }

      // Agrupar por quincena
      const map = new Map<string, QuincenaRow>();
      for (const r of (data || []) as any[]) {
        const key = r.quincena_inicio;
        if (!map.has(key)) {
          map.set(key, {
            quincena_inicio: r.quincena_inicio,
            quincena_fin: r.quincena_fin,
            empleados: 0,
            pagadas: 0,
            total_bruto: 0,
            total_descuentos: 0,
            total_propinas: 0,
            total_neto: 0
          });
        }
        const q = map.get(key)!;
        q.empleados += 1;
        if (r.estado === 'pagada') q.pagadas += 1;
        q.total_bruto += Number(r.salario_base || 0) + Number(r.bono || 0);
        q.total_descuentos += Number(r.total_descuentos || 0);
        q.total_propinas += Number(r.propina || 0);
        q.total_neto += Number(r.neto_a_pagar || 0);
      }

      setQuincenas(Array.from(map.values()));
      setError(null);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Totales agregados
  const totalEmpleadosUnicos = new Set(quincenas.map((q) => q.quincena_inicio)).size; // count quincenas
  const granTotalNeto = quincenas.reduce((s, q) => s + q.total_neto, 0);
  const granTotalPropinas = quincenas.reduce((s, q) => s + q.total_propinas, 0);
  const granTotalISSSAFP = quincenas.reduce((s, q) => s + q.total_descuentos, 0);

  return (
    <PageShell
      kanji="給"
      titulo="Planilla Quincenal"
      subtitulo="Histórico + cálculo automático días 1 y 16 con ISSS/AFP/ISR"
      badge={{ label: `${totalEmpleadosUnicos} quincenas`, variant: 'kaeru' }}
      actions={<HeaderActions />}
    >
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <>
          <div className="card-grid card-grid-4">
            <div className="card">
              <div className="card-title">Quincenas registradas</div>
              <div className="metric-xl text-kaeru">{quincenas.length}</div>
            </div>
            <div className="card">
              <div className="card-title">Total neto pagado</div>
              <div className="metric-xl">{formatUSD(granTotalNeto)}</div>
            </div>
            <div className="card">
              <div className="card-title">Total propinas en planilla</div>
              <div className="metric-xl text-purple">{formatUSD(granTotalPropinas)}</div>
            </div>
            <div className="card">
              <div className="card-title">Total descuentos (ISSS+AFP+ISR)</div>
              <div className="metric-xl">{formatUSD(granTotalISSSAFP)}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Histórico quincenas</div>
              <span className="badge badge-muted">Click → ver detalle</span>
            </div>
            {quincenas.length === 0 ? <EmptyCard message="Sin planillas registradas. Migra las históricas o crea una nueva." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Quincena</th>
                      <th>Periodo</th>
                      <th>Empleados</th>
                      <th>Estado</th>
                      <th style={{ textAlign: 'right' }}>Bruto</th>
                      <th style={{ textAlign: 'right' }}>− Descuentos</th>
                      <th style={{ textAlign: 'right' }}>+ Propinas</th>
                      <th style={{ textAlign: 'right' }}>= Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quincenas.map((q) => (
                      <tr key={q.quincena_inicio} onClick={() => setSelectedQ(q)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 700 }}>{fmtQuincena(q.quincena_inicio, q.quincena_fin)}</td>
                        <td className="text-muted" style={{ fontSize: 11 }}>{formatDate(q.quincena_inicio)} → {formatDate(q.quincena_fin)}</td>
                        <td>{q.empleados}</td>
                        <td>
                          {q.pagadas === q.empleados ? (
                            <span className="badge badge-kaeru">✓ Toda pagada</span>
                          ) : q.pagadas > 0 ? (
                            <span className="badge badge-purple">{q.pagadas}/{q.empleados} pagadas</span>
                          ) : (
                            <span className="badge badge-muted">Borrador</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)' }}>{formatUSD(q.total_bruto)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--state-danger)' }}>−{formatUSD(q.total_descuentos)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', color: 'var(--accent-purple)' }}>+{formatUSD(q.total_propinas)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-metric)', fontWeight: 700, color: 'var(--accent-kaeru)' }}>{formatUSD(q.total_neto)}</td>
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
              • <strong>Quincenal salvadoreña:</strong> días 1-15 y 16-último del mes<br />
              • <strong>Salario base quincenal</strong> = mensual ÷ 2 (proporcional si días &lt; 15)<br />
              • <strong>ISSS 3%</strong> sobre salario sujeto (cap $1,000) · <strong>AFP 7.25%</strong> sobre salario sujeto · <strong>ISR</strong> según tabla MH (5 tramos)<br />
              • <strong>Horas extra:</strong> $3/h diurnas · $16/día asueto (no se calcula por hora nocturna en tarifa fija)<br />
              • <strong>Propinas en planilla:</strong> solo extraordinarias (las semanales van por aparte en `/propinas`)<br />
              • Pendiente Fase 3: edge function que calcula automático días 1 y 16 + recibo PDF firmado<br />
              • Histórico Dic 2025 - Abril 2026 importado de los Excel de Yessica
            </div>
          </div>
        </>
      )}

      <Drawer open={!!selectedQ} onClose={() => setSelectedQ(null)} title={selectedQ ? `Detalle · ${fmtQuincena(selectedQ.quincena_inicio, selectedQ.quincena_fin)}` : ''}>
        {selectedQ && <QuincenaDetalle quincena={selectedQ} />}
      </Drawer>
    </PageShell>
  );
}

function QuincenaDetalle({ quincena }: { quincena: QuincenaRow }) {
  const [detalles, setDetalles] = useState<DetallePlanilla[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<{ dias: number; he: number; bono: number; propina: number; otros: number }>({ dias: 0, he: 0, bono: 0, propina: 0, otros: 0 });
  const [savingId, setSavingId] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    const [pRes, mRes] = await Promise.all([
      kaeru.from('planilla')
        .select('id,empleado_id,dias_trabajados,horas_extra,salario_base,bono,propina,isss,afp,isr,otros_descuentos,total_descuentos,neto_a_pagar,estado,fecha_pago,empleados:empleado_id(nombre,cargo)')
        .eq('quincena_inicio', quincena.quincena_inicio)
        .order('neto_a_pagar', { ascending: false }),
      kaeru.from('v_planilla_match_bac')
        .select('planilla_id,bac_match_fecha,bac_match_desc')
        .eq('quincena_inicio', quincena.quincena_inicio)
    ]);
    const matchMap = new Map<string, any>();
    for (const m of (mRes.data || []) as any[]) matchMap.set(m.planilla_id, m);
    setDetalles(((pRes.data || []) as any[]).map((d) => ({
      id: d.id, empleado_id: d.empleado_id,
      empleado_nombre: d.empleados?.nombre || '?',
      cargo: d.empleados?.cargo,
      dias_trabajados: Number(d.dias_trabajados || 0),
      horas_extra: Number(d.horas_extra || 0),
      salario_base: Number(d.salario_base || 0),
      bono: Number(d.bono || 0),
      propina: Number(d.propina || 0),
      isss: Number(d.isss || 0),
      afp: Number(d.afp || 0),
      isr: Number(d.isr || 0),
      otros_descuentos: Number(d.otros_descuentos || 0),
      total_descuentos: Number(d.total_descuentos || 0),
      neto_a_pagar: Number(d.neto_a_pagar || 0),
      estado: d.estado,
      fecha_pago: d.fecha_pago,
      bac_match_fecha: matchMap.get(d.id)?.bac_match_fecha,
      bac_match_desc: matchMap.get(d.id)?.bac_match_desc
    })));
    setLoading(false);
  }

  useEffect(() => {
    let cancel = false;
    (async () => { if (!cancel) await cargar(); })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quincena.quincena_inicio]);

  function abrirEdit(d: DetallePlanilla) {
    setEditingId(d.id);
    setEditBuf({ dias: d.dias_trabajados, he: d.horas_extra, bono: d.bono, propina: d.propina, otros: d.otros_descuentos });
  }

  async function guardarEdit(d: DetallePlanilla) {
    setSavingId(d.id);
    // Recalculamos total_descuentos y neto en cliente respetando ISSS/AFP/ISR ya calculados
    const nuevoTotalDesc = d.isss + d.afp + d.isr + Number(editBuf.otros || 0);
    const nuevoNeto = Number(d.salario_base) + Number(editBuf.he || 0) + Number(editBuf.bono || 0) + Number(editBuf.propina || 0) - nuevoTotalDesc;
    const { error } = await kaeru.from('planilla')
      .update({
        dias_trabajados: editBuf.dias,
        horas_extra: editBuf.he,
        bono: editBuf.bono,
        propina: editBuf.propina,
        otros_descuentos: editBuf.otros,
        total_descuentos: nuevoTotalDesc,
        neto_a_pagar: nuevoNeto
      })
      .eq('id', d.id);
    setSavingId(null);
    if (error) { alert('Error: ' + error.message); return; }
    setEditingId(null);
    await cargar();
  }

  async function marcarPagada(d: DetallePlanilla) {
    if (!confirm(`Marcar pagada $${d.neto_a_pagar.toFixed(2)} para ${d.empleado_nombre}?`)) return;
    setSavingId(d.id);
    const hoy = new Date().toISOString().slice(0, 10);
    const { error } = await kaeru.from('planilla')
      .update({ estado: 'pagada', fecha_pago: hoy })
      .eq('id', d.id);
    setSavingId(null);
    if (error) { alert('Error: ' + error.message); return; }
    await cargar();
  }

  async function reabrir(d: DetallePlanilla) {
    if (!confirm(`Reabrir como borrador? Esto quita la fecha de pago.`)) return;
    setSavingId(d.id);
    const { error } = await kaeru.from('planilla')
      .update({ estado: 'borrador', fecha_pago: null })
      .eq('id', d.id);
    setSavingId(null);
    if (error) { alert('Error: ' + error.message); return; }
    await cargar();
  }

  async function marcarTodasPagadas() {
    const borradores = detalles.filter((d) => d.estado !== 'pagada');
    if (borradores.length === 0) { alert('Ya están todas pagadas'); return; }
    const totalNeto = borradores.reduce((s, d) => s + d.neto_a_pagar, 0);
    if (!confirm(`Marcar ${borradores.length} líneas como pagadas?\nTotal: $${totalNeto.toFixed(2)}`)) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const { error } = await kaeru.from('planilla')
      .update({ estado: 'pagada', fecha_pago: hoy })
      .in('id', borradores.map((b) => b.id));
    if (error) { alert('Error: ' + error.message); return; }
    await cargar();
  }

  if (loading) return <div className="text-muted">Cargando…</div>;

  const borradoresCount = detalles.filter((d) => d.estado !== 'pagada').length;

  return (
    <div className="stack-sm">
      <div className="row-between" style={{ background: 'var(--bg-inset)', padding: 10, borderRadius: 'var(--r-md)' }}>
        <span className="text-muted" style={{ fontSize: 11 }}>{formatDate(quincena.quincena_inicio)} → {formatDate(quincena.quincena_fin)}</span>
        <span style={{ fontWeight: 700 }}>{detalles.length} empleados</span>
      </div>

      {borradoresCount > 0 && (
        <button
          onClick={marcarTodasPagadas}
          className="btn btn-kaeru btn-sm"
          style={{ width: '100%' }}
        >
          ✓ Marcar las {borradoresCount} pendientes como pagadas hoy
        </button>
      )}

      {detalles.map((d) => {
        const isEditing = editingId === d.id;
        const isSaving = savingId === d.id;
        return (
          <div key={d.id} className="card" style={{ padding: 12 }}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{d.empleado_nombre}</div>
                <div className="text-muted" style={{ fontSize: 11 }}>{d.cargo || '—'} · {d.dias_trabajados} días{d.horas_extra > 0 ? ` · +${formatUSD(d.horas_extra)} HE` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-metric)', fontSize: 22, color: 'var(--accent-kaeru)' }}>{formatUSD(d.neto_a_pagar)}</div>
                {d.estado === 'pagada' ? (
                  <span className="badge badge-kaeru" style={{ fontSize: 10 }}>✓ Pagada {d.fecha_pago && formatDate(d.fecha_pago)}</span>
                ) : (
                  <span className="badge badge-muted" style={{ fontSize: 10 }}>Borrador</span>
                )}
                {d.bac_match_fecha ? (
                  <div className="text-muted" style={{ fontSize: 9, marginTop: 2 }} title={d.bac_match_desc || ''}>
                    🏦 BAC {formatDate(d.bac_match_fecha)}
                  </div>
                ) : d.estado === 'pagada' && (
                  <div className="text-muted" style={{ fontSize: 9, marginTop: 2, color: 'var(--accent-purple)' }}>
                    💵 efectivo / sin BAC
                  </div>
                )}
              </div>
            </div>

            {isEditing ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 11, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="text-muted">Días trabajados</span>
                  <input type="number" min="0" max="16" step="0.5" value={editBuf.dias} onChange={(e) => setEditBuf({ ...editBuf, dias: Number(e.target.value) })} className="ki-input" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="text-muted">Horas extra ($)</span>
                  <input type="number" min="0" step="0.01" value={editBuf.he} onChange={(e) => setEditBuf({ ...editBuf, he: Number(e.target.value) })} className="ki-input" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="text-muted">Bono ($)</span>
                  <input type="number" min="0" step="0.01" value={editBuf.bono} onChange={(e) => setEditBuf({ ...editBuf, bono: Number(e.target.value) })} className="ki-input" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="text-muted">Propina ($)</span>
                  <input type="number" min="0" step="0.01" value={editBuf.propina} onChange={(e) => setEditBuf({ ...editBuf, propina: Number(e.target.value) })} className="ki-input" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: 'span 2' }}>
                  <span className="text-muted">Otros descuentos ($)</span>
                  <input type="number" min="0" step="0.01" value={editBuf.otros} onChange={(e) => setEditBuf({ ...editBuf, otros: Number(e.target.value) })} className="ki-input" />
                </label>
                <div style={{ gridColumn: 'span 2', fontSize: 10, color: 'var(--text-muted)', padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  ℹ ISSS/AFP/ISR se mantienen (recalcular con 🪄 Calcular si cambia salario base).
                  Nuevo neto: <strong style={{ color: 'var(--accent-kaeru)' }}>{formatUSD(Number(d.salario_base) + Number(editBuf.he) + Number(editBuf.bono) + Number(editBuf.propina) - (d.isss + d.afp + d.isr + Number(editBuf.otros)))}</strong>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, fontSize: 11, color: 'var(--text-muted)', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                <div className="row-between"><span>Salario base</span><span>{formatUSD(d.salario_base)}</span></div>
                <div className="row-between"><span>Bono</span><span>{formatUSD(d.bono)}</span></div>
                <div className="row-between"><span>Propina</span><span>{formatUSD(d.propina)}</span></div>
                <div className="row-between"><span>Otros desc.</span><span style={{ color: 'var(--state-danger)' }}>−{formatUSD(d.otros_descuentos)}</span></div>
                <div className="row-between"><span>ISSS 3%</span><span style={{ color: 'var(--state-danger)' }}>−{formatUSD(d.isss)}</span></div>
                <div className="row-between"><span>AFP 7.25%</span><span style={{ color: 'var(--state-danger)' }}>−{formatUSD(d.afp)}</span></div>
                <div className="row-between"><span>ISR</span><span style={{ color: 'var(--state-danger)' }}>−{formatUSD(d.isr)}</span></div>
              </div>
            )}

            <div className="row" style={{ marginTop: 10, gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {isEditing ? (
                <>
                  <button onClick={() => setEditingId(null)} className="btn btn-outline btn-sm" disabled={isSaving}>Cancelar</button>
                  <button onClick={() => guardarEdit(d)} className="btn btn-kaeru btn-sm" disabled={isSaving}>{isSaving ? '...' : '💾 Guardar'}</button>
                </>
              ) : (
                <>
                  <button onClick={() => verRecibo(d, quincena)} className="btn btn-outline btn-sm">📄 Recibo</button>
                  <button onClick={() => abrirEdit(d)} className="btn btn-outline btn-sm" disabled={isSaving}>✏ Editar HE/bono</button>
                  {d.estado === 'pagada' ? (
                    <button onClick={() => reabrir(d)} className="btn btn-outline btn-sm" disabled={isSaving}>↩ Reabrir</button>
                  ) : (
                    <button onClick={() => marcarPagada(d)} className="btn btn-kaeru btn-sm" disabled={isSaving}>{isSaving ? '...' : '✓ Pagada'}</button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Botón generar todos */}
      <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
        <button
          onClick={() => detalles.forEach((d, i) => setTimeout(() => verRecibo(d, quincena), i * 300))}
          className="btn btn-kaeru"
          style={{ width: '100%' }}
          disabled={detalles.length === 0}
        >
          📄 Generar TODOS los recibos ({detalles.length})
        </button>
      </div>
    </div>
  );
}
