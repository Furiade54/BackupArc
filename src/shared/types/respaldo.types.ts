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
  /** Comprime el .bak a .zip con la app (sin usar WITH COMPRESSION de SQL Server). */
  comprimirBak: boolean;
  /** Ejecuta RESTORE VERIFYONLY WITH CHECKSUM tras cada .bak. */
  verificarBak: boolean;
  /** Respalda a una carpeta temporal local y luego copia al destino final. */
  usarCopiaTemporal: boolean;
  /** Ruta local en el servidor SQL donde se escribe el .bak temporal. */
  carpetaTemporal: string;
  /** Ruta desde la que la app lee el .bak temporal; vacía = carpetaTemporal. */
  carpetaTemporalLectura: string;
  /** Carpeta donde la app escribe el .zip; vacía = misma carpeta destino. */
  carpetaZip: string;
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
  usarCopiaTemporal: boolean;
  carpetaTemporal: string;
  carpetaTemporalLectura: string;
  carpetaZip: string;
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
  /** Ruta del .zip generado cuando la app comprime el .bak. */
  archivoZip: string | null;
  /** Tamaño en bytes del .zip generado. */
  tamanoZipBytes: number | null;
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

/** Filtros del informe de .bak. Las fechas se interpretan en el servidor SQL. */
export interface FiltroInformeBak {
  /** Fecha inicial incluida, en formato aaaa-MM-dd. */
  desde: string;
  /** Fecha final incluida, en formato aaaa-MM-dd. */
  hasta: string;
  /** Base concreta; null para todas las de la carpeta destino. */
  baseDatos: string | null;
  /** Texto a buscar dentro de la ruta del archivo; null para no filtrar. */
  texto: string | null;
}

/** Un .bak encontrado en msdb dentro del rango consultado. */
export interface ArchivoBakInforme {
  archivo: string;
  nombre: string;
  baseDatos: string;
  tipo: TipoEjecutadoMssql;
  /** Día del servidor en formato aaaa-MM-dd, sin conversión de zona horaria. */
  dia: string;
  fecha: string;
  tamanoBytes: number | null;
  esCopyOnly: boolean;
  /** Cantidad de archivos físicos que componen este backup set. */
  familias: number;
}

export interface ResumenInformeBak {
  /** Cantidad de backup sets, no de archivos. */
  total: number;
  completos: number;
  diferenciales: number;
  bases: string[];
  tamanoTotalBytes: number;
  /** Días del rango con al menos un backup registrado. */
  diasConRespaldo: string[];
  /** Días del rango sin ningún backup registrado. */
  diasSinRespaldo: string[];
}

export interface InformeBak {
  carpeta: string;
  desde: string;
  hasta: string;
  archivos: ArchivoBakInforme[];
  resumen: ResumenInformeBak;
  /** true cuando la lista se cortó por el límite de resultados. */
  truncado: boolean;
  advertencia: string;
}

/** Archivo del informe global: añade la tarea y el servidor de origen. */
export interface ArchivoBakInformeGlobal extends ArchivoBakInforme {
  tareaId: number;
  tarea: string;
  servidor: string;
}

/** Resultado del informe para cada tarea MSSQL consultada. */
export interface TareaInformeGlobal {
  id: number;
  nombre: string;
  servidor: string;
  total: number;
  /** Motivo cuando esa tarea no se pudo consultar. */
  error: string | null;
}

export interface InformeGlobalBak {
  desde: string;
  hasta: string;
  archivos: ArchivoBakInformeGlobal[];
  resumen: ResumenInformeBak;
  tareas: TareaInformeGlobal[];
  /** true si alguna tarea superó su propio límite de resultados. */
  truncado: boolean;
  /** Sección de tareas de archivos y carpetas. */
  ejecucionesArchivos: EjecucionArchivoInforme[];
  /** null cuando el filtro apunta a una base o a un archivo .bak. */
  resumenArchivos: ResumenArchivosInforme | null;
  /** Tamaño de los .zip vigentes dentro del rango consultado. */
  resumenZip: ResumenZipInforme;
}

/**
 * Un .zip por base y tarea se reemplaza en cada ejecución, por lo que solo se
 * cuenta el más reciente de cada base dentro del rango.
 */
export interface ResumenZipInforme {
  /** Cantidad de .zip vigentes (uno por base y tarea). */
  archivos: number;
  tamanoTotalBytes: number;
}

/** Ejecución de una tarea de archivos o carpetas dentro del informe global. */
export interface EjecucionArchivoInforme {
  id: number;
  respaldoId: number;
  tarea: string;
  origen: string;
  destino: string;
  fecha: string;
  /** Día local en formato aaaa-MM-dd. */
  dia: string;
  estado: EstadoRespaldo;
  detalle: string | null;
}

export interface ResumenArchivosInforme {
  total: number;
  correctas: number;
  fallidas: number;
  tareas: number;
  diasConEjecucion: string[];
  diasSinEjecucion: string[];
  /** true si la lista visible se cortó por el límite. */
  truncado: boolean;
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
