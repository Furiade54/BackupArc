type Nivel = 'INFO' | 'WARN' | 'ERROR';

function escribir(nivel: Nivel, mensaje: string, detalle?: unknown): void {
  const linea = `[${new Date().toISOString()}] [${nivel}] ${mensaje}`;

  if (nivel === 'ERROR') {
    console.error(linea, detalle ?? '');
  } else if (nivel === 'WARN') {
    console.warn(linea, detalle ?? '');
  } else {
    console.log(linea, detalle ?? '');
  }
}

export const logger = {
  info: (mensaje: string, detalle?: unknown) => escribir('INFO', mensaje, detalle),
  warn: (mensaje: string, detalle?: unknown) => escribir('WARN', mensaje, detalle),
  error: (mensaje: string, detalle?: unknown) => escribir('ERROR', mensaje, detalle),
};
