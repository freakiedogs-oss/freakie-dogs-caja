# Memoria — Freakie Dogs ERP (caja / POS)

> Log de decisiones y cambios, lo más nuevo arriba. El **estado completo** vive en `Contexto/MAESTRO/Freakie_Dogs_Contexto_ERP_MAESTRO.md` (+ `CHANGELOG.md`); esto guarda el **"por qué" reciente**. Actualizar al terminar algo material.

## 9-Ago-2026 — Fix UX: botón "Todo Solicitado" (Despacho) ahora baja al fondo

- **Síntoma (Jose):** en *Almacén → Despacho → Preparar Despacho*, el botón **✅ Todo Solicitado** "no hacía nada". En realidad **sí** rellena `qty_despacho` con lo solicitado, pero cuando las cantidades ya coincidían con lo solicitado no había cambio visible y encima dejaba la vista arriba → parecía muerto.
- **Fix (`components/almacen/DespachoTab.jsx`, comp `PrepararDespacho`):** tras rellenar, `requestAnimationFrame` + `scrollIntoView({behavior:'smooth',block:'end'})` hacia un `bottomRef` anclado en la fila del botón **📦 Crear Despacho**. Ahora te lleva directo al selector de motorista + Crear Despacho sin scrollear. Commit `6c82822` en `main` (push con bypass de PR). Frontend → visible tras deploy Vercel.

## 9-Ago-2026 — Fix: conteo_lista mostraba "sábana" de TODOS los ingredientes (bug de correlación)

- **Síntoma (Jose):** en *Kardex → Lista Conteo*, al expandir la receta de un ítem (ej. *Papa Sazonada porcionado*) salía una lista enorme de ingredientes ajenos (New York, Asado de Tira, Molida 90/10, panes, quesos…), no la receta real. La receta en DB tiene **1 solo ingrediente** → no era dato malo, era el RPC.
- **Causa raíz (RPC `conteo_lista`):** la subconsulta de ingredientes hacía `where ri.receta_id = receta_id`. Ese `receta_id` sin calificar se resolvía a la **columna del scope interno** `receta_ingredientes.receta_id` (no a la receta de la fila), quedando `ri.receta_id = ri.receta_id` → **siempre true** → agregaba TODOS los ingredientes de TODAS las recetas. El **nombre** de la receta salía bien porque esa otra subconsulta (`from recetas`) no tiene esa colisión.
- **Fix (migración `fix_conteo_lista_ingredientes_correlacion`):** se alía la CTE como `it` y se califican las referencias externas (`it.receta_id`, `it.match_receta_id`). Verificado: la papa ahora devuelve solo su ingrediente real. Afectaba a **todos** los ítems con receta enlazada. DB puro (RPC) → ya vivo, sin deploy.

## 9-Ago-2026 — Mapeo Compras: ver/editar el ingrediente vinculado + estado de conteo nocturno

- **Síntoma (Jose):** en *Kardex → Mapeo Compras*, un item de DTE ya "✓ Vinculado" no mostraba **a qué ingrediente** estaba vinculado ni dejaba corregirlo si estaba mal. Caso real "REDSTONE" (papa McCain 3/8): 3 descripciones de la MISMA papa mapeadas a 3 cosas distintas (una a `325026-MCX03621 MC REDSTONE` = Caja, dos a `Papa Sazonadas 30lb` = libra) y una sin vincular. No había forma de verlo ni arreglarlo desde la UI.
- **Además (Jose):** que en la card se vea si ese ingrediente está en el **conteo nocturno** (validar sincronía) y que renombrarlo aquí se refleje en el conteo.
- **Modelo:** conteo nocturno = `catalogo_productos.incluir_conteo`; el nombre del ingrediente es `catalogo_productos.nombre` (**fuente única** → renombrar se refleja solo en el conteo). Vínculo DTE↔ingrediente vive en `compras_dte_items.producto_id`; la vista `v_dte_descripciones` agrupa por descripción normalizada.
- **DB (migración `mapeo_view_ingrediente_conteo_y_desmapear`):**
  - `v_dte_descripciones` ahora expone `catalogo_nombre, catalogo_tipo, catalogo_unidad, catalogo_en_conteo` (join a `catalogo_productos` por el `catalogo_id` ya existente). Re-GRANT SELECT a anon/authenticated.
  - Nueva RPC `desmapear_descripcion_dte(p_descripcion)` — pone `producto_id=NULL` en todas las líneas de esa descripción y **olvida** el aprendizaje en `proveedor_item_mapa` (si no, `mapear` lo re-aprendería). SECURITY DEFINER, execute a anon/authenticated.
- **Frontend (`KardexView.jsx`, tab Mapeo):** cada card vinculada muestra el ingrediente (nombre editable ✎ vía `set_conteo_item_meta` → refleja en conteo), badge **🌙 En conteo / ⚠️ No está en el conteo** (+ botón "Agregar al conteo" con `set_conteo_item`), y acciones **↻ Cambiar** (reusa el panel de búsqueda/creación) y **✕ Desvincular**. El panel expandido ahora abre también para items ya mapeados (Cambiar).
- **NO** cambié ningún mapeo real (ej. el de REDSTONE): eso lo decide Jose desde la nueva UI (afecta inventario/costeo de $239K de historial). Build OK. Frontend → requiere merge PR + deploy Vercel.

## 9-Ago-2026 — Recetas usa el COSTO REAL del motor DTE (adiós precio_referencia en el costeo) — Fase 1

- **Síntoma (Jose):** el costo en la pestaña Recetas salía **$0** siempre, aunque el DTE estuviera vinculado. Quería que el costo viniera del **costo real de los DTE**, no de un campo manual.
- **Causa:** `RecetasView` calculaba el costo en JS con `catalogo_productos.precio_referencia` (campo manual, casi siempre null → $0). **Ignoraba el motor de costo que YA existe** y que Costeo/Menú(BOM) ya usan bien: `costo_producto(id)` (promedio ponderado de compras, cascada recepción→factura mapeada→proveedor→ref) y `receta_costo_total(id,depth)` (total de la receta, con merma y dividiendo sub-recetas por su rendimiento). Ver `docs/INTEGRACION-ALMACEN.md`.
- **Fix (sin motor nuevo, se construyó sobre lo existente):**
  1. **DB:** 2 wrappers de solo lectura (SECURITY DEFINER STABLE) que mapean las funciones existentes en 1 llamada: `costos_recetas_bloques()` (costo por bloque sub_receta/porcionado) y `costos_productos_recetas()` (costo_producto de las MP usadas en recetas). GRANT execute a anon/authenticated. Aplicados en prod vía migración.
  2. **Frontend (`RecetasView.jsx`):** `calcCosto` ahora lee el mapa del motor; la línea por ingrediente usa `cantidad×(1+merma)×costo_unit` (MP→costo_producto, sub→costo_total÷rendimiento); `costo_calculado` se cachea desde `receta_costo_total` (arregla bug viejo que lo guardaba **ignorando sub-recetas**). Ya NO se lee `precio_referencia`. Sin datos DTE → **$0 + aviso "Sin costo DTE"** (decisión de Jose: sin fallback manual).
- **Validado con datos reales:** Cheddar Porcionado pasó de $0 a **$10.39** (motor). ⚠️ **Ojo dato, no código:** `Cheddar Lata` tiene `factor_compra=1`; si 1 lata rinde ~3 bolsas debería ser 3 (eslabón flojo #3 de la doc) → hoy el costo/bolsa sale inflado ~3×. Ajustar el factor en el 📐 del Kardex.
- **Fase 2 pendiente (visión de Jose):** costeo FIFO / promedio móvil valuando el kardex (`kardex_movimientos` hoy lleva cantidad **sin costo**). Proyecto aparte. `costo_producto` ya da promedio ponderado hoy, así que Fase 1 alcanza para ver costo real.

## 9-Ago-2026 — Recetas: fix rendimiento que "no sincronizaba" (subtítulo stale)

- **Síntoma (Jose):** en una receta (ej. *Cheddar Porcionado*), el "Rinde 3 bolsa" del subtítulo y el campo *Rendimiento* del modal *Editar Receta* parecían desincronizados; tocaba ajustar ambos a mano.
- **Causa raíz:** son el **mismo campo** `recetas.rendimiento` (un solo valor en DB), mostrado/editable en dos rutas. `guardarRendimiento` (edición inline del subtítulo) hacía `setSel(...)` y refrescaba, pero `guardarReceta` (el modal) solo llamaba `cargar()` — que recarga la **lista** pero NO la receta abierta (`sel`). Tras guardar por el modal, el subtítulo seguía mostrando el número viejo hasta reabrir → parecía que "no agarró".
- **Fix (`RecetasView.jsx`, `guardarReceta`):** al editar receta existente, construyo el objeto `cambios` una sola vez (mismos valores normalizados que van a la DB) y hago `setSel(s => s?.id===editReceta.id ? {...s, ...cambios} : s)`. No es un problema de datos: **manda el último guardado** porque es una sola columna.
- Build OK. Frontend → requiere merge PR + deploy Vercel para verse en tablet.

## 8-Ago-2026 — Despacho: entrega contingencia + KPI reparto + mandados asignables + fix mapa (PR #180)

- **Entrega del driver = CONTINGENCIA** (corrección de Jose): NO reemplaza el Confirmar Entrega de la sucursal (esa es la que carga inventario). `despacho_entrega_driver` sella hora/foto/GPS en columnas nuevas `*_entrega_driver` de despachos_sucursal, sin tocar inventario ni estado. `mis_despachos_ruta` excluye lo ya marcado por el driver.
- **KPI de Reparto** (`RepartoKpiView` + RPC `kpi_reparto(desde,hasta)`): por motorista/día, de la primera salida (bodega marcó despachado) a la última entrega del driver. Reemplaza el KPI viejo de carga en CM → **quitado del menú el ítem 'Mi Despacho' (self-marking)**; queda 'Mi Ruta de Despacho' + nuevo 'KPI de Reparto'. (El componente MiDespacho/DespachoKpiDashboard sigue en el código pero sin nav.)
- **Mandados asignables**: `NuevoMandado` con selector de motorista; el motorista los ve en `MiRutaDespacho` como paradas (junto a los despachos) y los marca hechos (GPS + gasto). El **despachador (Kevin/Israel)** puede crear/asignar desde GPS y Mandados (se agregó rol despachador a despacho-gps).
- **Fix mapa colgado**: el contenedor Leaflet aísla su stacking context (`isolation:isolate` + z-index 0) → ya no flota sobre el menú lateral; + `invalidateSize`.

## 8-Ago-2026 — GPS despacho: reubicación + separar delivery/internos + ruta del motorista (PRs #176, #177, #178)

- **Separar delivery vs internos** (PR #176): `driver_ubicaciones.tipo` ('delivery'|'despacho') + param opcional `p_tipo` en `actualizar_ubicacion_driver` (default 'delivery', retrocompatible). Mapa con filtro Todos/🛵 Internos/🛍️ Delivery + markers de color.
- **Reubicar mapa** (PR #177): GPS y Mandados sale del grupo "KPI Despacho a Motoristas" (drivers ya NO ven la pantalla admin) → ahora en **Almacén** (jefe) + tab **🛵 Despacho GPS** en la **Torre de Control** de Kari (DeliveryView).
- **Bajas de drivers**: Josue Leonel Hernandez Cruz (M001 Cafetalón, Jose dijo "tecla") y Herbert Adonay Joachin Lara (S003 Lourdes) → `activo=false`, `es_delivery_driver=false` (salen del bono). Angel Armando → renombrado "Angel Armando Ganuza".
- **Ruta del motorista** (PR #178, decidido con Jose: viaje=varias sucursales · reemplazar carga por reparto · disparador=marcar Despachado): nueva `empleado/MiRutaDespacho.jsx` (menú *🚚 Mi Ruta de Despacho*, key mi-ruta). El reloj arranca con `hora_salida` (cuando bodega marca 'despachado'); `PrepararDespacho` ahora setea `motorista_id`. RPC `mis_despachos_ruta(motorista_id)` lista los despachados asignados; el GPS se comparte solo (tipo='despacho') mientras haya despachos en ruta; por sucursal "Marcar entregado" con **foto de la hoja firmada** → `despacho_confirmar` (recibido + hora_recepcion + foto). El KPI viejo de carga (MiDespacho) queda como "Mi Despacho (KPI viejo)". **PENDIENTE follow-up:** dashboard que agregue el tiempo de reparto (hora_salida→última hora_recepcion) reemplazando `v_despachos_kpi`.

## 8-Ago-2026 — Roadmap almacén/logística #4/#11/#12/#7 (PRs #173, #174)

Cerrados los 4 pendientes del roadmap mientras Jose construye recetas/BOM:
- **#4 Hoja de despacho** (PR #173): RPCs `hoja_despacho(despacho_id)` + `conteo_actual_sucursal(suc, ids[])`. La hoja (imprimir en Preparar y reimprimir en DespachoEnProcesoCard) ahora trae columnas **Conteo actual · Enviado · Stock resultante** (conteo+enviado), agrupada por categoría, landscape. En pantalla cada item muestra conteo suc. + resultante en vivo.
- **#11 "Queda en pedido"** (PR #173): `pedido_items.sin_stock_cm` + RPC `revisar_stock_cm_pedido(pedido_id)`. Al enviar el pedido del conteo (`ConteoNocturno.enviarPedido`), avisa qué productos NO tiene Casa Matriz (quedan en pedido); en `MisPedidosView` el renglón muestra badge "⏳ queda en pedido".
- **#12 Pedido de emergencia** (PR #173): RPC `crear_pedido_emergencia(suc, items, usuario, notas)` **aditivo** (no borra el pedido del día, no exige conteo). Botón 🚨 + modal `PedidoEmergenciaModal` en Mis Pedidos (busca productos, cantidades) → 2do pedido a CM marcado 🚨 + chequeo de stock.
- **#7 GPS motoristas + mandados** (PR #174): nuevo `almacen/DespachoGPS.jsx` (menú *KPI Despacho → 🛵 GPS y Mandados*). Mapa Leaflet en vivo (lee `driver_ubicaciones` + realtime, reutiliza infra GPS del delivery), beacon propio del motorista (`actualizar_ubicacion_driver`/`desconectar_driver`, throttle 4s), y **mandados con bitácora**: tabla `mandados` + RPCs `crear_mandado`/`mandado_estado`/`listar_mandados` (sella GPS inicio/fin, gasto opcional, estados por color). Nota: el mapa muestra TODOS los motoristas online (delivery+despacho comparten `driver_ubicaciones`).

## 8-Ago-2026 — Ciclo menú→receta→sub-receta→MP→DTE + deducción real al cobrar (PR #167)

**Contexto:** Jose quería verificar que el sistema cumple su lógica (cada item del menú del POS se compone de items del conteo/almacén — MP directa, subproductos o porcionados — que se explotan hasta la MP mapeada al DTE de compra; bebidas BEES = descuento 1:1 al vender) y una UI más amigable para trabajarlo. Jose recalcó: **reutilizar lo ya construido, no dejar vistas redundantes.**

**Diagnóstico (verificado en BD):** la lógica era el diseño correcto y el schema lo soportaba al ~80% (`receta_ingredientes.sub_receta_id`, `recetas.tipo` plato_menu/sub_receta/porcionado, `recetas.catalogo_id`, tarjeta PT/Terminados, tabs Recetas/Costeo). El **motor de costo recursivo ya existía y es correcto** (`receta_costo_total` recurre sub_receta→MP→`costo_producto`; `costeo_menu`). PERO el cableado estaba a medias y **una venta NO descontaba inventario**:
- 3 tuberías de deducción, ninguna completa. La del batch (`descontar_inventario_ventas`) colgaba de Quanto (muerto 1-ago). La "nueva" `pos_deducir_inventario` **ya la llamaba el POS al cobrar** (`POSMain.jsx:956`, best-effort, tragaba el error) pero estaba **rota**: referenciaba columnas/tabla inexistentes (`recetas.producto_id`, `receta_ingredientes.ingrediente_id`, `inventario_conteo`, `sucursales.codigo`) y **no recurría** sub-recetas.
- Enlace menú↔receta **inexistente**: 0/493 items con `producto_id`, 0/54 recetas con `catalogo_id`. Solo el viejo `quanto_producto_map`.
- **139 platillos distintos, 0 mapeados.**

**Hecho (PR #167, ancla elegida: plato en catálogo):**
- **`pos_deducir_inventario` reescrita** (2 migraciones): explota la receta **recursivamente por `sub_receta`** hasta MP (misma lógica que `receta_costo_total`, ÷ rendimiento), descuenta vía **`kardex_mover_lote`** (stock+auditoría), **idempotente** por cuenta (chequea kardex_movimientos ref pos_cuenta+venta), `permitir_negativo` para no bloquear el cobro. BEES/bebidas sin receta = descuento directo 1:1.
- **Enlace canónico** por columnas existentes: `pos_menu_items.producto_id → catalogo(producto_terminado) ← recetas.catalogo_id`. RPCs: `mapear_menu_item` (crea/reusa el plato PT y enlaza **los 5 canales a la vez** por nombre), `mapear_menu_item_producto` (BEES), `desmapear_menu_item`, `mapear_menu_auto` (bootstrap por nombre exacto, 24 candidatos), `ficha_menu_item`+`bom_arbol` (árbol técnico), `cobertura_menu`, `mapeo_menu_lista`.
- **UI `MapeoMenu.jsx`**: tab **🍔 Menú (BOM)** en Kardex — lista de platillos con estado/costo/margen/confiabilidad, enlace item-por-item (modal receta o producto BEES), árbol BOM expandible con flag ✔DTE/⚠ por MP, cobertura + auto-enlace. Reusa **CosteoView** en tab 💰 Costeo.

**Combos multi-componente + login teclado (PR #168):** un platillo puede componerse de **varias recetas y/o varias bebidas** (combo = hamburguesa+papas+bebida). Se modela como receta `combo` gestionada (`created_by='menu_builder'`) con ingredientes `sub_receta`+`materia_prima` — reutiliza receta_ingredientes/costo/árbol/deducción, sin tabla nueva. RPCs `menu_item_componentes` (getter prefill) + `set_menu_item_componentes` (1 comp = enlace directo; 2+ = combo). El modal Enlazar es ahora un **constructor de componentes** (agregar recetas+bebidas con cantidad). Fix: `catalogo_productos.categoria` NOT NULL al crear el plato PT. **Side quest:** `LoginScreen` acepta **teclado físico** (dígitos, Backspace, Enter=enviar ya) para cajas en compu.

**⚠️ Riesgo operativo (importante):** mapear un platillo **activa la deducción en vivo** de su venta. Varias sub-recetas de lote tienen el **`rendimiento` mal** (ej. "Mezcla de Carne Smash" → un Combo costeaba $486 porque no dividía entre porciones). Si se mapea una receta así, **una venta descuenta lote entero** (11 lb de carne). Por eso **NADA se mapeó automáticamente**; la UI marca la confiabilidad y Jose mapea item por item corrigiendo rendimiento antes. `npm run build` ✅.

## 8-Ago-2026 — PR #60 mergeado (correo obligatorio) + hallazgo: envío de DTE por correo en CERO

PR #60 (`feat/cobro-correo-cliente-obligatorio`) hace **obligatorio el correo del cliente** al adjuntarlo a un cobro Factura/CCF, para poder auto-enviarle el DTE. Rebaseado sobre `main` (conflicto en `memoria.md` resuelto por unión; `PaymentModal.jsx` auto-merge limpio) y mergeado con OK de Jose.

**Hallazgo al auditar el pipeline (importante):** el envío por correo **NO está funcionando**.
- Infra desplegada: edge function `freakie-dte-email` + pg_cron `freakie-dte-email-sweep` (cada minuto) + Apps Script bajo `freakiedogs@gmail.com`. El sweep solo toma DTE de las últimas 2h con `receptor.correo` no nulo.
- **Agosto: 2,986 DTE sellados, solo 3 con correo de receptor, 0 entregados.** Causa raíz doble: (1) el POS no capturaba el correo (lo arregla #60); (2) aun con correo, la edge function no completa el envío (queda en `pending`, nunca `sent`), y el sweep no reintenta pasadas 2h. **Pendiente: arreglar la entrega** (por qué queda en `pending`).

## 6-Ago-2026 — Manuales de Torre y Drivers

Cierre del bloque de delivery: dos manuales HTML autocontenidos (mobile-first, tema oscuro) en `public/`:
`manual-driver.html` (motoristas: turno, almuerzo, recibir/salir con pedidos, Waze, cobrar/vuelto, entregar con
confirmación, Cobros/conciliación, Historial, Métricas) y `manual-torre.html` (Kari: tablero 4 etapas, cobrar,
asignar con sugerencias ⭐, reasignar, para llevar, mandados, sucursales 3 estados + horarios, bonos/costeo, reporte
diario). Se sirven en `/manual-driver.html` y `/manual-torre.html`. Cada rol solo ve lo suyo. `npm run build` ✅.

## 6-Ago-2026 — Capa de sugerencia de motorista (torre) + turno/almuerzo/bitácora

Bloque grande del roadmap de delivery. Modelo de disponibilidad corregido a **turno abierto** (en_linea, sin
ventana de frescura); `desconectar_driver` ya NO cierra turno (era la causa real de "se desconecta": la app apaga
el GPS al terminar cada ruta). Auto-cierre nocturno (cron 4am). **Almuerzo**: `driver_almorzar`/`driver_fin_almuerzo`
(+ `almuerzo_inicio`, `asistencia.almuerzo_min`), sigue asignable, Kari lo ve "🍽️ almorzando".
**Bitácora** `delivery_asignaciones_log` (cada asignación de Kari con contexto: elegido vs sugerido, carga, candidatos, etc.).
**Sugerencia:** `sugerir_motoristas(sucursal, n)` puntúa por **carga·25 + cercanía·4 + almuerzo·15** y devuelve ranking
con razón; `sugerir_motorista` = top1 (mejora auto la de `torre_listar_pedidos`, que ahora también trae `sugeridos`).
`TabPedidos`: chips de "💡 Sugeridos (tocá para asignar)", #1 destacado ⭐ — cada toque asigna y se registra (loop de
aprendizaje). Roadmap: capturar (hecho) → sugerir (hecho) → asistir/automatizar con la data. `npm run build` ✅.
Ver [[freakie-driver-disponibilidad-turno]].

## 5-Ago-2026 — Delivery Fase 1: desconexión de turno + desglose de bono en Métricas

Primer bloque de las mejoras del flujo delivery (roadmap acordado con Jose).
- **Desconexión al iniciar turno (fix):** el "latido" que mantiene vivo el turno es un `setInterval` cada 5 min
  (`useDisponible` en `DriverBeacon.jsx`); los navegadores móviles lo **congelan en segundo plano** → a los 30 min
  sin señal la central da de baja. Fix: listener `visibilitychange` que re-marca `driver_disponible` al volver a
  primer plano. (El congelamiento intermitente queda por diagnosticar en campo.)
- **Métricas con desglose del bono:** `mis_metricas_driver` ahora devuelve `desglose` por tipo (entregas cerca <umbral,
  largas ≥umbral, fuera de horario, mandados) con cantidad·tarifa=bono; verificado que suma exacto el bono_total. La tab
  Métricas del driver muestra una card por tipo + total → el driver corrobora de dónde sale su bono (incluye fuera-de-hora
  y mandados, que antes no se veían).
- Pendiente Fase 1/2: sonido/notificación al caer pedido, notificar mandados en vivo (hoy solo salen en métricas/historial),
  botón de confirmación al dar Entregado. Roadmap completo en el chat.
- Reporte de órdenes abiertas para WhatsApp: creado RPC `reporte_ordenes_abiertas()` (texto listo). Falta enganchar envío
  diario a Telegram vía @FreakieDogsBot (el envío vive en edge functions/mini, no en la BD). `npm run build` ✅.

## 5-Ago-2026 — Tickets: canal de venta, mesa, método de pago y cambio

Pedido de Jose: que los tickets impresos muestren el **canal de venta** (mesa/llevar/drive/delivery/PeYa), el
**nº de mesa** si es mesa, el **método de pago**, y si es **efectivo el cambio** a entregar.
- **`buildFactura` (`printService.js`):** agrega `Canal: {tipoLabel}` + `Mesa: #{n}` (si hay), y bajo "Pago:"
  imprime `Recibido:` y `CAMBIO` (grande) cuando vienen `recibido`/`cambio`. (Comanda y pre-cuenta ya mostraban canal/mesa.)
- **Cobro:** `PaymentModal` ya calcula el cambio; ahora pasa `efectivo`/`cambio` a `onPrintFactura`, y `POSMain.handlePrintFactura`
  los reenvía a `printFactura` como `recibido`/`cambio` (solo si método=efectivo). El `tipoLabel`/`mesa` ya iban en `buildCuentaPrint`.
- **Reimpresión (`HistorialCobros`):** la consulta ahora trae `pos_cuenta_pagos (metodo, monto_recibido, cambio)`;
  se calcula `metodoPago` (mixto si hay varios pagos) y, si hubo efectivo, `recibido`/`cambio`, y se pasan a `printFactura`.
`npm run build` ✅.

## 5-Ago-2026 — Reimpresión del Historial no ruteaba por caja (Lourdes multi-caja)

En Lourdes, reimprimir una factura desde **Historial de Órdenes** salía en la impresora equivocada.
**Causa:** `HistorialCobros.jsx` → `handleReimprimir` llamaba `printFactura({...})` **sin `caja`**; `imprimir()`
resuelve `caja = opts.caja ?? cuenta.caja ?? null`, y con `caja=null` en sucursal multi-caja agarra cualquier
impresora principal de la sucursal (no la de la caja del cajero). El flujo normal del POS sí pasa `caja`
(`POSMain.jsx:123`, `user.caja`).
**Fix:** pasar `caja: user?.caja || null` en el `printFactura` de la reimpresión → cae en la impresora de la
caja logueada (general → .7, drive → .100). `npm run build` ✅.
Aparte (config física Lourdes): Caja general WiFi `.7`, Meseros WiFi `.8` (gateway debe ser `.1`, quedó en `.101`),
Autoservicio por cable `.100` (única cableada). Ver `pos_impresoras` S003.

## 5-Ago-2026 — Motorista visible en las órdenes de Delivery del POS

Pedido de Jose: en el POS (tab Delivery), cada orden debe mostrar el motorista responsable, para que la caja
sepa a quién reclamarle y poder cerrarla. El motorista vive en `delivery_clientes.motorista_id/repartidor_nombre`;
`torre_asignar_motorista` ya lo guardaba ahí y ya tocaba la `pos_cuenta` ligada (`delivery_motorista_id`).
- **Backend:** nueva columna `pos_cuentas.repartidor_nombre` (text). `torre_asignar_motorista` ahora también
  estampa el nombre en la cuenta POS al asignar/reasignar. Backfill de las cuentas de delivery abiertas desde
  `delivery_clientes.repartidor_nombre`.
- **Frontend `POSHome.jsx`:** el select de `pos_cuentas` trae `repartidor_nombre`; la tarjeta de delivery muestra
  `🛵 {motorista}` (azul) o `🛵 Sin motorista asignado` (ámbar). Se actualiza en vivo por el realtime de pos_cuentas.
`npm run build` ✅.

## 5-Ago-2026 — KPIs de Venta: migrado de Quanto al POS interno (desde 1-ago)

Quanto quedó desfasado. El dashboard **KPIs de Venta** (`KpisVentaDashboard.jsx`) ahora lee del **POS interno**
desde el 1-ago (Quanto solo histórico). `quanto_ordenes` tiene 0 filas en agosto → corte seguro.

- **Vista `v_kpis_venta_canal` reescrita:** rama Quanto cortada en `fecha < '2026-08-01'`; rama POS incluye **todas**
  las sucursales desde el 1-ago (antes excluía S001/S003, que seguían en Quanto). **2 bugs de datos corregidos:**
  (a) `drive_through` no se mapeaba (caía al ELSE); (b) `pedidos_ya`/`delivery_app` se contaban como `para_llevar`.
  Ahora se filtran los 4 canales (mesa, para_llevar, delivery_propio, drivethrough) y se **excluye PeYa/App**
  (decisión de Jose). Verificado: cuadra exacto por canal vs crudo del POS.
- **Nuevos RPC POS** (gateados con `_rol_usuario`): `obtener_ventas_empleado` (atribuye a `coalesce(mesero_id, cajero_id)`
  → nombre de `usuarios_erp`) y `obtener_top_items_venta` (Pareto desde `pos_cuenta_items`, excluye cancelados).
  La tab **Por Empleado** estaba vacía (dependía de `quanto.autorizado_por` por CSV) → ahora funciona.
- **Frontend:** `fetchEmpleados`/`fetchTopItemsPareto` reescritos para usar los RPC (misma forma de salida, se
  borraron los lectores de `quanto_ordenes`/`quanto_orden_items` con chunking). Cabecera: "POS interno (desde 1-ago)".
- El **Resumen/Metas/Tendencia** derivan de la vista → migran solos. `STORES_ACTIVAS` ya tenía las 6 sucursales.
- Verificado (agosto): 6 sucursales (S001 $6.2k, S003 $4.4k incluidas), empleados 30 filas ~$46k, items 331. `npm run build` ✅.
- Límite: Empleados y Top Items quedan POS-only (Quanto no daba empleado; ítems históricos de Quanto fuera de esas 2 tabs).

## 4-Ago-2026 — Meseros pueden comandar "Para Llevar" en el POS

Reporte (Lourdes): a los meseros no les salían los botones de abajo para comandar otros tipos de orden.
**Causa:** no era bug ni config de sucursal — `POSHome.jsx` escondía Para Llevar/Delivery/PedidosYa/Drive Thru
(+ Historial/Cierre) para `MESERO_ROLES=['mesero','mesera']`; al mesero solo le quedaba "Nueva mesa". Aplica a
cualquier mesero (M001, S003, S004), no solo Lourdes; donde entran como cajera sí ven todo.
**Cambio (pedido de Jose):** sacar **Para Llevar** del bloque excluido → ahora meseros ven **Mesas + Para Llevar**.
Delivery/PedidosYa/Drive Thru siguen solo cajero+. `npm run build` ✅.

## 4-Ago-2026 — App del driver: tab 💵 Cobros (conciliación de dinero)

Al entregar, el pedido desaparecía de la vista del motorista (`mis_pedidos_driver` solo trae activos) y el
Historial (`mis_viajes_driver`) solo muestra el bono `Entrega·km·$0.50`, sin cliente ni monto → confusión al
entregar el dinero (pedido de Wendy/Jose).

- **RPC `mis_entregas_driver(p_empleado_id)`**: entregas del motorista del **día** + cualquiera **pendiente de
  cerrar** (cobrado=false) de días previos. Trae cliente, #orden, monto, método, `cobrado`/`cobrado_at`. `cobrado`
  lo marca la caja al cerrar la cuenta (trigger `trg_pos_cobro_delivery` → `fn_pos_cobro_update_delivery`).
- **Nueva tab 💵 Cobros** en `DriverBeacon.jsx`: resumen (efectivo por entregar), lista **⏳ Pendientes de cerrar**
  y **✅ Pagadas hoy**. Cada entrega pasa a ✅ Pagado cuando la cajera cierra la orden. Badge con nº de pendientes.
  Se refresca con el poll de 20s existente.

Así el driver ve lo mismo que la caja por cada entrega y sabe cuáles no ha cuadrado. `npm run build` ✅.
Validar en vivo: que al cerrar la cuenta en caja el pedido pase a ✅ Pagado (depende del flip de `cobrado`).

## 4-Ago-2026 — Pedidos "para llevar" en la torre + estado de sucursal en 3 modos

Entran pedidos por el canal de delivery que en realidad son **para retirar en local**. Antes Kari solo podía
asignar motorista. Ahora:
- **`delivery_clientes.tipo`** nuevo (`'delivery' | 'para_llevar'`, default delivery; los pedidos actuales no cambian).
- **`torre_marcar_para_llevar(p_token, p_delivery_id)`**: pasa el pedido a "En ruta" etiquetado 🥡 (sin motorista ni envío).
- **`fn_pos_cobro_update_delivery`** extendido: al cobrar la cuenta en caja, un `para_llevar` pasa a `entregada` →
  sale del board a históricos. El delivery normal no cambia (lo cierra el motorista).
- **`crear_pedido_delivery`**: el pickup del menú (ya mandaba `tipo:'pickup'`) nace `para_llevar`.
- **`torre_listar_pedidos`** devuelve `tipo`; **TabPedidos**: botón "🥡 Para llevar (retira en local)" en la sección de
  asignar, etiqueta en la tarjeta, y en "En ruta" muestra "🧾 Se cierra al cobrarse en caja" (sin botón Entregado).

**Sucursal en 3 estados** (reusa `activa` + `tiene_delivery`, sin columna nueva): Con delivery / **Solo para llevar** /
Inactiva. RPC `torre_set_modo_sucursal(p_token, p_sucursal_id, p_modo)`; `torre_sucursales_horarios` ahora expone
`activa` e incluye inactivas (para reactivarlas). **TabSucursales**: control segmentado de 3 botones. Caso Venecia (S004):
puede quedar "solo para llevar" si no tiene drivers.

`npm run build` ✅. Backend probado con rollback (para_llevar: tipo/estado/envío OK).

## 3-Ago-2026 — Fix: efectivo/cambio mal capturado en el cobro (rejilla de `step`)

Reporte de Frank (gary rigo): 2 tickets de S001 con **vuelto corto** (total $14.99 dio $4.75 en vez de $5.01; total $4.00 dio $0.75 en vez de $1.00).
- **Causa raíz:** `PaymentModal.jsx` — el input "Efectivo recibido" tenía `step="0.25"` con `min={totalConProp}`. El `min` es el **step-base**, así que la rejilla de valores válidos era `total + 0.25·k` → **nunca** un billete redondo (14.99 → 19.74/19.99, 4.00 → 4.75…). Chrome/Edge **cambian el valor de un `input[type=number]` al hacer scroll/rueda** sobre el campo enfocado → en la tablet ELO un roce bajaba $20.00 → 19.74 y el vuelto (bien calculado sobre ese monto) salía corto ~$0.25.
- **Prueba:** en BD el **100%** de los `monto_recibido` anómalos caía exactamente en `total + 0.25·k`. Concentrado en **S001 (Soyapango)**: 38 casos 28-jul→3-ago, ~$3.39 de menos a clientes. Resto de sucursales: ruido (1-2¢). **Sin impacto fiscal** (DTE/total/IVA correctos; solo el efectivo/cambio).
- **Fix (commit `f97db75`, push directo a main):** input efectivo → `step="any"` y se **quita `min`** (la validación `efectivo >= total` ya existe en `canConfirm`, línea ~68). `onWheel={e => e.currentTarget.blur()}` en los **4** inputs numéricos (efectivo, mixto ef/tarjeta, propina) + `inputMode="decimal"`. `npm run build` ✅.
- **Pendiente/ojo:** requiere **deploy de Vercel + que la tablet de S001 tome el build nuevo** (candado de versión) para verse. Opcional: cuadrar en caja las 38 ventas de S001 (listado disponible por SQL).

## 3-Ago-2026 — Asistencia de motoristas en la tab Bonos

Sobre la tab Bonos (PR #128) se agregó el **récord de asistencia por driver**: hora de llegada/salida,
minutos tarde, y acumulados del mes (días trabajados, horas disponibles, min tarde).
- **Fuente:** los motoristas marcan en la tabla **`asistencia`** (por `usuario_id` = `usuarios_erp.id`),
  NO en `asistencia_diaria`/`asistencia_gps` (esas están vacías para drivers). Campos: `hora_entrada`,
  `hora_salida` (timestamptz), `minutos_tarde`. "Horas disponibles" = jornada entrada→salida.
- **RPC:** `torre_bonos_delivery` ahora también devuelve `asistencia` (entrada/salida en hora SV, min tarde, horas).
- **UI (`TabBonos.jsx`):** resumen por driver (N días · H horas · M min tarde), y en el drill-down cada día
  muestra `🕐 entrada→salida · Nm tarde`. Los días se arman por la **unión** de días con viajes y días con marca.
- `npm run build` ✅. PR aparte desde main.

## 3-Ago-2026 — Candado de versión extendido a los 3 logins (POS + ERP + Driver)

Seguimiento del incidente de abajo: el candado de versión (PR #126) quedaba **solo en el POS**. Se extendió a los **3 logins distintos** que tenemos, cada uno con su propia entrada/deploy:
- **ERP / back-office** → `index.html` → `App.jsx` (`freakie-dogs-caja.vercel.app`).
- **POS** → `pos.html` → `POSApp.jsx` (`freakie-dogs-caja.vercel.app/pos`).
- **Driver PWA** → `driver.html` → `DriverBeacon.jsx` (proyecto Vercel aparte `freakiedelivery.vercel.app/driver`, build `VITE_TARGET=delivery`).

**Refactor:** el hook se movió a `src/hooks/versionGate.js` y se creó `src/components/layout/UpdateGate.jsx` (componente compartido) que envuelve cada login. `emitVersionJson` corre en **ambos** builds (ERP y delivery), así cada origen sirve su propio `/version.json` y el gate compara contra el suyo (fetch relativo). `npm run build` (ERP) y `VITE_TARGET=delivery vite build` ✅.

## 3-Ago-2026 — Metro Centro: ~30 comandas impresas sin guardarse (tablet con build viejo) → candado de versión + log de impresión + blindaje

**Síntoma (Jhon/Jose, lunes 3-ago ~11:45):** en Metro Centro (S006) "las órdenes no llegaban al KDS". La tablet del KDS estaba bien (sucursal correcta, conectada, "Sin órdenes"). En BD: **cero cuentas/ítems/cola de S006 en todo el día** hasta las 11:54, mientras el resto de sucursales vendía normal. **No habían abierto la caja.** Pero además reportaron que **sí les imprimió ~30 tickets** de comanda sin mostrar el aviso "abrí caja" — y esas ~30 **no quedaron registradas en ningún lado** (ni venta, ni ítems, ni DTE).

**Causa raíz:** el código actual bloquea el comandar sin caja (aviso + `return`) e imprime la comanda **solo después** de guardar la orden (`throw` si falla). Que imprimiera sin guardar ⇒ **la tablet corría un bundle VIEJO cacheado** (PWA, `sw.js`), de antes del guardrail. Clásico tablet fija pegada en versión vieja.

**Fixes (rama `fix/pos-version-gate-print-audit`):**
1. **Candado de versión en el login** (`src/pos/versionGate.js` + `LoginGate` en `POSApp.jsx`). Cada build hornea `__BUILD_ID__` (git SHA, vía `vite.config.js` `define`) y publica `dist/version.json` (plugin `emitVersionJson`, servido sin caché). En la pantalla de login la app compara el id que corre vs. el del servidor; si difieren limpia caché+SW y recarga sola ("Actualizando…"). **Solo antes del login** (nunca en medio de un cobro). Fail-open sin internet. Tope anti-bucle (2 recargas).
2. **Log de auditoría de impresión** — tabla `pos_impresion_log` (migración aplicada; RLS: insert anon, select authenticated). `printService.imprimir()` registra TODA impresión (fire-and-forget) con `store_code/caja/tipo/cuenta_id/resumen/ok/modo`. **`cuenta_id` null en una `comanda` = ticket huérfano sin venta** (índice parcial para detectarlo). Ya no quedamos ciegos.
3. **Blindaje del comandar** (`POSMain.jsx`): `if (!currentCuentaId) throw` antes de imprimir → jamás se imprime una comanda si la orden no quedó guardada. Se pasa `cuentaId` al log.

**Nota importante:** de esas ~30 órdenes **no hay rastro reconstruible desde BD** (impresión modo `sistema` = `window.print`, sin log central hasta ahora). Única fuente = **rollo físico** de la impresora / historial de la PC Windows. Pendiente operativo: contar el rollo y decidir re-ingreso + DTE (NO tocar facturación sin OK de Jose). `npm run build` ✅ (version.json = `ed163f9` coincide con id horneado). Falta merge del PR + deploy para que las tablets tomen el candado.

## 3-Ago-2026 — Tab Bonos de la torre: tablero de bonos + costeo de delivery (rediseño)

**Síntoma:** la tab 💰 Bonos del Panel Delivery mostraba "Sin viajes" aunque había **94 viajes en agosto**.
**Causa raíz:** filtraba con `db.from('viajes_delivery').select('*').like('fecha', mes+'%')` y `.like` sobre
columna `date` no funciona en PostgREST → vacío. Además el monto/tiempo vive en `delivery_clientes` (RLS por rol)
y los salarios son confidenciales, así que no se podían leer con rol anon.

**Solución:**
- **RPC gateada `torre_bonos_delivery(p_token uuid, p_mes text)`** (SECURITY DEFINER, valida `_staff_valida`,
  exige rol admin/superadmin/ejecutivo/gerente). Devuelve viajes del mes enriquecidos (km, tiempo real
  recogido→entregado, monto y nº de orden de `delivery_clientes`), drivers activos con paga fija y ventas por
  sucursal. Filtra por rango de fecha (evita el bug del `.like`). Token de staff = `localStorage['freakie_torre_token']`.
- **Nuevo `src/components/delivery/TabBonos.jsx`** (se sacó de `DeliveryView.jsx`): KPIs arriba
  (**Costo de delivery % = (costo fijo + bono viajes) ÷ ventas**, coloreado), **comparación por sucursal**,
  y árbol **sucursal → driver → día → viaje** con km/tiempo/monto. Agrupa las órdenes de un mismo viaje
  **infiriendo por la hora de recogida** (< 180 s = misma salida; verificado: el botón "Salir con todos" de
  la PWA marca todas casi al mismo `recogido_at`). El cálculo de bono por viaje (`bonoDriver`) NO cambió.

**Costeo de salario (confirmado con Jose):** paga fija = `empleados.salario_mensual` (base) + `viatico_mensual`
(bono inicial fijo; ej. 450+250=700, 450+200=650). Prestaciones patronales **ISSS 7.5% (tope base $1000 → máx $75)
+ AFP 8.75%** sobre la base; el viático no cotiza. Tasas **editables en `config_delivery`** (`patronal_isss_pct`,
`patronal_isss_tope`, `patronal_afp_pct`, sembradas con default). Cuentan sólo drivers `activo AND es_delivery_driver
AND cargo='Motorista'` (se excluyen "Motorista Interno"/internos). En el mes corriente el costo fijo se **prorratea**
por días transcurridos. Drivers con sueldo/viático en $0 se marcan en la UI (RRHH los completa; la tab no edita salarios).

**Validado:** RPC end-to-end (13 drivers, 98 viajes ago), aritmética M001 (fija $2650 + ISSS $180 + AFP $210 =
$3040/mes) y `npm run build` ✅. Pendiente futuro si Jose lo quiere exacto: modelo de "ronda" real (id de salida
estampado por el motorista) en vez de inferir por tiempos.

## 3-Ago-2026 — Menú público salía "Lunes: Cerrado" con el panel abierto — horario quemado → en vivo desde BD

**Síntoma (Jose, lunes 3-ago):** el menú público mostraba **"Lunes: Cerrado"** y banner "fuera de horario", aunque en el **Panel Delivery** todas las sucursales tenían el lunes **Abre 11:00–21:00**. NO era problema de zona horaria: el cálculo de hora SV en `MenuPublico.jsx` (`Date.now() - 6h` + `getUTC*`) es correcto.

**Causa raíz:** el menú tenía el horario **quemado** en `catalogoBuho.js` (`NEGOCIO.horarios`, con `lunes: 'Cerrado'` y aperturas 10:00) y **nunca leía la BD**. Dos fuentes de verdad desconectadas: el panel escribe en `horarios_sucursal` (RPC `torre_guardar_horario`), el menú leía un objeto estático.

**Parche rápido (commit f2cdd2c):** fallback alineado a M001 (lunes abierto, 11:00). Destapó el lunes ya.

**Fix de raíz (commit 40e378f):**
- Nueva RPC anon **`menu_publico_horario()`** (SECURITY DEFINER, STABLE, grant a anon/authenticated). Agrega SOLO sucursales `activa AND tiene_delivery` (las que reciben pedidos del menú), calcula en **`America/El_Salvador`** y devuelve `{abierto_ahora, dia, hoy:{apertura,cierre,abierto}, semana[7]}`. `abierto_ahora` = existe alguna tienda con delivery abierta en este instante; `hoy` = ventana más amplia (min apertura / max cierre) entre las abiertas.
- `MenuPublico.jsx`: `horarioHoy(bd)`/`abiertoAhora(bd)` usan la RPC como **fuente primaria** y sólo caen al horario quemado si la BD no responde. `HeaderNegocio` recibe `horarioBD` por prop. Ahora editar horarios en la torre se refleja en el menú **sin redeploy**.

**Datos:** delivery = M001/S001/S002/S003 (todos abren lunes 11:00). S004/S006 tienen `tiene_delivery=false` → no cuentan para el menú. `npm run build` ✅.

**Pendiente/idea:** el menú es un único storefront (horario agregado); si se quisiera horario por zona/sucursal ruteada habría que refinar. El horario quemado quedó sólo como respaldo.

## 2-Ago-2026 — Gráfico de tendencia por sucursal en Ventas Freakies — PR #124

Jose pidió, en el dashboard **Ventas Freakies** (`src/components/dashboard/VentasFreakies.jsx`), un gráfico para ver **el comportamiento de la venta de cada sucursal en el tiempo** como líneas.

**Qué se agregó:** sección "Tendencia de venta por sucursal" (gráfico de líneas SVG, una línea por sucursal, color estable por `store_code`).
- **Aparece solo si el rango es de más de 1 día** (`rangoDias > 1`).
- **Toggle Día / Semana / Mes.** Semana = lunes ISO; Mes = `YYYY-MM`. El botón **Mes se habilita solo con rangos de más de 60 días** (`rangoDias > 60`); si no, cae a Semana.
- Eje X cubre todos los períodos del rango (los sin venta = 0, para ver arranques de sucursales migradas). Puntos con tooltip cuando hay ≤31 buckets.

**Por qué así:** todo se calcula **en el cliente** desde el array `ventas` ya cargado (`dia`/`store`/`venta`); no toca queries, DB ni facturación. SVG sin dependencias nuevas, mismo patrón que `HourArea`. Respeta el ruteo Quanto/POS existente.

**Coordinación:** se detectó que el working tree estaba en la rama de otra sesión (`fix/lourdes-corte-por-cajero`, PR #123); el cambio se reencauzó a rama propia `feat/tendencia-ventas-sucursal` desde `main` para no contaminar ese PR. `npm run build` ✅.

## 2-Ago-2026 — El KDS quedaba bloqueado tras el selector de caja (Lourdes) — PR #125

Efecto colateral del aviso "Caja ya abierta" (PR #123): en Lourdes, para llegar al **KDS** había que pasar por el selector de caja, y el aviso dejaba la cocina bloqueada. El KDS solo lee la cola por `store_code` — no necesita caja ni turno.

**Fix (PR #125):** botón **"👨‍🍳 Solo pantalla de cocina (KDS)"** en el `CajaSelector` que entra directo al KDS sin abrir caja (solo aparece en sucursales con 2+ cajas). Estado `kdsReturn` en `POSApp` para que "← Volver" regrese al selector o a Home según de dónde se entró. No toca cobros. `npm run build` ✅.

**Pendiente/idea de fondo:** pedir la caja solo al cobrar/cerrar (no al entrar) — login → Home directo. Más limpio pero toca el routing de impresora (usa `user.caja`); se dejó para evaluar aparte.

## 2-Ago-2026 — Corte X/Z se enganchaba por caja y no por cajero (bug Lourdes) — PR #123

Wendy reportó que en Lourdes el **Corte X** salía **idéntico** para dos personas (mismas cifras $378.05 / 44 cuentas / fondo $100 / abrió 11:02), cambiando solo el **nombre** del encabezado. Lourdes es **multi-caja** (`general` 🧾 $100 / `drive` 🚗 $20). **No había pérdida de datos**: en `pos_turnos` los dos turnos estaban bien y separados (Jocelyn/general $378.05; Keyri/drive $39.96).

**Causa:** `CierreTurno.loadTurno` resolvía el turno abierto solo por `store_code + caja`, nunca por el cajero logueado. Si dos entraban a la misma caja (Keyri eligió "General" en el selector de login en vez de "Drive"), veían el mismo corte; el nombre salía del usuario logueado. Riesgo: cerrar el turno ajeno.

**Fix (PR #123):**
1. `CierreTurno` filtra el turno por `cajero_id` — prop `ownTurnoOnly` (default `true`, POS). `CorteXZView` pasa `ownTurnoOnly={false}` para que un supervisor siga abriendo el corte de una caja desde el ERP sin romperse.
2. `POSApp/CajaSelector`: al elegir una caja ya abierta por otra persona, avisa con el nombre del dueño antes de entrar.
3. Encabezado del corte muestra el **dueño del turno** + rótulo de caja (🧾 General / 🚗 Drive).

Solo afecta Lourdes (S003, única con 2 cajas). `npm run build` ✅. Rama `fix/lourdes-corte-por-cajero`.

## 1-Ago-2026 — Auditoría: la llave pública ejecutaba SQL arbitrario y leía el certificado de Hacienda

**Lo peor, ya cerrado.** Con la `anon key` (pública, va en el bundle) se podía llamar:
- `exec_sql_batch(sql_text)` → `EXECUTE` del texto recibido **como dueño de la base**.
  Control total: leer, borrar o alterar cualquier cosa. La usaba el cierre de caja
  para un SELECT que nunca funcionó (esa función devuelve `'ok'`, no filas, y la
  tabla `quanto_transacciones` no existe). Código muerto, puerta abierta.
- `dte_get_certificate(business_id)` → la **llave privada del certificado MH**.
  Con eso se firman DTEs a nombre de la empresa.
- 11 funciones `dte_*` más (emitir, tokens, documentos).

Se les quitó el permiso a `anon`/`authenticated`. `service_role` lo conserva
**explícito**, que es como las llama `dte-service` (usa `SUPABASE_SERVICE_ROLE_KEY`,
verificado en su código). La facturación no cambia.

⚠️ **Error propio:** al revocar de `PUBLIC` también se le quitó a `service_role`, que
heredaba el permiso de ahí (las funciones nacen con `GRANT EXECUTE TO PUBLIC`). La
facturación quedó caída ~1 min hasta el grant explícito. **Al revocar de PUBLIC,
siempre re-otorgar a service_role en la misma migración.**

**Lo que sigue abierto** (advisor de Supabase, 744 hallazgos):
- 2 ERROR: 5 tablas sin RLS (`banco_reglas`, `planilla_validacion`,
  `planilla_valid_override`, `soporte_kb`, un backup) y 25 vistas `SECURITY DEFINER`
  (planilla, banco, ventas) que ignoran el RLS de quien consulta.
- 193 políticas `USING (true)` sobre 147 tablas → RLS anulado de hecho. `anon` con
  ALL sobre bancos, planilla, POS; DELETE sobre `pagos_proveedor`.
- ~190 funciones `SECURITY DEFINER` llamables por `anon` sin login.
- `public/dashboard-ejecutivo.html` y `dashboard-operativo.html` se publican tal cual
  y consultan `ventas_diarias` con la llave pública **sin ningún login**. Quedaron
  fuera del build del dominio público; en el del ERP siguen accesibles.


## 1-Ago-2026 — Los PINs salen del navegador; administrarlos ahora deja rastro

**Qué pasaba.** Con la llave pública (`anon`, que va en el bundle y por lo tanto
es visible para cualquiera) se podía leer la columna `pin` de `usuarios_erp`
completa, incluidos los de admin, sin haber entrado a ningún lado. Además había
PINs reales escritos en el código fuente (`EDIT_PINS` en Planilla, Recetas y
Finanzas) y por lo tanto guardados en git.

**Qué se hizo** (PR #88, sobre lo que ya traía #87):
- `usuarios_erp`: permiso **por columna**. La columna `pin` no se puede leer;
  el resto (nombre, rol, sucursal) sí, para no romper las siete pantallas que
  arman listas de personal. Sin INSERT/UPDATE/DELETE desde el navegador.
- `erp_login` y `erp_buscar_por_pin` con freno anti-fuerza bruta: 0.4 s por
  intento fallido (10.000 combinaciones ≈ 1 h) y bloqueo a los 25 fallos en
  10 min. Tabla `login_intentos`.
- Administración de PINs por sesión, no por PIN: `erp_admin_sesion` devuelve un
  token de 30 min (vive solo en memoria, no en localStorage). `erp_pin_revelar`
  destapa **un** PIN a la vez y lo anota en `usuarios_pin_bitacora` (quién vio
  el de quién y cuándo); en pantalla se vuelve a tapar a los 20 s.
- El campo "nuevo PIN" al editar arranca vacío = no se toca. Antes cargaba el
  PIN enmascarado y guardar tras editar solo el nombre le habría grabado
  `••••` a esa persona, dejándola sin poder entrar. No alcanzó a pasarle a
  nadie porque la pantalla ya estaba caída, pero el servidor ahora además
  rechaza cualquier PIN que no sean 4-6 dígitos.
- `EDIT_PINS` fuera: quién aprueba planillas o edita recetas va por **rol**.
- Los KPIs de venta identificaban a la persona por su PIN solo para averiguar
  su rol; ahora por su `id`, que no es secreto.

**Lo que sigue abierto.** La misma llave pública todavía abre ~24 tablas
sensibles sin login: planillas (1206 registros de salarios), `bank_*` (5120
movimientos), `pagos_proveedor` (con DELETE), `empleados` (con UPDATE),
`pos_cuentas` (8973 ventas). Poner el menú público en otra URL **no** arregla
esto: la llave es la misma y ya está en internet. El camino es exigir sesión de
staff reusando `staff_sesiones`, cerrando por capas y verificando qué pantalla
depende de cada tabla antes de tocarla.


## 2026-08-01 — Stress test 1000 secuenciales + 200 concurrentes: el flujo aguanta
- **1000 secuenciales** (dentro de transacción con rollback, producción no ve nada): **1000/1000** creados, comandados, al KDS, a lista, entregados y con viaje registrado. **0 errores, 0 inconsistencias** de total/envío/bono, 0 números de orden duplicados. 12.1 ms promedio, **peor caso 155 ms**, ~83 pedidos/seg. (475 con envío gratis, 125 con envío a confirmar, 800 ruteados solos.)
- **100 concurrentes reales** (curl paralelo contra PostgREST como el menú público, conexiones independientes): **100/100 ok**, 0 errores, **0 números de orden duplicados**, 1.07 s (~93 req/s).
- **100 concurrentes con el MISMO teléfono** (peor caso de contención — todos golpean el mismo registro del CRM): **100/100 ok**, 0 errores, y el CRM quedó con **1 sola fila con `total_pedidos = 100` exacto** ⇒ el `on conflict do update ... total_pedidos + 1` **no pierde actualizaciones** bajo concurrencia. 1.41 s.
- **Los concurrentes SÍ commitean** (no hay rollback posible con conexiones separadas): se crearon 200 pedidos `ZZQA-*` en estado `recibida` que **no tocan KDS ni POS** (no se comandan) y se borraron enseguida. Verificado después: 0 cuentas POS huérfanas; las cuentas nuevas del período son tráfico real de M001/S003/S001 (sin referencia `WEB-`).
- **UX corregida antes del test** (PR #62): el carrito ahora avisa *"te faltan $X para el pedido mínimo"* y bloquea el botón con el motivo, en vez de rechazar recién al confirmar (era el 28% de rechazos de la primera ronda).
- **Conclusión:** el flujo aguanta carga y concurrencia sin corrupción de datos. El cuello de botella no apareció a este volumen.

## 2026-07-31 — Stress test 500 órdenes + 3 puntos ciegos corregidos
- **Método:** 500 pedidos por el flujo completo (crear→comandar→KDS→lista→asignar→recoger→entregar→viaje) dentro de un `DO $$` que termina en `RAISE` ⇒ **rollback total**. Producción nunca ve los datos (aislamiento de transacción: sin commit no hay Realtime, ni KDS, ni cuentas POS) y **el DTE no se toca** (la emisión ocurre al cobrar en el POS, paso que el test no ejecuta). Verificado con baseline antes/después: 8 pedidos / 0 viajes / 389 cuentas, idénticos. Los resultados salen en el mensaje de la excepción.
- **Ronda 1 (500):** 358 creados, 142 rechazados por mínimo, 297 ruteados, 0 errores de flujo, 0 inconsistencias de total/envío/bono, 0 números de orden duplicados. 9 ms por pedido.
- **PUNTOS CIEGOS ENCONTRADOS (3, corregidos en `fix_puntos_ciegos_pedidos`):**
  1. 🔴 **Envío mal cobrado sin distancia**: fuera de cobertura o sin GPS, `coalesce(dist,0)` caía en el tramo más barato ⇒ un cliente en Honduras pagaba **$0.50**. Ahora `calcular_costo_envio` con `p_distancia_km IS NULL` cobra el **tramo más alto** y devuelve `estimado:false`; el checkout avisa "te confirmamos el monto por WhatsApp".
  2. 🔴 **Sin tope de cantidad**: se aceptó un pedido de 999.999 unidades (**$11.9 M**). Ahora **máx 50 por línea** con mensaje que deriva a WhatsApp.
  3. 🔴 **Teléfono podía quedar vacío**: `regexp_replace` dejaba `''` con entrada basura ⇒ Karina sin forma de contactar. Ahora exige **≥8 dígitos**.
- **Defensas que YA funcionaban (confirmadas):** ítem oculto del menú público → rechazado; ítem de otro canal → rechazado; **modificador ajeno no suma precio** (anti-manipulación); doble comanda → 1 sola cuenta; motorista ajeno no puede entregar; doble entrega → 1 solo viaje (sin doble bono).
- **Ronda 2 (500, tras los fixes):** **500/500** creados, comandados, al KDS, a lista, entregados y con viaje registrado. 0 errores, **0 inconsistencias**, 0 duplicados, 237 envíos gratis, 63 con envío a confirmar. 11.6 ms por pedido (~86 pedidos/seg).
- **Pendiente detectado, no bloqueante:** el menú deja armar un carrito bajo el mínimo y solo avisa al confirmar (28% de rechazos en la ronda 1) — conviene avisar en el carrito, no al final.

## 2026-07-31 — Costo de envío por distancia (parametrizable) + subir fotos del menú desde el ERP
- **Costo de envío** (migraciones `delivery_costo_envio_tramos`, `crear_pedido_con_costo_envio`, `torre_config_envio_admin`). Reglas de Jose: **pedido mínimo $3.98**, **gratis desde $20**, y por distancia **<2 km $0.50 · 2–5 km $1.00 · 5–7 km $2.00 · >7 km $3.00**. Tabla `config_envio_tramos` (km_hasta NULL = último tramo) + params `envio_gratis_desde` / `pedido_minimo` en `config_delivery`. RPC `calcular_costo_envio(km, subtotal)`. `crear_pedido_delivery` ahora calcula el envío real por la distancia a la sucursal ruteada, lo guarda en `costo_envio`, suma al `total` y **rechaza pedidos bajo el mínimo**. Probado: 0.1 km→$0.50, tramos ok, gratis ≥$20, mínimo rechazado.
- **Checkout del cliente:** muestra "Envío · X km" con el costo real (o **¡GRATIS!**) y el aviso *"Agregá $N más y el envío te sale gratis"*. El total del botón ya incluye envío.
- **Torre → ⚙️ Parámetros:** sección nueva **🛵 Costo de envío al cliente** — edita pedido mínimo, envío-gratis-desde y los **tramos** (agregar/quitar/editar km y costo). Solo admin/superadmin/ejecutivo (validado server-side).
- **Subir fotos desde el ERP** (Menú → Ítems → editar): botón **📷 Subir foto** + preview. La imagen se **comprime en el navegador** (canvas, 900 px, JPEG 0.74) → sube ~150 KB en vez de los 3-5 MB del celular.
- ⚠️ **Decisión de seguridad:** la carga NO usa la anon key (dejaría el bucket escribible por cualquiera, la key es pública). Va por la **edge function `menu-foto`** (`verify_jwt=false`, auth propia): valida el **token de sesión de staff** + rol, tipo y tamaño, y escribe con `service_role`. Si no hay sesión, el componente pide el PIN inline. El bucket `menu` sigue con **solo lectura pública**.

## 2026-07-30 — Menú público: visibilidad por ítem + coleccionables del menú en el juego
- **Problema:** el menú del POS `delivery_propio` (79 ítems) incluye cosas que NO son vendibles al cliente: add-ons, toppings sueltos, merch e internos.
- **Análisis:** comparé contra el catálogo BuhoPay (31 coinciden, 48 no). ⚠️ **El criterio "no estaba en Buho" NO alcanza**: ahí caen bebidas, cervezas y combos que sí son vendibles. El criterio correcto es la **naturaleza del ítem** (categoría + nombre).
- **Migración `menu_visible_publico`:** columna `pos_menu_items.visible_publico bool default true` (**solo se usa en el canal delivery_propio**); `menu_publico_delivery()` filtra por ella. Ocultos por defecto **19**: agrandados/cambio de bebida (4), toppings sueltos (8), merch (6) y `Soda Empleados`. Quedan **60 visibles** (bebidas y cervezas incluidas). Los ocultos **siguen disponibles en el POS**.
- **Admin** (`MenuAdminView` → tab Ítems): botón **🌐 En menú público / 🚫 Oculto al público** por tarjeta + checkbox en el form. **Solo aparece si el menú es `delivery_propio`** (se pasa `canal` desde el selector); en otros canales ni se muestra ni se escribe la columna.
- **Juego:** coleccionables con **fotos reales del menú** (sprites ~4 KB en `menu/sprites/`) que dan +25 pts. ⚠️ **Recalibré el anti-trampa** (`juego_recalibrar_antitrampa`): con los coleccionables el ritmo real sube a ~25 pts/s y el umbral viejo (15) **marcaba legítimos como sospechosos**; ahora 40 pts/s (99999 en 3s sigue cayendo).
- ⚠️ **Coordinación:** este commit nació por error sobre la rama ajena `feat/apk-v1.2-nocache` (otra sesión). Se movió a rama propia desde `main` con cherry-pick y **se restauró la rama ajena a su estado remoto** — nunca se pusheó contaminada. Recordatorio: verificar `git status -sb` antes de commitear cuando hay varias sesiones en el repo.

## 2026-07-30 — Fix: alta de clientes desde el POS fallaba (check constraint) — Metro Freakies en vivo
- **Síntoma:** en Metro Freakies, al "Crear y seleccionar" cliente para factura: `Error al crear cliente: new row for relation "pos_clientes" violates check constraint "pos_clientes_tipo_cliente_check"`.
- **Causa raíz (2 bugs en `src/pos/cajero/CustomerSearch.jsx`):**
  1. Línea 78 mandaba `tipo_cliente: tipoDte` → el **tipo de DTE** (`'ccf'`/`'factura'`/`'se'`) en una columna que es **clasificación CRM** (CHECK: `regular/frecuente/vip/corporativo/evento`). Este era el error visible.
  2. `tipo_documento` se guarda como **etiqueta** (`'NIT'`, `'DUI'`, `'Pasaporte'`, `'Carnet de residente'`, `'Otro'`) — que es justo lo que `PaymentModal.DOC_MH` espera para mapear al código MH (13/36/03/02/37) al emitir el DTE — pero el CHECK viejo solo aceptaba **minúsculas** (`nit/dui/pasaporte/otro`). Bug latente que saltaba apenas se arreglara el #1.
- **Nota:** los 49 clientes existentes vinieron de un import (12-abr) con `tipo_documento` NULL, por eso este alta desde el POS nunca había funcionado con documento.
- **Fix DB (inmediato, sin deploy — migración `fix_pos_clientes_alta_pos`):**
  - Amplié `pos_clientes_tipo_documento_check` para aceptar las **etiquetas** que usa la app (NULL sigue válido).
  - Agregué trigger `pos_clientes_sanitize_biu` (BEFORE INSERT/UPDATE): si `tipo_cliente` no es una clasificación válida → lo normaliza a `'regular'`. Desbloqueó la caja en vivo **al instante** y queda como red de seguridad. Probado con insert simulado (rollback): pasó constraints, coerció `'ccf'`→`'regular'`.
- **Fix código (PR, para deploy):** `CustomerSearch.jsx:78` `tipo_cliente: 'regular'` (ya no `tipoDte`). Branch `fix/pos-clientes-tipo-cliente`.
- **Por qué se amplió el CHECK en vez de pasar el código a minúsculas:** `PaymentModal.DOC_MH` (línea 25) mapea por etiqueta; tocar eso movería la ruta fiscal del DTE. Ampliar el CHECK mantiene el contrato existente CustomerSearch→DB→PaymentModal→DTE sin riesgo fiscal.

## 2026-07-30 — Quitado el guardrail 50% de `v_data_disponible_resumen` (pedido de Jose)
- **Síntoma:** Jose subió el Quanto de **Lourdes (S003)** hasta 07-29 pero la card "📅 Última data" seguía diciendo **Quanto 07-26**, y el **KPI Ventas Totales · BEP** cortaba todo al 26. Sospecha de "algo se rompió con los arreglos del dashboard".
- **Diagnóstico (NO era bug ni Lourdes faltando):** el dato de Lourdes está 100% absorbido en todas las fuentes (`quanto_ordenes`, `mv_finanzas_ventas_mensual` $36,398/29d, `v_quanto_ordenes_diario`, `fn_ventas_comparativo_igualado`); el P&L Estado de Resultados ya lo incluye. El 07-26 lo ponía la heurística de "día completo ≥ 50% del baseline de 7d" en `v_data_disponible_resumen`: los días 27/28/29 **solo tenían Quanto de Lourdes** (~50 órdenes vs baseline ~600 de las 6 tiendas) → los marcaba incompletos. La causa real es que **M001(21) / S002(23) / S004(25) / S001(26) están atrasadas subiendo su Quanto**, no Lourdes.
- **Decisión de Jose:** rechazó el fix "corte por-tienda" (más correcto pero invasivo); pidió simplemente **quitar el guardrail** para que la card diga 07-29.
- **Cambio (migración `corte_data_disponible_sin_guardrail_50pct`):** `v_data_disponible_resumen` ahora reporta `quanto_hasta`/`peya_hasta` = **último día con data (raw max)**, sin filtro de completitud. Resultado: quanto_hasta 07-29, data_completa_hasta 07-29, dia_corte 29. GRANTs anon/authenticated intactos (fue CREATE OR REPLACE, no DROP → lectura en vivo, sin deploy).
- **⚠️ Efecto colateral avisado a Jose:** como el corte global pasó a 07-29 y las 4 tiendas atrasadas no tienen data 22-29, en el KPI/comparativo esas sucursales salen **planas/bajas** esos días y su % se ve peor de lo real hasta que suban su Quanto (se corrige solo). Alternativas si molesta: revertir, o marcar días parciales.
- **Reversión:** la def vieja usaba CTEs `quanto_por_dia`/`quanto_baseline` (avg 7d) + `peya_por_dia`/`peya_baseline` con `WHERE n >= COALESCE(avg_7d,0)*0.5`. Restaurar esa def vuelve al corte con guardrail.
- **Pendiente natural:** subir el Quanto de M001/S002/S004/S001 hasta el 29 para que el corte quede parejo entre tiendas.

## 2026-07-30 — Delivery Fase 7: juego HotDog Dash + leaderboard en la pantalla de espera
- **Backend** (migración `juego_scores_leaderboard`): tabla `juego_scores` (juego, alias, score, duracion_seg, fecha SV, tracking_token, `sospechoso`, `premiado`), RLS on sin policies (solo por RPC). `juego_guardar_score(alias, score, dur, juego, tracking_token)` y `juego_leaderboard(juego, limite)` → `{dia, mes}` con la **mejor marca por alias**.
- **Anti-trampa (probado):** ritmo plausible (`score > dur*15+50` ⇒ `sospechoso=true`), tope 40 partidas/hora por alias, alias sanitizado (regex, 20 chars) y obligatorio, `score` con CHECK 0..1M. **Las marcas sospechosas NO entran al leaderboard** (se guardan para revisión). El premio se valida a mano antes de entregarlo — el score sale del navegador, no hay forma barata de hacerlo infalsificable.
- ⚠️ Índice `to_char(fecha,'YYYY-MM')` **rechazado por Postgres** (no IMMUTABLE); alcanza con `(juego, fecha, score desc)`.
- **Frontend:** `src/tracking/Juego.jsx` (shell: jugar, guardar marca, leaderboard Hoy/Mes, botón **📲 Publicá tu marca** con Web Share API + fallback a portapapeles) y `src/tracking/juegos/HotDogDash.jsx` (**Canvas puro, sin librerías**): hot dog dibujado a mano (pan, salchicha, zigzag de mostaza, patitas animadas), tema **carnaval** (gradiente feria, banderines, luces parpadeantes, carpa, piso a rayas), obstáculos cono/botella, salto por tap/click/espacio, velocidad progresiva, chispas al chocar.
- **Extensible:** `src/tracking/juegos/index.js` es un **registro** — para sumar Flappy Dog se crea el componente con la misma interfaz (`{onScore, onGameOver}`) y se agrega al array; el leaderboard ya separa por `juego`.
- Ambos van en **chunks lazy** (HotDogDash 4.7 KB, Juego 4.1 KB): no se descargan hasta que el cliente toca "Jugar". El juego se oculta cuando el pedido está `entregada`.

## 2026-07-30 — Delivery Fase 6: tracking del cliente + mapa en vivo
- **Backend** (migraciones `delivery_fase6_tracking_cliente` + `tracking_pedido_fix_record`): col `delivery_clientes.tracking_token uuid` (default random, índice único) = link no adivinable. RPC **`tracking_pedido(token)`** (grant anon) devuelve SOLO lo mínimo: estado, número, total, ítems (nombre+cantidad), dirección, sucursal, **primer nombre** del motorista y ETA (4 min/km + 5 base).
- **Privacidad (probado):** la ubicación del motorista se expone **únicamente** si `estado='en_camino'` Y la señal es fresca (<5 min) — en `recibida`/`lista` devuelve NULL aunque el driver esté emitiendo. No expone teléfono ni nombre completo del cliente; token inválido → `no_encontrado`.
- ⚠️ **Bug corregido en el camino:** la 1ª versión usaba un `record` (`v_drv`) que en plpgsql **no se puede leer si nunca se asignó** → reventaba justo en el caso "pedido no en camino". Ahora usa variables escalares. (Recordatorio: nunca acceder a un `record` no asignado.)
- **Frontend:** nuevo 5º entry Vite `track.html` → `src/tracking/` (ruta **`/track?t=<token>`**). `TrackingPedido.jsx`: hero con el estado actual, línea de tiempo (recibido→cocina→listo→en camino→entregado), resumen del pedido, refresh cada 15s. `MapaEnVivo.jsx` (**chunk lazy**, solo carga en camino): Leaflet+OSM con 🛵 motorista, 🏠 destino y línea punteada entre ambos. CSS propio `tracking.css` (claro, marca Freakie).
- **Torre:** el botón 💬 WhatsApp ahora manda el **link de tracking** cuando el pedido ya está pagado (si sigue en `recibida`, manda el mensaje de cobro). `torre_listar_pedidos` ahora incluye `tracking_token`.
- **Pendiente Fase 7:** el juego HotDog Dash + leaderboard va en esta misma pantalla de espera.

## 2026-07-30 — Delivery Fase 5 (driver entrega) + menú admin de parámetros de bonos
- **Fase 5 backend** (migraciones `delivery_fase5_driver_entrega` + `delivery_fase5_liquidacion`): cols nuevas en `delivery_clientes` (`recogido_at`, `entregado_at`, `liquidado_at`, `viaje_id`→viajes_delivery). RPCs (grant anon, validan que el pedido esté asignado a ese motorista): `mis_pedidos_driver(empleado_id)`, `driver_marcar_recogido` (→`en_camino`), `driver_marcar_entregado(empleado_id, pedido, metodo)` → estado `entregada` + **registra el viaje solo** (distancia haversine sucursal→cliente, `es_fuera_de_horario` si hora SV ≥21 o <6) + suma al bono; **idempotente** (si ya tiene `viaje_id` no duplica). Probado end-to-end: recoger→entregar→1.43 km→bono $0.50→métricas del driver actualizadas.
- **Liquidación SIN tocar cobro/DTE:** al entregar se anota en `pos_cuentas.notas_internas` "Entregado por X · cobró Y" para que la cajera lo vea; la cuenta se cobra por el **flujo normal del POS** (que ya emite DTE). `torre_pendientes_liquidar(token)` lista entregados cuya cuenta POS aún no está `cobrada`.
- **PWA driver** (`DriverBeacon.jsx` reescrito): tab **📦 Pedidos** (asignados, botón Llamar / Cómo llegar→Google Maps, "Ya lo recogí", y al entregar elegir método cobrado) + Historial + Métricas. **GPS automático solo durante entrega activa**: se prende al recoger y se apaga al entregar el último pedido ⇒ el GPS corre minutos por entrega, no todo el turno (era la preocupación de batería de Jose). Beacon extraído a hook `useBeacon`.
- **Menú admin de bonos** (pedido de Jose): migración `torre_config_delivery_admin` → `torre_config_delivery(token)` y `torre_guardar_config_delivery(token, valores)` (**solo admin/superadmin/ejecutivo**; valida parámetros conocidos y rango 0–1000). Nuevo tab **⚙️ Parámetros** (`TabParametros.jsx`): edita las 5 tarifas (`tarifa_entrega_normal/larga`, `km_umbral_doble`, `tarifa_fuera_horario`, `tarifa_mandado`) con ejemplo en vivo. Usa el mismo token de sesión de 📥 Pedidos.
- **Drift residual arreglado:** `TabBonos` también pedía `bonos_delivery_mensual → empleados(nombre,...)` → ahora `nombre_completo`.
- **Pendiente:** Telegram para mandados (falta `chat_id` del grupo; el bot es **@freakiedeliverybot**, modo privacidad ON ⇒ mandar `/start@freakiedeliverybot` o desactivar privacy en BotFather). ⚠️ **El token del bot pasó por el chat: regenerarlo con `/revoke`** y guardarlo como secret de la edge, nunca en git. Falta también: tracking del cliente + juego (Fases 6-7), fotos del menú, costo de envío.

## 2026-07-30 — Delivery Fase 8 MERGEADA a main + limpieza de tabs viejas
- **Merge:** PR #38 (14 commits) → **main** (`a3f80c9`). Sale a producción: `/menu` público (menú vivo del POS), `/driver` (beacon motorista), torre con 📥 Pedidos + 🗺️ Cobertura. Las migraciones ya estaban aplicadas en prod, así que el merge **reconcilia el frontend con la DB** (el menú viejo de main ni guardaba: su estado `'pendiente'` violaba el CHECK).
- **Usuarios de prueba borrados** (los 5 `TEST` con PIN 4701xx–4705xx) — no quedan logins de prueba en prod.
- **Tabs viejas eliminadas** (pedido de Jose): `TabDespacho` + `PedidoCard` + `TabViajes` (~346 líneas). Estaban **rotas de raíz**: Despacho usaba columnas inexistentes (`empleado_id`, `direccion`, `zona`), estados que violan el CHECK (`pendiente/asignado`) y ya no podía leer `delivery_clientes` (cerramos SELECT anon); Viajes leía `empleados.nombre` (es `nombre_completo`) → lista vacía. **0 filas** en `viajes_delivery`/`bonos_delivery_mensual` ⇒ nadie las usaba, borrado sin pérdida. Torre queda: **📥 Pedidos · 💰 Bonos · 🗺️ Cobertura**.
- **Arreglado de paso:** `TabBonos` tenía el mismo drift (`select id,nombre,cargo`) → ahora `nombre:nombre_completo` (alias), así los bonos sí listan motoristas.
- **Hueco abierto:** ya no hay UI para registrar viajes de **entrega** a mano (los mandados sí, desde 📦 Mandado en Pedidos). Se cubre en **Fase 5**: cuando el driver marque "entregado" el viaje se registra solo y alimenta el bono.

## 2026-07-29 — Driver PWA: historial + métricas + mandados (falta el disparo por Telegram)
- **Pedido de Jose:** en la PWA del driver, historial de viajes + métricas (viajes/km/$bono); y poder asignar **mandados** (cuentan como viaje para el bono), idealmente por mensaje de Telegram en un grupo de drivers.
- **Backend** (migración `driver_historial_metricas_mandados` + `torre_asignar_mandado_sucursal`): `_tarifa_viaje(tipo,dist,fuera)` (misma lógica que DeliveryView.calcTarifa, desde `config_delivery`: mandado/normal $0.50, ≥17km $1.00, fuera horario $3.00). `mis_viajes_driver(empleado_id,mes?)`, `mis_metricas_driver(...)` (viajes/km/bono/desglose) — grant anon (el driver se identifica por empleado_id; baja sensibilidad, gate por PIN en Fase 5). `torre_asignar_mandado(token, empleado_id, sucursal_id, desc, dist?, fuera?)` inserta `viajes_delivery` tipo='mandado' (⚠️ `viajes_delivery.sucursal_id` es NOT NULL → sucursal obligatoria; `pos_cuentas.delivery_motorista_id`→usuarios_erp ya mapeado en Fase 4). Probado: 2 mandados → bono $3.50.
- **Frontend PWA** (`DriverBeacon.jsx` reescrito): shell con nav inferior — 📡 Compartir (el beacon), 🧾 Historial (lista de viajes con su tarifa), 📊 Métricas (KPIs del mes: viajes, km, bono, mandados). Identidad por localStorage (el nombre que ya elige).
- **Torre** (`TabPedidos`): botón **📦 Mandado** → form (motorista, sucursal, descripción, km, fuera-horario) → `torre_asignar_mandado`. Es el stopgap manual mientras se monta el disparo por Telegram.
- **PENDIENTE — mandado por Telegram:** requiere el bot compartido (@PasqualeRestBot, edge `aprobaciones`/`egresos-aprobaciones`) + chat del grupo de drivers + mapeo driver↔telegram. Es **coordinación-sensible** (un solo bot, lo maneja otra sesión per `_COORDINACION_AI.md`). Falta: token del bot, chat_id del grupo, y decidir formato del comando. Backend (`torre_asignar_mandado`) ya sirve como el "ejecutor" que la edge de Telegram llamaría.

## 2026-07-29 — Delivery Fase 4: cocina listo → asignación de motorista (Karina aprueba)
- **Migración `delivery_fase4_asignacion_motorista`:** col `delivery_clientes.motorista_id` (→empleados). Trigger `fn_delivery_sync_lista` en `pos_cuentas` (AFTER UPDATE OF estado): cuando el KDS marca la cuenta `lista` (KDSScreen línea ~380 setea `pos_cuentas.estado='lista'`), el pedido delivery pasa a `lista`. `sugerir_motorista(sucursal)` = motorista más cercano EN LÍNEA (haversine sobre `driver_ubicaciones`, ≤10 min). `drivers_en_linea()` para el dropdown. `torre_asignar_motorista(token,pedido,motorista)` asigna/cambia.
- **Ojo FK:** `pos_cuentas.delivery_motorista_id` referencia **`usuarios_erp`** (no empleados). Mapeo empleado→usuario (`usuarios_erp.empleado_id`) al sincronizar; si el motorista no tiene cuenta de usuario, ese campo queda null (la asignación real vive en `delivery_clientes.motorista_id`).
- **Torre (`TabPedidos`):** para pedidos `lista` muestra el motorista sugerido + dropdown de en-línea + botón Asignar/Cambiar. `torre_listar_pedidos` ahora trae `motorista_id/nombre` y `motorista_sugerido`.
- Probado end-to-end en SQL (confirmar→cocina lista→sugiere 0.16km→asigna). Build OK.

## 2026-07-29 — Delivery Fase 0-B (enfoque seguro): torre de Karina + confirmar pago + cierre PII
- **Decisión clave:** NO migré todo el ERP a `authenticated` (riesgo altísimo — muchas tablas tienen solo policies anon; flipear el rol global rompería pantallas del POS en vivo). En su lugar: **sesión de staff con token** verificada server-side por RPC. Cierra la fuga principal de PII y habilita "confirmar pago" **sin tocar el login del resto del ERP**.
- **Backend** (migración `torre_staff_sesion_y_cierre_pii`): tabla `staff_sesiones` (token 12h). `staff_login(pin)` verifica `usuarios_erp` (pin+activo) y que el `rol ∈ {despachador,admin,superadmin,ejecutivo,gerente}` → emite token. `_staff_valida(token)` interno. `torre_listar_pedidos(token)` devuelve los pedidos activos (recibida/preparando/lista/en_camino) con ruteo sugerido. `torre_confirmar_pago(token, id, sucursal?, metodo)` valida token → setea sucursal/método → estado `preparando` → `_comanda_delivery` (a cocina). Todas SECURITY DEFINER, grant anon (se auto-verifican por token). **DROP de la policy `auto_anon_select_delivery_clientes`** ⇒ anon ya NO lee la tabla (fuga de nombre/tel/dirección **cerrada**). Solo la leía `DeliveryView` (tab rota); la torre ahora lee por RPC.
- **Frontend:** `src/components/delivery/TabPedidos.jsx` — nuevo **1er tab 📥 Pedidos** de la torre. Login por PIN (token en localStorage), lista de pedidos con auto-refresh 20s, botón **💬 WhatsApp** (`wa.me/503…` con mensaje pre-armado — MVP mientras se monta Cloud API) y **✅ Confirmar pago → cocina** (usa sucursal asignada o la sugerida por ubicación; avisa si fuera de cobertura). Probado end-to-end en SQL (login admin real → listar → confirmar → comanda; token inválido rechazado). Build OK.
- **Pendiente:** `driver_ubicaciones` sigue con SELECT anon (Realtime lo necesita; baja sensibilidad) — lockdown fino después. La emisión automática de WhatsApp (Cloud API, verificación Meta) sigue pendiente. Reconstrucción de las tabs viejas de `DeliveryView` (despacho/viajes con drift) aparte.

## 2026-07-29 — Delivery: drivers en vivo en el mapa de la torre + beacon del motorista
- **Pedido de Jose:** en el mismo mapa de cobertura, ver la ubicación real de los drivers.
- **Backend** (migración `driver_ubicaciones_realtime`): tabla `driver_ubicaciones` (empleado_id PK, lat/lng/rumbo/exactitud, en_linea, updated_at) con **Realtime** (agregada a `supabase_realtime`, replica identity full, policy SELECT anon). RPCs SECURITY DEFINER: `actualizar_ubicacion_driver(...)` (upsert, anon), `desconectar_driver(id)`, `drivers_disponibles()` (lista motoristas por cargo). Ojo: `empleados` usa `nombre_completo` (no `nombre` — DeliveryView vuelve a estar roto por eso).
- **Torre** (`TabCobertura.jsx`): marcadores 🛵 de drivers en vivo vía suscripción Realtime a `driver_ubicaciones`; se actualizan solos, caen del mapa a los 5 min sin señal; contador "N en línea".
- **Beacon del motorista** (nuevo 4º entry Vite `driver.html` → `src/driver/DriverBeacon.jsx`, ruta `/driver`): el driver elige su nombre (recordado en localStorage) y comparte GPS (`watchPosition`, envía cada ≤8s vía RPC); botón detener → `desconectar_driver`. Es el **germen de la PWA del motorista (Fase 5)** — luego suma PIN + pedidos asignados (recoger/entregar). Deps: ya estaban (leaflet). Build OK.
- **Privacidad:** `driver_ubicaciones` tiene SELECT anon (la torre es anon hoy); moverlo tras identidad authenticated en Fase 0-B junto con el resto.

## 2026-07-29 — Delivery: torre → tab Cobertura (polígonos editables por sucursal)
- **Pedido de Jose:** en la torre, ver y editar la zona de cobertura de cada sucursal en un mapa, con **polígonos** (no círculos) editables moviendo las puntas.
- **Backend** (migración `delivery_cobertura_poligonos`): columna `sucursales.cobertura_geojson jsonb` (GeoJSON Polygon; NULL = fallback por radio). `_punto_en_poligono(lat,lng,geo)` (ray casting, inmutable). `sucursal_mas_cercana` reescrita: elige la sucursal cuyo **polígono** contiene el punto; sin polígono usa radio ≤20 km; entre las que cubren, la más cercana (devuelve `por_poligono`). RPC `guardar_cobertura_sucursal(sucursal_id, geojson)` (SECURITY DEFINER, valida Polygon ≥4 pts, grant anon+auth). Probado: punto dentro→M001 por polígono, Soyapango→S001 por radio; limpiado.
- **Frontend:** `src/components/delivery/TabCobertura.jsx` — **Leaflet + OpenStreetMap (sin API key) + leaflet-geoman** para dibujar/editar polígonos. Selector de sucursal, botones Dibujar/Guardar/Quitar, marcadores de las 5 sucursales. Integrado como 4º tab **🗺️ Cobertura** en `DeliveryView` vía `lazy`+`Suspense` (Leaflet queda en chunk propio de 432 KB, NO carga hasta abrir el tab). Deps nuevas: `leaflet`, `@geoman-io/leaflet-geoman-free`. Build OK.
- **Ojo:** las otras tabs de `DeliveryView` (despacho/viajes/bonos) siguen con el drift de estados de Cesar (usan `pendiente/asignado` que violan el CHECK) — no las toqué; se arreglan en la reconstrucción de la torre (Fase 3 / 0-B).

## 2026-07-29 — Delivery Fase 2: ruteo de sucursal por ubicación (GPS)
- **Backend:** RPC `sucursal_mas_cercana(lat,lng)` (SECURITY DEFINER, grant anon) — haversine sobre las 5 sucursales con `tiene_delivery`; devuelve `{sucursal_id, nombre, distancia_km, en_cobertura}` (cobertura = ≤20 km de la más cercana). Probado: Santa Tecla→Lourdes 2.66km, Usulután→S002 0km, Honduras→fuera, null→error controlado.
- **`crear_pedido_delivery`** ahora auto-rutea: si el pedido llega con `cliente_lat/lng` y está en cobertura, setea `sucursal_id` a la más cercana (Karina puede overridear al confirmar pago). Probado: pedido con coords de Santa Tecla → S003 Lourdes auto-asignada.
- **Frontend** (`MenuPublico.jsx` Checkout): botón "📍 Usar mi ubicación" (`navigator.geolocation`) → llama la RPC → muestra "Te atiende X · a Y km" o aviso de fuera de cobertura / permiso denegado. Manda `cliente_lat/lng` al crear el pedido. Estilos `.mp-geo-*`. Build OK.
- **Pendiente Fase 2 (mejora):** pin arrastrable en un mapa (Leaflet+OSM) para precisión fina; hoy usa el GPS del navegador directo. Costo de envío por distancia sigue en $0 (lo define Karina).

## 2026-07-29 — Delivery: puente delivery→POS REDISEÑADO (gated por pago) + checkout cableado
- **Qué:** rediseñé el puente para que **NO comande al INSERT** (como hacía `fn_delivery_to_pos` de Cesar) sino **al confirmar el pago Karina**. Migraciones `delivery_puente_gated_por_pago` + `delivery_puente_estados_validos`.
- **Cómo quedó:**
  - **Quité** el trigger `trg_delivery_to_pos` (la función queda definida; rollback = recrear trigger).
  - `crear_pedido_delivery(p jsonb)` (grant **anon**): valida precios contra el menú real, guarda shape canónico `{menu_item_id, nombre, precio, cantidad, modificadores:[{id,nombre,precio_extra}], precio_modificadores, nota, subtotal}`, estado **`recibida`**, SIN comandar. Actualiza el CRM. El menú (`MenuPublico.jsx` Checkout) ya lo llama (adiós insert directo).
  - `confirmar_pago_delivery(delivery_id, sucursal_id, metodo)` (grant **authenticated only** — NO anon: si no, cualquiera marcaría pagado = comida gratis): setea sucursal+método, estado **`preparando`**, y llama…
  - `_comanda_delivery(delivery_id)` (interno): crea `pos_cuentas` (tipo `delivery_propio`, estado `enviada_cocina`, IVA 13% incl.) + `pos_cuenta_items` (**menu_item_id UUID exacto**, sin matching por nombre) + `pos_cocina_queue` (KDS). Idempotente (si ya tiene `pos_cuenta_id`, no duplica).
- **Estados válidos (CHECK):** `recibida→preparando→lista→en_camino→entregada→cancelada` (femenino; coincide con `auto_registro_viaje`). ⚠️ `DeliveryView` usa `pendiente/asignado/en_camino/entregado` → **viola este CHECK** = más evidencia de que la torre está rota (arreglar en Fase 3).
- **Probado end-to-end en SQL** (creado y limpiado): crear→`recibida` sin cuenta POS; confirmar→`preparando` + cuenta `enviada_cocina` + item + KDS comanda; 2º confirm no duplica. ✓
- **Pendiente para que Karina lo use:** la torre de control necesita el botón "confirmar pago" cableado a `confirmar_pago_delivery`, y como es `authenticated`-only y el ERP hoy es anon → depende de **Fase 0-B** (o una edge con service_role). Ruteo de sucursal por ubicación = Fase 2 (hoy el pedido entra sin sucursal; Karina la pasa a `confirmar_pago_delivery`).
- **vercel.json:** agregué rewrite `/menu`→`menu.html` (URL limpia para el link de Instagram).
- **Para Cesar:** le cambié su trigger de auto-comanda; pasarle este resumen.

## 2026-07-29 — Delivery Fase 1: HALLAZGO — ya existe pipeline auto-comanda de Cesar (PARAR y coordinar)
- **Qué apareció:** al empezar Fase 1 (menú vivo) descubrí un pipeline **en producción** sobre `delivery_clientes`: trigger **`fn_delivery_to_pos()` BEFORE INSERT** que crea `pos_cuentas` (tipo `delivery_app`, estado `abierta`) + `pos_cuenta_items` + empuja a **`pos_cocina_queue` (KDS)** en el mismo INSERT. Además AFTER UPDATE: `auto_registro_viaje` + `sync_sucursal_on_delivery_update`. Es trabajo de Cesar (ramas kpi-delivery/despacho).
- **Conflictos con el flujo que quiere Jose:**
  1. **Timing:** hoy comanda a cocina **al recibir el pedido (INSERT)**, no **tras confirmar pago Karina**. El flujo deseado exige comandar solo tras el pago.
  2. **Contrato de datos:** el trigger + las 7 filas existentes usan shape **BuhoPay** `{product_id(num), name, price, qty, line_total, selections:{grupo:[{name,price}]}}`. El menú nuevo de Cesar (`catalogoBuho.js`) usa `{id(slug), nombre, precio, qty}`. **No coinciden** → ni el propio PWA→POS de Cesar funciona aún.
- **Corrección a mi entrada anterior:** Fase 0-A NO desbloquea el pedido web end-to-end. `sucursal_id` nullable quitó **un** candado, pero el trigger + shape es un **segundo** candado (el menú manda `nombre`, el trigger lee `name` → `pos_cuenta_items.nombre` NULL → falla). El autollenado (localStorage) y la infra del CRM sí quedaron bien; la captura CRM solo corre tras un INSERT exitoso, así que efectivamente inerte hasta resolver el trigger.
- **Qué hice:** RPC de LECTURA `menu_publico_delivery()` (SECURITY DEFINER, arma el menú delivery_propio con modificadores; grant anon) — **se queda**, sirve igual. RPC `crear_pedido_delivery` la **borré** (chocaba con el trigger). NO toqué el trigger de Cesar.
- **Decisión de Jose:** (B) **yo tomo el puente delivery→POS** y lo rediseño gated-por-pago (el pedido entra 'pendiente' SIN comandar; una acción de Karina 'confirmar pago' comanda). Pendiente de construir. + avanzar en paralelo el **menú vivo (solo lectura/visual)**.
- **Menú vivo hecho (paralelo, no toca el trigger):** `MenuPublico.jsx` ahora lee de `menu_publico_delivery()` (79 ítems reales + modificadores) en vez del `catalogoBuho.js` hardcoded. UI de modificadores nueva (grupos obligatorio/opcional, mín/máx, único vs múltiple, precio en vivo, validación de faltantes). Estados carga/error. `catalogoBuho.js` sigue usándose solo para NEGOCIO/BANNERS. Ojo: el POS **no tiene fotos** (`imagen_url` NULL en los 79) → cards sin foto por ahora; migrar fotos (mapear por nombre a las de BuhoPay) es paso siguiente. El **submit del checkout NO se tocó** (sigue con insert directo viejo, que falla por el trigger) — se cablea al rediseñar el puente. Build OK.

## 2026-07-29 — Delivery Fase 8: rediseño de flujo + Fase 0-A (rama `fix/delivery-fase0`)
- **Contexto:** Jose pidió rediseñar TODO el flujo de pedidos a domicilio (link IG → menú → Karina cobra por WhatsApp → POS comandado → cocina → motorista → caja → tracking en vivo + juego). Se analizó la rama `cesar/menu-digital-pwa` (PWA menú público que reemplaza BuhoPay) y se aterrizó el plan sobre la DB real. **Flujograma + plan por fases** entregado como artifact (aprobado por Jose). Decisiones de Jose: WhatsApp **Cloud API** (automático, requiere verificación de negocio Meta), **DTE se emite al cerrar en caja** (reusa cierre normal del POS), **PWA del motorista independiente con PIN**.
- **Hallazgo clave (reencuadra la seguridad):** TODO el ERP se conecta a Supabase como rol **`anon`** (`KEY_SB` = JWT role anon, login custom en `usuarios_erp`, sin Supabase Auth ni `setSession`). Por eso `DeliveryView` (torre de Karina) **lee/inserta/actualiza `delivery_clientes` como anon**. ⇒ **NO se puede** quitar el `SELECT` anon ni revocar `UPDATE/INSERT/DELETE` sin cegar/romper el ERP. Cerrar la fuga de PII exige primero darle identidad `authenticated` al staff (firmar JWT al login) = **Fase 0-B** (pendiente, toca login; es el mismo "JWT role vía PostgREST" de [[soporte-resolver-ia]]).
- **Qué se hizo (Fase 0-A, segura, no rompe nada):**
  1. **Desbloqueo del guardado web:** migración `delivery_fase0_sucursal_id_nullable` → `delivery_clientes.sucursal_id` ahora **NULL** (antes NOT NULL sin default ⇒ **ningún pedido web se guardaba jamás**, 0 filas `WEB-%`). El pedido entra "sin rutear"; la sucursal se asigna por ubicación (Fase 2) o por Karina. Reversible.
  2. **Autollenado cliente recurrente:** en `src/menu-publico/MenuPublico.jsx` (Checkout) — perfil en **localStorage** (`freakie_cliente_v1`), prefill de nombre/tel/dirección/zona + aviso "¡Hola de nuevo!". Se eligió localStorage (no lookup por teléfono server-side) **a propósito**: un lookup desde el menú (anon) dejaría enumerar PII ajena.
  3. **CRM aislado para marketing** (pedido de Jose: promos a frecuentes, cumpleaños): migración `crm_clientes_delivery` → tabla `public.clientes_delivery` (RLS on, **sin policies anon** ⇒ anon no lee/escribe directo) + RPC `registrar_cliente_delivery(...)` **SECURITY DEFINER** (upsert por teléfono, incrementa `total_pedidos`, `returns void` sin fuga; execute a anon/authenticated). El menú la llama fire-and-forget al confirmar. La lectura para marketing será por el canal autenticado de la 0-B.
- **Pendiente inmediato:** push de la rama / PR (Jose decide destino). Luego Fase 1 (menú vivo desde `pos_menus canal=delivery_propio`, 79 ítems + modificadores) y Fase 0-B (identidad authenticated → recién ahí se cierra la PII de `delivery_clientes`).
- **Ojo drift:** `DeliveryView.jsx` inserta/actualiza columnas que **no existen** en `delivery_clientes` (`empleado_id`, `direccion`, `zona`) — la torre está medio rota; se arregla en Fase 3.
## 2026-07-29 — Venecia terminó el día con corte X (día sin cerrar) → guardrail "después de las 19:00 solo Z"
- **Qué:** `src/pos/CierreTurno.jsx` — a partir de las **19:00 hora SV** el corte **X queda bloqueado**; el cierre debe hacerse con **Z**.
- **Síntoma:** S004 (Paseo Venecia) el 29-jul cerró sus **2 turnos con X y nunca hizo Z** → el día quedó **sin fila en `ventas_diarias`, sin depósito**, con $1,799.75 vendidos fuera de todo reporte. Ya había pasado el 27-jul (X a las 22:10).
- **Causa raíz — se DESCARTÓ la hipótesis de bug de tablet:** no existe camino de código donde apretar Z guarde X. Prueba forense: la fila tiene `deposito_monto = 0.00`, literal que **solo escribe `cerrarX`** (`CierreTurno.jsx:361`); `cerrarZ` escribe `deposito_monto: depositoDia` (`:386`) → habría sido $336.65. Además `conteo_efectivo = efReal − fondo` prueba bundle nuevo (no era tablet pegada en bundle viejo) y **esa misma tablet hizo un Z correcto la noche anterior**. Lo que sí falla es la **UX**: la pantalla abría siempre en el tab `X` (`useState('x')`) y **el botón Z ni se renderizaba** hasta tocar la pestaña → cerrar con X era el camino de menor resistencia.
- **Fix:** `horaSV()` (mismo criterio UTC-6 que `todayISO()`) + `HORA_FORZAR_Z = 19`. (1) el tab arranca en `'z'` pasada esa hora; (2) **bloqueo duro dentro de `cerrarX`**, evaluado al apretar (no solo en el render, para que valga con la pantalla abierta hace rato); (3) pestaña X tachada/deshabilitada + aviso en pantalla.
- **Por qué 19:00 es seguro:** de todos los cortes X de la historia, los **únicos 2 después de las 19:00 son justo los 2 errores de Venecia**; todos los cambios de turno legítimos ocurren entre 10:00 y 16:14. Borde probado: 18:59 permite X, 19:00 bloquea.
- **Reconstrucción del 29 de S004:** `pos_rebuild_cierre_dia('S004','2026-07-29')` → venta $1,515.77 (ef $587.67 + tarj $928.10; PeYa $238.30 aparte). **⚠️ Gotcha:** la función calcula `diferencia_deposito = depósito − efectivo`, así que con depósito $0 generaba un **faltante de −$587.67 que el P&L cuenta como gasto real ("Descuadre Caja")** — se puso en 0 a propósito. Depósito registrado $587.67 = efectivo **teórico** del sistema, NO conteo físico. Queda `enviado` para que **Jazz lo revise**.
- **Dato corregido:** un análisis intermedio afirmó que la fila del 28-jul de S004 "no la produjo el RPC" por dar $688.81 vs $970.51 — **falso**: la diferencia son exactamente los $281.70 de PedidosYa que `total_ventas_quanto` excluye por diseño. La conclusión (la puso soporte, no el POS) igual se sostiene, pero por el **timestamp**: Z a las 21:37, fila creada 21:52.
- **⚠️ Bugs REALES detectados y NO arreglados (pendientes):**
  1. **El Z se traga los errores:** si el RPC `pos_rebuild_cierre_dia` falla, el turno **igual queda marcado Z**, no se crea el cierre, y al cajero le sale "✓ Día cerrado" (`CierreTurno.jsx:396` ignora `_rpcErr` sin toast). **Ya mordió el 28-jul en Venecia.** Además el RPC es SECURITY INVOKER y el POS entra como `anon` → cualquier apriete de grants lo rompe en silencio (ver [[supabase-drop-matview-borra-grants]]).
  2. **`confirmDialog.jsx:55`:** tocar el backdrop cancela con `false` **sin ningún aviso** — mis-tap trivial en una Fire en kiosk.
  3. **`loadDia` sin manejo de error:** el tab Z puede mostrar "$0.00" como si fuera dato válido.
  4. **Cuentas cobradas SIN método de pago:** 38 cuentas / ~$746 en 10 días (M001, S004, S006), la mayoría **con DTE emitido**; no entran al desglose efectivo/tarjeta → el arqueo espera menos plata de la que hay. NO tocado (toca DTE).
  5. **`pos_turnos.deposito_foto_url` nunca se usó** (0 de 10 cortes Z). La foto del voucher solo entra por el ERP (`depositos_bancarios`, 435/435 con foto) y **nadie concilia ambos**: por eso pasó un depósito de **$0.01 contra $672.63 esperados marcado "confirmado"** en Venecia.
  6. Latente: turno abierto un día y cerrado pasada la medianoche lee egresos del día equivocado (`:393` usa `turno.fecha`, `:400` usa `todayISO()`).
- **Egresos del 29 en $0 (M001, S006, S004):** se cerró sin cargarlos; la sucursal los pone a mano. M001 tiene egresos todos los días (5–18 diarios). En M001/S006 el conteo de efectivo quedó **idéntico al del sistema** (sin arqueo físico real). Ver [[freakie-cierres-multi-turno]].

## 2026-07-29 — Cierres fantasma por "mes equivocado" (fecha futura) → limpieza + guardrail de raíz (DB + frontend)
- **Disparador:** Jazz (Soyapango) reenvió que "se le duplicó un cierre del 29 en tecla" (Cafetalón/M001). Al abrir el form de Cierre de Caja del 29 salía "Ya hay 1 cierre para esta fecha".
- **Causa raíz (confirmada, sistémica — NO fue typo aislado):** el form **`src/components/caja/CierreForm.jsx`** usa `<input type="date">` **sin `max` ni validación de fecha futura**. `today()` (`config.js:49`) está bien resuelto para UTC-6, no hay bug de timezone. Cuando el personal se pone al día con los **últimos días del mes anterior** en los primeros días del mes nuevo, el date-picker de iOS deja el **mes actual** → el cierre queda con **fecha futura** y **duplica** el cierre real del mes anterior. Todos los casos hallados producen fecha futura al momento de crearse.
- **Casos encontrados y limpiados (backup → borrado, verificados como duplicados EXACTOS por huella de egresos):**
  - **M001** 29/07 (`1ba8ce4d…`, $1797.01, 20 egresos incl. salarios $495.19) = duplicado exacto de **M001 29/06** (`fe6fd648…`, aprobado, mismos 20 egresos, total egresos $804.24). NADA se perdió.
  - **S002** 29/07 (`cb0d9a55…`) = dup exacto de **S002 29/06**; **S002** 30/07 (`351449ba…`) = dup exacto de **S002 30/06** (aprobado). Creados 02/07 por Karla (poniéndose al día con jun 29/30).
- **Ambiguos, NO tocados (para revisión de Jose):** **S003** tiene filas viejas creadas a inicio de mes con fecha a fin del mismo mes (may 28/29 `aprobado` con data única = probablemente reales/import; may 30 vs jun 30 = casi-dup pero cada uno es único de su día). Parecen data importada, distinto al bug reciente. Query para re-listar futuros: `select … from ventas_diarias where fecha > (created_at at time zone 'America/El_Salvador')::date`.
- **Fix de raíz aplicado:**
  1. **DB (defensa dura):** migración `guardrail_ventas_diarias_no_fecha_futura` — trigger `trg_vd_no_fecha_futura` BEFORE INSERT/UPDATE OF fecha en `ventas_diarias` que lanza excepción si `fecha > (now() at time zone 'America/El_Salvador')::date`. Probado: futuro rechazado, hoy pasa.
  2. **Frontend:** `CierreForm.jsx` — `max={today()}` en el input date + check `if (!isEdit && fecha > today())` en `handleSubmit`. Build OK. (No aplica en modo edición: fecha es `readOnly`.)
- **Impacto P&L:** el branch `egresos_cierre` de `v_gastos_consolidados` **no filtra por estado del cierre**, así que los gastos (no-salario) de estos fantasmas contaban mal fechados en jul-2026; bajan al próximo REFRESH de `mv_finanzas_gastos_mensual` (correcto). Salarios se excluían por `motivo_nombre`, no afectaban P&L. Ventas fantasma no afectan ingresos (revenue = Quanto).
- **Backups restaurables (local mini, fuera de git/Syncthing por nómina):** `~/freakie-db-backups/2026-07-29_M001_cierre-fantasma_1ba8ce4d_RESTORE.sql` y `~/freakie-db-backups/2026-07-29_S002_cierres-fantasma_mes-equivocado_RESTORE.sql`.
- Ver [[freakie-cierres-multi-turno]].

## 2026-07-28 — Impresión Soyapango (S001): puente blindado + watchdog + aviso en pantalla
- **Qué:** endurecimiento del puente de impresión Windows (`windows-print-bridge/`) + feedback de impresión en el POS (`src/pos/print/printService.js`, `POSMain.jsx`, `CierreTurno.jsx`).
- **Síntoma (Jose):** la impresora de Plaza Mundo Soyapango "no imprime". Foto de la PC mostraba `No se pudo abrir el puerto 9110: ... una dirección de socket ...` al abrir el `.bat`. Apretaron una tecla (cerraron esa ventana) y **empezó a imprimir sin reiniciar**.
- **Causa raíz:** NO fue el POS ni la config (`pos_impresoras` S001 correcta: `modo=bridge`, `bridge_url=http://127.0.0.1:9110/print`, impresora `192.168.0.253:9100`). Fue el **ciclo de vida del puente**: un proceso PowerShell **zombie** agarraba el puerto 9110 pero ya no atendía → el POS hacía POST, no respondía, y caía en silencio a `modo=sistema` (diálogo de Windows, inútil en esa PC sin driver) → "sale en pantalla pero no imprime". Cerrar la ventana mató el zombie → liberó 9110 → un puente sano tomó y flusheó. El `.vbs` en `shell:startup` no sobrevivía reinicios/cuelgues y no había watchdog.
- **Nivel 1 (puente, sin software nuevo):** (1) `freakie-print-bridge.ps1` blindado: si el puerto ya está ocupado por un puente **sano** (probe `GET /health`) sale en silencio; si es zombie lo reporta y sale (quitado el `Read-Host` que colgaba invisible en modo oculto); `AcceptTcpClient` y cada request protegidos → un error/timeout **ya no mata el loop**; nuevo endpoint `GET /health`. (2) `Reiniciar-Puente.bat` ⭐: un clic mata puente viejo/zombie (por cmdline y por dueño del puerto 9110), libera y arranca uno limpio visible. (3) `watchdog.ps1` + `Instalar-Arranque-Automatico.bat`: Tarea Programada (logon + cada 2 min) que revisa `/health` y auto-reinicia; **reemplaza el `shell:startup` frágil**.
- **Nivel 2 (POS avisa):** `imprimir()` ahora devuelve `{ok, modo, error}` y **no se traga** el fallo del bridge: si el puente no responde, en vez de caer al diálogo inútil devuelve `ok:false`. `POSMain` (pre-cuenta, comanda, factura) y `CierreTurno` (corte X/Z) muestran `toast.error('⚠️ … no se imprimió — revisá la impresora / puente')`. Antes fallaba en silencio y el cajero no se enteraba. Build OK.
- **Pendiente Nivel 3 (cura definitiva, requiere alguien en la PC):** instalar driver TCP/IP estándar de la impresora en Windows → usar `modo=sistema` y **eliminar el puente**; o correr el puente como Servicio de Windows. Ver [[soporte-resolver-ia]] (ticket S001 `19c55ad7…`).

## 2026-07-28 — POS: anti-duplicado de comandas en el KDS (doble/triple tap)
- **Qué:** `handleComandar` (`src/pos/cajero/POSMain.jsx`) + migración `pos_comanda_idempotencia` (schema `public`).
- **Síntoma (lo reportó Jose):** cuando el POS va lento, el cajero aprieta COMANDAR varias veces y cada toque mete una orden repetida (o más) en el KDS de cocina (`pos_cocina_queue`).
- **Causa raíz:** el botón solo se protegía con `disabled={commanding}`, pero `commanding` es estado async y `setCommanding(true)` recién corría **después** del `await` del turno → ventana de varios cientos de ms donde caben más toques. Peor: en la reentrada `currentCuentaId = cuentaId` seguía leyendo el valor viejo (`null`), así que **cada toque creaba una cuenta+ítems+queue completos** → orden entera repetida por toque.
- **Fix 1 (frontend, candado síncrono):** `commandingRef = useRef(false)` fijado **antes de cualquier await**; si ya hay una comanda en vuelo, los toques extra se ignoran al instante (el `disabled` async llega tarde). Liberado en `finally` y en el return de "no hay caja".
- **Fix 2 (idempotencia DB, defensa ante reenvío por red):** token `comanda_uid` (UUID por tap, con fallback si el WebView de la tablet no tiene `crypto.randomUUID`) + `linea` ordinal por fila. Columnas nuevas `comanda_uid`/`linea` en `pos_cocina_queue` y `pos_cuenta_items`, `comanda_uid` en `pos_cuentas`; **índices únicos no-parciales** (filas viejas quedan `(null,null)`, conviven). Los inserts de ítems y queue pasaron a `upsert(..., { onConflict:'comanda_uid,linea', ignoreDuplicates:true })` → un reenvío idéntico **rebota** en vez de duplicar. El token persiste entre reintentos manuales y se **limpia al éxito** y **cuando cambian los ítems** (`useEffect` sobre `items`), para que solo deduplique reenvíos idénticos (nunca descarta un ítem editado por reusar su `linea`). En reintento se recupera la cuenta por `comanda_uid` (evita cuenta fantasma).
- **Aditivo y no-breaking:** columnas nullable, índices permiten múltiples `(null,null)`, grants `anon` ya cubrían las columnas nuevas. Build OK. Ver [[freakie-cierres-multi-turno]] y el guardrail de comandar sin caja.

## 2026-07-28 — P&L: "Venta Local" unificada por sucursal (Quanto + POS interno)
- **Qué:** en `FinanzasDashboard.jsx`, el árbol de ventas del Estado de Resultados fusiona los dos bloques ("Venta Local (Quanto)" + "Venta Local POS (Metro Centro)") en **un solo canal "Venta Local"** con una fila por sucursal = Quanto + POS interno del mes. Así se ve la **evolución continua** de cada sucursal aunque migre de Quanto al POS interno (antes se partía en 2 tablas).
- **Marca de fuente por celda:** cada celda sucursal-mes lleva un superíndice — `Q` (verde)=Quanto, `I` (azul)=POS interno, `Q·I` (dorado)=mes de transición — y en **hover** muestra el desglose exacto (Quanto $X · POS interno $Y). `srcPerMonth` en `ventasTree` guarda el split.
- **Quitado** "(Metro Centro)" del título (ahora muestra todas las sucursales). PedidosYa sigue como canal aparte.
- Solo frontend (sin DB). Ver [[freakie-cierres-multi-turno]].

## 2026-07-28 — KPI Ventas Totales·BEP: consistencia con el P&L
- **Qué:** migración `fn_ventas_totales_dashboard_pos_consistente` (RPC) + `KpiVentasTotalesDashboard.jsx` (chip/tabla/CSV del canal POS).
- **Problema:** el dashboard "KPI Ventas Totales · BEP" **no** lee la matview; usa el RPC `fn_ventas_totales_dashboard`, que arrastraba los mismos 2 bugs ya corregidos en el P&L: (1) **lista negra** `store_code NOT IN ('M001','S001','S002','S003','S004','EVT01')` en la fuente POS → solo contaba S006, faltaban las migradas; (2) leía `v_pos_ventas_diario` (con `pedidos_ya`). Resultado: "Todas" julio subcontaba **~$14,937 s/IVA** ($241,047 en vez de $255,984). Además el frontend no mostraba el canal POS (invisible dentro de "Todas").
- **Fix:** la CTE `po` y las subqueries del mes previo ahora leen `v_pos_ventas_diario_sin_peya` con `store_code <> 'EVT01'` (idéntico criterio que la matview). Frontend: agregado canal `pos` ("POS Interno", `c.blue`) a `CANALES`, a la tabla de detalle diario y al export CSV.
- **Verificado:** RPC julio (corte 26-jul) → Todas $255,984 = Quanto $149,745 + PeYa $42,894 + POS $63,345 + Eventos $0. Consistente con el P&L. `CREATE OR REPLACE FUNCTION` preserva grants (no aplica el gotcha del DROP de matview). Ver [[freakie-cierres-multi-turno]].

## 2026-07-27 — P&L: doble conteo de PeYa + PeYa sin desglose (jun/jul)
- **Qué:** migración `migration_mv_ventas_pos_excluir_pedidos_ya` + fix `QuantoUploadView.jsx` + backfill `pedidos_peya`.
- **Bug A — doble conteo PeYa:** el POS interno registra órdenes PeYa como `pos_cuentas.tipo='pedidos_ya'`; entraban en la fuente `pos` del P&L Y en la fuente `peya` (archivo `pedidos_peya`). Fix: vista nueva `v_pos_ventas_diario_sin_peya` (= `v_pos_ventas_diario` con `tipo IS DISTINCT FROM 'pedidos_ya'`) y la matview lee esa vista en la rama `pos`. El archivo PeYa queda como única fuente de la venta PeYa (es el fidedigno: precio real del cliente, aunque PeYa liquide menos). Impacto julio: ~$2,522 c/IVA. **Aislado a propósito**: `v_ventas_sucursal_diario` sigue usando `v_pos_ventas_diario` (no toca PeYa ahí porque esa vista no suma el archivo).
- **Bug B — PeYa "Otro" en jun/jul:** el reporte PeYa **dejó de traer "ID del local"** desde junio → `store_code` NULL → se agrupaba como "Otro". Pero **"Nombre del local" sigue** viniendo. Fix: (1) backfill `store_code` desde `nombre_local` (mapeo 1:1: Freakie Dogs=M001, …Soyapango=S001, …Usulután=S002, Lourdes=S003, …Paseo Venecia=S004); (2) `QuantoUploadView.jsx` ahora cae a `NOMBRE_TO_STORE_PEYA[nombre_local]` si no hay `local_id`.
- **Recordatorio:** re-GRANT anon/authenticated tras cada DROP+CREATE de la matview. Ver [[freakie-cierres-multi-turno]].

## 2026-07-27 — P&L: ventas del POS interno fugadas (lista negra en matview)
- **Qué:** migración `migration_mv_ventas_pos_sin_lista_negra` (Supabase `public`) — recrea `mv_finanzas_ventas_mensual` quitando la lista negra hardcodeada `ARRAY['M001','S001','S002','S003','S004','EVT01']` de la rama `pos`; queda solo `<> 'EVT01'`. Índice único `(mes,store_code,fuente)` recreado (habilita el REFRESH CONCURRENTLY del botón "Refrescar P&L"). Copia documental en `Contexto/SQL/`.
- **Síntoma (lo detectó Jose):** el P&L de "Casa Matriz" mostraba julio "cayendo" ($237K); sospechó que solo entraban ventas Quanto y no las del POS interno. Correcto.
- **Causa raíz:** la matview arma la fila Ventas de 4 fuentes: `quanto` (v_quanto_ordenes_diario), `peya` (pedidos_peya), `pos` (v_pos_ventas_diario) y eventos. La rama `pos` **excluía a la fuerza** M001/S001/S002/S003/S004 (diseño viejo: solo S006 usaba POS interno). Pero en julio **M001, S001, S002 y S004 migraron de Quanto al POS interno**; Quanto corta el día de la migración y el POS interno arranca al siguiente (0 días solapados) → esas ventas post-migración caían en la lista negra y **se perdían**.
- **Impacto:** Julio recuperó **+$22,981.95 c/IVA (~$20,338 s/IVA)** — POS interno pasó de solo S006 ($57,423) a M001+S001+S002+S004+S006 ($80,405). Meses viejos suben centavos (órdenes de prueba del POS interno en M001: Abr $119, May $148.51, Jun $9.35). Total julio: $237K → ~$258K s/IVA.
- **Por qué el UNION no dobla:** Quanto importa solo ventas Quanto y el POS interno solo las suyas — son disjuntas. Único día con dato en ambas: S001 7-jul ($624 Quanto + $8.50 POS interno), pero son ventas distintas (prueba), no la misma duplicada. Se mantiene `<> 'EVT01'` porque eventos SÍ se suman aparte desde tabla `eventos` en `FinanzasDashboard.jsx`.
- **Ventaja:** cualquier sucursal que migre al POS interno ahora entra sola, sin re-editar la matview. Ver [[freakie-cierres-multi-turno]].
- **⚠️ Lección (susto en vivo):** tras recrear la matview, al "Refrescar P&L" el dashboard mostró **todas las ventas 2026 en ~$0** y los % de costos disparados (miles de %). Causa: `DROP MATERIALIZED VIEW` **borra los GRANT**; la app lee por rol `anon` vía proxy `/sb` y sin `SELECT` recibía 0 filas (los datos nunca se fueron — con rol privilegiado se veían llenos). Fix: `GRANT SELECT ON public.mv_finanzas_ventas_mensual TO anon, authenticated;` (igual que `mv_finanzas_gastos_mensual`). **Regla:** todo DROP+CREATE de matview/vista que lea la app debe re-GRANTear a `anon, authenticated`.

## 2026-07-27 — POS: rediseño de cierres (X = cambio de turno, Z = cierre del día)
- **Qué:** `CierreTurno.jsx` + migración `pos_turnos_tipo_cierre` (columna `tipo_cierre`: null=abierto · `X` · `Z`).
- **Modelo nuevo (definido con Jose):**
  - **Corte X = cambio de turno:** cierra la caja del cajero (sus ventas quedan amarradas por `turno_id`), **arqueo por cajero** (cuenta su gaveta: fondo recibido + ventas efectivo − egresos + ingresos), **NO deposita**, y **libera la caja**. La **gaveta se arrastra**: el fondo del siguiente turno se precarga con el efectivo contado en el X. Varios X por día.
  - **Corte Z = cierre del día (UNO por día):** muestra el **acumulado del día** (todos los turnos, vía `pos_corte` con `turno_id=null`), se cuenta la gaveta, **se deposita el efectivo del día** (el fondo base se queda) y se arma `ventas_diarias` 'completo' con `pos_rebuild_cierre_dia` (suma todos los turnos cerrados). Cada turno guarda su propio snapshot `sistema_*` para que la suma no doble-cuente; solo el Z lleva `deposito_monto` (=día). El Z reescribe `egresos_cierre`/`ingresos_cierre` con el detalle de TODOS los turnos.
- **Guardrails:** 1 sola caja abierta por sucursal + **no abrir si el día ya se cerró con Z**.
- **Por qué:** antes el X era solo lectura y el Z cerraba el turno individual → cada cambio de turno dejaba turnos colgados o 2 cajas abiertas (caso Venecia 27-Jul). Ver [[freakie-cierres-multi-turno]].

## 2026-07-27 — POS: confirmación in-app (arreglo del cierre Z en la APK)
- **Qué:** nuevo módulo `src/pos/confirmDialog.jsx` (`confirmAsync()` promise-based + `<ConfirmHost/>` montado en `pos-main.jsx`) que reemplaza a `window.confirm()` en el POS. Migrados: cierre **Z** (`CierreTurno`), liberar mesa (`POSHome`), quitar ítems no comandados (`POSMain`), y 4 borrados de `MenuAdminView`.
- **Por qué:** en Venecia (S004) el corte **Z "no dejaba" cerrar**. Causa: el POS corre dentro del **WebView de la APK Android** (Fire tablet, `android-printer/…/MainActivity.kt` con `WebChromeClient()` base) y ahí `window.confirm()` en modo kiosk **devuelve `false`** → el `if (!confirm(...)) return` cancelaba la acción sin aviso. El cobro no usa confirm, por eso sí cobraban. En la base el turno seguía `abierto` (nunca llegaba al UPDATE; RLS/triggers descartados).
- **Excluido a propósito:** el `confirm()` de anulación de DTE en `HistorialCobros.jsx` (facturación ante Hacienda — no se toca sin OK de Jose; ese flujo se hace desde navegador). Queda pendiente migrarlo.
- **Extra detectado:** Venecia tenía 2 turnos abiertos el 27-Jul (Katherine AM + Alejandro PM); hay que cerrarlos ambos con Z.

## 2026-07-27 — POS: bloquear comandar sin caja abierta
- **Qué:** `handleComandar` (`src/pos/cajero/POSMain.jsx`) ahora exige un **turno de cajero abierto** en la sucursal ANTES de crear/enviar la comanda. Sin caja abierta → bloquea con toast ("No hay caja abierta…"). *Fail-open* ante error de consulta (un hipo de red no frena la venta), mismo criterio que ya usaba el cobro (`saveCuenta`). Además la cuenta queda atada al turno (`turno_id`) desde que se comanda, no solo al cobrar.
- **Por qué:** el cobro ya exigía caja abierta, pero comandar no validaba nada. El 27-jul Soyapango (S001) arrancó el POS interno **sin abrir caja** → tomó 53 comandas ($648) que quedaron en `lista`/`enviada_cocina` y **no se pudieron cobrar** (sin turno no hay cobro), sin aparecer en *Ventas Freakies* (que solo cuenta `cobrada`) ni facturarse. Este guardrail evita que se repita. Ver [[freakie-cierres-multi-turno]].

## 2026-07-26 — Soporte IA (Resolver de la mini) — Fase 1
- **Qué:** sistema donde el **personal reporta problemas** (no imprime, no loguea, no cierra caja…) y el **AI de la mini** los diagnostica, resuelve lo reversible solo y escala a Jose lo material. Autonomía elegida: **acciones reversibles solas**. Canal: **Telegram + botón POS** ahora, **WhatsApp** después. Aprobaciones: **Supabase + botones en el teléfono + eco en `hq`**. **Sin Make.com** (webhooks directos).
- **Por qué así:** el ERP ya tenía IA + DevOps (`ai_inbox`, `ai_agentes_estado`, `devops_log` + RPC `devops_autofix()`, `acciones_pendientes`), pero **ninguno es un resolver de soporte en vivo** → se creó lo que faltaba y se **reutiliza** `devops_log`/`devops_autofix()`. Los 19 agentes de `ai_agentes_estado` son analistas programados (no de soporte).
- **DB (migración `soporte_resolver_fase1`, schema public):** tablas `soporte_tickets`, `soporte_mensajes`, `soporte_aprobaciones` + RLS (POS anon inserta/lee tickets y mensajes; aprobaciones service_role only) + trigger updated_at. Edge Function **`soporte-intake`** desplegada (webhook Telegram/WA, fail-closed con `SOPORTE_INTAKE_SECRET`; el POS inserta directo por anon+RLS).
- **Worker:** vive en **`~/Proyectos/server/soporte-resolver/`** (NO en este repo; server/ aún no es git). Poller lee tickets `nuevo` por anon+REST (la mini SÍ alcanza `*.supabase.co` directo, HTTP 200) y despacha `claude -p` por ticket. El cerebro/guardrails están en `resolver.md`.
- **Hallazgo clave:** el MCP de Supabase (conector claude.ai) es **diferido**; en headless `claude -p` solo carga/corre con `--dangerously-skip-permissions`. Por eso en Fase 1 el ÚNICO guardrail es el system-prompt + auditoría en `devops_log`. **Fase 2 endurece con rol Postgres readonly-acotado** (estilo `ai_tenant_registry.rol_readonly`).
- **Probado end-to-end** (ticket manual S001 "impresora no imprime"): el resolver clasificó impresion/alta, diagnosticó el puente PowerShell de Soyapango, dejó mensaje al personal con pasos y `estado=esperando_usuario`, y auditó en `devops_log`. Ticket demo `19c55ad7-…` queda en la tabla.
- **Doc de diseño en Notion:** 🛟 Soporte IA — Resolver de la mini (subpágina de Freakie Dogs, `3aa24fa10edc810ebcbaf750d12241b9`).
- **Pendiente Fase 2:** bot de Telegram (token de @BotFather), ejecutar acción tras aprobación de Jose, botones Aprobar/Rechazar, cablear `ai_inbox`/`ai_agentes_estado` (coordinar con Cesar), guardrail duro.

## 2026-07-30 — Lourdes (S003) migra a POS propio: multi-caja + ruteo de impresoras
- **Contexto:** Lourdes es la última sucursal que faltaba migrar de Quanto al POS propio. Tablets Android (no Fire) → app nativa Freakie POS, **sin RawBT**. Tiene **2 cajas** (General + Drive Thru) y **3 impresoras**.
- **Multi-caja por sucursal (PR #44):** nuevo concepto `caja` (columna en `pos_impresoras` y `pos_turnos`; NULL = sucursal de 1 sola caja = las otras 5 tiendas sin cambios). Selector de caja al login (`CajaSelector` en `POSApp`, auto-salta si hay 1 sola). Turno/cierre por caja (aperturas, guardrails "1 turno por caja", corte X por turno, corte-día Z por caja). RPC `pos_corte` ganó `p_caja` opcional (NULL = idéntico a hoy). La sesión lleva `posUser.caja`; badge de caja activa en el header.
- **Ruteo de impresora por (caja, tipo) (PR #45):** `pickImpresora(rows, tipo)` en `printService`: `getImpresoras()` cachea el array por (store,caja) e `imprimir()` elige por tipo. **precuenta → impresora rol='precuenta'** (meseros); resto (comanda/factura/corte) → principal (rol≠precuenta). Corte lleva `caja`.
- **Impresoras Lourdes (self-test 29-Jul, todas EPSON ESC/POS 80mm, DHCP off, puerto 9100):**
  - **General** `192.168.1.7` (WiFi CLARO_2.4GHz_B22767) · caja=general, rol=todo → factura/comanda/corte de la caja general.
  - **Meseros** `192.168.1.8` (WiFi) · caja=general, rol=precuenta → SOLO pre-cuenta de la caja general.
  - **Drive Thru** `192.168.1.100` (Ethernet CABLE) · caja=drive, rol=todo → TODO lo de la caja drive.
  - Ojo IP: las 3 muestran Ethernet default `.100`; funciona porque General y Meseros van por WiFi (sin cable) y solo Drive usa `.100` cableada. Jose confirmó General sin cable.
- Pendiente: instalar APK en las tablets (WiFi CLARO_2.4GHz_B22767), probar los 3 flujos, y fijar la fecha de corte (CUTOVER) Quanto→POS de S003 en el dashboard.

## 2026-07-26 — Manual del ERP (HTML) publicado en el POS
- **Qué:** manual de usuario HTML de TODO el ERP (~50 módulos en 16 áreas), autocontenido, tema claro/oscuro, índice por área con scrollspy. Vive en **`public/manual-pos.html`** → producción `https://freakie-dogs-caja.vercel.app/manual-pos.html` (compartible suelto) y enlazado en `src/components/layout/Sidebar.jsx` ("📖 Manual del ERP", pestaña nueva, visible a todos los roles). PR #24.
- **Cómo se armó:** contenido generado leyendo el código real de cada módulo (5 subagentes en paralelo por área: Almacén, Finanzas, Admin, Dashboards/Caja/Empleado, RRHH/Producción/SupplyChain/Delivery/Eventos/Marketing). Diseño validado antes por Jose vía artifact borrador.
- **Mantenimiento:** al cambiar algo del ERP, editar `public/manual-pos.html` y sumar entrada en su sección "Historial de cambios" (va v2.0).
- **Pendiente/verificar:** "Confirmar Entregas" quedó a alto nivel; el acceso real por rol de los módulos back-office lo rige Panel Super Admin → Permisos; aprobar/editar Nómina y Recetas usan PIN de personas autorizadas (no el rol).

## 2026-07-26 — Impresión en producción: Venecia (S004, Fire) y Soyapango (S001, Windows)
- **Venecia (S004) — APK propio funcionando:** se completaron los pendientes del APK. Keystore PKCS12 generado con **openssl** (`~/freakie.keystore`, alias `freakie`, fuera del repo) porque el Mac no tiene Java; 3 secretos cargados a GitHub (`KEYSTORE_BASE64/PASSWORD`, `KEY_ALIAS`). El workflow `build-apk` (Actions) compila y firma el APK. **Tope con OAuth:** el token de `git`/`gh` no tenía scope `workflow`; se resolvió con `gh auth refresh -s workflow` y push del workflow forzando la credencial de gh (`git -c credential.helper='!gh auth git-credential'`). El APK se distribuyó por **Tailscale Funnel** desde el mini (`https://joses-mac-mini.tailf3e161.ts.net/freakie-pos.apk`), no por hosts públicos (0x0/tmpfiles caídos/flaky).
- **Fix APK:** cargaba la raíz del ERP; se apuntó a **`/pos`** (v1.1). El WebView ya inyecta `AndroidPrinter`.
- **Deploy de la integración nativa (PR #18):** el puente `AndroidPrinter` en `printService.js` estaba solo en la rama, no en `main` → producción seguía mandando el deep-link `rawbt:` (error `ERR_UNKNOWN_URL_SCHEME` en la Fire). Se mergeó a `main` y Vercel desplegó. El bloque nativo es **no-op** para clientes sin `window.AndroidPrinter` (cero regresión). Impresora S004 ya estaba registrada (IP `192.168.1.130:9100`, confirmada por self-test, DHCP off, SSID CLARO1_ADD4C2).
- **Venecia sin comanda (PR #19):** al comandar en S004 **no** se imprime comanda de cocina (la orden igual entra al KDS). Config por sucursal: `STORES_SIN_COMANDA=['S004']` en `src/config.js` (patrón de `STORES_SIN_PROPINA`), chequeado en `POSMain.jsx`.
- **Soyapango (S001) — PC Windows + puente local:** NO usa tablet, es PC Windows. La impresora es de **red (`192.168.0.253:9100`, Ethernet/USB/BT, DHCP off, self-test 26-Jul) pero SIN driver instalado en Windows** → no aparece en el diálogo de Chrome (solo "PDF"). Por eso `modo=sistema` (window.print) no sirve. QUANTO imprime porque le pega **directo a la IP**. Solución: **`modo=bridge`** — un puente local en PowerShell (`android-printer`-style) que escucha en `127.0.0.1:9110` (loopback, sin admin, `TcpListener`, CORS + Private-Network) y reenvía ESC/POS a `192.168.0.253:9100`. Archivos: `freakie-print-bridge.ps1` + lanzador `.bat` (visible, prueba) + `Puente-Freakie-Oculto.vbs` (segundo plano; va en `shell:startup` para arranque automático). **Probado: imprime.** Impresora S001 registrada en `pos_impresoras` (`bridge_url=http://127.0.0.1:9110/print`).
- **Fix modo sistema (PR #20):** `sendSistema` abría un popup (`window.open`) que Chrome bloquea → no imprimía. Ahora usa **iframe oculto** (sin popup); con Chrome `--kiosk-printing` sale silencioso. Beneficia también a S002/S006.
- **Hecho:** puente de S001 dejado en arranque automático (`shell:startup`) y confirmado imprimiendo. Los archivos del puente viven en el repo en **`windows-print-bridge/`** (ps1 + bat + vbs + README) — ya no dependen del Funnel. Pendiente general: feedback de impresión en pantalla; rollout del APK/registro a las tiendas restantes.

## 2026-07-26 — App Android propia de impresión (Freakie POS APK)
- **Por qué:** RawBT **no corre en las tablets Amazon Fire** — su código hace un chequeo de licencia de Google Play, que Fire OS no tiene. Como las Fire son parte del parque de tablets, la impresión quedaba rota ahí. La salida es una **app propia**: WebView que carga el POS + puente JS→socket TCP:9100. Usa solo APIs base de Android, sin Google Play Services, así que corre en Fire igual que en Android normal.
- **Diseño:** la app es "tonta" — solo recibe `(ip, puerto, base64)` y escribe al socket. Toda la lógica sigue en el POS, que le pasa la IP desde `pos_impresoras`. Eso da **cero configuración por tablet** (el gran dolor de RawBT) y ninguna credencial vive en el APK.
- **Integración (`src/pos/print/printService.js`):** en `imprimir()`, antes del check de `modo === 'sistema'`, se detecta `window.AndroidPrinter.isNativePrinter()`. Si está, **tiene prioridad**; si falla, cae al flujo normal. En navegador sigue RawBT/`window.print` como hoy — la misma web sirve los 3 casos sin romper ninguna tienda.
- **Build sin Android Studio:** GitHub Actions (`.github/workflows/android.yml`) compila y firma el APK en la nube; se baja de Artifacts y se sideloadea (las Fire ya tienen "orígenes desconocidos" ON). El keystore se genera con **openssl** (formato PKCS12) porque el Mac no tiene Java para `keytool`. Vive en `~/freakie.keystore`, **fuera del repo** — con él se firman todas las versiones futuras. Secretos en GitHub: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`.
- **Fix al recuperar:** el `MainActivity.kt` original cargaba `https://pos.freakiedogs.com`, que **no existe** (NXDOMAIN) — es un nombre aspiracional del MAESTRO (§Fase POS). Se apuntó al deploy real `https://freakie-dogs-caja.vercel.app`.
- **Rescate:** este trabajo nació en una task de **Cowork** en la MacBook y quedó sin commitear (frenó `keytool` por falta de Java). Se recuperó desde el espejo Syncthing (`~/MacBook-Mirror/Documents/Freakies/Claude/freakie-dogs-caja`) copiando **archivos**, no con git: el `.git` de ese espejo está corrupto (Syncthing no replica los objetos — 51 borrados fantasma). **Lección: el espejo Syncthing sirve para archivos, nunca como fuente git.** La fuente de verdad es GitHub.
- Pendiente: generar keystore + cargar secretos + primer run de Actions → probar APK en la Fire de Paseo Venecia (S004). Después: feedback de impresión en pantalla, abrir gaveta, auto-update y rollout a las 8 tiendas.

## 2026-07-26 — Proyecto centralizado en Freakie HQ (Mac mini)
- El repo se clonó en el Mac mini (`~/Proyectos/freakie-dogs-caja`) como parte de mover los proyectos al servidor 24/7 ("Freakie HQ"), accesible desde MacBook y teléfono.
- Se agregó este `CLAUDE.md` + `memoria.md` con el **ritual de inicio estándar** (leer MAESTRO → memoria → Notion), para que cada task entre en contexto igual, ya sea desde terminal o desde Remote Control.
- Se copiaron docs valiosos de la carpeta Cowork (espejada por Syncthing) a `docs/cowork/`: flujo de sesión por PIN del POS, guía de impresión RawBT, plan del Mac mini server, recomendaciones de seguridad, auditorías (code review + QA bugs), índice de migración RLS, descuadre S006 y estrategia de pagos/DTE. Sin binarios ni secretos.
- Notion sigue siendo el espejo maestro; el repo lo referencia por URL. **Nota:** la URL raíz correcta del workspace es `33324fa10edc81f7ade9f52985e6e27e` (🍔 Freakie Dogs ERP); la `36324…` que a veces circula es la subpágina del tablero **EN_PROGRESO — Coordinación Jose/Cesar**.
