/* ═══════════════════════════════════════════════════════════════════════
   Estación de pesaje y etiquetado · Casa Matriz
   freakie-dogs-caja.vercel.app/etiquetado.html

   Elegís el producto, decís cuántas unidades, y por cada una: se pone en la
   báscula, el peso se estabiliza solo y un toque la pesa e imprime su
   etiqueta con lote, peso, fecha, quién la hizo y hasta cuándo vence.

   PRIMERA PRUEBA — no guarda nada. Lee la báscula de verdad e imprime de
   verdad, pero no toca la base ni el inventario. Es a propósito: primero se
   ve si la Rhino y la Zebra conviven en el adaptador USB; si algo falla, no
   quedan lotes basura que limpiar después. El lote es local y se reinicia.

   Aparatos: báscula Rhino BAR-6X (mismo cable y parser del porcionador) e
   impresora Zebra ZD421 por ZPL sobre WebUSB.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBalanza } from '../porcionador/useBalanza'
import { ImpresoraZebra, hayWebUsb } from './zebraUsb'
import { armarZplFila, zplPruebaFila, DPI_OPCIONES } from './zebraZpl'
import { conAjustes, leerAjustes } from './productos'

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

// El lote del día. Local a la tablet mientras esto sea una prueba: cuando la
// estación guarde en la base, el consecutivo lo da el servidor.
const CLAVE_LOTE = 'etiquetado_lote_v1'
function loteDeHoy() {
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_LOTE) || 'null')
    if (v && v.fecha === hoy) return v.lote
    const n = (v?.n || 0) + 1
    const lote = 'L-' + String(n).padStart(4, '0')
    localStorage.setItem(CLAVE_LOTE, JSON.stringify({ fecha: hoy, lote, n }))
    return lote
  } catch { return 'L-0001' }
}

const CLAVE_DPI = 'etiquetado_dpi'

export default function EtiquetadoApp({ quien }) {
  // Los ajustes del operario (peso objetivo, días) se leen una vez al abrir.
  // Todavía no se editan desde acá: el panel de engranaje es solo la
  // resolución, que es lo único que puede arruinar la impresión.
  const [ajustes] = useState(leerAjustes)
  const productos = useMemo(() => conAjustes(ajustes), [ajustes])

  const [paso, setPaso]   = useState(1)     // 1 producto · 2 cantidad · 3 pesaje · 4 resumen
  const [prod, setProd]   = useState(null)
  const [cuenta, setCuenta] = useState('')
  const [total, setTotal] = useState(0)
  const [hechas, setHechas] = useState([])
  // 25-sep-2026: la cinta trae 2 etiquetas por fila (ver zebraZpl.js), así que
  // se imprime de a pares. `pendiente` es la primera unidad del par, ya
  // pesada pero todavía sin imprimir — espera a que se pese la siguiente.
  const [pendiente, setPendiente] = useState(null)
  const [lote] = useState(loteDeHoy)
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

  const dentro = (g) => !prod?.gramos || Math.abs(g - prod.gramos) <= (prod.banda || 0)

  // Arma los datos de UNA unidad en la forma que pide armarZplFila. La
  // fecha/hora y quién la hizo van dentro del QR, no impresas: a 2×1" por
  // etiqueta no entran como texto propio (ver zebraZpl.js).
  const datosCelda = (u) => ({
    producto: prod.nombre, lote, indice: u.i, total,
    gramos: mil(u.g), libras: lbs(u.g), vence: u.vence,
    qr: `${lote}|${prod.id}|${u.i}/${total}|${u.g}g|${u.fecha}|${u.hora}|${quien}`,
  })

  async function pesarEImprimir() {
    if (!bal.estable || imprimiendo) return
    setErr(''); setImprimiendo(true)
    const g = bal.gramos
    const i = hechas.length + (pendiente ? 1 : 0) + 1
    const unidad = {
      i, g, hora: horaSV(), ok: dentro(g),
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
    if (listo.length >= total) setPaso(4)
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

  function empezar() {
    const n = Number(cuenta)
    if (!(n > 0)) return
    setTotal(n); setHechas([]); setPendiente(null); setPaso(3)
  }

  function reiniciar() {
    setPaso(1); setProd(null); setCuenta(''); setTotal(0); setHechas([]); setPendiente(null)
  }

  // ── Barra de aparatos, siempre visible ──
  const barra = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Pesaje y etiquetado</div>
        <div style={{ color: C.dim, fontSize: 12.5 }}>Casa Matriz · lote {lote} · {quien}</div>
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

  // ── 1 · Qué se va a pesar ──
  if (paso === 1) return marco(
    <>
      <div style={{ color: C.dim, fontSize: 14, marginBottom: 11 }}>¿Qué vas a pesar?</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 9 }}>
        {productos.map(p => (
          <button key={p.id} onClick={() => { setProd(p); setCuenta(''); setPaso(2) }}
            style={{ ...card, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: C.txt }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{p.nombre}</div>
            <div style={{ color: C.dim, fontSize: 12.5, marginTop: 3 }}>
              {p.unidad} · {p.gramos ? `${mil(p.gramos)} g ±${p.banda}` : 'sin objetivo'}
            </div>
          </button>
        ))}
      </div>
    </>
  )

  // ── 2 · Cuántas ──
  if (paso === 2) return marco(
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ ...card, flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>{prod.nombre}</div>
        <div style={{ color: C.dim, fontSize: 13.5, marginTop: 6, lineHeight: 1.7 }}>
          {prod.unidad}<br />
          {prod.gramos ? `Objetivo ${mil(prod.gramos)} g, banda ±${prod.banda} g` : 'Sin peso objetivo cargado'}<br />
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
              : `${lbs(g)} lb · ${bien ? 'dentro de banda' : 'fuera de banda, se imprime igual'}`}
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
          <button onClick={() => setPaso(2)} style={{ ...btn('#1c1c20'), color: C.dim, fontSize: 13, padding: 10, marginTop: 8 }}>
            Cancelar
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
                  {mil(u.g)} g · {lbs(u.g)} lb
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
  const suma = hechas.reduce((a, u) => a + u.g, 0)
  const malas = hechas.filter(u => !u.ok)
  return marco(
    <>
      <div style={{ ...card, background: '#0b2417', borderColor: C.ok, color: '#86efac' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>Lote {lote} terminado</div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          {total} unidades de {prod.nombre} · {mil(suma)} g · {lbs(suma)} lb<br />
          {total} etiquetas impresas{malas.length ? <> · <b style={{ color: '#fca5a5' }}>{malas.length} fuera de banda</b></> : null}
        </div>
      </div>
      <div style={{ ...card, marginTop: 12, color: C.dim, fontSize: 13.5, lineHeight: 1.6 }}>
        <b style={{ color: C.warn }}>Esta es la prueba de los aparatos:</b> nada de esto quedó guardado
        ni entró al inventario. Cuando confirmemos que la báscula y la impresora
        conviven bien, la estación empieza a crear el lote en el sistema y a dar
        de alta las unidades en el kardex.
      </div>
      <button onClick={reiniciar} style={{ ...btn(C.ok), marginTop: 12 }}>Pesar otro producto</button>
    </>
  )
}
