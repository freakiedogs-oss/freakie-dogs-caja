# Plan: conectar la estación de pesaje y etiquetado al ERP

> Objetivo: que al pesar e imprimir cada unidad producida en Casa Matriz, el sistema
> descargue las materias primas y empaques según la receta, dé de alta el producto
> terminado en el kardex, y deje trazabilidad por bolsa (lote, peso, vencimiento, quién).
> Después, con pistola de código de barras, que los insumos se descarguen al "pickearlos"
> antes de producir y que la diferencia contra lo producido sea la merma.
>
> Fecha: 01-oct-2026 · Autor: Claude (sesión con Jose) · Estado: **propuesta, pendiente de aprobación**

---

## 0. Punto de partida (lo que ya existe y se reusa)

| Pieza | Estado | Dónde |
|---|---|---|
| Estación de pesaje + Zebra (`/etiquetado.html`) | Funciona, **no guarda nada**. Productos y parámetros en `productos.js` + localStorage. Lote local por día. | `src/etiquetado/*` |
| Motor de producción `registrar_produccion(receta, tandas, …)` | Vivo. Consume BOM × tandas por `kardex_mover('consumo')`, da de alta `tandas × rendimiento` con `kardex_mover('produccion')`, crea `produccion_diaria` + items + lote `LOT-AAAAMMDD-NNN`. Casa Matriz fija (`584aee3c…`). | Supabase (no versionado en repo) |
| Kardex / stock | `inventario(producto, sucursal)` materializado, `kardex_movimientos` como libro. Tipos: `consumo`, `produccion`, `merma`, `traslado`… Todo pasa por `kardex_mover(_lote)`. Negativos permitidos a propósito. | Supabase |
| Recetas | `recetas` (`rendimiento` en unidades del producto por tanda, `catalogo_id`) + `receta_ingredientes` (`factor_a_stock`, `merma_pct`). Misma explosión en los 4 motores. | Supabase |
| Órdenes de producción | `ordenes_produccion` (borrador → aprobada → asignada → completada) con `produccion_id`. | `OrdenesProduccionTab.jsx` |
| Pesaje BPM del chili | `bpm_registro_pesajes`, `bpm_equipos` (básculas con calibración). Es pesaje de **insumos**, no de producto terminado. No toca kardex. | `src/pesaje/*` |
| Fallas conocidas del motor | (1) doble submit sin candado (LOT-…004/005 idénticos), (2) no valida stock, (3) `produccion_diaria.merma` es columna generada que miente, (4) lote con `count(*)+1` (carrera entre dos clientes). | memoria 05-sep, 22-ago |

**Hechos de datos que condicionan el diseño** (verificados en la base el 01-oct):

- Receta `Cheddar Porcionado (Bolsa 2lb)`: rinde 3 bolsas, **solo consume 1 lata**. No tiene la bolsa de vacío como ingrediente. Chili, Escabeche, Mermelada, Salchicha y Cebolla Morada 1 lb sí llevan bolsa (1 por unidad). Sal, Mil Islas, Chipotle, Cebolla Blanca, Truffa y Ranch no.
- Stock CM de los subproductos está muy negativo (Cheddar Porcionado −193 bolsas, Chili −124, Chipotle −382, Cebolla Morada 1 lb −436): no se registra producción desde el 10-sep pero sí se despacha a diario.
- Chili: el ERP rinde **4 bolsas** por tanda; la estación dice bolsa de **5 lb (2,268 g)**; Cesar estimó 207 oz por lote. No cuadra ninguna combinación: hay que pesar una tanda completa.
- `Mermelada de Tocino` y `Cebolla Morada` (vieja) rinden "tanda", no bolsas; la sucursal cuenta bolsas vía `inventario_equivalencias` (×2.18). La estación pesa bolsas → esas recetas tienen que pasar a rendir bolsas, como se hizo con el Cheddar.
- No existe ninguna columna de código de barras en el catálogo. Solo `codigo` (UNIQUE) y `sku`.
- Solo 4 de 12 productos tienen peso objetivo; los días de vencimiento son provisionales (RVP-13 de Mauricio).
- `receta_ingredientes` de Truffa y Ranch tienen unidades cruzadas sin `factor_a_stock` (descuentan mal).

---

## 1. Decisiones de diseño

### 1.1 La "tanda" es `produccion_diaria` con estado, no una tabla nueva
Una corrida de la estación = una fila de `produccion_diaria` que nace **abierta** al elegir producto y se **cierra** al terminar. Así el lote, el costo, el enlace con `ordenes_produccion` y el historial siguen viviendo en un solo lugar. Se agregan columnas; no se duplica el concepto.

### 1.2 Cada bolsa es una fila (`produccion_unidades`)
Peso real, número dentro del lote, vencimiento, quién la pesó, báscula, si se imprimió, y una clave de idempotencia. Es el registro de "peso variable por unidad" (catch weight) que recomienda la práctica: se pesa **una sola vez**; la sucursal después escanea, no vuelve a pesar.

### 1.3 Consumo por **backflush al cierre**, con dos bases distintas
Al cerrar la tanda se calcula una sola vez:

```
tandas_peso     = peso_total_real_g / (rendimiento × peso_nominal_unidad_g)
tandas_unidades = unidades_registradas / rendimiento
```

- Materias primas (cheddar, cebolla, carne…) se descuentan con **`tandas_peso`**: lo que entró es proporcional a lo que salió en masa. Si las 3 bolsas pesaron 2,850 g en vez de 2,721 g, se descuenta 1.05 latas, no 1.
- Empaques (`receta_ingredientes.es_empaque = true`: bolsas de vacío, botes) se descuentan con **`tandas_unidades`**: 3 bolsas = 3 bolsas, nunca 2.91.
- Productos que no se pesan (Ranch bote, Salchicha paquete 25): la tanda se abre en base `unidades` y todo va por `tandas_unidades`.

Esto es lo que Dynamics llama *flushing method* por ítem y Odoo *consumo flexible*. La regla queda explícita en la base, no en la cabeza del operario.

### 1.4 Alta del producto terminado también al cierre, una sola entrada de kardex
Igual que hoy (`registrar_produccion` da de alta en un movimiento). Dar de alta bolsa por bolsa llenaría el kardex de filas (30 por tanda de cebolla) sin ganar nada: el despacho es diario, no por minuto. Una tanda abandonada se cierra sola (ver 1.8).

### 1.5 Una tanda tiene **una sola fuente de consumo por insumo**: `backflush` o `pick`
Preparado desde ahora para la pistola (fase 2), aunque arranque todo en backflush:

- `produccion_diaria.modo_consumo ∈ {backflush, pick}` se fija al abrir.
- En modo `pick`, cada escaneo escribe el `consumo` en el kardex **en ese momento** (referencia = la tanda) y una fila en `produccion_diaria_items` con `origen='scan'` y `cantidad_esperada` (lo que decía el BOM).
- Al cerrar, el backflush **salta todo producto que ya tenga filas `scan`** en esa tanda. Los empaques siguen por unidades. Así no hay doble descuento posible ni por error del operario.
- Lo pickeado que no se usó se devuelve con un botón "Devolver al almacén" (movimiento positivo con la misma referencia), nunca se "pierde".

### 1.6 Merma y rendimiento se calculan, no se declaran
Al cerrar (en modo `pick`, o en backflush si se capturó el peso de entrada):

```
yield_real      = peso_producido_g / peso_insumo_g
yield_esperado  = (rendimiento × peso_nominal) / Σ peso de insumos del BOM        (desde la receta)
merma_real_g    = peso_insumo_g − peso_producido_g
merma_esperada  = peso_insumo_g × (1 − yield_esperado)
varianza_g      = merma_real_g − merma_esperada                                      (+ = peor que receta)
```

Se guardan en la tanda. **No se escribe un movimiento de merma aparte**: en modo `pick` los insumos ya salieron completos del kardex y el producto entró por lo que pesó; la merma es la resta y vive en la tanda para el reporte. Un movimiento extra la contaría dos veces. Lo que sí se registra aparte es la **merma declarada** (se cayó una bolsa, se quemó una olla): botón con motivo, va por `registrar_merma` sobre el producto terminado o el insumo.

### 1.7 Lote por tanda, numerado en el servidor, legible
Se mantiene `LOT-AAAAMMDD-NNN` (ya está en kardex, notas e historial), generado al **abrir** la tanda bajo advisory lock por fecha (hoy es `count(*)+1`, con carrera). Cada unidad lleva `#n` dentro del lote. El `L-0001` local de la tablet desaparece.

### 1.8 Idempotencia y tandas abandonadas
- Todo RPC que escribe recibe `p_client_key uuid` que la tablet genera **antes** de enviar y reusa en cada reintento. Columna UNIQUE; si llega repetido, el RPC devuelve lo ya hecho en vez de duplicar. Esto cierra el hueco del doble submit (LOT-…004/005).
- Vigilante (pg_cron, 23:30 SV): tandas `abierta` con ≥1 unidad y sin actividad en 90 min se cierran como `cerrada_auto` (consumo + alta normales); con 0 unidades se marcan `anulada`. Al abrir la estación, si hay una tanda abierta de esa tablet, se ofrece **retomarla** (ya no se pierde la unidad "pendiente" al cancelar: está en la base).

### 1.9 Parámetros de etiquetado en la base, editables desde el ERP
Tabla `produccion_etiquetado_productos` (uno por producto de catálogo): receta que usa la estación, peso nominal, banda, tara, días de vida útil + estado (`provisional`/`validado` cuando cierre el RVP-13), texto de conservación, nombre corto para la etiqueta, `requiere_peso`, `activo`. Reemplaza a `productos.js` y a los ajustes en localStorage. Se edita desde una pestaña nueva en Producción Diaria.

### 1.10 Etiqueta: QR apunta a la unidad, no lleva los datos adentro
Hoy el QR trae `lote|producto|i/total|g|fecha|hora|quien`. Pasa a ser una URL corta a la ficha de la unidad (`/u/<id corto>`), que cualquier celular abre y que el despacho/recepción podrá escanear en fase 3. La trazabilidad vive en la base; el QR es la llave. Se quita el "/total" (si la tanda se pasa del plan, la etiqueta diría "11 de 10"). Texto legible igual que hoy: producto, lote `#n`, peso lb/g, VENCE. GS1-128 no hace falta para uso interno; queda como opción si algún día un tercero debe leer la etiqueta.

### 1.11 Modo prueba para calibrar sin ensuciar
`es_prueba = true` en la tanda: pesa, imprime, guarda unidades con lote `PRB-…` y **no toca el kardex**. Sirve para calibrar la impresora y para los *yield tests* de la fase 0 (pesar una tanda completa de cada producto).

### 1.12 Lo que se descartó y por qué
| Alternativa | Por qué no |
|---|---|
| Llamar `registrar_produccion` tal cual desde la estación con `tandas = unidades/rendimiento` (1 día de trabajo) | Descuenta empaques fraccionados, sin idempotencia, sin registro por bolsa, lote por `count+1`, y el peso real se pierde. Sirve de parche, no de diseño. |
| Dar de alta bolsa por bolsa en kardex | 30 filas por tanda sin beneficio operativo; la anulación de una unidad igual necesita reversa. |
| Descontar insumos bolsa por bolsa (1/3 de lata por bolsa) | 25 líneas × N bolsas de movimientos para el chili; fracciones ilegibles en el kardex. |
| Sub-almacén "WIP / Producción" para el pick (patrón BC/D365) | Obligaría a una pseudo-sucursal que el conteo y los reportes no conocen. Con referencia a la tanda + botón de devolución se logra lo mismo. |
| Tabla nueva `produccion_tandas` separada | Partiría lote, costo, orden e historial en dos lugares. |

---

## 2. Cambios de base de datos (migraciones versionadas en `supabase/migrations/`)

### M1 — Esquema (sin cambio de comportamiento)

```sql
-- produccion_diaria: la tanda
alter table produccion_diaria
  add column estado text not null default 'cerrada'
      check (estado in ('abierta','cerrada','cerrada_auto','anulada')),
  add column origen text not null default 'manual'
      check (origen in ('manual','orden','estacion')),
  add column modo_consumo text not null default 'backflush'
      check (modo_consumo in ('backflush','pick')),
  add column base_consumo text not null default 'unidades'
      check (base_consumo in ('peso','unidades')),
  add column producto_id uuid references catalogo_productos(id),   -- desnormalizado de recetas.catalogo_id
  add column es_prueba boolean not null default false,
  add column cantidad_planificada numeric,          -- unidades que dijo el operario
  add column unidades_producidas numeric,           -- count de unidades activas al cierre
  add column peso_total_g numeric,                  -- Σ gramos de unidades activas
  add column tandas_equiv numeric,                  -- lo que se usó para el backflush de materias
  add column peso_insumo_g numeric,                 -- fase 2 (pick) o capturado a mano
  add column yield_real numeric, add column yield_esperado numeric,
  add column merma_real_g numeric, add column varianza_g numeric,
  add column abierta_at timestamptz, add column cerrada_at timestamptz,
  add column cerrada_por uuid references usuarios_erp(id),
  add column bascula_codigo text, add column dispositivo text,
  add column bpm_corrida_id uuid references bpm_corridas(id),       -- enlace calidad ↔ inventario (opcional)
  add column client_key uuid unique;
-- `merma` (generada = producida − enviada, siempre miente): se elimina tras verificar que nadie la lee
-- (solo ProduccionDiaria.jsx y OrdenesProduccionTab.jsx leen la tabla; ninguno usa `merma`).
alter table produccion_diaria drop column merma;
create unique index produccion_diaria_lote_uq on produccion_diaria(lote);

-- produccion_diaria_items: origen del consumo
alter table produccion_diaria_items
  add column origen text not null default 'bom' check (origen in ('bom','scan','manual','devolucion')),
  add column cantidad_esperada numeric,            -- lo que decía el BOM (para varianza)
  add column kardex_id uuid references kardex_movimientos(id),
  add column client_key uuid unique;
-- CHECK cantidad_consumida > 0 se relaja para permitir devoluciones negativas con origen='devolucion'.

-- receta_ingredientes: base de consumo
alter table receta_ingredientes add column es_empaque boolean not null default false;
-- Semilla: true donde el producto es categoría 'Empaques y Desechables' o nombre ~* 'bolsa de vac|bote'. Revisar a mano.

-- Unidades (catch weight)
create table produccion_unidades (
  id uuid primary key default gen_random_uuid(),
  produccion_id uuid not null references produccion_diaria(id) on delete cascade,
  numero int not null,
  gramos numeric,                                   -- null si requiere_peso = false
  fuera_banda boolean not null default false,
  vence date,
  pesado_por_id uuid references usuarios_erp(id), pesado_por text,
  bascula_codigo text,
  impresa boolean not null default false, impresiones int not null default 0,
  etiqueta jsonb not null,                          -- snapshot de lo impreso (reimpresión idéntica)
  estado text not null default 'activa' check (estado in ('activa','anulada')),
  anulada_motivo text, anulada_por uuid, anulada_at timestamptz,
  codigo_corto text not null unique,                -- lo que va en el QR (/u/<codigo>)
  client_key uuid not null unique,
  created_at timestamptz not null default now(),
  unique (produccion_id, numero)
);

-- Parámetros de etiquetado
create table produccion_etiquetado_productos (
  producto_id uuid primary key references catalogo_productos(id),
  receta_id uuid not null references recetas(id),   -- la receta que usa la estación (resuelve Cebolla Morada ×2)
  nombre_etiqueta text not null,
  requiere_peso boolean not null default true,
  peso_nominal_g numeric, banda_g numeric, tara_g numeric default 0,
  vida_util_dias int not null, vida_util_estado text not null default 'provisional'
      check (vida_util_estado in ('provisional','validado')),
  conservacion text, orden int default 0, activo boolean not null default true,
  updated_by uuid, updated_at timestamptz default now()
);

-- Fase 2: códigos de barra
create table catalogo_barcodes (
  codigo text primary key,                          -- EAN/UPC/GS1 tal cual lo lee la pistola
  producto_id uuid not null references catalogo_productos(id),
  cantidad numeric not null default 1,              -- unidades de stock por escaneo (1 lata, o 6 si es la caja)
  descripcion text, creado_por uuid, created_at timestamptz default now()
);
```

RLS/grants: mismo patrón que `ordenes_produccion` — `SELECT` a anon/authenticated en las tablas nuevas (la tablet lee por el proxy `/sb`), **escrituras solo vía RPC SECURITY DEFINER**. Sin `empresa_id`: producción es solo Freakie (igual que `produccion_diaria` hoy).

### M2 — Refactor de `registrar_produccion` sin cambiar su resultado
Se parte en internos reutilizables y la función pública queda con la **misma firma y el mismo efecto**:

- `_produccion_abrir(receta, origen, modo, base, planificada, responsable, usuario, fecha, client_key, es_prueba) → produccion_diaria` (lote bajo `pg_advisory_xact_lock(hashtext('lote-'||fecha))`).
- `_produccion_consumir(produccion_id, tandas_materia, tandas_empaque, excluir uuid[])`: la misma explosión de hoy (`cantidad × factor_a_stock × (1+merma%)`, sub-recetas con catálogo se descuentan, sin catálogo se avisan), eligiendo la base por `es_empaque` y saltando `excluir`.
- `_produccion_alta(produccion_id, unidades)`.
- `registrar_produccion(...)` = abrir + consumir(p_cantidad, p_cantidad, '{}') + alta(p_cantidad × rendimiento) + cerrar. **Invarianza probada con huella md5** sobre las 177 producciones históricas re-simuladas en dry-run (`begin … raise exception … rollback`), como se hizo con `factor_a_stock` el 22-ago.
- Costo: `costo_total = Σ produccion_diaria_items.costo_linea` (hoy es `tandas × receta_costo_total`; con pick el costo real es lo consumido). Para backflush puro da lo mismo al centavo.

### M3 — RPCs de la estación (todas SECURITY DEFINER, con `p_client_key`)

| RPC | Hace | Devuelve |
|---|---|---|
| `produccion_tanda_abrir(p_producto_id, p_cantidad_planificada, p_responsable_id, p_dispositivo, p_bascula_codigo, p_es_prueba, p_orden_id?, p_client_key)` | Lee `produccion_etiquetado_productos` → receta, base. Crea la tanda `abierta` con lote. Si `p_orden_id`, valida que esté `asignada` para esa receta. Idempotente por `client_key`. | `{produccion_id, lote, receta, producto, peso_nominal_g, banda_g, vida_util_dias, items_esperados[]}` |
| `produccion_unidad_registrar(p_produccion_id, p_gramos, p_pesado_por_id, p_bascula_codigo, p_client_key)` | `FOR UPDATE` sobre la tanda (debe estar `abierta`), `numero = max+1`, calcula `vence` (fecha SV + días), `fuera_banda`, arma `etiqueta` jsonb y `codigo_corto`. Idempotente. | `{unidad_id, numero, lote, vence, etiqueta, codigo_corto}` → la tablet imprime con esto |
| `produccion_unidad_impresa(p_unidad_id, p_ok)` | Marca `impresa`, suma `impresiones`. | — |
| `produccion_unidad_anular(p_unidad_id, p_motivo, p_usuario_id)` | Tanda abierta: solo marca `anulada`. Tanda cerrada: además `kardex_mover(producto, CM, 'merma', −1, 'produccion_unidad', …)` si motivo es físico (se rompió), o `ajuste_manual` si fue error de registro (exige nota ≥5, como hoy). | — |
| `produccion_tanda_cerrar(p_produccion_id, p_usuario_id, p_peso_insumo_g?, p_client_key)` | `FOR UPDATE`; cuenta unidades activas y Σ gramos; `tandas_peso`/`tandas_unidades`; `excluir` = productos con items `scan`; `_produccion_consumir` + `_produccion_alta(unidades)`; yield/merma/varianza; `estado='cerrada'`; si vino de orden, `ordenes_produccion.estado='completada'`. `es_prueba` → sin kardex. Idempotente: si ya está cerrada devuelve el resumen. | `{lote, unidades, peso_total_g, tandas_equiv, consumos[{producto, cantidad, stock_posterior}], faltantes[] (quedaron en negativo), avisos[], costo_total, yield_real, varianza_g}` |
| `produccion_tanda_anular(p_produccion_id, p_motivo, p_usuario_id)` | Abierta: `anulada`, unidades `anuladas`. Cerrada (solo jefe): reversa cada movimiento de kardex con referencia a la tanda (signo contrario, `referencia_tipo='produccion_anulacion'`). | — |
| `produccion_tanda_abierta(p_dispositivo)` | Para retomar al abrir la estación. | tanda + unidades |
| `produccion_pick_escanear(p_produccion_id, p_codigo, p_usuario_id, p_client_key)` **(fase 2)** | Resuelve `catalogo_barcodes` (si no existe → `{desconocido:true}` y la UI pide asociarlo); `kardex_mover('consumo', −cantidad, 'produccion', tanda)`; item `origen='scan'` con `cantidad_esperada` del BOM. | `{producto, cantidad_acumulada, esperada}` |
| `produccion_pick_devolver(p_produccion_id, p_producto_id, p_cantidad, …)` **(fase 2)** | Movimiento positivo + item `origen='devolucion'`. | — |
| `produccion_tandas_vigilante()` **(pg_cron 23:30 SV)** | Cierra/anula abandonadas (1.8). | `{cerradas, anuladas}` |

Validación de stock: se mantiene `permitir_negativo = true` (política vigente: el negativo delata), pero `cerrar` devuelve `faltantes[]` y la tablet lo muestra en rojo: "Se descontó 1 lata de Cheddar y el sistema tenía 0: avisá a almacén".

---

## 3. Cambios de frontend

### 3.1 Estación (`src/etiquetado/`)
- **Datos desde la base**: lista de productos = `produccion_etiquetado_productos` activos (join receta/catálogo). `productos.js` y los ajustes en localStorage se eliminan.
- **Quién pesa**: picker de `usuarios_erp` con `store_code='CM001' and es_productor` (mismo criterio que Producción Diaria), guardado por el día en la tablet como hoy. Sin PIN (tablet dedicada, decisión vigente); el id del usuario va en cada unidad.
- **Flujo**: producto → cuántas → `produccion_tanda_abrir` (muestra lote real) → por unidad: pesar → `produccion_unidad_registrar` → imprimir (en pares como hoy; la "pendiente" ya está en la base) → `produccion_unidad_impresa`. Si la impresión falla, la unidad **queda registrada** con `impresa=false`, la pantalla bloquea el avance hasta reimprimir o anular ("la bolsa no existe"). Hoy la regla es "no se cuenta": cambia porque la bolsa física ya existe; lo peligroso es una bolsa sin etiqueta, y eso se resuelve reimprimiendo, no borrando.
- **Terminar** → `produccion_tanda_cerrar` → pantalla de resumen con consumos reales, faltantes en rojo, yield (si aplica), costo. Botón "Merma declarada" (motivo) y, en fase 2, "Devolver insumo".
- **Retomar**: al abrir, si `produccion_tanda_abierta(dispositivo)` devuelve algo, se ofrece continuar o anular.
- **Reimprimir** desde la base (`etiqueta` jsonb), no desde el estado de React: funciona después de recargar.
- **Modo prueba** visible como chip amarillo; lote `PRB-`.
- **ZPL**: `zebraZpl.js` se mantiene; recibe `etiqueta` del servidor. QR = `https://freakie-dogs-caja.vercel.app/u/<codigo_corto>`.
- Se corrigen de paso: lote por tanda, cancelación con pendiente, conteo del resumen con total impar, fecha de vencimiento calculada en servidor en hora SV.

### 3.2 ERP (`src/components/admin/`)
- `ProduccionDiaria.jsx`: filtrar `estado in ('cerrada','cerrada_auto')` en historial y totales; detalle con unidades (peso por bolsa, quién, fuera de banda); `cargarDetalle` deja de recalcular y lee `produccion_diaria_items` (hoy recalcula sin `factor_a_stock`, puede no coincidir con lo descontado).
- Pestaña nueva **"🏷️ Etiquetado"**: CRUD de `produccion_etiquetado_productos` (peso nominal, banda, días + estado provisional/validado, conservación, receta). Solo `jefe_casa_matriz`, `ejecutivo`, `admin`.
- `OrdenesProduccionTab.jsx`: una orden `asignada` aparece en la estación como sugerencia al abrir tanda de ese producto.
- Página pública `/u/<codigo>` (mínima): ficha de la unidad (producto, lote, peso, elaborado, vence, estado). Solo lectura por RPC `produccion_unidad_ficha(codigo)`.

### 3.3 Fase 2, pistola
- En la estación, antes de pesar: pantalla **"Insumos de la tanda"** con la lista esperada del BOM; cada escaneo suma (verde al llegar a lo esperado, ámbar si se pasa). Códigos desconocidos → "¿Qué producto es?" → se aprende en `catalogo_barcodes`.
- Pistola USB/BT en modo teclado (HID): no requiere WebUSB; un `<input>` oculto con foco captura el código + Enter. Funciona en Android Chrome y en PC.
- Recepción (`RecepcionTab.jsx`): opción de escanear para asociar EAN al producto recibido, así el catálogo de códigos se llena solo con las compras.

---

## 4. Fases y orden de ejecución

### Fase 0 — Datos (Cesar + Mauricio, 1–2 días; bloquea todo lo demás)
1. **Bolsa en las recetas**: agregar bolsa de vacío a Cheddar (12x14, 1 por bolsa), Sal, Mil Islas, Chipotle, Cebolla Blanca, Truffa (confirmar empaque real de cada uno). Marcar `es_empaque` en todas las líneas de bolsa/bote.
2. **Yield test por producto** (usando la estación en modo prueba): pesar una tanda completa de Cheddar, Chili, Cebolla morada, Escabeche, Mil Islas, Chipotle, Mermelada → `peso_nominal_g`, `banda_g` y corrección de `rendimiento`. Resuelve el choque Chili 4 bolsas vs 5 lb.
3. **Recetas que rinden "tanda" → bolsas**: Mermelada de Tocino (hoy 4 tandas, equivalencia ×2.18) y Cebolla Morada (unificar en la de bolsa 1 lb; desactivar la vieja tras reapuntar consumidoras).
4. **Unidades cruzadas**: Truffa (cucharada/bote → oz) y Ranch (unidad → oz) con `factor_a_stock` (vista `v_recetas_unidades_sin_factor`).
5. **Días de vida útil**: cargar los provisionales actuales con `vida_util_estado='provisional'`; Mauricio los pasa a `validado` al cerrar RVP-13.
6. **Conteo físico de arranque en CM** de los subproductos (`kardex_ajustar_absoluto`): con −193 bolsas de cheddar, la primera alta real "paga deuda" y nadie confía en el número.
7. Salchicha reempacada: el producto de salida es `materia_prima`; pasar a `sub_producto` (cosmético, pero ordena reportes).

### Fase 1 — Backflush por peso + unidades + lote de servidor (≈1 semana)
M1 → M2 (con huella de invarianza) → M3 → estación → pestaña Etiquetado → vigilante. Salida a producción **solo con Cheddar** (piloto ya validado) una semana; luego el resto a medida que la fase 0 complete cada producto. La estación conserva `es_prueba` para seguir calibrando.

### Fase 2 — Pistola y merma por diferencia (≈1 semana, al llegar el hardware)
`catalogo_barcodes`, `produccion_pick_*`, pantalla de insumos, aprendizaje de códigos en recepción, reporte semanal de yield real vs esperado por producto y operario.

### Fase 3 — Trazabilidad aguas abajo (después)
Escaneo del QR en despacho y recepción (unidad → sucursal, FEFO por `vence`), enlace `bpm_corrida_id` para el chili, cola offline en la tablet (IndexedDB con las mismas `client_key`), posible GS1-128 si un tercero lo exige.

---

## 5. Pruebas antes de pushear
- **SQL**: cada migración se prueba con el patrón del equipo `begin; … raise exception 'ok: …'; rollback` sobre la base viva, y M2 con la huella md5 de las 177 producciones re-simuladas (debe ser idéntica).
- **Escenarios de cierre** (dry-run): 3 bolsas cheddar exactas (1 lata, 3 bolsas); 3 bolsas pesadas (1.05 latas, 3 bolsas); tanda impar; tanda con unidad anulada; cierre repetido con la misma `client_key` (no duplica); tanda `es_prueba` (cero kardex); pick + backflush del mismo producto (el backflush lo salta); vigilante sobre una abandonada.
- **Estación**: `npm run build` sin errores; Playwright a 1,400 px y 390 px como hace el equipo con BPM; prueba en la tablet real con la Rhino y la Zebra en modo prueba antes de la primera tanda real.
- **Anti-regresión**: `git pull --rebase origin main && git status` antes de cada `git add`; no tocar `App.jsx`/`config.js` sin marcarlo en EN_PROGRESO.

---

## 6. Las cinco revisiones del plan (errores encontrados y cómo quedó)

**Pasada 1 — aritmética del consumo.** Error: usar un solo escalar `tandas` descontaba 2.91 bolsas al pesar 3 bolsas livianas. Corrección: dos bases (`tandas_peso` para materias, `tandas_unidades` para empaques) y `es_empaque` explícito en la línea de receta (1.3). Error 2: `costo_total = tandas × costo_receta` deja de ser cierto con pick. Corrección: Σ `costo_linea` de los items (M2).

**Pasada 2 — doble descuento con la pistola.** Riesgo: pick + backflush del mismo insumo. Corrección: exclusión por producto en el cierre (1.5) y merma calculada en la tanda sin movimiento extra (1.6). Riesgo 2: insumos pickeados y no usados desaparecían. Corrección: `produccion_pick_devolver`.

**Pasada 3 — concurrencia e idempotencia.** Error heredado: lote por `count(*)+1` (dos tablets, mismo lote). Corrección: advisory lock + índice único en `lote`. Error: doble submit (ya ocurrió el 05-sep). Corrección: `client_key` UNIQUE en tanda, unidad, item y cierre. Error: dos `produccion_unidad_registrar` simultáneos podían repetir `numero`. Corrección: `FOR UPDATE` sobre la tanda + UNIQUE `(produccion_id, numero)`.

**Pasada 4 — operación real en piso.** Error: "si falla la impresión la pesada no se cuenta" borra una bolsa que físicamente existe. Corrección: queda registrada `impresa=false` y se bloquea hasta reimprimir o anular (3.1). Error: la unidad "pendiente" del par se perdía al cancelar. Corrección: está en la base; se retoma. Error: "7 de 10" en la etiqueta miente si la tanda se pasa del plan. Corrección: solo `#7`. Error: tanda abierta y olvidada nunca consume. Corrección: vigilante (1.8). Error: productos que no se pesan (Ranch, Salchicha) no cabían en el flujo. Corrección: `requiere_peso=false` y base `unidades`. Faltaba: alta de arranque en CM (stock −193) y una tanda de "prueba" para calibrar sin ensuciar (1.11).

**Pasada 5 — datos y alcance.** Error: asumir que la receta de Cheddar consume la bolsa (no la consume). Corrección: fase 0 ítem 1. Error: Chili 4 bolsas vs 5 lb; Mermelada y Cebolla Morada rinden "tanda" y la estación pesa bolsas. Corrección: yield test y pasar esas recetas a bolsas (fase 0, ítems 2–3). Error: `inventario_equivalencias` puede desviar el alta a un producto distinto del que cuenta la sucursal (Cebolla Blanca SP-003 → "Cebolla bolsa"). Corrección: revisar las 9 equivalencias activas en fase 0; el alta debe caer en el producto que se cuenta. Error: eliminar `merma` generada sin ver dependientes. Verificado: ninguna pantalla la lee. Error: `cantidad_producida` cambiaría de significado. Corrección: sigue siendo tandas (`= tandas_equiv`) y las unidades van en `unidades_producidas`, así los reportes viejos no se rompen.

---

## 7. Decisiones que necesitan a Jose / Cesar antes de empezar
1. ¿Se aprueba que el consumo de materias primas sea **proporcional al peso real** y no a las unidades? (1.3)
2. ¿Confirmamos que una bolsa con impresión fallida **queda registrada** y se reimprime, en vez de descartarse? (3.1)
3. ¿Qué bolsa lleva cada producto que hoy no la tiene en receta? (fase 0, ítem 1)
4. ¿Unificamos Cebolla Morada en la receta de bolsa 1 lb y pasamos Mermelada a bolsas? (fase 0, ítem 3)
5. ¿Autorizan el conteo físico de arranque en CM para los subproductos? (fase 0, ítem 6)
6. Pistola: ¿USB o Bluetooth en modo teclado? (cualquiera sirve; define si va en la tablet o en una PC de recepción)
