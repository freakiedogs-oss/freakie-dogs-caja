# Plan — Desempeño de meseros, meta de extras, propina por cumplimiento y CRM de domicilios

> Pedido de **Jazz** (Jazmín, admin de Plaza Cafetalón M001 / Santa Tecla), WhatsApp 29-oct y 31-oct-2026.
> Análisis hecho el 2-nov-2026 con datos reales de Supabase de los últimos 30 días.
> Estado: **PLAN, no construido.** Las decisiones que tiene que tomar Jazz o Jose están marcadas con ❓.

---

## 1. Qué pidió Jazz

**Herramienta A: meseros**
1. Medir a cada mesero por su **ticket promedio**. Ya existe.
2. Ponerle a cada mesero una **meta diaria de venta de extras** y ver cuánto vendió cada uno por día. No existe.
3. Usar esa meta para **repartir la propina por porcentaje**:
   - Si el mesero cumple la meta, recibe el 100 % de su parte.
   - Si no la cumple, recibe el 50 %.
   - Jazz explicó el motivo: «la propina es demasiado alta como para no esforzarse más».

**Herramienta B: domicilios en Santa Tecla**
4. Sacar **nombre y teléfono de los clientes de domicilio** de M001 para mandarles un mensaje con imagen que los traiga de vuelta.
5. Ponerle a **Karina** una **meta de domicilios** que cuente para su porcentaje de propina.

**Además:** Jazz quiere que le expliquen cómo funcionan las metas y el incremento del ticket. Se resuelve con una guía corta (fase 5).

---

## 2. Qué tenemos hoy en el ERP

| Pieza | Dónde está | Estado |
|---|---|---|
| Ticket promedio por empleado | `KpisVentaDashboard` → tab Por Empleado, RPC `obtener_ventas_empleado` (suma a `coalesce(mesero_id, cajero_id)`) | ✅ Funciona desde el 1-ago (POS interno) |
| Detalle de lo vendido | `pos_cuenta_items`: `precio_modificadores`, `componentes[].modificadores[]` con `precio_extra`, y categoría vía `pos_menu_items.categoria_id` | ✅ Alcanza para medir extras sin tocar el POS |
| Cubiertos por mesa | `pos_cuentas.pax_total` | ✅ 100 % de las mesas lo traen, así que se puede medir el ticket por persona |
| Incentivo por persona en vivo | Agrandados y tocino: `agrandado_config`, `fn_agrandados_panel`, `AgrandadoChip` en el POS | ✅ Es justo el patrón que necesitamos, pero **empareja por nombre de texto** (`pos_cocina_queue.mesero`) |
| Propina mensual | `propinas_diarias` → `propina_evaluacion_mensual` / `_detalle` → `PropinasView` → planilla | ✅ Hoy es binaria: gana o no gana. Fórmula: total × 90 % ÷ (ganadores + 1 de producción) |
| Metas de venta | `metas_ventas`, `vista_performance_vs_meta` | ⚠️ **Muerta desde el 25-mar-2026** (no hay filas después) |
| Metas de delivery | `metas_delivery` | ⚠️ **Vacía**, y no tiene `sucursal_id` (solo año y mes) |
| Clientes de domicilio | `delivery_clientes`: nombre, teléfono, dirección, ítems y total | ✅ M001 tiene **3,069 pedidos** desde el 30-jul, con **2,023 teléfonos únicos** y 100 % con teléfono |

---

## 3. Qué dice la data (M001, mesas, últimos 30 días)

### 3.1 Extras por persona
Extras de prueba = modificadores pagados (tocino, queso, etc.) + ítems de *Extras*, *Fries & Sides* y *Cervezas*. Sin bebidas.

| Quién cobró la mesa | Cuentas | Días | Extras $/día | Extras $/cuenta | Ticket | Ticket/pax |
|---|---|---|---|---|---|---|
| Camila (mesero) | 549 | 26 | **36.63** | 1.73 | 25.75 | 12.75 |
| Elmer Manuel (mesero) | 464 | 25 | 30.59 | 1.65 | 26.73 | 13.35 |
| Oscar (mesero) | 144 | 8 | 27.39 | 1.52 | 24.10 | 12.74 |
| Karla (mesero) | 201 | 15 | 18.35 | 1.37 | 24.31 | 12.16 |
| *cajera* Miliana | 308 | 26 | 15.28 | 1.29 | 16.67 | 8.50 |
| *cajera* Hazel Astrid | 163 | 13 | 13.20 | 1.05 | 23.30 | 11.67 |

**Conclusión:** la herramienta se puede construir con lo que ya registra el POS. Hay diferencias reales entre meseros: Camila vende 26 % más de extras por cuenta que Karla. Una meta tiene de dónde agarrarse.

### 3.2 Problemas de datos que hay que arreglar antes de pagar con esto

1. **Mesas sin mesero.** Si la propina va a depender de la meta, cada venta tiene que tener dueño.
   - **M001:** el 27 % de las mesas no tiene `mesero_id`. Las cobran cajeras (Miliana, Hazel) y Jazmín.
   - **S004 Venecia:** el 66 % de las mesas no tiene `mesero_id`. Hay un solo mesero registrado; las mesas las toman los cajeros Katherine, Henry y Josué.
   - **S003:** el 89 % tiene mesero. Está bien.
2. **Domicilios sin quién los tomó.** Las 966 cuentas `delivery_propio` de M001 en 30 días tienen `cajero_id = NULL`. Hoy funciona porque Karina es la única que atiende domicilios. Si un día la cubre otra persona, no se sabe quién tomó cada pedido.
3. **Metas apagadas.** `metas_ventas` no genera nada desde marzo y `metas_delivery` está vacía. Jazz pregunta por «las metas» y en el sistema no hay metas vigentes.
4. **Agrandados emparejados por nombre de texto.** Ya causó dos incidentes:
   - Ramsés vendía bajo la config de «Rigoberto».
   - Hubo 575 cuentas cobradas con el PIN de Super Admin.
   - La herramienta nueva usa `usuarios_erp.id` y nunca nombres.
5. **«Karina» no aparece en `usuarios_erp` de M001.** El usuario de domicilios activo se llama **Katherine**. ❓ Confirmar si es la misma persona o si Karina factura con otro PIN.

### 3.3 Domicilios M001 (30-jul a hoy)
- 2,023 clientes (por teléfono):
  - 1,470 pidieron **una sola vez** (73 %).
  - 448 pidieron 2 o 3 veces.
  - 85 pidieron entre 4 y 6.
  - 20 pidieron 7 o más.
- Unos 675 clientes pidieron antes pero **no en los últimos 30 días** («dormidos»). Son la audiencia natural del mensaje de Jazz.
- 1,046 pedidos en los últimos 30 días, unos 35 al día.

---

## 4. Diseño

### Principios (para que dure)
- **Un solo motor de incentivos.** No hacemos otra tabla suelta como `agrandado_config`. Armamos un modelo genérico de *programas de incentivo*: extras, domicilios, y más adelante agrandados y tocino migran ahí.
- **Todo por `usuario_id`.** Nunca por nombre.
- **Reglas en tablas, no en código.** Jazz o el gerente cambian qué cuenta como extra, la meta y los tramos sin un deploy.
- **Medir primero, pagar después.** Dos semanas de línea base sin consecuencias. Las metas salen de esos números, no de una corazonada.
- **El cálculo de la propina vive en la base** (función SQL), no en `PropinasView`. Hoy la fórmula está duplicada en el front (`calcMontoPorPersona`).
- **Por sucursal y multi-local.** Arranca en M001 y se enciende en S003 y S004 por configuración.

### 4.1 Modelo de datos (migraciones nuevas)

```text
incentivo_programas
  id, store_code, tipo ('extras_mesero' | 'domicilios'), nombre,
  activo, vigente_desde, vigente_hasta,
  unidad ('usd' | 'pedidos'), base_meta ('dia_trabajado' | 'mes'),
  afecta_propina bool, creado_por, notas

incentivo_reglas_extras          -- qué cuenta como "extra" (por programa)
  programa_id, tipo ('modificador_pagado' | 'categoria' | 'item' | 'excluir_item'),
  ref_id / ref_nombre, peso (1.0 por defecto)
  -- default M001: modificadores con precio>0 + categorías Extras, Fries & Sides, Cervezas

incentivo_metas                  -- meta por persona (o default del programa)
  programa_id, usuario_id NULL (=todos), meta_dia_semana numeric,
  meta_fin_semana numeric, vigente_desde

incentivo_tramos                 -- cómo pega en la propina
  programa_id, desde_pct, factor   -- ej. [0 → 0.50], [100 → 1.00]
```

**Funciones (todas por `usuario_id`, con zona horaria America/El_Salvador):**
- `fn_extras_mesero(store, desde, hasta)` devuelve, por usuario y por día:
  - cuentas, pax, venta y ticket;
  - ticket por pax;
  - extras en $;
  - % de cuentas con algún extra.
  - Ventas anuladas o canceladas, y cortesías, quedan afuera.
- `fn_incentivo_panel(usuario_id, fecha)` devuelve lo de hoy, la meta de hoy, lo acumulado del mes, la meta del mes (días trabajados × meta del día), el % de cumplimiento y la proyección. La usa el chip del POS.
- `fn_cumplimiento_mes(programa, mes)` devuelve el % por persona. Los días trabajados salen de `asistencia_diaria`. Si falta la asistencia, cuentan los días con ventas.

**Cambios a tablas que ya existen:**
- `propina_evaluacion_detalle` suma `cumplimiento_pct`, `factor_aplicado` y `monto_base`. Así queda auditado por qué alguien cobró el 50 %.
- `metas_delivery` suma `store_code`, o se reemplaza por `incentivo_metas` con un programa `domicilios`.
- `pos_cuentas`: en mesas, `mesero_id` pasa a ser obligatorio. Para domicilios se llena `cajero_id`, o un `tomado_por` nuevo.

### 4.2 Reparto de propina con cumplimiento

Hoy cada ganador recibe: `parte = total × 90 % ÷ (ganadores + 1 producción)`.

Propuesta:
1. Se calcula la **parte base** igual que hoy.
2. A cada mesero con programa activo se le aplica el **factor** del tramo que alcanzó: 100 % o más → 1.0; menos de 100 % → 0.5. Los tramos son configurables. Más adelante se pueden agregar, por ejemplo: 80 % → 0.75 o 120 % → bono.
3. **Lo que se retiene** se redistribuye entre quienes sí cumplieron, en partes iguales. ❓ Decisión de Jose y Jazz. Recomiendo redistribuirlo: refuerza el incentivo y la propina sigue siendo del personal. Hay que validar con el contador que la propina retenida no quede en la empresa.
4. El gerente sigue pudiendo quitarle la propina a alguien por conducta, que es la regla de hoy. La meta es un filtro adicional, no reemplaza ese criterio.
5. `PropinasView` muestra, por empleado, la barra de cumplimiento, el factor y el monto final. El gerente solo confirma; ya no se calcula a mano.

❓ **¿A quién aplica?** Propuesta: solo a quien atiende mesas (rol mesero, y cajeros que toman mesas si se les asigna el programa). Cocina y producción quedan como hoy.
❓ **¿Las bebidas cuentan como extra?** En M001 las bebidas suman $6.6k al mes, contra $1k de extras puros. Si cuentan, la meta pierde sentido, porque casi todo combo ya lleva bebida. Recomiendo **no** contarlas, salvo las cervezas, que ya están incluidas.

### 4.3 Meta diaria: cómo fijarla de forma justa
- Un sábado no es un martes. Por eso hay **dos valores**: entre semana y fin de semana.
- Se **liquida por mes**, igual que la propina. La meta mensual de cada persona = Σ meta del día por cada día que trabajó. Así nadie pierde la propina por un mal día o un turno corto, y la meta diaria sirve de guía en vivo.
- Valor inicial sugerido para M001:
  - Al terminar la línea base, el **percentil 60** de extras por día de los meseros.
  - Con la data de hoy daría unos **$28 entre semana y $40 en fin de semana**, solo como referencia.
  - Camila ya cumpliría, Elmer quedaría cerca y Karla tendría que subir.
- Revisión trimestral, cargada en `incentivo_metas` con `vigente_desde`. Así se guarda el historial de metas.

### 4.4 Pantallas

1. **POS: chip del mesero.** Se reutiliza el patrón de `AgrandadoChip`. Muestra «Extras hoy **$18.50 / $28** ▓▓▓▓░ · mes 92 %». Cuando el mesero agrega un extra, aparece un flotante verde. Lo ven solo los usuarios con programa activo.
2. **ERP: «Desempeño Meseros»**, para Jazz, el gerente y el ejecutivo.
   - Ranking por período con:
     - ticket promedio y ticket por pax;
     - extras en $ por día y por cuenta;
     - % de cuentas con extra;
     - cumplimiento de la meta.
   - Se puede abrir el detalle diario de cada mesero.
   - Pestaña **Configurar**: qué cuenta como extra, metas y tramos.
   - Una alerta de **calidad de datos**: «X mesas hoy sin mesero asignado».
3. **ERP: `PropinasView`** con la evaluación integrada (ver 4.2).
4. **Mi Desempeño** (portal del empleado): cada mesero ve su progreso del mes. Es transparencia, y evita reclamos al momento del pago.

### 4.5 Herramienta B: CRM de domicilios + meta de Karina

**Lista de clientes, `fn_clientes_delivery(store)`:**
- Agrupa por teléfono normalizado.
- Devuelve nombre más reciente, n.º de pedidos, primer y último pedido, días sin pedir, ticket promedio y producto favorito.
- Segmentos:
  - **Nuevo:** 1 pedido en los últimos 14 días.
  - **Recurrente:** 3 o más pedidos.
  - **Dormido:** sin pedir hace más de 21 días.
  - **VIP:** 7 o más pedidos, o top 10 % en gasto.

**Pantalla «Clientes Domicilio»** (rol `domicilios` y admin de la sucursal):
- Filtrar por segmento.
- Botón **WhatsApp** por cliente: abre `wa.me/503XXXXXXXX?text=<plantilla>` con el nombre ya puesto.
- Plantillas editables, por ejemplo: «¡Hola {nombre}! 🍔 Te extrañamos en Freakie Dogs Santa Tecla…».
- La imagen la adjunta Karina desde su teléfono. WhatsApp no permite adjuntarla por enlace.
- Cada envío queda registrado en `crm_contactos`: cliente, quién, cuándo, plantilla.
- **Conversión:** si el teléfono vuelve a pedir dentro de 7 días, se marca el contacto como *convertido*. Eso le da a Jazz el retorno real de la estrategia.
- **Exclusión:** si el cliente pide no recibir mensajes, se marca y se esconde para siempre.
- **No hay exportación masiva a Excel.** Son datos personales: se ven en pantalla y se trabajan uno por uno.

**Meta de Karina:** un programa `domicilios` en M001.
- Unidad: pedidos de delivery propio entregados.
- Indicadores secundarios: clientes reactivados y conversión de contactos.
- Pesa en su factor de propina igual que los extras en el de los meseros (tramos configurables).
- Línea base: unos 35 pedidos al día hoy.

❓ **Envío automático.** ¿Algún día se manda masivo desde la WhatsApp Business API? Es posible, pero exige plantillas aprobadas por Meta, costo por mensaje y consentimiento explícito. Lo dejo como fase futura; el clic manual alcanza para empezar.

---

## 5. Fases

| Fase | Qué | Duración | Depende de |
|---|---|---|---|
| **0. Definiciones + higiene** | Jazz contesta los ❓. En el POS, abrir mesa exige elegir mesero (por defecto, quien abre). Domicilio guarda quién lo tomó. Reporte de mesas sin mesero. | 2–3 días | — |
| **1. Medir** | Tablas de programa y reglas, `fn_extras_mesero` y la pantalla Desempeño Meseros (solo lectura). Se arreglan `metas_ventas` (cron) y `metas_delivery` (con sucursal). | 1 semana | F0 |
| **2. Línea base** | 2 semanas midiendo sin consecuencia. Los meseros ya ven el chip. Se calibran metas con Jazz. | 2 semanas | F1 |
| **3. Metas en vivo** | `incentivo_metas` y tramos, chip con meta, Mi Desempeño. | 3–4 días | F2 |
| **4. Propina por cumplimiento** | `fn_cumplimiento_mes`, columnas nuevas en el detalle, `PropinasView` integrada y planilla. **Primer mes con pago real = el mes completo después de la F3.** | 1 semana | F3 |
| **5. CRM domicilios** | `fn_clientes_delivery`, pantalla, plantillas, `crm_contactos`, conversión, meta de Karina. Guía para Jazz sobre metas y ticket. | 1 semana (puede ir en paralelo desde la F1) | F0 |
| **6. Consolidar** | Migrar agrandados y tocino al motor de incentivos y apagar el emparejamiento por nombre. Encender en S003 y S004. | Después | F4 |

**Fecha realista del primer pago con la regla nueva:** la propina de **diciembre**, si la F0 y la F1 salen esta semana. Avisar al equipo con anticipación cuál es la regla. Cambiar la regla a mitad de mes genera reclamos.

## 6. Riesgos y cómo se cubren
- **Meseros que «roban» mesas o se pasan cuentas:** el dueño de la cuenta es `mesero_id`. Mover una cuenta queda en el log (`movido_por`).
- **Extras inflados con cortesías o anulaciones:** las cortesías y los ítems anulados no cuentan.
- **Meta injusta por turno corto:** la meta se calcula por día trabajado, con valores distintos para entre semana y fin de semana.
- **Cambios de regla sin rastro:** las metas y los tramos tienen `vigente_desde`. La evaluación guarda el factor aplicado.
- **Privacidad de clientes:** solo pantalla, por sucursal, con RLS por rol, registro de quién contactó y lista de exclusión.

## 7. Preguntas para Jazz (antes de la F0)
1. ¿Qué cuenta como «extra»? Propuesta: modificadores pagados + Extras + Fries & Sides + Cervezas, sin bebidas.
2. ¿La regla aplica solo a meseros, o también a las cajeras que atienden mesas?
3. El 50 % que pierde quien no cumple: ¿se reparte entre los que cumplieron?
4. ¿Karina es el usuario «Katherine» (domicilios M001)?
5. Su mensaje se cortó en «Por otra…»: ¿qué más pedía?
