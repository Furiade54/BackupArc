import type { ArchivoRespaldo } from './archivo.types';
import type {
  ConexionMssql,
  EjecucionRespaldo,
  EjecucionesRegistradasInforme,
  FiltroInformeBak,
  InformeBak,
  InformeGlobalBak,
  InventarioBak,
  NuevoRespaldo,
  RespaldoConfigurado,
  ResumenConexionMssql,
} from './respaldo.types';

export type ResultadoIpc<T> = { ok: true; datos: T } | { ok: false; error: string };

export interface InfoAplicacion {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  plataforma: string;
  arquitectura: string;
  empaquetada: boolean;
}

export interface ConfiguracionAvanzada {
  siempreVisible: boolean;
  iniciarConSistema: boolean;
  iniciarMinimizado: boolean;
  mostrarAvisos: boolean;
  mantenerEnSegundoPlano: boolean;
  buscarActualizaciones: boolean;
}

export type ClaveConfiguracionAvanzada = keyof ConfiguracionAvanzada;

export interface ResultadoActualizacion {
  estado: 'actualizado' | 'disponible' | 'error';
  versionActual: string;
  versionDisponible: string | null;
  urlPublicacion: string | null;
  notas: string | null;
  mensaje: string | null;
}

export interface ProgresoDescargaActualizacion {
  porcentaje: number;
  descargado: number;
  total: number;
}

export interface EstadoConexion {
  configurada: boolean;
  conectado: boolean;
  mensaje: string;
  servidor?: string;
  baseDatos?: string;
  version?: string;
}

export type ConfiguracionMssql = ConexionMssql;
export type ResumenConfiguracionMssql = ResumenConexionMssql;

export interface ResultadoPruebaMssql {
  ok: boolean;
  mensaje: string;
  version?: string;
}

export interface BaseDatosMssql {
  nombre: string;
  estado: string;
}

export interface EstadoVentana {
  maximizada: boolean;
}

export interface ApiElectron {
  app: {
    plataforma: string;
    info: () => Promise<ResultadoIpc<InfoAplicacion>>;
  };
  ventana: {
    minimizar: () => Promise<void>;
    alternarMaximizado: () => Promise<void>;
    cerrar: () => Promise<void>;
    ocultar: () => Promise<void>;
    salir: () => Promise<void>;
    estado: () => Promise<EstadoVentana>;
    alCambiarEstado: (callback: (estado: EstadoVentana) => void) => () => void;
    alSolicitarCierre: (callback: () => void) => () => void;
  };
  db: {
    estado: () => Promise<ResultadoIpc<EstadoConexion>>;
  };
  dialogos: {
    seleccionarCarpeta: (rutaInicial?: string) => Promise<ResultadoIpc<string | null>>;
    seleccionarArchivo: (rutaInicial?: string) => Promise<ResultadoIpc<string | null>>;
  };
  sistema: {
    abrirRuta: (ruta: string) => Promise<ResultadoIpc<void>>;
  };
  mssql: {
    probar: (
      datos: ConfiguracionMssql,
      respaldoId?: number,
    ) => Promise<ResultadoIpc<ResultadoPruebaMssql>>;
    basesDatos: (
      datos: ConfiguracionMssql | null,
      respaldoId?: number,
    ) => Promise<ResultadoIpc<BaseDatosMssql[]>>;
  };
  preferencias: {
    obtener: (clave: string) => Promise<ResultadoIpc<string | null>>;
    guardar: (clave: string, valor: string) => Promise<ResultadoIpc<void>>;
  };
  configuracion: {
    obtener: () => Promise<ResultadoIpc<ConfiguracionAvanzada>>;
    actualizar: (
      clave: ClaveConfiguracionAvanzada,
      valor: boolean,
    ) => Promise<ResultadoIpc<ConfiguracionAvanzada>>;
  };
  actualizaciones: {
    buscar: () => Promise<ResultadoIpc<ResultadoActualizacion>>;
    instalar: () => Promise<ResultadoIpc<void>>;
    alProgresoDescarga: (
      callback: (progreso: ProgresoDescargaActualizacion) => void,
    ) => () => void;
  };
  respaldos: {
    listar: () => Promise<ResultadoIpc<RespaldoConfigurado[]>>;
    crear: (datos: NuevoRespaldo) => Promise<ResultadoIpc<RespaldoConfigurado>>;
    actualizar: (id: number, datos: NuevoRespaldo) => Promise<ResultadoIpc<RespaldoConfigurado>>;
    ejecutar: (id: number) => Promise<ResultadoIpc<void>>;
    alCambiarEjecucion: (callback: (id: number, enEjecucion: boolean) => void) => () => void;
    eliminar: (id: number) => Promise<ResultadoIpc<void>>;
    establecerActivo: (id: number, habilitado: boolean) => Promise<ResultadoIpc<void>>;
    historial: (id: number) => Promise<ResultadoIpc<EjecucionRespaldo[]>>;
    /** Borra el historial de la tarea y devuelve cuántas ejecuciones eliminó. */
    limpiarHistorial: (id: number) => Promise<ResultadoIpc<number>>;
    inventarioBak: (id: number) => Promise<ResultadoIpc<InventarioBak>>;
    informeBak: (id: number, filtro: FiltroInformeBak) => Promise<ResultadoIpc<InformeBak>>;
    informeGlobal: (filtro: FiltroInformeBak) => Promise<ResultadoIpc<InformeGlobalBak>>;
    /** Conteo de corridas registradas en el rango, sin consultar SQL Server. */
    resumenEjecuciones: (
      filtro: FiltroInformeBak,
    ) => Promise<ResultadoIpc<EjecucionesRegistradasInforme>>;
  };
  archivos: {
    listar: (limite?: number) => Promise<ResultadoIpc<ArchivoRespaldo[]>>;
  };
}
