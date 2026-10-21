import path from 'node:path';
import { app, BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron';
import { ARGUMENTO_INICIO_OCULTO, CLAVES_CONFIGURACION } from '../shared/constants/configuracion';
import { IPC_CHANNELS } from '../shared/constants/ipc-channels';
import type { EstadoVentana } from '../shared/types/api.types';
import { obtenerPreferenciaConDefecto } from './services/local-database.service';
import { logger } from './utils/logger';

function notificarEstadoVentana(ventana: BrowserWindow): void {
  if (ventana.isDestroyed() || ventana.webContents.isDestroyed()) {
    return;
  }

  const estado: EstadoVentana = { maximizada: ventana.isMaximized() };
  ventana.webContents.send(IPC_CHANNELS.VENTANA_ESTADO_CAMBIADA, estado);
}

let saliendo = false;

export function marcarSalida(): void {
  saliendo = true;
}

export function crearVentanaPrincipal(): BrowserWindow {
  const esMac = process.platform === 'darwin';
  const inicioOculto = process.argv.includes(ARGUMENTO_INICIO_OCULTO);
  const iniciarMinimizado =
    inicioOculto ||
    obtenerPreferenciaConDefecto(CLAVES_CONFIGURACION.iniciarMinimizado, '0') === '1';
  const siempreVisible =
    obtenerPreferenciaConDefecto(CLAVES_CONFIGURACION.siempreVisible, '0') === '1';

  const opcionesMarco: BrowserWindowConstructorOptions = esMac
    ? {
        // En macOS se conservan los botones nativos (semáforo) y se oculta la barra nativa.
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 14, y: 12 },
      }
    : {
        // En Windows y Linux la barra es completamente personalizada.
        frame: false,
      };

  const ventana = new BrowserWindow({
    ...opcionesMarco,
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#070d19',
    title: 'BackupArc 2.0',
    autoHideMenuBar: true,
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '../../assets/icons/png/256x256.png') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (siempreVisible) {
    ventana.setAlwaysOnTop(true);
  }

  ventana.once('ready-to-show', () => {
    if (!iniciarMinimizado) {
      ventana.show();
    }
  });

  ventana.on('maximize', () => notificarEstadoVentana(ventana));
  ventana.on('unmaximize', () => notificarEstadoVentana(ventana));

  ventana.on('close', (evento) => {
    if (saliendo) {
      return;
    }

    const mantenerEnSegundoPlano =
      obtenerPreferenciaConDefecto(CLAVES_CONFIGURACION.mantenerEnSegundoPlano, '1') !== '0';

    if (!mantenerEnSegundoPlano) {
      return;
    }

    evento.preventDefault();

    if (ventana.webContents.isDestroyed()) {
      ventana.hide();
      return;
    }

    ventana.webContents.send(IPC_CHANNELS.VENTANA_SOLICITAR_CIERRE);
  });

  ventana.webContents.on('did-finish-load', () => {
    logger.info('Interfaz cargada correctamente');
  });

  ventana.webContents.on('did-fail-load', (_evento, codigo, descripcion) => {
    logger.error(`No se pudo cargar la interfaz (${codigo}): ${descripcion}`);
  });

  ventana.webContents.on('preload-error', (_evento, rutaPreload, error) => {
    logger.error(`No se pudo cargar el preload (${rutaPreload})`, error);
  });

  ventana.webContents.on('will-navigate', (evento, url) => {
    const origenPermitido = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : url.startsWith('file://');

    if (!origenPermitido) {
      evento.preventDefault();
    }
  });

  ventana.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void ventana.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void ventana.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  return ventana;
}
