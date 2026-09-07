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
  // Recargar solo si un SW nuevo reemplaza a uno que ya controlaba la página.
  // La primera toma de control (clients.claim) no amerita recarga y en Safari
  // dispara en cada carga → bucle de recargas. Acá pega doble: el menú lo abren
  // clientes desde iPhone. Ver el detalle en src/main.jsx.
  const habiaControlador = !!navigator.serviceWorker.controller
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaControlador || refreshing) return
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
