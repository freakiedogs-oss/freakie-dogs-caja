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

    /**
     * v12: cada vez que el motorista vuelve a la app, si estaba de turno y el GPS
     * no late, se revive. Desde aquí Android SIEMPRE deja arrancar el servicio.
     */
    override fun onResume() {
        super.onResume()
        if (Turno.activo(this) && Turno.msDesdeLatido(this) > 60_000L) {
            Turno.arrancarServicio(this, "app-abierta")
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS) pedirUbicacionSiempre()
    }

    /**
     * v12: «Permitir todo el tiempo». Android 10+ lo separa del permiso normal y
     * desde Android 11 solo se concede en la pantalla de Ajustes. Sin él, la
     * ubicación se corta con la pantalla apagada en muchos teléfonos.
     */
    private fun pedirUbicacionSiempre() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val fino = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val siempre = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!fino || siempre) return
        android.app.AlertDialog.Builder(this)
            .setTitle("Ubicación: «Permitir todo el tiempo»")
            .setMessage("Para que la torre te vea aunque tengás la pantalla apagada o estés en Waze, " +
                "en la siguiente pantalla elegí «Permitir todo el tiempo».")
            .setCancelable(false)
            .setPositiveButton("Entendido") { _, _ ->
                ActivityCompat.requestPermissions(this,
                    arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), REQ_PERMS + 1)
            }
            .show()
    }

    /**
     * Pantallas propias de cada marca donde se activa «Inicio automático» o se
     * quitan las restricciones de batería. Si la marca no tiene, se abren los
     * datos de la app. Devuelve el nombre de lo que abrió.
     */
    private fun abrirInicioAutomaticoMarca(): String {
        val candidatos = listOf(
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",          // Xiaomi / Redmi / POCO
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity", // Huawei
            "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",      // Oppo / Realme
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",     // Vivo
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
            "com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity",                  // Samsung
            "com.transsion.phonemaster" to "com.cyin.himgr.autostart.AutoStartActivity",                         // Tecno / Infinix
            "com.asus.mobilemanager" to "com.asus.mobilemanager.autostart.AutoStartActivity"                     // Asus
        )
        for ((pkg, cls) in candidatos) {
            try {
                startActivity(Intent().apply {
                    component = android.content.ComponentName(pkg, cls)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                return pkg
            } catch (_: Exception) { /* no es esa marca */ }
        }
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        } catch (_: Exception) { }
        return "ajustes-app"
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

        // Waze: abierto como https suele arrancar la app en su pantalla inicial,
        // sin tomar el destino. Con su propio esquema sí arranca la navegación.
        //
        // CLEAR_TOP es lo que hace que funcione en el segundo pedido: si Waze ya
        // quedó abierto de la entrega anterior, sin este flag Android solo lo trae
        // al frente y el destino nuevo se pierde — el motorista veía Waze abierto
        // pero sin ruta.
        if (url.contains("waze.com/ul", ignoreCase = true)) {
            val query = url.substringAfter('?', "")
            if (query.isNotEmpty()) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("waze://?$query")).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or
                                 Intent.FLAG_ACTIVITY_CLEAR_TOP or
                                 Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    })
                    return true
                } catch (_: ActivityNotFoundException) {
                    // Sin Waze instalado: que el sistema abra la web o la Play Store
                }
            }
            return abrirExterno(url, reenviar = true)
        }

        // Direcciones web que en realidad son puentes a una app instalada.
        // Mandarlas al sistema evita el redirect interno que rompe el WebView.
        // Los mapas se reenvían con CLEAR_TOP por el mismo motivo que Waze:
        // si la app quedó abierta del pedido anterior, hay que forzar el destino nuevo.
        if (forzarExterno || esPuenteDeApp(url)) return abrirExterno(url, reenviar = esMapa(url))

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

    /** Apps de navegación: hay que reenviarles el destino aunque ya estén abiertas. */
    private fun esMapa(url: String): Boolean {
        val u = url.lowercase()
        return u.contains("waze.com/") || u.contains("google.com/maps") ||
               u.contains("maps.google.") || u.contains("maps.app.goo.gl") ||
               u.contains("goo.gl/maps")
    }

    private fun abrirExterno(url: String, reenviar: Boolean = false): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (reenviar) {
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                }
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
        } else {
            pedirUbicacionSiempre()
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
            // v12: stopService() NO pasa por onStartCommand, así que el fin de turno
            // se marca acá; si no, el vigilante volvería a prender el GPS solo.
            Turno.terminar(this@MainActivity)
            Vigilante.cancelar(this@MainActivity)
            Avisos.gpsOk(this@MainActivity); Avisos.ubicacionOk(this@MainActivity); Avisos.permisoOk(this@MainActivity)
            val intent = Intent(this@MainActivity, LocationService::class.java).apply {
                action = LocationService.ACTION_STOP
            }
            stopService(intent)
        }

        /**
         * v12: estado del GPS para que la app web muestre la franja roja.
         * {"turno":bool,"gps":bool,"siempre":bool,"bateria":bool,"latido_s":n,"pendientes":n,"version":"…"}
         */
        @JavascriptInterface
        fun estadoGps(): String {
            val c = this@MainActivity
            val lm = getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
            val gps = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lm.isLocationEnabled
                else lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
            } catch (_: Exception) { true }
            val fino = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val siempre = fino && (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED)
            val bateria = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                (getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
            return org.json.JSONObject().apply {
                put("turno", Turno.activo(c))
                put("gps", gps); put("siempre", siempre); put("bateria", bateria)
                put("latido_s", Turno.msDesdeLatido(c) / 1000)
                put("pendientes", Turno.pendientes(c))
                put("version", LocationService.VERSION_APK)
            }.toString()
        }

        @JavascriptInterface
        fun abrirAjustesUbicacion() {
            try { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
        }

        @JavascriptInterface
        fun pedirPermisoSiempre() { runOnUiThread { pedirUbicacionSiempre() } }

        @JavascriptInterface
        fun abrirInicioAutomatico(): String = abrirInicioAutomaticoMarca()

        @JavascriptInterface
        fun pedirBateriaSinRestriccion() { runOnUiThread { pedirExcepcionDoze() } }

        /** Compatibilidad con el bridge del POS (por si comparten código). */
        @JavascriptInterface
        fun isNativePrinter(): Boolean = false
    }
}
