// ── Impresión de tablas de inventario / kardex ───────────────────────────────
// Genera una hoja carta en vertical pensada para leerse y escribirse EN PAPEL:
// letra de 11–12px (no la miniatura que sale al imprimir la PWA tal cual),
// márgenes de 13–16mm, encabezado de tabla repetido en cada página, filas que
// no se partan entre páginas y casillas en blanco con altura suficiente para
// anotar a mano. Se abre en una ventana nueva con el diálogo de impresión;
// si el navegador bloquea la ventana, cae a un iframe oculto.
//
// Uso:
//   imprimirTabla({
//     titulo: 'Inventario Casa Matriz',
//     subtitulo: 'Stock actual por categoría',
//     meta: [{ label: 'Sucursal', value: 'CM001' }, { label: 'Fecha', value: '21-oct-2026' }],
//     columnas: [
//       { key: 'nombre', label: 'Producto' },                       // ancho libre
//       { key: 'unidad', label: 'Unidad', width: '12%', align: 'center', muted: true },
//       { key: 'stock',  label: 'Stock',  width: '12%', align: 'right', tipo: 'num', bold: true },
//       { key: 'conteo', label: 'Conteo', width: '16%', blank: true }, // casilla para escribir
//     ],
//     grupos: [{ titulo: 'Carnes', filas: [...] }],   // o bien `filas: [...]` sin agrupar
//     resumen: [{ label: 'Total productos', value: 120 }],
//     firmas: ['Contó', 'Revisó'],
//     nota: 'Texto chico al pie',
//   });
//
// Cada fila puede traer `_class: 'alerta'` para resaltarse (fondo rosado) y
// cada columna puede traer `render: (fila) => texto` para formatear.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Enteros sin decimales; decimales con hasta 2 cifras y sin ceros de relleno.
export const fmtNum = (v) => {
  if (v == null || v === '') return '';
  const x = Number(v);
  if (Number.isNaN(x)) return String(v);
  if (Number.isInteger(x)) return x.toLocaleString('es-SV');
  return x.toLocaleString('es-SV', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

export const fmtFechaHora = (d = new Date()) =>
  d.toLocaleString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const CSS = (orientacion, escritura) => `
  @page { size: letter ${orientacion}; margin: 15mm 13mm 16mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111;
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.3; }
  body { padding: 20px; max-width: 8.5in; margin: 0 auto; }
  @media print { body { padding: 0; max-width: none; } .no-print { display: none !important; } }

  .barra { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 14px; }
  .barra button { font: inherit; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: 1px solid #999; background: #f4f4f4; cursor: pointer; }
  .barra button.primario { background: #e63946; border-color: #e63946; color: #fff; }

  .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  .marca { font-size: 15px; font-weight: 900; letter-spacing: .3px; }
  .titulo { font-size: 18px; font-weight: 800; margin-top: 2px; }
  .subtitulo { font-size: 12px; color: #555; margin-top: 2px; }
  .meta { text-align: right; font-size: 11.5px; color: #333; min-width: 150px; }
  .meta div { margin-bottom: 2px; white-space: nowrap; }
  .meta b { color: #111; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  th { background: #1c1c1c; color: #fff; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px;
    padding: 6px 7px; text-align: left; border: 1px solid #1c1c1c; }
  td { padding: ${escritura ? '8px 7px' : '5px 7px'}; font-size: 11.5px; border-bottom: 1px solid #cfcfcf;
    vertical-align: middle; overflow-wrap: anywhere; ${escritura ? 'height: 30px;' : ''} }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f6f6f6; }
  tbody tr.alerta td { background: #fde8e8; }
  tbody tr.alerta td.col-nombre { font-weight: 700; }
  tbody tr.ok td.col-dif { color: #166534; }
  tr.grp { break-after: avoid; page-break-after: avoid; }
  tr.grp td { background: #e4e4e4 !important; font-weight: 800; font-size: 11.5px; padding: 6px 7px;
    border-top: 1px solid #999; border-bottom: 1px solid #999; }
  tr.grp .grp-n { font-weight: 400; color: #555; margin-left: 6px; font-size: 10.5px; }
  .l { text-align: left; } .c { text-align: center; } .r { text-align: right; }
  .num { font-variant-numeric: tabular-nums; }
  .bold { font-weight: 700; }
  .muted { color: #666; font-size: 10.5px; }
  td.blank { background: #fff !important; border: 1px solid #777; }
  .sub { display: block; font-size: 9.5px; color: #777; font-weight: 400; }

  /* Resumen, nota, firmas y pie van en un solo bloque indivisible: si no cabe,
     pasa completo a la siguiente hoja en vez de dejar las firmas huérfanas. */
  .cierre { break-inside: avoid; page-break-inside: avoid; }
  .resumen { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 11.5px;
    border-top: 1px solid #999; padding-top: 6px; }
  .resumen b { font-size: 12.5px; }
  .firmas { margin-top: 22px; display: flex; gap: 24px; }
  .firma { flex: 1; border-top: 1px solid #111; padding-top: 5px; text-align: center; font-size: 11px; color: #333; }
  .nota { margin-top: 6px; font-size: 10.5px; color: #666; }
  .pie { margin-top: 10px; font-size: 10px; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 5px; }
  .vacio { padding: 30px; text-align: center; color: #666; border: 1px dashed #bbb; border-radius: 8px; }
`;

function celda(col, fila) {
  const cls = ['col-' + col.key, col.align === 'right' ? 'r' : col.align === 'center' ? 'c' : 'l'];
  if (col.tipo === 'num') cls.push('num');
  if (col.bold) cls.push('bold');
  if (col.muted) cls.push('muted');
  if (col.blank) { cls.push('blank'); return `<td class="${cls.join(' ')}"></td>`; }
  let txt;
  if (col.render) {
    const r = col.render(fila);
    txt = col.html ? String(r ?? '') : esc(r);
  } else {
    const v = fila[col.key];
    txt = col.tipo === 'num' ? esc(fmtNum(v)) : esc(v);
  }
  return `<td class="${cls.join(' ')}">${txt}</td>`;
}

// Arma el documento HTML completo (exportado aparte para poder previsualizarlo
// o generarlo a PDF sin abrir ventanas).
export function htmlTabla({
  titulo,
  subtitulo = '',
  meta = [],
  columnas = [],
  grupos = null,
  filas = null,
  resumen = [],
  firmas = [],
  nota = '',
  orientacion = 'portrait',
  marca = '🍔 FREAKIE DOGS',
}) {
  const escritura = columnas.some((c) => c.blank);
  const ths = columnas.map((c) => {
    const al = c.align === 'right' ? 'r' : c.align === 'center' ? 'c' : 'l';
    const w = c.width ? ` style="width:${esc(c.width)}"` : '';
    return `<th class="${al}"${w}>${esc(c.label)}</th>`;
  }).join('');

  const filaHtml = (f) => {
    const cls = f?._class ? ` class="${esc(f._class)}"` : '';
    return `<tr${cls}>${columnas.map((c) => celda(c, f)).join('')}</tr>`;
  };

  let total = 0;
  let cuerpo = '';
  if (grupos && grupos.length) {
    cuerpo = grupos.map((g) => {
      const fs = g.filas || [];
      total += fs.length;
      const n = g.n ?? fs.length;
      return `<tr class="grp"><td colspan="${columnas.length}">${esc(g.titulo)}<span class="grp-n">(${n})</span></td></tr>` + fs.map(filaHtml).join('');
    }).join('');
  } else if (filas && filas.length) {
    total = filas.length;
    cuerpo = filas.map(filaHtml).join('');
  }

  const metaHtml = meta.filter((m) => m && m.value != null && m.value !== '')
    .map((m) => `<div><b>${esc(m.label)}:</b> ${esc(m.value)}</div>`).join('');
  const resumenHtml = resumen.length
    ? `<div class="resumen">${resumen.map((r) => `<div>${esc(r.label)}: <b>${esc(r.value)}</b></div>`).join('')}</div>` : '';
  const firmasHtml = firmas.length
    ? `<div class="firmas">${firmas.map((f) => `<div class="firma">${esc(f)}</div>`).join('')}</div>` : '';
  const ahora = fmtFechaHora();

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>${CSS(orientacion, escritura)}</style></head>
<body>
  <div class="barra no-print">
    <button onclick="window.close()">Cerrar</button>
    <button class="primario" onclick="window.print()">🖨️ Imprimir</button>
  </div>
  <div class="cab">
    <div>
      <div class="marca">${esc(marca)}</div>
      <div class="titulo">${esc(titulo)}</div>
      ${subtitulo ? `<div class="subtitulo">${esc(subtitulo)}</div>` : ''}
    </div>
    <div class="meta">${metaHtml}</div>
  </div>
  ${total === 0
    ? '<div class="vacio">No hay filas para imprimir con los filtros actuales.</div>'
    : `<table><thead><tr>${ths}</tr></thead><tbody>${cuerpo}</tbody></table>`}
  <div class="cierre">
    ${resumenHtml}
    ${nota ? `<div class="nota">${esc(nota)}</div>` : ''}
    ${firmasHtml}
    <div class="pie">Freakie Dogs ERP · ${total} fila${total === 1 ? '' : 's'} · generado ${esc(ahora)}</div>
  </div>
</body></html>`;
  return html;
}

export function imprimirTabla(opts) {
  const html = htmlTabla(opts);

  // Ventana nueva (patrón ya usado en despacho y recibos). Si el navegador la
  // bloquea, se imprime desde un iframe oculto en la misma pestaña.
  let w = null;
  try { w = window.open('', '_blank'); } catch { w = null; }
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* el usuario puede usar el botón */ } }, 450);
    return true;
  }
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(f);
  const d = f.contentDocument || f.contentWindow?.document;
  if (!d) { f.remove(); return false; }
  d.open(); d.write(html); d.close();
  setTimeout(() => {
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* nada */ }
    setTimeout(() => f.remove(), 60_000);
  }, 450);
  return true;
}

// Agrupa filas por una clave, ordenando grupos alfabéticamente y las filas por
// `ordenar` (por defecto el nombre). Devuelve el formato que espera `grupos`.
export function agruparFilas(filas, clave, { ordenar = 'nombre', sinGrupo = 'Sin categoría' } = {}) {
  const map = new Map();
  for (const f of filas) {
    const k = (typeof clave === 'function' ? clave(f) : f[clave]) || sinGrupo;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base' });
  return [...map.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([titulo, fs]) => ({
      titulo,
      filas: ordenar ? [...fs].sort((a, b) => cmp(typeof ordenar === 'function' ? ordenar(a) : a[ordenar], typeof ordenar === 'function' ? ordenar(b) : b[ordenar])) : fs,
    }));
}
