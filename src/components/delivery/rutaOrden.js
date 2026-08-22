// ────────────────────────────────────────────────────────────────────
// Orden de entrega sugerido para un motorista con varios pedidos.
//
// Lo usan los dos mapas de la Torre (el de la pestaña Mapa y el de
// asignación) para que ambos muestren la misma secuencia. Si cada uno
// calculara lo suyo, Karina vería órdenes distintos según dónde mire.
//
// El criterio pesa dos cosas, ambas en minutos para poder compararlas:
//   · lo que el cliente ya esperó   → empuja el pedido hacia adelante
//   · lo que cuesta llegar hasta él → lo empuja hacia atrás
//
// En cada paso gana el mejor balance: espera − viaje. Así un pedido viejo
// se entrega antes aunque quede algo más lejos, pero no se hace un desvío
// absurdo por ganar dos minutos de antigüedad.
// ────────────────────────────────────────────────────────────────────

export const MIN_POR_KM = 2.4;        // mismo factor que usa el ETA del servidor
export const ESPERA_CRITICA_MIN = 40; // pasado esto, el pedido va primero sí o sí
export const PESO_ESPERA = 1.0;       // 1 minuto esperando = 1 minuto de viaje

export function km(aLat, aLng, bLat, bLng) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function ordenarRuta(desde, pedidos, ahora = Date.now()) {
  const pend = [...pedidos];
  const ruta = [];
  let pos = desde;

  while (pend.length) {
    const espera = (p) => Math.max(0, (ahora - new Date(p.created_at).getTime()) / 60000);
    const viaje  = (p) => km(pos.lat, pos.lng, p.cliente_lat, p.cliente_lng) * MIN_POR_KM;

    // Los que ya pasaron el límite de espera no compiten por cercanía: entre
    // ellos gana el más viejo. Evita que un pedido lejano quede postergado
    // indefinidamente mientras entran otros más cerca.
    const criticos = pend.filter((p) => espera(p) >= ESPERA_CRITICA_MIN);
    const candidatos = criticos.length ? criticos : pend;

    let mejor = candidatos[0];
    let mejorPuntaje = espera(mejor) * PESO_ESPERA - viaje(mejor);
    for (const p of candidatos.slice(1)) {
      const puntaje = espera(p) * PESO_ESPERA - viaje(p);
      if (puntaje > mejorPuntaje) { mejor = p; mejorPuntaje = puntaje; }
    }

    ruta.push(mejor);
    pos = { lat: mejor.cliente_lat, lng: mejor.cliente_lng };
    pend.splice(pend.indexOf(mejor), 1);
  }
  return ruta;
}

// Agrupa los pedidos vivos de cada motorista. Un pedido cuenta desde que se
// le asigna, aunque siga en cocina: el motorista ya sabe que le toca.
export function pedidosPorMotorista(pedidos) {
  const mapa = new Map();
  for (const p of pedidos || []) {
    if (!p.motorista_id) continue;
    if (p.cliente_lat == null || p.cliente_lng == null) continue;
    if (!['preparando', 'lista', 'en_camino'].includes(p.estado)) continue;
    if (!mapa.has(p.motorista_id)) mapa.set(p.motorista_id, []);
    mapa.get(p.motorista_id).push(p);
  }
  return mapa;
}
