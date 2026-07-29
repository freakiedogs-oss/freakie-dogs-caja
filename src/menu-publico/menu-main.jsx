import React from 'react'
import ReactDOM from 'react-dom/client'
import MenuPublico from './MenuPublico'
import './menuPublico.css'

ReactDOM.createRoot(document.getElementById('menu-root')).render(
  <React.StrictMode>
    <MenuPublico />
  </React.StrictMode>
)

// Service Worker — reutilizamos el mismo /sw.js del ERP (auto-actualización de bundle)
if ('serviceWorker' in navigator) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const buscar = () => { reg.update().catch(() => {}) }
      buscar()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') buscar()
      })
    }).catch(() => {})
  })
}
