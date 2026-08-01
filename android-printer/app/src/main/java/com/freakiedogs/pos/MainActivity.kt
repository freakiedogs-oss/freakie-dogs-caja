package com.freakiedogs.pos

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread

class MainActivity : Activity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private val REQ_FILE = 1001

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
            // Siempre revalidar contra el servidor: el POS es web viva y se actualiza seguido.
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }
        web.webViewClient = WebViewClient()
        // Maneja el <input type=file> del POS (foto de egresos): ofrece cámara + galería.
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                cameraUri = null
                val extra = ArrayList<Intent>()
                try {
                    val photo = File.createTempFile("egreso_", ".jpg", cacheDir)
                    cameraUri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", photo)
                    val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                    cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                    cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    extra.add(cam)
                } catch (e: Exception) { cameraUri = null }
                val content = Intent(Intent.ACTION_GET_CONTENT)
                content.type = "image/*"
                content.addCategory(Intent.CATEGORY_OPENABLE)
                val chooser = Intent(Intent.ACTION_CHOOSER)
                chooser.putExtra(Intent.EXTRA_INTENT, content)
                chooser.putExtra(Intent.EXTRA_TITLE, "Foto del egreso")
                if (extra.isNotEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toTypedArray())
                return try {
                    startActivityForResult(chooser, REQ_FILE); true
                } catch (e: Exception) {
                    fileCallback = null; false
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "AndroidPrinter")
        // Borra la caché HTTP del WebView en cada arranque para que SIEMPRE cargue la
        // versión más nueva del POS (evita quedarse pegado en un bundle viejo).
        web.clearCache(true)
        // Deploy real del POS. Si algun dia se registra pos.freakiedogs.com
        // (aspiracional en el MAESTRO), se cambia aca y se recompila.
        web.loadUrl("https://freakie-dogs-caja.vercel.app/pos")
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_FILE) return
        val cb = fileCallback ?: return
        var results: Array<Uri>? = null
        if (resultCode == Activity.RESULT_OK) {
            val picked = data?.data
            results = when {
                picked != null -> arrayOf(picked)
                cameraUri != null -> arrayOf(cameraUri!!)
                else -> null
            }
        }
        cb.onReceiveValue(results)
        fileCallback = null
    }

    inner class Bridge {
        /** El POS llama: AndroidPrinter.printRaw("192.168.1.130", 9100, base64EscPos) */
        @JavascriptInterface
        fun printRaw(ip: String, port: Int, base64Data: String): Boolean {
            return try {
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                thread {
                    try {
                        Socket().use { s ->
                            s.connect(InetSocketAddress(ip, port), 4000)
                            val out = s.getOutputStream()
                            out.write(bytes)
                            out.flush()
                        }
                        report(true, "")
                    } catch (e: Exception) {
                        report(false, e.message ?: "error socket")
                    }
                }
                true
            } catch (e: Exception) {
                false
            }
        }

        /** El POS chequea esto para saber que corre dentro de la app nativa. */
        @JavascriptInterface
        fun isNativePrinter(): Boolean = true
    }

    private fun report(ok: Boolean, err: String) {
        val safe = err.replace("\\", " ").replace("\"", "'")
        runOnUiThread {
            web.evaluateJavascript(
                "window.__printResult && window.__printResult($ok, \"$safe\")",
                null
            )
        }
    }
}
