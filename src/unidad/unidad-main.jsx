/* ═══════════════════════════════════════════════════════════════════════
   Ficha de una unidad producida — lo que abre el QR de la etiqueta
   freakie-dogs-caja.vercel.app/unidad.html?c=<codigo_corto>

   Solo lectura, sin login: el QR lo escanea cualquiera con un celular
   (sucursal, Calidad, un cliente curioso). Muestra producto, lote, número,
   peso, elaborado/vence, quién pesó y si la unidad sigue activa. Nada de
   costos ni insumos.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { db } from '../supabase'
import '../styles/global.css'

const codigo = new URLSearchParams(window.location.search).get('c') || ''

function Ficha() {
  const [u, setU] = useState(undefined)
  useEffect(() => {
    if (!codigo) { setU(null); return }
    db.rpc('produccion_unidad_ficha', { p_codigo: codigo }).then(({ data }) => setU(data || null))
  }, [])

  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/El_Salvador' })
  const vencida = u?.vence && u.vence < hoy
  const wrap = { minHeight: '100vh', background: '#0a0a0b', color: '#f0f0f2', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', padding: 20 }
  const card = { background: '#141416', border: '1px solid #2a2a2e', borderRadius: 14, padding: 18, maxWidth: 480, margin: '0 auto' }
  const fila = (k, v) => v != null && v !== '' ? (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid #2a2a2e', fontSize: 15 }}>
      <span style={{ color: '#8a8a92' }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span>
    </div>) : null

  if (u === undefined) return <div style={wrap}><div style={card}>Buscando…</div></div>
  if (u === null) return <div style={wrap}><div style={card}><b>No se encontró esa unidad.</b><div style={{ color: '#8a8a92', marginTop: 6 }}>Código: {codigo || '(vacío)'}</div></div></div>

  const e = u.etiqueta || {}
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 12, color: '#8a8a92', letterSpacing: .5 }}>FREAKIE DOGS · CASA MATRIZ</div>
        <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{e.producto || u.producto}</div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {u.estado === 'anulada' && <span style={{ background: '#3a1212', color: '#fecaca', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>ANULADA{u.anulada_motivo ? ` · ${u.anulada_motivo}` : ''}</span>}
          {u.es_prueba && <span style={{ background: '#3a2a06', color: '#fcd34d', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>TANDA DE PRUEBA</span>}
          {vencida && u.estado === 'activa' && <span style={{ background: '#3a1212', color: '#fecaca', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>VENCIDA</span>}
          {u.tanda_estado === 'abierta' && <span style={{ background: '#12233a', color: '#93c5fd', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>Tanda en curso</span>}
        </div>
        <div style={{ marginTop: 12 }}>
          {fila('Lote', `${u.lote} · #${u.numero}`)}
          {fila('Peso', u.gramos != null ? `${Math.round(u.gramos).toLocaleString('en-US')} g · ${(u.gramos / 453.59237).toFixed(2)} lb` : null)}
          {fila('Elaborado', e.elaborado_txt ? `${e.elaborado_txt} ${e.hora || ''}` : u.fecha)}
          {fila('Vence', e.vence_txt || u.vence)}
          {fila('Conservación', e.conservacion)}
          {fila('Pesó', e.quien)}
          {fila('Receta', u.receta)}
          {fila('Unidades del lote', u.unidades_lote)}
          {fila('Código', u.codigo)}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('unidad-root')).render(<Ficha />)
