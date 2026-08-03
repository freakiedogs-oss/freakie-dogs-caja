/**
 * printService.js — Capa de impresión del POS Freakie Dogs.
 *
 * Centraliza TODA la impresión térmica: comanda de cocina, pre-cuenta y
 * factura/ticket de cobro. La config de cada impresora vive en Supabase
 * (`pos_impresoras` por store_code) — no se programa nada en el dispositivo,
 * solo se apunta por IP.
 *
 * Transporte (columna `modo` en pos_impresoras):
 *   - 'rawbt'   → deep-link `rawbt:base64,...` (app RawBT en el tablet Android).
 *                 La impresora se configura UNA vez dentro de RawBT (IP:9100).
 *   - 'bridge'  → POST a un agente HTTP→TCP9100 en la LAN (campo bridge_url).
 *                 La IP viaja en el request (config 100% en BD).
 *   - 'sistema' → window.print() con HTML (fallback universal / AirPrint / CUPS).
 *
 * Si RawBT no está instalado, cae automáticamente a 'sistema'.
 *
 * Precios Freakie Dogs INCLUYEN IVA.
 */

import { Ticket } from './escpos';
import qrcode from 'qrcode-generator';
import { db } from '../../supabase';

// ── Datos fiscales del emisor (dte_service.businesses) ──
export const EMISOR = {
  razon: 'FREAKIE DOGS, S.A. de C.V.',
  nit: '0614-0512-231010',
  nrc: '3368168',
  actividad: 'Restaurantes',
  tel: '2222-2222',
  correo: 'info@freakiedogs.com',
};

const DGII_CONSULTA = 'https://admin.factura.gob.sv/consultaPublica';

function qrSvg(text, cell = 4) {
  try { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: false }); }
  catch (e) { return ''; }
}

// Cache por (store_code, caja) — guarda el ARRAY de impresoras activas de esa caja.
const _cache = new Map();
const _ckey = (storeCode, caja) => `${storeCode}|${caja || ''}`;

// Elige la impresora según el TIPO de documento dentro de una caja:
//  - 'precuenta' → la de meseros (rol='precuenta') si existe;
//  - resto (comanda/factura/corte) → la principal (rol != 'precuenta').
// Una caja con 1 sola impresora siempre la devuelve (comportamiento normal).
function pickImpresora(rows, tipo) {
  const list = rows || [];
  if (tipo === 'precuenta') {
    const pre = list.find(r => r && r.rol === 'precuenta');
    if (pre) return pre;
  }
  return list.find(r => r && r.rol !== 'precuenta') || list[0] || null;
}

/** Lee (y cachea) TODAS las impresoras activas de una sucursal/caja. */
export async function getImpresoras(storeCode, caja = null, { force = false } = {}) {
  const key = _ckey(storeCode, caja);
  if (!force && _cache.has(key)) return _cache.get(key);
  let q = db.from('pos_impresoras').select('*')
    .eq('store_code', storeCode)
    .eq('activa', true);
  if (caja) q = q.eq('caja', caja);
  const { data, error } = await q.order('rol', { ascending: true });
  if (error) { console.error('[print] getImpresoras', error); return []; }
  const rows = data || [];
  _cache.set(key, rows);
  return rows;
}

/** Impresora concreta para un documento. `tipo` null = la principal de la caja. */
export async function getImpresora(storeCode, caja = null, tipo = null, opts = {}) {
  const rows = await getImpresoras(storeCode, caja, opts);
  return pickImpresora(rows, tipo);
}

export function clearImpresoraCache() { _cache.clear(); }

// ── Helpers de formato ──
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
function horaSV(d = new Date()) {
  return new Date(d).toLocaleString('es-SV', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
function fechaISO(d = new Date()) {
  // YYYY-MM-DD en hora local SV (UTC-6)
  return new Date(new Date(d).getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════
//  CONSTRUCTORES DE DOCUMENTOS (ESC/POS)
// ════════════════════════════════════════════════════════════

/** COMANDA de cocina — sin precios. */
export function buildComanda(c, cols = 48) {
  const t = new Ticket(cols);
  t.align('center').bold(true).size(2, 2).ln('COMANDA').normal();
  const dest = c.mesa ? `MESA ${c.mesa}` : (c.tipoLabel || 'PARA LLEVAR').toUpperCase();
  t.bold(true).size(1, 2).ln(dest).normal();
  t.align('left').hr();
  if (c.orden != null) t.row('Orden:', `#${c.orden}`);
  t.row('Hora:', horaSV());
  if (c.mesero) t.row('Mesero:', c.mesero);
  else if (c.cajero) t.row('Cajero:', c.cajero);
  if (c.comandaNumero != null) t.row('Comanda:', `#${c.comandaNumero}`);
  t.hr();
  for (const it of c.items || []) {
    t.bold(true).size(1, 2);
    t.ln(`${String(it.qty).padStart(2, ' ')}  ${String(it.nombre).toUpperCase()}`);
    t.normal();
    for (const m of it.modificadores || []) t.ln(`     + ${m}`);
    if (it.nota) { t.invert(true).wrap(`  ! ${it.nota}  `, 5); t.invert(false); }
  }
  t.hr().align('center').ln('- FIN -').feed(1);
  t.cut();
  return t;
}

/** PRE-CUENTA — con precios, NO fiscal. */
export function buildPreCuenta(c, cols = 48) {
  const t = new Ticket(cols);
  t.align('center').bold(true).size(2, 2).ln('FREAKIE DOGS').normal();
  if (c.storeName) t.align('center').ln(c.storeName);
  t.align('center').bold(true).ln('* PRE-CUENTA *').bold(false);
  t.ln('NO ES COMPROBANTE FISCAL');
  t.align('left').hr();
  if (c.mesa) t.row('Mesa:', `#${c.mesa}`);
  else t.row('Tipo:', c.tipoLabel || 'Para llevar');
  if (c.orden != null) t.row('Orden:', `#${c.orden}`);
  t.row('Fecha:', horaSV());
  if (c.mesero) t.row('Mesero:', c.mesero);
  t.hr();
  for (const it of c.items || []) {
    t.row(`${it.qty}x ${it.nombre}`.slice(0, cols - 9), money(it.precio * it.qty));
    for (const m of it.modificadores || []) t.ln(`   + ${m}`);
    if (it.nota) t.ln(`   (${it.nota})`);
  }
  t.hr();
  t.row('SUBTOTAL', money(c.subtotal));
  if (c.descuento > 0) t.row('DESCUENTO', `-${money(c.descuento)}`);
  if (c.propinaSugerida) {
    const propina = Math.round(c.subtotal * 0.10 * 100) / 100;
    t.row('PROPINA (10%)', money(propina));
    t.bold(true).size(1, 2).row('TOTAL', money(c.total + propina)).normal();
    t.feed(1).align('center').ln('Propina 10% incluida (ajustable al pagar)');
  } else {
    t.bold(true).size(1, 2).row('TOTAL', money(c.total)).normal();
  }
  t.feed(1).align('center').ln('Gracias por su visita').feed(1);
  t.cut();
  return t;
}

/** FACTURA / TICKET de cobro. Incluye DTE + QR DGII si aplica. */
export function buildFactura(c, cols = 48) {
  const t = new Ticket(cols);
  t.align('center').bold(true).size(2, 2).ln('FREAKIE DOGS').normal();
  if (c.pager != null) t.align('center').bold(true).size(2, 2).ln('PAGER ' + c.pager).normal();
  t.align('center').ln(EMISOR.razon);
  t.ln(`NIT: ${EMISOR.nit}`);
  t.ln(`NRC: ${EMISOR.nrc}`);
  if (c.storeName) t.ln(c.storeName);
  t.hr();

  const dte = c.dte;
  const label = dte?.label || (dte ? 'DOCUMENTO TRIBUTARIO ELECTRÓNICO' : 'TICKET INTERNO');
  t.align('center').bold(true).ln(label).bold(false);
  if (!dte) t.ln('(no es comprobante fiscal)');
  t.align('left');

  if (dte) {
    if (dte.numeroControl) t.ln(`N° Control: ${dte.numeroControl}`);
    if (dte.codigoGeneracion) { t.ln('Cód. Generación:'); t.ln(dte.codigoGeneracion); }
    if (dte.sello) { t.ln('Sello recepción:'); t.wrap(dte.sello); }
    t.row('Fecha emisión:', fechaISO(dte.fecha || c.fecha));
  } else {
    t.row('Fecha:', horaSV(c.fecha));
  }

  if (c.cliente?.nombre) {
    t.hr().ln(`Cliente: ${c.cliente.nombre}`);
    if (c.cliente.doc) t.ln(`Doc: ${c.cliente.doc}`);
  }
  t.hr();

  for (const it of c.items || []) {
    t.row(`${it.qty}x ${it.nombre}`.slice(0, cols - 9), money(it.precio * it.qty));
    for (const m of it.modificadores || []) t.ln(`   + ${m}`);
  }
  t.hr();
  t.row('SUBTOTAL', money(c.subtotal));
  if (c.descuento > 0) t.row('DESCUENTO', `-${money(c.descuento)}`);
  if (dte?.tipo === 'ccf' && c.iva != null) t.row('IVA 13%', money(c.iva));
  t.bold(true).size(1, 2).row('TOTAL', money(c.total)).normal();
  if (c.propina > 0) t.row('Propina', money(c.propina));
  if (c.metodoPago) t.row('Pago:', String(c.metodoPago).toUpperCase());

  // QR de consulta pública DGII
  if (dte?.codigoGeneracion) {
    const url = `${DGII_CONSULTA}?ambiente=01&codGen=${dte.codigoGeneracion}&fechaEmi=${fechaISO(dte.fecha || c.fecha)}`;
    t.feed(1).align('center').ln('Consulta este DTE en:').qr(url, 6);
    t.ln('admin.factura.gob.sv');
  }
  // Una reimpresión tiene que distinguirse del original: si no, se pueden
  // entregar dos tickets idénticos del mismo cobro.
  if (c.reimpresion) {
    t.feed(1).align('center').bold(true).ln('*** TICKET REIMPRESO ***').bold(false);
    t.ln('No es un nuevo cobro');
  }
  t.feed(1).align('center').ln('Gracias por su compra').ln('¡Vuelva pronto!').feed(1);
  t.cut();
  return t;
}

// ════════════════════════════════════════════════════════════
//  RENDER HTML (fallback window.print / modo 'sistema')
// ════════════════════════════════════════════════════════════

function htmlDoc(title, bodyLines) {
  const rows = bodyLines.map((l) => {
    if (l.qr) return '<div class="c" style="margin:6px 0">' + l.qr + '</div>';
    if (l.pagerBig != null) return '<div class="pager">PAGER ' + l.pagerBig + '</div>';
    if (l.hr) return '<hr>';
    if (l.center) return `<div class="c ${l.big ? 'big' : ''} ${l.bold ? 'b' : ''}">${l.text || ''}</div>`;
    if (l.row) return `<div class="r ${l.bold ? 'b' : ''}"><span>${l.left}</span><span>${l.right}</span></div>`;
    return `<div class="${l.bold ? 'b' : ''}">${l.text || ''}</div>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>@page{size:80mm auto;margin:0}
  body{font-family:'Courier New',monospace;font-size:13px;width:80mm;margin:0 auto;padding:4mm 3mm;color:#000}
  .c{text-align:center}.b{font-weight:700}.big{font-size:20px}
  .r{display:flex;justify-content:space-between}
  hr{border:none;border-top:1px dashed #000;margin:5px 0}
  .pager{text-align:center;font-weight:800;font-size:44px;border:3px solid #000;border-radius:8px;padding:2px 0;margin:6px 0}</style></head>
  <body>${rows}<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
}

function comandaHTML(c) {
  const L = [
    { center: 1, big: 1, bold: 1, text: 'COMANDA' },
    { center: 1, bold: 1, text: c.mesa ? `MESA ${c.mesa}` : (c.tipoLabel || 'PARA LLEVAR') },
    { hr: 1 },
    ...(c.orden != null ? [{ row: 1, left: 'Orden:', right: `#${c.orden}` }] : []),
    { row: 1, left: 'Hora:', right: horaSV() },
    ...(c.mesero ? [{ row: 1, left: 'Mesero:', right: c.mesero }] : []),
    { hr: 1 },
  ];
  for (const it of c.items || []) {
    L.push({ bold: 1, text: `${it.qty}  ${String(it.nombre).toUpperCase()}` });
    for (const m of it.modificadores || []) L.push({ text: `&nbsp;&nbsp;&nbsp;+ ${m}` });
    if (it.nota) L.push({ bold: 1, text: `&nbsp;&nbsp;! ${it.nota}` });
  }
  L.push({ hr: 1 }, { center: 1, text: '- FIN -' });
  return htmlDoc('Comanda', L);
}

function preCuentaHTML(c) {
  const L = [
    { center: 1, big: 1, bold: 1, text: 'FREAKIE DOGS' },
    ...(c.storeName ? [{ center: 1, text: c.storeName }] : []),
    { center: 1, bold: 1, text: '* PRE-CUENTA *' },
    { center: 1, text: 'NO ES COMPROBANTE FISCAL' },
    { hr: 1 },
    { row: 1, left: c.mesa ? 'Mesa:' : 'Tipo:', right: c.mesa ? `#${c.mesa}` : (c.tipoLabel || 'Para llevar') },
    { row: 1, left: 'Fecha:', right: horaSV() },
    { hr: 1 },
  ];
  for (const it of c.items || []) {
    L.push({ row: 1, left: `${it.qty}x ${it.nombre}`, right: money(it.precio * it.qty) });
    for (const m of it.modificadores || []) L.push({ text: `&nbsp;&nbsp;&nbsp;+ ${m}` });
    if (it.nota) L.push({ text: `&nbsp;&nbsp;&nbsp;(${it.nota})` });
  }
  L.push({ hr: 1 }, { row: 1, left: 'SUBTOTAL', right: money(c.subtotal) });
  if (c.descuento > 0) L.push({ row: 1, left: 'DESCUENTO', right: `-${money(c.descuento)}` });
  if (c.propinaSugerida) {
    const propina = Math.round(c.subtotal * 0.10 * 100) / 100;
    L.push({ row: 1, left: 'PROPINA (10%)', right: money(propina) });
    L.push({ row: 1, bold: 1, left: 'TOTAL', right: money(c.total + propina) });
    L.push({ center: 1, text: 'Propina 10% incluida (ajustable al pagar)' });
  } else {
    L.push({ row: 1, bold: 1, left: 'TOTAL', right: money(c.total) });
  }
  L.push({ center: 1, text: 'Gracias por su visita' });
  return htmlDoc('Pre-Cuenta', L);
}

function facturaHTML(c) {
  const dte = c.dte;
  const L = [
    { center: 1, big: 1, bold: 1, text: 'FREAKIE DOGS' },
    ...(c.pager != null ? [{ pagerBig: c.pager }] : []),
    { center: 1, text: EMISOR.razon },
    { center: 1, text: `NIT ${EMISOR.nit} · NRC ${EMISOR.nrc}` },
    ...(c.storeName ? [{ center: 1, text: c.storeName }] : []),
    { hr: 1 },
    { center: 1, bold: 1, text: dte?.label || (dte ? 'DTE' : 'TICKET INTERNO') },
  ];
  if (dte?.numeroControl) L.push({ text: `N° Control: ${dte.numeroControl}` });
  if (dte?.codigoGeneracion) L.push({ text: `Cód Gen: ${dte.codigoGeneracion}` });
  if (dte?.sello) L.push({ text: `Sello: ${dte.sello}` });
  L.push({ row: 1, left: 'Fecha:', right: dte ? fechaISO(dte.fecha || c.fecha) : horaSV(c.fecha) });
  if (c.cliente?.nombre) L.push({ hr: 1 }, { text: `Cliente: ${c.cliente.nombre}` });
  L.push({ hr: 1 });
  for (const it of c.items || []) {
    L.push({ row: 1, left: `${it.qty}x ${it.nombre}`, right: money(it.precio * it.qty) });
    for (const m of it.modificadores || []) L.push({ text: `&nbsp;&nbsp;&nbsp;+ ${m}` });
  }
  L.push({ hr: 1 }, { row: 1, left: 'SUBTOTAL', right: money(c.subtotal) });
  if (c.descuento > 0) L.push({ row: 1, left: 'DESCUENTO', right: `-${money(c.descuento)}` });
  L.push({ row: 1, bold: 1, left: 'TOTAL', right: money(c.total) });
  if (c.propina > 0) L.push({ row: 1, left: 'Propina', right: money(c.propina) });
  if (dte?.codigoGeneracion) {
    const _qurl = `${DGII_CONSULTA}?ambiente=01&codGen=${dte.codigoGeneracion}&fechaEmi=${fechaISO(dte.fecha || c.fecha)}`;
    const _svg = qrSvg(_qurl);
    if (_svg) { L.push({ center: 1, text: 'Consulta este DTE en:' }); L.push({ qr: _svg }); L.push({ center: 1, text: 'admin.factura.gob.sv' }); }
    else { L.push({ center: 1, text: `DGII: ${DGII_CONSULTA}?codGen=${dte.codigoGeneracion}` }); }
  }
  L.push({ center: 1, text: 'Gracias por su compra' });
  return htmlDoc('Factura', L);
}

// ════════════════════════════════════════════════════════════
//  DESPACHO
// ════════════════════════════════════════════════════════════

/** Envía bytes ESC/POS a RawBT (Android). */
function sendRawBT(ticket) {
  const href = `rawbt:base64,${ticket.base64()}`;
  const a = document.createElement('a');
  a.href = href;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}

/** Envía a un bridge HTTP→TCP9100 en la LAN. */
async function sendBridge(ticket, imp) {
  const res = await fetch(imp.bridge_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ip: imp.ip_address,
      port: imp.puerto || 9100,
      dataB64: ticket.base64(),
    }),
  });
  if (!res.ok) throw new Error(`bridge ${res.status}`);
}

/** Imprime por window.print() usando un iframe oculto EN LA MISMA pagina.
 *  No abre popup (Chrome no lo bloquea). Con Chrome --kiosk-printing sale
 *  directo a la impresora predeterminada, SIN dialogo (como QUANTO). */
function sendSistema(html) {
  const old = document.getElementById('__pos_print_frame');
  if (old) old.remove();
  const f = document.createElement('iframe');
  f.id = '__pos_print_frame';
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  f.srcdoc = html; // mismo origen; el propio HTML dispara window.print() en su onload
  f.onload = () => {
    try {
      f.contentWindow.addEventListener('afterprint', () => {
        setTimeout(() => { try { f.remove(); } catch (_) {} }, 500);
      }, { once: true });
    } catch (_) {}
  };
  document.body.appendChild(f);
  // limpieza de respaldo por si 'afterprint' no dispara (kiosk-printing a veces no lo emite)
  setTimeout(() => { const el = document.getElementById('__pos_print_frame'); if (el) el.remove(); }, 120000);
}

/**
 * Despacha un documento ya construido.
 * @param {('comanda'|'precuenta'|'factura')} tipo
 * @param {object} cuenta  datos normalizados (ver builders)
 * @param {object} [opts]  { storeCode, modo }  (override de impresora)
 */
/** CORTE de caja X/Z (turno). */
export function buildCorte(c, cols = 48) {
  const t = new Ticket(cols);
  t.align('center').bold(true).size(2, 2).ln('FREAKIE DOGS').normal();
  if (c.storeName) t.align('center').ln(c.storeName);
  t.align('center').bold(true).ln(`CORTE ${c.tipo === 'Z' ? 'Z (CIERRE)' : 'X (LECTURA)'}`).bold(false);
  t.ln(`Cajero: ${c.cajero || '-'}`);
  if (c.abierto_at) t.ln(`Apertura: ${horaSV(c.abierto_at)}`);
  t.ln(`Impreso: ${horaSV()}`);
  t.align('left').hr();
  t.row('Fondo apertura', money(c.fondo));
  t.hr().bold(true).ln('VENTAS POR METODO').bold(false);
  t.row('Efectivo', money(c.efectivo));
  t.row('Tarjeta', money(c.tarjeta));
  if (c.transferencia) t.row('Transferencia', money(c.transferencia));
  if (c.link_pago) t.row('Link de pago', money(c.link_pago));
  if (c.otros) t.row('Otros/Mixto', money(c.otros));
  t.bold(true).size(1, 2).row('TOTAL', money(c.total)).normal();
  t.row('Propinas', money(c.propinas));
  t.row('Cuentas', String(c.n_cuentas || 0));
  t.row('Cancelaciones', String(c.n_cancelaciones || 0));
  t.row('Ticket prom.', money(c.ticket_promedio));
  t.hr();
  if (c.tipo === 'Z') {
    if (c.totalEgresos) t.row('(-) Egresos', money(c.totalEgresos));
    if (c.totalIngresos) t.row('(+) Ingresos', money(c.totalIngresos));
  }
  t.row('Efectivo a depositar (calc)', money(c.efectivoEsperado));
  if (c.tipo === 'Z') {
    t.row('Efectivo real depositado', money(c.depositar));
    t.bold(true).row('Diferencia', money(c.difEfectivo)).bold(false);
    if (c.obs) { t.hr().wrap('Obs: ' + c.obs); }
  }
  t.feed(1).align('center').ln(c.tipo === 'Z' ? '=== CIERRE DE TURNO ===' : '--- corte de lectura ---').feed(1);
  t.cut();
  return t;
}

function corteHTML(c) {
  const L = [
    { center: 1, big: 1, bold: 1, text: 'FREAKIE DOGS' },
    ...(c.storeName ? [{ center: 1, text: c.storeName }] : []),
    { center: 1, bold: 1, text: `CORTE ${c.tipo === 'Z' ? 'Z (CIERRE)' : 'X (LECTURA)'}` },
    { text: `Cajero: ${c.cajero || '-'}` },
    { hr: 1 },
    { row: 1, left: 'Fondo', right: money(c.fondo) },
    { row: 1, left: 'Efectivo', right: money(c.efectivo) },
    { row: 1, left: 'Tarjeta', right: money(c.tarjeta) },
    { row: 1, left: 'Transferencia', right: money(c.transferencia) },
    { row: 1, bold: 1, left: 'TOTAL', right: money(c.total) },
    { row: 1, left: 'Propinas', right: money(c.propinas) },
    { row: 1, left: 'Efectivo esperado', right: money(c.efectivoEsperado) },
  ];
  if (c.tipo === 'Z') {
    L.push({ row: 1, left: 'Contado', right: money(c.efectivoContado) }, { row: 1, bold: 1, left: 'Diferencia', right: money(c.difEfectivo) }, { row: 1, left: 'A depositar', right: money(c.depositar) });
  }
  return htmlDoc(`Corte ${c.tipo}`, L);
}

// Auditoría de impresión (fire-and-forget). Deja traza de TODA impresión, aunque
// la venta no exista en BD — así una comanda impresa sin orden guardada queda
// visible (cuenta_id null). Nunca debe romper ni frenar la impresión.
function logImpresion(tipo, cuenta, opts, res) {
  try {
    const storeCode = opts.storeCode || cuenta?.storeCode || null;
    const caja = opts.caja ?? cuenta?.caja ?? null;
    const cuentaId = opts.cuentaId ?? cuenta?.cuentaId ?? cuenta?.cuenta_id ?? null;
    const items = Array.isArray(cuenta?.items) ? cuenta.items : [];
    db.from('pos_impresion_log').insert({
      store_code: storeCode,
      caja,
      tipo,
      cuenta_id: cuentaId,
      resumen: {
        n_items: items.length,
        total: cuenta?.total ?? null,
        mesa: cuenta?.mesa ?? null,
        comanda: cuenta?.comandaNumero ?? null,
        cajero: cuenta?.cajero ?? null,
      },
      ok: res?.ok ?? null,
      modo: res?.modo ?? null,
      error: res?.error ?? null,
    }).then(({ error }) => { if (error) console.warn('[print] log falló', error.message); });
  } catch (e) { console.warn('[print] log excepción', e); }
}

export async function imprimir(tipo, cuenta, opts = {}) {
  const res = await _imprimir(tipo, cuenta, opts);
  logImpresion(tipo, cuenta, opts, res);   // no await: no frena la impresión
  return res;
}

async function _imprimir(tipo, cuenta, opts = {}) {
  const storeCode = opts.storeCode || cuenta.storeCode;
  // Preferir la impresora YA cacheada (lectura sincrona). Un await de red aqui
  // descarta la user-activation en Android y Chrome bloquea el deep-link rawbt:
  // en silencio (sintoma: el boton "no hace nada"). Solo se consulta si no esta precargada.
  const caja = opts.caja ?? cuenta.caja ?? null;
  let imp = opts.impresora || null;
  if (!imp && storeCode) {
    const _k = _ckey(storeCode, caja);
    const rows = _cache.has(_k) ? _cache.get(_k) : await getImpresoras(storeCode, caja);
    imp = pickImpresora(rows, tipo);
  }
  const cols = imp?.ancho_cols || 48;
  const modo = opts.modo || imp?.modo || 'rawbt';

  const builders = {
    comanda: () => buildComanda(cuenta, cols),
    precuenta: () => buildPreCuenta(cuenta, cols),
    factura: () => buildFactura(cuenta, cols),
    corte: () => buildCorte(cuenta, cols),
  };
  const htmlers = { comanda: comandaHTML, precuenta: preCuentaHTML, factura: facturaHTML, corte: corteHTML };

  // App nativa propia (Freakie POS APK): TIENE PRIORIDAD si esta presente.
  // WebView + window.AndroidPrinter.printRaw(ip,puerto,base64) => socket TCP a la impresora.
  // Corre en cualquier tablet, incl. Amazon Fire, SIN RawBT ni Google Play.
  const _nativo = (() => {
    try { return (window.AndroidPrinter && window.AndroidPrinter.isNativePrinter()) ? window.AndroidPrinter : null; }
    catch (e) { return null; }
  })();
  if (_nativo) {
    // Sin impresora resuelta: NO imprimir a una IP al azar (antes caía a 192.168.1.130 = Venecia).
    if (!imp || !imp.ip_address) {
      console.error('[print] app nativa: no se encontró impresora', { storeCode, caja, tipo });
      return { ok: false, modo: 'app', error: 'No se encontró impresora para esta caja' };
    }
    try {
      const b64 = builders[tipo]().base64();
      // Esperar el resultado REAL del socket (MainActivity llama window.__printResult(ok, err)).
      const res = await new Promise((resolve) => {
        let done = false;
        const fin = (ok, err) => { if (done) return; done = true; try { window.__printResult = null; } catch (_) {} resolve({ ok, err }); };
        try { window.__printResult = (ok, err) => fin(!!ok, err); } catch (_) {}
        try { _nativo.printRaw(imp.ip_address, imp.puerto || 9100, b64); }
        catch (e) { fin(false, e && e.message); }
        setTimeout(() => fin(false, 'la impresora no respondió (timeout)'), 6000);
      });
      if (res.ok) return { ok: true, modo: 'app' };
      return { ok: false, modo: 'app', error: res.err || 'la impresora no respondió' };
    } catch (e) { console.error('[print] app nativa fallo', e); return { ok: false, modo: 'app', error: e && e.message }; }
  }

  if (modo === 'sistema') { sendSistema(htmlers[tipo](cuenta)); return { ok: true, modo: 'sistema' }; }

  const ticket = builders[tipo]();

  // modo 'bridge': el puente local es la ÚNICA vía real de impresión en esa PC
  // (impresora de red SIN driver en Windows). Si el puente no responde, NO tiene
  // sentido caer al diálogo de Windows (solo ofrece "Guardar como PDF"): mejor
  // reportar el fallo para que el POS avise en pantalla "no se imprimió".
  if (modo === 'bridge') {
    try {
      await sendBridge(ticket, imp);
      return { ok: true, modo: 'bridge' };
    } catch (e) {
      console.error('[print] bridge no respondió (¿puente caído?)', e);
      return { ok: false, modo: 'bridge', error: e.message };
    }
  }

  // modo 'rawbt': si algo falla, cae a 'sistema' (comportamiento establecido en tablets).
  try {
    sendRawBT(ticket);
    return { ok: true, modo: 'rawbt' };
  } catch (e) {
    console.error('[print] rawbt falló, fallback a sistema', e);
    sendSistema(htmlers[tipo](cuenta));
    return { ok: true, modo: 'sistema', fallback: true, error: e.message };
  }
}

export const printComanda = (cuenta, opts) => imprimir('comanda', cuenta, opts);
export const printPreCuenta = (cuenta, opts) => imprimir('precuenta', cuenta, opts);
export const printFactura = (cuenta, opts) => imprimir('factura', cuenta, opts);
export const printCorte = (tipo, cuenta, opts) => imprimir('corte', cuenta, opts);

export default { imprimir, printComanda, printPreCuenta, printFactura, printCorte, getImpresora, clearImpresoraCache, EMISOR };
