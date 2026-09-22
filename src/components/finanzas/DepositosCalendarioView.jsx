import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../../supabase'
import { STORES, STORES_SHORT, today } from '../../config'
import InfoTip from '../ui/InfoTip'
import { armarModelo, estadoCelda, TOL_OK, TOL_WARN, DIAS_GRACIA } from './depositosConciliacion'

/* ═══════════════════════════════════════════════════════════════════════
   Control de Depósitos — calendario sucursal × día

   La pregunta que responde, de un vistazo: ¿de qué días de venta NO llegó
   el efectivo al banco? Una fila por día, una columna por sucursal, y el
   color dice si ese día ya quedó cubierto por un depósito.

   El eje es el DÍA DE VENTA (`dias_cubiertos`), no `fecha_deposito`. Es a
   propósito: la fecha del depósito la teclea la persona y se equivoca
   —hay un depósito del 2-sep con fecha_deposito 30-sep—, así que filtrar
   por ahí escondería justo el caso que hay que ver. `dias_cubiertos` sale
   de marcar los cierres, que existen o no existen.

   Sólo LEE. Confirmar un depósito se sigue haciendo en el Dashboard de
   Cierres (AdminView), que es donde vive esa decisión.
   ═══════════════════════════════════════════════════════════════════════ */

const C = {
  bg: '#0f0f11', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', info: '#3b82f6', red: '#e63946',
}

// Anular es una corrección contable: mueve el efectivo recibido del mes.
// Gerencia sí, la sucursal no — la sucursal corrige desde su propio registro
// de depósito, que es donde tiene el voucher en la mano.
const PUEDE_ANULAR = ['admin', 'ejecutivo', 'superadmin']

const fmt$ = (v) => (v == null || isNaN(+v)) ? '—' : (+v < 0 ? '-' : '') + '$' + Math.abs(+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (v) => (+v < 0 ? '-' : '') + '$' + Math.round(Math.abs(+v || 0)).toLocaleString('en-US')

const mesDe = (d) => d.slice(0, 7)
const diasDelMes = (mes) => {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: ultimo }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)
}
const mesShift = (mes, k) => {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + k, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const restarDias = (fecha, k) => {
  const d = new Date(fecha + 'T12:00:00')
  d.setDate(d.getDate() - k)
  return d.toISOString().split('T')[0]
}
const mayusc1 = (t) => t.charAt(0).toUpperCase() + t.slice(1)

const nombreMes = (mes) =>
  new Date(mes + '-01T12:00:00').toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })
const diaCorto = (f) =>
  new Date(f + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric' })
const diaLargo = (f) =>
  new Date(f + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const esDomingo = (f) => new Date(f + 'T12:00:00').getDay() === 0

// ── Estados de una celda (día × sucursal) ──
const ESTADOS = {
  ok:       { color: C.ok,   bg: 'rgba(34,197,94,.16)',  borde: 'rgba(34,197,94,.45)',  label: 'Depositado y cuadra' },
  warn:     { color: C.warn, bg: 'rgba(245,158,11,.16)', borde: 'rgba(245,158,11,.45)', label: 'Depositado con diferencia' },
  falta:    { color: C.bad,  bg: 'rgba(239,68,68,.18)',  borde: 'rgba(239,68,68,.5)',   label: 'Falta el depósito' },
  plazo:    { color: C.dim,  bg: 'rgba(138,138,146,.10)', borde: 'rgba(138,138,146,.35)', label: `Aún en plazo (${DIAS_GRACIA} día para depositar)` },
  sinCierre:{ color: C.info, bg: 'rgba(59,130,246,.14)', borde: 'rgba(59,130,246,.45)', label: 'Depósito sin cierre ese día' },
  cero:     { color: C.dim,  bg: 'transparent',           borde: C.line,                 label: 'Sin efectivo que depositar' },
  vacio:    { color: '#4a4a52', bg: 'transparent',        borde: 'transparent',          label: 'Sin cierre (no operó)' },
}

export default function DepositosCalendarioView({ user }) {
  const hoy = today()
  const [mes, setMes] = useState(mesDe(hoy))
  const sucPropia = user?.store_code && STORES[user.store_code] ? user.store_code : 'todas'
  const [suc, setSuc] = useState(sucPropia)
  const [soloProblemas, setSoloProblemas] = useState(false)
  const [cierres, setCierres] = useState([])
  const [deps, setDeps] = useState([])
  const [anulados, setAnulados] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)   // { store_code, fecha }
  const [foto, setFoto] = useState(null)

  const dias = useMemo(() => {
    const todos = diasDelMes(mes)
    // El mes en curso se corta en hoy: los días que todavía no existen no
    // son un hueco de depósito, son futuro.
    return mes === mesDe(hoy) ? todos.filter(d => d <= hoy) : todos
  }, [mes, hoy])

  const cargar = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const d1 = dias[0], d2 = dias[dias.length - 1]
      // Los depósitos se buscan por solape de `dias_cubiertos` con el mes, no
      // por `fecha_deposito`: así entra también el que se registró con la
      // fecha mal tecleada pero marcó bien los días que cubre.
      const [cRes, dRes] = await Promise.all([
        db.from('ventas_diarias')
          .select('fecha,store_code,turno,caja,efectivo_real_depositar,efectivo_calculado,diferencia_deposito,estado')
          .gte('fecha', d1).lte('fecha', d2),
        db.from('depositos_bancarios')
          .select('id,store_code,monto,fecha_deposito,dias_cubiertos,fotos_urls,estado,notas,creado_por,created_at,revisado_por,revisado_at,anulado_motivo,anulado_por,anulado_at')
          .overlaps('dias_cubiertos', dias),
      ])
      if (cRes.error) throw cRes.error
      if (dRes.error) throw dRes.error

      let cs = cRes.data || []
      // Los anulados NO entran al cálculo — si sumaran, volvería el descuadre
      // que la anulación vino a arreglar. Pero se guardan aparte para poder
      // mostrarlos en el detalle: un depósito que desaparece sin explicación
      // es peor que uno que sobra.
      const todos = dRes.data || []
      const ds = todos.filter(d => d.estado !== 'anulado')

      // Un depósito del mes puede cubrir días de otro mes (los que cruzan fin
      // de mes). Sin esos cierres, su "esperado" saldría corto y lo pintaría
      // como descuadre inventado.
      const fuera = [...new Set(ds.flatMap(d => d.dias_cubiertos || []).filter(f => f < d1 || f > d2))]
      if (fuera.length) {
        const { data } = await db.from('ventas_diarias')
          .select('fecha,store_code,turno,caja,efectivo_real_depositar,efectivo_calculado,diferencia_deposito,estado')
          .in('fecha', fuera)
        cs = cs.concat(data || [])
      }
      setCierres(cs); setDeps(ds); setAnulados(todos.filter(d => d.estado === 'anulado'))
    } catch (e) {
      setErr(e.message || String(e))
    }
    setLoading(false)
  }, [dias])

  useEffect(() => { cargar() }, [cargar])

  // Anular desde acá es para los casos que la limpieza automática no podía
  // decidir sola: una corrección vieja que nadie anuló en su momento, y los
  // dos registros quedaron sumando. Exige motivo (lo exige también la base).
  const anular = useCallback(async (dep) => {
    const motivo = window.prompt(
      `Anular el depósito de ${fmt$(dep.monto)} del ${dep.fecha_deposito}.\n\n` +
      'No se borra: queda guardado con su foto y deja de sumar.\n' +
      '¿Por qué se anula?'
    )
    if (motivo === null) return
    if (!motivo.trim()) { setErr('El motivo es obligatorio: sin él, nadie va a saber por qué dejó de contar.'); return }
    const { data, error } = await db.rpc('fn_deposito_anular', {
      p_id: dep.id, p_motivo: motivo, p_por: `${user?.nombre || ''} ${user?.apellido || ''}`.trim() || 'ERP',
    })
    if (error) { setErr(error.message); return }
    if (!data?.ok) { setErr({ falta_motivo: 'Falta el motivo.', no_existe: 'Ese depósito ya no existe.', ya_anulado: 'Ese depósito ya estaba anulado.' }[data?.motivo] || 'No se pudo anular.'); return }
    setSel(null)
    cargar()
  }, [cargar, user])

  // Columnas: las sucursales que realmente aparecen, en el orden de STORES.
  const cols = useMemo(() => {
    const set = new Set([...cierres.map(c => c.store_code), ...deps.map(d => d.store_code)].filter(Boolean))
    const orden = Object.keys(STORES)
    const arr = [...set].sort((a, b) => (orden.indexOf(a) + 1 || 99) - (orden.indexOf(b) + 1 || 99))
    return suc === 'todas' ? arr : arr.filter(s => s === suc)
  }, [cierres, deps, suc])

  // ── El modelo: por sucursal, el esperado de cada día y los grupos de conciliación ──
  const modelo = useMemo(() => armarModelo(cierres, deps), [cierres, deps])

  const celda = useCallback((sc, fecha) => estadoCelda(modelo, sc, fecha, hoy), [modelo, hoy])

  // ── Resumen del mes + lista de pendientes (lo accionable, sin tener que clickear) ──
  const resumen = useMemo(() => {
    const faltantes = [], conDif = []
    let esperado = 0, depositado = 0, pendConfirmar = 0
    const gruposVistos = new Set()
    for (const fecha of dias) {
      for (const sc of cols) {
        const cel = celda(sc, fecha)
        if (!cel) continue
        esperado += cel.esperado
        if (cel.estado === 'falta') faltantes.push({ sc, fecha, monto: cel.esperado })
        if (cel.grupo) {
          const g = cel.grupo
          const key = sc + '|' + g.dias.join(',')
          if (!gruposVistos.has(key)) {
            gruposVistos.add(key)
            depositado += g.depositado
            pendConfirmar += g.pendientes
            if (Math.abs(g.dif) >= TOL_OK) conDif.push({ sc, grupo: g })
          }
        }
      }
    }
    const totalFalta = faltantes.reduce((s, f) => s + f.monto, 0)
    const totalDif = conDif.reduce((s, x) => s + x.grupo.dif, 0)
    return { faltantes, conDif, esperado, depositado, pendConfirmar, totalFalta, totalDif }
  }, [dias, cols, celda])

  const filasVisibles = useMemo(() => {
    if (!soloProblemas) return dias
    return dias.filter(f => cols.some(sc => {
      const cel = celda(sc, f)
      return cel && (cel.estado === 'falta' || (cel.grupo && Math.abs(cel.grupo.dif) >= TOL_OK) || cel.estado === 'sinCierre')
    }))
  }, [dias, cols, celda, soloProblemas])

  const detalle = sel ? celda(sel.store_code, sel.fecha) : null

  // ── UI ──
  const anchoCol = cols.length <= 2 ? 150 : 84
  const box = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }

  return (
    <div style={{ padding: '18px 14px 60px', color: C.txt, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>
          🏦 Control de Depósitos
          <InfoTip text="Un cuadro por día de venta y sucursal. Verde = el efectivo de ese día ya llegó al banco y cuadra contra el cierre. Rojo = no hay ningún depósito que cubra ese día. Tocá un cuadro para ver cuánto era, cuánto se depositó y la foto del voucher." />
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 14 }}>
        Por día de venta, no por fecha del depósito. Sólo lectura: confirmar un depósito se sigue haciendo en el Dashboard de Cierres.
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.card, border: `1px solid ${C.line}`, borderRadius: 9 }}>
          <button onClick={() => setMes(m => mesShift(m, -1))} style={{ background: 'none', border: 'none', color: C.txt, fontSize: 18, padding: '6px 11px', cursor: 'pointer' }}>‹</button>
          <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 128, textAlign: 'center' }}>{mayusc1(nombreMes(mes))}</span>
          <button onClick={() => setMes(m => mesShift(m, 1))} disabled={mes >= mesDe(hoy)}
            style={{ background: 'none', border: 'none', color: mes >= mesDe(hoy) ? '#3a3a40' : C.txt, fontSize: 18, padding: '6px 11px', cursor: mes >= mesDe(hoy) ? 'default' : 'pointer' }}>›</button>
        </div>
        <select value={suc} onChange={e => setSuc(e.target.value)}
          style={{ background: C.card, color: C.txt, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' }}>
          <option value="todas">Todas las sucursales</option>
          {Object.entries(STORES).map(([code, nom]) => <option key={code} value={code}>{code} · {nom}</option>)}
        </select>
        <button onClick={() => setSoloProblemas(v => !v)}
          style={{ background: soloProblemas ? 'rgba(239,68,68,.18)' : C.card, color: soloProblemas ? C.bad : C.dim, border: `1px solid ${soloProblemas ? 'rgba(239,68,68,.5)' : C.line}`, borderRadius: 9, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {soloProblemas ? '● Sólo lo que falta' : '○ Sólo lo que falta'}
        </button>
        <button onClick={cargar} style={{ background: C.card, color: C.dim, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>↻</button>
      </div>

      {err && (
        <div style={{ ...box, borderColor: 'rgba(239,68,68,.5)', color: C.bad, fontSize: 13, marginBottom: 14 }}>
          No se pudieron cargar los datos: {err}
        </div>
      )}

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 10, marginBottom: 14 }}>
        <Tarjeta titulo="Sin depositar" valor={fmt$(resumen.totalFalta)} sub={`${resumen.faltantes.length} día(s)·sucursal fuera de plazo`} color={resumen.faltantes.length ? C.bad : C.ok} />
        <Tarjeta titulo="Con diferencia" valor={fmt$(resumen.totalDif)} sub={`${resumen.conDif.length} depósito(s), no por día`} color={resumen.conDif.length ? C.warn : C.ok} />
        <Tarjeta titulo="Sin confirmar" valor={String(resumen.pendConfirmar)} sub="depósitos esperando revisión" color={resumen.pendConfirmar ? C.info : C.ok} />
        <Tarjeta titulo="Esperado vs depositado" valor={fmt$(resumen.esperado)} sub={`depositado ${fmt$(resumen.depositado)}`} color={C.txt} />
      </div>

      {/* Calendario */}
      <div style={{ ...box, padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.dim, fontSize: 13 }}>Cargando…</div>
        ) : cols.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.dim, fontSize: 13 }}>Sin cierres ni depósitos en este mes.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 92 + cols.length * anchoCol }}>
              {/* Encabezado */}
              <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(${cols.length}, minmax(${anchoCol}px,1fr))`, position: 'sticky', top: 0, background: '#141416', zIndex: 2, borderBottom: `1px solid ${C.line}` }}>
                <div style={{ padding: '9px 10px', fontSize: 10.5, color: C.dim, textTransform: 'uppercase', letterSpacing: .6 }}>Día</div>
                {cols.map(sc => (
                  <div key={sc} style={{ padding: '9px 6px', fontSize: 11, fontWeight: 700, textAlign: 'center', borderLeft: `1px solid ${C.line}` }}>
                    {STORES_SHORT[sc] || sc}
                    <div style={{ fontSize: 9, color: C.dim, fontWeight: 500 }}>{sc}</div>
                  </div>
                ))}
              </div>
              {/* Filas */}
              {filasVisibles.length === 0 ? (
                <div style={{ padding: 34, textAlign: 'center', color: C.ok, fontSize: 13 }}>✓ Nada pendiente en este mes.</div>
              ) : filasVisibles.map((fecha, iFila) => (
                <div key={fecha} style={{ display: 'grid', gridTemplateColumns: `92px repeat(${cols.length}, minmax(${anchoCol}px,1fr))`, borderBottom: `1px solid ${C.line}`, background: esDomingo(fecha) ? 'rgba(255,255,255,.02)' : 'transparent' }}>
                  <div style={{ padding: '8px 10px', fontSize: 12, color: fecha === hoy ? C.red : C.dim, fontWeight: fecha === hoy ? 800 : 500, display: 'flex', alignItems: 'center' }}>
                    {mayusc1(diaCorto(fecha))}
                  </div>
                  {cols.map(sc => {
                    const cel = celda(sc, fecha)
                    const e = ESTADOS[cel?.estado || 'vacio']
                    const activo = sel && sel.store_code === sc && sel.fecha === fecha
                    const dif = cel?.grupo?.dif

                    // Un depósito que cubre 6 días es UN faltante, no seis. Antes
                    // la diferencia se repetía en las 6 celdas y se leía como
                    // 6 × $41. Ahora las celdas del mismo depósito se pintan
                    // UNIDAS (sin borde entre ellas) y la diferencia aparece UNA
                    // sola vez, abajo de todo, diciendo en cuántos días es.
                    // `cel.grupo` es el MISMO objeto para todos los días del
                    // grupo, así que alcanza con comparar por identidad.
                    const arriba = iFila > 0 ? celda(sc, filasVisibles[iFila - 1]) : null
                    const abajo = iFila < filasVisibles.length - 1 ? celda(sc, filasVisibles[iFila + 1]) : null
                    const unidoArriba = !!cel?.grupo && arriba?.grupo === cel.grupo
                    const unidoAbajo = !!cel?.grupo && abajo?.grupo === cel.grupo
                    const nDias = cel?.grupo?.dias?.length || 0
                    // La diferencia se muestra en el ÚLTIMO día visible del grupo.
                    const muestraDif = !!cel?.grupo && !unidoAbajo && Math.abs(dif) >= TOL_OK

                    const titulo = !cel ? '' :
                      `${STORES[sc] || sc} · ${mayusc1(diaLargo(fecha))} — ${e.label}` +
                      (nDias > 1
                        ? `. Parte de UN depósito de ${fmt$(cel.grupo.depositado)} que cubre ${nDias} días (${cel.grupo.dias[0]} al ${cel.grupo.dias[nDias - 1]}). Diferencia del depósito completo: ${fmt$(dif)} — no por día.`
                        : '')

                    return (
                      <button key={sc} onClick={() => cel && setSel({ store_code: sc, fecha })} disabled={!cel}
                        title={titulo}
                        style={{
                          border: 'none', borderLeft: `1px solid ${C.line}`,
                          padding: `${unidoArriba ? 0 : 4}px 4px ${unidoAbajo ? 0 : 4}px`,
                          background: 'transparent', cursor: cel ? 'pointer' : 'default', fontFamily: 'inherit',
                        }}>
                        <div style={{
                          background: e.bg,
                          // Bordes SIEMPRE por lado, nunca con el atajo `border`:
                          // React aplica el atajo después al re-renderizar y pisa
                          // el `none` de arriba/abajo, y el bloque se despega.
                          borderStyle: 'solid', borderColor: activo ? C.txt : e.borde,
                          borderLeftWidth: 1, borderRightWidth: 1,
                          borderTopWidth: unidoArriba ? 0 : 1,
                          borderBottomWidth: unidoAbajo ? 0 : 1,
                          borderTopLeftRadius: unidoArriba ? 0 : 7, borderTopRightRadius: unidoArriba ? 0 : 7,
                          borderBottomLeftRadius: unidoAbajo ? 0 : 7, borderBottomRightRadius: unidoAbajo ? 0 : 7,
                          padding: '6px 4px', minHeight: 38, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', position: 'relative',
                        }}>
                          {!cel ? <span style={{ color: '#3a3a40', fontSize: 12 }}>·</span> : (
                            <>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: e.color }}>
                                {cel.estado === 'sinCierre' ? fmt0(cel.grupo.depositado) : fmt0(cel.esperado)}
                              </span>
                              {muestraDif && (
                                <>
                                  <span style={{ fontSize: 9.5, color: cel.grave ? C.bad : C.warn, fontWeight: 700 }}>
                                    {dif > 0 ? '+' : ''}{fmt0(dif)}
                                  </span>
                                  {nDias > 1 && (
                                    <span style={{ fontSize: 8, color: C.dim, lineHeight: 1.2 }}>
                                      en {nDias} días
                                    </span>
                                  )}
                                </>
                              )}
                              {cel.estado === 'falta' && <span style={{ fontSize: 9, color: C.bad, fontWeight: 700 }}>FALTA</span>}
                              {/* Llave que marca a simple vista que son un solo depósito */}
                              {nDias > 1 && (
                                <span style={{
                                  position: 'absolute', left: 2, top: unidoArriba ? 0 : 4,
                                  bottom: unidoAbajo ? 0 : 4, width: 2, borderRadius: 2,
                                  background: e.color, opacity: .5,
                                }} />
                              )}
                              {cel.grupo?.pendientes > 0 && !unidoArriba && (
                                <span title="Depósito sin confirmar" style={{ position: 'absolute', top: 3, right: 4, width: 5, height: 5, borderRadius: 5, background: C.info }} />
                              )}
                            </>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: C.dim, marginBottom: 16 }}>
        {['ok', 'warn', 'falta', 'plazo', 'sinCierre', 'cero'].map(k => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: ESTADOS[k].bg, border: `1px solid ${ESTADOS[k].borde}`, display: 'inline-block' }} />
            {ESTADOS[k].label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: 5, background: C.info, display: 'inline-block' }} /> Sin confirmar
        </span>
      </div>

      {/* Lo que falta, en texto — para leerlo sin clickear celda por celda */}
      {resumen.faltantes.length > 0 && (
        <div style={{ ...box, borderColor: 'rgba(239,68,68,.35)', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.bad, marginBottom: 8 }}>
            Falta el depósito de {resumen.faltantes.length} día(s) · {fmt$(resumen.totalFalta)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {resumen.faltantes.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).map(f => (
              <button key={f.sc + f.fecha} onClick={() => setSel({ store_code: f.sc, fecha: f.fecha })}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,.07)', border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer', color: C.txt, fontFamily: 'inherit', textAlign: 'left' }}>
                <span style={{ fontSize: 12.5 }}>
                  <b>{STORES_SHORT[f.sc] || f.sc}</b>
                  <span style={{ color: C.dim }}> · {mayusc1(diaCorto(f.fecha))}</span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.bad, fontFamily: 'monospace' }}>{fmt$(f.monto)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Los que no cuadran, UNO POR DEPÓSITO. La grilla es por día, y un
          depósito de 6 días aparece en 6 celdas; acá cada diferencia se
          nombra una sola vez, que es como hay que leerla y reportarla. */}
      {resumen.conDif.length > 0 && (
        <div style={{ ...box, borderColor: 'rgba(245,158,11,.35)', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.warn, marginBottom: 3 }}>
            {resumen.conDif.length} depósito{resumen.conDif.length > 1 ? 's' : ''} no cuadra{resumen.conDif.length > 1 ? 'n' : ''} · {fmt$(resumen.totalDif)}
          </div>
          <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 9 }}>
            Una línea por depósito, no por día: un depósito que cubre varios días tiene UNA diferencia repartida entre todos ellos.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {resumen.conDif.slice().sort((a, b) => Math.abs(b.grupo.dif) - Math.abs(a.grupo.dif)).map(({ sc, grupo: g }) => (
              <button key={sc + g.dias.join(',')} onClick={() => setSel({ store_code: sc, fecha: g.dias[g.dias.length - 1] })}
                style={{ background: 'rgba(245,158,11,.06)', border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: C.txt, fontFamily: 'inherit', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5 }}>
                    <b>{STORES_SHORT[sc] || sc}</b>
                    <span style={{ color: C.dim }}>
                      {' · '}{g.dias.length === 1 ? mayusc1(diaCorto(g.dias[0]))
                        : `${mayusc1(diaCorto(g.dias[0]))} al ${diaCorto(g.dias[g.dias.length - 1])} · ${g.dias.length} días en 1 depósito`}
                    </span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: Math.abs(g.dif) > TOL_WARN ? C.bad : C.warn }}>
                    {g.dif > 0 ? '+' : ''}{fmt$(g.dif)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2, fontFamily: 'monospace' }}>
                  esperado {fmt$(g.esperado)} · depositado {fmt$(g.depositado)}
                  {g.pendientes > 0 && <span style={{ color: C.info }}> · sin confirmar</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Detalle */}
      {sel && detalle && (
        <Detalle
          sel={sel} cel={detalle} onClose={() => setSel(null)} onFoto={setFoto}
          anulados={anulados.filter(a => a.store_code === sel.store_code && (a.dias_cubiertos || []).includes(sel.fecha))}
          puedeAnular={PUEDE_ANULAR.includes(user?.rol)}
          onAnular={anular}
        />
      )}

      {/* Foto a pantalla completa */}
      {foto && (
        <div onClick={() => setFoto(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <img src={foto} alt="Voucher del depósito" style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', borderRadius: 8 }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <a href={foto} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ color: C.txt, fontSize: 13, textDecoration: 'none', background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 14px' }}>Abrir original ↗</a>
            <button onClick={() => setFoto(null)} style={{ color: C.txt, fontSize: 13, background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Tarjeta({ titulo, valor, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px' }}>
      <div style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: .7 }}>{titulo}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color, fontFamily: 'monospace', margin: '3px 0 1px' }}>{valor}</div>
      <div style={{ fontSize: 10.5, color: C.dim }}>{sub}</div>
    </div>
  )
}

function Detalle({ sel, cel, onClose, onFoto, anulados = [], puedeAnular, onAnular }) {
  const { store_code: sc, fecha } = sel
  const g = cel.grupo
  const multiDia = g && g.dias.length > 1
  const veredicto = !g
    ? (cel.estado === 'falta' ? { txt: 'No hay ningún depósito que cubra este día', color: C.bad }
      : cel.estado === 'plazo' ? { txt: 'Aún en plazo — se deposita la mañana siguiente', color: C.dim }
      : { txt: 'No había efectivo que depositar', color: C.dim })
    : Math.abs(g.dif) < TOL_OK ? { txt: multiDia ? `✓ Cuadra — el depósito de los ${g.dias.length} días está completo` : '✓ Cuadra contra el cierre', color: C.ok }
    // El texto dice EN CUÁNTOS DÍAS, no sólo cuánto: sin eso, una diferencia
    // de un depósito de 6 días se lee como si fuera de este día solo.
    : { txt: (g.dif > 0 ? `Sobran ${fmt$(g.dif)}` : `Faltan ${fmt$(Math.abs(g.dif))}`)
             + (multiDia ? ` en el depósito que cubre estos ${g.dias.length} días — no de este día solo` : ' contra el cierre'),
        color: Math.abs(g.dif) > TOL_WARN ? C.bad : C.warn }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 90, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.txt }}>{STORES[sc] || sc}</div>
            <div style={{ fontSize: 12, color: C.dim }}>{mayusc1(diaLargo(fecha))}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, fontSize: 22, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit' }}>✕</button>
        </div>

        <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${veredicto.color}55`, borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 13.5, fontWeight: 700, color: veredicto.color }}>
          {veredicto.txt}
        </div>

        {/* Según el cierre */}
        <Seccion titulo="Según el cierre de caja">
          {!cel.cierre ? (
            <div style={{ fontSize: 12.5, color: C.dim }}>No hay cierre registrado para este día.</div>
          ) : (
            <>
              <Fila label="Efectivo a depositar" valor={fmt$(cel.esperado)} fuerte />
              {cel.cierre.cierres.map((c, i) => (
                <Fila key={i}
                  label={`· ${c.caja ? c.caja + ' · ' : ''}${c.turno || 'turno'} — ${c.estado || 'sin estado'}`}
                  valor={fmt$(c.efectivo_real_depositar)} tenue />
              ))}
            </>
          )}
        </Seccion>

        {/* Depósitos */}
        <Seccion titulo={g ? `Depósito${g.deps.length > 1 ? 's' : ''} que cubren este día` : 'Depósitos'}>
          {!g ? (
            <div style={{ fontSize: 12.5, color: C.dim }}>Ninguno. Este día de venta no aparece en los días cubiertos de ningún depósito.</div>
          ) : g.deps.map(d => (
            <div key={d.id} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 11, marginBottom: 9, background: 'rgba(255,255,255,.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 17, fontWeight: 800, fontFamily: 'monospace', color: C.txt }}>{fmt$(d.monto)}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: d.estado === 'confirmado' ? 'rgba(34,197,94,.16)' : 'rgba(59,130,246,.16)', color: d.estado === 'confirmado' ? C.ok : C.info }}>
                  {d.estado === 'confirmado' ? '✓ Confirmado' : 'Sin confirmar'}
                </span>
              </div>
              <Fila label="Fecha del depósito" valor={d.fecha_deposito || '—'} tenue />
              {d.fecha_deposito && d.created_at && d.fecha_deposito > d.created_at.slice(0, 10) && (
                <div style={{ fontSize: 11, color: C.warn, margin: '2px 0 4px' }}>
                  ⚠ La fecha del depósito es posterior al día en que se registró ({d.created_at.slice(0, 10)}). Puede estar mal tecleada.
                </div>
              )}
              <Fila label="Días que cubre" valor={(d.dias_cubiertos || []).join(' · ') || '—'} tenue />
              <Fila label="Registró" valor={d.creado_por || '—'} tenue />
              {d.revisado_por && <Fila label="Revisó" valor={d.revisado_por} tenue />}
              {d.notas && <Fila label="Notas" valor={d.notas} tenue />}
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
                {(d.fotos_urls || []).length === 0 ? (
                  <span style={{ fontSize: 11.5, color: C.warn }}>Sin foto del voucher</span>
                ) : d.fotos_urls.map((u, i) => (
                  <img key={i} src={u} alt={`Voucher ${i + 1}`} onClick={() => onFoto(u)} loading="lazy"
                    style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.line}`, cursor: 'zoom-in' }} />
                ))}
              </div>
            </div>
          ))}
        </Seccion>

        {puedeAnular && g && (
          <div style={{ marginTop: -6, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {g.deps.map(d => (
              <button key={d.id} onClick={() => onAnular(d)}
                style={{ background: 'transparent', border: `1px solid ${C.line}`, color: C.dim, borderRadius: 8, padding: '5px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                Anular {fmt$(d.monto)}
              </button>
            ))}
          </div>
        )}

        {anulados.length > 0 && (
          <Seccion titulo={`Anulado${anulados.length > 1 ? 's' : ''} — no suma${anulados.length > 1 ? 'n' : ''}`}>
            {anulados.map(a => (
              <div key={a.id} style={{ border: `1px dashed ${C.line}`, borderRadius: 10, padding: 10, marginBottom: 8, opacity: .72 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', textDecoration: 'line-through', color: C.dim }}>{fmt$(a.monto)}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: C.dim }}>ANULADO</span>
                </div>
                <div style={{ fontSize: 11.5, color: C.dim, marginTop: 4, lineHeight: 1.4 }}>{a.anulado_motivo}</div>
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 3 }}>
                  Lo subió {a.creado_por || '—'} · anulado por {a.anulado_por || '—'}
                  {a.anulado_at ? ` el ${a.anulado_at.slice(0, 10)}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                  {(a.fotos_urls || []).map((u, i) => (
                    <img key={i} src={u} alt={`Voucher anulado ${i + 1}`} onClick={() => onFoto(u)} loading="lazy"
                      style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 7, border: `1px solid ${C.line}`, cursor: 'zoom-in', filter: 'grayscale(.6)' }} />
                  ))}
                </div>
              </div>
            ))}
          </Seccion>
        )}

        {/* Conciliación del grupo */}
        {g && (
          <Seccion titulo={multiDia ? 'Conciliación (el depósito cubre varios días)' : 'Conciliación'}>
            {multiDia && (
              <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 7 }}>
                No se puede saber qué día vino corto: estos {g.dias.length} días se cuadran juntos porque los cubre el mismo depósito.
                <div style={{ marginTop: 4, color: C.txt }}>{g.dias.join(' · ')}</div>
              </div>
            )}
            <Fila label="Esperado según cierres" valor={fmt$(g.esperado)} />
            <Fila label="Depositado" valor={fmt$(g.depositado)} />
            <Fila label="Diferencia" valor={fmt$(g.dif)} fuerte
              color={Math.abs(g.dif) < TOL_OK ? C.ok : Math.abs(g.dif) > TOL_WARN ? C.bad : C.warn} />
          </Seccion>
        )}
      </div>
    </div>
  )
}

function Seccion({ titulo, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 7 }}>{titulo}</div>
      {children}
    </div>
  )
}

function Fila({ label, valor, fuerte, tenue, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: tenue ? 11.5 : 13 }}>
      <span style={{ color: C.dim }}>{label}</span>
      <span style={{ color: color || (tenue ? C.dim : C.txt), fontWeight: fuerte ? 800 : 600, fontFamily: 'monospace', textAlign: 'right', wordBreak: 'break-word' }}>{valor}</span>
    </div>
  )
}
