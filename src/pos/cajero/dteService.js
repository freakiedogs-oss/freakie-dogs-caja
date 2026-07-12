/**
 * dteService.js — Cliente DTEaaS para el POS
 *
 * Llama al PROXY serverless /api/dte-proxy (Vercel Edge Function) que reenvía
 * al servicio DTE con la API key real desde process.env. Esto evita exponer
 * DTE_API_KEY en el bundle del browser (P0 audit 24-may-2026).
 *
 * Auth: enviamos el PIN del usuario activo en el header X-POS-PIN. El proxy
 * lo valida contra usuarios_erp y rechaza si el rol no está en la whitelist
 * (cajero/cajera/gerente/admin/ejecutivo/superadmin).
 *
 * Precios Freakie Dogs INCLUYEN IVA:
 *   - Factura: se envían tal cual (IVA embebido)
 *   - CCF: se extraen netos (precio / 1.13) porque CCF suma IVA encima
 */

import { STORE_ESTABLECIMIENTO } from '../../config'

const DTE_PROXY_BASE = '/api/dte-proxy'

/**
 * Lee el PIN del usuario activo desde sessionStorage (set por POSLogin).
 * Si no está, devuelve cadena vacía — el proxy responderá 401 y la UI
 * mostrará el error.
 */
function getPosPin() {
  try {
    if (typeof window === 'undefined') return ''
    const raw = sessionStorage.getItem('pos_user') || localStorage.getItem('pos_user')
    if (!raw) return ''
    const u = JSON.parse(raw)
    return String(u?.pin || '')
  } catch {
    return ''
  }
}

/**
 * Wrapper genérico: POST al proxy con el header de auth.
 */
async function callProxy(op, body) {
  const pin = getPosPin()
  const res = await fetch(`${DTE_PROXY_BASE}/${op}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-POS-PIN': pin,
    },
    body: JSON.stringify(body),
  })

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`DTE proxy: respuesta no-JSON (${res.status})`)
  }
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || data?.message || `DTE error ${res.status}`)
  }
  return data
}

/**
 * Mapea método de pago POS → código MH
 * 01=Billetes y monedas, 02=Tarjeta débito, 03=Tarjeta crédito,
 * 04=Cheque, 05=Transferencia, 99=Otros
 */
function mapFormaPago(metodo) {
  if (metodo === 'efectivo') return '01'
  if (metodo === 'tarjeta')  return '03'
  if (metodo === 'mixto')    return '99'  // MH no tiene "mixto", usamos otros
  return '01'
}

/**
 * Construye array de items para el DTE
 * @param {Array} items - items del POS [{nombre, precio, qty}]
 * @param {string} tipoDte - 'factura' o 'ccf'
 */
function buildDteItems(items, tipoDte) {
  return items.map(it => {
    // Factura: precio CON IVA (tal cual). CCF: precio SIN IVA (extraer)
    const precio = tipoDte === 'ccf'
      ? Math.round((it.precio / 1.13) * 100) / 100
      : it.precio

    return {
      descripcion: it.nombre,
      cantidad: it.qty,
      precioUni: precio,
      codigo: it.id || null,
    }
  })
}

/**
 * Emitir Factura Consumidor Final (tipo 01)
 * Receptor es opcional para Factura.
 */
export async function emitFactura({ items, receptor, metodo, storeCode, propina }) {
  const propinaNG = Math.round((Number(propina) || 0) * 100) / 100 // no gravada (no IVA — Art. 49 Ley IVA SV)
  const totalPagar = items.reduce((s, it) => s + (it.precio * it.qty), 0)
  const _est = STORE_ESTABLECIMIENTO[storeCode]
  const body = {
    items: buildDteItems(items, 'factura'),
    condicionOperacion: 1, // contado
    ...(propinaNG > 0 ? { propina: propinaNG } : {}),
    pagos: [{ codigo: mapFormaPago(metodo), montoPago: Math.round((totalPagar + propinaNG) * 100) / 100, referencia: null, plazo: null, periodo: null }],
    ...(_est ? { codEstable: _est.codEstable, codPuntoVenta: _est.codPuntoVenta } : {}),
  }

  // Receptor opcional para factura
  if (receptor && receptor.nombre) {
    body.receptor = {
      nombre: receptor.nombre,
      ...(receptor.numDocumento && { numDocumento: receptor.numDocumento }),
      ...(receptor.tipoDocumento && { tipoDocumento: receptor.tipoDocumento }),
      ...(receptor.correo && { correo: receptor.correo }),
      ...(receptor.telefono && { telefono: receptor.telefono }),
    }
  }

  return callProxy('emit-factura', body)
}

/**
 * Emitir Comprobante de Crédito Fiscal (tipo 03)
 * Receptor OBLIGATORIO: nit, nrc, nombre, codActividad, descActividad, dirección
 */
export async function emitCCF({ items, receptor, metodo, propina }) {
  if (!receptor?.nit || !receptor?.nrc || !receptor?.nombre) {
    throw new Error('CCF requiere datos del cliente: NIT, NRC y nombre')
  }
  const propinaNG = Math.round((Number(propina) || 0) * 100) / 100 // no gravada (no IVA — Art. 49 Ley IVA SV)

  const body = {
    items: buildDteItems(items, 'ccf'),
    formaPago: mapFormaPago(metodo),
    condicionOperacion: 1,
    ...(propinaNG > 0 ? { propina: propinaNG } : {}),
    receptor: {
      nit: receptor.nit.replace(/[-\s]/g, ''),
      nrc: receptor.nrc.replace(/[-\s]/g, ''),
      nombre: receptor.nombre,
      codActividad: receptor.codActividad || '56101',
      descActividad: receptor.descActividad || 'Restaurantes',
      ...(receptor.nombreComercial && { nombreComercial: receptor.nombreComercial }),
      direccion: receptor.direccion || {
        departamento: '06',
        municipio: '01',
        complemento: receptor.direccionTexto || 'San Salvador, El Salvador',
      },
      telefono: receptor.telefono || '00000000',
      correo: receptor.correo || 'sin-correo@freakiedogs.com',
    },
  }

  // Calcular total para pagos
  const totalCCF = items.reduce((s, it) => s + (it.precio / 1.13 * it.qty), 0)
  const ivaCCF = Math.round(totalCCF * 0.13 * 100) / 100
  const totalPagarCCF = Math.round((totalCCF + ivaCCF) * 100) / 100
  body.pagos = [{ codigo: mapFormaPago(metodo), montoPago: Math.round((totalPagarCCF + propinaNG) * 100) / 100, referencia: null, plazo: null, periodo: null }]

  return callProxy('emit-ccf', body)
}

/**
 * Emitir Factura de Sujeto Excluido (tipo 14)
 * Para compras a personas no contribuyentes.
 * Receptor OBLIGATORIO: nombre, numDocumento (DUI)
 * Sin IVA — precios se envían tal cual como totalCompras
 */
export async function emitSujetoExcluido({ items, receptor, metodo }) {
  if (!receptor?.nombre || !receptor?.numDocumento) {
    throw new Error('Sujeto Excluido requiere nombre y DUI del proveedor')
  }

  const totalCompras = items.reduce((s, it) => s + (it.precio * it.qty), 0)
  const body = {
    items: items.map(it => ({
      descripcion: it.nombre,
      cantidad: it.qty,
      precioUni: it.precio,
      codigo: it.id || null,
    })),
    condicionOperacion: 1,
    pagos: [{ codigo: mapFormaPago(metodo), montoPago: Math.round(totalCompras * 100) / 100, referencia: null, plazo: null, periodo: null }],
    receptor: {
      tipoDocumento: receptor.tipoDocumento || '13', // 13=DUI, 36=NIT
      numDocumento: receptor.numDocumento.replace(/[-\s]/g, ''),
      nombre: receptor.nombre,
      codActividad: receptor.codActividad || null,
      descActividad: receptor.descActividad || null,
      direccion: receptor.direccion || null,
      telefono: receptor.telefono || null,
      correo: receptor.correo || null,
    },
  }

  return callProxy('emit-sujeto-excluido', body)
}

/**
 * Emitir DTE según tipo
 * @returns {Object} { success, document_id, codigo_generacion, numero_control, estado, sello_recepcion, monto_total, monto_iva }
 */
export async function emitDTE({ tipoDte, items, receptor, metodo, storeCode, propina }) {
  if (tipoDte === 'factura') return emitFactura({ items, receptor, metodo, storeCode, propina })
  if (tipoDte === 'ccf')     return emitCCF({ items, receptor, metodo, propina })
  if (tipoDte === 'se')      return emitSujetoExcluido({ items, receptor, metodo })
  // 'ticket' = sin DTE fiscal
  return null
}

/**
 * Anular (invalidar) un DTE emitido previamente
 * @param {Object} params
 * @param {string} params.codigoGeneracion - UUID del DTE a anular
 * @param {string} params.motivo - Razón de la anulación
 * @param {number} [params.tipoAnulacion=2] - 1=Error emisión, 2=Rescindir operación
 * @returns {Object} { success, codigo_generacion, estado, selloRecibido, hacienda_response }
 */
export async function anularDTE({ codigoGeneracion, motivo, tipoAnulacion = 2 }) {
  return callProxy('invalidar', {
    codigo_generacion: codigoGeneracion,
    motivo,
    tipoAnulacion,
  })
}
