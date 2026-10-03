/* Lotes de preparación e impresiones, vistos desde la tablet de etiquetas.

   Regla de oro: imprimir NUNCA se frena por la red ni por falta de insumos. Si
   la base no responde, el registro de la impresión queda en el buzón de la
   tablet y se sube solo (la deuda se abre en ese momento). */

import { db } from '../supabase'

const BUZON = 'etiquetado_buzon_v1'
const leer = () => { try { return JSON.parse(localStorage.getItem(BUZON) || '[]') } catch { return [] } }
const guardar = (v) => { try { localStorage.setItem(BUZON, JSON.stringify(v)) } catch { /* sin storage */ } }

export async function cargarLotes() {
  try {
    const { data, error } = await db.rpc('fn_prep_lotes_hoy')
    if (error) throw error
    return Array.isArray(data) ? data : []
  } catch { return null }   // null = sin conexión (distinto de "no hay lotes")
}

/* Lote creado a propósito para imprimir sin pasar por la estación de
   preparación. Queda marcado `sin_preparacion` y genera deuda. */
export async function abrirLoteSinPreparacion(usuarioId) {
  const { data, error } = await db.rpc('fn_prep_lote_abrir', { p_usuario: usuarioId, p_recetas: [], p_sin_preparacion: true })
  if (error) throw new Error(error.message)
  return { id: data.id, lote: data.lote }
}

async function enviar(p) {
  let loteId = p.loteId
  if (!loteId) {   // quedó pendiente un lote sin número: se crea ahora
    const l = await abrirLoteSinPreparacion(p.usuarioId); loteId = l.id
  }
  const { data, error } = await db.rpc('fn_etiqueta_registrar', {
    p_usuario: p.usuarioId, p_lote_id: loteId, p_producto_id: p.productoId, p_producto: p.producto, p_unidades: p.unidades,
  })
  if (error) throw new Error(error.message)
  return data   // { con_insumos, deuda_nueva }
}

/* Devuelve { con_insumos, deuda_nueva } o null si quedó en el buzón. */
export async function registrarImpresion(p) {
  try { return await enviar(p) }
  catch { guardar([...leer(), p]); return null }
}

export async function vaciarBuzon() {
  const cola = leer(); if (!cola.length) return 0
  const quedan = []
  for (const p of cola) { try { await enviar(p) } catch { quedan.push(p) } }
  guardar(quedan)
  return cola.length - quedan.length
}
