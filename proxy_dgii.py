#!/usr/bin/env python3
"""Proxy DGII - Freakie Dogs ERP"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request, urllib.error, json, ssl, os

PORT = int(os.environ.get("PROXY_PORT", "3000"))
DGII_BASE_TEST = "https://apitest.dfreclutamiento.gob.sv"
DGII_BASE_PROD = "https://api.dfreclutamiento.gob.sv"
PROXY_TOKEN = os.environ.get("DGII_PROXY_TOKEN", "").strip()
if not PROXY_TOKEN:
    print("⚠️  DGII_PROXY_TOKEN no seteado — proxy abierto sin auth")

ALLOWED_PATHS = ["/seguridad/auth", "/fesv/recepciondte", "/fesv/consultadte", "/fesv/anulardte"]

class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[PROXY] {self.address_string()} - {format % args}")

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_POST(self):
        if PROXY_TOKEN and self.headers.get("X-Proxy-Token", "") != PROXY_TOKEN:
            print(f"[PROXY] ✗ Token inválido"); self.send_response(401); self._cors(); self.end_headers()
            self.wfile.write(json.dumps({"error":"unauthorized"}).encode()); return
        path = self.path
        if not any(path.startswith(p) for p in ALLOWED_PATHS):
            self.send_response(404); self._cors(); self.end_headers()
            self.wfile.write(json.dumps({"error":f"Path no permitido: {path}"}).encode()); return
        env = self.headers.get("X-DGII-Env", "test")
        base = DGII_BASE_PROD if env == "production" else DGII_BASE_TEST
        target_url = base + path
        cl = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(cl) if cl > 0 else b""
        h = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        if "Authorization" in self.headers:
            h["Authorization"] = self.headers["Authorization"]
        print(f"[PROXY] → {target_url}")
        try:
            req = urllib.request.Request(target_url, data=body, headers=h, method="POST")
            ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                rb, rs, rct = resp.read(), resp.status, resp.headers.get("Content-Type", "application/json")
            print(f"[PROXY] ← HTTP {rs}")
            self.send_response(rs); self.send_header("Content-Type", rct); self._cors(); self.end_headers(); self.wfile.write(rb)
        except urllib.error.HTTPError as e:
            eb = e.read(); print(f"[PROXY] ← HTTP {e.code}: {eb[:200]}")
            self.send_response(e.code); self.send_header("Content-Type", "application/json"); self._cors(); self.end_headers(); self.wfile.write(eb)
        except Exception as e:
            print(f"[PROXY] ← Error: {e}")
            self.send_response(502); self.send_header("Content-Type", "application/json"); self._cors(); self.end_headers()
            self.wfile.write(json.dumps({"error":"proxy_error","detail":str(e),"target":target_url}).encode())

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DGII-Env, X-Proxy-Token")

if __name__ == "__main__":
    print(f"╔═══ Proxy DGII v1.0 — puerto {PORT} ═══╗")
    HTTPServer(("0.0.0.0", PORT), ProxyHandler).serve_forever()
