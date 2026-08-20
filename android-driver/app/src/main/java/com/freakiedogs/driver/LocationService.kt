package com.freakiedogs.driver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Foreground Service que reporta GPS a Supabase cada 15 segundos mientras el
 * motorista esté "compartiendo GPS". Sobrevive: app cerrada, pantalla bloqueada,
 * Waze abierto, Doze mode. Android promete no matarlo mientras la notificación
 * permanente esté visible.
 *
 * Uso desde MainActivity Bridge:
 *   startLocation(empleadoId, nombre, tipo) → arranca el servicio
 *   stopLocation()                          → detiene y remueve notif
 */
class LocationService : Service() {

    companion object {
        private const val TAG = "FreakieLocSvc"
        const val ACTION_START = "com.freakiedogs.driver.START"
        const val ACTION_STOP  = "com.freakiedogs.driver.STOP"
        const val EXTRA_EMPLEADO_ID = "empleado_id"
        const val EXTRA_NOMBRE = "nombre"
        const val EXTRA_TIPO = "tipo"

        private const val CHANNEL_ID = "freakie_gps"
        private const val CHANNEL_NAME = "Freakie GPS activo"
        private const val NOTIF_ID = 42

        // Configuración de Supabase (misma anon key que usa la PWA)
        private const val SUPABASE_URL = "https://btboxlwfqcbrdfrlnwln.supabase.co"
        private const val ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Ym94bHdmcWNicmRmcmxud2xuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjcyMzQsImV4cCI6MjA4OTU0MzIzNH0.NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4"

        // Cada cuántos ms reportamos GPS al servidor
        private const val INTERVALO_MS = 15_000L

        // Heartbeat propio: cada 20s forzamos lectura de GPS aunque el motorista
        // esté quieto. Corre sobre un Handler con WakeLock sostenido, NO sobre
        // AlarmManager — Android limita setExactAndAllowWhileIdle a 1 disparo
        // cada 9 minutos en Doze mode, lo que hacía inútil el heartbeat anterior.
        private const val HEARTBEAT_MS = 20_000L
    }

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var empleadoId: String = ""
    private var nombre: String = ""
    private var callback: LocationCallback? = null

    // WakeLock sostenido: mientras el motorista comparta GPS, la CPU no duerme.
    // Es lo que permite que el loop del Handler corra con pantalla bloqueada.
    // Se suelta al detener el servicio → el consumo vuelve a normal.
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private var loopActivo = false

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            if (!loopActivo) return
            forzarLecturaGps()
            handler.postDelayed(this, HEARTBEAT_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                detenerHeartbeat()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START, null -> {
                empleadoId = intent?.getStringExtra(EXTRA_EMPLEADO_ID) ?: empleadoId
                nombre = intent?.getStringExtra(EXTRA_NOMBRE) ?: nombre
                startForeground(NOTIF_ID, buildNotif(nombre))
                tomarWakeLock()
                arrancarLocationUpdates()
                arrancarHeartbeat()
            }
        }
        // START_STICKY = si Android nos mata, que nos reinicie automáticamente
        return START_STICKY
    }

    /**
     * WakeLock parcial sin timeout: la pantalla puede apagarse pero la CPU sigue
     * viva. Sin esto Android suspende el proceso a los pocos minutos y el loop
     * del Handler deja de correr. Se libera en detenerHeartbeat().
     */
    private fun tomarWakeLock() {
        if (wakeLock?.isHeld == true) return
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "freakie:gps-turno").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo tomar WakeLock: ${e.message}")
        }
    }

    private fun soltarWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) { }
        wakeLock = null
    }

    private fun arrancarHeartbeat() {
        if (loopActivo) return
        loopActivo = true
        handler.postDelayed(heartbeatRunnable, HEARTBEAT_MS)
    }

    private fun detenerHeartbeat() {
        loopActivo = false
        handler.removeCallbacks(heartbeatRunnable)
        soltarWakeLock()
    }

    /**
     * Pide una posición fresca al sistema, sin esperar al callback periódico de
     * FusedLocation (que Android suspende cuando el celular lleva rato quieto).
     */
    @SuppressWarnings("MissingPermission")
    private fun forzarLecturaGps() {
        try {
            val req = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(30_000L)   // acepta una lectura de hasta 30s de antigüedad
                .setDurationMillis(15_000L)       // se rinde a los 15s si el GPS no engancha
                .build()

            fused.getCurrentLocation(req, null)
                .addOnSuccessListener { loc: Location? ->
                    if (loc != null) reportar(loc.latitude, loc.longitude, loc.bearing, loc.accuracy)
                    else usarUltimaConocida()
                }
                .addOnFailureListener { usarUltimaConocida() }
        } catch (e: SecurityException) {
            Log.e(TAG, "Sin permiso GPS en heartbeat", e)
        }
    }

    /** Si el GPS no responde, al menos mandamos la última posición que el sistema tenga. */
    @SuppressWarnings("MissingPermission")
    private fun usarUltimaConocida() {
        try {
            fused.lastLocation.addOnSuccessListener { loc: Location? ->
                if (loc != null) reportar(loc.latitude, loc.longitude, loc.bearing, loc.accuracy)
            }
        } catch (_: SecurityException) { /* sin permiso, nada que hacer */ }
    }

    /**
     * Notificación permanente que Android REQUIERE para un Foreground Service.
     * Es silenciosa (sin sonido/vibración) y baja prioridad para no distraer.
     */
    private fun buildNotif(driverNombre: String): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
                description = "GPS activo mientras el motorista está de turno"
                setShowBadge(false)
                enableVibration(false)
                setSound(null, null)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }

        val abrirApp = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, abrirApp,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("🛵 Freakie GPS activo")
            .setContentText(if (driverNombre.isNotBlank()) "$driverNombre — reportando ubicación" else "Reportando ubicación")
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build()
    }

    /**
     * Suscripción al FusedLocationProvider — combina GPS, WiFi y celular para
     * mejor precisión con menos batería que el GPS crudo.
     */
    @SuppressWarnings("MissingPermission")
    private fun arrancarLocationUpdates() {
        detenerLocationUpdates()
        // setMinUpdateDistanceMeters(0f) fuerza updates cada intervalo aunque el
        // motorista no se mueva (importante para heartbeat: sin esto, si está
        // parado en un semáforo o esperando pedido, FusedLocation deja de mandar).
        // setMaxUpdateDelayMillis(0) desactiva el batching — cada update va directo.
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVALO_MS)
            .setMinUpdateIntervalMillis(INTERVALO_MS / 3)      // mínimo 5s entre updates
            .setMaxUpdateDelayMillis(0)                        // sin batching, tiempo real
            .setMinUpdateDistanceMeters(0f)                    // no filtrar por distancia
            .setWaitForAccurateLocation(false)
            .build()

        callback = object : LocationCallback() {
            override fun onLocationResult(res: LocationResult) {
                val loc = res.lastLocation ?: return
                reportar(loc.latitude, loc.longitude, loc.bearing, loc.accuracy)
            }
        }
        try {
            fused.requestLocationUpdates(req, callback!!, Looper.getMainLooper())
        } catch (e: SecurityException) {
            Log.e(TAG, "Sin permiso GPS", e)
        }
    }

    private fun detenerLocationUpdates() {
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
    }

    /**
     * POST a Supabase RPC actualizar_ubicacion_driver — el mismo endpoint que
     * usa la PWA. En thread separado para no bloquear el callback de GPS.
     */
    private fun reportar(lat: Double, lng: Double, rumbo: Float, precision: Float) {
        if (empleadoId.isBlank()) return
        thread(name = "gps-post") {
            try {
                val url = URL("$SUPABASE_URL/rest/v1/rpc/actualizar_ubicacion_driver")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", ANON_KEY)
                conn.setRequestProperty("Authorization", "Bearer $ANON_KEY")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                val nombreEsc = nombre.replace("\\", "\\\\").replace("\"", "\\\"")
                val body = """
                    {"p_empleado_id":"$empleadoId","p_nombre":"$nombreEsc",
                     "p_lat":$lat,"p_lng":$lng,
                     "p_rumbo":${if (rumbo.isNaN()) "null" else rumbo},
                     "p_exactitud":${if (precision.isNaN()) "null" else precision}}
                """.trimIndent()
                conn.outputStream.use { it.write(body.toByteArray()) }
                val code = conn.responseCode
                if (code !in 200..299) Log.w(TAG, "HTTP $code al reportar GPS")
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Falló POST GPS: ${e.message}")
            }
        }
    }

    override fun onDestroy() {
        detenerLocationUpdates()
        detenerHeartbeat()
        // OJO: no llamamos desconectar_driver acá. Si Android nos mata por batería,
        // no queremos que el motorista aparezca como offline — preferimos que en
        // el mapa figure con GPS "hace X min" (marker amarillo/rojo) para que
        // el despachador sepa que hay que llamarlo. La desconexión real solo
        // ocurre cuando el motorista toca "Detener GPS" en la app (stopLocation).
        super.onDestroy()
    }

    /**
     * Si Android desliza la task fuera del multitasking, este método se llama.
     * NO llamamos super — así el service sobrevive al swipe-out del usuario.
     * Combinado con android:stopWithTask="false" en el Manifest, el GPS sigue.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        // Intencionalmente vacío: el service continúa aunque el usuario cierre la app.
    }
}
