import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SCHEMA = (import.meta.env.VITE_SUPABASE_SCHEMA as string) || 'kaeru';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase env vars. Copia .env.example a .env y completa los valores.'
  );
}

if (SCHEMA !== 'kaeru') {
  console.warn(
    '⚠️ VITE_SUPABASE_SCHEMA distinto de "kaeru". Verifica que NO estés apuntando al schema public de Freakies.'
  );
}

/**
 * Cliente Supabase aislado al schema `kaeru`.
 * Todas las queries pasan por header `Accept-Profile: kaeru` (postgrest).
 * NUNCA usar `.schema('public')` — eso es Freakies y está prohibido por la regla del proyecto.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: SCHEMA },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

/** Helper para asegurarse que una query va al schema correcto. */
export const kaeru = supabase;
