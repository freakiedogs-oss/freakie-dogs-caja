> Entrada para `memoria.md` (va arriba de todo). No se pudo agregar ahí directo: el archivo pesa 500 KB y el push por el conector necesita el archivo completo. Pegarla en la próxima sesión con acceso git.

## 23-Sep-2026 — Combos por partes: la revisión destapó descargas equivocadas (migración `correcciones_combos_recetas_23sep`)

Para poder botar o reutilizar **una parte** de un combo (fase 2 del KDS) se asignó cada ingrediente de las 26 recetas de combo a su parte de cocina. Revisión publicada como artifact "Combos por partes". Al hacerlo aparecieron errores, corregidos con OK de Frank (aplicado en PROD, archivo en `supabase/migrations/20260923_correcciones_combos_recetas.sql`):
- **Waffle:** 9 recetas activas descargaban `Papa Waffle 27LB` o `PAPA WAFFLE NAT CAJA` (inactivo), que nadie recibe ni cuenta (−340 lb en 60 días); la contada `Papa Waffle` (`c3a0697a`) no tenía ni una descarga por venta. Todas apuntan ahora a `Papa Waffle`. Cierra el "hay que unificar" del 19-ago. El stock fantasma de los otros dos queda como historia.
- **Aros dentro de combos** (Chili Duo, Combros, Freakie Box): la sub-receta `Aros de Cebolla` tiene `catalogo_id`, así que la explosión paraba y descargaba `Aros de Cebolla porción` (no se cuenta; Críticos cuenta `Aros de cebolla unidad`). Se abrió en 6 aros + 2 oz ranch por porción. ~1,560 aros/mes no bajaban.
- **Pilsener ×4:** su receta era "1× <combo base>" y descargaba el combo como artículo (la familia "Platos sin receta" del 8-sep). Ahora llevan los ingredientes del combo base (132 vendidos en 60 días: 176 hamburguesas y 106 hot dogs sin descargar). **Si cambia la receta base, hay que cambiar la del Pilsener a mano.**
- **Pilsener Royal:** la receta sumaba 1 cerveza fija además de las 2 de los grupos `Bebida Royal 1/2` → 3 bebidas. Se quitó.
- **Configuración:** existe un **segundo "Combo Super Freak" en Delivery** (`b0f2f876`, creado 27-ago, sin slug) cuya parte era el plato Super Freak con `producto_id` → descargaba doble (9 ventas). Se le puso el componente correcto; queda pendiente decidir si se borra el duplicado. Combo Chilli Dog de Delivery no tenía parte Hot Dog (16 pedidos llegaron al KDS sin el chili dog) → agregada.
- **Partes nuevas** (componentes por menú, sin `producto_id`, no vendibles): Aros de Cebolla al Chili Duo, Postre al Sweet Burger Duo, **`Jalapeños 2 oz`** (Burger Box y Pilsener Burger Box) y **`Cheddar 8 oz`** (Combpleto) — son recipientes aparte que cocina no veía.

**Decisiones de Frank (23-sep):** el Chili Duo **sí lleva aros**; los jalapeños del XL van en **uno** de los dos hot dogs; en el Royal la trufa/quesos van en **papas y hamburguesas**; la cerveza de los Pilsener **no** se vuelve parte del KDS (es bebida, no se desperdicia así); el Burger Box debe descontar el **depósito de 2 oz**.

**Mismo día (migración `super_freak_unificado_y_deposito_2oz_23sep`):** el "Combo Super Freak" repetido de Delivery se unificó en el original (`421c4de2`): sus 10 ventas pasaron al original y el repetido se borró. Burger Box y Pilsener Burger Box descuentan `DEPOSITO DE 2 OZ CAJA` y `Tapadera 2 onzas` a 1/1000 (Frank: Casa Matriz los maneja en cajas de 1,000 depósitos y 1,000 tapaderas). Ojo: esos dos productos no están en el conteo de las sucursales, solo en Casa Matriz.

**Pendientes:** insumos de las mejoras cobradas que descuentan cero (30 días en combos: Papas Trufa 224, Clásica 231, Aros 240, Peperoncini 217, Fancy Fries 204) — propuesta hecha, falta confirmar cantidades.

**Lección (mía):** antes de preguntar reglas del menú, leer esta bitácora. La regla "Local sin bebida" (1-sep), las cantidades del Royal (Cesar 29-ago) y el problema de los Pilsener (8-sep) ya estaban acá y los pregunté igual.

