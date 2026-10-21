import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { ResultadoIpc } from '../../shared/types/api.types';
import { guardarPreferencia, obtenerPreferencia } from '../services/local-database.service';
import { validarRemitente } from './remitente';

const MAX_LONGITUD_CLAVE = 120;
const MAX_LONGITUD_VALOR = 10000;

function validarClave(clave: unknown): string {
  if (typeof clave !== 'string' || clave.trim().length === 0 || clave.length > MAX_LONGITUD_CLAVE) {
    throw new Error('Clave de preferencia no válida.');
  }

  return clave;
}

function validarValor(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length > MAX_LONGITUD_VALOR) {
    throw new Error('Valor de preferencia no válido.');
  }

  return valor;
}

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registrarIpcPreferencias(): void {
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCIAS_OBTENER,
    (evento, clave: unknown): ResultadoIpc<string | null> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: obtenerPreferencia(validarClave(clave)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PREFERENCIAS_GUARDAR,
    (evento, clave: unknown, valor: unknown): ResultadoIpc<void> => {
      try {
        validarRemitente(evento);
        guardarPreferencia(validarClave(clave), validarValor(valor));
        return { ok: true, datos: undefined };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );
}
