package com.freakiedogs.pos

import android.app.Activity
import android.os.Bundle
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread

class MainActivity : Activity() {

    private lateinit var web: WebView

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
        }
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        web.addJavascriptInterface(Bridge(), "AndroidPrinter")
        // Deploy real del POS. Si algun dia se registra pos.freakiedogs.com
        // (aspiracional en el MAESTRO), se cambia aca y se recompila.
        web.loadUrl("https://freakie-dogs-caja.vercel.app/pos")
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
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
