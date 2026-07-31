// Botón "tomar del teléfono": muestra un QR que abre /foto?t=<token> en el celular.
// El celular sube la foto; este componente hace polling a storage y devuelve la URL por onFoto().
// Se usa en los egresos del corte (POS CierreTurno y ERP CierreForm) — resuelve el caso
// de la computadora sin cámara / la foto que está en el teléfono.
import { useEffect, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { db } from '../../supabase'
import { BUCKET_CIERRES } from '../../config'

export default function QrFotoUpload({ onFoto, disabled }) {
  const [token, setToken] = useState(null)
  const [qrImg, setQrImg] = useState('')
  const [received, setReceived] = useState(false)
  const timerRef = useRef(null)

  const start = () => {
    if (disabled) return
    const t = 'qr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const qr = qrcode(0, 'M')
    qr.addData(`${location.origin}/foto?t=${t}`)
    qr.make()
    setQrImg(qr.createDataURL(5, 2))
    setReceived(false)
    setToken(t)
  }
  const close = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setToken(null); setQrImg('')
  }

  useEffect(() => {
    if (!token) return
    // bucket público → detectamos la foto por su URL directa (sin list(), que anon no puede)
    const url = db.storage.from(BUCKET_CIERRES).getPublicUrl(`qr-uploads/${token}.jpg`).data.publicUrl
    timerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${url}?_=${Date.now()}`, { method: 'HEAD', cache: 'no-store' })
        if (res.ok) {
          clearInterval(timerRef.current)
          setReceived(true)
          onFoto && onFoto(url)
        }
      } catch { /* reintenta hasta que exista */ }
    }, 2500)
    return () => timerRef.current && clearInterval(timerRef.current)
  }, [token])

  const ghost = { padding: '10px 12px', borderRadius: 10, border: '1px solid #2a2a32', background: '#1c1c22', color: '#e8e6ef', fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', width: '100%', opacity: disabled ? 0.5 : 1 }

  if (!token) {
    return <button type="button" style={ghost} disabled={disabled} onClick={start}>📱 Tomar del teléfono</button>
  }
  return (
    <div style={{ border: '1px solid #2a2a32', borderRadius: 12, padding: 14, background: '#141418', textAlign: 'center' }}>
      {received ? (
        <div style={{ color: '#4ade80', fontWeight: 700, padding: '10px 0' }}>✓ Foto recibida del teléfono</div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: '#8b8997', marginBottom: 10 }}>Escaneá con el teléfono y tomá la foto</div>
          <img src={qrImg} alt="QR" style={{ width: 180, height: 180, background: '#fff', borderRadius: 8, padding: 6 }} />
          <div style={{ fontSize: 11.5, color: '#8b8997', marginTop: 8 }}>Esperando la foto…</div>
        </>
      )}
      <button type="button" style={{ ...ghost, marginTop: 10, width: 'auto', padding: '6px 14px' }} onClick={close}>Cerrar</button>
    </div>
  )
}
