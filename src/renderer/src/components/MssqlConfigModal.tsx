import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConfiguracionMssql } from '../../../shared/types/api.types';
import { pareceServidorRemoto } from '../../../shared/utils/servidor-mssql';
import { Modal } from './Modal';
import './BackupModals.css';

interface MssqlConfigModalProps {
  inicial: ConfiguracionMssql | null;
  tieneContrasena: boolean;
  respaldoId?: number;
  alCerrar: () => void;
  alGuardar: (datos: ConfiguracionMssql) => void;
}

export function MssqlConfigModal({
  inicial,
  tieneContrasena,
  respaldoId,
  alCerrar,
  alGuardar,
}: MssqlConfigModalProps) {
  const [servidor, setServidor] = useState(inicial?.servidor ?? '');
  const [puerto, setPuerto] = useState(String(inicial?.puerto ?? 1433));
  const [baseDatos, setBaseDatos] = useState(inicial?.baseDatos ?? 'master');
  const [usuario, setUsuario] = useState(inicial?.usuario ?? '');
  const [contrasena, setContrasena] = useState('');
  const [cifrado, setCifrado] = useState(inicial?.cifrado ?? false);
  const [confiarCertificado, setConfiarCertificado] = useState(
    inicial?.confiarCertificado ?? true,
  );
  // La ubicación la define el usuario; mientras no la toque se propone según el host.
  const [esRemoto, setEsRemoto] = useState(inicial?.esRemoto ?? false);
  const [ubicacionElegida, setUbicacionElegida] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [errorPrueba, setErrorPrueba] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Conexión exitosa: se muestra como aviso flotante, fuera del formulario.
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!aviso) {
      return;
    }

    const temporizador = setTimeout(() => setAviso(null), 7000);

    return () => clearTimeout(temporizador);
  }, [aviso]);

  const recolectar = (): ConfiguracionMssql => ({
    servidor: servidor.trim(),
    puerto: Number(puerto),
    baseDatos: baseDatos.trim() || 'master',
    usuario: usuario.trim(),
    contrasena,
    cifrado,
    confiarCertificado,
    esRemoto,
  });

  const cambiarServidor = (valor: string) => {
    setServidor(valor);

    if (!ubicacionElegida) {
      setEsRemoto(pareceServidorRemoto(valor));
    }
  };

  const validar = (): string | null => {
    if (!servidor.trim()) {
      return 'Indica el servidor (IP o nombre).';
    }

    if (!usuario.trim()) {
      return 'Indica el usuario de SQL Server.';
    }

    if (!contrasena && !tieneContrasena) {
      return 'Indica la contraseña.';
    }

    const numeroPuerto = Number(puerto);

    if (!Number.isInteger(numeroPuerto) || numeroPuerto < 1 || numeroPuerto > 65_535) {
      return 'El puerto debe ser un número entero entre 1 y 65535.';
    }

    return null;
  };

  const probar = async () => {
    const problema = validar();

    if (problema) {
      setError(problema);
      return;
    }

    setProbando(true);
    setError(null);
    setErrorPrueba(null);
    setAviso(null);

    try {
      const resultado = await window.api.mssql.probar(recolectar(), respaldoId);

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      const mensaje = resultado.datos.version
        ? `${resultado.datos.mensaje} ${resultado.datos.version}`
        : resultado.datos.mensaje;

      if (resultado.datos.ok) {
        // Éxito: aviso flotante en la esquina, no dentro del formulario.
        setAviso(mensaje);
      } else {
        setErrorPrueba(mensaje);
      }
    } catch {
      setErrorPrueba('No se pudo probar la conexión.');
    } finally {
      setProbando(false);
    }
  };

  const guardar = async () => {
    const problema = validar();

    if (problema) {
      setError(problema);
      return;
    }

    setGuardando(true);
    setError(null);
    setErrorPrueba(null);

    try {
      // Solo se guardan credenciales que ya lograron conectar.
      const comprobacion = await window.api.mssql.probar(recolectar(), respaldoId);

      if (!comprobacion.ok) {
        setError(comprobacion.error);
        return;
      }

      if (!comprobacion.datos.ok) {
        setErrorPrueba(comprobacion.datos.mensaje);
        return;
      }

      alGuardar(recolectar());
    } catch {
      setError('No se pudo guardar la configuración.');
    } finally {
      setGuardando(false);
    }
  };

  const ocupado = guardando || probando;

  return (
    <>
      <Modal titulo="Conexión SQL Server" alCerrar={alCerrar} clase="modal--conexion">
      <div className="formulario">
        <div className="formulario__fila">
          <div className="campo">
            <label htmlFor="mssql-servidor">Servidor</label>
            <input
              id="mssql-servidor"
              type="text"
              value={servidor}
              maxLength={200}
              placeholder="192.168.1.10 o MI-SERVIDOR"
              autoFocus
              disabled={ocupado}
              onChange={(evento) => cambiarServidor(evento.target.value)}
            />
          </div>

          <div className="campo">
            <label htmlFor="mssql-puerto">Puerto</label>
            <input
              id="mssql-puerto"
              type="number"
              min={1}
              max={65535}
              step={1}
              value={puerto}
              disabled={ocupado}
              onChange={(evento) => setPuerto(evento.target.value)}
            />
          </div>
        </div>

        <div className="campo">
          <label htmlFor="mssql-ubicacion">Ubicación del servidor</label>
          <select
            id="mssql-ubicacion"
            value={esRemoto ? 'remoto' : 'local'}
            disabled={ocupado}
            onChange={(evento) => {
              setUbicacionElegida(true);
              setEsRemoto(evento.target.value === 'remoto');
            }}
          >
            <option value="local">Local (SQL Server en este equipo)</option>
            <option value="remoto">Remoto (SQL Server en otro equipo)</option>
          </select>
          <span className="campo__ayuda">
            {esRemoto
              ? 'La carpeta destino del respaldo debe existir en ese servidor, no en este equipo. Por eso no se ofrece el explorador de carpetas.'
              : 'SQL Server corre en este equipo, así que la carpeta destino también es local y se puede elegir con el explorador.'}
          </span>
        </div>

        <div className="campo">
          <label htmlFor="mssql-base-datos">Base de datos de conexión</label>
          <input
            id="mssql-base-datos"
            type="text"
            value={baseDatos}
            maxLength={128}
            placeholder="master"
            disabled={ocupado}
            onChange={(evento) => setBaseDatos(evento.target.value)}
          />
          <span className="campo__ayuda">
            Solo se usa para conectar; las bases a respaldar se indican en cada tarea.
          </span>
        </div>

        <div className="campo">
          <label htmlFor="mssql-usuario">Usuario</label>
          <input
            id="mssql-usuario"
            type="text"
            value={usuario}
            maxLength={200}
            placeholder="sa"
            disabled={ocupado}
            onChange={(evento) => setUsuario(evento.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="mssql-contrasena">Contraseña</label>
          <input
            id="mssql-contrasena"
            type="password"
            value={contrasena}
            maxLength={500}
            placeholder={tieneContrasena ? '•••••••• (sin cambios)' : ''}
            disabled={ocupado}
            onChange={(evento) => setContrasena(evento.target.value)}
          />
        </div>

        <div className="campo__casillas">
          <label className="campo__casilla">
            <input
              type="checkbox"
              checked={cifrado}
              disabled={ocupado}
              onChange={(evento) => setCifrado(evento.target.checked)}
            />
            Cifrar la conexión (encrypt)
          </label>

          <label className="campo__casilla">
            <input
              type="checkbox"
              checked={confiarCertificado}
              disabled={ocupado}
              onChange={(evento) => setConfiarCertificado(evento.target.checked)}
            />
            Confiar en el certificado del servidor (trustServerCertificate)
          </label>

          <span className="campo__ayuda">
            Marca la confianza del certificado cuando el servidor use un certificado autofirmado.
          </span>
        </div>

        {errorPrueba && (
          <p className="conexion__resultado conexion__resultado--error" role="alert">
            {errorPrueba}
          </p>
        )}

        {error && (
          <p className="formulario__error" role="alert">
            {error}
          </p>
        )}

        <div className="formulario__acciones">
          <button
            type="button"
            className="boton boton--secundario"
            onClick={() => void probar()}
            disabled={ocupado}
          >
            {probando ? 'Probando…' : 'Probar conexión'}
          </button>
          <button type="button" className="boton" onClick={() => void guardar()} disabled={ocupado}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
      </Modal>

      {aviso &&
        createPortal(
          <div className="toast" role="status" aria-live="polite">
            <span className="toast__icono" aria-hidden="true">
              ✓
            </span>
            <p className="toast__mensaje">{aviso}</p>
            <button
              type="button"
              className="toast__cerrar"
              aria-label="Cerrar aviso"
              title="Cerrar"
              onClick={() => setAviso(null)}
            >
              ×
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
