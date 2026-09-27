/* ═══════════════════════════════════════════════════════════════════════
   Crear PIN de operario

   Para que RRHH (Jazmin) dé de alta gente de piso en cualquier sucursal sin
   esperar a Casa Matriz. Antes había que pedirlo y alguien lo insertaba a
   mano en la base.

   Lo que esta pantalla NO hace, a propósito:
   · No crea gerentes, admins ni nada que vea dinero o configuración. La
     lista de roles permitidos la impone la base (`fn_usuarios_roles_operarios`),
     no este archivo: si alguien edita el desplegable desde la consola del
     navegador, el servidor igual lo rechaza.
   · No muestra el PIN de nadie. El PIN se ve UNA vez, al crearlo. Después se
     consulta desde «Mi equipo · PIN», que pide el PIN propio y deja bitácora.
   · No borra gente: la da de baja. El histórico de ventas y cierres apunta a
     ese usuario y borrarlo lo dejaría huérfano.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../supabase'

const ROLES = [
  { v: 'cajera',     t: 'Cajera',     d: 'Cobra en el POS' },
  { v: 'cajero',     t: 'Cajero',     d: 'Cobra en el POS' },
  { v: 'cocina',     t: 'Cocina',     d: 'KDS y comandas' },
  { v: 'mesero',     t: 'Mesero',     d: 'Toma orden en mesa' },
  { v: 'produccion', t: 'Producción', d: 'Casa Matriz: porcionado, chili' },
  { v: 'motorista',  t: 'Motorista',  d: 'App de reparto' },
]

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', bad: '#ef4444', acc: '#3b82f6', warn: '#f59e0b',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 14 }
const inp = {
  width: '100%', background: '#101012', color: C.txt, border: `1px solid ${C.line}`,
  borderRadius: 8, padding: '11px 12px', fontSize: 15, fontFamily: 'inherit',
}
const lbl = { fontSize: 12.5, color: C.dim, display: 'block', marginBottom: 5 }
const btn = (color, off) => ({
  background: off ? '#3a3a3e' : color, color: '#fff', border: 'none', borderRadius: 9,
  padding: '12px 18px', fontSize: 15, fontWeight: 700, cursor: off ? 'not-allowed' : 'pointer',
  opacity: off ? 0.55 : 1, fontFamily: 'inherit',
})

export default function UsuariosPinView({ user }) {
  const [sucursales, setSucs] = useState([])
  const [gente, setGente]     = useState([])
  const [filtro, setFiltro]   = useState('')
  const [verSuc, setVerSuc]   = useState('')          // '' = todas
  const [puede, setPuede]     = useState(null)        // null = averiguando
  const [cargando, setCarg]   = useState(true)
  const [error, setError]     = useState('')
  const [guardando, setG]     = useState(false)

  // Alta
  const [nombre, setNombre]   = useState('')
  const [apellido, setApe]    = useState('')
  const [suc, setSuc]         = useState('')
  const [rol, setRol]         = useState('cajera')
  const [creado, setCreado]   = useState(null)        // { nombre, pin, ... } — se muestra una vez

  const cargar = useCallback(async () => {
    if (!user?.id) return
    setCarg(true); setError('')
    try {
      const { data: ok } = await db.rpc('fn_usuarios_puede_crear_pines', { p_actor: user.id })
      setPuede(!!ok)
      if (!ok) { setCarg(false); return }
      const [{ data: sc }, { data: g, error: eg }] = await Promise.all([
        db.from('sucursales').select('store_code, nombre').order('store_code'),
        db.rpc('fn_usuarios_operarios_listar', { p_actor: user.id, p_store_code: null }),
      ])
      if (eg) throw eg
      setSucs(sc || [])
      setGente(g || [])
      if (!suc && sc?.length) setSuc(sc[0].store_code)
    } catch (e) {
      setError(e.message || 'No se pudo cargar')
    }
    setCarg(false)
  }, [user?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar() }, [cargar])

  async function crear() {
    setError(''); setCreado(null)
    if (!nombre.trim()) { setError('Escribí al menos el nombre.'); return }
    if (!suc) { setError('Elegí la sucursal.'); return }
    setG(true)
    try {
      const { data, error: e } = await db.rpc('fn_usuarios_crear_operario', {
        p_actor: user.id, p_nombre: nombre.trim(), p_apellido: apellido.trim() || null,
        p_store_code: suc, p_rol: rol,
      })
      if (e) throw e
      const r = Array.isArray(data) ? data[0] : data
      setCreado(r)
      setNombre(''); setApe('')
      await cargar()
    } catch (e) {
      setError(e.message || 'No se pudo crear')
    }
    setG(false)
  }

  async function cambiarEstado(u, activo) {
    const verbo = activo ? 'reactivar' : 'dar de baja'
    if (!window.confirm(`¿Seguro que querés ${verbo} a ${u.nombre} ${u.apellido || ''}?`)) return
    setError('')
    try {
      const { error: e } = await db.rpc('fn_usuarios_operario_activar', {
        p_actor: user.id, p_usuario: u.id, p_activo: activo,
      })
      if (e) throw e
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo cambiar') }
  }

  const nombreSuc = (code) => sucursales.find(s => s.store_code === code)?.nombre || code || '—'

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return gente.filter(u =>
      (!verSuc || u.store_code === verSuc) &&
      (!q || `${u.nombre} ${u.apellido || ''}`.toLowerCase().includes(q))
    )
  }, [gente, filtro, verSuc])

  if (puede === false) {
    return (
      <div style={{ padding: 20, background: C.bg, color: C.dim, minHeight: '100%' }}>
        Tu usuario no puede administrar PIN de operarios. Pedíselo a RRHH o a Casa Matriz.
      </div>
    )
  }

  return (
    <div style={{ padding: 16, background: C.bg, color: C.txt, minHeight: '100%' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h2 style={{ margin: 0, fontSize: 21 }}>🔑 Crear PIN de operario</h2>
        <div style={{ color: C.dim, fontSize: 13, marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
          Da de alta gente de piso en cualquier sucursal. El sistema genera el PIN:
          se muestra <b style={{ color: C.txt }}>una sola vez</b>, apuntalo o mandáselo
          en el momento. Después se consulta desde «Mi equipo · PIN».
        </div>

        {error && (
          <div style={{ ...card, background: '#3a1212', borderColor: C.bad, color: '#fecaca' }}>{error}</div>
        )}

        {/* ── El PIN recién creado. Es el único momento en que se ve. ── */}
        {creado && (
          <div style={{ ...card, background: '#0b2417', borderColor: C.ok }}>
            <div style={{ color: '#86efac', fontSize: 14 }}>
              Dado de alta: <b>{creado.nombre} {creado.apellido || ''}</b> · {ROLES.find(r => r.v === creado.rol)?.t || creado.rol} · {nombreSuc(creado.store_code)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 6, fontFamily: 'ui-monospace, monospace', color: '#6ee7b7' }}>
                {creado.pin}
              </div>
              <button onClick={() => { navigator.clipboard?.writeText(creado.pin); }}
                style={{ ...btn('#1c1c20'), border: `1px solid ${C.line}`, fontSize: 13, padding: '9px 14px' }}>
                Copiar
              </button>
              <button onClick={() => setCreado(null)}
                style={{ ...btn('#1c1c20'), border: `1px solid ${C.line}`, fontSize: 13, padding: '9px 14px', color: C.dim }}>
                Ya lo anoté
              </button>
            </div>
            <div style={{ color: '#86efac', fontSize: 12, marginTop: 9 }}>
              Este número no se vuelve a mostrar acá. Si se pierde, se consulta o se cambia en «Mi equipo · PIN».
            </div>
          </div>
        )}

        {/* ── Alta ── */}
        <div style={{ ...card, borderColor: C.acc }}>
          <b style={{ fontSize: 15 }}>Dar de alta a alguien nuevo</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 11, marginTop: 12 }}>
            <div>
              <label style={lbl}>Nombre</label>
              <input style={inp} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Karina" />
            </div>
            <div>
              <label style={lbl}>Apellido</label>
              <input style={inp} value={apellido} onChange={e => setApe(e.target.value)} placeholder="Martínez" />
            </div>
            <div>
              <label style={lbl}>Sucursal</label>
              <select style={inp} value={suc} onChange={e => setSuc(e.target.value)}>
                {sucursales.map(s => (
                  <option key={s.store_code} value={s.store_code}>{s.store_code} · {s.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Puesto</label>
              <select style={inp} value={rol} onChange={e => setRol(e.target.value)}>
                {ROLES.map(r => <option key={r.v} value={r.v}>{r.t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 8 }}>
            {ROLES.find(r => r.v === rol)?.d}
          </div>
          <button onClick={crear} disabled={guardando} style={{ ...btn(C.ok, guardando), marginTop: 13 }}>
            {guardando ? 'Creando…' : 'Crear y generar PIN'}
          </button>
          <div style={{ color: C.warn, fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
            Solo puestos de piso. Gerentes, administración y cualquier rol que vea
            dinero o configuración se dan de alta desde Casa Matriz.
          </div>
        </div>

        {/* ── Los que ya están ── */}
        <div style={card}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <b style={{ fontSize: 15, flex: 1 }}>Operarios dados de alta</b>
            <select style={{ ...inp, width: 'auto' }} value={verSuc} onChange={e => setVerSuc(e.target.value)}>
              <option value="">Todas las sucursales</option>
              {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.store_code}</option>)}
            </select>
            <input style={{ ...inp, width: 170 }} value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar nombre…" />
          </div>

          {cargando && <div style={{ color: C.dim, fontSize: 13.5 }}>Cargando…</div>}
          {!cargando && visibles.length === 0 && (
            <div style={{ color: C.dim, fontSize: 13.5 }}>Nadie con ese filtro.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {visibles.map(u => (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                background: '#101012', borderRadius: 8, padding: '9px 12px',
                opacity: u.activo ? 1 : 0.5,
              }}>
                <span style={{ flex: 1, minWidth: 150, fontSize: 14 }}>
                  {u.nombre} {u.apellido || ''}
                  {!u.activo && <span style={{ color: C.dim, fontSize: 11.5, marginLeft: 8 }}>de baja</span>}
                </span>
                <span style={{ color: C.dim, fontSize: 12.5, width: 88 }}>
                  {ROLES.find(r => r.v === u.rol)?.t || u.rol}
                </span>
                <span style={{ color: C.dim, fontSize: 12.5, width: 60 }}>{u.store_code || '—'}</span>
                <button onClick={() => cambiarEstado(u, !u.activo)}
                  style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 7,
                           padding: '5px 11px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                           color: u.activo ? C.dim : C.ok }}>
                  {u.activo ? 'Dar de baja' : 'Reactivar'}
                </button>
              </div>
            ))}
          </div>

          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 12, lineHeight: 1.5, borderTop: `1px solid ${C.line}`, paddingTop: 11 }}>
            Dar de baja no borra a nadie: apaga el PIN y la persona deja de poder entrar.
            Las ventas y cierres que hizo siguen con su nombre. Cada alta y cada baja
            queda en la bitácora con quién la hizo.
          </div>
        </div>
      </div>
    </div>
  )
}
