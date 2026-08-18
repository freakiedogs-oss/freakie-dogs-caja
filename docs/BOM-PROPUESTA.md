# BOM del menú — propuesta para aprobación

> Borrador de trabajo. **Nada está en la DB todavía.** Se revisa ítem por ítem con Jose en el chat
> (orden: más unidades vendidas primero) y al final va un insert masivo por
> `set_menu_item_componentes` + `pos_combo_componentes`.
>
> Data base: `pos_cuenta_items` 11-abr → 17-ago-2026 · 39,083 líneas · $308,403.
> Costos: motor real `costo_producto()` (promedio ponderado de compras DTE).
> ✅ dato dado por Jose · 🟡 pendiente · ⬜ propuesto por mí, sin revisar.

## 🔴 COSTEO DE LOS 8 ÍTEMS CERRADOS — con el aceite adentro

| Ítem | Precio | Costo | Food cost | Unidades |
|---|---|---|---|---|
| Combo Hamburguesa | $7.50 | $3.79 | **50.6%** | 6,766 |
| Burger Duo | $14.99 | $7.59 | **50.6%** | 4,934 |
| La Clasica | $7.99 | $3.85 | **48.2%** | 1,641 |
| Burger Box | $19.50 | $8.71 | **44.7%** | 1,467 |
| Coca-Cola Combo / Combo Freakie Dog | $3.99 | $1.76 | **44.1%** | 4,954 |
| Freakie Dog (solo) | $1.99 | $0.48 | 24.0% | 1,777 |
| Coca-Cola Vidrio | $1.75 | $0.37 | 21.1% | 2,374 |

⚠️ **El aceite de freír cambió el panorama.** Cuesta **$0.439 por porción de papa** — casi lo mismo que
la papa ($0.447). Nunca estuvo en ninguna receta. Al meterlo, los combos pasan de ~40% a **~50% de
food cost**, cuando lo sano en fast-casual es 28–32%.
Faltan todavía: salsas, vegetales, pepinillos y escabeche → **el food cost real es aún más alto.**

📌 Contexto del aceite: 485 bidones en 4.6 meses ÷ 6 sucursales = **~330 L por sucursal por mes**.
Vale revisar si todo eso es fritura o hay desperdicio.

## Conversiones aprendidas (se preguntan una sola vez)

| Producto | Compra | Costo | Conversión | Fuente |
|---|---|---|---|---|
| Mezcla de Carne Smash (tarea) | 97.5 lb carne cruda | $512.86 → **$5.26/lb** | 🟡 rendimiento real en lb tras merma | calculado |
| Papa Sazonadas 30lb | libra | **$1.2766/lb** | directo | catálogo |
| Pan Brioche 2.8oz | unidad | **$0.3794** | directo | catálogo |
| MQ LAC Procesado (queso) | lb | **$2.4339/lb** | 🟡 lascas por paquete de 3lb | catálogo |
| Coca-Cola Vr 354ml | caja 24 | $8.85 → **$0.3688/botella** | 1/24 | catálogo |
| Cajitas de papas | caja 4500 | $45.134 → **$0.0100 c/u** | 1/4500 | catálogo |
| 95816 Mantequilla | barra | $13.00 | 🟡 peso de la barra | catálogo |

---

## BLOQUE: Hamburguesa Sencilla (armada) — sub_receta, rinde 1 unidad

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| [SUB] Mezcla de Carne Smash | **0.30 lb** (2 bolitas de 0.15) | $1.578 | ✅ Jose |
| Pan de Hamburguesa Brioche 2.8oz | 1 unidad | $0.379 | ✅ Jose |
| Queso MQ LAC Procesado | **0.22 lb** (2 lascas de 0.11 c/u) | $0.536 | ✅ Jose (confirmado 2 veces) |
| [SUB] Sal de Hamburguesa | 2 espolvoreadas | 🟡 | 🟡 falta estándar en gramos |
| [SUB] Cebolla Morada | 3 aros completos | 🟡 | ✅ Jose · falta peso del aro |
| [SUB] Pepinillos Rebanados | 4 unidades | 🟡 | ✅ Jose (se rebanan en CM) |
| Salsa Mil Islas | **2 oz** | 🟡 | ✅ Jose |
| 95816 Mantequilla (para el pan) | **5 g** | 🟡 | ✅ Jose · falta peso de la barra de $13 |
| **Subtotal conocido** | | **$1.96** | sin queso/salsa/sal/vegetales |

✅ **Queso cerrado:** 2 lascas × 0.11 lb = **0.22 lb por hamburguesa**. Jose marcó aparte que la
conversión de **compra** del queso está mala (a revisar después; no afecta la cantidad física registrada).

---

## ÍTEM 1 — Combo Hamburguesa · 6,766 u · $54,019

Menús: Para Llevar $7.50 (58.2%) · Local $7.50 (21.8%) · PedidosYa $7.99 (16.8%) · Delivery $7.99 (2.5%) · Drive Thru $7.50 (0.7%)

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| [BLOQUE] Hamburguesa Sencilla | 1 | $2.49+ | ✅ |
| [BLOQUE] Papa Sazonada | **0.35 lb** | **$0.447** | ✅ Jose |
| Salsas de papa (ketchup, mayonesa, chipotle, cheddar) | **1 oz cada una**, van **sobre** las papas (sin cups) | 🟡 | ✅ Jose · **se descargan según la elegida en el POS**, no fijas |
| Bebida (Coca 300ml o Kolashampan) | 1 | $0.369 | ✅ **NO va en mesa (21.8%)**; sí en los otros 4 canales (78.2%). Si agrandan, la opción se vuelve cualquier bebida |
| Cajita de papas | 1 | $0.010 | ✅ |
| Papel brandeado | 1 | $0 sin DTE | ✅ |
| Bandeja café (**solo mesa**) | 1 | $0 sin DTE | ✅ Jose — proveedor Desechables Diversos |
| Tenedor | 1 | $0 sin DTE | ✅ Jose |
| Servilleta | 1 | $0 sin DTE | ✅ Jose |

**Costo parcial: $3.32** (carne+pan+queso+papa+bebida+cajita) → **44% de food cost sobre $7.50**,
y todavía faltan salsas, sal, vegetales, mantequilla y empaque. ⚠️ Señal de negocio, ver abajo.

---

---

## ÍTEM 2 — Burger Duo · 4,934 u · $76,023 (el que más factura)

Los 5 menús a **$14.99**. Descripción: *"2 Hamburguesas + 2 Fries + 2 Bebidas"*.
Grupos: `Complementos Hamburguesa` + `Complementos Hamburguesas 2` + `Salsas Papas` + `Salsas Papas 2`.

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| [BLOQUE] Hamburguesa Sencilla | 2 (idénticas a la del combo) | $4.98 | ✅ Jose |
| [BLOQUE] Papa Sazonada | 2 × 0.35 lb, **porciones separadas** | $0.894 | ✅ Jose |
| Salsas de papa | **2 tandas independientes** (1 oz c/u, por eso hay Salsas Papas y Salsas Papas 2) | 🟡 | ✅ Jose |
| Bebida (Coca 300ml / Kolashampan) | 2 | $0.738 | ✅ **NO va en mesa**, igual que el ítem 1 |
| Papel brandeado | 2 | $0 sin DTE | ✅ Jose |
| Bolsa brandeada | **1 sola** | $0 sin DTE | ✅ Jose |
| Servilleta | **4** (2 por hamburguesa) | $0 sin DTE | ✅ Jose |
| Tenedor | **4** (2 por hamburguesa) | $0 sin DTE | ✅ Jose |
| Bandeja/cajita de papa | 2 (una por porción) | $0.020 | 🟡 confirmar si es la cajita de papas o una bandeja |

**Costo parcial: $6.63** → **44% de food cost** sobre $14.99, igual que el ítem 1, y faltan salsas y vegetales.
Nota de negocio: 2 Combo Hamburguesa sueltos = $15.00 vs Duo $14.99 → **1 centavo de descuento**.

---

---

## BLOQUE: Freakie Dog armado — sub_receta, rinde 1 unidad

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| Pan HOT DOG Berna 10X60 GR | 0.1 bolsa (1 pan) | **$0.142** | ✅ Jose (Pineli) — identificado en 175 facturas, última 8-ago |
| Salchicha Parowski | 1 unidad | **$0.330** | ✅ Jose |
| Ketchup | 1 oz | 🟡 | ✅ Jose |
| Mayonesa | 1 oz | 🟡 | ✅ Jose |
| [SUB] Escabeche | 1 oz | 🟡 | ✅ Jose |
| Chipotle | 0.5 oz | 🟡 | ✅ Jose |
| Cheddar | 0.5 oz | 🟡 | ✅ Jose |
| [SUB] Cebolla **Blanca** | 1 oz | 🟡 | ✅ Jose |
| Pepinillo triturado | 0.5 oz | 🟡 | ✅ Jose |
| **Subtotal conocido** | | **$0.472** | sin salsas |

## ÍTEM 3 — Coca-Cola Combo · 2,666 u · $11,014

$3.99 en Local/Llevar/Delivery/Drive Thru · **PedidosYa $4.50**.
✅ Jose: **es un combo de hot dog** (no una bebida). = Freakie Dog + papas + bebida.

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| [BLOQUE] Freakie Dog armado | 1 | $0.472 | ✅ |
| [BLOQUE] Papa Sazonada | 0.35 lb + salsas 1 oz c/u | $0.447 | ✅ igual que el ítem 1 |
| Bebida | 1 | $0.369 | ✅ misma dinámica (no va en mesa) |
| Cajita para armar | 1 | $0.010 | ✅ **solo para llevar y delivery** |

**Costo parcial $1.298 → 33% de food cost**, el más sano de los tres hasta ahora.

✅ **Jose confirma: "Coca-Cola Combo" y "Combo Freakie Dog" son EL MISMO PRODUCTO.**
→ Este BOM cubre los dos ítems: **4,954 u · $20,717**.
→ ⚠️ Señal aparte: hay un **ítem duplicado en el menú del POS** que conviene consolidar.

## ÍTEM 4 — Coca-Cola Vidrio · 2,374 u · $4,154 · $1.75

**97% se vende en mesa** (2,311 de 2,374) — confirma que en mesa la bebida va aparte del combo.
Mapeo **directo a producto**, sin receta.

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| Gaseosa Coca-Cola Vr 354ml | 1 botella (1/24 caja) | $0.369 | ✅ |

Margen 79%. 🟡 ¿lleva pajilla? 🟡 ¿el envase retornable se controla aparte?

## ÍTEM 5 — Freakie Dog (solo) · 1,777 u · $3,572 · $1.99 en los 5 canales

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| [BLOQUE] Freakie Dog armado | 1 | $0.472 | ✅ |
| Papel brandeado | 1 pliego | $0 sin DTE | ✅ Jose (**siempre**, los dos canales) |
| Polipel | 1 | 🟡 | ✅ Jose (**solo para llevar**) |

**24% de food cost** — el mejor del menú hasta ahora.
🟡 Polipel: hay 3 entradas en catálogo (rollo fardo $46.56 · unidad $0 · Fardo La Económica $42.48).
Falta saber **cuántas hojas trae un fardo**.

## ÍTEM 6 — La Clasica · 1,641 u · $13,570 · $7.99

Para Llevar 86% · Delivery · Local · Drive Thru. ✅ Jose: **es la hamburguesa normal + lechuga y tomate**
(los $0.50 extra).

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| [BLOQUE] Hamburguesa Sencilla | 1 (las 2 bolitas normales) | $2.490 | ✅ Jose ("panita" fue error del transcript) |
| Lechuga escarolada | 1 rebanada = **1/40 lb** | $0.0375 | ✅ Jose: **40 rebanadas por libra** ($1.50/lb) |
| Tomate | 2 rodajas = **2/64 lb** | $0.0217 | ✅ Jose: **64 rodajas por libra** ($0.693/lb) |

| [BLOQUE] Papa Sazonada | 0.35 lb + salsas | $0.447 | ✅ Jose (corrección: **sí lleva papas**) |
| Bebida | 1 | $0.369 | ✅ Jose · 🟡 dijo "cuando es delivery" — ¿o es en todos menos mesa? |

**Costo $3.00 sin bebida / $3.36 con bebida → 37–42% de food cost.**

⚠️ Corrección: en una versión previa de este doc dije que La Clasica no llevaba papa ni bebida y saqué
una conclusión errada de pricing. **La Clasica es un combo completo**, igual que el Combo Hamburguesa,
y cobra $0.49 más por lechuga + tomate que cuestan $0.06. Eso sí tiene lógica comercial.

## ÍTEM 7 — Burger Box · 1,467 u · $29,386

Local $19.50 · Para Llevar $19.50 · Delivery $19.99 · Drive Thru $19.50

✅ Jose confirma la estructura que decían los grupos de modificadores. **La descripción del menú
("Caja: 4 sliders + Fries + Bebidas") está MAL y hay que corregirla en el POS.**

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| [BLOQUE] Hamburguesa Sencilla | 2 | $4.980 | ✅ Jose |
| [BLOQUE] Freakie Dog armado | 2 | $0.944 | ✅ Jose |
| Costra de queso (**en uno solo de los 2 dogs**) | **3 oz** de CM MIX (Quesos de Oriente) | **$0.532** | ✅ Jose (corregido: 3 oz, no 2) |
| Peperoncinis (1 orden) | 2 unidades | $0.184 | ✅ Jose |
| [BLOQUE] Papa Sazonada | 2 × 0.35 lb | $0.894 | ✅ Jose |
| Bebida | **2 siempre** (una es Coca-Cola) | $0.738 | ✅ Jose — **este sí lleva bebida en todos los canales** |

| Bolsa brandeada | **2** (con los empaques ya listados) | $0 sin DTE | ✅ Jose |
| Papel aluminio | 2 (una por hamburguesa, solo llevar/domicilio) | 🟡 | ✅ Jose |

**Costo parcial $7.556 → 39% de food cost.**
Insumos candidatos: `Mezcla 3 quesos de costra bolsa 2.27 kg` ($0) o `Queso mozzarella de costra
paquete 5 lbs` ($0) · `Pepperonchini En Vinagre Monteverde 2.2KG` **$7.37/bote**.

## BLOQUE: Super Freak armado — sub_receta

✅ Jose: **es un hot dog**, no lleva carne smash. La receta vieja (carne 0.375 lb + queso 0.5 lb) está MAL
y la descripción del menú es la correcta.

| Componente | Cant | Costo | Estado |
|---|---|---|---|
| Pan Hot Dog Brioche 2.2oz **en aro** (Flamo) | 1 | **$0.3275** | ✅ identificado en 128 facturas |
| **Salchicha Parowski** | 1 | **$0.330** | ✅ Jose — **la misma para TODOS los hot dogs** |
| **Papa Blanca** (encima del hot dog) | 8 papas = **0.1 lb** | $0 sin mapear | ✅ Jose — ojo: papa **blanca**, no sazonada |
| Salsa Mil Islas | **0.5 oz** | 🟡 falta $/oz | ✅ Jose |
| Cheddar | **0.5 oz** | 🟡 falta $/oz | ✅ Jose |
| Tocino Ahumado Chimex | **0.05 lb** (0.0227 kg) | **$0.163** | ✅ Jose ($7.17/kg) |
| **Subtotal conocido** | | **$0.820** | sin mil islas/cheddar/papa blanca |

## ÍTEM 9 — Combo Super Freak · 1,211 u · $7,365 · $5.99 en los 5 canales ✅ CERRADO

| Componente | Cant | Costo |
|---|---|---|
| [BLOQUE] Super Freak armado | 1 | $0.820 |
| [BLOQUE] Papa Sazonada + salsas | 0.35 lb | $0.447 |
| Bebida (todos menos mesa) | 1 | $0.369 |
| Cajita para armar + polipel + papel brandeado | | $0.029 |

**Costo $1.664 → 27.8% de food cost.** El mejor combo del menú.
⚠️ `Papa Blanca 20lb` tiene costo **$0** — hay que mapearle su factura.

## LOTE BEBIDAS — ✅ Jose: **hay que crear el ítem de catálogo para todas**

| Ítem POS | Unidades | Precio | Producto de catálogo | Acción |
|---|---|---|---|---|
| Coca-Cola Vidrio | 2,374 | $1.75 | Gaseosa Coca-Cola Vr 354ml | ✅ ya existe, $0.369 |
| Coca Zero Vidrio | 965 | $1.75 | — | **CREAR** |
| Crema Soda Vidrio | 956 | $1.75 | — | **CREAR** |
| Agua | 693 | $1.00 | Agua Cristal Pet 600ml 1x24 ($7.96) | **CREAR/enlazar** — $0.332 |
| Té Frambuesa | 480 | $1.75 | Te Lipton Frambuesa fardo 24 (sin costo) | **CREAR** |
| Fresa Vidrio | — | $1.75 | — | **CREAR** |

Todas van con **pajilla**. ⚠️ Duplicado a limpiar: `Te Lipton Frambuesa 340 Ml Lata` tiene **$13.36 por
lata** — es el precio del fardo cargado como unidad (mismo bug de unidades).

---

## REGLAS DE EMPAQUE POR CANAL (transversales, aplican a todo el menú)

| Empaque | Mesa (comer aquí) | Para llevar / Delivery |
|---|---|---|
| Papel brandeado | ✅ siempre | ✅ siempre |
| **Papel aluminio** (toda hamburguesa) | ❌ | ✅ **1 por hamburguesa** |
| Bandeja Eco 2P Kraft ($0.0594) | ✅ | ❌ |
| Cajita para armar (papas) | ❌ | ✅ |
| Polipel (Freakie Dog) | ❌ | ✅ |
| Bolsa brandeada | ❌ | ✅ |
| **Bebida del combo** | ❌ (se vende aparte) | ✅ |
| Excepción: **Burger Box** | lleva sus 2 bebidas siempre | igual |

⚠️ Estas reglas **no se pueden expresar hoy**: `set_menu_item_componentes` aplica el mismo BOM a los 5
canales. Confirma que extender la función para aceptar BOM por canal es **obligatorio**, no opcional.

---

## Hallazgos en las facturas de compra (18-ago)

Ninguna de estas líneas está mapeada (`producto_id` NULL) — por eso los empaques cuestan $0:

| Descripción en la factura | Proveedor | Precio | Volumen |
|---|---|---|---|
| **BANDEJA FREAKIE DOGS, 37 BULTOS DE 4,500 U** | Empaques Ecológicos | **$0.0235 c/u** | 166,500 u |
| **BANDEJA ECO 2P KRAFT DD FSC MIX** | Plásticos Diversos | **$0.0594 c/u** | 36,500 u |
| PAN HOT DOG BERNA 10X60 GR | Ind. Cárnicas Pineli | $1.42/bolsa 10 | 24,648 |
| SALCHICHA PARÓWSKI UNIDAD | Ind. Cárnicas Pineli | $0.33 | 80,988 |
| TENEDOR GRANDE FARDO-1000 | Dicrigo Empaques | $8.85/fardo | — |

⚠️ La cajita de papas: la factura dice **$0.0235 c/u** ($105.75 el bulto de 4,500) pero el catálogo
tiene **$45.134 por caja** ($0.0100 c/u). Hay que revisar cuál es el precio vigente.

---

## Problema estructural: el BOM no distingue canal

`set_menu_item_componentes` hace `UPDATE pos_menu_items SET producto_id=... WHERE lower(btrim(nombre))=lower(nombre)`
→ **aplica el mismo BOM a los 5 canales**. Pero según Jose:
- la **bebida** no va incluida en Para Llevar ni mesa (= 80% de las ventas de este ítem)
- la **bandeja café** solo aplica a mesa (21.8%)

No se puede modelar con la estructura actual. Opciones: (a) ponderar por el mix real de canales,
(b) extender `set_menu_item_componentes` para aceptar BOM por canal. **Pendiente de decisión de Jose.**

## Insumos que faltan por mapear (costo $0 hoy)
Bandeja café · papel brandeado · tenedor · servilleta · pajilla · bolsa brandeada · Mil islas ·
Chipotle · Cebolla morada · Pepinillos · Ketchup y Mayonesa en sobre.

## CONVERSIONES PENDIENTES (bloquean el costeo de todo el menú)

✅ **Papel aluminio:** $0.015 por hamburguesa (Jose) → **0.001 rollo** (997 hamburguesas por rollo
Selectos 153m × 0.30m de $14.96). Se registra en fracción de rollo, no en costo.
✅ **Polipel = `POLIPEL ROLLO FARDO`** (el rollo de film, $39.23–46.02 el fardo), NO la bolsa gabacha.

### ✅ RESUELTAS (Jose, 18-ago)

| Qué | Dato | Conversión resultante |
|---|---|---|
| **Mezcla de Carne Smash** | tarea = 97.5 lb **ya boleada**, bolita = 0.15 lb. La merma ya está en la receta de la tarea | **650 bolitas/tarea** = **325 hamburguesas**. Rendimiento de la receta debe pasar de `1 tarea` a **97.5 lb**. Costo bolita $0.789 → **$1.578/hamburguesa** |
| **Ketchup / Mayonesa / Cheddar / Chipotle** | **0.2 oz** cada una (✅ confirmado: "es 0.2, no una onza") | reemplaza el "1 oz" dicho al inicio |
| **Mil Islas** | **2 oz**, solo en la hamburguesa, en nada más | ✅ |
| **Cheddar** | ya existe la receta del porcionado; se entrega en galón | ✅ |
| **Polipel** | **medio centavo por hot dog** | 0.000109 fardo/hot dog (fardo $46.02) |
| **Sal de Hamburguesa** | **~500 hamburguesas por bolsa** | 0.002 bolsa/hamburguesa |
| **Cebolla morada** | 3 aros = **20 g** | 0.0441 lb por hamburguesa |
| **Mantequilla** | **0.5 g por pan**, y son **$13.00 por kg** (no media libra) | **$0.0065/pan** — alerta anterior descartada |
| **Aceite de freír** | 485 bidones despachados 31-mar→17-ago = **$15,879** | ÷ 36,169 porciones de papa = **$0.439/porción** |
| **La Clasica — bebida** | en todos los canales **excepto mesa** | igual que el Combo Hamburguesa |
| **Coca-Cola Vidrio** | **sí lleva pajilla** | — |
| **Costra de queso** | **2 oz de Mozzarella de costra** (paquete 5 lb) | 0.025 paquete |
| **Peperoncinis** | **2 por orden**; bote 2.2 kg trae **~80** | $7.37/80 = $0.0921 c/u → **$0.184/orden** |
| **Cajita para armar** | **$0.0235 es el precio correcto** (el de la factura) | corregir el catálogo, que dice $0.0100 |

### 🟡 SIGUEN ABIERTAS

| # | Qué falta | Estado |
|---|---|---|
| 1 | **Salsas: ¿0.2 oz o 1 oz?** Jose dijo 1 oz para las papas y 1 oz en el hot dog, y ahora 0.2 oz "para todo lo gratis" | ⚠️ 5× de diferencia, bloquea casi todos los ítems |
| 2 | **Aceite de freír** — Jose va a pasar el despacho semanal por sucursal | esperando dato |
| 3 | **Pepinillo triturado** — Jose lo pasa desde la orden de producción | esperando dato |
| 4 | **Escabeche** — la tanda se define más adelante | esperando dato |
| 5 | Bebida de **La Clasica**: ¿solo delivery o todos menos mesa? | respuesta cortada |
| 6 | Coca-Cola Vidrio: ✅ **sí lleva pajilla** (Jose). ¿El envase retornable se controla como inventario? | falta solo el envase |

⚠️ **Alerta mantequilla:** $13.00 la media libra = **$26/lb**. Es 5× el precio de la carne ($5.26/lb) y
sale a **$0.287 por hamburguesa** — más que las 2 lascas de queso ($0.536 las dos, $0.268 cada una).
Vale revisar si es mantequilla clarificada, si el precio está mal, o si son 5 g de más.

## ✅ PASO 1 APLICADO A LA DB (18-ago) — migraciones `bom_*`

**Diagnóstico correcto:** el motor NO estaba roto. `costo_producto()` ya divide por `factor_compra`;
lo que faltaba era **llenar ese campo**. Corrección: no todos estaban en 1 — papas y aros ya lo tenían
(20, 30, 27, 42); solo se tocaron 35.

| Qué | Antes | Ahora |
|---|---|---|
| Carne por hamburguesa | $583.76 | **$1.5866** |
| Mezcla Carne Smash | $1,945.86 "1 tarea" | **$515.64 / 97.5 lb = $5.2886/lb** |
| Papa Sazonada (porción) | $1.7872 (pedía 1.40 lb) | **$0.4468** (0.35 lb) |
| Sal de Hamburguesa | $0.0018/bolsa | **$6.9579/bolsa** → $0.0139/hamburguesa |
| **Queso (lasca)** | 0.11 **lb** = $0.268 | **11 g = $0.0596** ← el error estaba acá |
| Salsa Mil Islas | $7.53/bolsa | **$0.2353/oz** (16 bolsas × 32 oz) |
| Salsa Chipotle | $3.30/bolsa | **$0.1032/oz** |
| Cheddar Porcionado | $3.4484/bolsa | **$0.1078/oz** |
| Chili | $24.37/bolsa | **$0.7617/oz** |

Migraciones aplicadas: `bom_factor_compra_y_rendimiento_carne`, `bom_fix_botes_condimentos_20oz`,
`bom_normalizar_cantidades_a_unidad_base`, `bom_rendimiento_salsas_en_onzas`.
Cada una lleva su ROLLBACK documentado en el comentario.

⚠️ Las conversiones cucharada→8 g y cucharadita→2.7 g son **estimación mía**, quedaron marcadas
con `[revisar]` en las notas de cada línea de receta para que cocina las valide.

### BLOQUE Hamburguesa Sencilla — costeo actual

| Componente | Cant | Costo |
|---|---|---|
| Mezcla Carne Smash | 0.30 lb | $1.5866 |
| Pan Brioche 2.8oz | 1 | $0.3794 |
| Queso MQ LAC | 2 lascas de 11 g | $0.1192 |
| Salsa Mil Islas | 2 oz | $0.4706 |
| Sal de Hamburguesa | 1/500 bolsa | $0.0139 |
| Mantequilla | 0.5 g | $0.0065 |
| Cebolla morada 3 aros (20 g) · Pepinillos 4 u | | 🟡 pendiente |
| **TOTAL conocido** | | **$2.576** |

### 🔴 Sigue abierto para cerrar el costeo

| Qué falta | Detalle |
|---|---|
| **ml por bote de Aceite de Trufa** | pide 62.5 ml × $19.51/bote = **$1,219** → Salsa Truffa a $9.79/oz |
| Rendimiento en oz de **Escabeche, Cebolla Morada, Mermelada de Tocino** | rinden en "tanda" |
| Factor de **Mostaza Dijon** (nombre dice 2X105OZ) y **781060 MS Mayo** (galón) | mismo patrón |
| Onzas por bote de **pepinillo triturado** | Freakie Dog |
| **Aceite de freír** | datos de despacho no confiables (ver arriba) |

## ✅ PASO 2 APLICADO (18-ago) — mapeo de facturas de empaque

**Trampa encontrada:** cada proveedor factura en una unidad distinta (la misma servilleta viene como
caja de 12 paquetes a $32.39 en una factura y como paquete suelto a $2.70 en otra). Mapear a ciegas
divide el costo dos veces. Solo se mapeó donde la unidad fue verificada contra `factor_compra`.

| Producto | Resultado |
|---|---|
| Tenedores grandes (fardo 1000) | **$0.00885 por tenedor** |
| Servilleta XPRESS | **$0.0054 por servilleta** |
| Bandeja Eco 2p Kraft (mesa) | **$0.0714** |
| Pepinillos Vlasic 1.36 L / 46 oz | **$0.1442/oz** |
| Mostaza Dijon (2 botes × 105 oz) | **$0.0330/oz** |
| MS Mayo (galón = 128 oz) | **$0.0989/oz** |

🔴 **Cajita de papas — conflicto sin resolver.** Dos presentaciones en el mismo item de catálogo:
factura de enero = bulto de **4,500** a $0.0235/u · recepciones de agosto = `CARTON 100 CAJA-1000UNDS`
a $45.134. `costo_producto` prioriza recepciones, así que gana la de agosto. Se dejó factor 1000
(**$0.0451/cajita**, provisional). **Jose tiene que confirmar cuál se compra hoy** — puede que sean
dos productos distintos que hay que separar.

🔴 **Aceite de trufa — discrepancia.** Jose dijo bote de 1000 ml; la factura de **Calleja** del 3-ago
dice `ACEITE OLIVA EXT/VIRG TRUFA BONOL **250 mL**` ($19.51). 4× de diferencia. **No se aplicó.**

### Sin mapear todavía (falta un dato)
| Producto | Qué falta |
|---|---|
| Polipel rollo fardo | hot dogs por fardo (Jose dijo $0.005 c/u) |
| Papel aluminio | hay 3 productos distintos en PriceSmart ($9.55 / $24.15 / $33.21) — cuál usan |
| Papel brandeado · Bolsas brandeadas | no aparecen en las facturas con ese nombre |
| Papa Blanca 20lb | sin factura mapeada |

## ✅ PASO 3 — Conversión por DTE (18-ago)

Idea de Jose: *"cada DTE debería tener su conversión sugerida, pero editable para ese único DTE"*.
La evidencia que lo prueba, en sus propias facturas de Empaques Ecológicos:
**BOLSAS #12 vinieron en bultos de 1,700 en enero y de 1,400 en mayo.**

- Columna nueva **`compras_dte_items.factor_conversion`** (NULL = usa `catalogo_productos.factor_compra`).
- **`costo_producto()` reescrita**: pondera por unidades base → `sum(cant*precio)/sum(cant*factor)`.
  Algebraicamente idéntica a la anterior si todos los factores son NULL → **retrocompatible**.
- **`sugerir_factor_dte(descripcion, cantidad)`** → jsonb `{factor, confianza, regla, detalle}`.
  Corre al importar el DTE; la sugerencia es editable por línea.

**Probada contra 12 descripciones reales: 12/12 correctas.**

| Patrón | Sugiere |
|---|---|
| `37 BULTOS DE 4,500 UNIDADES` (cant. 166,500) | **1** — detecta que el DTE ya viene por unidad |
| `12X500 HOJAS` | 6000 |
| `10X60 GR` | 10 (piezas de 60 g, no 600) |
| `FARDO-1000 UNDS` · `DE 75 UNID.` · `fardo 24 unidades` | 1000 · 75 · 24 |
| `BONOL 250 mL` · `1.36 L` · `2.50Kg` · `1 kg` | 250 · 1.36 · 2.50 · 1 |
| `1x24 un` | 24 |

⚠️ Bug encontrado al probar: **PostgreSQL usa `\y` para límite de palabra, no `\b`** (que es backspace).
Las reglas fallaban en silencio. Corregido en v3.

## 🔴 Análisis de empaque por sucursal (ventanas de POS alineadas)

| Sucursal | Días POS | Burgers llevar | Rollos alum | **Burgers/rollo** | Hot dogs | Polipel | **HD/polipel** |
|---|---|---|---|---|---|---|---|
| Grand Plaza Lourdes | 20 | 1,762 | 3 | **587** | 1,073 | 8 | 134 |
| Plaza Mundo Usulután | 26 | 1,667 | 3 | **556** | 1,199 | 8 | **150** |
| Paseo Venecia | 25 | 961 | 2 | **481** | 538 | 4 | 135 |
| Plaza Mundo Soyapango | 43 | 3,091 | 9 | **343** | 1,471 | 18 | **82** |
| Plaza Cafetalón (CM) | 130 | 1,957 | 70 | **28** | 1,531 | 167 | **9** |
| Metro Centro | 43 | **10,440** | **0** | — | 6,563 | 2 | 3,282 |

**Tres conclusiones:**
1. **Plaza Cafetalón es Casa Matriz** — 28 burgers por rollo vs 343–587 del resto (20×). Sus despachos
   son entrada a bodega central, no consumo. Hay que excluirla de todo análisis de eficiencia.
   Explica también la anomalía del aceite ($0.55/porción vs $0.07–0.25 del resto).
2. **Metro Centro no recibe empaque por despacho**: 0 rollos de aluminio y 2 de polipel, siendo la
   sucursal más grande (10,440 burgers en 43 días). Mismo patrón que el aceite. **O compra local, o no
   se registra el despacho.**
3. **Soyapango es consistentemente el menos eficiente** de las sucursales reales: 343 burgers/rollo
   (vs 587 de Lourdes, **71% más consumo**) y 82 hot dogs/polipel (vs 150 de Usulután, **83% más**).
   Esa sí es una señal operativa real.

Base sin CM ni Metro Centro: **440 burgers por rollo** · **113 hot dogs por unidad de polipel**.

## ✅ PASO 4 APLICADO (18-ago) — los modificadores ya pueden descargar inventario

- **Tabla nueva `pos_modificador_insumos`** (modificador → N insumos, producto o receta).
  Es 1:N a propósito: *"Con Todo"* (8,899 elecciones, el más pedido) son **4 salsas de un tirón**.
- **`pos_deducir_inventario` v3**: ahora explota tres fuentes en vez de una —
  1. la receta del ítem padre (como antes),
  2. los **componentes elegidos** en el combo picker (`pos_cuenta_items.componentes`),
  3. los **insumos de los modificadores** elegidos, incluidos los anidados dentro de cada componente.
  Conserva recursión por sub_receta, freno en sub-producto contado, idempotencia y permitir_negativo.
- Probada en producción sobre una cuenta real: corre sin error, devuelve
  `{"ok":true,"n":0,"nota":"sin insumos mapeados"}` — correcto, porque el BOM aún no está cargado.

⚠️ **REGLA ANTI-DOBLE-CONTEO** (queda documentada en la función, la UI debe validarla):
si un combo tiene componentes en `pos_combo_componentes`, su propio BOM debe contener **solo lo
propio del combo** (empaque). Las hamburguesas, papas y bebidas entran por los componentes.

### Modificadores cargados y costeados

| Modificador | Insumo | Costo |
|---|---|---|
| Golden Cheese | 9 lascas de 11 g, mozzarella Lácteos del Corral ($3.45/lb) | **$0.753** |
| Costra de Queso | **3 oz** de CM MIX, Quesos de Oriente ($6.2518/kg) | **$0.532** |
| Coca Cola 300ml | 1 botella | $0.369 |
| Kolashampan | 1 lata | $0.258 |
| Tocino | 2 lascas · 16 g c/u ⚠️ peso estimado por Claude | $0.232 |
| Escabeche | 2 oz | **$0.131** (era $1.508 antes del fix) |
| Cheddar · Chipotle | 0.2 oz | $0.022 · $0.021 |

### 🔴 El canal es una dimensión del BOM (3ra aparición)

Jose (18-ago): **el mismo modificador consume insumos distintos según el canal**.
Ketchup y mayonesa **en mesa** salen del **galón** por dispensador (0.2 oz); **para llevar/delivery/PeYa**
se dan **sobres** (portion pack). Antes ya había pasado con el empaque y con la bebida del combo.

→ Columna **`pos_modificador_insumos.canales text[]`** (NULL = todos) + helper
`pos_modificador_insumos_de(mod_id, canal)`.
→ **`pos_deducir_inventario` v4** resuelve el canal de la cuenta y filtra los insumos por él.

### Fix del Escabeche (iba en TODOS los Freakie Dog)

Daba **$181 la tanda** = $12/lb de cebolla en vinagre. Cuatro ingredientes con el bug de unidades:
repollo pedía 5 "unidades" pero cobraba **5 sacos de $29** ($145, el 80% del error); sazonador 1
"cucharada" a precio de bolsa de 2 kg; mostaza 2 "cucharadas" a precio de galón; zanahoria 2
"unidades" a precio de caja.
Datos de Jose: saco = **10 repollos**, caja de zanahoria = **5 lb (~12.5 unidades)**.
**Resultado: $15.73 la tanda → $0.0655/oz.** 11.5× más barato.

🟡 **Falta:** cuántos **sobres** de ketchup/mayonesa se dan por orden para llevar · a qué producto
apunta **BBQ** · el detalle del **jalapeño** (Jose se cortó a media frase) · validar el peso real de
la lasca de tocino.

## Corrección del análisis de consumo — con Quanto incluido

Jose corrigió dos supuestos míos y los dos eran errores reales:
1. **Cafetalón NO es casa matriz**, es sucursal. La anomalía era PedidosYa faltante.
2. **Metro Centro** recibe despachos solo desde el **9-ago**; antes pedía fuera de sistema.

**22,476 pedidos de PedidosYa nunca entraron al POS** entre abril y julio (M001 sola: 9,386).
Desde agosto la integración funciona (diferencias ≈ 0).

Fuentes combinadas sin solapamiento: **Quanto abr–jul** (no incluye PeYa) + **PeYa** + **POS agosto**.

| Sucursal | Burgers | Rollos alum | Burg/rollo | HD/polipel |
|---|---|---|---|---|
| Plaza Mundo Usulután | 8,296 | 9 | 922 | 114 |
| Plaza Mundo Soyapango | 17,751 | 36 | 493 | 81 |
| Grand Plaza Lourdes | 12,137 | 44 | 276 | 90 |
| Paseo Venecia | 5,879 | 22 | 267 | 56 |
| Plaza Cafetalón | 15,257 | 77 | 198 | 61 |

⚠️ **El hallazgo de "Soyapango desperdicia empaque" se cae**: era artefacto de los datos faltantes.
Con la data corregida queda segundo mejor. El rango sigue en ~5×, así que **todavía no sirve como
ranking de eficiencia**; Usulután con 9 rollos en 5 meses sugiere compra local no registrada, igual
que Metro Centro.

📌 `pedidos_peya` tiene **41,826 pedidos con detalle de artículos** desde enero y `quanto_orden_items`
cubre mar–jul por ítem. Ninguna de las dos se usa hoy para inventario ni costeo.

## Bugs de costeo pendientes
1. **El motor no convierte unidades:** multiplica cantidad × costo de la unidad de compra. En Mezcla de
   Carne Smash, Glutamato "70 g" × $8.37/**bolsa** = $585.90; los 4 condimentos suman $1,433 de $1,945.
2. **Rendimiento en unidad incompatible:** Mezcla de Carne Smash rinde `1 tarea`, se consume en `lb`.
3. **0 de 34 empaques con costo DTE.** Solo 51 de 650 productos tienen costo real.
4. **`unidad_compra` NULL y `factor_compra`=1 en todo el catálogo** — no hay ninguna conversión configurada.
