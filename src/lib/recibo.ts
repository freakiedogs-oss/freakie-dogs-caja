// ============================================================
// Helpers de recibo de planilla — extraídos de Planilla.tsx
// Usados por /planilla, /recibos y /mi-boleta.
// Patrón: window.open → HTML dark Kaeru → auto-print → user guarda PDF
// ============================================================

export interface ReciboDetalle {
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
}

export interface ReciboQuincena {
  quincena_inicio: string;
  quincena_fin: string;
}

export function generarReciboHTML(d: ReciboDetalle, q: ReciboQuincena): string {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const row = (label: string, val: number, sign: '+' | '-' | '' = '') => val === 0 ? '' : `
    <tr>
      <td style="padding:6px 0;color:#a8a8a8;font-size:13px;">${label}</td>
      <td style="text-align:right;font-family:'Bebas Neue',sans-serif;color:${sign === '-' ? '#e74c3c' : sign === '+' ? '#5fe0a9' : '#f4f0e6'};font-size:14px;letter-spacing:0.5px;">${sign === '-' ? '−' : ''}${fmt(val)}</td>
    </tr>`;

  const periodo = `${q.quincena_inicio} → ${q.quincena_fin}`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo · ${d.empleado_nombre} · ${periodo}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #0a0a0a; color: #f4f0e6; padding: 32px; max-width: 600px; margin: 0 auto; min-height: 100vh; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #5fe0a9; padding-bottom: 18px; margin-bottom: 22px; }
    .brand { display: flex; gap: 12px; align-items: center; }
    .kanji { font-size: 42px; color: #5fe0a9; font-weight: 200; }
    .brand-text { display: flex; flex-direction: column; }
    .brand-name { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #f4f0e6; }
    .brand-sub { font-size: 11px; color: #9a6fd1; margin-top: 2px; text-transform: uppercase; letter-spacing: 2px; }
    .meta { text-align: right; font-size: 11px; color: #a8a8a8; }
    .meta strong { color: #5fe0a9; font-size: 13px; }
    .emp-info { background: rgba(154,111,209,0.08); border: 1px solid rgba(154,111,209,0.3); border-radius: 10px; padding: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .emp-name { font-size: 18px; font-weight: 700; color: #f4f0e6; }
    .emp-cargo { font-size: 12px; color: #9a6fd1; margin-top: 4px; text-transform: capitalize; }
    .asist { text-align: right; font-size: 11px; color: #a8a8a8; }
    .asist strong { color: #f4f0e6; font-weight: 700; font-size: 13px; }
    .section-title { font-size: 10px; font-weight: 700; color: #5fe0a9; text-transform: uppercase; letter-spacing: 2px; margin: 18px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    .total-row { font-weight: 700; }
    .total-row td { padding: 8px 0 4px; font-size: 13px; border-top: 1px solid rgba(244,240,230,0.1); }
    .neto-row { background: linear-gradient(135deg, rgba(95,224,169,0.15), rgba(154,111,209,0.15)); border: 1.5px solid #5fe0a9; border-radius: 12px; padding: 18px 22px; display: flex; justify-content: space-between; align-items: center; margin-top: 24px; }
    .neto-label { color: #f4f0e6; font-weight: 700; font-size: 14px; letter-spacing: 1px; }
    .neto-amount { color: #5fe0a9; font-family: 'Bebas Neue', sans-serif; font-size: 32px; font-weight: 700; letter-spacing: 1px; }
    .footer { margin-top: 32px; border-top: 1px solid rgba(244,240,230,0.08); padding-top: 16px; font-size: 10px; color: #6b6b6b; text-align: center; line-height: 1.6; }
    .footer strong { color: #5fe0a9; }
    .estado-badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    .estado-pagada { background: rgba(95,224,169,0.2); color: #5fe0a9; border: 1px solid #5fe0a9; }
    .estado-borrador { background: rgba(168,168,168,0.1); color: #a8a8a8; border: 1px solid #a8a8a8; }
    @media print {
      body { background: #fff; color: #222; padding: 16px; }
      .kanji { color: #5fe0a9; }
      .brand-name { color: #222; }
      .emp-info, .emp-name, .asist strong { color: #222; }
      .meta { color: #555; }
      .meta strong { color: #5fe0a9; }
      .neto-row { border-color: #5fe0a9; background: rgba(95,224,169,0.1); }
      .neto-label { color: #222; }
      .footer { color: #888; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="kanji">蛙</div>
      <div class="brand-text">
        <div class="brand-name">Kaeru Chan</div>
        <div class="brand-sub">Recibo de pago</div>
      </div>
    </div>
    <div class="meta">
      <strong>Quincena</strong><br>
      ${q.quincena_inicio}<br>→ ${q.quincena_fin}<br>
      ${d.fecha_pago ? `<span style="color:#5fe0a9;margin-top:4px;display:inline-block;">Pago: ${d.fecha_pago}</span>` : ''}
    </div>
  </div>

  <div class="emp-info">
    <div>
      <div class="emp-name">${d.empleado_nombre}</div>
      <div class="emp-cargo">${d.cargo || '—'}</div>
    </div>
    <div class="asist">
      Días trabajados: <strong>${d.dias_trabajados}</strong><br>
      ${d.horas_extra > 0 ? `Horas extra $: <strong>${fmt(d.horas_extra)}</strong>` : ''}
    </div>
  </div>

  <div class="section-title">Ingresos</div>
  <table>
    ${row('Salario base quincenal', d.salario_base, '+')}
    ${row('Horas extra', d.horas_extra, '+')}
    ${row('Bono', d.bono, '+')}
    ${row('Propina', d.propina, '+')}
    <tr class="total-row">
      <td>Total devengado</td>
      <td style="text-align:right;font-family:'Bebas Neue',sans-serif;font-size:15px;color:#5fe0a9;">${fmt(d.salario_base + d.horas_extra + d.bono + d.propina)}</td>
    </tr>
  </table>

  <div class="section-title">Deducciones</div>
  <table>
    ${row('ISSS 3%', d.isss, '-')}
    ${row('AFP 7.25%', d.afp, '-')}
    ${row('ISR (Renta)', d.isr, '-')}
    ${row('Otros descuentos', d.otros_descuentos, '-')}
    <tr class="total-row">
      <td>Total deducciones</td>
      <td style="text-align:right;font-family:'Bebas Neue',sans-serif;font-size:15px;color:#e74c3c;">−${fmt(d.total_descuentos)}</td>
    </tr>
  </table>

  <div class="neto-row">
    <div class="neto-label">NETO A RECIBIR</div>
    <div class="neto-amount">${fmt(d.neto_a_pagar)}</div>
  </div>

  <div style="margin-top: 16px; text-align: center;">
    <span class="estado-badge ${d.estado === 'pagada' ? 'estado-pagada' : 'estado-borrador'}">${d.estado === 'pagada' ? '✓ Pagada' : 'Borrador'}</span>
  </div>

  <div class="footer">
    Este documento es un <strong>comprobante oficial de pago</strong> emitido por Kaeru Chan, S.A. de C.V.<br>
    NIT 0623-010725-109-7 · NRC 366756-0<br>
    EPIC Plaza, Nivel 2, Local #228, Nuevo Cuscatlán<br>
    <span style="opacity:0.6;">Generado el ${new Date().toLocaleString('es-SV')} · Kaeru ERP</span>
  </div>

  <script>setTimeout(() => window.print(), 500);</script>
</body>
</html>`;
}

export function verRecibo(d: ReciboDetalle, q: ReciboQuincena, onPopupBlocked?: () => void) {
  const html = generarReciboHTML(d, q);
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) {
    if (onPopupBlocked) onPopupBlocked();
    else alert('Permite ventanas emergentes para ver el recibo');
    return;
  }
  w.document.write(html);
  w.document.close();
}
