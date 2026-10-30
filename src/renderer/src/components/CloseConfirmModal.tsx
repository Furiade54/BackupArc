import { Modal } from './Modal';
import './CloseConfirmModal.css';

interface CloseConfirmModalProps {
  alCancelar: () => void;
  alMantenerEnSegundoPlano: () => void;
  alCerrarPorCompleto: () => void;
}

function IconoSegundoPlano() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3.5 12.5v2.2c0 .7.6 1.3 1.3 1.3h10.4c.7 0 1.3-.6 1.3-1.3v-2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M10 3.5v8m0 0L6.9 8.4M10 11.5l3.1-3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconoApagar() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 3v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M6.1 5.6a6 6 0 1 0 7.8 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CloseConfirmModal({
  alCancelar,
  alMantenerEnSegundoPlano,
  alCerrarPorCompleto,
}: CloseConfirmModalProps) {
  return (
    <Modal titulo="¿Qué deseas hacer con BackupArc?" alCerrar={alCancelar} clase="modal--compacto">
      <div className="cierre__acciones">
        <button
          type="button"
          className="cierre__accion cierre__accion--principal"
          onClick={alMantenerEnSegundoPlano}
          autoFocus
        >
          <span className="cierre__icono" aria-hidden="true">
            <IconoSegundoPlano />
          </span>
          <span className="cierre__contenido">
            <span className="cierre__titulo">Mantener en segundo plano</span>
            <span className="cierre__descripcion">
              La ventana se oculta, BackupArc sigue en la bandeja del sistema y las copias
              programadas continúan ejecutándose.
            </span>
          </span>
        </button>

        <button type="button" className="cierre__accion" onClick={alCerrarPorCompleto}>
          <span className="cierre__icono" aria-hidden="true">
            <IconoApagar />
          </span>
          <span className="cierre__contenido">
            <span className="cierre__titulo">Cerrar por completo</span>
            <span className="cierre__descripcion">
              Se detiene el programador y la aplicación sale del todo. No se ejecutará ninguna copia
              hasta que la vuelvas a abrir.
            </span>
          </span>
        </button>

        <button type="button" className="cierre__cancelar" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
