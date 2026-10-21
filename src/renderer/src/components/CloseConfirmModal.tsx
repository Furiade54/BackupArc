import { Modal } from './Modal';
import './CloseConfirmModal.css';

interface CloseConfirmModalProps {
  alCancelar: () => void;
  alMantenerEnSegundoPlano: () => void;
  alCerrarPorCompleto: () => void;
}

export function CloseConfirmModal({
  alCancelar,
  alMantenerEnSegundoPlano,
  alCerrarPorCompleto,
}: CloseConfirmModalProps) {
  return (
    <Modal titulo="Cerrar BackupArc" alCerrar={alCancelar} clase="modal--compacto">
      <p className="cierre__texto">¿Qué deseas hacer?</p>
      <p className="cierre__nota">
        Si la mantienes en segundo plano, BackupArc seguirá en la bandeja del sistema y las copias
        programadas continuarán ejecutándose.
      </p>

      <div className="cierre__acciones">
        <button type="button" className="boton" onClick={alMantenerEnSegundoPlano} autoFocus>
          Mantener en segundo plano
        </button>
        <button type="button" className="boton boton--peligro" onClick={alCerrarPorCompleto}>
          Cerrar por completo
        </button>
        <button type="button" className="boton boton--secundario" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
