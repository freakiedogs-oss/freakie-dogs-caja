/* global __BUILD_ID__ */
/**
 * versionGate.js — Candado de versión del POS.
 *
 * Problema que resuelve: una tablet fija (caja) que quedó con un bundle viejo
 * cacheado sigue operando con código obsoleto sin que nadie lo note. El 3-Ago-2026
 * eso hizo que Metro Centro (S006) imprimiera ~30 comandas que NUNCA se guardaron
 * (build viejo, sin el guardrail "no comandar sin caja").
 *
 * Cómo funciona: cada build hornea `__BUILD_ID__` (ver vite.config.js) y publica
 * `/version.json` (que no se cachea). En la pantalla de LOGIN — momento seguro,
 * antes de que nadie opere y sin carrito que perder — la app compara el id que
 * corre contra el del servidor. Si difieren, limpia caché + SW y recarga sola,
 * mostrando "Actualizando…". Solo actúa antes del login, jamás en medio de un cobro.
 *
 * Fail-open: sin internet o si /version.json no responde, NO bloquea (deja operar).
 */
import { useState, useEffect, useCallback, useRef } from 'react'

// Id horneado en este bundle. En dev (vite serve) también existe vía `define`.
export const RUNNING_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

// Corta bucles: si el CDN sirviera algo inconsistente, no recargamos sin fin.
const RELOAD_GUARD = 'fd_ver_reloads'
const MAX_RELOADS = 2

async function fetchLatestBuild() {
  // Cache-bust + no-store → siempre red, nunca del service worker.
  const r = await fetch('/version.json?ts=' + Date.now(), { cache: 'no-store' })
  if (!r.ok) return null
  const j = await r.json().catch(() => null)
  return (j && j.build) || null
}

async function hardUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* recargamos igual */ }
  const sep = location.search ? '&' : '?'
  window.location.replace(location.pathname + location.search + sep + '_v=' + Date.now())
}

/**
 * Hook del candado. Devuelve 'checking' | 'updating' | 'ok'.
 * Montalo SOLO en la pantalla de login (ver LoginGate en POSApp) para que la
 * recarga forzada nunca ocurra con una sesión operando.
 */
export function useVersionGate() {
  const [status, setStatus] = useState('checking')
  const started = useRef(false)

  const check = useCallback(async () => {
    // Build sin id (dev) → nunca bloquear.
    if (RUNNING_BUILD === 'dev') { setStatus('ok'); return }
    // Sin internet → fail-open: que puedan trabajar.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('ok'); return }

    let latest = null
    try { latest = await fetchLatestBuild() } catch { latest = null }
    if (!latest) { setStatus('ok'); return }              // sin respuesta → no bloquear

    if (latest === RUNNING_BUILD) {
      try { sessionStorage.removeItem(RELOAD_GUARD) } catch { /* modo privado */ }
      setStatus('ok'); return
    }

    // Hay versión nueva. Recargar, con tope anti-bucle.
    let n = 0
    try { n = parseInt(sessionStorage.getItem(RELOAD_GUARD) || '0', 10) || 0 } catch { /* modo privado */ }
    if (n >= MAX_RELOADS) { setStatus('ok'); return }     // nos rendimos: dejar operar
    try { sessionStorage.setItem(RELOAD_GUARD, String(n + 1)) } catch { /* modo privado */ }
    setStatus('updating')
    hardUpdate()
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    check()
    // Reintenta al volver el foco o al recuperar la conexión (siempre en login).
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', check)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', check)
    }
  }, [check])

  return status
}
