@echo off
title Freakie POS - Reiniciar puente de impresion
echo ============================================
echo   Reiniciando el puente de impresion Freakie
echo ============================================
echo.
echo 1) Cerrando cualquier puente viejo o colgado...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*freakie-print-bridge*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; try { Get-NetTCPConnection -LocalPort 9110 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}"
echo    Listo.
echo.
echo 2) Esperando que se libere el puerto...
timeout /t 2 /nobreak >nul
echo.
echo 3) Arrancando un puente limpio. DEJA ESTA VENTANA ABIERTA.
echo    Debe decir "ACTIVO". Al imprimir veras: OK N bytes -^> 192.168.0.253:9100
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0freakie-print-bridge.ps1' -ErrorAction SilentlyContinue; & '%~dp0freakie-print-bridge.ps1'"
echo.
echo El puente se detuvo. Podes cerrar esta ventana.
pause
