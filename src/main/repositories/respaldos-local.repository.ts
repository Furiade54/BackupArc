import type {
  CompresionBak,
  ConexionMssql,
  EjecucionArchivoInforme,
  EjecucionRespaldo,
  EjecucionesRegistradasInforme,
  EstadoRespaldo,
  ModoRespaldoMssql,
  NuevoRespaldo,
  NuevoResultadoBaseRespaldo,
  ResultadoBaseRespaldo,
  RespaldoConfigurado,
  ResumenConexionMssql,
  ResumenZipInforme,
  TipoEjecutadoMssql,
  TipoRespaldo,
} from '../../shared/types/respaldo.types';
import {
  cifrarConexionMssql,
  estaConfiguracionCompleta,
  leerConfiguracionMssql,
  leerConexionMssql,
  resumirConexionMssql,
} from '../services/database.service';
import { obtenerBaseDatosLocal } from '../services/local-database.service';

interface FilaRespaldo {
  id: number;
  nombre: string;
  tipo: string;
  origen: string;
  todas_las_bases: number;
  mssql_conexion: string | null;
  destino: string;
  frecuencia_minutos: number;
  hora_ejecucion: string;
  retencion_dias: number;
  copia_con_fecha: number;
  identificador_unico: number;
  comprimir: number;
  modo_mssql: string;
  full_cada_dias: number;
  comprimir_bak: number;
  verificar_bak: number;
  usar_copia_temporal: number;
  carpeta_temporal: string | null;
  carpeta_temporal_lectura: string | null;
  carpeta_zip: string | null;
  habilitado: number;
  ultima_ejecucion: string | null;
  fallo_desde: string | null;
  proxima_ejecucion: string;
  ultimo_estado: string;
  creado_en: string;
}

interface FilaEjecucion {
  id: number;
  fecha: string;
  estado: string;
  detalle: string | null;
  tipo: string | null;
  run_id: string | null;
  duracion_ms: number | null;
  archivos: number | null;
  bytes: number | null;
  ubicacion: string | null;
}

interface FilaResultadoBase {
  id: number;
  ejecucion_id: number;
  base_datos: string;
  tipo_ejecutado: string;
  archivo: string | null;
  base_archivo: string | null;
  base_guid: string | null;
  base_lsn: string | null;
  base_fecha: string | null;
  tamano_bytes: number | null;
  compresion: string | null;
  archivo_zip: string | null;
  tamano_zip_bytes: number | null;
  estado: string;
  detalle: string | null;
}

function esEstadoRespaldo(valor: string): valor is EstadoRespaldo {
  return valor === 'ok' || valor === 'advertencia' || valor === 'error' || valor === 'pendiente';
}

function esTipoRespaldo(valor: string): valor is TipoRespaldo {
  return valor === 'archivos' || valor === 'mssql';
}

function esModoMssql(valor: string): valor is ModoRespaldoMssql {
  return valor === 'completo' || valor === 'diferencial';
}

function esTipoEjecutado(valor: string): valor is TipoEjecutadoMssql {
  return valor === 'completo' || valor === 'diferencial';
}

function esCompresion(valor: string | null): CompresionBak {
  return valor === 'aplicada' || valor === 'no aplicada' ? valor : 'desconocido';
}

// Las tareas MSSQL antiguas no guardaban su conexión: se muestra la global,
// que es la que han estado usando, para no perderla al editarlas.
function conexionDeFila(fila: FilaRespaldo): ResumenConexionMssql | null {
  const propia = resumirConexionMssql(fila.mssql_conexion);

  if (propia || fila.tipo !== 'mssql') {
    return propia;
  }

  const global = leerConfiguracionMssql();

  if (!estaConfiguracionCompleta(global)) {
    return null;
  }

  return {
    servidor: global.servidor,
    puerto: global.puerto,
    baseDatos: global.baseDatos,
    usuario: global.usuario,
    cifrado: global.cifrado,
    confiarCertificado: global.confiarCertificado,
    esRemoto: global.esRemoto,
    tieneContrasena: true,
  };
}

function mapearRespaldo(fila: FilaRespaldo): RespaldoConfigurado {
  return {
    id: fila.id,
    nombre: fila.nombre,
    tipo: esTipoRespaldo(fila.tipo) ? fila.tipo : 'archivos',
    origen: fila.origen,
    todasLasBases: fila.todas_las_bases === 1,
    conexionMssql: conexionDeFila(fila),
    destino: fila.destino,
    frecuenciaMinutos: fila.frecuencia_minutos,
    horaEjecucion: fila.hora_ejecucion,
    retencionDias: fila.retencion_dias,
    copiaConFecha: fila.copia_con_fecha === 1,
    identificadorUnico: fila.identificador_unico === 1,
    comprimir: fila.comprimir === 1,
    modoMssql: esModoMssql(fila.modo_mssql) ? fila.modo_mssql : 'completo',
    fullCadaDias: fila.full_cada_dias,
    comprimirBak: fila.comprimir_bak === 1,
    verificarBak: fila.verificar_bak === 1,
    usarCopiaTemporal: fila.usar_copia_temporal === 1,
    carpetaTemporal: fila.carpeta_temporal ?? '',
    carpetaTemporalLectura: fila.carpeta_temporal_lectura ?? '',
    carpetaZip: fila.carpeta_zip ?? '',
    habilitado: fila.habilitado === 1,
    ultimaEjecucion: fila.ultima_ejecucion,
    falloDesde: fila.fallo_desde,
    proximaEjecucion: fila.proxima_ejecucion,
    ultimoEstado: esEstadoRespaldo(fila.ultimo_estado) ? fila.ultimo_estado : 'pendiente',
    creadoEn: fila.creado_en,
  };
}

const MINUTOS_POR_DIA = 1440;

// Siguiente ejecución de un ciclo ya iniciado: intervalo exacto desde la
// última ejecución, para que la antigüedad mostrada coincida con la frecuencia.
export function calcularSiguienteEjecucion(desde: Date, frecuenciaMinutos: number): string {
  return new Date(desde.getTime() + frecuenciaMinutos * 60 * 1000).toISOString();
}

// Corrige programaciones guardadas con cálculos anteriores que no respetaban
// el intervalo configurado.
export function normalizarProximasEjecuciones(): void {
  const baseDatos = obtenerBaseDatosLocal();
  const filas = baseDatos
    .prepare(`
      SELECT id, frecuencia_minutos, ultima_ejecucion, proxima_ejecucion
      FROM respaldos
      WHERE ultima_ejecucion IS NOT NULL
    `)
    .all() as unknown as {
    id: number;
    frecuencia_minutos: number;
    ultima_ejecucion: string;
    proxima_ejecucion: string;
  }[];
  const actualizar = baseDatos.prepare('UPDATE respaldos SET proxima_ejecucion = ? WHERE id = ?');

  for (const fila of filas) {
    const ultima = new Date(fila.ultima_ejecucion).getTime();
    const actual = new Date(fila.proxima_ejecucion).getTime();

    if (!Number.isFinite(ultima)) {
      continue;
    }

    const siguiente = calcularSiguienteEjecucion(new Date(ultima), fila.frecuencia_minutos);
    const diferencia = Math.abs(actual - new Date(siguiente).getTime());

    if (Number.isFinite(diferencia) && diferencia > 60_000) {
      actualizar.run(siguiente, fila.id);
    }
  }
}

export function calcularProximaEjecucion(
  horaEjecucion: string,
  frecuenciaMinutos: number,
  desde: Date,
): string {
  const proxima = new Date(desde.getTime() + frecuenciaMinutos * 60 * 1000);

  // Por debajo de un día la frecuencia es un intervalo puro desde la última
  // ejecución; la hora fijada solo aplica a frecuencias diarias o mayores.
  if (frecuenciaMinutos < MINUTOS_POR_DIA) {
    return proxima.toISOString();
  }

  const [horas, minutos] = horaEjecucion.split(':').map(Number);

  proxima.setHours(horas, minutos, 0, 0);

  if (proxima.getTime() <= desde.getTime()) {
    proxima.setTime(proxima.getTime() + frecuenciaMinutos * 60 * 1000);
  }

  return proxima.toISOString();
}

export function listarRespaldos(): RespaldoConfigurado[] {
  const filas = obtenerBaseDatosLocal()
    .prepare('SELECT * FROM respaldos ORDER BY id ASC')
    .all() as unknown as FilaRespaldo[];

  return filas.map(mapearRespaldo);
}

export function crearRespaldo(datos: NuevoRespaldo): RespaldoConfigurado {
  const baseDatos = obtenerBaseDatosLocal();
  const creadoEn = new Date();
  const proximaEjecucion = calcularProximaEjecucion(datos.horaEjecucion, datos.frecuenciaMinutos, creadoEn);

  const resultado = baseDatos
    .prepare(`
      INSERT INTO respaldos (
        nombre,
        tipo,
        origen,
        todas_las_bases,
        destino,
        frecuencia_minutos,
        hora_ejecucion,
        retencion_dias,
        copia_con_fecha,
        identificador_unico,
        comprimir,
        modo_mssql,
        full_cada_dias,
        comprimir_bak,
        verificar_bak,
        usar_copia_temporal,
        carpeta_temporal,
        carpeta_temporal_lectura,
        carpeta_zip,
        mssql_conexion,
        ultima_ejecucion,
        proxima_ejecucion,
        ultimo_estado,
        creado_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pendiente', ?)
    `)
    .run(
      datos.nombre,
      datos.tipo,
      datos.origen,
      datos.todasLasBases ? 1 : 0,
      datos.destino,
      datos.frecuenciaMinutos,
      datos.horaEjecucion,
      datos.retencionDias,
      datos.copiaConFecha ? 1 : 0,
      datos.identificadorUnico ? 1 : 0,
      datos.comprimir ? 1 : 0,
      datos.modoMssql,
      datos.fullCadaDias,
      datos.comprimirBak ? 1 : 0,
      datos.verificarBak ? 1 : 0,
      datos.usarCopiaTemporal ? 1 : 0,
      datos.carpetaTemporal || null,
      datos.carpetaTemporalLectura || null,
      datos.carpetaZip || null,
      datos.conexionMssql ? cifrarConexionMssql(datos.conexionMssql) : null,
      proximaEjecucion,
      creadoEn.toISOString(),
    );

  const fila = baseDatos
    .prepare('SELECT * FROM respaldos WHERE id = ?')
    .get(Number(resultado.lastInsertRowid)) as FilaRespaldo | undefined;

  if (!fila) {
    throw new Error('No se pudo recuperar la copia recién creada.');
  }

  return mapearRespaldo(fila);
}

export function actualizarRespaldo(id: number, datos: NuevoRespaldo): RespaldoConfigurado {
  const baseDatos = obtenerBaseDatosLocal();
  const proximaEjecucion = calcularProximaEjecucion(datos.horaEjecucion, datos.frecuenciaMinutos, new Date());
  const anterior = baseDatos
    .prepare('SELECT mssql_conexion FROM respaldos WHERE id = ?')
    .get(id) as { mssql_conexion: string | null } | undefined;

  // Una contraseña vacía conserva la de la tarea o, en tareas antiguas, la global.
  const conexionMssql = datos.conexionMssql
    ? cifrarConexionMssql({
        ...datos.conexionMssql,
        contrasena:
          datos.conexionMssql.contrasena ||
          leerConexionMssql(anterior?.mssql_conexion ?? null)?.contrasena ||
          leerConfiguracionMssql().contrasena ||
          '',
      })
    : null;

  const resultado = baseDatos
    .prepare(`
      UPDATE respaldos
      SET nombre = ?,
          tipo = ?,
          origen = ?,
          todas_las_bases = ?,
          mssql_conexion = ?,
          destino = ?,
          frecuencia_minutos = ?,
          hora_ejecucion = ?,
          retencion_dias = ?,
          copia_con_fecha = ?,
          identificador_unico = ?,
          comprimir = ?,
          modo_mssql = ?,
          full_cada_dias = ?,
          comprimir_bak = ?,
          verificar_bak = ?,
          usar_copia_temporal = ?,
          carpeta_temporal = ?,
          carpeta_temporal_lectura = ?,
          carpeta_zip = ?,
          proxima_ejecucion = ?
      WHERE id = ?
    `)
    .run(
      datos.nombre,
      datos.tipo,
      datos.origen,
      datos.todasLasBases ? 1 : 0,
      conexionMssql,
      datos.destino,
      datos.frecuenciaMinutos,
      datos.horaEjecucion,
      datos.retencionDias,
      datos.copiaConFecha ? 1 : 0,
      datos.identificadorUnico ? 1 : 0,
      datos.comprimir ? 1 : 0,
      datos.modoMssql,
      datos.fullCadaDias,
      datos.comprimirBak ? 1 : 0,
      datos.verificarBak ? 1 : 0,
      datos.usarCopiaTemporal ? 1 : 0,
      datos.carpetaTemporal || null,
      datos.carpetaTemporalLectura || null,
      datos.carpetaZip || null,
      proximaEjecucion,
      id,
    );

  if (Number(resultado.changes) === 0) {
    throw new Error('La copia indicada no existe.');
  }

  const fila = baseDatos.prepare('SELECT * FROM respaldos WHERE id = ?').get(id) as FilaRespaldo | undefined;

  if (!fila) {
    throw new Error('No se pudo recuperar la copia actualizada.');
  }

  return mapearRespaldo(fila);
}

// Devuelve la conexión completa (con contraseña) para ejecutar una tarea MSSQL.
export function obtenerConexionMssqlRespaldo(id: number): ConexionMssql | null {
  const fila = obtenerBaseDatosLocal()
    .prepare('SELECT mssql_conexion FROM respaldos WHERE id = ?')
    .get(id) as { mssql_conexion: string | null } | undefined;

  return fila ? leerConexionMssql(fila.mssql_conexion) : null;
}

export function obtenerRespaldo(id: number): RespaldoConfigurado | null {
  const fila = obtenerBaseDatosLocal().prepare('SELECT * FROM respaldos WHERE id = ?').get(id) as
    | FilaRespaldo
    | undefined;

  return fila ? mapearRespaldo(fila) : null;
}

export function listarRespaldosVencidos(ahora: string): RespaldoConfigurado[] {
  const filas = obtenerBaseDatosLocal()
    .prepare(`
      SELECT * FROM respaldos
      WHERE habilitado = 1 AND proxima_ejecucion <= ?
      ORDER BY proxima_ejecucion ASC
    `)
    .all(ahora) as unknown as FilaRespaldo[];

  return filas.map(mapearRespaldo);
}

export function registrarEjecucionRespaldo(
  respaldoId: number,
  estado: EstadoRespaldo,
  detalle: string | null,
  fecha: string,
  opciones: {
    tipo?: string | null;
    runId?: string | null;
    duracionMs?: number | null;
    archivos?: number | null;
    bytes?: number | null;
    ubicacion?: string | null;
  } = {},
): number {
  const resultado = obtenerBaseDatosLocal()
    .prepare(`
      INSERT INTO ejecuciones_respaldo (
        respaldo_id, fecha, estado, detalle, tipo, run_id,
        duracion_ms, archivos, bytes, ubicacion
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      respaldoId,
      fecha,
      estado,
      detalle,
      opciones.tipo ?? null,
      opciones.runId ?? null,
      opciones.duracionMs ?? null,
      opciones.archivos ?? null,
      opciones.bytes ?? null,
      opciones.ubicacion ?? null,
    );

  return Number(resultado.lastInsertRowid);
}

// Trazabilidad por base: tipo real ejecutado, archivo generado y full usado como base.
export function registrarResultadosBase(
  ejecucionId: number,
  resultados: NuevoResultadoBaseRespaldo[],
): void {
  const insertar = obtenerBaseDatosLocal().prepare(`
    INSERT INTO resultados_respaldo (
      ejecucion_id,
      base_datos,
      tipo_ejecutado,
      archivo,
      base_archivo,
      base_guid,
      base_lsn,
      base_fecha,
      tamano_bytes,
      compresion,
      archivo_zip,
      tamano_zip_bytes,
      estado,
      detalle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const resultado of resultados) {
    insertar.run(
      ejecucionId,
      resultado.baseDatos,
      resultado.tipoEjecutado,
      resultado.archivo,
      resultado.baseArchivo,
      resultado.baseGuid,
      resultado.baseLsn,
      resultado.baseFecha,
      resultado.tamanoBytes,
      resultado.compresion,
      resultado.archivoZip,
      resultado.tamanoZipBytes,
      resultado.estado,
      resultado.detalle,
    );
  }
}

// Primera falla de la racha actual, tomada del historial de la tarea.
function calcularInicioRachaFallas(respaldoId: number): string | null {
  const filas = obtenerBaseDatosLocal()
    .prepare(`
      SELECT fecha, estado
      FROM ejecuciones_respaldo
      WHERE respaldo_id = ?
      ORDER BY fecha DESC
    `)
    .all(respaldoId) as unknown as { fecha: string; estado: string }[];

  let inicio: string | null = null;

  for (const fila of filas) {
    if (fila.estado !== 'error') {
      break;
    }

    inicio = fila.fecha;
  }

  return inicio;
}

export function actualizarEstadoRespaldo(
  id: number,
  estado: EstadoRespaldo,
  ultimaEjecucion: string,
  proximaEjecucion: string,
): void {
  const baseDatos = obtenerBaseDatosLocal();
  // La racha se deriva siempre del historial (el registro de este intento ya
  // está insertado), así un valor guardado por error no se queda pegado.
  const falloDesde =
    estado === 'error' ? (calcularInicioRachaFallas(id) ?? ultimaEjecucion) : null;

  baseDatos
    .prepare(`
      UPDATE respaldos
      SET ultimo_estado = ?,
          ultima_ejecucion = ?,
          fallo_desde = ?,
          proxima_ejecucion = ?
      WHERE id = ?
    `)
    .run(estado, ultimaEjecucion, falloDesde, proximaEjecucion, id);
}

export function eliminarRespaldo(id: number): void {
  const resultado = obtenerBaseDatosLocal().prepare('DELETE FROM respaldos WHERE id = ?').run(id);

  if (Number(resultado.changes) === 0) {
    throw new Error('La copia indicada no existe.');
  }
}

export function establecerActivoRespaldo(id: number, habilitado: boolean): void {
  const resultado = obtenerBaseDatosLocal()
    .prepare('UPDATE respaldos SET habilitado = ? WHERE id = ?')
    .run(habilitado ? 1 : 0, id);

  if (Number(resultado.changes) === 0) {
    throw new Error('La copia indicada no existe.');
  }
}

// Borra todas las ejecuciones de una tarea. Los resultados por base caen por
// la clave foránea en cascada; los archivos .bak/.zip no se tocan.
export function limpiarHistorialRespaldo(id: number): number {
  const resultado = obtenerBaseDatosLocal()
    .prepare('DELETE FROM ejecuciones_respaldo WHERE respaldo_id = ?')
    .run(id);

  return Number(resultado.changes);
}

// Depura el historial que supera la retención de la tarea.
export function depurarHistorialAntiguo(id: number, dias: number): number {
  if (!Number.isInteger(dias) || dias < 1) {
    return 0;
  }

  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const resultado = obtenerBaseDatosLocal()
    .prepare('DELETE FROM ejecuciones_respaldo WHERE respaldo_id = ? AND fecha < ?')
    .run(id, limite);

  return Number(resultado.changes);
}

export function listarHistorialRespaldo(id: number): EjecucionRespaldo[] {
  const baseDatos = obtenerBaseDatosLocal();
  const existe = baseDatos.prepare('SELECT 1 AS existe FROM respaldos WHERE id = ?').get(id) as
    | { existe: number }
    | undefined;

  if (!existe) {
    throw new Error('La copia indicada no existe.');
  }

  const filas = baseDatos
    .prepare(`
      SELECT id, fecha, estado, detalle, tipo, run_id,
             duracion_ms, archivos, bytes, ubicacion
      FROM ejecuciones_respaldo
      WHERE respaldo_id = ?
      ORDER BY fecha DESC
    `)
    .all(id) as unknown as FilaEjecucion[];

  const resultados = baseDatos
    .prepare(`
      SELECT r.id, r.ejecucion_id, r.base_datos, r.tipo_ejecutado, r.archivo,
             r.base_archivo, r.base_guid, r.base_lsn, r.base_fecha,
             r.tamano_bytes, r.compresion, r.archivo_zip, r.tamano_zip_bytes,
             r.estado, r.detalle
      FROM resultados_respaldo r
      JOIN ejecuciones_respaldo e ON e.id = r.ejecucion_id
      WHERE e.respaldo_id = ?
      ORDER BY r.id ASC
    `)
    .all(id) as unknown as FilaResultadoBase[];

  const resultadosPorEjecucion = new Map<number, ResultadoBaseRespaldo[]>();

  for (const fila of resultados) {
    const lista = resultadosPorEjecucion.get(fila.ejecucion_id) ?? [];

    lista.push({
      id: fila.id,
      baseDatos: fila.base_datos,
      tipoEjecutado: esTipoEjecutado(fila.tipo_ejecutado) ? fila.tipo_ejecutado : 'completo',
      archivo: fila.archivo,
      baseArchivo: fila.base_archivo,
      baseGuid: fila.base_guid,
      baseLsn: fila.base_lsn,
      baseFecha: fila.base_fecha,
      tamanoBytes: fila.tamano_bytes,
      compresion: esCompresion(fila.compresion),
      archivoZip: fila.archivo_zip,
      tamanoZipBytes: fila.tamano_zip_bytes,
      estado: esEstadoRespaldo(fila.estado) ? fila.estado : 'pendiente',
      detalle: fila.detalle,
    });
    resultadosPorEjecucion.set(fila.ejecucion_id, lista);
  }

  return filas.map((fila) => ({
    id: fila.id,
    fecha: fila.fecha,
    estado: esEstadoRespaldo(fila.estado) ? fila.estado : 'pendiente',
    detalle: fila.detalle,
    tipo: fila.tipo,
    runId: fila.run_id,
    duracionMs: fila.duracion_ms,
    archivos: fila.archivos,
    bytes: fila.bytes,
    ubicacion: fila.ubicacion,
    resultados: resultadosPorEjecucion.get(fila.id) ?? [],
  }));
}

const MAX_EJECUCIONES_ARCHIVOS = 200;

interface FilaConteoArchivos {
  total: number;
  correctas: number;
  fallidas: number;
  tareas: number;
}

interface FilaEjecucionArchivo {
  id: number;
  respaldo_id: number;
  tarea: string;
  origen: string;
  destino: string;
  fecha: string;
  estado: string;
  detalle: string | null;
}

export interface EjecucionesArchivosConsultadas {
  ejecuciones: EjecucionArchivoInforme[];
  resumen: {
    total: number;
    correctas: number;
    fallidas: number;
    tareas: number;
    diasConEjecucion: string[];
  };
  truncado: boolean;
}

function diaLocal(fecha: string): string {
  const valor = new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return fecha.slice(0, 10);
  }

  const dia = String(valor.getDate()).padStart(2, '0');
  const mes = String(valor.getMonth() + 1).padStart(2, '0');

  return `${valor.getFullYear()}-${mes}-${dia}`;
}

// Ejecuciones registradas de cualquier tipo de tarea: una fila por corrida.
// Sirve para las métricas del panel, donde un .bak por base no es una ejecución.
export function consultarEjecucionesRegistradas(
  desde: string,
  hasta: string,
): EjecucionesRegistradasInforme {
  const baseDatos = obtenerBaseDatosLocal();
  const desdeIso = new Date(`${desde}T00:00:00`).toISOString();
  const hastaIso = new Date(`${hasta}T23:59:59.999`).toISOString();

  const conteo = baseDatos
    .prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN e.estado = 'ok' THEN 1 ELSE 0 END), 0) AS correctas,
             COALESCE(SUM(CASE WHEN e.estado = 'error' THEN 1 ELSE 0 END), 0) AS fallidas,
             COALESCE(SUM(CASE WHEN e.estado = 'advertencia' THEN 1 ELSE 0 END), 0) AS advertencias,
             COUNT(DISTINCT e.respaldo_id) AS tareas
      FROM ejecuciones_respaldo e
      JOIN respaldos r ON r.id = e.respaldo_id
      WHERE e.fecha >= ? AND e.fecha <= ?
    `)
    .get(desdeIso, hastaIso) as unknown as FilaConteoArchivos & { advertencias: number };

  const dias = baseDatos
    .prepare(`
      SELECT COALESCE(date(e.fecha, 'localtime'), substr(e.fecha, 1, 10)) AS dia,
             COUNT(*) AS total
      FROM ejecuciones_respaldo e
      JOIN respaldos r ON r.id = e.respaldo_id
      WHERE e.fecha >= ? AND e.fecha <= ?
      GROUP BY dia
      ORDER BY dia
    `)
    .all(desdeIso, hastaIso) as unknown as { dia: string; total: number }[];

  return {
    total: conteo?.total ?? 0,
    correctas: conteo?.correctas ?? 0,
    fallidas: conteo?.fallidas ?? 0,
    advertencias: conteo?.advertencias ?? 0,
    tareas: conteo?.tareas ?? 0,
    porDia: dias.map((fila) => ({ dia: fila.dia, total: fila.total })),
  };
}

// Escapa los comodines de LIKE para que el texto se busque literal.
function patronLike(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`)}%`;
}

// Ejecuciones de tareas de archivos dentro del rango, del más reciente al más
// antiguo. El conteo se hace en SQL para que no dependa del límite de la lista.
// El texto busca tanto en la carpeta de origen como en el detalle (ruta del .zip).
export function consultarEjecucionesArchivos(
  desde: string,
  hasta: string,
  texto: string | null = null,
): EjecucionesArchivosConsultadas {
  const baseDatos = obtenerBaseDatosLocal();
  // Las fechas del informe son locales; el historial guarda ISO en UTC.
  const desdeIso = new Date(`${desde}T00:00:00`).toISOString();
  const hastaIso = new Date(`${hasta}T23:59:59.999`).toISOString();
  const patron = texto ? patronLike(texto) : null;
  const filtroTexto = `AND (? IS NULL OR r.origen LIKE ? ESCAPE '\\' OR e.detalle LIKE ? ESCAPE '\\')`;

  const conteo = baseDatos
    .prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN e.estado = 'ok' THEN 1 ELSE 0 END), 0) AS correctas,
             COALESCE(SUM(CASE WHEN e.estado = 'error' THEN 1 ELSE 0 END), 0) AS fallidas,
             COUNT(DISTINCT e.respaldo_id) AS tareas
      FROM ejecuciones_respaldo e
      JOIN respaldos r ON r.id = e.respaldo_id
      WHERE r.tipo = 'archivos' AND e.fecha >= ? AND e.fecha <= ?
        ${filtroTexto}
    `)
    .get(desdeIso, hastaIso, patron, patron, patron) as unknown as FilaConteoArchivos;

  const dias = baseDatos
    .prepare(`
      SELECT DISTINCT
             COALESCE(date(e.fecha, 'localtime'), substr(e.fecha, 1, 10)) AS dia
      FROM ejecuciones_respaldo e
      JOIN respaldos r ON r.id = e.respaldo_id
      WHERE r.tipo = 'archivos' AND e.fecha >= ? AND e.fecha <= ?
        ${filtroTexto}
      ORDER BY dia
    `)
    .all(desdeIso, hastaIso, patron, patron, patron) as unknown as { dia: string }[];

  const filas = baseDatos
    .prepare(`
      SELECT e.id, e.respaldo_id, r.nombre AS tarea, r.origen, r.destino,
             e.fecha, e.estado, e.detalle
      FROM ejecuciones_respaldo e
      JOIN respaldos r ON r.id = e.respaldo_id
      WHERE r.tipo = 'archivos' AND e.fecha >= ? AND e.fecha <= ?
        ${filtroTexto}
      ORDER BY e.fecha DESC
      LIMIT ?
    `)
    .all(
      desdeIso,
      hastaIso,
      patron,
      patron,
      patron,
      MAX_EJECUCIONES_ARCHIVOS,
    ) as unknown as FilaEjecucionArchivo[];

  const total = conteo?.total ?? 0;

  return {
    ejecuciones: filas.map((fila) => ({
      id: fila.id,
      respaldoId: fila.respaldo_id,
      tarea: fila.tarea,
      origen: fila.origen,
      destino: fila.destino,
      fecha: fila.fecha,
      dia: diaLocal(fila.fecha),
      estado: esEstadoRespaldo(fila.estado) ? fila.estado : 'pendiente',
      detalle: fila.detalle,
    })),
    resumen: {
      total,
      correctas: conteo?.correctas ?? 0,
      fallidas: conteo?.fallidas ?? 0,
      tareas: conteo?.tareas ?? 0,
      diasConEjecucion: dias.map((fila) => fila.dia),
    },
    truncado: total > filas.length,
  };
}

// Tamaño de los .zip vigentes: cada base y tarea reemplaza su .zip en cada
// ejecución, así que solo se toma el registro más reciente de cada base
// dentro del rango consultado.
export function consultarResumenZip(
  desde: string,
  hasta: string,
  baseDatos: string | null,
): ResumenZipInforme {
  const desdeIso = new Date(`${desde}T00:00:00`).toISOString();
  const hastaIso = new Date(`${hasta}T23:59:59.999`).toISOString();

  const fila = obtenerBaseDatosLocal()
    .prepare(`
      SELECT COUNT(*) AS archivos,
             COALESCE(SUM(vigente.tamano_zip_bytes), 0) AS total
      FROM (
        SELECT r.tamano_zip_bytes,
               ROW_NUMBER() OVER (
                 PARTITION BY e.respaldo_id, r.base_datos
                 ORDER BY e.fecha DESC, r.id DESC
               ) AS orden
        FROM resultados_respaldo r
        JOIN ejecuciones_respaldo e ON e.id = r.ejecucion_id
        WHERE r.archivo_zip IS NOT NULL
          AND r.tamano_zip_bytes IS NOT NULL
          AND e.fecha >= ? AND e.fecha <= ?
          AND (? IS NULL OR r.base_datos = ?)
      ) AS vigente
      WHERE vigente.orden = 1
    `)
    .get(desdeIso, hastaIso, baseDatos, baseDatos) as unknown as
    | { archivos: number | null; total: number | null }
    | undefined;

  return {
    archivos: fila?.archivos ?? 0,
    tamanoTotalBytes: fila?.total ?? 0,
  };
}
