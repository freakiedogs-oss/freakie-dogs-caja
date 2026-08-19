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

---

# SESIÓN 18-ago (noche) — diagnóstico completo, ✅ APLICADO 19-ago

> ✅ **Aplicado en producción el 19-ago** (sesión SSH, una sola transacción, verificado).
> Los 4 costos de control dieron exactamente lo proyectado: Chili $32.2781 · Chilli dog
> individual $1.0841 · Chili Duo $5.4562 · Mermelada de Tocino $35.4738.
> Ningún ítem del menú queda con margen negativo — el rango es 54.1%–79.3%.
> El ROLLBACK del final sigue siendo válido si hay que revertir.
>
> **Dos correcciones al SQL respecto de lo escrito el 18-ago:**
>
> 1. **`confianza_mapeo='alta'` no existe.** El check constraint solo acepta
>    `auto` / `manual` / `sugerido`. Se usó `manual` (consistente con las 2041 filas ya mapeadas).
>    Con `'alta'` la transacción abortaba entera.
> 2. **`Queso Parmesano Block 2.27kg` está duplicado en el catálogo** — `1953e11b…` (`Unidad`,
>    inactivo) y `a2c65b67…` (`block`, activo). El `select id … where nombre=…` del paso 7
>    devolvía 2 filas y reventaba con `more than one row returned`. Se reescribió con ids
>    explícitos. Mismo caso con el aserrín, que existe bajo dos nombres distintos
>    (`…1.5kgs` id `24e2fdcc…` y `…bolsa 1.5kg` id `acf080da…`), ambos activos y sin usos.
>    🟡 Queda pendiente unificar esos duplicados de catálogo.

## Correcciones de la sesión anterior que este análisis invalida

| Lo que decía el doc | La realidad verificada |
|---|---|
| `Salsa Truffa` da $9.79/oz y bloquea el Royal Truffle | **Ya estaba arreglada**: $1.2689/bolsa = **$0.0397/oz** |
| El Chili tenía frijol y chipotle duplicados | **No.** Hay **dos recetas activas llamadas `Chili`** y la consulta las mezcló |
| Papa blanca = bolsa Mydibel de 2.5 kg → $4.01/lb | Es **caja de 4 bolsas × 2.5 kg** = 22.046 lb → **$1.0033/lb** |
| Cajita/costeo del pastel, etc. | sin cambios |

## Las dos recetas `Chili`

| id | Rinde | Ingr. | Costo | Uso |
|---|---|---|---|---|
| `f9e150d6-f0e4-4728-a303-a38891a12555` | 4 bolsas | 22 | $93.11 | ✅ la buena — sub-producto contado, 2 recetas + 6 modificadores |
| `3d11a897-169f-465d-9f10-5a31116a53f5` | 1 porción | 4 | $5.60 | ❌ huérfana, cero usos → desactivar |

## Datos nuevos de Jose (18-ago noche)

| Insumo | Dato | Conversión |
|---|---|---|
| **Saco de cebolla blanca** | **50 cebollas** | 22 facturas / 115 sacos / $3,343 → **$29.07/saco = $0.5814 por cebolla** |
| **Azúcar Morena 326235** | **bolsa de 7.5 kg** | $7.25 / 7500 g = $0.000967/g |
| **Ácido Cítrico** | **lata de 1 lb** (453.6 g) | $10.39 → $0.0229/g |
| **Orégano 30204** | **bote de 141 g** | $5.12 → $0.0363/g |
| **Chili por chilli dog** | **2 oz** | = 0.0625 bolsa (bolsa = 2 lb = 32 oz) |
| **Mydibel (papa blanca)** | **caja de 4 bolsas × 2.5 kg** | 22.046 lb → **$1.0033/lb** |
| **Papa francesa** (Mini Fancys) | = **papa blanca** | — |
| **Cilantro** | **Badia bote 99.2 g** | 🟡 sin factura mapeada, costo $0 |
| **Combo GOL-OSO** | era de temporada | **desactivar** |

## Costeo proyectado

**`Chili`** — de $93.11 a **$32.28** la tanda (128 oz) = **$0.2522/oz**

| Ingrediente | Antes | Después |
|---|---|---|
| Cebollas Blancas (2 unidades, no 2 sacos) | $48.00 | **$1.163** |
| Ácido Cítrico 0.5 cdta | $5.195 | $0.031 |
| Azúcar Morena 0.5 cdta | $3.625 | $0.0013 |
| Ácido Ascórbico 0.5 cdta | $2.700 | $0.0073 |
| Orégano 0.5 cdta | $2.560 | $0.049 |
| resto (carne, tomate, chipotle, frijoles…) | sin cambio | $31.03 |

**`Chilli dog individual`**: $23.86 → **$1.084** (pan $0.142 + salchicha $0.330 + 2 oz chili $0.504 + cheddar $0.108)

**`Chili Duo`**: **$54.80 → $5.46** sobre $14.99 → **63.6% de margen**

**`Mermelada de Tocino`**: $118.43 → **$35.47** (÷4 tandas = $8.87). Topping de 8 oz: $4.93 → **$1.478**

**`Papa Blanca`** a $1.0033/lb baja **$1.054 por porción de 0.35 lb** en 9 recetas:
Combig $10.33→$9.27 · Fancys XL $3.20→$2.14 · Combo Fancy Duo $3.33→$2.27 · Combros · Freakie Box ·
Fancy · Mini Fancy · Papa Blanca · Super Freak armado (−$0.301)

**Ítems nuevos listos para cargar**

| Ítem | Composición | Costo | Precio | Margen |
|---|---|---|---|---|
| **Mini Fancys** | papa blanca 0.35 lb + waffle 0.35 lb + 2 oz cheddar + 2 oz mil islas + topping (modificador) | $1.614 | $4.99 | 67.7% |
| **Royal Truffle Combo** | 2 Hamburguesa Sencilla + 1 Mini Fancys + 2 oz trufa + 2 oz queso aserrín + 2 oz parmesano + 1 oz cilantro | ~$7.99 | $21.99 | ~63.7% |
| **Coca-Cola Combo XL** | 2 Freakie Dog armado + papa sazonada + jalapeños + soda (modificador) | ~$1.89 | $5.99 | ~68% |

## Insumos nuevos identificados y verificados contra factura

| Producto | Factura | Precio | Resultado |
|---|---|---|---|
| **Queso Duro Viejo Aserrín** ("queso a serrín") | `QUESO DURO VIEJO ASERRIN 1.5 KG`, 8+ DTE, última 30-jul | $14.02 | **$9.3467/kg** → 2 oz = $0.530 |
| **Queso Parmesano Block** | `QUESO PARMESANO BLOCK 2.27 KGS`, 15 DTE, última 29-jul | $36.40 | **$16.0352/kg** → 2 oz = $0.909 |

Ninguno de los dos estaba mapeado.

## 🟡 Sigue abierto

1. **Mermelada de Tocino — la mantequilla** pide `0.5 barra` contra un producto en gramos: cobra
   $0.0065 (o sea 0.5 g). Si son 0.5 lb reales son ~$2.95. Falta el gramaje.
2. **Mermelada de Tocino — 25 cebollas** por tanda (0.5 saco) es ahora el ingrediente más caro
   ($14.54 de $35.47). Confirmar que la proporción es real.
3. **Cilantro Badia** — sin factura mapeada, queda en $0.
4. **`Combo Chilli Dog`** (701 u · $4,246, el de más volumen sin mapear) — falta composición.
   La hipótesis es chilli dog + papa + bebida = ~$1.53 → 74%, pero no está confirmada.
5. **`Cebolla Blanca`** (sub-receta usada por Chili Duo) está **vacía**, rinde 10 bolsas y cuesta $0.
   Sigue vacía después del fix del 19-ago: el Chili Duo la consume (0.0625 bolsa) y aporta $0,
   así que su $5.4562 está **subestimado** por ese ingrediente.
7. **Duplicados en `catalogo_productos`** detectados el 19-ago, todos con 0 usos y 0 DTE:
   `Queso Parmesano Block 2.27kg` ×2 (`1953e11b…` inactivo · `a2c65b67…` activo) y el aserrín
   bajo dos nombres (`…1.5kgs` `24e2fdcc…` · `…bolsa 1.5kg` `acf080da…`, ambos activos).
   Hay que unificarlos antes de que alguien mapee facturas al que no es.
6. La conversión **1 taza de azúcar morena = 220 g** es estimación mía → marcada `[revisar]`.

## SQL APLICADO 19-ago (proyecto Supabase `btboxlwfqcbrdfrlnwln`, schema `public`)

Todo verificado contra factura o aritmética de unidades. Reversible — el ROLLBACK va abajo.
Este es el texto **tal como corrió**, ya con las dos correcciones del encabezado.

```sql
-- 1) CEBOLLA BLANCA — el saco trae 50 cebollas (Jose). 22 facturas / 115 sacos / $3,343
--    -> $29.07 por saco = $0.5814 por cebolla. Antes cobraba 2 SACOS ($48) en vez de 2 cebollas.
update catalogo_productos set unidad_medida='unidad', factor_compra=50 where nombre='Cebollas Blancas';
update compras_dte_items set producto_id=(select id from catalogo_productos where nombre='Cebollas Blancas'),
       factor_conversion=50, confianza_mapeo='manual', mapeado_at=now()
 where descripcion_original ilike '%cebolla blanca%' and producto_id is null;
update receta_ingredientes set cantidad=25, unidad_medida='unidad'
 where id='2b454d37-08d4-4da5-bda9-547a1950c730';           -- Mermelada: 0.5 saco = 25 cebollas

-- 2) AZUCAR MORENA — bolsa de 7.5 kg (Jose)
update catalogo_productos set unidad_medida='g', factor_compra=7500 where nombre='326235 Azucar Morena';
update receta_ingredientes set cantidad=1.35, unidad_medida='g' where id='b58da553-4564-46f0-9024-887c78097b43';
update receta_ingredientes set cantidad=1430, unidad_medida='g' where id='8a9d5661-1c07-48cb-9cc8-e21d80189cf6';

-- 3) ACIDO CITRICO lata = 1 lb (453.6 g) · OREGANO bote = 141 g (Jose) · ACIDO ASCORBICO ya venia en kg
update catalogo_productos set unidad_medida='g', factor_compra=453.6 where nombre='Acido Citrico';
update catalogo_productos set unidad_medida='g', factor_compra=141   where nombre='30204 Oregano';
update receta_ingredientes set cantidad=1.35,    unidad_medida='g'  where id='c48a51eb-cf00-4553-b542-1160eb9ef50b';
update receta_ingredientes set cantidad=1.35,    unidad_medida='g'  where id='ef1e81e8-85ea-4e2c-b79d-97b1583d716e';
update receta_ingredientes set cantidad=0.00135, unidad_medida='kg' where id='c21da89a-3bdf-4440-a292-8a65ef10ddac';

-- 4) PAPA BLANCA — la Mydibel es CAJA de 4 bolsas x 2.5 kg = 22.046 lb (Jose) -> $1.0033/lb
update catalogo_productos set factor_compra=22.046 where nombre='Papa Blanca 20lb';
update compras_dte_items set factor_conversion=22.046
 where producto_id=(select id from catalogo_productos where nombre='Papa Blanca 20lb');

-- 5) MERMELADA DE TOCINO — unidades (1 gal = 16 tazas · 1/4 gal = 4 tazas · 1 lb = 0.45359 kg)
update receta_ingredientes set cantidad=0.015625, unidad_medida='galón'        where id='be1ea189-92a0-4c5e-96a1-de1bb040f583';
update receta_ingredientes set cantidad=1.5625,   unidad_medida='cuarto_galón' where id='4caf9064-62ab-4d95-80a1-44ffc73a0eac';
update receta_ingredientes set cantidad=1.5876,   unidad_medida='kg'           where id='1a06b9fc-eb50-4e14-9555-bf7cafe97629';
update receta_ingredientes set cantidad=0.029484, unidad_medida='kg'
 where id in ('c87bd4c9-6001-4e15-af4f-a6901a384dca','ed90b756-4cd2-4359-8b27-b647009bdb91');

-- 6) CHILLI DOG — 2 oz de chili (Jose) = 0.0625 bolsa (la bolsa es de 2 lb = 32 oz)
update receta_ingredientes ri set cantidad=0.0625, unidad_medida='bolsa' from recetas r
 where ri.receta_id=r.id and r.nombre='Chilli dog individual'
   and ri.sub_receta_id='f9e150d6-f0e4-4728-a303-a38891a12555';

-- 7) QUESOS del Royal Truffle — 15 y 8+ facturas recurrentes, nunca mapeadas.
--    IDS EXPLICITOS: 'Queso Parmesano Block 2.27kg' esta duplicado en catalogo y el
--    select-por-nombre reventaba con "more than one row returned".
update catalogo_productos set unidad_medida='kg', factor_compra=2.27 where id='a2c65b67-7b4e-4e56-ac4e-2d1faa569d73';
update catalogo_productos set unidad_medida='kg', factor_compra=1.5  where id='24e2fdcc-a0d7-417c-b5a2-aafdd74bc62d';
update compras_dte_items set producto_id='a2c65b67-7b4e-4e56-ac4e-2d1faa569d73',
       factor_conversion=2.27, confianza_mapeo='manual', mapeado_at=now()
 where descripcion_original ilike '%QUESO PARMESANO BLOCK%' and producto_id is null;
update compras_dte_items set producto_id='24e2fdcc-a0d7-417c-b5a2-aafdd74bc62d',
       factor_conversion=1.5, confianza_mapeo='manual', mapeado_at=now()
 where descripcion_original ilike '%QUESO DURO VIEJO ASERRIN%' and producto_id is null;

-- 8) LIMPIEZA — receta 'Chili' huerfana (cero usos) y GOL-OSO (era de temporada, Jose)
update recetas set activo=false where id='3d11a897-169f-465d-9f10-5a31116a53f5';
update pos_menu_items set disponible=false, visible_publico=false where lower(btrim(nombre))='combo gol-oso';
```

### Verificación después de aplicar

```sql
select r.nombre, round(receta_costo_total(r.id)::numeric,4) as costo
from recetas r where r.nombre in ('Chili','Chilli dog individual','Chili Duo','Mermelada de Tocino') and r.activo;
-- esperado: Chili $32.28 (4 bolsas) · Chilli dog individual $1.084 · Chili Duo $5.46 · Mermelada $35.47
```

**Resultado real 19-ago — los 4 dieron exactamente lo proyectado:**

| Receta | Antes | Después |
|---|---|---|
| Chili (tanda, 4 bolsas) | $93.1068 | **$32.2781** |
| Chilli dog individual | $23.8565 | **$1.0841** |
| Chili Duo | $54.8028 | **$5.4562** |
| Mermelada de Tocino (4 tandas) | $118.4290 | **$35.4738** |

Y el margen de los 19 ítems de menú con receta activa quedó entre **54.1% y 79.3%**, sin
ninguno negativo. El `Chili Duo` ($14.99) pasó de **−265.6%** a **63.6%**. El más ajustado
es `Sweet Burger Duo` ($17.99 · $8.2508 · 54.1%). `Combo GOL-OSO` quedó fuera de los 5 menús.

### ROLLBACK

```sql
update catalogo_productos set unidad_medida='Saco',   factor_compra=1 where nombre='Cebollas Blancas';
update catalogo_productos set unidad_medida='bolsa',  factor_compra=1 where nombre='326235 Azucar Morena';
update catalogo_productos set unidad_medida='lata',   factor_compra=1 where nombre='Acido Citrico';
update catalogo_productos set unidad_medida='bote',   factor_compra=1 where nombre='30204 Oregano';
update catalogo_productos set factor_compra=5.5116 where nombre='Papa Blanca 20lb';
update catalogo_productos set unidad_medida='block',  factor_compra=1 where nombre='Queso Parmesano Block 2.27kg';
update catalogo_productos set unidad_medida='Unidad', factor_compra=1 where nombre='Queso Duro Viejo Aserrin 1.5kgs';
update receta_ingredientes set cantidad=0.5,  unidad_medida='saco'        where id='2b454d37-08d4-4da5-bda9-547a1950c730';
update receta_ingredientes set cantidad=0.5,  unidad_medida='cucharadita' where id in
  ('b58da553-4564-46f0-9024-887c78097b43','c48a51eb-cf00-4553-b542-1160eb9ef50b',
   'ef1e81e8-85ea-4e2c-b79d-97b1583d716e','c21da89a-3bdf-4440-a292-8a65ef10ddac');
update receta_ingredientes set cantidad=6.5,  unidad_medida='taza' where id='8a9d5661-1c07-48cb-9cc8-e21d80189cf6';
update receta_ingredientes set cantidad=0.25, unidad_medida='taza' where id='be1ea189-92a0-4c5e-96a1-de1bb040f583';
update receta_ingredientes set cantidad=6.25, unidad_medida='taza' where id='4caf9064-62ab-4d95-80a1-44ffc73a0eac';
update receta_ingredientes set cantidad=3.5,  unidad_medida='lb'   where id='1a06b9fc-eb50-4e14-9555-bf7cafe97629';
update receta_ingredientes set cantidad=0.065,unidad_medida='lb'   where id in
  ('c87bd4c9-6001-4e15-af4f-a6901a384dca','ed90b756-4cd2-4359-8b27-b647009bdb91');
update recetas set activo=true where id='3d11a897-169f-465d-9f10-5a31116a53f5';
update compras_dte_items set producto_id=null, factor_conversion=null, confianza_mapeo=null, mapeado_at=null
 where descripcion_original ilike '%cebolla blanca%'
    or descripcion_original ilike '%QUESO PARMESANO BLOCK%'
    or descripcion_original ilike '%QUESO DURO VIEJO ASERRIN%';
```

---

# SESIÓN 19-ago — componentes reactivados, cebolla, papa waffle y 3 ítems rescatados

> Todo aplicado y verificado en producción. Cada migración lleva su ROLLBACK en el comentario.

## 1. `pos_combo_componentes` reactivado (migración `reactivar_componentes_pos_post_fix_kds`)

El fix del KDS (PR #236, commit `0a99f1c`) ya está en producción, así que se rehizo la estructura
que se había revertido por el incidente del 18-ago. Es el ROLLBACK que esa migración dejó escrito.

**133 filas en los 5 canales**, 7 combos, y los grupos de modificadores movidos del padre a cada
componente (`grupos_padre = 0` en los 34). La regla de mesa se respeta: en `local` no va bebida
(Burger Duo tiene 4 componentes en mesa y 6 en los demás canales).

Estado previo verificado: 0 componentes y 110 grupos en el padre, que coincidía fila por fila con
`_bkp_item_mod_reconciliacion` (110 filas / 34 ítems) — o sea la reversión no había perdido nada.

## 2. Sub-receta `Cebolla Blanca` — estaba vacía y en $0

Proceso (Jose): se despunta arriba y abajo, se quita la cáscara, va al procesador y se porciona en
**bolsas de 2 lb**. Rinde 10 bolsas = **20 lb netas**.

Merma del **12%** por despuntar y descascarar (rendimiento 88%, estándar de cocina). Como
`receta_costo_total` aplica `merma_pct` de **recargo** (`cantidad * (1 + merma/100)`), la merma va
en su columna y no escondida en el número: `cantidad = 20`, `merma_pct = 13.6364` → **22.73 cebollas**.

**1 cebolla = 1 lb — confirmado por Jose.** El saco de 50 unidades pesa 50 lb. Ninguna factura trae
el peso; se sostiene además por precio: $29.07/50 lb = $0.58/lb, coherente con mayoreo.

→ **$13.2134 la tanda · $1.3213 la bolsa · $0.0413 la onza.**

## 3. 🔴 El bug que destapó llenar esa receta (4ª aparición del mismo error)

`Freakie Dog armado` pedía **"1 oz"** de una sub-receta que rinde en **BOLSAS**.
`receta_costo_total` **no convierte unidades** — hace `cantidad * costo_total / rendimiento` — así
que leyó *1 oz* como *1 bolsa entera*: **$1.3213 en vez de $0.0413, 32× de más**. Como ese bloque
está dentro de casi todos los combos de hot dog, arrastró medio menú:

| | Con el bug | Corregido |
|---|---|---|
| Freakie Dog | $2.00 · **−0.5%** | $0.72 · 63.8% |
| Combros | $9.55 · 36.3% | $4.43 · 70.5% |
| Coca-Cola Combo | $2.44 · 38.8% | $1.16 · 70.9% |
| Freakie Box | $8.86 · 40.9% | $5.02 · 66.5% |

Corregido a `0.03125 bolsa` (la bolsa es de 2 lb = 32 oz).

**Estuvo escondido detrás del $0**: mientras la sub-receta costaba cero, el error no se veía.

### Barrido de todo el catálogo por el mismo patrón

Se buscaron todos los `sub_receta` cuya `unidad_medida` no coincide con la `unidad_rendimiento` de
su sub-receta. Quedan **9 ocurrencias**, y **todas están en recetas huérfanas sin uso** (ver §5),
así que no afectan producción. La peor sería `Sal de Hamburguesa` a **$6.96 por hamburguesa**.

## 4. `Papa Waffle` — 21 facturas compradas y sin conectar

Costaba **$0** y bloqueaba toda la familia Fancy. La descripción de la factura traía la conversión
adentro: `CAJA 6/4.5LB` = 6 × 4.5 = **27 lb**, que coincide exacto con el `factor_compra` que ya
tenía el catálogo. Confirmado por dos vías independientes:

| Presentación | Precio | Por libra |
|---|---|---|
| Caja 6/4.5 lb (19 DTE: PAP0137 P55, PAP0079 S15) | $44.2478 | **$1.6388** |
| Bolsa suelta 4.5 lb (2 DTE: PAP0143) | $7.5746 | $1.6832 |

→ **$1.6423/lb** · porción de 0.35 lb = **$0.5748**. `Mini Fancy` $0.3512 → **$0.9261**;
`Fancy` $1.2449 → **$1.9018**. Estaban costeando la mitad.

⚠️ **Hay TRES productos "Papa Waffle" en catálogo**, los tres con factor 27 y costo ~$1.645:
`Papa Waffle` (c3a0697a, 0 DTE) · `Papa Waffle 27LB` (45c837d5, **21 DTE**, el bueno) ·
`PAPA WAFFLE NAT CAJA 6/4.5 LBS` (9f50cf16, **inactivo pero usado por 4 recetas**).
Como los tres cuestan casi igual no hay distorsión, pero **hay que unificarlos**.

## 5. Tres capas de recetas encimadas — el hallazgo estructural

| Capa | Cuántas | Estado |
|---|---|---|
| Vivas y costeadas (enlazadas por `catalogo_id`) | **22** | ✅ las que manda el menú |
| **Huérfanas** (`catalogo_id` NULL, 0 usos) | 8 | ❌ borradores con composición equivocada |
| **Cáscaras vacías** (activas, 0 ingredientes, $0) | 25 | ❌ basura, nadie las usa |

Las huérfanas **no son "la versión vieja fiel"**: `Freakie Fries` no tenía papa, y `Royal Truffle
Combo` tenía mozzarella, tocino y Coca-Cola. Copiarlas habría metido datos falsos creíbles.

**Y el hueco de fondo: 269 de 374 filas de menú disponibles no tienen `producto_id`** — o sea la
mayoría del menú no está enlazada al costeo. Lo de estos 3 ítems era la punta de eso.

## 6. Tres ítems que se vendían sin costear (migración `bom_rescatar_...`)

Se venden en los 5 menús y no descargaban inventario. Composición dictada por Jose (19-ago);
**no se copió nada de las huérfanas**, que quedaron desactivadas.

| Ítem | Precio | Composición | Costo | Margen |
|---|---|---|---|---|
| **Freakie Fries** | $1.99 | 1 porción de Papa Sazonada. Las salsas van por **modificador**, no en la receta (anti-doble-conteo) | $0.4468 | **77.5%** |
| **Sweat Freak** | $4.50 | **Es un postre**: 1 porción del pastel de Heling. $25 / 10 porciones. **Sin DTE que lo respalde** | $2.5000 | **44.4%** |
| **Royal Truffle Combo** | $21.99 | 2 Hamburguesa Sencilla + 1 Mini Fancy + 2 oz trufa + 2 oz aserrín + 2 oz parmesano + 1 oz cilantro | $7.3017 | **66.8%** |

Se reusó el patrón `0.1 pastel` que ya usaban Sweet Burger Duo y Combpleto.
🟡 El **cilantro** queda en $0 — sin factura mapeada. El ingrediente está cargado para que el costo
se llene solo cuando aparezca.

## Estado del menú al cierre del 19-ago

**22 ítems costeados, margen entre 44.4% y 78.6%, ninguno negativo.**
El más bajo es `Sweat Freak` (44.4%) — es reventa de postre, no producción propia.

## 🟡 Pendiente

1. **`pos_modificador_insumos` / el botón SIN**: `receta_ingredientes.removible` **no existe**, y no
   hay ni un modificador "Sin X". Hoy se pide por nota libre, que es lo que vuelve la comanda
   amarilla. Decisión de Jose: el SIN **no toca el precio**; y no debe descontar el ingrediente de
   esa línea (si se reutiliza, lo descuenta el plato donde se usó; si se tira, es merma).
2. **Matriz de menús por tipo de sucursal** — ver sección aparte.
3. Unificar los duplicados de catálogo (papa waffle ×3, parmesano ×2, aserrín ×2).
4. Borrar las 8 huérfanas y las 25 cáscaras vacías.
5. Mapear los 269 ítems de menú sin `producto_id`.

---

# PROPUESTA — Matriz de menús por tipo de sucursal (19-ago, sin implementar)

## El problema

Los **5 menús son globales** (`pos_menus.sucursal_id` = NULL), así que "Para Llevar" significa lo
mismo en Venecia que en Metro Centro. Por eso **en restaurante, al marcar "llevar", el POS exige
bebida** — y no debería.

`sucursales.tipo` **ya existe y está bien poblado**: `restaurante` (Cafetalón, Lourdes, Venecia,
Eventos) · `food_court` (Soyapango, Usulután, Metro Centro) · `drive_thru` (Lourdes DT) · `bodega`
(Casa Matriz).

Reglas reales (Jose, 18 y 19-ago):
- **Restaurante + para llevar** → es el menú de mesa; **no lleva bebida**, la única diferencia es el
  **empaque**.
- **Food court** → el cajero elige *comer aquí* o *para llevar*; **ambos llevan bebida**, y solo el
  segundo suma empaque.

## La causa de fondo

Hoy el menú decide **tres cosas a la vez**: precio, si el combo incluye bebida, y qué empaque. Son
tres reglas distintas y por eso no se puede expresar "mismo menú, sin bebida, pero con empaque".

## La propuesta: separar dos ejes

- **Eje 1 — lista de precios + bebida** → depende de `(tipo_sucursal, modo_consumo)`
- **Eje 2 — empaque** → depende de una sola pregunta: **¿el producto sale del local?**

Con eso la matriz completa son **7 filas** y **no se crea ningún menú nuevo**:

| Tipo sucursal | Modo | Menú | Bebida | Empaque |
|---|---|---|---|---|
| restaurante | mesa | Local | ❌ | ❌ |
| **restaurante** | **para llevar** | **Local** | **❌** | **✅** |
| food_court | comer aquí | Para Llevar | ✅ | ❌ |
| food_court | para llevar | Para Llevar | ✅ | ✅ |
| drive_thru | — | Drive Thru | ✅ | ✅ |
| cualquiera | delivery | Delivery | ✅ | ✅ + bolsa |
| cualquiera | PedidosYa | PedidosYa | ✅ | ✅ + bolsa |

## Implementación

1. **Tabla `pos_contexto_servicio`** — 7 filas: `(tipo_sucursal, modo_consumo) → menu_id,
   incluye_bebida, incluye_empaque`. La matriz como **dato editable**, no como `if` en el código.
2. **El POS resuelve al abrir la cuenta**: ya sabe la sucursal (→ `tipo`) y el cajero elige el modo.
3. **`receta_ingredientes.contextos text[]`** (NULL = siempre) — calcado de
   `pos_modificador_insumos.canales`, que **ya existe y ya funciona** (`pos_deducir_inventario` v4
   resuelve el canal y filtra por él). Aluminio, cajita, polipel y bolsa se marcan "solo si empaque",
   así el mismo Burger Duo cuesta distinto en mesa que para llevar **sin duplicar la receta**.

Ventaja de fondo: agregar un canal nuevo pasa a ser **una fila**, no un menú clonado de 100 ítems.

## Reportería que habilita

1. **Separar food cost de packaging cost** — hoy van mezclados. El empaque es el que se va sin notarse.
2. **Margen por contexto, no solo por sucursal** — ver que un Burger Duo deja 61.6% en mesa pero
   menos para llevar (el empaque se come puntos) cambia decisiones de precio. Hoy se promedia todo.
3. **Empaque teórico vs comprado = detector de fuga.** Si el sistema sabe cuántos pedidos salieron
   con empaque, sabe cuánto aluminio y polipel *debió* consumirse; contra las compras reales, la
   diferencia es merma o fuga. Es el análisis que se intentó con Soyapango y Metro Centro y que se
   enturbió por los pedidos de PeYa faltantes — ahora con un denominador confiable.
4. **Mix de contexto por sucursal** — qué % de Venecia es mesa vs llevar. Explica diferencias de
   margen que hoy se atribuyen a "eficiencia" y en realidad son mix.

## 🟡 Dos definiciones pendientes de Jose

1. En **food court "comer aquí"**, ¿de verdad no lleva ningún empaque? Si sale en bandeja o canasta
   desechable (no hay loza), el eje 2 tiene **tres** valores: `ninguno` / `sitio` / `llevar`.
2. En **restaurante mesa**, ¿el combo cuesta los mismos $7.50 sin la bebida? Si es así, el margen en
   mesa es estructuralmente mayor y conviene medirlo aparte.

---

# SESIÓN 19-ago (cierre) — mapa del ERP, guardarraíl anti-doble-conteo y el factor en la UI

## 1. El mapa front ↔ base: por qué el BOM estaba así

Se inventarió todo `src/` (142 archivos). La app son **5 SPAs** sin react-router (ERP, POS, menú
público, tracking, driver). El hallazgo de fondo: **el desorden del BOM no es descuido, es que no
existe la pantalla para hacer ese trabajo.**

| Qué | Estado en la UI | Consecuencia |
|---|---|---|
| `compras_dte_items.producto_id` | ❌ sin UI directa | Todo el mapeo de facturas se hacía por SQL |
| `pos_modificador_insumos` | ❌ **sin UI** | 89 filas cargadas y **69 de 146 modificadores sin insumo**, sin forma de cargarlos |
| Recetas `plato_menu` / `combo` | ❌ sin UI | `RecetasView` filtra solo `sub_receta`/`porcionado` → **107 ítems sin costear** |
| `recetas_lineas` | 🔴 **pantalla trampa** | El tab Recetas de Kardex escribe a esa tabla, que está **vacía**; el motor de costeo lee `receta_ingredientes`. Quien la use crea recetas que nunca costean |
| `MapeoMenu` (único BOM de menú) | ⚠️ escondida | Sin entrada en el sidebar; solo por Kardex → tab "🍔 Menú (BOM)" |
| `MenuAdminView` (combos, modificadores) | ⚠️ solo desde el POS | No está en el ERP; `jefe_casa_matriz` no puede tocar el menú |
| `pos_combo_componentes` | ⚠️ parcial | Se agrega y quita, pero no se edita la cantidad |

⚠️ **Corrección a un análisis automático:** se concluyó que "los modificadores no descuentan
inventario". **Es falso** — se verificó la función: `pos_deducir_inventario` **sí lee**
`pos_modificador_insumos`. El descuento funciona; lo que falta es la pantalla para administrarlo.

## 2. 🔴 Guardarraíl anti-doble-conteo (migración `guardarrail_anti_doble_conteo_componentes`)

**El riesgo que se creó al reactivar los componentes:** `pos_deducir_inventario` explota (a) la
receta del padre y (b) los componentes elegidos en `pos_cuenta_items.componentes`. Los combos padre
conservan su BOM completo (Burger Duo = 2 Hamburguesa Sencilla + 2 Papa Sazonada).

Hoy **no** hay doble descuento porque los 25 ítems componente no tienen `producto_id`. Pero en el
momento en que alguien les asignara uno, cada combo habría descontado su contenido **dos veces, en
silencio**.

**Decisión: el BOM vive en el ítem PADRE.** Los ítems 'Componentes' son solo el vehículo para que el
cajero elija/personalice y para que el KDS agrupe. Es coherente con lo que ya existe: el padre no
incluye bebida — la bebida entra por el modificador elegido dentro del componente, vía
`pos_modificador_insumos`, que ya funciona.

Se cerró con:
- **`trg_componente_sin_receta`** — trigger que impide asignar `producto_id` a un ítem de la
  categoría 'Componentes', con mensaje y `HINT` explicando qué hacer si algún día se quiere mover
  el BOM. **Probado: bloquea.**
- **`v_bom_doble_conteo`** — centinela permanente; debe devolver 0 filas siempre.

## 3. El factor de conversión, por fin en la interfaz (PR #239)

`mapear_descripcion_dte` asignaba el producto pero **no el factor** — que es la mitad que importa
para el costeo. Se extendió la función existente en vez de crear una cuarta pantalla de mapeo:
`p_factor_conversion` con DEFAULT (compatible hacia atrás), `desmapear` limpia el factor, y
`v_dte_descripciones` ahora expone factor, precio unitario promedio y el `factor_compra` del
catálogo para poder contrastarlos.

En la UI, una descripción vinculada muestra **"1 facturada = N ‹unidad›"** con el costo unitario
resultante y edición en línea; y si no hay factor, avisa **"⚠ sin factor — se costea 1:1"**.

**Tamaño del trabajo que queda por delante, medido:**

| | |
|---|---|
| Descripciones sin mapear | **2,730** |
| Dinero en compras sin conectar | **$1,498,514** |
| Mapeadas sin factor | 32 |
| Con factor inconsistente | 0 |

---

# SESIÓN 19-ago (cierre) — botón SIN, matriz de menús y el costeo al 98.7%

## 1. Botón SIN — vivo (PR #241)

Antes "sin cebolla" se pedía por **nota libre**: cocina lo leía como texto y **el inventario
descontaba la cebolla igual**.

Regla de Jose: **el SIN no toca el precio**, y el ingrediente **no se descuenta** de esa línea. Si
la cocina reutiliza la porción, el plato donde se use la descuenta por su receta; descontarla en
ambos restaría dos veces un consumo único. Si se tira, es **merma** y debe verse como merma.

- `receta_ingredientes.removible` + `etiqueta` (el nombre de catálogo es impresentable de cara al
  cajero: *"SIN MQ LAC Procesado Reb AM C 1.4kg/3lb"*).
- `pos_ingredientes_removibles(menu_item_id)` — **recursiva**: lo removible no está en la receta del
  combo sino dentro de sus bloques.
- **`pos_deducir_inventario` v5** propaga `linea_id` por todo el árbol. El SIN es **por línea**: con
  dos hamburguesas y una sin queso no se puede excluir el queso globalmente. Los insumos de
  modificadores entran con `linea_id` NULL a propósito — son agregados, no les aplica el SIN.
- Los SIN viajan dentro de `modificadores` con `grupo_nombre='SIN'` y precio 0, así que **reusan la
  tubería existente**: comanda, KDS y doble check de comanda amarilla, sin tocar el esquema.

**Validación antes de reemplazar la función de inventario** (se escribió primero
`pos_deducir_preview`, que no escribe nada): con el SIN desactivado devuelve el mismo conjunto de
productos que se descontó en kardex sobre 5 cuentas reales; con un `SIN Queso` sintético sobre un
Burger Box el queso pasa de 0.097 lb a 0 y **no se mueve ningún otro insumo**.

## 2. Matriz de menús — viva (PR #240)

En restaurante, "Para Llevar" exigía bebida. Ahora `(tipo_sucursal, tipo_orden)` resuelve el canal
vía `pos_contexto_servicio`: restaurante+llevar → menú **local** (sin bebida); food court mantiene
bebida. El empaque lo sigue decidiendo el destino *aquí/llevar* que el POS ya manejaba.
**Confirmado en operación por las cajeras.**

## 3. 🔴 El guardarraíl anti-doble-conteo se probó solo

Al crear la receta de `Super Freak`, el update por nombre alcanzó al ítem **'Super Freak' de la
categoría Componentes** y `trg_componente_sin_receta` **abortó la migración**. Sin ese trigger se
habría creado justo el doble descuento que cierra. Desde entonces todos los updates de
`pos_menu_items` excluyen explícitamente esa categoría.

## 4. 🔴 BEES: un proveedor entero fuera del costeo

**`costo_producto` no leía `compras_bees_items`.** 166 compras / 640 líneas / **$58,704** de
Industrias La Constancia — de donde salen casi todas las bebidas y cervezas — no alimentaban el
costeo. Por eso ninguna cerveza costeaba.

Y había un segundo problema encadenado: **la mayoría de esos productos tenía `factor_compra = 1`
aunque la caja trae 12 o 24 unidades**. Conectar BEES sin corregirlo habría inflado los costos 24×.
El campo `empaque` de BEES trae el dato en claro (`"24x 354ml"`), así que el factor se derivó de ahí.

`costo_producto` ahora **pondera DTE + BEES juntas**. Efecto inmediato: la Coca-Cola pasó de
$0.5771 (que reflejaba solo las compras de ajuste en supermercado) a **$0.4619**, que es la mezcla
real entre el proveedor habitual ($0.4121) y el súper ($0.5774).

## 5. Cobertura del costeo: 81.6% → 98.7% de la venta

Medido por dinero, no por cantidad de ítems.

| Bloque | Detalle |
|---|---|
| **Duplicados de nombre** | `COMBO FREAKIE BURGER`→Freakie Burger · `Burger La Clasica`→La Clasica · `Mini Fancys`→Mini Fancy · `Fancys`→Fancys XL |
| **Combo Duo** | ⚠️ estaba enlazado a Burger Duo (28% de margen). **Son 2 HOT DOGS, no 2 burgers.** Corregido a $2.3234 · 70.9%. Se verificó que no hubo ventas con el enlace malo |
| **Combos nuevos** | Coca-Cola Combo XL 66.3% · Combo Chilli Dog 72.2% · Mega Promo 76.7% · Chili Mini Fancys 71.3% · Fancy Fries Combo 75.5% · Combo Trio 75.1%/70.9% |
| **Sueltos** | Queso Frito 68.7% (era **negativo**) · Chili 79.8% · Chilli Dog 63.7% · Super Freak 66.1% · Aros de Cebolla 94.1% |
| **Bebidas** | Coca-Cola Vidrio 73.6% · Coca Zero 83.5% · Crema Soda 76.6% · Fresa 76.5% · Uva 76.6% · Coca Lata 66.2% · Agua 62.5% · Tés 68.2% · Kolashanpan 85.3% |
| **Cervezas** | Pilsener 65.7% · Golden 65.7% · Pilsener Mediana 51.9% · Pilsener Chola 55.1% · Regia Chola 53.6% · **Michelob 48.9%** · **Corona y Corona Cero 42.2%** |
| **Combos Pilsener** | Burger Box 60.8% · Royal Truffle 61.1% · Freakie Burger 58.5% · Freakie Combo 59.5% |

**Datos de Jose:** Queso Frito 0.3 lb · Chili 4 oz · Aros de Cebolla = la porción son los 6-7 aros
($0.2345) · Super Freak usa el pan brioche · Combo Trio = 3 hot dogs + 3 papas, **el mismo producto
con dos precios** ($13.99 PeYa / $11.99 delivery, más caro en PeYa a propósito) · las Regias se
compran a Comercializadora Interamericana, no por BEES.

⚠️ **Corona, Corona Cero y Michelob quedan entre 42% y 49% de margen**, muy por debajo del resto del
menú. Jose lo confirma como decisión, no como error.

⚠️ **El queso para dorar se compra por LIBRA, no por bolsita** — 198 facturas con cantidades
decimales lo delatan. Estaba etiquetado 'bolsita' y por eso el Queso Frito costaba $4.16 sobre un
precio de $3.99.

## 🟡 Lo que queda (1.3% de la venta)

Merchandising (gorras, stickers, bucket hat, Adivina la Marca, Gomita), los "Agrandado", y algún
suelto menor. Todos van con **costo de compra directo**, no con receta.
