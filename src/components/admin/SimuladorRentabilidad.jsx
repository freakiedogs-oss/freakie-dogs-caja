import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'

/**
 * SimuladorRentabilidad — Análisis "what-if" interactivo para escenarios:
 *  - 3 nuevas sucursales (Metro Centro food_court, Plaza Integración express, Plaza Olímpica express)
 *  - Crecimiento de sucursales existentes
 *  - Mejora de ratio CV (negociación proveedores, mix menú)
 *  - Meta de rentabilidad
 *
 * Lee base actual de fn_ventas_totales_dashboard.
 * Cálculos en cliente (useMemo) - 100% reactivo.
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

// Definición de las 3 sucursales nuevas con asunciones por defecto
// Express: menos planilla (3 personas), menor renta. Food court: full operation.
const NUEVAS_SUCURSALES_DEFAULT = [
  { 
    store_code: 'S006', nombre: 'Metro Centro 8va Etapa', tipo: 'food_court',
    color: c.purple, icon: '🏬',
    ventas_si: 50000, cf_alquiler: 8000, n_personas: 5, salario_prom: 446
  },
  { 
    store_code: 'S007', nombre: 'Plaza Integración', tipo: 'express',
    color: c.cyan, icon: '🏪',
    ventas_si: 28000, cf_alquiler: 4500, n_personas: 3, salario_prom: 400
  },
  { 
    store_code: 'S008', nombre: 'Plaza Olímpica', tipo: 'express',
    color: c.pink, icon: '🏪',
    ventas_si: 28000, cf_alquiler: 4500, n_personas: 3, salario_prom: 400
  },
]

const PATRONAL_RATIO = 0.115  // ISSS 7.5% + AFP 6.75% + INSAFORP 1% - topes

function fmtUSD(v) {
  return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtUSDInt(v) {
  return '$' + Math.round(Number(v) || 0).toLocaleString('en-US')
}
function fmtPct(v, decimals = 2) {
  return (Number(v) || 0).toFixed(decimals) + '%'
}

// ─────────────────────────────────────────────────────────
// Slider control
// ─────────────────────────────────────────────────────────
function Slider({ label, value, onChange, min, max, step, format = (v) => v, color = c.blue, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: c.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color }}>{format(value)}</div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color, height: 5 }}
      />
      {hint && <div style={{ fontSize: 10, color: c.textDim, marginTop: 2, fontStyle: 'italic' }}>{hint}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// KPI bullet card
// ─────────────────────────────────────────────────────────
function KpiBullet({ label, valor, color, sub }) {
  return (
    <div style={{ background: c.input, borderRadius: 10, padding: 12, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: c.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Card de sucursal nueva con sliders propios
// ─────────────────────────────────────────────────────────
function SucursalNuevaCard({ suc, enabled, onToggle, ventas, setVentas, alquiler, setAlquiler, personas, setPersonas, salario, setSalario }) {
  const patronal = personas * salario * PATRONAL_RATIO
  const planilla_total = personas * salario + patronal
  const cf_total = enabled ? alquiler + planilla_total : 0

  return (
    <div style={{
      background: c.input, borderRadius: 10, padding: 14,
      borderLeft: `4px solid ${enabled ? suc.color : c.border}`,
      opacity: enabled ? 1 : 0.5, transition: 'all 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: enabled ? suc.color : c.textDim }}>
            {suc.icon} {suc.nombre}
          </div>
          <div style={{ fontSize: 10, color: c.textDim, marginTop: 2 }}>
            {suc.store_code} · {suc.tipo}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} 
                 style={{ accentColor: suc.color, width: 18, height: 18 }} />
          <span style={{ fontSize: 12, color: enabled ? c.green : c.textDim, fontWeight: 600 }}>
            {enabled ? 'Abrir' : 'Cerrada'}
          </span>
        </label>
      </div>

      {enabled && (
        <>
          <Slider label="Ventas mensuales (Sin IVA)" value={ventas} onChange={setVentas}
                  min={0} max={120000} step={1000} format={fmtUSDInt} color={suc.color}
                  hint={`Con IVA aprox ${fmtUSDInt(ventas * 1.13)}`} />
          <Slider label="Alquiler + servicios" value={alquiler} onChange={setAlquiler}
                  min={0} max={20000} step={250} format={fmtUSDInt} color={c.orange} />
          <Slider label="N° personas" value={personas} onChange={setPersonas}
                  min={0} max={15} step={1} format={(v) => `${v} personas`} color={c.yellow} />
          <Slider label="Salario promedio" value={salario} onChange={setSalario}
                  min={300} max={800} step={25} format={fmtUSDInt} color={c.blue}
                  hint={`Planilla total ${fmtUSDInt(planilla_total)} (incluye patronal 11.5%)`} />

          <div style={{ marginTop: 8, padding: 8, background: c.bg, borderRadius: 6, fontSize: 12, color: c.text }}>
            CF mensual sucursal: <strong style={{ color: c.orange }}>{fmtUSD(cf_total)}</strong> · 
            BEP individual: <strong>{fmtUSDInt(cf_total / 0.4457)}</strong>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────
export default function SimuladorRentabilidad({ user }) {
  const [base, setBase] = useState(null)
  const [loading, setLoading] = useState(true)

  // Variables globales
  const [crecimientoExistentes, setCrecimientoExistentes] = useState(0)
  const [reduccionCV, setReduccionCV] = useState(0)
  const [metaRent, setMetaRent] = useState(5)

  // Estado por sucursal nueva (3 instancias)
  const [s006Enabled, setS006Enabled] = useState(true)
  const [s006Ventas, setS006Ventas] = useState(50000)
  const [s006Alquiler, setS006Alquiler] = useState(8000)
  const [s006Personas, setS006Personas] = useState(5)
  const [s006Salario, setS006Salario] = useState(446)

  const [s007Enabled, setS007Enabled] = useState(true)
  const [s007Ventas, setS007Ventas] = useState(28000)
  const [s007Alquiler, setS007Alquiler] = useState(4500)
  const [s007Personas, setS007Personas] = useState(3)
  const [s007Salario, setS007Salario] = useState(400)

  const [s008Enabled, setS008Enabled] = useState(true)
  const [s008Ventas, setS008Ventas] = useState(28000)
  const [s008Alquiler, setS008Alquiler] = useState(4500)
  const [s008Personas, setS008Personas] = useState(3)
  const [s008Salario, setS008Salario] = useState(400)

  // Acceso
  if (!['superadmin','ejecutivo'].includes(user?.rol || '')) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ ...cardStyle, borderColor: c.red, textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>🚫</div>
          <div style={{ color: c.text, fontWeight: 700 }}>Dashboard restringido</div>
        </div>
      </div>
    )
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const now = new Date()
      const { data, error } = await db.rpc('fn_ventas_totales_dashboard', {
        p_anio: now.getFullYear(), p_mes: now.getMonth() + 1,
      })
      if (cancelled) return
      if (error) console.error(error)
      setBase(data || null)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const sim = useMemo(() => {
    if (!base) return null
    const ventas_grupo_si = Number(base.canales?.todas?.proyeccion_si || 0)
    const ratio_cv_base = Number(base.bep?.ratio_cv || 0.5543)
    const cf_actual = Number(base.bep?.costos_fijos_total || 0)

    const ratio_cv_nuevo = Math.max(ratio_cv_base - reduccionCV / 100, 0.30)
    const margen_nuevo = 1 - ratio_cv_nuevo
    const ventas_existentes_ajustadas = ventas_grupo_si * (1 + crecimientoExistentes / 100)

    // Ventas y CF de cada nueva sucursal (solo si están habilitadas)
    const calcSuc = (en, v, alq, p, s) => en ? {
      ventas: v,
      cf: alq + p * s * (1 + PATRONAL_RATIO),
    } : { ventas: 0, cf: 0 }

    const s006 = calcSuc(s006Enabled, s006Ventas, s006Alquiler, s006Personas, s006Salario)
    const s007 = calcSuc(s007Enabled, s007Ventas, s007Alquiler, s007Personas, s007Salario)
    const s008 = calcSuc(s008Enabled, s008Ventas, s008Alquiler, s008Personas, s008Salario)

    const ventas_nuevas = s006.ventas + s007.ventas + s008.ventas
    const cf_nuevas = s006.cf + s007.cf + s008.cf

    const ventas_totales = ventas_existentes_ajustadas + ventas_nuevas
    const cf_total = cf_actual + cf_nuevas
    const cv_total = ventas_totales * ratio_cv_nuevo
    const utilidad = ventas_totales - cv_total - cf_total
    const margen_neto_pct = ventas_totales > 0 ? (utilidad / ventas_totales) * 100 : 0

    const ventas_req_total = (margen_nuevo - metaRent / 100) > 0
      ? cf_total / (margen_nuevo - metaRent / 100) : null
    const gap = ventas_req_total ? ventas_req_total - ventas_totales : null
    const bep = cf_total / margen_nuevo

    return {
      ventas_grupo_si, ratio_cv_base, ratio_cv_nuevo, margen_nuevo,
      cf_actual, cf_total, cf_nuevas,
      ventas_existentes_ajustadas, ventas_nuevas, ventas_totales,
      cv_total, utilidad, margen_neto_pct,
      ventas_req_total, gap, bep,
      meta_alcanzada: margen_neto_pct >= metaRent,
      sucursales: { S006: s006, S007: s007, S008: s008 },
    }
  }, [base, crecimientoExistentes, reduccionCV, metaRent,
      s006Enabled, s006Ventas, s006Alquiler, s006Personas, s006Salario,
      s007Enabled, s007Ventas, s007Alquiler, s007Personas, s007Salario,
      s008Enabled, s008Ventas, s008Alquiler, s008Personas, s008Salario])

  const resetEscenario = useCallback((preset) => {
    if (preset === 'status_quo') {
      setS006Enabled(false); setS007Enabled(false); setS008Enabled(false)
      setCrecimientoExistentes(0); setReduccionCV(0); setMetaRent(5)
    } else if (preset === 'solo_metro') {
      setS006Enabled(true); setS007Enabled(false); setS008Enabled(false)
      setCrecimientoExistentes(0); setReduccionCV(0); setMetaRent(5)
    } else if (preset === 'tres_aperturas') {
      setS006Enabled(true); setS007Enabled(true); setS008Enabled(true)
      setCrecimientoExistentes(0); setReduccionCV(0); setMetaRent(5)
    } else if (preset === 'aperturas_optimistas') {
      setS006Enabled(true); setS007Enabled(true); setS008Enabled(true)
      setCrecimientoExistentes(10); setReduccionCV(2); setMetaRent(5)
    } else if (preset === 'aperturas_agresivas') {
      setS006Enabled(true); setS007Enabled(true); setS008Enabled(true)
      setCrecimientoExistentes(15); setReduccionCV(4); setMetaRent(8)
    }
  }, [])

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>Cargando base actual…</div>
  if (!base || !sim) return <div style={{ padding: 30, textAlign: 'center', color: c.red }}>Error cargando datos base</div>

  const utilidadColor = sim.utilidad >= 0 ? c.green : c.red
  const margenColor = sim.margen_neto_pct >= metaRent ? c.green : sim.margen_neto_pct >= 0 ? c.yellow : c.red
  const utilidadBase = Number(base.utilidad?.utilidad_proyectada || 0)
  const margenBase = Number(base.utilidad?.margen_neto_pct || 0)

  return (
    <div style={{ background: c.bg, minHeight: '100vh', padding: 16, color: c.text, maxWidth: 1500, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: c.textDim }}>Análisis "what-if" · Sin IVA · base contable</div>
        <h1 style={{ margin: '4px 0', fontSize: 26 }}>🎯 Simulador de Rentabilidad — Plan de Expansión</h1>
        <div style={{ fontSize: 13, color: c.textDim }}>
          Base actual: ventas grupo {fmtUSD(sim.ventas_grupo_si)}/mes · ratio CV {fmtPct(sim.ratio_cv_base * 100)} · CF {fmtUSD(sim.cf_actual)} · margen {fmtPct(margenBase)}
        </div>
      </div>

      {/* Presets */}
      <div style={{ ...cardStyle, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: c.textDim, marginRight: 4 }}>ESCENARIOS:</span>
        {[
          { k: 'status_quo', l: 'Status quo (sin aperturas)' },
          { k: 'solo_metro', l: 'Solo Metro' },
          { k: 'tres_aperturas', l: '3 aperturas básico' },
          { k: 'aperturas_optimistas', l: '3 aperturas + crecer 10% + CV -2pp' },
          { k: 'aperturas_agresivas', l: '3 aperturas + crecer 15% + CV -4pp (meta 8%)' },
        ].map(p => (
          <button key={p.k} onClick={() => resetEscenario(p.k)}
                  style={{ padding: '6px 12px', borderRadius: 8, background: c.input, color: c.text, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 12 }}>
            {p.l}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,420px) 1fr', gap: 16, alignItems: 'flex-start' }}>
        {/* Panel de controles */}
        <div>
          {/* Variables globales */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>🌐 Variables del grupo</div>
            <Slider label="Crecimiento ventas existentes" value={crecimientoExistentes} onChange={setCrecimientoExistentes}
                    min={-20} max={50} step={1} format={(v) => `${v >= 0 ? '+' : ''}${v}%`} color={c.blue}
                    hint="Cambio % vs ventas actuales en las 5 sucursales" />
            <Slider label="Reducción del Ratio CV" value={reduccionCV} onChange={setReduccionCV}
                    min={0} max={10} step={0.5} format={(v) => `-${v} pp`} color={c.green}
                    hint={`CV actual ${fmtPct(sim.ratio_cv_base * 100)} → nuevo ${fmtPct(sim.ratio_cv_nuevo * 100)}`} />
            <Slider label="Meta de rentabilidad global" value={metaRent} onChange={setMetaRent}
                    min={0} max={15} step={0.5} format={(v) => `${v}%`} color={c.yellow}
                    hint="Utilidad neta / Ventas totales" />
          </div>

          {/* 3 sucursales nuevas */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>🏗️ Aperturas planificadas</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SucursalNuevaCard
                suc={NUEVAS_SUCURSALES_DEFAULT[0]}
                enabled={s006Enabled} onToggle={setS006Enabled}
                ventas={s006Ventas} setVentas={setS006Ventas}
                alquiler={s006Alquiler} setAlquiler={setS006Alquiler}
                personas={s006Personas} setPersonas={setS006Personas}
                salario={s006Salario} setSalario={setS006Salario}
              />
              <SucursalNuevaCard
                suc={NUEVAS_SUCURSALES_DEFAULT[1]}
                enabled={s007Enabled} onToggle={setS007Enabled}
                ventas={s007Ventas} setVentas={setS007Ventas}
                alquiler={s007Alquiler} setAlquiler={setS007Alquiler}
                personas={s007Personas} setPersonas={setS007Personas}
                salario={s007Salario} setSalario={setS007Salario}
              />
              <SucursalNuevaCard
                suc={NUEVAS_SUCURSALES_DEFAULT[2]}
                enabled={s008Enabled} onToggle={setS008Enabled}
                ventas={s008Ventas} setVentas={setS008Ventas}
                alquiler={s008Alquiler} setAlquiler={setS008Alquiler}
                personas={s008Personas} setPersonas={setS008Personas}
                salario={s008Salario} setSalario={setS008Salario}
              />
            </div>
          </div>
        </div>

        {/* Panel de resultados */}
        <div>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
            <KpiBullet label="Ventas Totales" valor={fmtUSD(sim.ventas_totales)} color={c.cyan}
                       sub={`Exist ${fmtUSDInt(sim.ventas_existentes_ajustadas)} + Nuevas ${fmtUSDInt(sim.ventas_nuevas)}`} />
            <KpiBullet label="Costos Variables" valor={fmtUSD(sim.cv_total)} color={c.red}
                       sub={`${fmtPct(sim.ratio_cv_nuevo * 100)} ratio CV`} />
            <KpiBullet label="Costos Fijos" valor={fmtUSD(sim.cf_total)} color={c.orange}
                       sub={`Existentes + ${fmtUSDInt(sim.cf_nuevas)} aperturas`} />
            <KpiBullet label="Utilidad Neta" valor={fmtUSD(sim.utilidad)} color={utilidadColor}
                       sub={`Margen ${fmtPct(sim.margen_neto_pct)}`} />
            <KpiBullet label={`Meta: ${fmtPct(metaRent, 1)}`}
                       valor={sim.meta_alcanzada ? '✓ Alcanzada' : `Faltan ${fmtUSDInt(Math.max(0, sim.gap || 0))}`}
                       color={sim.meta_alcanzada ? c.green : c.yellow}
                       sub={sim.gap > 0 ? `${fmtPct(sim.margen_neto_pct)} vs meta` : `${fmtPct(sim.margen_neto_pct - metaRent)} arriba`} />
          </div>

          {/* Waterfall */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>💧 Waterfall P&L mensual (Sin IVA)</div>
            <WaterfallSim sim={sim} />
          </div>

          {/* Análisis */}
          <div style={{ ...cardStyle, borderLeft: `4px solid ${margenColor}` }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: margenColor }}>
              {sim.meta_alcanzada ? '✓ Meta alcanzada' : sim.utilidad >= 0 ? '⚠️ Rentable pero debajo de meta' : '✗ Pérdida'}
            </div>
            <div style={{ fontSize: 13, color: c.text, lineHeight: 1.6 }}>
              <ul style={{ margin: '6px 0 6px 18px', padding: 0 }}>
                <li>Ventas totales: <strong>{fmtUSD(sim.ventas_totales)}</strong> Sin IVA mensual ({sim.ventas_existentes_ajustadas > 0 && `+${fmtPct((sim.ventas_totales/sim.ventas_grupo_si-1)*100)} vs base`})</li>
                <li>Utilidad neta: <strong style={{ color: utilidadColor }}>{fmtUSD(sim.utilidad)}</strong> (margen {fmtPct(sim.margen_neto_pct)}) · base actual: {fmtUSD(utilidadBase)}</li>
                <li>BEP del grupo (utilidad 0): <strong>{fmtUSD(sim.bep)}</strong></li>
                {sim.gap > 0 && (
                  <li style={{ color: c.yellow }}>
                    Para llegar a {fmtPct(metaRent, 1)}: faltan <strong>{fmtUSDInt(sim.gap)}</strong> de ventas adicionales
                  </li>
                )}
                {sim.meta_alcanzada && (
                  <li style={{ color: c.green }}>
                    Estás {fmtPct(sim.margen_neto_pct - metaRent)} arriba de la meta. Buffer mensual: <strong>{fmtUSDInt(sim.utilidad - (sim.ventas_totales * metaRent / 100))}</strong>
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Desglose por sucursal nueva */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>📍 Aporte de cada apertura</div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${c.border}` }}>
                  <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Sucursal</th>
                  <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Ventas</th>
                  <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>CV</th>
                  <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>CF</th>
                  <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Contrib. utilidad</th>
                </tr>
              </thead>
              <tbody>
                {NUEVAS_SUCURSALES_DEFAULT.map(suc => {
                  const s = sim.sucursales[suc.store_code]
                  if (!s || s.ventas === 0) return (
                    <tr key={suc.store_code} style={{ borderBottom: `1px solid ${c.border}`, opacity: 0.4 }}>
                      <td style={{ padding: 8 }}>{suc.icon} {suc.nombre}</td>
                      <td colSpan={4} style={{ padding: 8, textAlign: 'center', color: c.textOff }}>— sin abrir —</td>
                    </tr>
                  )
                  const cv = s.ventas * sim.ratio_cv_nuevo
                  const contrib = s.ventas - cv - s.cf
                  const contribColor = contrib >= 0 ? c.green : c.red
                  return (
                    <tr key={suc.store_code} style={{ borderBottom: `1px solid ${c.border}` }}>
                      <td style={{ padding: 8 }}>
                        <span style={{ color: suc.color, fontWeight: 700 }}>{suc.icon} {suc.nombre}</span>
                        <div style={{ fontSize: 10, color: c.textDim }}>{suc.store_code} · {suc.tipo}</div>
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{fmtUSD(s.ventas)}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: c.red }}>-{fmtUSD(cv)}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: c.orange }}>-{fmtUSD(s.cf)}</td>
                      <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: contribColor }}>
                        {contrib >= 0 ? '' : '−'}{fmtUSD(Math.abs(contrib))}
                      </td>
                    </tr>
                  )
                })}
                <tr style={{ background: '#0f1419' }}>
                  <td style={{ padding: 8, fontWeight: 700 }}>Total aperturas</td>
                  <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{fmtUSD(sim.ventas_nuevas)}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: c.red, fontWeight: 700 }}>-{fmtUSD(sim.ventas_nuevas * sim.ratio_cv_nuevo)}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: c.orange, fontWeight: 700 }}>-{fmtUSD(sim.cf_nuevas)}</td>
                  <td style={{ padding: 8, textAlign: 'right', fontWeight: 800, color: (sim.ventas_nuevas * sim.margen_nuevo - sim.cf_nuevas) >= 0 ? c.green : c.red }}>
                    {fmtUSD(sim.ventas_nuevas * sim.margen_nuevo - sim.cf_nuevas)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Waterfall del simulador
// ─────────────────────────────────────────────────────────
function WaterfallSim({ sim }) {
  const W = 900, H = 220
  const padL = 60, padR = 24, padT = 18, padB = 50
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const barras = [
    { label: 'Ingresos', valor: sim.ventas_totales, color: c.green },
    { label: '− COGS', valor: sim.cv_total, color: c.red, sub: `${(sim.ratio_cv_nuevo * 100).toFixed(1)}%` },
    { label: '− CF', valor: sim.cf_total, color: c.orange },
    { label: 'Utilidad', valor: sim.utilidad, color: sim.utilidad >= 0 ? c.green : c.red },
  ]
  const maxVal = Math.max(Math.abs(sim.ventas_totales), Math.abs(sim.cv_total), Math.abs(sim.cf_total), Math.abs(sim.utilidad)) * 1.15 || 100
  const barWidth = innerW / barras.length - 20
  const yScale = (v) => padT + innerH - (Math.abs(v) / maxVal) * innerH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 600, height: 'auto', display: 'block' }}>
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
        const x = padL + i * (innerW / barras.length) + 10
        const yTop = yScale(b.valor)
        const h = (H - padB) - yTop
        return (
          <g key={b.label}>
            <rect x={x} y={yTop} width={barWidth} height={h} fill={b.color} opacity="0.85" rx="4" />
            <text x={x + barWidth / 2} y={yTop - 6} fill={b.color} fontSize="13" textAnchor="middle" fontWeight="700">{fmtUSD(b.valor)}</text>
            <text x={x + barWidth / 2} y={H - padB + 16} fill={c.text} fontSize="12" textAnchor="middle" fontWeight="600">{b.label}</text>
            {b.sub && <text x={x + barWidth / 2} y={H - padB + 30} fill={c.textDim} fontSize="10" textAnchor="middle">{b.sub}</text>}
          </g>
        )
      })}
    </svg>
  )
}
