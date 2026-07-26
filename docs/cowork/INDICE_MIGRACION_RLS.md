# Índice: Migración RLS Freakie Dogs ERP

**Proyecto:** btboxlwfqcbrdfrlnwln  
**Fecha creación:** 2026-03-27  
**Estado:** Pendiente de revisión y ejecución

---

## Archivos Generados

### 1. README_MIGRACION_RLS.md
**Inicio aquí.** Resumen ejecutivo de la migración.

Contiene:
- Problema identificado
- Solución de alto nivel (3 categorías)
- Procedimiento paso a paso
- Checklist final
- Impacto en la aplicación

**Leer primero:** SÍ  
**Tiempo:** 10 minutos

---

### 2. MIGRACION_RLS_SEGURIDAD.sql
**Script principal.** SQL que se ejecutará en Supabase.

Contiene:
- DROP de 35+ políticas inseguras
- CREATE de 80+ políticas seguras categorizadas
- ENABLE RLS en 15+ tablas sin RLS
- Comentarios explicativos en cada política

**Acciones:**
1. Revisar cuidadosamente
2. NO ejecutar sin aprobación
3. Realizar backup antes de ejecutar
4. Ejecutar en SQL Editor de Supabase

**Tiempo de ejecución:** 2-5 minutos

---

### 3. CLASIFICACION_TABLAS_RLS.md
**Referencia detallada.** Clasificación de todas las 81 tablas del ERP.

Contiene:
- 13 tablas SENSIBLES (service_role only)
- 9 tablas CATÁLOGOS (SELECT público, admin escrita)
- 27 tablas OPERATIVAS (CRUD anon, app filtra)
- 12 tablas SEGURAS (auth-only con roles)
- 20 tablas con RLS autenticado complejo

Cada tabla incluye:
- Descripción
- Acceso permitido
- Campos sensibles (si aplica)
- Ejemplo de datos

**Consultar cuando:** Necesites entender cómo está segura una tabla específica  
**Tiempo:** 20 minutos (lectura completa)

---

### 4. VALIDACION_POST_MIGRACION.sql
**Auditoría.** Queries para verificar que la migración fue correcta.

Contiene:
- 8 secciones de validación
- Conteo de políticas por tipo
- Verificación de tablas críticas
- Checklist de 13 items
- Pruebas manuales de seguridad

**Ejecutar después de:** Aplicar MIGRACION_RLS_SEGURIDAD.sql

**Qué esperar:**
- No hay políticas "open"
- No hay políticas "anon_all_*"
- usuarios_erp tiene service_role only
- Todas las tablas tienen RLS habilitado

**Tiempo:** 10 minutos

---

### 5. RECOMENDACIONES_SEGURIDAD.md
**Futuro inmediato.** Guía de seguridad post-migración.

Contiene:
- Validación en Edge Functions (CRÍTICO)
- Protección de tabla usuarios_erp
- Alternativas de sesiones/tokens
- Auditoría y logging
- Campos sensitivos en tablas
- Cifrado en tránsito/reposo
- Rate limiting
- Plan de disaster recovery
- Checklist de seguridad continua
- Migración a Supabase Auth (futuro)

**Implementar:** Inmediatamente después de migración RLS

**Responsable:** Equipo backend  
**Tiempo de implementación:** 2-4 semanas

---

## Flujo de Ejecución Recomendado

```
SEMANA 1: REVISIÓN Y PREPARACIÓN
└─ Lunes:   Jose revisa README + SQL
└─ Martes:  2ª persona revisa SQL
└─ Miércoles: Aprobar cambios, crear backup Supabase
└─ Jueves:  Stage de pruebas (si existe)

SEMANA 2: EJECUCIÓN
└─ Lunes:    Ejecutar MIGRACION_RLS_SEGURIDAD.sql
└─ Lunes PM: Ejecutar VALIDACION_POST_MIGRACION.sql
└─ Martes:   Pruebas de seguridad con app cliente
└─ Miércoles: Monitorear por anomalías

SEMANA 3+: IMPLEMENTACIÓN DE RECOMENDACIONES
└─ Revisar RECOMENDACIONES_SEGURIDAD.md
└─ Actualizar Edge Functions (validación sucursal)
└─ Implementar auditoría completa
└─ Tests de penetración básicos
```

---

## Matriz de Decisión

### Antes de Ejecutar

| Pregunta | Respuesta | Acción |
|----------|-----------|--------|
| ¿Backups realizados? | SÍ | Proceder |
| ¿2 revisores aprobaron SQL? | SÍ | Proceder |
| ¿Hay plan de rollback? | SÍ | Proceder |
| ¿App cliente filtra por sucursal? | SÍ | Proceder |
| ¿Backend usa SERVICE_ROLE_KEY? | Parcial | Revisar RECOMENDACIONES.md |

### Si Algo Falla

| Escenario | Acción |
|-----------|--------|
| SQL tiene error de sintaxis | Contactar DBA, revisar VALIDACION.sql |
| App cliente no carga datos | Verificar filtro sucursal en Edge Functions |
| usuarios_erp es inaccesible | Crear token session, revisar RECOMENDACIONES.md |
| RLS deniega acceso legítimo | Revisar política en CLASIFICACION_TABLAS.md |
| Performance degradado | Ejecutar ANALYZE en tablas, revisar índices |

---

## Responsabilidades Asignadas

| Rol | Tarea | Plazo |
|-----|-------|-------|
| Jose (CEO/Ejecutivo) | Revisar + aprobar SQL | Antes de ejecución |
| Cesar (Co-ejecutivo) | 2ª revisión SQL | Antes de ejecución |
| Backend dev | Implementar validaciones Edge Functions | 2 semanas post-migración |
| DBA | Ejecutar migración + validación | Semana ejecución |
| QA | Pruebas de seguridad | Inmediato post-migración |
| Documentación | Actualizar runbooks | Después de validación |

---

## Tamaño de Cambios

- **Políticas eliminadas:** 35+
- **Políticas creadas:** 80+
- **Tablas afectadas:** 60+
- **Líneas SQL:** ~2000
- **Cambios frontend requeridos:** 0 (si ya filtra sucursal)
- **Cambios backend requeridos:** 3-5 (validación sucursal)

---

## Riesgo Evaluado

| Componente | Riesgo | Mitigación |
|-----------|--------|-----------|
| RLS rotura | BAJO | Backup + rollback plan |
| Performance | BAJO | Supabase bien optimizado |
| App cliente falla | BAJO | Mismo acceso anon, más restrictivo |
| Regresión de seguridad | MUY BAJO | Validación SQL post-migración |
| Datos expuestos | MUY BAJO | usuarios_erp aún más restringida |

**Riesgo general:** BAJO  
**Beneficio de seguridad:** ALTO

---

## Preguntas Frecuentes

### ¿Se pierden datos?
No. Migración RLS solo modifica políticas, no datos.

### ¿Qué pasa si app cliente se queda sin datos?
Es intencional. RLS deniega acceso a:
- `usuarios_erp` (PINs)
- `planillas` (salarios)
- Otras tablas sensibles

La app debe acceder a estos datos via Edge Functions, no directamente.

### ¿Cuánto downtime?
0-2 minutos (tiempo de ejecución del script SQL).

### ¿Cómo rollback?
Restaurar backup Supabase (5-10 minutos).

### ¿Se puede ejecutar en producción?
Sí, pero se recomienda stage/QA primero.

### ¿Qué pasa con usuarios_erp después?
Quedan solo accesibles a backend (SERVICE_ROLE_KEY).

---

## Checklist Pre-Ejecución

- [ ] He leído README_MIGRACION_RLS.md
- [ ] He revisado MIGRACION_RLS_SEGURIDAD.sql
- [ ] He consultado CLASIFICACION_TABLAS_RLS.md
- [ ] Entiendo las 3 categorías (SENSIBLES, CATÁLOGOS, OPERATIVAS)
- [ ] Backups Supabase realizados
- [ ] Plan de rollback documentado
- [ ] 2 personas aprobaron el SQL
- [ ] Equipo backend sabe de RECOMENDACIONES_SEGURIDAD.md
- [ ] Test de seguridad planeado para post-migración
- [ ] Documentación lista para actualizar

---

## Siguiente Paso

**Leer:** [README_MIGRACION_RLS.md](./README_MIGRACION_RLS.md)

---

**VERSIÓN:** 1.0  
**GENERADO:** 2026-03-27  
**ESTADO:** Pendiente Ejecución

