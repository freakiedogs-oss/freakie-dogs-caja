package com.freakiedogs.driver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
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
import org.json.JSONObject
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
        // «Ya los retiré» desde la notificación de la alarma
        const val ACTION_RECOGER = "com.freakiedogs.driver.RECOGER"
        const val EXTRA_EMPLEADO_ID = "empleado_id"
        const val EXTRA_NOMBRE = "nombre"
        const val EXTRA_TIPO = "tipo"
        const val EXTRA_MOTIVO = "motivo"

        private const val CHANNEL_ID = "freakie_gps"
        private const val CHANNEL_NAME = "Freakie GPS activo"
        private const val NOTIF_ID = 42

        // Alarma «pedido listo» (7-nov-2026): canal propio de prioridad alta.
        // El sonido NO va en el canal: se reproduce a mano cada 10 s por el
        // stream de ALARMA, que suena aunque el celular esté en silencio.
        private const val ALARMA_CHANNEL_ID = "freakie_pedido_listo_v1"
        private const val ALARMA_NOTIF_ID = 43
        private const val ALARMA_REPETIR_MS = 10_000L

        // Proxy de Vercel — MISMA ruta que usa la PWA en producción (src/supabase.js).
        // Varios ISPs de El Salvador filtran *.supabase.co por DNS, así que pegar
        // directo desde el celular falla con UnknownHostException. El proxy /sb
        // reenvía a Supabase desde el servidor de Vercel, que no está bloqueado.
        private const val PROXY_URL = "https://freakie-dogs-caja.vercel.app/sb"
        // Origen real: se usa como respaldo si el proxy no responde.
        private const val SUPABASE_URL = "https://btboxlwfqcbrdfrlnwln.supabase.co"
        private const val ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Ym94bHdmcWNicmRmcmxud2xuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjcyMzQsImV4cCI6MjA4OTU0MzIzNH0.NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4"

        // Cada cuántos ms reportamos GPS al servidor
        private const val INTERVALO_MS = 15_000L

        // Heartbeat propio: cada 20s forzamos lectura de GPS aunque el motorista
        // esté quieto. Corre sobre un Handler con WakeLock sostenido, NO sobre
        // AlarmManager — Android limita setExactAndAllowWhileIdle a 1 disparo
        // cada 9 minutos en Doze mode, lo que hacía inútil el heartbeat anterior.
        private const val HEARTBEAT_MS = 20_000L

        // Etiqueta visible en la notificación — sirve para confirmar de un vistazo
        // qué build está instalado en el celular. Subir en cada cambio.
        const val VERSION_APK = "v12-gps-siempre"

        // Cada cuántos ciclos (de 20 s) se reporta el estado de la app al servidor
        private const val CICLOS_ESTADO = 3
        // Puntos sin enviar que se mandan por tanda cuando vuelve el internet
        private const val LOTE_COLA = 200
    }

    // Contadores de diagnóstico que se muestran en la notificación
    private var ciclos = 0
    private var fallos = 0
    private var ultimoOkMs = 0L
    // Último motivo de fallo (código HTTP o excepción) — se muestra en la notif
    // para poder diagnosticar sin cable ni logcat.
    private var ultimoError = ""

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var empleadoId: String = ""
    private var nombre: String = ""
    // 'delivery' o 'despacho'. Va SIEMPRE en el POST: en la base hay dos
    // versiones de actualizar_ubicacion_driver (6 y 7 parámetros) y sin este
    // campo el servidor no sabe cuál elegir y responde 300 Multiple Choices.
    private var tipo: String = "delivery"
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
            ciclos++
            Turno.latido(this@LocationService)          // el vigilante revisa este latido
            refrescarNotif()
            revisarUbicacionYPermiso()
            forzarLecturaGps()
            revisarAlarma()
            if (ciclos % CICLOS_ESTADO == 0) reportarEstado()
            vaciarCola()
            handler.postDelayed(this, HEARTBEAT_MS)
        }
    }

    // ── Alarma «pedido listo» ──────────────────────────────────────────
    private var alarmaSonando = false
    private var player: MediaPlayer? = null
    private val sonidoRunnable = object : Runnable {
        override fun run() {
            if (!alarmaSonando) return
            sonarUnaVez()
            handler.postDelayed(this, ALARMA_REPETIR_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                // Solo el motorista termina el turno: se borra la memoria del turno
                // y se apagan los vigilantes, así nada lo vuelve a prender.
                Turno.terminar(this)
                Vigilante.cancelar(this)
                Avisos.gpsOk(this); Avisos.ubicacionOk(this); Avisos.permisoOk(this)
                detenerHeartbeat()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_RECOGER -> {
                // Puede llegar con el servicio vivo (lo normal) o recién creado:
                // en ese caso Android exige startForeground enseguida.
                intent?.getStringExtra(EXTRA_EMPLEADO_ID)?.takeIf { it.isNotBlank() }?.let { empleadoId = it }
                startForeground(NOTIF_ID, buildNotif(nombre))
                recogerListos()
                return START_STICKY
            }
            ACTION_START, null -> {
                empleadoId = intent?.getStringExtra(EXTRA_EMPLEADO_ID)?.takeIf { it.isNotBlank() } ?: empleadoId
                nombre = intent?.getStringExtra(EXTRA_NOMBRE)?.takeIf { it.isNotBlank() } ?: nombre
                tipo = intent?.getStringExtra(EXTRA_TIPO)?.takeIf { it.isNotBlank() } ?: tipo
                // v12: si Android nos revivió solo (intent null) o nos arrancó el
                // vigilante/encendido, el motorista sale de la memoria del turno.
                if (empleadoId.isBlank() && Turno.activo(this)) {
                    empleadoId = Turno.empleadoId(this)
                    nombre = Turno.nombre(this)
                    tipo = Turno.tipo(this)
                }
                startForeground(NOTIF_ID, buildNotif(nombre))
                if (empleadoId.isBlank()) {
                    // Sin motorista no hay nada que reportar: no quedarse prendido.
                    stopSelf()
                    return START_NOT_STICKY
                }
                Turno.iniciar(this, empleadoId, nombre, tipo)
                Vigilante.programar(this)
                Avisos.gpsOk(this)
                tomarWakeLock()
                arrancarLocationUpdates()
                arrancarHeartbeat()
                escucharCambiosDeUbicacion()
                reportarEstado()
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

        val texto = estadoTexto()
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("🛵 Freakie GPS · $VERSION_APK")
            .setContentText(texto)
            // BigTextStyle: el motivo del fallo suele ser largo y se cortaría
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build()
    }

    /**
     * Línea de diagnóstico que se ve en la notificación. Permite saber, sin
     * conectarse a la base ni al logcat, si el loop está corriendo y si los
     * envíos llegan bien: cuántos ciclos van, cuántos OK, cuántos fallaron.
     */
    private fun estadoTexto(): String {
        if (ciclos == 0 && ultimoError.isEmpty()) return "Iniciando…"
        val hace = (System.currentTimeMillis() - ultimoOkMs) / 1000
        val cuando = if (ultimoOkMs == 0L) "sin OK" else "OK hace ${hace}s"
        val err = if (ultimoError.isNotEmpty()) " · $ultimoError" else ""
        return "C:$ciclos · $cuando · F:$fallos$err"
    }

    /** Refresca la notificación con el estado actual (sin recrear el canal). */
    private fun refrescarNotif() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, buildNotif(nombre))
        } catch (_: Exception) { /* no es crítico */ }
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
            val nombreEsc = nombre.replace("\\", "\\\\").replace("\"", "\\\"")
            val tipoEsc = tipo.replace("\\", "\\\\").replace("\"", "\\\"")
            val body = """{"p_empleado_id":"$empleadoId","p_nombre":"$nombreEsc",""" +
                """"p_lat":$lat,"p_lng":$lng,""" +
                """"p_rumbo":${if (rumbo.isNaN()) "null" else rumbo},""" +
                """"p_exactitud":${if (precision.isNaN()) "null" else precision},""" +
                """"p_tipo":"$tipoEsc"}"""

            // Primero por el proxy (el camino que funciona en producción); si el
            // proxy está caído probamos el origen directo antes de darlo por perdido.
            var ok = postRpc("$PROXY_URL/rest/v1/rpc/actualizar_ubicacion_driver", body, "prx")
            if (!ok) ok = postRpc("$SUPABASE_URL/rest/v1/rpc/actualizar_ubicacion_driver", body, "dir")

            if (ok) ultimoOkMs = System.currentTimeMillis() else {
                fallos++
                // v12: sin internet el punto no se pierde; se guarda y se manda
                // en cuanto vuelva la conexión (vaciarCola).
                Turno.encolar(this, lat, lng, rumbo, precision)
            }
            // Reflejar el resultado en la notificación (desde el hilo principal)
            handler.post { refrescarNotif() }
        }
    }

    /** Un POST al RPC. Devuelve true si el servidor respondió 2xx. */
    private fun postRpc(endpoint: String, body: String, etiqueta: String): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            val bytes = body.toByteArray(Charsets.UTF_8)
            conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("apikey", ANON_KEY)
                setRequestProperty("Authorization", "Bearer $ANON_KEY")
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                // Sin esto PostgREST devuelve la fila y gasta datos de más
                setRequestProperty("Prefer", "return=minimal")
                instanceFollowRedirects = true
                doOutput = true
                connectTimeout = 10000
                readTimeout = 10000
                setFixedLengthStreamingMode(bytes.size)
            }
            conn.outputStream.use { it.write(bytes) }
            val code = conn.responseCode
            if (code in 200..299) {
                ultimoError = ""
                true
            } else {
                // Leer el cuerpo del error: PostgREST explica el motivo ahí
                val detalle = try {
                    conn.errorStream?.bufferedReader()?.use { it.readText() }?.take(60) ?: ""
                } catch (_: Exception) { "" }
                ultimoError = "$etiqueta $code ${detalle.replace("\n", " ")}".trim()
                Log.w(TAG, "HTTP $code en $endpoint · $detalle")
                false
            }
        } catch (e: Exception) {
            ultimoError = "$etiqueta ${e.javaClass.simpleName}: ${(e.message ?: "").take(50)}"
            Log.w(TAG, "Falló POST a $endpoint: ${e.message}")
            false
        } finally {
            try { conn?.disconnect() } catch (_: Exception) { }
        }
    }

    /**
     * Pregunta al servidor si el motorista tiene pedidos listos para retirar.
     * El servidor decide (driver_alarma_estado): suena cuando están listos TODOS
     * sus pedidos de esa sucursal, o cuando el primero lleva 8 min esperando.
     */
    private fun revisarAlarma() {
        if (empleadoId.isBlank() || tipo != "delivery") return
        thread(name = "alarma-get") {
            val body = """{"p_empleado_id":"$empleadoId"}"""
            val resp = rpcJson("driver_alarma_estado", body) ?: return@thread
            try {
                val js = JSONObject(resp)
                if (js.optBoolean("sonar", false)) {
                    val suc = js.optString("sucursal", "tu sucursal")
                    val n = js.optInt("listos", 1)
                    val min = js.optInt("min_espera", 0)
                    val arr = js.optJSONArray("pedidos")
                    val ordenes = (0 until (arr?.length() ?: 0)).joinToString(", ") {
                        arr!!.getJSONObject(it).optString("numero_orden")
                    }
                    handler.post { iniciarAlarma(suc, n, min, ordenes) }
                } else {
                    handler.post { detenerAlarma() }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Respuesta de alarma inválida: ${e.message}")
            }
        }
    }

    private fun iniciarAlarma(sucursal: String, listos: Int, minEspera: Int, ordenes: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(ALARMA_CHANNEL_ID, "Pedido listo para retirar",
                NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Suena cuando tus pedidos están listos en la sucursal"
                setSound(null, null)          // el sonido lo ponemos nosotros (stream de alarma)
                enableVibration(false)        // idem: vibramos a mano junto con el sonido
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            nm.createNotificationChannel(ch)
        }
        val abrir = PendingIntent.getActivity(this, 2,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val recogerIntent = Intent(this, LocationService::class.java).apply {
            action = ACTION_RECOGER
            putExtra(EXTRA_EMPLEADO_ID, empleadoId)
        }
        val recoger = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            PendingIntent.getForegroundService(this, 3, recogerIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        else
            PendingIntent.getService(this, 3, recogerIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val titulo = if (listos > 1) "Tus $listos pedidos están listos" else "Tu pedido está listo"
        val texto = "$sucursal · $ordenes. Pasá a retirarlos ya." +
            (if (minEspera > 0) " Esperando hace $minEspera min." else "")
        val notif = NotificationCompat.Builder(this, ALARMA_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("🔔 $titulo")
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(abrir)
            .setFullScreenIntent(abrir, true)
            .addAction(android.R.drawable.ic_menu_send, "Ya los retiré", recoger)
            .build()
        // Se vuelve a publicar en cada revisión (20 s): si el motorista la
        // desliza para quitarla, reaparece mientras los pedidos sigan listos.
        try { nm.notify(ALARMA_NOTIF_ID, notif) } catch (_: Exception) { }

        if (!alarmaSonando) {
            alarmaSonando = true
            handler.post(sonidoRunnable)
        }
    }

    private fun detenerAlarma() {
        if (!alarmaSonando) {
            // Igual limpiamos por si quedó una notificación de antes
            try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ALARMA_NOTIF_ID) } catch (_: Exception) { }
            return
        }
        alarmaSonando = false
        handler.removeCallbacks(sonidoRunnable)
        try { player?.release() } catch (_: Exception) { }
        player = null
        try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ALARMA_NOTIF_ID) } catch (_: Exception) { }
    }

    /** Campana (opción A elegida por Cesar) por el stream de alarma + vibración. */
    private fun sonarUnaVez() {
        try {
            player?.release()
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build())
                setDataSource(this@LocationService, Uri.parse("android.resource://$packageName/${R.raw.campana_pedido}"))
                setOnCompletionListener { it.release(); if (player === it) player = null }
                prepare()
                start()
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo reproducir la alarma: ${e.message}")
        }
        try {
            val patron = longArrayOf(0, 400, 200, 400, 200, 700)
            vibrar(patron)
        } catch (_: Exception) { }
    }

    @Suppress("DEPRECATION")
    private fun vibrar(patron: LongArray) {
        val vib: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vib.vibrate(VibrationEffect.createWaveform(patron, -1))
        } else {
            vib.vibrate(patron, -1)
        }
    }

    /** «Ya los retiré»: marca en camino todos sus pedidos listos y apaga la alarma. */
    private fun recogerListos() {
        handler.post { detenerAlarma() }
        if (empleadoId.isBlank()) return
        thread(name = "alarma-recoger") {
            rpcJson("driver_recoger_listos", """{"p_empleado_id":"$empleadoId"}""")
        }
    }

    /** POST a un RPC devolviendo el cuerpo (proxy primero, origen después). */
    private fun rpcJson(fn: String, body: String): String? {
        for (base in listOf(PROXY_URL, SUPABASE_URL)) {
            var conn: HttpURLConnection? = null
            try {
                val bytes = body.toByteArray(Charsets.UTF_8)
                conn = (URL("$base/rest/v1/rpc/$fn").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("apikey", ANON_KEY)
                    setRequestProperty("Authorization", "Bearer $ANON_KEY")
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Accept", "application/json")
                    doOutput = true
                    connectTimeout = 10000
                    readTimeout = 10000
                    setFixedLengthStreamingMode(bytes.size)
                }
                conn.outputStream.use { it.write(bytes) }
                if (conn.responseCode in 200..299) {
                    return conn.inputStream.bufferedReader().use { it.readText() }
                }
            } catch (e: Exception) {
                Log.w(TAG, "RPC $fn falló en $base: ${e.message}")
            } finally {
                try { conn?.disconnect() } catch (_: Exception) { }
            }
        }
        return null
    }

    // ── v12: ubicación apagada, permisos, estado y cola ────────────────

    private var receptorUbicacion: android.content.BroadcastReceiver? = null
    private var vaciando = false

    /** Reacciona en el momento en que el motorista apaga o prende la ubicación. */
    private fun escucharCambiosDeUbicacion() {
        if (receptorUbicacion != null) return
        receptorUbicacion = object : android.content.BroadcastReceiver() {
            override fun onReceive(c: Context?, i: Intent?) {
                revisarUbicacionYPermiso()
                reportarEstado()
            }
        }
        try {
            val f = android.content.IntentFilter(android.location.LocationManager.PROVIDERS_CHANGED_ACTION)
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(receptorUbicacion, f, Context.RECEIVER_NOT_EXPORTED)
            else registerReceiver(receptorUbicacion, f)
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo escuchar cambios de ubicación: ${e.message}")
        }
    }

    private fun ubicacionPrendida(): Boolean = try {
        val lm = getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lm.isLocationEnabled
        else lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) ||
             lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)
    } catch (_: Exception) { true }

    private fun permisoSiempre(): Boolean {
        val fino = androidx.core.content.ContextCompat.checkSelfPermission(this,
            android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!fino) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return androidx.core.content.ContextCompat.checkSelfPermission(this,
            android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private fun bateriaSinRestriccion(): Boolean = try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) true
        else (getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
    } catch (_: Exception) { false }

    private fun bateriaPct(): Int = try {
        (getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager)
            .getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
    } catch (_: Exception) { -1 }

    private fun revisarUbicacionYPermiso() {
        if (ubicacionPrendida()) Avisos.ubicacionOk(this) else Avisos.ubicacionApagada(this)
        if (permisoSiempre()) Avisos.permisoOk(this) else Avisos.permisoFaltante(this)
    }

    /** Le cuenta a la torre cómo está la app: versión, ubicación, permiso, batería. */
    private fun reportarEstado() {
        if (empleadoId.isBlank()) return
        val gps = ubicacionPrendida(); val perm = permisoSiempre(); val bat = bateriaSinRestriccion()
        val pct = bateriaPct(); val pend = Turno.pendientes(this)
        thread(name = "gps-estado") {
            val body = """{"p_empleado_id":"$empleadoId","p_version":"$VERSION_APK",""" +
                """"p_gps_activo":$gps,"p_permiso_siempre":$perm,"p_bateria_sin_restriccion":$bat,""" +
                """"p_bateria_pct":${if (pct >= 0) pct else "null"},"p_pendientes":$pend}"""
            rpcJson("driver_reportar_estado", body)
        }
    }

    /** Manda los puntos que quedaron guardados sin internet, en tandas. */
    private fun vaciarCola() {
        if (vaciando || empleadoId.isBlank() || Turno.pendientes(this) == 0) return
        vaciando = true
        thread(name = "gps-cola") {
            try {
                var vueltas = 0
                while (Turno.pendientes(this) > 0 && vueltas < 10) {
                    vueltas++
                    val lote = Turno.verLote(this, LOTE_COLA)
                    if (lote.length() == 0) break
                    val body = """{"p_empleado_id":"$empleadoId","p_puntos":$lote}"""
                    if (rpcJson("driver_puntos_lote", body) == null) break   // sigue sin internet
                    Turno.descartar(this, lote.length())
                }
            } finally {
                vaciando = false
            }
        }
    }

    override fun onDestroy() {
        try { receptorUbicacion?.let { unregisterReceiver(it) } } catch (_: Exception) { }
        receptorUbicacion = null
        // Si el turno sigue activo y Android nos mató, el vigilante nos revive.
        if (Turno.activo(this)) Vigilante.programarAlarma(this)
        detenerAlarma()
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
        // No llamamos super: el service continúa aunque el usuario cierre la app.
        // Por si la marca del teléfono igual lo mata, dejamos armado el vigilante.
        if (Turno.activo(this)) Vigilante.programarAlarma(this)
    }
}
