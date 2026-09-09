import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   Editor del protocolo — la pantalla donde se ESCRIBE el protocolo
   (la apertura del día se marca en ProtocoloAperturaView).

   Una sola pantalla para dos personas distintas:
   · Cesar (administrador) edita la BASE: lo que ven las seis sucursales.
   · La encargada edita SU sucursal: puede reescribir un paso de la base
     solo para su local, ocultarlo con motivo, agregar pasos y áreas
     propias, y subir su propia foto encima de la de base.

   Lo que la base no deja hacer desde una sucursal, esta pantalla lo
   muestra deshabilitado con el porqué al lado, no lo esconde.
   ═══════════════════════════════════════════════════════════════════════ */

const BUCKET  = 'bpm-fotos'
const MOMENTO = 'apertura'
const COLORES = ['#f59e0b', '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#a855f7', '#06b6d4', '#ec4899']

const VACIO = { titulo: '', como: '', bien: '', mal: '', nota: '', requiere_foto: false }

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

const cuando = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
}

export default function ProtocoloEditorView({ user, onVolver }) {
  const [esAdmin, setEsAdmin]   = useState(false)
  const [ambitos, setAmbitos]   = useState([])      // [{code, nombre}]  code null = base
  const [ambito, setAmbito]     = useState(undefined)
  const [filas, setFilas]       = useState([])
  const [avisos, setAvisos]     = useState([])
  const [areaSel, setAreaSel]   = useState(null)
  const [editando, setEditando] = useState(null)    // paso_id | 'nuevo'
  const [form, setForm]         = useState(VACIO)
  const [areaForm, setAreaForm] = useState(null)    // null | {id?, nombre, subtitulo, color}
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado]   = useState(false)
  const [error, setError]       = useState(null)
  const [aviso, setAviso]       = useState(null)    // toast verde
  const [movil, setMovil]       = useState(window.innerWidth < 820)
  useEffect(() => {
    const h = () => setMovil(window.innerWidth < 820)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const enBase = ambito === null
  const nombreAmbito = enBase ? 'Base · todas las sucursales'
    : (ambitos.find(a => a.code === ambito)?.nombre || ambito)

  // ── Quién soy y qué puedo editar ──
  useEffect(() => {
    if (!user?.id) return
    let vivo = true
    ;(async () => {
      const [{ data: admin }, { data: sucs }] = await Promise.all([
        db.rpc('fn_protocolo_es_admin', { p_usuario: user.id }),
        db.rpc('fn_protocolo_sucursales'),
      ])
      const lista = []
      if (admin) lista.push({ code: null, nombre: 'Base · todas las sucursales' })
      for (const s of sucs || []) {
        const { data: ok } = await db.rpc('fn_protocolo_puede_editar',
          { p_usuario: user.id, p_store_code: s.store_code })
        if (ok) lista.push({ code: s.store_code, nombre: s.nombre })
      }
      if (!vivo) return
      setEsAdmin(!!admin)
      setAmbitos(lista)
      setAmbito(lista.length ? lista[0].code : undefined)
      if (!lista.length) { setCargando(false); setError('Tu usuario no tiene permiso para editar el protocolo.') }
    })()
    return () => { vivo = false }
  }, [user?.id])

  // ── Cargar áreas + pasos + avisos del ámbito ──
  async function cargar() {
    if (ambito === undefined) return
    setCargando(true); setError(null)
    const [{ data, error: e1 }, { data: av }] = await Promise.all([
      db.rpc('fn_protocolo_editor', { p_usuario: user.id, p_store_code: ambito, p_momento: MOMENTO }),
      db.rpc('fn_protocolo_avisos', { p_usuario: user.id, p_store_code: ambito }),
    ])
    if (e1) setError(e1.message)
    setFilas(data || [])
    setAvisos(av || [])
    setCargando(false)
  }
  useEffect(() => { cargar(); setEditando(null); setAreaForm(null) }, [ambito]) // eslint-disable-line

  const areas = useMemo(() => {
    const map = new Map()
    filas.forEach(f => {
      if (!map.has(f.area_id)) {
        map.set(f.area_id, {
          id: f.area_id, nombre: f.area_nombre, subtitulo: f.area_subtitulo,
          color: f.area_color, orden: f.area_orden, propia: f.area_propia, pasos: [],
        })
      }
      if (f.paso_id) map.get(f.area_id).pasos.push(f)
    })
    return [...map.values()]
  }, [filas])

  useEffect(() => {
    if (areas.length && !areas.some(a => a.id === areaSel)) setAreaSel(areas[0].id)
  }, [areas, areaSel])

  const area = areas.find(a => a.id === areaSel)

  // ── Qué puedo hacer con un paso dado ──
  // Un paso de la base, desde una sucursal, se edita "por encima" (versión
  // local). Un paso propio se edita directo. Todo lo de la base, desde la
  // base, también directo.
  const modo = (p) => {
    if (!p || p === 'nuevo') return 'directo'
    if (enBase) return 'directo'
    return p.es_base ? 'local' : 'directo'
  }

  function ok(msg) { setAviso(msg); setTimeout(() => setAviso(null), 2600) }
  async function correr(fn, exito) {
    setOcupado(true); setError(null)
    try { await fn(); if (exito) ok(exito); await cargar() }
    catch (err) { setError(err.message || String(err)) }
    finally { setOcupado(false) }
  }

  // ── Editor de paso ──
  function abrir(p) {
    setError(null)
    setEditando(p.paso_id)
    setForm({
      titulo: p.titulo || '', como: p.como || '', bien: p.bien || '', mal: p.mal || '',
      nota: p.nota || '', requiere_foto: !!p.requiere_foto,
    })
  }
  function abrirNuevo(prefill = {}) {
    setError(null)
    setEditando('nuevo')
    setForm({ ...VACIO, ...prefill })
  }

  async function guardar(p) {
    if (!form.titulo.trim()) { setError('El paso necesita un título.'); return }
    const t = (s) => (s || '').trim() || null
    await correr(async () => {
      if (modo(p) === 'local') {
        // Versión de la sucursal: lo que quede igual a la base va null y sigue
        // heredando. Solo se congela lo que de verdad cambió.
        const ig = (a, b) => (a || '').trim() === (b || '').trim()
        const { error: e } = await db.rpc('fn_protocolo_guardar_local', {
          p_usuario: user.id, p_paso_id: p.paso_id, p_store_code: ambito,
          p_titulo: ig(form.titulo, p.base_titulo) ? null : form.titulo.trim(),
          p_como:   ig(form.como,   p.base_como)   ? null : t(form.como),
          p_bien:   ig(form.bien,   p.base_bien)   ? null : t(form.bien),
          p_mal:    ig(form.mal,    p.base_mal)    ? null : t(form.mal),
        })
        if (e) throw e
      } else {
        const { error: e } = await db.rpc('fn_protocolo_guardar_paso', {
          p_usuario: user.id, p_area_id: areaSel,
          p_titulo: form.titulo.trim(), p_como: t(form.como), p_bien: t(form.bien),
          p_mal: t(form.mal), p_nota: t(form.nota), p_requiere_foto: !!form.requiere_foto,
          p_paso_id: p === 'nuevo' ? null : p.paso_id,
          p_orden: null, p_store_code: ambito,
        })
        if (e) throw e
        if (p === 'nuevo' && form._avisoId) {
          await db.rpc('fn_protocolo_resolver_aviso',
            { p_usuario: user.id, p_aviso_id: form._avisoId, p_estado: 'convertido' })
        }
      }
      setEditando(null)
    }, 'Guardado')
  }

  async function quitar(p) {
    if (modo(p) === 'local') {
      const motivo = window.prompt(
        `¿Por qué no aplica «${p.titulo}» en ${nombreAmbito}?\n\nQueda registrado y le llega el aviso al administrador.`)
      if (motivo === null) return
      if (!motivo.trim()) { setError('Sin motivo no se puede ocultar un paso.'); return }
      await correr(async () => {
        const { error: e } = await db.rpc('fn_protocolo_ocultar_paso',
          { p_usuario: user.id, p_store_code: ambito, p_paso_id: p.paso_id, p_motivo: motivo.trim() })
        if (e) throw e
        setEditando(null)
      }, 'Oculto en esta sucursal')
      return
    }
    if (!window.confirm(`¿Quitar «${p.titulo}»?${enBase ? '\n\nDesaparece de las seis sucursales.' : ''}`)) return
    await correr(async () => {
      const { error: e } = await db.rpc('fn_protocolo_borrar_paso', { p_usuario: user.id, p_paso_id: p.paso_id })
      if (e) throw e
      setEditando(null)
    }, 'Paso quitado')
  }

  const mostrar = (p) => correr(async () => {
    const { error: e } = await db.rpc('fn_protocolo_mostrar_paso',
      { p_usuario: user.id, p_store_code: ambito, p_paso_id: p.paso_id })
    if (e) throw e
  }, 'Vuelve a verse')

  const volverBase = (p) => correr(async () => {
    const { error: e } = await db.rpc('fn_protocolo_volver_a_la_base',
      { p_usuario: user.id, p_paso_id: p.paso_id, p_store_code: ambito })
    if (e) throw e
    setEditando(null)
  }, 'De vuelta a la base')

  const critico = (p, v) => correr(async () => {
    const { error: e } = await db.rpc('fn_protocolo_marcar_critico',
      { p_usuario: user.id, p_paso_id: p.paso_id, p_critico: v })
    if (e) throw e
  })

  // Reordenar: intercambia el `orden` con el vecino. Los pasos de la base
  // desde una sucursal no se mueven (el orden es parte del estándar).
  async function mover(p, dir) {
    const lista = area.pasos
    const i = lista.findIndex(x => x.paso_id === p.paso_id)
    const j = i + dir
    if (j < 0 || j >= lista.length) return
    const q = lista[j]
    await correr(async () => {
      let r = await db.rpc('fn_protocolo_reordenar', { p_usuario: user.id, p_paso_id: p.paso_id, p_orden: q.paso_orden })
      if (r.error) throw r.error
      r = await db.rpc('fn_protocolo_reordenar', { p_usuario: user.id, p_paso_id: q.paso_id, p_orden: p.paso_orden })
      if (r.error) throw r.error
    })
  }
  async function moverArea(a, dir) {
    const i = areas.findIndex(x => x.id === a.id)
    const j = i + dir
    if (j < 0 || j >= areas.length) return
    const b = areas[j]
    await correr(async () => {
      let r = await db.rpc('fn_protocolo_reordenar_area', { p_usuario: user.id, p_area_id: a.id, p_orden: b.orden })
      if (r.error) throw r.error
      r = await db.rpc('fn_protocolo_reordenar_area', { p_usuario: user.id, p_area_id: b.id, p_orden: a.orden })
      if (r.error) throw r.error
    })
  }

  // ── Fotos ──
  async function subirFoto(p, file) {
    await correr(async () => {
      const blob = await comprimir(file)
      const dest = enBase ? 'base' : ambito
      const path = `protocolo/ref/${dest}/${p.paso_id}-${Date.now()}.jpg`
      const { error: up } = await db.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
      if (up) throw up
      const url = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl
      const { error: e } = await db.rpc('fn_protocolo_guardar_foto', {
        p_usuario: user.id, p_paso_id: p.paso_id, p_url: url,
        p_caption: file.name.replace(/\.[^.]+$/, '').slice(0, 60), p_store_code: ambito,
      })
      if (e) throw e
    }, 'Foto subida')
  }
  const borrarFoto = (f) => correr(async () => {
    const { error: e } = await db.rpc('fn_protocolo_borrar_foto', { p_usuario: user.id, p_foto_id: f.id })
    if (e) throw e
  })

  // ── Áreas ──
  async function guardarArea() {
    if (!areaForm?.nombre?.trim()) { setError('El área necesita un nombre.'); return }
    await correr(async () => {
      const { error: e } = await db.rpc('fn_protocolo_guardar_area', {
        p_usuario: user.id, p_momento: MOMENTO, p_nombre: areaForm.nombre.trim(),
        p_subtitulo: (areaForm.subtitulo || '').trim() || null, p_color: areaForm.color || '#3b82f6',
        p_rol: null, p_area_id: areaForm.id || null, p_orden: null, p_store_code: ambito,
      })
      if (e) throw e
      setAreaForm(null)
    }, 'Área guardada')
  }
  async function quitarArea(a) {
    if (!window.confirm(`¿Quitar el área «${a.nombre}» con sus ${a.pasos.length} paso(s)?`)) return
    await correr(async () => {
      const { error: e } = await db.rpc('fn_protocolo_borrar_area', { p_usuario: user.id, p_area_id: a.id })
      if (e) throw e
    }, 'Área quitada')
  }

  // ── Avisos ──
  const descartar = (av) => correr(async () => {
    const { error: e } = await db.rpc('fn_protocolo_resolver_aviso',
      { p_usuario: user.id, p_aviso_id: av.id, p_estado: 'descartado' })
    if (e) throw e
  })
  function convertir(av) {
    if (av.area_id && areas.some(a => a.id === av.area_id)) setAreaSel(av.area_id)
    abrirNuevo({ como: av.texto, _avisoId: av.id })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ═══════════════════════════ UI ═══════════════════════════
  const S = estilos
  if (ambito === undefined && !error) return <div style={S.pagina}><div style={S.gris}>Cargando…</div></div>

  return (
    <div style={S.pagina}>
      <div style={S.top}>
        {onVolver && <button onClick={onVolver} style={S.bt}>← Apertura</button>}
        <h1 style={S.h1}>Editor del protocolo · Apertura</h1>
        <span style={S.chip}>{user?.nombre}{esAdmin ? ' · admin' : ''}</span>
        {ambitos.length > 1 && (
          <select value={ambito ?? ''} onChange={e => setAmbito(e.target.value === '' ? null : e.target.value)}
            style={S.select}>
            {ambitos.map(a => <option key={a.code ?? 'base'} value={a.code ?? ''}>{a.nombre}</option>)}
          </select>
        )}
        {ambitos.length === 1 && <span style={{ ...S.chip, background: '#1f2937', color: '#cbd5e1' }}>{nombreAmbito}</span>}
      </div>

      {aviso && <div style={S.toast}>{aviso}</div>}
      {error && (
        <div style={S.error}>{error}
          <button onClick={() => setError(null)} style={S.cerrar}>✕</button>
        </div>
      )}

      {!enBase && (
        <div style={S.nota}>
          Estás editando <b>{nombreAmbito}</b>. Los pasos de la base se cambian solo para
          esta sucursal; la base queda igual para las demás. Lo que agregues acá es propio de este local.
        </div>
      )}

      <div style={{ ...S.wrap, gridTemplateColumns: movil ? '1fr' : S.wrap.gridTemplateColumns }}>
        {/* ── Áreas ── */}
        <aside>
          <h3 style={S.h3}>Áreas</h3>
          {areas.map((a, i) => (
            <div key={a.id} onClick={() => { setAreaSel(a.id); setEditando(null) }}
              style={{ ...S.aitem, borderLeftColor: a.color,
                       ...(a.id === areaSel ? S.aitemOn : {}) }}>
              <span style={{ flex: 1 }}>
                {a.nombre}
                {a.propia && <span style={S.mini}> · propia</span>}
              </span>
              <span style={S.cnt}>{a.pasos.length}</span>
              {(enBase || a.propia) && (
                <span style={S.flechas} onClick={e => e.stopPropagation()}>
                  <button onClick={() => moverArea(a, -1)} disabled={ocupado || i === 0} style={S.fl}>▲</button>
                  <button onClick={() => moverArea(a, +1)} disabled={ocupado || i === areas.length - 1} style={S.fl}>▼</button>
                </span>
              )}
            </div>
          ))}
          {areaForm && !areaForm.id ? (
            <FormArea f={areaForm} set={setAreaForm} onOk={guardarArea} ocupado={ocupado} S={S} />
          ) : (
            <button onClick={() => setAreaForm({ nombre: '', subtitulo: '', color: COLORES[areas.length % COLORES.length] })}
              style={{ ...S.bt, ...S.btGh }}>+ Agregar área</button>
          )}
        </aside>

        {/* ── Pasos del área ── */}
        <main>
          {cargando && <div style={S.gris}>Cargando…</div>}
          {!cargando && area && (
            <>
              <div style={S.areaHead}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: area.color }}>{area.nombre}</div>
                  {area.subtitulo && <div style={S.gris}>{area.subtitulo}</div>}
                </div>
                {(enBase || area.propia) && (
                  <button onClick={() => setAreaForm({ id: area.id, nombre: area.nombre, subtitulo: area.subtitulo || '', color: area.color })}
                    style={S.bt}>Editar área</button>
                )}
                {area.propia && <button onClick={() => quitarArea(area)} disabled={ocupado} style={{ ...S.bt, ...S.btRed }}>Quitar área</button>}
              </div>
              {areaForm?.id === area.id && (
                <div style={{ ...S.card, padding: 14 }}>
                  <FormArea f={areaForm} set={setAreaForm} onOk={guardarArea} ocupado={ocupado} S={S} />
                </div>
              )}

              {area.pasos.map((p, i) => (
                <Paso key={p.paso_id} p={p} i={i} n={area.pasos.length}
                  abierto={editando === p.paso_id} modo={modo(p)} enBase={enBase} esAdmin={esAdmin}
                  ocupado={ocupado} form={form} setForm={setForm} S={S}
                  onAbrir={() => abrir(p)} onCerrar={() => setEditando(null)}
                  onGuardar={() => guardar(p)} onQuitar={() => quitar(p)}
                  onMostrar={() => mostrar(p)} onVolverBase={() => volverBase(p)}
                  onCritico={v => critico(p, v)} onMover={d => mover(p, d)}
                  onFoto={f => subirFoto(p, f)} onBorrarFoto={borrarFoto} />
              ))}

              {editando === 'nuevo' ? (
                <div style={S.card}>
                  <div style={S.chead}>
                    <span style={{ ...S.num, background: '#3b82f6', color: '#fff' }}>+</span>
                    <span style={S.ct}>Paso nuevo en {area.nombre}</span>
                    {!enBase && <span style={S.tagLocal}>solo {nombreAmbito}</span>}
                  </div>
                  <Formulario form={form} setForm={setForm} modo="directo" p={null} S={S}
                    puedeFoto puedeNota fotos={[]} />
                  <div style={S.acts}>
                    <button onClick={() => setEditando(null)} style={S.bt}>Cancelar</button>
                    <button onClick={() => guardar('nuevo')} disabled={ocupado} style={{ ...S.bt, ...S.btPri }}>
                      {ocupado ? 'guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => abrirNuevo()} style={{ ...S.bt, ...S.btGh }}>
                  + Agregar paso a {area.nombre.toLowerCase()}
                </button>
              )}
            </>
          )}
          {!cargando && !area && !error && (
            <div style={S.gris}>No hay áreas todavía. Agregá la primera a la izquierda.</div>
          )}

          {/* ── Avisos ── */}
          {avisos.length > 0 && (
            <div style={S.avisos}>
              <h3 style={S.avH}>Avisos de los colaboradores</h3>
              <div style={S.avSub}>
                Ellos no pueden editar el protocolo, pero sí avisar que falta algo. Vos decidís si lo convertís en paso.
              </div>
              {avisos.map(av => (
                <div key={av.id} style={S.av}>
                  {av.paso_titulo
                    ? <b>Sobre «{av.paso_titulo}»</b>
                    : <b>Falta un paso{av.area_nombre ? ` en ${av.area_nombre}` : ''}</b>}
                  <div style={{ marginTop: 3 }}>«{av.texto}»</div>
                  <div style={S.avQ}>{av.creado_nombre} · {cuando(av.created_at)}{av.sucursal ? ` · ${av.sucursal}` : ''}</div>
                  <div style={S.avRow}>
                    <button onClick={() => convertir(av)} disabled={ocupado} style={{ ...S.bt, ...S.btPri }}>Convertir en paso</button>
                    <button onClick={() => descartar(av)} disabled={ocupado} style={S.bt}>Descartar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

/* ───────────────────────── tarjeta de un paso ───────────────────────── */
function Paso({ p, i, n, abierto, modo, enBase, esAdmin, ocupado, form, setForm, S,
                onAbrir, onCerrar, onGuardar, onQuitar, onMostrar, onVolverBase, onCritico, onMover,
                onFoto, onBorrarFoto }) {
  const incompleto = !p.bien && !p.mal
  const puedeMover = enBase || !p.es_base
  const puedeFoto  = enBase || !p.es_base   // "pide foto" es parte del estándar
  const puedeNota  = enBase || !p.es_base
  const propioRef  = useRef(null)

  return (
    <div style={{ ...S.card, opacity: p.oculto ? .6 : 1 }}>
      <div style={S.chead}>
        <span style={S.flechas}>
          <button onClick={() => onMover(-1)} disabled={ocupado || !puedeMover || i === 0} style={S.fl}
            title={puedeMover ? 'Subir' : 'El orden de la base lo define el administrador'}>▲</button>
          <button onClick={() => onMover(+1)} disabled={ocupado || !puedeMover || i === n - 1} style={S.fl}>▼</button>
        </span>
        <span style={{ ...S.num, background: p.oculto ? '#4b5563' : (p.es_critico ? '#dc2626' : '#22c55e'), color: p.es_critico ? '#fff' : '#0f1115' }}>{i + 1}</span>
        <span style={{ ...S.ct, textDecoration: p.oculto ? 'line-through' : 'none' }}>{p.titulo}</span>
        {p.requiere_foto && <span style={S.tagFoto}>pide foto</span>}
        {p.es_critico && <span style={S.tagCrit}>crítico</span>}
        {incompleto && !p.oculto && <span style={S.tagPend}>incompleto</span>}
        {p.campos_propios?.length > 0 && <span style={S.tagLocal} title={p.editado_por ? `por ${p.editado_por}` : ''}>versión de esta sucursal</span>}
        {!p.es_base && !enBase && <span style={S.tagLocal}>propio</span>}
        {p.oculto
          ? <button onClick={onMostrar} disabled={ocupado} style={S.bt}>Volver a mostrar</button>
          : <button onClick={abierto ? onCerrar : onAbrir} style={S.bt}>{abierto ? 'Cerrar' : 'Editar'}</button>}
      </div>
      {p.oculto && <div style={S.meta}>Oculto en esta sucursal: {p.oculto_motivo}</div>}
      {!abierto && incompleto && !p.oculto && (
        <div style={S.meta}>Sin «cómo se ve bien hecho» ni «lo que sale mal». El paso existe pero está vacío por dentro.</div>
      )}

      {abierto && (
        <>
          <Formulario form={form} setForm={setForm} modo={modo} p={p} S={S}
            puedeFoto={puedeFoto} puedeNota={puedeNota} fotos={p.fotos || []}
            onFoto={onFoto} onBorrarFoto={onBorrarFoto} enBase={enBase} ocupado={ocupado} fotoRef={propioRef} />

          {esAdmin && enBase && (
            <label style={{ ...S.sw, margin: '0 14px 14px' }}>
              <input type="checkbox" checked={!!p.es_critico} onChange={e => onCritico(e.target.checked)} disabled={ocupado} />
              <div>
                <b>Paso crítico</b>
                <p style={S.swP}>No se puede ocultar en ninguna sucursal, y si una encargada lo reescribe te llega el aviso con el antes y el después.</p>
              </div>
            </label>
          )}

          <div style={S.acts}>
            {modo === 'local' && p.campos_propios?.length > 0 && (
              <button onClick={onVolverBase} disabled={ocupado} style={S.bt}>Volver a la base</button>
            )}
            {!(modo === 'local' && p.es_critico) && (
              <button onClick={onQuitar} disabled={ocupado} style={{ ...S.bt, ...S.btRed, marginRight: 'auto' }}>
                {modo === 'local' ? 'No aplica acá' : 'Quitar paso'}
              </button>
            )}
            {modo === 'local' && p.es_critico && (
              <span style={{ ...S.gris, marginRight: 'auto', alignSelf: 'center' }}>Crítico: no se puede ocultar.</span>
            )}
            <button onClick={onCerrar} style={S.bt}>Cancelar</button>
            <button onClick={onGuardar} disabled={ocupado} style={{ ...S.bt, ...S.btPri }}>{ocupado ? 'guardando…' : 'Guardar'}</button>
          </div>
        </>
      )}
    </div>
  )
}

/* ───────────────────────── formulario del paso ───────────────────────── */
function Formulario({ form, setForm, modo, p, S, puedeFoto, puedeNota, fotos, onFoto, onBorrarFoto, enBase, ocupado, fotoRef }) {
  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(x => ({ ...x, [k]: e.target.value })) })
  const heredado = (k) => modo === 'local' && p && !(p.campos_propios || []).includes(k)
  return (
    <div style={S.form}>
      {modo === 'local' && (
        <div style={{ ...S.nota, marginTop: 0, marginBottom: 14 }}>
          Este paso es de la base. Lo que cambies acá vale solo para esta sucursal; lo que dejes
          igual sigue a la base y se actualiza solo si cambia el estándar.
        </div>
      )}
      <div style={S.f}>
        <label style={S.lbl}>Título del paso {heredado('titulo') && <em style={S.her}>heredado</em>}</label>
        <input type="text" {...f('titulo')} style={S.inp} />
      </div>
      <div style={S.f}>
        <label style={S.lbl}>Cómo se hace {heredado('como') && <em style={S.her}>heredado</em>}</label>
        <textarea rows={4} {...f('como')} style={S.inp} />
        <div style={S.ayuda}>Las instrucciones que sigue la persona. Podés numerarlas.</div>
      </div>
      <div style={S.dos}>
        <div style={S.f}>
          <label style={{ ...S.lbl, color: '#22c55e' }}>Cómo se ve bien hecho {heredado('bien') && <em style={S.her}>heredado</em>}</label>
          <textarea rows={3} {...f('bien')} style={S.inp} />
        </div>
        <div style={S.f}>
          <label style={{ ...S.lbl, color: '#f87171' }}>Lo que sale mal seguido {heredado('mal') && <em style={S.her}>heredado</em>}</label>
          <textarea rows={3} {...f('mal')} style={S.inp} />
        </div>
      </div>
      {puedeNota && (
        <div style={S.f}>
          <label style={S.lbl}>Nota o pendiente (opcional)</label>
          <input type="text" {...f('nota')} style={S.inp} />
          <div style={S.ayuda}>Sale en amarillo. Sirve para dejar marcado lo que aún no está resuelto.</div>
        </div>
      )}

      {p && (
        <div style={S.f}>
          <label style={S.lbl}>Fotos de apoyo</label>
          <div style={S.fotos}>
            {fotos.map(ft => (
              <div key={ft.id} style={S.fbox}>
                <img src={ft.url} alt={ft.caption || ''} loading="lazy" style={S.fimg} />
                {(enBase ? ft.es_de_base : !ft.es_de_base) && (
                  <button onClick={() => onBorrarFoto(ft)} disabled={ocupado} style={S.fx} title="Quitar foto">quitar</button>
                )}
                <div style={S.fcap}>{ft.caption}{ft.es_de_base && !enBase ? ' · de la base' : ''}</div>
              </div>
            ))}
            <div onClick={() => fotoRef.current?.click()} style={S.addf}>
              + Subir foto{!enBase ? ' de esta sucursal' : ''}
            </div>
            <input ref={fotoRef} type="file" accept="image/*" hidden
              onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; if (x) onFoto(x) }} />
          </div>
          {!enBase && fotos.some(ft => ft.es_de_base) && (
            <div style={S.ayuda}>La foto de la base no se borra desde acá. Subí la tuya y la reemplaza solo en esta sucursal.</div>
          )}
        </div>
      )}

      <label style={{ ...S.sw, opacity: puedeFoto ? 1 : .55 }}>
        <input type="checkbox" checked={!!form.requiere_foto} disabled={!puedeFoto}
          onChange={e => setForm(x => ({ ...x, requiere_foto: e.target.checked }))} />
        <div>
          <b>Este paso pide foto al hacerlo</b>
          <p style={S.swP}>
            {puedeFoto
              ? 'La persona no puede marcarlo como hecho sin subir una foto. Usalo solo cuando lo que hay que verificar deja de verse al terminar.'
              : 'Esto lo define la base para las seis sucursales. Si creés que este paso debería pedir foto, mandá un aviso.'}
          </p>
        </div>
      </label>
    </div>
  )
}

function FormArea({ f, set, onOk, ocupado, S }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <input type="text" placeholder="Nombre del área" value={f.nombre}
        onChange={e => set(x => ({ ...x, nombre: e.target.value }))} style={S.inp} autoFocus />
      <input type="text" placeholder="Subtítulo (opcional)" value={f.subtitulo || ''}
        onChange={e => set(x => ({ ...x, subtitulo: e.target.value }))} style={S.inp} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {COLORES.map(c => (
          <button key={c} onClick={() => set(x => ({ ...x, color: c }))} style={{
            width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
            border: f.color === c ? '3px solid #fff' : '2px solid transparent',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => set(null)} style={S.bt}>Cancelar</button>
        <button onClick={onOk} disabled={ocupado} style={{ ...S.bt, ...S.btPri }}>Guardar</button>
      </div>
    </div>
  )
}

/* ───────────────────────── estilos (del prototipo) ───────────────────────── */
const estilos = {
  pagina: { background: '#0f1115', color: '#e8eaed', minHeight: '100vh', fontSize: 15, lineHeight: 1.5 },
  top: { position: 'sticky', top: 0, zIndex: 20, background: '#111827', borderBottom: '3px solid #dc2626',
         padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 17, flex: 1 },
  chip: { background: '#1e3a5f', color: '#bfdbfe', borderRadius: 20, padding: '5px 13px', fontSize: 13, fontWeight: 700 },
  select: { background: '#0f1115', color: '#e8eaed', border: '1px solid #2b3344', borderRadius: 8, padding: '7px 10px', font: 'inherit', fontSize: 13, fontWeight: 700 },
  wrap: { maxWidth: 1120, margin: '0 auto', padding: '18px 20px 70px', display: 'grid',
          gridTemplateColumns: 'minmax(0, 250px) minmax(0, 1fr)', gap: 20 },
  h3: { fontSize: 11, letterSpacing: .7, textTransform: 'uppercase', color: '#6b7280', margin: '0 0 8px' },
  aitem: { display: 'flex', alignItems: 'center', gap: 6, background: '#171a21', border: '1px solid #262b36',
           borderLeft: '4px solid', borderRadius: 8, padding: '9px 12px', marginBottom: 6, cursor: 'pointer',
           fontSize: 14, fontWeight: 600 },
  aitemOn: { background: '#1e2430', borderColor: '#3b82f6' },
  mini: { color: '#93c5fd', fontSize: 11, fontWeight: 700 },
  cnt: { color: '#6b7280', fontSize: 12, fontWeight: 400 },
  flechas: { display: 'flex', flexDirection: 'column', gap: 1 },
  fl: { background: 'none', border: 0, color: '#6b7280', cursor: 'pointer', fontSize: 9, lineHeight: 1, padding: '2px 4px' },
  card: { background: '#171a21', border: '1px solid #262b36', borderRadius: 11, marginBottom: 10, overflow: 'hidden' },
  chead: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', flexWrap: 'wrap' },
  num: { flex: 'none', width: 27, height: 27, borderRadius: '50%', fontWeight: 800, display: 'grid', placeItems: 'center', fontSize: 13 },
  ct: { flex: 1, fontWeight: 700, fontSize: 16, minWidth: 160 },
  tagFoto: { background: '#0b3b2e', color: '#6ee7b7', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 },
  tagPend: { background: '#78350f', color: '#fcd34d', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 },
  tagCrit: { background: '#450a0a', color: '#fca5a5', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 },
  tagLocal: { background: '#1e3a5f', color: '#bfdbfe', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 },
  bt: { background: '#1f2937', color: '#cbd5e1', border: 0, borderRadius: 7, padding: '7px 12px', font: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btRed: { background: '#3b1717', color: '#fca5a5' },
  btPri: { background: '#22c55e', color: '#08120a' },
  btGh: { background: 'transparent', border: '1px dashed #4b5563', color: '#9ca3af', width: '100%', padding: 14 },
  form: { borderTop: '1px solid #262b36', padding: '16px 14px', background: '#12151c' },
  f: { marginBottom: 14 },
  lbl: { display: 'block', fontSize: 12, letterSpacing: .5, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 5 },
  her: { fontSize: 10, color: '#6b7280', fontStyle: 'normal', textTransform: 'none', letterSpacing: 0, marginLeft: 6, background: '#1f2937', padding: '1px 6px', borderRadius: 10 },
  ayuda: { fontSize: 12, color: '#6b7280', marginTop: 3 },
  inp: { width: '100%', background: '#0f1115', border: '1px solid #2b3344', borderRadius: 8, color: '#e8eaed',
         padding: '10px 12px', font: 'inherit', fontSize: 15, resize: 'vertical', boxSizing: 'border-box' },
  dos: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
  fotos: { display: 'flex', gap: 9, flexWrap: 'wrap' },
  fbox: { position: 'relative', width: 150 },
  fimg: { width: '100%', borderRadius: 7, border: '1px solid #2b313d', display: 'block' },
  fx: { position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,.75)', color: '#fca5a5', border: 0, borderRadius: 5, padding: '3px 7px', font: 'inherit', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  fcap: { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  addf: { width: 150, height: 100, border: '1px dashed #4b5563', borderRadius: 7, color: '#9ca3af', display: 'grid', placeItems: 'center', fontSize: 13, cursor: 'pointer', textAlign: 'center', padding: 8 },
  sw: { display: 'flex', alignItems: 'center', gap: 11, background: '#12202e', border: '1px solid #1e3a5f', borderRadius: 9, padding: 12, cursor: 'pointer' },
  swP: { margin: '2px 0 0', fontSize: 12.5, color: '#9ca3af' },
  acts: { display: 'flex', gap: 9, justifyContent: 'flex-end', borderTop: '1px solid #262b36', padding: '13px 14px', flexWrap: 'wrap' },
  meta: { fontSize: 12, color: '#6b7280', padding: '0 14px 12px' },
  areaHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  avisos: { background: '#1a1408', border: '1px solid #78350f', borderRadius: 11, padding: 14, marginTop: 22 },
  avH: { margin: '0 0 4px', fontSize: 15, color: '#fbbf24' },
  avSub: { fontSize: 12.5, color: '#9ca3af', marginBottom: 11 },
  av: { background: '#171a21', border: '1px solid #2b3344', borderRadius: 8, padding: '11px 13px', marginBottom: 8, fontSize: 14 },
  avQ: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
  avRow: { display: 'flex', gap: 8, marginTop: 9 },
  nota: { background: '#2a1f06', border: '1px solid #78350f', color: '#fcd34d', padding: '9px 12px', borderRadius: 8, fontSize: 13, margin: '14px auto 0', maxWidth: 1080 },
  error: { background: '#2a1210', border: '1px solid #7f1d1d', color: '#fecaca', borderRadius: 9, padding: '11px 13px', margin: '14px auto 0', maxWidth: 1080, fontSize: 13.5, display: 'flex', gap: 10 },
  cerrar: { marginLeft: 'auto', background: 'none', border: 0, color: '#fca5a5', cursor: 'pointer', fontWeight: 700 },
  toast: { position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', background: '#0b2417', border: '1px solid #22c55e', color: '#6ee7b7', padding: '9px 16px', borderRadius: 9, fontWeight: 700, zIndex: 30 },
  gris: { color: '#6b7280', fontSize: 13 },
}
