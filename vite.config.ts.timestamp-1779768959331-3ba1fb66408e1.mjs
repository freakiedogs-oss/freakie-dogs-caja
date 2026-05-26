// vite.config.ts
import { defineConfig } from "file:///sessions/nifty-determined-ritchie/mnt/Freakie%20Dogs%20ERP/_KAERU_CHAN_BLUEPRINT/vercel-deploy/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/nifty-determined-ritchie/mnt/Freakie%20Dogs%20ERP/_KAERU_CHAN_BLUEPRINT/vercel-deploy/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/nifty-determined-ritchie/mnt/Freakie%20Dogs%20ERP/_KAERU_CHAN_BLUEPRINT/vercel-deploy/node_modules/vite-plugin-pwa/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "/sessions/nifty-determined-ritchie/mnt/Freakie Dogs ERP/_KAERU_CHAN_BLUEPRINT/vercel-deploy";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // FIX raíz: forzar que el nuevo SW tome control inmediato + HTML siempre del network
      // Sin esto, cada deploy nuevo requiere "Unregister + Clear site data" manual
      workbox: {
        clientsClaim: true,
        // SW toma control de pestañas abiertas sin esperar
        skipWaiting: true,
        // No espera a que se cierren tabs viejas
        cleanupOutdatedCaches: true,
        // Borra caches de versiones anteriores
        // HTML siempre fresco del network → bundle hash referenciado siempre es el nuevo
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // El HTML root y todas las rutas SPA → NetworkFirst (cae al cache solo si offline)
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "kaeru-html",
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 },
              // 1 día
              networkTimeoutSeconds: 3
            }
          },
          {
            // JS/CSS con hash → CacheFirst (son inmutables por hash)
            urlPattern: /\.(?:js|css|woff2?|ttf|otf)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "kaeru-static",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      },
      manifest: {
        name: "Kaeru Chan ERP",
        short_name: "Kaeru ERP",
        description: "ERP de Kaeru Chan",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  server: {
    port: 5173,
    host: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvbmlmdHktZGV0ZXJtaW5lZC1yaXRjaGllL21udC9GcmVha2llIERvZ3MgRVJQL19LQUVSVV9DSEFOX0JMVUVQUklOVC92ZXJjZWwtZGVwbG95XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvbmlmdHktZGV0ZXJtaW5lZC1yaXRjaGllL21udC9GcmVha2llIERvZ3MgRVJQL19LQUVSVV9DSEFOX0JMVUVQUklOVC92ZXJjZWwtZGVwbG95L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9uaWZ0eS1kZXRlcm1pbmVkLXJpdGNoaWUvbW50L0ZyZWFraWUlMjBEb2dzJTIwRVJQL19LQUVSVV9DSEFOX0JMVUVQUklOVC92ZXJjZWwtZGVwbG95L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgVml0ZVBXQSh7XG4gICAgICByZWdpc3RlclR5cGU6ICdhdXRvVXBkYXRlJyxcbiAgICAgIC8vIEZJWCByYVx1MDBFRHo6IGZvcnphciBxdWUgZWwgbnVldm8gU1cgdG9tZSBjb250cm9sIGlubWVkaWF0byArIEhUTUwgc2llbXByZSBkZWwgbmV0d29ya1xuICAgICAgLy8gU2luIGVzdG8sIGNhZGEgZGVwbG95IG51ZXZvIHJlcXVpZXJlIFwiVW5yZWdpc3RlciArIENsZWFyIHNpdGUgZGF0YVwiIG1hbnVhbFxuICAgICAgd29ya2JveDoge1xuICAgICAgICBjbGllbnRzQ2xhaW06IHRydWUsICAgICAgICAgICAgICAvLyBTVyB0b21hIGNvbnRyb2wgZGUgcGVzdGFcdTAwRjFhcyBhYmllcnRhcyBzaW4gZXNwZXJhclxuICAgICAgICBza2lwV2FpdGluZzogdHJ1ZSwgICAgICAgICAgICAgICAvLyBObyBlc3BlcmEgYSBxdWUgc2UgY2llcnJlbiB0YWJzIHZpZWphc1xuICAgICAgICBjbGVhbnVwT3V0ZGF0ZWRDYWNoZXM6IHRydWUsICAgICAvLyBCb3JyYSBjYWNoZXMgZGUgdmVyc2lvbmVzIGFudGVyaW9yZXNcbiAgICAgICAgLy8gSFRNTCBzaWVtcHJlIGZyZXNjbyBkZWwgbmV0d29yayBcdTIxOTIgYnVuZGxlIGhhc2ggcmVmZXJlbmNpYWRvIHNpZW1wcmUgZXMgZWwgbnVldm9cbiAgICAgICAgbmF2aWdhdGVGYWxsYmFja0RlbnlsaXN0OiBbL15cXC9hcGkvXSxcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAvLyBFbCBIVE1MIHJvb3QgeSB0b2RhcyBsYXMgcnV0YXMgU1BBIFx1MjE5MiBOZXR3b3JrRmlyc3QgKGNhZSBhbCBjYWNoZSBzb2xvIHNpIG9mZmxpbmUpXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAoeyByZXF1ZXN0IH0pID0+IHJlcXVlc3QubW9kZSA9PT0gJ25hdmlnYXRlJyxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdOZXR3b3JrRmlyc3QnLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdrYWVydS1odG1sJyxcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjogeyBtYXhFbnRyaWVzOiA1LCBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgfSwgLy8gMSBkXHUwMEVEYVxuICAgICAgICAgICAgICBuZXR3b3JrVGltZW91dFNlY29uZHM6IDNcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIC8vIEpTL0NTUyBjb24gaGFzaCBcdTIxOTIgQ2FjaGVGaXJzdCAoc29uIGlubXV0YWJsZXMgcG9yIGhhc2gpXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXFwuKD86anN8Y3NzfHdvZmYyP3x0dGZ8b3RmKSQvLFxuICAgICAgICAgICAgaGFuZGxlcjogJ0NhY2hlRmlyc3QnLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdrYWVydS1zdGF0aWMnLFxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDEwMCwgbWF4QWdlU2Vjb25kczogNjAgKiA2MCAqIDI0ICogMzAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIG1hbmlmZXN0OiB7XG4gICAgICAgIG5hbWU6ICdLYWVydSBDaGFuIEVSUCcsXG4gICAgICAgIHNob3J0X25hbWU6ICdLYWVydSBFUlAnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0VSUCBkZSBLYWVydSBDaGFuJyxcbiAgICAgICAgdGhlbWVfY29sb3I6ICcjMGEwYTBhJyxcbiAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyMwYTBhMGEnLFxuICAgICAgICBkaXNwbGF5OiAnc3RhbmRhbG9uZScsXG4gICAgICAgIG9yaWVudGF0aW9uOiAncG9ydHJhaXQnLFxuICAgICAgICBpY29uczogW1xuICAgICAgICAgIHsgc3JjOiAnL2ljb24tMTkyLnBuZycsIHNpemVzOiAnMTkyeDE5MicsIHR5cGU6ICdpbWFnZS9wbmcnIH0sXG4gICAgICAgICAgeyBzcmM6ICcvaWNvbi01MTIucG5nJywgc2l6ZXM6ICc1MTJ4NTEyJywgdHlwZTogJ2ltYWdlL3BuZycgfSxcbiAgICAgICAgICB7IHNyYzogJy9pY29uLW1hc2thYmxlLTUxMi5wbmcnLCBzaXplczogJzUxMng1MTInLCB0eXBlOiAnaW1hZ2UvcG5nJywgcHVycG9zZTogJ21hc2thYmxlJyB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9KVxuICBdLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJylcbiAgICB9XG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgaG9zdDogdHJ1ZVxuICB9XG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBdWMsU0FBUyxvQkFBb0I7QUFDcGUsT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQUN4QixPQUFPLFVBQVU7QUFIakIsSUFBTSxtQ0FBbUM7QUFLekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBO0FBQUE7QUFBQSxNQUdkLFNBQVM7QUFBQSxRQUNQLGNBQWM7QUFBQTtBQUFBLFFBQ2QsYUFBYTtBQUFBO0FBQUEsUUFDYix1QkFBdUI7QUFBQTtBQUFBO0FBQUEsUUFFdkIsMEJBQTBCLENBQUMsUUFBUTtBQUFBLFFBQ25DLGdCQUFnQjtBQUFBLFVBQ2Q7QUFBQTtBQUFBLFlBRUUsWUFBWSxDQUFDLEVBQUUsUUFBUSxNQUFNLFFBQVEsU0FBUztBQUFBLFlBQzlDLFNBQVM7QUFBQSxZQUNULFNBQVM7QUFBQSxjQUNQLFdBQVc7QUFBQSxjQUNYLFlBQVksRUFBRSxZQUFZLEdBQUcsZUFBZSxLQUFLLEtBQUssR0FBRztBQUFBO0FBQUEsY0FDekQsdUJBQXVCO0FBQUEsWUFDekI7QUFBQSxVQUNGO0FBQUEsVUFDQTtBQUFBO0FBQUEsWUFFRSxZQUFZO0FBQUEsWUFDWixTQUFTO0FBQUEsWUFDVCxTQUFTO0FBQUEsY0FDUCxXQUFXO0FBQUEsY0FDWCxZQUFZLEVBQUUsWUFBWSxLQUFLLGVBQWUsS0FBSyxLQUFLLEtBQUssR0FBRztBQUFBLFlBQ2xFO0FBQUEsVUFDRjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsTUFDQSxVQUFVO0FBQUEsUUFDUixNQUFNO0FBQUEsUUFDTixZQUFZO0FBQUEsUUFDWixhQUFhO0FBQUEsUUFDYixhQUFhO0FBQUEsUUFDYixrQkFBa0I7QUFBQSxRQUNsQixTQUFTO0FBQUEsUUFDVCxhQUFhO0FBQUEsUUFDYixPQUFPO0FBQUEsVUFDTCxFQUFFLEtBQUssaUJBQWlCLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxVQUM1RCxFQUFFLEtBQUssaUJBQWlCLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxVQUM1RCxFQUFFLEtBQUssMEJBQTBCLE9BQU8sV0FBVyxNQUFNLGFBQWEsU0FBUyxXQUFXO0FBQUEsUUFDNUY7QUFBQSxNQUNGO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLEVBQ1I7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
