// ────────────────────────────────────────────────────────────────────
// Red de seguridad de la app.
//
// Sin esto, cualquier error de una pantalla desmonta React entero y queda
// la PANTALLA EN NEGRO, sin una sola pista de qué pasó. Ya nos costó una
// tarde persiguiendo a ciegas por qué la torre no abría en el celular.
//
// Ahora el error se muestra: qué falló y dónde. Con eso, quien está en la
// sucursal puede mandar una foto y se arregla en minutos en vez de horas.
// ────────────────────────────────────────────────────────────────────
import { Component } from 'react'

export default class PantallaDeError extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, donde: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ donde: info?.componentStack || null })
    console.error('Pantalla caída:', error, info)
  }

  render() {
    const { error, donde } = this.state
    if (!error) return this.props.children

    const detalle = [
      error?.message || String(error),
      donde ? donde.split('\n').slice(0, 4).join('\n') : null,
    ].filter(Boolean).join('\n')

    return (
      <div style={S.fondo}>
        <div style={S.caja}>
          <div style={{ fontSize: 40 }}>😖</div>
          <h1 style={S.titulo}>Esta pantalla se cayó</h1>
          <p style={S.texto}>
            El resto del sistema sigue funcionando. Mandale esta foto a soporte
            y lo arreglamos.
          </p>

          <pre style={S.detalle}>{detalle}</pre>

          <div style={S.botones}>
            <button style={S.btnRojo} onClick={() => window.location.reload()}>
              Reintentar
            </button>
            <button style={S.btnGris} onClick={async () => {
              // Por si quedó con archivos viejos guardados
              try {
                const ks = await caches.keys()
                await Promise.all(ks.map(k => caches.delete(k)))
                const rs = await navigator.serviceWorker?.getRegistrations?.() || []
                await Promise.all([...rs].map(r => r.unregister()))
              } catch { /* noop */ }
              window.location.replace(location.pathname + '?_r=' + Date.now())
            }}>
              Limpiar y recargar
            </button>
          </div>
        </div>
      </div>
    )
  }
}

const S = {
  fondo: {
    minHeight: '100vh', background: '#141110', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  caja: {
    maxWidth: 460, width: '100%', textAlign: 'center', color: '#f0ece9',
    font: '400 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  titulo: { fontSize: 21, fontWeight: 800, margin: '10px 0 6px' },
  texto: { color: '#b3a69d', fontSize: 14.5, margin: '0 0 16px' },
  detalle: {
    textAlign: 'left', background: '#1e1a18', border: '1px solid #2f2825',
    borderRadius: 10, padding: '11px 13px', color: '#fbbf24',
    font: '600 12px/1.5 ui-monospace, Menlo, monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    maxHeight: 220, overflow: 'auto', margin: '0 0 16px',
  },
  botones: { display: 'flex', gap: 9, justifyContent: 'center', flexWrap: 'wrap' },
  btnRojo: {
    padding: '11px 20px', borderRadius: 11, border: 'none', background: '#e63946',
    color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer',
  },
  btnGris: {
    padding: '11px 20px', borderRadius: 11, border: '1px solid #3a322f',
    background: 'none', color: '#b3a69d', fontSize: 14.5, fontWeight: 600, cursor: 'pointer',
  },
}
