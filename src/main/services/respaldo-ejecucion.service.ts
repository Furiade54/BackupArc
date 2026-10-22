import { createWriteStream, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { ZipArchive, type ArchiverError } from 'archiver';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type { RespaldoConfigurado } from '../../shared/types/respaldo.types';
import {
  actualizarEstadoRespaldo,
  calcularSiguienteEjecucion,
  listarRespaldosVencidos,
  normalizarProximasEjecuciones,
  obtenerRespaldo,
  registrarEjecucionRespaldo,
} from '../repositories/respaldos-local.repository';
import { logger } from '../utils/logger';
import { marcaTiempo, slug } from '../utils/nombres-respaldo';
import { respaldarBasesDatosMssql } from './respaldo-mssql.service';

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

interface OrigenRespaldo {
  ruta: string;
  esCarpeta: boolean;
}

// Valida origen/destino y devuelve el origen tipado junto al destino absoluto.
async function prepararRutas(respaldo: RespaldoConfigurado): Promise<{ origen: OrigenRespaldo; destino: string }> {
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

  return { origen: { ruta: rutaOrigen, esCarpeta }, destino };
}

async function copiarOrigen(respaldo: RespaldoConfigurado, fecha: Date): Promise<string> {
  const { origen, destino } = await prepararRutas(respaldo);
  const prefijo = slug(respaldo.nombre);
  const nombreBase = respaldo.copiaConFecha ? `${prefijo}_${marcaTiempo(fecha)}` : prefijo;

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

    return rutaCopia;
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

  return rutaCopia;
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

async function comprimirOrigen(respaldo: RespaldoConfigurado, fecha: Date): Promise<string> {
  const { origen, destino } = await prepararRutas(respaldo);
  const prefijo = slug(respaldo.nombre);
  const nombreBase = respaldo.copiaConFecha ? `${prefijo}_${marcaTiempo(fecha)}` : prefijo;
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

  return rutaZip;
}

async function aplicarRetencion(destino: string, prefijo: string, retencionDias: number): Promise<void> {
  const limite = Date.now() - retencionDias * 24 * 60 * 60 * 1000;
  const entradas = await fs.readdir(destino, { withFileTypes: true });

  for (const entrada of entradas) {
    // Aplica a carpetas, .zip y archivos sueltos creados con fecha.
    const esCopiaConFecha = entrada.name.startsWith(`${prefijo}_`);

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

async function ejecutarRespaldoInterno(respaldo: RespaldoConfigurado): Promise<void> {
  if (enEjecucion.has(respaldo.id)) {
    throw new Error('La copia ya se está ejecutando.');
  }

  enEjecucion.add(respaldo.id);
  notificarCambioEjecucion(respaldo.id, true);

  const inicio = new Date();
  const proximaEjecucion = calcularSiguienteEjecucion(inicio, respaldo.frecuenciaMinutos);

  try {
    const rutaCopia =
      respaldo.tipo === 'mssql'
        ? await respaldarBasesDatosMssql(respaldo, inicio)
        : respaldo.comprimir
          ? await comprimirOrigen(respaldo, inicio)
          : await copiarOrigen(respaldo, inicio);

    // La retención solo aplica a los archivos que copia la propia aplicación;
    // los .bak viven en el servidor SQL y se administran allí.
    if (respaldo.tipo === 'archivos') {
      try {
        await aplicarRetencion(
          path.resolve(respaldo.destino),
          slug(respaldo.nombre),
          respaldo.retencionDias,
        );
      } catch (error) {
        logger.warn(`No se pudo limpiar el destino de "${respaldo.nombre}"`, error);
      }
    }

    registrarEjecucionRespaldo(
      respaldo.id,
      'ok',
      `Copia completada en ${rutaCopia}`,
      inicio.toISOString(),
    );
    actualizarEstadoRespaldo(respaldo.id, 'ok', inicio.toISOString(), proximaEjecucion);
    logger.info(`Copia "${respaldo.nombre}" completada`, rutaCopia);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);

    logger.error(`Falló la copia "${respaldo.nombre}"`, error);
    registrarEjecucionRespaldo(respaldo.id, 'error', mensaje, inicio.toISOString());
    actualizarEstadoRespaldo(respaldo.id, 'error', inicio.toISOString(), proximaEjecucion);

    throw error;
  } finally {
    enEjecucion.delete(respaldo.id);
    notificarCambioEjecucion(respaldo.id, false);
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
