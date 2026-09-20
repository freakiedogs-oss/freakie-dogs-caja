import { useState } from 'react'
import { paletaC as C } from '@/theme'
import { consultaUrlMH, descargarPdfDTE } from './dteRepresentacion'
import { reenviarDTEPorCorreo } from './dteErpService'

/**
 * AccionesDTEEmitido — lo que se puede hacer con un DTE que YA está emitido:
 * copiar su código, verificarlo en Hacienda, descargar su representación
 * gráfica y reenviárselo al cliente.
 *
 * Ninguna de estas acciones toca el documento fiscal: no firma, no transmite y
 * no invalida. Corregir/invalidar sigue viviendo en `CorregirDTEModal`, que es
 * lo único de esta pantalla que le habla a Hacienda.
 */

const sBtn = {
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.white,
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
}

const sInput = {
  background: C.cardAlt,
  color: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '6px 8px',
  fontSize: 12,
  outline: 'none',
  width: '100%',
}

export default function AccionesDTEEmitido({ fila, detalle, puedeReenviar }) {
  const [copiado, setCopiado] = useState(false)
  const [generandoPdf, setGenerandoPdf] = useState(false)
  const [errorPdf, setErrorPdf] = useState(null)

  const [panelAbierto, setPanelAbierto] = useState(false)
  const [otroCorreo, setOtroCorreo] = useState('')
  const [usarOtro, setUsarOtro] = useState(false)
  const [pin, setPin] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)   // { ok, msg }

  const correoReceptor = detalle?.receptor?.correo || null
  const ambiente = detalle?.identificacion?.ambiente || '01'
  const fecEmi = detalle?.identificacion?.fecEmi || fila?.fecha_emision || ''
  const urlMH = consultaUrlMH(ambiente, fila.codigo_generacion, fecEmi)

  // Sin sello no hay nada que entregar: el documento no está aceptado por
  // Hacienda, así que la Edge Function lo rechazaría igual.
  const tieneSello = !!fila.sello_recepcion

  const copiarCodigo = async (ev) => {
    ev.stopPropagation()
    try {
      await navigator.clipboard.writeText(fila.codigo_generacion)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      // Clipboard bloqueado (http, permisos): seleccionarlo a mano sigue siendo
      // posible, así que no se convierte en un error rojo.
      setCopiado(false)
    }
  }

  const bajarPdf = async (ev) => {
    ev.stopPropagation()
    setGenerandoPdf(true); setErrorPdf(null)
    try {
      await descargarPdfDTE(detalle, fila)
    } catch (e) {
      setErrorPdf(e.message || String(e))
    } finally {
      setGenerandoPdf(false)
    }
  }

  const enviar = async (ev) => {
    ev.stopPropagation()
    setEnviando(true); setResultado(null)
    try {
      const to = usarOtro ? otroCorreo.trim() : undefined
      const res = await reenviarDTEPorCorreo({ codigoGeneracion: fila.codigo_generacion, to, pin })
      setResultado({ ok: true, msg: `Enviado a ${res.sent_to || to || correoReceptor}` })
      setPin('')
    } catch (e) {
      setResultado({ ok: false, msg: e.message || String(e) })
    } finally {
      setEnviando(false)
    }
  }

  const puedeEnviar = !enviando
    && pin.trim().length >= 4
    && (usarOtro ? otroCorreo.trim().length > 4 : !!correoReceptor)

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={copiarCodigo} style={sBtn} title="Copiar el código de generación">
          {copiado ? '✅ Copiado' : '📋 Copiar código'}
        </button>

        <a
          href={urlMH}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(ev) => ev.stopPropagation()}
          style={{ ...sBtn, textDecoration: 'none', color: C.blue, borderColor: C.blue }}
          title="Abre la consulta pública del Ministerio de Hacienda con este código de generación"
        >
          🔎 Buscar en Hacienda
        </a>

        <button onClick={bajarPdf} disabled={generandoPdf} style={{ ...sBtn, opacity: generandoPdf ? 0.6 : 1 }}
          title="Descarga el mismo documento que se le manda al cliente por correo">
          {generandoPdf ? '⏳ Generando…' : '⬇️ Descargar PDF'}
        </button>

        {puedeReenviar && tieneSello && (
          <button
            onClick={(ev) => { ev.stopPropagation(); setPanelAbierto(v => !v); setResultado(null) }}
            style={{ ...sBtn, borderColor: C.gold, color: C.gold }}
            title="Vuelve a enviarle el DTE al cliente por correo"
          >
            ✉️ Reenviar por correo
          </button>
        )}
      </div>

      {errorPdf && <div style={{ fontSize: 11, color: '#fca5a5' }}>⚠️ No se pudo generar el PDF: {errorPdf}</div>}

      {panelAbierto && (
        <div
          onClick={(ev) => ev.stopPropagation()}
          style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {correoReceptor ? (
            <div style={{ fontSize: 11, color: C.textMuted }}>
              Se facturó a <span style={{ color: C.white, fontFamily: 'monospace' }}>{correoReceptor}</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.gold }}>
              Este DTE se emitió sin correo del cliente — hay que escribir uno.
            </div>
          )}

          {correoReceptor && (
            <label style={{ fontSize: 11, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={usarOtro} onChange={e => setUsarOtro(e.target.checked)} />
              Enviar a otro correo
            </label>
          )}

          {(usarOtro || !correoReceptor) && (
            <input
              type="email"
              placeholder="correo@ejemplo.com"
              value={otroCorreo}
              onChange={e => setOtroCorreo(e.target.value)}
              style={sInput}
            />
          )}

          <div>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>Tu PIN — queda registrado quién lo reenvió</div>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => setPin(e.target.value)}
              style={sInput}
            />
          </div>

          <button
            onClick={enviar}
            disabled={!puedeEnviar}
            style={{
              ...sBtn,
              justifyContent: 'center',
              background: puedeEnviar ? C.gold : 'transparent',
              color: puedeEnviar ? '#1a1a1a' : C.textMuted,
              borderColor: puedeEnviar ? C.gold : C.border,
              fontWeight: 800,
              padding: '7px 12px',
              cursor: puedeEnviar ? 'pointer' : 'not-allowed',
            }}
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>

          {resultado && (
            <div style={{ fontSize: 11, color: resultado.ok ? C.greenLight : '#fca5a5' }}>
              {resultado.ok ? '✅ ' : '⚠️ '}{resultado.msg}
            </div>
          )}

          <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.5 }}>
            Se reenvía el documento tal como fue sellado (PDF + JSON). No se emite nada nuevo ante Hacienda.
          </div>
        </div>
      )}
    </div>
  )
}
