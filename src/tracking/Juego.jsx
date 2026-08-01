// ────────────────────────────────────────────────────────────────────
// Zona de juego de la pantalla de espera (Fase 7).
// Juego + guardar marca + leaderboard diario/mensual + compartir en redes.
// El mejor del día gana un combo (se valida antes de premiar).
// ────────────────────────────────────────────────────────────────────
import { useEffect, useState, Suspense } from 'react'
import { db } from '../supabase'
import { JUEGOS, juegoPorId } from './juegos'
import { PERSONAJES } from './juegos/FreakiesCarreritas'

const ALIAS_KEY = 'freakie_juego_alias'
const PERSONAJE_KEY = 'freakie_juego_personaje'

export default function Juego({ trackingToken, numeroOrden }) {
  const [juegoId] = useState(JUEGOS[0].id)
  const [jugando, setJugando] = useState(false)
  const [partida, setPartida] = useState(0)      // key para reiniciar
  const [score, setScore] = useState(0)
  const [final, setFinal] = useState(null)       // marca de la partida terminada
  const [inicio, setInicio] = useState(0)
  const [alias, setAlias] = useState(() => localStorage.getItem(ALIAS_KEY) || '')
  const [personaje, setPersonaje] = useState(() => localStorage.getItem(PERSONAJE_KEY) || 'hotdog')
  const [guardado, setGuardado] = useState(null)
  const [tab, setTab] = useState('dia')
  const [lb, setLb] = useState(null)

  const juego = juegoPorId(juegoId)

  const cargarLb = () => db.rpc('juego_leaderboard', { p_juego: juegoId, p_limite: 8 })
    .then(({ data }) => setLb(data || { dia: [], mes: [] }))
  useEffect(() => { cargarLb() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const elegirPersonaje = (id) => {
    setPersonaje(id)
    try { localStorage.setItem(PERSONAJE_KEY, id) } catch { /* modo privado */ }
  }

  const jugar = () => {
    setScore(0); setFinal(null); setGuardado(null)
    setInicio(Date.now()); setPartida(p => p + 1); setJugando(true)
  }

  const terminar = (s) => {
    const partida = { score: s, dur: Math.max(1, Math.round((Date.now() - inicio) / 1000)) }
    setFinal(partida)
    // Si ya nos dio su nombre antes, la marca se guarda sola: pedir un paso
    // extra hacía que casi nadie quedara en el ranking.
    if (alias.trim()) guardar(partida)
  }

  const guardar = async (partida) => {
    const p = partida || final
    if (!alias.trim() || !p) return
    try {
      localStorage.setItem(ALIAS_KEY, alias.trim())
      const { data, error } = await db.rpc('juego_guardar_score', {
        p_alias: alias.trim(), p_score: p.score, p_duracion_seg: p.dur,
        p_juego: juegoId, p_tracking_token: trackingToken || null,
      })
      if (error) throw error
      setGuardado(data)
      cargarLb()
    } catch (e) { setGuardado({ error: e.message || 'No se pudo guardar' }) }
  }

  const compartir = async () => {
    const txt = `¡Hice ${final?.score ?? score} puntos en HotDog Dash de Freakie Dogs! 🌭🎪 ¿Me superás?`
      + (numeroOrden ? `\nMi pedido: ${numeroOrden} @freakiedogs` : ' @freakiedogs')
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
          <p className="jg-reglas">
            Para participar por el combo del día o el premio del mes:
            <b> publicá tu marca, etiquetá a @freakiedogs e incluí tu número de pedido</b>
            {numeroOrden ? <> — el tuyo es <b className="jg-orden">{numeroOrden}</b></> : null} 📲
          </p>
        </div>
      </header>

      {!jugando ? (
        <div className="jg-inicio">
          <div className="jg-elige">¿Con quién corrés?</div>
          <div className="jg-personajes">
            {PERSONAJES.map(p => (
              <button key={p.id} onClick={() => elegirPersonaje(p.id)}
                className={`jg-personaje${personaje === p.id ? ' on' : ''}`}>
                <span className="jg-personaje-em">{p.emoji}</span>
                <span className="jg-personaje-nom">{p.nombre}</span>
              </button>
            ))}
          </div>
          <button className="jg-play" onClick={jugar}>▶︎ Jugar mientras esperás</button>
        </div>
      ) : (
        <div className="jg-box">
          <Suspense fallback={<div className="jg-load">Cargando…</div>}>
            <juego.Comp key={`${partida}-${personaje}`} personaje={personaje} onScore={setScore} onGameOver={terminar} />
          </Suspense>
          {!final && <div className="jg-hint">Tocá la pantalla para saltar</div>}

          {final && (
            <div className="jg-fin">
              {!guardado ? (
                <>
                  <div className="jg-fin-t">Hiciste <b>{final.score}</b></div>
                  <div className="jg-fin-sub">Poné tu nombre para entrar al ranking 🏆</div>
                  <div className="jg-fin-row">
                    <input value={alias} onChange={e => setAlias(e.target.value.slice(0, 20))}
                      placeholder="Tu nombre" className="jg-input" autoFocus />
                    <button className="jg-btn" onClick={() => guardar()} disabled={!alias.trim()}>Guardar</button>
                  </div>
                </>
              ) : guardado.error ? (
                <div className="jg-err">{guardado.error}</div>
              ) : (
                <div className="jg-ok">
                  {guardado.revision
                    ? '✅ Marca guardada (en revisión)'
                    : <>🏅 ¡Quedaste <b>#{guardado.posicion_dia}</b> del día!
                        {guardado.numero_orden && <><br /><span className="jg-ok-nota">Publicá tu marca con <b>{guardado.numero_orden}</b> y @freakiedogs para reclamar</span></>}
                      </>}
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
                <span className="jg-alias">
                  {r.alias}
                  {r.pedido && <span className="jg-ped">{r.pedido}</span>}
                </span>
                <span className="jg-score">{r.score}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="jg-premio">
          {tab === 'dia' ? 'El #1 de hoy se gana un combo 🌭' : 'La mejor marca del mes se lleva el premio grande 🎁'}
          <br />El posteo tiene que llevar <b>tu número de pedido</b> y etiquetar a <b>@freakiedogs</b>; sin eso no cuenta.
        </div>
      </div>
    </section>
  )
}
