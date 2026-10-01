import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'
import { estadoAvisos, activarAvisos, desactivarAvisos, probarAvisos } from '../../lib/avisosPush'

// ── Cancelaciones por resolver (1-oct-2026, Frank) ─────────────────────────────
// Cuando se cancela algo que ya entró a cocina (caja, web, PedidosYa o a mano),
// el gerente de la sucursal decide qué pasó con el producto. Caja y cocina solo
// opinan. Si en 15 minutos nadie decide, avisa también a Frank, César y José.
// El conteo nocturno no se guarda mientras quede alguna sin decidir.
// En modo "sombra" la decisión se guarda pero el inventario sigue como lo
// dejaron caja y cocina (se compara una semana antes de activarlo).

const DEC = {
  no_preparado:    { t: 'No se preparó',        i: '✋', c: '#22c55e', s: 'Nunca se cocinó' },
  botado:          { t: 'Se preparó y se botó', i: '🗑️', c: '#ef4444', s: 'Merma de lo preparado' },
  reutilizado:     { t: 'Se usó en otra orden', i: '🔁', c: '#3b82f6', s: 'Decí en cuál' },
  consumo_interno: { t: 'Se lo dio a alguien',  i: '🎁', c: '#f59e0b', s: 'Personal, cortesía o cliente' },
}
const OPI = { preparado: 'ya estaba hecho', no_preparado: 'no se preparó', reutilizado: 'se usa en otra orden' }
const ORIGEN = { caja: 'Caja', web_delivery: 'Web / delivery', pedidosya: 'PedidosYa', manual: 'Registrada a mano' }
const hora = (ts) => new Date(ts).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' })
const fecha = (ts) => new Date(ts).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', timeZone: 'America/El_Salvador' })
const hoySV = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0]

const S = {
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 14, marginBottom: 12 },
  chip: (c) => ({ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: c + '22', color: c, whiteSpace: 'nowrap' }),
  input: { width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #333', borderRadius: 8, padding: '9px 10px', color: '#eee', fontSize: 14 },
  btn: (c, on) => ({ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 12px',
    borderRadius: 10, border: `1.5px solid ${on ? c : c + '55'}`, background: on ? c + '2a' : c + '10', color: '#f3f4f6', cursor: 'pointer', fontSize: 14 }),
  cta: (dis) => ({ width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 15,
    background: dis ? '#333' : '#e63946', color: dis ? '#777' : '#fff', cursor: dis ? 'default' : 'pointer', marginTop: 10 }),
  ghost: { background: 'transparent', border: '1px solid #333', color: '#bbb', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 },
}

function Avisos({ user }) {
  const [est, setEst] = useState('cargando')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { estadoAvisos().then(setEst) }, [])
  const activar = async () => {
    setBusy(true); setMsg('')
    try { const r = await activarAvisos(user); setEst('activo'); setMsg(`Listo. Tenés avisos en ${r?.dispositivos || 1} dispositivo(s).`) }
    catch (e) { setMsg(e.message); setEst(await estadoAvisos()) }
    setBusy(false)
  }
  const probar = async () => {
    setBusy(true); setMsg('')
    try { await probarAvisos(user); setMsg('Te mandamos un aviso de prueba. Debería llegar en unos segundos.') }
    catch (e) { setMsg(e.message) }
    setBusy(false)
  }
  const apagar = async () => { setBusy(true); await desactivarAvisos(); setEst(await estadoAvisos()); setMsg('Avisos apagados en este dispositivo.'); setBusy(false) }
  const txt = {
    cargando: 'Revisando…',
    activo: '🔔 Avisos activados en este dispositivo',
    inactivo: '🔕 Este dispositivo no recibe avisos',
    bloqueado: '🚫 Los avisos están bloqueados en este navegador. Activalos en los ajustes del sitio.',
    ios_sin_instalar: '📱 En iPhone: Compartir → "Agregar a pantalla de inicio" y abrí el ERP desde ese ícono para recibir avisos.',
    no_soportado: 'Este navegador no recibe avisos. Usá Chrome en Android o el ERP instalado en iPhone.',
  }[est]
  return (
    <div style={{ ...S.card, borderColor: est === 'activo' ? '#166534' : '#3a2a10' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13.5, color: '#ddd', flex: '1 1 220px' }}>{txt}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {est === 'inactivo' && <button style={{ ...S.ghost, borderColor: '#e63946', color: '#fca5a5' }} disabled={busy} onClick={activar}>Activar avisos</button>}
          {est === 'activo' && <button style={S.ghost} disabled={busy} onClick={probar}>Probar</button>}
          {est === 'activo' && <button style={S.ghost} disabled={busy} onClick={apagar}>Apagar</button>}
        </div>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 8 }}>{msg}</div>}
    </div>
  )
}

function Componentes({ c }) {
  const comp = c.componentes || []
  if (!comp.length) return null
  return <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 4 }}>{comp.map(x => `${x.cantidad > 1 ? x.cantidad + '× ' : ''}${x.nombre}`).join(' · ')}</div>
}

function Opiniones({ c }) {
  const no = c.opinion_caja && c.opinion_cocina && c.opinion_caja !== c.opinion_cocina
  if (!c.opinion_caja && !c.opinion_cocina) return null
  return (
    <div style={{ fontSize: 12.5, marginTop: 8, padding: '7px 10px', borderRadius: 8, background: no ? '#3a1616' : '#202020', color: no ? '#fca5a5' : '#bbb' }}>
      {c.opinion_caja && <>Caja: <b>{OPI[c.opinion_caja] || c.opinion_caja}</b></>}
      {c.opinion_caja && c.opinion_cocina && ' · '}
      {c.opinion_cocina && <>Cocina{c.cocina_por_nombre ? ` (${c.cocina_por_nombre})` : ''}: <b>{OPI[c.opinion_cocina] || c.opinion_cocina}</b></>}
      {no && <span style={{ fontWeight: 800 }}> · no coinciden</span>}
    </div>
  )
}

function Pendiente({ c, user, onListo }) {
  const comp = c.componentes || []
  const porComp = comp.length > 1
  const [modo, setModo] = useState(null)          // decisión única o 'parcial'
  const [destino, setDestino] = useState('')
  const [quien, setQuien] = useState('')
  const [nota, setNota] = useState('')
  const [partes, setPartes] = useState(() => comp.map(x => ({ ...x, decision: null, destino_ref: '', consumo_nombre: '' })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const listoParcial = partes.every(p => p.decision
    && (p.decision !== 'reutilizado' || p.destino_ref.trim())
    && (p.decision !== 'consumo_interno' || p.consumo_nombre.trim()))
  const listo = modo === 'parcial' ? listoParcial
    : modo && (modo !== 'reutilizado' || destino.trim()) && (modo !== 'consumo_interno' || quien.trim())

  const guardar = async () => {
    if (!listo || busy) return
    setBusy(true); setErr('')
    // Si todos los componentes tienen la misma decisión, se guarda como decisión única.
    let decision = modo, detalle = null, dRef = destino, cNom = quien
    if (modo === 'parcial') {
      const unicas = [...new Set(partes.map(p => p.decision))]
      detalle = partes.map(p => ({ nombre: p.nombre, cantidad: p.cantidad, decision: p.decision,
        destino_ref: p.destino_ref.trim() || null, consumo_nombre: p.consumo_nombre.trim() || null }))
      if (unicas.length === 1) {
        decision = unicas[0]
        dRef = partes.find(p => p.destino_ref.trim())?.destino_ref || ''
        cNom = partes.find(p => p.consumo_nombre.trim())?.consumo_nombre || ''
      }
    }
    const { error } = await db.rpc('cancelacion_resolver', {
      p_usuario_id: user.id, p_id: c.id, p_decision: decision, p_detalle: detalle,
      p_destino_ref: dRef || null, p_consumo_nombre: cNom || null, p_nota: nota || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onListo()
  }

  const extra = (d, val, set, ph) => d === 'reutilizado' || d === 'consumo_interno'
    ? <input style={{ ...S.input, marginTop: 6 }} value={val} onChange={e => set(e.target.value)}
        placeholder={d === 'reutilizado' ? 'Orden donde se usó (ej. Mesa 1 · Duo Picossini)' : 'A quién (ej. Personal: César)'} aria-label={ph} />
    : null

  return (
    <div style={{ ...S.card, borderColor: c.escalado_at ? '#7f1d1d' : '#3a2a10' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{c.referencia || 'Cancelación'} · {c.titulo}</div>
          <Componentes c={c} />
        </div>
        <span style={S.chip(c.escalado_at ? '#ef4444' : '#f59e0b')}>{c.minutos < 1 ? 'ahora' : `hace ${c.minutos} min`}</span>
      </div>
      <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 6 }}>
        {c.store_code} · {ORIGEN[c.origen] || c.origen} · {hora(c.created_at)}
        {c.cancelado_por_nombre && <> · anuló <b style={{ color: '#ccc' }}>{c.cancelado_por_nombre}</b></>}
        {c.valor != null && <> · ${Number(c.valor).toFixed(2)}</>}
      </div>
      {c.motivo && <div style={{ fontSize: 13, color: '#ddd', marginTop: 4 }}>Motivo: {c.motivo}</div>}
      <Opiniones c={c} />

      {c.es_mia ? (
        <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 10 }}>La anulaste vos: la decide otra persona del equipo.</div>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#ccc', margin: '12px 0 6px' }}>¿Qué pasó con el producto?</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {Object.entries(DEC).map(([k, d]) => (
              <button key={k} style={S.btn(d.c, modo === k)} onClick={() => setModo(k)}>
                <span style={{ fontSize: 18 }}>{d.i}</span>
                <span><b style={{ display: 'block' }}>{d.t}</b><span style={{ fontSize: 12, color: '#9ca3af' }}>{d.s}</span></span>
              </button>
            ))}
            {porComp && (
              <button style={S.btn('#a78bfa', modo === 'parcial')} onClick={() => setModo('parcial')}>
                <span style={{ fontSize: 18 }}>🧩</span>
                <span><b style={{ display: 'block' }}>Distinto por componente</b><span style={{ fontSize: 12, color: '#9ca3af' }}>Ej.: las papas se botaron, los hot dogs no se hicieron</span></span>
              </button>
            )}
          </div>
          {modo && modo !== 'parcial' && extra(modo, modo === 'reutilizado' ? destino : quien, modo === 'reutilizado' ? setDestino : setQuien, 'detalle')}
          {modo === 'parcial' && (
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              {partes.map((p, i) => (
                <div key={i} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{p.cantidad > 1 ? p.cantidad + '× ' : ''}{p.nombre}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(DEC).map(([k, d]) => (
                      <button key={k} onClick={() => setPartes(ps => ps.map((x, j) => j === i ? { ...x, decision: k } : x))}
                        style={{ ...S.chip(d.c), border: `1px solid ${p.decision === k ? d.c : 'transparent'}`, padding: '6px 10px', cursor: 'pointer', fontSize: 12.5,
                          background: p.decision === k ? d.c + '33' : d.c + '12' }}>{d.i} {d.t}</button>
                    ))}
                  </div>
                  {extra(p.decision,
                    p.decision === 'reutilizado' ? p.destino_ref : p.consumo_nombre,
                    v => setPartes(ps => ps.map((x, j) => j === i ? { ...x, [p.decision === 'reutilizado' ? 'destino_ref' : 'consumo_nombre']: v } : x)),
                    'detalle componente')}
                </div>
              ))}
            </div>
          )}
          {modo && <input style={{ ...S.input, marginTop: 8 }} value={nota} onChange={e => setNota(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" />}
          {err && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{err}</div>}
          <button style={S.cta(!listo || busy)} disabled={!listo || busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar decisión'}</button>
        </>
      )}
    </div>
  )
}

function Resuelta({ c }) {
  const d = DEC[c.decision]
  return (
    <div style={{ ...S.card, padding: 12, opacity: .9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, minWidth: 0 }}>{c.referencia} · {c.titulo}</div>
        <span style={S.chip(d?.c || '#a78bfa')}>{d ? `${d.i} ${d.t}` : '🧩 Por componente'}</span>
      </div>
      <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 4 }}>
        {c.store_code} · {fecha(c.created_at)} {hora(c.created_at)} · decidió {c.decidido_por_nombre} a las {hora(c.decidido_at)}
        {c.destino_ref && <> · en {c.destino_ref}</>}{c.consumo_nombre && <> · a {c.consumo_nombre}</>}
      </div>
      {Array.isArray(c.detalle) && c.decision === 'parcial' && (
        <div style={{ fontSize: 12.5, color: '#bbb', marginTop: 4 }}>
          {c.detalle.map((p, i) => <div key={i}>{p.nombre}: {DEC[p.decision]?.t}{p.destino_ref ? ` (${p.destino_ref})` : ''}{p.consumo_nombre ? ` (${p.consumo_nombre})` : ''}</div>)}
        </div>
      )}
      {c.nota && <div style={{ fontSize: 12.5, color: '#bbb', marginTop: 4 }}>Nota: {c.nota}</div>}
    </div>
  )
}

function RegistrarManual({ user, sucursales, onListo }) {
  const [abierto, setAbierto] = useState(false)
  const [store, setStore] = useState(sucursales[0] || '')
  const [q, setQ] = useState('')
  const [cuentas, setCuentas] = useState([])
  const [sel, setSel] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!abierto || !store) return
    const desde = `${hoySV()}T05:00:00-06:00`
    db.from('pos_cuentas').select('id,tipo,mesa_ref,delivery_referencia,cliente_nombre,total,estado,created_at')
      .eq('store_code', store).gte('created_at', desde).neq('estado', 'cancelada')
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data }) => setCuentas(data || []))
  }, [abierto, store])

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return cuentas.filter(c => !t || [c.mesa_ref, c.delivery_referencia, c.cliente_nombre, c.tipo].some(v => String(v || '').toLowerCase().includes(t))).slice(0, 12)
  }, [cuentas, q])

  const etiqueta = (c) => c.tipo === 'pedidos_ya' ? `PeYa #${c.delivery_referencia || '?'}`
    : c.tipo === 'delivery_app' ? `Hifumi ${String(c.delivery_referencia || '').slice(-4)}`
    : c.mesa_ref || (c.tipo || '').replace('_', ' ')

  const guardar = async () => {
    setBusy(true); setErr('')
    const { error } = await db.rpc('cancelacion_registrar_manual', { p_usuario_id: user.id, p_cuenta_id: sel.id, p_motivo: motivo })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setAbierto(false); setSel(null); setMotivo(''); setQ(''); onListo()
  }

  if (!abierto) return (
    <button style={{ ...S.ghost, width: '100%', padding: 11, marginBottom: 12 }} onClick={() => setAbierto(true)}>
      + Registrar una cancelación que no pasó por caja (ej. pedido de PedidosYa rechazado)
    </button>
  )
  return (
    <div style={S.card}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Registrar cancelación a mano</div>
      {sucursales.length > 1 && (
        <select style={{ ...S.input, marginBottom: 8 }} value={store} onChange={e => { setStore(e.target.value); setSel(null) }} aria-label="Sucursal">
          {sucursales.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      <input style={S.input} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: número de PeYa, mesa o cliente" aria-label="Buscar cuenta" />
      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        {filtradas.map(c => (
          <button key={c.id} onClick={() => setSel(c)} style={{ ...S.btn('#3b82f6', sel?.id === c.id), padding: '8px 10px' }}>
            <span style={{ flex: 1 }}><b>{etiqueta(c)}</b> · {hora(c.created_at)} · ${Number(c.total || 0).toFixed(2)} · {c.estado}</span>
          </button>
        ))}
        {filtradas.length === 0 && <div style={{ fontSize: 13, color: '#888' }}>No hay cuentas de hoy con ese dato.</div>}
      </div>
      {sel && <input style={{ ...S.input, marginTop: 8 }} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (ej. rechazado: no había aros)" aria-label="Motivo" />}
      {err && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...S.ghost, marginTop: 10 }} onClick={() => setAbierto(false)}>Cancelar</button>
        <button style={{ ...S.cta(!sel || !motivo.trim() || busy), flex: 1 }} disabled={!sel || !motivo.trim() || busy} onClick={guardar}>Registrar y decidir</button>
      </div>
    </div>
  )
}

export default function CancelacionesView({ user }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  const cargar = useCallback(async () => {
    const { data: d, error } = await db.rpc('cancelaciones_bandeja', { p_usuario_id: user.id, p_dias: 2 })
    if (error) { setErr(error.message); return }
    setErr(''); setData(d)
  }, [user.id])

  useEffect(() => {
    cargar()
    const t = setInterval(() => { if (!document.hidden) cargar() }, 20000)
    const vis = () => { if (!document.hidden) cargar() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [cargar])

  const items = data?.items || []
  const pend = items.filter(c => c.estado === 'pendiente')
  const res = items.filter(c => c.estado !== 'pendiente')

  return (
    <div style={{ padding: '16px', maxWidth: 640, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>↩️ Cancelaciones por resolver</div>
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 14 }}>
        Cuando se cancela algo que ya entró a cocina, decidí qué pasó con el producto. Caja y cocina opinan; la decisión es tuya.
      </div>

      <Avisos user={user} />

      {err && <div style={{ ...S.card, color: '#fca5a5' }}>No se pudo cargar: {err}</div>}
      {data && data.sucursales?.length === 0 && (
        <div style={S.card}>No tenés sucursales asignadas para decidir cancelaciones. Si deberías, pedile a Frank o César que te agreguen.</div>
      )}

      {data && data.sucursales?.length > 0 && (
        <>
          <RegistrarManual user={user} sucursales={data.sucursales} onListo={cargar} />
          <div style={{ fontSize: 12, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, margin: '6px 0 8px' }}>
            Por decidir · {pend.length}
          </div>
          {pend.length === 0 && <div style={{ ...S.card, color: '#86efac' }}>✓ No hay cancelaciones pendientes.</div>}
          {pend.map(c => <Pendiente key={c.id} c={c} user={user} onListo={cargar} />)}

          {res.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, margin: '18px 0 8px' }}>
                Decididas · últimos 2 días
              </div>
              {res.map(c => <Resuelta key={c.id} c={c} />)}
            </>
          )}
          {items.some(c => c.modo === 'sombra') && (
            <div style={{ fontSize: 11.5, color: '#666', marginTop: 10 }}>
              Etapa de prueba: la decisión se guarda y se compara con el conteo, pero todavía no mueve el inventario.
            </div>
          )}
        </>
      )}
    </div>
  )
}
