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

// Cache de impresoras por store_code (evita query en cada impresión)
const _cache = new Map();

/** Lee (y cachea) la impresora activa de una sucursal. */
export async function getImpresora(storeCode, { force = false } = {}) {
  if (!force && _cache.has(storeCode)) return _cache.get(storeCode);
  const { data, error } = await db
    .from('pos_impresoras')
    .select('*')
    .eq('store_code', storeCode)
    .eq('activa', true)
    .order('rol', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) { console.error('[print] getImpresora', error); return null; }
  _cache.set(storeCode, data);
  return data;
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
  t.bold(true).size(1, 2).row('TOTAL', money(c.total)).normal();
  if (c.propinaSugerida) {
    t.feed(1).align('center').ln('Propina sugerida:');
    t.ln(`10% ${money(c.total * 0.10)}   15% ${money(c.total * 0.15)}`);
  }
  t.feed(1).align('center').ln('Gracias por su visita').feed(1);
  t.cut();
  return t;
}

/** FACTURA / TICKET de cobro. Incluye DTE + QR DGII si aplica. */
export function buildFactura(c, cols = 48) {
  const t = new Ticket(cols);
  t.align('center').bold(true).size(2, 2).ln('FREAKIE DOGS').normal();
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
  t.feed(1).align('center').ln('Gracias por su compra').ln('¡Vuelva pronto!').feed(1);
  t.cut();
  return t;
}

// ════════════════════════════════════════════════════════════
//  RENDER HTML (fallback window.print / modo 'sistema')
// ════════════════════════════════════════════════════════════

function htmlDoc(title, bodyLines) {
  const rows = bodyLines.map((l) => {
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
  hr{border:none;border-top:1px dashed #000;margin:5px 0}</style></head>
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
    if (it.nota) L.push({ text: `&nbsp;&nbsp;&nbsp;(${it.nota})` });
  }
  L.push({ hr: 1 }, { row: 1, left: 'SUBTOTAL', right: money(c.subtotal) });
  if (c.descuento > 0) L.push({ row: 1, left: 'DESCUENTO', right: `-${money(c.descuento)}` });
  L.push({ row: 1, bold: 1, left: 'TOTAL', right: money(c.total) });
  L.push({ center: 1, text: 'Gracias por su visita' });
  return htmlDoc('Pre-Cuenta', L);
}

function facturaHTML(c) {
  const dte = c.dte;
  const L = [
    { center: 1, big: 1, bold: 1, text: 'FREAKIE DOGS' },
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
  }
  L.push({ hr: 1 }, { row: 1, left: 'SUBTOTAL', right: money(c.subtotal) });
  if (c.descuento > 0) L.push({ row: 1, left: 'DESCUENTO', right: `-${money(c.descuento)}` });
  L.push({ row: 1, bold: 1, left: 'TOTAL', right: money(c.total) });
  if (c.propina > 0) L.push({ row: 1, left: 'Propina', right: money(c.propina) });
  if (dte?.codigoGeneracion) {
    L.push({ center: 1, text: `DGII: ${DGII_CONSULTA}?codGen=${dte.codigoGeneracion}` });
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

/** Imprime por window.print() con HTML. */
function sendSistema(html) {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) { alert('Permite ventanas emergentes para imprimir.'); return; }
  w.document.write(html);
  w.document.close();
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

export async function imprimir(tipo, cuenta, opts = {}) {
  const storeCode = opts.storeCode || cuenta.storeCode;
  const imp = opts.impresora || (storeCode ? await getImpresora(storeCode) : null);
  const cols = imp?.ancho_cols || 48;
  const modo = opts.modo || imp?.modo || 'rawbt';

  const builders = {
    comanda: () => buildComanda(cuenta, cols),
    precuenta: () => buildPreCuenta(cuenta, cols),
    factura: () => buildFactura(cuenta, cols),
    corte: () => buildCorte(cuenta, cols),
  };
  const htmlers = { comanda: comandaHTML, precuenta: preCuentaHTML, factura: facturaHTML, corte: corteHTML };

  if (modo === 'sistema') { sendSistema(htmlers[tipo](cuenta)); return { modo }; }

  const ticket = builders[tipo]();
  try {
    if (modo === 'bridge') { await sendBridge(ticket, imp); return { modo }; }
    sendRawBT(ticket); // 'rawbt'
    return { modo };
  } catch (e) {
    console.error('[print] fallo, fallback a sistema', e);
    sendSistema(htmlers[tipo](cuenta));
    return { modo: 'sistema', fallback: true, error: e.message };
  }
}

export const printComanda = (cuenta, opts) => imprimir('comanda', cuenta, opts);
export const printPreCuenta = (cuenta, opts) => imprimir('precuenta', cuenta, opts);
export const printFactura = (cuenta, opts) => imprimir('factura', cuenta, opts);
export const printCorte = (tipo, cuenta, opts) => imprimir('corte', cuenta, opts);

export default { imprimir, printComanda, printPreCuenta, printFactura, printCorte, getImpresora, clearImpresoraCache, EMISOR };
