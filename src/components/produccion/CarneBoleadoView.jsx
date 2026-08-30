/* ═══════════════════════════════════════════════════════════════════════
   Proceso de mezclado y boleado de carne — tablet de Casa Matriz

   Ciclo: sacar 100 lb -> mezclar 10 min -> guardar 67 lb -> bolear 33 lb
   en 15 min -> la bandeja se va directo al freezer.

   ── Que se mide y por que ──
   Durante el MEZCLADO no hay sonda: la carne se manipula y se sazona a mano,
   y la sonda estorba o se dana. Solo corre el cronometro.

   Durante el BOLEADO la sonda va en una "bolita testigo" armada junto con la
   primera bolita real, que se descarta al final. Es el peor caso: ya recibio
   calor de las manos y es la que mas tiempo pasa en la bandeja. Medir la masa
   de 33 lb no sirve — se calienta mucho mas despacio y daria un numero
   tranquilizador y falso.

   SESGO CONOCIDO: la testigo (~250 g) se calienta mas lento que una bolita
   real (~68 g), asi que SUBESTIMA. Se corrige midiendo unas pocas bolitas
   reales con termometro de puncion y guardando la diferencia como offset.

   FASE 1 (sep-2026): NO alerta por temperatura, solo registra. Primero hay
   que medir cuanto se sale del rango en la practica; con esos datos se
   decide el limite real en vez de imponer uno a ciegas.

   ── Sobre la sonda ──
   La CQ60 no se empareja ni se conecta: transmite en el anuncio BLE, en los
   datos de fabricante 0x05CD (1485). El paquete tipo 0x01 trae seis uint16
   little-endian que son temperaturas x10 (zonas del vastago, punta y
   ambiente).

   No se asume que orden tienen. Se toma el MAS FRIO como carne y el MAS
   CALIENTE como ambiente: la carne va bajo 10 grados y el cuarto sobre 20,
   asi que la separacion es obvia y el decodificado no depende de adivinar
   posiciones de bytes.

   Requiere en Chrome Android: chrome://flags -> "Experimental Web Platform
   features" -> Enabled. Sin eso el navegador no permite escanear anuncios.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react'
import { db } from '../../supabase'

const MANUFACTURER_ID = 1485          // 0x05CD
const MIN_MEZCLADO = 10 * 60
const MIN_BOLEADO  = 15 * 60
const LIBRAS_LOTE = 100
const LIBRAS_BOLEAR = 33
const BOLITA_TESTIGO_G = 250   // ~4 bolitas reales: lo minimo para cubrir la punta
const GUARDA_CADA_MS = 5000           // no hace falta una fila por segundo

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', warn: '#fbbf24', bad: '#ef4444', acc: '#60a5fa',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 14 }
const btn = (color, off) => ({
  background: off ? '#3a3a3e' : color, color: '#fff', border: 'none', borderRadius: 11,
  padding: '17px 26px', fontSize: 19, fontWeight: 700, cursor: off ? 'not-allowed' : 'pointer',
  opacity: off ? 0.55 : 1, width: '100%',
})
const mmss = (s) => {
  const v = Math.max(0, Math.round(s))
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}

/* Decodifica el paquete 0x01. Devuelve null si no es ese tipo. */
export function decodificarCQ60(dataView) {
  if (!dataView || dataView.byteLength < 8) return null
  const b = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)
  if (b[0] !== 0x01) return null        // 0x00 = nombre, 0x03 = MAC, 0x01 = temperaturas
  const vals = []
  // Saltea tipo(1) + flag(1) + bateria(1) + temp entera(1) = 4 bytes de cabecera.
  for (let i = 4; i + 1 < b.length - 2; i += 2) {
    const v = b[i] | (b[i + 1] << 8)
    if (v > 0 && v < 4000) vals.push(v / 10)   // descarta relleno y sentinelas
  }
  if (vals.length < 2) return null
  return {
    bateria: b[2],
    todas: vals,
    carne:    Math.min(...vals),
    ambiente: Math.max(...vals),
    hex: Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(' '),
  }
}

export default function CarneBoleadoView({ user }) {
  const [soportado, setSop] = useState(true)
  const [escaneando, setEsc] = useState(false)
  const [lectura, setLec]    = useState(null)
  const [ultimaAt, setUlt]   = useState(null)
  const [tanda, setTanda]    = useState(null)
  const [seg, setSeg]        = useState(0)
  const [error, setError]    = useState('')
  const [diag, setDiag]      = useState(false)
  const [guardadas, setGuard] = useState(0)

  const scanRef = useRef(null)
  const ultimoGuardado = useRef(0)
  const tandaRef = useRef(null)
  const lecturaRef = useRef(null)

  useEffect(() => { tandaRef.current = tanda }, [tanda])
  useEffect(() => { lecturaRef.current = lectura }, [lectura])

  useEffect(() => {
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) setSop(false)
  }, [])

  // Cronometro
  useEffect(() => {
    if (!tanda || tanda.estado === 'terminada') return
    const base = tanda.estado === 'mezclando' ? tanda.mezclado_inicio : tanda.boleado_inicio
    if (!base) return
    const tick = () => setSeg(Math.floor((Date.now() - new Date(base).getTime()) / 1000))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [tanda?.estado, tanda?.mezclado_inicio, tanda?.boleado_inicio])

  async function conectarSonda() {
    setError('')
    try {
      const scan = await navigator.bluetooth.requestLEScan({
        filters: [{ manufacturerData: [{ companyIdentifier: MANUFACTURER_ID }] }],
        keepRepeatedDevices: true,
      })
      scanRef.current = scan
      setEsc(true)
      navigator.bluetooth.addEventListener('advertisementreceived', onAnuncio)
    } catch (e) {
      setError(
        /not supported|undefined/i.test(String(e))
          ? 'Esta tablet no permite leer Bluetooth desde el navegador. Activá chrome://flags → Experimental Web Platform features.'
          : `No se pudo iniciar el escaneo: ${e.message}`
      )
    }
  }

  function onAnuncio(ev) {
    const dv = ev.manufacturerData?.get(MANUFACTURER_ID)
    if (!dv) return
    const d = decodificarCQ60(dv)
    if (!d) return
    d.mac = ev.device?.id || null
    setLec(d)
    setUlt(Date.now())
    guardarSiToca(d)
  }

  async function guardarSiToca(d) {
    const t = tandaRef.current
    if (!t || t.estado === 'terminada') return
    if (Date.now() - ultimoGuardado.current < GUARDA_CADA_MS) return
    ultimoGuardado.current = Date.now()
    try {
      await db.from('carne_temp_lecturas').insert({
        tanda_id: t.id,
        fase: t.estado === 'mezclando' ? 'mezclado' : 'boleado',
        temp_carne: d.carne, temp_ambiente: d.ambiente,
        todas: d.todas, raw_hex: d.hex,
      })
      setGuard(n => n + 1)
    } catch { /* una lectura perdida no detiene el proceso */ }
  }

  async function iniciarTanda() {
    setError('')
    try {
      const { data, error } = await db.from('carne_tandas').insert({
        operario: user?.nombre || null,
        operario_id: user?.id || null,
        libras_lote: LIBRAS_LOTE, libras_bolear: LIBRAS_BOLEAR,
        bolita_testigo_g: BOLITA_TESTIGO_G,
        mezclado_inicio: new Date().toISOString(),
        sonda_mac: lectura?.mac || null,
        estado: 'mezclando',
      }).select().single()
      if (error) throw error
      setTanda(data); setGuard(0)
    } catch (e) { setError(e.message || 'No se pudo iniciar') }
  }

  async function pasarABoleado() {
    try {
      const { data, error } = await db.from('carne_tandas').update({
        mezclado_fin: new Date().toISOString(),
        boleado_inicio: new Date().toISOString(),
        estado: 'boleando',
      }).eq('id', tanda.id).select().single()
      if (error) throw error
      setTanda(data)
    } catch (e) { setError(e.message) }
  }

  async function terminar() {
    try {
      const { data: ls } = await db.from('carne_temp_lecturas')
        .select('temp_carne').eq('tanda_id', tanda.id).not('temp_carne', 'is', null)
      const temps = (ls || []).map(x => Number(x.temp_carne))
      const resumen = temps.length ? {
        temp_min: Math.min(...temps),
        temp_max: Math.max(...temps),
        temp_prom: Number((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2)),
        // Cada lectura representa ~5 s; sirve para dimensionar cuanto tiempo
        // estuvo fuera de rango sin tener que reprocesar la serie completa.
        minutos_sobre_6: Number((temps.filter(t => t > 6).length * GUARDA_CADA_MS / 60000).toFixed(1)),
      } : {}
      const { data, error } = await db.from('carne_tandas').update({
        boleado_fin: new Date().toISOString(), estado: 'terminada', ...resumen,
      }).eq('id', tanda.id).select().single()
      if (error) throw error
      setTanda(data)
    } catch (e) { setError(e.message) }
  }

  const vivo = ultimaAt && Date.now() - ultimaAt < 15000
  const restante = tanda?.estado === 'mezclando' ? MIN_MEZCLADO - seg
                 : tanda?.estado === 'boleando'  ? MIN_BOLEADO - seg : 0
  const vencido = restante <= 0

  return (
    <div style={{ padding: 16, background: C.bg, color: C.txt, minHeight: '100%' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>🥩 Mezclado y boleado de carne</h2>
        <div style={{ color: C.dim, fontSize: 13, marginTop: 3 }}>
          {LIBRAS_LOTE} lb · mezclar 10 min · bolear {LIBRAS_BOLEAR} lb en 15 min
        </div>
      </div>

      {error && <div style={{ ...card, background: '#3a1212', borderColor: C.bad, color: '#fecaca' }}>{error}</div>}

      {!soportado && (
        <div style={{ ...card, background: '#2a2410', borderColor: C.warn, color: '#fde68a' }}>
          <b>Falta activar el Bluetooth del navegador</b>
          <div style={{ marginTop: 7, fontSize: 14, lineHeight: 1.6 }}>
            En esta tablet, abrí Chrome y escribí <b>chrome://flags</b> en la barra de
            direcciones. Buscá <b>Experimental Web Platform features</b>, ponelo en
            <b> Enabled</b> y reiniciá Chrome. Se hace una sola vez.
          </div>
        </div>
      )}

      {/* ── Temperatura: solo importa durante el boleado ── */}
      <div style={{ ...card, textAlign: 'center', padding: 22 }}>
        {!escaneando ? (
          <>
            <div style={{ color: C.dim, fontSize: 15, marginBottom: 13 }}>
              La sonda se usa hasta el paso 2. Podés conectarla desde ya.
            </div>
            <button onClick={conectarSonda} disabled={!soportado} style={btn(C.acc, !soportado)}>
              Conectar la sonda
            </button>
          </>
        ) : !lectura ? (
          <div style={{ color: C.warn, fontSize: 17 }}>
            Buscando la sonda… sacala de su estuche para que despierte.
          </div>
        ) : tanda?.estado === 'mezclando' ? (
          <div style={{ color: C.dim, fontSize: 16, lineHeight: 1.6 }}>
            <b style={{ color: C.txt }}>Durante el mezclado no se mide.</b><br />
            Dejá la sonda fuera de la carne mientras sazonan y mezclan.
          </div>
        ) : (
          <>
            <div style={{ color: C.dim, fontSize: 14 }}>Temperatura de la carne</div>
            <div style={{
              fontSize: 78, fontWeight: 700, lineHeight: 1.05, margin: '4px 0',
              color: lectura.carne > 6 ? C.warn : C.ok,
            }}>
              {lectura.carne.toFixed(1)} °C
            </div>
            <div style={{ color: C.dim, fontSize: 14 }}>
              ambiente {lectura.ambiente.toFixed(1)} °C
              {lectura.bateria ? ` · batería ${lectura.bateria}%` : ''}
              {' · '}
              <span style={{ color: vivo ? C.ok : C.bad }}>{vivo ? 'en vivo' : 'sin señal'}</span>
            </div>
          </>
        )}
      </div>

      {/* ── Proceso ── */}
      {!tanda && lectura && (
        <div style={card}>
          <div style={{ fontSize: 17, marginBottom: 13 }}>
            <b>Paso 1.</b> Sacá {LIBRAS_LOTE} libras de carne y dale al botón cuando
            empieces a mezclar.
          </div>
          <button onClick={iniciarTanda} style={btn(C.ok)}>Empecé a mezclar</button>
        </div>
      )}

      {tanda && tanda.estado !== 'terminada' && (
        <div style={{ ...card, borderColor: vencido ? C.warn : C.line, borderWidth: 2 }}>
          <div style={{ color: C.dim, fontSize: 14 }}>
            {tanda.estado === 'mezclando' ? 'Paso 1 · Mezclando' : `Paso 2 · Boleando ${LIBRAS_BOLEAR} lb`}
          </div>
          <div style={{
            fontSize: 74, fontWeight: 700, lineHeight: 1.05, margin: '4px 0',
            color: vencido ? C.warn : C.txt, textAlign: 'center',
          }}>
            {vencido ? '¡Tiempo!' : mmss(restante)}
          </div>

          {tanda.estado === 'mezclando' ? (
            <>
              {vencido && (
                <div style={{
                  background: '#2a2410', border: `2px solid ${C.warn}`, borderRadius: 11,
                  padding: 16, margin: '12px 0', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 21, fontWeight: 700, color: C.warn }}>
                    Guardá {LIBRAS_LOTE - LIBRAS_BOLEAR} libras
                  </div>
                  <div style={{ fontSize: 16, color: '#fde68a', marginTop: 5 }}>
                    Quedate con {LIBRAS_BOLEAR} lb y empezá a bolear
                  </div>
                </div>
              )}
              {/* La testigo se arma junto con la primera bolita real, no despues:
                  si se arma tarde, no vive el peor caso y la medicion no sirve. */}
              <div style={{
                background: '#101827', border: `1px solid ${C.acc}`, borderRadius: 11,
                padding: 14, margin: '12px 0',
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.acc }}>
                  Antes de arrancar: armá la bolita testigo
                </div>
                <div style={{ fontSize: 14.5, color: '#bfdbfe', marginTop: 6, lineHeight: 1.55 }}>
                  Junto con la primera bolita, hacé una de {BOLITA_TESTIGO_G} g con
                  la sonda clavada adentro. Dejala en la misma bandeja. Al final
                  se descarta — <b>no se usa</b>.
                </div>
              </div>
              <button onClick={pasarABoleado} disabled={!lectura}
                style={btn(vencido ? C.warn : '#3f3f46', !lectura)}>
                {lectura ? 'Ya guardé · empiezo a bolear' : 'Conectá la sonda primero'}
              </button>
            </>
          ) : (
            <button onClick={terminar} style={btn(C.ok)}>Terminé de bolear</button>
          )}

          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 11, textAlign: 'center' }}>
            {guardadas} lecturas guardadas · dejá esta pantalla abierta
          </div>
        </div>
      )}

      {tanda?.estado === 'terminada' && (
        <div style={{ ...card, borderColor: C.ok }}>
          <b style={{ fontSize: 18, color: C.ok }}>✓ Tanda terminada</b>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12, fontSize: 15 }}>
            <div><span style={{ color: C.dim }}>mínima</span><br /><b>{tanda.temp_min ?? '—'} °C</b></div>
            <div><span style={{ color: C.dim }}>máxima</span><br /><b>{tanda.temp_max ?? '—'} °C</b></div>
            <div><span style={{ color: C.dim }}>promedio</span><br /><b>{tanda.temp_prom ?? '—'} °C</b></div>
            <div><span style={{ color: C.dim }}>sobre 6 °C</span><br /><b>{tanda.minutos_sobre_6 ?? 0} min</b></div>
          </div>
          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
            Medido en la bolita testigo de {BOLITA_TESTIGO_G} g. Una bolita real pesa
            menos y se calienta más rápido, así que la temperatura real fue algo mayor.
          </div>
          <button onClick={() => { setTanda(null); setSeg(0) }} style={{ ...btn(C.acc), marginTop: 14 }}>
            Empezar otra tanda
          </button>
        </div>
      )}

      {/* ── Diagnostico: se usa una sola vez, para validar el decodificado ── */}
      {lectura && (
        <div style={card}>
          <button onClick={() => setDiag(v => !v)} style={{
            background: 'none', border: 'none', color: C.dim, fontSize: 13,
            cursor: 'pointer', padding: 0, fontFamily: 'inherit',
          }}>
            {diag ? '▾' : '▸'} Diagnóstico de la sonda
          </button>
          {diag && (
            <div style={{ marginTop: 11, fontSize: 13, lineHeight: 1.7 }}>
              <div style={{ color: C.dim }}>Las 6 temperaturas del paquete:</div>
              <div style={{ fontFamily: 'monospace', fontSize: 15, margin: '4px 0 10px' }}>
                {lectura.todas.map(v => v.toFixed(1)).join('  ·  ')}
              </div>
              <div style={{ color: C.dim }}>Paquete crudo:</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11.5, wordBreak: 'break-all', color: '#a8a8b0' }}>
                {lectura.hex}
              </div>
              <div style={{ color: C.dim, marginTop: 10, fontSize: 12.5 }}>
                Para validar: meté la sonda en agua con hielo. El valor más frío
                debe acercarse a 0 °C. Si eso pasa, el decodificado es correcto.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
