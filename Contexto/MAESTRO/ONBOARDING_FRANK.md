# Onboarding Frank — Trabajar el ERP de Freakie Dogs con Claude (Cowork)

**Versión:** 1.0
**Fecha:** 20 de Agosto, 2026
**Autor:** Cesar Rodriguez (con Claude)
**Para:** Frank (Francisco Siguenza) — tercer desarrollador del ERP via Claude
**Nivel de acceso otorgado:** Full (mismo que Jose y Cesar)
**Equipo:** Mac

---

## 0. Resumen ejecutivo (5 minutos)

Vas a operar el ERP de Freakie Dogs con tu propia sesión de Claude (Cowork mode), en paralelo a las de Jose y Cesar. La arquitectura colaborativa se basa en tres pilares:

1. **Notion + MAESTRO.md = cerebro compartido** (fuente de verdad conceptual)
2. **GitHub = fuente de verdad del código** (branches por feature, `main` está protegido)
3. **Supabase = base de datos viva** (migraciones registradas, no `execute_sql` para schema)

Cada Claude tiene memoria local independiente — la tuya arranca bootstrappeada con la de Cesar para que no tropieces con bugs ya resueltos.

**Reglas no negociables:**

- Antes de tocar nada, leer `CHANGELOG.md` (últimas 20 entradas)
- Si vas a editar `MAESTRO.md`, avisar en el tablero `EN_PROGRESO` de Notion
- Toda migración Supabase via `apply_migration` (no `execute_sql` para DDL)
- `main` está protegido: todo va por branch + PR
- **Facturación DTE / DTEaaS: no tocar sin confirmación explícita de Jose o Cesar** — hay documentos fiscales reales emitidos a Hacienda de por medio
- Idioma de trabajo: español

---

## 1. Pre-requisitos

Antes de empezar, Cesar te tiene que dar:

- [ ] Invitación a Supabase, proyecto `btboxlwfqcbrdfrlnwln` (Freakie Dogs)
- [ ] Invitación al workspace de Notion (Freakie Dogs)
- [ ] Rol `collaborator` en el repo GitHub `freakiedogs-oss/freakie-dogs-caja` (lo otorga Jose, es dueño de la cuenta)

Tu usuario del ERP **ya existe** (Francisco Siguenza, rol `ejecutivo`) — usás el mismo PIN de siempre.

Y vos tenés que tener:

- [ ] Tu propia cuenta de Anthropic / Claude (**no compartir la de Cesar ni la de Jose**)
- [ ] Claude desktop app instalada con Cowork mode
- [ ] Git instalado (`git --version` en Terminal; si no lo tenés, `xcode-select --install`)

---

## 2. Setup paso a paso de Cowork

### 2.1 Clonar el repo

Abrí Terminal y corré:

```bash
mkdir -p ~/Documents/Freakies/Claude
cd ~/Documents/Freakies/Claude
git clone https://github.com/freakiedogs-oss/freakie-dogs-caja.git
cd freakie-dogs-caja
git pull origin main
```

Configurá tu identidad y evitá el problema de fines de línea:

```bash
git config user.name "Frank"
git config user.email "tu-email@ejemplo.com"
git config core.autocrlf false
```

> **Si ya venías usando Claude en la Mac mini** (el setup aislado de ingesta de pagos): eso sigue como está, no lo toques. Este onboarding es una sesión aparte, apuntada al repo del ERP. Son dos cosas distintas conviviendo.

### 2.2 Abrir Cowork y seleccionar la carpeta

1. Abrí Claude desktop app
2. Activá **Cowork mode**
3. Click en el selector de carpeta → elegí `~/Documents/Freakies/Claude/freakie-dogs-caja`
4. Confirmá que Claude ve el repo: debería reconocer `src/`, `Contexto/MAESTRO/`, `android-driver/`, `api/`

**No hace falta pegar project instructions a mano.** El repo ya trae un `CLAUDE.md` en la raíz que Claude lee solo al arrancar. Ahí están las reglas del proyecto.

### 2.3 Verificar primer arranque

Abrí una conversación y escribí:

```
Listame las últimas 5 entradas del CHANGELOG.md
```

Si Claude las lee correctamente, el setup está OK.

---

## 3. Plugins y MCPs

### Plugins a instalar

Buscalos en el marketplace de plugins de Cowork:

| Plugin | Para qué sirve |
|--------|----------------|
| `freakie-github` | Contexto del repo, commits y PRs via MCP de GitHub |
| `sync-notion` | Sincroniza MAESTRO.md + CHANGELOG.md a Notion |
| `peya-import` | Importa ventas PeYa desde ZIPs de JSON DTE |
| `anthropic-skills:docx` | Regenerar MAESTRO.docx |
| `anthropic-skills:xlsx` | Procesar Excels (bancos, planilla, inventario) |
| `anthropic-skills:pdf` | Informes y exports |
| `anthropic-skills:doc-coauthoring` | Documentos largos |

Los archivos de los plugins propios están en `Contexto/MAESTRO/onboarding-cesar/plugins-y-skills/`.

### MCPs a conectar

Cada uno te pide autenticar la primera vez:

**1. Supabase MCP** — proyecto `btboxlwfqcbrdfrlnwln`
Verificá con: `Listame las tablas del proyecto Supabase`

**2. Notion MCP** — workspace Freakie Dogs
Página raíz: `33324fa1-0edc-81f7-ade9-f52985e6e27e`
Verificá con: `Buscá en Notion el documento MAESTRO`

**3. GitHub MCP** — repo `freakie-dogs-caja`
Necesita un Personal Access Token **tuyo** con scope `repo`. Lo generás en github.com → Settings → Developer settings → Personal access tokens. **No uses el de nadie más.**
Verificá con: `Listame los últimos 5 commits del repo`

---

## 4. Bootstrap de memoria

Tu Claude arranca sin memoria propia. Hay dos fuentes para bootstrappearlo.

### 4.1 Memoria de Cesar (ya está en el repo)

En `Contexto/MAESTRO/onboarding-frank/memoria-cesar/` hay 3 notas sobre el proyecto de delivery y el GPS de motoristas — incluyendo las trampas del APK que costaron horas de debug.

Para importarlas, abrí Cowork y decile:

> "Leé los archivos de `Contexto/MAESTRO/onboarding-frank/memoria-cesar/` e importalos a tu memoria local, respetando el formato y actualizando tu MEMORY.md."

### 4.2 Memoria de Jose (pedísela)

Jose tiene ~60 archivos con patrones acumulados durante meses: bugs recurrentes de Supabase, gotchas de vistas, estrategias de bulk update. **Eso es lo que de verdad acelera.** Pedile que corra `Contexto/MAESTRO/onboarding-cesar/exportar_memoria.sh` y te mande el ZIP.

Para importarlo, averiguá dónde vive tu memoria. Preguntale a Claude:

```
¿Cuál es la ruta exacta de tu directorio de memoria local?
```

Con esa ruta:

```bash
cd "<la-ruta-que-te-dio>"
unzip ~/Downloads/jose_memory_export_XXXX-XX-XX.zip
```

Reiniciá Cowork.

**Si la importación directa falla** (la carpeta puede no ser accesible desde Terminal): subí el ZIP a tu sesión de Cowork como adjunto y decile que importe cada archivo respetando la estructura.

### Verificación

Preguntale: `¿Qué sabés sobre v_gastos_consolidados?` — debería mencionar la regla de prioridad `dte_clasificacion > catalogo_contable`. Si lo dice, quedó bootstrapped.

---

## 5. Reglas de coordinación — LA PARTE CRÍTICA

Ahora son **tres** Claudes trabajando el mismo ERP. Esta sección es lo que evita que se pisen. Leela dos veces.

### 5.1 Tablero EN_PROGRESO (Notion)

Página **"EN_PROGRESO — Coordinación Jose/Cesar"**:
https://www.notion.so/36324fa10edc81ecb9a2cd5a265aacd3

- **Antes** de editar `MAESTRO.md`, `CHANGELOG.md`, schemas de Supabase, o archivos críticos (`App.jsx`, `config.js`, FinanzasDashboard, BancoView, `dte-service`) — marcá qué estás tocando
- **Durante** la sesión, mantenelo actualizado
- **Al terminar**, marcalo "Listo" con link al commit

Formato por entrada:

```
[fecha] [Claude de Frank] [archivo o módulo] [estado: planeando/en_progreso/listo] [link commit/PR]
```

Si ves que Jose o Cesar ya están en lo mismo, **pará** y coordinen por WhatsApp.

### 5.2 Workflow de Git

**`main` está protegido** — no se puede pushear directo, ni siquiera queriendo. Todo va por PR.

```bash
# 1. Antes de empezar
git checkout main
git pull origin main

# 2. Crear branch
git checkout -b frank/nombre-feature

# 3. Trabajar (Claude edita, vos commiteás)
git add <archivos-específicos>
git commit -m "descripción clara"
git push origin frank/nombre-feature

# 4. Crear PR en GitHub y avisar a Cesar para review/merge
```

**Anti-regresión (lección 18-Abr-2026):** antes de cada `git add`, corré `git pull --rebase origin main && git status` y confirmá que NO hay archivos modificados ajenos a tu sesión. Un merge malo ya borró fixes en 6 archivos, incluido `vercel.json`. **Agregá archivos por nombre, no `git add .`**

### 5.3 Supabase — esquema y datos

**Cambios de esquema (DDL):**

- Siempre `apply_migration` con nombre descriptivo (`add_index_bank_tx_estado_fecha`)
- Nunca `execute_sql` con DDL — no queda registrado y los otros no saben qué cambió
- Después de aplicar: registrar en CHANGELOG

**Datos (DML):**

- `execute_sql` para SELECTs, UPDATEs e INSERTs puntuales está bien
- UPDATEs masivos (>5K filas): staging table + `UPDATE FROM`
- Imports masivos: skill `peya-import` o RPCs como `import_peya_jsonb`

**Multi-tenant:** el módulo DTEaaS sirve a Freakie Dogs + Kaeru + Kako, aislados por RLS. **Nunca rompas ese aislamiento.** Toda query y toda tabla nueva respeta el tenant.

**Después de imports masivos:**

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_finanzas_gastos_mensual;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_finanzas_ventas_mensual;
```

### 5.4 MAESTRO.md — el candado conceptual

1. **Antes de editar:** verificá EN_PROGRESO
2. **Después de editar:** correr el skill `sync-notion`
3. **Si dos editan a la vez:** quien pushee segundo hace `git pull --rebase` y resuelve a mano
4. **Cambios estructurales** (renombrar tabla, agregar módulo, deprecar dashboard) — avisar por WhatsApp ANTES

### 5.5 CHANGELOG.md

Toda sesión que modifica algo termina agregando una entrada:

```
| [fecha DD-Mmm-YYYY] | **[Título corto]** [Qué se hizo, qué se rompió, qué quedó pendiente] | [Archivos/tablas afectadas] |
```

### 5.6 Zonas de cuidado especial

| Zona | Por qué | Regla |
|------|---------|-------|
| **DTE / DTEaaS** (`dte-service`, `compras_dte`) | Documentos fiscales reales ante Hacienda | No tocar sin confirmación de Jose o Cesar |
| **POS / caja** (`src/pos/`, cobros, cierre de turno, KDS) | Impacta operación en vivo | Probar el build antes de pushear |
| **Finanzas** (P&L, planilla, bancos) | Datos sensibles, gate por sesión de staff | Leer `api/supaproxy.js` antes de tocar |
| **Driver / delivery** (`src/driver/`, `android-driver/`) | Motoristas en la calle dependen de esto | Avisar antes de deployar en horario pico |

### 5.7 Datos confidenciales

El MAESTRO y varios docs de `docs/cowork/` contienen **PINs y emails de usuarios reales**. Tratalos como confidenciales: no los copies a otros archivos, artifacts, ni mensajes.

- La `anon key` de Supabase es pública (va en el bundle del cliente) — está bien que aparezca en código
- La `service_role key`, los certificados MH y los PINs **jamás** van al repo ni a logs

---

## 6. Workflow diario sugerido

**Al iniciar sesión:**

1. Abrir Cowork con la carpeta del repo
2. `git pull origin main`
3. Pedir: `Listame las últimas 5 entradas del CHANGELOG y decime si hay algo nuevo`
4. Pedir: `Revisá el tablero EN_PROGRESO en Notion y decime qué están tocando Jose y Cesar`

**Durante:**

- Marcar tu trabajo en EN_PROGRESO
- Antes de tocar un módulo grande, leer su sección en MAESTRO.md
- `git pull` cada vez que volvés de un break
- Para queries complejas, pedirle a Claude que primero explique el plan

**Al terminar:**

1. Commit + push + PR
2. Entrada en CHANGELOG.md
3. Si tocaste MAESTRO.md → skill `sync-notion`
4. Marcar EN_PROGRESO como "listo"

---

## 7. Casos de uso comunes

### 7.1 Agregar un dashboard nuevo

```
1. git checkout -b frank/dashboard-X
2. "Leé MAESTRO.md sección de Módulos PWA y proponé un diseño para dashboard X"
3. Iterar el diseño
4. Implementar en src/components/dashboard/
5. Verificar permisos por rol en src/permisos.js
6. Agregar la entrada al menú en src/config.js
7. npm run dev y probar local
8. PR a main
```

> **Nota:** la carpeta `vercel-deploy/` que aparece en docs viejos **ya no existe**. Vercel buildea directo desde `src/`. Si un doc te dice que repliques archivos ahí, está desactualizado.

### 7.2 Importar datos masivos

```
1. PeYa ZIP → skill peya-import directamente
2. CSV/Excel:
   a. Que Claude analice el formato
   b. Staging table en Supabase
   c. INSERT en batches de 250
   d. UPDATE FROM staging a destino
   e. REFRESH de las MVs afectadas
   f. COUNT() final de verificación
3. Registrar en CHANGELOG: cuántas filas, qué tabla, qué fecha
```

**Ojo con la paginación:** Supabase corta en 1000 filas por defecto. Para verificar totales, siempre `SELECT SUM(...)` directo en BD, no sumando lo que devolvió el cliente.

### 7.3 Arreglar un bug reportado

```
1. Reproducir: SELECT del estado actual
2. Diagnosticar: código → grep src/ · BD → EXPLAIN ANALYZE
3. Consultar memoria: "¿hay algún feedback relevante a este bug?"
4. Si toca MAESTRO o esquema → revisar EN_PROGRESO
5. Branch frank/fix-descripcion
6. Probar
7. PR
```

### 7.4 Entender una vista o RPC

```
"Mostrame la definición actual de [v_xxx / fn_xxx]"
```

Claude corre `pg_get_viewdef` o `pg_get_functiondef`. Si te confunde: `"Explicame esa vista paso a paso"`.

---

## 8. Troubleshooting

**"Claude no encuentra MAESTRO.md"**
Verificá que seleccionaste la carpeta correcta. Pedile: `Mostrame el listado de archivos en /Contexto/MAESTRO/`

**"MCP de Supabase me devuelve 401"**
Token expirado. Re-autenticar en MCP settings.

**"No puedo pushear a main"**
Es a propósito — `main` está protegido. Creá branch y PR.

**"Supabase me da timeout"**
`quanto_ordenes` tiene 62K+ filas. Siempre `LIMIT` o filtro por fecha. Para >1000 filas usar `fetchPaginated` (`src/utils/fetchPaginated.js`).

**"Rompí producción"**
`git revert <commit-hash>` → PR → merge. Revierte el frontend, la BD queda como está. Registrar en CHANGELOG qué se revirtió y por qué.

**"La PWA no conecta a Supabase desde un celular"**
Algunos ISPs de El Salvador bloquean `*.supabase.co` por DNS. La PWA en producción pega por el proxy `/sb` (ver `api/supaproxy.js` y `src/supabase.js`). Todo código nuevo que hable con Supabase desde un cliente tiene que usar ese proxy, no la URL directa.

---

## 9. Cheat sheet del ERP

### Sucursales y `store_code`

| Código | Nombre | Notas |
|--------|--------|-------|
| M001 | Plaza Cafetalón | Propina 10% |
| S001 | Plaza Mundo Soyapango | Food court |
| S002 | Plaza Mundo Usulután | Food court |
| S003 | Grand Plaza Lourdes | Propina 10% |
| S004 | Paseo Venecia | Propina 10% |
| S005 | Drive Thru Lourdes | **Fusionar con S003 en dashboards** (`MERGE_MAP = { S005: 'S003' }`) |
| CM001 | Casa Matriz | Producción / bodega |
| S006–S008 | No abiertas | `activa=false`, ocultar en dashboards |

### Roles

`superadmin` · `admin` · `ejecutivo` (gerencia, dashboards completos) · `gerente` (sucursal) · `rrhh` · `eventos` · `motorista` · `usuario`

Los PINs están en el MAESTRO. **No los copies a otros documentos.**

### Objetos críticos de BD

- `v_gastos_consolidados` — UNION ALL de 6 fuentes de gastos
- `mv_finanzas_gastos_mensual` / `mv_finanzas_ventas_mensual` — refresh cada 30 min por pg_cron
- `quanto_ordenes` + `quanto_orden_items` — fuente de verdad de ventas (62K+ órdenes)
- `compras_dte` — DTEs recibidos, UNIQUE en `codigo_generacion`
- `bank_transacciones` — ~2,981 tx
- `driver_ubicaciones` — posición viva de motoristas
- `pos_menu_items`, `receta_ingredientes` — menú y costeo

### Stack y entornos

- **PWA:** React + Vite + Tailwind v4 + shadcn/ui → Vercel
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions Deno, Realtime, RLS) + pg_cron
- **DTEaaS:** Edge Function `dte-service`, firma digital con certs MH, multi-tenant por API key
- **Repo:** github.com/freakiedogs-oss/freakie-dogs-caja
- **Producción:** https://freakie-dogs-caja.vercel.app
- **TZ:** UTC-6 (El Salvador, sin DST)
- **Make.com:** DEPRECADO desde 20-Abr-2026, no usar

---

## 10. Checklist primer día

- [ ] Acceso a Supabase verificado (ves el proyecto `btboxlwfqcbrdfrlnwln`)
- [ ] Acceso a Notion verificado (ves el workspace Freakie Dogs)
- [ ] `git clone` del repo funcionó
- [ ] `git config core.autocrlf false` aplicado
- [ ] Cowork configurado con la carpeta del repo
- [ ] Claude lee el `CLAUDE.md` del repo (preguntale: `¿cuáles son las reglas del proyecto?`)
- [ ] 7 plugins instalados
- [ ] 3 MCPs conectados y verificados (Supabase, Notion, GitHub)
- [ ] Memoria de Cesar importada y verificada
- [ ] Tablero EN_PROGRESO ubicado en Notion
- [ ] Leídas las secciones 5 (Coordinación) y 6 (Workflow diario)
- [ ] Grupo de WhatsApp con Jose y Cesar
- [ ] Primer "hola mundo": leer las últimas 5 entradas del CHANGELOG y avisar en EN_PROGRESO que ya estás operativo

---

## 11. Quién es quién

- **Jose Isart** — Dueño, arquitecto principal del ERP
- **Cesar Rodriguez** — Segundo desarrollador, quien te está onboardeando
- **Francisco Siguenza (Frank)** — Vos. Operaciones financieras + tercer desarrollador
- **Maria Jose** — RRHH, módulo RRHHView
- **Merari Avalos** — Eventos, módulo EventosView
- **Karina** — Torre de delivery / despacho
- **Marco** — Operaciones DTE
- **Angel Ortiz** — Contador / asesor fiscal externo, validador DGII

---

## 12. Recursos

- **Repo:** `freakiedogs-oss/freakie-dogs-caja`
- **Supabase:** `btboxlwfqcbrdfrlnwln` (us-east-2)
- **Notion raíz:** `33324fa1-0edc-81f7-ade9-f52985e6e27e` (🍔 Freakie Dogs ERP)
- **EN_PROGRESO:** `36324fa10edc81ecb9a2cd5a265aacd3`
- **Producción:** https://freakie-dogs-caja.vercel.app
- **MAESTRO.md:** `Contexto/MAESTRO/Freakie_Dogs_Contexto_ERP_MAESTRO.md`
- **CHANGELOG.md:** `Contexto/MAESTRO/CHANGELOG.md`

---

**Cuando termines el checklist**, escribile a Cesar: "Listo, onboarding completo, empiezo."

Bienvenido al equipo. El ERP está vivo y respira — cuidalo.
