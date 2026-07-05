import React, { useState, useEffect, useMemo } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'

/* ═══════════════════════════════════════════════════════════
   FLUJO DE CAJA NETO — datos reales
   Consume la RPC fn_fin_cash_flow(p_mes date) → jsonb.
   Separa rentabilidad devengada (P&L) de la caja real del
   banco BAC, + inversión/financiamiento + puente con residual.
   ═══════════════════════════════════════════════════════════ */

const fmt = (n) =>
  n == null || isNaN(Number(n))
    ? '—'
    : (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Últimos 8 meses (hora El Salvador, UTC-6)
function buildMonths() {
  const now = new Date(Date.now() - 6 * 3600 * 1000)
  const out = []
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
      label: d.toLocaleDateString('es-SV', { month: 'short', year: 'numeric' }),
    })
  }
  return out
}

const box = { background: C.dark, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }
const sHead = { fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: C.gold, marginBottom: 10 }

function Row({ label, value, color, bold, sign }) {
  const c = color || (Number(value) < 0 ? '#f87171' : C.white)
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
      <span style={{ fontSize: 12, color: bold ? C.white : C.textMuted, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontSize: bold ? 13 : 12, color: c, fontWeight: bold ? 800 : 500, fontFamily: 'monospace' }}>
        {sign && Number(value) > 0 ? '+' : ''}{fmt(value)}
      </span>
    </div>
  )
}

export default function CashFlowNeto() {
  const months = useMemo(buildMonths, [])
  const [mes, setMes] = useState(months[1]?.value || months[0].value) // mes anterior (más probable de estar completo)
  const [cf, setCf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    db.rpc('fn_fin_cash_flow', { p_mes: mes }).then(({ data, error }) => {
      if (!alive) return
      if (error) setErr(error.message || 'Error consultando el flujo de caja')
      else setCf(data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [mes])

  const r = cf?.rentabilidad_devengado || {}
  const b = cf?.caja_banco_real || {}
  const bd = b?.salidas_por_destino || {}
  const inv = cf?.inversion_financiamiento || {}
  const p = cf?.puente || {}
  const residual = Number(p?.residual_timing_capital_trabajo)

  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 16, marginBottom: 16, border: `2px solid ${C.gold}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.white }}>💵 Flujo de Caja Neto <span style={{ fontSize: 11, color: C.greenLight }}>· datos reales</span></div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Rentabilidad devengada vs caja real del banco · fuente: fn_fin_cash_flow</div>
        </div>
        <select value={mes} onChange={e => setMes(e.target.value)}
          style={{ background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30, color: C.textMuted }}>⏳ Cargando flujo de caja…</div>
      ) : err ? (
        <div style={{ padding: 12, color: '#f87171', fontSize: 12, background: 'rgba(248,113,113,0.08)', borderRadius: 8 }}>⚠️ {err}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {/* Rentabilidad devengada */}
            <div style={box}>
              <div style={sHead}>📋 Rentabilidad (devengado)</div>
              <Row label="Ventas" value={r.ventas} />
              <Row label="(−) COGS" value={r.cogs != null ? -Math.abs(r.cogs) : null} />
              <Row label="(−) Planilla" value={r.planilla != null ? -Math.abs(r.planilla) : null} />
              <Row label="(−) Opex" value={r.opex != null ? -Math.abs(r.opex) : null} />
              <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
              <Row label="EBITDA" value={r.ebitda} bold color={Number(r.ebitda) < 0 ? '#f87171' : C.greenLight} />
              <Row label="Margen %" value={null} />
              <div style={{ textAlign: 'right', fontSize: 12, color: C.textMuted, marginTop: -22, fontFamily: 'monospace' }}>{r.margen_pct != null ? r.margen_pct + '%' : '—'}</div>
            </div>

            {/* Caja del banco real */}
            <div style={box}>
              <div style={sHead}>🏦 Caja del banco (real)</div>
              <Row label="Entradas" value={b.entradas} sign color={C.greenLight} />
              <Row label="Salidas" value={b.salidas != null ? -Math.abs(b.salidas) : null} />
              <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
              <Row label="Δ Caja del mes" value={b.delta_caja} bold color={Number(b.delta_caja) < 0 ? '#f87171' : C.greenLight} />
              <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 1, margin: '8px 0 4px' }}>Salidas por destino</div>
              <Row label="Pago de DTE" value={bd.pago_dte != null ? -Math.abs(bd.pago_dte) : null} />
              <Row label="Gasto directo P&L" value={bd.gasto_directo_pl != null ? -Math.abs(bd.gasto_directo_pl) : null} />
              <Row label="No P&L / traslados" value={bd.no_pl_traslados != null ? -Math.abs(bd.no_pl_traslados) : null} />
              <Row label="⚠️ Sin clasificar" value={bd.sin_clasificar != null ? -Math.abs(bd.sin_clasificar) : null} color={Number(bd.sin_clasificar) > 0 ? C.gold : C.white} />
            </div>

            {/* Inversión y financiamiento */}
            <div style={box}>
              <div style={sHead}>🏗️ Inversión y financiamiento</div>
              <Row label="CAPEX (activo fijo)" value={inv.capex_devengado != null ? -Math.abs(inv.capex_devengado) : null} />
              <Row label="Aportes de socios" value={inv.aportes_socios} sign color={Number(inv.aportes_socios) > 0 ? C.greenLight : C.textMuted} />
              <Row label="Retiros de socios" value={inv.retiros_socios != null ? -Math.abs(inv.retiros_socios) : null} />
              <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
              <Row label="Impuestos (deveng.)" value={inv.impuestos_devengado != null ? -Math.abs(inv.impuestos_devengado) : null} />
              <Row label="Gasto financiero" value={inv.gasto_financiero != null ? -Math.abs(inv.gasto_financiero) : null} />
            </div>
          </div>

          {/* Puente */}
          <div style={{ ...box, marginTop: 12, background: 'rgba(244,162,97,0.05)', border: `1px solid ${C.gold}` }}>
            <div style={sHead}>🔗 Puente: rentabilidad → caja real</div>
            <Row label="EBITDA (devengado)" value={p.ebitda} />
            <Row label="(−) CAPEX" value={p.menos_capex} />
            <Row label="(+/−) Financiamiento neto (socios)" value={p.financiamiento_neto} sign />
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
            <Row label="= Flujo neto (modelo)" value={p.flujo_neto_modelo} bold />
            <Row label="Δ Banco real" value={p.delta_banco_real} bold color={C.blue} />
            <Row label="Residual (timing / capital de trabajo)" value={residual} bold color={Math.abs(residual) > 0 ? C.gold : C.greenLight} />
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>
              El <b>residual</b> = diferencia entre lo devengado y la caja real: timing de cobros/pagos (CxP/CxC), IVA, impuestos pagados y caja física no bancarizada.
              Un residual grande suele indicar <b>débitos sin clasificar</b> — bajará conforme clasifiques en el tab Banco → Revisión P&L.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
