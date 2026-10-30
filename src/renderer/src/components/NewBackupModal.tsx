import { Fragment, useId, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ConfiguracionMssql } from '../../../shared/types/api.types';
import type {
  ModoRespaldoMssql,
  RespaldoConfigurado,
  TipoRespaldo,
} from '../../../shared/types/respaldo.types';
import {
  formatearBasesDatos,
  parsearBasesDatos,
  serializarBasesDatos,
} from '../../../shared/utils/bases-datos';
import { formatearFrecuencia } from '../utils/formato';
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

type IdPaso = 'tipo' | 'ubicacion' | 'programacion' | 'opciones' | 'resumen';

const PASOS: { id: IdPaso; etiqueta: string }[] = [
  { id: 'tipo', etiqueta: 'Básico' },
  { id: 'ubicacion', etiqueta: 'Ubicación' },
  { id: 'programacion', etiqueta: 'Programación' },
  { id: 'opciones', etiqueta: 'Opciones' },
  { id: 'resumen', etiqueta: 'Resumen' },
];

// Icono "i" con el detalle en un globo flotante, fuera del scroll del modal.
function InfoGlobo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  const id = useId();
  const [globo, setGlobo] = useState<{ x: number; y: number; abajo: boolean } | null>(null);

  // Muestra el globo sobre el icono; si no cabe arriba, lo coloca debajo.
  const mostrar = (elemento: HTMLElement) => {
    const rect = elemento.getBoundingClientRect();
    const ancho = 300;
    const abajo = rect.top < 140;

    setGlobo({
      x: Math.min(Math.max(12, rect.left - 8), window.innerWidth - ancho - 12),
      y: abajo ? rect.bottom + 8 : rect.top - 8,
      abajo,
    });
  };

  return (
    <>
      <button
        type="button"
        className="campo__info"
        aria-label={etiqueta}
        aria-describedby={globo ? id : undefined}
        onMouseEnter={(evento) => mostrar(evento.currentTarget)}
        onMouseLeave={() => setGlobo(null)}
        onFocus={(evento) => mostrar(evento.currentTarget)}
        onBlur={() => setGlobo(null)}
      >
        i
      </button>
      {globo &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className={`campo__globo${globo.abajo ? ' campo__globo--abajo' : ''}`}
            style={{ left: globo.x, top: globo.y }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

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
  // Respalda todas las bases ONLINE en cada ejecución, incluidas las nuevas.
  const [todasLasBases, setTodasLasBases] = useState(respaldo?.todasLasBases ?? false);
  // Total de bases que ofrece el servidor, para expresar "N de M seleccionadas".
  const [totalBases, setTotalBases] = useState<number | null>(null);
  // La sección de almacenamiento temporal arranca plegada salvo que ya se use.
  const [temporalAbierta, setTemporalAbierta] = useState(respaldo?.usarCopiaTemporal ?? false);
  // Opciones avanzadas: siempre contraídas al entrar al paso, aunque la tarea
  // editada ya use compresión o verificación (el encabezado muestra "Activa").
  const [zipAbierto, setZipAbierto] = useState(false);
  const [verificacionAbierta, setVerificacionAbierta] = useState(false);
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
        if (!todasLasBases && basesDatos.length === 0) {
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

  const explorarCarpeta = async (campo: 'origen' | 'destino' | 'zip' | 'temporal') => {
    const rutaActual =
      campo === 'origen'
        ? origen
        : campo === 'destino'
          ? destino
          : campo === 'zip'
            ? carpetaZip
            : carpetaTemporal;
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
    } else if (campo === 'zip') {
      setCarpetaZip(resultado.datos);
    } else {
      setCarpetaTemporal(resultado.datos);
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
        todasLasBases: esMssql ? todasLasBases : false,
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

  // Texto del selector de bases: resumen corto y conteo siempre visible.
  const totalReferencia = totalBases ?? basesDatos.length;
  const textoBases = todasLasBases
    ? `Todas las bases (${basesDatos.length})`
    : formatearBasesDatos(serializarBasesDatos(basesDatos));
  const ayudaBases =
    basesDatos.length === 0
      ? 'Elige una, varias o todas las bases del servidor.'
      : todasLasBases
        ? `${basesDatos.length} de ${totalReferencia} seleccionadas · se respaldan las ONLINE en cada ejecución, incluidas las nuevas.`
        : `${basesDatos.length} de ${totalReferencia} seleccionadas.`;

  // Resumen que se muestra en el último paso, justo antes de guardar.
  const filasResumen: { etiqueta: string; valor: string; titulo?: string }[] = [
    { etiqueta: 'Tipo', valor: esMssql ? 'Base de datos MSSQL' : 'Archivos y carpetas' },
    { etiqueta: 'Nombre', valor: nombre.trim() || 'Sin definir' },
  ];

  if (esMssql) {
    filasResumen.push({
      etiqueta: 'Bases',
      valor: todasLasBases
        ? `Todas las ONLINE en cada ejecución (${basesDatos.length} ahora)`
        : formatearBasesDatos(serializarBasesDatos(basesDatos)) || 'Sin definir',
      titulo: todasLasBases ? undefined : basesDatos.join(', ') || undefined,
    });
    filasResumen.push({
      etiqueta: 'Ubicación del .bak',
      valor: destino.trim() || 'Sin definir',
      titulo: destino.trim() || undefined,
    });
    if (carpetaZip.trim()) {
      filasResumen.push({
        etiqueta: 'Carpeta del .zip',
        valor: carpetaZip.trim(),
        titulo: carpetaZip.trim(),
      });
    }
  } else {
    filasResumen.push({
      etiqueta: 'Carpeta de origen',
      valor: origen.trim() || 'Sin definir',
      titulo: origen.trim() || undefined,
    });
    filasResumen.push({
      etiqueta: 'Ubicación del backup',
      valor: destino.trim() || 'Sin definir',
      titulo: destino.trim() || undefined,
    });
  }

  filasResumen.push({
    etiqueta: 'Frecuencia',
    valor: usaHoraFija
      ? `${formatearFrecuencia(frecuenciaMinutos)}, a las ${hora}`
      : formatearFrecuencia(frecuenciaMinutos),
  });

  filasResumen.push({
    etiqueta: 'Nombre de la copia',
    valor: esMssql
      ? modoNombre === 'fecha'
        ? 'Con fecha y hora'
        : modoNombre === 'unica'
          ? 'Sin fecha, con identificador único'
          : 'Nombre fijo (sobrescribe el .bak)'
      : copiaConFecha
        ? 'Con fecha y hora'
        : 'Nombre fijo (sobrescribe la copia)',
  });

  filasResumen.push({
    etiqueta: 'Retención',
    valor: Number.isInteger(retencionDias) ? `${retencionDias} días` : 'Sin definir',
  });

  if (esMssql) {
    filasResumen.push({
      etiqueta: 'Modo',
      valor:
        modoMssql === 'diferencial'
          ? `Diferencial (full cada ${fullCadaDiasNumero} días)`
          : 'Completo en cada ejecución',
    });

    const adicionales: string[] = [];

    if (comprimirBak) {
      adicionales.push('comprime el .bak en .zip');
    }

    if (verificarBak) {
      adicionales.push('verifica el .bak al terminar');
    }

    if (usarCopiaTemporal) {
      adicionales.push('copia desde una carpeta temporal');
    }

    if (adicionales.length > 0) {
      filasResumen.push({ etiqueta: 'Adicionales', valor: adicionales.join(' · ') });
    }
  } else {
    filasResumen.push({
      etiqueta: 'Formato',
      valor: comprimir ? 'Archivo .zip' : 'Sin comprimir',
    });
  }

  return (
    <>
      <Modal
        titulo={editando ? 'Editar tarea de backup' : 'Nuevo backup'}
        clase="modal--asistente"
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
                  <>
                    <section className="seccion">
                      <div className="seccion__cabecera">
                        <span className="seccion__numero" aria-hidden="true">
                          1
                        </span>
                        <h3 className="seccion__titulo">Bases de datos</h3>
                      </div>
                      <div className="campo__ruta">
                        <input
                          id="backup-bases"
                          type="text"
                          aria-label="Bases de datos seleccionadas"
                          value={textoBases}
                          placeholder="Selecciona una o varias bases de datos"
                          title={todasLasBases ? 'Todas las bases' : basesDatos.join(', ')}
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
                      <span className="campo__ayuda">{ayudaBases}</span>
                    </section>

                    <section className="seccion">
                      <div className="seccion__cabecera">
                        <span className="seccion__numero" aria-hidden="true">
                          2
                        </span>
                        <h3 className="seccion__titulo">Almacenamiento del backup</h3>
                      </div>
                      <div className="campo">
                        <div className="campo__etiqueta">
                          <label htmlFor="backup-destino">Carpeta destino del .bak</label>
                          <InfoGlobo etiqueta="Qué ruta corresponde a cada operación">
                            Esta ruta la usa SQL Server en su propio disco: el .bak se escribe
                            allí, no en este equipo. Debe existir en el servidor y ser accesible
                            por su cuenta de servicio. La carpeta del .zip, en cambio, la escribe
                            esta app y puede estar en tu equipo o en una ruta de red.
                          </InfoGlobo>
                        </div>
                        <div className="campo__ruta">
                          <input
                            id="backup-destino"
                            type="text"
                            value={destino}
                            maxLength={500}
                            placeholder={
                              servidorMssqlRemoto
                                ? 'Ej. D:\\Backups (ruta del servidor)'
                                : 'Lugar donde se guardará la copia'
                            }
                            disabled={guardando}
                            onChange={(evento) => setDestino(evento.target.value)}
                          />
                          {!servidorMssqlRemoto && (
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
                        <span className="campo__ayuda">
                          {servidorMssqlRemoto
                            ? `Debe existir en ${conexionMssql?.servidor}, no en este equipo. Créala allí antes del primer respaldo.`
                            : 'Ruta tal como la ve SQL Server. Debe existir y ser accesible por la cuenta del servicio.'}
                        </span>
                      </div>
                    </section>

                    <section className="seccion">
                      <h3 className="seccion__titulo">
                        <button
                          type="button"
                          className="seccion__disparador"
                          aria-expanded={temporalAbierta}
                          aria-controls="backup-temporal"
                          onClick={() => setTemporalAbierta(!temporalAbierta)}
                        >
                          <span className="seccion__numero" aria-hidden="true">
                            3
                          </span>
                          <span className="seccion__texto">
                            Configuración de almacenamiento temporal
                          </span>
                          {usarCopiaTemporal && <span className="seccion__marca">Activa</span>}
                          <span
                            className={`seccion__flecha${
                              temporalAbierta ? ' seccion__flecha--abierta' : ''
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </h3>

                      {temporalAbierta && (
                        <div id="backup-temporal" className="seccion__cuerpo">
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
                            SQL escribe en una carpeta local del servidor y esta app copia el .bak
                            al destino. Útil cuando el servicio no puede escribir en el destino
                            (por ejemplo, un NAS en red).
                          </span>

                          {usarCopiaTemporal && (
                            <div className="campo">
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
                                {!servidorMssqlRemoto && (
                                  <button
                                    type="button"
                                    className="boton boton--secundario"
                                    disabled={guardando}
                                    onClick={() => void explorarCarpeta('temporal')}
                                  >
                                    Explorar
                                  </button>
                                )}
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
                                      onChange={(evento) =>
                                        setCarpetaTemporalLectura(evento.target.value)
                                      }
                                    />
                                  </div>
                                  <span className="campo__ayuda">
                                    Ruta UNC desde la que esta app lee el .bak temporal. Déjala
                                    vacía solo si la carpeta temporal es accesible desde este
                                    equipo; debe existir en el servidor y ser accesible por su
                                    cuenta de servicio.
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  </>
                ) : (
                  <>
                    <div className="campo">
                      <label htmlFor="backup-origen">Carpeta de origen</label>
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

                    <div className="campo">
                      <label htmlFor="backup-destino">Ubicación del backup</label>
                      <div className="campo__ruta">
                        <input
                          id="backup-destino"
                          type="text"
                          value={destino}
                          maxLength={500}
                          placeholder="Lugar donde se guardará la copia"
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
                    </div>
                  </>
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
                    </div>

                    <p className="campo__aviso" role="note">
                      Los .bak se guardan en el servidor SQL. La retención se aplica al terminar
                      cada respaldo; el más reciente y el full base de los diferenciales nunca se
                      eliminan.
                    </p>

                    <div className="avanzadas">
                      <h3 className="avanzadas__titulo">Opciones avanzadas</h3>

                      <section className="seccion">
                        <h3 className="seccion__titulo">
                          <button
                            type="button"
                            className="seccion__disparador"
                            aria-expanded={zipAbierto}
                            aria-controls="backup-compresion"
                            onClick={() => setZipAbierto(!zipAbierto)}
                          >
                            <span className="seccion__texto">Compresión ZIP</span>
                            {comprimirBak && <span className="seccion__marca">Activa</span>}
                            <span
                              className={`seccion__flecha${
                                zipAbierto ? ' seccion__flecha--abierta' : ''
                              }`}
                              aria-hidden="true"
                            />
                          </button>
                        </h3>

                        {zipAbierto && (
                          <div id="backup-compresion" className="seccion__cuerpo">
                            <label className="campo__casilla">
                              <input
                                type="checkbox"
                                checked={comprimirBak}
                                disabled={guardando}
                                onChange={(evento) => setComprimirBak(evento.target.checked)}
                              />
                              Comprimir el .bak en .zip
                            </label>
                            <span className="campo__ayuda">
                              El .zip usa el nombre de la base y se reemplaza en cada ejecución; el
                              .bak original se conserva.
                            </span>

                            {comprimirBak && (
                              <div className="campo">
                                <div className="campo__etiqueta">
                                  <label htmlFor="backup-carpeta-zip">
                                    Carpeta del .zip (opcional)
                                  </label>
                                  <InfoGlobo etiqueta="Por qué el .zip usa una ruta distinta">
                                    El .bak lo escribe SQL Server en el disco del servidor; el .zip
                                    lo escribe esta app en tu equipo. Separarlas permite dejar los
                                    .bak grandes en el servidor y los .zip en una carpeta local o
                                    de red, aplicar retenciones distintas y conservar el .bak
                                    intacto si la compresión falla.
                                  </InfoGlobo>
                                </div>
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
                                  Carpeta de este equipo donde la app escribe el .zip; puede ser una
                                  ruta de red (UNC). Si la dejas vacía, el .zip se guarda junto al
                                  .bak en el destino.
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </section>

                      <section className="seccion">
                        <h3 className="seccion__titulo">
                          <button
                            type="button"
                            className="seccion__disparador"
                            aria-expanded={verificacionAbierta}
                            aria-controls="backup-verificacion"
                            onClick={() => setVerificacionAbierta(!verificacionAbierta)}
                          >
                            <span className="seccion__texto">Verificación del backup</span>
                            {verificarBak && <span className="seccion__marca">Activa</span>}
                            <span
                              className={`seccion__flecha${
                                verificacionAbierta ? ' seccion__flecha--abierta' : ''
                              }`}
                              aria-hidden="true"
                            />
                          </button>
                        </h3>

                        {verificacionAbierta && (
                          <div id="backup-verificacion" className="seccion__cuerpo">
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
                              La verificación lee el archivo completo y puede alargar la ejecución.
                            </span>
                          </div>
                        )}
                      </section>
                    </div>
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
                        disabled={guardando}
                        onChange={(evento) => setRetencion(evento.target.value)}
                      />
                      {!copiaConFecha && (
                        <span className="campo__ayuda">
                          Las copias se sobrescriben, pero el historial de la tarea se depura con
                          estos días.
                        </span>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {pasoActual.id === 'resumen' && (
              <section className="resumen" aria-label="Resumen de la configuración">
                <dl className="resumen__lista">
                  {filasResumen.map((fila) => (
                    <Fragment key={fila.etiqueta}>
                      <dt className="resumen__etiqueta">{fila.etiqueta}</dt>
                      <dd className="resumen__valor" title={fila.titulo}>
                        {fila.valor}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </section>
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
          todas={todasLasBases}
          conexion={conexionMssql}
          respaldoId={respaldo?.id}
          alCerrar={() => setBasesDatosAbiertas(false)}
          alConfirmar={(bases, todas, total) => {
            setBasesDatos(bases);
            setTodasLasBases(todas);
            setTotalBases(total);
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
