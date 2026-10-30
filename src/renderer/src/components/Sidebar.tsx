import type { ComponentType } from 'react';
import './Sidebar.css';

interface SidebarProps {
  abierto: boolean;
  seccionActiva: string;
  version: string;
  alNavegar: (seccion: string) => void;
  alAbrirConfiguracion: () => void;
}

interface ItemNavegacion {
  id: string;
  etiqueta: string;
  Icono: ComponentType;
}

interface GrupoNavegacion {
  rotulo?: string;
  items: ItemNavegacion[];
}

function IconoPanel() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function IconoCopias() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 2.5h8.2L13.5 4.8V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 2.5v3.2h5V2.5M5.2 13.5V9.6h5.6v3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconoAjustes() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
      />
    </svg>
  );
}

function IconoInformes() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 13V9M8 13V4M13 13V6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Los grupos siguen las responsabilidades: operar, analizar y administrar.
const GRUPOS: GrupoNavegacion[] = [
  {
    items: [
      { id: 'seccion-panel', etiqueta: 'Panel de control', Icono: IconoPanel },
      { id: 'seccion-copias', etiqueta: 'Copias', Icono: IconoCopias },
    ],
  },
  {
    rotulo: 'Análisis',
    items: [{ id: 'seccion-informes', etiqueta: 'Informes', Icono: IconoInformes }],
  },
];

export function Sidebar({
  abierto,
  seccionActiva,
  version,
  alNavegar,
  alAbrirConfiguracion,
}: SidebarProps) {
  return (
    <aside
      id="navegacion-principal"
      className={`navegacion${abierto ? '' : ' navegacion--cerrada'}`}
      aria-label="Navegación principal"
      aria-hidden={!abierto}
      inert={!abierto}
    >
      <div className="navegacion__contenido">
        <nav>
          {GRUPOS.map((grupo, indice) => (
            <div key={grupo.rotulo ?? `grupo-${indice}`} className="navegacion__grupo">
              {grupo.rotulo && <p className="navegacion__rotulo">{grupo.rotulo}</p>}

              <ul className="navegacion__lista">
                {grupo.items.map(({ id, etiqueta, Icono }) => {
                  const activa = seccionActiva === id;

                  return (
                    <li key={etiqueta}>
                      <button
                        type="button"
                        className={`navegacion__enlace${activa ? ' navegacion__enlace--activo' : ''}`}
                        aria-current={activa ? 'page' : undefined}
                        onClick={() => alNavegar(id)}
                      >
                        <Icono />
                        {etiqueta}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="navegacion__pie">
          <button
            type="button"
            className="navegacion__enlace"
            onClick={alAbrirConfiguracion}
          >
            <IconoAjustes />
            Configuración
          </button>
          <p className="navegacion__version">BackupArc {version}</p>
        </div>
      </div>
    </aside>
  );
}
