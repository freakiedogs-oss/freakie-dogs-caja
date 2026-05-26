/**
 * Placeholder de types Supabase del schema `kaeru`.
 *
 * Para generar el archivo real con todos los tipos, correr LOCALMENTE:
 *
 *   npx supabase login
 *   npm run types
 *
 * Equivale a:
 *   supabase gen types typescript --project-id btboxlwfqcbrdfrlnwln --schema kaeru > src/types/supabase.ts
 *
 * Esto producirá ~10K líneas con tipos exactos de las 40 tablas + 10 vistas.
 *
 * IMPORTANTE: nunca generar con --schema public — eso es Freakies y no debe estar acá.
 */

export type Database = {
  kaeru: {
    Tables: Record<string, { Row: any; Insert: any; Update: any }>;
    Views: Record<string, { Row: any }>;
    Functions: Record<string, any>;
    Enums: { tipo_dte_enum: 'factura' | 'ccf' | 'nota_credito' | 'pre_dte' };
  };
};
