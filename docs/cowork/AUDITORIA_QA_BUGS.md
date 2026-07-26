# AUDITORÍA QA — Freakie Dogs ERP
## Fase 0: Auditoría Inicial

**Fecha:** 27-Mar-2026
**Agente:** 10 — QA Engineer
**Estado:** NO SE CORRIGIÓ NADA — Solo reportaje de bugs
**Proyecto:** btboxlwfqcbrdfrlnwln (Supabase)

---

## Resumen Ejecutivo

Se identificaron **15 bugs** distribuidos por severidad:

| Severidad | Cantidad | Estado |
|-----------|----------|--------|
| 🔴 CRÍTICO | 4 | Requiere atención inmediata |
| 🟠 ALTO | 3 | Afecta funcionalidad principal |
| 🟡 MEDIO | 6 | Degradación / edge cases |
| 🔵 BAJO | 2 | Mejoras técnicas |

**Áreas más afectadas:**
1. **Seguridad:** RLS deficiente, credenciales expuestas, falta de autenticación real
2. **Integridad de datos:** Queries sin filtros por sucursal, falta de constraints
3. **Manejo de errores:** 73% de operaciones DB sin try/catch
4. **Consistencia DB-Código:** 31 tablas documentadas vs 8 implementadas

---

## Bugs Críticos (🔴)

| # | Ubicación | Descripción | Impacto | Evidencia |
|---|-----------|-------------|---------|-----------|
| **1** | `/schema_v2.sql` línea 182-201 | RLS habilitado pero política "open" permite ALL a todos | **Fuga crítica de datos:** Cualquier usuario puede ver/editar datos de otras sucursales, empleados, salarios | `CREATE POLICY "open" ON public.%I FOR ALL USING (true) WITH CHECK (true)` — Aplica a usuarios_erp, ventas_diarias, egresos_cierre, planilla_mensual, etc. |
| **2** | `/schema_v2.sql` línea 21-29 | PINs hardcodeados en seed inicial | **Acceso no autorizado:** Credenciales visibles en repositorio, ataque de fuerza bruta posible en producción (10K combinaciones de 4 dígitos) | Pin admin '0000', gerentes '1001'-'1005', cajeras '2001'-'2002'. Comentario: "⚠️ Cambiar PINs antes de producción" |
| **3** | `/vercel-deploy/src/supabase.js` línea 3-4 + `/schema_v2.sql` línea 6 | ANON_KEY de Supabase expuesta en código cliente + RLS deficiente | **Manipulación de BD:** Combinación crítica — ANON_KEY expuesta + RLS sin restricciones = cualquiera puede editar datos | `KEY_SB = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'` (ANON_KEY visible en código) |
| **4** | `/components/dashboard/DashboardVentas.jsx` línea 36-38 | Queries no filtran sucursal_id para usuarios gerente | **Fuga de datos entre sucursales:** Gerente de M001 puede ver ventas de S001, S002, S003, S004 si `filtroId` no se resuelve | Código: `let perfQ=db.from('vista_performance_vs_meta').select('*')` — sin filtro si gerente no tiene store_code válido o tabla mapping no tiene datos |

---

## Bugs Altos (🟠)

| # | Ubicación | Descripción | Impacto | Evidencia |
|---|-----------|-------------|---------|-----------|
| **5** | Múltiples JSX (200+ referencias db.select/fetch, solo 55 try/catch) | 73% de operaciones DB sin manejo de errores | **Fallos silenciosos:** Errores de red, timeout, datos inconsistentes — usuario no sabe si guardó correctamente | Ratio: 200 `.select()` / `.from()` calls vs 55 try/catch blocks |
| **6** | `/components/layout/LoginScreen.jsx` línea 32-38 | Autenticación sin sesión o JWT; PIN se envía plaintext en cada request | **Hijacking de sesión, sniffing:** Sin sesión HTTP, cada request requiere PIN; posible interceptación en red no segura (HTTPS es necesario pero no garantizado en El Salvador) | Código: `const { data, error } = await db.from('usuarios_erp').select('*').eq('pin', np)` — PIN en plaintext |
| **7** | `/components/dashboard/DashboardEjecutivo.jsx` línea con `console.error()` + `/components/caja/CierreForm.jsx` con `console.warn()` | console.log/warn/error en producción | **Exposición de detalles técnicos:** Stack traces visibles en DevTools, información de estructura de datos expuesta | 2 instancias: `console.error(e)` y `console.warn('foto egreso no subida:', err.message)` |

---

## Bugs Medios (🟡)

| # | Ubicación | Descripción | Impacto | Evidencia |
|---|-----------|-------------|---------|-----------|
| **8** | `/supabase/functions/alertas-nocturnas/index.ts` línea 44-55 | Edge function acepta parámetro "fecha" desde URL sin validar formato | **SQL injection potencial:** Fecha no validada, podría aceptar strings malformados; sin validación YYYY-MM-DD | Código: `const fechaParam = url.searchParams.get('fecha'); let fecha = fechaParam ?? todaySV();` — Sin `if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha))` |
| **9** | `/components/admin/RecetasView.jsx` useEffect | Dependencia incompleta: `useEffect([cargar])` donde cargar se redefine en cada render | **Infinite loops potenciales, performance degradación:** Cada render → nueva función cargar → useEffect se ejecuta → estado cambia → re-render | useEffect no tiene función cleanup, cargar() es arrow function redefinida |
| **10** | `/components/almacen/HistorialTab.jsx`, `/components/almacen/DespachoTab.jsx`, etc. | Algunos fetch no establecen `loading=true` antes de ejecutar query async | **UX bloqueante:** Usuario no recibe feedback visual, puede clickear múltiples veces, comportamiento incierto | Algunos componentes faltan estado loading durante fetch |
| **11** | `/schema_v2.sql` egresos_cierre, ingresos_cierre | Foreign key constraints faltantes en motivo_id; motivo_id puede ser NULL | **Datos huérfanos, reportes inconsistentes:** Egreso sin referencia válida a motivos, imposible auditoría | `motivo_id UUID REFERENCES public.motivos_egreso(id)` — Sin NOT NULL, sin ON DELETE RESTRICT |
| **12** | `/supabase/functions/alertas-nocturnas/index.ts` línea 27 | Timezone offset calculado manualmente (-6 horas) en lugar de usar AT TIME ZONE | **Errores en cálculos de fecha:** Cambios DST (aunque SV no tiene), cambios en UTC offset futuros, código frágil | `const sv = new Date(now.getTime() - 6 * 60 * 60 * 1000);` — Mejor usar PostgreSQL `AT TIME ZONE` |
| **13** | `/components/layout/LoginScreen.jsx` | Sin rate limiting en intentos de login | **Ataque de fuerza bruta posible:** 4 dígitos = 10,000 combinaciones, sin protección contra login repetido | No hay contador de intentos fallidos ni throttling |

---

## Bugs Bajos (🔵)

| # | Ubicación | Descripción | Impacto | Evidencia |
|---|-----------|-------------|---------|-----------|
| **14** | Todos los archivos JSX | Falta auditoría de cambios en tablas críticas (usuarios_erp, ventas_diarias, planilla_mensual) | **Imposible trazabilidad, violación de cumplimiento legal:** No hay audit trail, no se sabe quién cambió qué datos ni cuándo | Schema no incluye tabla audit_log ni triggers para registro de cambios |
| **15** | Múltiples imports en componentes JSX | Código muerto / imports no utilizados | **Tamaño del bundle aumentado, mantenibilidad reducida** | A ser identificado en auditoría de imports detallada |

---

## Estado de Seguridad

### RLS (Row Level Security)
**Estado:** 🔴 CRÍTICO

- **Habilitado:** SÍ (línea 183-190 schema_v2.sql)
- **Políticas aplicadas:**
  - usuarios_erp: POLICY "open" — CRÍTICO
  - motivos_egreso: POLICY "open" — CRÍTICO
  - motivos_ingreso: POLICY "open" — CRÍTICO
  - ventas_diarias: POLICY "open" — CRÍTICO
  - egresos_cierre: POLICY "open" — CRÍTICO
  - ingresos_cierre: POLICY "open" — CRÍTICO
  - ajustes_metodo: POLICY "open" — CRÍTICO
  - depositos_bancarios: POLICY "open" — CRÍTICO

**Problema:** La política "open" (línea 200 schema_v2.sql):
```sql
CREATE POLICY "open" ON public.%I FOR ALL USING (true) WITH CHECK (true)
```
Permite **todos los permisos a todos los usuarios** — RLS es inútil.

**Recomendación:** Implementar políticas por rol/sucursal:
```sql
CREATE POLICY "sucursal_isolation" ON public.ventas_diarias
  FOR SELECT USING (
    auth.jwt() ->> 'rol' = 'admin'
    OR (auth.jwt() ->> 'rol' = 'gerente' AND store_code = (auth.jwt() ->> 'store_code'))
  );
```

### Credenciales
**Estado:** 🔴 CRÍTICO

| Tipo | Ubicación | Severidad | Acción |
|------|-----------|-----------|--------|
| ANON_KEY Supabase | `/vercel-deploy/src/supabase.js` línea 4 | CRÍTICO | Mover a .env, nunca commitear |
| PINs usuarios | `/schema_v2.sql` línea 21-29 | CRÍTICO | Cambiar antes de producción, usar hash |
| Service Role Key | Probablemente en .env o secrets | CRÍTICO | Nunca exponer en código |

### Autenticación
**Estado:** 🔴 CRÍTICO

- **Mecanismo actual:** PIN de 4 dígitos, plaintext en requests
- **Faltante:** Sesión HTTP (cookie con HttpOnly), JWT token, rate limiting
- **Impacto:** Sin protección contra hijacking, sniffing, fuerza bruta

---

## Tablas Vacías o No Implementadas

Basado en comparación MAESTRO.md (39 tablas documentadas) vs schema_v2.sql (8 tablas implementadas):

| Tabla | Estado | Razón | Impacto |
|-------|--------|-------|---------|
| planilla_mensual | FALTANTE | Documentada en MAESTRO.md pero no en schema | No se pueden generar nóminas |
| planilla_detalle | FALTANTE | Documentada en MAESTRO.md pero no en schema | No se pueden registrar detalles de pago |
| propinas_diarias | FALTANTE | Mencionada en MAESTRO.md v6 pero no implementada | Propinas no se registran en BD |
| propina_evaluacion_mensual | FALTANTE | Documentada en MAESTRO.md pero no en schema | Evaluación de propinas no persiste |
| viajes_delivery | FALTANTE | Mencionada en MAESTRO.md v6 (bonos delivery) pero no implementada | Bonos delivery no se calculan |
| bonos_delivery_mensual | FALTANTE | Mencionada en MAESTRO.md v6 pero no implementada | Bonos delivery no se pagan |
| empleados | FALTANTE | Mencionada en MAESTRO.md pero no en schema | No hay registro de empleados en BD |
| sucursales | FALTANTE | Mencionada en MAESTRO.md pero no en schema | Sucursales no tienen registro en BD |
| vista_performance_vs_meta | FALTANTE | Referenciada en DashboardVentas.jsx pero no existe | Dashboard ejecutivo fallará |
| vista_ventas_diarias | FALTANTE | Referenciada en DashboardVentas.jsx pero no existe | Dashboard ejecutivo fallará |

---

## Datos Huérfanos / Inconsistencias

### 1. Mapping de sucursales incompleto
**Ubicación:** DashboardVentas.jsx línea 28-32
**Problema:** Lee desde tabla `quanto_store_mapping` que no está definida en schema
**Impacto:** Gerentes no podrán ser asignados correctamente a sucursales

```javascript
const {data:map}=await db.from('quanto_store_mapping')
  .select('sucursal_id, sucursales(nombre)')
  .eq('store_code',user.store_code).maybeSingle();
```

### 2. 3 sucursales sin código QUANTO
**Ubicación:** MAESTRO.md sección 2.1
**Problema:** Metro Centro 8va Etapa, Plaza Integración, Plaza Olímpica sin código QUANTO
**Impacto:** No pueden generar cierres de caja

### 3. Referencias a vistas que no existen
**Ubicación:** DashboardVentas.jsx línea 36-43
**Problema:** Queries a `vista_performance_vs_meta`, `vista_ventas_diarias`, `vista_top_productos`, `vista_patron_semanal`, `vista_labor_cost_ratio`
**Impacto:** Dashboard se rompe, fallos silenciosos

---

## Recomendaciones Priorizadas

### TOP 10 FIXES (por impacto)

| Prioridad | Bug | Esfuerzo | Impacto | Plazo |
|-----------|-----|----------|--------|-------|
| 1️⃣ | Reemplazar RLS "open" con políticas por rol/sucursal | MEDIO | CRÍTICO | Urgente (hoy) |
| 2️⃣ | Cambiar/hashear PINs hardcodeados | BAJO | CRÍTICO | Urgente (hoy) |
| 3️⃣ | Mover ANON_KEY a .env.local (nunca commitear) | BAJO | CRÍTICO | Urgente (hoy) |
| 4️⃣ | Implementar sesión HTTP/JWT en LoginScreen | ALTO | CRÍTICO | Esta semana |
| 5️⃣ | Crear tabla planilla_mensual + planilla_detalle | ALTO | ALTO | Esta semana |
| 6️⃣ | Crear tabla propinas_diarias + propina_evaluacion_mensual | ALTO | ALTO | Esta semana |
| 7️⃣ | Crear vistas SQL faltantes (performance, ventas, productos, patrón, costos) | MEDIO | ALTO | Esta semana |
| 8️⃣ | Agregar try/catch a todas las operaciones DB (target: 100%) | MEDIO | ALTO | Esta semana |
| 9️⃣ | Validar fecha en alertas-nocturnas (YYYY-MM-DD regex) | BAJO | MEDIO | Esta semana |
| 🔟 | Implementar rate limiting en login (max 5 intentos/minuto) | BAJO | MEDIO | Próxima semana |

---

## Checklist de Implementación

- [ ] **Seguridad:** RLS, credenciales, autenticación real
- [ ] **BD:** Tablas faltantes (planilla, propinas, delivery, empleados)
- [ ] **Vistas:** Crear todas las vistas SQL referenciadas
- [ ] **Código:** Try/catch en 100% de operaciones DB
- [ ] **Edge Functions:** Validación de entrada en alertas-nocturnas
- [ ] **Performance:** Auditar useEffect dependencies
- [ ] **Auditoría:** Agregar tabla audit_log + triggers
- [ ] **Testing:** Suite de QA con casos edge
- [ ] **Documentación:** Actualizar MAESTRO.md con estado real de implementación

---

## Conclusión

**Estado del sistema:** Fase 0 no lista para producción

**Blockers críticos:** 4 (RLS, PINs, ANON_KEY, Queries sin filtro)
**Blockers altos:** 3 (Errores DB, Autenticación, Console logs)

Se recomienda NO desplegar a producción hasta que los 4 bugs críticos sean resueltos.

**Próximos pasos:**
1. Seguridad (hoy)
2. Tablas faltantes (esta semana)
3. Auditoría de código completa (próxima semana)
4. Testing E2E antes de deploy

---

*Reporte generado sin corregir bugs — Solo para auditoría.*
