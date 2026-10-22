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
  { valor: '3', etiqueta: 'Cada 3 minutos' },
  { valor: '15', etiqueta: 'Cada 15 minutos' },
  { valor: '30', etiqueta: 'Cada 30 minutos' },
  { valor: '60', etiqueta: 'Cada hora' },
  { valor: '120', etiqueta: 'Cada 2 horas' },
  { valor: '360', etiqueta: 'Cada 6 horas' },
  { valor: '720', etiqueta: 'Cada 12 horas' },
  { valor: '1440', etiqueta: 'Cada 24 horas' },
  { valor: '10080', etiqueta: 'Semanal' },
  { valor: '43200', etiqueta: 'Mensual' },
];

const VALOR_PERSONALIZADO = 'personalizado';
const MINUTOS_POR_DIA = 1440;
const MAX_FRECUENCIA_MINUTOS = 43200;

export function NewBackupModal({ respaldo = null, alCerrar, alGuardado }: NewBackupModalProps) {
  const editando = respaldo !== null;
  const minutosIniciales = respaldo?.frecuenciaMinutos ?? MINUTOS_POR_DIA;
  const preseleccionInicial = OPCIONES_FRECUENCIA.some(
    (opcion) => Number(opcion.valor) === minutosIniciales,
  );
  const [nombre, setNombre] = useState(respaldo?.nombre ?? '');
  const [origen, setOrigen] = useState(respaldo?.origen ?? '');
  const [destino, setDestino] = useState(respaldo?.destino ?? '');
  const [frecuencia, setFrecuencia] = useState(
    preseleccionInicial ? String(minutosIniciales) : VALOR_PERSONALIZADO,
  );
  const [minutosPersonalizados, setMinutosPersonalizados] = useState(String(minutosIniciales));
  const [hora, setHora] = useState(respaldo?.horaEjecucion ?? '03:00');
  const [retencion, setRetencion] = useState(String(respaldo?.retencionDias ?? 7));
  const [copiaConFecha, setCopiaConFecha] = useState(respaldo?.copiaConFecha ?? true);
  const [comprimir, setComprimir] = useState(respaldo?.comprimir ?? false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const frecuenciaMinutos =
    frecuencia === VALOR_PERSONALIZADO ? Number(minutosPersonalizados) : Number(frecuencia);
  const usaHoraFija = frecuenciaMinutos >= MINUTOS_POR_DIA;

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();

    const nombreLimpio = nombre.trim();
    const origenLimpio = origen.trim();
    const destinoLimpio = destino.trim();
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

    if (
      !Number.isInteger(frecuenciaMinutos) ||
      frecuenciaMinutos < 1 ||
      frecuenciaMinutos > MAX_FRECUENCIA_MINUTOS
    ) {
      setError('La frecuencia debe ser un número entero de minutos entre 1 y 43200 (30 días).');
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
        frecuenciaMinutos,
        horaEjecucion: hora,
        retencionDias,
        copiaConFecha,
        comprimir,
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
              {OPCIONES_FRECUENCIA.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
              <option value={VALOR_PERSONALIZADO}>Personalizado…</option>
            </select>
          </div>

          <div className="campo">
            <label htmlFor="backup-hora">Hora de ejecución</label>
            <input
              id="backup-hora"
              type="time"
              value={hora}
              disabled={guardando || !usaHoraFija}
              title={usaHoraFija ? undefined : 'Solo aplica a frecuencias de 24 horas o más.'}
              onChange={(evento) => setHora(evento.target.value)}
            />
            {!usaHoraFija && (
              <span className="campo__ayuda">Solo aplica a frecuencias de 24 horas o más.</span>
            )}
          </div>
        </div>

        {frecuencia === VALOR_PERSONALIZADO && (
          <div className="campo">
            <label htmlFor="backup-frecuencia-minutos">Intervalo en minutos</label>
            <input
              id="backup-frecuencia-minutos"
              type="number"
              min={1}
              max={MAX_FRECUENCIA_MINUTOS}
              step={1}
              value={minutosPersonalizados}
              disabled={guardando}
              onChange={(evento) => setMinutosPersonalizados(evento.target.value)}
            />
            <span className="campo__ayuda">Entre 1 y 43200 minutos (30 días).</span>
          </div>
        )}

        <div className="campo">
          <label htmlFor="backup-formato">Formato del destino</label>
          <select
            id="backup-formato"
            value={comprimir ? 'zip' : 'carpeta'}
            disabled={guardando}
            onChange={(evento) => setComprimir(evento.target.value === 'zip')}
          >
            <option value="carpeta">Carpeta descomprimida</option>
            <option value="zip">Archivo .zip</option>
          </select>
          <span className="campo__ayuda">
            {comprimir
              ? 'La copia llega al destino como un único archivo comprimido.'
              : 'La copia llega al destino con las carpetas y archivos tal cual.'}
          </span>
        </div>

        <div className="campo">
          <label htmlFor="backup-carpeta">Nombre de la copia</label>
          <select
            id="backup-carpeta"
            value={copiaConFecha ? 'fecha' : 'unica'}
            disabled={guardando}
            onChange={(evento) => setCopiaConFecha(evento.target.value === 'fecha')}
          >
            <option value="fecha">Con fecha y hora (Documentos_20261021-153000)</option>
            <option value="unica">Sin fecha (sobrescribe la copia anterior)</option>
          </select>
          <span className="campo__ayuda">
            {copiaConFecha
              ? `Cada ejecución crea ${comprimir ? 'un .zip nuevo' : 'una carpeta nueva'} y la retención borra ${
                  comprimir ? 'los antiguos' : 'las antiguas'
                }.`
              : `Siempre se guarda ${comprimir ? 'el mismo .zip' : 'en la misma carpeta'} y se reemplaza en cada ejecución.`}
          </span>
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
            disabled={guardando || !copiaConFecha}
            onChange={(evento) => setRetencion(evento.target.value)}
          />
          {!copiaConFecha && (
            <span className="campo__ayuda">No aplica cuando la copia sobrescribe la anterior.</span>
          )}
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
