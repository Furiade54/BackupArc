import './Sidebar.css';

interface SidebarProps {
  abierto: boolean;
  seccionActiva: string;
  version: string;
  alNavegar: (seccion: string) => void;
  alAbrirConfiguracion: () => void;
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

const SECCIONES = [
  { id: 'seccion-copias', etiqueta: 'Copias', Icono: IconoPanel },
  { id: 'seccion-informes', etiqueta: 'Informes', Icono: IconoInformes },
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
        <p className="navegacion__titulo">Secciones</p>

        <nav>
          <ul className="navegacion__lista">
            {SECCIONES.map(({ id, etiqueta, Icono }) => {
              const activa = seccionActiva === id;

              return (
                <li key={id}>
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
        </nav>

        <div className="navegacion__pie">
          <button
            type="button"
            className="navegacion__ajustes"
            aria-label="Abrir configuración avanzada"
            title="Configuración avanzada"
            onClick={alAbrirConfiguracion}
          >
            <IconoAjustes />
          </button>
          <p className="navegacion__version">BackupArc {version}</p>
        </div>
      </div>
    </aside>
  );
}
