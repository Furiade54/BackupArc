import { useState } from 'react';
import type { RespaldoConfigurado } from '../../../shared/types/respaldo.types';
import { Modal } from './Modal';
import './BackupModals.css';

interface ConfirmDeleteModalProps {
  respaldo: RespaldoConfigurado;
  alCerrar: () => void;
  alEliminado: () => void;
}

export function ConfirmDeleteModal({ respaldo, alCerrar, alEliminado }: ConfirmDeleteModalProps) {
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eliminar = async () => {
    setEliminando(true);
    setError(null);

    try {
      const resultado = await window.api.respaldos.eliminar(respaldo.id);

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      alEliminado();
    } catch {
      setError('No se pudo eliminar la copia.');
    } finally {
      setEliminando(false);
    }
  };

  return (
    <Modal titulo="Eliminar copia" alCerrar={alCerrar}>
      <p className="confirmacion__texto">
        ¿Eliminar <strong>{respaldo.nombre}</strong>? Se borrará su configuración y el historial local
        asociado a esta copia.
      </p>

      {error && (
        <p className="formulario__error" role="alert">
          {error}
        </p>
      )}

      <div className="formulario__acciones">
        <button type="button" className="boton boton--secundario" onClick={alCerrar} disabled={eliminando}>
          Cancelar
        </button>
        <button
          type="button"
          className="boton boton--peligro"
          onClick={() => void eliminar()}
          disabled={eliminando}
        >
          {eliminando ? 'Eliminando…' : 'Eliminar'}
        </button>
      </div>
    </Modal>
  );
}
