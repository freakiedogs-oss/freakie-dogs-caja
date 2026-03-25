# FREAKIE DOGS — Contexto ERP MAESTRO

**Versión:** MAESTRO (consolidación v5 + v7 + v6 HTML)
**Actualizado:** 25 de Marzo, 2026
**Estado:** Fase 1 ✅ | Fase 2 ✅ | Fase 3 ⏳ (Supply Chain — Flujo A/B/C iniciado 25 Mar 2026) | Fases 4-8 pendientes
**Uso:** Interno confidencial — Claude (IA) + equipo de tecnología

> **REGLA:** Este archivo es la ÚNICA fuente de verdad del proyecto.
> Actualizar con cada cambio relevante. No crear versiones nuevas — editar este archivo.
> El HTML en `/MAESTRO/HTML/` se sincroniza automáticamente vía skill `update-context`.

---

## 1. Novedades v6.0

### 1.1 Propinas Mensuales (CAMBIO v6)

La propina ahora se reparte al final del MES (no quincenal). El gerente de sucursal decide con criterio quién la gana y quién la pierde. Llena un reporte mensual descartando a quienes perdieron. Fórmula: propina QUANTO del mes × 90% ÷ (empleados que SÍ ganaron + 1 producción). Solo 3 sucursales.

### 1.2 Bonos Delivery (NUEVO v6)

Los ~20 delivery drivers reciben bonos aparte de su sueldo fijo: $0.50 por viaje <17km, doble ($1.00) si ≥17km, $3.00 si es fuera de horario (después del cierre, parametrizable), $0.50 por mandado asignado por gerente/dueño. Se paga al final de mes.

### 1.3 Documentación Completa (v6)

Todas las 39 tablas con definición completa de cada columna. Todos los 19 flujos con cada paso detallado. Nada resumido — información completa.

### 1.4 Flujos de datos v6

- **Propina:** QUANTO diario → propinas_diarias → acumulado mensual → gerente evalúa → propina_evaluacion_mensual → planilla (2da quincena)
- **Delivery:** Cada viaje → viajes_delivery → fin de mes Edge Function → bonos_delivery_mensual → planilla
- **Config parametrizable:** km umbral, tarifas, hora cierre por sucursal — todo ajustable sin código

---

## 2. Perfil del Negocio

Documento centralizado de contexto operativo, técnico y estratégico para uso de Claude (IA) y el equipo de tecnología.

### 1.1 Datos Generales

| Dato | Valor |
|------|-------|
| **Razón social** | Freakie Dogs (El Salvador) |
| **Concepto** | Smash Burger Chain — Fast Casual |
| **Fundación** | 2023 — de 0 a 8 locales en 24 meses |
| **Ventas mensuales** | ~$500,000 USD (incluye IVA) |
| **Empleados** | ~100 personas |
| **Email corporativo** | freakiedogs@gmail.com |
| **Dueño / Director** | Jose Isart · joseisart2008@gmail.com |
| **Presupuesto ERP** | $50–200 USD / mes |
| **Usuarios del ERP** | 20–40 usuarios |
| **Timezone** | UTC-6 (El Salvador, sin DST) |

### 1.2 Equipo Directivo

- Jose Isart — Dueño y Director General
- Head of Operations — Operaciones y logística
- Head of Marketing — Presencia digital y campañas
- HR Person — Recursos humanos (~100 empleados)

### 1.3 Posicionamiento

La presencia digital es el activo más valioso. El modelo se sustenta en: contenido digital de alta calidad, producto premium (smash burgers) y ejecución operacional eficiente que genera retención.

- Crecimiento: 0 a 8 locales en 24 meses
- Delivery propio vía BUHO APP (links Instagram/WhatsApp → https://menu.buhopay.com/)
- Delivery terceros: Pedidos Ya (Delivery Hero) + Hifumi
- 10% propina incluida en ventas de las 3 sucursales tipo Restaurante
- IVA incluido en todos los precios de venta

---

## 3. Sucursales

### 2.1 Mapa de Sucursales (9 locales)

| Código QUANTO | Nombre | Tipo | Ciudad | Propina | Estado |
|---------------|--------|------|--------|---------|--------|
| M001 | Plaza Cafetalón (Original) | Restaurante | Santa Tecla | 10% | **Activa** |
| S004 | Paseo Venecia | Restaurante | San Salvador | 10% | **Activa** |
| S003 | Grand Plaza Lourdes | Restaurante | Antiguo Cuscatlán | 10% | **Activa** |
| S001 | Plaza Mundo Soyapango | Food Court | Soyapango | No | **Activa** |
| S002 | Plaza Mundo Usulután | Food Court | Usulután | No | **Activa** |
| — | Metro Centro 8va Etapa | Food Court | San Salvador | No | **Activa** |
| — | Plaza Integración | Express | San Salvador | No | **Activa** |
| — | Plaza Olímpica | Express | San Salvador | No | **Activa** |
| — | Casa Matriz | Producción/Bodega | San Salvador | N/A | **Activa** |

> ⚠ **Pendiente:** 3 sucursales sin código QUANTO — Metro Centro, Plaza Integración, Plaza Olímpica.

### 2.2 Sistema de Propinas (v6 — Mensual)

Cambio implementado en v6: las propinas se distribuyen al FINAL DEL MES (no quincenalmente). El gerente de sucursal decide con criterio quién la gana y quién no, llenando un reporte mensual de evaluación.

**Fórmula:** `Propina QUANTO del mes × 90% ÷ (empleados que SÍ la ganaron + 1 de producción)`

- Solo aplica en 3 sucursales (tiene_propina = true): Cafetalón, Paseo Venecia, Grand Plaza Lourdes
- Gerente llena reporte mensual descartando a quienes perdieron propina
- Se paga en la 2da quincena del mes siguiente vía planilla
- El 10% restante queda para la empresa

---

## 4. Métodos de Pago y Flujo de Efectivo

### 3.1 Ventas en Tienda

- Efectivo
- Tarjeta (crédito/débito) — PSP: Serfinsa
- Transferencia bancaria directa

### 3.2 Delivery BUHO APP (https://menu.buhopay.com/)

2 personas rutean pedidos y los pasan a cocina en cada sucursal vía WhatsApp Business. El cliente pide → WhatsApp → se asigna a repartidor.

- BAC — link de pago online (tarjeta de crédito)
- Transferencia directa a cuenta bancaria
- Efectivo contraentrega
- Clientes a veces cambian método de pago de último minuto

### 3.3 Plataformas Terceros

- **Pedidos Ya (Delivery Hero):** Paga cada viernes, monto semana anterior (lun–dom), depósito directo a cuenta bancaria
- **Hifumi:** Paga cada 2–3 días, depósito directo a cuenta bancaria

> ⚠ Pedidos Ya en Plaza Cafetalón (Santa Tecla) NO se registra en QUANTO POS.

### 3.4 Fondo de Caja

- **Fondo fijo por sucursal:** $150 USD (fondo_caja) — se queda en caja, no se deposita
- **Efectivo a depositar:** efectivo_en_caja − $150 − adelantos − gastos de caja
- **Depósito:** Al día siguiente en la cuenta bancaria única

---

## 5. Operaciones de Delivery

### 4.1 Repartidores de Producción (Store Delivery)

- 2 repartidores fijos para entregas producción → sucursales
- Cada uno tiene una ruta específica diaria fija
- No reciben bono por viaje, tienen sueldo fijo

### 4.2 Repartidores de Comida (~20 drivers)

- ~20 delivery drivers para entregas de pedidos de clientes
- Actualmente asignados via WhatsApp (a mejorar con módulo delivery del ERP)
- Reciben sueldo fijo + bonos por viaje (ver estructura abajo)

### 4.3 Estructura de Bonos Delivery (v6 — Mensual)

| Condición | Bono por evento | Notas |
|-----------|-----------------|-------|
| Viaje < 17 km | $0.50 | Tarifa base por entrega |
| Viaje ≥ 17 km | $1.00 | Doble tarifa (distancia larga) |
| Viaje fuera de horario | $3.00 | Después del cierre de sucursal (parametrizable) |
| Mandado asignado | $0.50 | Asignado por gerente o dueño |

- Bonos se calculan automáticamente al fin de mes y se incluyen en planilla
- El umbral de km y hora de cierre son parametrizables por sucursal sin necesidad de código
- El bono de fuera de horario es ADICIONAL al bono de entrega (ej: entrega de 20km después del cierre = $1.00 + $3.00 = $4.00)

---

## 6. Sistemas y Tecnología Existente

### 5.1 QUANTO POS

Sistema principal de punto de venta. Fuente primaria (~100% confiable) de datos de ventas.

- URL admin: https://admin.quantopos.com/
- Registra ventas por sucursal, producto y tipo de pago
- Genera DTEs (JSON) + Transacciones (CSV) para exportar
- Infraestructura: Firebase / Firestore
- NO registra Pedidos Ya en Santa Tecla

### 5.2 Serfinsa (PSP Tarjetas)

- Terminal de cobro con tarjeta en sucursales
- Genera ZIPs diarios (REP*.ZIP): TXT/PDF/XLS por terminal
- Contiene comisiones, IVA, retención 2%, pago neto
- ZIPs llegan automáticamente a freakiedogs@gmail.com

### 5.3 Gmail Corporativo — freakiedogs@gmail.com

- Recibe DTEs de proveedores (facturas JSON)
- Recibe ZIPs Serfinsa con reportes de tarjetas
- Recibe cierres de caja de gerentes
- gmail_downloader.py descarga a ~/Desktop/Gmail Attachments 2026/

### 5.4 Telegram Bot

- Bot de alertas: @FreakieDogsMonitor (Freakie Dogs Monitor)
- Número: +503 7852-5916
- Alertas 8PM y 11PM: cierres faltantes y diferencias >$5

### 5.5 Excel Master — FreakiesFinanzas_2026_MASTER.xlsx

- Tab Compras: 6,761+ filas de DTEs de proveedores (68+ proveedores mapeados a categorías)
- Tab Serfinsa: transacciones POS por terminal
- Tab Cajas: cierres de caja diarios
- Tab Catálogo Gastos: categorías de proveedores

### 5.6 BUHO APP — buhopay.com

- URL: https://menu.buhopay.com/
- Menú digital que genera link para Instagram/WhatsApp
- Estado: en evaluación para ser reemplazado por módulo delivery del ERP

---

## 7. ERP en Construcción — Stack y Arquitectura

### 6.1 Stack Tecnológico (~$9–50/mes)

| Componente | Tecnología |
|------------|------------|
| **Base de datos** | Supabase (PostgreSQL) — Auth, Storage, Edge Functions, Realtime, RLS |
| **Proyecto Supabase** | freakie-dogs-erp · Ref: `btboxlwfqcbrdfrlnwln` |
| **URL Supabase** | https://btboxlwfqcbrdfrlnwln.supabase.co |
| **Región AWS** | us-east-2 (Ohio — más rápido desde El Salvador) |
| **Frontend / App** | PWA React + Tailwind CSS — mobile-first, instalable en Android/iPhone |
| **Hosting PWA** | Vercel (gratis, conectado a GitHub) |
| **Repo GitHub** | [freakiedogs-oss/freakie-dogs-caja](https://github.com/freakiedogs-oss/freakie-dogs-caja) |
| **Automatización** | Make.com — $9/mes (Core plan, >1,000 ops/mes) |
| **Alertas** | Telegram Bot API |
| **Email / Facturas** | Gmail API + Python scripts existentes |
| **Funciones backend** | Supabase Edge Functions (Deno/TypeScript) |
| **Costo estimado** | ~$9–50/mes según uso |

### 6.2 Librerías PWA

- @supabase/supabase-js — cliente de base de datos
- react-router-dom — navegación
- @tanstack/react-query — manejo de estado remoto
- recharts — gráficas y dashboards
- lucide-react — iconos
- react-hot-toast — notificaciones

### 6.3 PWA — Estructura actual (index.html)

```
index.html (archivo único, ~1500+ líneas)
├── HTML (manifest, meta tags, PWA)
├── React 18 (via Babel standalone)
├── Tailwind CSS (vía CDN)
├── Supabase SDK
├── Componentes React
│   ├── LoginScreen
│   ├── CierreScreen
│   ├── HistoricoScreen
│   ├── DepositosScreen
│   ├── AprobacionScreen
│   ├── DashboardScreen
│   └── DashboardVentas (analytics — admin + gerente)
└── Service Worker (sw.js)
```

### 6.4 Flujo de Deploy — PWA

1. Edita archivo → `/vercel-deploy/index.html`
2. Pushea a GitHub → `freakiedogs-oss/freakie-dogs-caja` (rama `main`)
3. Vercel detecta → Deploy automático (~1 min)
4. URL en vivo → https://freakie-dogs-caja-2wuv39foz-freakiedogs-oss-projects.vercel.app

### 6.5 Supabase Storage — Buckets

| Bucket | Público | Uso |
|--------|---------|-----|
| incidentes-fotos | No | Fotos adjuntas a reportes de incidentes |
| cierres-fotos | No | Fotos egresos e ingresos del cierre de caja + vouchers de depósito |
| menu-imagenes | Sí | Fotos del menú que ven los clientes |
| boletas-pago | No | PDFs de boletas de pago por período |
| estados-cuenta | No | Estados de cuenta bancarios para conciliación |

### 6.6 Supabase Realtime — Tablas activas

- delivery_clientes — órdenes en tiempo real para despachador
- metas_ventas — actualización de progreso en tiempo real
- incidentes — alertas instantáneas a operaciones

### 6.7 Credenciales Técnicas (CONFIDENCIAL)

**NO compartir fuera del equipo directivo.**

| Credencial | Valor |
|------------|-------|
| **Supabase Login** | freakiedogs@gmail.com |
| **Supabase Password** | [Ver Freakie ERP INFO.docx] |
| **Supabase Anon Key** | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4 |
| **Service Role Key** | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...NRoswQj7Xyziczwj7SKHKJsiRI6LABb1FYPORLBlGCY |
| **RPC Function** | public.exec_sql_batch(sql_text TEXT) — para importación masiva SQL |
| **GitHub Token** | Almacenado en plugin `freakie-github` (.mcp.json) — rotado 23 Mar 2026 |
| **Telegram Bot** | @FreakieDogsMonitor — token en documento privado |
| **Chat ID Jose** | 8547715106 (pruebas) |
| **Chat ID Jazmín** | *(pendiente actualizar)* |

---

## 8. Base de Datos — 41 Tablas + 3 DW + 3 PWA + 3 Serfinsa (ERP v6+)

Diseño completo de la base de datos PostgreSQL en Supabase. Todas las tablas usan UUID como PK, RLS habilitado.

> **Nota:** La definición campo por campo de cada tabla está en el archivo HTML:
> `/Contexto/MAESTRO/HTML/Freakie_Dogs_ERP_MAESTRO.html`

### 7.1 Módulo OPS — Operaciones (18 tablas)

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 1 | sucursales | Nombre, hora_cierre, tiene_propina (bool), fondo_caja ($150), activa |
| 2 | usuarios | Email, rol (9 roles), sucursal_id, activo — mismo ID que Supabase Auth |
| 3 | catalogo_productos | Código, categoría, unidad_medida, precio_referencia, proveedor_frecuente |
| 4 | ventas_diarias | Cierre de caja: ventas_quanto, efectivo, tarjeta, propina_quanto, diferencia (GENERATED), adelantos |
| 5 | compras | DTEs importados: uuid_dte (UNIQUE), proveedor_nrc, subtotal, iva, json_original (JSONB) |
| 6 | inventario | stock_actual, stock_minimo, stock_maximo, alerta_activa (GENERATED) |
| 7 | recepciones | Recepción mercadería: tipo (bodega/sucursal_directa/producción), estado, proveedor |
| 8 | recepcion_items | Líneas de recepción: cantidad_esperada vs cantidad_recibida, diferencia (GENERATED) |
| 9 | recetas | BOM: nombre, tipo (plato_venta / sub_receta), costo_calculado, margen_pct (GENERATED) |
| 10 | receta_ingredientes | Ingredientes BOM: tipo_ingrediente, producto_id o sub_receta_id, cantidad, costo_linea |
| 11 | produccion_diaria | Producción: receta, cantidad_producida, cantidad_enviada, merma (GENERATED), turno |
| 12 | pedidos_sucursal | Pedido al almacén: estado (borrador→enviado→despachado→recibido), fecha_entrega_estimada |
| 13 | pedido_items | Líneas de pedido: cantidad_solicitada vs cantidad_despachada |
| 14 | incidentes | Incidente: categoría (7 tipos), severidad, foto_url, estado (abierto/resuelto) |
| 15 | metas_ventas | Meta diaria: meta_diaria, venta_actual_11am, proyeccion_cierre, pct_cumplimiento (GENERATED) |
| 16 | ordenes_compra | OC a proveedor: numero_oc (SERIAL TEXT), proveedor (TEXT), proveedor_id (FK proveedores), estado CHECK (borrador/pendiente_aprobacion/aprobada/parcial_recibida/recibida/cancelada), total_estimado, total_items, creada_por, aprobada_por, fecha_aprobacion, fecha_recepcion, recepcion_id (FK recepciones), notas, notas_aprobacion |
| 17 | delivery_clientes | Orden delivery: cliente, dirección, items (JSONB), estado, repartidor, distancia_km |
| 18 | forecast_demanda | Proyección: cantidad_proyectada, ajuste_manual, cantidad_final (GENERATED) |

### 7.2 Módulo FIN — Finanzas (2 tablas)

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 19 | conciliaciones | Estado de cuenta bancario: mes, total_movimientos, total_pendientes (GENERATED) |
| 20 | movimientos_bancarios | Líneas del estado de cuenta: monto, match_compra_id, match_venta_fecha, estado |

### 7.3 Módulo OPS adicional (4 tablas)

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 21 | eventos_especiales | Feriados/promociones: factor_ajuste (ej: 1.3 = 30% más ventas esperadas) |
| 22 | menu_config | Menú público: nombre_publico, descripcion_publica, precio, imagen_url, activo |
| 23 | posts_redes | Métricas redes sociales: plataforma, likes, comentarios, alcance, engagement_rate (GENERATED) |
| 24 | marketing_ventas_correlacion | MATERIALIZED VIEW: correlación post → ventas día 0/1/2, lift_pct |

### 7.4 Módulo RRHH — Recursos Humanos (6 tablas)

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 25 | empleados | Datos completos: DUI, cargo, sucursal_id, salario_base, tipo_contrato, banco, cuenta |
| 26 | asistencia_diaria | Registro diario: hora_entrada, hora_salida, estado, horas_extra, llegada_tarde |
| 27 | propinas_diarias | Propina registrada en QUANTO por día: propina_total, sucursal_id — acumula mensual |
| 28 | propina_evaluacion_mensual | Evaluación mensual gerente: propina_total_mes, pct_reparto, num_beneficiarios |
| 29 | propina_evaluacion_detalle | Por empleado: gano_propina (bool), motivo_perdida, monto_asignado |
| 30 | viajes_delivery | Cada viaje: empleado_id, distancia_km, es_fuera_de_horario, tipo (entrega/mandado) |

### 7.5 Módulo DEL — Delivery + Planilla (4 tablas)

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 31 | bonos_delivery_mensual | Resumen mensual por driver: entregas_normal, entregas_larga, fuera_horario, bono_total (GENERATED) |
| 32 | config_delivery | Parámetros: km_umbral (17), tarifa_normal (0.50), tarifa_larga (1.00), tarifa_fuera_horario (3.00), tarifa_mandado (0.50) |
| 33 | planillas | Corridas de planilla quincenal: periodo, fecha_pago, estado, total_bruto, total_neto, total_patronal |
| 34 | planilla_detalle | Cálculo por empleado: salario_base, propina, bono_delivery, total_devengado (GENERATED), ISSS 3%, AFP 7.25%, ISR, adelantos, faltas, préstamos, total_descuentos (GENERATED), neto_a_pagar (GENERATED) |

### 7.6 Tablas adicionales (5 tablas)

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 35 | descuentos_empleado | Descuentos recurrentes: tipo (préstamo/uniforme/cuota/otro), monto_cuota, cuotas_totales, cuotas_pagadas, activo (GENERATED: pagadas < totales) |
| 36 | config_isr | Tabla ISR progresiva El Salvador: tramo, desde, hasta, pct_excedente, cuota_fija, vigente_desde |
| 37 | audit_log | Bitácora de cambios: tabla, registro_id, accion (INSERT/UPDATE/DELETE), datos_anteriores (JSONB), datos_nuevos (JSONB), usuario_id |
| 38 | ordenes_compra_items | Líneas de OC: orden_id (FK CASCADE), producto_id (FK), descripcion, unidad, cantidad_solicitada, cantidad_recibida, precio_unitario_estimado, precio_unitario_real, stock_actual_al_crear, stock_minimo, cantidad_sugerida |
| 39 | notificaciones | Log de alertas: tipo, mensaje, canal (telegram/pwa), leida, usuario_destino |

### 7.7a Arquitectura de Datos de Ventas — Jerarquía 3 Niveles (NUEVO 24 Mar 2026)

**Columnas `source` agregadas** a `quanto_transacciones` y `ventas_diarias` para rastrear origen de datos.

**Jerarquía de fuentes (prioridad ascendente):**
- **cierre** (prioridad 1): Datos inmediatos del cierre de caja diario. Primera fuente disponible.
- **csv** (prioridad 2): Export semanal de QUANTO admin. Reemplaza cierres.
- **dte** (prioridad 3): Documentos Tributarios Electrónicos (factura electrónica Hacienda). Fuente correcta/fiscal. Reemplaza todo lo anterior.

**Regla:** Al recibir datos de una fuente superior, se guarda snapshot del dato actual en `ventas_diarias_historico` antes de sobreescribir. RPC `actualizar_ventas_diarias()` implementa esta lógica automáticamente.

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 40 | ventas_diarias_historico | Snapshots de ventas_diarias antes de ser reemplazados por fuente superior. Campos: todos los de ventas_diarias + source_reemplazado, source_reemplazo, snapshot_at, snapshot_motivo |
| 41 | ajustes_cruce | Correcciones de método de pago desde cierres de caja. Cuando cajera reporta método erróneo en QUANTO (no editable post-cierre), el cierre captura la corrección. Campos: metodo_original, metodo_correcto, monto. CHECK: métodos IN (efectivo, tarjeta, transferencia, link_pago, otro) |

**Vista:** `v_ajustes_cruce_resumen` — Resumen neto de ajustes por día/sucursal para reconciliación con Serfinsa (tarjetas), BAC (links de pago + transferencias).

**RPC:** `actualizar_ventas_diarias(fecha, store_code, source, montos...)` — Implementa jerarquía: solo reemplaza si fuente nueva > fuente actual. Auto-snapshot a histórico.

**Reconciliación con ajustes de cruce:**
- **Tarjeta** → 100% liquidado por Serfinsa. Ajuste neto_tarjeta se suma para cuadrar con liquidación Serfinsa.
- **Links de pago** → 100% depositado por BAC directo a cuenta. Ajuste neto_link_pago para cuadrar con depósito BAC.
- **Transferencias** → Clientes depositan directo a cuenta BAC. Ajuste neto_transferencia para cuadrar.

### 7.7 Tabla ISR — Tramos (El Salvador)

| Desde | Hasta | % Excedente | Cuota Fija |
|-------|-------|-------------|------------|
| $0.01 | $472.00 | 0% | $0 |
| $472.01 | $895.24 | 10% | $17.67 |
| $895.25 | $2,038.10 | 20% | $60.00 |
| $2,038.11 | En adelante | 30% | $288.57 |

> ISR mensual = cuota_fija + (ingreso_gravable − desde) × pct_excedente. Gravable = salario + horas_extra − ISSS − AFP. Quincena = ISR mensual / 2.

### 7.8 Tablas QUANTO Data Warehouse (3 tablas espejo)

| Tabla | Registros (aprox.) | Descripción |
|-------|-------------------|-------------|
| quanto_transacciones | 132,684 | Ventas POS: fecha, numero_orden, store_code, metodo_pago, propina, total |
| quanto_dte_ventas | 101,283 | DTEs emitidos: numero_control, store_code, subtotal, iva, total_pagar |
| quanto_dte_items | 402,954 | Líneas DTE: descripcion, cantidad, precio_unitario, venta_gravada, iva_item |

### 7.9 Tablas PWA (3 tablas — Fase 2)

| Tabla | Descripción |
|-------|-------------|
| reportes_turno | Reporte de turno por gerente/cocina |
| incidentes_reporte | Incidentes del reporte diario |
| ausencias_reporte | Registro de ausencias |

### 7.10 Tablas Serfinsa — Validación Tarjetas (4 tablas — Fase 2, 24 Mar 2026)

| Tabla | Descripción |
|-------|-------------|
| serfinsa_terminales | Mapeo terminal_code → sucursal_id. Pendiente mapear 5 terminales a sucursales. |
| serfinsa_liquidaciones | Detalle por terminal/día: monto_serfinsa vs monto_ventas_diarias, estado (pendiente/validado/discrepancia/revisado) |
| serfinsa_validacion_diaria | Validación agregada empresa/día: total_serfinsa vs SUM(tarjeta_quanto). 13 días cargados (Mar 9-22). Hallazgo: QUANTO reporta ~3-4% más que Serfinsa (propinas en tarjeta). |
| serfinsa_detalle_diario | **868 filas** (Ago 2025–Mar 2026). Detalle diario por sucursal desde Excel Master: valor_operaciones, propina, iva_13, percepcion_2, comision, iva_comision, liquido_recibir. 5 sucursales: PC Tecla (227d), PM Soya (227d), PC Usul (220d), GP Lourdes (116d), PV Soyapango (86d). Totales: $733K ops, $34.8K propinas, $11.6K comisión (1.58%), $12.4K percepción 2%. |

### 7.11 RPC Functions — Creadas 24 Mar 2026

| Función | Descripción |
|---------|-------------|
| `agregar_ventas_quanto(fecha_inicio, fecha_fin)` | Agrega ventas QUANTO → ventas_diarias + propinas_diarias con UPSERT. Respeta cierres manuales. |
| `validar_serfinsa_diario(p_fecha, p_total, p_montos, p_email_id, p_email_subject)` | Valida total tarjetas Serfinsa vs ventas_diarias. Tolerancia $5. Auto-detecta discrepancias. |
| `procesar_dte_json(p_dte JSONB)` | Parsea JSON DTE estándar MH → UPSERT compras + compras_dte (dual-write). Dedup por uuid_dte (codigoGeneracion). Extrae: emisor, montos, items. Auto-extrae últimos 4 dígitos de numeroControl → dte_codigo para cruce. |
| `cruce_diario_dte()` | Cruce diario DTE email↔recepción PWA. Paso 1: match exacto (dte_codigo + fecha). Paso 2: match parcial (proveedor + fecha por nombre/NIT) → marca revision_manual=true con recepcion_candidata_id. pg_cron 2AM (0 8 * * * UTC). |
| `sugerir_compra_proveedor(p_proveedor_id UUID)` | Retorna productos del proveedor con stock actual, stock mínimo, stock máximo y cantidad_sugerida (stock_maximo - stock_actual cuando bajo mínimo). Para precarga inteligente de OC. |

### 7.12 Tablas Supply Chain Fase 3 (25 Mar 2026)

| # | Tabla | Descripción clave |
|---|-------|-------------------|
| 42 | despachos_sucursal | Despacho desde casa matriz a sucursales. Estado: preparando→despachado→en_camino→recibido. Trigger actualiza inventario al confirmar recepción. |
| 43 | despacho_items | Líneas de despacho: producto_id, cantidad_despachada, cantidad_recibida, costo_unitario, costo_linea (GENERATED), diferencia (GENERATED) |
| 44 | inventario_conteo_nocturno | Conteo físico nocturno por sucursal/producto/fecha. Compara real vs teórico. UNIQUE (sucursal_id, producto_id, fecha) |
| 45 | produccion_diaria_items | Consumo de materia prima por producción (BOM exploded). es_subproducto=true → item se incrementa en inventario |
| 46 | compras_dte | DTEs de correo para cruce con recepciones PWA. 1053 DTEs backfill. Campos: numero_control, dte_codigo (últimos 4 dígitos), codigo_generacion, proveedor_nombre/nit, fecha_emision, montos. Columnas cruce: cruzado, recepcion_id, revision_manual, recepcion_candidata_id, notas_revision. |

**Vista:** `v_cruce_compras` — Vista unificada email + PWA con campo `estado_cruce`: cruzado, match_pendiente, sin_recepcion, sin_dte_email.

**PWA:** `almacen.html` — Módulo dedicado para Marcos Flores (bodeguero, PIN: 5001).
- Tab Recepción: recibir mercadería de proveedores, foto DTE, confirmar cantidades, campo DTE 4 dígitos, precio_unitario por item. Auto-detecta OC aprobada al seleccionar proveedor → precarga items con banner visual "OC-XXXX precargada" (desvinculable). Al guardar actualiza OC a 'recibida' y registra cantidades reales. (Flujo A)
- Tab Compras: gestión de Órdenes de Compra. Lista OC con badges de estado (colores por estado). NuevaOC: seleccionar proveedor → RPC `sugerir_compra_proveedor` precarga items bajo stock mínimo con cantidades sugeridas. DetalleOC: ver/aprobar/cancelar OC. Estados: borrador→pendiente_aprobacion→aprobada→recibida (o cancelada).
- Tab Despacho: ver pedidos aprobados de sucursales, preparar y confirmar despacho (Flujo C)
- Tab Inventario: stock actual Casa Matriz con alertas de mínimo
- Tab Historial: últimas 30 recepciones con edición completa y eliminación (72h). Banner cruces pendientes con aprobar/rechazar matches parciales DTE.

**Columnas nuevas recepcion_items:** `precio_unitario` (numeric) — precio por item, auto-actualiza `proveedor_productos` al guardar.
**Columnas nuevas recepciones:** `dte_codigo` (VARCHAR 4) — últimos 4 dígitos del número de control DTE para cruce.

**Casa Matriz:** Sucursal `CM001` creada como tipo='bodega' — sede de todas las compras globales.
**Usuarios nuevos:** Marcos Flores (bodeguero, PIN 5001)
**Roles ampliados:** usuarios_erp ahora acepta bodeguero, produccion, compras, rrhh, contador, marketing, despachador

---

## 9. Roles y Permisos (9 Roles)

Row Level Security en Supabase: cada usuario accede únicamente a los datos de su sucursal. Admin ve todo.

| Rol | Usuarios | Accesos principales |
|-----|----------|---------------------|
| admin | 2-3 (dueño) | Vista total: todas las sucursales, configuración, reportes consolidados, planilla |
| gerente | 5 (uno por local activo) | Su sucursal: cierre de caja, incidentes, inventario, pedidos, propinas mensuales |
| cajera | 5 | Su sucursal: cierre de caja, registrar delivery recibido |
| bodeguero | 1 (comparte cuenta) | Casa Matriz: recepción mercadería, despacho pedidos, inventario bodega |
| produccion | 1 (comparte cuenta) | Casa Matriz: registrar producción diaria, BOM, sub-recetas |
| despachador | 1 | Órdenes delivery en tiempo real (Realtime), asignación de repartidores |
| marketing | 5 (solo lectura) | Dashboard de ventas, métricas producto, analytics redes sociales |
| rrhh | 1 | Planilla, asistencia, empleados, bonos, propinas — todas las sucursales |
| contador | 1 (solo lectura fin.) | Compras, conciliación bancaria, reportes financieros — solo lectura |

> Bodeguero y producción comparten 1 cuenta (2 personas se rotan el dispositivo).
> Total cuentas hoy: 22-24. Con 8 sucursales: 28-30.

---

## 10. Módulos del ERP — 17 Módulos

| # | Módulo | Área | Descripción |
|---|--------|------|-------------|
| 1 | Cierre de Caja | OPS | Formulario gerente + cálculos GENERATED + alertas Telegram |
| 2 | Ventas QUANTO | OPS | Import diario desde QUANTO POS vía Make.com |
| 3 | Incidentes | OPS | Reporte + foto + alertas instantáneas por severidad |
| 4 | Recepción Bodega | OPS | Recepción de mercadería, conteo vs OC |
| 5 | Recepción Sucursal | OPS | Bebidas y producción directa a sucursales |
| 6 | Pedidos Sucursal | OPS | Pedido nocturno a bodega con sugerencias de forecast |
| 7 | Órdenes Compra | OPS | OC a proveedor con aprobación admin |
| 8 | Producción / BOM | OPS | BOM multinivel, producción diaria, merma |
| 9 | Metas + Forecast | OPS | Metas 11AM, forecast por ingredientes |
| 10 | Menú Digital | v4 | Catálogo público PWA, carrito, checkout (reemplaza BUHO) |
| 11 | Delivery Propio | v4 | Panel despachador Realtime, asignación drivers |
| 12 | Marketing Analytics | MKT | Meta/TikTok API, correlación redes↔ventas |
| 13 | Conciliación Bancaria | FIN | Upload estado cuenta, auto-match, revisión manual |
| 14 | Planilla Quincenal | RRHH | Cálculo con ISR, ISSS, AFP + propina + bono delivery |
| 15 | Asistencia | RRHH | Reporte diario gerente: entrada/salida, tardanzas, extras |
| 16 | Bonos Delivery | DEL | Registro viajes, tarifas parametrizables, cálculo mensual |
| 17 | Propinas Mensuales | v6 | Evaluación gerente, reparto 90%, integración planilla |

---

## 11. Flujos de Trabajo — 19 Flujos (Detalle Completo)

> **Referencia visual detallada:** Ver `/MAESTRO/HTML/Freakie_Dogs_ERP_MAESTRO.html` para diagramas de flujo con pasos, roles y tags.

### Flujo 1 — Cierre de Caja Diario (OPS)

1. **9:00 PM** — Gerente abre "Cierre del Día" en PWA. Ingresa: ventas_efectivo, ventas_tarjeta, ventas_transferencia, efectivo_en_caja, adelantos, gastos de caja chica.
2. **Automático** — PostgreSQL calcula GENERATED: diferencia_quanto y efectivo_a_depositar. Si diferencia >$5, marca discrepancia.
3. **Automático** — Trigger envía alerta Telegram a admin si |diferencia_quanto| > $5.
4. **10:00 PM** — pg_cron verifica que todas las sucursales tengan cierre. Si falta, envía recordatorio Telegram.

### Flujo 2 — Importación Ventas QUANTO (OPS)

1. **Diario AM** — Make.com exporta ventas del día anterior desde QUANTO POS (CSV). Parsea totales por método de pago, propinas, descuentos.
2. **Automático** — Upsert en ventas_diarias por (fecha, sucursal_id). Propinas van a propinas_diarias para las 3 sucursales con propina.
3. **Dashboard** — PWA muestra gráficos: ventas diarias/semanales/mensuales, comparación vs metas.

### Flujo 3 — Importación Compras DTE + Cruce con Recepciones (FIN)

1. **Continuo** — Make.com (ID 4504164) monitorea Gmail buscando JSON adjuntos de DTEs de proveedores.
2. **Automático** — RPC `procesar_dte_json` parsea JSON: UUID, fecha, tipo_dte, proveedor, items, IVA, retenciones. **Dual-write:** inserta en `compras` + `compras_dte` (extrae últimos 4 dígitos de numeroControl → dte_codigo).
3. **Automático** — Deduplicación por uuid_dte en compras. Auto-categoriza con fuzzy match.
4. **2:00 AM diario** — pg_cron ejecuta `cruce_diario_dte()`:
   - **Paso 1 (exacto):** Match dte_codigo + fecha → marca `cruzado=true`, vincula `recepcion_id`.
   - **Paso 2 (parcial):** Match proveedor (nombre o NIT) + fecha sin dte_codigo coincidente → marca `revision_manual=true` con `recepcion_candidata_id`.
5. **Manual en PWA** — Banner naranja en tab Historial muestra cruces pendientes. Bodeguero/admin aprueba ("Sí, es el mismo") o rechaza ("No coincide") cada match parcial.

### Flujo 4 — Recepción en Bodega (OPS)

1. **AM** — Bodeguero recibe entrega física. PWA → "Nueva Recepción". Si hay OC, pre-carga items esperados.
2. **Conteo** — Para cada producto: cantidad_recibida vs cantidad_esperada. Diferencias GENERATED.
3. **Automático** — Trigger actualiza inventario (stock_actual += cantidad_recibida).
4. **Automático** — Si |diferencia| > 10%, alerta Telegram a admin.

### Flujo 5 — Pedido Nocturno de Sucursal (OPS)

1. **9:00 PM** — Gerente crea pedido en PWA. Ve inventario actual, sistema sugiere cantidades vía forecast_demanda.
2. **AM** — Bodeguero ve cola de pedidos, prepara, ingresa cantidad_despachada.
3. **Despacho** — Bodeguero marca 'despachado'. 2 drivers de producción entregan por rutas fijas.
4. **Recepción** — Gerente confirma recepción. Trigger actualiza inventario de sucursal.

### Flujo 6 — Recepción en Sucursal (OPS)

1. **Llegada** — Puede ser producción (sucursal_produccion) o proveedor directo de bebidas (sucursal_directa).
2. **Conteo** — Gerente cuenta cada producto, ingresa cantidad_recibida. Compara con pedido original.
3. **Automático** — Trigger actualiza inventario. Si stock > máximo o discrepancia >10%, alerta.

### Flujo 7 — Metas 11AM (OPS)

1. **Mensual** — Admin configura meta_diaria por sucursal (puede variar por día de semana).
2. **11:00 AM** — Make.com o entrada manual registra venta_actual_11am. Sistema proyecta cierre basado en patrón histórico.
3. **Automático** — Telegram a gerentes: "☀️ METAS 11AM: Escalón: 45% 🔴 | Merliot: 72% 🟢" — Color: 🔴 <40%, 🟡 40-70%, 🟢 >70%.

### Flujo 8 — Incidentes (OPS)

1. **Cualquier momento** — Empleado reporta en PWA: categoría (7 tipos), severidad (baja/media/alta/crítica), descripción, foto.
2. **Automático** — Alerta Telegram a admin + gerente. Si crítico, también a dueños.
3. **Seguimiento** — Admin asigna responsable. Estado: abierto → en_proceso → resuelto. Resumen semanal Telegram.

### Flujo 9 — Producción Diaria (OPS)

1. **AM** — Encargado registra en PWA: selecciona receta, ingresa cantidad_producida. BOM calcula consumo automático.
2. **Automático** — WITH RECURSIVE recorre receta_ingredientes multinivel. Deduce de inventario bodega.
3. **PM** — Ingresa cantidad_enviada. Merma = producida − enviada (GENERATED). Si merma > umbral, alerta admin.
4. **Dashboard** — Compara producción real vs forecast para ajustes futuros.

### Flujo 10 — Órdenes de Compra (OPS)

1. **Detección** — Dashboard muestra productos con alerta_activa (stock ≤ mínimo). Sistema sugiere cantidades.
2. **Admin aprueba** — Si monto > umbral, requiere aprobación. Estado → 'enviada'.
3. **Seguimiento** — OC en estado 'enviada' hasta recepción (Flujo 4). Parcial o completa.

### Flujo 11 — Menú Digital + Orden de Cliente (v4)

1. **Cliente** — Visita menú PWA público (menu.freakiedogs.com). Ve catálogo con fotos, precios, filtra por sucursal.
2. **Pedido** — Arma pedido con extras (JSONB), ingresa datos de entrega, método de pago.
3. **Automático** — INSERT delivery_clientes estado='recibida'. Supabase Realtime push al despachador.
4. **Despachador** — Ve orden en tiempo real, asigna cocina de sucursal más cercana → Flujo 12.

### Flujo 12 — Delivery Despachador + Driver (DEL)

1. **Despachador** — Panel Realtime con órdenes activas. Filtra por sucursal, estado, tiempo. Asigna driver.
2. **Cocina** — Cajera/gerente marca orden 'lista' cuando está preparada.
3. **Driver** — Despachador marca 'en_camino', registra distancia_km. Al entregar, marca 'entregada'.
4. **Automático** — Trigger crea registro en viajes_delivery con distancia, hora, si es fuera de horario.

### Flujo 13 — Reporte Diario de Asistencia (RRHH)

1. **9:00 PM** — Gerente reporta asistencia de su equipo en PWA. Para cada empleado: presente/ausente/justificado, hora entrada/salida, tardanzas, horas extra (diurna/nocturna).
2. **Automático** — Si sucursal tiene_propina=true, registra propina_quanto en propinas_diarias.
3. **10:00 PM** — pg_cron verifica que todas tengan reporte. Si falta, recordatorio Telegram.

### Flujo 14 — Evaluación Mensual de Propinas (v6)

1. **Día 1** — pg_cron crea propina_evaluacion_mensual para 3 sucursales. Calcula propina_total_mes.
2. **Día 1-3** — Gerente evalúa en PWA: para cada empleado marca ✅ gana o ❌ pierde (con motivo obligatorio).
3. **Automático** — Trigger calcula: monto_por_persona = (propina_total × 90%) ÷ (beneficiarios + 1 producción). Pierde = $0.
4. **Admin aprueba** — Revisa evaluaciones. Si algo no cuadra, devuelve al gerente.
5. **Planilla** — Montos aprobados se integran en planilla_detalle.propina_mensual (2da quincena).

### Flujo 15 — Registro de Viajes Delivery (v6)

1. **Automático** — Al marcar orden 'entregada', trigger crea viajes_delivery tipo='entrega' con distancia y driver.
2. **Manual** — Para mandados: gerente registra en PWA tipo='mandado', driver, distancia aproximada.
3. **Automático** — Trigger clasifica tarifa según config_delivery: <17km→$0.50, ≥17km→$1.00, fuera_horario→+$3.00, mandado→$0.50.
4. **Fin de mes** — pg_cron + Edge Function calcula bonos_delivery_mensual por driver. Estado='calculado'.
5. **Admin aprueba** — Revisa bonos, aprueba → se integran en planilla 2da quincena.

### Flujo 16 — Planilla Quincenal (RRHH)

1. **Día 13 o 28** — pg_cron + Edge Function calcula planilla: días trabajados, horas extra, faltas, adelantos, descuentos. En 2da quincena agrega propina y bono delivery. Aplica ISSS 3%, AFP 7.25%, ISR progresivo. Estado='calculada'.
2. **RRHH (Majo) revisa** — PWA muestra tabla completa. Puede ajustar con justificación. Marca 'revisada'.
3. **Admin aprueba** — Revisa totales. Estado='aprobada'.
4. **Automático** — Edge Function genera PDF de boleta por empleado → Supabase Storage.
5. **Día 15 o último** — Majo marca 'pagada'. Adelantos y préstamos se liquidan automáticamente.

### Flujo 17 — Contador Exporta Datos (FIN)

1. **Dashboard** — Contador accede a "Contabilidad" (solo lectura): compras, planillas, conciliación.
2. **Exportación DTE** — Filtro por fechas/proveedor. Exporta Excel con formato IVA: UUID, NRC, NIT, subtotal, IVA, total.
3. **Exportación planilla** — Formato PLA del ISSS + formato AFP con NUP, salario, cuotas.
4. **Exportación conciliación** — Estado de conciliación mensual para revisión externa.

### Flujo 18 — Conciliación Bancaria (FIN)

1. **Mensual** — Admin sube CSV/Excel del estado de cuenta. Sistema parsea movimientos.
2. **Automático** — Edge Function auto-match: débitos vs compras (monto + fecha ±3 días), créditos vs depósitos ventas.
3. **Manual** — Admin revisa pendientes/'no_identificado'. Asigna, marca, agrega notas.
4. **Dashboard** — % conciliado, monto pendiente. Cuando total_pendientes = 0 → estado='completa'.

### Flujo 19 — Marketing Analytics (MKT)

1. **Diario** — Make.com extrae métricas: Meta Graph API (Instagram @freakiedogs + Facebook) y TikTok Business API. Inserta en posts_redes con deduplicación.
2. **Diario 6AM** — pg_cron refresca MATERIALIZED VIEW marketing_ventas_correlacion. Cruza posts con ventas día 0/+1/+2. Calcula lift_pct vs promedio 4 semanas.
3. **Dashboard** — PWA "Marketing" (rol marketing): engagement por plataforma, mejores horarios, correlación posts↔ventas, top posts por lift, rendimiento por tipo contenido y por creador.
4. **Semanal lunes 9AM** — Telegram digest al grupo marketing: top 3 posts engagement, top 3 lift ventas, alcance total, vs semana anterior.

---

## 12. Make.com — Escenarios

### 10.1 Escenarios — Estado Actualizado 24 Mar 2026

| ID | Escenario | Schedule | Status |
|----|-----------|----------|--------|
| 4501370 | FD — Alertas Cierres Nocturnos (8PM) | 20:00 SV (02:00 UTC) | ✅ Activo, funcional |
| 4502189 | FD — Alertas Cierres 11PM | 23:00 SV (05:00 UTC) | ✅ Activo, fix aplicado |
| 4485817 | FD — QUANTO → Ventas Diarias + Propinas (RPC) | 07:00 SV (13:00 UTC) | ✅ Activo. POST a `rpc/agregar_ventas_quanto`. Backfill ejecutado: 1,216 ventas_diarias, 621 propinas_diarias. |
| 4504162 | FD — Serfinsa → Validación Tarjetas (RPC) | 11:00 SV (17:00 UTC) | ✅ Activo. Gmail trigger (from:serfinsa) → listAttachments → POST `rpc/procesar_dte_json`. Conexión Gmail ID 8008318. Backfill: 868 filas serfinsa_detalle_diario (Ago 2025–Mar 2026). |
| 4504164 | FD — DTEs Gmail → Compras (RPC) | Cada 60 min | ✅ Activo. Gmail trigger (subject:DTE, hasAttachment:true) → listAttachments → POST `rpc/procesar_dte_json` (dual-write: compras + compras_dte). Conexión Gmail ID 8008318. 1053 DTEs totales (368 con dte_codigo). Fix aplicado: `{{{toString(2.data)}}}`. **Cruce automático:** pg_cron 2AM ejecuta `cruce_diario_dte()` — match exacto + parcial con revisión manual en PWA. |
| 4485768 | Integration Webhooks | Manual | ❌ Inactivo, no configurado |

### 10.2 Conexión Gmail — ✅ ACTIVA

Conexión Gmail autorizada el 24 Mar 2026. ID conexión: **8008318** (freakiedogs@gmail.com). Expira: 2026-09-20.
App: google-email v4. Módulos en uso: triggerWatchNewEmails, listEmailAttachments.
Ambos escenarios (4504162 y 4504164) actualizados con trigger Gmail y **activados**.

> **⚠️ LECCIÓN APRENDIDA (Make.com OAuth):** Para que un escenario Gmail quede `isinvalid:false + islinked:true`, el blueprint vía API DEBE incluir `metadata.restore.parameters.__IMTCONN__` con el label de la conexión Y llamar `scenarios_activate` después de cada update. El patrón que funciona: (1) usuario edita en UI → (2) API llama `scenarios_activate`. Updates posteriores por API preservan el estado vinculado si se mantiene el `metadata.restore.__IMTCONN__`.

### 10.3 Escenarios Futuros (Fases 3+)

| # | Escenario | Trigger | Destino |
|---|-----------|---------|---------|
| 1 | Meta Graph API | Schedule semanal | Supabase tabla analytics |
| 2 | TikTok Business API | Schedule semanal | Supabase tabla analytics |

### 10.3 Edge Function — alertas-nocturnas

- **ID:** d4e3d476
- **Status:** ACTIVE
- **URL:** https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/alertas-nocturnas
- Verifica cierres del día
- Detecta faltantes (sin cierre)
- Detecta diferencias >$5
- Retorna JSON formateado para Telegram
- Acceso: Bearer token (anon key de Supabase)

**Plan Make.com:** Core ($9/mes) — desbloqueó múltiples horarios + operaciones

---

## 13. QUANTO — Data Warehouse Supabase

### 11.1 Estado de Importación Histórica

| Período | Trans. | DTEs | Items | Tiendas | Estado |
|---------|--------|------|-------|---------|--------|
| Ene 2025 | 3,068 | 3,040 | 6,611 | M001 S001 | ✅ Importado |
| Feb–Mar 2025 | 6,624 | 6,514 | 14,388 | M001 S001 | ✅ Importado |
| Abr–May 2025 | 7,022 | 6,882 | 15,996 | M001 S001 | ✅ Importado |
| Jun 2025 | 5,480 | 5,377 | 13,687 | M001 S001 | ✅ Importado |
| Jul 2025 | 7,224 | 7,054 | 18,806 | M001 S001 | ✅ Importado |
| Ago 2025 | 12,454 | 12,236 | 26,007 | M001 S001 S002 | ✅ Importado |
| Sep 2025 | 9,685 | 9,497 | 21,000 | M001 S001 S002 | ✅ Importado |
| Oct 2025 | 11,219 | 10,995 | 24,346 | M001 S001 S002 | ✅ Importado |
| Nov 2025 | 12,772 | 12,530 | 30,043 | M001 S001 S002 S003 | ✅ Importado |
| Dic 2025 | 16,739 | 16,506 | 41,311 | 5 tiendas | ✅ Importado |
| Ene 2026 | 16,563 | 13,841 | 35,469 | 5 tiendas | ✅ Importado |
| Feb 2026 | 13,546 | 12,272 | 31,696 | 5 tiendas | ✅ Importado |
| Mar 2026 (1–21) | 10,892 | 10,710 | 27,889 | 5 tiendas | ✅ Importado |

Scripts de importación: PASO2 (Ene–May), PASO3 (Jun–Nov), PASO4 (Dic 2025–Mar 2026)

> ⚠ **Pendiente:** Re-exportar S001 Oct–Nov 2025 desde QUANTO admin y re-importar a Supabase (gap en data histórica).

### 11.2 Mecanismo de Ingesta — IMPORTANTE

**La ingesta de QUANTO es MANUAL (no automática).** El pipeline Make.com ID 4485817 ("FD — QUANTO → Ventas Diarias") NO extrae datos de la API de QUANTO. Solo agrega lo que ya existe en `quanto_transacciones` → `ventas_diarias`. Los scripts Python (PASO2/3/4) fueron una importación histórica masiva ejecutada el 21-22 Mar 2026.

**Flujo actual (manual):**
1. Exportar CSV de transacciones desde https://admin.quantopos.com/ (por sucursal y rango de fechas)
2. Ejecutar script PASO4 para el rango faltante → inserta en `quanto_transacciones`
3. Make.com ID 4485817 (07:00 diario) agrega automáticamente → `ventas_diarias`

**Gap actual:** Mar 22-24, 2026 sin datos. Causa: no se ejecutó exportación/importación esos días.

**Solución inmediata:** Exportar CSV desde QUANTO admin para Mar 22, 23, 24 → ejecutar `quanto_import3/PASO4_importar.py` con fechas específicas. Datos estarán disponibles en DashboardEjecutivo dentro de ~5 minutos.

**Solución implementada (24 Mar noche):** Edge Function `importar-quanto-csv` + página `quanto-upload.html` + Make.com webhook (ID 4512847). Flujo: usuario exporta CSV de QUANTO admin → abre `quanto-upload.html` → arrastra CSV → Edge Function parsea e inserta en `quanto_transacciones` automáticamente. Soporta detección flexible de columnas (ES/EN), upsert con dedup, y store_code configurable.

**Nota:** Google Drive folder-watcher NO es viable con @gmail.com (Make.com requiere Google Workspace para scopes restringidos). La página `quanto-upload.html` es la solución definitiva. Si en el futuro migran a Google Workspace, se puede reactivar el folder-watcher.

---

## 14. Costos del ERP

| Componente | Hoy | 8 sucursales | Alto volumen |
|------------|-----|-------------|-------------|
| Supabase (DB + Auth + Storage + Edge Functions) | $0 | $0 | $25 |
| Vercel (PWA hosting) | $0 | $0 | $0 |
| Make.com (integraciones) | $9 | $9 | $16 |
| Telegram Bot | $0 | $0 | $0 |
| BuhoPay | — | — | **ELIMINADO** (reemplazado por menú PWA propio) |
| **TOTAL MENSUAL** | **$9/mes** | **$9/mes** | **$41/mes** |

> 17 módulos, 39 tablas, 19 flujos, 9 roles, 28-30 cuentas, 50+ empleados en planilla, ~20 drivers con bonos, menú público PWA, marketing analytics. **$9/mes.**

---

## 15. Planilla — Cálculo (El Salvador)

### 15.1 Datos que alimentan la planilla

- **Del gerente (reporte diario):** Asistencia, horas extra (diurna ×2 / nocturna ×2.5), llegadas tarde
- **Del cierre de caja:** Adelantos en efectivo a empleados
- **De QUANTO (vía Make.com):** Propinas diarias → acumuladas mensualmente
- **De la evaluación del gerente (propinas):** Quién ganó/perdió propina del mes + montos
- **De viajes delivery:** Bonos mensuales calculados automáticamente
- **De RRHH (Majo):** Salario base, descuentos recurrentes (préstamos, uniformes), sanciones

### 15.2 Fórmula

```
INGRESOS:
  Salario base quincenal (mensual ÷ 2)
+ Horas extra (diurnas × hora × 2, nocturnas × hora × 2.5)
+ Propina mensual (solo 2da quincena, de evaluación aprobada)
+ Bono delivery (solo 2da quincena, de bonos aprobados)

DESCUENTOS DE LEY:
− ISSS empleado: 3% (tope $1,000 base mensual)
− AFP empleado: 7.25%
− ISR: tabla progresiva (sobre gravable = salario + extras − ISSS − AFP)

OTROS DESCUENTOS:
− Adelantos en efectivo
− Faltas sin justificación (proporcional)
− Llegadas tarde (según política)
− Préstamos / cuotas recurrentes
− Uniformes / otros

= SALARIO NETO A PAGAR

Patronal (información): ISSS 7.5% + AFP 8.75% + INSAFORP 1%
```

### 15.3 Ejemplo de Evaluación de Propinas — Sucursal Escalón, Marzo 2026

- Propina total del mes (QUANTO): $1,350.00
- 90% a repartir: $1,215.00
- 10% empresa: $135.00
- Empleados evaluados: 6 + 1 producción = 7
- Gerente decide: 5 ganan ✅, 1 pierde ❌ (motivo: "3 faltas sin justificar")
- Beneficiarios finales: 5 + 1 producción = **6 personas**
- **Propina por persona: $1,215.00 ÷ 6 = $202.50**

### 15.4 Ejemplo de Bono Delivery — Driver Carlos, Marzo 2026

| Concepto | Cantidad | Tarifa | Subtotal |
|----------|----------|--------|----------|
| Entregas normales (<17km) | 45 | $0.50 | $22.50 |
| Entregas largas (≥17km) | 12 | $1.00 | $12.00 |
| Fuera de horario | 5 | $3.00 | $15.00 |
| Mandados | 8 | $0.50 | $4.00 |
| **BONO TOTAL** | **70 viajes** | | **$53.50** |

> Este monto se suma al salario fijo del driver en la planilla de la 2da quincena.

### 15.5 Boleta de Pago — 2da Quincena (Ejemplo con propina + bono delivery)

**FREAKIE DOGS — Boleta de Pago**
Período: 16/Mar/2026 — 31/Mar/2026 (2da Quincena)
Empleado: **Carlos Mejía** — Delivery Driver — Sucursal: Escalón

**INGRESOS:**

| Concepto | Monto |
|----------|-------|
| Salario base quincenal | $175.00 |
| Horas extra (4h diurnas × $2.19) | $8.76 |
| Propina mensual (evaluación marzo) | $202.50 |
| Bono delivery (70 viajes) | $53.50 |
| **Total devengado** | **$439.76** |

**DESCUENTOS DE LEY:**

| Concepto | Monto |
|----------|-------|
| ISSS (3% s/salario+extras) | -$5.51 |
| AFP (7.25% s/salario+extras) | -$13.32 |
| ISR (tabla progresiva) | -$0.00 |

**OTROS DESCUENTOS:**

| Concepto | Monto |
|----------|-------|
| Adelantos en efectivo (1) | -$20.00 |
| Cuota préstamo uniforme | -$15.00 |
| **Total descuentos** | **-$53.83** |

**NETO A PAGAR: $385.93**

> Días trabajados: 14/16 | Faltas: 1 (justificada) | Llegadas tarde: 1
> Viajes: 45 normal + 12 larga + 5 nocturno + 8 mandados = 70 total
> Boleta generada como PDF descargable desde la PWA por el empleado o por RRHH.

---

## 16. GitHub — Plugin Instalado

- **Plugin:** `freakie-github` ✅ Instalado en Cowork
- **MCP:** @modelcontextprotocol/server-github
- **Token:** Nuevo token rotado (el anterior fue revocado)
- **Skill:** `github-erp` — contexto del repo + instrucciones
- **Capacidad:** Leer, editar y pushear archivos directamente desde Claude
- **Status:** ✅ Listo para usar

---

## 17. Estado Real — Auditoría 25 Mar 2026 (madrugada)

> Auditoría contra Supabase (datos reales), Make.com (escenarios) y Vercel (PWA). Refleja lo que EXISTE y FUNCIONA.

### ✅ Lo que SÍ está operativo

- **Data Warehouse QUANTO:** 135,099 trans (133,900 csv + 1,199 dte) / 101,283 DTEs / 402,954 items (Ene 2025 – Mar 2026)
- **PWA Core:** Desplegada en Vercel, login por rol, cierre de caja, reporte de turno, incidentes
- **PWA DashboardVentas:** ✅ OPERATIVO — 5 tabs (Hoy, 14 días, Productos, Semanal, Nómina). Admin ve todo, gerente ve su sucursal.
- **PWA DashboardEjecutivo:** ✅ OPERATIVO — rol=ejecutivo, 3 tabs (Resumen, Sucursales, Financiero), KPIs en tiempo real, tendencia 14 días (SVG), compras vs ventas, préstamos activos. PINs: 1000/2000/3000/4000. Fix aplicado 24-Mar noche: NOMBRES→STORES global, "Marzo 2026" dinámico.
- **Supabase:** 41+ tablas creadas + 4 tablas Serfinsa + serfinsa_detalle_diario, RLS, Auth, Storage (5 buckets)
- **6 Vistas SQL analytics:** vista_ventas_diarias, vista_performance_vs_meta, vista_top_productos, vista_patron_semanal, vista_labor_cost_ratio, vista_reporte_telegram — todas ✅ con RLS anon + GRANT
- **metas_ventas:** ✅ Regenerada 25-Mar-2026 con 5 metas (M001:$2,370, S004:$1,542, S003:$1,135, S001:$987, S002:$468). Make.com 11AM lanzará primer reporte hoy.
- **14 usuarios** con PINs en usuarios_erp, 9 sucursales configuradas (5 con store_code)
- **Edge Function** alertas-nocturnas (ACTIVE, ID d4e3d476)
- **Edge Function** reporte-manana ✅ ACTIVA — formatea reporte diario para Telegram
- **Edge Function** calcular-metas ✅ ACTIVA — calcula metas día siguiente por sucursal: Base×F_DoW×F_Quincena×F_Feriado. ID 43a220f6.
- **Edge Function** alerta-11am ✅ ACTIVA — reporte 11AM: ventas actuales + proyección vs meta. ID d8c1e7a5.
- **Make.com 8PM** (ID 4501370): ✅ Funcional
- **Make.com 11PM** (ID 4502189): ✅ Fix aplicado — funcional
- **Make.com QUANTO→RPC** (ID 4485817): ✅ Reconfigurado — POST a `rpc/agregar_ventas_quanto`, 0 errores
- **Make.com Reporte Mañana** (ID 4504370): ✅ Activo — 07:30 diario → Edge Function → Telegram
- **Make.com DTEs→Compras** (ID 4504164): ✅ Activo — Gmail trigger → JSON attachment → RPC procesar_dte_json (dual-write compras + compras_dte). pg_cron 2AM cruce_diario_dte() con match exacto + parcial.
- **Make.com Serfinsa→Validación** (ID 4504162): ✅ Activo — Gmail trigger (from:serfinsa) → attachment → RPC
- **Make.com Alerta 11AM** (ID 4509069): ✅ ACTIVO — 11:00 SV diario → Edge Function alerta-11am → Telegram con meta vs proyección
- **Make.com QUANTO CSV Upload** (ID 4512847): ✅ ACTIVO — Webhook trigger → Edge Function `importar-quanto-csv`. Webhook URL: `https://hook.us2.make.com/tekwspl79dcwnuw1xh7ftrlq183gl4ar`. Página de upload: `quanto-upload.html` en Vercel.
- **Edge Function** importar-quanto-csv ✅ ACTIVA **v6** — Parsea CSV con mapeo flexible de columnas (ES/EN, 30+ variantes), parseo de fechas en español ("marzo 24 2026, 4:19:58 pm"→ISO), hashRow() para numero_orden faltante, acepta JSON pre-parseado de DTEs (ZIP). **Incluye campo `source`** automático (csv/dte) en cada insert. Upsert en quanto_transacciones. ID 148203d8. GRANT service_role aplicado 25-Mar.
- **quanto-upload.html v2:** Soporta drag-and-drop de CSV (QUANTO export) + ZIP de DTEs (JSON factura electrónica). Client-side: JSZip descomprime, parsea cada DTE JSON, extrae fecha+hora, store_code de numeroControl, total, metodo_pago (01→Efectivo, 02→Tarjeta), envía en chunks de 500 al Edge Function.
- **Arquitectura datos ventas:** Columna `source` en quanto_transacciones (csv:133,900 / dte:1,199) y ventas_diarias (default 'cierre'). Tabla `ventas_diarias_historico` para snapshots. Tabla `ajustes_cruce` para correcciones de método de pago. RPC `actualizar_ventas_diarias()` con jerarquía cierre<csv<dte + auto-snapshot. Vista `v_ajustes_cruce_resumen` para reconciliación Serfinsa/BAC.
- **Gmail OAuth:** Conexión ID 8008318 (freakiedogs@gmail.com) activa, expira Sep 2026
- **Google Drive OAuth:** ❌ No viable — cuentas @gmail.com no permiten scopes restringidos en Make.com (requiere Google Workspace). Se usa `quanto-upload.html` como alternativa directa.
- **Bot Telegram** @FreakieDogsMonitor confirmado (Chat ID 8547715106)
- **Config parametrizable:** config_delivery (5 filas), config_isr (4 tramos)
- **GitHub + Vercel:** Plugin freakie-github instalado, deploy automático
- **5 RPC Functions:** agregar_ventas_quanto (v2 con jerarquía source), validar_serfinsa_diario, procesar_dte_json, actualizar_ventas_diarias (jerarquía cierre<csv<dte + auto-snapshot), calcular metas vía SQL
- **PWA Ajuste Cruce de Método:** ✅ Desplegado en Vercel — sección en cierre de caja para correcciones de método de pago. Graba en tabla `ajustes_cruce`.
- **Backfill ventas_diarias:** 1,216 filas ($2.2M total) + 621 propinas_diarias ($99K)
- **Backfill compras:** 685 DTEs ($438K, Nov 2025–Mar 2026) — 672 CCF + 8 Facturas + 5 Notas Crédito. Escenario Gmail pipeline verificado y funcional.
- **Backfill Serfinsa detalle:** 868 filas (Ago 2025–Mar 2026), $733K ops, $34.8K propinas, $11.6K comisión
- **Backfill Serfinsa validación:** 13 días validados (Mar 9-22). Hallazgo: ~3-4% diferencia = propinas en tarjeta

### ⚠️ Inactivos / obsoletos

| Componente | Estado | Nota |
|------------|--------|------|
| Tickets DTEs JSON (ID 4485872) | Inválido | Reemplazado por ID 4504164. Eliminar. |
| Integration Webhooks (ID 4485768) | Inactivo | Sin uso. |

### ⚠️ Hallazgos diagnóstico 24 Mar 2026 (noche)

| Hallazgo | Detalle | Acción |
|----------|---------|--------|
| **QUANTO gap Mar 22-24** | `quanto_transacciones` termina en 2026-03-21. La ingesta es MANUAL (no automática). Causa: no se ejecutó export/import script. | ✅ Pipeline listo: quanto-upload.html v2 soporta CSV + ZIP DTEs. GRANT service_role aplicado. Pendiente: usuario suba archivos. |
| **compras.sucursal_id = NULL** | Los 685 DTEs tienen `sucursal_id = NULL` — no es un bug. Todas las compras van a casa matriz, no a sucursales individuales. Comportamiento CORRECTO por diseño del negocio. | Documentar — no corregir |
| **metas_ventas pre-pobladas** | ✅ RESUELTO — 150 metas pre-pobladas eliminadas (sesión anterior). Tabla limpia. Regenerar con `calcular-metas` una vez importados datos QUANTO faltantes. | Esperar datos QUANTO Mar 22-24 |
| **ventas_diarias columna** | Columna correcta es `total_ventas_quanto` (NOT `total_ventas`). DashboardEjecutivo ya usa `quanto_transacciones.total` directamente — no afectado. | ✅ Verificado |

### ❌ Tablas vacías (schemas existen pero 0 datos operativos)

inventario (0), recepciones (0), pedidos_sucursal (0), incidentes (0), delivery_clientes (0), ordenes_compra (0), produccion_diaria (0), asistencia_diaria (0), conciliaciones (0), movimientos_bancarios (0). **ventas_diarias: 1,216 filas. propinas_diarias: 621 filas. compras: 685 DTEs. serfinsa_detalle_diario: 868 filas. metas_ventas: activa desde 24-Mar-2026.**

---

## 18. Roadmap — 8 Fases (estado real corregido 24 Mar 2026)

### Fase 1 — Infraestructura + Data Warehouse (Sem 1-2) ✅ COMPLETADO
- Supabase: todas las tablas creadas, RLS por rol, Auth, Storage, Edge Functions
- PWA base desplegada en Vercel: login por rol, navegación mobile-first
- Import histórico QUANTO (scripts PASO2/3/4): 132K trans, 101K DTEs, 402K items
- Módulo Cierre de Caja (Flujo 1): formulario gerente + GENERATED + alertas Telegram ✅
- Módulo Reporte de Turno (gerente + cocina) + IncidentesDash ✅
- Módulo Incidentes (Flujo 8): reporte + foto ✅
- Bot Telegram creado, alertas 8PM+11PM ✅ (11PM con error menor)
- 14 usuarios, 4 manuales PDF, fix fechas UTC-6, GitHub plugin

### Fase 2 — Flujo de Datos Automático (Sem 3-4) ⏳ EN PROGRESO (90% completo)
- ✅ Make.com QUANTO → RPC agregar_ventas_quanto → upsert ventas_diarias + propinas_diarias (Flujo 2). Backfill: 1,216 + 621 filas.
- ✅ Fix escenario 11PM — BundleValidationError resuelto (camelCase params)
- ✅ RPC procesar_dte_json creada y testeada — parsea JSON DTE estándar MH, dedup por UUID
- ✅ RPC validar_serfinsa_diario creada — 13 días procesados, validación funcional
- ✅ 4 tablas Serfinsa creadas (terminales, liquidaciones, validacion_diaria, detalle_diario)
- ✅ Gmail OAuth autorizado (conexión ID 8008318, freakiedogs@gmail.com, expira Sep 2026)
- ✅ Make.com Gmail → compras DTE (ID 4504164): **ACTIVO** — Gmail trigger → JSON → RPC. Backfill: 685 DTEs ($263K)
- ✅ Make.com Serfinsa → validación (ID 4504162): **ACTIVO** — Gmail trigger (from:serfinsa) → RPC
- ✅ Backfill serfinsa_detalle_diario: 868 filas desde Excel Master (Ago 2025–Mar 2026, 5 sucursales, $733K ops)
- ✅ Backfill compras: 685 DTEs de 788 JSONs procesados (97.8%), tipos 03/01/05
- ✅ Excel Master analizado: 29 hojas, datos valiosos extraídos (Serfinsa, Caja, Planilla, Costos, Recetario, Proveedores, etc.)
- ✅ Dashboard ventas con datos reales — DashboardVentas desplegado (5 tabs, filtro por rol, 6 vistas SQL con RLS anon)
- ✅ **Metas 11AM + alerta Telegram** (Flujo 7): Edge Function `calcular-metas` (upsert metas por sucursal, fórmula Base×DoW×Quincena×Feriado, 60d histórico) + `alerta-11am` (proyección vs meta) + Make.com ID 4509069 activo (11:00 SV diario)
- ⏳ Inventario: cargar stock inicial + alertas automáticas

### Fase 3 — Supply Chain Completo (Sem 5-8) — ⏳ EN PROGRESO

#### Modelo de negocio (confirmado 24 Mar 2026 — descripción detallada de Jose):

**Regla general:** Todas las compras a proveedores son globales (Freakie Dogs), entran a casa matriz (Plaza Cafetalón, producción central). Desde ahí se preparan pedidos diarios hacia las sucursales de venta.

**Excepciones:** Las sucursales hacen compras eventuales/emergencia directo en sucursal → reflejadas en los cierres de caja. Algunas llegan al correo, otras no (compras menores). **Regla:** compra recepcionada en casa matriz = compra global (`compras.sucursal_id = NULL`); compra via cierre de caja de sucursal = asignada a esa sucursal.

**Fuentes de DTEs:** No todos los DTEs llegan al correo — algunos solo llegan en físico a casa matriz. El **source principal de compras es la PWA del Encargado de Almacén**, no Gmail.

#### Flujo A — Compras a Proveedores (OC → Recepción Casa Matriz)

1. **ERP genera sugerencia de pedido** a persona encargada de compras (basado en stock actual, consumo proyectado, stock mínimo)
2. **Encargado de compras ajusta** cantidades y **confirma** que se realizó la compra
3. Esto **precarga el pedido a recepcionar** en la PWA de Marcos Flores (encargado casa matriz/almacén)
4. **Proveedor llega a casa matriz** → Marcos busca el proveedor en su PWA → ve pedido precargado
5. **Marcos confirma cantidades reales recepcionadas** (pueden diferir del pedido), **ingresa precio_unitario por item**, **digita últimos 4 dígitos del DTE** (dte_codigo) y **toma foto al DTE físico**
6. **Cruce automático DTE:** pg_cron 2AM compara dte_codigo+fecha (exacto) y proveedor+fecha (parcial). Matches parciales requieren aprobación manual en PWA.
7. **Al confirmar recepción → incrementa inventario** de materia prima en base de datos (casa matriz). **Auto-actualiza precio sugerido** en proveedor_productos.
8. **Edición completa** disponible por 72h: cambiar proveedor, items, precios, notas, foto, DTE. **Eliminación** con reversión automática de inventario.

#### Flujo B — Producción Diaria (Casa Matriz → Subproductos)

1. **Persona encargada de producción** registra diariamente en PWA qué se produjo (ej: 200 panes smash, 50L salsa, etc.)
2. **Sistema deduce materia prima** del inventario casa matriz según recetas/BOM
3. **Incrementa inventario de subproductos** en casa matriz
4. Resultado: inventario correcto de materia prima Y subproductos en todo momento

#### Flujo C — Pedido Nocturno de Sucursal → Despacho

1. **Noche:** Encargado de cocina de cada sucursal **toma inventario** mediante PWA (conteo físico)
2. **Sistema sugiere pedido** para el día siguiente de materia prima + subproductos basado en **proyecciones de venta por producto**
3. **Encargado de cocina modifica y aprueba** el pedido
4. **Mañana siguiente:** En casa matriz, encargado de almacén **ve pedidos aprobados** de todas las sucursales
5. **Almacén prepara** los pedidos por sucursal y **despacha**
6. **Transportista interno** lleva los pedidos a cada sucursal
7. **En sucursal:** Gerente, cajero o encargado de cocina **confirma cantidades recepcionadas** en PWA
8. **Sistema descarga inventario casa matriz** + **incrementa inventario sucursal**

#### Flujo D — Control de Inventario Sucursal (Teórico vs Real)

1. **Inventario inicial del día** = inventario al momento de recepcionar pedido de la mañana
2. **Durante el día:** ventas descargan inventario teórico automáticamente (QUANTO ventas × BOM)
3. **Final del día:** Encargado de cocina reporta **inventario real** (conteo físico en PWA)
4. **Sistema calcula:** Inventario teórico (inicial − ventas del día) vs Inventario real reportado
5. **Diferencia = merma/desperdicio/robo** → alertas si supera umbral configurable
6. Este control es de GRAN VALOR para la operación — visibilidad total de pérdidas por sucursal

#### Dashboard Ejecutivo — Costos por Sucursal

- Llevar control de lo **despachado a cada sucursal** (materia prima + subproductos)
- Cada despacho con su **costo promedio ponderado** (del inventario de casa matriz)
- **Control de costos por sucursal** = total despachado vs total vendido = margen real por local

#### Tareas técnicas Fase 3:
- ~~Tablas nuevas: `ordenes_compra`, `ordenes_compra_items`~~ ✅ COMPLETADO — ordenes_compra upgraded con proveedor_id, estados CHECK, recepcion_id FK. ordenes_compra_items creada con stock tracking y cantidades sugeridas. RLS + GRANTs configurados.
- ~~UI PWA Encargado Compras: sugerencias de pedido, confirmar OC~~ ✅ COMPLETADO — Tab Compras con lista OC, NuevaOC (sugerencia automática vía RPC), DetalleOC (aprobar/cancelar). 5 tabs totales en PWA.
- ~~UI PWA Marcos Flores (Almacén): recepción vs OC precargada, foto DTE, confirmar cantidades~~ ✅ COMPLETADO — Auto-detección de OC aprobada al seleccionar proveedor, precarga items, banner visual OC vinculada, auto-cierre OC al guardar recepción.
- Tablas pendientes: `despachos_sucursal`, `despacho_items`, `produccion_diaria_items`, `inventario_conteo_nocturno`
- UI PWA Producción: registro producción diaria → descuento MP + incremento subproductos
- UI PWA Almacén Despacho: ver pedidos aprobados por sucursal, preparar y marcar despachado
- UI PWA Sucursal Recepción: confirmar cantidades recepcionadas
- UI PWA Cocina Nocturno: conteo inventario + sugerencia pedido + aprobar
- ~~Lógica comparación DTE foto vs DTE email (anti-duplicación)~~ ✅ COMPLETADO — Cruce automático por dte_codigo+fecha (exacto) + proveedor+fecha (parcial con revisión manual). pg_cron 2AM. UI aprobación en Historial.
- Costo promedio ponderado en despachos → Dashboard Ejecutivo costos por sucursal
- Control inventario teórico vs real (ventas QUANTO × BOM vs conteo nocturno)

### Fase 4 — Recetas/BOM + Costeo Multinivel (Sem 9-10) — Pendiente
- Cargar recetas completas del menú (platos + sub-recetas multinivel)
- Reporte producción diaria (Flujo 9) con consumo automático de MP según BOM
- WITH RECURSIVE para costeo multinivel (plato → sub-receta → materia prima)
- Forecast por ingredientes (explotar BOM × demanda proyectada)
- Dashboard de costos y márgenes por plato
- Integración con Flujo B (producción) y Flujo D (inventario teórico)

### Fase 5 — Conciliación Bancaria + Contador (Sem 9-10) — Pendiente
- Subir estados de cuenta + auto-clasificación (Flujo 18)
- Interfaz de revisión manual de movimientos pendientes
- Rol contador con exportaciones (Flujo 17): DTEs para IVA, planillas para ISSS/AFP
- Dashboard de conciliación

### Fase 6 — Marketing Analytics (Sem 11-12) — Pendiente
- Configurar Meta Business Suite + TikTok Business Center
- Make.com escenarios para Meta Graph API + TikTok API (Flujo 19)
- Vista materializada de correlación + pg_cron refresh
- Dashboard marketing: engagement, mejores horarios, lift de ventas
- Digest semanal por Telegram

### Fase 7 — Planilla + RRHH + Propinas Mensuales (Sem 13-14) — Pendiente
- Tabla empleados + cargar 50+ empleados
- Asistencia diaria integrada al reporte del gerente (Flujo 13)
- Propinas: acumulación diaria + evaluación mensual del gerente (Flujo 14)
- Cálculo de planilla quincenal con ISR progresivo (Flujo 16)
- Boletas de pago en PDF
- Descuentos recurrentes (préstamos, uniformes)
- Exportación para ISSS/AFP
- Rol RRHH (Majo) + aprobación admin

### Fase 8 — Delivery Propio + Bonos + Menú Digital (Sem 15-16) — Pendiente
- Menú digital público PWA (Flujo 11): catálogo, carrito, checkout (reemplaza BuhoPay)
- Panel despachador con Supabase Realtime (Flujo 12)
- Registro de viajes delivery automático + manual (Flujo 15)
- Cálculo mensual de bonos por driver con tarifas parametrizables
- Integración bonos → planilla (2da quincena)
- Testing completo de todos los módulos
- Optimización de performance y UX mobile
- Capacitación de usuarios por rol

---

## 19. Archivos y Scripts Existentes

Base: ~/Documents/Freakies/Claude/Attachmets and PDFS 2026/

| Archivo / Carpeta | Descripción |
|--------------------|-------------|
| quanto_import/PASO2_importar.py | Import Ene–May 2025 → Supabase (trans + DTEs + items) |
| quanto_import2/PASO3_importar.py | Import Jun–Nov 2025 → Supabase |
| quanto_import3/PASO4_importar.py | Import Dic 2025 – Mar 2026 → Supabase |
| FreakiesFinanzas_2026_MASTER.xlsx | Excel maestro: Compras, Serfinsa, Cajas, Catálogo |
| gmail_downloader.py | Descarga automática attachments Gmail |
| run_all.py | Pipeline: Gmail → Compras → Serfinsa → Cajas |
| cierre_monitor.py | Monitor cierres de caja, alerta Telegram 8PM y 11PM |
| Cierre de Caja - Freakie Dogs.html | Formulario móvil cierre de caja (versión HTML actual) |
| reporte_incidentes.html | Formulario de incidentes diarios (versión HTML actual) |
| Cierres_Freakie_Dogs.xlsx | DB de cierres con pivot Resumen por sucursal |
| Freakie_Dogs_ERP_v6.html | Arquitectura ERP v6 completa (36 tablas, 17 módulos, 19 flujos) |
| Freakie_Dogs_Setup_Guide.html | Guía de setup paso a paso: Supabase → Vercel → Make.com → Telegram |

---

## 20. Pendientes Actuales (priorizado — actualizado 25 Mar 2026 madrugada)

### Prioridad Alta — Funcionalidad core
1. **Mapear terminales Serfinsa → sucursales**: Insertar en serfinsa_terminales para vincular liquidaciones con sucursales. Mapeo conocido del Excel: PC Tecla, PM Soya, PC Usul, GP Lourdes, PV Soyapango.
2. ~~**Dashboard ventas con datos reales**~~ ✅ COMPLETADO
3. ~~**Configurar Metas 11AM**~~ ✅ COMPLETADO
4. **Extraer más datos del Excel Master a Supabase**: Catalogo_Gastos (390 SKUs→catalogo_productos), Proveedores (31→tabla nueva o enriquecer), Recetario (costos→recetas+ingredientes), Caja (709 filas→validar vs ventas_diarias), Prestamos ($454K→tabla nueva), Planilla (→empleados).
5. ~~**Importar QUANTO Mar 22-24**~~ ✅ COMPLETADO — 1,199 DTEs + 1,216 CSVs. Tageados con `source`.
6. ~~**Crear pipeline QUANTO CSV/DTE**~~ ✅ COMPLETADO — Edge Function v6 + quanto-upload.html v2. Pusheado a GitHub ✅.
7. ~~**Regenerar metas_ventas**~~ ✅ COMPLETADO — 5 metas generadas para 25-Mar-2026 vía SQL (fórmula Base×DoW×Quincena×Feriado).
8. ~~**Implementar flujo ajustes_cruce en PWA**~~ ✅ COMPLETADO — "AJUSTE CRUCE DE MÉTODO" desplegado en Vercel. Tabla `ajustes_cruce` con CHECK constraints lista.
9. ~~**Conectar RPC `actualizar_ventas_diarias` a flujos**~~ ✅ COMPLETADO — RPC `agregar_ventas_quanto` v2 ahora usa jerarquía source (dte>csv>cierre) + auto-snapshot a `ventas_diarias_historico`. 6 cierres reemplazados por DTEs, snapshots guardados.
10. ~~**Iniciar Fase 3 — Supply Chain**~~ ⏳ EN PROGRESO — `almacen.html` desplegado. Flujos A+C: Recepción proveedor (con edición completa + eliminación 72h + precio_unitario + DTE 4 dígitos), despacho sucursales, inventario. Marcos Flores (PIN 5001). 5 tablas nuevas (incl. compras_dte). Cruce DTE email↔recepción PWA con pg_cron 2AM + UI revisión manual. procesar_dte_json dual-write. Casa Matriz = sucursal CM001.

### Prioridad Media — Operativo
7. Cambiar Chat ID Telegram a Jazmín una vez acordado
8. Cargar inventario inicial en al menos 1 sucursal piloto
9. 4 sucursales sin store_code QUANTO — Metro Centro, Plaza Integración, Plaza Olímpica, Driver Thru Lourdes
10. Renovar conexión Gmail antes de Sep 2026 (ID 8008318)

### Prioridad Baja — Data
11. Re-exportar S001 Oct–Nov 2025 desde QUANTO admin (gap data histórica)
12. PWA Directivos pendiente
13. Eliminar escenario obsoleto "Tickets DTEs JSON" (ID 4485872)
14. Los ~15 DTEs faltantes (~2.2%) — archivos JSON corruptos o formato no estándar (NO es encoding, la DB ya maneja Ñ/tildes correctamente)

---

## 21. Problemas Conocidos

### Make.com — Escenario 8PM (ID 4501370) — ✅ RESUELTO
- 3 errores iniciales: BundleValidationError (Edge Function no desplegada) + RuntimeError "chat not found" (Chat ID incorrecto)
- **Resuelto:** Últimas 2 ejecuciones exitosas (status=1). Funciona correctamente.

### Make.com — Escenario 11PM (ID 4502189) — ✅ RESUELTO
- BundleValidationError en primera ejecución — corregido parámetros HTTP.
- **Resuelto:** Funciona correctamente. Edge Function `alertas-nocturnas` desplegada y operativa.

### Make.com — QUANTO VENTAS (ID 4485817) — ✅ RESUELTO (reconfigurado)
- Problema original: Angular SPA → HTTP solo obtenía shell HTML.
- **Resuelto:** Reconfigurado para usar RPC `registrar_venta_diaria` vía Supabase. Import histórico completado (132,684 transacciones).

### Make.com — Tickets DTEs (ID 4485872) — ✅ REEMPLAZADO por ID 4504164
- Escenario original inválido (descargaba HTML de /my-orders).
- **Reemplazado:** Nuevo escenario "Gmail → DTEs Compras" (ID 4504164) usa Gmail watch → descargar JSON adjunto → RPC `procesar_dte_json` → dual-write a `compras` + `compras_dte`.
- **Estado:** ✅ ACTIVO y VERIFICADO (24 Mar 2026). isinvalid:false, islinked:true, isActive:true. Backfill: 1053 DTEs en compras_dte (368 con dte_codigo, 685 sin número de control). Filtro subject:"DTE" + hasAttachment:true.

### Make.com — DTEs Gmail (ID 4504164) — Bugs corregidos 24 Mar 2026
- **Bug 1 (OAuth 401):** `islinked:false` después de updates por API. Fix: incluir `metadata.restore.parameters.__IMTCONN__` en blueprint + llamar `scenarios_activate`. Patrón documentado en sección 10.2.
- **Bug 2 (requestContent binario):** `{{2.data}}` enviaba buffer binario a la RPC. Fix: `{{{toString(2.data)}}}` (triple llaves = inject raw) convierte el attachment a texto JSON para el JSONB de Postgres.
- **Bug 3 (hasAttachment:false):** Trigger procesaba todos los correos. Fix: `hasAttachment:true` + `subject:"DTE"` en parámetros del módulo triggerWatchNewEmails.

### Make.com — Serfinsa Validación (ID 4504162) — ✅ ACTIVO
- Escenario para procesar JSONs tipo 09 de Serfinsa: Gmail watch (from:serfinsa) → listAttachments → RPC `procesar_dte_json`.
- Backfill manual de 13 días completado. Hallazgo: QUANTO reporta ~3-4% más que Serfinsa (propinas incluidas en QUANTO pero no en Serfinsa).
- **Estado:** ✅ ACTIVO desde 24 Mar 2026 noche. Blueprint actualizado con Gmail trigger (conexión ID 8008318).

### Gmail OAuth en Make.com — ✅ RESUELTO
- Jose autorizó freakiedogs@gmail.com el 24 Mar 2026.
- Conexión ID: **8008318**, expira 2026-09-20.
- Ambos escenarios (4504162 y 4504164) actualizados con trigger Gmail y activados.

### PWA — Fix de fechas — ✅ RESUELTO
- Fix aplicado: `new Date(Date.now()-6*3600*1000)` en todas las funciones de fecha
- Desplegado en Vercel

---

## 22. Enlaces Rápidos

- **Vercel:** https://vercel.com/freakiedogs-oss-projects/freakie-dogs-caja
- **Supabase:** https://supabase.com/dashboard/project/btboxlwfqcbrdfrlnwln
- **Make.com:** https://www.make.com (scenarios)
- **GitHub:** https://github.com/freakiedogs-oss/freakie-dogs-caja
- **PWA en vivo:** https://freakie-dogs-caja-2wuv39foz-freakiedogs-oss-projects.vercel.app
- **QUANTO admin:** https://admin.quantopos.com/
- **BUHO APP:** https://menu.buhopay.com/

---

## 23. Contactos

- **Jose Isart:** joseisart2008@gmail.com (propietario/dev)
- **Jazmín:** (pendiente actualizar email)

---

## 24. Notas de Desarrollo

- **Idioma de trabajo:** Español
- **Modelo recomendado para sesiones largas:** Claude Opus 4.6
- **Plugin GitHub:** Instalado, token rotado ✅
- **Node.js requerido:** Sí (para MCP de GitHub)
- **Zona horaria:** SIEMPRE UTC-6, cálculos manuales de offset (sin DST)
- **Archivo de contexto:** ESTE es el archivo maestro. No crear versiones nuevas.

---

## 25. Mejoras y Extras Implementados (Sesión 24-Mar-2026)

### 25.1 Tabla `empleados` — Carga Correcta Marzo 2026

101 empleados cargados desde PLANILLA FREAKIE DOG-MARZO 1Q.xlsx con sucursales correctas:

| Sucursal | Empleados | tipo_empleado |
|----------|-----------|---------------|
| Santa Tecla | 19 | sucursal |
| Lourdes (Grand Plaza) | 18 | sucursal |
| Venecia | 15 | sucursal |
| Soyapango | 9 | sucursal |
| Usulután | 6 | sucursal |
| Motoristas | 14 | delivery |
| Internos (moto) | 2 | produccion |
| Casa Matriz producción | 11 | produccion |
| Casa Matriz admin | 7 | admin |
| **TOTAL** | **101** | — |

**Notas de limpieza:**
- DUI de Dina de Jesus Renderos Garcia → NULL (duplicado con Juan Diego Díaz Mirón, DUI `06895790-2`). Verificar con RRHH.
- Columnas LOURDES desplazadas 1 posición izq. vs otras hojas (sin columna A vacía).

**Fix D001:** `quanto_store_mapping` → Driver Thru Lourdes (D001) apunta a `sucursal_id` de Grand Plaza Lourdes (`e712df8e-344c-4fad-94a9-fa06106d0f71`).

### 25.2 Vistas SQL para Dashboard PWA

Migración `crear_vistas_dashboard_erp` aplicada — 6 vistas creadas en Supabase:

| Vista | Propósito |
|-------|-----------|
| `vista_ventas_diarias` | Ventas por sucursal y día desde quanto_transacciones |
| `vista_performance_vs_meta` | Ventas vs metas_ventas con status EXCELENTE/CUMPLIDO/CERCA/BAJO META |
| `vista_top_productos` | Top productos con nombres canónicos via producto_alias |
| `vista_labor_cost_ratio` | % costo laboral sobre ventas por sucursal |
| `vista_patron_semanal` | Promedio ventas por día de semana (últimos 56 días) |
| `vista_reporte_telegram` | Resumen ayer por sucursal con emoji ✅/🟡/🔴 para Telegram |

**Uso:** Las vistas están listas para ser consumidas desde la PWA React. Reemplazar queries directas a `quanto_transacciones` con estas vistas para mejor rendimiento.

**Correcciones de schema descubiertas durante la sesión:**
- `quanto_transacciones`: campo fecha es `fecha` (no `fecha_hora`)
- `quanto_dte_items`: campos son `dte_id` y `descripcion` (no `dte_venta_id` / `nombre_producto`)
- `producto_alias`: campos son `descripcion_original` / `descripcion_canonica` (no `nombre_alias` / `nombre_canonico`)
- `sucursales`: campo es `activa` (no `activo`)

**⚠️ Bug crítico corregido (sesión 2):** `quanto_transacciones.sucursal_id` es siempre NULL — QUANTO solo envía `store_code`. Las vistas joinaban vía `sucursal_id` directo → retornaban vacío. **Fix:** `vista_ventas_diarias` y `vista_labor_cost_ratio` recreadas para joinear vía `quanto_store_mapping.store_code`. Las otras vistas dependientes heredan el fix automáticamente.

**Regla para futuras vistas:** Siempre joinear `quanto_transacciones → quanto_store_mapping ON store_code → sucursales`. NUNCA usar `quanto_transacciones.sucursal_id` directamente (siempre NULL).

### 25.3 Edge Function `reporte-manana` + Escenario Make.com

**Edge Function desplegada:** `reporte-manana` (Supabase, verify_jwt=false)
- Consulta `vista_reporte_telegram`
- Formatea mensaje Markdown con emojis por sucursal + totales + frase motivacional
- Retorna `{ mensaje: "🐶 *FREAKIE DOGS — Reporte Diario*\n..." }`
- URL: `https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/reporte-manana`

**Escenario Make.com creado:** `FD — Reporte Diario Mañana`
- Schedule: 07:30 AM diario (30 min después del sync QUANTO de 7AM)
- Módulo 1: HTTP GET → Edge Function `reporte-manana` con Bearer anon key
- Módulo 2: Telegram SendReplyMessage → chatId `8547715106`, parseMode Markdown
- Misma conexión Telegram (ID 7974210) que los otros escenarios de alertas

**Escenarios Make.com activos (resumen completo):**

| ID | Nombre | Schedule | Estado |
|----|--------|----------|--------|
| 4485817 | FD — QUANTO → Ventas Diarias + Propinas | 07:00 | ✅ Activo |
| 4504370 | FD — Reporte Diario Mañana | 07:30 | ✅ Activo |
| 4501370 | FD — Alertas Cierres Nocturnos | 20:00 | ✅ Activo |
| 4502189 | FD — Alertas Cierres 11PM | 23:00 | ✅ Activo |
| 4504164 | FD — DTEs Gmail → Compras | cada 60min | ✅ Activo |
| 4504162 | FD — Serfinsa → Validación Tarjetas | 11:00 | ✅ Activo |

### 25.4 Análisis Royal Truffle — Producto en Crecimiento

**Hallazgo clave:** Royal Truffle NO es producto en riesgo — está en fase de crecimiento acelerado.

| Mes | Unidades | Crecimiento |
|-----|----------|-------------|
| Jun 2025 | 6 | base |
| Sep 2025 | 58 | 9.7x |
| Dic 2025 | 201 | 33.5x |
| Mar 2026 | 387 | 64.5x |

- **Ticket promedio Royal Truffle:** $22.87 (vs Burger Duo $18.86 → +21% premium)
- **Participación actual:** 7.3% del volumen de Burger Duo
- **Día pico para upsell:** Sábado (ticket promedio más alto $20.61)

**Estrategia recomendada:**
1. Capacitar staff en upsell activo Royal Truffle → Burger Duo
2. Medir conversión semanal (meta: 10% → 15% del volumen de Burger Duo en 90 días)
3. Push de fin de semana (Sábado/Domingo) — mayor ticket promedio
4. Considerar combo "upgrade" (+$4) en lugar de pedir dos productos separados
5. Seguimiento mensual en este documento

### 25.5 Pendientes Finales

1. **DUI Dina Renderos** — Verificar con RRHH (NULL en BD). id `e2a0ea01-9666-4e66-841c-5c00cdbc4e95`. SQL: `UPDATE empleados SET dui='XX-YYYYYY-Z' WHERE id='e2a0ea01-9666-4e66-841c-5c00cdbc4e95';`
2. **Gmail OAuth Make.com** ✅ ACTIVO — Conexión ID 8008318 (freakiedogs@gmail.com, expira Sep 2026). Escenarios 4504162 (Serfinsa) y 4504164 (DTEs) activos y funcionando desde 24-Mar-2026 noche.
3. **4 sucursales sin store_code QUANTO** — Metro Centro, Plaza Integración, Plaza Olímpica, Driver Thru Lourdes — pendiente apertura oficial
4. **PWA Dashboard** ✅ DESPLEGADO — `DashboardVentas` en producción. Ver sección 25.6.
5. **Escenario obsoleto** — Eliminar "Tickets DTEs JSON" (ID 4485872, inválido)

---

## 26. Sesión 24-Mar-2026 (continuación) — DashboardVentas + RLS

### 26.1 Componente DashboardVentas — Acceso por Rol

Componente agregado a `vercel-deploy/index.html` y desplegado en Vercel.

**Acceso:**
- `admin` → ve todas las sucursales en todos los tabs
- `gerente` → ve solo su sucursal (filtro por `store_code` → `quanto_store_mapping` → `sucursal_id`)
- `cocina` → sin acceso al botón

**Lógica de filtro para gerente:**
1. Al abrir, resuelve su `sucursal_id` consultando `quanto_store_mapping` con su `store_code`
2. Filtra `vista_performance_vs_meta` y `vista_ventas_diarias` por `sucursal_id`
3. Nómina filtrada client-side por nombre de sucursal
4. Patrón semanal: computado desde sus tendencias propias (no usa `vista_patron_semanal`)
5. Productos: global (no tiene columna de sucursal en la vista)

**5 tabs:**
| Tab | Vista usada | Qué muestra |
|-----|------------|-------------|
| 📊 Hoy | `vista_performance_vs_meta` | Ventas vs meta con semáforo por sucursal |
| 📈 14 días | `vista_ventas_diarias` | Barras de tendencia diaria |
| 🍔 Productos | `vista_top_productos` | Top 20 por revenue (global) |
| 📅 Semanal | `vista_patron_semanal` / calculado | Promedio por día de semana |
| 💰 Nómina | `vista_labor_cost_ratio` | % nómina/ventas por sucursal |

### 26.2 Fix RLS — Acceso `anon` a Tablas de Analytics

**Problema:** Las tablas base de las vistas tenían políticas RLS solo para `authenticated`. La PWA usa `anon` key (login custom, no Supabase Auth), igual que todas las otras tablas operativas.

**Solución aplicada:** Políticas `anon` SELECT + GRANT en vistas.

```sql
-- Políticas anon_read agregadas a:
quanto_transacciones, quanto_store_mapping, sucursales,
metas_ventas, empleados, quanto_dte_items, quanto_dte_ventas

-- GRANT SELECT TO anon en:
vista_ventas_diarias, vista_performance_vs_meta, vista_top_productos,
vista_patron_semanal, vista_labor_cost_ratio, vista_reporte_telegram
```

**Regla arquitectural:** En este proyecto el acceso a datos se controla a nivel de app (login custom en `usuarios_erp`), no a nivel de Supabase Auth. Todas las tablas operativas usan `POLICY ... TO anon USING (true)`. Aplicar el mismo patrón a cualquier tabla nueva que deba ser accesible desde la PWA.

### 26.3 Estado Final de Vistas SQL

| Vista | Estado | Usado en |
|-------|--------|----------|
| `vista_ventas_diarias` | ✅ Activa (fix store_code) | DashboardVentas, vista_patron_semanal, vista_performance_vs_meta, vista_reporte_telegram |
| `vista_performance_vs_meta` | ✅ Activa | Tab "Hoy" del dashboard |
| `vista_top_productos` | ✅ Activa | Tab "Productos" |
| `vista_patron_semanal` | ✅ Activa | Tab "Semanal" (admin) |
| `vista_labor_cost_ratio` | ✅ Activa (fix store_code) | Tab "Nómina" |
| `vista_reporte_telegram` | ✅ Activa | Edge Function `reporte-manana` → Telegram 7:30 AM |
