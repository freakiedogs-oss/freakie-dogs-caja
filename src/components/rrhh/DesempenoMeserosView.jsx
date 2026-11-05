/* ═══════════════════════════════════════════════════════════════════════
   Desempeño de meseros — extras por persona, ticket y meta

   Pedido de Jazz (M001). Plan: docs/planes/PLAN_desempeno_meseros_y_domicilios.md
   Extra = modificadores cobrados + líneas de las categorías marcadas
   (Extras, Fries & Sides, Cervezas, Bebidas sueltas). La bebida dentro de un
   combo no es línea propia y no cuenta.

   Dueño de la cuenta = mesero asignado; si no hay, quien cobró.
   La comparación es por día trabajado y por cuenta (no por total), para no
   medir horario en vez de esfuerzo.

   Todo el cálculo vive en fn_extras_mesero(); acá se agrega y se pinta.
   Fase "medir": todavía no toca propinas.
   ═══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', okBg: '#0e2a17', warn: '#fbbf24', warnBg: '#2a2210', bad: '#f87171', badBg: '#2a1414', acc: '#60a5fa',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 12 }
const btn = (on) => ({ padding: '7px 12px', borderRadius: 8, border: `1px solid ${on ? C.acc : C.line}`, background: on ? '#13233a' : 'transparent', color: on ? C.acc : C.txt, cursor: 'pointer', fontSize: 13, fontWeight: 600 })
const inp = { background: '#121214', border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 13, width: 90 }
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n) => n == null ? '—' : `${Math.round(n)}%`

const SUPERVISAN = ['admin', 'ejecutivo', 'superadmin']
const PUEDEN_CONFIGURAR = ['admin', 'ejecutivo', 'superadmin', 'gerente']
const SUCURSALES = [['M001', 'Cafetalón'], ['S003', 'Lourdes'], ['S004', 'Venecia']]

function hoySV() {
  // El Salvador = UTC-6 sin DST
  return new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10)
}
function rango(periodo) {
  const hoy = hoySV()
  const [y, m] = hoy.split('-').map(Number)
  if (periodo === 'mes') return [`${hoy.slice(0, 7)}-01`, hoy]
  if (periodo === 'anterior') {
    const ini = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
    const fin = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
    return [ini, fin]
  }
  const ini = new Date(Date.parse(hoy) - 29 * 864e5).toISOString().slice(0, 10)
  return [ini, hoy]
}
const finDeSemana = (iso) => { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 5 || d === 6 || d === 0 }

// Meta de equipo vigente para un día, desde la config.
function metaEquipoDia(metas, tipo, dia) {
  const m = metas.filter(x => x.tipo === tipo && x.ambito === 'equipo' && !x.usuario_id && x.vigente_desde <= dia)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1))[0]
  if (!m) return null
  return Number(finDeSemana(dia) ? m.meta_vd : m.meta_lj)
}

export default function DesempenoMeserosView({ user }) {
  const rol = user?.rol || ''
  const supervisa = SUPERVISAN.includes(rol)
  const [store, setStore] = useState(supervisa ? 'M001' : (user?.store_code || 'M001'))
  const [periodo, setPeriodo] = useState('mes')
  const [tab, setTab] = useState('ranking')
  const [filas, setFilas] = useState([])
  const [config, setConfig] = useState({ programas: [], metas: [], tramos: [] })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState(null)

  const [desde, hasta] = rango(periodo)

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try {
      const [r1, r2] = await Promise.all([
        db.rpc('fn_extras_mesero', { p_usuario_id: user.id, p_store: store, p_desde: desde, p_hasta: hasta }),
        db.rpc('fn_incentivo_config', { p_usuario_id: user.id, p_store: store }),
      ])
      if (r1.error) throw r1.error
      if (r2.error) throw r2.error
      setFilas(r1.data || [])
      setConfig(r2.data || { programas: [], metas: [], tramos: [] })
    } catch (e) {
      setError(e.message || String(e))
    } finally { setCargando(false) }
  }, [user.id, store, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  // ── Agregado por persona ──
  const personas = useMemo(() => {
    const map = {}
    for (const f of filas) {
      const k = f.usuario_id
      if (!map[k]) map[k] = { id: k, nombre: f.nombre || 'Sin nombre', rol: f.rol, dias: [], cuentas: 0, mesas: 0, pax: 0, venta: 0, ventaMesa: 0, extras: 0, conExtra: 0, meta: 0, diasConMeta: 0 }
      const p = map[k]
      p.dias.push(f)
      p.cuentas += Number(f.cuentas); p.mesas += Number(f.cuentas_mesa); p.pax += Number(f.pax)
      p.venta += Number(f.venta); p.ventaMesa += Number(f.venta_mesa); p.extras += Number(f.extras); p.conExtra += Number(f.cuentas_con_extra)
      if (f.meta_dia != null) { p.meta += Number(f.meta_dia); p.diasConMeta++ }
    }
    return Object.values(map)
      .filter(p => p.cuentas >= 5)
      .map(p => ({
        ...p,
        nDias: p.dias.length,
        extrasDia: p.extras / p.dias.length,
        extrasCuenta: p.extras / p.cuentas,
        ticket: p.venta / p.cuentas,
        ticketPax: p.pax > 0 ? p.ventaMesa / p.pax : null,  // solo mesas: para llevar no registra personas
        pctConExtra: (p.conExtra / p.cuentas) * 100,
        cumplimiento: p.diasConMeta > 0 && p.meta > 0 ? (p.extras / p.meta) * 100 : null,
      }))
      .sort((a, b) => b.extrasDia - a.extrasDia)
  }, [filas])

  // ── Equipo (cocina se mide contra esto) ──
  const equipo = useMemo(() => {
    const porDia = {}
    for (const f of filas) porDia[f.dia] = (porDia[f.dia] || 0) + Number(f.extras)
    const dias = Object.keys(porDia).sort()
    let meta = 0, conMeta = 0
    for (const d of dias) { const m = metaEquipoDia(config.metas, 'extras', d); if (m != null) { meta += m; conMeta++ } }
    const total = Object.values(porDia).reduce((s, v) => s + v, 0)
    return { total, dias: dias.length, meta: conMeta ? meta : null, cumplimiento: conMeta && meta > 0 ? (total / meta) * 100 : null }
  }, [filas, config.metas])

  // Mesas cobradas por alguien que no es mesero (sin mesero asignado)
  const mesasSinMesero = useMemo(() =>
    filas.filter(f => !['mesero', 'mesera'].includes(f.rol)).reduce((s, f) => s + Number(f.cuentas_mesa), 0)
  , [filas])
  const mesasTotal = useMemo(() => filas.reduce((s, f) => s + Number(f.cuentas_mesa), 0), [filas])

  const tienePrograma = config.programas.some(p => p.tipo === 'extras')

  return (
    <div style={{ background: C.bg, color: C.txt, minHeight: '100%', padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Desempeño de meseros</h2>
      <p style={{ margin: '0 0 14px', color: C.dim, fontSize: 13 }}>
        Extras por persona: ingredientes cobrados aparte y lo que se pide fuera del combo (bebidas, papas, cervezas, extras). Fase de medición: todavía no afecta la propina.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {supervisa && SUCURSALES.map(([sc, n]) => <button key={sc} style={btn(store === sc)} onClick={() => setStore(sc)}>{n}</button>)}
        <span style={{ width: 8 }} />
        {[['mes', 'Este mes'], ['anterior', 'Mes anterior'], ['30', 'Últimos 30 días']].map(([k, l]) =>
          <button key={k} style={btn(periodo === k)} onClick={() => setPeriodo(k)}>{l}</button>)}
        <span style={{ width: 8 }} />
        <button style={btn(tab === 'ranking')} onClick={() => setTab('ranking')}>Ranking</button>
        {PUEDEN_CONFIGURAR.includes(rol) && <button style={btn(tab === 'config')} onClick={() => setTab('config')}>Metas y reglas</button>}
      </div>

      {error && <div style={{ ...card, borderColor: C.bad, color: C.bad }}>{error}</div>}
      {!error && !cargando && !tienePrograma && (
        <div style={{ ...card, color: C.dim }}>Esta sucursal todavía no tiene el programa de extras encendido. Pedíselo a José.</div>
      )}

      {tab === 'ranking' && !error && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Kpi titulo="Extras de la sucursal" valor={money(equipo.total)} sub={`${equipo.dias} días · ${desde} a ${hasta}`} />
            <Kpi titulo="Meta del equipo (cocina)" valor={equipo.meta == null ? 'Sin meta' : pct(equipo.cumplimiento)}
              sub={equipo.meta == null ? 'Se carga en «Metas y reglas»' : `${money(equipo.total)} de ${money(equipo.meta)}`}
              estado={equipo.cumplimiento == null ? null : equipo.cumplimiento >= 100 ? 'ok' : 'bad'} />
            <Kpi titulo="Mesas sin mesero asignado" valor={mesasTotal ? pct(mesasSinMesero / mesasTotal * 100) : '—'}
              sub={`${mesasSinMesero} de ${mesasTotal} mesas`} estado={mesasTotal && mesasSinMesero / mesasTotal > 0.05 ? 'warn' : 'ok'} />
          </div>

          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ color: C.dim, textAlign: 'right' }}>
                  {['Persona', 'Días', 'Cuentas', 'Ticket', 'Ticket/persona', 'Extras', 'Extras/día', 'Extras/cuenta', '% cuentas con extra', 'Meta', 'Cumplimiento'].map((h, i) =>
                    <th key={h} style={{ padding: '10px 12px', borderBottom: `1px solid ${C.line}`, textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {cargando && <tr><td colSpan={11} style={{ padding: 16, color: C.dim }}>Cargando…</td></tr>}
                {!cargando && personas.length === 0 && <tr><td colSpan={11} style={{ padding: 16, color: C.dim }}>Sin ventas en este período.</td></tr>}
                {!cargando && personas.map(p => (
                  <FilaPersona key={p.id} p={p} abierto={abierto === p.id} onToggle={() => setAbierto(abierto === p.id ? null : p.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: C.dim, fontSize: 12 }}>
            Tocá una persona para ver su detalle por día. «Cumplimiento» = extras ÷ (meta del día × días trabajados). Lunes a jueves y viernes a domingo tienen meta distinta.
            Las cajeras aparecen con las mesas y los «para llevar» que cobraron.
          </p>
        </>
      )}

      {tab === 'config' && !error && (
        <ConfigMetas user={user} store={store} config={config} personas={personas} onGuardado={cargar} />
      )}
    </div>
  )
}

function Kpi({ titulo, valor, sub, estado }) {
  const col = estado === 'ok' ? C.ok : estado === 'bad' ? C.bad : estado === 'warn' ? C.warn : C.txt
  return (
    <div style={{ ...card, marginBottom: 0 }}>
      <div style={{ color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{titulo}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: col, margin: '4px 0' }}>{valor}</div>
      <div style={{ color: C.dim, fontSize: 12 }}>{sub}</div>
    </div>
  )
}

function Barra({ v }) {
  if (v == null) return <span style={{ color: C.dim }}>Sin meta</span>
  const col = v >= 100 ? C.ok : v >= 80 ? C.warn : C.bad
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 60, height: 6, background: C.line, borderRadius: 3, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, v)}%`, background: col }} />
      </span>
      <b style={{ color: col }}>{pct(v)}</b>
    </span>
  )
}

function FilaPersona({ p, abierto, onToggle }) {
  const td = { padding: '9px 12px', borderBottom: `1px solid ${C.line}`, textAlign: 'right', whiteSpace: 'nowrap' }
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: abierto ? '#151518' : 'transparent' }}>
        <td style={{ ...td, textAlign: 'left' }}>
          <b>{p.nombre}</b> <span style={{ color: C.dim, fontSize: 11 }}>{p.rol}</span>
        </td>
        <td style={td}>{p.nDias}</td>
        <td style={td}>{p.cuentas}</td>
        <td style={td}>{money(p.ticket)}</td>
        <td style={td}>{p.ticketPax == null ? '—' : money(p.ticketPax)}</td>
        <td style={td}>{money(p.extras)}</td>
        <td style={{ ...td, fontWeight: 700 }}>{money(p.extrasDia)}</td>
        <td style={td}>{money(p.extrasCuenta)}</td>
        <td style={td}>{pct(p.pctConExtra)}</td>
        <td style={td}>{p.diasConMeta ? money(p.meta) : '—'}</td>
        <td style={td}><Barra v={p.cumplimiento} /></td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={11} style={{ padding: '6px 12px 14px', borderBottom: `1px solid ${C.line}`, background: '#151518' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {p.dias.map(d => {
                const ok = d.meta_dia == null ? null : Number(d.extras) >= Number(d.meta_dia)
                return (
                  <div key={d.dia} style={{ border: `1px solid ${ok == null ? C.line : ok ? C.ok : C.bad}`, borderRadius: 8, padding: '6px 9px', fontSize: 12, minWidth: 92 }}>
                    <div style={{ color: C.dim }}>{d.dia.slice(5)} {finDeSemana(d.dia) ? '· V–D' : ''}</div>
                    <div><b>{money(d.extras)}</b>{d.meta_dia != null && <span style={{ color: C.dim }}> / {money(d.meta_dia)}</span>}</div>
                    <div style={{ color: C.dim }}>{d.cuentas} cuentas</div>
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ConfigMetas({ user, store, config, personas, onGuardado }) {
  const prog = config.programas.find(p => p.tipo === 'extras')
  const [cats, setCats] = useState([])
  const [sel, setSel] = useState(prog?.categorias_extra || [])
  const [mods, setMods] = useState(prog?.cuenta_modificadores ?? true)
  const [msg, setMsg] = useState('')
  const vigente = (tipo, ambito, uid = null) => config.metas.find(m => m.tipo === tipo && m.ambito === ambito && (m.usuario_id || null) === uid)
  const [f, setF] = useState(() => {
    const pp = vigente('extras', 'persona'), eq = vigente('extras', 'equipo'), dom = vigente('domicilios', 'equipo')
    return {
      pLj: pp?.meta_lj ?? '', pVd: pp?.meta_vd ?? '', eLj: eq?.meta_lj ?? '', eVd: eq?.meta_vd ?? '',
      dLj: dom?.meta_lj ?? '', dVd: dom?.meta_vd ?? '', desde: hoySV(),
    }
  })
  const [indiv, setIndiv] = useState({ uid: '', lj: '', vd: '' })

  useEffect(() => {
    db.from('pos_menu_categorias').select('nombre').eq('activo', true).then(({ data }) => {
      setCats([...new Set((data || []).map(r => r.nombre))].sort())
    })
  }, [])

  async function guardarMeta(tipo, ambito, target, lj, vd) {
    if (lj === '' || vd === '') return
    const { error } = await db.rpc('fn_incentivo_meta_guardar', {
      p_usuario_id: user.id, p_store: store, p_tipo: tipo, p_ambito: ambito, p_target: target,
      p_meta_lj: Number(lj), p_meta_vd: Number(vd), p_vigente_desde: f.desde,
    })
    if (error) throw error
  }

  async function guardarTodo() {
    setMsg('Guardando…')
    try {
      await guardarMeta('extras', 'persona', null, f.pLj, f.pVd)
      await guardarMeta('extras', 'equipo', null, f.eLj, f.eVd)
      await guardarMeta('domicilios', 'equipo', null, f.dLj, f.dVd)
      const { error } = await db.rpc('fn_incentivo_reglas_guardar', { p_usuario_id: user.id, p_store: store, p_categorias: sel, p_modificadores: mods })
      if (error) throw error
      setMsg('Guardado. Las metas valen desde ' + f.desde + '.')
      onGuardado()
    } catch (e) { setMsg('No se pudo guardar: ' + (e.message || e)) }
  }

  async function guardarIndividual() {
    if (!indiv.uid) return
    setMsg('Guardando…')
    try {
      await guardarMeta('extras', 'persona', indiv.uid, indiv.lj, indiv.vd)
      setMsg('Meta individual guardada.'); setIndiv({ uid: '', lj: '', vd: '' }); onGuardado()
    } catch (e) { setMsg('No se pudo guardar: ' + (e.message || e)) }
  }

  if (!prog) return <div style={{ ...card, color: C.dim }}>Esta sucursal no tiene programa de extras.</div>

  // Se llama como función (no como <Par/>) para que los inputs no pierdan el foco.
  const par = ({ t, a, b, ka, kb }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
      <span style={{ minWidth: 220 }}>{t}</span>
      <label>L–J <input type="number" min="0" step="1" style={inp} value={a} onChange={e => setF({ ...f, [ka]: e.target.value })} /></label>
      <label>V–D <input type="number" min="0" step="1" style={inp} value={b} onChange={e => setF({ ...f, [kb]: e.target.value })} /></label>
    </div>
  )

  const individuales = config.metas.filter(m => m.tipo === 'extras' && m.usuario_id)

  return (
    <>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Metas diarias</h3>
        {par({ t: "Meta por persona (extras $/día)", a: f.pLj, b: f.pVd, ka: "pLj", kb: "pVd" })}
        {par({ t: "Meta del equipo / cocina (extras $/día de la sucursal)", a: f.eLj, b: f.eVd, ka: "eLj", kb: "eVd" })}
        {par({ t: "Meta de domicilios (pedidos/día)", a: f.dLj, b: f.dVd, ka: "dLj", kb: "dVd" })}
        <label style={{ display: 'block', margin: '10px 0' }}>Valen desde <input type="date" style={{ ...inp, width: 150 }} value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} /></label>
        <p style={{ color: C.dim, fontSize: 12, margin: 0 }}>Cada cambio se guarda con su fecha: el historial de metas no se pierde. Lunes a jueves (L–J) y viernes a domingo (V–D).</p>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Qué cuenta como extra</h3>
        <label style={{ display: 'block', marginBottom: 8 }}>
          <input type="checkbox" checked={mods} onChange={e => setMods(e.target.checked)} /> Ingredientes cobrados aparte (tocino, queso, jalapeño…)
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {cats.map(c => (
            <label key={c} style={{ ...btn(sel.includes(c)), display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={sel.includes(c)} onChange={e => setSel(e.target.checked ? [...sel, c] : sel.filter(x => x !== c))} /> {c}
            </label>
          ))}
        </div>
        <p style={{ color: C.dim, fontSize: 12 }}>Una categoría marcada cuenta completa cuando se pide como línea propia. Lo que viene dentro de un combo no cuenta.</p>
      </div>

      <button onClick={guardarTodo} style={{ ...btn(true), padding: '10px 18px', fontSize: 14 }}>Guardar metas y reglas</button>
      {msg && <span style={{ marginLeft: 12, color: C.dim }}>{msg}</span>}

      <div style={{ ...card, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Meta individual (opcional)</h3>
        <p style={{ color: C.dim, fontSize: 12, marginTop: 0 }}>Para alguien que necesita una meta distinta a la general, por ejemplo quien recién entra.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={{ ...inp, width: 220 }} value={indiv.uid} onChange={e => setIndiv({ ...indiv, uid: e.target.value })}>
            <option value="">Elegí una persona…</option>
            {personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <label>L–J <input type="number" min="0" style={inp} value={indiv.lj} onChange={e => setIndiv({ ...indiv, lj: e.target.value })} /></label>
          <label>V–D <input type="number" min="0" style={inp} value={indiv.vd} onChange={e => setIndiv({ ...indiv, vd: e.target.value })} /></label>
          <button style={btn(false)} onClick={guardarIndividual}>Guardar</button>
        </div>
        {individuales.length > 0 && (
          <ul style={{ color: C.dim, fontSize: 13 }}>
            {individuales.map(m => <li key={m.id}>{m.nombre}: L–J {money(m.meta_lj)} · V–D {money(m.meta_vd)} (desde {m.vigente_desde})</li>)}
          </ul>
        )}
      </div>
    </>
  )
}
