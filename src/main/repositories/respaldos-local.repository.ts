import type {
  EjecucionRespaldo,
  EstadoRespaldo,
  NuevoRespaldo,
  RespaldoConfigurado,
} from '../../shared/types/respaldo.types';
import { obtenerBaseDatosLocal } from '../services/local-database.service';

interface FilaRespaldo {
  id: number;
  nombre: string;
  origen: string;
  destino: string;
  frecuencia_minutos: number;
  hora_ejecucion: string;
  retencion_dias: number;
  copia_con_fecha: number;
  comprimir: number;
  habilitado: number;
  ultima_ejecucion: string | null;
  proxima_ejecucion: string;
  ultimo_estado: string;
  creado_en: string;
}

interface FilaEjecucion {
  id: number;
  fecha: string;
  estado: string;
  detalle: string | null;
}

function esEstadoRespaldo(valor: string): valor is EstadoRespaldo {
  return valor === 'ok' || valor === 'advertencia' || valor === 'error' || valor === 'pendiente';
}

function mapearRespaldo(fila: FilaRespaldo): RespaldoConfigurado {
  return {
    id: fila.id,
    nombre: fila.nombre,
    origen: fila.origen,
    destino: fila.destino,
    frecuenciaMinutos: fila.frecuencia_minutos,
    horaEjecucion: fila.hora_ejecucion,
    retencionDias: fila.retencion_dias,
    copiaConFecha: fila.copia_con_fecha === 1,
    comprimir: fila.comprimir === 1,
    habilitado: fila.habilitado === 1,
    ultimaEjecucion: fila.ultima_ejecucion,
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
        origen,
        destino,
        frecuencia_minutos,
        hora_ejecucion,
        retencion_dias,
        copia_con_fecha,
        comprimir,
        ultima_ejecucion,
        proxima_ejecucion,
        ultimo_estado,
        creado_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pendiente', ?)
    `)
    .run(
      datos.nombre,
      datos.origen,
      datos.destino,
      datos.frecuenciaMinutos,
      datos.horaEjecucion,
      datos.retencionDias,
      datos.copiaConFecha ? 1 : 0,
      datos.comprimir ? 1 : 0,
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

  const resultado = baseDatos
    .prepare(`
      UPDATE respaldos
      SET nombre = ?,
          origen = ?,
          destino = ?,
          frecuencia_minutos = ?,
          hora_ejecucion = ?,
          retencion_dias = ?,
          copia_con_fecha = ?,
          comprimir = ?,
          proxima_ejecucion = ?
      WHERE id = ?
    `)
    .run(
      datos.nombre,
      datos.origen,
      datos.destino,
      datos.frecuenciaMinutos,
      datos.horaEjecucion,
      datos.retencionDias,
      datos.copiaConFecha ? 1 : 0,
      datos.comprimir ? 1 : 0,
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
): void {
  obtenerBaseDatosLocal()
    .prepare(`
      INSERT INTO ejecuciones_respaldo (respaldo_id, fecha, estado, detalle)
      VALUES (?, ?, ?, ?)
    `)
    .run(respaldoId, fecha, estado, detalle);
}

export function actualizarEstadoRespaldo(
  id: number,
  estado: EstadoRespaldo,
  ultimaEjecucion: string,
  proximaEjecucion: string,
): void {
  obtenerBaseDatosLocal()
    .prepare(`
      UPDATE respaldos
      SET ultimo_estado = ?,
          ultima_ejecucion = ?,
          proxima_ejecucion = ?
      WHERE id = ?
    `)
    .run(estado, ultimaEjecucion, proximaEjecucion, id);
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
      SELECT id, fecha, estado, detalle
      FROM ejecuciones_respaldo
      WHERE respaldo_id = ?
      ORDER BY fecha DESC
    `)
    .all(id) as unknown as FilaEjecucion[];

  return filas.map((fila) => ({
    id: fila.id,
    fecha: fila.fecha,
    estado: esEstadoRespaldo(fila.estado) ? fila.estado : 'pendiente',
    detalle: fila.detalle,
  }));
}
