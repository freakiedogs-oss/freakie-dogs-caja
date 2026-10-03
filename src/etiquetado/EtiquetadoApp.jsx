/* ═══════════════════════════════════════════════════════════════════════
   Estación de pesaje y etiquetado · Casa Matriz
   freakie-dogs-caja.vercel.app/etiquetado.html

   Elegís el producto, decís cuántas unidades, y por cada una: se pone en la
   báscula, el peso se estabiliza solo y un toque la pesa e imprime su
   etiqueta con lote, peso, fecha, quién la hizo y hasta cuándo vence.

   PIN POR PERSONA (3-oct-2026). Cada tanda de pesaje empieza con el PIN de
   quien la hace: la etiqueta sale a nombre suyo y la sesión se cierra sola al
   terminar el lote o al volver atrás. Cada tanda se liga a un lote de
   preparación (prep_lotes). Si ese lote no tiene sus insumos registrados, se
   imprime igual (nunca se frena la línea) pero queda una deuda a nombre de quien
   imprimió, y Mi Asistencia no la deja marcar salida hasta saldarla.

   Todavía NO toca el inventario ni el kardex: solo registra la impresión
   (etiqueta_impresiones). Lee la báscula e imprime de verdad.

   Aparatos: báscula Rhino BAR-6X (mismo cable y parser del porcionador) e
   impresora Zebra ZD421 por ZPL sobre WebUSB.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useBalanza } from '../porcionador/useBalanza'
import { ImpresoraZebra, hayWebUsb } from './zebraUsb'
import { armarZplFila, zplPruebaFila, DPI_OPCIONES } from './zebraZpl'
import { cargarProductos, marcarUso } from './productos'
import ProductoEditor from './ProductoEditor'
import PinModal from './PinModal'
import { loteDelDia, registrarImpresion, vaciarBuzon } from './lotes'

const C = {
  bg: '#0a0a0b', card: '#141416', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', bad: '#ef4444', acc: '#3b82f6', warn: '#f59e0b',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }
const btn = (color, off) => ({
  background: off ? '#1f2937' : color, color: off ? '#6b7280' : '#06180c',
  border: 0, borderRadius: 12, padding: 16, fontSize: 17, fontWeight: 800,
  cursor: off ? 'default' : 'pointer', width: '100%', fontFamily: 'inherit',
})
const chip = (on) => ({
  borderRadius: 20, padding: '5px 11px', fontSize: 12, fontWeight: 700,
  background: on ? '#0b3b2e' : '#1c1c20', color: on ? '#6ee7b7' : C.dim,
  border: `1px solid ${on ? '#166534' : C.line}`,
})

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fechaSV = (dias = 0) => {
  const d = new Date(); d.setDate(d.getDate() + dias)
  return `${String(d.getDate()).padStart(2, '0')}-${MESES[d.getMonth()]}-${d.getFullYear()}`
}
const horaSV = () => new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })
const lbs = (g) => (g / 453.59237).toFixed(2)
const mil = (g) => Math.round(g).toLocaleString('en-US')

const CLAVE_DPI = 'etiquetado_dpi'

export default function EtiquetadoApp() {
  // La lista viene de la base (`etiquetado_productos`). Si la red falla cae a
  // lo último que vio esta tablet, y si nunca vio nada, al respaldo del
  // código: una lista vieja deja seguir produciendo, una vacía no.
  const [productos, setProductos] = useState([])
  const [fuente, setFuente] = useState(null)   // base | cache | respaldo
  const [editor, setEditor] = useState(null)   // null · 'nuevo' · producto a corregir

  const releer = useCallback(async () => {
    const { lista, fuente: f } = await cargarProductos()
    setProductos(lista); setFuente(f)
  }, [])
  useEffect(() => { releer() }, [releer])

  const [paso, setPaso]   = useState(1)     // 1 producto · 2 cantidad · 3 pesaje · 4 resumen
  const [prod, setProd]   = useState(null)
  const [cuenta, setCuenta] = useState('')
  const [total, setTotal] = useState(0)
  const [hechas, setHechas] = useState([])
  // 25-sep-2026: la cinta trae 2 etiquetas por fila (ver zebraZpl.js), así que
  // se imprime de a pares. `pendiente` es la primera unidad del par, ya
  // pesada pero todavía sin imprimir — espera a que se pese la siguiente.
  const [pendiente, setPendiente] = useState(null)
  // Sesión por persona. Sin PIN no se ve ni la lista de productos: `actor`
  // entra con PIN al abrir la pantalla y se borra al terminar el producto, al
  // volver atrás o a los 30 s sin tocar nada en la selección. `loteSel` es el
  // lote del día de esa persona (donde caen todas sus etiquetas de hoy; los
  // insumos los registra al final del turno).
  const [actor, setActor] = useState(null)
  const [loteSel, setLoteSel] = useState(null)       // { id|null, lote }
  const [bloqueada, setBloqueada] = useState(false)  // se cerró sola por inactividad
  const [quienImprimio, setQuienImprimio] = useState('')
  const [sinInsumos, setSinInsumos] = useState(null) // true | false | null (sin respuesta)
  const [msg, setMsg]     = useState('')
  const [err, setErr]     = useState('')
  const [imprimiendo, setImprimiendo] = useState(false)
  const [ajustando, setAjustando] = useState(false)

  const [dpi, setDpi] = useState(() => Number(localStorage.getItem(CLAVE_DPI)) || 203)
  useEffect(() => { try { localStorage.setItem(CLAVE_DPI, String(dpi)) } catch { /* da igual */ } }, [dpi])

  const bal = useBalanza()
  const zebra = useRef(null)
  const [impresoraOk, setImpresoraOk] = useState(false)

  if (!zebra.current) zebra.current = new ImpresoraZebra()

  // Al abrir se intenta reusar el permiso que ya dio el operario otro día.
  // Si no hay, no se molesta a nadie: queda el botón de conectar.
  useEffect(() => {
    let vivo = true
    zebra.current.reconectar()
      .then(ok => { if (vivo) setImpresoraOk(!!ok) })
      .catch(() => { /* sin permiso previo, es lo normal la primera vez */ })
    return () => { vivo = false }
  }, [])

  const aviso = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? '' : m)), 2200) }, [])

  async function conectarImpresora() {
    setErr('')
    try { await zebra.current.conectar(); setImpresoraOk(true); aviso('Impresora conectada') }
    catch (e) { setErr(e.message || 'No se pudo conectar la impresora') }
  }

  async function imprimirPrueba() {
    setErr('')
    try { await zebra.current.enviar(zplPruebaFila(dpi)); aviso('Fila de prueba enviada (2 etiquetas)') }
    catch (e) { setErr(e.message || 'No se pudo imprimir') }
  }

  // La báscula pesa producto + empaque. Todo lo que se juzga y todo lo que se
  // imprime es NETO: la sucursal recibe carne, no bolsa.
  const neto = (g) => Math.max(0, g - (prod?.tara || 0))
  const dentro = (g) => !prod?.gramos || Math.abs(neto(g) - prod.gramos) <= (prod.banda || 0)

  // Arma los datos de UNA unidad en la forma que pide armarZplFila. La
  // fecha/hora y quién la hizo van dentro del QR, no impresas: a 2×1" por
  // etiqueta no entran como texto propio (ver zebraZpl.js).
  const datosCelda = (u) => ({
    producto: prod.nombre, lote: loteSel.lote, indice: u.i, total,
    gramos: mil(u.n), libras: lbs(u.n), vence: u.vence,
    // En el QR va el neto y, cuando hay empaque, también el bruto y la tara:
    // si algún día se discute un peso, ahí está la cuenta completa.
    qr: `${loteSel.lote}|${prod.id}|${u.i}/${total}|${Math.round(u.n)}g`
      + (prod.tara ? `|br${Math.round(u.g)}|t${prod.tara}` : '')
      + `|${u.fecha}|${u.hora}|${actor ? actor.nombre : quienImprimio}`,
  })

  async function pesarEImprimir() {
    if (!bal.estable || imprimiendo) return
    setErr(''); setImprimiendo(true)
    const g = bal.gramos
    const i = hechas.length + (pendiente ? 1 : 0) + 1
    const unidad = {
      i, g, n: neto(g), hora: horaSV(), ok: dentro(g),
      vence: fechaSV(prod.dias), fecha: fechaSV(0),
    }

    // Última unidad del lote y quedó sola (total impar): no hay con qué
    // emparejarla, así que se imprime ya, duplicada en las 2 etiquetas de la
    // fila — mejor eso que dejar una en blanco a mitad de la cinta.
    const esUltimaSuelta = !pendiente && i === total

    if (!pendiente && !esUltimaSuelta) {
      setPendiente(unidad)
      setImprimiendo(false)
      aviso(`Unidad ${i} pesada · pesá la siguiente para imprimir las dos juntas`)
      return
    }

    // Con pareja: izq = la pendiente, der = esta. Suelta: las dos son esta
    // misma unidad (se duplica), por eso alcanza con `unidad` en ambos casos.
    const izq = pendiente || unidad
    const der = unidad
    try {
      await zebra.current.enviar(armarZplFila(datosCelda(izq), datosCelda(der), { dpi }))
    } catch (e) {
      // Si la impresión falla, NINGUNA de las dos pesadas se cuenta: si se
      // contaran, el operario creería que ya tienen etiqueta y seguiría con
      // las siguientes. Vale más repetir la pesada que una bolsa sin
      // identificar.
      setErr((e.message || 'No se pudo imprimir') + ' · La unidad no se contó, volvé a pesarla.')
      setImprimiendo(false)
      return
    }
    const nuevas = pendiente ? [pendiente, unidad] : [unidad]
    const listo = [...hechas, ...nuevas]
    setHechas(listo)
    setPendiente(null)
    setImprimiendo(false)
    // Deja constancia de la impresión a nombre de quien la hizo. Sin esperar:
    // si no hay red queda en el buzón de la tablet y se sube sola.
    registrarImpresion({ usuarioId: actor.id, loteId: loteSel.id, productoId: prod.id, producto: prod.nombre, unidades: nuevas.length })
      .then(r => { if (r) setSinInsumos(!r.con_insumos) })
    if (listo.length >= total) { setPaso(4); setQuienImprimio(actor.nombre); setActor(null) }
    else aviso(nuevas.length === 2
      ? `Unidades ${izq.i} y ${der.i} impresas · quitalas de la báscula`
      : `Unidad ${i} impresa · quitá la unidad de la báscula`)
  }

  async function reimprimir(u) {
    setErr('')
    try {
      // Reimpresión suelta: se duplica en las 2 etiquetas de la fila. No hay
      // con qué emparejarla porque ya se imprimió (o falló) en su momento.
      await zebra.current.enviar(armarZplFila(datosCelda(u), datosCelda(u), { dpi }))
      aviso(`Reimpresa la unidad ${u.i}`)
    } catch (e) { setErr(e.message || 'No se pudo reimprimir') }
  }

  // Empezar pide el PIN de quien va a pesar. Con el PIN adentro se arma el lote
  // (o se crea uno "sin preparación", que deja deuda) y se pasa a pesar.
  function empezar() {
    const n = Number(cuenta)
    if (!(n > 0) || !actor) return
    arrancar(actor, n)
  }

  async function arrancar(a, n) {
    setErr('')
    let l
    try { l = await loteDelDia(a.id) }
    // Sin red igual se imprime: el lote se resuelve (y la deuda se abre) cuando vuelva.
    catch { l = { id: null, lote: 'L-' + horaSV().replace(':', '') + '-SIN' } }
    setLoteSel(l)
    // Deja constancia de que este producto se usa hoy: es lo que lo mantiene
    // en la lista (lo que nadie pesa en 15 días lo retira solo la base).
    // No espera la respuesta — si la red está caída, se pesa igual.
    marcarUso(prod.id)
    setSinInsumos(null)
    setTotal(n); setHechas([]); setPendiente(null); setPaso(3)
  }

  // Volver atrás o terminar cierra la sesión: el siguiente pone su PIN.
  function salirSesion() { setActor(null); setLoteSel(null) }

  // Bloqueo por inactividad: en la selección de producto y de cantidad, 30 s sin
  // tocar nada cierran la sesión y vuelve a pedir el PIN. Pesando no aplica.
  useEffect(() => {
    if (!actor || (paso !== 1 && paso !== 2) || editor) return
    let t
    const armar = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        setActor(null); setLoteSel(null); setProd(null); setCuenta(''); setPaso(1); setBloqueada(true)
      }, 30000)
    }
    const evs = ['pointerdown', 'keydown', 'touchstart']
    evs.forEach(e => window.addEventListener(e, armar, true))
    armar()
    return () => { clearTimeout(t); evs.forEach(e => window.removeEventListener(e, armar, true)) }
  }, [actor, paso, editor])

  function reiniciar() {
    salirSesion()
    setPaso(1); setProd(null); setCuenta(''); setTotal(0); setHechas([]); setPendiente(null)
    setSinInsumos(null); setQuienImprimio('')
  }

  // Buzón de impresiones que quedaron sin subir por falta de red.
  useEffect(() => {
    vaciarBuzon().then(n => { if (n) aviso(`Se subieron ${n} impresión${n === 1 ? '' : 'es'} que estaban guardadas en la tablet`) })
    const f = () => { vaciarBuzon() }
    window.addEventListener('online', f)
    return () => window.removeEventListener('online', f)
  }, [aviso])

  // ── Barra de aparatos, siempre visible ──
  const barra = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Pesaje y etiquetado</div>
        <div style={{ color: C.dim, fontSize: 12.5 }}>Casa Matriz · {loteSel ? `lote ${loteSel.lote}` : 'sin lote'} · {actor ? actor.nombre : paso === 4 ? 'sesión cerrada' : 'pantalla bloqueada · entrá con tu PIN'}</div>
      </div>
      <button onClick={bal.estado === 'conectada' ? bal.desconectar : bal.conectar}
        style={{ ...chip(bal.estado === 'conectada'), cursor: 'pointer', fontFamily: 'inherit' }}>
        ● Báscula {bal.estado === 'conectada' ? 'lista' : 'conectar'}
      </button>
      <button onClick={impresoraOk ? imprimirPrueba : conectarImpresora}
        style={{ ...chip(impresoraOk), cursor: 'pointer', fontFamily: 'inherit' }}>
        ● Impresora {impresoraOk ? 'probar' : 'conectar'}
      </button>
      <button onClick={() => setAjustando(v => !v)}
        style={{ ...chip(false), cursor: 'pointer', fontFamily: 'inherit' }}>⚙︎ {dpi} dpi</button>
    </div>
  )

  const panelAjustes = ajustando && (
    <div style={{ ...card, borderColor: C.acc, marginBottom: 14 }}>
      <b style={{ fontSize: 14 }}>Resolución de la impresora</b>
      <div style={{ color: C.dim, fontSize: 12.5, margin: '5px 0 10px', lineHeight: 1.5 }}>
        Apagá la Zebra, mantené apretado el botón de avance y encendela: saca una
        etiqueta de configuración con la resolución. Si el texto sale corrido o
        cortado, es que acá está el número equivocado.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {DPI_OPCIONES.map(d => (
          <button key={d} onClick={() => setDpi(d)}
            style={{ ...btn(d === dpi ? C.ok : '#1c1c20'), color: d === dpi ? '#06180c' : C.txt, fontSize: 15, padding: 12 }}>
            {d} dpi
          </button>
        ))}
      </div>
      {impresoraOk && (
        <button onClick={imprimirPrueba} style={{ ...btn('#1c1c20'), color: C.txt, fontSize: 14, padding: 11, marginTop: 8 }}>
          Imprimir etiqueta de prueba
        </button>
      )}
    </div>
  )

  const avisos = (
    <>
      {err && <div style={{ ...card, background: '#3a1212', borderColor: C.bad, color: '#fecaca', marginBottom: 12, fontSize: 14 }}>{err}</div>}
      {msg && <div style={{ ...card, background: '#0b2417', borderColor: C.ok, color: '#6ee7b7', marginBottom: 12, fontSize: 14 }}>{msg}</div>}
      {!hayWebUsb() && (
        <div style={{ ...card, background: '#2a1f06', borderColor: '#78350f', color: '#fcd34d', marginBottom: 12, fontSize: 13.5, lineHeight: 1.5 }}>
          Este navegador no puede hablarle a la impresora. Abrí esta página en <b>Chrome de Android</b>,
          por https. En iPad no funciona.
        </div>
      )}
    </>
  )

  const marco = (hijos) => (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.txt, padding: 14,
                  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {barra}{panelAjustes}{avisos}{hijos}
      </div>
    </div>
  )

  // El editor tapa la pantalla: es una decisión sobre la lista, no sobre la
  // tanda que se está pesando.
  if (editor) return (
    <ProductoEditor
      productoBase={editor === 'nuevo' ? null : editor}
      onCerrar={() => setEditor(null)}
      onListo={async (guardado) => {
        setEditor(null)
        await releer()
        // Recién creado: se entra directo a decir cuántas. El operario vino
        // acá porque tenía el producto en la mano.
        if (guardado && editor === 'nuevo') { setProd(guardado); setCuenta(''); setPaso(2) }
        else if (guardado && prod?.id === guardado.id) setProd(guardado)
        aviso(`«${guardado?.nombre}» guardado`)
      }}
    />
  )

  // ── 0 · Pantalla bloqueada: sin PIN no se ve ni la lista de productos ──
  if (!actor && paso !== 4) return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.txt, padding: 14,
                  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>{barra}{panelAjustes}{avisos}</div>
      <PinModal
        titulo="¿Quién va a pesar?"
        sub={bloqueada
          ? 'La pantalla se bloqueó por inactividad. Marcá tu PIN para seguir: las etiquetas salen a tu nombre.'
          : 'Marcá tu PIN para entrar. Las etiquetas salen a tu nombre y la sesión se cierra sola al terminar cada producto.'}
        onListo={(a) => { setActor(a); setBloqueada(false); setPaso(1) }}
      />
    </div>
  )

  // ── 1 · Qué se va a pesar ──
  if (paso === 1) return marco(
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 11 }}>
        <span style={{ color: C.dim, fontSize: 14 }}>Hola, {actor?.nombre?.split(' ')[0]}. ¿Qué vas a pesar? <span style={{ fontSize: 12, opacity: .7 }}>· se bloquea sola a los 30 s sin tocar</span></span>
        {fuente && fuente !== 'base' && (
          <span style={{ color: C.warn, fontSize: 12 }}>
            sin conexión · lista {fuente === 'cache' ? 'de la última vez' : 'de respaldo'}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 9 }}>
        {productos.map(p => (
          <div key={p.id} style={{ ...card, position: 'relative' }}>
            <button onClick={() => { setProd(p); setCuenta(''); setPaso(2) }}
              style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer',
                       fontFamily: 'inherit', color: C.txt, width: '100%' }}>
              <div style={{ fontSize: 16, fontWeight: 700, paddingRight: 26 }}>{p.nombre}</div>
              <div style={{ color: p.gramos ? C.dim : C.warn, fontSize: 12.5, marginTop: 3 }}>
                {p.unidad} · {p.gramos ? `${mil(p.gramos)} g${p.banda ? ` ±${p.banda}` : ''}${p.tara ? ' neto' : ''}` : 'sin objetivo'}
              </div>
            </button>
            {/* Corregir está en cada tarjeta, no en un menú: los pesos malos se
                descubren pesando, no administrando. */}
            <button onClick={() => setEditor(p)} title={`Corregir ${p.nombre}`}
              style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 0,
                       color: C.dim, fontSize: 15, cursor: 'pointer', padding: 4, lineHeight: 1 }}>✎</button>
          </div>
        ))}

        <button onClick={() => setEditor('nuevo')}
          style={{ ...card, borderStyle: 'dashed', borderColor: C.acc, color: '#93c5fd',
                   textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>+ Agregar un producto</div>
          <div style={{ fontSize: 12.5, marginTop: 3, opacity: .85 }}>
            ¿Vas a pesar algo que no está en la lista?
          </div>
        </button>
      </div>
    </>
  )

  // ── 2 · Cuántas ──
  if (paso === 2) return marco(
    <>
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ ...card, flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>{prod.nombre}</div>
        <div style={{ color: C.dim, fontSize: 13.5, marginTop: 6, lineHeight: 1.7 }}>
          {prod.unidad}<br />
          {prod.gramos ? `Objetivo ${mil(prod.gramos)} g netos, banda ±${prod.banda} g` : 'Sin peso objetivo cargado'}<br />
          {prod.tara ? <>Tara del empaque {prod.tara} g · en báscula ≈ {mil(prod.gramos + prod.tara)} g <span style={{ color: C.warn }}>(tara provisional)</span><br /></> : null}
          Vence a los {prod.dias} días <span style={{ color: C.warn }}>(provisional)</span><br />
          {prod.conserva}
        </div>
        <div style={{ background: '#12233a', border: `1px solid ${C.acc}`, borderRadius: 12,
                      padding: 14, textAlign: 'center', marginTop: 14 }}>
          <div style={{ color: '#93c5fd', fontSize: 11.5, letterSpacing: .5 }}>¿CUÁNTAS UNIDADES?</div>
          <div style={{ fontSize: 44, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{cuenta || '—'}</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
          {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', '←'].map(k => (
            <button key={k} onClick={() => setCuenta(c => k === '←' ? c.slice(0, -1) : (c + k).replace(/^0+(?=\d)/, '').slice(0, 3))}
              style={{ ...btn('#1c1c20'), color: C.txt, fontSize: 21, padding: 15, fontFamily: 'ui-monospace, monospace' }}>
              {k}
            </button>
          ))}
        </div>
        <button onClick={empezar} disabled={!(Number(cuenta) > 0)}
          style={{ ...btn(C.ok, !(Number(cuenta) > 0)), marginTop: 10 }}>
          Empezar a pesar
        </button>
        <button onClick={() => setPaso(1)} style={{ ...btn('#1c1c20'), color: C.txt, fontSize: 14, padding: 11, marginTop: 8 }}>
          Elegir otro producto
        </button>
      </div>
    </div>
    </>
  )

  // ── 3 · Pesar e imprimir ──
  if (paso === 3) {
    const g = bal.gramos
    const bien = dentro(g)
    const listo = bal.estado === 'conectada' && bal.estable && g > 0
    const ultima = hechas[hechas.length - 1]
    return marco(
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', gap: 3, marginBottom: 11 }}>
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} style={{
                flex: 1, height: 6, borderRadius: 3,
                background: hechas[i] ? (hechas[i].ok ? C.ok : C.bad) : (i === hechas.length ? C.acc : C.line),
              }} />
            ))}
          </div>
          <div style={{ color: C.dim, fontSize: 13, textAlign: 'center' }}>
            {prod.nombre} · unidad <b style={{ color: C.txt }}>{hechas.length + (pendiente ? 1 : 0) + 1} de {total}</b>
          </div>
          {!!pendiente && (
            <div style={{ textAlign: 'center', fontSize: 12.5, color: C.acc, marginTop: 4 }}>
              Unidad {pendiente.i} pesada y en espera · imprime junto con la siguiente
            </div>
          )}
          <div style={{
            fontSize: 62, fontWeight: 800, textAlign: 'center', letterSpacing: -2,
            fontFamily: 'ui-monospace, Menlo, monospace', padding: '12px 0 4px',
            color: !listo ? C.dim : bien ? C.ok : C.bad,
          }}>
            {mil(g)}<span style={{ fontSize: 22, color: C.dim, marginLeft: 6 }}>g</span>
          </div>
          <div style={{ textAlign: 'center', fontSize: 14, color: C.dim, marginBottom: 12 }}>
            {bal.estado !== 'conectada' ? 'conectá la báscula arriba'
              : !bal.estable ? 'estabilizando…'
              : <>
                  {prod.tara
                    ? <>neto <b style={{ color: C.txt }}>{mil(neto(g))} g</b> · {lbs(neto(g))} lb <span style={{ opacity: .7 }}>(menos {prod.tara} g de bolsa)</span></>
                    : <>{lbs(g)} lb</>}
                  {' · '}{bien ? 'dentro de banda' : 'fuera de banda, se imprime igual'}
                </>}
          </div>
          <button onClick={pesarEImprimir} disabled={!listo || imprimiendo || !impresoraOk}
            style={btn(bien ? C.ok : C.warn, !listo || imprimiendo || !impresoraOk)}>
            {imprimiendo ? 'Imprimiendo…'
              : !impresoraOk ? 'Conectá la impresora arriba'
              : pendiente ? 'Pesar la pareja e imprimir las 2'
              : 'Pesar e imprimir'}
          </button>
          {!!ultima && (
            <button onClick={() => reimprimir(ultima)}
              style={{ ...btn('#1c1c20'), color: C.txt, fontSize: 14, padding: 11, marginTop: 8 }}>
              Reimprimir la última etiqueta
            </button>
          )}
          <button onClick={() => { salirSesion(); setProd(null); setCuenta(''); setPaso(1) }} style={{ ...btn('#1c1c20'), color: C.dim, fontSize: 13, padding: 10, marginTop: 8 }}>
            Cancelar (cierra tu sesión)
          </button>
        </div>

        <div style={{ ...card, flex: 1, minWidth: 240 }}>
          <b style={{ fontSize: 14 }}>Impresas ({hechas.length} de {total})</b>
          {hechas.length === 0 && (
            <div style={{ color: C.dim, fontSize: 13.5, marginTop: 10, lineHeight: 1.55 }}>
              Todavía ninguna. La etiqueta sale sola al tocar el botón: no hay
              diálogo de impresión.
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {[...hechas].reverse().map(u => (
              <div key={u.i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0',
                                      borderBottom: `1px solid ${C.line}`, fontSize: 14 }}>
                <span style={{ color: C.dim, width: 22 }}>{u.i}</span>
                <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', color: u.ok ? C.txt : '#fca5a5' }}>
                  {mil(u.n ?? u.g)} g · {lbs(u.n ?? u.g)} lb
                </span>
                <span style={{ color: C.dim, fontSize: 12.5 }}>{u.hora}</span>
                <button onClick={() => reimprimir(u)}
                  style={{ background: 'none', border: `1px solid ${C.line}`, color: C.dim,
                           borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↻</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── 4 · Resumen ──
  const suma = hechas.reduce((a, u) => a + (u.n ?? u.g), 0)   // neto: es lo que sale a sucursal
  const malas = hechas.filter(u => !u.ok)
  return marco(
    <>
      <div style={{ ...card, background: '#0b2417', borderColor: C.ok, color: '#86efac' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>Lote {loteSel?.lote} terminado</div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          {total} unidades de {prod.nombre} · {mil(suma)} g · {lbs(suma)} lb<br />
          {total} etiquetas impresas{malas.length ? <> · <b style={{ color: '#fca5a5' }}>{malas.length} fuera de banda</b></> : null}
        </div>
      </div>
      <div style={{ ...card, marginTop: 12, color: C.dim, fontSize: 13.5, lineHeight: 1.6 }}>
        Las etiquetas quedaron a nombre de <b style={{ color: C.txt }}>{quienImprimio}</b> y tu sesión se cerró.
        {sinInsumos === false && <> El lote tiene sus insumos registrados. <span style={{ color: C.ok }}>Todo en orden.</span></>}
        {sinInsumos === null && <> No hubo conexión para confirmar el lote: la impresión se sube sola cuando vuelva.</>}
      </div>
      {sinInsumos === true && (
        <div style={{ ...card, marginTop: 12, background: '#2a1f06', borderColor: '#78350f', color: '#fcd34d', fontSize: 14, lineHeight: 1.6 }}>
          <b>Recordá:</b> al terminar tu turno tenés que registrar los insumos que usaste (lote {loteSel?.lote}). Sin eso
          no vas a poder marcar tu salida (o hasta que el encargado la autorice o la pases a un compañero).
          {loteSel?.id && (
            <a href={`/preparacion.html?lote=${loteSel.id}`}
              style={{ display: 'block', marginTop: 10, background: C.ok, color: '#06180c', borderRadius: 10, padding: 12,
                       textAlign: 'center', fontWeight: 800, textDecoration: 'none' }}>
              Registrar los insumos ahora (o más tarde, al terminar el turno)
            </a>
          )}
        </div>
      )}
      <button onClick={reiniciar} style={{ ...btn(C.ok), marginTop: 12 }}>Pesar otro producto</button>
    </>
  )
}
