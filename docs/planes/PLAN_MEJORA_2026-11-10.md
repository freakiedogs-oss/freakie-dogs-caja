# Plan de mejora — auditoría integral 10-Nov-2026

Auditoría de solo lectura del repo `freakie-dogs-caja`, de la base `freakie-dogs-erp` (Freakie Dogs + Kaeru + Kako + KWA + `pf_common`) y, por encima, del proyecto `eatalia-scanzano-erp`. No se cambió nada en producción.

**Cómo leer esto:** cada hallazgo tiene un ID, evidencia (`archivo:línea` o dato de la base), y esfuerzo S (horas), M (días), L (semanas). "Verificado en BD" significa que lo comprobé contra la base en vivo; "sin confirmar" significa que sale del código y falta comprobarlo.

## 1. Diagnóstico en una página

El producto está muy avanzado y lo construido con cuidado se nota (pagos en línea, kardex por RPC, porcionador, pruebas de n1co, bitácora del porqué en `memoria.md`). El riesgo no está en las funciones sino en cuatro cimientos:

1. **La base confía en el navegador.** Toda la app corre con la llave `anon` (pública, va en el bundle). 392 políticas RLS son `USING (true)` para `anon` y 564 funciones `SECURITY DEFINER` son ejecutables sin sesión. El control de rol es un `if` en React. Quien tenga la llave puede escribir en cuentas del POS, pagos, bancos, inventario y turnos.
2. **El PIN de 4 dígitos es la única credencial y hay tres puertas para adivinarlo** sin límite de intentos (`dte-proxy`, `dte-email`, `peya-responder`). Un PIN válido permite emitir o invalidar documentos fiscales reales.
3. **El dinero se mueve en varios pasos sueltos desde el cliente**, sin transacción ni llave de idempotencia (cobro en caja, pago web, recepciones, pagos a proveedor).
4. **No hay red de seguridad de ingeniería:** sin staging, sin build ni tests en CI, sin monitoreo de errores, y el repo no puede reconstruir la base (faltan ~170 tablas, ~260 RPC y el `dte-service`).

### Cifras verificadas en la base (10-Nov)

| Dato | Valor |
|---|---|
| Tamaño BD / tablas `public` / funciones `public` | 2.8 GB / 354 / 803 (645 `SECURITY DEFINER`) |
| Políticas `USING(true)` para `anon` | 392 de 1,102 |
| Tablas `public` sin RLS | 29 (12 son respaldos `bak_*`; incluye `planilla_validacion`, `peya_ordenes_raw`, `dte_json_staging`, `_sr_pw_handoff`) |
| Funciones ejecutables por `anon` (ejemplos) | `pos_anular_cuenta`, `pos_anular_item`, `driver_marcar_entregado`, `mis_pedidos_driver`, `fn_equipo_pin_ver`, `guardar_cobertura_sucursal`, `calcular_bonos_delivery_mes`, `bancoview_devengar_intereses_socios`, `fn_banco_autoclasificar` |
| PINs | 157 de 161 usuarios tienen PIN de 4 dígitos, guardados en claro |
| Buckets públicos con documentos | `bank-estados-cuenta`, `bank-comprobantes`, `pagos-comprobantes`, `kaeru-comprobantes`, `kako-comprobantes`, `cierres-fotos`; `anon` puede borrar y sobrescribir en bancos |
| POS 30 días | 21,529 cuentas cobradas, $300,957 |
| Pagos duplicados / cuentas sobrepagadas (30 d) | 1 / 6 ($34.75): el doble cobro en caja hoy es raro, pero no hay nada en la base que lo impida |
| Cuentas cobradas sin pago / turnos abiertos dobles | 0 / 0 |
| Cuentas cobradas sin DTE (30 d) | 5,325 ($68,928): 4,501 PedidosYa, **788 delivery propio**, 13 Hifumi, 16 para llevar, 7 mesa |
| Diferencia de efectivo en cierres (30 d) | 143 de 217 turnos con más de $20; suma absoluta $22,393 |
| Pagos en línea | 1,656 aprobados, 256 rechazados, **220 en `requiere_3ds`**, 32 en `iniciado`, 15 error |
| Inventario con stock negativo | 632 de 2,243 filas |
| Cron | 64 activos; 2 fallan siempre: `refresh_mv_vista_top_productos` (falta índice único) y `pos-cocina-queue-archivar` (columnas no coinciden) |
| Índices únicos en `pos_cuenta_pagos` / `pos_turnos` | Solo la llave primaria |

Tres de estas cifras necesitan una respuesta de negocio antes de actuar: si los 788 pedidos de delivery propio sin DTE deberían tenerlo, qué explica las diferencias de efectivo, y si los 220 `requiere_3ds` son abandonos normales o cobros que fallan (ver D-5).

## 2. Plan de acción por fases

### Fase 0 — Esta semana (contención, casi todo S)

| # | Acción | Hallazgos |
|---|---|---|
| 0.1 | Cerrar el oráculo de PIN: límite de intentos por IP y respuesta 401 genérica en `api/dte-proxy.js`, `api/dte-email.js` y `peya-responder`. Toca el camino del DTE: requiere tu visto bueno | S-1, S-2 |
| 0.2 | Rotar los PINs que están escritos en los docs y borrarlos de MAESTRO, CHANGELOG, ONBOARDING y `docs/cowork/` | S-6 |
| 0.3 | Corregir el salto de ruta en `api/supaproxy.js` (normalizar la URL antes del gate de finanzas) | S-4 |
| 0.4 | Quitar `public/dashboard-ejecutivo.html` y `dashboard-operativo.html` del dominio | S-8 |
| 0.5 | POS: no mostrar "Pago confirmado" si `saveCuenta` no devolvió cuenta; impedir que comandar reviva una cuenta cobrada; revisar el error al escribir la cola de cocina | P-1, P-4, P-6 |
| 0.6 | POS: "Liberar mesa" con PIN de gerente y motivo, cancelando en vez de marcar cobrada | P-2 |
| 0.7 | Arreglar los 2 cron rotos | B-1 |
| 0.8 | Activar RLS en las 29 tablas sin RLS y borrar los 12 respaldos `bak_*` (tras confirmar que ya no se usan) | S-9 |
| 0.9 | CI: `npm ci && npm run build` + los 4 tests offline como check obligatorio en `main` | E-2 |
| 0.10 | `npm audit fix` y quitar dependencias sin uso (`react-router-dom`, `lucide-react`, 3 de `@radix-ui`) | E-5 |
| 0.11 | Recepción con orden de compra: agregar `producto_id` al select (hoy esos ítems no entran al stock) | I-1 |
| 0.12 | Finanzas: quitar o rotular como estimación la pestaña Balance; corregir la llave `x.mes` en ventas por canal; mostrar error cuando una fuente del P&L falla | F-1, F-3, F-2 |
| 0.13 | Pago web: persistir `customer_id` para el 3DS y agregar un cron que alerte de pagos colgados | D-5, D-3 |

### Fase 1 — Próximas 2 a 4 semanas (el dinero, M)

| # | Acción | Hallazgos |
|---|---|---|
| 1.1 | RPC única y transaccional `pos_cobrar_cuenta(p_cobro_uid, …)` con índice único sobre el uid y totales recalculados en servidor | P-3 |
| 1.2 | Idempotencia en `crear-y-pagar` del menú web y sacar la emisión del DTE del request (cola) | D-2, D-4 |
| 1.3 | App de motoristas: exigir el token de sesión en todas las RPC `driver_*` | D-1 |
| 1.4 | "Mis pedidos" atado a un secreto del dispositivo, no al teléfono; ocultar dirección en tracking tras la entrega | D-6 |
| 1.5 | Captcha y límite por IP en el pedido web | D-7 |
| 1.6 | Bandeja "cobradas sin DTE" con reintento, y llave de idempotencia hacia `dte-service` (requiere tu visto bueno) | P-5 |
| 1.7 | Cierre de turno: bloquear hasta tener el corte, recalcular al confirmar, listar cuentas abiertas, índice único de turno abierto | P-7 |
| 1.8 | Recepción, confirmación, devolución y pagos a proveedor como RPC atómicas con guarda de estado | I-2, F-6 |
| 1.9 | Monitoreo de errores del front (Sentry o tabla `errores_cliente`) con sucursal, usuario y versión | E-4 |
| 1.10 | Pasar a privados los buckets de bancos y comprobantes, con URL firmada | S-10 |
| 1.11 | Volcar al repo el esquema completo y todas las Edge Functions, incluida `dte-service` | E-1 |

### Fase 2 — 30 a 90 días (cimientos, L)

| # | Acción | Hallazgos |
|---|---|---|
| 2.1 | **Sesión real en servidor**: cada RPC recibe el token de `staff_sesiones` y deriva usuario y rol; revocar escritura a `anon` tabla por tabla, empezando por `pos_*`, `bank_*`, `pagos_*`, `compras_*`, `inventario*`, `egresos_cierre`. El patrón ya existe en la torre de delivery | S-3 |
| 2.2 | PINs con hash, 6 dígitos para roles altos, reseteo en vez de "ver PIN", límite por dispositivo en vez de global | S-5, S-7 |
| 2.3 | Un solo P&L (`fn_pl_mensual`) consumido por las tres pantallas | F-4 |
| 2.4 | Paginación correcta y agregación en SQL en las consultas que se cortan a 1000 filas | F-5 |
| 2.5 | Staging: rama de Supabase o proyecto aparte para los previews de Vercel | E-3 |
| 2.6 | Pruebas automáticas de lógica de dinero (totales, IVA, propina, cierre) y un recorrido login → cobro → cierre | E-6 |
| 2.7 | Aislamiento multiempresa: revisar las 90 políticas `USING(true)` para `anon` en `pf_common`, `kaeru`, `kako`, `kwa` | S-11 |
| 2.8 | Libros fiscales (ventas, compras, F-14) revisados con el contador antes de usarlos para declarar | F-7 |
| 2.9 | Inventario: conversión de unidades en recepción, conteo físico por delta, alerta de stock negativo | I-3, I-4 |
| 2.10 | Documentación: MAESTRO reducido a un índice generado desde la base; `memoria.md` partido por mes | E-8 |
| 2.11 | APK de motoristas firmada en release, fuera del repo, con aviso de actualización | E-7 |
| 2.12 | POS: operación con red inestable (cola local) y dinero en centavos enteros | P-9, P-8 |

## 3. Hallazgos por área

### Seguridad y acceso

- **S-1 Crítico — `dte-proxy` y `dte-email` permiten adivinar PINs.** `api/dte-proxy.js:76-96,151-176`, `api/dte-email.js:63-78`. Validan con `service_role` sin pasar por el limitador de `erp_login`, con CORS `*`, y responden distinto para PIN inválido (401) y rol no permitido (403, que además devuelve el rol). Los 10,000 PINs de 4 dígitos se recorren en minutos. M.
- **S-2 Alto — `peya-responder` hace lo mismo.** `supabase/functions/peya-responder/index.ts:219-259`. S-M.
- **S-3 Crítico — las RPC y las tablas confían en el cliente.** Verificado en BD. `pos_anular_cuenta` y `pos_anular_item` no validan usuario alguno (`20260921_merma_producto_preparado.sql:237-407`); decenas de RPC autorizan según un `p_usuario_id` que nadie autentica; `anon` tiene `ALL` sobre `pos_cuentas`, `pos_cuenta_pagos`, `pos_turnos`, `bank_cuentas`, `bank_comprobantes`, `inventario`, `recetas`, `egresos_cierre`, entre otras. El equipo ya lo tenía anotado (`memoria.md:2985-3030`). L.
- **S-4 Alto — salto de ruta en el gate de finanzas.** `api/supaproxy.js:120-123,207,233-246`. `_p=rest/v1/v_dtes_emitidos/../planilla_detalle` pasa el gate y lee planilla con el token de finanzas. Requiere una sesión de un rol gateado (eventos, rrhh). S.
- **S-5 Alto — bloqueo global de login.** 25 fallos en 10 minutos, contados para todos, dejan sin entrar a las 6 sucursales; y aun así permite unos 3,600 intentos al día. `20261003_prep_funciones.sql:18-20`. M.
- **S-6 Alto — PINs reales en documentos versionados.** MAESTRO (22 líneas), CHANGELOG (10), `ONBOARDING_CESAR.md`, `docs/cowork/FLUJO_SESION_PIN.md`, `docs/cowork/AUDITORIA_QA_BUGS.md`. Incluyen roles ejecutivo y RRHH. S.
- **S-7 Alto — PINs en claro y reversibles.** Verificado en BD. `fn_equipo_pin_ver` los devuelve y es ejecutable por `anon`; el POS guarda el PIN en `sessionStorage` y lo reenvía en cada request de DTE (`src/pos/cajero/dteService.js:27-47`). L.
- **S-8 Alto — tableros públicos sin login** en `public/dashboard-ejecutivo.html` y `dashboard-operativo.html` (ventas, empleados, asistencia). S.
- **S-9 Alto — 29 tablas sin RLS**, verificado en BD. S.
- **S-10 Alto — buckets públicos y editables por `anon`** con estados de cuenta y comprobantes, verificado en BD. `/foto` sube sin login con `upsert` (`src/foto/foto-main.jsx:20-23`). M.
- **S-11 Medio — multiempresa (corregido en `PLAN_EJECUCION_2026-11-10.md`: `pf_common` no está expuesto por la API; el riesgo real está en `kaeru` y `kako`).** 90 tablas de `pf_common`, `kaeru`, `kako` y `kwa` con lectura `USING(true)` para `anon` (facturas, bancos, socios, cuentas contables). Falta comprobar si esos esquemas están expuestos por la API; si lo están, el aislamiento entre empresas no existe para lectura. M.
- **S-12 Medio — otros.** Sin cabeceras de seguridad en `vercel.json` (CSP, `frame-ancestors`, `Referrer-Policy`; los tokens viajan en la URL de `/track` y `/foto`). `X-DTE-Origen` lo controla el cliente (`api/dte-proxy.js:168`). El puente de impresión Windows acepta cualquier origen y reenvía a cualquier IP de la red local (`freakie-print-bridge.ps1:87-125`). `proxy_dgii.py` arranca sin autenticación y sin verificar TLS: borrarlo si es legado.

### POS, caja y KDS

- **P-1 Crítico — "¡Pago confirmado!" sin cobro registrado.** `POSMain.jsx:1147,1174`, `PaymentModal.jsx:180-184`. Si no hay turno abierto, `saveCuenta` sale sin valor y el modal confirma igual: no queda cuenta, pago, DTE ni comanda. S.
- **P-2 Crítico — "Liberar mesa" marca cobrada sin pago, PIN ni DTE.** `POSHome.jsx:240-249`. El corte cuadra porque sale de los pagos. S-M.
- **P-3 Crítico — cobro en 6 a 8 llamadas sueltas, con reintento de pago no idempotente.** `POSMain.jsx:1183-1336`. La base no tiene índice único que lo frene (verificado). En los últimos 30 días hubo 1 duplicado y 6 sobrepagos: hoy es raro, pero depende solo de candados en el cliente. L.
- **P-4 Crítico — comandar revive una cuenta ya cobrada** y el recobro es por el total completo, con segundo DTE. `POSMain.jsx:1057-1060`. S.
- **P-5 Alto — DTE huérfano o venta sin DTE sin bandeja de reintento.** `POSMain.jsx:1352-1376`, `api/dte-proxy.js:54`. Sin llave de idempotencia; si el proxy corta a los 30 s el documento puede existir en Hacienda sin vínculo. Solo análisis; no se toca sin tu visto bueno. M-L.
- **P-6 Alto — la cola de cocina se escribe sin revisar error.** `POSMain.jsx:1093-1096,1295-1297`. En sucursales sin comanda impresa el pedido no llega a cocina. S.
- **P-7 Alto — el cierre puede guardarse con ventas en $0** si `pos_corte` no cargó, no recalcula al confirmar y no avisa de cuentas abiertas. `CierreTurno.jsx:330-334,535-609`. S-M.
- **P-8 Medio — dinero en decimales.** 14.99 + 1.50 da 16.490000000000002 y el botón de monto exacto deja Confirmar deshabilitado. `PaymentModal.jsx:113-124`. S-M.
- **P-9 Medio — sin modo offline.** Si la tablet recarga, el carrito no comandado se pierde. L.
- **P-10 Medio — otros.** El KDS se vacía y dice "cocina al día" ante un error de red (`KDSScreen.jsx:315-333`). La devolución ignora el descuento original (`DevolucionModal.jsx:72-115`). "Anular DTE" deja la venta sumando en el corte (`HistorialCobros.jsx:350-362`). `CierreForm` borra y reinserta sin transacción y siempre muestra éxito (`CierreForm.jsx:722-790`). Impresión `rawbt` siempre devuelve éxito. Descuentos, cortesías y precios se validan solo en el cliente. Historial muestra horas en UTC.

### Menú web, pagos y delivery

- **D-1 Crítico — la app de motoristas no autentica las acciones.** Verificado en BD: `driver_marcar_entregado` y `mis_pedidos_driver` son ejecutables por `anon` y solo piden el UUID del empleado, que es legible. Exponen nombre, teléfono y dirección de clientes en ruta, y permiten marcar entregas. M.
- **D-2 Crítico — `crear-y-pagar` sin idempotencia.** `api/n1co.js:596-738`. Un solo request crea el pedido, tokeniza, cobra y emite el DTE; si la respuesta se pierde, el reintento crea pedido y cargo nuevos. M.
- **D-3 Alto — cobro capturado sin pedido visible.** Si la función muere entre el cargo y el resolver, queda `pendiente_pago` con la tarjeta cobrada; no hay barrido ni botón de reembolso. Hay 32 pagos en `iniciado` y 220 en `requiere_3ds` (verificado). M.
- **D-4 Medio — los pagos resueltos por webhook o link no emiten DTE.** `api/n1co-link.js:154-230`. Probablemente explica parte de los 788 pedidos de delivery propio sin DTE. Requiere tu visto bueno. M.
- **D-5 Medio — 3DS con identificador de cliente distinto al de la tokenización.** `api/n1co.js:668-670` frente a `:963-965`. Sin confirmar el efecto, pero los 220 `requiere_3ds` son consistentes con que esos cobros fallen. S.
- **D-6 Alto — teléfono → dirección de casa.** `mis_pedidos_delivery(p_telefono)` es anónima y devuelve el token de tracking, que entrega dirección y coordenadas exactas, sin vencimiento. M.
- **D-7 Alto — freno anti-abuso evadible.** Tope por teléfono (que elige el atacante), sin captcha ni límite por IP; sirve para probar tarjetas robadas o inundar la torre. `api/n1co.js:605-609,1259-1273`. M.
- **D-8 Medio — otros.** `driver_marcar_entregado` no exige estado `en_camino` ni cercanía (la distancia se mide solo en la app). Se puede pagar con tarjeta fuera de horario o de cobertura, sin reembolso automático. PedidosYa: si falla la aceptación automática solo queda un log, y se guarda el payload antes de autenticar. `guardar_cobertura_sucursal` y `calcular_bonos_delivery_mes` son ejecutables por `anon` (verificado). El menú carga un favicon de 377 KB y hace 6 a 7 llamadas al abrir.

### Finanzas

- **F-1 Crítico — la pestaña Balance es inventada.** `FinanzasDashboard.jsx:1646-1672`: caja = ventas × 0.38, préstamos fijos en 454,000, capital fijo en 100,000. Las vistas reales ya existen (`v_bank_saldos_consolidados`, `v_cuentas_por_pagar`, `v_prestamos_estado`, `v_socios_balance`). M.
- **F-2 Alto — el P&L puede salir parcial sin avisar** si falla una de sus 18 fuentes. `FinanzasDashboard.jsx:280-303,476-478`. S.
- **F-3 Medio — ventas por canal busca una llave que no existe** (`x.mes` en vez de `key`), así que los porcentajes salen mal. `FinanzasDashboard.jsx:846`. S.
- **F-4 Alto — tres P&L con reglas distintas** (`FinanzasDashboard`, `RentabilidadView`, `KpiVentasTotalesDashboard`): IVA, eventos, PedidosYa y planilla se tratan diferente, así que el mismo mes no cuadra entre pantallas. L.
- **F-5 Alto — consultas que se cortan a 1000 filas:** `FinanzasGastosView.jsx:107-121`, `KardexView.jsx:567-572` (además corta el día a las 6 pm), `InventarioDashboard.jsx:283-285`, `PagosProveedorView.jsx:1048-1051`, `DespachoKpiDashboard.jsx:119-122`. Y paginación sin orden único en `FinanzasDashboard.jsx:339-391` y `reportesContabilidad.js:137-143`. S cada una.
- **F-6 Alto — operaciones de varios pasos sin transacción.** `PagosProveedorView.jsx:229-314`: si falla el tercer comprobante, reintentar duplica los dos primeros. `BancoView.jsx:411-462` no lee errores. M.
- **F-7 Alto — libros fiscales incompletos.** `src/lib/reportesContabilidad.js`: ventas solo del POS propio, notas de crédito sumadas en positivo, sin percepción del 1%, anexo CCF sin NIT/NRC. M, con el contador.
- **F-8 Medio — otros.** Unas 69 fechas calculadas en UTC en vez de UTC-6 (después de las 6 pm se registran con fecha de mañana: intereses de socios, pagos, asistencia). Valores fijos vencidos: `PlanillaSucursalView.jsx:225` solo ofrece agosto y septiembre 2026, asuetos solo de 2026, comisiones 3% / 2.5% / 27.5% fijas. Botón "Calcular" de planilla llama a una función deshabilitada. Aprobación de planilla valida el PIN en el navegador y registra al usuario de la sesión, no al dueño del PIN (`PlanillaView.jsx:283-292`). Propinas: la suma asignada no iguala el monto a distribuir. Tablas de renta y recargos de planilla: no están en el repo, verificar con el contador.

### Inventario y producción

- **I-1 Alto — las recepciones precargadas desde una orden de compra no entran al stock.** `RecepcionTab.jsx:160-166`: falta `producto_id` en el select y aun así muestra "inventario actualizado". S.
- **I-2 Alto — recepción, confirmación y devolución no son atómicas.** `RecepcionTab.jsx:239-285,478-530`, `DevolucionesView.jsx:147-195`. Ya triplicó un kardex antes. M.
- **I-3 Alto — sin conversión de unidades en recepción** (caja contra unidad). `RecepcionTab.jsx:270-271,404`. Sin confirmar si el RPC convierte. M.
- **I-4 Medio — el inventario físico pisa movimientos** ocurridos durante el conteo (`InventarioFisico.jsx:286-294`), y hay 632 filas con stock negativo sin alerta.

### Base de datos y automatizaciones

- **B-1 Alto — 2 cron fallan en cada corrida** (ver tabla). El archivado de la cola de cocina no corre, y esa tabla ya pesa 172 MB. S.
- **B-2 Medio — crecimiento.** `quanto_ordenes` 511 MB, `dte_import_errors` 362 MB con 140 mil filas de errores, `driver_recorrido` 180 MB con 878 mil puntos GPS sin política de retención. M.
- **B-3 Medio — 366 funciones sin `search_path` fijo, 22 vistas `SECURITY DEFINER`, 5 vistas materializadas legibles por `anon`.** M.
- **B-4 Medio — 1,468 migraciones aplicadas en la base contra 76 en el repo.** Ver E-1.

### Ingeniería

- **E-1 Crítico — el repo no puede reconstruir la base ni el backend fiscal.** Faltan unas 172 tablas o vistas, 264 RPC y 3 de las 7 Edge Functions que usa el código, incluida `dte-service`. M.
- **E-2 Crítico — nada se verifica antes de producción.** El único workflow web cuenta líneas; `main` no exige checks; los PR se fusionan en 1 a 2 minutos. S.
- **E-3 Crítico — sin staging.** Un solo proyecto Supabase; los previews de Vercel pegan a datos reales. M-L.
- **E-4 Alto — sin monitoreo.** 140 `catch {}` vacíos, sin Sentry, y los sourcemaps (17 MB) quedan públicos. S-M.
- **E-5 Alto — 6 vulnerabilidades en dependencias** (1 crítica en `dompurify`, 2 altas en `ws` y `xlsx`). Cinco se arreglan con `npm audit fix`; `xlsx` necesita cambiar de fuente o de librería. S.
- **E-6 Alto — sin pruebas en los flujos de dinero.** Existen 12 scripts sueltos de buena calidad (4 corren offline y pasan), ninguno en CI. Cobro, cierre, KDS, DTE, planilla y P&L no tienen ninguna. M.
- **E-7 Alto — la APK de motoristas es un build debug** servido desde el repo; cada compilación cambia de firma y no instala sobre la anterior. M.
- **E-8 Medio — documentación desactualizada.** El MAESTRO se declara única fuente de verdad pero su cabecera es de abril, dice 39 a 44 tablas (hay 354) y no describe el POS propio, n1co ni PedidosYa. `memoria.md` pesa 650 KB. M.
- **E-9 Medio — otros.** Migraciones con prefijo de solo fecha y sufijos de letra (orden no reproducible). El candado de versión solo actúa en el login: una tablet que nunca cierra sesión sigue con el build viejo, y `pos.html` no registra service worker. Carga inicial del POS de 244 KB gzip. 630 líneas de código muerto confirmado. `_backup/`, `_archive/`, PDFs y binarios versionados.

### Eatalia Scanzano (segundo proyecto, solo asesor de seguridad)

Mismo patrón, a menor escala: 176 funciones `SECURITY DEFINER` ejecutables por `anon` (incluye anulación de cuentas), 13 vistas `SECURITY DEFINER`, 2 tablas sin RLS (`devops_log`, `soporte_kb`), 56 funciones sin `search_path`. Lo que se resuelva en 2.1 conviene aplicarlo ahí con el mismo molde. No revisé su código ni sus datos.

## 4. Lo que está bien y conviene conservar

- Pago en línea: el monto sale de la base y nunca del navegador; no se guardan tarjetas ni CVV; webhook con firma HMAC; tablas de pago cerradas a `anon`.
- Kardex por RPC transaccional con fila bloqueada; porcionador con idempotencia y cola offline; pesaje y etiquetado 100% por RPC.
- Torre de delivery con sesión real en servidor (`staff_sesiones`): es el molde para la fase 2.1.
- PedidosYa: firma verificada, idempotencia por token, respuesta antes de cocinar.
- POS: comanda idempotente, candados contra doble toque, cierre con reintento local, zona horaria correcta en los helpers.
- Build rápido con carga diferida por pantalla; service worker que nunca cachea datos.
- Sin secretos reales en el repo (ni `service_role`, ni certificados, ni keystores).
- Comentarios y `memoria.md` explican el porqué con fecha e incidente.

## 5. Límites de esta auditoría

- **Notion** no estaba autorizado en la sesión: no revisé Roadmap, Pendientes ni el tablero EN_PROGRESO.
- **Make.com**, logs de **Vercel** y logs de Supabase: no revisados.
- **`dte-service`** y las otras Edge Functions que no están en el repo: no auditadas.
- **Kaeru, Kako, KWA y `pf_common`**: solo permisos y cron, no su lógica ni sus datos.
- **Eatalia**: solo el asesor de seguridad.
- Lo marcado "sin confirmar" sale de leer código y falta probarlo en vivo.
