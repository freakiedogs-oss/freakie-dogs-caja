/**
 * dteService.js — Cliente DTEaaS para el POS
 *
 * Llama a la Edge Function dte-service para emitir Factura (01) o CCF (03).
 * Precios Freakie Dogs INCLUYEN IVA:
 *   - Factura: se envían tal cual (IVA embebido)
 *   - CCF: se extraen netos (precio / 1.13) porque CCF suma IVA encima
 */

const DTE_BASE = 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/dte-service'
const DTE_API_KEY = 'dk_live_6230574b3a01728fce1799ca8c7c5da904b39d9c29d37cfa'

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
      precioUnitario: precio,
      codigo: it.id || null,
    }
  })
}

/**
 * Emitir Factura Consumidor Final (tipo 01)
 * Receptor es opcional para Factura.
 */
export async function emitFactura({ items, receptor, metodo }) {
  const body = {
    items: buildDteItems(items, 'factura'),
    formaPago: mapFormaPago(metodo),
    condicionOperacion: 1, // contado
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

  const res = await fetch(`${DTE_BASE}/emit-factura`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': DTE_API_KEY,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || `DTE error ${res.status}`)
  }
  return data
}

/**
 * Emitir Comprobante de Crédito Fiscal (tipo 03)
 * Receptor OBLIGATORIO: nit, nrc, nombre, codActividad, descActividad, dirección
 */
export async function emitCCF({ items, receptor, metodo }) {
  if (!receptor?.nit || !receptor?.nrc || !receptor?.nombre) {
    throw new Error('CCF requiere datos del cliente: NIT, NRC y nombre')
  }

  const body = {
    items: buildDteItems(items, 'ccf'),
    formaPago: mapFormaPago(metodo),
    condicionOperacion: 1,
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

  const res = await fetch(`${DTE_BASE}/emit-ccf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': DTE_API_KEY,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || `DTE error ${res.status}`)
  }
  return data
}

/**
 * Emitir DTE según tipo
 * @returns {Object} { success, document_id, codigo_generacion, numero_control, estado, sello_recepcion, monto_total, monto_iva }
 */
export async function emitDTE({ tipoDte, items, receptor, metodo }) {
  if (tipoDte === 'factura') return emitFactura({ items, receptor, metodo })
  if (tipoDte === 'ccf')     return emitCCF({ items, receptor, metodo })
  // 'ticket' = sin DTE fiscal
  return null
}
