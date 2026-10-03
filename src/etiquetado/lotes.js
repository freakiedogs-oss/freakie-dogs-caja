/* Lotes de preparación e impresiones, vistos desde la tablet de etiquetas.

   Regla de oro: imprimir NUNCA se frena por la red ni por falta de insumos. Si
   la base no responde, el registro de la impresión queda en el buzón de la
   tablet y se sube solo (la deuda se abre en ese momento). */

import { db } from '../supabase'

const BUZON = 'etiquetado_buzon_v1'
const leer = () => { try { return JSON.parse(localStorage.getItem(BUZON) || '[]') } catch { return [] } }
const guardar = (v) => { try { localStorage.setItem(BUZON, JSON.stringify(v)) } catch { /* sin storage */ } }

/* Lote del día de esta persona: todo lo que imprime hoy cae ahí y al final del
   turno registra los insumos una sola vez (estación de preparación). Si ya
   registró y lo cerró, se abre uno nuevo. Mientras no estén los insumos, cada
   impresión mantiene abierta una deuda que bloquea su salida en Mi Asistencia. */
export async function loteDelDia(usuarioId) {
  const { data, error } = await db.rpc('fn_prep_lote_del_dia', { p_usuario: usuarioId })
  if (error) throw new Error(error.message)
  return { id: data.id, lote: data.lote }
}

async function enviar(p) {
  let loteId = p.loteId
  if (!loteId) {   // quedó pendiente un lote sin número: se crea ahora
    const l = await loteDelDia(p.usuarioId); loteId = l.id
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
