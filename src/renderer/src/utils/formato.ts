import type { EstadoRespaldo } from '../../../shared/types/respaldo.types';

export const ETIQUETAS_ESTADO: Record<EstadoRespaldo, string> = {
  ok: 'Correcto',
  advertencia: 'Advertencia',
  error: 'Fallido',
  pendiente: 'Pendiente',
};

const formatoHora = new Intl.DateTimeFormat('es-CO', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function fechaValida(valor: string): Date | null {
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function formatearFecha(valor: string | null): string {
  if (!valor) {
    return '—';
  }

  const fecha = fechaValida(valor);

  if (!fecha) {
    return '—';
  }

  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');

  return `${fecha.getFullYear()}/${mes}/${dia}`;
}

export function formatearHora(valor: string): string {
  const fecha = fechaValida(valor);
  return fecha ? formatoHora.format(fecha) : '—';
}

export function formatearFechaHora(valor: string): string {
  const fecha = fechaValida(valor);

  if (!fecha) {
    return '—';
  }

  return `${formatearFecha(valor)} · ${formatoHora.format(fecha)}`;
}

export function formatearFrecuencia(horas: number): string {
  if (!Number.isFinite(horas) || horas <= 0) {
    return '—';
  }

  if (horas % 24 === 0) {
    const dias = horas / 24;
    return dias === 1 ? 'cada 24 h' : `cada ${dias} días`;
  }

  return `cada ${horas} h`;
}

export function calcularPorcentajeCiclo(
  inicio: string,
  fin: string,
  ahora: number,
): number {
  const inicioMs = new Date(inicio).getTime();
  const finMs = new Date(fin).getTime();

  if (!Number.isFinite(inicioMs) || !Number.isFinite(finMs) || finMs <= inicioMs) {
    return 0;
  }

  const porcentaje = ((ahora - inicioMs) / (finMs - inicioMs)) * 100;
  return Math.min(100, Math.max(0, porcentaje));
}
