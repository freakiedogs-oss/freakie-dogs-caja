import { useState, useEffect, useCallback, useMemo } from 'react'
import { db } from '../supabase'
import Icon from './Icon'

// «Se acabó» desde la caja (16-nov-2026).
// La cajera apaga en el menú de DELIVERY PROPIO (web) lo que se terminó en SU
// sucursal. Solo afecta a esta sucursal; las demás siguen vendiendo. Caja y
// PedidosYa no se tocan. Todo apagado vuelve solo mañana 6:00 a.m.
// RPCs: caja_disponibilidad_listar / caja_disponibilidad_set (validan rol y sucursal).

const MOTIVOS = ['Se terminó hoy', 'No llegó el despacho', 'Equipo dañado']

const C = {
  bg: '#0f0e13', card: '#18171f', line: '#2a2833', txt: '#e8e6ef', mut: '#8b8997',
  red: '#E62329', green: '#2dd4a8', yellow: '#FFD900',
}

function horaSV(iso) {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() - 6 * 3600 * 1000)
  let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'p.m.' : 'a.m.'; h = h % 12 || 12
  return `${h}:${m} ${ap}`
}

export function useSeAcaboConteo(user, storeCode) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!user?.id) return
    let vivo = true
    const contar = async () => {
      try {
        const { data } = await db.rpc('caja_disponibilidad_listar', { p_usuario: user.id, p_store: storeCode })
        if (vivo) setN((data?.bloqueos || []).length)
      } catch { /* el badge es un extra */ }
    }
    contar()
    const t = setInterval(contar, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [user?.id, storeCode])
  return [n, setN]
}

export default function SeAcaboCaja({ user, storeCode, storeName, onClose, onCambio }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)          // producto a apagar
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [cambios, setCambios] = useState([])    // [{clave,nombre}]
  const [buscarCambio, setBuscarCambio] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const { data: r, error: e } = await db.rpc('caja_disponibilidad_listar', { p_usuario: user.id, p_store: storeCode })
    if (e) { setError(e.message); return }
    setError(''); setData(r)
    onCambio?.((r?.bloqueos || []).length)
  }, [user.id, storeCode, onCambio])

  useEffect(() => { cargar() }, [cargar])

  const bloqueadas = useMemo(() => new Set((data?.bloqueos || []).map(b => b.clave)), [data])
  const productos = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data?.productos || [])
      .filter(p => !bloqueadas.has(p.clave))
      .filter(p => !t || p.nombre.toLowerCase().includes(t))
  }, [data, q, bloqueadas])

  const abrir = (p) => {
    setSel(p); setMotivo(MOTIVOS[0])
    setCambios((p.ultimos_cambios || []).filter(c => !bloqueadas.has(c.clave)))
    setBuscarCambio('')
  }

  const apagar = async () => {
    if (!sel) return
    setGuardando(true)
    const { error: e } = await db.rpc('caja_disponibilidad_set', {
      p_usuario: user.id, p_store: storeCode, p_clave: sel.clave, p_bloquear: true,
      p_motivo: motivo, p_cambios: cambios.map(c => c.nombre),
    })
    setGuardando(false)
    if (e) { alert(e.message); return }
    setSel(null); setQ(''); cargar()
  }

  const prender = async (b) => {
    setGuardando(true)
    const { error: e } = await db.rpc('caja_disponibilidad_set', {
      p_usuario: user.id, p_store: storeCode, p_clave: b.clave, p_bloquear: false,
    })
    setGuardando(false)
    if (e) { alert(e.message); return }
    cargar()
  }

  const opcionesCambio = useMemo(() => {
    const t = buscarCambio.trim().toLowerCase()
    if (!t || !sel) return []
    const ya = new Set(cambios.map(c => c.clave))
    return (data?.productos || [])
      .filter(p => p.clave !== sel.clave && !ya.has(p.clave) && !bloqueadas.has(p.clave))
      .filter(p => p.nombre.toLowerCase().includes(t)).slice(0, 6)
  }, [buscarCambio, data, sel, cambios, bloqueadas])

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 560, width: '96%', maxHeight: '92vh', overflowY: 'auto', background: C.bg, border: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Icon name="ban" size={20} color={C.red} />
          <div className="pos-modal-title" style={{ margin: 0, flex: 1 }}>Se acabó · {storeName}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.mut, cursor: 'pointer' }}><Icon name="x" size={20} /></button>
        </div>
        <div style={{ color: C.mut, fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>
          Apaga un producto en el <b style={{ color: C.txt }}>delivery de la página web</b> solo en <b style={{ color: C.txt }}>{storeName}</b>.
          Las otras sucursales lo siguen vendiendo. Vuelve solo <b style={{ color: C.txt }}>mañana 6:00 a.m.</b>
        </div>

        {error && <div style={{ color: '#fca5a5', fontSize: 13, padding: '8px 0' }}>{error}</div>}
        {!data && !error && <div style={{ color: C.mut, fontSize: 13, padding: '8px 0' }}>Cargando…</div>}

        {data && (data.bloqueos || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.red, letterSpacing: 1, marginBottom: 6 }}>APAGADOS HOY</div>
            {data.bloqueos.map(b => (
              <div key={b.clave} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#2a0f12', border: '1px solid #5c1a20', borderRadius: 10, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>🚫 {b.nombre}</div>
                  <div style={{ color: C.mut, fontSize: 11 }}>
                    {b.motivo || 'Sin motivo'} · {b.quien || '—'} {horaSV(b.bloqueado_at)}
                    {(b.cambios || []).length > 0 && <> · Ofrece: {b.cambios.map(c => c.nombre || c).join(', ')}</>}
                  </div>
                </div>
                <button disabled={guardando} onClick={() => prender(b)}
                  style={{ background: C.green, color: '#04221b', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                  ✅ Ya hay
                </button>
              </div>
            ))}
          </div>
        )}

        {data && !sel && (
          <>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto que se acabó…"
                style={{ width: '100%', padding: '11px 12px 11px 36px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, color: C.txt, fontSize: 15, boxSizing: 'border-box' }} />
              <span style={{ position: 'absolute', left: 11, top: 11, color: C.mut }}><Icon name="search" size={16} /></span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {productos.slice(0, 60).map(p => (
                <button key={p.clave} onClick={() => abrir(p)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, color: C.txt, cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.nombre}</span>
                  <span style={{ fontSize: 11, color: C.mut }}>
                    {[p.suelto && 'solo', p.extra && 'extra', p.en_combos > 0 && `${p.en_combos} combos`].filter(Boolean).join(' · ')}
                  </span>
                  <span style={{ color: C.red, fontSize: 12, fontWeight: 800 }}>Se acabó</span>
                </button>
              ))}
              {productos.length === 0 && <div style={{ color: C.mut, fontSize: 13, padding: 8 }}>No hay productos con ese nombre.</div>}
            </div>
          </>
        )}

        {data && sel && (
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: C.txt, fontSize: 17, fontWeight: 800, marginBottom: 2 }}>🚫 {sel.nombre}</div>
            <div style={{ color: C.mut, fontSize: 12, marginBottom: 12 }}>
              Se quita del delivery web de {storeName}
              {sel.en_combos > 0 && <> y de los {sel.en_combos} combos que lo llevan (el cliente elige el cambio)</>}.
            </div>

            <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, letterSpacing: 1, marginBottom: 6 }}>¿POR QUÉ?</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {MOTIVOS.map(m => (
                <button key={m} onClick={() => setMotivo(m)}
                  style={{ padding: '8px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: motivo === m ? C.red : 'transparent', color: motivo === m ? '#fff' : C.txt,
                    border: `1px solid ${motivo === m ? C.red : C.line}` }}>{m}</button>
              ))}
            </div>

            {sel.en_combos > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, letterSpacing: 1, marginBottom: 6 }}>EN LOS COMBOS, OFRECER EN SU LUGAR</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {cambios.map(c => (
                    <span key={c.clave} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 20, background: '#0d1a18', border: `1px solid ${C.green}`, color: C.green, fontSize: 13, fontWeight: 700 }}>
                      {c.nombre}
                      <button onClick={() => setCambios(cambios.filter(x => x.clave !== c.clave))}
                        style={{ background: 'none', border: 'none', color: C.green, cursor: 'pointer', padding: 0, lineHeight: 0 }}><Icon name="x" size={14} /></button>
                    </span>
                  ))}
                  {cambios.length === 0 && <span style={{ color: C.mut, fontSize: 12 }}>Sin cambio: el combo se oculta.</span>}
                </div>
                <input value={buscarCambio} onChange={e => setBuscarCambio(e.target.value)} placeholder="+ Agregar otro cambio…"
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.txt, fontSize: 14, boxSizing: 'border-box', marginBottom: 4 }} />
                {opcionesCambio.map(p => (
                  <button key={p.clave} onClick={() => { setCambios([...cambios, { clave: p.clave, nombre: p.nombre }]); setBuscarCambio('') }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.line}`, color: C.txt, fontSize: 13, cursor: 'pointer' }}>
                    + {p.nombre}
                  </button>
                ))}
                <div style={{ height: 10 }} />
              </>
            )}

            <button disabled={guardando} onClick={apagar}
              style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: C.red, color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', marginBottom: 8 }}>
              {guardando ? 'Apagando…' : `Apagar ${sel.nombre} en ${storeName}`}
            </button>
            <button onClick={() => setSel(null)} className="pos-cancelar-btn" style={{ width: '100%' }}>Cancelar</button>
            <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
              Vuelve solo mañana 6:00 a.m. Si llega antes, tocá «✅ Ya hay».
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
