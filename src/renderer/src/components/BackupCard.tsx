import type { RespaldoConfigurado } from '../../../shared/types/respaldo.types';
import {
  ETIQUETAS_ESTADO,
  calcularPorcentajeCiclo,
  formatearFecha,
  formatearFechaHora,
  formatearFrecuencia,
  formatearHora,
} from '../utils/formato';
import './BackupCard.css';

interface BackupCardProps {
  respaldo: RespaldoConfigurado;
  ahora: number;
  ejecutando: boolean;
  alVerHistorial: (respaldo: RespaldoConfigurado) => void;
  alEliminar: (respaldo: RespaldoConfigurado) => void;
  alAlternarActivo: (respaldo: RespaldoConfigurado) => void;
  alEditar: (respaldo: RespaldoConfigurado) => void;
  alAbrirMenuContextual: (respaldo: RespaldoConfigurado, posicion: { x: number; y: number }) => void;
}

type EstadoBarra = 'vigente' | 'vencido' | 'deshabilitado';

function IconoPapelera() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 4h10M6 4V2.5h4V4M4.5 4l.6 9.5h5.8l.6-9.5M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconoPausa() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 3.5v9M10.5 3.5v9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconoReproducir() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 3.5 12 8l-6.5 4.5z" fill="currentColor" />
    </svg>
  );
}

const ETIQUETAS_BARRA: Record<EstadoBarra, string> = {
  vigente: 'Vigente',
  vencido: 'Vencida',
  deshabilitado: 'Deshabilitada',
};

export function BackupCard({
  respaldo,
  ahora,
  ejecutando,
  alVerHistorial,
  alEliminar,
  alAlternarActivo,
  alEditar,
  alAbrirMenuContextual,
}: BackupCardProps) {
  const inicioCiclo = respaldo.ultimaEjecucion ?? respaldo.creadoEn;
  const vencido = ahora > new Date(respaldo.proximaEjecucion).getTime();
  const estadoBarra: EstadoBarra = !respaldo.habilitado ? 'deshabilitado' : vencido ? 'vencido' : 'vigente';
  const porcentaje = vencido ? 100 : calcularPorcentajeCiclo(inicioCiclo, respaldo.proximaEjecucion, ahora);
  const porcentajeRedondeado = Math.round(porcentaje);

  return (
    <article
      className={`tarjeta-respaldo${respaldo.habilitado ? '' : ' tarjeta-respaldo--deshabilitada'}${
        ejecutando ? ' tarjeta-respaldo--ejecutando' : ''
      }`}
      aria-busy={ejecutando}
      onContextMenu={(evento) => {
        evento.preventDefault();
        alAbrirMenuContextual(respaldo, { x: evento.clientX, y: evento.clientY });
      }}
      onDoubleClick={(evento) => {
        if ((evento.target as HTMLElement).closest('button, a')) {
          return;
        }

        alEditar(respaldo);
      }}
    >
      <header className="tarjeta-respaldo__encabezado">
        <div className="tarjeta-respaldo__identidad">
          <h3 className="tarjeta-respaldo__nombre" title={respaldo.nombre}>
            {respaldo.nombre}
          </h3>
          <p
            className="tarjeta-respaldo__base"
            title={`Origen: ${respaldo.origen}\nDestino: ${respaldo.destino}`}
          >
            {respaldo.origen}
          </p>
        </div>

        <span
          className={`punto-estado punto-estado--${respaldo.ultimoEstado}${
            ejecutando ? ' punto-estado--ejecutando' : ''
          }`}
          title={ejecutando ? 'Ejecutando copia…' : ETIQUETAS_ESTADO[respaldo.ultimoEstado]}
          aria-label={ejecutando ? 'Ejecutando copia' : `Estado: ${ETIQUETAS_ESTADO[respaldo.ultimoEstado]}`}
        />
      </header>

      <div className="tarjeta-respaldo__fila">
        <span>Última ejecución</span>
        <strong>{respaldo.ultimaEjecucion ? formatearFecha(respaldo.ultimaEjecucion) : 'Sin ejecuciones'}</strong>
      </div>

      <div
        className={`barra-ciclo${ejecutando ? ' barra-ciclo--ejecutando' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={porcentajeRedondeado}
        aria-valuetext={
          ejecutando
            ? 'Ejecutando copia'
            : `${ETIQUETAS_BARRA[estadoBarra]}: ${porcentajeRedondeado}% del ciclo hasta la próxima ejecución`
        }
        title={ejecutando ? 'Ejecutando copia…' : `${ETIQUETAS_BARRA[estadoBarra]} · ${porcentajeRedondeado}% del ciclo`}
      >
        <span
          className={`barra-ciclo__relleno barra-ciclo__relleno--${estadoBarra}`}
          style={{ width: ejecutando ? '100%' : `${porcentaje}%` }}
        />
      </div>

      <p className="tarjeta-respaldo__repeticion">
        Repetición {formatearFrecuencia(respaldo.frecuenciaHoras)}
        {!respaldo.habilitado && ' · Deshabilitada'}
        {ejecutando && (
          <span className="indicador-ejecucion">
            <span className="indicador-ejecucion__punto" aria-hidden="true" />
            Ejecutando copia…
          </span>
        )}
      </p>

      <button type="button" className="enlace-accion" onClick={() => alVerHistorial(respaldo)}>
        Ver historial
      </button>

      <div className="tarjeta-respaldo__pie">
        <span
          className="tarjeta-respaldo__proxima"
          title={formatearFechaHora(respaldo.proximaEjecucion)}
        >
          Próxima ejecución: {formatearHora(respaldo.proximaEjecucion)}
        </span>

        <div className="tarjeta-respaldo__acciones">
          <button
            type="button"
            className="boton-icono"
            aria-label={`${respaldo.habilitado ? 'Deshabilitar' : 'Habilitar'} ${respaldo.nombre}`}
            title={respaldo.habilitado ? 'Deshabilitar copia' : 'Habilitar copia'}
            onClick={() => alAlternarActivo(respaldo)}
          >
            {respaldo.habilitado ? <IconoPausa /> : <IconoReproducir />}
          </button>

          <button
            type="button"
            className="boton-icono boton-icono--peligro"
            aria-label={`Eliminar ${respaldo.nombre}`}
            title="Eliminar copia"
            onClick={() => alEliminar(respaldo)}
          >
            <IconoPapelera />
          </button>
        </div>
      </div>
    </article>
  );
}
