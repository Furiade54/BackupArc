import { useEffect, useState, type FormEvent } from 'react';
import type { RespaldoConfigurado, TipoRespaldo } from '../../../shared/types/respaldo.types';
import { parsearBasesDatos, serializarBasesDatos } from '../../../shared/utils/bases-datos';
import { MssqlConfigModal } from './MssqlConfigModal';
import { MssqlDatabasesModal } from './MssqlDatabasesModal';
import { Modal } from './Modal';
import { IconoAjustes } from './Sidebar';
import './BackupModals.css';

interface NewBackupModalProps {
  respaldo?: RespaldoConfigurado | null;
  alCerrar: () => void;
  alGuardado: () => void;
}

const OPCIONES_FRECUENCIA = [
  { valor: '3', etiqueta: 'Cada 3 minutos' },
  { valor: '15', etiqueta: 'Cada 15 minutos' },
  { valor: '30', etiqueta: 'Cada 30 minutos' },
  { valor: '60', etiqueta: 'Cada hora' },
  { valor: '120', etiqueta: 'Cada 2 horas' },
  { valor: '360', etiqueta: 'Cada 6 horas' },
  { valor: '720', etiqueta: 'Cada 12 horas' },
  { valor: '1440', etiqueta: 'Cada 24 horas' },
  { valor: '10080', etiqueta: 'Semanal' },
  { valor: '43200', etiqueta: 'Mensual' },
];

const VALOR_PERSONALIZADO = 'personalizado';
const MINUTOS_POR_DIA = 1440;
const MAX_FRECUENCIA_MINUTOS = 43200;

type IdPaso = 'tipo' | 'ubicacion' | 'programacion' | 'opciones';

const PASOS: { id: IdPaso; etiqueta: string }[] = [
  { id: 'tipo', etiqueta: 'Básico' },
  { id: 'ubicacion', etiqueta: 'Ubicación' },
  { id: 'programacion', etiqueta: 'Programación' },
  { id: 'opciones', etiqueta: 'Opciones' },
];

export function NewBackupModal({ respaldo = null, alCerrar, alGuardado }: NewBackupModalProps) {
  const editando = respaldo !== null;
  const minutosIniciales = respaldo?.frecuenciaMinutos ?? MINUTOS_POR_DIA;
  const preseleccionInicial = OPCIONES_FRECUENCIA.some(
    (opcion) => Number(opcion.valor) === minutosIniciales,
  );
  const [nombre, setNombre] = useState(respaldo?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoRespaldo>(respaldo?.tipo ?? 'archivos');
  const [origen, setOrigen] = useState(respaldo?.origen ?? '');
  const [destino, setDestino] = useState(respaldo?.destino ?? '');
  const [frecuencia, setFrecuencia] = useState(
    preseleccionInicial ? String(minutosIniciales) : VALOR_PERSONALIZADO,
  );
  const [minutosPersonalizados, setMinutosPersonalizados] = useState(String(minutosIniciales));
  const [hora, setHora] = useState(respaldo?.horaEjecucion ?? '03:00');
  const [retencion, setRetencion] = useState(String(respaldo?.retencionDias ?? 7));
  const [copiaConFecha, setCopiaConFecha] = useState(respaldo?.copiaConFecha ?? true);
  const [comprimir, setComprimir] = useState(respaldo?.comprimir ?? false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [indicePaso, setIndicePaso] = useState(0);
  const [basesDatos, setBasesDatos] = useState<string[]>(() =>
    respaldo?.tipo === 'mssql' ? parsearBasesDatos(respaldo.origen) : [],
  );
  const [basesDatosAbiertas, setBasesDatosAbiertas] = useState(false);
  const [configuracionMssqlAbierta, setConfiguracionMssqlAbierta] = useState(false);
  // null mientras se consulta; false indica credenciales incompletas.
  const [credencialesMssqlListas, setCredencialesMssqlListas] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      try {
        const resultado = await window.api.mssql.obtener();

        if (cancelado || !resultado.ok) {
          return;
        }

        const { servidor, usuario, tieneContrasena } = resultado.datos;
        setCredencialesMssqlListas(
          servidor.trim().length > 0 && usuario.trim().length > 0 && tieneContrasena,
        );
      } catch {
        if (!cancelado) {
          setCredencialesMssqlListas(null);
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const frecuenciaMinutos =
    frecuencia === VALOR_PERSONALIZADO ? Number(minutosPersonalizados) : Number(frecuencia);
  const usaHoraFija = frecuenciaMinutos >= MINUTOS_POR_DIA;
  const esMssql = tipo === 'mssql';
  const retencionDias = Number(retencion);

  // Los respaldos MSSQL no tienen empaquetado ni retención local.
  const pasos = esMssql ? PASOS.filter((paso) => paso.id !== 'opciones') : PASOS;
  const indiceActual = Math.min(indicePaso, pasos.length - 1);
  const pasoActual = pasos[indiceActual];
  const esUltimoPaso = indiceActual === pasos.length - 1;

  const validarPaso = (id: IdPaso): string | null => {
    if (id === 'tipo') {
      if (!nombre.trim()) {
        return 'Escribe un nombre para el backup.';
      }

      if (esMssql && credencialesMssqlListas === false) {
        return 'Configura las credenciales de SQL Server con el engranaje antes de continuar.';
      }

      return null;
    }

    if (id === 'ubicacion') {
      if (esMssql) {
        if (basesDatos.length === 0) {
          return 'Selecciona al menos una base de datos con el botón Explorar.';
        }

        return destino.trim() ? null : 'Indica la carpeta destino en el servidor SQL.';
      }

      if (!origen.trim()) {
        return 'Indica la carpeta o archivo que se va a respaldar.';
      }

      return destino.trim() ? null : 'Indica dónde se guardará la copia.';
    }

    if (id === 'programacion') {
      if (
        !Number.isInteger(frecuenciaMinutos) ||
        frecuenciaMinutos < 1 ||
        frecuenciaMinutos > MAX_FRECUENCIA_MINUTOS
      ) {
        return 'La frecuencia debe ser un número entero de minutos entre 1 y 43200 (30 días).';
      }

      return null;
    }

    if (!Number.isInteger(retencionDias) || retencionDias < 1 || retencionDias > 3650) {
      return 'La retención debe ser un número entero entre 1 y 3650 días.';
    }

    return null;
  };

  const explorarCarpeta = async (campo: 'origen' | 'destino') => {
    const rutaActual = campo === 'origen' ? origen : destino;
    const resultado = await window.api.dialogos.seleccionarCarpeta(rutaActual.trim() || undefined);

    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }

    if (!resultado.datos) {
      return;
    }

    if (campo === 'origen') {
      setOrigen(resultado.datos);
    } else {
      setDestino(resultado.datos);
    }
  };

  const guardar = async () => {
    const problema = pasos
      .map((paso) => ({ paso, mensaje: validarPaso(paso.id) }))
      .find((resultado) => resultado.mensaje !== null);

    if (problema) {
      setError(problema.mensaje);
      setIndicePaso(pasos.indexOf(problema.paso));
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      const datos = {
        nombre: nombre.trim(),
        tipo,
        origen: esMssql ? serializarBasesDatos(basesDatos) : origen.trim(),
        destino: destino.trim(),
        frecuenciaMinutos,
        horaEjecucion: hora,
        retencionDias,
        copiaConFecha,
        comprimir: esMssql ? false : comprimir,
      };

      const resultado = respaldo
        ? await window.api.respaldos.actualizar(respaldo.id, datos)
        : await window.api.respaldos.crear(datos);

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      alGuardado();
    } catch {
      setError(editando ? 'No se pudo actualizar el backup.' : 'No se pudo crear el backup.');
    } finally {
      setGuardando(false);
    }
  };

  const avanzar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();

    const problema = validarPaso(pasoActual.id);

    if (problema) {
      setError(problema);
      return;
    }

    if (esUltimoPaso) {
      void guardar();
      return;
    }

    setError(null);
    setIndicePaso(indiceActual + 1);
  };

  const retroceder = () => {
    setError(null);
    setIndicePaso(Math.max(0, indiceActual - 1));
  };

  return (
    <>
      <Modal
        titulo={editando ? 'Editar tarea de backup' : 'Nuevo backup'}
        alCerrar={() => {
          // Evita que Escape cierre también este formulario cuando el diálogo
          // de credenciales está encima.
          if (!configuracionMssqlAbierta && !basesDatosAbiertas) {
            alCerrar();
          }
        }}
      >
        <form className="formulario formulario--asistente" onSubmit={avanzar}>
          <ol className="asistente__pasos" aria-label="Pasos del backup">
            {pasos.map((paso, indice) => {
              const estado =
                indice === indiceActual ? 'activo' : indice < indiceActual ? 'completado' : 'pendiente';

              return (
                <li key={paso.id} className={`asistente__paso asistente__paso--${estado}`}>
                  <button
                    type="button"
                    className="asistente__boton"
                    disabled={guardando || indice >= indiceActual}
                    aria-current={indice === indiceActual ? 'step' : undefined}
                    onClick={() => {
                      setError(null);
                      setIndicePaso(indice);
                    }}
                  >
                    <span className="asistente__numero" aria-hidden="true">
                      {indice < indiceActual ? '✓' : indice + 1}
                    </span>
                    <span className="asistente__etiqueta">{paso.etiqueta}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="asistente__contenido">
            {pasoActual.id === 'tipo' && (
              <>
                <div className="campo">
                  <label htmlFor="backup-nombre">Nombre</label>
                  <input
                    id="backup-nombre"
                    type="text"
                    value={nombre}
                    maxLength={80}
                    placeholder="Ej. Backup documentos"
                    autoFocus
                    disabled={guardando}
                    onChange={(evento) => setNombre(evento.target.value)}
                  />
                </div>

                <div className="campo">
                  <label htmlFor="backup-tipo">Tipo de backup</label>
                  <div className="campo__ruta">
                    <select
                      id="backup-tipo"
                      value={tipo}
                      disabled={guardando}
                      onChange={(evento) => {
                        setTipo(evento.target.value as TipoRespaldo);
                        // El aviso de credenciales depende del tipo elegido.
                        setError(null);
                      }}
                    >
                      <option value="archivos">Archivos y carpetas</option>
                      <option value="mssql">Base de datos MSSQL</option>
                    </select>
                    {esMssql && (
                      <button
                        type="button"
                        className={`campo__configurar${
                          credencialesMssqlListas === false ? ' campo__configurar--pendiente' : ''
                        }`}
                        title={
                          credencialesMssqlListas === false
                            ? 'Faltan las credenciales del servidor: haz clic aquí para configurarlas'
                            : 'Configurar credenciales de SQL Server'
                        }
                        aria-label={
                          credencialesMssqlListas === false
                            ? 'Faltan las credenciales del servidor. Configurar SQL Server'
                            : 'Configurar credenciales de SQL Server'
                        }
                        disabled={guardando}
                        onClick={() => setConfiguracionMssqlAbierta(true)}
                      >
                        <IconoAjustes />
                      </button>
                    )}
                  </div>
                  <span className="campo__ayuda">
                    {esMssql
                      ? 'El respaldo se ejecuta en el servidor SQL y el .bak queda en la carpeta destino de ese servidor.'
                      : 'Copia carpetas o archivos del equipo al destino indicado.'}
                  </span>
                </div>
              </>
            )}

            {pasoActual.id === 'ubicacion' && (
              <>
                {esMssql ? (
                  <div className="campo">
                    <label htmlFor="backup-bases">Bases de datos</label>
                    <div className="campo__ruta">
                      <input
                        id="backup-bases"
                        type="text"
                        value={basesDatos.join(', ')}
                        placeholder="Selecciona una o varias bases de datos"
                        title={basesDatos.join(', ')}
                        readOnly
                        disabled={guardando}
                        onClick={() => setBasesDatosAbiertas(true)}
                      />
                      <button
                        type="button"
                        className="boton boton--secundario"
                        disabled={guardando}
                        onClick={() => setBasesDatosAbiertas(true)}
                      >
                        Explorar
                      </button>
                    </div>
                    <span className="campo__ayuda">
                      {basesDatos.length === 0
                        ? 'Elige una, varias o todas las bases del servidor.'
                        : `${basesDatos.length} ${
                            basesDatos.length === 1 ? 'base seleccionada' : 'bases seleccionadas'
                          }.`}
                    </span>
                  </div>
                ) : (
                  <div className="campo">
                    <label htmlFor="backup-origen">Origen</label>
                    <div className="campo__ruta">
                      <input
                        id="backup-origen"
                        type="text"
                        value={origen}
                        maxLength={500}
                        placeholder="Carpeta o archivo a respaldar"
                        disabled={guardando}
                        onChange={(evento) => setOrigen(evento.target.value)}
                      />
                      <button
                        type="button"
                        className="boton boton--secundario"
                        disabled={guardando}
                        onClick={() => void explorarCarpeta('origen')}
                      >
                        Explorar
                      </button>
                    </div>
                    <span className="campo__ayuda">
                      Puedes indicar una carpeta (se copia completa) o un archivo suelto.
                    </span>
                  </div>
                )}

                <div className="campo">
                  <label htmlFor="backup-destino">
                    {esMssql ? 'Carpeta destino en el servidor' : 'Destino'}
                  </label>
                  <div className="campo__ruta">
                    <input
                      id="backup-destino"
                      type="text"
                      value={destino}
                      maxLength={500}
                      placeholder={esMssql ? 'Ej. D:\\Backups' : 'Lugar donde se guardará la copia'}
                      disabled={guardando}
                      onChange={(evento) => setDestino(evento.target.value)}
                    />
                    <button
                      type="button"
                      className="boton boton--secundario"
                      disabled={guardando}
                      onClick={() => void explorarCarpeta('destino')}
                    >
                      Explorar
                    </button>
                  </div>
                  {esMssql && (
                    <span className="campo__ayuda">
                      Ruta tal como la ve el servidor SQL. Debe existir y ser accesible por la cuenta
                      del servicio.
                    </span>
                  )}
                </div>
              </>
            )}

            {pasoActual.id === 'programacion' && (
              <>
                <div className="formulario__fila">
                  <div className="campo">
                    <label htmlFor="backup-frecuencia">Frecuencia</label>
                    <select
                      id="backup-frecuencia"
                      value={frecuencia}
                      disabled={guardando}
                      onChange={(evento) => setFrecuencia(evento.target.value)}
                    >
                      {OPCIONES_FRECUENCIA.map((opcion) => (
                        <option key={opcion.valor} value={opcion.valor}>
                          {opcion.etiqueta}
                        </option>
                      ))}
                      <option value={VALOR_PERSONALIZADO}>Personalizado…</option>
                    </select>
                  </div>

                  <div className="campo">
                    <label htmlFor="backup-hora">Hora de ejecución</label>
                    <input
                      id="backup-hora"
                      type="time"
                      value={hora}
                      disabled={guardando || !usaHoraFija}
                      title={usaHoraFija ? undefined : 'Solo aplica a frecuencias de 24 horas o más.'}
                      onChange={(evento) => setHora(evento.target.value)}
                    />
                    {!usaHoraFija && (
                      <span className="campo__ayuda">
                        Solo aplica a frecuencias de 24 horas o más.
                      </span>
                    )}
                  </div>
                </div>

                {frecuencia === VALOR_PERSONALIZADO && (
                  <div className="campo">
                    <label htmlFor="backup-frecuencia-minutos">Intervalo en minutos</label>
                    <input
                      id="backup-frecuencia-minutos"
                      type="number"
                      min={1}
                      max={MAX_FRECUENCIA_MINUTOS}
                      step={1}
                      value={minutosPersonalizados}
                      disabled={guardando}
                      onChange={(evento) => setMinutosPersonalizados(evento.target.value)}
                    />
                    <span className="campo__ayuda">Entre 1 y 43200 minutos (30 días).</span>
                  </div>
                )}

                <div className="campo">
                  <label htmlFor="backup-carpeta">Nombre de la copia</label>
                  <select
                    id="backup-carpeta"
                    value={copiaConFecha ? 'fecha' : 'unica'}
                    disabled={guardando}
                    onChange={(evento) => setCopiaConFecha(evento.target.value === 'fecha')}
                  >
                    <option value="fecha">Con fecha y hora (Documentos_20261021-153000)</option>
                    <option value="unica">Sin fecha (sobrescribe la copia anterior)</option>
                  </select>
                  <span className="campo__ayuda">
                    {esMssql
                      ? copiaConFecha
                        ? 'Cada ejecución crea un archivo .bak nuevo con fecha y hora.'
                        : 'Siempre se genera el mismo .bak y se reemplaza en cada ejecución.'
                      : copiaConFecha
                        ? `Cada ejecución crea ${comprimir ? 'un .zip nuevo' : 'una copia nueva'} y la retención borra ${
                            comprimir ? 'los anteriores' : 'las anteriores'
                          }.`
                        : `Siempre se guarda ${comprimir ? 'el mismo .zip' : 'con el mismo nombre'} y se reemplaza en cada ejecución.`}
                  </span>
                </div>
              </>
            )}

            {pasoActual.id === 'opciones' && (
              <>
                <div className="campo">
                  <label htmlFor="backup-formato">Formato del destino</label>
                  <select
                    id="backup-formato"
                    value={comprimir ? 'zip' : 'carpeta'}
                    disabled={guardando}
                    onChange={(evento) => setComprimir(evento.target.value === 'zip')}
                  >
                    <option value="carpeta">Carpeta descomprimida</option>
                    <option value="zip">Archivo .zip</option>
                  </select>
                  <span className="campo__ayuda">
                    {comprimir
                      ? 'La copia llega al destino como un único archivo comprimido.'
                      : 'La copia llega al destino con las carpetas y archivos tal cual.'}
                  </span>
                </div>

                <div className="campo">
                  <label htmlFor="backup-retencion">Retención (días)</label>
                  <input
                    id="backup-retencion"
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={retencion}
                    disabled={guardando || !copiaConFecha}
                    onChange={(evento) => setRetencion(evento.target.value)}
                  />
                  {!copiaConFecha && (
                    <span className="campo__ayuda">
                      No aplica cuando la copia sobrescribe la anterior.
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {error ? (
            <p className="formulario__error" role="alert">
              {error}
            </p>
          ) : (
            esMssql &&
            pasoActual.id === 'tipo' &&
            credencialesMssqlListas === true && (
              <p className="asistente__credenciales" role="status">
                <span aria-hidden="true">✓</span> Credenciales configuradas
              </p>
            )
          )}

          <div className="formulario__acciones formulario__acciones--asistente">
            <button
              type="button"
              className="boton boton--secundario"
              onClick={alCerrar}
              disabled={guardando}
            >
              Cancelar
            </button>

            <div className="asistente__navegacion">
              {indiceActual > 0 && (
                <button
                  type="button"
                  className="boton boton--secundario"
                  onClick={retroceder}
                  disabled={guardando}
                >
                  Atrás
                </button>
              )}
              <button type="submit" className="boton" disabled={guardando}>
                {esUltimoPaso
                  ? guardando
                    ? editando
                      ? 'Guardando…'
                      : 'Creando…'
                    : editando
                      ? 'Guardar cambios'
                      : 'Crear backup'
                  : 'Siguiente'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {basesDatosAbiertas && (
        <MssqlDatabasesModal
          seleccionadas={basesDatos}
          alCerrar={() => setBasesDatosAbiertas(false)}
          alConfirmar={(bases) => {
            setBasesDatos(bases);
            setError(null);
            setBasesDatosAbiertas(false);
          }}
        />
      )}

      {configuracionMssqlAbierta && (
        <MssqlConfigModal
          alCerrar={() => {
            setConfiguracionMssqlAbierta(false);

            // Al guardar (o cancelar) se vuelve a comprobar si ya hay credenciales.
            void (async () => {
              try {
                const resultado = await window.api.mssql.obtener();

                if (!resultado.ok) {
                  return;
                }

                const { servidor, usuario, tieneContrasena } = resultado.datos;
                const listas =
                  servidor.trim().length > 0 && usuario.trim().length > 0 && tieneContrasena;

                setCredencialesMssqlListas(listas);

                if (listas) {
                  setError(null);
                }
              } catch {
                setCredencialesMssqlListas(null);
              }
            })();
          }}
        />
      )}
    </>
  );
}
