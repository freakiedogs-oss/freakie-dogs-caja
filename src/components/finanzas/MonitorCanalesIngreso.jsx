import React, { useState, useEffect, useMemo } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'
import InfoTip from '../ui/InfoTip'

/* Monitor de Canales de Ingreso — puente de 3 vías por canal de cobro.
   Vendido POS → Declarado Cierre → Entró BAC.
   Fuentes reales: pos_cuenta_pagos, ventas_diarias, pedidos_peya,
   bank_transacciones.origen_ingreso. Vista: v_canal_ingreso_mensual. */

const fmt = n => (n == null || isNaN(+n)) ? '—' : (+n < 0 ? '-' : '') + '$' + Math.abs(+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = n => (n == null || isNaN(+n)) ? '—' : (+n < 0 ? '-' : '') + '$' + (Math.abs(+n) / 1000).toFixed(1) + 'K'
const pct = n => (n == null || isNaN(+n)) ? '—' : (+n).toFixed(1) + '%'

const CANALES = {
  efectivo: {
    label: '💵 Efectivo', comision: 'cero',
    tip: 'Efectivo cobrado en POS vs declarado por cajeros en el cierre de turno vs depositado al BAC. El gap POS→BAC NO es fuga: el efectivo paga egresos de caja + cambio antes de depositarse. El Δ POS vs Cierre sí importa: si el cierre declara menos que el POS, hay efectivo sin reportar.',
  },
  tarjeta: {
    label: '💳 Tarjeta', comision: 'implicita',
    tip: 'Ventas con tarjeta (POS) vs cierre vs liquidación neta de Serfinsa en el BAC. La comisión es implícita (vendido − entró, incluye timing). Cobertura sana ≈ 95–98%. Si cierre > POS, hay ventas de tiendas Quanto no capturadas en pos_cuenta_pagos.',
  },
  link: {
    label: '🔗 Link de pago', comision: 'implicita',
    tip: 'Pagos por link de pago BAC ("AFI…LIQ"). Liquidan diario, netos de comisión (~6.75%). La comisión se deriva del gap vendido−entró (implícita: incluye timing del último día).',
  },
  transferencia: {
    label: '🔁 Transferencia', comision: 'cero',
    tip: 'Transferencias directas al BAC. Canal eliminado desde ago-2026 — datos históricos solamente. Si banco > POS: hay transfers de otros orígenes mezclados.',
  },
  peya: {
    label: '🛵 PedidosYa', comision: 'real',
    tip: 'Venta bruta − comisión real por pedido = neto esperado vs liquidación semanal (PAY ADV DOC). Desfase ~1 semana: la última semana del mes liquida al siguiente.',
  },
}
const ORDEN = ['efectivo', 'tarjeta', 'link', 'transferencia', 'peya']

function estadoCanal(canal, cobertura, gapVsNeto, vendido) {
  if (vendido <= 0) return { icon: '—', color: C.textMuted, txt: 'sin datos' }
  if (canal === 'efectivo') return { icon: 'ℹ️', color: C.textMuted, txt: 'control por cierre' }
  if (canal === 'transferencia') {
    if (cobertura >= 115) return { icon: '🟡', color: C.gold, txt: 'reclasificar' }
    if (cobertura >= 90) return { icon: '🟢', color: C.greenLight, txt: 'cuadra' }
    return { icon: '🔴', color: '#f87171', txt: 'fuga' }
  }
  if (gapVsNeto == null) {
    if (cobertura >= 90) return { icon: '🟢', color: C.greenLight, txt: 'cuadra' }
    if (cobertura >= 80) return { icon: '🟡', color: C.gold, txt: 'timing' }
    return { icon: '🔴', color: '#f87171', txt: 'revisar' }
  }
  const tol = Math.max(vendido * 0.03, 25)
  if (Math.abs(gapVsNeto) <= tol) return { icon: '🟢', color: C.greenLight, txt: 'cuadra' }
  if (gapVsNeto < 0) return { icon: '🟡', color: C.gold, txt: 'timing' }
  return { icon: '🟡', color: C.gold, txt: 'banco > esperado' }
}

export default function MonitorCanalesIngreso() {
  const [rows, setRows] = useState(null)
  const [mes, setMes] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    db.from('v_canal_ingreso_mensual').select('*').then(({ data, error }) => {
      if (!alive) return
      if (error) { setErr(error.message); return }
      const meses = [...new Set((data || []).map(r => r.mes))].sort((a, b) => a < b ? 1 : -1)
      setRows(data || []); setMes(meses[0] || null)
    })
    return () => { alive = false }
  }, [])

  const meses = useMemo(() => [...new Set((rows || []).map(r => r.mes))].sort((a, b) => a < b ? 1 : -1), [rows])
  const delMes = useMemo(() => (rows || []).filter(r => r.mes === mes), [rows, mes])

  const filas = useMemo(() => ORDEN.map(canal => {
    const cfg = CANALES[canal]
    const r = delMes.find(x => x.canal === canal) || {}
    const vendido = +r.vendido_pos || 0
    const entro = +r.entro_banco || 0
    const cierre = r.declarado_cierre != null ? +r.declarado_cierre : null
    const deltaCierre = (cierre != null && vendido > 0) ? cierre - vendido : null

    let comision = null, comisionEstim = false
    if (cfg.comision === 'cero') comision = 0
    else if (cfg.comision === 'real') comision = +r.comision_peya_real || 0
    else { comision = Math.max(vendido - entro, 0); comisionEstim = true }

    const comisionPct = (vendido > 0 && comision > 0) ? comision / vendido * 100 : null
    const netoEsperado = (cfg.comision === 'implicita') ? null : vendido - comision
    const gapVsNeto = netoEsperado == null ? null : entro - netoEsperado
    const cobertura = vendido > 0 ? entro / vendido * 100 : null

    return {
      canal, cfg, vendido, entro, cierre, deltaCierre,
      comision, comisionEstim, comisionPct,
      netoEsperado, gapVsNeto, cobertura,
      estado: estadoCanal(canal, cobertura, gapVsNeto, vendido),
    }
  }), [delMes])

  if (err) return <div style={{ padding: 12, color: '#f87171', fontSize: 12 }}>Error: {err}</div>
  if (!rows) return <div style={{ padding: 16, color: C.textMuted, fontSize: 12 }}>Cargando monitor de canales...</div>

  const th = { padding: '6px 6px', fontSize: 9.5, fontWeight: 700, color: C.gold, textAlign: 'right', textTransform: 'uppercase', whiteSpace: 'nowrap' }
  const td = (extra) => ({ padding: '6px 6px', fontSize: 12, textAlign: 'right', fontFamily: 'monospace', color: C.white, ...extra })

  return (
    <div style={{ marginTop: 16, background: C.card, border: `1px solid ${C.gold}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.white }}>
          🏦 Monitor de Canales de Ingreso <InfoTip text="Puente de 3 vías: lo vendido en POS vs lo declarado en el cierre de turno vs lo que entró al BAC. Todo dato real. El objetivo es ubicar la fuga donde el gap no se explica por comisión ni por timing." />
        </div>
        <select value={mes || ''} onChange={e => setMes(e.target.value)} style={{ background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
          {meses.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 10.5, color: C.textMuted, marginBottom: 10 }}>
        Vendido POS → Declarado Cierre → Entró BAC. Comisión implícita = vendido − entró (tarjeta/link); real = por pedido (PeYa).
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ ...th, textAlign: 'left', color: C.white }}>Canal</th>
            <th style={th}>Vendido POS</th>
            <th style={th}>Cierre</th>
            <th style={th}>{'Δ'} POS vs Cierre</th>
            <th style={th}>Entró BAC</th>
            <th style={th}>Comisión</th>
            <th style={th}>Cobertura</th>
            <th style={{ ...th, textAlign: 'center' }}>Estado</th>
          </tr></thead>
          <tbody>
            {filas.map(f => {
              const deltaCierreColor = f.deltaCierre != null
                ? (Math.abs(f.deltaCierre) > Math.max(f.vendido * 0.02, 50) ? '#f87171' : C.textMuted)
                : C.textMuted
              const gapBanco = f.netoEsperado == null ? f.entro - f.vendido : f.gapVsNeto
              const gapColor = gapBanco != null && gapBanco < -Math.max(f.vendido * 0.03, 25) ? '#f87171' : C.white
              return (
                <tr key={f.canal} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: '6px 6px', fontSize: 12, color: C.white }}>
                    {f.cfg.label} <InfoTip text={f.cfg.tip} />
                  </td>
                  <td style={td()}>{fmt(f.vendido)}</td>
                  <td style={td()}>{f.cierre != null ? fmt(f.cierre) : '—'}</td>
                  <td style={td({ color: deltaCierreColor, fontSize: 11 })}>
                    {f.deltaCierre != null ? fmt(f.deltaCierre) : '—'}
                  </td>
                  <td style={td()}>{fmt(f.entro)}</td>
                  <td style={td({ color: C.textMuted, fontSize: 11 })}>
                    {f.cfg.comision === 'cero' ? '—' : (
                      <span>
                        {f.comisionEstim ? '≈' : ''}{fmt(f.comision)}
                        {f.comisionPct != null && <span style={{ fontSize: 10, marginLeft: 2 }}>({pct(f.comisionPct)})</span>}
                      </span>
                    )}
                  </td>
                  <td style={td({ color: f.estado.color })}>{pct(f.cobertura)}</td>
                  <td style={{ ...td({ color: f.estado.color, fontFamily: 'inherit', fontSize: 11 }), textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {f.estado.icon} {f.estado.txt}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 10, lineHeight: 1.6 }}>
        <b>Semáforo:</b> 🟢 cuadra · 🟡 timing / pendiente liquidar · 🔴 fuga a investigar · ℹ️ efectivo se controla por cierre.
        <b> Δ POS vs Cierre:</b> si el cierre declara menos que el POS, hay venta sin reportar; si declara más, incluye ventas Quanto no capturadas en pos_cuenta_pagos.
        <b> Comisión:</b> tarjeta y link muestran la comisión implícita (≈ vendido − entró, incluye timing); PeYa muestra la real por pedido. La comisión real de Serfinsa por DTE está pendiente de reingesta.
        <b> Transferencia:</b> canal eliminado desde ago-2026.
      </div>
    </div>
  )
}
