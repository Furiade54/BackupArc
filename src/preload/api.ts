import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/constants/ipc-channels';
import type { ApiElectron, EstadoVentana, ProgresoDescargaActualizacion } from '../shared/types/api.types';

export const api: ApiElectron = {
  app: {
    plataforma: process.platform,
    info: () => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),
  },
  ventana: {
    minimizar: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_MINIMIZAR),
    alternarMaximizado: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_ALTERNAR_MAXIMIZADO),
    cerrar: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_CERRAR),
    ocultar: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_OCULTAR),
    salir: () => ipcRenderer.invoke(IPC_CHANNELS.VENTANA_SALIR),
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
    alSolicitarCierre: (callback) => {
      const escuchar = () => {
        callback();
      };

      ipcRenderer.on(IPC_CHANNELS.VENTANA_SOLICITAR_CIERRE, escuchar);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.VENTANA_SOLICITAR_CIERRE, escuchar);
      };
    },
  },
  db: {
    estado: () => ipcRenderer.invoke(IPC_CHANNELS.DB_ESTADO),
  },
  dialogos: {
    seleccionarCarpeta: (rutaInicial) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOGO_SELECCIONAR_CARPETA, rutaInicial),
    seleccionarArchivo: (rutaInicial) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOGO_SELECCIONAR_ARCHIVO, rutaInicial),
  },
  sistema: {
    abrirRuta: (ruta) => ipcRenderer.invoke(IPC_CHANNELS.SISTEMA_ABRIR_RUTA, ruta),
  },
  mssql: {
    probar: (datos, respaldoId) =>
      ipcRenderer.invoke(IPC_CHANNELS.MSSQL_PROBAR, datos, respaldoId),
    basesDatos: (datos, respaldoId) =>
      ipcRenderer.invoke(IPC_CHANNELS.MSSQL_BASES_DATOS, datos, respaldoId),
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
    instalar: () => ipcRenderer.invoke(IPC_CHANNELS.ACTUALIZACIONES_INSTALAR),
    alProgresoDescarga: (callback) => {
      const escuchar = (_evento: IpcRendererEvent, progreso: ProgresoDescargaActualizacion) => {
        callback(progreso);
      };

      ipcRenderer.on(IPC_CHANNELS.ACTUALIZACIONES_PROGRESO, escuchar);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ACTUALIZACIONES_PROGRESO, escuchar);
      };
    },
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
    limpiarHistorial: (id) => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_LIMPIAR_HISTORIAL, id),
    inventarioBak: (id) => ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_INVENTARIO_BAK, id),
    informeBak: (id, filtro) =>
      ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_INFORME_BAK, id, filtro),
    informeGlobal: (filtro) =>
      ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_INFORME_GLOBAL, filtro),
    resumenEjecuciones: (filtro) =>
      ipcRenderer.invoke(IPC_CHANNELS.RESPALDOS_RESUMEN_EJECUCIONES, filtro),
  },
  archivos: {
    listar: (limite) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVOS_LISTAR, limite),
  },
};
