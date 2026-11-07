import type { ErrorCapturadoRenderer } from '../../../shared/types/api.types';

// Evita que un fallo al reportar genere otro fallo en cadena.
let reportando = false;

export function reportarError(datos: ErrorCapturadoRenderer): void {
  if (reportando) {
    return;
  }

  reportando = true;

  void window.api.diagnostico
    .registrarError(datos)
    .catch(() => undefined)
    .finally(() => {
      reportando = false;
    });
}

export function instalarCapturaDeErrores(): void {
  window.addEventListener('error', (evento) => {
    reportarError({
      origen: 'window.onerror',
      mensaje: evento.message || 'Error desconocido',
      pila: evento.error instanceof Error ? (evento.error.stack ?? null) : null,
      contexto: evento.filename ? `${evento.filename}:${evento.lineno}` : null,
    });
  });

  window.addEventListener('unhandledrejection', (evento) => {
    const motivo = evento.reason;

    reportarError({
      origen: 'unhandledrejection',
      mensaje: motivo instanceof Error ? motivo.message : String(motivo),
      pila: motivo instanceof Error ? (motivo.stack ?? null) : null,
    });
  });
}
