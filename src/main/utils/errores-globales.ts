import { app, crashReporter } from 'electron';
import { logger } from './logger';

// La captura global se registra lo antes posible en el arranque del proceso
// principal. Los fallos no cierran la aplicación: se registran para que el
// usuario pueda seguir trabajando y reportarlos después.
export function registrarCapturaGlobalDeErrores(): void {
  process.on('uncaughtException', (error) => {
    logger.error('Excepción no capturada en el proceso principal', error);
  });

  process.on('unhandledRejection', (motivo) => {
    logger.error('Promesa rechazada sin manejar en el proceso principal', motivo);
  });

  app.on('render-process-gone', (_evento, _contenido, detalles) => {
    logger.error('El proceso de renderizado terminó de forma anómala', detalles);
  });

  app.on('child-process-gone', (_evento, detalles) => {
    logger.error('Un proceso hijo terminó de forma anómala', detalles);
  });

  try {
    // Sin submitURL no se sube nada: los volcados quedan en userData y solo
    // se adjuntan si el usuario decide crear un reporte.
    crashReporter.start({
      productName: 'BackupArc',
      companyName: 'BackupArc',
      submitURL: '',
      uploadToServer: false,
      compress: true,
    });
    logger.info('Recolector de fallos local iniciado');
  } catch (error) {
    logger.warn('No se pudo iniciar el recolector de fallos local', error);
  }
}
