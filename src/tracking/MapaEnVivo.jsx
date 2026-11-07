// Mapa del tracking: motorista + destino. Leaflet + OpenStreetMap (sin API key).
// Chunk lazy: solo se carga cuando el pedido va en camino.
// `paradas` (7-nov-2026): entregas que el motorista hace ANTES que este cliente
// (ubicación aproximada, sin datos del otro cliente). La ruta se dibuja
// motorista → parada 1 → … → tu casa, para que el cliente vea hacia dónde va
// y de dónde sale después.
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const ico = (html, size) => L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html })

export default function MapaEnVivo({ driver, cliente, nombre, paradas = [] }) {
  const el = useRef(null)
  const map = useRef(null)
  const mkDriver = useRef(null)
  const mkCliente = useRef(null)
  const mkParadas = useRef([])
  const linea = useRef(null)

  useEffect(() => {
    if (map.current || !el.current) return
    const m = L.map(el.current, { zoomControl: false, attributionControl: false })
      .setView([driver.lat, driver.lng], 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m)
    map.current = m
    setTimeout(() => m.invalidateSize(), 120)
    return () => { m.remove(); map.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const clave = paradas.map(p => `${p.lat},${p.lng}`).join('|')

  useEffect(() => {
    const m = map.current
    if (!m || !driver?.lat) return

    if (mkDriver.current) mkDriver.current.setLatLng([driver.lat, driver.lng])
    else mkDriver.current = L.marker([driver.lat, driver.lng], {
      icon: ico('<div style="font-size:26px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">🛵</div>', 34),
      zIndexOffset: 1000,
    }).addTo(m).bindTooltip(nombre ? `${nombre} va en camino` : 'Tu pedido', { direction: 'top' })

    // Paradas previas: se rehacen cuando cambia la lista (p. ej. ya entregó una)
    mkParadas.current.forEach(mk => mk.remove())
    mkParadas.current = paradas.map((p, i) => L.marker([p.lat, p.lng], {
      icon: ico(`<div style="width:26px;height:26px;border-radius:50%;background:#1a1200;color:#FFD900;font:700 13px/26px system-ui;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${i + 1}</div>`, 26),
    }).addTo(m).bindTooltip(paradas.length > 1 ? `Entrega ${i + 1} antes de la tuya` : 'Entrega antes de la tuya', { direction: 'top', permanent: true }))

    if (cliente?.lat) {
      if (mkCliente.current) mkCliente.current.setLatLng([cliente.lat, cliente.lng])
      else mkCliente.current = L.marker([cliente.lat, cliente.lng], {
        icon: ico('<div style="font-size:22px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">🏠</div>', 30),
      }).addTo(m).bindTooltip(paradas.length ? 'Vos' : 'Tu dirección', { direction: 'top', permanent: paradas.length > 0 })

      const pts = [[driver.lat, driver.lng], ...paradas.map(p => [p.lat, p.lng]), [cliente.lat, cliente.lng]]
      if (linea.current) linea.current.setLatLngs(pts)
      else linea.current = L.polyline(pts, { color: '#E63946', weight: 3, dashArray: '6,8', opacity: 0.7 }).addTo(m)

      try { m.fitBounds(L.latLngBounds(pts).pad(0.3)) } catch { /* noop */ }
    } else {
      m.setView([driver.lat, driver.lng], 15)
    }
  }, [driver?.lat, driver?.lng, cliente?.lat, cliente?.lng, nombre, clave]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="tk-mapa" />
}
