import { useState, useEffect } from 'react'

/**
 * Confirmación in-app (promise-based) que reemplaza a window.confirm().
 *
 * ¿Por qué existe? window.confirm() NO funciona dentro del WebView de la APK
 * Android (Fire tablet, Venecia): en modo kiosk el diálogo nativo no se muestra
 * y confirm() devuelve `false`, cancelando la acción sin ningún aviso (p. ej. el
 * corte Z "no dejaba" cerrar). Este modal se renderiza en el DOM, así que funciona
 * igual en la APK y en el navegador.
 *
 * Uso:
 *   import { confirmAsync } from '.../confirmDialog'
 *   if (!(await confirmAsync('¿Seguro?', { title, confirmText, danger: true }))) return
 *
 * Requiere que <ConfirmHost/> esté montado una vez en la raíz (ver pos-main.jsx).
 */

let _open = null // setter registrado por ConfirmHost

export function confirmAsync(message, opts = {}) {
  return new Promise((resolve) => {
    if (typeof _open !== 'function') {
      // Fallback defensivo: si el host no está montado, usa el confirm nativo.
      try { resolve(window.confirm(message)) } catch { resolve(true) }
      return
    }
    _open({ message, resolve, ...opts })
  })
}

export function ConfirmHost() {
  const [req, setReq] = useState(null)

  useEffect(() => {
    _open = (r) => setReq(r)
    return () => { _open = null }
  }, [])

  useEffect(() => {
    if (!req) return
    const onKey = (e) => {
      if (e.key === 'Escape') { req.resolve(false); setReq(null) }
      else if (e.key === 'Enter') { req.resolve(true); setReq(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])

  if (!req) return null
  const done = (v) => { req.resolve(v); setReq(null) }
  const { message, title = 'Confirmar', confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false } = req

  return (
    <div onClick={() => done(false)} style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.62)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 360, background: '#1c1c22', border: '1px solid #332b27',
        borderRadius: 14, padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: '#f3efe9', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 14, color: '#c9c3bb', lineHeight: 1.5, whiteSpace: 'pre-line', marginBottom: 18 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => done(false)} style={{
            padding: '10px 16px', borderRadius: 9, border: '1px solid #3a3a44',
            background: 'transparent', color: '#c9c3bb', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>{cancelText}</button>
          <button onClick={() => done(true)} autoFocus style={{
            padding: '10px 18px', borderRadius: 9, border: 'none',
            background: danger ? '#dc3545' : '#E62329', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}
