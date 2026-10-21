import sql from 'mssql';
import type { EstadoConexion } from '../../shared/types/api.types';
import { logger } from '../utils/logger';

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function construirConfiguracion(): sql.config | null {
  const servidor = process.env.DB_SERVER;
  const baseDatos = process.env.DB_DATABASE;
  const usuario = process.env.DB_USER;
  const contrasena = process.env.DB_PASSWORD;

  if (!servidor || !baseDatos || !usuario || !contrasena) {
    return null;
  }

  return {
    server: servidor,
    database: baseDatos,
    user: usuario,
    password: contrasena,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: true,
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

export function estaConfigurada(): boolean {
  return construirConfiguracion() !== null;
}

export async function obtenerPool(): Promise<sql.ConnectionPool> {
  const configuracion = construirConfiguracion();

  if (!configuracion) {
    throw new Error('La conexión a SQL Server no está configurada. Completa las variables DB_* en el archivo .env.');
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
      mensaje: 'Configura las variables DB_* en el archivo .env para conectar con SQL Server.',
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
