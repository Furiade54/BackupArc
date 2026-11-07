import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type {
  EntradaDiagnostico,
  ErrorCapturadoRenderer,
  ReportePreparado,
  ResumenDiagnostico,
} from '../../shared/types/api.types';
import { listarArchivosLogs, leerRegistrosRecientes, logger, obtenerCarpetaLogs } from '../utils/logger';
import { redactarTexto } from '../utils/sanitizar';
import { guardarPreferencia, obtenerPreferenciaConDefecto } from './local-database.service';

export const REPOSITORIO_GITHUB = 'Furiade54/BackupArc';

const URL_NUEVO_ISSUE = `https://github.com/${REPOSITORIO_GITHUB}/issues/new`;
const CLAVE_REPORTES = 'diagnostico.reportes';
const LIMITE_LOGS_BYTES = 256 * 1024;
const MAXIMO_CUERPO = 2800;
const MAXIMO_ENTRADAS = 10;
const MAXIMO_CARACTERES_LINEA = 400;
const INTERVALO_MINIMO_MS = 60 * 1000;
const MAXIMO_POR_HORA = 5;

const PATRON_LINEA = /^\[([^\]]+)\] \[(DEBUG|INFO|WARN|ERROR)\] (.*)$/;

function analizarRegistros(contenido: string): {
  errores: EntradaDiagnostico[];
  advertencias: EntradaDiagnostico[];
  total: number;
} {
  const errores: EntradaDiagnostico[] = [];
  const advertencias: EntradaDiagnostico[] = [];
  const lineas = contenido.split('\n').filter((linea) => linea.trim().length > 0);

  for (const linea of lineas) {
    const coincidencia = PATRON_LINEA.exec(linea);

    if (!coincidencia) {
      continue;
    }

    const entrada: EntradaDiagnostico = {
      momento: coincidencia[1],
      nivel: coincidencia[2],
      mensaje: redactarTexto(coincidencia[3].slice(0, MAXIMO_CARACTERES_LINEA)),
    };

    if (entrada.nivel === 'ERROR') {
      errores.push(entrada);
    } else if (entrada.nivel === 'WARN') {
      advertencias.push(entrada);
    }
  }

  return {
    errores: errores.slice(-MAXIMO_ENTRADAS),
    advertencias: advertencias.slice(-MAXIMO_ENTRADAS),
    total: lineas.length,
  };
}

export function obtenerResumenDiagnostico(): ResumenDiagnostico {
  const analisis = analizarRegistros(leerRegistrosRecientes(LIMITE_LOGS_BYTES));

  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    plataforma: process.platform,
    arquitectura: process.arch,
    empaquetada: app.isPackaged,
    carpetaLogs: obtenerCarpetaLogs(),
    archivosLog: listarArchivosLogs(),
    erroresRecientes: analisis.errores,
    advertenciasRecientes: analisis.advertencias,
    totalLineas: analisis.total,
  };
}

function formatearEntradas(entradas: EntradaDiagnostico[], vacio: string): string {
  if (entradas.length === 0) {
    return `_${vacio}_`;
  }

  return entradas.map((entrada) => `- \`${entrada.momento}\` ${entrada.mensaje}`).join('\n');
}

function construirCuerpo(resumen: ResumenDiagnostico): string {
  const cuerpo = [
    '## Descripción',
    'Reporte generado automáticamente desde BackupArc. No requiere descripción manual.',
    '',
    '## Entorno',
    `- Versión de BackupArc: ${resumen.version}`,
    `- Electron: ${resumen.electron}`,
    `- Chrome: ${resumen.chrome}`,
    `- Node: ${resumen.node}`,
    `- Sistema operativo: ${resumen.plataforma} (${resumen.arquitectura})`,
    `- Empaquetada: ${resumen.empaquetada ? 'sí' : 'no'}`,
    '',
    '## Errores recientes',
    formatearEntradas(resumen.erroresRecientes, 'Sin errores recientes en el registro.'),
    '',
    '## Advertencias recientes',
    formatearEntradas(resumen.advertenciasRecientes, 'Sin advertencias recientes en el registro.'),
    '',
    '_Los registros completos se pueden adjuntar manualmente desde la carpeta de logs._',
  ].join('\n');

  const saneado = redactarTexto(cuerpo);

  return saneado.length > MAXIMO_CUERPO
    ? `${saneado.slice(0, MAXIMO_CUERPO)}\n\n_Reporte truncado por tamaño._`
    : saneado;
}

export function prepararReporte(): ReportePreparado {
  const resumen = obtenerResumenDiagnostico();
  const titulo = `[Diagnóstico] Fallo en BackupArc ${resumen.version} (${resumen.plataforma}/${resumen.arquitectura})`;
  const cuerpo = construirCuerpo(resumen);
  const parametros = new URLSearchParams({ title: titulo, body: cuerpo, labels: 'bug' });

  return { titulo, cuerpo, url: `${URL_NUEVO_ISSUE}?${parametros.toString()}`, resumen };
}

function leerMarcasDeReporte(): number[] {
  try {
    const datos = JSON.parse(obtenerPreferenciaConDefecto(CLAVE_REPORTES, '[]')) as unknown;
    return Array.isArray(datos)
      ? datos.filter((marca): marca is number => typeof marca === 'number' && Number.isFinite(marca))
      : [];
  } catch {
    return [];
  }
}

// Devuelve el motivo por el que no se puede reportar ahora, o null si se puede.
export function comprobarLimiteDeReportes(): string | null {
  const ahora = Date.now();
  const recientes = leerMarcasDeReporte().filter((marca) => ahora - marca < 60 * 60 * 1000);

  if (recientes.length >= MAXIMO_POR_HORA) {
    return 'Se alcanzó el límite de 5 reportes por hora. Inténtalo más tarde.';
  }

  const ultimo = recientes[recientes.length - 1];

  if (ultimo !== undefined && ahora - ultimo < INTERVALO_MINIMO_MS) {
    const segundos = Math.ceil((INTERVALO_MINIMO_MS - (ahora - ultimo)) / 1000);
    return `Espera ${segundos} segundo(s) antes de enviar otro reporte.`;
  }

  return null;
}

export function registrarReporteEnviado(): void {
  const ahora = Date.now();
  const recientes = leerMarcasDeReporte().filter((marca) => ahora - marca < 60 * 60 * 1000);
  guardarPreferencia(CLAVE_REPORTES, JSON.stringify([...recientes, ahora]));
}

export function registrarErrorDeRenderer(datos: ErrorCapturadoRenderer): void {
  logger.error(`Error en la interfaz (${datos.origen})`, {
    mensaje: datos.mensaje,
    pila: datos.pila ?? undefined,
    componente: datos.componente ?? undefined,
    contexto: datos.contexto ?? undefined,
  });
}

export function exportarDiagnostico(): string {
  const resumen = obtenerResumenDiagnostico();
  const registros = redactarTexto(leerRegistrosRecientes(LIMITE_LOGS_BYTES));
  const carpeta = path.join(app.getPath('userData'), 'diagnosticos');
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const ruta = path.join(carpeta, `diagnostico-${marca}.md`);

  mkdirSync(carpeta, { recursive: true });
  writeFileSync(
    ruta,
    [
      '# Diagnóstico de BackupArc',
      '',
      `- Generado: ${new Date().toISOString()}`,
      `- Versión: ${resumen.version}`,
      `- Electron: ${resumen.electron}`,
      `- Sistema: ${resumen.plataforma} (${resumen.arquitectura})`,
      '',
      '## Registro reciente',
      '```',
      registros || 'Sin registros disponibles.',
      '```',
      '',
    ].join('\n'),
    'utf8',
  );

  logger.info('Diagnóstico exportado a archivo', ruta);
  return ruta;
}
