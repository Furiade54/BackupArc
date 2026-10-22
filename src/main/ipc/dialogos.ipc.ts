import { dialog, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { ResultadoIpc } from '../../shared/types/api.types';
import { validarRemitente } from './remitente';

export function registrarIpcDialogos(): void {
  ipcMain.handle(
    IPC_CHANNELS.SISTEMA_ABRIR_RUTA,
    async (evento, ruta: unknown): Promise<ResultadoIpc<void>> => {
      try {
        validarRemitente(evento);

        if (typeof ruta !== 'string' || ruta.trim().length === 0 || ruta.length > 1000) {
          throw new Error('La ruta no es válida.');
        }

        const mensaje = await shell.openPath(ruta.trim());

        return mensaje ? { ok: false, error: mensaje } : { ok: true, datos: undefined };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOGO_SELECCIONAR_CARPETA,
    async (evento, rutaInicial: unknown): Promise<ResultadoIpc<string | null>> => {
      try {
        const ventana = validarRemitente(evento);
        const opciones: Electron.OpenDialogOptions = {
          title: 'Seleccionar carpeta',
          buttonLabel: 'Seleccionar carpeta',
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
        };

        if (typeof rutaInicial === 'string' && rutaInicial.trim().length > 0) {
          opciones.defaultPath = rutaInicial.trim();
        }

        const resultado = await dialog.showOpenDialog(ventana, opciones);

        return { ok: true, datos: resultado.canceled ? null : (resultado.filePaths[0] ?? null) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
