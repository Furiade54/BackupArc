export function slug(texto: string): string {
  const limpio = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return limpio.length > 0 ? limpio : 'respaldo';
}

// Formato compacto para nombres de archivo: 20261022131100.
export function marcaTiempo(fecha: Date): string {
  const dosDigitos = (valor: number) => String(valor).padStart(2, '0');

  return [
    `${fecha.getFullYear()}${dosDigitos(fecha.getMonth() + 1)}${dosDigitos(fecha.getDate())}`,
    `${dosDigitos(fecha.getHours())}${dosDigitos(fecha.getMinutes())}${dosDigitos(fecha.getSeconds())}`,
  ].join('');
}
