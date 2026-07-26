' Lanza el puente de impresion Freakie SIN ventana (segundo plano).
' Doble clic para iniciarlo, o dejarlo en la carpeta de Inicio para arranque automatico.
Dim shell, fso, here, ps1
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = here & "\freakie-print-bridge.ps1"
shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
