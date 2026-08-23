# PLAN MAESTRO — Inventario Freakie Dogs (23-ago-2026)
> Aprobado por Jose ("sí a todo"). Orden = prioridad. Cada ítem se tacha al completarse con link al PR/migración. Método obligatorio para todo lo que toque motores: huella md5 de costos/deducciones antes y después (ver memoria 22-ago "Arquitectura de unidades").

## EN CURSO
1. ✅ **Pan Berna 10×** — HECHO 23-ago, migración `pan_berna_unidad_stock_es_el_pan`: la etiqueta era el bug (el "1" siempre fue 1 pan); unidad_medida bolsa_10→unidad, costo y deducción verificados con huellas idénticas. Stock actual mixto: lo fija el conteo físico de hoy. OJO fusión con duplicado e9d21e70: B está en bolsas → ×10 al fusionar. (original: — receta dice "1 unidad", stock en bolsa_10: cada hot dog descuenta 10 panes. Método Cheddar: decidir unidad real del producto + factor 0.1 en 4 líneas + verificar costo invariante (hoy costo bien $0.142/pan, deducción mal — mover juntos.)
2. **Fusionar ~17 duplicados** compra vs receta (salchicha 37,769 fantasma, panes, queso amarillo, tocino, cebollas, mayonesa, pepinillos, peperoncini, vinagre, ranch, queso dorar/duro, pimienta, polipel, sobres ketchup/mostaza, cheesecake). Uno por par, con kardex coherente.
3. **28 líneas cruzadas** (`v_recetas_unidades_sin_factor`): validar equivalencias con cocina (barra mantequilla=454g, taza, bote…) y escribir factor_a_stock. UI: columna de factor en tab Recetas (modelo: factor de compra en Mapeo).
4. **"Consumo interno" en Fugas**: flag conteo_clase venta|consumo_interno (derivable de recetas/menú/modificadores) + kardex_diferencias_resumen partido en 2 bloques + índice de eficiencia por sucursal (SOY 0.60 … GPL 1.87). Cargar precio_referencia a los 70 sin costo.

## PRODUCCIÓN (fase 2)
5. **Pantalla de aprobación de órdenes** (backend LISTO: tabla ordenes_produccion + generar_ordenes_produccion + min_max_calculados; dry-run creíble: Cebolla Blanca 7 tandas, Carne 3). Jefe de almacén aprueba/ajusta/asigna → registrar_produccion al completar. Validar fórmula con Jose (Papa Sazonada 787 porciones = revisar cobertura).
6. Cheddar Porcionado: rendimiento OK (3 bolsas/tanda). Recetas desactivadas sin ingredientes (Salchicha, Pepinillos, Jalapeño, Queso frito, Aros): reactivar cuando produzcan.

## DISEÑO (plan 18-ago, datos ya sanos)
7. **Rediseño Kardex**: unificar sobre tokens shadcn de global.css (hoy casi sin adoptar), iconografía única, InfoTips por tab, existencias por sucursal en tab Inventario, tipos+autor en Historial, borrar editor muerto de recetas (KardexView:413-498 → tabla obsoleta recetas_lineas).

## DEUDA VERIFICADA (auditorías 22-ago)
8. **RLS `inventario_all`**: anon puede escribir inventario (llave pública en el bundle). Cerrar fuera de hora pico + prueba de venta real.
9. ✅ **92% de despachos sin firma de recibido** — HECHO 23-ago (PR #305, migración `despacho_confirmar_exige_firma_humana`): vía humana exige `p_usuario`; el cron auto-confirmador sigue vivo pero honesto (`recibido_por=NULL` + nota "AUTO-CONFIRMADO por cron (sin firma humana)"). Pendiente de negocio: decidir si el cron se apaga.
10. ✅ Ajuste manual server-side — HECHO 23-ago (PR #305, migración `kardex_ajuste_manual_exige_motivo_y_usuario`): `kardex_mover` exige usuario + motivo ≥5 chars SOLO para `ajuste_manual`; los otros 7 tipos byte-idénticos (huella md5 + pruebas con rollback).
11. 6 inactivos con incluir_conteo y stock vivo · Bolsa de hielo -64 · negativos (jalapeños, sal, pepinillo triturado) · unidad de conteo ≠ unidad stock (Kolashampan 2,705 "fardos") · conteo semanal para limpieza/papelería.
12. Verificar los ~53 hallazgos restantes de la auditoría de 30 agentes (journal wf_56432c95-ce9). Costeo: 99 productos sin precio (mapeo DTE grupo b/c: 177+2,334 descripciones).

## OPERACIÓN (hoy/esta semana)
- Inventario físico CM (293 productos, pantalla lista) → después decidir las 78 recepciones pendientes y los 2 con_diferencias del 12-13 ago.
- Primera producción real (tanda de Cebolla Blanca) verificada en Historial.
- Estrenar botón merma con el primer producto botado.
- PR #302 (nota órdenes producción) pendiente de merge.
