import { useEffect, useMemo, useState } from 'react';
import type { BaseDatosMssql, ConfiguracionMssql } from '../../../shared/types/api.types';
import { Modal } from './Modal';
import './BackupModals.css';

interface MssqlDatabasesModalProps {
  seleccionadas: string[];
  conexion: ConfiguracionMssql | null;
  respaldoId?: number;
  alCerrar: () => void;
  alConfirmar: (bases: string[]) => void;
}

const ESTADO_DISPONIBLE = 'ONLINE';
const ESTADO_DESCONOCIDA = 'NO ENCONTRADA';

export function MssqlDatabasesModal({
  seleccionadas,
  conexion,
  respaldoId,
  alCerrar,
  alConfirmar,
}: MssqlDatabasesModalProps) {
  const [lista, setLista] = useState<BaseDatosMssql[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>(seleccionadas);
  const [filtro, setFiltro] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      try {
        const resultado = await window.api.mssql.basesDatos(conexion, respaldoId);

        if (cancelado) {
          return;
        }

        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }

        // Una base guardada que ya no existe se muestra igual para no
        // deseleccionarla sin que el usuario lo note.
        const desconocidas = seleccionadas
          .filter((nombre) => !resultado.datos.some((base) => base.nombre === nombre))
          .map((nombre) => ({ nombre, estado: ESTADO_DESCONOCIDA }));

        setLista([...resultado.datos, ...desconocidas]);
      } catch {
        if (!cancelado) {
          setError('No se pudo obtener la lista de bases de datos.');
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
  }, [seleccionadas, conexion, respaldoId, intento]);

  const disponibles = useMemo(
    () =>
      lista
        .filter((base) => base.estado === ESTADO_DISPONIBLE)
        .map((base) => base.nombre),
    [lista],
  );

  const visibles = useMemo(() => {
    const texto = filtro.trim().toLowerCase();

    return texto
      ? lista.filter((base) => base.nombre.toLowerCase().includes(texto))
      : lista;
  }, [lista, filtro]);

  const todasSeleccionadas =
    disponibles.length > 0 && disponibles.every((nombre) => seleccion.includes(nombre));

  const alternar = (nombre: string) => {
    setSeleccion((anterior) =>
      anterior.includes(nombre) ? anterior.filter((item) => item !== nombre) : [...anterior, nombre],
    );
  };

  const alternarTodas = () => {
    setSeleccion((anterior) =>
      todasSeleccionadas
        ? anterior.filter((nombre) => !disponibles.includes(nombre))
        : Array.from(new Set([...anterior, ...disponibles])),
    );
  };

  const reintentar = () => {
    setError(null);
    setCargando(true);
    setIntento((valor) => valor + 1);
  };

  return (
    <Modal titulo="Bases de datos" alCerrar={alCerrar} clase="modal--conexion">
      <div className="formulario">
        {cargando && <p className="conexion__resultado">Consultando el servidor…</p>}

        {!cargando && error && (
          <>
            <p className="formulario__error" role="alert">
              {error}
            </p>
            <div className="formulario__acciones">
              <button type="button" className="boton boton--secundario" onClick={alCerrar}>
                Cerrar
              </button>
              <button type="button" className="boton" onClick={reintentar}>
                Reintentar
              </button>
            </div>
          </>
        )}

        {!cargando && !error && (
          <>
            <div className="campo">
              <label htmlFor="bases-filtro">Buscar</label>
              <input
                id="bases-filtro"
                type="search"
                value={filtro}
                placeholder="Nombre de la base de datos"
                onChange={(evento) => setFiltro(evento.target.value)}
              />
            </div>

            <label className="selector-bd__todas">
              <input type="checkbox" checked={todasSeleccionadas} onChange={alternarTodas} />
              Seleccionar todas ({disponibles.length})
            </label>

            <ul className="selector-bd">
              {visibles.map((base) => {
                const disponible = base.estado === ESTADO_DISPONIBLE;

                return (
                  <li key={base.nombre}>
                    <label
                      className={`selector-bd__item${disponible ? '' : ' selector-bd__item--bloqueada'}`}
                    >
                      <input
                        type="checkbox"
                        checked={seleccion.includes(base.nombre)}
                        disabled={!disponible}
                        onChange={() => alternar(base.nombre)}
                      />
                      <span className="selector-bd__nombre">{base.nombre}</span>
                      {!disponible && <span className="selector-bd__estado">{base.estado}</span>}
                    </label>
                  </li>
                );
              })}

              {visibles.length === 0 && (
                <li className="selector-bd__vacio">No hay bases de datos que coincidan.</li>
              )}
            </ul>

            <span className="campo__ayuda">
              Solo se pueden respaldar las bases en estado ONLINE.
            </span>

            <div className="formulario__acciones">
              <button type="button" className="boton boton--secundario" onClick={alCerrar}>
                Cancelar
              </button>
              <button
                type="button"
                className="boton"
                disabled={seleccion.length === 0}
                onClick={() => alConfirmar([...seleccion].sort())}
              >
                Aplicar ({seleccion.length})
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
