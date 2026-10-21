import { app, BrowserWindow, ipcMain } from 'electron';
import { ARGUMENTO_INICIO_OCULTO, CLAVES_CONFIGURACION } from '../../shared/constants/configuracion';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type {
  ClaveConfiguracionAvanzada,
  ConfiguracionAvanzada,
  ResultadoIpc,
} from '../../shared/types/api.types';
import {
  guardarPreferencia,
  obtenerPreferenciaConDefecto,
} from '../services/local-database.service';
import { comprobarActualizacionesAhora } from '../services/actualizaciones.service';
import { validarRemitente } from './remitente';

const CLAVES_VALIDAS: ClaveConfiguracionAvanzada[] = [
  'siempreVisible',
  'iniciarConSistema',
  'iniciarMinimizado',
  'mostrarAvisos',
  'mantenerEnSegundoPlano',
  'buscarActualizaciones',
];

function esClaveValida(valor: unknown): valor is ClaveConfiguracionAvanzada {
  return typeof valor === 'string' && (CLAVES_VALIDAS as string[]).includes(valor);
}

function validarClave(valor: unknown): ClaveConfiguracionAvanzada {
  if (!esClaveValida(valor)) {
    throw new Error('Opción de configuración no válida.');
  }

  return valor;
}

function validarBooleano(valor: unknown): boolean {
  if (typeof valor !== 'boolean') {
    throw new Error('El valor de configuración debe ser verdadero o falso.');
  }

  return valor;
}

function leerBooleano(clave: string, porDefecto: boolean): boolean {
  return obtenerPreferenciaConDefecto(clave, porDefecto ? '1' : '0') === '1';
}

function guardarBooleano(clave: string, valor: boolean): void {
  guardarPreferencia(clave, valor ? '1' : '0');
}

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function obtenerConfiguracionAvanzada(): ConfiguracionAvanzada {
  return {
    siempreVisible: leerBooleano(CLAVES_CONFIGURACION.siempreVisible, false),
    iniciarConSistema: app.isPackaged
      ? inicioAutomaticoActivo()
      : leerBooleano(CLAVES_CONFIGURACION.iniciarConSistema, false),
    iniciarMinimizado: leerBooleano(CLAVES_CONFIGURACION.iniciarMinimizado, false),
    mostrarAvisos: leerBooleano(CLAVES_CONFIGURACION.mostrarAvisos, true),
    mantenerEnSegundoPlano: leerBooleano(CLAVES_CONFIGURACION.mantenerEnSegundoPlano, true),
    buscarActualizaciones: leerBooleano(CLAVES_CONFIGURACION.buscarActualizaciones, true),
  };
}

function opcionesInicioAutomatico(abrir: boolean): Electron.Settings {
  return {
    openAtLogin: abrir,
    ...(process.platform === 'win32' ? { args: [ARGUMENTO_INICIO_OCULTO] } : {}),
    ...(process.platform === 'darwin' ? { openAsHidden: true } : {}),
  };
}

function opcionesConsultaInicio(): Electron.LoginItemSettingsOptions {
  return process.platform === 'win32'
    ? { path: process.execPath, args: [ARGUMENTO_INICIO_OCULTO] }
    : {};
}

// En Windows el registro incluye --oculto, por lo que hay que comparar con
// esos argumentos; sin ellos la consulta devuelve siempre desactivado.
function inicioAutomaticoActivo(): boolean {
  if (!app.isPackaged) {
    return false;
  }

  return (
    app.getLoginItemSettings(opcionesConsultaInicio()).openAtLogin ||
    app.getLoginItemSettings().openAtLogin
  );
}

export function sincronizarInicioAutomatico(): void {
  if (!inicioAutomaticoActivo()) {
    return;
  }

  // Refresca el registro para que el arranque con Windows incluya el
  // argumento que mantiene la ventana oculta en la bandeja.
  app.setLoginItemSettings(opcionesInicioAutomatico(true));
}

function actualizarConfiguracion(
  clave: ClaveConfiguracionAvanzada,
  valor: boolean,
): ConfiguracionAvanzada {
  guardarBooleano(CLAVES_CONFIGURACION[clave], valor);

  if (clave === 'siempreVisible') {
    const [ventana] = BrowserWindow.getAllWindows();

    if (ventana && !ventana.isDestroyed()) {
      ventana.setAlwaysOnTop(valor);
    }
  }

  if (clave === 'iniciarConSistema' && app.isPackaged) {
    app.setLoginItemSettings(opcionesInicioAutomatico(valor));
  }

  if (clave === 'buscarActualizaciones' && valor) {
    comprobarActualizacionesAhora();
  }

  return obtenerConfiguracionAvanzada();
}

export function registrarIpcConfiguracion(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIGURACION_OBTENER, (evento): ResultadoIpc<ConfiguracionAvanzada> => {
    try {
      validarRemitente(evento);
      return { ok: true, datos: obtenerConfiguracionAvanzada() };
    } catch (error) {
      return { ok: false, error: mensajeError(error) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.CONFIGURACION_ACTUALIZAR,
    (evento, clave: unknown, valor: unknown): ResultadoIpc<ConfiguracionAvanzada> => {
      try {
        validarRemitente(evento);
        return {
          ok: true,
          datos: actualizarConfiguracion(validarClave(clave), validarBooleano(valor)),
        };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );
}
