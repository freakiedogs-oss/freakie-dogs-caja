# Puente de impresión Windows → impresora de red (modo `bridge`)

Ayudante local para **PCs Windows** cuya impresora de recibos es de **red (TCP 9100)
pero NO está instalada como impresora de Windows** (no aparece en el diálogo de
impresión de Chrome). Un navegador no puede abrir sockets crudos, así que este
puente recibe el trabajo del POS por HTTP local y lo reenvía a la impresora por
TCP. Es el equivalente a lo que usa QUANTO por debajo.

Se estrenó en **Soyapango (S001)** el 26-Jul-2026. Impresora `192.168.0.253:9100`.

## Cómo encaja con el POS

En `pos_impresoras` la sucursal queda así:

| campo | valor |
|---|---|
| `modo` | `bridge` |
| `bridge_url` | `http://127.0.0.1:9110/print` |
| `ip_address` / `puerto` | IP real de la impresora / `9100` |

`src/pos/print/printService.js` → `sendBridge()` hace `POST bridge_url` con
`{ ip, port, dataB64 }` (ESC/POS en base64). El puente decodifica y lo manda a
`ip:port`. Si el puente no está corriendo, el POS cae a `modo=sistema` (diálogo).

## Archivos

- **`freakie-print-bridge.ps1`** — el puente. Escucha en `127.0.0.1:9110`
  (loopback, `TcpListener`, **sin admin**), responde CORS + Private-Network, y
  reenvía a la impresora. Registra actividad en `puente-log.txt` (misma carpeta).
- **`Iniciar-Puente-Freakie.bat`** — lo corre **con ventana visible** (para probar
  y ver el log en vivo).
- **`Puente-Freakie-Oculto.vbs`** — lo corre **en segundo plano, sin ventana**
  (uso normal / arranque automático).

> El `.vbs` y el `.ps1` deben estar **siempre en la misma carpeta** (el .vbs busca
> el .ps1 a su lado).

## Instalación en una PC Windows nueva

1. Copiar `freakie-print-bridge.ps1` y `Puente-Freakie-Oculto.vbs` a una carpeta
   (juntos).
2. **Probar:** doble clic en `Iniciar-Puente-Freakie.bat` → ventana "ACTIVO" →
   imprimir una Pre-cuenta desde el POS → debe salir el ticket y verse
   `OK N bytes -> IP:9100`.
3. **Arranque automático:** `Win+R` → `shell:startup` → copiar ahí el `.vbs` **y**
   el `.ps1`. Desde el próximo reinicio corre solo, invisible.
4. Registrar la impresora en `pos_impresoras` con `modo='bridge'` y
   `bridge_url='http://127.0.0.1:9110/print'` (más `ip_address`/`puerto` reales).

## Diagnóstico (`puente-log.txt`)

- `OK N bytes -> 192.168.0.x:9100` → imprimió bien.
- `ERROR: timeout conectando a ...` → la PC no alcanza la impresora (red / IP / la
  impresora apagada). Verificar que ambos estén en la misma subred.
- Sin líneas al imprimir → el navegador no llegó al puente: ¿está corriendo el
  `.vbs`? ¿el puerto `9110` libre? (lo usa solo este puente).

## Notas

- No lleva secretos. Solo mueve bytes de impresión en la LAN.
- El puerto local es `9110` (elegido para no chocar con el `9100` de impresoras).
- Alternativas por tipo de tienda: **Fire** → APK propio (`android-printer/`);
  **Android normal** → APK propio o RawBT; **Windows con impresora de red sin
  driver** → este puente; **Windows con driver instalado** → `modo=sistema`.
