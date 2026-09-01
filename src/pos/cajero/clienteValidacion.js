/**
 * clienteValidacion.js — Reglas de los datos de cliente que viajan a Hacienda.
 *
 * Vive aparte porque lo usan DOS pantallas (CustomerSearch, en el cobro, y
 * ClientesView, el banco de clientes del POS): si cada una tuviera su copia,
 * el día que se corrija una regla la otra seguiría mandando basura a MH.
 *
 * DUI = 9 díg · NIT = 14 díg (o 9 si es DUI) · NRC = 1–8 díg.
 */

// Departamentos El Salvador (código MH)
export const DEPTOS = [
  ['06', 'San Salvador'], ['05', 'La Libertad'], ['02', 'Santa Ana'], ['10', 'Sonsonate'],
  ['03', 'Ahuachapán'], ['04', 'Chalatenango'], ['07', 'La Paz'], ['08', 'Cabañas'],
  ['09', 'San Vicente'], ['11', 'Usulután'], ['12', 'San Miguel'], ['13', 'Morazán'],
  ['14', 'La Unión'], ['01', 'Ahuachapán Norte'],
]

export const TIPO_DOC = [
  ['13', 'DUI'], ['36', 'NIT'], ['03', 'Pasaporte'], ['02', 'Carnet de residente'], ['37', 'Otro'],
]

export const onlyDigits = s => (s || '').replace(/\D/g, '')
export const validDUI = s => /^\d{9}$/.test(onlyDigits(s))
export const validNIT = s => { const d = onlyDigits(s); return d.length === 14 || d.length === 9 }
export const validNRC = s => /^\d{1,8}$/.test(onlyDigits(s))

// MH rechaza el DTE COMPLETO si el correo trae caracteres fuera de ASCII
// (29-ago: "facelectrónica@…" con tilde tumbó 3 facturas — salieron tickets
// impresos sin sello). Se normalizan acentos al guardar y el validador solo
// acepta ASCII, igual que Hacienda.
export const normalizeEmail = s => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export const validEmail = s => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalizeEmail(s))

/**
 * ¿Este cliente sirve para emitir un CCF? MH exige NIT, NRC, giro y dirección;
 * si falta algo el DTE se rechaza DESPUÉS de cobrar, así que conviene saberlo antes.
 * Devuelve la lista de lo que falta (vacía = listo).
 */
export function faltantesParaCCF(c) {
  const falta = []
  if (!validNIT(c?.numero_documento)) falta.push('NIT')
  if (!validNRC(c?.nrc)) falta.push('NRC')
  if (!String(c?.giro || '').trim()) falta.push('giro')
  if (!String(c?.direccion || '').trim()) falta.push('dirección')
  if (!validEmail(c?.email)) falta.push('correo')
  return falta
}
