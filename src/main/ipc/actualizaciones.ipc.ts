import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { ResultadoActualizacion, ResultadoIpc } from '../../shared/types/api.types';
import { buscarActualizaciones, instalarActualizacion } from '../services/actualizaciones.service';
import { validarRemitente } from './remitente';

const PREFIJO_PUBLICACION = 'https://github.com/Furiade54/BackupArc/releases';

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registrarIpcActualizaciones(): void {
  ipcMain.handle(
    IPC_CHANNELS.ACTUALIZACIONES_BUSCAR,
    async (evento): Promise<ResultadoIpc<ResultadoActualizacion>> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: await buscarActualizaciones() };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.ACTUALIZACIONES_ABRIR, async (evento, url: unknown): Promise<ResultadoIpc<void>> => {
    try {
      validarRemitente(evento);

      if (typeof url !== 'string' || !url.startsWith(PREFIJO_PUBLICACION)) {
        throw new Error('Enlace de actualización no válido.');
      }

      await shell.openExternal(url);
      return { ok: true, datos: undefined };
    } catch (error) {
      return { ok: false, error: mensajeError(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ACTUALIZACIONES_INSTALAR, async (evento): Promise<ResultadoIpc<void>> => {
    try {
      validarRemitente(evento);
      await instalarActualizacion();
      return { ok: true, datos: undefined };
    } catch (error) {
      return { ok: false, error: mensajeError(error) };
    }
  });
}
