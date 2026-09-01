# Reporte de ventas — mensual y anual (ene-2025 → ago-2026)

PDF: `Freakie_Dogs_Ventas_Mensual_Anual_2025-2026.pdf` (5 páginas).

## Cómo se arma
- `datos_ventas_2025_2026.py` — dataset congelado (mes × sucursal) extraído de Supabase el 01-sep-2026,
  con los checksums usados para validar la transcripción contra la BD.
- `generar_reporte.py` — genera `reporte.html`; el PDF se imprime con Chromium headless:

```bash
python3 generar_reporte.py
chromium --headless --no-pdf-header-footer \
  --print-to-pdf=Freakie_Dogs_Ventas_Mensual_Anual_2025-2026.pdf reporte.html
```

## Fuentes
- **Tienda:** `ventas_diarias.total_ventas_quanto` (cierre de caja diario por sucursal).
- **PedidosYa:** `pedidos_peya`, estados Entregado/Retirado. Va aparte del cierre de caja, así que
  sumarlo a la venta de tienda **no duplica** ingresos.
- Validado contra `quanto_ordenes` (DTE) en ene–jun 2026: diferencia ≤ 3%.
