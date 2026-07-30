import React from 'react'
import ReactDOM from 'react-dom/client'
import DriverBeacon from './DriverBeacon'

ReactDOM.createRoot(document.getElementById('driver-root')).render(
  <React.StrictMode>
    <DriverBeacon />
  </React.StrictMode>
)

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
