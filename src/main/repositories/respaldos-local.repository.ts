import type {
  CompresionBak,
  ConexionMssql,
  EjecucionRespaldo,
  EstadoRespaldo,
  ModoRespaldoMssql,
  NuevoRespaldo,
  NuevoResultadoBaseRespaldo,
  ResultadoBaseRespaldo,
  RespaldoConfigurado,
  ResumenConexionMssql,
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
  mssql_conexion: string | null;
  destino: string;
  frecuencia_minutos: number;
  hora_ejecucion: string;
  retencion_dias: number;
  copia_con_fecha: number;
  comprimir: number;
  modo_mssql: string;
  full_cada_dias: number;
  comprimir_bak: number;
  verificar_bak: number;
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
    conexionMssql: conexionDeFila(fila),
    destino: fila.destino,
    frecuenciaMinutos: fila.frecuencia_minutos,
    horaEjecucion: fila.hora_ejecucion,
    retencionDias: fila.retencion_dias,
    copiaConFecha: fila.copia_con_fecha === 1,
    comprimir: fila.comprimir === 1,
    modoMssql: esModoMssql(fila.modo_mssql) ? fila.modo_mssql : 'completo',
    fullCadaDias: fila.full_cada_dias,
    comprimirBak: fila.comprimir_bak === 1,
    verificarBak: fila.verificar_bak === 1,
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
        destino,
        frecuencia_minutos,
        hora_ejecucion,
        retencion_dias,
        copia_con_fecha,
        comprimir,
        modo_mssql,
        full_cada_dias,
        comprimir_bak,
        verificar_bak,
        mssql_conexion,
        ultima_ejecucion,
        proxima_ejecucion,
        ultimo_estado,
        creado_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pendiente', ?)
    `)
    .run(
      datos.nombre,
      datos.tipo,
      datos.origen,
      datos.destino,
      datos.frecuenciaMinutos,
      datos.horaEjecucion,
      datos.retencionDias,
      datos.copiaConFecha ? 1 : 0,
      datos.comprimir ? 1 : 0,
      datos.modoMssql,
      datos.fullCadaDias,
      datos.comprimirBak ? 1 : 0,
      datos.verificarBak ? 1 : 0,
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
          mssql_conexion = ?,
          destino = ?,
          frecuencia_minutos = ?,
          hora_ejecucion = ?,
          retencion_dias = ?,
          copia_con_fecha = ?,
          comprimir = ?,
          modo_mssql = ?,
          full_cada_dias = ?,
          comprimir_bak = ?,
          verificar_bak = ?,
          proxima_ejecucion = ?
      WHERE id = ?
    `)
    .run(
      datos.nombre,
      datos.tipo,
      datos.origen,
      conexionMssql,
      datos.destino,
      datos.frecuenciaMinutos,
      datos.horaEjecucion,
      datos.retencionDias,
      datos.copiaConFecha ? 1 : 0,
      datos.comprimir ? 1 : 0,
      datos.modoMssql,
      datos.fullCadaDias,
      datos.comprimirBak ? 1 : 0,
      datos.verificarBak ? 1 : 0,
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
  opciones: { tipo?: string | null; runId?: string | null } = {},
): number {
  const resultado = obtenerBaseDatosLocal()
    .prepare(`
      INSERT INTO ejecuciones_respaldo (respaldo_id, fecha, estado, detalle, tipo, run_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      respaldoId,
      fecha,
      estado,
      detalle,
      opciones.tipo ?? null,
      opciones.runId ?? null,
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
      estado,
      detalle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      SELECT id, fecha, estado, detalle, tipo, run_id
      FROM ejecuciones_respaldo
      WHERE respaldo_id = ?
      ORDER BY fecha DESC
    `)
    .all(id) as unknown as FilaEjecucion[];

  const resultados = baseDatos
    .prepare(`
      SELECT r.id, r.ejecucion_id, r.base_datos, r.tipo_ejecutado, r.archivo,
             r.base_archivo, r.base_guid, r.base_lsn, r.base_fecha,
             r.tamano_bytes, r.compresion, r.estado, r.detalle
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
    resultados: resultadosPorEjecucion.get(fila.id) ?? [],
  }));
}
