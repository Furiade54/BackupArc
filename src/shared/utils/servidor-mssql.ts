const SERVIDORES_LOCALES = new Set(['', '.', '(local)', 'localhost', '127.0.0.1', '::1', '0.0.0.0']);

/**
 * Heurística para proponer la ubicación del servidor. Solo se usa como valor
 * inicial: la decisión final la toma el usuario, porque un equipo puede
 * alcanzarse por su nombre de red o por una IP. Se marcan como remotos las IP
 * y los nombres con dominio; el resto se propone como local.
 */
export function pareceServidorRemoto(servidor: string): boolean {
  const host = servidor.trim().toLowerCase().split('\\')[0];

  if (SERVIDORES_LOCALES.has(host)) {
    return false;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }

  return host.includes('.') || host.includes(':');
}
