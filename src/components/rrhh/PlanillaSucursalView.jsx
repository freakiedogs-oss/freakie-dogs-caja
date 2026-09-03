/* ═══════════════════════════════════════════════════════════════════════
   Planilla de mi sucursal — vista del encargado

   El objetivo no es informar, es que el encargado pueda ACTUAR. Por eso:

   · Un solo numero arriba (el % sobre venta) y su puesto entre las seis.
     Si entra 30 segundos entre un pedido y otro, eso es lo que se lleva.

   · SEMAFORO DOBLE. El % solo premia recortar gente: Metrocentro estaba en
     6.3 % con 559 horas extra y sin gerente, o sea quemando al equipo. Al
     lado del % va SIEMPRE las horas extra por persona, para que una
     sucursal "verde" a costa de horas salga marcada igual.

   · Las palancas con su efecto YA CALCULADO. Decirle "estas en rojo" sin
     decirle cuanto mueve cada cosa lo empuja a la unica salida que se le
     ocurre, que es despedir.

   · Ventas por dia de la semana. Muchas veces el problema no es cuanta
     gente hay sino cuando esta: Lourdes vende el doble el sabado que el
     martes con la misma planilla.

   Casa Matriz NO se prorratea: el encargado responde por lo que controla.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, useCallback } from 'react'
import { db } from '../../supabase'

// Ven su propia sucursal. Los de arriba pueden elegir cual mirar.
const ROLES_VEN_TODAS = ['jefe_casa_matriz', 'admin', 'ejecutivo', 'superadmin', 'rrhh']
const ROLES_VEN_SUYA  = ['gerente']

const SUCURSALES = [
  { code: 'M001', nombre: 'Plaza Cafetalón' },
  { code: 'S001', nombre: 'Plaza Mundo Soyapango' },
  { code: 'S002', nombre: 'Plaza Mundo Usulután' },
  { code: 'S003', nombre: 'Grand Plaza Lourdes' },
  { code: 'S004', nombre: 'Paseo Venecia' },
  { code: 'S006', nombre: 'Metro Centro 8va Etapa' },
]

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', warn: '#eab308', bad: '#ef4444', acc: '#60a5fa',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 15, marginBottom: 12 }
const mini = { background: '#101012', border: `1px solid ${C.line}`, borderRadius: 9, padding: '11px 13px' }

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const DIA_CORTO = { Monday: 'Lun', Tuesday: 'Mar', Wednesday: 'Mié', Thursday: 'Jue',
                    Friday: 'Vie', Saturday: 'Sáb', Sunday: 'Dom' }

export default function PlanillaSucursalView({ user }) {
  const [cargando, setCargando] = useState(true)
  const [error, setError]       = useState('')
  const [d, setD]               = useState(null)
  const [suc, setSuc]           = useState(user?.store_code || 'S003')
  const [verEquipo, setVerEquipo] = useState(false)

  const puedeElegir = ROLES_VEN_TODAS.includes(user?.rol)
  const puedeVer    = puedeElegir || ROLES_VEN_SUYA.includes(user?.rol)

  const cargar = useCallback(async (code) => {
    setCargando(true); setError('')
    try {
      const { data, error: e } = await db.rpc('fn_planilla_panel_sucursal', { p_store_code: code })
      if (e) throw e
      if (data?.error) throw new Error(data.error)
      setD(data)
    } catch (e) {
      // Un 42501 es falta de GRANT, no de politica. Se traduce porque el
      // mensaje crudo de Postgres no le dice nada a un encargado.
      setError(e.code === '42501' || /permission denied/i.test(e.message || '')
        ? 'No tenés permiso para ver esta información. Avisá a Casa Matriz.'
        : (e.message || 'No se pudo cargar'))
    }
    setCargando(false)
  }, [])

  useEffect(() => { if (puedeVer) cargar(suc) }, [cargar, suc, puedeVer])

  if (!puedeVer) {
    return <div style={{ padding: 20, color: C.dim, background: C.bg, minHeight: '100vh' }}>
      Esta pantalla es para encargados de sucursal.
    </div>
  }
  if (cargando) return <div style={{ padding: 20, color: C.dim }}>Cargando…</div>

  const meta = Number(d?.meta_pct ?? 12)
  const pct  = d?.pct == null ? null : Number(d.pct)
  const enMeta = pct != null && pct <= meta
  // Umbral de horas extra: el doble del promedio de la cadena es la senal de
  // que la sucursal esta tapando falta de personal con horas.
  const hexProm = Number(d?.cadena?.hex_por_persona ?? 0)
  const hexMio  = Number(d?.hex_por_persona ?? 0)
  const hexAlto = hexProm > 0 && hexMio > hexProm * 2

  // Efecto de cortar la mitad de las horas extra. La hora extra diurna se
  // paga a ~$3, que es lo que se ve en las planillas de agosto.
  const ahorroHex = (Number(d?.horas_extra) || 0) * 3 * 0.5
  const pctSinHex = d?.venta > 0 ? ((Number(d.planilla) - ahorroHex) / d.venta * 100) : null
  const ventaParaMeta = meta > 0 ? Number(d?.planilla) / (meta / 100) : null
  const maxDia = Math.max(1, ...(d?.dias || []).map(x => Number(x.venta) || 0))

  return (
    <div style={{ padding: 14, background: C.bg, color: C.txt, minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>💵 Mi planilla</h2>
          {puedeElegir ? (
            <select value={suc} onChange={e => setSuc(e.target.value)}
              style={{ background: '#141416', color: C.txt, border: `1px solid ${C.line}`,
                       borderRadius: 8, padding: '6px 9px', fontSize: 13, fontFamily: 'inherit' }}>
              {SUCURSALES.map(s => <option key={s.code} value={s.code}>{s.nombre}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 13, color: C.dim }}>{d?.sucursal}</span>
          )}
        </div>
        <div style={{ color: C.dim, fontSize: 13, marginBottom: 16 }}>Agosto 2026 · mes cerrado</div>

        {error && (
          <div style={{ ...card, background: '#3a1414', border: `1px solid ${C.bad}`, color: '#fca5a5' }}>{error}</div>
        )}

        {d && !error && <>
          {/* ── El número ── */}
          <div style={{
            ...card, background: enMeta ? '#14331f' : '#3a1414',
            border: `1px solid ${enMeta ? C.ok : C.bad}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11.5, letterSpacing: .5, textTransform: 'uppercase',
                              color: enMeta ? '#86efac' : '#fca5a5' }}>Planilla sobre venta</div>
                <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.12,
                              color: enMeta ? C.ok : C.bad }}>{pct == null ? '—' : pct + '%'}</div>
                <div style={{ fontSize: 12.5, color: enMeta ? '#86efac' : '#fca5a5' }}>
                  la meta es {meta}%
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11.5, color: enMeta ? '#86efac' : '#fca5a5' }}>
                  {enMeta ? 'te sobran' : 'te pasaste por'}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: enMeta ? C.ok : C.bad }}>
                  {money(Math.abs(Number(d.diferencia)))}
                </div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 5 }}>
                  puesto {d.puesto} de {d.total_sucursales}
                </div>
              </div>
            </div>
          </div>

          {/* ── Segundo semáforo: horas extra por persona ──
              Sin esto, la pantalla premia a quien recorta gente y la tapa con horas. */}
          <div style={{
            ...card, marginBottom: 12,
            background: hexAlto ? '#3a2f0f' : C.card,
            border: `1px solid ${hexAlto ? C.warn : C.line}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: hexAlto ? '#fcd34d' : C.txt }}>
                  {hexAlto ? '⚠️ Estás cargando mucho al equipo' : 'Carga del equipo'}
                </div>
                <div style={{ fontSize: 12, color: hexAlto ? '#fcd34d' : C.dim, marginTop: 3, lineHeight: 1.5 }}>
                  {hexMio} horas extra por persona · el promedio de la cadena es {hexProm}
                  {hexAlto && '. Un buen porcentaje a base de horas extra no es eficiencia, es falta de gente.'}
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: hexAlto ? C.warn : C.dim, whiteSpace: 'nowrap' }}>
                {hexMio}h
              </div>
            </div>
          </div>

          {/* ── Cifras base ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 14 }}>
            <div style={mini}>
              <div style={{ fontSize: 11, color: C.dim }}>Planilla</div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{money(d.planilla)}</div>
            </div>
            <div style={mini}>
              <div style={{ fontSize: 11, color: C.dim }}>Venta</div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{money(d.venta)}</div>
            </div>
            <div style={mini}>
              <div style={{ fontSize: 11, color: C.dim }}>Meta</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.ok }}>{money(d.meta_monto)}</div>
            </div>
            <div style={mini}>
              <div style={{ fontSize: 11, color: C.dim }}>Personas</div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{d.personas}</div>
            </div>
          </div>

          {/* ── Palancas ── */}
          <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: C.dim, margin: '0 0 8px' }}>
            Qué podés mover
          </div>

          <div style={{ ...mini, marginBottom: 7, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.horas_extra} horas extra este mes</div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
                {pctSinHex != null
                  ? `Si las bajás a la mitad, el % queda en ${pctSinHex.toFixed(1)}%`
                  : 'Sin venta registrada, no se puede calcular el efecto'}
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.warn, whiteSpace: 'nowrap' }}>{money(ahorroHex)}</div>
          </div>

          <div style={{ ...mini, marginBottom: 7, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.personas} personas en planilla</div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
                Con tu venta, la meta da para {d.personas_que_aguanta ?? '—'}
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap',
                          color: (d.personas_que_aguanta ?? d.personas) >= d.personas ? C.ok : C.bad }}>
              {d.personas_que_aguanta == null ? '—'
                : (d.personas - d.personas_que_aguanta > 0
                    ? '+' + (d.personas - d.personas_que_aguanta)
                    : 'ok')}
            </div>
          </div>

          <div style={{ ...mini, marginBottom: 7, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>O vendé más</div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
                Con {money(ventaParaMeta)} llegás a la meta sin tocar a nadie
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.acc, whiteSpace: 'nowrap' }}>
              {d.venta > 0 ? '+' + Math.round((ventaParaMeta / d.venta - 1) * 100) + '%' : '—'}
            </div>
          </div>

          <div style={{ ...mini, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Cada persona genera {money(d.venta_por_persona)}</div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
                El promedio de la cadena es {money(d.cadena?.venta_por_persona)}
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap',
                          color: Number(d.venta_por_persona) >= Number(d.cadena?.venta_por_persona) ? C.ok : C.bad }}>
              {d.cadena?.venta_por_persona
                ? (Number(d.venta_por_persona) >= Number(d.cadena.venta_por_persona) ? '↑' : '↓')
                : ''}
            </div>
          </div>

          {/* ── Ventas por día ──
              Muchas veces el problema no es cuanta gente hay, sino cuando esta. */}
          {(d.dias || []).length > 0 && (() => {
            const vals = d.dias.map(x => Number(x.venta) || 0)
            const bajo = Math.min(...vals), alto = Math.max(...vals)
            const brecha = bajo > 0 ? Math.round((alto / bajo - 1) * 100) : 0
            return (
              <div style={{ ...card }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>Venta promedio por día</div>
                <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 12, lineHeight: 1.5 }}>
                  {brecha > 40
                    ? `Tu mejor día vende ${brecha}% más que el peor. Si tenés la misma gente todos los días, te sobra en unos y te falta en otros — quizás el ajuste es de horario, no de cantidad.`
                    : 'Tu venta es pareja durante la semana.'}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 92 }}>
                  {d.dias.map((x, i) => {
                    const v = Number(x.venta) || 0
                    const h = Math.max(6, Math.round(v / maxDia * 70))
                    const esAlto = v === alto, esBajo = v === bajo
                    return (
                      <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>{money(v)}</div>
                        <div style={{ height: h, borderRadius: '4px 4px 0 0',
                                      background: esAlto ? C.ok : esBajo ? C.bad : '#3f3f46' }} />
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                          {DIA_CORTO[x.dia] || String(x.dia).slice(0, 3)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ── Equipo ── */}
          <button onClick={() => setVerEquipo(v => !v)}
            style={{ width: '100%', background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
                     padding: '13px 15px', color: C.txt, fontFamily: 'inherit', fontSize: 14,
                     cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
            <span>Mi equipo · {(d.equipo || []).length} personas</span>
            <span style={{ color: C.dim }}>{verEquipo ? '▲' : '▼'}</span>
          </button>

          {verEquipo && (
            <div style={{ ...card, marginTop: 8, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '9px 12px' }}>Nombre</th>
                    <th style={{ textAlign: 'left', padding: '9px 6px' }}>Cargo</th>
                    <th style={{ textAlign: 'right', padding: '9px 6px' }}>H.ex</th>
                    <th style={{ textAlign: 'right', padding: '9px 12px' }}>Agosto</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.equipo || []).map((e, i) => (
                    <tr key={i} style={{ borderTop: `1px solid #212125`, opacity: e.sigue ? 1 : .45 }}>
                      <td style={{ padding: '8px 12px' }}>
                        {e.nombre}
                        {e.origen === 'Motorista' && (
                          <span style={{ fontSize: 10, background: '#1e1b4b', color: '#c7d2fe',
                                         padding: '1px 6px', borderRadius: 20, marginLeft: 6 }}>motorista</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px', color: C.dim }}>{e.cargo}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: Number(e.horas_extra) > 40 ? C.warn : C.dim }}>
                        {e.horas_extra}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {money(e.devengado)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 11.5, color: '#6b6a72', marginTop: 14, lineHeight: 1.6 }}>
            El monto de cada persona es lo devengado en agosto: salario, viáticos, días y horas
            extra, antes de ISSS, AFP y renta. La planilla de Casa Matriz no está incluida —
            este número mide solo lo que vos manejás.
          </div>
        </>}
      </div>
    </div>
  )
}
