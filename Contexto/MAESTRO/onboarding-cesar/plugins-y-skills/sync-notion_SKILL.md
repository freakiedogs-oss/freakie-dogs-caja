---
name: sync-notion
description: "Sincronizar MAESTRO.md y CHANGELOG.md con Notion. Usar SIEMPRE después de modificar MAESTRO.md, al actualizar el CHANGELOG, o cuando el usuario pida 'sync notion', 'actualizar notion', 'sincronizar notion', 'sube a notion', 'notion update'. También usar cuando se detecte que MAESTRO.md fue editado en la sesión actual. MANDATORY TRIGGER: cualquier edición a MAESTRO.md o CHANGELOG.md debe terminar invocando este skill."
---

# Sync Notion — Freakie Dogs ERP

Sincroniza el contenido de MAESTRO.md y CHANGELOG.md con las 32 páginas del workspace Notion de Freakie Dogs.

## Contexto

Notion es la memoria compartida del equipo. Página raíz: `33324fa1-0edc-81f7-ade9-f52985e6e27e`.
Cuenta: freakiedogs@gmail.com. Credenciales (§6.7) NUNCA se suben.

## Cómo funciona

### Paso 1 — Identificar qué cambió

Lee MAESTRO.md y compara con las secciones que se editaron en esta sesión. Si no es obvio qué cambió, pregunta al usuario o revisa el diff con git.

### Paso 2 — Mapear sección → página Notion

Usa este mapeo para encontrar la página correcta:

| Sección MAESTRO | Página Notion (buscar por título) |
|---|---|
| §1 Novedades | Novedades v6.0 |
| §2 Perfil del Negocio | Perfil del Negocio |
| §3 Sucursales | Sucursales |
| §4 Métodos de Pago | Métodos de Pago y Flujo de Efectivo |
| §5 Operaciones Delivery | Operaciones de Delivery |
| §6 Sistemas Existentes | Sistemas y Tecnología Existente |
| §6.1-6.5 Stack/Arquitectura | Stack y Arquitectura |
| §7-8 Base de Datos | Base de Datos — 50+ Tablas |
| §9 Roles y Permisos | Roles y Permisos |
| §10 Módulos ERP | Módulos del ERP — 17 Módulos |
| §11 Flujos de Trabajo | Flujos de Trabajo — 19 Flujos |
| §12 Make.com | Integraciones Make.com |
| §13 QUANTO | QUANTO — Data Warehouse |
| §14 Costos | Costos del ERP |
| §15 Planilla | Planilla — Cálculo El Salvador |
| §17 Estado Real | Estado Real — Auditoría |
| §18 Roadmap | Roadmap — 8 Fases |
| §20 Pendientes | Pendientes Actuales |
| §21 Problemas | Problemas Conocidos |
| §22 Enlaces | Enlaces Rápidos |
| §23 Sesiones Dev | Sesiones de Desarrollo |
| CHANGELOG.md | 📋 CHANGELOG |

### Paso 3 — Buscar el page_id

Usa `notion-search` con el título exacto de la página para obtener su ID.

### Paso 4 — Actualizar contenido

Usa `notion-update-page` para reemplazar el contenido de la página con el contenido actualizado del MAESTRO.md. Formatea en markdown estándar.

Reglas de formato:
- Tablas: usar markdown tables
- Código: usar bloques con triple backtick
- Credenciales (§6.7): reemplazar con "⚠️ Credenciales NO se almacenan en Notion por seguridad"
- Mantener los emojis de los títulos de página existentes

### Paso 5 — Actualizar página raíz si es necesario

Si cambió el estado general de alguna fase, actualizar también la tabla de estado en la página raíz (`33324fa1-0edc-81f7-ade9-f52985e6e27e`).

### Paso 6 — Confirmar

Reportar al usuario qué páginas se actualizaron con enlaces directos a Notion.

## Modo completo vs incremental

- **Incremental** (default): solo actualizar las páginas que corresponden a secciones modificadas
- **Completo** (`/sync-notion full`): re-sincronizar TODAS las 32 páginas desde cero. Útil si Notion y MAESTRO.md se desincronizaron

## Errores comunes

- Si `notion-search` no encuentra una página, buscar con título parcial o listar las subpáginas de la raíz
- Si `notion-update-page` falla por contenido muy largo, dividir en bloques y actualizar por partes
- Si una sección nueva en MAESTRO.md no tiene página Notion, crear una nueva subpágina bajo la raíz
