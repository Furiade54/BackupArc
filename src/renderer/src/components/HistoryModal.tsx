import { useEffect, useState } from 'react';
import type { EjecucionRespaldo, RespaldoConfigurado } from '../../../shared/types/respaldo.types';
import {
  ETIQUETAS_ESTADO,
  formatearFecha,
  formatearFechaHora,
  formatearFrecuencia,
  formatearHora,
} from '../utils/formato';
import { Modal } from './Modal';
import './BackupModals.css';

interface HistoryModalProps {
  respaldo: RespaldoConfigurado;
  alCerrar: () => void;
}

export function HistoryModal({ respaldo, alCerrar }: HistoryModalProps) {
  const [ejecuciones, setEjecuciones] = useState<EjecucionRespaldo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    void window.api.respaldos
      .historial(respaldo.id)
      .then((resultado) => {
        if (!activo) {
          return;
        }

        if (resultado.ok) {
          setEjecuciones(resultado.datos);
        } else {
          setError(resultado.error);
        }
      })
      .catch(() => {
        if (activo) {
          setError('No se pudo cargar el historial.');
        }
      });

    return () => {
      activo = false;
    };
  }, [respaldo.id]);

  return (
    <Modal titulo={`Historial · ${respaldo.nombre}`} alCerrar={alCerrar}>
      <dl className="resumen-respaldo">
        <div>
          <dt>Origen</dt>
          <dd title={respaldo.origen}>{respaldo.origen}</dd>
        </div>
        <div>
          <dt>Destino</dt>
          <dd title={respaldo.destino}>{respaldo.destino}</dd>
        </div>
        <div>
          <dt>Frecuencia</dt>
          <dd>{formatearFrecuencia(respaldo.frecuenciaMinutos)}</dd>
        </div>
        <div>
          <dt>Retención</dt>
          <dd>{respaldo.retencionDias} días</dd>
        </div>
        <div>
          <dt>Última ejecución</dt>
          <dd>{respaldo.ultimaEjecucion ? formatearFecha(respaldo.ultimaEjecucion) : 'Sin ejecuciones'}</dd>
        </div>
        <div>
          <dt>Próxima ejecución</dt>
          <dd title={formatearFechaHora(respaldo.proximaEjecucion)}>{formatearHora(respaldo.proximaEjecucion)}</dd>
        </div>
      </dl>

      <h3 className="historial__titulo">Ejecuciones registradas</h3>

      {error && (
        <p className="formulario__error" role="alert">
          {error}
        </p>
      )}

      {!error && ejecuciones === null && <p className="historial__vacio">Cargando historial…</p>}

      {ejecuciones && ejecuciones.length === 0 && (
        <p className="historial__vacio">
          Sin ejecuciones registradas. El historial se llenará cuando esta copia se ejecute.
        </p>
      )}

      {ejecuciones && ejecuciones.length > 0 && (
        <ul className="historial">
          {ejecuciones.map((ejecucion) => (
            <li key={ejecucion.id} className="historial__item">
              <span
                className={`historial__punto historial__punto--${ejecucion.estado}`}
                aria-hidden="true"
              />
              <div className="historial__detalle-contenedor">
                <p className="historial__fecha">{formatearFechaHora(ejecucion.fecha)}</p>
                {ejecucion.detalle && <p className="historial__detalle">{ejecucion.detalle}</p>}
              </div>
              <span className={`etiqueta etiqueta--${ejecucion.estado}`}>
                {ETIQUETAS_ESTADO[ejecucion.estado]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
