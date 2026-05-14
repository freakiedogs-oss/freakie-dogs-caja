import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'

/**
 * Card "Ventas por Sucursal — Apples to Apples"
 *
 * Reemplaza la card vieja que comparaba mes parcial vs mes completo (sesgo negativo).
 * Componente AUTÓNOMO con su propio fetch a fn_ventas_comparativo_igualado.
 *
 * Si falla → retorna null, no rompe nada.
 */

const STORE_MAP = { M001: 'Santa Tecla', S001: 'PM Soyapango', S002: 'PM Usulután', S003: 'Gran Plaza Lourdes', S004: 'Venecia Soyapango' }
const STORE_COLORS = { M001: '#e63946', S001: '#3b82f6', S002: '#f4a261', S003: '#4ade80', S004: '#a78bfa' }

function fmt(n) {
  if (!n && n !== 0) return '$0'
  return '$' + Math.round(n).toLocaleString()
}

export default function CardVentasComparativo() {
  const [rows, setRows] = useState([])
  const [comparador, setComparador] = useState('mes_anterior')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    try {
      const r = await db.rpc('fn_ventas_comparativo_igualado')
      if (r && Array.isArray(r.data) && !r.error) {
        setRows(r.data)
      } else {
        setError(true)
      }
    } catch (e) {
      console.warn('CardVentasComparativo:', e && e.message)
      setError(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Recarga cuando dashboard pide refresh
  useEffect(() => {
    const h = () => cargar()
    window.addEventListener('freakie:refresh-pl', h)
    return () => window.removeEventListener('freakie:refresh-pl', h)
  }, [cargar])

  // Estados visibles (no null silencioso) para debugging y UX clara
  if (loading) {
    return <div style={st.placeholder}>⏳ Cargando comparativo de ventas por sucursal…</div>
  }
  if (error) {
    return <div style={st.placeholder}>⚠️ No se pudo cargar el comparativo (RPC fn_ventas_comparativo_igualado)</div>
  }
  if (!rows.length) {
    return <div style={st.placeholder}>Sin datos en el comparativo (RPC devolvió 0 filas)</div>
  }

  const diaCorte = rows[0] && rows[0].dia_corte
  const fechaCorte = rows[0] && rows[0].fecha_corte

  const entries = rows
    .map(r => ({
      sc: r.store_code,
      actual: parseFloat(r.ventas_actual) || 0,
      comp: parseFloat(
        comparador === 'mes_anterior' ? r.ventas_mes_anterior
        : comparador === 'prom_3m' ? r.ventas_prom_3m
        : r.ventas_prom_6m
      ) || 0,
    }))
    .filter(x => x.actual > 0 || x.comp > 0)
    .sort((a, b) => b.actual - a.actual)

  if (!entries.length) return null

  const maxV = Math.max(...entries.map(x => x.actual), ...entries.map(x => x.comp))
  const totalActual = entries.reduce((s, x) => s + x.actual, 0)
  const totalComp = entries.reduce((s, x) => s + x.comp, 0)
  const deltaTotal = totalComp > 0 ? ((totalActual - totalComp) / totalComp) * 100 : 0
  const compLabel = comparador === 'mes_anterior' ? 'Mes Anterior' : comparador === 'prom_3m' ? 'Prom 3M' : 'Prom 6M'

  return (
    <div style={st.card}>
      <div style={st.header}>
        <div>
          <div style={st.title}>Ventas por Sucursal — Mismos días del mes vs Comparador</div>
          {fechaCorte ? (
            <div style={st.subtitle}>
              Mayo 1 al <b style={{ color: '#f4a261' }}>{fechaCorte}</b> ({diaCorte} días) vs mismos {diaCorte} días del comparador
              {totalComp > 0 && (
                <span style={{ marginLeft: 12, color: deltaTotal >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                  TOTAL: {deltaTotal >= 0 ? '+' : ''}{deltaTotal.toFixed(1)}% · {fmt(totalActual)} vs {fmt(totalComp)}
                </span>
              )}
            </div>
          ) : null}
        </div>
        <div style={st.toggleGroup}>
          {[
            { k: 'mes_anterior', l: 'Mes Anterior' },
            { k: 'prom_3m', l: 'Prom 3M' },
            { k: 'prom_6m', l: 'Prom 6M' },
          ].map(o => (
            <button key={o.k} onClick={() => setComparador(o.k)} style={st.toggleBtn(comparador === o.k)}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div style={st.legend}>
        Mes actual (barra colorida) · {compLabel} (barra gris)
      </div>

      {entries.map(({ sc, actual, comp }) => {
        const pctActual = maxV > 0 ? (actual / maxV) * 100 : 0
        const pctComp = maxV > 0 ? (comp / maxV) * 100 : 0
        const diff = comp > 0 ? ((actual - comp) / comp) * 100 : null
        const color = STORE_COLORS[sc] || '#3b82f6'
        return (
          <div key={sc} style={{ marginBottom: 10 }}>
            <div style={st.row}>
              <span style={{ color, fontWeight: 600 }}>{STORE_MAP[sc] || sc}</span>
              <span style={st.rowRight}>
                <span style={{ color: '#fff', fontWeight: 700 }}>{fmt(actual)}</span>
                <span style={{ color: '#94a3b8', fontSize: 10 }}>vs {fmt(comp)}</span>
                {diff !== null && (
                  <span style={{ color: diff >= 0 ? '#4ade80' : '#f87171', fontSize: 11, fontWeight: 700, minWidth: 56, textAlign: 'right' }}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                  </span>
                )}
              </span>
            </div>
            <div style={st.barBg}>
              <div style={{ height: 7, borderRadius: 3, background: color, width: `${pctActual}%`, transition: 'width .5s' }} />
            </div>
            <div style={st.barBgGray}>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(148,163,184,0.7)', width: `${pctComp}%`, transition: 'width .5s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const st = {
  card: { background: '#16213e', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #334155' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 },
  subtitle: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  toggleGroup: { display: 'flex', gap: 4 },
  toggleBtn: (active) => ({
    padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
    border: '1px solid ' + (active ? '#f4a261' : '#334155'),
    background: active ? 'rgba(244,162,97,0.15)' : 'transparent',
    color: active ? '#f4a261' : '#94a3b8',
  }),
  legend: { fontSize: 10, color: '#94a3b8', marginBottom: 10 },
  placeholder: { background: '#16213e', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #334155', color: '#94a3b8', fontSize: 12, textAlign: 'center' },
  row: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 },
  rowRight: { display: 'flex', gap: 10, alignItems: 'center' },
  barBg: { height: 7, background: 'rgba(255,255,255,0.06)', borderRadius: 3 },
  barBgGray: { height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, marginTop: 2 },
}
