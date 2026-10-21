import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/constants/ipc-channels';
import type { ApiElectron, EstadoVentana } from '../shared/types/api.types';

export const api: ApiElectron = {
  app: {
    plataforma: process.platform,
    info: () => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),
  },
  ventana: {
    minimizar: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_MINIMIZAR),
    alternarMaximizado: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_ALTERNAR_MAXIMIZADO),
    cerrar: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_CERRAR),
    estado: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_ESTADO),
    alCambiarEstado: (callback) => {
      const escuchar = (_evento: IpcRendererEvent, estado: EstadoVentana) => {
        callback(estado);
      };

      ipcRenderer.on(IPC_CHANNELS.VENTANA_ESTADO_CAMBIADA, escuchar);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.VENTANA_ESTADO_CAMBIADA, escuchar);
      };
    },
  },
  db: {
    estado: () => ipcRenderer.invoke(IPC_CHANNELS.DB_ESTADO),
  },
  preferencias: {
    obtener: (clave) => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCIAS_OBTENER, clave),
    guardar: (clave, valor) => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCIAS_GUARDAR, clave, valor),
  },
  configuracion: {
    obtener: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIGURACION_OBTENER),
    actualizar: (clave, valor) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIGURACION_ACTUALIZAR, clave, valor),
  },
  actualizaciones: {
    buscar: () => ipcRenderer.invoke(IPC_CHANNELS.ACTUALIZACIONES_BUSCAR),
    abrir: (url) => ipcRenderer.invoke(IPC_CHANNELS.ACTUALIZACIONES_ABRIR, url),
  },
  respaldos: {
    listar: () => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_LISTAR),
    crear: (datos) => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_CREAR, datos),
    actualizar: (id, datos) => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_ACTUALIZAR, id, datos),
    ejecutar: (id) => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_EJECUTAR, id),
    alCambiarEjecucion: (callback) => {
      const escuchar = (_evento: IpcRendererEvent, datos: { id: number; enEjecucion: boolean }) => {
        callback(datos.id, datos.enEjecucion);
      };

      ipcRenderer.on(IPC_CHANNELS.RESPALDOS_EJECUCION, escuchar);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.RESPALDOS_EJECUCION, escuchar);
      };
    },
    eliminar: (id) => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_ELIMINAR, id),
    establecerActivo: (id, habilitado) =>
      ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_ESTABLECER_ACTIVO, id, habilitado),
    historial: (id) => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_HISTORIAL, id),
  },
  archivos: {
    listar: (limite) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVOS_LISTAR, limite),
  },
};
