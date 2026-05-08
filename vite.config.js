import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

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
      input: {
        main: resolve(__dirname, 'index.html'),
        pos:  resolve(__dirname, 'pos.html'),
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
