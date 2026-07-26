@echo off
title Freakie POS - Puente de impresion
echo Iniciando puente de impresion Freakie POS...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0freakie-print-bridge.ps1' -ErrorAction SilentlyContinue; & '%~dp0freakie-print-bridge.ps1'"
echo.
echo El puente se detuvo. Podes cerrar esta ventana.
pause
