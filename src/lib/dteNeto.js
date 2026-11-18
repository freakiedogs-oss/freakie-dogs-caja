/**
 * dteNeto.js — Precio unitario SIN IVA para CCF (03) y Nota de Crédito (05).
 *
 * Los precios de Freakie se digitan y se cotizan CON IVA; esos documentos van
 * netos y Hacienda suma el IVA encima. La conversión vivía repetida en cuatro
 * lugares como `round2(precio / 1.13)`, y redondear el unitario ANTES de
 * multiplicar por la cantidad pierde centavos: 100 × $1.99 mandaba 1.76 en vez
 * de 1.7611 y un CCF cotizado en $224.00 salió por $223.88 (17-nov-2026; hubo
 * que invalidarlo y reemitirlo).
 *
 * Acá se trabaja al revés: se parte del total con IVA que el cliente espera
 * pagar, se busca el neto cuyo `neto + IVA` da ese total, se reparte entre las
 * líneas al centavo y recién ahí se saca el unitario, con 8 decimales (el
 * máximo que acepta el esquema de MH). Así `round2(precioUni × cantidad)` de
 * cada línea — que es como lo calcula `dte-service` — da exactamente su parte.
 *
 * El redondeo replica el de la Edge Function (`roundMoney`), a propósito: si
 * las dos cuentas no son la misma, vuelven a aparecer los centavos.
 */

const IVA = 0.13
const r2 = (n) => Math.round(n * 100) / 100
const ivaDe = (neto) => r2(neto * IVA)

/** Neto (en centavos) cuyo neto + IVA da `totalC`; el más cercano si no existe. */
function netoObjetivoC(totalC) {
  const base = Math.round(totalC / (1 + IVA))
  // ~1 de cada 8 totales no se puede formar con ningún neto de 2 decimales
  // (el IVA salta de centavo). Ahí queda el más cercano: 1 centavo de diferencia.
  for (const n of [base, base - 1, base + 1]) {
    if (n >= 0 && n + Math.round(ivaDe(n / 100) * 100) === totalC) return n
  }
  return base
}

/**
 * @param {Array<{precio:number, cantidad:number}>} lineas precio unitario CON IVA
 * @returns {number[]} precio unitario SIN IVA de cada línea, en el mismo orden
 */
export function preciosNetos(lineas) {
  const ls = (lineas || []).map(l => ({
    cantidad: Number(l.cantidad) || 0,
    brutoC: Math.round((Number(l.precio) || 0) * (Number(l.cantidad) || 0) * 100),
  }))
  const objetivoC = netoObjetivoC(ls.reduce((s, l) => s + l.brutoC, 0))

  // Reparto por mayor residuo: cada línea toma su parte entera y los centavos
  // que faltan (o sobran) van a las que quedaron más lejos de su valor exacto.
  const partes = ls.map((l, i) => {
    const exacto = l.brutoC / (1 + IVA)
    const netoC = Math.floor(exacto)
    return { i, netoC, resto: exacto - netoC, vacia: l.brutoC === 0 }
  })
  let falta = objetivoC - partes.reduce((s, p) => s + p.netoC, 0)
  const porResto = partes.filter(p => !p.vacia).sort((a, b) => b.resto - a.resto)
  for (let k = 0; falta !== 0 && porResto.length && k < 10 * porResto.length; k++) {
    if (falta > 0) { porResto[k % porResto.length].netoC += 1; falta -= 1 }
    else {
      const p = porResto[porResto.length - 1 - (k % porResto.length)]
      if (p.netoC > 0) { p.netoC -= 1; falta += 1 }
    }
  }

  return partes.map((p, i) => {
    const cant = ls[i].cantidad
    return cant > 0 ? Math.round((p.netoC / 100 / cant) * 1e8) / 1e8 : 0
  })
}

/** Lo que va a calcular `dte-service` con esos unitarios: para mostrar y para `pagos`. */
export function totalesNetos(lineas) {
  const precios = preciosNetos(lineas)
  const gravado = r2((lineas || []).reduce((s, l, i) => s + r2(precios[i] * (Number(l.cantidad) || 0)), 0))
  const iva = ivaDe(gravado)
  return { precios, gravado, iva, total: r2(gravado + iva) }
}
