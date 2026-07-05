import React, { useState } from 'react'
import { paletaC as C } from '@/theme'

/* InfoTip — ícono ⓘ con tooltip explicativo. Sin dependencias.
   Hover (desktop) o tap (móvil). El tooltip abre hacia abajo para
   no ser recortado por contenedores con overflow. */
export default function InfoTip({ text, width = 250 }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          cursor: 'help', marginLeft: 5, width: 14, height: 14, borderRadius: '50%',
          border: `1px solid ${C.blue}`, color: C.blue, fontSize: 10, fontWeight: 700,
          fontStyle: 'italic', lineHeight: 1, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', opacity: 0.85, fontFamily: 'Georgia, serif', userSelect: 'none',
        }}
      >i</span>
      {open && (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '150%', left: '50%', transform: 'translateX(-50%)',
            zIndex: 60, width, maxWidth: '70vw', background: C.dark, color: C.white,
            border: `1px solid ${C.gold}`, borderRadius: 8, padding: '8px 10px',
            fontSize: 11, fontWeight: 400, fontStyle: 'normal', lineHeight: 1.45,
            letterSpacing: 0, textTransform: 'none', textAlign: 'left', whiteSpace: 'normal',
            boxShadow: '0 6px 22px rgba(0,0,0,0.55)',
          }}
        >{text}</span>
      )}
    </span>
  )
}
