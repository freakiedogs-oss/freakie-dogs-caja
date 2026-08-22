// Freakie Dogs ERP — Service Worker v11 (+ notificación persistente driver)
//
// Por qué cambió: la versión anterior cacheaba TODO, incluido el index.html.
// Al desplegar, los archivos de la app cambian de nombre; si el teléfono se
// quedaba con el index viejo pedía archivos que ya no existen y la app abría
// en negro. Pasaba sobre todo en celular, donde la señal falla y el fallback
// a cache se dispara seguido.
//
// Regla nueva:
//   · El HTML no se sirve de cache mientras haya red: es lo que decide qué
//     archivos carga la app, así que tiene que ser siempre el actual.
//   · Los archivos de /assets/ llevan hash en el nombre — cambian en cada
//     build — así que cachearlos no puede dejar nada viejo.
//   · Las llamadas a la base nunca pasan por acá.
const CACHE = 'fd-erp-v11';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const esNavegacion = (req) =>
  req.mode === 'navigate' ||
  (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Datos: derecho a la red, sin intermediarios
  if (url.pathname.startsWith('/sb') || url.hostname.endsWith('supabase.co')) return;

  // HTML: red primero; el guardado solo si de plano no hay red
  if (esNavegacion(req)) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Archivos con hash: se pueden servir de cache sin riesgo de quedar viejos
  e.respondWith(
    caches.match(req).then(guardado =>
      guardado || fetch(req).then(res => {
        if (res.ok && url.pathname.startsWith('/assets/')) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return res;
      })
    )
  );
});

// La app pide limpiar todo cuando detecta que quedó con archivos viejos
// (ver el manejador de errores en main.jsx).
self.addEventListener('message', e => {
  if (e.data === 'limpiar-cache') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => e.source && e.source.postMessage('cache-limpia'));
  }
});

// Motorista GPS: al tocar la notificación persistente, enfocar la app del driver
// (o abrirla si no hay pestaña). Mientras la notif esté visible, Android tarda
// más en matar el proceso Chrome → GPS sigue reportando más tiempo en background.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('/driver') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/driver');
    })
  );
});
