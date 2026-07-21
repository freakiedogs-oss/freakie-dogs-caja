import React, { useState, useEffect, useMemo } from 'react'
import { db } from '../../supabase'
import { paletaC as C } from '@/theme'
import InfoTip from '../ui/InfoTip'

/* Ingreso real por canal de cobro — conciliación declarado (cierres) vs depositado (banco).
   Informativo: se muestra debajo de Ventas Totales, NO cambia el total devengado del P&L.
   Fuente: vista v_ingresos_canal_mensual. */
const fmt = n => (n == null || isNaN(+n)) ? '—' : (+n < 0 ? '-' : '') + '$' + Math.abs(+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function IngresoCanalConciliacion() {
  const [rows, setRows] = useState(null)
  const [mes, setMes] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    db.from('v_ingresos_canal_mensual').select('*').then(({ data, error }) => {
      if (!alive) return
      if (error) { setErr(error.message); return }
      const sorted = (data || []).slice().sort((a, b) => a.mes < b.mes ? 1 : -1)
      setRows(sorted); setMes(sorted[0]?.mes || null)
    })
    return () => { alive = false }
  }, [])

  const r = useMemo(() => rows?.find(x => x.mes === mes) || {}, [rows, mes])
  if (err) return <div style={{ padding: 12, color: '#f87171', fontSize: 12 }}>⚠️ {err}</div>
  if (!rows) return <div style={{ padding: 16, color: C.textMuted, fontSize: 12 }}>⏳ Cargando ingreso por canal…</div>

  const canales = [
    { k: 'efectivo', label: '💵 Efectivo', dec: r.efectivo_declarado, dep: r.efectivo_depositado, tip: 'Ventas en efectivo declaradas en cierres vs lo realmente depositado al banco (Rapicash + depósitos de empleados por sucursal + T365 Venecia). El gap suele ser efectivo usado para pagar egresos de caja + cambio.' },
    { k: 'tarjeta', label: '💳 Tarjeta', dec: r.tarjeta_declarado, dep: r.tarjeta_depositado, tip: 'Ventas con tarjeta vs liquidación diaria del adquirente (SERVICIOS FINANCIEROS). La diferencia es timing (últimos días liquidan al mes siguiente) + comisión.' },
    { k: 'transfer', label: '🔁 Transferencia', dec: r.transferencia_declarado, dep: r.transferencia_depositado, tip: 'Transferencias de clientes directo al BAC + las que Francisco Siguenza acumula en su cuenta personal y traslada al BAC Freakie.' },
    { k: 'link', label: '🔗 Link de pago', dec: r.link_declarado, dep: r.link_depositado, tip: 'Pagos por link (afiliación BAC, AFI…LIQ). La diferencia es comisión/timing.' },
    { k: 'peya', label: '🛵 PedidosYa', dec: null, dep: r.peya_depositado, tip: 'Liquidación semanal de PedidosYa (PAY ADV DOC), con desfase de ~1 semana. No pasa por los cierres de caja.' },
  ]
  const th = { padding: '6px 8px', fontSize: 10, fontWeight: 700, color: C.gold, textAlign: 'right', textTransform: 'uppercase' }
  const td = (neg) => ({ padding: '6px 8px', fontSize: 12, textAlign: 'right', fontFamily: 'monospace', color: neg ? '#f87171' : C.white })

  return (
    <div style={{ marginTop: 16, background: C.card, border: `1px solid ${C.gold}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.white }}>🏦 Ingreso real por canal de cobro <InfoTip text="Debajo de Ventas Totales: lo que realmente ENTRÓ por cada canal (depositado en el banco) vs lo declarado en los cierres. Informativo — no cambia el total devengado del P&L." /></div>
        <select value={mes || ''} onChange={e => setMes(e.target.value)} style={{ background: C.cardAlt, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
          {rows.map(x => <option key={x.mes} value={x.mes}>{x.mes}</option>)}
        </select>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ ...th, textAlign: 'left', color: C.white }}>Canal</th>
            <th style={th}>Declarado (cierres)</th>
            <th style={th}>Depositado (banco)</th>
            <th style={th}>Diferencia</th>
          </tr></thead>
          <tbody>
            {canales.map(c => {
              const dif = (+c.dep || 0) - (+c.dec || 0)
              const hasDec = c.dec != null
              return (
                <tr key={c.k}>
                  <td style={{ padding: '6px 8px', fontSize: 12, color: C.white }}>{c.label} <InfoTip text={c.tip} /></td>
                  <td style={td()}>{hasDec ? fmt(c.dec) : '—'}</td>
                  <td style={td()}>{fmt(c.dep)}</td>
                  <td style={td(hasDec && dif < 0)}>{hasDec ? fmt(dif) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: C.textMuted }}>
        <span>Faltante/sobrante de caja declarado: <b style={{ color: (+r.diferencia_caja_declarada < 0) ? '#f87171' : C.greenLight }}>{fmt(r.diferencia_caja_declarada)}</b></span>
        <span>No es venta (préstamo socio/traslados): <b>{fmt(r.no_venta_banco)}</b></span>
        <span>Sin clasificar: <b style={{ color: (+r.ingreso_sin_clasificar > 0) ? C.gold : C.textMuted }}>{fmt(r.ingreso_sin_clasificar)}</b></span>
      </div>
      <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>El <b>efectivo</b> suele mostrar depositado &lt; declarado: la diferencia es efectivo usado para pagar egresos de caja + cambio, no depositado. Fuente: <code>v_ingresos_canal_mensual</code>.</div>
    </div>
  )
}
