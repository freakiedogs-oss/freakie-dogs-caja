import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// El menú público se despliega en su propio proyecto de Vercel
// (freakiedelivery.vercel.app), separado del ERP. Con VITE_TARGET=delivery se
// compilan SOLO las pantallas de cara al cliente: el código del ERP y del POS
// no llega siquiera a subirse a ese dominio.
const soloDelivery = process.env.VITE_TARGET === 'delivery'

const ENTRADAS_PUBLICAS = {
  menu:   resolve(__dirname, 'menu.html'),    // el menú para pedir
  track:  resolve(__dirname, 'track.html'),   // seguimiento + juego
  driver: resolve(__dirname, 'driver.html'),  // app de los motoristas
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: soloDelivery ? ENTRADAS_PUBLICAS : {
        main:   resolve(__dirname, 'index.html'),
        pos:    resolve(__dirname, 'pos.html'),
        foto:   resolve(__dirname, 'foto.html'),
        menu:   resolve(__dirname, 'menu.html'),
        driver: resolve(__dirname, 'driver.html'),
        track:  resolve(__dirname, 'track.html'),
      },
      output: {
        manualChunks(id) {
          // Vendors React core — se cachean independientemente del app code
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/') ||
            id.includes('node_modules/react-router/') ||
            id.includes('node_modules/@remix-run/')
          ) {
            return 'react-vendor'
          }
          // Supabase client
          if (id.includes('node_modules/@supabase/')) {
            return 'supabase'
          }
          // Radix UI primitives
          if (id.includes('node_modules/@radix-ui/') || id.includes('node_modules/radix-ui/')) {
            return 'radix'
          }
          // Lucide icons
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons'
          }
          // Tesseract OCR — si algún día entra en node_modules, chunk lazy propio
          if (id.includes('node_modules/tesseract.js')) {
            return 'tesseract'
          }
          // Utilidades de clase (clsx, tailwind-merge, class-variance-authority)
          if (
            id.includes('node_modules/clsx/') ||
            id.includes('node_modules/tailwind-merge/') ||
            id.includes('node_modules/class-variance-authority/')
          ) {
            return 'ui-utils'
          }
        },
      },
    },
  },
})
