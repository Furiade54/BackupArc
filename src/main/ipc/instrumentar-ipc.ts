import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { logger } from '../utils/logger';

function esRespuestaFallida(valor: unknown): valor is { ok: false; error: string } {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'ok' in valor &&
    (valor as { ok?: boolean }).ok === false
  );
}

let instrumentado = false;

// Se envuelve ipcMain.handle una sola vez, antes de registrar los handlers.
// Así todos los canales quedan registrados con su nombre como contexto, sin
// tener que repetir el try/catch ni el log en cada archivo de IPC.
export function instrumentarIpc(): void {
  if (instrumentado) {
    return;
  }

  instrumentado = true;
  const registrarOriginal = ipcMain.handle.bind(ipcMain);

  const registrarInstrumentado = (
    canal: string,
    manejador: (evento: IpcMainInvokeEvent, ...argumentos: unknown[]) => unknown,
  ): void => {
    registrarOriginal(canal, async (evento, ...argumentos) => {
      try {
        const resultado = await manejador(evento, ...argumentos);

        if (esRespuestaFallida(resultado)) {
          logger.warn(`La operación IPC "${canal}" respondió con error`, resultado.error);
        }

        return resultado;
      } catch (error) {
        logger.error(`La operación IPC "${canal}" lanzó una excepción`, error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  };

  ipcMain.handle = registrarInstrumentado as typeof ipcMain.handle;
}
