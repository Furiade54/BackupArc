import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { ZipArchive, type ArchiverError } from 'archiver';
import { app } from 'electron';
import sql from 'mssql';
import type {
  ArchivoBakInforme,
  ArchivoBakInformeGlobal,
  ArchivoBakInventario,
  CompresionBak,
  FiltroInformeBak,
  InformeBak,
  InformeGlobalBak,
  InventarioBak,
  NuevoResultadoBaseRespaldo,
  RespaldoConfigurado,
  ResumenArchivosInforme,
  TareaInformeGlobal,
  TipoEjecutadoMssql,
} from '../../shared/types/respaldo.types';
import { esBaseDeSistema, parsearBasesDatos } from '../../shared/utils/bases-datos';
import {
  listarRespaldos,
  obtenerConexionMssqlRespaldo,
  consultarEjecucionesArchivos,
  consultarResumenZip,
} from '../repositories/respaldos-local.repository';
import { logger } from '../utils/logger';
import { marcaTiempo } from '../utils/nombres-respaldo';
import {
  configuracionSqlPara,
  estaConfiguracionCompleta,
  leerConfiguracionMssql,
} from './database.service';

export interface ResultadoRespaldoMssql {
  resultados: NuevoResultadoBaseRespaldo[];
  /** 'completo', 'diferencial' o 'mixto' según lo que realmente se ejecutó. */
  tipoResumen: 'completo' | 'diferencial' | 'mixto';
}

interface FullRegistrado {
  backupSetId: number;
  backupSetUuid: string | null;
  firstLsn: string | null;
  lastLsn: string | null;
  checkpointLsn: string | null;
  databaseBackupLsn: string | null;
  fecha: string;
  antiguedadMinutos: number | null;
  familyCount: number;
  archivos: string[];
}

interface FilaCabecera {
  DatabaseName: string;
  BackupType: number;
  FirstLSN: string | number;
  LastLSN: string | number;
  DatabaseBackupLSN: string | number;
  BackupSetGUID: string | null;
}

interface FilaDiferencial {
  guid: string | null;
  base_lsn: string | null;
  type: string;
}

const MINUTOS_POR_DIA = 1_440;

interface ErrorSql {
  numero: number | null;
  mensaje: string;
}

interface FilaCabeceraBackup {
  DatabaseName?: string;
  BackupType?: number;
  Compressed?: number | boolean | null;
  BackupSize?: number | null;
  BackupFinishDate?: string | Date;
}

// SQL Server reporta varios errores encadenados (por ejemplo 3097 seguido del
// genérico 3041). Se recorren todos para no perder la causa real.
function erroresSqlDe(error: unknown): ErrorSql[] {
  const lista: ErrorSql[] = [];
  const visitados = new Set<unknown>();

  const visitar = (valor: unknown): void => {
    if (typeof valor !== 'object' || valor === null || visitados.has(valor)) {
      return;
    }

    visitados.add(valor);
    const registro = valor as Record<string, unknown>;
    const numero =
      typeof registro.number === 'number'
        ? registro.number
        : typeof registro.code === 'string' && /^\d+$/.test(registro.code)
          ? Number(registro.code)
          : null;

    if (typeof registro.message === 'string' && registro.message.length > 0) {
      lista.push({ numero, mensaje: registro.message });
    }

    for (const clave of ['precedingErrors', 'previousErrors', 'originalError', 'errors']) {
      const hijo = registro[clave];

      if (Array.isArray(hijo)) {
        hijo.forEach(visitar);
      } else if (hijo) {
        visitar(hijo);
      }
    }
  };

  visitar(error);
  return lista;
}

function mensajeErrorSql(error: unknown): string {
  const errores = erroresSqlDe(error);

  if (errores.length === 0) {
    return error instanceof Error ? error.message : String(error);
  }

  return errores
    .map((registro) =>
      registro.numero === null ? registro.mensaje : `[${registro.numero}] ${registro.mensaje}`,
    )
    .join(' → ');
}

function nombreArchivoSeguro(nombre: string): string {
  const limpio = nombre.replace(/[\\/:*?"<>|]/g, '-').trim();

  return limpio.length > 0 ? limpio : 'base';
}

// Identificador corto por ejecución: evita que dos tareas o dos ejecuciones
// simultáneas escriban en la misma ruta.
export function crearRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function lsnNumerico(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) {
    return null;
  }

  const numero = typeof valor === 'number' ? valor : Number(valor);

  return Number.isFinite(numero) ? numero : null;
}

function lsnCoincide(a: string | number | null, b: string | number | null): boolean {
  const primero = lsnNumerico(a);
  const segundo = lsnNumerico(b);

  if (primero === null || segundo === null) {
    return false;
  }

  return primero === segundo;
}

interface FilaErrorLog {
  LogDate: string | Date;
  ProcessInfo: string | null;
  Text: string;
}

// El driver no siempre entrega el mensaje previo al 3013 (por ejemplo el
// "Operating system error 5"). Se consulta el ERRORLOG del servidor para
// recuperar la línea que menciona el archivo concreto.
async function leerErroresRelacionados(
  pool: sql.ConnectionPool,
  ruta: string,
): Promise<string | null> {
  try {
    const nombre = path.win32.basename(ruta);
    const resultado = await pool
      .request()
      .input('nombre', sql.NVarChar(400), `%${nombre}%`)
      .query<FilaErrorLog>(`
        CREATE TABLE #log_backuparc (
          LogDate datetime,
          ProcessInfo nvarchar(100),
          Text nvarchar(4000)
        );

        INSERT INTO #log_backuparc
        EXEC master.dbo.xp_readerrorlog 0, 1;

        SELECT TOP 20 LogDate, ProcessInfo, Text
        FROM #log_backuparc
        WHERE LogDate >= DATEADD(hour, -2, GETDATE())
          AND (
            Text LIKE @nombre
            OR Text LIKE '%Operating system error%'
            OR Text LIKE '%error del sistema operativo%'
            OR Text LIKE '%BACKUP failed%'
            OR Text LIKE '%BACKUP DATABASE%'
            OR Text LIKE '%RESTORE HEADERONLY%'
          )
        ORDER BY LogDate DESC;

        DROP TABLE #log_backuparc;
      `);

    const filas = resultado.recordset ?? [];
    const relacionada = filas.find((fila) => fila.Text.includes(nombre));
    const conErrorSo = filas.find((fila) =>
      /Operating system error|error del sistema operativo/i.test(fila.Text),
    );

    return (relacionada ?? conErrorSo)?.Text.trim() ?? null;
  } catch (error) {
    logger.warn('No se pudo leer el ERRORLOG de SQL Server', error);
    return null;
  }
}

// Deja en el log quién es el servidor y con qué cuenta escribe, para poder
// distinguir "otra máquina" de "permisos" cuando falla la carpeta destino.
async function registrarIdentidadServidor(pool: sql.ConnectionPool): Promise<void> {
  try {
    const resultado = await pool.request().query<{
      servidor: string | null;
      equipo: string | null;
      instancia: string | null;
    }>(`
      SELECT
        CONVERT(varchar(128), SERVERPROPERTY('ServerName')) AS servidor,
        CONVERT(varchar(128), SERVERPROPERTY('MachineName')) AS equipo,
        CONVERT(varchar(128), SERVERPROPERTY('InstanceName')) AS instancia
    `);
    const fila = resultado.recordset[0];
    let cuentaServicio: string | null = null;

    try {
      const servicios = await pool.request().query<{ cuenta: string | null }>(`
        SELECT TOP 1 service_account AS cuenta
        FROM sys.dm_server_services
        WHERE servicename LIKE 'SQL Server (%'
      `);
      cuentaServicio = servicios.recordset[0]?.cuenta ?? null;
    } catch {
      // Sin VIEW SERVER STATE no se puede leer la cuenta: se omite.
    }

    logger.info('Servidor SQL de la tarea', {
      servidor: fila?.servidor ?? null,
      equipo: fila?.equipo ?? null,
      instancia: fila?.instancia ?? null,
      cuentaServicio,
    });
  } catch (error) {
    logger.warn('No se pudo leer la identidad del servidor SQL', error);
  }
}

interface DiagnosticoCarpeta {
  accesible: boolean | null;
  detalle: string | null;
}

// Lee la cabecera de un archivo inexistente en la carpeta destino. No crea
// nada: si la carpeta es accesible, SQL responde "sistema operativo 2"
// (archivo no encontrado); si no, devuelve el error real (3 ruta, 5 permisos).
async function probarCarpetaDestino(
  pool: sql.ConnectionPool,
  destino: string,
  runId: string,
): Promise<DiagnosticoCarpeta> {
  const ruta = path.win32.join(destino, `__backuparc_probe_${runId}.bak`);

  try {
    await pool
      .request()
      .input('ruta', sql.NVarChar(4000), ruta)
      .query('RESTORE HEADERONLY FROM DISK = @ruta');

    return { accesible: true, detalle: null };
  } catch (error) {
    const mensaje = mensajeErrorSql(error);
    const extra = await leerErroresRelacionados(pool, ruta);
    const combinado = extra ? `${mensaje} → ERRORLOG: ${extra}` : mensaje;

    // Error 2 (archivo no encontrado) significa que la carpeta sí responde:
    // SQL pudo resolver la ruta y solo echó en falta el archivo de prueba.
    if (/error(?:\s+del\s+sistema\s+operativo)?\s*2\b/i.test(combinado)) {
      return { accesible: true, detalle: null };
    }

    return { accesible: false, detalle: combinado };
  }
}

// Carpeta de backup predeterminada de la propia instancia (SQL Server 2012+).
async function carpetaBackupPredeterminada(pool: sql.ConnectionPool): Promise<string | null> {
  try {
    const resultado = await pool.request().query<{ ruta: string | null }>(`
      SELECT CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultBackupPath')) AS ruta
    `);

    return resultado.recordset[0]?.ruta?.trim() || null;
  } catch (error) {
    logger.warn('No se pudo leer la carpeta de backup predeterminada del servidor SQL', error);
    return null;
  }
}

// Carpeta temporal: la que indique el usuario o, por defecto, la carpeta de
// backup propia de la instancia. La temporal del sistema es el último recurso.
async function resolverCarpetaTemporal(
  pool: sql.ConnectionPool,
  respaldo: RespaldoConfigurado,
): Promise<string> {
  const propia = respaldo.carpetaTemporal.trim();

  if (propia) {
    return propia;
  }

  const predeterminada = await carpetaBackupPredeterminada(pool);

  if (predeterminada) {
    logger.info('Carpeta temporal por defecto del servidor SQL', predeterminada);
    return predeterminada;
  }

  const sistema = app.getPath('temp');
  logger.warn(`La instancia no informó su carpeta de backup; se usa la temporal del equipo: ${sistema}`);
  return sistema;
}

// La cabecera del archivo es la fuente de verdad para tamaño y compresión.
async function leerCabecera(
  pool: sql.ConnectionPool,
  archivo: string,
): Promise<FilaCabeceraBackup | null> {
  try {
    const resultado = await pool
      .request()
      .input('ruta', sql.NVarChar(4000), archivo)
      .query<FilaCabeceraBackup>('RESTORE HEADERONLY FROM DISK = @ruta');

    return resultado.recordset[0] ?? null;
  } catch (error) {
    logger.warn(`No se pudo leer la cabecera del backup ${archivo}`, error);
    return null;
  }
}

function compresionDesdeCabecera(
  cabecera: FilaCabeceraBackup | null,
  seSolicito: boolean,
): CompresionBak {
  const valor = cabecera?.Compressed;

  if (valor === 1 || valor === true) {
    return 'aplicada';
  }

  if (valor === 0 || valor === false) {
    return 'no aplicada';
  }

  return seSolicito ? 'desconocido' : 'no aplicada';
}

// Último full (no copy-only) del que SQL Server tomaría la base diferencial.
async function ultimoFull(pool: sql.ConnectionPool, baseDatos: string): Promise<FullRegistrado | null> {
  const resultado = await pool
    .request()
    .input('base', sql.NVarChar(128), baseDatos)
    .query<{
      id: number;
      uuid: string | null;
      first_lsn: string | null;
      last_lsn: string | null;
      checkpoint_lsn: string | null;
      database_backup_lsn: string | null;
      fecha: string;
      antiguedad_minutos: number | null;
    }>(`
      SELECT TOP 1
        bs.backup_set_id AS id,
        CONVERT(varchar(36), bs.backup_set_uuid) AS uuid,
        CONVERT(varchar(25), bs.first_lsn) AS first_lsn,
        CONVERT(varchar(25), bs.last_lsn) AS last_lsn,
        CONVERT(varchar(25), bs.checkpoint_lsn) AS checkpoint_lsn,
        CONVERT(varchar(25), bs.database_backup_lsn) AS database_backup_lsn,
        CONVERT(varchar(33), bs.backup_finish_date, 126) AS fecha,
        -- La antigüedad se calcula en el servidor: así no influye el huso
        -- horario del equipo donde corre la aplicación.
        DATEDIFF(minute, bs.backup_finish_date, GETDATE()) AS antiguedad_minutos
      FROM msdb.dbo.backupset bs
      WHERE bs.database_name = @base
        AND bs.type = 'D'
        AND bs.is_copy_only = 0
        AND bs.is_snapshot = 0
      ORDER BY bs.backup_finish_date DESC, bs.backup_set_id DESC
    `);

  const fila = resultado.recordset[0];

  if (!fila) {
    return null;
  }

  const archivos = await pool
    .request()
    .input('id', sql.Int, fila.id)
    .query<{ archivo: string }>(`
      SELECT mf.physical_device_name AS archivo
      FROM msdb.dbo.backupmediafamily mf
      JOIN msdb.dbo.backupset bs ON bs.media_set_id = mf.media_set_id
      WHERE bs.backup_set_id = @id
    `);

  return {
    backupSetId: fila.id,
    backupSetUuid: fila.uuid,
    firstLsn: fila.first_lsn,
    lastLsn: fila.last_lsn,
    checkpointLsn: fila.checkpoint_lsn,
    databaseBackupLsn: fila.database_backup_lsn,
    fecha: fila.fecha,
    antiguedadMinutos: fila.antiguedad_minutos,
    // El nº de familias se deduce de las filas reales del media set, para no
    // depender de columnas opcionales según la versión de msdb.
    familyCount: archivos.recordset.length,
    archivos: archivos.recordset.map((registro) => registro.archivo).filter(Boolean),
  };
}

// Comprueba que el archivo del full exista, sea legible y corresponda al
// registro de msdb. Devuelve el motivo cuando no se puede demostrar.
async function validarArchivoFull(
  pool: sql.ConnectionPool,
  baseDatos: string,
  full: FullRegistrado,
): Promise<string | null> {
  if (full.familyCount !== 1 || full.archivos.length !== 1) {
    return 'el full usa varios archivos y no se pueden validar todos';
  }

  try {
    const cabecera = await pool
      .request()
      .input('ruta', sql.NVarChar(4000), full.archivos[0])
      .query<FilaCabecera>('RESTORE HEADERONLY FROM DISK = @ruta');

    const fila = cabecera.recordset[0];

    if (!fila) {
      return 'no se pudo leer la cabecera del full';
    }

    if (fila.DatabaseName !== baseDatos) {
      return 'el archivo pertenece a otra base de datos';
    }

    if (Number(fila.BackupType) !== 1) {
      return 'el archivo no es un backup completo';
    }

    // El GUID del backup set identifica el archivo de forma inequívoca y no
    // depende del huso horario, a diferencia de la fecha de finalización.
    const guidArchivo = fila.BackupSetGUID?.toLowerCase() ?? null;
    const guidMsdb = full.backupSetUuid?.toLowerCase() ?? null;

    if (guidArchivo && guidMsdb && guidArchivo !== guidMsdb) {
      return 'el archivo no corresponde al registro de msdb (GUID distinto)';
    }

    if (
      !lsnCoincide(full.firstLsn, fila.FirstLSN) ||
      !lsnCoincide(full.lastLsn, fila.LastLSN) ||
      !lsnCoincide(full.databaseBackupLsn, fila.DatabaseBackupLSN)
    ) {
      return 'los LSN del archivo no coinciden con el registro de msdb';
    }

    return null;
  } catch (error) {
    return `el archivo del full no es accesible: ${mensajeErrorSql(error)}`;
  }
}

interface VerificacionBase {
  problema: string | null;
  /** Criterio con el que se aprobó la cadena; queda en el log para la prueba de campo. */
  criterio: 'guid' | 'lsn' | 'ninguno';
}

// Después del diferencial se comprueba que SQL Server usó la base esperada.
// Se busca el registro de ESTE archivo, no el último diferencial de la base.
// La relación LSN/checkpoint está pendiente de validar en 2012/2014: por eso
// el GUID manda y el LSN solo se usa cuando falta el GUID.
async function verificarBaseDiferencial(
  pool: sql.ConnectionPool,
  baseDatos: string,
  full: FullRegistrado,
  archivo: string,
): Promise<VerificacionBase> {
  const resultado = await pool
    .request()
    .input('base', sql.NVarChar(128), baseDatos)
    .input('archivo', sql.NVarChar(4000), archivo)
    .query<FilaDiferencial>(`
      SELECT TOP 1
        CONVERT(varchar(36), bs.differential_base_guid) AS guid,
        CONVERT(varchar(25), bs.differential_base_lsn) AS base_lsn,
        bs.type AS type
      FROM msdb.dbo.backupset bs
      JOIN msdb.dbo.backupmediafamily mf ON mf.media_set_id = bs.media_set_id
      WHERE bs.database_name = @base
        AND bs.type = 'I'
        AND mf.physical_device_name = @archivo
      ORDER BY bs.backup_set_id DESC
    `);

  const fila = resultado.recordset[0];

  if (!fila) {
    return { problema: 'no se encontró el registro del diferencial en msdb', criterio: 'ninguno' };
  }

  const guidEsperado = full.backupSetUuid?.toLowerCase() ?? null;
  const guidReal = fila.guid?.toLowerCase() ?? null;

  // El GUID identifica la base de forma inequívoca. Solo si falta en alguno
  // de los dos lados se recurre al LSN; sin ninguno de los dos no se aprueba.
  if (guidEsperado && guidReal) {
    return guidEsperado === guidReal
      ? { problema: null, criterio: 'guid' }
      : {
          problema: 'la base diferencial no es el full esperado (cambió por un full externo)',
          criterio: 'guid',
        };
  }

  if (lsnCoincide(fila.base_lsn, full.checkpointLsn)) {
    return { problema: null, criterio: 'lsn' };
  }

  return {
    problema: 'no se pudo demostrar que el diferencial use el full esperado',
    criterio: 'ninguno',
  };
}

async function tamanoUltimoBackup(
  pool: sql.ConnectionPool,
  baseDatos: string,
  tipo: TipoEjecutadoMssql,
): Promise<number | null> {
  try {
    const resultado = await pool
      .request()
      .input('base', sql.NVarChar(128), baseDatos)
      .input('tipo', sql.Char(1), tipo === 'diferencial' ? 'I' : 'D')
      .query<{ tamano: number | null }>(`
        SELECT TOP 1 bs.backup_size AS tamano
        FROM msdb.dbo.backupset bs
        WHERE bs.database_name = @base AND bs.type = @tipo
        ORDER BY bs.backup_finish_date DESC, bs.backup_set_id DESC
      `);

    return resultado.recordset[0]?.tamano ?? null;
  } catch (error) {
    logger.warn(`No se pudo leer el tamaño del backup de "${baseDatos}"`, error);
    return null;
  }
}

function nombreBak(
  respaldo: RespaldoConfigurado,
  fecha: Date,
  tipo: TipoEjecutadoMssql,
  baseDatos: string,
  runId: string,
): string {
  const nombre = nombreArchivoSeguro(baseDatos);
  const etiqueta = tipo === 'diferencial' ? 'diff' : 'full';
  const marca = respaldo.copiaConFecha ? `_${marcaTiempo(fecha)}` : '';

  // El runId garantiza que nunca se sobrescriba un .bak existente, incluso
  // con dos tareas o dos ejecuciones simultáneas. Si el usuario lo desactiva,
  // el nombre queda fijo por base y tipo y cada ejecución reemplaza el archivo.
  const sufijoUnico = respaldo.identificadorUnico ? `_${runId}` : '';

  return `${nombre}${marca}_${etiqueta}${sufijoUnico}.bak`;
}

function empaquetarArchivo(ruta: string, rutaSalida: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const salida = createWriteStream(rutaSalida);
    const archivo = new ZipArchive({ zlib: { level: 6 } });

    salida.on('close', () => resolve());
    salida.on('error', reject);
    archivo.on('error', reject);
    archivo.on('warning', (error: ArchiverError) => reject(error));

    archivo.pipe(salida);
    archivo.file(ruta, { name: path.win32.basename(ruta) });
    void archivo.finalize();
  });
}

// Comprime el .bak en un .zip con nombre estable, escribiendo primero en un
// archivo parcial para no dejar un .zip incompleto si falla a mitad.
async function comprimirBakEnZip(rutaBak: string, rutaZip: string): Promise<void> {
  const rutaTemporal = `${rutaZip}.parcial`;

  try {
    await empaquetarArchivo(rutaBak, rutaTemporal);
    await fs.rm(rutaZip, { force: true });
    await fs.rename(rutaTemporal, rutaZip);
  } catch (error) {
    await fs.rm(rutaTemporal, { force: true });
    throw error;
  }
}

interface FilaRetencion {
  archivo: string;
  base_datos: string;
  tipo: string;
  uuid: string | null;
  base_guid: string | null;
  fecha: string;
}

function nombreEnMinusculas(ruta: string): string {
  const partes = ruta.split(/[\\/]/);

  return (partes[partes.length - 1] || ruta).toLowerCase();
}

// Depura los respaldos que superan la retención de la tarea. Se borran los
// .bak/.zip de las carpetas implicadas, conservando siempre el más reciente de
// cada base y el full del que dependen los diferenciales existentes.
async function depurarRespaldosAntiguos(
  pool: sql.ConnectionPool,
  respaldo: RespaldoConfigurado,
  destino: string,
): Promise<void> {
  const dias = respaldo.retencionDias;

  if (!Number.isInteger(dias) || dias < 1) {
    return;
  }

  const separador = destino.endsWith('\\') ? '' : '\\';
  const patron = `${escaparLike(`${destino}${separador}`)}%`;

  const resultado = await pool
    .request()
    .input('patron', sql.NVarChar(4000), patron)
    .query<FilaRetencion>(`
      SELECT
        mf.physical_device_name AS archivo,
        bs.database_name AS base_datos,
        bs.type AS tipo,
        CONVERT(varchar(36), bs.backup_set_uuid) AS uuid,
        CONVERT(varchar(36), bs.differential_base_guid) AS base_guid,
        CONVERT(varchar(33), bs.backup_finish_date, 126) AS fecha
      FROM msdb.dbo.backupset bs
      JOIN msdb.dbo.backupmediafamily mf ON mf.media_set_id = bs.media_set_id
      WHERE bs.type IN ('D', 'I')
        AND mf.physical_device_name LIKE @patron ESCAPE '\\'
    `);

  const filas = resultado.recordset ?? [];
  const protegidos = new Set<string>();
  const ultimoPorBase = new Map<string, FilaRetencion>();

  for (const fila of filas) {
    if (!fila.archivo) {
      continue;
    }

    const actual = ultimoPorBase.get(fila.base_datos);

    if (!actual || fila.fecha > actual.fecha) {
      ultimoPorBase.set(fila.base_datos, fila);
    }
  }

  for (const fila of ultimoPorBase.values()) {
    protegidos.add(nombreEnMinusculas(fila.archivo));
  }

  // El full base de un diferencial no puede borrarse: rompería su cadena.
  const fullPorUuid = new Map<string, string>();

  for (const fila of filas) {
    if (fila.tipo === 'D' && fila.uuid && fila.archivo) {
      fullPorUuid.set(fila.uuid.toLowerCase(), fila.archivo);
    }
  }

  for (const fila of filas) {
    if (fila.tipo === 'I' && fila.base_guid) {
      const archivoFull = fullPorUuid.get(fila.base_guid.toLowerCase());

      if (archivoFull) {
        protegidos.add(nombreEnMinusculas(archivoFull));
      }
    }
  }

  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  const carpetas = [destino];
  const carpetaZip = respaldo.carpetaZip.trim();

  if (carpetaZip && carpetaZip.toLowerCase() !== destino.toLowerCase()) {
    carpetas.push(carpetaZip);
  }

  for (const carpeta of carpetas) {
    let entradas;

    try {
      entradas = await fs.readdir(carpeta, { withFileTypes: true });
    } catch (error) {
      logger.warn(`No se pudo revisar la carpeta para depurar respaldos: ${carpeta}`, error);
      continue;
    }

    for (const entrada of entradas) {
      if (!entrada.isFile()) {
        continue;
      }

      const extension = path.extname(entrada.name).toLowerCase();

      if (extension !== '.bak' && extension !== '.zip') {
        continue;
      }

      if (protegidos.has(entrada.name.toLowerCase())) {
        continue;
      }

      const ruta = path.win32.join(carpeta, entrada.name);

      try {
        const info = await fs.stat(ruta);

        if (info.mtimeMs >= limite) {
          continue;
        }

        await fs.rm(ruta, { force: true });
        logger.info('Respaldo eliminado por retención', ruta);
      } catch (error) {
        logger.warn(`No se pudo depurar el respaldo ${ruta}`, error);
      }
    }
  }
}

// Respalda cada base con su propia decisión full/diferencial. Un fallo en una
// base no impide respaldar las demás; el resultado se devuelve por base.
export async function respaldarBasesDatosMssql(
  respaldo: RespaldoConfigurado,
  fecha: Date,
  runId: string,
): Promise<ResultadoRespaldoMssql> {
  const solicitadas = parsearBasesDatos(respaldo.origen);
  // Las bases del sistema no se respaldan; las tareas antiguas aún pueden tenerlas.
  const basesFijas = solicitadas.filter((base) => !esBaseDeSistema(base));
  const destino = respaldo.destino.trim();

  if (basesFijas.length !== solicitadas.length) {
    logger.info('Bases del sistema omitidas en la tarea', {
      tarea: respaldo.nombre,
      bases: solicitadas.filter((base) => esBaseDeSistema(base)),
    });
  }

  if (!respaldo.todasLasBases && basesFijas.length === 0) {
    throw new Error('Selecciona al menos una base de datos de usuario para respaldar.');
  }

  if (!destino) {
    throw new Error('Indica la carpeta destino en el servidor SQL.');
  }

  // Las tareas antiguas no guardaban conexión propia: se usa la global.
  const conexion = obtenerConexionMssqlRespaldo(respaldo.id) ?? leerConfiguracionMssql();

  if (!estaConfiguracionCompleta(conexion)) {
    throw new Error('Esta tarea no tiene las credenciales de SQL Server configuradas.');
  }

  const pool = new sql.ConnectionPool(configuracionSqlPara(conexion));

  try {
    await pool.connect();

    await registrarIdentidadServidor(pool);

    // Sin ruta propia se usa la carpeta de backup predeterminada de la instancia.
    const carpetaTemporal = respaldo.usarCopiaTemporal
      ? await resolverCarpetaTemporal(pool, respaldo)
      : '';

    // Con copia temporal, SQL escribe en la carpeta intermedia; el destino
    // final lo copia la propia app, así que no se sondea con SQL.
    const carpetaEscritura = respaldo.usarCopiaTemporal ? carpetaTemporal : destino;
    const diagnosticoCarpeta = await probarCarpetaDestino(pool, carpetaEscritura, runId);
    const avisoDestino =
      diagnosticoCarpeta.accesible === false
        ? ` SQL Server (${conexion.servidor}) no pudo abrir la carpeta ${carpetaEscritura}: ${diagnosticoCarpeta.detalle}`
        : null;

    if (avisoDestino) {
      logger.warn(avisoDestino.trim());
    }

    const estados = await pool.request().query<{ name: string; state_desc: string }>(`
      SELECT name, state_desc
      FROM sys.databases
      WHERE database_id > 4 AND source_database_id IS NULL
    `);
    const estadoPorNombre = new Map(estados.recordset.map((fila) => [fila.name, fila.state_desc]));
    // En modo dinámico la lista se resuelve en cada ejecución, así una base
    // nueva entra sin editar la tarea.
    const bases = respaldo.todasLasBases
      ? estados.recordset
          .filter((fila) => fila.state_desc === 'ONLINE')
          .map((fila) => fila.name)
          .sort((a, b) => a.localeCompare(b))
      : basesFijas;

    if (bases.length === 0) {
      throw new Error('No hay bases de usuario ONLINE para respaldar.');
    }

    const disponibles = bases.filter((base) => estadoPorNombre.get(base) === 'ONLINE');
    // Solo se respaldan las bases ONLINE; el resto queda constancia como omitida.
    const omitidas = bases.filter((base) => estadoPorNombre.get(base) !== 'ONLINE');

    if (disponibles.length === 0) {
      throw new Error(
        `Ninguna de las bases seleccionadas está ONLINE en el servidor: ${omitidas.join(', ')}.`,
      );
    }

    const resultados: NuevoResultadoBaseRespaldo[] = omitidas.map((base) =>
      resultadoOmitidoBase(
        base,
        `Omitida: la base está ${estadoPorNombre.get(base) ?? 'no disponible'} en el servidor.`,
      ),
    );

    for (const baseDatos of disponibles) {
      const resultado = await respaldarBase(
        pool,
        respaldo,
        baseDatos,
        fecha,
        destino,
        runId,
        avisoDestino,
        carpetaTemporal,
      );
      resultados.push(resultado);
    }

    const tipos = new Set(
      resultados
        .filter((resultado) => resultado.estado !== 'error' && resultado.archivo !== null)
        .map((resultado) => resultado.tipoEjecutado),
    );
    const tipoResumen =
      tipos.size === 0 ? 'completo' : tipos.size > 1 ? 'mixto' : [...tipos][0];

    // La retención se aplica solo cuando la ejecución generó algún respaldo.
    if (resultados.some((resultado) => resultado.estado !== 'error')) {
      try {
        await depurarRespaldosAntiguos(pool, respaldo, destino);
      } catch (error) {
        logger.warn('No se pudieron depurar los respaldos antiguos', error);
      }
    }

    return { resultados, tipoResumen };
  } finally {
    await pool.close().catch(() => undefined);
  }
}

// Base que no se respaldó por estar fuera de línea o no existir en el servidor.
function resultadoOmitidoBase(baseDatos: string, detalle: string): NuevoResultadoBaseRespaldo {
  return {
    baseDatos,
    tipoEjecutado: 'completo',
    archivo: null,
    baseArchivo: null,
    baseGuid: null,
    baseLsn: null,
    baseFecha: null,
    tamanoBytes: null,
    compresion: 'desconocido',
    archivoZip: null,
    tamanoZipBytes: null,
    estado: 'advertencia',
    detalle,
  };
}

function resultadoErrorBase(
  baseDatos: string,
  tipo: TipoEjecutadoMssql,
  archivo: string,
  full: FullRegistrado | null,
  detalle: string,
): NuevoResultadoBaseRespaldo {
  return {
    baseDatos,
    tipoEjecutado: tipo,
    archivo,
    baseArchivo: tipo === 'diferencial' ? (full?.archivos[0] ?? null) : null,
    baseGuid: tipo === 'diferencial' ? (full?.backupSetUuid ?? null) : null,
    baseLsn: tipo === 'diferencial' ? (full?.checkpointLsn ?? null) : null,
    baseFecha: tipo === 'diferencial' ? (full?.fecha ?? null) : null,
    tamanoBytes: null,
    compresion: 'desconocido',
    archivoZip: null,
    tamanoZipBytes: null,
    estado: 'error',
    detalle,
  };
}

async function describirFalloBackup(
  pool: sql.ConnectionPool,
  baseDatos: string,
  archivo: string,
  error: unknown,
  prefijo = '',
): Promise<string> {
  const mensaje = mensajeErrorSql(error);
  let extra: string | null = null;

  if (!/operating system error|error del sistema operativo/i.test(mensaje)) {
    const candidato = await leerErroresRelacionados(pool, archivo);
    const nombre = path.win32.basename(archivo);
    // Solo se usa una línea del log que mencione ESTE archivo, para no
    // atribuirle el error de la sonda de carpeta.
    extra = candidato && candidato.includes(nombre) ? candidato : null;
  }

  return `${prefijo}SQL Server no pudo respaldar "${baseDatos}": ${mensaje}${
    extra ? ` → ERRORLOG: ${extra}` : ''
  } Verifica que la carpeta destino exista en el servidor y que la cuenta del servicio tenga permisos. Puede quedar un archivo incompleto en la ruta indicada.`;
}

async function ejecutarBackup(
  pool: sql.ConnectionPool,
  baseDatos: string,
  archivo: string,
  etiqueta: string,
  tipo: TipoEjecutadoMssql,
): Promise<void> {
  const identificador = `[${baseDatos.replace(/]/g, ']]')}]`;
  const opciones = ['INIT', 'CHECKSUM', 'NAME = @etiqueta'];

  if (tipo === 'diferencial') {
    opciones.unshift('DIFFERENTIAL');
  }

  const copia = pool.request();
  // Una copia completa puede tardar más que el timeout normal de consultas.
  (copia as sql.Request & { timeout: number }).timeout = 0;

  await copia
    .input('ruta', sql.NVarChar(4000), archivo)
    .input('etiqueta', sql.NVarChar(256), etiqueta)
    .query(`BACKUP DATABASE ${identificador} TO DISK = @ruta WITH ${opciones.join(', ')}`);
}

async function respaldarBase(
  pool: sql.ConnectionPool,
  respaldo: RespaldoConfigurado,
  baseDatos: string,
  fecha: Date,
  destino: string,
  runId: string,
  avisoDestino: string | null,
  carpetaTemporal: string,
): Promise<NuevoResultadoBaseRespaldo> {
  let tipo: TipoEjecutadoMssql = 'completo';
  let full: FullRegistrado | null = null;
  let motivoFull: string | null = null;

  if (respaldo.modoMssql === 'diferencial') {
    try {
      full = await ultimoFull(pool, baseDatos);

      if (!full) {
        motivoFull = 'no hay un full previo registrado';
      } else if ((full.antiguedadMinutos ?? 0) > respaldo.fullCadaDias * MINUTOS_POR_DIA) {
        motivoFull = `el full supera la antigüedad máxima de ${respaldo.fullCadaDias} días`;
      } else {
        motivoFull = await validarArchivoFull(pool, baseDatos, full);
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      logger.warn(`No se pudo consultar msdb para "${baseDatos}"`, error);
      motivoFull = `no se pudo consultar msdb (${mensaje})`;
    }

    if (!motivoFull) {
      tipo = 'diferencial';
    }
  }

  const nombreArchivo = nombreBak(respaldo, fecha, tipo, baseDatos, runId);
  // El .bak debe quedar al final en "destino"; con copia intermedia, SQL lo
  // escribe primero en la carpeta temporal y la app lo mueve después.
  const archivo = path.win32.join(destino, nombreArchivo);
  const rutaBackup = respaldo.usarCopiaTemporal
    ? path.win32.join(carpetaTemporal, nombreArchivo)
    : archivo;
  const etiqueta = `BackupArc: ${respaldo.nombre}`;
  const notaFull = tipo === 'completo' && motivoFull ? ` Full automático: ${motivoFull}.` : '';

  try {
    await ejecutarBackup(pool, baseDatos, rutaBackup, etiqueta, tipo);
  } catch (error) {
    const detalle = await describirFalloBackup(pool, baseDatos, rutaBackup, error);

    return resultadoErrorBase(
      baseDatos,
      tipo,
      archivo,
      full,
      `${detalle}${notaFull}${avisoDestino ?? ''}`,
    );
  }

  logger.info(`Copia ${tipo} de la base "${baseDatos}" completada`, rutaBackup);

  const cabecera = await leerCabecera(pool, rutaBackup);
  const tamano = cabecera?.BackupSize ?? (await tamanoUltimoBackup(pool, baseDatos, tipo));

  let estado: NuevoResultadoBaseRespaldo['estado'] = 'ok';
  const detalles: string[] = [];
  let compresion: CompresionBak = 'no aplicada';
  let archivoZip: string | null = null;
  let tamanoZipBytes: number | null = null;

  if (tipo === 'diferencial' && full) {
    try {
      const verificacion = await verificarBaseDiferencial(pool, baseDatos, full, rutaBackup);

      if (verificacion.problema) {
        estado = 'advertencia';
        detalles.push(verificacion.problema);
      } else {
        logger.info(
          `Base diferencial de "${baseDatos}" verificada por ${verificacion.criterio}`,
          rutaBackup,
        );
      }
    } catch (error) {
      estado = 'advertencia';
      detalles.push(`no se pudo verificar la base diferencial: ${mensajeErrorSql(error)}`);
    }
  }

  if (tipo === 'completo' && motivoFull) {
    detalles.push(`Full automático: ${motivoFull}.`);
  }

  if (respaldo.verificarBak) {
    try {
      await pool
        .request()
        .input('ruta', sql.NVarChar(4000), rutaBackup)
        .query('RESTORE VERIFYONLY FROM DISK = @ruta WITH CHECKSUM');
    } catch (error) {
      estado = 'error';
      detalles.push(
        `RESTORE VERIFYONLY falló: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Mueve el .bak de la carpeta temporal al destino final. Esta copia la hace
  // la app (no SQL), así que usa las credenciales del equipo que la ejecuta.
  if (respaldo.usarCopiaTemporal) {
    const rutaLectura = path.win32.join(
      respaldo.carpetaTemporalLectura.trim() || carpetaTemporal,
      nombreArchivo,
    );

    if (estado === 'error') {
      await fs.rm(rutaLectura, { force: true }).catch(() => undefined);
    } else {
      try {
        await fs.mkdir(path.dirname(archivo), { recursive: true }).catch(() => undefined);
        await fs.copyFile(rutaLectura, archivo);
        await fs.rm(rutaLectura, { force: true });
        detalles.push('Copia intermedia movida a la carpeta destino.');
      } catch (error) {
        estado = 'error';
        detalles.push(
          `No se pudo copiar el .bak de la carpeta temporal al destino: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  // La compresión la hace la app: genera un .zip estable por base y reemplaza
  // el anterior en cada ejecución. El .bak se conserva para SQL Server.
  if (respaldo.comprimirBak && estado !== 'error') {
    const nombreZip = `${nombreArchivoSeguro(baseDatos)}.zip`;
    // Carpeta propia del .zip si se indicó; si no, junto al .bak.
    const carpetaZip = respaldo.carpetaZip.trim() || destino;
    const rutaZip = path.win32.join(carpetaZip, nombreZip);

    try {
      await fs.mkdir(carpetaZip, { recursive: true });
      await comprimirBakEnZip(archivo, rutaZip);
      const infoZip = await fs.stat(rutaZip);
      compresion = 'aplicada';
      archivoZip = rutaZip;
      tamanoZipBytes = infoZip.size;
      detalles.push(`.bak comprimido en ${rutaZip}.`);
    } catch (error) {
      compresion = 'no aplicada';

      if (estado === 'ok') {
        estado = 'advertencia';
      }

      detalles.push(
        `No se pudo comprimir el .bak a .zip: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    baseDatos,
    tipoEjecutado: tipo,
    archivo,
    baseArchivo: tipo === 'diferencial' ? (full?.archivos[0] ?? null) : null,
    baseGuid: tipo === 'diferencial' ? (full?.backupSetUuid ?? null) : null,
    baseLsn: tipo === 'diferencial' ? (full?.checkpointLsn ?? null) : null,
    baseFecha: tipo === 'diferencial' ? (full?.fecha ?? null) : null,
    tamanoBytes: tamano,
    compresion,
    archivoZip,
    tamanoZipBytes,
    estado,
    detalle: detalles.length > 0 ? detalles.join(' ') : null,
  };
}

interface FilaInventario {
  id: number;
  base_datos: string;
  tipo: string;
  fecha: string;
  tamano: number | null;
  uuid: string | null;
  base_guid: string | null;
  familias: number;
  copia: number | boolean;
  archivo: string;
}

interface VerificacionArchivo {
  verificable: boolean;
  motivo: string | null;
  tamanoBytes: number | null;
  compresion: CompresionBak;
}

const MAX_INVENTARIO = 300;
const MAX_VERIFICACIONES = 80;

function escaparLike(valor: string): string {
  return valor.replace(/\\|%|_|\[/g, (caracter) => `\\${caracter}`);
}

function nombreDeRuta(ruta: string): string {
  const partes = ruta.split(/[\\/]/);
  return partes[partes.length - 1] || ruta;
}

async function verificarArchivoInventario(
  pool: sql.ConnectionPool,
  archivo: string,
  baseDatos: string,
  tipo: TipoEjecutadoMssql,
): Promise<VerificacionArchivo> {
  const cabecera = await leerCabecera(pool, archivo);

  if (!cabecera) {
    return {
      verificable: false,
      motivo: 'no se pudo leer la cabecera',
      tamanoBytes: null,
      compresion: 'desconocido',
    };
  }

  if (cabecera.DatabaseName && cabecera.DatabaseName !== baseDatos) {
    return {
      verificable: false,
      motivo: 'el archivo pertenece a otra base de datos',
      tamanoBytes: null,
      compresion: 'desconocido',
    };
  }

  const tipoEsperado = tipo === 'diferencial' ? 5 : 1;

  if (Number(cabecera.BackupType) !== tipoEsperado) {
    return {
      verificable: false,
      motivo: 'el tipo del archivo no coincide con msdb',
      tamanoBytes: null,
      compresion: 'desconocido',
    };
  }

  return {
    verificable: true,
    motivo: null,
    tamanoBytes: cabecera.BackupSize ?? null,
    compresion: compresionDesdeCabecera(cabecera, true),
  };
}

// Inventario de solo lectura: describe lo que hay y qué conviene revisar.
// No borra, mueve ni modifica ningún archivo del servidor.
export async function inventariarArchivosBak(
  respaldo: RespaldoConfigurado,
): Promise<InventarioBak> {
  const carpeta = respaldo.destino.trim();

  if (!carpeta) {
    throw new Error('La tarea no tiene una carpeta destino.');
  }

  const conexion = obtenerConexionMssqlRespaldo(respaldo.id) ?? leerConfiguracionMssql();

  if (!estaConfiguracionCompleta(conexion)) {
    throw new Error('Esta tarea no tiene las credenciales de SQL Server configuradas.');
  }

  const pool = new sql.ConnectionPool(configuracionSqlPara(conexion));

  try {
    await pool.connect();

    const separador = carpeta.endsWith('\\') ? '' : '\\';
    const patron = `${escaparLike(`${carpeta}${separador}`)}%`;

    const resultado = await pool
      .request()
      .input('patron', sql.NVarChar(4000), patron)
      .query<FilaInventario>(`
        SELECT TOP ${MAX_INVENTARIO}
          bs.backup_set_id AS id,
          bs.database_name AS base_datos,
          bs.type AS tipo,
          CONVERT(varchar(33), bs.backup_finish_date, 126) AS fecha,
          bs.backup_size AS tamano,
          CONVERT(varchar(36), bs.backup_set_uuid) AS uuid,
          CONVERT(varchar(36), bs.differential_base_guid) AS base_guid,
          -- Se cuenta desde mediafamily en vez de usar bs.family_count:
          -- esa columna no existe en todas las versiones de msdb.
          (
            SELECT COUNT(*)
            FROM msdb.dbo.backupmediafamily m2
            WHERE m2.media_set_id = bs.media_set_id
          ) AS familias,
          bs.is_copy_only AS copia,
          mf.physical_device_name AS archivo
        FROM msdb.dbo.backupset bs
        JOIN msdb.dbo.backupmediafamily mf ON mf.media_set_id = bs.media_set_id
        WHERE bs.type IN ('D', 'I')
          AND mf.physical_device_name LIKE @patron ESCAPE '\\'
        ORDER BY bs.backup_finish_date DESC
      `);

    // Un backup puede tener varias familias (varios archivos): se cuenta una vez.
    const unicos = new Map<number, FilaInventario>();

    for (const fila of resultado.recordset) {
      if (!unicos.has(fila.id)) {
        unicos.set(fila.id, fila);
      }
    }

    const filas = [...unicos.values()];
    const bases = new Map<string, FilaInventario>();
    const hijosPorBase = new Map<string, number>();

    for (const fila of filas) {
      if (fila.tipo === 'D' && fila.uuid) {
        bases.set(fila.uuid.toLowerCase(), fila);
      }
    }

    for (const fila of filas) {
      if (fila.tipo === 'I' && fila.base_guid) {
        const clave = fila.base_guid.toLowerCase();
        hijosPorBase.set(clave, (hijosPorBase.get(clave) ?? 0) + 1);
      }
    }

    const verificaciones = new Map<number, VerificacionArchivo>();

    for (const [indice, fila] of filas.entries()) {
      if (indice >= MAX_VERIFICACIONES) {
        verificaciones.set(fila.id, {
          verificable: false,
          motivo: 'no se comprobó por el límite del inventario',
          tamanoBytes: null,
          compresion: 'desconocido',
        });
        continue;
      }

      if (fila.familias > 1) {
        verificaciones.set(fila.id, {
          verificable: false,
          motivo: 'backup distribuido en varios archivos',
          tamanoBytes: null,
          compresion: 'desconocido',
        });
        continue;
      }

      verificaciones.set(
        fila.id,
        await verificarArchivoInventario(
          pool,
          fila.archivo,
          fila.base_datos,
          fila.tipo === 'I' ? 'diferencial' : 'completo',
        ),
      );
    }

    const archivos: ArchivoBakInventario[] = filas.map((fila) => {
      const verificacion = verificaciones.get(fila.id) ?? {
        verificable: false,
        motivo: 'sin comprobación',
        tamanoBytes: null,
        compresion: 'desconocido' as CompresionBak,
      };
      const tipo: TipoEjecutadoMssql = fila.tipo === 'I' ? 'diferencial' : 'completo';
      const baseGuid = fila.base_guid?.toLowerCase() ?? null;
      const baseFila = tipo === 'diferencial' && baseGuid ? bases.get(baseGuid) : null;
      const hijos = fila.uuid ? (hijosPorBase.get(fila.uuid.toLowerCase()) ?? 0) : 0;
      const esCopyOnly = fila.copia === 1 || fila.copia === true;

      let categoria: ArchivoBakInventario['categoria'];
      let sugerencia: string;

      if (!verificacion.verificable) {
        categoria = 'no_verificable';
        sugerencia = `No se pudo comprobar el archivo (${verificacion.motivo ?? 'motivo desconocido'}). Revísalo antes de borrar.`;
      } else if (tipo === 'completo' && esCopyOnly) {
        categoria = 'confirmado';
        sugerencia = 'Copia COPY_ONLY: no sirve como base de diferenciales.';
      } else if (tipo === 'completo' && hijos > 0) {
        categoria = 'base_protegida';
        sugerencia = `No borrar: es la base de ${hijos} diferencial${hijos === 1 ? '' : 'es'} en esta carpeta.`;
      } else if (tipo === 'completo') {
        categoria = 'confirmado';
        sugerencia = 'Se puede borrar manualmente si ya no necesitas este punto de restauración.';
      } else if (baseFila && verificaciones.get(baseFila.id)?.verificable) {
        categoria = 'confirmado';
        sugerencia =
          'Se puede borrar manualmente; conserva su full base para restaurar los demás puntos.';
      } else {
        categoria = 'posible_huerfano';
        sugerencia = baseFila
          ? 'Su full base no es verificable; puede no ser restaurable.'
          : 'Su full base no está en esta carpeta; puede no ser restaurable.';
      }

      return {
        archivo: fila.archivo,
        nombre: nombreDeRuta(fila.archivo),
        baseDatos: fila.base_datos,
        tipo,
        fecha: fila.fecha,
        tamanoBytes: verificacion.tamanoBytes ?? fila.tamano ?? null,
        compresion: verificacion.compresion,
        baseArchivo: baseFila?.archivo ?? null,
        esCopyOnly,
        categoria,
        sugerencia,
      };
    });

    return {
      carpeta,
      archivos,
      advertencia:
        'Solo se listan los backups registrados en msdb dentro de esta carpeta. La retención de la tarea puede eliminar .bak y .zip antiguos al respaldar; esta lista es solo de lectura.',
    };
  } finally {
    await pool.close().catch(() => undefined);
  }
}

const MAX_INFORME = 500;

interface FilaInforme {
  id: number;
  base_datos: string;
  tipo: string;
  dia: string;
  fecha: string;
  tamano: number | string | null;
  copia: number | boolean;
  archivo: string;
  familias: number;
}

// Recorre el rango con fechas UTC para no depender del huso del equipo.
function diasDelRango(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  const inicio = Date.parse(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);

  if (Number.isNaN(inicio) || Number.isNaN(fin) || fin < inicio) {
    return dias;
  }

  for (let actual = inicio; actual <= fin; actual += 86_400_000) {
    dias.push(new Date(actual).toISOString().slice(0, 10));
  }

  return dias;
}

// Informe de solo lectura: busca en msdb los .bak de la carpeta dentro del
// rango pedido. El rango se resuelve con el calendario del servidor SQL.
export async function consultarArchivosBak(
  respaldo: RespaldoConfigurado,
  filtro: FiltroInformeBak,
): Promise<InformeBak> {
  const carpeta = respaldo.destino.trim();

  if (!carpeta) {
    throw new Error('La tarea no tiene una carpeta destino.');
  }

  const conexion = obtenerConexionMssqlRespaldo(respaldo.id) ?? leerConfiguracionMssql();

  if (!estaConfiguracionCompleta(conexion)) {
    throw new Error('Esta tarea no tiene las credenciales de SQL Server configuradas.');
  }

  const pool = new sql.ConnectionPool(configuracionSqlPara(conexion));

  try {
    await pool.connect();

    const separador = carpeta.endsWith('\\') ? '' : '\\';
    const patron = `${escaparLike(`${carpeta}${separador}`)}%`;
    const patronTexto = filtro.texto ? `%${escaparLike(filtro.texto)}%` : null;

    const resultado = await pool
      .request()
      .input('patron', sql.NVarChar(4000), patron)
      .input('desde', sql.NVarChar(10), filtro.desde)
      .input('hasta', sql.NVarChar(10), filtro.hasta)
      .input('base', sql.NVarChar(128), filtro.baseDatos)
      .input('texto', sql.NVarChar(4000), patronTexto)
      .query<FilaInforme>(`
        SELECT TOP ${MAX_INFORME + 1}
          bs.backup_set_id AS id,
          bs.database_name AS base_datos,
          bs.type AS tipo,
          CONVERT(char(10), bs.backup_finish_date, 23) AS dia,
          CONVERT(varchar(33), bs.backup_finish_date, 126) AS fecha,
          bs.backup_size AS tamano,
          bs.is_copy_only AS copia,
          mf.physical_device_name AS archivo,
          -- Conteo desde mediafamily: bs.family_count no existe en todas las versiones.
          (
            SELECT COUNT(*)
            FROM msdb.dbo.backupmediafamily m2
            WHERE m2.media_set_id = bs.media_set_id
          ) AS familias
        FROM msdb.dbo.backupset bs
        JOIN msdb.dbo.backupmediafamily mf ON mf.media_set_id = bs.media_set_id
        WHERE bs.type IN ('D', 'I')
          -- Estilo 23 (aaaa-MM-dd): el rango no depende del idioma del servidor.
          AND bs.backup_finish_date >= CONVERT(date, @desde, 23)
          AND bs.backup_finish_date < DATEADD(day, 1, CONVERT(date, @hasta, 23))
          AND mf.physical_device_name LIKE @patron ESCAPE '\\'
          AND (@base IS NULL OR bs.database_name = @base)
          AND (@texto IS NULL OR mf.physical_device_name LIKE @texto ESCAPE '\\')
        ORDER BY bs.backup_finish_date DESC, bs.backup_set_id DESC
      `);

    // Un backup repartido en varios archivos aparece una vez por familia:
    // se conserva la primera fila para contar el backup set una sola vez.
    const unicos = new Map<number, FilaInforme>();

    for (const fila of resultado.recordset) {
      if (!unicos.has(fila.id)) {
        unicos.set(fila.id, fila);
      }
    }

    const truncado = unicos.size > MAX_INFORME;
    const filas = [...unicos.values()].slice(0, MAX_INFORME);

    const archivos: ArchivoBakInforme[] = filas.map((fila) => ({
      archivo: fila.archivo,
      nombre: nombreDeRuta(fila.archivo),
      baseDatos: fila.base_datos,
      tipo: fila.tipo === 'I' ? 'diferencial' : 'completo',
      dia: fila.dia,
      fecha: fila.fecha,
      // backup_size llega como texto desde el driver en algunas versiones.
      tamanoBytes: fila.tamano === null ? null : Number(fila.tamano),
      esCopyOnly: fila.copia === 1 || fila.copia === true,
      familias: fila.familias ?? 1,
    }));

    const diasConRespaldo = [...new Set(archivos.map((archivo) => archivo.dia))].sort();
    const conRespaldo = new Set(diasConRespaldo);
    const diasSinRespaldo = diasDelRango(filtro.desde, filtro.hasta).filter(
      (dia) => !conRespaldo.has(dia),
    );

    return {
      carpeta,
      desde: filtro.desde,
      hasta: filtro.hasta,
      archivos,
      resumen: {
        total: archivos.length,
        completos: archivos.filter((archivo) => archivo.tipo === 'completo').length,
        diferenciales: archivos.filter((archivo) => archivo.tipo === 'diferencial').length,
        bases: [...new Set(archivos.map((archivo) => archivo.baseDatos))].sort(),
        tamanoTotalBytes: archivos.reduce(
          (total, archivo) => total + (archivo.tamanoBytes ?? 0),
          0,
        ),
        diasConRespaldo,
        diasSinRespaldo,
      },
      truncado,
      advertencia:
        'Datos tomados de msdb. Solo aparecen los backups registrados en el servidor; un archivo copiado por fuera de SQL Server no se refleja aquí.',
    };
  } finally {
    await pool.close().catch(() => undefined);
  }
}

// Informe global: recorre todas las tareas MSSQL y une sus resultados.
// Una tarea que falla no invalida el informe de las demás.
export async function consultarInformeGlobalBak(
  filtro: FiltroInformeBak,
): Promise<InformeGlobalBak> {
  const tareas = listarRespaldos().filter((tarea) => tarea.tipo === 'mssql');
  const archivos: ArchivoBakInformeGlobal[] = [];
  const resumenTareas: TareaInformeGlobal[] = [];
  let truncado = false;

  for (const tarea of tareas) {
    const servidor = tarea.conexionMssql
      ? `${tarea.conexionMssql.servidor}:${tarea.conexionMssql.puerto}`
      : 'Sin servidor configurado';

    try {
      const informe = await consultarArchivosBak(tarea, filtro);

      archivos.push(
        ...informe.archivos.map((archivo) => ({
          ...archivo,
          tareaId: tarea.id,
          tarea: tarea.nombre,
          servidor,
        })),
      );
      resumenTareas.push({
        id: tarea.id,
        nombre: tarea.nombre,
        servidor,
        total: informe.resumen.total,
        error: null,
      });
      truncado = truncado || informe.truncado;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);

      logger.warn(`No se pudo generar el informe de "${tarea.nombre}"`, error);
      resumenTareas.push({
        id: tarea.id,
        nombre: tarea.nombre,
        servidor,
        total: 0,
        error: mensaje,
      });
    }
  }

  // Más recientes primero; las fechas del servidor son comparables como texto.
  archivos.sort((a, b) => {
    if (a.fecha === b.fecha) {
      return 0;
    }

    return a.fecha < b.fecha ? 1 : -1;
  });

  const diasConRespaldo = [...new Set(archivos.map((archivo) => archivo.dia))].sort();
  const conRespaldo = new Set(diasConRespaldo);

  // Las tareas de archivos solo tienen sentido cuando el filtro es por fecha:
  // una base o un nombre de .bak implica una consulta exclusiva de MSSQL.
  const incluirArchivos = !filtro.baseDatos && !filtro.texto;
  const consultaArchivos = incluirArchivos
    ? consultarEjecucionesArchivos(filtro.desde, filtro.hasta)
    : null;
  let resumenArchivos: ResumenArchivosInforme | null = null;

  if (consultaArchivos) {
    const conEjecucion = new Set(consultaArchivos.resumen.diasConEjecucion);

    resumenArchivos = {
      ...consultaArchivos.resumen,
      diasSinEjecucion: diasDelRango(filtro.desde, filtro.hasta).filter(
        (dia) => !conEjecucion.has(dia),
      ),
      truncado: consultaArchivos.truncado,
    };
  }

  return {
    desde: filtro.desde,
    hasta: filtro.hasta,
    archivos,
    resumen: {
      total: archivos.length,
      completos: archivos.filter((archivo) => archivo.tipo === 'completo').length,
      diferenciales: archivos.filter((archivo) => archivo.tipo === 'diferencial').length,
      bases: [...new Set(archivos.map((archivo) => archivo.baseDatos))].sort(),
      tamanoTotalBytes: archivos.reduce(
        (total, archivo) => total + (archivo.tamanoBytes ?? 0),
        0,
      ),
      diasConRespaldo,
      diasSinRespaldo: diasDelRango(filtro.desde, filtro.hasta).filter(
        (dia) => !conRespaldo.has(dia),
      ),
    },
    tareas: resumenTareas,
    truncado,
    ejecucionesArchivos: consultaArchivos?.ejecuciones ?? [],
    resumenArchivos,
    resumenZip: consultarResumenZip(filtro.desde, filtro.hasta, filtro.baseDatos),
  };
}
