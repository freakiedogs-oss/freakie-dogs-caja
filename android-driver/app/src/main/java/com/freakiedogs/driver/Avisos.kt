package com.freakiedogs.driver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat

/**
 * Avisos al motorista cuando el GPS no puede funcionar (v12, 12-nov-2026).
 * Canal de prioridad alta, aparte del canal silencioso del servicio: estos
 * avisos SÍ suenan, porque si la ubicación está apagada la torre no lo ve.
 */
object Avisos {
    private const val CANAL = "freakie_gps_problema_v1"
    private const val ID_UBICACION = 44
    private const val ID_DETENIDO = 45
    private const val ID_PERMISO = 46

    private fun nm(c: Context) = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun canal(c: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CANAL, "Problemas con el GPS", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Avisa si la ubicación está apagada o el GPS se detuvo"
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            nm(c).createNotificationChannel(ch)
        }
    }

    private fun publicar(c: Context, id: Int, titulo: String, texto: String, abrir: Intent) {
        canal(c)
        val pi = PendingIntent.getActivity(c, id, abrir.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pi)
            .build()
        try { nm(c).notify(id, n) } catch (_: Exception) { }
    }

    /** La ubicación del teléfono está apagada (el ícono de GPS en la barra). */
    fun ubicacionApagada(c: Context) = publicar(c, ID_UBICACION,
        "📍 Tu ubicación está apagada",
        "La torre no sabe dónde estás y no te pueden asignar pedidos. Tocá aquí y activá la ubicación.",
        Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))

    fun ubicacionOk(c: Context) { try { nm(c).cancel(ID_UBICACION) } catch (_: Exception) { } }

    /** Le quitaron el permiso «Permitir todo el tiempo». */
    fun permisoFaltante(c: Context) = publicar(c, ID_PERMISO,
        "📍 Falta el permiso de ubicación",
        "Tocá aquí → Permisos → Ubicación → «Permitir todo el tiempo». Sin eso el GPS se corta con la pantalla apagada.",
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = android.net.Uri.parse("package:${c.packageName}")
        })

    fun permisoOk(c: Context) { try { nm(c).cancel(ID_PERMISO) } catch (_: Exception) { } }

    /** El servicio murió y Android no deja revivirlo solo: que el motorista toque. */
    fun gpsDetenido(c: Context) = publicar(c, ID_DETENIDO,
        "🛵 Tu GPS se detuvo",
        "Tocá aquí para reactivarlo. Mientras esté detenido, la torre no te ve.",
        Intent(c, MainActivity::class.java))

    fun gpsOk(c: Context) { try { nm(c).cancel(ID_DETENIDO) } catch (_: Exception) { } }
}
