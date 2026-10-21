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
import { avisarActualizacionDisponible } from '../tray';
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

function ejecutarInstalador(rutaMsi: string): void {
  const comando = [
    'Start-Sleep -Seconds 2',
    `Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i "${rutaMsi.replace(/'/g, "''")}" /passive /norestart' -Verb RunAs`,
  ].join('; ');

  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', comando], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

export async function instalarActualizacion(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('La instalación automática solo está disponible en Windows.');
  }

  const { url, version } = await obtenerInstalador();
  const rutaMsi = await descargarInstalador(url, version);

  logger.info('Instalador descargado, iniciando instalación', rutaMsi);
  ejecutarInstalador(rutaMsi);

  setTimeout(() => {
    marcarSalida();
    app.quit();
  }, 500);
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
      avisarActualizacionDisponible(resultado.versionDisponible, resultado.urlPublicacion);
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
