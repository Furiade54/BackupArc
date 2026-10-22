import { useEffect, useState } from 'react';
import type { EjecucionRespaldo, RespaldoConfigurado } from '../../../shared/types/respaldo.types';
import { formatearBasesDatos } from '../../../shared/utils/bases-datos';
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

function IconoCarpeta() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 4.2c0-.6.4-1 1-1h3l1.3 1.5h6.2c.6 0 1 .4 1 1v6.1c0 .6-.4 1-1 1h-10c-.6 0-1-.4-1-1V4.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HistoryModal({ respaldo, alCerrar }: HistoryModalProps) {
  const [ejecuciones, setEjecuciones] = useState<EjecucionRespaldo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisoApertura, setAvisoApertura] = useState<string | null>(null);

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

  const abrirDestino = async () => {
    setAvisoApertura(null);

    try {
      const resultado = await window.api.sistema.abrirRuta(respaldo.destino);

      if (!resultado.ok) {
        setAvisoApertura(resultado.error);
      }
    } catch {
      setAvisoApertura('No se pudo abrir la carpeta destino.');
    }
  };

  return (
    <Modal titulo={`Historial · ${respaldo.nombre}`} alCerrar={alCerrar}>
      <dl className="resumen-respaldo">
        <div>
          <dt>Tipo</dt>
          <dd>{respaldo.tipo === 'mssql' ? 'Base de datos MSSQL' : 'Archivos y carpetas'}</dd>
        </div>
        <div>
          <dt>{respaldo.tipo === 'mssql' ? 'Bases de datos' : 'Origen'}</dt>
          <dd title={respaldo.origen}>
            {respaldo.tipo === 'mssql'
              ? formatearBasesDatos(respaldo.origen)
              : respaldo.origen}
          </dd>
        </div>
        <div>
          <dt>Destino</dt>
          <dd className="resumen-respaldo__ruta">
            <span title={respaldo.destino}>{respaldo.destino}</span>
            <button
              type="button"
              className="resumen-respaldo__abrir"
              onClick={() => void abrirDestino()}
              title="Abrir la carpeta de destino"
              aria-label="Abrir la carpeta de destino"
            >
              <IconoCarpeta />
            </button>
          </dd>
        </div>
        <div>
          <dt>Frecuencia</dt>
          <dd>{formatearFrecuencia(respaldo.frecuenciaMinutos)}</dd>
        </div>
        <div>
          <dt>Retención</dt>
          <dd>{respaldo.tipo === 'mssql' ? 'No aplica' : `${respaldo.retencionDias} días`}</dd>
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

      {avisoApertura && (
        <p className="formulario__error" role="alert">
          {avisoApertura}
        </p>
      )}

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
            <li
              key={ejecucion.id}
              className="historial__item historial__item--abrible"
              role="button"
              tabIndex={0}
              title="Abrir la carpeta de destino"
              onClick={() => void abrirDestino()}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter' || evento.key === ' ') {
                  evento.preventDefault();
                  void abrirDestino();
                }
              }}
            >
              <span
                className={`historial__punto historial__punto--${ejecucion.estado}`}
                aria-hidden="true"
              />
              <div className="historial__detalle-contenedor">
                <p className="historial__fecha">{formatearFechaHora(ejecucion.fecha)}</p>
                {ejecucion.detalle && <p className="historial__detalle">{ejecucion.detalle}</p>}
              </div>
              <div className="historial__acciones">
                <span className={`etiqueta etiqueta--${ejecucion.estado}`}>
                  {ETIQUETAS_ESTADO[ejecucion.estado]}
                </span>
                <span className="historial__abrir" aria-hidden="true">
                  <IconoCarpeta />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
