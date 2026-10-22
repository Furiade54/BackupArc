export type EstadoRespaldo = 'ok' | 'advertencia' | 'error' | 'pendiente';

export type TipoRespaldo = 'archivos' | 'mssql';

export interface RespaldoConfigurado {
  id: number;
  nombre: string;
  tipo: TipoRespaldo;
  /** Ruta de origen para archivos; nombre de la base de datos para MSSQL. */
  origen: string;
  destino: string;
  frecuenciaMinutos: number;
  horaEjecucion: string;
  retencionDias: number;
  copiaConFecha: boolean;
  comprimir: boolean;
  habilitado: boolean;
  ultimaEjecucion: string | null;
  proximaEjecucion: string;
  ultimoEstado: EstadoRespaldo;
  creadoEn: string;
}

export interface NuevoRespaldo {
  nombre: string;
  tipo: TipoRespaldo;
  origen: string;
  destino: string;
  frecuenciaMinutos: number;
  horaEjecucion: string;
  retencionDias: number;
  copiaConFecha: boolean;
  comprimir: boolean;
}

export interface EjecucionRespaldo {
  id: number;
  fecha: string;
  estado: EstadoRespaldo;
  detalle: string | null;
}
