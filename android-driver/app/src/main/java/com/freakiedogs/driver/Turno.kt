package com.freakiedogs.driver

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Memoria del turno (v12, 12-nov-2026).
 *
 * Antes, si Android mataba el servicio y lo revivía solo (START_STICKY), el
 * servicio volvía SIN saber qué motorista era → no mandaba nada. Ahora el turno
 * queda guardado en el teléfono: cualquier reinicio (Android, el vigilante, el
 * encendido del celular, una actualización de la app) retoma el GPS del mismo
 * motorista hasta que él toque «Detener GPS».
 */
object Turno {
    private const val TAG = "FreakieTurno"
    private const val PREFS = "freakie_turno"
    private const val K_ACTIVO = "activo"
    private const val K_EMP = "empleado_id"
    private const val K_NOMBRE = "nombre"
    private const val K_TIPO = "tipo"
    private const val K_LATIDO = "ultimo_latido_ms"
    private const val K_COLA = "cola_puntos"
    private const val MAX_COLA = 2000          // ~8 h de puntos cada 15 s

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun iniciar(c: Context, empleadoId: String, nombre: String, tipo: String) {
        prefs(c).edit()
            .putBoolean(K_ACTIVO, true)
            .putString(K_EMP, empleadoId)
            .putString(K_NOMBRE, nombre)
            .putString(K_TIPO, tipo)
            .putLong(K_LATIDO, System.currentTimeMillis())
            .apply()
    }

    fun terminar(c: Context) {
        prefs(c).edit().putBoolean(K_ACTIVO, false).apply()
    }

    fun activo(c: Context) = prefs(c).getBoolean(K_ACTIVO, false) && empleadoId(c).isNotBlank()
    fun empleadoId(c: Context) = prefs(c).getString(K_EMP, "") ?: ""
    fun nombre(c: Context) = prefs(c).getString(K_NOMBRE, "") ?: ""
    fun tipo(c: Context) = prefs(c).getString(K_TIPO, "delivery") ?: "delivery"

    /** El servicio deja su «latido» en cada ciclo; el vigilante lo revisa. */
    fun latido(c: Context) = prefs(c).edit().putLong(K_LATIDO, System.currentTimeMillis()).apply()
    fun msDesdeLatido(c: Context) = System.currentTimeMillis() - prefs(c).getLong(K_LATIDO, 0L)

    // ── Cola de puntos sin enviar (sin internet / servidor caído) ──────────
    @Synchronized
    fun encolar(c: Context, lat: Double, lng: Double, rumbo: Float, exactitud: Float) {
        try {
            val arr = JSONArray(prefs(c).getString(K_COLA, "[]"))
            arr.put(JSONObject().apply {
                put("lat", lat); put("lng", lng); put("ts", System.currentTimeMillis())
                if (!rumbo.isNaN()) put("rumbo", rumbo.toDouble())
                if (!exactitud.isNaN()) put("exactitud", exactitud.toDouble())
            })
            // Si la cola se llena, se descartan los más viejos
            val recortada = if (arr.length() > MAX_COLA) {
                JSONArray().also { n -> for (i in arr.length() - MAX_COLA until arr.length()) n.put(arr.get(i)) }
            } else arr
            prefs(c).edit().putString(K_COLA, recortada.toString()).apply()
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo encolar punto: ${e.message}")
        }
    }

    @Synchronized
    fun pendientes(c: Context): Int = try { JSONArray(prefs(c).getString(K_COLA, "[]")).length() } catch (_: Exception) { 0 }

    /** Saca hasta `max` puntos (los más viejos primero) sin borrarlos todavía. */
    @Synchronized
    fun verLote(c: Context, max: Int): JSONArray {
        val arr = try { JSONArray(prefs(c).getString(K_COLA, "[]")) } catch (_: Exception) { JSONArray() }
        val lote = JSONArray()
        for (i in 0 until minOf(max, arr.length())) lote.put(arr.get(i))
        return lote
    }

    /** Borra los primeros `n` puntos (ya confirmados por el servidor). */
    @Synchronized
    fun descartar(c: Context, n: Int) {
        val arr = try { JSONArray(prefs(c).getString(K_COLA, "[]")) } catch (_: Exception) { JSONArray() }
        val resto = JSONArray()
        for (i in n until arr.length()) resto.put(arr.get(i))
        prefs(c).edit().putString(K_COLA, resto.toString()).apply()
    }

    /** Arranca (o revive) el servicio con el motorista guardado. */
    fun arrancarServicio(c: Context, motivo: String): Boolean {
        if (!activo(c)) return false
        val i = Intent(c, LocationService::class.java).apply {
            action = LocationService.ACTION_START
            putExtra(LocationService.EXTRA_EMPLEADO_ID, empleadoId(c))
            putExtra(LocationService.EXTRA_NOMBRE, nombre(c))
            putExtra(LocationService.EXTRA_TIPO, tipo(c))
            putExtra(LocationService.EXTRA_MOTIVO, motivo)
        }
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i) else c.startService(i)
            true
        } catch (e: Exception) {
            // Android 12+ puede negar el arranque desde segundo plano. En ese caso
            // se avisa al motorista con una notificación para que toque y lo reviva.
            Log.w(TAG, "No se pudo arrancar el servicio ($motivo): ${e.message}")
            Avisos.gpsDetenido(c)
            false
        }
    }
}
