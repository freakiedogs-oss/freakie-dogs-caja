import React, { useState, useRef, useCallback, useEffect } from 'react'
import { paletaC as C } from '@/theme'

/* InfoTip — ícono ⓘ con tooltip explicativo. Sin dependencias.
   Usa position:fixed calculado desde el rect del ícono, así NUNCA
   lo recorta un contenedor con overflow (tablas, sidebars, etc.).
   Funciona con hover (desktop) y tap (móvil). */
export default function InfoTip({ text, width = 260 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  const show = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const w = Math.min(width, window.innerWidth - 20)
    let left = r.left + r.width / 2 - w / 2
    left = Math.max(10, Math.min(left, window.innerWidth - w - 10))
    const flipUp = (window.innerHeight - r.bottom) < 140
    setPos({
      left, w, flipUp,
      top: r.bottom + 6,
      bottom: window.innerHeight - r.top + 6,
    })
  }, [width])

  const hide = useCallback(() => setPos(null), [])

  // cerrar al hacer scroll (el ícono se mueve, el tooltip fixed no)
  useEffect(() => {
    if (!pos) return
    const h = () => hide()
    window.addEventListener('scroll', h, true)
    return () => window.removeEventListener('scroll', h, true)
  }, [pos, hide])

  if (!text) return null
  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(e) => { e.stopPropagation(); pos ? hide() : show() }}
        style={{
          cursor: 'help', marginLeft: 5, width: 14, height: 14, borderRadius: '50%',
          border: `1px solid ${C.blue}`, color: C.blue, fontSize: 10, fontWeight: 700,
          fontStyle: 'italic', lineHeight: 1, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', opacity: 0.85, fontFamily: 'Georgia, serif',
          userSelect: 'none', verticalAlign: 'middle', flex: '0 0 auto',
        }}
      >i</span>
      {pos && (
        <span
          style={{
            position: 'fixed', left: pos.left, width: pos.w, zIndex: 99999,
            top: pos.flipUp ? undefined : pos.top,
            bottom: pos.flipUp ? pos.bottom : undefined,
            background: C.dark, color: C.white, border: `1px solid ${C.gold}`,
            borderRadius: 8, padding: '8px 10px', fontSize: 11, fontWeight: 400,
            fontStyle: 'normal', lineHeight: 1.45, letterSpacing: 0, textTransform: 'none',
            textAlign: 'left', whiteSpace: 'normal', pointerEvents: 'none',
            boxShadow: '0 6px 22px rgba(0,0,0,0.6)',
          }}
        >{text}</span>
      )}
    </>
  )
}
