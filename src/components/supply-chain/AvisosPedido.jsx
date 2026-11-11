/* Avisos de cambios para las sucursales (pedido y conteo nocturno).
   22-oct-2026 (Cesar): la bolsa de cebolla blanca pasa de 2 lb a 0.75 lb y tiene que ser MUY notorio.

   Lee `avisos_pedido` (activos y vigentes por fecha). Cada aviso:
   · la primera vez que esta persona entra, sale en pantalla completa y solo se cierra con «Entendido»;
   · después queda como franja amarilla fija arriba mientras siga vigente.
   Para avisar otra cosa a futuro basta con insertar una fila en la tabla. */
import { useEffect, useState } from 'react'
import { db } from '../../supabase'
import { today } from '../../config'

const clave = (userId, avisoId) => `aviso-pedido-${avisoId}-${userId || 'anon'}`

export default function AvisosPedido({ user }) {
  const [avisos, setAvisos] = useState([])
  const [abierto, setAbierto] = useState(null)

  useEffect(() => {
    let vivo = true
    const hoy = today()
    db.from('avisos_pedido').select('id,titulo,mensaje,detalle,desde,hasta')
      .eq('activo', true).lte('desde', hoy)
      .then(({ data }) => {
        if (!vivo) return
        const vig = (data || []).filter(a => !a.hasta || a.hasta >= hoy)
        setAvisos(vig)
        let visto = () => false
        try { visto = (a) => localStorage.getItem(clave(user?.id, a.id)) === '1' } catch { /* sin storage */ }
        const pendiente = vig.find(a => !visto(a))
        if (pendiente) setAbierto(pendiente)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [user?.id])

  const entendido = () => {
    try { localStorage.setItem(clave(user?.id, abierto.id), '1') } catch { /* sin storage */ }
    setAbierto(null)
  }

  if (!avisos.length) return null
  return (
    <>
      {avisos.map(a => (
        <div key={a.id} onClick={() => setAbierto(a)}
          style={{ background: '#fbbf24', color: '#1a1200', borderRadius: 12, padding: '12px 14px', margin: '12px 0',
                   border: '3px solid #f59e0b', cursor: 'pointer', boxShadow: '0 0 0 3px rgba(251,191,36,.25)' }}>
          <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.3 }}>⚠️ {a.titulo}</div>
          <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.45 }}>{a.mensaje}</div>
          <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700, textDecoration: 'underline' }}>Tocá para ver el detalle</div>
        </div>
      ))}

      {abierto && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#1a1200', border: '4px solid #fbbf24', borderRadius: 18, padding: 22,
                        maxWidth: 520, width: '100%', color: '#fff7e0' }}>
            <div style={{ fontSize: 46, textAlign: 'center', lineHeight: 1 }}>⚠️</div>
            <div style={{ fontWeight: 900, fontSize: 22, textAlign: 'center', color: '#fbbf24', margin: '10px 0 12px', lineHeight: 1.25 }}>
              {abierto.titulo}
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.55 }}>{abierto.mensaje}</div>
            {abierto.detalle && <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 12, color: '#fde68a' }}>{abierto.detalle}</div>}
            <button onClick={entendido}
              style={{ marginTop: 20, width: '100%', background: '#fbbf24', color: '#1a1200', border: 0, borderRadius: 12,
                       padding: 15, fontSize: 17, fontWeight: 900, cursor: 'pointer' }}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  )
}
