import { useEffect, useRef, useState } from 'react'
import { db } from '../../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   BPM / HACCP — Control de producción del chili

   Por qué existe (Cesar, 27-ago-2026): las personas que hacen el chili
   olvidan registrar los controles. Capacitar no alcanzó. Este módulo no
   les pide que recuerden: les muestra UN paso a la vez y no deja avanzar.

   Las tres reglas que lo hacen servir:
     1. La hora la pone el servidor (default now() en bpm_registros).
        Nunca se manda desde el teléfono, así no pueden registrar a las 3
        lo que hicieron a las 2.
     2. La foto se toma con la cámara (capture="environment"), no se elige
        de la galería. Así no suben una foto de otro día.
     3. Si un paso crítico falla, la corrida se bloquea y queda la
        desviación registrada. Solo un supervisor la libera.

   El paso 2 (74 °C por 15 s) bloquea: es el punto de muerte térmica de
   patógenos, no un estándar interno. Los pasos 4 y 5 solo miden mientras
   se levanta la línea base de enfriamiento.
   ═══════════════════════════════════════════════════════════════════════ */

const BUCKET = 'bpm-fotos'

// Se busca la plantilla por el id de la receta del chili, no por nombre.
// Buscar por nombre fallaba: el titulo lleva guion largo (U+2014) y basta
// una diferencia de codificacion entre el archivo y la base para que no
// haga match, dejando `plantilla` en null.
const RECETA_CHILI = 'f9e150d6-f0e4-4728-a303-a38891a12555'

const ROLES_REGISTRAN = ['produccion', 'ing_alimentos', 'jefe_casa_matriz', 'admin', 'ejecutivo', 'superadmin']
const ROLES_LIBERAN   = ['ing_alimentos', 'admin', 'ejecutivo', 'superadmin']

// Quien puede abrir una corrida de REVISION (recorrer los pasos sin subir fotos
// ni pesar). Deliberadamente NO incluye a 'produccion': si el operario pudiera
// elegirlo, en dos semanas nadie sube evidencia nunca mas.
const ROLES_REVISAN   = ['jefe_casa_matriz', 'ing_alimentos', 'admin', 'ejecutivo', 'superadmin']

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', acc: '#3b82f6',
}

const fmtHora = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' }) : '—'

const mmss = (seg) => {
  if (seg == null) return '—'
  const s = Math.max(0, Math.round(seg))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function BPMChiliView({ user }) {
  const [cargando, setCargando]   = useState(true)
  const [error, setError]         = useState('')
  const [plantilla, setPlantilla] = useState(null)
  const [pasos, setPasos]         = useState([])
  const [corrida, setCorrida]     = useState(null)
  const [registros, setRegistros] = useState([])
  const [desviaciones, setDesv]   = useState([])
  const [historial, setHistorial] = useState([])

  // Offset entre el reloj del telefono y el del servidor. Todo lo que se
  // muestre como "hace X minutos" usa el del servidor.
  const [offsetMs, setOffsetMs]   = useState(0)
  const [ahora, setAhora]         = useState(Date.now())

  // Formulario del paso actual
  const [foto, setFoto]       = useState(null)
  const [preview, setPreview] = useState('')
  const [temp, setTemp]       = useState('')
  const [dur, setDur]         = useState('')
  const [nota, setNota]       = useState('')
  const [guardando, setGuardando] = useState(false)
  const fileRef = useRef(null)

  // Pesaje: catalogo del paso y lo que va tecleando el operario.
  // `pesajes` es { [itemId]: { g: '2265', lote: 'L2409', foto: File } }
  const [pesajeItems, setPesajeItems] = useState([])
  const [pesajes, setPesajes]         = useState({})

  // Temporizador por fases. `fase` es el indice de la fase corriendo, o null
  // si esta detenido. `restan` son los segundos que faltan.
  const [fase, setFase]     = useState(null)
  const [restan, setRestan] = useState(0)
  const [hechas, setHechas] = useState([])   // indices de fases ya completadas

  const puedeRegistrar = ROLES_REGISTRAN.includes(user?.rol)
  const puedeLiberar   = ROLES_LIBERAN.includes(user?.rol)
  const puedeRevisar   = ROLES_REVISAN.includes(user?.rol)

  // En revisión no se exige nada: el supervisor está validando que el texto y
  // los parámetros estén bien, no produciendo chili.
  const enRevision = !!corrida?.es_revision

  // ── Reloj ──
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const horaServidor = () => new Date(ahora + offsetMs)

  async function cargar() {
    setCargando(true); setError('')
    try {
      const { data: srv } = await db.rpc('hora_servidor')
      const off = srv ? new Date(srv).getTime() - Date.now() : 0
      setOffsetMs(off)

      const { data: pls, error: e1 } = await db
        .from('bpm_plantillas').select('*').eq('receta_id', RECETA_CHILI).eq('activo', true).limit(1)
      if (e1) throw e1
      const pl = pls?.[0]
      if (!pl) {
        setError('No está configurada la plantilla del chili. Avisá a Casa Matriz.')
        setPlantilla(null); setCargando(false); return
      }
      setPlantilla(pl)

      const { data: ps } = await db.from('bpm_pasos').select('*').eq('plantilla_id', pl.id).order('orden')
      setPasos(ps || [])

      // Ojo: se usa `off` y no `offsetMs`, que todavia no refresco en este render.
      const hoy = new Date(Date.now() + off).toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })
      const { data: co } = await db.from('bpm_corridas').select('*')
        .eq('plantilla_id', pl.id).eq('fecha', hoy).neq('estado', 'anulada').maybeSingle()
      setCorrida(co || null)

      if (co) {
        const [{ data: rg }, { data: dv }] = await Promise.all([
          db.from('bpm_registros').select('*').eq('corrida_id', co.id).order('orden'),
          db.from('bpm_desviaciones').select('*').eq('corrida_id', co.id).order('creada_at'),
        ])
        setRegistros(rg || []); setDesv(dv || [])
      } else { setRegistros([]); setDesv([]) }

      const { data: hist } = await db.from('bpm_corridas').select('*')
        .eq('plantilla_id', pl.id).order('fecha', { ascending: false }).limit(20)
      setHistorial(hist || [])
    } catch (e) {
      // Un 42501 es falta de GRANT en la tabla, no de politica RLS. Se traduce
      // porque el mensaje crudo de Postgres no le dice nada a produccion.
      setError(e.code === '42501' || /permission denied/i.test(e.message || '')
        ? 'El sistema no tiene permiso de leer la configuración del chili. Avisá a Casa Matriz.'
        : (e.message || 'No se pudo cargar'))
    }
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  const limpiarForm = () => {
    setFoto(null); setPreview(''); setTemp(''); setDur(''); setNota(''); setPesajes({})
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Tolerancia: la banda es la MAYOR entre el % y el piso en gramos.
  // Sin el piso, el 2 % del acido citrico (2.5 g) daria ±0.05 g y la balanza
  // de cocina no distingue eso: todo saldria en rojo sin razon.
  const banda = (it) =>
    Math.max(Number(it.gramos_objetivo) * Number(it.tolerancia_pct) / 100, Number(it.tolerancia_g))

  const pesajeEstado = (it) => {
    const v = pesajes[it.id]?.g
    if (v === undefined || v === '') return 'vacio'
    const n = Number(v)
    if (Number.isNaN(n)) return 'malo'
    return Math.abs(n - Number(it.gramos_objetivo)) <= banda(it) ? 'ok' : 'malo'
  }

  const setPesaje = (id, campo, valor) =>
    setPesajes(p => ({ ...p, [id]: { ...(p[id] || {}), [campo]: valor } }))

  // ── Temporizador ──────────────────────────────────────────────
  // Suena fuerte al terminar: la olla hace ruido y el operario no esta
  // mirando la tablet, esta cocinando.
  function alarma() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const master = ctx.createGain(); master.gain.value = 1.4
      master.connect(ctx.destination)
      ;[0, 0.28, 0.56].forEach(off => {
        const o = ctx.createOscillator(), g = ctx.createGain()
        const t0 = ctx.currentTime + off
        o.type = 'square'; o.frequency.value = 880
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(0.8, t0 + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
        o.connect(g).connect(master); o.start(t0); o.stop(t0 + 0.24)
      })
      if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300])
    } catch {}
  }

  function onFoto(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFoto(f)
    setPreview(URL.createObjectURL(f))
  }

  async function iniciarTanda(revision = false) {
    if (!plantilla) { setError('Todavía no cargó la plantilla. Recargá la página.'); return }
    setGuardando(true); setError('')
    try {
      const { data, error } = await db.from('bpm_corridas').insert({
        plantilla_id: plantilla.id,
        receta_id: plantilla.receta_id,
        iniciada_por: user?.id || null,
        store_code: 'CM001',
        paso_actual: 1,
        es_revision: revision,
        notas: revision ? 'Corrida de REVISION del procedimiento. No es produccion.' : null,
      }).select().single()
      if (error) throw error
      setCorrida(data); setRegistros([]); setDesv([])
    } catch (e) {
      setError(e.message?.includes('duplicate') || e.code === '23505'
        ? 'Ya hay una tanda registrada hoy. Solo se lleva una por día.'
        : (e.message || 'No se pudo iniciar'))
    }
    setGuardando(false)
  }

  const pasoActual = pasos.find(p => p.orden === corrida?.paso_actual) || null
  const regPrevio  = registros.length ? registros[registros.length - 1] : null

  // ── Temporizador ──────────────────────────────────────────────
  // OJO: estos dos efectos van DESPUES de `pasoActual`. El arreglo de
  // dependencias se evalua durante el render, asi que si el efecto queda
  // arriba de la declaracion revienta con "Cannot access before
  // initialization" — la pantalla en blanco del 2-sep.
  //
  // Al terminar una fase hay dos comportamientos, y la diferencia importa:
  //  · Carne: NO encadena. Entre tanda y tanda hay que recalentar la olla a
  //    190 °C, que no tiene duracion fija. Si arrancara sola, la tanda 2
  //    entraria a una olla fria y se herviria.
  //  · Vegetales: SI encadena (fase con `auto`). Es una sola coccion continua
  //    con agregados escalonados; si hay que tocar un boton entre fase y fase,
  //    la cebolla se pasa mientras el operario deja la cuchara y busca la tablet.
  useEffect(() => {
    if (fase == null) return
    const fases = pasoActual?.temporizador || []
    const t = setInterval(() => {
      setRestan(s => {
        if (s <= 1) {
          clearInterval(t)
          alarma()
          setHechas(h => (h.includes(fase) ? h : [...h, fase]))
          const sig = fases[fase + 1]
          if (sig?.auto) { setFase(fase + 1); return sig.s }
          setFase(null)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [fase, pasoActual?.id])

  // Al cambiar de paso el temporizador se limpia; si no, el operario ve fases
  // completadas de un paso que ya paso.
  useEffect(() => { setFase(null); setRestan(0); setHechas([]) }, [pasoActual?.id])

  // El catalogo de pesaje se trae solo cuando el paso lo pide, no en la carga
  // general: son 24 filas que el resto de los pasos no usa.
  useEffect(() => {
    let vivo = true
    if (!pasoActual?.requiere_pesaje) { setPesajeItems([]); return }
    db.from('bpm_pesaje_items').select('*')
      .eq('paso_id', pasoActual.id).eq('activo', true).order('orden')
      .then(({ data }) => { if (vivo) setPesajeItems(data || []) })
    return () => { vivo = false }
  }, [pasoActual?.id, pasoActual?.requiere_pesaje])

  // Segundos transcurridos desde el paso anterior, con el reloj del servidor
  const segDesdePrevio = regPrevio
    ? (horaServidor().getTime() - new Date(regPrevio.registrado_at).getTime()) / 1000
    : null

  const esperaOk = !pasoActual?.espera_min_seg || (segDesdePrevio ?? 0) >= pasoActual.espera_min_seg
  const esperaTarde = pasoActual?.espera_max_seg && (segDesdePrevio ?? 0) > pasoActual.espera_max_seg

  async function registrarPaso() {
    if (!pasoActual || !corrida) return
    setError(''); setGuardando(true)
    try {
      // ── Validaciones antes de tocar la base ──
      // En una corrida de revisión no se exige nada: el supervisor recorre los
      // pasos leyendo las instrucciones, no produciendo.
      if (!enRevision) {
        if (pasoActual.requiere_foto && !foto) throw new Error('Falta la foto.')
        if (pasoActual.requiere_temp && temp === '') throw new Error('Falta la temperatura.')
        if (pasoActual.requiere_duracion && dur === '') throw new Error('Faltan los segundos.')
      }

      // ── Pesaje: se exige TODO pesado y el lote de lo empacado. No se deja
      // avanzar con campos vacios: un peso en blanco no es "cero", es "nadie lo
      // peso", y despues no hay forma de reconstruir la tanda.
      if (pasoActual.requiere_pesaje && !enRevision) {
        if (!pesajeItems.length) throw new Error('No cargó la lista de ingredientes. Recargá la página.')
        const sinPeso = pesajeItems.filter(it => {
          const v = pesajes[it.id]?.g
          return v === undefined || v === '' || Number.isNaN(Number(v))
        })
        if (sinPeso.length) {
          throw new Error(`Faltan ${sinPeso.length} sin pesar. El primero: ${sinPeso[0].ingrediente}.`)
        }
        const sinLote = pesajeItems.filter(it => it.requiere_lote && !(pesajes[it.id]?.lote || '').trim())
        if (sinLote.length) {
          throw new Error(`Falta el lote de ${sinLote.length} insumo(s). El primero: ${sinLote[0].ingrediente}. Si el empaque no lo trae, escribí SIN LOTE.`)
        }
        // La foto solo se exige en lo que se pesa en la balanza de precision:
        // ese numero lo teclea una persona y no hay instrumento enlazado que lo
        // respalde. Lo que sale de la Rhino no la necesita.
        const sinFoto = pesajeItems.filter(it => it.requiere_foto && !pesajes[it.id]?.foto)
        if (sinFoto.length) {
          throw new Error(`Falta la foto de la balanza en ${sinFoto.length} ingrediente(s). El primero: ${sinFoto[0].ingrediente}.`)
        }
      }

      const tempN = temp === '' ? null : Number(temp)
      const durN  = dur === ''  ? null : Number(dur)
      if (tempN != null && Number.isNaN(tempN)) throw new Error('La temperatura no es un número.')
      if (durN != null && Number.isNaN(durN))   throw new Error('Los segundos no son un número.')

      if (!esperaOk) {
        throw new Error(`Todavía no. Faltan ${mmss(pasoActual.espera_min_seg - (segDesdePrevio ?? 0))} para poder medir.`)
      }

      // ── Se evalua si cumple ──
      const fallas = []
      if (pasoActual.temp_min != null && tempN != null && tempN < Number(pasoActual.temp_min))
        fallas.push({ tipo: 'temperatura', detalle: `La temperatura no alcanzó el mínimo`,
                      valor_esperado: `≥ ${pasoActual.temp_min} °C`, valor_real: `${tempN} °C` })
      if (pasoActual.temp_max != null && tempN != null && tempN > Number(pasoActual.temp_max))
        fallas.push({ tipo: 'temperatura', detalle: `La temperatura pasó el máximo`,
                      valor_esperado: `≤ ${pasoActual.temp_max} °C`, valor_real: `${tempN} °C` })
      if (pasoActual.duracion_min_seg != null && durN != null && durN < pasoActual.duracion_min_seg)
        fallas.push({ tipo: 'duracion', detalle: `No se sostuvo el tiempo mínimo`,
                      valor_esperado: `≥ ${pasoActual.duracion_min_seg} s`, valor_real: `${durN} s` })
      if (esperaTarde)
        fallas.push({ tipo: 'tiempo_excedido', detalle: `La medición se hizo tarde`,
                      valor_esperado: `≤ ${Math.round(pasoActual.espera_max_seg / 60)} min`,
                      valor_real: `${Math.round((segDesdePrevio ?? 0) / 60)} min` })

      // Cada peso fuera de banda es su propia desviación, con nombre y número:
      // "el pesaje falló" no sirve para nada al revisarlo tres semanas después.
      const filasPesaje = (pasoActual.requiere_pesaje && !enRevision) ? pesajeItems.map(it => {
        const g  = Number(pesajes[it.id].g)
        const ok = Math.abs(g - Number(it.gramos_objetivo)) <= banda(it)
        if (!ok) {
          const b = banda(it)
          fallas.push({
            tipo: 'pesaje', detalle: `${it.ingrediente} fuera de tolerancia`,
            valor_esperado: `${it.gramos_objetivo} ${it.unidad} ± ${b.toFixed(b < 1 ? 2 : 1)}`,
            valor_real: `${g} ${it.unidad}`,
          })
        }
        return { pesaje_item_id: it.id, gramos_real: g, lote: (pesajes[it.id]?.lote || '').trim() || null, cumple: ok }
      }) : []

      const cumple = fallas.length === 0
      const bloquea = !cumple && pasoActual.es_critico

      // ── Foto ──
      let fotoUrl = null
      if (foto) {
        const ext = (foto.name?.split('.').pop() || 'jpg').toLowerCase()
        const path = `${corrida.id}/${pasoActual.orden}-${pasoActual.clave}-${Date.now()}.${ext}`
        const { error: upErr } = await db.storage.from(BUCKET).upload(path, foto, { cacheControl: '3600', upsert: false })
        if (upErr) throw new Error('No se pudo subir la foto: ' + upErr.message)
        fotoUrl = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null
      }

      // ── Registro. Ojo: NO se manda registrado_at, lo pone el servidor. ──
      const { data: reg, error: rErr } = await db.from('bpm_registros').insert({
        corrida_id: corrida.id, paso_id: pasoActual.id, orden: pasoActual.orden,
        foto_url: fotoUrl, temperatura_c: tempN, duracion_seg: durN,
        nota: nota || null, registrado_por: user?.id || null, cumple,
      }).select().single()
      if (rErr) throw rErr

      // Los 24 pesos van despues del registro y colgados de el: si esto falla,
      // el paso queda guardado pero SIN trazabilidad, y eso hay que gritarlo.
      if (filasPesaje.length) {
        // Fotos de la balanza de precision, una por ingrediente que la pida.
        const conFoto = await Promise.all(filasPesaje.map(async f => {
          const file = pesajes[f.pesaje_item_id]?.foto
          if (!file) return f
          const ext  = (file.name?.split('.').pop() || 'jpg').toLowerCase()
          const path = `${corrida.id}/pesaje-${f.pesaje_item_id}-${Date.now()}.${ext}`
          const { error: upErr } = await db.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
          if (upErr) throw new Error('No se pudo subir la foto de la balanza: ' + upErr.message)
          return { ...f, foto_url: db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null }
        }))
        const { error: pErr } = await db.from('bpm_registro_pesajes')
          .insert(conFoto.map(f => ({ ...f, registro_id: reg.id })))
        if (pErr) throw new Error('El paso se guardó pero los pesos NO quedaron registrados: ' + pErr.message)
      }

      if (fallas.length) {
        await db.from('bpm_desviaciones').insert(
          fallas.map(f => ({ corrida_id: corrida.id, paso_id: pasoActual.id, ...f }))
        )
      }

      const esUltimo = pasoActual.orden >= pasos.length
      const nuevoEstado = bloquea ? 'bloqueada' : (esUltimo ? 'completada' : 'en_proceso')
      const { data: co2 } = await db.from('bpm_corridas').update({
        estado: nuevoEstado,
        paso_actual: bloquea ? pasoActual.orden : Math.min(pasoActual.orden + 1, pasos.length),
        cerrada_at: esUltimo && !bloquea ? new Date().toISOString() : null,
      }).eq('id', corrida.id).select().single()

      setCorrida(co2)
      limpiarForm()
      await cargar()

      if (bloquea) setError('El paso no cumplió. La tanda quedó bloqueada y se avisó a Casa Matriz.')
    } catch (e) {
      setError(e.message || 'No se pudo registrar')
    }
    setGuardando(false)
  }

  async function liberar() {
    const motivo = prompt('¿Por qué se libera esta tanda? Queda registrado con tu nombre.')
    if (!motivo) return
    setGuardando(true)
    await db.from('bpm_corridas').update({
      estado: 'liberada', liberada_por: user?.id || null,
      liberada_at: new Date().toISOString(), liberacion_motivo: motivo,
      paso_actual: Math.min((corrida.paso_actual || 1) + 1, pasos.length),
    }).eq('id', corrida.id)
    await db.from('bpm_desviaciones').update({
      resuelta_por: user?.id || null, resuelta_at: new Date().toISOString(), resolucion: motivo,
    }).eq('corrida_id', corrida.id).is('resuelta_at', null)
    setGuardando(false)
    cargar()
  }

  // ═══════════════════ RENDER ═══════════════════
  if (cargando) return <div style={{ padding: 20, color: C.dim }}>Cargando…</div>

  const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 14 }
  const btn = (bg, dis) => ({
    background: dis ? '#3a3a40' : bg, color: dis ? C.dim : '#fff', border: 'none',
    borderRadius: 8, padding: '12px 18px', fontSize: 15, fontWeight: 600,
    cursor: dis ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
  })
  const inp = {
    background: '#141416', border: `1px solid ${C.line}`, color: C.txt,
    borderRadius: 8, padding: '10px 12px', fontSize: 16, width: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit',
  }

  return (
    <div style={{ padding: 14, background: C.bg, color: C.txt, minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Banda fija mientras dure la revisión: sin esto, alguien que llega a
            media mañana ve una corrida en curso y cree que se está produciendo. */}
        {enRevision && (
          <div style={{
            background: '#3a2f0f', border: `1px solid ${C.warn}`, borderRadius: 10,
            padding: '11px 14px', marginBottom: 14, color: '#fcd34d', fontSize: 13.5, lineHeight: 1.5,
          }}>
            <b>🔍 CORRIDA DE REVISIÓN — no es producción.</b><br />
            No se piden fotos, temperaturas ni pesaje. No uses este modo para una tanda real:
            no queda evidencia de nada.
          </div>
        )}

        <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 4px' }}>🌶️ Control BPM · Chili</h2>
        <div style={{ color: C.dim, fontSize: 13, marginBottom: 18 }}>
          Una tanda por día. La hora la registra el sistema, no el teléfono.
        </div>

        {error && (
          <div style={{ ...card, background: '#3a1414', border: `1px solid ${C.bad}`, color: '#fecaca' }}>
            {error}
          </div>
        )}

        {/* ── Sin tanda hoy ── */}
        {!corrida && (
          <div style={card}>
            <div style={{ marginBottom: 14, fontSize: 15 }}>Todavía no se ha iniciado la tanda de hoy.</div>
            {/* El boton queda inhabilitado si la plantilla no cargo. Antes se podia
                hacer clic y el mensaje de iniciarTanda() pisaba el error real de
                la carga, que era lo unico que decia por que habia fallado. */}
            {puedeRegistrar
              ? <>
                  <button
                    style={btn(C.ok, guardando || !plantilla)}
                    disabled={guardando || !plantilla}
                    onClick={() => iniciarTanda(false)}
                    title={!plantilla ? 'No cargó la configuración del chili' : undefined}
                  >
                    Iniciar tanda de hoy
                  </button>

                  {/* Recorrido de validacion. Solo supervisores: si el operario
                      pudiera elegirlo, dejaria de subir evidencia. */}
                  {puedeRevisar && (
                    <div style={{
                      marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`,
                    }}>
                      <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.55, marginBottom: 10 }}>
                        ¿Vas a revisar el procedimiento? Podés recorrer los {pasos.length} pasos
                        sin subir fotos ni pesar, para leer las instrucciones y ver si algo
                        está mal escrito. <b style={{ color: C.warn }}>No cuenta como producción.</b>
                      </div>
                      <button
                        style={{ ...btn('#3f3f46', guardando || !plantilla), fontSize: 14 }}
                        disabled={guardando || !plantilla}
                        onClick={() => iniciarTanda(true)}
                      >
                        🔍 Abrir corrida de revisión
                      </button>
                    </div>
                  )}
                </>
              : <div style={{ color: C.dim, fontSize: 13 }}>Tu rol no registra producción.</div>}
          </div>
        )}

        {/* ── Progreso ── */}
        {corrida && (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <b>Tanda del {corrida.fecha}</b>
              <span style={{
                fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                background: corrida.estado === 'bloqueada' ? '#4a1414'
                          : corrida.estado === 'completada' ? '#14331f'
                          : corrida.estado === 'liberada' ? '#3a2f0f' : '#1e3a5f',
                color: corrida.estado === 'bloqueada' ? '#fca5a5'
                     : corrida.estado === 'completada' ? '#86efac'
                     : corrida.estado === 'liberada' ? '#fcd34d' : '#93c5fd',
              }}>
                {corrida.estado === 'en_proceso' ? 'en proceso' : corrida.estado}
              </span>
            </div>

            {pasos.map(p => {
              const r = registros.find(x => x.paso_id === p.id)
              const activo = p.orden === corrida.paso_actual && corrida.estado !== 'completada'
              return (
                <div key={p.id} style={{
                  display: 'flex', gap: 10, padding: '8px 0',
                  borderBottom: p.orden < pasos.length ? `1px solid #212125` : 'none',
                  opacity: r || activo ? 1 : 0.45,
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 12, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                    background: r ? (r.cumple ? C.ok : C.bad) : activo ? C.acc : '#2a2a2e',
                    color: r || activo ? '#fff' : C.dim,
                  }}>{r ? (r.cumple ? '✓' : '✕') : p.orden}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: activo ? 600 : 400 }}>{p.titulo}</div>
                    {r && (
                      <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                        {fmtHora(r.registrado_at)}
                        {r.temperatura_c != null && ` · ${r.temperatura_c} °C`}
                        {r.duracion_seg != null && ` · ${r.duracion_seg} s`}
                        {r.foto_url && <> · <a href={r.foto_url} target="_blank" rel="noreferrer" style={{ color: C.acc }}>foto</a></>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Desviaciones ── */}
        {desviaciones.length > 0 && (
          <div style={{ ...card, background: '#3a1414', border: `1px solid ${C.bad}` }}>
            <b style={{ color: '#fca5a5' }}>Desviaciones</b>
            {desviaciones.map(d => (
              <div key={d.id} style={{ fontSize: 13, marginTop: 8, color: '#fecaca' }}>
                • {d.detalle} — esperado {d.valor_esperado}, real <b>{d.valor_real}</b>
                {d.resuelta_at && <span style={{ color: C.dim }}> · liberada: {d.resolucion}</span>}
              </div>
            ))}
            {corrida?.estado === 'bloqueada' && puedeLiberar && (
              <button style={{ ...btn(C.warn, guardando), marginTop: 12 }} disabled={guardando} onClick={liberar}>
                Liberar la tanda
              </button>
            )}
            {corrida?.estado === 'bloqueada' && !puedeLiberar && (
              <div style={{ marginTop: 10, fontSize: 13, color: '#fecaca' }}>
                Avisá a Casa Matriz. No se puede seguir hasta que la liberen.
              </div>
            )}
          </div>
        )}

        {/* ── Paso actual ── */}
        {corrida && pasoActual && corrida.estado !== 'completada' && corrida.estado !== 'bloqueada' && puedeRegistrar && (
          <div style={{ ...card, border: `2px solid ${C.acc}` }}>
            <div style={{ fontSize: 12, color: C.acc, fontWeight: 600, letterSpacing: .5, marginBottom: 4 }}>
              PASO {pasoActual.orden} DE {pasos.length}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{pasoActual.titulo}</div>
            {/* El video de apoyo va ANTES de la instruccion: se mira primero y
                despues se lee. Antes vivia en un grupo de WhatsApp y se perdia. */}
            {pasoActual.video_url && (
              <video
                src={pasoActual.video_url}
                controls playsInline preload="metadata"
                style={{
                  width: '100%', maxWidth: 380, borderRadius: 10,
                  border: `1px solid ${C.line}`, marginBottom: 12, display: 'block',
                }}
              />
            )}
            {/* whiteSpace pre-line: la instruccion trae saltos de linea y los
                pasos numerados se leen mal si se colapsan en un parrafo. */}
            <div style={{
              fontSize: 14, color: C.dim, lineHeight: 1.6,
              marginBottom: 14, whiteSpace: 'pre-line',
            }}>{pasoActual.instruccion}</div>

            {/* ── Temporizador por fases ──────────────────────────────────
                Botones grandes: se usan con las manos ocupadas y la olla al
                fuego, no mirando la pantalla de cerca. */}
            {Array.isArray(pasoActual.temporizador) && pasoActual.temporizador.length > 0 && (
              <div style={{
                background: '#101012', border: `1px solid ${fase != null ? C.acc : C.line}`,
                borderRadius: 11, padding: 13, marginBottom: 14,
              }}>
                {fase != null ? (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13.5, color: C.acc, marginBottom: 4 }}>
                      {pasoActual.temporizador[fase].t}
                    </div>
                    <div style={{
                      fontSize: 52, fontWeight: 700, letterSpacing: 1,
                      color: restan <= 10 ? C.warn : C.txt, lineHeight: 1.1,
                      fontVariantNumeric: 'tabular-nums',
                    }}>{mmss(restan)}</div>
                    <button onClick={() => { setFase(null); setRestan(0) }}
                            style={{ ...btn('#3f3f46'), marginTop: 9, padding: '9px 18px', fontSize: 13.5 }}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: C.dim, marginBottom: 9 }}>
                      Tocá cada fase cuando la vayas a empezar
                    </div>
                    {pasoActual.temporizador.map((f, i) => {
                      const lista = hechas.includes(i)
                      return (
                        <button key={i} onClick={() => { setFase(i); setRestan(f.s) }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            width: '100%', gap: 10, marginBottom: 6, cursor: 'pointer',
                            background: lista ? '#14331f' : '#0a0a0a',
                            border: `1px solid ${lista ? C.ok : C.line}`,
                            borderRadius: 9, padding: '12px 13px', color: C.txt,
                            fontFamily: 'inherit', fontSize: 14, textAlign: 'left',
                          }}>
                          <span style={{ color: lista ? '#86efac' : C.txt }}>
                            {lista ? '✓ ' : ''}{f.t}
                          </span>
                          <b style={{ color: C.dim, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {mmss(f.s)}
                          </b>
                        </button>
                      )
                    })}
                    {hechas.length > 0 && (
                      <button onClick={() => setHechas([])}
                              style={{ ...btn('#3f3f46'), width: '100%', padding: '8px', fontSize: 12.5, marginTop: 3 }}>
                        Reiniciar el conteo de fases
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Cronómetro de espera */}
            {pasoActual.espera_min_seg != null && regPrevio && (
              <div style={{
                background: esperaOk ? (esperaTarde ? '#3a2f0f' : '#14331f') : '#1e3a5f',
                border: `1px solid ${esperaOk ? (esperaTarde ? C.warn : C.ok) : C.acc}`,
                borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 14,
              }}>
                {!esperaOk
                  ? <>Esperá <b>{mmss(pasoActual.espera_min_seg - segDesdePrevio)}</b> más antes de medir.</>
                  : esperaTarde
                    ? <>Pasaron <b>{Math.round(segDesdePrevio / 60)} min</b> desde el paso anterior. Se va a marcar como medición tardía.</>
                    : <>Ya podés medir. Van <b>{Math.round(segDesdePrevio / 60)} min</b> desde el paso anterior.</>}
              </div>
            )}

            {/* Foto */}
            {pasoActual.requiere_foto && (
              <div style={{ marginBottom: 14 }}>
                <input ref={fileRef} type="file" accept="image/*" capture="environment"
                       onChange={onFoto} style={{ display: 'none' }} />
                {preview
                  ? <div>
                      <img src={preview} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8 }} />
                      <button onClick={() => { setFoto(null); setPreview(''); if (fileRef.current) fileRef.current.value = '' }}
                              style={{ ...btn('#2a2a2e'), marginTop: 8, padding: '8px 14px', fontSize: 13 }}>
                        Tomar otra
                      </button>
                    </div>
                  : <button onClick={() => fileRef.current?.click()} style={{ ...btn(C.acc), width: '100%', padding: '16px' }}>
                      📷 Tomar foto
                    </button>}
              </div>
            )}

            {/* Temperatura */}
            {pasoActual.requiere_temp && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, color: C.dim, display: 'block', marginBottom: 6 }}>
                  {pasoActual.temp_label || 'Temperatura (°C)'}
                  {pasoActual.temp_min != null && <span style={{ color: C.warn }}> · mínimo {pasoActual.temp_min} °C</span>}
                </label>
                <input type="number" inputMode="decimal" step="0.1" value={temp}
                       onChange={e => setTemp(e.target.value)} style={inp} placeholder="Ej: 76.5" />
              </div>
            )}

            {/* ── Pesaje ──────────────────────────────────────────────────
                Cada ingrediente con su objetivo al lado. El borde se pone rojo
                al salirse de banda, para que lo corrijan ANTES de guardar y no
                queden bloqueando la tanda por un descuido de tecleo. */}
            {pasoActual.requiere_pesaje && (
              <div style={{ marginBottom: 14 }}>
                {(() => {
                  const listos = pesajeItems.filter(it => pesajeEstado(it) !== 'vacio').length
                  const malos  = pesajeItems.filter(it => pesajeEstado(it) === 'malo').length
                  return (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: malos ? '#3a1414' : '#101012', border: `1px solid ${malos ? C.bad : C.line}`,
                      borderRadius: 9, padding: '9px 12px', marginBottom: 10,
                    }}>
                      <span style={{ fontSize: 13, color: C.dim }}>
                        {listos} de {pesajeItems.length} pesados
                      </span>
                      {malos > 0 && <b style={{ fontSize: 13, color: C.bad }}>{malos} fuera de tolerancia</b>}
                    </div>
                  )
                })()}

                {[
                  { k: 'balanza_grande',    t: 'Balanza grande (Rhino) — el peso entra solo' },
                  { k: 'balanza_precision', t: 'Balanza de precisión — se teclea y va con foto' },
                  { k: 'conteo',            t: 'Se cuenta, no se pesa' },
                ].map(({ k, t }) => {
                  const items = pesajeItems.filter(it => (it.fuente || 'balanza_grande') === k)
                  if (!items.length) return null
                  return (
                    <div key={k} style={{ marginBottom: 12 }}>
                      <div style={{
                        fontSize: 11.5, letterSpacing: .6, textTransform: 'uppercase',
                        color: C.dim, margin: '4px 0 8px',
                      }}>{t}</div>
                      {items.map(it => {
                        const est = pesajeEstado(it)
                        const b   = banda(it)
                        return (
                          <div key={it.id} style={{
                            background: '#101012',
                            border: `1px solid ${est === 'malo' ? C.bad : est === 'ok' ? C.ok : C.line}`,
                            borderRadius: 9, padding: '9px 11px', marginBottom: 7,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.ingrediente}</span>
                              <span style={{ fontSize: 12.5, color: C.dim, whiteSpace: 'nowrap' }}>
                                {it.gramos_objetivo} {it.unidad}
                                {b > 0 && ` ± ${b.toFixed(b < 1 ? 2 : 1)}`}
                              </span>
                            </div>
                            {it.referencia && (
                              <div style={{ fontSize: 11.5, color: '#6b6a72', marginBottom: 6 }}>{it.referencia}</div>
                            )}
                            <div style={{ display: 'flex', gap: 7 }}>
                              <input
                                type="number" inputMode="decimal" step="0.1"
                                value={pesajes[it.id]?.g ?? ''}
                                onChange={e => setPesaje(it.id, 'g', e.target.value)}
                                placeholder={`${it.unidad} reales`}
                                style={{ ...inp, flex: 1, borderColor: est === 'malo' ? C.bad : C.line }}
                              />
                              {it.requiere_lote && (
                                <input
                                  value={pesajes[it.id]?.lote ?? ''}
                                  onChange={e => setPesaje(it.id, 'lote', e.target.value)}
                                  placeholder="Lote del empaque"
                                  style={{ ...inp, flex: 1 }}
                                />
                              )}
                            </div>
                            {it.requiere_foto && (
                              <label style={{
                                display: 'flex', alignItems: 'center', gap: 8, marginTop: 7,
                                background: pesajes[it.id]?.foto ? '#14331f' : '#0a0a0a',
                                border: `1px dashed ${pesajes[it.id]?.foto ? C.ok : C.line}`,
                                borderRadius: 8, padding: '8px 11px', cursor: 'pointer',
                                fontSize: 12.5, color: pesajes[it.id]?.foto ? '#86efac' : C.dim,
                              }}>
                                <input type="file" accept="image/*" capture="environment"
                                       style={{ display: 'none' }}
                                       onChange={e => setPesaje(it.id, 'foto', e.target.files?.[0] || null)} />
                                {pesajes[it.id]?.foto
                                  ? '✓ Foto de la balanza lista'
                                  : '📷 Foto de la pantalla de la balanza'}
                              </label>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Duración */}
            {pasoActual.requiere_duracion && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, color: C.dim, display: 'block', marginBottom: 6 }}>
                  Segundos que se sostuvo
                  <span style={{ color: C.warn }}> · mínimo {pasoActual.duracion_min_seg} s</span>
                </label>
                <input type="number" inputMode="numeric" value={dur}
                       onChange={e => setDur(e.target.value)} style={inp} placeholder="Ej: 20" />
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <input value={nota} onChange={e => setNota(e.target.value)} style={inp}
                     placeholder="Nota (opcional)" />
            </div>

            <button style={{ ...btn(C.ok, guardando || !esperaOk), width: '100%' }}
                    disabled={guardando || !esperaOk} onClick={registrarPaso}>
              {guardando ? 'Guardando…' : `Registrar paso ${pasoActual.orden}`}
            </button>
          </div>
        )}

        {corrida?.estado === 'completada' && (
          <div style={{ ...card, background: '#14331f', border: `1px solid ${C.ok}`, color: '#86efac' }}>
            <b>Tanda completada.</b> Los {pasos.length} controles quedaron registrados con foto y hora.
          </div>
        )}

        {/* ── Historial ── */}
        {historial.length > 1 && (
          <div style={card}>
            <b style={{ fontSize: 14 }}>Últimas tandas</b>
            <table style={{ width: '100%', fontSize: 13, marginTop: 10, borderCollapse: 'collapse' }}>
              <tbody>
                {historial.map(h => (
                  <tr key={h.id} style={{ borderBottom: `1px solid #212125` }}>
                    <td style={{ padding: '6px 0' }}>
                      {h.es_revision && <span style={{ color: C.warn, marginRight: 5 }} title="Corrida de revisión, no producción">🔍</span>}
                      {h.fecha}
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: C.dim }}>{fmtHora(h.iniciada_at)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 20,
                        background: h.estado === 'bloqueada' ? '#4a1414' : h.estado === 'completada' ? '#14331f' : '#2a2a2e',
                        color: h.estado === 'bloqueada' ? '#fca5a5' : h.estado === 'completada' ? '#86efac' : C.dim,
                      }}>{h.estado}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
