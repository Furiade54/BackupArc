import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { EstadoConexion, InfoAplicacion, ResultadoIpc } from '../../shared/types/api.types';
import { comprobarConexion } from '../services/database.service';
import { registrarIpcActualizaciones } from './actualizaciones.ipc';
import { registrarIpcArchivos } from './archivos.ipc';
import { registrarIpcConfiguracion } from './configuracion.ipc';
import { registrarIpcDialogos } from './dialogos.ipc';
import { registrarIpcMssql } from './mssql.ipc';
import { registrarIpcPreferencias } from './preferencias.ipc';
import { registrarIpcRespaldos } from './respaldos.ipc';
import { registrarIpcVentana } from './ventana.ipc';

export function registrarManejadoresIpc(): void {
  ipcMain.handle(IPC_CHANNELS.APP_INFO, (): ResultadoIpc<InfoAplicacion> => ({
    ok: true,
    datos: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      plataforma: process.platform,
      arquitectura: process.arch,
      empaquetada: app.isPackaged,
    },
  }));

  ipcMain.handle(IPC_CHANNELS.DB_ESTADO, async (): Promise<ResultadoIpc<EstadoConexion>> => {
    try {
      return { ok: true, datos: await comprobarConexion() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  registrarIpcArchivos();
  registrarIpcDialogos();
  registrarIpcMssql();
  registrarIpcVentana();
  registrarIpcPreferencias();
  registrarIpcConfiguracion();
  registrarIpcActualizaciones();
  registrarIpcRespaldos();
}
