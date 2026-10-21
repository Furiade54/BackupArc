import { useState, type FormEvent } from 'react';
import type { RespaldoConfigurado } from '../../../shared/types/respaldo.types';
import { Modal } from './Modal';
import './BackupModals.css';

interface NewBackupModalProps {
  respaldo?: RespaldoConfigurado | null;
  alCerrar: () => void;
  alGuardado: () => void;
}

const OPCIONES_FRECUENCIA = [
  { valor: '12', etiqueta: 'Cada 12 horas' },
  { valor: '24', etiqueta: 'Cada 24 horas' },
  { valor: '168', etiqueta: 'Semanal' },
  { valor: '720', etiqueta: 'Mensual' },
];

function opcionesFrecuencia(horas: number | null): typeof OPCIONES_FRECUENCIA {
  if (horas === null || OPCIONES_FRECUENCIA.some((opcion) => Number(opcion.valor) === horas)) {
    return OPCIONES_FRECUENCIA;
  }

  return [...OPCIONES_FRECUENCIA, { valor: String(horas), etiqueta: `Cada ${horas} horas` }];
}

export function NewBackupModal({ respaldo = null, alCerrar, alGuardado }: NewBackupModalProps) {
  const editando = respaldo !== null;
  const [nombre, setNombre] = useState(respaldo?.nombre ?? '');
  const [origen, setOrigen] = useState(respaldo?.origen ?? '');
  const [destino, setDestino] = useState(respaldo?.destino ?? '');
  const [frecuencia, setFrecuencia] = useState(String(respaldo?.frecuenciaHoras ?? 24));
  const [hora, setHora] = useState(respaldo?.horaEjecucion ?? '03:00');
  const [retencion, setRetencion] = useState(String(respaldo?.retencionDias ?? 7));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();

    const nombreLimpio = nombre.trim();
    const origenLimpio = origen.trim();
    const destinoLimpio = destino.trim();
    const frecuenciaHoras = Number(frecuencia);
    const retencionDias = Number(retencion);

    if (!nombreLimpio) {
      setError('Escribe un nombre para el backup.');
      return;
    }

    if (!origenLimpio) {
      setError('Indica la carpeta, archivos o datos que se van a respaldar.');
      return;
    }

    if (!destinoLimpio) {
      setError('Indica dónde se guardará la copia.');
      return;
    }

    if (!Number.isInteger(frecuenciaHoras) || frecuenciaHoras < 1 || frecuenciaHoras > 720) {
      setError('Selecciona una frecuencia válida.');
      return;
    }

    if (!Number.isInteger(retencionDias) || retencionDias < 1 || retencionDias > 3650) {
      setError('La retención debe ser un número entero entre 1 y 3650 días.');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      const datos = {
        nombre: nombreLimpio,
        origen: origenLimpio,
        destino: destinoLimpio,
        frecuenciaHoras,
        horaEjecucion: hora,
        retencionDias,
      };

      const resultado = respaldo
        ? await window.api.respaldos.actualizar(respaldo.id, datos)
        : await window.api.respaldos.crear(datos);

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      alGuardado();
    } catch {
      setError(editando ? 'No se pudo actualizar el backup.' : 'No se pudo crear el backup.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal titulo={editando ? 'Editar tarea de backup' : 'Nuevo backup'} alCerrar={alCerrar}>
      <form className="formulario" onSubmit={(evento) => void enviar(evento)}>
        <div className="campo">
          <label htmlFor="backup-nombre">Nombre</label>
          <input
            id="backup-nombre"
            type="text"
            value={nombre}
            maxLength={80}
            placeholder="Ej. Backup documentos"
            autoFocus
            disabled={guardando}
            onChange={(evento) => setNombre(evento.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="backup-origen">Origen</label>
          <input
            id="backup-origen"
            type="text"
            value={origen}
            maxLength={500}
            placeholder="Carpeta, archivos o datos a respaldar"
            disabled={guardando}
            onChange={(evento) => setOrigen(evento.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="backup-destino">Destino</label>
          <input
            id="backup-destino"
            type="text"
            value={destino}
            maxLength={500}
            placeholder="Lugar donde se guardará la copia"
            disabled={guardando}
            onChange={(evento) => setDestino(evento.target.value)}
          />
        </div>

        <div className="formulario__fila">
          <div className="campo">
            <label htmlFor="backup-frecuencia">Frecuencia</label>
            <select
              id="backup-frecuencia"
              value={frecuencia}
              disabled={guardando}
              onChange={(evento) => setFrecuencia(evento.target.value)}
            >
              {opcionesFrecuencia(respaldo?.frecuenciaHoras ?? null).map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="backup-hora">Hora de ejecución</label>
            <input
              id="backup-hora"
              type="time"
              value={hora}
              disabled={guardando}
              onChange={(evento) => setHora(evento.target.value)}
            />
          </div>
        </div>

        <div className="campo">
          <label htmlFor="backup-retencion">Retención (días)</label>
          <input
            id="backup-retencion"
            type="number"
            min={1}
            max={3650}
            step={1}
            value={retencion}
            disabled={guardando}
            onChange={(evento) => setRetencion(evento.target.value)}
          />
        </div>

        {error && (
          <p className="formulario__error" role="alert">
            {error}
          </p>
        )}

        <div className="formulario__acciones">
          <button type="button" className="boton boton--secundario" onClick={alCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="boton" disabled={guardando}>
            {guardando ? (editando ? 'Guardando…' : 'Creando…') : editando ? 'Guardar cambios' : 'Crear backup'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
