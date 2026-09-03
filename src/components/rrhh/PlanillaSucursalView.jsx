/* ═══════════════════════════════════════════════════════════════════════
   Mi planilla — vista del encargado de sucursal

   Dos modos, según el mes:

   · MES CERRADO (agosto): la foto de lo que pasó. Solo lectura. Sirve de
     línea base y no se toca — si el gerente pudiera editarla, el histórico
     dejaría de servir para comparar.

   · MES EN CURSO (septiembre en adelante): la herramienta. El gerente
     captura horas y días extra día por día y ve, al instante, en cuánto va
     a terminar el mes.

   Decisiones que valen la pena entender:

   1. LA VENTA SE PROYECTA POR DIA DE SEMANA, no linealmente. Lourdes vende
      el doble el sábado que el martes: dividir lo vendido entre los días
      transcurridos da alto si ya pasó un fin de semana y bajo si no. Se usa
      el patrón de agosto corregido por el ritmo real del mes.

   2. LA BASE ES FIJA Y SE CONOCE DESDE EL DIA 1. Lo único que se mueve son
      los extras, y por eso son lo único que el gerente captura.

   3. SEMAFORO DOBLE. El % solo premia recortar gente. Al lado va siempre las
      horas extra por persona: una sucursal "verde" a base de horas extra es
      una sucursal sin gente, no una eficiente.

   4. CON POCOS DIAS LA PROYECCION MIENTE. Debajo de 7 días transcurridos se
      muestra la advertencia; sin eso, un lunes flojo asusta sin razón.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { db } from '../../supabase'

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
const btnS = { background: '#141416', color: C.txt, border: `1px solid ${C.line}`, borderRadius: 8,
               padding: '7px 11px', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }

// Mes actual en El Salvador, sin depender del reloj del teléfono para el día 1.
function mesActual() {
  const f = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/El_Salvador' }))
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-01`
}
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre']
const nombreMes = (iso) => {
  const [a, m] = iso.split('-'); return `${MESES[Number(m) - 1]} ${a}`
}
const fmtDia = (iso) => {
  const [a, m, d] = iso.split('-')
  return new Date(Number(a), Number(m) - 1, Number(d))
    .toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function PlanillaSucursalView({ user }) {
  const [cargando, setCargando] = useState(true)
  const [error, setError]   = useState('')
  const [d, setD]           = useState(null)
  const [suc, setSuc]       = useState(user?.store_code || 'S003')
  const [mes, setMes]       = useState(mesActual())
  const [dia, setDia]       = useState(null)
  const [vista, setVista]   = useState('resumen')   // 'resumen' | 'dia' | 'equipo'
  const [guardando, setGuardando] = useState(null)
  const [editId, setEditId]   = useState(null)      // fila con el sueldo abierto
  const [editVal, setEditVal] = useState('')
  const [agregando, setAgregando] = useState(false)
  const [nueva, setNueva] = useState({ nombre: '', cargo: '', base: '' })

  const puedeElegir = ROLES_VEN_TODAS.includes(user?.rol)
  const puedeVer    = puedeElegir || ROLES_VEN_SUYA.includes(user?.rol)
  const esCerrado   = mes < mesActual()

  const cargar = useCallback(async (code, m, día) => {
    setCargando(true); setError('')
    try {
      const rpc = (m < mesActual()) ? 'fn_planilla_panel_sucursal' : 'fn_planilla_mes_curso'
      const args = (m < mesActual())
        ? { p_store_code: code, p_mes: m }
        : { p_store_code: code, p_mes: m, p_dia: día || null }
      const { data, error: e } = await db.rpc(rpc, args)
      if (e) throw e
      if (data?.error) throw new Error(data.error)
      setD(data)
      if (!día && data?.dia_visto) setDia(data.dia_visto)
    } catch (e) {
      setError(e.code === '42501' || /permission denied/i.test(e.message || '')
        ? 'No tenés permiso para ver esta información. Avisá a Casa Matriz.'
        : (e.message || 'No se pudo cargar'))
    }
    setCargando(false)
  }, [])

  useEffect(() => { if (puedeVer) cargar(suc, mes, dia) }, [cargar, suc, mes, dia, puedeVer])

  // ── Guardar un extra ──
  // Se manda el TOTAL del día, no un incremento: si dos personas tocan la
  // misma tablet, gana el último valor visible y no se duplica.
  async function setExtra(persona, campos) {
    if (esCerrado) return
    const act = d.del_dia?.[persona.id] || { hd: 0, hn: 0, de: 0 }
    const hd = campos.hd ?? (Number(act.hd) || 0)
    const hn = campos.hn ?? (Number(act.hn) || 0)
    const de = campos.de ?? (Number(act.de) || 0)
    setGuardando(persona.id)
    try {
      const { data, error: e } = await db.rpc('fn_planilla_extra_set', {
        p_persona: persona.id, p_fecha: dia,
        p_hd: hd, p_hn: hn, p_de: de, p_usuario: user?.id || null,
      })
      if (e) throw e
      if (data?.error) throw new Error(data.error)
      await cargar(suc, mes, dia)
    } catch (e) { setError(e.message || 'No se pudo guardar') }
    setGuardando(null)
  }

  // ── Editar la planilla del mes: sueldo base, baja y alta ──
  // El gerente edita el numerador de su propia metrica. Se permite porque los
  // aumentos y las bajas a media quincena son reales y el que se entera primero
  // es el. El control no es prohibirlo sino que quede registrado: cada cambio
  // va a planilla_revision_log con quien y cuando, y la fila queda marcada.
  async function editarPersona(id, campos) {
    if (esCerrado) return
    setGuardando(id)
    try {
      const { data, error: e } = await db.rpc('fn_planilla_equipo_editar', {
        p_store_code: suc, p_id: id,
        p_base: campos.base ?? null, p_sigue: campos.sigue ?? null,
        p_usuario: user?.id || null,
      })
      if (e) throw e
      if (data?.error) throw new Error(data.error)
      setEditId(null)
      await cargar(suc, mes, dia)
    } catch (e) { setError(e.message || 'No se pudo guardar') }
    setGuardando(null)
  }

  async function altaPersona() {
    if (esCerrado) return
    const nombre = (nueva.nombre || '').trim()
    const base = Number(nueva.base)
    if (!nombre) { setError('Falta el nombre'); return }
    if (!(base >= 0)) { setError('Falta el sueldo base'); return }
    setGuardando('nueva')
    try {
      const { data, error: e } = await db.rpc('fn_planilla_equipo_alta', {
        p_store_code: suc, p_mes: mes, p_nombre: nombre,
        p_cargo: (nueva.cargo || '').trim() || null,
        p_base: base, p_usuario: user?.id || null,
      })
      if (e) throw e
      if (data?.error) throw new Error(data.error)
      setNueva({ nombre: '', cargo: '', base: '' })
      setAgregando(false)
      await cargar(suc, mes, dia)
    } catch (e) { setError(e.message || 'No se pudo agregar') }
    setGuardando(null)
  }

  // ── Derivados ──
  const calc = useMemo(() => {
    if (!d) return null
    const meta = Number(d.meta_pct ?? 12)
    if (esCerrado) {
      return { meta, pct: d.pct == null ? null : Number(d.pct),
               planilla: Number(d.planilla), venta: Number(d.venta) }
    }
    const pl = Number(d.planilla_proyectada) || 0
    const ve = Number(d.venta_proyectada) || 0
    const plHoy = Number(d.base_mensual) + Number(d.extra_hasta_hoy)
    return {
      meta, pct: ve > 0 ? (100 * pl / ve) : null,
      planilla: pl, venta: ve, plHoy,
      pctHoy: Number(d.venta_real) > 0 ? (100 * Number(d.extra_hasta_hoy) + 0) : null,
      pocosDias: Number(d.dias_pasados) < 7,
      avance: Math.round(100 * Number(d.dias_pasados) / Number(d.dias_mes)),
    }
  }, [d, esCerrado])

  if (!puedeVer) {
    return <div style={{ padding: 20, color: C.dim, background: C.bg, minHeight: '100vh' }}>
      Esta pantalla es para encargados de sucursal.
    </div>
  }
  if (cargando && !d) return <div style={{ padding: 20, color: C.dim }}>Cargando…</div>

  const enMeta = calc?.pct != null && calc.pct <= calc.meta
  const equipo = (d?.equipo || []).filter(e => e.sigue)
  const hexTot = equipo.reduce((s, e) => s + (Number(e.horas_diurnas) || 0) + (Number(e.horas_nocturnas) || 0), 0)
  const hexPP  = equipo.length ? hexTot / equipo.length : 0

  return (
    <div style={{ padding: 14, background: C.bg, color: C.txt, minHeight: '100vh' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>💵 Mi planilla</h2>
          {puedeElegir ? (
            <select value={suc} onChange={e => { setSuc(e.target.value); setDia(null) }} style={btnS}>
              {SUCURSALES.map(s => <option key={s.code} value={s.code}>{s.nombre}</option>)}
            </select>
          ) : <span style={{ fontSize: 13, color: C.dim }}>{d?.sucursal}</span>}
        </div>

        <div style={{ display: 'flex', gap: 7, alignItems: 'center', margin: '10px 0 16px', flexWrap: 'wrap' }}>
          {['2026-08-01', '2026-09-01'].map(m => (
            <button key={m} onClick={() => { setMes(m); setDia(null); setVista('resumen') }}
              style={{ ...btnS, background: m === mes ? '#1e3a5f' : '#141416',
                       borderColor: m === mes ? C.acc : C.line, textTransform: 'capitalize' }}>
              {nombreMes(m)}{m < mesActual() ? ' · cerrado' : ' · en curso'}
            </button>
          ))}
        </div>

        {error && <div style={{ ...card, background: '#3a1414', border: `1px solid ${C.bad}`, color: '#fca5a5' }}>{error}</div>}

        {d && !error && <>
          {/* ── El número ── */}
          <div style={{ ...card, marginBottom: 0, borderRadius: '12px 12px 0 0',
                        background: enMeta ? '#14331f' : '#3a1414',
                        border: `1px solid ${enMeta ? C.ok : C.bad}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11.5, letterSpacing: .5, textTransform: 'uppercase',
                              color: enMeta ? '#86efac' : '#fca5a5' }}>
                  {esCerrado ? 'Planilla sobre venta' : 'Proyección de cierre'}
                </div>
                <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.12, color: enMeta ? C.ok : C.bad }}>
                  {calc?.pct == null ? '—' : calc.pct.toFixed(1) + '%'}
                </div>
                <div style={{ fontSize: 12.5, color: enMeta ? '#86efac' : '#fca5a5' }}>la meta es {calc?.meta}%</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11.5, color: enMeta ? '#86efac' : '#fca5a5' }}>
                  {enMeta ? 'te sobrarían' : 'te pasarías por'}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: enMeta ? C.ok : C.bad }}>
                  {money(Math.abs((calc?.planilla || 0) - (calc?.venta || 0) * (calc?.meta || 12) / 100))}
                </div>
              </div>
            </div>
          </div>

          {/* Puesto entre las seis, sin exponer a las otras.
              En mes en curso solo aparece del día 10 en adelante (lo decide la
              función): antes, la proyección de venta todavía depende de si ya
              cayó un fin de semana, y el puesto se movería por ruido. */}
          {d.puesto && (
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderTop: 'none',
                          borderRadius: '0 0 12px 12px', padding: '10px 15px', marginBottom: 12,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: enMeta ? C.ok : C.bad }}>
                  {esCerrado ? 'Vas' : 'Vas cerrando'} {d.puesto}ª de {d.total_sucursales}
                </div>
                <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
                  No ves los números de las otras, solo tu lugar
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                {Array.from({ length: d.total_sucursales }, (_, i) => (
                  <span key={i} style={{ width: 26, height: 8, borderRadius: 5,
                    background: i + 1 === d.puesto ? (enMeta ? C.ok : C.bad) : '#2f2f34' }} />
                ))}
              </div>
            </div>
          )}

          {/* Antes del día 10 se dice por qué no está, para que no parezca una falla */}
          {!esCerrado && !d.puesto && d.puesto_desde_dia && (
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderTop: 'none',
                          borderRadius: '0 0 12px 12px', padding: '9px 15px', marginBottom: 12,
                          fontSize: 11.5, color: C.dim }}>
              Tu puesto entre las sucursales aparece a partir del día {d.puesto_desde_dia},
              cuando la proyección ya tiene dos fines de semana adentro.
            </div>
          )}

          {/* Aviso de proyección temprana */}
          {!esCerrado && calc?.pocosDias && (
            <div style={{ ...card, marginTop: 12, background: '#1e3a5f', border: `1px solid ${C.acc}`,
                          color: '#bfdbfe', fontSize: 12.5, lineHeight: 1.55 }}>
              Van {d.dias_pasados} de {d.dias_mes} días. Con tan poco todavía, la proyección se mueve
              mucho de un día para otro — miralá como referencia, no como sentencia.
            </div>
          )}

          {/* ── Avance del mes ── */}
          {!esCerrado && (
            <div style={{ ...card, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 7 }}>
                <span style={{ color: C.dim }}>Día {d.dias_pasados} de {d.dias_mes}</span>
                <span style={{ color: C.dim }}>{calc.avance}% del mes</span>
              </div>
              <div style={{ height: 7, background: '#2a2a2e', borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ width: `${calc.avance}%`, height: '100%', background: C.acc }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>
                <div style={mini}>
                  <div style={{ fontSize: 11, color: C.dim }}>Vendido</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{money(d.venta_real)}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>proyecta {money(d.venta_proyectada)}</div>
                </div>
                <div style={mini}>
                  <div style={{ fontSize: 11, color: C.dim }}>Planilla base</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{money(d.base_mensual)}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>fija, ya está comprometida</div>
                </div>
                <div style={mini}>
                  <div style={{ fontSize: 11, color: C.dim }}>Extras del mes</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: Number(d.extra_hasta_hoy) > 0 ? C.warn : C.txt }}>
                    {money(d.extra_hasta_hoy)}
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                    {d.horas_hasta_hoy}h · {d.dias_extra_hasta_hoy} días
                  </div>
                </div>
                <div style={mini}>
                  <div style={{ fontSize: 11, color: C.dim }}>Ritmo de venta</div>
                  <div style={{ fontSize: 16, fontWeight: 600,
                                color: Number(d.factor_ritmo) >= 1 ? C.ok : C.bad }}>
                    {d.factor_ritmo == null ? '—' : Math.round((Number(d.factor_ritmo) - 1) * 100) + '%'}
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>contra agosto</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Carga del equipo ── */}
          {(() => {
            const promCadena = Number(d.cadena?.hex_por_persona ?? 11.1)
            const mio = esCerrado ? Number(d.hex_por_persona || 0) : hexPP
            const alto = promCadena > 0 && mio > promCadena * 2
            return (
              <div style={{ ...card, background: alto ? '#3a2f0f' : C.card,
                            border: `1px solid ${alto ? C.warn : C.line}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: alto ? '#fcd34d' : C.txt }}>
                      {alto ? '⚠️ Estás cargando mucho al equipo' : 'Carga del equipo'}
                    </div>
                    <div style={{ fontSize: 12, color: alto ? '#fcd34d' : C.dim, marginTop: 3, lineHeight: 1.5 }}>
                      {mio.toFixed(1)} horas extra por persona
                      {esCerrado && ` · la cadena promedia ${promCadena}`}
                      {alto && '. Un buen porcentaje a base de horas extra no es eficiencia, es falta de gente.'}
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: alto ? C.warn : C.dim, whiteSpace: 'nowrap' }}>
                    {mio.toFixed(1)}h
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ── Captura diaria ── */}
          {!esCerrado && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Horas y días extra</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button style={btnS} onClick={() => {
                    const f = new Date(dia + 'T12:00'); f.setDate(f.getDate() - 1)
                    setDia(f.toISOString().slice(0, 10))
                  }}>‹</button>
                  <input type="date" value={dia || ''} max={d.hoy}
                         onChange={e => setDia(e.target.value)} style={{ ...btnS, padding: '7px 9px' }} />
                  <button style={{ ...btnS, opacity: dia >= d.hoy ? .4 : 1 }} disabled={dia >= d.hoy}
                    onClick={() => {
                      const f = new Date(dia + 'T12:00'); f.setDate(f.getDate() + 1)
                      setDia(f.toISOString().slice(0, 10))
                    }}>›</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 11, textTransform: 'capitalize' }}>
                {dia && fmtDia(dia)} · tocá a quien hizo extra ese día
              </div>

              {equipo.map(p => {
                const hoy = d.del_dia?.[p.id] || { hd: 0, hn: 0, de: 0 }
                const hd = Number(hoy.hd) || 0, hn = Number(hoy.hn) || 0, de = Number(hoy.de) || 0
                const tiene = hd > 0 || hn > 0 || de > 0
                const costoDia = hd * Number(d.tarifas.diurna) + hn * Number(d.tarifas.nocturna)
                                 + de * (Number(p.base_mensual) / Number(d.tarifas.divisor_dia))
                return (
                  <div key={p.id} style={{
                    background: tiene ? '#1e3a5f' : '#101012',
                    border: `1px solid ${tiene ? C.acc : C.line}`,
                    borderRadius: 9, padding: '9px 11px', marginBottom: 7,
                    opacity: guardando === p.id ? .5 : 1,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.nombre}</div>
                        <div style={{ fontSize: 11.5, color: C.dim }}>
                          {p.cargo}{p.origen === 'Motorista' ? ' · motorista' : ''}
                        </div>
                      </div>
                      {tiene && (
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.warn }}>{money(costoDia)}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>
                            {hd > 0 && `${hd}h`}{hn > 0 && ` ${hn}h noc`}{de > 0 && ` ${de} día`}
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button style={{ ...btnS, padding: '6px 10px', fontSize: 13 }}
                        onClick={() => setExtra(p, { hd: hd + 1 })}>+1 h</button>
                      <button style={{ ...btnS, padding: '6px 10px', fontSize: 13,
                                       borderColor: de > 0 ? C.acc : C.line }}
                        onClick={() => setExtra(p, { de: de > 0 ? 0 : 1 })}>
                        {de > 0 ? '✓ día extra' : '+ día extra'}
                      </button>
                      {tiene && (
                        <button style={{ ...btnS, padding: '6px 10px', fontSize: 13, color: C.bad }}
                          onClick={() => setExtra(p, { hd: 0, hn: 0, de: 0 })}>Borrar</button>
                      )}
                    </div>

                    {/* Detalle por fecha. Sirve para el analisis posterior: en que
                        dias se concentran las horas extra de esta persona. */}
                    {(d.detalle?.[p.id] || []).length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
                        <div style={{ fontSize: 10.5, letterSpacing: .5, textTransform: 'uppercase',
                                      color: C.dim, marginBottom: 5 }}>En qué días fue</div>
                        {(d.detalle[p.id] || []).map((x, k) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between',
                                                alignItems: 'center', gap: 8, fontSize: 12,
                                                padding: '4px 0', color: C.dim }}>
                            <span style={{ textTransform: 'capitalize' }}>{fmtDia(x.fecha)}</span>
                            <span>
                              {Number(x.hd) > 0 && `${Number(x.hd)}h `}
                              {Number(x.de) > 0 && `${Number(x.de)} día`}
                            </span>
                            <b style={{ color: C.warn, minWidth: 54, textAlign: 'right' }}>{money(x.costo)}</b>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Acumulado del mes por persona ── */}
          <button onClick={() => setVista(v => v === 'equipo' ? 'resumen' : 'equipo')}
            style={{ width: '100%', ...card, marginBottom: 8, cursor: 'pointer', textAlign: 'left',
                     display: 'flex', justifyContent: 'space-between', color: C.txt, fontSize: 14 }}>
            <span>Planilla del mes · {equipo.length} personas</span>
            <span style={{ color: C.dim }}>{vista === 'equipo' ? '▲' : '▼'}</span>
          </button>

          {vista === 'equipo' && (
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '9px 12px' }}>Nombre</th>
                    <th style={{ textAlign: 'right', padding: '9px 6px' }}>Sueldo base</th>
                    <th style={{ textAlign: 'right', padding: '9px 6px' }}>H.ex</th>
                    {!esCerrado && <th style={{ textAlign: 'right', padding: '9px 6px' }}>Días</th>}
                    <th style={{ textAlign: 'right', padding: '9px 12px' }}>
                      {esCerrado ? 'Devengado' : 'Extras'}
                    </th>
                    {!esCerrado && <th style={{ width: 44, padding: '9px 10px' }}>Sigue</th>}
                  </tr>
                </thead>
                <tbody>
                  {(d.equipo || []).map((e, i) => (
                    <tr key={e.id || i} style={{ borderTop: '1px solid #212125', opacity: e.sigue ? 1 : .45 }}>
                      <td style={{ padding: '8px 12px' }}>
                        {e.nombre}
                        {e.es_alta && <span style={{ fontSize: 9, background: '#1e1b4b', color: '#c7d2fe',
                          padding: '1px 6px', borderRadius: 20, marginLeft: 5 }}>agregado</span>}
                        {!e.es_alta && e.editado && <span style={{ fontSize: 9, background: '#3a2f0f',
                          color: '#fcd34d', padding: '1px 6px', borderRadius: 20, marginLeft: 5 }}>editado</span>}
                        <div style={{ fontSize: 11, color: C.dim }}>{e.cargo}</div>
                      </td>
                      {/* Sueldo base: se toca y se edita. No es la planilla final —
                          es la estimacion con la que el gerente proyecta su mes. */}
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {editId === e.id ? (
                          <span style={{ display: 'inline-flex', gap: 4 }}>
                            <input type="number" inputMode="decimal" autoFocus value={editVal}
                              onChange={ev => setEditVal(ev.target.value)}
                              onKeyDown={ev => {
                                if (ev.key === 'Enter') editarPersona(e.id, { base: Number(editVal) })
                                if (ev.key === 'Escape') setEditId(null)
                              }}
                              style={{ width: 74, background: '#0b0b0c', color: C.txt, textAlign: 'right',
                                       border: `1px solid ${C.acc}`, borderRadius: 6, padding: '5px 7px',
                                       fontSize: 13, fontFamily: 'inherit' }} />
                            <button onClick={() => editarPersona(e.id, { base: Number(editVal) })}
                              disabled={guardando === e.id}
                              style={{ ...btnS, padding: '5px 8px', fontSize: 12, borderColor: C.ok }}>✓</button>
                          </span>
                        ) : esCerrado ? (
                          <span style={{ color: C.dim }}>{money(e.base_mensual ?? e.salario_base)}</span>
                        ) : (
                          <button onClick={() => { setEditId(e.id); setEditVal(String(e.base_mensual ?? 0)) }}
                            style={{ ...btnS, padding: '5px 8px', fontSize: 13, color: C.txt,
                                     fontVariantNumeric: 'tabular-nums' }}>
                            {money(e.base_mensual ?? e.salario_base)}
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right',
                                   color: Number(e.horas_extra ?? (Number(e.horas_diurnas) + Number(e.horas_nocturnas))) > 40 ? C.warn : C.dim }}>
                        {esCerrado ? e.horas_extra
                          : ((Number(e.horas_diurnas) || 0) + (Number(e.horas_nocturnas) || 0)).toFixed(0)}
                      </td>
                      {!esCerrado && (
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: C.dim }}>
                          {(Number(e.dias_extra) || 0) || '—'}
                        </td>
                      )}
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {money(esCerrado ? e.devengado : e.costo_extra)}
                      </td>
                      {!esCerrado && (
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <button onClick={() => editarPersona(e.id, { sigue: !e.sigue })}
                            disabled={guardando === e.id}
                            title={e.sigue ? 'Sacar de la planilla del mes' : 'Volver a incluir'}
                            style={{ width: 34, height: 20, borderRadius: 20, cursor: 'pointer',
                                     border: 'none', padding: 0, position: 'relative',
                                     background: e.sigue ? C.ok : '#4b5563' }}>
                            <span style={{ position: 'absolute', width: 14, height: 14, borderRadius: '50%',
                                           background: '#fff', top: 3, left: e.sigue ? 17 : 3,
                                           transition: 'left .12s' }} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {/* Total: la suma de la columna Base tiene que cuadrar con la
                      "Planilla base" de arriba, si no el gerente desconfia del panel. */}
                  <tr style={{ borderTop: '2px solid #2a2a2e', background: '#101012', fontWeight: 600 }}>
                    <td style={{ padding: '10px 12px' }}>TOTAL</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right' }}>
                      {money((d.equipo || []).reduce((s, e) =>
                        s + (e.sigue === false ? 0 : Number(e.base_mensual ?? e.salario_base) || 0), 0))}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right' }}>
                      {(d.equipo || []).reduce((s, e) => s + (esCerrado
                        ? (Number(e.horas_extra) || 0)
                        : (Number(e.horas_diurnas) || 0) + (Number(e.horas_nocturnas) || 0)), 0).toFixed(0)}
                    </td>
                    {!esCerrado && (
                      <td style={{ padding: '10px 6px', textAlign: 'right' }}>
                        {(d.equipo || []).reduce((s, e) => s + (Number(e.dias_extra) || 0), 0) || '—'}
                      </td>
                    )}
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: C.warn,
                                 fontVariantNumeric: 'tabular-nums' }}>
                      {money((d.equipo || []).reduce((s, e) =>
                        s + (Number(esCerrado ? e.devengado : e.costo_extra) || 0), 0))}
                    </td>
                    {!esCerrado && <td />}
                  </tr>
                </tbody>
              </table>

              {!esCerrado && (
                <div style={{ borderTop: `1px solid ${C.line}`, padding: 11 }}>
                  {!agregando ? (
                    <button onClick={() => setAgregando(true)}
                      style={{ ...btnS, width: '100%', padding: '9px', color: C.acc,
                               borderColor: C.acc, borderStyle: 'dashed' }}>
                      + Agregar a alguien
                    </button>
                  ) : (
                    <div style={{ display: 'grid', gap: 7 }}>
                      <input placeholder="Nombre y apellido" value={nueva.nombre} autoFocus
                        onChange={e => setNueva(n => ({ ...n, nombre: e.target.value }))}
                        style={{ background: '#0b0b0c', color: C.txt, border: `1px solid ${C.line}`,
                                 borderRadius: 8, padding: '9px 11px', fontSize: 14, fontFamily: 'inherit' }} />
                      <div style={{ display: 'flex', gap: 7 }}>
                        <input placeholder="Cargo" value={nueva.cargo}
                          onChange={e => setNueva(n => ({ ...n, cargo: e.target.value }))}
                          style={{ flex: 1, background: '#0b0b0c', color: C.txt, border: `1px solid ${C.line}`,
                                   borderRadius: 8, padding: '9px 11px', fontSize: 14, fontFamily: 'inherit' }} />
                        <input placeholder="Sueldo base" type="number" inputMode="decimal" value={nueva.base}
                          onChange={e => setNueva(n => ({ ...n, base: e.target.value }))}
                          style={{ width: 120, background: '#0b0b0c', color: C.txt, border: `1px solid ${C.line}`,
                                   borderRadius: 8, padding: '9px 11px', fontSize: 14, fontFamily: 'inherit',
                                   textAlign: 'right' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 7 }}>
                        <button onClick={altaPersona} disabled={guardando === 'nueva'}
                          style={{ ...btnS, flex: 1, padding: '9px', borderColor: C.ok, color: C.ok }}>
                          {guardando === 'nueva' ? 'Guardando…' : 'Agregar'}
                        </button>
                        <button onClick={() => { setAgregando(false); setNueva({ nombre: '', cargo: '', base: '' }) }}
                          style={{ ...btnS, padding: '9px 14px', color: C.dim }}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: '#6b6a72', marginTop: 14, lineHeight: 1.6 }}>
            {esCerrado
              ? 'Mes cerrado: el monto de cada persona es lo devengado, antes de ISSS, AFP y renta. No se edita.'
              : <>Los extras cuentan solo los días que se registraron, no se proyectan al resto del mes.
                 La planilla de Casa Matriz no se incluye.
                 <br />Tocá el sueldo para corregirlo y el switch para sacar o volver a incluir a alguien.
                 Es tu estimación del mes, no la planilla oficial: cuando entre la de la quincena, manda esa.
                 {Number(d.ediciones) > 0 &&
                   <> Llevás {d.ediciones} {Number(d.ediciones) === 1 ? 'cambio' : 'cambios'} este mes.</>}</>}
          </div>
        </>}
      </div>
    </div>
  )
}
