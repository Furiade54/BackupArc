// El origen de una tarea MSSQL guarda la lista de bases como JSON; las tareas
// creadas antes de admitir varias bases guardaban un único nombre en texto plano.
export function parsearBasesDatos(valor: string): string[] {
  const texto = valor.trim();

  if (!texto) {
    return [];
  }

  if (texto.startsWith('[')) {
    try {
      const datos: unknown = JSON.parse(texto);

      if (Array.isArray(datos)) {
        return datos
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
    } catch {
      // Formato antiguo o inválido: se interpreta como un único nombre.
    }
  }

  return [texto];
}

export function serializarBasesDatos(bases: string[]): string {
  return JSON.stringify(
    bases.map((base) => base.trim()).filter((base) => base.length > 0),
  );
}

// Bases del sistema: no se respaldan en las tareas programadas.
const BASES_SISTEMA = new Set(['master', 'model', 'msdb', 'tempdb']);

export function esBaseDeSistema(nombre: string): boolean {
  return BASES_SISTEMA.has(nombre.trim().toLowerCase());
}

export function formatearBasesDatos(valor: string): string {
  const bases = parsearBasesDatos(valor);

  if (bases.length <= 3) {
    return bases.join(', ');
  }

  return `${bases.slice(0, 2).join(', ')} y ${bases.length - 2} más`;
}
