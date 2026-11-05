/* ═══════════════════════════════════════════════════════════════════════
   Mi Desempeño — cada persona ve SOLO lo suyo

   Meseros, cajeras, cocina y domicilios. La RPC fn_mi_desempeno toma la persona
   y la sucursal del usuario (no del cliente): no se puede pedir la de otro.
   Para compararse se muestra el promedio de la sucursal, nunca a un compañero.
   Admin/gerencia ven a todos en «Desempeño Meseros».
   ═══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', warn: '#fbbf24', bad: '#f87171', acc: '#60a5fa',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 12 }
const btn = (on) => ({ padding: '7px 12px', borderRadius: 8, border: `1px solid ${on ? C.acc : C.line}`, background: on ? '#13233a' : 'transparent', color: on ? C.acc : C.txt, cursor: 'pointer', fontSize: 13, fontWeight: 600 })
const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ORDEN = ['Combos', 'Individuales', 'Bebidas', 'Cervezas', 'Fries & Sides', 'Extras', 'Ingredientes extra']

const hoySV = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10)
const finde = (iso) => { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 5 || d === 6 || d === 0 }
function rango(p) {
  const hoy = hoySV(); const [y, m] = hoy.split('-').map(Number)
  if (p === 'anterior') return [new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)]
  return [`${hoy.slice(0, 7)}-01`, hoy]
}

function Barra({ v, alto = 10 }) {
  const col = v == null ? C.line : v >= 100 ? C.ok : v >= 80 ? C.warn : C.bad
  return (
    <div style={{ height: alto, background: C.line, borderRadius: alto, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, v || 0)}%`, background: col, transition: 'width .4s' }} />
    </div>
  )
}

export default function MiDesempeno({ user }) {
  const [periodo, setPeriodo] = useState('mes')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(null)
  const [prop, setProp] = useState(null)
  const [desde, hasta] = rango(periodo)

  useEffect(() => {
    db.rpc('fn_mi_propina', { p_usuario_id: user.id, p_mes: desde }).then(({ data }) => setProp(data || null))
  }, [user.id, desde])

  useEffect(() => {
    setCargando(true); setError('')
    db.rpc('fn_mi_desempeno', { p_usuario_id: user.id, p_desde: desde, p_hasta: hasta })
      .then(({ data, error: e }) => { if (e) setError(e.message); else setD(data); setCargando(false) })
  }, [user.id, desde, hasta])

  const r = useMemo(() => {
    if (!d) return null
    const dias = d.dias || []
    const sum = (k) => dias.reduce((s, x) => s + Number(x[k] || 0), 0)
    const cuentas = sum('cuentas'), personas = sum('personas'), venta = sum('venta'), extras = sum('extras'), conExtra = sum('con_extra')
    const conMeta = dias.filter(x => x.meta_dia != null)
    const meta = conMeta.reduce((s, x) => s + Number(x.meta_dia), 0)
    const base = d.unidad === 'persona' ? (personas || cuentas) : cuentas
    const hoy = dias.find(x => x.dia === hoySV())
    const eq = d.equipo || []
    const eqConMeta = eq.filter(x => x.meta_dia != null)
    const eqMeta = eqConMeta.reduce((s, x) => s + Number(x.meta_dia), 0)
    const eqExt = eq.reduce((s, x) => s + Number(x.extras), 0)
    const dom = d.domicilios || null
    const domPed = dom ? dom.reduce((s, x) => s + Number(x.pedidos), 0) : 0
    const domMeta = dom ? dom.filter(x => x.meta_dia != null && x.dia <= hoySV()).reduce((s, x) => s + Number(x.meta_dia), 0) : 0
    const grupos = {}
    for (const i of d.items || []) {
      if (!grupos[i.grupo]) grupos[i.grupo] = { grupo: i.grupo, cantidad: 0, monto: 0, items: [] }
      grupos[i.grupo].cantidad += Number(i.cantidad); grupos[i.grupo].monto += Number(i.monto); grupos[i.grupo].items.push(i)
    }
    const o = (g) => { const k = ORDEN.indexOf(g); return k < 0 ? 99 : k }
    return {
      dias, cuentas, personas, venta, extras, base,
      pctConExtra: cuentas ? conExtra / cuentas * 100 : null,
      ventaProm: base ? venta / base : null, extrasProm: base ? extras / base : null,
      meta: conMeta.length ? meta : null, cumpl: conMeta.length && meta > 0 ? extras / meta * 100 : null,
      hoy, eqMeta: eqConMeta.length ? eqMeta : null, eqExt, eqCumpl: eqConMeta.length && eqMeta > 0 ? eqExt / eqMeta * 100 : null,
      dom, domPed, domMeta, domCumpl: domMeta > 0 ? domPed / domMeta * 100 : null,
      grupos: Object.values(grupos).sort((a, b) => o(a.grupo) - o(b.grupo)),
    }
  }, [d])

  const esCocina = ['cocina', 'produccion'].includes(user?.rol)
  const esDom = user?.rol === 'domicilios'
  const u = d?.unidad === 'persona' ? 'persona' : 'ticket'
  const suc = d?.sucursal || {}
  const sucVenta = u === 'persona' ? suc.venta_persona : suc.venta_ticket
  const sucExtras = u === 'persona' ? suc.extras_persona : suc.extras_ticket

  return (
    <div style={{ background: C.bg, color: C.txt, minHeight: '100%', padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 2px', fontSize: 22 }}>Mi Desempeño</h2>
      <p style={{ margin: '0 0 12px', color: C.dim, fontSize: 13 }}>Tus números, {d?.nombre || user?.nombre}. Solo vos los ves (y la gerencia).</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button style={btn(periodo === 'mes')} onClick={() => setPeriodo('mes')}>Este mes</button>
        <button style={btn(periodo === 'anterior')} onClick={() => setPeriodo('anterior')}>Mes anterior</button>
      </div>

      {error && <div style={{ ...card, borderColor: C.bad, color: C.bad }}>{error}</div>}
      {cargando && <div style={{ color: C.dim }}>Cargando…</div>}
      {!cargando && d && !d.tiene_programa && !esDom && (
        <div style={{ ...card, color: C.dim }}>Tu sucursal todavía no tiene metas de extras. Igual podés ver lo que vendiste.</div>
      )}

      {!cargando && prop?.resumen && <TarjetaPropina p={prop} />}

      {!cargando && r && (
        <>
          {/* ── Meta del mes ── */}
          {esDom ? (
            <div style={card}>
              <div style={{ color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Domicilios del mes</div>
              <div style={{ fontSize: 34, fontWeight: 800, margin: '4px 0' }}>{r.domPed}{r.domMeta ? <span style={{ fontSize: 16, color: C.dim, fontWeight: 400 }}> de {r.domMeta}</span> : null}</div>
              <Barra v={r.domCumpl} alto={12} />
              <div style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>{r.domCumpl == null ? 'Todavía no hay meta cargada.' : `${Math.round(r.domCumpl)} % de la meta a hoy`}</div>
            </div>
          ) : esCocina ? (
            <div style={card}>
              <div style={{ color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Meta del equipo · extras de la sucursal</div>
              <div style={{ fontSize: 34, fontWeight: 800, margin: '4px 0' }}>{money(r.eqExt)}{r.eqMeta ? <span style={{ fontSize: 16, color: C.dim, fontWeight: 400 }}> de {money(r.eqMeta)}</span> : null}</div>
              <Barra v={r.eqCumpl} alto={12} />
              <div style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>{r.eqCumpl == null ? 'Todavía no hay meta cargada.' : `${Math.round(r.eqCumpl)} % · cocina cumple si la sucursal llega al 100 %`}</div>
            </div>
          ) : (
            <div style={card}>
              <div style={{ color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tus extras del mes</div>
              <div style={{ fontSize: 34, fontWeight: 800, margin: '4px 0' }}>{money(r.extras)}{r.meta ? <span style={{ fontSize: 16, color: C.dim, fontWeight: 400 }}> de {money(r.meta)}</span> : null}</div>
              <Barra v={r.cumpl} alto={12} />
              <div style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>
                {r.cumpl == null ? 'Todavía no hay meta cargada: estamos midiendo.' : `${Math.round(r.cumpl)} % de tu meta (suma de la meta de los ${r.dias.length} días que trabajaste)`}
              </div>
              {r.hoy && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Hoy {finde(r.hoy.dia) ? '(V–D)' : '(L–J)'}</span>
                    <b>{money(r.hoy.extras)}{r.hoy.meta_dia != null && <span style={{ color: C.dim, fontWeight: 400 }}> / {money(r.hoy.meta_dia)}</span>}</b>
                  </div>
                  {r.hoy.meta_dia != null && <div style={{ marginTop: 6 }}><Barra v={Number(r.hoy.extras) / Number(r.hoy.meta_dia) * 100} /></div>}
                </div>
              )}
            </div>
          )}

          {/* ── Promedios vs sucursal ── */}
          {!esDom && r.cuentas > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
              <Mini titulo={`Venta por ${u}`} v={money(r.ventaProm)} suc={money(sucVenta)} mejor={r.ventaProm >= Number(sucVenta || 0)} />
              <Mini titulo={`Extras por ${u}`} v={money(r.extrasProm)} suc={money(sucExtras)} mejor={r.extrasProm >= Number(sucExtras || 0)} />
              <Mini titulo="Cuentas con extra" v={r.pctConExtra == null ? '—' : `${Math.round(r.pctConExtra)}%`} suc={suc.pct_con_extra == null ? '—' : `${Math.round(suc.pct_con_extra)}%`} mejor={r.pctConExtra >= Number(suc.pct_con_extra || 0)} />
              <Mini titulo={u === 'persona' ? 'Personas atendidas' : 'Tickets'} v={u === 'persona' ? r.personas : r.cuentas} />
            </div>
          )}

          {/* ── Qué vendí ── */}
          {r.grupos.length > 0 && (
            <div style={card}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Qué vendiste</h3>
              {r.grupos.map(g => (
                <div key={g.grupo} style={{ borderTop: `1px solid ${C.line}` }}>
                  <button onClick={() => setAbierto(abierto === g.grupo ? null : g.grupo)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none', color: C.txt, padding: '10px 0', cursor: 'pointer', fontSize: 14 }}>
                    <span>{abierto === g.grupo ? '▾' : '▸'} <b>{g.grupo}</b></span>
                    <span><b>{g.cantidad}</b> <span style={{ color: C.dim, fontSize: 12 }}>· {(g.cantidad / (r.base || 1) * 10).toFixed(1)} c/10 {u === 'persona' ? 'personas' : 'tickets'}</span></span>
                  </button>
                  {abierto === g.grupo && (
                    <div style={{ paddingBottom: 10 }}>
                      {g.items.sort((a, b) => b.cantidad - a.cantidad).map(i => (
                        <div key={i.item} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0 2px 16px', gap: 8 }}>
                          <span>{i.item}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{i.cantidad} <span style={{ color: C.dim }}>· {money(i.monto)}</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <p style={{ color: C.dim, fontSize: 12, marginBottom: 0 }}>«c/10» = cuántos vendés por cada 10 {u === 'persona' ? 'personas que atendés' : 'tickets'}. Subí bebidas, papas y tocino para llegar a la meta.</p>
            </div>
          )}

          {/* ── Por día ── */}
          {!esDom && !esCocina && r.dias.length > 0 && (
            <div style={card}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Día por día</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
                {r.dias.map(x => {
                  const ok = x.meta_dia == null ? null : Number(x.extras) >= Number(x.meta_dia)
                  return (
                    <div key={x.dia} style={{ border: `1px solid ${ok == null ? C.line : ok ? C.ok : C.bad}`, borderRadius: 8, padding: '6px 8px', fontSize: 12 }}>
                      <div style={{ color: C.dim }}>{x.dia.slice(8)}/{x.dia.slice(5, 7)} {finde(x.dia) ? 'V–D' : ''}</div>
                      <b>{money(x.extras)}</b>
                      {x.meta_dia != null && <div style={{ color: C.dim }}>meta {money(x.meta_dia)}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!esDom && r.cuentas === 0 && !esCocina && <div style={{ ...card, color: C.dim }}>No hay ventas a tu nombre en este período. Si atendiste mesas, pedí que te elijan en «Atiende» del POS.</div>}
        </>
      )}
    </div>
  )
}

function Mini({ titulo, v, suc, mejor }) {
  return (
    <div style={{ ...card, marginBottom: 0, padding: 12 }}>
      <div style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, margin: '2px 0', color: suc == null ? C.txt : mejor ? C.ok : C.txt }}>{v}</div>
      {suc != null && <div style={{ color: C.dim, fontSize: 12 }}>Sucursal: {suc}</div>}
    </div>
  )
}

const AJ = { falta_leve: ['Falta leve', C.warn], falta_moderada: ['Falta moderada', '#fb923c'], falta_grave: ['Falta grave', C.bad], premio: ['Premio', C.ok] }
function TarjetaPropina({ p }) {
  const r = p.resumen
  const final = Number(r.pct_final)
  const col = final >= 100 ? C.ok : final >= 75 ? C.warn : C.bad
  const fmt = (n) => `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('es', { maximumFractionDigits: 1 })}%`
  const meta = r.ambito === 'equipo' ? 'la meta del equipo' : r.ambito === 'domicilios' ? 'tu meta de domicilios' : 'tu meta de extras'
  return (
    <div style={{ ...card, borderColor: col }}>
      <div style={{ color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tu propina este mes</div>
      <div style={{ fontSize: 40, fontWeight: 800, color: col, lineHeight: 1.1, margin: '4px 0 8px' }}>{final.toLocaleString('es', { maximumFractionDigits: 1 })}%</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '4px 0' }}>
        <span>Base {r.sin_meta ? '(todavía sin meta)' : Number(r.cumplimiento) >= 100 ? `(cumplís ${meta})` : `(vas en ${Math.round(Number(r.cumplimiento))}% de ${meta})`}</span>
        <b>{Number(r.base_pct)}%</b>
      </div>
      {p.ajustes.map((a, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '4px 0', borderTop: `1px solid ${C.line}` }}>
          <span><b style={{ color: AJ[a.tipo]?.[1] }}>{AJ[a.tipo]?.[0]}</b> · {a.fecha.slice(8)}/{a.fecha.slice(5, 7)} <span style={{ color: C.dim }}>· {a.motivo}</span></span>
          <b style={{ color: AJ[a.tipo]?.[1], whiteSpace: 'nowrap' }}>{fmt(a.pct)}</b>
        </div>
      ))}
      <p style={{ color: C.dim, fontSize: 12, margin: '8px 0 0' }}>
        Cumplir la meta del mes = 100 % de tu parte; si no, 50 %. Cada falta resta (leve 2.5 %, moderada 5 %, grave 10 %) y los premios suman. Se calcula hasta ayer.
      </p>
    </div>
  )
}
