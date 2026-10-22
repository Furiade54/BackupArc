import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { ResultadoIpc } from '../../shared/types/api.types';
import type {
  EjecucionRespaldo,
  NuevoRespaldo,
  RespaldoConfigurado,
  TipoRespaldo,
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
const MAX_BASES_DATOS = 100;
const MAX_NOMBRE_BASE = 128;
const MAX_FRECUENCIA_MINUTOS = 43_200;
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
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > MAX_FRECUENCIA_MINUTOS) {
    throw new Error(
      `La frecuencia debe ser un número entero de minutos entre 1 y ${MAX_FRECUENCIA_MINUTOS} (30 días).`,
    );
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

function validarTipo(valor: unknown): TipoRespaldo {
  if (valor !== 'archivos' && valor !== 'mssql') {
    throw new Error('El tipo de copia debe ser "archivos" o "mssql".');
  }

  return valor;
}

// Las tareas MSSQL guardan en "origen" un arreglo JSON con las bases elegidas.
function validarBasesDatos(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 8000) {
    throw new Error('La lista de bases de datos no es válida.');
  }

  let bases: unknown;

  try {
    bases = JSON.parse(valor);
  } catch (error) {
    throw new Error('La lista de bases de datos no es válida.', { cause: error });
  }

  if (!Array.isArray(bases) || bases.length === 0 || bases.length > MAX_BASES_DATOS) {
    throw new Error(`Selecciona entre 1 y ${MAX_BASES_DATOS} bases de datos.`);
  }

  const nombres = bases.map((base) => {
    if (typeof base !== 'string') {
      throw new Error('La lista de bases de datos no es válida.');
    }

    const nombre = base.trim();

    if (nombre.length === 0 || nombre.length > MAX_NOMBRE_BASE) {
      throw new Error(
        `Cada base de datos debe tener entre 1 y ${MAX_NOMBRE_BASE} caracteres.`,
      );
    }

    return nombre;
  });

  return JSON.stringify(Array.from(new Set(nombres)));
}

function validarNuevoRespaldo(datos: unknown): NuevoRespaldo {
  if (typeof datos !== 'object' || datos === null) {
    throw new Error('Los datos de la copia no son válidos.');
  }

  const registro = datos as Record<string, unknown>;
  const tipo = validarTipo(registro.tipo);

  return {
    nombre: validarTexto(registro.nombre, 'nombre', MAX_NOMBRE),
    tipo,
    origen:
      tipo === 'mssql'
        ? validarBasesDatos(registro.origen)
        : validarTexto(registro.origen, 'origen', MAX_RUTA),
    destino: validarTexto(registro.destino, 'destino', MAX_RUTA),
    frecuenciaMinutos: validarFrecuencia(registro.frecuenciaMinutos),
    horaEjecucion: validarHora(registro.horaEjecucion),
    retencionDias: validarRetencion(registro.retencionDias),
    copiaConFecha: validarBooleano(registro.copiaConFecha, 'copiaConFecha'),
    // Un respaldo de base de datos ya se entrega como .bak en el servidor.
    comprimir: tipo === 'mssql' ? false : validarBooleano(registro.comprimir, 'comprimir'),
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
