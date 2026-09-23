import { useEffect, useRef, useState } from 'react'
import { db } from '../../supabase'
import { Controles, PanelDesvio, evaluarControles, resumenDatos, desvioValido, useCatalogosBPM } from './BPMControles'
import { descargarExpediente } from './bpmExpediente'
import BPMChiliClaro from './BPMChiliClaro'

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
// Calidad libera. Mauricio (jefe_casa_matriz) es quien audita el chili, así
// que desde la fase 1 de su auditoría (14-sep-2026) también libera.
const ROLES_LIBERAN   = ['ing_alimentos', 'jefe_casa_matriz', 'admin', 'ejecutivo', 'superadmin']

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
  // Desde el 23-sep-2026 conviven dos versiones del BPM: la piloto y la
  // «versión Mauricio» (informe FD-CI-RG-002). `plantillas` son las que
  // este usuario puede correr; `plantilla` es la que está abierta.
  const [plantillas, setPlantillas] = useState([])
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

  // Pesaje: el catalogo del paso y lo que YA se peso en la tablet.
  // Desde 06-sep-2026 el pesaje no se teclea aca: se hace en la estacion
  // /pesaje.html, que esta cableada a la balanza. Esta pantalla solo lee.
  const [pesajeItems, setPesajeItems] = useState([])
  const [pesajes, setPesajes]         = useState({})   // { [itemId]: { g, lote, cumple } }

  // Temporizador por fases. `fase` es el indice de la fase corriendo, o null
  // si esta detenido. `restan` son los segundos que faltan.
  const [fase, setFase]     = useState(null)
  const [restan, setRestan] = useState(0)
  const [hechas, setHechas] = useState([])   // indices de fases ya completadas

  // Controles estructurados del paso (bpm_pasos.controles) y el desvío que
  // se abre cuando algo no cumple. Los catálogos los administra Calidad.
  const cat = useCatalogosBPM(plantilla?.id)
  const [valores, setValores] = useState({})
  const [desvio, setDesvio]   = useState(null)
  // Expediente PDF de una tanda (fase 3). Guarda el id mientras lo arma:
  // son dos consultas y ~400 kB de jsPDF, y sin aviso parece que no pasó nada.
  const [expediente, setExpediente] = useState(null)

  async function bajarExpediente(id) {
    setExpediente(id); setError('')
    try { await descargarExpediente(id) }
    catch (e) { setError('No se pudo armar el expediente: ' + (e.message || e)) }
    setExpediente(null)
  }

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

  async function cargar(idPreferido) {
    setCargando(true); setError('')
    try {
      const { data: srv } = await db.rpc('hora_servidor')
      const off = srv ? new Date(srv).getTime() - Date.now() : 0
      setOffsetMs(off)

      // Se traen todas las versiones del chili. Las inactivas (la versión
      // Mauricio arranca así) solo las ve quien revisa: sirven para correr
      // una tanda de prueba antes de encenderla para toda la cocina.
      const { data: todas, error: e1 } = await db
        .from('bpm_plantillas').select('*').eq('receta_id', RECETA_CHILI)
        .order('activo', { ascending: false }).order('created_at')
      if (e1) throw e1
      const disponibles = (todas || []).filter(p => p.activo || ROLES_REVISAN.includes(user?.rol))
      setPlantillas(disponibles)

      const pl = disponibles.find(p => p.id === idPreferido)
        || disponibles.find(p => p.activo)
        || disponibles[0]
      if (!pl) {
        setError('No está configurada la plantilla del chili. Avisá a Casa Matriz.')
        setPlantilla(null); setCargando(false); return
      }
      setPlantilla(pl)

      const { data: ps } = await db.from('bpm_pasos').select('*').eq('plantilla_id', pl.id).order('orden')
      setPasos(ps || [])

      // Ojo: se usa `off` y no `offsetMs`, que todavia no refresco en este render.
      const hoy = new Date(Date.now() + off).toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })
      // Desde el 14-sep una corrida de REVISIÓN no consume la tanda del día
      // (índice único solo sobre producción). Si hoy hay producción y además
      // una revisión, manda la producción.
      const { data: cos } = await db.from('bpm_corridas').select('*')
        .eq('plantilla_id', pl.id).eq('fecha', hoy).neq('estado', 'anulada')
        .order('es_revision', { ascending: true }).order('iniciada_at', { ascending: false }).limit(1)
      const co = cos?.[0] || null
      setCorrida(co)

      if (co) {
        const [{ data: rg }, { data: dv }] = await Promise.all([
          db.from('bpm_registros').select('*').eq('corrida_id', co.id).order('orden').order('intento'),
          db.from('bpm_desviaciones').select('*').eq('corrida_id', co.id).order('creada_at'),
        ])
        // Un paso puede tener varios intentos (el retest es el N+1). La
        // pantalla muestra el último; los anteriores quedan en la base y
        // salen en el expediente.
        const ultimo = new Map()
        for (const r of rg || []) ultimo.set(r.paso_id, r)
        setRegistros([...ultimo.values()]); setDesv(dv || [])
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
    setValores({}); setDesvio(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Tolerancia: la banda es la MAYOR entre el % y el piso en gramos.
  // Sin el piso, el 2 % del acido citrico (2.5 g) daria ±0.05 g y la balanza
  // de cocina no distingue eso: todo saldria en rojo sin razon.
  const banda = (it) =>
    Math.max(Number(it.gramos_objetivo) * Number(it.tolerancia_pct) / 100, Number(it.tolerancia_g))

  // Avance del pesaje que se hizo en la tablet. El celular no lo edita.
  const pesajeHechos = pesajeItems.filter(it => pesajes[it.id]).length
  const pesajeMalos  = pesajeItems.filter(it => pesajes[it.id]?.cumple === false).length
  const pesajeListo  = enRevision ||
                       (pesajeItems.length > 0 && pesajeHechos === pesajeItems.length)

  // Se relee al abrir el paso y cuando el operario toca "Actualizar". No hay
  // suscripcion en vivo a proposito: son dos aparatos distintos y un pull
  // explicito se entiende mejor que una pantalla que cambia sola.
  const cargarPesajes = async () => {
    if (!corrida?.id) return
    const { data, error } = await db
      .from('bpm_registro_pesajes')
      .select('pesaje_item_id, gramos_real, lote, cumple, proveedor, vencimiento, bascula_codigo, metodo_captura, motivo_no_cumple')
      .eq('corrida_id', corrida.id)
    if (error) return
    const m = {}
    for (const r of data || []) {
      m[r.pesaje_item_id] = {
        g: r.gramos_real, lote: r.lote, cumple: r.cumple,
        proveedor: r.proveedor, vencimiento: r.vencimiento,
        bascula: r.bascula_codigo, metodo: r.metodo_captura, motivo: r.motivo_no_cumple,
      }
    }
    setPesajes(m)
  }

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

  // ── Controles estructurados ──
  const hoy = horaServidor().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })
  const ahoraISO = () => horaServidor().toISOString()
  const quien = user?.nombre || 'operario'
  const tieneControles = Array.isArray(pasoActual?.controles) && pasoActual.controles.length > 0
  const evalC = tieneControles && cat.listo
    ? evaluarControles(pasoActual.controles, valores, cat, hoy)
    : { fallas: [], pendientes: [], ok: true }
  // La temperatura tecleada también se evalúa en vivo, para que el desvío
  // (causa + acción) se pida ANTES de registrar, igual que con los controles.
  const tempVivo = temp === '' ? null : Number(temp)
  const tempFalla = !!pasoActual && tempVivo != null && !Number.isNaN(tempVivo) && (
    (pasoActual.temp_min != null && tempVivo < Number(pasoActual.temp_min)) ||
    (pasoActual.temp_max != null && tempVivo > Number(pasoActual.temp_max)))
  const fallasVivas = [
    ...evalC.fallas,
    ...(tempFalla ? [{ tipo: 'temperatura', detalle: 'Lectura fuera del rango',
                       valor_esperado: `${pasoActual.temp_min ?? '…'} a ${pasoActual.temp_max ?? '…'} °C`, valor_real: `${tempVivo} °C` }] : []),
  ]
  // Si este mismo paso ya quedó como "no cumple" en esta tanda, esta es la
  // segunda verificación (Calidad ya liberó y se repite).
  const intentoPrevio = pasoActual ? [...registros].reverse().find(r => r.paso_id === pasoActual.id && r.cumple === false) : null

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
  useEffect(() => { setFase(null); setRestan(0); setHechas([]); setValores({}); setDesvio(null) }, [pasoActual?.id])

  // El catalogo de pesaje se trae solo cuando el paso lo pide, no en la carga
  // general: son 24 filas que el resto de los pasos no usa.
  useEffect(() => {
    let vivo = true
    if (!pasoActual?.requiere_pesaje) { setPesajeItems([]); return }
    db.from('bpm_pesaje_items').select('*')
      .eq('paso_id', pasoActual.id).eq('activo', true).order('orden')
      .then(({ data }) => { if (vivo) setPesajeItems(data || []) })
    // Traer tambien lo que ya se peso en la tablet para esta tanda.
    cargarPesajes()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasoActual?.id, pasoActual?.requiere_pesaje, corrida?.id])

  // Segundos transcurridos desde el paso anterior, con el reloj del servidor
  const segDesdePrevio = regPrevio
    ? (horaServidor().getTime() - new Date(regPrevio.registrado_at).getTime()) / 1000
    : null

  const esperaOk = !pasoActual?.espera_min_seg || (segDesdePrevio ?? 0) >= pasoActual.espera_min_seg
  const esperaTarde = pasoActual?.espera_max_seg && (segDesdePrevio ?? 0) > pasoActual.espera_max_seg

  // `retener`: versión Mauricio. El operario decide retener el paso con un
  // criterio en falla: el intento se guarda como no conforme, se abren las
  // desviaciones y la tanda queda retenida hasta que Calidad disponga
  // (retest o liberación con justificación). Sin `retener`, la v2 no cierra.
  async function registrarPaso(opts) {
    const retener = opts?.retener === true
    if (!pasoActual || !corrida) return
    setError(''); setGuardando(true)
    try {
      // ── Validaciones antes de tocar la base ──
      // En una corrida de revisión no se exige nada: el supervisor recorre los
      // pasos leyendo las instrucciones, no produciendo.
      // Al RETENER (versión Mauricio) el intento se guarda con lo que hay: lo
      // que falta lo resuelve Calidad en la desviación, no el operario ahora.
      const exigeCompleto = !enRevision && !retener
      if (exigeCompleto) {
        if (pasoActual.requiere_foto && !foto) throw new Error('Falta la foto.')
        if (pasoActual.requiere_temp && temp === '') throw new Error('Falta la temperatura.')
        if (pasoActual.requiere_duracion && dur === '') throw new Error('Faltan los segundos.')
      }

      // ── Pesaje: se exige TODO pesado y el lote de lo empacado. No se deja
      // avanzar con campos vacios: un peso en blanco no es "cero", es "nadie lo
      // peso", y despues no hay forma de reconstruir la tanda.
      if (pasoActual.requiere_pesaje && exigeCompleto) {
        if (!pesajeItems.length) throw new Error('No cargó la lista de ingredientes. Recargá la página.')
        // Se relee de la base justo antes de guardar: entre que el operario
        // abrio esta pantalla y toca el boton pudo terminar de pesar en la
        // tablet, y seria absurdo bloquearlo por una lista vieja.
        await cargarPesajes()
        const { data: frescos } = await db
          .from('bpm_registro_pesajes').select('pesaje_item_id, lote, proveedor, vencimiento')
          .eq('corrida_id', corrida.id)
        const hechos = new Set((frescos || []).map(r => r.pesaje_item_id))
        const sinPeso = pesajeItems.filter(it => !hechos.has(it.id))
        if (sinPeso.length) {
          throw new Error(`Faltan ${sinPeso.length} sin pesar en la tablet. El primero: ${sinPeso[0].ingrediente}.`)
        }
        // Trazabilidad del empaque (fase 2): lote, proveedor y vencimiento de
        // los insumos que lo exigen. Sin esto no se puede rastrear una tanda.
        const dato = Object.fromEntries((frescos || []).map(r => [r.pesaje_item_id, r]))
        const falta = (campo, pide) => pesajeItems.filter(it => it[pide] && !(dato[it.id]?.[campo] || '').toString().trim())
        for (const [campo, pide, como] of [
          ['lote', 'requiere_lote', 'el lote'],
          ['proveedor', 'requiere_proveedor', 'el proveedor'],
          ['vencimiento', 'requiere_vencimiento', 'la fecha de vencimiento'],
        ]) {
          const f = falta(campo, pide)
          if (f.length) {
            throw new Error(`Falta ${como} de ${f.length} insumo(s). El primero: ${f[0].ingrediente}. Anotalo en la tablet${campo === 'lote' ? '; si el empaque no lo trae, escribí SIN LOTE' : ''}.`)
          }
        }
      }

      const tempN = temp === '' ? null : Number(temp)
      const durN  = dur === ''  ? null : Number(dur)
      if (tempN != null && Number.isNaN(tempN)) throw new Error('La temperatura no es un número.')
      if (durN != null && Number.isNaN(durN))   throw new Error('Los segundos no son un número.')

      if (!esperaOk && !retener) {
        throw new Error(`Todavía no. Faltan ${mmss(pasoActual.espera_min_seg - (segDesdePrevio ?? 0))} para poder medir.`)
      }

      // ── Controles estructurados: nada queda a medias y si algo no cumple,
      // el desvío lleva causa y acción antes de poder registrar. ──
      if (tieneControles && !enRevision) {
        if (!cat.listo) throw new Error('Todavía no cargaron los catálogos de Calidad. Esperá un momento.')
        if (evalC.pendientes.length && !retener) throw new Error(`Falta: ${evalC.pendientes[0]}${evalC.pendientes.length > 1 ? ` (y ${evalC.pendientes.length - 1} más)` : ''}.`)
      }
      // Versión Mauricio (FD-CI-RG-002): con una falla el paso queda RETENIDO
      // y no se cierra. El botón ya está apagado, pero se revalida acá por si
      // el estado cambió entre el toque y el guardado.
      if (!enRevision && fallasVivas.length && plantilla?.retiene_ante_falla && !retener)
        throw new Error('El paso quedó retenido: corregí lo que está fuera de criterio y volvé a medir. No se puede cerrar así.')
      // Cualquier "no cumple" (control o temperatura) lleva causa y acción.
      // En la versión Mauricio la causa y la acción las dispone Calidad al
      // atender la desviación (T12), no el operario al retener.
      if (!enRevision && fallasVivas.length && !plantilla?.retiene_ante_falla && !desvioValido(desvio)) throw new Error('Elegí la causa y la acción correctiva del desvío.')

      // ── Se evalua si cumple ──
      const fallas = []
      const contexto = pasoActual.contexto_desvio || 'general'
      const causaTxt  = desvio?.causa === 'Otra' ? `Otra: ${desvio.causa_otra}` : desvio?.causa || null
      const accionTxt = desvio?.accion === 'Otra' ? `Otra: ${desvio.accion_otra}` : desvio?.accion || null
      if (tieneControles && !enRevision) {
        for (const f of evalC.fallas) {
          fallas.push({ tipo: f.tipo, detalle: f.detalle, valor_esperado: f.valor_esperado, valor_real: f.valor_real,
                        contexto, causa: causaTxt, accion: accionTxt })
        }
      }
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
      // Los pesos ya existen en la base (los guardó la tablet, uno por uno);
      // acá solo se leen para levantar las desviaciones.
      if (pasoActual.requiere_pesaje && !enRevision) {
        for (const it of pesajeItems) {
          const p = pesajes[it.id]
          if (!p || p.cumple !== false) continue
          const b = banda(it)
          // El motivo lo calcula fn_pesaje_guardar: puede ser el peso, un
          // insumo vencido o una báscula sin calibración vigente.
          fallas.push({
            tipo: 'pesaje',
            detalle: `${it.ingrediente}: ${p.motivo || 'fuera de tolerancia'}`,
            valor_esperado: `${it.gramos_objetivo} ${it.unidad} ± ${b.toFixed(b < 1 ? 2 : 1)}`,
            valor_real: `${p.g} ${it.unidad}${p.vencimiento ? ` · vence ${p.vencimiento}` : ''}${p.bascula ? ` · ${p.bascula}` : ''}`,
            contexto: 'pesaje',
          })
        }
      }

      const cumple = fallas.length === 0
      // Piloto: bloquea solo un paso crítico. Versión Mauricio: cualquier
      // criterio en falla retiene el paso y la tanda (anexo, Marco común).
      const bloquea = !cumple && (pasoActual.es_critico || retener)

      // ── Foto ──
      let fotoUrl = null
      if (foto) {
        const ext = (foto.name?.split('.').pop() || 'jpg').toLowerCase()
        const path = `${corrida.id}/${pasoActual.orden}-${pasoActual.clave}-${Date.now()}.${ext}`
        const { error: upErr } = await db.storage.from(BUCKET).upload(path, foto, { cacheControl: '3600', upsert: false })
        if (upErr) throw new Error('No se pudo subir la foto: ' + upErr.message)
        fotoUrl = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null
      }

      // ── Lo capturado en los controles viaja en `datos`: es el expediente. ──
      const datos = tieneControles ? {
        valores,
        evaluacion: { ok: evalC.ok, fallas: evalC.fallas, pendientes: evalC.pendientes, en_revision: enRevision },
        resumen: cat.listo ? resumenDatos(pasoActual.controles, valores, cat) : '',
        desvio: fallasVivas.length ? { causa: causaTxt, accion: accionTxt } : null,
        segunda_verificacion: !!intentoPrevio,
        registrado_por_nombre: quien,
      } : null

      // ── Registro. Ojo: NO se manda registrado_at, lo pone el servidor. ──
      // Cada registro es un intento. Si el paso ya tenía uno (retest tras una
      // retención), este es el N+1 y el anterior no se borra — hasta el
      // 23-sep-2026 la clave única lo impedía y el retest daba error.
      const previo = registros.find(r => r.paso_id === pasoActual.id)
      const { data: reg, error: rErr } = await db.from('bpm_registros').insert({
        corrida_id: corrida.id, paso_id: pasoActual.id, orden: pasoActual.orden,
        intento: (Number(previo?.intento) || 0) + 1,
        foto_url: fotoUrl, temperatura_c: tempN, duracion_seg: durN,
        nota: nota || null, registrado_por: user?.id || null, cumple, datos,
      }).select().single()
      if (rErr) throw rErr

      // Los pesos ya estaban guardados por la tablet, colgados de la corrida.
      // Acá solo se les enlaza el registro del paso, para que el reporte pueda
      // ir del paso a sus pesos. Si esto falla, los pesos NO se pierden — solo
      // quedan sin enlazar, y por eso no se aborta el guardado del paso.
      if (pasoActual.requiere_pesaje && !enRevision) {
        const { error: pErr } = await db.from('bpm_registro_pesajes')
          .update({ registro_id: reg.id })
          .eq('corrida_id', corrida.id).is('registro_id', null)
        if (pErr) console.warn('Los pesos quedaron sin enlazar al registro:', pErr.message)
      }

      if (fallas.length) {
        await db.from('bpm_desviaciones').insert(
          fallas.map(f => ({
            corrida_id: corrida.id, paso_id: pasoActual.id, registro_id: reg.id,
            registrada_por: user?.id || null, contexto: f.contexto || contexto,
            causa: f.causa || causaTxt || null, accion: f.accion || accionTxt || null,
            tipo: f.tipo, detalle: f.detalle, valor_esperado: f.valor_esperado, valor_real: f.valor_real,
          }))
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

      if (bloquea) setError(retener
        ? `Paso ${pasoActual.orden} retenido. Se abrió la desviación y la tanda queda en espera de Calidad.`
        : 'El paso no cumplió. La tanda quedó bloqueada y se avisó a Casa Matriz.')
    } catch (e) {
      setError(e.message || 'No se pudo registrar')
    }
    setGuardando(false)
  }

  // La versión Mauricio manda la decisión desde su tarjeta (T12): `decision`
  // 'retest' | 'liberar' y la justificación. La piloto sigue con prompt().
  async function liberar(opts) {
    let motivo, repetir
    if (opts?.decision) {
      motivo = opts.justificacion
      repetir = opts.decision === 'retest'
      if (!motivo || motivo.length < 20) { setError('La justificación necesita al menos 20 caracteres.'); return }
    } else {
      motivo = prompt('¿Por qué se libera esta tanda? Queda registrado con tu nombre.')
      if (!motivo) return
      // Auditoría de Mauricio: después de corregir se REPITE la verificación,
      // no se salta el paso. Avanzar sin repetir queda como excepción explícita.
      repetir = window.confirm(
        `¿Repetir el paso ${corrida.paso_actual} con una nueva verificación?\n\n` +
        'Aceptar = el operario vuelve a hacer el paso (recomendado).\n' +
        'Cancelar = avanzar al siguiente paso sin repetirlo.')
    }
    setGuardando(true); setError('')
    await db.from('bpm_corridas').update({
      estado: 'liberada', liberada_por: user?.id || null,
      liberada_at: new Date().toISOString(),
      liberacion_motivo: `${opts?.decision ? (repetir ? 'Retest' : 'Liberar con justificación') + ': ' : ''}${motivo}${repetir ? ' · se repite el paso' : ' · se avanza sin repetir'}`,
      paso_actual: repetir ? corrida.paso_actual : Math.min((corrida.paso_actual || 1) + 1, pasos.length),
    }).eq('id', corrida.id)
    await db.from('bpm_desviaciones').update({
      resuelta_por: user?.id || null, resuelta_at: new Date().toISOString(), resolucion: motivo,
    }).eq('corrida_id', corrida.id).is('resuelta_at', null)
    setGuardando(false)
    cargar()
  }

  async function anular() {
    const motivo = prompt(
      `¿Por qué se anula la tanda del ${corrida.fecha}?\n\n` +
      'Queda en el historial con tu nombre. Después podés iniciar otra.')
    if (motivo === null) return
    if (!motivo.trim()) { setError('Sin motivo no se anula.'); return }
    setGuardando(true); setError('')
    try {
      const quien = [user?.nombre, user?.apellido].filter(Boolean).join(' ') || 'usuario'
      const { error } = await db.from('bpm_corridas').update({
        estado: 'anulada',
        cerrada_at: new Date().toISOString(),
        notas: `${corrida.notas ? corrida.notas + '\n' : ''}Anulada por ${quien}: ${motivo.trim()}`,
      }).eq('id', corrida.id).neq('estado', 'anulada')
      if (error) throw error
      // Sin corrida activa, la pantalla vuelve a "Iniciar tanda".
      setCorrida(null); setRegistros([]); setDesv([])
      await cargar()
    } catch (e) {
      setError(e.message || 'No se pudo anular')
    }
    setGuardando(false)
  }

  // ═══════════════════ RENDER ═══════════════════
  if (cargando) return <div style={{ padding: 20, color: C.dim }}>Cargando…</div>

  // Versión Mauricio: misma lógica, pantalla en el formato del anexo
  // FD-CI-DO-013-A01 (BPMChiliClaro). La piloto sigue abajo, como siempre.
  if (plantilla?.retiene_ante_falla) {
    const m = {
      user, plantilla, plantillas, pasos, corrida, registros, desviaciones, historial,
      pasoActual, regPrevio, intentoPrevio, enRevision,
      cat, valores, setValores, hoy, ahoraISO, quien, ahora, horaServidor,
      foto, preview, fileRef, onFoto,
      temp, setTemp, dur, setDur, nota, setNota,
      pesajeItems, pesajes, pesajeHechos, pesajeMalos, pesajeListo, cargarPesajes, banda,
      fase, restan, hechas, setFase, setRestan, setHechas,
      evalC, fallasVivas, tieneControles, esperaOk, esperaTarde, segDesdePrevio,
      guardando, error, expediente,
      puedeRegistrar, puedeLiberar, puedeRevisar,
      iniciarTanda, registrarPaso, liberar, anular, bajarExpediente, cargar,
    }
    return <BPMChiliClaro m={m} />
  }

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
          {plantilla?.version && <> · <b style={{ color: C.txt }}>{plantilla.version}</b></>}
        </div>

        {/* Cambiar de versión solo mientras no hay tanda abierta: una tanda
            empezada con un criterio no se termina con otro. */}
        {plantillas.length > 1 && !corrida && puedeRevisar && (
          <div style={{ ...card, borderColor: C.acc }}>
            <b style={{ fontSize: 14 }}>Versión del control</b>
            <div style={{ color: C.dim, fontSize: 12.5, margin: '4px 0 10px', lineHeight: 1.5 }}>
              La <b style={{ color: C.txt }}>piloto</b> es la que corre en Casa Matriz hoy.
              La <b style={{ color: C.txt }}>versión Mauricio</b> suma los parámetros y los
              criterios del informe de validación: un paso fuera de criterio no se cierra.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {plantillas.map(p => (
                <button key={p.id} onClick={() => cargar(p.id)}
                  style={{ ...btn(p.id === plantilla?.id ? C.ok : '#3f3f46'), fontSize: 13.5, padding: '9px 14px' }}>
                  {p.version || p.nombre}
                  {!p.activo && <span style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 7 }}>en pruebas</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {plantilla?.retiene_ante_falla && (
          <div style={{
            background: '#101827', border: `1px solid ${C.acc}`, borderRadius: 10,
            padding: '11px 14px', marginBottom: 14, color: '#bfdbfe', fontSize: 13, lineHeight: 1.5,
          }}>
            <b style={{ color: C.acc }}>Versión Mauricio.</b> Un control fuera de criterio
            <b> retiene el paso</b>: no se puede cerrar hasta corregir y volver a medir.
            {!plantilla.activo && ' Todavía está en pruebas y no reemplaza a la piloto.'}
          </div>
        )}

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
              // El ÚLTIMO registro del paso: si se repitió tras un desvío, manda la repetición.
              const r = [...registros].reverse().find(x => x.paso_id === p.id)
              const intentos = registros.filter(x => x.paso_id === p.id).length
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
                        {r.datos?.resumen && ` · ${r.datos.resumen}`}
                        {intentos > 1 && <span style={{ color: C.warn }}> · {intentos}ª verificación</span>}
                        {r.foto_url && <> · <a href={r.foto_url} target="_blank" rel="noreferrer" style={{ color: C.acc }}>foto</a></>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Anular y empezar de nuevo. Existe porque las pruebas del
                procedimiento se bloquean igual que una tanda real, y sin esto
                cada prueba terminaba en un mensaje a Cesar para que liberara el
                día. No borra nada: la tanda queda como anulada con el motivo. */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}`,
                          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* El expediente se puede bajar en cualquier momento: a media
                  tanda sirve para mostrarle a Calidad lo que va pasando. */}
              <button style={{ ...btn('#1e3a5f', expediente === corrida.id), fontSize: 13, padding: '9px 14px' }}
                disabled={expediente === corrida.id} onClick={() => bajarExpediente(corrida.id)}>
                {expediente === corrida.id ? 'Armando el PDF…' : '📄 Expediente de esta tanda'}
              </button>
              {puedeRevisar && corrida.estado !== 'anulada' && (
                <>
                  <button style={{ ...btn('#3b1717', guardando), color: '#fca5a5', fontSize: 13, padding: '9px 14px' }}
                    disabled={guardando} onClick={anular}>
                    Anular esta tanda y empezar otra
                  </button>
                  <span style={{ fontSize: 12, color: C.dim }}>
                    Queda en el historial como anulada, con tu nombre y el motivo.
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Desviaciones ── */}
        {desviaciones.length > 0 && (
          <div style={{ ...card, background: '#3a1414', border: `1px solid ${C.bad}` }}>
            <b style={{ color: '#fca5a5' }}>Desviaciones</b>
            {desviaciones.map(d => (
              <div key={d.id} style={{ fontSize: 13, marginTop: 8, color: '#fecaca' }}>
                • {d.detalle} — esperado {d.valor_esperado}, real <b>{d.valor_real}</b>
                {(d.causa || d.accion) && (
                  <div style={{ fontSize: 12, color: '#fca5a5', marginLeft: 12 }}>
                    {d.causa && <>Causa: {d.causa}</>}{d.causa && d.accion && ' · '}{d.accion && <>Acción: {d.accion}</>}
                  </div>
                )}
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

            {/* ── Controles estructurados (auditoría Mauricio, fase 1) ──
                Equipo + calibración, condición del equipo, químicos con lote y
                concentración, secuencia de limpieza con hora por etapa y
                cronómetro de contacto. El veredicto lo calcula el sistema. */}
            {tieneControles && intentoPrevio && (
              <div style={{ background: '#3a2f0f', border: `1px solid ${C.warn}`, borderRadius: 9, padding: '10px 12px', marginBottom: 12, fontSize: 13, color: '#fcd34d', lineHeight: 1.5 }}>
                <b>Segunda verificación.</b> La anterior ({fmtHora(intentoPrevio.registrado_at)}) quedó registrada como no conforme y Calidad liberó la tanda. Repetí el paso completo.
              </div>
            )}
            {tieneControles && (
              <Controles
                controles={pasoActual.controles} valores={valores} setValores={setValores}
                cat={cat} hoy={hoy} ahoraISO={ahoraISO} quien={quien} ahora={ahora}
              />
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
                {/* El pesaje ya no se hace acá. Son 25 ingredientes y la balanza
                    está cableada a la tablet que vive junto a la mesa: esta
                    pantalla solo espera y muestra el avance. Bloquear el botón
                    hasta que estén todos es lo que impide avanzar sin pesar. */}
                <div style={{
                  background: pesajeListo ? '#0e1f14' : '#101c2a',
                  border: `1px solid ${pesajeListo ? C.ok : C.acc}`,
                  borderRadius: 10, padding: 14,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                                alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700,
                                   color: pesajeListo ? '#86efac' : '#bfdbfe' }}>
                      ⚖️ {enRevision ? 'Pesaje — en revisión no aplica'
                          : pesajeListo ? 'Pesaje completo'
                          : 'El pesaje se hace en la tablet'}
                    </span>
                    {!enRevision && (
                      <span style={{ fontSize: 17, fontWeight: 800, whiteSpace: 'nowrap',
                                     color: pesajeListo ? C.ok : C.txt }}>
                        {pesajeHechos} / {pesajeItems.length}
                      </span>
                    )}
                  </div>

                  <div style={{ height: 7, background: '#2a2a2e', borderRadius: 5,
                                overflow: 'hidden', marginBottom: 10 }}>
                    <div style={{
                      width: `${pesajeItems.length ? 100 * pesajeHechos / pesajeItems.length : 0}%`,
                      height: '100%', background: pesajeListo ? C.ok : C.acc, transition: 'width .3s',
                    }} />
                  </div>

                  <div style={{ fontSize: 12.5, color: pesajeListo ? '#86efac' : '#bfdbfe',
                                lineHeight: 1.6 }}>
                    {enRevision
                      ? 'En revisión no se pesa nada. Seguí al paso siguiente.'
                      : pesajeListo
                        ? (pesajeMalos > 0
                            ? `Quedaron ${pesajeMalos} fuera de banda. Van a salir como desviación.`
                            : 'Todos dentro de tolerancia. Ya podés continuar.')
                        : 'Andá a la tablet de la balanza, pesá los ingredientes y volvé acá. Esta pantalla se actualiza sola.'}
                  </div>

                  {!enRevision && !pesajeListo && (
                    <button onClick={cargarPesajes} style={{
                      marginTop: 10, background: '#141416', color: C.acc,
                      border: `1px solid ${C.acc}`, borderRadius: 8, padding: '9px 14px',
                      fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit',
                    }}>Actualizar</button>
                  )}
                </div>

                {/* ── Trazabilidad de lo pesado (fase 2) ──────────────────
                    El detalle se captura en la tablet; acá se revisa antes de
                    cerrar el paso. Lo que falta sale en rojo con su nombre. */}
                {!enRevision && pesajeHechos > 0 && (
                  <div style={{ marginTop: 12, background: '#101012', border: `1px solid ${C.line}`,
                                borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>Trazabilidad de la tanda</div>
                    <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 8, lineHeight: 1.5 }}>
                      Lote, proveedor y vencimiento de cada insumo, con la báscula que se usó.
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 460 }}>
                        <thead><tr style={{ color: C.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: .4 }}>
                          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 600 }}>Ingrediente</th>
                          <th style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 600 }}>Peso</th>
                          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 600 }}>Lote</th>
                          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 600 }}>Proveedor</th>
                          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 600 }}>Vence</th>
                          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 600 }}>Báscula</th>
                        </tr></thead>
                        <tbody>
                          {pesajeItems.map(it => {
                            const p = pesajes[it.id]
                            const falta = (pide, val) => it[pide] && !val
                            const cel = (pide, val) => falta(pide, val)
                              ? <span style={{ color: '#fca5a5' }}>falta</span>
                              : <span>{val || '—'}</span>
                            return (
                              <tr key={it.id} style={{ borderTop: `1px solid #212125`, opacity: p ? 1 : .45 }}>
                                <td style={{ padding: '5px 3px' }}>
                                  {it.ingrediente}
                                  {p?.motivo && <div style={{ fontSize: 11, color: '#fca5a5' }}>{p.motivo}</div>}
                                </td>
                                <td style={{ padding: '5px 3px', textAlign: 'right', whiteSpace: 'nowrap',
                                             color: !p ? C.dim : p.cumple === false ? '#fca5a5' : '#86efac',
                                             fontVariantNumeric: 'tabular-nums' }}>
                                  {p ? `${Number(p.g).toLocaleString('es-SV')} ${it.unidad}` : 'sin pesar'}
                                </td>
                                <td style={{ padding: '5px 3px' }}>{p ? cel('requiere_lote', p.lote) : '—'}</td>
                                <td style={{ padding: '5px 3px' }}>{p ? cel('requiere_proveedor', p.proveedor) : '—'}</td>
                                <td style={{ padding: '5px 3px', whiteSpace: 'nowrap' }}>{p ? cel('requiere_vencimiento', p.vencimiento) : '—'}</td>
                                <td style={{ padding: '5px 3px', color: C.dim, whiteSpace: 'nowrap' }}>{p?.bascula || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
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

            {/* Desvío: aparece en cuanto algo no cumple (control o temperatura) y
                pide causa y acción del catálogo antes de dejar registrar. */}
            {/* Versión Mauricio: con una falla el paso no se cierra. En vez
                del panel de desvío —que servía para documentar y seguir— se
                explica qué hay que corregir y se espera la nueva medición. */}
            {!enRevision && fallasVivas.length > 0 && plantilla?.retiene_ante_falla && (
              <div style={{ ...card, background: '#3a1212', border: `1px solid ${C.bad}`, color: '#fecaca' }}>
                <b style={{ display: 'block', marginBottom: 6 }}>Paso {pasoActual.orden} retenido</b>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 9 }}>
                  Esta versión del control no deja cerrar un paso fuera de criterio.
                  Corregí lo de abajo, volvé a medir y el botón se habilita solo.
                  Si no se puede corregir, llamá a Calidad antes de seguir.
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
                  {fallasVivas.map((f, i) => (
                    <li key={i}>
                      {f.detalle}
                      {f.valor_real != null && (
                        <span style={{ color: '#fca5a5' }}> — se midió {f.valor_real}
                          {f.valor_esperado ? `, se pide ${f.valor_esperado}` : ''}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!enRevision && fallasVivas.length > 0 && !plantilla?.retiene_ante_falla && (
              <PanelDesvio
                contexto={pasoActual.contexto_desvio || 'general'} cat={cat} fallas={fallasVivas}
                desvio={desvio} setDesvio={setDesvio} esCritico={!!pasoActual.es_critico}
              />
            )}

            {/* El pesaje se hace en otra pantalla y en otro aparato, así que el
                botón se apaga hasta que la tablet termine. Sin esto, avanzar
                deja la tanda sin trazabilidad de los ingredientes. */}
            {(() => {
              const faltaPesar = pasoActual.requiere_pesaje && !enRevision && !pesajeListo
              const ctrl = tieneControles && !enRevision
              const faltaCtrl = ctrl && (!cat.listo || evalC.pendientes.length > 0)
              const hayFalla  = !enRevision && fallasVivas.length > 0
              // Versión Mauricio: una falla deja el paso RETENIDO y no se
              // puede cerrar. En la piloto sigue como siempre — con causa y
              // acción el paso se registra con el desvío documentado.
              const retiene  = hayFalla && !!plantilla?.retiene_ante_falla
              const faltaDesvio = hayFalla && !retiene && !desvioValido(desvio)
              const bloqueado  = guardando || !esperaOk || faltaPesar || faltaCtrl || faltaDesvio || retiene
              return (
                <button style={{ ...btn(hayFalla ? C.bad : C.ok, bloqueado), width: '100%' }}
                        disabled={bloqueado} onClick={registrarPaso}>
                  {guardando ? 'Guardando…'
                    : retiene ? `Paso ${pasoActual.orden} retenido · corregí y volvé a medir`
                    : faltaPesar ? `Faltan ${pesajeItems.length - pesajeHechos} por pesar en la tablet`
                    : faltaCtrl ? (cat.listo ? `Falta: ${evalC.pendientes[0]}` : 'Cargando catálogos…')
                    : faltaDesvio ? 'Elegí causa y acción del desvío'
                    : hayFalla ? `Registrar desvío y bloquear el paso ${pasoActual.orden}`
                    : `Registrar paso ${pasoActual.orden}`}
                </button>
              )
            })()}
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
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>
              El 📄 baja el expediente completo de esa tanda: pasos con hora y responsable,
              químicos, pesaje con lotes y desviaciones.
            </div>
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
                    <td style={{ padding: '6px 0', textAlign: 'right', width: 34 }}>
                      <button onClick={() => bajarExpediente(h.id)} disabled={expediente === h.id}
                        title="Bajar el expediente de esta tanda en PDF"
                        style={{ background: 'none', border: 'none', color: expediente === h.id ? C.dim : C.acc,
                                 cursor: expediente === h.id ? 'wait' : 'pointer', fontSize: 14, padding: '2px 4px' }}>
                        {expediente === h.id ? '…' : '📄'}
                      </button>
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
