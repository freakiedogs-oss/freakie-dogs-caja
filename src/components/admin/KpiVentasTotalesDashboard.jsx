import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'

/**
 * KpiVentasTotalesDashboard — Informe ejecutivo de TODAS las ventas.
 * Canales: Todas (POS+PEYA+Eventos), Quanto (POS), PEYA, Eventos.
 *
 * Lee de fn_ventas_totales_dashboard(anio, mes) RPC.
 *
 * Funcionalidades:
 *  - 4 botones de canal (Todas / Quanto / PEYA / Eventos)
 *  - 5 KPI cards (acumulado, proyección, % avance BEP, ticket, promedio diario)
 *  - Gráfica SVG: línea acumulada + proyección + línea horizontal BEP
 *  - Gráfica BEP detallada: barras CF + CV proyectado + Utilidad esperada
 *  - Tabla detalle diario con desglose por canal
 *  - Exportar CSV
 *
 * Acceso: admin, superadmin, ejecutivo, gerente
 */

const c = {
  bg: '#0a0a0a', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  purple: '#a78bfa', pink: '#ec4899', cyan: '#22d3ee',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
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

// Definición de canales con sus colores y labels
const CANALES = [
  { key: 'todas',   label: 'Todas',          icon: '🌐', color: c.cyan,    short: 'Total' },
  { key: 'quanto',  label: 'Quanto (POS)',   icon: '🍔', color: c.green,   short: 'Quanto' },
  { key: 'peya',    label: 'PEYA',           icon: '🛵', color: c.pink,    short: 'PEYA' },
  { key: 'eventos', label: 'Eventos',        icon: '🎉', color: c.purple,  short: 'Eventos' },
]

function fmtUSD(v) {
  return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtUSDInt(v) {
  return '$' + Math.round(Number(v) || 0).toLocaleString('en-US')
}
function fmtPct(v) {
  return (Number(v) || 0).toFixed(2) + '%'
}
function fmtFecha(iso) {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })
}
function fmtFechaLarga(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return DIAS_CORTO[d.getDay()] + ' ' + d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })
}
function diaSemanaIdx(iso) {
  return new Date(iso + 'T12:00:00').getDay()
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
// Gráfica de proyección + Punto de Equilibrio
// ────────────────────────────────────────────────────────────
function GraficaProyeccionBEP({ data, periodo, canalKey, canalColor, bep, utilidad, sinIva, bepActivo, diaBepActivo }) {
  if (!data || data.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>Sin datos para el período</div>
  }
  const W = 1100, H = 380
  const padL = 70, padR = 30, padT = 24, padB = 50
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const diasMes = periodo.dias_mes
  const diaActual = periodo.dia_actual
  const inicioDate = new Date(periodo.inicio + 'T12:00:00')

  // Serie acumulada real (filtrada por canal seleccionado)
  const acumPorDia = []
  let acum = 0
  for (let i = 1; i <= diasMes; i++) {
    const date = new Date(inicioDate)
    date.setDate(date.getDate() + (i - 1))
    const iso = date.toISOString().split('T')[0]
    const reg = data.find(d => d.fecha === iso)
    const canalField = sinIva ? canalKey + '_si' : canalKey
    const monto = reg ? Number(reg[canalField] || 0) : 0
    const esFuturo = i > diaActual
    if (reg) acum += monto
    acumPorDia.push({
      dia: i, iso, monto_dia: monto,
      acumulado: esFuturo ? null : acum,
      es_finde: [0,6].includes(date.getDay()),
      tieneData: !!reg,
      esFuturo,
    })
  }
  // Línea de proyección lineal (desde hoy hasta fin de mes)
  const promedioDiario = diaActual > 0 ? acum / diaActual : 0
  const proyeccion = []
  for (let i = diaActual; i <= diasMes; i++) {
    if (i === diaActual) {
      proyeccion.push({ dia: i, acumulado: acum })
    } else {
      proyeccion.push({ dia: i, acumulado: acum + promedioDiario * (i - diaActual) })
    }
  }
  const proyFinal = proyeccion[proyeccion.length - 1]?.acumulado || 0
  const bepValor = canalKey === 'todas' ? bepActivo : null

  const maxVal = Math.max(
    bepValor || 0,
    proyFinal,
    ...acumPorDia.map(d => d.acumulado || 0)
  ) * 1.10 || 100

  const xScale = (dia) => padL + ((dia - 1) / (diasMes - 1)) * innerW
  const yScale = (val) => padT + innerH - (val / maxVal) * innerH

  const realPoints = acumPorDia.filter(d => d.acumulado !== null)
  const realPath = realPoints.length > 0
    ? 'M ' + realPoints.map(d => `${xScale(d.dia)},${yScale(d.acumulado)}`).join(' L ')
    : ''
  const proyPath = proyeccion.length > 0
    ? 'M ' + proyeccion.map(d => `${xScale(d.dia)},${yScale(d.acumulado)}`).join(' L ')
    : ''

  const bepY = bepValor ? yScale(bepValor) : null
  const proyFinalY = yScale(proyFinal)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(p => p * maxVal)

  // Línea Día BEP (vertical)
  const diaBepX = (canalKey === 'todas' && diaBepActivo > 0 && diaBepActivo <= diasMes)
    ? xScale(diaBepActivo) : null

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 800, height: 'auto', display: 'block' }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} y1={yScale(t)} x2={W - padR} y2={yScale(t)} stroke={c.border} strokeDasharray="2 4" />
            <text x={padL - 8} y={yScale(t) + 4} fill={c.textDim} fontSize="11" textAnchor="end">{fmtUSDInt(t)}</text>
          </g>
        ))}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={c.border} />
        {[1, 5, 10, 15, 20, 25, diasMes].filter((v, i, a) => a.indexOf(v) === i && v <= diasMes).map(d => (
          <g key={d}>
            <line x1={xScale(d)} y1={H - padB} x2={xScale(d)} y2={H - padB + 4} stroke={c.border} />
            <text x={xScale(d)} y={H - padB + 18} fill={c.textDim} fontSize="11" textAnchor="middle">{d}</text>
          </g>
        ))}

        {/* Día BEP (vertical) — solo si canal=todas */}
        {diaBepX !== null && (
          <>
            <line x1={diaBepX} y1={padT} x2={diaBepX} y2={H - padB}
                  stroke={c.yellow} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
            <text x={diaBepX} y={padT - 4} fill={c.yellow} fontSize="10" textAnchor="middle" fontWeight="700">
              ⚖️ Día BEP: {diaBepActivo}
            </text>
          </>
        )}

        {/* Línea BEP horizontal — solo si canal=todas */}
        {bepY !== null && (
          <>
            <line x1={padL} y1={bepY} x2={W - padR} y2={bepY}
                  stroke={c.yellow} strokeWidth="2.5" strokeDasharray="8 4" />
            <text x={W - padR} y={bepY - 6} fill={c.yellow} fontSize="11" textAnchor="end" fontWeight="700">
              ⚖️ Punto Equilibrio: {fmtUSD(bepActivo)}
            </text>
          </>
        )}

        {/* Línea real */}
        {realPath && (
          <path d={realPath} fill="none" stroke={c.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {/* Línea proyección */}
        {proyPath && (
          <path d={proyPath} fill="none" stroke={canalColor} strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" />
        )}
        {/* Marcadores */}
        {realPoints.map(d => (
          <circle key={d.dia} cx={xScale(d.dia)} cy={yScale(d.acumulado)} r="3" fill={d.es_finde ? c.orange : c.text} />
        ))}
        {/* Punto HOY */}
        {realPoints.length > 0 && (
          <>
            <circle cx={xScale(diaActual)} cy={yScale(acum)} r="7" fill={canalColor} stroke="#fff" strokeWidth="2" />
            <text x={xScale(diaActual)} y={yScale(acum) - 14} fill={c.text} fontSize="11" textAnchor="middle" fontWeight="700">
              HOY · {fmtUSDInt(acum)}
            </text>
          </>
        )}
        {/* Punto final proyección */}
        {proyeccion.length > 1 && (
          <>
            <circle cx={xScale(diasMes)} cy={proyFinalY} r="5" fill={canalColor} />
            <text x={xScale(diasMes) - 8} y={proyFinalY - 8} fill={canalColor} fontSize="11" textAnchor="end" fontWeight="700">
              Proy: {fmtUSDInt(proyFinal)}
            </text>
          </>
        )}

        {/* Leyenda */}
        <g transform={`translate(${padL}, 6)`}>
          <line x1="0" y1="0" x2="20" y2="0" stroke={c.text} strokeWidth="3" />
          <text x="26" y="4" fill={c.textDim} fontSize="11">Real</text>
          <line x1="80" y1="0" x2="100" y2="0" stroke={canalColor} strokeWidth="2.5" strokeDasharray="4 3" />
          <text x="106" y="4" fill={c.textDim} fontSize="11">Proyección lineal</text>
          {canalKey === 'todas' && (
            <>
              <line x1="220" y1="0" x2="240" y2="0" stroke={c.yellow} strokeWidth="2.5" strokeDasharray="6 3" />
              <text x="246" y="4" fill={c.textDim} fontSize="11">Punto Equilibrio</text>
            </>
          )}
          <circle cx="370" cy="0" r="3" fill={c.orange} />
          <text x="378" y="4" fill={c.textDim} fontSize="11">Fin de semana</text>
        </g>
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Gráfica de waterfall P&L (utilidad proyectada)
// ────────────────────────────────────────────────────────────
function GraficaUtilidad({ canales, bep, utilidad, sinIva }) {
  const ingresos = sinIva ? Number(canales.todas.proyeccion_si) : Number(canales.todas.proyeccion)
  const cogs = sinIva ? Number(utilidad.cv_proyectado) : Number(utilidad.cv_proyectado_ci ?? utilidad.cv_proyectado)
  const cf = sinIva ? Number(utilidad.cf_proyectado) : Number(utilidad.cf_proyectado_ci ?? utilidad.cf_proyectado)
  const util = sinIva ? Number(utilidad.utilidad_proyectada) : Number(utilidad.utilidad_proyectada_ci ?? utilidad.utilidad_proyectada)
  const ratioCv = (sinIva ? Number(bep.ratio_cv) : Number(bep.ratio_cv_ci ?? bep.ratio_cv)) * 100
  const margen = (sinIva ? Number(bep.margen_contribucion) : Number(bep.margen_contribucion_ci ?? bep.margen_contribucion)) * 100

  const W = 1100, H = 280
  const padL = 60, padR = 30, padT = 20, padB = 60
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  // 4 barras: Ingresos / -COGS / -CF / =Utilidad
  const barras = [
    { label: 'Ingresos Proy.', valor: ingresos, color: c.green, delta: ingresos, sub: 'Ventas estimadas' },
    { label: '- COGS (' + ratioCv.toFixed(1) + '%)', valor: cogs, color: c.red, delta: -cogs, sub: 'Costos variables' },
    { label: '- Costos Fijos', valor: cf, color: c.orange, delta: -cf, sub: 'CF mensual' },
    { label: 'Utilidad Neta', valor: util, color: util >= 0 ? c.green : c.red, delta: util, sub: util >= 0 ? '✓ Positiva' : '✗ Negativa' },
  ]

  const maxVal = Math.max(...barras.map(b => b.valor)) * 1.15
  const barWidth = innerW / barras.length - 30
  const yScale = (val) => padT + innerH - (val / maxVal) * innerH

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 700, height: 'auto', display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(p => {
          const t = p * maxVal
          return (
            <g key={t}>
              <line x1={padL} y1={yScale(t)} x2={W - padR} y2={yScale(t)} stroke={c.border} strokeDasharray="2 4" />
              <text x={padL - 8} y={yScale(t) + 4} fill={c.textDim} fontSize="11" textAnchor="end">{fmtUSDInt(t)}</text>
            </g>
          )
        })}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={c.border} />

        {barras.map((b, i) => {
          const x = padL + i * (innerW / barras.length) + 15
          const yTop = yScale(b.valor)
          const h = (H - padB) - yTop
          return (
            <g key={b.label}>
              <rect x={x} y={yTop} width={barWidth} height={h} fill={b.color} opacity="0.85" rx="4" />
              <text x={x + barWidth / 2} y={yTop - 8} fill={b.color} fontSize="13" textAnchor="middle" fontWeight="700">
                {fmtUSD(b.valor)}
              </text>
              <text x={x + barWidth / 2} y={H - padB + 18} fill={c.text} fontSize="12" textAnchor="middle" fontWeight="600">
                {b.label}
              </text>
              <text x={x + barWidth / 2} y={H - padB + 34} fill={c.textDim} fontSize="10" textAnchor="middle">
                {b.sub}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Componente principal
// ────────────────────────────────────────────────────────────
export default function KpiVentasTotalesDashboard({ user }) {
  const now = new Date()
  const [periodo, setPeriodo] = useState({
    anio: now.getFullYear(),
    mes: now.getMonth() + 1,
  })
  const [datos, setDatos] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState(null)
  const [canalActivo, setCanalActivo] = useState('todas')
  const [sinIva, setSinIva] = useState(true)  // toggle Con IVA / Sin IVA (default: sin IVA, métrica contable)

  // Bloqueo de acceso por rol
  if (!['admin','superadmin','ejecutivo','gerente'].includes(user.rol)) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ ...cardStyle, borderColor: c.red, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚫</div>
          <div style={{ color: c.text, fontWeight: 700 }}>Dashboard restringido</div>
          <div style={{ color: c.textDim, fontSize: 13, marginTop: 6 }}>Solo: admin · superadmin · ejecutivo · gerente. Tu rol: {user.rol}</div>
        </div>
      </div>
    )
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    setErrMsg(null)
    try {
      const { data, error } = await db.rpc('fn_ventas_totales_dashboard', {
        p_anio: periodo.anio, p_mes: periodo.mes,
      })
      if (error) {
        console.error('[KpiVentasTotales] RPC error:', error)
        setErrMsg((error.message || JSON.stringify(error)) + (error.hint ? ' · Hint: ' + error.hint : ''))
        setDatos(null)
      } else if (!data) {
        setErrMsg('RPC retornó null (sin datos)')
        setDatos(null)
      } else {
        setDatos(data)
      }
    } catch (e) {
      console.error('[KpiVentasTotales] Exception:', e)
      setErrMsg('Excepción: ' + (e.message || String(e)))
      setDatos(null)
    } finally {
      setLoading(false)
    }
  }, [periodo.anio, periodo.mes])

  useEffect(() => { cargar() }, [cargar])

  const periodoOptions = useMemo(() => {
    const arr = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      arr.push({ anio: d.getFullYear(), mes: d.getMonth() + 1, label: `${MESES[d.getMonth()]} ${d.getFullYear()}` })
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exportarCSV = () => {
    if (!datos) return
    const headers = ['Fecha', 'Día', 'Quanto', 'PEYA', 'Eventos', 'Total', 'Pedidos']
    const rows = [headers]
    ;(datos.serie_diaria || []).forEach(d => {
      const quanto = sinIva ? d.quanto_si : d.quanto
      const peya = sinIva ? d.peya_si : d.peya
      const eventos = sinIva ? d.eventos_si : d.eventos
      const todas = sinIva ? d.todas_si : d.todas
      rows.push([d.fecha, DIAS_CORTO[diaSemanaIdx(d.fecha)], quanto, peya, eventos, todas, d.pedidos_todas])
    })
    downloadCSV(`ventas_totales_${periodo.anio}_${String(periodo.mes).padStart(2,'0')}_${sinIva?'sin_iva':'con_iva'}.csv`, rows)
  }

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>Cargando dashboard…</div>
  if (!datos) return (
    <div style={{ padding: 30, color: c.text, maxWidth: 800, margin: '20px auto' }}>
      <div style={{ ...cardStyle, borderColor: c.red, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ color: c.red, fontWeight: 700, fontSize: 18 }}>Error cargando datos</div>
        {errMsg && (
          <div style={{ marginTop: 10, padding: 12, background: c.input, borderRadius: 8, color: c.textDim, fontSize: 12, fontFamily: 'monospace', textAlign: 'left', wordBreak: 'break-word' }}>
            {errMsg}
          </div>
        )}
        <button onClick={cargar} style={{ ...btn, marginTop: 14, background: c.blue, color: '#000', fontWeight: 700 }}>🔄 Reintentar</button>
        <div style={{ marginTop: 12, fontSize: 11, color: c.textDim }}>
          Si el error persiste, abrí la consola del navegador (F12 → Console) para ver más detalle, o avisa al admin.
        </div>
      </div>
    </div>
  )

  const { periodo: per, canales, serie_diaria, bep, utilidad } = datos
  const canalSel = canales[canalActivo]
  const canalDef = CANALES.find(x => x.key === canalActivo)
  // Valores derivados según toggle IVA. Sufijo '_si' = sin IVA, '_ci' = con IVA matched (COGS/CF inflados con 1.13).
  const acumActivo = sinIva ? Number(canalSel.acumulado_si) : Number(canalSel.acumulado)
  const proyActivo = sinIva ? Number(canalSel.proyeccion_si) : Number(canalSel.proyeccion)
  const ticketActivo = sinIva ? Number(canalSel.ticket_promedio_si) : Number(canalSel.ticket_promedio)
  const promDiarioActivo = sinIva ? Number(utilidad.promedio_diario_si) : Number(utilidad.promedio_diario)
  // BEP/Utilidad — pares con/sin IVA (matching ambos lados)
  const bepActivo = sinIva ? Number(bep.bep_mensual) : Number(bep.bep_mensual_ci ?? bep.bep_mensual)
  const cfActivo = sinIva ? Number(bep.costos_fijos_total) : Number(bep.costos_fijos_total_ci ?? bep.costos_fijos_total)
  const ratioCvActivo = sinIva ? Number(bep.ratio_cv) : Number(bep.ratio_cv_ci ?? bep.ratio_cv)
  const margenContribActivo = sinIva ? Number(bep.margen_contribucion) : Number(bep.margen_contribucion_ci ?? bep.margen_contribucion)
  const diaBepActivo = sinIva ? Number(bep.dia_bep) : Number(bep.dia_bep_ci ?? bep.dia_bep)
  const faltanteBepActivo = sinIva ? Number(bep.faltante_para_bep) : Number(bep.faltante_para_bep_ci ?? bep.faltante_para_bep)
  const porcAvanceBepActivo = sinIva ? Number(bep.porcentaje_avance_bep) : Number(bep.porcentaje_avance_bep_ci ?? bep.porcentaje_avance_bep)
  const cogsRefActivo = sinIva ? Number(bep.cogs_referencia_3m) : Number(bep.cogs_referencia_ci ?? bep.cogs_referencia_3m)
  const ventasRefActivo = sinIva ? Number(bep.ventas_referencia_3m) : Number(bep.ventas_referencia_ci ?? bep.ventas_referencia_3m)
  const utilidadProyActivo = sinIva ? Number(utilidad.utilidad_proyectada) : Number(utilidad.utilidad_proyectada_ci ?? utilidad.utilidad_proyectada)
  const cvProyActivo = sinIva ? Number(utilidad.cv_proyectado) : Number(utilidad.cv_proyectado_ci ?? utilidad.cv_proyectado)
  const cfProyActivo = sinIva ? Number(utilidad.cf_proyectado) : Number(utilidad.cf_proyectado_ci ?? utilidad.cf_proyectado)
  const margenNetoActivo = sinIva ? Number(utilidad.margen_neto_pct) : Number(utilidad.margen_neto_pct_ci ?? utilidad.margen_neto_pct)

  const bepAvance = porcAvanceBepActivo || 0
  const semaforoBep = bepAvance >= 100 ? c.green : bepAvance >= 80 ? c.yellow : c.red
  const utilidadColor = utilidadProyActivo >= 0 ? c.green : c.red

  return (
    <div style={{ background: c.bg, minHeight: '100vh', padding: 16, color: c.text, maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: c.textDim }}>Informe Ejecutivo · Ventas Totales</div>
          <h1 style={{ margin: '4px 0', fontSize: 26 }}>📊 Ventas Totales — {MESES[periodo.mes-1]} {periodo.anio}</h1>
          <div style={{ fontSize: 13, color: c.textDim }}>
            {per.dias_mes} días · {per.data_completa_hasta && per.data_completa_hasta !== per.hoy ? (
              <>Data completa hasta <span style={{ color: c.orange, fontWeight: 700 }}>{fmtFechaLarga(per.data_completa_hasta)}</span> (día {per.dia_actual} de {per.dias_mes}) · </>
            ) : (
              <>Día {per.dia_actual} de {per.dias_mes} · </>
            )}Hoy: {fmtFechaLarga(per.hoy)}
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
            {periodoOptions.map(o => <option key={`${o.anio}-${o.mes}`} value={`${o.anio}-${o.mes}`}>{o.label}</option>)}
          </select>
          {/* Toggle IVA — pill segmented control */}
          <div
            role="group"
            aria-label="Modo IVA"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: '#0f0f10',
              border: `1px solid ${c.cardBorder}`,
              borderRadius: 999,
              padding: 3,
              gap: 2,
              position: 'relative',
              height: 36,
              minWidth: 178,
            }}
          >
            <button
              onClick={() => setSinIva(true)}
              aria-pressed={sinIva}
              style={{
                position: 'relative', zIndex: 1,
                padding: '0 14px', height: 28, lineHeight: '28px',
                borderRadius: 999, border: 'none', cursor: 'pointer',
                background: sinIva ? c.green : 'transparent',
                color: sinIva ? '#0a0a0a' : c.textDim,
                fontSize: 12, fontWeight: sinIva ? 800 : 600,
                letterSpacing: 0.2, transition: 'all 0.18s',
                boxShadow: sinIva ? '0 1px 6px rgba(74,222,128,0.35)' : 'none',
              }}
            >Sin IVA</button>
            <button
              onClick={() => setSinIva(false)}
              aria-pressed={!sinIva}
              style={{
                position: 'relative', zIndex: 1,
                padding: '0 14px', height: 28, lineHeight: '28px',
                borderRadius: 999, border: 'none', cursor: 'pointer',
                background: !sinIva ? c.blue : 'transparent',
                color: !sinIva ? '#0a0a0a' : c.textDim,
                fontSize: 12, fontWeight: !sinIva ? 800 : 600,
                letterSpacing: 0.2, transition: 'all 0.18s',
                boxShadow: !sinIva ? '0 1px 6px rgba(96,165,250,0.35)' : 'none',
              }}
            >Con IVA</button>
          </div>
          <button onClick={cargar} style={{ ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>🔄 Refrescar</button>
          <button onClick={exportarCSV} style={{ ...btn, background: c.greenDark, color: '#fff' }}>📥 Exportar CSV</button>
        </div>
      </div>

      {/* Botones de canal */}
      <div style={{ ...cardStyle, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12 }}>
        <span style={{ color: c.textDim, fontSize: 12, marginRight: 6 }}>FILTRAR POR CANAL:</span>
        {CANALES.map(cn => {
          const activo = canalActivo === cn.key
          const valor = sinIva ? Number(canales[cn.key].acumulado_si) : Number(canales[cn.key].acumulado)
          return (
            <button
              key={cn.key}
              onClick={() => setCanalActivo(cn.key)}
              style={{
                ...btn,
                background: activo ? cn.color : c.input,
                color: activo ? '#000' : c.text,
                border: `2px solid ${activo ? cn.color : c.border}`,
                fontWeight: 700, padding: '8px 14px',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ fontSize: 16 }}>{cn.icon}</span>
              {cn.label}
              <span style={{ opacity: 0.85, fontSize: 11, fontWeight: 500 }}>· {fmtUSDInt(valor)}</span>
            </button>
          )
        })}
      </div>

      {/* KPI Cards principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: canalDef.color }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Venta Acumulada {sinIva ? 'Sin IVA' : 'Con IVA'}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: canalDef.color }}>{fmtUSD(acumActivo)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>{canalSel.pedidos} pedidos · {canalDef.label}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Proyección Lineal</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{fmtUSD(proyActivo)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>Promedio × días restantes</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: semaforoBep }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>⚖️ Avance BEP</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: semaforoBep }}>{fmtPct(porcAvanceBepActivo)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>BEP: {fmtUSDInt(bepActivo)}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: utilidadColor }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Utilidad Proyectada</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: utilidadColor }}>{fmtUSD(utilidadProyActivo)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>Margen: {fmtPct(margenNetoActivo)}</div>
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Ticket Promedio</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{fmtUSD(ticketActivo)}</div>
          <div style={{ fontSize: 11, color: c.textDim }}>Prom. diario: {fmtUSDInt(promDiarioActivo)}</div>
        </div>
      </div>

      {/* Gráfica principal: Proyección + BEP */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          {canalDef.icon} Acumulado · Proyección {canalActivo === 'todas' ? '· Punto de Equilibrio' : ''} ({sinIva ? 'Sin IVA' : 'Con IVA'}) — {MESES[periodo.mes-1]} {periodo.anio}
        </div>
        <div style={{ fontSize: 12, color: c.textDim, marginBottom: 10 }}>
          Línea blanca = ventas reales · Línea punteada {canalDef.short.toLowerCase()} = proyección lineal{canalActivo === 'todas' ? ' · Línea amarilla = BEP' : ''}
        </div>
        <GraficaProyeccionBEP data={serie_diaria} periodo={per} canalKey={canalActivo} canalColor={canalDef.color} bep={bep} utilidad={utilidad} sinIva={sinIva} bepActivo={bepActivo} diaBepActivo={diaBepActivo} />
      </div>

      {/* Sección Punto de Equilibrio + Utilidad proyectada (solo todas) */}
      {canalActivo === 'todas' && (
        <>
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>⚖️ Punto de Equilibrio (BEP) — Metodología clásica</div>
            <div style={{ fontSize: 12, color: c.textDim, marginBottom: 12 }}>
              Fórmula: BEP = Costos Fijos / (1 − Costos Variables / Ventas) · Ratio CV histórico últimos 3 meses
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <div style={{ background: c.input, borderRadius: 8, padding: 12, borderLeft: `3px solid ${c.orange}` }}>
                <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Costos Fijos Mes</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.orange }}>{fmtUSD(cfActivo)}</div>
                <div style={{ fontSize: 11, color: c.textDim, marginTop: 4 }}>
                  Planilla op: {fmtUSDInt(bep.cf_planilla_operativa)} · Ger: {fmtUSDInt(bep.cf_planilla_gerencial)}<br/>
                  Admin: {fmtUSDInt(bep.cf_admin)} · Local: {fmtUSDInt(bep.cf_local)}
                  {!sinIva && <div style={{ marginTop: 4, fontStyle: 'italic' }}>× 1.13 (IVA pasthrough)</div>}
                </div>
              </div>
              <div style={{ background: c.input, borderRadius: 8, padding: 12, borderLeft: `3px solid ${c.red}` }}>
                <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Ratio CV (COGS/Ventas)</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.red }}>{(ratioCvActivo*100).toFixed(2)}%</div>
                <div style={{ fontSize: 11, color: c.textDim, marginTop: 4 }}>
                  COGS ref: {fmtUSDInt(cogsRefActivo)}<br/>
                  Ventas ref: {fmtUSDInt(ventasRefActivo)}
                </div>
              </div>
              <div style={{ background: c.input, borderRadius: 8, padding: 12, borderLeft: `3px solid ${c.green}` }}>
                <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Margen Contribución</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.green }}>{(margenContribActivo*100).toFixed(2)}%</div>
                <div style={{ fontSize: 11, color: c.textDim, marginTop: 4 }}>
                  Por cada $1 vendido, ${margenContribActivo.toFixed(2)} contribuye a CF/utilidad
                </div>
              </div>
              <div style={{ background: c.input, borderRadius: 8, padding: 12, borderLeft: `3px solid ${c.yellow}` }}>
                <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>BEP Mensual</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.yellow }}>{fmtUSD(bepActivo)}</div>
                <div style={{ fontSize: 11, color: c.textDim, marginTop: 4 }}>
                  Día estimado: {diaBepActivo > per.dias_mes ? 'No alcanza' : `Día ${diaBepActivo}`}<br/>
                  Falta: {fmtUSD(faltanteBepActivo)}
                </div>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>💰 Utilidad Proyectada a Fin de Mes (Waterfall P&L)</div>
            <div style={{ fontSize: 12, color: c.textDim, marginBottom: 10 }}>
              Utilidad = Ingresos Proyectados − COGS Estimado − Costos Fijos · Proyección lineal sobre el día {per.dia_actual}
            </div>
            <GraficaUtilidad canales={canales} bep={bep} utilidad={utilidad} sinIva={sinIva} />
            <div style={{ marginTop: 12, padding: 12, background: c.input, borderRadius: 8, borderLeft: `3px solid ${utilidadColor}` }}>
              <div style={{ fontSize: 13, color: c.text }}>
                <strong style={{ color: utilidadColor }}>
                  {utilidadProyActivo >= 0 ? '✓ Utilidad positiva' : '✗ Utilidad negativa'}
                </strong>
                : Si el ritmo se mantiene, cerrarás el mes con <strong>{fmtUSD(utilidadProyActivo)}</strong> de utilidad neta
                ({fmtPct(margenNetoActivo)} margen, base {sinIva?'Sin IVA':'Con IVA'}).
                {utilidadProyActivo < 0 && (
                  <span> Para llegar a BEP necesitás vender <strong>{fmtUSD(faltanteBepActivo)}</strong> más en los próximos {per.dias_mes - per.dia_actual} días.</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Detalle diario */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Detalle diario por canal <span style={{ fontWeight: 500, fontSize: 12, color: c.textDim }}>({sinIva ? 'Sin IVA' : 'Con IVA'})</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${c.border}` }}>
                <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Día</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.green }}>Quanto</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.pink }}>PEYA</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.purple }}>Eventos</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.cyan, fontWeight: 700 }}>Total</th>
                <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {(serie_diaria || []).map(d => {
                const finde = [0,6].includes(d.dow)
                const dQuanto = sinIva ? Number(d.quanto_si || 0) : Number(d.quanto || 0)
                const dPeya = sinIva ? Number(d.peya_si || 0) : Number(d.peya || 0)
                const dEventos = sinIva ? Number(d.eventos_si || 0) : Number(d.eventos || 0)
                const dTotal = sinIva ? Number(d.todas_si || 0) : Number(d.todas || 0)
                return (
                  <tr key={d.fecha} style={{
                    borderBottom: `1px solid ${c.border}`,
                    background: finde ? '#1a1f2a' : 'transparent',
                  }}>
                    <td style={{ padding: 8 }}>{fmtFecha(d.fecha)}</td>
                    <td style={{ padding: 8, color: finde ? c.orange : c.textDim, fontWeight: finde ? 700 : 400 }}>
                      {DIAS_CORTO[d.dow]}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{dQuanto > 0 ? fmtUSD(dQuanto) : '—'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{dPeya > 0 ? fmtUSD(dPeya) : '—'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{dEventos > 0 ? fmtUSD(dEventos) : '—'}</td>
                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: c.cyan }}>{fmtUSD(dTotal)}</td>
                    <td style={{ padding: 8, textAlign: 'right', color: c.textDim }}>{d.pedidos_todas}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
