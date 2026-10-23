export type EstadoRespaldo = 'ok' | 'advertencia' | 'error' | 'pendiente';

export type TipoRespaldo = 'archivos' | 'mssql';

/** Lo que pide el usuario para la tarea. */
export type ModoRespaldoMssql = 'completo' | 'diferencial';

/** Lo que realmente se ejecutó por cada base. */
export type TipoEjecutadoMssql = 'completo' | 'diferencial';

/** Estado real de la compresión del .bak, según la cabecera del archivo. */
export type CompresionBak = 'aplicada' | 'no aplicada' | 'desconocido';

export interface ConexionMssql {
  servidor: string;
  puerto: number;
  baseDatos: string;
  usuario: string;
  /** Vacío al guardar conserva la contraseña almacenada en la tarea. */
  contrasena: string;
  cifrado: boolean;
  confiarCertificado: boolean;
  /** El usuario indica si SQL Server corre en otro equipo (carpeta destino remota). */
  esRemoto: boolean;
}

export interface ResumenConexionMssql extends Omit<ConexionMssql, 'contrasena'> {
  tieneContrasena: boolean;
}

export interface RespaldoConfigurado {
  id: number;
  nombre: string;
  tipo: TipoRespaldo;
  /** Ruta de origen para archivos; bases elegidas (JSON) para MSSQL. */
  origen: string;
  /** Servidor y credenciales propios de la tarea MSSQL. */
  conexionMssql: ResumenConexionMssql | null;
  destino: string;
  frecuenciaMinutos: number;
  horaEjecucion: string;
  retencionDias: number;
  copiaConFecha: boolean;
  comprimir: boolean;
  /** Solo aplica a tareas MSSQL. */
  modoMssql: ModoRespaldoMssql;
  /** Antigüedad máxima de la base full antes de generar una nueva. */
  fullCadaDias: number;
  /** Comprime el .bak con WITH COMPRESSION cuando la instancia lo permita. */
  comprimirBak: boolean;
  /** Ejecuta RESTORE VERIFYONLY WITH CHECKSUM tras cada .bak. */
  verificarBak: boolean;
  habilitado: boolean;
  ultimaEjecucion: string | null;
  /** Inicio de la racha actual de fallas consecutivas. */
  falloDesde: string | null;
  proximaEjecucion: string;
  ultimoEstado: EstadoRespaldo;
  creadoEn: string;
}

export interface NuevoRespaldo {
  nombre: string;
  tipo: TipoRespaldo;
  origen: string;
  conexionMssql: ConexionMssql | null;
  destino: string;
  frecuenciaMinutos: number;
  horaEjecucion: string;
  retencionDias: number;
  copiaConFecha: boolean;
  comprimir: boolean;
  modoMssql: ModoRespaldoMssql;
  fullCadaDias: number;
  comprimirBak: boolean;
  verificarBak: boolean;
}

/** Resultado de respaldar una base concreta dentro de una ejecución. */
export interface ResultadoBaseRespaldo {
  id: number;
  baseDatos: string;
  tipoEjecutado: TipoEjecutadoMssql;
  archivo: string | null;
  baseArchivo: string | null;
  baseGuid: string | null;
  baseLsn: string | null;
  baseFecha: string | null;
  tamanoBytes: number | null;
  compresion: CompresionBak;
  estado: EstadoRespaldo;
  detalle: string | null;
}

export type NuevoResultadoBaseRespaldo = Omit<ResultadoBaseRespaldo, 'id'>;

export type CategoriaArchivoBak =
  | 'confirmado'
  | 'base_protegida'
  | 'no_verificable'
  | 'posible_huerfano';

/** Archivo .bak detectado en msdb dentro de la carpeta destino de una tarea. */
export interface ArchivoBakInventario {
  archivo: string;
  nombre: string;
  baseDatos: string;
  tipo: TipoEjecutadoMssql;
  fecha: string;
  tamanoBytes: number | null;
  compresion: CompresionBak;
  baseArchivo: string | null;
  esCopyOnly: boolean;
  categoria: CategoriaArchivoBak;
  sugerencia: string;
}

export interface InventarioBak {
  carpeta: string;
  archivos: ArchivoBakInventario[];
  advertencia: string;
}

export interface EjecucionRespaldo {
  id: number;
  fecha: string;
  estado: EstadoRespaldo;
  detalle: string | null;
  tipo: string | null;
  runId: string | null;
  resultados: ResultadoBaseRespaldo[];
}
