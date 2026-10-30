import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { ResultadoIpc } from '../../shared/types/api.types';
import { esBaseDeSistema } from '../../shared/utils/bases-datos';
import type {
  ConexionMssql,
  EjecucionRespaldo,
  EjecucionesRegistradasInforme,
  FiltroInformeBak,
  InformeBak,
  InformeGlobalBak,
  InventarioBak,
  ModoRespaldoMssql,
  NuevoRespaldo,
  RespaldoConfigurado,
  TipoRespaldo,
} from '../../shared/types/respaldo.types';
import {
  actualizarRespaldo,
  consultarEjecucionesRegistradas,
  crearRespaldo,
  eliminarRespaldo,
  establecerActivoRespaldo,
  limpiarHistorialRespaldo,
  listarHistorialRespaldo,
  listarRespaldos,
  obtenerRespaldo,
} from '../repositories/respaldos-local.repository';
import { ejecutarRespaldoAhora } from '../services/respaldo-ejecucion.service';
import {
  consultarArchivosBak,
  consultarInformeGlobalBak,
  inventariarArchivosBak,
} from '../services/respaldo-mssql.service';
import { validarRemitente } from './remitente';

const MAX_NOMBRE = 80;
const MAX_RUTA = 500;
const MAX_BASES_DATOS = 100;
const MAX_NOMBRE_BASE = 128;
const MAX_FRECUENCIA_MINUTOS = 43_200;
const MAX_RETENCION_DIAS = 3650;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS_INFORME = 366;
const MAX_TEXTO_INFORME = 200;

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

function validarFechaInforme(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !PATRON_FECHA.test(valor)) {
    throw new Error(`La fecha ${campo} debe tener el formato aaaa-MM-dd.`);
  }

  const fecha = new Date(`${valor}T00:00:00Z`);

  // El ida y vuelta descarta fechas inexistentes, como 2026-02-30.
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    throw new Error(`La fecha ${campo} no existe en el calendario.`);
  }

  return valor;
}

function validarFiltroInforme(valor: unknown): FiltroInformeBak {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error('El filtro del informe no es válido.');
  }

  const registro = valor as Record<string, unknown>;
  const desde = validarFechaInforme(registro.desde, 'inicial');
  const hasta = validarFechaInforme(registro.hasta, 'final');

  if (desde > hasta) {
    throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  }

  const dias =
    Math.floor(
      (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000,
    ) + 1;

  if (dias > MAX_DIAS_INFORME) {
    throw new Error(`El rango del informe no puede superar ${MAX_DIAS_INFORME} días.`);
  }

  const baseDatos =
    registro.baseDatos == null || registro.baseDatos === ''
      ? null
      : validarTexto(registro.baseDatos, 'base de datos', MAX_NOMBRE_BASE);

  const texto =
    registro.texto == null || registro.texto === ''
      ? null
      : validarTexto(registro.texto, 'texto a buscar', MAX_TEXTO_INFORME);

  return { desde, hasta, baseDatos, texto };
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

function validarModoMssql(valor: unknown): ModoRespaldoMssql {
  // Compatibilidad con formularios anteriores a los backups diferenciales.
  if (valor === undefined || valor === null) {
    return 'completo';
  }

  if (valor !== 'completo' && valor !== 'diferencial') {
    throw new Error('El modo de backup MSSQL debe ser "completo" o "diferencial".');
  }

  return valor;
}

function validarFullCadaDias(valor: unknown): number {
  if (valor === undefined || valor === null) {
    return 7;
  }

  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > 365) {
    throw new Error('La antigüedad máxima del full debe ser un entero entre 1 y 365 días.');
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

  // Las bases del sistema no se respaldan como tareas programadas.
  const usuario = nombres.filter((nombre) => !esBaseDeSistema(nombre));

  if (usuario.length === 0) {
    throw new Error('Selecciona al menos una base de datos de usuario.');
  }

  return JSON.stringify(Array.from(new Set(usuario)));
}

function validarConexionMssql(valor: unknown): ConexionMssql | null {
  if (valor === null || valor === undefined) {
    return null;
  }

  if (typeof valor !== 'object') {
    throw new Error('La configuración de SQL Server no es válida.');
  }

  const registro = valor as Record<string, unknown>;
  const servidor = validarTexto(registro.servidor, 'servidor', 200);
  const usuario = validarTexto(registro.usuario, 'usuario', 200);
  const puerto = registro.puerto;

  if (!servidor) {
    throw new Error('El servidor de SQL Server es obligatorio.');
  }

  if (!usuario) {
    throw new Error('El usuario de SQL Server es obligatorio.');
  }

  if (typeof puerto !== 'number' || !Number.isInteger(puerto) || puerto < 1 || puerto > 65_535) {
    throw new Error('El puerto debe ser un número entero entre 1 y 65535.');
  }

  if (typeof registro.contrasena !== 'string' || registro.contrasena.length > 500) {
    throw new Error('La contraseña de SQL Server no es válida.');
  }

  if (typeof registro.cifrado !== 'boolean' || typeof registro.confiarCertificado !== 'boolean') {
    throw new Error('Las opciones de conexión de SQL Server no son válidas.');
  }

  if (typeof registro.esRemoto !== 'boolean') {
    throw new Error('Indica si el servidor SQL es remoto o local.');
  }

  return {
    servidor,
    puerto,
    baseDatos: validarTexto(registro.baseDatos, 'base de datos', 128) || 'master',
    usuario,
    contrasena: registro.contrasena,
    cifrado: registro.cifrado,
    confiarCertificado: registro.confiarCertificado,
    esRemoto: registro.esRemoto,
  };
}

function validarNuevoRespaldo(datos: unknown): NuevoRespaldo {
  if (typeof datos !== 'object' || datos === null) {
    throw new Error('Los datos de la copia no son válidos.');
  }

  const registro = datos as Record<string, unknown>;
  const tipo = validarTipo(registro.tipo);
  const conexionMssql = validarConexionMssql(registro.conexionMssql);

  if (tipo === 'mssql' && !conexionMssql) {
    throw new Error('Configura las credenciales de SQL Server para esta tarea.');
  }

  return {
    nombre: validarTexto(registro.nombre, 'nombre', MAX_NOMBRE),
    tipo,
    origen:
      tipo === 'mssql'
        ? validarBasesDatos(registro.origen)
        : validarTexto(registro.origen, 'origen', MAX_RUTA),
    // Solo MSSQL: respalda todas las bases de usuario ONLINE en cada ejecución.
    todasLasBases:
      tipo === 'mssql' && registro.todasLasBases !== undefined
        ? validarBooleano(registro.todasLasBases, 'todasLasBases')
        : false,
    conexionMssql: tipo === 'mssql' ? conexionMssql : null,
    destino: validarTexto(registro.destino, 'destino', MAX_RUTA),
    frecuenciaMinutos: validarFrecuencia(registro.frecuenciaMinutos),
    horaEjecucion: validarHora(registro.horaEjecucion),
    retencionDias: validarRetencion(registro.retencionDias),
    copiaConFecha: validarBooleano(registro.copiaConFecha, 'copiaConFecha'),
    // Las tareas anteriores no enviaban este campo: se conserva el nombre único.
    identificadorUnico:
      tipo === 'mssql' && registro.identificadorUnico !== undefined
        ? validarBooleano(registro.identificadorUnico, 'identificadorUnico')
        : true,
    // Un respaldo de base de datos ya se entrega como .bak en el servidor.
    comprimir: tipo === 'mssql' ? false : validarBooleano(registro.comprimir, 'comprimir'),
    modoMssql: tipo === 'mssql' ? validarModoMssql(registro.modoMssql) : 'completo',
    fullCadaDias: tipo === 'mssql' ? validarFullCadaDias(registro.fullCadaDias) : 7,
    // Compatibilidad: las tareas anteriores no enviaban estas opciones.
    comprimirBak:
      tipo === 'mssql' && registro.comprimirBak !== undefined
        ? validarBooleano(registro.comprimirBak, 'comprimirBak')
        : false,
    verificarBak:
      tipo === 'mssql' && registro.verificarBak !== undefined
        ? validarBooleano(registro.verificarBak, 'verificarBak')
        : false,
    // Copia temporal: solo aplica a MSSQL. Las tareas antiguas no la envían.
    usarCopiaTemporal:
      tipo === 'mssql' && registro.usarCopiaTemporal !== undefined
        ? validarBooleano(registro.usarCopiaTemporal, 'usarCopiaTemporal')
        : false,
    carpetaTemporal:
      tipo === 'mssql' && registro.carpetaTemporal
        ? validarTexto(registro.carpetaTemporal, 'carpeta temporal', MAX_RUTA)
        : '',
    carpetaTemporalLectura:
      tipo === 'mssql' && registro.carpetaTemporalLectura
        ? validarTexto(registro.carpetaTemporalLectura, 'ruta de lectura de la carpeta temporal', MAX_RUTA)
        : '',
    // Carpeta exclusiva del .zip: opcional, vacía = junto al .bak.
    carpetaZip:
      tipo === 'mssql' && registro.carpetaZip
        ? validarTexto(registro.carpetaZip, 'carpeta del .zip', MAX_RUTA)
        : '',
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

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_LIMPIAR_HISTORIAL,
    (evento, id: unknown): ResultadoIpc<number> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: limpiarHistorialRespaldo(validarId(id)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_INVENTARIO_BAK,
    async (evento, id: unknown): Promise<ResultadoIpc<InventarioBak>> => {
      try {
        validarRemitente(evento);
        const respaldo = obtenerRespaldo(validarId(id));

        if (!respaldo) {
          throw new Error('La copia indicada no existe.');
        }

        if (respaldo.tipo !== 'mssql') {
          throw new Error('El inventario de .bak solo aplica a tareas MSSQL.');
        }

        return { ok: true, datos: await inventariarArchivosBak(respaldo) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_INFORME_BAK,
    async (evento, id: unknown, filtro: unknown): Promise<ResultadoIpc<InformeBak>> => {
      try {
        validarRemitente(evento);
        const respaldo = obtenerRespaldo(validarId(id));

        if (!respaldo) {
          throw new Error('La copia indicada no existe.');
        }

        if (respaldo.tipo !== 'mssql') {
          throw new Error('El informe de .bak solo aplica a tareas MSSQL.');
        }

        return { ok: true, datos: await consultarArchivosBak(respaldo, validarFiltroInforme(filtro)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_INFORME_GLOBAL,
    async (evento, filtro: unknown): Promise<ResultadoIpc<InformeGlobalBak>> => {
      try {
        validarRemitente(evento);
        return { ok: true, datos: await consultarInformeGlobalBak(validarFiltroInforme(filtro)) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );

  // Resumen liviano para el panel: sale de la base local y no consulta SQL Server.
  ipcMain.handle(
    IPC_CHANNELS.RESPALDOS_RESUMEN_EJECUCIONES,
    async (evento, filtro: unknown): Promise<ResultadoIpc<EjecucionesRegistradasInforme>> => {
      try {
        validarRemitente(evento);
        const rango = validarFiltroInforme(filtro);
        return { ok: true, datos: consultarEjecucionesRegistradas(rango.desde, rango.hasta) };
      } catch (error) {
        return { ok: false, error: mensajeError(error) };
      }
    },
  );
}
