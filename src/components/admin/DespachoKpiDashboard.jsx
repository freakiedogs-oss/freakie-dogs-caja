import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'

/**
 * DespachoKpiDashboard — Dashboard del KPI de Despacho.
 * VISIBLE SOLO PARA superadmin (Cesar).
 *
 * - Selector de rango (hoy, 7d, 30d, custom)
 * - KPI cards: tiempo promedio, verde/amarillo/rojo, llegadas tarde
 * - Gráfica de barras: tiempo promedio diario con refs 30 y 45 min
 * - Comparativa por motorista (Ángel vs Israel)
 * - Tabla por sucursal
 * - Tabla detallada con filtros + exportar CSV
 * - Historial sin límite
 */

const c = {
  bg: '#0a0a0a', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  purple: '#a78bfa', border: '#333', text: '#f0f0f0',
  textDim: '#888', textOff: '#555',
}

const cardStyle = {
  background: c.card,
  border: `1px solid ${c.cardBorder}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
}

const btn = {
  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600, transition: '0.15s',
}

function isoDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0]
}

function rangoDefault(dias) {
  const fin = new Date()
  const ini = new Date()
  ini.setDate(ini.getDate() - dias)
  return { inicio: isoDate(ini), fin: isoDate(fin) }
}

function fmtHora(iso) {
  if (!iso) return '--'
  return new Date(iso).toLocaleTimeString('es-SV', {
    timeZone: 'America/El_Salvador',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtFecha(iso) {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', {
    day: '2-digit', month: 'short', year: '2-digit',
  })
}

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
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

export default function DespachoKpiDashboard({ user }) {
  const [config, setConfig] = useState(null)
  const [periodo, setPeriodo] = useState(() => rangoDefault(30))
  const [datos, setDatos] = useState(null)     // resultado de fn_kpi_despacho_dashboard
  const [detalle, setDetalle] = useState([])   // filas individuales del rango (para tabla + filtros)
  const [loading, setLoading] = useState(true)

  // Filtros tabla
  const [filtroMot, setFiltroMot]   = useState('todos')
  const [filtroColor, setFiltroColor] = useState('todos')
  const [filtroTarde, setFiltroTarde] = useState(false)

  // Permisos
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
    const [{ data: cfg }, { data: kpi }, { data: rows }] = await Promise.all([
      db.from('configuracion_despacho_kpi').select('*').eq('id', 1).single(),
      db.rpc('fn_kpi_despacho_dashboard', { p_fecha_inicio: periodo.inicio, p_fecha_fin: periodo.fin }),
      db.from('v_despachos_kpi').select('*')
        .gte('fecha', periodo.inicio).lte('fecha', periodo.fin)
        .order('hora_llegada', { ascending: false })
        .limit(2000),
    ])
    setConfig(cfg || null)
    setDatos(kpi || null)
    setDetalle(rows || [])
    setLoading(false)
  }, [periodo.inicio, periodo.fin])

  useEffect(() => { cargar() }, [cargar])

  const tiempoVerde    = config?.tiempo_max_verde_min    || 30
  const tiempoAmarillo = config?.tiempo_max_amarillo_min || 45

  // Datos para gráficas
  const serieDiaria = datos?.serie_diaria || []

  // Filtrar tabla detalle
  const detalleFiltrado = useMemo(() => {
    return detalle.filter(r => {
      if (filtroMot !== 'todos' && r.motorista_nombre !== filtroMot) return false
      if (filtroColor !== 'todos' && r.color_semaforo !== filtroColor) return false
      if (filtroTarde && !r.llego_tarde) return false
      return true
    })
  }, [detalle, filtroMot, filtroColor, filtroTarde])

  const motoristasUnicos = useMemo(
    () => [...new Set(detalle.map(r => r.motorista_nombre))].filter(Boolean).sort(),
    [detalle]
  )

  const exportarCSV = () => {
    const headers = ['Fecha', 'Motorista', 'Ciclo', 'Llegada', 'Salida', 'Tiempo (min)', 'Color', 'Llegó tarde', 'Motivo tardanza', 'Sucursales', 'Notas', 'Justificación', 'Estado']
    const rows = [headers]
    detalleFiltrado.forEach(d => {
      rows.push([
        d.fecha,
        d.motorista_nombre,
        d.numero_ciclo,
        fmtHora(d.hora_llegada),
        fmtHora(d.hora_salida),
        d.tiempo_despacho_minutos,
        d.color_semaforo,
        d.llego_tarde ? 'sí' : 'no',
        d.motivo_tardanza || '',
        (d.sucursales || []).map(s => s.sucursal_nombre).join(' | '),
        d.notas_generales || '',
        d.justificacion ? `${d.justificacion.categoria}: ${d.justificacion.detalle || ''}` : '',
        d.estado,
      ])
    })
    downloadCSV(`kpi_despacho_${periodo.inicio}_${periodo.fin}.csv`, rows)
  }

  return (
    <div style={{ background: c.bg, minHeight: '100vh', padding: 16, color: c.text, maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: c.textDim }}>Dashboard · Super Admin</div>
        <h1 style={{ margin: '4px 0', fontSize: 26 }}>KPI Despacho a Motoristas</h1>
        <div style={{ fontSize: 13, color: c.textDim }}>
          {fmtFecha(periodo.inicio)} → {fmtFecha(periodo.fin)} · Verde &lt;{tiempoVerde}m · Amarillo {tiempoVerde}-{tiempoAmarillo}m · Rojo &gt;{tiempoAmarillo}m
        </div>
      </div>

      {/* Selector de rango */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Período:</strong>
        <button onClick={() => setPeriodo(rangoDefault(0))}   style={{ ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>Hoy</button>
        <button onClick={() => setPeriodo(rangoDefault(7))}   style={{ ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>7d</button>
        <button onClick={() => setPeriodo(rangoDefault(30))}  style={{ ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>30d</button>
        <button onClick={() => setPeriodo(rangoDefault(90))}  style={{ ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>90d</button>
        <button onClick={() => setPeriodo(rangoDefault(365))} style={{ ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}` }}>1 año</button>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: c.textDim }}>Desde:</label>
        <input type="date" value={periodo.inicio} onChange={e => setPeriodo(p => ({ ...p, inicio: e.target.value }))}
               style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 6, padding: 6, fontSize: 13 }} />
        <label style={{ fontSize: 12, color: c.textDim }}>Hasta:</label>
        <input type="date" value={periodo.fin} onChange={e => setPeriodo(p => ({ ...p, fin: e.target.value }))}
               style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 6, padding: 6, fontSize: 13 }} />
        <button onClick={exportarCSV} style={{ ...btn, background: c.greenDark, color: '#fff' }}>
          📥 Exportar CSV ({detalleFiltrado.length})
        </button>
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: c.textDim }}>Cargando…</div>}

      {!loading && datos && (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Despachos</div>
              <div style={{ fontSize: 32, fontWeight: 800 }}>{datos.totales.despachos}</div>
            </div>
            <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>Tiempo Promedio</div>
              <div style={{ fontSize: 32, fontWeight: 800,
                color: datos.totales.tiempo_promedio_min < tiempoVerde ? c.green
                  : datos.totales.tiempo_promedio_min < tiempoAmarillo ? c.yellow : c.red }}>
                {datos.totales.tiempo_promedio_min}<span style={{ fontSize: 14, color: c.textDim }}> min</span>
              </div>
            </div>
            <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: c.green }}>
              <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🟢 Verde</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: c.green }}>{datos.totales.verde}</div>
              <div style={{ fontSize: 11, color: c.textDim }}>
                {datos.totales.despachos > 0 ? Math.round(datos.totales.verde * 100 / datos.totales.despachos) : 0}%
              </div>
            </div>
            <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: c.yellow }}>
              <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🟡 Amarillo</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: c.yellow }}>{datos.totales.amarillo}</div>
              <div style={{ fontSize: 11, color: c.textDim }}>
                {datos.totales.despachos > 0 ? Math.round(datos.totales.amarillo * 100 / datos.totales.despachos) : 0}%
              </div>
            </div>
            <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: c.red }}>
              <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🔴 Rojo</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: c.red }}>{datos.totales.rojo}</div>
              <div style={{ fontSize: 11, color: c.textDim }}>
                {datos.totales.despachos > 0 ? Math.round(datos.totales.rojo * 100 / datos.totales.despachos) : 0}%
              </div>
            </div>
            <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center', borderColor: c.orange }}>
              <div style={{ fontSize: 11, color: c.textDim, textTransform: 'uppercase' }}>🕐 Llegadas Tarde</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: c.orange }}>{datos.totales.llegadas_tarde}</div>
            </div>
          </div>

          {/* Serie diaria — barras CSS simples (sin dependencias) */}
          {serieDiaria.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>Tiempo promedio · día a día</div>
                <div style={{ fontSize: 11, color: c.textDim }}>
                  <span style={{ color: c.green }}>● &lt;{tiempoVerde}m</span>{' · '}
                  <span style={{ color: c.yellow }}>● {tiempoVerde}-{tiempoAmarillo}m</span>{' · '}
                  <span style={{ color: c.red }}>● &gt;{tiempoAmarillo}m</span>
                </div>
              </div>
              {(() => {
                const maxT = Math.max(...serieDiaria.map(d => d.tiempo_promedio_min || 0), tiempoAmarillo + 5)
                return (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 180, padding: '0 4px', borderBottom: `1px solid ${c.border}` }}>
                    {serieDiaria.map(d => {
                      const t = Number(d.tiempo_promedio_min || 0)
                      const h = Math.max(4, Math.round((t / maxT) * 160))
                      const color = t < tiempoVerde ? c.green : t < tiempoAmarillo ? c.yellow : c.red
                      return (
                        <div key={d.fecha} title={`${d.fecha}: ${t} min (${d.despachos} despachos)`}
                             style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: c.textDim, marginBottom: 4 }}>{t}</div>
                          <div style={{ width: '100%', height: h, background: color, borderRadius: '4px 4px 0 0', minWidth: 4 }} />
                          <div style={{ fontSize: 9, color: c.textDim, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                            {new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Por motorista + Por sucursal */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div style={{ ...cardStyle, marginBottom: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Por motorista</div>
              {(datos.por_motorista || []).length === 0 && <div style={{ color: c.textDim }}>Sin datos</div>}
              {(datos.por_motorista || []).map(m => (
                <div key={m.motorista_nombre} style={{ padding: 10, background: c.input, borderRadius: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{m.motorista_nombre}</strong>
                    <span style={{
                      fontSize: 18, fontWeight: 800,
                      color: m.tiempo_promedio_min < tiempoVerde ? c.green : m.tiempo_promedio_min < tiempoAmarillo ? c.yellow : c.red
                    }}>
                      {m.tiempo_promedio_min} min
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: c.textDim, marginTop: 4 }}>
                    {m.despachos} despachos · 🟢{m.verde} 🟡{m.amarillo} 🔴{m.rojo}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...cardStyle, marginBottom: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Por sucursal destino</div>
              {(datos.por_sucursal || []).length === 0 && <div style={{ color: c.textDim }}>Sin datos</div>}
              {(datos.por_sucursal || []).map(s => (
                <div key={s.store_code} style={{ padding: 10, background: c.input, borderRadius: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{s.sucursal_nombre}</strong>
                      <span style={{ color: c.textDim, fontSize: 12, marginLeft: 6 }}>· {s.store_code}</span>
                    </div>
                    <span style={{ fontSize: 16, fontWeight: 700,
                      color: s.tiempo_promedio_min < tiempoVerde ? c.green : s.tiempo_promedio_min < tiempoAmarillo ? c.yellow : c.red }}>
                      {s.tiempo_promedio_min} min
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: c.textDim, marginTop: 4 }}>
                    {s.despachos} despachos {s.rojos > 0 && <span style={{ color: c.red }}> · 🔴 {s.rojos}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Filtros tabla */}
          <div style={{ ...cardStyle, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>Filtros:</strong>
            <select value={filtroMot} onChange={e => setFiltroMot(e.target.value)}
                    style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 6, padding: 6, fontSize: 13 }}>
              <option value="todos">Todos los motoristas</option>
              {motoristasUnicos.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filtroColor} onChange={e => setFiltroColor(e.target.value)}
                    style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 6, padding: 6, fontSize: 13 }}>
              <option value="todos">Todos los colores</option>
              <option value="verde">🟢 Verde</option>
              <option value="amarillo">🟡 Amarillo</option>
              <option value="rojo">🔴 Rojo</option>
              <option value="gris">⚫ Anulado</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: c.textDim, fontSize: 13 }}>
              <input type="checkbox" checked={filtroTarde} onChange={e => setFiltroTarde(e.target.checked)} />
              Solo llegadas tarde
            </label>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12, color: c.textDim }}>
              Mostrando {detalleFiltrado.length} de {detalle.length}
            </div>
          </div>

          {/* Tabla detalle */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Detalle de despachos</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${c.border}` }}>
                    <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Fecha</th>
                    <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Motorista</th>
                    <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Llegada</th>
                    <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Salida</th>
                    <th style={{ textAlign: 'right', padding: 8, color: c.textDim }}>Min</th>
                    <th style={{ textAlign: 'center', padding: 8, color: c.textDim }}>Color</th>
                    <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Sucursales</th>
                    <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Notas</th>
                    <th style={{ textAlign: 'left', padding: 8, color: c.textDim }}>Justif.</th>
                  </tr>
                </thead>
                <tbody>
                  {detalleFiltrado.slice(0, 200).map(d => (
                    <tr key={d.id} style={{ borderBottom: `1px solid ${c.border}` }}>
                      <td style={{ padding: 8 }}>{fmtFecha(d.fecha)}</td>
                      <td style={{ padding: 8 }}>
                        {d.motorista_nombre}
                        <span style={{ color: c.textDim, marginLeft: 4 }}>#{d.numero_ciclo}</span>
                        {d.llego_tarde && <span style={{ color: c.orange, marginLeft: 6 }} title={d.motivo_tardanza}>🕐</span>}
                      </td>
                      <td style={{ padding: 8 }}>{fmtHora(d.hora_llegada)}</td>
                      <td style={{ padding: 8 }}>{fmtHora(d.hora_salida)}</td>
                      <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>
                        {d.tiempo_despacho_minutos ?? '—'}
                      </td>
                      <td style={{ padding: 8, textAlign: 'center' }}>
                        {d.color_semaforo === 'verde'    && '🟢'}
                        {d.color_semaforo === 'amarillo' && '🟡'}
                        {d.color_semaforo === 'rojo'     && '🔴'}
                        {d.color_semaforo === 'gris'     && '⚫'}
                        {d.color_semaforo === 'pendiente'&& '⏳'}
                      </td>
                      <td style={{ padding: 8, color: c.textDim, fontSize: 11 }}>
                        {(d.sucursales || []).map(s => s.sucursal_nombre).join(' · ') || '—'}
                      </td>
                      <td style={{ padding: 8, color: c.textDim, fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.notas_generales || ''}>
                        {d.notas_generales || '—'}
                      </td>
                      <td style={{ padding: 8, color: c.blue, fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={d.justificacion ? `${d.justificacion.categoria}: ${d.justificacion.detalle}` : ''}>
                        {d.justificacion ? d.justificacion.categoria : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detalleFiltrado.length > 200 && (
                <div style={{ padding: 12, textAlign: 'center', color: c.textDim, fontSize: 12 }}>
                  Mostrando primeros 200 de {detalleFiltrado.length}. Exportá CSV para todos.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
