# 🍜 Kaeru Chan ERP

ERP de **Kaeru Chan** — ramen house en EPIC Plaza, Nuevo Cuscatlán, El Salvador.

**Stack:** PWA React + Vite + Tailwind v4 + shadcn (theme dark Kaeru) sobre Supabase schema `kaeru` + Google Apps Script (Gmail/Drive triggers) + Telegram bot dedicado.

**Reemplaza:** Kolo (POS actual).
**Alimenta:** Dashboard live que reemplazará `kaeruchan.pages.dev`.

---

## 🚀 Setup local (10 minutos)

```bash
git clone https://github.com/<usuario>/kaeru-chan-erp.git
cd kaeru-chan-erp
npm install
cp .env.example .env
# Editar .env y poner VITE_SUPABASE_ANON_KEY (obtener de Supabase Dashboard)
npm run dev
```

Abrir `http://localhost:5173`.

## 📦 Setup completo de Fase 0 (manual)

Sigue los pasos en orden. Cada uno desbloquea el siguiente.

### 1. GitHub repo (5 min)

```bash
gh repo create kaeru-chan-erp --private --source=. --remote=origin --push
# o vía UI de GitHub: crear repo privado y push manual
```

### 2. Vercel (5 min)

1. `vercel login` (cuenta de Jose o cuenta Kaeru)
2. `vercel link` desde el folder
3. En el dashboard de Vercel → **Project Settings → Environment Variables** agregar:
   - `VITE_SUPABASE_URL` = `https://btboxlwfqcbrdfrlnwln.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (de Supabase Dashboard → Settings → API → anon public)
   - `VITE_SUPABASE_SCHEMA` = `kaeru`
4. `vercel --prod` → primer deploy
5. Configurar dominio: `kaeru-chan-erp.vercel.app` (debería estar por default)

### 3. Generar TypeScript types desde Supabase (2 min)

```bash
npx supabase login
npm run types
git add src/types/supabase.ts && git commit -m "feat: tipos Supabase del schema kaeru"
```

### 4. Google Apps Script (15 min)

Ver `/Scripts/README.md` — pasos detallados para crear el proyecto, pegar los `.gs`, configurar Script Properties y triggers.

### 5. Telegram bot (10 min)

Ver `/Bot/README.md` — pasos para crear bot con @BotFather, crear grupo, obtener chat_id.

### 6. Verificación end-to-end (5 min)

1. Ir a `kaeru-chan-erp.vercel.app` — debería ver el dashboard con paleta dark Kaeru
2. En Apps Script: correr manualmente `cron_cierre_diario` — debería enviar mensaje al grupo Telegram (o avisar que no hay cierre del día)
3. Verificar en consola del navegador que no haya errores de Supabase

---

## 📂 Estructura del repo

```
.
├── src/
│   ├── components/
│   │   ├── ui/              # Button, Card, Badge — re-skineados al theme dark Kaeru
│   │   ├── dashboard/       # SalesDashboard (reemplaza kaeruchan.pages.dev)
│   │   ├── layout/          # BottomNav con kanji 家 予 損 給 分
│   │   ├── pos/             # POS de mesa (Fase 1)
│   │   ├── caja/            # Cierre de caja con caja chica (Fase 1)
│   │   └── recetas/         # Recetas BOM (Fase 2)
│   ├── lib/
│   │   ├── supabase.ts      # Cliente Supabase apuntando a schema `kaeru`
│   │   └── utils.ts         # cn(), formatUSD(), formatPct(), formatDate()
│   ├── styles/
│   │   ├── theme.kaeru.css  # Tokens dark + japonés
│   │   └── index.css        # Tailwind directives + import del theme
│   ├── types/
│   │   └── supabase.ts      # Tipos generados (npm run types)
│   ├── App.tsx              # Routes + BottomNav
│   └── main.tsx
├── Scripts/                 # Google Apps Script .gs (NO van en Vercel)
│   ├── _lib.gs              # Helpers compartidos (Supabase HTTP + Telegram)
│   ├── gmail_dte_proveedores.gs
│   ├── gmail_peya_zip.gs
│   ├── cron_cierre_diario.gs
│   ├── cron_stock_bajo.gs
│   ├── cron_planilla.gs
│   ├── cron_propinas.gs
│   └── cron_alerta_pos_bac.gs
├── Bot/                     # Telegram bot setup instructions
│   └── README.md
├── supabase/
│   └── functions/           # Edge Functions (Fase 3+)
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 🎨 Theme dark Kaeru

Paleta extraída del dashboard live de Luis (`kaeruchan.pages.dev` v27):

| Token | Valor |
|---|---|
| `--bg-base` | `#0a0a0a` (casi negro) |
| `--text-primary` | `#f4f0e6` (washi paper, **NUNCA #fff**) |
| `--accent-purple` | `#9a6fd1` (sello japonés) |
| `--accent-kaeru` | `#5fe0a9` (verde Kaeru, la rana 蛙) |

**Tipografías:** Inter (body) + Bebas Neue (métricas grandes) + Noto Sans JP (kanji).

**Navegación:** bottom nav fijo con kanji + label (家 REVENUE · 予 PROJECTION · 損 P&L · 給 EXPENSES · 分 DRONE VIEW). Nunca sidebar.

**Mobile-first absoluto:** ancho máximo 420px centrado en desktop.

Ver `src/styles/theme.kaeru.css` para tokens completos.

---

## 🔐 Reglas de oro

1. **NUNCA tocar el schema `public`** — eso es Freakies y está en producción.
2. **NUNCA `JOIN` cross-schema** entre kaeru y public.
3. El cliente Supabase está hardcoded a schema `kaeru` (`src/lib/supabase.ts`).
4. Las migraciones se aplican a `kaeru.*` solamente.
5. Edge Functions reciben `target_schema` como parámetro y validan que sea `kaeru`.

---

## 🗺️ Roadmap

| Fase | Estado | Entregable |
|---|---|---|
| 0 | 🟢 | Setup técnico (este repo) |
| 1 | ⏳ | POS Mesa + Cierre Caja con caja chica + PeYa Import + Marcaje PIN + Dashboard live |
| 2 | ⏳ | Inventario + Recetas (post-workshop) + Producción + Horarios |
| 3 | ⏳ | Planilla quincenal + Propinas semanales + Recibos digitales |
| 4 | ⏳ | Conciliación BAC + DTE proveedores + Activos fijos + Dashboard rentabilidad |

---

## 👥 Equipo

- **Jose Isart** — Lead técnico ERP + Finanzas (socio)
- **Luis Castillo** — Marketing (socio) — creó el dashboard live original
- **Roberto Alas** — Chef estratégico (socio)
- **Florian Felsing** — Inversor pasivo (socio)
- **Yessica Hernández** — Manager operativa + Compras
- **Iván Aguirre** — Jefe de cocina

---

*Construido con ❤️ sobre el ecosistema de Freakie Dogs ERP.*
