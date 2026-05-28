/**
 * DevOpsPipelineCard — Salud del pipeline DTE en una vista
 * ─────────────────────────────────────────────────────────
 *
 * Muestra 4 KPI cards + mini gráfico de barras de DTEs por día
 * últimos 14 días.
 *
 * Tarjetas:
 *   1. DTEs últimas 24h           — verde si >0, amarillo si 0
 *   2. DTEs últimos 7d            — número + (N proveedores)
 *   3. Rezago promedio (horas)    — verde 16-29h, amarillo >40h
 *   4. Último DTE (relativo)      — verde <30h, rojo >48h
 *
 * Consultas:
 *   - Todo via `db.from('compras_dte').select(...)`. Sin RPC nuevo.
 *   - 4 queries pequeñas paralelas (Promise.all).
 *
 * Integración: SuperAdminView.jsx tab '🩺 Pipeline DTE'.
 */

import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '../../theme'

// ── Helpers ────────────────────────────────────────────────────
function isoMinusHours(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString()
}

function isoMinusDays(d) {
  return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString()
}

function isoDateMinusDays(d) {
  return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString().split('T')[0]
}

function relativeTime(iso) {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffH = diffMs / 3600 / 1000
  if (diffH < 1) return `hace ${Math.max(1, Math.round(diffMs / 60000))} min`
  if (diffH < 48) return `hace ${Math.round(diffH)}h`
  const d = Math.round(diffH / 24)
  return `hace ${d}d`
}

// ── Mini barras SVG (14 días) ──────────────────────────────────
function MiniBars({ data, color = C.blue }) {
  if (!data || data.length === 0) return null
  const W = 320
  const H = 70
  const PAD = 4
  const max = Math.max(...data.map((d) => d.value), 1)
  const barW = Math.floor((W - PAD * 2 - (data.length - 1) * 2) / data.length)

  return (
    <svg width="100%" height={H + 18} viewBox={`0 0 ${W} ${H + 18}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {data.map((d, i) => {
        const barH = Math.max(2, (d.value / max) * H)
        const x = PAD + i * (barW + 2)
        const y = H - barH
        const isZero = d.value === 0
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={2}
              fill={isZero ? '#334155' : color}
              opacity={isZero ? 0.5 : 0.9}
            />
            <text x={x + barW / 2} y={H + 12} textAnchor="middle" fontSize={9} fill={C.textMuted}>
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── KPI Card ───────────────────────────────────────────────────
function Kpi({ title, value, sub, accent = C.blue, icon }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textMuted }}>{sub}</div>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
export default function DevOpsPipelineCard() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  // KPI states
  const [kpi24h, setKpi24h] = useState({ value: 0, color: C.gray })
  const [kpi7d, setKpi7d] = useState({ value: 0, proveedores: 0 })
  const [kpiRezago, setKpiRezago] = useState({ horas: null, color: C.gray })
  const [kpiUltimo, setKpiUltimo] = useState({ when: null, color: C.gray, fechaEmision: null })
  const [serie14d, setSerie14d] = useState([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const since24h = isoMinusHours(24)
      const since7d = isoMinusDays(7)
      const since14d = isoMinusDays(14)

      // 1. Last 24h count
      const q24 = db
        .from('compras_dte')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since24h)

      // 2. Last 7d — fetch lightweight rows for distinct proveedores + count
      const q7 = db
        .from('compras_dte')
        .select('proveedor_nit, created_at, fecha_emision', { count: 'exact' })
        .gte('created_at', since7d)
        .limit(5000)

      // 3. Last DTE (most recent by created_at)
      const qLast = db
        .from('compras_dte')
        .select('created_at, fecha_emision')
        .order('created_at', { ascending: false })
        .limit(1)

      // 4. 14 days series — pull only created_at
      const q14 = db
        .from('compras_dte')
        .select('created_at')
        .gte('created_at', since14d)
        .limit(20000)

      const [r24, r7, rLast, r14] = await Promise.all([q24, q7, qLast, q14])

      if (r24.error) throw new Error(`24h: ${r24.error.message}`)
      if (r7.error) throw new Error(`7d: ${r7.error.message}`)
      if (rLast.error) throw new Error(`last: ${rLast.error.message}`)
      if (r14.error) throw new Error(`14d: ${r14.error.message}`)

      // ── KPI 1: 24h ──
      const count24 = r24.count ?? 0
      setKpi24h({
        value: count24,
        color: count24 > 0 ? C.green : C.gold,
      })

      // ── KPI 2: 7d + proveedores únicos ──
      const rows7 = r7.data || []
      const count7 = r7.count ?? rows7.length
      const provs = new Set(rows7.map((r) => r.proveedor_nit).filter(Boolean))
      setKpi7d({ value: count7, proveedores: provs.size })

      // ── KPI 3: Rezago promedio (created_at - fecha_emision) en horas ──
      let rezago = null
      if (rows7.length > 0) {
        const diffs = rows7
          .filter((r) => r.created_at && r.fecha_emision)
          .map((r) => {
            const c = new Date(r.created_at).getTime()
            // fecha_emision viene como date YYYY-MM-DD; lo tratamos como 12:00 SV (UTC-6) → 18:00 UTC
            const e = new Date(r.fecha_emision + 'T18:00:00Z').getTime()
            return (c - e) / 3600000
          })
          .filter((h) => h >= 0 && h < 24 * 30) // descarta outliers (>30d)
        if (diffs.length > 0) {
          rezago = diffs.reduce((a, b) => a + b, 0) / diffs.length
        }
      }
      let rezagoColor = C.green
      if (rezago === null) rezagoColor = C.gray
      else if (rezago > 40) rezagoColor = C.gold
      setKpiRezago({ horas: rezago, color: rezagoColor })

      // ── KPI 4: Último DTE ──
      const lastRow = rLast.data?.[0]
      const lastIso = lastRow?.created_at || null
      let ultimoColor = C.gray
      if (lastIso) {
        const diffH = (Date.now() - new Date(lastIso).getTime()) / 3600000
        if (diffH < 30) ultimoColor = C.green
        else if (diffH > 48) ultimoColor = C.red
        else ultimoColor = C.gold
      }
      setKpiUltimo({ when: lastIso, color: ultimoColor, fechaEmision: lastRow?.fecha_emision || null })

      // ── Serie 14 días ──
      const buckets = {}
      for (let i = 13; i >= 0; i--) {
        buckets[isoDateMinusDays(i)] = 0
      }
      ;(r14.data || []).forEach((r) => {
        const d = r.created_at?.split('T')[0]
        if (d && d in buckets) buckets[d] += 1
      })
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
      const serie = Object.entries(buckets)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dia, value]) => {
          const dow = new Date(dia + 'T12:00:00').getDay()
          return { label: dayNames[dow][0], value, dia }
        })
      setSerie14d(serie)

      setLastRefresh(new Date().toLocaleTimeString('es-SV'))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Auto-refresh cada 5 min (solo si visible)
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 300000)
    return () => clearInterval(iv)
  }, [refresh])

  // ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 4 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: C.white, fontWeight: 800 }}>🩺 Salud Pipeline DTE</h3>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
            Recepción automática de DTEs (BD: compras_dte)
            {lastRefresh && <> · Actualizado {lastRefresh}</>}
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            padding: '6px 14px',
            background: loading ? '#444' : C.blue,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '⏳ Cargando…' : '🔄 Refrescar'}
        </button>
      </div>

      {err && (
        <div style={{ background: '#58151c', border: `1px solid ${C.red}`, color: '#f8d7da', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          ⚠️ Error: {err}
        </div>
      )}

      {/* 4 KPIs en grid 2x2 desktop / vertical mobile */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <Kpi
          title="DTEs últimas 24h"
          icon="📥"
          value={loading ? '…' : kpi24h.value}
          sub={kpi24h.value === 0 ? 'Sin recepciones aún' : 'recibidos hoy'}
          accent={kpi24h.color}
        />
        <Kpi
          title="DTEs últimos 7d"
          icon="📅"
          value={loading ? '…' : kpi7d.value.toLocaleString('es-SV')}
          sub={kpi7d.value > 0 ? `(${kpi7d.proveedores} proveedores)` : '—'}
          accent={C.blue}
        />
        <Kpi
          title="Rezago promedio"
          icon="⏱️"
          value={
            loading || kpiRezago.horas === null
              ? '…'
              : `${kpiRezago.horas.toFixed(1)}h`
          }
          sub={
            kpiRezago.horas === null
              ? 'Sin datos suficientes'
              : kpiRezago.horas > 40
              ? '⚠️ Atrasado (>40h)'
              : 'Normal (16-29h esperado)'
          }
          accent={kpiRezago.color}
        />
        <Kpi
          title="Último DTE"
          icon="🕒"
          value={loading ? '…' : relativeTime(kpiUltimo.when)}
          sub={
            kpiUltimo.fechaEmision
              ? `Emitido ${kpiUltimo.fechaEmision}`
              : '—'
          }
          accent={kpiUltimo.color}
        />
      </div>

      {/* Mini gráfico de barras 14 días */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>📊 DTEs por día — últimos 14 días</div>
          <div style={{ fontSize: 10, color: C.textMuted }}>
            {serie14d.length > 0 && `Total: ${serie14d.reduce((s, d) => s + d.value, 0)}`}
          </div>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', color: C.textMuted, padding: 24, fontSize: 12 }}>Cargando serie…</div>
        ) : serie14d.length === 0 ? (
          <div style={{ textAlign: 'center', color: C.textMuted, padding: 24, fontSize: 12 }}>Sin datos</div>
        ) : (
          <MiniBars data={serie14d} color={C.blue} />
        )}
        {/* Leyenda fechas extremos */}
        {serie14d.length > 0 && !loading && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.textMuted, marginTop: 4 }}>
            <span>{serie14d[0].dia}</span>
            <span>{serie14d[serie14d.length - 1].dia}</span>
          </div>
        )}
      </div>
    </div>
  )
}
