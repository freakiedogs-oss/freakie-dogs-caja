@echo off
title Freakie POS - Instalar arranque automatico del puente
echo ==================================================
echo   Arranque automatico + autocuracion del puente
echo ==================================================
echo.
echo Esto registra una Tarea Programada que:
echo   - arranca el puente al iniciar sesion en Windows, y
echo   - cada 2 minutos revisa que este vivo y, si no, lo reinicia solo.
echo No necesita permisos de administrador.
echo.

set "WD=%~dp0watchdog.ps1"

schtasks /Create /TN "FreakiePrintBridge" /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%WD%\"" /SC MINUTE /MO 2 /RL LIMITED /F
schtasks /Create /TN "FreakiePrintBridgeLogon" /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%WD%\"" /SC ONLOGON /RL LIMITED /F

echo.
echo Arrancando el puente ahora mismo...
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%WD%"

echo.
echo ==================================================
echo   Listo. El puente ya arranca solo y se autorepara.
echo   Para probar: abri http://127.0.0.1:9110/health en Chrome
echo   (debe decir "Freakie print bridge OK").
echo ==================================================
echo.
echo Podes cerrar esta ventana.
pause
