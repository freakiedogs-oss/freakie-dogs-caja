// ────────────────────────────────────────────────────────────────────
// Zona de juego de la pantalla de espera (Fase 7).
// Juego + guardar marca + leaderboard diario/mensual + compartir en redes.
// El mejor del día gana un combo (se valida antes de premiar).
// ────────────────────────────────────────────────────────────────────
import { useEffect, useState, Suspense } from 'react'
import { db } from '../supabase'
import { JUEGOS, juegoPorId } from './juegos'

const ALIAS_KEY = 'freakie_juego_alias'

export default function Juego({ trackingToken }) {
  const [juegoId] = useState(JUEGOS[0].id)
  const [jugando, setJugando] = useState(false)
  const [partida, setPartida] = useState(0)      // key para reiniciar
  const [score, setScore] = useState(0)
  const [final, setFinal] = useState(null)       // marca de la partida terminada
  const [inicio, setInicio] = useState(0)
  const [alias, setAlias] = useState(() => localStorage.getItem(ALIAS_KEY) || '')
  const [guardado, setGuardado] = useState(null)
  const [tab, setTab] = useState('dia')
  const [lb, setLb] = useState(null)

  const juego = juegoPorId(juegoId)

  const cargarLb = () => db.rpc('juego_leaderboard', { p_juego: juegoId, p_limite: 8 })
    .then(({ data }) => setLb(data || { dia: [], mes: [] }))
  useEffect(() => { cargarLb() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const jugar = () => {
    setScore(0); setFinal(null); setGuardado(null)
    setInicio(Date.now()); setPartida(p => p + 1); setJugando(true)
  }

  const terminar = (s) => {
    setFinal({ score: s, dur: Math.max(1, Math.round((Date.now() - inicio) / 1000)) })
  }

  const guardar = async () => {
    if (!alias.trim() || !final) return
    try {
      localStorage.setItem(ALIAS_KEY, alias.trim())
      const { data, error } = await db.rpc('juego_guardar_score', {
        p_alias: alias.trim(), p_score: final.score, p_duracion_seg: final.dur,
        p_juego: juegoId, p_tracking_token: trackingToken || null,
      })
      if (error) throw error
      setGuardado(data)
      cargarLb()
    } catch (e) { setGuardado({ error: e.message || 'No se pudo guardar' }) }
  }

  const compartir = async () => {
    const txt = `¡Hice ${final?.score ?? score} puntos en HotDog Dash de Freakie Dogs! 🌭🎪 ¿Me superás?`
    try {
      if (navigator.share) await navigator.share({ text: txt, url: location.origin + '/menu' })
      else { await navigator.clipboard.writeText(`${txt} ${location.origin}/menu`); alert('¡Copiado! Pegalo en tu historia 📲') }
    } catch { /* cancelado */ }
  }

  const lista = (lb?.[tab]) || []

  return (
    <section className="jg">
      <header className="jg-head">
        <div>
          <h2 className="jg-t">{juego.emoji} {juego.nombre}</h2>
          <p className="jg-s">{juego.tagline} · <b>la marca más alta del día gana un combo</b> 🏆</p>
        </div>
      </header>

      {!jugando ? (
        <button className="jg-play" onClick={jugar}>▶︎ Jugar mientras esperás</button>
      ) : (
        <div className="jg-box">
          <Suspense fallback={<div className="jg-load">Cargando…</div>}>
            <juego.Comp key={partida} onScore={setScore} onGameOver={terminar} />
          </Suspense>
          {!final && <div className="jg-hint">Tocá la pantalla para saltar</div>}

          {final && (
            <div className="jg-fin">
              {!guardado ? (
                <>
                  <div className="jg-fin-t">Marca: <b>{final.score}</b></div>
                  <div className="jg-fin-row">
                    <input value={alias} onChange={e => setAlias(e.target.value.slice(0, 20))}
                      placeholder="Tu nombre" className="jg-input" />
                    <button className="jg-btn" onClick={guardar} disabled={!alias.trim()}>Guardar</button>
                  </div>
                </>
              ) : guardado.error ? (
                <div className="jg-err">{guardado.error}</div>
              ) : (
                <div className="jg-ok">
                  {guardado.revision
                    ? '✅ Marca guardada (en revisión)'
                    : <>🏅 ¡Quedaste <b>#{guardado.posicion_dia}</b> del día!</>}
                </div>
              )}
              <div className="jg-fin-row">
                <button className="jg-btn ghost" onClick={jugar}>↻ Otra vez</button>
                <button className="jg-btn share" onClick={compartir}>📲 Publicá tu marca</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard */}
      <div className="jg-lb">
        <div className="jg-tabs">
          <button className={tab === 'dia' ? 'on' : ''} onClick={() => setTab('dia')}>Hoy</button>
          <button className={tab === 'mes' ? 'on' : ''} onClick={() => setTab('mes')}>Este mes</button>
        </div>
        {lista.length === 0 ? (
          <div className="jg-vacio">Todavía nadie jugó {tab === 'dia' ? 'hoy' : 'este mes'} — ¡sé el primero! 🌭</div>
        ) : (
          <ol className="jg-rank">
            {lista.map((r, i) => (
              <li key={i} className={i === 0 ? 'top' : ''}>
                <span className="jg-pos">{i === 0 ? '🏆' : i + 1}</span>
                <span className="jg-alias">{r.alias}</span>
                <span className="jg-score">{r.score}</span>
              </li>
            ))}
          </ol>
        )}
        {tab === 'dia' && <div className="jg-premio">El #1 de hoy se gana un combo 🌭 — mostrá tu marca en la tienda.</div>}
      </div>
    </section>
  )
}
