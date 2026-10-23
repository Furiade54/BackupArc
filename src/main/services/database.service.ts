import { safeStorage } from 'electron';
import sql from 'mssql';
import type {
  BaseDatosMssql,
  ConfiguracionMssql,
  EstadoConexion,
  ResultadoPruebaMssql,
  ResumenConfiguracionMssql,
} from '../../shared/types/api.types';
import { logger } from '../utils/logger';
import { pareceServidorRemoto } from '../../shared/utils/servidor-mssql';
import { obtenerPreferenciaConDefecto } from './local-database.service';

const CLAVES = {
  servidor: 'mssql_servidor',
  puerto: 'mssql_puerto',
  baseDatos: 'mssql_base_datos',
  usuario: 'mssql_usuario',
  contrasena: 'mssql_contrasena',
  cifrado: 'mssql_cifrado',
  confiarCertificado: 'mssql_confiar_certificado',
} as const;

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function codificarContrasena(valor: string): string {
  if (!valor) {
    return '';
  }

  return safeStorage.isEncryptionAvailable()
    ? `seguro:${safeStorage.encryptString(valor).toString('base64')}`
    : `base64:${Buffer.from(valor, 'utf8').toString('base64')}`;
}

export function decodificarContrasena(guardado: string): string {
  if (!guardado) {
    return '';
  }

  const separador = guardado.indexOf(':');

  if (separador < 0) {
    return '';
  }

  const tipo = guardado.slice(0, separador);
  const contenido = guardado.slice(separador + 1);

  try {
    if (tipo === 'seguro') {
      return safeStorage.decryptString(Buffer.from(contenido, 'base64'));
    }

    if (tipo === 'base64') {
      return Buffer.from(contenido, 'base64').toString('utf8');
    }
  } catch (error) {
    logger.warn('No se pudo descifrar la contraseña de SQL Server', error);
  }

  return '';
}

// Lee la configuración guardada desde la app; si no existe usa las variables
// DB_* del archivo .env para no romper instalaciones anteriores.
export function leerConfiguracionMssql(): ConfiguracionMssql {
  const servidor = obtenerPreferenciaConDefecto(CLAVES.servidor, process.env.DB_SERVER ?? '');
  const puertoLeido = Number(obtenerPreferenciaConDefecto(CLAVES.puerto, process.env.DB_PORT ?? '1433'));
  const contrasenaGuardada = obtenerPreferenciaConDefecto(CLAVES.contrasena, '');
  const contrasena = contrasenaGuardada
    ? decodificarContrasena(contrasenaGuardada)
    : (process.env.DB_PASSWORD ?? '');

  return {
    servidor,
    puerto: Number.isInteger(puertoLeido) && puertoLeido > 0 ? puertoLeido : 1433,
    baseDatos: obtenerPreferenciaConDefecto(CLAVES.baseDatos, process.env.DB_DATABASE ?? 'master'),
    usuario: obtenerPreferenciaConDefecto(CLAVES.usuario, process.env.DB_USER ?? ''),
    contrasena,
    cifrado:
      obtenerPreferenciaConDefecto(CLAVES.cifrado, process.env.DB_ENCRYPT === 'true' ? '1' : '0') === '1',
    confiarCertificado:
      obtenerPreferenciaConDefecto(
        CLAVES.confiarCertificado,
        process.env.DB_TRUST_CERTIFICATE === 'false' ? '0' : '1',
      ) === '1',
    esRemoto: pareceServidorRemoto(servidor),
  };
}

// La conexión de cada tarea MSSQL se guarda como JSON con la contraseña cifrada.
export function cifrarConexionMssql(datos: ConfiguracionMssql): string {
  return JSON.stringify({
    ...datos,
    servidor: datos.servidor.trim(),
    baseDatos: datos.baseDatos.trim() || 'master',
    usuario: datos.usuario.trim(),
    contrasena: codificarContrasena(datos.contrasena),
  });
}

export function leerConexionMssql(guardado: string | null): ConfiguracionMssql | null {
  if (!guardado) {
    return null;
  }

  try {
    const datos = JSON.parse(guardado) as Partial<Record<keyof ConfiguracionMssql, unknown>>;
    const puertoLeido = typeof datos.puerto === 'number' ? datos.puerto : 1433;
    const baseDatos = typeof datos.baseDatos === 'string' ? datos.baseDatos.trim() : '';
    const servidor = typeof datos.servidor === 'string' ? datos.servidor : '';

    return {
      servidor,
      puerto: Number.isInteger(puertoLeido) && puertoLeido > 0 ? puertoLeido : 1433,
      baseDatos: baseDatos || 'master',
      usuario: typeof datos.usuario === 'string' ? datos.usuario : '',
      contrasena:
        typeof datos.contrasena === 'string' ? decodificarContrasena(datos.contrasena) : '',
      cifrado: datos.cifrado === true,
      confiarCertificado: datos.confiarCertificado !== false,
      // Tareas guardadas antes de este campo: se deduce a partir del host.
      esRemoto:
        typeof datos.esRemoto === 'boolean' ? datos.esRemoto : pareceServidorRemoto(servidor),
    };
  } catch (error) {
    logger.warn('No se pudo leer la conexión MSSQL guardada en la tarea', error);
    return null;
  }
}

export function resumirConexionMssql(guardado: string | null): ResumenConfiguracionMssql | null {
  const datos = leerConexionMssql(guardado);

  if (!datos) {
    return null;
  }

  const { contrasena, ...resto } = datos;

  return { ...resto, tieneContrasena: contrasena.length > 0 };
}

export function estaConfiguracionCompleta(configuracion: ConfiguracionMssql): boolean {
  return (
    configuracion.servidor.trim().length > 0 &&
    configuracion.usuario.trim().length > 0 &&
    configuracion.contrasena.length > 0
  );
}

export function configuracionSqlPara(configuracion: ConfiguracionMssql): sql.config {
  return {
    server: configuracion.servidor,
    database: configuracion.baseDatos || 'master',
    user: configuracion.usuario,
    password: configuracion.contrasena,
    port: configuracion.puerto,
    options: {
      encrypt: configuracion.cifrado,
      trustServerCertificate: configuracion.confiarCertificado,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 8000,
    requestTimeout: 15000,
  };
}

function construirConfiguracion(): sql.config | null {
  const configuracion = leerConfiguracionMssql();

  return estaConfiguracionCompleta(configuracion) ? configuracionSqlPara(configuracion) : null;
}

export async function probarConfiguracionMssql(
  datos: ConfiguracionMssql,
): Promise<ResultadoPruebaMssql> {
  if (!estaConfiguracionCompleta(datos)) {
    return {
      ok: false,
      mensaje: 'Completa el servidor, el usuario y la contraseña para probar la conexión.',
    };
  }

  const pool = new sql.ConnectionPool(configuracionSqlPara(datos));

  try {
    await pool.connect();
    const resultado = await pool.request().query<{ version: string }>('SELECT @@VERSION AS version');

    return {
      ok: true,
      mensaje: 'Conexión establecida correctamente.',
      version: resultado.recordset[0]?.version?.split('\n')[0]?.trim(),
    };
  } catch (error) {
    logger.error('No se pudo probar la conexión con SQL Server', error);

    return { ok: false, mensaje: error instanceof Error ? error.message : String(error) };
  } finally {
    await pool.close().catch(() => undefined);
  }
}

// Temperatura y snapshots no se pueden respaldar con BACKUP DATABASE.
// Sin conexión explícita usa la configuración global (tareas antiguas).
export async function listarBasesDatos(
  conexion?: ConfiguracionMssql | null,
): Promise<BaseDatosMssql[]> {
  if (conexion && !estaConfiguracionCompleta(conexion)) {
    throw new Error('Completa las credenciales de SQL Server para explorar las bases de datos.');
  }

  const pool = conexion
    ? new sql.ConnectionPool(configuracionSqlPara(conexion))
    : await obtenerPool();
  const propio = Boolean(conexion);

  try {
    if (propio) {
      await pool.connect();
    }

    const resultado = await pool.request().query<{ name: string; state_desc: string }>(`
      SELECT name, state_desc
      FROM sys.databases
      WHERE name <> 'tempdb' AND source_database_id IS NULL
      ORDER BY name ASC
    `);

    return resultado.recordset.map((fila) => ({ nombre: fila.name, estado: fila.state_desc }));
  } finally {
    if (propio) {
      await pool.close().catch(() => undefined);
    }
  }
}

export async function obtenerPool(): Promise<sql.ConnectionPool> {
  const configuracion = construirConfiguracion();

  if (!configuracion) {
    throw new Error(
      'La conexión a SQL Server no está configurada. Usa el engranaje del tipo de backup MSSQL para indicar el servidor y las credenciales.',
    );
  }

  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(configuracion).connect().catch((error: unknown) => {
      poolPromise = null;
      throw error;
    });
  }

  return poolPromise;
}

export async function comprobarConexion(): Promise<EstadoConexion> {
  const configuracion = construirConfiguracion();

  if (!configuracion) {
    return {
      configurada: false,
      conectado: false,
      mensaje: 'Configura el servidor y las credenciales de SQL Server para conectar.',
    };
  }

  try {
    const pool = await obtenerPool();
    const resultado = await pool.request().query<{ version: string }>('SELECT @@VERSION AS version');

    return {
      configurada: true,
      conectado: true,
      mensaje: 'Conexión establecida correctamente.',
      servidor: configuracion.server,
      baseDatos: configuracion.database,
      version: resultado.recordset[0]?.version?.split('\n')[0]?.trim(),
    };
  } catch (error) {
    logger.error('No se pudo conectar con SQL Server', error);

    return {
      configurada: true,
      conectado: false,
      mensaje: error instanceof Error ? error.message : String(error),
      servidor: configuracion.server,
      baseDatos: configuracion.database,
    };
  }
}

export async function cerrarConexion(): Promise<void> {
  if (!poolPromise) {
    return;
  }

  const pool = await poolPromise.catch(() => null);
  poolPromise = null;

  if (pool) {
    await pool.close();
  }
}
