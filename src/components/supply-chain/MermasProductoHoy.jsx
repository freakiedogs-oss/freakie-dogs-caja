import { useEffect, useState } from 'react'
import { db } from '../../supabase'
import { today } from '../../config'

// Merma de producto preparado del día (21-sep-2026): platos anulados en caja
// después de entrar a cocina. Ya están descontados del inventario (se ven en el
// kardex como tipo 'merma' con la nota "Merma de producto preparado: …"), así que
// NO hay que volver a reportarlos en la merma manual: esto es sólo para verlos
// por producto ("2× Freakie Dog · Mesa 17") y cuadrar el conteo.
export default function MermasProductoHoy({ sucursalId }) {
  const [filas, setFilas] = useState(null)

  useEffect(() => {
    if (!sucursalId) return
    let vivo = true
    ;(async () => {
      const desde = new Date(`${today()}T00:00:00-06:00`).toISOString()
      // Si la consulta falla (permiso, red), el panel se oculta: nunca debe
      // tumbar el conteo nocturno (pasó el 21-sep por un GRANT que faltaba).
      try {
        const { data, error } = await db.from('pos_mermas_producto')
          .select('id, producto_nombre, cantidad, mesa_ref, anulado_por_nombre, respuesta_caja, respuesta_cocina, es_merma, destino_ref, created_at')
          .eq('sucursal_id', sucursalId).gte('created_at', desde)
          .order('created_at', { ascending: true })
        if (vivo) setFilas(error ? [] : (data || []))
      } catch (_) { if (vivo) setFilas([]) }
    })()
    return () => { vivo = false }
  }, [sucursalId])

  if (!filas || filas.length === 0) return null
  const mermas = filas.filter(f => f.es_merma)
  const hora = (iso) => new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' })
  // Reutilizado = no es merma; se muestra a qué orden fue (22-sep-2026). Sin
  // destino es lo que hay que revisar: si no se usó en ninguna orden, falta.
  const reutilizado = (f) => (f.respuesta_cocina || f.respuesta_caja) === 'reutilizado'
  const sinDestino = (f) => reutilizado(f) && !f.destino_ref
  const estado = (f) => reutilizado(f)
    ? (f.destino_ref ? `se usó en ${f.destino_ref}` : '⚠️ se usó en otra orden, sin decir cuál')
    : f.respuesta_cocina
    ? (f.respuesta_cocina === 'preparado' ? 'cocina: se botó' : 'cocina: no se hizo')
    : (f.respuesta_caja === 'preparado' ? 'caja: se botó (falta cocina)' : 'caja: no se preparó')

  return (
    <div className="card" style={{ marginBottom: 12, padding: 14, border: '1px solid #f59e0b55', background: '#1a140a' }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#fbbf24', marginBottom: 4 }}>
        🍳 Merma de producto preparado de hoy
      </div>
      <div style={{ fontSize: 11.5, color: '#999', marginBottom: 8 }}>
        Platos anulados en caja después de entrar a cocina. Los que se botaron ya están descontados del inventario: no los vuelvas a reportar en la merma.
      </div>
      {filas.map(f => (
        <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5,
                                 padding: '5px 0', borderTop: '1px solid #2a2418', opacity: (f.es_merma || sinDestino(f)) ? 1 : 0.55 }}>
          <span style={{ color: '#eee' }}>
            <b>{Number(f.cantidad)}× {f.producto_nombre}</b>
            <span style={{ color: '#999' }}> · {f.mesa_ref || 'sin mesa'} · {hora(f.created_at)} · anuló {f.anulado_por_nombre || '—'}</span>
          </span>
          <span style={{ color: sinDestino(f) ? '#fbbf24' : f.es_merma ? '#f87171' : '#4ade80', whiteSpace: 'nowrap' }}>
            {f.es_merma ? 'merma' : 'sin merma'} · {estado(f)}
          </span>
        </div>
      ))}
      {filas.some(sinDestino) && (
        <div style={{ fontSize: 11.5, color: '#fbbf24', marginTop: 6 }}>
          Hay platos marcados como "otra orden" sin decir cuál: confirmá con caja o cocina dónde terminaron antes de cuadrar.
        </div>
      )}
      {mermas.length > 0 && (
        <div style={{ fontSize: 11.5, color: '#fbbf24', marginTop: 6 }}>
          {mermas.length} plato{mermas.length === 1 ? '' : 's'} descontado{mermas.length === 1 ? '' : 's'} como merma.
        </div>
      )}
    </div>
  )
}
