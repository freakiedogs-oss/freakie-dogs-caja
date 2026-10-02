/* ═══════════════════════════════════════════════════════════════════════
   Los productos que se pesan y etiquetan en Casa Matriz

   2-oct-2026: la lista dejó de vivir acá y pasó a la base
   (`etiquetado_productos`). Antes, agregar un producto exigía un commit y un
   deploy: si llegaba a la báscula algo que no estaba en la lista, la
   producción se paraba hasta que Cesar tuviera tiempo. Ahora la mantiene
   Kevin desde la misma tablet, en el momento.

   `gramos` es siempre el peso NETO y `tara` lo que pesa el empaque vacío;
   la estación resta la tara antes de juzgar y antes de imprimir.

   La copia de abajo es solo el respaldo para cuando la tablet no alcanza la
   red: deja trabajar con los de siempre en vez de mostrar una lista vacía.
   No se edita a mano — lo que mande la base manda.
   ═══════════════════════════════════════════════════════════════════════ */

import { db } from '../supabase'

export const PRODUCTOS_RESPALDO = [
  { id: 'carne',      nombre: 'Carne para hamburguesa',   unidad: 'bolsa 20 bolitas', gramos: 1361, banda: 34, tara: 12, dias: 5,   conserva: 'Mantener refrigerado' },
  { id: 'quesofrito', nombre: 'Queso frito',              unidad: 'bolsita 0.30 lb',  gramos: 136,  banda: 8,  tara: 2,  dias: 30,  conserva: 'Mantener refrigerado' },
  { id: 'cheddar',    nombre: 'Cheddar Porcionado',       unidad: 'bolsa 2 lb',       gramos: 907,  banda: 50, dias: 30,  conserva: 'Mantener refrigerado' },
  { id: 'chili',      nombre: 'Chili con carne',          unidad: 'bolsa 5 lb',       gramos: 2268, banda: 50, dias: 90,  conserva: 'Mantener congelado' },
  { id: 'cebmorada',  nombre: 'Cebolla Morada encurtida', unidad: 'bolsa 1 lb',       gramos: 454,  banda: 30, dias: 30,  conserva: 'Mantener refrigerado' },
  { id: 'sal',        nombre: 'Sal de hamburguesa',       unidad: 'bolsa 2 lb',       gramos: 907,  banda: 40, dias: 180, conserva: 'Lugar seco' },
  { id: 'escabeche',  nombre: 'Escabeche',                unidad: 'bolsa',            gramos: null, banda: null, dias: 30, conserva: 'Mantener refrigerado' },
  { id: 'milislas',   nombre: 'Salsa Mil Islas',          unidad: 'bolsa',            gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'chipotle',   nombre: 'Salsa Chipotle',           unidad: 'bolsa',            gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'truffa',     nombre: 'Salsa Truffa',             unidad: 'bolsa',            gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'mermelada',  nombre: 'Mermelada de Tocino',      unidad: 'tanda',            gramos: null, banda: null, dias: 21, conserva: 'Mantener refrigerado' },
  { id: 'ranch',      nombre: 'Ranch Porcionado',         unidad: 'bote',             gramos: null, banda: null, dias: 15, conserva: 'Mantener refrigerado' },
  { id: 'salchicha',  nombre: 'Salchicha reempacada',     unidad: 'paquete 25 un',    gramos: null, banda: null, dias: 20, conserva: 'Mantener refrigerado' },
  { id: 'cebblanca',  nombre: 'Cebolla Blanca',           unidad: 'bolsa',            gramos: null, banda: null, dias: 7,  conserva: 'Mantener refrigerado' },
]

const CACHE = 'etiquetado_productos_cache_v2'

/* Lee la lista de la base. Si la red falla usa lo último que vio esta
   tablet, y si nunca vio nada, el respaldo de arriba: una lista vieja deja
   seguir produciendo, una lista vacía no. */
export async function cargarProductos() {
  try {
    const { data, error } = await db.rpc('fn_etiquetado_productos')
    if (error) throw error
    const lista = Array.isArray(data) ? data : []
    if (lista.length) {
      try { localStorage.setItem(CACHE, JSON.stringify(lista)) } catch { /* sin storage igual sirve */ }
      return { lista, fuente: 'base' }
    }
  } catch { /* abajo se resuelve */ }
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) || 'null')
    if (Array.isArray(v) && v.length) return { lista: v, fuente: 'cache' }
  } catch { /* nada */ }
  return { lista: PRODUCTOS_RESPALDO, fuente: 'respaldo' }
}

/* Valida el PIN contra la base y devuelve quién es, o null. El rol lo decide
   el servidor (fn_etiquetado_actor), no esta pantalla. */
export async function validarPin(pin) {
  const { data, error } = await db.rpc('fn_etiquetado_actor', { p_pin: String(pin) })
  if (error) throw new Error(error.message)
  return data || null
}

export async function guardarProducto(pin, p) {
  const { data, error } = await db.rpc('fn_etiquetado_producto_guardar', {
    p_pin: String(pin),
    p_clave: p.clave || null,
    p_nombre: p.nombre,
    p_unidad: p.unidad || null,
    p_gramos: p.gramos,
    p_banda: p.banda ?? null,
    p_tara: p.tara ?? 0,
    p_dias: p.dias ?? null,
    p_conserva: p.conserva || null,
  })
  if (error) throw new Error(error.message)
  return data
}

/* Se llama al empezar a pesar. Es lo que mantiene vivo al producto: lo que
   nadie pesa en 15 días lo retira solo un job de la base. */
export function marcarUso(clave) {
  Promise.resolve(db.rpc('fn_etiquetado_marcar_uso', { p_clave: clave })).catch(() => { /* no bloquea el pesaje */ })
}
