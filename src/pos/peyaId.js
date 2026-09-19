// ID del pedido de PedidosYa (pedido Cesar 17-sep-2026).
//
// En el panel de PeYa cada pedido tiene un código corto; cuadrar contra el POS
// por hora y monto era adivinar (los #18/#19 del 16-sep). Ahora el POS lo pide
// al abrir la orden y al cobrar con CxC PeYa, y lo guarda en
// pos_cuentas.delivery_referencia. Se enciende por sucursal
// (sucursales.peya_id_obligatorio): piloto en Cafetalón, luego las demás.
import { useEffect, useState } from 'react'
import { db } from '../supabase'

// Misma normalización que hace la base (normalizar_id_peya): mayúsculas, sin
// espacios ni '#'. Se aplica también acá para que lo que la cajera ve en el
// botón sea exactamente lo que va a quedar guardado.
export function normalizarIdPeya(s) {
  const v = String(s ?? '').replace(/[\s#]+/g, '').toUpperCase()
  return v || null
}

export const PEYA_ID_MAX = 20

// Caché por sucursal: la bandera no cambia durante el turno y cada pantalla
// del POS la consulta; no tiene sentido ir a la base cada vez.
const _cache = {}

export async function peyaIdObligatorioParaStore(storeCode) {
  if (!storeCode) return false
  if (storeCode in _cache) return _cache[storeCode]
  try {
    const { data } = await db.from('sucursales').select('peya_id_obligatorio').eq('store_code', storeCode).maybeSingle()
    _cache[storeCode] = !!data?.peya_id_obligatorio
  } catch {
    // Si la consulta falla no se traba la venta: se comporta como antes.
    _cache[storeCode] = false
  }
  return _cache[storeCode]
}

export function usePeyaIdObligatorio(storeCode) {
  const [on, setOn] = useState(() => !!_cache[storeCode])
  useEffect(() => {
    let vivo = true
    peyaIdObligatorioParaStore(storeCode).then(v => { if (vivo) setOn(v) })
    return () => { vivo = false }
  }, [storeCode])
  return on
}
