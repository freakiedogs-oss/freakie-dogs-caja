# Onboarding Cesar — Trabajar el ERP de Freakie Dogs con Claude (Cowork)

**Versión:** 1.0
**Fecha:** 17 de Mayo, 2026
**Autor:** Jose Isart (con Claude)
**Para:** Cesar Rodriguez — segundo desarrollador del ERP via Claude
**Nivel de acceso otorgado:** Full (mismo que Jose)

---

## 0. Resumen ejecutivo (5 minutos)

Vas a operar el ERP de Freakie Dogs con tu propia sesión de Claude (Cowork mode), en paralelo a la de Jose. La arquitectura colaborativa se basa en tres pilares:

1. **Notion + MAESTRO.md = cerebro compartido** (single source of truth conceptual)
2. **GitHub = fuente de verdad del código** (con branches por feature para evitar colisiones)
3. **Supabase = base de datos viva** (con migraciones registradas, no `execute_sql` ad-hoc para schema)

Cada Claude tiene memoria local independiente — la tuya arranca bootstrappeada con la de Jose (60+ patrones aprendidos) para que no tropieces con bugs ya resueltos.

**Reglas no negociables:**
- Antes de tocar nada, leer `CHANGELOG.md` (últimas 20 entradas)
- Si vas a editar `MAESTRO.md`, avisar en el tablero `EN_PROGRESO` de Notion
- Toda migración Supabase via `apply_migration` (no `execute_sql` para DDL)
- Toda edición de código via git branch + PR (no push directo a `main` sin coordinar)
- Idioma de trabajo: español

---

## 1. Pre-requisitos

Antes de empezar, asegurate de tener:

- [ ] Acceso a la cuenta de Supabase del proyecto `btboxlwfqcbrdfrlnwln` (Freakie Dogs)
- [ ] Acceso a la cuenta de Notion (workspace Freakie Dogs)
- [ ] Acceso al repositorio GitHub `freakie-dogs-caja` (collaborator role)
- [ ] Tu propia cuenta de Anthropic / Claude (NO compartir la de Jose)
- [ ] Claude desktop app instalada con Cowork mode habilitado
- [ ] Git instalado en tu laptop
- [ ] El repo clonado localmente — recomendado en `/Users/[tu-usuario]/Documents/Freakies/Claude/Freakie Dogs ERP/`

Si te falta alguno, Jose te lo gestiona.

---

## 2. Setup paso a paso de Cowork

### 2.1 Crear la carpeta de proyecto

```bash
mkdir -p ~/Documents/Freakies/Claude
cd ~/Documents/Freakies/Claude
git clone <url-repo-freakie-dogs-caja> "Freakie Dogs ERP"
cd "Freakie Dogs ERP"
git pull origin main
```

### 2.2 Abrir Cowork y seleccionar la carpeta

1. Abrí Claude desktop app
2. Activá **Cowork mode**
3. Click en el selector de carpeta → elegí `/Users/[tu-usuario]/Documents/Freakies/Claude/Freakie Dogs ERP`
4. Confirmá que Claude reconoce los archivos del repo (debería ver `MAESTRO/`, `Scripts/`, `vercel-deploy/`, etc.)

### 2.3 Pegar las project instructions

En Cowork, hay un campo de "project instructions" (instrucciones del proyecto). Pegá EXACTAMENTE esto:

```
Eres el arquitecto y desarrollador principal del ERP de Freakie Dogs,
una cadena de smash burgers en El Salvador con 8 locales y ~100 empleados.

FUENTE DE VERDAD — Sistema MAESTRO (3 archivos sincronizados):
1. MAESTRO.md → /Contexto/MAESTRO/Freakie_Dogs_Contexto_ERP_MAESTRO.md
   (Markdown — contexto completo: negocio, stack, 39 tablas, 19 flujos, 17 módulos, roadmap, pendientes)
2. MAESTRO.docx → /Contexto/MAESTRO/Freakie_Dogs_Contexto_ERP_MAESTRO.docx
   (Word profesional — se regenera con python-docx desde el .md)
3. HTML → /Contexto/MAESTRO/HTML/Freakie_Dogs_ERP_MAESTRO.html
   (Referencia visual — schema completo de BD campo por campo, diagramas de flujo)

Reglas:
- Consulta MAESTRO.md antes de responder sobre el negocio o el sistema
- Cuando recibas nueva información relevante, actualiza MAESTRO.md y regenera el .docx
- Registra cada cambio en CHANGELOG.md (/Contexto/MAESTRO/CHANGELOG.md)
- No crear versiones nuevas — editar el archivo MAESTRO existente
- El stack es: Supabase + PWA React/Vercel + Make.com + Telegram
- Prioriza eficiencia: evita usar el navegador Chrome cuando sea posible
- Idioma de trabajo: español
- Cuando creas conveniente sugiere cambiar el LLM a Haiku o Opus
- COLABORACIÓN: Jose también trabaja el ERP con su propio Claude.
  Antes de editar MAESTRO.md o archivos críticos, consultar el tablero EN_PROGRESO en Notion.
  Para features nuevas, trabajar en git branches separados.
```

### 2.4 Verificar primer arranque

Abrí una conversación y escribí: `Listame las últimas 5 entradas del CHANGELOG.md`

Si Claude las lee correctamente, el setup está OK.

---

## 3. Plugins a instalar

Estos son los plugins que Jose tiene activos y que debés instalar vos también. Búscalos en el marketplace de plugins de Cowork:

### Plugins esenciales del proyecto

| Plugin | Para qué sirve |
|--------|----------------|
| `freakie-github` | Contexto del repo, push/pull, commits via MCP de GitHub |
| `sync-notion` | Sincroniza MAESTRO.md + CHANGELOG.md a Notion automáticamente |
| `peya-import` | Importa ventas PeYa desde ZIPs JSON DTE |
| `anthropic-skills:docx` | Regenerar MAESTRO.docx |
| `anthropic-skills:pdf` | Para informes y exports |
| `anthropic-skills:xlsx` | Procesar Excels (TX_PENDIENTES, etc) |
| `anthropic-skills:doc-coauthoring` | Coautoría de documentos largos |

### MCPs a conectar (después de instalar plugins)

Estos te van a pedir autenticar al primer uso:

1. **Supabase MCP** — proyecto `btboxlwfqcbrdfrlnwln`
   - Te va a pedir token de servicio o login
   - Verificá con: `Listame las tablas del proyecto Supabase`
2. **Notion MCP** — workspace Freakie Dogs
   - OAuth flow
   - Página raíz: `33324fa1-0edc-81f7-ade9-f52985e6e27e`
   - Verificá con: `Buscá en Notion el documento MAESTRO`
3. **GitHub MCP** — repo `freakie-dogs-caja`
   - Personal Access Token con scope `repo`
   - Verificá con: `Listame los últimos 5 commits del repo`

---

## 4. Bootstrap de memoria — instrucciones

Jose va a exportarte un ZIP con su carpeta `memory/` + `MEMORY.md`. Esto contiene ~60 archivos con patrones aprendidos durante 6 meses de desarrollo (bugs recurrentes, atajos de BD, gotchas de Supabase, etc.).

**Cómo importarla a tu Claude:**

### Opción A — Importar al directorio de memoria de tu Cowork

Tu Claude tiene un directorio de memoria local. La ubicación exacta varía pero típicamente es:

```
~/Library/Application Support/Claude/[ids-internos]/memory/
```

Para descubrirla, abrí Claude y preguntá: `¿Cuál es la ruta exacta de tu directorio de memoria local?`

Una vez que tengas la ruta:

```bash
cd ~/Library/Application\ Support/Claude/[ruta-que-te-dio]/memory/
unzip ~/Downloads/jose_memory_export_2026-05-17.zip
```

Reiniciá Cowork. Tu Claude ahora arranca con todo el contexto acumulado.

### Opción B — Si la importación directa falla

Subí el ZIP a tu sesión de Cowork como archivo adjunto y decile:

> "Acá te paso el export de memoria de Jose. Importá cada archivo a tu carpeta de memoria local respetando la estructura, y actualizá tu MEMORY.md."

Claude lo va a hacer manualmente archivo por archivo. Más lento pero funciona.

### Verificación

Después de importar, preguntale: `¿Qué sabés sobre v_gastos_consolidados?` — debería mencionar la regla de prioridad `dte_clasificacion > catalogo_contable` y el patrón `LATERAL LIMIT 1`. Si lo dice, está bootstrapped correctamente.

---

## 5. Reglas de coordinación — LA PARTE CRÍTICA

Esto es lo que evita que ambos rompan el ERP simultáneamente. Leé esta sección dos veces.

### 5.1 Tablero EN_PROGRESO (Notion)

Hay una página en Notion llamada **"EN_PROGRESO — Coordinación Jose/Cesar"** en `/🍔 Freakie Dogs ERP/EN_PROGRESO — Coordinación Jose/Cesar`.

**URL directa:** https://www.notion.so/36324fa10edc81ecb9a2cd5a265aacd3

Funciona así:

- **Antes** de editar `MAESTRO.md`, `CHANGELOG.md`, schemas de Supabase, o archivos críticos (FinanzasDashboard, BancoView, App.jsx) — marcá en el tablero qué estás tocando
- **Durante** tu sesión, mantenelo actualizado (lo movés a "En progreso")
- **Al terminar**, lo marcás "Listo" con un link al commit

Formato sugerido por entrada:
```
[fecha] [Claude de Cesar/Jose] [archivo o módulo] [estado: planeando/en_progreso/listo] [link commit/PR]
```

Si ves que Jose ya está tocando lo mismo, **pará** y coordinen por WhatsApp/Slack.

### 5.2 Workflow de Git (obligatorio para features)

Nunca pushees directo a `main` para features nuevas. Workflow:

```bash
# 1. Antes de empezar
git checkout main
git pull origin main

# 2. Crear branch
git checkout -b feat/cesar/nombre-feature

# 3. Trabajar normalmente (Claude edita archivos, vos pusheás)
git add .
git commit -m "feat: descripción clara"
git push origin feat/cesar/nombre-feature

# 4. Crear PR en GitHub
# Avisar a Jose para review/merge
```

**Excepción — hotfixes urgentes:** podés pushear directo a `main` si:
- Es producción rota (UI no carga, RPC retorna 500, etc.)
- Avisaste primero por WhatsApp
- Registrás el cambio en CHANGELOG.md inmediatamente

### 5.3 Supabase — esquema y datos

**Para cambios de esquema (DDL):**
- Siempre `apply_migration` con nombre descriptivo (`add_index_bank_tx_estado_fecha`)
- Nunca `execute_sql` con DDL (no queda registrado, Jose no sabe qué cambió)
- Después de aplicar: registrar en CHANGELOG con la migración

**Para datos (DML):**
- `execute_sql` para SELECTs, UPDATEs, INSERTs puntuales está bien
- Para UPDATEs masivos (>5K filas): usar staging table + UPDATE FROM (ver `feedback_bulk_update_strategy.md` en tu memoria)
- Imports masivos (CSV, ZIPs): usar skills `peya-import` o RPCs como `import_peya_jsonb`

**Después de imports masivos a `quanto_transacciones` o similares:**
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_finanzas_gastos_mensual;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_finanzas_ventas_mensual;
REFRESH MATERIALIZED VIEW CONCURRENTLY v_ventas_unificadas;
```

### 5.4 MAESTRO.md — el candado conceptual

`MAESTRO.md` es el archivo más sagrado. Reglas estrictas:

1. **Antes de editar:** verificá en EN_PROGRESO si Jose lo está tocando
2. **Después de editar:** correr el skill `sync-notion` para subirlo
3. **Si dos editan a la vez:** quien pushee segundo hace `git pull --rebase` y resuelve conflictos manualmente
4. **Cambios estructurales** (renombrar tabla, agregar módulo, deprecar dashboard) — avisar a Jose por WhatsApp ANTES

### 5.5 CHANGELOG.md — registro de todo

Toda sesión que modifica algo debe terminar agregando una entrada al CHANGELOG. Formato:

```
| [fecha DD-Mmm-YYYY] | **[Título corto]** [Descripción detallada de qué se hizo, qué se rompió, qué quedó pendiente] | [Archivos/tablas afectadas] |
```

Si la entrada es larga (>500 palabras), bienvenido al club — Jose escribe así también.

---

## 6. Workflow diario sugerido

### Al iniciar sesión

1. Abrir Cowork con la carpeta del proyecto
2. Pedir: `Listame las últimas 5 entradas del CHANGELOG y decime si hay algo nuevo desde mi última sesión`
3. Pedir: `Revisá el tablero EN_PROGRESO en Notion y decime qué está tocando Jose`
4. Decidir qué vas a hacer hoy

### Durante el trabajo

- Marcar tu trabajo en EN_PROGRESO
- Si vas a tocar un módulo grande, leer primero la sección correspondiente de MAESTRO.md
- Usar `git pull` cada vez que vuelvas de un break (Jose puede haber pusheado)
- Para queries complejas a Supabase, pedirle a Claude que primero explique el plan

### Al terminar sesión

1. Commit + push (o PR si es feature grande)
2. Update del CHANGELOG.md
3. Si modificaste MAESTRO.md → correr skill `sync-notion`
4. Marcar tu trabajo en EN_PROGRESO como "listo"

---

## 7. Casos de uso comunes

### 7.1 "Quiero agregar un nuevo dashboard"

```
1. Crear branch feat/cesar/dashboard-X
2. Pedirle a Claude: "Leé MAESTRO.md sección 17 (Módulos PWA) y proponé un diseño para dashboard X"
3. Iterar el diseño
4. Implementar en src/components/dashboard/
5. Replicar el archivo en vercel-deploy/src/components/dashboard/ (Vercel usa ese folder)
6. Verificar permisos por rol en src/permisos.js
7. Agregar entrada al menú en src/config.js
8. Test local con npm run dev
9. PR a main, esperar review de Jose
```

### 7.2 "Quiero importar datos masivos"

```
1. Si es PeYa ZIP: usar skill peya-import directamente
2. Si es CSV/Excel:
   a. Pedirle a Claude que analice el formato del archivo
   b. Crear staging table en Supabase: CREATE TEMP TABLE stg_xxx AS SELECT ...
   c. Cargar via INSERT en batches (250 filas)
   d. UPDATE FROM staging a tabla destino
   e. REFRESH MATERIALIZED VIEW de las MVs afectadas
   f. Verificar con COUNT() final
3. Registrar en CHANGELOG: cuántas filas, qué tabla, qué fecha
```

### 7.3 "Quiero arreglar un bug reportado"

```
1. Reproducir: pedirle a Claude que SELECT del estado actual
2. Diagnosticar: si es de código → grep src/, si es de BD → EXPLAIN ANALYZE
3. Verificar memoria local: "¿hay algún feedback relevante a este bug?"
4. Si el fix toca MAESTRO o esquema → revisar EN_PROGRESO antes
5. Hotfix branch: hotfix/cesar/descripcion-bug
6. Test
7. Push o PR según urgencia
```

### 7.4 "Necesito entender qué hace una vista/RPC"

```
1. Pedirle a Claude: "Mostrame la definición actual de [v_xxx / fn_xxx]"
2. Claude corre: SELECT pg_get_viewdef('v_xxx') o pg_get_functiondef('fn_xxx'::regproc)
3. Si te confunde, pedirle: "Explicame esa vista paso a paso"
```

---

## 8. Tools y skills que vas a usar todos los días

| Herramienta | Cuándo |
|-------------|--------|
| `mcp__0aba5879__execute_sql` | Queries Supabase puntuales |
| `mcp__0aba5879__apply_migration` | Cambios de esquema BD |
| `mcp__0aba5879__list_tables` | Explorar BD |
| `mcp__plugin_freakie-github_github__*` | Operaciones GitHub |
| `mcp__c0a55be1__notion-*` | Leer/escribir Notion |
| Skill `sync-notion` | Después de editar MAESTRO/CHANGELOG |
| Skill `peya-import` | Importar ventas PeYa |
| Skill `docx` | Regenerar MAESTRO.docx |

---

## 9. Troubleshooting

### "Claude no encuentra MAESTRO.md"
- Verificá que seleccionaste la carpeta correcta en Cowork
- Pedile: `Mostrame el listado de archivos en /Contexto/MAESTRO/`

### "MCP de Supabase me devuelve 401"
- Token expirado o mal configurado
- Re-autenticar via MCP settings
- Verificá con `mcp__0aba5879__get_project`

### "Pushé y se rompió el deploy de Vercel"
- Revisar `vercel-deploy/src/` — si modificaste `src/` pero no replicaste a `vercel-deploy/src/`, Vercel no ve el cambio
- Regla: TODO cambio en `src/components/` debe replicarse a `vercel-deploy/src/components/`
- Hotfix: `cp src/components/X.jsx vercel-deploy/src/components/X.jsx && git commit && git push`

### "Quiero hacer algo pero Jose ya lo está haciendo"
- Pausa. WhatsApp a Jose. Coordinen.
- Si es urgente y no responde: trabajalo en un branch propio que NO toque lo que él toca, y mergéalo cuando libere.

### "Supabase me da timeout en queries"
- Tabla `quanto_ordenes` tiene 62K+ filas. Siempre `LIMIT` o filtros por fecha
- Usar `fetchPaginated` (helper en `src/utils/fetchPaginated.js`) para >1000 filas
- Para imports masivos, batches de 250

### "Modifiqué algo y el dashboard rompe en producción"
- `git revert <commit-hash> && git push` → revierte solo el frontend, BD queda OK
- Reportar en CHANGELOG qué se revirtió y por qué
- Investigar en branch separado

---

## 10. Checklist primer día de Cesar

- [ ] Acceso a Supabase verificado (login OK, ves el proyecto btboxlwfqcbrdfrlnwln)
- [ ] Acceso a Notion verificado (ves el workspace Freakie Dogs)
- [ ] Acceso a GitHub repo verificado (podés hacer `git clone`)
- [ ] Repo clonado localmente en `~/Documents/Freakies/Claude/Freakie Dogs ERP/`
- [ ] Cowork instalado y configurado con la carpeta del repo
- [ ] Project instructions pegadas (sección 2.3 de este doc)
- [ ] 7 plugins instalados (sección 3)
- [ ] 3 MCPs conectados y verificados (Supabase, Notion, GitHub)
- [ ] Memoria de Jose importada — preguntar "¿qué sabés sobre v_gastos_consolidados?" para verificar
- [ ] Tablero EN_PROGRESO en Notion ubicado
- [ ] Leídas las secciones 5 (Coordinación) y 6 (Workflow diario) de este doc
- [ ] WhatsApp/Slack abierto con Jose para coordinación humana
- [ ] Primer "hola mundo": leer las últimas 5 entradas del CHANGELOG y mencionar en Notion que ya estás operativo

---

## 11. Patrones críticos del ERP (cheat sheet)

Cosas que vas a usar mucho y querés saber de memoria:

### Sucursales y `store_code`

| Código | Nombre | Notas |
|--------|--------|-------|
| M001 | Plaza Cafetalón | Tiene propina 10% |
| S004 | Paseo Venecia | Tiene propina 10% |
| S003 | Grand Plaza Lourdes | Tiene propina 10% |
| S005 | Drive Thru Lourdes | **Fusionar con S003 en dashboards** (`MERGE_MAP = { S005: 'S003' }`) |
| S001 | Plaza Mundo Soyapango | Food court |
| S002 | Plaza Mundo Usulután | Food court |
| S006, S007, S008 | No abiertas | `activa=false`, ocultar en dashboards |
| CM001 | Casa Matriz | Producción/bodega |

### Roles principales

- `admin` / `superadmin` — Jose, vos
- `ejecutivo` — gerencia, ven dashboards completos
- `gerente` — gerentes de sucursal
- `rrhh` — Maria Jose (PIN 7700)
- `eventos` — Merari Avalos (PIN 7441)
- `usuario` — staff regular

PINs claves:
- Jose: 1000
- Cesar: 2000
- Ambos rol `ejecutivo`

### Vistas/MATVIEWs críticas

- `v_gastos_consolidados` — UNION ALL de 6 fuentes de gastos, refactorizada 11-may
- `mv_finanzas_gastos_mensual` — agregación mensual, refresh cada 30 min
- `v_kpis_venta_canal` — dashboard de ventas por canal
- `v_data_disponible_resumen` — hasta qué fecha hay data
- `quanto_ordenes` + `quanto_orden_items` — SOT de ventas (61K+ órdenes)
- `compras_dte` — DTEs recibidos, UNIQUE en `codigo_generacion`
- `bank_transacciones` — 2,981 tx ~80% clasificadas

### Pipelines automáticos

- **GAS DTE v2** — Google Apps Script que pulla Gmail cada 30 min, parsea JSON DTE, inserta en `compras_dte`
- **pg_cron jobs** — varios refreshes de MATVIEWs cada 30 min, watchdog gap proveedores, etc.
- **Make.com** — DEPRECADO desde 20-Abr-2026. No usar.

---

## 12. Pendientes conocidos (estado al 17-May-2026)

Heredás esto. NO los toques sin coordinar con Jose:

- Long tail 832 bank_tx sin_clasificar ($511K) — Fase B FIFO matching pendiente
- 4 catálogos potencialmente mal categorizados (ROMENA, AUTOFACIL, TS CAPITAL, PROMAICA)
- Serfinsa portal bulk import (~$14K gap Mar-May 2026)
- 17 aportes no-redondos Jose pendientes de confirmar ID específico
- BancoView fases 1-8 (diseño completo, falta implementación)
- WhatsApp Business API integración (atrasada desde 27-Mar)
- TikTok scraping (en revisión)
- DGII bloqueador: validar cambio Quanto → ERP antes go-live (consultar con Angel Ortiz)

---

## 13. Quién es quién (mini directorio)

- **Jose Isart** — Dueño, arquitecto principal del ERP. PIN 1000.
- **Cesar Rodriguez** — Vos. Segundo desarrollador. PIN 2000.
- **Maria Jose** — RRHH. PIN 7700. Maneja módulo RRHHView.
- **Merari Avalos** — Eventos. PIN 7441. Maneja módulo EventosView.
- **Marco** — Operaciones DTE (recibe por_confirmar de auto-recepción).
- **Angel Ortiz** — Contador/asesor fiscal externo. Validador DGII.
- **Francisco Siguenza** — Operaciones financieras (cuentas terceros, transferencias).

---

## 14. Recursos finales

- **Repo GitHub:** `freakie-dogs-caja`
- **Supabase project:** `btboxlwfqcbrdfrlnwln`
- **Notion workspace raíz:** `33324fa1-0edc-81f7-ade9-f52985e6e27e`
- **Producción PWA:** Vercel (deploy desde branch `main` de `vercel-deploy/`)
- **DTE Service producción:** v1.24.0 (v32)

---

**Última pregunta antes de empezar:** ¿Leíste todo? Si llegaste hasta acá, escribile a Jose por WhatsApp: "Listo, ONBOARDING leído, empiezo." Y arrancá con el checklist de la sección 10.

Bienvenido al equipo. El ERP está vivo y respira — cuidalo.
