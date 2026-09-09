import { useEffect, useState } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   Mi equipo — PIN de la gente de mi sucursal.

   Existe para que la encargada pueda dar de alta a su gente en el
   protocolo sin esperar a Cesar. Tres reglas que no se negocian:
   1. Solo aparece la gente de TU sucursal (la base lo decide, no esta pantalla).
   2. Cada PIN que mirás o cambiás pide tu propio PIN y queda en la bitácora
      con tu nombre. Los intentos fallidos también.
   3. El PIN se tapa solo a los 15 segundos.
   ═══════════════════════════════════════════════════════════════════════ */

const SEGUNDOS_VISIBLE = 15

const cuando = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
}

export default function ProtocoloEquipoView({ user, onVolver }) {
  const [sucursales, setSucs] = useState([])
  const [suc, setSuc]         = useState(null)
  const [equipo, setEquipo]   = useState([])
  const [log, setLog]         = useState([])
  const [codigo, setCodigo]   = useState(null)
  const [visible, setVisible] = useState({})     // id -> { pin, hasta }
  const [modal, setModal]     = useState(null)   // { persona, accion: 'ver'|'cambiar' }
  const [miPin, setMiPin]     = useState('')
  const [nuevoPin, setNuevo]  = useState('')
  const [cargando, setCarg]   = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError]     = useState(null)
  const [msg, setMsg]         = useState(null)

  // ── Sucursales que puedo ver ──
  useEffect(() => {
    if (!user?.id) return
    let vivo = true
    ;(async () => {
      const { data: todas } = await db.rpc('fn_protocolo_sucursales')
      const mias = []
      for (const s of todas || []) {
        const { data: ok } = await db.rpc('fn_protocolo_puede_editar', { p_usuario: user.id, p_store_code: s.store_code })
        if (ok) mias.push(s)
      }
      if (!vivo) return
      setSucs(mias)
      if (mias.length) setSuc(mias[0].store_code)
      else { setCarg(false); setError('Tu usuario no tiene una sucursal asignada en el protocolo.') }
    })()
    return () => { vivo = false }
  }, [user?.id])

  async function cargar() {
    if (!suc) return
    setCarg(true); setError(null)
    const [eq, lg, cd] = await Promise.all([
      db.rpc('fn_protocolo_equipo', { p_usuario: user.id, p_store_code: suc }),
      db.rpc('fn_protocolo_pin_log', { p_usuario: user.id, p_store_code: suc, p_limite: 40 }),
      db.rpc('fn_protocolo_codigo_de', { p_usuario: user.id, p_store_code: suc }),
    ])
    if (eq.error) setError(eq.error.message)
    setEquipo(eq.data || [])
    setLog(lg.data || [])
    setCodigo(cd.data?.ok ? cd.data : null)
    setVisible({})
    setCarg(false)
  }
  useEffect(() => { cargar() }, [suc]) // eslint-disable-line

  // Tapar los PIN vencidos: un tick por segundo mientras haya alguno visible.
  useEffect(() => {
    if (!Object.keys(visible).length) return
    const t = setInterval(() => {
      const ahora = Date.now()
      setVisible(v => {
        const n = {}
        for (const [id, x] of Object.entries(v)) if (x.hasta > ahora) n[id] = x
        return n
      })
    }, 1000)
    return () => clearInterval(t)
  }, [visible])

  function abrir(persona, accion) {
    setError(null); setMsg(null); setMiPin(''); setNuevo('')
    setModal({ persona, accion })
  }

  async function confirmar() {
    if (!modal || !miPin.trim()) return
    setOcupado(true); setError(null)
    try {
      if (modal.accion === 'ver') {
        const { data, error: e } = await db.rpc('fn_protocolo_pin_ver',
          { p_usuario: user.id, p_mi_pin: miPin.trim(), p_objetivo: modal.persona.id })
        if (e) throw e
        if (!data?.ok) { setError(`${data?.mensaje || 'No se pudo'}. El intento quedó registrado.`); return }
        setVisible(v => ({ ...v, [modal.persona.id]: { pin: data.pin, hasta: Date.now() + SEGUNDOS_VISIBLE * 1000 } }))
        setModal(null)
      } else {
        const { data, error: e } = await db.rpc('fn_protocolo_pin_cambiar',
          { p_usuario: user.id, p_mi_pin: miPin.trim(), p_objetivo: modal.persona.id, p_nuevo: nuevoPin.trim() })
        if (e) throw e
        if (!data?.ok) { setError(data?.mensaje || 'No se pudo cambiar'); return }
        setMsg(`PIN de ${data.persona} cambiado.`)
        setModal(null)
      }
      // La bitácora cambió: refrescarla sin tapar lo que quedó visible.
      const { data: lg } = await db.rpc('fn_protocolo_pin_log', { p_usuario: user.id, p_store_code: suc, p_limite: 40 })
      setLog(lg || [])
    } catch (err) {
      setError(err.message || String(err))
    } finally { setOcupado(false) }
  }

  async function renovar() {
    if (!window.confirm('¿Renovar el código? El anterior deja de servir en el momento.')) return
    setOcupado(true); setError(null)
    try {
      const { data, error: e } = await db.rpc('fn_protocolo_renovar_codigo', { p_usuario: user.id, p_store_code: suc })
      if (e) throw e
      setCodigo(c => ({ ...(c || {}), ok: true, codigo: data.codigo, usos: 0, ultimo_uso: null }))
      setMsg('Código renovado.')
    } catch (err) { setError(err.message || String(err)) }
    finally { setOcupado(false) }
  }

  const activos = equipo.filter(p => p.activo)
  const bajas   = equipo.filter(p => !p.activo)
  const nombreSuc = sucursales.find(s => s.store_code === suc)?.nombre || suc
  const S = estilos

  return (
    <div style={S.pagina}>
      <div style={S.top}>
        {onVolver && <button onClick={onVolver} style={S.bt}>← Apertura</button>}
        <h1 style={S.h1}>Protocolo de apertura · Mi equipo</h1>
        <span style={S.chip}>{user?.nombre}</span>
        {sucursales.length > 1 ? (
          <select value={suc || ''} onChange={e => setSuc(e.target.value)} style={S.select}>
            {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.nombre}</option>)}
          </select>
        ) : <span style={{ ...S.chip, background: '#1f2937', color: '#cbd5e1' }}>{nombreSuc}</span>}
      </div>

      <div style={S.wrap}>
        {msg && <div style={S.ok}>{msg}<button onClick={() => setMsg(null)} style={S.cerrar}>✕</button></div>}
        {error && !modal && <div style={S.error}>{error}<button onClick={() => setError(null)} style={S.cerrar}>✕</button></div>}

        {/* ── Código de empleado nuevo ── */}
        <div style={S.card}>
          <div style={S.cardH}>Código de empleado nuevo</div>
          <div style={S.gris}>
            Para quien todavía no tiene usuario. Solo sirve para marcar la apertura: no abre caja ni cobra.
          </div>
          {codigo ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <div style={S.codigo}>{String(codigo.codigo).replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
              <div style={S.gris}>
                {codigo.usos || 0} uso(s){codigo.ultimo_uso ? ` · último ${cuando(codigo.ultimo_uso)}` : ''}
              </div>
              <button onClick={renovar} disabled={ocupado} style={S.bt}>Renovar</button>
            </div>
          ) : (
            <div style={{ ...S.gris, marginTop: 8 }}>Esta sucursal no tiene código activo. Pedíselo a Cesar.</div>
          )}
        </div>

        <div style={S.aviso}>
          Solo aparece la gente de <b>{nombreSuc}</b>. Cada PIN que mires queda registrado con tu nombre —
          también los intentos fallidos. El PIN se oculta solo a los {SEGUNDOS_VISIBLE} segundos.
        </div>

        {cargando && <div style={S.gris}>Cargando…</div>}

        {/* ── Activos ── */}
        {!cargando && (
          <>
            <h3 style={S.h3}>Activos · {activos.length}</h3>
            {activos.map(p => <Persona key={p.id} p={p} v={visible[p.id]} S={S}
              onVer={() => abrir(p, 'ver')} onCambiar={() => abrir(p, 'cambiar')} />)}
            {bajas.length > 0 && (
              <>
                <h3 style={{ ...S.h3, marginTop: 18 }}>Dados de baja · {bajas.length}</h3>
                {bajas.map(p => <Persona key={p.id} p={p} v={visible[p.id]} S={S}
                  onVer={() => abrir(p, 'ver')} />)}
              </>
            )}
          </>
        )}

        {/* ── Registro ── */}
        <h3 style={{ ...S.h3, marginTop: 22 }}>Registro</h3>
        <div style={{ ...S.gris, marginBottom: 8 }}>El mismo que ve Cesar. No se puede borrar.</div>
        {log.length === 0 && <div style={S.gris}>Todavía no hay movimientos.</div>}
        {log.map((l, i) => (
          <div key={i} style={{ ...S.logRow, color: l.accion === 'intento_fallido' ? '#fca5a5' : '#cbd5e1' }}>
            <b>{l.actor}</b>{' '}
            {l.accion === 'vio' ? 'vio el PIN de' : l.accion === 'cambio' ? 'cambió el PIN de' : 'intentó y fue rechazado ·'}{' '}
            {l.objetivo || l.detalle}
            <span style={S.logT}> · {cuando(l.momento)}</span>
          </div>
        ))}
      </div>

      {/* ── Modal: confirmá con tu PIN ── */}
      {modal && (
        <div style={S.fondo} onClick={() => !ocupado && setModal(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Confirmá con tu PIN</div>
            <div style={{ ...S.gris, marginTop: 4 }}>
              Para {modal.accion === 'ver' ? 'ver' : 'cambiar'} el PIN de <b>{modal.persona.persona}</b>.
              Queda registrado que fuiste vos.
            </div>
            <input type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="Tu PIN"
              value={miPin} onChange={e => setMiPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && modal.accion === 'ver' && confirmar()}
              style={S.pinInput} />
            {modal.accion === 'cambiar' && (
              <input type="text" inputMode="numeric" maxLength={6} placeholder="PIN nuevo (4 a 6 números)"
                value={nuevoPin} onChange={e => setNuevo(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && confirmar()}
                style={{ ...S.pinInput, marginTop: 8 }} />
            )}
            {error && <div style={{ ...S.error, marginTop: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setModal(null)} disabled={ocupado} style={S.bt}>Cancelar</button>
              <button onClick={confirmar} disabled={ocupado || !miPin || (modal.accion === 'cambiar' && nuevoPin.length < 4)}
                style={{ ...S.bt, ...S.btPri }}>
                {ocupado ? '…' : modal.accion === 'ver' ? 'Ver PIN' : 'Cambiar PIN'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Persona({ p, v, S, onVer, onCambiar }) {
  const quedan = v ? Math.max(0, Math.ceil((v.hasta - Date.now()) / 1000)) : 0
  return (
    <div style={{ ...S.fila, opacity: p.activo ? 1 : .6 }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 700 }}>{p.persona}</div>
        <div style={S.gris}>{p.rol}{!p.activo && ' · dado de baja'}</div>
      </div>
      <div style={S.pin}>
        {v ? <span style={{ color: '#6ee7b7', letterSpacing: 3 }}>{v.pin}</span>
           : <span style={{ color: '#4b5563' }}>{p.activo ? '••••' : '—'}</span>}
        {v && <span style={S.quedan}>{quedan}s</span>}
      </div>
      <button onClick={onVer} style={S.bt}>Ver PIN</button>
      {onCambiar && p.activo && <button onClick={onCambiar} style={S.bt}>Cambiar</button>}
    </div>
  )
}

const estilos = {
  pagina: { background: '#0f1115', color: '#e8eaed', minHeight: '100vh', fontSize: 15, lineHeight: 1.5 },
  top: { position: 'sticky', top: 0, zIndex: 20, background: '#111827', borderBottom: '3px solid #dc2626',
         padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 17, flex: 1 },
  chip: { background: '#1e3a5f', color: '#bfdbfe', borderRadius: 20, padding: '5px 13px', fontSize: 13, fontWeight: 700 },
  select: { background: '#0f1115', color: '#e8eaed', border: '1px solid #2b3344', borderRadius: 8, padding: '7px 10px', font: 'inherit', fontSize: 13, fontWeight: 700 },
  wrap: { maxWidth: 820, margin: '0 auto', padding: '18px 18px 70px' },
  h3: { fontSize: 11, letterSpacing: .7, textTransform: 'uppercase', color: '#6b7280', margin: '0 0 8px' },
  card: { background: '#171a21', border: '1px solid #262b36', borderRadius: 11, padding: '14px 16px', marginBottom: 14 },
  cardH: { fontSize: 15, fontWeight: 800, marginBottom: 2 },
  codigo: { fontFamily: 'ui-monospace, monospace', fontSize: 30, fontWeight: 800, letterSpacing: 4, color: '#fbbf24' },
  aviso: { background: '#12202e', border: '1px solid #1e3a5f', color: '#bfdbfe', borderRadius: 9, padding: '10px 13px', fontSize: 13, marginBottom: 16 },
  fila: { display: 'flex', alignItems: 'center', gap: 10, background: '#171a21', border: '1px solid #262b36', borderRadius: 9, padding: '10px 13px', marginBottom: 6, flexWrap: 'wrap' },
  pin: { fontFamily: 'ui-monospace, monospace', fontSize: 18, fontWeight: 800, minWidth: 90, display: 'flex', alignItems: 'center', gap: 8 },
  quedan: { fontSize: 11, color: '#6b7280', fontWeight: 400 },
  bt: { background: '#1f2937', color: '#cbd5e1', border: 0, borderRadius: 7, padding: '7px 12px', font: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btPri: { background: '#22c55e', color: '#08120a' },
  gris: { color: '#9ca3af', fontSize: 13 },
  logRow: { fontSize: 13, padding: '6px 0', borderBottom: '1px solid #1f2430' },
  logT: { color: '#6b7280' },
  ok: { background: '#0b2417', border: '1px solid #22c55e', color: '#6ee7b7', borderRadius: 9, padding: '10px 13px', marginBottom: 12, fontSize: 13.5, display: 'flex', gap: 10 },
  error: { background: '#2a1210', border: '1px solid #7f1d1d', color: '#fecaca', borderRadius: 9, padding: '10px 13px', marginBottom: 12, fontSize: 13.5, display: 'flex', gap: 10 },
  cerrar: { marginLeft: 'auto', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontWeight: 700 },
  fondo: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 40, display: 'grid', placeItems: 'center', padding: 18 },
  modal: { background: '#171a21', border: '1px solid #2b3344', borderRadius: 12, padding: 18, width: '100%', maxWidth: 380 },
  pinInput: { width: '100%', marginTop: 12, background: '#0f1115', border: '1px solid #2b3344', borderRadius: 8, color: '#e8eaed',
              padding: 12, font: 'inherit', fontSize: 20, fontWeight: 700, letterSpacing: 5, textAlign: 'center', boxSizing: 'border-box' },
}
