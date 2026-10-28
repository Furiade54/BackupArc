import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import { logger } from '../utils/logger';

let baseDatos: DatabaseSync | null = null;

interface ColumnaTabla {
  name: string;
}

interface DatosMigrados {
  respaldos: Record<string, unknown>[];
  ejecuciones: Record<string, unknown>[];
}

function migrarEsquemaAnterior(conexion: DatabaseSync): DatosMigrados | null {
  const tabla = conexion
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'respaldos'")
    .get() as { name: string } | undefined;

  if (!tabla) {
    return null;
  }

  const columnas = conexion.prepare('PRAGMA table_info(respaldos)').all() as unknown as ColumnaTabla[];
  const esquemaAnterior =
    columnas.some((columna) => columna.name === 'base_datos') &&
    !columnas.some((columna) => columna.name === 'origen');

  if (!esquemaAnterior) {
    return null;
  }

  const respaldos = conexion.prepare('SELECT * FROM respaldos').all() as unknown as Record<string, unknown>[];
  const tablaEjecuciones = conexion
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ejecuciones_respaldo'")
    .get();
  const ejecuciones = tablaEjecuciones
    ? (conexion.prepare('SELECT * FROM ejecuciones_respaldo').all() as unknown as Record<string, unknown>[])
    : [];

  conexion.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS ejecuciones_respaldo;
    DROP TABLE IF EXISTS respaldos;
  `);

  logger.info('Migrando esquema local de respaldos', {
    respaldos: respaldos.length,
    ejecuciones: ejecuciones.length,
  });

  return { respaldos, ejecuciones };
}

function restaurarDatosMigrados(conexion: DatabaseSync, datos: DatosMigrados): void {
  const insertarRespaldo = conexion.prepare(`
    INSERT INTO respaldos (
      id,
      nombre,
      origen,
      destino,
      frecuencia_minutos,
      hora_ejecucion,
      retencion_dias,
      ultima_ejecucion,
      proxima_ejecucion,
      ultimo_estado,
      creado_en
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const fila of datos.respaldos) {
    insertarRespaldo.run(
      Number(fila.id),
      String(fila.nombre ?? ''),
      String(fila.base_datos ?? fila.origen ?? ''),
      String(fila.destino ?? ''),
      Number(fila.frecuencia_horas ?? 24) * 60,
      String(fila.hora_ejecucion ?? '03:00'),
      Number(fila.retencion_dias ?? 7),
      fila.ultima_ejecucion ? String(fila.ultima_ejecucion) : null,
      String(fila.proxima_ejecucion ?? new Date().toISOString()),
      String(fila.ultimo_estado ?? 'pendiente'),
      String(fila.creado_en ?? new Date().toISOString()),
    );
  }

  const insertarEjecucion = conexion.prepare(`
    INSERT INTO ejecuciones_respaldo (id, respaldo_id, fecha, estado, detalle)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const fila of datos.ejecuciones) {
    insertarEjecucion.run(
      Number(fila.id),
      Number(fila.respaldo_id),
      String(fila.fecha ?? new Date().toISOString()),
      String(fila.estado ?? 'pendiente'),
      fila.detalle ? String(fila.detalle) : null,
    );
  }
}

export function inicializarBaseDatosLocal(): void {
  if (baseDatos) {
    return;
  }

  const ruta = path.join(app.getPath('userData'), 'backuparc.db');
  const conexion = new DatabaseSync(ruta);

  conexion.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);

  const datosMigrados = migrarEsquemaAnterior(conexion);

  conexion.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS preferencias (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      actualizado_en TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS respaldos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'archivos',
      origen TEXT NOT NULL,
      destino TEXT NOT NULL,
      frecuencia_minutos INTEGER NOT NULL,
      hora_ejecucion TEXT NOT NULL,
      retencion_dias INTEGER NOT NULL,
      copia_con_fecha INTEGER NOT NULL DEFAULT 1,
      identificador_unico INTEGER NOT NULL DEFAULT 1,
      comprimir INTEGER NOT NULL DEFAULT 0,
      mssql_conexion TEXT,
      habilitado INTEGER NOT NULL DEFAULT 1,
      ultima_ejecucion TEXT,
      fallo_desde TEXT,
      proxima_ejecucion TEXT NOT NULL,
      ultimo_estado TEXT NOT NULL DEFAULT 'pendiente',
      creado_en TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ejecuciones_respaldo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      respaldo_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      estado TEXT NOT NULL,
      detalle TEXT,
      FOREIGN KEY (respaldo_id) REFERENCES respaldos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ejecuciones_respaldo
      ON ejecuciones_respaldo (respaldo_id, fecha DESC);
  `);

  if (datosMigrados) {
    restaurarDatosMigrados(conexion, datosMigrados);
  }

  const columnasRespaldos = conexion
    .prepare('PRAGMA table_info(respaldos)')
    .all() as unknown as ColumnaTabla[];

  if (!columnasRespaldos.some((columna) => columna.name === 'habilitado')) {
    conexion.exec('ALTER TABLE respaldos ADD COLUMN habilitado INTEGER NOT NULL DEFAULT 1');
  }

  if (!columnasRespaldos.some((columna) => columna.name === 'tipo')) {
    conexion.exec("ALTER TABLE respaldos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'archivos'");
  }

  if (!columnasRespaldos.some((columna) => columna.name === 'copia_con_fecha')) {
    conexion.exec('ALTER TABLE respaldos ADD COLUMN copia_con_fecha INTEGER NOT NULL DEFAULT 1');
  }

  if (!columnasRespaldos.some((columna) => columna.name === 'identificador_unico')) {
    conexion.exec('ALTER TABLE respaldos ADD COLUMN identificador_unico INTEGER NOT NULL DEFAULT 1');
  }

  if (!columnasRespaldos.some((columna) => columna.name === 'comprimir')) {
    conexion.exec('ALTER TABLE respaldos ADD COLUMN comprimir INTEGER NOT NULL DEFAULT 0');
  }

  if (!columnasRespaldos.some((columna) => columna.name === 'mssql_conexion')) {
    conexion.exec('ALTER TABLE respaldos ADD COLUMN mssql_conexion TEXT');
  }

  if (!columnasRespaldos.some((columna) => columna.name === 'fallo_desde')) {
    conexion.exec('ALTER TABLE respaldos ADD COLUMN fallo_desde TEXT');
  }

  // Recalcula el inicio de la racha de fallas desde el historial: corrige tanto
  // tareas que venían fallando antes de existir esta columna como valores
  // guardados incorrectamente por versiones anteriores.
  conexion.exec(`
    UPDATE respaldos
    SET fallo_desde = COALESCE((
      SELECT MIN(e.fecha)
      FROM ejecuciones_respaldo e
      WHERE e.respaldo_id = respaldos.id
        AND e.estado = 'error'
        AND e.fecha > COALESCE(
          (SELECT MAX(e2.fecha)
           FROM ejecuciones_respaldo e2
           WHERE e2.respaldo_id = respaldos.id AND e2.estado <> 'error'),
          ''
        )
    ), fallo_desde)
    WHERE ultimo_estado = 'error';
  `);

  // Backups completos y diferenciales de MSSQL. Se aplica en una transacción:
  // o quedan todas las columnas y la tabla, o no se cambia nada.
  conexion.exec('BEGIN IMMEDIATE');

  try {
    if (!columnasRespaldos.some((columna) => columna.name === 'modo_mssql')) {
      conexion.exec("ALTER TABLE respaldos ADD COLUMN modo_mssql TEXT NOT NULL DEFAULT 'completo'");
    }

    if (!columnasRespaldos.some((columna) => columna.name === 'full_cada_dias')) {
      conexion.exec('ALTER TABLE respaldos ADD COLUMN full_cada_dias INTEGER NOT NULL DEFAULT 7');
    }

    if (!columnasRespaldos.some((columna) => columna.name === 'comprimir_bak')) {
      conexion.exec('ALTER TABLE respaldos ADD COLUMN comprimir_bak INTEGER NOT NULL DEFAULT 0');
    }

    if (!columnasRespaldos.some((columna) => columna.name === 'verificar_bak')) {
      conexion.exec('ALTER TABLE respaldos ADD COLUMN verificar_bak INTEGER NOT NULL DEFAULT 0');
    }

    if (!columnasRespaldos.some((columna) => columna.name === 'usar_copia_temporal')) {
      conexion.exec('ALTER TABLE respaldos ADD COLUMN usar_copia_temporal INTEGER NOT NULL DEFAULT 0');
    }

    if (!columnasRespaldos.some((columna) => columna.name === 'carpeta_temporal')) {
      conexion.exec('ALTER TABLE respaldos ADD COLUMN carpeta_temporal TEXT');
    }

    if (!columnasRespaldos.some((columna) => columna.name === 'carpeta_temporal_lectura')) {
      conexion.exec('ALTER TABLE respaldos ADD COLUMN carpeta_temporal_lectura TEXT');
    }

    if (!columnasRespaldos.some((columna) => columna.name === 'carpeta_zip')) {
      conexion.exec('ALTER TABLE respaldos ADD COLUMN carpeta_zip TEXT');
    }

    const columnasEjecuciones = conexion
      .prepare('PRAGMA table_info(ejecuciones_respaldo)')
      .all() as unknown as ColumnaTabla[];

    if (!columnasEjecuciones.some((columna) => columna.name === 'tipo')) {
      conexion.exec('ALTER TABLE ejecuciones_respaldo ADD COLUMN tipo TEXT');
    }

    if (!columnasEjecuciones.some((columna) => columna.name === 'run_id')) {
      conexion.exec('ALTER TABLE ejecuciones_respaldo ADD COLUMN run_id TEXT');
    }

    conexion.exec(`
      CREATE TABLE IF NOT EXISTS resultados_respaldo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ejecucion_id INTEGER NOT NULL,
        base_datos TEXT NOT NULL,
        tipo_ejecutado TEXT NOT NULL,
        archivo TEXT,
        base_archivo TEXT,
        base_guid TEXT,
        base_lsn TEXT,
        base_fecha TEXT,
        tamano_bytes INTEGER,
        compresion TEXT,
        archivo_zip TEXT,
        tamano_zip_bytes INTEGER,
        estado TEXT NOT NULL,
        detalle TEXT,
        FOREIGN KEY (ejecucion_id) REFERENCES ejecuciones_respaldo(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_resultados_respaldo
        ON resultados_respaldo (ejecucion_id);
    `);

    const columnasResultados = conexion
      .prepare('PRAGMA table_info(resultados_respaldo)')
      .all() as unknown as ColumnaTabla[];

    if (!columnasResultados.some((columna) => columna.name === 'compresion')) {
      conexion.exec('ALTER TABLE resultados_respaldo ADD COLUMN compresion TEXT');
    }

    if (!columnasResultados.some((columna) => columna.name === 'archivo_zip')) {
      conexion.exec('ALTER TABLE resultados_respaldo ADD COLUMN archivo_zip TEXT');
    }

    if (!columnasResultados.some((columna) => columna.name === 'tamano_zip_bytes')) {
      conexion.exec('ALTER TABLE resultados_respaldo ADD COLUMN tamano_zip_bytes INTEGER');
    }

    conexion.exec('COMMIT');
  } catch (error) {
    conexion.exec('ROLLBACK');
    throw error;
  }

  if (columnasRespaldos.some((columna) => columna.name === 'frecuencia_horas')) {
    // Bases de datos creadas antes de admitir frecuencias en minutos.
    conexion.exec(`
      ALTER TABLE respaldos RENAME COLUMN frecuencia_horas TO frecuencia_minutos;
      UPDATE respaldos SET frecuencia_minutos = frecuencia_minutos * 60;
    `);
  }

  baseDatos = conexion;
  logger.info('Base de datos local inicializada', ruta);
}

export function obtenerBaseDatosLocal(): DatabaseSync {
  if (!baseDatos) {
    throw new Error('La base de datos local no está inicializada.');
  }

  return baseDatos;
}

export function obtenerPreferencia(clave: string): string | null {
  const fila = obtenerBaseDatosLocal()
    .prepare('SELECT valor FROM preferencias WHERE clave = ?')
    .get(clave) as { valor: string } | undefined;

  return fila?.valor ?? null;
}

export function obtenerPreferenciaConDefecto(clave: string, valorPorDefecto: string): string {
  try {
    return obtenerPreferencia(clave) ?? valorPorDefecto;
  } catch {
    return valorPorDefecto;
  }
}

export function guardarPreferencia(clave: string, valor: string): void {
  obtenerBaseDatosLocal()
    .prepare(`
      INSERT INTO preferencias (clave, valor, actualizado_en)
      VALUES (?, ?, ?)
      ON CONFLICT(clave) DO UPDATE SET
        valor = excluded.valor,
        actualizado_en = excluded.actualizado_en
    `)
    .run(clave, valor, new Date().toISOString());
}

export function cerrarBaseDatosLocal(): void {
  if (!baseDatos) {
    return;
  }

  baseDatos.close();
  baseDatos = null;
}
