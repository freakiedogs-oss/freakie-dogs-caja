// ────────────────────────────────────────────────────────────────────
// Tendencias de Redes — explorador con filtros de fecha y gráficos SVG.
// Reglas de la guía de dataviz: UNA métrica por gráfico (nunca doble eje;
// para ver todos los KPIs a la vez están las mini-gráficas), series =
// plataformas (misma unidad), colores FIJOS por plataforma (validados
// contra #1a1a1a: CVD y contraste OK), líneas 2px, grid recesivo,
// crosshair+tooltip, leyenda + etiqueta directa al final de cada línea,
// y vista de tabla como alternativa accesible.
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef } from 'react'
import { db } from '../../supabase'
import InfoTip from '../ui/InfoTip'

// Color FIJO por plataforma (nunca cambia aunque se filtren series)
const PLAT = {
  instagram: { label: 'Instagram', color: '#ec4899' },
  facebook:  { label: 'Facebook',  color: '#3b82f6' },
  tiktok:    { label: 'TikTok',    color: '#059669' },
}
const METRICAS = [
  { key: 'eng', label: 'Eng %', unit: '%', tip: 'Engagement ponderado del período: (likes+comentarios+guardados+compartidos) ÷ alcance × 100. Ojo: Facebook usa un alcance aproximado fijo, su Eng% sale inflado.' },
  { key: 'likes', label: 'Likes/post', unit: '', tip: 'Promedio de likes por publicación en cada período.' },
  { key: 'alcance', label: 'Alcance/post', unit: '', tip: 'Promedio de cuentas únicas alcanzadas por publicación.' },
  { key: 'vistas', label: 'Vistas/post', unit: '', tip: 'Promedio de reproducciones por publicación (reels/videos).' },
  { key: 'posts', label: 'Posts', unit: '', tip: 'Cantidad de publicaciones en cada período.' },
]
const PRESETS = [
  { label: '30d', dias: 30 }, { label: '90d', dias: 90 },
  { label: '6m', dias: 183 }, { label: '12m', dias: 365 },
]
const DIM = '#888', GRID = '#2a2a2a'

const isoDia = (d) => d.toISOString().slice(0, 10)
const hoy = () => isoDia(new Date(Date.now() - 6 * 3600 * 1000)) // día SV
const rest = (dias) => isoDia(new Date(Date.now() - 6 * 3600 * 1000 - dias * 86400000))
const fmtN = (v) => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v * 10) / 10)
const fmtFecha = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }

// lunes (SV) de la semana de una fecha iso — para buckets semanales
function lunesDe(iso) {
  const d = new Date(iso + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return isoDia(d)
}

// ── Gráfico de líneas SVG multi-serie (una unidad) ──────────────────
function LineChart({ series, height = 220, unit = '' }) {
  const [hover, setHover] = useState(null) // índice de bucket
  const ref = useRef(null)
  const W = 720, H = height, PADL = 44, PADR = 76, PADT = 12, PADB = 26
  const labels = series[0]?.points.map(p => p.x) || []
  const todos = series.flatMap(s => s.points.map(p => p.y)).filter(v => v != null)
  if (!labels.length || !todos.length) return <div style={{ color: DIM, fontSize: 13, padding: 20, textAlign: 'center' }}>Sin datos en este rango.</div>
  const yMax = Math.max(...todos) * 1.08 || 1
  const x = (i) => PADL + (labels.length === 1 ? 0 : (i * (W - PADL - PADR)) / (labels.length - 1))
  const y = (v) => PADT + (H - PADT - PADB) * (1 - v / yMax)
  const onMove = (e) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return
    const px = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((px - PADL) / (W - PADL - PADR)) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, i)))
  }
  const gridY = [0.25, 0.5, 0.75, 1].map(f => yMax * f)
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {gridY.map((v, i) => (
          <g key={i}>
            <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={PADL - 6} y={y(v) + 3} fill={DIM} fontSize="10" textAnchor="end">{fmtN(v)}{unit}</text>
          </g>
        ))}
        {/* etiquetas de eje x: primera, última y ~3 intermedias */}
        {labels.map((l, i) => {
          const paso = Math.max(1, Math.floor(labels.length / 4))
          if (i !== 0 && i !== labels.length - 1 && i % paso !== 0) return null
          return <text key={i} x={x(i)} y={H - 8} fill={DIM} fontSize="10" textAnchor="middle">{fmtFecha(l)}</text>
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PADT} y2={H - PADB} stroke="#555" strokeWidth="1" strokeDasharray="3,3" />}
        {series.map(s => {
          const pts = s.points.map((p, i) => p.y == null ? null : `${x(i)},${y(p.y)}`).filter(Boolean).join(' ')
          const last = [...s.points].reverse().find(p => p.y != null)
          const lastIdx = last ? s.points.lastIndexOf(last) : -1
          return (
            <g key={s.name}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
              {/* etiqueta directa al final de la línea (identidad no depende solo del color) */}
              {last && <text x={x(lastIdx) + 6} y={y(last.y) + 3} fill="#ccc" fontSize="10">{s.name} {fmtN(last.y)}{unit}</text>}
              {hover != null && s.points[hover]?.y != null && (
                <circle cx={x(hover)} cy={y(s.points[hover].y)} r="4.5" fill={s.color} stroke="#1a1a1a" strokeWidth="2" />
              )}
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <div style={{ position: 'absolute', top: 4, left: 8, background: '#111', border: '1px solid #333', borderRadius: 8, padding: '6px 10px', fontSize: 12, pointerEvents: 'none' }}>
          <div style={{ color: DIM, marginBottom: 2 }}>{labels[hover]}</div>
          {series.map(s => s.points[hover]?.y != null && (
            <div key={s.name} style={{ color: '#ddd' }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: s.color, marginRight: 5 }} />
              {s.name}: <b>{fmtN(s.points[hover].y)}{unit}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TendenciasRedes() {
  const [desde, setDesde] = useState(rest(90))
  const [hasta, setHasta] = useState(hoy())
  const [plats, setPlats] = useState(['instagram', 'facebook', 'tiktok'])
  const [metrica, setMetrica] = useState('eng')
  const [posts, setPosts] = useState([])       // rango + ventana previa (para Δ)
  const [seguidores, setSeguidores] = useState([])
  const [verTabla, setVerTabla] = useState(false)
  const [loading, setLoading] = useState(true)

  const dias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000))
  const desdePrev = isoDia(new Date(new Date(desde) - dias * 86400000))

  useEffect(() => {
    let vivo = true
    setLoading(true)
    Promise.all([
      db.from('posts_redes')
        .select('plataforma,fecha_publicacion,likes,comentarios,compartidos,guardados,reproducciones,alcance')
        .gte('fecha_publicacion', desdePrev).lte('fecha_publicacion', hasta + 'T23:59:59')
        .order('fecha_publicacion').limit(2000),
      db.from('metricas_redes_diarias')
        .select('fecha,plataforma,seguidores')
        .gte('fecha', desde).lte('fecha', hasta).order('fecha'),
    ]).then(([p, m]) => {
      if (!vivo) return
      setPosts(p.data || []); setSeguidores(m.data || []); setLoading(false)
    }).catch(() => vivo && setLoading(false))
    return () => { vivo = false }
  }, [desde, hasta, desdePrev])

  const semanal = dias > 35
  const n = (v) => Number(v) || 0

  // buckets del rango visible
  const { labels, porPlat, tablaRows, resumen } = useMemo(() => {
    const enRango = (f) => f >= desde && f <= hasta
    const bucketDe = (iso) => semanal ? lunesDe(iso) : iso
    const set = new Set()
    const acc = {} // plat -> bucket -> agregados
    const tot = { cur: {}, prev: {} } // para las cards Δ
    const zero = () => ({ posts: 0, likes: 0, com: 0, comp: 0, guard: 0, vistas: 0, alcance: 0 })
    for (const p of posts) {
      const f = (p.fecha_publicacion || '').slice(0, 10)
      const cual = enRango(f) ? 'cur' : (f >= desdePrev && f < desde ? 'prev' : null)
      if (!cual) continue
      const t = tot[cual][p.plataforma] = tot[cual][p.plataforma] || zero()
      t.posts++; t.likes += n(p.likes); t.com += n(p.comentarios); t.comp += n(p.compartidos)
      t.guard += n(p.guardados); t.vistas += n(p.reproducciones); t.alcance += n(p.alcance)
      if (cual !== 'cur') continue
      const b = bucketDe(f)
      set.add(b)
      const g = (acc[p.plataforma] = acc[p.plataforma] || {})
      const a = g[b] = g[b] || zero()
      a.posts++; a.likes += n(p.likes); a.com += n(p.comentarios); a.comp += n(p.compartidos)
      a.guard += n(p.guardados); a.vistas += n(p.reproducciones); a.alcance += n(p.alcance)
    }
    const labels = [...set].sort()
    const valor = (a, key) => {
      if (!a || !a.posts) return null
      if (key === 'posts') return a.posts
      if (key === 'likes') return a.likes / a.posts
      if (key === 'alcance') return a.alcance / a.posts
      if (key === 'vistas') return a.vistas / a.posts
      return a.alcance > 0 ? ((a.likes + a.com + a.guard + a.comp) / a.alcance) * 100 : null // eng
    }
    const porPlat = {}
    for (const pl of Object.keys(PLAT)) {
      porPlat[pl] = {}
      for (const m of METRICAS) porPlat[pl][m.key] = labels.map(b => ({ x: b, y: valor(acc[pl]?.[b], m.key) }))
    }
    const tablaRows = labels.map(b => ({
      b, ...Object.fromEntries(Object.keys(PLAT).map(pl => [pl, valor(acc[pl]?.[b], metrica)])),
    }))
    // resumen con Δ vs ventana previa (solo plataformas seleccionadas)
    const suma = (obj) => {
      const s = zero()
      for (const pl of plats) { const t = obj[pl]; if (t) for (const k of Object.keys(s)) s[k] += t[k] }
      return s
    }
    const c = suma(tot.cur), pv = suma(tot.prev)
    const eng = (t) => t.alcance > 0 ? ((t.likes + t.com + t.guard + t.comp) / t.alcance) * 100 : 0
    const delta = (a, b) => b > 0 ? ((a - b) / b) * 100 : null
    const resumen = [
      { label: 'Posts', v: c.posts, d: delta(c.posts, pv.posts) },
      { label: 'Eng %', v: eng(c), d: delta(eng(c), eng(pv)), esPct: true },
      { label: 'Likes', v: c.likes, d: delta(c.likes, pv.likes) },
      { label: 'Alcance', v: c.alcance, d: delta(c.alcance, pv.alcance) },
      { label: 'Vistas', v: c.vistas, d: delta(c.vistas, pv.vistas) },
    ]
    return { labels, porPlat, tablaRows, resumen }
  }, [posts, desde, hasta, desdePrev, semanal, metrica, plats])

  // seguidores por plataforma (delta del acumulado)
  const seriesSeguidores = useMemo(() => {
    const por = {}
    for (const r of seguidores) (por[r.plataforma] = por[r.plataforma] || []).push({ x: r.fecha, y: n(r.seguidores) || null })
    return Object.entries(por).filter(([pl]) => plats.includes(pl) && PLAT[pl])
      .map(([pl, points]) => ({ name: PLAT[pl].label, color: PLAT[pl].color, points }))
  }, [seguidores, plats])

  const seriesMetrica = plats.filter(pl => PLAT[pl]).map(pl => ({
    name: PLAT[pl].label, color: PLAT[pl].color, points: porPlat[pl]?.[metrica] || [],
  })).filter(s => s.points.some(p => p.y != null))

  const mDef = METRICAS.find(m => m.key === metrica)
  const card = (children, style = {}) => (
    <div style={{ background: '#1a1a1a', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #333', ...style }}>{children}</div>
  )
  const chip = (activo, color = '#e74c3c') => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600,
    background: activo ? color + '22' : '#222', border: `1px solid ${activo ? color : '#444'}`,
    color: activo ? '#fff' : '#999',
  })

  if (loading) return <div style={{ padding: 20, color: '#aaa', textAlign: 'center' }}>Cargando tendencias…</div>

  return (
    <div>
      {/* FILTROS — una sola fila arriba de los gráficos */}
      {card(
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => { setDesde(rest(p.dias)); setHasta(hoy()) }}
              style={chip(desde === rest(p.dias) && hasta === hoy())}>{p.label}</button>
          ))}
          <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)}
            style={{ background: '#222', border: '1px solid #444', borderRadius: 8, padding: '6px 8px', color: '#fff', fontSize: 12 }} />
          <span style={{ color: DIM, fontSize: 12 }}>→</span>
          <input type="date" value={hasta} min={desde} max={hoy()} onChange={e => setHasta(e.target.value)}
            style={{ background: '#222', border: '1px solid #444', borderRadius: 8, padding: '6px 8px', color: '#fff', fontSize: 12 }} />
          <span style={{ flex: 1 }} />
          {Object.entries(PLAT).map(([pl, def]) => (
            <button key={pl} onClick={() => setPlats(s => s.includes(pl) ? s.filter(x => x !== pl) : [...s, pl])}
              style={chip(plats.includes(pl), def.color)}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: def.color, marginRight: 5 }} />
              {def.label}
            </button>
          ))}
        </div>
      )}

      {/* RESUMEN DEL RANGO con Δ vs ventana previa del mismo largo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 12 }}>
        {resumen.map(k => (
          <div key={k.label} style={{ background: '#1a1a1a', borderRadius: 10, padding: '10px 8px', textAlign: 'center', border: '1px solid #333' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{k.esPct ? k.v.toFixed(1) + '%' : fmtN(k.v)}</div>
            <div style={{ fontSize: 10, color: DIM }}>{k.label}</div>
            {k.d != null && <div style={{ fontSize: 10, fontWeight: 700, color: k.d >= 0 ? '#2dd4a8' : '#f87171' }}>{k.d >= 0 ? '▲' : '▼'} {Math.abs(k.d).toFixed(0)}% <span style={{ color: '#666', fontWeight: 400 }}>vs {dias}d previos</span></div>}
          </div>
        ))}
      </div>

      {/* GRÁFICO PRINCIPAL: una métrica, líneas por plataforma */}
      {card(
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Tendencia {semanal ? 'semanal' : 'diaria'} <InfoTip text={`${mDef.tip} Con rangos de más de 5 semanas los puntos se agrupan por semana (lunes a domingo) para que la tendencia se lea limpia.`} /></span>
            <span style={{ flex: 1 }} />
            {METRICAS.map(m => (
              <button key={m.key} onClick={() => setMetrica(m.key)} style={chip(metrica === m.key)}>{m.label}</button>
            ))}
          </div>
          <LineChart series={seriesMetrica} unit={mDef.unit} />
          <button onClick={() => setVerTabla(v => !v)} style={{ ...chip(verTabla), marginTop: 8 }}>📋 {verTabla ? 'Ocultar tabla' : 'Ver datos en tabla'}</button>
          {verTabla && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#ccc' }}>
                <thead><tr style={{ borderBottom: '1px solid #444' }}>
                  <th style={{ textAlign: 'left', padding: 6, color: DIM }}>{semanal ? 'Semana de' : 'Fecha'}</th>
                  {plats.map(pl => <th key={pl} style={{ textAlign: 'right', padding: 6, color: DIM }}>{PLAT[pl].label}</th>)}
                </tr></thead>
                <tbody>{tablaRows.map(r => (
                  <tr key={r.b} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: 6 }}>{r.b}</td>
                    {plats.map(pl => <td key={pl} style={{ padding: 6, textAlign: 'right' }}>{r[pl] == null ? '—' : fmtN(r[pl]) + mDef.unit}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MINI-GRÁFICAS: todos los KPIs de un vistazo (por plataforma seleccionada, sin doble eje) */}
      {card(
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Todos los KPIs de un vistazo <InfoTip text="Cada mini-gráfica muestra un KPI en su propia escala (por eso van separadas y no en un solo gráfico con dos ejes). Útil para detectar qué se movió; el detalle está arriba." /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {METRICAS.map(m => (
              <div key={m.key} onClick={() => setMetrica(m.key)} style={{ cursor: 'pointer', background: '#151515', border: `1px solid ${metrica === m.key ? '#e74c3c' : '#2a2a2a'}`, borderRadius: 10, padding: 8 }}>
                <div style={{ fontSize: 11, color: DIM, marginBottom: 4 }}>{m.label}</div>
                <LineChart height={90} unit={m.unit}
                  series={plats.filter(pl => PLAT[pl]).map(pl => ({ name: PLAT[pl].label, color: PLAT[pl].color, points: porPlat[pl]?.[m.key] || [] })).filter(s => s.points.some(p => p.y != null))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SEGUIDORES en el tiempo */}
      {card(
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Seguidores <InfoTip text="Seguidores acumulados por plataforma (dato diario). La pendiente es el crecimiento: más empinada = más seguidores nuevos por día." /></div>
          <LineChart series={seriesSeguidores} />
        </div>
      )}
    </div>
  )
}
