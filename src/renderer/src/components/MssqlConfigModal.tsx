import { useEffect, useState } from 'react';
import type { ConfiguracionMssql } from '../../../shared/types/api.types';
import { Modal } from './Modal';
import './BackupModals.css';

interface MssqlConfigModalProps {
  alCerrar: () => void;
}

export function MssqlConfigModal({ alCerrar }: MssqlConfigModalProps) {
  const [servidor, setServidor] = useState('');
  const [puerto, setPuerto] = useState('1433');
  const [baseDatos, setBaseDatos] = useState('master');
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [cifrado, setCifrado] = useState(false);
  const [confiarCertificado, setConfiarCertificado] = useState(true);
  const [tieneContrasena, setTieneContrasena] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      try {
        const resultado = await window.api.mssql.obtener();

        if (cancelado) {
          return;
        }

        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }

        setServidor(resultado.datos.servidor);
        setPuerto(String(resultado.datos.puerto));
        setBaseDatos(resultado.datos.baseDatos);
        setUsuario(resultado.datos.usuario);
        setCifrado(resultado.datos.cifrado);
        setConfiarCertificado(resultado.datos.confiarCertificado);
        setTieneContrasena(resultado.datos.tieneContrasena);
      } catch {
        if (!cancelado) {
          setError('No se pudo leer la configuración de SQL Server.');
        }
      } finally {
        if (!cancelado) {
          setCargando(false);
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const recolectar = (): ConfiguracionMssql => ({
    servidor: servidor.trim(),
    puerto: Number(puerto),
    baseDatos: baseDatos.trim() || 'master',
    usuario: usuario.trim(),
    contrasena,
    cifrado,
    confiarCertificado,
  });

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
    setPrueba(null);

    try {
      const resultado = await window.api.mssql.probar(recolectar());

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      setPrueba({
        ok: resultado.datos.ok,
        mensaje: resultado.datos.version
          ? `${resultado.datos.mensaje} ${resultado.datos.version}`
          : resultado.datos.mensaje,
      });
    } catch {
      setPrueba({ ok: false, mensaje: 'No se pudo probar la conexión.' });
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
    setPrueba(null);

    try {
      // Solo se guardan credenciales que ya lograron conectar.
      const comprobacion = await window.api.mssql.probar(recolectar());

      if (!comprobacion.ok) {
        setError(comprobacion.error);
        return;
      }

      if (!comprobacion.datos.ok) {
        setPrueba({ ok: false, mensaje: comprobacion.datos.mensaje });
        return;
      }

      const resultado = await window.api.mssql.guardar(recolectar());

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      alCerrar();
    } catch {
      setError('No se pudo guardar la configuración.');
    } finally {
      setGuardando(false);
    }
  };

  const ocupado = guardando || probando || cargando;

  return (
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
              onChange={(evento) => setServidor(evento.target.value)}
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
            Solo se usa para conectar; la base a respaldar se indica en cada tarea.
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

        {prueba && (
          <p className={`conexion__resultado conexion__resultado--${prueba.ok ? 'ok' : 'error'}`} role="status">
            {prueba.mensaje}
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
  );
}
