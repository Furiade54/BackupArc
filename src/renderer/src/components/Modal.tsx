import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

interface ModalProps {
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
}

export function Modal({ titulo, alCerrar, children }: ModalProps) {
  const idTitulo = useId();
  const dialogoRef = useRef<HTMLDivElement>(null);
  const alCerrarRef = useRef(alCerrar);
  alCerrarRef.current = alCerrar;

  useEffect(() => {
    const alPresionarTecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        evento.stopPropagation();
        alCerrarRef.current();
      }
    };

    document.addEventListener('keydown', alPresionarTecla);

    const dialogo = dialogoRef.current;

    if (dialogo && !dialogo.contains(document.activeElement)) {
      dialogo.focus();
    }

    return () => {
      document.removeEventListener('keydown', alPresionarTecla);
    };
  }, []);

  return createPortal(
    <div
      className="modal-fondo"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) {
          alCerrar();
        }
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        ref={dialogoRef}
      >
        <header className="modal__encabezado">
          <h2 id={idTitulo}>{titulo}</h2>
          <button type="button" className="modal__cerrar" aria-label="Cerrar" title="Cerrar" onClick={alCerrar}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </header>

        <div className="modal__cuerpo">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
