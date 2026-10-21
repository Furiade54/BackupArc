export interface ArchivoRespaldo {
  id: number;
  baseDatos: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string | null;
  tamanoBytes: number;
  ruta: string;
}
