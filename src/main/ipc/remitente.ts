import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

export function validarRemitente(evento: IpcMainInvokeEvent): BrowserWindow {
  const ventana = BrowserWindow.fromWebContents(evento.sender);

  if (!ventana || ventana.isDestroyed()) {
    throw new Error('Solicitud IPC sin una ventana válida.');
  }

  const url = evento.senderFrame?.url ?? '';
  const origenPermitido = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : url.startsWith('file://');

  if (!origenPermitido) {
    throw new Error('Origen no autorizado para operar sobre la ventana.');
  }

  return ventana;
}
