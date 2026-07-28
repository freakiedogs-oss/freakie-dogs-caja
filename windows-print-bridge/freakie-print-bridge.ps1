# Freakie POS - Puente de impresion HTTP -> TCP 9100
# Escucha en http://127.0.0.1:9110/ (loopback, NO requiere administrador) y
# reenvia los bytes ESC/POS que le manda el POS (web) a la impresora de red.
# No instala nada: usa .NET que ya viene en Windows.
# Puede correr oculto (via watchdog/.vbs) o visible (via el .bat). Registra
# actividad en 'puente-log.txt' en su misma carpeta.
#
# Blindado (28-Jul-2026):
#  - Si el puerto 9110 ya esta ocupado por un puente SANO, sale en silencio (no
#    arranca un segundo ni tira el error rojo). Si es un zombie, lo reporta y
#    sale para que el watchdog lo limpie. Ya NO se queda colgado en Read-Host.
#  - Responde GET /health (200) para que el watchdog sepa si esta vivo.
#  - Un error en una peticion (o un timeout de impresora) NUNCA mata el loop:
#    cada iteracion, incluido AcceptTcpClient, esta protegida.

$port = 9110
$logFile = Join-Path $PSScriptRoot 'puente-log.txt'

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $line
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

function Test-PuenteSano {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 2 -UseBasicParsing
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

$addr = [System.Net.IPAddress]::Loopback
$server = New-Object System.Net.Sockets.TcpListener($addr, $port)
try {
  $server.Start()
} catch {
  # Puerto ocupado: casi seguro ya hay un puente corriendo.
  if (Test-PuenteSano) {
    Log ("Ya hay un puente ACTIVO y sano en {0} - no arranco otro." -f $port)
    exit 0
  }
  Log ("No se pudo abrir el puerto {0} y el que lo ocupa NO responde (zombie): {1}" -f $port, $_.Exception.Message)
  Log "El watchdog lo limpiara, o corre 'Reiniciar-Puente.bat'."
  exit 1
}

Log "================================================"
Log "  Freakie POS - Puente de impresion ACTIVO"
Log ("  Escuchando: http://127.0.0.1:{0}/  (health: /health)" -f $port)
Log "================================================"

while ($true) {
  $client = $null
  try {
    $client = $server.AcceptTcpClient()
  } catch {
    Log ("ERROR aceptando conexion: {0}" -f $_.Exception.Message)
    Start-Sleep -Milliseconds 200
    continue
  }

  $ns = $null
  try {
    $ns = $client.GetStream()
    $ns.ReadTimeout = 5000
    $buf = New-Object byte[] 8192
    $ms = New-Object System.IO.MemoryStream
    $headerEnd = -1
    while ($true) {
      $read = $ns.Read($buf, 0, $buf.Length)
      if ($read -le 0) { break }
      $ms.Write($buf, 0, $read)
      $arr = $ms.ToArray()
      for ($i = 3; $i -lt $arr.Length; $i++) {
        if ($arr[$i-3] -eq 13 -and $arr[$i-2] -eq 10 -and $arr[$i-1] -eq 13 -and $arr[$i] -eq 10) { $headerEnd = $i; break }
      }
      if ($headerEnd -ge 0 -or $ms.Length -gt 2097152) { break }
    }
    $all = $ms.ToArray()
    if ($headerEnd -lt 0) { $client.Close(); continue }

    $headerText = [System.Text.Encoding]::ASCII.GetString($all, 0, $headerEnd + 1)
    $lines = $headerText -split "`r`n"
    $method = ($lines[0] -split ' ')[0]
    $contentLength = 0
    $origin = '*'
    foreach ($l in $lines) {
      if ($l -match '^Content-Length:\s*(\d+)') { $contentLength = [int]$Matches[1] }
      if ($l -match '^Origin:\s*(.+)$')          { $origin = $Matches[1].Trim() }
    }

    $bodyStart = $headerEnd + 1
    $bodyMs = New-Object System.IO.MemoryStream
    if ($all.Length -gt $bodyStart) { $bodyMs.Write($all, $bodyStart, $all.Length - $bodyStart) }
    while ($bodyMs.Length -lt $contentLength) {
      $read = $ns.Read($buf, 0, $buf.Length)
      if ($read -le 0) { break }
      $bodyMs.Write($buf, 0, $read)
    }

    $cors = "Access-Control-Allow-Origin: $origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: content-type`r`nAccess-Control-Allow-Private-Network: true`r`n"

    if ($method -eq 'OPTIONS') {
      $resp = "HTTP/1.1 204 No Content`r`n$cors" + "Content-Length: 0`r`nConnection: close`r`n`r`n"
      $rb = [System.Text.Encoding]::ASCII.GetBytes($resp); $ns.Write($rb, 0, $rb.Length); $ns.Flush()
    }
    elseif ($method -eq 'GET') {
      # Salud / estado (lo usa el watchdog; tambien sirve para probar en el navegador).
      $out = 'Freakie print bridge OK'
      $resp = "HTTP/1.1 200 OK`r`n$cors" + "Content-Type: text/plain`r`nContent-Length: $($out.Length)`r`nConnection: close`r`n`r`n$out"
      $rb = [System.Text.Encoding]::UTF8.GetBytes($resp); $ns.Write($rb, 0, $rb.Length); $ns.Flush()
    }
    elseif ($method -eq 'POST') {
      $bodyText = [System.Text.Encoding]::UTF8.GetString($bodyMs.ToArray())
      $json = $bodyText | ConvertFrom-Json
      $pip = [string]$json.ip
      $pport = [int]$json.port; if ($pport -le 0) { $pport = 9100 }
      $data = [System.Convert]::FromBase64String([string]$json.dataB64)

      $pc = New-Object System.Net.Sockets.TcpClient
      $iar = $pc.BeginConnect($pip, $pport, $null, $null)
      if (-not $iar.AsyncWaitHandle.WaitOne(4000)) { $pc.Close(); throw "timeout conectando a ${pip}:${pport}" }
      $pc.EndConnect($iar)
      $pstream = $pc.GetStream()
      $pstream.Write($data, 0, $data.Length); $pstream.Flush()
      Start-Sleep -Milliseconds 250
      $pstream.Close(); $pc.Close()

      $out = '{"ok":true}'
      $resp = "HTTP/1.1 200 OK`r`n$cors" + "Content-Type: application/json`r`nContent-Length: $($out.Length)`r`nConnection: close`r`n`r`n$out"
      $rb = [System.Text.Encoding]::UTF8.GetBytes($resp); $ns.Write($rb, 0, $rb.Length); $ns.Flush()
      Log ("OK {0} bytes -> {1}:{2}" -f $data.Length, $pip, $pport)
    }
    else {
      $resp = "HTTP/1.1 405 Method Not Allowed`r`n$cors" + "Content-Length: 0`r`nConnection: close`r`n`r`n"
      $rb = [System.Text.Encoding]::ASCII.GetBytes($resp); $ns.Write($rb, 0, $rb.Length); $ns.Flush()
    }
  } catch {
    Log ("ERROR: {0}" -f $_.Exception.Message)
    try {
      $err = "HTTP/1.1 500 Error`r`nAccess-Control-Allow-Origin: *`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
      $eb = [System.Text.Encoding]::ASCII.GetBytes($err); $ns.Write($eb, 0, $eb.Length); $ns.Flush()
    } catch {}
  } finally {
    try { $client.Close() } catch {}
  }
}
