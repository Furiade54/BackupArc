import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { ResultadoIpc } from '../../shared/types/api.types';
import type {
  EjecucionRespaldo,
  NuevoRespaldo,
  RespaldoConfigurado,
} from '../../shared/types/respaldo.types';
import {
  actualizarRespaldo,
  crearRespaldo,
  eliminarRespaldo,
  establecerActivoRespaldo,
  listarHistorialRespaldo,
  listarRespaldos,
} from '../repositories/respaldos-local.repository';
import { ejecutarRespaldoAhora } from '../services/respaldo-ejecucion.service';
import { validarRemitente } from './remitente';

const MAX_NOMBRE = 80;
const MAX_RUTA = 500;
const MAX_FRECUENCIA_HORAS = 720;
const MAX_RETENCION_DIAS = 3650;

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validarId(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0) {
    throw new Error('Identificador de copia no válido.');
  }

  return valor;
}

function validarTexto(valor: unknown, campo: string, maximo: number): string {
  if (typeof valor !== 'string') {
    throw new Error(`El campo ${campo} es obligatorio.`);
  }

  const texto = valor.trim();

  if (texto.length === 0 || texto.length > maximo) {
    throw new Error(`El campo ${campo} debe tener entre 1 y ${maximo} caracteres.`);
  }

  return texto;
}

function validarFrecuencia(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > MAX_FRECUENCIA_HORAS) {
    throw new Error(`La frecuencia debe ser un número entero entre 1 y ${MAX_FRECUENCIA_HORAS} horas.`);
  }

  return valor;
}

function validarHora(valor: unknown): string {
  if (typeof valor !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) {
    throw new Error('La hora de ejecución debe tener el formato HH:MM.');
  }

  return valor;
}

function validarRetencion(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > MAX_RETENCION_DIAS) {
    throw new Error(`La retención debe ser un número entero entre 1 y ${MAX_RETENCION_DIAS} días.`);
  }

  return valor;
}

function validarBooleano(valor: unknown, campo: string): boolean {
  if (typeof valor !== 'boolean') {
    throw new Error(`El campo ${campo} debe ser verdadero o falso.`);
  }

  return valor;
}

function validarNuevoRespaldo(datos: unknown): NuevoRespaldo {
  if (typeof datos !== 'object' || datos === null) {
    throw new Error('Los datos de la copia no son válidos.');
  }

  const registro = datos as Record<string, unknown>;

  return {
    nombre: validarTexto(registro.nombre, 'nombre', MAX_NOMBRE),
    origen: validarTexto(registro.origen, 'origen', MAX_RUTA),
    destino: validarTexto(registro.destino, 'destino', MAX_RUTA),
    frecuenciaHoras: validarFrecuencia(registro.frecuenciaHoras),
    horaEjecucion: validarHora(registro.horaEjecucion),
    retencionDias: validarRetencion(registro.retencionDias),
  };
}

export function registrarIpcRespaldos(): void {
  ipcMain.handle(IPC_CHANNELS.RESPALDOS_LISTAR, (evento): ResultadoIpc<RespaldoConfigurado[]> => {
    try {
      validarRemitente(evento);
      return { ok: true, datos: listarRespaldos() };
    } catch (error) {
      return { ok: false, error: mensajeError(error) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_CREAR,
    (evento, datos: unknown): ResultadoIpc<RespaldoConfigurado> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: crearRespaldo(validarNuevoRespaldo(datos)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_ACTUALIZAR,
    (evento, id: unknown, datos: unknown): ResultadoIpc<RespaldoConfigurado> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: actualizarRespaldo(validarId(id), validarNuevoRespaldo(datos)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_EJECUTAR,
    async (evento, id: unknown): Promise<ResultadoIpc<void>> => {
      try {
        validarRemitente(evento);
        await ejecutarRespaldoAhora(validarId(id));
        return { ok: true, datos: undefined };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.RESPALDOS_ELIMINAR, (evento, id: unknown): ResultadoIpc<void> => {
    try {
      validarRemitente(evento);
      eliminarRespaldo(validarId(id));
      return { ok: true, datos: undefined };
    } catch (error) {
      return { ok: false, error: mensajeError(error) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_ESTABLECER_ACTIVO,
    (evento, id: unknown, habilitado: unknown): ResultadoIpc<void> => {
      try {
        validarRemitente(evento);
        establecerActivoRespaldo(validarId(id), validarBooleano(habilitado, 'habilitado'));
        return { ok: true, datos: undefined };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_HISTORIAL,
    (evento, id: unknown): ResultadoIpc<EjecucionRespaldo[]> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: listarHistorialRespaldo(validarId(id)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );
}
