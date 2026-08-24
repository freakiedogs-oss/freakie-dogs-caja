import React, { useState, useEffect, useMemo } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'
import InfoTip from '../ui/InfoTip'

/* Monitor de Canales de Ingreso — ¿lo vendido por cada canal llegó al banco?
   100% dato real: pos_cuenta_pagos (venta POS) · pedidos_peya (PEYA + comisión real por pedido)
   · bank_transacciones.origen_ingreso (lo que entró al BAC). Fuente: v_canal_ingreso_mensual.
   Objetivo: detectar fuga viendo dónde el gap no se explica por comisión ni por timing. */

const fmt = n => (n == null || isNaN(+n)) ? '—' : (+n < 0 ? '-' : '') + '$' + Math.abs(+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = n => (n == null || isNaN(+n)) ? '—' : (+n).toFixed(1) + '%'

// Config por canal: cómo se interpreta el gap y qué comisión aplica.
const CANALES = {
  efectivo: {
    label: '💵 Efectivo', comision: 'cero',
    tip: 'Vendido en efectivo (cierres/POS) vs depositado al BAC. El faltante NO es fuga por sí solo: el efectivo paga egresos de caja + cambio antes de depositarse. El control real del efectivo es conteo vs sistema en el cierre (pos_turnos) y depósito esperado vs depositos_bancarios.',
  },
  tarjeta: {
    label: '💳 Tarjeta', comision: 'implicita',
    tip: 'Ventas con tarjeta vs liquidación neta del adquirente en el BAC (ya descontada la comisión). El gap = comisión (~2.5–3%) + timing (los últimos días del mes liquidan al mes siguiente). Cobertura sana ≈ 90–97%.',
  },
  link: {
    label: '🔗 Link de pago', comision: 'implicita',
    tip: 'Pagos por link (afiliación BAC, "AFI…LIQ"). Liquidan diario y ya netos de comisión (~6.75% en ago-2026). Gap esperado = comisión + timing del último día.',
  },
  transferencia: {
    label: '🔁 Transferencia', comision: 'cero',
    tip: 'Transferencias de clientes al BAC (TM/TF). Si el banco recibe MÁS de lo etiquetado en POS (cobertura >100%), hay transfers de otros canales o consolidaciones sin clasificar. Si recibe MENOS, hay cobros marcados como transferencia sin respaldo en el banco = fuga (ver detalle por pedido).',
  },
  peya: {
    label: '🛵 PedidosYa', comision: 'real',
    tip: 'Venta bruta entregada (pedidos_peya) menos comisión real por pedido = neto esperado, vs liquidación semanal depositada (PAY ADV DOC). Liquida con ~1 semana de desfase, así que la última semana del mes aún no está depositada.',
  },
}
const ORDEN = ['efectivo', 'tarjeta', 'link', 'transferencia', 'peya']

// Semáforo por canal según cobertura vs neto esperado y timing.
function estadoCanal(canal, cobertura, gapVsNeto, vendido) {
  if (vendido <= 0) return { icon: '—', color: C.textMuted, txt: 'sin datos' }
  if (canal === 'efectivo') return { icon: 'ℹ️', color: C.textMuted, txt: 'control por cierre' }
  if (canal === 'transferencia') {
    if (cobertura >= 115) return { icon: '🟡', color: C.gold, txt: 'reclasificar (banco > POS)' }
    if (cobertura >= 90) return { icon: '🟢', color: C.greenLight, txt: 'cuadra' }
    return { icon: '🔴', color: '#f87171', txt: 'fuga: falta en banco' }
  }
  // tarjeta / link / peya: comparar contra neto esperado
  if (gapVsNeto == null) {
    if (cobertura >= 90) return { icon: '🟢', color: C.greenLight, txt: 'cuadra' }
    if (cobertura >= 80) return { icon: '🟡', color: C.gold, txt: 'timing' }
    return { icon: '🔴', color: '#f87171', txt: 'revisar' }
  }
  const tol = Math.max(vendido * 0.03, 25) // tolerancia 3% o $25
  if (Math.abs(gapVsNeto) <= tol) return { icon: '🟢', color: C.greenLight, txt: 'cuadra' }
  if (gapVsNeto < 0) return { icon: '🟡', color: C.gold, txt: 'timing / pendiente liquidar' }
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

  // Arma la fila de cada canal con comisión real / implícita, neto esperado y gap vs neto.
  const filas = useMemo(() => ORDEN.map(canal => {
    const cfg = CANALES[canal]
    const r = delMes.find(x => x.canal === canal) || {}
    const vendido = +r.vendido_pos || 0
    const entro = +r.entro_banco || 0
    let comision = null, comisionEstim = false
    if (cfg.comision === 'cero') comision = 0
    else if (cfg.comision === 'real') comision = +r.comision_peya_real || 0
    else { comision = Math.max(vendido - entro, 0); comisionEstim = true } // implícita = vendido - entró (com + timing)
    const netoEsperado = (cfg.comision === 'implicita') ? null : vendido - comision
    const gapVsNeto = netoEsperado == null ? null : entro - netoEsperado
    const cobertura = vendido > 0 ? entro / vendido * 100 : null
    return { canal, cfg, vendido, entro, comision, comisionEstim, netoEsperado, gapVsNeto, cobertura,
             estado: estadoCanal(canal, cobertura, gapVsNeto, vendido) }
  }), [delMes])

  if (err) return <div style={{ padding: 12, color: '#f87171', fontSize: 12 }}>⚠️ {err}</div>
  if (!rows) return <div style={{ padding: 16, color: C.textMuted, fontSize: 12 }}>⏳ Cargando monitor de canales…</div>

  const th = { padding: '8px 8px', fontSize: 10, fontWeight: 700, color: C.gold, textAlign: 'right', textTransform: 'uppercase' }
  const td = (extra) => ({ padding: '8px 8px', fontSize: 12.5, textAlign: 'right', fontFamily: 'monospace', color: C.white, ...extra })

  return (
    <div style={{ marginTop: 16, background: C.card, border: `1px solid ${C.gold}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.white }}>
          🏦 Monitor de Canales de Ingreso <InfoTip text="Por cada canal de cobro: lo vendido en POS vs lo que realmente entró al BAC. Todo con dato real (POS, pedidos_peya, estado de cuenta BAC). El objetivo es ubicar la fuga donde el gap no se explica por comisión ni por timing." />
        </div>
        <select value={mes || ''} onChange={e => setMes(e.target.value)} style={{ background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
          {meses.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 10.5, color: C.textMuted, marginBottom: 10 }}>Vendido (POS) → −comisión real → neto esperado → entró al BAC → gap. Fuente: <code>v_canal_ingreso_mensual</code>.</div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ ...th, textAlign: 'left', color: C.white }}>Canal</th>
            <th style={th}>Vendido POS</th>
            <th style={th}>Comisión real</th>
            <th style={th}>Neto esperado</th>
            <th style={th}>Entró al BAC</th>
            <th style={th}>Gap</th>
            <th style={th}>Cobertura</th>
            <th style={{ ...th, textAlign: 'center' }}>Estado</th>
          </tr></thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.canal} style={{ borderBottom: `1px solid ${C.border}22` }}>
                <td style={{ padding: '8px 8px', fontSize: 12.5, color: C.white }}>{f.cfg.label} <InfoTip text={f.cfg.tip} /></td>
                <td style={td()}>{fmt(f.vendido)}</td>
                <td style={td({ color: C.textMuted })}>{f.cfg.comision === 'cero' ? '—' : (f.comisionEstim ? '≈' : '') + fmt(f.comision)}</td>
                <td style={td()}>{f.netoEsperado == null ? '—' : fmt(f.netoEsperado)}</td>
                <td style={td()}>{fmt(f.entro)}</td>
                <td style={td({ color: f.gapVsNeto != null && f.gapVsNeto < -Math.max(f.vendido * 0.03, 25) ? '#f87171' : C.white })}>
                  {f.netoEsperado == null ? fmt(f.entro - f.vendido) : fmt(f.gapVsNeto)}
                </td>
                <td style={td({ color: f.estado.color })}>{pct(f.cobertura)}</td>
                <td style={{ ...td({ color: f.estado.color, fontFamily: 'inherit', fontSize: 11 }), textAlign: 'center' }}>
                  {f.estado.icon} {f.estado.txt}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 10, lineHeight: 1.6 }}>
        <b>Cómo leerlo:</b> 🟢 cuadra · 🟡 timing (liquidación con desfase) · 🔴 fuga a investigar · ℹ️ el efectivo se controla por cierre (conteo vs sistema), no por cobertura.
        En <b>tarjeta</b> y <b>link</b> la comisión se muestra implícita (≈ vendido − entró) porque incluye comisión + timing; la comisión oficial por DTE del adquirente está pendiente de reingesta. En <b>transferencia</b>, cobertura &gt;100% = el banco recibe transfers no etiquetadas en POS (reclasificar); &lt;90% = cobros sin respaldo en banco (fuga por pedido).
      </div>
    </div>
  )
}
