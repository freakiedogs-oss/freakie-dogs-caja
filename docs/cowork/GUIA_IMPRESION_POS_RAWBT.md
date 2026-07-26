# Guía — Impresión térmica del POS Freakie Dogs (RawBT + ESC/POS)

**Última actualización:** 30 May 2026
**Aplica a:** impresoras WiFi RPT-006B (y compatibles ESC/POS) · tablets/teléfonos Android

---

## 1. Cómo funciona (resumen)

El POS corre como PWA en Vercel (HTTPS). Un navegador **no puede** abrir un socket
crudo al puerto 9100 de la impresora, y la RPT-006B **no tiene** API HTTP (eso solo
lo tienen las Epson ePOS). Por eso usamos **RawBT**, una app Android que:

1. Recibe un deep-link `rawbt:base64,<bytes ESC/POS>` desde la PWA.
2. Abre la conexión TCP a la impresora de red (IP:9100) que tiene configurada.
3. Imprime de forma **silenciosa** (sin diálogo).

Es el mismo enfoque que Kaeru/Eatalia, **mejorado**: enviamos comandos ESC/POS reales
(negritas, doble alto, **QR de consulta DGII**, corte automático) y la configuración de
cada impresora vive en la base de datos (`pos_impresoras`), no en el dispositivo.

```
Tablet Android (Chrome + RawBT)  ──Wi-Fi──>  Impresora RPT-006B (IP:9100)
        │                                            ▲
        └── PWA pos.freakiedogs.com ── rawbt:base64,… ┘
```

---

## 2. Setup por tablet (UNA sola vez, se puede hacer remoto)

1. **Instalar RawBT** desde Google Play en el tablet/teléfono de la sucursal.
2. Abrir RawBT → **Connection / Conexión** → tipo **Network / Wi-Fi**.
3. **IP** = la de la sucursal · **Puerto** = `9100` → Guardar.
   - Cafetalón (M001): `192.168.1.130`
4. En ajustes de RawBT: **ancho de papel 80mm** y **"Print as image" = OFF**
   (para que respete los comandos ESC/POS y no rasterice).
5. El tablet debe estar en la **misma red Wi-Fi** que la impresora.

> No hace falta visitar la sucursal: el setup se puede guiar por teléfono o
> escritorio remoto. Solo son 8 tablets (1 por sucursal).

---

## 3. Probar (antes de usar el POS real)

Abrir en el tablet:

```
https://pos.freakiedogs.com/print-test.html
```

- Probar **Comanda**, **Pre-cuenta** y **Factura** en modo **RawBT ESC/POS**.
- Si algo sale raro, probar modo **RawBT texto** (RawBT formatea) o **Sistema**
  (diálogo del navegador) para aislar el problema.
- La factura incluye un **QR** que abre la consulta pública de Hacienda.

---

## 4. Agregar las demás sucursales

Cuando una sucursal tenga su impresora con IP fija, registrarla en Supabase
(tabla `pos_impresoras`). Ejemplo:

```sql
INSERT INTO public.pos_impresoras
  (sucursal_id, store_code, nombre, tipo, conexion, ip_address, puerto,
   modelo, ancho_papel, ancho_cols, modo, rol, cortar, activa)
SELECT id, 'S001', 'RPT-006B Soyapango', 'recibo', 'red',
       '192.168.X.Y', 9100, 'RPT-006B', 80, 48, 'rawbt', 'todo', true, true
FROM sucursales WHERE store_code = 'S001';
```

Campos clave:
- `modo`: `rawbt` (default), `bridge` (si algún día se usa un agente HTTP→TCP9100),
  o `sistema` (fallback window.print).
- `ancho_cols`: `48` para 80mm fuente A, `32` para 58mm.
- `rol`: `todo` (1 impresora hace cocina + caja). Futuro: `cocina` / `caja` separadas.

---

## 5. Dónde está el código

| Archivo | Qué hace |
|---|---|
| `src/pos/print/escpos.js` | Generador de bytes ESC/POS 80mm (negrita, QR, corte, PC850). |
| `src/pos/print/printService.js` | Config centralizada + 3 documentos + despacho RawBT/bridge/sistema. |
| `src/pos/cajero/POSMain.jsx` | Llama `printPreCuenta`, `printComanda` (al comandar), `printFactura` (al cobrar). |
| `public/print-test.html` | Página de prueba autocontenida. |
| Supabase `pos_impresoras` | IP/puerto/modo por sucursal. |

---

## 6. Notas y futuro

- **Fallback automático**: si RawBT no está instalado o falla, el POS cae a
  `window.print()` (diálogo del sistema) para no dejar al cajero sin imprimir.
- **Acentos**: se usa codepage PC850; lo no mapeado se transcribe a ASCII para
  evitar basura en impresoras genéricas.
- **Alternativa "modo bridge"** (no implementada aún): un mini-agente HTTP→TCP9100
  en la LAN permitiría imprimir con la IP 100% desde la BD (sin configurar RawBT por
  tablet). Útil si en el futuro se quiere cero-toque por dispositivo. La columna
  `bridge_url` y el despacho ya están preparados en `printService.js`.
- **Gaveta de dinero**: `escpos.js` incluye `drawer()`; activar con `abrir_caja=true`
  en `pos_impresoras` cuando haya gaveta conectada a la impresora.
