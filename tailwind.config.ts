import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Theme dark Kaeru — paleta extraída del dashboard live de Luis
        bg: {
          base: '#0a0a0a',      // fondo principal
          card: '#131313',      // superficies elevadas
          elevated: '#161616',  // cards encima de cards
          inset: '#1a1a1a'      // inputs, paneles internos
        },
        text: {
          primary: '#f4f0e6',   // cream / washi paper — NUNCA #fff
          muted: '#9a9690',     // texto secundario
          dim: '#6a6660'        // placeholder, deshabilitado
        },
        accent: {
          purple: '#9a6fd1',    // sello japonés / acento primario
          kaeru: '#5fe0a9'      // verde Kaeru (la rana 蛙) — métricas positivas
        },
        state: {
          warning: '#e97a6a',   // coral
          danger: '#c8504a',
          critical: '#ff1049'
        }
      },
      fontFamily: {
        body: ['Inter', 'system-ui', 'sans-serif'],
        metric: ['Bebas Neue', 'Impact', 'sans-serif'],
        kanji: ['Noto Sans JP', 'serif']
      },
      borderRadius: {
        kaeru: '12px'
      },
      maxWidth: {
        // Mobile-first: ancho máximo en desktop
        kaeru: '420px'
      }
    }
  },
  plugins: []
} satisfies Config;
