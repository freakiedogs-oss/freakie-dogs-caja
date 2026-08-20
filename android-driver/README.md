# Freakie Drivers — APK Android nativo

App Android que reemplaza la PWA del motorista para garantizar GPS en background 100% confiable (con app cerrada, pantalla bloqueada, Waze abierto).

## Arquitectura

- **WebView** carga `https://freakie-dogs-caja.vercel.app/driver` — mismo código React que corre en la PWA. Cero duplicación de UI.
- **LocationService.kt** — Foreground Service Android que corre en paralelo al WebView. Usa `FusedLocationProviderClient` (Google Play Services) para GPS optimizado. Reporta a Supabase RPC `actualizar_ubicacion_driver` cada 15s vía HTTP POST directo (no depende del WebView estar activo).
- **Bridge JS** — `window.AndroidPrinter.hasLocationNative()` devuelve `true` cuando corre dentro del APK. La PWA lo detecta en `DriverBeacon.jsx` líneas ~361 y usa el service nativo en vez de `navigator.geolocation`.

## Compilar (Android Studio)

```bash
cd android-driver
./gradlew assembleDebug           # APK sin firmar para pruebas
# Output: app/build/outputs/apk/debug/app-debug.apk
```

Para release firmado:
```bash
export KEYSTORE_FILE=/ruta/freakie-driver.keystore
export KS_PASS=xxxxx
export KS_ALIAS=freakiedriver
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
```

Generar keystore la primera vez:
```bash
keytool -genkey -v -keystore freakie-driver.keystore \
  -alias freakiedriver -keyalg RSA -keysize 2048 -validity 10000
```

## Distribución sideload

1. Compilar APK release firmado
2. Subir `app-release.apk` a Vercel en `public/apk/freakie-drivers.apk`
3. Crear página `/instalar-driver` con instrucciones + botón descarga
4. Mandar link por WhatsApp a los motoristas

## Cómo instala el motorista

1. Toca el link del WhatsApp → descarga `freakie-drivers.apk`
2. Toca el archivo → Android pide "Permitir instalar apps de origen desconocido" → Sí
3. Se instala, aparece ícono 🛵 rojo
4. Abre la app → mete PIN → toca "Compartir GPS"
5. Android pide 2 permisos: Ubicación "Permitir siempre" + Notificaciones "Permitir"
6. Aparece notificación permanente **"🛵 Freakie GPS activo"** — no se debe borrar

## Permisos usados

- `ACCESS_FINE_LOCATION` — GPS de alta precisión
- `ACCESS_BACKGROUND_LOCATION` — GPS con app cerrada (Android 10+)
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` — corre servicio persistente
- `POST_NOTIFICATIONS` — notificación del servicio (Android 13+)
- `WAKE_LOCK` — mantener CPU activa durante heartbeat
- `RECEIVE_BOOT_COMPLETED` — reservado para futuro auto-arranque al reiniciar celular
