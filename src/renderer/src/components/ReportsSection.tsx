import { useState } from 'react';
import type {
  ArchivoBakInformeGlobal,
  EjecucionArchivoInforme,
  InformeGlobalBak,
  RespaldoConfigurado,
} from '../../../shared/types/respaldo.types';
import { parsearBasesDatos } from '../../../shared/utils/bases-datos';
import { formatearHora, ETIQUETAS_ESTADO } from '../utils/formato';
import { agruparPorDia, fechaLocal, formatearDia, formatearTamano } from '../utils/informe';
import { Modal } from './Modal';
import './BackupModals.css';
import './Reports.css';

interface ReportsSectionProps {
  respaldos: RespaldoConfigurado[];
}

const MESES_CORTOS = [
  'ENE',
  'FEB',
  'MAR',
  'ABR',
  'MAY',
  'JUN',
  'JUL',
  'AGO',
  'SEP',
  'OCT',
  'NOV',
  'DIC',
];

// Rango legible del calendario: "23 OCT - 30 OCT".
function rangoDeDias(dias: string[]): string {
  const corto = (dia: string) => {
    const [, mes, numero] = dia.split('-');
    return `${numero} ${MESES_CORTOS[Number(mes) - 1] ?? mes}`;
  };

  const primero = corto(dias[0]);
  const ultimo = corto(dias[dias.length - 1]);

  return primero === ultimo ? primero : `${primero} - ${ultimo}`;
}

interface GrupoBak {
  clave: string;
  tipo: ArchivoBakInformeGlobal['tipo'];
  baseDatos: string;
  tarea: string;
  servidor: string;
  esCopyOnly: boolean;
  archivos: ArchivoBakInformeGlobal[];
  tamanoBytes: number;
}

// Une los respaldos equivalentes del día (misma tarea, base y tipo) en un grupo.
function agruparBak(archivos: ArchivoBakInformeGlobal[]): GrupoBak[] {
  const grupos = new Map<string, GrupoBak>();

  for (const archivo of archivos) {
    const clave = [archivo.tareaId, archivo.baseDatos, archivo.tipo, archivo.esCopyOnly].join('|');
    const grupo = grupos.get(clave);

    if (grupo) {
      grupo.archivos.push(archivo);
      grupo.tamanoBytes += archivo.tamanoBytes ?? 0;
      continue;
    }

    grupos.set(clave, {
      clave,
      tipo: archivo.tipo,
      baseDatos: archivo.baseDatos,
      tarea: archivo.tarea,
      servidor: archivo.servidor,
      esCopyOnly: archivo.esCopyOnly,
      archivos: [archivo],
      tamanoBytes: archivo.tamanoBytes ?? 0,
    });
  }

  return [...grupos.values()];
}

interface GrupoArchivos {
  clave: string;
  tarea: string;
  estado: EjecucionArchivoInforme['estado'];
  ejecuciones: EjecucionArchivoInforme[];
}

// Mismo criterio para las copias de archivos: tarea y resultado.
function agruparEjecucionesArchivos(ejecuciones: EjecucionArchivoInforme[]): GrupoArchivos[] {
  const grupos = new Map<string, GrupoArchivos>();

  for (const ejecucion of ejecuciones) {
    const clave = [ejecucion.respaldoId, ejecucion.estado].join('|');
    const grupo = grupos.get(clave);

    if (grupo) {
      grupo.ejecuciones.push(ejecucion);
      continue;
    }

    grupos.set(clave, {
      clave,
      tarea: ejecucion.tarea,
      estado: ejecucion.estado,
      ejecuciones: [ejecucion],
    });
  }

  return [...grupos.values()];
}

// "12:15 p. m. – 12:30 p. m." a partir de las marcas del grupo.
function rangoHorario(fechas: string[]): string {
  if (fechas.length === 0) {
    return '';
  }

  const primera = formatearHora(fechas[fechas.length - 1]);
  const ultima = formatearHora(fechas[0]);

  return primera === ultima ? primera : `${primera} – ${ultima}`;
}

function IconoDesplegable({ abierto }: { abierto: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`informe__chevron${abierto ? ' informe__chevron--abierto' : ''}`}
    >
      <path
        d="M4 6.5 8 10.5l4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ReportsSection({ respaldos }: ReportsSectionProps) {
  const [desde, setDesde] = useState(() =>
    fechaLocal(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [hasta, setHasta] = useState(() => fechaLocal(new Date()));
  const [base, setBase] = useState('');
  const [texto, setTexto] = useState('');
  const [informe, setInforme] = useState<InformeGlobalBak | null>(null);
  const [textoAplicado, setTextoAplicado] = useState<string | null>(null);
  const [baseAplicada, setBaseAplicada] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [gruposAbiertos, setGruposAbiertos] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // Bases de todas las tareas MSSQL, sin repetir. En modo dinámico la lista
  // guardada en la tarea es la foto del momento de crearla, por eso se suman
  // las bases que aparecen en el informe ya consultado.
  const basesDisponibles = [
    ...new Set([
      ...respaldos
        .filter((respaldo) => respaldo.tipo === 'mssql')
        .flatMap((respaldo) => parsearBasesDatos(respaldo.origen)),
      ...(informe?.archivos.map((archivo) => archivo.baseDatos) ?? []),
    ]),
  ].sort();

  const tareasMssql = respaldos.filter((respaldo) => respaldo.tipo === 'mssql');
  const tareasArchivos = respaldos.filter((respaldo) => respaldo.tipo === 'archivos');

  const consultar = async () => {
    setCargando(true);
    setError(null);

    try {
      const resultado = await window.api.respaldos.informeGlobal({
        desde,
        hasta,
        baseDatos: base || null,
        texto: texto.trim() || null,
      });

      if (resultado.ok) {
        setInforme(resultado.datos);
        setTextoAplicado(texto.trim() || null);
        setBaseAplicada(base || null);
        // Una consulta nueva invalida los grupos expandidos de la anterior.
        setGruposAbiertos(new Set());
      } else {
        setInforme(null);
        setError(resultado.error);
      }
    } catch {
      setInforme(null);
      setError('No se pudo generar el informe.');
    } finally {
      setCargando(false);
    }
  };

  const grupos = informe ? agruparPorDia(informe.archivos) : [];
  const gruposArchivos = informe ? agruparPorDia(informe.ejecucionesArchivos) : [];
  const resumenArchivos = informe?.resumenArchivos ?? null;
  const totalMssql = informe?.resumen.total ?? 0;
  const totalArchivos = resumenArchivos?.total ?? 0;
  const hayTareasMssql = (informe?.tareas.length ?? 0) > 0;
  const diasDelRango = informe
    ? informe.resumen.diasConRespaldo.length + informe.resumen.diasSinRespaldo.length
    : 0;
  // Cobertura día a día: se ordenan los dos conjuntos para pintar el calendario.
  const diasCobertura = informe
    ? [...informe.resumen.diasConRespaldo, ...informe.resumen.diasSinRespaldo].sort()
    : [];
  const diasConRespaldo = new Set(informe?.resumen.diasConRespaldo ?? []);

  const alternarGrupo = (clave: string) => {
    setGruposAbiertos((actuales) => {
      const siguientes = new Set(actuales);

      if (siguientes.has(clave)) {
        siguientes.delete(clave);
      } else {
        siguientes.add(clave);
      }

      return siguientes;
    });
  };

  return (
    <section className="seccion">
      <div className="seccion__encabezado">
        <div>
          <h2>Informes de respaldo</h2>
          <p>
            Consulta en un rango de fechas los .bak de MSSQL y las copias de archivos y carpetas.
          </p>
        </div>
      </div>

      <div className="informe">
        <div className="informe__filtros">
          <div className="campo">
            <label htmlFor="informes-desde">Desde</label>
            <input
              id="informes-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(evento) => setDesde(evento.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="informes-hasta">Hasta</label>
            <input
              id="informes-hasta"
              type="date"
              value={hasta}
              min={desde}
              onChange={(evento) => setHasta(evento.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="informes-base">Base de datos</label>
            <select
              id="informes-base"
              value={base}
              onChange={(evento) => setBase(evento.target.value)}
            >
              <option value="">Todas</option>
              {basesDisponibles.map((nombre) => (
                <option key={nombre} value={nombre}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="informes-texto">Archivo o carpeta</label>
            <input
              id="informes-texto"
              type="search"
              placeholder="Parte del nombre o de la carpeta, ej. ANTILLAS3 u orquideorama"
              maxLength={200}
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
            />
          </div>
        </div>

        <div className="informe__acciones">
          <button
            type="button"
            className="boton boton--secundario"
            disabled={cargando}
            onClick={() => void consultar()}
          >
            {cargando ? 'Consultando…' : 'Consultar'}
          </button>
          {(tareasMssql.length > 0 || tareasArchivos.length > 0) && (
            <p className="campo__ayuda">
              {[
                tareasMssql.length > 0 ? `${tareasMssql.length} de MSSQL` : null,
                tareasArchivos.length > 0 ? `${tareasArchivos.length} de archivos` : null,
              ]
                .filter(Boolean)
                .join(' y ')}{' '}
              · msdb e historial local
            </p>
          )}
        </div>

        {error && (
          <p className="formulario__error" role="alert">
            {error}
          </p>
        )}

        {!informe && !error && (
          <p className="campo__ayuda">
            {tareasMssql.length === 0 && tareasArchivos.length === 0
              ? 'No hay tareas de respaldo configuradas todavía.'
              : tareasMssql.length === 0
                ? 'No hay tareas MSSQL: el informe cubrirá solo las copias de archivos y carpetas.'
                : tareasArchivos.length === 0
                  ? 'No hay tareas de archivos: el informe cubrirá solo los .bak de MSSQL.'
                  : 'Elige un rango de fechas y pulsa Consultar.'}
          </p>
        )}

        {informe && (
          <div className="informe__resultado">
            <div className="informe__veredicto-fila">
              <p
                className={`informe__veredicto informe__veredicto--${
                  totalMssql + totalArchivos > 0 ? 'si' : 'no'
                }`}
              >
                {totalMssql + totalArchivos > 0
                  ? `Sí hay respaldos entre ${formatearDia(informe.desde)} y ${formatearDia(informe.hasta)}.`
                  : `No hay respaldo registrado entre ${formatearDia(informe.desde)} y ${formatearDia(informe.hasta)}.`}
              </p>

              <button
                type="button"
                className="boton boton--secundario"
                onClick={() => setDetalleAbierto(true)}
              >
                Ver detalle de respaldos
              </button>
            </div>

            {/* Resumen general: una cifra por sistema, sin mezclar métricas. */}
            <div className="informe__general">
              <article className="informe__general-fuente">
                <span className="informe__general-etiqueta">Bases de datos MSSQL</span>
                <strong className="informe__general-valor">{informe.resumen.total}</strong>
                <span className="informe__general-detalle">
                  {informe.resumen.total === 0
                    ? 'Sin archivos .bak en el rango'
                    : `${informe.resumen.total === 1 ? 'archivo .bak' : 'archivos .bak'} · ${
                        informe.resumen.completos
                      } full · ${informe.resumen.diferenciales} diff`}
                </span>
              </article>

              <article
                className={`informe__general-fuente${
                  resumenArchivos ? '' : ' informe__general-fuente--vacia'
                }`}
              >
                <span className="informe__general-etiqueta">Archivos y carpetas</span>
                <strong className="informe__general-valor">
                  {resumenArchivos ? resumenArchivos.total : '—'}
                </strong>
                <span className="informe__general-detalle">
                  {resumenArchivos
                    ? resumenArchivos.total === 0
                      ? 'Sin copias en el rango'
                      : `${resumenArchivos.total === 1 ? 'copia' : 'copias'} · ${
                          resumenArchivos.correctas
                        } correctas · ${resumenArchivos.fallidas} fallidas`
                    : 'Fuera del filtro por base de datos'}
                </span>
              </article>
            </div>

            {baseAplicada && (
              <p className="campo__ayuda">
                Filtrando por la base «{baseAplicada}»: solo se consultan .bak. Las copias de
                archivos y carpetas no dependen de una base y quedan fuera de esta consulta.
              </p>
            )}

            {textoAplicado && (
              <p className="campo__ayuda">
                Filtrado por «{textoAplicado}» en nombres de .bak, carpetas de origen y rutas de
                copia.
              </p>
            )}

            {hayTareasMssql && (
              <>
                <dl className="informe__resumen">
                  <div>
                    <dt>Total</dt>
                    <dd>{informe.resumen.total}</dd>
                  </div>
                  <div>
                    <dt>Full</dt>
                    <dd>{informe.resumen.completos}</dd>
                  </div>
                  <div>
                    <dt>Diff</dt>
                    <dd>{informe.resumen.diferenciales}</dd>
                  </div>
                  <div>
                    <dt>Tamaño</dt>
                    <dd>{formatearTamano(informe.resumen.tamanoTotalBytes)}</dd>
                  </div>
                  {informe.resumenZip.archivos > 0 && (
                    <div>
                      <dt>Tamaño .zip</dt>
                      <dd
                        title={`${informe.resumenZip.archivos} .zip vigente${
                          informe.resumenZip.archivos === 1 ? '' : 's'
                        } (el más reciente de cada base)`}
                      >
                        {formatearTamano(informe.resumenZip.tamanoTotalBytes)}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Días con respaldo</dt>
                    <dd>
                      {informe.resumen.diasConRespaldo.length} de {diasDelRango}
                    </dd>
                  </div>
                  <div>
                    <dt>Bases</dt>
                    <dd title={informe.resumen.bases.join(', ')}>
                      {informe.resumen.bases.join(', ') || '—'}
                    </dd>
                  </div>
                </dl>

                <div className="informes__tareas">
                  {informe.tareas.map((tarea) => (
                    <div key={tarea.id} className="informes__tarea">
                      <div className="informes__tarea-cabecera">
                        <span className="informes__tarea-nombre">{tarea.nombre}</span>
                        <span className="informes__tarea-total">
                          {tarea.error
                            ? 'Sin consultar'
                            : `${tarea.total} respaldo${tarea.total === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <p className="informes__tarea-servidor">{tarea.servidor}</p>
                      {tarea.error && <p className="informes__tarea-error">{tarea.error}</p>}
                    </div>
                  ))}
                </div>

                {diasCobertura.length > 0 && (
                  <section className="cobertura" aria-label="Cobertura de respaldos">
                    <div className="cobertura__cabecera">
                      <h3 className="cobertura__titulo">Cobertura de respaldos</h3>
                      <span className="cobertura__rango">{rangoDeDias(diasCobertura)}</span>
                      <span
                        className={`cobertura__badge${
                          diasConRespaldo.size < diasCobertura.length
                            ? ' cobertura__badge--aviso'
                            : ''
                        }`}
                      >
                        {diasConRespaldo.size} de {diasCobertura.length} días
                      </span>
                    </div>

                    <ol className="cobertura__dias">
                      {diasCobertura.map((dia) => {
                        const conRespaldo = diasConRespaldo.has(dia);

                        return (
                          <li key={dia} className="cobertura__dia">
                            <span
                              className={`cobertura__barra cobertura__barra--${
                                conRespaldo ? 'ok' : 'falta'
                              }`}
                              title={`${formatearDia(dia)} · ${
                                conRespaldo ? 'Con respaldo' : 'Sin respaldo'
                              }`}
                            />
                            <span className="cobertura__etiqueta">{dia.slice(8, 10)}</span>
                          </li>
                        );
                      })}
                    </ol>

                    <div className="cobertura__leyenda">
                      <span>
                        <i className="cobertura__punto cobertura__punto--ok" aria-hidden="true" />
                        Con respaldo
                      </span>
                      <span>
                        <i
                          className="cobertura__punto cobertura__punto--falta"
                          aria-hidden="true"
                        />
                        Sin respaldo
                      </span>
                    </div>
                  </section>
                )}

                {informe.truncado && (
                  <p className="campo__aviso">
                    Alguna tarea superó el límite de resultados. Reduce el rango o filtra por base.
                  </p>
                )}
              </>
            )}

            {resumenArchivos && resumenArchivos.total > 0 && (
              <div className="informes__bloque">
                <h3 className="informes__subtitulo">Copias de archivos y carpetas</h3>

                <dl className="informe__resumen">
                  <div>
                    <dt>Ejecuciones</dt>
                    <dd>{resumenArchivos.total}</dd>
                  </div>
                  <div>
                    <dt>Correctas</dt>
                    <dd>{resumenArchivos.correctas}</dd>
                  </div>
                  <div>
                    <dt>Fallidas</dt>
                    <dd>{resumenArchivos.fallidas}</dd>
                  </div>
                  <div>
                    <dt>Tareas</dt>
                    <dd>{resumenArchivos.tareas}</dd>
                  </div>
                  <div>
                    <dt>Días con copia</dt>
                    <dd>
                      {resumenArchivos.diasConEjecucion.length} de {diasDelRango}
                    </dd>
                  </div>
                </dl>

                {resumenArchivos.diasSinEjecucion.length > 0 && (
                  <p className="informe__huecos">
                    Días sin ninguna copia de archivos:{' '}
                    {resumenArchivos.diasSinEjecucion.map(formatearDia).join(', ')}.
                  </p>
                )}

                {resumenArchivos.truncado && (
                  <p className="campo__aviso">
                    El detalle muestra las últimas {informe.ejecucionesArchivos.length} ejecuciones
                    de archivos. Reduce el rango para verlas todas.
                  </p>
                )}
              </div>
            )}

            <p className="campo__ayuda">
              Los .bak se leen de msdb; las copias de archivos, del historial local de la app. No se
              detalla qué archivos individuales contiene cada copia.
            </p>
          </div>
        )}
      </div>

      {detalleAbierto && informe && (
        <Modal
          titulo="Detalle de respaldos"
          alCerrar={() => {
            setDetalleAbierto(false);
            setGruposAbiertos(new Set());
          }}
          clase="modal--detalle"
        >
          <p className="campo__ayuda">
            {formatearDia(informe.desde)} — {formatearDia(informe.hasta)}
            {baseAplicada ? ` · base ${baseAplicada}` : ''}
            {textoAplicado ? ` · filtro «${textoAplicado}»` : ''}
          </p>

          {grupos.length > 0 && (
            <section className="info-detalle__bloque">
              <h3 className="informes__subtitulo">Archivos .bak de MSSQL</h3>

              <ul className="informe__dias">
                {grupos.map(([dia, archivos]) => (
                  <li key={dia} className="informe__dia">
                    <div className="informe__dia-cabecera">
                      <span className="informe__dia-fecha">{formatearDia(dia)}</span>
                      <span className="informe__dia-cuenta">
                        {archivos.length} respaldo{archivos.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    <ul className="informe__grupos">
                      {agruparBak(archivos).map((grupo) => {
                        const clave = `bak:${dia}:${grupo.clave}`;
                        const expandido = gruposAbiertos.has(clave);

                        return (
                          <li key={clave} className="informe__grupo">
                            <button
                              type="button"
                              className="informe__grupo-cabecera"
                              aria-expanded={expandido}
                              onClick={() => alternarGrupo(clave)}
                            >
                              <span
                                className={`inventario__tipo inventario__tipo--${grupo.tipo}`}
                              >
                                {grupo.tipo === 'diferencial' ? 'Diff' : 'Full'}
                              </span>
                              <span className="informe__archivo-base">{grupo.baseDatos}</span>
                              <span className="informe__grupo-rango">
                                {rangoHorario(grupo.archivos.map((archivo) => archivo.fecha))}
                              </span>
                              <span className="informe__grupo-cuenta">
                                {grupo.archivos.length} respaldo
                                {grupo.archivos.length === 1 ? '' : 's'}
                                {grupo.esCopyOnly && ' · COPY_ONLY'}
                              </span>
                              <span className="informe__archivo-meta">
                                {formatearTamano(grupo.tamanoBytes)}
                              </span>
                              <IconoDesplegable abierto={expandido} />
                            </button>
                            <p className="informes__archivo-tarea">
                              {grupo.tarea} · {grupo.servidor}
                            </p>

                            {expandido && (
                              <ul className="informe__archivos">
                                {grupo.archivos.map((archivo) => (
                                  <li
                                    key={`${archivo.archivo}-${archivo.fecha}`}
                                    className="informe__archivo"
                                  >
                                    <div className="informe__archivo-fila">
                                      <span className="informe__archivo-meta">
                                        {formatearHora(archivo.fecha)} ·{' '}
                                        {formatearTamano(archivo.tamanoBytes)}
                                        {archivo.familias > 1 &&
                                          ` · ${archivo.familias} archivos`}
                                      </span>
                                    </div>
                                    <p
                                      className="informe__archivo-nombre"
                                      title={archivo.archivo}
                                    >
                                      {archivo.nombre}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {resumenArchivos && (
            <section className="info-detalle__bloque">
              <h3 className="informes__subtitulo">Copias de archivos y carpetas</h3>

              {gruposArchivos.length > 0 ? (
                <ul className="informe__dias">
                  {gruposArchivos.map(([dia, ejecuciones]) => (
                    <li key={dia} className="informe__dia">
                      <div className="informe__dia-cabecera">
                        <span className="informe__dia-fecha">{formatearDia(dia)}</span>
                        <span className="informe__dia-cuenta">
                          {ejecuciones.length} ejecución
                          {ejecuciones.length === 1 ? '' : 'es'}
                        </span>
                      </div>

                      <ul className="informe__grupos">
                        {agruparEjecucionesArchivos(ejecuciones).map((grupo) => {
                          const clave = `arc:${dia}:${grupo.clave}`;
                          const expandido = gruposAbiertos.has(clave);

                          return (
                            <li key={clave} className="informe__grupo">
                              <button
                                type="button"
                                className="informe__grupo-cabecera"
                                aria-expanded={expandido}
                                onClick={() => alternarGrupo(clave)}
                              >
                                <span className={`etiqueta etiqueta--${grupo.estado}`}>
                                  {ETIQUETAS_ESTADO[grupo.estado]}
                                </span>
                                <span className="informe__archivo-base">{grupo.tarea}</span>
                                <span className="informe__grupo-rango">
                                  {rangoHorario(
                                    grupo.ejecuciones.map((ejecucion) => ejecucion.fecha),
                                  )}
                                </span>
                                <span className="informe__grupo-cuenta">
                                  {grupo.ejecuciones.length} ejecución
                                  {grupo.ejecuciones.length === 1 ? '' : 'es'}
                                </span>
                                <IconoDesplegable abierto={expandido} />
                              </button>

                              {expandido && (
                                <ul className="informe__archivos">
                                  {grupo.ejecuciones.map((ejecucion) => (
                                    <li key={ejecucion.id} className="informe__archivo">
                                      <div className="informe__archivo-fila">
                                        <span className="informe__archivo-meta">
                                          {formatearHora(ejecucion.fecha)}
                                        </span>
                                      </div>
                                      <p
                                        className="informe__archivo-nombre"
                                        title={ejecucion.origen}
                                      >
                                        {ejecucion.origen}
                                      </p>
                                      {ejecucion.detalle && (
                                        <p className="informes__archivo-tarea">
                                          {ejecucion.detalle}
                                        </p>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="historial__vacio">
                  Sin ejecuciones de archivos en el rango consultado.
                </p>
              )}
            </section>
          )}

          {grupos.length === 0 && gruposArchivos.length === 0 && (
            <p className="historial__vacio">Sin respaldos registrados en el rango consultado.</p>
          )}
        </Modal>
      )}
    </section>
  );
}
