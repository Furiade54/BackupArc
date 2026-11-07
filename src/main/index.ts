import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { config as cargarVariablesEntorno } from 'dotenv';
import { registrarManejadoresIpc } from './ipc';
import { sincronizarInicioAutomatico } from './ipc/configuracion.ipc';
import { configurarMenu } from './menu';
import { cerrarConexion } from './services/database.service';
import { cerrarBaseDatosLocal, inicializarBaseDatosLocal } from './services/local-database.service';
import {
  contarEjecucionesActivas,
  detenerProgramador,
  esperarEjecucionesActivas,
  hayEjecucionesActivas,
  iniciarProgramador,
} from './services/respaldo-ejecucion.service';
import {
  detenerComprobadorActualizaciones,
  iniciarComprobadorActualizaciones,
} from './services/actualizaciones.service';
import { avisarCopiasRecuperadas, avisarEjecucionSegundoPlano, avisarPrimerInicioDelDia, avisarYaEnEjecucion, crearBandeja, destruirBandeja, mostrarVentanaPrincipal } from './tray';
import { logger } from './utils/logger';
import { registrarCapturaGlobalDeErrores } from './utils/errores-globales';
import { crearVentanaPrincipal, marcarSalida, notificarEsperaCierre } from './window';

const rutaEnv = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(app.getAppPath(), '.env');

cargarVariablesEntorno({ path: rutaEnv, quiet: true });

// Lo antes posible: cualquier fallo posterior debe quedar registrado en disco.
registrarCapturaGlobalDeErrores();

// Debe coincidir con el AppUserModelID que el instalador MSI asigna al acceso
// directo (electron-wix-msi usa com.squirrel.<nombre>.<exe>), de lo contrario
// Windows muestra las notificaciones con el nombre "Electron".
app.setAppUserModelId(`com.squirrel.${app.getName()}.${app.getName()}`.toLowerCase());

// Tiempo máximo que se espera a las copias en curso antes de cerrar de todos
// modos: una copia atascada no puede dejar la aplicación sin poder salir.
const ESPERA_MAXIMA_CIERRE_MS = 15 * 60 * 1000;

let cierreAutorizado = false;
let cierreEnEspera = false;
let recursosLiberados = false;
let copiasRecuperadas = 0;

function liberarRecursos(): void {
  if (recursosLiberados) {
    return;
  }

  recursosLiberados = true;
  logger.info('Liberando recursos antes de cerrar');
  detenerProgramador();
  detenerComprobadorActualizaciones();
  destruirBandeja();
  cerrarBaseDatosLocal();
  void cerrarConexion();
}

function esperarCierreOLimite(): Promise<'libre' | 'limite'> {
  return new Promise((resolver) => {
    const temporizador = setTimeout(() => resolver('limite'), ESPERA_MAXIMA_CIERRE_MS);

    void esperarEjecucionesActivas().then(() => {
      clearTimeout(temporizador);
      resolver('libre');
    });
  });
}

async function cerrarEsperandoCopias(): Promise<void> {
  // Mientras se espera no se lanzan copias nuevas: solo terminan las activas.
  detenerProgramador();
  detenerComprobadorActualizaciones();
  notificarEsperaCierre(contarEjecucionesActivas());
  logger.info('Se aplaza el cierre hasta que terminen las copias en curso', {
    activas: contarEjecucionesActivas(),
  });

  const resultado = await esperarCierreOLimite();

  if (resultado === 'limite') {
    logger.warn('Se cierra con copias en curso tras agotar la espera máxima', {
      activas: contarEjecucionesActivas(),
    });
  }

  notificarEsperaCierre(0);
  cierreAutorizado = true;
  marcarSalida();
  app.quit();
}

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
      copiasRecuperadas = iniciarProgramador();
      iniciarComprobadorActualizaciones();
    } catch (error) {
      logger.error('No se pudo inicializar la base de datos local', error);
    }

    configurarMenu();
    registrarManejadoresIpc();
    const ventanaPrincipal = crearVentanaPrincipal();
    crearBandeja();
    avisarPrimerInicioDelDia();

    // El aviso de recuperación se muestra después del diario para no perderlo.
    if (copiasRecuperadas > 0) {
      avisarCopiasRecuperadas(copiasRecuperadas);
    }

    ventanaPrincipal.on('hide', avisarEjecucionSegundoPlano);
    logger.info('BackupArc iniciado', {
      version: app.getVersion(),
      electron: process.versions.electron,
      plataforma: process.platform,
      arquitectura: process.arch,
      empaquetada: app.isPackaged,
    });

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
      logger.info('Todas las ventanas se cerraron; se solicita el cierre de la aplicación');
      app.quit();
    }
  });

  app.on('before-quit', (evento) => {
    // Un cierre con copias en curso se aplaza hasta que terminen: cortar una
    // copia a mitad puede dejar un .zip parcial o un .bak incompleto.
    if (!cierreAutorizado && hayEjecucionesActivas()) {
      evento.preventDefault();

      if (!cierreEnEspera) {
        cierreEnEspera = true;
        void cerrarEsperandoCopias();
      }

      return;
    }

    logger.info('Cierre de la aplicación', {
      copiasActivas: contarEjecucionesActivas(),
      cierreDiferido: cierreAutorizado,
    });
    marcarSalida();
    liberarRecursos();
  });
}
