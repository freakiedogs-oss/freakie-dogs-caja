/* ═══════════════════════════════════════════════════════════════════════
   Los productos que se pesan y etiquetan en Casa Matriz

   Los nombres y las unidades salen de `recetas` (las que tienen catalogo_id
   y no rinden «porción»: esas son las que producen stock, no las que se
   venden). El peso objetivo y los días de vencimiento NO están en la base
   todavía, así que viven acá y se pueden corregir desde la pantalla; lo
   corregido queda en la tablet.

   Cuando Calidad cierre el RVP-13 de Mauricio (estudio de vida útil), los
   días dejan de ser un número puesto a mano y pasan a la base con el resto
   de los parámetros. Mientras tanto se muestran como provisionales, para
   que nadie los lea como aprobados.
   ═══════════════════════════════════════════════════════════════════════ */

export const PRODUCTOS = [
  { id: 'cheddar',   nombre: 'Cheddar Porcionado',        unidad: 'bolsa 2 lb',      gramos: 907,  banda: 50,  dias: 30,  conserva: 'Mantener refrigerado' },
  { id: 'chili',     nombre: 'Chili con carne',           unidad: 'bolsa 5 lb',      gramos: 2268, banda: 50,  dias: 90,  conserva: 'Mantener congelado' },
  { id: 'cebmorada', nombre: 'Cebolla Morada encurtida',  unidad: 'bolsa 1 lb',      gramos: 454,  banda: 30,  dias: 30,  conserva: 'Mantener refrigerado' },
  { id: 'sal',       nombre: 'Sal de hamburguesa',        unidad: 'bolsa 2 lb',      gramos: 907,  banda: 40,  dias: 180, conserva: 'Lugar seco' },
  { id: 'escabeche', nombre: 'Escabeche',                 unidad: 'bolsa',           gramos: null, banda: null, dias: 30, conserva: 'Mantener refrigerado' },
  { id: 'milislas',  nombre: 'Salsa Mil Islas',           unidad: 'bolsa',           gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'chipotle',  nombre: 'Salsa Chipotle',            unidad: 'bolsa',           gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'truffa',    nombre: 'Salsa Truffa',              unidad: 'bolsa',           gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'mermelada', nombre: 'Mermelada de Tocino',       unidad: 'tanda',           gramos: null, banda: null, dias: 21, conserva: 'Mantener refrigerado' },
  { id: 'ranch',     nombre: 'Ranch Porcionado',          unidad: 'bote',            gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'salchicha', nombre: 'Salchicha reempacada',      unidad: 'paquete 25 un',   gramos: null, banda: null, dias: 20, conserva: 'Mantener refrigerado' },
  { id: 'cebblanca', nombre: 'Cebolla Blanca',            unidad: 'bolsa',           gramos: null, banda: null, dias: 7,  conserva: 'Mantener refrigerado' },
]

const CLAVE = 'etiquetado_ajustes_v1'

/* Lo que el operario corrija en la tablet (peso objetivo, banda, días) se
   guarda acá y pisa al valor de arriba. Es por tablet, a propósito: esto es
   la prueba, no la fuente de verdad. */
export function leerAjustes() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') } catch { return {} }
}
export function guardarAjuste(id, campos) {
  const todo = leerAjustes()
  todo[id] = { ...(todo[id] || {}), ...campos }
  try { localStorage.setItem(CLAVE, JSON.stringify(todo)) } catch { /* sin storage igual funciona hoy */ }
  return todo
}
export function conAjustes(ajustes) {
  return PRODUCTOS.map(p => ({ ...p, ...(ajustes[p.id] || {}) }))
}
