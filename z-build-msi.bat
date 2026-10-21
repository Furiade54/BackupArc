@echo off
setlocal
cd /d "%~dp0"

echo Compilando el instalador MSI de BackupArc...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-msi.ps1"

if errorlevel 1 (
  echo.
  echo La compilacion del MSI fallo.
  pause
  exit /b 1
)

echo.
echo Publicando el release en GitHub...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-release.ps1"

if errorlevel 1 (
  echo.
  echo La publicacion del release en GitHub fallo.
  pause
  exit /b 1
)

echo.
echo Build y release completados.
echo MSI local: %~dp0out-msi\make\wix\x64
echo.
pause
