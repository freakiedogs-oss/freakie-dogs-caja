package com.freakiedogs.driver

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
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
        // Heartbeat forzado: el AlarmManager se auto-dispara con esta acción
        const val ACTION_HEARTBEAT = "com.freakiedogs.driver.HEARTBEAT"
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

        // Heartbeat de respaldo: cada 60s el AlarmManager despierta el service
        // y fuerza una lectura de GPS aunque el motorista esté quieto.
        private const val HEARTBEAT_MS = 60_000L
        private const val ALARM_REQ = 4242
    }

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private val alarmMgr by lazy { getSystemService(Context.ALARM_SERVICE) as AlarmManager }
    private var empleadoId: String = ""
    private var nombre: String = ""
    private var callback: LocationCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                cancelarHeartbeat()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_HEARTBEAT -> {
                // Nos despertó el AlarmManager: forzar lectura de GPS y reprogramar.
                // Este camino atraviesa Doze mode, a diferencia del callback normal
                // de FusedLocation que Android suspende cuando el celular está quieto.
                forzarLecturaGps()
                programarHeartbeat()
            }
            ACTION_START, null -> {
                empleadoId = intent?.getStringExtra(EXTRA_EMPLEADO_ID) ?: empleadoId
                nombre = intent?.getStringExtra(EXTRA_NOMBRE) ?: nombre
                startForeground(NOTIF_ID, buildNotif(nombre))
                arrancarLocationUpdates()
                programarHeartbeat()
            }
        }
        // START_STICKY = si Android nos mata, que nos reinicie automáticamente
        return START_STICKY
    }

    /**
     * Programa el próximo despertar del service en HEARTBEAT_MS.
     * setExactAndAllowWhileIdle es la única API que Android garantiza que dispara
     * incluso en Doze mode profundo — por eso el heartbeat sobrevive donde el
     * callback normal de FusedLocation se queda dormido.
     */
    private fun programarHeartbeat() {
        val pi = heartbeatPendingIntent()
        val cuando = SystemClock.elapsedRealtime() + HEARTBEAT_MS
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmMgr.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, pi)
            } else {
                alarmMgr.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, pi)
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo programar heartbeat: ${e.message}")
        }
    }

    private fun cancelarHeartbeat() {
        try { alarmMgr.cancel(heartbeatPendingIntent()) } catch (_: Exception) { }
    }

    private fun heartbeatPendingIntent(): PendingIntent {
        val i = Intent(this, LocationService::class.java).apply { action = ACTION_HEARTBEAT }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        else PendingIntent.FLAG_UPDATE_CURRENT
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            PendingIntent.getForegroundService(this, ALARM_REQ, i, flags)
        else PendingIntent.getService(this, ALARM_REQ, i, flags)
    }

    /**
     * Pide una posición fresca al sistema, sin esperar al callback periódico.
     * Toma un WakeLock corto para que la CPU no se duerma mientras llega la
     * respuesta del GPS y se hace el POST a Supabase.
     */
    @SuppressWarnings("MissingPermission")
    private fun forzarLecturaGps() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "freakie:gps-heartbeat")
        try { wl.acquire(20_000L) } catch (_: Exception) { }

        val soltar = { try { if (wl.isHeld) wl.release() } catch (_: Exception) { } }

        try {
            val req = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(30_000L)   // acepta una lectura de hasta 30s de antigüedad
                .setDurationMillis(15_000L)       // se rinde a los 15s si el GPS no engancha
                .build()

            fused.getCurrentLocation(req, null)
                .addOnSuccessListener { loc: Location? ->
                    if (loc != null) reportar(loc.latitude, loc.longitude, loc.bearing, loc.accuracy)
                    else usarUltimaConocida(soltar)
                }
                .addOnFailureListener { usarUltimaConocida(soltar) }
                .addOnCompleteListener { soltar() }
        } catch (e: SecurityException) {
            Log.e(TAG, "Sin permiso GPS en heartbeat", e)
            soltar()
        }
    }

    /** Si el GPS no responde, al menos mandamos la última posición que el sistema tenga. */
    @SuppressWarnings("MissingPermission")
    private fun usarUltimaConocida(soltar: () -> Unit) {
        try {
            fused.lastLocation
                .addOnSuccessListener { loc: Location? ->
                    if (loc != null) reportar(loc.latitude, loc.longitude, loc.bearing, loc.accuracy)
                }
                .addOnCompleteListener { soltar() }
        } catch (_: SecurityException) { soltar() }
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
        cancelarHeartbeat()
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
