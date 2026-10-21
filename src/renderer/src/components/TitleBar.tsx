import { useEffect, useState } from 'react';
import logoUrl from '../../../../assets/icons/png/64.png';
import './TitleBar.css';

interface TitleBarProps {
  plataforma: string;
  titulo: string;
  menuAbierto: boolean;
  buscandoActualizacion: boolean;
  alAlternarMenu: () => void;
  alCrearCopia: () => void;
  alBuscarActualizaciones: () => void;
}

function IconoMenu({ abierto }: { abierto: boolean }) {
  if (abierto) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconoAgregar() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconoActualizar() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M13.5 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconoMinimizar() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function IconoMaximizar() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function IconoRestaurar() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M3 3V1h6v6H7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function IconoCerrar() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function TitleBar({
  plataforma,
  titulo,
  menuAbierto,
  buscandoActualizacion,
  alAlternarMenu,
  alCrearCopia,
  alBuscarActualizaciones,
}: TitleBarProps) {
  const esMac = plataforma === 'darwin';
  const [maximizada, setMaximizada] = useState(false);

  useEffect(() => {
    let activo = true;

    void window.api.ventana
      .estado()
      .then((estado) => {
        if (activo) {
          setMaximizada(estado.maximizada);
        }
      })
      .catch(() => {
        if (activo) {
          setMaximizada(false);
        }
      });

    const quitarSuscripcion = window.api.ventana.alCambiarEstado((estado) => {
      setMaximizada(estado.maximizada);
    });

    return () => {
      activo = false;
      quitarSuscripcion();
    };
  }, []);

  const minimizar = () => {
    void window.api.ventana.minimizar();
  };

  const alternarMaximizado = () => {
    void window.api.ventana.alternarMaximizado();
  };

  const cerrar = () => {
    void window.api.ventana.cerrar();
  };

  return (
    <header
      className={`barra-titulo${esMac ? ' barra-titulo--mac' : ''}`}
      onDoubleClick={esMac ? undefined : alternarMaximizado}
    >
      <div className="barra-titulo__izquierda">
        <button
          type="button"
          className="barra-titulo__menu"
          aria-label={menuAbierto ? 'Ocultar menú lateral' : 'Mostrar menú lateral'}
          aria-expanded={menuAbierto}
          aria-controls="navegacion-principal"
          aria-keyshortcuts="Control+B Meta+B"
          title={menuAbierto ? 'Ocultar menú (Ctrl+B)' : 'Mostrar menú (Ctrl+B)'}
          onClick={alAlternarMenu}
          onDoubleClick={(evento) => evento.stopPropagation()}
        >
          <IconoMenu abierto={menuAbierto} />
        </button>

        <div className="barra-titulo__marca">
          <span className="barra-titulo__logo" aria-hidden="true">
            <img src={logoUrl} alt="" draggable={false} />
          </span>
          <span className="barra-titulo__nombre">
            BackupArc <span>2.0</span>
          </span>
        </div>
      </div>

      <div className="barra-titulo__centro" title={titulo}>
        {titulo}
      </div>

      <div className="barra-titulo__acciones">
        <button
          type="button"
          className="barra-titulo__accion"
          aria-label="Buscar actualizaciones"
          title="Buscar actualizaciones"
          aria-busy={buscandoActualizacion}
          disabled={buscandoActualizacion}
          onClick={alBuscarActualizaciones}
          onDoubleClick={(evento) => evento.stopPropagation()}
        >
          <span className={buscandoActualizacion ? 'barra-titulo__girando' : undefined}>
            <IconoActualizar />
          </span>
        </button>

        <button
          type="button"
          className="barra-titulo__accion"
          aria-label="Nuevo backup"
          title="Nuevo backup"
          onClick={alCrearCopia}
          onDoubleClick={(evento) => evento.stopPropagation()}
        >
          <IconoAgregar />
        </button>

        {!esMac && (
          <div
            className="barra-titulo__controles"
            role="group"
            aria-label="Controles de ventana"
            onDoubleClick={(evento) => evento.stopPropagation()}
          >
            <button
              type="button"
              className="barra-titulo__control"
              aria-label="Minimizar ventana"
              title="Minimizar"
              onClick={minimizar}
            >
              <IconoMinimizar />
            </button>
            <button
              type="button"
              className="barra-titulo__control"
              aria-label={maximizada ? 'Restaurar ventana' : 'Maximizar ventana'}
              title={maximizada ? 'Restaurar' : 'Maximizar'}
              onClick={alternarMaximizado}
            >
              {maximizada ? <IconoRestaurar /> : <IconoMaximizar />}
            </button>
            <button
              type="button"
              className="barra-titulo__control barra-titulo__control--cerrar"
              aria-label="Cerrar ventana"
              title="Cerrar"
              onClick={cerrar}
            >
              <IconoCerrar />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
