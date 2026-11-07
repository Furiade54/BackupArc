import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels';
import type {
  ErrorCapturadoRenderer,
  ReportePreparado,
  ResultadoIpc,
  ResumenDiagnostico,
} from '../../shared/types/api.types';
import {
  comprobarLimiteDeReportes,
  exportarDiagnostico,
  obtenerResumenDiagnostico,
  prepararReporte,
  registrarErrorDeRenderer,
  registrarReporteEnviado,
} from '../services/diagnostico.service';
import { obtenerCarpetaLogs } from '../utils/logger';
import { validarRemitente } from './remitente';

function recortar(valor: unknown, maximo: number): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor.slice(0, maximo) : null;
}

function validarErrorRenderer(datos: unknown): ErrorCapturadoRenderer {
  if (typeof datos !== 'object' || datos === null) {
    throw new Error('El error de la interfaz no es válido.');
  }

  const valor = datos as Record<string, unknown>;
  const mensaje = recortar(valor.mensaje, 4000);

  if (!mensaje) {
    throw new Error('El error de la interfaz no incluye un mensaje.');
  }

  return {
    origen: recortar(valor.origen, 80) ?? 'desconocido',
    mensaje,
    pila: recortar(valor.pila, 8000),
    componente: recortar(valor.componente, 200),
    contexto: recortar(valor.contexto, 1000),
  };
}

export function registrarIpcDiagnostico(): void {
  ipcMain.handle(
    IPC_CHANNELS.DIAGNOSTICO_REGISTRAR_ERROR,
    (evento, datos: unknown): ResultadoIpc<void> => {
      validarRemitente(evento);
      registrarErrorDeRenderer(validarErrorRenderer(datos));
      return { ok: true, datos: undefined };
    },
  );

  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICO_RESUMEN, (evento): ResultadoIpc<ResumenDiagnostico> => {
    validarRemitente(evento);
    return { ok: true, datos: obtenerResumenDiagnostico() };
  });

  ipcMain.handle(
    IPC_CHANNELS.DIAGNOSTICO_REPORTAR,
    async (evento): Promise<ResultadoIpc<ReportePreparado>> => {
      validarRemitente(evento);

      const limite = comprobarLimiteDeReportes();

      if (limite) {
        return { ok: false, error: limite };
      }

      const reporte = prepararReporte();

      // Solo se abre el navegador: el usuario confirma el envío en GitHub con
      // su propia cuenta, así no se distribuye ningún token en el ejecutable.
      await shell.openExternal(reporte.url);
      registrarReporteEnviado();

      return { ok: true, datos: reporte };
    },
  );

  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICO_EXPORTAR, (evento): ResultadoIpc<string> => {
    validarRemitente(evento);
    return { ok: true, datos: exportarDiagnostico() };
  });

  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICO_ABRIR_LOGS, async (evento): Promise<ResultadoIpc<void>> => {
    validarRemitente(evento);

    const carpeta = obtenerCarpetaLogs();

    if (!carpeta) {
      throw new Error('No se pudo abrir la carpeta de registros.');
    }

    const mensaje = await shell.openPath(carpeta);

    if (mensaje) {
      throw new Error(mensaje);
    }

    return { ok: true, datos: undefined };
  });
}
