import { useEffect, useState } from 'react';
import type {
  ClaveConfiguracionAvanzada,
  ConfiguracionAvanzada,
} from '../../../shared/types/api.types';
import './AdvancedSettings.css';

interface AdvancedSettingsProps {
  empaquetada: boolean;
}

interface OpcionAjuste {
  clave: ClaveConfiguracionAvanzada;
  titulo: string;
  descripcion: string;
  requiereInstalada?: boolean;
}

const OPCIONES: OpcionAjuste[] = [
  {
    clave: 'mantenerEnSegundoPlano',
    titulo: 'Mantener en segundo plano al cerrar',
    descripcion:
      'Si se cierra con la X, BackupArc sigue activo en la bandeja y las copias programadas se ejecutan.',
  },
  {
    clave: 'iniciarMinimizado',
    titulo: 'Iniciar minimizado',
    descripcion: 'Al abrir la aplicación, la ventana permanece oculta en la bandeja del sistema.',
  },
  {
    clave: 'siempreVisible',
    titulo: 'Siempre visible',
    descripcion: 'Mantiene la ventana por encima del resto de aplicaciones.',
  },
  {
    clave: 'iniciarConSistema',
    titulo: 'Cargar al iniciar el sistema',
    descripcion: 'Abre BackupArc automáticamente al iniciar sesión en Windows.',
    requiereInstalada: true,
  },
  {
    clave: 'mostrarAvisos',
    titulo: 'Mostrar avisos del sistema',
    descripcion:
      'Notifica cuando la aplicación pasa a segundo plano o cuando se intenta abrir una segunda instancia.',
  },
  {
    clave: 'buscarActualizaciones',
    titulo: 'Buscar actualizaciones periódicamente (recomendado)',
    descripcion:
      'Consulta GitHub Releases cada 6 horas y avisa cuando haya una versión nueva disponible.',
  },
];

export function AdvancedSettings({ empaquetada }: AdvancedSettingsProps) {
  const inicioAutomaticoSoportado = empaquetada && window.api.app.plataforma !== 'linux';
  const [configuracion, setConfiguracion] = useState<ConfiguracionAvanzada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState<ClaveConfiguracionAvanzada | null>(null);

  useEffect(() => {
    let activo = true;

    void window.api.configuracion
      .obtener()
      .then((resultado) => {
        if (!activo) {
          return;
        }

        if (resultado.ok) {
          setConfiguracion(resultado.datos);
        } else {
          setError(resultado.error);
        }
      })
      .catch(() => {
        if (activo) {
          setError('No se pudo cargar la configuración avanzada.');
        }
      });

    return () => {
      activo = false;
    };
  }, []);

  const alternar = async (clave: ClaveConfiguracionAvanzada, valor: boolean) => {
    setActualizando(clave);
    setError(null);

    try {
      const resultado = await window.api.configuracion.actualizar(clave, valor);

      if (resultado.ok) {
        setConfiguracion(resultado.datos);
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se pudo guardar la configuración.');
    } finally {
      setActualizando(null);
    }
  };

  if (!configuracion) {
    return (
      <div className="ajustes-avanzados">
        {error ? (
          <p className="formulario__error" role="alert">
            {error}
          </p>
        ) : (
          <p className="ajustes-avanzados__cargando">Cargando configuración…</p>
        )}
      </div>
    );
  }

  return (
    <div className="ajustes-avanzados">
      {error && (
        <p className="formulario__error" role="alert">
          {error}
        </p>
      )}

      <ul className="ajustes">
        {OPCIONES.map((opcion) => {
          const bloqueadaPorInstalacion =
            Boolean(opcion.requiereInstalada) && !inicioAutomaticoSoportado;
          const deshabilitado = bloqueadaPorInstalacion || actualizando !== null;

          return (
            <li key={opcion.clave} className="ajuste">
              <label
                className={`ajuste__etiqueta${bloqueadaPorInstalacion ? ' ajuste__etiqueta--bloqueada' : ''}`}
              >
                <span className="ajuste__texto">
                  <strong>{opcion.titulo}</strong>
                  <span>{opcion.descripcion}</span>
                  {bloqueadaPorInstalacion && (
                    <span className="ajuste__nota">
                      {empaquetada
                        ? 'No disponible en este sistema.'
                        : 'Disponible solo en la versión instalada.'}
                    </span>
                  )}
                </span>

                <span className="ajuste__control">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={configuracion[opcion.clave]}
                    disabled={deshabilitado}
                    onChange={(evento) => void alternar(opcion.clave, evento.target.checked)}
                  />
                  <span className="ajuste__pista" aria-hidden="true">
                    <span className="ajuste__perilla" />
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="ajustes-avanzados__nota">Los cambios se guardan automáticamente.</p>
    </div>
  );
}
