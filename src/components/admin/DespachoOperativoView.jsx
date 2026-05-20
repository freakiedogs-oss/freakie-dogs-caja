import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../../supabase'

/**
 * DespachoOperativoView — Pantalla para encargados de bodega
 * (Marcos, Denny, Jessica) — NO es el dashboard de KPI.
 *
 * - Ve despachos del día (en_espera + despachados + anulados).
 * - Alerta visual cuando un motorista lleva >45min en espera.
 * - Click en un despacho permite justificar el retraso:
 *     obligatorio si tiempo > tiempo_max_amarillo_min (rojo)
 *     opcional caso contrario
 * - NO ve el dashboard de KPI.
 * - NO puede editar/eliminar marcajes del motorista.
 *
 * Roles habilitados: jefe_casa_matriz, produccion, superadmin.
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

const btn = {
  padding: '10px 16px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  transition: '0.15s',
}

const CATEGORIAS = [
  { value: 'falta_producto',   label: 'Faltaba producto en bodega' },
  { value: 'error_pedido',     label: 'Error en el pedido, se tuvo que rehacer' },
  { value: 'motorista_tarde',  label: 'Motorista llegó tarde' },
  { value: 'problema_sistema', label: 'Problema con el sistema/facturación' },
  { value: 'mucho_volumen',    label: 'Mucho volumen de producto' },
  { value: 'otro',             label: 'Otro' },
]

function fmtHora(iso) {
  if (!iso) return '--'
  return new Date(iso).toLocaleTimeString('es-SV', {
    timeZone: 'America/El_Salvador',
    hour: '2-digit', minute: '2-digit',
  })
}

function minutosDesde(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
}

function colorPara(color) {
  if (color === 'verde')    return c.green
  if (color === 'amarillo') return c.yellow
  if (color === 'rojo')     return c.red
  if (color === 'gris')     return c.textOff
  return c.blue  // pendiente
}

function emojiPara(estado, color) {
  if (estado === 'anulado')      return '⚫'
  if (estado === 'en_espera')    return '⏳'
  if (color === 'verde')         return '🟢'
  if (color === 'amarillo')      return '🟡'
  if (color === 'rojo')          return '🔴'
  return '·'
}

export default function DespachoOperativoView({ user }) {
  const [registros, setRegistros] = useState([])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [modalJustif, setModalJustif] = useState(null)  // null | despacho
  const [justifCat, setJustifCat] = useState('falta_producto')
  const [justifTxt, setJustifTxt] = useState('')
  const [, forceTick] = useState(0)
  const reloadRef = useRef(0)

  const cargar = useCallback(async () => {
    const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0]
    const [{ data: cfg }, { data: regs }] = await Promise.all([
      db.from('configuracion_despacho_kpi').select('*').eq('id', 1).single(),
      db.from('v_despachos_kpi')
        .select('*')
        .eq('fecha', today)
        .order('hora_llegada', { ascending: false }),
    ])
    setConfig(cfg || null)
    setRegistros(regs || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar, reloadRef.current])

  // Polling cada 20s para refrescar contadores + nuevos despachos
  useEffect(() => {
    const t = setInterval(() => {
      cargar()
      forceTick(x => x + 1)
    }, 20000)
    return () => clearInterval(t)
  }, [cargar])

  // Validar rol
  const rolesPermitidos = ['jefe_casa_matriz', 'produccion', 'superadmin']
  if (!rolesPermitidos.includes(user.rol)) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ ...cardStyle, borderColor: c.red, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚫</div>
          <div style={{ color: c.text, fontWeight: 700 }}>Vista solo para encargados de bodega</div>
          <div style={{ color: c.textDim, fontSize: 13, marginTop: 6 }}>Tu rol: {user.rol}</div>
        </div>
      </div>
    )
  }

  if (loading) return <div style={{ padding: 20, color: c.textDim, textAlign: 'center' }}>Cargando…</div>

  const tiempoMaxAmarillo = config?.tiempo_max_amarillo_min || 45

  // Despachos en espera + minutos
  const enEspera = registros.filter(r => r.estado === 'en_espera')
  const alertas = enEspera.filter(r => minutosDesde(r.hora_llegada) > tiempoMaxAmarillo)

  // Stats del día
  const hoy = registros.filter(r => r.estado === 'despachado')
  const verdes    = hoy.filter(r => r.color_semaforo === 'verde').length
  const amarillos = hoy.filter(r => r.color_semaforo === 'amarillo').length
  const rojos     = hoy.filter(r => r.color_semaforo === 'rojo').length
  const promedio  = hoy.length > 0
    ? (hoy.reduce((s, r) => s + Number(r.tiempo_despacho_minutos || 0), 0) / hoy.length).toFixed(1)
    : null

  const abrirJustif = (despacho) => {
    const just = despacho.justificacion
    setModalJustif(despacho)
    setJustifCat(just?.categoria || 'falta_producto')
    setJustifTxt(just?.detalle || '')
  }

  const guardarJustif = async () => {
    if (!modalJustif) return
    const obligatoriaActiva = modalJustif.tiempo_despacho_minutos > tiempoMaxAmarillo
    if (obligatoriaActiva && justifTxt.trim().length < 3) {
      setMsg({ tipo: 'err', texto: 'En despachos rojos, el detalle es obligatorio (mínimo 3 caracteres)' })
      return
    }
    setBusy(true)
    const { data, error } = await db.rpc('fn_justificar_retraso_despacho', {
      p_despacho_id:  modalJustif.id,
      p_encargado_id: user.id,
      p_categoria:    justifCat,
      p_detalle:      justifTxt || null,
    })
    setBusy(false)
    if (error || !data?.ok) {
      setMsg({ tipo: 'err', texto: data?.error || error?.message || 'Error al guardar' })
      return
    }
    setMsg({ tipo: 'ok', texto: '✓ Justificación guardada' })
    setModalJustif(null); setJustifTxt(''); setJustifCat('falta_producto')
    reloadRef.current++
    cargar()
  }

  return (
    <div style={{ background: c.bg, minHeight: '100vh', padding: 16, color: c.text, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: c.textDim }}>Operación · Hoy</div>
        <h2 style={{ margin: '4px 0 4px', fontSize: 22 }}>Despachos a Motoristas</h2>
        <div style={{ fontSize: 13, color: c.textDim }}>
          {user.nombre} · {user.rol} — refresca cada 20s
        </div>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div style={{
          ...cardStyle, borderColor: c.red, background: '#2a0e0e',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 28 }}>⚠️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: c.red, fontSize: 16 }}>
              {alertas.length === 1 ? '1 motorista lleva' : `${alertas.length} motoristas llevan`} más de {tiempoMaxAmarillo} min esperando
            </div>
            <div style={{ color: c.textDim, fontSize: 13, marginTop: 4 }}>
              {alertas.map(a => `${a.motorista_nombre} (${minutosDesde(a.hora_llegada)}m)`).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* KPIs rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>En espera</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: enEspera.length > 0 ? c.yellow : c.textDim }}>{enEspera.length}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Promedio</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{promedio || '—'}<span style={{ fontSize: 14, color: c.textDim }}> min</span></div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🟢 Verde</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: c.green }}>{verdes}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🟡 Amarillo</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: c.yellow }}>{amarillos}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🔴 Rojo</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: c.red }}>{rojos}</div>
        </div>
      </div>

      {msg && (
        <div style={{
          ...cardStyle,
          background: msg.tipo === 'ok' ? '#0f3a26' : '#3a0f0f',
          borderColor: msg.tipo === 'ok' ? c.green : c.red,
          color: '#fff', fontSize: 14,
        }}>
          {msg.texto}
        </div>
      )}

      {/* Lista de despachos */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Despachos de hoy ({registros.length})</div>
        {registros.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>
            No hay despachos registrados hoy.
          </div>
        )}
        {registros.map(d => {
          const color = colorPara(d.color_semaforo)
          const emoji = emojiPara(d.estado, d.color_semaforo)
          const minEspera = d.estado === 'en_espera' ? minutosDesde(d.hora_llegada) : null
          const justObligatoria = d.estado === 'despachado' && d.color_semaforo === 'rojo'
          const yaJustificado = !!d.justificacion
          return (
            <div
              key={d.id}
              style={{
                padding: 12, background: c.input, borderRadius: 8, marginBottom: 8,
                borderLeft: `4px solid ${color}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 18 }}>{emoji}</span>
                    <strong style={{ fontSize: 15 }}>{d.motorista_nombre}</strong>
                    <span style={{ color: c.textDim, fontSize: 12 }}>· Ciclo {d.numero_ciclo}</span>
                    {d.llego_tarde && (
                      <span style={{ background: c.orange, color: '#000', fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                        TARDE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: c.textDim, marginTop: 4 }}>
                    Llegada: <strong style={{ color: c.text }}>{fmtHora(d.hora_llegada)}</strong>
                    {d.hora_salida && (
                      <> · Salida: <strong style={{ color: c.text }}>{fmtHora(d.hora_salida)}</strong></>
                    )}
                    {minEspera !== null && (
                      <> · <span style={{ color: minEspera > tiempoMaxAmarillo ? c.red : c.yellow, fontWeight: 700 }}>
                        ⏱ {minEspera} min esperando
                      </span></>
                    )}
                  </div>
                  {d.sucursales && d.sucursales.length > 0 && (
                    <div style={{ fontSize: 12, color: c.textDim, marginTop: 4 }}>
                      📍 {d.sucursales.map(s => s.sucursal_nombre).join(' · ')}
                    </div>
                  )}
                  {d.llego_tarde && d.motivo_tardanza && (
                    <div style={{ fontSize: 12, color: c.orange, marginTop: 4, fontStyle: 'italic' }}>
                      🕐 Motivo tardanza: "{d.motivo_tardanza}"
                    </div>
                  )}
                  {/* Producto faltante */}
                  {d.sucursales && d.sucursales.some(s => s.producto_faltante) && (
                    <div style={{ fontSize: 12, color: c.yellow, marginTop: 4 }}>
                      📦 Faltantes:{' '}
                      {d.sucursales.filter(s => s.producto_faltante).map(s => `${s.sucursal_nombre}: ${s.producto_faltante}`).join(' · ')}
                    </div>
                  )}
                  {d.notas_generales && (
                    <div style={{ fontSize: 12, color: c.textDim, marginTop: 4, fontStyle: 'italic' }}>
                      Nota: "{d.notas_generales}"
                    </div>
                  )}
                  {d.justificacion && (
                    <div style={{ fontSize: 12, color: c.blue, marginTop: 6 }}>
                      💬 <strong>{d.justificacion.categoria}</strong>
                      {d.justificacion.detalle && `: "${d.justificacion.detalle}"`}
                      <span style={{ color: c.textDim }}> — {d.justificacion.encargado_nombre}</span>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color, fontSize: 20, fontWeight: 800 }}>
                    {d.estado === 'anulado' ? 'Anulado'
                      : d.tiempo_despacho_minutos !== null && d.tiempo_despacho_minutos !== undefined
                        ? `${d.tiempo_despacho_minutos} min`
                        : '⏳'}
                  </div>
                  {d.estado === 'despachado' && (
                    <button
                      onClick={() => abrirJustif(d)}
                      style={{
                        ...btn,
                        marginTop: 6,
                        background: justObligatoria && !yaJustificado ? c.red : c.input,
                        color: justObligatoria && !yaJustificado ? '#fff' : c.text,
                        border: `1px solid ${justObligatoria && !yaJustificado ? c.red : c.border}`,
                        fontSize: 12,
                      }}
                    >
                      {yaJustificado ? '✏️ Editar' : justObligatoria ? '⚠ Justificar (obligatorio)' : 'Justificar'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal de justificación */}
      {modalJustif && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100,
          }}
          onClick={() => setModalJustif(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12,
            padding: 20, maxWidth: 500, width: '100%',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              Justificar despacho — {modalJustif.motorista_nombre}
            </div>
            <div style={{ fontSize: 13, color: c.textDim, marginBottom: 12 }}>
              {modalJustif.tiempo_despacho_minutos} min · {modalJustif.color_semaforo}
              {modalJustif.color_semaforo === 'rojo' && (
                <span style={{ color: c.red, fontWeight: 700 }}> · justificación obligatoria</span>
              )}
            </div>

            <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>Categoría</label>
            <select
              value={justifCat}
              onChange={e => setJustifCat(e.target.value)}
              style={{
                width: '100%', background: c.input, color: c.text, border: `1px solid ${c.border}`,
                borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 12, boxSizing: 'border-box',
              }}
            >
              {CATEGORIAS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>
              Detalle {modalJustif.color_semaforo === 'rojo' ? '(obligatorio)' : '(opcional)'}
            </label>
            <textarea
              value={justifTxt}
              onChange={e => setJustifTxt(e.target.value)}
              placeholder="Explicá qué pasó…"
              rows={4}
              style={{
                width: '100%', background: c.input, color: c.text, border: `1px solid ${c.border}`,
                borderRadius: 8, padding: 10, fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => setModalJustif(null)}
                disabled={busy}
                style={{ ...btn, flex: 1, background: c.input, color: c.text, border: `1px solid ${c.border}` }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarJustif}
                disabled={busy}
                style={{ ...btn, flex: 2, background: c.green, color: '#000' }}
              >
                {busy ? 'Guardando…' : 'Guardar justificación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
