import { useCallback, useEffect, useRef, useState } from 'react';
import type { InfoAplicacion, ResultadoActualizacion } from '../../shared/types/api.types';
import type { RespaldoConfigurado } from '../../shared/types/respaldo.types';
import { AdvancedSettings } from './components/AdvancedSettings';
import { BackupCard } from './components/BackupCard';
import { CloseConfirmModal } from './components/CloseConfirmModal';
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
import { ContextMenu, type OpcionMenu } from './components/ContextMenu';
import { HistoryModal } from './components/HistoryModal';
import { Modal } from './components/Modal';
import { NewBackupModal } from './components/NewBackupModal';
import { ReportsSection } from './components/ReportsSection';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { UpdateModal } from './components/UpdateModal';

const TITULOS_SECCION: Record<string, string> = {
  'seccion-copias': 'Copias de seguridad',
  'seccion-informes': 'Informes',
};

const CLAVE_MENU = 'ui.menu-lateral';

function App() {
  const [info, setInfo] = useState<InfoAplicacion | null>(null);
  const [respaldos, setRespaldos] = useState<RespaldoConfigurado[]>([]);
  const [mensajeRespaldos, setMensajeRespaldos] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ejecucionesActivas, setEjecucionesActivas] = useState<Set<number>>(() => new Set());
  const [menuAbierto, setMenuAbierto] = useState(true);
  const [preferenciasListas, setPreferenciasListas] = useState(false);
  const [seccionActiva, setSeccionActiva] = useState<string>('seccion-copias');
  const [ahora, setAhora] = useState(() => Date.now());
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false);
  const [modalConfiguracionAbierto, setModalConfiguracionAbierto] = useState(false);
  const [modalActualizacionAbierto, setModalActualizacionAbierto] = useState(false);
  const [dialogoCierreAbierto, setDialogoCierreAbierto] = useState(false);
  const [buscandoActualizacion, setBuscandoActualizacion] = useState(false);
  const [resultadoActualizacion, setResultadoActualizacion] = useState<ResultadoActualizacion | null>(null);
  const [respaldoEditar, setRespaldoEditar] = useState<RespaldoConfigurado | null>(null);
  const [respaldoHistorial, setRespaldoHistorial] = useState<RespaldoConfigurado | null>(null);
  const [respaldoEliminar, setRespaldoEliminar] = useState<RespaldoConfigurado | null>(null);
  const [menuContextual, setMenuContextual] = useState<{
    respaldo: RespaldoConfigurado;
    x: number;
    y: number;
  } | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  const cargarDatos = useCallback(async () => {
    setCargando(true);

    const [respuestaInfo, respuestaRespaldos] = await Promise.all([
      window.api.app.info(),
      window.api.respaldos.listar(),
    ]);

    if (respuestaInfo.ok) {
      setInfo(respuestaInfo.datos);
    }

    if (respuestaRespaldos.ok) {
      setRespaldos(respuestaRespaldos.datos);
      setMensajeRespaldos(null);
    } else {
      setRespaldos([]);
      setMensajeRespaldos(respuestaRespaldos.error);
    }

    setCargando(false);
  }, []);

  const recargarRespaldos = useCallback(async () => {
    const respuesta = await window.api.respaldos.listar();

    if (respuesta.ok) {
      setRespaldos(respuesta.datos);
      setMensajeRespaldos(null);
    } else {
      setMensajeRespaldos(respuesta.error);
    }
  }, []);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  useEffect(() => {
    const temporizador = window.setInterval(() => {
      setAhora(Date.now());
    }, 60000);

    return () => {
      window.clearInterval(temporizador);
    };
  }, []);

  useEffect(() => {
    return window.api.ventana.alSolicitarCierre(() => {
      setDialogoCierreAbierto(true);
    });
  }, []);

  useEffect(() => {
    return window.api.respaldos.alCambiarEjecucion((id, enEjecucion) => {
      setEjecucionesActivas((actuales) => {
        const siguientes = new Set(actuales);

        if (enEjecucion) {
          siguientes.add(id);
        } else {
          siguientes.delete(id);
        }

        return siguientes;
      });

      if (!enEjecucion) {
        void recargarRespaldos();
      }
    });
  }, [recargarRespaldos]);

  useEffect(() => {
    let activo = true;

    void window.api.preferencias
      .obtener(CLAVE_MENU)
      .then((resultado) => {
        if (activo && resultado.ok && resultado.datos === 'cerrado') {
          setMenuAbierto(false);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (activo) {
          setPreferenciasListas(true);
        }
      });

    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    if (!preferenciasListas) {
      return;
    }

    void window.api.preferencias.guardar(CLAVE_MENU, menuAbierto ? 'abierto' : 'cerrado').catch(() => undefined);
  }, [menuAbierto, preferenciasListas]);

  useEffect(() => {
    const alPresionarTecla = (evento: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }

      if (evento.key === 'Escape' && menuAbierto) {
        setMenuAbierto(false);
        return;
      }

      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'b') {
        evento.preventDefault();
        setMenuAbierto((abierto) => !abierto);
      }
    };

    window.addEventListener('keydown', alPresionarTecla);

    return () => {
      window.removeEventListener('keydown', alPresionarTecla);
    };
  }, [menuAbierto]);

  // Cada sección es una página: al cambiar de vista se vuelve al inicio.
  useEffect(() => {
    contenedorRef.current?.scrollTo({ top: 0 });
  }, [seccionActiva]);

  const alternarMenu = useCallback(() => {
    setMenuAbierto((abierto) => !abierto);
  }, []);

  const navegarASeccion = useCallback((id: string) => {
    setSeccionActiva(id);
  }, []);

  const abrirNuevaCopia = useCallback(() => {
    setModalNuevoAbierto(true);
  }, []);

  const alCrearCopia = useCallback(() => {
    setModalNuevoAbierto(false);
    void recargarRespaldos();
  }, [recargarRespaldos]);

  const alEditarCopia = useCallback(() => {
    setRespaldoEditar(null);
    void recargarRespaldos();
  }, [recargarRespaldos]);

  const abrirMenuContextual = useCallback(
    (respaldo: RespaldoConfigurado, posicion: { x: number; y: number }) => {
      setMenuContextual({ respaldo, x: posicion.x, y: posicion.y });
    },
    [],
  );

  const alEjecutarAhora = useCallback(
    async (respaldo: RespaldoConfigurado) => {
      const respuesta = await window.api.respaldos.ejecutar(respaldo.id);

      if (respuesta.ok) {
        await recargarRespaldos();
      } else {
        setMensajeRespaldos(respuesta.error);
      }
    },
    [recargarRespaldos],
  );

  const mantenerEnSegundoPlano = useCallback(() => {
    setDialogoCierreAbierto(false);
    void window.api.ventana.ocultar();
  }, []);

  const cerrarPorCompleto = useCallback(() => {
    setDialogoCierreAbierto(false);
    void window.api.ventana.salir();
  }, []);

  const alEliminarCopia = useCallback(() => {
    setRespaldoEliminar(null);
    void recargarRespaldos();
  }, [recargarRespaldos]);

  const alAlternarActivo = useCallback(
    async (respaldo: RespaldoConfigurado) => {
      const respuesta = await window.api.respaldos.establecerActivo(respaldo.id, !respaldo.habilitado);

      if (respuesta.ok) {
        await recargarRespaldos();
      } else {
        setMensajeRespaldos(respuesta.error);
      }
    },
    [recargarRespaldos],
  );

  const buscarActualizaciones = useCallback(async () => {
    setModalActualizacionAbierto(true);
    setBuscandoActualizacion(true);
    setResultadoActualizacion(null);

    try {
      const respuesta = await window.api.actualizaciones.buscar();

      if (respuesta.ok) {
        setResultadoActualizacion(respuesta.datos);
      } else {
        setResultadoActualizacion({
          estado: 'error',
          versionActual: info?.version ?? '',
          versionDisponible: null,
          urlPublicacion: null,
          notas: null,
          mensaje: respuesta.error,
        });
      }
    } catch {
      setResultadoActualizacion({
        estado: 'error',
        versionActual: info?.version ?? '',
        versionDisponible: null,
        urlPublicacion: null,
        notas: null,
        mensaje: 'No se pudo buscar actualizaciones.',
      });
    } finally {
      setBuscandoActualizacion(false);
    }
  }, [info?.version]);

  let opcionesMenu: OpcionMenu[] = [];

  if (menuContextual) {
    const { respaldo } = menuContextual;

    opcionesMenu = [
      {
        tipo: 'ejecutar',
        etiqueta: 'Ejecutar ahora',
        alSeleccionar: () => void alEjecutarAhora(respaldo),
      },
      {
        tipo: 'editar',
        etiqueta: 'Editar tarea',
        alSeleccionar: () => setRespaldoEditar(respaldo),
      },
      {
        tipo: 'historial',
        etiqueta: 'Ver historial',
        alSeleccionar: () => setRespaldoHistorial(respaldo),
      },
      {
        tipo: respaldo.habilitado ? 'pausar' : 'activar',
        etiqueta: respaldo.habilitado ? 'Deshabilitar tarea' : 'Habilitar tarea',
        alSeleccionar: () => void alAlternarActivo(respaldo),
      },
      {
        tipo: 'eliminar',
        etiqueta: 'Eliminar tarea',
        separadorAntes: true,
        alSeleccionar: () => setRespaldoEliminar(respaldo),
      },
    ];
  }

  return (
    <>
      <TitleBar
        plataforma={window.api.app.plataforma}
        titulo={TITULOS_SECCION[seccionActiva] ?? 'Copias de seguridad'}
        menuAbierto={menuAbierto}
        buscandoActualizacion={buscandoActualizacion}
        alAlternarMenu={alternarMenu}
        alCrearCopia={abrirNuevaCopia}
        alBuscarActualizaciones={buscarActualizaciones}
      />

      <div className="cuerpo">
        <Sidebar
          abierto={menuAbierto}
          seccionActiva={seccionActiva}
          version={info?.version ?? '2.0.0'}
          alNavegar={navegarASeccion}
          alAbrirConfiguracion={() => setModalConfiguracionAbierto(true)}
        />

        <div className="app" ref={contenedorRef}>
          <h1 className="solo-lectores">{TITULOS_SECCION[seccionActiva] ?? 'Copias de seguridad'}</h1>

          {seccionActiva === 'seccion-informes' ? (
            <ReportsSection respaldos={respaldos} />
          ) : (
            <section className="seccion">
              <div className="seccion__encabezado">
                <div>
                  <h2>Copias configuradas</h2>
                  <p>
                    {respaldos.length === 0
                      ? 'Aún no hay tareas de respaldo.'
                      : `${respaldos.length} ${respaldos.length === 1 ? 'tarea configurada' : 'tareas configuradas'}`}
                  </p>
                </div>
              </div>

              {mensajeRespaldos && (
                <p className="mensaje-error" role="alert">
                  {mensajeRespaldos}
                </p>
              )}

              {respaldos.length > 0 ? (
                <div className="copias-grid">
                  {respaldos.map((respaldo) => (
                    <BackupCard
                      key={respaldo.id}
                      respaldo={respaldo}
                      ahora={ahora}
                      ejecutando={ejecucionesActivas.has(respaldo.id)}
                      alVerHistorial={(seleccionado) => setRespaldoHistorial(seleccionado)}
                      alEliminar={(seleccionado) => setRespaldoEliminar(seleccionado)}
                      alAlternarActivo={(seleccionado) => void alAlternarActivo(seleccionado)}
                      alEditar={(seleccionado) => setRespaldoEditar(seleccionado)}
                      alAbrirMenuContextual={abrirMenuContextual}
                    />
                  ))}
                </div>
              ) : (
                !cargando &&
                !mensajeRespaldos && (
                  <div className="copias-vacio">
                    <strong>No hay copias configuradas</strong>
                    <p>Crea una tarea para programar su frecuencia, horario y consultar su historial.</p>
                    <button className="boton" type="button" onClick={abrirNuevaCopia}>
                      Crear backup
                    </button>
                  </div>
                )
              )}
            </section>
          )}
        </div>
      </div>

      {seccionActiva === 'seccion-copias' && (
        <button
          type="button"
          className="boton-flotante"
          aria-label="Nuevo backup"
          title="Nuevo backup"
          onClick={abrirNuevaCopia}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <path d="M11 4v14M4 11h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {menuContextual && (
        <ContextMenu
          x={menuContextual.x}
          y={menuContextual.y}
          opciones={opcionesMenu}
          alCerrar={() => setMenuContextual(null)}
        />
      )}

      {modalActualizacionAbierto && (
        <UpdateModal
          resultado={resultadoActualizacion}
          buscando={buscandoActualizacion}
          alCerrar={() => setModalActualizacionAbierto(false)}
        />
      )}

      {modalConfiguracionAbierto && (
        <Modal titulo="Configuración avanzada" alCerrar={() => setModalConfiguracionAbierto(false)}>
          <AdvancedSettings empaquetada={info?.empaquetada ?? false} />
        </Modal>
      )}

      {modalNuevoAbierto && (
        <NewBackupModal alCerrar={() => setModalNuevoAbierto(false)} alGuardado={alCrearCopia} />
      )}

      {respaldoEditar && (
        <NewBackupModal
          respaldo={respaldoEditar}
          alCerrar={() => setRespaldoEditar(null)}
          alGuardado={alEditarCopia}
        />
      )}

      {respaldoHistorial && (
        <HistoryModal respaldo={respaldoHistorial} alCerrar={() => setRespaldoHistorial(null)} />
      )}

      {respaldoEliminar && (
        <ConfirmDeleteModal
          respaldo={respaldoEliminar}
          alCerrar={() => setRespaldoEliminar(null)}
          alEliminado={alEliminarCopia}
        />
      )}

      {dialogoCierreAbierto && (
        <CloseConfirmModal
          alCancelar={() => setDialogoCierreAbierto(false)}
          alMantenerEnSegundoPlano={mantenerEnSegundoPlano}
          alCerrarPorCompleto={cerrarPorCompleto}
        />
      )}
    </>
  );
}

export default App;
