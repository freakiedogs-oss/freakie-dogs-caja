/* ═══════════════════════════════════════════════════════════════════════
   Estación de pesaje del chili — tablet junto a la balanza

   Por qué es una página aparte y no un paso del celular: son 25 ingredientes
   y la balanza está cableada por USB a la tablet. La operaria lleva los pasos
   1 a 6 en su teléfono; al llegar al pesaje se para frente a esta pantalla,
   elige qué va a pesar, y la Rhino manda el número sola.

   Tres decisiones que la hacen servir:

   1. CADA PESO SE GUARDA SOLO, apenas se toma. No hay botón de "guardar
      todo" al final: si se va la luz en el ingrediente 18, los 17 anteriores
      ya están en la base.

   2. EL CUMPLE LO DECIDE EL SERVIDOR. La pantalla pinta verde o rojo para
      guiar, pero quien calcula la banda y sentencia es fn_pesaje_guardar.
      Si algún día la tolerancia cambia, cambia en un solo lugar.

   3. NO HAY SESIÓN. La tablet está dedicada y bajo control de Casa Matriz,
      igual que la de carne. Se pregunta el nombre una vez al día — no es
      autenticación, es trazabilidad para el registro.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../supabase'
import { useBalanza } from '../porcionador/useBalanza'

const STORE = 'CM001'
const REFRESCO_MS = 15000

const C = {
  bg: '#0a0a0b', card: '#141416', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', bad: '#ef4444', acc: '#3b82f6', warn: '#eab308',
}

const GRUPOS = [
  { k: 'balanza_grande',    t: 'Balanza Rhino',        sub: 'el peso entra solo' },
  { k: 'balanza_precision', t: 'Balanza de precisión',  sub: 'se teclea y va con foto' },
  { k: 'conteo',            t: 'Se cuenta',             sub: 'no se pesa' },
]

const banda = (it) =>
  Math.max(Number(it.objetivo) * Number(it.tol_pct) / 100, Number(it.tol_g || 0))

export default function PesajeChiliApp({ quien }) {
  const [tanda, setTanda]   = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError]   = useState('')
  const [activo, setActivo] = useState(null)
  const [manual, setManual] = useState('')      // para los de precisión y conteo
  const [lote, setLote]     = useState('')
  const [guardando, setGuardando] = useState(false)

  const balanza = useBalanza()

  const cargar = useCallback(async () => {
    try {
      const { data, error: e } = await db.rpc('fn_pesaje_tanda_abierta', { p_store: STORE })
      if (e) throw e
      setTanda(data || null)
      setError('')
    } catch (e) {
      setError(e.message || 'No se pudo consultar la tanda')
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, REFRESCO_MS)
    return () => clearInterval(t)
  }, [cargar])

  const items   = tanda?.items || []
  const pesados = tanda?.pesados || {}
  const it      = items.find(x => x.id === activo) || null

  const listos = items.filter(x => pesados[x.id]).length
  const malos  = items.filter(x => pesados[x.id] && pesados[x.id].cumple === false).length

  // Al elegir otro ingrediente se limpia lo tecleado: si quedara el número
  // anterior, un toque distraído lo guardaría en el ingrediente equivocado.
  const elegir = (id) => {
    setActivo(id === activo ? null : id)
    setManual(''); setLote('')
  }

  const esRhino = it && it.fuente === 'balanza_grande'
  const valor = esRhino ? balanza.gramos : Number(manual)
  const hayValor = esRhino ? balanza.estado === 'conectada' : manual !== '' && Number.isFinite(valor)
  const dentro = it && hayValor && Math.abs(valor - Number(it.objetivo)) <= banda(it)
  const puedeGuardar = it && hayValor && !guardando && (!esRhino || balanza.estable)

  async function guardar() {
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      const { data, error: e } = await db.rpc('fn_pesaje_guardar', {
        p_corrida: tanda.corrida_id,
        p_item: it.id,
        p_gramos: valor,
        p_lote: it.requiere_lote ? (lote.trim() || null) : null,
        p_por: quien,
        p_origen: esRhino ? 'tablet' : 'tablet_manual',
      })
      if (e) throw e
      if (data?.error) throw new Error(data.error)
      setActivo(null); setManual(''); setLote('')
      await cargar()
    } catch (e) {
      setError(e.message || 'No se pudo guardar el peso')
    }
    setGuardando(false)
  }

  // ── Sin tanda abierta ────────────────────────────────────────────────
  if (cargando) return <Centro texto="Buscando la tanda…" />
  if (!tanda) return (
    <Centro
      icono="⏸️"
      titulo="No hay ninguna tanda abierta"
      texto="Abrí la corrida del chili en el celular y esta pantalla la toma sola."
      pie={error} />
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.txt,
                  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>

      {/* Banda fija de revisión. Va arriba de todo y no se puede cerrar: si
          alguien pesa una tanda real creyendo que está probando, o al revés,
          la tanda entera queda inservible. */}
      {tanda.es_revision && (
        <div style={{
          background: '#3a2f0f', borderBottom: `2px solid ${C.warn}`, color: '#fcd34d',
          padding: '10px 18px', fontSize: 13.5, lineHeight: 1.5,
        }}>
          <b>MODO REVISIÓN — esto no cuenta.</b> Sirve para probar la balanza y
          para entrenar. Los pesos se guardan marcados como prueba y no entran
          en los reportes.
        </div>
      )}

      {/* Cabecera */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 18px', borderBottom: `1px solid ${C.line}`, gap: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>
            ⚖️ Pesaje del chili
            {tanda.es_revision && (
              <span style={{ fontSize: 11, background: '#3a2f0f', color: '#fcd34d',
                             padding: '2px 9px', borderRadius: 20, marginLeft: 8,
                             verticalAlign: 'middle' }}>revisión</span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 2 }}>
            Lote {tanda.lote || '—'} · {tanda.fecha} · {quien}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 19, fontWeight: 800,
                        color: listos === items.length ? C.ok : C.txt }}>
            {listos} / {items.length}
          </div>
          {malos > 0 && <div style={{ fontSize: 12, color: C.bad }}>{malos} fuera de banda</div>}
        </div>
      </div>

      {error && (
        <div style={{ background: '#3a1414', border: `1px solid ${C.bad}`, color: '#fca5a5',
                      padding: '9px 14px', fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 14, padding: 14, alignItems: 'flex-start',
                    flexWrap: 'wrap' }}>

        {/* ── Panel de pesada ── */}
        <div style={{ flex: '1 1 340px', minWidth: 300, position: 'sticky', top: 14 }}>

          {/* Báscula */}
          <div style={{
            background: balanza.estado === 'conectada' ? '#0d1f14'
                      : balanza.estado === 'error' ? '#2a1414' : C.card,
            border: `1px solid ${balanza.estado === 'conectada' ? C.ok
                               : balanza.estado === 'error' ? C.bad : C.line}`,
            borderRadius: 12, padding: 14, marginBottom: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Balanza Rhino</div>
                {balanza.mensaje && (
                  <div style={{ fontSize: 12, color: balanza.estado === 'error' ? '#fca5a5' : C.dim,
                                marginTop: 3, lineHeight: 1.45 }}>{balanza.mensaje}</div>
                )}
              </div>
              <button
                onClick={balanza.estado === 'conectada' ? balanza.desconectar : balanza.conectar}
                disabled={balanza.estado === 'conectando'}
                style={{
                  flexShrink: 0, background: '#1a1a1c', color: balanza.estado === 'conectada' ? C.dim : C.acc,
                  border: `1px solid ${balanza.estado === 'conectada' ? C.line : C.acc}`,
                  borderRadius: 9, padding: '10px 15px', fontSize: 14,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {balanza.estado === 'conectada' ? 'Desconectar'
                  : balanza.estado === 'conectando' ? 'Conectando…' : 'Conectar'}
              </button>
            </div>
          </div>

          {/* Lo que se está pesando */}
          <div style={{ background: C.card, border: `1px solid ${
                          !it ? C.line : dentro ? C.ok : hayValor ? C.bad : C.line }`,
                        borderRadius: 12, padding: 16, textAlign: 'center' }}>
            {!it ? (
              <div style={{ color: C.dim, fontSize: 15, padding: '30px 10px', lineHeight: 1.6 }}>
                Tocá abajo el ingrediente<br />que vas a pesar
              </div>
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{it.ingrediente}</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
                  Objetivo {Number(it.objetivo).toLocaleString('es-SV')} {it.unidad}
                  {banda(it) > 0 && ` ± ${banda(it).toFixed(banda(it) < 1 ? 2 : 1)}`}
                </div>
                {it.referencia && (
                  <div style={{ fontSize: 12, color: '#6b6a72', marginTop: 4 }}>{it.referencia}</div>
                )}

                {esRhino ? (
                  <>
                    <div style={{ fontSize: 62, fontWeight: 800, lineHeight: 1.1, marginTop: 12,
                                  fontVariantNumeric: 'tabular-nums',
                                  color: !hayValor ? C.dim : dentro ? C.ok : C.bad }}>
                      {balanza.estado === 'conectada'
                        ? balanza.gramos.toLocaleString('es-SV')
                        : '—'}
                      <span style={{ fontSize: 24, marginLeft: 6, color: C.dim }}>g</span>
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 2,
                                  color: balanza.estado !== 'conectada' ? C.dim
                                       : balanza.estable ? (dentro ? '#86efac' : '#fca5a5') : C.dim }}>
                      {balanza.estado !== 'conectada' ? 'Conectá la balanza para empezar'
                        : !balanza.estable ? 'Esperando que se estabilice…'
                        : dentro ? '✓ Dentro de la banda'
                        : `Fuera de banda por ${Math.abs(valor - Number(it.objetivo)).toFixed(0)} g`}
                    </div>
                  </>
                ) : (
                  <input
                    type="number" inputMode="decimal" step="0.01" autoFocus
                    value={manual} onChange={e => setManual(e.target.value)}
                    placeholder={`${it.unidad} reales`}
                    style={{
                      width: '100%', marginTop: 14, background: '#0b0b0c', color: C.txt,
                      border: `1px solid ${!hayValor ? C.line : dentro ? C.ok : C.bad}`,
                      borderRadius: 10, padding: '16px 12px', fontSize: 34, textAlign: 'center',
                      fontWeight: 700, fontFamily: 'inherit', boxSizing: 'border-box',
                    }} />
                )}

                {it.requiere_lote && (
                  <input
                    value={lote} onChange={e => setLote(e.target.value)}
                    placeholder="Lote del empaque"
                    style={{
                      width: '100%', marginTop: 10, background: '#0b0b0c', color: C.txt,
                      border: `1px solid ${C.line}`, borderRadius: 9, padding: '12px',
                      fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box',
                    }} />
                )}

                <button onClick={guardar} disabled={!puedeGuardar} style={{
                  width: '100%', marginTop: 12, padding: '18px', borderRadius: 11, border: 'none',
                  fontSize: 18, fontWeight: 800, fontFamily: 'inherit',
                  cursor: puedeGuardar ? 'pointer' : 'not-allowed',
                  background: !puedeGuardar ? '#2a2a2e' : dentro ? C.ok : C.bad,
                  color: !puedeGuardar ? C.dim : dentro ? '#08210f' : '#fff',
                }}>
                  {guardando ? 'Guardando…'
                    : !hayValor ? 'Sin peso todavía'
                    : esRhino && !balanza.estable ? 'Esperando peso estable…'
                    : dentro ? `Guardar ${Number(valor).toLocaleString('es-SV')} ${it.unidad}`
                    : `Guardar igual (fuera de banda)`}
                </button>

                {hayValor && !dentro && (
                  <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8, lineHeight: 1.5 }}>
                    Se guarda de todos modos y queda marcado. Corregilo antes si podés.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Lista de ingredientes ── */}
        <div style={{ flex: '2 1 420px', minWidth: 300 }}>
          {GRUPOS.map(({ k, t, sub }) => {
            const del = items.filter(x => (x.fuente || 'balanza_grande') === k)
            if (!del.length) return null
            return (
              <div key={k} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: .6,
                              color: C.dim, marginBottom: 8 }}>
                  {t} <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {sub}</span>
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                  {del.map(x => {
                    const p = pesados[x.id]
                    const sel = activo === x.id
                    return (
                      <button key={x.id} onClick={() => elegir(x.id)} style={{
                        textAlign: 'left', width: '100%', cursor: 'pointer', fontFamily: 'inherit',
                        background: sel ? '#132033' : p ? (p.cumple ? '#0e1f14' : '#2a1414') : C.card,
                        border: `1px solid ${sel ? C.acc : p ? (p.cumple ? C.ok : C.bad) : C.line}`,
                        borderRadius: 10, padding: '12px 14px', color: C.txt,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>{x.ingrediente}</div>
                          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                            {Number(x.objetivo).toLocaleString('es-SV')} {x.unidad}
                            {banda(x) > 0 && ` ± ${banda(x).toFixed(banda(x) < 1 ? 2 : 1)}`}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {p ? (
                            <>
                              <div style={{ fontSize: 17, fontWeight: 800,
                                            color: p.cumple ? C.ok : C.bad }}>
                                {Number(p.g).toLocaleString('es-SV')}
                              </div>
                              <div style={{ fontSize: 11, color: C.dim }}>
                                {p.cumple ? '✓ ok' : 'fuera'}
                              </div>
                            </>
                          ) : (
                            <span style={{ fontSize: 13, color: sel ? C.acc : C.dim }}>
                              {sel ? 'pesando…' : 'pendiente'}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {listos === items.length && (
            <div style={{ background: '#0e1f14', border: `1px solid ${C.ok}`, borderRadius: 11,
                          padding: 14, fontSize: 14, color: '#86efac', lineHeight: 1.6 }}>
              ✓ <b>Todo pesado.</b> Volvé al celular y continuá con el paso siguiente.
              {malos > 0 && <> Quedaron {malos} fuera de banda: van a salir como desviación.</>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Centro({ icono = '⚖️', titulo, texto, pie }) {
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.txt, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 28, textAlign: 'center',
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    }}>
      <div style={{ fontSize: 46, marginBottom: 10 }}>{icono}</div>
      {titulo && <div style={{ fontSize: 21, fontWeight: 700, marginBottom: 8 }}>{titulo}</div>}
      <div style={{ color: C.dim, fontSize: 15, lineHeight: 1.6, maxWidth: 400 }}>{texto}</div>
      {pie && <div style={{ color: '#fca5a5', fontSize: 12.5, marginTop: 14 }}>{pie}</div>}
    </div>
  )
}
