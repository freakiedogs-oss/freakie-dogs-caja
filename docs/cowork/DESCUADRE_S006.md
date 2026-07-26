# Descuadre S006 — cuentas cobradas sin registro de pago

**Hallazgo (2026-07-14):** en el POS de Metro Centro hay **cuentas marcadas `cobrada` con DTE emitido pero sin ninguna fila en `pos_cuenta_pagos`** (no se guardó el método de pago). Por eso el cierre por método suma ~$93 menos que el total de venta.

Todas son del mismo cajero (`cajero_id = 55691a58-21cb-4918-af9c-4b77d96d6b39`).

| Día | Total | DTE (numero_control) |
|---|---|---|
| 2026-07-11 | $7.98 | DTE-01-S006P001-001783791498940 |
| 2026-07-13 | $21.98 | DTE-01-S006P001-001783966592522 |
| 2026-07-13 | $16.73 | DTE-01-S006P001-001783966775219 |
| 2026-07-13 | $22.98 | DTE-01-S006P001-001783968781037 |
| 2026-07-13 | $22.23 | DTE-01-S006P001-001783969301068 |
| 2026-07-14 | $11.98 | DTE-01-S006P001-001784052348765 |
| 2026-07-14 | $11.97 | DTE-01-S006P001-001784053669944 |

Total sin método: ~$115.85 en estas 7 (el gap neto vs cierre es ~$93 porque el 14-jul hay además un descuadre menor de redondeo).

## Qué significa
- **Son ventas reales** (DTE válido). No hay que anularlas.
- El impacto es solo en el **desglose por método** del cierre (efectivo vs tarjeta): esas ventas no se atribuyen a ningún método, así que "Efectivo calculado a depositar" queda corto por lo que haya sido en efectivo.
- La **venta total** (Finanzas, KPIs, VentasFreakies) sí las cuenta, porque esos leen `pos_cuentas.total`, no los pagos.

## Recomendación
1. **Causa raíz (código POS):** el flujo de cobro debería escribir `pos_cuenta_pagos` **de forma atómica** con marcar la cuenta `cobrada`/emitir DTE. Hoy parece que en ciertos casos (¿corte de red, doble tap, split?) se salta esa inserción. Revisar `POSMain.jsx` / `SplitCheckModal.jsx` en el paso de cobro.
2. **Reparación de datos (opcional):** si el cajero recuerda/consta el método, insertar las filas de pago faltantes. Si no, se pueden dejar como están (la venta ya cuenta) o asignarlas a un método por defecto para cuadrar caja.
3. Vale la pena un chequeo diario: `pos_cuentas cobradas sin pos_cuenta_pagos` → alerta.
