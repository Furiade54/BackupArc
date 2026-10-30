import { useEffect, useState } from 'react';
import type { RespaldoConfigurado } from '../../../shared/types/respaldo.types';
import { formatearFecha, formatearFechaHora, formatearFrecuencia, formatearHora } from '../utils/formato';
import { fechaLocal } from '../utils/informe';
import './PanelControl.css';

export type FiltroCopias = 'todas' | 'activas' | 'error';

interface PanelControlProps {
  respaldos: RespaldoConfigurado[];
  alCrearCopia: () => void;
  alVerCopias: (filtro: FiltroCopias, resaltarId?: number) => void;
}

interface Actividad {
  serie: { dia: string; total: number }[];
  total: number;
  correctas: number;
  fallidas: number;
  advertencias: number;
}

const DIAS_ACTIVIDAD = 14;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function porProximaEjecucion(a: RespaldoConfigurado, b: RespaldoConfigurado): number {
  return new Date(a.proximaEjecucion).getTime() - new Date(b.proximaEjecucion).getTime();
}

function GraficoLinea({ serie }: { serie: Actividad['serie'] }) {
  const ancho = 620;
  const alto = 190;
  const margenX = 16;
  const margenSuperior = 18;
  const margenInferior = 26;
  const maximo = Math.max(1, ...serie.map((punto) => punto.total));
  const paso = (ancho - margenX * 2) / Math.max(1, serie.length - 1);
  const base = alto - margenInferior;

  const puntos = serie.map((punto, indice) => ({
    ...punto,
    x: margenX + indice * paso,
    y: base - (punto.total / maximo) * (alto - margenSuperior - margenInferior),
  }));

  const trazo = puntos
    .map((punto, indice) => `${indice === 0 ? 'M' : 'L'}${punto.x.toFixed(1)},${punto.y.toFixed(1)}`)
    .join(' ');
  const area = `${trazo} L${puntos[puntos.length - 1].x.toFixed(1)},${base} L${puntos[0].x.toFixed(1)},${base} Z`;

  return (
    <svg
      className="panel-control__grafico"
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label={`Ejecuciones por día en los últimos ${serie.length} días`}
    >
      <defs>
        <linearGradient id="panel-control-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--acento)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--acento)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0.33, 0.66].map((parte) => (
        <line
          key={parte}
          x1={margenX}
          x2={ancho - margenX}
          y1={base - parte * (alto - margenSuperior - margenInferior)}
          y2={base - parte * (alto - margenSuperior - margenInferior)}
          stroke="var(--borde)"
          strokeDasharray="3 6"
        />
      ))}
      <line x1={margenX} x2={ancho - margenX} y1={base} y2={base} stroke="var(--borde-fuerte)" />

      <path d={area} fill="url(#panel-control-area)" />
      <path
        d={trazo}
        fill="none"
        stroke="var(--acento)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {puntos.map((punto, indice) => (
        <g key={punto.dia}>
          <circle cx={punto.x} cy={punto.y} r="3" fill="var(--fondo-panel)" stroke="var(--acento)" strokeWidth="2" />
          {indice % 2 === 0 && (
            <text x={punto.x} y={alto - 8} textAnchor="middle" className="panel-control__eje">
              {punto.dia.slice(8, 10)}/{punto.dia.slice(5, 7)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function GraficoDonut({
  segmentos,
  total,
}: {
  segmentos: { etiqueta: string; valor: number; color: string }[];
  total: number;
}) {
  const radio = 54;
  const grosor = 16;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;

  return (
    <svg
      className="panel-control__donut"
      viewBox="0 0 140 140"
      role="img"
      aria-label="Distribución de las copias por estado"
    >
      <circle cx="70" cy="70" r={radio} fill="none" stroke="var(--fondo-panel-suave)" strokeWidth={grosor} />

      {segmentos.map((segmento) => {
        const largo = total > 0 ? (segmento.valor / total) * circunferencia : 0;
        const desplazamiento = -acumulado;
        acumulado += largo;

        if (largo === 0) {
          return null;
        }

        return (
          <circle
            key={segmento.etiqueta}
            cx="70"
            cy="70"
            r={radio}
            fill="none"
            stroke={segmento.color}
            strokeWidth={grosor}
            strokeDasharray={`${largo} ${circunferencia - largo}`}
            strokeDashoffset={desplazamiento}
            transform="rotate(-90 70 70)"
          />
        );
      })}

      <text x="70" y="68" textAnchor="middle" className="panel-control__donut-valor">
        {total}
      </text>
      <text x="70" y="86" textAnchor="middle" className="panel-control__donut-etiqueta">
        tareas
      </text>
    </svg>
  );
}

function BarraCumplimiento({
  etiqueta,
  valor,
  total,
  color,
}: {
  etiqueta: string;
  valor: number;
  total: number;
  color: string;
}) {
  const porcentaje = total > 0 ? Math.round((valor / total) * 100) : 0;

  return (
    <div className="panel-control__barra">
      <div className="panel-control__barra-cabecera">
        <span>{etiqueta}</span>
        <span>
          {valor} · {porcentaje}%
        </span>
      </div>
      <div className="panel-control__barra-pista">
        <span style={{ width: `${porcentaje}%`, background: color }} />
      </div>
    </div>
  );
}

export function PanelControl({ respaldos, alCrearCopia, alVerCopias }: PanelControlProps) {
  const [actividad, setActividad] = useState<Actividad | null>(null);
  const [errorActividad, setErrorActividad] = useState(false);

  const activas = respaldos.filter((respaldo) => respaldo.habilitado);
  const conFallo = respaldos.filter((respaldo) => respaldo.ultimoEstado === 'error');
  const proximas = [...activas].sort(porProximaEjecucion).slice(0, 5);
  const siguiente = proximas[0] ?? null;

  useEffect(() => {
    let activo = true;
    const hoy = new Date();
    const desde = new Date(hoy.getTime() - (DIAS_ACTIVIDAD - 1) * MS_POR_DIA);

    void window.api.respaldos
      .resumenEjecuciones({
        desde: fechaLocal(desde),
        hasta: fechaLocal(hoy),
        baseDatos: null,
        texto: null,
      })
      .then((resultado) => {
        if (!activo) {
          return;
        }

        if (!resultado.ok) {
          setErrorActividad(true);
          return;
        }

        const { porDia, total, correctas, fallidas, advertencias } = resultado.datos;
        const conteo = new Map(porDia.map((fila) => [fila.dia, fila.total]));

        const serie = Array.from({ length: DIAS_ACTIVIDAD }, (_, indice) => {
          const dia = fechaLocal(new Date(desde.getTime() + indice * MS_POR_DIA));
          return { dia, total: conteo.get(dia) ?? 0 };
        });

        setActividad({ serie, total, correctas, fallidas, advertencias });
      })
      .catch(() => {
        if (activo) {
          setErrorActividad(true);
        }
      });

    return () => {
      activo = false;
    };
  }, []);

  const resumen =
    respaldos.length === 0
      ? 'Aún no hay tareas de respaldo.'
      : `${activas.length} de ${respaldos.length} ${respaldos.length === 1 ? 'tarea activa' : 'tareas activas'}.`;

  const segmentos = [
    { clave: 'ok', etiqueta: 'Correctas', valor: 0, color: 'var(--ok)' },
    { clave: 'advertencia', etiqueta: 'Con advertencias', valor: 0, color: 'var(--aviso)' },
    { clave: 'error', etiqueta: 'Con error', valor: 0, color: 'var(--error)' },
    { clave: 'pendiente', etiqueta: 'Sin ejecutar', valor: 0, color: 'var(--borde-fuerte)' },
  ].map((segmento) => ({
    ...segmento,
    valor: respaldos.filter((respaldo) => respaldo.ultimoEstado === segmento.clave).length,
  }));

  const totalActividad = actividad?.total ?? 0;

  const resumenActividad = actividad
    ? [
        `${actividad.total} ${actividad.total === 1 ? 'ejecución' : 'ejecuciones'}`,
        `${actividad.correctas} correctas`,
        actividad.advertencias > 0 ? `${actividad.advertencias} con advertencias` : null,
        `${actividad.fallidas} con error`,
      ]
        .filter((parte) => parte !== null)
        .join(' · ')
    : 'Resumen de las ejecuciones registradas en el rango.';

  return (
    <section className="seccion">
      <div className="seccion__encabezado">
        <div>
          <h2>Panel de control</h2>
          <p>{resumen}</p>
        </div>
      </div>

      <div className="panel-control__metricas">
        <button
          type="button"
          className="tarjeta panel-control__tarjeta-accion"
          onClick={() => alVerCopias('activas')}
          disabled={activas.length === 0}
        >
          <span className="tarjeta__titulo">
            <span
              className={`panel-control__punto panel-control__punto--${
                activas.length > 0 ? 'ok' : 'neutro'
              }`}
              aria-hidden="true"
            />
            Copias activas
          </span>
          <span className="tarjeta__valor">{activas.length}</span>
          <span className="tarjeta__detalle">
            {respaldos.length === 0
              ? 'Sin tareas configuradas'
              : `${respaldos.length} ${respaldos.length === 1 ? 'configurada' : 'configuradas'} en total`}
          </span>
        </button>

        <button
          type="button"
          className="tarjeta panel-control__tarjeta-accion"
          onClick={() => siguiente && alVerCopias('todas', siguiente.id)}
          disabled={!siguiente}
        >
          <span className="tarjeta__titulo">
            <span className="panel-control__punto panel-control__punto--acento" aria-hidden="true" />
            Próxima ejecución
          </span>
          <span className="tarjeta__valor">
            {siguiente ? formatearHora(siguiente.proximaEjecucion) : '—'}
          </span>
          <span className="tarjeta__detalle">
            {siguiente
              ? `${siguiente.nombre} · ${formatearFecha(siguiente.proximaEjecucion)}`
              : 'Sin tareas activas'}
          </span>
        </button>

        <button
          type="button"
          className="tarjeta panel-control__tarjeta-accion"
          onClick={() => alVerCopias('error')}
          disabled={conFallo.length === 0}
        >
          <span className="tarjeta__titulo">
            <span
              className={`panel-control__punto panel-control__punto--${
                conFallo.length > 0 ? 'error' : 'neutro'
              }`}
              aria-hidden="true"
            />
            Con fallos
          </span>
          <span className="tarjeta__valor">{conFallo.length}</span>
          <span className="tarjeta__detalle">
            {conFallo.length === 0
              ? 'Ninguna tarea con error'
              : conFallo.length === 1
                ? conFallo[0].nombre
                : 'Revisa el historial de cada tarea'}
          </span>
        </button>
      </div>

      <div className="panel-control__graficos">
        <article className="tarjeta panel-control__tarjeta">
          <h3 className="tarjeta__titulo">Actividad · últimos {DIAS_ACTIVIDAD} días</h3>

          {actividad ? (
            <GraficoLinea serie={actividad.serie} />
          ) : (
            <p className="panel-control__cargando">
              {errorActividad ? 'No se pudo cargar la actividad.' : 'Cargando actividad…'}
            </p>
          )}

          <p className="tarjeta__detalle">{resumenActividad}</p>
        </article>

        <article className="tarjeta panel-control__tarjeta">
          <h3 className="tarjeta__titulo">Estado de las copias</h3>

          <div className="panel-control__donut-fila">
            <GraficoDonut segmentos={segmentos} total={respaldos.length} />

            <ul className="panel-control__leyenda">
              {segmentos.map((segmento) => (
                <li key={segmento.clave}>
                  <span className="panel-control__leyenda-punto" style={{ background: segmento.color }} />
                  {segmento.etiqueta}
                  <strong>{segmento.valor}</strong>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel-control__barras">
            <BarraCumplimiento
              etiqueta="Ejecuciones correctas"
              valor={actividad?.correctas ?? 0}
              total={totalActividad}
              color="var(--ok)"
            />
            {(actividad?.advertencias ?? 0) > 0 && (
              <BarraCumplimiento
                etiqueta="Ejecuciones con advertencias"
                valor={actividad?.advertencias ?? 0}
                total={totalActividad}
                color="var(--aviso)"
              />
            )}
            <BarraCumplimiento
              etiqueta="Ejecuciones con error"
              valor={actividad?.fallidas ?? 0}
              total={totalActividad}
              color="var(--error)"
            />
          </div>
        </article>
      </div>

      <div className="panel-control__bloque">
        <h3 className="panel-control__subtitulo">Próximas ejecuciones</h3>

        {proximas.length > 0 ? (
          <ul className="panel-control__lista">
            {proximas.map((respaldo) => (
              <li key={respaldo.id} className="panel-control__fila">
                <span className="panel-control__nombre">{respaldo.nombre}</span>
                <span className="panel-control__detalle">
                  {formatearFrecuencia(respaldo.frecuenciaMinutos)}
                </span>
                <span className="panel-control__cuando">
                  {formatearFechaHora(respaldo.proximaEjecucion)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="panel-control__vacio">
            <p>
              {respaldos.length === 0
                ? 'Crea una tarea para empezar a programar respaldos.'
                : 'Todas las tareas están deshabilitadas.'}
            </p>
            {respaldos.length === 0 && (
              <button type="button" className="boton" onClick={alCrearCopia}>
                Crear backup
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
