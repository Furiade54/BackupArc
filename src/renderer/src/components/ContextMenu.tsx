import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export type TipoOpcionMenu =
  | 'ejecutar'
  | 'editar'
  | 'historial'
  | 'pausar'
  | 'activar'
  | 'eliminar'
  | 'nuevo'
  | 'informes'
  | 'actualizar'
  | 'configuracion';

export interface OpcionMenu {
  tipo: TipoOpcionMenu;
  etiqueta: string;
  separadorAntes?: boolean;
  alSeleccionar: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  opciones: OpcionMenu[];
  /** Se anuncia a los lectores de pantalla al enfocar el menú. */
  descripcion?: string;
  alCerrar: () => void;
}

const MARGEN_VENTANA = 8;

function Icono({ tipo }: { tipo: TipoOpcionMenu }) {
  if (tipo === 'ejecutar') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6.6 5.6 10.2 8l-3.6 2.4z" fill="currentColor" />
      </svg>
    );
  }

  if (tipo === 'nuevo') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }

  if (tipo === 'informes') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M3.5 12.5V8M8 12.5V4M12.5 12.5V6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (tipo === 'actualizar') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M13 8a5 5 0 1 1-1.5-3.6M13 3v3h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tipo === 'configuracion') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M3 5.5h10M3 10.5h10M6.4 3.4v4.2M9.6 8.4v4.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (tipo === 'editar') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M11.2 2.6l2.2 2.2-8.1 8.1-2.9.7.7-2.9z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tipo === 'historial') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 4.2V8l2.6 1.6M13 8a5 5 0 1 1-1.5-3.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tipo === 'pausar') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 3.5v9M10.5 3.5v9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }

  if (tipo === 'activar') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 3.5 12 8l-6.5 4.5z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 4h10M6 4V2.5h4V4M4.5 4l.6 9.5h5.8l.6-9.5M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ContextMenu({ x, y, opciones, descripcion, alCerrar }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [posicion, setPosicion] = useState<{ x: number; y: number } | null>(null);
  const alCerrarRef = useRef(alCerrar);
  alCerrarRef.current = alCerrar;

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    const { width, height } = menu.getBoundingClientRect();
    const izquierda = Math.max(
      MARGEN_VENTANA,
      Math.min(x, window.innerWidth - width - MARGEN_VENTANA),
    );
    const arriba = Math.max(
      MARGEN_VENTANA,
      Math.min(y, window.innerHeight - height - MARGEN_VENTANA),
    );

    setPosicion({ x: izquierda, y: arriba });
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);

  useEffect(() => {
    const alCerrarExterno = (evento: MouseEvent) => {
      if (!menuRef.current?.contains(evento.target as Node)) {
        alCerrarRef.current();
      }
    };

    const alPresionarTecla = (evento: KeyboardEvent) => {
      const menu = menuRef.current;

      if (!menu) {
        return;
      }

      if (evento.key === 'Escape') {
        evento.preventDefault();
        evento.stopPropagation();
        alCerrarRef.current();
        return;
      }

      if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp' && evento.key !== 'Home' && evento.key !== 'End') {
        return;
      }

      evento.preventDefault();

      const elementos = Array.from(menu.querySelectorAll<HTMLButtonElement>('button'));
      const indiceActual = elementos.indexOf(document.activeElement as HTMLButtonElement);

      if (evento.key === 'Home') {
        elementos[0]?.focus();
        return;
      }

      if (evento.key === 'End') {
        elementos[elementos.length - 1]?.focus();
        return;
      }

      const desplazamiento = evento.key === 'ArrowDown' ? 1 : -1;
      const siguiente = (indiceActual + desplazamiento + elementos.length) % elementos.length;
      elementos[siguiente]?.focus();
    };

    const alCerrarPorCambio = () => {
      alCerrarRef.current();
    };

    window.addEventListener('mousedown', alCerrarExterno);
    window.addEventListener('keydown', alPresionarTecla, true);
    window.addEventListener('blur', alCerrarPorCambio);
    window.addEventListener('resize', alCerrarPorCambio);
    window.addEventListener('scroll', alCerrarPorCambio, true);

    return () => {
      window.removeEventListener('mousedown', alCerrarExterno);
      window.removeEventListener('keydown', alPresionarTecla, true);
      window.removeEventListener('blur', alCerrarPorCambio);
      window.removeEventListener('resize', alCerrarPorCambio);
      window.removeEventListener('scroll', alCerrarPorCambio, true);
    };
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      className="menu-contextual"
      role="menu"
      aria-label={descripcion ?? 'Acciones de la copia'}
      style={{
        left: posicion?.x ?? x,
        top: posicion?.y ?? y,
        visibility: posicion ? 'visible' : 'hidden',
      }}
      onContextMenu={(evento) => evento.preventDefault()}
    >
      {opciones.map((opcion) => (
        <Fragment key={`${opcion.tipo}-${opcion.etiqueta}`}>
          {opcion.separadorAntes && <div className="menu-contextual__separador" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={`menu-contextual__opcion${
              opcion.tipo === 'eliminar' ? ' menu-contextual__opcion--peligro' : ''
            }`}
            onClick={() => {
              alCerrar();
              opcion.alSeleccionar();
            }}
          >
            <span className="menu-contextual__icono">
              <Icono tipo={opcion.tipo} />
            </span>
            <span>{opcion.etiqueta}</span>
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
