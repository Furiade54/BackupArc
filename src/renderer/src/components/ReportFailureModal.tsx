import { useEffect, useState } from 'react';
import type { ResumenDiagnostico } from '../../../shared/types/api.types';
import { Modal } from './Modal';
import './ReportFailureModal.css';

interface ReportFailureModalProps {
  alCerrar: () => void;
}

function formatearBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ReportFailureModal({ alCerrar }: ReportFailureModalProps) {
  const [resumen, setResumen] = useState<ResumenDiagnostico | null>(null);
  const [cargando, setCargando] = useState(true);
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [rutaExportada, setRutaExportada] = useState<string | null>(null);
  const [enlaceReporte, setEnlaceReporte] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    void window.api.diagnostico
      .resumen()
      .then((resultado) => {
        if (!activo) {
          return;
        }

        if (resultado.ok) {
          setResumen(resultado.datos);
        } else {
          setError(resultado.error);
        }
      })
      .catch(() => {
        if (activo) {
          setError('No se pudo leer el diagnóstico de la aplicación.');
        }
      })
      .finally(() => {
        if (activo) {
          setCargando(false);
        }
      });

    return () => {
      activo = false;
    };
  }, []);

  const exportar = async () => {
    setExportando(true);
    setError(null);

    try {
      const resultado = await window.api.diagnostico.exportar();

      if (resultado.ok) {
        setRutaExportada(resultado.datos);
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se pudo generar el archivo de diagnóstico.');
    } finally {
      setExportando(false);
    }
  };

  const reportar = async () => {
    setEnviando(true);
    setError(null);

    try {
      const resultado = await window.api.diagnostico.reportar();

      if (resultado.ok) {
        setEnlaceReporte(resultado.datos.url);
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se pudo abrir el reporte en GitHub.');
    } finally {
      setEnviando(false);
    }
  };

  const totalErrores = resumen?.erroresRecientes.length ?? 0;

  return (
    <Modal titulo="Reportar fallo" alCerrar={alCerrar} clase="modal--reporte">
      {cargando && <p className="reporte__estado">Recopilando información de diagnóstico…</p>}

      {!cargando && resumen && (
        <>
          <p className="reporte__texto">
            Se preparará un reporte con la información técnica de esta instalación. Revisa el
            resumen antes de continuar; no se envía nada hasta que confirmes el Issue en GitHub.
          </p>

          <dl className="reporte__datos">
            <div>
              <dt>Versión de BackupArc</dt>
              <dd>{resumen.version}</dd>
            </div>
            <div>
              <dt>Electron</dt>
              <dd>{resumen.electron}</dd>
            </div>
            <div>
              <dt>Sistema</dt>
              <dd>
                {resumen.plataforma} ({resumen.arquitectura})
              </dd>
            </div>
            <div>
              <dt>Archivos de registro</dt>
              <dd>
                {resumen.archivosLog.length}{' '}
                {resumen.archivosLog.length === 1 ? 'archivo' : 'archivos'}
                {resumen.archivosLog[0] ? ` · ${formatearBytes(resumen.archivosLog[0].bytes)}` : ''}
              </dd>
            </div>
          </dl>

          {totalErrores > 0 ? (
            <>
              <h3 className="reporte__subtitulo">Errores recientes ({totalErrores})</h3>
              <ul className="reporte__errores">
                {resumen.erroresRecientes.map((entrada) => (
                  <li key={`${entrada.momento}-${entrada.mensaje}`}>
                    <code>{entrada.momento}</code> {entrada.mensaje}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="reporte__texto reporte__texto--suave">
              No se encontraron errores recientes en el registro. Aun así puedes exportar el
              diagnóstico completo o abrir un Issue.
            </p>
          )}

          <p className="reporte__texto reporte__texto--suave">
            Los registros completos permanecen en tu equipo. Las contraseñas, tokens y cadenas de
            conexión se eliminan antes de mostrar o transmitir cualquier dato.
          </p>

          <label className="reporte__consentimiento">
            <input type="checkbox" checked={acepta} onChange={(evento) => setAcepta(evento.target.checked)} />
            Acepto enviar esta información de diagnóstico a GitHub.
          </label>

          {error && (
            <p className="formulario__error" role="alert">
              {error}
            </p>
          )}

          {rutaExportada && (
            <p className="reporte__estado">
              Diagnóstico guardado en <code>{rutaExportada}</code>
            </p>
          )}

          {enlaceReporte && (
            <div className="reporte__confirmacion" role="status">
              <p>
                Se abrió GitHub en tu navegador. Al confirmar el formulario obtendrás el enlace y
                el número del Issue creado.
              </p>
              <a href={enlaceReporte} target="_blank" rel="noreferrer">
                Volver a abrir el Issue
              </a>
            </div>
          )}

          <div className="formulario__acciones">
            <button type="button" className="boton boton--secundario" onClick={alCerrar}>
              Cerrar
            </button>
            <button
              type="button"
              className="boton boton--secundario"
              onClick={() => void exportar()}
              disabled={exportando}
            >
              {exportando ? 'Generando…' : 'Exportar diagnóstico'}
            </button>
            <button
              type="button"
              className="boton"
              onClick={() => void reportar()}
              disabled={!acepta || enviando || enlaceReporte !== null}
            >
              {enviando ? 'Abriendo GitHub…' : 'Abrir Issue en GitHub'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
