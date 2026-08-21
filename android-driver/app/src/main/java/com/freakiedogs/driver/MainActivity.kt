package com.freakiedogs.driver

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
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
            // Los botones de WhatsApp/Waze/Maps usan target="_blank". Sin esto
            // el WebView los ignora en silencio y al motorista no le pasa nada.
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return manejarUrl(url)
            }

            @Suppress("DEPRECATION", "OverridingDeprecatedMember")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return url != null && manejarUrl(url)
            }
        }

        web.webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?, callback: android.webkit.GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            /**
             * Un link con target="_blank" pide una ventana nueva. En vez de abrirla,
             * capturamos la dirección con un WebView descartable y la mandamos al
             * sistema — que es lo que el motorista espera (que abra Waze o WhatsApp).
             */
            override fun onCreateWindow(
                view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?
            ): Boolean {
                val temporal = WebView(this@MainActivity)
                temporal.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView?, req: WebResourceRequest?): Boolean {
                        req?.url?.toString()?.let { manejarUrl(it, forzarExterno = true) }
                        temporal.destroy()
                        return true
                    }

                    @Suppress("DEPRECATION", "OverridingDeprecatedMember")
                    override fun shouldOverrideUrlLoading(v: WebView?, u: String?): Boolean {
                        u?.let { manejarUrl(it, forzarExterno = true) }
                        temporal.destroy()
                        return true
                    }
                }
                (resultMsg?.obj as? WebView.WebViewTransport)?.webView = temporal
                resultMsg?.sendToTarget()
                return true
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

    /**
     * Decide si una dirección la carga el WebView o la abre una app del teléfono.
     *
     * El WebView solo entiende http/https. Los botones del driver (WhatsApp, Waze,
     * Maps, llamar) terminan pidiendo direcciones tipo `whatsapp://`, `intent://`
     * o `tel:` — y ahí el WebView muestra ERR_UNKNOWN_URL_SCHEME y el motorista
     * queda sin poder navegar ni llamar al cliente.
     *
     * @return true si nos hicimos cargo nosotros (el WebView no debe cargarla)
     */
    private fun manejarUrl(url: String, forzarExterno: Boolean = false): Boolean {
        val esHttp = url.startsWith("http://") || url.startsWith("https://")

        // Direcciones de app (intent://): traen adentro qué app abrir y, si no
        // está instalada, a dónde mandar al usuario.
        if (url.startsWith("intent://")) {
            try {
                val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    startActivity(intent)
                    return true
                } catch (_: ActivityNotFoundException) {
                    intent.getStringExtra("browser_fallback_url")?.let { return abrirExterno(it) }
                    intent.`package`?.let {
                        return abrirExterno("https://play.google.com/store/apps/details?id=$it")
                    }
                    avisar("No tenés instalada la app para abrir esto")
                }
            } catch (e: Exception) {
                Log.w("FreakieWeb", "intent:// mal formado: ${e.message}")
                avisar("No se pudo abrir el enlace")
            }
            return true
        }

        // Cualquier esquema que no sea web (whatsapp:, tel:, geo:, waze:, mailto:, sms:)
        if (!esHttp) return abrirExterno(url)

        // Direcciones web que en realidad son puentes a una app instalada.
        // Mandarlas al sistema evita el redirect interno que rompe el WebView.
        if (forzarExterno || esPuenteDeApp(url)) return abrirExterno(url)

        // El resto (la propia PWA) lo sigue cargando el WebView
        return false
    }

    /** Dominios que existen solo para saltar a una app nativa. */
    private fun esPuenteDeApp(url: String): Boolean {
        val u = url.lowercase()
        return u.contains("wa.me/") ||
               u.contains("api.whatsapp.com") ||
               u.contains("web.whatsapp.com") ||
               u.contains("waze.com/") ||
               u.contains("google.com/maps") ||
               u.contains("maps.google.") ||
               u.contains("maps.app.goo.gl") ||
               u.contains("goo.gl/maps")
    }

    private fun abrirExterno(url: String): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (_: ActivityNotFoundException) {
            avisar("No tenés instalada la app para abrir esto")
            true
        } catch (e: Exception) {
            Log.w("FreakieWeb", "No se pudo abrir $url: ${e.message}")
            avisar("No se pudo abrir el enlace")
            true
        }
    }

    private fun avisar(texto: String) {
        Toast.makeText(this, texto, Toast.LENGTH_LONG).show()
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
