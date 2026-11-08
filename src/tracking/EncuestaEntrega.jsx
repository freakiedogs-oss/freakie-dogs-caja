// ────────────────────────────────────────────────────────────────────
// Encuesta de 1 toque al entregar (7-nov-2026, pedido de Cesar).
// 😀 se guarda al toque. 😐 / 😞 piden motivo (chips), comentario opcional y
// si quiere que lo contacten. Va a delivery_calificaciones vía
// tracking_calificar; el encargado lo ve en ERP → Resultados delivery y un 😞
// avisa por Telegram. Se puede corregir durante 1 hora.
// ────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { db } from '../supabase'

const CARAS = [
  { nota: 3, cara: '😀', txt: 'Excelente' },
  { nota: 2, cara: '😐', txt: 'Regular' },
  { nota: 1, cara: '😞', txt: 'Mal' },
]
const MOTIVOS_MALOS = ['Llegó frío', 'Tardó mucho', 'Faltó algo', 'Mal preparado', 'El motorista', 'Otro']
const MOTIVOS_BUENOS = ['Llegó rápido', 'Llegó caliente', 'Muy rico', 'Buen motorista']

export default function EncuestaEntrega({ token, inicial }) {
  const [nota, setNota] = useState(inicial?.nota || null)
  const [enviado, setEnviado] = useState(!!inicial?.nota)
  const [motivos, setMotivos] = useState([])
  const [comentario, setComentario] = useState('')
  const [contacto, setContacto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const enviar = async (n, extra = {}) => {
    setEnviando(true); setError('')
    const { data, error: e } = await db.rpc('tracking_calificar', {
      p_token: token, p_nota: n,
      p_motivos: extra.motivos ?? motivos, p_comentario: extra.comentario ?? comentario,
      p_contacto: extra.contacto ?? contacto,
    })
    setEnviando(false)
    if (e || !data?.ok) {
      setError(data?.error === 'ya_calificado' ? 'Ya nos habías dejado tu opinión. ¡Gracias!' : 'No se pudo enviar. Probá de nuevo.')
      if (data?.error === 'ya_calificado') setEnviado(true)
      return false
    }
    return true
  }

  const tocarCara = async (n) => {
    setNota(n); setMotivos([]); setEnviado(false)
    // 😀 queda guardado al toque; los chips son un extra opcional
    if (n === 3) { if (await enviar(3, { motivos: [], comentario: '', contacto: false })) setEnviado(true) }
  }
  const toggle = (m) => setMotivos(ms => ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m])

  if (enviado && nota) {
    return (
      <div style={S.caja}>
        <div style={{ fontSize: 30 }}>{CARAS.find(c => c.nota === nota)?.cara}</div>
        <div style={S.titulo}>{nota === 3 ? '¡Gracias! Nos alegra que te haya gustado' : 'Gracias por contarnos'}</div>
        <div style={S.sub}>
          {nota === 3 ? 'Tu opinión le llega al equipo de la sucursal.'
                      : contacto ? 'El encargado de la sucursal te va a contactar.' : 'El encargado de la sucursal ya lo está viendo.'}
        </div>
        {nota === 3 && motivos.length === 0 && (
          <div style={S.chips}>
            {MOTIVOS_BUENOS.map(m => (
              <button key={m} style={S.chip(false)} onClick={async () => { setMotivos([m]); await enviar(3, { motivos: [m] }) }}>{m}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={S.caja}>
      <div style={S.titulo}>{nota && nota < 3 ? 'Sentimos que no fue lo mejor. ¿Qué pasó?' : '¿Cómo llegó tu pedido?'}</div>
      <div style={S.caras}>
        {CARAS.map(c => (
          <button key={c.nota} disabled={enviando} onClick={() => tocarCara(c.nota)} style={S.cara(nota === c.nota)}>
            <span style={{ fontSize: 34, lineHeight: '44px', display: 'block' }}>{c.cara}</span>
            <span style={{ fontSize: 11.5, color: '#6b5a48' }}>{c.txt}</span>
          </button>
        ))}
      </div>

      {nota && nota < 3 && (
        <>
          <div style={S.chips}>
            {MOTIVOS_MALOS.map(m => (
              <button key={m} onClick={() => toggle(m)} style={S.chip(motivos.includes(m))}>{m}</button>
            ))}
          </div>
          <textarea value={comentario} onChange={e => setComentario(e.target.value)} maxLength={600}
                    placeholder="Contanos más (opcional)…" rows={3} style={S.texto} />
          <label style={S.check}>
            <input type="checkbox" checked={contacto} onChange={e => setContacto(e.target.checked)} /> Quiero que me contacten
          </label>
          <button disabled={enviando} onClick={async () => { if (await enviar(nota)) setEnviado(true) }} style={S.btn}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </>
      )}
      {!nota && <div style={S.sub}>Nos toma 3 segundos y nos ayuda a mejorar</div>}
      {error && <div style={{ ...S.sub, color: '#b3202c' }}>{error}</div>}
    </div>
  )
}

const S = {
  caja: { background: '#fff', border: '1px solid #f0dcc0', borderRadius: 14, padding: 16, margin: '14px 0', textAlign: 'center' },
  titulo: { fontWeight: 700, fontSize: 16, color: '#1a1200' },
  sub: { fontSize: 12.5, color: '#6b5a48', marginTop: 8 },
  caras: { display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12 },
  cara: (on) => ({ width: 78, padding: '6px 0', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                   background: on ? '#fdecee' : '#fff7ec', border: on ? '2px solid #E63946' : '1px solid #f0dcc0' }),
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 },
  chip: (on) => ({ border: on ? '1px solid #1a1200' : '1px solid #e3d3a0', background: on ? '#1a1200' : '#fff',
                   color: on ? '#FFD900' : '#1a1200', borderRadius: 16, padding: '6px 12px', fontSize: 13,
                   cursor: 'pointer', fontFamily: 'inherit' }),
  texto: { width: '100%', boxSizing: 'border-box', marginTop: 10, border: '1px solid #e3d3a0', borderRadius: 10,
           padding: 10, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' },
  check: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10, fontSize: 13.5 },
  btn: { marginTop: 12, width: '100%', background: '#E63946', color: '#fff', border: 0, borderRadius: 12,
         padding: 13, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
}
