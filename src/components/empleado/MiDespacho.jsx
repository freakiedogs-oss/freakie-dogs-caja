import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../../supabase'
import { STORES } from '../../config'

/**
 * MiDespacho — Vista del motorista para el KPI de Despacho.
 *
 * Flujo:
 *  1. Motorista entra en casa matriz → ve botón "Marcar llegada" si está dentro del radio + dentro de horario
 *  2. Marca llegada (con GPS) → backend valida (radio, horario, no duplicado) y crea ciclo
 *  3. Si llegó tarde → debe ingresar motivo obligatorio antes de marcar salida
 *  4. Selecciona sucursales destino + (opcional) notas por sucursal y generales
 *  5. Marca salida → backend calcula tiempo + color semáforo
 *  6. Dentro de 5 min puede anular cualquier marcaje
 *
 * Roles habilitados: despachador (Israel), motorista (Ángel).
 */

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  purple: '#a78bfa', border: '#333', text: '#f0f0f0',
  textDim: '#888', textOff: '#555', gray: '#444',
}

const cardStyle = {
  background: c.card,
  border: `1px solid ${c.cardBorder}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
}

const btnBase = {
  width: '100%',
  padding: 16,
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 700,
  transition: '0.15s',
}

const btnPrimary = { ...btnBase, background: c.red, color: '#fff' }
const btnPrimaryDisabled = { ...btnBase, background: c.gray, color: c.textDim, cursor: 'not-allowed' }
const btnSecondary = { ...btnBase, background: c.input, color: c.text, border: `1px solid ${c.border}`, fontSize: 14 }
const btnSuccess = { ...btnBase, background: c.greenDark, color: '#fff' }

// Haversine — distancia metros entre dos coords
function distMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

// Hora local El Salvador (UTC-6)
function horaLocalSV() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return fmt.format(new Date()) // "HH:MM"
}

function fmtHora(iso) {
  if (!iso) return '--'
  return new Date(iso).toLocaleTimeString('es-SV', {
    timeZone: 'America/El_Salvador',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function minutosDesde(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
}

export default function MiDespacho({ user }) {
  // ── Datos base ──
  const [matriz, setMatriz] = useState(null)        // { lat, lng, radio_metros }
  const [config, setConfig] = useState(null)        // configuracion_despacho_kpi
  const [sucursales, setSucursales] = useState([])  // [{id, store_code, nombre}]
  const [activo, setActivo] = useState(null)        // despacho en_espera del motorista (si hay)
  const [historial, setHistorial] = useState([])    // últimos del día
  const [loading, setLoading] = useState(true)

  // ── GPS ──
  const [gps, setGps] = useState(null)              // { lat, lng, acc }
  const [gpsErr, setGpsErr] = useState('')
  const [reqGps, setReqGps] = useState(false)

  // ── UI ──
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)              // { tipo, texto } — 'ok' | 'err' | 'info'
  const [confirm, setConfirm] = useState(null)      // null | { tipo, payload }
  const [showMotivo, setShowMotivo] = useState(false)
  const [motivoTxt, setMotivoTxt] = useState('')
  const [selSucursales, setSelSucursales] = useState({})  // { sucId: { sel: bool, faltante: '' } }
  const [notasGenerales, setNotasGenerales] = useState('')
  const [, forceTick] = useState(0)  // re-render cada 30s para los timers

  const reloadRef = useRef(0)

  // ─────────────────────────────────────────────────────
  // Carga inicial
  // ─────────────────────────────────────────────────────
  const cargarTodo = useCallback(async () => {
    setLoading(true)
    const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0]
    const [
      { data: cfg },
      { data: sucsAll },
      { data: misDelDia },
    ] = await Promise.all([
      db.from('configuracion_despacho_kpi').select('*').eq('id', 1).single(),
      db.from('sucursales').select('id, store_code, nombre, lat, lng, radio_metros, activa').eq('activa', true).order('nombre'),
      db.from('v_despachos_kpi').select('*').eq('motorista_id', user.id).eq('fecha', today).order('numero_ciclo', { ascending: true }),
    ])
    setConfig(cfg || null)
    const matrizCode = cfg?.matriz_store_code || 'CM001'
    const matrizRow = (sucsAll || []).find(s => s.store_code === matrizCode)
    setMatriz(matrizRow || null)
    // Sucursales destino = todas las activas EXCEPTO la matriz
    setSucursales((sucsAll || []).filter(s => s.store_code !== matrizCode))
    setActivo((misDelDia || []).find(r => r.estado === 'en_espera') || null)
    setHistorial((misDelDia || []).filter(r => r.estado !== 'en_espera'))
    setLoading(false)
  }, [user.id])

  useEffect(() => { cargarTodo() }, [cargarTodo, reloadRef.current])

  // Tick cada 20s para refrescar contadores en pantalla
  useEffect(() => {
    const t = setInterval(() => forceTick(x => x + 1), 20000)
    return () => clearInterval(t)
  }, [])

  // ─────────────────────────────────────────────────────
  // GPS
  // ─────────────────────────────────────────────────────
  const pedirGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsErr('Tu navegador no soporta GPS')
      return Promise.resolve(null)
    }
    setReqGps(true)
    setGpsErr('')
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
          setGps(coords)
          setReqGps(false)
          resolve(coords)
        },
        err => {
          setReqGps(false)
          setGpsErr('No se pudo obtener GPS: ' + (err.message || 'permiso denegado'))
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
      )
    })
  }

  // ─────────────────────────────────────────────────────
  // Cálculos derivados
  // ─────────────────────────────────────────────────────
  const horaActual = horaLocalSV()
  const enHorario = config
    ? horaActual >= config.horario_marcaje_inicio.slice(0, 5) && horaActual <= config.horario_marcaje_fin.slice(0, 5)
    : false

  const distancia = (gps && matriz)
    ? distMetros(gps.lat, gps.lng, matriz.lat, matriz.lng)
    : null
  const radioMatriz = matriz?.radio_metros ?? 300
  const dentroRadio = distancia !== null && distancia <= radioMatriz

  // ─────────────────────────────────────────────────────
  // Acciones
  // ─────────────────────────────────────────────────────
  const marcarLlegada = async () => {
    setBusy(true); setMsg(null)
    const coords = gps || (await pedirGps())
    if (!coords) { setBusy(false); return }

    const { data, error } = await db.rpc('fn_marcar_llegada_despacho', {
      p_motorista_id: user.id,
      p_lat: coords.lat,
      p_lng: coords.lng,
    })
    setBusy(false)
    if (error) { setMsg({ tipo: 'err', texto: 'Error: ' + error.message }); return }
    if (!data?.ok) { setMsg({ tipo: 'err', texto: data?.error || 'No se pudo marcar' }); return }

    setMsg({ tipo: 'ok', texto: `✓ Llegada registrada (ciclo ${data.numero_ciclo})` })
    if (data.pide_motivo_tardanza) {
      setShowMotivo(true)
      setMotivoTxt('')
    }
    reloadRef.current++
    cargarTodo()
  }

  const guardarMotivoTardanza = async () => {
    if (!activo) return
    if (motivoTxt.trim().length < 3) { setMsg({ tipo: 'err', texto: 'Mínimo 3 caracteres' }); return }
    setBusy(true)
    const { data, error } = await db.rpc('fn_set_motivo_tardanza_despacho', {
      p_despacho_id: activo.id,
      p_motivo: motivoTxt,
    })
    setBusy(false)
    if (error || !data?.ok) { setMsg({ tipo: 'err', texto: data?.error || error?.message || 'Error' }); return }
    setShowMotivo(false)
    setMotivoTxt('')
    setMsg({ tipo: 'ok', texto: '✓ Motivo guardado' })
    reloadRef.current++
    cargarTodo()
  }

  const marcarSalida = async () => {
    const arr = Object.entries(selSucursales)
      .filter(([, v]) => v.sel)
      .map(([id, v]) => ({ sucursal_id: id, producto_faltante: v.faltante || null }))
    if (arr.length === 0) { setMsg({ tipo: 'err', texto: 'Debes seleccionar al menos una sucursal' }); return }
    if (activo?.llego_tarde && !activo?.motivo_tardanza) {
      setMsg({ tipo: 'err', texto: 'Debes registrar el motivo de tardanza primero' })
      setShowMotivo(true)
      return
    }

    setBusy(true); setMsg(null)
    const coords = await pedirGps()
    if (!coords) { setBusy(false); return }

    const { data, error } = await db.rpc('fn_marcar_salida_despacho', {
      p_despacho_id: activo.id,
      p_lat: coords.lat,
      p_lng: coords.lng,
      p_sucursales: arr,
      p_notas_generales: notasGenerales.trim() || null,
    })
    setBusy(false)
    if (error) { setMsg({ tipo: 'err', texto: 'Error: ' + error.message }); return }
    if (!data?.ok) { setMsg({ tipo: 'err', texto: data?.error || 'No se pudo marcar salida' }); return }

    const color = data.color
    const colorEmoji = color === 'verde' ? '🟢' : color === 'amarillo' ? '🟡' : '🔴'
    setMsg({
      tipo: 'ok',
      texto: `${colorEmoji} Despacho registrado: ${data.tiempo_despacho_minutos} min (${color})`,
    })
    setSelSucursales({})
    setNotasGenerales('')
    reloadRef.current++
    cargarTodo()
  }

  const anularMarcaje = async (despachoId) => {
    setBusy(true); setMsg(null)
    const { data, error } = await db.rpc('fn_anular_marcaje_despacho', {
      p_despacho_id: despachoId,
      p_motorista_id: user.id,
    })
    setBusy(false)
    if (error || !data?.ok) { setMsg({ tipo: 'err', texto: data?.error || error?.message || 'Error' }); return }
    setMsg({ tipo: 'ok', texto: '✓ Marcaje anulado' })
    reloadRef.current++
    cargarTodo()
  }

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 20, color: c.textDim, textAlign: 'center' }}>Cargando…</div>
  }

  // Validar rol — la sidebar ya filtra, pero por las dudas
  const rolesPermitidos = ['despachador', 'motorista']
  if (!rolesPermitidos.includes(user.rol) && user.rol !== 'superadmin') {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ ...cardStyle, borderColor: c.red, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚫</div>
          <div style={{ color: c.text, fontWeight: 700 }}>Vista solo para motoristas</div>
          <div style={{ color: c.textDim, fontSize: 13, marginTop: 6 }}>Tu rol: {user.rol}</div>
        </div>
      </div>
    )
  }

  const motivoBloqueante = activo?.llego_tarde && !activo?.motivo_tardanza

  return (
    <div style={{ background: c.bg, minHeight: '100vh', padding: 12, color: c.text, maxWidth: 520, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ ...cardStyle, background: 'linear-gradient(135deg, #1a1a1a 0%, #232323 100%)' }}>
        <div style={{ fontSize: 13, color: c.textDim }}>Motorista</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{user.nombre} {user.apellido || ''}</div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: c.textDim }}>
          <span>Hora: <strong style={{ color: c.text }}>{horaActual}</strong></span>
          <span>Ventana: {config?.horario_marcaje_inicio?.slice(0, 5)} – {config?.horario_marcaje_fin?.slice(0, 5)}</span>
        </div>
      </div>

      {/* Mensaje */}
      {msg && (
        <div style={{
          ...cardStyle,
          background: msg.tipo === 'ok' ? '#0f3a26' : msg.tipo === 'err' ? '#3a0f0f' : '#1a2a3a',
          borderColor: msg.tipo === 'ok' ? c.green : msg.tipo === 'err' ? c.red : c.blue,
          color: '#fff', fontSize: 14,
        }}>
          {msg.texto}
        </div>
      )}

      {/* GPS card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 700 }}>📍 Ubicación</span>
          <button onClick={pedirGps} disabled={reqGps} style={{ ...btnSecondary, width: 'auto', padding: '6px 12px' }}>
            {reqGps ? 'Buscando…' : (gps ? 'Actualizar' : 'Obtener GPS')}
          </button>
        </div>
        {gpsErr && <div style={{ color: c.red, fontSize: 13 }}>{gpsErr}</div>}
        {gps && matriz && (
          <div style={{ fontSize: 13, color: c.textDim, lineHeight: 1.6 }}>
            <div>Distancia a matriz: <strong style={{ color: dentroRadio ? c.green : c.red }}>{distancia}m</strong> (radio {radioMatriz}m)</div>
            <div>Precisión GPS: ±{Math.round(gps.acc)}m</div>
            <div style={{ marginTop: 4, color: dentroRadio ? c.green : c.red, fontWeight: 600 }}>
              {dentroRadio ? '✓ Dentro de casa matriz' : '✗ Fuera del radio'}
            </div>
          </div>
        )}
        {!gps && !gpsErr && (
          <div style={{ color: c.textDim, fontSize: 13 }}>
            Tocá "Obtener GPS" para validar que estás en casa matriz.
          </div>
        )}
      </div>

      {/* ── Si NO hay despacho activo: botón Marcar llegada ── */}
      {!activo && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>PASO 1 · Marcar llegada</div>
          <div style={{ color: c.textDim, fontSize: 13, marginBottom: 12 }}>
            Cuando llegues a casa matriz, tocá el botón para registrar tu llegada.
          </div>
          {!enHorario && (
            <div style={{ color: c.yellow, fontSize: 13, marginBottom: 12 }}>
              ⚠ Fuera del horario de marcaje ({config?.horario_marcaje_inicio?.slice(0, 5)} – {config?.horario_marcaje_fin?.slice(0, 5)})
            </div>
          )}
          <button
            disabled={busy || !enHorario || !gps || !dentroRadio}
            onClick={() => setConfirm({ tipo: 'llegada' })}
            style={busy || !enHorario || !gps || !dentroRadio ? btnPrimaryDisabled : btnPrimary}
          >
            {busy ? '...' : '🚚 Marcar llegada'}
          </button>
          {!gps && enHorario && <div style={{ color: c.textDim, fontSize: 12, marginTop: 8, textAlign: 'center' }}>Necesitás obtener GPS primero</div>}
          {gps && !dentroRadio && enHorario && <div style={{ color: c.red, fontSize: 12, marginTop: 8, textAlign: 'center' }}>Estás a {distancia}m — acercate a casa matriz</div>}
        </div>
      )}

      {/* ── Despacho activo (en_espera) ── */}
      {activo && (
        <>
          {/* Card de estado */}
          <div style={{ ...cardStyle, borderColor: c.yellow, background: '#1f1a0a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 12, color: c.textDim }}>Ciclo #{activo.numero_ciclo} · En espera</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: c.yellow, marginTop: 2 }}>
                  ⏱ {minutosDesde(activo.hora_llegada)} min
                </div>
                <div style={{ fontSize: 13, color: c.textDim, marginTop: 4 }}>
                  Llegaste: <strong style={{ color: c.text }}>{fmtHora(activo.hora_llegada)}</strong>
                </div>
                {activo.llego_tarde && (
                  <div style={{ marginTop: 6, color: c.orange, fontSize: 13 }}>
                    🕐 Llegaste tarde · {activo.motivo_tardanza ? '✓ Motivo registrado' : '⚠ Falta motivo'}
                  </div>
                )}
              </div>
              {/* Botón anular si <5 min */}
              {minutosDesde(activo.hora_llegada) < (config?.minutos_anulacion || 5) && (
                <button
                  onClick={() => setConfirm({ tipo: 'anular', payload: activo.id })}
                  disabled={busy}
                  style={{ ...btnSecondary, width: 'auto', padding: '6px 12px', color: c.red, borderColor: c.red }}
                >
                  Anular
                </button>
              )}
            </div>
          </div>

          {/* Motivo de tardanza (si aplica) */}
          {motivoBloqueante && !showMotivo && (
            <button onClick={() => setShowMotivo(true)} style={{ ...btnPrimary, background: c.orange, marginBottom: 12 }}>
              Registrar motivo de tardanza →
            </button>
          )}
          {showMotivo && (
            <div style={{ ...cardStyle, borderColor: c.orange }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: c.orange }}>¿Por qué llegaste tarde?</div>
              <textarea
                value={motivoTxt}
                onChange={e => setMotivoTxt(e.target.value)}
                placeholder="Ej: Tráfico en Santa Tecla, llanta pinchada..."
                rows={3}
                style={{
                  width: '100%', background: c.input, color: c.text, border: `1px solid ${c.border}`,
                  borderRadius: 8, padding: 10, fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowMotivo(false)} disabled={busy} style={{ ...btnSecondary, flex: 1 }}>Cancelar</button>
                <button onClick={guardarMotivoTardanza} disabled={busy} style={{ ...btnSuccess, flex: 2 }}>Guardar motivo</button>
              </div>
            </div>
          )}

          {/* PASO 2: Seleccionar sucursales + marcar salida */}
          {!motivoBloqueante && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>PASO 2 · Marcar salida</div>
              <div style={{ color: c.textDim, fontSize: 13, marginBottom: 12 }}>
                Seleccioná las sucursales que llevás en este despacho.
              </div>

              {sucursales.map(suc => {
                const v = selSucursales[suc.id] || { sel: false, faltante: '' }
                return (
                  <div key={suc.id} style={{ marginBottom: 10, padding: 10, background: c.input, borderRadius: 8, border: `1px solid ${v.sel ? c.green : c.border}` }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={v.sel}
                        onChange={() => setSelSucursales(s => ({
                          ...s,
                          [suc.id]: { sel: !v.sel, faltante: v.faltante },
                        }))}
                        style={{ width: 22, height: 22 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{suc.nombre}</div>
                        <div style={{ fontSize: 11, color: c.textDim }}>{suc.store_code}</div>
                      </div>
                    </label>
                    {v.sel && (
                      <input
                        type="text"
                        value={v.faltante}
                        onChange={e => setSelSucursales(s => ({
                          ...s,
                          [suc.id]: { ...v, faltante: e.target.value },
                        }))}
                        placeholder={`¿Faltó algún producto para ${suc.nombre}?`}
                        style={{
                          width: '100%', marginTop: 8, background: c.card, color: c.text,
                          border: `1px solid ${c.border}`, borderRadius: 6, padding: 8, fontSize: 13, boxSizing: 'border-box',
                        }}
                      />
                    )}
                  </div>
                )
              })}

              <textarea
                value={notasGenerales}
                onChange={e => setNotasGenerales(e.target.value)}
                placeholder="Notas generales (opcional)"
                rows={2}
                style={{
                  width: '100%', marginTop: 8, background: c.input, color: c.text,
                  border: `1px solid ${c.border}`, borderRadius: 8, padding: 10, fontSize: 13,
                  fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
                }}
              />

              <button
                disabled={busy || Object.values(selSucursales).filter(v => v.sel).length === 0}
                onClick={() => setConfirm({ tipo: 'salida' })}
                style={
                  busy || Object.values(selSucursales).filter(v => v.sel).length === 0
                    ? btnPrimaryDisabled
                    : { ...btnPrimary, background: c.green, color: '#000', marginTop: 12 }
                }
              >
                {busy ? '...' : '✅ Marcar salida / Despachado'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Historial del día */}
      {historial.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Hoy ({historial.length})</div>
          {historial.map(d => {
            const color = d.color_semaforo === 'verde' ? c.green
              : d.color_semaforo === 'amarillo' ? c.yellow
              : d.color_semaforo === 'rojo' ? c.red : c.textOff
            const emoji = d.color_semaforo === 'verde' ? '🟢'
              : d.color_semaforo === 'amarillo' ? '🟡'
              : d.color_semaforo === 'rojo' ? '🔴'
              : d.estado === 'anulado' ? '⚫' : '⏳'
            const minSinceSalida = d.hora_salida ? minutosDesde(d.hora_salida) : null
            const puedeAnular = d.estado !== 'anulado' && minSinceSalida !== null && minSinceSalida < (config?.minutos_anulacion || 5)
            return (
              <div key={d.id} style={{ padding: 10, background: c.input, borderRadius: 8, marginBottom: 8, borderLeft: `3px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 18, marginRight: 6 }}>{emoji}</span>
                    <strong>Ciclo {d.numero_ciclo}</strong>
                    <span style={{ color: c.textDim, fontSize: 12, marginLeft: 8 }}>
                      {fmtHora(d.hora_llegada)} → {fmtHora(d.hora_salida)}
                    </span>
                  </div>
                  <span style={{ color, fontWeight: 700 }}>
                    {d.estado === 'anulado' ? 'Anulado' : `${d.tiempo_despacho_minutos} min`}
                  </span>
                </div>
                {d.sucursales && d.sucursales.length > 0 && (
                  <div style={{ fontSize: 12, color: c.textDim, marginTop: 4 }}>
                    📍 {d.sucursales.map(s => s.sucursal_nombre).join(' · ')}
                  </div>
                )}
                {puedeAnular && (
                  <button
                    onClick={() => setConfirm({ tipo: 'anular', payload: d.id })}
                    style={{ ...btnSecondary, width: 'auto', padding: '4px 10px', fontSize: 12, marginTop: 6, color: c.red, borderColor: c.red }}
                  >
                    Anular ({(config?.minutos_anulacion || 5) - minSinceSalida} min)
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal confirmación */}
      {confirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100,
        }} onClick={() => setConfirm(null)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12,
              padding: 20, maxWidth: 400, width: '100%',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
              {confirm.tipo === 'llegada' && '¿Confirmás que llegaste a casa matriz?'}
              {confirm.tipo === 'salida' && '¿Confirmás que ya te despacharon?'}
              {confirm.tipo === 'anular' && '¿Anular este marcaje?'}
            </div>
            {confirm.tipo === 'salida' && (
              <div style={{ color: c.textDim, fontSize: 13, marginBottom: 12 }}>
                Llevás: {Object.entries(selSucursales).filter(([, v]) => v.sel)
                  .map(([id]) => sucursales.find(s => s.id === id)?.nombre).filter(Boolean).join(', ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirm(null)} disabled={busy} style={{ ...btnSecondary, flex: 1 }}>Cancelar</button>
              <button
                disabled={busy}
                onClick={async () => {
                  const t = confirm.tipo, p = confirm.payload
                  setConfirm(null)
                  if (t === 'llegada') return marcarLlegada()
                  if (t === 'salida') return marcarSalida()
                  if (t === 'anular') return anularMarcaje(p)
                }}
                style={{ ...btnPrimary, flex: 2 }}
              >
                Sí, confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
