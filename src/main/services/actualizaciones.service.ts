import { app } from 'electron';
import { CLAVES_CONFIGURACION } from '../../shared/constants/configuracion';
import type { ResultadoActualizacion } from '../../shared/types/api.types';
import { avisarActualizacionDisponible } from '../tray';
import { logger } from '../utils/logger';
import { obtenerPreferenciaConDefecto } from './local-database.service';

const REPOSITORIO = 'Furiade54/BackupArc';
const URL_ULTIMA_PUBLICACION = `https://api.github.com/repos/${REPOSITORIO}/releases/latest`;
const INTERVALO_COMPROBACION_MS = 6 * 60 * 60 * 1000;
const RETRASO_INICIAL_MS = 30_000;
const TIEMPO_LIMITE_MS = 15_000;

interface PublicacionGitHub {
  tag_name?: string;
  html_url?: string;
  body?: string;
}

let temporizador: NodeJS.Timeout | null = null;
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
        mensaje: 'Todavía no hay versiones publicadas en GitHub.',
      };
    }

    if (!respuesta.ok) {
      const limiteAlcanzado = respuesta.headers.get('x-ratelimit-remaining') === '0';

      return {
        ...resultadoBase('error', versionActual),
        mensaje: limiteAlcanzado
          ? 'Se alcanzó el límite de consultas a GitHub. Inténtalo más tarde.'
          : `GitHub respondió con el código ${respuesta.status}.`,
      };
    }

    const publicacion = (await respuesta.json()) as PublicacionGitHub;
    const versionDisponible = publicacion.tag_name ? normalizarVersion(publicacion.tag_name) : '';

    if (!versionDisponible) {
      return {
        ...resultadoBase('error', versionActual),
        mensaje: 'La publicación de GitHub no incluye una versión válida.',
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
          ? 'La consulta a GitHub tardó demasiado.'
          : 'No se pudo conectar con GitHub. Revisa tu conexión a internet.',
    };
  } finally {
    clearTimeout(limiteTiempo);
  }
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
    logger.warn('Falló la comprobación periódica de actualizaciones', error);
  } finally {
    comprobando = false;
  }
}

export function comprobarActualizacionesAhora(): void {
  void comprobarEnSegundoPlano();
}

export function iniciarComprobadorActualizaciones(): void {
  if (temporizador) {
    return;
  }

  comprobacionInicial = setTimeout(() => {
    void comprobarEnSegundoPlano();
  }, RETRASO_INICIAL_MS);

  temporizador = setInterval(() => {
    void comprobarEnSegundoPlano();
  }, INTERVALO_COMPROBACION_MS);

  logger.info('Comprobador de actualizaciones iniciado');
}

export function detenerComprobadorActualizaciones(): void {
  if (comprobacionInicial) {
    clearTimeout(comprobacionInicial);
    comprobacionInicial = null;
  }

  if (!temporizador) {
    return;
  }

  clearInterval(temporizador);
  temporizador = null;
}
