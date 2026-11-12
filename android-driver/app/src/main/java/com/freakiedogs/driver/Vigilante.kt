package com.freakiedogs.driver

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Vigilante del GPS (v12, 12-nov-2026). Dos guardias independientes revisan
 * que el servicio siga vivo mientras el motorista está de turno; si el último
 * latido tiene más de 90 s, lo reviven con el motorista guardado en Turno.
 *
 *  1. Alarma del sistema cada 3 min (en Doze Android la estira a ~9 min).
 *  2. WorkManager cada 15 min — sobrevive a reinicios y a «limpiar memoria»
 *     de Xiaomi/Huawei/Samsung, que a veces borran las alarmas.
 *
 * Además, BootReceiver arranca el GPS al encender el celular o al actualizar la app.
 */
object Vigilante {
    private const val TAG = "FreakieVigilante"
    private const val CADA_MS = 3 * 60_000L
    private const val LATIDO_VIEJO_MS = 90_000L
    private const val TRABAJO = "freakie_vigilante_gps"
    const val ACTION_REVISAR = "com.freakiedogs.driver.VIGILANTE"

    private fun piAlarma(c: Context): PendingIntent =
        PendingIntent.getBroadcast(c, 77,
            Intent(c, VigilanteReceiver::class.java).apply { action = ACTION_REVISAR },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun programar(c: Context) {
        programarAlarma(c)
        try {
            val req = PeriodicWorkRequestBuilder<VigilanteWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(c).enqueueUniquePeriodicWork(TRABAJO, ExistingPeriodicWorkPolicy.KEEP, req)
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo programar WorkManager: ${e.message}")
        }
    }

    fun programarAlarma(c: Context) {
        try {
            val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val cuando = SystemClock.elapsedRealtime() + CADA_MS
            val exactaPermitida = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
            if (exactaPermitida && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, piAlarma(c))
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, piAlarma(c))
            } else {
                am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, piAlarma(c))
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo programar la alarma: ${e.message}")
        }
    }

    fun cancelar(c: Context) {
        try { (c.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(piAlarma(c)) } catch (_: Exception) { }
        try { WorkManager.getInstance(c).cancelUniqueWork(TRABAJO) } catch (_: Exception) { }
    }

    /** Si hay turno y el servicio no late hace rato, lo revive. */
    fun revisar(c: Context, origen: String) {
        if (!Turno.activo(c)) { cancelar(c); return }
        if (Turno.msDesdeLatido(c) > LATIDO_VIEJO_MS) {
            Log.i(TAG, "Servicio sin latido (${Turno.msDesdeLatido(c) / 1000}s) → revivir desde $origen")
            Turno.arrancarServicio(c, "vigilante-$origen")
        }
    }
}

/** Disparo de la alarma: revisa y vuelve a programarse. */
class VigilanteReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent?) {
        Vigilante.revisar(c, "alarma")
        if (Turno.activo(c)) Vigilante.programarAlarma(c)
    }
}

/** Respaldo de WorkManager cada 15 min. */
class VigilanteWorker(c: Context, p: WorkerParameters) : Worker(c, p) {
    override fun doWork(): Result {
        Vigilante.revisar(applicationContext, "work")
        if (Turno.activo(applicationContext)) Vigilante.programarAlarma(applicationContext)
        return Result.success()
    }
}

/** Celular encendido, app actualizada o reinicio rápido de algunas marcas. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent?) {
        val a = intent?.action ?: return
        if (a == Intent.ACTION_BOOT_COMPLETED || a == Intent.ACTION_MY_PACKAGE_REPLACED ||
            a == "android.intent.action.QUICKBOOT_POWERON" || a == "com.htc.intent.action.QUICKBOOT_POWERON") {
            if (Turno.activo(c)) {
                Turno.arrancarServicio(c, "boot")
                Vigilante.programar(c)
            }
        }
    }
}
