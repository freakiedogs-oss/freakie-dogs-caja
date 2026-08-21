import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ── MAPA PARA MARCAR LA CASA A MANO ──────────────────────────────────
// Se muestra solo cuando el GPS del navegador no sirvió (permiso denegado,
// sin señal, o demoró demasiado). Alrededor del 30% de los pedidos llegaban
// sin coordenadas y el motorista salía a buscar la dirección a ciegas.
//
// Dos reglas de diseño, aprendidas del problema que queríamos evitar:
//  1. El pin arranca en una posición aproximada (por red), NO en la casa del
//     cliente — así que el punto inicial nunca es una dirección válida.
//  2. El botón de confirmar está bloqueado hasta que el cliente mueva el pin.
//     Sin esto, mucha gente acepta sin tocar nada y el pedido queda peor que
//     sin ubicación: con un punto que parece bueno y no lo es.

// Centro de respaldo: San Salvador, por si la ubicación aproximada no responde.
const CENTRO_FALLBACK = { lat: 13.6989, lng: -89.1914 }
// Cuánto tiene que arrastrar el pin para que cuente como movido (en grados,
// ~50 metros). Evita que un toque accidental habilite el botón.
const MOVIMIENTO_MINIMO = 0.00045

const iconoCasa = L.divIcon({
  className: '',
  html: `<div style="font-size:34px;line-height:1;transform:translate(-50%,-100%);
                     filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">📍</div>`,
  iconSize: [0, 0],
  iconAnchor: [0, 0],
})

export default function MapaUbicacion({ onConfirmar, onCancelar }) {
  const contenedor = useRef(null)
  const mapaRef = useRef(null)
  const marcadorRef = useRef(null)
  const inicialRef = useRef(null)

  const [listo, setListo] = useState(false)
  const [movido, setMovido] = useState(false)
  const [punto, setPunto] = useState(null)

  useEffect(() => {
    let vivo = true

    // Posición aproximada por red. Da precisión de ciudad (1-5 km), suficiente
    // para que el cliente no tenga que arrastrar el mapa desde el otro lado del
    // país. Si el servicio no responde, caemos a San Salvador.
    const buscarCentro = async () => {
      try {
        const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) })
        if (!r.ok) throw new Error('sin respuesta')
        const d = await r.json()
        const lat = Number(d?.latitude), lng = Number(d?.longitude)
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
      } catch { /* seguimos con el respaldo */ }
      return CENTRO_FALLBACK
    }

    buscarCentro().then((centro) => {
      if (!vivo || !contenedor.current || mapaRef.current) return

      const mapa = L.map(contenedor.current, {
        center: [centro.lat, centro.lng],
        zoom: 14,
        zoomControl: true,
        attributionControl: false,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(mapa)

      const marcador = L.marker([centro.lat, centro.lng], {
        icon: iconoCasa,
        draggable: true,
        autoPan: true,
      }).addTo(mapa)

      const registrar = (lat, lng) => {
        setPunto({ lat, lng })
        const ini = inicialRef.current
        const lejos = Math.abs(lat - ini.lat) > MOVIMIENTO_MINIMO ||
                      Math.abs(lng - ini.lng) > MOVIMIENTO_MINIMO
        if (lejos) setMovido(true)
      }

      marcador.on('dragend', () => {
        const { lat, lng } = marcador.getLatLng()
        registrar(lat, lng)
      })

      // Tocar el mapa también mueve el pin — más fácil en pantallas chicas
      // que arrastrar con el dedo.
      mapa.on('click', (e) => {
        marcador.setLatLng(e.latlng)
        registrar(e.latlng.lat, e.latlng.lng)
      })

      inicialRef.current = { lat: centro.lat, lng: centro.lng }
      mapaRef.current = mapa
      marcadorRef.current = marcador
      setPunto({ lat: centro.lat, lng: centro.lng })
      setListo(true)

      // Leaflet calcula mal el tamaño si el contenedor apareció recién
      setTimeout(() => mapa.invalidateSize(), 150)
    })

    return () => {
      vivo = false
      if (mapaRef.current) { mapaRef.current.remove(); mapaRef.current = null }
    }
  }, [])

  return (
    <div className="mp-mapa-wrap">
      <div className="mp-mapa-titulo">Marcá dónde estás</div>
      <div className="mp-mapa-ayuda">
        Arrastrá el pin 📍 hasta tu casa, o tocá el punto exacto en el mapa.
      </div>

      <div ref={contenedor} className="mp-mapa" />

      {!listo && <div className="mp-mapa-cargando">Cargando el mapa…</div>}

      {listo && !movido && (
        <div className="mp-mapa-aviso">
          Movés el pin para continuar. Ese punto es donde va a llegar tu pedido.
        </div>
      )}

      {listo && movido && (
        <div className="mp-mapa-ok">✅ Punto marcado</div>
      )}

      <div className="mp-mapa-botones">
        <button
          type="button"
          className="mp-mapa-confirmar"
          disabled={!movido}
          onClick={() => punto && onConfirmar(punto)}
        >
          {movido ? 'Confirmar este punto' : 'Movés el pin primero'}
        </button>
        <button type="button" className="mp-mapa-cancelar" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
