// Página liviana para SUBIR UNA FOTO desde el teléfono (flujo QR de los egresos del corte).
// Se abre escaneando el QR que muestra el corte: /foto?t=<token>. La foto queda en
// storage bajo qr-uploads/<token>.jpg y el corte (abierto en la compu/tablet) la recoge.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { db } from '../supabase'
import { BUCKET_CIERRES } from '../config'

function App() {
  const token = new URLSearchParams(location.search).get('t') || ''
  const [status, setStatus] = useState(token ? 'ready' : 'notoken') // notoken | ready | uploading | done
  const [err, setErr] = useState('')

  const onPick = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file || !token) return
    setStatus('uploading'); setErr('')
    try {
      const { error } = await db.storage.from(BUCKET_CIERRES).upload(
        `qr-uploads/${token}.jpg`, file,
        { cacheControl: '3600', upsert: true, contentType: file.type || 'image/jpeg' }
      )
      if (error) throw error
      setStatus('done')
    } catch (e2) { setErr(e2.message || 'No se pudo subir'); setStatus('ready') }
  }

  const wrap = { minHeight: '100vh', margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, background: '#141418', color: '#e8e6ef', fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif', padding: '0 24px', textAlign: 'center' }
  const big = { fontSize: 20, fontWeight: 800, color: '#E62329' }
  const btn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '18px 28px', background: '#E62329', color: '#fff', border: 'none', borderRadius: 14, fontSize: 18, fontWeight: 700, cursor: 'pointer', width: '100%', maxWidth: 340 }

  if (status === 'notoken') {
    return <div style={wrap}><div style={big}>🍔 Freakie POS</div><div style={{ color: '#8b8997' }}>Link inválido. Volvé a escanear el QR desde el corte.</div></div>
  }
  if (status === 'done') {
    return <div style={wrap}><div style={{ fontSize: 56 }}>✅</div><div style={big}>Foto enviada</div><div style={{ color: '#8b8997' }}>Ya aparece en el corte. Podés cerrar esta página.</div></div>
  }
  return (
    <div style={wrap}>
      <div style={big}>🍔 Foto del egreso</div>
      <div style={{ color: '#8b8997', maxWidth: 320 }}>Tomá la foto del comprobante/egreso. Se sube directo al corte.</div>
      <label style={btn}>
        {status === 'uploading' ? 'Subiendo…' : '📷 Tomar / elegir foto'}
        <input type="file" accept="image/*" capture="environment" onChange={onPick} disabled={status === 'uploading'} style={{ display: 'none' }} />
      </label>
      {err && <div style={{ color: '#f87171', fontSize: 13 }}>{err}</div>}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
