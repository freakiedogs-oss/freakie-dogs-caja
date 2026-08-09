# Integración Almacén / Inventario / Costo / Menú — cómo está conectado

> Auditoría 8-ago-2026. Cómo se entrelazan las áreas, qué input actualiza qué,
> y dónde están los eslabones flojos. Fuente de verdad de stock = **kardex**
> (`kardex_mover` / `kardex_movimientos` + `inventario`).

## 1. Las piezas (tabla = dónde vive el dato)

| Área | Tabla(s) / RPC clave | Rol |
|---|---|---|
| **Catálogo de items** | `catalogo_productos` (tipo MP/SP/PT/IN, `sku`, `unidad_medida`, `unidad_compra`, `factor_compra`, `precio_referencia`) | **Fuente de verdad de los ingredientes/productos.** El mismo item aparece en Recepción, Inventario, Recetas, Conteo. |
| **Recepción DTE** | `compras_dte` / `compras_dte_items`; `recibir_dte`; `recepciones`/`recepcion_items`; `proveedor_item_mapa` | Recibe facturas de compra → **stock + costo + mapeo aprendido**. |
| **Mapeo Compras** | `compras_dte_items.producto_id` (Identificación de ingredientes) | Vincula descripciones de factura → producto (para **costo**, no stock). |
| **Costo** | `costo_producto(id)`, `receta_costo_total(id)` | Deriva el costo real de cada item y receta. |
| **Recetas (bloques CM)** | `recetas` (sub_receta/porcionado), `receta_ingredientes` | Preparaciones reutilizables; MP o sub-recetas anidadas. |
| **Menú (BOM)** | `pos_menu_items.producto_id → catalogo(PT) ← recetas.catalogo_id`; `mapear_menu_item`, `set_menu_item_componentes` | Cada platillo = receta/combo → hasta MP. |
| **Conteo nocturno** | `inventario_conteo_nocturno`; `conteo_lista` | Sucursal cuenta stock → ajusta `inventario` + genera pedido. |
| **Pedido→Despacho** | `pedidos_sucursal`/`pedido_items`; `despachos_sucursal`/`despacho_items`; `despacho_confirmar` | Mueve stock CM → sucursal (vía kardex). |
| **Venta (POS)** | `pos_cuentas` cobrada → `pos_deducir_inventario` | Explota la receta y baja stock de la sucursal. |

## 2. Qué INPUT actualiza qué área

```
INPUT                                  →  ACTUALIZA
─────────────────────────────────────────────────────────────────────────
Recibir DTE (Recepción)                →  +stock CM (kardex) · +costo (recepcion_items)
                                          · aprende mapeo (proveedor_item_mapa)
                                          · marca compras_dte recibido
Mapear factura (Mapeo Compras)         →  +costo (compras_dte_items)   [NO stock]
Editar factor/unidad (📐)              →  costo por unidad base · cuánto entra al recibir
Renombrar/tipo/SKU (✏️, Ajustes)        →  limpia el item (mismo item en todas las áreas)
Armar receta / mapear menú (BOM)       →  habilita costeo + deducción de venta
Conteo nocturno (sucursal)             →  stock sucursal + genera pedido
Despacho + Confirmar Entrega           →  mueve stock CM→sucursal (kardex)
Venta cobrada (POS)                    →  baja stock sucursal (deducción recursiva)
```

## 3. Flujograma

```
                         ┌─────────────────────────────┐
   FACTURA DE COMPRA ───▶│  RECEPCIÓN DTE (bandeja)     │
   (compras_dte)         │  · mapear línea → producto  │
                         │  · Recibir                  │
                         └───────┬───────────┬─────────┘
                    recibir_dte  │           │ mapear (sin recibir)
                         ┌───────▼──┐   ┌────▼──────────────┐
                         │ recepcion│   │ compras_dte_items │
                         │ _items   │   │ .producto_id      │  ← "Mapeo Compras"
                         │ (precio) │   │ (precio facturado)│
                         └───┬───┬──┘   └────────┬──────────┘
                    kardex   │   │ costo         │ costo
                     +stock  │   └──────┬────────┘
                         ┌───▼───┐   ┌──▼──────────────────────┐
                         │inventa│   │ costo_producto(id)      │
                         │  rio  │   │ 1 recepción → 2 factura │
                         │  (CM) │   │ → 3 proveedor → 4 ref   │
                         └───┬───┘   └──────────┬──────────────┘
      Conteo nocturno /      │                  │ (recursivo)
      Despacho (kardex)      │        ┌─────────▼──────────┐
                         ┌───▼────┐   │ receta_costo_total │◀── RECETAS (bloques CM)
                         │inventa │   │ sub_receta→MP      │    receta_ingredientes
                         │rio SUC │   └─────────┬──────────┘
                         └───┬────┘             │
              VENTA POS      │        ┌─────────▼──────────┐
     pos_deducir_inventario  │◀───────│  MENÚ (BOM)        │
     (explota receta,        │        │  plato→receta→MP   │
      frena en sub-producto  │        │  costo · margen    │
      contado) baja stock ───┘        └────────────────────┘
```

## 4. Eslabones flojos (a vigilar)

1. **Mapear ≠ costear (RESUELTO 8-ago):** antes `costo_producto` NO leía las facturas
   mapeadas (`compras_dte_items`), solo recepciones/proveedor/referencia → items mapeados
   pero no recibidos daban **$0**. Ahora la factura mapeada es fuente de costo (#2).
2. **Dos superficies de mapeo** que no se sincronizan: `proveedor_item_mapa` (aprendido en
   Recepción, usado para sugerir) vs `compras_dte_items.producto_id` (Mapeo Compras). Ideal:
   que una escriba la otra. (El botón 🔗 DTE ya muestra ambas.)
3. **Unidad/conversión:** el costo usa la unidad de la factura; si `factor_compra` no está
   bien, el costo por unidad base sale inflado (cartitas: factura $0.90/conjunto de 20 →
   real ~$0.045/cartita). El barrido de unidades cierra esto.
4. **Mapear ≠ recibir:** mapear da costo pero NO stock. El stock solo entra al **recibir**
   el DTE o por despacho. Son inputs distintos.
5. **PT (Terminados)=0:** se llena a medida que se mapean platos en BOM.
