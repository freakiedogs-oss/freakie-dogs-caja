import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { db } from '../../supabase'
import { STORES_SHORT, today, shiftDate } from '../../config'
import InfoTip from '../ui/InfoTip'
import {
  auditarHoja, resumenHoja, agruparPorCategoria, aPayload,
  aEmpaques, fmtCant, decirEnEmpaques, vacio, n,
} from './criticosConteo'

/**
 * ConteoCriticosTab — "Conteo de Críticos", la hoja de Saúl dentro del ERP.
 *
 * Espejo de `Criticos_FD_FORMATO.xlsx` (Manual de Operaciones · Sistemas de
 * Inventario v1A): 15 productos críticos, una hoja por sucursal y día.
 *
 * Lo que digita Saúl (blanco):  CID · Se pidió · TPS Final · En Línea
 * Lo que pone el sistema (gris): Descargas AM/PM desde el kardex de ventas,
 *                                y "Se pidió" propuesto desde los traslados
 *                                recibidos, que él puede corregir.
 *
 *     teórico = CID + Se pidió − Descargas
 *     real    = TPS Final + En Línea
 *     dif     = real − teórico  ( = descargas del sistema − consumo físico )
 *
 * Una diferencia NEGATIVA es la que duele: se fue producto del físico que
 * ninguna venta descontó.
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

const COLOR_ESTADO = {
  ok: c.green, aviso: c.yellow, alerta: c.red, sin_datos: c.textOff,
}
const TEXTO_ESTADO = {
  ok: 'Cuadra', aviso: 'Revisar', alerta: 'Descuadre', sin_datos: 'Sin contar',
}

/* Sólo sucursales que operan caja. Casa Matriz no vende, así que no tiene
   descargas contra las que cruzar, y Eventos no tiene bodega fija. */
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

/* ── Celda de captura ───────────────────────────────────────────────────
   Un input para empaques enteros y, sólo si el producto se abre en
   sucursal, otro para lo suelto. Es la misma forma de contar del conteo
   nocturno: la carne son paquetes de 20 MÁS las bolitas del paquete
   abierto, y pedirla en decimales de paquete sería pedir una cuenta
   mental que nadie hace bien a las 10 de la noche.
   ─────────────────────────────────────────────────────────────────────── */
function Celda({ item, campo, valores, onChange, disabled, sugerido }) {
  const kE = `${campo}_enteros`, kS = `${campo}_sueltas`
  const vE = valores[kE], vS = valores[kS]
  const inputStyle = {
    width: item.fraccionado ? 46 : 62, background: disabled ? '#151515' : c.input,
    color: c.text, border: `1px solid ${c.border}`, borderRadius: 6,
    padding: '4px 5px', fontSize: 12.5, textAlign: 'right',
  }
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
      <input
        type="number" min="0" step="any" inputMode="decimal"
        value={vacio(vE) ? '' : vE} disabled={disabled}
        placeholder={sugerido != null ? fmtCant(sugerido) : ''}
        onChange={e => onChange(item.item_id, kE, e.target.value)}
        style={inputStyle} title={item.unidad_conteo}
      />
      {item.fraccionado && (
        <>
          <span style={{ color: c.textOff, fontSize: 11 }}>+</span>
          <input
            type="number" min="0" step="any" inputMode="decimal"
            value={vacio(vS) ? '' : vS} disabled={disabled}
            onChange={e => onChange(item.item_id, kS, e.target.value)}
            style={inputStyle} title={item.unidad_suelta}
          />
        </>
      )}
    </div>
  )
}

export default function ConteoCriticosTab({ user }) {
  const hoy = today()
  const [store, setStore] = useState(user?.store_code && SUCURSALES.includes(user.store_code)
    ? user.store_code : SUCURSALES[0])
  const [fecha, setFecha] = useState(hoy)
  const [modo, setModo] = useState('turno')         // 'turno' | 'hora'
  const [horaCorte, setHoraCorte] = useState('16:00')
  const [hoja, setHoja] = useState(null)
  const [valores, setValores] = useState({})         // item_id → { campo: valor }
  const [notas, setNotas] = useState('')
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [sucio, setSucio] = useState(false)
  const notasCargadas = useRef('')

  const cargar = useCallback(async () => {
    setCargando(true); setError(''); setAviso('')
    const { data, error: err } = await db.rpc('fn_criticos_hoja', {
      p_store_code: store, p_fecha: fecha, p_modo: modo, p_hora_corte: horaCorte,
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
          pedido_enteros: it.pedido_enteros, pedido_sueltas: it.pedido_sueltas,
          tps_enteros: it.tps_enteros, tps_sueltas: it.tps_sueltas,
          linea_enteros: it.linea_enteros, linea_sueltas: it.linea_sueltas,
          notas: it.notas,
        }
      }
      setValores(v)
      const nt = data?.cabecera?.notas || ''
      setNotas(nt); notasCargadas.current = nt
      setSucio(false)
    }
    setCargando(false)
  }, [store, fecha, modo, horaCorte])

  useEffect(() => { cargar() }, [cargar])

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

  const grupos = useMemo(() => agruparPorCategoria(filas), [filas])
  const resumen = useMemo(() => resumenHoja(filas), [filas])
  const notasConfig = useMemo(() => filas.filter(f => f.nota_config), [filas])

  const guardar = async (cerrar = false) => {
    setGuardando(true); setError(''); setAviso('')
    const payload = aPayload(filas.map(f => ({
      item_id: f.item_id, ...(valores[f.item_id] || {}),
    })))
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
    downloadCSV(`criticos_${store}_${fecha}.csv`, [
      ['Categoría', 'Producto', 'Presentación', 'Unidades derivadas', 'Unidad de conteo',
       'CID', 'Se pidió', 'Descarga AM', 'Descarga PM', 'TPS Final', 'En línea',
       'Cierre real', 'Cierre teórico', 'Diferencia', '% dif', 'Estado', 'Unidad'],
      ...filas.map(f => {
        const a = f.aud
        const e = (q) => (q == null ? '' : Number(aEmpaques(f, q).toFixed(4)))
        return [
          f.categoria, f.nombre, f.presentacion, f.unidades_derivadas, f.unidad_conteo,
          e(a.cid), e(a.pedido), e(a.am), e(a.pm), e(a.tps), e(a.linea),
          e(a.real), e(a.teorico), e(a.diferencia),
          a.pct == null ? '' : Number(a.pct.toFixed(2)),
          TEXTO_ESTADO[a.estado], f.unidad_conteo,
        ]
      }),
    ])
  }

  const cab = hoja?.cabecera
  const turnos = hoja?.turnos || []

  return (
    <div>
      {/* ── Filtros ── */}
      <div style={{ ...cardStyle, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
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

      {/* ── Corte AM/PM ── */}
      <div style={{ ...cardStyle, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <span style={{ fontSize: 11, color: c.textDim, fontWeight: 600 }}>
          CORTE AM/PM
          <InfoTip text="Cómo se parte el día para las descargas. Por turno de caja usa el turno real que abrió la sucursal; por hora fija corta a la hora que elijas. El total del día es el mismo en los dos modos." />
        </span>
        <button onClick={() => setModo('turno')}
          style={{ ...btn, padding: '6px 10px', fontSize: 12, background: modo === 'turno' ? c.blue : '#262626', color: modo === 'turno' ? '#0a0a0a' : c.textDim }}>
          Turno de caja
        </button>
        <button onClick={() => setModo('hora')}
          style={{ ...btn, padding: '6px 10px', fontSize: 12, background: modo === 'hora' ? c.blue : '#262626', color: modo === 'hora' ? '#0a0a0a' : c.textDim }}>
          Hora fija
        </button>
        {modo === 'hora' && (
          <input type="time" value={horaCorte} onChange={e => setHoraCorte(e.target.value)}
            style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5 }} />
        )}
        {turnos.length > 0 && (
          <span style={{ color: c.textDim, marginLeft: 4 }}>
            {turnos.map((t, i) => (
              <span key={i} style={{ marginRight: 10 }}>
                <b style={{ color: t.tramo === 'AM' ? c.cyan : c.purple }}>{t.tramo}</b>
                {' '}{t.abierto}–{t.cerrado || '…'}
                {t.caja ? ` · ${t.caja}` : ''}
              </span>
            ))}
          </span>
        )}
      </div>

      {/* El PM vacío tiene que explicarse, o se lee como "no se vendió en la
          tarde" — que es falso y es justo lo que un auditor no debe creer. */}
      {modo === 'turno' && cab && !cab.hay_pm && (
        <div style={{ ...cardStyle, borderColor: c.yellow, fontSize: 12, color: c.yellow }}>
          ⚠️ El {fecha} en {STORES_SHORT[store]} la caja corrió con <b>un solo turno</b>
          {turnos.length > 1 ? ` (${turnos.length} cajas en paralelo, todas turno 1)` : ''},
          así que <b>todas las descargas caen en AM</b> y la columna PM va en cero.
          No significa que no se vendió en la tarde. Para partir el día igual,
          cambiá el corte a <b>Hora fija</b>.
        </div>
      )}

      {error && <div style={{ ...cardStyle, borderColor: c.red, color: c.red, fontSize: 13 }}>⚠️ {error}</div>}
      {aviso && <div style={{ ...cardStyle, borderColor: c.green, color: c.green, fontSize: 13 }}>✓ {aviso}</div>}

      {/* ── Resumen ── */}
      <div style={{ ...cardStyle, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        <span style={{ fontWeight: 700 }}>{STORES_SHORT[store]} · {fecha}</span>
        <span style={{ color: c.green }}>✓ {resumen.ok} cuadran</span>
        <span style={{ color: c.yellow }}>▲ {resumen.aviso} a revisar</span>
        <span style={{ color: c.red }}>✕ {resumen.alerta} descuadres</span>
        <span style={{ color: c.textOff }}>○ {resumen.sin_datos} sin contar</span>
        <div style={{ flex: 1 }} />
        {cab?.ingresado_por_nombre && (
          <span style={{ color: c.textDim, fontSize: 11 }}>Última carga: {cab.ingresado_por_nombre}</span>
        )}
        {cerrada && <span style={{ color: c.cyan, fontWeight: 700 }}>🔒 Cerrada</span>}
        <button onClick={exportar} style={{ ...btn, background: '#2a2a2a', color: c.text }}>⬇ CSV</button>
        <button onClick={cargar} disabled={cargando} style={{ ...btn, background: '#2a2a2a', color: c.text }}>↻</button>
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
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Producto</th>
                  <th style={{ ...th, textAlign: 'left' }}>Presentación</th>
                  <th style={{ ...th, textAlign: 'right' }}>CID<InfoTip text="Conteo Inicial del Día: existencia al abrir, en empaques enteros (+ sueltos si el empaque se abre en sucursal). Si ayer se contó, el gris de fondo es el cierre de ayer." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Se pidió<InfoTip text="Lo que entró ese día según el kardex (traslados recibidos + recepciones). Se puede corregir si la hoja de papel dice otra cosa." /></th>
                  <th style={{ ...th, textAlign: 'right', color: c.cyan }}>Desc. AM</th>
                  <th style={{ ...th, textAlign: 'right', color: c.purple }}>Desc. PM</th>
                  <th style={{ ...th, textAlign: 'right' }}>TPS Final</th>
                  <th style={{ ...th, textAlign: 'right' }}>En línea</th>
                  <th style={{ ...th, textAlign: 'right' }}>Teórico<InfoTip text="CID + Se pidió − Descargas. Lo que debería haber quedado si cada venta descontó exactamente lo que se usó." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Real<InfoTip text="TPS Final + En línea: lo que se contó físicamente al cerrar." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Dif.<InfoTip text="Real − Teórico. Negativo = se fue producto que ninguna venta descontó (merma no reportada, sobre-porcionado, fuga). Positivo = sobra producto contra lo que descargó el sistema." /></th>
                  <th style={{ ...th, textAlign: 'right' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {g.filas.map(f => {
                  const a = f.aud
                  const col = COLOR_ESTADO[a.estado]
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
                        <Celda item={f} campo="cid" valores={valores[f.item_id] || {}} onChange={onChange}
                          disabled={cerrada} sugerido={aEmpaques(f, f.cid_sugerido)} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Celda item={f} campo="pedido" valores={valores[f.item_id] || {}} onChange={onChange}
                          disabled={cerrada} sugerido={aEmpaques(f, a.pedidoSistema)} />
                        {a.pedidoDifiere && (
                          <div style={{ fontSize: 10, color: c.yellow }} title="Lo digitado no coincide con lo que registró el kardex">
                            sistema: {emp(a.pedidoSistema)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: c.cyan, fontWeight: 600 }}>{emp(a.am)}</td>
                      <td style={{ ...td, textAlign: 'right', color: c.purple, fontWeight: 600 }}>{emp(a.pm)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Celda item={f} campo="tps" valores={valores[f.item_id] || {}} onChange={onChange} disabled={cerrada} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Celda item={f} campo="linea" valores={valores[f.item_id] || {}} onChange={onChange} disabled={cerrada} />
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
          </div>
        </div>
      ))}

      {/* ── Guardar ── */}
      {!cargando && (
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

      <div style={{ fontSize: 11, color: c.textOff, marginTop: 4, lineHeight: 1.6 }}>
        Las <b>descargas</b> salen del mismo kardex que alimenta la pestaña de Componentes: lo que el POS
        descontó al cobrar, ya con combos y modificadores resueltos. El <b>físico</b> lo pone Saúl.
        Una diferencia <b style={{ color: c.red }}>negativa</b> significa que se fue producto del inventario
        que ninguna venta descontó; una <b style={{ color: c.green }}>positiva</b>, que el sistema descargó
        más de lo que realmente se usó. Una celda vacía no es cero: la fila queda <i>sin contar</i> y no
        entra en el veredicto.
      </div>
    </div>
  )
}
