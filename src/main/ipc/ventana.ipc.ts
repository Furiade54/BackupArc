import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { EstadoVentana } from '../../shared/types/api.types';
import { validarRemitente } from './remitente';

export function registrarIpcVentana(): void {
  ipcMain.handle(IPC_CHANNELS.VENTANA_MINIMIZAR, (evento) => {
    validarRemitente(evento).minimize();
  });

  ipcMain.handle(IPC_CHANNELS.VENTANA_ALTERNAR_MAXIMIZADO, (evento) => {
    const ventana = validarRemitente(evento);

    if (ventana.isMaximized()) {
      ventana.unmaximize();
    } else {
      ventana.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.VENTANA_CERRAR, (evento) => {
    validarRemitente(evento).close();
  });

  ipcMain.handle(IPC_CHANNELS.VENTANA_ESTADO, (evento): EstadoVentana => ({
    maximizada: validarRemitente(evento).isMaximized(),
  }));
}
