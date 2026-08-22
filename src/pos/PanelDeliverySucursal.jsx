// ────────────────────────────────────────────────────────────────────
// Panel de delivery de la sucursal · se abre desde el KDS
//
// Cocina cocina a ciegas respecto al delivery: no sabe si el motorista ya
// volvió, cuántos pedidos van saliendo ni cuánto lleva esperando cada uno.
// Esta pantalla le da ese vistazo, limitado a SU sucursal — el alcance lo
// decide el servidor a partir del PIN, no el cliente.
//
// Es solo de consulta: acá no se asigna ni se marca nada. Eso sigue siendo
// de la Torre.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react'
import { db } from '../supabase'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const REFRESH_MS = 20000

const C = {
  fondo: '#0f0f12', card: '#191920', borde: '#2a2a33', texto: '#f0f0f3',
  dim: '#8a8a95', verde: '#4ade80', amarillo: '#fbbf24', rojo: '#e63946',
  azul: '#60a5fa', naranja: '#f97316',
}

const ETAPAS = {
  recibida:   { t: 'Por cobrar', col: C.amarillo },
  preparando: { t: 'En cocina',  col: C.azul },
  lista:      { t: 'Lista, esperando motorista', col: C.naranja },
  en_camino:  { t: 'En la calle', col: C.verde },
}

// Cuántos minutos es demasiado en cada etapa. Lo que le importa a cocina es
// distinto de lo que le importa a la Torre: acá pesa el pedido que ya salió
// del horno y sigue en el mostrador.
const LIMITE = { recibida: 10, preparando: 20, lista: 8, en_camino: 30 }

const mins = (desde, ahora) => Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 60000))
const txtMin = (m) => (m < 1 ? 'recién' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`)

// Orden sugerido de preparación: primero lo que va a salir antes. Un pedido
// cuyo motorista está por llegar tiene que estar listo cuando él entre; uno
// sin motorista puede esperar aunque haya entrado primero.
function ordenarCocina(pedidos) {
  return [...pedidos].sort((a, b) => {
    const urg = (p) => p.min_regreso_motorista != null ? p.min_regreso_motorista : 999
    const d = urg(a) - urg(b)
    if (d !== 0) return d
    return new Date(a.created_at) - new Date(b.created_at)
  })
}

// Un timbre corto generado en el navegador: no depende de tener un archivo de
// sonido ni de que el sistema lo tenga habilitado.
function timbre() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator(), gan = ctx.createGain()
    osc.connect(gan); gan.connect(ctx.destination)
    osc.frequency.value = 880
    gan.gain.setValueAtTime(0.001, ctx.currentTime)
    gan.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gan.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start(); osc.stop(ctx.currentTime + 0.45)
    setTimeout(() => ctx.close(), 700)
  } catch { /* si el navegador no deja, seguimos sin sonido */ }
}

export default function PanelDeliverySucursal({ user, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [ahora, setAhora] = useState(Date.now())
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const capa = useRef(null)
  const encuadrado = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 20000)
    return () => clearInterval(t)
  }, [])

  const idsVistos = useRef(null)
  const [sonido, setSonido] = useState(
    () => localStorage.getItem('kds_delivery_sonido') !== '0')
  const [marcando, setMarcando] = useState(null)

  const cargar = useCallback(async () => {
    if (!user?.pin) { setError('Sin PIN de sesión'); return }
    try {
      const { data: r, error: e } = await db.rpc('sucursal_panel_delivery', { p_pin: String(user.pin) })
      if (e) throw e

      // Timbre cuando entra un pedido que antes no estaba. En la primera carga
      // no suena: si no, al abrir la pantalla sonaría por todos los que ya había.
      const ids = new Set((r?.pedidos || []).map(p => p.id))
      if (idsVistos.current) {
        const nuevos = [...ids].filter(id => !idsVistos.current.has(id))
        if (nuevos.length && sonido) timbre()
      }
      idsVistos.current = ids

      setData(r); setError('')
    } catch (e) { setError(e.message || 'No se pudo cargar') }
  }, [user?.pin, sonido])

  const marcarLista = async (p) => {
    setMarcando(p.id)
    try {
      const { error: e } = await db.rpc('sucursal_marcar_lista', {
        p_pin: String(user.pin), p_delivery_id: p.id })
      if (e) throw e
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo marcar') }
    finally { setMarcando(null) }
  }

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, REFRESH_MS)
    return () => clearInterval(t)
  }, [cargar])

  // Mapa
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return
    const map = L.map(mapEl.current, { zoomControl: true }).setView([13.70, -89.19], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    capa.current = L.layerGroup().addTo(map)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 150)
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !data || !capa.current) return
    capa.current.clearLayers()
    const puntos = []

    const s = data.sucursal
    if (s?.lat != null) {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:26px;height:26px;background:#1e40af;color:#fff;font-size:11px;
                             font-weight:700;display:flex;align-items:center;justify-content:center;
                             border:2px solid #fff;border-radius:5px">🏪</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13],
        }),
        interactive: false,
      }).addTo(capa.current)
      puntos.push([s.lat, s.lng])
    }

    for (const p of data.pedidos || []) {
      if (p.cliente_lat == null) continue
      const col = ETAPAS[p.estado]?.col || C.dim
      L.marker([p.cliente_lat, p.cliente_lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:15px;height:15px;border-radius:50%;background:${col};
                             border:2px solid #fff"></div>`,
          iconSize: [15, 15], iconAnchor: [7, 7],
        }),
      }).bindTooltip(`${p.numero_orden} · ${p.cliente_nombre || ''}`, { direction: 'top' })
        .addTo(capa.current)
      puntos.push([p.cliente_lat, p.cliente_lng])

      if (p.driver_lat != null) {
        L.polyline([[p.driver_lat, p.driver_lng], [p.cliente_lat, p.cliente_lng]],
          { color: C.rojo, weight: 2, opacity: .7, dashArray: '5,4' }).addTo(capa.current)
      }
    }

    for (const m of data.motoristas || []) {
      if (m.lat == null) continue
      L.marker([m.lat, m.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="display:flex;flex-direction:column;align-items:center">
                   <div style="width:26px;height:26px;border-radius:50%;
                               background:${m.en_ruta > 0 ? C.rojo : '#16a34a'};border:2px solid #fff;
                               display:flex;align-items:center;justify-content:center;font-size:13px">🛵</div>
                   <div style="background:rgba(0,0,0,.75);color:#fff;font-size:10px;padding:1px 5px;
                               border-radius:4px;margin-top:2px;white-space:nowrap">${(m.nombre || '').split(' ')[0]}</div>
                 </div>`,
          iconSize: [0, 0], iconAnchor: [13, 13],
        }),
        zIndexOffset: 500,
      }).addTo(capa.current)
      puntos.push([m.lat, m.lng])
    }

    if (!encuadrado.current && puntos.length) {
      encuadrado.current = true
      mapRef.current.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 14 })
    }
  }, [data])

  const pedidos = data?.pedidos || []
  const motoristas = data?.motoristas || []
  const met = data?.metricas || {}
  const porEstado = (k) => pedidos.filter(p => p.estado === k)

  // El motorista que está por llegar, que es lo que decide qué apurar
  const llegando = motoristas
    .filter(m => m.en_ruta > 0 && m.min_regreso != null)
    .sort((a, b) => a.min_regreso - b.min_regreso)[0] || null
  const listosParaEl = llegando
    ? pedidos.filter(p => p.estado === 'lista' && p.motorista_id === llegando.empleado_id).length
    : 0

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.texto,
                  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                    borderBottom: `1px solid ${C.borde}` }}>
        <button onClick={onBack}
          style={{ background: '#242430', color: C.texto, border: 'none', borderRadius: 8,
                   padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          ← Volver
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>🛵 Delivery de mi sucursal</div>
          <div style={{ fontSize: 12, color: C.dim }}>
            {data?.sucursal?.nombre || '…'} · {pedidos.length} activo(s) · {motoristas.length} motorista(s) en línea
          </div>
        </div>
        <button
          onClick={() => setSonido(v => { localStorage.setItem('kds_delivery_sonido', v ? '0' : '1'); return !v })}
          title="Sonido al entrar un pedido nuevo"
          style={{ marginLeft: 'auto', background: '#141418', border: `1px solid ${C.borde}`,
                   color: sonido ? C.verde : C.dim, borderRadius: 7, padding: '6px 10px',
                   fontSize: 11.5, cursor: 'pointer' }}>
          {sonido ? '🔔 Sonido activo' : '🔕 Sin sonido'}
        </button>
        {error && <div style={{ color: C.rojo, fontSize: 12 }}>⚠️ {error}</div>}
      </div>

      {/* Lo primero que tiene que ver: quién está por llegar y si hay algo listo
          para él. Es lo que decide si apura una comanda o no. */}
      {llegando && (
        <div style={{ margin: '12px 14px 0', background: '#2a1f08', border: `1px solid ${C.naranja}`,
                      borderRadius: 12, padding: '11px 14px', display: 'flex',
                      alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>🛵</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#ffd9a8' }}>
              {(llegando.nombre || '').split(' ')[0]} llega en {llegando.min_regreso} min
            </div>
            <div style={{ fontSize: 12.5, color: '#c9a97a', marginTop: 2 }}>
              {listosParaEl > 0
                ? `${listosParaEl} pedido${listosParaEl > 1 ? 's' : ''} listo${listosParaEl > 1 ? 's' : ''} para él`
                : 'No hay nada listo para él todavía'}
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.naranja }}>{llegando.min_regreso}′</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, padding: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        <div style={{ flex: '1 1 460px', minWidth: 320 }}>
          <div ref={mapEl} style={{ height: 420, borderRadius: 12, overflow: 'hidden',
                                    border: `1px solid ${C.borde}`, background: '#222' }} />

          {/* Motoristas: lo que cocina más pregunta es "¿en cuánto vuelve?" */}
          <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.borde}`,
                        borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.dim, fontWeight: 700, marginBottom: 8 }}>MOTORISTAS</div>
            {motoristas.length === 0 ? (
              <div style={{ fontSize: 13, color: C.dim }}>
                Ningún motorista de la sucursal está compartiendo GPS ahora.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {motoristas.map(m => (
                  <div key={m.empleado_id}
                       style={{ display: 'flex', alignItems: 'center', gap: 10,
                                background: '#141418', borderRadius: 9, padding: '9px 11px' }}>
                    <span style={{ fontSize: 18 }}>🛵</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{m.nombre}</div>
                      <div style={{ fontSize: 12, color: C.dim }}>
                        {m.en_ruta > 0
                          ? `${m.en_ruta} en la calle`
                          : m.asignados > 0 ? `${m.asignados} asignado(s), aún no sale` : 'Libre'}
                        {m.seg_desde_gps > 300 && (
                          <span style={{ color: C.amarillo }}> · GPS hace {Math.round(m.seg_desde_gps / 60)} min</span>
                        )}
                      </div>
                    </div>
                    {m.min_regreso != null && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 800,
                                      color: m.en_ruta > 0 ? C.amarillo : C.verde }}>
                          {m.en_ruta > 0 ? `${m.min_regreso} min` : 'en tienda'}
                        </div>
                        <div style={{ fontSize: 10.5, color: C.dim }}>
                          {m.en_ruta > 0 ? 'para volver' : `${m.min_regreso} min de distancia`}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Números del día: separan lo que es de cocina de lo que es del despacho */}
          <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.borde}`,
                        borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.dim, fontWeight: 700, marginBottom: 8 }}>HOY EN DELIVERY</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { t: 'Entregados', v: met.entregados_hoy ?? 0, col: C.verde },
                { t: 'Mi cocina', v: met.min_cocina != null ? `${met.min_cocina} min` : '—', col: C.azul },
                { t: 'Espera moto', v: met.min_espera_motorista != null ? `${met.min_espera_motorista} min` : '—', col: C.naranja },
              ].map(x => (
                <div key={x.t} style={{ flex: '1 1 70px', background: '#141418', borderRadius: 8,
                                        padding: '8px 9px', borderLeft: `3px solid ${x.col}` }}>
                  <div style={{ fontSize: 10.5, color: C.dim }}>{x.t}</div>
                  <div style={{ fontSize: 19, fontWeight: 800 }}>{x.v}</div>
                </div>
              ))}
            </div>
            {met.promedio_hora_historico != null && (
              <div style={{ fontSize: 11, color: C.dim, marginTop: 9, lineHeight: 1.5 }}>
                A esta hora suelen entrar <b style={{ color: C.texto }}>{met.promedio_hora_historico} pedidos</b>.
                {' '}Van {met.pedidos_esta_hora ?? 0}.
              </div>
            )}
          </div>
        </div>

        {/* Pedidos por etapa */}
        <div style={{ flex: '1 1 320px', minWidth: 290, display: 'flex',
                      flexDirection: 'column', gap: 10 }}>
          {Object.entries(ETAPAS).map(([k, meta]) => {
            const lista = k === 'preparando' ? ordenarCocina(porEstado(k)) : porEstado(k)
            return (
              <div key={k} style={{ background: C.card, border: `1px solid ${C.borde}`,
                                    borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.col }} />
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{meta.t}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: meta.col }}>
                    {lista.length}
                  </span>
                </div>

                {lista.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#55555f' }}>—</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {lista.map((p, idx) => {
                      const m = mins(p.etapa_desde, ahora)
                      const total = mins(p.created_at, ahora)
                      const tarde = m >= (LIMITE[k] || 20)
                      const enCocina = k === 'preparando'
                      // El primero de la cola de cocina se marca solo si hay un
                      // motorista viniendo por él: si no, no hay razón para apurarlo.
                      const urgente = enCocina && idx === 0 && p.min_regreso_motorista != null
                      return (
                        <div key={p.id} style={{ background: '#141418', borderRadius: 9,
                                                 padding: '8px 10px',
                                                 borderLeft: `3px solid ${urgente ? C.naranja : tarde ? C.rojo : meta.col}` }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            {enCocina && (
                              <span style={{ background: urgente ? C.naranja : '#2a2a33',
                                             color: urgente ? '#111' : C.dim, borderRadius: 5,
                                             padding: '1px 6px', fontSize: 11, fontWeight: 800 }}>
                                {idx + 1}º
                              </span>
                            )}
                            <span style={{ fontSize: 12.5, fontWeight: 800 }}>{p.numero_orden}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800,
                                           color: tarde ? C.rojo : C.dim }}>
                              {txtMin(m)}
                            </span>
                            <span style={{ fontSize: 10.5, color: C.dim }}>· total {txtMin(total)}</span>
                          </div>
                          <div style={{ fontSize: 12.5, marginTop: 2 }}>{p.cliente_nombre}</div>
                          <div style={{ fontSize: 11, color: C.dim, marginTop: 1, lineHeight: 1.35 }}>
                            {p.cliente_direccion}
                          </div>

                          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                            {urgente && (
                              <span style={{ fontSize: 11, color: C.naranja }}>
                                ⚡ {(p.motorista_nombre || '').split(' ')[0]} lo lleva y llega en {p.min_regreso_motorista} min
                              </span>
                            )}
                            {!urgente && p.motorista_nombre && (
                              <span style={{ fontSize: 11, color: C.verde }}>🛵 {p.motorista_nombre}</span>
                            )}
                            {enCocina && !p.motorista_nombre && (
                              <span style={{ fontSize: 11, color: C.dim }}>Sin motorista asignado todavía</span>
                            )}
                            {p.eta_min != null && p.estado === 'en_camino' && (
                              <span style={{ fontSize: 11, color: C.amarillo }}>🕐 llega en {p.eta_min} min</span>
                            )}
                            {k === 'lista' && tarde && (
                              <span style={{ fontSize: 11, color: C.rojo }}>🔥 Se está enfriando</span>
                            )}
                          </div>

                          {enCocina && (
                            <button
                              disabled={marcando === p.id}
                              onClick={() => marcarLista(p)}
                              style={{ width: '100%', marginTop: 8,
                                       background: urgente ? '#16a34a' : '#242430',
                                       color: urgente ? '#fff' : '#c9f2d6',
                                       border: urgente ? 'none' : '1px solid #2f5f3f',
                                       borderRadius: 8, padding: 9, fontSize: 13, fontWeight: 800,
                                       cursor: marcando === p.id ? 'default' : 'pointer',
                                       opacity: marcando === p.id ? .6 : 1 }}>
                              {marcando === p.id ? 'Marcando…' : '✅ Comida lista'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
