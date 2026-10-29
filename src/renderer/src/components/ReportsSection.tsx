import { useState } from 'react';
import type {
  InformeGlobalBak,
  RespaldoConfigurado,
} from '../../../shared/types/respaldo.types';
import { parsearBasesDatos } from '../../../shared/utils/bases-datos';
import { formatearHora, ETIQUETAS_ESTADO } from '../utils/formato';
import { agruparPorDia, fechaLocal, formatearDia, formatearTamano } from '../utils/informe';
import './BackupModals.css';
import './Reports.css';

interface ReportsSectionProps {
  respaldos: RespaldoConfigurado[];
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
  const [cargando, setCargando] = useState(false);
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
  const descripcion = [
    totalMssql > 0 ? `${totalMssql} .bak MSSQL` : null,
    totalArchivos > 0
      ? `${totalArchivos} copia${totalArchivos === 1 ? '' : 's'} de archivos`
      : null,
  ]
    .filter(Boolean)
    .join(' y ');

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
            <label htmlFor="informes-texto">Archivo</label>
            <input
              id="informes-texto"
              type="search"
              placeholder="Parte del nombre, ej. ANTILLAS3_full"
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
          {tareasMssql.length > 0 && (
            <p className="campo__ayuda">
              {tareasMssql.length} {tareasMssql.length === 1 ? 'tarea MSSQL' : 'tareas MSSQL'} · solo
              lectura sobre msdb
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
            {tareasMssql.length === 0
              ? 'No hay tareas MSSQL: el informe cubrirá solo las copias de archivos y carpetas.'
              : 'Elige un rango de fechas y pulsa Consultar.'}
          </p>
        )}

        {informe && (
          <div className="informe__resultado">
            <p
              className={`informe__veredicto informe__veredicto--${
                totalMssql + totalArchivos > 0 ? 'si' : 'no'
              }`}
            >
              {totalMssql + totalArchivos > 0
                ? `Sí hay respaldo: ${descripcion} entre ${formatearDia(informe.desde)} y ${formatearDia(informe.hasta)}.`
                : `No hay respaldo registrado entre ${formatearDia(informe.desde)} y ${formatearDia(informe.hasta)}.`}
            </p>

            {textoAplicado && (
              <p className="campo__ayuda">
                Filtrado por archivos que contienen «{textoAplicado}».
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

                {informe.resumen.diasSinRespaldo.length > 0 && (
                  <p className="informe__huecos">
                    Días sin ningún respaldo:{' '}
                    {informe.resumen.diasSinRespaldo.map(formatearDia).join(', ')}.
                  </p>
                )}

                {informe.truncado && (
                  <p className="campo__aviso">
                    Alguna tarea superó el límite de resultados. Reduce el rango o filtra por base.
                  </p>
                )}
              </>
            )}

            {totalMssql > 0 && (
              <ul className="informe__dias">
                {grupos.map(([dia, archivos]) => (
                  <li key={dia} className="informe__dia">
                    <div className="informe__dia-cabecera">
                      <span className="informe__dia-fecha">{formatearDia(dia)}</span>
                      <span className="informe__dia-cuenta">
                        {archivos.length} respaldo{archivos.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    <ul className="informe__archivos">
                      {archivos.map((archivo) => (
                        <li
                          key={`${archivo.tareaId}-${archivo.archivo}-${archivo.fecha}`}
                          className="informe__archivo"
                        >
                          <div className="informe__archivo-fila">
                            <span
                              className={`inventario__tipo inventario__tipo--${archivo.tipo}`}
                            >
                              {archivo.tipo === 'diferencial' ? 'Diff' : 'Full'}
                            </span>
                            <span className="informe__archivo-base">{archivo.baseDatos}</span>
                            <span className="informe__archivo-meta">
                              {formatearHora(archivo.fecha)} ·{' '}
                              {formatearTamano(archivo.tamanoBytes)}
                              {archivo.esCopyOnly && ' · COPY_ONLY'}
                              {archivo.familias > 1 && ` · ${archivo.familias} archivos`}
                            </span>
                          </div>
                          <p className="informe__archivo-nombre" title={archivo.archivo}>
                            {archivo.nombre}
                          </p>
                          <p className="informes__archivo-tarea">
                            {archivo.tarea} · {archivo.servidor}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            {resumenArchivos && (
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
                    Se muestran las últimas {informe.ejecucionesArchivos.length} ejecuciones de
                    archivos. Reduce el rango para verlas todas.
                  </p>
                )}

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

                        <ul className="informe__archivos">
                          {ejecuciones.map((ejecucion) => (
                            <li key={ejecucion.id} className="informe__archivo">
                              <div className="informe__archivo-fila">
                                <span className={`etiqueta etiqueta--${ejecucion.estado}`}>
                                  {ETIQUETAS_ESTADO[ejecucion.estado]}
                                </span>
                                <span className="informe__archivo-base">{ejecucion.tarea}</span>
                                <span className="informe__archivo-meta">
                                  {formatearHora(ejecucion.fecha)}
                                </span>
                              </div>
                              <p className="informe__archivo-nombre" title={ejecucion.origen}>
                                {ejecucion.origen}
                              </p>
                              {ejecucion.detalle && (
                                <p className="informes__archivo-tarea">{ejecucion.detalle}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="historial__vacio">
                    Sin ejecuciones de archivos en el rango consultado.
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
    </section>
  );
}
