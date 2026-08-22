---
name: driver-gps-beacon
description: "Cómo funciona el sistema de GPS de motoristas — PWA, APK nativo, y las trampas que costaron horas de debug"
metadata:
  node_type: memory
  type: project
---

## PWA (fallback, sigue existiendo)

En `src/driver/DriverBeacon.jsx` el GPS se comparte con `watchPosition` + Wake Lock desde el navegador. Desde 20-ago-2026 hay un botón manual **"🟢 Compartir mi GPS"** que el motorista prende al inicio del turno y apaga al final. Comparte cada 15s haya o no pedidos activos.

**Why:** Karina reportó que el GPS dejaba de actualizarse cuando el motorista salía con el pedido — abrían Waze/Maps y la PWA quedaba en background con el JS congelado. Cesar rechazó explícitamente cualquier notificación/warning al perder foco porque distrae al manejar y puede causar accidentes.

**How to apply:**

- Auto-encendido solo como fallback al recoger un pedido si olvidaron activarlo manualmente
- NUNCA se auto-apaga por "no hay pedidos" — sigue todo el turno
- Se apaga solo al marcar "Terminé mi turno"
- El RPC `tracking_pedido(token)` lee `driver_ubicaciones` con ventana de 15 min
- Limitación: si el motorista bloquea el celular por >30 min o cierra la pestaña, el GPS se detiene

## APK nativo (`android-driver/`, desde 20-ago-2026)

WebView que carga `/driver` + `LocationService.kt` (Foreground Service) que reporta GPS por su cuenta, independiente del WebView. Se compila solo en GitHub Actions al pushear a `main`; el APK sale como artifact. Se distribuye por `/instalar-driver`.

### Tres trampas que costaron horas — leer antes de tocar esto

**1. El `AlarmManager` no sirve para heartbeats cortos.** `setExactAndAllowWhileIdle` está limitado por Android a **1 disparo cada 9 minutos** en Doze mode. Pedir 60s no falla ruidosamente: Android simplemente lo estira. La solución que sí funciona es WakeLock parcial sostenido + `Handler.postDelayed`.

**2. El RPC `actualizar_ubicacion_driver` tiene DOS overloads** (6 y 7 parámetros, el séptimo `p_tipo` con default). Si mandás solo 6 params por PostgREST, responde **HTTP 300 Multiple Choices** y no escribe nada. Hay que mandar siempre `p_tipo`.

**3. Los clientes no deben pegar directo a `*.supabase.co`.** Algunos ISPs de El Salvador lo bloquean por DNS. La PWA usa el proxy `/sb` de Vercel (`api/supaproxy.js` + `src/supabase.js`). Todo código nuevo que hable con Supabase desde un dispositivo tiene que usar ese proxy.

### Diagnóstico sin cable

La notificación del APK muestra `C:<ciclos> · OK hace <n>s · F:<fallos>` y la versión del build. Eso permitió encontrar el bug del HTTP 300 en minutos después de horas de perseguir teorías equivocadas sobre la batería. **Cuando algo del APK falle, instrumentá primero la notificación en vez de adivinar.**

### Manifest

`android:stopWithTask="false"` + `onTaskRemoved` vacío hacen que el service sobreviva cuando el motorista desliza la app fuera del multitasking. En `onDestroy` **no** se llama `desconectar_driver`: si Android mata el service, preferimos que el motorista aparezca en el mapa con GPS viejo (marker amarillo/rojo) antes que desaparecer.
