import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ToastProvider } from './lib/toast';
import './styles/index.css';

// FIX raíz cache PWA: registrar SW con auto-reload cuando hay nueva versión
// El user nunca más tiene que hacer "Unregister + Clear site data" manual
const updateSW = registerSW({
  immediate: true,  // Registrar al cargar, no esperar onLoad
  onNeedRefresh() {
    // Hay un nuevo SW esperando — recargar para activarlo
    // Esto solo se llama si workbox.skipWaiting=false (que ya seteamos true en vite.config)
    // Por seguridad lo dejamos para casos edge donde el browser no acate skipWaiting
    if (confirm('Nueva versión del ERP disponible. ¿Recargar ahora?')) {
      updateSW(true);
    }
  },
  onRegisteredSW(swUrl, registration) {
    // Cada 60s pregunta si hay update server-side (útil para tabs abiertas días)
    if (registration) {
      setInterval(() => registration.update(), 60 * 1000);
    }
    console.log('[SW] registered', swUrl);
  },
  onRegisterError(err) {
    console.error('[SW] register error', err);
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
