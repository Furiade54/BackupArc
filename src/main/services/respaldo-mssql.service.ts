import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sql from 'mssql';
import type {
  ArchivoBakInventario,
  CompresionBak,
  ConexionMssql,
  InventarioBak,
  NuevoResultadoBaseRespaldo,
  RespaldoConfigurado,
  TipoEjecutadoMssql,
} from '../../shared/types/respaldo.types';
import { parsearBasesDatos } from '../../shared/utils/bases-datos';
import { obtenerConexionMssqlRespaldo } from '../repositories/respaldos-local.repository';
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

// Único error que habilita reintentar sin compresión: la edición no la admite.
// Cualquier otro fallo (espacio, permisos, ruta) se propaga tal cual.
const NUMEROS_SIN_COMPRESION = new Set([3097]);
const PATRON_SIN_COMPRESION =
  /compression is not supported|no se admite la compresi[oó]n|la compresi[oó]n no se (?:admite|soporta)|compresi[oó]n[^.\n]{0,40}no (?:es )?compatible/i;

// Instancias que ya respondieron "sin soporte": no se vuelve a intentar.
const conexionesSinCompresion = new Set<string>();

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

function claveConexion(conexion: ConexionMssql): string {
  return `${conexion.servidor.trim().toLowerCase()}:${conexion.puerto}|${conexion.usuario
    .trim()
    .toLowerCase()}`;
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

function esCompresionNoSoportada(error: unknown): boolean {
  const errores = erroresSqlDe(error);

  if (errores.some((registro) => registro.numero !== null && NUMEROS_SIN_COMPRESION.has(registro.numero))) {
    return true;
  }

  return errores.some((registro) => PATRON_SIN_COMPRESION.test(registro.mensaje));
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
  // con dos tareas o dos ejecuciones simultáneas.
  return `${nombre}${marca}_${etiqueta}_${runId}.bak`;
}

// Respalda cada base con su propia decisión full/diferencial. Un fallo en una
// base no impide respaldar las demás; el resultado se devuelve por base.
export async function respaldarBasesDatosMssql(
  respaldo: RespaldoConfigurado,
  fecha: Date,
  runId: string,
): Promise<ResultadoRespaldoMssql> {
  const bases = parsearBasesDatos(respaldo.origen);
  const destino = respaldo.destino.trim();

  if (bases.length === 0) {
    throw new Error('Selecciona al menos una base de datos para respaldar.');
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

    const diagnosticoCarpeta = await probarCarpetaDestino(pool, destino, runId);
    const avisoDestino =
      diagnosticoCarpeta.accesible === false
        ? ` SQL Server (${conexion.servidor}) no pudo abrir la carpeta ${destino}: ${diagnosticoCarpeta.detalle}`
        : null;

    if (avisoDestino) {
      logger.warn(avisoDestino.trim());
    }

    const estados = await pool.request().query<{ name: string; state_desc: string }>(`
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

    const resultados: NuevoResultadoBaseRespaldo[] = [];
    const clave = claveConexion(conexion);

    for (const baseDatos of bases) {
      const resultado = await respaldarBase(
        pool,
        respaldo,
        baseDatos,
        fecha,
        destino,
        runId,
        clave,
        avisoDestino,
      );
      resultados.push(resultado);
    }

    const tipos = new Set(resultados.filter((r) => r.estado !== 'error').map((r) => r.tipoEjecutado));
    const tipoResumen =
      tipos.size === 0 ? 'completo' : tipos.size > 1 ? 'mixto' : [...tipos][0];

    return { resultados, tipoResumen };
  } finally {
    await pool.close().catch(() => undefined);
  }
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
  comprimir: boolean,
): Promise<void> {
  const identificador = `[${baseDatos.replace(/]/g, ']]')}]`;
  const opciones = ['INIT', 'CHECKSUM', 'NAME = @etiqueta'];

  if (tipo === 'diferencial') {
    opciones.unshift('DIFFERENTIAL');
  }

  if (comprimir) {
    opciones.push('COMPRESSION');
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
  clave: string,
  avisoDestino: string | null,
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

  const archivo = path.win32.join(
    destino,
    nombreBak(respaldo, fecha, tipo, baseDatos, runId),
  );
  const etiqueta = `BackupArc: ${respaldo.nombre}`;
  const sinSoportePrevio = conexionesSinCompresion.has(clave);
  let comprimir = respaldo.comprimirBak && !sinSoportePrevio;
  let reintentoSinCompresion = false;
  const notaFull = tipo === 'completo' && motivoFull ? ` Full automático: ${motivoFull}.` : '';

  try {
    await ejecutarBackup(pool, baseDatos, archivo, etiqueta, tipo, comprimir);
  } catch (error) {
    // Solo se reintenta cuando la causa es la falta de soporte de compresión.
    if (comprimir && esCompresionNoSoportada(error)) {
      conexionesSinCompresion.add(clave);
      comprimir = false;
      reintentoSinCompresion = true;

      try {
        // Misma ruta: INIT descarta el archivo parcial del primer intento.
        await ejecutarBackup(pool, baseDatos, archivo, etiqueta, tipo, false);
      } catch (reintentoError) {
        const detalle = await describirFalloBackup(
          pool,
          baseDatos,
          archivo,
          reintentoError,
          'La instancia no admite compresión y el reintento sin compresión también falló. ',
        );

        return resultadoErrorBase(
          baseDatos,
          tipo,
          archivo,
          full,
          `${detalle}${notaFull}${avisoDestino ?? ''}`,
        );
      }
    } else {
      const detalle = await describirFalloBackup(pool, baseDatos, archivo, error);

      return resultadoErrorBase(
        baseDatos,
        tipo,
        archivo,
        full,
        `${detalle}${notaFull}${avisoDestino ?? ''}`,
      );
    }
  }

  logger.info(`Copia ${tipo} de la base "${baseDatos}" completada`, archivo);

  const cabecera = await leerCabecera(pool, archivo);
  const compresion = compresionDesdeCabecera(cabecera, comprimir);
  const tamano = cabecera?.BackupSize ?? (await tamanoUltimoBackup(pool, baseDatos, tipo));

  let estado: NuevoResultadoBaseRespaldo['estado'] = 'ok';
  const detalles: string[] = [];

  if (reintentoSinCompresion) {
    detalles.push('La instancia no admite compresión; el backup se generó sin COMPRESSION.');
  } else if (respaldo.comprimirBak && sinSoportePrevio) {
    detalles.push('Compresión no aplicada: la instancia no la admite.');
  }

  if (tipo === 'diferencial' && full) {
    try {
      const verificacion = await verificarBaseDiferencial(pool, baseDatos, full, archivo);

      if (verificacion.problema) {
        estado = 'advertencia';
        detalles.push(verificacion.problema);
      } else {
        logger.info(
          `Base diferencial de "${baseDatos}" verificada por ${verificacion.criterio}`,
          archivo,
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
        .input('ruta', sql.NVarChar(4000), archivo)
        .query('RESTORE VERIFYONLY FROM DISK = @ruta WITH CHECKSUM');
    } catch (error) {
      estado = 'error';
      detalles.push(
        `RESTORE VERIFYONLY falló: ${error instanceof Error ? error.message : String(error)}`,
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
  copia: number;
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
          bs.family_count AS familias,
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
      const esCopyOnly = fila.copia === 1;

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
        'Solo se listan los backups registrados en msdb dentro de esta carpeta. Puede haber archivos no registrados; esta lista no autoriza a borrar nada y la app no elimina archivos automáticamente.',
    };
  } finally {
    await pool.close().catch(() => undefined);
  }
}
