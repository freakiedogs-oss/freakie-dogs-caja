import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // FIX raíz: forzar que el nuevo SW tome control inmediato + HTML siempre del network
      // Sin esto, cada deploy nuevo requiere "Unregister + Clear site data" manual
      workbox: {
        clientsClaim: true,              // SW toma control de pestañas abiertas sin esperar
        skipWaiting: true,               // No espera a que se cierren tabs viejas
        cleanupOutdatedCaches: true,     // Borra caches de versiones anteriores
        // HTML siempre fresco del network → bundle hash referenciado siempre es el nuevo
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // El HTML root y todas las rutas SPA → NetworkFirst (cae al cache solo si offline)
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kaeru-html',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 }, // 1 día
              networkTimeoutSeconds: 3
            }
          },
          {
            // JS/CSS con hash → CacheFirst (son inmutables por hash)
            urlPattern: /\.(?:js|css|woff2?|ttf|otf)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'kaeru-static',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      },
      manifest: {
        name: 'Kaeru Chan ERP',
        short_name: 'Kaeru ERP',
        description: 'ERP de Kaeru Chan',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    host: true
  }
});
