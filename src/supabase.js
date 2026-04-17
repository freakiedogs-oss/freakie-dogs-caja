import { createClient } from '@supabase/supabase-js'

// ── URL del backend ──
// Origen real de Supabase (útil para dev local y debugging)
export const URL_SB_DIRECT = 'https://btboxlwfqcbrdfrlnwln.supabase.co'

// URL que usa el cliente: en PROD siempre pasa por el proxy /api/sb
// de Vercel, para evitar bloqueos de DNS/ISPs que filtran *.supabase.co.
// En DEV local apuntamos directo.
const isBrowser = typeof window !== 'undefined'
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true

export const URL_SB =
  isBrowser && !isDev
    ? `${window.location.origin}/sb`
    : URL_SB_DIRECT

export const KEY_SB = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Ym94bHdmcWNicmRmcmxud2xuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjcyMzQsImV4cCI6MjA4OTU0MzIzNH0.NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4'

export const db = createClient(URL_SB, KEY_SB)
