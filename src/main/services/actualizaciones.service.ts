import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app, BrowserWindow } from 'electron';
import { CLAVES_CONFIGURACION } from '../../shared/constants/configuracion';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type {
  ProgresoDescargaActualizacion,
  ResultadoActualizacion,
} from '../../shared/types/api.types';
import { avisarActualizacionDisponible, mostrarVentanaPrincipal } from '../tray';
import { logger } from '../utils/logger';
import { marcarSalida } from '../window';
import { obtenerPreferenciaConDefecto } from './local-database.service';

const REPOSITORIO = 'Furiade54/BackupArc';
const URL_ULTIMA_PUBLICACION = `https://api.github.com/repos/${REPOSITORIO}/releases/latest`;
const PREFIJO_DESCARGA = `https://github.com/${REPOSITORIO}/releases/download/`;
const TIEMPO_LIMITE_MS = 15_000;
const INTERVALO_PROGRESO_MS = 200;
const RETRASO_INICIAL_MS = 10_000;

interface ActivoPublicacion {
  name?: string;
  browser_download_url?: string;
}

interface PublicacionGitHub {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: ActivoPublicacion[];
}

let comprobacionInicial: NodeJS.Timeout | null = null;
let comprobando = false;
let versionAvisada: string | null = null;

function normalizarVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compararVersiones(izquierda: string, derecha: string): number {
  const [baseIzquierda, preIzquierda] = normalizarVersion(izquierda).split('-', 2);
  const [baseDerecha, preDerecha] = normalizarVersion(derecha).split('-', 2);
  const partesIzquierda = baseIzquierda.split('.').map((parte) => Number.parseInt(parte, 10) || 0);
  const partesDerecha = baseDerecha.split('.').map((parte) => Number.parseInt(parte, 10) || 0);
  const total = Math.max(partesIzquierda.length, partesDerecha.length);

  for (let indice = 0; indice < total; indice += 1) {
    const valorIzquierda = partesIzquierda[indice] ?? 0;
    const valorDerecha = partesDerecha[indice] ?? 0;

    if (valorIzquierda !== valorDerecha) {
      return valorIzquierda > valorDerecha ? 1 : -1;
    }
  }

  if (preIzquierda && !preDerecha) {
    return -1;
  }

  if (!preIzquierda && preDerecha) {
    return 1;
  }

  if (preIzquierda && preDerecha && preIzquierda !== preDerecha) {
    return preIzquierda.localeCompare(preDerecha, undefined, { numeric: true });
  }

  return 0;
}

function resultadoBase(estado: ResultadoActualizacion['estado'], versionActual: string): ResultadoActualizacion {
  return {
    estado,
    versionActual,
    versionDisponible: null,
    urlPublicacion: null,
    notas: null,
    mensaje: null,
  };
}

export async function buscarActualizaciones(): Promise<ResultadoActualizacion> {
  const versionActual = app.getVersion();
  const controlador = new AbortController();
  const limiteTiempo = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);

  try {
    const respuesta = await fetch(URL_ULTIMA_PUBLICACION, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `BackupArc/${versionActual}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controlador.signal,
    });

    if (respuesta.status === 404) {
      return {
        ...resultadoBase('actualizado', versionActual),
        mensaje: 'Todavía no hay versiones publicadas.',
      };
    }

    if (!respuesta.ok) {
      const limiteAlcanzado = respuesta.headers.get('x-ratelimit-remaining') === '0';

      return {
        ...resultadoBase('error', versionActual),
        mensaje: limiteAlcanzado
          ? 'Se alcanzó el límite de consultas. Inténtalo más tarde.'
          : `La consulta respondió con el código ${respuesta.status}.`,
      };
    }

    const publicacion = (await respuesta.json()) as PublicacionGitHub;
    const versionDisponible = publicacion.tag_name ? normalizarVersion(publicacion.tag_name) : '';

    if (!versionDisponible) {
      return {
        ...resultadoBase('error', versionActual),
        mensaje: 'La publicación no incluye una versión válida.',
      };
    }

    const urlPublicacion = publicacion.html_url ?? null;

    if (compararVersiones(versionDisponible, versionActual) <= 0) {
      return {
        ...resultadoBase('actualizado', versionActual),
        versionDisponible,
        urlPublicacion,
        mensaje: `Estás usando la última versión disponible (${versionActual}).`,
      };
    }

    return {
      estado: 'disponible',
      versionActual,
      versionDisponible,
      urlPublicacion,
      notas: publicacion.body ?? null,
      mensaje: null,
    };
  } catch (error) {
    logger.warn('No se pudo consultar GitHub Releases', error);

    return {
      ...resultadoBase('error', versionActual),
      mensaje:
        error instanceof Error && error.name === 'AbortError'
          ? 'La consulta tardó demasiado.'
          : 'No se pudo conectar con el servidor de actualizaciones. Revisa tu conexión a internet.',
    };
  } finally {
    clearTimeout(limiteTiempo);
  }
}

function notificarProgresoDescarga(progreso: ProgresoDescargaActualizacion): void {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed() && !ventana.webContents.isDestroyed()) {
      ventana.webContents.send(IPC_CHANNELS.ACTUALIZACIONES_PROGRESO, progreso);
    }
  }
}

async function obtenerInstalador(): Promise<{ url: string; version: string }> {
  const versionActual = app.getVersion();
  const respuesta = await fetch(URL_ULTIMA_PUBLICACION, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `BackupArc/${versionActual}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!respuesta.ok) {
    throw new Error(`La consulta respondió con el código ${respuesta.status}.`);
  }

  const publicacion = (await respuesta.json()) as PublicacionGitHub;
  const version = publicacion.tag_name ? normalizarVersion(publicacion.tag_name) : '';

  if (!version || compararVersiones(version, versionActual) <= 0) {
    throw new Error('No hay una versión más reciente para instalar.');
  }

  const instalador = publicacion.assets?.find((activo) =>
    (activo.name ?? '').toLowerCase().endsWith('.msi'),
  );
  const url = instalador?.browser_download_url ?? '';

  if (!url.startsWith(PREFIJO_DESCARGA)) {
    throw new Error('La publicación no incluye un instalador MSI válido.');
  }

  return { url, version };
}

async function descargarInstalador(url: string, version: string): Promise<string> {
  const destino = path.join(app.getPath('temp'), `BackupArc-${version}.msi`);
  const respuesta = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `BackupArc/${app.getVersion()}`,
    },
  });

  if (!respuesta.ok || !respuesta.body) {
    throw new Error(`No se pudo descargar el instalador (código ${respuesta.status}).`);
  }

  const total = Number(respuesta.headers.get('content-length') ?? 0);
  const origen = Readable.fromWeb(respuesta.body as Parameters<typeof Readable.fromWeb>[0]);
  let descargado = 0;
  let ultimoAviso = 0;

  origen.on('data', (trozo: Buffer) => {
    descargado += trozo.length;

    const ahora = Date.now();

    if (ahora - ultimoAviso < INTERVALO_PROGRESO_MS && descargado !== total) {
      return;
    }

    ultimoAviso = ahora;
    notificarProgresoDescarga({
      porcentaje: total > 0 ? Math.min(100, Math.round((descargado / total) * 100)) : 0,
      descargado,
      total,
    });
  });

  await pipeline(origen, createWriteStream(destino));
  notificarProgresoDescarga({ porcentaje: 100, descargado, total: total || descargado });

  return destino;
}

// Lanza el instalador elevado. La promesa se resuelve cuando el usuario acepta
// el aviso de permisos de Windows y se rechaza si lo cancela.
function ejecutarInstalador(rutaMsi: string): Promise<void> {
  const rutaSegura = rutaMsi.replace(/'/g, "''");
  const comando = [
    'Start-Sleep -Seconds 1',
    'try {',
    `  Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i "${rutaSegura}" /passive /norestart' -Verb RunAs -ErrorAction Stop`,
    '  exit 0',
    '} catch {',
    '  Write-Output $_.Exception.Message',
    '  exit 1',
    '}',
  ].join('\n');

  return new Promise((resolve, reject) => {
    const hijo = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], {
      windowsHide: true,
    });

    let salida = '';

    hijo.stdout?.on('data', (trozo: Buffer) => {
      salida += trozo.toString();
    });
    hijo.stderr?.on('data', (trozo: Buffer) => {
      salida += trozo.toString();
    });
    hijo.on('error', reject);
    hijo.on('close', (codigo) => {
      if (codigo === 0) {
        resolve();
        return;
      }

      logger.warn('No se pudo iniciar el instalador elevado', salida.trim());
      reject(
        new Error(
          'No se concedieron los permisos de administrador. Acepta el aviso de Windows para instalar la actualización.',
        ),
      );
    });
  });
}

// Un proceso independiente espera a que el instalador termine y vuelve a abrir
// la app: la actualización se ejecuta aparte y el proceso actual se cierra.
function programarReinicioTrasInstalacion(): void {
  const escapar = (valor: string) => valor.replace(/'/g, "''");
  const comando = [
    // Margen para que msiexec arranque antes de la primera comprobación.
    'Start-Sleep -Seconds 3',
    '$limite = (Get-Date).AddMinutes(30)',
    'while ((Get-Date) -lt $limite) {',
    '  if (-not (Get-Process -Name msiexec -ErrorAction SilentlyContinue)) { break }',
    '  Start-Sleep -Seconds 2',
    '}',
    // El instalador puede tardar en liberar los archivos: se reintenta abrir.
    'Start-Sleep -Seconds 2',
    'for ($i = 0; $i -lt 30; $i++) {',
    `  try { Start-Process -FilePath '${escapar(process.execPath)}' -ErrorAction Stop; break } catch { Start-Sleep -Seconds 2 }`,
    '}',
  ].join('\n');

  try {
    const hijo = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', comando],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );

    hijo.unref();
    logger.info('Reinicio programado para después de la instalación', process.execPath);
  } catch (error) {
    logger.warn('No se pudo programar el reinicio tras la actualización', error);
  }
}

export async function instalarActualizacion(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('La instalación automática solo está disponible en Windows.');
  }

  const { url, version } = await obtenerInstalador();
  const rutaMsi = await descargarInstalador(url, version);

  logger.info('Instalador descargado, solicitando permisos de administrador', rutaMsi);
  await ejecutarInstalador(rutaMsi);

  // Solo se programa el reinicio si el usuario aceptó los permisos: así, al
  // cancelar el aviso de Windows, la app sigue abierta mostrando el error.
  programarReinicioTrasInstalacion();

  marcarSalida();
  app.quit();
}

function actualizacionesHabilitadas(): boolean {
  return obtenerPreferenciaConDefecto(CLAVES_CONFIGURACION.buscarActualizaciones, '1') === '1';
}

async function comprobarEnSegundoPlano(): Promise<void> {
  if (comprobando || !actualizacionesHabilitadas()) {
    return;
  }

  comprobando = true;

  try {
    const resultado = await buscarActualizaciones();

    if (
      resultado.estado === 'disponible' &&
      resultado.versionDisponible &&
      resultado.urlPublicacion &&
      resultado.versionDisponible !== versionAvisada
    ) {
      versionAvisada = resultado.versionDisponible;
      avisarActualizacionDisponible(resultado.versionDisponible, () => {
        // Se muestra la ventana para que el progreso de la descarga sea visible.
        mostrarVentanaPrincipal();
        void instalarActualizacion().catch((error: unknown) => {
          logger.warn('No se pudo descargar la actualización desde el aviso', error);
        });
      });
    }
  } catch (error) {
    logger.warn('Falló la comprobación de actualizaciones', error);
  } finally {
    comprobando = false;
  }
}

export function comprobarActualizacionesAhora(): void {
  void comprobarEnSegundoPlano();
}

export function iniciarComprobadorActualizaciones(): void {
  if (comprobacionInicial) {
    return;
  }

  // Una única comprobación por arranque: la app se abre manualmente o desde
  // el inicio con Windows según la preferencia del usuario.
  comprobacionInicial = setTimeout(() => {
    comprobacionInicial = null;
    void comprobarEnSegundoPlano();
  }, RETRASO_INICIAL_MS);

  logger.info('Comprobación de actualizaciones programada para este inicio');
}

export function detenerComprobadorActualizaciones(): void {
  if (!comprobacionInicial) {
    return;
  }

  clearTimeout(comprobacionInicial);
  comprobacionInicial = null;
}
