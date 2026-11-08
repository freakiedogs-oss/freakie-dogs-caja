/* ═══════════════════════════════════════════════════════════════════════
   Clientes Domicilio — recontactar clientes por WhatsApp + meta de pedidos

   Pedido de Jazz (M001) para Karina. Plan: docs/planes/PLAN_desempeno_meseros_y_domicilios.md
   - Lista agrupada por teléfono desde delivery_clientes (pedidos entregados).
   - Botón WhatsApp: registra el contacto y abre wa.me con la plantilla.
     La imagen la adjunta quien envía desde su teléfono.
   - «Volvió»: el cliente pidió en los 7 días siguientes al contacto.
   - «No escribir más»: lista de exclusión permanente.
   - Sin exportar a Excel: son datos personales, se trabajan uno por uno.
   ═══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', warn: '#fbbf24', bad: '#f87171', acc: '#60a5fa', wa: '#25d366',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 12 }
const btn = (on, col = C.acc) => ({ padding: '7px 12px', borderRadius: 8, border: `1px solid ${on ? col : C.line}`, background: on ? '#13233a' : 'transparent', color: on ? col : C.txt, cursor: 'pointer', fontSize: 13, fontWeight: 600 })
const money = (n) => '$' + Number(n || 0).toFixed(2)

const SEGMENTOS = [
  ['dormido', 'Dormidos', 'Pidieron antes y no han vuelto en más de 21 días'],
  ['nuevo', 'Nuevos', 'Primer pedido en los últimos 14 días'],
  ['frecuente', 'Frecuentes', '3 o más pedidos'],
  ['vip', 'VIP', '7 o más pedidos'],
  ['ocasional', 'Ocasionales', 'El resto'],
]
const SUPERVISAN = ['admin', 'ejecutivo', 'superadmin']
const SUCURSALES = [['M001', 'Cafetalón'], ['S003', 'Lourdes'], ['S004', 'Venecia'], ['S001', 'Soyapango'], ['S002', 'Usulután'], ['S006', 'Metrocentro']]

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

const hoySV = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10)
const esFinde = (iso) => { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 5 || d === 6 || d === 0 }
const telBonito = (t) => `${t.slice(0, 4)}-${t.slice(4)}`
const primerNombre = (n) => (n || '').trim().split(/\s+/)[0] || ''

function armarMensaje(texto, c) {
  return (texto || '')
    .replaceAll('{nombre}', primerNombre(c.nombre) || 'amigo')
    .replaceAll('{favorito}', c.favorito || 'burger favorita')
}

export default function ClientesDomicilioView({ user }) {
  const supervisa = SUPERVISAN.includes(user?.rol)
  const [store, setStore] = useState(supervisa ? 'M001' : (user?.store_code || 'M001'))
  const [clientes, setClientes] = useState([])
  const [avance, setAvance] = useState([])
  const [plantillas, setPlantillas] = useState([])
  const [plantillaId, setPlantillaId] = useState('')
  const [editando, setEditando] = useState(null)
  const [seg, setSeg] = useState('dormido')
  const [q, setQ] = useState('')
  const [limite, setLimite] = useState(40)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    const hoy = hoySV()
    try {
      const [c1, r2, r3] = await Promise.all([
        rpcTodo('fn_clientes_delivery', { p_usuario_id: user.id, p_store: store }),
        db.rpc('fn_domicilios_avance', { p_usuario_id: user.id, p_store: store, p_desde: `${hoy.slice(0, 7)}-01`, p_hasta: hoy }),
        db.rpc('fn_crm_plantillas', { p_usuario_id: user.id, p_store: store }),
      ])
      for (const r of [r2, r3]) if (r.error) throw r.error
      setClientes(c1)
      setAvance(r2.data || [])
      setPlantillas(r3.data || [])
      setPlantillaId(p => p || r3.data?.[0]?.id || '')
    } catch (e) { setError(e.message || String(e)) } finally { setCargando(false) }
  }, [user.id, store])

  useEffect(() => { cargar() }, [cargar])

  const conteo = useMemo(() => {
    const m = {}
    for (const c of clientes) if (!c.excluido) m[c.segmento] = (m[c.segmento] || 0) + 1
    return m
  }, [clientes])

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    let l = clientes.filter(c => !c.excluido)
    if (t) l = l.filter(c => (c.nombre || '').toLowerCase().includes(t) || c.telefono.includes(t.replace(/\D/g, '')))
    else l = l.filter(c => c.segmento === seg)
    // Dormidos: primero los que más gastaban; el resto, por último pedido.
    if (!t && seg === 'dormido') l = [...l].sort((a, b) => Number(b.total) - Number(a.total))
    return l
  }, [clientes, seg, q])

  const campaña = useMemo(() => {
    const contactados = clientes.filter(c => Number(c.contactos) > 0)
    return { contactados: contactados.length, volvieron: contactados.filter(c => c.volvio_tras_contacto).length }
  }, [clientes])

  const hoy = hoySV()
  const hoyRow = avance.find(a => a.dia === hoy)
  const mesPedidos = avance.reduce((s, a) => s + Number(a.pedidos), 0)
  const mesMeta = avance.some(a => a.meta_dia != null) ? avance.reduce((s, a) => s + Number(a.meta_dia || 0), 0) : null
  const plantilla = plantillas.find(p => p.id === plantillaId)

  async function escribir(c) {
    if (!plantilla) { setMsg('Primero creá una plantilla de mensaje.'); return }
    // Abrir la ventana ANTES del await (si no, el navegador la bloquea como popup).
    const win = window.open('about:blank', '_blank')
    const url = `https://wa.me/503${c.telefono}?text=${encodeURIComponent(armarMensaje(plantilla.texto, c))}`
    const { error: e } = await db.rpc('fn_crm_registrar_contacto', {
      p_usuario_id: user.id, p_store: store, p_telefono: c.telefono, p_nombre: c.nombre, p_plantilla: plantilla.id,
    })
    if (e) { win?.close(); setMsg('No se registró: ' + e.message); return }
    if (win) win.location.href = url; else window.location.href = url
    setClientes(cs => cs.map(x => x.telefono === c.telefono ? { ...x, contactos: Number(x.contactos) + 1, ultimo_contacto: new Date().toISOString() } : x))
  }

  async function excluir(c) {
    const { error: e } = await db.rpc('fn_crm_excluir', { p_usuario_id: user.id, p_store: store, p_telefono: c.telefono, p_motivo: 'Pidió no recibir mensajes', p_excluir: true })
    if (e) { setMsg('No se pudo: ' + e.message); return }
    setClientes(cs => cs.map(x => x.telefono === c.telefono ? { ...x, excluido: true } : x))
    setMsg(`${c.nombre || telBonito(c.telefono)} no va a recibir más mensajes.`)
  }

  async function guardarPlantilla() {
    const { data, error: e } = await db.rpc('fn_crm_plantilla_guardar', {
      p_usuario_id: user.id, p_store: store, p_id: editando.id || null, p_nombre: editando.nombre, p_texto: editando.texto, p_activo: true,
    })
    if (e) { setMsg('No se guardó: ' + e.message); return }
    setEditando(null); setPlantillaId(data); cargar()
  }

  return (
    <div style={{ background: C.bg, color: C.txt, minHeight: '100%', padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Clientes Domicilio</h2>
      <p style={{ margin: '0 0 14px', color: C.dim, fontSize: 13 }}>Escribile a los clientes de domicilio para que vuelvan a pedir. Cada mensaje queda registrado y se mide si el cliente volvió.</p>

      {supervisa && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {SUCURSALES.map(([sc, n]) => <button key={sc} style={btn(store === sc)} onClick={() => setStore(sc)}>{n}</button>)}
        </div>
      )}

      {error && <div style={{ ...card, borderColor: C.bad, color: C.bad }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Kpi titulo="Domicilios hoy" valor={hoyRow ? hoyRow.pedidos : '—'}
          sub={hoyRow?.meta_dia != null ? `Meta ${Number(hoyRow.meta_dia)} (${esFinde(hoy) ? 'V–D' : 'L–J'})` : 'Sin meta cargada'}
          ok={hoyRow?.meta_dia != null ? Number(hoyRow.pedidos) >= Number(hoyRow.meta_dia) : null} />
        <Kpi titulo="Domicilios del mes" valor={mesPedidos}
          sub={mesMeta != null ? `Meta a hoy ${mesMeta} · ${Math.round(mesPedidos / mesMeta * 100)}%` : 'Sin meta cargada'}
          ok={mesMeta != null ? mesPedidos >= mesMeta : null} />
        <Kpi titulo="Clientes contactados" valor={campaña.contactados} sub={`${campaña.volvieron} volvieron a pedir en 7 días`} />
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b>Mensaje:</b>
          <select value={plantillaId} onChange={e => setPlantillaId(e.target.value)} style={{ background: '#121214', color: C.txt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px' }}>
            {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <button style={btn(false)} onClick={() => setEditando(plantilla ? { ...plantilla } : { nombre: '', texto: '' })}>Editar</button>
          <button style={btn(false)} onClick={() => setEditando({ nombre: 'Nueva', texto: '¡Hola {nombre}! ' })}>Nueva plantilla</button>
        </div>
        {plantilla && !editando && <p style={{ color: C.dim, fontSize: 13, marginBottom: 0 }}>{plantilla.texto}</p>}
        {editando && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={editando.nombre} onChange={e => setEditando({ ...editando, nombre: e.target.value })} placeholder="Nombre de la plantilla"
              style={{ background: '#121214', color: C.txt, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8 }} />
            <textarea rows={4} value={editando.texto} onChange={e => setEditando({ ...editando, texto: e.target.value })}
              style={{ background: '#121214', color: C.txt, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, fontFamily: 'inherit' }} />
            <span style={{ color: C.dim, fontSize: 12 }}>{'{nombre}'} pone el primer nombre del cliente y {'{favorito}'} su producto más pedido.</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btn(true)} onClick={guardarPlantilla}>Guardar</button>
              <button style={btn(false)} onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {SEGMENTOS.map(([k, l, d]) => (
          <button key={k} title={d} style={btn(seg === k && !q)} onClick={() => { setSeg(k); setQ(''); setLimite(40) }}>
            {l} <span style={{ color: C.dim }}>{conteo[k] || 0}</span>
          </button>
        ))}
        <input placeholder="Buscar nombre o teléfono" value={q} onChange={e => { setQ(e.target.value); setLimite(40) }}
          style={{ background: '#121214', color: C.txt, border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px', flex: '1 1 180px', minWidth: 0 }} />
      </div>
      <p style={{ color: C.dim, fontSize: 12, marginTop: 0 }}>{q ? 'Resultados de búsqueda' : SEGMENTOS.find(s => s[0] === seg)?.[2]}{seg === 'dormido' && !q ? ' · ordenados por lo que gastaban' : ''}</p>

      {msg && <div style={{ ...card, padding: 10, color: C.warn }}>{msg}</div>}
      {cargando && <div style={{ color: C.dim }}>Cargando…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lista.slice(0, limite).map(c => {
          const diasContacto = c.ultimo_contacto ? Math.floor((Date.now() - Date.parse(c.ultimo_contacto)) / 864e5) : null
          const reciente = diasContacto != null && diasContacto < 7
          return (
            <div key={c.telefono} style={{ ...card, marginBottom: 0, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{c.nombre || 'Sin nombre'} <span style={{ color: C.dim, fontWeight: 400, fontSize: 13 }}>{telBonito(c.telefono)}</span></div>
                <div style={{ color: C.dim, fontSize: 13 }}>
                  {c.pedidos} {Number(c.pedidos) === 1 ? 'pedido' : 'pedidos'} · último hace {c.dias_sin_pedir} días · ticket {money(c.ticket)}
                  {c.favorito ? ` · le gusta ${c.favorito}` : ''}
                </div>
                {diasContacto != null && (
                  <div style={{ fontSize: 12, color: c.volvio_tras_contacto ? C.ok : C.dim }}>
                    Contactado hace {diasContacto} {diasContacto === 1 ? 'día' : 'días'}{c.volvio_tras_contacto ? ' · ✓ volvió a pedir' : ''}
                  </div>
                )}
              </div>
              <button onClick={() => escribir(c)} disabled={reciente}
                title={reciente ? 'Ya se le escribió esta semana' : 'Abrir WhatsApp con el mensaje'}
                style={{ ...btn(!reciente, C.wa), color: reciente ? C.dim : C.wa, borderColor: reciente ? C.line : C.wa, cursor: reciente ? 'default' : 'pointer' }}>
                WhatsApp
              </button>
              <button onClick={() => excluir(c)} style={{ ...btn(false), color: C.dim, fontWeight: 400 }}>No escribir más</button>
            </div>
          )
        })}
      </div>
      {lista.length > limite && <button style={{ ...btn(false), marginTop: 12 }} onClick={() => setLimite(l => l + 40)}>Ver 40 más ({lista.length - limite} restantes)</button>}
      {!cargando && lista.length === 0 && <div style={{ color: C.dim }}>No hay clientes en este grupo.</div>}
    </div>
  )
}

function Kpi({ titulo, valor, sub, ok }) {
  const col = ok == null ? C.txt : ok ? C.ok : C.bad
  return (
    <div style={{ ...card, marginBottom: 0 }}>
      <div style={{ color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{titulo}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: col, margin: '4px 0' }}>{valor}</div>
      <div style={{ color: C.dim, fontSize: 12 }}>{sub}</div>
    </div>
  )
}
