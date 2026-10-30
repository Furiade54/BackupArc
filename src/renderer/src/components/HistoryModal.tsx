import { useEffect, useState } from 'react';
import type {
  ArchivoBakInventario,
  EjecucionRespaldo,
  InventarioBak,
  RespaldoConfigurado,
} from '../../../shared/types/respaldo.types';
import { formatearBasesDatos } from '../../../shared/utils/bases-datos';
import {
  formatearDuracionMs,
  formatearFechaHora,
  formatearFrecuencia,
} from '../utils/formato';
import { formatearTamano } from '../utils/informe';
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

function IconoCopiar() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.5 3.5v-1h-8v8h1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconoCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconoChevron({ abierto }: { abierto: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`historial__chevron${abierto ? ' historial__chevron--abierto' : ''}`}
    >
      <path d="M4 6.5 8 10.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function nombreDeRuta(ruta: string): string {
  const partes = ruta.split(/[\\/]/);
  return partes[partes.length - 1] || ruta;
}

function carpetaDeRuta(ruta: string): string {
  const corte = Math.max(ruta.lastIndexOf('\\'), ruta.lastIndexOf('/'));

  return corte > 0 ? ruta.slice(0, corte) : ruta;
}

// Copia al portapapeles con refuerzo para cuando la API moderna no está disponible.
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const campo = document.createElement('textarea');
      campo.value = texto;
      campo.style.position = 'fixed';
      campo.style.opacity = '0';
      document.body.appendChild(campo);
      campo.select();
      const exito = document.execCommand('copy');
      document.body.removeChild(campo);
      return exito;
    } catch {
      return false;
    }
  }
}

function BotonCopiar({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) {
      return;
    }

    const temporizador = setTimeout(() => setCopiado(false), 1400);
    return () => clearTimeout(temporizador);
  }, [copiado]);

  return (
    <button
      type="button"
      className={`boton-copiar${copiado ? ' boton-copiar--copiado' : ''}`}
      title={copiado ? 'Copiado' : `Copiar ${etiqueta}`}
      aria-label={copiado ? 'Copiado' : `Copiar ${etiqueta}`}
      onClick={(evento) => {
        evento.stopPropagation();
        void copiarTexto(valor).then((exito) => {
          if (exito) {
            setCopiado(true);
          }
        });
      }}
    >
      {copiado ? <IconoCheck /> : <IconoCopiar />}
    </button>
  );
}

function RutaCopiable({
  ruta,
  etiqueta,
  alAbrir,
  abrirDeshabilitado,
}: {
  ruta: string;
  etiqueta: string;
  alAbrir?: () => void;
  abrirDeshabilitado?: string;
}) {
  return (
    <div className="ruta-copiable">
      <span className="ruta-copiable__texto" title={ruta}>
        {ruta}
      </span>
      <BotonCopiar valor={ruta} etiqueta={etiqueta} />
      {alAbrir && (
        <button
          type="button"
          className="ruta-copiable__abrir"
          onClick={alAbrir}
          title="Abrir la carpeta"
          aria-label="Abrir la carpeta"
        >
          <IconoCarpeta />
        </button>
      )}
      {abrirDeshabilitado && (
        <span className="ruta-copiable__aviso" title={abrirDeshabilitado}>
          Servidor remoto
        </span>
      )}
    </div>
  );
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

// El resultado de la corrida es independiente de dónde quedó el archivo.
const ETIQUETAS_RESULTADO = {
  ok: 'Exitosa',
  advertencia: 'Parcial',
  error: 'Fallida',
  pendiente: 'Pendiente',
} as const;

function resumirMetricas(ejecucion: EjecucionRespaldo): string {
  const partes: string[] = [];

  if (ejecucion.archivos !== null) {
    partes.push(`${ejecucion.archivos} ${ejecucion.archivos === 1 ? 'archivo' : 'archivos'}`);
  }

  if (ejecucion.bytes !== null && ejecucion.bytes > 0) {
    partes.push(formatearTamano(ejecucion.bytes));
  }

  if (ejecucion.duracionMs !== null) {
    partes.push(formatearDuracionMs(ejecucion.duracionMs));
  }

  return partes.join(' · ');
}

export function HistoryModal({ respaldo, alCerrar }: HistoryModalProps) {
  const [ejecuciones, setEjecuciones] = useState<EjecucionRespaldo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisoApertura, setAvisoApertura] = useState<string | null>(null);
  const [inventario, setInventario] = useState<InventarioBak | null>(null);
  const [cargandoInventario, setCargandoInventario] = useState(false);
  const [errorInventario, setErrorInventario] = useState<string | null>(null);
  const [confirmandoLimpieza, setConfirmandoLimpieza] = useState(false);
  const [limpiandoHistorial, setLimpiandoHistorial] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  // La carpeta de un servidor remoto no existe en este equipo.
  const esRemoto = respaldo.tipo === 'mssql' && respaldo.conexionMssql?.esRemoto === true;
  const puedeAbrirDestino = !esRemoto;
  const ultima = ejecuciones?.[0] ?? null;

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

  const abrirCarpeta = async (ruta: string, mensaje: string) => {
    setAvisoApertura(null);

    try {
      const resultado = await window.api.sistema.abrirRuta(ruta);

      if (!resultado.ok) {
        setAvisoApertura(resultado.error);
      }
    } catch {
      setAvisoApertura(mensaje);
    }
  };

  const abrirDestino = () => {
    if (!puedeAbrirDestino) {
      return;
    }

    void abrirCarpeta(respaldo.destino, 'No se pudo abrir la carpeta del backup.');
  };

  // Abre la carpeta del .zip generado. Es independiente del destino del .bak:
  // la app pudo comprimir en otra ruta configurada en la tarea.
  const abrirCarpetaZip = (ruta: string | null) => {
    if (!ruta) {
      return;
    }

    void abrirCarpeta(carpetaDeRuta(ruta), 'No se pudo abrir la carpeta del .zip.');
  };

  // Borra el historial de esta tarea. No toca los .bak/.zip del disco.
  const limpiarHistorial = async () => {
    setLimpiandoHistorial(true);
    setError(null);

    try {
      const resultado = await window.api.respaldos.limpiarHistorial(respaldo.id);

      if (resultado.ok) {
        setEjecuciones([]);
        setConfirmandoLimpieza(false);
        setAbierta(null);
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se pudo limpiar el historial.');
    } finally {
      setLimpiandoHistorial(false);
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

  return (
    <Modal titulo={`Historial · ${respaldo.nombre}`} alCerrar={alCerrar}>
      <section className="historial__seccion">
        <h3 className="historial__titulo">Configuración de la tarea</h3>

        <dl className="resumen-respaldo">
          <div>
            <dt>Tipo</dt>
            <dd>{respaldo.tipo === 'mssql' ? 'Base de datos MSSQL' : 'Archivos y carpetas'}</dd>
          </div>
          <div>
            <dt>Frecuencia</dt>
            <dd>{formatearFrecuencia(respaldo.frecuenciaMinutos)}</dd>
          </div>
          <div>
            <dt>{respaldo.tipo === 'mssql' ? 'Bases de datos' : 'Carpeta de origen'}</dt>
            <dd title={respaldo.origen}>
              {respaldo.tipo !== 'mssql'
                ? respaldo.origen
                : respaldo.todasLasBases
                  ? 'Todas las bases (dinámico)'
                  : formatearBasesDatos(respaldo.origen)}
            </dd>
          </div>
          <div>
            <dt>Ubicación del backup</dt>
            <dd>
              <RutaCopiable
                ruta={respaldo.destino}
                etiqueta="la ubicación del backup"
                alAbrir={puedeAbrirDestino ? abrirDestino : undefined}
                abrirDeshabilitado={
                  puedeAbrirDestino
                    ? undefined
                    : 'La carpeta está en el servidor SQL remoto y no existe en este equipo'
                }
              />
            </dd>
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
                <dt>Retención</dt>
                <dd>{respaldo.retencionDias} días</dd>
              </div>
              <div className="resumen-respaldo__ancho">
                <dt>Opciones del .bak</dt>
                <dd>
                  {[
                    respaldo.comprimirBak
                      ? `Comprimido en .zip${respaldo.carpetaZip ? ` (${respaldo.carpetaZip})` : ''}`
                      : null,
                    respaldo.verificarBak ? 'Verificado al terminar' : null,
                    respaldo.usarCopiaTemporal ? 'Copia temporal intermedia' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Ninguna'}
                </dd>
              </div>
            </>
          )}
          {respaldo.tipo !== 'mssql' && (
            <div>
              <dt>Retención</dt>
              <dd>{respaldo.retencionDias} días</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="historial__seccion">
        <h3 className="historial__titulo">Estado</h3>

        <dl className="resumen-respaldo resumen-respaldo--estado">
          <div>
            <dt>Última ejecución</dt>
            <dd>
              {respaldo.ultimaEjecucion ? formatearFechaHora(respaldo.ultimaEjecucion) : 'Sin ejecuciones'}
            </dd>
          </div>
          <div>
            <dt>Resultado</dt>
            <dd>
              {respaldo.ultimaEjecucion ? (
                <span className={`etiqueta etiqueta--${respaldo.ultimoEstado}`}>
                  {ETIQUETAS_RESULTADO[respaldo.ultimoEstado]}
                </span>
              ) : (
                'Sin ejecutar'
              )}
            </dd>
          </div>
          <div>
            <dt>Próxima ejecución</dt>
            <dd>{formatearFechaHora(respaldo.proximaEjecucion)}</dd>
          </div>
          <div>
            <dt>Última corrida</dt>
            <dd>
              {ultima && (ultima.archivos !== null || ultima.duracionMs !== null)
                ? resumirMetricas(ultima) || '—'
                : 'Sin datos de la corrida'}
            </dd>
          </div>
        </dl>
      </section>

      {avisoApertura && (
        <p className="formulario__error" role="alert">
          {avisoApertura}
        </p>
      )}

      <section className="historial__seccion">
        <div className="historial__cabecera">
          <h3 className="historial__titulo">Ejecuciones registradas</h3>

          {ejecuciones !== null &&
            ejecuciones.length > 0 &&
            !confirmandoLimpieza && (
              <button
                type="button"
                className="boton-texto"
                onClick={() => setConfirmandoLimpieza(true)}
              >
                Limpiar historial
              </button>
            )}
        </div>

        {confirmandoLimpieza && ejecuciones && (
          <div className="historial__confirmacion" role="alertdialog" aria-label="Confirmar limpieza">
            <p>
              Se eliminarán <strong>{ejecuciones.length}</strong>{' '}
              {ejecuciones.length === 1 ? 'registro' : 'registros'} de esta tarea. Los backups
              guardados en disco <strong>no se borran</strong>: solo se pierde el historial de
              ejecuciones.
            </p>
            <div className="historial__confirmacion-acciones">
              <button
                type="button"
                className="boton boton--secundario"
                disabled={limpiandoHistorial}
                onClick={() => setConfirmandoLimpieza(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="boton boton--peligro"
                disabled={limpiandoHistorial}
                onClick={() => void limpiarHistorial()}
              >
                {limpiandoHistorial ? 'Borrando…' : 'Borrar registros'}
              </button>
            </div>
          </div>
        )}

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
            {ejecuciones.map((ejecucion) => {
              const estaAbierta = abierta === ejecucion.id;
              const metricas = resumirMetricas(ejecucion);

              return (
                <li
                  key={ejecucion.id}
                  className={`historial__item${estaAbierta ? ' historial__item--abierta' : ''}`}
                >
                  <button
                    type="button"
                    className="historial__resumen"
                    aria-expanded={estaAbierta}
                    onClick={() => setAbierta(estaAbierta ? null : ejecucion.id)}
                  >
                    <span
                      className={`historial__punto historial__punto--${ejecucion.estado}`}
                      aria-hidden="true"
                    />
                    <span className="historial__fecha">
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
                    </span>
                    <span className="historial__metricas">{metricas || 'Sin datos'}</span>
                    <span className={`etiqueta etiqueta--${ejecucion.estado}`}>
                      {ETIQUETAS_RESULTADO[ejecucion.estado]}
                    </span>
                    <IconoChevron abierto={estaAbierta} />
                  </button>

                  {estaAbierta && (
                    <div className="historial__detalle-contenedor">
                      {ejecucion.ubicacion && (
                        <RutaCopiable
                          ruta={ejecucion.ubicacion}
                          etiqueta="la ruta de la copia"
                          alAbrir={
                            puedeAbrirDestino
                              ? () =>
                                  void abrirCarpeta(
                                    carpetaDeRuta(ejecucion.ubicacion as string),
                                    'No se pudo abrir la carpeta de la copia.',
                                  )
                              : undefined
                          }
                          abrirDeshabilitado={
                            puedeAbrirDestino
                              ? undefined
                              : 'La copia está en el servidor SQL remoto'
                          }
                        />
                      )}

                      {ejecucion.detalle &&
                        !(ejecucion.ubicacion && ejecucion.detalle.includes(ejecucion.ubicacion)) && (
                          <p className="historial__detalle">{ejecucion.detalle}</p>
                        )}

                      {ejecucion.resultados.length > 0 && (
                        <ul className="resultados-base">
                          {ejecucion.resultados.map((resultado) => (
                            <li key={resultado.id} className="resultados-base__item">
                              <div className="resultados-base__cabecera">
                                {resultado.archivo === null ? (
                                  <span className="resultados-base__tipo resultados-base__tipo--omitida">
                                    Omitida
                                  </span>
                                ) : (
                                  <span
                                    className={`resultados-base__tipo resultados-base__tipo--${resultado.tipoEjecutado}`}
                                  >
                                    {resultado.tipoEjecutado === 'diferencial' ? 'Diff' : 'Full'}
                                  </span>
                                )}
                                <span className="resultados-base__base">{resultado.baseDatos}</span>
                                {resultado.archivo !== null && (
                                  <span className="resultados-base__meta">
                                    {formatearTamano(resultado.tamanoBytes)} ·{' '}
                                    {ETIQUETAS_COMPRESION[resultado.compresion]}
                                  </span>
                                )}
                                {resultado.estado !== 'ok' && resultado.estado !== 'pendiente' && (
                                  <span className={`etiqueta etiqueta--${resultado.estado}`}>
                                    {ETIQUETAS_RESULTADO[resultado.estado]}
                                  </span>
                                )}
                              </div>

                              {resultado.archivo === null && resultado.detalle && (
                                <p className="resultados-base__archivo">{resultado.detalle}</p>
                              )}

                              {resultado.archivo && (
                                <RutaCopiable
                                  ruta={resultado.archivo}
                                  etiqueta="la ruta del .bak"
                                />
                              )}

                              {resultado.archivoZip && (
                                <div className="resultados-base__zip">
                                  <RutaCopiable
                                    ruta={resultado.archivoZip}
                                    etiqueta="la ruta del .zip"
                                    alAbrir={() => abrirCarpetaZip(resultado.archivoZip)}
                                  />
                                  {resultado.tamanoZipBytes !== null && (
                                    <span className="resultados-base__meta">
                                      {formatearTamano(resultado.tamanoZipBytes)}
                                    </span>
                                  )}
                                </div>
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
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
