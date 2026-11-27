// ────────────────────────────────────────────────────────────────────
// Compras (HQ) — todo lo de compras de Freakie Dogs en una pantalla:
// KPIs, sugerencias de ahorro / alertas de precio, items con su mejor precio
// del grupo, gasto por mes, proveedores, compras recientes y categorías.
//
// Los datos los arma `compras_hq.erp_payload('freakie')` y se piden por el
// puente `compras_hq_freakie(p_token)` (SECURITY DEFINER), que valida la sesión
// de administración (`fin_sesion_rol`): solo admin / ejecutivo / superadmin.
// Contrato: hq-panel/supabase/compras_hq/CONTRATO_VISTA_COMPRAS.md
//
// Reglas del contrato que esta pantalla respeta:
//  · Si el puente rechaza, se muestra su mensaje TAL CUAL. Nada de datos falsos.
//  · Fechas formateadas como texto (Safari corre un día `new Date('YYYY-MM-DD')`).
//  · Campo null → "—".
// ────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'
import { getTorreToken, abrirSesionFinanzas } from '../../supabaseFinanzas'
import { tokens } from '@/theme'

// ── Formato ──────────────────────────────────────────────────────────
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

const vacio = (v) => v === null || v === undefined || v === ''
const dinero = (n) => (vacio(n) || isNaN(Number(n)) ? '—' : USD.format(Number(n)))
const dineroCorto = (n) => {
  if (vacio(n)) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1000) return '$' + NUM.format(v / 1000) + 'k'
  return '$' + Math.round(v)
}
// Precio por unidad base: centavos de más cuando el precio es chico ($0.562/l).
const precio = (n, unidad) => {
  if (vacio(n)) return '—'
  const v = Number(n)
  const txt = '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 ? 3 : 2 })
  return unidad ? `${txt}/${unidad}` : txt
}
const pct = (n, conSigno = true) => {
  if (vacio(n)) return '—'
  const v = Number(n)
  return (conSigno && v > 0 ? '+' : '') + NUM.format(v) + '%'
}

// 'YYYY-MM-DD' (o el inicio de un ISO) → '24 nov 2026', sin pasar por Date.
const fecha = (s) => {
  if (vacio(s)) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s))
  if (!m) return String(s)
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1] || m[2]} ${m[1]}`
}

// timestamptz de Postgres ('2026-11-25T09:53:10.588161+00:00') → hora de El
// Salvador (UTC-6, sin DST). Se arma a mano: Safari no siempre parsea los
// microsegundos ni el espacio en vez de la 'T'.
const RE_TS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/
const msDeTimestamp = (s) => {
  const m = RE_TS.exec(String(s || '').trim())
  if (!m) return null
  let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  const off = m[7]
  if (off && off !== 'Z') {
    const signo = off[0] === '-' ? -1 : 1
    const [hh, mm] = off.slice(1).replace(':', '').match(/^(\d{2})(\d{2})?/).slice(1)
    ms -= signo * (Number(hh) * 60 + Number(mm || 0)) * 60000
  } else if (!off) {
    ms += 6 * 3600000 // sin zona: se asume hora de El Salvador
  }
  return ms
}
const fechaHoraSV = (s) => {
  const ms = msDeTimestamp(s)
  if (ms === null) return vacio(s) ? '—' : String(s)
  const d = new Date(ms - 6 * 3600000)
  const h = d.getUTCHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h12}:${min} ${h < 12 ? 'a. m.' : 'p. m.'}`
}
const hace = (s) => {
  const ms = msDeTimestamp(s)
  if (ms === null) return ''
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

const UNIDAD_MH = { '59': 'u', '36': 'lb', '34': 'kg', '22': 'gal', '99': '' }
const TIPO_PROV = {
  insumos: 'Insumos', servicio: 'Servicio', arrendamiento: 'Arrendamiento',
  financiero: 'Financiero', activo_fijo: 'Activo fijo', intercompania: 'Intercompañía',
}

const VERDE = '#4ade80'
const ROJO = '#f87171'
const AZUL = '#60a5fa'
const AMBAR = '#fbbf24'

// Sugerencias: color y etiqueta por tipo (contrato §3).
const TIPO_SUG = {
  cambiar_proveedor: { etiqueta: 'Oportunidad', color: AZUL, icono: '💡', impacto: 'de ahorro posible al mes' },
  alza_precio: { etiqueta: 'Alerta · alza de precio', color: ROJO, icono: '⚠️', impacto: 'más al mes' },
  cambio_mas_caro: { etiqueta: 'Alerta · el cambio salió más caro', color: ROJO, icono: '⚠️', impacto: 'más al mes' },
  cambio_logrado: { etiqueta: 'Logrado · ya lo hicimos', color: VERDE, icono: '✅', impacto: 'de ahorro al mes' },
}

// ── Estilos (scoped por prefijo chq-) ────────────────────────────────
const CSS = `
.chq { max-width: 1100px; width: 100%; min-width: 0; margin: 0 auto; padding: 16px 16px 40px; overflow-wrap: break-word; }
.chq * { min-width: 0; }
.chq-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.chq-h1 { font-size: 22px; font-weight: 800; color: #fff; margin: 0; }
.chq-sub { font-size: 12.5px; color: #888; margin-top: 4px; line-height: 1.5; }
.chq-kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.chq-kpis > :last-child:nth-child(odd) { grid-column: 1 / -1; }
@media (min-width: 760px) { .chq-kpis { grid-template-columns: repeat(5, minmax(0, 1fr)); } .chq-kpis > :last-child:nth-child(odd) { grid-column: auto; } }
.chq-kpi { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 12px 14px; min-width: 0; }
.chq-kpi-l { font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.chq-kpi-v { font-size: 19px; font-weight: 800; margin-top: 4px; color: #fff; overflow-wrap: anywhere; }
.chq-kpi-s { font-size: 11.5px; color: #777; margin-top: 3px; line-height: 1.4; }
.chq-sug { border-left: 4px solid; border-radius: 10px; background: #151515; padding: 10px 12px; margin-bottom: 8px; }
.chq-sug-t { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.chq-sug-m { font-size: 13.5px; color: #ddd; margin-top: 5px; line-height: 1.5; }
.chq-sug-i { font-size: 13px; font-weight: 800; margin-top: 5px; }
.chq-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.chq-tools .inp { flex: 1 1 220px; padding: 10px 14px; font-size: 16px; }
.chq-tbl-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.chq-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.chq-tbl th { text-align: left; font-size: 10.5px; color: #777; text-transform: uppercase; letter-spacing: .4px; padding: 6px 8px; border-bottom: 1px solid #2a2a2a; white-space: nowrap; }
.chq-tbl td { padding: 8px; border-bottom: 1px solid #222; vertical-align: top; color: #ccc; }
.chq-tbl td.n, .chq-tbl th.n { text-align: right; white-space: nowrap; }
.chq-tbl tr.inact td { opacity: .55; }
.chq-row { border-bottom: 1px solid #222; padding: 10px 0; }
.chq-row:last-child { border-bottom: none; }
.chq-row-a { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.chq-row-n { font-weight: 700; color: #eee; font-size: 14px; min-width: 0; overflow-wrap: anywhere; }
.chq-row-v { font-weight: 800; color: #fff; font-size: 14px; white-space: nowrap; }
.chq-row-d { font-size: 12px; color: #999; margin-top: 3px; line-height: 1.5; overflow-wrap: anywhere; }
.chq-tag { display: inline-block; padding: 1px 7px; border-radius: 20px; font-size: 10.5px; font-weight: 700; margin-left: 6px; vertical-align: middle; white-space: nowrap; }
.chq-cambio { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #14532d55; color: #86efac; border: 1px solid #14532d; }
.chq-bars { display: flex; align-items: flex-end; gap: 4px; padding-top: 6px; }
.chq-bar-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
.chq-bar-area { height: 140px; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.chq-bar-v { font-size: 9.5px; color: #888; margin-bottom: 3px; white-space: nowrap; overflow: hidden; max-width: 100%; display: none; }
@media (min-width: 760px) { .chq-bar-v { display: block; } }
.chq-bar-col { cursor: pointer; }
.chq-bar-col.sel .chq-bar { outline: 2px solid #fff; outline-offset: 1px; }
.chq-mes-sel { font-size: 12.5px; color: #ccc; margin-bottom: 4px; line-height: 1.5; }
.chq-bar { width: 100%; max-width: 44px; background: #333; border-radius: 4px 4px 0 0; position: relative; display: flex; align-items: flex-end; }
.chq-bar-in { width: 100%; background: #e63946; border-radius: 4px 4px 0 0; }
.chq-bar-l { font-size: 10px; color: #888; margin-top: 4px; text-align: center; line-height: 1.2; }
.chq-leg { display: flex; gap: 14px; font-size: 11.5px; color: #999; margin-top: 10px; flex-wrap: wrap; }
.chq-leg i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.chq-cat { margin-bottom: 8px; }
.chq-cat-a { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: #ccc; }
.chq-cat-b { height: 7px; background: #222; border-radius: 4px; margin-top: 4px; overflow: hidden; }
.chq-cat-b > div { height: 100%; background: #e63946; border-radius: 4px; }
.chq-err { background: #2a1212; border: 1px solid #7f1d1d; border-radius: 12px; padding: 14px; margin-bottom: 14px; }
.chq-err-m { color: #fca5a5; font-size: 14px; font-weight: 600; line-height: 1.5; }
.chq-pin { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.chq-pin .inp { width: 140px; padding: 10px 12px; text-align: center; }
.chq-more { margin-top: 10px; }
`

// En pantallas anchas: tablas. En el iPhone: tarjetas (una tabla de 8
// columnas no se lee en 390 px).
function useAncho(min = 900) {
  const q = `(min-width: ${min}px)`
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const fn = () => setOk(mq.matches)
    fn()
    mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn)
    return () => (mq.removeEventListener ? mq.removeEventListener('change', fn) : mq.removeListener(fn))
  }, [q])
  return ok
}

const colorVar = (v) => (vacio(v) || Number(v) === 0 ? '#999' : Number(v) > 0 ? ROJO : VERDE)

// ── Pantalla ─────────────────────────────────────────────────────────
export default function ComprasHQView() {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const { data, error: e } = await db.rpc('compras_hq_freakie', { p_token: getTorreToken() })
      if (e) throw e
      if (!data) throw new Error('El servidor no devolvió datos de compras.')
      setDatos(data)
    } catch (e) {
      setDatos(null)
      setError(e?.message || 'No se pudieron cargar las compras.')
    }
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const k = datos?.kpi || {}

  return (
    <div className="chq">
      <style>{CSS}</style>

      {/* 1. Encabezado */}
      <div className="chq-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="chq-h1">🛒 Compras</h1>
          {datos && (
            <div className="chq-sub">
              {datos.empresa_nombre || 'Freakie Dogs'} · Datos al {fechaHoraSV(datos.ultima_sync)}
              {hace(datos.ultima_sync) && <> ({hace(datos.ultima_sync)})</>}
              <br />Última factura: {fecha(datos.ultima_compra)}
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={cargar} disabled={cargando}>
          {cargando ? 'Cargando…' : '↻ Actualizar'}
        </button>
      </div>

      {error && <BannerError mensaje={error} onReintentar={cargar} />}

      {cargando && !datos && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 50 }}>
          <div className="spin" style={{ width: 34, height: 34 }} />
        </div>
      )}

      {datos && (
        <>
          {/* 2. KPIs */}
          <div className="chq-kpis">
            <Kpi l="Gasto este mes" v={dinero(k.gasto_mes_actual)} s={`Mes anterior: ${dinero(k.gasto_mes_anterior)}`} />
            <Kpi
              l="Gasto 30 días" v={dinero(k.gasto_30d)}
              s={`${vacio(k.facturas_30d) ? '—' : k.facturas_30d} facturas · ${vacio(k.proveedores_30d) ? '—' : k.proveedores_30d} proveedores`}
            />
            <Kpi l="Ahorro disponible" v={dinero(k.ahorro_disponible_mensual)} s="al mes, si se cambia de proveedor" c={AZUL} />
            <Kpi l="Ahorro logrado" v={dinero(k.ahorro_logrado_mensual)} s="al mes, por cambios ya hechos" c={VERDE} />
            <Kpi l="Alzas de precio" v={vacio(k.alzas) ? '—' : String(k.alzas)} s="items que subieron" c={Number(k.alzas) > 0 ? ROJO : undefined} />
          </div>

          <Sugerencias lista={datos.sugerencias || []} />
          <Items lista={datos.items || []} pctMapeado={k.pct_mapeado_90d} />
          <GastoPorMes meses={datos.meses || []} />
          <Proveedores lista={datos.proveedores || []} />
          <Recientes lista={datos.recientes || []} />
          <Categorias lista={datos.categorias || []} />
        </>
      )}
    </div>
  )
}

function Kpi({ l, v, s, c }) {
  return (
    <div className="chq-kpi">
      <div className="chq-kpi-l">{l}</div>
      <div className="chq-kpi-v" style={c ? { color: c } : undefined}>{v}</div>
      {s && <div className="chq-kpi-s">{s}</div>}
    </div>
  )
}

// Error del puente, tal cual. Si es de sesión/rol, se ofrece abrir la sesión de
// administración ahí mismo (mismo `erp_admin_sesion` y mismo token compartido
// que usan las otras pantallas de finanzas) y se recarga sin perder la pantalla.
function BannerError({ mensaje, onReintentar }) {
  const esSesion = /sesi[oó]n|solo para administraci/i.test(mensaje)
  const [pin, setPin] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [errPin, setErrPin] = useState('')

  const abrir = async () => {
    if (pin.length < 3 || abriendo) return
    setAbriendo(true); setErrPin('')
    try {
      await abrirSesionFinanzas(pin)
      setPin('')
      onReintentar()
    } catch (e) {
      setErrPin(e.message || 'PIN incorrecto')
      setPin('')
    }
    setAbriendo(false)
  }

  return (
    <div className="chq-err" role="alert">
      <div className="chq-err-m">⚠️ {mensaje}</div>
      {esSesion ? (
        <>
          <div style={{ fontSize: 12.5, color: '#bbb', marginTop: 8 }}>
            Ingresá tu PIN de administración para ver Compras. La sesión dura 30 minutos.
          </div>
          <div className="chq-pin">
            <input
              className="inp" type="password" inputMode="numeric" autoComplete="off" placeholder="Tu PIN"
              value={pin} disabled={abriendo}
              onChange={e => { setErrPin(''); setPin(e.target.value.replace(/\D/g, '').slice(0, 8)) }}
              onKeyDown={e => e.key === 'Enter' && abrir()}
            />
            <button className="btn btn-red btn-sm" onClick={abrir} disabled={pin.length < 3 || abriendo}>
              {abriendo ? 'Verificando…' : 'Abrir sesión'}
            </button>
          </div>
          {errPin && <div style={{ color: ROJO, fontSize: 12.5, marginTop: 8 }}>⚠️ {errPin}</div>}
        </>
      ) : (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={onReintentar}>Reintentar</button>
      )}
    </div>
  )
}

// 3. Sugerencias
function Sugerencias({ lista }) {
  return (
    <div className="card">
      <div className="sec-title">Sugerencias</div>
      {lista.length === 0 ? (
        <div style={{ fontSize: 13.5, color: '#999', padding: '6px 0' }}>
          No hay sugerencias por ahora: no vemos un proveedor más barato ni alzas de precio en lo reciente.
        </div>
      ) : lista.map((s, i) => {
        const t = TIPO_SUG[s.tipo] || { etiqueta: s.tipo, color: '#999', icono: '•', impacto: 'al mes' }
        return (
          <div key={`${s.tipo}-${s.item_id}-${i}`} className="chq-sug" style={{ borderLeftColor: t.color }}>
            <div className="chq-sug-t" style={{ color: t.color }}>
              <span>{t.icono} {t.etiqueta}</span>
              <span style={{ color: '#777', fontWeight: 600 }}>{fecha(s.fecha_ref)}</span>
            </div>
            <div className="chq-sug-m">{s.mensaje || '—'}</div>
            {!vacio(s.impacto_mensual) && (
              <div className="chq-sug-i" style={{ color: t.color }}>≈ {dinero(s.impacto_mensual)} {t.impacto}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Texto de "mejor del grupo" para un item.
function MejorGrupo({ it }) {
  if (vacio(it.mejor_grupo) && vacio(it.mejor_proveedor)) return <span style={{ color: '#777' }}>—</span>
  const mismo = it.mejor_proveedor && it.mejor_proveedor === it.proveedor_actual
  const dif = Number(it.dif_mejor_pct)
  return (
    <span>
      {mismo ? <span style={{ color: VERDE, fontWeight: 600 }}>Tu proveedor es el mejor</span> : (it.mejor_proveedor || '—')}
      {' · '}{precio(it.mejor_grupo, it.unidad_base)}
      {!mismo && !vacio(it.dif_mejor_pct) && dif !== 0 && (
        <span style={{ color: dif > 0 ? AMBAR : VERDE, fontWeight: 700 }}>
          {' · '}{dif > 0 ? `pagás ${pct(dif, false)} más` : `pagás ${pct(Math.abs(dif), false)} menos`}
        </span>
      )}
    </span>
  )
}

function Cambio({ c }) {
  if (!c) return null
  return (
    <div className="chq-cambio">
      Cambió de {c.de || '—'} el {fecha(c.fecha)}
      {!vacio(c.precio_anterior) && <> (antes {precio(c.precio_anterior)})</>}
    </div>
  )
}

// 4. Items
function Items({ lista, pctMapeado }) {
  const ancho = useAncho()
  const [q, setQ] = useState('')
  const [inactivos, setInactivos] = useState(false)
  const [todos, setTodos] = useState(false)
  const nInactivos = useMemo(() => lista.filter(i => i.activo === false).length, [lista])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return lista.filter(i => {
      if (!inactivos && i.activo === false) return false
      if (!t) return true
      return [i.item, i.categoria, i.proveedor_actual, i.mejor_proveedor]
        .some(v => v && String(v).toLowerCase().includes(t))
    })
  }, [lista, q, inactivos])
  // Con 200 items la lista se hace eterna en el iPhone: primero los 40 de más
  // gasto (vienen ordenados así) y un botón para ver el resto. Buscando, todos.
  const LIM = 40
  const visibles = todos || q.trim() ? filtrados : filtrados.slice(0, LIM)

  return (
    <div className="card">
      <div className="sec-title">Items ({filtrados.length})</div>
      <div className="chq-tools">
        <input className="inp" type="search" placeholder="Buscar item, categoría o proveedor…" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className={`chip${inactivos ? ' on' : ''}`} onClick={() => setInactivos(v => !v)}>
          {inactivos ? '✓ ' : ''}Ver inactivos ({nInactivos})
        </button>
      </div>
      {!vacio(pctMapeado) && (
        <div style={{ fontSize: 11.5, color: '#777', marginBottom: 8 }}>
          {pctMapeado}% del gasto de insumos de los últimos 90 días está ligado a un item. Precios sin IVA, por unidad base.
        </div>
      )}

      {filtrados.length === 0 ? (
        <div className="empty"><div className="empty-text">{q ? 'Ningún item coincide con la búsqueda.' : 'No hay items para mostrar.'}</div></div>
      ) : ancho ? (
        <div className="chq-tbl-wrap">
          <table className="chq-tbl">
            <thead>
              <tr>
                <th>Item</th><th>Proveedor actual</th><th className="n">Precio actual</th>
                <th>Última compra</th><th className="n">Var.</th><th>Mejor del grupo</th><th className="n">Gasto / mes</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(it => (
                <tr key={it.item_id} className={it.activo === false ? 'inact' : ''}>
                  <td>
                    <div style={{ fontWeight: 700, color: '#eee' }}>
                      {it.item}
                      {it.activo === false && <span className="chq-tag" style={{ background: '#222', color: '#888' }}>inactivo</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#777' }}>{it.categoria || '—'}</div>
                    <Cambio c={it.cambio} />
                  </td>
                  <td>{it.proveedor_actual || '—'}</td>
                  <td className="n">{precio(it.precio_actual, it.unidad_base)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {fecha(it.ultima_compra)}
                    <div style={{ fontSize: 11, color: '#777' }}>{precio(it.ultimo_precio, it.unidad_base)}</div>
                  </td>
                  <td className="n" style={{ color: colorVar(it.var_pct), fontWeight: 700 }}>{pct(it.var_pct)}</td>
                  <td style={{ maxWidth: 260 }}><MejorGrupo it={it} /></td>
                  <td className="n" style={{ fontWeight: 700, color: '#fff' }}>{dinero(it.gasto_mensual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {visibles.map(it => (
            <div key={it.item_id} className="chq-row" style={it.activo === false ? { opacity: .6 } : undefined}>
              <div className="chq-row-a">
                <div className="chq-row-n">
                  {it.item}
                  {it.activo === false && <span className="chq-tag" style={{ background: '#222', color: '#888' }}>inactivo</span>}
                </div>
                <div className="chq-row-v">{dinero(it.gasto_mensual)}<span style={{ fontSize: 10.5, color: '#777', fontWeight: 600 }}>/mes</span></div>
              </div>
              <div className="chq-row-d">
                {it.categoria || '—'} · {it.proveedor_actual || '—'}
              </div>
              <div className="chq-row-d">
                <span style={{ color: '#eee', fontWeight: 700 }}>{precio(it.precio_actual, it.unidad_base)}</span>
                {' · '}<span style={{ color: colorVar(it.var_pct), fontWeight: 700 }}>{pct(it.var_pct)}</span>
                {' · última compra '}{fecha(it.ultima_compra)}
              </div>
              <div className="chq-row-d">Mejor del grupo: <MejorGrupo it={it} /></div>
              <Cambio c={it.cambio} />
            </div>
          ))}
        </div>
      )}
      {!q.trim() && filtrados.length > LIM && (
        <button className="btn btn-ghost btn-sm chq-more" onClick={() => setTodos(v => !v)}>
          {todos ? 'Ver menos' : `Ver los ${filtrados.length} items`}
        </button>
      )}
    </div>
  )
}

// 5. Gasto por mes (barras a mano: total en gris, insumos en rojo adentro).
// En el iPhone no caben 12 montos encima de las barras: se toca una barra y el
// detalle sale arriba (por defecto, el mes más reciente).
function GastoPorMes({ meses }) {
  const [sel, setSel] = useState(null)
  const max = Math.max(1, ...meses.map(m => Number(m.total) || 0), ...meses.map(m => Number(m.insumos) || 0))
  const iSel = sel === null ? meses.length - 1 : sel
  const mSel = meses[iSel]
  const nombreMes = (mes) => {
    const [y, mo] = String(mes || '').split('-')
    return `${MESES[Number(mo) - 1] || mo || '—'} ${y || ''}`.trim()
  }
  return (
    <div className="card">
      <div className="sec-title">Gasto por mes</div>
      {meses.length === 0 ? (
        <div className="empty"><div className="empty-text">Sin datos de meses.</div></div>
      ) : (
        <>
          {mSel && (
            <div className="chq-mes-sel">
              <b style={{ color: '#fff' }}>{nombreMes(mSel.mes)}</b> · total {dinero(mSel.total)} · insumos {dinero(mSel.insumos)}
            </div>
          )}
          <div className="chq-bars">
            {meses.map((m, i) => {
              const [y, mo] = String(m.mes || '').split('-')
              const tot = Number(m.total) || 0
              const ins = Number(m.insumos) || 0
              const hTot = (tot / max) * 100
              const hIns = tot > 0 ? Math.min(100, (ins / tot) * 100) : 0
              return (
                <div
                  key={m.mes || i} className={`chq-bar-col${i === iSel ? ' sel' : ''}`} onClick={() => setSel(i)}
                  title={`${nombreMes(m.mes)}: total ${dinero(m.total)} · insumos ${dinero(m.insumos)}`}
                >
                  <div className="chq-bar-v">{dineroCorto(m.total)}</div>
                  <div className="chq-bar-area">
                    <div className="chq-bar" style={{ height: `${hTot}%` }}>
                      <div className="chq-bar-in" style={{ height: `${hIns}%` }} />
                    </div>
                  </div>
                  <div className="chq-bar-l">{MESES[Number(mo) - 1] || mo}<br /><span style={{ color: '#555' }}>{(y || '').slice(2)}</span></div>
                </div>
              )
            })}
          </div>
          <div className="chq-leg">
            <span><i style={{ background: '#e63946' }} />Insumos</span>
            <span><i style={{ background: '#333' }} />Total (incluye servicios y otros)</span>
          </div>
        </>
      )}
    </div>
  )
}

// 6. Proveedores
function Proveedores({ lista }) {
  const ancho = useAncho()
  const [todos, setTodos] = useState(false)
  const visibles = todos ? lista : lista.slice(0, 15)
  return (
    <div className="card">
      <div className="sec-title">Proveedores ({lista.length})</div>
      {lista.length === 0 ? (
        <div className="empty"><div className="empty-text">Sin proveedores en el periodo.</div></div>
      ) : ancho ? (
        <div className="chq-tbl-wrap">
          <table className="chq-tbl">
            <thead>
              <tr>
                <th>Proveedor</th><th>Tipo</th><th className="n">Gasto 30 d</th><th className="n">Gasto 90 d</th>
                <th className="n">Facturas 90 d</th><th>Última compra</th><th>Items</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p, i) => (
                <tr key={`${p.nit || p.proveedor}-${i}`}>
                  <td>
                    <div style={{ fontWeight: 700, color: '#eee' }}>{p.proveedor || '—'}</div>
                    {p.nit && <div style={{ fontSize: 11, color: '#666' }}>NIT {p.nit}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{TIPO_PROV[p.tipo] || p.tipo || '—'}</td>
                  <td className="n">{dinero(p.gasto_30d)}</td>
                  <td className="n" style={{ fontWeight: 700, color: '#fff' }}>{dinero(p.gasto_90d)}</td>
                  <td className="n">{vacio(p.facturas_90d) ? '—' : p.facturas_90d}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fecha(p.ultima_compra)}</td>
                  <td style={{ fontSize: 11.5, color: '#999', maxWidth: 280 }}>{p.items || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {visibles.map((p, i) => (
            <div key={`${p.nit || p.proveedor}-${i}`} className="chq-row">
              <div className="chq-row-a">
                <div className="chq-row-n">{p.proveedor || '—'}</div>
                <div className="chq-row-v">{dinero(p.gasto_90d)}<span style={{ fontSize: 10.5, color: '#777', fontWeight: 600 }}> 90 d</span></div>
              </div>
              <div className="chq-row-d">
                {TIPO_PROV[p.tipo] || p.tipo || '—'} · 30 d: {dinero(p.gasto_30d)} · {vacio(p.facturas_90d) ? '—' : p.facturas_90d} facturas · última {fecha(p.ultima_compra)}
              </div>
              {p.items && <div className="chq-row-d" style={{ color: '#777' }}>{p.items}</div>}
            </div>
          ))}
        </div>
      )}
      {lista.length > 15 && (
        <button className="btn btn-ghost btn-sm chq-more" onClick={() => setTodos(v => !v)}>
          {todos ? 'Ver menos' : `Ver los ${lista.length}`}
        </button>
      )}
    </div>
  )
}

// 7. Compras recientes
function Recientes({ lista }) {
  const [todos, setTodos] = useState(false)
  const visibles = todos ? lista : lista.slice(0, 25)
  return (
    <div className="card">
      <div className="sec-title">Compras recientes</div>
      {lista.length === 0 ? (
        <div className="empty"><div className="empty-text">Sin compras recientes.</div></div>
      ) : (
        <div>
          {visibles.map((r, i) => {
            const u = UNIDAD_MH[String(r.unidad)]
            return (
              <div key={r.id ?? i} className="chq-row">
                <div className="chq-row-a">
                  <div className="chq-row-n" style={{ fontSize: 13 }}>{r.descripcion || '—'}</div>
                  <div className="chq-row-v" style={{ fontSize: 13 }}>{dinero(r.monto_sin_iva)}</div>
                </div>
                <div className="chq-row-d">
                  {fecha(r.fecha)} · {r.proveedor || '—'}
                  {!vacio(r.cantidad) && <> · {NUM.format(Number(r.cantidad))}{u ? ` ${u}` : ''}</>}
                </div>
                <div className="chq-row-d">
                  {r.item ? <span style={{ color: '#bbb' }}>Item: {r.item}</span> : <span style={{ color: '#666' }}>Sin item asignado</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {lista.length > 25 && (
        <button className="btn btn-ghost btn-sm chq-more" onClick={() => setTodos(v => !v)}>
          {todos ? 'Ver menos' : `Ver las ${lista.length}`}
        </button>
      )}
      <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>Montos sin IVA.</div>
    </div>
  )
}

// 8. Categorías (90 días)
function Categorias({ lista }) {
  const total = lista.reduce((s, c) => s + (Number(c.gasto_90d) || 0), 0)
  const max = Math.max(1, ...lista.map(c => Number(c.gasto_90d) || 0))
  return (
    <div className="card">
      <div className="sec-title">Categorías · últimos 90 días</div>
      {lista.length === 0 ? (
        <div className="empty"><div className="empty-text">Sin datos por categoría.</div></div>
      ) : lista.map(c => {
        const v = Number(c.gasto_90d) || 0
        return (
          <div key={c.categoria} className="chq-cat">
            <div className="chq-cat-a">
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{c.categoria || '—'}</span>
              <span style={{ whiteSpace: 'nowrap' }}>
                <b style={{ color: '#fff' }}>{dinero(c.gasto_90d)}</b>
                <span style={{ color: '#777' }}> · {total > 0 ? pct((v / total) * 100, false) : '—'}</span>
              </span>
            </div>
            <div className="chq-cat-b"><div style={{ width: `${(v / max) * 100}%` }} /></div>
          </div>
        )
      })}
      <div style={{ fontSize: 11, marginTop: 8, color: tokens.textMuted }}>Montos sin IVA.</div>
    </div>
  )
}
