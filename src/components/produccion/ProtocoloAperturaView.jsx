import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   Protocolo de apertura — vista de la sucursal

   Por qué existe (Cesar, sep-2026): la apertura la hacen tres personas y
   nadie sabía qué había quedado sin hacer hasta que faltaba producto a
   media mañana. Esto no es una lista impresa: guarda quién marcó cada
   paso y a qué hora, y a las 11:30 el servidor cierra el día solo.

   Tres decisiones que lo hacen servir:
     1. La hora la pone el servidor (default now() en protocolo_marcas).
        Nunca se manda desde el teléfono.
     2. La foto se toma con la cámara (capture="environment"), no de la
        galería, y un paso que pide foto NO cuenta como hecho sin ella.
        Marcar la casilla sola no alcanza — es lo que el paso quería evitar.
     3. El contenido es una base común más lo propio de cada sucursal.
        Acá solo se lee: editar el protocolo vive en otra pantalla y pasa
        por funciones que validan el permiso en la base, no en el front.

   El error de guardado se muestra en pantalla a propósito. En el
   porcionador se perdió un turno entero de datos porque fallaba callado.
   ═══════════════════════════════════════════════════════════════════════ */

const BUCKET  = 'bpm-fotos'
const MOMENTO = 'apertura'

const hoyLocal = () => {
  // El día operativo es el de El Salvador (UTC-6), no el del navegador.
  const d = new Date(Date.now() - 6 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

const hora = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-SV', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador',
  })
}

export default function ProtocoloAperturaView({ user }) {
  const [suc, setSuc]         = useState(user?.store_code || '')
  const [sucursales, setSucs] = useState([])
  const [pasos, setPasos]     = useState([])
  const [marcas, setMarcas]   = useState({})      // paso_id -> marca
  const [corrida, setCorrida] = useState(null)
  const [cargando, setCarg]   = useState(true)
  const [error, setError]     = useState(null)
  const [guardando, setGuard] = useState(null)
  const [abierta, setAbierta] = useState(null)    // área desplegada
  const [puedeBase, setBase]  = useState(false)   // ¿puede cambiar el estándar común?
  const fileRef = useRef({})
  const refRef  = useRef({})

  const fecha = hoyLocal()

  // ── ¿Puede subir fotos a la base? ──
  useEffect(() => {
    if (!user?.id) return
    db.rpc('fn_protocolo_es_admin', { p_usuario: user.id })
      .then(({ data }) => setBase(!!data))
  }, [user?.id])

  // ── Sucursales a las que este usuario puede entrar ──
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await db.rpc('fn_protocolo_sucursales')
      if (!vivo) return
      const todas = data || []
      const mias = []
      for (const s of todas) {
        const { data: ok } = await db.rpc('fn_protocolo_puede_editar', {
          p_usuario: user?.id, p_store_code: s.store_code,
        })
        if (ok) mias.push(s)
      }
      // Un operario no "edita" su sucursal pero sí trabaja en ella.
      const lista = mias.length ? mias : todas.filter(s => s.store_code === user?.store_code)
      setSucs(lista)
      if (!lista.some(s => s.store_code === suc) && lista[0]) setSuc(lista[0].store_code)
    })()
    return () => { vivo = false }
  }, [user?.id])

  // ── Protocolo del día para esa sucursal ──
  async function cargar(storeCode) {
    if (!storeCode) return
    setCarg(true); setError(null)
    try {
      const { data: ps, error: e1 } = await db.rpc('fn_protocolo_de_sucursal', {
        p_store_code: storeCode, p_momento: MOMENTO,
      })
      if (e1) throw e1
      setPasos(ps || [])

      const { data: c, error: e2 } = await db
        .from('protocolo_corridas')
        .upsert({ fecha, store_code: storeCode, momento: MOMENTO },
                { onConflict: 'fecha,store_code,momento' })
        .select().single()
      if (e2) throw e2
      setCorrida(c)

      const { data: ms, error: e3 } = await db
        .from('protocolo_marcas').select('*').eq('corrida_id', c.id)
      if (e3) throw e3
      const mapa = {}
      ;(ms || []).forEach(m => { mapa[m.paso_id] = m })
      setMarcas(mapa)
      if (ps?.length && abierta === null) setAbierta(ps[0].area_id)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el protocolo')
    } finally {
      setCarg(false)
    }
  }
  useEffect(() => { cargar(suc) }, [suc])

  // ── Marcar / desmarcar ──
  async function marcar(paso, foto) {
    if (!corrida) return
    if (paso.requiere_foto && !foto && !marcas[paso.paso_id]?.foto_url) {
      setError(`«${paso.titulo}» pide foto. Tocá "Tomar foto" — marcarlo sin foto no cuenta como hecho.`)
      return
    }
    setGuard(paso.paso_id); setError(null)
    try {
      let fotoUrl = marcas[paso.paso_id]?.foto_url || null
      if (foto) {
        const path = `protocolo/${suc}/${fecha}/${paso.paso_id}-${Date.now()}.jpg`
        const { error: upErr } = await db.storage.from(BUCKET)
          .upload(path, foto, { cacheControl: '3600', upsert: false })
        if (upErr) throw upErr
        fotoUrl = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null
      }
      const { data, error: e } = await db.from('protocolo_marcas').upsert({
        corrida_id: corrida.id,
        paso_id: paso.paso_id,
        marcado_por: user?.id || null,
        marcado_nombre: user?.nombre || null,
        foto_url: fotoUrl,
      }, { onConflict: 'corrida_id,paso_id' }).select().single()
      if (e) throw e
      setMarcas(m => ({ ...m, [paso.paso_id]: data }))
    } catch (err) {
      // Que se vea. Un guardado que falla callado es peor que no guardar.
      setError(`No se guardó «${paso.titulo}»: ${err.message || err}`)
    } finally {
      setGuard(null)
    }
  }

  async function desmarcar(paso) {
    if (!corrida) return
    setGuard(paso.paso_id); setError(null)
    try {
      const { error: e } = await db.from('protocolo_marcas')
        .delete().eq('corrida_id', corrida.id).eq('paso_id', paso.paso_id)
      if (e) throw e
      setMarcas(m => { const n = { ...m }; delete n[paso.paso_id]; return n })
    } catch (err) {
      setError(`No se pudo desmarcar: ${err.message || err}`)
    } finally { setGuard(null) }
  }

  // ── Foto de referencia (la que explica el paso, no la del día) ──
  // Se comprime antes de subir: una foto de 4 MB del teléfono no se ve mejor
  // en la cocina, pero se baja entera cada mañana en las seis sucursales.
  function comprimir(file, max = 1000, q = 0.72) {
    return new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => {
        const e = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * e)
        c.height = Math.round(img.height * e)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        c.toBlob(b => b ? res(b) : rej(new Error('no se pudo comprimir')), 'image/jpeg', q)
      }
      img.onerror = () => rej(new Error('no se pudo leer la imagen'))
      img.src = window.URL.createObjectURL(file)
    })
  }

  async function subirReferencia(paso, file, deLaBase) {
    setGuard(paso.paso_id); setError(null)
    try {
      const blob = await comprimir(file)
      const dest = deLaBase ? 'base' : suc
      const path = `protocolo/ref/${dest}/${paso.paso_id}-${Date.now()}.jpg`
      const { error: up } = await db.storage.from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (up) throw up
      const url = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl
      const { error: e } = await db.rpc('fn_protocolo_guardar_foto', {
        p_usuario: user?.id, p_paso_id: paso.paso_id, p_url: url,
        p_caption: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
        p_store_code: deLaBase ? null : suc,
      })
      if (e) throw e
      await cargar(suc)
    } catch (err) {
      setError(`No se subió la foto de «${paso.titulo}»: ${err.message || err}`)
    } finally { setGuard(null) }
  }

  const hecho = (p) => {
    const m = marcas[p.paso_id]
    if (!m) return false
    return !p.requiere_foto || !!m.foto_url
  }

  const areas = useMemo(() => {
    const map = new Map()
    pasos.forEach(p => {
      if (!map.has(p.area_id)) {
        map.set(p.area_id, {
          id: p.area_id, nombre: p.area_nombre, color: p.area_color,
          sub: p.area_subtitulo, propia: p.area_propia, pasos: [],
        })
      }
      map.get(p.area_id).pasos.push(p)
    })
    return [...map.values()]
  }, [pasos])

  const total  = pasos.length
  const listos = pasos.filter(hecho).length

  if (cargando) return <div style={{ padding: 24, color: '#9ca3af' }}>Cargando el protocolo…</div>

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '14px 14px 70px' }}>

      {sucursales.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {sucursales.map(s => (
            <button key={s.store_code} onClick={() => { setAbierta(null); setSuc(s.store_code) }}
              style={{
                background: s.store_code === suc ? '#1e3a5f' : '#1f2937',
                border: `1px solid ${s.store_code === suc ? '#3b82f6' : '#2b3344'}`,
                color: s.store_code === suc ? '#bfdbfe' : '#cbd5e1',
                borderRadius: 7, padding: '6px 11px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}>{s.nombre}</button>
          ))}
        </div>
      )}

      <div style={{
        background: '#111827', border: '1px solid #262b36', borderRadius: 12,
        padding: '13px 15px', marginBottom: 14,
      }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>
          Apertura · {sucursales.find(s => s.store_code === suc)?.nombre || suc}
        </div>
        <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 2 }}>
          {new Date(fecha + 'T12:00:00').toLocaleDateString('es-SV',
            { weekday: 'long', day: 'numeric', month: 'long' })} · cierra a las 11:30
        </div>
        <div style={{
          marginTop: 10, height: 8, background: '#1f2937', borderRadius: 5, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: total ? `${listos / total * 100}%` : 0,
            background: listos === total && total ? '#22c55e' : '#f59e0b', transition: 'width .25s',
          }} />
        </div>
        <div style={{ fontSize: 13, marginTop: 6, fontWeight: 700, color: listos === total && total ? '#22c55e' : '#fbbf24' }}>
          {listos} de {total} · faltan {total - listos}
        </div>
      </div>

      {error && (
        <div style={{
          background: '#2a1210', border: '1px solid #7f1d1d', color: '#fecaca',
          borderRadius: 9, padding: '11px 13px', marginBottom: 12, fontSize: 13.5,
        }}>
          {error}
          <button onClick={() => setError(null)} style={{
            marginLeft: 10, background: 'none', border: 0, color: '#fca5a5',
            textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5,
          }}>cerrar</button>
        </div>
      )}

      {areas.map(a => {
        const h = a.pasos.filter(hecho).length
        const abiertaEsta = abierta === a.id
        return (
          <div key={a.id} style={{ marginBottom: 10 }}>
            <button onClick={() => setAbierta(abiertaEsta ? null : a.id)}
              style={{
                width: '100%', textAlign: 'left', background: '#171a21',
                border: '1px solid #262b36', borderLeft: `5px solid ${a.color}`,
                borderRadius: 10, padding: '11px 13px', cursor: 'pointer', color: '#e8eaed',
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              }}>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: a.color }}>
                {a.nombre}
                {a.propia && (
                  <span style={{
                    marginLeft: 8, fontSize: 10.5, fontWeight: 700, background: '#3b1d5e',
                    color: '#d8b4fe', padding: '2px 8px', borderRadius: 20,
                  }}>solo acá</span>
                )}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: h === a.pasos.length ? '#22c55e' : '#9ca3af' }}>
                {h}/{a.pasos.length}
              </span>
              <span style={{ color: '#6b7280', fontSize: 13 }}>{abiertaEsta ? '▲' : '▼'}</span>
            </button>

            {abiertaEsta && a.pasos.map((p, i) => {
              const ok = hecho(p)
              const m  = marcas[p.paso_id]
              const trabajando = guardando === p.paso_id
              return (
                <div key={p.paso_id} style={{
                  background: ok ? '#131a15' : '#171a21',
                  border: `1px solid ${ok ? '#1f3a24' : '#262b36'}`,
                  borderRadius: 10, padding: '11px 13px', margin: '6px 0 0 10px',
                }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <button
                      onClick={() => ok ? desmarcar(p) : marcar(p, null)}
                      disabled={trabajando}
                      style={{
                        flex: 'none', width: 24, height: 24, marginTop: 1, borderRadius: 6,
                        border: `2px solid ${ok ? '#22c55e' : '#4b5563'}`,
                        background: ok ? '#22c55e' : 'transparent', color: '#08120a',
                        fontWeight: 900, fontSize: 15, cursor: trabajando ? 'wait' : 'pointer',
                      }}>{ok ? '✓' : ''}</button>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: ok ? '#9ca3af' : '#e8eaed' }}>
                        {i + 1}. {p.titulo}
                        {p.requiere_foto && (
                          <span style={{
                            marginLeft: 7, fontSize: 10, fontWeight: 700, background: '#0b3b2e',
                            color: '#6ee7b7', padding: '2px 7px', borderRadius: 20,
                          }}>pide foto</span>
                        )}
                      </div>

                      {ok && m && (
                        <div style={{ fontSize: 12.5, color: '#6ee7b7', marginTop: 3 }}>
                          {m.marcado_nombre || 'marcado'} · {hora(m.marcado_at)}
                          {m.foto_url && ' · foto subida'}
                        </div>
                      )}

                      {!ok && (
                        <>
                          <div style={{ fontSize: 13.5, color: '#9ca3af', marginTop: 5 }}
                               dangerouslySetInnerHTML={{ __html: p.como || '' }} />

                          {Array.isArray(p.fotos) && p.fotos.length > 0 && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '9px 0' }}>
                              {p.fotos.map(f => (
                                <figure key={f.id} style={{ margin: 0, width: 170 }}>
                                  <img src={f.url} alt={f.caption || ''} style={{
                                    width: '100%', borderRadius: 7, border: '1px solid #2b313d', display: 'block',
                                  }} />
                                  <figcaption style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
                                    {f.caption}{f.es_de_base ? '' : ' · foto de esta sucursal'}
                                  </figcaption>
                                </figure>
                              ))}
                            </div>
                          )}

                          {(p.bien || p.mal) && (
                            <div style={{ display: 'grid', gap: 9, marginTop: 9 }}>
                              {p.bien && (
                                <div style={{ borderLeft: '3px solid #22c55e', paddingLeft: 9 }}>
                                  <div style={{ fontSize: 10.5, letterSpacing: .5, textTransform: 'uppercase', color: '#22c55e', fontWeight: 700 }}>
                                    Así se ve bien hecho
                                  </div>
                                  <div style={{ fontSize: 13, color: '#d1d5db' }}>{p.bien}</div>
                                </div>
                              )}
                              {p.mal && (
                                <div style={{ borderLeft: '3px solid #dc2626', paddingLeft: 9 }}>
                                  <div style={{ fontSize: 10.5, letterSpacing: .5, textTransform: 'uppercase', color: '#f87171', fontWeight: 700 }}>
                                    Lo que sale mal seguido
                                  </div>
                                  <div style={{ fontSize: 13, color: '#d1d5db' }}>{p.mal}</div>
                                </div>
                              )}
                            </div>
                          )}

                          {p.nota && (
                            <div style={{
                              marginTop: 9, background: '#2a1f06', border: '1px solid #78350f',
                              color: '#fcd34d', padding: '8px 11px', borderRadius: 8, fontSize: 12.5,
                            }}>{p.nota}</div>
                          )}

                          {puedeBase && (
                            <div style={{ marginTop: 9 }}>
                              <button onClick={() => refRef.current[p.paso_id]?.click()}
                                disabled={trabajando}
                                style={{
                                  background: '#1e3a5f', color: '#bfdbfe', border: 0, borderRadius: 7,
                                  padding: '6px 11px', fontWeight: 700, fontSize: 11.5, cursor: 'pointer',
                                }}>
                                {trabajando ? 'subiendo…' : '+ Foto de referencia (todas las sucursales)'}
                              </button>
                              <input
                                ref={el => { refRef.current[p.paso_id] = el }}
                                type="file" accept="image/*" hidden
                                onChange={e => {
                                  const f = e.target.files?.[0]
                                  e.target.value = ''
                                  if (f) subirReferencia(p, f, true)
                                }} />
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {p.requiere_foto && !ok && (
                      <>
                        <button onClick={() => fileRef.current[p.paso_id]?.click()}
                          disabled={trabajando}
                          style={{
                            background: '#0b3b2e', color: '#6ee7b7', border: 0, borderRadius: 7,
                            padding: '7px 11px', fontWeight: 700, fontSize: 12, cursor: 'pointer', flex: 'none',
                          }}>{trabajando ? '…' : 'Tomar foto'}</button>
                        <input
                          ref={el => { fileRef.current[p.paso_id] = el }}
                          type="file" accept="image/*" capture="environment" hidden
                          onChange={e => {
                            const f = e.target.files?.[0]
                            e.target.value = ''
                            if (f) marcar(p, f)
                          }} />
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {!total && (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
          No hay pasos cargados para esta sucursal.
        </div>
      )}
    </div>
  )
}
