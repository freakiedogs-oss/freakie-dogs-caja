/**
 * dteErpService.js — Emisión de DTE desde el back-office del ERP
 *
 * Por qué existe aparte de `src/pos/cajero/dteService.js`: ese módulo lee el
 * PIN de `sessionStorage.pos_user`, que solo existe cuando alguien entró por el
 * POS. En el ERP no hay sesión de caja, así que el PIN se pide EN EL MOMENTO de
 * emitir y viaja como parámetro. Eso no es una molestia: un documento fiscal
 * que se le manda a Hacienda debería llevar una firma explícita de quién lo
 * emitió, no salir de una sesión abierta hace horas.
 *
 * El proxy `/api/dte-proxy` sigue siendo el único camino: valida el PIN contra
 * `usuarios_erp`, exige un rol de la whitelist y guarda la API key del DTEaaS
 * en su propio env. La llave nunca toca el bundle del browser.
 *
 * Precios de Freakie INCLUYEN IVA. La conversión por tipo de documento es la
 * misma regla que usa el POS y está centralizada acá abajo:
 *   - Factura (01) y Sujeto Excluido (14): el precio va tal cual.
 *   - CCF (03) y Nota de Crédito (05): se manda el neto (precio / 1.13),
 *     porque esos documentos suman el IVA encima.
 */

import { STORE_ESTABLECIMIENTO } from '../../config'

const DTE_PROXY_BASE = '/api/dte-proxy'

/** Tipos que se pueden emitir desde el ERP, con lo que exige cada uno. */
export const TIPOS_EMISION = [
  {
    id: 'factura', codigo: '01', nombre: 'Factura', op: 'emit-factura',
    ayuda: 'Consumidor final. El cliente es opcional: sin cliente sale como Consumidor Final.',
    ivaIncluido: true, requiere: [],
  },
  {
    id: 'ccf', codigo: '03', nombre: 'Crédito Fiscal (CCF)', op: 'emit-ccf',
    ayuda: 'Para contribuyentes. Exige NIT, NRC, nombre y giro del cliente.',
    ivaIncluido: false, requiere: ['numero_documento', 'nrc', 'nombre'],
  },
  {
    id: 'se', codigo: '14', nombre: 'Sujeto Excluido', op: 'emit-sujeto-excluido',
    ayuda: 'Compras a personas que no son contribuyentes. Exige nombre y DUI. No lleva IVA.',
    ivaIncluido: true, requiere: ['numero_documento', 'nombre'],
  },
]

export const tipoPorId = (id) => TIPOS_EMISION.find(t => t.id === id) || TIPOS_EMISION[0]

/** 01=efectivo, 03=tarjeta crédito, 05=transferencia, 99=otros (mismo mapa que el POS). */
export const FORMAS_PAGO = [
  { codigo: '01', nombre: 'Efectivo' },
  { codigo: '02', nombre: 'Tarjeta de débito' },
  { codigo: '03', nombre: 'Tarjeta de crédito' },
  { codigo: '04', nombre: 'Cheque' },
  { codigo: '05', nombre: 'Transferencia' },
  { codigo: '99', nombre: 'Otro' },
]

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100

/**
 * Mismo guardarraíl que el POS: MH rechaza el DTE COMPLETO si el correo del
 * receptor no cumple su formato ASCII (29-ago-2026: una tilde en
 * "facelectrónica@…" tumbó 3 facturas). Devuelve null si no valida.
 */
export function sanitizeCorreo(s) {
  const v = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : null
}

/** Total de la grilla de ítems, en precios con IVA (como se digitan). */
export const totalConIva = (items) =>
  r2((items || []).reduce((s, it) => s + (Number(it.precio) || 0) * (Number(it.cantidad) || 0), 0))

/** Desglose que se le muestra al usuario antes de emitir. */
export function desglose(items, tipoId) {
  const total = totalConIva(items)
  const t = tipoPorId(tipoId)
  if (t.id === 'se') return { gravado: total, iva: 0, total }       // sin IVA
  const gravado = r2(total / 1.13)
  return { gravado, iva: r2(total - gravado), total }
}

/** Qué le falta al cliente para poder emitir este tipo de documento. */
export function faltantesDeCliente(cliente, tipoId) {
  const t = tipoPorId(tipoId)
  if (!t.requiere.length) return []
  const etiquetas = { numero_documento: t.id === 'se' ? 'DUI' : 'NIT', nrc: 'NRC', nombre: 'nombre' }
  return t.requiere.filter(c => !String(cliente?.[c] || '').trim()).map(c => etiquetas[c] || c)
}

function itemsParaDte(items, tipo) {
  return (items || []).map(it => ({
    descripcion: String(it.descripcion || '').trim(),
    cantidad: Number(it.cantidad) || 0,
    precioUni: tipo.ivaIncluido ? r2(it.precio) : r2(Number(it.precio) / 1.13),
    codigo: it.codigo || null,
  }))
}

/** Receptor en el formato que espera cada tipo de documento. */
function receptorParaDte(cliente, tipoId) {
  if (!cliente) return null
  const correo = sanitizeCorreo(cliente.email)
  const doc = String(cliente.numero_documento || '').replace(/[-\s]/g, '')
  const dir = {
    departamento: cliente.departamento || '06',
    municipio: cliente.municipio || '14',
    complemento: cliente.direccion || 'San Salvador, El Salvador',
  }

  if (tipoId === 'ccf') {
    return {
      nit: doc,
      nrc: String(cliente.nrc || '').replace(/[-\s]/g, ''),
      nombre: cliente.nombre,
      codActividad: cliente.codigo_actividad || '56101',
      descActividad: cliente.giro || 'Restaurantes',
      ...(cliente.nombre_comercial ? { nombreComercial: cliente.nombre_comercial } : {}),
      direccion: dir,
      telefono: cliente.telefono || '00000000',
      correo: correo || 'sin-correo@freakiedogs.com',
    }
  }
  if (tipoId === 'se') {
    return {
      tipoDocumento: cliente.tipo_documento === 'NIT' ? '36' : '13',
      numDocumento: doc,
      nombre: cliente.nombre,
      codActividad: cliente.codigo_actividad || null,
      descActividad: cliente.giro || null,
      direccion: dir,
      telefono: cliente.telefono || null,
      correo,
    }
  }
  // Factura: todo opcional
  return {
    nombre: cliente.nombre,
    ...(doc ? { numDocumento: doc } : {}),
    ...(cliente.tipo_documento ? { tipoDocumento: cliente.tipo_documento === 'NIT' ? '36' : '13' } : {}),
    ...(correo ? { correo } : {}),
    ...(cliente.telefono ? { telefono: cliente.telefono } : {}),
  }
}

/** POST al proxy con el PIN de quien emite. */
async function callProxy(op, body, pin) {
  if (!String(pin || '').trim()) throw new Error('Falta el PIN de quien emite')
  const res = await fetch(`${DTE_PROXY_BASE}/${op}`, {
    method: 'POST',
    // X-DTE-Origen: erp hace que el proxy exija rol de gerencia
    // (admin/ejecutivo/superadmin) en vez de la whitelist del POS, que incluye
    // cajeros. Sin esto, el corte de roles viviría solo en el front.
    headers: {
      'Content-Type': 'application/json',
      'X-POS-PIN': String(pin).trim(),
      'X-DTE-Origen': 'erp',
    },
    body: JSON.stringify(body),
  })
  let data
  try { data = await res.json() } catch { throw new Error(`Respuesta no-JSON del proxy (${res.status})`) }

  if (!res.ok || data?.success === false) {
    // Los errores del proxy son códigos; traducirlos acá evita que el usuario
    // vea "role_not_allowed" y no sepa qué hacer.
    const mapa = {
      missing_pin: 'Falta el PIN.',
      invalid_pin: 'PIN incorrecto o usuario inactivo.',
      role_not_allowed: 'Tu rol no puede emitir documentos fiscales.',
      upstream_timeout: 'Hacienda no respondió a tiempo. Revisá el listado antes de reintentar: el documento pudo haberse emitido.',
      proxy_misconfigured: 'El proxy de DTE no tiene la API key configurada.',
    }
    throw new Error(mapa[data?.error] || data?.error || data?.message || `Error DTE ${res.status}`)
  }

  // Hacienda puede rechazar con success=true (mismo edge case que cubre
  // NotaCreditoModal en el POS): hay que mirar el estado, no solo el HTTP.
  const estado = String(data?.estado || '').toLowerCase()
  if (estado === 'rechazado') {
    const obs = data?.hacienda_response?.observaciones
    const msg = Array.isArray(obs) ? obs.join(' · ') : (data?.hacienda_response?.descripcionMsg || 'Rechazado por Hacienda')
    const err = new Error(`Hacienda rechazó el documento: ${msg}`)
    err.rechazado = true
    err.data = data
    throw err
  }
  return data
}

/**
 * Emite un DTE nuevo (Factura / CCF / Sujeto Excluido).
 * @returns la respuesta del DTEaaS: { codigo_generacion, numero_control, estado, sello_recepcion, monto_total, ... }
 */
export async function emitirDTE({ tipoId, items, cliente, formaPago, storeCode, pin }) {
  const tipo = tipoPorId(tipoId)
  const faltan = faltantesDeCliente(cliente, tipoId)
  if (faltan.length) throw new Error(`Para ${tipo.nombre} falta del cliente: ${faltan.join(', ')}`)

  const limpios = (items || []).filter(it => String(it.descripcion || '').trim() && Number(it.cantidad) > 0)
  if (!limpios.length) throw new Error('Agregá al menos un ítem con descripción y cantidad')
  if (limpios.some(it => Number(it.precio) <= 0)) throw new Error('Todos los ítems necesitan precio mayor que cero')

  const d = desglose(limpios, tipoId)
  const est = STORE_ESTABLECIMIENTO[storeCode]
  const receptor = receptorParaDte(cliente, tipoId)

  const body = {
    items: itemsParaDte(limpios, tipo),
    condicionOperacion: 1, // contado
    pagos: [{ codigo: formaPago || '01', montoPago: d.total, referencia: null, plazo: null, periodo: null }],
    ...(tipoId === 'ccf' ? { formaPago: formaPago || '01' } : {}),
    ...(est ? { codEstable: est.codEstable, codPuntoVenta: est.codPuntoVenta } : {}),
    ...(receptor ? { receptor } : {}),
  }

  return callProxy(tipo.op, body, pin)
}

/**
 * Nota de Crédito (tipo 05) contra un DTE ya sellado.
 * Solo aplica a CCF: una NC sobre Factura de consumidor final no la acepta MH,
 * y ese caso se resuelve invalidando el documento.
 */
export async function emitirNotaCredito({ dte, items, cliente, pin }) {
  const limpios = (items || []).filter(it => Number(it.cantidad) > 0 && String(it.descripcion || '').trim())
  if (!limpios.length) throw new Error('Seleccioná al menos un ítem para la Nota de Crédito')

  const total = totalConIva(limpios)
  const gravado = r2(total / 1.13)
  const iva = r2(total - gravado)

  const body = {
    items: limpios.map(it => ({
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad),
      precioUni: r2(Number(it.precio) / 1.13),
      codigo: it.codigo || null,
    })),
    documentoRelacionado: [{
      tipoDocumento: dte.tipo_dte || '03',
      tipoGeneracion: 2,
      numeroDocumento: dte.codigo_generacion,
      fechaEmision: dte.fecha_emision,
    }],
    receptor: receptorParaDte(cliente, 'ccf'),
    condicionOperacion: 1,
    pagos: [{ codigo: '01', montoPago: r2(gravado + iva), referencia: null, plazo: null, periodo: null }],
  }

  return callProxy('emit-nota-credito', body, pin)
}

/**
 * Invalida un DTE ante Hacienda. Es irreversible.
 * tipoAnulacion: 1=error en la emisión (no se rehace), 2=rescindir la operación,
 * 3=otro. MH exige un documento de reemplazo cuando es 1, así que el default
 * sigue siendo 2, igual que en el POS.
 */
export async function invalidarDTE({ codigoGeneracion, motivo, tipoAnulacion = 2, pin }) {
  if (!String(motivo || '').trim()) throw new Error('La invalidación necesita un motivo')
  return callProxy('invalidar', {
    codigo_generacion: codigoGeneracion,
    motivo: String(motivo).trim(),
    tipoAnulacion,
  }, pin)
}
