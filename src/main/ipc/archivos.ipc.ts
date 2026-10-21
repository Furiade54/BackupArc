import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { ResultadoIpc } from '../../shared/types/api.types';
import type { ArchivoRespaldo } from '../../shared/types/archivo.types';
import { listarArchivos } from '../repositories/archivos.repository';

export function registrarIpcArchivos(): void {
  ipcMain.handle(
    IPC_CHANNELS.ARCHIVOS_LISTAR,
    async (_evento, limite?: number): Promise<ResultadoIpc<ArchivoRespaldo[]>> => {
      try {
        const solicitado = typeof limite === 'number' && Number.isFinite(limite) ? Math.trunc(limite) : 20;
        const limiteSeguro = Math.min(Math.max(solicitado, 1), 100);

        return { ok: true, datos: await listarArchivos(limiteSeguro) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
