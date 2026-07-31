// ────────────────────────────────────────────────────────────────────
// Subir foto de un ítem del menú.
// La imagen se comprime EN EL NAVEGADOR (900 px, JPEG ~0.74) antes de
// viajar, así se sube ~150 KB en vez de los 3-5 MB que saca un celular.
// La carga va por la edge function `menu-foto`, que valida la sesión de
// staff (PIN) y escribe con permisos de servidor: el bucket sigue cerrado
// a la anon key pública.
// ────────────────────────────────────────────────────────────────────
import { useRef, useState } from 'react'
import { db, URL_SB_DIRECT } from '../../supabase'

const TOKEN_KEY = 'freakie_torre_token'
const MAX_LADO = 900
const CALIDAD = 0.74

async function comprimir(file) {
  // PNG con transparencia: se deja tal cual (convertir a JPEG le pone fondo negro)
  const bitmap = await createImageBitmap(file)
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * escala), h = Math.round(bitmap.height * escala)
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  if (file.type !== 'image/png') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) }
  ctx.drawImage(bitmap, 0, 0, w, h)
  const tipo = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise(r => cv.toBlob(r, tipo, CALIDAD))
  bitmap.close?.()
  return new File([blob], file.name.replace(/\.\w+$/, tipo === 'image/png' ? '.png' : '.jpg'), { type: tipo })
}

export default function SubirFotoItem({ itemId, onSubida, C }) {
  const input = useRef(null)
  const [estado, setEstado] = useState('')   // '', 'subiendo', 'ok', 'error'
  const [msg, setMsg] = useState('')
  const [pidePin, setPidePin] = useState(false)
  const [pin, setPin] = useState('')
  const pendiente = useRef(null)

  const subir = async (file, token) => {
    setEstado('subiendo'); setMsg('Optimizando…')
    try {
      const chico = await comprimir(file)
      setMsg(`Subiendo ${Math.round(chico.size / 1024)} KB…`)
      const fd = new FormData()
      fd.append('token', token); fd.append('item_id', itemId); fd.append('file', chico)
      const r = await fetch(`${URL_SB_DIRECT}/functions/v1/menu-foto`, { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo subir')
      setEstado('ok'); setMsg('Foto actualizada')
      onSubida?.(data.url)
    } catch (e) {
      setEstado('error'); setMsg(e.message || 'No se pudo subir')
    }
  }

  const elegir = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { pendiente.current = file; setPidePin(true); return }
    subir(file, token)
  }

  const entrar = async () => {
    try {
      const { data, error } = await db.rpc('staff_login', { p_pin: pin })
      if (error) throw error
      localStorage.setItem(TOKEN_KEY, data.token)
      setPidePin(false); setPin('')
      if (pendiente.current) { subir(pendiente.current, data.token); pendiente.current = null }
    } catch (e) { setMsg(e.message || 'PIN incorrecto'); setEstado('error') }
  }

  const color = estado === 'ok' ? (C?.teal || '#4ade80') : estado === 'error' ? (C?.danger || '#e63946') : (C?.muted || '#888')

  return (
    <div style={{ marginTop: 8 }}>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={elegir} style={{ display: 'none' }} />

      {!pidePin ? (
        <button type="button" onClick={() => input.current?.click()} disabled={estado === 'subiendo' || !itemId}
          title={itemId ? 'Subir una foto para este ítem' : 'Guardá el ítem primero'}
          style={{
            padding: '9px 14px', borderRadius: 8, border: `1px solid ${C?.border || '#333'}`,
            background: C?.surface || '#1e1e1e', color: C?.text || '#f0f0f0',
            fontSize: 13, fontWeight: 600, cursor: itemId ? 'pointer' : 'not-allowed', opacity: itemId ? 1 : .5,
          }}>
          {estado === 'subiendo' ? '⏳ ' + msg : '📷 Subir foto'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="password" inputMode="numeric" value={pin} autoFocus placeholder="Tu PIN"
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && entrar()}
            style={{ width: 110, padding: '9px 10px', borderRadius: 8, border: `1px solid ${C?.border || '#333'}`,
                     background: C?.surface || '#1e1e1e', color: C?.text || '#f0f0f0', fontSize: 14, textAlign: 'center' }} />
          <button type="button" onClick={entrar} disabled={pin.length < 3}
            style={{ padding: '9px 12px', borderRadius: 8, border: 'none', background: C?.accent || '#e63946',
                     color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Entrar</button>
          <button type="button" onClick={() => { setPidePin(false); pendiente.current = null }}
            style={{ padding: '9px 10px', borderRadius: 8, border: 'none', background: '#333', color: '#aaa', fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
        </div>
      )}

      {msg && estado !== 'subiendo' && (
        <div style={{ fontSize: 11.5, color, marginTop: 5 }}>{estado === 'ok' ? '✓ ' : estado === 'error' ? '⚠️ ' : ''}{msg}</div>
      )}
    </div>
  )
}
