/* ═══════════════════════════════════════════════════════════════════════
   Incentivo por agrandados — cajas de food court

   $0.10 por agrandado, pagado en bloques (100, o 25 en Usulutan mientras
   arranca). Periodo del 1 al ultimo dia del mes; el resto no se arrastra.
   Solo suma lo vendido con el PIN autorizado de cada sucursal.

   La cajera ve SOLO lo suyo. Ejecutivo y admin ven las tres.
   A proposito NO hay ranking entre personas: una cajera cubre el 80% de
   los turnos y otra un dia y medio, asi que comparar mide horario, no
   esfuerzo. Cada quien compite contra su propio mes anterior.

   Todo el calculo vive en fn_agrandados_panel(); aca solo se pinta.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react'
import { db } from '../../supabase'

const ROLES_SUPERVISAN = ['ejecutivo', 'admin', 'superadmin', 'jefe_casa_matriz']

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', okBg: '#0e2a17', okTxt: '#86efac',
  warn: '#fbbf24', bad: '#f87171', acc: '#60a5fa',
}

const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 12 }
const money = (n) => '$' + Number(n || 0).toFixed(Number(n) % 1 === 0 ? 0 : 2)

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre']

export default function AgrandadosView({ user }) {
  const [filas, setFilas]   = useState([])
  const [cargando, setCarg] = useState(true)
  const [error, setError]   = useState('')
  const [festejo, setFestejo] = useState(null)

  const rol = user?.rol || ''
  const supervisa = ROLES_SUPERVISAN.includes(rol)

  const cvRef = useRef(null)
  const piezasRef = useRef([])
  const animRef = useRef(false)
  const previoRef = useRef({})   // bloques por persona, para detectar el salto

  async function cargar() {
    try {
      const { data, error: e } = await db.rpc('fn_agrandados_panel')
      if (e) throw e
      const todas = data || []
      // La cajera solo ve su propia fila; nunca la de las companeras.
      const mias = supervisa ? todas : todas.filter(f => f.mesero === user?.nombre)
      detectarBloque(mias)
      setFilas(mias)
      setError('')
    } catch (e) {
      setError(e.code === '42501' || /permission denied/i.test(e.message || '')
        ? 'El sistema no tiene permiso de leer el panel. Avisá a Casa Matriz.'
        : (e.message || 'No se pudo cargar'))
    }
    setCarg(false)
  }

  // Si los bloques cerrados subieron desde la ultima lectura, se festeja.
  function detectarBloque(nuevas) {
    for (const f of nuevas) {
      const antes = previoRef.current[f.mesero]
      if (antes !== undefined && f.bloques > antes && f.ya_arranco) {
        setFestejo({ mesero: f.mesero, dinero: f.dinero, siguiente: f.dinero_siguiente })
        soltarConfetti()
        setTimeout(() => setFestejo(null), 4500)
      }
      previoRef.current[f.mesero] = f.bloques
    }
  }

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 20000)
    // Realtime sobre la misma cola del KDS: al cobrar, la pantalla reacciona
    // sin esperar los 20 s del respaldo por polling.
    const canal = db.channel('agrandados_' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pos_cocina_queue' }, cargar)
      .subscribe()
    return () => { clearInterval(t); try { db.removeChannel(canal) } catch { /* ya cerrado */ } }
  }, [])

  // ── Confetti ──
  function soltarConfetti() {
    const cv = cvRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    cv.width = r.width; cv.height = r.height
    const cols = ['#22c55e', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa', '#ffffff']
    piezasRef.current = Array.from({ length: 130 }, () => ({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.6,
      vx: (Math.random() - 0.5) * 2.4, vy: 2 + Math.random() * 3.4,
      w: 5 + Math.random() * 6, h: 8 + Math.random() * 7,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.28,
      c: cols[Math.floor(Math.random() * cols.length)],
    }))
    if (!animRef.current) { animRef.current = true; requestAnimationFrame(pintar) }
  }
  function pintar() {
    const cv = cvRef.current
    if (!cv) { animRef.current = false; return }
    const cx = cv.getContext('2d')
    cx.clearRect(0, 0, cv.width, cv.height)
    let vivas = 0
    for (const p of piezasRef.current) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.045
      if (p.y < cv.height + 30) vivas++
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot)
      cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore()
    }
    if (vivas > 0) requestAnimationFrame(pintar)
    else { animRef.current = false; cx.clearRect(0, 0, cv.width, cv.height) }
  }

  if (cargando) return <div style={{ padding: 20, color: C.dim }}>Cargando…</div>

  if (error) {
    return <div style={{ padding: 16, background: C.bg, minHeight: '100%' }}>
      <div style={{ ...card, background: '#3a1212', borderColor: C.bad, color: '#fecaca' }}>{error}</div>
    </div>
  }

  if (filas.length === 0) {
    return <div style={{ padding: 16, background: C.bg, color: C.txt, minHeight: '100%' }}>
      <div style={{ ...card, color: C.dim }}>
        Tu caja todavía no está en el programa de agrandados. Consultá con Casa Matriz.
      </div>
    </div>
  }

  const arrancado = filas.some(f => f.ya_arranco)

  return (
    <div style={{ padding: 16, background: C.bg, color: C.txt, minHeight: '100%', position: 'relative' }}>

      <canvas ref={cvRef} style={{
        position: 'fixed', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 50,
      }} />

      {festejo && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(6,20,10,0.94)', zIndex: 51,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', padding: 20,
        }}>
          <div style={{ fontSize: 54 }}>🎉</div>
          <div style={{ color: C.ok, fontSize: 17, fontWeight: 700, marginTop: 6 }}>
            ¡Cerraste otro bloque!
          </div>
          <div style={{ color: C.ok, fontSize: 68, fontWeight: 700, lineHeight: 1.05, margin: '8px 0' }}>
            {money(festejo.dinero)}
          </div>
          <div style={{ color: C.okTxt, fontSize: 15 }}>Vas por los {money(festejo.siguiente)}</div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 21 }}>💵 Agrandados</h2>
        <div style={{ color: C.dim, fontSize: 13, marginTop: 3 }}>
          {MESES[new Date().getMonth()]} · $0.10 por agrandado, pagado por bloques
        </div>
      </div>

      {/* Antes del arranque la pestana existe pero no muestra numeros: se
          publica con anticipacion para que la gente la conozca, y se enciende
          sola el dia 1. */}
      {!arrancado && (
        <div style={{
          ...card, background: '#2a2410', borderColor: C.warn, color: '#fde68a',
          textAlign: 'center', padding: '26px 18px',
        }}>
          <div style={{ fontSize: 34 }}>🗓️</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginTop: 8, color: C.warn }}>
            Disponible a partir del 1 de septiembre
          </div>
          <div style={{ fontSize: 14.5, marginTop: 9, lineHeight: 1.55, maxWidth: 460, margin: '9px auto 0' }}>
            Desde ese día vas a ver acá cuántos agrandados llevás vendidos y
            cuánto dinero has ganado. Se paga <b>$0.10 por agrandado</b>, en
            bloques de {filas[0]?.bloque_tam}. El conteo arranca en cero el día 1.
          </div>
        </div>
      )}

      {arrancado && filas.map(f => <Tarjeta key={f.mesero} f={f} solo={filas.length === 1} />)}
    </div>
  )
}

function Tarjeta({ f, solo }) {
  const meta   = Number(f.meta_pct || 0)
  const actual = Number(f.tasa_actual || 0)
  const proy   = Number(f.proyeccion_tasa || 0)
  // Con menos de 6 dias corridos la proyeccion es ruido: 3 dias extrapolados
  // a 30 dan cualquier cosa, y una proyeccion falsa desanima mas que ninguna.
  const proyectable = f.dia_del_mes >= 6 && proy > 0
  const llega = proy >= meta
  const tope  = Math.max(meta * 1.35, actual * 1.15, proy * 1.15, 1)
  const pct   = (v) => Math.min(100, (v / tope) * 100)

  const faltaDia = (() => {
    if (!proyectable || llega) return null
    const diasQuedan = Math.max(f.dias_del_mes - f.dia_del_mes, 1)
    const objetivo = Math.ceil((meta / 100) * (f.cuentas_mes / Math.max(f.dia_del_mes, 1)) * f.dias_del_mes)
    return Math.max(Math.ceil((objetivo - f.mes) / diasQuedan) - Math.round(f.mes / Math.max(f.dia_del_mes, 1)), 1)
  })()

  const cierreMes = f.dia_del_mes >= f.dias_del_mes - 5

  return (
    <div style={{ marginBottom: solo ? 0 : 20 }}>
      {!solo && (
        <div style={{ color: C.dim, fontSize: 13, marginBottom: 7 }}>
          {f.mesero} · {f.sucursal}
        </div>
      )}

      <div style={{ background: C.okBg, borderRadius: 12, padding: '20px 18px', marginBottom: 12 }}>
        <div style={{ color: C.okTxt, fontSize: 14 }}>Llevás ganado este mes</div>
        <div style={{ color: C.ok, fontSize: solo ? 62 : 44, fontWeight: 700, lineHeight: 1.05, margin: '2px 0 6px' }}>
          {money(f.dinero)}
        </div>
        <div style={{ color: C.okTxt, fontSize: 14 }}>
          {Number(f.mes).toLocaleString('es')} agrandados · {f.bloques} bloque{f.bloques === 1 ? '' : 's'} cerrado{f.bloques === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ ...card, flex: '1 1 150px', marginBottom: 0 }}>
          <div style={{ color: C.dim, fontSize: 13 }}>
            {cierreMes ? 'Tenés asegurado' : 'Si seguís así'}
          </div>
          <div style={{ color: C.txt, fontSize: 32, fontWeight: 700, margin: '3px 0' }}>
            {money(cierreMes ? f.dinero : f.proyeccion_dinero)}
          </div>
          <div style={{ color: C.dim, fontSize: 13 }}>
            {cierreMes ? 'no lo dejés ir' : 'al cerrar el mes'}
          </div>
        </div>
        <div style={{ ...card, flex: '1 1 150px', marginBottom: 0 }}>
          <div style={{ color: C.dim, fontSize: 13 }}>Sumaste hoy</div>
          <div style={{ color: C.acc, fontSize: 32, fontWeight: 700, margin: '3px 0' }}>
            ${(f.hoy * Number(f.valor_unit)).toFixed(2)}
          </div>
          <div style={{ color: C.dim, fontSize: 13 }}>{f.hoy} agrandados</div>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            {f.faltan} más y son <span style={{ color: C.ok }}>{money(f.dinero_siguiente)}</span>
          </span>
          <span style={{ color: C.dim, fontSize: 13 }}>{f.resto} de {f.bloque_tam}</span>
        </div>
        <div style={{ background: '#101012', borderRadius: 99, height: 24, overflow: 'hidden' }}>
          <div style={{ background: C.ok, height: '100%', width: `${(f.resto / f.bloque_tam) * 100}%`,
                        borderRadius: 99, transition: 'width .4s' }} />
        </div>
        <div style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>
          El pago va de {f.bloque_tam} en {f.bloque_tam}. Esos {f.resto} se cobran al completar el bloque.
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Tu meta del mes</span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{actual}%</span>
        </div>
        <div style={{ background: '#101012', borderRadius: 99, height: 24, overflow: 'hidden', position: 'relative' }}>
          {/* Sombra = donde cierra el mes al ritmo de los ultimos 7 dias. */}
          {proyectable && (
            <div style={{
              position: 'absolute', inset: 0, width: `${pct(proy)}%`, borderRadius: 99,
              background: llega ? 'rgba(34,197,94,0.30)' : 'rgba(248,113,113,0.32)',
            }} />
          )}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${pct(actual)}%`, background: C.ok, borderRadius: 99 }} />
          <div style={{ position: 'absolute', left: `${pct(meta)}%`, top: 0, bottom: 0,
                        width: 2, background: C.warn }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 12 }}>
          <span style={{ color: C.dim }}>
            mes pasado {f.mes_anterior_tasa != null ? `${f.mes_anterior_tasa}%` : '—'}
          </span>
          <span style={{ color: C.warn }}>meta {meta}%</span>
        </div>
        {proyectable ? (
          <>
            <div style={{ color: llega ? C.okTxt : C.bad, fontSize: 13.5, marginTop: 9 }}>
              A tu ritmo de esta semana cerrás en <b>{proy}%</b>
              {llega ? ' — arriba de la meta' : ` — te faltan ${(meta - proy).toFixed(1)} puntos`}
            </div>
            {faltaDia && (
              <div style={{ color: C.dim, fontSize: 12.5, marginTop: 3 }}>
                Con {faltaDia} agrandado{faltaDia === 1 ? '' : 's'} más por día volvés a la meta
              </div>
            )}
          </>
        ) : (
          <div style={{ color: C.dim, fontSize: 13.5, marginTop: 9 }}>
            Con {f.dia_del_mes} día{f.dia_del_mes === 1 ? '' : 's'} todavía no se puede proyectar bien.
          </div>
        )}
      </div>

      {f.mejor_dia > 0 && (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Tu mejor día fue {f.mejor_dia}</div>
            <div style={{ color: C.dim, fontSize: 13, marginTop: 2 }}>
              {f.hoy >= f.mejor_dia
                ? '¡Hoy lo igualaste o lo superaste!'
                : `hoy vas ${f.hoy} · faltan ${f.mejor_dia - f.hoy} para romperlo`}
            </div>
          </div>
          <div style={{ color: C.warn, fontSize: 28 }}>★</div>
        </div>
      )}
    </div>
  )
}
