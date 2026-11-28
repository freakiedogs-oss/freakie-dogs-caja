// Polyline codificada de Google (27-nov-2026): la ruta real por calles con
// tráfico que calcula la edge `ruta-viva`. Formato estándar, precisión 1e5.
// Devuelve [[lat, lng], ...].
export function decodificarPolyline(s) {
  const pts = []
  let i = 0, lat = 0, lng = 0
  while (s && i < s.length) {
    for (const k of [0, 1]) {
      let b, sh = 0, r = 0
      do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5 } while (b >= 0x20 && i < s.length)
      const d = (r & 1) ? ~(r >> 1) : (r >> 1)
      if (k === 0) lat += d; else lng += d
    }
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}
