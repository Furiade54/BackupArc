export type EstadoRespaldo = 'ok' | 'advertencia' | 'error' | 'pendiente';

export interface RespaldoConfigurado {
  id: number;
  nombre: string;
  origen: string;
  destino: string;
  frecuenciaMinutos: number;
  horaEjecucion: string;
  retencionDias: number;
  copiaConFecha: boolean;
  habilitado: boolean;
  ultimaEjecucion: string | null;
  proximaEjecucion: string;
  ultimoEstado: EstadoRespaldo;
  creadoEn: string;
}

export interface NuevoRespaldo {
  nombre: string;
  origen: string;
  destino: string;
  frecuenciaMinutos: number;
  horaEjecucion: string;
  retencionDias: number;
  copiaConFecha: boolean;
}

export interface EjecucionRespaldo {
  id: number;
  fecha: string;
  estado: EstadoRespaldo;
  detalle: string | null;
}
