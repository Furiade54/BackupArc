import { useEffect, useState } from 'react';
import type { ResultadoActualizacion } from '../../../shared/types/api.types';
import { Modal } from './Modal';
import './UpdateModal.css';

interface UpdateModalProps {
  resultado: ResultadoActualizacion | null;
  buscando: boolean;
  alCerrar: () => void;
}

export function UpdateModal({ resultado, buscando, alCerrar }: UpdateModalProps) {
  const [instalando, setInstalando] = useState(false);
  const [porcentaje, setPorcentaje] = useState(0);
  const [errorInstalacion, setErrorInstalacion] = useState<string | null>(null);

  useEffect(() => {
    return window.api.actualizaciones.alProgresoDescarga((progreso) => {
      setPorcentaje(progreso.porcentaje);
    });
  }, []);

  const instalar = async () => {
    setInstalando(true);
    setErrorInstalacion(null);
    setPorcentaje(0);

    const respuesta = await window.api.actualizaciones.instalar();

    if (!respuesta.ok) {
      setErrorInstalacion(respuesta.error);
      setInstalando(false);
    }
  };

  return (
    <Modal titulo="Buscar actualizaciones" alCerrar={alCerrar}>
      {buscando && <p className="actualizacion__estado">Buscando actualizaciones…</p>}

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

          {instalando && (
            <div className="actualizacion__progreso">
              <div
                className="actualizacion__barra"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={porcentaje}
              >
                <span className="actualizacion__barra-relleno" style={{ width: `${porcentaje}%` }} />
              </div>
              <span className="actualizacion__estado">
                {porcentaje < 100
                  ? `Descargando el instalador… ${porcentaje}%`
                  : 'Acepta el aviso de permisos de Windows para instalar…'}
              </span>
            </div>
          )}

          {errorInstalacion && (
            <p className="formulario__error" role="alert">
              {errorInstalacion}
            </p>
          )}

          <div className="formulario__acciones">
            <button
              type="button"
              className="boton boton--secundario"
              onClick={alCerrar}
              disabled={instalando}
            >
              Cerrar
            </button>

            {resultado.estado === 'disponible' && (
              <button type="button" className="boton" onClick={() => void instalar()} disabled={instalando}>
                {instalando ? 'Instalando…' : 'Descargar e instalar'}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
