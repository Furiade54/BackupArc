import type { RespaldoConfigurado } from '../../../shared/types/respaldo.types';
import { formatearBasesDatos } from '../../../shared/utils/bases-datos';
import {
  formatearAntiguedad,
  formatearDuracionDetallada,
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

type EstadoBarra = 'reciente' | 'media' | 'porVencer' | 'vencida' | 'deshabilitado';

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
  reciente: 'Reciente',
  media: 'Antigüedad media',
  porVencer: 'Por vencer',
  vencida: 'Vencida',
  deshabilitado: 'Deshabilitada',
};

function estadoPorcentaje(porcentaje: number): EstadoBarra {
  if (porcentaje >= 100) {
    return 'vencida';
  }

  if (porcentaje >= 75) {
    return 'porVencer';
  }

  if (porcentaje >= 50) {
    return 'media';
  }

  return 'reciente';
}

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
  // La barra mide el tiempo transcurrido desde la última ejecución (o desde la
  // falla): 0 % recién ejecutado y 100 % cuando vence el ciclo.
  const vencio = ahora > new Date(respaldo.proximaEjecucion).getTime();
  const fallo = respaldo.ultimoEstado === 'error';
  // Se mide contra la frecuencia configurada, no contra la próxima ejecución
  // guardada, para que "7 h de 24 h" siempre corresponda al porcentaje.
  const duracionCicloMs = Math.max(respaldo.frecuenciaMinutos, 1) * 60_000;
  const transcurridoMs = ahora - new Date(inicioCiclo).getTime();
  const porcentaje = vencio
    ? 100
    : Math.min(100, Math.max(0, (transcurridoMs / duracionCicloMs) * 100));
  const porcentajeRedondeado = Math.round(porcentaje);
  const estadoBarra: EstadoBarra = !respaldo.habilitado
    ? 'deshabilitado'
    : fallo
      ? 'vencida'
      : estadoPorcentaje(porcentaje);
  const antiguedadTexto = respaldo.ultimaEjecucion
    ? formatearAntiguedad(respaldo.ultimaEjecucion, ahora)
    : 'Sin ejecuciones';
  // La racha de fallas se cuenta desde la primera falla consecutiva.
  const inicioFallo = respaldo.falloDesde ?? respaldo.ultimaEjecucion;
  const duracionFallo = formatearDuracionDetallada(inicioFallo, ahora);
  const etiquetaUltimo = fallo ? 'Viene fallando' : 'Último backup';
  const valorUltimo = !respaldo.ultimaEjecucion
    ? 'Sin ejecuciones'
    : fallo
      ? `hace ${duracionFallo}`
      : antiguedadTexto;
  const etiquetaMedidor = fallo ? 'Desde el último intento' : 'Antigüedad del backup';
  const frecuenciaTexto = formatearFrecuencia(respaldo.frecuenciaMinutos);
  const frecuenciaVisible = frecuenciaTexto.charAt(0).toUpperCase() + frecuenciaTexto.slice(1);
  const limiteTexto = frecuenciaTexto.replace(/^cada /, '');
  const resumenAntiguedad = fallo
    ? `Viene fallando desde ${inicioFallo ? formatearFechaHora(inicioFallo) : '—'}; último intento ${antiguedadTexto} (${porcentajeRedondeado}% · Fallida)`
    : `Antigüedad: ${antiguedadTexto.replace(/^hace /, '')} de ${limiteTexto} (${porcentajeRedondeado}% · ${ETIQUETAS_BARRA[estadoBarra]})`;
  const origenVisible =
    respaldo.tipo === 'mssql' ? formatearBasesDatos(respaldo.origen) : respaldo.origen;

  return (
    <article
      className={`tarjeta-respaldo${respaldo.habilitado ? '' : ' tarjeta-respaldo--deshabilitada'}${
        ejecutando ? ' tarjeta-respaldo--ejecutando' : ''
      }`}
      aria-busy={ejecutando}
      onContextMenu={(evento) => {
        evento.preventDefault();
        // Evita que el menú de la tarjeta sea reemplazado por el del fondo.
        evento.stopPropagation();
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
            title={`Origen: ${origenVisible}\nDestino: ${respaldo.destino}`}
          >
            {origenVisible}
          </p>
        </div>

        <span
          className={`punto-estado punto-estado--${respaldo.habilitado ? 'activa' : 'inactiva'}${
            ejecutando ? ' punto-estado--ejecutando' : ''
          }`}
          title={ejecutando ? 'Ejecutando copia…' : respaldo.habilitado ? 'Tarea activa' : 'Tarea inactiva'}
          aria-label={ejecutando ? 'Ejecutando copia' : respaldo.habilitado ? 'Tarea activa' : 'Tarea inactiva'}
        />
      </header>

      <div className="tarjeta-respaldo__fila">
        <span>{etiquetaUltimo}</span>
        <strong
          title={
            fallo && respaldo.ultimaEjecucion
              ? `Último intento: ${formatearFechaHora(respaldo.ultimaEjecucion)}`
              : respaldo.ultimaEjecucion
                ? formatearFechaHora(respaldo.ultimaEjecucion)
                : undefined
          }
        >
          {valorUltimo}
        </strong>
      </div>

      <div className="tarjeta-respaldo__medidor">
        <span className="tarjeta-respaldo__medidor-etiqueta">{etiquetaMedidor}</span>
        <span className="tarjeta-respaldo__porcentaje">{porcentajeRedondeado}%</span>
      </div>

      <div
        className={`barra-ciclo${ejecutando ? ' barra-ciclo--ejecutando' : ''}`}
        role="progressbar"
        aria-label={etiquetaMedidor}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={porcentajeRedondeado}
        aria-valuetext={resumenAntiguedad}
        title={resumenAntiguedad}
      >
        <span
          className={`barra-ciclo__relleno barra-ciclo__relleno--${estadoBarra}`}
          style={{ width: `${porcentaje}%` }}
        />
      </div>

      <div className="tarjeta-respaldo__fila">
        <span>Próximo backup</span>
        <strong title={formatearFechaHora(respaldo.proximaEjecucion)}>
          {formatearHora(respaldo.proximaEjecucion)}
        </strong>
      </div>

      <p className="tarjeta-respaldo__repeticion">
        {frecuenciaVisible}
        {respaldo.tipo === 'mssql' &&
          (respaldo.modoMssql === 'diferencial' ? ' · MSSQL · Diferencial' : ' · MSSQL')}
        {respaldo.comprimir && ' · ZIP'}
        {!respaldo.habilitado && ' · Deshabilitada'}
        {ejecutando && (
          <span className="indicador-ejecucion">
            <span className="indicador-ejecucion__spinner" aria-hidden="true" />
            Ejecutando copia…
          </span>
        )}
      </p>

      <div className="tarjeta-respaldo__pie">
        <button type="button" className="enlace-accion" onClick={() => alVerHistorial(respaldo)}>
          Ver historial
        </button>

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
