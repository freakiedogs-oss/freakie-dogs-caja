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
  **Blindado (28-Jul-2026):** si el puerto ya está ocupado por un puente **sano**
  sale en silencio (no tira el error rojo del `.bat`); si es un **zombie** lo
  reporta y sale para que el watchdog lo limpie; responde `GET /health`; y un
  error en una petición **ya no mata el loop**.
- **`Reiniciar-Puente.bat`** ⭐ — **un solo clic**: mata cualquier puente viejo o
  colgado, libera el puerto y arranca uno limpio (ventana visible con el log).
  **Es lo que debe usar el personal** cuando "no imprime" — reemplaza el hunt en
  el Administrador de tareas.
- **`watchdog.ps1`** — revisa `/health` y, si el puente está caído/colgado, lo
  mata y relanza **oculto**. Lo dispara una Tarea Programada (no se corre a mano).
- **`Instalar-Arranque-Automatico.bat`** ⭐ — registra la Tarea Programada
  (arranque al iniciar sesión + autocuración cada 2 min). Se corre **una vez** al
  instalar. Reemplaza el frágil `.vbs` en `shell:startup`.
- **`Iniciar-Puente-Freakie.bat`** — arranque manual visible (legacy; para probar).
- **`Puente-Freakie-Oculto.vbs`** — arranque manual oculto (legacy).

> Todos los archivos deben estar **en la misma carpeta**.

## Instalación en una PC Windows nueva

1. Copiar **toda la carpeta** `windows-print-bridge` a la PC (p. ej. al Escritorio).
2. **Probar:** doble clic en **`Reiniciar-Puente.bat`** → ventana "ACTIVO" →
   imprimir una Pre-cuenta desde el POS → debe salir el ticket y verse
   `OK N bytes -> IP:9100`. (En Chrome, `http://127.0.0.1:9110/health` debe decir
   `Freakie print bridge OK`.)
3. **Arranque automático + autocuración:** doble clic en
   **`Instalar-Arranque-Automatico.bat`** (una sola vez). Desde ahí el puente
   arranca solo con Windows y se reinicia solo si se cae.
4. Registrar la impresora en `pos_impresoras` con `modo='bridge'` y
   `bridge_url='http://127.0.0.1:9110/print'` (más `ip_address`/`puerto` reales).

## Si "no imprime" (para el personal)

1. **Doble clic en `Reiniciar-Puente.bat`.** Espera a que diga "ACTIVO".
2. Mandá a imprimir una comanda. En esa ventana debe salir
   `OK N bytes -> 192.168.0.253:9100`.
3. Si en vez de eso sale `ERROR: timeout conectando a ...`, el problema es la
   **impresora/red** (apagada, sin papel, cable, o IP): revisá la impresora.

> Ya **no** hay que abrir el `.bat` viejo si el puente está corriendo (daba el
> error rojo "el puerto 9110 ya está en uso"). Usá siempre `Reiniciar-Puente.bat`.

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
