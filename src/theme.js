/**
 * Freakie Dogs ERP — Theme tokens (Fuente única de verdad para JS)
 * ─────────────────────────────────────────────────────────────────
 *
 * Este módulo consolida las 4-5 paletas hardcoded que vivían dispersas
 * en `const C = {...}`, `const T = {...}`, `const c = {...}` en cada
 * componente. Ahora todos importan desde `@/theme`.
 *
 * Estrategia (24-May-2026):
 *   1. `tokens` → canónica, basada en CSS variables oklch de global.css.
 *      Para usar en componentes NUEVOS o cuando se migre className.
 *   2. `paletaC`, `paletaT`, `paletaRRHH`, `paletaSim` → shims que
 *      reproducen EXACTAMENTE los hex literales de las paletas legacy
 *      con sus keys originales. Los componentes solo cambian el
 *      `const C = {...}` por `import { paletaC as C } from '@/theme'`.
 *      CERO cambios visuales (los hex son los mismos).
 *
 * Migración futura (FUERA de scope de esta sesión):
 *   - 186 ocurrencias hardcoded de `#e63946` en 51 archivos → `var(--primary)`
 *   - Otras paletas hardcoded en archivos no priorizados
 *   - Eventualmente colapsar paletas legacy en `tokens` canónica
 *
 * Mapeo CSS variables → propósito (global.css:5-31):
 *   --background           oklch(0.09 0 0)        Fondo app (gris muy oscuro)
 *   --foreground           oklch(0.88 0 0)        Texto principal
 *   --card                 oklch(0.14 0 0)        Cards
 *   --card-foreground      oklch(0.88 0 0)        Texto en cards
 *   --popover              oklch(0.14 0 0)        Popovers
 *   --popover-foreground   oklch(0.88 0 0)
 *   --primary              oklch(0.57 0.21 24)    Rojo Freakie ≈ #e63946
 *   --primary-foreground   oklch(1 0 0)           Blanco
 *   --secondary            oklch(0.22 0 0)        Gris medio
 *   --secondary-foreground oklch(0.82 0 0)
 *   --muted                oklch(0.18 0 0)        Gris atenuado
 *   --muted-foreground     oklch(0.55 0 0)        Texto atenuado
 *   --accent               oklch(0.22 0 0)        = secondary
 *   --accent-foreground    oklch(0.82 0 0)
 *   --destructive          oklch(0.57 0.21 24)    = primary (rojo)
 *   --destructive-foreground oklch(1 0 0)
 *   --border               oklch(0.26 0 0)        Bordes
 *   --input                oklch(0.22 0 0)        Inputs
 *   --ring                 oklch(0.57 0.21 24)    Focus ring (rojo)
 *   --success              oklch(0.62 0.19 145)   Verde
 *   --warning              oklch(0.75 0.18 75)    Amarillo
 *   --info                 oklch(0.65 0.18 230)   Azul
 */

// ─────────────────────────────────────────────────────────────────
// 1. TOKENS CANÓNICOS (para código nuevo / migración futura)
// ─────────────────────────────────────────────────────────────────
//
// Acceso a CSS variables como strings, para usar en `style={{ ... }}`.
// Las variables siguen vivas en global.css; este módulo es un puente
// para componentes que aún no migraron a className/Tailwind.
export const tokens = {
  bg:         'var(--background)',
  surface:    'var(--card)',
  popover:    'var(--popover)',
  text:       'var(--foreground)',
  textMuted:  'var(--muted-foreground)',
  primary:    'var(--primary)',           // rojo Freakie ≈ #e63946
  accent:     'var(--accent)',
  secondary:  'var(--secondary)',
  muted:      'var(--muted)',
  success:    'var(--success)',
  warning:    'var(--warning)',
  info:       'var(--info)',
  danger:     'var(--destructive)',
  border:     'var(--border)',
  input:      'var(--input)',
  ring:       'var(--ring)',
}

// Alias genérico para código nuevo que quiera usar `C` o `T` con tokens.
// NO usar en código legacy — los shapes son distintos. Usar paletas dedicadas.
export const C = tokens
export const T = tokens

// ─────────────────────────────────────────────────────────────────
// 2. PALETAS LEGACY (shims compat — cero cambios visuales)
// ─────────────────────────────────────────────────────────────────
//
// Cada paleta reproduce el shape EXACTO que usaba el componente legacy,
// con los MISMOS valores hex. Esto permite migrar archivo-a-archivo
// sin tocar el resto del componente — solo cambia el `const X = {...}`
// por `import { paletaX as X } from '@/theme'`.
//
// La consolidación visual (unificar rojos, fondos, etc.) queda para
// una sesión futura con QA visual completo.

/**
 * paletaC — usada en:
 *   - components/finanzas/DTEsView.jsx (era `const C`)
 *   - components/finanzas/FinanzasDashboard.jsx (era `const C`)
 *
 * Brand colors estilo "fintech oscuro azulado".
 * NOTA: DTEsView agrega `pink` al final; FinanzasDashboard no.
 * Se incluye `pink` aquí para que ambos compartan el mismo objeto.
 */
export const paletaC = {
  red:        '#e63946',
  redDark:    '#b91c2c',
  redBg:      '#fef2f2',
  green:      '#2d6a4f',
  greenLight: '#4ade80',
  greenBg:    '#f0fdf4',
  dark:       '#1a1a2e',
  card:       '#16213e',
  cardAlt:    '#0f3460',
  gold:       '#f4a261',
  goldBg:     '#fffbeb',
  blue:       '#3b82f6',
  blueBg:     '#eff6ff',
  gray:       '#6b7280',
  grayLight:  '#f3f4f6',
  border:     '#334155',
  white:      '#fff',
  textMuted:  '#94a3b8',
  pink:       '#ec4899',
}

/**
 * paletaT — usada en:
 *   - components/admin/RentabilidadView.jsx (era `const T`)
 *
 * Theme "Fintech v2" — slate/blue oscuro.
 */
export const paletaT = {
  bg:           '#0B0F1A',
  bgCard:       '#111827',
  bgHover:      '#1A2234',
  bgSurface:    '#1E293B',
  border:       '#1E293B',
  borderLight:  '#334155',
  text:         '#F1F5F9',
  textSec:      '#94A3B8',
  textMuted:    '#64748B',
  accent:       '#3B82F6',
  accentLight:  '#60A5FA',
  green:        '#10B981',
  greenBg:      'rgba(16,185,129,0.1)',
  red:          '#EF4444',
  redBg:        'rgba(239,68,68,0.1)',
  yellow:       '#F59E0B',
  yellowBg:     'rgba(245,158,11,0.1)',
  purple:       '#8B5CF6',
}

/**
 * paletaRRHH — usada en:
 *   - components/admin/RRHHView.jsx (era `const C`)
 *
 * Paleta básica gris/rojo, consistente con global.css body.
 */
export const paletaRRHH = {
  bg:       '#111',
  bgCard:   '#1a1a1a',
  bgInput:  '#222',
  red:      '#e63946',
  green:    '#4ade80',
  yellow:   '#f59e0b',
  blue:     '#3b82f6',
  border:   '#2a2a2a',
  text:     '#eee',
  textDim:  '#666',
}

/**
 * paletaSim — usada en:
 *   - components/admin/SimuladorRentabilidad.jsx (era `const c`)
 *
 * Paleta extendida con multi-color para escenarios diferenciados.
 */
export const paletaSim = {
  bg:         '#0a0a0a',
  card:       '#1a1a1a',
  cardBorder: '#2a2a2a',
  input:      '#1e1e1e',
  red:        '#e63946',
  green:      '#4ade80',
  greenDark:  '#2d6a4f',
  yellow:     '#fbbf24',
  orange:     '#f97316',
  blue:       '#60a5fa',
  purple:     '#a78bfa',
  pink:       '#ec4899',
  cyan:       '#22d3ee',
  border:     '#333',
  text:       '#f0f0f0',
  textDim:    '#888',
  textOff:    '#555',
}

// Default export — útil para imports más cortos en código nuevo.
export default tokens
