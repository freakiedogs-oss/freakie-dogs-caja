/* ═══════════════════════════════════════════════════════════════════════
   Contador de agrandados dentro del POS

   Va en el header, al lado del reloj: la cajera lo tiene a la vista todo el
   turno mientras cobra, sin cambiar de pantalla. Esa cercania es el punto —
   un panel en otra pestana del ERP no lo mira nadie.

   Chip compacto -> se toca -> panel con meta, proyeccion y mejor dia.
   Cada agrandado nuevo lanza un +$0.10; al cerrar un bloque, confeti.

   Todo el calculo vive en fn_agrandados_panel(). Aca solo se pinta y se
   detectan los saltos entre lecturas.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react'
import { db } from '../supabase'

const money = (n) => '$' + Number(n || 0).toFixed(Number(n) % 1 === 0 ? 0 : 2)

export default function AgrandadoChip({ user }) {
  const [f, setF]         = useState(null)
  const [abierto, setAb]  = useState(false)
  const [festejo, setFes] = useState(null)
  const [flotantes, setFlot] = useState([])

  const previoMes = useRef(null)
  const previoBloques = useRef(null)
  const cvRef = useRef(null)
  const piezas = useRef([])
  const corriendo = useRef(false)

  async function cargar() {
    try {
      const { data, error } = await db.rpc('fn_agrandados_panel')
      if (error) throw error
      const mia = (data || []).find(x => x.mesero === user?.nombre)
      if (!mia) { setF(null); return }

      if (mia.ya_arranco && previoMes.current !== null && mia.mes > previoMes.current) {
        const nuevos = mia.mes - previoMes.current
        lanzarFlotante(nuevos * Number(mia.valor_unit))
      }
      if (mia.ya_arranco && previoBloques.current !== null && mia.bloques > previoBloques.current) {
        setFes({ dinero: mia.dinero, siguiente: mia.dinero_siguiente })
        confetti()
        setTimeout(() => setFes(null), 4500)
      }
      previoMes.current = mia.mes
      previoBloques.current = mia.bloques
      setF(mia)
    } catch { /* si falla, el chip simplemente no aparece: no estorba el cobro */ }
  }

  useEffect(() => {
    if (!user?.nombre) return
    cargar()
    // 05-sep-2026: 15s → 2min. Mismo motivo que AgrandadosView: es un acumulado
    // mensual y el realtime de abajo ya reacciona al comandar.
    const t = setInterval(cargar, 120000)
    // Realtime sobre la cola de cocina: al comandar un agrandado el chip
    // reacciona en el momento, sin esperar el polling.
    const canal = db.channel('agr_chip_' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pos_cocina_queue',
        filter: `store_code=eq.${user.store_code || ''}`,
      }, cargar)
      .subscribe()
    return () => { clearInterval(t); try { db.removeChannel(canal) } catch { /* ya cerrado */ } }
  }, [user?.nombre])

  function lanzarFlotante(monto) {
    const id = Math.random().toString(36).slice(2)
    setFlot(v => [...v, { id, monto }])
    setTimeout(() => setFlot(v => v.filter(x => x.id !== id)), 1500)
  }

  function confetti() {
    const cv = cvRef.current
    if (!cv) return
    cv.width = window.innerWidth; cv.height = window.innerHeight
    const cols = ['#22c55e', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa', '#ffffff']
    piezas.current = Array.from({ length: 140 }, () => ({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
      vx: (Math.random() - 0.5) * 2.6, vy: 2 + Math.random() * 3.6,
      w: 5 + Math.random() * 7, h: 8 + Math.random() * 8,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
      c: cols[Math.floor(Math.random() * cols.length)],
    }))
    if (!corriendo.current) { corriendo.current = true; requestAnimationFrame(pintar) }
  }
  function pintar() {
    const cv = cvRef.current
    if (!cv) { corriendo.current = false; return }
    const cx = cv.getContext('2d')
    cx.clearRect(0, 0, cv.width, cv.height)
    let vivas = 0
    for (const p of piezas.current) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.05
      if (p.y < cv.height + 30) vivas++
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot)
      cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore()
    }
    if (vivas > 0) requestAnimationFrame(pintar)
    else { corriendo.current = false; cx.clearRect(0, 0, cv.width, cv.height) }
  }

  if (!f) return null

  // Antes del arranque el chip existe pero apagado: la gente lo ve venir.
  if (!f.ya_arranco) {
    return (
      <span style={{
        background: '#2a2410', border: '1px solid #7a5c12', color: '#fbbf24',
        borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
      }} title="El incentivo de agrandados arranca el 1 de septiembre">
        💵 desde el 1 sep
      </span>
    )
  }

  const meta   = Number(f.meta_pct || 0)
  const actual = Number(f.tasa_actual || 0)
  const proy   = Number(f.proyeccion_tasa || 0)
  const proyectable = f.dia_del_mes >= 6 && proy > 0
  const llega  = proy >= meta
  const cierreMes = f.dia_del_mes >= f.dias_del_mes - 5

  return (
    <>
      <canvas ref={cvRef} style={{
        position: 'fixed', inset: 0, width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: 9998,
      }} />

      {festejo && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(6,20,10,0.94)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', padding: 20,
        }} onClick={() => setFes(null)}>
          <div style={{ fontSize: 56 }}>🎉</div>
          <div style={{ color: '#22c55e', fontSize: 18, fontWeight: 700, marginTop: 6 }}>
            ¡Cerraste otro bloque!
          </div>
          <div style={{ color: '#22c55e', fontSize: 74, fontWeight: 700, lineHeight: 1.05, margin: '8px 0' }}>
            {money(festejo.dinero)}
          </div>
          <div style={{ color: '#86efac', fontSize: 16 }}>Vas por los {money(festejo.siguiente)}</div>
        </div>
      )}

      <span style={{ position: 'relative', display: 'inline-flex' }}>
        {flotantes.map((x, i) => (
          <span key={x.id} style={{
            position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)',
            color: '#22c55e', fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap',
            pointerEvents: 'none', zIndex: 9997,
            animation: 'agrSube 1.5s cubic-bezier(.22,.7,.3,1) forwards',
            animationDelay: `${i * 0.09}s`,
          }}>
            +{money(x.monto)}
          </span>
        ))}

        <button
          onClick={() => setAb(v => !v)}
          title="Tus agrandados de este mes"
          style={{
            background: '#0e2a17', border: '1px solid #22c55e', color: '#22c55e',
            borderRadius: 6, padding: '2px 9px', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
          }}>
          💵 {money(f.dinero)}
          <span style={{ color: '#86efac', fontWeight: 400, marginLeft: 6 }}>
            {f.resto}/{f.bloque_tam}
          </span>
        </button>
      </span>

      {abierto && (
        <div onClick={() => setAb(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9996,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#141416', border: '1px solid #2a2a32', borderRadius: 14,
            padding: 18, width: 'min(420px, 92vw)', color: '#f0f0f2',
            fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <b style={{ fontSize: 16 }}>Tus agrandados</b>
              <span style={{ color: '#8a8a92', fontSize: 12 }}>{f.sucursal}</span>
            </div>

            <div style={{ background: '#0e2a17', borderRadius: 11, padding: 16, marginBottom: 11 }}>
              <div style={{ color: '#86efac', fontSize: 13 }}>Llevás ganado este mes</div>
              <div style={{ color: '#22c55e', fontSize: 52, fontWeight: 700, lineHeight: 1.05, margin: '2px 0 4px' }}>
                {money(f.dinero)}
              </div>
              <div style={{ color: '#86efac', fontSize: 13 }}>
                {Number(f.mes).toLocaleString('es')} agrandados · {f.bloques} bloque{f.bloques === 1 ? '' : 's'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 11 }}>
              <div style={{ flex: 1, background: '#1a1a1c', borderRadius: 11, padding: 13 }}>
                <div style={{ color: '#8a8a92', fontSize: 12 }}>
                  {cierreMes ? 'Tenés asegurado' : 'Si seguís así'}
                </div>
                <div style={{ fontSize: 27, fontWeight: 700, margin: '2px 0' }}>
                  {money(cierreMes ? f.dinero : f.proyeccion_dinero)}
                </div>
                <div style={{ color: '#8a8a92', fontSize: 12 }}>
                  {cierreMes ? 'no lo dejés ir' : 'al cerrar el mes'}
                </div>
              </div>
              <div style={{ flex: 1, background: '#1a1a1c', borderRadius: 11, padding: 13 }}>
                <div style={{ color: '#8a8a92', fontSize: 12 }}>Sumaste hoy</div>
                <div style={{ color: '#60a5fa', fontSize: 27, fontWeight: 700, margin: '2px 0' }}>
                  ${(f.hoy * Number(f.valor_unit)).toFixed(2)}
                </div>
                <div style={{ color: '#8a8a92', fontSize: 12 }}>{f.hoy} agrandados</div>
              </div>
            </div>

            <div style={{ background: '#1a1a1c', borderRadius: 11, padding: 14, marginBottom: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>
                  {f.faltan} más y son <span style={{ color: '#22c55e' }}>{money(f.dinero_siguiente)}</span>
                </span>
                <span style={{ color: '#8a8a92', fontSize: 12 }}>{f.resto} de {f.bloque_tam}</span>
              </div>
              <div style={{ background: '#0d0d0f', borderRadius: 99, height: 20, overflow: 'hidden' }}>
                <div style={{ background: '#22c55e', height: '100%', borderRadius: 99,
                              width: `${(f.resto / f.bloque_tam) * 100}%`, transition: 'width .4s' }} />
              </div>
            </div>

            <div style={{ background: '#1a1a1c', borderRadius: 11, padding: 14, marginBottom: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Tu meta del mes</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{actual}%</span>
              </div>
              <div style={{ background: '#0d0d0f', borderRadius: 99, height: 20, overflow: 'hidden', position: 'relative' }}>
                {proyectable && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 99,
                    width: `${Math.min(100, (proy / Math.max(meta * 1.35, 1)) * 100)}%`,
                    background: llega ? 'rgba(34,197,94,.30)' : 'rgba(248,113,113,.32)',
                  }} />
                )}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99,
                              width: `${Math.min(100, (actual / Math.max(meta * 1.35, 1)) * 100)}%`, background: '#22c55e' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: '#fbbf24',
                              left: `${Math.min(100, (meta / Math.max(meta * 1.35, 1)) * 100)}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5 }}>
                <span style={{ color: '#8a8a92' }}>
                  mes pasado {f.mes_anterior_tasa != null ? `${f.mes_anterior_tasa}%` : '—'}
                </span>
                <span style={{ color: '#fbbf24' }}>meta {meta}%</span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 8, color: proyectable ? (llega ? '#86efac' : '#f87171') : '#8a8a92' }}>
                {proyectable
                  ? <>A tu ritmo de esta semana cerrás en <b>{proy}%</b>{llega ? ' — arriba de la meta' : ` — te faltan ${(meta - proy).toFixed(1)} puntos`}</>
                  : `Con ${f.dia_del_mes} día${f.dia_del_mes === 1 ? '' : 's'} todavía no se puede proyectar bien.`}
              </div>
            </div>

            {f.mejor_dia > 0 && (
              <div style={{ background: '#1a1a1c', borderRadius: 11, padding: 13,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Tu mejor día fue {f.mejor_dia}</div>
                  <div style={{ color: '#8a8a92', fontSize: 12, marginTop: 2 }}>
                    {f.hoy >= f.mejor_dia ? '¡Hoy lo igualaste o lo superaste!' : `hoy vas ${f.hoy}`}
                  </div>
                </div>
                <div style={{ color: '#fbbf24', fontSize: 24 }}>★</div>
              </div>
            )}

            <button onClick={() => setAb(false)} style={{
              marginTop: 12, width: '100%', background: '#26262e', color: '#f0f0f2',
              border: 'none', borderRadius: 9, padding: 11, fontSize: 14, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>Cerrar</button>
          </div>
        </div>
      )}

      <style>{`@keyframes agrSube{
        0%{transform:translate(-50%,0) scale(.85);opacity:0}
        18%{transform:translate(-50%,-14px) scale(1.15);opacity:1}
        70%{opacity:1}
        100%{transform:translate(-50%,-58px) scale(1);opacity:0}
      }`}</style>
    </>
  )
}
