import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';
import { n, fmtDate } from '../../config';
import { useToast } from '../../hooks/useToast';

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', blue: '#60a5fa', purple: '#a855f7',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
};

const fmt$ = (v) => `$${(n(v)).toFixed(2)}`;

const badge = (estado) => {
  const map = {
    borrador:  { bg: '#f59e0b', label: 'Borrador' },
    calculada: { bg: '#3b82f6', label: 'Calculada' },
    aprobada:  { bg: '#2d6a4f', label: 'Aprobada' },
    pagada:    { bg: '#4ade80', label: 'Pagada' },
  };
  const s = map[estado] || { bg: '#555', label: estado };
  return (
    <span style={{ background: s.bg, color: '#fff', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  );
};

// ── Genera HTML de boleta para imprimir ──────────────────────
function generarHTMLBoleta(det, planilla) {
  const emp = det.empleados;
  const nombre = emp?.nombre_completo || '—';
  const cargo  = emp?.cargo || '—';
  const devengado   = n(det.total_devengado);
  const descuentos  = n(det.total_descuentos);
  const neto        = n(det.neto_a_pagar);
  const propina     = n(det.propina_mensual);
  const bono        = n(det.bono_delivery);
  const hrsExtra    = n(det.monto_horas_extra);
  const isss        = n(det.descuento_isss);
  const afp         = n(det.descuento_afp);
  const isr         = n(det.descuento_isr);
  const adelantos   = n(det.descuento_adelantos);
  const faltas      = n(det.descuento_faltas);
  const tardanzas   = n(det.descuento_tardanzas);
  const prestamos   = n(det.descuento_prestamos);
  const otrosDesc   = n(det.descuento_otros);
  const salarioBase = n(det.salario_base_quincenal);
  const diasTrab    = det.dias_trabajados || 0;
  const diasAus     = det.dias_ausentes || 0;

  const row = (label, val, color = '#333') =>
    val !== 0 ? `<tr><td style="padding:4px 0;color:#555;font-size:13px;">${label}</td><td style="text-align:right;font-family:monospace;color:${color};font-size:13px;">${fmt$(val)}</td></tr>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Boleta — ${nombre} — ${planilla.periodo}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #fff; color: #222; padding: 32px; max-width: 600px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e63946; padding-bottom: 16px; margin-bottom: 20px; }
    .logo { font-size: 22px; font-weight: 900; color: #e63946; letter-spacing: -1px; }
    .logo span { color: #222; }
    .meta { text-align: right; font-size: 12px; color: #666; }
    .meta strong { color: #222; font-size: 13px; }
    .emp-info { background: #f9f9f9; border-radius: 8px; padding: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; }
    .emp-info .name { font-size: 16px; font-weight: 700; }
    .emp-info .cargo { font-size: 13px; color: #666; margin-top: 2px; }
    .section-title { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 6px; }
    table { width: 100%; border-collapse: collapse; }
    .divider { border: none; border-top: 1px solid #eee; margin: 12px 0; }
    .neto-row { background: #e63946; border-radius: 8px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
    .neto-row .label { color: #fff; font-weight: 700; font-size: 14px; }
    .neto-row .amount { color: #fff; font-size: 22px; font-weight: 900; font-family: monospace; }
    .footer { margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px; font-size: 11px; color: #aaa; text-align: center; }
    .asist-row { display: flex; gap: 24px; font-size: 12px; color: #666; }
    .asist-row span strong { color: #222; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">🍔 Freakie<span> Dogs</span></div>
      <div style="font-size:12px;color:#888;margin-top:4px;">Recibo de Pago</div>
    </div>
    <div class="meta">
      <strong>${planilla.periodo}</strong><br>
      ${fmtDate(planilla.fecha_inicio)} – ${fmtDate(planilla.fecha_fin)}<br>
      <span style="color:#e63946;font-weight:700;">Pago: ${fmtDate(planilla.fecha_pago)}</span>
    </div>
  </div>

  <div class="emp-info">
    <div>
      <div class="name">${nombre}</div>
      <div class="cargo">${cargo}</div>
    </div>
    <div class="asist-row" style="align-items:flex-end;flex-direction:column;gap:4px;">
      <span>Días trabajados: <strong>${diasTrab}</strong></span>
      <span>Días ausentes: <strong>${diasAus}</strong></span>
    </div>
  </div>

  <div class="section-title">Ingresos</div>
  <table>
    ${row('Salario base quincenal', salarioBase)}
    ${row('Horas extra', hrsExtra, '#2d6a4f')}
    ${row('Propinas', propina, '#2d6a4f')}
    ${row('Bono delivery', bono, '#2d6a4f')}
    <tr style="font-weight:700;">
      <td style="padding:6px 0;font-size:13px;border-top:1px solid #eee;">Total devengado</td>
      <td style="text-align:right;font-family:monospace;font-size:13px;border-top:1px solid #eee;">${fmt$(devengado)}</td>
    </tr>
  </table>

  <div class="section-title">Deducciones</div>
  <table>
    ${row('ISSS (empleado)', isss, '#c0392b')}
    ${row('AFP (empleado)', afp, '#c0392b')}
    ${row('Renta (ISR)', isr, '#c0392b')}
    ${row('Adelantos', adelantos, '#c0392b')}
    ${row('Descuento por faltas', faltas, '#c0392b')}
    ${row('Tardanzas', tardanzas, '#c0392b')}
    ${row('Préstamos', prestamos, '#c0392b')}
    ${row('Otros descuentos', otrosDesc, '#c0392b')}
    <tr style="font-weight:700;">
      <td style="padding:6px 0;font-size:13px;border-top:1px solid #eee;">Total deducciones</td>
      <td style="text-align:right;font-family:monospace;font-size:13px;border-top:1px solid #eee;color:#c0392b;">${fmt$(descuentos)}</td>
    </tr>
  </table>

  <div class="neto-row">
    <div class="label">NETO A RECIBIR</div>
    <div class="amount">${fmt$(neto)}</div>
  </div>

  <div class="footer">
    Este documento es un comprobante oficial de pago. · Freakie Dogs ERP v2<br>
    Generado el ${new Date().toLocaleDateString('es-SV')}
  </div>

  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}

// ── Componente principal ─────────────────────────────────────
export default function RecibosDigitales({ user, onBack }) {
  const { show } = useToast();
  const [screen, setScreen] = useState(0); // 0=lista, 1=detalle
  const [planillas, setPlanillas] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDet, setLoadingDet] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState(null); // detalle siendo editado
  const [editForm, setEditForm] = useState({});
  const [filtroSuc, setFiltroSuc] = useState('todas');
  const [sucursales, setSucursales] = useState([]);

  // ── Cargar planillas ──
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await db.from('planillas')
        .select('*')
        .in('estado', ['calculada', 'aprobada', 'pagada'])
        .order('fecha_inicio', { ascending: false });
      setPlanillas(data || []);
      setLoading(false);
    })();
  }, []);

  // ── Abrir detalle de planilla ──
  const abrirPlanilla = useCallback(async (p) => {
    setSelected(p);
    setLoadingDet(true);
    setScreen(1);
    setFiltroSuc('todas');

    const [{ data: dets }, { data: sucs }] = await Promise.all([
      db.from('planilla_detalle')
        .select('*, empleados(id, nombre_completo, cargo, sucursal_id)')
        .eq('planilla_id', p.id)
        .order('empleados(nombre_completo)'),
      db.from('sucursales').select('id, nombre, store_code').order('nombre'),
    ]);

    setDetalles(dets || []);
    setSucursales(sucs || []);
    setEmpleados((dets || []).map(d => d.empleados).filter(Boolean));
    setLoadingDet(false);
  }, []);

  // ── Filtrado por sucursal ──
  const sucMap = useMemo(() => {
    const m = {};
    sucursales.forEach(s => { m[s.id] = { nombre: s.nombre, code: s.store_code }; });
    return m;
  }, [sucursales]);

  const detallesFiltrados = useMemo(() => {
    if (filtroSuc === 'todas') return detalles;
    return detalles.filter(d => d.empleados?.sucursal_id === filtroSuc);
  }, [detalles, filtroSuc]);

  // ── Abrir modal de ajustes ──
  const abrirAjustes = (det) => {
    setEditando(det);
    setEditForm({
      propina_mensual:     String(n(det.propina_mensual)),
      bono_delivery:       String(n(det.bono_delivery)),
      descuento_adelantos: String(n(det.descuento_adelantos)),
      descuento_otros:     String(n(det.descuento_otros)),
      descuento_prestamos: String(n(det.descuento_prestamos)),
    });
  };

  // ── Guardar ajustes ──
  const guardarAjustes = async () => {
    if (!editando) return;
    setGuardando(true);
    try {
      const propina  = n(editForm.propina_mensual);
      const bono     = n(editForm.bono_delivery);
      const adelanto = n(editForm.descuento_adelantos);
      const otros    = n(editForm.descuento_otros);
      const prestamo = n(editForm.descuento_prestamos);

      // Recalcular totales
      const devengado  = n(editando.salario_base_quincenal) + n(editando.monto_horas_extra) + propina + bono;
      const descuentos = n(editando.descuento_isss) + n(editando.descuento_afp) + n(editando.descuento_isr)
                       + adelanto + otros + prestamo + n(editando.descuento_faltas) + n(editando.descuento_tardanzas);
      const neto = devengado - descuentos;

      const { error } = await db.from('planilla_detalle').update({
        propina_mensual:     propina,
        bono_delivery:       bono,
        descuento_adelantos: adelanto,
        descuento_otros:     otros,
        descuento_prestamos: prestamo,
        total_devengado:     devengado,
        total_descuentos:    descuentos,
        neto_a_pagar:        neto,
      }).eq('id', editando.id);

      if (error) throw error;

      // Actualizar estado local
      setDetalles(prev => prev.map(d =>
        d.id === editando.id ? {
          ...d, propina_mensual: propina, bono_delivery: bono,
          descuento_adelantos: adelanto, descuento_otros: otros, descuento_prestamos: prestamo,
          total_devengado: devengado, total_descuentos: descuentos, neto_a_pagar: neto,
        } : d
      ));
      show('✓ Ajustes guardados');
      setEditando(null);
    } catch (e) {
      show('Error: ' + e.message);
    } finally { setGuardando(false); }
  };

  // ── Ver boleta individual (print preview) ──
  const verBoleta = (det) => {
    const html = generarHTMLBoleta(det, selected);
    const w = window.open('', '_blank', 'width=680,height=900');
    w.document.write(html);
    w.document.close();
  };

  // ── Generar todas las boletas → recibos_pago ──
  const generarTodasBoletas = async () => {
    if (!selected || detalles.length === 0) return;
    setGuardando(true);
    try {
      const registros = detalles.map(d => ({
        empleado_id:       d.empleado_id,
        periodo:           selected.periodo,
        salario_base:      n(d.salario_base_quincenal),
        horas_extra:       n(d.monto_horas_extra),
        bonificaciones:    n(d.bono_delivery),
        propinas:          n(d.propina_mensual),
        isss:              n(d.descuento_isss),
        afp:               n(d.descuento_afp),
        renta:             n(d.descuento_isr),
        otros_descuentos:  n(d.descuento_otros) + n(d.descuento_adelantos) + n(d.descuento_tardanzas)
                         + n(d.descuento_prestamos) + n(d.descuento_faltas),
        neto:              n(d.neto_a_pagar),
        estado:            'pendiente',
      }));

      const { error } = await db.from('recibos_pago')
        .upsert(registros, { onConflict: 'empleado_id,periodo', ignoreDuplicates: false });

      if (error) throw error;
      show(`✅ ${registros.length} boletas generadas en recibos_pago`);
    } catch (e) {
      show('Error al generar boletas: ' + e.message);
    } finally { setGuardando(false); }
  };

  // ── RENDER ───────────────────────────────────────────────────

  // Pantalla 0: Lista de planillas
  if (screen === 0) {
    return (
      <div style={{ padding: '16px 12px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          {onBack && (
            <button onClick={onBack} style={{ background: 'none', border: 'none', color: c.red, fontSize: 18, cursor: 'pointer' }}>←</button>
          )}
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>🧾 Recibos Digitales</div>
            <div style={{ fontSize: 13, color: c.textDim }}>Genera y gestiona boletas de pago</div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando planillas…</div>
        ) : planillas.length === 0 ? (
          <div style={{ textAlign: 'center', color: c.textOff, padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div>No hay planillas calculadas aún</div>
          </div>
        ) : (
          planillas.map(p => (
            <div key={p.id} onClick={() => abrirPlanilla(p)} style={{
              background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12,
              padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>{p.periodo}</div>
                <div style={{ fontSize: 12, color: c.textDim, marginTop: 3 }}>
                  {fmtDate(p.fecha_inicio)} – {fmtDate(p.fecha_fin)} · Pago: {fmtDate(p.fecha_pago)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {badge(p.estado)}
                <div style={{ fontSize: 14, fontWeight: 700, color: c.green, marginTop: 4 }}>
                  {fmt$(p.total_neto)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  // Pantalla 1: Detalle de planilla
  const sucOptions = [...new Set(detalles.map(d => d.empleados?.sucursal_id).filter(Boolean))];

  return (
    <div style={{ padding: '16px 12px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => setScreen(0)} style={{ background: 'none', border: 'none', color: c.red, fontSize: 18, cursor: 'pointer' }}>←</button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: c.text }}>{selected?.periodo}</div>
            <div style={{ fontSize: 12, color: c.textDim }}>
              {fmtDate(selected?.fecha_inicio)} – {fmtDate(selected?.fecha_fin)} · {detalles.length} empleados
            </div>
          </div>
        </div>
        <button
          onClick={generarTodasBoletas}
          disabled={guardando || detalles.length === 0}
          style={{
            background: c.green, color: '#111', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {guardando ? 'Guardando…' : `💾 Guardar ${detalles.length} boletas`}
        </button>
      </div>

      {/* Resumen planilla */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total bruto', val: fmt$(selected?.total_bruto), color: c.text },
          { label: 'Descuentos', val: fmt$(selected?.total_descuentos), color: c.red },
          { label: 'Neto total', val: fmt$(selected?.total_neto), color: c.green },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: 11, color: c.textDim, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: 'monospace' }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Filtro sucursal */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={filtroSuc}
          onChange={e => setFiltroSuc(e.target.value)}
          style={{ background: c.card, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13 }}
        >
          <option value="todas">Todas las sucursales ({detalles.length})</option>
          {sucOptions.map(sid => (
            <option key={sid} value={sid}>
              {sucMap[sid]?.nombre || sid} ({detalles.filter(d => d.empleados?.sucursal_id === sid).length})
            </option>
          ))}
        </select>
      </div>

      {/* Tabla empleados */}
      {loadingDet ? (
        <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando empleados…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${c.border}` }}>
                {['Empleado', 'Cargo', 'Sucursal', 'Devengado', 'Deducciones', 'Neto', ''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === '' ? 'center' : 'left', color: c.textDim, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detallesFiltrados.map(det => {
                const emp = det.empleados;
                const suc = sucMap[emp?.sucursal_id];
                return (
                  <tr key={det.id} style={{ borderBottom: `1px solid ${c.cardBorder}` }}>
                    <td style={{ padding: '10px 10px', color: c.text, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {emp?.nombre_completo || '—'}
                    </td>
                    <td style={{ padding: '10px 10px', color: c.textDim, fontSize: 12 }}>{emp?.cargo || '—'}</td>
                    <td style={{ padding: '10px 10px', color: c.textDim, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {suc?.code || '—'}
                    </td>
                    <td style={{ padding: '10px 10px', color: c.text, fontFamily: 'monospace', textAlign: 'right' }}>
                      {fmt$(det.total_devengado)}
                    </td>
                    <td style={{ padding: '10px 10px', color: c.red, fontFamily: 'monospace', textAlign: 'right' }}>
                      -{fmt$(det.total_descuentos)}
                    </td>
                    <td style={{ padding: '10px 10px', color: c.green, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>
                      {fmt$(det.neto_a_pagar)}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => abrirAjustes(det)}
                        style={{ background: '#2a2a2a', color: c.yellow, border: `1px solid ${c.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', marginRight: 4 }}
                      >✏️</button>
                      <button
                        onClick={() => verBoleta(det)}
                        style={{ background: '#2a2a2a', color: c.blue, border: `1px solid ${c.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
                      >🖨️</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal ajustes */}
      {editando && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{ background: '#1a1a1a', border: `1px solid ${c.border}`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: c.text, marginBottom: 4 }}>
              ✏️ Ajustes — {editando.empleados?.nombre_completo}
            </div>
            <div style={{ fontSize: 12, color: c.textDim, marginBottom: 20 }}>
              Salario base: {fmt$(editando.salario_base_quincenal)} · Días: {editando.dias_trabajados}
            </div>

            {[
              { key: 'propina_mensual',     label: '🤑 Propinas',         color: c.green },
              { key: 'bono_delivery',       label: '🛵 Bono delivery',    color: c.green },
              { key: 'descuento_adelantos', label: '💸 Adelantos',        color: c.red },
              { key: 'descuento_prestamos', label: '🏦 Préstamos',        color: c.red },
              { key: 'descuento_otros',     label: '➖ Otros descuentos', color: c.red },
            ].map(({ key, label, color }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>{label}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm[key]}
                  onChange={e => setEditForm(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{
                    width: '100%', background: '#111', color, border: `1px solid ${c.border}`,
                    borderRadius: 8, padding: '8px 12px', fontSize: 14, fontFamily: 'monospace',
                  }}
                />
              </div>
            ))}

            {/* Preview neto calculado */}
            <div style={{ background: '#111', borderRadius: 8, padding: '10px 14px', marginBottom: 20, border: `1px solid ${c.greenDark}` }}>
              <div style={{ fontSize: 11, color: c.textDim, marginBottom: 4 }}>Neto estimado</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.green, fontFamily: 'monospace' }}>
                {fmt$(
                  n(editando.salario_base_quincenal) + n(editando.monto_horas_extra)
                  + n(editForm.propina_mensual) + n(editForm.bono_delivery)
                  - n(editando.descuento_isss) - n(editando.descuento_afp) - n(editando.descuento_isr)
                  - n(editForm.descuento_adelantos) - n(editForm.descuento_prestamos) - n(editForm.descuento_otros)
                  - n(editando.descuento_faltas) - n(editando.descuento_tardanzas)
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setEditando(null)}
                style={{ flex: 1, background: '#2a2a2a', color: c.textDim, border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 0', fontSize: 13, cursor: 'pointer' }}
              >Cancelar</button>
              <button
                onClick={guardarAjustes}
                disabled={guardando}
                style={{ flex: 2, background: c.green, color: '#111', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >{guardando ? 'Guardando…' : '✓ Guardar ajustes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
