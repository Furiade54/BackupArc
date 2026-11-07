// Utilidades para evitar que credenciales lleguen a los archivos de log o a
// un reporte de diagnóstico. No dependen de Electron para poder reutilizarse.

const PATRONES_SENSIBLES: Array<[RegExp, string]> = [
  [/(password|passwd|pwd|contrase(?:n|ñ)a|secret|token|api[-_]?key|authorization)\s*[:=]\s*("[^"]*"|'[^']*'|[^;,\s]+)/gi, '$1=***'],
  [/(bearer)\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer ***'],
  [/(user\s*id|uid)\s*=\s*[^;]+/gi, 'User Id=***'],
  [/(data source|server|initial catalog)\s*=\s*[^;]+/gi, '$1=***'],
];

const CLAVES_SENSIBLES =
  /(pass|passw|contrase|secret|token|api[-_]?key|credencial|authorization|cookie|connectionstring|cadena)/i;

const MAX_TEXTO = 4000;
const MAX_PROFUNDIDAD = 4;
const MAX_ELEMENTOS = 20;

export function redactarTexto(valor: string): string {
  let texto = valor;

  for (const [patron, reemplazo] of PATRONES_SENSIBLES) {
    texto = texto.replace(patron, reemplazo);
  }

  return texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO)}…` : texto;
}

export function sanitizar(valor: unknown, profundidad = 0, vistos = new WeakSet<object>()): unknown {
  if (valor === null || valor === undefined) {
    return valor;
  }

  if (typeof valor === 'string') {
    return redactarTexto(valor);
  }

  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return valor;
  }

  if (typeof valor === 'bigint') {
    return valor.toString();
  }

  if (valor instanceof Error) {
    return {
      nombre: valor.name,
      mensaje: redactarTexto(valor.message),
      pila: valor.stack ? redactarTexto(valor.stack) : undefined,
    };
  }

  if (typeof valor !== 'object') {
    return String(valor);
  }

  if (profundidad >= MAX_PROFUNDIDAD) {
    return '[omitido]';
  }

  if (vistos.has(valor)) {
    return '[circular]';
  }

  vistos.add(valor);

  if (Array.isArray(valor)) {
    return valor.slice(0, MAX_ELEMENTOS).map((elemento) => sanitizar(elemento, profundidad + 1, vistos));
  }

  const salida: Record<string, unknown> = {};

  for (const [clave, contenido] of Object.entries(valor as Record<string, unknown>)) {
    salida[clave] = CLAVES_SENSIBLES.test(clave) ? '***' : sanitizar(contenido, profundidad + 1, vistos);
  }

  return salida;
}

export function serializarDetalle(detalle: unknown): string {
  if (detalle === undefined) {
    return '';
  }

  try {
    return redactarTexto(JSON.stringify(sanitizar(detalle)));
  } catch {
    return redactarTexto(String(detalle));
  }
}
