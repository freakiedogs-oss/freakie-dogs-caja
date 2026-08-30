/* ═══════════════════════════════════════════════════════════════════════
   Proceso de mezclado y boleado de carne — tablet de Casa Matriz

   Ciclo: sacar 100 lb -> mezclar 10 min -> guardar 67 lb en el freezer ->
   bolear 33 lb en 15 min -> la bandeja va al freezer -> sacar las siguientes
   33 lb y repetir. TRES rondas por tanda.

   Cada ronda lleva SU PROPIA bolita testigo. Las tres arrancan de temperaturas
   distintas: la ronda 1 sale de carne que ya estuvo 10 min afuera durante el
   mezclado, mientras que la 2 y la 3 vuelven al freezer y recuperan frio
   mientras se bolea la anterior. Comparar las tres es lo que dice si el
   freezer alcanza a recuperar entre rondas.

   ── Que se mide y por que ──
   Durante el MEZCLADO no hay sonda: la carne se manipula y se sazona a mano,
   y la sonda estorba o se dana. Solo corre el cronometro.

   Durante el BOLEADO la sonda va en una "bolita testigo" armada junto con la
   primera bolita real, que se descarta al final. Es el peor caso: ya recibio
   calor de las manos y es la que mas tiempo pasa en la bandeja. Medir la masa
   de 33 lb no sirve — se calienta mucho mas despacio y daria un numero
   tranquilizador y falso.

   La testigo pesa 0.30 lb y una bolita real 0.15 lb, asi que la testigo se
   calienta mas lento y SUBESTIMA. Por eso al operario NO se le muestra la
   lectura cruda sino la estimada para una bolita real (lectura + offset):
   es el numero con el que decide si apurarse o guardar la bandeja.

   La lectura cruda se sigue guardando en temp_carne. Si el offset resulta
   mal calibrado, se recalcula todo el historico sin haber perdido nada.

   PROFUNDIDAD DE LA SONDA: a media profundidad de la testigo, NO hasta el
   centro. El centro de una bolita casi no se mueve en 15 min (3 -> 4 C)
   mientras la superficie llega a 10; el riesgo esta en la capa exterior,
   que es donde estuvieron las manos. Clavada hasta el fondo, la pantalla
   marcaria "todo bien" siempre.

   FASE 1 (sep-2026): NO bloquea ni corta el proceso, solo avisa y registra.
   Primero hay que medir cuanto se sale en la practica; con esos datos se
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
const RONDAS = 3
const BOLITA_TESTIGO_G = 136   // 0.30 lb: el doble de una bolita real

// La sonda mide la testigo (0.30 lb) pero al operario se le muestra lo que
// tendria una bolita REAL (0.15 lb), que es la que se va al producto. La
// diferencia sale de la solucion analitica de conduccion en esfera con
// propiedades de carne molida de literatura, a 15 min, de 3 a 24 grados:
//   aire quieto +1.0 · moderado +1.9 · con gente pasando +2.7
// Se usa el escenario moderado. ES UNA ESTIMACION — se reemplaza en cuanto
// Mauricio mida bolitas reales con termometro de puncion.
const OFFSET_ESTIMADO_C = 1.9
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

function AvisoTestigo({ numero }) {
  return (
    <div style={{ background: '#101827', border: `1px solid ${C.acc}`, borderRadius: 11, padding: 14, margin: '12px 0' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.acc }}>
        Bolita testigo de la ronda {numero}
      </div>
      <div style={{ fontSize: 14.5, color: '#bfdbfe', marginTop: 6, lineHeight: 1.55 }}>
        Junto con la primera bolita de esta ronda, hacé una del doble de tamaño
        (0.30 lb) y clavá la sonda <b>hasta la mitad, no hasta el fondo</b>.
        Al final se descarta — <b>no se usa</b>.
      </div>
    </div>
  )
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
  const [ronda, setRonda]     = useState(null)
  const [rondas, setRondas]   = useState([])

  const scanRef = useRef(null)
  const ultimoGuardado = useRef(0)
  const tandaRef = useRef(null)
  const rondaRef = useRef(null)
  const lecturaRef = useRef(null)

  useEffect(() => { tandaRef.current = tanda }, [tanda])
  useEffect(() => { rondaRef.current = ronda }, [ronda])
  useEffect(() => { lecturaRef.current = lectura }, [lectura])

  useEffect(() => {
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) setSop(false)
  }, [])

  // Cronometro
  useEffect(() => {
    if (!tanda || tanda.estado === 'terminada') return
    const base = tanda.estado === 'mezclando' ? tanda.mezclado_inicio : ronda?.inicio
    if (!base) return
    const tick = () => setSeg(Math.floor((Date.now() - new Date(base).getTime()) / 1000))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [tanda?.estado, tanda?.mezclado_inicio, ronda?.inicio])

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
        ronda_id: rondaRef.current?.id || null,
        ronda: rondaRef.current?.numero || null,
        fase: t.estado === 'mezclando' ? 'mezclado' : 'boleado',
        temp_carne: d.carne, temp_ambiente: d.ambiente,
        temp_estimada: Number((d.carne + OFFSET_ESTIMADO_C).toFixed(2)),
        offset_aplicado: OFFSET_ESTIMADO_C,
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
        offset_usado_c: OFFSET_ESTIMADO_C, offset_origen: 'estimado_fisica',
        mezclado_inicio: new Date().toISOString(),
        sonda_mac: lectura?.mac || null,
        estado: 'mezclando',
      }).select().single()
      if (error) throw error
      setTanda(data); setGuard(0); setRonda(null); setRondas([])
    } catch (e) { setError(e.message || 'No se pudo iniciar') }
  }

  // Arranca una ronda de boleado. La 1 cierra el mezclado; la 2 y la 3 salen
  // del freezer, por eso cada una necesita su propia bolita testigo.
  async function iniciarRonda(numero) {
    try {
      if (numero === 1) {
        await db.from('carne_tandas').update({
          mezclado_fin: new Date().toISOString(),
          boleado_inicio: new Date().toISOString(),
          estado: 'boleando',
        }).eq('id', tanda.id)
      }
      const { data, error } = await db.from('carne_rondas').insert({
        tanda_id: tanda.id, numero,
        inicio: new Date().toISOString(),
        temp_inicial: lectura ? Number((lectura.carne + OFFSET_ESTIMADO_C).toFixed(2)) : null,
      }).select().single()
      if (error) throw error
      await db.from('carne_tandas').update({ ronda_actual: numero, estado: 'boleando' }).eq('id', tanda.id)
      setTanda(t => ({ ...t, estado: 'boleando', ronda_actual: numero }))
      setRonda(data); setSeg(0); setGuard(0)
    } catch (e) { setError(e.message) }
  }

  async function cerrarRonda() {
    try {
      const { data: ls } = await db.from('carne_temp_lecturas')
        .select('temp_estimada').eq('ronda_id', ronda.id).not('temp_estimada', 'is', null)
      const t = (ls || []).map(x => Number(x.temp_estimada))
      const resumen = t.length ? {
        temp_min: Math.min(...t), temp_max: Math.max(...t),
        temp_prom: Number((t.reduce((a, b) => a + b, 0) / t.length).toFixed(2)),
        minutos_sobre_6: Number((t.filter(x => x > 6).length * GUARDA_CADA_MS / 60000).toFixed(1)),
        lecturas: t.length,
      } : { lecturas: 0 }
      const { data } = await db.from('carne_rondas')
        .update({ fin: new Date().toISOString(), ...resumen }).eq('id', ronda.id).select().single()
      const nuevas = [...rondas.filter(r => r.numero !== ronda.numero), data || ronda].sort((a, b) => a.numero - b.numero)
      setRondas(nuevas)
      setRonda(null)

      if (ronda.numero >= RONDAS) {
        // Resumen de la tanda: se toma el peor caso de las tres rondas, que es
        // lo que define si el proceso completo se salio de rango.
        const maxs = nuevas.map(r => Number(r.temp_max)).filter(Number.isFinite)
        const mins = nuevas.map(r => Number(r.temp_min)).filter(Number.isFinite)
        const { data: fin } = await db.from('carne_tandas').update({
          boleado_fin: new Date().toISOString(), estado: 'terminada',
          temp_max: maxs.length ? Math.max(...maxs) : null,
          temp_min: mins.length ? Math.min(...mins) : null,
          minutos_sobre_6: Number(nuevas.reduce((a, r) => a + Number(r.minutos_sobre_6 || 0), 0).toFixed(1)),
        }).eq('id', tanda.id).select().single()
        setTanda(fin)
      }
    } catch (e) { setError(e.message) }
  }

  const vivo = ultimaAt && Date.now() - ultimaAt < 15000
  const estimada = lectura ? lectura.carne + OFFSET_ESTIMADO_C : 0
  const restante = tanda?.estado === 'mezclando' ? MIN_MEZCLADO - seg
                 : ronda ? MIN_BOLEADO - seg : 0
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
            <div style={{ color: C.dim, fontSize: 14 }}>Temperatura de la bolita</div>
            <div style={{
              fontSize: 78, fontWeight: 700, lineHeight: 1.05, margin: '4px 0',
              color: estimada > 8 ? C.bad : estimada > 6 ? C.warn : C.ok,
            }}>
              {estimada.toFixed(1)} °C
            </div>
            {/* El mensaje empuja a actuar. Ese es el punto de la pantalla:
                que vean el numero subir y se apuren, no que lo analicen. */}
            <div style={{
              fontSize: 17, fontWeight: 700, marginTop: 2,
              color: estimada > 8 ? C.bad : estimada > 6 ? C.warn : C.ok,
            }}>
              {estimada > 8 ? 'Guardá la bandeja ya'
               : estimada > 6 ? 'Se está calentando — apurate'
               : 'En rango'}
            </div>
            <div style={{ color: C.dim, fontSize: 13, marginTop: 7 }}>
              estimada para bolita de 0.15 lb · ambiente {lectura.ambiente.toFixed(1)} °C
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
            {tanda.estado === 'mezclando'
              ? 'Paso 1 · Mezclando las 100 lb'
              : ronda
                ? `Ronda ${ronda.numero} de ${RONDAS} · boleando ${LIBRAS_BOLEAR} lb`
                : `Ronda ${(tanda.ronda_actual || 0) + 1} de ${RONDAS} · lista para empezar`}
          </div>

          {(tanda.estado === 'mezclando' || ronda) && (
            <div style={{
              fontSize: 72, fontWeight: 700, lineHeight: 1.05, margin: '4px 0',
              color: vencido ? C.warn : C.txt, textAlign: 'center',
            }}>
              {vencido ? '¡Tiempo!' : mmss(restante)}
            </div>
          )}

          {/* ── Mezclado ── */}
          {tanda.estado === 'mezclando' && (
            <>
              {vencido && (
                <div style={{ background: '#2a2410', border: `2px solid ${C.warn}`, borderRadius: 11, padding: 16, margin: '12px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 21, fontWeight: 700, color: C.warn }}>
                    Guardá {LIBRAS_LOTE - LIBRAS_BOLEAR} libras en el freezer
                  </div>
                  <div style={{ fontSize: 16, color: '#fde68a', marginTop: 5 }}>
                    Quedate con {LIBRAS_BOLEAR} lb para la primera ronda
                  </div>
                </div>
              )}
              <AvisoTestigo numero={1} />
              <button onClick={() => iniciarRonda(1)} disabled={!lectura}
                style={btn(vencido ? C.warn : '#3f3f46', !lectura)}>
                {lectura ? 'Ya guardé · empiezo la ronda 1' : 'Conectá la sonda primero'}
              </button>
            </>
          )}

          {/* ── Boleando una ronda ── */}
          {ronda && (
            <button onClick={cerrarRonda} style={btn(C.ok)}>
              Terminé la ronda {ronda.numero}
            </button>
          )}

          {/* ── Entre rondas: la carne siguiente sale del freezer ── */}
          {tanda.estado === 'boleando' && !ronda && (tanda.ronda_actual || 0) < RONDAS && (
            <>
              <div style={{ background: '#101827', border: `1px solid ${C.acc}`, borderRadius: 11, padding: 16, margin: '12px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: C.acc }}>
                  Llevá la bandeja al freezer
                </div>
                <div style={{ fontSize: 15, color: '#bfdbfe', marginTop: 5 }}>
                  y sacá las siguientes {LIBRAS_BOLEAR} lb
                </div>
              </div>
              <AvisoTestigo numero={(tanda.ronda_actual || 0) + 1} />
              <button onClick={() => iniciarRonda((tanda.ronda_actual || 0) + 1)} disabled={!lectura}
                style={btn(C.ok, !lectura)}>
                Empiezo la ronda {(tanda.ronda_actual || 0) + 1}
              </button>
            </>
          )}

          {/* ── Rondas ya cerradas ── */}
          {rondas.length > 0 && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              {rondas.map(r => (
                <div key={r.numero} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '5px 0' }}>
                  <span style={{ color: C.dim }}>Ronda {r.numero}</span>
                  <span>
                    arrancó en <b>{r.temp_inicial ?? '—'}</b> · máx{' '}
                    <b style={{ color: Number(r.temp_max) > 8 ? C.bad : Number(r.temp_max) > 6 ? C.warn : C.ok }}>
                      {r.temp_max ?? '—'} °C
                    </b>
                  </span>
                </div>
              ))}
            </div>
          )}

          {(tanda.estado === 'mezclando' || ronda) && (
            <div style={{ color: C.dim, fontSize: 12.5, marginTop: 11, textAlign: 'center' }}>
              {guardadas} lecturas guardadas · dejá esta pantalla abierta
            </div>
          )}
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
            Estimado para una bolita de 0.15 lb, a partir de la sonda en la testigo de
            0.30 lb más {OFFSET_ESTIMADO_C} °C. La lectura cruda queda guardada aparte.
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
              <div style={{ color: C.dim }}>
                Sonda en la testigo: <b style={{ color: C.txt }}>{lectura.carne.toFixed(1)} °C</b>
                {'  ·  '}en pantalla: <b style={{ color: C.txt }}>{estimada.toFixed(1)} °C</b>
                {'  ·  '}offset +{OFFSET_ESTIMADO_C}
              </div>
              <div style={{ color: C.dim, marginTop: 8 }}>Las 6 temperaturas del paquete:</div>
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
