import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { config as cargarVariablesEntorno } from 'dotenv';
import { registrarManejadoresIpc } from './ipc';
import { sincronizarInicioAutomatico } from './ipc/configuracion.ipc';
import { configurarMenu } from './menu';
import { cerrarConexion } from './services/database.service';
import { cerrarBaseDatosLocal, inicializarBaseDatosLocal } from './services/local-database.service';
import { detenerProgramador, iniciarProgramador } from './services/respaldo-ejecucion.service';
import {
  detenerComprobadorActualizaciones,
  iniciarComprobadorActualizaciones,
} from './services/actualizaciones.service';
import { avisarEjecucionSegundoPlano, avisarPrimerInicioDelDia, avisarYaEnEjecucion, crearBandeja, destruirBandeja, mostrarVentanaPrincipal } from './tray';
import { logger } from './utils/logger';
import { crearVentanaPrincipal, marcarSalida } from './window';

const rutaEnv = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(app.getAppPath(), '.env');

cargarVariablesEntorno({ path: rutaEnv, quiet: true });

// Debe coincidir con el AppUserModelID que el instalador MSI asigna al acceso
// directo (electron-wix-msi usa com.squirrel.<nombre>.<exe>), de lo contrario
// Windows muestra las notificaciones con el nombre "Electron".
app.setAppUserModelId(`com.squirrel.${app.getName()}.${app.getName()}`.toLowerCase());

const bloqueoInstancia = app.requestSingleInstanceLock();

if (!bloqueoInstancia) {
  logger.warn('BackupArc ya está en ejecución; se cierra la nueva instancia.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) {
      return;
    }

    mostrarVentanaPrincipal();
    avisarYaEnEjecucion();
  });

  app.whenReady().then(() => {
    try {
      inicializarBaseDatosLocal();
      sincronizarInicioAutomatico();
      iniciarProgramador();
      iniciarComprobadorActualizaciones();
    } catch (error) {
      logger.error('No se pudo inicializar la base de datos local', error);
    }

    configurarMenu();
    registrarManejadoresIpc();
    const ventanaPrincipal = crearVentanaPrincipal();
    crearBandeja();
    avisarPrimerInicioDelDia();
    ventanaPrincipal.on('hide', avisarEjecucionSegundoPlano);
    logger.info('BackupArc 2.0 iniciado');

    app.on('activate', () => {
      const [ventana] = BrowserWindow.getAllWindows();

      if (ventana) {
        ventana.show();
        ventana.focus();
      } else {
        crearVentanaPrincipal();
      }
    });
  }).catch((error: unknown) => {
    logger.error('No se pudo iniciar la aplicación', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    marcarSalida();
    detenerProgramador();
    detenerComprobadorActualizaciones();
    destruirBandeja();
    cerrarBaseDatosLocal();
    void cerrarConexion();
  });
}
