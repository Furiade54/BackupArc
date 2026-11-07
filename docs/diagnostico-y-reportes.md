# Diagnóstico y reporte de fallos

Documentación del sistema de logging persistente y del flujo «Reportar fallo» de BackupArc.

## 1. Arquitectura

| Capa | Responsabilidad |
| --- | --- |
| Main | Escribe los archivos de log, captura fallos globales, valida y construye el reporte, abre GitHub. |
| Preload | Expone únicamente `window.api.diagnostico` con métodos acotados. |
| Renderer | Captura errores de ventana y de React; muestra el modal y pide consentimiento explícito. |

El renderer nunca recibe rutas arbitrarias ni acceso al sistema de archivos. Solo puede:

- `registrarError(datos)`: envía un error ya capturado.
- `resumen()`: obtiene el resumen saneado.
- `reportar()`: abre el Issue pre-rellenado en el navegador.
- `exportar()`: genera un archivo local de diagnóstico.
- `abrirCarpetaLogs()`: abre la carpeta de registros en el explorador.

## 2. Ubicación de los archivos

Todo se guarda dentro de `app.getPath('userData')`:

```
%APPDATA%\backuparc\
  backuparc.db            # historial de respaldos (SQLite, sin cambios)
  logs\
    backuparc-AAAA-MM-DD.log
    backuparc-AAAA-MM-DDTHH-MM-SS-ms.log   # rotados por tamaño
  diagnosticos\
    diagnostico-AAAA-MM-DDTHH-MM-SS-ms.md
  Crashpad\               # volcados locales de crashReporter
```

SQLite se mantiene exclusivamente para el historial de respaldos. Los diagnósticos
técnicos viven en archivos rotativos.

## 3. Logging

### Niveles

`DEBUG`, `INFO`, `WARN`, `ERROR`. Formato de línea:

```
[2026-11-07T10:46:22.617Z] [INFO] Mensaje {"detalle":"saneado"}
```

### Rotación y retención

- Un archivo por día: `backuparc-AAAA-MM-DD.log`.
- Al superar **5 MB**, el archivo actual se renombra con marca de tiempo y se continúa en uno nuevo.
- Se conservan como máximo **10 archivos** y se eliminan los de más de **7 días**.
- Todas las escrituras son síncronas y están protegidas: un fallo de disco nunca interrumpe la aplicación.
- Las líneas emitidas antes de que Electron resuelva `userData` se guardan en memoria y se vuelcan al inicializar.

### Eventos registrados

- Inicio de la aplicación (versión, Electron, plataforma, arquitectura, empaquetada).
- Cierre normal, cierre diferido por copias en curso y liberación de recursos.
- Inicio, éxito y fallo de cada respaldo, con su `id` y tipo.
- Actualización disponible, instalador descargado, instalación y reinicio.
- Cada handler IPC con el nombre del canal como contexto.
- `uncaughtException`, `unhandledRejection`, `render-process-gone`, `child-process-gone`.
- Errores del renderer: `window.onerror`, `unhandledrejection` y `ErrorBoundary` de React.

### Datos sensibles

Antes de escribir o transmitir se aplica `src/main/utils/sanitizar.ts`:

- Claves de objeto que contengan `pass`, `passw`, `contrase`, `secret`, `token`,
  `api key`, `credencial`, `authorization`, `cookie`, `connectionstring` o `cadena`
  se reemplazan por `***`.
- En texto libre se redactan `password=`, `pwd=`, `Bearer`, `User Id=`,
  `Data Source=`, `Server=` e `Initial Catalog=`.
- Se limitan profundidad, número de elementos y longitud de cada texto.

## 4. Reporte de fallos

### Flujo

1. El usuario pulsa **Reportar fallo** en la barra lateral.
2. El renderer pide el resumen al Main y muestra: versión, Electron, sistema, cantidad de
   archivos de log, errores y advertencias recientes.
3. El usuario puede **Exportar diagnóstico** (archivo `.md` local con hasta 256 KB de logs).
4. El usuario marca explícitamente la casilla de consentimiento.
5. **Abrir Issue en GitHub** construye un Issue pre-rellenado y lo abre en el navegador.
6. El usuario confirma el formulario con su cuenta de GitHub; allí obtiene el enlace y el
   número del Issue.

### Por qué no hay token en el ejecutable

El repositorio es público y el envío se delega a la sesión de GitHub del navegador. La
aplicación **nunca** contiene un token personal ni credenciales de una GitHub App, por lo
que no hay secretos que extraer del instalador.

Si en el futuro el repositorio pasa a privado, este flujo deja de funcionar: haría falta
un backend autenticado (Worker o GitHub App) que guarde el token en el servidor.

### Límites

- Cuerpo del Issue: máximo **2800 caracteres** (el resto se trunca con aviso).
- Una URL de Issue generada en las pruebas midió ~1.2 KB, muy por debajo del límite del navegador.
- Frecuencia: **1 reporte cada 60 segundos** y **5 por hora**. Las marcas se guardan en la
  tabla `preferencias` con la clave `diagnostico.reportes`.
- Los registros completos no viajan en la URL: permanecen en local y se adjuntan manualmente.

## 5. Configuración de GitHub

1. El repositorio debe ser **público**: `https://github.com/Furiade54/BackupArc`.
2. Crear la etiqueta `bug` en el repositorio (Issues → Labels → New label) para que el
   parámetro `labels=bug` del enlace se aplique.
3. Opcional: activar una plantilla de Issue en `.github/ISSUE_TEMPLATE/bug_report.md`.
   El reporte automático no la usa, pero ayuda a los reportes manuales.
4. No se requiere ningún secreto, token, workflow ni GitHub App.
5. La constante con el repositorio está en `src/main/services/diagnostico.service.ts`
   (`REPOSITORIO_GITHUB`).

## 6. Verificación en una compilación de producción

1. `pnpm run typecheck` y `pnpm run lint` deben terminar sin errores.
2. Generar el instalador con `pnpm run make:msi`.
3. Instalar el MSI y abrir BackupArc desde el acceso directo.
4. Comprobar que existe `%APPDATA%\backuparc\logs\backuparc-<fecha>.log` y que contiene
   la línea `BackupArc iniciado` con la versión instalada.
5. Ejecutar un respaldo y verificar las líneas `Copia "..." iniciada` y `Copia "..." completada`
   o `Falló la copia "..."`.
6. Abrir **Reportar fallo**: debe mostrar versión, Electron, sistema y archivos de log.
7. Pulsar **Exportar diagnóstico** y abrir el `.md` generado en
   `%APPDATA%\backuparc\diagnosticos\`.
8. Marcar el consentimiento y pulsar **Abrir Issue en GitHub**: debe abrirse el navegador
   con título, cuerpo y etiqueta precargados.
9. Confirmar el Issue en GitHub y comprobar que el número y el enlace aparecen allí.
10. Cerrar la aplicación con copias activas para verificar la línea de cierre diferido.

### Pruebas ejecutadas en esta implementación

- Persistencia: se lanzó la app en modo desarrollo con `--user-data-dir` aislado y se
  verificó `backuparc-2026-11-07.log` con las líneas de arranque.
- Captura global: se forzó una excepción en el proceso principal; quedó registrada como
  `[ERROR] Excepción no capturada en el proceso principal` y la app siguió en ejecución.
- Sanitización: se registró `{ password, cadena }`; ambos valores aparecieron como `***`.
- Reporte: se generó el Issue con 836 caracteres de cuerpo y 1189 de URL, con 1 error
  detectado en el log.
- Exportación: se creó `diagnostico-...md` con el entorno y los registros recientes.
