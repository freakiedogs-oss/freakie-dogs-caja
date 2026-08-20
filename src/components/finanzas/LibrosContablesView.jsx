import { useState, useMemo, useCallback } from 'react'
import { STORES } from '../../config'
import {
  cargarVentas, cargarCompras,
  libroVentasCSV, libroComprasCSV, f14ResumenCSV, resumenCodigosGeneracionCSV,
  anexoConsumidorFinalCSV, anexoContribuyentesCSV, anexoComprasCSV,
  excelRespaldoBlob, descargar, r2,
} from '../../lib/reportesContabilidad'

/**
 * LibrosContablesView — Reportes de contabilidad para el contador (Ángel).
 *
 * Libro de Ventas (por sucursal o consolidado) + Libro de Compras (consolidado)
 * + Anexos DGII + Excel de respaldo + F-14 resumen IVA.
 *
 * Ventas → pos_cuentas (por store_code). Compras → compras_dte (consolidado).
 * Acceso: contador, ejecutivo, admin, superadmin.
 *
 * ⚠️ Los Anexos DGII son BORRADOR — layout a confirmar con Ángel.
 */

const c = {
  bg: '#0a0a0a', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', purple: '#a78bfa', cyan: '#22d3ee',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
}
const cardStyle = { background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 16, marginBottom: 12 }
const btn = { padding: '10px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }
const fmtUSD = (v) => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Mes actual 'YYYY-MM' en UTC-6
function mesActual() {
  return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 7)
}

// Sucursales que emiten DTE (excluye bodega/eventos internos)
const SUCURSALES_VENTA = ['M001', 'S001', 'S002', 'S003', 'S004', 'S006']

export default function LibrosContablesView({ user }) {
  const [mes, setMes] = useState(mesActual())
  const [storeCode, setStoreCode] = useState('') // '' = consolidado
  const [ivaIncl, setIvaIncl] = useState(true)   // venta gravada con IVA (formato Ángel)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null) // { ventas, compras }

  const cargar = useCallback(async () => {
    setLoading(true); setError(null); setData(null)
    try {
      const [ventas, compras] = await Promise.all([
        cargarVentas({ mes, storeCode: storeCode || null }),
        cargarCompras({ mes }), // compras siempre consolidado
      ])
      setData({ ventas, compras })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [mes, storeCode])

  const kpis = useMemo(() => {
    if (!data) return null
    const { ventas, compras } = data
    const debito = r2(ventas.reduce((a, v) => a + v.ivaContenido, 0))
    const credito = r2(compras.filter((x) => x.tipo === '03').reduce((a, x) => a + x.iva, 0))
    return {
      nVentas: ventas.length,
      ventaBruta: r2(ventas.reduce((a, v) => a + v.brutoConIva, 0)),
      debito,
      nCompras: compras.length,
      compraGravada: r2(compras.reduce((a, x) => a + x.gravada, 0)),
      credito,
      ivaMes: r2(debito - credito),
      ccf: ventas.filter((v) => v.tipo === '03').length,
    }
  }, [data])

  const sucLabel = storeCode ? (STORES[storeCode] || storeCode) : 'Consolidado (todas)'

  const dl = (fn) => () => { try { descargar(fn()) } catch (e) { setError(e.message || String(e)) } }
  const dlAsync = (fn) => async () => { try { descargar(await fn()) } catch (e) { setError(e.message || String(e)) } }

  const btnDesc = { ...btn, background: c.input, color: c.text, border: `1px solid ${c.border}`, textAlign: 'left', width: '100%' }

  return (
    <div style={{ background: c.bg, minHeight: '100vh', color: c.text, padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 2px' }}>📒 Libros Contables</h1>
      <p style={{ color: c.textDim, fontSize: 13, marginTop: 0 }}>
        Libro de Ventas, Libro de Compras y Anexos DGII para el contador. Ventas por sucursal o consolidado; compras consolidadas.
      </p>

      {/* Controles */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim }}>
            Mes
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text, borderRadius: 8, padding: '8px 10px', fontSize: 14 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim }}>
            Sucursal (ventas)
            <select value={storeCode} onChange={(e) => setStoreCode(e.target.value)}
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text, borderRadius: 8, padding: '8px 10px', fontSize: 14, minWidth: 220 }}>
              <option value="">Consolidado (todas)</option>
              {SUCURSALES_VENTA.map((s) => <option key={s} value={s}>{s} · {STORES[s] || s}</option>)}
            </select>
          </label>
          <button onClick={cargar} disabled={loading}
            style={{ ...btn, background: loading ? c.textOff : c.green, color: '#04210f', padding: '10px 18px' }}>
            {loading ? 'Cargando…' : 'Cargar período'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle, borderColor: c.red, color: c.red, fontSize: 13 }}>⚠️ {error}</div>
      )}

      {kpis && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            <Kpi label="Ventas (docs)" value={kpis.nVentas.toLocaleString('en-US')} color={c.cyan} sub={`${kpis.ccf} CCF`} />
            <Kpi label="Venta bruta" value={fmtUSD(kpis.ventaBruta)} color={c.green} />
            <Kpi label="Débito fiscal (IVA vtas)" value={fmtUSD(kpis.debito)} color={c.green} />
            <Kpi label="Compras (docs)" value={kpis.nCompras.toLocaleString('en-US')} color={c.blue} />
            <Kpi label="Crédito fiscal (IVA compras)" value={fmtUSD(kpis.credito)} color={c.blue} />
            <Kpi label="IVA del mes (déb − créd)" value={fmtUSD(kpis.ivaMes)} color={kpis.ivaMes >= 0 ? c.orange : c.green} />
          </div>

          {/* Descargas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div style={{ ...cardStyle, gridColumn: '1 / -1', borderColor: c.green }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: c.green }}>⭐ Anexo Consumidor Final — Resumen Diario de Códigos de Generación <span style={{ fontSize: 11, color: c.textDim, fontWeight: 400 }}>(formato Ángel)</span></div>
              <div style={{ fontSize: 12, color: c.textDim, marginBottom: 8 }}>Fecha · DEL · AL · Cantidad · Venta Gravada — 1 fila por día · {sucLabel}</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={ivaIncl} onChange={(e) => setIvaIncl(e.target.checked)} />
                Venta gravada <b>{ivaIncl ? 'CON IVA' : 'NETA (sin IVA)'}</b> <span style={{ color: c.yellow }}>← confirmar con Ángel</span>
              </label>
              <button style={{ ...btnDesc, borderColor: c.green, color: c.green, fontWeight: 700 }}
                onClick={dl(() => resumenCodigosGeneracionCSV({ ventas: data.ventas, mes, storeCode: storeCode || null, ivaIncluido: ivaIncl }))}>
                ⬇️ Descargar Resumen de Códigos de Generación (CSV)
              </button>
            </div>

            <div style={cardStyle}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: c.text }}>📗 Ventas · {sucLabel}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button style={btnDesc} onClick={dl(() => libroVentasCSV({ ventas: data.ventas, mes, storeCode: storeCode || null }))}>⬇️ Libro de Ventas (CSV legible)</button>
                <button style={btnDesc} onClick={dl(() => anexoConsumidorFinalCSV({ ventas: data.ventas, mes, storeCode: storeCode || null }))}>⬇️ Anexo Consumidor Final (DGII) <Beta /></button>
                <button style={btnDesc} onClick={dl(() => anexoContribuyentesCSV({ ventas: data.ventas, mes, storeCode: storeCode || null }))}>⬇️ Anexo Contribuyentes / CCF (DGII) <Beta /></button>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: c.text }}>📕 Compras · Consolidado</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button style={btnDesc} onClick={dl(() => libroComprasCSV({ compras: data.compras, mes }))}>⬇️ Libro de Compras (CSV legible)</button>
                <button style={btnDesc} onClick={dl(() => anexoComprasCSV({ compras: data.compras, mes }))}>⬇️ Anexo de Compras (DGII) <Beta /></button>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: c.text }}>📊 Resumen</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button style={btnDesc} onClick={dlAsync(() => excelRespaldoBlob({ ventas: data.ventas, compras: data.compras, mes, storeCode: storeCode || null }))}>⬇️ Excel de respaldo (multi-hoja)</button>
                <button style={btnDesc} onClick={dl(() => f14ResumenCSV({ ventas: data.ventas, compras: data.compras, mes, storeCode: storeCode || null }))}>⬇️ F-14 resumen IVA <Beta /></button>
              </div>
            </div>
          </div>

          <p style={{ color: c.textDim, fontSize: 11, marginTop: 12 }}>
            <Beta /> Los Anexos DGII y el F-14 son <b>borrador</b>: el layout exacto de campos (IVA-incluido vs. neto en Consumidor Final,
            NIT de cliente en CCF, clasificación de renta en compras, remanente) queda <b>pendiente de confirmar con Ángel</b>.
            El Libro de Ventas/Compras legibles y el Excel de respaldo ya son de uso directo.
          </p>
        </>
      )}

      {!kpis && !loading && (
        <div style={{ ...cardStyle, color: c.textDim, fontSize: 13 }}>
          Elegí el mes y la sucursal, y pulsá <b>Cargar período</b> para generar los reportes.
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, color, sub }) {
  return (
    <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: c.textDim, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: c.textOff, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Beta() {
  return <span style={{ fontSize: 10, color: c.yellow, border: `1px solid ${c.yellow}`, borderRadius: 4, padding: '1px 4px', marginLeft: 4 }}>borrador</span>
}
