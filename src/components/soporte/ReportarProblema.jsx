import { useState, useEffect } from 'react'

/**
 * "Reportar problema" (variante db-based: Freakie / Eatalia).
 * Dos modos:
 *   - Uncontrolled (default): renderiza un botón flotante (FAB) + modal.
 *   - Controlled: pasá `open` + `onClose` → renderiza SOLO el modal (para dispararlo desde un
 *     ítem del menú, sin FAB flotante).
 * Sube una foto opcional al bucket `soporte-fotos` y crea un ticket en `soporte_tickets`.
 *
 * Props: db, tenant, storeCode?, reporterName?, canal?, open?, onClose?
 */
const BUCKET = 'soporte-fotos'

export default function ReportarProblema({ db, tenant, storeCode = null, reporterName = null, canal = 'pos', open: openProp, onClose }) {
  const controlled = typeof onClose === 'function'
  const [openState, setOpenState] = useState(false)
  const open = controlled ? !!openProp : openState
  const [texto, setTexto] = useState('')
  const [foto, setFoto] = useState(null)
  const [estado, setEstado] = useState('idle') // idle | enviando | ok | error

  const cerrar = () => { if (controlled) onClose(); else setOpenState(false) }
  useEffect(() => { if (open) setEstado('idle') }, [open])

  async function enviar() {
    const desc = texto.trim()
    if (desc.length < 5) { setEstado('error'); return }
    setEstado('enviando')

    let fotos = []
    if (foto) {
      const safe = (foto.name || 'foto.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${tenant}/${Date.now()}-${safe}`
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, foto, { contentType: foto.type, upsert: false })
      if (upErr) { setEstado('error'); return }
      const { data } = db.storage.from(BUCKET).getPublicUrl(path)
      if (data?.publicUrl) fotos = [data.publicUrl]
    }

    const { error } = await db.from('soporte_tickets').insert({
      tenant, canal, store_code: storeCode, reportado_por: reporterName || 'Personal',
      descripcion: desc, fotos_urls: fotos,
    })
    if (error) { setEstado('error'); return }
    setEstado('ok'); setTexto(''); setFoto(null)
    setTimeout(() => { cerrar() }, 2600)
  }

  return (
    <>
      {!controlled && (
        <button
          onClick={() => { setOpenState(true); setTexto(''); setFoto(null); setEstado('idle') }}
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
      )}

      {open && (
        <div onClick={cerrar} style={{
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
              <button onClick={cerrar} style={{ background: 'none', border: 'none', color: '#b9ada0', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ margin: '2px 0 12px', fontSize: 13, color: '#b9ada0' }}>
              Contá qué está pasando (no imprime, no loguea, se pega, etc.). Podés adjuntar una foto. El equipo lo revisa y te responde acá mismo.
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

                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer',
                  background: '#171310', border: '1px dashed #43382d', borderRadius: 10, padding: '10px 12px',
                  color: foto ? '#7bc07b' : '#b9ada0', fontSize: 14,
                }}>
                  📷 {foto ? `Foto lista: ${foto.name.slice(0, 28)}` : 'Adjuntar foto (opcional)'}
                  <input type="file" accept="image/*" capture="environment"
                    onChange={(e) => setFoto(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                </label>

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
                  {estado === 'enviando' ? (foto ? 'Subiendo foto y enviando…' : 'Enviando…') : 'Enviar reporte'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
