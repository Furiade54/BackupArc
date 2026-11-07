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
  calcularProximaEjecucion,
  depurarHistorialAntiguo,
  finalizarEjecucionRespaldo,
  listarRespaldos,
  listarRespaldosVencidos,
  normalizarProximasEjecuciones,
  obtenerRespaldo,
  recuperarEjecucionesInterrumpidas,
  registrarEjecucionEnCurso,
  registrarResultadosBase,
} from '../repositories/respaldos-local.repository';
import { logger } from '../utils/logger';
import { marcaTiempo, slug } from '../utils/nombres-respaldo';
import {
  crearPreparacion,
  liberarPreparacion,
  limpiarPreparacionesAbandonadas,
  limpiarZipParciales,
} from '../utils/publicacion';
import { crearRunId, respaldarBasesDatosMssql } from './respaldo-mssql.service';

const INTERVALO_COMPROBACION_MS = 60_000;
const RETRASO_INICIAL_MS = 10_000;

const enEjecucion = new Set<number>();
const esperasDeCierre: Array<() => void> = [];
let temporizador: NodeJS.Timeout | null = null;
let comprobando = false;
let programadorActivo = false;

export function contarEjecucionesActivas(): number {
  return enEjecucion.size;
}

export function hayEjecucionesActivas(): boolean {
  return enEjecucion.size > 0;
}

// Resuelve cuando ya no queda ninguna copia en ejecución. Permite cerrar la
// aplicación sin cortar a mitad una copia en curso.
export function esperarEjecucionesActivas(): Promise<void> {
  if (enEjecucion.size === 0) {
    return Promise.resolve();
  }

  return new Promise((resolver) => {
    esperasDeCierre.push(resolver);
  });
}

function liberarEsperasDeCierre(): void {
  if (enEjecucion.size > 0) {
    return;
  }

  for (const resolver of esperasDeCierre.splice(0)) {
    resolver();
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

interface CopiaPublicada {
  ruta: string;
  prefijo: string;
  estado: 'ok' | 'advertencia';
  detalle: string | null;
  archivos: number | null;
  bytes: number | null;
}

// Publica el artefacto: el rename dentro del mismo volumen es atómico, así el
// nombre final solo aparece cuando la copia ya está completa y verificada.
async function publicarCopia(
  rutaPreparada: string,
  destino: string,
  nombreBase: string,
  extension: string,
  conFecha: boolean,
  rutaOrigen: string,
): Promise<string> {
  let rutaFinal = path.join(destino, `${nombreBase}${extension}`);

  if (rutaFinal === rutaOrigen) {
    throw new Error('La copia coincidiría con el origen; elige otra carpeta destino.');
  }

  if (conFecha) {
    if (await existeRuta(rutaFinal)) {
      rutaFinal = path.join(destino, `${nombreBase}-${Date.now()}${extension}`);
    }
  } else {
    // Sin fecha, la copia reemplaza a la anterior: se retira antes del rename.
    await fs.rm(rutaFinal, { recursive: true, force: true });
  }

  await fs.rename(rutaPreparada, rutaFinal);

  return rutaFinal;
}

// Compara lo copiado con la medición del origen hecha antes de empezar. Una
// diferencia no invalida la copia —el origen pudo cambiar mientras se copiaba—,
// pero queda registrada como advertencia en el historial.
async function verificarCopia(
  rutaPreparada: string,
  metricas: { archivos: number; bytes: number } | null,
): Promise<{ estado: 'ok' | 'advertencia'; detalle: string | null; archivos: number; bytes: number }> {
  const obtenido = await medirOrigen(rutaPreparada);

  if (!metricas) {
    return {
      estado: 'advertencia',
      detalle: 'No se pudo medir el origen: la copia no se pudo verificar.',
      ...obtenido,
    };
  }

  if (obtenido.archivos !== metricas.archivos || obtenido.bytes !== metricas.bytes) {
    return {
      estado: 'advertencia',
      detalle:
        `Verificación con diferencias: el origen tenía ${metricas.archivos} archivos ` +
        `(${metricas.bytes} bytes) y la copia contiene ${obtenido.archivos} ` +
        `(${obtenido.bytes}). El origen pudo cambiar durante la copia.`,
      ...obtenido,
    };
  }

  return { estado: 'ok', detalle: null, ...obtenido };
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
  runId: string,
  metricas: { archivos: number; bytes: number } | null,
): Promise<CopiaPublicada> {
  const { origen, destino, prefijo } = await prepararRutas(respaldo);
  // Carpetas: nombre20261030105000 · Archivos: nombre_20261030110200.msi
  const nombreBase = respaldo.copiaConFecha
    ? `${prefijo}${origen.esCarpeta ? '' : '_'}${marcaTiempo(fecha)}`
    : prefijo;
  // Archivo suelto: se conserva su extensión y se copia como un único archivo.
  const extension = origen.esCarpeta ? '' : path.extname(origen.ruta);
  const preparacion = await crearPreparacion(destino, runId);
  const rutaPreparada = path.join(preparacion, `${nombreBase}${extension}`);

  try {
    if (origen.esCarpeta) {
      await fs.cp(origen.ruta, rutaPreparada, { recursive: true, force: true, errorOnExist: false });
    } else {
      await fs.copyFile(origen.ruta, rutaPreparada);
    }

    const verificacion = await verificarCopia(rutaPreparada, metricas);
    const rutaFinal = await publicarCopia(
      rutaPreparada,
      destino,
      nombreBase,
      extension,
      respaldo.copiaConFecha,
      origen.ruta,
    );

    return {
      ruta: rutaFinal,
      prefijo,
      estado: verificacion.estado,
      detalle: verificacion.detalle,
      archivos: verificacion.archivos,
      bytes: verificacion.bytes,
    };
  } finally {
    await liberarPreparacion(preparacion, runId);
  }
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
  runId: string,
): Promise<CopiaPublicada> {
  const { origen, destino, prefijo } = await prepararRutas(respaldo);
  // Carpetas: nombre20261030105000.zip · Archivos: nombre_20261030110200.zip
  const nombreBase = respaldo.copiaConFecha
    ? `${prefijo}${origen.esCarpeta ? '' : '_'}${marcaTiempo(fecha)}`
    : prefijo;
  const preparacion = await crearPreparacion(destino, runId);
  // El .zip se escribe dentro de la preparación: si falla, no queda visible.
  const rutaPreparada = path.join(preparacion, `${nombreBase}.zip`);

  try {
    await empaquetar(origen, rutaPreparada);

    const info = await fs.stat(rutaPreparada);

    if (!info.isFile() || info.size === 0) {
      throw new Error('El .zip generado quedó vacío; la copia no se publica.');
    }

    const rutaFinal = await publicarCopia(
      rutaPreparada,
      destino,
      nombreBase,
      '.zip',
      respaldo.copiaConFecha,
      origen.ruta,
    );

    return {
      ruta: rutaFinal,
      prefijo,
      estado: 'ok',
      detalle: null,
      archivos: null,
      bytes: info.size,
    };
  } finally {
    await liberarPreparacion(preparacion, runId);
  }
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
  logger.info(`Copia "${respaldo.nombre}" iniciada`, {
    id: respaldo.id,
    tipo: respaldo.tipo,
    origen: respaldo.origen,
    destino: respaldo.destino,
  });

  const inicio = new Date();
  // La hora fijada de la tarea manda también en los ciclos posteriores: una
  // copia diaria de las 23:10 se reprograma a las 23:10, no al instante en
  // que terminó la corrida anterior.
  const proximaEjecucion = calcularProximaEjecucion(
    respaldo.horaEjecucion,
    respaldo.frecuenciaMinutos,
    inicio,
  );
  // En MSSQL la ejecución y sus resultados se guardan antes de propagar el
  // error resumido, para no duplicar el registro en el historial.
  let ejecucionRegistrada = false;
  // El registro nace antes de trabajar: si la app se cierra a mitad de la
  // copia, la corrida queda abierta y se detecta como interrumpida al arrancar.
  let ejecucionId: number | null = null;

  try {
    ejecucionId = registrarEjecucionEnCurso(respaldo.id, inicio.toISOString());

    if (respaldo.tipo === 'mssql') {
      const runId = crearRunId();
      const { resultados, tipoResumen } = await respaldarBasesDatosMssql(respaldo, inicio, runId);
      const errores = resultados.filter((resultado) => resultado.estado === 'error');
      const advertencias = resultados.filter((resultado) => resultado.estado === 'advertencia');
      const estado = errores.length > 0 ? 'error' : advertencias.length > 0 ? 'advertencia' : 'ok';
      const detalle = resumirResultadosMssql(resultados);

      finalizarEjecucionRespaldo(ejecucionId, estado, detalle, {
        tipo: tipoResumen,
        runId,
        duracionMs: Date.now() - inicio.getTime(),
        archivos: resultados.filter((resultado) => resultado.archivo !== null).length,
        bytes: resultados.reduce(
          (total, resultado) =>
            total + (resultado.archivo !== null ? (resultado.tamanoBytes ?? 0) : 0),
          0,
        ),
      });
      registrarResultadosBase(ejecucionId, resultados);
      actualizarEstadoRespaldo(respaldo.id, estado, inicio.toISOString(), proximaEjecucion);
      ejecucionRegistrada = true;

      logger.info(`Copia MSSQL "${respaldo.nombre}" finalizada`, detalle);

      if (errores.length > 0) {
        throw new Error(detalle);
      }

      return;
    }

    // La verificación compara contra la medición del origen hecha antes de copiar.
    const metricas = respaldo.comprimir
      ? null
      : await medirOrigen(respaldo.origen).catch(() => null);
    const runId = crearRunId();
    const copia = respaldo.comprimir
      ? await comprimirOrigen(respaldo, inicio, runId)
      : await copiarOrigen(respaldo, inicio, runId, metricas);
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

    // Solo se registra como válida una copia ya publicada con su nombre final.
    // Si la verificación encontró diferencias, el motivo va en el detalle para
    // que se vea en el historial (la ruta ya se guarda como ubicación).
    const detalleCopia = copia.detalle ?? `Copia completada en ${rutaCopia}`;

    finalizarEjecucionRespaldo(ejecucionId, copia.estado, detalleCopia, {
      runId,
      duracionMs: Date.now() - inicio.getTime(),
      archivos: copia.archivos,
      bytes: copia.bytes,
      ubicacion: rutaCopia,
    });
    actualizarEstadoRespaldo(respaldo.id, copia.estado, inicio.toISOString(), proximaEjecucion);
    logger.info(`Copia "${respaldo.nombre}" completada`, rutaCopia);
  } catch (error) {
    if (ejecucionRegistrada) {
      throw error;
    }

    const mensaje = error instanceof Error ? error.message : String(error);

    logger.error(`Falló la copia "${respaldo.nombre}"`, error);

    if (ejecucionId !== null) {
      finalizarEjecucionRespaldo(ejecucionId, 'error', mensaje, {
        duracionMs: Date.now() - inicio.getTime(),
      });
    }

    actualizarEstadoRespaldo(respaldo.id, 'error', inicio.toISOString(), proximaEjecucion);

    throw error;
  } finally {
    depurarHistorialSeguro(respaldo);
    enEjecucion.delete(respaldo.id);
    notificarCambioEjecucion(respaldo.id, false);
    liberarEsperasDeCierre();
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

// Limpia los restos que dejó un cierre inesperado: preparaciones de corridas y
// zips parciales. Se hace al arrancar porque no hay ninguna corrida activa.
function limpiarRestosAlIniciar(): void {
  let respaldos: RespaldoConfigurado[];

  try {
    respaldos = listarRespaldos();
  } catch (error) {
    logger.warn('No se pudieron leer las tareas para limpiar restos', error);
    return;
  }

  const destinos = new Set(
    respaldos.map((respaldo) => respaldo.destino.trim()).filter((destino) => destino.length > 0),
  );
  // Carpetas donde la app comprime los .bak: ahí pueden quedar .zip.parcial.
  const carpetasZip = new Set(
    respaldos
      .filter((respaldo) => respaldo.tipo === 'mssql' && respaldo.comprimirBak)
      .map((respaldo) => respaldo.carpetaZip.trim() || respaldo.destino.trim())
      .filter((carpeta) => carpeta.length > 0),
  );

  for (const destino of destinos) {
    void limpiarPreparacionesAbandonadas(path.resolve(destino), null);
  }

  for (const carpeta of carpetasZip) {
    void limpiarZipParciales(path.resolve(carpeta));
  }
}

async function comprobarRespaldosProgramados(): Promise<void> {
  if (comprobando || !programadorActivo) {
    return;
  }

  comprobando = true;

  try {
    const pendientes = listarRespaldosVencidos(new Date().toISOString());

    for (const respaldo of pendientes) {
      // Al cerrar la aplicación se dejan de lanzar copias nuevas.
      if (!programadorActivo) {
        break;
      }

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

// Devuelve cuántas corridas interrumpidas se recuperaron al iniciar.
export function iniciarProgramador(): number {
  if (temporizador) {
    return 0;
  }

  try {
    normalizarProximasEjecuciones();
  } catch (error) {
    logger.warn('No se pudieron normalizar las próximas ejecuciones', error);
  }

  // Las corridas que quedaron abiertas se marcan como fallidas y su tarea se
  // reprograma: un cierre inesperado no deja trabajo abandonado.
  let recuperadas = 0;

  try {
    recuperadas = recuperarEjecucionesInterrumpidas();

    if (recuperadas > 0) {
      logger.warn('Copias interrumpidas detectadas y reprogramadas', {
        ejecuciones: recuperadas,
      });
    }
  } catch (error) {
    logger.warn('No se pudieron recuperar las copias interrumpidas', error);
  }

  limpiarRestosAlIniciar();

  programadorActivo = true;

  setTimeout(() => {
    void comprobarRespaldosProgramados();
  }, RETRASO_INICIAL_MS);

  temporizador = setInterval(() => {
    void comprobarRespaldosProgramados();
  }, INTERVALO_COMPROBACION_MS);

  logger.info('Programador de copias iniciado');

  return recuperadas;
}

export function detenerProgramador(): void {
  programadorActivo = false;

  if (!temporizador) {
    return;
  }

  clearInterval(temporizador);
  temporizador = null;
}
