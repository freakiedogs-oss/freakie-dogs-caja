/* ═══════════════════════════════════════════════════════════════════════
   Desempeño de meseros — extras por persona, ticket, qué vende cada uno y metas

   Pedido de Jazz (M001). Plan: docs/planes/PLAN_desempeno_meseros_y_domicilios.md
   Extra = modificadores cobrados + líneas de las categorías marcadas
   (Extras, Fries & Sides, Cervezas, Bebidas sueltas). La bebida dentro de un
   combo no es línea propia y no cuenta.

   - Ventas a empleados fuera: descuento «empleado» o productos de empleado
     (Soda Empleados, Café empleado…). Se muestran aparte, no se promedian.
   - Promedios: meseros POR PERSONA atendida (pax de la mesa); cajeras POR TICKET.
   - Dueño de la cuenta = mesero asignado; si no hay, quien cobró.

   El cálculo vive en fn_extras_mesero / fn_items_mesero / fn_incentivo_sugerencias.
   Fase "medir": todavía no toca propinas.
   ═══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', warn: '#fbbf24', bad: '#f87171', acc: '#60a5fa', row: '#151518',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 12 }
const btn = (on) => ({ padding: '7px 12px', borderRadius: 8, border: `1px solid ${on ? C.acc : C.line}`, background: on ? '#13233a' : 'transparent', color: on ? C.acc : C.txt, cursor: 'pointer', fontSize: 13, fontWeight: 600 })
const inp = { background: '#121214', border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 13, width: 90 }
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n) => n == null ? '—' : `${Math.round(n)}%`
const th = { padding: '10px 12px', borderBottom: `1px solid ${C.line}`, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: C.dim }
const td = { padding: '9px 12px', borderBottom: `1px solid ${C.line}`, textAlign: 'right', whiteSpace: 'nowrap' }

const SUPERVISAN = ['admin', 'ejecutivo', 'superadmin']
const PUEDEN_CONFIGURAR = ['admin', 'ejecutivo', 'superadmin', 'gerente']
const SUCURSALES = [['M001', 'Cafetalón'], ['S003', 'Lourdes'], ['S004', 'Venecia']]
const ES_MESERO = (rol) => rol === 'mesero' || rol === 'mesera'
const ORDEN_GRUPOS = ['Combos', 'Individuales', 'Bebidas', 'Cervezas', 'Fries & Sides', 'Extras', 'Ingredientes extra']

// Las RPC devuelven máx. 1000 filas por llamada: paginar con .range().
async function rpcTodo(fn, args) {
  const out = []
  for (let i = 0; i < 50000; i += 1000) {
    const { data, error } = await db.rpc(fn, args).range(i, i + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

function hoySV() { return new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10) } // UTC-6 sin DST
function rango(periodo) {
  const hoy = hoySV()
  const [y, m] = hoy.split('-').map(Number)
  if (periodo === 'mes') return [`${hoy.slice(0, 7)}-01`, hoy]
  if (periodo === 'anterior') {
    return [new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)]
  }
  return [new Date(Date.parse(hoy) - 29 * 864e5).toISOString().slice(0, 10), hoy]
}
const finDeSemana = (iso) => { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 5 || d === 6 || d === 0 }

function metaEquipoDia(metas, tipo, dia) {
  const m = metas.filter(x => x.tipo === tipo && x.ambito === 'equipo' && !x.usuario_id && x.vigente_desde <= dia)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1))[0]
  return m ? Number(finDeSemana(dia) ? m.meta_vd : m.meta_lj) : null
}

export default function DesempenoMeserosView({ user }) {
  const rol = user?.rol || ''
  const supervisa = SUPERVISAN.includes(rol)
  const [store, setStore] = useState(supervisa ? 'M001' : (user?.store_code || 'M001'))
  const [periodo, setPeriodo] = useState('mes')
  const [tab, setTab] = useState('ranking')
  const [filas, setFilas] = useState([])
  const [items, setItems] = useState([])
  const [config, setConfig] = useState({ programas: [], metas: [], tramos: [] })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState(null)

  const [desde, hasta] = rango(periodo)

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try {
      const args = { p_usuario_id: user.id, p_store: store, p_desde: desde, p_hasta: hasta }
      const [f1, r2, i3] = await Promise.all([
        rpcTodo('fn_extras_mesero', args),
        db.rpc('fn_incentivo_config', { p_usuario_id: user.id, p_store: store }),
        rpcTodo('fn_items_mesero', args),
      ])
      if (r2.error) throw r2.error
      setFilas(f1)
      setConfig(r2.data || { programas: [], metas: [], tramos: [] })
      setItems(i3)
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
      if (!map[k]) map[k] = { id: k, nombre: f.nombre || 'Sin nombre', rol: f.rol, dias: [], cuentas: 0, mesas: 0, atendidas: 0, venta: 0, extras: 0, conExtra: 0, empleado: 0, meta: 0, diasConMeta: 0 }
      const p = map[k]
      p.dias.push(f)
      p.cuentas += Number(f.cuentas); p.mesas += Number(f.cuentas_mesa); p.atendidas += Number(f.personas)
      p.venta += Number(f.venta); p.extras += Number(f.extras); p.conExtra += Number(f.cuentas_con_extra)
      p.empleado += Number(f.ventas_empleado)
      if (f.meta_dia != null && Number(f.cuentas) > 0) { p.meta += Number(f.meta_dia); p.diasConMeta++ }
    }
    return Object.values(map)
      .filter(p => p.cuentas >= 5)
      .map(p => {
        const diasTrab = p.dias.filter(d => Number(d.cuentas) > 0).length || 1
        // Meseros: por persona atendida. Cajeras y demás: por ticket.
        const base = ES_MESERO(p.rol) ? (p.atendidas || p.cuentas) : p.cuentas
        return {
          ...p,
          unidad: ES_MESERO(p.rol) ? 'persona' : 'ticket',
          base,
          nDias: diasTrab,
          extrasDia: p.extras / diasTrab,
          ventaProm: p.venta / base,
          extrasProm: p.extras / base,
          pctConExtra: (p.conExtra / p.cuentas) * 100,
          cumplimiento: p.diasConMeta > 0 && p.meta > 0 ? (p.extras / p.meta) * 100 : null,
        }
      })
      .sort((a, b) => b.extrasDia - a.extrasDia)
  }, [filas])

  const equipo = useMemo(() => {
    const porDia = {}
    for (const f of filas) porDia[f.dia] = (porDia[f.dia] || 0) + Number(f.extras)
    const dias = Object.keys(porDia).sort()
    let meta = 0, conMeta = 0
    for (const d of dias) { const m = metaEquipoDia(config.metas, 'extras', d); if (m != null) { meta += m; conMeta++ } }
    const total = Object.values(porDia).reduce((s, v) => s + v, 0)
    return { total, dias: dias.length, meta: conMeta ? meta : null, cumplimiento: conMeta && meta > 0 ? (total / meta) * 100 : null }
  }, [filas, config.metas])

  const mesasSinMesero = useMemo(() => filas.filter(f => !ES_MESERO(f.rol)).reduce((s, f) => s + Number(f.cuentas_mesa), 0), [filas])
  const mesasTotal = useMemo(() => filas.reduce((s, f) => s + Number(f.cuentas_mesa), 0), [filas])
  const ventasEmpleado = useMemo(() => filas.reduce((s, f) => s + Number(f.ventas_empleado), 0), [filas])
  const tienePrograma = config.programas.some(p => p.tipo === 'extras')

  return (
    <div style={{ background: C.bg, color: C.txt, minHeight: '100%', padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Desempeño de meseros</h2>
      <p style={{ margin: '0 0 14px', color: C.dim, fontSize: 13 }}>
        Extras = ingredientes cobrados aparte y lo que se pide fuera del combo (bebidas, papas, cervezas, extras). Sin ventas a empleados. Fase de medición: todavía no afecta la propina.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {supervisa && SUCURSALES.map(([sc, n]) => <button key={sc} style={btn(store === sc)} onClick={() => setStore(sc)}>{n}</button>)}
        <span style={{ width: 8 }} />
        {[['mes', 'Este mes'], ['anterior', 'Mes anterior'], ['30', 'Últimos 30 días']].map(([k, l]) =>
          <button key={k} style={btn(periodo === k)} onClick={() => setPeriodo(k)}>{l}</button>)}
        <span style={{ width: 8 }} />
        <button style={btn(tab === 'ranking')} onClick={() => setTab('ranking')}>Ranking</button>
        <button style={btn(tab === 'vende')} onClick={() => setTab('vende')}>Qué vende cada uno</button>
        <button style={btn(tab === 'sucursales')} onClick={() => setTab('sucursales')}>Por sucursal</button>
        {PUEDEN_CONFIGURAR.includes(rol) && <button style={btn(tab === 'propina')} onClick={() => setTab('propina')}>Propina y faltas</button>}
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
            <Kpi titulo="Ventas a empleados (fuera)" valor={ventasEmpleado}
              sub="No cuentan en promedios ni metas" />
          </div>

          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr>
                  {['Persona', 'Días', 'Cuentas', 'Personas', 'Venta prom.', 'Extras prom.', 'Extras/día', '% con extra', 'Meta', 'Cumplimiento'].map((h, i) =>
                    <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {cargando && <tr><td colSpan={10} style={{ padding: 16, color: C.dim }}>Cargando…</td></tr>}
                {!cargando && personas.length === 0 && <tr><td colSpan={10} style={{ padding: 16, color: C.dim }}>Sin ventas en este período.</td></tr>}
                {!cargando && personas.map(p => (
                  <FilaPersona key={p.id} p={p} items={items.filter(i => i.usuario_id === p.id)}
                    abierto={abierto === p.id} onToggle={() => setAbierto(abierto === p.id ? null : p.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: C.dim, fontSize: 12 }}>
            <b>Venta y extras promedio:</b> meseros por <b>persona atendida</b> (personas sentadas en la mesa); cajeras por <b>ticket</b>.
            Tocá una persona para ver su detalle por día y lo que vendió. «Cumplimiento» = extras ÷ (meta del día × días trabajados);
            lunes a jueves y viernes a domingo tienen meta distinta.
          </p>
        </>
      )}

      {tab === 'vende' && !error && <QueVende personas={personas} items={items} cargando={cargando} />}

      {tab === 'sucursales' && !error && <PorSucursal user={user} desde={desde} hasta={hasta} actual={store} />}

      {tab === 'propina' && <PropinaFaltas user={user} store={store} mes={periodo === 'anterior' ? desde : `${hoySV().slice(0, 7)}-01`} />}

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

const Unidad = ({ u }) => <span style={{ color: C.dim, fontSize: 11 }}>/{u}</span>

function FilaPersona({ p, items, abierto, onToggle }) {
  const [vista, setVista] = useState('vende')
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: abierto ? C.row : 'transparent' }}>
        <td style={{ ...td, textAlign: 'left' }}><b>{p.nombre}</b> <span style={{ color: C.dim, fontSize: 11 }}>{p.rol}</span></td>
        <td style={td}>{p.nDias}</td>
        <td style={td}>{p.cuentas}{p.empleado > 0 && <div style={{ color: C.dim, fontSize: 11 }}>+{p.empleado} empleados</div>}</td>
        <td style={td}>{ES_MESERO(p.rol) ? p.atendidas : '—'}</td>
        <td style={td}>{money(p.ventaProm)} <Unidad u={p.unidad} /></td>
        <td style={{ ...td, fontWeight: 700 }}>{money(p.extrasProm)} <Unidad u={p.unidad} /></td>
        <td style={{ ...td, fontWeight: 700 }}>{money(p.extrasDia)}</td>
        <td style={td}>{pct(p.pctConExtra)}</td>
        <td style={td}>{p.diasConMeta ? money(p.meta) : '—'}</td>
        <td style={td}><Barra v={p.cumplimiento} /></td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={10} style={{ padding: '8px 12px 14px', borderBottom: `1px solid ${C.line}`, background: C.row }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button style={btn(vista === 'vende')} onClick={() => setVista('vende')}>Qué vendió</button>
              <button style={btn(vista === 'dias')} onClick={() => setVista('dias')}>Por día</button>
            </div>
            {vista === 'dias' ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {p.dias.filter(d => Number(d.cuentas) > 0).map(d => {
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
            ) : <ItemsPersona items={items} base={p.base} unidad={p.unidad} />}
          </td>
        </tr>
      )}
    </>
  )
}

// Lo que vendió una persona, agrupado; con tasa «cada 10 personas/tickets».
function ItemsPersona({ items, base, unidad }) {
  const grupos = useMemo(() => agrupar(items), [items])
  if (!items.length) return <div style={{ color: C.dim }}>Sin ítems en este período.</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10, alignItems: 'start' }}>
      {grupos.map(g => (
        <div key={g.grupo} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <b>{g.grupo}</b>
            <span><b>{g.cantidad}</b> <span style={{ color: C.dim, fontSize: 11 }}>· {(g.cantidad / base * 10).toFixed(1)} c/10 {unidad === 'persona' ? 'personas' : 'tickets'}</span></span>
          </div>
          <div style={{ color: C.dim, fontSize: 12, marginBottom: 6 }}>{money(g.monto)}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr style={{ color: C.dim }}>
              <td>Producto</td><td style={{ textAlign: 'right' }}>Cant.</td><td style={{ textAlign: 'right' }}>c/10</td><td style={{ textAlign: 'right' }}>$</td>
            </tr></thead>
            <tbody>
              {g.items.map(it => (
                <tr key={it.item}>
                  <td style={{ padding: '2px 6px 2px 0', whiteSpace: 'normal' }}>{it.item}</td>
                  <td style={{ textAlign: 'right' }}>{it.cantidad}</td>
                  <td style={{ textAlign: 'right', color: C.dim }}>{(it.cantidad / base * 10).toFixed(1)}</td>
                  <td style={{ textAlign: 'right', color: C.dim }}>{money(it.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function agrupar(items) {
  const m = {}
  for (const i of items) {
    if (!m[i.grupo]) m[i.grupo] = { grupo: i.grupo, cantidad: 0, monto: 0, items: [] }
    m[i.grupo].cantidad += Number(i.cantidad); m[i.grupo].monto += Number(i.monto)
    const prev = m[i.grupo].items.find(x => x.item === i.item)
    if (prev) { prev.cantidad += Number(i.cantidad); prev.monto += Number(i.monto) }
    else m[i.grupo].items.push({ item: i.item, cantidad: Number(i.cantidad), monto: Number(i.monto) })
  }
  const orden = (g) => { const k = ORDEN_GRUPOS.indexOf(g); return k < 0 ? 99 : k }
  return Object.values(m).map(g => ({ ...g, items: g.items.sort((a, b) => b.cantidad - a.cantidad) }))
    .sort((a, b) => orden(a.grupo) - orden(b.grupo))
}

// Comparativo: grupo/ítem × persona. Cantidad y tasa por cada 10 personas (meseros) o tickets (cajeras).
function QueVende({ personas, items, cargando }) {
  const [cerrados, setCerrados] = useState({})   // todo desglosado por defecto
  const [modo, setModo] = useState('tasa')
  const filas = useMemo(() => {
    const g = agrupar(items)
    return g.map(gr => {
      const porItem = {}
      for (const i of items.filter(x => x.grupo === gr.grupo)) {
        if (!porItem[i.item]) porItem[i.item] = { item: i.item, total: 0, por: {} }
        porItem[i.item].total += Number(i.cantidad)
        porItem[i.item].por[i.usuario_id] = (porItem[i.item].por[i.usuario_id] || 0) + Number(i.cantidad)
      }
      const por = {}
      for (const i of items.filter(x => x.grupo === gr.grupo)) por[i.usuario_id] = (por[i.usuario_id] || 0) + Number(i.cantidad)
      return { grupo: gr.grupo, total: gr.cantidad, por, items: Object.values(porItem).sort((a, b) => b.total - a.total) }
    })
  }, [items])

  if (cargando) return <div style={{ color: C.dim }}>Cargando…</div>
  if (!personas.length) return <div style={{ color: C.dim }}>Sin ventas en este período.</div>

  const celda = (n, p) => {
    if (!n) return <span style={{ color: C.dim }}>—</span>
    return modo === 'tasa' ? (n / p.base * 10).toFixed(1) : n
  }
  // Resaltar la mejor tasa de cada fila
  const mejor = (por) => {
    let best = null, v = -1
    for (const p of personas) { const t = (por[p.id] || 0) / p.base; if (t > v) { v = t; best = p.id } }
    return v > 0 ? best : null
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn(modo === 'tasa')} onClick={() => setModo('tasa')}>Cada 10 personas / tickets</button>
        <button style={btn(modo === 'cant')} onClick={() => setModo('cant')}>Cantidad vendida</button>
        <button style={btn(false)} onClick={() => setCerrados(Object.fromEntries(filas.map(f => [f.grupo, true])))}>Solo grupos</button>
        <button style={btn(false)} onClick={() => setCerrados({})}>Desglosar todo</button>
        <span style={{ color: C.dim, fontSize: 12 }}>Tocá un grupo para abrirlo o cerrarlo. En verde, quien más vende de eso.</span>
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: C.card }}>Grupo / producto</th>
              {personas.map(p => <th key={p.id} style={th}>{p.nombre.split(' ')[0]}<div style={{ fontWeight: 400, fontSize: 11 }}>/{p.unidad}</div></th>)}
              <th style={th}>Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => {
              const b = mejor(f.por)
              return [
                <tr key={f.grupo} onClick={() => setCerrados(c => ({ ...c, [f.grupo]: !c[f.grupo] }))} style={{ cursor: 'pointer', background: C.row }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700, position: 'sticky', left: 0, background: C.row }}>{!cerrados[f.grupo] ? '▾' : '▸'} {f.grupo}</td>
                  {personas.map(p => <td key={p.id} style={{ ...td, fontWeight: 700, color: b === p.id ? C.ok : C.txt }}>{celda(f.por[p.id], p)}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{f.total}</td>
                </tr>,
                ...(!cerrados[f.grupo] ? f.items.map(it => {
                  const bi = mejor(it.por)
                  return (
                    <tr key={f.grupo + it.item}>
                      <td style={{ ...td, textAlign: 'left', paddingLeft: 28, color: C.dim, position: 'sticky', left: 0, background: C.card }}>{it.item}</td>
                      {personas.map(p => <td key={p.id} style={{ ...td, color: bi === p.id ? C.ok : C.txt }}>{celda(it.por[p.id], p)}</td>)}
                      <td style={td}>{it.total}</td>
                    </tr>
                  )
                }) : []),
              ]
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: C.dim, fontSize: 12 }}>
        «Cada 10» compara sin importar cuánta gente atendió cada uno: meseros por cada 10 personas atendidas, cajeras por cada 10 tickets.
        «Ingredientes extra» son los que se cobran dentro del plato (tocino, queso, agrandado de bebida…). Sin ventas a empleados ni cortesías.
      </p>
    </>
  )
}

function ConfigMetas({ user, store, config, personas, onGuardado }) {
  const prog = config.programas.find(p => p.tipo === 'extras')
  const [cats, setCats] = useState([])
  const [sel, setSel] = useState(prog?.categorias_extra || [])
  const [mods, setMods] = useState(prog?.cuenta_modificadores ?? true)
  const [msg, setMsg] = useState('')
  const [sug, setSug] = useState(null)
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
    db.rpc('fn_incentivo_sugerencias', { p_usuario_id: user.id, p_store: store, p_dias: 30 })
      .then(({ data }) => setSug(data || null))
  }, [user.id, store])

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

  function usarSugeridos() {
    if (!sug) return
    setF({
      ...f,
      pLj: sug.persona?.lj ?? f.pLj, pVd: sug.persona?.vd ?? f.pVd,
      eLj: sug.equipo?.lj ?? f.eLj, eVd: sug.equipo?.vd ?? f.eVd,
      dLj: sug.domicilios?.lj ?? f.dLj, dVd: sug.domicilios?.vd ?? f.dVd,
    })
    setMsg('Sugeridos cargados. Revisalos y tocá «Guardar metas y reglas».')
  }

  if (!prog) return <div style={{ ...card, color: C.dim }}>Esta sucursal no tiene programa de extras.</div>

  // Se llama como función (no como componente) para que los inputs no pierdan el foco.
  const par = ({ t, a, b, ka, kb, s, hoy, unidad }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
      <span style={{ minWidth: 240 }}>{t}</span>
      <label>L–J <input type="number" min="0" step="1" style={inp} value={a} onChange={e => setF({ ...f, [ka]: e.target.value })} /></label>
      <label>V–D <input type="number" min="0" step="1" style={inp} value={b} onChange={e => setF({ ...f, [kb]: e.target.value })} /></label>
      {s && s.lj != null && (
        <span style={{ color: C.dim, fontSize: 12 }}>
          Sugerido <b style={{ color: C.acc }}>{unidad}{s.lj} / {unidad}{s.vd}</b> · hoy promedian {unidad}{hoy?.lj ?? '—'} / {unidad}{hoy?.vd ?? '—'}
        </span>
      )}
    </div>
  )
  const individuales = config.metas.filter(m => m.tipo === 'extras' && m.usuario_id)

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Metas diarias</h3>
          <button style={btn(true)} onClick={usarSugeridos} disabled={!sug}>Usar sugeridos</button>
        </div>
        {par({ t: 'Meta por persona (extras $/día)', a: f.pLj, b: f.pVd, ka: 'pLj', kb: 'pVd', s: sug?.persona, hoy: { lj: sug?.persona?.prom_lj, vd: sug?.persona?.prom_vd }, unidad: '$' })}
        {par({ t: 'Meta del equipo / cocina (extras $/día de la sucursal)', a: f.eLj, b: f.eVd, ka: 'eLj', kb: 'eVd', s: sug?.equipo, hoy: { lj: sug?.equipo?.prom_lj, vd: sug?.equipo?.prom_vd }, unidad: '$' })}
        {par({ t: 'Meta de domicilios (pedidos/día)', a: f.dLj, b: f.dVd, ka: 'dLj', kb: 'dVd', s: sug?.domicilios, hoy: { lj: sug?.domicilios?.prom_lj, vd: sug?.domicilios?.prom_vd }, unidad: '' })}
        <label style={{ display: 'block', margin: '10px 0' }}>Valen desde <input type="date" style={{ ...inp, width: 150 }} value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} /></label>
        {sug && (
          <p style={{ color: C.dim, fontSize: 12, margin: 0 }}>
            Cómo se sugieren (últimos 30 días, sin ventas a empleados): <b>persona</b> = lo que se logra en el 40 % de los mejores días de cada quien (percentil 60), redondeado a $5;
            {' '}<b>equipo</b> = un día normal de la sucursal + 5 %; <b>domicilios</b> = promedio diario + 10 %. Lunes a jueves (L–J) y viernes a domingo (V–D) por separado.
          </p>
        )}
      </div>

      {sug?.por_persona?.length > 0 && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Cómo le iría a cada uno con la meta sugerida</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums', width: '100%' }}>
              <thead><tr>{['Persona', 'Días', 'Extras/día L–J', 'Extras/día V–D'].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                {sug.por_persona.map(p => {
                  const c = (v, m) => v == null ? C.dim : Number(v) >= Number(m) ? C.ok : C.bad
                  return (
                    <tr key={p.usuario_id}>
                      <td style={{ ...td, textAlign: 'left' }}>{p.nombre}</td>
                      <td style={td}>{p.dias}</td>
                      <td style={{ ...td, color: c(p.lj, f.pLj || sug.persona.lj) }}>{p.lj == null ? '—' : money(p.lj)}</td>
                      <td style={{ ...td, color: c(p.vd, f.pVd || sug.persona.vd) }}>{p.vd == null ? '—' : money(p.vd)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p style={{ color: C.dim, fontSize: 12, marginBottom: 0 }}>Verde: su promedio ya alcanza la meta escrita arriba. Rojo: tendría que subir. Solo días con 5 cuentas o más.</p>
        </div>
      )}

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
        <p style={{ color: C.dim, fontSize: 12 }}>Una categoría marcada cuenta completa cuando se pide como línea propia. Lo que viene dentro de un combo no cuenta. Los productos de empleado nunca cuentan.</p>
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

// Ticket promedio por persona (mesas) y por ticket (para llevar), comparando sucursales.
const NOMBRE_CORTO = { M001: 'Cafetalón', S001: 'Soyapango', S002: 'Usulután', S003: 'Lourdes', S004: 'Venecia', S005: 'Drive Lourdes', S006: 'Metrocentro' }
function PorSucursal({ user, desde, hasta, actual }) {
  const [rows, setRows] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setCargando(true); setError('')
    db.rpc('fn_ticket_sucursales', { p_usuario_id: user.id, p_desde: desde, p_hasta: hasta })
      .then(({ data, error: e }) => { if (e) setError(e.message); else setRows(data || []); setCargando(false) })
  }, [user.id, desde, hasta])

  if (cargando) return <div style={{ color: C.dim }}>Cargando…</div>
  if (error) return <div style={{ ...card, borderColor: C.bad, color: C.bad }}>{error}</div>

  const conMesa = rows.filter(r => Number(r.mesas) > 0)
  const maxTP = Math.max(1, ...conMesa.map(r => Number(r.ticket_persona || 0)))
  const tot = conMesa.reduce((a, r) => ({ v: a.v + Number(r.venta_mesa), p: a.p + Number(r.personas_mesa), e: a.e + Number(r.extras_persona || 0) * Number(r.personas_mesa) }), { v: 0, p: 0, e: 0 })

  return (
    <>
      {conMesa.length > 0 && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Ticket promedio por persona · mesas</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {conMesa.map(r => (
              <div key={r.store_code} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px', gap: 10, alignItems: 'center' }}>
                <span style={{ fontWeight: r.store_code === actual ? 700 : 400 }}>{NOMBRE_CORTO[r.store_code] || r.sucursal}</span>
                <span style={{ background: C.line, borderRadius: 4, height: 14, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Number(r.ticket_persona) / maxTP * 100}%`, background: r.store_code === actual ? C.acc : '#3b5b85' }} />
                </span>
                <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.ticket_persona)}</b>
              </div>
            ))}
          </div>
          {tot.p > 0 && <p style={{ color: C.dim, fontSize: 12, marginBottom: 0 }}>Promedio de las sucursales con mesas: <b style={{ color: C.txt }}>{money(tot.v / tot.p)}</b> por persona · extras {money(tot.e / tot.p)} por persona.</p>}
        </div>
      )}

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Sucursal</th>
              <th style={th}>Mesas</th><th style={th}>Personas</th><th style={th}>Personas/mesa</th>
              <th style={th}>Ticket/persona</th><th style={th}>Ticket/mesa</th><th style={th}>Extras/persona</th>
              <th style={th}>Tickets llevar</th><th style={th}>Ticket llevar</th><th style={th}>Extras/ticket llevar</th>
              <th style={th}>Empleados (fuera)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const m = Number(r.mesas) > 0
              return (
                <tr key={r.store_code} style={{ background: r.store_code === actual ? C.row : 'transparent' }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{NOMBRE_CORTO[r.store_code] || r.sucursal}</td>
                  <td style={td}>{m ? r.mesas : '—'}</td>
                  <td style={td}>{m ? r.personas_mesa : '—'}</td>
                  <td style={td}>{m ? (Number(r.personas_mesa) / Number(r.mesas)).toFixed(2) : '—'}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{m ? money(r.ticket_persona) : '—'}</td>
                  <td style={td}>{m ? money(r.ticket_mesa) : '—'}</td>
                  <td style={td}>{m ? money(r.extras_persona) : '—'}</td>
                  <td style={td}>{r.tickets_llevar}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{Number(r.tickets_llevar) ? money(r.ticket_llevar) : '—'}</td>
                  <td style={td}>{Number(r.tickets_llevar) ? money(r.extras_ticket_llevar) : '—'}</td>
                  <td style={{ ...td, color: C.dim }}>{r.ventas_empleado}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: C.dim, fontSize: 12 }}>
        Mesas: venta ÷ personas sentadas. Para llevar y drive thru: venta ÷ ticket (no se registra cuántas personas). Sin ventas a empleados, sin delivery ni PedidosYa.
        Los food courts no tienen mesas, por eso solo muestran ticket.
      </p>
    </>
  )
}

// ── Propina del mes: base por meta + premios − faltas ─────────────────────
// Leve −2.5 %, moderada −5 %, grave −10 %; premio +x % (hasta 20 por registro).
// El cálculo vive en fn_propina_mes; cada quien ve el suyo en «Mi Desempeño».
const TIPOS = [
  ['falta_leve', 'Falta leve', -2.5, C.warn],
  ['falta_moderada', 'Falta moderada', -5, '#fb923c'],
  ['falta_grave', 'Falta grave', -10, C.bad],
  ['premio', 'Premio', null, C.ok],
]
const ROL_ORDEN = { cocina: 0, mesero: 1, mesera: 1, cajera: 2, cajero: 2, domicilios: 3 }
const ROL_LABEL = { cocina: 'Cocina', mesero: 'Meseros', mesera: 'Meseros', cajera: 'Cajeras', cajero: 'Cajeras', domicilios: 'Domicilios' }
const fmtPct = (n) => `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('es', { maximumFractionDigits: 1 })}%`

function PropinaFaltas({ user, store, mes }) {
  const [filas, setFilas] = useState([])
  const [ajustes, setAjustes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState('')
  const [f, setF] = useState({ uid: '', tipo: 'falta_leve', pct: 5, fecha: hoySV(), motivo: '' })
  const [anulando, setAnulando] = useState(null)   // { id, motivo }

  const cargar = useCallback(async () => {
    setCargando(true)
    const [r1, r2] = await Promise.all([
      db.rpc('fn_propina_mes', { p_usuario_id: user.id, p_store: store, p_mes: mes }),
      db.rpc('fn_ajustes_mes', { p_usuario_id: user.id, p_store: store, p_mes: mes }),
    ])
    if (r1.error || r2.error) setMsg((r1.error || r2.error).message)
    setFilas((r1.data || []).sort((a, b) => (ROL_ORDEN[a.rol] ?? 9) - (ROL_ORDEN[b.rol] ?? 9) || a.nombre.localeCompare(b.nombre)))
    setAjustes(r2.data || [])
    setCargando(false)
  }, [user.id, store, mes])
  useEffect(() => { cargar() }, [cargar])

  async function registrar() {
    if (!f.uid) { setMsg('Elegí a la persona.'); return }
    if (f.motivo.trim().length < 3) { setMsg('Escribí el motivo: la persona lo va a ver.'); return }
    const { error } = await db.rpc('fn_ajuste_registrar', {
      p_usuario_id: user.id, p_store: store, p_target: f.uid, p_tipo: f.tipo,
      p_pct: f.tipo === 'premio' ? Number(f.pct) : null, p_fecha: f.fecha, p_motivo: f.motivo,
    })
    if (error) { setMsg('No se registró: ' + error.message); return }
    const quien = filas.find(x => x.usuario_id === f.uid)?.nombre
    setMsg(`Registrado para ${quien}.`); setF({ ...f, motivo: '' }); cargar()
  }

  async function anular() {
    const { error } = await db.rpc('fn_ajuste_anular', { p_usuario_id: user.id, p_id: anulando.id, p_motivo: anulando.motivo })
    if (error) { setMsg('No se anuló: ' + error.message); return }
    setAnulando(null); setMsg('Anulado.'); cargar()
  }

  const grupos = {}
  for (const x of filas) (grupos[ROL_LABEL[x.rol] || x.rol] ||= []).push(x)
  const tipo = TIPOS.find(t => t[0] === f.tipo)
  const lblMes = new Date(mes + 'T12:00:00Z').toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Registrar falta o premio</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <select style={{ ...inp, width: 240 }} value={f.uid} onChange={e => setF({ ...f, uid: e.target.value })}>
            <option value="">Elegí a la persona…</option>
            {Object.entries(grupos).map(([g, xs]) => (
              <optgroup key={g} label={g}>{xs.map(x => <option key={x.usuario_id} value={x.usuario_id}>{x.nombre}</option>)}</optgroup>
            ))}
          </select>
          <input type="date" style={{ ...inp, width: 150 }} value={f.fecha} max={hoySV()} onChange={e => setF({ ...f, fecha: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {TIPOS.map(([k, l, v, col]) => (
            <button key={k} onClick={() => setF({ ...f, tipo: k })}
              style={{ ...btn(f.tipo === k), borderColor: f.tipo === k ? col : C.line, color: f.tipo === k ? col : C.txt, background: 'transparent' }}>
              {l} {v != null ? `${v}%` : ''}
            </button>
          ))}
          {f.tipo === 'premio' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              + <input type="number" min="0.5" max="20" step="0.5" style={{ ...inp, width: 70 }} value={f.pct} onChange={e => setF({ ...f, pct: e.target.value })} /> %
            </label>
          )}
        </div>
        <textarea rows={2} placeholder="Motivo (la persona lo ve en «Mi Desempeño»)" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })}
          style={{ ...inp, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 10 }} />
        <button style={{ ...btn(true), borderColor: tipo[3], color: tipo[3] }} onClick={registrar}>
          Registrar {tipo[1].toLowerCase()} {f.tipo === 'premio' ? `+${f.pct}%` : `${tipo[2]}%`}
        </button>
        {msg && <span style={{ marginLeft: 12, color: C.dim }}>{msg}</span>}
      </div>

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 12px 0', fontWeight: 700 }}>Propina de {lblMes}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>{['Persona', 'Se mide con', 'Meta', 'Base', 'Faltas', 'Premios', 'Propina del mes'].map((h, i) =>
              <th key={h} style={{ ...th, textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {cargando && <tr><td colSpan={7} style={{ padding: 16, color: C.dim }}>Cargando…</td></tr>}
            {!cargando && Object.entries(grupos).map(([g, xs]) => [
              <tr key={g}><td colSpan={7} style={{ ...td, textAlign: 'left', background: C.row, color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{g}</td></tr>,
              ...xs.map(x => {
                const col = Number(x.pct_final) >= 100 ? C.ok : Number(x.pct_final) >= 75 ? C.warn : C.bad
                return (
                  <tr key={x.usuario_id}>
                    <td style={{ ...td, textAlign: 'left' }}><b>{x.nombre}</b></td>
                    <td style={{ ...td, textAlign: 'left', color: C.dim }}>{x.ambito === 'equipo' ? 'Meta del equipo' : x.ambito === 'domicilios' ? 'Meta de domicilios' : 'Su meta de extras'}</td>
                    <td style={td}>{x.sin_meta ? <span style={{ color: C.dim }}>Sin meta</span> : <Barra v={Number(x.cumplimiento)} />}</td>
                    <td style={td}>{Number(x.base_pct)}%</td>
                    <td style={{ ...td, color: Number(x.faltas_pct) ? C.bad : C.dim }}>{Number(x.faltas_pct) ? `${fmtPct(x.faltas_pct)} (${x.n_faltas})` : '—'}</td>
                    <td style={{ ...td, color: Number(x.premios_pct) ? C.ok : C.dim }}>{Number(x.premios_pct) ? `${fmtPct(x.premios_pct)} (${x.n_premios})` : '—'}</td>
                    <td style={{ ...td, fontWeight: 800, fontSize: 15, color: col }}>{Number(x.pct_final).toLocaleString('es', { maximumFractionDigits: 1 })}%</td>
                  </tr>
                )
              }),
            ])}
          </tbody>
        </table>
        <p style={{ color: C.dim, fontSize: 12, padding: '0 12px' }}>
          Base: 100 % si cumple su meta del mes, 50 % si no (sin meta cargada = 100 %). Cocina se mide con la meta del equipo; Karina con la de domicilios.
          Se calcula hasta ayer. Propina del mes = base + premios − faltas. Fase de medición: todavía no cambia la planilla.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Faltas y premios de {lblMes}</h3>
        {ajustes.length === 0 && <div style={{ color: C.dim }}>Sin registros este mes.</div>}
        {ajustes.map(a => {
          const t = TIPOS.find(x => x[0] === a.tipo)
          return (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: `1px solid ${C.line}`, opacity: a.anulado ? 0.5 : 1 }}>
              <b style={{ color: t?.[3], minWidth: 60, textAlign: 'right' }}>{fmtPct(a.pct)}</b>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div><b>{a.nombre}</b> <span style={{ color: C.dim, fontSize: 12 }}>· {t?.[1]} · {a.fecha} · registró {a.registrado_por}</span></div>
                <div style={{ color: C.dim, fontSize: 13, textDecoration: a.anulado ? 'line-through' : 'none' }}>{a.motivo}</div>
                {a.anulado && <div style={{ fontSize: 12, color: C.dim }}>Anulado: {a.anulado_motivo}</div>}
              </div>
              {!a.anulado && (anulando?.id === a.id ? (
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <input autoFocus placeholder="¿Por qué se anula?" style={{ ...inp, width: 200 }} value={anulando.motivo} onChange={e => setAnulando({ ...anulando, motivo: e.target.value })} />
                  <button style={btn(true)} onClick={anular}>Anular</button>
                  <button style={btn(false)} onClick={() => setAnulando(null)}>Cancelar</button>
                </span>
              ) : <button style={{ ...btn(false), color: C.dim }} onClick={() => setAnulando({ id: a.id, motivo: '' })}>Anular</button>)}
            </div>
          )
        })}
      </div>
    </>
  )
}
