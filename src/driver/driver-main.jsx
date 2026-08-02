import React from 'react'
import ReactDOM from 'react-dom/client'
import DriverBeacon from './DriverBeacon'

ReactDOM.createRoot(document.getElementById('driver-root')).render(
  <React.StrictMode>
    <DriverBeacon />
  </React.StrictMode>
)


// ── Auto-reparación de caché ────────────────────────────────────────────
// Si la app quedó con el HTML viejo, pide archivos que ya no existen y la
// pantalla queda en NEGRO, sin explicación. Le pasó a Jose en el celular.
// Cuando falla la carga de un archivo de la app, se limpia todo y se recarga
// UNA vez. Si vuelve a fallar después de recargar, no se insiste (sería un
// bucle) y se muestra un aviso legible en vez de la pantalla vacía.
const YA_INTENTE = 'fd_cache_reparada'

function repararCache(motivo) {
  if (sessionStorage.getItem(YA_INTENTE)) {
    document.body.innerHTML =
      '<div style="font:600 15px/1.6 system-ui;color:#f0f0f0;background:#141110;' +
      'min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'text-align:center;padding:28px">' +
      '<div><div style="font-size:38px;margin-bottom:10px">🔌</div>' +
      'No se pudo cargar la aplicación.<br>' +
      '<span style="font-weight:400;color:#b3a69d;font-size:14px">' +
      'Revisá la conexión y volvé a abrirla. Si sigue igual, avisá a soporte.</span></div></div>'
    return
  }
  sessionStorage.setItem(YA_INTENTE, '1')
  console.warn('Recargando por caché vieja:', motivo)
  const limpiar = caches?.keys
    ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))
    : Promise.resolve()
  limpiar
    .then(() => navigator.serviceWorker?.getRegistrations?.() || [])
    .then(rs => Promise.all([...rs].map(r => r.unregister())))
    .catch(() => {})
    .finally(() => window.location.replace(location.pathname + '?_r=' + Date.now()))
}

// Un archivo de la app que no carga = quedamos con el índice viejo
window.addEventListener('error', (e) => {
  const src = e?.target?.src || e?.target?.href || ''
  if (typeof src === 'string' && src.includes('/assets/')) repararCache(src)
}, true)

// Lo mismo cuando falla una carga diferida (las pantallas van en trozos aparte)
window.addEventListener('unhandledrejection', (e) => {
  const m = String(e?.reason?.message || '')
  if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(m)) {
    repararCache(m)
  }
})

// Si la app arrancó bien, se olvida el intento para no bloquear el próximo
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem(YA_INTENTE), 8000)
})

// Reutiliza el SW del ERP (auto-actualización de bundle)
if ('serviceWorker' in navigator) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const buscar = () => reg.update().catch(() => {})
      buscar()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') buscar()
      })
    }).catch(() => {})
  })
}
