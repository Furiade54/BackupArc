import { useState, type FormEvent } from 'react';
import type { ConfiguracionMssql } from '../../../shared/types/api.types';
import type {
  ModoRespaldoMssql,
  RespaldoConfigurado,
  TipoRespaldo,
} from '../../../shared/types/respaldo.types';
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
  const [identificadorUnico, setIdentificadorUnico] = useState(
    respaldo?.identificadorUnico ?? true,
  );
  const [comprimir, setComprimir] = useState(respaldo?.comprimir ?? false);
  const [modoMssql, setModoMssql] = useState<ModoRespaldoMssql>(
    respaldo?.modoMssql ?? 'completo',
  );
  const [fullCadaDias, setFullCadaDias] = useState(String(respaldo?.fullCadaDias ?? 7));
  const [comprimirBak, setComprimirBak] = useState(respaldo?.comprimirBak ?? false);
  const [verificarBak, setVerificarBak] = useState(respaldo?.verificarBak ?? false);
  const [usarCopiaTemporal, setUsarCopiaTemporal] = useState(
    respaldo?.usarCopiaTemporal ?? false,
  );
  const [carpetaTemporal, setCarpetaTemporal] = useState(respaldo?.carpetaTemporal ?? '');
  const [carpetaTemporalLectura, setCarpetaTemporalLectura] = useState(
    respaldo?.carpetaTemporalLectura ?? '',
  );
  const [carpetaZip, setCarpetaZip] = useState(respaldo?.carpetaZip ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [indicePaso, setIndicePaso] = useState(0);
  const [basesDatos, setBasesDatos] = useState<string[]>(() =>
    respaldo?.tipo === 'mssql' ? parsearBasesDatos(respaldo.origen) : [],
  );
  const [basesDatosAbiertas, setBasesDatosAbiertas] = useState(false);
  const [configuracionMssqlAbierta, setConfiguracionMssqlAbierta] = useState(false);
  // Cada tarea guarda su propia conexión; no se hereda la de otra tarea.
  const [conexionMssql, setConexionMssql] = useState<ConfiguracionMssql | null>(() => {
    const resumen = respaldo?.conexionMssql;

    return resumen ? { ...resumen, contrasena: '' } : null;
  });
  const [tieneContrasenaMssql, setTieneContrasenaMssql] = useState(
    respaldo?.conexionMssql?.tieneContrasena ?? false,
  );

  const credencialesMssqlListas =
    conexionMssql !== null &&
    conexionMssql.servidor.trim().length > 0 &&
    conexionMssql.usuario.trim().length > 0 &&
    (tieneContrasenaMssql || conexionMssql.contrasena.length > 0);
  // El usuario indica en la conexión si el servidor es remoto; el explorador
  // de carpetas solo recorre este equipo, así que ahí no aplica.
  const servidorMssqlRemoto = conexionMssql?.esRemoto === true;

  const frecuenciaMinutos =
    frecuencia === VALOR_PERSONALIZADO ? Number(minutosPersonalizados) : Number(frecuencia);
  const usaHoraFija = frecuenciaMinutos >= MINUTOS_POR_DIA;
  const esMssql = tipo === 'mssql';
  const retencionDias = Number(retencion);
  const fullCadaDiasNumero = Number(fullCadaDias);
  // Tres modos visibles: con fecha, sin fecha pero único, o nombre fijo.
  const modoNombre = copiaConFecha ? 'fecha' : identificadorUnico ? 'unica' : 'fija';

  // En MSSQL el paso Opciones también aplica: modo, base full y verificación.
  const pasos = PASOS;
  const indiceActual = Math.min(indicePaso, pasos.length - 1);
  const pasoActual = pasos[indiceActual];
  const esUltimoPaso = indiceActual === pasos.length - 1;

  const validarPaso = (id: IdPaso): string | null => {
    if (id === 'tipo') {
      if (!nombre.trim()) {
        return 'Escribe un nombre para el backup.';
      }

      if (esMssql && !credencialesMssqlListas) {
        return 'Configura las credenciales de SQL Server con el engranaje antes de continuar.';
      }

      return null;
    }

    if (id === 'ubicacion') {
      if (esMssql) {
        if (basesDatos.length === 0) {
          return 'Selecciona al menos una base de datos con el botón Explorar.';
        }

        if (!destino.trim()) {
          return 'Indica la carpeta destino en el servidor SQL.';
        }

        return null;
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

    if (id === 'opciones') {
      if (esMssql) {
        if (
          !Number.isInteger(fullCadaDiasNumero) ||
          fullCadaDiasNumero < 1 ||
          fullCadaDiasNumero > 365
        ) {
          return 'La antigüedad máxima del full debe ser un entero entre 1 y 365 días.';
        }

        if (!Number.isInteger(retencionDias) || retencionDias < 1 || retencionDias > 3650) {
          return 'La retención debe ser un número entero entre 1 y 3650 días.';
        }

        return null;
      }

      if (!Number.isInteger(retencionDias) || retencionDias < 1 || retencionDias > 3650) {
        return 'La retención debe ser un número entero entre 1 y 3650 días.';
      }

      return null;
    }

    return null;
  };

  const explorarCarpeta = async (campo: 'origen' | 'destino' | 'zip') => {
    const rutaActual =
      campo === 'origen' ? origen : campo === 'destino' ? destino : carpetaZip;
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
    } else if (campo === 'destino') {
      setDestino(resultado.datos);
    } else {
      setCarpetaZip(resultado.datos);
    }
  };

  const abrirBasesDatos = () => {
    if (!credencialesMssqlListas) {
      setError(
        'Configura las credenciales de SQL Server con el engranaje antes de explorar las bases.',
      );
      return;
    }

    setError(null);
    setBasesDatosAbiertas(true);
  };

  const explorarArchivo = async () => {
    const resultado = await window.api.dialogos.seleccionarArchivo(origen.trim() || undefined);

    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }

    if (resultado.datos) {
      setOrigen(resultado.datos);
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
        conexionMssql: esMssql ? conexionMssql : null,
        destino: destino.trim(),
        frecuenciaMinutos,
        horaEjecucion: hora,
        retencionDias,
        copiaConFecha,
        identificadorUnico: esMssql ? identificadorUnico : true,
        comprimir: esMssql ? false : comprimir,
        modoMssql: esMssql ? modoMssql : 'completo',
        fullCadaDias: esMssql ? fullCadaDiasNumero : 7,
        comprimirBak: esMssql ? comprimirBak : false,
        verificarBak: esMssql ? verificarBak : false,
        usarCopiaTemporal: esMssql ? usarCopiaTemporal : false,
        carpetaTemporal: esMssql ? carpetaTemporal.trim() : '',
        carpetaTemporalLectura: esMssql ? carpetaTemporalLectura.trim() : '',
        carpetaZip: esMssql ? carpetaZip.trim() : '',
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
                          credencialesMssqlListas ? '' : ' campo__configurar--pendiente'
                        }`}
                        title={
                          credencialesMssqlListas
                            ? 'Configurar la conexión de este servidor'
                            : 'Faltan las credenciales del servidor: haz clic aquí para configurarlas'
                        }
                        aria-label={
                          credencialesMssqlListas
                            ? 'Configurar la conexión de SQL Server'
                            : 'Faltan las credenciales del servidor. Configurar SQL Server'
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
                        onClick={abrirBasesDatos}
                      />
                      <button
                        type="button"
                        className="boton boton--secundario"
                        disabled={guardando}
                        onClick={abrirBasesDatos}
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
                        title="Seleccionar una carpeta"
                        disabled={guardando}
                        onClick={() => void explorarCarpeta('origen')}
                      >
                        Carpeta
                      </button>
                      <button
                        type="button"
                        className="boton boton--secundario"
                        title="Seleccionar un archivo"
                        disabled={guardando}
                        onClick={() => void explorarArchivo()}
                      >
                        Archivo
                      </button>
                    </div>
                    <span className="campo__ayuda">
                      Elige una carpeta completa o un archivo suelto; también puedes escribir la
                      ruta.
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
                      placeholder={
                        esMssql && servidorMssqlRemoto
                          ? 'Ej. D:\\Backups (ruta del servidor)'
                          : 'Lugar donde se guardará la copia'
                      }
                      disabled={guardando}
                      onChange={(evento) => setDestino(evento.target.value)}
                    />
                    {(!esMssql || !servidorMssqlRemoto) && (
                      <button
                        type="button"
                        className="boton boton--secundario"
                        disabled={guardando}
                        onClick={() => void explorarCarpeta('destino')}
                      >
                        Explorar
                      </button>
                    )}
                  </div>
                  {esMssql &&
                    (servidorMssqlRemoto ? (
                      <p className="campo__aviso" role="note">
                        <strong>Servidor remoto:</strong> esta carpeta debe existir en{' '}
                        <strong>{conexionMssql?.servidor}</strong>, no en este equipo. Escríbela tal
                        como la ve el servidor SQL (por ejemplo <code>D:\Backups</code>) y créala
                        allí antes del primer respaldo. Por eso aquí no aparece el botón Explorar.
                      </p>
                    ) : (
                      <span className="campo__ayuda">
                        Ruta tal como la ve el servidor SQL. Debe existir y ser accesible por la
                        cuenta del servicio.
                      </span>
                    ))}
                </div>

                {esMssql && (
                  <div className="campo">
                    <label className="campo__casilla">
                      <input
                        type="checkbox"
                        checked={usarCopiaTemporal}
                        disabled={guardando}
                        onChange={(evento) => setUsarCopiaTemporal(evento.target.checked)}
                      />
                      Respaldar a una carpeta temporal y luego copiar al destino
                    </label>
                    <span className="campo__ayuda">
                      SQL escribe en una carpeta local del servidor y esta app copia el .bak a la
                      carpeta destino. Útil cuando SQL Server no tiene permisos para escribir
                      directamente en el destino (por ejemplo, un NAS en red).
                    </span>

                    {usarCopiaTemporal && (
                      <>
                        <label htmlFor="backup-carpeta-temporal">
                          Carpeta temporal (opcional)
                        </label>
                        <div className="campo__ruta">
                          <input
                            id="backup-carpeta-temporal"
                            type="text"
                            value={carpetaTemporal}
                            maxLength={500}
                            placeholder="Carpeta de backup predeterminada del servidor SQL"
                            disabled={guardando}
                            onChange={(evento) => setCarpetaTemporal(evento.target.value)}
                          />
                        </div>
                        <span className="campo__ayuda">
                          {carpetaTemporal.trim()
                            ? 'Ruta donde SQL Server escribirá el .bak intermedio.'
                            : 'Si lo dejas vacío se usará la carpeta de backup predeterminada de la instancia MSSQL.'}
                        </span>

                        {servidorMssqlRemoto && (
                          <>
                            <label htmlFor="backup-carpeta-temporal-lectura">
                              Ruta de lectura (opcional)
                            </label>
                            <div className="campo__ruta">
                              <input
                                id="backup-carpeta-temporal-lectura"
                                type="text"
                                value={carpetaTemporalLectura}
                                maxLength={500}
                                placeholder="Ej. \\AVES2023\BackupArc\Temp"
                                disabled={guardando}
                                onChange={(evento) => setCarpetaTemporalLectura(evento.target.value)}
                              />
                            </div>
                            <span className="campo__ayuda">
                              Ruta UNC desde la que esta app lee el .bak temporal. Déjala vacía
                              solo si la carpeta temporal es accesible desde este equipo.
                            </span>
                            <span className="campo__ayuda">
                              La carpeta temporal debe existir en el servidor SQL y ser accesible
                              por su cuenta de servicio.
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
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
                    value={esMssql ? modoNombre : copiaConFecha ? 'fecha' : 'unica'}
                    disabled={guardando}
                    onChange={(evento) => {
                      const valor = evento.target.value;
                      setCopiaConFecha(valor === 'fecha');
                      setIdentificadorUnico(valor !== 'fija');
                    }}
                  >
                    <option value="fecha">Con fecha y hora (Documentos_20261022131100)</option>
                    <option value="unica">
                      {esMssql
                        ? 'Sin fecha en el nombre (sigue siendo único)'
                        : 'Sin fecha (sobrescribe la copia anterior)'}
                    </option>
                    {esMssql && (
                      <option value="fija">Nombre fijo (sobrescribe el .bak anterior)</option>
                    )}
                  </select>
                  <span className="campo__ayuda">
                    {esMssql
                      ? modoNombre === 'fecha'
                        ? 'Cada ejecución crea un .bak nuevo con fecha, tipo (full/diff) e identificador único.'
                        : modoNombre === 'unica'
                          ? 'El .bak se nombra sin fecha; el tipo y un identificador único evitan que se sobrescriba.'
                          : 'Sin identificador único: el .bak toma un nombre fijo por base y tipo y se reemplaza en cada ejecución. Un diferencial anterior ya no podrá restaurarse.'
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
                {esMssql ? (
                  <>
                    <div className="campo">
                      <label htmlFor="backup-modo">Modo del backup</label>
                      <select
                        id="backup-modo"
                        value={modoMssql}
                        disabled={guardando}
                        onChange={(evento) =>
                          setModoMssql(evento.target.value as ModoRespaldoMssql)
                        }
                      >
                        <option value="completo">Completo en cada ejecución</option>
                        <option value="diferencial">Diferencial sobre un full base</option>
                      </select>
                      <span className="campo__ayuda">
                        {modoMssql === 'diferencial'
                          ? 'Solo se guardan los cambios desde el último full. Si no hay un full válido, la app lo genera automáticamente.'
                          : 'Cada ejecución guarda la base completa en un .bak.'}
                      </span>
                    </div>

                    {modoMssql === 'diferencial' && (
                      <div className="campo">
                        <label htmlFor="backup-full-dias">Antigüedad máxima del full (días)</label>
                        <input
                          id="backup-full-dias"
                          type="number"
                          min={1}
                          max={365}
                          step={1}
                          value={fullCadaDias}
                          disabled={guardando}
                          onChange={(evento) => setFullCadaDias(evento.target.value)}
                        />
                        <span className="campo__ayuda">
                          Si el full base supera estos días, la siguiente ejecución genera un full
                          nuevo. No es la frecuencia de la tarea.
                        </span>
                      </div>
                    )}

                    <div className="campo">
                      <label htmlFor="backup-retencion-mssql">Retención de los respaldos (días)</label>
                      <input
                        id="backup-retencion-mssql"
                        type="number"
                        min={1}
                        max={3650}
                        step={1}
                        value={retencion}
                        disabled={guardando}
                        onChange={(evento) => setRetencion(evento.target.value)}
                      />
                      <span className="campo__ayuda">
                        Al terminar cada respaldo se eliminan de la carpeta destino los .bak y .zip
                        con antigüedad mayor. Siempre se conserva el respaldo más reciente de cada
                        base y el full que usan los diferenciales.
                      </span>
                    </div>

                    <div className="campo__casillas">
                      <label className="campo__casilla">
                        <input
                          type="checkbox"
                          checked={comprimirBak}
                          disabled={guardando}
                          onChange={(evento) => setComprimirBak(evento.target.checked)}
                        />
                        Comprimir el .bak en .zip
                      </label>

                      <label className="campo__casilla">
                        <input
                          type="checkbox"
                          checked={verificarBak}
                          disabled={guardando}
                          onChange={(evento) => setVerificarBak(evento.target.checked)}
                        />
                        Verificar el .bak al terminar (RESTORE VERIFYONLY)
                      </label>

                      <span className="campo__ayuda">
                        La verificación lee el archivo completo y puede alargar la ejecución. El
                        .zip usa el nombre de la base y se reemplaza en cada ejecución; el .bak
                        original se conserva.
                      </span>
                    </div>

                    {comprimirBak && (
                      <div className="campo">
                        <label htmlFor="backup-carpeta-zip">Carpeta del .zip (opcional)</label>
                        <div className="campo__ruta">
                          <input
                            id="backup-carpeta-zip"
                            type="text"
                            value={carpetaZip}
                            maxLength={500}
                            placeholder="Vacío = misma carpeta destino"
                            disabled={guardando}
                            onChange={(evento) => setCarpetaZip(evento.target.value)}
                          />
                          <button
                            type="button"
                            className="boton boton--secundario"
                            disabled={guardando}
                            onClick={() => void explorarCarpeta('zip')}
                          >
                            Explorar
                          </button>
                        </div>
                        <span className="campo__ayuda">
                          Carpeta de este equipo donde la app escribe el .zip; puede ser una ruta de
                          red (UNC). Si la dejas vacía, el .zip se guarda junto al .bak en el
                          destino.
                        </span>
                      </div>
                    )}

                    <p className="campo__aviso" role="note">
                      Los .bak se guardan en el servidor SQL. La retención se aplica al terminar
                      cada respaldo; el más reciente y el full base de los diferenciales nunca se
                      eliminan.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="campo">
                      <label htmlFor="backup-formato">Formato del destino</label>
                      <select
                        id="backup-formato"
                        value={comprimir ? 'zip' : 'carpeta'}
                        disabled={guardando}
                        onChange={(evento) => setComprimir(evento.target.value === 'zip')}
                      >
                        <option value="carpeta">Sin comprimir</option>
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
            credencialesMssqlListas && (
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
          conexion={conexionMssql}
          respaldoId={respaldo?.id}
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
          inicial={conexionMssql}
          tieneContrasena={tieneContrasenaMssql}
          respaldoId={respaldo?.id}
          alCerrar={() => setConfiguracionMssqlAbierta(false)}
          alGuardar={(datos) => {
            setConexionMssql(datos);

            if (datos.contrasena) {
              setTieneContrasenaMssql(true);
            }

            setError(null);
            setConfiguracionMssqlAbierta(false);
          }}
        />
      )}
    </>
  );
}
