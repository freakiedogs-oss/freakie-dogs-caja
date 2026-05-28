import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { useToast } from '../../hooks/useToast'

/**
 * Card "Última data disponible" + botón Refrescar P&L
 *
 * Componente AUTÓNOMO:
 *   - Hace su propio fetch a v_data_disponible_resumen
 *   - Hace su propio fetch a fn_ventas_comparativo_igualado (para el delta apples-to-apples)
 *   - Llama fn_refresh_pl al click del botón
 *   - Si CUALQUIER fetch falla, retorna null (no rompe el dashboard)
 *
 * No depende de NADA externo excepto `db` (supabase client).
 */
export default function CardDataDisponible() {
  const toast = useToast()
  const [dataDisp, setDataDisp] = useState(null)
  const [compIgualado, setCompIgualado] = useState([])
  const [comparador, setComparador] = useState('mes_anterior')
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r1 = await db.from('v_data_disponible_resumen').select('*').single()
      if (r1 && r1.data && !r1.error) setDataDisp(r1.data)
    } catch (e) {
      console.warn('CardDataDisponible v_data:', e && e.message)
      setLoadError(true)
    }
    try {
      const r2 = await db.rpc('fn_ventas_comparativo_igualado')
      if (r2 && Array.isArray(r2.data) && !r2.error) setCompIgualado(r2.data)
    } catch (e) {
      console.warn('CardDataDisponible fn_ventas:', e && e.message)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const r = await db.rpc('fn_refresh_pl')
      if (r && r.error) {
        toast.error('Error al refrescar: ' + r.error.message)
      } else {
        await cargar()
        // Avisamos al dashboard que recargue
        window.dispatchEvent(new CustomEvent('freakie:refresh-pl'))
        toast.success('P&L refrescado')
      }
    } catch (e) {
      toast.error('Error: ' + (e && e.message ? e.message : 'desconocido'))
    }
    setRefreshing(false)
  }

  if (loadError || !dataDisp) {
    // Sin datos: solo botón refresh sin info de fechas
    return (
      <div style={st.wrap}>
        <button onClick={handleRefresh} disabled={refreshing} style={st.btn(refreshing)}>
          {refreshing ? '⏳ Refrescando…' : '🔄 Refrescar P&L'}
        </button>
        <toast.Toast />
      </div>
    )
  }

  return (
    <div style={st.wrap}>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>📅 Última data:</span>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>
        Quanto <b style={{ color: '#fff' }}>{dataDisp.quanto_hasta}</b>
      </span>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>·</span>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>
        PeYa <b style={{ color: '#fff' }}>{dataDisp.peya_hasta}</b>
      </span>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>·</span>
      <span style={{ fontSize: 11, color: '#f4a261' }}>
        Corte comparativo: <b>{dataDisp.data_completa_hasta}</b> ({dataDisp.dia_corte} días)
      </span>

      {compIgualado && compIgualado.length > 0 && (
        <CardVentasIgualado rows={compIgualado} comparador={comparador} onChange={setComparador} diaCorte={dataDisp.dia_corte} fechaCorte={dataDisp.data_completa_hasta} />
      )}

      <button onClick={handleRefresh} disabled={refreshing} style={st.btn(refreshing)}>
        {refreshing ? '⏳ Refrescando…' : '🔄 Refrescar P&L'}
      </button>
      <toast.Toast />
    </div>
  )
}

function CardVentasIgualado({ rows, comparador, onChange, diaCorte, fechaCorte }) {
  const map = {}
  rows.forEach(r => {
    if (!r || !r.store_code) return
    const v = comparador === 'mes_anterior' ? r.ventas_mes_anterior
            : comparador === 'prom_3m' ? r.ventas_prom_3m
            : r.ventas_prom_6m
    map[r.store_code] = {
      actual: parseFloat(r.ventas_actual) || 0,
      comp: parseFloat(v) || 0,
    }
  })
  const totalActual = Object.values(map).reduce((s, x) => s + x.actual, 0)
  const totalComp = Object.values(map).reduce((s, x) => s + x.comp, 0)
  const deltaTotal = totalComp > 0 ? ((totalActual - totalComp) / totalComp) * 100 : 0

  return (
    <div style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {['mes_anterior','prom_3m','prom_6m'].map(k => (
        <button key={k} onClick={() => onChange(k)}
          style={{
            padding: '2px 6px', fontSize: 10, fontWeight: 600, borderRadius: 3, cursor: 'pointer',
            border: '1px solid ' + (comparador === k ? '#f4a261' : '#334155'),
            background: comparador === k ? 'rgba(244,162,97,0.15)' : 'transparent',
            color: comparador === k ? '#f4a261' : '#94a3b8',
          }}>
          {k === 'mes_anterior' ? 'M.Ant' : k === 'prom_3m' ? '3M' : '6M'}
        </button>
      ))}
      <span style={{ fontSize: 11, color: deltaTotal >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
        {deltaTotal >= 0 ? '▲' : '▼'} {Math.abs(deltaTotal).toFixed(1)}%
      </span>
      <span style={{ fontSize: 10, color: '#94a3b8' }}>
        ${Math.round(totalActual).toLocaleString()} vs ${Math.round(totalComp).toLocaleString()}
      </span>
    </div>
  )
}

const st = {
  wrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8, padding: '6px 12px', background: '#0f3460', borderRadius: 8 },
  btn: (refreshing) => ({
    padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
    background: refreshing ? '#6b7280' : '#e63946', color: '#fff',
    border: 'none', cursor: refreshing ? 'wait' : 'pointer',
    marginLeft: 'auto',
  }),
}
