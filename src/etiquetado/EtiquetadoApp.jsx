/* ═══════════════════════════════════════════════════════════════════════
   Estación de pesaje y etiquetado · Casa Matriz
   freakie-dogs-caja.vercel.app/etiquetado.html

   Elegís el producto, decís cuántas unidades, y por cada una: se pone en la
   báscula, el peso se estabiliza solo y un toque la registra e imprime su
   etiqueta con lote, peso, vencimiento y un QR a su ficha.

   02-oct-2026 — CONECTADA AL ERP (docs/PLAN-ESTACION-ETIQUETADO-ERP.md):
   · La tanda es una produccion_diaria 'abierta' con lote del servidor.
   · Cada bolsa es una fila en produccion_unidades (peso real, quién, QR).
   · Al Terminar, el servidor descuenta insumos por receta (materias primas
     en proporción al PESO real, empaques por UNIDADES) y da de alta las
     bolsas en el kardex, todo en una transacción.
   · Si falla la impresión la unidad QUEDA registrada (la bolsa física ya
     existe): se bloquea el avance hasta reimprimir o anularla.
   · Todo lo que escribe lleva un client_key: reintentar nunca duplica.
   · "Modo prueba": pesa e imprime sin tocar el inventario (lote PRB-…).

   Aparatos: báscula Rhino BAR-6X (mismo cable y parser del porcionador) e
   impresora Zebra ZD421 por ZPL sobre WebUSB. La cinta trae 2 etiquetas por
   fila, así que se imprime de a pares (ver zebraZpl.js).
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../supabase'
import { useBalanza } from '../porcionador/useBalanza'
import { ImpresoraZebra, hayWebUsb } from './zebraUsb'
import { armarZplFila, zplPruebaFila, DPI_OPCIONES } from './zebraZpl'

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
const btnSec = { ...btn('#1c1c20'), color: C.txt, fontSize: 14, padding: 11 }
const chip = (on, color) => ({
  borderRadius: 20, padding: '5px 11px', fontSize: 12, fontWeight: 700,
  background: on ? (color || '#0b3b2e') : '#1c1c20', color: on ? '#6ee7b7' : C.dim,
  border: `1px solid ${on ? '#166534' : C.line}`,
})

const lbs = (g) => (g / 453.59237).toFixed(2)
const mil = (g) => Math.round(g || 0).toLocaleString('en-US')
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16) }))
const msgDe = (e) => e?.message || e?.error_description || (typeof e === 'string' ? e : 'Error')

const CLAVE_DPI = 'etiquetado_dpi'

/* Lo que pide armarZplFila por celda, armado desde la etiqueta congelada que
   devolvió el servidor al registrar la unidad. Sin "/total": si la tanda se
   pasa del plan, "11 de 10" mentiría. */
const celdaDe = (etq) => ({
  producto: etq.producto, lote: etq.lote, indice: etq.numero, total: null,
  gramos: etq.gramos != null ? mil(etq.gramos) : '—',
  libras: etq.libras != null ? Number(etq.libras).toFixed(2) : '—',
  vence: etq.vence_txt, qr: etq.qr,
})

export default function EtiquetadoApp({ quien, dispositivo }) {
  const [productos, setProductos] = useState(null)
  const [tanda, setTanda] = useState(null)         // payload _produccion_tanda_json
  const [cierre, setCierre] = useState(null)       // resultado de produccion_tanda_cerrar
  const [retomable, setRetomable] = useState(null) // tanda abierta encontrada al cargar
  const [prod, setProd] = useState(null)
  const [cuenta, setCuenta] = useState('')
  const [esPrueba, setEsPrueba] = useState(false)
  // La primera unidad del par ya está REGISTRADA en la base; espera su pareja
  // para salir impresas juntas (la cinta trae 2 etiquetas por fila).
  const [pendiente, setPendiente] = useState(null)
  const [sinImprimir, setSinImprimir] = useState([]) // unidades registradas cuya impresión falló
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [ajustando, setAjustando] = useState(false)
  const [anulando, setAnulando] = useState(null)   // unidad a anular (pide motivo)
  const [motivo, setMotivo] = useState('')

  const [dpi, setDpi] = useState(() => Number(localStorage.getItem(CLAVE_DPI)) || 203)
  useEffect(() => { try { localStorage.setItem(CLAVE_DPI, String(dpi)) } catch { /* da igual */ } }, [dpi])

  const bal = useBalanza()
  const zebra = useRef(null)
  const [impresoraOk, setImpresoraOk] = useState(false)
  if (!zebra.current) zebra.current = new ImpresoraZebra()

  const aviso = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? '' : m)), 2600) }, [])

  // ── Carga inicial: productos, impresora ya autorizada, tanda abierta de esta tablet ──
  useEffect(() => {
    let vivo = true
    db.from('v_produccion_estacion_productos').select('*').then(({ data, error: e }) => {
      if (!vivo) return
      if (e) setErr('No se pudo cargar la lista de productos: ' + e.message)
      setProductos(data || [])
    })
    zebra.current.reconectar().then(ok => { if (vivo) setImpresoraOk(!!ok) }).catch(() => {})
    db.rpc('produccion_tanda_abierta', { p_dispositivo: dispositivo }).then(({ data }) => {
      if (vivo && data && data.produccion_id) setRetomable(data)
    })
    return () => { vivo = false }
  }, [dispositivo])

  async function conectarImpresora() {
    setErr('')
    try { await zebra.current.conectar(); setImpresoraOk(true); aviso('Impresora conectada') }
    catch (e) { setErr(msgDe(e) || 'No se pudo conectar la impresora') }
  }
  async function imprimirPrueba() {
    setErr('')
    try { await zebra.current.enviar(zplPruebaFila(dpi)); aviso('Fila de prueba enviada (2 etiquetas)') }
    catch (e) { setErr(msgDe(e) || 'No se pudo imprimir') }
  }

  const unidadesActivas = (t) => (t?.unidades || []).filter(u => u.estado === 'activa')
  const dentro = (g) => !tanda?.peso_nominal_g || tanda?.banda_g == null || Math.abs(g - tanda.peso_nominal_g) <= tanda.banda_g

  // ── Abrir tanda ──
  async function empezar() {
    const n = Number(cuenta)
    if (!(n > 0) || !prod) return
    setErr(''); setOcupado(true)
    try {
      const { data, error: e } = await db.rpc('produccion_tanda_abrir', {
        p_producto_id: prod.producto_id, p_cantidad_planificada: n, p_responsable_id: quien.id,
        p_client_key: uuid(), p_dispositivo: dispositivo, p_bascula_codigo: 'BAS-002',
        p_es_prueba: esPrueba, p_orden_id: null, p_usuario_nombre: quien.nombre,
      })
      if (e) throw e
      setTanda(data); setPendiente(null); setSinImprimir([]); setCierre(null)
    } catch (e) { setErr(msgDe(e)) }
    setOcupado(false)
  }

  function retomar() {
    const t = retomable
    setRetomable(null)
    setTanda(t); setCierre(null)
    // Lo que quedó sin imprimir en la sesión anterior sigue sin imprimir.
    const sin = unidadesActivas(t).filter(u => !u.impresa)
    setSinImprimir(sin)
    setPendiente(null)
    if (sin.length) setErr(`Hay ${sin.length} unidad(es) registradas sin etiqueta. Reimprimilas o anulalas antes de seguir.`)
  }

  async function anularTandaAbierta(t, porque) {
    setErr(''); setOcupado(true)
    try {
      const { error: e } = await db.rpc('produccion_tanda_anular', { p_produccion_id: t.produccion_id, p_motivo: porque, p_usuario_id: quien.id })
      if (e) throw e
      aviso(`Tanda ${t.lote} anulada`)
      setRetomable(null); setTanda(null); setPendiente(null); setSinImprimir([]); setCierre(null)
    } catch (e) { setErr(msgDe(e)) }
    setOcupado(false)
  }

  // ── Imprimir una fila (dos celdas) y marcar impresas. Si falla, las
  //    unidades quedan en `sinImprimir`: ya existen, no se borran. ──
  async function imprimirFila(izq, der) {
    try {
      await zebra.current.enviar(armarZplFila(celdaDe(izq.etiqueta), celdaDe(der.etiqueta), { dpi }))
    } catch (e) {
      const nuevas = izq.unidad_id === der.unidad_id ? [izq] : [izq, der]
      setSinImprimir(s => [...s, ...nuevas.filter(u => !s.some(x => x.unidad_id === u.unidad_id))])
      setErr((msgDe(e) || 'No se pudo imprimir') + ' · La unidad quedó registrada SIN etiqueta: reimprimila o anulala.')
      return false
    }
    const ids = izq.unidad_id === der.unidad_id ? [izq.unidad_id] : [izq.unidad_id, der.unidad_id]
    await Promise.all(ids.map(id => db.rpc('produccion_unidad_impresa', { p_unidad_id: id, p_ok: true })))
    setSinImprimir(s => s.filter(u => !ids.includes(u.unidad_id)))
    setTanda(t => t && { ...t, unidades: t.unidades.map(u => ids.includes(u.unidad_id) ? { ...u, impresa: true, impresiones: (u.impresiones || 0) + 1 } : u) })
    return true
  }

  // ── Pesar: registra en el servidor y, con pareja, imprime ──
  async function pesarEImprimir() {
    if (!bal.estable || ocupado || !tanda) return
    if (sinImprimir.length) { setErr('Primero resolvé las unidades sin etiqueta (reimprimir o anular).'); return }
    setErr(''); setOcupado(true)
    const g = bal.gramos
    let u
    try {
      const { data, error: e } = await db.rpc('produccion_unidad_registrar', {
        p_produccion_id: tanda.produccion_id, p_gramos: tanda.requiere_peso ? g : null,
        p_client_key: uuid(), p_pesado_por_id: quien.id, p_pesado_por: quien.nombre, p_bascula_codigo: 'BAS-002',
      })
      if (e) throw e
      u = { unidad_id: data.unidad_id, numero: data.numero, gramos: g, fuera_banda: data.fuera_banda,
            vence: data.vence, impresa: false, impresiones: 0, estado: 'activa', etiqueta: data.etiqueta,
            pesado_por: quien.nombre, codigo_corto: data.codigo_corto }
    } catch (e) { setErr(msgDe(e)); setOcupado(false); return }
    setTanda(t => ({ ...t, unidades: [...(t.unidades || []), u] }))

    const activas = unidadesActivas(tanda).length + 1
    const plan = Number(tanda.cantidad_planificada) || 0
    const ultimaSuelta = !pendiente && activas >= plan && plan % 2 === 1 && activas === plan

    if (!pendiente && !ultimaSuelta) {
      setPendiente(u); setOcupado(false)
      aviso(`Unidad ${u.numero} registrada · pesá la siguiente para imprimir las dos juntas`)
      return
    }
    const izq = pendiente || u
    const ok = await imprimirFila(izq, u)
    setPendiente(null); setOcupado(false)
    if (ok) aviso(izq.unidad_id !== u.unidad_id
      ? `Unidades ${izq.numero} y ${u.numero} impresas · quitalas de la báscula`
      : `Unidad ${u.numero} impresa · quitá la unidad de la báscula`)
  }

  async function reimprimir(u) {
    setErr(''); setOcupado(true)
    const ok = await imprimirFila(u, u)
    setOcupado(false)
    if (ok) aviso(`Reimpresa la unidad ${u.numero}`)
  }

  // Imprime la pendiente sola (duplicada) cuando no va a haber pareja.
  async function imprimirPendiente() {
    if (!pendiente) return
    setOcupado(true)
    const ok = await imprimirFila(pendiente, pendiente)
    if (ok) { aviso(`Unidad ${pendiente.numero} impresa`); setPendiente(null) }
    setOcupado(false)
  }

  async function anularUnidad() {
    const u = anulando
    if (!u || motivo.trim().length < 5) return
    setErr(''); setOcupado(true)
    try {
      const { error: e } = await db.rpc('produccion_unidad_anular', { p_unidad_id: u.unidad_id, p_motivo: motivo.trim(), p_usuario_id: quien.id, p_tipo: 'merma' })
      if (e) throw e
      setTanda(t => t && { ...t, unidades: t.unidades.map(x => x.unidad_id === u.unidad_id ? { ...x, estado: 'anulada' } : x) })
      setSinImprimir(s => s.filter(x => x.unidad_id !== u.unidad_id))
      if (pendiente?.unidad_id === u.unidad_id) setPendiente(null)
      aviso(`Unidad ${u.numero} anulada`)
      setAnulando(null); setMotivo('')
    } catch (e) { setErr(msgDe(e)) }
    setOcupado(false)
  }

  // ── Terminar: el servidor descuenta insumos y da de alta ──
  async function terminar() {
    if (!tanda) return
    if (sinImprimir.length) { setErr('Hay unidades sin etiqueta: reimprimilas o anulalas antes de terminar.'); return }
    if (pendiente) {
      // Quedó una sin pareja: se imprime duplicada antes de cerrar.
      const ok = await imprimirFila(pendiente, pendiente)
      if (!ok) return
      setPendiente(null)
    }
    setErr(''); setOcupado(true)
    try {
      const { data, error: e } = await db.rpc('produccion_tanda_cerrar', { p_produccion_id: tanda.produccion_id, p_usuario_id: quien.id, p_peso_insumo_g: null, p_auto: false })
      if (e) throw e
      setCierre(data); setTanda(data)
    } catch (e) { setErr(msgDe(e)) }
    setOcupado(false)
  }

  function reiniciar() {
    setTanda(null); setCierre(null); setProd(null); setCuenta(''); setPendiente(null); setSinImprimir([]); setErr('')
  }

  // ── Barra de aparatos, siempre visible ──
  const barra = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Pesaje y etiquetado {tanda?.es_prueba && <span style={{ ...chip(true, '#3a2a06'), color: '#fcd34d', borderColor: '#78350f', marginLeft: 6 }}>PRUEBA</span>}</div>
        <div style={{ color: C.dim, fontSize: 12.5 }}>Casa Matriz{tanda ? ` · lote ${tanda.lote}` : ''} · {quien.nombre}</div>
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
        <button onClick={imprimirPrueba} style={{ ...btnSec, marginTop: 8 }}>Imprimir etiqueta de prueba</button>
      )}
      <div style={{ color: C.dim, fontSize: 11.5, marginTop: 10 }}>Tablet: {dispositivo}</div>
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

  // ── Modal: anular unidad (pide motivo) ──
  const modalAnular = anulando && (
    <div style={{ position: 'fixed', inset: 0, background: '#000a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 10 }}>
      <div style={{ ...card, width: 'min(420px, 100%)', borderColor: C.bad }}>
        <b style={{ fontSize: 16 }}>Anular la unidad {anulando.numero}</b>
        <div style={{ color: C.dim, fontSize: 13, margin: '6px 0 10px', lineHeight: 1.5 }}>
          Decí por qué (se rompió la bolsa, se pesó dos veces, no salió la etiqueta y se tiró…).
          {cierre && ' La tanda ya cerró: la bolsa sale del inventario como merma.'}
        </div>
        <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (mínimo 5 letras)" autoFocus
          style={{ width: '100%', boxSizing: 'border-box', background: '#0a0a0b', border: `1px solid ${C.line}`, color: C.txt, borderRadius: 10, padding: '12px 14px', fontSize: 16, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => { setAnulando(null); setMotivo('') }} style={{ ...btnSec }}>Volver</button>
          <button onClick={anularUnidad} disabled={motivo.trim().length < 5 || ocupado} style={{ ...btn(C.bad, motivo.trim().length < 5 || ocupado), color: '#fff' }}>Anular</button>
        </div>
      </div>
    </div>
  )

  // ── 0 · Tanda abierta de antes: retomar o anular ──
  if (retomable && !tanda) return marco(
    <div style={{ ...card, borderColor: C.warn }}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>Quedó una tanda abierta en esta tablet</div>
      <div style={{ color: C.dim, fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
        {retomable.nombre_etiqueta || retomable.producto} · lote <b style={{ color: C.txt }}>{retomable.lote}</b> ·{' '}
        {unidadesActivas(retomable).length} de {retomable.cantidad_planificada} unidades pesadas
        {retomable.es_prueba ? ' · modo prueba' : ''}
      </div>
      <button onClick={retomar} style={{ ...btn(C.ok), marginTop: 14 }}>Seguir con esa tanda</button>
      <button onClick={() => anularTandaAbierta(retomable, 'Abandonada: el operario abrió otra tanda')} disabled={ocupado}
        style={{ ...btnSec, color: C.dim, marginTop: 8 }}>Anularla y empezar de cero</button>
    </div>
  )

  // ── 1 · Qué se va a pesar ──
  if (!tanda) {
    if (!prod) return marco(
      <>
        <div style={{ color: C.dim, fontSize: 14, marginBottom: 11 }}>¿Qué vas a pesar?</div>
        {productos === null && <div style={{ color: C.dim }}>Cargando productos…</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 9 }}>
          {(productos || []).map(p => (
            <button key={p.producto_id} onClick={() => { setProd(p); setCuenta(''); setErr('') }}
              style={{ ...card, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: C.txt, opacity: p.receta_activa ? 1 : .5 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{p.nombre_etiqueta}</div>
              <div style={{ color: C.dim, fontSize: 12.5, marginTop: 3 }}>
                {p.unidad} · {!p.requiere_peso ? 'no se pesa' : p.peso_nominal_g ? `${mil(p.peso_nominal_g)} g ±${p.banda_g ?? 0}` : 'sin peso nominal · solo modo prueba'}
              </div>
            </button>
          ))}
        </div>
      </>
    )

    // ── 2 · Cuántas ──
    const sinNominal = prod.requiere_peso && !prod.peso_nominal_g
    const puede = Number(cuenta) > 0 && (!sinNominal || esPrueba)
    return marco(
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{prod.nombre_etiqueta}</div>
          <div style={{ color: C.dim, fontSize: 13.5, marginTop: 6, lineHeight: 1.7 }}>
            Receta: {prod.receta} · rinde {prod.rendimiento} {prod.unidad_rendimiento}/tanda<br />
            {!prod.requiere_peso ? 'No se pesa, solo se cuenta' : prod.peso_nominal_g ? `Objetivo ${mil(prod.peso_nominal_g)} g, banda ±${prod.banda_g ?? 0} g` : 'Sin peso nominal cargado'}<br />
            Vence a los {prod.vida_util_dias} días {prod.vida_util_estado === 'provisional' && <span style={{ color: C.warn }}>(provisional)</span>}<br />
            {prod.conservacion}
          </div>
          <div style={{ background: '#12233a', border: `1px solid ${C.acc}`, borderRadius: 12,
                        padding: 14, textAlign: 'center', marginTop: 14 }}>
            <div style={{ color: '#93c5fd', fontSize: 11.5, letterSpacing: .5 }}>¿CUÁNTAS UNIDADES?</div>
            <div style={{ fontSize: 44, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{cuenta || '—'}</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer', fontSize: 14 }}>
            <input type="checkbox" checked={esPrueba} onChange={e => setEsPrueba(e.target.checked)} style={{ width: 20, height: 20 }} />
            <span>Modo prueba <span style={{ color: C.dim }}>— pesa e imprime sin tocar el inventario</span></span>
          </label>
          {sinNominal && !esPrueba && (
            <div style={{ color: C.warn, fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
              Este producto no tiene peso nominal cargado. Pesá una tanda completa en modo prueba y cargalo en Producción → Etiquetado.
            </div>
          )}
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
          <button onClick={empezar} disabled={!puede || ocupado} style={{ ...btn(C.ok, !puede || ocupado), marginTop: 10 }}>
            {ocupado ? 'Abriendo tanda…' : 'Empezar a pesar'}
          </button>
          <button onClick={() => setProd(null)} style={{ ...btnSec, marginTop: 8 }}>Elegir otro producto</button>
        </div>
      </div>
    )
  }

  // ── 4 · Resumen del cierre ──
  if (cierre) {
    const activas = unidadesActivas(cierre)
    const malas = activas.filter(u => u.fuera_banda)
    const falt = cierre.faltantes || []
    return marco(
      <>
        {modalAnular}
        <div style={{ ...card, background: '#0b2417', borderColor: C.ok, color: '#86efac' }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>Lote {cierre.lote} terminado{cierre.es_prueba ? ' (prueba)' : ''}</div>
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            {activas.length} unidades de {cierre.nombre_etiqueta || cierre.producto}
            {cierre.peso_total_g ? <> · {mil(cierre.peso_total_g)} g · {lbs(cierre.peso_total_g)} lb</> : null}
            {malas.length ? <> · <b style={{ color: '#fca5a5' }}>{malas.length} fuera de banda</b></> : null}
            {!cierre.es_prueba && cierre.costo_total != null ? <> · costo ${Number(cierre.costo_total).toFixed(2)}</> : null}
          </div>
        </div>

        {cierre.es_prueba ? (
          <div style={{ ...card, marginTop: 12, color: C.dim, fontSize: 13.5, lineHeight: 1.6 }}>
            <b style={{ color: C.warn }}>Tanda de prueba:</b> nada entró ni salió del inventario. El peso total sirve para cargar el peso nominal del producto.
          </div>
        ) : (
          <div style={{ ...card, marginTop: 12 }}>
            <b style={{ fontSize: 14 }}>Lo que se descontó del inventario</b>
            <div style={{ marginTop: 8 }}>
              {(cierre.consumos || []).map(c => (
                <div key={c.producto_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.line}`, fontSize: 13.5 }}>
                  <span style={{ color: C.txt }}>{c.nombre} {c.es_empaque && <span style={{ color: C.dim }}>(empaque)</span>}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', color: C.dim }}>{Number(c.cantidad).toLocaleString('en-US', { maximumFractionDigits: 4 })} {c.unidad}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', fontSize: 14, fontWeight: 700 }}>
                <span>Entraron al inventario</span>
                <span style={{ color: C.ok }}>+{activas.length} {cierre.unidad}</span>
              </div>
            </div>
            {falt.length > 0 && (
              <div style={{ background: '#3a1212', border: `1px solid ${C.bad}`, color: '#fecaca', borderRadius: 10, padding: 12, marginTop: 10, fontSize: 13.5, lineHeight: 1.6 }}>
                <b>Avisá a almacén:</b> se descontó pero el sistema no tenía stock de{' '}
                {falt.map(f => `${f.nombre} (quedó en ${Number(f.stock_posterior).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${f.unidad})`).join(', ')}.
              </div>
            )}
            {(cierre.avisos || []).map((a, i) => (
              <div key={i} style={{ color: C.warn, fontSize: 13, marginTop: 8 }}>{a}</div>
            ))}
          </div>
        )}

        <div style={{ ...card, marginTop: 12 }}>
          <b style={{ fontSize: 14 }}>Unidades</b>
          <div style={{ marginTop: 8 }}>
            {[...(cierre.unidades || [])].reverse().map(u => (
              <div key={u.unidad_id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0', borderBottom: `1px solid ${C.line}`, fontSize: 14, opacity: u.estado === 'anulada' ? .45 : 1 }}>
                <span style={{ color: C.dim, width: 26 }}>#{u.numero}</span>
                <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', color: u.fuera_banda ? '#fca5a5' : C.txt, textDecoration: u.estado === 'anulada' ? 'line-through' : 'none' }}>
                  {u.gramos != null ? `${mil(u.gramos)} g · ${lbs(u.gramos)} lb` : 'sin peso'}
                </span>
                {u.estado === 'activa' && <>
                  <button onClick={() => reimprimir(u)} disabled={ocupado || !impresoraOk} style={{ background: 'none', border: `1px solid ${C.line}`, color: C.dim, borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↻</button>
                  <button onClick={() => { setAnulando(u); setMotivo('') }} disabled={ocupado} style={{ background: 'none', border: `1px solid ${C.line}`, color: '#fca5a5', borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                </>}
              </div>
            ))}
          </div>
        </div>
        <button onClick={reiniciar} style={{ ...btn(C.ok), marginTop: 12 }}>Pesar otro producto</button>
      </>
    )
  }

  // ── 3 · Pesar e imprimir ──
  const g = bal.gramos
  const bien = dentro(g)
  const activas = unidadesActivas(tanda)
  const plan = Number(tanda.cantidad_planificada) || 0
  const listo = (!tanda.requiere_peso || (bal.estado === 'conectada' && bal.estable && g > 0)) && !ocupado && impresoraOk && sinImprimir.length === 0
  const llegamos = activas.length >= plan
  return marco(
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {modalAnular}
      <div style={{ ...card, flex: 1, minWidth: 260 }}>
        <div style={{ display: 'flex', gap: 3, marginBottom: 11 }}>
          {Array.from({ length: Math.max(plan, activas.length) }).map((_, i) => (
            <span key={i} style={{
              flex: 1, height: 6, borderRadius: 3,
              background: activas[i] ? (activas[i].fuera_banda ? C.bad : C.ok) : (i === activas.length ? C.acc : C.line),
            }} />
          ))}
        </div>
        <div style={{ color: C.dim, fontSize: 13, textAlign: 'center' }}>
          {tanda.nombre_etiqueta} · unidad <b style={{ color: C.txt }}>{activas.length + 1}{plan ? ` de ${plan}` : ''}</b>
          {llegamos && <span style={{ color: C.warn }}> · ya están las {plan} planeadas</span>}
        </div>
        {!!pendiente && (
          <div style={{ textAlign: 'center', fontSize: 12.5, color: C.acc, marginTop: 4 }}>
            Unidad {pendiente.numero} registrada y en espera · imprime junto con la siguiente
          </div>
        )}
        {tanda.requiere_peso ? (
          <>
            <div style={{
              fontSize: 62, fontWeight: 800, textAlign: 'center', letterSpacing: -2,
              fontFamily: 'ui-monospace, Menlo, monospace', padding: '12px 0 4px',
              color: !(bal.estado === 'conectada' && bal.estable && g > 0) ? C.dim : bien ? C.ok : C.bad,
            }}>
              {mil(g)}<span style={{ fontSize: 22, color: C.dim, marginLeft: 6 }}>g</span>
            </div>
            <div style={{ textAlign: 'center', fontSize: 14, color: C.dim, marginBottom: 12 }}>
              {bal.estado !== 'conectada' ? 'conectá la báscula arriba'
                : !bal.estable ? 'estabilizando…'
                : `${lbs(g)} lb · ${bien ? 'dentro de banda' : 'fuera de banda, se registra igual'}`}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 15, color: C.dim, padding: '18px 0 12px' }}>Este producto no se pesa: cada toque registra una unidad.</div>
        )}
        <button onClick={pesarEImprimir} disabled={!listo} style={btn(bien ? C.ok : C.warn, !listo)}>
          {ocupado ? 'Registrando…'
            : !impresoraOk ? 'Conectá la impresora arriba'
            : sinImprimir.length ? 'Resolvé las unidades sin etiqueta'
            : pendiente ? (tanda.requiere_peso ? 'Pesar la pareja e imprimir las 2' : 'Registrar la pareja e imprimir las 2')
            : (tanda.requiere_peso ? 'Pesar e imprimir' : 'Registrar e imprimir')}
        </button>
        {!!pendiente && (
          <button onClick={imprimirPendiente} disabled={ocupado} style={{ ...btnSec, marginTop: 8 }}>
            Imprimir la {pendiente.numero} sola (sin pareja)
          </button>
        )}
        <button onClick={terminar} disabled={ocupado || activas.length === 0}
          style={{ ...btn(llegamos ? C.ok : '#1c1c20', ocupado || activas.length === 0), color: llegamos ? '#06180c' : C.txt, marginTop: 8 }}>
          {tanda.es_prueba ? 'Terminar la prueba' : `Terminar tanda y descontar insumos (${activas.length} unid.)`}
        </button>
        <button onClick={() => anularTandaAbierta(tanda, 'Cancelada por el operario desde la estación')} disabled={ocupado}
          style={{ ...btnSec, color: C.dim, fontSize: 13, padding: 10, marginTop: 8 }}>
          Cancelar la tanda{activas.length ? ` (anula las ${activas.length} unidades)` : ''}
        </button>
      </div>

      <div style={{ ...card, flex: 1, minWidth: 240 }}>
        <b style={{ fontSize: 14 }}>Registradas ({activas.length}{plan ? ` de ${plan}` : ''})</b>
        {sinImprimir.length > 0 && (
          <div style={{ background: '#3a1212', border: `1px solid ${C.bad}`, color: '#fecaca', borderRadius: 10, padding: 10, marginTop: 8, fontSize: 13 }}>
            {sinImprimir.length} unidad(es) sin etiqueta. Reimprimí (↻) o anulá (✕) cada una.
          </div>
        )}
        {activas.length === 0 && (
          <div style={{ color: C.dim, fontSize: 13.5, marginTop: 10, lineHeight: 1.55 }}>
            Todavía ninguna. La etiqueta sale sola al tocar el botón: no hay diálogo de impresión.
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          {[...(tanda.unidades || [])].reverse().map(u => {
            const falta = sinImprimir.some(x => x.unidad_id === u.unidad_id)
            return (
              <div key={u.unidad_id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0',
                                             borderBottom: `1px solid ${C.line}`, fontSize: 14, opacity: u.estado === 'anulada' ? .45 : 1,
                                             background: falta ? '#3a121233' : 'transparent' }}>
                <span style={{ color: C.dim, width: 26 }}>#{u.numero}</span>
                <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', color: u.fuera_banda ? '#fca5a5' : C.txt, textDecoration: u.estado === 'anulada' ? 'line-through' : 'none' }}>
                  {u.gramos != null ? `${mil(u.gramos)} g · ${lbs(u.gramos)} lb` : 'sin peso'}
                  {falta && <span style={{ color: '#fca5a5', fontSize: 12 }}> · sin etiqueta</span>}
                  {pendiente?.unidad_id === u.unidad_id && <span style={{ color: C.acc, fontSize: 12 }}> · en espera</span>}
                </span>
                <span style={{ color: C.dim, fontSize: 12.5 }}>{u.etiqueta?.hora}</span>
                {u.estado === 'activa' && <>
                  <button onClick={() => reimprimir(u)} disabled={ocupado || !impresoraOk}
                    style={{ background: 'none', border: `1px solid ${C.line}`, color: C.dim, borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↻</button>
                  <button onClick={() => { setAnulando(u); setMotivo('') }} disabled={ocupado}
                    style={{ background: 'none', border: `1px solid ${C.line}`, color: '#fca5a5', borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                </>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
