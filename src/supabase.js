import { createClient } from '@supabase/supabase-js'

// ── URL del backend ──
// Origen real de Supabase (útil para dev local y debugging)
export const URL_SB_DIRECT = 'https://btboxlwfqcbrdfrlnwln.supabase.co'

// Dominio propio de Supabase (Custom Domain: api.freakiedogs.com). Es la salida
// definitiva del proxy: mismo motivo de existir —un host que los ISPs de El
// Salvador no filtran— pero sin serverless en medio, así que no hereda el techo
// de ~25 s del runtime Edge, ni su límite de concurrencia, ni su incapacidad de
// hacer upgrade a WebSocket (ver abajo). Se activa seteando VITE_SB_URL en
// Vercel; vacía, todo sigue exactamente como hoy. El rollback es borrar la
// variable y redeployar.
const URL_SB_PROPIA =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SB_URL?.replace(/\/+$/, '')) || ''

// URL que usa el cliente: sin dominio propio, en PROD pasa por el proxy /api/sb
// de Vercel, para evitar bloqueos de DNS/ISPs que filtran *.supabase.co.
// En DEV local apuntamos directo.
const isBrowser = typeof window !== 'undefined'
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true

export const URL_SB =
  URL_SB_PROPIA ||
  (isBrowser && !isDev
    ? `${window.location.origin}/sb`
    : URL_SB_DIRECT)

// Solo el proxy rompe el WebSocket. Contra el dominio propio (o directo), el
// realtime viaja por el mismo host que el REST y no hace falta el swap de abajo.
const PASA_POR_PROXY = URL_SB.endsWith('/sb')

export const KEY_SB = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Ym94bHdmcWNicmRmcmxud2xuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjcyMzQsImV4cCI6MjA4OTU0MzIzNH0.NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4'

export const db = createClient(URL_SB, KEY_SB)

// ── El WebSocket de Realtime NO pasa por el proxy ──
// supabase-js arma la URL de realtime desde la misma base que el REST, así que
// al apuntar el cliente a /sb el websocket también se iba por ahí. El proxy
// corre en el runtime Edge de Vercel y su fetch() no sabe hacer upgrade a
// WebSocket: rechaza TODO intento de conexión. Verificado el 5-sep-2026 con el
// mismo handshake sobre HTTP/1.1:
//   directo a supabase.co  → 101 Switching Protocols
//   por /sb (proxy)        → 500
//
// Consecuencias que esto arrastraba: Realtime nunca funcionó en producción (los
// 9 canales de POS/KDS/delivery vivían del polling de respaldo) y, como
// supabase-js reintenta para siempre, se quemaban ~740 invocaciones fallidas
// del Edge cada 10 min (~107k/día). El 4-sep esa carga ayudó a saturar el proxy:
// 1,858 respuestas 504 en 10 minutos, incluido el registro de producción de
// Casa Matriz y 83 logins.
//
// Importa además porque 6730a1c bajó el polling del KDS de 8s a 25s dando por
// hecho que el realtime era la vía primaria. Sin esto, no lo era.
//
// El REST se queda en el proxy: eso es lo que esquiva el bloqueo de DNS a
// *.supabase.co de algunos ISPs de El Salvador. Si una red también bloquea el
// websocket, Realtime falla contra Supabase (ya no contra Vercel) y el polling
// de respaldo sigue cubriendo, igual que hoy.
if (PASA_POR_PROXY) {
  // Cliente aparte solo para quedarnos con su RealtimeClient, que sí queda
  // apuntado a supabase.co. `db.channel()` delega en `db.realtime`, así que
  // este swap arregla los 9 canales sin tocar ni un componente. Se hace al
  // cargar el módulo, antes de que nadie se suscriba: la conexión es perezosa.
  // storageKey propio + sin sesión persistida para no levantar un segundo
  // GoTrue que compita con el del cliente principal.
  const soloRealtime = createClient(URL_SB_DIRECT, KEY_SB, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-realtime-directo',
    },
  })
  db.realtime = soloRealtime.realtime
}
