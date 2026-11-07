import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { redactarTexto, serializarDetalle } from './sanitizar';

export type NivelRegistro = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const PREFIJO = 'backuparc';
const TAMANO_MAXIMO_ARCHIVO = 5 * 1024 * 1024;
const RETENCION_DIAS = 7;
const MAXIMO_ARCHIVOS = 10;

let carpeta: string | null = null;
let pendientes: string[] = [];

function nombreDelDia(fecha: Date): string {
  return `${PREFIJO}-${fecha.toISOString().slice(0, 10)}.log`;
}

function archivosDeLog(destino: string): string[] {
  try {
    return readdirSync(destino)
      .filter((nombre) => nombre.startsWith(PREFIJO) && nombre.endsWith('.log'))
      .map((nombre) => path.join(destino, nombre));
  } catch {
    return [];
  }
}

function depurarArchivos(destino: string): void {
  const limite = Date.now() - RETENCION_DIAS * 24 * 60 * 60 * 1000;
  const archivos = archivosDeLog(destino)
    .map((ruta) => {
      try {
        return { ruta, modificado: statSync(ruta).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((archivo): archivo is { ruta: string; modificado: number } => archivo !== null)
    .sort((izquierda, derecha) => derecha.modificado - izquierda.modificado);

  archivos.forEach((archivo, indice) => {
    if (indice < MAXIMO_ARCHIVOS && archivo.modificado >= limite) {
      return;
    }

    try {
      unlinkSync(archivo.ruta);
    } catch {
      // Un archivo bloqueado se conserva hasta el siguiente arranque.
    }
  });
}

function resolverCarpeta(): string | null {
  if (carpeta) {
    return carpeta;
  }

  try {
    carpeta = path.join(app.getPath('userData'), 'logs');
    mkdirSync(carpeta, { recursive: true });
    depurarArchivos(carpeta);

    // Las líneas emitidas antes de que Electron resolviera userData se
    // escriben ahora, en orden, sin perder el arranque.
    for (const linea of pendientes) {
      escribirEnDisco(linea);
    }

    pendientes = [];
    return carpeta;
  } catch {
    return null;
  }
}

function escribirEnDisco(linea: string): void {
  const destino = carpeta;

  if (!destino) {
    return;
  }

  try {
    const archivo = path.join(destino, nombreDelDia(new Date()));

    if (existsSync(archivo) && statSync(archivo).size >= TAMANO_MAXIMO_ARCHIVO) {
      const marca = new Date().toISOString().replace(/[:.]/g, '-');
      renameSync(archivo, path.join(destino, `${PREFIJO}-${marca}.log`));
      depurarArchivos(destino);
    }

    appendFileSync(archivo, `${linea}\n`, 'utf8');
  } catch {
    // Nunca se interrumpe la aplicación por un fallo al escribir el log.
  }
}

function escribir(nivel: NivelRegistro, mensaje: string, detalle?: unknown): void {
  const texto = redactarTexto(mensaje);
  const extra = serializarDetalle(detalle);
  const linea = `[${new Date().toISOString()}] [${nivel}] ${texto}${extra ? ` ${extra}` : ''}`;

  if (nivel === 'ERROR') {
    console.error(linea);
  } else if (nivel === 'WARN') {
    console.warn(linea);
  } else {
    console.log(linea);
  }

  if (!resolverCarpeta()) {
    // Se guarda un máximo acotado para no crecer sin control si userData falla.
    pendientes.push(linea);

    if (pendientes.length > 500) {
      pendientes.shift();
    }

    return;
  }

  escribirEnDisco(linea);
}

export const logger = {
  debug: (mensaje: string, detalle?: unknown) => escribir('DEBUG', mensaje, detalle),
  info: (mensaje: string, detalle?: unknown) => escribir('INFO', mensaje, detalle),
  warn: (mensaje: string, detalle?: unknown) => escribir('WARN', mensaje, detalle),
  error: (mensaje: string, detalle?: unknown) => escribir('ERROR', mensaje, detalle),
};

export function obtenerCarpetaLogs(): string | null {
  return resolverCarpeta();
}

export function listarArchivosLogs(): Array<{ nombre: string; bytes: number }> {
  const destino = resolverCarpeta();

  if (!destino) {
    return [];
  }

  return archivosDeLog(destino)
    .map((ruta) => {
      try {
        return { nombre: path.basename(ruta), bytes: statSync(ruta).size };
      } catch {
        return null;
      }
    })
    .filter((archivo): archivo is { nombre: string; bytes: number } => archivo !== null)
    .sort((izquierda, derecha) => derecha.nombre.localeCompare(izquierda.nombre));
}

// Devuelve como máximo los últimos `limiteBytes` de los archivos más recientes,
// pensado para construir reportes sin abrir archivos enormes.
export function leerRegistrosRecientes(limiteBytes = 256 * 1024): string {
  const destino = resolverCarpeta();

  if (!destino) {
    return '';
  }

  const archivos = archivosDeLog(destino)
    .map((ruta) => {
      try {
        return { ruta, modificado: statSync(ruta).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((archivo): archivo is { ruta: string; modificado: number } => archivo !== null)
    .sort((izquierda, derecha) => derecha.modificado - izquierda.modificado);

  const partes: string[] = [];
  let restante = limiteBytes;

  for (const archivo of archivos) {
    if (restante <= 0) {
      break;
    }

    try {
      const contenido = readFileSync(archivo.ruta, 'utf8');
      const recorte = contenido.slice(Math.max(0, contenido.length - restante));
      partes.unshift(recorte);
      restante -= recorte.length;
    } catch {
      // Si el archivo no se puede leer se omite del reporte.
    }
  }

  return partes.join('\n');
}
