import { useState } from 'react'

/**
 * Botón flotante "Reportar problema" — reutilizable en los 4 ERPs.
 * El personal describe un problema y se crea un ticket en `soporte_tickets`;
 * el resolver de la mini lo diagnostica/resuelve/escala.
 *
 * Props:
 *   db          — cliente supabase del ERP (createClient ya inicializado)
 *   tenant      — 'freakie' | 'kaeru' | 'kako' | 'eatalia'
 *   storeCode   — código de la sucursal del usuario (opcional)
 *   reporterName— nombre del que reporta (opcional)
 *   canal       — 'pos' | 'erp' (default 'pos')
 */
export default function ReportarProblema({ db, tenant, storeCode = null, reporterName = null, canal = 'pos' }) {
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState('idle') // idle | enviando | ok | error

  async function enviar() {
    const desc = texto.trim()
    if (desc.length < 5) { setEstado('error'); return }
    setEstado('enviando')
    const { error } = await db.from('soporte_tickets').insert({
      tenant, canal, store_code: storeCode, reportado_por: reporterName || 'Personal',
      descripcion: desc,
    })
    if (error) { setEstado('error'); return }
    setEstado('ok'); setTexto('')
    setTimeout(() => { setOpen(false); setEstado('idle') }, 2600)
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setEstado('idle') }}
        title="Reportar un problema"
        style={{
          position: 'fixed', left: 16, bottom: 16, zIndex: 9998,
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#b0342a', color: '#fff', border: 'none', borderRadius: 999,
          padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,.35)', fontFamily: 'inherit',
        }}>
        🛟 Reportar problema
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 440, background: '#211b16', color: '#f0e9df',
            borderRadius: 16, padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,.5)',
            fontFamily: 'inherit', border: '1px solid #3a2f26',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>🛟 Reportar un problema</h3>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#b9ada0', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ margin: '2px 0 12px', fontSize: 13, color: '#b9ada0' }}>
              Contá qué está pasando (no imprime, no loguea, se pega, etc.). El equipo lo revisa y te responde acá mismo.
            </p>

            {estado === 'ok' ? (
              <div style={{ background: '#1e2d1e', color: '#7bc07b', borderRadius: 10, padding: '14px 16px', fontSize: 14 }}>
                ✅ ¡Listo! Tu reporte se envió. Ya lo estamos viendo.
              </div>
            ) : (
              <>
                <textarea
                  value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus
                  placeholder="Ej: La impresora de cocina no saca las comandas…"
                  rows={4}
                  style={{
                    width: '100%', boxSizing: 'border-box', background: '#171310', color: '#f0e9df',
                    border: '1px solid #43382d', borderRadius: 10, padding: 12, fontSize: 15,
                    resize: 'vertical', fontFamily: 'inherit',
                  }} />
                {estado === 'error' && (
                  <div style={{ color: '#ef6a5c', fontSize: 13, marginTop: 6 }}>
                    {texto.trim().length < 5 ? 'Escribí un poco más de detalle 🙏' : 'No se pudo enviar, probá de nuevo.'}
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#8a7d6e', marginTop: 8 }}>
                  {storeCode ? `Sucursal: ${storeCode}` : ''}{reporterName ? ` · ${reporterName}` : ''}
                </div>
                <button
                  onClick={enviar} disabled={estado === 'enviando'}
                  style={{
                    width: '100%', marginTop: 12, background: '#c4551b', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '12px', fontSize: 15, fontWeight: 700,
                    cursor: estado === 'enviando' ? 'default' : 'pointer', opacity: estado === 'enviando' ? .7 : 1,
                    fontFamily: 'inherit',
                  }}>
                  {estado === 'enviando' ? 'Enviando…' : 'Enviar reporte'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
