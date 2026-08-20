package com.freakiedogs.driver

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Freakie Drivers — WebView que carga la PWA del motorista + bridge JS que expone
 * el servicio nativo de GPS en background. La UI 100% viene de la web; Kotlin
 * solo maneja el GPS real de Android.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    companion object {
        private const val REQ_PERMS = 2001
        // URL de producción del driver PWA
        private const val DRIVER_URL = "https://freakie-dogs-caja.vercel.app/driver"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Permitir geolocalización HTML5 (fallback al watchPosition de la PWA
            // si el bridge nativo no está disponible).
            setGeolocationEnabled(true)
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        web.webViewClient = WebViewClient()

        // Delegar la petición de permiso de ubicación desde el WebView al sistema
        web.webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?, callback: android.webkit.GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }
        }

        web.addJavascriptInterface(Bridge(), "AndroidPrinter")
        web.clearCache(true)
        web.loadUrl(DRIVER_URL)

        // Pedir permisos GPS + notificaciones al arrancar (antes de que el JS los necesite)
        pedirPermisos()
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun pedirPermisos() {
        val perms = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.ACCESS_FINE_LOCATION)
            perms.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (perms.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, perms.toTypedArray(), REQ_PERMS)
        }
    }

    /**
     * Bridge JS ↔ Kotlin — la PWA llama window.AndroidPrinter.startLocation()
     * y aquí decidimos si arrancar el Foreground Service nativo.
     */
    inner class Bridge {

        /** El código JS de DriverBeacon.jsx chequea esto para saber si está corriendo dentro del APK. */
        @JavascriptInterface
        fun hasLocationNative(): Boolean = true

        /**
         * Arranca el Foreground Service que reporta GPS a Supabase cada 15s hasta stopLocation().
         * Sobrevive: app cerrada, pantalla bloqueada, Waze abierto, modo ahorro batería.
         */
        @JavascriptInterface
        fun startLocation(empleadoId: String, nombre: String, tipo: String) {
            // Antes de arrancar el service, pedir excepción de Doze mode. Sin esto
            // Android duerme el service después de ~5min con el celular quieto,
            // aunque el usuario haya desactivado "Optimización de batería" manual.
            pedirExcepcionDoze()

            val intent = Intent(this@MainActivity, LocationService::class.java).apply {
                action = LocationService.ACTION_START
                putExtra(LocationService.EXTRA_EMPLEADO_ID, empleadoId)
                putExtra(LocationService.EXTRA_NOMBRE, nombre)
                putExtra(LocationService.EXTRA_TIPO, tipo)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        }

        /**
         * Si Android no nos considera "unrestricted" en batería, abrir la pantalla
         * del sistema donde el usuario acepta con un solo tap. Solo pide una vez —
         * si ya está concedido, no molesta.
         */
        private fun pedirExcepcionDoze() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) return
            try {
                val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                startActivity(i)
            } catch (_: Exception) {
                // Algunos OEMs bloquean este intent — fallback silencioso.
            }
        }

        /** Detiene el servicio y remueve la notificación permanente. */
        @JavascriptInterface
        fun stopLocation() {
            val intent = Intent(this@MainActivity, LocationService::class.java).apply {
                action = LocationService.ACTION_STOP
            }
            stopService(intent)
        }

        /** Compatibilidad con el bridge del POS (por si comparten código). */
        @JavascriptInterface
        fun isNativePrinter(): Boolean = false
    }
}
