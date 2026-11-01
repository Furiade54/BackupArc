import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { logger } from './logger';

// Ninguna copia se escribe con su nombre final: se prepara aquí y solo se
// publica (rename) cuando el contenido ya está completo y verificado.
export const DIRECTORIO_PREPARACION = '.backuparc-staging';

// Margen para no borrar la preparación de otra instancia en curso.
const EDAD_MINIMA_ABANDONO_MS = 5 * 60 * 1000;

const runIdsEnCurso = new Set<string>();

export function carpetaPreparacion(destino: string, runId: string): string {
  return path.join(destino, DIRECTORIO_PREPARACION, runId);
}

// Retira preparaciones de corridas que ya no están activas: son restos de un
// cierre inesperado y no deben quedar como backups a medias en el destino.
export async function limpiarPreparacionesAbandonadas(
  destino: string,
  runIdActual: string | null,
): Promise<void> {
  const raiz = path.join(destino, DIRECTORIO_PREPARACION);
  let entradas: Dirent[];

  try {
    entradas = await fs.readdir(raiz, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entrada of entradas) {
    if (
      !entrada.isDirectory() ||
      entrada.name === runIdActual ||
      runIdsEnCurso.has(entrada.name)
    ) {
      continue;
    }

    const ruta = path.join(raiz, entrada.name);

    try {
      const info = await fs.stat(ruta);

      if (Date.now() - info.mtimeMs < EDAD_MINIMA_ABANDONO_MS) {
        continue;
      }

      await fs.rm(ruta, { recursive: true, force: true });
      logger.warn('Preparación abandonada eliminada', ruta);
    } catch (error) {
      logger.warn(`No se pudo limpiar la preparación abandonada ${ruta}`, error);
    }
  }

  try {
    if ((await fs.readdir(raiz)).length === 0) {
      await fs.rmdir(raiz);
    }
  } catch {
    // La carpeta puede no existir o seguir en uso por otra corrida.
  }
}

export async function crearPreparacion(destino: string, runId: string): Promise<string> {
  await limpiarPreparacionesAbandonadas(destino, runId);

  const carpeta = carpetaPreparacion(destino, runId);
  await fs.mkdir(carpeta, { recursive: true });
  runIdsEnCurso.add(runId);

  return carpeta;
}

export async function liberarPreparacion(carpeta: string, runId: string): Promise<void> {
  runIdsEnCurso.delete(runId);

  try {
    await fs.rm(carpeta, { recursive: true, force: true });
  } catch (error) {
    logger.warn(`No se pudo limpiar la preparación ${carpeta}`, error);
  }
}

// Borra los .zip.parcial que dejó un corte durante la compresión. Solo toca
// archivos con ese sufijo y con antigüedad suficiente para no pisar una
// compresión en curso.
export async function limpiarZipParciales(carpeta: string): Promise<void> {
  let entradas: Dirent[];

  try {
    entradas = await fs.readdir(carpeta, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entrada of entradas) {
    if (!entrada.isFile() || !entrada.name.endsWith('.zip.parcial')) {
      continue;
    }

    const ruta = path.join(carpeta, entrada.name);

    try {
      const info = await fs.stat(ruta);

      if (Date.now() - info.mtimeMs < EDAD_MINIMA_ABANDONO_MS) {
        continue;
      }

      await fs.rm(ruta, { force: true });
      logger.warn('Zip parcial abandonado eliminado', ruta);
    } catch (error) {
      logger.warn(`No se pudo eliminar el zip parcial ${ruta}`, error);
    }
  }
}
