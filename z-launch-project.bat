@echo off
setlocal
title BackupArc 2.0 - Inicio

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] No se encontro npm. Instala Node.js 22.13 o superior.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] No se pudieron instalar las dependencias.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando BackupArc 2.0...
echo Cierra la aplicacion para detener el entorno de desarrollo.
echo.

call npm start

if errorlevel 1 (
  echo.
  echo [ERROR] La aplicacion termino con un codigo de error.
  echo.
  pause
)

endlocal
