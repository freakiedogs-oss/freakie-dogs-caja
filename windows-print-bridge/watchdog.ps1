# Watchdog del puente de impresion Freakie.
# Lo corre una Tarea Programada al iniciar sesion y cada 2 minutos.
# Si el puente NO responde /health, mata cualquier resto colgado y lo relanza
# OCULTO. Si esta sano, no hace nada. Reemplaza el frágil arranque por .vbs en
# shell:startup (que no sobrevivia reinicios ni cuelgues).

$here = $PSScriptRoot
$ps1  = Join-Path $here 'freakie-print-bridge.ps1'
$log  = Join-Path $here 'watchdog-log.txt'

function WLog($m) {
  try { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 } catch {}
}

# 1) ¿Esta vivo y sano?
$healthy = $false
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9110/health' -TimeoutSec 3 -UseBasicParsing
  if ($r.StatusCode -eq 200) { $healthy = $true }
} catch { $healthy = $false }

if ($healthy) { exit 0 }   # todo bien, nada que hacer

WLog 'Puente NO responde /health -> limpiando y relanzando'

# 2) Matar restos colgados (por linea de comando y por dueno del puerto 9110)
try {
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*freakie-print-bridge*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
try {
  Get-NetTCPConnection -LocalPort 9110 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
} catch {}

Start-Sleep -Seconds 1

# 3) Relanzar el puente OCULTO
try {
  Unblock-File -Path $ps1 -ErrorAction SilentlyContinue
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $ps1
  )
  WLog 'Puente relanzado OK'
} catch {
  WLog ("ERROR relanzando: {0}" -f $_.Exception.Message)
}
exit 0
