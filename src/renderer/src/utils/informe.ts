// Utilidades compartidas por el informe por tarea y el informe global.

export function formatearTamano(bytes: number | null): string {
  if (!bytes || bytes <= 0) {
    return '—';
  }

  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let indice = 0;

  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }

  const decimales = indice === 0 || valor >= 10 ? 0 : 1;

  return `${valor.toFixed(decimales)} ${unidades[indice]}`;
}

// Fecha del calendario local del equipo, en formato aaaa-MM-dd.
export function fechaLocal(valor: Date): string {
  const dia = String(valor.getDate()).padStart(2, '0');
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  return `${valor.getFullYear()}-${mes}-${dia}`;
}

// El servidor entrega aaaa-MM-dd: se muestra tal cual, sin reinterpretar husos.
export function formatearDia(dia: string): string {
  const [anio, mes, numero] = dia.split('-');
  return anio && mes && numero ? `${anio}/${mes}/${numero}` : dia;
}

export function agruparPorDia<T extends { dia: string }>(archivos: T[]): [string, T[]][] {
  const grupos = new Map<string, T[]>();

  for (const archivo of archivos) {
    const lista = grupos.get(archivo.dia) ?? [];
    lista.push(archivo);
    grupos.set(archivo.dia, lista);
  }

  return [...grupos.entries()];
}
