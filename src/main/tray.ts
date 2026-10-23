import path from 'node:path';
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  Notification,
  Tray,
  type NativeImage,
} from 'electron';
import { CLAVES_CONFIGURACION } from '../shared/constants/configuracion';
import { obtenerPreferenciaConDefecto } from './services/local-database.service';
import { logger } from './utils/logger';
import { crearVentanaPrincipal } from './window';

let bandeja: Tray | null = null;
let avisoSegundoPlanoMostrado = false;
let accionAvisoPendiente: (() => void) | null = null;

function raizIconos(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icons')
    : path.join(app.getAppPath(), 'assets/icons');
}

function cargarIconoBandeja(): NativeImage {
  const raiz = raizIconos();
  const candidatos =
    process.platform === 'win32'
      ? [path.join(raiz, 'win/icon.ico'), path.join(raiz, 'png/32x32.png')]
      : [path.join(raiz, 'png/32x32.png')];

  for (const ruta of candidatos) {
    const imagen = nativeImage.createFromPath(ruta);

    if (!imagen.isEmpty()) {
      return imagen;
    }
  }

  return nativeImage.createEmpty();
}

function cargarIconoAviso(): NativeImage {
  const raiz = raizIconos();
  // Se usa un PNG grande y nítido: el ICO multi-tamaño hace que Windows
  // elija una variante pequeña y la amplíe, viéndose borroso.
  const candidatos = [
    path.join(raiz, 'png/64.png'),
    path.join(raiz, 'png/48.png'),
    path.join(raiz, 'png/32x32.png'),
  ];

  for (const ruta of candidatos) {
    const imagen = nativeImage.createFromPath(ruta);

    if (!imagen.isEmpty()) {
      return imagen;
    }
  }

  return nativeImage.createEmpty();
}

function mostrarAviso(titulo: string, mensaje: string, alHacerClic?: () => void): void {
  if (obtenerPreferenciaConDefecto(CLAVES_CONFIGURACION.mostrarAvisos, '1') === '0') {
    return;
  }

  const imagen = cargarIconoAviso();
  const opcionesIcono = imagen.isEmpty() ? {} : { icon: imagen };

  if (process.platform === 'win32' && bandeja) {
    accionAvisoPendiente = alHacerClic ?? null;
    bandeja.displayBalloon({
      title: titulo,
      content: mensaje,
      noSound: true,
      largeIcon: true,
      ...opcionesIcono,
    });
    return;
  }

  if (Notification.isSupported()) {
    const notificacion = new Notification({
      title: titulo,
      body: mensaje,
      silent: true,
      ...opcionesIcono,
    });

    if (alHacerClic) {
      notificacion.on('click', alHacerClic);
    }

    notificacion.show();
  }
}

export function mostrarVentanaPrincipal(): void {
  const [ventana] = BrowserWindow.getAllWindows();

  if (!ventana) {
    crearVentanaPrincipal();
    return;
  }

  if (ventana.isMinimized()) {
    ventana.restore();
  }

  ventana.show();
  ventana.focus();
}

export function crearBandeja(): void {
  if (bandeja) {
    return;
  }

  const imagen = cargarIconoBandeja();

  if (imagen.isEmpty()) {
    logger.warn('No se pudo cargar el icono de la bandeja del sistema');
  }

  bandeja = new Tray(imagen);
  bandeja.setToolTip('BackupArc 2.0');
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir BackupArc', click: mostrarVentanaPrincipal },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() },
    ]),
  );

  bandeja.on('click', mostrarVentanaPrincipal);
  bandeja.on('balloon-click', () => {
    const accion = accionAvisoPendiente;
    accionAvisoPendiente = null;
    accion?.();
  });
}

export function destruirBandeja(): void {
  bandeja?.destroy();
  bandeja = null;
}

export function avisarEjecucionSegundoPlano(): void {
  if (avisoSegundoPlanoMostrado) {
    return;
  }

  avisoSegundoPlanoMostrado = true;
  mostrarAviso(
    'BackupArc continúa en segundo plano',
    'La ventana se cerró, pero las copias programadas seguirán ejecutándose. Abre la aplicación desde el icono de la bandeja del sistema.',
  );
}

export function avisarYaEnEjecucion(): void {
  mostrarAviso(
    'BackupArc ya está en ejecución',
    'La aplicación ya está abierta. Se muestra la ventana existente para evitar procesos duplicados.',
  );
}

export function avisarActualizacionDisponible(version: string, alHacerClic: () => void): void {
  mostrarAviso(
    `Nueva versión disponible: ${version}`,
    'Hay una nueva versión de BackupArc disponible. Haz clic en este aviso para descargarla e instalarla.',
    alHacerClic,
  );
}
