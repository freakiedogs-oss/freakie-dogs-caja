import { useVersionGate } from '../../hooks/versionGate'

/**
 * UpdateGate — candado de versión reutilizable (POS + ERP).
 *
 * Envolvé la pantalla de LOGIN con esto. Si la tablet/navegador corre un bundle
 * viejo, fuerza la actualización ANTES de dejar entrar (limpia caché + SW y
 * recarga sola). Solo actúa antes del login → nunca en medio de una operación.
 * Fail-open sin internet (ver useVersionGate).
 */
export default function UpdateGate({ children }) {
  const status = useVersionGate()
  if (status === 'updating') {
    return (
      <div style={{ minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#141418', padding: '0 24px', textAlign: 'center' }}>
        <img src="/icon-192.png" alt="Freakie Dogs" style={{ width: 88, height: 88, borderRadius: 18, marginBottom: 18, objectFit: 'contain' }} />
        <div className="spin" style={{ width: 30, height: 30, marginBottom: 16 }} />
        <div style={{ fontWeight: 800, fontSize: 18, color: '#E62329', marginBottom: 6 }}>Actualizando app…</div>
        <div style={{ color: '#8b8997', fontSize: 13, maxWidth: 280 }}>Bajando la última versión. La app se reinicia sola en un momento.</div>
      </div>
    )
  }
  return children
}
