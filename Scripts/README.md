# Google Apps Script — Kaeru Chan ERP — Automation

Proyecto: **Kaeru Chan ERP — Automation**
Cuenta dueña: **kaeruchansv@gmail.com**
URL: `https://script.google.com/d/<SCRIPT_ID>/edit` (a obtener tras crear)

## Cómo configurar (manual — pasos para Jose)

1. Entrar a https://script.google.com con la cuenta `kaeruchansv@gmail.com`
2. **New project** → nombre: `Kaeru Chan ERP — Automation`
3. Borrar el `Code.gs` por default
4. Para cada archivo `.gs` de esta carpeta: **File → New → Script file** con el mismo nombre, pegar el contenido
5. **Project Settings → Script Properties** — agregar estas variables (NO ir al código):

   | Property | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://btboxlwfqcbrdfrlnwln.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | (obtener de Supabase Dashboard → Settings → API → service_role) |
   | `SUPABASE_SCHEMA` | `kaeru` |
   | `TELEGRAM_BOT_TOKEN` | (obtener de BotFather — ver Bot/README.md) |
   | `TELEGRAM_CHAT_ID` | (chat_id del grupo "Kaeru Chan — Operación") |

6. Para cada cron, configurar trigger: **Triggers → Add Trigger**:

   | Función | Tipo | Frecuencia |
   |---|---|---|
   | `gmail_dte_proveedores_main` | Time-driven → Hour timer | Every 1 hour |
   | `gmail_peya_zip_main` | Time-driven → Hour timer | Every 1 hour |
   | `cron_cierre_diario` | Time-driven → Day timer | 10pm – 11pm |
   | `cron_stock_bajo` | Time-driven → Hour timer | Every 6 hours |
   | `cron_planilla` | Time-driven → Day timer (con check de fecha) | 7am – 8am |
   | `cron_propinas` | Time-driven → Week timer | Lunes 7am |
   | `cron_alerta_pos_bac` | Time-driven → Day timer | 11pm – 12am |

7. Primer **Run** de cada función → autorizar permisos Gmail + UrlFetch

## Archivos

| `.gs` | Trigger | Función |
|---|---|---|
| `gmail_dte_proveedores.gs` | onMessage o cron hourly | Parsea DTEs entrantes → INSERT en `kaeru.compras_dte` |
| `gmail_peya_zip.gs` | onMessage o cron hourly | Detecta ZIPs PeYa → sube a Supabase Storage |
| `cron_cierre_diario.gs` | Daily 10pm | Query del cierre del día → POST a Telegram |
| `cron_stock_bajo.gs` | Every 6h | Query stock bajo → alerta Telegram |
| `cron_planilla.gs` | Daily 7am (check día 1 y 16) | Invoca Edge Function `kaeru-calcular-planilla` |
| `cron_propinas.gs` | Weekly Mon 7am | Invoca Edge Function `kaeru-calcular-propinas-semana` |
| `cron_alerta_pos_bac.gs` | Daily 11pm | Valida cierre POS BAC del día → alerta si no |
| `_lib.gs` | (no es trigger) | Funciones helper compartidas (HTTP a Supabase, etc.) |
