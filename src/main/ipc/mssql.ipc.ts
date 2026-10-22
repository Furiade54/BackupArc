import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type {
  BaseDatosMssql,
  ConfiguracionMssql,
  ResultadoIpc,
  ResultadoPruebaMssql,
  ResumenConfiguracionMssql,
} from '../../shared/types/api.types';
import {
  guardarConfiguracionMssql,
  listarBasesDatos,
  obtenerResumenConfiguracionMssql,
  probarConfiguracionMssql,
} from '../services/database.service';
import { validarRemitente } from './remitente';

const MAX_TEXTO = 200;

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validarTexto(valor: unknown, campo: string, maximo: number): string {
  if (typeof valor !== 'string') {
    throw new Error(`El campo ${campo} es obligatorio.`);
  }

  const texto = valor.trim();

  if (texto.length > maximo) {
    throw new Error(`El campo ${campo} no puede superar ${maximo} caracteres.`);
  }

  return texto;
}

function validarConfiguracion(datos: unknown): ConfiguracionMssql {
  if (typeof datos !== 'object' || datos === null) {
    throw new Error('Los datos de conexión no son válidos.');
  }

  const registro = datos as Record<string, unknown>;
  const servidor = validarTexto(registro.servidor, 'servidor', MAX_TEXTO);
  const usuario = validarTexto(registro.usuario, 'usuario', MAX_TEXTO);

  if (!servidor) {
    throw new Error('El servidor es obligatorio.');
  }

  if (!usuario) {
    throw new Error('El usuario es obligatorio.');
  }

  const puerto = registro.puerto;

  if (typeof puerto !== 'number' || !Number.isInteger(puerto) || puerto < 1 || puerto > 65_535) {
    throw new Error('El puerto debe ser un número entero entre 1 y 65535.');
  }

  if (typeof registro.contrasena !== 'string' || registro.contrasena.length > 500) {
    throw new Error('La contraseña no es válida.');
  }

  if (typeof registro.cifrado !== 'boolean') {
    throw new Error('El cifrado de la conexión debe ser verdadero o falso.');
  }

  if (typeof registro.confiarCertificado !== 'boolean') {
    throw new Error('La confianza del certificado debe ser verdadera o falsa.');
  }

  return {
    servidor,
    puerto,
    baseDatos: validarTexto(registro.baseDatos, 'base de datos', 128) || 'master',
    usuario,
    contrasena: registro.contrasena,
    cifrado: registro.cifrado,
    confiarCertificado: registro.confiarCertificado,
  };
}

export function registrarIpcMssql(): void {
  ipcMain.handle(IPC_CHANNELS.MSSQL_OBTENER, (evento): ResultadoIpc<ResumenConfiguracionMssql> => {
    try {
      validarRemitente(evento);
      return { ok: true, datos: obtenerResumenConfiguracionMssql() };
    } catch (error) {
      return { ok: false, error: mensajeError(error) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.MSSQL_GUARDAR,
    async (evento, datos: unknown): Promise<ResultadoIpc<ResumenConfiguracionMssql>> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: await guardarConfiguracionMssql(validarConfiguracion(datos)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MSSQL_BASES_DATOS,
    async (evento): Promise<ResultadoIpc<BaseDatosMssql[]>> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: await listarBasesDatos() };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MSSQL_PROBAR,
    async (evento, datos: unknown): Promise<ResultadoIpc<ResultadoPruebaMssql>> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: await probarConfiguracionMssql(validarConfiguracion(datos)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );
}
