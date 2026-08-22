# Freakie Dogs ERP (caja / POS) — Instrucciones para Claude

> ERP + POS de **Freakie Dogs** (El Salvador): cadena de smash burgers fast-casual, ~$500K/mes, ~100 empleados, 6 sucursales activas + Casa Matriz. Este repo (`freakie-dogs-caja`) es la **PWA**: incluye la **caja / POS** (login por PIN, cobros, KDS, cierre de turno) **y** el back-office del ERP (finanzas, almacén, RRHH, delivery, producción, marketing, DTE). El módulo de facturación electrónica (**DTEaaS**) es **multi-tenant** y sirve a Freakie Dogs + Kaeru + Kako; los datos se aíslan por RLS.

## 🧭 Ritual de inicio — hacé esto ANTES de cualquier task
1. Leé **`Contexto/MAESTRO/Freakie_Dogs_Contexto_ERP_MAESTRO.md`** → fuente de verdad: estado por fase, decisiones arquitectónicas, stack, DB (50+ tablas), roles (21), módulos (27), flujos. Es un **mirror del proyecto en Notion**; si algo cambió de estado, está ahí. (Complemento: `Contexto/MAESTRO/CHANGELOG.md`.)
2. Leé **`memoria.md`** → decisiones y cambios recientes con su "por qué" (log, lo más nuevo arriba).
3. Contexto ampliado en **Notion**: https://www.notion.so/33324fa10edc81f7ade9f52985e6e27e (🍔 Freakie Dogs ERP).
   Consultalo con el Notion MCP (`notion-search` / `notion-fetch`) cuando la task toque algo que no esté en el repo (Roadmap, Pendientes, CHANGELOG, specs de módulos). El tablero **EN_PROGRESO — Coordinación Jose/Cesar** (`36324fa10edc81ecb9a2cd5a265aacd3`) es una subpágina para evitar colisiones al trabajar en paralelo.

> **Equipo:** Jose, Cesar y Frank trabajan el ERP en paralelo, cada uno con su propio Claude. Antes de tocar `MAESTRO.md`, `CHANGELOG.md`, schemas de Supabase o archivos críticos (`App.jsx`, `config.js`, FinanzasDashboard, BancoView, `dte-service`), revisá el tablero EN_PROGRESO y marcá lo que vas a tocar. El onboarding de cada uno está en `Contexto/MAESTRO/ONBOARDING_*.md`.

## Qué es y dónde corre
- **Stack:** PWA React + Vite + Tailwind v4 + shadcn/ui (Vercel, mobile-first, instalable) · Supabase (Postgres, Auth, Storage, Edge Functions Deno, Realtime, RLS) · pg_cron · Make.com · Telegram Bot · **DTEaaS** — facturación electrónica DTE Hacienda (Edge Function `dte-service`, firma digital con certs MH, multi-tenant por API key).
- **Supabase ref:** `btboxlwfqcbrdfrlnwln` (us-east-2, proyecto `freakie-dogs-erp`) — https://supabase.com/dashboard/project/btboxlwfqcbrdfrlnwln
  - La PWA en PROD pega a Supabase vía proxy `/sb` (Vercel `api/supaproxy`) para evitar bloqueos de DNS/ISP a `*.supabase.co`. En DEV local va directo (`src/supabase.js`).
- **Repo:** github.com/freakiedogs-oss/freakie-dogs-caja · **Deploy:** https://freakie-dogs-caja.vercel.app
- **TZ:** UTC-6 (El Salvador, sin DST).

## Convenciones de trabajo
- **Facturación (DTE Hacienda / DTEaaS): NO tocar sin pedir confirmación.** Hay documentos fiscales reales emitidos a Hacienda de por medio (POS↔DTEaaS en producción).
- **Multi-tenant / aislamiento por RLS:** todo dato va aislado por tenant/empresa + RLS. Nunca rompas el aislamiento entre Freakie Dogs, Kaeru y Kako.
- **POS / caja:** cambios en cobros, cierre de turno o KDS impactan operación en vivo — probá el build y verificá antes de pushear.
- **Anti-regresión (lección 18-Abr-2026):** antes de cada `git add`, `git pull --rebase origin main && git status` y confirmá que NO hay archivos modificados ajenos a tu sesión. Auditá TODOS los archivos de un commit sospechoso (un merge malo ya borró fixes en 6 archivos incluido `vercel.json`).
- **Al terminar algo material:**
  1. Actualizá `memoria.md` (qué cambió y por qué) — entrada nueva arriba.
  2. Si cambió el estado o una fase, actualizá el MAESTRO / CHANGELOG (idealmente también el Notion, que es el espejo maestro).
  3. Commit claro + `git push origin main`.
- **DB:** migraciones vía `apply_migration` (no `execute_sql` para DDL).
- Secretos (certs MH, service_role key, tokens, PINs) **jamás** en el repo ni en logs.

## Datos sensibles
El MAESTRO y varios docs de `docs/cowork/` contienen PINs y emails de usuarios reales, y recomendaciones de seguridad. Tratá esa información como confidencial: no la copies a otros archivos, artifacts ni mensajes. La `anon key` de Supabase es pública (va en el cliente); la `service_role key` y los certificados MH nunca deben aparecer en código ni logs.
