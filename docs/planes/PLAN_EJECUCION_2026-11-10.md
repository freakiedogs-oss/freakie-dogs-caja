# Plan de ejecución — Freakie Dogs y empresas hermanas (10-Nov-2026)

Este documento es para ejecutar. Complementa a `PLAN_MEJORA_2026-11-10.md`, que es el catálogo de hallazgos (los IDs `S-`, `P-`, `D-`, `F-`, `I-`, `B-`, `E-` se refieren a ese archivo). Aquí están: lo nuevo que salió de terminar la revisión, el análisis de datos del negocio, y los paquetes de trabajo en orden, cada uno con pasos, criterio de terminado y modelo recomendado.

Todo lo que sigue se obtuvo en solo lectura. No se cambió nada en producción.

## 1. Qué cambió respecto al primer informe

La segunda pasada cubrió lo que faltaba: las 54 Edge Functions desplegadas (incluida `dte-service`), Make.com, Vercel, los logs de 24 horas, las otras empresas del proyecto y Eatalia a fondo. Lo más importante:

| # | Hallazgo nuevo | Evidencia |
|---|---|---|
| N-1 | **Clave `service_role` en texto plano en Make.com** (2 escenarios, 1 activo). El valor pasó además por la salida de las herramientas de esta sesión. Hay que rotarla | Escenarios 4485817 y 4512847 |
| N-2 | **`bulk-sql-kaeru` ejecuta SQL arbitrario como `postgres`** detrás de un secreto fijo escrito en el código. Da acceso a toda la base, incluidas las llaves de firma fiscal | Edge Function, líneas 4 y 26 |
| N-3 | **`dte-service` acepta cualquier API key para consultar.** La función de validación devuelve `{}` cuando la llave no existe y el código lo toma como válido. Con el código de generación impreso en cualquier factura se lee el documento completo de cualquier empresa. La emisión sí falla más adelante | `lib/auth.ts` línea 11 |
| N-4 | **KWA no tiene ningún DTE válido desde el 4-Nov.** 16 de 16 ventas sin sello, 17,762 rechazos "Firma no válida". Kaeru y Kako reintentan las mismas 3 y 1 ventas cada 5 minutos desde agosto. Los tres bucles suman unos 5,400 rechazos al día ante Hacienda, cada uno con número de control nuevo | `dte_service.documents`, cron `*-dte-retry` |
| N-5 | **`ai-gateway` y `ai-query` exponen consultas SQL con privilegios altos sin autenticación.** Sin usar el modelo, `ai-query` ya devuelve saldos bancarios, planilla y cuentas por pagar a cualquiera | Edge Functions |
| N-6 | **`kaeru-pin-setup` y `kako-pin-setup` cambian la contraseña de cualquier usuario** con un secreto que está en el bundle del frontend. Los 37 usuarios de Auth son compartidos entre empresas | Edge Functions, línea 6 |
| N-7 | **Casi ningún pedido web pagado con tarjeta tiene DTE:** 787 de 793 en 30 días, $13,398. Vercel registra 170 avisos "DTE no emitido: sin_cuenta" en 7 días en `/api/n1co/confirmar-3ds`: el DTE se intenta antes de que exista la cuenta del POS | BD + logs de Vercel |
| N-8 | **Solo 22% de los cobros con 3DS se completan:** de 109 pedidos que pidieron 3DS, 24 se aprobaron y 85 nunca | `pagos_online` |
| N-9 | **La bitácora de operaciones del POS está vacía** (0 filas en toda su historia) y el log de auditoría del proxy DTE falla en cada intento (435 errores 403 al día por un permiso de secuencia) | `pos_operaciones_log`, `pos_dte_proxy_log` |
| N-10 | **Sin idempotencia en `dte-service`:** transmite a Hacienda antes de guardar; si la respuesta se pierde, el reintento emite otra factura. El número de control sale del reloj (milisegundos), no de un correlativo; la tabla `consecutivos` existe y no se usa | `emit-factura`, `dte-core.ts` |
| N-11 | **Credenciales fiscales en claro:** la llave privada de firma está en PEM plano en una columna llamada `private_key_encrypted`; la contraseña de Hacienda también. Hoy solo las protege que no haya permisos otorgados | `dte_service` |
| N-12 | **`compras-hq-sync` envía la `service_role` de este proyecto a otro proyecto** en una cabecera | Edge Function, ~línea 41 |
| N-13 | **50 de 54 Edge Functions no están en el repo**; 12 escriben compras, ventas o metas sin ninguna autenticación | Listado |
| N-14 | **Kaeru y Kako: ~60 funciones privilegiadas por esquema ejecutables sin sesión** (banco, planilla, pagos a proveedor) y todas sus vistas saltan RLS; un usuario de una empresa lee el P&L y la planilla de otra. KWA ya está endurecido y es el molde | Esquemas `kaeru`, `kako` |
| N-15 | **Eatalia: toma de cuentas con PIN de 4 dígitos.** Una función anónima devuelve el correo a partir del PIN, y la contraseña de Auth es el PIN más un sufijo fijo visible en el código. Además, 84 funciones escriben sin validar (anular cuentas, emitir gift cards, emitir DTE) | Proyecto `eatalia-scanzano-erp` |
| N-16 | **Eatalia: `net._http_response` ocupa 3.5 GB, el 77% de la base.** Riesgo de llenar el disco | Idem |
| N-17 | **`fn_agrandados_panel` es la consulta más cara de la base** (62 horas acumuladas, 1 a 2 s por llamada) y falla 556 veces al día por tiempo agotado | `pg_stat_statements`, logs |
| N-18 | **19,500 errores 401 al día** por una pantalla que consulta `delivery_traslados` sin permiso: es el 72% del ruido de errores | Logs |
| N-19 | **Sin firewall ni límite de peticiones en Vercel**; 13 despliegues a producción en horario de servicio en un solo día; los commits de solo documentación también despliegan | Vercel |
| N-20 | **El POS se usa desde `freakie-dogs-caja.vercel.app`**, no desde `pos.freakiedogs.com` | Referer en logs |

**Correcciones al primer informe:**

- **S-11 se reduce.** `pf_common` no es alcanzable por la API (no está expuesto y `anon` no tiene permisos). El riesgo entre empresas está en `kaeru` y `kako` (N-14), no en `pf_common`.
- **La "diferencia de efectivo" de $22,393 no es faltante.** El cuadre diario aprobado (`ventas_diarias.diferencia_deposito`) suma menos de $60 absolutos en el mes en las seis sucursales. La columna `pos_turnos.diferencia_efectivo` no descuenta egresos ni fondo, así que el número engaña. Es una inferencia por comparación de las dos tablas; conviene corregir el cálculo o quitar la columna.
- **Los 4,501 pedidos de PedidosYa sin DTE** quedan como pregunta para el contador (quién factura al consumidor final en ese canal).

**Lo que sigue sin revisar:** Notion (no autorizado en la sesión), los nombres de variables de entorno de Vercel (403), 7 blueprints de escenarios inactivos de Make, y el código de las 46 Edge Functions sin JWT de Eatalia.

## 2. Lo que dicen los datos del negocio

Cifras de los últimos 30 días del POS propio, salvo donde se indica.

### Ventas

| Sucursal | Cuentas | Venta | Ticket |
|---|---|---|---|
| M001 | 5,604 | $85,379 | $15.24 |
| S006 | 5,101 | $60,658 | $11.89 |
| S004 | 3,089 | $56,076 | $18.15 |
| S003 | 3,043 | $46,389 | $15.24 |
| S001 | 2,787 | $32,720 | $11.74 |
| S002 | 1,915 | $20,003 | $10.45 |
| **Total** | **21,529** | **$300,957** | **$13.98** |

| Canal | Cuentas | Venta | Ticket | Cuentas de 1 producto |
|---|---|---|---|---|
| Para llevar | 10,947 | $116,284 | $10.62 | 65% |
| Mesa | 3,900 | $94,625 | $24.26 | 5% |
| PedidosYa | 4,503 | $55,079 | $12.23 | 59% |
| Delivery propio | 1,881 | $31,085 | $16.53 | 66% |
| Drive-through | 296 | $3,997 | $13.50 | 59% |

- La venta semanal está plana desde agosto, entre $64K y $80K, sin tendencia.
- Picos a las 12–13 h y a las 19 h. Sábado y domingo venden 75% más que martes.
- Efectivo $122K, tarjeta $109K, PedidosYa $55K, link de pago $14K.
- Descuentos 0.3% de la venta, cortesías $112, cancelaciones $977: están controlados.
- `CLAUDE.md` habla de ~$500K al mes; el POS registra $301K. La diferencia (eventos, otras fuentes) no la pude conciliar desde aquí.

### Oportunidades con número

| # | Oportunidad | Dato | Acción |
|---|---|---|---|
| O-1 | **Recuperar los cobros 3DS** | 85 pedidos al mes que pidieron 3DS nunca se cobraron; a $16.50 son unos $1,400 al mes, más los 128 pedidos con tarjeta cancelados | Paquete W1-07; medir la tasa antes y después |
| O-2 | **Subir el ticket de para llevar** | 65% de 10,947 cuentas llevan un solo producto; solo 15.8% de las líneas llevan extra. Cada $0.50 de ticket son $5,500 al mes | Llevar al POS de caja el upsell del agrandado que ya funciona en el menú web (sugerencia al añadir combo) |
| O-3 | **Pasar clientes de PedidosYa al canal propio** | PedidosYa es 18% de la venta. Las facturas de Delivery Hero suman $55,771 en 90 días, unos $18,600 al mes, cerca de un tercio de lo que se vende por ese canal (inferencia: comisión más publicidad). El canal propio vende $31K con envío gratis | Volante en cada bolsa de PedidosYa con un incentivo para el primer pedido web; medir con el campo `origen` que ya existe |
| O-4 | **Reactivar clientes** | 4,139 clientes de delivery; 68% pidieron una sola vez; 1,327 llevan más de 60 días sin pedir; 0 tienen cumpleaños registrado; todos aceptan promociones | Campaña de segundo pedido a los 7 días y de reactivación a los 45; pedir el cumpleaños en el tracking |
| O-5 | **Bajar el tiempo de entrega** | Mediana 51 min, percentil 90 de 93 min; 38% de los pedidos pasan de 60 min. De esos 51, 26 son antes de que el motorista recoja. S004 tiene 59 de mediana | Tablero de tiempo por tramo (cocina, espera de motorista, ruta) por sucursal y hora; meta de recogida en 15 min |
| O-6 | **Cocina de M001** | Percentil 90 de 42 min y 22% de los ítems tardan más de 20 min; el resto de sucursales está entre 15 y 21 min | Revisar por hora y estación; es la sucursal de mayor venta |
| O-7 | **Egresos de caja sin respaldo** | $22,908 al mes salen en efectivo de las cajas; 451 de 757 egresos no tienen foto. "Transporte": 293 egresos, $1,635, ninguno con foto. "Gasto sin factura": 82 de 83 sin foto | Foto obligatoria en la app para todo egreso; tope por motivo; reporte semanal |
| O-8 | **Costo de comida real** | Solo 8 de 125 recetas están aprobadas; 35% del inventario está en negativo (632 filas; Casa Matriz 112). Hoy no se puede comparar consumo teórico contra real | Aprobar las recetas de los 15 productos que hacen el 80% de la venta; conteo inicial limpio; alerta de negativos |
| O-9 | **Menú** | 384 productos disponibles, 256 vendidos, 45 con menos de 5 unidades al mes ($750 en total) | Dar de baja o esconder esos 45; menos errores de caja y de inventario |
| O-10 | **Expediente de personal** | 92 empleados activos: ninguno con número de ISSS cargado, 90 sin cuenta bancaria, 24 sin DUI; 26 altas y 0 bajas registradas en 90 días; el módulo de asistencia tiene 0 registros en 30 días | Decidir si asistencia se usa o se retira; completar expedientes antes de pagar planilla desde el sistema |
| O-11 | **Cuentas por pagar** | 1,553 DTE de compra en 90 días por $633,795. La columna `estado_pago` casi no se usa ($628K figuran pendientes) y 670 están sin cruzar con recepción | Confirmar dónde vive el estado de pago real y dejar una sola fuente; proveedores duplicados por mayúsculas (BELCA aparece dos veces) |
| O-12 | **Datos de PedidosYa** | El import por CSV llega al 5-Nov y sus totales no cuadran entre sí (venta $35.6K contra ingreso estimado $70.4K en 60 días) | Revisar el mapeo de columnas del import antes de usarlo para comisiones |
| O-13 | **Apagar Make.com** | Plan gratuito con 2 escenarios activos que solo hacen "cron → función → Telegram", algo que `pg_cron` ya hace para otros reportes | Paquete W0-02; elimina una dependencia y la clave expuesta |

## 3. Cómo ejecutar

### Reglas de ejecución

1. **Un paquete, una rama, un PR.** Nombre de rama `fix/<id>-<slug>`. No mezclar paquetes.
2. **Antes de tocar** `App.jsx`, `config.js`, `FinanzasDashboard.jsx`, `BancoView.jsx`, `POSMain.jsx` o esquemas, marcarlo en el tablero EN_PROGRESO.
3. **Base de datos:** DDL solo por `apply_migration`, y el mismo SQL al repo en `supabase/migrations/` con prefijo `YYYYMMDDHHMMSS`.
4. **POS, cobros y cierre:** desplegar fuera de horario de servicio (antes de las 10:30 o después de las 22:30).
5. **DTE:** todo paquete marcado 🧾 necesita el visto bueno de Jose antes de aplicarse, y se prueba primero en el ambiente de pruebas de Hacienda.
6. **Cada paquete termina con:** su criterio de terminado comprobado, entrada en `memoria.md`, y la consulta de verificación guardada en `scripts/`.
7. **Orden:** no saltar la Ola 0. La Ola 1 puede ir en paralelo entre tres personas porque sus paquetes tocan archivos distintos.

### Qué modelo usar en cada paquete

| Modelo | Para qué | Por qué |
|---|---|---|
| **Haiku** | Cambios mecánicos y acotados: borrar archivos, quitar dependencias, un `GRANT`, cabeceras, renombrar, actualizar documentos, correr consultas de verificación | Rápido y barato; el riesgo es bajo y el resultado se comprueba con una consulta o un build |
| **Sonnet** | El grueso: corregir una pantalla, escribir una RPC con su migración, agregar paginación, pruebas unitarias, políticas RLS tabla por tabla siguiendo un molde ya definido | Buen equilibrio; el paquete trae los pasos y el criterio de terminado |
| **Opus** | Diseño y cambios donde un error cuesta dinero o es fiscal: cobro atómico, idempotencia de pagos y de DTE, modelo de sesión en servidor, unificación del P&L, migración de permisos de un esquema completo | Necesita razonar sobre concurrencia, estados parciales y compatibilidad con lo que ya corre |
| **Fable** | Revisión independiente antes de fusionar los paquetes Opus de dinero y DTE, y el diseño de W2-01 (sesión en servidor), que toca toda la app | Segunda lectura no anclada en quien escribió el cambio |

Regla práctica: quien diseña no revisa. Los paquetes marcados **Opus → Fable** se escriben con Opus y se revisan con Fable usando `/code-review` sobre el PR. Los marcados **Sonnet → Opus** igual, un escalón abajo.

## 4. Ola 0 — Emergencias (días 1 a 3)

Son huecos explotables hoy con información pública. Casi todos son de horas.

| ID | Paquete | Pasos | Terminado cuando | Modelo | Esf. |
|---|---|---|---|---|---|
| W0-01 | **Rotar la `service_role`** (N-1, N-12) | 1) Inventariar dónde se usa: variables de Vercel, secretos de Edge Functions, `cron.job`, Make, `compras-hq-sync`. 2) Generar llave nueva en Supabase. 3) Actualizar cada consumidor. 4) Revocar la anterior. 5) En `compras-hq-sync`, cambiar la cabecera por un secreto dedicado | La llave anterior devuelve 401; los cron de las siguientes 2 horas terminan bien; POS, menú web y DTE emiten | Opus (plan) + Haiku (pasos) | M |
| W0-02 | **Apagar Make.com** (O-13) | 1) Crear 2 jobs en `pg_cron` que llamen a `reporte-ventas-diario` y `reporte-diario`. 2) Verificar que llega el Telegram dos días. 3) Desactivar los 2 escenarios, borrar los 3 webhooks y los 8 escenarios obsoletos | Llegan los dos reportes sin Make; 0 escenarios activos | Sonnet | S |
| W0-03 | **Borrar `bulk-sql-kaeru` y `dte-service-v2`** (N-2) | Confirmar con logs de 30 días que nadie las llama; borrar | Las dos devuelven 404 | Haiku | S |
| W0-04 🧾 | **Corregir la autenticación de `dte-service`** (N-3) | 1) Bajar la función al repo. 2) En `lib/auth.ts` exigir `business_id`, negocio activo, llave no vencida y permiso. 3) Pasar `p_business_id` en `dte_get_document`, `dte_update_document` y en el `ON CONFLICT` de `dte_emit`. 4) Probar en ambiente de pruebas | Una llave inventada da 401; una llave de la empresa A no lee documentos de B; Freakie emite y consulta igual que antes | Opus → Fable | S |
| W0-05 🧾 | **Parar los bucles de reintento y resolver KWA** (N-4) | 1) Pausar `kaeru-dte-retry`, `kako-dte-retry`, `kwa-dte-retry`. 2) KWA: verificar certificado y llave contra Hacienda producción (hay 2 certificados cargados, 1 activo). 3) Agregar a los tres: máximo de intentos, espera creciente y estado `error_permanente` cuando Hacienda rechaza. 4) Validar formato de DUI/NIT antes de emitir. 5) Reanudar | Menos de 20 rechazos al día en total; las 16 ventas de KWA con sello; las 4 de Kaeru/Kako corregidas o marcadas | Opus | M |
| W0-06 | **Cerrar `ai-gateway` y `ai-query`** (N-5) | 1) Exigir sesión en ambas. 2) Ejecutar las consultas con un rol de solo lectura que solo tenga permiso sobre las vistas permitidas (los roles `ai_ro_*` ya existen), no con lista negra. 3) Igual en `fn_ai_exec_kaeru` y `fn_ai_exec_kako` | Sin sesión dan 401; `select` sobre `auth.users` o `dte_service` desde el agente da "permission denied" | Opus | M |
| W0-07 | **`kaeru-pin-setup` y `kako-pin-setup`** (N-6) | Copiar el patrón de `kwa-pin-setup` (JWT + rol admin + dominio); quitar el secreto del frontend | Sin JWT de admin dan 401 | Sonnet | S |
| W0-08 🧾 | **Cerrar el adivinador de PINs** (S-1, S-2) | 1) `api/dte-proxy.js` y `api/dte-email.js`: validar por una RPC que comparta contador de intentos; respuesta 401 única sin devolver el rol. 2) `peya-responder`: usar el token de `staff_sesiones` en vez del PIN. 3) Regla de límite por IP en Vercel para `/api/*` | 10 PINs malos seguidos desde una IP bloquean esa IP 10 minutos; el POS emite DTE igual | Sonnet → Opus | M |
| W0-09 | **Rotar y borrar los PINs de los documentos** (S-6) | 1) Cambiar los PINs que aparecen en MAESTRO, CHANGELOG, `ONBOARDING_CESAR.md`, `docs/cowork/`. 2) Borrarlos del texto, junto con la API key DTE y las URL de webhook que hay en el MAESTRO. 3) Agregar al pre-commit un chequeo de "PIN seguido de dígitos" | `grep` no encuentra PINs; los viejos no entran | Haiku | S |
| W0-10 | **Salto de ruta en `supaproxy`** (S-4) | Normalizar con `new URL()` antes del gate; rechazar `..`, `%2e` y `//`; decidir sobre la ruta final | La URL de prueba con `../planilla_detalle` da 403 | Sonnet | S |
| W0-11 | **Quitar páginas y funciones expuestas** (S-8, N-13) | Borrar `public/dashboard-ejecutivo.html`, `dashboard-operativo.html`, `api/hello.js`, `proxy_dgii.py`. Poner secreto a `ingest-dte`, `ingest-bees-email`, `importar-quanto-csv`, `bulk-load-dte-json`, `calcular-metas`, `alerta-11am`, `backfill-nc`, `kaeru-dte-email` y los reportes | Las URL dan 404 o 401 | Haiku + Sonnet | S |
| W0-12 | **RLS en las 29 tablas sin RLS; borrar respaldos** (S-9) | Activar RLS sin políticas en las 17 tablas reales; borrar las 12 `bak_*`/`_respaldo_*` tras confirmar que no se leen; revisar `_sr_pw_handoff` y `app_secretos` | El asesor de seguridad muestra 0 tablas sin RLS en `public` | Sonnet | S |
| W0-13 | **Eatalia: cerrar la toma de cuentas** (N-15, N-16) | 1) Revocar `get_email_by_pin` a `anon` y mover el login a una función con límite de intentos. 2) Contraseña de Auth aleatoria, no derivada del PIN. 3) Revocar a `anon` `_anular_cuenta_core`, `_anular_item_core`, `gift_card_*`, `scz_emitir_dte`, `scz_pago_aplicar`. 4) Purgar `net._http_response` y fijar su retención. 5) Borrar las funciones `tmp-*` | Las llamadas anónimas dan 401; la tabla baja de 3.5 GB a menos de 100 MB | Opus (1–3) + Haiku (4–5) | M |

## 5. Ola 1 — Dejar de perder dinero y documentos (semanas 1 a 2)

| ID | Paquete | Pasos | Terminado cuando | Modelo | Esf. |
|---|---|---|---|---|---|
| W1-01 | **POS: confirmación falsa de pago** (P-1) | `saveCuenta` devuelve `{ok, cuenta}` o lanza; `PaymentModal` confirma solo con `cuenta.id`; mensaje claro si no hay turno abierto | Sin turno abierto no aparece "Pago confirmado"; prueba unitaria | Sonnet | S |
| W1-02 | **POS: comandar no revive cuentas cobradas** (P-4) | Filtro `.not('estado','in','(cobrada,cancelada)')` en `POSMain.jsx:1057`; abortar si no tocó filas | Prueba con dos tablets: la segunda recibe aviso y no cambia el estado | Sonnet | S |
| W1-03 | **POS: cola de cocina con error visible** (P-6, P-10) | Revisar `error` en los dos insert a `pos_cocina_queue`; reintento y aviso. KDS: conservar la cola anterior y mostrar "sin conexión" | Simulando fallo de red aparece el aviso y el ítem no queda marcado como comandado | Sonnet | S |
| W1-04 | **POS: "Liberar mesa" con autorización** (P-2) | RPC `pos_liberar_mesa(p_cuenta, p_pin, p_motivo)` que valida rol en servidor, cancela en vez de marcar cobrada y deja registro | Un mesero no puede liberar; queda fila en la bitácora | Sonnet → Opus | S |
| W1-05 | **Bitácora del POS** (N-9) | 1) `GRANT USAGE` sobre `pos_dte_proxy_log_id_seq` 🧾. 2) Escribir en `pos_operaciones_log` desde las RPC de anular, liberar, descuento y cortesía | Aparecen filas al anular una cuenta de prueba; 0 errores 403 en logs | Sonnet | S |
| W1-06 🧾 | **DTE de los pedidos web con tarjeta** (N-7, D-4) | 1) Sacar la emisión del request de pago: tabla `dte_pendientes` + job cada minuto que emite cuando existe la cuenta del POS. 2) Misma vía para `n1co-link` y el webhook. 3) Decidir con el contador qué hacer con los 787 pedidos ya cobrados sin DTE | 7 días seguidos con menos de 1% de pedidos web pagados sin DTE; 0 avisos `sin_cuenta` en Vercel | Opus → Fable | M |
| W1-07 | **3DS e idempotencia del pago web** (N-8, D-2, D-3, D-5) | 1) Guardar `customer_id` en `pagos_online` y usar el mismo en `confirmar-3ds`. 2) Llave de idempotencia generada en el navegador y guardada en el pedido. 3) Rechazar `iniciar` si hay un intento abierto reciente. 4) Job que alerte por Telegram de pagos en `iniciado` o `requiere_3ds` de más de 15 minutos. 5) Registrar tipos de evento desconocidos del webhook | La tasa de 3DS completado sube de 22% (medir 14 días); doble envío del mismo pedido produce un solo cargo en prueba | Opus → Fable | M |
| W1-08 | **App de motoristas con sesión** (D-1, D-8) | Helper `_driver_valida(token)`; exigirlo en todas las RPC `driver_*`, `mis_pedidos_driver` y `actualizar_ubicacion_driver`; validar estado `en_camino` y guardar la distancia al entregar; revocar `anon` en `guardar_cobertura_sucursal` y `calcular_bonos_delivery_mes` | Llamar con solo el UUID da error; la app sigue funcionando en un turno real | Opus | M |
| W1-09 | **Privacidad del cliente web** (D-6, D-7) | "Mis pedidos" atado a un secreto del dispositivo; tracking sin dirección ni coordenadas 2 horas después de entregado; captcha y límite por IP al crear pedido; normalizar teléfono y fallar cerrado | Con solo el teléfono no se obtiene el token de tracking | Sonnet → Opus | M |
| W1-10 | **Recepción con orden de compra** (I-1) | Agregar `producto_id` al select de `RecepcionTab.jsx:160`; bloquear el guardado si algún ítem queda sin producto | Una recepción de prueba con OC mueve el kardex | Sonnet | S |
| W1-11 | **Finanzas: números que engañan** (F-1, F-2, F-3) | Pestaña Balance armada con `v_bank_saldos_consolidados`, `v_cuentas_por_pagar`, `v_prestamos_estado`, `v_socios_balance`, o retirada; llave `key` en ventas por canal; banner cuando falla una fuente del P&L; corregir o quitar `diferencia_efectivo` de turnos | Ningún número de la pestaña sale de un porcentaje fijo; cortar una fuente muestra el aviso | Sonnet | M |
| W1-12 | **Cron y rendimiento** (B-1, N-17, N-18) | 1) Índice único en `mv_vista_top_productos`. 2) Columnas explícitas en `pos_cocina_queue_archivar`. 3) Reescribir o cachear `fn_agrandados_panel` y bajar su frecuencia. 4) Quitar o autorizar la consulta a `delivery_traslados`. 5) `timeout_milliseconds` en los cron que llaman funciones. 6) Corregir las dos consultas con columnas inexistentes | 0 cron fallando en 7 días; 0 errores 500 de `fn_agrandados_panel`; los 401 bajan de 20,000 a menos de 500 al día | Sonnet → Opus (punto 3) | M |
| W1-13 | **CI obligatorio y despliegues ordenados** (E-2, N-19) | Workflow `npm ci && npm run build` + los 4 tests offline como check requerido; `CODEOWNERS` para `src/pos/**`, `api/**`, `supabase/**`; paso de build ignorado en Vercel para cambios solo de `docs/`, `memoria.md` y `Contexto/` | Un PR con error de sintaxis no se puede fusionar; un commit de documentación no despliega | Sonnet | S |
| W1-14 | **Dependencias y limpieza** (E-5, E-9) | `npm audit fix`; quitar `react-router-dom`, `lucide-react`, 3 `@radix-ui`; cambiar `xlsx` al paquete oficial de SheetJS; borrar `_backup/`, `_archive/`, el `.timestamp-*.mjs`, 630 líneas de código muerto; `.gitignore` | `npm audit --omit=dev` sin críticas ni altas; build en verde | Haiku | S |
| W1-15 | **Cabeceras y firewall de Vercel** (S-12, N-19, N-20) | CSP, `frame-ancestors`, `Referrer-Policy`, `X-Content-Type-Options` en `vercel.json`; límite por IP en `/api/*`; lista blanca de orígenes en el puente de impresión Windows; mover las cajas a `pos.freakiedogs.com` | Las cabeceras aparecen en producción; el POS imprime igual | Sonnet | S |
| W1-16 | **Monitoreo de errores** (E-4) | Tabla `errores_cliente` + RPC, o Sentry; reporte desde `PantallaDeError` y los handlers globales con sucursal, usuario y versión; resumen diario por Telegram; dejar de publicar los sourcemaps | Un error provocado en una tablet de prueba aparece en el resumen | Sonnet | S |
| W1-17 | **Buckets privados** (S-10) | `bank-estados-cuenta`, `bank-comprobantes`, `pagos-comprobantes`, `kaeru-comprobantes`, `kako-comprobantes` a privados con URL firmada; quitar a `anon` borrar y actualizar; `/foto` con URL de subida de un solo uso | Una URL pública vieja da 400; las pantallas siguen mostrando los comprobantes | Sonnet → Opus | M |

## 6. Ola 2 — Cimientos (semanas 3 a 8)

| ID | Paquete | Pasos | Terminado cuando | Modelo | Esf. |
|---|---|---|---|---|---|
| W2-01 | **Sesión real en servidor** (S-3) | 1) Diseño: `erp_login` devuelve un token de `staff_sesiones`; helper `_staff_valida(token, roles[])`; el cliente lo manda en una cabecera que el proxy reenvía. 2) Migrar por dominio, en este orden: POS (`pos_*`), bancos y pagos, compras, inventario, RRHH. En cada uno: las escrituras pasan a RPC con token y se revoca `INSERT/UPDATE/DELETE` a `anon`. 3) Compatibilidad: las RPC aceptan token opcional una semana, luego obligatorio | Por dominio: 0 políticas `USING(true)` de escritura para `anon` y el asesor baja el conteo de funciones anónimas. Meta final: menos de 40 funciones anónimas (login, menú público, tracking) | Fable (diseño) → Opus (migración por dominio) → Sonnet (pantallas) | L |
| W2-02 | **Cobro atómico en el POS** (P-3, P-7, P-8) | RPC `pos_cobrar_cuenta(p_cobro_uid, p_cuenta, p_items, p_pagos, …)` en una transacción: recalcula totales en servidor en centavos, inserta pagos, cola de cocina y descarga de inventario; índice único sobre `cobro_uid`; índice único parcial de turno abierto por sucursal y caja; cierre que recalcula al confirmar | Reenviar el mismo cobro 3 veces deja una cuenta y un pago; prueba automática de 20 combinaciones de precios | Opus → Fable | L |
| W2-03 🧾 | **Idempotencia y correlativos en `dte-service`** (N-10, P-5) | 1) El POS envía una llave derivada de la cuenta. 2) Guardar `pendiente` con el payload firmado antes de transmitir. 3) Ante timeout, consultar a Hacienda antes de reemitir. 4) Número de control desde la tabla `consecutivos` con bloqueo. 5) Timeout en el `fetch` a Hacienda. 6) Bandeja "cobradas sin DTE" en el admin con reintento | Cortar la red a mitad de emisión y reintentar deja un solo DTE; 0 documentos en `contingencia` de más de 24 h | Opus → Fable | L |
| W2-04 🧾 | **Credenciales fiscales a Vault** (N-11) | Mover llave privada, contraseña de Hacienda y tokens a Vault; RLS "nadie" en las 9 tablas de `dte_service`; expiración en las API keys; fechas de vigencia en los certificados de Kaeru y Kako y alerta 60 días antes | `select` de la columna devuelve null; las 4 empresas emiten | Opus | M |
| W2-05 | **Kaeru y Kako con los permisos de KWA** (N-14) | Replicar los `REVOKE` de KWA; `security_invoker=on` en las 69 vistas de cada esquema; cambiar políticas `true` por `is_*_user()`; RLS en las 3 tablas de Kaeru sin RLS; PIN con hash, intentos y bloqueo copiando `pf_common`; límite en `*-pin-login` | 0 funciones privilegiadas para `anon` en ambos esquemas; un usuario de KWA no lee vistas de Kaeru | Opus (primer esquema) → Sonnet (el segundo) | M |
| W2-06 | **PINs con hash en Freakie** (S-5, S-7) | Columna `pin_hash`; migrar; retirar `fn_equipo_pin_ver` y poner reseteo; 6 dígitos para ejecutivo, finanzas, RRHH y admin; contador de intentos por dispositivo en vez de global; el POS deja de guardar el PIN en `sessionStorage` (depende de W2-01) | La columna `pin` en claro ya no existe; 25 intentos malos desde una tablet no bloquean a las demás | Opus | M |
| W2-07 | **Repo que reconstruye la base** (E-1, N-13) | Volcado de esquema como línea base; bajar las 54 Edge Functions a `supabase/functions/`; secretos fijos a Vault (N-6 de funciones); un solo patrón de retry, pin-login y dte-email parametrizado por empresa; job semanal que compare migraciones de la base contra el repo | `supabase db reset` en una rama levanta el esquema; 0 funciones fuera del repo | Sonnet (volcado) + Opus (unificación) | M |
| W2-08 | **Staging** (E-3) | Rama de Supabase para los previews de Vercel con datos de muestra; variables de entorno de preview separadas de producción | Un preview no puede escribir en producción | Sonnet | M |
| W2-09 | **Operaciones atómicas de inventario y pagos** (I-2, I-3, F-6) | RPC transaccionales con guarda de estado para recepción, confirmación, devolución y pago a proveedor; conversión de unidad en servidor; conteo físico por diferencia contra el stock al momento de contar | Confirmar dos veces la misma recepción suma una vez; reintentar un pago a proveedor no lo duplica | Opus | M |
| W2-10 | **Un solo P&L** (F-4, F-5, F-8) | RPC `fn_pl_mensual` con reglas escritas y aprobadas (IVA, propina, eventos, PedidosYa, planilla); las tres pantallas la consumen; paginación con orden único en `fetchAllRows`; helper de fecha UTC-6 en las 69 llamadas | El mismo mes da la misma utilidad en las tres pantallas; prueba que compara contra un mes cerrado a mano | Opus (reglas) → Sonnet (pantallas) | L |
| W2-11 | **Libros fiscales con el contador** (F-7) | Sesión con el contador sobre libro de ventas, compras, F-14 y anexos; corregir notas de crédito, percepción 1%, NIT/NRC en CCF; incluir fuentes fuera del POS | El contador firma un mes de prueba contra su declaración | Sonnet | M |
| W2-12 | **Pruebas automáticas** (E-6) | Vitest para totales, IVA, propina, prorrateo de descuento y cierre; un recorrido Playwright login → cobro → cierre contra staging; las pruebas SQL existentes dentro del CI | Las pruebas corren en cada PR en menos de 5 minutos | Sonnet | M |
| W2-13 | **Higiene de base** (B-2, B-3) | Retención de `driver_recorrido` (90 días) y de `dte_import_errors` (30,000 filas nuevas al mes); `search_path` fijo en 366 funciones; índices en las FK de `dte_service` y `pos_*`; `(select auth.uid())` en 27 políticas; borrar 218 índices sin uso tras 30 días de observación | La base deja de crecer por esas tablas; el asesor de rendimiento baja de 1,287 a menos de 400 avisos | Haiku (mecánico) → Sonnet (revisión) | M |
| W2-14 | **APK y actualización de tablets** (E-7, E-9) | APK de motoristas firmada en release y publicada por GitHub Release; aviso de versión nueva; chequeo periódico de versión en el POS con "actualizar al terminar la orden"; service worker en `pos.html` | Una tablet abierta 48 horas recibe el aviso de actualización | Sonnet | M |
| W2-15 | **Documentación viva** (E-8) | MAESTRO reducido a un índice de unas 300 líneas generado desde la base; `memoria.md` partido por mes; `CLAUDE.md` con las reglas de este plan | El ritual de inicio lee menos de 500 líneas | Haiku | S |

## 7. Ola 3 — Crecimiento (en paralelo desde la semana 3)

Estos paquetes no dependen de las olas anteriores salvo donde se indica. Cada uno lleva una métrica de antes y después.

| ID | Paquete | Métrica | Modelo | Esf. |
|---|---|---|---|---|
| W3-01 | Upsell del agrandado y sugerencias en el POS de caja (O-2) | Ticket de para llevar, hoy $10.62; % de líneas con extra, hoy 15.8% | Sonnet | M |
| W3-02 | Campañas de segundo pedido, reactivación y cumpleaños (O-4) | % de clientes con 2 o más pedidos, hoy 32% | Sonnet | M |
| W3-03 | Volante y código de primer pedido web en bolsas de PedidosYa (O-3) | Pedidos con `origen` del volante; participación de PedidosYa, hoy 18% | Haiku (reporte) | S |
| W3-04 | Tablero de tiempos de entrega por tramo y sucursal (O-5, O-6) | % de pedidos de más de 60 min, hoy 38% | Sonnet | M |
| W3-05 | Foto obligatoria y topes en egresos de caja (O-7) | % de egresos sin foto, hoy 60% | Sonnet | S |
| W3-06 | Recetas aprobadas de los 15 productos principales y consumo teórico contra real (O-8); depende de W2-09 | Filas en negativo, hoy 632; recetas aprobadas, hoy 8 | Opus (modelo de costo) → Sonnet | L |
| W3-07 | Limpieza del menú: 45 productos sin rotación (O-9) | Productos disponibles, hoy 384 | Haiku | S |
| W3-08 | Expediente de personal completo y decisión sobre asistencia (O-10) | Empleados con ISSS y cuenta cargados, hoy 0 y 2 de 92 | Sonnet | M |
| W3-09 | Una sola fuente del estado de pago a proveedores y deduplicación de proveedores (O-11) | Monto pendiente coincide con el del contador | Sonnet → Opus | M |
| W3-10 | Corregir el import de PedidosYa y calcular la comisión real (O-12) | Totales del CSV cuadran con el POS | Sonnet | S |
| W3-11 | Un POS común para Freakie, Eatalia y los tres restaurantes hermanos | Decisión de arquitectura antes de escribir código: hoy son tres modelos distintos. El molde recomendado es permisos de KWA + autenticación de `pf_common` + DTE compartido | Fable (decisión) | L |

## 8. Dependencias y orden

```
W0-01 (rotar llave) ──► W0-02 (apagar Make)
W0-04 (auth dte-service) ──► W2-03 (idempotencia DTE) ──► W2-04 (Vault)
W0-08 (PIN) ──► W2-01 (sesión) ──► W2-06 (hash de PIN)
W1-01..W1-05 (POS rápidos) ──► W2-02 (cobro atómico)
W1-13 (CI) ──► W2-12 (pruebas) ──► W2-08 (staging)
W1-10 (recepción) ──► W2-09 (inventario atómico) ──► W3-06 (costo de comida)
W0-05 (KWA) y W2-05 (Kaeru/Kako) son independientes de Freakie
```

Reparto sugerido para tres personas en la Ola 1, por archivos que no chocan:

- **Persona A (POS y caja):** W1-01 a W1-05, luego W2-02.
- **Persona B (web, delivery y pagos):** W1-06 a W1-09, luego W2-03.
- **Persona C (back-office e infraestructura):** W1-10 a W1-17, luego W2-07 y W2-08.

## 9. Indicadores para saber si funcionó

Guardar estas consultas en `scripts/salud/` y correrlas cada lunes.

| Indicador | Hoy | Meta a 30 días | Meta a 90 días |
|---|---|---|---|
| Funciones privilegiadas ejecutables sin sesión (Freakie) | 564 | 564 (se ataca en la Ola 2) | menos de 40 |
| Políticas de escritura `USING(true)` para `anon` | 392 | 300 | menos de 20 |
| Tablas sin RLS en `public` | 29 | 0 | 0 |
| Edge Functions fuera del repo | 50 de 54 | 0 | 0 |
| Pedidos web con tarjeta sin DTE | 99% | menos de 1% | menos de 1% |
| Cobros 3DS completados | 22% | más de 60% | más de 75% |
| Rechazos de DTE al día (todas las empresas) | ~5,400 | menos de 20 | menos de 5 |
| Cron fallando | 2 | 0 | 0 |
| Errores 401 y 500 al día en la API | ~21,000 | menos de 1,000 | menos de 300 |
| Vulnerabilidades críticas o altas en dependencias | 3 | 0 | 0 |
| Inventario en negativo | 632 filas | 400 | menos de 50 |
| Egresos de caja sin foto | 60% | menos de 10% | menos de 2% |
| Pedidos de delivery de más de 60 min | 38% | 30% | menos de 20% |
| Ticket de para llevar | $10.62 | $10.90 | $11.20 |

## 10. Decisiones que necesito de Jose

1. **Visto bueno para los paquetes 🧾** (W0-04, W0-05, W0-08, W1-05, W1-06, W2-03, W2-04). W0-04 y W0-05 son los más urgentes.
2. **Los 787 pedidos web ya cobrados sin DTE:** emitir retroactivo o regularizar con el contador.
3. **PedidosYa sin DTE propio:** confirmar con el contador que es correcto.
4. **Ventana de mantenimiento** para rotar la `service_role` (W0-01): unos 30 minutos fuera de horario.
5. **Módulo de asistencia:** se usa o se retira.
6. **Eatalia y hermanas:** quién ejecuta los paquetes W0-13 y W2-05, porque tocan proyectos de otros equipos.
7. **Autorizar Notion** en la sesión si quieres que el plan se cruce con el Roadmap y los Pendientes.
