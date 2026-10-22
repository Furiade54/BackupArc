import path from 'node:path';
import sql from 'mssql';
import type { RespaldoConfigurado } from '../../shared/types/respaldo.types';
import { parsearBasesDatos } from '../../shared/utils/bases-datos';
import { logger } from '../utils/logger';
import { marcaTiempo, slug } from '../utils/nombres-respaldo';
import { obtenerPool } from './database.service';

function nombreArchivoSeguro(nombre: string): string {
  const limpio = nombre.replace(/[\\/:*?"<>|]/g, '-').trim();

  return limpio.length > 0 ? limpio : 'base';
}

// Ejecuta BACKUP DATABASE para cada base seleccionada en el servidor
// configurado. Los .bak se escriben en el servidor, no en este equipo.
export async function respaldarBasesDatosMssql(
  respaldo: RespaldoConfigurado,
  fecha: Date,
): Promise<string> {
  const bases = parsearBasesDatos(respaldo.origen);
  const destino = respaldo.destino.trim();

  if (bases.length === 0) {
    throw new Error('Selecciona al menos una base de datos para respaldar.');
  }

  if (!destino) {
    throw new Error('Indica la carpeta destino en el servidor SQL.');
  }

  const pool = await obtenerPool();
  const consultaEstados = pool.request();
  const estados = await consultaEstados.query<{ name: string; state_desc: string }>(`
    SELECT name, state_desc
    FROM sys.databases
    WHERE name <> 'tempdb' AND source_database_id IS NULL
  `);
  const estadoPorNombre = new Map(estados.recordset.map((fila) => [fila.name, fila.state_desc]));
  const noDisponibles = bases.filter((base) => estadoPorNombre.get(base) !== 'ONLINE');

  if (noDisponibles.length > 0) {
    throw new Error(
      `Estas bases no existen o no están disponibles en el servidor: ${noDisponibles.join(', ')}.`,
    );
  }

  const rutas: string[] = [];

  for (const baseDatos of bases) {
    const sufijo = respaldo.copiaConFecha
      ? `${slug(respaldo.nombre)}_${marcaTiempo(fecha)}_${nombreArchivoSeguro(baseDatos)}.bak`
      : `${slug(respaldo.nombre)}_${nombreArchivoSeguro(baseDatos)}.bak`;
    const rutaArchivo = path.win32.join(destino, sufijo);
    const identificador = `[${baseDatos.replace(/]/g, ']]')}]`;
    const copia = pool.request();

    // Una copia completa puede tardar más que el timeout normal de consultas.
    // El driver admite desactivarlo por solicitud, aunque sus tipos no lo declaren.
    (copia as sql.Request & { timeout: number }).timeout = 0;

    try {
      await copia
        .input('ruta', sql.NVarChar(4000), rutaArchivo)
        .input('etiqueta', sql.NVarChar(256), `BackupArc: ${respaldo.nombre}`)
        .query(`BACKUP DATABASE ${identificador} TO DISK = @ruta WITH INIT, CHECKSUM, NAME = @etiqueta`);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);

      throw new Error(
        `SQL Server no pudo respaldar "${baseDatos}": ${mensaje} Verifica que la carpeta destino exista en el servidor y que la cuenta del servicio tenga permisos.`,
        { cause: error },
      );
    }

    logger.info(`Copia de la base de datos "${baseDatos}" completada`, rutaArchivo);
    rutas.push(rutaArchivo);
  }

  return rutas.length === 1 ? rutas[0] : `${rutas.length} bases respaldadas en ${destino}`;
}
