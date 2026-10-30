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

// Duración de una corrida: "8 s", "2 min 5 s", "1 h 12 min".
export function formatearDuracionMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return '—';
  }

  const segundosTotales = Math.max(0, Math.round(ms / 1000));

  if (segundosTotales < 1) {
    return 'menos de 1 s';
  }

  if (segundosTotales < 60) {
    return `${segundosTotales} s`;
  }

  const minutos = Math.floor(segundosTotales / 60);
  const segundos = segundosTotales % 60;

  if (minutos < 60) {
    return segundos === 0 ? `${minutos} min` : `${minutos} min ${segundos} s`;
  }

  const horas = Math.floor(minutos / 60);
  const restoMinutos = minutos % 60;

  return restoMinutos === 0 ? `${horas} h` : `${horas} h ${restoMinutos} min`;
}

export function formatearFrecuencia(minutos: number): string {
  if (!Number.isFinite(minutos) || minutos <= 0) {
    return '—';
  }
  if (minutos < 60) {
    return `cada ${minutos} min`;
  }

  if (minutos % 1440 === 0) {
    const dias = minutos / 1440;
    return dias === 1 ? 'cada 24 h' : `cada ${dias} días`;
  }

  if (minutos % 60 === 0) {
    return `cada ${minutos / 60} h`;
  }

  return `cada ${minutos} min`;
}

// Duración detallada para rachas de fallas: "12 minutos", "2 días, 3 horas y 5 minutos".
export function formatearDuracionDetallada(valor: string | null, ahora: number): string {
  if (!valor) {
    return '—';
  }

  const fecha = fechaValida(valor);

  if (!fecha) {
    return '—';
  }

  const totalMinutos = Math.max(0, Math.floor((ahora - fecha.getTime()) / 60_000));

  if (totalMinutos < 1) {
    return 'menos de un minuto';
  }

  const dias = Math.floor(totalMinutos / 1440);
  const horas = Math.floor((totalMinutos % 1440) / 60);
  const minutos = totalMinutos % 60;
  const partes: string[] = [];

  if (dias > 0) {
    partes.push(`${dias} ${dias === 1 ? 'día' : 'días'}`);
  }

  if (horas > 0) {
    partes.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`);
  }

  if (minutos > 0) {
    partes.push(`${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`);
  }

  if (partes.length === 1) {
    return partes[0];
  }

  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

export function formatearAntiguedad(valor: string | null, ahora: number): string {
  if (!valor) {
    return '—';
  }

  const fecha = fechaValida(valor);

  if (!fecha) {
    return '—';
  }

  const minutos = Math.max(0, Math.floor((ahora - fecha.getTime()) / 60_000));

  if (minutos < 1) {
    return 'hace un momento';
  }

  if (minutos < 60) {
    return `hace ${minutos} min`;
  }

  const horas = Math.floor(minutos / 60);

  if (horas < 24) {
    return `hace ${horas} h`;
  }

  const dias = Math.floor(horas / 24);

  if (dias < 30) {
    return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
  }

  const meses = Math.floor(dias / 30);

  if (meses < 12) {
    return meses === 1 ? 'hace 1 mes' : `hace ${meses} meses`;
  }

  const anios = Math.floor(dias / 365);

  return anios === 1 ? 'hace 1 año' : `hace ${anios} años`;
}
