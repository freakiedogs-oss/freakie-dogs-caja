import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register Service Worker + auto-actualización.
// Problema que resuelve: una tablet (p.ej. las Amazon Fire de las cajas) que queda
// abierta horas nunca se enteraba de un deploy nuevo y se quedaba pegada en un bundle
// viejo (síntoma: botones que "no hacen nada"). Ahora: cuando el SW nuevo toma control
// (skipWaiting + clients.claim en sw.js), 'controllerchange' recarga UNA vez; y buscamos
// versión nueva al cargar y cada vez que la app recupera el foco (momento seguro, entre
// tareas — no en medio de un cobro).
if ('serviceWorker' in navigator) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const buscarActualizacion = () => { reg.update().catch(() => {}) }
      buscarActualizacion()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') buscarActualizacion()
      })
    }).catch(() => {})
  })
}
