// ============================================================
// Helper PDF amonestación imprimible
// ------------------------------------------------------------
// HTML legalmente útil con espacio para firma manuscrita del empleado
// + firma de quien reporta. Patrón window.open → auto-print, igual que
// el helper de recibos de planilla (lib/recibo.ts).
//
// Útil para tener un archivo físico que el empleado firme cuando se
// le reporta una amonestación verbal o escrita.
// ============================================================

export interface AmonestacionPdfData {
  empleado_nombre: string;
  empleado_cargo: string | null;
  empleado_dui?: string | null;
  fecha: string;
  tipo: 'verbal' | 'escrita' | 'suspension' | 'descuento' | 'reconocimiento';
  motivo: string;
  detalle: string | null;
  monto_descuento: number | null;
  reportado_por: string | null;
  empleado_firmo?: boolean | null;
  fecha_firma?: string | null;
}

const TIPO_LABEL: Record<string, { label: string; subtitulo: string; positivo: boolean }> = {
  verbal:         { label: 'Amonestación verbal',         subtitulo: 'Llamada de atención formal', positivo: false },
  escrita:        { label: 'Amonestación escrita',        subtitulo: 'Reincidencia o falta grave', positivo: false },
  suspension:     { label: 'Suspensión',                  subtitulo: 'Suspensión laboral',         positivo: false },
  descuento:      { label: 'Descuento en planilla',       subtitulo: 'Por daño/falta económica',   positivo: false },
  reconocimiento: { label: 'Reconocimiento',              subtitulo: 'Excelencia laboral',         positivo: true  },
};

export function generarAmonestacionHTML(d: AmonestacionPdfData): string {
  const meta = TIPO_LABEL[d.tipo] || TIPO_LABEL.verbal;
  const fmt$ = (n: number) => `$${n.toFixed(2)}`;
  const fechaFmt = new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-SV', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const accentColor = meta.positivo ? '#5fe0a9' : '#e74c3c';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${meta.label} · ${d.empleado_nombre} · ${d.fecha}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #0a0a0a; color: #f4f0e6; padding: 32px; max-width: 700px; margin: 0 auto; min-height: 100vh; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${accentColor}; padding-bottom: 18px; margin-bottom: 24px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .kanji { font-size: 42px; color: #5fe0a9; font-weight: 200; }
  .brand-name { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
  .brand-sub { font-size: 11px; color: #9a6fd1; margin-top: 2px; text-transform: uppercase; letter-spacing: 2px; }
  .meta { text-align: right; font-size: 11px; color: #a8a8a8; }
  .meta strong { color: ${accentColor}; font-size: 13px; }
  .tipo-box { background: rgba(231,76,60,0.08); border: 1.5px solid ${accentColor}; border-radius: 12px; padding: 16px; margin-bottom: 22px; }
  .tipo-titulo { font-size: 22px; font-weight: 700; color: ${accentColor}; text-transform: uppercase; letter-spacing: 1.5px; }
  .tipo-sub    { font-size: 11px; color: #a8a8a8; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase; }
  .seccion { margin: 20px 0; }
  .section-title { font-size: 10px; font-weight: 700; color: ${accentColor}; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; }
  .row-info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 12px; background: rgba(154,111,209,0.06); border-radius: 8px; }
  .row-info > div > .label { font-size: 10px; color: #a8a8a8; text-transform: uppercase; letter-spacing: 1px; }
  .row-info > div > .value { font-size: 14px; font-weight: 600; color: #f4f0e6; margin-top: 3px; }
  .motivo-box { background: #1a1a1a; border-left: 3px solid ${accentColor}; padding: 14px 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; }
  .detalle-box { color: #c4c4c4; font-size: 13px; line-height: 1.7; padding: 12px 0; white-space: pre-wrap; }
  .monto-box { background: linear-gradient(135deg, rgba(231,76,60,0.15), rgba(154,111,209,0.15)); border: 1.5px solid ${accentColor}; border-radius: 12px; padding: 16px 22px; display: flex; justify-content: space-between; align-items: center; margin: 20px 0; }
  .monto-label { color: #f4f0e6; font-weight: 700; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; }
  .monto-amt { color: ${accentColor}; font-family: 'Bebas Neue', sans-serif; font-size: 28px; font-weight: 700; }
  .firma-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 48px; }
  .firma-box { text-align: center; }
  .firma-linea { border-top: 1px solid #555; padding-top: 6px; font-size: 11px; color: #a8a8a8; }
  .firma-rol { font-size: 9px; color: #6b6b6b; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px; }
  .firmado-badge { display: inline-block; padding: 4px 10px; background: rgba(95,224,169,0.2); color: #5fe0a9; border: 1px solid #5fe0a9; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-top: 8px; }
  .footer { margin-top: 32px; border-top: 1px solid rgba(244,240,230,0.08); padding-top: 16px; font-size: 10px; color: #6b6b6b; text-align: center; line-height: 1.6; }
  .footer strong { color: ${accentColor}; }
  @media print {
    body { background: #fff; color: #222; padding: 20px; }
    .kanji { color: #5fe0a9; }
    .brand-name, .row-info > div > .value, .motivo-box, .monto-label { color: #222; }
    .row-info { background: #f5f5f5; }
    .motivo-box { background: #fafafa; }
    .detalle-box { color: #444; }
    .firma-linea { color: #555; }
    .footer { color: #888; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="kanji">蛙</div>
      <div>
        <div class="brand-name">Kaeru Chan</div>
        <div class="brand-sub">${meta.positivo ? 'Reconocimiento al colaborador' : 'Documento disciplinario'}</div>
      </div>
    </div>
    <div class="meta">
      <strong>Fecha</strong><br>
      ${fechaFmt}<br>
      ${d.fecha}
    </div>
  </div>

  <div class="tipo-box">
    <div class="tipo-titulo">${meta.label}</div>
    <div class="tipo-sub">${meta.subtitulo}</div>
  </div>

  <div class="seccion">
    <div class="section-title">Colaborador</div>
    <div class="row-info">
      <div>
        <div class="label">Nombre</div>
        <div class="value">${d.empleado_nombre}</div>
      </div>
      <div>
        <div class="label">Cargo</div>
        <div class="value">${d.empleado_cargo || '—'}</div>
      </div>
      ${d.empleado_dui ? `<div>
        <div class="label">DUI</div>
        <div class="value">${d.empleado_dui}</div>
      </div>` : ''}
      <div>
        <div class="label">Reportado por</div>
        <div class="value">${d.reportado_por || '—'}</div>
      </div>
    </div>
  </div>

  <div class="seccion">
    <div class="section-title">${meta.positivo ? 'Motivo del reconocimiento' : 'Motivo / falta'}</div>
    <div class="motivo-box">${d.motivo}</div>
  </div>

  ${d.detalle ? `<div class="seccion">
    <div class="section-title">Detalle</div>
    <div class="detalle-box">${d.detalle}</div>
  </div>` : ''}

  ${d.monto_descuento != null && d.monto_descuento > 0 ? `<div class="monto-box">
    <div class="monto-label">Descuento a aplicar en planilla</div>
    <div class="monto-amt">${fmt$(d.monto_descuento)}</div>
  </div>` : ''}

  <div class="seccion">
    <div class="section-title">${meta.positivo ? 'Acuse de recibo' : 'Acuse de notificación'}</div>
    <p style="font-size: 12px; color: #c4c4c4; line-height: 1.7;">
      Yo, <strong>${d.empleado_nombre}</strong>, declaro que he recibido${meta.positivo ? ' este reconocimiento' : ' la presente notificación'}
      el día ${fechaFmt}${meta.positivo ? '' : ', comprendo el motivo expuesto y me comprometo a las acciones correctivas correspondientes'}.
    </p>
  </div>

  <div class="firma-grid">
    <div class="firma-box">
      <div style="height: 56px;"></div>
      <div class="firma-linea">Firma del colaborador</div>
      <div class="firma-rol">${d.empleado_nombre}</div>
      ${d.empleado_firmo ? `<div class="firmado-badge">✓ Firmado ${d.fecha_firma ? new Date(d.fecha_firma).toLocaleDateString('es-SV') : ''}</div>` : ''}
    </div>
    <div class="firma-box">
      <div style="height: 56px;"></div>
      <div class="firma-linea">Firma supervisor / manager</div>
      <div class="firma-rol">${d.reportado_por?.split('@')[0] || 'Kaeru Chan'}</div>
    </div>
  </div>

  <div class="footer">
    <strong>Kaeru Chan, S.A. de C.V.</strong> · NIT 0623-010725-109-7 · NRC 366756-0<br>
    EPIC Plaza, Nivel 2, Local #228, Nuevo Cuscatlán<br>
    <span style="opacity:0.6;">Documento generado por ERP Kaeru el ${new Date().toLocaleString('es-SV')}</span>
  </div>

  <script>setTimeout(() => window.print(), 500);</script>
</body>
</html>`;
}

export function verAmonestacionPdf(d: AmonestacionPdfData, onPopupBlocked?: () => void) {
  const html = generarAmonestacionHTML(d);
  const w = window.open('', '_blank', 'width=780,height=900');
  if (!w) {
    if (onPopupBlocked) onPopupBlocked();
    else alert('Permití las ventanas emergentes para ver el documento');
    return;
  }
  w.document.write(html);
  w.document.close();
}
