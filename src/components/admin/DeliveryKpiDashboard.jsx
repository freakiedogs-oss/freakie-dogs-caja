import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'
import InfoTip from '../ui/InfoTip'

/**
 * DeliveryKpiDashboard — Informe ejecutivo de Delivery Propio.
 * VISIBLE SOLO PARA superadmin (Cesar).
 *
 * Lee de `quanto_ordenes` con canal_venta='delivery_propio' (via RPCs).
 * NO crea datos — solo consulta y proyecta.
 *
 * Funcionalidades:
 *  - 6 KPI cards (acumulado, proyección con semáforo, meta, % avance, pedidos, ticket prom)
 *  - Gráfica SVG custom: línea sólida (real) + punteada (proyección) + meta horizontal + área
 *  - Ranking por sucursal con sparkline + crecimiento vs mismos N días mes anterior
 *  - Tabla detalle diario con fines de semana resaltados
 *  - Top productos del mes
 *  - Modal para ajustar meta manualmente
 *  - Exportar CSV
 *  - Alertas: días sin datos, mejor/peor día, promedio L-V vs S-D
 */

const c = {
  bg: '#0a0a0a', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  purple: '#a78bfa', border: '#333', text: '#f0f0f0',
  textDim: '#888', textOff: '#555',
}

const cardStyle = {
  background: c.card, border: `1px solid ${c.cardBorder}`,
  borderRadius: 12, padding: 16, marginBottom: 12,
}

const btn = {
  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600, transition: '0.15s',
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS_CORTO = { 0:'Dom', 1:'Lun', 2:'Mar', 3:'Mié', 4:'Jue', 5:'Vie', 6:'Sáb' }

function fmtUSD(v) {
  return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtUSDInt(v) {
  return '$' + Math.round(Number(v) || 0).toLocaleString('en-US')
}
function fmtFecha(iso) {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', {
    day: '2-digit', month: 'short',
  })
}
function fmtFechaLarga(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return DIAS_CORTO[d.getDay()] + ' ' + d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })
}
function semaforoEmoji(s) {
  if (s === 'verde') return '🟢'
  if (s === 'amarillo') return '🟡'
  if (s === 'rojo') return '🔴'
  return '⚪'
}
function semaforoColor(s) {
  if (s === 'verde') return c.green
  if (s === 'amarillo') return c.yellow
  if (s === 'rojo') return c.red
  return c.textOff
}
function diaSemanaIdx(iso) {
  return new Date(iso + 'T12:00:00').getDay() // 0=dom, 6=sáb
}
function esFinde(iso) {
  const d = diaSemanaIdx(iso)
  return d === 0 || d === 6
}

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ────────────────────────────────────────────────────────────
// Gráfica SVG custom: línea sólida (real) + punteada (proyección) + meta horizontal + área
// ────────────────────────────────────────────────────────────
function GraficaProyeccion({ data, periodo, meta, promedios, semaforo }) {
  if (!data || data.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>Sin datos para el período</div>
  }
  const W = 1100, H = 360
  const padL = 60, padR = 30, padT = 20, padB = 50
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const diasMes = periodo.dias_mes
  const hoyDate = new Date(periodo.hoy + 'T12:00:00')
  const inicioDate = new Date(periodo.inicio + 'T12:00:00')
  const diaActual = Math.floor((hoyDate - inicioDate) / (1000*60*60*24)) + 1  // 1..diasMes

  // Construir serie acumulada real (día por día)
  const dataMap = new Map(data.map(d => [d.fecha, d]))
  const acumPorDia = []
  let acum = 0
  for (let i = 1; i <= diasMes; i++) {
    const date = new Date(inicioDate)
    date.setDate(date.getDate() + (i - 1))
    const iso = date.toISOString().split('T')[0]
    const reg = dataMap.get(iso)
    const monto = reg ? Number(reg.monto) : 0
    const esFuturo = i > diaActual
    if (reg) acum += monto
    acumPorDia.push({
      dia: i,
      iso,
      monto_dia: monto,
      acumulado: esFuturo ? null : acum,  // null para días que no llegamos aún
      es_finde: [0,6].includes(date.getDay()),
      tieneData: !!reg,
      esFuturo,
    })
  }

  // Construir línea de proyección (desde hoy hasta fin de mes)
  let acumProy = acum  // arranca en lo real al día actual
  const proyeccion = []
  for (let i = diaActual; i <= diasMes; i++) {
    const date = new Date(inicioDate)
    date.setDate(date.getDate() + (i - 1))
    const dow = date.getDay()
    const esFinde = dow === 0 || dow === 6
    if (i === diaActual) {
      // punto donde la línea sólida termina = punto donde la punteada arranca
      proyeccion.push({ dia: i, acumulado: acum })
    } else {
      acumProy += esFinde ? Number(promedios.finde_semana) : Number(promedios.lunes_a_viernes)
      proyeccion.push({ dia: i, acumulado: acumProy })
    }
  }

  // Y axis max
  const maxVal = Math.max(
    meta || 0,
    proyeccion[proyeccion.length - 1]?.acumulado || 0,
    ...acumPorDia.map(d => d.acumulado || 0)
  ) * 1.10

  const xScale = (dia) => padL + ((dia - 1) / (diasMes - 1)) * innerW
  const yScale = (val) => padT + innerH - (val / maxVal) * innerH

  // Path línea sólida (acumulado real)
  const realPoints = acumPorDia.filter(d => d.acumulado !== null)
  const realPath = realPoints.length > 0
    ? 'M ' + realPoints.map(d => `${xScale(d.dia)},${yScale(d.acumulado)}`).join(' L ')
    : ''

  // Path línea punteada (proyección)
  const proyPath = proyeccion.length > 0
    ? 'M ' + proyeccion.map(d => `${xScale(d.dia)},${yScale(d.acumulado)}`).join(' L ')
    : ''

  // Y de la meta
  const metaY = meta > 0 ? yScale(meta) : null
  const proyeccionFinalY = yScale(proyeccion[proyeccion.length - 1]?.acumulado || 0)

  // Área sombreada (entre proyección y meta) — verde si proyección>meta, roja si <
  let areaPath = ''
  if (proyeccion.length > 0 && meta > 0) {
    const top = proyeccion.map(d => `${xScale(d.dia)},${yScale(Math.max(d.acumulado, meta))}`).join(' L ')
    const bottom = [...proyeccion].reverse().map(d => `${xScale(d.dia)},${yScale(Math.min(d.acumulado, meta))}`).join(' L ')
    areaPath = `M ${top} L ${bottom} Z`
  }
  const areaColor = semaforo === 'rojo' ? c.red : semaforo === 'amarillo' ? c.yellow : c.green

  // Ticks Y (5 niveles)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(p => p * maxVal)

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 800, height: 'auto', display: 'block' }}>
        {/* Grid horizontal */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} y1={yScale(t)} x2={W - padR} y2={yScale(t)} stroke={c.border} strokeDasharray="2 4" />
            <text x={padL - 8} y={yScale(t) + 4} fill={c.textDim} fontSize="11" textAnchor="end">
              {fmtUSDInt(t)}
            </text>
          </g>
        ))}

        {/* Eje X */}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={c.border} />
        {[1, 5, 10, 15, 20, 25, diasMes].filter((v, i, a) => a.indexOf(v) === i && v <= diasMes).map(d => (
          <g key={d}>
            <line x1={xScale(d)} y1={H - padB} x2={xScale(d)} y2={H - padB + 4} stroke={c.border} />
            <text x={xScale(d)} y={H - padB + 18} fill={c.textDim} fontSize="11" textAnchor="middle">{d}</text>
          </g>
        ))}

        {/* Área sombreada entre proyección y meta */}
        {areaPath && (
          <path d={areaPath} fill={areaColor} fillOpacity="0.12" />
        )}

        {/* Línea meta horizontal */}
        {metaY !== null && (
          <>
            <line x1={padL} y1={metaY} x2={W - padR} y2={metaY}
                  stroke={c.blue} strokeWidth="2" strokeDasharray="6 4" />
            <text x={W - padR} y={metaY - 6} fill={c.blue} fontSize="11" textAnchor="end" fontWeight="700">
              Meta: {fmtUSD(meta)}
            </text>
          </>
        )}

        {/* Línea sólida (real) */}
        {realPath && (
          <path d={realPath} fill="none" stroke={c.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Línea punteada (proyección) */}
        {proyPath && (
          <path d={proyPath} fill="none" stroke={areaColor} strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" />
        )}

        {/* Marcadores en puntos diarios reales */}
        {realPoints.map(d => (
          <circle key={d.dia} cx={xScale(d.dia)} cy={yScale(d.acumulado)} r="3.5" fill={d.es_finde ? c.orange : c.text} />
        ))}

        {/* Punto "hoy" (donde sólida → punteada) */}
        {realPoints.length > 0 && (
          <>
            <circle cx={xScale(diaActual)} cy={yScale(acum)} r="7" fill={areaColor} stroke="#fff" strokeWidth="2" />
            <text x={xScale(diaActual)} y={yScale(acum) - 14} fill={c.text} fontSize="11" textAnchor="middle" fontWeight="700">
              HOY · {fmtUSDInt(acum)}
            </text>
          </>
        )}

        {/* Punto final de proyección */}
        {proyeccion.length > 1 && (
          <>
            <circle cx={xScale(diasMes)} cy={proyeccionFinalY} r="5" fill={areaColor} />
            <text x={xScale(diasMes) - 8} y={proyeccionFinalY - 8} fill={areaColor} fontSize="11" textAnchor="end" fontWeight="700">
              Proy: {fmtUSDInt(proyeccion[proyeccion.length-1].acumulado)}
            </text>
          </>
        )}

        {/* Leyenda */}
        <g transform={`translate(${padL}, 8)`}>
          <line x1="0" y1="0" x2="20" y2="0" stroke={c.text} strokeWidth="3" />
          <text x="26" y="4" fill={c.textDim} fontSize="11">Real</text>
          <line x1="80" y1="0" x2="100" y2="0" stroke={areaColor} strokeWidth="2.5" strokeDasharray="4 3" />
          <text x="106" y="4" fill={c.textDim} fontSize="11">Proyección</text>
          <line x1="190" y1="0" x2="210" y2="0" stroke={c.blue} strokeWidth="2" strokeDasharray="4 3" />
          <text x="216" y="4" fill={c.textDim} fontSize="11">Meta</text>
          <circle cx="270" cy="0" r="3" fill={c.orange} />
          <text x="278" y="4" fill={c.textDim} fontSize="11">Fin de semana</text>
        </g>
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Sparkline mini SVG por sucursal
// ────────────────────────────────────────────────────────────
function Sparkline({ data, width = 120, height = 32, color }) {
  if (!data || data.length === 0) return <span style={{ color: c.textOff, fontSize: 11 }}>—</span>
  const valores = data.map(d => Number(d.monto))
  const max = Math.max(...valores, 1)
  const min = Math.min(...valores, 0)
  const range = max - min || 1
  const stepX = data.length > 1 ? width / (data.length - 1) : 0
  const pts = data.map((d, i) => {
    const x = i * stepX
    const y = height - ((Number(d.monto) - min) / range) * height
    return `${x},${y}`
  })
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts.join(' ')} />
      <polyline fill={color} fillOpacity="0.1"
        points={`0,${height} ${pts.join(' ')} ${width},${height}`} />
    </svg>
  )
}

// ────────────────────────────────────────────────────────────
// Componente principal
// ────────────────────────────────────────────────────────────
export default function DeliveryKpiDashboard({ user }) {
  const now = new Date()
  const [periodo, setPeriodo] = useState({
    anio: now.getFullYear(),
    mes: now.getMonth() + 1,
  })
  const [datos, setDatos] = useState(null)
  const [productos, setProductos] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [showMetaModal, setShowMetaModal] = useState(false)
  const [metaInput, setMetaInput] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)

  // Bloqueo de acceso
  if (user.rol !== 'superadmin') {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ ...cardStyle, borderColor: c.red, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚫</div>
          <div style={{ color: c.text, fontWeight: 700 }}>Dashboard solo para Super Admin</div>
          <div style={{ color: c.textDim, fontSize: 13, marginTop: 6 }}>Tu rol: {user.rol}</div>
        </div>
      </div>
    )
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: dash }, { data: prods }] = await Promise.all([
      db.rpc('fn_delivery_dashboard', { p_anio: periodo.anio, p_mes: periodo.mes }),
      db.rpc('fn_delivery_productos_top', { p_anio: periodo.anio, p_mes: periodo.mes, p_limit: 20 }),
    ])
    setDatos(dash || null)
    setProductos(prods || [])
    setLoading(false)
  }, [periodo.anio, periodo.mes])

  useEffect(() => { cargar() }, [cargar])

  const periodoOptions = useMemo(() => {
    // 12 meses atrás
    const arr = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      arr.push({ anio: d.getFullYear(), mes: d.getMonth() + 1, label: `${MESES[d.getMonth()]} ${d.getFullYear()}` })
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const guardarMeta = async () => {
    const monto = parseFloat(metaInput)
    if (isNaN(monto) || monto <= 0) {
      setMsg({ tipo: 'err', texto: 'Ingresá un monto válido' })
      return
    }
    setSavingMeta(true)
    const { data, error } = await db.rpc('fn_delivery_set_meta', {
      p_anio: periodo.anio, p_mes: periodo.mes,
      p_meta_monto: monto, p_usuario_id: user.id,
    })
    setSavingMeta(false)
    if (error || !data?.ok) {
      setMsg({ tipo: 'err', texto: data?.error || error?.message || 'Error guardando meta' })
      return
    }
    setMsg({ tipo: 'ok', texto: `✓ Meta actualizada: ${fmtUSD(monto)}` })
    setShowMetaModal(false)
    setMetaInput('')
    cargar()
  }

  const exportarCSV = () => {
    if (!datos) return
    const headers = ['Fecha', 'Día', 'Tipo', 'Monto', 'Pedidos']
    const rows = [headers]
    ;(datos.serie_diaria || []).forEach(d => {
      rows.push([
        d.fecha,
        DIAS_CORTO[diaSemanaIdx(d.fecha)],
        d.tipo_dia,
        d.monto,
        d.pedidos,
      ])
    })
    downloadCSV(`delivery_${periodo.anio}_${String(periodo.mes).padStart(2,'0')}.csv`, rows)
  }

  if (loading) {
    return <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>Cargando dashboard…</div>
  }
  if (!datos) {
    return <div style={{ padding: 30, textAlign: 'center', color: c.red }}>Error cargando datos</div>
  }

  const { periodo: per, totales, promedios, serie_diaria, por_sucursal, dias_sin_datos, mejor_dia, peor_dia } = datos
  const semaforo = totales.semaforo
  const colSemaforo = semaforoColor(semaforo)

  // Color por sucursal (fijo)
  const STORE_COLORS = {
    M001: c.purple, S001: c.blue, S002: c.yellow,
    S003: c.green, S004: c.orange,
  }

  return (
    <div style={{ background: c.bg, minHeight: '100vh', padding: 16, color: c.text, maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: c.textDim }}>Informe Ejecutivo · Solo Super Admin</div>
          <h1 style={{ margin: '4px 0', fontSize: 26 }}>🛵 Delivery Propio — {MESES[periodo.mes-1]} {periodo.anio} <InfoTip text="Informe del delivery propio del mes: viajes, ingresos, bonos de motoristas y avance vs meta." /></h1>
          <div style={{ fontSize: 13, color: c.textDim }}>
            {per.dias_mes} días · {per.dias_semana_mes} L-V + {per.dias_finde_mes} S-D · Hoy: {fmtFechaLarga(per.hoy)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={`${periodo.anio}-${periodo.mes}`}
            onChange={e => {
              const [a, m] = e.target.value.split('-').map(Number)
              setPeriodo({ anio: a, mes: m })
            }}
            style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
          >
            {periodoOptions.map(o => (
              <option key={`${o.anio}-${o.mes}`} value={`${o.anio}-${o.mes}`}>{o.label}</option>
            ))}
          </select>
          <button onClick={cargar} style={{ ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>
            🔄 Refrescar
          </button>
          <button onClick={exportarCSV} style={{ ...btn, background: c.greenDark, color: '#fff' }}>
            📥 Exportar CSV
          </button>
        </div>
      </div>

      {/* Mensaje */}
      {msg && (
        <div style={{
          ...cardStyle,
          background: msg.tipo === 'ok' ? '#0f3a26' : '#3a0f0f',
          borderColor: msg.tipo === 'ok' ? c.green : c.red,
          color: '#fff', fontSize: 14,
        }}>{msg.texto}</div>
      )}

      {/* Días sin datos (alerta) */}
      {dias_sin_datos && dias_sin_datos.filter(d => d < per.hoy).length > 0 && (
        <div style={{ ...cardStyle, borderColor: c.yellow, background: '#1f1a0a' }}>
          <strong style={{ color: c.yellow }}>⚠️ Faltan datos de {dias_sin_datos.filter(d => d < per.hoy).length} día(s) que ya pasaron:</strong>{' '}
          <span style={{ color: c.textDim, fontSize: 13 }}>
            {dias_sin_datos.filter(d => d < per.hoy).map(d => fmtFechaLarga(d)).join(' · ')}
          </span>
          <div style={{ fontSize: 12, color: c.textDim, marginTop: 4 }}>
            La proyección compensa estos días usando el promedio correspondiente (L-V o S-D).
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Venta acumulada</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: c.text }}>{fmtUSD(totales.acumulado)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>{totales.pedidos} pedidos</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: colSemaforo }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Proyección</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: colSemaforo }}>{fmtUSD(totales.proyeccion)}</div>
          <div style={{ fontSize: 11, color: colSemaforo, fontWeight: 700 }}>
            {semaforoEmoji(semaforo)} {totales.porcentaje_proyectado}% de meta
          </div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Meta del mes</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{fmtUSD(totales.meta)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>
            {totales.meta_ajustada ? '✏️ Manual' : 'Auto (+5%)'}
          </div>
          <button onClick={() => { setMetaInput(String(totales.meta)); setShowMetaModal(true) }}
                  style={{ ...btn, marginTop: 6, background: c.input, color: c.text, border: `1px solid ${c.border}`, fontSize: 11, padding: '4px 10px' }}>
            Ajustar
          </button>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>% Avance real</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{totales.porcentaje_avance}%</div>
          <div style={{ fontSize: 11, color: c.textDim }}>{totales.dias_restantes} días restantes</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Ticket promedio</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{fmtUSD(totales.ticket_promedio)}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Promedio diario</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>
            L-V: <span style={{ color: c.text }}>{fmtUSD(promedios.lunes_a_viernes)}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            S-D: <span style={{ color: c.orange }}>{fmtUSD(promedios.finde_semana)}</span>
          </div>
          <div style={{ fontSize: 11, color: c.green }}>+{promedios.diferencia_pct}% finde</div>
        </div>
      </div>

      {/* Gráfica principal de proyección */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>
          Proyección ponderada · {MESES[periodo.mes-1]} {periodo.anio}
        </div>
        <GraficaProyeccion data={serie_diaria} periodo={per} meta={totales.meta} promedios={promedios} semaforo={semaforo} />
      </div>

      {/* Mejor / peor día */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginBottom: 12 }}>
        {mejor_dia && (
          <div style={{ ...cardStyle, marginBottom: 0, borderColor: c.green }}>
            <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🏆 Mejor día</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.green }}>{fmtUSD(mejor_dia.monto)}</div>
            <div style={{ fontSize: 13, color: c.textDim }}>{fmtFechaLarga(mejor_dia.fecha)} · {mejor_dia.pedidos} pedidos</div>
          </div>
        )}
        {peor_dia && (
          <div style={{ ...cardStyle, marginBottom: 0, borderColor: c.red }}>
            <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>📉 Peor día</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.red }}>{fmtUSD(peor_dia.monto)}</div>
            <div style={{ fontSize: 13, color: c.textDim }}>{fmtFechaLarga(peor_dia.fecha)} · {peor_dia.pedidos} pedidos</div>
          </div>
        )}
      </div>

      {/* Ranking por sucursal */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Ranking por sucursal</div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${c.border}` }}>
              <th style={{ textAlign: 'left', padding: 10, color: c.textDim }}>#</th>
              <th style={{ textAlign: 'left', padding: 10, color: c.textDim }}>Sucursal</th>
              <th style={{ textAlign: 'right', padding: 10, color: c.textDim }}>Monto</th>
              <th style={{ textAlign: 'right', padding: 10, color: c.textDim }}>%</th>
              <th style={{ textAlign: 'right', padding: 10, color: c.textDim }}>Pedidos</th>
              <th style={{ textAlign: 'right', padding: 10, color: c.textDim }}>Ticket prom.</th>
              <th style={{ textAlign: 'center', padding: 10, color: c.textDim }}>Tendencia</th>
              <th style={{ textAlign: 'right', padding: 10, color: c.textDim }}>vs mes anterior</th>
            </tr>
          </thead>
          <tbody>
            {por_sucursal.map((s, i) => {
              const pct = totales.acumulado > 0 ? (s.monto / totales.acumulado * 100) : 0
              const crec = s.monto_periodo_mes_anterior > 0
                ? ((s.monto - s.monto_periodo_mes_anterior) / s.monto_periodo_mes_anterior * 100)
                : null
              const colorCrec = crec === null ? c.textDim : crec >= 0 ? c.green : c.red
              return (
                <tr key={s.store_code} style={{ borderBottom: `1px solid ${c.border}` }}>
                  <td style={{ padding: 10, color: c.textDim }}>{i + 1}</td>
                  <td style={{ padding: 10 }}>
                    <strong>{s.sucursal_nombre}</strong>
                    <span style={{ color: c.textDim, fontSize: 11, marginLeft: 6 }}>{s.store_code}</span>
                  </td>
                  <td style={{ padding: 10, textAlign: 'right', fontWeight: 700 }}>{fmtUSD(s.monto)}</td>
                  <td style={{ padding: 10, textAlign: 'right', color: c.textDim }}>{pct.toFixed(1)}%</td>
                  <td style={{ padding: 10, textAlign: 'right' }}>{s.pedidos}</td>
                  <td style={{ padding: 10, textAlign: 'right', color: c.textDim }}>{fmtUSD(s.ticket_promedio)}</td>
                  <td style={{ padding: 6, textAlign: 'center' }}>
                    <Sparkline data={s.sparkline} color={STORE_COLORS[s.store_code] || c.blue} />
                  </td>
                  <td style={{ padding: 10, textAlign: 'right', color: colorCrec, fontWeight: 600 }}>
                    {crec !== null ? `${crec >= 0 ? '↑' : '↓'} ${Math.abs(crec).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Top productos */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Top productos del mes ({productos.length})</div>
        {productos.length === 0 ? (
          <div style={{ color: c.textDim, padding: 20, textAlign: 'center' }}>Sin productos detallados</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${c.border}` }}>
                <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>#</th>
                <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Producto</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Cantidad</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Órdenes</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Monto total</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p, i) => (
                <tr key={p.producto_norm} style={{ borderBottom: `1px solid ${c.border}` }}>
                  <td style={{ padding: 8, color: c.textDim }}>{i + 1}</td>
                  <td style={{ padding: 8 }}>{p.producto_nombre}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{p.cantidad}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: c.textDim }}>{p.ordenes}</td>
                  <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{fmtUSD(p.monto_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detalle diario */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Detalle diario</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${c.border}` }}>
                <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Día</th>
                {por_sucursal.map(s => (
                  <th key={s.store_code} style={{ textAlign: 'right', padding: 8, color: c.textDim }} title={s.sucursal_nombre}>
                    {s.store_code}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: 8, color: c.textDim, fontWeight: 700 }}>Total</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {(serie_diaria || []).map(d => {
                // Para mostrar monto por sucursal, hago lookup en sparkline de cada sucursal
                const montosPorSuc = {}
                por_sucursal.forEach(s => {
                  const sp = (s.sparkline || []).find(x => x.fecha === d.fecha)
                  montosPorSuc[s.store_code] = sp ? Number(sp.monto) : 0
                })
                const esMejor = mejor_dia && d.fecha === mejor_dia.fecha
                const finde = d.tipo_dia === 'finde'
                return (
                  <tr key={d.fecha} style={{
                    borderBottom: `1px solid ${c.border}`,
                    background: esMejor ? '#0f3a26' : finde ? '#1a1f2a' : 'transparent',
                  }}>
                    <td style={{ padding: 8 }}>{fmtFecha(d.fecha)}{esMejor && ' 🏆'}</td>
                    <td style={{ padding: 8, color: finde ? c.orange : c.textDim, fontWeight: finde ? 700 : 400 }}>
                      {DIAS_CORTO[diaSemanaIdx(d.fecha)]}
                    </td>
                    {por_sucursal.map(s => (
                      <td key={s.store_code} style={{ padding: 8, textAlign: 'right', color: c.textDim }}>
                        {montosPorSuc[s.store_code] > 0 ? fmtUSD(montosPorSuc[s.store_code]) : '—'}
                      </td>
                    ))}
                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{fmtUSD(d.monto)}</td>
                    <td style={{ padding: 8, textAlign: 'right', color: c.textDim }}>{d.pedidos}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal ajustar meta */}
      {showMetaModal && (
        <div onClick={() => setShowMetaModal(false)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 20, maxWidth: 400, width: '100%'
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Ajustar meta manualmente</div>
            <div style={{ fontSize: 13, color: c.textDim, marginBottom: 12 }}>
              {MESES[periodo.mes-1]} {periodo.anio} · Actual: {fmtUSD(totales.meta)} ({totales.meta_ajustada ? 'manual' : 'auto'})
            </div>
            <label style={{ fontSize: 12, color: c.textDim, display: 'block', marginBottom: 4 }}>Nueva meta (USD)</label>
            <input
              type="number" step="0.01" min="0"
              value={metaInput}
              onChange={e => setMetaInput(e.target.value)}
              placeholder="Ej: 35000"
              style={{ width: '100%', background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: 10, fontSize: 14, boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: c.textDim, marginTop: 6 }}>
              Si dejás vacío y guardás, el sistema vuelve a la meta automática (mes anterior +5%).
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setShowMetaModal(false)} disabled={savingMeta}
                      style={{ ...btn, flex: 1, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>
                Cancelar
              </button>
              <button onClick={guardarMeta} disabled={savingMeta}
                      style={{ ...btn, flex: 2, background: c.green, color: '#000' }}>
                {savingMeta ? 'Guardando…' : 'Guardar meta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
