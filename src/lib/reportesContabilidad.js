// ============================================================================
// reportesContabilidad.js — Reportes fiscales para el contador (Ángel)
// ----------------------------------------------------------------------------
// Libro de Ventas / Libro de Compras / Anexos DGII (El Salvador) + Excel + F-14.
//
// Base: motor de Eatalia (reportesHacienda.js), adaptado al esquema de Freakie:
//   • Ventas  → tabla `pos_cuentas` (estado 'cobrada', DTE emitido). Filtrable
//               por `store_code` (Metrocentro = S006) o consolidado.
//   • Compras → tabla `compras_dte` (invalidado=false). `json_original` es el
//               DTE completo de Hacienda; de `resumen` salen gravado/exento/IVA.
//               Las compras NO están etiquetadas por sucursal → SIEMPRE
//               consolidado a nivel empresa (así se declara a Hacienda).
//
// ⚠️  SCAFFOLD. El layout exacto de los Anexos DGII (clasificación de renta,
//     tipo de operación, IVA-incluido vs. neto en Consumidor Final, etc.) queda
//     PENDIENTE DE CONFIRMAR con Ángel. Los campos dudosos van marcados abajo.
// ============================================================================

import { db } from '../supabase'
import { STORES } from '../config'

// ── Identidad fiscal del emisor (fuente de verdad: src/pos/print/printService.js EMISOR) ──
export const EMISOR = {
  razon: 'FREAKIE DOGS, S.A. de C.V.',
  nit: '06140512231010',       // 14 díg, sin guiones (para anexos DGII)
  nitFmt: '0614-051223-101-0',  // formato legible
  nrc: '3368168',
}

export const IVA_RATE = 0.13

// ── Utilidades numéricas ──
export const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
export const money = (v) => r2(v).toFixed(2)
const num = (v) => Number(v) || 0

// ── Zona horaria El Salvador (UTC-6 fijo, sin DST) ──
const TZ_MS = -6 * 3600 * 1000
// Fecha calendario SV (YYYY-MM-DD) de un timestamptz
export const svDate = (ts) => {
  if (!ts) return ''
  return new Date(new Date(ts).getTime() + TZ_MS).toISOString().slice(0, 10)
}

// Rango de un mes 'YYYY-MM' → límites para filtrar (con offset -06:00)
export function mesRango(mes) {
  const [y, m] = mes.split('-').map(Number)
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const pad = (n) => String(n).padStart(2, '0')
  const desde = `${mes}-01`
  const nextMes = `${nextY}-${pad(nextM)}`
  const lastDay = new Date(Date.UTC(nextY, nextM - 1, 0)).getUTCDate() // día 0 del mes siguiente = último del actual
  const hasta = `${mes}-${pad(lastDay)}`
  return {
    desde,                                   // 'YYYY-MM-01'
    hasta,                                   // 'YYYY-MM-DD' último día
    desdeTs: `${desde}T00:00:00-06:00`,      // límite inferior timestamptz
    hastaTs: `${nextMes}-01T00:00:00-06:00`, // límite superior (exclusivo)
  }
}

// ── Códigos de tipo de DTE (Hacienda El Salvador) ──
export const TIPO_DTE = {
  '01': 'Factura (Consumidor Final)',
  '03': 'Comprobante de Crédito Fiscal',
  '04': 'Nota de Remisión',
  '05': 'Nota de Crédito',
  '06': 'Nota de Débito',
  '07': 'Comprobante de Retención',
  '08': 'Comprobante de Liquidación',
  '11': 'Factura de Exportación',
  '14': 'Factura Sujeto Excluido',
}
const tipoCorto = (c) => ({
  '01': '01 Factura', '03': '03 CCF', '05': '05 NC', '06': '06 ND',
  '07': '07 Retención', '11': '11 Export', '14': '14 Suj.Excl',
}[c] || `${c || '??'}`)

// ============================================================================
// CARGA DE DATOS (paginada — PostgREST tope 1000 por página)
// ============================================================================
const PAGE = 1000

async function fetchPaged(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

// Ventas emitidas (DTE) desde pos_cuentas. storeCode=null → todas (consolidado).
export async function cargarVentas({ mes, storeCode = null }) {
  const { desdeTs, hastaTs } = mesRango(mes)
  const rows = await fetchPaged(() => {
    let q = db.from('pos_cuentas')
      .select('id, store_code, dte_tipo, dte_numero_control, dte_uuid, dte_sello, subtotal, descuento, iva, propina, total, cobrada_at, cliente_nombre, nc_codigo_generacion, nc_emitida_at')
      .not('dte_numero_control', 'is', null)
      .eq('estado', 'cobrada')
      .gte('cobrada_at', desdeTs)
      .lt('cobrada_at', hastaTs)
      .order('cobrada_at', { ascending: true })
    if (storeCode) q = q.eq('store_code', storeCode)
    return q
  })
  return rows.map((r) => {
    const propina = num(r.propina)
    // Consumidor Final: precio IVA-incluido; el ticket no separa IVA (iva=0).
    // ⚠️ Base gravada del ticket (IVA incluido) = total − propina.
    const brutoConIva = r2(num(r.total) - propina)
    const ivaCol = num(r.iva)
    const gravadaConIva = ivaCol > 0 ? r2(num(r.subtotal) + ivaCol) : brutoConIva
    const neto = r2(gravadaConIva / (1 + IVA_RATE))
    const ivaContenido = r2(gravadaConIva - neto)
    return {
      ...r,
      fecha: svDate(r.cobrada_at),
      tipo: r.dte_tipo,
      propina,
      brutoConIva,      // total cobrado por bienes (IVA incl.)
      gravadaConIva,    // ventas gravadas IVA-incluido
      neto,             // base imponible neta
      ivaContenido,     // débito fiscal contenido
    }
  })
}

// Compras con DTE (crédito fiscal / gasto). Consolidado empresa.
export async function cargarCompras({ mes }) {
  const { desde, hasta } = mesRango(mes)
  const rows = await fetchPaged(() =>
    db.from('compras_dte')
      .select('id, tipo_dte, numero_control, codigo_generacion, proveedor_nombre, proveedor_nit, fecha_emision, subtotal, iva, monto_total, json_original')
      .eq('invalidado', false)
      .gte('fecha_emision', desde)
      .lte('fecha_emision', hasta)
      .order('fecha_emision', { ascending: true })
  )
  return rows.map((r) => {
    const res = r.json_original?.resumen || {}
    const tributos = Array.isArray(res.tributos) ? res.tributos : []
    const ivaTrib = tributos.filter((t) => t?.codigo === '20').reduce((a, t) => a + num(t.valor), 0)
    const iva = r2(ivaTrib || num(r.iva))
    const gravada = r2(num(res.totalGravada) || (num(r.subtotal)))
    const exenta = r2(num(res.totalExenta))
    const noSuj = r2(num(res.totalNoSuj))
    const total = r2(num(res.totalPagar) || num(r.monto_total))
    return {
      ...r,
      fecha: r.fecha_emision,
      tipo: r.tipo_dte,
      gravada,
      exenta,
      noSuj,
      iva,
      total,
      ivaRete1: r2(num(res.ivaRete1)),     // retención 1% IVA (casilla 162)
      reteRenta: r2(num(res.reteRenta)),   // retención renta
    }
  })
}

// ============================================================================
// GENERADORES CSV
// ============================================================================
function toCSV(rows, sep = ';', eol = '\n') {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '')
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(sep)).join(eol)
}

const encHeader = (titulo, mes, sucLabel) => [
  [titulo],
  [`${EMISOR.razon}  ·  NIT: ${EMISOR.nitFmt}  ·  NRC: ${EMISOR.nrc}`],
  [`Período: ${mes}${sucLabel ? `  ·  Sucursal: ${sucLabel}` : '  ·  Consolidado'}`],
  [],
]

// ── LIBRO DE VENTAS (legible) ──
// Facturas (01) consolidadas por día; CCF (03) detalladas.
export function libroVentasCSV({ ventas, mes, storeCode }) {
  const sucLabel = storeCode ? (STORES[storeCode] || storeCode) : null
  const rows = [
    ...encHeader('LIBRO DE VENTAS', mes, sucLabel),
    ['Fecha', 'Tipo', 'Documento', 'Cliente/NIT', 'Ventas gravadas (IVA incl.)', 'Base neta', 'Débito fiscal (IVA)', 'Total'],
  ]
  const fac = ventas.filter((v) => v.tipo === '01')
  const ccf = ventas.filter((v) => v.tipo === '03')

  // Facturas: agrupar por día
  const porDia = {}
  for (const v of fac) {
    const d = (porDia[v.fecha] ||= { n: 0, gravada: 0, neto: 0, iva: 0, total: 0 })
    d.n++; d.gravada += v.gravadaConIva; d.neto += v.neto; d.iva += v.ivaContenido; d.total += v.brutoConIva
  }
  for (const f of Object.keys(porDia).sort()) {
    const d = porDia[f]
    rows.push([f, '01 Factura (consol.)', `Resumen ${d.n} fact.`, 'Consumidor Final',
      money(d.gravada), money(d.neto), money(d.iva), money(d.total)])
  }
  // CCF: uno por documento
  for (const v of ccf) {
    rows.push([v.fecha, '03 CCF', v.dte_numero_control || v.dte_uuid || '', v.cliente_nombre || '',
      money(v.gravadaConIva), money(v.neto), money(v.ivaContenido), money(v.brutoConIva)])
  }
  const tot = ventas.reduce((a, v) => {
    a.gravada += v.gravadaConIva; a.neto += v.neto; a.iva += v.ivaContenido; a.total += v.brutoConIva; return a
  }, { gravada: 0, neto: 0, iva: 0, total: 0 })
  rows.push([])
  rows.push(['', '', '', 'TOTALES', money(tot.gravada), money(tot.neto), money(tot.iva), money(tot.total)])
  return { filename: `libro_ventas_freakie_${storeCode || 'consolidado'}_${mes}.csv`, mime: 'text/csv;charset=utf-8', content: '﻿' + toCSV(rows) }
}

// ── LIBRO DE COMPRAS (legible, consolidado) ──
export function libroComprasCSV({ compras, mes }) {
  const rows = [
    ...encHeader('LIBRO DE COMPRAS', mes, null),
    ['Fecha', 'Tipo', 'Documento', 'NIT Proveedor', 'Proveedor', 'Compras gravadas', 'Exentas', 'Crédito fiscal (IVA)', 'Total'],
  ]
  const orden = { '03': 0, '01': 1, '14': 2 }
  const ordenadas = [...compras].sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9) || a.fecha.localeCompare(b.fecha))
  for (const c of ordenadas) {
    rows.push([c.fecha, tipoCorto(c.tipo), c.numero_control || c.codigo_generacion || '',
      c.proveedor_nit || '', c.proveedor_nombre || '',
      money(c.gravada), money(c.exenta), money(c.iva), money(c.total)])
  }
  const tot = compras.reduce((a, c) => {
    a.gravada += c.gravada; a.exenta += c.exenta; a.iva += c.iva; a.total += c.total; return a
  }, { gravada: 0, exenta: 0, iva: 0, total: 0 })
  const credCCF = r2(compras.filter((c) => c.tipo === '03').reduce((a, c) => a + c.iva, 0))
  rows.push([])
  rows.push(['', '', '', '', 'TOTALES', money(tot.gravada), money(tot.exenta), money(tot.iva), money(tot.total)])
  rows.push(['', '', '', '', 'Crédito fiscal (solo CCF)', '', '', money(credCCF), ''])
  return { filename: `libro_compras_freakie_${mes}.csv`, mime: 'text/csv;charset=utf-8', content: '﻿' + toCSV(rows) }
}

// ── F-14 (resumen IVA mensual, calculado en la app) ──
export function f14ResumenCSV({ ventas, compras, mes, storeCode }) {
  const sucLabel = storeCode ? (STORES[storeCode] || storeCode) : 'Consolidado'
  const debito = r2(ventas.reduce((a, v) => a + v.ivaContenido, 0))
  const ventaNeta = r2(ventas.reduce((a, v) => a + v.neto, 0))
  const credito = r2(compras.filter((c) => c.tipo === '03').reduce((a, c) => a + c.iva, 0))
  const compraGravada = r2(compras.reduce((a, c) => a + c.gravada, 0))
  const ncCompras = r2(compras.filter((c) => c.tipo === '05').reduce((a, c) => a + c.iva, 0))
  const ivaMes = r2(debito - credito + ncCompras)
  const rows = [
    ...encHeader('F-14 · RESUMEN IVA MENSUAL (borrador)', mes, sucLabel === 'Consolidado' ? null : sucLabel),
    ['Sección', 'Concepto', 'Monto'],
    ['A. Ventas', 'Ventas netas gravadas', money(ventaNeta)],
    ['A. Ventas', 'Débito fiscal (IVA ventas)', money(debito)],
    ['B. Compras', 'Compras gravadas', money(compraGravada)],
    ['B. Compras', 'Crédito fiscal (IVA compras CCF)', money(credito)],
    ['B. Compras', 'IVA en notas de crédito de compra', money(ncCompras)],
    ['C. Cálculo', 'IVA del mes (débito − crédito + NC)', money(ivaMes)],
    [],
    ['⚠️', 'Borrador calculado en la app. Confirmar remanente y retenciones con Ángel.', ''],
  ]
  return { filename: `F14_resumen_freakie_${storeCode || 'consolidado'}_${mes}.csv`, mime: 'text/csv;charset=utf-8', content: '﻿' + toCSV(rows) }
}

// ============================================================================
// ANEXOS DGII (borrador — layout a confirmar con Ángel)
// CSV sin encabezado, separador ';', CRLF, para carga al portal DGII.
// ============================================================================
const sinGuiones = (s) => String(s || '').replace(/[-\s]/g, '')

// Anexo Consumidor Final (Facturas 01) — 1 fila por día.
export function anexoConsumidorFinalCSV({ ventas, mes, storeCode }) {
  const fac = ventas.filter((v) => v.tipo === '01')
  const porDia = {}
  for (const v of fac) {
    const d = (porDia[v.fecha] ||= { docs: [], gravada: 0 })
    d.docs.push(v); d.gravada += v.gravadaConIva
  }
  const rows = []
  for (const f of Object.keys(porDia).sort()) {
    const d = porDia[f]
    const ctrls = d.docs.map((x) => x.dte_numero_control).filter(Boolean).sort()
    const [dd, mm, yy] = [f.slice(8, 10), f.slice(5, 7), f.slice(0, 4)]
    rows.push([
      `${dd}/${mm}/${yy}`,  // 1 Fecha emisión
      '4',                   // 2 Clase documento (4 = DTE)
      '01',                  // 3 Tipo documento
      sinGuiones(ctrls[ctrls.length - 1] || ''), // 4 Nº control (último del día)
      d.docs[0]?.dte_sello || '',                 // 5 Sello recepción
      sinGuiones(d.docs[0]?.dte_uuid || ''),      // 6 Cód. generación del
      sinGuiones(d.docs[d.docs.length - 1]?.dte_uuid || ''), // 7 Cód. generación al
      ctrls[0] || '', ctrls[ctrls.length - 1] || '', // 8-9 Nº doc del/al
      '',                    // 10 Nº máquina
      '0.00',                // 11 Ventas exentas
      '0.00',                // 12 Internas exentas no sujetas
      '0.00',                // 13 No sujetas
      money(d.gravada),      // 14 ⚠️ Ventas gravadas locales (IVA incluido — CONFIRMAR)
      '0.00', '0.00', '0.00', '0.00', '0.00', // 15-19 export/zonas francas/terceros
      money(d.gravada),      // 20 Total ventas
      '1',                   // 21 Tipo operación (⚠️ confirmar)
      '2',                   // 22 Tipo ingreso (⚠️ confirmar)
      '2',                   // 23 Nº anexo
    ])
  }
  return { filename: `anexo_consumidor_final_${storeCode || 'consolidado'}_${mes}.csv`, mime: 'text/csv;charset=utf-8', content: toCSV(rows, ';', '\r\n') }
}

// Anexo Contribuyentes / CCF (03) — 1 fila por documento.
export function anexoContribuyentesCSV({ ventas, mes, storeCode }) {
  const ccf = ventas.filter((v) => v.tipo === '03')
  const rows = ccf.map((v) => {
    const f = v.fecha
    const [dd, mm, yy] = [f.slice(8, 10), f.slice(5, 7), f.slice(0, 4)]
    return [
      `${dd}/${mm}/${yy}`, '4', '03',
      sinGuiones(v.dte_numero_control || ''),  // Nº control
      v.dte_sello || '',                        // Sello
      sinGuiones(v.dte_uuid || ''), sinGuiones(v.dte_uuid || ''), // CG del/al
      '',                                       // ⚠️ NIT/NRC cliente (no guardado en pos_cuentas — CONFIRMAR)
      v.cliente_nombre || '',
      '0.00', '0.00',                           // exentas / no sujetas
      money(v.neto),                            // ventas gravadas (neto)
      money(v.ivaContenido),                    // débito fiscal
      '0.00', '0.00',                           // ventas/débito terceros
      money(v.brutoConIva),                     // total
      '', '1', '2', '1',                        // DUI / tipo op / tipo ingreso / Nº anexo
    ]
  })
  return { filename: `anexo_ccf_${storeCode || 'consolidado'}_${mes}.csv`, mime: 'text/csv;charset=utf-8', content: toCSV(rows, ';', '\r\n') }
}

// Anexo de Compras (crédito fiscal) — 1 fila por documento.
export function anexoComprasCSV({ compras, mes }) {
  // ⚠️ Clasificación de renta (R/S/T) por defecto — Ángel debe revisar.
  const CLASIF = { R: '1', S: '4', T: '5' }
  const rows = compras
    .filter((c) => ['03', '05', '06'].includes(c.tipo))
    .map((c) => {
      const f = c.fecha
      const [dd, mm, yy] = [f.slice(8, 10), f.slice(5, 7), f.slice(0, 4)]
      return [
        `${dd}/${mm}/${yy}`, '4', c.tipo,
        sinGuiones(c.codigo_generacion || c.numero_control || ''),
        sinGuiones(c.proveedor_nit || ''),
        c.proveedor_nombre || '',
        money(c.exenta), '0.00', '0.00',        // internas exentas / internaciones / importaciones exentas
        money(c.gravada),                        // compras internas gravadas
        '0.00', '0.00', '0.00',                  // internaciones/importaciones gravadas
        money(c.iva),                            // crédito fiscal
        money(c.total),                          // total
        '',                                      // DUI
        '1', CLASIF.R, CLASIF.S, CLASIF.T,       // ⚠️ tipo op / clasif / sector / tipo costo-gasto
        '3',                                     // Nº anexo (compras)
      ]
    })
  return { filename: `anexo_compras_${mes}.csv`, mime: 'text/csv;charset=utf-8', content: toCSV(rows, ';', '\r\n') }
}

// ============================================================================
// EXCEL DE RESPALDO (multi-hoja, SheetJS por CDN)
// ============================================================================
let _xlsxLoaded = false
async function loadXLSX() {
  if (_xlsxLoaded || (typeof window !== 'undefined' && window.XLSX)) { _xlsxLoaded = true; return }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
  _xlsxLoaded = true
}

export async function excelRespaldoBlob({ ventas, compras, mes, storeCode }) {
  await loadXLSX()
  const XLSX = window.XLSX
  const wb = XLSX.utils.book_new()
  const add = (nombre, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), nombre)
  const sucLabel = storeCode ? (STORES[storeCode] || storeCode) : 'Consolidado'

  // RESUMEN
  const debito = r2(ventas.reduce((a, v) => a + v.ivaContenido, 0))
  const credito = r2(compras.filter((c) => c.tipo === '03').reduce((a, c) => a + c.iva, 0))
  add('RESUMEN', [
    [EMISOR.razon], [`NIT ${EMISOR.nitFmt} · NRC ${EMISOR.nrc}`], [`Período ${mes} · ${sucLabel}`], [],
    ['Ventas (docs)', ventas.length],
    ['Ventas gravadas (IVA incl.)', r2(ventas.reduce((a, v) => a + v.gravadaConIva, 0))],
    ['Débito fiscal (IVA ventas)', debito],
    ['Compras (docs)', compras.length],
    ['Crédito fiscal (IVA compras CCF)', credito],
    ['IVA del mes (débito − crédito)', r2(debito - credito)],
  ])

  // LIBROS — resumen diario estilo libro IVA (solo Facturas por día + CCF)
  const librosRows = [['Día', 'Docs', 'Ctrl del', 'Ctrl al', 'Sello (1º)', 'Ventas gravadas', 'Débito fiscal', 'Total']]
  const porDia = {}
  for (const v of ventas.filter((x) => x.tipo === '01')) {
    const d = (porDia[v.fecha] ||= { docs: [], gravada: 0, iva: 0, total: 0 })
    d.docs.push(v); d.gravada += v.gravadaConIva; d.iva += v.ivaContenido; d.total += v.brutoConIva
  }
  for (const f of Object.keys(porDia).sort()) {
    const d = porDia[f]
    const ctrls = d.docs.map((x) => x.dte_numero_control).filter(Boolean).sort()
    librosRows.push([f, d.docs.length, ctrls[0] || '', ctrls[ctrls.length - 1] || '', d.docs[0]?.dte_sello || '', r2(d.gravada), r2(d.iva), r2(d.total)])
  }
  add('LIBROS', librosRows)

  // VENTAS (detalle)
  add('VENTAS', [
    ['Fecha', 'Sucursal', 'Tipo', 'Nº Control', 'Cód. generación', 'Sello', 'Cliente', 'Gravada IVA incl.', 'Neto', 'Débito fiscal', 'Propina', 'Total'],
    ...ventas.map((v) => [v.fecha, v.store_code, tipoCorto(v.tipo), v.dte_numero_control, v.dte_uuid, v.dte_sello, v.cliente_nombre || '', r2(v.gravadaConIva), r2(v.neto), r2(v.ivaContenido), r2(v.propina), r2(v.brutoConIva)]),
  ])

  // COMPRAS (detalle)
  add('COMPRAS', [
    ['Fecha', 'Tipo', 'Nº Control', 'Cód. generación', 'NIT Proveedor', 'Proveedor', 'Gravada', 'Exenta', 'Crédito fiscal', 'Rete 1%', 'Total'],
    ...compras.map((c) => [c.fecha, tipoCorto(c.tipo), c.numero_control, c.codigo_generacion, c.proveedor_nit, c.proveedor_nombre, r2(c.gravada), r2(c.exenta), r2(c.iva), r2(c.ivaRete1), r2(c.total)]),
  ])

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return {
    filename: `respaldo_contabilidad_freakie_${storeCode || 'consolidado'}_${mes}.xlsx`,
    blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  }
}

// ============================================================================
// DESCARGA (browser)
// ============================================================================
export function descargar({ filename, content, blob, mime }) {
  const b = blob || new Blob([content], { type: mime || 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(b)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
