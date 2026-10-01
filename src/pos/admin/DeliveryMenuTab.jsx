import { useState, useEffect, useCallback, useMemo } from 'react'
import { db } from '../../supabase'

/* ================================================================
   DeliveryMenuTab — el menú de delivery COMO LO VE EL CLIENTE

   Por qué existe: los problemas que reporta Karina (una opción que no
   debería ofrecerse, un precio viejo, dos opciones que chocan entre sí)
   hasta ahora se arreglaban tocando código. Acá se arreglan como dato:
   ella abre el combo, ve exactamente los grupos y opciones que le salen
   al cliente, y apaga, corrige o declara el choque.

   Lo que NO hace, a propósito: crear grupos, borrar opciones, mover
   componentes de un combo. Eso sigue en las otras pestañas, que son las
   que pueden romper el menú.
   ================================================================ */

const C = {
  bg: '#141418', surface: '#1c1c22', card: '#1e1e26',
  accent: '#E62329', teal: '#2dd4a8', text: '#e8e6ef',
  muted: '#8b8997', border: '#2a2a32', danger: '#f87171', azul: '#60a5fa',
}

const toast = (msg, ok = true) => {
  const d = document.createElement('div')
  d.textContent = msg
  Object.assign(d.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: ok ? C.teal : C.danger, color: ok ? '#0d2818' : '#fff',
    padding: '10px 20px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
    zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,.4)', maxWidth: '90vw', textAlign: 'center',
  })
  document.body.appendChild(d)
  setTimeout(() => d.remove(), 3000)
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`

export default function DeliveryMenuTab({ user }) {
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busca, setBusca] = useState('')
  const [abierto, setAbierto] = useState(null)   // item id

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error: e } = await db.rpc('fn_menu_delivery_items', { p_actor: user?.id })
    if (e) { setError(e.message); setCargando(false); return }
    setItems(data || [])
    setError(null)
    setCargando(false)
  }, [user?.id])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return items.filter(i => !q || i.nombre.toLowerCase().includes(q))
  }, [items, busca])

  const porCategoria = useMemo(() => {
    const m = new Map()
    filtrados.forEach(i => {
      if (!m.has(i.categoria)) m.set(i.categoria, [])
      m.get(i.categoria).push(i)
    })
    return [...m.entries()]
  }, [filtrados])

  if (cargando) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>

  if (error) return (
    <div style={{ background: '#2a1a1a', border: `1px solid ${C.danger}`, borderRadius: 10, padding: 16, color: C.danger, fontSize: 13 }}>
      {error}
    </div>
  )

  if (abierto) {
    return <DetalleItem itemId={abierto} user={user} onBack={() => { setAbierto(null); cargar() }} />
  }

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Menú de delivery — lo que ve el cliente</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
        Abrí un combo y vas a ver los mismos grupos de opciones que le salen a la gente en la web.
        Desde acá podés <b>apagar una opción</b> que no debería ofrecerse, <b>corregir un precio</b> y
        <b> avisar que dos opciones chocan</b> (que no se puedan elegir juntas). Los cambios entran en
        el próximo pedido, sin esperar a nadie.
      </div>

      <input
        value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="🔍 Buscar combo o producto..."
        style={{ ...inputStyle, marginBottom: 14, maxWidth: 360 }}
      />

      {porCategoria.map(([cat, arr]) => (
        <div key={cat} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 8 }}>{cat}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            {arr.map(i => (
              <button key={i.id} onClick={() => setAbierto(i.id)}
                style={{
                  textAlign: 'left', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                  padding: 12, cursor: 'pointer', color: C.text, opacity: i.disponible ? 1 : .5,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{i.nombre}</span>
                  <span style={{ fontWeight: 700, color: C.teal, fontSize: 14 }}>{money(i.precio)}</span>
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  {Number(i.opciones) > 0 ? `${i.opciones} opciones que el cliente puede elegir` : 'Sin opciones'}
                  {!i.disponible && ' · pausado'}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {filtrados.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: C.muted }}>Nada con ese nombre.</div>}
    </div>
  )
}

/* ================================================================
   Detalle de un ítem
   ================================================================ */
// Nombres de los menús activos, fuera de delivery, que tienen el grupo de esta
// opción asignado a algún ítem. Si la consulta falla se devuelve vacío: el aviso
// es una ayuda, no debe impedir trabajar.
async function menusQueUsan(modificadorId) {
  try {
    const { data: mod } = await db.from('pos_modificadores').select('grupo_id').eq('id', modificadorId).maybeSingle()
    if (!mod?.grupo_id) return []
    const { data: asig } = await db.from('pos_item_modificadores').select('menu_item_id').eq('grupo_id', mod.grupo_id)
    const itemIds = [...new Set((asig || []).map(a => a.menu_item_id))]
    if (!itemIds.length) return []
    const { data: items } = await db.from('pos_menu_items').select('menu_id').in('id', itemIds)
    const menuIds = [...new Set((items || []).map(i => i.menu_id))]
    if (!menuIds.length) return []
    const { data: menus } = await db.from('pos_menus').select('nombre, canal, activo').in('id', menuIds)
    return (menus || []).filter(m => m.activo && m.canal !== 'delivery_propio').map(m => m.nombre).sort()
  } catch {
    return []
  }
}

function DetalleItem({ itemId, user, onBack }) {
  const [d, setD] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(null)   // modificador id
  const [nuevaRegla, setNuevaRegla] = useState(null) // {a, b, motivo, solo}

  const cargar = useCallback(async () => {
    const { data, error: e } = await db.rpc('fn_menu_delivery_detalle', { p_actor: user?.id, p_item: itemId })
    if (e) { setError(e.message); setCargando(false); return }
    setD(data); setError(null); setCargando(false)
  }, [itemId, user?.id])

  useEffect(() => { cargar() }, [cargar])

  const guardarOpcion = async (mod, campos) => {
    // Las opciones son compartidas: la misma "Coca-Cola 300ml" sale en delivery y
    // en las cajas. El 30-sep se apagaron bebidas y agrandados desde acá y las
    // cajas vendieron 53 combos sin bebida entre 16:58 y 18:41. Si la opción
    // también la usa otro menú, se avisa antes de apagarla o cambiarle el precio.
    if (campos.activo === false || campos.precio != null) {
      const otros = await menusQueUsan(mod.id)
      if (otros.length) {
        const que = campos.activo === false ? 'Apagar' : 'Cambiar el precio de'
        const ok = window.confirm(
          `${que} «${mod.nombre}» NO es solo para delivery.\n\n` +
          `Esta opción también la usan: ${otros.join(', ')}.\n` +
          `El cambio pega en esas cajas en este mismo momento.\n\n¿Seguir de todos modos?`)
        if (!ok) return
      }
    }
    setGuardando(mod.id)
    const { error: e } = await db.rpc('fn_menu_opcion_guardar', {
      p_actor: user?.id, p_modificador: mod.id,
      p_activo: campos.activo ?? null,
      p_precio: campos.precio ?? null,
    })
    setGuardando(null)
    if (e) { toast(e.message, false); return }
    toast(campos.activo === false ? `«${mod.nombre}» ya no se ofrece` : 'Guardado')
    cargar()
  }

  const guardarRegla = async () => {
    const r = nuevaRegla
    if (!r?.a || !r?.b) { toast('Elegí las dos opciones que chocan', false); return }
    const { error: e } = await db.rpc('fn_menu_regla_guardar', {
      p_actor: user?.id, p_a: r.a, p_b: r.b,
      p_item: r.solo ? itemId : null,
      p_motivo: r.motivo || null,
    })
    if (e) { toast(e.message, false); return }
    setNuevaRegla(null)
    toast('Listo: ya no se van a poder elegir juntas')
    cargar()
  }

  const quitarRegla = async (id) => {
    const { error: e } = await db.rpc('fn_menu_regla_quitar', { p_actor: user?.id, p_regla: id })
    if (e) { toast(e.message, false); return }
    toast('Regla quitada'); cargar()
  }

  if (cargando) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>
  if (error) return <div style={{ color: C.danger, padding: 16 }}>{error}<div><button onClick={onBack} style={smallBtn}>← Volver</button></div></div>

  const item = d?.item || {}
  const grupos = d?.grupos || []
  const reglas = d?.reglas || []

  // Todas las opciones del ítem, para los dos selectores de la regla
  const todas = grupos.flatMap(g => (g.opciones || []).map(o => ({ ...o, _grupo: g.nombre, _seccion: g.seccion })))

  return (
    <div>
      <button onClick={onBack} style={{ ...smallBtn, marginBottom: 14 }}>← Volver al menú</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{item.nombre}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.teal }}>{money(item.precio)}</div>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
        Así se le arma el pedido al cliente, grupo por grupo.
      </div>

      {/* ── Reglas vigentes ── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>⚠️ Opciones que no pueden ir juntas</div>
          {!nuevaRegla && (
            <button onClick={() => setNuevaRegla({ a: '', b: '', motivo: '', solo: true })} style={{ ...smallBtn, color: C.azul, borderColor: C.azul }}>
              + Avisar de un choque
            </button>
          )}
        </div>

        {reglas.length === 0 && !nuevaRegla && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            Ninguna por ahora. Si ves que el cliente puede elegir dos cosas que se pisan
            (por ejemplo dos bebidas donde va una sola), avisalo acá.
          </div>
        )}

        {reglas.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ flex: 1, fontSize: 13 }}>
              <b>{r.a_nombre}</b> <span style={{ color: C.muted }}>no va con</span> <b>{r.b_nombre}</b>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {r.solo_este_item ? 'Solo en este combo' : 'En todo el menú'}
                {r.motivo && ` · ${r.motivo}`}
                {r.creado_nombre && ` · lo puso ${r.creado_nombre}`}
              </div>
            </div>
            <button onClick={() => quitarRegla(r.id)} style={{ ...smallBtn, color: C.danger }}>Quitar</button>
          </div>
        ))}

        {nuevaRegla && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={labelStyle}>Esta opción…</label>
                <SelectorOpcion todas={todas} value={nuevaRegla.a} onChange={v => setNuevaRegla(p => ({ ...p, a: v }))} />
              </div>
              <div style={{ color: C.muted, fontSize: 12, paddingBottom: 10 }}>no va con</div>
              <div>
                <label style={labelStyle}>…esta otra</label>
                <SelectorOpcion todas={todas} value={nuevaRegla.b} onChange={v => setNuevaRegla(p => ({ ...p, b: v }))} />
              </div>
            </div>
            <label style={labelStyle}>¿Por qué? (para que después se entienda)</label>
            <input value={nuevaRegla.motivo} onChange={e => setNuevaRegla(p => ({ ...p, motivo: e.target.value }))}
              style={inputStyle} placeholder="Ej: el combo trae una sola bebida" />
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={nuevaRegla.solo} onChange={e => setNuevaRegla(p => ({ ...p, solo: e.target.checked }))} />
              Solo en este combo (destildalo si pasa en todo el menú)
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={guardarRegla} style={btnStyle(C.teal, '#0d2818')}>Guardar regla</button>
              <button onClick={() => setNuevaRegla(null)} style={btnStyle(C.border, C.muted)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Grupos ── */}
      {grupos.map((g, gi) => {
        const abreSeccion = gi === 0 || grupos[gi - 1].seccion !== g.seccion
        return (
          <div key={g.id}>
            {abreSeccion && (
              <div style={{ fontSize: 11, color: C.accent, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, margin: '18px 0 8px' }}>
                {g.seccion}
              </div>
            )}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                {g.nombre}
                <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{(g.opciones || []).length} opciones</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(g.opciones || []).map(o => (
                  <FilaOpcion key={o.id} o={o} guardando={guardando === o.id} onGuardar={guardarOpcion} />
                ))}
              </div>
            </div>
          </div>
        )
      })}
      {grupos.length === 0 && (
        <div style={{ textAlign: 'center', padding: 24, color: C.muted }}>
          Este producto no tiene opciones para elegir.
        </div>
      )}
    </div>
  )
}

function SelectorOpcion({ todas, value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>
      <option value="">— Elegir —</option>
      {todas.map(o => (
        <option key={o.id} value={o.id}>{o.seccion || o._seccion} · {o._grupo} · {o.nombre}</option>
      ))}
    </select>
  )
}

function FilaOpcion({ o, guardando, onGuardar }) {
  const [editando, setEditando] = useState(false)
  const [precio, setPrecio] = useState(String(Number(o.precio_extra) || 0))

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
      background: o.activo ? 'transparent' : '#2a1a1a', opacity: o.activo ? 1 : .7,
    }}>
      <div style={{ flex: 1, fontSize: 13, textDecoration: o.activo ? 'none' : 'line-through' }}>{o.nombre}</div>

      {editando ? (
        <>
          <input type="number" step="0.01" value={precio} onChange={e => setPrecio(e.target.value)} autoFocus
            style={{ ...inputStyle, width: 90, padding: '4px 8px' }} />
          <button onClick={() => { onGuardar(o, { precio: Number(precio) || 0 }); setEditando(false) }} style={{ ...smallBtn, color: C.teal }}>Guardar</button>
          <button onClick={() => { setPrecio(String(Number(o.precio_extra) || 0)); setEditando(false) }} style={smallBtn}>✕</button>
        </>
      ) : (
        <>
          <button onClick={() => setEditando(true)} title="Cambiar el precio"
            style={{ ...smallBtn, minWidth: 66, color: Number(o.precio_extra) > 0 ? C.teal : C.muted }}>
            {Number(o.precio_extra) > 0 ? `+${money(o.precio_extra)}` : 'gratis'}
          </button>
          <button disabled={guardando} onClick={() => onGuardar(o, { activo: !o.activo })}
            title={o.activo ? 'Dejar de ofrecer esta opción' : 'Volver a ofrecerla'}
            style={{
              ...smallBtn, minWidth: 92, fontSize: 11,
              background: o.activo ? '#0d2818' : '#2a1a1a',
              color: o.activo ? C.teal : C.danger,
            }}>
            {guardando ? '…' : (o.activo ? 'Se ofrece' : 'Apagada')}
          </button>
        </>
      )}
    </div>
  )
}

const inputStyle = { background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' }
const labelStyle = { display: 'block', fontSize: 11, color: C.muted, marginBottom: 4, marginTop: 8, fontWeight: 600 }
const smallBtn = { background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 12 }
const btnStyle = (bg, color) => ({ background: bg, color, border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' })
