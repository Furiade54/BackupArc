import { useEffect, useState } from 'react';
import type {
  ArchivoBakInventario,
  EjecucionRespaldo,
  InformeBak,
  InventarioBak,
  RespaldoConfigurado,
} from '../../../shared/types/respaldo.types';
import { formatearBasesDatos, parsearBasesDatos } from '../../../shared/utils/bases-datos';
import {
  ETIQUETAS_ESTADO,
  formatearFecha,
  formatearFechaHora,
  formatearFrecuencia,
  formatearHora,
} from '../utils/formato';
import { agruparPorDia, fechaLocal, formatearDia, formatearTamano } from '../utils/informe';
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

function nombreDeRuta(ruta: string): string {
  const partes = ruta.split(/[\\/]/);
  return partes[partes.length - 1] || ruta;
}

const ETIQUETAS_COMPRESION = {
  aplicada: 'comprimido',
  'no aplicada': 'sin comprimir',
  desconocido: 'compresión sin confirmar',
} as const;

const ETIQUETAS_CATEGORIA: Record<ArchivoBakInventario['categoria'], string> = {
  confirmado: 'Confirmado',
  base_protegida: 'Base protegida',
  no_verificable: 'No verificable',
  posible_huerfano: 'Posible huérfano',
};

export function HistoryModal({ respaldo, alCerrar }: HistoryModalProps) {
  const [ejecuciones, setEjecuciones] = useState<EjecucionRespaldo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisoApertura, setAvisoApertura] = useState<string | null>(null);
  const [inventario, setInventario] = useState<InventarioBak | null>(null);
  const [cargandoInventario, setCargandoInventario] = useState(false);
  const [errorInventario, setErrorInventario] = useState<string | null>(null);
  const basesTarea = parsearBasesDatos(respaldo.origen);
  const [informeDesde, setInformeDesde] = useState(() =>
    fechaLocal(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [informeHasta, setInformeHasta] = useState(() => fechaLocal(new Date()));
  const [informeBase, setInformeBase] = useState('');
  const [informeTexto, setInformeTexto] = useState('');
  const [informe, setInforme] = useState<InformeBak | null>(null);
  const [informeTextoAplicado, setInformeTextoAplicado] = useState<string | null>(null);
  const [cargandoInforme, setCargandoInforme] = useState(false);
  const [errorInforme, setErrorInforme] = useState<string | null>(null);
  // La carpeta de un servidor remoto no existe en este equipo.
  const esRemoto = respaldo.tipo === 'mssql' && respaldo.conexionMssql?.esRemoto === true;
  const puedeAbrirDestino = !esRemoto;

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
    if (!puedeAbrirDestino) {
      return;
    }

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

  const analizarInventario = async () => {
    setCargandoInventario(true);
    setErrorInventario(null);

    try {
      const resultado = await window.api.respaldos.inventarioBak(respaldo.id);

      if (resultado.ok) {
        setInventario(resultado.datos);
      } else {
        setErrorInventario(resultado.error);
      }
    } catch {
      setErrorInventario('No se pudo analizar la carpeta del servidor.');
    } finally {
      setCargandoInventario(false);
    }
  };

  const consultarInforme = async () => {
    setCargandoInforme(true);
    setErrorInforme(null);

    try {
      const resultado = await window.api.respaldos.informeBak(respaldo.id, {
        desde: informeDesde,
        hasta: informeHasta,
        baseDatos: informeBase || null,
        texto: informeTexto.trim() || null,
      });

      if (resultado.ok) {
        setInforme(resultado.datos);
        setInformeTextoAplicado(informeTexto.trim() || null);
      } else {
        setInforme(null);
        setErrorInforme(resultado.error);
      }
    } catch {
      setInforme(null);
      setErrorInforme('No se pudo generar el informe.');
    } finally {
      setCargandoInforme(false);
    }
  };

  const gruposInforme = informe ? agruparPorDia(informe.archivos) : [];
  const diasDelInforme = informe
    ? informe.resumen.diasConRespaldo.length + informe.resumen.diasSinRespaldo.length
    : 0;

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
              disabled={!puedeAbrirDestino}
              onClick={() => void abrirDestino()}
              title={
                puedeAbrirDestino
                  ? 'Abrir la carpeta de destino'
                  : 'La carpeta está en el servidor SQL remoto y no existe en este equipo'
              }
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
        {respaldo.tipo === 'mssql' && (
          <>
            <div>
              <dt>Modo</dt>
              <dd>
                {respaldo.modoMssql === 'diferencial'
                  ? `Diferencial · full máximo de ${respaldo.fullCadaDias} días`
                  : 'Completo'}
              </dd>
            </div>
            <div>
              <dt>Opciones del .bak</dt>
              <dd>
                {[
                  respaldo.comprimirBak ? 'Comprimido' : null,
                  respaldo.verificarBak ? 'Verificado al terminar' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Ninguna'}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Retención</dt>
          <dd>
            {respaldo.tipo === 'mssql'
              ? 'No se borra automáticamente'
              : `${respaldo.retencionDias} días`}
          </dd>
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
              className={`historial__item${puedeAbrirDestino ? ' historial__item--abrible' : ''}`}
              role={puedeAbrirDestino ? 'button' : undefined}
              tabIndex={puedeAbrirDestino ? 0 : undefined}
              title={puedeAbrirDestino ? 'Abrir la carpeta de destino' : undefined}
              onClick={puedeAbrirDestino ? () => void abrirDestino() : undefined}
              onKeyDown={
                puedeAbrirDestino
                  ? (evento) => {
                      if (evento.key === 'Enter' || evento.key === ' ') {
                        evento.preventDefault();
                        void abrirDestino();
                      }
                    }
                  : undefined
              }
            >
              <span
                className={`historial__punto historial__punto--${ejecucion.estado}`}
                aria-hidden="true"
              />
              <div className="historial__detalle-contenedor">
                <p className="historial__fecha">
                  {formatearFechaHora(ejecucion.fecha)}
                  {ejecucion.tipo && (
                    <span className="historial__tipo">
                      {ejecucion.tipo === 'mixto'
                        ? 'Mixto'
                        : ejecucion.tipo === 'diferencial'
                          ? 'Diferencial'
                          : 'Completo'}
                    </span>
                  )}
                </p>
                {ejecucion.detalle && <p className="historial__detalle">{ejecucion.detalle}</p>}

                {ejecucion.resultados.length > 0 && (
                  <ul className="resultados-base">
                    {ejecucion.resultados.map((resultado) => (
                      <li key={resultado.id} className="resultados-base__item">
                        <div className="resultados-base__cabecera">
                          <span
                            className={`resultados-base__tipo resultados-base__tipo--${resultado.tipoEjecutado}`}
                          >
                            {resultado.tipoEjecutado === 'diferencial' ? 'Diff' : 'Full'}
                          </span>
                          <span className="resultados-base__base">{resultado.baseDatos}</span>
                          <span className="resultados-base__meta">
                            {formatearTamano(resultado.tamanoBytes)} ·{' '}
                            {ETIQUETAS_COMPRESION[resultado.compresion]}
                          </span>
                        </div>

                        {resultado.archivo && (
                          <p className="resultados-base__archivo" title={resultado.archivo}>
                            {nombreDeRuta(resultado.archivo)}
                          </p>
                        )}

                        {resultado.tipoEjecutado === 'diferencial' && resultado.baseArchivo && (
                          <p className="resultados-base__base-full" title={resultado.baseArchivo}>
                            Base: {nombreDeRuta(resultado.baseArchivo)}
                          </p>
                        )}

                        {resultado.detalle && (
                          <p className="resultados-base__detalle">{resultado.detalle}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="historial__acciones">
                <span className={`etiqueta etiqueta--${ejecucion.estado}`}>
                  {ETIQUETAS_ESTADO[ejecucion.estado]}
                </span>
                {puedeAbrirDestino && (
                  <span className="historial__abrir" aria-hidden="true">
                    <IconoCarpeta />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {respaldo.tipo === 'mssql' && (
        <section className="informe">
          <h3 className="historial__titulo">Consultar respaldos por fecha</h3>
          <p className="campo__ayuda">
            Responde si hay respaldo de un día o de un archivo concreto. Consulta msdb en modo
            lectura: no borra ni modifica nada.
          </p>

          <div className="informe__filtros">
            <div className="campo">
              <label htmlFor="informe-desde">Desde</label>
              <input
                id="informe-desde"
                type="date"
                value={informeDesde}
                max={informeHasta}
                onChange={(evento) => setInformeDesde(evento.target.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor="informe-hasta">Hasta</label>
              <input
                id="informe-hasta"
                type="date"
                value={informeHasta}
                min={informeDesde}
                onChange={(evento) => setInformeHasta(evento.target.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor="informe-base">Base de datos</label>
              <select
                id="informe-base"
                value={informeBase}
                onChange={(evento) => setInformeBase(evento.target.value)}
              >
                <option value="">Todas</option>
                {basesTarea.map((base) => (
                  <option key={base} value={base}>
                    {base}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="informe-texto">Archivo</label>
              <input
                id="informe-texto"
                type="search"
                placeholder="Parte del nombre, ej. ANTILLAS3_full"
                maxLength={200}
                value={informeTexto}
                onChange={(evento) => setInformeTexto(evento.target.value)}
              />
            </div>
          </div>

          <div className="informe__acciones">
            <button
              type="button"
              className="boton boton--secundario"
              disabled={cargandoInforme}
              onClick={() => void consultarInforme()}
            >
              {cargandoInforme ? 'Consultando…' : 'Consultar'}
            </button>
          </div>

          {errorInforme && (
            <p className="formulario__error" role="alert">
              {errorInforme}
            </p>
          )}

          {informe && (
            <div className="informe__resultado">
              <p className="campo__ayuda" title={informe.carpeta}>
                Carpeta consultada: {informe.carpeta}
              </p>

              <p
                className={`informe__veredicto informe__veredicto--${
                  informe.resumen.total > 0 ? 'si' : 'no'
                }`}
              >
                {informe.resumen.total > 0
                  ? `Sí hay respaldo: ${informe.resumen.total} registro${
                      informe.resumen.total === 1 ? '' : 's'
                    } entre ${formatearDia(informe.desde)} y ${formatearDia(informe.hasta)}.`
                  : `No hay respaldo registrado entre ${formatearDia(informe.desde)} y ${formatearDia(informe.hasta)}.`}
              </p>

              {informeTextoAplicado && (
                <p className="campo__ayuda">
                  Filtrado por archivos que contienen «{informeTextoAplicado}».
                </p>
              )}

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
                <div>
                  <dt>Días con respaldo</dt>
                  <dd>
                    {informe.resumen.diasConRespaldo.length} de {diasDelInforme}
                  </dd>
                </div>
                <div>
                  <dt>Bases</dt>
                  <dd title={informe.resumen.bases.join(', ')}>
                    {informe.resumen.bases.join(', ') || '—'}
                  </dd>
                </div>
              </dl>

              {informe.resumen.diasSinRespaldo.length > 0 && (
                <p className="informe__huecos">
                  Días sin ningún respaldo: {informe.resumen.diasSinRespaldo.map(formatearDia).join(', ')}.
                </p>
              )}

              {informe.truncado && (
                <p className="campo__aviso">
                  La lista se cortó por el límite de resultados. Reduce el rango o filtra por base.
                </p>
              )}

              {gruposInforme.length > 0 && (
                <ul className="informe__dias">
                  {gruposInforme.map(([dia, archivos]) => (
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
                            key={`${archivo.archivo}-${archivo.fecha}`}
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
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              <p className="campo__ayuda">{informe.advertencia}</p>
            </div>
          )}
        </section>
      )}

      {respaldo.tipo === 'mssql' && (
        <section className="inventario">
          <div className="inventario__cabecera">
            <h3 className="historial__titulo">Archivos .bak en el servidor</h3>
            <button
              type="button"
              className="boton boton--secundario"
              disabled={cargandoInventario}
              onClick={() => void analizarInventario()}
            >
              {cargandoInventario
                ? 'Analizando…'
                : inventario
                  ? 'Volver a analizar'
                  : 'Analizar carpeta'}
            </button>
          </div>

          {errorInventario && (
            <p className="formulario__error" role="alert">
              {errorInventario}
            </p>
          )}

          {!inventario && !errorInventario && (
            <p className="campo__ayuda">
              Consulta msdb para listar los .bak de esta carpeta. Es solo lectura: no borra ni
              modifica archivos.
            </p>
          )}

          {inventario && (
            <>
              <p className="inventario__advertencia">{inventario.advertencia}</p>

              {inventario.archivos.length === 0 ? (
                <p className="historial__vacio">
                  No hay backups registrados en msdb para esta carpeta.
                </p>
              ) : (
                <ul className="inventario__lista">
                  {inventario.archivos.map((archivo, indice) => (
                    <li key={`${archivo.archivo}-${indice}`} className="inventario__item">
                      <div className="inventario__fila">
                        <span className={`inventario__tipo inventario__tipo--${archivo.tipo}`}>
                          {archivo.tipo === 'diferencial' ? 'Diff' : 'Full'}
                        </span>
                        <span className="inventario__base">{archivo.baseDatos}</span>
                        <span
                          className={`inventario__categoria inventario__categoria--${archivo.categoria}`}
                        >
                          {ETIQUETAS_CATEGORIA[archivo.categoria]}
                        </span>
                      </div>

                      <p className="inventario__nombre" title={archivo.archivo}>
                        {archivo.nombre}
                      </p>
                      <p className="inventario__meta">
                        {formatearFechaHora(archivo.fecha)} ·{' '}
                        {formatearTamano(archivo.tamanoBytes)} ·{' '}
                        {ETIQUETAS_COMPRESION[archivo.compresion]}
                        {archivo.esCopyOnly && ' · COPY_ONLY'}
                      </p>

                      {archivo.tipo === 'diferencial' && archivo.baseArchivo && (
                        <p className="inventario__base-full" title={archivo.baseArchivo}>
                          Base: {nombreDeRuta(archivo.baseArchivo)}
                        </p>
                      )}

                      <p className="inventario__sugerencia">{archivo.sugerencia}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </Modal>
  );
}
