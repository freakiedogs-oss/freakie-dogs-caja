import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'
import { STORES_SHORT, today, shiftDate } from '../../config'
import InfoTip from '../ui/InfoTip'
import {
  auditarHoja, auditarSemana, resumenHoja, agruparPorCategoria, aPayload,
  aEmpaques, fmtCant, fmtUSD, decirEnEmpaques, vacio, semanasRecientes, n,
} from './criticosConteo'

/**
 * ConteoCriticosTab — "Conteo de Críticos", la hoja de Saúl dentro del ERP.
 *
 * Espejo de `Criticos_FD_FORMATO.xlsx` (Manual de Operaciones · Sistemas de
 * Inventario v1A): 15 productos críticos, una hoja por sucursal y día.
 *
 * Lo que digita Saúl:
 *   CID        apertura: paquetes enteros + unidades sueltas. Se arrastra
 *              solo del cierre real de ayer; si no lo pisa, el cálculo usa eso
 *   Se pidió   lo que entró, SIEMPRE en paquetes completos
 *   Desc AM/PM bodega de sucursal → cocina. Control interno; NO es la venta
 *   TPS Final  paquetes enteros que quedan en bodega
 *   En Línea   unidades sueltas de los paquetes ya abiertos, en cocina
 *
 * Lo que pone el sistema:
 *   Venta día  lo que el POS descargó del inventario ese día (kardex)
 *   Se pidió   propuesto desde los traslados recibidos — editable
 *
 *     teórico = CID + Se pidió − Venta del día
 *     real    = TPS Final + En Línea
 *     dif     = real − teórico   ( = venta del día − consumo físico )
 *
 * Una diferencia NEGATIVA es la que duele: se fue producto del físico que
 * ninguna venta descontó.
 *
 * Tiene dos modos: **Día** (captura) y **Semana** (sólo lectura, sumatorias
 * de la semana que se elija en el desplegable). La semana NO resta los
 * totales entre sí —cada día tiene su propia apertura, sumar 7 aperturas no
 * significa nada—: `fn_criticos_semana` cierra la ecuación día por día y
 * suma sólo los días completos.
 *
 * La aritmética vive en `criticosConteo.js` para poder probarla sin base
 * (`node scripts/test-criticos.mjs`).
 */

const c = {
  bg: '#0a0a0a', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', purple: '#a78bfa', cyan: '#22d3ee',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#555',
}

const cardStyle = {
  background: c.card, border: `1px solid ${c.cardBorder}`,
  borderRadius: 12, padding: 16, marginBottom: 12,
}
const btn = {
  padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600,
}
const th = {
  padding: '6px 8px', fontWeight: 700, fontSize: 10, color: c.textDim,
  whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3,
}
const td = { padding: '5px 8px', whiteSpace: 'nowrap', fontSize: 12.5 }

const CAT_ICONO = {
  'Carnicos': '🥩', 'Lacteos': '🧀', 'Congelados': '🍟', 'Harinas Panes': '🍞',
}
const COLOR_ESTADO = { ok: c.green, aviso: c.yellow, alerta: c.red, sin_datos: c.textOff }
const TEXTO_ESTADO = { ok: 'Cuadra', aviso: 'Revisar', alerta: 'Descuadre', sin_datos: 'Sin contar' }

/* Sólo sucursales que operan caja. Casa Matriz no vende, así que no tiene
   venta contra la que cruzar, y Eventos no tiene bodega fija. */
const SUCURSALES = ['M001', 'S001', 'S002', 'S003', 'S004', 'S006']

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const inputBase = {
  background: c.input, color: c.text, border: `1px solid ${c.border}`,
  borderRadius: 6, padding: '4px 5px', fontSize: 12.5, textAlign: 'right',
}

/** Una casilla suelta (Se pidió, Desc AM/PM, TPS Final, En Línea). */
function Casilla({ item, campo, valores, onChange, disabled, sugerido, ancho = 62, titulo }) {
  const v = valores[campo]
  return (
    <input
      type="number" min="0" step="any" inputMode="decimal"
      value={vacio(v) ? '' : v} disabled={disabled}
      placeholder={sugerido != null ? fmtCant(sugerido) : ''}
      onChange={e => onChange(item.item_id, campo, e.target.value)}
      style={{ ...inputBase, width: ancho, background: disabled ? '#151515' : c.input }}
      title={titulo}
    />
  )
}

/* El CID es la ÚNICA columna con dos casillas: la apertura son paquetes
   cerrados más lo suelto del paquete abierto. Al cerrar, esas dos mitades
   viven en columnas propias (TPS Final y En Línea), tal como en el Excel. */
function CeldaCid({ item, valores, onChange, disabled, arrastrado }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Casilla item={item} campo="cid_enteros" valores={valores} onChange={onChange}
        disabled={disabled} sugerido={item.cid_sug_enteros} ancho={46}
        titulo={`Paquetes al abrir (${item.unidad_conteo})`} />
      <span style={{ color: c.textOff, fontSize: 11 }}>+</span>
      <Casilla item={item} campo="cid_sueltas" valores={valores} onChange={onChange}
        disabled={disabled} sugerido={item.cid_sug_sueltas} ancho={46}
        titulo={`Unidades sueltas al abrir (${item.unidad_suelta || 'sueltas'})`} />
      {/* Marca que la apertura NO se digitó: viene del cierre de ayer y el
          cálculo la está usando igual. Sin esto, un CID en gris se lee como
          "vacío" y nadie entendería de dónde sale el teórico. */}
      <span style={{ width: 10, fontSize: 10, color: arrastrado ? c.blue : 'transparent' }}
            title={arrastrado ? 'Arrastrado del cierre de ayer' : ''}>↩</span>
    </div>
  )
}

/* ── KPIs ──────────────────────────────────────────────────────────────── */
function Kpi({ label, valor, sub, color, tip }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 0, flex: '1 1 140px', minWidth: 140, padding: 12 }}>
      <div style={{ fontSize: 10, color: c.textDim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}{tip && <InfoTip text={tip} />}
      </div>
      <div style={{ fontSize: 21, fontWeight: 800, color: color || c.text, marginTop: 3 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10.5, color: c.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function FilaKpis({ r, dias, diasPosibles }) {
  const colDif = Math.abs(r.difUsd) < 1 ? c.green : r.difUsd < 0 ? c.red : c.yellow
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      <Kpi label="Descuadre" valor={fmtUSD(r.difUsd)} color={colDif}
        sub={r.pctSobreVenta == null ? '—' : `${r.pctSobreVenta > 0 ? '+' : ''}${r.pctSobreVenta.toFixed(1)}% de la venta`}
        tip="La diferencia de todos los productos contados, valorizada al costo del insumo. Negativo = se fue producto que ninguna venta descontó." />
      <Kpi label="Faltante" valor={fmtUSD(r.faltanteUsd)} color={r.faltanteUsd < -0.005 ? c.red : c.textDim}
        tip="Sólo la parte negativa: producto que salió del inventario sin venta que lo respalde. Es la fuga, sin compensar con los sobrantes." />
      <Kpi label="Sobrante" valor={fmtUSD(r.sobranteUsd)} color={r.sobranteUsd > 0.005 ? c.yellow : c.textDim}
        tip="Sólo la parte positiva: la venta descargó más de lo que realmente se usó. Suele ser receta que descuenta de más o un cierre inflado." />
      <Kpi label="Venta en críticos" valor={fmtUSD(r.ventaUsd)} color={c.cyan}
        tip="Lo que estos 15 productos descargaron por venta, valorizado al costo. Es el denominador del porcentaje." />
      <Kpi label="Contadas" valor={`${r.completas}/${r.total}`}
        color={r.completas === r.total ? c.green : r.completas === 0 ? c.textOff : c.yellow}
        sub={dias != null ? `${dias}/${diasPosibles} días con hoja` : undefined}
        tip="Filas con apertura y cierre. Las que no, no entran en ningún número de arriba." />
      {r.peor && (
        <Kpi label="Peor descuadre" valor={fmtUSD(r.peor.aud.difUsd)}
          color={n(r.peor.aud.difUsd) < 0 ? c.red : c.yellow} sub={r.peor.nombre}
          tip="El producto que más plata mueve en la diferencia, que no es el que más unidades mueve." />
      )}
    </div>
  )
}

/* La semana es sólo lectura: se ve qué pasó, no se digita. Las aperturas y
   los cierres no se muestran porque son de días distintos y sumarlos no
   significa nada — lo que sí suma es la venta, el pedido, las descargas y la
   diferencia, que `fn_criticos_semana` cierra día por día. */
function TablaSemana({ filas }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left' }}>Producto</th>
          <th style={{ ...th, textAlign: 'left' }}>Presentación</th>
          <th style={{ ...th, textAlign: 'right' }}>Días<InfoTip text="Días de la semana con apertura y cierre. Sólo esos entran en la diferencia: un día sin contar no suma cero, se omite." /></th>
          <th style={{ ...th, textAlign: 'right', color: c.cyan }}>Venta</th>
          <th style={{ ...th, textAlign: 'right' }}>Se pidió</th>
          <th style={{ ...th, textAlign: 'right', color: c.orange }}>Desc. bodega</th>
          <th style={{ ...th, textAlign: 'right' }}>Dif.</th>
          <th style={{ ...th, textAlign: 'right' }}>Dif. $</th>
          <th style={{ ...th, textAlign: 'right' }}>%</th>
        </tr>
      </thead>
      <tbody>
        {filas.map(f => {
          const a = f.aud
          const col = COLOR_ESTADO[a.estado]
          const emp = (q) => (q == null ? '—' : fmtCant(aEmpaques(f, q)))
          return (
            <tr key={f.item_id} style={{ borderTop: '1px solid #222' }}>
              <td style={{ ...td, whiteSpace: 'normal', maxWidth: 200 }}>
                <span style={{ color: col, marginRight: 6 }}>●</span>{f.nombre}
              </td>
              <td style={{ ...td, color: c.textDim, fontSize: 11 }}>{f.unidad_conteo}</td>
              <td style={{ ...td, textAlign: 'right', color: a.diasCompletos ? c.text : c.textOff }}>
                {a.diasCompletos || '—'}
              </td>
              <td style={{ ...td, textAlign: 'right', color: c.cyan, fontWeight: 700 }}>{emp(a.venta)}</td>
              <td style={{ ...td, textAlign: 'right', color: c.textDim }}>{emp(a.pedido)}</td>
              <td style={{ ...td, textAlign: 'right', color: c.textDim }}>
                {a.descargas ? fmtCant(a.descargas) : '—'}
              </td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: col }}>
                {a.diferencia == null ? '—' : (a.diferencia > 0 ? '+' : '') + fmtCant(aEmpaques(f, a.diferencia))}
              </td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: col }}>
                {a.difUsd == null ? '—' : fmtUSD(a.difUsd)}
              </td>
              <td style={{ ...td, textAlign: 'right', fontSize: 11, color: col }}>
                {a.pct == null ? '—' : (a.pct > 0 ? '+' : '') + a.pct.toFixed(1) + '%'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function ConteoCriticosTab({ user }) {
  const hoy = today()
  const [store, setStore] = useState(user?.store_code && SUCURSALES.includes(user.store_code)
    ? user.store_code : SUCURSALES[0])
  const [fecha, setFecha] = useState(hoy)
  const [modo, setModo] = useState('dia')            // 'dia' (captura) | 'semana' (lectura)
  const SEMANAS = useMemo(() => semanasRecientes(hoy, 10), [hoy])
  const [semana, setSemana] = useState(SEMANAS[0])
  const [hoja, setHoja] = useState(null)
  const [sem, setSem] = useState(null)
  const [valores, setValores] = useState({})
  const [notas, setNotas] = useState('')
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [sucio, setSucio] = useState(false)

  const cargarSemana = useCallback(async () => {
    setCargando(true); setError(''); setAviso('')
    const { data, error: err } = await db.rpc('fn_criticos_semana', {
      p_store_code: store, p_desde: semana.desde, p_hasta: semana.hasta,
    })
    if (err) { setError(err.message || 'No se pudo cargar la semana'); setSem(null) }
    else setSem(data)
    setCargando(false)
  }, [store, semana])

  const cargar = useCallback(async () => {
    setCargando(true); setError(''); setAviso('')
    const { data, error: err } = await db.rpc('fn_criticos_hoja', {
      p_store_code: store, p_fecha: fecha,
    })
    if (err) {
      setError(err.message || 'No se pudo cargar la hoja')
      setHoja(null)
    } else {
      setHoja(data)
      const v = {}
      for (const it of (data?.items || [])) {
        v[it.item_id] = {
          cid_enteros: it.cid_enteros, cid_sueltas: it.cid_sueltas,
          pedido_enteros: it.pedido_enteros,
          descarga_am: it.descarga_am, descarga_pm: it.descarga_pm,
          tps_enteros: it.tps_enteros, linea_sueltas: it.linea_sueltas,
          notas: it.notas,
        }
      }
      setValores(v)
      setNotas(data?.cabecera?.notas || '')
      setSucio(false)
    }
    setCargando(false)
  }, [store, fecha])

  useEffect(() => { if (modo === 'dia') cargar(); else cargarSemana() },
            [modo, cargar, cargarSemana])

  /* Cambiar de día o de sucursal con cambios sin guardar los perdería. Se
     avisa antes en vez de guardar solo: guardar una hoja a medio llenar la
     deja marcada como contada y el resumen empieza a mentir. */
  const cambiar = (fn) => {
    if (sucio && !window.confirm('Hay cambios sin guardar en esta hoja. ¿Descartarlos?')) return
    fn()
  }

  const onChange = (itemId, campo, valor) => {
    setValores(prev => ({ ...prev, [itemId]: { ...prev[itemId], [campo]: valor } }))
    setSucio(true)
  }

  const cerrada = hoja?.cabecera?.estado === 'cerrado'

  /* Se mezcla lo que devolvió la base con lo que está tecleado en pantalla
     para que la diferencia se recalcule mientras Saúl escribe, sin ir a la
     base en cada tecla. */
  const filas = useMemo(() => {
    const items = (hoja?.items || []).map(it => ({ ...it, ...(valores[it.item_id] || {}) }))
    return auditarHoja(items)
  }, [hoja, valores])

  const filasSemana = useMemo(() => auditarSemana(sem?.items), [sem])
  const enSemana = modo === 'semana'
  const activas = enSemana ? filasSemana : filas

  const grupos = useMemo(() => agruparPorCategoria(activas), [activas])
  const resumen = useMemo(() => resumenHoja(activas), [activas])
  const notasConfig = useMemo(() => filas.filter(f => f.nota_config), [filas])
  const diasConHoja = (sem?.dias || []).length
  const recargar = () => (enSemana ? cargarSemana() : cargar())

  const guardar = async (cerrar = false) => {
    setGuardando(true); setError(''); setAviso('')
    const payload = aPayload(filas.map(f => ({ item_id: f.item_id, ...(valores[f.item_id] || {}) })))
    const { data, error: err } = await db.rpc('fn_criticos_guardar', {
      p_store_code: store, p_fecha: fecha, p_items: payload,
      p_usuario_id: user?.id || null, p_usuario_nombre: user?.nombre || null,
      p_notas: notas || null, p_cerrar: cerrar,
    })
    if (err) setError(err.message || 'No se pudo guardar')
    else {
      setAviso(`Guardado: ${data?.guardados || 0} producto(s)${cerrar ? ' · hoja cerrada' : ''}.`)
      setSucio(false)
      await cargar()
    }
    setGuardando(false)
  }

  const reabrir = async () => {
    setGuardando(true); setError('')
    const { error: err } = await db.rpc('fn_criticos_reabrir', { p_store_code: store, p_fecha: fecha })
    if (err) setError(err.message || 'No se pudo reabrir')
    else await cargar()
    setGuardando(false)
  }

  const exportar = () => {
    if (enSemana) {
      downloadCSV(`criticos_semana_${store}_${semana.desde}_${semana.hasta}.csv`, [
        ['Categoría', 'Producto', 'Unidad de conteo', 'Días contados',
         'Venta', 'Se pidió', 'Desc. bodega→cocina', 'Diferencia', 'Diferencia USD', '% dif', 'Estado'],
        ...filasSemana.map(f => {
          const a = f.aud
          const e = (q) => (q == null ? '' : Number(aEmpaques(f, q).toFixed(4)))
          return [
            f.categoria, f.nombre, f.unidad_conteo, a.diasCompletos,
            e(a.venta), e(a.pedido), a.descargas || '', e(a.diferencia),
            a.difUsd == null ? '' : Number(a.difUsd.toFixed(2)),
            a.pct == null ? '' : Number(a.pct.toFixed(2)), TEXTO_ESTADO[a.estado],
          ]
        }),
      ])
      return
    }
    downloadCSV(`criticos_${store}_${fecha}.csv`, [
      ['Categoría', 'Producto', 'Presentación', 'Unidades derivadas', 'Unidad de conteo',
       'CID', 'Se pidió', 'Desc. AM (bodega→cocina)', 'Desc. PM (bodega→cocina)',
       'Venta del día', 'TPS Final', 'En línea',
       'Cierre teórico', 'Cierre real', 'Diferencia', 'Diferencia USD', '% dif', 'Estado'],
      ...filas.map(f => {
        const a = f.aud
        const e = (q) => (q == null ? '' : Number(aEmpaques(f, q).toFixed(4)))
        return [
          f.categoria, f.nombre, f.presentacion, f.unidades_derivadas, f.unidad_conteo,
          e(a.cid), e(a.pedido), a.descargaAm ?? '', a.descargaPm ?? '',
          e(a.venta), e(a.tps), e(a.linea),
          e(a.teorico), e(a.real), e(a.diferencia),
          a.difUsd == null ? '' : Number(a.difUsd.toFixed(2)),
          a.pct == null ? '' : Number(a.pct.toFixed(2)),
          TEXTO_ESTADO[a.estado],
        ]
      }),
    ])
  }

  const cab = hoja?.cabecera

  return (
    <div>
      {/* ── Filtros ── */}
      <div style={{ ...cardStyle, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['dia', '📝 Día'], ['semana', '📅 Semana']].map(([k, lbl]) => (
            <button key={k} onClick={() => cambiar(() => setModo(k))}
              style={{ ...btn, padding: '6px 10px', fontSize: 12, background: modo === k ? c.purple : '#262626', color: modo === k ? '#0a0a0a' : c.textDim }}>
              {lbl}
            </button>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: c.cardBorder }} />

        {enSemana ? (
          <label style={{ fontSize: 11, color: c.textDim, fontWeight: 600 }}>
            Semana<br />
            <select value={semana.desde}
              onChange={e => { const w = SEMANAS.find(x => x.desde === e.target.value); if (w) setSemana(w) }}
              style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, marginTop: 3, minWidth: 210 }}>
              {SEMANAS.map(w => (
                <option key={w.desde} value={w.desde}>
                  {w.etiqueta}{w.etiqueta.startsWith('Semana') || w.etiqueta === 'Esta semana' ? ` · ${w.rango}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label style={{ fontSize: 11, color: c.textDim, fontWeight: 600 }}>
              Día<br />
              <input type="date" value={fecha} max={hoy}
                onChange={e => cambiar(() => setFecha(e.target.value))}
                style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, marginTop: 3 }} />
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['Hoy', hoy], ['Ayer', shiftDate(hoy, -1)], ['Antier', shiftDate(hoy, -2)]].map(([lbl, f]) => (
                <button key={lbl} onClick={() => cambiar(() => setFecha(f))}
                  style={{ ...btn, padding: '6px 10px', fontSize: 12, background: fecha === f ? c.blue : '#262626', color: fecha === f ? '#0a0a0a' : c.textDim }}>
                  {lbl}
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ width: 1, alignSelf: 'stretch', background: c.cardBorder }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUCURSALES.map(code => (
            <button key={code} onClick={() => cambiar(() => setStore(code))}
              style={{ ...btn, padding: '6px 10px', fontSize: 12, background: store === code ? c.green : '#262626', color: store === code ? '#0a0a0a' : c.textDim }}>
              {STORES_SHORT[code]}
            </button>
          ))}
        </div>
      </div>

      {error && <div style={{ ...cardStyle, borderColor: c.red, color: c.red, fontSize: 13 }}>⚠️ {error}</div>}
      {aviso && <div style={{ ...cardStyle, borderColor: c.green, color: c.green, fontSize: 13 }}>✓ {aviso}</div>}

      {!cargando && <FilaKpis r={resumen} dias={enSemana ? diasConHoja : null} diasPosibles={7} />}

      {/* ── Resumen ── */}
      <div style={{ ...cardStyle, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        <span style={{ fontWeight: 700 }}>
          {STORES_SHORT[store]} · {enSemana ? semana.rango : fecha}
        </span>
        <span style={{ color: c.green }}>✓ {resumen.ok} cuadran</span>
        <span style={{ color: c.yellow }}>▲ {resumen.aviso} a revisar</span>
        <span style={{ color: c.red }}>✕ {resumen.alerta} descuadres</span>
        <span style={{ color: c.textOff }}>○ {resumen.sin_datos} sin contar</span>
        <div style={{ flex: 1 }} />
        {!enSemana && cab?.ingresado_por_nombre && (
          <span style={{ color: c.textDim, fontSize: 11 }}>Última carga: {cab.ingresado_por_nombre}</span>
        )}
        {!enSemana && cerrada && <span style={{ color: c.cyan, fontWeight: 700 }}>🔒 Cerrada</span>}
        <button onClick={exportar} style={{ ...btn, background: '#2a2a2a', color: c.text }}>⬇ CSV</button>
        <button onClick={recargar} disabled={cargando} style={{ ...btn, background: '#2a2a2a', color: c.text }}>↻</button>
      </div>

      {/* Discrepancias entre la hoja de papel y el catálogo. Se muestran para
          que se resuelvan, no para que se descubran a los tres meses. */}
      {notasConfig.length > 0 && (
        <details style={{ ...cardStyle, borderColor: c.orange, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: c.orange, fontWeight: 600 }}>
            📌 {notasConfig.length} producto{notasConfig.length > 1 ? 's' : ''} donde la hoja y el catálogo no dicen lo mismo
          </summary>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, color: c.textDim, lineHeight: 1.7 }}>
            {notasConfig.map(f => (
              <li key={f.item_id}><b style={{ color: c.text }}>{f.nombre}</b> — {f.nota_config}</li>
            ))}
          </ul>
        </details>
      )}

      {cargando && <div style={{ padding: 24, color: c.textDim }}>Cargando…</div>}

      {!cargando && grupos.map(g => (
        <div key={g.categoria} style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${c.cardBorder}` }}>
            <span style={{ marginRight: 8 }}>{CAT_ICONO[g.categoria] || '📦'}</span>{g.categoria}
          </div>
          <div style={{ overflowX: 'auto' }}>
            {enSemana ? <TablaSemana filas={g.filas} /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1060 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Producto</th>
                  <th style={{ ...th, textAlign: 'left' }}>Presentación</th>
                  <th style={{ ...th, textAlign: 'right' }}>CID<InfoTip text="Conteo Inicial del Día: existencia al abrir, en paquetes enteros (+ las unidades sueltas del paquete abierto). El gris de fondo es el cierre de ayer, si se contó." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Se pidió<InfoTip text="Lo que entró ese día, en PAQUETES COMPLETOS. Se propone desde el kardex (traslados recibidos + recepciones) y se puede corregir si la hoja de papel dice otra cosa." /></th>
                  <th style={{ ...th, textAlign: 'right', color: c.orange }}>Desc. AM<InfoTip text="Lo que salió de la bodega de la sucursal hacia la cocina en el turno AM, en paquetes. Es un control interno de la sucursal: NO es la venta y no entra en el cálculo de la diferencia." /></th>
                  <th style={{ ...th, textAlign: 'right', color: c.orange }}>Desc. PM<InfoTip text="Lo mismo que Desc. AM, para el turno PM. Control interno bodega → cocina." /></th>
                  <th style={{ ...th, textAlign: 'right', color: c.cyan }}>Venta día<InfoTip text="Lo que el POS descontó del inventario ese día, del kardex de ventas, ya con combos y modificadores resueltos. Es el número del sistema contra el que se audita." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>TPS Final<InfoTip text="Paquetes ENTEROS que quedan en bodega al cerrar." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>En línea<InfoTip text="Unidades SUELTAS de los paquetes ya abiertos, las que están en cocina. Junto con el TPS Final forman el cierre real." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Teórico<InfoTip text="CID + Se pidió − Venta del día. Lo que debería haber quedado si cada venta descontó exactamente lo que se usó." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Real<InfoTip text="TPS Final + En línea: lo que se contó físicamente al cerrar." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Dif.<InfoTip text="Real − Teórico. Negativo = se fue producto que ninguna venta descontó (merma no reportada, sobre-porcionado, fuga). Positivo = la venta descargó más de lo que realmente se usó." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {g.filas.map(f => {
                  const a = f.aud
                  const col = COLOR_ESTADO[a.estado]
                  const vals = valores[f.item_id] || {}
                  const emp = (q) => (q == null ? '—' : fmtCant(aEmpaques(f, q)))
                  return (
                    <tr key={f.item_id} style={{ borderTop: '1px solid #222' }}>
                      <td style={{ ...td, whiteSpace: 'normal', maxWidth: 190 }}>
                        <span style={{ color: col, marginRight: 6 }}>●</span>
                        {f.nombre}
                        {f.nota_config && <span style={{ color: c.orange, fontSize: 10, marginLeft: 5 }} title={f.nota_config}>📌</span>}
                      </td>
                      <td style={{ ...td, color: c.textDim, fontSize: 11, whiteSpace: 'normal', maxWidth: 150 }}>
                        {f.unidad_conteo}
                        {f.unidades_derivadas && <div style={{ color: c.textOff }}>{f.unidades_derivadas}</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <CeldaCid item={f} valores={vals} onChange={onChange}
                          disabled={cerrada} arrastrado={a.cidFuente === 'arrastrado'} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Casilla item={f} campo="pedido_enteros" valores={vals} onChange={onChange}
                          disabled={cerrada} sugerido={aEmpaques(f, a.pedidoSistema)}
                          titulo={f.unidad_conteo} />
                        {a.pedidoDifiere && (
                          <div style={{ fontSize: 10, color: c.yellow }} title="Lo digitado no coincide con lo que registró el kardex">
                            sistema: {emp(a.pedidoSistema)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Casilla item={f} campo="descarga_am" valores={vals} onChange={onChange}
                          disabled={cerrada} titulo={`Bodega → cocina AM (${f.unidad_conteo})`} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Casilla item={f} campo="descarga_pm" valores={vals} onChange={onChange}
                          disabled={cerrada} titulo={`Bodega → cocina PM (${f.unidad_conteo})`} />
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: c.cyan, fontWeight: 700 }}>{emp(a.venta)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Casilla item={f} campo="tps_enteros" valores={vals} onChange={onChange}
                          disabled={cerrada} titulo={`Paquetes en bodega (${f.unidad_conteo})`} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Casilla item={f} campo="linea_sueltas" valores={vals} onChange={onChange}
                          disabled={cerrada}
                          titulo={f.fraccionado ? `Sueltas en cocina (${f.unidad_suelta})` : `Abierto en cocina (${f.unidad_conteo})`} />
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: c.textDim }}>{emp(a.teorico)}</td>
                      <td style={{ ...td, textAlign: 'right', color: c.textDim }}>{emp(a.real)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: col }}
                          title={a.diferencia == null ? 'Falta CID o TPS Final' : decirEnEmpaques(f, a.diferencia)}>
                        {a.diferencia == null ? '—' : (a.diferencia > 0 ? '+' : '') + fmtCant(aEmpaques(f, a.diferencia))}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontSize: 11, color: col }}>
                        {a.pct == null ? '—' : (a.pct > 0 ? '+' : '') + a.pct.toFixed(1) + '%'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>
      ))}

      {/* ── Guardar ── */}
      {!cargando && !enSemana && (
        <div style={{ ...cardStyle, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 280px', fontSize: 11, color: c.textDim, fontWeight: 600 }}>
            Notas de la hoja<br />
            <input value={notas} onChange={e => { setNotas(e.target.value); setSucio(true) }}
              disabled={cerrada} placeholder="Ej.: faltó contar el congelador de atrás"
              style={{ width: '100%', background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, marginTop: 3 }} />
          </label>
          {cerrada ? (
            <button onClick={reabrir} disabled={guardando} style={{ ...btn, background: '#2a2a2a', color: c.yellow }}>
              🔓 Reabrir para corregir
            </button>
          ) : (
            <>
              <button onClick={() => guardar(false)} disabled={guardando}
                style={{ ...btn, background: c.green, color: '#0a0a0a', opacity: guardando ? 0.6 : 1 }}>
                {guardando ? 'Guardando…' : sucio ? '💾 Guardar cambios' : '💾 Guardar'}
              </button>
              <button onClick={() => guardar(true)} disabled={guardando}
                style={{ ...btn, background: '#2a2a2a', color: c.cyan }}>
                🔒 Guardar y cerrar
              </button>
            </>
          )}
        </div>
      )}

      {enSemana ? (
        <div style={{ fontSize: 11, color: c.textOff, marginTop: 4, lineHeight: 1.6 }}>
          La diferencia de la semana <b>no</b> es la resta de los totales: cada día tiene su propia
          apertura, y sumar siete aperturas no significa nada. Se cierra la ecuación
          <b> día por día</b> y se suman sólo los días con apertura y cierre — por eso la columna
          <b> Días</b>: un descuadre de la semana sobre 2 de 7 días contados no se lee igual que sobre 7.
          La <b>apertura de cada día se arrastra del cierre del día anterior</b> cuando no se digitó,
          y si falta un día en medio la cadena se corta ahí en vez de arrastrar sobre un hueco.
        </div>
      ) : (
      <div style={{ fontSize: 11, color: c.textOff, marginTop: 4, lineHeight: 1.6 }}>
        <b>Teórico = CID + Se pidió − Venta del día</b> · <b>Real = TPS Final + En línea</b>.
        El <b>CID se arrastra solo</b> del cierre de ayer (marcado con <b style={{ color: c.blue }}>↩</b>);
        si lo digitás, manda lo tuyo.
        La <b style={{ color: c.cyan }}>venta del día</b> sale del kardex que escribe el POS al cobrar, ya con
        combos y modificadores resueltos. Las columnas <b style={{ color: c.orange }}>Desc. AM/PM</b> son el
        control interno de bodega a cocina: se guardan pero no entran en el cálculo.
        Una diferencia <b style={{ color: c.red }}>negativa</b> significa que se fue producto del inventario
        que ninguna venta descontó; una <b style={{ color: c.green }}>positiva</b>, que la venta descargó
        más de lo que realmente se usó. Una celda vacía no es cero: la fila queda <i>sin contar</i> y no
        entra en el veredicto.
      </div>
      )}
    </div>
  )
}
