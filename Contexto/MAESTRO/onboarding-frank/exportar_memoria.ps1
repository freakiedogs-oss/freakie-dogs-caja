# Exporta la memoria local del Claude de Cesar a un ZIP para que Frank la importe.
#
# NOTA: este archivo se mantiene en ASCII puro (sin tildes ni enies) a proposito.
# PowerShell 5.1 lee los .ps1 como ANSI y los acentos en UTF-8 le rompen el parseo.
#
# Uso (PowerShell):
#   cd C:\Users\cesar\Documents\Freakies\Claude\freakie-dogs-caja\Contexto\MAESTRO\onboarding-frank
#   .\exportar_memoria.ps1
#
# Genera: ~\Downloads\cesar_memory_export_YYYY-MM-DD.zip
#
# Si falla porque no encuentra la carpeta, abri Cowork y preguntale a Claude:
#   "Cual es la ruta exacta de tu directorio de memoria local?"
# Despues pasale esa ruta al script:
#   .\exportar_memoria.ps1 -MemoryDir "C:\ruta\que\te\dio\memory"

param(
    [string]$MemoryDir = ""
)

$ErrorActionPreference = "Stop"

# Si no pasaron ruta, buscar la carpeta memory dentro de los espacios de Cowork.
# Puede haber varias (una por espacio); tomamos la que tenga MEMORY.md mas reciente.
if ([string]::IsNullOrWhiteSpace($MemoryDir)) {
    $base = Join-Path $env:APPDATA "Claude\local-agent-mode-sessions"

    if (-not (Test-Path $base)) {
        Write-Host "No encontre la carpeta de sesiones de Cowork en:" -ForegroundColor Red
        Write-Host "  $base"
        Write-Host ""
        Write-Host "Abri Cowork, preguntale a Claude cual es su directorio de memoria,"
        Write-Host "y despues corre:"
        Write-Host '  .\exportar_memoria.ps1 -MemoryDir "<la-ruta>"'
        exit 1
    }

    $candidatos = Get-ChildItem -Path $base -Recurse -Directory -Filter "memory" -ErrorAction SilentlyContinue |
                  Where-Object { Test-Path (Join-Path $_.FullName "MEMORY.md") } |
                  Sort-Object { (Get-Item (Join-Path $_.FullName "MEMORY.md")).LastWriteTime } -Descending

    if (-not $candidatos) {
        Write-Host "No encontre ninguna carpeta 'memory' con MEMORY.md adentro." -ForegroundColor Red
        Write-Host "Preguntale a Claude la ruta y pasala con -MemoryDir"
        exit 1
    }

    $MemoryDir = $candidatos[0].FullName

    if ($candidatos.Count -gt 1) {
        Write-Host "Encontre $($candidatos.Count) carpetas de memoria. Uso la mas reciente:" -ForegroundColor Yellow
        Write-Host "  $MemoryDir"
        Write-Host ""
    }
}

if (-not (Test-Path $MemoryDir)) {
    Write-Host "La ruta no existe: $MemoryDir" -ForegroundColor Red
    exit 1
}

$archivos = Get-ChildItem -Path $MemoryDir -File -Recurse
if ($archivos.Count -eq 0) {
    Write-Host "La carpeta esta vacia: $MemoryDir" -ForegroundColor Red
    exit 1
}

$fecha   = Get-Date -Format "yyyy-MM-dd"
$destino = Join-Path $env:USERPROFILE "Downloads\cesar_memory_export_$fecha.zip"

if (Test-Path $destino) { Remove-Item $destino -Force }

Compress-Archive -Path (Join-Path $MemoryDir "*") -DestinationPath $destino

$tam = [math]::Round((Get-Item $destino).Length / 1KB, 1)

Write-Host ""
Write-Host "Listo." -ForegroundColor Green
Write-Host "  Origen:   $MemoryDir"
Write-Host "  Archivos: $($archivos.Count)"
Write-Host "  ZIP:      $destino  ($tam KB)"
Write-Host ""
Write-Host "Revisa el contenido antes de mandarlo: la memoria puede tener notas"
Write-Host "con datos sensibles (PINs, tokens). Borra lo que no quieras compartir."
Write-Host ""
Write-Host "Despues pasale el ZIP a Frank y que siga la seccion 4 de ONBOARDING_FRANK.md"
