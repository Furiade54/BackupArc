import type { ArchivoRespaldo } from './archivo.types';
import type { EjecucionRespaldo, NuevoRespaldo, RespaldoConfigurado } from './respaldo.types';

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

export interface ConfiguracionMssql {
  servidor: string;
  puerto: number;
  baseDatos: string;
  usuario: string;
  /** Vacío al guardar conserva la contraseña que ya estaba almacenada. */
  contrasena: string;
  /** encrypt: exige TLS en la conexión. */
  cifrado: boolean;
  /** trustServerCertificate: acepta certificados no firmados por una CA de confianza. */
  confiarCertificado: boolean;
}

export interface ResumenConfiguracionMssql extends Omit<ConfiguracionMssql, 'contrasena'> {
  tieneContrasena: boolean;
}

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
  };
  sistema: {
    abrirRuta: (ruta: string) => Promise<ResultadoIpc<void>>;
  };
  mssql: {
    obtener: () => Promise<ResultadoIpc<ResumenConfiguracionMssql>>;
    guardar: (datos: ConfiguracionMssql) => Promise<ResultadoIpc<ResumenConfiguracionMssql>>;
    probar: (datos: ConfiguracionMssql) => Promise<ResultadoIpc<ResultadoPruebaMssql>>;
    basesDatos: () => Promise<ResultadoIpc<BaseDatosMssql[]>>;
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
  };
  archivos: {
    listar: (limite?: number) => Promise<ResultadoIpc<ArchivoRespaldo[]>>;
  };
}
