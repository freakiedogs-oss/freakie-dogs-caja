import { useEffect, useState } from 'react';
import PageShell, { LoadingCard, ErrorCard, EmptyCard } from '@/components/ui/PageShell';
import { kaeru } from '@/lib/supabase';
import { useToast } from '@/lib/toast';

// ============================================================
// /asistencia — Marcaje con PIN + vista del día
// ------------------------------------------------------------
// Vive como un teclado PIN grande (similar a /login pero más rápido)
// con feedback inmediato y luego una grilla de TODOS los empleados
// activos mostrando estado del día (no marcó / trabajando / cerrado).
//
// La tablet de cocina se queda en esta pantalla todo el día. Cada
// empleado entra/sale ingresando su PIN. Si es la primera vez del
// día → marca entrada. Si ya entró → marca salida. Si ya cerró →
// muestra "ya cerraste hoy".
//
// Diseño tipo kiosko: full screen, sin sidebar, header mínimo.
// ============================================================

interface EmpleadoHoy {
  empleado_id: string;
  nombre: string;
  cargo: string | null;
  entrada_at: string | null;
  salida_at: string | null;
  minutos_trabajados: number | null;
  estado: 'no_marcó' | 'trabajando' | 'cerrado';
}

interface MarcajeResult {
  empleado_id: string;
  empleado_nombre: string;
  accion: 'entrada' | 'salida' | 'ya_cerrado';
  hora: string;
  minutos_acum: number;
}

function fmtHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtMin(m: number | null): string {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

export default function Asistencia() {
  const toast = useToast();
  const [empleados, setEmpleados] = useState<EmpleadoHoy[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [pin, setPin]             = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);
  const [feedback, setFeedback] = useState<MarcajeResult | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error: err } = await kaeru.from('v_asistencia_hoy').select('*');
      if (cancel) return;
      if (err) setError(err.message);
      else     setEmpleados((data || []) as unknown as EmpleadoHoy[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [tick]);

  // Auto-refresh cada 30s
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Auto-submit cuando el PIN tiene 6 dígitos
  useEffect(() => {
    if (pin.length === 6 && !submitting) {
      handleMarcar(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Limpia el feedback después de 4 segundos
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  async function handleMarcar(currentPin: string) {
    setSubmitting(true);
    const { data, error: err } = await kaeru.rpc('asistencia_marcar', { p_pin: currentPin });
    setSubmitting(false);
    setPin('');

    if (err) {
      toast.error('PIN no reconocido');
      return;
    }

    const result = (Array.isArray(data) && data.length > 0 ? data[0] : null) as MarcajeResult | null;
    if (!result) {
      toast.error('Sin respuesta del servidor');
      return;
    }

    setFeedback(result);

    if (result.accion === 'entrada') {
      toast.success(`✓ ${result.empleado_nombre} — entrada ${fmtHora(result.hora)}`);
    } else if (result.accion === 'salida') {
      toast.success(`✓ ${result.empleado_nombre} — salida ${fmtHora(result.hora)} · ${fmtMin(result.minutos_acum)}`);
    } else {
      toast.info(`${result.empleado_nombre} ya cerró hoy a las ${fmtHora(result.hora)}`);
    }
    setTick((x) => x + 1);
  }

  const tap = (n: string) => {
    if (pin.length < 6 && !submitting) setPin((p) => p + n);
  };
  const clearLast = () => setPin((p) => p.slice(0, -1));
  const clearAll  = () => setPin('');

  const ahora = new Date();
  const trabajando = empleados.filter((e) => e.estado === 'trabajando').length;
  const cerrados   = empleados.filter((e) => e.estado === 'cerrado').length;
  const noMarcaron = empleados.filter((e) => e.estado === 'no_marcó').length;

  async function exportarCSV() {
    // Default: quincena actual
    const hoy = new Date();
    const dia = hoy.getDate();
    const yyyymm = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const qi = dia <= 15 ? `${yyyymm}-01` : `${yyyymm}-16`;
    const qf = dia <= 15 ? `${yyyymm}-15` : `${yyyymm}-${new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate()}`;
    const desde = prompt('Fecha desde (YYYY-MM-DD):', qi) || qi;
    const hasta = prompt('Fecha hasta (YYYY-MM-DD):', qf) || qf;

    const { data, error: err } = await kaeru
      .from('asistencia')
      .select('fecha,entrada_at,salida_at,minutos_trabajados,notas,empleados:empleado_id(nombre,cargo,dui)')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('empleado_id')
      .order('fecha');
    if (err) { toast.error('Error: ' + err.message); return; }
    const rows: (string|number)[][] = [
      ['Kaeru Chan — Asistencia ' + desde + ' a ' + hasta, '', '', '', '', '', '', ''],
      ['NIT 0623-010725-109-7', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
      ['Empleado', 'Cargo', 'DUI', 'Fecha', 'Entrada', 'Salida', 'Minutos', 'Horas']
    ];
    for (const r of (data || []) as any[]) {
      const ent = r.entrada_at ? new Date(r.entrada_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      const sal = r.salida_at  ? new Date(r.salida_at ).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      const min = r.minutos_trabajados || 0;
      const horas = (min / 60).toFixed(2);
      rows.push([
        r.empleados?.nombre || '',
        r.empleados?.cargo || '',
        r.empleados?.dui || '',
        r.fecha, ent, sal, min, horas
      ]);
    }
    const csv = rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `asistencia_kaeru_${desde}_a_${hasta}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`✓ Exportado ${data?.length || 0} registros`);
  }

  return (
    <PageShell
      kanji="勤"
      titulo="Asistencia"
      subtitulo={`${ahora.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })} · ${ahora.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })}`}
      badge={{ label: `${trabajando} trabajando · ${cerrados} cerrados · ${noMarcaron} sin marcar`, variant: 'kaeru' }}
      actions={
        <button onClick={exportarCSV} className="btn btn-outline btn-sm" title="Exportar a CSV para el contador">
          📥 Export CSV
        </button>
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard error={error} />}

      {!loading && !error && (
        <>
          {/* Layout 2 columnas: PIN pad izq + grilla empleados der */}
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>

            {/* PIN pad */}
            <div className="card" style={{ position: 'sticky', top: 16 }}>
              <div className="card-title" style={{ marginBottom: 12 }}>Marcar entrada/salida</div>

              {/* Feedback box */}
              <div style={{ minHeight: 76, marginBottom: 12 }}>
                {feedback && (
                  <div style={{
                    padding: 12,
                    borderRadius: 'var(--r-md)',
                    background: feedback.accion === 'entrada' ? 'rgba(95,224,169,0.15)'
                              : feedback.accion === 'salida'  ? 'rgba(154,111,209,0.15)'
                              : 'rgba(245,180,0,0.15)',
                    border: `1px solid ${feedback.accion === 'entrada' ? 'var(--accent-kaeru)'
                                       : feedback.accion === 'salida'  ? 'var(--accent-purple)'
                                       : '#f5b400'}`,
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{feedback.empleado_nombre}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {feedback.accion === 'entrada' && `✓ Entrada ${fmtHora(feedback.hora)}`}
                      {feedback.accion === 'salida'  && `✓ Salida ${fmtHora(feedback.hora)} · trabajaste ${fmtMin(feedback.minutos_acum)}`}
                      {feedback.accion === 'ya_cerrado' && `⚠ Ya cerraste hoy a las ${fmtHora(feedback.hora)}`}
                    </div>
                  </div>
                )}
              </div>

              {/* Dots */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
                {Array.from({ length: 6 }).map((_, i) => {
                  const filled = i < pin.length;
                  return (
                    <div key={i} style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: filled ? 'var(--accent-kaeru)' : 'transparent',
                      border: `2px solid ${filled ? 'var(--accent-kaeru)' : 'var(--border-default)'}`,
                    }} />
                  );
                })}
              </div>

              {/* Keypad */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {['1','2','3','4','5','6','7','8','9'].map((n) => (
                  <button key={n} onClick={() => tap(n)} disabled={submitting} style={keyStyle}>
                    {n}
                  </button>
                ))}
                <button onClick={clearAll} disabled={submitting || pin.length === 0} style={keyMutedStyle}>CLR</button>
                <button onClick={() => tap('0')} disabled={submitting} style={keyStyle}>0</button>
                <button onClick={clearLast} disabled={submitting || pin.length === 0} style={{ ...keyMutedStyle, fontSize: 20 }}>←</button>
              </div>
            </div>

            {/* Grilla empleados */}
            <div>
              {empleados.length === 0 ? (
                <EmptyCard message="Sin empleados activos" />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {empleados.map((e) => (
                    <EmpleadoCard key={e.empleado_id} e={e} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Info card */}
          <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)', marginTop: 16 }}>
            <div className="card-title text-purple" style={{ marginBottom: 8 }}>ℹ Cómo funciona</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              • Ingresá tu PIN de 6 dígitos.<br />
              • Primera vez del día → marca <strong className="text-kaeru">entrada</strong>.<br />
              • Segunda vez → marca <strong className="text-purple">salida</strong> y muestra horas trabajadas.<br />
              • Si ya cerraste, te avisa — para corregir, pedirle al manager que edite tu registro en <code>/empleados</code>.<br />
              • Esta pantalla está pensada para una <strong>tablet en cocina</strong> — déjala abierta todo el día. Auto-refresh cada 30s.
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

function EmpleadoCard({ e }: { e: EmpleadoHoy }) {
  const color = e.estado === 'trabajando' ? 'var(--accent-kaeru)'
              : e.estado === 'cerrado'    ? 'var(--accent-purple)'
              : 'var(--text-muted)';
  const bg    = e.estado === 'trabajando' ? 'rgba(95,224,169,0.08)'
              : e.estado === 'cerrado'    ? 'rgba(154,111,209,0.06)'
              : 'transparent';

  return (
    <div className="card" style={{
      background: bg,
      borderLeft: `3px solid ${color}`,
      padding: 12
    }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{e.nombre}</div>
      <div className="text-muted" style={{ fontSize: 10, textTransform: 'capitalize', marginBottom: 8 }}>{e.cargo || '—'}</div>
      <div style={{ fontSize: 11, lineHeight: 1.6 }}>
        {e.estado === 'no_marcó' && (
          <span className="text-muted">⚪ Sin marcar</span>
        )}
        {e.estado === 'trabajando' && (
          <>
            <div className="text-kaeru" style={{ fontWeight: 600 }}>🟢 Trabajando</div>
            <div className="text-muted">Entrada {fmtHora(e.entrada_at)}</div>
          </>
        )}
        {e.estado === 'cerrado' && (
          <>
            <div className="text-purple" style={{ fontWeight: 600 }}>✓ Cerrado</div>
            <div className="text-muted">{fmtHora(e.entrada_at)} → {fmtHora(e.salida_at)} · {fmtMin(e.minutos_trabajados)}</div>
          </>
        )}
      </div>
    </div>
  );
}

const keyStyle: React.CSSProperties = {
  aspectRatio: '1 / 1',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-md)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-metric)',
  fontSize: 24,
  cursor: 'pointer',
  touchAction: 'manipulation'
};
const keyMutedStyle: React.CSSProperties = {
  ...keyStyle,
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-muted)',
  fontSize: 11
};
