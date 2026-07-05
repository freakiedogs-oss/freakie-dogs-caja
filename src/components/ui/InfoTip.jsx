import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { paletaC as C } from '@/theme'

/* InfoTip — ícono ⓘ con tooltip explicativo. Sin dependencias externas.
   El globo se renderiza con un PORTAL a document.body y position:fixed,
   así NUNCA lo recorta un contenedor con overflow ni lo atrapa un
   ancestro con transform/filter. Hover (desktop) o tap (móvil). */
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
    setPos({ left, w, flipUp, top: r.bottom + 6, bottom: window.innerHeight - r.top + 6 })
  }, [width])

  const hide = useCallback(() => setPos(null), [])

  useEffect(() => {
    if (!pos) return
    const h = () => hide()
    window.addEventListener('scroll', h, true)
    window.addEventListener('resize', h)
    return () => { window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h) }
  }, [pos, hide])

  if (!text) return null

  const tooltip = pos && typeof document !== 'undefined' ? createPortal(
    <span
      style={{
        position: 'fixed', left: pos.left, width: pos.w, zIndex: 2147483647,
        top: pos.flipUp ? undefined : pos.top,
        bottom: pos.flipUp ? pos.bottom : undefined,
        background: C.dark, color: C.white, border: `1px solid ${C.gold}`,
        borderRadius: 8, padding: '8px 10px', fontSize: 11, fontWeight: 400,
        fontStyle: 'normal', lineHeight: 1.45, letterSpacing: 0, textTransform: 'none',
        textAlign: 'left', whiteSpace: 'normal', pointerEvents: 'none',
        boxShadow: '0 6px 22px rgba(0,0,0,0.6)',
      }}
    >{text}</span>,
    document.body
  ) : null

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
      {tooltip}
    </>
  )
}
