import { createContext, useContext, useEffect, useState } from 'react'

/* ═══════════════════════════════════════════════════════════════════════
   BPM Chili · tema visual

   Hasta el 23-sep-2026 el control BPM tenía un solo aspecto: la pantalla
   oscura de la piloto. Con la «versión Mauricio» (FD-CI-DO-013-A01,
   especificación de pantallas) conviven dos formatos:

     oscuro → la piloto, tal como la usa Casa Matriz hoy. No se toca.
     claro  → el formato del anexo A01: fondo crema, tarjetas blancas,
              títulos en serif, barra de aplicación con la marca, riel de
              pasos, franja de criterio de aceptación, filas
              «etiqueta · control · resultado» y una sola acción al pie.

   Los componentes no llevan colores escritos: piden el tema con
   useTema() y arman sus estilos desde ahí. Así la piloto sigue igual y
   la v2 se ve como el anexo sin duplicar la lógica.
   ═══════════════════════════════════════════════════════════════════════ */

export const TEMAS = {
  oscuro: {
    nombre: 'oscuro',
    bg: '#0f0f10', card: '#1a1a1c', sub: '#101012', line: '#2a2a2e', txt: '#f0f0f2',
    dim: '#8a8a92', ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', acc: '#3b82f6',
    inputBg: '#141416',
    okBg: '#0e1f14', okTxt: '#86efac', badBg: '#3a1414', badTxt: '#fca5a5',
    warnBg: '#3a2f0f', warnTxt: '#fcd34d', infoBg: '#101c2a', infoTxt: '#bfdbfe',
    neutroBg: '#2a2a2e', neutroTxt: '#c9c9cf',
    fontTitulo: 'inherit', fontBase: 'inherit',
    primario: '#22c55e', primarioTxt: '#fff',
  },
  // Tokens del anexo: --role-* (marca) y --semantic-* (fijos). Los HEX se
  // tomaron de las maquetas all_screens (p01…p17, s01, q1, m3).
  claro: {
    nombre: 'claro',
    bg: '#f7f6f2', card: '#ffffff', sub: '#ffffff', line: '#e3e1db', txt: '#1f1f1f',
    dim: '#6b6b6b', ok: '#2e6b4a', warn: '#8a6d1c', bad: '#8b1a1a', acc: '#2a5a8c',
    inputBg: '#ffffff',
    okBg: '#e4ece6', okTxt: '#2e6b4a', badBg: '#f3dcdc', badTxt: '#8b1a1a',
    warnBg: '#f4ead6', warnTxt: '#8a6d1c', infoBg: '#dfe8f0', infoTxt: '#2a5a8c',
    neutroBg: '#e8e8e4', neutroTxt: '#4a4a4a',
    barra: '#1f1f1f', marca: '#e21b1b',
    fontTitulo: "'Source Serif 4', Georgia, 'Times New Roman', serif",
    fontBase: "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    primario: '#1f1f1f', primarioTxt: '#fff',
  },
}

const Ctx = createContext(TEMAS.oscuro)
export const TemaBPM = Ctx.Provider
export const useTema = () => useContext(Ctx)

// Las fuentes del anexo (Montserrat para texto, Source Serif para títulos)
// se piden a Google Fonts una sola vez, y solo cuando se abre la v2.
let fuentesPedidas = false
export function useFuentesClaras(activo) {
  useEffect(() => {
    if (!activo || fuentesPedidas || typeof document === 'undefined') return
    fuentesPedidas = true
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,500;0,600;0,700;0,800;1,900&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap'
    document.head.appendChild(l)
  }, [activo])
}

// Estilos base que comparten los controles. Se calculan por tema.
export function estilos(T) {
  const claro = T.nombre === 'claro'
  return {
    claro,
    box: claro
      ? { background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }
      : { background: T.sub, border: `1px solid ${T.line}`, borderRadius: 11, padding: 13, marginBottom: 12 },
    h: claro
      ? { fontSize: 17, fontWeight: 700, marginBottom: 6, color: T.txt, fontFamily: T.fontTitulo, display: 'flex', alignItems: 'center', gap: 8 }
      : { fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: T.txt },
    ayuda: { fontSize: claro ? 13 : 12.5, color: T.dim, lineHeight: 1.5, marginBottom: 10 },
    // Fila «etiqueta · control · resultado» del anexo. En el tema oscuro es la fila de siempre.
    fila: claro
      ? { display: 'flex', gap: 12, alignItems: 'center', padding: '11px 0', borderTop: `1px solid ${T.line}`, fontSize: 15, flexWrap: 'wrap' }
      : { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${T.line}`, fontSize: 13.5 },
    inp: {
      background: T.inputBg, border: `1px solid ${claro ? '#8a8a8a' : T.line}`, color: T.txt,
      borderRadius: 8, padding: claro ? '11px 12px' : '9px 10px', fontSize: claro ? 16 : 15,
      width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', minHeight: claro ? 44 : undefined,
    },
    lbl: { fontSize: claro ? 13 : 12, color: T.dim, display: 'block', marginBottom: 4 },
    // Texto secundario debajo de la etiqueta (el «porqué» de la fila).
    porque: { fontSize: 12.5, color: T.dim, marginTop: 2, lineHeight: 1.4 },
  }
}

// Pastilla semántica: icono + texto + color, nunca solo color (WCAG 1.4.1).
export function Pill({ tipo = 'neutro', children, style }) {
  const T = useTema()
  const m = {
    ok:     [T.okBg, T.okTxt, '✓'],
    bad:    [T.badBg, T.badTxt, '✕'],
    warn:   [T.warnBg, T.warnTxt, '⚠'],
    info:   [T.infoBg, T.infoTxt, 'ⓘ'],
    espera: [T.neutroBg, T.neutroTxt, '○'],
    neutro: [T.neutroBg, T.neutroTxt, ''],
  }[tipo] || [T.neutroBg, T.neutroTxt, '']
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      background: m[0], color: m[1], borderRadius: 999, padding: '6px 13px',
      fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, ...style,
    }}>
      {m[2] && <span aria-hidden style={{ fontSize: 12 }}>{m[2]}</span>}{children}
    </span>
  )
}

// Ayuda contextual «?»: se abre con un toque y se cierra con otro, con
// Escape o al tocar fuera. No depende de pasar el cursor (tableta).
export function Ayuda({ texto, oscuro = false }) {
  const T = useTema()
  const [abierta, setAbierta] = useState(false)
  useEffect(() => {
    if (!abierta) return
    const cerrar = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; setAbierta(false) }
    document.addEventListener('keydown', cerrar)
    document.addEventListener('click', cerrar)
    return () => { document.removeEventListener('keydown', cerrar); document.removeEventListener('click', cerrar) }
  }, [abierta])
  if (!texto) return null
  return (
    <span style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button type="button" aria-label="Ayuda" aria-expanded={abierta}
        onClick={() => setAbierta(a => !a)}
        style={{
          width: 28, height: 28, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
          border: `1.5px solid ${oscuro || abierta ? T.txt : T.dim}`,
          background: oscuro || abierta ? T.txt : 'transparent',
          color: oscuro || abierta ? T.card : T.dim, fontSize: 14, fontWeight: 700, lineHeight: 1,
        }}>?</button>
      {abierta && (
        <div role="tooltip" style={{
          position: 'absolute', zIndex: 20, top: 34, left: 0, minWidth: 260, maxWidth: 'min(520px, 80vw)',
          background: '#1f1f1f', color: '#fff', borderRadius: 8, padding: '12px 14px',
          fontSize: 14, lineHeight: 1.5, fontWeight: 400, boxShadow: '0 6px 20px rgba(0,0,0,.25)',
          fontFamily: T.fontBase,
        }}>{texto}</div>
      )}
    </span>
  )
}

// Formato numérico es-SV del anexo: miles con coma, decimal con punto.
export function fmtNum(n, dec) {
  if (n === '' || n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return v.toLocaleString('en-US', {
    minimumFractionDigits: dec ?? 0,
    maximumFractionDigits: dec ?? (Number.isInteger(v) ? 0 : 2),
  })
}

// Mientras se escribe: solo dígitos, punto y signo; la coma está bloqueada.
// Se muestra con separador de miles y se guarda el número puro.
export function limpiarNumero(texto) {
  return String(texto ?? '').replace(/,/g, '').replace(/[^0-9.\-]/g, '')
}
export function mostrarNumero(texto) {
  const s = String(texto ?? '')
  if (s === '' || s === '-' ) return s
  const [ent, dec] = s.split('.')
  const neg = ent.startsWith('-')
  const digitos = ent.replace('-', '')
  const conMiles = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${conMiles}${dec !== undefined ? '.' + dec : ''}`
}
