import type { ResultadoActualizacion } from '../../../shared/types/api.types';
import { Modal } from './Modal';
import './UpdateModal.css';

interface UpdateModalProps {
  resultado: ResultadoActualizacion | null;
  buscando: boolean;
  alCerrar: () => void;
}

export function UpdateModal({ resultado, buscando, alCerrar }: UpdateModalProps) {
  const abrirPublicacion = () => {
    if (!resultado?.urlPublicacion) {
      return;
    }

    void window.api.actualizaciones.abrir(resultado.urlPublicacion);
  };

  return (
    <Modal titulo="Buscar actualizaciones" alCerrar={alCerrar}>
      {buscando && <p className="actualizacion__estado">Consultando GitHub Releases…</p>}

      {!buscando && resultado && (
        <>
          {resultado.estado === 'disponible' && (
            <>
              <p className="actualizacion__texto">
                Hay una nueva versión disponible: <strong>{resultado.versionDisponible}</strong>.
                Tienes instalada la <strong>{resultado.versionActual}</strong>.
              </p>

              {resultado.notas && <div className="actualizacion__notas">{resultado.notas}</div>}
            </>
          )}

          {resultado.estado === 'actualizado' && (
            <p className="actualizacion__texto">
              {resultado.mensaje ?? `Estás usando la última versión disponible (${resultado.versionActual}).`}
            </p>
          )}

          {resultado.estado === 'error' && (
            <p className="formulario__error" role="alert">
              {resultado.mensaje ?? 'No se pudo comprobar si hay actualizaciones.'}
            </p>
          )}

          <div className="formulario__acciones">
            <button type="button" className="boton boton--secundario" onClick={alCerrar}>
              Cerrar
            </button>

            {resultado.estado === 'disponible' && resultado.urlPublicacion && (
              <button type="button" className="boton" onClick={abrirPublicacion}>
                Abrir en GitHub
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
