# BackupArc 2.0

Aplicación de escritorio (Electron + React + TypeScript) para consultar y gestionar respaldos de SQL Server.

## Requisitos

- Node.js 22.13 o superior
- SQL Server accesible (opcional para arrancar la interfaz)

## Puesta en marcha

```bash
npm install
npm start
```

La primera pantalla funciona sin base de datos: muestra el entorno de Electron y el estado de la conexión. Para consultar respaldos, copia `.env.example` a `.env` y completa las variables `DB_*`.

## Almacenamiento local

La aplicación crea una base SQLite en `app.getPath('userData')/backuparc.db` (en Windows: `%APPDATA%\backuparc\backuparc.db`). Guarda las preferencias de interfaz en `preferencias`, las copias configuradas en `respaldos` y su historial en `ejecuciones_respaldo`.

## Scripts

- `npm start`: inicia la aplicación en modo desarrollo con recarga en caliente.
- `npm run lint`: ejecuta ESLint.
- `npm run lint:fix`: corrige automáticamente lo que ESLint pueda resolver.
- `npm run typecheck`: valida los tres proyectos TypeScript (main, preload y renderer).
- `npm run package`: genera la aplicación empaquetada en `out/`.
- `npm run make`: genera el instalador para la plataforma actual.

## Estructura

```
assets/
  icons/
    png/       Iconos PNG de 16 a 1024 px
    win/       icon.ico para Windows
    mac/       icon.icns para macOS
    src/       Logo editable (SVG)
src/
  main/        Proceso principal: ventana, menú, IPC, servicios y repositorios
  preload/     Puente seguro entre Electron y el renderer
  renderer/    Interfaz React
  shared/      Constantes y tipos compartidos
```
