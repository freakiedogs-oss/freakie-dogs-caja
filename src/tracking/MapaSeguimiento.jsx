// Mapa del seguimiento con dos vistas (19-nov-2026):
//  · 3D (por defecto): ciudad isométrica con el motorista animado (mapa3d/motor.js)
//  · Mapa: el mapa normal de calles (Leaflet/OpenStreetMap) para ubicarse puntual.
// Si el 3D no puede arrancar (sin WebGL, sin red al CDN, etc.) cae solo al Mapa.
// La elección del cliente se recuerda en este teléfono.
import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { crearMapa3D, soportaWebGL } from './mapa3d/motor'
import { decodificarPolyline } from './polyline'

const MapaEnVivo = lazy(() => import('./MapaEnVivo'))

const leerVista = () => { try { return localStorage.getItem('fd_track_vista') || '3d' } catch { return '3d' } }

export default function MapaSeguimiento({ driver, cliente, tienda, nombre, sucursal, paradas = [], polyline = null }) {
  const puede3D = !!(cliente?.lat && soportaWebGL())
  const [vista, setVista] = useState(() => (puede3D ? leerVista() : 'mapa'))
  const [falla3D, setFalla3D] = useState(false)
  const v = falla3D || !puede3D ? 'mapa' : vista
  const cambiar = (x) => { setVista(x); try { localStorage.setItem('fd_track_vista', x) } catch { /* noop */ } }

  return (
    <div className="m3-wrap">
      {puede3D && !falla3D && (
        <div className="m3-vistas" role="tablist">
          <button className={v === '3d' ? 'on' : ''} onClick={() => cambiar('3d')}>🧊 3D</button>
          <button className={v === 'mapa' ? 'on' : ''} onClick={() => cambiar('mapa')}>🗺️ Mapa</button>
        </div>
      )}
      {v === '3d'
        ? <Vista3D driver={driver} cliente={cliente} tienda={tienda} nombre={nombre} sucursal={sucursal} paradas={paradas} polyline={polyline} onFalla={() => setFalla3D(true)} />
        : (
          <Suspense fallback={<div className="tk-mapa-ph">Cargando mapa…</div>}>
            <MapaEnVivo driver={driver} cliente={cliente} nombre={nombre} paradas={paradas} polyline={polyline} />
          </Suspense>
        )}
    </div>
  )
}

function Vista3D({ driver, cliente, tienda, nombre, sucursal, paradas, polyline, onFalla }) {
  const el = useRef(null)
  const motor = useRef(null)
  const pend = useRef(null)
  const [listo, setListo] = useState(false)
  const [modo, setModo] = useState('seguir')
  const [dato, setDato] = useState('')
  const ll = (p) => [Number(p.lng), Number(p.lat)]
  const pars = paradas.map(ll)

  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => { if (vivo && !motor.current) onFalla() }, 25000) // no arrancó: mapa normal
    crearMapa3D(el.current, {
      tienda: tienda?.lat ? ll(tienda) : null,
      casa: ll(cliente),
      driver: ll(driver),
      paradas: pars,
      motorista: nombre,
      sucursal,
      onDato: setDato,
      onModo: setModo,
    }).then((m) => {
      clearTimeout(t)
      if (!vivo) { m.destroy(); return }
      motor.current = m; setListo(true)
      if (pend.current) { m.update(pend.current); pend.current = null }
    }).catch((e) => { console.warn('[mapa3d]', e); clearTimeout(t); if (vivo) onFalla() })
    return () => { vivo = false; clearTimeout(t); motor.current?.destroy(); motor.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const clave = pars.map(p => p.join(',')).join('|')
  useEffect(() => {
    // Ruta de Google con tráfico (si hay): el motor la usa en vez de la de OSRM
    const ruta = polyline ? decodificarPolyline(polyline).map(([la, lo]) => [lo, la]) : null
    const u = { driver: ll(driver), paradas: pars, ruta }
    if (motor.current) motor.current.update(u); else pend.current = u
  }, [driver?.lat, driver?.lng, clave, polyline]) // eslint-disable-line react-hooks/exhaustive-deps

  const ir = (m) => { setModo(m); motor.current?.modo(m) }

  return (
    <>
      <div className="m3-mapa" ref={el}>
        {!listo && <div className="m3-cargando"><span className="tk-spin" /> Armando tu ciudad en 3D…</div>}
        {listo && (
          <>
            <div className="m3-chips">
              <button className={modo === 'seguir' ? 'on' : ''} onClick={() => ir('seguir')}>🎥 Seguir</button>
              <button className={modo === 'dron' ? 'on' : ''} onClick={() => ir('dron')}>🛰️ Dron</button>
              <button className={modo === 'ruta' ? 'on' : ''} onClick={() => ir('ruta')}>🧭 Toda la ruta</button>
            </div>
            <div className="m3-zoom">
              <button aria-label="Acercar" onClick={() => motor.current?.zoom(1.4)}>+</button>
              <button aria-label="Alejar" onClick={() => motor.current?.zoom(1 / 1.4)}>−</button>
            </div>
          </>
        )}
      </div>
      {dato && <div className="m3-dato">{dato}</div>}
    </>
  )
}
