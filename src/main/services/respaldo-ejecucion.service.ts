import { createWriteStream, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { ZipArchive, type ArchiverError } from 'archiver';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type {
  NuevoResultadoBaseRespaldo,
  RespaldoConfigurado,
} from '../../shared/types/respaldo.types';
import {
  actualizarEstadoRespaldo,
  calcularSiguienteEjecucion,
  depurarHistorialAntiguo,
  listarRespaldosVencidos,
  normalizarProximasEjecuciones,
  obtenerRespaldo,
  registrarEjecucionRespaldo,
  registrarResultadosBase,
} from '../repositories/respaldos-local.repository';
import { logger } from '../utils/logger';
import { marcaTiempo, slug } from '../utils/nombres-respaldo';
import { crearRunId, respaldarBasesDatosMssql } from './respaldo-mssql.service';

const INTERVALO_COMPROBACION_MS = 60_000;
const RETRASO_INICIAL_MS = 10_000;

const enEjecucion = new Set<number>();
let temporizador: NodeJS.Timeout | null = null;
let comprobando = false;

async function existeCarpeta(ruta: string): Promise<boolean> {
  try {
    const info = await fs.stat(ruta);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function existeRuta(ruta: string): Promise<boolean> {
  try {
    await fs.stat(ruta);
    return true;
  } catch {
    return false;
  }
}

// Cuenta archivos y bytes del origen antes de copiar, para las métricas del historial.
async function medirOrigen(ruta: string): Promise<{ archivos: number; bytes: number }> {
  const info = await fs.stat(ruta);

  if (!info.isDirectory()) {
    return { archivos: 1, bytes: info.size };
  }

  let archivos = 0;
  let bytes = 0;
  const pendientes = [ruta];

  while (pendientes.length > 0) {
    const actual = pendientes.pop() as string;
    const entradas = await fs.readdir(actual, { withFileTypes: true });

    for (const entrada of entradas) {
      const rutaHija = path.join(actual, entrada.name);

      if (entrada.isDirectory()) {
        pendientes.push(rutaHija);
      } else if (entrada.isFile()) {
        archivos += 1;
        bytes += (await fs.stat(rutaHija)).size;
      }
    }
  }

  return { archivos, bytes };
}

interface OrigenRespaldo {
  ruta: string;
  esCarpeta: boolean;
}

// Valida origen/destino y devuelve el origen tipado, el destino absoluto y el
// prefijo del nombre generado (el del origen, no el de la tarea).
async function prepararRutas(
  respaldo: RespaldoConfigurado,
): Promise<{ origen: OrigenRespaldo; destino: string; prefijo: string }> {
  const rutaOrigen = path.resolve(respaldo.origen);
  const destino = path.resolve(respaldo.destino);

  let info: Stats;

  try {
    info = await fs.stat(rutaOrigen);
  } catch {
    throw new Error(`La ruta de origen no existe: ${rutaOrigen}`);
  }

  const esCarpeta = info.isDirectory();

  if (!esCarpeta && !info.isFile()) {
    throw new Error(`El origen debe ser una carpeta o un archivo: ${rutaOrigen}`);
  }

  // Solo tiene sentido cuando el origen es una carpeta: el destino no puede
  // quedar dentro de lo que se está copiando.
  if (esCarpeta && (destino === rutaOrigen || destino.startsWith(`${rutaOrigen}${path.sep}`))) {
    throw new Error('La carpeta destino no puede estar dentro de la carpeta origen.');
  }

  await fs.mkdir(destino, { recursive: true });

  // La carpeta conserva su nombre; el archivo pierde la extensión para no
  // duplicarla al añadir la fecha: backuparc.msi → backuparc_20261030110200.msi
  const base = esCarpeta
    ? path.basename(rutaOrigen)
    : path.basename(rutaOrigen, path.extname(rutaOrigen));

  return {
    origen: { ruta: rutaOrigen, esCarpeta },
    destino,
    prefijo: slug(base),
  };
}

async function copiarOrigen(
  respaldo: RespaldoConfigurado,
  fecha: Date,
): Promise<{ ruta: string; prefijo: string }> {
  const { origen, destino, prefijo } = await prepararRutas(respaldo);
  // Carpetas: nombre20261030105000 · Archivos: nombre_20261030110200.msi
  const nombreBase = respaldo.copiaConFecha
    ? `${prefijo}${origen.esCarpeta ? '' : '_'}${marcaTiempo(fecha)}`
    : prefijo;

  if (origen.esCarpeta) {
    let rutaCopia = path.join(destino, nombreBase);

    if (respaldo.copiaConFecha) {
      if (await existeCarpeta(rutaCopia)) {
        rutaCopia = `${rutaCopia}-${Date.now()}`;
      }
    } else {
      // Sin fecha: una única carpeta que se reemplaza en cada ejecución.
      if (rutaCopia === origen.ruta) {
        throw new Error('La carpeta de copia coincidiría con la carpeta de origen.');
      }

      await fs.rm(rutaCopia, { recursive: true, force: true });
    }

    await fs.cp(origen.ruta, rutaCopia, { recursive: true, force: true, errorOnExist: false });

    return { ruta: rutaCopia, prefijo };
  }

  // Archivo suelto: se conserva su extensión y se copia como un único archivo.
  const extension = path.extname(origen.ruta);
  let rutaCopia = path.join(destino, `${nombreBase}${extension}`);

  if (respaldo.copiaConFecha) {
    if (await existeRuta(rutaCopia)) {
      rutaCopia = path.join(destino, `${nombreBase}-${Date.now()}${extension}`);
    }
  } else {
    if (rutaCopia === origen.ruta) {
      throw new Error('El archivo de copia coincidiría con el archivo de origen.');
    }

    await fs.rm(rutaCopia, { force: true });
  }

  await fs.copyFile(origen.ruta, rutaCopia);

  return { ruta: rutaCopia, prefijo };
}

function empaquetar(origen: OrigenRespaldo, rutaSalida: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const salida = createWriteStream(rutaSalida);
    const archivo = new ZipArchive({ zlib: { level: 6 } });

    salida.on('close', () => resolve());
    salida.on('error', reject);
    archivo.on('error', reject);
    archivo.on('warning', (error: ArchiverError) => {
      // Una entrada ilegible se advierte, pero no invalida el resto del paquete.
      if (error.code === 'ENOENT') {
        logger.warn('Entrada omitida al comprimir el respaldo', error);
        return;
      }

      reject(error);
    });

    archivo.pipe(salida);

    if (origen.esCarpeta) {
      archivo.directory(origen.ruta, false);
    } else {
      archivo.file(origen.ruta, { name: path.basename(origen.ruta) });
    }

    void archivo.finalize();
  });
}

async function comprimirOrigen(
  respaldo: RespaldoConfigurado,
  fecha: Date,
): Promise<{ ruta: string; prefijo: string }> {
  const { origen, destino, prefijo } = await prepararRutas(respaldo);
  // Carpetas: nombre20261030105000.zip · Archivos: nombre_20261030110200.zip
  const nombreBase = respaldo.copiaConFecha
    ? `${prefijo}${origen.esCarpeta ? '' : '_'}${marcaTiempo(fecha)}`
    : prefijo;
  let rutaZip = path.join(destino, `${nombreBase}.zip`);

  if (respaldo.copiaConFecha) {
    if (await existeRuta(rutaZip)) {
      rutaZip = path.join(destino, `${nombreBase}-${Date.now()}.zip`);
    }
  } else {
    await fs.rm(rutaZip, { force: true });
  }

  // Se escribe en un archivo temporal para no dejar un .zip incompleto si falla.
  const rutaTemporal = `${rutaZip}.parcial`;

  try {
    await empaquetar(origen, rutaTemporal);
    await fs.rename(rutaTemporal, rutaZip);
  } catch (error) {
    await fs.rm(rutaTemporal, { force: true });
    throw error;
  }

  return { ruta: rutaZip, prefijo };
}

// Nombre que crea la app: <prefijo>[_]<14 dígitos>[-desambiguación][.extensión].
const PATRON_COPIA_CON_FECHA = /^_?\d{14}(-\d+)?(\.[^.\\/]+)?$/;

async function aplicarRetencion(destino: string, prefijo: string, retencionDias: number): Promise<void> {
  const limite = Date.now() - retencionDias * 24 * 60 * 60 * 1000;
  const entradas = await fs.readdir(destino, { withFileTypes: true });

  for (const entrada of entradas) {
    // Aplica a carpetas, .zip y archivos sueltos creados con fecha.
    const resto = entrada.name.startsWith(prefijo) ? entrada.name.slice(prefijo.length) : '';
    const esCopiaConFecha = PATRON_COPIA_CON_FECHA.test(resto);

    if (!esCopiaConFecha || (!entrada.isDirectory() && !entrada.isFile())) {
      continue;
    }

    const ruta = path.join(destino, entrada.name);

    try {
      const info = await fs.stat(ruta);

      if (info.mtimeMs < limite) {
        await fs.rm(ruta, { recursive: true, force: true });
        logger.info('Copia antigua eliminada por retención', ruta);
      }
    } catch (error) {
      logger.warn(`No se pudo aplicar la retención en ${ruta}`, error);
    }
  }
}

function notificarCambioEjecucion(id: number, enEjecucion: boolean): void {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed() && !ventana.webContents.isDestroyed()) {
      ventana.webContents.send(IPC_CHANNELS.RESPALDOS_EJECUCION, { id, enEjecucion });
    }
  }
}

function resumirResultadosMssql(resultados: NuevoResultadoBaseRespaldo[]): string {
  // Una base omitida no generó archivo: no cuenta como full ni como diferencial.
  const omitidas = resultados.filter((resultado) => resultado.archivo === null);
  const respaldadas = resultados.filter((resultado) => resultado.archivo !== null);
  const exitosos = respaldadas.filter((resultado) => resultado.estado !== 'error');
  const completos = exitosos.filter((resultado) => resultado.tipoEjecutado === 'completo').length;
  const diferenciales = exitosos.length - completos;
  const advertencias = exitosos.filter((resultado) => resultado.estado === 'advertencia');
  const errores = respaldadas.filter((resultado) => resultado.estado === 'error');
  const partes: string[] = [];

  if (completos > 0) {
    partes.push(`${completos} full`);
  }

  if (diferenciales > 0) {
    partes.push(`${diferenciales} diferencial${diferenciales === 1 ? '' : 'es'}`);
  }

  let resumen = partes.length > 0 ? partes.join(' · ') : 'Sin bases respaldadas';

  if (advertencias.length > 0) {
    resumen += ` · ${advertencias.length} con advertencia`;
  }

  if (omitidas.length > 0) {
    resumen += ` · ${omitidas.length} omitida${omitidas.length === 1 ? '' : 's'}`;
  }

  if (errores.length > 0) {
    const detalle = errores
      .map((error) => `${error.baseDatos}: ${error.detalle ?? 'sin detalle'}`)
      .join(' | ');

    resumen += ` · ${errores.length} con error (${detalle})`;
  }

  return resumen;
}

async function ejecutarRespaldoInterno(respaldo: RespaldoConfigurado): Promise<void> {
  if (enEjecucion.has(respaldo.id)) {
    throw new Error('La copia ya se está ejecutando.');
  }

  enEjecucion.add(respaldo.id);
  notificarCambioEjecucion(respaldo.id, true);

  const inicio = new Date();
  const proximaEjecucion = calcularSiguienteEjecucion(inicio, respaldo.frecuenciaMinutos);
  // En MSSQL la ejecución y sus resultados se guardan antes de propagar el
  // error resumido, para no duplicar el registro en el historial.
  let ejecucionRegistrada = false;

  try {
    if (respaldo.tipo === 'mssql') {
      const runId = crearRunId();
      const { resultados, tipoResumen } = await respaldarBasesDatosMssql(respaldo, inicio, runId);
      const errores = resultados.filter((resultado) => resultado.estado === 'error');
      const advertencias = resultados.filter((resultado) => resultado.estado === 'advertencia');
      const estado = errores.length > 0 ? 'error' : advertencias.length > 0 ? 'advertencia' : 'ok';
      const detalle = resumirResultadosMssql(resultados);

      const ejecucionId = registrarEjecucionRespaldo(
        respaldo.id,
        estado,
        detalle,
        inicio.toISOString(),
        {
          tipo: tipoResumen,
          runId,
          duracionMs: Date.now() - inicio.getTime(),
          archivos: resultados.filter((resultado) => resultado.archivo !== null).length,
          bytes: resultados.reduce(
            (total, resultado) =>
              total + (resultado.archivo !== null ? (resultado.tamanoBytes ?? 0) : 0),
            0,
          ),
        },
      );
      registrarResultadosBase(ejecucionId, resultados);
      actualizarEstadoRespaldo(respaldo.id, estado, inicio.toISOString(), proximaEjecucion);
      ejecucionRegistrada = true;

      logger.info(`Copia MSSQL "${respaldo.nombre}" finalizada`, detalle);

      if (errores.length > 0) {
        throw new Error(detalle);
      }

      return;
    }

    // Las métricas se miden antes de copiar: el origen puede cambiar durante la copia.
    const metricas = await medirOrigen(respaldo.origen).catch(() => null);
    const copia = respaldo.comprimir
      ? await comprimirOrigen(respaldo, inicio)
      : await copiarOrigen(respaldo, inicio);
    const rutaCopia = copia.ruta;

    // La retención solo aplica a los archivos que copia la propia aplicación;
    // los .bak viven en el servidor SQL y se administran allí.
    try {
      await aplicarRetencion(
        path.resolve(respaldo.destino),
        copia.prefijo,
        respaldo.retencionDias,
      );
    } catch (error) {
      logger.warn(`No se pudo limpiar el destino de "${respaldo.nombre}"`, error);
    }

    registrarEjecucionRespaldo(
      respaldo.id,
      'ok',
      `Copia completada en ${rutaCopia}`,
      inicio.toISOString(),
      {
        duracionMs: Date.now() - inicio.getTime(),
        archivos: metricas?.archivos ?? null,
        bytes: metricas?.bytes ?? null,
        ubicacion: rutaCopia,
      },
    );
    actualizarEstadoRespaldo(respaldo.id, 'ok', inicio.toISOString(), proximaEjecucion);
    logger.info(`Copia "${respaldo.nombre}" completada`, rutaCopia);
  } catch (error) {
    if (ejecucionRegistrada) {
      throw error;
    }

    const mensaje = error instanceof Error ? error.message : String(error);

    logger.error(`Falló la copia "${respaldo.nombre}"`, error);
    registrarEjecucionRespaldo(respaldo.id, 'error', mensaje, inicio.toISOString(), {
      duracionMs: Date.now() - inicio.getTime(),
    });
    actualizarEstadoRespaldo(respaldo.id, 'error', inicio.toISOString(), proximaEjecucion);

    throw error;
  } finally {
    depurarHistorialSeguro(respaldo);
    enEjecucion.delete(respaldo.id);
    notificarCambioEjecucion(respaldo.id, false);
  }
}

// La retención de la tarea también aplica al historial guardado en la base local.
function depurarHistorialSeguro(respaldo: RespaldoConfigurado): void {
  try {
    const borradas = depurarHistorialAntiguo(respaldo.id, respaldo.retencionDias);

    if (borradas > 0) {
      logger.info(`Historial de "${respaldo.nombre}" depurado`, { ejecuciones: borradas });
    }
  } catch (error) {
    logger.warn(`No se pudo depurar el historial de "${respaldo.nombre}"`, error);
  }
}

export async function ejecutarRespaldoAhora(id: number): Promise<void> {
  const respaldo = obtenerRespaldo(id);

  if (!respaldo) {
    throw new Error('La copia indicada no existe.');
  }

  if (!respaldo.habilitado) {
    throw new Error('La copia está deshabilitada. Habilítala antes de ejecutarla.');
  }

  await ejecutarRespaldoInterno(respaldo);
}

async function comprobarRespaldosProgramados(): Promise<void> {
  if (comprobando) {
    return;
  }

  comprobando = true;

  try {
    const pendientes = listarRespaldosVencidos(new Date().toISOString());

    for (const respaldo of pendientes) {
      if (enEjecucion.has(respaldo.id)) {
        continue;
      }

      try {
        await ejecutarRespaldoInterno(respaldo);
      } catch {
        // El error ya quedó registrado en el historial y en el estado de la copia.
      }
    }
  } catch (error) {
    logger.error('No se pudieron comprobar las copias programadas', error);
  } finally {
    comprobando = false;
  }
}

export function iniciarProgramador(): void {
  if (temporizador) {
    return;
  }

  try {
    normalizarProximasEjecuciones();
  } catch (error) {
    logger.warn('No se pudieron normalizar las próximas ejecuciones', error);
  }

  setTimeout(() => {
    void comprobarRespaldosProgramados();
  }, RETRASO_INICIAL_MS);

  temporizador = setInterval(() => {
    void comprobarRespaldosProgramados();
  }, INTERVALO_COMPROBACION_MS);

  logger.info('Programador de copias iniciado');
}

export function detenerProgramador(): void {
  if (!temporizador) {
    return;
  }

  clearInterval(temporizador);
  temporizador = null;
}
