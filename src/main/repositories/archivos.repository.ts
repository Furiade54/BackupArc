import sql from 'mssql';
import type { ArchivoRespaldo } from '../../shared/types/archivo.types';
import { obtenerPool } from '../services/database.service';

interface FilaRespaldo {
  backup_set_id: number;
  database_name: string;
  type: string;
  backup_start_date: Date;
  backup_finish_date: Date | null;
  backup_size: string | number;
  physical_device_name: string;
}

export async function listarArchivos(limite = 20): Promise<ArchivoRespaldo[]> {
  const pool = await obtenerPool();

  const resultado = await pool
    .request()
    .input('limite', sql.Int, limite)
    .query<FilaRespaldo>(`
      SELECT TOP (@limite)
        bs.backup_set_id,
        bs.database_name,
        bs.[type],
        bs.backup_start_date,
        bs.backup_finish_date,
        bs.backup_size,
        bmf.physical_device_name
      FROM msdb.dbo.backupset AS bs
      INNER JOIN msdb.dbo.backupmediafamily AS bmf
        ON bmf.media_set_id = bs.media_set_id
      ORDER BY bs.backup_start_date DESC;
    `);

  return resultado.recordset.map((fila) => ({
    id: fila.backup_set_id,
    baseDatos: fila.database_name,
    tipo: fila.type,
    fechaInicio: new Date(fila.backup_start_date).toISOString(),
    fechaFin: fila.backup_finish_date ? new Date(fila.backup_finish_date).toISOString() : null,
    tamanoBytes: Number(fila.backup_size),
    ruta: fila.physical_device_name,
  }));
}
