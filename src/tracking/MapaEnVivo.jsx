// Mapa del tracking: motorista + destino. Leaflet + OpenStreetMap (sin API key).
// Chunk lazy: solo se carga cuando el pedido va en camino.
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export default function MapaEnVivo({ driver, cliente, nombre }) {
  const el = useRef(null)
  const map = useRef(null)
  const mkDriver = useRef(null)
  const mkCliente = useRef(null)
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

  useEffect(() => {
    const m = map.current
    if (!m || !driver?.lat) return

    const icoDriver = L.divIcon({
      className: '', iconSize: [34, 34], iconAnchor: [17, 17],
      html: '<div style="font-size:26px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">🛵</div>',
    })
    if (mkDriver.current) mkDriver.current.setLatLng([driver.lat, driver.lng])
    else mkDriver.current = L.marker([driver.lat, driver.lng], { icon: icoDriver, zIndexOffset: 1000 })
      .addTo(m).bindTooltip(nombre ? `${nombre} va en camino` : 'Tu pedido', { direction: 'top' })

    if (cliente?.lat) {
      const icoCasa = L.divIcon({
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
        html: '<div style="font-size:22px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">🏠</div>',
      })
      if (mkCliente.current) mkCliente.current.setLatLng([cliente.lat, cliente.lng])
      else mkCliente.current = L.marker([cliente.lat, cliente.lng], { icon: icoCasa }).addTo(m).bindTooltip('Tu dirección', { direction: 'top' })

      const pts = [[driver.lat, driver.lng], [cliente.lat, cliente.lng]]
      if (linea.current) linea.current.setLatLngs(pts)
      else linea.current = L.polyline(pts, { color: '#E63946', weight: 3, dashArray: '6,8', opacity: 0.7 }).addTo(m)

      try { m.fitBounds(L.latLngBounds(pts).pad(0.35)) } catch { /* noop */ }
    } else {
      m.setView([driver.lat, driver.lng], 15)
    }
  }, [driver?.lat, driver?.lng, cliente?.lat, cliente?.lng, nombre])

  return <div ref={el} className="tk-mapa" />
}
