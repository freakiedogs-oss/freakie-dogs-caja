# Resumen de sesión — Freakie Dogs ERP (Kako + Kaeru)
_Fecha: 17–19 jun 2026_

Documento de traspaso para retomar desde otro chat. Cubre todo lo trabajado: cambios de código, migraciones SQL y la nueva automatización de banco.

---

## Contexto del proyecto
- **Dos ERPs gemelos**: `_KAKO_CAKES_BLUEPRINT` (Kako Cakes) y `_KAERU_CHAN_BLUEPRINT` (Kaeru Chan). React 18 + Vite + TypeScript + Tailwind + shadcn, PWA mobile-first.
- **Repos git** (carpeta `vercel-deploy`):
  - Kako: `_KAKO_CAKES_BLUEPRINT/vercel-deploy` → origin `freakiedogs-oss/kako-cakes-erp` (es repo git directo).
  - Kaeru: el blueprint NO es repo; se pushea desde el clon `~/Documents/kaeru-chan-erp` (copiar archivo y commitear ahí).
- **Supabase**: proyecto `btboxlwfqcbrdfrlnwln`, multi-schema `kako` / `kaeru` / `public`. PostgREST por schema (`Accept-Profile`/`Content-Profile`). URL: `https://btboxlwfqcbrdfrlnwln.supabase.co`.
- **Regla de oro**: mantener Kako y Kaeru homologados, preservar lógica específica de Kako (provisión de renta $2,683.50/mes vía `v_rentabilidad_mensual`; nunca duplicar renta), y confirmar antes de cambios con impacto financiero.

---

## Cambios de código (frontend) — pendientes o hechos de push

### 1. DTEs.tsx — paginación (AMBOS ERPs) ✅ hecho, push pendiente/parcial
- Bug: la lista cortaba en `.limit(200)` pero hay 452 (Kaeru) / 510 (Kako) DTEs → conteos no cuadraban (6 vs 2).
- Fix: loop de paginación de 1000 (`fetchAllDtes`).
- También se notó que `%innova%` mezclaba 2 proveedores (Innova Tecnología vs Innovarte).

### 2. Revision.tsx (Revisión P&L) — filtros (AMBOS ERPs) ✅
- Se agregaron 3 filtros tipo Bancos: **categoría**, **proveedor**, **aplicación**.

### 3. PnLMensual.tsx — varios (AMBOS ERPs) ✅
- **Split planilla**: dos filas **Salario operativo** y **Salario gerencial** (antes una sola "Salario pagado").
- **Fix doble conteo de propinas en el drill**: el detalle de "salario" incluía las propinas (138 movs, $8,112). Corregido en la vista `v_labor_detalle`.
- **% de propina**: cambiado de `propina/propina_recogida` ("% de recogida") a **`propina ÷ venta en mesa`** (excluye PeYa) → muestra "X.X% s/ venta mesa".
- **Drill por mes**: las filas de planilla / aporte / financiamiento ahora filtran al **mes** al tocar la celda de ese mes (componente `Cell` con prop `onMes`), igual que las filas de gasto. Tocar la etiqueta = rango completo.
- **Tooltips ⓘ por fila**: cada línea del estado de resultados tiene un ícono ⓘ que al pasar el mouse muestra fórmula + fuente del dato (componente `InfoTip` + mapa `INFO`). Cash Flow Neto, EBITDA, etc. con su desglose. En Kako los textos incluyen Otros ingresos B2B y Costo Fijo = renta provisión.

> **Comandos de push** (ambos repos) al final del documento.

---

## Migraciones / cambios SQL (aplicados en vivo)

### Vistas de planilla (ambos schemas)
- `v_labor_pl_mensual`: ahora expone `salario_operativo` + `salario_gerencial` (además de `salario_pagado`).
- `v_labor_detalle`: ramas `salario_operativo` / `salario_gerencial` que **excluyen** `propinas_pagadas` (fix del doble conteo).

### Reintegros FIFO (solo Kaeru)
- Tab "Reintegros → DTE" (`v_reintegros_aplicar`): reembolsos de compras de Yessica/Karen.
- Se aplicó **FIFO** a los que tenían DTEs pendientes que absorbían el monto: **Tienda Morena** ($1,322), **Vidri** ($7.50), **Freund** ($36.75).
- Los Pricemart/Walmart/Fumao (sin DTEs, $0 saldo) se marcaron **gasto sin DTE** (P&L directo) — evitando ~$3,500 de "saldo a favor" fantasma.
- Ambiguos (Super, Comida personal, Gas, Pancetta, Dollar City, Selectos sin proveedor en DB, Sin detalle, etc.) **se dejaron sin tocar**.
- Vista `v_reintegros_aplicar` ajustada (ambos schemas) para excluir los ya resueltos como `gasto-sin-dte-concepto`.

### Cobro por transferencia (Kaeru — homologación con Kako)
- Kaeru NO tenía las categorías que Kako sí: se agregaron **`cobro_transferencia`** y **`venta_b2b`** (grupo Ingreso, `afecta_pl=false`).
- Vista `v_financiamiento_mov` (Kaeru) parchada: filtro `destino_pl <> 'no_pl'` → cualquier crédito clasificado como cobro sale del ledger de financiamiento (igual que Kako).
- Reclasificados como `cobro_transferencia` (no préstamo): **Ricardo Cáceres** ($36.18) y **Karla Elías** ($16.94).
- **Para clasificar un crédito como pago de cliente**: en Bancos elegir "Cobro Transferencia" → se quita solo del financiamiento.

### Clasificación de DTEs en Kako (69 DTEs)
- **Lección clave**: el P&L lee la clasificación de **`dte_clasificacion`** (vía RPC `dte_clasificar`), NO de `compras_dte.cuenta_contable` (campo legacy). El badge "Sin Clasificar (revisar)" = `dte_clasificacion.categoria_id = 'sin_clasificar'` o sin fila.
- Se clasificaron 69 DTEs por ítems comprados:
  - **Costo Comida**: Azúcar, Legeam (tapioca), Larios (tés), sorbete taro, masa tartaleta, **gas de Karla Ivonne** (cilindros — se usan para cocinar).
  - **Insumo Venta**: Axben, Plásticos Diversos, Ideas Para Cakes, Protectores Corrugados (empaque/bandejas/vasos/cajas/discos).
  - **Mantenimiento**: Corporación Lemus, Edgardo Ramos, Julio Cañas, Sumersa, MUBRO (construcción/reparación).
  - **Limpieza**: Lemus (limpiador+mascón). **Mercadeo**: Oscar Lara (video). **Gastos Operativos**: La Casa de Baterías.
- **Nota Kako**: clasificar como `costo_fijo` hace que el monto NO aparezca en el P&L (esa línea se reemplaza por la provisión de renta de `v_rentabilidad_mensual`, que sustituye la provisión cuando llega el DTE real vía tabla `renta_mensual`). Por eso el gas se mandó a Costo Comida, no a Costo Fijo.

---

## Automatización: ingesta del Estado de Cuenta diario BAC desde Gmail ✅
- Banco **BAC** (`reportesbac@baccredomatic.com`) manda diario el "Estado de Cuenta Diario" al Gmail de Kaeru.
- El correo trae un link "Ver reporte" **envuelto en tracking de Amazon SES (awstrack.me)** → redirige a `h2h.credomatic.com` (portal MyFaces "Download Package") → descarga un **.zip** con 3 archivos; el `*_detail_*.csv` (pipe-delimited) trae los movimientos.
- **Script creado**: `gmail_bac_to_supabase_kaeru.gs` (en esta carpeta). Flujo:
  1. Busca correos del remitente (etiqueta `kaeru-bac-pendiente`).
  2. Sigue redirects awstrack→h2h (toma cookie de sesión).
  3. POST al form `downloadPackageForm` (ViewState + `linkId` dinámico) → 302 a `/webclient/pkgDownload` → baja el zip (forzando content-type `application/zip` para `Utilities.unzip`).
  4. Parsea el CSV de detalle → mapea a `estados_cuenta_bancarios` (`Fecha→fecha`, `Referencia→referencia`, `Codigo→codigo_bac`, `Descripcion→descripcion`, `Credito−Debito→monto`, `Balance→balance_post`).
  5. Inserta con **dedupe** por `referencia|fecha|monto`. Corre `banco_autoclasificar()`. Etiqueta `kaeru-bac-procesado` / `kaeru-bac-error`.
- **Setup en Apps Script** (ya hecho por el usuario):
  - Script Properties: `SUPABASE_URL` y `SUPABASE_KEY` (service_role).
  - Filtro Gmail manual: de `reportesbac@baccredomatic.com` → etiqueta `kaeru-bac-pendiente`.
  - `LABEL_PEND = 'kaeru-bac-pendiente'` (para no reprocesar viejos).
  - Trigger por tiempo cada hora (`crearTrigger`).
- **Importante**: cada reporte tiene descargas limitadas ("Remaining: 1"); el POST consume una. Los tokens duran horas. Probado de punta a punta; confirmar con el correo fresco del día siguiente en la página **Bancos**.
- **Fragilidad**: si BAC cambia el HTML del portal, ajustar `_descargarZip` (extracción de `linkId`/ViewState/action).

---

## Pendientes / próximos pasos
1. **Push de frontend** (si no se ha hecho ya), ambos repos:
   ```bash
   # Kako
   cd "/Users/joseisart/Documents/Freakies/Claude/Freakie Dogs ERP/_KAKO_CAKES_BLUEPRINT/vercel-deploy"
   rm -f .git/index.lock
   git add src/pages/DTEs.tsx src/pages/Revision.tsx src/pages/PnLMensual.tsx
   git commit -m "DTEs paginacion; Revision filtros; P&L split salario/propina/% mesa/drill mes/tooltips"
   git push

   # Kaeru
   BP="/Users/joseisart/Documents/Freakies/Claude/Freakie Dogs ERP/_KAERU_CHAN_BLUEPRINT/vercel-deploy"
   cp "$BP/src/pages/DTEs.tsx" "$BP/src/pages/Revision.tsx" "$BP/src/pages/PnLMensual.tsx" ~/Documents/kaeru-chan-erp/src/pages/
   cd ~/Documents/kaeru-chan-erp
   git add src/pages/DTEs.tsx src/pages/Revision.tsx src/pages/PnLMensual.tsx
   git commit -m "DTEs paginacion; Revision filtros; P&L split salario/propina/% mesa/drill mes/tooltips"
   git push
   ```
2. Confirmar mañana que el script BAC insertó el estado de cuenta en `estados_cuenta_bancarios` (Kaeru).
3. (Opcional) Homologar el script de ingesta BAC para Kako si su banco manda algo similar.
4. (Diferido) Registrar/clasificar personas no matcheadas pendientes; sync de Notion.

## Archivos clave
- `gmail_bac_to_supabase_kaeru.gs` — automatización ingesta BAC (esta carpeta).
- `_KA{KO,ERU}_*/vercel-deploy/src/pages/PnLMensual.tsx`, `DTEs.tsx`, `Revision.tsx` — cambios frontend.
- Lógica DTE Kako: tabla `dte_clasificacion` + RPC `dte_clasificar` (NO `cuenta_contable`).
